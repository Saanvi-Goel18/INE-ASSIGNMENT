require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const cronAuth = require('./middleware/cronAuth');
const { getCatalog, catalogStatus } = require('./store/storeApi');

const bootedAt = new Date().toISOString();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/products', require('./routes/products'));
app.use('/api/export', require('./routes/export'));
app.use('/api/scrape', cronAuth, require('./routes/scrape'));
app.use('/api/store', require('./routes/storeSearch'));

app.get('/health', (req, res) => res.json({ ok: true, bootedAt, catalog: catalogStatus() }));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`listening on ${port}`);
  getCatalog()
    .then((c) => console.log(`store catalog ready from ${c.source}: ${c.items.size}/${c.expected} items`))
    .catch((e) => console.log(`catalog warm-up failed: ${e.message}`));
});
