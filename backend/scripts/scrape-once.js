// CLI: node scripts/scrape-once.js <storeProductId> "<option label>" [--headed] [--slowmo=150] [--simulate-layout-change] [--save]
// Runs the exact same scrapeProduct() the backend uses, printing every step.
// --save also writes the result to scrape_log (triggered_by = 'manual'), exactly like
// /api/scrape/run does, so it appears on the dashboard. The product/option must be tracked.
require('dotenv').config({ quiet: true });
const { scrapeProduct, productUrlFor } = require('../src/scraper/scrapeProduct');

const [id, optionLabel] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const headed = process.argv.includes('--headed');
const save = process.argv.includes('--save');
const simulateLayoutChange = process.argv.includes('--simulate-layout-change');
const slowMo = Number((process.argv.find((a) => a.startsWith('--slowmo=')) || '').split('=')[1]) || undefined;
if (!id || !optionLabel) {
  console.error('usage: node scripts/scrape-once.js <storeProductId> "<option label>" [--headed] [--slowmo=150] [--simulate-layout-change] [--save]');
  process.exit(1);
}

(async () => {
  let product = null;
  if (save) {
    // Loaded only with --save, so the default terminal-only run needs no database.
    const supabase = require('../src/db/supabaseClient');
    const { data, error } = await supabase.from('tracked_products').select('*').eq('store_product_id', String(id)).eq('selected_option', optionLabel);
    if (error) throw new Error(`load tracked product: ${error.message}`);
    if (!data.length) {
      console.error(`--save: ${id} / "${optionLabel}" is not a tracked product. Track it on the dashboard first, or run without --save.`);
      process.exitCode = 1;
      return;
    }
    product = data[0];
  }

  const r = await scrapeProduct({ productUrl: productUrlFor(id), optionLabel, headless: !headed, slowMo, simulateLayoutChange, log: (l) => console.log(l) });
  const { events, ...summary } = r;
  console.log(JSON.stringify(summary));

  if (save) {
    const { saveScrape } = require('../src/scraper/runAll');
    const err = await saveScrape(product, r, 'manual');
    console.log(err ? `SAVE FAILED: ${err.message}` : `saved to scrape_log as a manual run (${r.outcome}) for ${product.product_name} / ${product.selected_option}`);
    if (err) process.exitCode = 1;
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
