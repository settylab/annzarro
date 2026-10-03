/**
 * Behaviour of static/js/utils/panel-surface.js -- the render chokepoint.
 *
 * There is no browser and no jsdom on this host, so this drives the module
 * against a minimal DOM and Plotly stub. That bounds what these tests prove:
 * they establish the module's LOGIC (which element is created, what text it
 * carries, that a missing Coverage is rendered loudly, that the annotation
 * reaches Plotly), NOT that it lays out correctly in a browser. Visual
 * behaviour is verified by hand against the live service; see the PR body.
 *
 * The stub deliberately implements only what the module touches. If the module
 * grows a dependency on some other DOM API, these tests throw rather than
 * quietly passing -- an unimplemented stub method is a TypeError, not a no-op.
 *
 * Run:  node --test annzarro/tests/js/panel-surface.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { Coverage, GAP } from '../../../static/js/utils/coverage.js';
import {
    renderCoverageNotice, drawPlaceholder, drawPlot,
    coverageAnnotation, withCoverageAnnotation, exportWithCoverage, withCoverageExportButton
} from '../../../static/js/utils/panel-surface.js';

// --- minimal DOM ---------------------------------------------------------

class StubEl {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.dataset = {};
        this.attributes = {};
        this._className = '';
        this.innerHTML = '';
        this.classList = {
            add: (...cs) => { for (const c of cs) if (!this._classes().includes(c)) this._className += (this._className ? ' ' : '') + c; },
            remove: (...cs) => { this._className = this._classes().filter(c => !cs.includes(c)).join(' '); },
            contains: (c) => this._classes().includes(c)
        };
    }
    _classes() { return this._className ? this._className.split(/\s+/) : []; }
    get className() { return this._className; }
    set className(v) { this._className = v; }
    insertBefore(node, ref) {
        const i = this.children.indexOf(ref);
        this.children.splice(i < 0 ? this.children.length : i, 0, node);
        node.parentNode = this;
        return node;
    }
    appendChild(node) { this.children.push(node); node.parentNode = this; return node; }
    remove() {
        if (!this.parentNode) return;
        const i = this.parentNode.children.indexOf(this);
        if (i >= 0) this.parentNode.children.splice(i, 1);
        this.parentNode = null;
    }
    setAttribute(k, v) { this.attributes[k] = v; }
    getAttribute(k) { return this.attributes[k]; }
}

function installDom() {
    globalThis.document = { createElement: (tag) => new StubEl(tag) };
    const panel = new StubEl('div');
    const host = new StubEl('div');
    host.id = 'plot-container-7';
    panel.appendChild(host);
    return { panel, host };
}

function installPlotly() {
    const calls = [];
    globalThis.Plotly = {
        // drawPlot draws with react (into a graph already there, else a new one)
        react: async (el, traces, layout, config) => { calls.push({ el, traces, layout, config }); return el; },
        purge: () => { calls.push({ purge: true }); }
    };
    return calls;
}

function notices(panel) {
    return panel.children.filter(c => c.classList.contains('plot-status'));
}

// --- renderCoverageNotice ------------------------------------------------

test('a complete coverage renders no notice', () => {
    const { panel, host } = installDom();
    assert.equal(renderCoverageNotice(host, Coverage.complete(100, 'cells'), 'cells'), null);
    assert.equal(notices(panel).length, 0);
});

test('a partial coverage renders one notice stating count and reason', () => {
    const { panel, host } = installDom();
    renderCoverageNotice(host, Coverage.partial(3412, 75000, GAP.FILTERED,
        'points with no x value', { source: 'x-axis', unit: 'cells' }), 'cells');
    const [el] = notices(panel);
    assert.ok(el, 'a notice element was created');
    assert.match(el.getAttribute('data-summary'), /^3,412 of 75,000 cells shown/);
    assert.match(el.innerHTML, /3,412 of 75,000 <span class="ps-unit">cells <\/span>shown/);
    assert.match(el.innerHTML, /x-axis/);
    assert.match(el.innerHTML, /points with no x value/);
    assert.equal(el.dataset.reason, GAP.FILTERED);
});

test('NO coverage renders the loud unreported badge, never silence', () => {
    // The single most important behaviour in this module: a contributor who
    // adds a render path and forgets to describe it must SEE that, not ship a
    // clean panel.
    const { panel, host } = installDom();
    renderCoverageNotice(host, undefined, 'cells');
    const [el] = notices(panel);
    assert.ok(el, 'an undescribed panel still gets a notice');
    assert.ok(el.classList.contains('plot-status--unreported'));
    assert.match(el.innerHTML, /not report/i);
});

test('re-rendering updates the same notice instead of stacking', () => {
    const { panel, host } = installDom();
    renderCoverageNotice(host, Coverage.missing(GAP.FAILED, 'boom', { unit: 'cells' }), 'cells');
    renderCoverageNotice(host, Coverage.missing(GAP.EMPTY, 'nothing', { unit: 'cells' }), 'cells');
    assert.equal(notices(panel).length, 1, 'exactly one notice after two renders');
    assert.equal(notices(panel)[0].dataset.reason, GAP.EMPTY, 'and it shows the latest verdict');
});

test('recovering to complete removes a stale notice', () => {
    const { panel, host } = installDom();
    renderCoverageNotice(host, Coverage.missing(GAP.FAILED, 'boom', { unit: 'cells' }), 'cells');
    assert.equal(notices(panel).length, 1);
    renderCoverageNotice(host, Coverage.complete(10, 'cells'), 'cells');
    assert.equal(notices(panel).length, 0, 'a panel that recovers stops claiming a gap');
});

test('reason text is HTML-escaped', () => {
    const { panel, host } = installDom();
    renderCoverageNotice(host, Coverage.missing(GAP.FAILED,
        '<img src=x onerror=alert(1)>', { source: 'obs.<b>', unit: 'cells' }), 'cells');
    const html = notices(panel)[0].innerHTML;
    assert.ok(!html.includes('<img'), 'server/error text must not be injected as markup');
    assert.match(html, /&lt;img/);
});

// --- drawPlaceholder -----------------------------------------------------

test('drawPlaceholder writes headline and reasons into the host', () => {
    const { host } = installDom();
    installPlotly();
    drawPlaceholder(host, Coverage.missing(GAP.UNAVAILABLE,
        'the column "celltype" does not exist in this dataset',
        { source: 'obs.celltype', unit: 'cells', total: 75000 }), 'cells');
    assert.match(host.innerHTML, /coverage-placeholder--warning/);
    assert.match(host.innerHTML, /No cells shown/);
    assert.match(host.innerHTML, /does not exist in this dataset/);
});

test('drawPlaceholder with no coverage still says something', () => {
    const { host } = installDom();
    installPlotly();
    drawPlaceholder(host, null, 'cells');
    assert.match(host.innerHTML, /coverage-placeholder--unreported/);
    assert.match(host.innerHTML, /not report/i);
});

test('drawPlaceholder clears a leftover notice so the gap is stated once', () => {
    const { panel, host } = installDom();
    installPlotly();
    renderCoverageNotice(host, Coverage.missing(GAP.FAILED, 'boom', { unit: 'cells' }), 'cells');
    assert.equal(notices(panel).length, 1);
    drawPlaceholder(host, Coverage.missing(GAP.EMPTY, 'nothing', { unit: 'cells' }), 'cells');
    assert.equal(notices(panel).length, 0);
});

// --- annotations (what an EXPORTED image carries) ------------------------

test('a complete coverage produces no annotation', () => {
    assert.equal(coverageAnnotation(Coverage.complete(10, 'cells')), null);
});

test('an incomplete coverage produces a tagged, self-describing annotation', () => {
    const ann = coverageAnnotation(Coverage.partial(3412, 75000, GAP.FILTERED,
        'points with no x value', { source: 'x-axis', unit: 'cells' }));
    assert.equal(ann.name, 'coverage-notice');
    assert.match(ann.text, /3,412 of 75,000 cells shown/);
    assert.match(ann.text, /x-axis/);
    assert.equal(ann.showarrow, false);
});

test('on screen the banner states the gap; the in-plot box is for exports only', async () => {
    // Both used to show: the banner above the plot and a box over it (seen on
    // the docs' colour-range view, Hide Outliers panel).
    const cov = Coverage.partial(3412, 75000, GAP.FILTERED, 'points with no x value',
        { source: 'x-axis', unit: 'cells' });
    const ann = coverageAnnotation(cov);
    assert.equal(ann.visible, false, 'hidden on screen');
    assert.ok(ann.y >= 1 && ann.yanchor === 'bottom', 'outside the plotting area');
    const layout = withCoverageAnnotation({ margin: { t: 20 } }, cov);
    assert.equal(layout.margin.t, 20, 'no margin is reserved on screen');

    // an export shows it, with room above the plot, then hides it again
    const relayouts = [];
    globalThis.Plotly = { relayout: async (gd, u) => { relayouts.push(u); } };
    const gd = { layout: layout };
    const seen = await exportWithCoverage(gd, async () => 'png');
    assert.equal(seen, 'png');
    const i = layout.annotations.findIndex(a => a.name === 'coverage-notice');
    assert.equal(relayouts[0][`annotations[${i}].visible`], true);
    assert.ok(relayouts[0]['margin.t'] >= 15 * ann.text.split('<br>').length);
    assert.equal(relayouts[1][`annotations[${i}].visible`], false);
    assert.equal(relayouts[1]['margin.t'], 20);
});

test('the modebar camera exports through exportWithCoverage', () => {
    globalThis.Plotly = { Icons: { camera: {} } };
    const cfg = withCoverageExportButton({ modeBarButtonsToRemove: ['lasso2d'] });
    assert.ok(cfg.modeBarButtonsToRemove.includes('toImage'));
    assert.equal(cfg.modeBarButtonsToAdd.length, 1);
    assert.equal(typeof cfg.modeBarButtonsToAdd[0].click, 'function');
    assert.deepEqual(withCoverageExportButton({ displayModeBar: false }), { displayModeBar: false });
});

test('the annotation elides a long reason list rather than covering the plot', () => {
    let cov = Coverage.partial(1, 10, GAP.FILTERED, 'r1', { source: 's1', unit: 'cells' });
    for (const i of [2, 3, 4, 5]) cov = cov.withGap(GAP.FILTERED, `r${i}`, `s${i}`);
    const ann = coverageAnnotation(cov);
    assert.match(ann.text, /and 2 more/);
});

test('withCoverageAnnotation replaces its own and keeps foreign annotations', () => {
    const layout = { annotations: [{ name: 'user-note', text: 'keep me' }] };
    const once = withCoverageAnnotation(layout,
        Coverage.missing(GAP.FAILED, 'boom', { unit: 'cells' }));
    assert.equal(once.annotations.length, 2);
    const twice = withCoverageAnnotation(once,
        Coverage.missing(GAP.EMPTY, 'nothing', { unit: 'cells' }));
    assert.equal(twice.annotations.length, 2, 'no stacking on re-render');
    assert.ok(twice.annotations.some(a => a.name === 'user-note'), 'foreign annotation kept');
    assert.equal(layout.annotations.length, 1, 'the caller\'s layout is not mutated');
});

// --- drawPlot ------------------------------------------------------------

test('drawPlot draws AND states -- both, in one call', async () => {
    const { panel, host } = installDom();
    const calls = installPlotly();
    const cov = Coverage.partial(3412, 75000, GAP.FILTERED, 'points with no x value',
        { source: 'x-axis', unit: 'cells' });

    await drawPlot(host, [{ x: [1] }], { autosize: true }, { responsive: true }, cov, 'cells');

    assert.equal(calls.length, 1, 'Plotly.react was called exactly once');
    assert.equal(calls[0].layout.annotations.length, 1, 'the gap travels into the exported image');
    assert.match(calls[0].layout.annotations[0].text, /3,412 of 75,000/);
    assert.equal(notices(panel).length, 1, 'and onto the screen');
});

test('drawPlot with NO coverage still draws, and still says so', async () => {
    const { panel, host } = installDom();
    const calls = installPlotly();
    await drawPlot(host, [{ x: [1] }], {}, {});
    assert.equal(calls.length, 1, 'the plot is not blocked -- silence is the bug, not drawing');
    assert.match(calls[0].layout.annotations[0].text, /not reported/i);
    assert.ok(notices(panel)[0].classList.contains('plot-status--unreported'));
});

test('drawPlot on a complete coverage keeps its strip, saying only the count', async () => {
    // A plot's strip is always there, so the plot never moves when it changes
    const { panel, host } = installDom();
    const calls = installPlotly();
    await drawPlot(host, [{ x: [1] }], { autosize: true }, {}, Coverage.complete(10, 'cells'), 'cells');
    assert.deepEqual(calls[0].layout.annotations, [], 'a complete panel exports no caption');
    const [el] = notices(panel);
    assert.ok(el.classList.contains('plot-status--ok'));
    assert.match(el.innerHTML, /<b class="ps-headline">10 cells<\/b>/);
    assert.doesNotMatch(el.innerHTML, /ps-pop|details/, 'nothing to detail');
});

test('the strip comes AFTER the plot, so the plot keeps its top edge', async () => {
    const { panel, host } = installDom();
    installPlotly();
    await drawPlot(host, [{ x: [1] }], {}, {}, Coverage.complete(10, 'cells'), 'cells');
    assert.deepEqual(panel.children.map(c => c.id || c.className.split(' ')[0]), ['plot-container-7', 'plot-status']);
});

test('a table strip (not persistent) goes away when nothing is missing', () => {
    const { panel, host } = installDom();
    renderCoverageNotice(host, Coverage.missing(GAP.FAILED, 'boom', { unit: 'cells', total: 5 }), 'cells');
    assert.equal(notices(panel).length, 1);
    renderCoverageNotice(host, Coverage.complete(5, 'cells'), 'cells');
    assert.equal(notices(panel).length, 0);
});

test('a trace uid is a valid CSS id fragment, and distinct names stay distinct', async () => {
    // Plotly queries '#<id>-cb<uid>' for a colour bar: "t:total_counts" threw
    const { traceUid } = await import('../../../static/js/utils/panel-surface.js');
    const names = ['total_counts', 'B cell', 'B_cell', 'B:cell', 'a.b', 'NA', 'é', '_20_'];
    const uids = names.map(traceUid);
    for (const u of uids) assert.match(u, /^[A-Za-z0-9_-]+$/);
    assert.equal(new Set(uids).size, names.length);
});
