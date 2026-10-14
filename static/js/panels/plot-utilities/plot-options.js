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
 */

export const SCALE_BAR_CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
export const COLORBAR_POSITIONS = ['legend', 'right', 'left', 'top', 'bottom'];

/** Defaults of the options added after the first Plot Options menu. */
export const OPTION_DEFAULTS = Object.freeze({
  tickCount: null,                 // null: Plotly picks (automatic), else about N ticks per axis
  marginsUnlinked: false,          // false: one value for all four sides
  colorbarPosition: 'legend',      // 'legend': where the legend goes (settings.legendPosition)
  colorbarLength: 1,               // fraction of the plot's height (width when horizontal)
  colorbarTicks: null,             // null: automatic
  showScaleBar: false,
  scaleBarCorner: 'bottom-right',
  scaleBarUnitsPerCoord: 1,        // physical units per coordinate unit
  scaleBarUnit: 'units'
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
  s.showScaleBar = s.showScaleBar === true;
  s.scaleBarCorner = SCALE_BAR_CORNERS.includes(s.scaleBarCorner) ? s.scaleBarCorner : OPTION_DEFAULTS.scaleBarCorner;
  s.scaleBarUnitsPerCoord = isNum(s.scaleBarUnitsPerCoord) && s.scaleBarUnitsPerCoord > 0
    ? s.scaleBarUnitsPerCoord : OPTION_DEFAULTS.scaleBarUnitsPerCoord;
  s.scaleBarUnit = typeof s.scaleBarUnit === 'string' && s.scaleBarUnit.trim()
    ? s.scaleBarUnit.slice(0, 20) : OPTION_DEFAULTS.scaleBarUnit;
  if (s.showTickMarks !== undefined && typeof s.showTickMarks !== 'boolean') delete s.showTickMarks;
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
 * Its length is the round number nearest a fifth of the visible width, in
 * the unit of the panel (units per coordinate unit), so it changes as the
 * plot is zoomed. Returns null when the bar does not draw.
 * @param {Object} settings
 * @param {number[]} xRange - the visible x range (either direction)
 * @returns {{shapes: Object[], annotations: Object[], length: number, label: string}|null}
 */
export function scaleBar(settings, xRange) {
  if (!scaleBarActive(settings) || !Array.isArray(xRange) || !isNum(+xRange[0]) || !isNum(+xRange[1])) return null;
  const x0 = +xRange[0], x1 = +xRange[1];
  const width = Math.abs(x1 - x0);
  if (!(width > 0)) return null;
  const perUnit = settings.scaleBarUnitsPerCoord > 0 ? settings.scaleBarUnitsPerCoord : 1;
  const length = niceLength(width * perUnit / 5);
  const span = length / perUnit;                        // in coordinates
  const dir = x1 >= x0 ? 1 : -1;                        // an axis can be reversed
  const corner = SCALE_BAR_CORNERS.includes(settings.scaleBarCorner) ? settings.scaleBarCorner : OPTION_DEFAULTS.scaleBarCorner;
  const [vert, side] = corner.split('-');
  const inset = 0.04 * width;
  const near = side === 'left' ? x0 + dir * inset : x1 - dir * inset;      // the edge the bar sits against
  const a = side === 'left' ? near : near - dir * span;
  const b = side === 'left' ? near + dir * span : near;
  const y = vert === 'top' ? 0.95 : 0.05;
  const colour = settings.textColor || '#000000';
  const label = `${formatLength(length)} ${settings.scaleBarUnit || OPTION_DEFAULTS.scaleBarUnit}`;
  return {
    length, label,
    shapes: [{ type: 'line', name: SCALE_BAR, xref: 'x', yref: 'paper', x0: a, x1: b, y0: y, y1: y,
               line: { color: colour, width: 3 }, layer: 'above' }],
    annotations: [{ name: SCALE_BAR, text: label, showarrow: false, xref: 'x', yref: 'paper',
                    x: (a + b) / 2, y, xanchor: 'center', yanchor: vert === 'top' ? 'top' : 'bottom',
                    yshift: vert === 'top' ? -6 : 6, font: { color: colour, size: 12 } }]
  };
}

/** `items` without the scale bar's own, plus `ours`. */
export function replaceScaleBar(items, ours) {
  return [...(items || []).filter(it => !it || it.name !== SCALE_BAR), ...ours];
}

// ---- presets and copying ----

/** The look the app starts with, for every option a preset sets. */
export function defaultLook() {
  return {
    bgColor: '#ffffff', textColor: '#000000', gridColor: '#e6e6e6', axisColor: '#000000', zeroLineColor: '#cccccc',
    showGrid: true, showAxisTitles: true, showAxisLabels: true, showAxisLines: true, showZeroLines: false,
    tickCount: null, fontSize: 12, axisLineWidth: 1, gridLineWidth: 1, zeroLineWidth: 1,
    margins: { ...DEFAULT_MARGINS }, marginsUnlinked: false,
    legendPosition: 'right', showLegend: true,
    colorbarPosition: 'legend', colorbarLength: 1, colorbarTicks: null,
    showScaleBar: false, scaleBarCorner: 'bottom-right'
  };
}

/** The scale bar was set up: a unit or a scale other than the defaults. */
export function scaleBarConfigured(settings) {
  return settings.scaleBarUnitsPerCoord !== OPTION_DEFAULTS.scaleBarUnitsPerCoord
    || settings.scaleBarUnit !== OPTION_DEFAULTS.scaleBarUnit;
}

export const PRESETS = Object.freeze(['default', 'publication']);

/**
 * Settings changes of a preset. Default restores the look above (data
 * choices, the scale bar's unit and the Not in table group stay).
 * Publication: white background, no grid, minimal ticks (about five per
 * axis, marks on), larger fonts and lines, a tight margin, and the scale
 * bar when one is set up and Equal aspect is on.
 */
export function presetChanges(name, settings) {
  const look = defaultLook();
  if (name === 'default') return { ...look, showTickMarks: undefined };
  if (name === 'publication') {
    return {
      ...look,
      showGrid: false, showZeroLines: false, showTickMarks: true, tickCount: 5,
      fontSize: 16, axisLineWidth: 1.5,
      margins: { ...DEFAULT_MARGINS, l: 70, r: 70, t: 40, b: 60 },
      colorbarTicks: 5, colorbarLength: 0.6,
      showScaleBar: scaleBarConfigured(settings) && !!settings.equalAspect && !settings.z
    };
  }
  return {};
}

/** Apply a preset to the settings; returns the keys it set. */
export function applyPreset(settings, name) {
  const changes = presetChanges(name, settings);
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
  'margins', 'marginsUnlinked', 'legendPosition', 'showLegend',
  'colorbarPosition', 'colorbarLength', 'colorbarTicks',
  'showScaleBar', 'scaleBarCorner', 'scaleBarUnitsPerCoord', 'scaleBarUnit',
  'notInTableScale', 'notInTableOpacity', 'notInTableColor',
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
  for (const k of STYLE_KEYS) {
    if (!(k in style)) continue;
    if (style[k] === null) delete target[k];
    else target[k] = JSON.parse(JSON.stringify(style[k]));
  }
  return normalizePlotOptions(target);
}
