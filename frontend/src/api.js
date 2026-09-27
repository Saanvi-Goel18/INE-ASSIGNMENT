const BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

export const api = {
  listProducts: () => request('/api/products'),
  addProduct: (storeProductId, optionCode) =>
    request('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_product_id: storeProductId, option_code: optionCode }),
    }),
  removeProduct: (id) => request(`/api/products/${id}`, { method: 'DELETE' }),
  history: (id) => request(`/api/products/${id}/history`),
  log: (id) => request(`/api/products/${id}/log`),
  searchStore: (q) => request(`/api/store/search?q=${encodeURIComponent(q)}`),
  storeItem: (id) => request(`/api/store/items/${id}`),
  exportUrl: (productId) => `${BASE}/api/export${productId ? `?product=${productId}` : ''}`,
};
