/**
 * Inspect: the section of the Gene Signature panel that shows what a score is
 * made of (design 4.3 and UX review 2.4). Behind one disclosure button, so the
 * first view stays the gene list.
 *
 * - The distribution of the score over the cells shown (a histogram that
 *   counts the cells with no score and says so), and its mean, SD, range.
 * - The figures of each gene from the server's `result` frame (detected,
 *   mean, SD, clipped), sortable, with plain-words flags for the genes that
 *   dominate the score or are barely detected. A click on a gene focuses it.
 * - Which aggregation is inspected, with a choice of every one the signature
 *   supports. The score comes from the same score store the plots use (a
 *   dependant like any other), so a score a plot already holds is not asked
 *   for again; a score nothing holds is computed under the store's cost tiers
 *   and states (computing with Cancel, asks first, refused, failed).
 * - CSV of the gene figures and of the score per cell, built here from the
 *   held Float32Array.
 *
 * Nothing is computed, and nothing is watched, until the section is opened.
 * Closing it lets go of the score (a score a plot still needs stays).
 */
import { DataManager } from '../data-manager.js';
import { scores } from '../utils/score-source.js';
import { describeScore } from '../utils/score-notices.js';
import { DEFAULT_METHOD, definitionText, fmtCount } from '../utils/gene-signature.js';
import { cleanOffered, methodLabel } from '../utils/signature-options.js';
import {
    distribution, binText, missingText, geneRows, flagSummary, sortGeneRows, GENE_COLUMNS, ROWS_FIRST,
    fmtNum, fmtPercent, geneCsv, scoreCsvParts, fileName
} from '../utils/score-inspect.js';

/** What each aggregation is called here. */
const METHOD_LABELS = {};

const SVG_NS = 'http://www.w3.org/2000/svg';
const MARGIN = { left: 38, right: 6, top: 6, bottom: 20 };
const HEIGHT = 120;
const MAX_BAR = 24;
const GAP = 2;

function svg(tag, attrs = {}, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    for (const child of children) node.append(child);
    return node;
}

/** A count on an axis: in full under 10,000, compact above. */
function axisCount(n) {
    if (n >= 1e6) return `${Number((n / 1e6).toPrecision(3))}M`;
    if (n >= 1e4) return `${Number((n / 1e3).toPrecision(3))}K`;
    return n.toLocaleString('en-US');
}

/** The next 1, 2 or 5 times a power of ten at or above n. */
function niceMax(n) {
    if (n <= 1) return 1;
    const p = 10 ** Math.floor(Math.log10(n));
    for (const m of [1, 2, 5, 10]) if (m * p >= n) return m * p;
    return 10 * p;
}

/** A bar with a 4px rounded data end and a square foot. */
function barPath(x, y, w, h) {
    const r = Math.min(4, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * @param {Object} opts
 * @param {string} opts.id - the signature's panel id
 * @param {Document} opts.doc
 * @param {{el: Function, clear: Function}} opts.D - the panel's DOM builder
 * @param {() => string} opts.getTitle
 * @param {() => Object} opts.getRecipe
 * @param {(gene: string) => void} opts.focusGene
 * @returns {{element: HTMLElement, destroy: () => void, isOpen: () => boolean, setOpen: (open: boolean) => void}}
 */
export function createInspect({ id, D, getTitle, getRecipe, focusGene }) {
    const sid = (x) => `gsig-inspect-${x}-${id}`;
    let _open = false;
    let _method = null;                    // the aggregation inspected; chosen when first opened
    let _handle = null;
    let _snap = null;
    let _sort = { key: 'name', dir: 'asc' };
    let _showAll = false;
    let _active = -1;                      // the bin pointed at or focused
    let _dist = null;                      // distribution of the values drawn
    let _drawnFor = null;                  // the values the histogram was computed from
    let _paintedHeader = null;             // the header the genes were drawn from
    let _observer = null;

    const toggle = D.el('button', { type: 'button', class: 'gsig-inspect__toggle', id: sid('toggle'),
        aria: { expanded: 'false', controls: sid('body') }, on: { click: () => setOpen(!_open) } },
    D.el('span', { class: 'gsig-inspect__caret', aria: { hidden: 'true' }, text: '▸' }),
    D.el('span', { class: 'gsig-inspect__name', text: 'Inspect' }),
    D.el('span', { class: 'gsig-inspect__summary', text: 'Distribution and figures of each gene' }));
    const aggregation = D.el('div', { class: 'gsig-inspect__agg', role: 'radiogroup', aria: { label: 'Aggregation inspected' },
        on: { keydown: onAggKey } });
    const definition = D.el('div', { class: 'gsig-inspect__definition' });
    const state = D.el('div', { class: 'gsig-inspect__state', role: 'status', aria: { live: 'polite' } });
    const content = D.el('div', { class: 'gsig-inspect__content', hidden: true });
    const body = D.el('div', { class: 'gsig-inspect__body', id: sid('body'), role: 'region', aria: { labelledby: sid('toggle') }, hidden: true },
        aggregation, definition, state, content);
    const element = D.el('section', { class: 'gsig-inspect' }, toggle, body);

    // the content's parts, made once
    const heading = D.el('div', { class: 'gsig-inspect__heading', id: sid('heading') });
    const chartHost = D.el('div', { class: 'gsig-inspect__chart' });
    const tip = D.el('div', { class: 'gsig-hist__tip', role: 'status', aria: { live: 'polite' } });
    const figures = D.el('div', { class: 'gsig-inspect__figures' });
    const missing = D.el('div', { class: 'gsig-inspect__missing' });
    const exportRow = D.el('div', { class: 'gsig-inspect__export' });
    const flags = D.el('div', { class: 'gsig-inspect__flags' });
    const tableHost = D.el('div', { class: 'gsig-inspect__table' });
    const note = D.el('div', { class: 'gsig-inspect__note', text: 'Per-gene figures use all cells of the dataset.' });
    const result = D.el('div', { class: 'gsig-inspect__result', role: 'status', aria: { live: 'polite' } });
    content.append(heading, D.el('div', { class: 'gsig-inspect__chartwrap' }, chartHost, tip), figures, missing, exportRow,
        result, flags, tableHost, note);

    // ---------------------------------------------------------------------
    // open, close, aggregation

    function setOpen(open) {
        if (open === _open) return;
        _open = open;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.querySelector('.gsig-inspect__caret').textContent = open ? '▾' : '▸';
        element.classList.toggle('is-open', open);
        body.hidden = !open;
        if (open) {
            if (!_method) _method = firstMethod();
            watch();
            observeSize();
        } else {
            unwatch();
            if (_observer) { _observer.disconnect(); _observer = null; }
            toggleSummary(null);
        }
    }

    /** The aggregation a plot already shows for this signature, else the default. */
    function firstMethod() {
        const { sources } = scores();
        for (const h of sources.handlesOf(id)) if (h.role !== 'inspect' && h.sub) return h.sub;
        return DEFAULT_METHOD;
    }

    /** The aggregations to inspect: what the signature offers, and the one being inspected if it was switched off since. */
    function methodsHere() {
        const recipe = getRecipe();
        const list = cleanOffered(recipe.offered, recipe.method);
        return _method && !list.includes(_method) ? [...list, _method] : list;
    }

    function watch() {
        unwatch();
        const { sources } = scores();
        _handle = sources.watch(id, {
            host: element, role: 'inspect', sub: _method,
            visible: () => _open && element.isConnected,
            onChange: (snap) => { _snap = snap; render(); }
        });
        _snap = _handle.read();
        render();
    }

    function unwatch() {
        if (_handle) _handle.release();
        _handle = null;
        _snap = null;
        _drawnFor = null;
        _paintedHeader = null;
    }

    function chooseMethod(method) {
        if (method === _method) return;
        _method = method;
        _drawnFor = null;
        _active = -1;
        if (_open) watch();
    }

    function onAggKey(e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const methods = methodsHere();
        const i = methods.indexOf(_method);
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
        const next = methods[(i + step + methods.length) % methods.length];
        chooseMethod(next);
        const btn = aggregation.querySelector(`[data-method="${next}"]`);
        if (btn) btn.focus();
    }

    // ---------------------------------------------------------------------
    // drawing

    function render() {
        if (!_open) return;
        paintAggregation();
        const recipe = { ...getRecipe(), method: _method };
        definition.textContent = `${definitionText(recipe)}.`;
        const snap = _snap;
        const hasValues = !!(snap && snap.values && snap.header);
        paintState(snap, hasValues);
        content.hidden = !hasValues;
        if (!hasValues) { toggleSummary(null); return; }
        const values = snap.values;
        if (_drawnFor === values && _paintedHeader === snap.header && chartHost.firstChild) {
            paintExport(snap);                 // progress and edits change the buttons, not the figures
            return;
        }
        _paintedHeader = snap.header;
        if (_drawnFor !== values) {
            _dist = distribution(values);
            _drawnFor = values;
            _active = -1;
        }
        const header = snap.header;
        heading.textContent = `Score distribution, ${fmtCount(values.length)} cell${values.length === 1 ? '' : 's'} shown`
            + (header.n_cells && header.n_cells !== values.length ? ` of ${fmtCount(header.n_cells)}` : '');
        drawChart();
        paintFigures();
        paintExport(snap);
        paintGenes(header);
        toggleSummary(_dist);
    }

    function paintAggregation() {
        D.clear(aggregation);
        for (const method of methodsHere()) {
            const on = method === _method;
            aggregation.append(D.el('button', { type: 'button', role: 'radio', class: `gsig-seg${on ? ' active' : ''}`,
                data: { method }, aria: { checked: String(on) }, tabindex: on ? '0' : '-1',
                on: { click: () => chooseMethod(method) } }, METHOD_LABELS[method] || methodLabel(method)));
        }
    }

    /** The one line beside the closed or open toggle: the figures when there are some. */
    function toggleSummary(dist) {
        const el = toggle.querySelector('.gsig-inspect__summary');
        el.textContent = dist && dist.finite
            ? `Mean ${fmtNum(dist.mean)}, SD ${fmtNum(dist.sd)}, ${fmtCount(dist.n)} cell${dist.n === 1 ? '' : 's'}`
            : 'Distribution and figures of each gene';
    }

    /** The state of the score in words with its actions, or nothing when the score is ready and current. */
    function paintState(snap, hasValues) {
        D.clear(state);
        state.hidden = false;
        if (!snap) { state.hidden = true; return; }
        const title = getTitle();
        const notice = describeScore({ ...snap, title }, { role: 'inspect', sharers: 1 });
        if (!notice) { state.hidden = true; return; }
        const kind = notice.state;
        state.dataset.state = kind;
        let text = notice.headline;
        if (notice.text) text += ` ${notice.text}`;
        if (kind === 'estimating') text = `Estimating how long '${title}' will take.`;
        if (kind === 'nogenes') text = 'Tick genes to inspect their score.';
        if (kind === 'awaiting' || kind === 'cancelled') text = text.replace(/ This plot has no colour\.$/, '');
        state.append(D.el('span', { class: 'gsig-inspect__statetext', text }));
        const buttons = [];
        for (const [action, label] of notice.actions) {
            const run = actionOf(action);
            if (run) buttons.push(D.el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link', data: { inspectAction: action },
                on: { click: run } }, label.replace(/ for \d+ plots$/, '')));
        }
        if (buttons.length) state.append(' ', ...buttons);
        if (hasValues && (kind === 'updating' || kind === 'held')) state.dataset.previous = 'true';
        else delete state.dataset.previous;
    }

    /** What a notice's button does here; actions that belong to a plot (Open signature, Choose another) are left out. */
    function actionOf(action) {
        if (!_handle) return null;
        const { sources } = scores();
        switch (action) {
            case 'score-compute': return () => _handle.compute();
            case 'score-cancel': return () => _handle.cancel();
            case 'score-retry': return () => _handle.retry();
            case 'score-update': return () => sources.update(id);
            default: return null;
        }
    }

    // ---- histogram

    function drawChart() {
        D.clear(chartHost);
        const dist = _dist;
        if (!dist || !dist.finite) {
            chartHost.append(D.el('div', { class: 'gsig-inspect__empty', text: 'No cell has a score.' }));
            return;
        }
        const width = Math.max(180, chartHost.clientWidth || element.clientWidth - 16 || 300);
        const pw = width - MARGIN.left - MARGIN.right;
        const ph = HEIGHT - MARGIN.top - MARGIN.bottom;
        let top = 0;
        for (const c of dist.counts) if (c > top) top = c;
        const ymax = niceMax(top);
        const n = dist.counts.length;
        const slot = pw / n;
        const barW = Math.max(1, Math.min(MAX_BAR, slot - GAP));
        const root = svg('svg', { class: 'gsig-hist', viewBox: `0 0 ${width} ${HEIGHT}`, width, height: HEIGHT, 'aria-hidden': 'true', focusable: 'false' });
        // recessive axes: a hairline baseline and one gridline at the top of the scale
        for (const v of [0, ymax / 2, ymax]) {
            const y = MARGIN.top + ph - (v / ymax) * ph;
            root.append(svg('line', { class: v === 0 ? 'gsig-hist__axis' : 'gsig-hist__grid', x1: MARGIN.left, x2: MARGIN.left + pw, y1: y, y2: y }));
            root.append(svg('text', { class: 'gsig-hist__tick', x: MARGIN.left - 4, y: y + 3, 'text-anchor': 'end' }, document.createTextNode(axisCount(v))));
        }
        const bars = [];
        for (let i = 0; i < n; i++) {
            const h = (dist.counts[i] / ymax) * ph;
            const x = MARGIN.left + i * slot + (slot - barW) / 2;
            if (dist.counts[i] > 0) {
                const bar = svg('path', { class: 'gsig-hist__bar', d: barPath(x, MARGIN.top + ph - Math.max(h, 1), barW, Math.max(h, 1)) });
                bars.push(bar);
                root.append(bar);
            } else {
                bars.push(null);
            }
        }
        const labels = n === 1 ? [[MARGIN.left + pw / 2, 'middle', dist.min]] : [
            [MARGIN.left, 'start', dist.min], [MARGIN.left + pw / 2, 'middle', (dist.min + dist.max) / 2], [MARGIN.left + pw, 'end', dist.max]];
        for (const [x, anchor, v] of labels) {
            root.append(svg('text', { class: 'gsig-hist__tick', x, y: HEIGHT - 5, 'text-anchor': anchor }, document.createTextNode(fmtNum(v))));
        }
        // hit targets: the whole column, taller than the bar
        const hits = [];
        for (let i = 0; i < n; i++) {
            const hit = svg('rect', { class: 'gsig-hist__hit', x: MARGIN.left + i * slot, y: MARGIN.top, width: slot, height: ph, 'data-bin': i });
            hit.addEventListener('pointerenter', () => setActive(i, { from: 'pointer' }));
            hit.addEventListener('pointermove', () => setActive(i, { from: 'pointer' }));
            hits.push(hit);
            root.append(hit);
        }
        root.addEventListener('pointerleave', () => setActive(-1));
        const group = D.el('div', { class: 'gsig-hist__group', tabindex: '0', role: 'group',
            aria: { label: `Histogram of the score in ${n} bar${n === 1 ? '' : 's'}. Left and right arrow keys read each bar.`, describedby: sid('heading') },
            on: {
                keydown: onChartKey,
                focus: () => { if (_active < 0) setActive(0, { from: 'key' }); },
                blur: () => setActive(-1)
            } });
        group.append(root);
        chartHost.append(group);
        chartHost._geometry = { bars, hits, width, pw, slot, ymax, ph };
        if (_active >= 0) setActive(_active, { from: 'key' });
    }

    function setActive(i, { from = 'key' } = {}) {
        const g = chartHost._geometry;
        if (!g || !_dist) return;
        if (_active >= 0 && g.bars[_active]) g.bars[_active].classList.remove('is-active');
        _active = i;
        if (i < 0) {
            tip.classList.remove('is-shown');
            tip.textContent = '';
            return;
        }
        if (g.bars[i]) g.bars[i].classList.add('is-active');
        tip.textContent = binText(_dist, i);
        tip.classList.add('is-shown');
        tip.dataset.bin = String(i);
        // above the column, kept inside the chart
        const wrap = tip.parentElement.getBoundingClientRect();
        const w = tip.offsetWidth || 120;
        const center = MARGIN.left + (i + 0.5) * g.slot;
        const left = Math.max(0, Math.min((wrap.width || g.width) - w, center - w / 2));
        tip.style.left = `${left}px`;
        void from;
    }

    function onChartKey(e) {
        const n = _dist ? _dist.counts.length : 0;
        if (!n) return;
        let i = _active < 0 ? 0 : _active;
        if (e.key === 'ArrowRight') i = Math.min(n - 1, i + 1);
        else if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
        else if (e.key === 'Home') i = 0;
        else if (e.key === 'End') i = n - 1;
        else return;
        e.preventDefault();
        setActive(i, { from: 'key' });
    }

    function observeSize() {
        if (_observer || typeof ResizeObserver === 'undefined') return;
        let last = 0;
        _observer = new ResizeObserver(() => {
            const w = chartHost.clientWidth;
            if (!w || Math.abs(w - last) < 2) return;
            last = w;
            if (_open && _snap && _snap.values) drawChart();
        });
        _observer.observe(chartHost);
    }

    // ---- figures, export, genes

    function paintFigures() {
        D.clear(figures);
        const d = _dist;
        const item = (label, value) => D.el('span', { class: 'gsig-inspect__figure' },
            D.el('span', { class: 'gsig-inspect__figure-label', text: label }), ' ', D.el('strong', { text: value }));
        if (d && d.finite) {
            figures.append(item('Mean', fmtNum(d.mean)), item('SD', fmtNum(d.sd)), item('Min', fmtNum(d.min)), item('Max', fmtNum(d.max)));
        }
        figures.append(item('Missing', fmtCount(d ? d.missing : 0)));
        missing.textContent = d ? missingText(d) : '';
        missing.classList.toggle('is-warn', !!(d && d.missing));
    }

    function paintExport(snap) {
        D.clear(exportRow);
        const ready = snap.state === 'ready';
        const why = ready ? undefined : 'Export is available when the score is up to date.';
        exportRow.append(
            D.el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', data: { inspectExport: 'genes' },
                disabled: !ready, title: why, on: { click: exportGenes } }, 'Export gene figures (CSV)'),
            ' ',
            D.el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', data: { inspectExport: 'scores' },
                disabled: !ready, title: why, on: { click: () => { exportScores().catch((error) => say(`Export failed: ${error.message}`)); } } },
            'Export scores per cell (CSV)'));
    }

    function say(text) {
        result.textContent = text;
    }

    function download(name, parts) {
        const url = URL.createObjectURL(new Blob(parts, { type: 'text/csv;charset=utf-8' }));
        const link = D.el('a', { href: url, download: name, hidden: true });
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function exportGenes() {
        const snap = _snap;
        if (!snap || !snap.header) return;
        const genes = snap.header.genes || [];
        download(fileName(getTitle(), `${_method}_genes`), [geneCsv(genes)]);
        say(`Exported ${fmtCount(genes.length)} gene${genes.length === 1 ? '' : 's'}.`);
    }

    async function exportScores() {
        const snap = _snap;
        if (!snap || !snap.values) return;
        const values = snap.values;
        let names;
        try {
            names = await DataManager.allCellNames();
        } catch (error) {
            throw new Error(`the names of this many cells are not in the browser (${error.message || 'too many'})`, { cause: error });
        }
        if (_snap !== snap && (!_snap || _snap.values !== values)) throw new Error('the score changed while the names loaded. Try again.');
        const parts = scoreCsvParts(names, values, { header: 'score' });
        download(fileName(getTitle(), `${_method}_scores`), parts);
        say(`Exported the score of ${fmtCount(values.length)} cell${values.length === 1 ? '' : 's'}.`);
    }

    function paintGenes(header) {
        const rows = geneRows(header.genes, _method);
        flags.textContent = flagSummary(rows);
        flags.hidden = !flags.textContent;
        D.clear(tableHost);
        if (!rows.length) { tableHost.append(D.el('div', { class: 'gsig-inspect__empty', text: 'No gene was used.' })); return; }
        const sorted = sortGeneRows(rows, _sort.key, _sort.dir);
        const shown = _showAll ? sorted : sorted.slice(0, ROWS_FIRST);
        const head = D.el('tr', {}, ...GENE_COLUMNS.map((c) => {
            const on = _sort.key === c.key;
            return D.el('th', { scope: 'col', class: `gsig-col-${c.key}${c.key === 'name' || c.key === 'detected' ? '' : ' gsig-col-extra'}`,
                aria: { sort: on ? (_sort.dir === 'asc' ? 'ascending' : 'descending') : 'none' } },
            D.el('button', { type: 'button', class: 'gsig-inspect__sort', data: { sort: c.key }, on: { click: () => sortBy(c) } },
                c.label, D.el('span', { class: 'gsig-inspect__arrow', aria: { hidden: 'true' }, text: on ? (_sort.dir === 'asc' ? ' ▲' : ' ▼') : '' })));
        }));
        const clippedOff = rows.every(r => r.clipped === null);
        const table = D.el('table', { class: 'gsig-inspect__genes' }, D.el('thead', {}, head),
            D.el('tbody', {}, ...shown.map((r) => D.el('tr', { class: r.flags.length ? 'has-flag' : '', data: { gene: r.name } },
                D.el('th', { scope: 'row', class: 'gsig-col-name' },
                    D.el('button', { type: 'button', class: 'gsig-inspect__gene', title: `Focus ${r.name}`,
                        on: { click: () => focusGene(r.name) } }, r.name),
                    ...r.flags.map(f => D.el('div', { class: `gsig-inspect__flag gsig-inspect__flag--${f.kind}`, text: f.text }))),
                D.el('td', { class: 'gsig-col-detected', text: fmtPercent(r.detected) }),
                D.el('td', { class: 'gsig-col-mean gsig-col-extra', text: fmtNum(r.mean) }),
                D.el('td', { class: 'gsig-col-sd gsig-col-extra', text: fmtNum(r.sd) }),
                D.el('td', { class: 'gsig-col-clipped gsig-col-extra', text: r.clipped === null ? (clippedOff ? 'n/a' : '') : fmtPercent(r.clipped) })))));
        tableHost.append(table);
        if (!_showAll && sorted.length > shown.length) {
            tableHost.append(D.el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link', data: { inspectAction: 'show-all' },
                on: { click: () => { _showAll = true; paintGenes(header); } } }, `Show all ${fmtCount(sorted.length)} genes`));
        }
    }

    function sortBy(column) {
        _sort = _sort.key === column.key
            ? { key: column.key, dir: _sort.dir === 'asc' ? 'desc' : 'asc' }
            : { key: column.key, dir: column.numeric ? 'desc' : 'asc' };
        if (_snap && _snap.header) paintGenes(_snap.header);
        const btn = tableHost.querySelector(`[data-sort="${column.key}"]`);
        if (btn) btn.focus();
    }

    function destroy() {
        unwatch();
        if (_observer) { _observer.disconnect(); _observer = null; }
        _open = false;
    }

    return { element, destroy, isOpen: () => _open, setOpen,
        /** For tests: what the section holds. */
        _debug: () => ({ open: _open, method: _method, state: _snap && _snap.state, key: _snap && _snap.key, dist: _dist,
            sort: _sort, active: _active }) };
}
