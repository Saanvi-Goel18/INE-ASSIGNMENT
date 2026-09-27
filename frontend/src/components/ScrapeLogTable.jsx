import { formatInr, formatTime } from '../format';

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
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`row-${r.outcome}`}>
              <td>{formatTime(r.ts)}</td>
              <td>
                <span className={`badge badge-${r.outcome}`}>{r.outcome}</span>
              </td>
              <td className="num">{r.price == null ? '—' : formatInr(r.price)}</td>
              <td>{r.stock == null ? '—' : r.stock === 0 ? 'Sold out' : `${r.stock} units`}</td>
              <td className="num">{r.attempts}</td>
              <td className="err-cell">{r.error || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
