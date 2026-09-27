# PROGRESS — Product Price Tracker

Running log written during execution of `PRICE_TRACKER_PLAN.md`. Newest entries at the bottom of each phase.

## Setup (2026-09-27)
- Tooling found: Node v24.13.1, npm 11.15, git 2.50, Python 3.11. **Not installed:** `gh`, `ffmpeg`, `vercel` CLI.
- Created `backend/` with `src/{routes,scraper,db,middleware}`; installed `playwright express cors dotenv @supabase/supabase-js`; installed Playwright Chromium.

## Phase 0 — Recon
Scripts: `recon/recon.js` (homepage + network log), `recon/recon2.js` (product pages, option clicks, check-price clicks → `recon/recon-log.json`, `recon/recon-dom.html`), `recon/catalog.js` (listing pagination test). I also downloaded and grepped the store's JS bundle (`recon/bundle.js`), which answered most questions faster and more precisely than click-testing alone.

### Plan corrections (the plan was wrong or incomplete on these)
1. **Product URL is `/item/{id}`, not `/products/{id}`.** Router in the bundle defines `path:"/item/:id"`; `page.goto('/item/2138')` renders the product. (My click-through test on the listing's "Open item →" button stayed on `/` — see #6, clicks can be silently dropped.)
2. **The store has NO search box and the listings API has NO search param.** Tried `q, search, query, name, term, keyword` — all ignored (count stays 960). So "search by partial name" must be implemented on our side over a cached catalog.
3. **The listings endpoint returns a *different random order on every request*** (and caps `limit` at 60). Paging p=1..16 once yielded only ~600/960 unique IDs, and some pages returned 503. → Catalog is built by sweeping pages repeatedly until the unique count equals the API's reported `count` (960).
4. **Option codes are available via plain HTTP**: `GET /api/v2/items/{id}` returns `optionAxis` (e.g. "Kit") and `options: [{id:"o1",label:"Body only"}, …]`. Codes are positional per product (o1..oN) but labels differ per product (Single/Duo pack/Travel set, Starter/Regular/Advanced/Elite …). No need to scrape these with a browser.
5. **The default-selected option is RANDOM on each page load** (`useState(() => options[random].id)`), so the scraper must always click the target option and verify `aria-pressed="true"`.
6. **Click handlers are sabotaged**: the check-price handler is wrapped so that ~17.5% of clicks are silently ignored and ~17.5% are delayed 900 ms. → After clicking, the scraper waits for the panel to actually change state and re-clicks if it didn't.
7. **Cookie-consent modal** appears on ~75% of loads after a random 1.5–5 s delay, at a random position, and needs 1–3 clicks to dismiss. It intercepts pointer events (my first recon run timed out on it). → `page.addLocatorHandler('.consent-scrim', …)` clicks "Reject cookies" until it is gone, whenever it shows up.
8. **Mouse telemetry gate**: the "Check today's price" button is *disabled* until ≥8 mouse moves (sampled ≥40 ms apart) and ≥600 ms dwell over the offer panel. → Scraper hovers and moves the mouse over the panel before clicking.
9. **Errors are layered**: handshake 401 (`challenge_failed`, ~15% in recon: 8/52), quote 503 `upstream_error` and 500. The page itself retries retryable errors up to 6 times ("Loaded in N attempts"); non-retryable ones show "Couldn't load the price after N attempts" + a **Retry** button (not "Check Again" — plan's button regex needed `retry` added).
10. **Quote response is an encrypted `blob`** (`{itemId, option, ver, blob, ts}`), so reading the price from the network is not practical — the DOM really is the source of truth. This confirms the plan's choice of Playwright over raw HTTP for the price.
11. **"Refreshing prices" is NOT a loading spinner** — it is rendered *alongside* a price when the quote is `pending`, with the price at 45% opacity, and that price is stale (seen: ₹82,141 while pending vs ₹79,231 on a clean read of the same option). The plan said "wait for it to disappear"; it doesn't disappear on its own — you must click "Check again". → Pending reads are treated as a failed attempt, never stored.
12. **More decoys than the plan listed** (from the render code):
    - two hidden honeypots (`.price-value` aria-hidden, `.amount[data-price]`) — values are the real price × random 0.6–1.3, as the plan said;
    - struck-through MRP (visible, `line-through`);
    - a visible **"Member price ₹X"** span on some loads — visible, not struck through, has ₹ → the plan's filter would have picked it if it came first;
    - "NN% saving" badge.
13. **The real price node is obfuscated** via `/api/v2/ui/manifest`: its class is a rotating hash (`nvo-c5` + random `v…`), its tag is `div` or `span`, and with `priceCarrier:"split"` **every character is its own `<span>` separated by zero-width spaces** — so the plan's "leaf nodes only" filter would never match the real price. Formats rotate too: `₹13,570`, `₹13 570`, `₹13.570,00` (euro), `₹13,570/- (incl. of all taxes)`, full-width unicode digits `₹１３,５７０`, NBSP+ZWSP between every char, and `Rs. 13,570.00`.
    → Extraction: capture the page's own manifest response to get the exact `priceValue` class; fall back to a structural filter (visible child of `.offer-row`, not hidden/struck/"Member price"/"saving"). Text is normalized (strip ZWSP/NBSP, full-width→ASCII) before a format-aware parser. Sanity check: price must be > 0 and ≤ the MRP on the same panel.
14. Stock pill is `.avail-pill` (`avail-yes`/`avail-no`) as the plan said, but the wording rotates across 5 templates ("50 units available", "Last few: 86", "Available (x)", "Stock: x remaining", "Ready to ship · x available") or "Sold out". → Stored as an integer unit count (0 = sold out) plus the raw text.


## Phase 1 — Scraper in isolation
- `src/scraper/extractPrice.js` (normalize + format-aware parser + in-page offer-panel extractor) and `src/scraper/scrapeProduct.js` (retry loop, consent handler, telemetry hover, dropped-click detection). CLI: `node scripts/scrape-once.js <id> "<option>" [--headed]`.
- Unit tests `test/extractPrice.test.js`: 4/4 pass (fixed: whitespace inside numbers is grouping/padding, never a decimal mark).
- Live runs on 2801 "Standard kit": 3 parallel runs → 1 clean success, 2 recovered after two handshake 401 `challenge_failed` each (outcome `retried`, 3 attempts). All returned ₹79,231 / 30 units. 401 rate is bursty (seen 3-in-a-row earlier), so MAX_ATTEMPTS=5 is kept.
- Parallel runs (6 at once) got the whole IP rate limited (upstream 429) → scrapes must stay sequential; 429 now backs off 5 s × attempt.
- 2096 "256 GB" failed with 4 consecutive 401s on one page load. Fix: after `challenge_failed` reload the page (fresh telemetry), and hover with a jittered, wandering path instead of a fixed pattern.
- After the fix, 5/5 sequential runs succeeded (2096 256 GB ₹75,820 · 2096 64 GB ₹52,225 · 2100 Pro Bundle ₹68,479 · 2002 Body only ₹1,49,975 Sold out · 2801 Standard kit ₹86,483), 4 of them recovering from 401s. Prices do move between runs (2801: 79,231 → 86,483).
- Phase 1 total: 14 live runs across 4 products, many observed 401→retry cycles. Headed run still to do.
- Next: Phase 2 (Supabase + routes) — needs Supabase URL/key from the human.

## Phase 2 — Supabase + backend
- Schema deviations from Section 2 (because of recon): `scrape_log.stock` is `int` (0 = sold out) plus `stock_text` for the raw wording; added `scrape_log.error`; `unique (store_product_id, option_code)` on `tracked_products`.
- Supabase URL in the dashboard was pasted with `/rest/v1/` suffix → stripped; the client also tolerates it. Key is the new `sb_secret_…` format — works with supabase-js.
- Routes: `GET/POST/DELETE /api/products`, `/:id/history` (chart, successful reads only), `/:id/log` (all rows incl. failures), `GET /api/export[?product=]` CSV, `GET /api/store/search?q=` + `/api/store/items/:id`, `POST /api/scrape/run` (x-cron-secret, timing-safe compare) + `GET /api/scrape/status`.
- Deviations: `POST /api/products` takes only `{store_product_id, option_code}` and looks up name/label/URL from the store API (no mismatched pairs). `/api/scrape/run` returns 202 immediately and scrapes in the background (cron-job.org times out at 30 s; a run takes ~15 s/product); a second call during a run gets 409. `?wait=1` blocks for manual tests. One shared browser per run, products scraped sequentially with a 3 s pause.
- Search: store has no search API, so `src/store/storeApi.js` caches the whole catalog (repeated sweeps until 960/960 unique) for 6 h and searches name/brand/category locally.
- Tracked: 2801 Standard kit (o2), 2096 256 GB (o3), 2100 Pro Bundle (o3). First full run via the API: 3/3 prices stored (all `retried` after one 401 each), CSV export verified.
- Prices really move over time on the store (2100 Pro Bundle: 68,479 → 86,244 within ~15 min; 3 back-to-back re-reads all 86,244 via the manifest class), so this is genuine price movement, not a decoy read.
- Next: Phase 3 — push to GitHub, deploy to Render, cron-job.org every 15–20 min.

## Phase 3 — Deploy + cron
- Repo: https://github.com/Saanvi-Goel18/INE-ASSIGNMENT (pushed; `.env`, PDFs, plan file and downloaded store HTML/bundle are git-ignored).
- Render (created via API, free plan, Singapore, Docker): **https://price-tracker-api-nrxy.onrender.com** — uses the official `mcr.microsoft.com/playwright:v1.63.0-noble` image because Render's native Node runtime has no Chromium system libs. Auto-deploys on push to `main`.
- `npm test` script fixed (`node --test test/` fails on Node 24; plain `node --test` auto-discovers). 6/6 pass.
- First scrape on Render (~3 min for 3 products, fits in free-tier memory): 2 `success`, 1 `failed` — 5 consecutive "Refreshing prices" (pending) quotes, correctly not stored. Fix: a pending quote now also triggers a fresh page load, same as a 401.
- Next: cron-job.org schedule.
- cron-job.org job 8521978 (created via its REST API): `POST /api/scrape/run` with `x-cron-secret`, minutes 0/15/30/45 UTC, 30 s timeout. **Verified unattended:** 08:00 run → HTTP 202, 3 new `scrape_log` rows at 08:02 (2801 retried ₹1,16,757 · 2096 success ₹1,10,245 · 2100 success ₹70,210).
- Interval is 15 min (not the 2 h production spec) purely to accumulate history before submission — to be disclosed in the design note.

## Phase 4 — Frontend
- `frontend/` React + Vite + Recharts: search (debounced, against `/api/store/search`) → pick option → track; per-product card with latest/low/high, success/retried/failed counts, price chart, full scrape log (failed rows highlighted in red with the error, not hidden), per-product and global CSV export. Auto-refreshes every 60 s. Light/dark via `prefers-color-scheme`.
- **Deviation:** hosted on a Render static site (https://price-tracker-p4ml.onrender.com) instead of Vercel — the Render API key was already available, so no extra account/token needed. `VITE_API_URL` points at the backend.
- Found while testing: `/api/store/search` on Render returned 429 — the catalog sweep fired requests back-to-back (and overlapped a cron scrape on the same IP). Fix: 300 ms between pages, 3 s×n backoff on 429, a failed first page no longer aborts the load, and a partial catalog is served (and re-fetched after 5 min) instead of an error.
- Chart Y axis padded ±3 % so a single point doesn't render five identical "₹103k" ticks.
- **Moved to Vercel** (the brief names it): project `price-tracker` created via the Vercel API, root `frontend/`, linked to the GitHub repo (auto-deploys on push), `VITE_API_URL` set. Live: **https://price-tracker-gamma-six.vercel.app**. Verified search ("tablet go" → 8 results) and cards render from live data. The temporary Render static site was deleted.
- Chart line changed from `monotone` to `linear`: the smoothed curve overshot between samples, implying prices we never observed.
