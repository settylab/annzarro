/**
 * The marker of the focused cell (or gene): how a plot draws its highlight.
 *
 * Plot Options set it per panel, as plain values on the settings, so a link,
 * a panel set and the autosave keep them; a config without them draws the
 * defaults below, which are the highlight every plot had before the options:
 * a red dot twice the point size, opaque, with a 2 px edge (black in the light theme, white in the dark one).
 *
 *   focusedScale      size, times the point size (2)
 *   focusedOpacity    0 to 1 (1)
 *   focusedEdgeWidth  edge width in px, 0 for none (2)
 *   focusedColor      fill colour, a themed colour (utils/plot-theme.js)
 *   focusedEdgeColor  edge colour, a themed colour
 *
 * The size is a factor, not pixels, so the highlight keeps its proportion
 * when the point size follows the number of points (utils/point-style.js).
 * The same style goes to a 2D or 3D marker, to the hollow ring of a focused
 * cell outside the subset (its stroke takes the fill colour) and to the
 * circle shape of a large plot.
 *
 * Pure functions; annzarro/tests/js/focus-style.test.mjs runs them in Node.
 */
import { plotColour } from './plot-theme.js';

export const FOCUS_DEFAULTS = Object.freeze({ scale: 2, opacity: 1, edgeWidth: 2 });
export const FOCUS_SCALE_MAX = 50;
export const FOCUS_EDGE_MAX = 20;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** The focused marker's size factor, opacity and edge width: the panel's when usable, else the defaults. */
export function focusParams(settings) {
  const s = settings || {};
  return {
    scale: isNum(s.focusedScale) && s.focusedScale > 0 && s.focusedScale <= FOCUS_SCALE_MAX ? s.focusedScale : FOCUS_DEFAULTS.scale,
    opacity: isNum(s.focusedOpacity) && s.focusedOpacity > 0 && s.focusedOpacity <= 1 ? s.focusedOpacity : FOCUS_DEFAULTS.opacity,
    edgeWidth: isNum(s.focusedEdgeWidth) && s.focusedEdgeWidth >= 0 && s.focusedEdgeWidth <= FOCUS_EDGE_MAX
      ? s.focusedEdgeWidth : FOCUS_DEFAULTS.edgeWidth
  };
}

/** The focused marker's size in px (a marker's diameter). */
export function focusSize(settings) {
  return (Number(settings && settings.pointSize) || 0) * focusParams(settings).scale;
}

/**
 * The Plotly marker of the highlight trace. `ring`: the hollow ring of a
 * focused cell the subset does not show, stroked in the fill colour (at
 * least 1 px, so an edge width of 0 does not hide it).
 */
export function focusMarker(settings, ring = false) {
  const p = focusParams(settings);
  const fill = plotColour(settings, 'focusedColor');
  if (ring) {
    return { size: focusSize(settings), symbol: 'circle-open', color: fill, opacity: p.opacity,
             line: { color: fill, width: Math.max(1, p.edgeWidth) }, showscale: false };
  }
  return { size: focusSize(settings), color: fill, opacity: p.opacity,
           line: { color: plotColour(settings, 'focusedEdgeColor'), width: p.edgeWidth }, showscale: false };
}

/** The restyle keys that put `focusMarker` on an existing highlight trace. */
export function focusRestyle(settings, ring = false) {
  const m = focusMarker(settings, ring);
  return { 'marker.size': m.size, 'marker.color': m.color, 'marker.opacity': m.opacity,
           'marker.line.color': m.line.color, 'marker.line.width': m.line.width };
}

/**
 * The style of a large plot's highlight shape (large-interact.js): a circle
 * of radius `r` px, half the marker's size, never under 2 px.
 */
export function focusShapeStyle(settings) {
  const p = focusParams(settings);
  return { r: Math.max(2, focusSize(settings) / 2 || 4), opacity: p.opacity,
           fillcolor: plotColour(settings, 'focusedColor'),
           line: { color: plotColour(settings, 'focusedEdgeColor'), width: p.edgeWidth } };
}
