# Product Price Tracker

Tracks the price and stock of chosen products (and a chosen option of each) on the INE mock store on a fixed schedule. Every scrape attempt is recorded as `success`, `retried` or `failed`, and the dashboard shows price history, a per-product scrape log and a CSV export.

| | |
|---|---|
| **Live site** | https://price-tracker-gamma-six.vercel.app |
| **Backend API** | https://price-tracker-api-nrxy.onrender.com (health check: `/health`) |
| **Target site** | https://demo.inelabteamdev.com (the only site this scrapes) |
| **Design note** | [DESIGN_NOTE.md](DESIGN_NOTE.md): reliability approach, trade-offs, AI tooling |

## How it works

```
cron-job.org ──(every 2 h, POST + secret header)──▶ Render: Express API ──▶ Playwright (headless Chromium) ──▶ mock store
                                                          │
                                                          ▼
Vercel: React dashboard ◀──── REST API ◀──── Supabase (Postgres): tracked_products, scrape_log
```

| Part | Stack | Hosting |
|---|---|---|
| `backend/` | Node 24, Express 5, Playwright (Chromium), Supabase JS client | Render free tier, Docker (official Playwright image) |
| `frontend/` | React + Vite + Recharts | Vercel |
| Database | Supabase (PostgreSQL) + one Supabase Storage file for the catalogue cache | Supabase free tier |
| Scheduler | cron-job.org calling `POST /api/scrape/run` | cron-job.org |

There is **no always-on loop**: the backend only scrapes when the scheduler calls `/api/scrape/run`. The endpoint replies `202` straight away and scrapes in the background, one product at a time, because a full run takes longer than cron-job.org's 30-second request timeout.

### Features
- **Product selection** – search the store's catalogue by partial name, brand or category, pick a product and one of its options, and start tracking it. The store has no search API, so the backend keeps its own copy of the catalogue (cached in Supabase Storage so search works immediately after a restart).
- **Scheduled scraping** – each run opens the product page in Chromium, handles the cookie modal, selects the option, satisfies the store's mouse-movement check, requests today's price and reads the real price and stock (ignoring the page's hidden and decoy prices).
- **Retries and honest outcomes** – up to 5 attempts per product. Result is `success` (first try), `retried` (needed more than one try, including the store page's own internal retries) or `failed` (price and stock left empty, error message stored). Failures are always saved and shown.
- **Price history & scrape log** – chart of price over time plus a table of every attempt with time, outcome, price, stock, attempts, layout status and error. Rows from runs triggered by hand are tagged "manual".
- **Dashboard** – a compact list of tracked products; each row shows current stock, the last scrape's outcome and time, and the latest price. Clicking a row opens its latest / lowest / highest price, outcome counts, chart and full log. If the most recent attempt failed, the last good price stays visible with a "last attempt failed at …" note.
- **CSV export** – one row per scrape attempt: `store_product_id,product_name,selected_option,timestamp,price,stock,outcome` (timestamps ISO 8601 UTC; failed rows have empty price and stock). "Export all" and each product's "↓ CSV" save files named with the download date and time, e.g. `scrape_history_2026-09-27_22-08.csv` / `scrape_history_2801_2026-09-27_22-08.csv`.
- **Page-structure change detection** *(bonus)* – each scrape records whether the price was found by the primary method or a fallback, and which expected page elements were missing; the dashboard shows a "Store layout changed" warning.
- **Price-change indicator** *(bonus, in-app alert)* – each product shows how its price moved since the previous successful reading: a green ▲ pill for a rise and a red ▼ pill for a drop, with the amount and percentage.
- **Scheduled vs manual runs** – every scrape records whether it was started by the schedule or by hand (`triggered_by`), so the history shows exactly which readings came from unattended runs.
- **CI** *(bonus)* – GitHub Actions runs the backend tests and the frontend build on every push.

## Scraping schedule

| Job (cron-job.org) | Schedule | Purpose |
|---|---|---|
| `POST /api/scrape/run?trigger=schedule` with header `x-cron-secret` | **every 2 hours** at :00 UTC | scrapes every tracked product once; rows are recorded as `schedule` |
| `GET /health` | every 10 minutes | keeps the free Render instance awake so the scrape call never hits a sleeping server |

Before submission the scrape ran **every 15 minutes** for several hours, purely to build up enough real history to show; it was then switched to the 2-hour production schedule. The scrape endpoint rejects calls without the correct secret (`401`), and a call made while a run is already in progress returns `409`. There is deliberately no "run now" button on the public dashboard, because it would need the secret in browser code; manual runs are made with the API call shown under **Try it** and are recorded as `manual`.

## Environment variables

### Backend (`backend/.env`, and the Render service's environment)

| Variable | Required | Example / default | What it is |
|---|---|---|---|
| `SUPABASE_URL` | yes | `https://xxxx.supabase.co` | Supabase project URL (a trailing `/rest/v1/` is tolerated) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | `sb_secret_…` | Supabase secret / service-role key (server-side only, never exposed to the browser) |
| `CRON_SECRET` | yes | any long random string | shared secret the scheduler sends in the `x-cron-secret` header |
| `PORT` | no | `3000` | port the API listens on (Render sets this itself) |
| `STORE_BASE_URL` | no | `https://demo.inelabteamdev.com` | the mock store |
| `HEADLESS` | no | `true` | set `false` to watch scheduled runs in a visible browser locally |

A template is in [`backend/.env.example`](backend/.env.example).

### Frontend (Vercel project settings, or `frontend/.env.local` for local development)

| Variable | Required | Example | What it is |
|---|---|---|---|
| `VITE_API_URL` | yes in production | `https://price-tracker-api-nrxy.onrender.com` | backend base URL (defaults to `http://localhost:3000`) |

## Setup

**Prerequisites:** Node.js 20+ (24 used), npm, a free Supabase project.

### 1. Database
In the Supabase SQL editor, run:

```sql
create table tracked_products (
  id uuid primary key default gen_random_uuid(),
  store_product_id text not null,
  product_name text not null,
  selected_option text not null,
  option_code text not null,
  product_url text not null,
  added_at timestamptz not null default now(),
  unique (store_product_id, option_code)
);

create table scrape_log (
  id uuid primary key default gen_random_uuid(),
  tracked_product_id uuid not null references tracked_products(id) on delete cascade,
  ts timestamptz not null default now(),
  price numeric,              -- NULL when the scrape failed
  stock int,                  -- units available, 0 = sold out; NULL when failed
  stock_text text,            -- the store's wording, e.g. "Last few: 86"
  outcome text not null check (outcome in ('success', 'retried', 'failed')),
  attempts int not null default 1,
  error text,                 -- reason, when failed
  extraction_method text,     -- change detection: 'manifest-class' (primary) or 'structural' (fallback)
  layout_warnings text[],     -- change detection: what looked different on the page
  triggered_by text check (triggered_by in ('schedule', 'manual'))  -- who started the run
);

create index on scrape_log (tracked_product_id, ts desc);
```

The catalogue cache (a private Storage bucket called `cache`) is created automatically on first use.

### 2. Backend
```bash
cd backend
npm install
npx playwright install chromium
cp .env.example .env          # then fill in the values
npm start                     # http://localhost:3000/health
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173 — uses http://localhost:3000 by default
```

### 4. Try it
Search for a product on the dashboard and start tracking it, then trigger a run by hand:
```bash
curl -X POST "http://localhost:3000/api/scrape/run?wait=1" -H "x-cron-secret: <your CRON_SECRET>"
```

## Watching the scraper (headed mode)

Run the exact scraper the backend uses against one product, in a visible browser, with every step printed:

```bash
cd backend
npm run scrape -- 2801 "Standard kit" --headed
npm run scrape -- 2801 "Standard kit" --headed --slowmo=150              # slowed down
npm run scrape -- 2100 "Pro Bundle" --headed --simulate-layout-change   # blocks the store's layout file to show the fallback + warning
```

Arguments are the store product ID (as in `/item/<id>`) and the option label exactly as shown on the product page. To watch scheduled runs of the local server in a browser, set `HEADLESS=false`.

## API

| Method & path | Description |
|---|---|
| `GET /health` | status, process start time, catalogue cache state |
| `GET /api/store/search?q=` | search the store catalogue by partial name / brand / category |
| `GET /api/store/items/:id` | a store product and its options |
| `GET /api/products` | tracked products |
| `POST /api/products` | start tracking — body `{ "store_product_id": "2801", "option_code": "o2" }`; name, option label and URL are looked up from the store; duplicates return `409` |
| `DELETE /api/products/:id` | stop tracking (deletes its history) |
| `GET /api/products/:id/history` | successful price readings, for the chart |
| `GET /api/products/:id/log` | every scrape attempt, newest first |
| `GET /api/export[?product=:id]` | CSV of all scrape attempts (or one product's) |
| `POST /api/scrape/run` | run a scrape of all tracked products — needs `x-cron-secret`; `?trigger=schedule` marks the rows as scheduled (otherwise `manual`); `?wait=1` waits for the result |
| `GET /api/scrape/status` | whether a run is in progress and the last run's summary — needs `x-cron-secret` |

## Deployment

- **Backend → Render:** web service from this repo, root directory `backend`, runtime **Docker** (`backend/Dockerfile` uses `mcr.microsoft.com/playwright`, which already contains Chromium and its system libraries), health check path `/health`. Set the backend environment variables above. See also [`render.yaml`](render.yaml).
- **Frontend → Vercel:** project root `frontend`, framework Vite, environment variable `VITE_API_URL` = the Render URL.
- **Scheduler → cron-job.org:** the two jobs in the schedule table above; the scrape job calls `…/api/scrape/run?trigger=schedule` with method `POST` and header `x-cron-secret: <CRON_SECRET>`.

Render and Vercel both redeploy automatically on every push to `main`.

## Tests

```bash
cd backend && npm test
```
Unit tests cover the price parser (every price format the store uses), the stock parser and the change-detection rules; two integration tests drive a real browser against the store and check that a failed scrape never carries a price or stock. The same tests and the frontend build run in GitHub Actions on every push ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Project structure

```
backend/
  src/
    server.js                 Express app, routes, /health
    routes/                   products, scrape (cron-protected), export (CSV), storeSearch
    scraper/
      scrapeProduct.js        one product: page load, option, gate, clicks, retries, outcome
      extractPrice.js         reads the offer panel inside the page; price/stock parsers; change-detection rules
      runAll.js               one scheduled run: every tracked product, sequentially, saved to scrape_log
    store/
      storeApi.js             store catalogue + product options over plain HTTP
      catalogCache.js         catalogue cache in Supabase Storage
    db/supabaseClient.js
    middleware/cronAuth.js    x-cron-secret check
  scripts/scrape-once.js      CLI / headed runner
  test/
  Dockerfile
frontend/
  src/
    App.jsx, api.js, format.js, index.css
    components/               ProductSearch, ProductCard, PriceChart, ScrapeLogTable, ExportButton
recon/                        scripts used to study the store before writing the scraper
.github/workflows/ci.yml
render.yaml
```
