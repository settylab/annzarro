/**
 * Search in the dataset information dialog's Structure tab.
 *
 * `createMatcher` is pure: a query (substring or regular expression, with or without case) becomes a
 * function that returns the ranges of a text that match. A pattern is never trusted: it is cut at
 * MAX_PATTERN characters, texts at MAX_TEXT, a nested repeat such as `(a+)+` is refused, and a
 * search that runs past BUDGET_MS between two items stops ("pattern too slow"). A single regular
 * expression run cannot be interrupted in JavaScript, so the first three keep one run small.
 *
 * `mountStructureSearch` draws the search box and filters the elements `drawStructure` indexed: it
 * hides what does not match, keeps the path to a nested match, opens the sections that hold
 * matches, counts them, and marks the matched text with `<mark>` built from text nodes.
 */
export const MAX_PATTERN = 200;
export const MAX_TEXT = 500;
export const MAX_RANGES = 50;
export const BUDGET_MS = 50;
export const STORAGE_KEY = 'annzarro.structure-search';

const NESTED_REPEAT = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d+,\d*\})/;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} query
 * @param {{regex?: boolean, matchCase?: boolean}} options
 * @param {{now?: () => number, budget?: number}} clock
 * @returns {{ok: boolean, error?: string, empty?: boolean, timedOut?: boolean, find?: (text: string) => number[][]}}
 *   `find(text)` is the `[start, end)` ranges of the matches (empty ranges are dropped); once the time budget is spent
 *   it returns none and `timedOut` is true.
 */
export function createMatcher(query, { regex = false, matchCase = false } = {}, { now = () => performance.now(), budget = BUDGET_MS } = {}) {
    const text = String(query === undefined || query === null ? '' : query);
    if (!text) return { ok: true, empty: true, timedOut: false, find: () => [] };
    if (text.length > MAX_PATTERN) return { ok: false, error: `The search is limited to ${MAX_PATTERN} characters.` };
    if (regex && NESTED_REPEAT.test(text)) return { ok: false, error: 'Pattern too slow: a repeat inside a repeat is not searched.' };
    let re;
    try {
        re = new RegExp(regex ? text : escapeRegex(text), matchCase ? 'gu' : 'giu');
    } catch {
        try {
            re = new RegExp(regex ? text : escapeRegex(text), matchCase ? 'g' : 'gi');     // without u: more patterns are valid
        } catch (second) {
            return { ok: false, error: `Invalid pattern: ${String((second && second.message) || second).replace(/^Invalid regular expression:\s*/i, '')}` };
        }
    }
    const started = now();
    const matcher = {
        ok: true,
        empty: false,
        timedOut: false,
        find(value) {
            if (matcher.timedOut) return [];
            if (now() - started > budget) { matcher.timedOut = true; return []; }
            const source = String(value === undefined || value === null ? '' : value).slice(0, MAX_TEXT);
            const ranges = [];
            re.lastIndex = 0;
            let m;
            while (ranges.length < MAX_RANGES && (m = re.exec(source)) !== null) {
                if (m[0] === '') { re.lastIndex += 1; if (re.lastIndex > source.length) break; continue; }
                ranges.push([m.index, m.index + m[0].length]);
            }
            return ranges;
        }
    };
    return matcher;
}

/** `text` as text nodes with a `<mark>` around each of `ranges` (sorted, not overlapping). Never markup. */
export function highlight(doc, text, ranges) {
    const fragment = doc.createDocumentFragment();
    let at = 0;
    for (const [start, end] of ranges) {
        if (start < at || end <= start) continue;
        if (start > at) fragment.appendChild(doc.createTextNode(text.slice(at, start)));
        const mark = doc.createElement('mark');
        mark.className = 'dsi-mark';
        mark.appendChild(doc.createTextNode(text.slice(start, end)));
        fragment.appendChild(mark);
        at = end;
    }
    if (at < text.length) fragment.appendChild(doc.createTextNode(text.slice(at)));
    return fragment;
}

export const matchesWord = (n) => `${Number(n).toLocaleString('en-US')} ${n === 1 ? 'match' : 'matches'}`;

function readOptions(storage) {
    try {
        const saved = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
        return { regex: saved.regex === true, matchCase: saved.matchCase === true };
    } catch {
        return { regex: false, matchCase: false };
    }
}

function writeOptions(storage, options) {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(options)); } catch { /* storage may be blocked */ }
}

const controllers = new WeakMap();

/**
 * Draw the search box at the top of `container` and filter `index` as the user types.
 * @param {Element} container the Structure pane's body
 * @param {Array<{details: Element, open: boolean, items: Array<{rows: Element[], fields: {el: Element, text: string}[], path?: string, parent?: Object}>}>} index
 *   the sections, each with its items; an item is hidden unless it, or something under it, matches
 * @param {{storage?: Storage, delay?: number, now?: () => number, partial?: boolean}} [options]
 */
export function mountStructureSearch(container, index, { storage = null, delay = 120, now, partial = false } = {}) {
    const doc = container.ownerDocument;
    let store = storage;
    if (!store) { try { store = doc.defaultView.localStorage; } catch { store = null; } }
    const memory = { getItem: () => null, setItem: () => {} };
    const keep = store || memory;
    const options = readOptions(keep);
    const make = (tag, className, text) => {
        const node = doc.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    };

    const bar = make('div', 'dsi-search');
    bar.setAttribute('role', 'search');
    const inputId = `dsi-search-${Math.random().toString(36).slice(2, 8)}`;
    const label = make('label', 'visually-hidden', 'Search the structure');
    label.htmlFor = inputId;
    const input = make('input', 'form-control form-control-sm dsi-search-input');
    input.id = inputId;
    input.type = 'search';
    input.placeholder = 'Search columns, keys, labels and types';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = MAX_PATTERN;
    const toggle = (text, title, key) => {
        const b = make('button', 'btn btn-sm btn-outline-secondary dsi-search-toggle', text);
        b.type = 'button';
        b.title = title;
        b.setAttribute('aria-label', title);
        b.setAttribute('aria-pressed', String(options[key]));
        b.addEventListener('click', () => {
            options[key] = !options[key];
            b.setAttribute('aria-pressed', String(options[key]));
            writeOptions(keep, options);
            run(true);
        });
        return b;
    };
    const regexButton = toggle('.*', 'Regular expression', 'regex');
    regexButton.dataset.toggle = 'regex';
    const caseButton = toggle('Aa', 'Match case', 'matchCase');
    caseButton.dataset.toggle = 'case';
    const row = make('div', 'dsi-search-row');
    row.append(input, regexButton, caseButton);
    const status = make('span', 'dsi-search-status dsi-muted');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const problem = make('span', 'dsi-search-error');
    problem.setAttribute('aria-live', 'polite');
    problem.hidden = true;
    const notes = make('div', 'dsi-search-notes');
    notes.append(status, problem);
    bar.append(label, row, notes);
    container.insertBefore(bar, container.firstChild);

    let shown = false;                  // whether a filter is applied
    const badges = [];
    function restore() {
        for (const b of badges.splice(0)) b.remove();
        for (const section of index) {
            section.details.hidden = false;
            section.details.open = section.open;
            for (const item of section.items) {
                for (const r of item.rows) r.hidden = false;
                for (const f of item.fields) if (f.marked) { f.el.textContent = f.text; f.marked = false; }
            }
        }
        shown = false;
    }

    function apply(matcher) {
        const result = [];
        for (const section of index) {
            let hits = 0;
            for (const item of section.items) {
                item.counted = false;
                item.kept = false;
                item.ranges = [];
                if (matcher.timedOut) break;
                for (const f of item.fields) item.ranges.push(matcher.find(f.text));
                const own = item.ranges.some((r) => r.length);
                const pathHit = item.path !== undefined && matcher.find(item.path).length > 0;
                item.pathHit = pathHit;
                item.counted = own || (pathHit && !(item.parent && item.parent.pathHit));
                item.kept = own || pathHit;
                if (item.counted) hits += 1;
            }
            result.push(hits);
            if (matcher.timedOut) return null;
        }
        // an item stays when something under it matches, so the path to a nested match shows
        for (const section of index) {
            for (let i = section.items.length - 1; i >= 0; i -= 1) {
                const item = section.items[i];
                if (item.kept && item.parent) item.parent.kept = true;
            }
        }
        return result;
    }

    function render(matcher) {
        const hits = apply(matcher);
        if (hits === null) {                       // too slow: show everything and say so
            restore();
            status.textContent = 'Search stopped: pattern too slow.';
            return;
        }
        restore();
        shown = true;
        let total = 0;
        index.forEach((section, n) => {
            const count = hits[n];
            total += count;
            const visible = section.items.some((item) => item.kept);
            section.details.hidden = !visible;
            if (!visible) return;
            section.details.open = true;
            const badge = make('span', 'dsi-hits', ` · ${matchesWord(count)}`);
            section.details.querySelector('summary').appendChild(badge);
            badges.push(badge);
            for (const item of section.items) {
                for (const r of item.rows) r.hidden = !item.kept;
                item.fields.forEach((f, i) => {
                    if (!item.ranges[i].length) return;
                    f.el.textContent = '';
                    f.el.appendChild(highlight(doc, f.text, item.ranges[i]));
                    f.marked = true;
                });
            }
        });
        status.textContent = total ? `${matchesWord(total)}${partial ? ' (listed items only)' : ''}` : 'No matches';
    }

    function run() {
        const query = input.value;
        const matcher = createMatcher(query, options, now ? { now } : undefined);
        if (!matcher.ok) {                         // keep the last valid result on screen
            problem.textContent = matcher.error;
            problem.hidden = false;
            input.setAttribute('aria-invalid', 'true');
            return;
        }
        problem.hidden = true;
        problem.textContent = '';
        input.removeAttribute('aria-invalid');
        if (matcher.empty) {
            if (shown) restore();
            status.textContent = '';
            return;
        }
        render(matcher);
    }

    let timer = null;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(run, delay);
    });
    const clear = () => {
        clearTimeout(timer);
        input.value = '';
        run();
    };

    const previous = controllers.get(container);
    if (previous) previous.abort();
    const controller = new AbortController();
    controllers.set(container, controller);
    const { signal } = controller;
    container.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && (input.value || !problem.hidden)) {
            event.preventDefault();
            event.stopPropagation();                // the first Escape clears; the dialog stays open
            clear();
            input.focus();
        }
    }, { signal });
    const scope = (container.closest && container.closest('.modal')) || container;
    scope.addEventListener('keydown', (event) => {
        const visible = container.getClientRects().length > 0;
        if (!visible) return;
        const typing = event.target && /^(?:input|textarea|select)$/i.test(event.target.tagName || '');
        const find = (event.ctrlKey || event.metaKey) && !event.altKey && String(event.key).toLowerCase() === 'f';
        if (find || (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey)) {
            event.preventDefault();
            input.focus();
            input.select();
        }
    }, { signal });
    return { input, run, clear };
}
