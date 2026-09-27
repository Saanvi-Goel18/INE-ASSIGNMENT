const { chromium } = require('playwright');
const supabase = require('../db/supabaseClient');
const { scrapeProduct } = require('./scrapeProduct');

const PAUSE_BETWEEN_PRODUCTS_MS = 3000; // scrapes stay sequential: parallel runs get the IP rate limited (429)

let current = null; // promise of the run in progress
let lastRun = null; // summary of the last finished run

/**
 * Scrape every tracked product once and append one scrape_log row per product —
 * including failures, which are logged with price/stock NULL.
 */
async function runAll({ log = console.log } = {}) {
  const startedAt = new Date().toISOString();
  const { data: products, error } = await supabase.from('tracked_products').select('*').order('added_at');
  if (error) throw new Error(`load tracked_products: ${error.message}`);

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const results = [];
  try {
    for (const [i, product] of products.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_PRODUCTS_MS));
      const r = await scrapeProduct({
        productUrl: product.product_url,
        optionLabel: product.selected_option,
        browser,
        log: (line) => log(`[${product.store_product_id}/${product.option_code}] ${line}`),
      });
      const { error: insertErr } = await supabase.from('scrape_log').insert({
        tracked_product_id: product.id,
        ts: r.timestamp,
        price: r.price,
        stock: r.stock,
        stock_text: r.stockText,
        outcome: r.outcome,
        attempts: r.attempts,
        error: r.error,
      });
      if (insertErr) log(`insert failed for ${product.id}: ${insertErr.message}`);
      results.push({
        trackedProductId: product.id,
        outcome: r.outcome,
        price: r.price,
        stock: r.stock,
        attempts: r.attempts,
        error: r.error,
        insertError: insertErr?.message || null,
      });
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return { startedAt, finishedAt: new Date().toISOString(), scraped: results.length, results };
}

/** Start a run unless one is already going. Returns { started, promise }. */
function startRun(opts) {
  if (current) return { started: false, promise: current };
  current = runAll(opts)
    .then((summary) => (lastRun = summary))
    .catch((err) => (lastRun = { error: err.message, finishedAt: new Date().toISOString() }))
    .finally(() => (current = null));
  return { started: true, promise: current };
}

module.exports = { runAll, startRun, isRunning: () => Boolean(current), getLastRun: () => lastRun };
