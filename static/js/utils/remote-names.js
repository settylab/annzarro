/**
 * Cell names that stay on the server.
 *
 * Above the large-plot threshold (5M cells by default) a dataset opened with
 * every cell does not download its names: on real Tahoe data the /cells JSON
 * took 19 of the 23 s before a 50M-cell plot appeared, and large-plot mode
 * shows no names (no hover, no click). What does need a name or an index asks
 * the server for that one:
 *
 *   nameAt(i)      the name of cell i (/data/obs?columns=_index&rows=i)
 *   resolve(name)  its index, or -1 (/data/names, exact match)
 *
 * Both are cached. The synchronous array-like API (`length`, `[i]`, `at`,
 * `indexOf`, `includes`) answers from that cache, so code written for a name
 * array keeps working for the names it has seen; `[i]` of a name not fetched
 * yet is undefined. Walking every name (iteration, map, filter, slice) throws:
 * a cell table of every cell of such a dataset is not possible, and saying so
 * beats a frozen tab.
 */
export class RemoteNames {
    /**
     * @param {number} length  cells
     * @param {(indices: number[]) => Promise<string[]>} fetchNames
     * @param {(name: string) => Promise<number>} lookup  index or -1
     */
    constructor(length, fetchNames, lookup) {
        this.length = length;
        this._fetchNames = fetchNames;
        this._lookup = lookup;
        this._nameOf = new Map();    // index -> name
        this._indexOf = new Map();   // name -> index (-1: not in the dataset)
    }

    /** Record a name/index pair learned elsewhere (e.g. a name search result). */
    remember(name, index) {
        if (typeof name !== 'string' || !(index >= 0 && index < this.length)) return;
        this._nameOf.set(index, name);
        this._indexOf.set(name, index);
    }

    at(i) {
        if (i < 0) i += this.length;
        return this._nameOf.get(i);
    }

    indexOf(name) {
        const i = this._indexOf.get(name);
        return i === undefined ? -1 : i;
    }

    includes(name) { return this.indexOf(name) >= 0; }

    async nameAt(i) {
        if (!(i >= 0 && i < this.length)) return undefined;
        if (!this._nameOf.has(i)) {
            const [name] = await this._fetchNames([i]);
            if (typeof name === 'string') this.remember(name, i);
        }
        return this._nameOf.get(i);
    }

    async resolve(name) {
        if (typeof name !== 'string' || !name) return -1;
        if (!this._indexOf.has(name)) {
            const index = await this._lookup(name);
            if (index >= 0) this.remember(name, index);
            else this._indexOf.set(name, -1);
        }
        return this._indexOf.get(name);
    }

    _all() {
        const error = new Error(`The names of these ${this.length.toLocaleString('en-US')} cells are not loaded `
            + '(every cell of a very large dataset); turn on a subset to list cells');
        // not a failed read: a limit of large-plot mode (classifyError: UNAVAILABLE)
        error.data = { reason: 'names_not_loaded' };
        throw error;
    }

    [Symbol.iterator]() { return this._all(); }
    forEach() { return this._all(); }
    map() { return this._all(); }
    filter() { return this._all(); }
    slice() { return this._all(); }

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
