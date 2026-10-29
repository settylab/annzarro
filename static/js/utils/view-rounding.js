/**
 * How a view's numbers are rounded before they are kept (a panel's zoom and camera in its settings,
 * in the address and in history entries), so the same view is always the same value and float noise
 * is neither a new history entry nor a new link. Pure; annzarro/tests/browser/view_rounding.py is
 * the same rule for the tests.
 *
 * - A 2D range: 4 significant digits of its span (roundRange of view-descriptor.js).
 * - A 3D camera: eye and center to 4 significant digits of the eye's distance from the center
 *   (a view zoomed in to 0.1 keeps 1e-4 steps, one at 8 keeps 1e-3), up to 4 decimals (a unit direction).
 */
import { roundRange } from './view-descriptor.js';

/** A range rounded to 4 significant digits of its span (flip order kept); anything but two numbers as it is. */
export function roundedRange(range) {
  if (!Array.isArray(range) || range.length !== 2 || !range.every(v => typeof v === 'number' && Number.isFinite(v))) return range;
  const [lo, hi] = roundRange([Math.min(range[0], range[1]), Math.max(range[0], range[1])]);
  return range[0] <= range[1] ? [lo, hi] : [hi, lo];
}

const snap = (v, step) => Number((Math.round(v / step) * step).toPrecision(12));

/** A 3D camera as the view records it: {eye, up, center}. */
export function roundCamera(camera) {
  const p = (o) => (o && typeof o === 'object' ? { x: Number(o.x), y: Number(o.y), z: Number(o.z) } : null);
  const eye = p(camera.eye), center = p(camera.center), up = p(camera.up);
  let step = 1e-3;
  if (eye && center) {
    const d = Math.hypot(eye.x - center.x, eye.y - center.y, eye.z - center.z);
    if (d > 0 && Number.isFinite(d)) step = Math.pow(10, Math.floor(Math.log10(d)) - 3);
  }
  const r = (o, s) => (o ? { x: snap(o.x, s), y: snap(o.y, s), z: snap(o.z, s) } : camera[o === eye ? 'eye' : 'center']);
  return { eye: r(eye, step), up: up ? { x: snap(up.x, 1e-4), y: snap(up.y, 1e-4), z: snap(up.z, 1e-4) } : camera.up, center: r(center, step) };
}
