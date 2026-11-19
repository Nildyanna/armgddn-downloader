// A round "back to top" button for any long page that scrolls inside its own box (Admin, Settings, Tools, the library lists).
// It listens for scrolling anywhere in the window and appears once the scrolled box is well down; one click scrolls that box back up.
let box = null, btn = null;
function ensure() {
  if (btn) return btn;
  btn = document.createElement('button');
  btn.className = 'totop'; btn.type = 'button'; btn.hidden = true; btn.title = 'Back to top'; btn.setAttribute('aria-label', 'Back to top'); btn.textContent = '\u2191';
  btn.addEventListener('click', () => { if (box) box.scrollTo({ top: 0, behavior: 'smooth' }); });
  document.body.appendChild(btn);
  return btn;
}
document.addEventListener('scroll', (e) => {
  const t = e.target === document ? document.scrollingElement : e.target;
  if (!t || !t.scrollTop && t !== box) { if (t === box && btn) btn.hidden = true; return; }
  if (t.scrollHeight - t.clientHeight < 600) return;
  box = t;
  ensure().hidden = t.scrollTop < 500;
}, true);
