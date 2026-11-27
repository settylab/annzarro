/**
 * Paste or upload genes, then a preview, then one add. Self-contained: it needs the
 * dataset's gene names and the genes already selected, and hands back the genes to add
 * through onAdd (one call, so the panel makes it one undoable step). Nothing is added
 * before the preview (design 9 and 10.4).
 *
 * The text, or the file, is read and parsed in this browser (gene-paste.js); no request
 * is made.
 *
 *   const paste = mountGenePaste(container, {geneNames, currentGenes, onAdd, onCancel});
 *   paste.focus();  paste.destroy();
 */
import { copyText } from './clipboard.js';
import {
    MAX_FILE_BYTES, MESSAGES, readInput, parseGeneInput, matchGenes, countKnown, idKindOf
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
 * @param {Map<string,string>} [o.idToName] gene id to name, when the dataset has an id column
 * @param {(kind: 'ensembl'|'entrez') => Promise<Map<string,string>|null>} [o.idLookup] loads that map on demand,
 *   only when most pasted names turn out to be ids; null or a rejection keeps the plain mismatch message
 * @param {() => boolean} [o.directions] true when genes can be scored as down: the preview then has "Add as" (Up or Down)
 * @param {Iterable<string>|(() => Iterable<string>)} [o.currentDown] the selected genes that are down (to say how many would change)
 * @param {() => ('up'|'down')} [o.defaultDirection] what "Add as" starts on
 * @param {(genes: string[], info: Object) => void} o.onAdd   `info.direction` is 'up' or 'down'
 * @param {() => void} [o.onCancel]
 */
export function mountGenePaste(container, o) {
    const doc = container.ownerDocument;
    const geneNames = o.geneNames || [];
    const current = () => (typeof o.currentGenes === 'function' ? o.currentGenes() : o.currentGenes) || [];

    let addAs = 'up';                   // "Add as", kept while the preview is re-drawn
    let idMap = o.idToName || null;     // grows when idLookup answers
    const loadedKinds = new Set();
    let epoch = 0;                      // a lookup that answers after the text changed is ignored
    const st = freshState();
    function freshState() {
        return { idTried: {}, idLoading: null, text: '', fileName: '', readAs: 'auto', header: 'auto', column: null, setIndex: 0, signColumn: null, moveAlready: false, matchCase: false, showCase: false, setFilter: '', copied: '' };
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
        epoch++;
        Object.assign(st, freshState(), { text, fileName });
        addAs = o.defaultDirection ? o.defaultDirection() : 'up';
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
            fileName: st.fileName, readAs: st.readAs, header: st.header, column: st.column, setIndex: st.setIndex, score, signColumn: st.signColumn
        });
        const cur = Array.from(current());
        const matchOpts = { geneNames, currentGenes: cur, matchCase: st.matchCase, idToName: idMap };
        const m = matchGenes(parsed.names, matchOpts);
        maybeLookUpIds(m);
        return { parsed, m, matchOpts };
    }

    /** Most names are ids the dataset does not index by: fetch the id column once, then match again. */
    function maybeLookUpIds(m) {
        if (!o.idLookup || o.idToName || st.idLoading) return;
        const kind = idKindOf(m.unmatched, m.total - m.duplicates);
        if (!kind || st.idTried[kind] || loadedKinds.has(kind)) return;
        st.idTried[kind] = true;
        st.idLoading = kind;
        const mine = epoch;
        Promise.resolve().then(() => o.idLookup(kind)).then((map) => map, () => null).then((map) => {
            if (mine !== epoch) return;
            st.idLoading = null;
            if (map && map.size) { idMap = idMap ? new Map([...idMap, ...map]) : map; loadedKinds.add(kind); }
            if (!previewStage.hidden) renderPreview();
        });
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

        if (st.idLoading) previewStage.append(el('div', { class: 'gp-hint gp-loading', role: 'status', 'data-testid': 'gp-loading', text: 'Matching ids…' }));
        previewStage.append(countsBlock(parsed, m));
        if (m.warnings.length) for (const w of st.idLoading ? m.warnings.filter(x => x.code !== 'ensembl' && x.code !== 'entrez') : m.warnings) previewStage.append(el('div', { class: 'gp-note', 'data-code': w.code, text: w.text }));
        if (m.unmatched.length) previewStage.append(unmatchedBlock(m));
        if (m.warnings.length === 0 && !m.toAdd.length && m.matched && m.alreadySelected === m.matched) {
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
            onchange: (e) => { st.header = e.target.checked; st.column = null; st.signColumn = null; renderPreview(); } });
        const signSel = o.directions && o.directions() ? el('select', { class: 'form-select form-select-sm', 'aria-label': 'Sign column', 'data-key': 'signcol', 'data-testid': 'gp-signcol',
            onchange: (e) => { st.signColumn = e.target.value === '' ? null : Number(e.target.value); renderPreview(); } },
        [el('option', { value: '', text: 'None', selected: st.signColumn === null }),
            ...t.columns.map((c, i) => (i === t.column ? null : el('option', { value: String(i), text: c, selected: i === st.signColumn })))]) : null;
        const shownCols = Math.min(t.columns.length, 6);
        const head = el('tr', {}, t.columns.slice(0, shownCols).map((c, i) => el('th', { class: i === t.column ? 'gp-genecol' : '', text: t.header ? c : '' })));
        const body = t.sample.slice(t.header ? 1 : 0).map(r => el('tr', {}, t.columns.slice(0, shownCols).map((_, i) => el('td', { class: i === t.column ? 'gp-genecol' : '', text: r[i] == null ? '' : r[i] }))));
        return el('div', { class: 'gp-table-block' }, [
            el('div', { class: 'gp-controls' }, [
                el('label', {}, ['Gene column ', colSel]),
                signSel ? el('label', { title: 'Positive values go up, negative values go down' }, ['Sign column ', signSel]) : null,
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
            if (!setCounts.has(i)) setCounts.set(i, matchGenes(sets[i].genes, { ...matchOpts, currentGenes: [] }).matched);
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
            if (m.idMatches.length) {
                const ex = m.idMatches[0];
                rows.push(countRow(m.idMatches.length, `matched by id (${ex.input} > ${ex.gene})`, null, 'gp-c-id'));
            }
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

    /** Which side each matched gene would go to: the Add as choice, or the sign of the sign column. */
    function assignment(parsed, m) {
        const on = !!(o.directions && o.directions());
        const matched = [...m.toAdd, ...m.alreadyNames];
        if (!on) return { on, up: matched, down: [], skipped: 0, split: false };
        if (parsed.signs) {
            const up = [], down = [];
            let skipped = 0;
            for (const g of matched) {
                const sign = parsed.signs.get(m.inputOf.get(g));
                if (sign > 0) up.push(g); else if (sign < 0) down.push(g); else skipped++;
            }
            return { on, up, down, skipped, split: true };
        }
        return addAs === 'down' ? { on, up: [], down: matched, skipped: 0, split: false } : { on, up: matched, down: [], skipped: 0, split: false };
    }

    /** How many already selected genes the add would put on the other side. */
    function wouldMove(a) {
        if (!a.on) return 0;
        const down = new Set(typeof o.currentDown === 'function' ? o.currentDown() : o.currentDown || []);
        const have = new Set(current());
        return a.up.filter(g => have.has(g) && down.has(g)).length + a.down.filter(g => have.has(g) && !down.has(g)).length;
    }

    function buttons(parsed, m) {
        const a = assignment(parsed, m);
        const moving = wouldMove(a);
        const newUp = a.up.filter(g => m.toAdd.includes(g)).length, newDown = a.down.filter(g => m.toAdd.includes(g)).length;
        const adding = newUp + newDown;
        const moves = st.moveAlready ? moving : 0;
        const canAdd = (adding > 0 || moves > 0) && !st.idLoading;
        let text = 'Add genes';
        if (canAdd) {
            if (a.split) text = `Add ${plural(adding, 'gene', 'genes')} (${fmt(newUp)} up, ${fmt(newDown)} down)`;
            else if (a.on && addAs === 'down') text = `Add ${fmt(adding)} as down`;
            else text = `Add ${plural(adding, 'gene', 'genes')}`;
        }
        const addBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-testid': 'gp-add', 'data-key': 'add', disabled: !canAdd, text,
            onclick: () => {
                if (!canAdd) return;
                const genes = m.toAdd.slice();
                const info = { count: genes.length, alreadySelected: m.alreadySelected, unmatched: m.unmatched.length, format: parsed.format, fileName: st.fileName,
                    direction: a.on ? addAs : 'up', up: a.up, down: a.down, move: !!st.moveAlready };
                reset();
                o.onAdd(genes, info);
            } });
        const back = el('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm', text: 'Back', 'data-testid': 'gp-back', onclick: () => { showStage('input'); textarea.focus(); } });
        const addAsSel = a.on && !a.split ? el('select', { class: 'form-select form-select-sm gp-addas', 'aria-label': 'Add as', 'data-key': 'addas', 'data-testid': 'gp-addas',
            onchange: (e) => { addAs = e.target.value === 'down' ? 'down' : 'up'; st.moveAlready = false; renderPreview(); } },
        [el('option', { value: 'up', text: 'Up', selected: addAs === 'up' }), el('option', { value: 'down', text: 'Down', selected: addAs === 'down' })]) : null;
        const notes = [];
        if (a.split && a.skipped) notes.push(el('div', { class: 'gp-note', 'data-testid': 'gp-unsigned', text: `${plural(a.skipped, 'gene has', 'genes have')} no sign (blank, zero or not a number) and ${a.skipped === 1 ? 'is' : 'are'} left out.` }));
        if (moving) {
            notes.push(el('label', { class: 'gp-check gp-move', 'data-testid': 'gp-move-row' }, [
                el('input', { type: 'checkbox', checked: st.moveAlready, 'data-key': 'move', 'data-testid': 'gp-move',
                    onchange: (e) => { st.moveAlready = e.target.checked; renderPreview(); } }),
                ` ${plural(moving, 'selected gene would', 'selected genes would')} change direction. Change ${moving === 1 ? 'it' : 'them'} too`]));
        }
        return el('div', { class: 'gp-footer' }, [...notes,
            el('div', { class: 'gp-buttons' }, [addAsSel ? el('label', { class: 'gp-addas-label' }, ['Add as ', addAsSel]) : null, back, addBtn])]);
    }

    function reset() {
        epoch++;
        addAs = o.defaultDirection ? o.defaultDirection() : 'up';
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
