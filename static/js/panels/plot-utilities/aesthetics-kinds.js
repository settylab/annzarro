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
import { DEFAULT_MARGINS, SCALE_BAR_CORNERS, tickMarksOn } from './plot-options.js';
import { FOCUS_DEFAULTS, FOCUS_SCALE_MAX, FOCUS_EDGE_MAX } from '../../utils/focus-style.js';
import { plotColour } from '../../utils/plot-theme.js';

/** The kinds, as their panel types. */
// export-unused-ok: the Node tests walk both kinds
export const AESTHETICS_KINDS = Object.freeze(['cell-plot', 'gene-plot']);

/** The sections of the two kinds in the shared order; `panel:*` are their own. */
const ORDER = Object.freeze(['presets', 'text', 'background', 'axes', 'panel:points', 'panel:focused', 'legend', 'margins', 'export', 'apply']);

// a number under its least is not taken (these plots ignored it), rather than made the least
const f = (id, section, type, label, dflt, extra = {}) => ({ id, section, type, path: id, label, dflt, ...(type === 'number' ? { ignoreBelow: true, live: true } : {}), ...extra });

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

/** Why the axes cannot be flipped now ('' when they can). */
const flipOff = (c) => (c.z ? 'Axis directions can be flipped in 2D plots only.' : '');

/** Why the scale bar is off now ('' when it is on): it needs a 2D plot with Equal aspect. */
const scaleBarOff = (c) => (c.z ? 'The scale bar is for 2D plots.'
    : !c.equalAspect ? 'Needs Equal aspect (the panel controls): without it a unit is not as long on y as on x.' : '');

/**
 * The opacity the grey points of a table filter are drawn at now, rounded, as text; '' while there are none. The empty
 * box shows it (it is automatic until the user types), so the arrows step from what is on screen.
 */
function drawnGreyOpacity(id) {
    const gd = typeof document !== 'undefined' && document.getElementById(`plot-container-${id}`);
    const t = gd && gd.data && gd.data.find((tr) => tr && tr.name === 'Not in table' && tr.x);
    const o = t && t.marker && t.marker.opacity;
    return typeof o === 'number' && o > 0 && o <= 1 ? String(Math.round(o * 100) / 100) : '';
}

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
    // Axes and ticks. Flip x and Flip y are a view of the plot, not its look: never copied, never reset, off in 3D
    f('showGrid', 'axes', 'check', 'Grid', true, { domId: 'grid-toggle' }),
    themed('gridColor', 'axes', 'Grid color', 'grid-color'),
    f('gridLineWidth', 'axes', 'number', 'Grid line width (px)', 1, { min: 0.1, max: 10, step: 0.1, domId: 'grid-line-width' }),
    f('showAxisLines', 'axes', 'check', 'Axis lines', true, { domId: 'show-axis-lines' }),
    themed('axisColor', 'axes', 'Axis color', 'axis-color'),
    f('axisLineWidth', 'axes', 'number', 'Axis line width (px)', 1, { min: 0.1, max: 10, step: 0.1, domId: 'axis-line-width' }),
    f('showZeroLines', 'axes', 'check', 'Zero lines', false, { domId: 'zero-lines' }),
    themed('zeroLineColor', 'axes', 'Zero line color', 'zero-line-color'),
    f('zeroLineWidth', 'axes', 'number', 'Zero line width (px)', 1, { min: 0.1, max: 10, step: 0.1, domId: 'zero-line-width' }),
    f('showAxisTitles', 'axes', 'check', 'Axis titles', true, { domId: 'show-axis-titles' }),
    f('showAxisLabels', 'axes', 'check', 'Tick labels', true, { domId: 'show-axis-labels' }),
    f('showTickMarks', 'axes', 'check', 'Tick marks', null, { domId: 'show-tick-marks', shown: (c) => tickMarksOn(c) }),
    f('tickCount', 'axes', 'number', 'Ticks per axis', null, { min: 2, max: 30, step: 1, domId: 'tick-count', placeholder: 'auto', stepFrom: 6,
        help: 'About this many on each axis. Empty: automatic.' }),
    f('flipY', 'axes', 'check', 'Flip y', false, { domId: 'flip-y', copy: false, look: false, disabled: flipOff,
        help: 'y grows downwards, as spatial coordinates are often read.' }),
    f('flipX', 'axes', 'check', 'Flip x', false, { domId: 'flip-x', copy: false, look: false, disabled: flipOff, help: 'x grows to the left.' }),
    f('showScaleBar', 'axes', 'check', 'Scale bar', false, { domId: 'show-scale-bar', disabled: scaleBarOff,
        helpId: 'scale-bar-note', help: 'A round length in coordinate units, about a fifth of the width in view; it follows the zoom.' }),
    f('scaleBarSize', 'axes', 'range', 'Scale bar size (%)', 1, { min: 0.25, max: 4, step: 0.05, percent: true, live: true, domId: 'scale-bar-size', disabled: scaleBarOff, quiet: true }),
    f('scaleBarUnit', 'axes', 'text', 'Scale bar unit', '', { domId: 'scale-bar-unit', maxlength: 20, placeholder: 'optional, e.g. \u00b5m', disabled: scaleBarOff, quiet: true }),
    f('scaleBarCorner', 'axes', 'select', 'Scale bar corner', 'bottom-right', { domId: 'scale-bar-corner', disabled: scaleBarOff, quiet: true,
        choices: SCALE_BAR_CORNERS.map((c) => [c, c.replace('-', ' ')]) }),
    // Points: the size of the points (the grid's slider before WP-5b, the panel's own row) and the grey points of a table filter
    f('pointSize', 'panel:points', 'number', 'Point size', null, { copy: false, look: false, element: true }),
    f('notInTableScale', 'panel:points', 'number', 'Not in table: size (x auto)', 1, { min: 0.1, max: 20, step: 0.1, domId: 'not-in-table-scale',
        help: 'The grey points a table filter leaves in the plot, relative to the size their count gets automatically.' }),
    f('notInTableOpacity', 'panel:points', 'number', 'Not in table: opacity', null, { min: 0.05, max: 1, step: 0.05, domId: 'not-in-table-opacity',
        placeholder: 'auto', shown: (c, env) => drawnGreyOpacity(env.panelId), stepFrom: 1 }),
    themed('notInTableColor', 'panel:points', 'Not in table: color', 'not-in-table-color'),
    // Focused cell / gene: the marker on the focused entity, while Highlight Focused is on
    f('focusedScale', 'panel:focused', 'number', 'Size (x points)', null, { shown: () => FOCUS_DEFAULTS.scale, min: 0.1, max: FOCUS_SCALE_MAX, step: 0.1, domId: 'focused-scale',
        help: { 'cell-plot': 'The marker on the focused cell, while Highlight Focused Cell is on. 5 is five times the point size.',
            'gene-plot': 'The marker on the focused gene, while Highlight Focused Gene is on. 5 is five times the point size.' } }),
    f('focusedOpacity', 'panel:focused', 'number', 'Opacity', FOCUS_DEFAULTS.opacity, { min: 0.05, max: 1, step: 0.05, domId: 'focused-opacity' }),
    f('focusedEdgeWidth', 'panel:focused', 'number', 'Edge width (px)', null, { shown: () => FOCUS_DEFAULTS.edgeWidth, min: 0, max: FOCUS_EDGE_MAX, step: 0.5, domId: 'focused-edge-width',
        help: '0: no edge. With No fill the edge stays at least 1 px.' }),
    themed('focusedColor', 'panel:focused', 'Fill color', 'focused-color'),
    f('focusedNoFill', 'panel:focused', 'check', 'No fill', true, { domId: 'focused-no-fill' }),
    themed('focusedEdgeColor', 'panel:focused', 'Edge color', 'focused-edge-color'),
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
    return fieldsOf(kind).filter((x) => x.section === id && x.id !== 'pointSize' && x.look !== false).map((x) => x.path);
}

