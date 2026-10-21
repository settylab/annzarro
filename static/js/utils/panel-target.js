/**
 * Which panel a single-key shortcut (close, split, toggle controls) acts on.
 *
 * The panel under the mouse pointer; failing that the panel holding the keyboard
 * focus; failing that the panel whose centre is nearest the centre of the viewport
 * (in x and y, so in a row of panels it is not always the first).
 */
const TILE = '.tile:not(.tile-selector)';

/**
 * @param {Object} where
 * @param {Element[]} where.tiles  the panels, in any order
 * @param {?Element} where.pointerEl  the element under the pointer, or null (pointer outside the page)
 * @param {?Element} where.activeEl  the element with the keyboard focus
 * @param {{width: number, height: number}} where.viewport
 * @returns {?Element}  the panel to act on, or null when there is none
 */
export function chooseTargetTile({ tiles, pointerEl, activeEl, viewport }) {
  if (!tiles || !tiles.length) return null;
  for (const el of [pointerEl, activeEl]) {
    const tile = el && typeof el.closest === 'function' ? el.closest(TILE) : null;
    if (tile && tiles.includes(tile)) return tile;
  }
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  let best = null;
  let bestDistance = Infinity;
  for (const tile of tiles) {
    const r = tile.getBoundingClientRect();
    const distance = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = tile;
    }
  }
  return best;
}

/**
 * Follow the pointer so that a key press can ask what it is over. Once; returns
 * a function giving the panel the shortcut acts on now.
 * @returns {function(): ?Element}
 */
export function installPanelTarget() {
  let at = null;
  document.addEventListener('pointermove', (e) => { at = [e.clientX, e.clientY]; }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { at = null; });
  return () => chooseTargetTile({
    tiles: Array.from(document.querySelectorAll(TILE)),
    pointerEl: at ? document.elementFromPoint(at[0], at[1]) : null,
    activeEl: document.activeElement,
    viewport: { width: window.innerWidth, height: window.innerHeight }
  });
}
