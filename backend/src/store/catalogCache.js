// Persists the swept store catalog in Supabase Storage so a cold start (deploy, or a
// free-tier sleep/wake) can serve search immediately instead of re-sweeping for 1-3 min.
const supabase = require('../db/supabaseClient');

const BUCKET = 'cache';
const FILE = 'store-catalog.json';

async function ensureBucket() {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
}

/** Returns { items: Map, savedAt, expected } or null if nothing usable is stored. */
async function readCatalogCache() {
  const { data, error } = await supabase.storage.from(BUCKET).download(FILE);
  if (error || !data) return null;
  const parsed = JSON.parse(await data.text());
  if (!Array.isArray(parsed.items) || !parsed.items.length) return null;
  return { items: new Map(parsed.items.map((x) => [x.id, x])), savedAt: parsed.savedAt, expected: parsed.expected };
}

/** Only complete catalogs are written, so a partial sweep never replaces a good cache. */
async function writeCatalogCache(catalog) {
  await ensureBucket();
  const body = JSON.stringify({
    savedAt: catalog.loadedAt,
    expected: catalog.expected,
    items: [...catalog.items.values()].map(({ id, name, brand, category }) => ({ id, name, brand, category })),
  });
  const { error } = await supabase.storage.from(BUCKET).upload(FILE, body, { contentType: 'application/json', upsert: true });
  if (error) throw error;
}

module.exports = { readCatalogCache, writeCatalogCache };
