const express = require('express');
const router = express.Router();
const supabase = require('../db/supabaseClient');
const { getItem } = require('../store/storeApi');

router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('tracked_products').select('*').order('added_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Body: { store_product_id, option_code }. Name, option label and URL are looked up
// from the store itself so a client can never store a mismatched label/code pair.
router.post('/', async (req, res) => {
  const { store_product_id, option_code } = req.body || {};
  if (!store_product_id) return res.status(400).json({ error: 'store_product_id is required' });

  let item;
  try {
    item = await getItem(store_product_id);
  } catch (err) {
    return res.status(404).json({ error: `store product ${store_product_id} not found (${err.message})` });
  }
  const option = item.options.length
    ? item.options.find((o) => o.code === option_code)
    : { code: 'default', label: 'default' };
  if (!option) {
    return res.status(400).json({ error: `option_code must be one of ${item.options.map((o) => `${o.code} (${o.label})`).join(', ')}` });
  }

  const { data, error } = await supabase
    .from('tracked_products')
    .insert({
      store_product_id: String(item.id),
      product_name: item.name,
      selected_option: option.label,
      option_code: option.code,
      product_url: item.productUrl,
    })
    .select()
    .single();
  if (error?.code === '23505') return res.status(409).json({ error: 'this product/option is already tracked' });
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('tracked_products').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

// Chart data: successful reads only (failed rows have no price).
router.get('/:id/history', async (req, res) => {
  const { data, error } = await supabase
    .from('scrape_log')
    .select('ts, price, stock, outcome')
    .eq('tracked_product_id', req.params.id)
    .not('price', 'is', null)
    .order('ts');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Full log, failures included.
router.get('/:id/log', async (req, res) => {
  const { data, error } = await supabase
    .from('scrape_log')
    .select('*')
    .eq('tracked_product_id', req.params.id)
    .order('ts', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
