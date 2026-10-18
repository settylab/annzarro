/**
 * The marker of the focused cell (or gene): how a plot draws its highlight.
 *
 * Plot Options set it per panel, as plain values on the settings, so a link,
 * a panel set and the autosave keep them; a config without them draws the
 * defaults below, which are the highlight every plot had before the options:
 * a red dot twice the point size, opaque, with a 2 px edge (black in the light
 * theme, white in the dark one).
 *
 *   focusedScale      size, times the point size (2)
 *   focusedOpacity    0 to 1 (1)
 *   focusedEdgeWidth  edge width in px, 0 for none (2)
 *   focusedColor      fill colour, a themed colour (utils/plot-theme.js)
 *   focusedNoFill     true: no fill, an open circle drawn by its edge alone (unset)
 *   focusedEdgeColor  edge colour, a themed colour
 *
 * No fill is a flag of its own, not a colour value: the fill colour is a
 * themed colour (a colour input, followed or reset with the theme), which
 * cannot say "none", and the flag keeps the colour chosen for when the fill
 * comes back. An open circle needs its edge, so it is drawn at least 1 px wide.
 * A 2D marker draws it as a transparent fill inside its edge (marker.line); a
 * 3D marker has no drawn edge, so it is the open-circle symbol in the edge colour.
 *
 * The size is a factor, not pixels, so the highlight keeps its proportion
 * when the point size follows the number of points (utils/point-style.js).
 * The same style goes to a 2D or 3D marker, to the hollow ring of a focused
 * cell outside the subset (its stroke takes the fill colour, so it looks the
 * same with or without a fill) and to the
 * circle shape of a large plot.
 *
 * Pure functions; annzarro/tests/js/focus-style.test.mjs runs them in Node.
 */
import { plotColour } from './plot-theme.js';

export const FOCUS_DEFAULTS = Object.freeze({ scale: 2, opacity: 1, edgeWidth: 2 });
export const FOCUS_SCALE_MAX = 50;
export const FOCUS_EDGE_MAX = 20;
export const NO_FILL = 'rgba(0,0,0,0)';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** The focused marker's size factor, opacity and edge width: the panel's when usable, else the defaults. */
export function focusParams(settings) {
  const s = settings || {};
  return {
    scale: isNum(s.focusedScale) && s.focusedScale > 0 && s.focusedScale <= FOCUS_SCALE_MAX ? s.focusedScale : FOCUS_DEFAULTS.scale,
    opacity: isNum(s.focusedOpacity) && s.focusedOpacity > 0 && s.focusedOpacity <= 1 ? s.focusedOpacity : FOCUS_DEFAULTS.opacity,
    edgeWidth: isNum(s.focusedEdgeWidth) && s.focusedEdgeWidth >= 0 && s.focusedEdgeWidth <= FOCUS_EDGE_MAX
      ? s.focusedEdgeWidth : FOCUS_DEFAULTS.edgeWidth,
    noFill: s.focusedNoFill === true
  };
}

/** The focused marker's edge width as drawn: an open circle (no fill) is at least 1 px wide, or it would vanish. */
function drawnEdgeWidth(p) {
  return p.noFill ? Math.max(1, p.edgeWidth) : p.edgeWidth;
}

/** The fill colour as drawn: the themed colour, or fully transparent for no fill. */
function drawnFill(settings, p) {
  return p.noFill ? NO_FILL : plotColour(settings, 'focusedColor');
}

/** The focused marker's size in px (a marker's diameter). */
export function focusSize(settings) {
  return (Number(settings && settings.pointSize) || 0) * focusParams(settings).scale;
}

/**
 * The Plotly marker of the highlight trace. `ring`: the hollow ring of a
 * focused cell the subset does not show, stroked in the fill colour (at
 * least 1 px, so an edge width of 0 does not hide it); it is the same with or
 * without a fill. `is3D`: a scatter3d trace, which draws no marker edge.
 */
export function focusMarker(settings, ring = false, is3D = false) {
  const p = focusParams(settings);
  const fill = plotColour(settings, 'focusedColor');   // the ring is stroked in it, with or without a fill
  if (ring) {
    return { size: focusSize(settings), symbol: 'circle-open', color: fill, opacity: p.opacity,
             line: { color: fill, width: Math.max(1, p.edgeWidth) }, showscale: false };
  }
  const edge = plotColour(settings, 'focusedEdgeColor');
  if (p.noFill && is3D) {
    return { size: focusSize(settings), symbol: 'circle-open', color: edge, opacity: p.opacity,
             line: { color: edge, width: drawnEdgeWidth(p) }, showscale: false };
  }
  return { size: focusSize(settings), color: drawnFill(settings, p), opacity: p.opacity,
           line: { color: edge, width: drawnEdgeWidth(p) }, showscale: false };
}

/**
 * The restyle keys that put `focusMarker` on an existing highlight trace. A 3D
 * trace also gets its symbol (the open circle of no fill, or the plain one back).
 */
export function focusRestyle(settings, ring = false, is3D = false) {
  const m = focusMarker(settings, ring, is3D);
  const update = { 'marker.size': m.size, 'marker.color': m.color, 'marker.opacity': m.opacity,
                   'marker.line.color': m.line.color, 'marker.line.width': m.line.width };
  if (is3D) update['marker.symbol'] = m.symbol || 'circle';
  return update;
}

/**
 * The style of a large plot's highlight shape (large-interact.js): a circle
 * of radius `r` px, half the marker's size, never under 2 px.
 */
export function focusShapeStyle(settings) {
  const p = focusParams(settings);
  return { r: Math.max(2, focusSize(settings) / 2 || 4), opacity: p.opacity,
           fillcolor: drawnFill(settings, p),
           line: { color: plotColour(settings, 'focusedEdgeColor'), width: drawnEdgeWidth(p) } };
}
