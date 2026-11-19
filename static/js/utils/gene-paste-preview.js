/**
 * Paste or upload genes, then a preview, then one add. Self-contained: it needs the
 * dataset's gene names and the genes already selected, and hands back the genes to add
 * through onAdd (one call, so the panel makes it one undoable step). Nothing is added
 * before the preview, and nothing is added silently over the limit (design 9 and 10.4).
 *
 * The text, or the file, is read and parsed in this browser (gene-paste.js); no request
 * is made.
 *
 *   const paste = mountGenePaste(container, {geneNames, currentGenes, limit, onAdd, onCancel});
 *   paste.focus();  paste.destroy();
 */
import { copyText } from './clipboard.js';
import {
    DEFAULT_LIMIT, MAX_FILE_BYTES, MESSAGES, readInput, parseGeneInput, matchGenes, countKnown
} from './gene-paste.js';

const FORMAT_LABELS = { list: 'Gene list', table: 'Table column', gmt: 'GMT gene sets', grp: 'GRP list' };
const SHOWN_NAMES = 300;
const SHOWN_SETS = 200;

const fmt = (n) => Number(n).toLocaleString('en-GB');
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

/**
 * @param {HTMLElement} container
 * @param {Object} o
 * @param {string[]} o.geneNames the dataset's gene names
 * @param {Iterable<string>|(() => Iterable<string>)} [o.currentGenes] genes already selected (or a function giving them)
 * @param {number} [o.limit]
 * @param {Map<string,string>} [o.idToName] gene id to name, when the dataset has an id column
 * @param {(genes: string[], info: Object) => void} o.onAdd
 * @param {() => void} [o.onCancel]
 */
export function mountGenePaste(container, o) {
    const doc = container.ownerDocument;
    const limit = o.limit || DEFAULT_LIMIT;
    const geneNames = o.geneNames || [];
    const current = () => (typeof o.currentGenes === 'function' ? o.currentGenes() : o.currentGenes) || [];

    const st = freshState();
    function freshState() {
        return { text: '', fileName: '', readAs: 'auto', header: 'auto', column: null, setIndex: 0, matchCase: false, showCase: false, setFilter: '', copied: '' };
    }

    function el(tag, props = {}, kids = []) {
        const n = doc.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (v == null || v === false) continue;
            if (k === 'class') n.className = v;
            else if (k === 'text') n.textContent = v;
            else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
            else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'value') n[k] = v;
            else n.setAttribute(k, v === true ? '' : v);
        }
        for (const c of [].concat(kids)) if (c != null && c !== false) n.append(c.nodeType ? c : doc.createTextNode(String(c)));
        return n;
    }

    // -- shell -------------------------------------------------------------
    const root = el('div', { class: 'gene-paste', role: 'group', 'aria-label': 'Paste or upload genes', 'data-testid': 'gene-paste' });
    const inputStage = el('div', { class: 'gp-input' });
    const previewStage = el('div', { class: 'gp-preview', hidden: true });
    root.append(inputStage, previewStage);
    container.append(root);

    // -- input stage -------------------------------------------------------
    const textarea = el('textarea', {
        class: 'form-control gp-text', rows: 6, spellcheck: 'false', autocomplete: 'off',
        'aria-label': 'Genes to paste', placeholder: 'Paste genes here', 'data-testid': 'gp-text'
    });
    const fileInput = el('input', {
        type: 'file', class: 'gp-file', hidden: true, 'aria-label': 'Gene list file', 'data-testid': 'gp-file',
        accept: '.txt,.csv,.tsv,.gmt,.grp,.list,.text,.xlsx,.xls,text/plain,text/csv,text/tab-separated-values'
    });
    const errorBox = el('div', { class: 'gp-error', role: 'alert', hidden: true, 'data-testid': 'gp-error' });
    const previewBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Preview', disabled: true, 'data-testid': 'gp-preview-btn', onclick: () => fromTextarea() });
    const chooseBtn = el('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm', text: 'Choose file', 'data-testid': 'gp-choose', onclick: () => fileInput.click() });
    const cancelBtn = o.onCancel ? el('button', { type: 'button', class: 'btn btn-link btn-sm gp-cancel', text: 'Cancel', 'data-testid': 'gp-cancel', onclick: () => o.onCancel() }) : null;
    inputStage.append(
        el('div', { class: 'gp-head' }, [el('strong', { text: 'Paste or upload genes' }), cancelBtn]),
        textarea,
        el('div', { class: 'gp-hint', text: 'Any separator: new line, comma, semicolon, tab, space or a mix. Files are read in this browser and never uploaded to the server.' }),
        el('div', { class: 'gp-filerow' }, [chooseBtn, el('span', { class: 'gp-drop', text: 'or drop one here' }), fileInput, previewBtn]),
        el('div', { class: 'gp-hint', text: 'CSV, TSV, TXT, GMT, GRP' }),
        errorBox
    );

    textarea.addEventListener('input', () => { previewBtn.disabled = textarea.value.trim() === ''; showError(''); });
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); fromTextarea(); }
    });
    textarea.addEventListener('paste', (e) => {
        const cd = e.clipboardData;
        const text = cd && cd.getData ? cd.getData('text') : '';
        if (!text) return;      // nothing readable: let the browser do its own thing
        e.preventDefault();
        textarea.value = text;
        previewBtn.disabled = false;
        fromTextarea();
    });
    fileInput.addEventListener('change', () => {
        const f = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (f) fromFile(f);
    });
    root.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && o.onCancel) { e.stopPropagation(); o.onCancel(); }
    });
    let dragDepth = 0;
    root.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; root.classList.add('gp-dragging'); });
    root.addEventListener('dragover', (e) => { e.preventDefault(); });
    root.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; root.classList.remove('gp-dragging'); } });
    root.addEventListener('drop', (e) => {
        e.preventDefault();
        dragDepth = 0;
        root.classList.remove('gp-dragging');
        e.stopPropagation();    // the panel around us also takes drops; this one is ours
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) fromFile(f);
    });

    function showError(msg) {
        errorBox.textContent = msg;
        errorBox.hidden = !msg;
    }

    function fromTextarea() {
        const r = readInput(textarea.value);
        if (!r.ok) { showError(r.message); return; }
        if (r.text.trim() === '') { showError('Nothing to preview. Paste some gene names first.'); return; }
        begin(r.text, '');
    }

    async function fromFile(file) {
        if (file.size > MAX_FILE_BYTES) { showStage('input'); showError(MESSAGES.tooBig); return; }
        let buf;
        try { buf = await file.arrayBuffer(); } catch { showStage('input'); showError('That file could not be read.'); return; }
        const r = readInput(buf, { fileName: file.name });
        if (!r.ok) { showStage('input'); showError(r.message); return; }
        if (r.text.trim() === '') { showStage('input'); showError('That file is empty.'); return; }
        begin(r.text, file.name);
    }

    function begin(text, fileName) {
        Object.assign(st, freshState(), { text, fileName });
        showError('');
        renderPreview();
        showStage('preview');
        const h = previewStage.querySelector('.gp-title');
        if (h) h.focus();
    }

    function showStage(which) {
        inputStage.hidden = which !== 'input';
        previewStage.hidden = which !== 'preview';
    }

    // -- preview -----------------------------------------------------------
    let setCounts = new Map();

    function compute() {
        const score = (values) => countKnown(values, geneNames);
        const parsed = parseGeneInput(st.text, {
            fileName: st.fileName, readAs: st.readAs, header: st.header, column: st.column, setIndex: st.setIndex, score
        });
        const cur = Array.from(current());
        const matchOpts = { geneNames, currentGenes: cur, limit, matchCase: st.matchCase, idToName: o.idToName };
        const m = matchGenes(parsed.names, matchOpts);
        return { parsed, m, matchOpts };
    }

    function renderPreview() {
        const activeKey = doc.activeElement && root.contains(doc.activeElement) ? doc.activeElement.getAttribute('data-key') : null;
        const { parsed, m, matchOpts } = compute();
        previewStage.textContent = '';
        const readAsSel = el('select', { class: 'form-select form-select-sm gp-readas', 'aria-label': 'Read as', 'data-key': 'readas', 'data-testid': 'gp-readas',
            onchange: (e) => { st.readAs = e.target.value; st.header = 'auto'; st.column = null; st.setIndex = 0; st.setFilter = ''; renderPreview(); } },
            Object.entries(FORMAT_LABELS).map(([v, label]) => el('option', { value: v, text: label, selected: v === parsed.format })));
        previewStage.append(el('div', { class: 'gp-head' }, [
            el('strong', { class: 'gp-title', tabindex: '-1', text: 'Preview' }),
            el('label', { class: 'gp-readas-label' }, ['Read as ', readAsSel])
        ]));
        if (st.fileName) previewStage.append(el('div', { class: 'gp-hint', text: `From ${st.fileName}, read in this browser.` }));

        if (parsed.format === 'table' && parsed.table) previewStage.append(tableBlock(parsed));
        if (parsed.format === 'gmt') previewStage.append(gmtBlock(parsed, matchOpts));

        previewStage.append(countsBlock(parsed, m));
        if (m.warnings.length && !m.overLimit) for (const w of m.warnings) previewStage.append(el('div', { class: 'gp-note', 'data-code': w.code, text: w.text }));
        if (m.unmatched.length) previewStage.append(unmatchedBlock(m));
        if (m.overLimit) previewStage.append(overLimitBlock(m));
        else if (m.warnings.length === 0 && !m.toAdd.length && m.matched && m.alreadySelected === m.matched) {
            previewStage.append(el('div', { class: 'gp-note', text: `All ${plural(m.matched, 'matched gene is', 'matched genes are')} already selected.` }));
        }
        previewStage.append(buttons(parsed, m));

        if (activeKey) {
            const again = previewStage.querySelector(`[data-key="${activeKey}"]`);
            if (again) again.focus();
        }
    }

    function tableBlock(parsed) {
        const t = parsed.table;
        const colSel = el('select', { class: 'form-select form-select-sm', 'aria-label': 'Gene column', 'data-key': 'column', 'data-testid': 'gp-column',
            onchange: (e) => { st.column = Number(e.target.value); renderPreview(); } },
            t.columns.map((c, i) => el('option', { value: String(i), text: c, selected: i === t.column })));
        const headerBox = el('input', { type: 'checkbox', checked: t.header, 'data-key': 'header', 'data-testid': 'gp-header',
            onchange: (e) => { st.header = e.target.checked; st.column = null; renderPreview(); } });
        const shownCols = Math.min(t.columns.length, 6);
        const head = el('tr', {}, t.columns.slice(0, shownCols).map((c, i) => el('th', { class: i === t.column ? 'gp-genecol' : '', text: t.header ? c : '' })));
        const body = t.sample.slice(t.header ? 1 : 0).map(r => el('tr', {}, t.columns.slice(0, shownCols).map((_, i) => el('td', { class: i === t.column ? 'gp-genecol' : '', text: r[i] == null ? '' : r[i] }))));
        return el('div', { class: 'gp-table-block' }, [
            el('div', { class: 'gp-controls' }, [
                el('label', {}, ['Gene column ', colSel]),
                el('label', { class: 'gp-check' }, [headerBox, ' Header row'])
            ]),
            el('div', { class: 'gp-sample' }, [el('table', { class: 'table table-sm gp-sample-table', 'aria-label': 'First rows of the table' },
                [t.header ? el('thead', {}, [head]) : null, el('tbody', {}, body)])])
        ]);
    }

    function gmtBlock(parsed, matchOpts) {
        const sets = parsed.sets || [];
        if (!sets.length) return el('div', { class: 'gp-note', text: 'No gene sets found. A GMT line holds a name, a description and then the genes, separated by tabs.' });
        setCounts = new Map();
        const matchedIn = (i) => {
            if (!setCounts.has(i)) setCounts.set(i, matchGenes(sets[i].genes, { ...matchOpts, currentGenes: [], limit: 1e9 }).matched);
            return setCounts.get(i);
        };
        const filter = el('input', { type: 'search', class: 'form-control form-control-sm', placeholder: 'Find a set', 'aria-label': 'Find a set', value: st.setFilter, 'data-key': 'setfilter', 'data-testid': 'gp-setfilter' });
        const list = el('div', { class: 'gp-sets', role: 'radiogroup', 'aria-label': 'Gene sets' });
        const note = el('div', { class: 'gp-hint' });
        const fill = () => {
            list.textContent = '';
            const q = st.setFilter.trim().toLowerCase();
            let shown = 0, hits = 0;
            sets.forEach((s, i) => {
                if (q && !s.name.toLowerCase().includes(q)) return;
                hits++;
                if (shown >= SHOWN_SETS && i !== st.setIndex) return;
                shown++;
                const id = `gp-set-${i}`;
                const radio = el('input', { type: 'radio', name: 'gp-set', id, checked: i === st.setIndex, 'data-testid': 'gp-set',
                    onchange: () => { st.setIndex = i; renderPreview(); } });
                list.append(el('label', { class: 'gp-set', for: id }, [radio, el('span', { class: 'gp-set-name', text: s.name }),
                    el('span', { class: 'gp-set-count', text: `${plural(s.genes.length, 'gene', 'genes')}, ${fmt(matchedIn(i))} matched` })]));
            });
            note.textContent = hits > shown ? `Showing ${fmt(shown)} of ${fmt(hits)}. Type to find a set.` : (hits === 0 ? 'No set has that name.' : '');
        };
        filter.addEventListener('input', () => { st.setFilter = filter.value; fill(); });
        fill();
        return el('div', { class: 'gp-gmt' }, [el('div', { class: 'gp-controls' }, [el('span', { text: plural(sets.length, 'gene set', 'gene sets') }), filter]), list, note]);
    }

    function countRow(n, label, extra, testid) {
        return el('div', { class: 'gp-count', 'data-testid': testid }, [el('span', { class: 'gp-n', text: fmt(n) }), el('span', { class: 'gp-label', text: label }), extra]);
    }

    function countsBlock(parsed, m) {
        const rows = [];
        if (!m.total) {
            rows.push(el('div', { class: 'gp-note', 'data-testid': 'gp-none', text: parsed.format === 'table'
                ? 'No gene names in that column. Pick another column, or tick or untick Header row.'
                : 'No gene names found.' }));
        } else {
            rows.push(countRow(m.toAdd.length, 'will be added', null, 'gp-c-add'));
            if (m.alreadySelected) rows.push(countRow(m.alreadySelected, 'already selected', null, 'gp-c-already'));
            if (m.duplicates) rows.push(countRow(m.duplicates, 'duplicates in the list (ignored)', null, 'gp-c-dups'));
            if (m.caseMatches.length) {
                const first = m.caseMatches[0];
                const show = el('button', { type: 'button', class: 'btn btn-link btn-sm gp-show', 'aria-expanded': String(st.showCase), 'data-key': 'showcase', 'data-testid': 'gp-showcase',
                    text: st.showCase ? 'Hide' : 'Show', onclick: () => { st.showCase = !st.showCase; renderPreview(); } });
                rows.push(countRow(m.caseMatches.length, `matched ignoring case (${first.input} > ${first.gene})`, show, 'gp-c-case'));
                if (st.showCase) {
                    rows.push(el('ul', { class: 'gp-casemap', 'data-testid': 'gp-casemap' },
                        m.caseMatches.slice(0, SHOWN_NAMES).map(c => el('li', { text: `${c.input} > ${c.gene}` }))));
                }
            }
            if (m.idMatches.length) rows.push(countRow(m.idMatches.length, 'matched by id', null, 'gp-c-id'));
            if (m.unmatched.length) rows.push(countRow(m.unmatched.length, 'not in this dataset', null, 'gp-c-unmatched'));
        }
        const matchCase = el('label', { class: 'gp-check gp-matchcase' }, [
            el('input', { type: 'checkbox', checked: st.matchCase, 'data-key': 'matchcase', 'data-testid': 'gp-matchcase', onchange: (e) => { st.matchCase = e.target.checked; renderPreview(); } }),
            ' Match case']);
        return el('div', { class: 'gp-counts', role: 'status', 'aria-live': 'polite', 'data-testid': 'gp-counts' }, [...rows, m.total ? matchCase : null]);
    }

    function copyButton(label, names, key) {
        const done = st.copied === key;
        return el('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm', 'data-key': key, 'data-testid': key,
            text: done ? 'Copied' : label,
            onclick: () => {
                copyText(names.join('\n')).then((ok) => {
                    st.copied = ok ? key : '';
                    renderPreview();
                    if (ok) setTimeout(() => { if (st.copied === key) { st.copied = ''; if (!previewStage.hidden) renderPreview(); } }, 1800);
                });
            } });
    }

    function unmatchedBlock(m) {
        const names = m.unmatched;
        const more = names.length > SHOWN_NAMES ? el('span', { class: 'gp-more', text: ` and ${fmt(names.length - SHOWN_NAMES)} more` }) : null;
        return el('div', { class: 'gp-unmatched', 'data-testid': 'gp-unmatched' }, [
            el('div', { class: 'gp-head' }, [el('strong', { text: 'Not in this dataset' }), copyButton(`Copy ${plural(names.length, 'name', 'names')}`, names, 'gp-copy-unmatched')]),
            el('div', { class: 'gp-names', 'data-testid': 'gp-unmatched-names', text: names.slice(0, SHOWN_NAMES).join('  ') }, more ? [more] : [])
        ]);
    }

    function overLimitBlock(m) {
        const parts = [`A signature holds up to ${fmt(limit)} genes. Nothing was added.`];
        if (m.resulting !== m.toAdd.length) parts.push(`${fmt(m.toAdd.length)} new genes on top of ${fmt(m.resulting - m.toAdd.length)} selected would make ${fmt(m.resulting)}.`);
        parts.push('Shorten the list and try again.');
        return el('div', { class: 'gp-over', role: 'alert', 'data-testid': 'gp-over' }, [
            el('div', { class: 'gp-over-count', text: `${fmt(m.toAdd.length)} genes matched` }),
            el('div', { text: parts.join(' ') }),
            copyButton('Copy matched names', m.toAdd, 'gp-copy-matched')
        ]);
    }

    function buttons(parsed, m) {
        const canAdd = !m.overLimit && m.toAdd.length > 0;
        const addBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-testid': 'gp-add', 'data-key': 'add', disabled: !canAdd,
            text: canAdd ? `Add ${plural(m.toAdd.length, 'gene', 'genes')}` : 'Add genes',
            onclick: () => {
                if (!canAdd) return;
                const genes = m.toAdd.slice();
                const info = { count: genes.length, alreadySelected: m.alreadySelected, unmatched: m.unmatched.length, format: parsed.format, fileName: st.fileName };
                reset();
                o.onAdd(genes, info);
            } });
        const back = el('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm', text: 'Back', 'data-testid': 'gp-back', onclick: () => { showStage('input'); textarea.focus(); } });
        return el('div', { class: 'gp-buttons' }, [back, addBtn]);
    }

    function reset() {
        Object.assign(st, freshState());
        textarea.value = '';
        previewBtn.disabled = true;
        showError('');
        previewStage.textContent = '';
        showStage('input');
    }

    return {
        element: root,
        /** Focus the text area (the input stage), or the preview heading. */
        focus() {
            if (!previewStage.hidden) { const h = previewStage.querySelector('.gp-title'); if (h) h.focus(); } else textarea.focus();
        },
        /** Start from text, as if pasted (also for tests and for a paste handled elsewhere). */
        setText(text, fileName = '') {
            const r = readInput(text);
            if (!r.ok) { showStage('input'); showError(r.message); return; }
            textarea.value = r.text;
            previewBtn.disabled = r.text.trim() === '';
            if (r.text.trim() === '') { showStage('input'); return; }
            begin(r.text, fileName);
        },
        /** Read a file as if it had been chosen or dropped. */
        loadFile(file) { return fromFile(file); },
        reset,
        destroy() { root.remove(); }
    };
}
