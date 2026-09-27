// Plain-HTTP access to the store's public JSON API (catalog + option metadata).
// Prices are NOT read here — the quote payload is encrypted, so prices come from the rendered page.
const STORE_BASE_URL = process.env.STORE_BASE_URL || 'https://demo.inelabteamdev.com';
const PAGE_LIMIT = 60; // the API caps limit at 60
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SWEEPS = 12;
const PAGE_DELAY_MS = 300; // gentle pacing: the store rate limits (429) bursts of requests

const { readCatalogCache, writeCatalogCache } = require('./catalogCache');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(path, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${STORE_BASE_URL}${path}`);
      if (res.ok) return await res.json();
      lastErr = new Error(`${path} -> ${res.status}`);
      if (res.status === 404) break;
      if (res.status === 429) {
        await sleep(3000 * (i + 1));
        continue;
      }
    } catch (err) {
      lastErr = err;
    }
    await sleep(400 * (i + 1));
  }
  throw lastErr;
}

let catalog = null; // { items: Map<id, item>, loadedAt, complete, expected }
let loading = null;

/**
 * The listings endpoint returns a different random order on every request and has no
 * search param, so we sweep all pages repeatedly until we've seen `count` unique items.
 */
async function loadCatalog() {
  const items = new Map();
  let expected = Infinity;
  let lastErr;
  for (let sweep = 0; sweep < MAX_SWEEPS && items.size < expected; sweep++) {
    let first;
    try {
      first = await getJson(`/api/v2/listings?page=1&limit=${PAGE_LIMIT}`);
    } catch (err) {
      lastErr = err;
      await sleep(5000);
      continue;
    }
    expected = first.count;
    first.results.forEach((x) => items.set(x.id, x));
    for (let p = 2; p <= first.totalPages && items.size < expected; p++) {
      await sleep(PAGE_DELAY_MS);
      try {
        const page = await getJson(`/api/v2/listings?page=${p}&limit=${PAGE_LIMIT}`, 2);
        page.results.forEach((x) => items.set(x.id, x));
      } catch {
        // occasional 503s — the next sweep covers what this page missed
      }
    }
  }
  if (!items.size) throw lastErr || new Error('store catalog is empty');
  const complete = items.size >= expected;
  // A partial catalog is still useful for search; expire it early so the next search retries.
  return { items, loadedAt: complete ? Date.now() : Date.now() - CATALOG_TTL_MS + 5 * 60 * 1000, complete, expected };
}

let cacheChecked = false;

/** Sweep the store and, when the result is complete, persist it for the next cold start. */
function refreshCatalog() {
  if (!loading) {
    loading = loadCatalog()
      .then(async (c) => {
        catalog = { ...c, source: 'sweep' };
        if (c.complete) await writeCatalogCache(c).catch((e) => console.log(`catalog cache write failed: ${e.message}`));
        return catalog;
      })
      .finally(() => (loading = null));
  }
  return loading;
}

/**
 * Stale-while-revalidate: on a cold start, serve the persisted catalog at once. If it is
 * older than the TTL it is still served, and a background sweep replaces it.
 */
async function getCatalog() {
  if (!catalog && !cacheChecked) {
    cacheChecked = true;
    const cached = await readCatalogCache().catch((e) => {
      console.log(`catalog cache read failed: ${e.message}`);
      return null;
    });
    if (cached) {
      catalog = { items: cached.items, loadedAt: cached.savedAt, expected: cached.expected, complete: cached.items.size >= cached.expected, source: 'cache' };
    }
  }
  if (catalog) {
    if (Date.now() - catalog.loadedAt >= CATALOG_TTL_MS) refreshCatalog().catch((e) => console.log(`catalog refresh failed: ${e.message}`));
    return catalog;
  }
  return refreshCatalog();
}

const catalogStatus = () =>
  catalog ? { source: catalog.source, items: catalog.items.size, ageMin: Math.round((Date.now() - catalog.loadedAt) / 60000), refreshing: Boolean(loading) } : { source: null, refreshing: Boolean(loading) };

async function searchCatalog(query, limit = 20) {
  const c = await getCatalog();
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return { results: [], catalogSize: c.items.size, complete: c.complete };
  const results = [];
  for (const item of c.items.values()) {
    const hay = `${item.name} ${item.brand} ${item.category} ${item.id}`.toLowerCase();
    if (terms.every((t) => hay.includes(t))) results.push({ id: item.id, name: item.name, brand: item.brand, category: item.category });
  }
  results.sort((a, b) => a.name.localeCompare(b.name));
  return { results: results.slice(0, limit), catalogSize: c.items.size, complete: c.complete };
}

/** Product details incl. option axis and positional option codes (o1..oN). */
async function getItem(id) {
  const d = await getJson(`/api/v2/items/${encodeURIComponent(id)}`);
  return {
    id: d.id,
    name: d.name,
    optionAxis: d.optionAxis || null,
    options: (d.options || []).map((o) => ({ code: o.id, label: o.label })),
    productUrl: `${STORE_BASE_URL}/item/${d.id}`,
  };
}

module.exports = { searchCatalog, getItem, getCatalog, catalogStatus };
