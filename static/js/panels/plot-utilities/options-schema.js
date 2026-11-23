/**
 * The shared Plot Options of the new plot panels (WP-5a; design note options-ux-080 sections 2f, 3.1, 4 and 5; operator
 * decisions 25, 30 and 33): what the pop-over offers, where each value is stored, and each plot kind's own defaults.
 * Pure (no DOM, no Plotly), so annzarro/tests/js/plot-style.test.mjs holds it in Node. The pop-over that shows it is
 * options-popover.js; what the values do to a figure is plot-style.js.
 *
 * SECTIONS. Every kind has the common sections Text, Background, Axes, Legend, Margins, Export and Apply, in that order,
 * and its own sections between them: the Cell-Gene Plot's Dots, Sections and Annotations (cell-gene/options.js declares
 * them in this format and registers them here, `registerPanelFields`), the Cell Count Plot's Count Plot section (its
 * controls, cell-count/controls.js). A panel's fields may also join a common section: Cell-Gene's gene and group labels
 * are in Axes, its colour bar, size legend and strip switches and titles in Legend.
 *
 * FIELDS. `{ id, section, type, path, label, dflt, min, max, step, choices, kinds, copy, when, help }`:
 *  - `type`: 'number' (an empty box is the default), 'check', 'select', 'color' (with Auto: the app theme), 'text'.
 *  - `path`: where the value lives in the panel's configuration, dotted. The common look is under `look`
 *    (`look.fontSize`); a panel field keeps the key it always had (`outline.width`, `labels.genes`), so links made before
 *    this keep their meaning. A value at its default is written as absent, and an object left empty goes (links stay short).
 *  - `dflt`: a value, or `{ [kind]: value }` for a per-kind default (the Cell-Gene Plot draws no grid by default, the
 *    count plot does; the legend's entry cap differs).
 *  - `kinds`: the kinds that offer it (all when absent). `copy`: whether Apply to other panels and the session default
 *    carry it (true when absent; a plot's own title is not a look and is not copied). `when(config)`: shown only then.
 *
 * Both kinds also have the session default (`STYLE_TYPES` of utils/session-style.js gains them): a plot made from the
 * chooser is on Default (`styleDefault: true`) and follows it; any change of its look gives it its own.
 */

/** The plot kinds on the shared Plot Options: panel types. */
export const PLOT_KINDS = Object.freeze(['cell-gene', 'cell-count']);

/** Where the common look lives in a configuration. */
export const LOOK_KEY = 'look';

/** The common sections, in the pop-over's order; a panel's own sections go where its kind's `ORDER` puts them. */
export const COMMON_SECTIONS = Object.freeze(['text', 'background', 'axes', 'legend', 'margins', 'export', 'apply']);

/** Each kind's sections in order: the common ones and its own (`panel:<id>`). */
export const ORDER = Object.freeze({
    'cell-gene': Object.freeze(['text', 'background', 'axes', 'panel:dots', 'panel:sections', 'legend', 'panel:annotations', 'margins', 'export', 'apply']),
    'cell-count': Object.freeze(['text', 'background', 'axes', 'panel:count', 'legend', 'margins', 'export', 'apply'])
});

/** The fonts offered, as Cell Plot's Plot Options names them; '' is the kind's default font. */
export const FONT_FAMILIES = Object.freeze([
    ['Arial, Helvetica, sans-serif', 'Arial'],
    ["'Times New Roman', Times, serif", 'Times New Roman'],
    ['Courier, monospace', 'Courier'],
    ['Georgia, serif', 'Georgia'],
    ["'Trebuchet MS', sans-serif", 'Trebuchet MS'],
    ['Verdana, sans-serif', 'Verdana'],
    ['"Open Sans", verdana, arial, sans-serif', 'Open Sans']
]);

/** Where a count plot's legend can go (the Cell-Gene Plot's legends are a column on the right, always). */
export const LEGEND_POSITIONS = Object.freeze(['right', 'bottom', 'top', 'left']);

/** The legend's columns, at most (as Cell Plot's, utils/legend-options.js COLUMNS_MAX). */
export const LEGEND_COLUMNS_MAX = 8;

/** The common fields. Labels are interface text in US spelling; the panel's own are its vocabulary's. */
const COMMON_FIELDS = Object.freeze([
    // ---------------------------------------------------------------- Text
    { id: 'fontFamily', section: 'text', type: 'select', path: 'look.fontFamily', label: 'Font', choices: FONT_FAMILIES,
        dflt: { 'cell-gene': 'Arial, Helvetica, sans-serif', 'cell-count': '"Open Sans", verdana, arial, sans-serif' } },
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
    // ---------------------------------------------------------------- Legend
    { id: 'showLegend', section: 'legend', type: 'check', path: 'look.showLegend', label: 'Show legend', dflt: true, kinds: ['cell-count'] },
    { id: 'legendPosition', section: 'legend', type: 'select', path: 'look.legendPosition', label: 'Position', dflt: 'right', kinds: ['cell-count'],
        choices: [['right', 'Right'], ['bottom', 'Bottom'], ['top', 'Top'], ['left', 'Left']] },
    { id: 'legendSpace', section: 'legend', type: 'number', path: 'look.legendSpace', label: 'Space (% of width)', dflt: null, min: 10, max: 60, step: 1,
        help: { 'cell-gene': 'Empty: as wide as the figure allows.', 'cell-count': 'Beside the plot. Empty: up to 60 %; longer labels are cut short.' } },
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
]);

/** The words of each common section's heading. */
export const SECTION_TITLES = Object.freeze({
    text: 'Text', background: 'Background', axes: 'Axes', legend: 'Legend', margins: 'Margins', export: 'Export', apply: 'Apply'
});

const _panelFields = new Map();

/**
 * A panel's own fields, in the schema's format (cell-gene/options.js at load). Their `section` is a common one or
 * `panel:<id>`; `kinds` is set to the kind. Registering again replaces.
 * @param {string} kind
 * @param {Object[]} fields
 */
export function registerPanelFields(kind, fields) {
    _panelFields.set(kind, Object.freeze(fields.map((f) => Object.freeze({ ...f, kinds: [kind] }))));
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const COLOR = /^#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i;

/** The fields `kind` offers: the common ones it has, then its panel's. */
export function fieldsOf(kind) {
    return [...COMMON_FIELDS.filter((f) => !f.kinds || f.kinds.includes(kind)), ...(_panelFields.get(kind) || [])];
}

/** A field of `kind` by id, or null. */
export function fieldOf(kind, id) {
    return fieldsOf(kind).find((f) => f.id === id) || null;
}

/** The field's default for `kind`. */
export function defaultOf(field, kind) {
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
    case 'number': {
        if (!isNumber(v)) return undefined;
        const step = isNumber(field.step) && field.step >= 1 ? 1 : null;
        const n = Math.max(field.min ?? -Infinity, Math.min(field.max ?? Infinity, step ? Math.round(v) : v));
        return n;
    }
    case 'check': return typeof v === 'boolean' ? v : undefined;
    case 'select': return field.choices.some(([value]) => value === v) ? v : undefined;
    case 'color': return typeof v === 'string' && COLOR.test(v) ? v : undefined;
    case 'text': return typeof v === 'string' ? v : undefined;
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
export function copiedFields(kind) {
    return fieldsOf(kind).filter((f) => f.copy !== false);
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
    return (ORDER[kind] || COMMON_SECTIONS).map((id) => {
        const panel = id.startsWith('panel:');
        return { id, panel, title: panel ? undefined : SECTION_TITLES[id], fields: fields.filter((f) => f.section === id) };
    });
}
