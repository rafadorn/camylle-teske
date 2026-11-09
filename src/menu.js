// A single background follows mouse and keyboard focus. Covers remain static.
const nav = document.querySelector('.site-header nav');
if (nav) {
  const highlight = nav.querySelector('.nav-highlight');
  let hovered = null, focused = null;
  function sync(instant = false) {
    const link = hovered || focused || nav.querySelector('[aria-current="page"]');
    if (!link) { highlight.style.opacity = '0'; return; }
    const rect = link.getBoundingClientRect(), parent = nav.getBoundingClientRect();
    highlight.style.width = `${rect.width + 24}px`;
    highlight.style.height = `${rect.height}px`;
    highlight.style.transform = `translate(${rect.left - parent.left - 12}px,${rect.top - parent.top}px)`;
    highlight.style.opacity = '1';
    if (instant) for (const animation of highlight.getAnimations()) animation.finish();
  }
  for (const link of nav.querySelectorAll('a')) {
    link.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') { hovered = link; sync(); } });
    link.addEventListener('pointerleave', () => { hovered = null; sync(); });
  }
  nav.addEventListener('focusin', event => { focused = event.target.closest('a'); sync(); });
  nav.addEventListener('focusout', event => { focused = nav.contains(event.relatedTarget) ? event.relatedTarget.closest('a') : null; sync(); });
  new ResizeObserver(() => sync(true)).observe(nav);
  document.fonts.ready.then(() => sync(true));
  sync(true);
}
