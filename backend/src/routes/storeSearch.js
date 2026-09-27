const express = require('express');
const router = express.Router();
const { searchCatalog, getItem } = require('../store/storeApi');

// The store has no search endpoint, so we search our own cached copy of its catalog.
router.get('/search', async (req, res) => {
  try {
    res.json(await searchCatalog(req.query.q, Math.min(Number(req.query.limit) || 20, 50)));
  } catch (err) {
    res.status(502).json({ error: `store catalog unavailable: ${err.message}` });
  }
});

router.get('/items/:id', async (req, res) => {
  try {
    res.json(await getItem(req.params.id));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
