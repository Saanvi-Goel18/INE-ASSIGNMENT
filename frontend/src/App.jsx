import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import ProductSearch from './components/ProductSearch';
import ProductCard from './components/ProductCard';
import ExportButton from './components/ExportButton';

const REFRESH_MS = 60_000;

export default function App() {
  const [products, setProducts] = useState(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(() => {
    api
      .listProducts()
      .then((p) => {
        setProducts(p);
        setError('');
      })
      .catch((e) => setError(`Couldn't reach the backend: ${e.message}`));
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  return (
    <main>
      <header className="top">
        <div>
          <h1>Price Tracker</h1>
          <p className="muted">Prices are scraped every 15 minutes. Failed scrapes are kept and shown.</p>
        </div>
        <ExportButton label="Export all (CSV)" />
      </header>

      <ProductSearch onAdded={load} />

      {error && <p className="error">{error}</p>}
      {products === null && !error && <p className="muted">Loading… (the free backend can take ~1 min to wake up)</p>}
      {products?.length === 0 && <p className="muted">Nothing tracked yet. Search for a product above.</p>}

      <div className="cards">
        {products?.map((p) => (
          <ProductCard key={p.id} product={p} refreshKey={refreshKey} onRemoved={load} />
        ))}
      </div>
    </main>
  );
}
