// Throwaway Phase 0 recon script. Logs all network traffic while exploring the store.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '../backend/node_modules/playwright'));

const BASE = 'https://demo.inelabteamdev.com';
const log = [];

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
  const page = await browser.newPage();
  page.on('request', (r) => {
    if (r.resourceType() === 'fetch' || r.resourceType() === 'xhr' || r.resourceType() === 'document') {
      log.push({ t: Date.now(), kind: 'req', method: r.method(), url: r.url(), post: r.postData()?.slice(0, 1500) });
    }
  });
  page.on('response', async (r) => {
    const rt = r.request().resourceType();
    if (rt === 'fetch' || rt === 'xhr' || rt === 'document') {
      let body = null;
      try { body = (await r.text()).slice(0, 1500); } catch {}
      log.push({ t: Date.now(), kind: 'res', status: r.status(), url: r.url(), body: rt === 'document' ? null : body });
    }
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  fs.writeFileSync(path.join(__dirname, 'home-rendered.html'), await page.content());
  console.log('home url', page.url());

  // Try the search box
  const search = page.locator('input[type="search"], input[placeholder*="earch" i], input').first();
  if (await search.count()) {
    await search.click();
    await search.pressSequentially('trimmer', { delay: 80 });
    await page.waitForTimeout(2500);
    console.log('after search url', page.url());
  }

  // Click the first product link
  const links = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  console.log('links sample', links.slice(0, 40));
  fs.writeFileSync(path.join(__dirname, 'links.json'), JSON.stringify(links, null, 2));

  fs.writeFileSync(path.join(__dirname, 'recon-log.json'), JSON.stringify(log, null, 2));
  await browser.close();
})();
