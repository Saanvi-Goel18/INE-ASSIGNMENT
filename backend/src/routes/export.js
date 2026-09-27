const express = require('express');
const router = express.Router();
const supabase = require('../db/supabaseClient');

// GET /api/export[?product=<tracked_product_id>] -> CSV of every scrape, failures included.
router.get('/', async (req, res) => {
  let query = supabase
    .from('scrape_log')
    .select('ts, price, stock, outcome, tracked_products(store_product_id, product_name, selected_option)')
    .order('ts');
  if (req.query.product) query = query.eq('tracked_product_id', req.query.product);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Exactly the fields the brief asks for, in its order. Failed rows leave price/stock empty.
  const header = 'store_product_id,product_name,selected_option,timestamp,price,stock,outcome';
  const rows = data.map((row) => {
    const p = row.tracked_products;
    // Postgres returns "…+00:00"; normalise to ISO 8601 UTC with a Z suffix.
    return [p.store_product_id, p.product_name, p.selected_option, new Date(row.ts).toISOString(), row.price, row.stock, row.outcome]
      .map(csvSafe)
      .join(',');
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="scrape_history.csv"');
  res.send([header, ...rows].join('\n') + '\n');
});

function csvSafe(value) {
  if (value == null) return '';
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

module.exports = router;
