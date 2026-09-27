// Plan's non-negotiable invariant: a failed scrape never carries a price or stock.
const test = require('node:test');
const assert = require('node:assert');
const { scrapeProduct } = require('../src/scraper/scrapeProduct');

test('failed scrape returns null price/stock (nonexistent product)', { timeout: 240000 }, async () => {
  const r = await scrapeProduct({ productUrl: 'https://demo.inelabteamdev.com/item/99999999', optionLabel: 'Anything' });
  assert.strictEqual(r.outcome, 'failed');
  assert.strictEqual(r.price, null);
  assert.strictEqual(r.stock, null);
  assert.strictEqual(r.stockText, null);
  assert.ok(r.error);
});

test('failed scrape returns null price/stock (option that does not exist)', { timeout: 240000 }, async () => {
  const r = await scrapeProduct({ productUrl: 'https://demo.inelabteamdev.com/item/2801', optionLabel: 'No Such Option' });
  assert.strictEqual(r.outcome, 'failed');
  assert.strictEqual(r.price, null);
  assert.strictEqual(r.stock, null);
});
