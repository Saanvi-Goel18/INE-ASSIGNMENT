import { useEffect, useState } from 'react';
import { api } from '../api';

export default function ProductSearch({ onAdded }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null); // store item with options
  const [optionCode, setOptionCode] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      api
        .searchStore(query)
        .then((r) => live && setResults(r.results))
        .catch((e) => live && setError(e.message))
        .finally(() => live && setSearching(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const pick = async (id) => {
    setError('');
    try {
      const item = await api.storeItem(id);
      setSelected(item);
      setOptionCode(item.options[0]?.code || '');
    } catch (e) {
      setError(e.message);
    }
  };

  const add = async () => {
    setAdding(true);
    setError('');
    try {
      await api.addProduct(selected.id, optionCode);
      setSelected(null);
      setQuery('');
      onAdded();
    } catch (e) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <section className="panel search">
      <h2>Track a product</h2>
      {!selected ? (
        <>
          <input
            type="search"
            placeholder="Search by name, brand or category, e.g. “camera zen”"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searching && <p className="muted">Searching…</p>}
          {results.length > 0 && (
            <ul className="results">
              {results.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => pick(r.id)}>
                    <strong>{r.name}</strong>
                    <span className="muted">
                      {r.category} · #{r.id}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!searching && query.trim().length >= 2 && results.length === 0 && <p className="muted">No matches.</p>}
        </>
      ) : (
        <div className="pick">
          <p>
            <strong>{selected.name}</strong> <span className="muted">#{selected.id}</span>
          </p>
          {selected.options.length > 0 && (
            <label>
              {selected.optionAxis || 'Option'}{' '}
              <select value={optionCode} onChange={(e) => setOptionCode(e.target.value)}>
                {selected.options.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="row">
            <button type="button" className="primary" onClick={add} disabled={adding}>
              {adding ? 'Adding…' : 'Start tracking'}
            </button>
            <button type="button" onClick={() => setSelected(null)}>
              Back
            </button>
          </div>
          <p className="muted small">The first price appears after the next scheduled scrape (every 15 min).</p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
