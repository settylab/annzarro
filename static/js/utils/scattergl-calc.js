/**
 * Plotly's scattergl calc step, wrapped: what it builds per point is built
 * here in a cheaper form, and the drawing is the same.
 *
 * 1. Per-point colours (issue #82). For a trace coloured by a number per
 *    point, Plotly 2.20 runs every value through its colour scale function,
 *    which returns a CSS string ("rgb(68, 1, 84)") that is parsed straight
 *    back into numbers, then gives the scene one more parsed colour per
 *    point for the (invisible) border. At 1M points that was 0.78 s of the
 *    1.13 s Plotly.react after a recolour. For a trace it can handle
 *    (`eligible`), calc runs with a placeholder single colour, so Plotly
 *    builds no per-point colours, and the scene then gets the colours
 *    computed here: the same scale, interpolation and rounding as Plotly's
 *    (d3 v3 linear scale, clamped, through tinycolor's integer RGB), equal
 *    colour for equal value, so a recolour draws what it drew before.
 *    `gd.data`, `gd._fullData` and hover read the numeric colour array, the
 *    colour bar is Plotly's, and the colour range is the one Plotly's own
 *    colour scale step computes (`colorRange` follows it).
 *
 *    One difference from Plotly's per-point colours: the marker opacity is
 *    not folded into each colour's alpha but drawn as the scene opacity, as
 *    Plotly does for single-colour traces. Changing the opacity in the
 *    scene (gl-markers.js) then means the same for both kinds of trace.
 *
 * 2. Positions off the JS heap (graphs without hover: large-plot mode).
 *    calc keeps each trace's positions as a plain Array of doubles (16 B a
 *    point) and, below 100,000 points, point ids as a plain Array (4 B):
 *    20.1 B a point of V8 heap in a 10M-point large plot, 3.5 GB at 175M,
 *    and at 200M the tab died of a V8 out-of-memory (its heap is capped
 *    near 4 GB whatever the machine has). Here they become a Float64Array
 *    and a Uint32Array, the same numbers in ArrayBuffers, which live outside
 *    that heap.
 *
 * It relies on Plotly's scattergl internals (vendored Plotly 2.20): the
 * calc step's stash and scene options. A trace it cannot handle goes
 * through Plotly unchanged.
 */

/** Plotly's colour for a non-numeric value (Color.defaultLine, #444). */
const DEFAULT_COLOR = Object.freeze([68 / 255, 68 / 255, 68 / 255, 1]);
const PLACEHOLDER = 'rgba(0, 0, 0, 0)';

/**
 * Set on scene options whose per-point colours leave the marker opacity to
 * the scene (gl-markers.js may change it there).
 */
export const OPACITY_IN_SCENE = '_azOpacityInScene';

let installing = null;
let disabled = false;
let positionsDisabled = false;

const isTyped = (v) => ArrayBuffer.isView(v) && !(v instanceof DataView);
const isArrayLike = (v) => Array.isArray(v) || isTyped(v);

/**
 * Parse a colour scale entry as tinycolor would for the forms Plotly's
 * scales use: #rgb, #rrggbb, rgb(r, g, b), rgba(r, g, b, a). Returns
 * [r, g, b, a] with r, g, b rounded to integers (tinycolor toRgb), or null.
 */
export function parseScaleColor(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(t);
  if (m) return [...m[1]].map(h => parseInt(h + h, 16)).concat(1);
  m = /^#([0-9a-f]{6})$/.exec(t);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)$/.exec(t);
  if (!m || (t.startsWith('rgba') !== (m[4] !== undefined))) return null;
  const ch = (v) => Math.round(bound255(parseFloat(v)));
  let a = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (Number.isNaN(a) || a < 0 || a > 1) a = 1;
  return [ch(m[1]), ch(m[2]), ch(m[3]), a];
}

/** tinycolor's bound01(n, 255) * 255 for a number. */
function bound255(n) {
  n = Math.min(255, Math.max(0, n));
  if (Math.abs(n - 255) < 0.000001) return 255;
  return ((n % 255) / 255) * 255;
}

/**
 * The colour function Plotly builds for a trace (Colorscale
 * makeColorScaleFunc over extractScale), returning what its formatColor
 * hands the scene before the opacity: [r, g, b, a] with r, g, b in 0..1.
 * Equal results are one shared array. Null when a scale colour is in a
 * form `parseScaleColor` does not read.
 *
 * @param {Array} colorscale  [[stop, colour], ...] (Plotly's full trace)
 * @param {boolean} reverse  marker.reversescale
 * @param {number} cmin
 * @param {number} cmax
 */
export function scaleColorFunction(colorscale, reverse, cmin, cmax) {
  if (!Array.isArray(colorscale) || colorscale.length < 2) return null;
  let scl = colorscale;
  if (reverse) {
    scl = scl.map((_, i) => {
      const s = colorscale[colorscale.length - 1 - i];
      return [1 - s[0], s[1]];
    });
  }
  let domain = scl.map(s => +(cmin + s[0] * (cmax - cmin)));
  let range = scl.map(s => parseScaleColor(s[1]));
  if (range.some(r => r === null)) return null;
  const k = Math.min(domain.length, range.length) - 1;
  if (domain[k] < domain[0]) {
    domain = domain.slice().reverse();
    range = range.slice().reverse();
  }
  // d3 v3 uninterpolateClamp per segment: b = (d1 - d0) || 1 / (d1 - d0)
  const spans = [];
  for (let j = 0; j < k; j++) {
    const d = domain[j + 1] - domain[j];
    spans.push(d || 1 / d);
  }
  const cache = new Map();
  const colorOf = (x) => {
    let j = 0;
    if (k > 1) {
      // d3.bisectRight(domain, x, 1, k) - 1
      let lo = 1, hi = k;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (domain[mid] > x) hi = mid; else lo = mid + 1;
      }
      j = lo - 1;
    }
    const t = Math.max(0, Math.min(1, (x - domain[j]) / spans[j]));
    const a0 = range[j], a1 = range[j + 1];
    // d3 interpolateNumber: a * (1 - t) + b * t, then tinycolor's rounding
    const r = Math.round(bound255(a0[0] * (1 - t) + a1[0] * t));
    const g = Math.round(bound255(a0[1] * (1 - t) + a1[1] * t));
    const b = Math.round(bound255(a0[2] * (1 - t) + a1[2] * t));
    let a = a0[3] * (1 - t) + a1[3] * t;
    if (Number.isNaN(a) || a < 0 || a > 1) a = 1;
    if (a !== 1) a = Math.round(100 * a) / 100;
    const key = ((r * 256 + g) * 256 + b) * 101 + Math.round(a * 100);
    let c = cache.get(key);
    if (!c) {
      c = [r / 255, g / 255, b / 255, a];
      cache.set(key, c);
    }
    return c;
  };
  return (v) => (typeof v === 'number' && Number.isFinite(v) ? colorOf(v) : DEFAULT_COLOR);
}

/**
 * The colour range Plotly's colour scale step gives a marker (Colorscale
 * calc): the data's finite min/max when automatic, the set cmin/cmax
 * otherwise, widened by 0.5 each way when equal.
 */
export function colorRange(marker, values) {
  const auto = marker.cauto !== false;
  let lo = marker.cmin, hi = marker.cmax;
  if (lo === undefined || hi === undefined || auto) {
    let min = false, max = false;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (min === false || v < min) min = v;
      if (max === false || v > max) max = v;
    }
    if (lo === undefined || auto) lo = min;
    if (hi === undefined || auto) hi = max;
  }
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  return [lo, hi];
}

/**
 * Whether the wrapped calc handles `trace` (Plotly's full trace): numeric
 * colour per point over its own colour scale, one marker opacity, symbol
 * and angle for every point, no colour axis or per-point border.
 */
export function eligible(trace) {
  const m = trace && trace.marker;
  if (!m || trace.visible !== true || !isArrayLike(m.color)) return false;
  if (m.coloraxis || m._colorAx || m.autocolorscale === true || !Array.isArray(m.colorscale)) return false;
  if (m.cauto !== false && m.cmid !== undefined) return false;
  if (typeof m.opacity !== 'number' || typeof trace.opacity !== 'number') return false;
  if (typeof m.symbol !== 'string' || /-open/.test(m.symbol) || isArrayLike(m.angle)) return false;
  if (m.line && (isArrayLike(m.line.color) || isArrayLike(m.line.width))) return false;
  if (!(trace._length > 0) || m.color.length < trace._length) return false;
  const c = m.color;
  if (!isTyped(c)) {
    for (let i = 0; i < trace._length; i++) {
      const v = c[i];
      if (typeof v !== 'number' && v !== null && v !== undefined) return false;
    }
  }
  return true;
}

/** The scene options Plotly's calc made for `trace`, from its calcdata. */
function sceneOptions(cd) {
  const stash = Array.isArray(cd) && cd[0] && cd[0].t;
  const scene = stash && stash._scene;
  if (!scene || !Array.isArray(scene.markerOptions) || typeof stash.index !== 'number') return null;
  const opts = scene.markerOptions[stash.index];
  return opts && typeof opts === 'object' ? opts : null;
}

/** Plotly's calc with the per-point colours computed here (1.), or plain. */
function colouredCalc(calc, self, args, trace) {
  if (disabled || !eligible(trace)) return calc.apply(self, args);
  const m = trace.marker;
  const values = m.color;
  const [cmin, cmax] = colorRange(m, values);
  const colorOf = scaleColorFunction(m.colorscale, !!m.reversescale, cmin, cmax);
  if (!colorOf) return calc.apply(self, args);
  const cauto = m.cauto;
  // Plotly's colour scale step keeps a set range; the one it would have
  // computed from the values is set here.
  m.color = PLACEHOLDER;
  m.cmin = cmin;
  m.cmax = cmax;
  m.cauto = false;
  let cd;
  try {
    cd = calc.apply(self, args);
  } finally {
    m.color = values;
    m.cauto = cauto;
  }
  const opts = sceneOptions(cd);
  if (!opts) {
    // Not the internals this was written for: the trace is drawn in the
    // placeholder colour once, and every later calc goes through Plotly.
    disabled = true;
    console.warn('Point colours: Plotly scattergl internals not found; using Plotly\'s colours');
    return cd;
  }
  const n = trace._length;
  const colors = new Array(n);
  for (let i = 0; i < n; i++) colors[i] = colorOf(values[i]);
  delete opts.color;
  opts.colors = colors;
  opts[OPACITY_IN_SCENE] = true;
  return cd;
}

const SCENE_OPTIONS = ['markerOptions', 'markerSelectedOptions', 'markerUnselectedOptions', 'lineOptions',
  'fillOptions', 'textOptions', 'textSelectedOptions', 'textUnselectedOptions'];

/**
 * Move a trace's calc positions and point ids into typed arrays (2.): the
 * stash's and every scene option that holds the same positions array.
 */
export function typedPositions(cd) {
  const stash = Array.isArray(cd) && cd[0] && cd[0].t;
  if (!stash) return false;
  let moved = false;
  const old = stash.positions;
  if (Array.isArray(old)) {
    const typed = Float64Array.from(old);
    const scene = stash._scene;
    if (scene && typeof stash.index === 'number') {
      for (const key of SCENE_OPTIONS) {
        const o = Array.isArray(scene[key]) ? scene[key][stash.index] : null;
        if (o && o.positions === old) o.positions = typed;
      }
    }
    stash.positions = typed;
    moved = true;
  }
  if (Array.isArray(stash.ids)) {
    stash.ids = Uint32Array.from(stash.ids);
    moved = true;
  }
  return moved;
}

/** A graph whose points have no hover: large-plot mode (hovermode false). */
const noHover = (gd) => !!(gd && gd._fullLayout && gd._fullLayout.hovermode === false);

function wrapCalc(calc) {
  const wrapped = function (gd, trace) {
    const cd = colouredCalc(calc, this, arguments, trace);
    if (!positionsDisabled && noHover(gd)) typedPositions(cd);
    return cd;
  };
  wrapped.__azGlColors = calc;
  return wrapped;
}

/**
 * Wrap the calc of the scattergl trace module `module` (idempotent).
 * Returns whether it is wrapped.
 */
export function wrapScatterglModule(module) {
  if (!module || module.name !== 'scattergl' || typeof module.calc !== 'function') return false;
  if (!module.calc.__azGlColors) module.calc = wrapCalc(module.calc);
  return true;
}

/**
 * Install the wrapper once per page. Plotly does not export its trace
 * modules: `probeModule` reaches the scattergl one (panel-surface.js draws
 * a detached one-trace graph for it, the only place plots are created).
 * Every call after the first returns the first one's promise.
 * @param {() => Promise<Object>} probeModule - resolves to Plotly's scattergl trace module
 * @returns {Promise<boolean>} whether the wrapper is in place
 */
export function installGlColors(probeModule) {
  if (installing) return installing;
  if (typeof probeModule !== 'function') return Promise.resolve(false);
  installing = (async () => {
    try {
      return wrapScatterglModule(await probeModule());
    } catch (err) {
      console.warn('Point colours: not installed:', err && err.message);
      return false;
    }
  })();
  return installing;
}

/** For tests: go back to Plotly's own colours (or on again). */
export function _setGlColorsDisabled(v) { disabled = !!v; }

/** For tests: keep Plotly's own position arrays (or typed again). */
export function _setTypedPositionsDisabled(v) { positionsDisabled = !!v; }
