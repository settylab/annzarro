/**
 * The Cell-Gene Plot's Cluster ▾ and Plot Options (0.8.0 step X5; UX 3.1, 3.3, 3.4 and 7; CXG-6, CXG-10, CXG-12 to
 * CXG-14, CXG-20 to CXG-26; requirements 5.3, the scanpy extras).
 *
 * TWO HALVES.
 * - What the options SAY to the drawing, pure, so Node tests hold it: `figureExtras(config, ctx)` turns the style fields
 *   into the fields of draw.js's model (color scale, dot sizes, titles, legends, printed values) and of
 *   draw-annotations.js's (brackets, strips, totals, dendrograms, labels); `barSettings(config)` is the color bars'
 *   Min, Max, Center and title, which the drawing and the clustering both read (operator decision 19); `clusterOf`
 *   is the clustering's settings with scanpy's defaults (OD 16).
 * - The menus (`OPTIONS_PART`), mounted by panels/cell-gene.js in the control grid's Layout group: Cluster ▾ (UX 3.4)
 *   and Plot Options (UX 3.1), with Show as table and Download CSV (UX 7, CXG-20), both from the CSV's rows
 *   (utils/cell-gene-model.js `longRows`). Every change is one undoable step of the panel (`ctx.set(patch, label)`).
 *
 * STYLE FIELDS (plan 1.6: additive, default when absent, never frozen): `colorScale`, `limits: [min, max]`, `center`,
 * `printValues`, `dotSizes: [smallest, largest]` (px), `dotMin`, `dotMax` (% at the smallest and largest dot), `gap`
 * (0 to 3 cells), `sectionTitles`, `labels: {genes, groups}`, `titles: {plot, color, size}`, `legend: {colorBar,
 * sizeLegend, strips}`, `totals`, `sortGroups`, and `cluster.dendrograms` beside the frozen cluster fields. A field at
 * its default is written as absent, so links stay short.
 *
 * COST. The menus repaint from the configuration and the drawing the panel last made; a repaint walks no gene, cell or
 * group. The table is built when it is shown and again only when the drawing changes.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { Config } from '../../config.js';
import { scaleOptionLabel, plotlyColorscale, DIVERGING_SCALES } from '../../utils/color-scales.js';
import { defaultLabelMaps, sourceName } from '../../utils/cell-grouping.js';
import { RESERVED } from '../../utils/level-id.js';
import { GAP_COLOUR } from '../../utils/plot-theme.js';
import { MAX_ROWS } from '../../utils/hclust.js';
import { longRows, longCsv } from '../../utils/cell-gene-model.js';
import { generateDiscreteColors } from '../plot-utilities/colors.js';
import { tableView, tableElement } from '../cell-count/table-view.js';
import { dendrogramBlocks } from './draw-annotations.js';
import { needsThreshold } from './sections.js';

const WO = VOCABULARY.cellGene.options;
const TABLE = VOCABULARY.table;

const SCALES = Object.freeze((Config && Config.DEFAULTS && Config.DEFAULTS.COLOR_SCALES) || ['Viridis']);
const DEFAULT_SCALE = 'Reds';
const Z_DEFAULT_SCALE = 'RdBu';
const Z_SCALINGS = Object.freeze(['z_groups', 'z_pooled']);
const DEFAULT_OUTLINE = Object.freeze({ color: '#000', width: 0.5 });
const OUTLINE_MAX = 3;
const DEFAULT_GAP = 1;
const GAP_MAX = 3;
const DOT_PX = Object.freeze({ min: 1, max: 40, smallest: 3, largest: 20 });
const DEFAULT_CLUSTER = Object.freeze({ genes: 'off', groups: 'off', linkage: 'complete', distance: 'correlation', dendrograms: true });
const GENE_SCOPES = Object.freeze(['off', 'sections']);
const GROUP_SCOPES = Object.freeze(['off', 'all', 'first']);
const LINKAGES = Object.freeze(['complete', 'average', 'ward']);
const DISTANCES = Object.freeze(['correlation', 'euclidean']);

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' ? v : '');
const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);

// ================================================================================================ the options' values

/**
 * The clustering's settings: the stored ones, scanpy's defaults where absent (complete linkage, Pearson correlation,
 * OD 16), and Ward only with Euclidean distance (CXG-21).
 * @param {Object} config - the plot's configuration
 * @returns {{genes: string, groups: string, linkage: string, distance: string, dendrograms: boolean}}
 */
function clusterOf(config) {
    const c = isObject(config && config.cluster) ? config.cluster : {};
    const out = {
        genes: pick(c.genes, GENE_SCOPES, DEFAULT_CLUSTER.genes),
        groups: pick(c.groups, GROUP_SCOPES, DEFAULT_CLUSTER.groups),
        linkage: pick(c.linkage, LINKAGES, DEFAULT_CLUSTER.linkage),
        distance: pick(c.distance, DISTANCES, DEFAULT_CLUSTER.distance),
        dendrograms: c.dendrograms !== false
    };
    if (out.linkage === 'ward') out.distance = 'euclidean';
    return out;
}

/** A [lo, hi] pair of numbers within [min, max], lo < hi, or null. */
function rangeOf(v, min, max) {
    if (!Array.isArray(v) || v.length !== 2 || !isNumber(v[0]) || !isNumber(v[1])) return null;
    const lo = Math.max(min, Math.min(max, v[0]));
    const hi = Math.max(min, Math.min(max, v[1]));
    return lo < hi ? [lo, hi] : null;
}

/** The style fields as the drawing reads them, defaults filled in. */
function styleOf(config) {
    const c = config || {};
    const legend = isObject(c.legend) ? c.legend : {};
    const labels = isObject(c.labels) ? c.labels : {};
    const titles = isObject(c.titles) ? c.titles : {};
    const gap = isNumber(c.gap) ? Math.round(Math.max(0, Math.min(GAP_MAX, c.gap))) : DEFAULT_GAP;
    // A stored map is the user's pick and is kept; with none stored the default follows the scaling (Reds, RdBu under a z-score)
    const picked = SCALES.includes(c.colorScale);
    const zScored = Z_SCALINGS.includes(c.scale);
    const colorScale = picked ? c.colorScale : zScored ? Z_DEFAULT_SCALE : DEFAULT_SCALE;
    const center = isNumber(c.center) && DIVERGING_SCALES.has(colorScale) ? c.center : !picked && !isNumber(c.center) && zScored ? 0 : null;
    const o = isObject(c.outline) ? c.outline : {};
    return {
        colorScale, gap, center, picked,
        outline: {
            color: typeof o.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(o.color) ? o.color : DEFAULT_OUTLINE.color,
            width: isNumber(o.width) ? Math.max(0, Math.min(OUTLINE_MAX, o.width)) : DEFAULT_OUTLINE.width
        },
        printValues: c.printValues === true,
        dotSizes: rangeOf(c.dotSizes, DOT_PX.min, DOT_PX.max),
        dotMin: isNumber(c.dotMin) ? c.dotMin : null,
        dotMax: isNumber(c.dotMax) ? c.dotMax : null,
        sectionTitles: c.sectionTitles !== false,
        labels: { genes: labels.genes !== false, groups: labels.groups !== false },
        titles: { plot: text(titles.plot), color: text(titles.color), size: text(titles.size) },
        legend: { colorBar: legend.colorBar !== false, sizeLegend: legend.sizeLegend !== false, strips: legend.strips !== false },
        totals: c.totals === true,
        sortGroups: c.sortGroups === true
    };
}

/**
 * The color bars' settings the options give: Min and Max (`limits`), a Center for a diverging scale, the color bar's
 * title. The panel passes them to colourBars for the drawing and the clustering alike (operator decision 19).
 * @param {Object} config
 * @returns {{min?: number, max?: number, center?: number, title?: string}}
 */
export function barSettings(config) {
    const s = styleOf(config);
    const limits = Array.isArray(config && config.limits) ? config.limits : [];
    const out = {};
    if (isNumber(limits[0])) out.min = limits[0];
    if (isNumber(limits[1])) out.max = limits[1];
    if (s.center !== null) out.center = s.center;
    if (s.titles.color) out.title = s.titles.color;
    return out;
}

/**
 * Plot Options' Size threshold (scanpy's `expression_cutoff` for the size statistic): a number, or null to read Size
 * with Color's threshold again.
 * @param {Object} config
 * @param {number|null} value
 * @returns {Object} the configuration with that threshold
 */
function withSizeThreshold(config, value) {
    const size = { ...config.size };
    if (isNumber(value)) size.detect_above = value; else delete size.detect_above;
    return { ...config, size };
}

/**
 * The help lines under the scaling (UX 3.3): what every scaling skips, and under z-score against all grouped cells
 * that a one-row section is z-scored across its own groups (it has no pooled moments of its own; accepted ruling).
 * @param {Object} config
 * @returns {string[]}
 */
function scalingNotes(config) {
    const scale = config && config.scale;
    if (!scale || scale === 'none') return [];
    return scale === 'z_pooled' ? [WO.scalingNote, WO.pooledNote] : [WO.scalingNote];
}

// ================================================================================================ strips and trees

/**
 * One strip per factor of the cell axis (CXG-14): each drawn group's level, colored by its factor's levels (a
 * categorical column's own colors where the reply has them, the app's palette by level otherwise), and the legend of
 * the strip, the factor's levels in level order. The collected small group takes the gap color and no level.
 * @param {Object} reply - the cell axis's reply
 * @param {Object} recipe - the grouping recipe the reply is of
 * @param {Int32Array} groupOrder - the reply's group at each drawn position
 * @param {(source: Object) => (string|undefined)} titleOf
 * @returns {{title: string, colours: string[], levels: string[], legend: {label: string, colour: string}[]}[]}
 */
function groupStrips(reply, recipe, groupOrder, titleOf) {
    const parts = recipe && Array.isArray(recipe.partitionings) ? recipe.partitionings : [];
    if (!reply || !Array.isArray(reply.groups) || !Array.isArray(reply.partitionings) || reply.partitionings.length !== parts.length) return [];
    const maps = defaultLabelMaps(recipe, reply, titleOf);
    return parts.map((p, i) => {
        const info = reply.partitionings[i] || {};
        const levels = Array.isArray(info.levels) ? info.levels : [];
        const own = !p.binning && isObject(info.colors) ? info.colors : null;
        const palette = generateDiscreteColors(Math.max(1, levels.length));
        const at = new Map(levels.map((id, k) => [id, k]));
        const label = (id) => (p.labels && p.labels[id]) || maps[i].get(id) || id;
        const colour = (id) => (own && own[id]) || (at.has(id) ? palette[at.get(id) % palette.length] : GAP_COLOUR);
        const colours = [];
        const names = [];
        for (const g of groupOrder) {
            const key = reply.groups[g] ? reply.groups[g].key : null;
            if (!key || (key.length === 1 && key[0] === RESERVED.small) || key[i] === undefined) {
                colours.push(GAP_COLOUR);
                names.push('');
            } else {
                colours.push(colour(key[i]));
                names.push(label(key[i]));
            }
        }
        return { title: sourceName(p.source, titleOf), colours, levels: names, legend: levels.map((id) => ({ label: label(id), colour: colour(id) })) };
    });
}

/** The dendrograms of the clustered blocks, when Dendrograms is on (CXG-24). */
function dendrogramsOf(cluster, order) {
    if (!cluster.dendrograms || !order) return {};
    const out = {};
    if (cluster.genes !== 'off' && order.rowBlocks && order.rowBlocks.length) out.genes = dendrogramBlocks(order.rowBlocks, order.rows);
    if (cluster.groups !== 'off' && order.groupBlocks && order.groupBlocks.length) out.groups = dendrogramBlocks(order.groupBlocks, order.groups);
    return out;
}

/**
 * What the options add to the drawing model of draw.js and draw-annotations.js, and what the panel orders by.
 * @param {Object} config - the plot's configuration
 * @param {{reply?: Object, recipe?: Object, order?: Object, titleOf?: Function}} [ctx] - the cell axis's reply and its
 *   recipe, cell-gene-order.js's answer for the matrix, and the title of a panel behind a source; without them no
 *   strip and no tree
 * @returns {{color: Object, size: Object, legend: Object, plotTitle: (string|undefined), annotations: Object,
 *   gap: number, sortBySize: boolean, cluster: Object}}
 */
export function figureExtras(config, { reply, recipe, order, titleOf } = {}) {
    const s = styleOf(config);
    const cluster = clusterOf(config);
    const color = { colorscale: plotlyColorscale(s.colorScale) };
    if (config && config.mode === 'heatmap' && s.printValues) color.printValues = true;
    const size = {};
    if (s.dotSizes) [size.smallest, size.largest] = s.dotSizes;
    if (s.dotMin !== null) size.dotMin = s.dotMin;
    if (s.dotMax !== null) size.dotMax = s.dotMax;
    if (s.titles.size) size.title = s.titles.size;
    const outline = s.outline.width > 0 ? { color: s.outline.color, width: s.outline.width } : null;
    return {
        color, size, outline, legend: s.legend, plotTitle: s.titles.plot || undefined, gap: s.gap, sortBySize: s.sortGroups, cluster,
        annotations: {
            brackets: { titles: s.sectionTitles },
            totals: s.totals,
            labels: s.labels,
            strips: order ? groupStrips(reply, recipe, order.groups, titleOf) : [],
            dendrograms: dendrogramsOf(cluster, order)
        }
    };
}

// ================================================================================================ the table

/**
 * The drawing as the CSV's table (CXG-20): one column for Color as computed, one as displayed when a scaling is on, one
 * for Size in dots; a one-row section with a quantity of its own gets its own column, named with the section, filled
 * on its row only. Rows and groups in the drawn order.
 * @param {Object} model - the drawing model the panel last drew (draw.js)
 * @returns {Parameters<typeof longRows>[0]}
 */
// export-unused-ok: X6 compares the CSV of a link with the oracle
export function tableOf(model) {
    const G = model.groups.length;
    const R = model.rows.length;
    const columns = [];
    const add = (which, spec, valuesOf, scaling) => {
        const main = { stat: spec.stat, layer: spec.layer, scaling, values: new Float64Array(R * G).fill(NaN) };
        const own = new Map();
        model.rows.forEach((row, r) => {
            const mine = row.own && row.own[which];
            let column = main;
            if (mine && mine.id !== spec.id) {
                if (!own.has(mine.id)) own.set(mine.id, { label: mine.label, section: row.section.title, scaling, values: new Float64Array(R * G).fill(NaN) });
                column = own.get(mine.id);
            }
            const from = valuesOf();
            for (let g = 0; g < G; g++) column.values[r * G + g] = from[r * G + g];
        });
        if (which === 'color' && spec.noExpressing && scaling === 'none') main.noExpressing = spec.noExpressing;
        return [main, ...own.values()];
    };
    const color = model.color;
    columns.push(...add('color', color, () => color.raw || color.values, 'none'));
    if (color.scaling && color.scaling !== 'none') columns.push(...add('color', color, () => color.values, color.scaling));
    if (model.mode === 'dots' && model.size && model.size.values) columns.push(...add('size', model.size, () => model.size.values, 'none'));
    return {
        groups: model.groups.map((g) => ({ label: g.label, n: g.n })),
        rows: model.rows.map((row) => ({ section: row.section ? row.section.title : '', label: row.label })),
        columns
    };
}

// ================================================================================================ the menus

/** The clustering's sentences for the drawing (CXG-24, CXG-25): rows and groups left out, blocks too large. */
function clusterNotes(drawn) {
    if (!drawn || !drawn.order) return [];
    const { order, model } = drawn;
    const out = [];
    for (const block of order.rowBlocks || []) {
        if (block.state !== 'too_many') continue;
        const row = model.rows[block.start];
        out.push(WO.tooMany(row && row.section ? row.section.title : '', block.count, MAX_ROWS));
    }
    if (order.rowsLeftOut) out.push(WO.leftOut(order.rowsLeftOut, 'row'));
    if (order.groupsLeftOut) out.push(WO.leftOut(order.groupsLeftOut, VOCABULARY.word.group));
    return out;
}

/** A file name from the plot's title. */
const fileName = (title) => `${String(title || 'cell-gene').replace(/[^\w.-]+/g, '_') || 'cell-gene'}.csv`;

/**
 * Mount the menus.
 * @param {HTMLElement} slot - the control grid's Layout slot
 * @param {{panelId: string, D: Object, config: () => Object, set: (patch: Object, label: string) => void, undo: () => boolean,
 *   drawn: () => ({model: Object, order: Object}|null), recipe: () => (Object|null), titleOf: Function, title: () => string,
 *   menuHost: HTMLElement, tableHost: HTMLElement}} ctx - `recipe` is the grouping recipe the cell axis's groups are of;
 *   the menus open in `menuHost`, the width of the control grid, and the table is drawn in `tableHost`
 * @returns {{update: () => void, destroy: () => void}}
 */
function mount(slot, ctx) {
    const { el, clear } = ctx.D;
    const id = ctx.panelId;
    const open = { cluster: false, options: false };
    let wardAfter = null;          // the configuration Ward's switch made, while its sentence and Undo show
    let tableShown = false;
    let tableFrom = null;
    const listeners = [];

    const config = () => ctx.config();
    const stored = (key) => (isObject(config()[key]) ? config()[key] : {});
    const setCluster = (patch, label) => ctx.set({ cluster: { ...clusterOf(config()), ...patch } }, label);

    // ---------------------------------------------------------------- Cluster ▾ (UX 3.4)
    const clusterBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgene-cluster-btn',
        aria: { expanded: 'false', controls: `cgene-cluster-${id}` }, on: { click: () => toggle('cluster') } }, WO.cluster);
    const scopeRow = (scope, label) => el('div', { class: 'cgene-cluster-scope', role: 'radiogroup', aria: { label }, data: { scope } },
        el('span', { class: 'cgene-field__label', text: label }));
    const genesRow = scopeRow('genes', WO.clusterGenes);
    const groupsRow = scopeRow('groups', WO.clusterGroups);
    const summary = el('p', { class: 'cgene-cluster-summary cgene-help' });
    const clusterMenu = el('div', { class: 'cgene-cluster-menu cgene-menu', id: `cgene-cluster-${id}`, role: 'group', aria: { label: WO.heading.clustering },
        hidden: true }, genesRow, groupsRow, summary);
    const note = el('div', { class: 'cgene-cluster-note cgene-help', role: 'status', aria: { live: 'polite' } });

    /** A scope's radios, made again only when its entries change (a factor more or less), so focus stays put. */
    function radios(row, scope, entries, value) {
        const sig = JSON.stringify(entries);
        if (row.dataset.entries !== sig) {
            row.dataset.entries = sig;
            const name = `cgene-cluster-${scope}-${id}`;
            while (row.childNodes.length > 1) row.removeChild(row.lastChild);
            for (const [v, label] of entries) {
                row.appendChild(el('label', { class: 'cgene-radio' },
                    el('input', { type: 'radio', name, value: v,
                        on: { change: (e) => { if (e.target.checked) setCluster({ [scope]: v }, `cluster ${scope} ${label.toLowerCase()}`); } } }),
                    ` ${label}`));
            }
        }
        for (const input of row.querySelectorAll('input')) input.checked = input.value === value;
    }

    // ---------------------------------------------------------------- Plot Options (UX 3.1)
    const optionsBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgene-options-btn',
        aria: { expanded: 'false', controls: `cgene-options-${id}` }, on: { click: () => toggle('options') } }, WO.plotOptions);
    const controls = {};
    const field = (label, control) => el('label', { class: 'cgene-field' }, el('span', { class: 'cgene-field__label', text: label }), control);
    const check = (name, label, onChange) => {
        controls[name] = el('input', { type: 'checkbox', data: { option: name }, on: { change: (e) => onChange(e.target.checked) } });
        return el('label', { class: 'cgene-opt' }, controls[name], ` ${label}`);
    };
    /** A number box that commits on change or Enter; an empty box is the default. */
    const number = (name, label, onCommit, attrs = {}) => {
        const input = el('input', { type: 'number', class: 'form-control form-control-sm cgene-num', data: { option: name }, aria: { label }, ...attrs });
        const commitIt = () => {
            const raw = input.value.trim();
            const v = raw === '' ? null : Number(raw);
            if (v !== null && !Number.isFinite(v)) { paint(); return; }
            onCommit(v);
        };
        input.addEventListener('change', commitIt);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitIt(); } });
        controls[name] = input;
        return field(label, input);
    };
    const words = (name, label, onCommit) => {
        const input = el('input', { type: 'text', class: 'form-control form-control-sm cgene-title-input', data: { option: name }, aria: { label }, autocomplete: 'off' });
        const commitIt = () => onCommit(input.value.trim());
        input.addEventListener('change', commitIt);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitIt(); } });
        controls[name] = input;
        return field(label, input);
    };
    const select = (name, label, entries, onChange) => {
        const s = el('select', { class: 'form-select form-select-sm', data: { option: name }, aria: { label }, on: { change: () => onChange(s.value) } },
            entries.map(([v, t]) => el('option', { value: v, text: t })));
        controls[name] = s;
        return field(label, s);
    };
    const section = (heading, ...children) => el('fieldset', { class: 'cgene-options__section' }, el('legend', { text: heading }), ...children);
    const nested = (key, sub, value, dflt, label) => {
        const next = { ...stored(key) };
        if (value === dflt) delete next[sub]; else next[sub] = value;
        ctx.set({ [key]: Object.keys(next).length ? next : undefined }, label);
    };
    const flat = (key, value, dflt, label) => ctx.set({ [key]: value === dflt ? undefined : value }, label);
    const onOff = (on, label) => `${on ? '' : 'no '}${label.toLowerCase()}`;

    // Dots
    const dotRow = el('div', { class: 'cgene-dot-range', role: 'group', aria: { label: WO.dotSizes } },
        el('span', { class: 'cgene-field__label', text: WO.dotSizes }));
    const dotEnd = (name, which) => {
        const input = el('input', { type: 'range', min: DOT_PX.min, max: DOT_PX.max, step: 1, data: { option: name }, aria: { label: `${WO.dotSizes}: ${which}` },
            on: { change: () => setDots() } });
        controls[name] = input;
        dotRow.appendChild(input);
    };
    dotEnd('dotSmallest', 'smallest');
    dotEnd('dotLargest', 'largest');
    function setDots() {
        const lo = Number(controls.dotSmallest.value);
        const hi = Number(controls.dotLargest.value);
        const range = rangeOf([Math.min(lo, hi), Math.max(lo, hi)], DOT_PX.min, DOT_PX.max);
        const plain = !range || (range[0] === DOT_PX.smallest && range[1] === DOT_PX.largest);
        ctx.set({ dotSizes: plain ? undefined : range }, 'dot sizes');
    }
    const sizeThreshold = number('sizeThreshold', WO.sizeThreshold, (v) => ctx.set(withSizeThreshold(config(), v), 'size threshold'),
        { step: 'any', placeholder: WO.sameAsColor });
    const outlineInput = el('input', { type: 'color', class: 'form-control form-control-sm form-control-color', data: { option: 'outlineColor' }, aria: { label: WO.outlineColor },
        on: { change: (e) => nested('outline', 'color', e.target.value, DEFAULT_OUTLINE.color, 'dot outline color') } });
    controls.outlineColor = outlineInput;
    const outlineColor = field(WO.outlineColor, outlineInput);
    const dots = section(WO.heading.dots, dotRow,
        number('dotMin', WO.dotMin, (v) => flat('dotMin', v, null, 'percent at the smallest dot'), { min: 0, max: 100, step: 'any' }),
        number('dotMax', WO.dotMax, (v) => flat('dotMax', v, null, 'percent at the largest dot'), { min: 0, max: 100, step: 'any' }),
        sizeThreshold,
        outlineColor,
        number('outlineWidth', WO.outlineWidth, (v) => nested('outline', 'width', v === null ? DEFAULT_OUTLINE.width : Math.max(0, Math.min(OUTLINE_MAX, v)), DEFAULT_OUTLINE.width, 'dot outline width'),
            { min: 0, max: OUTLINE_MAX, step: 0.25 }));

    // Colors
    const scalingNote = el('p', { class: 'cgene-scaling-note cgene-help' });
    const limit = (k) => (v) => {
        const now = Array.isArray(config().limits) ? [...config().limits] : [null, null];
        now[k] = v;
        ctx.set({ limits: isNumber(now[0]) || isNumber(now[1]) ? [isNumber(now[0]) ? now[0] : null, isNumber(now[1]) ? now[1] : null] : undefined },
            k === 0 ? 'color minimum' : 'color maximum');
    };
    const colors = section(WO.heading.colors,
        select('colorScale', WO.colorScale, SCALES.map((s) => [s, scaleOptionLabel(s)]), (v) => flat('colorScale', v, Z_SCALINGS.includes(config().scale) ? null : DEFAULT_SCALE, `color scale ${v}`)),
        number('min', WO.min, limit(0), { step: 'any' }),
        number('max', WO.max, limit(1), { step: 'any' }),
        number('center', WO.center, (v) => flat('center', v, null, 'color center'), { step: 'any', title: WO.centerDiverging }),
        check('printValues', WO.printValues, (on) => flat('printValues', on, false, onOff(on, WO.printValues))),
        scalingNote);

    // Sections
    const sections = section(WO.heading.sections,
        number('gap', `${WO.gap} (${WO.gapUnit})`, (v) => flat('gap', v === null ? DEFAULT_GAP : Math.round(Math.max(0, Math.min(GAP_MAX, v))), DEFAULT_GAP, 'gap between sections'),
            { min: 0, max: GAP_MAX, step: 1 }),
        check('sectionTitles', WO.sectionTitles, (on) => flat('sectionTitles', on, true, onOff(on, WO.sectionTitles))));

    // Labels
    const labels = section(WO.heading.labels,
        check('geneLabels', WO.geneLabels, (on) => nested('labels', 'genes', on, true, onOff(on, WO.geneLabels))),
        check('groupLabels', WO.groupLabels, (on) => nested('labels', 'groups', on, true, onOff(on, WO.groupLabels))),
        words('plotTitle', WO.plotTitle, (v) => nested('titles', 'plot', v, '', 'plot title')),
        words('colorTitle', WO.colorTitle, (v) => nested('titles', 'color', v, '', 'color bar title')),
        words('sizeTitle', WO.sizeTitle, (v) => nested('titles', 'size', v, '', 'size legend title')));

    // Clustering
    const wardText = el('span', { class: 'cgene-ward-note__text', text: WO.wardSwitched });
    const wardUndo = el('button', { type: 'button', class: 'btn btn-sm btn-link cgene-ward-undo', on: { click: () => { wardAfter = null; ctx.undo(); } } }, WO.undo);
    const wardNote = el('div', { class: 'cgene-ward-note cgene-help', role: 'status', hidden: true }, wardText, ' ', wardUndo);
    const clustering = section(WO.heading.clustering,
        select('linkage', WO.linkageLabel, LINKAGES.map((l) => [l, WO.linkage[l]]), setLinkage),
        select('distance', WO.distanceLabel, DISTANCES.map((d) => [d, WO.distance[d]]),
            (v) => setCluster({ distance: v }, `distance ${WO.distance[v]}`)),
        wardNote,
        check('dendrograms', WO.dendrograms, (on) => setCluster({ dendrograms: on }, onOff(on, WO.dendrograms))));

    function setLinkage(v) {
        const c = clusterOf(config());
        if (v === 'ward' && c.distance !== 'euclidean') {
            // Q2: Ward needs Euclidean distance; the switch is made, said, and undone in one step
            setCluster({ linkage: 'ward', distance: 'euclidean' }, `linkage ${WO.linkageName.ward}, distance ${WO.distance.euclidean}`);
            wardAfter = JSON.stringify(config());
            paint();
            return;
        }
        setCluster({ linkage: v }, `linkage ${WO.linkageName[v]}`);
    }

    // Legend, Totals
    const legend = section(WO.heading.legend,
        check('colorBar', WO.colorBar, (on) => nested('legend', 'colorBar', on, true, onOff(on, WO.colorBar))),
        check('sizeLegend', WO.sizeLegend, (on) => nested('legend', 'sizeLegend', on, true, onOff(on, WO.sizeLegend))),
        check('strips', WO.strips, (on) => nested('legend', 'strips', on, true, onOff(on, WO.strips))));
    const totals = section(WO.heading.totals,
        check('totals', WO.totals, (on) => flat('totals', on, false, onOff(on, WO.totals))),
        check('sortGroups', WO.sortGroups, (on) => flat('sortGroups', on, false, onOff(on, WO.sortGroups))));

    // Show as table and Download CSV (UX 7, CXG-20)
    const tableBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgene-table-btn', aria: { expanded: 'false' },
        on: { click: () => { tableShown = !tableShown; paintTable(); } } }, TABLE.show);
    const csvBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgene-csv-btn', on: { click: downloadCsv } }, WO.csv);
    const box = el('div', { class: 'cgene-options cgene-menu', id: `cgene-options-${id}`, role: 'group', aria: { label: WO.plotOptions }, hidden: true },
        dots, colors, sections, labels, clustering, legend, totals, el('div', { class: 'cgene-options__foot' }, tableBtn, csvBtn));

    slot.append(clusterBtn, optionsBtn, note);
    ctx.menuHost.append(clusterMenu, box);

    // ---------------------------------------------------------------- open and close
    function toggle(which) {
        const was = open[which];
        open.cluster = false;
        open.options = false;
        open[which] = !was;
        paint();
        const menu = which === 'cluster' ? clusterMenu : box;
        if (open[which]) { const first = menu.querySelector('input, select, button'); if (first) first.focus(); }
    }
    function closeAll() {
        if (!open.cluster && !open.options) return;
        open.cluster = false;
        open.options = false;
        paint();
    }
    const onKey = (e) => {
        if (e.key !== 'Escape' || (!open.cluster && !open.options)) return;
        const btn = open.cluster ? clusterBtn : optionsBtn;
        closeAll();
        btn.focus();
        e.stopPropagation();
    };
    for (const host of [slot, ctx.menuHost]) {
        host.addEventListener('keydown', onKey);
        listeners.push(() => host.removeEventListener('keydown', onKey));
    }

    // ---------------------------------------------------------------- the table
    function paintTable() {
        const drawn = ctx.drawn();
        const on = tableShown && !!drawn;
        tableBtn.textContent = on ? TABLE.hide : TABLE.show;
        tableBtn.setAttribute('aria-expanded', String(on));
        ctx.tableHost.hidden = !on;
        if (!on) {
            if (tableFrom) clear(ctx.tableHost);
            tableFrom = null;
            return;
        }
        if (tableFrom === drawn.model) return;
        tableFrom = drawn.model;
        clear(ctx.tableHost);
        ctx.tableHost.appendChild(tableElement(ctx.D, tableView(longRows(tableOf(drawn.model))), ctx.title()));
    }

    function downloadCsv() {
        const drawn = ctx.drawn();
        if (!drawn) return;
        const url = URL.createObjectURL(new Blob([longCsv(tableOf(drawn.model))], { type: 'text/csv' }));
        const a = el('a', { href: url, download: fileName(ctx.title()) });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    // ---------------------------------------------------------------- paint
    function setValue(input, v) {
        if (document.activeElement !== input) input.value = v === null || v === undefined ? '' : String(v);
    }

    function paint() {
        const c = config();
        const s = styleOf(c);
        const cl = clusterOf(c);
        const recipe = ctx.recipe();
        const factors = recipe && Array.isArray(recipe.partitionings) ? recipe.partitionings.map((p) => sourceName(p.source, ctx.titleOf)) : [];
        const dotsMode = c.mode !== 'heatmap';

        clusterBtn.setAttribute('aria-expanded', String(open.cluster));
        clusterMenu.hidden = !open.cluster;
        radios(genesRow, 'genes', [['off', WO.off], ['sections', WO.withinSections]], cl.genes);
        radios(groupsRow, 'groups', [['off', WO.off], ['all', WO.all], ...(factors.length >= 2 ? [['first', WO.within(factors[0])]] : [])],
            cl.groups === 'first' && factors.length < 2 ? 'off' : cl.groups);
        summary.textContent = WO.summary(WO.linkageName[cl.linkage], WO.distance[cl.distance]);

        optionsBtn.setAttribute('aria-expanded', String(open.options));
        box.hidden = !open.options;
        dots.hidden = !dotsMode;
        const range = s.dotSizes || [DOT_PX.smallest, DOT_PX.largest];
        setValue(controls.dotSmallest, range[0]);
        setValue(controls.dotLargest, range[1]);
        setValue(controls.dotMin, s.dotMin);
        setValue(controls.dotMax, s.dotMax);
        sizeThreshold.hidden = !(c.size && needsThreshold(c.size.stat));
        setValue(controls.sizeThreshold, c.size && isNumber(c.size.detect_above) ? c.size.detect_above : null);
        controls.colorScale.value = s.colorScale;
        controls.outlineColor.value = s.outline.color.length === 4 ? `#${[...s.outline.color.slice(1)].map((h) => h + h).join('')}` : s.outline.color.slice(0, 7);
        setValue(controls.outlineWidth, s.outline.width);
        const limits = Array.isArray(c.limits) ? c.limits : [];
        setValue(controls.min, isNumber(limits[0]) ? limits[0] : null);
        setValue(controls.max, isNumber(limits[1]) ? limits[1] : null);
        controls.center.disabled = !DIVERGING_SCALES.has(s.colorScale);
        setValue(controls.center, s.center);
        controls.printValues.checked = s.printValues;
        controls.printValues.closest('label').hidden = dotsMode;
        scalingNote.textContent = scalingNotes(c).join(' ');
        scalingNote.hidden = !scalingNote.textContent;
        setValue(controls.gap, s.gap);
        controls.sectionTitles.checked = s.sectionTitles;
        controls.geneLabels.checked = s.labels.genes;
        controls.groupLabels.checked = s.labels.groups;
        setValue(controls.plotTitle, s.titles.plot);
        setValue(controls.colorTitle, s.titles.color);
        setValue(controls.sizeTitle, s.titles.size);
        controls.sizeTitle.closest('label').hidden = !dotsMode;
        controls.linkage.value = cl.linkage;
        controls.distance.value = cl.distance;
        const corr = controls.distance.querySelector('option[value="correlation"]');
        corr.disabled = cl.linkage === 'ward';
        if (corr.disabled) corr.title = WO.wardOnly; else corr.removeAttribute('title');
        if (wardAfter !== null && wardAfter !== JSON.stringify(c)) wardAfter = null;
        wardNote.hidden = wardAfter === null;
        controls.dendrograms.checked = cl.dendrograms;
        controls.colorBar.checked = s.legend.colorBar;
        controls.sizeLegend.checked = s.legend.sizeLegend;
        controls.sizeLegend.closest('label').hidden = !dotsMode;
        controls.strips.checked = s.legend.strips;
        controls.totals.checked = s.totals;
        controls.sortGroups.checked = s.sortGroups;

        const drawn = ctx.drawn();
        csvBtn.disabled = !drawn;
        tableBtn.disabled = !drawn;
        note.textContent = clusterNotes(drawn).join(' ');
        paintTable();
    }

    paint();
    return {
        update: paint,
        destroy() {
            for (const stop of listeners.splice(0)) stop();
            slot.textContent = '';
            ctx.menuHost.textContent = '';
        }
    };
}

/** What `PARTS.options` of panels/cell-gene.js is. */
export const OPTIONS_PART = Object.freeze({ mount });
