// CLI: node scripts/scrape-once.js <storeProductId> "<option label>" [--headed] [--slowmo=150]
// Runs the exact same scrapeProduct() the backend uses, printing every step.
require('dotenv').config();
const { scrapeProduct, productUrlFor } = require('../src/scraper/scrapeProduct');

const [id, optionLabel] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const headed = process.argv.includes('--headed');
const slowMo = Number((process.argv.find((a) => a.startsWith('--slowmo=')) || '').split('=')[1]) || undefined;
if (!id || !optionLabel) {
  console.error('usage: node scripts/scrape-once.js <storeProductId> "<option label>" [--headed] [--slowmo=150]');
  process.exit(1);
}
scrapeProduct({ productUrl: productUrlFor(id), optionLabel, headless: !headed, slowMo, log: (l) => console.log(l) }).then((r) => {
  const { events, ...summary } = r;
  console.log(JSON.stringify(summary));
});
