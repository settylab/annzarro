/**
 * Typeahead for the header's Focused Cell / Focused Gene pickers.
 *
 * The pickers used to be <select> elements filled with every obs/var name.
 * At 75k names that cost ~3 s of a frozen tab at boot; at a million cells it
 * is a 15 MB download and ~15 s. This picker never holds the list: each
 * keystroke (debounced) asks the server's /data/names endpoint for at most
 * `limit` matches, and only those are rendered.
 *
 * Two layers, so the behaviour can be tested in Node without a DOM:
 *   NameSearchModel  query -> results state machine. A slow answer to an old
 *                    query never overwrites the answer to a newer one.
 *   mountNamePicker  binds a model to an <input>, a dropdown and the keyboard.
 */

/**
 * Ask the server for names matching `query`.
 * @param {string} url - the /data/names endpoint
 * @param {{datasetPath:string, entity:'cells'|'genes', query:string,
 *          mode?:string, limit?:number, signal?:AbortSignal, subset?:string|null,
 *          scope?:'subset'|'dataset'}} opts
 *   subset: the cell subset parameter in effect; indices are positions in it.
 *   scope: 'subset' (default) matches only the cells it shows; 'dataset'
 *   matches every cell, with index null for one the subset does not show
 * @returns {Promise<{matches:Array<{name:string,index:number|null,row:number}>, truncated:boolean, total:number}>}
 */
export async function fetchNameMatches(url, { datasetPath, entity, query, mode = 'substring', limit = 50, signal = null, subset = null, scope = 'subset' }) {
    const params = new URLSearchParams({ dataset_path: datasetPath, entity, q: query, mode, limit: String(limit) });
    if (subset && entity === 'cells') params.set('subset', subset);
    if (subset && entity === 'cells' && scope === 'dataset') params.set('scope', 'dataset');
    const resp = await fetch(`${url}?${params}`, { signal });
    let body;
    try { body = await resp.json(); } catch { body = null; }
    if (!resp.ok) {
        const err = new Error((body && body.error) || `Name search failed (${resp.status})`);
        err.status = resp.status;
        throw err;
    }
    return body;
}

/**
 * The cells a subset shows first, then the dataset's other matches, each
 * marked `outside` (not shown). Every match appears once (by dataset row,
 * or by name from an older server), and at most `limit` are kept.
 * @param {{matches:Array, truncated:boolean}} shown - a subset-scoped reply
 * @param {{matches:Array, truncated:boolean}} all - a dataset-scoped reply
 * @param {number} limit
 */
export function mergeScopedMatches(shown, all, limit) {
    const seen = new Set();
    const id = m => (typeof m.row === 'number' ? `#${m.row}` : `=${m.name}`);
    const out = [];
    for (const m of (shown && shown.matches) || []) {
        seen.add(id(m));
        out.push(m);
    }
    let dropped = false;
    for (const m of (all && all.matches) || []) {
        if (seen.has(id(m)) || m.index !== null) continue;
        if (out.length >= limit) { dropped = true; break; }
        seen.add(id(m));
        out.push({ ...m, outside: true });
    }
    return { matches: out.slice(0, limit),
             truncated: !!((shown && shown.truncated) || (all && all.truncated) || dropped || out.length > limit) };
}

export class NameSearchModel {
    /**
     * @param {(query:string, opts:{regex:boolean, signal:AbortSignal|null}) => Promise<{matches:Array, truncated:boolean}>} search
     */
    constructor(search) {
        this._search = search;
        this._seq = 0;
        this._abort = null;
        this.items = [];
        this.truncated = false;
        this.error = null;
        this.highlighted = -1;
        this.query = '';
        this.regex = false;
        this.onUpdate = null;   // called when later results replace the list
    }

    /** Run a query; resolves to true if its results became the current state. */
    async setQuery(query, { regex = this.regex } = {}) {
        this.query = query;
        this.regex = regex;
        const seq = ++this._seq;
        if (this._abort) this._abort.abort();
        this._abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
        let result;
        try {
            result = await this._search(query, { regex, signal: this._abort ? this._abort.signal : null });
        } catch (error) {
            if (seq !== this._seq) return false;
            if (error && error.name === 'AbortError') return false;
            this.items = [];
            this.truncated = false;
            this.highlighted = -1;
            this.error = error && error.message ? error.message : String(error);
            return true;
        }
        if (seq !== this._seq) return false;   // a newer query is in flight or done
        this.items = (result && result.matches) || [];
        this.truncated = !!(result && result.truncated);
        this.error = null;
        this.highlighted = this.items.length ? 0 : -1;
        if (result && result.more) this._extend(seq, result.more);
        return true;
    }

    /**
     * Results that arrive later for the same query (the cells a subset does
     * not show, from a slower dataset-wide search): replace the list, keep
     * the highlighted name, and call onUpdate.
     * @private
     */
    _extend(seq, more) {
        Promise.resolve(more).then(result => {
            if (seq !== this._seq || !result) return;
            const current = this.current();
            this.items = result.matches || [];
            this.truncated = !!result.truncated;
            const keep = current ? this.items.findIndex(m => m.name === current.name) : -1;
            this.highlighted = keep >= 0 ? keep : (this.items.length ? 0 : -1);
            if (this.onUpdate) this.onUpdate();
        }, () => {});   // the shown cells' matches stand on their own
    }

    move(delta) {
        if (!this.items.length) return;
        const n = this.items.length;
        this.highlighted = ((this.highlighted < 0 ? (delta > 0 ? -1 : 0) : this.highlighted) + delta + n) % n;
    }

    current() {
        return this.highlighted >= 0 ? this.items[this.highlighted] : null;
    }

    reset() {
        this._seq++;
        if (this._abort) this._abort.abort();
        this._abort = null;
        this.items = [];
        this.truncated = false;
        this.error = null;
        this.highlighted = -1;
        this.query = '';
    }
}

let _pickerCount = 0;

/**
 * Turn `input` into a server-backed typeahead.
 * @param {Object} opts
 * @param {HTMLInputElement} opts.input
 * @param {string} opts.noun - 'cell' or 'gene', for messages
 * @param {(query:string, opts:{regex:boolean, signal:AbortSignal|null}) => Promise} opts.search
 * @param {(name:string, item:Object) => void} opts.onPick - called with the chosen name
 *   and its match ({name, index, row, outside?})
 * @param {number} [opts.debounceMs=120]
 * @returns {{setValue:(name:string|null)=>void, reset:()=>void, model:NameSearchModel, close:()=>void}}
 */
export function mountNamePicker({ input, noun, search, onPick, debounceMs = 120 }) {
    const doc = input.ownerDocument;
    const model = new NameSearchModel(search);
    const id = `name-picker-${++_pickerCount}`;
    let committed = input.value || '';
    let timer = null;
    let open = false;

    model.onUpdate = () => { if (open) render(); };
    const wrapper = input.parentElement;
    wrapper.classList.add('name-picker');

    const menu = doc.createElement('div');
    menu.className = 'name-picker-menu';
    menu.hidden = true;

    const toolbar = doc.createElement('div');
    toolbar.className = 'name-picker-toolbar';
    const status = doc.createElement('span');
    status.className = 'name-picker-status';
    const regexBtn = doc.createElement('button');
    regexBtn.type = 'button';
    regexBtn.className = 'btn btn-sm btn-outline-secondary name-picker-regex';
    regexBtn.textContent = '.*';
    regexBtn.title = 'Regular expression search';
    regexBtn.setAttribute('aria-pressed', 'false');
    toolbar.append(status, regexBtn);

    const list = doc.createElement('ul');
    list.className = 'name-picker-list';
    list.id = `${id}-list`;
    list.setAttribute('role', 'listbox');
    menu.append(toolbar, list);
    wrapper.appendChild(menu);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', list.id);
    input.autocomplete = 'off';
    input.spellcheck = false;

    function render() {
        list.textContent = '';
        model.items.forEach((item, i) => {
            const li = doc.createElement('li');
            li.id = `${id}-opt-${i}`;
            li.className = 'name-picker-option' + (i === model.highlighted ? ' active' : '')
                + (item.name === committed ? ' selected' : '');
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', i === model.highlighted ? 'true' : 'false');
            li.textContent = item.name;
            li.title = item.name;
            if (item.outside) {
                // in the dataset, but not among the cells shown
                li.classList.add('outside');
                const tag = doc.createElement('span');
                tag.className = 'name-picker-tag';
                tag.textContent = 'not shown';
                li.appendChild(tag);
                li.title = `${item.name} (not among the shown cells)`;
            }
            li.dataset.index = String(i);
            list.appendChild(li);
        });
        if (model.highlighted >= 0) {
            input.setAttribute('aria-activedescendant', `${id}-opt-${model.highlighted}`);
            const active = list.children[model.highlighted];
            if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
        } else {
            input.removeAttribute('aria-activedescendant');
        }
        if (model.error) {
            status.textContent = model.error;
            status.classList.add('text-danger');
        } else {
            status.classList.remove('text-danger');
            const n = model.items.length;
            status.textContent = n === 0
                ? (model.query ? `No ${noun} matches` : '')
                : model.truncated ? `First ${n} matches, keep typing to narrow` : `${n} match${n === 1 ? '' : 'es'}`;
        }
    }

    function show() {
        open = true;
        menu.hidden = false;
        input.setAttribute('aria-expanded', 'true');
    }

    function close() {
        open = false;
        menu.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        clearTimeout(timer);
        timer = null;
    }

    // The latest query's promise, so Enter can wait for the answer to what
    // was actually typed rather than pick from an older result list.
    let latest = Promise.resolve(true);

    function runQuery(query) {
        const run = model.setQuery(query);
        latest = run;
        run.then(applied => { if (applied) render(); });
        return run;
    }

    function schedule(query) {
        clearTimeout(timer);
        timer = setTimeout(() => { timer = null; runQuery(query); }, debounceMs);
    }

    function pick(item) {
        if (!item) return;
        committed = item.name;
        input.value = item.name;
        close();
        onPick(item.name, item);
    }

    // Focusing the box, or clicking it again after a pick (it keeps focus),
    // selects the shown name so typing replaces it, and lists the first names.
    const openFresh = () => {
        input.select();
        show();
        runQuery('');
    };
    input.addEventListener('focus', openFresh);
    input.addEventListener('click', () => { if (!open) openFresh(); });
    input.addEventListener('input', () => {
        show();
        schedule(input.value);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) { show(); runQuery(input.value === committed ? '' : input.value); return; }
            model.move(e.key === 'ArrowDown' ? 1 : -1);
            render();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            // Enter right after typing: the debounce may not have fired, or
            // its answer may still be in flight. Pick from the answer to the
            // text in the box, never from an older list.
            const run = timer ? runQuery(input.value) : latest;
            clearTimeout(timer);
            timer = null;
            run.finally(() => {
                if (run === latest) pick(model.current());
            });
        } else if (e.key === 'Escape') {
            e.preventDefault();
            input.value = committed;
            close();
            input.blur();
        }
    });
    input.addEventListener('blur', () => {
        // mousedown on an option fires before blur; keep the menu for it
        setTimeout(() => {
            if (doc.activeElement === input || menu.contains(doc.activeElement)) return;
            input.value = committed;
            close();
        }, 150);
    });
    list.addEventListener('mousedown', (e) => {
        const li = e.target.closest ? e.target.closest('.name-picker-option') : null;
        if (!li) return;
        e.preventDefault();
        pick(model.items[Number(li.dataset.index)]);
    });
    regexBtn.addEventListener('mousedown', (e) => e.preventDefault());
    regexBtn.addEventListener('click', () => {
        model.regex = !model.regex;
        regexBtn.classList.toggle('active', model.regex);
        regexBtn.setAttribute('aria-pressed', String(model.regex));
        input.focus();
        runQuery(input.value === committed ? '' : input.value);
    });

    return {
        model,
        close,
        /** Show the focused name without opening the menu or calling onPick. */
        setValue(name) {
            committed = name || '';
            // Leave the text alone only while the user is typing in an open
            // menu. After a pick the box keeps keyboard focus with its menu
            // closed, and a plot click's new focus used to stay unshown.
            if (doc.activeElement !== input || !open) input.value = committed;
        },
        /** Forget results (dataset switched). */
        reset() {
            model.reset();
            render();
            close();
        }
    };
}
