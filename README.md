# Product Price Tracker

Tracks price and stock of products on the demo store on a schedule, records every scrape attempt (success / retried / failed), and shows history, a scrape log and a CSV export.

- **Live site:** https://price-tracker-gamma-six.vercel.app
- **Backend API:** https://price-tracker-api-nrxy.onrender.com (`/health`)

| Part | Stack | Hosting |
|---|---|---|
| `backend/` | Node + Express, Playwright (Chromium), Supabase (Postgres) | Render (Docker, Playwright image) |
| `frontend/` | React + Vite + Recharts | Vercel |
| Scheduler | cron-job.org → `POST /api/scrape/run` with `x-cron-secret` | every 15 min |

Full README and design note coming soon.
