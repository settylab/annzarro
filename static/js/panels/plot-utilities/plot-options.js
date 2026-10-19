/**
 * Plot Options that are pure functions of a panel's settings: defaults for
 * links that predate them, tick keys, colour bar geometry, the spatial scale
 * bar, presets and the styling copied to other panels. No DOM and no Plotly,
 * so annzarro/tests/js/plot-options.test.mjs runs them in Node. The menu
 * (plot-aesthetics-menu.js) reads and writes the settings; these turn them
 * into layout keys.
 *
 * Every option here is a plain value on the panel's settings, so a link, a
 * reload, a copied panel and a saved panel set keep them as they keep
 * `showGrid`. A config without them (older links) gets the defaults below.
 * The plot's colours are the exception: they are stored only when set, and
 * follow the app theme otherwise (utils/plot-theme.js).
 */
import { adoptColourModel, plotColour, pinPalette, COLOUR_MODEL } from '../../utils/plot-theme.js';
import { DOT_SIZE_MIN, DOT_SIZE_MAX, COLUMNS_MAX } from '../../utils/legend-options.js';

export const SCALE_BAR_CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
export const COLORBAR_POSITIONS = ['legend', 'right', 'left', 'top', 'bottom'];

/** Defaults of the options added after the first Plot Options menu. */
export const OPTION_DEFAULTS = Object.freeze({
  tickCount: null,                 // null: Plotly picks (automatic), else about N ticks per axis
  marginsUnlinked: false,          // false: one value for all four sides
  colorbarPosition: 'legend',      // 'legend': where the legend goes (settings.legendPosition)
  colorbarLength: 1,               // fraction of the plot's height (width when horizontal)
  colorbarTicks: null,             // null: automatic
  legendDotSize: null,             // null: the constant legend (12 px); else the legend dots' size in px (utils/legend-options.js)
  legendColumns: null,             // null: one column; else 2 or more
  showLegendTitle: true,
  bare: false,                     // the Bare preset: no axis at all (set with it; the Default preset clears it)
  showScaleBar: false,
  scaleBarCorner: 'bottom-right',
  scaleBarSize: 1,                 // scales the bar's target length, line and label together
  scaleBarUnit: ''                 // optional suffix after the number, e.g. 'µm'
});

export const DEFAULT_MARGINS = Object.freeze({ l: 80, r: 80, t: 80, b: 60, pad: 4 });

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Fill the options a config may lack and drop values that cannot be used.
 * `showTickMarks` is left undefined unless set: then the marks follow the
 * tick labels, as they did before it existed.
 */
export function normalizePlotOptions(settings) {
  const s = settings;
  s.tickCount = isNum(s.tickCount) && s.tickCount >= 2 ? Math.min(Math.round(s.tickCount), 30) : null;
  s.marginsUnlinked = s.marginsUnlinked === true;
  s.margins = { ...DEFAULT_MARGINS, ...(s.margins || {}) };      // a copy: panels must not share one object
  s.colorbarPosition = COLORBAR_POSITIONS.includes(s.colorbarPosition) ? s.colorbarPosition : OPTION_DEFAULTS.colorbarPosition;
  s.colorbarLength = isNum(s.colorbarLength) && s.colorbarLength >= 0.1 && s.colorbarLength <= 1
    ? s.colorbarLength : OPTION_DEFAULTS.colorbarLength;
  s.colorbarTicks = isNum(s.colorbarTicks) && s.colorbarTicks >= 2 ? Math.min(Math.round(s.colorbarTicks), 30) : null;
  s.legendDotSize = isNum(s.legendDotSize) && s.legendDotSize >= DOT_SIZE_MIN
    ? Math.min(Math.round(s.legendDotSize), DOT_SIZE_MAX) : null;
  s.legendColumns = isNum(s.legendColumns) && s.legendColumns >= 2 ? Math.min(Math.round(s.legendColumns), COLUMNS_MAX) : null;
  s.showLegendTitle = s.showLegendTitle !== false;
  s.bare = s.bare === true;
  s.showScaleBar = s.showScaleBar === true && !!s.equalAspect;     // it needs Equal aspect
  s.scaleBarCorner = SCALE_BAR_CORNERS.includes(s.scaleBarCorner) ? s.scaleBarCorner : OPTION_DEFAULTS.scaleBarCorner;
  s.scaleBarSize = isNum(s.scaleBarSize) && s.scaleBarSize >= 0.25 && s.scaleBarSize <= 4
    ? s.scaleBarSize : OPTION_DEFAULTS.scaleBarSize;
  s.scaleBarUnit = typeof s.scaleBarUnit === 'string' ? s.scaleBarUnit.trim().slice(0, 20) : OPTION_DEFAULTS.scaleBarUnit;
  if (s.showTickMarks !== undefined && typeof s.showTickMarks !== 'boolean') delete s.showTickMarks;
  adoptColourModel(s);                                           // links from before plots followed the app theme
  return s;
}

/** Whether tick marks show: its own switch, else as the tick labels. */
export function tickMarksOn(settings) {
  return settings.showTickMarks !== undefined ? settings.showTickMarks : settings.showAxisLabels !== false;
}

/**
 * Relayout keys for tick marks, tick labels and the tick count of each axis
 * path ('xaxis', 'scene.zaxis', ...). nticks 0 is Plotly's automatic.
 */
export function tickKeys(settings, axes) {
  const keys = {};
  for (const axis of axes) {
    keys[`${axis}.ticks`] = tickMarksOn(settings) ? 'outside' : '';
    keys[`${axis}.showticklabels`] = settings.showAxisLabels !== false;
    keys[`${axis}.nticks`] = settings.tickCount || 0;
    // the Bare preset: no axis drawn at all (a hidden axis has no line, ticks, labels, title, grid, zero line or mirror)
    keys[`${axis}.visible`] = !settings.bare;
    keys[`${axis}.showspikes`] = settings.bare ? false : null;
  }
  return keys;
}

/** The axes paths a plot has: 2D, or the three scene axes. */
export function axisPaths(settings) {
  return settings.z ? ['scene.xaxis', 'scene.yaxis', 'scene.zaxis'] : ['xaxis', 'yaxis'];
}

/** Where the colour bar goes: its own position, else the legend's. */
export function colorbarPosition(settings) {
  const p = settings.colorbarPosition;
  return p && p !== 'legend' ? p : (settings.legendPosition || 'right');
}

/** Length and tick count of a colour bar, as Plotly colorbar attributes. */
export function colorbarExtras(settings) {
  const extras = { len: settings.colorbarLength ?? 1, lenmode: 'fraction' };
  if (settings.colorbarTicks) extras.nticks = settings.colorbarTicks;
  return extras;
}

/** Margin for one slider value: all four sides, the padding kept. */
export function linkedMargins(settings, value) {
  const v = Math.max(0, Math.min(200, Math.round(value)));
  return { ...settings.margins, l: v, r: v, t: v, b: v };
}

// ---- spatial scale bar ----

/** The round length (1, 2 or 5 times a power of ten) closest to `target`, on a log scale. */
export function niceLength(target) {
  if (!(target > 0) || !Number.isFinite(target)) return 1;
  const exp = Math.floor(Math.log10(target));
  let best = null;
  for (const e of [exp - 1, exp, exp + 1]) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, e);
      const d = Math.abs(Math.log(v / target));
      if (!best || d < best.d) best = { v, d };
    }
  }
  return best.v;
}

/** A length as text without floating point noise (0.2, 100, 5000, 2e-7). */
export function formatLength(v) {
  const s = Number(v.toPrecision(6));
  return Math.abs(s) >= 1e-4 && Math.abs(s) < 1e7 ? String(s) : s.toExponential().replace('e+', 'e');
}

export const SCALE_BAR = 'az-scalebar';

/**
 * Whether the scale bar draws: switched on, on a 2D plot, with Equal aspect
 * (without it a coordinate unit is longer on one axis than the other and
 * one bar cannot be true for both).
 */
export function scaleBarActive(settings) {
  return !!settings.showScaleBar && !settings.z && !!settings.equalAspect;
}

/**
 * The shape and the label of the scale bar for the x range on screen.
 * Its length is the round number nearest a fifth of the visible width
 * times the size factor, in coordinate units, so it changes as the plot is
 * zoomed. Returns null when the bar does not draw.
 * @param {Object} settings
 * @param {number[]} xRange - the visible x range (either direction)
 * @returns {{shapes: Object[], annotations: Object[], length: number, label: string}|null}
 */
export function scaleBar(settings, xRange) {
  if (!scaleBarActive(settings) || !Array.isArray(xRange) || !isNum(+xRange[0]) || !isNum(+xRange[1])) return null;
  const x0 = +xRange[0], x1 = +xRange[1];
  const width = Math.abs(x1 - x0);
  if (!(width > 0)) return null;
  const size = settings.scaleBarSize > 0 ? settings.scaleBarSize : 1;
  const length = niceLength(width * size / 5);          // coordinate units
  const dir = x1 >= x0 ? 1 : -1;                        // an axis can be reversed
  const corner = SCALE_BAR_CORNERS.includes(settings.scaleBarCorner) ? settings.scaleBarCorner : OPTION_DEFAULTS.scaleBarCorner;
  const [vert, side] = corner.split('-');
  const inset = 0.04 * width;
  const near = side === 'left' ? x0 + dir * inset : x1 - dir * inset;      // the edge the bar sits against
  const a = side === 'left' ? near : near - dir * length;
  const b = side === 'left' ? near + dir * length : near;
  const y = vert === 'top' ? 0.95 : 0.05;
  const colour = plotColour(settings, 'textColor');       // it follows the text colour, so the app theme
  const unit = (settings.scaleBarUnit || '').trim();
  const label = unit ? `${formatLength(length)} ${unit}` : formatLength(length);
  return {
    length, label,
    shapes: [{ type: 'line', name: SCALE_BAR, xref: 'x', yref: 'paper', x0: a, x1: b, y0: y, y1: y,
               line: { color: colour, width: 3 * size }, layer: 'above' }],
    annotations: [{ name: SCALE_BAR, text: label, showarrow: false, xref: 'x', yref: 'paper',
                    x: (a + b) / 2, y, xanchor: 'center', yanchor: vert === 'top' ? 'top' : 'bottom',
                    yshift: (vert === 'top' ? -6 : 6) * size, font: { color: colour, size: 12 * size } }]
  };
}

/** `items` without the scale bar's own, plus `ours`. */
export function replaceScaleBar(items, ours) {
  return [...(items || []).filter(it => !it || it.name !== SCALE_BAR), ...ours];
}

// ---- presets and copying ----

/**
 * The look the app starts with, for every option a preset sets. The colours
 * are undefined: unset, so the plot follows the app theme.
 */
export function defaultLook() {
  return {
    bgColor: undefined, textColor: undefined, gridColor: undefined, axisColor: undefined, zeroLineColor: undefined,
    backdropColor: undefined,
    showGrid: true, showAxisTitles: true, showAxisLabels: true, showAxisLines: true, showZeroLines: false,
    tickCount: null, fontSize: 12, fontFamily: undefined, axisLineWidth: 1, gridLineWidth: 1, zeroLineWidth: 1,
    margins: { ...DEFAULT_MARGINS }, marginsUnlinked: false,
    legendPosition: 'right', showLegend: true, legendDotSize: null, legendColumns: null, showLegendTitle: true,
    bare: false,
    colorbarPosition: 'legend', colorbarLength: 1, colorbarTicks: null,
    showScaleBar: false, scaleBarCorner: 'bottom-right'
  };
}

/** The font family the Publication preset sets, as the Plot Options font menu names Arial. */
export const PUBLICATION_FONT = 'Arial, Helvetica, sans-serif';

export const PRESETS = Object.freeze(['default', 'publication', 'bare']);

/**
 * Settings changes of a preset. Default restores the look above (data
 * choices, the scale bar's unit, the Not in table and Focused groups stay).
 * Publication: white background and black text and lines in any app theme
 * (the colours are pinned light), no grid, minimal ticks (about five per
 * axis, marks on), Arial at a larger size, thicker lines, a tight margin and
 * a short colour bar with three ticks. The scale bar
 * is not part of either preset.
 */
export function presetChanges(name) {
  const look = defaultLook();
  if (name === 'default') return { ...look, showTickMarks: undefined };
  if (name === 'publication') {
    const rest = { ...look };
    delete rest.showScaleBar;                       // the scale bar stays as it is
    delete rest.scaleBarCorner;
    const light = {};
    pinPalette(light, 'light');
    return {
      ...rest,
      bgColor: light.bgColor, textColor: light.textColor, gridColor: light.gridColor,
      axisColor: light.axisColor, zeroLineColor: light.zeroLineColor, backdropColor: light.backdropColor,
      showGrid: false, showZeroLines: false, showTickMarks: true, tickCount: 5,
      fontSize: 16, fontFamily: PUBLICATION_FONT, axisLineWidth: 1.5,
      margins: { ...DEFAULT_MARGINS, l: 70, r: 70, t: 40, b: 60 },
      colorbarTicks: 3, colorbarLength: 0.4
    };
  }
  if (name === 'bare') {
    // only the points: no margins, legend, colour bar, scale bar, axes (titles, labels, lines, ticks), grid or
    // zero lines. The data, colours, point size and opacity, and the background colour stay.
    return {
      showGrid: false, showZeroLines: false, showAxisTitles: false, showAxisLabels: false, showAxisLines: false,
      showTickMarks: false, tickCount: null, margins: { l: 0, r: 0, t: 0, b: 0, pad: 0 }, marginsUnlinked: false,
      showLegend: false, showScaleBar: false, bare: true
    };
  }
  return {};
}

/** Apply a preset to the settings; returns the keys it set. */
export function applyPreset(settings, name) {
  const changes = presetChanges(name);
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) delete settings[k]; else settings[k] = v;
  }
  return Object.keys(changes);
}

/** The options "Apply to other panels" copies: how a plot looks, not what it shows. */
export const STYLE_KEYS = Object.freeze([
  'showGrid', 'showAxisTitles', 'showAxisLabels', 'showAxisLines', 'showZeroLines', 'showTickMarks', 'tickCount',
  'bgColor', 'gridColor', 'axisColor', 'textColor', 'zeroLineColor', 'backdropColor', 'showBackdrop',
  'axisLineWidth', 'gridLineWidth', 'zeroLineWidth', 'fontSize', 'fontFamily',
  'margins', 'marginsUnlinked', 'legendPosition', 'showLegend', 'legendDotSize', 'legendColumns', 'showLegendTitle', 'bare',
  'colorbarPosition', 'colorbarLength', 'colorbarTicks',
  'showScaleBar', 'scaleBarCorner', 'scaleBarSize', 'scaleBarUnit',
  'notInTableScale', 'notInTableOpacity', 'notInTableColor',
  'focusedScale', 'focusedOpacity', 'focusedColor', 'focusedNoFill', 'focusedEdgeColor', 'focusedEdgeWidth',
  'exportWidth', 'exportHeight', 'scaleExport'
]);

/** The styling of `settings` as a copy; an unset option is listed as null so it unsets on the other side. */
export function pickStyle(settings) {
  const out = {};
  for (const k of STYLE_KEYS) {
    out[k] = settings[k] === undefined ? null : JSON.parse(JSON.stringify(settings[k]));
  }
  return out;
}

/** Put a picked style on `target`; null unsets the option. */
export function adoptStyle(target, style) {
  target.colourModel = COLOUR_MODEL;      // an unset colour in `style` is auto, not a light default of an old link
  for (const k of STYLE_KEYS) {
    if (!(k in style)) continue;
    if (style[k] === null) delete target[k];
    else target[k] = JSON.parse(JSON.stringify(style[k]));
  }
  return normalizePlotOptions(target);
}

// ---- export size ----

/** The export's size in pixels and its scale when the panel sets none: drawn at 1200 x 800, saved at twice that. */
export const EXPORT_DEFAULTS = Object.freeze({ width: 1200, height: 800, scale: 2 });

/**
 * The export's pixel size and scale from the panel's settings. An unset
 * scaleExport is the default (2); only an explicit false keeps scale 1, so a
 * panel saved with it off exports as before.
 */
export function exportOptions(settings) {
  const s = settings || {};
  return {
    width: s.exportWidth || EXPORT_DEFAULTS.width,
    height: s.exportHeight || EXPORT_DEFAULTS.height,
    scale: s.scaleExport === false ? 1 : EXPORT_DEFAULTS.scale
  };
}
