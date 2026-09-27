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
  const [open, setOpen] = useState(false);

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
  // The log is newest-first; if the very last attempt failed, say so next to the last good price.
  const lastAttemptFailed = log[0]?.outcome === 'failed' ? log[0] : null;
  // Change detection: judge the most recent scrape that got far enough to read the page.
  const lastLayout = log.find((r) => r.extraction_method || r.layout_warnings?.length);
  const layoutChanged = Boolean(lastLayout?.layout_warnings?.length);
  const counts = log.reduce((acc, r) => ((acc[r.outcome] = (acc[r.outcome] || 0) + 1), acc), {});
  const prices = history.map((h) => Number(h.price));

  const remove = async () => {
    if (!window.confirm(`Stop tracking ${product.product_name} (${product.selected_option})? Its history will be deleted.`)) return;
    await api.removeProduct(product.id).catch((e) => setError(e.message));
    onRemoved();
  };

  return (
    <article className={`panel card ${open ? 'card-open' : 'card-closed'}`}>
      <header className="card-head">
        <button type="button" className="card-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="chevron" aria-hidden="true">
            ›
          </span>
          <span className="card-title">
            <h3>{product.product_name}</h3>
            <span className="card-meta">
              <span className="chip">{product.selected_option}</span>
              <span className="muted">#{product.store_product_id}</span>
            </span>
          </span>
          {!open && (
            <span className="card-summary">
              <span className="summary-price">
                <strong>{latest ? formatInr(latest.price) : '—'}</strong>
                {(lastAttemptFailed || layoutChanged) && (
                  <span className="summary-flags">
                    {lastAttemptFailed && <span className="flag flag-failed" title={`Last attempt failed at ${formatTime(lastAttemptFailed.ts)}`}>last attempt failed</span>}
                    {layoutChanged && <span className="flag flag-layout" title="Store layout changed">layout changed</span>}
                  </span>
                )}
              </span>
              <span className="pill-row">
                <span className="badge badge-success">{counts.success || 0}</span>
                <span className="badge badge-retried">{counts.retried || 0}</span>
                <span className="badge badge-failed">{counts.failed || 0}</span>
              </span>
            </span>
          )}
        </button>
        <div className="card-actions">
          <ExportButton productId={product.id} label="↓ CSV" />
          <button type="button" className="ghost" onClick={remove}>
            Remove
          </button>
        </div>
      </header>

      {open && (
        <>
          <p className="store-link">
            <a href={product.product_url} target="_blank" rel="noreferrer">
              View on store ↗
            </a>
          </p>
          {layoutChanged && (
        <div className="layout-alert" role="alert">
          <strong>⚠ Store layout changed</strong> — the last scrape ({formatTime(lastLayout.ts)}) had to use a fallback or found missing
          elements: {lastLayout.layout_warnings.join('; ')}. Prices are still being read, but the scraper's primary selector should be
          checked.
        </div>
      )}

      <div className="stats">
        <Stat
          tone="accent"
          label="Latest price"
          value={latest ? formatInr(latest.price) : '—'}
          sub={
            <>
              {latest ? formatTime(latest.ts) : ''}
              {lastAttemptFailed && <span className="last-failed">Last attempt failed at {formatTime(lastAttemptFailed.ts)}</span>}
            </>
          }
        />
        <Stat tone="low" label="Lowest" value={prices.length ? formatInr(Math.min(...prices)) : '—'} />
        <Stat tone="high" label="Highest" value={prices.length ? formatInr(Math.max(...prices)) : '—'} />
        <Stat
          tone="neutral"
          label="Scrapes"
          value={log.length}
          sub={
            <span className="pill-row">
              <span className="badge badge-success">{counts.success || 0} ok</span>
              <span className="badge badge-retried">{counts.retried || 0} retried</span>
              <span className="badge badge-failed">{counts.failed || 0} failed</span>
            </span>
          }
        />
      </div>

      <PriceChart history={history} />

      <button type="button" className="link" onClick={() => setShowLog((s) => !s)}>
        {showLog ? 'Hide' : 'Show'} scrape log ({log.length})
      </button>
      {showLog && <ScrapeLogTable rows={log} />}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </article>
  );
}

function Stat({ label, value, sub, tone = 'neutral' }) {
  return (
    <div className={`stat stat-${tone}`}>
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      {sub && <span className="small stat-sub">{sub}</span>}
    </div>
  );
}
