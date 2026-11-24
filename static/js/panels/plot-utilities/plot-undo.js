/**
 * Undo for the Cell Plot and the Gene Plot (WP-5b; operator, 2026-11-23: the same Undo as the new panels, in the
 * toolbar's Undo slot), on the shared helper ui/panel-undo.js.
 *
 * A step is the plot's stored config before a change the user made: axes, colour, Color by, filters, the point size,
 * Plot Options, 3D. The zoom and the 3D camera (`viewport2D`, `viewport3D`), Toggle Controls and an automatic point
 * size or opacity (they follow the zoom) are not steps and are left out of what is compared. Undo re-applies the
 * config before the step through the path Back and Forward take (PanelManager.replacePanel), keeping the zoom and the
 * controls as they are now; what it draws is what that config draws (test_render_drift.py).
 *
 * The steps outlive the panel object: replacePanel makes a new one, so they are kept per panel id here. A config that
 * arrives from outside (a link, Back and Forward, a panel set) rebuilds the panel the same way, outside an undo, and the
 * new panel starts the steps again (`rebase`).
 *
 * The panel calls `attachPlotUndo` once it is built; the helper watches the panel's controls, its Plot Options pop-over
 * and the menu's `plotSettingsChanged` events, and records a step after each (one per kind within 1.5 s).
 */
import { createPanelUndo, labelByKeys } from '../../ui/panel-undo.js';

/** Keys of a plot's config that are a view, not a change of what it draws. */
const TRANSIENT = Object.freeze(['controlsVisible', 'viewport2D', 'viewport3D', '_closed', 'active']);

/**
 * The words of a step: the first changed key in this order (a toggle that also moves an axis, Equal aspect, is named
 * for itself, not for the axis it moved).
 */
const NAMES = Object.freeze({
    equalAspect: 'equal aspect', z: '3D', tableFilter: 'table filter', subsettedCells: 'subset',
    x: 'x axis', y: 'y axis', z: '3D', color: 'colour', colorScale: 'colour map', colorReversed: 'reverse colours',
    colorMin: 'colour minimum', colorMax: 'colour maximum', lockColorRange: 'lock colour range', logColor: 'log colour',
    categoryPalette: 'palette', hideNan: 'hide NaN', tableFilter: 'table filter', pointSize: 'point size',
    autoPointSize: 'point size', pointOpacity: 'opacity', autoPointOpacity: 'opacity', equalAspect: 'equal aspect',
    hoverInfo: 'hover', title: 'title'
});

/** The label of a change: the first key of NAMES that differs, else the helper's own. */
function stepLabel(before, after) {
    const differs = (k) => JSON.stringify((before || {})[k]) !== JSON.stringify((after || {})[k]);
    const key = Object.keys(NAMES).find(differs);
    return key ? NAMES[key] : labelByKeys(before, after, NAMES);
}

const _undos = new Map();

function panelOf(id) {
    const pm = typeof window !== 'undefined' ? window.PanelManager : null;
    return pm && typeof pm.getPanel === 'function' ? pm.getPanel(id) : null;
}

/** The plot's config as a step compares it: plain, without the view and the automatic point style. */
export function storedConfig(config) {
    const c = JSON.parse(JSON.stringify(config || {}));
    for (const k of TRANSIENT) delete c[k];
    if (c.autoPointSize) delete c.pointSize;
    if (c.autoPointOpacity) delete c.pointOpacity;
    return c;
}

/** The steps of panel `id` (made the first time). */
function undoOf(id) {
    if (!_undos.has(id)) {
        _undos.set(id, createPanelUndo({
            snapshot: () => { const p = panelOf(id); return p ? storedConfig(p.getConfig()) : {}; },
            restore: async (config) => {
                const pm = window.PanelManager;
                const p = panelOf(id);
                if (!pm || !p) return;
                const now = p.getConfig();
                const next = { ...config };
                for (const k of TRANSIENT) if (k in now) next[k] = now[k];      // the zoom and the controls stay
                await pm.replacePanel(id, next);
            },
            label: stepLabel
        }));
    }
    return _undos.get(id);
}

/**
 * Put Undo in the panel's toolbar and watch for the user's changes. Called by the panel each time it is built.
 * @param {string} id - the panel id
 * @param {HTMLElement} root - the panel's element (its controls and toolbar inside)
 * @returns {{undo: Object, destroy: Function}}
 */
export function attachPlotUndo(id, root) {
    const undo = undoOf(id);
    // built by an undo: the steps go on; built any other way (made, a link, Back and Forward): they start here
    if (!undo.restoring) undo.rebase();
    const bar = root && root.querySelector('.az-plot-toolbar');
    const button = undo.button();
    button.classList.add('plot-undo');
    button.id = `plot-undo-${id}`;
    if (bar && bar.__azToolbar) bar.__azToolbar.add({ undo: button });

    // a change shows in the config at once or after its handler's first await: look now and once more a moment later
    let timer = null;
    const look = () => {
        undo.observe();
        clearTimeout(timer);
        timer = setTimeout(() => undo.observe(), 600);
    };
    const later = () => setTimeout(look, 0);
    const inOwnPopover = (t) => {
        const anchor = document.getElementById(`aesthetics-menu-btn-${id}`);
        const pop = t && t.closest ? t.closest('[data-popover="plot-options"]') : null;
        return !!(pop && anchor && anchor.getAttribute('aria-controls') === pop.id);
    };
    // the user's own events only: the panel sets its selects and fires their events itself while it builds
    const onPanel = (e) => { if (e.isTrusted && !button.contains(e.target)) later(); };
    const onDoc = (e) => { if (e.isTrusted && inOwnPopover(e.target)) later(); };
    const onSettings = (e) => { if (e.detail && e.detail.id === id) later(); };
    for (const type of ['change', 'click']) root.addEventListener(type, onPanel, true);
    for (const type of ['change', 'click']) document.addEventListener(type, onDoc, true);
    document.addEventListener('plotSettingsChanged', onSettings);
    // Ctrl/Cmd+Z in the panel, outside a box being typed in
    const onKey = (e) => {
        const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing && undo.canUndo) {
            e.preventDefault();
            undo.undo();
        }
    };
    root.addEventListener('keydown', onKey);
    return {
        undo,
        /** The panel is built and drawn from its config: what it set by itself meanwhile is the start, not a step. */
        settled() { if (!undo.restoring) undo.rebase(); },
        destroy() {
            clearTimeout(timer);
            for (const type of ['change', 'click']) root.removeEventListener(type, onPanel, true);
            for (const type of ['change', 'click']) document.removeEventListener(type, onDoc, true);
            document.removeEventListener('plotSettingsChanged', onSettings);
            root.removeEventListener('keydown', onKey);
        }
    };
}
