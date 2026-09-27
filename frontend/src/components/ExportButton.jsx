import { api } from '../api';

export default function ExportButton({ productId, label = 'Export CSV' }) {
  return (
    <a className="button" href={api.exportUrl(productId)} download>
      {label}
    </a>
  );
}
