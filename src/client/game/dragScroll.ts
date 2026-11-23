// Drag-to-scroll for overlays (end card, craft panel). Some in-app webviews never hand vertical swipes to the
// page (the game disables touch gestures), so the card scrolls itself: drag with a little
// momentum, and a drag never counts as a tap on a button underneath.
export function dragScroll(el: HTMLDivElement | null) {
  if (!el) return;
  let id: number | null = null;
  let startY = 0;
  let startTop = 0;
  let lastY = 0;
  let lastT = 0;
  let vel = 0;
  let dragging = false;
  let raf = 0;
  const down = (e: PointerEvent) => {
    cancelAnimationFrame(raf);
    id = e.pointerId;
    startY = lastY = e.clientY;
    startTop = el.scrollTop;
    lastT = performance.now();
    vel = 0;
    dragging = false;
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    const dy = e.clientY - startY;
    if (!dragging && Math.abs(dy) > 8) dragging = true;
    if (!dragging) return;
    el.scrollTop = startTop - dy;
    const now = performance.now();
    vel = (e.clientY - lastY) / Math.max(1, now - lastT);
    lastY = e.clientY;
    lastT = now;
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = null;
    if (!dragging) return;
    let v = vel * 16;
    const glide = () => {
      if (Math.abs(v) < 0.4) return;
      el.scrollTop -= v;
      v *= 0.94;
      raf = requestAnimationFrame(glide);
    };
    raf = requestAnimationFrame(glide);
  };
  // swallow the click that ends a drag so buttons under the finger don't fire
  const click = (e: MouseEvent) => {
    if (dragging) {
      e.preventDefault();
      e.stopPropagation();
      dragging = false;
    }
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('click', click, true);
  return () => {
    cancelAnimationFrame(raf);
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('click', click, true);
  };
}
