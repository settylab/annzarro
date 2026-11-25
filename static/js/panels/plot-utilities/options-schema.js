/**
 * The shared Plot Options of the new plot panels (WP-5a; design note options-ux-080 sections 2f, 3.1, 4 and 5; operator
 * decisions 25, 30 and 33): what the pop-over offers, where each value is stored, and each plot kind's own defaults.
 * Pure (no DOM, no Plotly), so annzarro/tests/js/plot-style.test.mjs holds it in Node. The pop-over that shows it is
 * options-popover.js; what the values do to a figure is plot-style.js.
 *
 * SECTIONS. Every kind has the common sections Text, Background, Axes, Legend, Margins, Export and Apply, in that order,
 * and its own sections between them: the Cell-Gene Plot's Dots, Sections and Annotations (cell-gene/options.js declares
 * them in this format and registers them here, `registerPanelFields`), the Cell Count Plot's 3D section (cell-count/options.js, shown only in 3D; its other controls are
 * in its grid since WP-6a). A panel's fields may also join a common section: Cell-Gene's gene and group labels
 * are in Axes, its colour bar, size legend and strip switches and titles in Legend.
 *
 * FIELDS. `{ id, section, type, path, label, dflt, min, max, step, choices, applies, copy, when, help }`:
 *  - `type`: 'number' (an empty box is the default), 'range' (a slider and a number box that say the same value; the
 *    box is `data-option=<id>Number`), 'check', 'select', 'color' (with Auto: the app theme), 'text'.
 *  - `path`: where the value lives in the panel's configuration, dotted. The common look is under `look`
 *    (`look.fontSize`); a panel field keeps the key it always had (`outline.width`, `labels.genes`), so links made before
 *    this keep their meaning. A value at its default is written as absent, and an object left empty goes (links stay short).
 *  - `dflt`: a value, or `{ [kind]: value }` for a per-kind default (the Cell-Gene Plot draws no grid by default, the
 *    count plot does; the legend's entry cap differs).
 *  - `applies`: the kinds it applies to (every kind when absent). A field that does not apply to a kind is not shown in
 *    its pop-over at all, never greyed. `copy`: whether Apply to other panels and the session default
 *    carry it (true when absent; a plot's own title is not a look and is not copied). `when(config)`: shown only then.
 *
 * Optional keys of a field (U2, pop-over unification; each used by the Cell Plot and Gene Plot kinds, aesthetics-kinds.js):
 *  - `placeholder` (value, or `(config, env) => value`) and `stepFrom`: an empty number box shows the default it stands
 *    for, and its arrows step from it. `shown(config, env)`: the value a control shows when nothing is stored (the
 *    theme's colour in a swatch, tick marks following the tick labels). `disabled(config, env)`: a reason (text) when the
 *    control is off now, '' when it is on. `look: false`: a view, not a look (not reset, never takes a plot off Default).
 *  - range: `typedMax`, what its number box takes past the slider's `max` (the slider rests at its end); `max` when absent.
 *  - select: a choice whose value is `null` writes absent (Auto). range: `percent: true` shows 100 times the stored
 *    fraction. `type: 'margins'`: the four sides in one field (`unlinkedPath` keeps the link switch).
 *  - `type: 'scaled'`: a slider on `scale` (utils/slider-scales.js) and a number box, `snap(v, config, fromTrack)` the values it takes,
 *    `autoPath` the stored switch that makes the value follow the plot (Auto). `domId`: the control's element id
 *    is `<domId>-<panel id>` (tests, drift harness and links read those ids), beside `data-option`.
 *  - `apply(value, config)`: what the adapter runs after the value is written (plot-aesthetics-adapter.js; not read here).
 *
 * Both kinds also have the session default (`STYLE_TYPES` of utils/session-style.js gains them): a plot made from the
 * chooser is on Default (`styleDefault: true`) and follows it; any change of its look gives it its own.
 */

import { withVocabulary } from './options-vocabulary.js';
import { FONT_CHOICES, DEFAULT_FONT, ARIAL } from '../../utils/fonts.js';

/**
 * KINDS. A kind is declared with `registerKind(kind, { order, defaults, applies, presets })`: its sections in order,
 * its own defaults by field id (over a field's `dflt`), the common fields it takes beyond those that apply to every
 * kind, and its presets' values. The Cell-Gene Plot and the Cell Count Plot are declared below; WP-5b declares the
 * Cell Plot and the Gene Plot the same way and registers their own fields with `registerPanelFields`.
 */
const _kinds = new Map();

/** The plot kinds on the shared Plot Options: panel types (the two declared here; `kinds()` has every declared one). */
export const PLOT_KINDS = Object.freeze(['cell-gene', 'cell-count']);

/** The common sections, in the pop-over's order; a panel's own sections go where its kind's `ORDER` puts them. */
const COMMON_SECTIONS = Object.freeze(['presets', 'text', 'background', 'axes', 'legend', 'margins', 'export', 'apply']);

/** Each kind's sections in order: the common ones and its own (`panel:<id>`). */
const ORDER = Object.freeze({
    'cell-gene': Object.freeze(['presets', 'text', 'background', 'axes', 'panel:dots', 'panel:sections', 'legend', 'panel:annotations', 'margins', 'export', 'apply']),
    'cell-count': Object.freeze(['presets', 'text', 'background', 'axes', 'panel:view3d', 'legend', 'margins', 'export', 'apply'])
});

/** The fonts offered: one list on every plot (utils/fonts.js); the default is Open Sans. */
const FONT_FAMILIES = FONT_CHOICES;

/** The legend's columns, at most (as Cell Plot's, utils/legend-options.js COLUMNS_MAX). */
const LEGEND_COLUMNS_MAX = 8;

/** The common fields. Labels are interface text in US spelling; the panel's own are its vocabulary's. */
const COMMON_FIELDS = Object.freeze(([
    // ---------------------------------------------------------------- Text
    { id: 'fontFamily', section: 'text', type: 'select', path: 'look.fontFamily', label: 'Font', choices: FONT_FAMILIES, dflt: DEFAULT_FONT },
    { id: 'fontSize', section: 'text', type: 'number', path: 'look.fontSize', label: 'Font size (px)', dflt: 12, min: 6, max: 36, step: 1 },
    { id: 'textColor', section: 'text', type: 'color', path: 'look.textColor', label: 'Text color', dflt: null },
    { id: 'plotTitle', section: 'text', type: 'text', path: 'titles.plot', label: 'Plot title', dflt: '', copy: false },
    { id: 'titleSize', section: 'text', type: 'number', path: 'look.titleSize', label: 'Title size (px)', dflt: null, min: 8, max: 48, step: 1,
        help: 'Empty: 4 px above the font size.' },
    // ---------------------------------------------------------------- Background
    { id: 'bgColor', section: 'background', type: 'color', path: 'look.bgColor', label: 'Background', dflt: null },
    // ---------------------------------------------------------------- Axes
    { id: 'grid', section: 'axes', type: 'check', path: 'look.grid', label: 'Grid lines', dflt: { 'cell-gene': false, 'cell-count': true } },
    { id: 'gridColor', section: 'axes', type: 'color', path: 'look.gridColor', label: 'Grid color', dflt: null },
    { id: 'gridWidth', section: 'axes', type: 'number', path: 'look.gridWidth', label: 'Grid width (px)', dflt: 1, min: 0.25, max: 4, step: 0.25 },
    { id: 'axisLines', section: 'axes', type: 'check', path: 'look.axisLines', label: 'Axis lines', dflt: false },
    { id: 'axisColor', section: 'axes', type: 'color', path: 'look.axisColor', label: 'Axis color', dflt: null },
    { id: 'axisWidth', section: 'axes', type: 'number', path: 'look.axisWidth', label: 'Axis line width (px)', dflt: 1, min: 0.25, max: 6, step: 0.25 },
    { id: 'tickMarks', section: 'axes', type: 'check', path: 'look.tickMarks', label: 'Tick marks', dflt: false },
    { id: 'axisTitles', section: 'axes', type: 'check', path: 'look.axisTitles', label: 'Axis titles', dflt: true, applies: ['cell-count'] },
    { id: 'tickLabels', section: 'axes', type: 'check', path: 'look.tickLabels', label: 'Tick labels', dflt: true, applies: ['cell-count'] },
    { id: 'zeroLines', section: 'axes', type: 'check', path: 'look.zeroLines', label: 'Zero lines', dflt: true, applies: ['cell-count'] },
    { id: 'tickCount', section: 'axes', type: 'number', path: 'look.tickCount', label: 'Ticks, about', dflt: null, min: 2, max: 30, step: 1,
        applies: ['cell-count'], help: 'Empty: automatic. Category axes keep one tick per level.' },
    // ---------------------------------------------------------------- Legend
    { id: 'showLegend', section: 'legend', type: 'check', path: 'look.showLegend', label: 'Show legend', dflt: true, applies: ['cell-count'] },
    { id: 'legendPosition', section: 'legend', type: 'select', path: 'look.legendPosition', label: 'Position', dflt: 'right', applies: ['cell-count'],
        choices: [['right', 'Right'], ['bottom', 'Bottom'], ['top', 'Top'], ['left', 'Left']] },
    { id: 'legendSpace', section: 'legend', type: 'number', path: 'look.legendSpace', label: 'Space (% of width)', dflt: null, min: 10, max: 60, step: 1,
        help: { 'cell-gene': 'Empty: as wide as the figure allows.', 'cell-count': 'Beside the plot. Empty: up to 60 %; longer labels are cut short.' } },
    { id: 'legendTitle', section: 'legend', type: 'check', path: 'look.legendTitle', label: 'Legend title', dflt: true, applies: ['cell-count'] },
    { id: 'legendColumnGap', section: 'legend', type: 'number', path: 'look.legendColumnGap', label: 'Column gap (px)', dflt: 24, min: 0, max: 80, step: 1,
        applies: ['cell-count'] },
    { id: 'legendColumns', section: 'legend', type: 'number', path: 'look.legendColumns', label: 'Columns', dflt: 1, min: 1, max: LEGEND_COLUMNS_MAX, step: 1 },
    { id: 'legendMax', section: 'legend', type: 'number', path: 'look.legendMax', label: 'Entries, at most', dflt: { 'cell-gene': 20, 'cell-count': 25 },
        min: 1, max: 500, step: 1, help: 'Past it: the first ones, then "+ N more".' },
    // ---------------------------------------------------------------- Margins (added to the room the plot makes for its labels)
    { id: 'marginTop', section: 'margins', type: 'number', path: 'look.margins.t', label: 'Top (px)', dflt: 0, min: 0, max: 300, step: 1 },
    { id: 'marginRight', section: 'margins', type: 'number', path: 'look.margins.r', label: 'Right (px)', dflt: 0, min: 0, max: 300, step: 1 },
    { id: 'marginBottom', section: 'margins', type: 'number', path: 'look.margins.b', label: 'Bottom (px)', dflt: 0, min: 0, max: 300, step: 1 },
    { id: 'marginLeft', section: 'margins', type: 'number', path: 'look.margins.l', label: 'Left (px)', dflt: 0, min: 0, max: 300, step: 1 },
    // ---------------------------------------------------------------- Export (the image's size; empty is the size on screen)
    { id: 'exportWidth', section: 'export', type: 'number', path: 'look.exportWidth', label: 'Width (px)', dflt: null, min: 100, max: 8000, step: 1 },
    { id: 'exportHeight', section: 'export', type: 'number', path: 'look.exportHeight', label: 'Height (px)', dflt: null, min: 100, max: 8000, step: 1 },
    { id: 'export2x', section: 'export', type: 'check', path: 'look.export2x', label: '2x resolution', dflt: true }
]).map(withVocabulary));

/** The words of each common section's heading. */
const SECTION_TITLES = Object.freeze({
    presets: 'Presets', text: 'Text', background: 'Background', axes: 'Axes', legend: 'Legend', margins: 'Margins', export: 'Export', apply: 'Apply'
});

const _panelFields = new Map();

/**
 * A panel's own fields, in the schema's format (cell-gene/options.js at load). Their `section` is a common one or
 * `panel:<id>`; `kinds` is set to the kind. Registering again replaces.
 * @param {string} kind
 * @param {Object[]} fields
 */
export function registerPanelFields(kind, fields) {
    _panelFields.set(kind, Object.freeze(fields.map((f) => Object.freeze({ ...withVocabulary(f), applies: [kind] }))));
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const COLOR = /^#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i;

/** The fields `kind` offers: the common ones it has, then its panel's. */
// export-unused-ok: the Node tests and WP-5b's Cell Plot and Gene Plot kinds read the fields
export function fieldsOf(kind) {
    const own = _kinds.get(kind);
    const takes = (f) => !f.applies || f.applies.includes(kind) || !!(own && own.applies && own.applies.includes(f.id));
    // a kind that stores its look at keys of its own (the Cell Plot and Gene Plot, WP-5b) takes no common field
    const common = own && own.common === false ? [] : COMMON_FIELDS.filter(takes);
    return [...common, ...(_panelFields.get(kind) || [])];
}

/** A field of `kind` by id, or null. */
// export-unused-ok: the Node tests and WP-5b's Cell Plot and Gene Plot kinds read the fields
export function fieldOf(kind, id) {
    return fieldsOf(kind).find((f) => f.id === id) || null;
}

/** The field's default for `kind`. */
export function defaultOf(field, kind) {
    const own = _kinds.get(kind);
    if (own && own.defaults && field.id in own.defaults) return own.defaults[field.id];
    const d = field.dflt;
    return isObject(d) && !Array.isArray(d) && Object.keys(d).some((k) => PLOT_KINDS.includes(k)) ? (kind in d ? d[kind] : null) : (d === undefined ? null : d);
}

/** A field's help line for `kind`, or ''. */
export function helpOf(field, kind) {
    const h = field.help;
    return typeof h === 'string' ? h : isObject(h) ? (h[kind] || '') : '';
}

function getPath(obj, path) {
    let at = obj;
    for (const key of path.split('.')) {
        if (!isObject(at) || !(key in at)) return undefined;
        at = at[key];
    }
    return at;
}

/** `obj` with `path` set to `value`, or removed when `value` is undefined; parents made, emptied parents removed. A copy. */
function setPath(obj, path, value) {
    const [key, ...rest] = path.split('.');
    const out = { ...obj };
    if (!rest.length) {
        if (value === undefined) delete out[key]; else out[key] = value;
        return out;
    }
    const child = setPath(isObject(obj[key]) ? obj[key] : {}, rest.join('.'), value);
    if (Object.keys(child).length) out[key] = child; else delete out[key];
    return out;
}

/** A stored value made usable for `field`, or undefined when it cannot be (then the default holds). */
function clean(field, v) {
    if (v === undefined || v === null) return undefined;
    switch (field.type) {
    case 'range':
    case 'number': {
        if (!isNumber(v)) return undefined;
        const step = isNumber(field.step) && field.step >= 1 ? 1 : null;
        // a range's `typedMax` (optional): what its number box takes past the slider's end (Cell-Gene's Largest dot)
        const top = field.type === 'range' && isNumber(field.typedMax) ? field.typedMax : field.max;
        const n = Math.max(field.min ?? -Infinity, Math.min(top ?? Infinity, step ? Math.round(v) : v));
        return n;
    }
    case 'check': return typeof v === 'boolean' ? v : undefined;
    case 'select': return !field.choices || field.choices.some(([value]) => value === v) ? v : undefined;
    case 'color': return typeof v === 'string' && COLOR.test(v) ? v : undefined;
    case 'text': return typeof v === 'string' ? v : undefined;
    case 'scaled': return isNumber(v) && v > 0 ? v : undefined;
    case 'margins': {
        if (!isObject(v)) return undefined;
        const out = { ...v };
        for (const k of ['t', 'r', 'b', 'l']) {
            if (!isNumber(v[k])) return undefined;
            out[k] = Math.max(field.min ?? 0, Math.min(field.max ?? Infinity, Math.round(v[k])));
        }
        return out;
    }
    default: return undefined;
    }
}

/** The value of `field` in `config`: stored and usable, else the kind's default. */
export function readField(config, field, kind) {
    const v = clean(field, getPath(isObject(config) ? config : {}, field.path));
    return v === undefined ? defaultOf(field, kind) : v;
}

/** Whether `config` stores a value of its own for `field` (not the default). */
export function isSet(config, field, kind) {
    if (field.unlinkedPath && getPath(isObject(config) ? config : {}, field.unlinkedPath) === true) return true;
    const v = clean(field, getPath(isObject(config) ? config : {}, field.path));
    return v !== undefined && !same(v, defaultOf(field, kind));
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * `config` with `field` set to `value` (a copy). A value equal to the default, null, or one the field cannot hold is
 * written as absent, so the configuration keeps only what differs.
 */
export function writeField(config, field, value, kind) {
    const v = clean(field, value);
    const stored = v === undefined || same(v, defaultOf(field, kind)) ? undefined : v;
    return setPath(isObject(config) ? config : {}, field.path, stored);
}

/** Every field's value for `kind`, by id: what a figure is drawn with (plot-style.js applyPlotStyle). */
export function resolveStyle(config, kind) {
    const out = { kind };
    for (const f of fieldsOf(kind)) out[f.id] = readField(config, f, kind);
    return out;
}

/** The fields Apply to other panels and the session default carry. */
function copiedFields(kind) {
    return fieldsOf(kind).filter((f) => f.copy !== false);
}

const hint = (field, name, config, env) => (typeof field[name] === 'function' ? field[name](isObject(config) ? config : {}, env || {}) : field[name]);

/** What an empty number box of `field` shows (the default it stands for), or null. */
export function placeholderOf(field, config, env) {
    const v = hint(field, 'placeholder', config, env);
    return v === undefined || v === null ? null : v;
}

/** The value a control of `field` shows while nothing is stored, or undefined when the field has no such rule. */
export function shownOf(field, config, env) {
    return hint(field, 'shown', config, env);
}

/** Why `field` is off now ('' when it is on). */
export function disabledOf(field, config, env) {
    const v = hint(field, 'disabled', config, env);
    return typeof v === 'string' ? v : (v ? 'Not available now.' : '');
}

/** A field's stored fraction as the percent a `percent` range shows, and back. */
export const toPercent = (v) => Math.round(v * 100);
export const fromPercent = (n) => n / 100;

/** The fields of `kind` that Reset puts back: every one but a view (`look: false`). */
export function resettable(fields) {
    return fields.filter((f) => f.look !== false);
}

/**
 * A margins field's value: the four sides and whether they are set one by one. Stored under `path` (an object, the
 * padding kept) and `unlinkedPath`; each is absent while at its default.
 * @returns {{sides: Object, unlinked: boolean}}
 */
export function readMargins(config, field, kind) {
    const dflt = defaultOf(field, kind);
    const sides = readField(config, field, kind);
    const un = getPath(isObject(config) ? config : {}, field.unlinkedPath);
    return { sides: { ...dflt, ...sides }, unlinked: un === true };
}

/** `config` with a margins field set (a copy); values at the default are written as absent. */
export function writeMargins(config, field, { sides, unlinked }, kind) {
    let out = writeField(config, field, sides, kind);
    out = setPath(out, field.unlinkedPath, unlinked === true ? true : undefined);
    return out;
}

/**
 * A `scaled` field's automatic switch (`autoPath`, a boolean the plot stores as it is): the point size, a slider on a log scale
 * with its number box and an Auto that makes the value follow the number of points.
 */
export function readAuto(config, field) {
    return getPath(isObject(config) ? config : {}, field.autoPath) === true;
}

/** `config` with a scaled field's automatic switch set (a copy); the value is the field's own. */
export function writeAuto(config, field, auto) {
    return setPath(isObject(config) ? config : {}, field.autoPath, auto === true);
}

/** The paths a look of `kind` may hold (what utils/session-style.js keeps of a stored default). */
export function lookPaths(kind) {
    return copiedFields(kind).map((f) => f.path);
}

/**
 * The look of `config` as a copy: each copied field's own value by path, null where it is at its default, so that
 * adopting it on another plot puts that one at its default too.
 */
export function pickLook(config, kind) {
    const out = {};
    for (const f of copiedFields(kind)) out[f.path] = isSet(config, f, kind) ? readField(config, f, kind) : null;
    return out;
}

/** `config` with a picked look on it (a copy): every copied field takes the look's value, a null or absent one its default. */
export function adoptLook(config, look, kind) {
    let out = isObject(config) ? { ...config } : {};
    const from = isObject(look) ? look : {};
    for (const f of copiedFields(kind)) out = writeField(out, f, from[f.path] ?? null, kind);
    return out;
}

/** Of a picked look, only what differs from the kind's defaults (a session default keeps no more). */
export function lookDiff(look) {
    const out = {};
    for (const [k, v] of Object.entries(isObject(look) ? look : {})) if (v !== null && v !== undefined) out[k] = v;
    return out;
}

/** The sections of `kind` in order, each `{ id, title?, panel: boolean, fields }` (a panel section's title is its own). */
export function sectionsOf(kind) {
    const fields = fieldsOf(kind);
    const own = _kinds.get(kind);
    return ((own && own.order) || ORDER[kind] || COMMON_SECTIONS).map((id) => {
        const panel = id.startsWith('panel:');
        return { id, panel, title: panel ? undefined : SECTION_TITLES[id], fields: fields.filter((f) => f.section === id) };
    });
}

/**
 * Declare a kind (WP-5b: the Cell Plot and the Gene Plot): `order` its sections, `defaults` its own default per field
 * id, `applies` the ids of common fields limited to other kinds that it takes too, `presets` its preset values,
 * `common: false` for a kind whose fields are all its own (registerPanelFields), at the keys it has always stored.
 * @param {string} kind
 * @param {{order?: string[], defaults?: Object, applies?: string[], presets?: Object, common?: boolean}} spec
 */
export function registerKind(kind, spec) {   // spec.preset(config, name): the kind's own presets, replacing the generic values
    _kinds.set(kind, Object.freeze({ ...spec }));
}

/** The preset names, in the order Presets offers them. */
export const PRESETS = Object.freeze(['default', 'publication', 'bare']);

/** The words of the presets' buttons. */
export const PRESET_LABELS = Object.freeze({ default: 'Default', publication: 'Publication', bare: 'Bare' });

/**
 * A preset's values by field id. Default puts every copied field back to the kind's default (the titles stay).
 * Publication, as Cell Plot's: white background, black text and lines, Arial 16, no grid, axis lines and tick marks
 * on. Bare: only the data (no grid, no axis lines, no tick marks, no legends, no extra margins). A kind's own presets
 * (`registerKind`) are laid over these.
 * @returns {Object<string, *>} null for a field means its default
 */
function presetValues(name, kind) {
    const out = {};
    if (name === 'default') {
        for (const f of copiedFields(kind)) if (f.section !== 'export') out[f.id] = null;
    } else if (name === 'publication') {
        Object.assign(out, { bgColor: '#ffffff', textColor: '#000000', axisColor: '#000000', fontFamily: ARIAL,
            fontSize: 16, grid: false, axisLines: true, axisWidth: 1.5, tickMarks: true, zeroLines: false });
    } else if (name === 'bare') {
        Object.assign(out, { grid: false, axisLines: false, tickMarks: false, showLegend: false, colorBar: false, sizeLegend: false,
            strips: false, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 });
    }
    const own = _kinds.get(kind);
    Object.assign(out, own && own.presets && own.presets[name]);
    const ids = new Set(fieldsOf(kind).map((f) => f.id));
    return Object.fromEntries(Object.entries(out).filter(([id]) => ids.has(id)));
}

/** Whether `kind` decides its presets itself (`registerKind` `preset`), Default included. */
export function hasOwnPresets(kind) {
    const own = _kinds.get(kind);
    return !!(own && typeof own.preset === 'function');
}

/** `config` with a preset on it (a copy). */
export function applyPreset(config, name, kind) {
    const own = _kinds.get(kind);
    if (own && typeof own.preset === 'function') return own.preset(config, name);
    let out = config;
    for (const [id, v] of Object.entries(presetValues(name, kind))) out = writeField(out, fieldOf(kind, id), v, kind);
    return out;
}
