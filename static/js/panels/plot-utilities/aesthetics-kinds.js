/**
 * The Cell Plot and the Gene Plot on the shared Plot Options (WP-5b; design note options-ux-080 sections 2f, 3.1, 4;
 * operator decisions 25 and 39): their two kinds declared in the schema (options-schema.js `registerKind`,
 * `registerPanelFields`), with the settings keys they have always stored, so a link from before keeps every aesthetic.
 *
 * The kinds' sections follow the shared order: Presets, Text, Background, Axes, then their own Points (the point size,
 * moved here from the control grid, and the grey points a table filter leaves) and Focused cell / gene, then Legend,
 * Margins, Export, Apply. Each field is the stored key (`path`), its section and its built-in default (`dflt`, as
 * plot-options.js `defaultLook` and plot-aesthetics-menu.js `initializeAestheticsSettings` fill it; a colour's default
 * is null: it follows the app theme). The menu (plot-aesthetics-menu.js) reads `sectionKeys` for its Reset per section,
 * and the section order for its groups. Pure, no DOM.
 */
import { registerKind, registerPanelFields, fieldsOf } from './options-schema.js';
import { DEFAULT_MARGINS } from './plot-options.js';
import { plotColour } from '../../utils/plot-theme.js';

/** The kinds, as their panel types. */
// export-unused-ok: the Node tests walk both kinds
export const AESTHETICS_KINDS = Object.freeze(['cell-plot', 'gene-plot']);

/** The sections of the two kinds in the shared order; `panel:*` are their own. */
const ORDER = Object.freeze(['presets', 'text', 'background', 'axes', 'panel:points', 'panel:focused', 'legend', 'margins', 'export', 'apply']);

const f = (id, section, type, label, dflt, extra = {}) => ({ id, section, type, path: id, label, dflt, ...extra });

/** A colour that follows the app theme: its swatch shows the colour drawn now while it is Auto. */
const themed = (id, section, label, domId, extra = {}) => f(id, section, 'color', label, null, { domId, live: true, shown: (c) => plotColour(c, id), ...extra });

/** The fonts these plots offer (Open Sans, the count plot's font, is not one of them). */
const FONTS = Object.freeze([
    ['Arial, Helvetica, sans-serif', 'Arial'],
    ["'Times New Roman', Times, serif", 'Times New Roman'],
    ['Courier, monospace', 'Courier'],
    ['Georgia, serif', 'Georgia'],
    ["'Trebuchet MS', sans-serif", 'Trebuchet MS'],
    ['Verdana, sans-serif', 'Verdana']
]);

/** Shown in 3D only. */
const in3D = (c) => !!c.z;

/** The fields of both kinds, at the settings keys the plots store. */
const FIELDS = Object.freeze([
    // Presets: Bare is a state of its own (no axis at all), set by its button and cleared by Default
    f('bare', 'presets', 'check', 'Bare', false),
    // Text
    f('fontFamily', 'text', 'select', 'Font', 'Arial, Helvetica, sans-serif', { choices: FONTS, domId: 'font-family' }),
    f('fontSize', 'text', 'number', 'Size (px)', 12, { min: 8, max: 24, step: 1, domId: 'font-size' }),
    themed('textColor', 'text', 'Color', 'text-color'),
    // Background
    themed('bgColor', 'background', 'Color', 'plot-bg-color'),
    f('showBackdrop', 'background', 'check', '3D backdrop', false, { domId: 'show-backdrop', when: in3D }),
    themed('backdropColor', 'background', '3D backdrop color', 'backdrop-color', { when: in3D }),
    // Axes and ticks (Flip x and Flip y are a view of the plot, not its look: not here)
    f('showGrid', 'axes', 'check', 'Show Grid', true),
    f('gridColor', 'axes', 'color', 'Grid Color', null),
    f('showAxisTitles', 'axes', 'check', 'Show Axis Titles', true),
    f('showAxisLabels', 'axes', 'check', 'Show Tick Labels', true),
    f('showAxisLines', 'axes', 'check', 'Show Axis Lines', true),
    f('showZeroLines', 'axes', 'check', 'Show Zero Lines', false),
    f('axisLineWidth', 'axes', 'number', 'Axis line width', 1, { min: 0.1, max: 10, step: 0.1 }),
    f('gridLineWidth', 'axes', 'number', 'Grid line width', 1, { min: 0.1, max: 10, step: 0.1 }),
    f('zeroLineWidth', 'axes', 'number', 'Zero line width', 1, { min: 0.1, max: 10, step: 0.1 }),
    f('axisColor', 'axes', 'color', 'Axis Color', null),
    f('zeroLineColor', 'axes', 'color', 'Zero Line Color', null),
    f('showTickMarks', 'axes', 'check', 'Show Tick Marks', null),
    f('tickCount', 'axes', 'number', 'Ticks per axis', null, { min: 2, max: 30, step: 1 }),
    f('showScaleBar', 'axes', 'check', 'Scale bar', false),
    f('scaleBarSize', 'axes', 'number', 'Scale bar size', 1, { min: 0.25, max: 4, step: 0.05 }),
    f('scaleBarUnit', 'axes', 'text', 'Scale bar unit', ''),
    f('scaleBarCorner', 'axes', 'select', 'Scale bar corner', 'bottom-right'),
    // Points: the size of the points (the grid's slider before WP-5b) and the grey points of a table filter
    f('pointSize', 'panel:points', 'number', 'Point size', null, { copy: false }),
    f('notInTableScale', 'panel:points', 'number', 'Not in table: size', 1, { min: 0.1, max: 20, step: 0.1 }),
    f('notInTableOpacity', 'panel:points', 'number', 'Not in table: opacity', null, { min: 0.05, max: 1, step: 0.05 }),
    f('notInTableColor', 'panel:points', 'color', 'Not in table: colour', null),
    // Focused cell / gene
    f('focusedScale', 'panel:focused', 'number', 'Size', null),
    f('focusedOpacity', 'panel:focused', 'number', 'Opacity', null),
    f('focusedEdgeWidth', 'panel:focused', 'number', 'Edge width', null),
    f('focusedColor', 'panel:focused', 'color', 'Fill', null),
    f('focusedNoFill', 'panel:focused', 'check', 'No fill', null),
    f('focusedEdgeColor', 'panel:focused', 'color', 'Edge', null),
    // Legend and colour bar
    f('showLegend', 'legend', 'check', 'Show Legend', true),
    f('legendPosition', 'legend', 'select', 'Legend Position', 'right'),
    f('showLegendTitle', 'legend', 'check', 'Legend title', true),
    f('legendTitleSize', 'legend', 'number', 'Title size', null),
    f('legendTitleAlign', 'legend', 'select', 'Title align', null),
    f('legendTitleGap', 'legend', 'number', 'Title gap', null),
    f('legendDotSize', 'legend', 'number', 'Dot size', null),
    f('legendColumns', 'legend', 'number', 'Columns', null),
    f('legendColumnGap', 'legend', 'number', 'Column gap', null),
    f('colorbarPosition', 'legend', 'select', 'Colour bar position', 'legend'),
    f('colorbarLength', 'legend', 'number', 'Colour bar length', 1),
    f('colorbarTicks', 'legend', 'number', 'Colour bar ticks', null),
    // Margins
    f('margins', 'margins', 'text', 'Margins', DEFAULT_MARGINS),
    f('marginsUnlinked', 'margins', 'check', 'Set each side separately', false),
    // Export
    f('exportWidth', 'export', 'number', 'Width', 1200),
    f('exportHeight', 'export', 'number', 'Height', 800),
    f('scaleExport', 'export', 'check', 'Export at 2x', true)
]);

for (const kind of AESTHETICS_KINDS) {
    registerKind(kind, { order: ORDER, common: false });
    registerPanelFields(kind, FIELDS);
}

/**
 * The settings keys a section of the menu holds (its Reset puts them back), by the menu's section key: the shared
 * sections by their own id, the kinds' own as 'points' and 'focused'.
 * @param {'cell-plot'|'gene-plot'} kind
 * @param {string} section - presets, text, background, axes, points, focused, legend, margins, export
 * @returns {string[]}
 */
export function sectionKeys(kind, section) {
    if (section === 'presets') return [];          // the presets are buttons; Default undoes Bare
    const id = section === 'points' || section === 'focused' ? `panel:${section}` : section;
    return fieldsOf(kind).filter((x) => x.section === id && x.id !== 'pointSize').map((x) => x.path);
}

