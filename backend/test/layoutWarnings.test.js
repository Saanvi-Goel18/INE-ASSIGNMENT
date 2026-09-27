const test = require('node:test');
const assert = require('node:assert');
const { layoutWarningsFor } = require('../src/scraper/extractPrice');

const ready = (over = {}) => ({
  state: 'ready',
  method: 'manifest-class',
  pending: false,
  candidateCount: 1,
  structure: { offerRow: true, stockPill: true, priceClassFound: true },
  ...over,
});

test('primary path with the expected structure raises no warnings', () => {
  assert.deepStrictEqual(layoutWarningsFor(ready(), 'nvo-c5v1a2'), []);
});

test('missing manifest + structural fallback is flagged', () => {
  const w = layoutWarningsFor(ready({ method: 'structural', structure: { offerRow: true, stockPill: true, priceClassFound: null } }), null);
  assert.deepStrictEqual(w, ['layout manifest (price class) not received', 'price found by structural fallback']);
});

test('manifest class no longer present on the page is flagged', () => {
  const w = layoutWarningsFor(ready({ method: 'structural', structure: { offerRow: true, stockPill: true, priceClassFound: false } }), 'nvo-c5v1a2');
  assert.ok(w.includes('no element with the manifest price class'));
  assert.ok(w.includes('price found by structural fallback'));
});

test('missing expected elements are flagged', () => {
  const w = layoutWarningsFor(ready({ structure: { offerRow: false, stockPill: false, priceClassFound: true } }), 'x');
  assert.deepStrictEqual(w, ['.offer-row missing', 'stock pill (.avail-pill) missing']);
});

test('price that cannot be isolated is flagged, but a pending quote is not', () => {
  assert.deepStrictEqual(layoutWarningsFor(ready({ method: null, candidateCount: 3 }), 'x'), ['price element not identifiable (3 candidates)']);
  assert.deepStrictEqual(layoutWarningsFor(ready({ method: null, pending: true }), 'x'), []);
});

test('non-ready panels are not judged', () => {
  assert.deepStrictEqual(layoutWarningsFor({ state: 'failed' }, null), []);
  assert.deepStrictEqual(layoutWarningsFor(null, null), []);
});
