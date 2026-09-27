const test = require('node:test');
const assert = require('node:assert');
const { parsePrice, parseStock, normalizeText } = require('../src/scraper/extractPrice');

const ZW = '​';
const NB = ' ';

test('parsePrice handles every price format the store rotates through', () => {
  const cases = [
    ['₹13,570', 13570],
    ['₹1,44,371', 144371],
    ['₹13 570', 13570],
    ['₹13.570,00', 13570],
    ['₹13,570/- (incl. of all taxes)', 13570],
    ['₹１３,５７０', 13570],
    [`Rs.${NB}13,570.00`, 13570],
    [`₹${ZW}1${ZW}3${ZW},${ZW}5${ZW}7${ZW}0`, 13570], // split carrier
    [['₹', '1', '3', ',', '5', '7', '0'].join(`${NB}${ZW}`), 13570], // nbsp format
    [`₹${ZW}7${ZW}0${ZW} ${ZW}7${ZW}4${ZW}2`, 70742], // split + spaced, seen live
    ['₹999', 999],
  ];
  for (const [input, expected] of cases) assert.strictEqual(parsePrice(input), expected, JSON.stringify(input));
});

test('parsePrice rejects non-prices', () => {
  for (const input of [null, '', 'Refreshing prices', '35% saving', 'no money here', '₹', '₹abc']) {
    assert.strictEqual(parsePrice(input), null, JSON.stringify(input));
  }
});

test('parseStock handles all stock wordings', () => {
  assert.strictEqual(parseStock('50 units available'), 50);
  assert.strictEqual(parseStock('Last few: 86'), 86);
  assert.strictEqual(parseStock('Available (12)'), 12);
  assert.strictEqual(parseStock('Stock: 7 remaining'), 7);
  assert.strictEqual(parseStock('Ready to ship · 30 available'), 30);
  assert.strictEqual(parseStock('Sold out', true), 0);
  assert.strictEqual(parseStock('Sold out'), 0);
  assert.strictEqual(parseStock(null), null);
  assert.strictEqual(parseStock('lots'), null);
});

test('normalizeText strips zero-width chars and folds full-width digits', () => {
  assert.strictEqual(normalizeText(`a${ZW}b${NB}c１２`), 'ab c12');
});
