/**
 * Cell names that stay on the server.
 *
 * A dataset of very many cells does not download the names of the cells it
 * shows, whatever the subset (see DataManager.loadCells for when). On real
 * Tahoe data the /cells JSON took 19 of the 23 s before a 50M-cell plot
 * appeared; on a 1B-cell store the 100,000 names of one part cost 477 chunk
 * reads (23.6 GB decompressed, 20-35 s) at every part step, because a random
 * sample of cells touches every chunk of obs/_index. What needs a name asks
 * the server for the names it needs, which reads only their chunks:
 *
 *   nameAt(i)      the name of cell i (/data/obs?columns=_index&rows=i)
 *   ensure([i..])  the names of these cells, in one request
 *   resolve(name)  its index, or -1 (/data/names, exact match)
 *   all()          every name, once (/data/cells); only for what cannot do
 *                  without them: a search or sort on the names in a table, a
 *                  CSV export, a table filter closed over names.
 *
 * All are cached. The synchronous array-like API (`length`, `[i]`, `at`,
 * `indexOf`, `includes`) answers from that cache, so code written for a name
 * array keeps working for the names it has seen; `[i]` of a name not fetched
 * yet is undefined. Walking every name (iteration, map, filter, slice) throws
 * until `all()` has loaded them: saying so beats a frozen tab.
 *
 * Panels that draw many cells at once identify a cell by a TOKEN, a string
 * that stands for "the cell at position i" (`tokens()`): the tokens are as
 * stable across sorting, filtering and splitting into traces as names are,
 * and need no download. The panel shows the name once it is cached
 * (`peek`) and asks for it when the cell is hovered, clicked or on a table
 * page. Tokens never leave the browser: a link, a panel set and the focus
 * carry names.
 */

/** A token is this character followed by the position: no real name starts with it. */
const TOKEN_MARK = '⁣';

export class RemoteNames {
    /**
     * @param {number} length  cells
     * @param {(indices: number[]) => Promise<string[]>} fetchNames
     * @param {(name: string) => Promise<number>} lookup  index or -1
     * @param {Object} [options]
     * @param {(() => Promise<ArrayLike<string>>)|null} [options.fetchAll]  every name
     *   (omitted: `all()` refuses, as above the large-plot threshold)
     */
    constructor(length, fetchNames, lookup, { fetchAll = null } = {}) {
        this.length = length;
        this._fetchNames = fetchNames;
        this._lookup = lookup;
        this._fetchAll = fetchAll;
        this._nameOf = new Map();    // index -> name
        this._indexOf = new Map();   // name -> index (-1: not in the dataset)
        this._pending = new Map();   // index -> promise of the name, while it is asked for
        this._full = null;           // every name, once all() has them
        this._fullLoading = null;
        this._tokens = null;
    }

    /** Whether `s` is a token made by `tokens()` / `tokenAt()`. */
    static isToken(s) {
        return typeof s === 'string' && s.charCodeAt(0) === 0x2063 && /^⁣\d+$/.test(s);
    }

    /** The position a token stands for. */
    static tokenIndex(s) {
        return Number(s.slice(1));
    }

    tokenAt(i) {
        return TOKEN_MARK + i;
    }

    /** One token per cell, in order. Built once (a short string per cell). */
    tokens() {
        if (!this._tokens) {
            const out = new Array(this.length);
            for (let i = 0; i < out.length; i++) out[i] = TOKEN_MARK + i;
            this._tokens = out;
        }
        return this._tokens;
    }

    /** The token of the cell named `name`, if its position is known; else null. */
    tokenOf(name) {
        const i = this.indexOf(name);
        return i >= 0 ? this.tokenAt(i) : null;
    }

    /** Record a name/index pair learned elsewhere (e.g. a name search result). */
    remember(name, index) {
        if (typeof name !== 'string' || !(index >= 0 && index < this.length)) return;
        this._nameOf.set(index, name);
        this._indexOf.set(name, index);
    }

    /** True once every name is in the browser (all()). */
    get allLoaded() {
        return this._full !== null;
    }

    /** Whether all() can fetch every name (not for the very large, large-plot sets). */
    get canLoadAll() {
        return this._full !== null || typeof this._fetchAll === 'function';
    }

    at(i) {
        if (i < 0) i += this.length;
        if (this._full) return typeof this._full.at === 'function' ? this._full.at(i) : this._full[i];
        return this._nameOf.get(i);
    }

    /** The name of cell `i` if it is in the browser, else undefined. */
    peek(i) {
        return this.at(i);
    }

    indexOf(name) {
        const i = this._indexOf.get(name);
        return i === undefined ? -1 : i;
    }

    includes(name) { return this.indexOf(name) >= 0; }

    /**
     * The names of these cells, fetched together (missing ones only, at most
     * `BATCH` to a request).
     * @param {Iterable<number>} indices
     * @returns {Promise<void>}
     */
    async ensure(indices) {
        const wanted = [];
        const waiting = [];
        for (const i of new Set(indices)) {
            if (!(i >= 0 && i < this.length) || this.at(i) !== undefined) continue;
            if (this._pending.has(i)) waiting.push(this._pending.get(i));
            else wanted.push(i);
        }
        for (let a = 0; a < wanted.length; a += BATCH) {
            const part = wanted.slice(a, a + BATCH);
            const request = this._fetchNames(part).then(names => {
                part.forEach((i, k) => { if (typeof names[k] === 'string') this.remember(names[k], i); });
            }).finally(() => { for (const i of part) this._pending.delete(i); });
            request.catch(() => {});
            for (const i of part) this._pending.set(i, request);
            waiting.push(request);
        }
        await Promise.all(waiting);
    }

    async nameAt(i) {
        if (!(i >= 0 && i < this.length)) return undefined;
        if (this.at(i) === undefined) await this.ensure([i]);
        return this.at(i);
    }

    async resolve(name) {
        if (typeof name !== 'string' || !name) return -1;
        if (this._full && !this._indexOf.has(name)) {
            // every name is here: no server lookup
            const i = this._full.indexOf ? this._full.indexOf(name) : Array.prototype.indexOf.call(this._full, name);
            this._indexOf.set(name, i);
        }
        if (!this._indexOf.has(name)) {
            const index = await this._lookup(name);
            if (index >= 0) this.remember(name, index);
            else this._indexOf.set(name, -1);
        }
        return this._indexOf.get(name);
    }

    /**
     * Every name, fetched once. For what cannot do without them (sorting or
     * searching a table on the names, exporting them, a filter kept over
     * names); everything else asks for the names it shows.
     * @returns {Promise<ArrayLike<string>>}
     */
    async all() {
        if (this._full) return this._full;
        if (!this._fetchAll) throw this._notLoaded();
        if (!this._fullLoading) {
            this._fullLoading = Promise.resolve(this._fetchAll()).then(names => {
                if (!names || names.length !== this.length) {
                    throw new Error(`The server named ${names ? names.length : 0} cells, expected ${this.length}`);
                }
                this._full = names;
                return names;
            }).finally(() => { this._fullLoading = null; });
        }
        return this._fullLoading;
    }

    _notLoaded() {
        const error = new Error(`The names of these ${this.length.toLocaleString('en-US')} cells are not loaded `
            + '(every cell of a very large dataset); turn on a subset to list cells');
        // not a failed read: a limit of large-plot mode (classifyError: UNAVAILABLE)
        error.data = { reason: 'names_not_loaded' };
        return error;
    }

    _walk() {
        if (this._full) return this._full;
        throw this._notLoaded();
    }

    [Symbol.iterator]() { return this._walk()[Symbol.iterator](); }
    forEach(...args) { return Array.prototype.forEach.apply(this._walk(), args); }
    map(...args) { return Array.prototype.map.apply(this._walk(), args); }
    filter(...args) { return Array.prototype.filter.apply(this._walk(), args); }
    slice(...args) { return Array.prototype.slice.apply(this._walk(), args); }

    /** A Proxy that answers `names[i]` from the cache, as an array would. */
    static wrap(names) {
        return new Proxy(names, {
            get(target, prop, receiver) {
                if (typeof prop === 'string') {
                    const c = prop.charCodeAt(0);
                    if (c >= 48 && c <= 57) return target.at(Number(prop));
                }
                const v = Reflect.get(target, prop, receiver);
                return typeof v === 'function' ? v.bind(target) : v;
            }
        });
    }
}

/** Names asked for in one request: the row list is in the URL. */
const BATCH = 500;
