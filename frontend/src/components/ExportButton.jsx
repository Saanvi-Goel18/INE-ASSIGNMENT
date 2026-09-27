import { api } from '../api';

// File name carries the download date and time (viewer's local time), e.g.
// scrape_history_2026-09-27_21-45.csv or scrape_history_2801_2026-09-27_21-45.csv.
function fileName(tag) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  return `scrape_history${tag ? `_${tag}` : ''}_${stamp}.csv`;
}

export default function ExportButton({ productId, fileTag, label = 'Export CSV' }) {
  const url = api.exportUrl(productId);
  // The API is on another origin, where the download attribute's name is ignored, so fetch
  // the CSV and save it under our own name. The href stays as a plain-link fallback.
  const download = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      const blobUrl = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName(fileTag);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch {
      window.location.href = url;
    }
  };
  return (
    <a className="button" href={url} onClick={download}>
      {label}
    </a>
  );
}
