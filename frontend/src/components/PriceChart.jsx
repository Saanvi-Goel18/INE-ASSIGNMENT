import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatInr, formatTime } from '../format';

export default function PriceChart({ history }) {
  if (!history.length) return <p className="muted chart-empty">No successful price reads yet.</p>;
  const data = history.map((h) => ({ t: new Date(h.ts).getTime(), price: Number(h.price) }));
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            stroke="var(--muted)"
            fontSize={12}
          />
          <YAxis
            dataKey="price"
            domain={[(min) => Math.floor(min * 0.97), (max) => Math.ceil(max * 1.03)]}
            tickFormatter={(v) => `₹${(v / 1000).toFixed(1)}k`}
            stroke="var(--muted)"
            fontSize={12}
            width={52}
          />
          <Tooltip
            labelFormatter={(t) => formatTime(t)}
            formatter={(v) => [formatInr(v), 'Price']}
            contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)' }}
          />
          <Line type="linear" dataKey="price" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
