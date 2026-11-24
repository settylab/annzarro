/**
 * The Cell-Gene Plot's Cluster ▾, Color ▾ and Plot Options (0.8.0 step X5, pop-overs since WP-2; UX 3.1, 3.3, 3.4
 * and 7; CXG-6, CXG-10, CXG-12 to CXG-14, CXG-20 to CXG-26; requirements 5.3, the scanpy extras).
 *
 * TWO HALVES.
 * - What the options SAY to the drawing, pure, so Node tests hold it: `figureExtras(config, ctx)` turns the style fields
 *   into the fields of draw.js's model (color scale, dot sizes, titles, legends, printed values) and of
 *   draw-annotations.js's (brackets, strips, totals, dendrograms, labels); `barSettings(config)` is the color bars'
 *   Min, Max, Center and title, which the drawing and the clustering both read (operator decision 19); `clusterOf`
 *   is the clustering's settings with scanpy's defaults (OD 16).
 * - The menus (`OPTIONS_PART`), three buttons mounted by panels/cell-gene.js in the control grid's Layout group, each
 *   opening a pop-over (ui/popover.js; design note options-ux-080 section 5): Cluster ▾ (scopes, Sort groups, Linkage,
 *   Distance, the Ward note, the two Dendrograms), Color ▾ (map, Reverse, Min, Max, Center, Print values; in dots the
 *   largest dot as a share of its cell, the smallest dot in px, and Size min and max) and Plot Options (dots' outline and opacity, sections, labels, legends,
 *   totals, Export with Download CSV from the CSV's rows, utils/cell-gene-model.js `longRows`; UX 7, CXG-20). A
 *   pop-over never changes the size of the panel. Every change applies live as one undoable step of the panel
 *   (`ctx.set(patch, label)`). Before them, the `3D` toggle (UX 6b, WP-12): `view: '3d'`, disabled with its reason
 *   over the bar cap (`view3dGate`); in 3D, Plot Options' Export greys SVG ("3D exports as an image only").
 *
 * STYLE FIELDS (plan 1.6: additive, default when absent, never frozen): `colorScale`, `reverse`, `limits: [min, max]`, `center`,
 * `printValues`, `heightLimits: [min, max]` (the 3D bars' range), `dotScale` (10 to 100: the % of its cell the largest dot fills; absent, 100), `dotSmallest` (px),
 * `dotOpacity` (0.1 to 1; absent, 1), `dotSizes: [smallest, largest]` (px; written before the dots filled their cells, still read: a link that has it draws
 * those px until Largest dot is moved), `dotMin`, `dotMax` (% at the smallest and largest dot), `gap`
 * (0 to 3 cells), `sectionTitles`, `labels: {genes, groups}`, `titles: {plot, color, size}`, `legend: {colorBar,
 * sizeLegend, strips}`, `totals`, `sortGroups`, and `cluster.dendrograms: {genes, groups}` beside the frozen cluster
 * fields (a stored `true` or `false` reads as both). A field at its default is written as absent, so links stay short.
 *
 * COST. The menus repaint from the configuration and the drawing the panel last made; a repaint walks no gene, cell or
 * group. The CSV is built only when it is downloaded.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { Config } from '../../config.js';
import { scaleOptionLabel, plotlyColorscale, DIVERGING_SCALES } from '../../utils/color-scales.js';
import { defaultLabelMaps, sourceName } from '../../utils/cell-grouping.js';
import { RESERVED } from '../../utils/level-id.js';
import { GAP_COLOUR } from '../../utils/plot-theme.js';
import { limit } from '../../utils/limits.js';
import { longCsv } from '../../utils/cell-gene-model.js';
import { groupingColours, groupOverrideState } from '../../utils/grouping-colours.js';
import { createPopover } from '../../ui/popover.js';
import { registerPanelFields } from '../plot-utilities/options-schema.js';
import { mountPlotOptions } from '../plot-utilities/options-popover.js';
import { createRangeBoxes, drawnRange } from '../../ui/range-boxes.js';
import { dendrogramBlocks } from './draw-annotations.js';
import { bars3dMax, checkBarCap } from '../../utils/bars-3d.js';

const W = VOCABULARY.cellGene;
const WO = VOCABULARY.cellGene.options;
const W3 = VOCABULARY.cellGene.view3d;

const SCALES = Object.freeze((Config && Config.DEFAULTS && Config.DEFAULTS.COLOR_SCALES) || ['Viridis']);
const DEFAULT_SCALE = 'Reds';
const Z_DEFAULT_SCALE = 'RdBu';
const Z_SCALINGS = Object.freeze(['z_groups', 'z_pooled']);
const DEFAULT_OUTLINE = Object.freeze({ color: '#000', width: 0.5 });
const OUTLINE_MAX = 3;
/** Dot opacity: the slider's ends and step; 1 (the default) is opaque. */
const DOT_OPACITY = Object.freeze({ min: 0.1, max: 1, step: 0.05 });
const DEFAULT_GAP = 1;
const GAP_MAX = 3;
const DOT_PX = Object.freeze({ min: 1, max: 40, smallest: 3, largest: 20 });
/** Largest dot, in % of its cell: the slider's ends and step; 100 (the default) fills the cell. */
const DOT_SCALE = Object.freeze({ min: 10, max: 100, step: 5 });
const DEFAULT_CLUSTER = Object.freeze({ genes: 'off', groups: 'off', linkage: 'complete', distance: 'correlation',
    dendrograms: Object.freeze({ genes: true, groups: true }) });
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
 * Dendrograms are two switches, genes and groups (WP-2); a stored `true` or `false` (before 0.8.0) reads as both.
 * @returns {{genes: string, groups: string, linkage: string, distance: string, dendrograms: {genes: boolean, groups: boolean}}}
 */
function clusterOf(config) {
    const c = isObject(config && config.cluster) ? config.cluster : {};
    const d = c.dendrograms;
    const out = {
        genes: pick(c.genes, GENE_SCOPES, DEFAULT_CLUSTER.genes),
        groups: pick(c.groups, GROUP_SCOPES, DEFAULT_CLUSTER.groups),
        linkage: pick(c.linkage, LINKAGES, DEFAULT_CLUSTER.linkage),
        distance: pick(c.distance, DISTANCES, DEFAULT_CLUSTER.distance),
        dendrograms: isObject(d) ? { genes: d.genes !== false, groups: d.groups !== false } : { genes: d !== false, groups: d !== false }
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
        reverse: c.reverse === true,
        outline: {
            color: typeof o.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(o.color) ? o.color : DEFAULT_OUTLINE.color,
            width: isNumber(o.width) ? Math.max(0, Math.min(OUTLINE_MAX, o.width)) : DEFAULT_OUTLINE.width
        },
        printValues: c.printValues === true,
        dotOpacity: isNumber(c.dotOpacity) ? Math.max(DOT_OPACITY.min, Math.min(DOT_OPACITY.max, c.dotOpacity)) : DOT_OPACITY.max,
        dotSizes: rangeOf(c.dotSizes, DOT_PX.min, DOT_PX.max),
        dotScale: isNumber(c.dotScale) ? Math.max(DOT_SCALE.min, Math.min(DOT_SCALE.max, c.dotScale)) : null,
        dotSmallest: isNumber(c.dotSmallest) ? Math.max(DOT_PX.min, Math.min(DOT_PX.max, c.dotSmallest)) : null,
        dotMin: isNumber(c.dotMin) ? c.dotMin : null,
        dotMax: isNumber(c.dotMax) ? c.dotMax : null,
        sectionTitles: c.sectionTitles !== false,
        labels: { genes: labels.genes !== false, groups: labels.groups !== false },
        titles: { plot: text(titles.plot), color: text(titles.color), size: text(titles.size) },
        legend: { colorBar: legend.colorBar !== false, sizeLegend: legend.sizeLegend !== false, strips: legend.strips !== false },
        totals: c.totals === true,
        groupBand: c.groupBand !== false,
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

// ================================================================================================ Plot Options' fields

const dotsMode = (config) => !config || config.mode !== 'heatmap';
const in3d = (config) => !!config && config.view === '3d';

/**
 * The Cell-Gene Plot's own fields of the shared Plot Options (WP-5a, plot-utilities/options-schema.js), at the keys
 * they always had: the dots' outline, the sections' gap and titles, the gene and group labels (in Axes), the legends'
 * switches and titles (in Legend), the totals (Annotations). The plot title is the common Text section's (`titles.plot`).
 */
const PLOT_OPTION_FIELDS = Object.freeze([
    { id: 'outlineColor', section: 'panel:dots', type: 'color', path: 'outline.color', label: WO.outlineColor, dflt: DEFAULT_OUTLINE.color, when: dotsMode },
    { id: 'outlineWidth', section: 'panel:dots', type: 'number', path: 'outline.width', label: WO.outlineWidth, dflt: DEFAULT_OUTLINE.width,
        min: 0, max: OUTLINE_MAX, step: 0.25, when: dotsMode },
    { id: 'dotOpacity', section: 'panel:dots', type: 'range', path: 'dotOpacity', label: WO.dotOpacity, dflt: DOT_OPACITY.max,
        min: DOT_OPACITY.min, max: DOT_OPACITY.max, step: DOT_OPACITY.step, when: dotsMode },
    { id: 'gap', section: 'panel:sections', type: 'number', path: 'gap', label: `${WO.gap} (${WO.gapUnit})`, dflt: DEFAULT_GAP, min: 0, max: GAP_MAX, step: 1 },
    { id: 'sectionTitles', section: 'panel:sections', type: 'check', path: 'sectionTitles', label: WO.sectionTitles, dflt: true },
    { id: 'geneLabels', section: 'axes', type: 'check', path: 'labels.genes', label: WO.geneLabels, dflt: true },
    { id: 'groupLabels', section: 'axes', type: 'check', path: 'labels.groups', label: WO.groupLabels, dflt: true },
    // the 3D labels (operator: side, justification, rotation, padding), beside the label switches, shown in 3D only;
    // draw.js labelOptions3d reads them, sections.js cleans them, the panel stores Side Fixed's edges from the camera
    { id: 'labels3dSide', section: 'axes', type: 'select', path: 'labels3d.side', label: W3.labels.side, dflt: 'auto', when: in3d,
        choices: [['auto', W3.labels.sides.auto], ['fixed', W3.labels.sides.fixed]], help: W3.labels.sideHelp },
    { id: 'labels3dJustify', section: 'axes', type: 'select', path: 'labels3d.justify', label: W3.labels.justify, dflt: 'auto', when: in3d,
        choices: ['auto', 'left', 'right', 'center'].map((v) => [v, W3.labels.justifies[v]]) },
    { id: 'labels3dRotation', section: 'axes', type: 'select', path: 'labels3d.rotation', label: W3.labels.rotation, dflt: 'horizontal', when: in3d,
        choices: ['horizontal', 'along', 'across', 'angle'].map((v) => [v, W3.labels.rotations[v]]) },
    { id: 'labels3dAngle', section: 'axes', type: 'number', path: 'labels3d.angle', label: W3.labels.angle, dflt: 0, min: -90, max: 90, step: 5,
        when: (c) => in3d(c) && !!c.labels3d && c.labels3d.rotation === 'angle' },
    { id: 'labels3dPadding', section: 'axes', type: 'number', path: 'labels3d.padding', label: W3.labels.padding, dflt: 4, min: 0, max: 40, step: 1,
        when: in3d },
    { id: 'colorBar', section: 'legend', type: 'check', path: 'legend.colorBar', label: WO.colorBar, dflt: true },
    { id: 'sizeLegend', section: 'legend', type: 'check', path: 'legend.sizeLegend', label: WO.sizeLegend, dflt: true, when: dotsMode },
    { id: 'strips', section: 'legend', type: 'check', path: 'legend.strips', label: WO.strips, dflt: true },
    { id: 'colorTitle', section: 'legend', type: 'text', path: 'titles.color', label: WO.colorTitle, dflt: '', copy: false },
    { id: 'sizeTitle', section: 'legend', type: 'text', path: 'titles.size', label: WO.sizeTitle, dflt: '', copy: false, when: dotsMode },
    { id: 'totals', section: 'panel:annotations', type: 'check', path: 'totals', label: WO.totals, dflt: false },
    { id: 'groupBand', section: 'panel:annotations', type: 'check', path: 'groupBand', label: WO.groupBandSwitch, dflt: true }
]);
registerPanelFields('cell-gene', PLOT_OPTION_FIELDS);

// ================================================================================================ strips and trees

/**
 * One strip per factor of the cell axis (CXG-14): each drawn group's level, colored as the factor colors its levels
 * (utils/grouping-colours.js: the column's own colors, a palette, an override), and the legend of the strip, the factor's
 * levels in level order. The collected small group takes the gap color and no level.
 * @param {Object} reply - the cell axis's reply
 * @param {Object} recipe - the grouping recipe the reply is of
 * @param {Int32Array} groupOrder - the reply's group at each drawn position
 * @param {(source: Object) => (string|undefined)} titleOf
 * @param {Map<string, string>[]} [colors] - each factor's colors as the recipe has them now (group-sources.js `coloursOf`);
 *   left out, the recipe's own
 * @param {{colours: string[], generated: string[], names: string[]}|null} [groups] - each group of the reply: its colour
 *   (coloursOf `groups`), its generated name (what a group's own colour is keyed by) and its name as shown; with it, a
 *   Group band follows the factors' strips when the grouping has more than one factor or a group has a colour of its own
 *   (decision 38), so the colour chosen in the group grid shows here too
 * @returns {{title: string, colours: string[], levels: string[], legend: {label: string, colour: string}[]}[]}
 */
function groupStrips(reply, recipe, groupOrder, titleOf, colors, groups = null) {
    const parts = recipe && Array.isArray(recipe.partitionings) ? recipe.partitionings : [];
    if (!reply || !Array.isArray(reply.groups) || !Array.isArray(reply.partitionings) || reply.partitionings.length !== parts.length) return [];
    const maps = defaultLabelMaps(recipe, reply, titleOf);
    const factors = colors || groupingColours(recipe, reply).factors;
    const strips = parts.map((p, i) => {
        const info = reply.partitionings[i] || {};
        const levels = Array.isArray(info.levels) ? info.levels : [];
        const label = (id) => (p.labels && p.labels[id]) || maps[i].get(id) || id;
        const colour = (id) => (factors[i] && factors[i].get(id)) || GAP_COLOUR;
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
    if (groups && Array.isArray(groups.colours) && (parts.length > 1 || groupOverrideState(recipe, groups.generated).active.some((o) => o && o.color))) {
        const nameOf = (g) => (groups.names && groups.names[g]) || '';
        const colourOf = (g) => groups.colours[g] || GAP_COLOUR;
        strips.push({ title: WO.groupBand, colours: Array.from(groupOrder, colourOf), levels: Array.from(groupOrder, nameOf),
            legend: reply.groups.map((_, g) => ({ label: nameOf(g), colour: colourOf(g) })) });
    }
    return strips;
}

/** The dendrograms of the clustered blocks, each when its Dendrograms switch is on (CXG-24, WP-2). */
function dendrogramsOf(cluster, order) {
    if (!order) return {};
    const out = {};
    if (cluster.dendrograms.genes && cluster.genes !== 'off' && order.rowBlocks && order.rowBlocks.length) out.genes = dendrogramBlocks(order.rowBlocks, order.rows);
    if (cluster.dendrograms.groups && cluster.groups !== 'off' && order.groupBlocks && order.groupBlocks.length) out.groups = dendrogramBlocks(order.groupBlocks, order.groups);
    return out;
}

/**
 * What the options add to the drawing model of draw.js and draw-annotations.js, and what the panel orders by.
 * @param {Object} config - the plot's configuration
 * @param {{reply?: Object, recipe?: Object, order?: Object, titleOf?: Function, colors?: Map[]}} [ctx] - the cell axis's reply
 *   and its recipe, each factor's colors, cell-gene-order.js's answer for the matrix, and the title of a panel behind a source; without them no
 *   strip and no tree
 * @returns {{color: Object, size: Object, legend: Object, plotTitle: (string|undefined), annotations: Object,
 *   gap: number, sortBySize: boolean, cluster: Object}}
 */
export function figureExtras(config, { reply, recipe, order, titleOf, colors, groups } = {}) {
    const s = styleOf(config);
    const cluster = clusterOf(config);
    const color = { colorscale: plotlyColorscale(s.colorScale) };
    if (s.reverse) color.reversescale = true;
    if (config && config.mode === 'heatmap' && s.printValues) color.printValues = true;
    const size = {};
    // the largest dot fills a share of its cell (draw.js), unless a link from before gives it in px and Largest dot
    // was not moved since
    if (s.dotSizes) [size.smallest, size.largest] = s.dotSizes;
    if (s.dotScale !== null) { delete size.largest; size.scale = s.dotScale / 100; }
    if (s.dotSmallest !== null) size.smallest = s.dotSmallest;
    if (s.dotMin !== null) size.dotMin = s.dotMin;
    if (s.dotMax !== null) size.dotMax = s.dotMax;
    if (s.titles.size) size.title = s.titles.size;
    // the 3D bars' height range (`heightLimits`): the heights are drawn between the two (draw.js figure3d)
    const height = {};
    const hl = Array.isArray(config && config.heightLimits) ? config.heightLimits : [];
    if (isNumber(hl[0])) height.min = hl[0];
    if (isNumber(hl[1])) height.max = hl[1];
    const outline = s.outline.width > 0 ? { color: s.outline.color, width: s.outline.width } : null;
    return {
        color, size, height, outline, dotOpacity: s.dotOpacity, legend: s.legend, plotTitle: s.titles.plot || undefined, gap: s.gap, sortBySize: s.sortGroups, cluster,
        // the 3D labels' options, as stored (sections.js cleans them; draw.js labelOptions3d reads them)
        labels3d: isObject(config && config.labels3d) ? config.labels3d : undefined,
        annotations: {
            brackets: { titles: s.sectionTitles },
            totals: s.totals,
            labels: s.labels,
            strips: order ? groupStrips(reply, recipe, order.groups, titleOf, colors, s.groupBand ? groups : null) : [],
            dendrograms: dendrogramsOf(cluster, order)
        }
    };
}

// ================================================================================================ 3D

/**
 * Whether the matrix may be drawn in 3D (UX 6b): one bar per row and group, at most the cap. Refused with the matrix's
 * words ("Use fewer genes or groups.").
 * @param {{rows: number, groups: number, max?: number}} shape
 * @returns {{ok: boolean, count: number, max: number, text: string}}
 */
export function view3dGate({ rows, groups, max = bars3dMax() }) {
    return checkBarCap(rows * groups, { max, hint: 'matrix' });
}

// ================================================================================================ the table

/**
 * The drawing as the CSV's table (CXG-20): one column for Color as computed, one as displayed when a scaling is on, one
 * for Size in dots; a one-row section with a quantity of its own gets its own column, named with the section, filled
 * on its row only. In 3D a Height of its own gets a column, after the rest (UX 6b); "Same as Color" is the Color column.
 * Rows and groups in the drawn order.
 * @param {Object} model - the drawing model the panel last drew (draw.js)
 * @returns {Parameters<typeof import('../../utils/cell-gene-model.js').longRows>[0]}
 */
// export-unused-ok: X6 compares the CSV of a link with the oracle
export function tableOf(model) {
    const G = model.groups.length;
    const R = model.rows.length;
    const columns = [];
    const add = (which, spec, valuesOf, scaling) => {
        const main = { stat: spec.stat, layer: spec.layer, detectAbove: spec.detectAbove, scaling, values: new Float64Array(R * G).fill(NaN) };
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
    const h = model.view === '3d' ? model.height : null;
    // the header leads with "Height" where a section's own column leads with its section: "Height · Sum · counts · not scaled"
    if (h && !h.same) columns.push({ section: W3.height, stat: h.stat, layer: h.layer, detectAbove: h.detectAbove, scaling: 'none', values: h.values });
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
        out.push(WO.tooMany(row && row.section ? row.section.title : '', block.count, limit('dendrogram_rows')));
    }
    if (order.rowsLeftOut) out.push(WO.leftOut(order.rowsLeftOut, 'row'));
    if (order.groupsLeftOut) out.push(WO.leftOut(order.groupsLeftOut, VOCABULARY.word.group));
    return out;
}


/** A file name from the plot's title. */
const fileName = (title) => `${String(title || 'cell-gene').replace(/[^\w.-]+/g, '_') || 'cell-gene'}.csv`;

/** The fields Color ▾'s Reset clears: the map, its direction and range, and the dots' sizes. */
const COLOR_FIELDS = Object.freeze(['colorScale', 'reverse', 'limits', 'center', 'printValues', 'dotScale', 'dotSmallest', 'dotSizes', 'dotMin', 'dotMax', 'heightLimits']);

/**
 * Mount the menus: three buttons in `slot`, each opening a pop-over (ui/popover.js) that is filled with the same
 * controls on every open and repainted from the configuration on every change.
 * @param {HTMLElement} slot - the control grid's Layout slot
 * @param {{panelId: string, D: Object, config: () => Object, set: (patch: Object, label: string) => void, undo: () => boolean,
 *   drawn: () => ({model: Object, order: Object}|null), recipe: () => (Object|null), titleOf: Function, title: () => string,
 *   shape?: () => ({rows: number, groups: number}|null), exportImage?: (format: string) => void}} ctx - `recipe` is the
 *   grouping recipe the cell axis's groups are of; `shape` the matrix's rows and groups (the 3D cap); `exportImage`
 *   saves the plot as an image
 * @returns {{update: () => void, destroy: () => void}}
 */
function mount(slot, ctx) {
    const { el } = ctx.D;
    const id = ctx.panelId;
    let wardAfter = null;          // the configuration Ward's switch made, while its sentence and Undo show

    const config = () => ctx.config();
    const setCluster = (patch, label) => ctx.set({ cluster: { ...clusterOf(config()), ...patch } }, label);

    const controls = {};
    const field = (label, control) => el('label', { class: 'cgene-field' }, el('span', { class: 'cgene-field__label', text: label }), control);
    const check = (name, label, onChange) => {
        controls[name] = el('input', { type: 'checkbox', data: { option: name }, on: { change: (e) => onChange(e.target.checked) } });
        return el('label', { class: 'cgene-opt' }, controls[name], ` ${label}`);
    };
    const select = (name, label, entries, onChange) => {
        const s = el('select', { class: 'form-select form-select-sm', data: { option: name }, aria: { label }, on: { change: () => onChange(s.value) } },
            entries.map(([v, t]) => el('option', { value: v, text: t })));
        controls[name] = s;
        return field(label, s);
    };
    const section = (heading, ...children) => el('fieldset', { class: 'cgene-options__section' }, el('legend', { text: heading }), ...children);
    const flat = (key, value, dflt, label) => ctx.set({ [key]: value === dflt ? undefined : value }, label);
    const onOff = (on, label) => `${on ? '' : 'no '}${label.toLowerCase()}`;
    const button = (cls, label) => el('button', { type: 'button', class: `btn btn-sm btn-outline-secondary ${cls}` }, label);

    // ---------------------------------------------------------------- 3D (UX 6b, WP-12): a view, one undoable step
    const view3dBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgene-3d-btn', aria: { pressed: 'false' },
        on: { click: () => {
            const on = config().view === '3d';
            ctx.set({ view: on ? undefined : '3d' }, on ? 'show in 2D' : 'show in 3D');
        } } }, W3.button);

    // ---------------------------------------------------------------- Cluster ▾ (UX 3.4; WP-2: the clustering's every field)
    const clusterBtn = button('cgene-cluster-btn', WO.cluster);
    const scopeRow = (scope, label) => el('div', { class: 'cgene-cluster-scope', role: 'radiogroup', aria: { label }, data: { scope } },
        el('span', { class: 'cgene-field__label', text: label }));
    const genesRow = scopeRow('genes', WO.clusterGenes);
    const groupsRow = scopeRow('groups', WO.clusterGroups);
    const sortGroups = check('sortGroups', WO.sortGroups, (on) => flat('sortGroups', on, false, onOff(on, WO.sortGroups)));
    sortGroups.classList.add('cgene-sort-groups');
    const summary = el('p', { class: 'cgene-cluster-summary cgene-help' });
    const wardText = el('span', { class: 'cgene-ward-note__text', text: WO.wardSwitched });
    const wardUndo = el('button', { type: 'button', class: 'btn btn-sm btn-link cgene-ward-undo', on: { click: () => { wardAfter = null; ctx.undo(); } } }, WO.undo);
    const wardNote = el('div', { class: 'cgene-ward-note cgene-help', role: 'status', hidden: true }, wardText, ' ', wardUndo);
    const dendroRow = el('div', { class: 'cgene-dendrograms', role: 'group', aria: { label: WO.dendrograms } },
        el('span', { class: 'cgene-field__label', text: WO.dendrograms }),
        check('dendroGenes', WO.dendrogramGenes, (on) => setCluster({ dendrograms: { ...clusterOf(config()).dendrograms, genes: on } },
            onOff(on, `${WO.dendrogramGenes} ${WO.dendrograms}`))),
        check('dendroGroups', WO.dendrogramGroups, (on) => setCluster({ dendrograms: { ...clusterOf(config()).dendrograms, groups: on } },
            onOff(on, `${WO.dendrogramGroups} ${WO.dendrograms}`))));
    const clusterBody = el('div', { class: 'cgene-pop cgene-cluster-menu', role: 'group', aria: { label: WO.heading.clustering } },
        genesRow, groupsRow, sortGroups,
        select('linkage', WO.linkageLabel, LINKAGES.map((l) => [l, WO.linkage[l]]), setLinkage),
        select('distance', WO.distanceLabel, DISTANCES.map((d) => [d, WO.distance[d]]),
            (v) => setCluster({ distance: v }, `distance ${WO.distance[v]}`)),
        wardNote, summary, dendroRow);

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

    // ---------------------------------------------------------------- Color ▾ (WP-2, decision g: how the values are shown)
    const colorBtn = button('cgene-color-btn', WO.colorMenu);
    const scalingNote = el('p', { class: 'cgene-scaling-note cgene-help' });
    const limit = (k) => (v) => {
        const now = Array.isArray(config().limits) ? [...config().limits] : [null, null];
        now[k] = v;
        ctx.set({ limits: isNumber(now[0]) || isNumber(now[1]) ? [isNumber(now[0]) ? now[0] : null, isNumber(now[1]) ? now[1] : null] : undefined },
            k === 0 ? 'color minimum' : 'color maximum');
    };
    const pairOf = (v) => [isNumber(v && v[0]) ? v[0] : null, isNumber(v && v[1]) ? v[1] : null];
    // Color: Min, Max (`limits`) and Center (`center`), auto with the drawn value, ↺ back to auto in one step
    const colorRange = createRangeBoxes({ el, what: WO.rangeWhat.color, group: 'colorRange',
        ends: [{ label: WO.min, option: 'min' }, { label: WO.max, option: 'max' }, { label: WO.center, option: 'center', hint: false }],
        onCommit: (k, v) => (k === 2 ? flat('center', v, null, 'color center') : limit(k)(v)),
        onReset: () => ctx.set({ limits: undefined, center: undefined }, 'color range to auto') });
    controls.min = colorRange.fields[0];
    controls.max = colorRange.fields[1];
    controls.center = colorRange.fields[2];
    controls.center.title = WO.centerDiverging;
    // the 3D bars' height range: heights are drawn between Min and Max (stored as `heightLimits`)
    const heightRange = createRangeBoxes({ el, what: WO.rangeWhat.height, group: 'heightRange',
        ends: [{ label: `${W3.height} ${WO.min.toLowerCase()}`, option: 'heightMin' }, { label: `${W3.height} ${WO.max.toLowerCase()}`, option: 'heightMax' }],
        onCommit: (k, v) => {
            const now = pairOf(config().heightLimits);
            now[k] = v;
            ctx.set({ heightLimits: now[0] !== null || now[1] !== null ? now : undefined }, k === 0 ? 'height minimum' : 'height maximum');
        },
        onReset: () => ctx.set({ heightLimits: undefined }, 'height range to auto') });
    const heightSection = section(W3.height, heightRange.element);
    /** A slider with its value said beside it; `onCommit` on release (one undoable step), the words follow the drag. */
    const slider = (name, label, range, say, onCommit) => {
        const out = el('output', { class: 'cgene-dot-value', data: { option: `${name}Value` } });
        const input = el('input', { type: 'range', class: 'form-range', min: range.min, max: range.max, step: range.step || 1, data: { option: name }, aria: { label },
            on: { input: (e) => { out.textContent = say(Number(e.target.value)); }, change: (e) => onCommit(Number(e.target.value)) } });
        controls[name] = input;
        controls[`${name}Value`] = out;
        return el('label', { class: 'cgene-field cgene-dot-slider' }, el('span', { class: 'cgene-field__label', text: label }), input, out);
    };
    // Largest dot fills its cell by default (operator, 2026-11-23); moving it leaves an older link's px range behind,
    // keeping its smallest dot
    const largestRow = slider('dotScale', WO.largestDot, DOT_SCALE, WO.ofCell, (v) => {
        const s = styleOf(config());
        const smallest = s.dotSmallest !== null ? s.dotSmallest : s.dotSizes ? s.dotSizes[0] : null;
        ctx.set({ dotScale: v === DOT_SCALE.max ? undefined : v, dotSizes: undefined,
            dotSmallest: smallest === null || smallest === DOT_PX.smallest ? undefined : smallest }, 'largest dot');
    });
    const smallestRow = slider('dotSmallest', WO.smallestDot, { min: DOT_PX.min, max: DOT_PX.max }, WO.px, (v) => {
        const s = styleOf(config());
        // an older link's px range keeps its largest dot: the smallest end of it moves
        if (s.dotSizes && s.dotScale === null && s.dotSmallest === null) {
            const range = rangeOf([v, s.dotSizes[1]], DOT_PX.min, DOT_PX.max);
            if (range) { ctx.set({ dotSizes: range }, 'smallest dot'); return; }
        }
        ctx.set({ dotSmallest: v === DOT_PX.smallest ? undefined : v }, 'smallest dot');
    });
    // the size statistic's own range: the values at the smallest and the largest dot (stored as `dotMin`, `dotMax`);
    // named by the statistic, which need not be a percentage
    const sizeRange = createRangeBoxes({ el, what: WO.rangeWhat.size, group: 'sizeRange',
        ends: [{ label: WO.sizeMin, option: 'dotMin' }, { label: WO.sizeMax, option: 'dotMax' }],
        onCommit: (k, v) => flat(k === 0 ? 'dotMin' : 'dotMax', v, null, k === 0 ? 'size minimum' : 'size maximum'),
        onReset: () => ctx.set({ dotMin: undefined, dotMax: undefined }, 'size range to auto') });
    controls.dotMin = sizeRange.fields[0];
    controls.dotMax = sizeRange.fields[1];
    const dotSizes = section(WO.heading.dots, largestRow, smallestRow, sizeRange.element);
    const resetColor = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgene-color-reset', title: WO.resetColorHelp,
        on: { click: () => ctx.set(Object.fromEntries(COLOR_FIELDS.map((k) => [k, undefined])), 'reset colors') } }, WO.resetColor);
    const colorBody = el('div', { class: 'cgene-pop cgene-color-menu' },
        section(WO.heading.colors,
            select('colorScale', WO.colorScale, SCALES.map((s) => [s, scaleOptionLabel(s)]),
                (v) => flat('colorScale', v, Z_SCALINGS.includes(config().scale) ? null : DEFAULT_SCALE, `color scale ${v}`)),
            check('reverse', WO.reverse, (on) => flat('reverse', on, false, onOff(on, `${WO.reverse} colors`))),
            colorRange.element,
            check('printValues', WO.printValues, (on) => flat('printValues', on, false, onOff(on, WO.printValues))),
            scalingNote),
        dotSizes,
        heightSection,
        el('div', { class: 'cgene-pop__foot' }, resetColor));

    // ---------------------------------------------------------------- Plot Options: the shared pop-over (WP-5a)
    const optionsBtn = button('cgene-options-btn', WO.plotOptions);

    // the shared plot toolbar (ui/plot-toolbar.js) when the panel gives one: 3D an action, Cluster and Color its menus,
    // Plot Options last
    if (ctx.toolbar) ctx.toolbar.add({ actions: [view3dBtn], menus: [clusterBtn, colorBtn], options: optionsBtn });
    else slot.append(view3dBtn, clusterBtn, colorBtn, optionsBtn);

    // ---------------------------------------------------------------- the pop-overs (ui/popover.js)
    const popover = (anchor, name, title, body) => createPopover({
        anchor, name, title,
        render: (host) => { host.appendChild(body); paint(); }
    });
    const pops = [
        popover(clusterBtn, 'cluster', WO.popoverTitle.cluster, clusterBody),
        popover(colorBtn, 'color', WO.popoverTitle.color, colorBody)
    ];
    // the 3D drawing has no vector image: SVG would be a raster picture inside SVG (UX 6b)
    const drawn3d = () => { const d = ctx.drawn(); return !!(d && d.model && d.model.view === '3d'); };
    const options = mountPlotOptions({
        anchor: optionsBtn, kind: 'cell-gene', panelId: id, config,
        commit: ctx.commit || ((next, label) => ctx.set(next, label)), replace: ctx.replace || ((next) => ctx.set(next, '')),
        sections: { 'panel:dots': { title: WO.heading.dots, when: dotsMode }, 'panel:sections': { title: WO.heading.sections },
            'panel:annotations': { title: WO.heading.totals } },
        exportImage: ctx.exportImage, copyImage: ctx.copyImage, plotSize: ctx.plotSize, plot: ctx.plot, csv: downloadCsv, canExport: () => !!ctx.drawn(),
        exportOff: (format) => (format === 'svg' && drawn3d() ? W3.svgOff : ''),
        classes: { export: 'cgene-export', exportBtn: 'cgene-export-btn', csv: 'cgene-csv-btn' }
    });

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

        // Cluster ▾
        radios(genesRow, 'genes', [['off', WO.off], ['sections', WO.withinSections]], cl.genes);
        radios(groupsRow, 'groups', [['off', WO.off], ['all', WO.all], ...(factors.length >= 2 ? [['first', WO.within(factors[0])]] : [])],
            cl.groups === 'first' && factors.length < 2 ? 'off' : cl.groups);
        controls.sortGroups.checked = s.sortGroups;
        // sorting by size is the order of groups that are not clustered
        sortGroups.hidden = cl.groups !== 'off';
        summary.textContent = WO.summary(WO.linkageName[cl.linkage], WO.distance[cl.distance]);
        controls.linkage.value = cl.linkage;
        controls.distance.value = cl.distance;
        const corr = controls.distance.querySelector('option[value="correlation"]');
        corr.disabled = cl.linkage === 'ward';
        if (corr.disabled) corr.title = WO.wardOnly; else corr.removeAttribute('title');
        if (wardAfter !== null && wardAfter !== JSON.stringify(c)) wardAfter = null;
        wardNote.hidden = wardAfter === null;
        controls.dendroGenes.checked = cl.dendrograms.genes;
        controls.dendroGroups.checked = cl.dendrograms.groups;

        // Color ▾
        controls.colorScale.value = s.colorScale;
        controls.reverse.checked = s.reverse;
        const limits = Array.isArray(c.limits) ? c.limits : [];
        // the boxes say "auto" with the value drawn now; only while the pop-over is open
        const shownModel = ctx.drawn() ? ctx.drawn().model : null;
        if (colorBody.isConnected) {
            colorRange.set({ limits: [...pairOf(limits), s.center], drawn: drawnRange(shownModel && shownModel.color.values) });
            const sized = shownModel && shownModel.size && shownModel.size.values ? shownModel.size : null;
            const unit = sized && W.statistic[sized.stat] ? ` (${W.statistic[sized.stat]})` : '';
            sizeRange.set({ limits: [s.dotMin, s.dotMax], drawn: drawnRange(sized && sized.values), labels: [`${WO.sizeMin}${unit}`, `${WO.sizeMax}${unit}`] });
            const h = shownModel && shownModel.view === '3d' ? shownModel.height : null;
            heightRange.set({ limits: pairOf(c.heightLimits), drawn: drawnRange(h && h.values) });
        }
        heightSection.hidden = !(c.view === '3d');
        controls.center.disabled = !DIVERGING_SCALES.has(s.colorScale);
        controls.printValues.checked = s.printValues;
        controls.printValues.closest('label').hidden = dotsMode;
        scalingNote.textContent = scalingNotes(c).join(' ');
        scalingNote.hidden = !scalingNote.textContent;
        dotSizes.hidden = !dotsMode;
        // an older link's largest dot in px is said as such; the slider stands at a full cell until it is moved
        const legacy = s.dotSizes && s.dotScale === null;
        const scale = s.dotScale !== null ? s.dotScale : DOT_SCALE.max;
        const smallest = s.dotSmallest !== null ? s.dotSmallest : s.dotSizes ? s.dotSizes[0] : DOT_PX.smallest;
        setValue(controls.dotScale, scale);
        controls.dotScaleValue.textContent = legacy ? WO.largestPx(s.dotSizes[1]) : WO.ofCell(scale);
        setValue(controls.dotSmallest, smallest);
        controls.dotSmallestValue.textContent = WO.px(smallest);
        resetColor.disabled = !COLOR_FIELDS.some((k) => c[k] !== undefined);

        const drawn = ctx.drawn();
        // rows or groups the clustering left out: a tag of the plot's status strip, not a line that wraps in the control
        // grid (it grew the panel, and with it the row, as the plot drew)
        const notes = clusterNotes(drawn);
        if (ctx.tag) ctx.tag('cgene-cluster', notes.length ? { text: WO.notClusteredTag, title: notes.join(' '), severity: 'notice', pop: { text: notes.join(' ') } } : null);

        // 3D: pressed while stored; over the cap it cannot be turned on, and says why (a stored 3D can always be turned off)
        const in3d = c.view === '3d';
        const shape = ctx.shape ? ctx.shape() : null;
        const gate = shape ? view3dGate(shape) : { ok: true, text: '' };
        view3dBtn.setAttribute('aria-pressed', in3d ? 'true' : 'false');
        view3dBtn.classList.toggle('active', in3d);
        view3dBtn.disabled = !gate.ok && !in3d;
        view3dBtn.title = !gate.ok ? gate.text : in3d ? W3.buttonOnHelp : W3.buttonHelp;
        options.update();
    }

    paint();
    return {
        update: paint,
        destroy() {
            for (const pop of pops.splice(0)) pop.destroy();
            options.destroy();
            slot.textContent = '';
        }
    };
}

/** What `PARTS.options` of panels/cell-gene.js is. */
export const OPTIONS_PART = Object.freeze({ mount });
