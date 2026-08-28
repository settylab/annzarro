/**
 * panel-surface -- the ONLY place a panel is allowed to paint.
 *
 * Every plot, every table and every empty state goes through one of the three
 * functions here, and each of them takes a `Coverage` (see
 * `static/js/utils/coverage.js`). That is what makes "say what is missing and
 * why" structural rather than a convention someone remembers to follow:
 *
 *   - `drawPlot()`      wraps `Plotly.newPlot` and renders the notice after it;
 *   - `drawPlaceholder()` replaces the old `innerHTML = '<div class="alert">'`
 *                       empty states, which said "Insufficient data" and never
 *                       said why;
 *   - `renderCoverageNotice()` annotates a table, or any container.
 *
 * ## The default is loud
 *
 * A caller that passes no coverage gets `Coverage.unreported()`, which renders
 * a visible magenta "this panel does not report what it is missing" badge --
 * on screen AND in the exported image. A contributor who adds a render path and
 * forgets to describe its gaps therefore sees a defect immediately instead of
 * shipping a clean plot that lies by omission. There is no code path through
 * this module that draws silently.
 *
 * `annzarro/tests/static/test_no_silent_gap.py` keeps `Plotly.newPlot` and the
 * alert-innerHTML idiom from reappearing outside this module, so the chokepoint
 * cannot be routed around without the guard going red.
 */

import { Coverage, GAP } from './coverage.js';

/** Class prefix for the notice element; styled in static/css/styles.css. */
const NOTICE_CLASS = 'coverage-notice';

/** Icon per severity. Text, not an icon font -- exports and copy-paste keep it. */
const SEVERITY_ICON = Object.freeze({
    notice: 'i',
    warning: '!',
    error: '!',
    unreported: '?'
});

/** Annotation colours, matched to the CSS severity palette. */
const ANNOTATION_COLOR = Object.freeze({
    notice: '#31708f',
    warning: '#8a6d3b',
    error: '#a94442',
    unreported: '#8b1d8b'
});

/** How many reason lines the on-plot annotation carries before eliding. */
const MAX_ANNOTATION_LINES = 3;

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
 * Find the element the notice should be inserted before. For a plot this is the
 * Plotly target itself (whose children Plotly owns and wipes), so the notice
 * lives as its previous sibling and survives every re-render.
 */
function noticeAnchor(host) {
    return (host && host.parentNode) ? host : null;
}

/**
 * Find this panel's existing notice among its parent's children.
 *
 * A direct scan rather than `querySelector(':scope > ...')`: `:scope` is not
 * available in every browser this tool is opened in, and a selector that
 * silently matches nothing would leave the notice stacking on every re-render
 * -- a silent failure inside the mechanism built to end silent failures.
 */
function findNotice(anchor) {
    const parent = anchor && anchor.parentNode;
    if (!parent || !parent.children) return null;
    const key = noticeKey(anchor);
    for (const child of Array.from(parent.children)) {
        if (child.dataset && child.dataset.coverageFor === key) return child;
    }
    return null;
}

function noticeKey(anchor) {
    return `${NOTICE_CLASS}-for-${(anchor && anchor.id) || 'panel'}`;
}

/**
 * Render (or clear) the coverage notice attached to `host`.
 *
 * Idempotent: repeated calls update the same element rather than stacking.
 * A complete coverage REMOVES the notice, so a panel that recovers stops
 * claiming a gap it no longer has.
 *
 * @param {HTMLElement} host  The plot or table container.
 * @param {Coverage} coverage
 * @param {string} [unit]  Fallback unit when coverage is absent.
 * @returns {HTMLElement|null} The notice element, or null when there is none.
 */
export function renderCoverageNotice(host, coverage, unit) {
    const anchor = noticeAnchor(host);
    if (!anchor) return null;

    const cov = coerce(coverage, unit);
    const parent = anchor.parentNode;
    let el = findNotice(anchor);

    if (cov.isComplete) {
        if (el) el.remove();
        return null;
    }

    const { severity, headline, lines } = cov.describe();

    if (!el) {
        el = document.createElement('div');
        el.className = NOTICE_CLASS;
        el.dataset.coverageFor = noticeKey(anchor);
        parent.insertBefore(el, anchor);
    }

    el.classList.remove(
        `${NOTICE_CLASS}--notice`, `${NOTICE_CLASS}--warning`,
        `${NOTICE_CLASS}--error`, `${NOTICE_CLASS}--unreported`
    );
    el.classList.add(`${NOTICE_CLASS}--${severity}`);
    el.dataset.reason = cov.worstReason;

    const detail = lines.length
        ? `<ul class="${NOTICE_CLASS}__reasons">${lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
        : '';

    el.innerHTML =
        `<span class="${NOTICE_CLASS}__icon" aria-hidden="true">${SEVERITY_ICON[severity] || '!'}</span>`
        + `<div class="${NOTICE_CLASS}__body">`
        + `<div class="${NOTICE_CLASS}__headline">${escapeHtml(headline)}</div>`
        + detail
        + `</div>`;
    el.setAttribute('role', 'status');
    el.setAttribute('title', [headline, ...lines].join('\n'));

    return el;
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

    const { severity, headline, lines } = cov.describe();
    const shown = lines.slice(0, MAX_ANNOTATION_LINES);
    const elided = lines.length - shown.length;
    if (elided > 0) shown.push(`...and ${elided} more`);

    const text = [`<b>${headline}</b>`, ...shown].filter(Boolean).join('<br>');

    return {
        // Tagged so the plot code can find and replace its own annotation
        // without disturbing any annotation a future feature may add.
        name: 'coverage-notice',
        text,
        xref: 'paper', yref: 'paper',
        x: 0.01, y: 0.99,
        xanchor: 'left', yanchor: 'top',
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
 * @returns {Promise<*>} Whatever `Plotly.newPlot` resolves to.
 */
export async function drawPlot(plotContainer, traces, layout, config, coverage, unit) {
    const cov = coerce(coverage, unit);
    const result = await Plotly.newPlot(
        plotContainer, traces, withCoverageAnnotation(layout, cov), config
    );
    renderCoverageNotice(plotContainer, cov, unit);
    return result;
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
export function drawPlaceholder(host, coverage, unit) {
    if (!host) return;
    const cov = coerce(coverage, unit);
    const { severity, headline, lines } = cov.describe();

    if (typeof Plotly !== 'undefined' && Plotly.purge) {
        try { Plotly.purge(host); } catch (e) { /* not a plot container */ }
    }

    const body = lines.length
        ? `<ul class="coverage-placeholder__reasons">${lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
        : '';
    host.innerHTML =
        `<div class="coverage-placeholder coverage-placeholder--${severity}" role="status">`
        + `<div class="coverage-placeholder__headline">${escapeHtml(headline || 'Nothing to show')}</div>`
        + body
        + `</div>`;

    // The placeholder IS the statement here -- it occupies the whole panel
    // body. Drop any notice bar left over from a previous successful render so
    // the gap is stated once, not twice.
    const stale = findNotice(noticeAnchor(host));
    if (stale) stale.remove();
}

export { Coverage, GAP };
