/**
 * panel-surface -- the ONLY place a panel is allowed to paint.
 *
 * Every plot, every table and every empty state goes through one of the three
 * functions here, and each of them takes a `Coverage` (see
 * `static/js/utils/coverage.js`). That is what makes "say what is missing and
 * why" structural rather than a convention someone remembers to follow:
 *
 *   - `drawPlot()`      draws (Plotly.react: into the graph already there, else a
 *                       new one) and states the coverage in the status strip
 *                       under it;
 *   - `drawPlaceholder()` replaces the old `innerHTML = '<div class="alert">'`
 *                       empty states, which said "Insufficient data" and never
 *                       said why;
 *   - `renderCoverageNotice()` states it under a table, or any container.
 *
 * ## One strip per panel
 *
 * Everything a panel does not show, and why, is in ONE place: its status
 * strip, a fixed-height line under the plot ("28 of 200 cells shown · 150 not
 * in part 2 of 4 · 21 table filter") that opens on click into every reason,
 * with counts that add up and the action that undoes each. A mode that limits
 * the panel (large-plot mode) is a tag in the same strip (`setStatusTag`).
 * A plot's strip is always there, so the plot never moves when it changes.
 *
 * ## The default is loud
 *
 * A caller that passes no coverage gets `Coverage.unreported()`, which renders
 * a visible magenta "this panel does not report what it is missing" strip --
 * on screen AND in the exported image. A contributor who adds a render path and
 * forgets to describe its gaps therefore sees a defect immediately instead of
 * shipping a clean plot that lies by omission. There is no code path through
 * this module that draws silently.
 *
 * `annzarro/tests/static/test_no_silent_gap.py` keeps `Plotly.newPlot` and the
 * alert-innerHTML idiom from reappearing outside this module, so the chokepoint
 * cannot be routed around without the guard going red.
 */

import { Coverage, GAP, breakdown, compactCount, exactCount } from './coverage.js';
import { keepTitlesFitted } from './plot-titles.js';
import { releasePlot } from './release-plot.js';
import { forget } from './memory-guard-ui.js';
import { withShownCamera } from './scene-camera.js';

/** Class of the status strip; styled in static/css/styles.css. */
const STRIP_CLASS = 'plot-status';

/** Annotation colours, matched to the CSS severity palette. */
const ANNOTATION_COLOR = Object.freeze({
    notice: '#31708f',
    warning: '#8a6d3b',
    error: '#a94442',
    unreported: '#8b1d8b'
});

/** How many reason lines the exported caption carries before eliding. */
const MAX_ANNOTATION_LINES = 3;

/** Reason chips the strip shows before "details"; the rest are in the popover. */
const MAX_CHIPS = 3;

/** What undoes each kind of hidden point: [action, label]. See registerStatusActions. */
const KIND_ACTIONS = Object.freeze({
    outside: [['next-part', 'Next part'], ['subset', 'Subset…']],
    table: [['stop-table', 'Stop filtering']],
    nan: [['show-nan', 'Show NaN']],
    outliers: [['show-outliers', 'Show outliers']]
});

function coerce(coverage, unit) {
    // The load-bearing line of this module: no coverage means "nobody said",
    // and "nobody said" is displayed, never treated as "nothing to say".
    return (coverage instanceof Coverage) ? coverage : Coverage.unreported(unit || 'values');
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The strip lives AFTER `host`, as its next sibling: for a plot the host is
 * the Plotly target itself (whose children Plotly owns and wipes), so the
 * strip survives every re-render.
 */
function stripAnchor(host) {
    return (host && host.parentNode) ? host : null;
}

function stripKey(anchor) {
    return `${STRIP_CLASS}-for-${(anchor && anchor.id) || 'panel'}`;
}

/**
 * Find this panel's strip among its parent's children.
 *
 * A direct scan rather than `querySelector(':scope > ...')`: `:scope` is not
 * available in every browser this tool is opened in, and a selector that
 * silently matches nothing would leave strips stacking on every re-render
 * -- a silent failure inside the mechanism built to end silent failures.
 */
function findStrip(anchor) {
    const parent = anchor && anchor.parentNode;
    if (!parent || !parent.children) return null;
    const key = stripKey(anchor);
    for (const child of Array.from(parent.children)) {
        if (child.dataset && child.dataset.coverageFor === key) return child;
    }
    return null;
}

/** What each host's strip states: {coverage, unit, persistent, tags, open}. */
const _state = new WeakMap();

function stateOf(host) {
    let s = _state.get(host);
    if (!s) {
        s = { coverage: null, unit: 'values', persistent: false, tags: new Map(), open: null };
        _state.set(host, s);
    }
    return s;
}

/** Undo actions, supplied by the app (main.js); see registerStatusActions. */
let _actions = { available: () => false, run: () => {} };

/**
 * Let the app run the strip's undo actions: `available(action, host)` says
 * whether to offer one ('next-part', 'subset', 'subset-regular', 'stop-table',
 * 'show-nan', 'show-outliers', 'focus-part'), `run(action, host)` does it.
 * @param {{available: Function, run: Function}} actions
 */
export function registerStatusActions(actions) {
    _actions = actions;
    for (const strip of (typeof document !== 'undefined' && document.querySelectorAll
        ? document.querySelectorAll(`.${STRIP_CLASS}`) : [])) {
        if (strip._host) paint(strip._host);
    }
}

function actionButtons(list, host) {
    return (list || [])
        .filter(([action]) => _actions.available(action, host))
        .map(([action, label]) => `<button type="button" class="ps-action" data-ps-action="${escapeHtml(action)}">${escapeHtml(label)}</button>`)
        .join('');
}

function stripHtml(host, s) {
    const cov = coerce(s.coverage, s.unit);
    const b = breakdown(cov);
    const unitWord = escapeHtml(b.unit);
    const headline = escapeHtml(b.headline).replace(` ${unitWord} shown`, ` <span class="ps-unit">${unitWord} </span>shown`);
    const chips = [
        ...b.rows.map(r => `${compactCount(r.count)} ${r.chip}`),
        ...b.notes.map(n => n.label.split(' -- ')[0])
    ];
    const chipHtml = chips.slice(0, MAX_CHIPS)
        .map(c => `<span class="ps-chip">${escapeHtml(c)}</span>`).join('');
    const rows = b.rows.map(r =>
        `<tr data-kind="${escapeHtml(r.kind)}"><td class="ps-why">${escapeHtml(r.label)}</td>`
        + `<td class="ps-n">${exactCount(r.count)}</td>`
        + `<td class="ps-do">${actionButtons(KIND_ACTIONS[r.kind], host)}</td></tr>`).join('');
    const total = b.rows.length
        ? `<tr class="ps-total"><td>Not shown</td><td class="ps-n">${exactCount(b.hidden)}</td><td></td></tr>` : '';
    const notes = b.notes.length
        ? `<ul class="ps-notes">${b.notes.map(n => `<li data-reason="${escapeHtml(n.reason)}">${escapeHtml(n.label)}</li>`).join('')}</ul>` : '';
    const title = b.hidden
        ? `Why ${exactCount(b.hidden)} of ${exactCount(b.total)} ${b.unit} are not shown`
        : b.headlineExact;
    const hasDetail = b.rows.length || b.notes.length;
    const mainPop = hasDetail
        ? `<div class="ps-pop" data-pop="main" role="dialog" aria-label="${escapeHtml(title)}"${s.open === 'main' ? '' : ' hidden'}>`
            + `<div class="ps-pop-title">${escapeHtml(title)}</div>`
            + (rows ? `<table class="ps-rows">${rows}${total}</table>` : '')
            + notes
            + (b.rows.length > 1 ? '<div class="ps-foot">Each cell is counted once, under the first reason that applies.</div>' : '')
            + '</div>'
        : '';
    let tags = '';
    let tagPops = '';
    for (const [kind, tag] of s.tags) {
        const sev = escapeHtml(tag.severity || 'notice');
        tags += `<button type="button" class="ps-tag ps-tag--${sev}" data-tag="${escapeHtml(kind)}"`
            + ` aria-expanded="${s.open === kind}" title="${escapeHtml(tag.title || tag.text)}">${escapeHtml(tag.text)}</button>`;
        if (tag.pop) {
            tagPops += `<div class="ps-pop ps-pop--tag" data-pop="${escapeHtml(kind)}" role="dialog"`
                + ` aria-label="${escapeHtml(tag.text)}"${s.open === kind ? '' : ' hidden'}>`
                + `<div class="ps-pop-text">${escapeHtml(tag.pop.text)}</div>`
                + `<div class="ps-pop-do">${actionButtons(tag.pop.actions, host)}</div></div>`;
        }
    }
    return `<button type="button" class="ps-summary" aria-haspopup="dialog" aria-expanded="${s.open === 'main'}"`
        + `${hasDetail ? '' : ' disabled'}>`
        + `<span class="ps-text"><b class="ps-headline">${headline}</b>`
        + `<span class="ps-chips">${chipHtml}</span></span>`
        + (hasDetail ? '<span class="ps-details">details</span>' : '')
        + '</button>'
        + `<span class="ps-tags">${tags}</span>`
        + mainPop + tagPops;
}

/** Draw (or remove) the strip of `host` from its state. */
function paint(host) {
    const anchor = stripAnchor(host);
    if (!anchor) return null;
    const s = stateOf(host);
    let el = findStrip(anchor);
    const cov = coerce(s.coverage, s.unit);
    if (!s.coverage && !s.persistent) {
        if (el) el.remove();
        return null;
    }
    if (!s.persistent && cov.isComplete && s.tags.size === 0) {
        if (el) el.remove();
        return null;
    }
    if (!el) {
        el = document.createElement('div');
        el.dataset.coverageFor = stripKey(anchor);
        // the strip element stays for the panel's life, so a screen reader
        // hears its changes (a live region that is replaced is not heard)
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        const parent = anchor.parentNode;
        const after = parent.children[Array.from(parent.children).indexOf(anchor) + 1] || null;
        parent.insertBefore(el, after);
    }
    el._host = host;
    const severity = cov.isComplete ? 'ok' : cov.severity;
    el.className = `${STRIP_CLASS} ${STRIP_CLASS}--${severity}`;
    el.dataset.reason = cov.isComplete ? 'ok' : cov.worstReason;
    // compared with what was written, not with innerHTML, which the browser
    // normalises
    const html = stripHtml(host, s);
    if (el._html !== html) {
        el.innerHTML = html;
        el._html = html;
    }
    // the whole statement as text, one reason per line (for tests, logs and
    // copy); not a title: nothing about the strip pops up on hover
    el.setAttribute('data-summary', [cov.headline(), ...cov.lines()].filter(Boolean).join('\n'));
    return el;
}

/**
 * State the coverage of `host` in its status strip: one line under the plot
 * (or table) that says how many entities are shown, the main reasons for the
 * rest, and, on click, every reason with its count and what undoes it.
 *
 * Idempotent: repeated calls update the same element rather than stacking.
 * A persistent strip (a plot's) is always there, so its plot never moves when
 * the text changes; another (a table's) is removed when nothing is missing.
 *
 * @param {HTMLElement} host  The plot or table container.
 * @param {Coverage} coverage
 * @param {string} [unit]  Fallback unit when coverage is absent.
 * @param {{persistent?: boolean}} [opts]
 * @returns {HTMLElement|null} The strip, or null when there is none.
 */
export function renderCoverageNotice(host, coverage, unit, { persistent } = {}) {
    if (!stripAnchor(host)) return null;
    const s = stateOf(host);
    s.coverage = coerce(coverage, unit);
    s.unit = unit || s.coverage.unit;
    if (persistent !== undefined) s.persistent = persistent;
    return paint(host);
}

/**
 * Put (or with `tag` null take away) a tag at the right of the strip: a
 * state of the panel that changes what the user can do with it, e.g.
 * large-plot mode with hover and click off. A tag with `pop` opens a popover
 * when clicked, with `pop.text` and `pop.actions` ([action, label] pairs).
 *
 * @param {HTMLElement} host
 * @param {string} kind  e.g. 'large', 'focus', 'refused'
 * @param {{text: string, title?: string, severity?: string,
 *   pop?: {text: string, actions?: Array}}|null} tag
 */
export function setStatusTag(host, kind, tag) {
    if (!stripAnchor(host)) return null;
    const s = stateOf(host);
    const before = s.tags.get(kind);
    if (!tag && !before) return findStrip(stripAnchor(host));
    if (tag && before && JSON.stringify(tag) === JSON.stringify(before)) return findStrip(stripAnchor(host));
    if (tag) s.tags.set(kind, tag); else s.tags.delete(kind);
    if (!tag && s.open === kind) s.open = null;
    return paint(host);
}

/** Tag popovers already opened by a nudge, `${panel}:${kind}`: once per session. */
const _nudged = new Set();

/**
 * The user tried something a tag says is off (a click on a large plot):
 * pulse the tag, and the first time per panel in this session also open its
 * popover. Never a toast, and never a popover on its own after the first.
 * @param {HTMLElement} host
 * @param {string} kind
 * @returns {boolean} whether the popover was opened
 */
export function nudgeStatusTag(host, kind) {
    const anchor = stripAnchor(host);
    const strip = anchor && findStrip(anchor);
    const s = _state.get(host);
    if (!strip || !s || !s.tags.has(kind)) return false;
    strip.dataset.pulses = String(Number(strip.dataset.pulses || 0) + 1);
    const tag = strip.querySelector && strip.querySelector(`.ps-tag[data-tag="${kind}"]`);
    if (tag) {
        tag.classList.remove('ps-tag--pulse');
        void tag.offsetWidth;       // restart the animation
        tag.classList.add('ps-tag--pulse');
        setTimeout(() => tag.classList.remove('ps-tag--pulse'), 700);
    }
    const key = `${anchor.id || 'panel'}:${kind}`;
    if (_nudged.has(key) || !s.tags.get(kind).pop) return false;
    _nudged.add(key);
    s.open = kind;
    paint(host);
    return true;
}

function setOpen(host, which) {
    const s = _state.get(host);
    if (!s || s.open === which) return;
    s.open = which;
    paint(host);
}

function closeAll(except = null) {
    for (const strip of document.querySelectorAll(`.${STRIP_CLASS}`)) {
        if (strip !== except && strip._host) setOpen(strip._host, null);
    }
}

/** One delegated listener for every strip: open, close, run an action. */
function wireStrips() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function'
        || document.__plotStatusWired) return;
    document.__plotStatusWired = true;
    // A press outside a strip closes its popovers: a press, not a click, so
    // the click a nudge opens a popover with (nudgeStatusTag) keeps it open
    document.addEventListener('pointerdown', (e) => {
        const strip = e.target.closest && e.target.closest(`.${STRIP_CLASS}`);
        closeAll(strip && strip._host ? strip : null);
    }, true);
    document.addEventListener('click', (e) => {
        // an action offered by a placeholder (drawPlaceholder's actions)
        const placeholder = e.target.closest && e.target.closest('.coverage-placeholder');
        const placed = placeholder && e.target.closest('[data-ps-action]');
        if (placed && placeholder.parentNode) {
            _actions.run(placed.dataset.psAction, placeholder.parentNode);
            return;
        }
        const strip = e.target.closest && e.target.closest(`.${STRIP_CLASS}`);
        if (!strip || !strip._host) return;
        const host = strip._host;
        const s = stateOf(host);
        const action = e.target.closest('[data-ps-action]');
        if (action) {
            setOpen(host, null);
            _actions.run(action.dataset.psAction, host);
            return;
        }
        const tag = e.target.closest('.ps-tag');
        if (tag) { setOpen(host, s.open === tag.dataset.tag ? null : tag.dataset.tag); return; }
        if (e.target.closest('.ps-summary')) setOpen(host, s.open === 'main' ? null : 'main');
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAll();
    });
}
wireStrips();

/**
 * The stops ([[t, colour], ...]) Plotly draws for a colour scale given by name
 * ('Portland') or as stops. Plotly resolves names only while it draws, so this
 * draws a one-point plot off screen and reads them back. That plot is not a
 * panel and states no Coverage, which is why it lives here and not beside its
 * caller (large-plot.js, which colours its traces with these stops).
 * @param {string|Array} scale
 * @returns {Promise<Array>}
 */
export async function resolveColorscale(scale) {
    const div = document.createElement('div');
    div.style.cssText = 'position:absolute;left:-9999px;width:40px;height:40px';
    document.body.appendChild(div);
    try {
        await Plotly.newPlot(div, [{ type: 'scatter', x: [0], y: [0], marker: { color: [0], colorscale: scale } }],
            { width: 40, height: 40 }, { staticPlot: true });
        return div._fullData[0].marker.colorscale;
    } finally {
        Plotly.purge(div);
        div.remove();
    }
}

/**
 * Build the Plotly layout annotation that carries the gap into EXPORTED images.
 *
 * A PNG saved from a panel must not be cleaner than the panel was: the DOM
 * notice is not captured by `Plotly.toImage`, so the same statement is placed
 * in the plot's own coordinate space as well.
 *
 * @param {Coverage} coverage
 * @returns {Object|null} A Plotly annotation, or null when nothing to say.
 */
export function coverageAnnotation(coverage) {
    const cov = coerce(coverage);
    if (cov.isComplete) return null;

    // The strip's breakdown, in the strip's words: "28 of 200 cells shown",
    // then one line per reason with its exact count
    const { severity } = cov.describe();
    const b = breakdown(cov);
    const lines = [
        ...b.rows.map(r => `${exactCount(r.count)} ${r.chip}`),
        ...b.notes.map(n => n.label)
    ].map(escapeHtml);
    const shown = lines.slice(0, MAX_ANNOTATION_LINES);
    const elided = lines.length - shown.length;
    if (elided > 0) shown.push(`...and ${elided} more`);

    const text = [`<b>${escapeHtml(b.headlineExact)}</b>`, ...shown].filter(Boolean).join('<br>');

    return {
        // Tagged so the plot code can find and replace its own annotation
        // without disturbing any annotation a future feature may add.
        name: 'coverage-notice',
        text,
        // Hidden on screen, where the status strip under the plot says it
        // (a box over the plot covered points), and
        // shown only while an image is exported (exportWithCoverage). Placed
        // above the plotting area, right-aligned, in the top margin.
        visible: false,
        xref: 'paper', yref: 'paper',
        x: 1, y: 1,
        xanchor: 'right', yanchor: 'bottom',
        yshift: 4,
        showarrow: false,
        align: 'left',
        font: { size: 11, color: ANNOTATION_COLOR[severity] || '#8a6d3b' },
        bgcolor: 'rgba(255,255,255,0.82)',
        bordercolor: ANNOTATION_COLOR[severity] || '#8a6d3b',
        borderwidth: 1,
        borderpad: 4
    };
}

/**
 * Fold the coverage annotation into a Plotly layout, replacing any previous one.
 * Exported so incremental-update paths (`Plotly.relayout`) can restate the gap
 * without going through a full re-plot.
 */
export function withCoverageAnnotation(layout, coverage) {
    const next = { ...(layout || {}) };
    const kept = (next.annotations || []).filter(a => !a || a.name !== 'coverage-notice');
    const ann = coverageAnnotation(coverage);
    next.annotations = ann ? [...kept, ann] : kept;
    return next;
}

/** Top margin (px) an export needs to show the coverage annotation's lines. */
export function coverageMarginFor(annotation) {
    if (!annotation) return 0;
    return 15 * String(annotation.text).split('<br>').length + 16;
}

/**
 * Run an image export with the coverage annotation shown (and room made for
 * it above the plot), then hide it again: an exported PNG must not be
 * cleaner than the panel, but on screen the banner already says it.
 * @param {HTMLElement} gd
 * @param {() => Promise<*>} exportFn - e.g. () => Plotly.downloadImage(gd, opts)
 */
export async function exportWithCoverage(gd, exportFn) {
    const anns = (gd && gd.layout && gd.layout.annotations) || [];
    const i = anns.findIndex(a => a && a.name === 'coverage-notice');
    if (i < 0 || typeof Plotly === 'undefined') return exportFn();
    const prevTop = gd.layout.margin ? gd.layout.margin.t : undefined;
    const needed = coverageMarginFor(anns[i]);
    const show = { [`annotations[${i}].visible`]: true };
    if (!(prevTop >= needed)) show['margin.t'] = needed;
    await Plotly.relayout(gd, show);
    try {
        return await exportFn();
    } finally {
        const hide = { [`annotations[${i}].visible`]: false };
        if (!(prevTop >= needed)) hide['margin.t'] = prevTop === undefined ? null : prevTop;
        await Plotly.relayout(gd, hide);
    }
}

/**
 * The modebar camera button, exporting with the coverage annotation shown.
 * @param {Object} config - Plotly config passed to newPlot
 * @returns {Object} config with the stock toImage button replaced
 */
export function withCoverageExportButton(config) {
    const cfg = { ...(config || {}) };
    if (cfg.displayModeBar === false || typeof Plotly === 'undefined' || !Plotly.Icons) return cfg;
    const remove = new Set(cfg.modeBarButtonsToRemove || []);
    if (remove.has('toImage')) return cfg;
    remove.add('toImage');
    cfg.modeBarButtonsToRemove = [...remove];
    const opts = cfg.toImageButtonOptions || { format: 'png' };
    cfg.modeBarButtonsToAdd = [...(cfg.modeBarButtonsToAdd || []), {
        name: 'toImageWithCoverage',
        title: 'Download plot as a png',
        icon: Plotly.Icons.camera,
        click: (gd) => _cameraExport(gd, opts)
    }];
    return cfg;
}

/** What the modebar camera does; the plot menu installs the memory-checked export (registerCameraExport). */
let _cameraExport = (gd, opts) => exportWithCoverage(gd, () => Plotly.downloadImage(gd, opts));

/** @param {(gd: HTMLElement, opts: Object) => *} fn */
export function registerCameraExport(fn) {
    _cameraExport = fn;
}

/** The panel id of a plot container (`plot-container-<id>`). */
function panelIdOf(host) {
    return host && typeof host.id === 'string' && host.id.startsWith('plot-container-')
        ? host.id.slice('plot-container-'.length) : null;
}

/** Per graph, the listener that says so when the browser drops its WebGL context. */
const _lossHandlers = new WeakMap();

/**
 * Say so in the strip when the browser drops the plot's WebGL context (too
 * many plots open, or the GPU out of memory): the plot goes blank without
 * an error otherwise.
 */
function watchContextLoss(gd) {
    if (!gd || typeof gd.on !== 'function') return;
    let handler = _lossHandlers.get(gd);
    if (handler && typeof gd.removeListener === 'function') gd.removeListener('plotly_webglcontextlost', handler);
    handler = () => setStatusTag(gd, 'webgl', {
        text: 'Plot went blank', severity: 'warning',
        title: 'The browser dropped this plot\'s WebGL canvas',
        pop: { text: 'The browser dropped this plot\'s WebGL canvas: too many plots are open, or the graphics '
            + 'memory ran out. Close a plot, then redraw this one.', actions: [['redraw', 'Redraw']] }
    });
    _lossHandlers.set(gd, handler);
    gd.on('plotly_webglcontextlost', handler);
}

/**
 * THE plot chokepoint. Draws traces and then states the coverage, in one call
 * that cannot do the first without the second.
 *
 * @param {HTMLElement} plotContainer
 * @param {Array} traces
 * @param {Object} layout
 * @param {Object} config
 * @param {Coverage} coverage  Required in spirit; a missing one renders loudly.
 * @param {string} [unit]
 * A graph already drawn in `plotContainer` is updated in place, not rebuilt:
 * the div, its listeners and whatever the user changed in it stay, and there
 * is no blank frame between the old points and the new. Callers clear the
 * container with `clearForDraw`, which keeps a live graph.
 *
 * @returns {Promise<*>} Whatever `Plotly.react` resolves to.
 */
export async function drawPlot(plotContainer, traces, layout, config, coverage, unit) {
    const cov = coerce(coverage, unit);
    // a graph redrawn in place keeps the camera the user turned it to; the
    // camera saved in the settings is for a new graph
    const result = await Plotly.react(
        plotContainer, withTraceUids(traces),
        withShownCamera(plotContainer, withCoverageAnnotation(layout, cov)),
        withCoverageExportButton(config)
    );
    renderCoverageNotice(plotContainer, cov, unit, { persistent: true });
    setStatusTag(plotContainer, 'webgl', null);
    watchContextLoss(plotContainer);
    // long axis / colour-bar titles: shortened to fit, full text on hover
    keepTitlesFitted(plotContainer);
    fitToContainer(plotContainer);
    return result;
}

/**
 * Size a graph to its container again. A graph drawn into in place keeps the
 * size it had; a notice added or removed above it since changes the space.
 * @param {HTMLElement} gd
 */
export function fitToContainer(gd) {
    const fl = gd && gd._fullLayout;
    if (!fl || typeof Plotly === 'undefined' || !Plotly.Plots || !Plotly.Plots.resize) return;
    const style = window.getComputedStyle(gd);
    const w = parseFloat(style.width), h = parseFloat(style.height);
    if (Math.abs(w - fl.width) > 1 || Math.abs(h - fl.height) > 1) {
        Plotly.Plots.resize(gd).catch(() => {});
    }
}

/**
 * Empty `plotContainer` for the next `drawPlot`, but keep a graph that is
 * drawn there: drawPlot reacts into it. Anything else (a placeholder) goes;
 * a graph whose DOM is gone is purged first, so react
 * does not diff against a figure that is no longer on screen.
 * @param {HTMLElement} plotContainer
 */
export function clearForDraw(plotContainer) {
    if (!plotContainer) return;
    const live = plotContainer._fullLayout && plotContainer.querySelector(':scope > .plot-container');
    if (live) {
        for (const child of Array.from(plotContainer.children)) {
            if (!child.classList.contains('plot-container') && !child.classList.contains('loading-overlay')) child.remove();
        }
        return;
    }
    // the WebGL side too: Plotly.purge leaves it to the garbage collector
    if (plotContainer._fullLayout) releasePlot(plotContainer);
    plotContainer.innerHTML = '';
}

/**
 * Traces with a `uid`: their name where names are unique. React matches
 * traces by uid, so what the user set on one (a legend click hiding a
 * category) follows that category when another part lacks some of them.
 *
 * Plotly puts the uid into element ids it later queries as CSS selectors
 * (a colour bar's '#...-cb<uid>'), so it is spelled with [A-Za-z0-9_-]
 * only: "t:total_counts" made the next draw throw 'not a valid selector'.
 * Other characters are written as _<hex>_, which keeps uids distinct.
 */
export function traceUid(name) {
    return 't-' + Array.from(name).map(c => (/[A-Za-z0-9-]/.test(c) ? c : `_${c.codePointAt(0).toString(16)}_`)).join('');
}

function withTraceUids(traces) {
    const names = traces.map(t => t && t.name);
    if (names.some(n => typeof n !== 'string' || !n) || new Set(names).size !== names.length) return traces;
    return traces.map(t => (t.uid ? t : { ...t, uid: traceUid(t.name) }));
}

/**
 * THE empty-state chokepoint. Replaces the family of
 * `plotContainer.innerHTML = '<div class="alert alert-warning">...'` calls,
 * every one of which stated a symptom ("Insufficient data for plotting")
 * without a cause.
 *
 * Refuses to render a bare message: the reason is a required argument, so
 * "nothing here" and "why nothing is here" cannot be separated.
 *
 * @param {HTMLElement} host
 * @param {Coverage} coverage
 * @param {string} [unit]
 */
export function drawPlaceholder(host, coverage, unit, { actions } = {}) {
    if (!host) return;
    const cov = coerce(coverage, unit);
    const { severity, headline, lines } = cov.describe();

    // the plot it replaces holds nothing any more (memory-guard-ui.js)
    if (host._fullLayout) releasePlot(host);
    const panel = panelIdOf(host);
    if (panel) forget(panel);

    const body = lines.length
        ? `<ul class="coverage-placeholder__reasons">${lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
        : '';
    // what undoes it, as the strip offers it ([action, label] pairs, see registerStatusActions)
    const todo = actions && actions.length ? actionButtons(actions, host) : '';
    host.innerHTML =
        `<div class="coverage-placeholder coverage-placeholder--${severity}" role="status">`
        + `<div class="coverage-placeholder__headline">${escapeHtml(headline || 'Nothing to show')}</div>`
        + body
        + (todo ? `<div class="coverage-placeholder__do">${todo}</div>` : '')
        + `</div>`;

    // The placeholder IS the statement here -- it occupies the whole panel
    // body. Drop the strip left over from a previous successful render so
    // the gap is stated once, not twice.
    if (stripAnchor(host)) {
        const s = stateOf(host);
        s.coverage = null;
        s.persistent = false;
        s.open = null;
        paint(host);
    }
}

export { Coverage, GAP };
