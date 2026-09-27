// Phase 0 recon, part 2: product pages, option buttons, check-price clicks, network log.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '../backend/node_modules/playwright'));

const BASE = 'https://demo.inelabteamdev.com';
const IDS = (process.argv[2] || '2138,2590,2801').split(',');
const log = [];
const doms = [];

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
  const page = await browser.newPage();
  page.on('request', (r) => {
    const rt = r.resourceType();
    if (rt === 'fetch' || rt === 'xhr') log.push({ t: Date.now(), kind: 'req', method: r.method(), url: r.url(), post: r.postData()?.slice(0, 800) });
  });
  page.on('response', async (r) => {
    const rt = r.request().resourceType();
    if (rt === 'fetch' || rt === 'xhr') {
      let body = null;
      try { body = (await r.text()).slice(0, 1500); } catch {}
      log.push({ t: Date.now(), kind: 'res', status: r.status(), url: r.url(), body });
    }
  });

  await page.addLocatorHandler(page.locator('.consent-scrim'), async () => {
    for (let i = 0; i < 5 && (await page.locator('.consent-scrim').count()); i++) {
      await page.getByRole('button', { name: 'Reject cookies' }).click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(200);
    }
    log.push({ t: Date.now(), kind: 'note', msg: 'dismissed consent' });
  });

  // Click through from the listing to confirm URL pattern.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('button.card-open').first().click();
  await page.waitForLoadState('networkidle');
  console.log('clicked-through URL:', page.url());

  for (const id of IDS) {
    await page.goto(`${BASE}/item/${id}`, { waitUntil: 'networkidle' });
    const opts = await page.locator('.opt-picker button').evaluateAll((bs) => bs.map((b) => ({ text: b.textContent, pressed: b.getAttribute('aria-pressed'), attrs: [...b.attributes].map((a) => `${a.name}=${a.value}`) })));
    console.log(id, 'options:', JSON.stringify(opts));
    doms.push(`<!-- ${id} initial -->\n` + (await page.locator('.pdp').first().evaluate((e) => e.outerHTML).catch(() => 'no .pdp')));

    const optButtons = page.locator('.opt-picker button');
    const n = await optButtons.count();
    for (let i = 0; i < Math.max(n, 1); i++) {
      if (n) await optButtons.nth(i).click();
      // move the mouse over the panel so the telemetry has something
      const panel = page.locator('.offer-panel');
      const box = await panel.boundingBox();
      if (box) for (let k = 0; k < 12; k++) await page.mouse.move(box.x + 10 + k * 15, box.y + 10 + (k % 3) * 8, { steps: 3 });
      await page.waitForTimeout(700);
      for (let c = 0; c < 3; c++) {
        const btn = page.getByRole('button', { name: /check (today.s price|again)|retry/i });
        const label = await btn.first().textContent().catch(() => null);
        log.push({ t: Date.now(), kind: 'note', msg: `${id} opt#${i} click ${c} on "${label}"` });
        await btn.first().click().catch((e) => console.log('click err', e.message));
        await page.waitForTimeout(6000);
        const panelHtml = await panel.first().evaluate((e) => e.outerHTML).catch(() => 'no panel');
        doms.push(`<!-- ${id} opt#${i} click ${c} -->\n${panelHtml}`);
        console.log(id, i, c, (await panel.first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 250));
      }
    }
  }

  fs.writeFileSync(path.join(__dirname, 'recon-log.json'), JSON.stringify(log, null, 2));
  fs.writeFileSync(path.join(__dirname, 'recon-dom.html'), doms.join('\n\n'));
  await browser.close();
})();
