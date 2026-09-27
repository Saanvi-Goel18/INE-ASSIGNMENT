import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatInr, formatTime } from '../format';
import PriceChart from './PriceChart';
import ScrapeLogTable from './ScrapeLogTable';
import ExportButton from './ExportButton';

export default function ProductCard({ product, refreshKey, onRemoved }) {
  const [history, setHistory] = useState([]);
  const [log, setLog] = useState([]);
  const [error, setError] = useState('');
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([api.history(product.id), api.log(product.id)])
      .then(([h, l]) => {
        if (!live) return;
        setHistory(h);
        setLog(l);
        setError('');
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [product.id, refreshKey]);

  const latest = history[history.length - 1];
  const counts = log.reduce((acc, r) => ((acc[r.outcome] = (acc[r.outcome] || 0) + 1), acc), {});
  const prices = history.map((h) => Number(h.price));

  const remove = async () => {
    if (!window.confirm(`Stop tracking ${product.product_name} (${product.selected_option})? Its history will be deleted.`)) return;
    await api.removeProduct(product.id).catch((e) => setError(e.message));
    onRemoved();
  };

  return (
    <article className="panel card">
      <header className="card-head">
        <div>
          <h3>
            <a href={product.product_url} target="_blank" rel="noreferrer">
              {product.product_name}
            </a>
          </h3>
          <p className="muted">
            {product.selected_option} · #{product.store_product_id}
          </p>
        </div>
        <div className="card-actions">
          <ExportButton productId={product.id} label="CSV" />
          <button type="button" className="ghost" onClick={remove}>
            Remove
          </button>
        </div>
      </header>

      <div className="stats">
        <Stat label="Latest price" value={latest ? formatInr(latest.price) : '—'} sub={latest ? formatTime(latest.ts) : ''} />
        <Stat label="Lowest" value={prices.length ? formatInr(Math.min(...prices)) : '—'} />
        <Stat label="Highest" value={prices.length ? formatInr(Math.max(...prices)) : '—'} />
        <Stat
          label="Scrapes"
          value={log.length}
          sub={
            <>
              <span className="ok">{counts.success || 0} ok</span> · <span className="warn">{counts.retried || 0} retried</span> ·{' '}
              <span className="bad">{counts.failed || 0} failed</span>
            </>
          }
        />
      </div>

      <PriceChart history={history} />

      <button type="button" className="link" onClick={() => setShowLog((s) => !s)}>
        {showLog ? 'Hide' : 'Show'} scrape log ({log.length})
      </button>
      {showLog && <ScrapeLogTable rows={log} />}
      {error && <p className="error">{error}</p>}
    </article>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
      {sub && <span className="small">{sub}</span>}
    </div>
  );
}
