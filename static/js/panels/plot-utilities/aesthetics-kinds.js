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
import { DEFAULT_MARGINS, SCALE_BAR_CORNERS, COLORBAR_POSITIONS, tickMarksOn } from './plot-options.js';
import { legendTitleSize, defaultTitleGap, DOT_SIZE_MIN, DOT_SIZE_MAX, DOT_SIZE_AUTO, COLUMNS_MAX, TITLE_SIZE_MIN, TITLE_SIZE_MAX, TITLE_GAP_MAX,
    COLUMN_GAP_MAX, COLUMN_GAP_DEFAULT } from '../../utils/legend-options.js';
import { FOCUS_DEFAULTS, FOCUS_SCALE_MAX, FOCUS_EDGE_MAX } from '../../utils/focus-style.js';
import { plotColour } from '../../utils/plot-theme.js';
import { FONT_CHOICES, DEFAULT_FONT } from '../../utils/fonts.js';
import { pointSizeScale, roundSig, snapPointSize } from '../../utils/slider-scales.js';

/** The kinds, as their panel types. */
// export-unused-ok: the Node tests walk both kinds
export const AESTHETICS_KINDS = Object.freeze(['cell-plot', 'gene-plot']);

/** The sections of the two kinds in the shared order; `panel:*` are their own. */
const ORDER = Object.freeze(['presets', 'text', 'background', 'axes', 'panel:points', 'panel:focused', 'legend', 'margins', 'export', 'apply']);

// a number under its least is not taken (these plots ignored it), rather than made the least
const f = (id, section, type, label, dflt, extra = {}) => ({ id, section, type, path: id, label, dflt, ...(type === 'number' ? { ignoreBelow: true, live: true } : {}), ...extra });

/** A colour that follows the app theme: its swatch shows the colour drawn now while it is Auto. */
const themed = (id, section, label, domId, extra = {}) => f(id, section, 'color', label, null, { domId, live: true, shown: (c) => plotColour(c, id), ...extra });

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
    f('bare', 'presets', 'check', 'Bare', false, { hidden: true }),
    // Text
    f('fontFamily', 'text', 'select', 'Font', DEFAULT_FONT, { choices: FONT_CHOICES, domId: 'font-family' }),
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
    f('pointSize', 'panel:points', 'scaled', 'Point size (px)', null, { copy: false, look: false, domId: 'point-size', scale: pointSizeScale, autoPath: 'autoPointSize',
        // sizes snap to the steps scattergl draws (2D); in 3D any size: one read off the track to two significant digits, one typed as it is
        snap: (v, c, fromTrack) => (c.z ? (fromTrack ? roundSig(v) : v) : snapPointSize(v)) }),
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
    f('showLegend', 'legend', 'check', 'Show legend', true, { domId: 'show-legend' }),
    f('legendPosition', 'legend', 'select', 'Legend position', 'right', { domId: 'legend-position',
        choices: [['right', 'Right'], ['left', 'Left'], ['top', 'Top'], ['bottom', 'Bottom']] }),
    f('showLegendTitle', 'legend', 'check', 'Legend title', true, { domId: 'show-legend-title' }),
    f('legendTitleSize', 'legend', 'number', 'Title size (px)', null, { min: TITLE_SIZE_MIN, max: TITLE_SIZE_MAX, step: 1, domId: 'legend-title-size',
        placeholder: (c) => legendTitleSize({ fontSize: c.fontSize }), stepFrom: true, help: 'Empty: 2 px above the text size.' }),
    f('legendTitleAlign', 'legend', 'select', 'Title align', null, { domId: 'legend-title-align',
        choices: [[null, 'Auto'], ['markers', 'Markers'], ['labels', 'Labels'], ['centre', 'Centre'], ['right', 'Right']],
        help: 'Auto: centred over a legend above or below the plot, at the markers beside it. Centre and Right are across all the columns.' }),
    f('legendTitleGap', 'legend', 'number', 'Title gap (px)', null, { min: 0, max: TITLE_GAP_MAX, step: 1, domId: 'legend-title-gap',
        placeholder: (c) => defaultTitleGap({ fontSize: c.fontSize }), stepFrom: true, help: 'Empty: one blank line.' }),
    f('legendDotSize', 'legend', 'number', 'Dot size (px)', null, { min: DOT_SIZE_MIN, max: DOT_SIZE_MAX, step: 1, domId: 'legend-dot-size',
        placeholder: DOT_SIZE_AUTO, stepFrom: true, help: 'The dots of a categorical legend, apart from the points\' size.' }),
    f('legendColumns', 'legend', 'number', 'Columns', null, { min: 1, max: COLUMNS_MAX, step: 1, domId: 'legend-columns', placeholder: 1, stepFrom: true,
        help: 'The entries in order down each column; labels too long for the room are cut short.' }),
    f('legendColumnGap', 'legend', 'number', 'Column gap (px)', null, { min: 0, max: COLUMN_GAP_MAX, step: 1, domId: 'legend-column-gap',
        placeholder: COLUMN_GAP_DEFAULT, stepFrom: true }),
    f('colorbarPosition', 'legend', 'select', 'Color bar position', 'legend', { domId: 'colorbar-position',
        choices: COLORBAR_POSITIONS.map((c) => [c, c === 'legend' ? 'With the legend' : c[0].toUpperCase() + c.slice(1)]) }),
    f('colorbarLength', 'legend', 'range', 'Color bar length (%)', 1, { min: 0.1, max: 1, step: 0.05, percent: true, live: true, domId: 'colorbar-length' }),
    f('colorbarTicks', 'legend', 'number', 'Color bar ticks', null, { min: 2, max: 30, step: 1, domId: 'colorbar-ticks', placeholder: 'auto', stepFrom: 5 }),
    // Margins: one value for all four sides, or each side (the room the plot leaves around its axes)
    f('margins', 'margins', 'margins', 'Margins', DEFAULT_MARGINS, { unlinkedPath: 'marginsUnlinked', min: 0, max: 200, live: true }),
    // Export (the image's size; the memory guard and the formats are the pop-over's)
    f('exportWidth', 'export', 'number', 'Width (px)', 1200, { min: 100, max: 5000, step: 1, domId: 'plot-width' }),
    f('exportHeight', 'export', 'number', 'Height (px)', 800, { min: 100, max: 5000, step: 1, domId: 'plot-height' }),
    f('scaleExport', 'export', 'check', 'Export at 2x', true, { domId: 'scale-export',
        help: 'Draw the image at twice the width and height, so it stays sharp in print; PNG, JPEG and WEBP files are then twice the pixels set above.' })
]);

/**
 * The kinds' own presets (the Cell Plot's and Gene Plot's, in plot-options.js and utils/session-style.js, not generic values):
 * `fn(config, name, kind)` returns the configuration a preset gives. Registered by the menu, which has the session default.
 * @param {(config: Object, name: string, kind: string) => Object} fn
 */
export function registerPresets(fn) {
    for (const kind of AESTHETICS_KINDS) registerKind(kind, { order: ORDER, common: false, preset: (config, name) => fn(config, name, kind) });
}

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
// export-unused-ok: the Node tests hold what a group's Reset puts back
export function sectionKeys(kind, section) {
    if (section === 'presets') return [];          // the presets are buttons; Default undoes Bare
    const id = section === 'points' || section === 'focused' ? `panel:${section}` : section;
    return fieldsOf(kind).filter((x) => x.section === id && x.id !== 'pointSize' && x.look !== false).map((x) => x.path);
}

