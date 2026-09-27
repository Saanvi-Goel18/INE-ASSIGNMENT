const { chromium } = require('playwright');
const { extractOfferInfo, parsePrice, parseStock } = require('./extractPrice');

const STORE_BASE_URL = process.env.STORE_BASE_URL || 'https://demo.inelabteamdev.com';

// One "attempt" = one click on Check / Check again / Retry that we then wait on
// until the panel reaches a terminal state. The page itself already retries
// retryable upstream errors up to 6x inside a single attempt.
const MAX_ATTEMPTS = 5;
const NAV_TIMEOUT_MS = 30000;
const ATTEMPT_TIMEOUT_MS = 30000; // PoW + page's internal backoff can take a while
const CLICK_ACK_MS = 3000; // if the panel hasn't left its state by then, the click was dropped

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function productUrlFor(storeProductId) {
  return `${STORE_BASE_URL}/item/${storeProductId}`;
}

/**
 * Scrape one product/option.
 *
 * @param {object} opts
 * @param {string} opts.productUrl     e.g. https://demo.inelabteamdev.com/item/2801
 * @param {string} opts.optionLabel    e.g. "Standard kit"
 * @param {boolean} [opts.headless=true]
 * @param {import('playwright').Browser} [opts.browser] reuse an existing browser
 * @param {object} [opts.contextOptions] extra newContext() options (e.g. recordVideo)
 * @param {(msg:string)=>void} [opts.log]
 * @param {number} [opts.slowMo] only used when we launch the browser ourselves
 * @returns {Promise<{timestamp,price,stock,stockText,outcome,attempts,error,events}>}
 *
 * Invariant: when outcome === 'failed', price/stock/stockText are always null.
 */
async function scrapeProduct({ productUrl, optionLabel, headless = true, browser: sharedBrowser, contextOptions = {}, log = () => {}, slowMo }) {
  const events = [];
  const note = (msg) => {
    const line = `${new Date().toISOString()} ${msg}`;
    events.push(line);
    log(line);
  };

  let browser = sharedBrowser;
  let context;
  let attempts = 0;
  let result = null; // {price, stock, stockText}
  let lastError = null;
  let pageAttemptsMax = 1;

  try {
    if (!browser) browser = await chromium.launch({ headless, slowMo });
    context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-IN', ...contextOptions });
    const page = await context.newPage();

    // Capture the page's own layout manifest so we know the real price class.
    let priceClass = null;
    page.on('response', async (res) => {
      if (res.url().includes('/api/v2/ui/manifest') && res.ok()) {
        try {
          priceClass = (await res.json())?.classes?.priceValue || null;
        } catch {}
      }
      if (/\/api\/v2\/(handshake|items\/\d+\/quote)/.test(res.url()) && res.status() >= 400) {
        note(`network: ${res.request().method()} ${new URL(res.url()).pathname} -> ${res.status()}`);
      }
    });

    // Cookie modal: can appear at any moment and blocks clicks. Dismiss whenever it shows.
    await page.addLocatorHandler(page.locator('.consent-scrim'), async () => {
      for (let i = 0; i < 6 && (await page.locator('.consent-scrim').count()); i++) {
        await page.getByRole('button', { name: 'Reject cookies' }).click({ timeout: 2000 }).catch(() => {});
        await sleep(150);
      }
      note('dismissed cookie consent modal');
    });

    const loadPage = async () => {
      priceClass = null;
      await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      // Wait until the product (and its offer panel) rendered, or the page's own error banner shows.
      await page.waitForSelector('.offer-panel, .shelf-alert', { timeout: NAV_TIMEOUT_MS });
      if (await page.locator('.shelf-alert').count()) {
        throw new Error(`store page error: ${(await page.locator('.shelf-alert').first().textContent()).trim()}`);
      }
    };

    const selectOption = async () => {
      const chip = page.locator('.opt-picker button', { hasText: optionLabel });
      if ((await page.locator('.opt-picker').count()) === 0) return; // single-option product
      const exact = chip.filter({ hasText: new RegExp(`^\\s*${optionLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) });
      if ((await exact.count()) !== 1) throw new Error(`option "${optionLabel}" not found on page`);
      for (let i = 0; i < 3; i++) {
        if ((await exact.getAttribute('aria-pressed')) === 'true') return;
        await exact.click();
        await sleep(200);
      }
      if ((await exact.getAttribute('aria-pressed')) !== 'true') throw new Error(`could not select option "${optionLabel}"`);
    };

    // Satisfy the telemetry gate: >=8 moves (>=40ms apart) and >=600ms dwell over the panel.
    const hoverPanel = async () => {
      const box = await page.locator('.offer-panel').boundingBox();
      if (!box) return;
      // Wandering path with jittered timing: perfectly regular moves look scripted to the challenge.
      let x = box.x + box.width * (0.2 + Math.random() * 0.2);
      let y = box.y + box.height * (0.2 + Math.random() * 0.3);
      for (let k = 0; k < 14; k++) {
        x = Math.min(box.x + box.width - 10, Math.max(box.x + 10, x + (Math.random() - 0.4) * 40));
        y = Math.min(box.y + box.height - 10, Math.max(box.y + 10, y + (Math.random() - 0.5) * 25));
        await page.mouse.move(x, y, { steps: 2 + Math.floor(Math.random() * 4) });
        await sleep(45 + Math.random() * 90);
      }
      await sleep(200 + Math.random() * 300);
    };

    const panelState = () => page.evaluate(extractOfferInfo, null).then((i) => i.state);

    let pageLoaded = false;
    while (attempts < MAX_ATTEMPTS) {
      attempts += 1;
      try {
        if (!pageLoaded) {
          await loadPage();
          await selectOption();
          pageLoaded = true;
        }
        await hoverPanel();

        const button = page.locator('.offer-panel button', { hasText: /check today.s price|check again|retry/i }).first();
        await button.waitFor({ state: 'visible', timeout: 10000 });
        // The gate disables the button until telemetry is satisfied.
        for (let i = 0; i < 20 && (await button.isDisabled()); i++) {
          await hoverPanel();
        }
        const before = await panelState();
        const label = (await button.textContent()).trim();
        note(`attempt ${attempts}: clicking "${label}" (panel was ${before})`);

        // Click, and re-click if the store silently swallowed it.
        let acked = false;
        for (let c = 0; c < 3 && !acked; c++) {
          if (c > 0) note(`attempt ${attempts}: click had no effect, clicking again`);
          await button.click({ timeout: 10000 });
          acked = await page
            .waitForFunction(
              ([fn, prev]) => {
                const p = document.querySelector('.offer-panel');
                if (!p) return false;
                // loading/retrying panels are aria-busy; any class change means it reacted
                return p.getAttribute('aria-busy') === 'true' || !p.className.includes(prev);
              },
              [null, before === 'ready' ? 'offer-ready' : before === 'failed' ? 'offer-failed' : 'offer-locked'],
              { timeout: CLICK_ACK_MS }
            )
            .then(() => true)
            .catch(() => false);
        }
        if (!acked) throw new Error('check-price click was ignored 3 times');

        // Wait for a terminal state (ready or failed).
        await page.waitForFunction(
          () => {
            const p = document.querySelector('.offer-panel');
            return p && (p.className.includes('offer-ready') || p.className.includes('offer-failed'));
          },
          null,
          { timeout: ATTEMPT_TIMEOUT_MS }
        );
        // Let React finish painting the ready panel.
        await sleep(300);
        const info = await page.evaluate(extractOfferInfo, priceClass);

        if (info.state === 'failed') throw new Error(`store reported: ${info.message}`);
        if (info.pending) throw new Error('price shown with "Refreshing prices" (stale/pending quote) — not trusted');
        if (!info.priceText) throw new Error(`could not isolate the real price node (${info.candidateCount} visible candidates)`);

        const price = parsePrice(info.priceText);
        if (price == null || !(price > 0)) throw new Error(`price text did not parse: ${JSON.stringify(info.priceText)}`);
        const mrp = parsePrice(info.mrpText);
        if (mrp != null && price > mrp) throw new Error(`sanity check failed: price ${price} > MRP ${mrp}`);
        const stock = parseStock(info.stockText, info.soldOut);
        if (stock == null) throw new Error(`stock text did not parse: ${JSON.stringify(info.stockText)}`);

        if (info.pageAttempts) pageAttemptsMax = Math.max(pageAttemptsMax, info.pageAttempts);
        note(`attempt ${attempts}: OK price=${price} stock=${stock} ("${info.stockText}") via ${info.method}` + (info.pageAttempts > 1 ? `, page needed ${info.pageAttempts} internal attempts` : ''));
        result = { price, stock, stockText: info.stockText };
        break;
      } catch (err) {
        lastError = err.message.split('\n')[0];
        note(`attempt ${attempts}: FAILED — ${lastError}`);
        // Navigation / page-level problems: reload from scratch next time.
        // A rejected handshake or a stuck "Refreshing prices" quote tends to repeat on the same page, so start over with a fresh load (new telemetry).
        if (/store page error|option|Timeout|net::|Navigation|Target|closed|challenge_failed|Refreshing prices/i.test(lastError)) pageLoaded = false;
        // Back off much harder when the store is rate limiting us.
        if (attempts < MAX_ATTEMPTS) await sleep((/429/.test(lastError) ? 5000 : 500) * attempts);
      }
    }
  } catch (fatal) {
    lastError = fatal.message.split('\n')[0];
    note(`fatal: ${lastError}`);
  } finally {
    if (context) await context.close().catch(() => {});
    if (!sharedBrowser && browser) await browser.close().catch(() => {});
  }

  let outcome = 'failed';
  if (result) outcome = attempts === 1 && pageAttemptsMax === 1 ? 'success' : 'retried';

  return {
    timestamp: new Date().toISOString(),
    price: outcome === 'failed' ? null : result.price,
    stock: outcome === 'failed' ? null : result.stock,
    stockText: outcome === 'failed' ? null : result.stockText,
    outcome,
    attempts,
    error: outcome === 'failed' ? lastError : null,
    events,
  };
}

module.exports = { scrapeProduct, productUrlFor, MAX_ATTEMPTS };
