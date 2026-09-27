import { formatInr, formatTime } from '../format';

// Rows from before change detection existed (or that never reached the price panel) show "—".
function LayoutCell({ row }) {
  if (row.layout_warnings?.length) {
    return (
      <span className="badge badge-layout" title={row.layout_warnings.join('\n')}>
        ⚠ {row.extraction_method === 'structural' ? 'fallback' : 'changed'}
      </span>
    );
  }
  if (row.extraction_method) return <span className="muted small">ok</span>;
  return <span className="muted">—</span>;
}

// Failed rows are shown at full strength on purpose: failures must be visible, not hidden.
export default function ScrapeLogTable({ rows }) {
  if (!rows.length) return <p className="muted">No scrapes yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Outcome</th>
            <th className="num">Price</th>
            <th>Stock</th>
            <th className="num">Attempts</th>
            <th>Layout</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`row-${r.outcome}`}>
              <td>
                {formatTime(r.ts)}
                {r.triggered_by === 'manual' && (
                  <span className="trigger-tag" title="Run triggered by hand, not by the schedule">
                    manual
                  </span>
                )}
              </td>
              <td>
                <span className={`badge badge-${r.outcome}`}>{r.outcome}</span>
              </td>
              <td className="num">{r.price == null ? '—' : formatInr(r.price)}</td>
              <td>{r.stock == null ? '—' : r.stock === 0 ? 'Sold out' : `${r.stock} units`}</td>
              <td className="num">{r.attempts}</td>
              <td>
                <LayoutCell row={r} />
              </td>
              <td className="err-cell">{r.error || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
