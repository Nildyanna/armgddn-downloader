// Page check for docs/BEST_PRACTICES.md (Nov 24 2026): the rules that need a drawn page (contrast, labels as drawn, click-only things).
// Run it before each release: npm run preview, open each scene (home, library, downloads, settings) in Harbor and Classic, and paste this
// into the browser console (or run it with the Chrome tool). It prints one line of JSON per page; anything above zero is a gap.
// It is plain code with nothing downloaded. Contrast is measured against the nearest solid background, so text over pictures is not judged.
(async () => {
await new Promise(r => setTimeout(r, 2500));
const vis = (e) => e.offsetParent !== null || e.getClientRects().length;
const name = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').trim();
const out = {};
out.lang = document.documentElement.getAttribute('lang') || '(none)';
out.imgNoAlt = [...document.images].filter((i) => vis(i) && !i.hasAttribute('alt')).length;
out.buttonsNoName = [...document.querySelectorAll('button')].filter((b) => vis(b) && !name(b)).length;
out.inputsNoLabel = [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter((i) => vis(i) && !i.getAttribute('aria-label') && !i.closest('label') && !(i.id && document.querySelector('label[for="' + i.id + '"]')) && !i.getAttribute('title')).map((i) => i.type + ':' + (i.placeholder || i.className)).slice(0, 8);
// Things you click that are not buttons or links, and cannot be reached with Tab.
const clickables = [...document.querySelectorAll('div,span,li,img,i,b')].filter((e) => vis(e) && (e.onclick || getComputedStyle(e).cursor === 'pointer') && !e.closest('button,a,label,summary,[tabindex]'));
out.clickNotKeyboard = clickables.length;
out.clickNotKeyboardSample = [...new Set(clickables.map((e) => e.tagName.toLowerCase() + '.' + String(e.className || '').split(' ')[0]))].slice(0, 12);
out.headings = [...document.querySelectorAll('h1,h2,h3,h4')].filter(vis).map((h) => h.tagName).join(' ');
out.landmarks = ['main', 'nav', 'header', '[role=navigation]', '[role=main]'].map((s) => s + ':' + document.querySelectorAll(s).length).join(' ');
out.tabsAreButtons = [...document.querySelectorAll('.tab')].filter(vis).map((t) => t.tagName.toLowerCase()).reduce((a, t) => (a[t] = (a[t] || 0) + 1, a), {});
out.smallText = [...document.querySelectorAll('body *')].filter((e) => vis(e) && e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 11).length;
// Contrast of visible text against the nearest solid background (rough: ignores pictures behind text).
const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const bgOf = (e) => { for (let x = e; x; x = x.parentElement) { const c = rgb(getComputedStyle(x).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.9)) return c; } return [13, 10, 18]; };
let low = [];
for (const e of document.querySelectorAll('body *')) {
  if (!vis(e) || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
  const cs = getComputedStyle(e); const fg = rgb(cs.color); if ((fg[3] ?? 1) < 0.5) continue;
  const L1 = lum(fg), L2 = lum(bgOf(e)); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  const big = parseFloat(cs.fontSize) >= 18.66 || (parseFloat(cs.fontSize) >= 14 && Number(cs.fontWeight) >= 700);
  if (ratio < (big ? 3 : 4.5)) low.push(e.tagName.toLowerCase() + '.' + String(e.className || '').split(' ')[0] + ' ' + ratio.toFixed(1) + ' "' + e.textContent.trim().slice(0, 24) + '"');
}
out.lowContrast = low.length; out.lowContrastSample = [...new Set(low)].slice(0, 10);
out.reducedMotionRules = [...document.styleSheets].reduce((n, s) => { try { return n + [...s.cssRules].filter((r) => r.media && /reduced-motion/.test(r.media.mediaText)).length; } catch (e) { return n; } }, 0);
out.domNodes = document.getElementsByTagName('*').length;
console.log(JSON.stringify(out));
return JSON.stringify(out);
})();
