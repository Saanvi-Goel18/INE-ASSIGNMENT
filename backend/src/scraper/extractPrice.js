/**
 * Price/stock extraction for the INE mock store's offer panel.
 *
 * Two halves:
 *  - extractOfferInfo(): runs INSIDE the page via page.evaluate(). Must be
 *    self-contained (no closures over Node variables). Reads the raw DOM state.
 *  - parsePrice()/parseStock(): pure Node functions that turn the raw text into
 *    numbers. Kept separate so they can be unit-tested without a browser.
 */

/**
 * @param {string|null} priceClass  the `classes.priceValue` value from the page's
 *   own /api/v2/ui/manifest response (null if we didn't capture it).
 */
function extractOfferInfo(priceClass) {
  const panel = document.querySelector('.offer-panel');
  if (!panel) {
    const alert = document.querySelector('.shelf-alert');
    return { state: alert ? 'page_error' : 'none', message: alert ? alert.textContent.trim() : null };
  }

  const cls = panel.className;
  const msg = (sel) => panel.querySelector(sel)?.textContent.trim() || null;

  if (cls.includes('offer-locked')) return { state: 'locked', message: msg('.offer-submsg') };
  if (cls.includes('offer-failed')) {
    return { state: 'failed', message: [msg('.offer-msg'), msg('.offer-submsg')].filter(Boolean).join(' — ') };
  }
  if (!cls.includes('offer-ready')) return { state: 'loading', message: msg('.offer-msg') };

  // An element counts as visible only if neither it nor any ancestor (up to the
  // panel) is display:none / visibility:hidden / aria-hidden. This is what kills
  // the two honeypot spans, whatever class names they end up with.
  const isVisible = (el) => {
    for (let n = el; n && n !== panel.parentElement; n = n.parentElement) {
      if (n.getAttribute('aria-hidden') === 'true') return false;
      const s = window.getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
    }
    return true;
  };
  const isStruck = (el) => (window.getComputedStyle(el).textDecorationLine || '').includes('line-through');
  const hasMoney = (t) => /(₹|rs\.?)/i.test(t) && /[0-9０-９]/.test(t);

  const row = panel.querySelector('.offer-row') || panel;
  const children = Array.from(row.children);

  // Visible, not struck-through, money-looking, and not one of the known
  // non-price labels ("Member price ₹X", "35% saving", "Refreshing prices").
  const candidates = children.filter(
    (el) =>
      isVisible(el) &&
      !isStruck(el) &&
      el.hasAttribute('data-price') === false &&
      hasMoney(el.textContent) &&
      !/member price|saving|refreshing/i.test(el.textContent)
  );

  let priceEl = null;
  let method = null;
  if (priceClass) {
    const byClass = children.find((el) => el.classList.contains(priceClass));
    if (byClass && candidates.includes(byClass)) {
      priceEl = byClass;
      method = 'manifest-class';
    }
  }
  if (!priceEl && candidates.length === 1) {
    priceEl = candidates[0];
    method = 'structural';
  }

  const mrpEl = children.find((el) => isVisible(el) && isStruck(el) && hasMoney(el.textContent));
  const stockEl = panel.querySelector('.avail-pill');
  const loaded = /Loaded in (\d+) attempt/i.exec(panel.textContent || '');

  return {
    state: 'ready',
    method,
    // Which of the elements we rely on were actually present (for change detection).
    structure: {
      offerRow: Boolean(panel.querySelector('.offer-row')),
      stockPill: Boolean(stockEl),
      priceClassFound: priceClass ? children.some((el) => el.classList.contains(priceClass)) : null,
    },
    candidateCount: candidates.length,
    priceText: priceEl ? priceEl.textContent : null,
    mrpText: mrpEl ? mrpEl.textContent : null,
    stockText: stockEl ? stockEl.textContent.trim() : null,
    soldOut: stockEl ? stockEl.classList.contains('avail-no') : null,
    pending: /refreshing prices/i.test(row.textContent || ''),
    pageAttempts: loaded ? Number(loaded[1]) : null,
  };
}

/** Strip zero-width chars / NBSP and fold full-width digits to ASCII. */
function normalizeText(raw) {
  return String(raw)
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/[   ]/g, ' ')
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xff10 + 48))
    .replace(/，/g, ',')
    .replace(/．/g, '.');
}

/**
 * Handles every format the store rotates through:
 *   ₹13,570 | ₹1,44,371 | ₹13 570 | ₹13.570,00 | ₹13,570/- (incl. of all taxes)
 *   ₹１３,５７０ | Rs. 13,570.00
 * Returns a number or null if the text doesn't look like exactly one price.
 */
function parsePrice(raw) {
  if (raw == null) return null;
  const text = normalizeText(raw);
  // Only look at what follows the currency marker, so "/- (incl. of all taxes)" etc. is ignored.
  const m = /(?:₹|rs\.?)\s*([0-9][0-9.,\s]*)/i.exec(text);
  if (!m) return null;
  // Whitespace is only ever grouping (spaced format) or padding (nbsp format), never a decimal mark.
  let num = m[1].replace(/\s+/g, '');
  let decimals = '';
  const dec = /[.,](\d{2})$/.exec(num); // "…,00" (euro) or "….00" (lakh style)
  if (dec) {
    decimals = dec[1];
    num = num.slice(0, -3);
  }
  // Remaining separators are thousands/lakh grouping in any style.
  if (!/^\d{1,3}([.,]?\d{2,3})*$/.test(num)) return null;
  const intPart = num.replace(/[.,]/g, '');
  if (!intPart) return null;
  const value = Number(decimals ? `${intPart}.${decimals}` : intPart);
  return Number.isFinite(value) ? value : null;
}

/** "Last few: 86" → 86, "Sold out" → 0, anything unrecognisable → null. */
function parseStock(raw, soldOut) {
  if (raw == null) return null;
  const text = normalizeText(raw);
  if (soldOut || /sold out|out of stock/i.test(text)) return 0;
  const nums = text.match(/\d+/g);
  if (!nums || nums.length !== 1) return null;
  return Number(nums[0]);
}

/**
 * Page-structure change detection. Given one ready-panel reading from extractOfferInfo()
 * and the price class from the store's layout manifest, list what didn't look the way the
 * scraper expects. An empty list means the primary (manifest-class) path worked cleanly.
 */
function layoutWarningsFor(info, priceClass) {
  if (!info || info.state !== 'ready') return [];
  const w = [];
  if (!priceClass) w.push('layout manifest (price class) not received');
  if (info.structure?.priceClassFound === false) w.push('no element with the manifest price class');
  if (info.structure && !info.structure.offerRow) w.push('.offer-row missing');
  if (info.structure && !info.structure.stockPill) w.push('stock pill (.avail-pill) missing');
  if (info.method === 'structural') w.push('price found by structural fallback');
  if (!info.method && !info.pending) w.push(`price element not identifiable (${info.candidateCount} candidates)`);
  return w;
}

module.exports = { extractOfferInfo, normalizeText, parsePrice, parseStock, layoutWarningsFor };
