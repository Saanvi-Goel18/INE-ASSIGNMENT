# Design Note — Product Price Tracker

## 1. Making the scraping reliable

The mock store is built to break naive scrapers, so I studied it first (the scripts are in `recon/`): I recorded its network traffic, clicked through product pages, and read its JavaScript bundle. What I found decided the design:

- **The price is only trustworthy in the rendered page.** The price API returns an encrypted blob, and it is gated by a handshake that needs a WebAssembly proof-of-work plus mouse-movement telemetry. So I used **Playwright (real Chromium)** and read the price from the DOM, rather than calling the API directly.
- **The page fights back, so each obstacle has a specific counter-measure:**
  - A cookie modal appears at random times and blocks clicks → a Playwright locator handler dismisses it whenever it shows up.
  - The selected option is random on every load → the scraper clicks the wanted option and confirms `aria-pressed="true"`.
  - The "Check today's price" button stays disabled until there is enough mouse movement over the price panel → the scraper moves the mouse over the panel on a jittered, wandering path.
  - About 1 in 6 clicks is silently dropped → after each click it checks that the panel actually reacted, and clicks again if not.
- **Finding the real price.** The panel contains hidden honeypot prices, a struck-through MRP, a "Member price", a savings badge, and the real price, which has a rotating class name and is sometimes split into one `<span>` per character. The page downloads a small layout manifest that names the real price's class; the scraper reads the same manifest and uses that class (**primary method**). If that isn't possible it falls back to a structural rule: the single visible, non-struck money value that isn't a member price or badge. The text is normalised (zero-width spaces, non-breaking spaces, full-width digits) and parsed across all seven price formats the store rotates through. As a sanity check, the price must be positive and no higher than the MRP.
- **Errors and retries.** The store answers with random `401` handshake failures, `503`/`500` upstream errors and `429` rate limits. Each scrape gets up to **5 attempts**. After a `401`, it reloads the page, because retrying on the same page kept failing. It backs off harder on `429`. A price shown with "Refreshing prices" is stale, so it is **never stored**; it counts as a failed attempt.
- **Honest outcomes.** `success` = right first time; `retried` = needed more than one attempt (including the store page's own internal retries); `failed` = gave up, with **price and stock left empty** and the reason saved. Every attempt is written to the log and shown on the dashboard, and each row records whether it came from the schedule or a manual run. If the latest attempt failed, the dashboard keeps showing the last good price but says so next to it.
- **Running unattended.** cron-job.org calls the backend every 2 hours. The endpoint replies at once and scrapes in the background, one product at a time. A second cron job pings `/health` every 10 minutes so the free Render instance is never asleep when a scrape is due. The store catalogue used for search is cached in Supabase, so a restart doesn't need a 1–3 minute re-download.
- **Knowing when it's about to break.** Every scrape records whether the primary method or the fallback found the price, and which expected elements were missing. The dashboard then shows a "Store layout changed" warning while prices are still being read correctly, instead of the problem only appearing once scrapes start failing.

## 2. Trade-offs

- **A real browser instead of HTTP requests.** Slower and heavier (about 10–20 s per product, and it needs a Docker image with Chromium), but it is the only approach that works against this store's defences.
- **One product at a time.** Running scrapes in parallel got the whole IP rate-limited, so runs are sequential with a short pause. A run's length grows with the number of products, which is fine at this scale.
- **Answer the scheduler immediately and scrape in the background.** Needed because of the scheduler's 30 s timeout. The scheduler can't see the result, so results are checked through the database, the dashboard and `/api/scrape/status`.
- **A gap instead of a wrong number.** A failed or stale reading is stored as empty, never as the last known price, so the history has honest gaps.
- **Fallback extraction keeps the data but raises a flag,** instead of failing hard when the layout changes.
- **Schedule.** Production is every 2 hours, as the brief specifies. Before submission I ran it every 15 minutes for several hours, only to collect enough history to show, then switched back.
- **No "run now" button on the public dashboard.** Starting a scrape needs the secret, which can't be put in browser code. Manual runs go through the API and are labelled `manual` in the history.
- **Free-tier limits.** The keep-alive ping uses the free instance hours to avoid cold starts. The catalogue cache is a Storage file rather than a table, which avoided a manual schema change.

## 3. AI tools: what they got wrong first, and the fix

I used Claude Code as an AI coding assistant during development. Things it got wrong on the first attempt, and how they were corrected:

1. **Wrong assumptions about the store.** It first assumed product pages at `/products/{id}`, a search parameter on the listings API, and a real price that is a single leaf element. Recon showed the URL is `/item/{id}`, there is no search API (so search runs on a cached copy of the catalogue), and the real price is often split into one span per character.
2. **"Refreshing prices" was misread** as a loading message to wait out. It is actually a stale price that never goes away by itself, so such readings are rejected instead of stored.
3. **A price parser bug** returned nothing for the non-breaking-space price format. A unit test covering every format caught it.
4. **Parallel test runs got the IP rate-limited (429)**, which led to sequential scraping with back-off.
5. **Retrying on the same page after a 401 kept failing** (four in a row on one product). The fix was to reload for fresh telemetry and make the mouse path less regular.
6. **The first CSV export didn't match the brief** (11 columns, `+00:00` timestamps). It now has exactly the 7 required fields, `…Z` UTC timestamps and empty cells for failed rows.
7. **Retry counts were inconsistent** (`retried` rows showing 1 attempt), because the store page's internal retries weren't counted.
8. **A misleading performance measurement:** the first cold-start timing hit Render's old warm instance. `/health` now reports when the process started; the real numbers were 51–208 s before the catalogue cache and 0.6 s after.

Each fix was re-checked on the live deployment.
