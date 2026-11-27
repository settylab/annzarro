import { DEFAULT_FONT } from '../../utils/fonts.js';
import { registerCameraExport, setStatusTag, nudgeStatusTag, exportWithCoverage } from '../../utils/panel-surface.js';
import { axisTitle, refreshScaleBar, flipRelayout } from './plot-make-helper.js';
import { hasLegendEntries } from '../../utils/legend-entries.js';
import { applyLegendOptions, legendOrientation, legendTitleText, legendTitleFontSize, legendTitleKeys } from '../../utils/legend-options.js';
import { restyleMarkers, restyleFocus } from './plot-update.js';
import { FOCUS_DEFAULTS } from '../../utils/focus-style.js';
import {
  plotColour, isFollowing, modebarColours, THEMED_COLOURS
} from '../../utils/plot-theme.js';
import { THEME_EVENT } from '../../utils/theme.js';
import {
  normalizePlotOptions, tickKeys, axisPaths, colorbarPosition, colorbarExtras,
  applyPreset, pickStyle, adoptStyle, exportOptions, STYLE_KEYS
} from './plot-options.js';
import { exportImage, fullImage, canSnapshot, snapshotSize } from '../../utils/plot-export.js';
import {
  hasSessionStyle, setSessionStyle, clearSessionStyle, effectiveStyle, onSessionStyleChange, STYLE_TYPES, LOOK_TYPES
} from '../../utils/session-style.js';
import { exportCheck, guarded, refusalText, bindingLabel } from '../../utils/memory-guard-ui.js';
import { showPointStyle } from './panel-ui-update.js';
import { registerPresets } from './aesthetics-kinds.js';
import { mountPlotOptions } from './options-popover.js';
import { createSettingsAdapter } from './plot-aesthetics-adapter.js';
/**
 * Plot Aesthetics Menu
 * 
 * This module provides a comprehensive menu system for controlling plot aesthetics and export options.
 * Features include grid visibility, axes customization, margin control, theme settings,
 * export formats (SVG, PNG), plot dimension controls, and more.
 */

/**
 * The Cell Plot's and Gene Plot's presets for the shared Plot Options: Publication and Bare as plot-options.js defines them,
 * Default as the session default (or the built-in look) puts the plot back on Default. A copy of the settings comes back; a
 * look change that is not Default takes the plot off Default, as every change of the look does.
 */
registerPresets((config, name, kind) => {
  const next = JSON.parse(JSON.stringify(config));
  if (name === 'default') return followSessionDefault(next, kind);
  const before = JSON.stringify(pickStyle(next));
  applyPreset(next, name);
  if (next.styleDefault === true && JSON.stringify(pickStyle(next)) !== before) next.styleDefault = false;
  return next;
});

/**
 * The plot's Plot Options on the shared pop-over (ui/popover.js; WP-5b, design note options-ux-080 section 5): Escape
 * from anywhere and a press outside close it, focus goes into it and back to its button, one pop-over is open
 * page-wide, and opening it moves nothing in the panel. Its groups are the shared order (aesthetics-kinds.js), each

 * @param {string} id - Panel ID
 * @param {HTMLElement} menuButton - Existing menu button element
 * @param {HTMLElement} container - Container element for passing to listeners
 * @param {HTMLElement} plotContainer - Plot container element (for applying changes)
 * @param {Object} settings - Plot settings object
 * @returns {Function} cleanup function to remove listeners and dispose popover
 */
export function createAestheticsMenu(id, menuButton, container, plotContainer, settings) {
  let sizeWatch = null;
  const kind = `${plotKindOf(settings)}-plot`;
  // what each migrated field does to the plot once the adapter has written it (plot-aesthetics-adapter.js): the plot's
  // own update functions, as the menu's handlers ran them before the pop-over used the shared renderer
  const hooks = {
    fontFamily: (s) => updateFontFamily(plotContainer, s),
    fontSize: (s) => updateFontSize(plotContainer, s),
    textColor: (s) => updateTextColor(plotContainer, s),
    bgColor: (s) => updatePlotBackground(plotContainer, s),
    showBackdrop: (s) => update3DBackdrop(plotContainer, s),
    backdropColor: (s) => update3DBackdrop(plotContainer, s)
  };
  // several fields share one update: the same function, so a change of two of them runs it once
  const axisVisibility = (s) => updateAxisVisibility(plotContainer, s);
  const lineWidths = (s) => updateLineWidths(plotContainer, s);
  const ticks = (s) => relayoutTicks(plotContainer, s);
  const scaleBar = (s) => refreshScaleBar(plotContainer, s);
  // an axis direction is a view: the plot is laid out again (2D only), then the scale bar follows
  const flip = (s) => {
    const fl = plotContainer._fullLayout;
    if (!fl || s.z) return;
    Promise.resolve(Plotly.relayout(plotContainer, flipRelayout(s, fl)))
      .then(() => refreshScaleBar(plotContainer, s))
      .catch(err => console.warn('Axis direction not changed:', err && err.message));
  };
  const greyPoints = (s) => restyleMarkers(plotContainer, s).catch(err => console.warn('Not-in-table style not updated:', err && err.message));
  // an open circle is its edge: without one it would vanish, so No fill keeps the edge at least 1 px
  const focused = (s) => {
    if (s.focusedNoFill !== false && !((s.focusedEdgeWidth ?? FOCUS_DEFAULTS.edgeWidth) >= 1)) s.focusedEdgeWidth = 1;
    return restyleFocus(plotContainer, s).catch(err => console.warn('Focused marker style not updated:', err && err.message));
  };
  // the legend's own options redraw it in its position's orientation; the colour bar follows the legend's place and its own keys
  const legend = (s) => applyLegendOptions(plotContainer, s, getPositioningByLocation(s.legendPosition || 'right').legendOrientation);
  const legendPlace = (s) => updateLegendPosition(plotContainer, s);
  Object.assign(hooks, {
    margins: (s) => updateMargins(plotContainer, s),
    // the point size: the panel's own redraw (listeners.js), which also works the automatic size out when Auto is on
    pointSize: (s) => plotContainer.__pointSizeChanged && plotContainer.__pointSizeChanged(s),
    showLegend: (s) => updateLegendVisibility(plotContainer, s), legendPosition: legendPlace,
    showLegendTitle: legend, legendTitleSize: legend, legendTitleAlign: legend, legendTitleGap: legend, legendDotSize: legend, legendColumns: legend, legendColumnGap: legend,
    colorbarPosition: legendPlace, colorbarLength: legendPlace, colorbarTicks: legendPlace,
    showGrid: (s) => toggleGrid(plotContainer, s), gridColor: (s) => updateGridColor(plotContainer, s),
    axisColor: (s) => updateAxisColor(plotContainer, s), zeroLineColor: (s) => updateZeroLineColor(plotContainer, s),
    showAxisTitles: axisVisibility, showAxisLabels: axisVisibility, showAxisLines: axisVisibility, showZeroLines: axisVisibility,
    gridLineWidth: lineWidths, axisLineWidth: lineWidths, zeroLineWidth: lineWidths,
    showTickMarks: ticks, tickCount: ticks, flipX: flip, flipY: flip,
    showScaleBar: scaleBar, scaleBarSize: scaleBar, scaleBarUnit: scaleBar, scaleBarCorner: scaleBar,
    notInTableScale: greyPoints, notInTableOpacity: greyPoints, notInTableColor: greyPoints,
    focusedScale: focused, focusedOpacity: focused, focusedEdgeWidth: focused, focusedColor: focused, focusedNoFill: focused, focusedEdgeColor: focused
  });
  const adapter = createSettingsAdapter({
    kind, settings, hooks, initialize: initializeAestheticsSettings,
    relook: (s) => {
      relookPlot(plotContainer, s);
      restyleFocus(plotContainer, s).catch(() => {});
      refreshScaleBar(plotContainer, s);
    },
    notify: (setting, value) => notifySettingsChanged(id, setting, value)
  });
  let options = null;
  options = mountPlotOptions({
    anchor: menuButton, kind, panelId: id, noFollow: true,
    config: () => settings,
    commit: (next, label) => { adapter.commit(next, label); options.update(); showPointStyle(id, settings); },
    replace: (next) => { Object.assign(settings, next); },
    sectionKey: (sec) => sec.replace(/^panel:/, ''),
    // the kinds' own groups; the point size is the panel's row (listeners.js), moved in while the pop-over is open
    sections: { 'panel:points': { title: 'Points', reset: true }, 'panel:focused': { title: `Focused ${plotKindOf(settings)}`, reset: true } },
    openFirst: new Set(['export']),      // as the menu has always opened: only Export, the rest as it was left
    ids: true, guide: 'https://annzarro.readthedocs.io/en/latest/user-guide/plot-options.html#session-default-style',
    classes: { exportBtn: 'export-btn' },
    presetTitle: (p) => PRESET_TITLES[p](hasSessionStyle(kind)),
    // the image is made of the settings as they are (exportOptions), at the size and scale set in Export
    exportImage: (format, _style, how) => exportPlot(plotContainer, format, settings, how),
    copyImage: () => copyPlotToClipboard(plotContainer, settings),
    exportGuard: () => exportGuard(plotContainer, settings),
    // Apply to the other plots of the kind and the session default are this panel's own (session-style.js keeps what is a look)
    others: { count: () => otherPlots(id).length, run: () => applyLookToOthers(id, settings) },
    session: {
      has: () => hasSessionStyle(kind),
      onDefault: () => settings.styleDefault === true,
      state: (onDefault) => (onDefault ? 'On Default' : 'Own style'),
      clear: () => clearSessionStyle(kind),
      set: () => {
        const isSet = setSessionStyle(kind, settings, builtinStyle());
        settings.styleDefault = true;       // its look is the default now
        if (!isSet) clearSessionStyle(kind);
      }
    },
    // why it closed last (a test hook, and a hint when a menu goes away unasked)
    onClose: (reason) => { menuButton.dataset.closedBy = reason; },
    onOpen: (body, ctl) => {
      ctl.surface.classList.add('aesthetics-popover');
      menuButton.classList.add('btn-aesthetics-active');
      showPointStyle(id, settings);         // the point size's titles and Auto state, as the panel words them
      syncColourControls(id, settings);     // a colour that follows the theme has nothing to reset
      return () => {
        sizeWatch?.disconnect();
        sizeWatch = null;
        menuButton.classList.remove('btn-aesthetics-active');
      };
    }
  });
  const popover = options.popover;
  // Settings-change listener: the pop-over follows a taller or shorter body
  const onSettingsChange = (e) => {
    if (e.detail.id !== id) return;
    syncColourControls(id, settings);     // a colour set now has a Reset; one reset follows the theme again
    options.update();
    showPointStyle(id, settings);
    popover.update();
  };
  document.addEventListener('plotSettingsChanged', onSettingsChange);

  // the settings have the defaults the plot stores, and the modebar camera exports at the size and scale set in Export
  initializeAestheticsSettings(settings);
  if (plotContainer) plotContainer.__exportOptions = () => exportOptions(settings);

  // Return cleanup function
  return function cleanup() {
    options.destroy();
    document.removeEventListener('plotSettingsChanged', onSettingsChange);
  };
}
  

export { exportOptions };

const EXPORT_ADVICE = 'Export it as shown instead, close a plot, or show fewer cells.';

/**
 * The memory guard of the Export buttons (the shared renderer draws them, options-popover.js). A full-resolution export
 * draws the plot again, which needs about as much browser memory as the plot itself; when that does not fit
 * (utils/memory-guard-ui.js) its buttons are disabled with the reason written under them, and the plot as shown on
 * screen, which costs only its pixels, is offered beside them.
 * @returns {{blocked: boolean, why: string, note: string, shown: string[], size: string}}
 */
function exportGuard(gd, settings) {
  let check;
  try { check = gd && gd._fullLayout ? exportCheck(gd, exportOptions(settings)) : null; } catch { check = null; }
  const blocked = !!check && check.verdict === 'block';
  const short = !!check && !check.fits;
  const why = short ? refusalText(check, EXPORT_ADVICE) : '';
  let shown = [];
  let size = '';
  if (short && gd && canSnapshot(gd)) {
    const { width, height } = snapshotSize(gd);
    shown = ['png', 'svg'];
    size = `${width} \u00d7 ${height} px`;
  }
  const note = short ? (blocked ? `Full resolution: ${why}` : `Full resolution may run out of memory: ${why}`) : '';
  return { blocked, why: blocked ? why : '', note, shown, size };
}

/** The presets' tooltips (the buttons are the shared renderer's); Default says which look it puts back. */
const PRESET_TITLES = {
  publication: () => 'White background, no grid, five ticks per axis, Arial at a larger size, a short colour bar with three ticks. The scale bar stays as it is',
  bare: () => 'Only the points: no margins, legend, axis labels or grid. For figures and overlays.',
  default: (session) => (session ? 'Session default style: the look every plot on Default has' : 'Built-in style')
};

/**
 * Initialize the settings object with default aesthetic settings if they don't exist
 * @param {Object} settings - The settings object to initialize
 */
export function initializeAestheticsSettings(settings) {
    // Import default aesthetics from Config
    const defaults = (window.Config && window.Config.DEFAULTS && window.Config.DEFAULTS.PLOT_AESTHETICS) || {
        // Grid settings
        SHOW_GRID: true,
        
        // Axes settings
        SHOW_AXIS_TITLES: true,
        SHOW_AXIS_LABELS: true,
        SHOW_AXIS_LINES: true,
        SHOW_ZERO_LINES: false,
        
        // Default colors (light theme)
        BG_COLOR: '#ffffff',
        GRID_COLOR: '#e6e6e6',
        AXIS_COLOR: '#000000',
        TEXT_COLOR: '#000000',
        ZERO_LINE_COLOR: '#cccccc',
        
        // Dark theme colors
        DARK_THEME: {
            BG_COLOR: '#1e1e1e',
            GRID_COLOR: '#444444',
            AXIS_COLOR: '#ffffff',
            TEXT_COLOR: '#ffffff',
            ZERO_LINE_COLOR: '#666666'
        },
        
        // Fonts
        FONT_SIZE: 12,
        FONT_FAMILY: DEFAULT_FONT,
        
        // Margins
        MARGINS: { l: 80, r: 80, t: 30, b: 60, pad: 4 },
        
        // Legend settings
        SHOW_LEGEND: true,
        LEGEND_POSITION: 'right',
        
        // Export options
        EXPORT_WIDTH: 1200,
        EXPORT_HEIGHT: 800,
        SCALE_EXPORT: true,
        
        // Interaction settings
        ENABLE_ZOOM: true,
        ENABLE_PAN: true,
        SHOW_HOVER_INFO: true
    };
    
    // Grid and visibility
    settings.showGrid = settings.showGrid !== undefined ? settings.showGrid : defaults.SHOW_GRID;
    settings.showAxisTitles = settings.showAxisTitles !== undefined ? settings.showAxisTitles : defaults.SHOW_AXIS_TITLES;
    settings.showAxisLabels = settings.showAxisLabels !== undefined ? settings.showAxisLabels : defaults.SHOW_AXIS_LABELS;
    settings.showAxisLines = settings.showAxisLines !== undefined ? settings.showAxisLines : defaults.SHOW_AXIS_LINES;
    settings.showZeroLines = settings.showZeroLines !== undefined ? settings.showZeroLines : defaults.SHOW_ZERO_LINES;
    settings.showLegend = settings.showLegend !== undefined ? settings.showLegend : defaults.SHOW_LEGEND;
    
    // Colours are not filled in: a colour that is not set follows the app theme
    // (utils/plot-theme.js). normalizePlotOptions below migrates an older link.
    
    // 3D Backdrop settings
    settings.showBackdrop = settings.showBackdrop !== undefined ? settings.showBackdrop : defaults.SHOW_BACKDROP;
    
    // Line width settings
    settings.axisLineWidth = settings.axisLineWidth || defaults.AXIS_LINE_WIDTH || 1;
    settings.gridLineWidth = settings.gridLineWidth || defaults.GRID_LINE_WIDTH || 1;
    settings.zeroLineWidth = settings.zeroLineWidth || defaults.ZERO_LINE_WIDTH || 1;
    
    // Tick settings
    settings.tickDensity = settings.tickDensity || defaults.TICK_DENSITY || 'auto';
    
    // Fonts and sizing
    settings.fontSize = settings.fontSize || defaults.FONT_SIZE;
    settings.fontFamily = settings.fontFamily || defaults.FONT_FAMILY;
    
    // Margins
    settings.margins = settings.margins || { ...defaults.MARGINS };
    
    // Export options
    settings.exportWidth = settings.exportWidth || defaults.EXPORT_WIDTH;
    settings.exportHeight = settings.exportHeight || defaults.EXPORT_HEIGHT;
    settings.scaleExport = settings.scaleExport !== undefined ? settings.scaleExport : defaults.SCALE_EXPORT;
    
    // Legend settings
    settings.legendPosition = settings.legendPosition || defaults.LEGEND_POSITION;
    
    // Interaction settings
    settings.enableZoom = settings.enableZoom !== undefined ? settings.enableZoom : defaults.ENABLE_ZOOM;
    settings.enablePan = settings.enablePan !== undefined ? settings.enablePan : defaults.ENABLE_PAN;
    settings.showHoverInfo = settings.showHoverInfo !== undefined ? settings.showHoverInfo : defaults.SHOW_HOVER_INFO;

    // Options added later (ticks, colour bar, scale bar, margin link): defaults for configs without them
    normalizePlotOptions(settings);
}

/**
 * Setup event listeners for the aesthetics menu
 * @param {HTMLElement} container - Container element
 * @param {Object} settings - Plot settings object
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {string} id - Panel ID
 */
/**
 * Helper function to extract panel ID from container or plot container
 * @param {HTMLElement} element - Container or plot container
 * @returns {string} - The panel ID
 */
function getPanelId(element) {
    if (!element) return '';
    
    // First try direct ID attribute
    if (element.id) {
        if (element.id.startsWith('plot-container-')) {
            return element.id.replace('plot-container-', '');
        }
    }
    
    // Try to find it from the container
    const plotContainer = element.querySelector('[id^="plot-container-"]');
    if (plotContainer && plotContainer.id) {
        return plotContainer.id.replace('plot-container-', '');
    }
    
    // If all else fails, try to find it from the parent
    const parentPanel = element.closest('.panel');
    if (parentPanel && parentPanel.id) {
        return parentPanel.id;
    }
    
    return '';
}

/**
 * Draw a plot's colours again, as they are now (the pinned ones and the app
 * theme's for the rest): axes, text, background, legend and colour bar text,
 * the toolbar, the grey of points not in the table, the scale bar. Used when
 * the colours change as a set and when the app theme switches.
 */
export function relookColours(plotContainer, settings) {
    if (!plotContainer || !plotContainer._fullLayout) return;
    applyThemeColors(plotContainer, settings);
    applyAllAestheticSettings(plotContainer, settings);
    restyleMarkers(plotContainer, settings).catch(() => {});
}

/** Every open plot takes the app theme's colours for what it has not set (the theme changed); returns how many were redrawn. */
export function relookAllPlots() {
    const pm = window.PanelManager;
    if (!pm || typeof pm.getActivePanels !== 'function') return 0;
    let n = 0;
    for (const panel of pm.getActivePanels()) {
        if (!panel.getId || !panel.getConfig) continue;
        const gd = document.getElementById(`plot-container-${panel.getId()}`);
        if (!gd || !gd._fullLayout) continue;
        const settings = panel.getConfig();
        relookColours(gd, settings);
        updateColorInputs(document.body, panel.getId(), settings);     // the menu shows what is drawn
        n += 1;
    }
    return n;
}

// The app theme switching (the header toggle, the system) redraws the plots' unset colours
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener(THEME_EVENT, () => { relookAllPlots(); });
}

/** Tick marks, labels and count on every axis. */
function relayoutTicks(plotContainer, settings) {
    if (!plotContainer) return;
    Plotly.relayout(plotContainer, tickKeys(settings, axisPaths(settings))).catch(() => {});
}

/** The other plots of the same kind (cell or gene) as panel `id`: their panel objects. */
function otherPlots(id) {
    const pm = window.PanelManager;
    if (!pm || typeof pm.getActivePanels !== 'function') return [];
    const mine = pm.getActivePanels().find(p => p.getId && p.getId() === id);
    if (!mine) return [];
    return pm.getActivePanels().filter(p => p !== mine && p.getType && p.getType() === mine.getType()
        && document.getElementById(`plot-container-${p.getId()}`));
}

/** The plot drawn again from its settings, as after a preset or a copied look. */
function relookPlot(plotContainer, settings) {
    if (!plotContainer || !plotContainer._fullLayout) return;
    applyAllAestheticSettings(plotContainer, settings);
    restyleMarkers(plotContainer, settings).catch(() => {});
}

/** The kind a plot's settings are of: 'cell' or 'gene'. */
function plotKindOf(settings) {
    return settings.highlightFocusedGene !== undefined ? 'gene' : 'cell';
}

/** The built-in look as pickStyle gives it: what a plot starts with before any session default. */
export function builtinStyle() {
    const fresh = {};
    initializeAestheticsSettings(fresh);
    return pickStyle(fresh);
}

/** Put `settings` on Default: the built-in look with the session default of `type` on top. */
export function followSessionDefault(settings, type) {
    adoptStyle(settings, effectiveStyle(type, builtinStyle()));
    settings.styleDefault = true;
    return settings;
}

/**
 * Draw every open plot that is on Default (of `kind`, or all) in the session's default look, or the
 * built-in one when there is none: after the default is set, changed, reset or loaded.
 */
export function restyleDefaultPlots(kind = null) {
    const pm = typeof window !== 'undefined' ? window.PanelManager : null;
    if (!pm || typeof pm.getActivePanels !== 'function') return 0;
    let n = 0;
    for (const panel of pm.getActivePanels()) {
        const type = panel.getType && panel.getType();
        // the shared Plot Options' kinds follow the default themselves (options-popover.js)
        if (!(type in STYLE_TYPES) || LOOK_TYPES.includes(type) || (kind && type !== kind)) continue;
        const cfg = panel.getConfig();
        if (cfg.styleDefault !== true) continue;
        followSessionDefault(cfg, type);
        const next = { styleDefault: true };
        for (const k of STYLE_KEYS) next[k] = cfg[k];            // an unset option stays unset
        panel.setConfig(next);
        relookPlot(document.getElementById(`plot-container-${panel.getId()}`), panel.getConfig());
        n++;
    }
    return n;
}

// The person set or reset the default: the plots on Default follow it at once
onSessionStyleChange(() => restyleDefaultPlots());

/** Copy the look of panel `id` onto the other plots of its kind; returns how many. */
function applyLookToOthers(id, settings) {
    const style = pickStyle(settings);
    const others = otherPlots(id);
    for (const panel of others) {
        const cfg = panel.getConfig();
        adoptStyle(cfg, style);
        const next = { styleDefault: false };                      // a look of its own, whatever the default is
        for (const k of Object.keys(style)) next[k] = cfg[k];      // an unset option stays unset
        panel.setConfig(next);
        relookPlot(document.getElementById(`plot-container-${panel.getId()}`), panel.getConfig());
    }
    return others.length;
}

/**
 * Notify that settings have changed
 * @param {string} id - Panel ID
 * @param {string} setting - Setting name
 * @param {any} value - New setting value
 */
function notifySettingsChanged(id, setting, value) {
    const event = new CustomEvent('plotSettingsChanged', { 
        detail: { id, setting, value } 
    });
    document.dispatchEvent(event);
}

/**
 * Toggle grid visibility in the plot
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
export function toggleGrid(plotContainer, settings) {
    if (!plotContainer) return;
    
    const is3D = settings.z !== null;
    const update = {
        // 2D axes - only control grid lines, not axis lines, labels, etc.
        'xaxis.showgrid': settings.showGrid,
        'yaxis.showgrid': settings.showGrid
    };
    
    // For 3D plots
    if (is3D) {
        Object.assign(update, {
            'scene.xaxis.showgrid': settings.showGrid,
            'scene.yaxis.showgrid': settings.showGrid,
            'scene.zaxis.showgrid': settings.showGrid
        });
    }
    
    Plotly.relayout(plotContainer, update);
}

/**
 * Update font family
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateFontFamily(plotContainer, settings) {
    applyTextFont(plotContainer, settings);
}

/**
 * The panel's text on the plot, in one place: font family, size and colour of
 * the axes (titles and tick labels), the legend (title and items) and the
 * colour bar (title and tick labels, shared or the traces' own). A live change
 * of the font, size or text colour, a preset, a theme change and a plot drawn
 * from a link all come here. Set explicitly, so a change shows at once.
 */
function applyTextFont(plotContainer, settings) {
    if (!plotContainer) return;
    const family = settings.fontFamily || DEFAULT_FONT;
    const size = settings.fontSize || 12;
    const colour = plotColour(settings, 'textColor');
    const text = (prefix, extra) => ({
        [`${prefix}.family`]: family, [`${prefix}.size`]: size + extra, [`${prefix}.color`]: colour
    });
    const update = {
        ...text('font', 0),
        ...text('legend.font', 0), ...text('legend.title.font', 2), 'legend.title.font.size': legendTitleFontSize(settings),
        ...text('coloraxis.colorbar.tickfont', 0), ...text('coloraxis.colorbar.title.font', 2)
    };
    for (const axis of axisPaths(settings)) Object.assign(update, text(`${axis}.tickfont`, 0), text(`${axis}.title.font`, 2));
    // the legend title's indent is spaces of the title's font (utils/legend-options.js)
    if (hasLegendEntries(plotContainer.data)) update['legend.title.text'] = legendTitleText(settings);
    Plotly.relayout(plotContainer, update);
    restyleColourBars(plotContainer,
        { ...text('marker.colorbar.tickfont', 0), ...text('marker.colorbar.title.font', 2) },
        { ...text('colorbar.tickfont', 0), ...text('colorbar.title.font', 2) });
}

/**
 * Restyle the colour bars of a plot: `markerUpdate` on the traces whose
 * marker has one (scatter), `traceUpdate` on those with a colorbar of their
 * own (heatmap, contour, surface). The focused-cell trace is left alone.
 */
function restyleColourBars(plotContainer, markerUpdate, traceUpdate) {
    (plotContainer.data || []).forEach((trace, i) => {
        if (!trace || (trace.name && String(trace.name).includes('Focused'))) return;
        if (trace.marker && trace.marker.colorbar) Plotly.restyle(plotContainer, markerUpdate, [i]);
        else if (trace.colorbar) Plotly.restyle(plotContainer, traceUpdate, [i]);
    });
}

/**
 * Update axis visibility settings
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateAxisVisibility(plotContainer, settings) {
    if (!plotContainer) return;
    
    const is3D = settings.z !== null;
    const update = {};
    
    // Title visibility
    if (settings.showAxisTitles !== undefined) {
        if (is3D) {
            update['scene.xaxis.title.text'] = settings.showAxisTitles ? 
                axisTitle(settings, 'x') : '';
            update['scene.yaxis.title.text'] = settings.showAxisTitles ? 
                axisTitle(settings, 'y') : '';
            update['scene.zaxis.title.text'] = settings.showAxisTitles ? 
                axisTitle(settings, 'z') : '';
        } else {
            update['xaxis.title.text'] = settings.showAxisTitles ? 
                axisTitle(settings, 'x') : '';
            update['yaxis.title.text'] = settings.showAxisTitles ? 
                axisTitle(settings, 'y') : '';
        }
    }
    
    // Tick labels, marks and count
    Object.assign(update, tickKeys(settings, axisPaths(settings)));
    
    // Axis line visibility
    if (settings.showAxisLines !== undefined) {
        if (is3D) {
            update['scene.xaxis.showline'] = settings.showAxisLines;
            update['scene.yaxis.showline'] = settings.showAxisLines;
            update['scene.zaxis.showline'] = settings.showAxisLines;
        } else {
            update['xaxis.showline'] = settings.showAxisLines;
            update['yaxis.showline'] = settings.showAxisLines;
        }
    }
    
    // Zero line visibility
    if (settings.showZeroLines !== undefined) {
        if (is3D) {
            update['scene.xaxis.zeroline'] = settings.showZeroLines;
            update['scene.yaxis.zeroline'] = settings.showZeroLines;
            update['scene.zaxis.zeroline'] = settings.showZeroLines;
        } else {
            update['xaxis.zeroline'] = settings.showZeroLines;
            update['yaxis.zeroline'] = settings.showZeroLines;
        }
    }
    
    if (Object.keys(update).length > 0) {
        Plotly.relayout(plotContainer, update);
    }
}

/**
 * Update line widths for axes, grid, and zero lines
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateLineWidths(plotContainer, settings) {
    if (!plotContainer) return;
    
    const is3D = settings.z !== null;
    const update = {};
    
    // Axis line width
    if (settings.axisLineWidth !== undefined) {
        if (is3D) {
            update['scene.xaxis.linewidth'] = settings.axisLineWidth;
            update['scene.yaxis.linewidth'] = settings.axisLineWidth;
            update['scene.zaxis.linewidth'] = settings.axisLineWidth;
        } else {
            update['xaxis.linewidth'] = settings.axisLineWidth;
            update['yaxis.linewidth'] = settings.axisLineWidth;
        }
    }
    
    // Grid line width
    if (settings.gridLineWidth !== undefined) {
        if (is3D) {
            update['scene.xaxis.gridwidth'] = settings.gridLineWidth;
            update['scene.yaxis.gridwidth'] = settings.gridLineWidth;
            update['scene.zaxis.gridwidth'] = settings.gridLineWidth;
        } else {
            update['xaxis.gridwidth'] = settings.gridLineWidth;
            update['yaxis.gridwidth'] = settings.gridLineWidth;
        }
    }
    
    // Zero line width
    if (settings.zeroLineWidth !== undefined) {
        if (is3D) {
            update['scene.xaxis.zerolinewidth'] = settings.zeroLineWidth;
            update['scene.yaxis.zerolinewidth'] = settings.zeroLineWidth;
            update['scene.zaxis.zerolinewidth'] = settings.zeroLineWidth;
        } else {
            update['xaxis.zerolinewidth'] = settings.zeroLineWidth;
            update['yaxis.zerolinewidth'] = settings.zeroLineWidth;
        }
    }
    
    if (Object.keys(update).length > 0) {
        Plotly.relayout(plotContainer, update);
    }
}


/**
 * Update plot background color
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updatePlotBackground(plotContainer, settings) {
    applyThemeColors(plotContainer, settings);      // one set of colour keys: a colour changed by hand and one drawn from a link are the same plot
}

/**
 * Update 3D backdrop visibility and color
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function update3DBackdrop(plotContainer, settings) {
    if (!plotContainer || !settings.z) return;
    
    const update = {
        'scene.xaxis.showbackground': settings.showBackdrop,
        'scene.yaxis.showbackground': settings.showBackdrop,
        'scene.zaxis.showbackground': settings.showBackdrop,
        'scene.xaxis.backgroundcolor': plotColour(settings, 'backdropColor'),
        'scene.yaxis.backgroundcolor': plotColour(settings, 'backdropColor'),
        'scene.zaxis.backgroundcolor': plotColour(settings, 'backdropColor')
    };
    
    Plotly.relayout(plotContainer, update);
}

/**
 * Update text color
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateTextColor(plotContainer, settings) {
    applyThemeColors(plotContainer, settings);      // one set of colour keys: a colour changed by hand and one drawn from a link are the same plot
}

/**
 * Update grid color
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateGridColor(plotContainer, settings) {
    applyThemeColors(plotContainer, settings);      // one set of colour keys: a colour changed by hand and one drawn from a link are the same plot
}

/**
 * Update axis color
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateAxisColor(plotContainer, settings) {
    applyThemeColors(plotContainer, settings);      // one set of colour keys: a colour changed by hand and one drawn from a link are the same plot
}

/**
 * Update zero line color
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateZeroLineColor(plotContainer, settings) {
    applyThemeColors(plotContainer, settings);      // one set of colour keys: a colour changed by hand and one drawn from a link are the same plot
}

/**
 * Update the color input elements based on current settings
 * @param {HTMLElement} container - Container with the color inputs 
 * @param {string} id - Panel ID
 * @param {Object} settings - Plot settings
 */
export function updateColorInputs(container, id, settings) {
    if (!container) return;
    
    // If id wasn't provided, try to get it from the container
    if (!id) {
        id = getPanelId(container);
        if (!id) return;
    }
    
    // Now find and update the color inputs
    const bgColorInput = document.getElementById(`plot-bg-color-${id}`);
    const textColorInput = document.getElementById(`text-color-${id}`);
    const gridColorInput = document.getElementById(`grid-color-${id}`);
    const axisColorInput = document.getElementById(`axis-color-${id}`);
    const zeroLineColorInput = document.getElementById(`zero-line-color-${id}`);
    const backdropColorInput = document.getElementById(`backdrop-color-${id}`);
    const focusedColorInput = document.getElementById(`focused-color-${id}`);
    const focusedEdgeColorInput = document.getElementById(`focused-edge-color-${id}`);
    
    if (bgColorInput) bgColorInput.value = plotColour(settings, 'bgColor');
    if (textColorInput) textColorInput.value = plotColour(settings, 'textColor');
    if (gridColorInput) gridColorInput.value = plotColour(settings, 'gridColor');
    if (axisColorInput) axisColorInput.value = plotColour(settings, 'axisColor');
    if (zeroLineColorInput) zeroLineColorInput.value = plotColour(settings, 'zeroLineColor');
    if (backdropColorInput) backdropColorInput.value = plotColour(settings, 'backdropColor');
    if (focusedColorInput) focusedColorInput.value = plotColour(settings, 'focusedColor');
    if (focusedEdgeColorInput) focusedEdgeColorInput.value = plotColour(settings, 'focusedEdgeColor');
    syncColourControls(id, settings);
}

/** The ids of each colour's Reset button, by settings key. */
const RESET_IDS = {
    gridColor: 'reset-grid-color', axisColor: 'reset-axis-color', zeroLineColor: 'reset-zero-line-color',
    notInTableColor: 'reset-not-in-table-color',
    focusedColor: 'reset-focused-color', focusedEdgeColor: 'reset-focused-edge-color'
};

/** Show which colours follow the app theme: a following colour's Reset has nothing to do (disabled, with the reason as its tooltip). */
export function syncColourControls(id, settings) {
    for (const key of THEMED_COLOURS) {
        const reset = RESET_IDS[key] && document.getElementById(`${RESET_IDS[key]}-${id}`);
        if (!reset) continue;
        const following = isFollowing(settings, key);
        reset.disabled = following;
        reset.title = following ? 'Following the app theme' : 'Follow the app theme again';
    }
}

/**
 * Apply theme colors to the plot
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
export function applyThemeColors(plotContainer, settings) {
    if (!plotContainer) return;
    
    // Apply theme to plot
    const is3D = settings.z !== null;
    const update = {
        'paper_bgcolor': plotColour(settings, 'bgColor'),
        'plot_bgcolor': plotColour(settings, 'bgColor'),
        'xaxis.gridcolor': plotColour(settings, 'gridColor'),
        'yaxis.gridcolor': plotColour(settings, 'gridColor'),
        'xaxis.color': plotColour(settings, 'axisColor'),
        'yaxis.color': plotColour(settings, 'axisColor'),
        'xaxis.linecolor': plotColour(settings, 'axisColor'), 
        'yaxis.linecolor': plotColour(settings, 'axisColor'),
        'xaxis.zerolinecolor': plotColour(settings, 'zeroLineColor'),
        'yaxis.zerolinecolor': plotColour(settings, 'zeroLineColor'),
        'xaxis.tickcolor': plotColour(settings, 'axisColor'),
        'yaxis.tickcolor': plotColour(settings, 'axisColor'),
        'modebar.color': modebarColours(settings).color,
        'modebar.activecolor': modebarColours(settings).activecolor
    };
    
    // For 3D plots
    if (is3D) {
        Object.assign(update, {
            'scene.bgcolor': plotColour(settings, 'bgColor'),
            'scene.xaxis.showbackground': settings.showBackdrop,
            'scene.yaxis.showbackground': settings.showBackdrop,
            'scene.zaxis.showbackground': settings.showBackdrop,
            'scene.xaxis.backgroundcolor': plotColour(settings, 'backdropColor'),
            'scene.yaxis.backgroundcolor': plotColour(settings, 'backdropColor'),
            'scene.zaxis.backgroundcolor': plotColour(settings, 'backdropColor'),
            'scene.xaxis.gridcolor': plotColour(settings, 'gridColor'),
            'scene.yaxis.gridcolor': plotColour(settings, 'gridColor'),
            'scene.zaxis.gridcolor': plotColour(settings, 'gridColor'),
            'scene.xaxis.color': plotColour(settings, 'axisColor'),
            'scene.yaxis.color': plotColour(settings, 'axisColor'),
            'scene.zaxis.color': plotColour(settings, 'axisColor'),
            'scene.xaxis.linecolor': plotColour(settings, 'axisColor'),
            'scene.yaxis.linecolor': plotColour(settings, 'axisColor'),
            'scene.zaxis.linecolor': plotColour(settings, 'axisColor'),
            'scene.xaxis.zerolinecolor': plotColour(settings, 'zeroLineColor'),
            'scene.yaxis.zerolinecolor': plotColour(settings, 'zeroLineColor'),
            'scene.zaxis.zerolinecolor': plotColour(settings, 'zeroLineColor'),
        });
    }
    
    Plotly.relayout(plotContainer, update);

    applyTextFont(plotContainer, settings);      // the text colour: axes, legend, colour bar
}

/**
 * Update font size in the plot
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateFontSize(plotContainer, settings) {
    applyTextFont(plotContainer, settings);
}

/**
 * Update plot margins
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
function updateMargins(plotContainer, settings) {
    if (!plotContainer) return;
    
    const update = {
        'margin': settings.margins
    };
    
    Plotly.relayout(plotContainer, update);
}

/**
 * Where the legend goes so it does not sit on the colour bar.
 *
 * Legend and colour bar share one position setting (right by default, x 1.05
 * vs 1.02), so a plot that shows both, e.g. a numeric colour with a table
 * filter ('Not in table' in grey plus the colour bar of the rest), drew the
 * legend entry on top of the colour bar's title. When both are visible the
 * legend moves to a single row above the plot instead.
 *
 * @param {Array} data - plotDiv.data
 * @param {Object} posConfig - getPositioningByLocation(...) for the setting
 * @returns {Object} relayout keys for the legend
 */
export function legendPlacement(data, posConfig, settings = {}) {
  const traces = Array.isArray(data) ? data : [];
  const colorbar = traces.some(t => t && t.marker && t.marker.colorscale && t.marker.showscale !== false);
  const legendItems = traces.some(t => t && t.showlegend !== false
    && !(typeof t.name === 'string' && t.name.includes('Focused'))
    && !(t.marker && t.marker.colorscale));
  if (colorbar && legendItems) {
    return { 'legend.orientation': 'h', 'legend.x': 0, 'legend.xanchor': 'left',
             'legend.y': 1.02, 'legend.yanchor': 'bottom' };
  }
  return {
    'legend.orientation': legendOrientation(posConfig.legendOrientation, settings),
    'meta.azLegendPosition': settings.legendPosition || 'right',
    ...legendTitleKeys(settings),
    'legend.x':           posConfig.legendX,
    'legend.y':           posConfig.legendY,
    'legend.xanchor':     posConfig.legendXanchor,
    'legend.yanchor':     posConfig.legendYanchor
  };
}

/**
 * Update legend & colorbar visibility
 * @param {HTMLElement} plotDiv  – Plotly graph div
 * @param {Object}      settings – Must include boolean settings.showLegend
 */
function updateLegendVisibility(plotDiv, settings) {
    if (!plotDiv || settings.showLegend === undefined) return;
    const show = settings.showLegend;

  
    // 2) Layout: any shared coloraxes (coloraxis, coloraxis2, etc.)
    let hasColoraxis = false;
    const layout = plotDiv.layout || {};
    Object.keys(layout)
      .filter(key => key.startsWith('coloraxis') && layout[key].showscale !== undefined)
      .forEach(ca => {
        Plotly.relayout(plotDiv, { [`${ca}.showscale`]: show });
        hasColoraxis = true;
      });
   
    // The legend, when there is one: which traces are entries is the
    // builders' to say (utils/legend-entries.js). Turning the legend on used
    // to give every trace without a colour scale an entry, the unnamed grey
    // trace of a plot coloured by nothing too, which read "trace 0".
    if (hasColoraxis) {
        Plotly.relayout(plotDiv, { showlegend: false, showscale: show });
    } else {
        Plotly.relayout(plotDiv, { showlegend: show && hasLegendEntries(plotDiv.data), showscale: false });
    }
    // 3) Per-trace colour bars: what differs from the trace as drawn, one restyle per attribute
    // (a restyle redraws the graph: one per trace took a second at 1M points with ~70 legend entries)
    const changes = new Map();     // attribute -> { idx: [], vals: [] }
    const want = (i, key, value, now) => {
        if ((now ?? false) === value) return;
        if (!changes.has(key)) changes.set(key, { idx: [], vals: [] });
        const c = changes.get(key);
        c.idx.push(i);
        c.vals.push(value);
    };
    plotDiv.data.forEach((trace, i) => {
        if (typeof trace.name === 'string' && (trace.name.includes('Focused'))) return;
        const hasMarkerCB = trace.marker && trace.marker.colorscale;
        const hasTraceCB  = ['heatmap','contour','surface'].includes(trace.type);
        const marker = trace.marker || {};

        if (hasMarkerCB) {
            // continuous scatter: hide from legend, toggle marker colorbar
            want(i, 'showlegend', false, trace.showlegend === undefined ? true : trace.showlegend);
            want(i, 'marker.showscale', show, marker.showscale);
        }
        else if (hasTraceCB) {
            // heatmap/contour/surface: hide from legend, toggle trace colorbar
            want(i, 'showlegend', false, trace.showlegend === undefined ? true : trace.showlegend);
            want(i, 'showscale', show, trace.showscale);
        }
        else {
            // categorical / other traces: no leftover colour bars
            if (trace.marker) want(i, 'marker.showscale', false, marker.showscale);
            if (trace.showscale !== undefined) want(i, 'showscale', false, trace.showscale);
        }
    });
    for (const [key, c] of changes) Plotly.restyle(plotDiv, { [key]: c.vals }, c.idx);

    // Legend entries next to a colour bar: keep them off it
    if (show) {
        Plotly.relayout(plotDiv, legendPlacement(plotDiv.data,
            getPositioningByLocation(settings.legendPosition || 'right'), settings));
    }
  }

/** Room, in px, between a bottom colour bar and the axes: the x-axis tick labels and title sit there. */
const BOTTOM_BAR_PAD = 70;

/**
 * Positioning configuration for legends and colorbars
 * Centralizes positioning logic for use across the application
 * @param {string} position - Position name: 'right', 'left', 'top', or 'bottom'
 * @returns {Object} - Positioning configuration object
 */
export function getPositioningByLocation(position) {
    const positioning = {
      right: {
        // Legend
        legendOrientation: 'v', legendX: 1.05, legendY: 0.5,
        legendXanchor: 'left', legendYanchor: 'middle',
        // Colorbar
        x: 1.02, xanchor: 'left', y: 0.5, yanchor: 'middle', ypad: 0, ticklabelposition: 'outside',
        orientation: 'v', titleside: 'right'
      },
      left: {
        legendOrientation: 'v', legendX: -0.05, legendY: 0.5,
        legendXanchor: 'right', legendYanchor: 'middle',
        x: -0.1, xanchor: 'right', y: 0.5, yanchor: 'middle', ypad: 0, ticklabelposition: 'outside',
        orientation: 'v', titleside: 'right'
      },
      top: {
        // above the axes, growing upwards: Plotly makes the top margin it needs. (A 15% paper offset with the
        // legend hanging down from it was less than the legend's own height in a short panel.)
        legendOrientation: 'h', legendX: 0.5, legendY: 1,
        legendXanchor: 'center', legendYanchor: 'bottom',
        // a horizontal bar lies wholly outside the axes: above them with its tick labels above it, or below
        // them (and their tick labels and title, hence ypad) with its tick labels below it
        x: 0.5, xanchor: 'center', y: 1, yanchor: 'bottom', ypad: 6, ticklabelposition: 'outside top',
        orientation: 'h', titleside: 'top'
      },
      bottom: {
        // below the axes' tick labels and title, hanging down: legend-below.js sets the offset in px, as a paper
        // fraction of the plot height, once the plot is drawn
        legendOrientation: 'h', legendX: 0.5, legendY: 0,
        legendXanchor: 'center', legendYanchor: 'top',
        x: 0.5, xanchor: 'center', y: 0, yanchor: 'top', ypad: BOTTOM_BAR_PAD, ticklabelposition: 'outside bottom',
        orientation: 'h', titleside: 'bottom'
      }
    };
    return positioning[position] || positioning.right;
  }
  
  /**
   * Update both legend and colorbar positions
   * @param {HTMLElement} plotContainer – the Plotly graph div
   * @param {Object} settings – must include settings.legendPosition
   */
  export function updateLegendPosition(plotContainer, settings) {
    if (!plotContainer) return;
    const posConfig = getPositioningByLocation(settings.legendPosition || 'right');
    // the colour bar has a position of its own (default: the legend's), a length and a tick count
    const barPos = getPositioningByLocation(colorbarPosition(settings));
    const barExtras = colorbarExtras(settings);
    const nticks = barExtras.nticks || 0;      // 0: Plotly's automatic
  
    // 1) Legend positioning (layout update), off the colour bar if both show
    Plotly.relayout(plotContainer, legendPlacement(plotContainer.data, posConfig, settings));
  

    // 2) Shared coloraxis: hide → update → show
    // ------------------------------------------------
    // hide any existing shared bar
    // update its geometry
    const coloraxisVisible = plotContainer.layout.coloraxis?.showscale ?? false;
    if (coloraxisVisible) {
        Plotly.relayout(plotContainer, {
        'coloraxis.colorbar.x':         barPos.x,
        'coloraxis.colorbar.y':         barPos.y,
        'coloraxis.colorbar.xanchor':   barPos.xanchor,
        'coloraxis.colorbar.yanchor':   barPos.yanchor,
        'coloraxis.colorbar.orientation': barPos.orientation,
        'coloraxis.colorbar.ypad':        barPos.ypad,
        'coloraxis.colorbar.ticklabelposition': barPos.ticklabelposition,
        'coloraxis.colorbar.title.side': barPos.titleside,
        'coloraxis.colorbar.len':         barExtras.len,
        'coloraxis.colorbar.lenmode':     barExtras.lenmode,
        'coloraxis.colorbar.nticks':      nticks,
        'coloraxis.showscale': coloraxisVisible
        });
    }
  
    // 3) Per‑trace bars: hide → update → show
    // ------------------------------------------------
    plotContainer.data.forEach((trace, i) => {
      if (typeof trace.name === 'string' && trace.name.includes('Focused')) return;
  
      // scatter traces with marker.colorbar
      const isScatter = trace.marker && Array.isArray(trace.marker.color) && trace.marker.colorscale;
      // heatmap/contour/surface traces
      const isHeat   = trace.type && ['heatmap','contour','surface'].includes(trace.type) && trace.colorbar;

      const currentVisible = isScatter ? (trace.marker.showscale ?? true) : (trace.showscale ?? true);
  
      if (isScatter) {
        // 3a) Hide old colorbar
        Plotly.restyle(plotContainer, { 'marker.showscale': false }, [i]);
        // 3b) Update position/orientation + re‑show
        Plotly.restyle(plotContainer, {
          'marker.colorbar.x':          barPos.x,
          'marker.colorbar.y':          barPos.y,
          'marker.colorbar.xanchor':    barPos.xanchor,
          'marker.colorbar.yanchor':    barPos.yanchor,
          'marker.colorbar.orientation': barPos.orientation,
          'marker.colorbar.ypad':        barPos.ypad,
          'marker.colorbar.ticklabelposition': barPos.ticklabelposition,
          'marker.colorbar.title.side':  barPos.titleside,
          'marker.colorbar.len':         barExtras.len,
          'marker.colorbar.lenmode':     barExtras.lenmode,
          'marker.colorbar.nticks':      nticks,
          'marker.showscale':           currentVisible
        }, [i]);
      }
      else if (isHeat) {
        Plotly.restyle(plotContainer, { showscale: false }, [i]);
        Plotly.restyle(plotContainer, {
          'colorbar.x':          barPos.x,
          'colorbar.y':          barPos.y,
          'colorbar.xanchor':    barPos.xanchor,
          'colorbar.yanchor':    barPos.yanchor,
          'colorbar.orientation': barPos.orientation,
          'colorbar.ypad':        barPos.ypad,
          'colorbar.ticklabelposition': barPos.ticklabelposition,
          'colorbar.title.side':  barPos.titleside,
          'colorbar.len':         barExtras.len,
          'colorbar.lenmode':     barExtras.lenmode,
          'colorbar.nticks':      nticks,
          showscale:             currentVisible
        }, [i]);
      }
    });
  }

// module‑scope flag
let _exportInProgress = false;

/**
 * Export the plot as an image
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {string} format            - 'svg', 'png', 'jpeg', 'webp'
 * @param {Object} settings          - may include exportWidth, exportHeight, scaleExport
 * @param {string} [how]             - 'full' (drawn again at the export's size) or 'shown' (as on screen)
 */
export async function exportPlot(plotContainer, format, settings, how = 'full') {
  if (!plotContainer) return;
  if (_exportInProgress) {
    console.warn('Export already in progress – please wait.');
    return;
  }
  const panelId = getPanelId(plotContainer);
  const downloadButton = document.getElementById(how === 'shown' ? `download-shown-${format}-${panelId}` : `download-${format}-${panelId}`);
  const opts = exportOptions(settings);
  if (format === 'svg') opts.scale = 1;      // vector: no pixels to sharpen, and the size stays as set
  const filename = 'plot_' + new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

  // checked again at the click: the panels open may have changed since the menu was drawn
  const check = how === 'full' ? exportCheck(plotContainer, opts) : null;
  if (check && check.verdict === 'block') {
    refuseInStatus(plotContainer, 'exported', check);
    return;
  }
  _exportInProgress = true;
  const done = markBusy(downloadButton, 'Preparing image\u2026');
  try {
    await guarded(check, { panel: panelId, action: 'export', format }, () =>
      exportImage(plotContainer, how, { format, ...opts, filename }));
    setStatusTag(plotContainer, 'export', null);
  } catch (err) {
    console.error('Error exporting plot:', err);
    failInStatus(plotContainer, 'Export failed', 'The image could not be made; try again, or at a smaller size.');
  } finally {
    _exportInProgress = false;
    done();
  }
}

/**
 * An export or copy the memory check refused: the panel's status strip says so,
 * with the advice and (for an export) "Export as shown", as for the modebar camera.
 * @param {HTMLElement} gd - the plot
 * @param {'exported'|'copied'} verb
 * @param {Object} check - exportCheck's answer, with verdict 'block'
 */
function refuseInStatus(gd, verb, check) {
  const why = refusalText(check, EXPORT_ADVICE);
  setStatusTag(gd, 'memory', { text: `Not ${verb}: ${bindingLabel(check.binding)}`, severity: 'warning', title: why,
    pop: { text: why, actions: verb === 'exported' && canSnapshot(gd) ? [['export-shown', 'Export as shown']] : [] } });
  nudgeStatusTag(gd, 'memory');
}

/**
 * An export or copy that failed: a tag in the panel's status strip that stays
 * until the next export succeeds, not a message that vanishes in seconds.
 * @param {HTMLElement} gd - the plot
 * @param {string} text - the tag
 * @param {string} why - the sentence under it
 */
function failInStatus(gd, text, why) {
  setStatusTag(gd, 'export', { text, severity: 'error', title: why, pop: { text: why } });
  nudgeStatusTag(gd, 'export');
}

/**
 * Show on a button that its action is running (its label, and aria-busy for
 * assistive technology); the returned function puts the button back.
 * @param {HTMLElement|null} button
 * @param {string} label
 * @returns {Function}
 */
function markBusy(button, label) {
  if (!button) return () => {};
  const before = button.innerHTML;
  button.setAttribute('aria-busy', 'true');
  button.textContent = label;
  return () => { button.removeAttribute('aria-busy'); button.innerHTML = before; };
}

/** Say "Copied" on a button for a moment, then put its label back. */
function flashLabel(button, text, ms = 2000) {
  if (!button) return;
  const before = button.innerHTML;
  button.textContent = text;
  setTimeout(() => { button.innerHTML = before; }, ms);
}

/**
 * The modebar camera: a full-resolution PNG when it fits; otherwise the
 * status strip says why, with "Export as shown" (a click, never a reroute).
 */
registerCameraExport(async (gd, opts) => {
  // the panel's own export size and scale (Plot Options), else the toolbar's
  const o = typeof gd.__exportOptions === 'function' ? gd.__exportOptions()
    : { width: opts.width || 1200, height: opts.height || 800, scale: opts.scale || 1 };
  const check = exportCheck(gd, o);
  if (check.verdict === 'block') {
    refuseInStatus(gd, 'exported', check);
    return;
  }
  await guarded(check, { panel: getPanelId(gd), action: 'export', format: 'png' }, () =>
    exportImage(gd, 'full', { format: opts.format || 'png', ...o, filename: opts.filename || 'annzarro_plot' }));
});

/**
 * Copy the Plotly plot to clipboard as a PNG image: one image, drawn once
 * (full resolution when it fits in memory, else not copied).
 * @param {HTMLElement} plotContainer – Plotly graph div
 * @param {Object} settings – May include exportWidth, exportHeight
 */
export async function copyPlotToClipboard(plotContainer, settings) {
    if (!plotContainer) return;
    const opts = { ...exportOptions(settings), scale: 1 };
    const copyBtn = document.getElementById(`copy-to-clipboard-${getPanelId(plotContainer)}`);
    const check = exportCheck(plotContainer, opts);
    if (check.verdict === 'block') {
      refuseInStatus(plotContainer, 'copied', check);
      return;
    }
    try {
      const dataUrl = await guarded(check, { panel: getPanelId(plotContainer), action: 'export', format: 'png' },
        () => exportWithCoverage(plotContainer, () => fullImage(plotContainer, { format: 'png', ...opts })));
      const blob = await fetch(dataUrl).then(res => res.blob());
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('Clipboard API not supported');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setStatusTag(plotContainer, 'export', null);
      flashLabel(copyBtn, 'Copied');
    } catch (err) {
      console.error('Copy to clipboard failed:', err);
      failInStatus(plotContainer, 'Not copied',
        navigator.clipboard && window.ClipboardItem
          ? 'The image could not be copied; use Download instead.'
          : 'The browser copies images only on https or localhost; use Download instead.');
    }
  }

/**
 * Apply all aesthetic settings to a plot
 * @param {HTMLElement} plotContainer - Plot container element
 * @param {Object} settings - Plot settings object
 */
export function applyAllAestheticSettings(plotContainer, settings) {
    if (!plotContainer) return;
    
    // Ensure settings are initialized
    initializeAestheticsSettings(settings);
    
    // Apply all settings at once with a single relayout call
    const is3D = settings.z !== null;
    
    // The colours on screen: the ones the user set, the app theme's for the rest
    const gridColor = plotColour(settings, 'gridColor');
    const textColor = plotColour(settings, 'textColor');
    const axisColor = plotColour(settings, 'axisColor');
    const zeroLineColor = plotColour(settings, 'zeroLineColor');
    const bgColor = plotColour(settings, 'bgColor');
    
    // First, update the basic layout (without legend/colorbar details)
    const update = {
        // Basic layout
        'margin': settings.margins,
        'paper_bgcolor': bgColor,
        'plot_bgcolor': bgColor,
        'hovermode': settings.showHoverInfo ? 'closest' : false,
        
        // Legend position settings (actual visibility will be handled separately)
        'legend.orientation': legendOrientation((settings.legendPosition === 'left' || settings.legendPosition === 'right') ? 'v' : 'h', settings),
        'legend.x': settings.legendPosition === 'right' ? 1.05 : settings.legendPosition === 'left' ? -0.05 : 0.5,
        'legend.y': settings.legendPosition === 'top' ? 1 : settings.legendPosition === 'bottom' ? 0 : 0.5,
        'legend.xanchor': settings.legendPosition === 'right' ? 'left' : settings.legendPosition === 'left' ? 'right' : 'center',
        'legend.yanchor': settings.legendPosition === 'top' ? 'bottom' : settings.legendPosition === 'bottom' ? 'top' : 'middle',
        
        // Interaction
        'xaxis.fixedrange': !settings.enableZoom,
        'yaxis.fixedrange': !settings.enableZoom,
        
        // Set legend visibility (global setting), when there is a legend entry
        'showlegend': settings.showLegend !== false && hasLegendEntries(plotContainer.data),
        
        // 2D axes
        'xaxis.showgrid': settings.showGrid,
        'yaxis.showgrid': settings.showGrid,
        'xaxis.gridcolor': gridColor,
        'yaxis.gridcolor': gridColor,
        'xaxis.gridwidth': settings.gridLineWidth || 1,
        'yaxis.gridwidth': settings.gridLineWidth || 1,
        'xaxis.showline': settings.showAxisLines !== false,
        'yaxis.showline': settings.showAxisLines !== false,
        'xaxis.linecolor': axisColor,
        'yaxis.linecolor': axisColor,
        'xaxis.linewidth': settings.axisLineWidth || 1,
        'yaxis.linewidth': settings.axisLineWidth || 1,
        'xaxis.zeroline': settings.showZeroLines,
        'yaxis.zeroline': settings.showZeroLines,
        'xaxis.zerolinecolor': zeroLineColor,
        'yaxis.zerolinecolor': zeroLineColor,
        'xaxis.zerolinewidth': settings.zeroLineWidth || 1,
        'yaxis.zerolinewidth': settings.zeroLineWidth || 1,
        'xaxis.tickcolor': axisColor,
        'yaxis.tickcolor': axisColor,
        'xaxis.color': axisColor,
        'yaxis.color': axisColor,
        'xaxis.title.text': settings.showAxisTitles ? axisTitle(settings, 'x') : '',
        'yaxis.title.text': settings.showAxisTitles ? axisTitle(settings, 'y') : '',
        
    };
    
    // For 3D plots
    if (is3D) {
        const backdropColor = plotColour(settings, 'backdropColor');
        Object.assign(update, {
            'scene.bgcolor': bgColor,
            'scene.xaxis.showbackground': settings.showBackdrop,
            'scene.yaxis.showbackground': settings.showBackdrop,
            'scene.zaxis.showbackground': settings.showBackdrop,
            'scene.xaxis.backgroundcolor': backdropColor,
            'scene.yaxis.backgroundcolor': backdropColor,
            'scene.zaxis.backgroundcolor': backdropColor,
            'scene.xaxis.gridcolor': gridColor,
            'scene.yaxis.gridcolor': gridColor,
            'scene.zaxis.gridcolor': gridColor,
            'scene.xaxis.gridwidth': settings.gridLineWidth || 1,
            'scene.yaxis.gridwidth': settings.gridLineWidth || 1,
            'scene.zaxis.gridwidth': settings.gridLineWidth || 1,
            'scene.xaxis.showgrid': settings.showGrid,
            'scene.yaxis.showgrid': settings.showGrid,
            'scene.zaxis.showgrid': settings.showGrid,
            'scene.xaxis.showline': settings.showAxisLines !== false,
            'scene.yaxis.showline': settings.showAxisLines !== false,
            'scene.zaxis.showline': settings.showAxisLines !== false,
            'scene.xaxis.linecolor': axisColor,
            'scene.yaxis.linecolor': axisColor,
            'scene.zaxis.linecolor': axisColor,
            'scene.xaxis.linewidth': settings.axisLineWidth || 1,
            'scene.yaxis.linewidth': settings.axisLineWidth || 1,
            'scene.zaxis.linewidth': settings.axisLineWidth || 1,
            'scene.xaxis.zeroline': settings.showZeroLines,
            'scene.yaxis.zeroline': settings.showZeroLines,
            'scene.zaxis.zeroline': settings.showZeroLines,
            'scene.xaxis.zerolinecolor': zeroLineColor,
            'scene.yaxis.zerolinecolor': zeroLineColor,
            'scene.zaxis.zerolinecolor': zeroLineColor,
            'scene.xaxis.zerolinewidth': settings.zeroLineWidth || 1,
            'scene.yaxis.zerolinewidth': settings.zeroLineWidth || 1,
            'scene.zaxis.zerolinewidth': settings.zeroLineWidth || 1,
            'scene.xaxis.tickcolor': axisColor,
            'scene.yaxis.tickcolor': axisColor,
            'scene.zaxis.tickcolor': axisColor,
            'scene.xaxis.color': axisColor,
            'scene.yaxis.color': axisColor,
            'scene.zaxis.color': axisColor,
            'scene.xaxis.title.text': settings.showAxisTitles ? axisTitle(settings, 'x') : '',
            'scene.yaxis.title.text': settings.showAxisTitles ? axisTitle(settings, 'y') : '',
            'scene.zaxis.title.text': settings.showAxisTitles ? axisTitle(settings, 'z') : '',
            
        });
        
        // 3D interaction settings
        if (!settings.enableZoom && !settings.enablePan) {
            update['scene.camera'] = {
                up: { x: 0, y: 0, z: 1 },
                center: { x: 0, y: 0, z: 0 },
                eye: { x: 1.25, y: 1.25, z: 1.25 }
            };
        }
    }
    
    // Ticks: labels, marks and count
    Object.assign(update, tickKeys(settings, axisPaths(settings)));
    
    // Apply the basic layout first
    Plotly.relayout(plotContainer, update);
    
    // Then handle legend and colorbar visibility specifically based on trace type
    updateLegendVisibility(plotContainer, settings);
    updateLegendPosition(plotContainer, settings);
    applyTextFont(plotContainer, settings);
    applyLegendOptions(plotContainer, settings);
    refreshScaleBar(plotContainer, settings);
}