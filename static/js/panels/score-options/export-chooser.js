/**
 * The export chooser of Inspect: the user picks which method · layer combinations of a source to export, for a Gene
 * Signature and a Gene Table alike.
 *
 *   Export scores per cell    one row per cell shown, the cell name and one column per combination
 *   Export gene figures       the per-gene figures of each combination's own layer, in the long form
 *
 * The chooser lists the source's offered combinations (the list plots choose from, impossible ones left out). The one
 * being inspected is ticked, and any already computed. A combination that is not computed is computed when the user
 * presses Export, never before, through the score store under its usual cost tiers: the estimate is stated beside it
 * when the chooser opens, one that asks first (the confirm tier) is asked about, one that is refused is left out and
 * named, progress is shown with Cancel, and Cancel leaves no file. The CSV is built in chunks that become Blobs as they
 * are made, so a large export never holds its text as one string.
 */
import { scores } from '../../utils/score-source.js';
import { durationText } from '../../utils/score-notices.js';
import { multiScoreCsvParts, longGeneCsv, exportFileName } from '../../utils/score-inspect.js';
import { fmtCount } from '../../utils/gene-signature.js';

/** The states in which a combination will not change by itself. */
const TERMINAL = new Set(['failed', 'refused', 'noscore', 'nogenes', 'cancelled', 'deleted', 'off', 'nolayer', 'cycle']);

/**
 * @param {Object} o
 * @param {{el: Function, clear: Function}} o.D
 * @param {string} o.id - the source's panel id
 * @param {() => string} o.getTitle
 * @param {() => Array<{method: string, layer: string, label: string}>} o.getOptions - the combinations on offer
 * @param {() => {method: string, layer: string}} o.getCurrent - the one being inspected
 * @param {() => Promise<ArrayLike<string>>} o.getNames - the names of the cells shown
 * @param {(name: string, parts: Array<string|Blob>) => void} o.download
 * @param {(text: string) => void} o.say - the result line
 */
export function createExportChooser({ D, id, getTitle, getOptions, getCurrent, getNames, download, say }) {
    const sid = (x) => `gsig-export-${x}-${id}`;
    let kind = null;                 // 'scores' | 'genes' while the chooser is open
    let run = null;                  // the export in progress
    let estimates = new Map();       // option key -> {text, tier}
    const key = (o) => `${o.method}@${o.layer}`;

    const title = D.el('div', { class: 'gsig-export__title', id: sid('title') });
    const list = D.el('div', { class: 'gsig-export__list', role: 'group', aria: { labelledby: sid('title') } });
    const status = D.el('div', { class: 'gsig-export__status', role: 'status', aria: { live: 'polite' } });
    const go = D.el('button', { type: 'button', class: 'btn btn-sm btn-primary', data: { exportGo: '' }, on: { click: () => { start().catch(fail); } } }, 'Export');
    const close = D.el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', data: { exportClose: '' }, on: { click: () => closeChooser() } }, 'Close');
    const buttons = D.el('div', { class: 'gsig-export__buttons' }, go, ' ', close);
    const element = D.el('div', { class: 'gsig-export', hidden: true, data: { exportChooser: '' } }, title, list, buttons, status);

    const computed = (o) => scores().sources.isReady(id, { sub: o.method, layer: o.layer });
    const fail = (error) => { endRun(); say(`Export failed: ${error.message}`); };

    function open(which) {
        kind = which;
        title.textContent = which === 'scores'
            ? 'Export scores per cell: choose the combinations to include'
            : 'Export gene figures: choose the combinations to include';
        element.hidden = false;
        status.textContent = '';
        estimates = new Map();
        paintList(true);
        for (const o of getOptions()) {
            if (computed(o)) continue;
            scores().sources.estimate(id, { sub: o.method, layer: o.layer }).then((reply) => {
                if (!reply || !reply.estimate) return;
                estimates.set(key(o), { tier: reply.estimate.tier, seconds: reply.estimate.seconds });
                if (kind) paintList(false);
            }).catch(() => {});
        }
    }

    function closeChooser() {
        if (run) cancelRun();
        kind = null;
        element.hidden = true;
    }

    function ticked() {
        return new Set([...list.querySelectorAll('input[type=checkbox]')].filter(b => b.checked).map(b => b.dataset.option));
    }

    function note(o) {
        if (computed(o)) return 'computed';
        const e = estimates.get(key(o));
        if (!e) return 'not computed';
        if (e.tier === 'refused') return `would take ${durationText(e.seconds)}: refused, left out`;
        if (e.tier === 'confirm') return `not computed, will take ${durationText(e.seconds)}, asks first`;
        return `not computed, ${durationText(e.seconds)}`;
    }

    /** Build the list once (the boxes are never replaced under a click); `refresh` only rewrites the notes. */
    function paintList(first) {
        if (!first) { refresh(); return; }
        const cur = getCurrent();
        D.clear(list);
        for (const o of getOptions()) {
            const k = key(o);
            const on = (cur.method === o.method && cur.layer === o.layer) || computed(o);
            const box = D.el('input', { type: 'checkbox', class: 'form-check-input', id: sid(`opt-${k}`), data: { option: k }, checked: on });
            list.append(D.el('div', { class: 'form-check gsig-export__option' }, box,
                D.el('label', { for: sid(`opt-${k}`), class: 'form-check-label', text: o.label }),
                D.el('span', { class: 'gsig-export__note', data: { option: k }, text: ` ${note(o)}` })));
        }
    }

    function refresh() {
        for (const o of getOptions()) {
            const el = list.querySelector(`.gsig-export__note[data-option="${key(o)}"]`);
            if (el) el.textContent = ` ${note(o)}`;
        }
        for (const box of list.querySelectorAll('input[type=checkbox]')) box.disabled = !!run;
    }

    function endRun() {
        if (run) for (const h of run.handles.values()) h.release();
        run = null;
        go.disabled = false;
        paintList(false);
    }

    function cancelRun() {
        if (!run) return;
        run.cancelled = true;
        for (const h of run.handles.values()) { try { h.cancel(); } catch { /* already over */ } }
        if (run.answer) run.answer(false);
        endRun();
        status.textContent = 'Export cancelled. No file was made.';
    }

    /** Ask whether to compute the combinations that take a while; resolves with the answer. */
    function ask(slow) {
        const total = slow.reduce((s, x) => s + (x.seconds || 0), 0);
        D.clear(status);
        status.append(D.el('span', { text: `${slow.map(x => x.label).join(', ')} will take ${durationText(total)} to compute. ` }));
        return new Promise((resolve) => {
            run.answer = resolve;
            status.append(D.el('button', { type: 'button', class: 'btn btn-sm btn-primary', data: { exportCompute: '' }, on: { click: () => resolve(true) } }, 'Compute'), ' ',
                D.el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', data: { exportAbort: '' }, on: { click: () => resolve(false) } }, 'Cancel'));
        });
    }

    function paintProgress() {
        if (!run) return;
        D.clear(status);
        const rows = [];
        for (const [k, h] of run.handles) {
            const snap = h.read();
            const o = run.options.get(k);
            let text = 'waiting';
            if (snap.state === 'ready') text = 'ready';
            else if (snap.state === 'computing' || snap.state === 'queued') {
                const p = snap.progress;
                text = p && p.total > 0 ? `computing, ${fmtCount(p.done)} of ${fmtCount(p.total)} genes` : snap.state === 'queued' ? 'queued' : 'computing';
            } else if (snap.state === 'estimating') text = 'estimating';
            rows.push(`${o.label}: ${text}`);
        }
        status.append(D.el('span', { text: `${rows.join('; ')}. ` }),
            D.el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', data: { exportCancel: '' }, on: { click: () => cancelRun() } }, 'Cancel'));
    }

    async function start() {
        if (run || !kind) return;
        const picks = getOptions().filter(o => ticked().has(key(o)));
        if (!picks.length) { status.textContent = 'Tick at least one combination to export.'; return; }
        const options = new Map(picks.map(o => [key(o), o]));
        run = { handles: new Map(), options, cancelled: false, answer: null };
        go.disabled = true;
        paintList(false);
        const left = [];                 // combinations left out, with the reason
        const slow = [];
        for (const o of picks) {
            if (computed(o)) continue;
            const reply = await scores().sources.estimate(id, { sub: o.method, layer: o.layer }).catch(() => null);
            if (run === null || run.cancelled) return;
            const e = reply && reply.estimate;
            if (e && e.tier === 'refused') { left.push(`${o.label} (would take ${durationText(e.seconds)}, refused)`); options.delete(key(o)); }
            else if (e && e.tier === 'confirm') slow.push({ label: o.label, seconds: e.seconds, key: key(o) });
        }
        if (!options.size) { endRun(); status.textContent = `Nothing to export. Left out: ${left.join('; ')}.`; return; }
        if (slow.length && !(await ask(slow))) { if (run) { endRun(); status.textContent = 'Export cancelled. No file was made.'; } return; }
        if (!run || run.cancelled) return;
        run.answer = null;
        let finished = false;
        const settle = async () => {
            if (finished || !run || run.cancelled) return;
            const snaps = [...run.handles].map(([k, h]) => [k, h.read()]);
            for (const [k, snap] of snaps) {
                if (snap.state === 'awaiting') run.handles.get(k).compute();    // the user said yes above
            }
            if (!snaps.every(([, s]) => (s.state === 'ready' && s.values) || TERMINAL.has(s.state))) { paintProgress(); return; }
            finished = true;
            const ok = snaps.filter(([, s]) => s.state === 'ready' && s.values);
            for (const [k, s] of snaps) if (!(s.state === 'ready' && s.values)) left.push(`${run.options.get(k).label} (${s.message || s.state})`);
            const combos = ok.map(([k]) => run.options.get(k));
            try {
                if (!combos.length) { endRun(); status.textContent = `Nothing to export. Left out: ${left.join('; ')}.`; return; }
                const label = (o) => `${getTitle()} · ${o.label}`;
                let parts;
                if (kind === 'scores') {
                    const names = await getNames();
                    if (run === null || run.cancelled) return;
                    parts = multiScoreCsvParts(names, ok.map(([k, s]) => ({ header: label(run.options.get(k)), values: s.values })), { blobs: true });
                } else {
                    parts = [longGeneCsv(ok.map(([k, s]) => ({ label: label(run.options.get(k)), genes: (s.header && s.header.genes) || [] })))];
                }
                download(exportFileName(getTitle(), kind === 'scores' ? 'scores' : 'genes', combos), parts);
                say(`Exported ${combos.length} combination${combos.length === 1 ? '' : 's'}${kind === 'scores' ? ' per cell' : ''}.${left.length ? ` Left out: ${left.join('; ')}.` : ''}`);
            } finally {
                const had = run !== null;
                if (had) endRun();
                status.textContent = '';
                if (had) element.hidden = true;
                if (had) kind = null;
            }
        };
        for (const [k, o] of options) {
            const h = scores().sources.watch(id, { host: element, role: 'inspect-export', sub: o.method, layer: o.layer,
                visible: () => true, onChange: () => { settle().catch(fail); } });
            run.handles.set(k, h);
        }
        for (const [, h] of run.handles) h.read();
        paintProgress();
        settle().catch(fail);
    }

    return {
        element, open,
        isOpen: () => !element.hidden,
        destroy() { if (run) cancelRun(); }
    };
}
