/**
 * Background recompute of closed tables: who builds a closed table's filter, when, and who owns it.
 *
 * A plot filtered by a CLOSED table needs the rows that pass the table's filter. A table closed by
 * hand keeps them (utils/closed-table.js); one restored from a link, a panel set or Back and
 * Forward has only its configuration, and a subset or part change outdates the ones it kept. This
 * module decides when such a table is rebuilt in the background (a detached DataTable that loads
 * the columns the filter uses, panels/table-utilities/table-background.js) and keeps the races
 * between that build and the user opening the table out of anyone's way.
 *
 * Rules (design-gene-signature.md section 8):
 * - A build starts only when a dependant that is on the page asks for it (`need`), never for every
 *   closed table, and never for a plot in large-plot mode (the caller does not ask).
 * - One build at a time; the queue runs dependants on screen first, then tables with fewer tables
 *   upstream, then in the order asked. Control returns to the browser between builds.
 * - One owner per table id (`none`, `background`, `panel`) and an `epoch` that rises on every
 *   change of owner or input. A result is published only if its epoch is still current, so a late
 *   background result never overwrites an opened table.
 * - Size tiers (TABLE_LIMITS): automatic, one click ("Build filter"), refused. The browser memory
 *   guard (host.mayLoad) decides first; refused means nothing loads.
 * - A chain of tables is resolved upstream first; a cycle stops resolution and says so.
 *
 * The browser (DataTables, PanelManager, the memory guard) is reached only through `host`, so Node
 * tests cover every rule here with a fake one.
 */

/**
 * The size limits of a background build, in rows of the table. Named here, and nowhere else, as
 * they may be tuned: the 200,000 rests on a scaled measurement of the page freeze (the build is one
 * uninterrupted task, see the CHANGELOG and the design's 8.2).
 */
export const TABLE_LIMITS = Object.freeze({
    /** Up to this many rows the build starts by itself. */
    AUTO_ROWS: 200000,
    /** Up to this many it waits for one click ("Build filter"); above it, it is refused. */
    ASK_ROWS: 1000000
});

/**
 * Which tier `rows` falls in.
 * @param {number} rows
 * @param {{AUTO_ROWS: number, ASK_ROWS: number}} [limits]
 * @returns {'auto'|'ask'|'refuse'}
 */
export function tierOf(rows, limits = TABLE_LIMITS) {
    if (!(rows > limits.AUTO_ROWS)) return 'auto';
    return rows <= limits.ASK_ROWS ? 'ask' : 'refuse';
}

/**
 * The cycle through `id` in a graph of "this table needs these tables first", or null. Depth first
 * with a visiting set: it never loops, whatever a hand-edited link says.
 * @param {string} id
 * @param {(id: string) => string[]} depends
 * @returns {string[]|null} the ids on the cycle, starting and ending at the one met twice
 */
export function findCycle(id, depends) {
    const path = [];
    const done = new Set();
    const visit = (node) => {
        const at = path.indexOf(node);
        if (at >= 0) return path.slice(at).concat(node);
        if (done.has(node)) return null;
        path.push(node);
        for (const next of depends(node) || []) {
            const found = visit(next);
            if (found) return found;
        }
        path.pop();
        done.add(node);
        return null;
    };
    return visit(id);
}

/**
 * How many tables sit upstream of `id` (the longest chain). 0 for a table that needs no other.
 * A cycle counts as no more than its length: it never loops.
 * @param {string} id
 * @param {(id: string) => string[]} depends
 * @returns {number}
 */
export function depthOf(id, depends) {
    const seen = new Set();
    const walk = (node) => {
        if (seen.has(node)) return 0;
        seen.add(node);
        let deepest = 0;
        for (const next of depends(node) || []) deepest = Math.max(deepest, 1 + walk(next));
        seen.delete(node);
        return deepest;
    };
    return walk(id);
}

/**
 * What a plot says of a table filter that is not applied yet: the strip tag, the notice over the
 * plot and its actions. Pure, so Node tests pin every sentence.
 * @param {{state: string, reason?: string, cycle?: string[]}} status - a resolver status
 * @param {string} name - the table's title
 * @param {(id: string) => string} [titleOf] - a table id to its title (for a cycle)
 * @returns {{tag: string, headline: string, text: string, actions: Array<[string, string]>}}
 */
export function describeUnresolved(status, name, titleOf = (id) => id) {
    const open = ['reopen-table', 'Open table'];
    const off = ['table-filter-off', 'Stop filtering'];
    const state = status && status.state;
    const why = status && status.reason ? status.reason : '';
    switch (state) {
        case 'building':
            if (status.frozen) {
                // the last step cannot be stopped; it holds the page for a moment
                return { tag: 'Building filter', headline: 'Filter not applied yet',
                    text: `Filtering '${name}'. This last step cannot be cancelled and takes a moment. No cells are drawn until it is ready.`,
                    actions: [open, off] };
            }
            return { tag: 'Building filter', headline: 'Filter not applied yet',
                text: `Building '${name}'. No cells are drawn until it is ready.`,
                actions: [['cancel-filter', 'Cancel'], open, off] };
        case 'waiting':
            if (status.reason === 'opening') {
                return { tag: 'Opening table', headline: 'Filter not applied yet',
                    text: `Waiting for '${name}' to open. No cells are drawn until it is ready.`, actions: [off] };
            }
            return { tag: 'Building filter', headline: 'Filter not applied yet',
                text: `Waiting to build '${name}'. No cells are drawn until it is ready.`, actions: [open, off] };
        case 'ask':
            return { tag: 'Filter not built', headline: 'Filter not applied yet',
                text: `Building '${name}' will pause the page for a few seconds. No cells are drawn until it is ready.`,
                actions: [['build-filter', 'Build filter'], open, off] };
        case 'refused':
            return { tag: 'Filter not applied', headline: 'Filter not applied',
                text: status.reason === 'memory'
                    ? `Not enough browser memory to build '${name}'. No cells are drawn.${status.detail ? ' ' + status.detail : ''}`
                    : `'${name}' is too large to build here${status.rows ? ` (${Number(status.rows).toLocaleString('en-US')} rows)` : ''}. No cells are drawn. Open the table to filter by it.`,
                actions: [open, off] };
        case 'failed':
            return { tag: 'Filter not applied', headline: 'Filter not applied',
                text: `'${name}' could not be built${why ? `: ${why}` : ''}. No cells are drawn.`,
                actions: [['retry-filter', 'Retry'], open, off] };
        case 'cycle': {
            const names = (status.cycle || []).slice(0, -1).map(titleOf);
            const text = names.length === 2
                ? `'${names[0]}' and '${names[1]}' depend on each other.`
                : `${names.map(n => `'${n}'`).join(', ')} depend on each other in a circle.`;
            return { tag: 'Filter not applied', headline: 'Filter not applied',
                text: `${text} No cells are drawn.`, actions: [open, off] };
        }
        default:
            return { tag: 'Filter not applied', headline: 'Filter not applied yet',
                text: `'${name}' is closed, so its filter is not applied yet. Open it to apply the filter.`, actions: [open, off] };
    }
}

function abortError(why) {
    return new DOMException(why, 'AbortError');
}

/**
 * A resolver over a `host`.
 *
 * host:
 * - panel(id) -> {id, kind: 'cell-table'|'gene-table', open: boolean, title, config} | null
 * - isDependant(dependantId, tableId) -> boolean: the panel is on the page and filters by the table
 * - visible(dependantId) -> boolean: the dependant is on screen
 * - cellsKey(kind) -> string: identity of the cells (or genes) the rows would be for
 * - rowCount(kind) -> number
 * - mayLoad(id, kind, rows) -> {ok: boolean, detail?: string}: the browser memory guard
 * - depends(id) -> string[]: tables this table needs first
 * - build({id, kind, config, signal, check}) -> Promise<selection>: the background build. It calls
 *   `check()` before its uninterrupted step, which throws if the job was replaced or is not wanted.
 * - publish(id, selection): puts the result where plots read it
 * - notify(id, kind): tells the dependants that something changed (once per change)
 * - schedule(fn): runs fn later, in a new task
 *
 * @param {Object} host
 * @param {{limits?: {AUTO_ROWS: number, ASK_ROWS: number}}} [options]
 */
export function createResolver(host, options = {}) {
    let limits = { ...TABLE_LIMITS, ...(options.limits || {}) };
    const records = new Map();
    let running = null;        // the record whose build runs
    let order = 0;
    let builds = 0;            // builds started, for tests

    const later = (fn) => (host.schedule ? host.schedule(fn) : setTimeout(fn, 0));

    function record(id) {
        let rec = records.get(id);
        if (!rec) {
            rec = { id, epoch: 0, owner: 'none', opening: false, outcome: null, state: 'idle', reason: '', detail: '',
                cycle: null, rows: 0, key: null, confirmedKey: null, failedKey: null, heldKey: null, frozen: false, controller: null,
                queued: false, order: 0, wanted: new Set() };
            records.set(id, rec);
        }
        return rec;
    }

    const publicStatus = (rec) => ({ state: rec.state, reason: rec.reason, detail: rec.detail,
        cycle: rec.cycle, rows: rec.rows, epoch: rec.epoch, owner: rec.owner, frozen: rec.frozen });

    const liveWanted = (rec) => [...rec.wanted].filter(d => host.isDependant(d, rec.id));

    function set(rec, state, extra = {}) {
        rec.state = state;
        rec.reason = extra.reason || '';
        rec.detail = extra.detail || '';
        rec.cycle = extra.cycle || null;
        rec.rows = extra.rows || rec.rows;
    }

    /** Stop a table's job (running or waiting). Does not touch the record's owner. */
    function stop(rec, why) {
        rec.queued = false;
        if (rec.controller) {
            const controller = rec.controller;
            rec.controller = null;
            controller.abort(abortError(why));
        }
    }

    /**
     * A dependant asks for the table's filter. Returns the status at once; a change that happens
     * later is told through host.notify. Never throws.
     * @param {string} id - the table
     * @param {string} [dependantId] - the panel that needs it
     * @returns {{state: string, reason?: string, detail?: string, cycle?: string[]|null, rows?: number}}
     *   'ready' when nothing is wanted of the resolver, else 'waiting', 'building', 'ask', 'refused',
     *   'failed', 'cycle' or 'missing'
     */
    function need(id, dependantId = null) {
        const panel = host.panel(id);
        if (!panel) return { state: 'missing' };
        const rec = record(id);
        if (dependantId) rec.wanted.add(dependantId);
        const gated = gate(id);
        if (gated) return gated;
        if (panel.open) return { state: 'ready' };

        const cycle = findCycle(id, host.depends);
        if (cycle) {
            stop(rec, 'cycle');
            set(rec, 'cycle', { cycle });
            return publicStatus(rec);
        }
        const key = host.cellsKey(panel.kind);
        if (rec.key !== key) {
            // other cells: what was decided for the old ones is void
            stop(rec, 'The cells changed');
            rec.key = key;
            rec.confirmedKey = null;
            rec.failedKey = null;
            rec.heldKey = null;
            if (rec.state !== 'building') set(rec, 'idle');
        }
        if (rec.state === 'building' || (rec.state === 'waiting' && rec.queued)) return publicStatus(rec);
        if (rec.state === 'failed' && rec.failedKey === key) return publicStatus(rec);

        const rows = host.rowCount(panel.kind);
        const tier = tierOf(rows, limits);
        if (tier === 'refuse') {
            set(rec, 'refused', { reason: 'size', rows });
            return publicStatus(rec);
        }
        // a cancelled build waits for one click, whatever its size
        if ((tier === 'ask' && rec.confirmedKey !== key) || rec.heldKey === key) {
            set(rec, 'ask', { rows });
            return publicStatus(rec);
        }
        const guard = host.mayLoad(id, panel.kind, rows);
        if (!guard.ok) {
            set(rec, 'refused', { reason: 'memory', detail: guard.detail || '', rows });
            return publicStatus(rec);
        }
        rec.order = ++order;
        rec.queued = true;
        set(rec, 'waiting', { rows });
        later(pump);
        return publicStatus(rec);
    }

    /**
     * What stands between the dependant and an OPEN (or opening) table: it is being opened, or its
     * opening failed. Null when the table can be read as it is.
     */
    function gate(id) {
        const rec = records.get(id);
        if (!rec) return null;
        if (rec.opening) return { state: 'waiting', reason: 'opening' };
        if (rec.outcome) return { ...rec.outcome };
        return null;
    }

    /** The status of a table, without asking for anything. */
    function status(id) {
        const rec = records.get(id);
        return rec ? publicStatus(rec) : { state: 'idle' };
    }

    function pick() {
        const candidates = [];
        for (const rec of records.values()) {
            if (!rec.queued) continue;
            if (!liveWanted(rec).length) {
                rec.queued = false;
                set(rec, 'idle');
                continue;
            }
            candidates.push(rec);
        }
        if (!candidates.length) return null;
        const visible = (rec) => liveWanted(rec).some(d => host.visible(d));
        candidates.sort((a, b) =>
            (visible(b) ? 1 : 0) - (visible(a) ? 1 : 0)
            || depthOf(a.id, host.depends) - depthOf(b.id, host.depends)
            || a.order - b.order);
        return candidates[0];
    }

    function pump() {
        if (running) return;
        const rec = pick();
        if (rec) start(rec);
    }

    function start(rec) {
        const panel = host.panel(rec.id);
        if (!panel || panel.open) {
            rec.queued = false;
            set(rec, 'idle');
            later(pump);
            return;
        }
        const epoch = rec.epoch;
        const key = host.cellsKey(panel.kind);
        const controller = new AbortController();
        const signal = controller.signal;
        rec.controller = controller;
        rec.queued = false;
        rec.owner = 'background';
        rec.frozen = false;
        set(rec, 'building', { rows: rec.rows });
        running = rec;
        builds++;
        host.notify(rec.id, panel.kind);
        // the last step (filter and release) cannot be stopped: say so, and let the page paint it
        const enter = async () => {
            check();
            rec.frozen = true;
            host.notify(rec.id, panel.kind);
            await new Promise(r => setTimeout(r, 60));
            if (rec.epoch !== epoch || signal.aborted) {
                rec.frozen = false;
                throw abortError('The build was replaced');
            }
        };
        const check = () => {
            if (rec.epoch !== epoch || signal.aborted) throw abortError('The build was replaced');
            if (!liveWanted(rec).length) {
                controller.abort(abortError('Nothing needs the table'));
                throw abortError('Nothing needs the table');
            }
        };
        // a new task: the notice above is drawn before the page is held
        later(async () => {
            let changed = true;
            try {
                check();
                const selection = await host.build({ id: rec.id, kind: panel.kind, config: panel.config, signal, check, enter });
                if (rec.epoch !== epoch || signal.aborted) {
                    // replaced while it ran: the owner that replaced it publishes
                    changed = false;
                } else if (host.cellsKey(panel.kind) !== key) {
                    // other cells by now: this result is for cells nobody shows
                    rec.key = null;
                    set(rec, 'idle');
                } else {
                    host.publish(rec.id, selection);
                    rec.owner = 'none';
                    set(rec, 'ready');
                }
            } catch (error) {
                if (rec.epoch !== epoch) {
                    changed = false;
                } else if (error && error.name === 'AbortError') {
                    rec.owner = 'none';
                    set(rec, rec.heldKey === key ? 'ask' : 'idle', { rows: rec.rows });
                } else {
                    rec.owner = 'none';
                    rec.failedKey = key;
                    set(rec, 'failed', { reason: (error && error.message) || String(error) });
                }
            } finally {
                if (rec.controller === controller) rec.controller = null;
                rec.frozen = false;
                running = null;
                if (changed) host.notify(rec.id, panel.kind);
                later(pump);
            }
        });
    }

    /** One click on "Build filter": the build of this table's size is allowed for these cells. */
    function accept(id) {
        const panel = host.panel(id);
        if (!panel) return;
        const rec = record(id);
        rec.confirmedKey = host.cellsKey(panel.kind);
        rec.key = rec.confirmedKey;
        rec.heldKey = null;
        if (rec.state === 'ask') {
            set(rec, 'idle');
            const status = need(id);
            if (status.state !== 'ask') host.notify(id, panel.kind);
        }
    }

    /**
     * Cancel a build in its load phase: the load stops and the table returns to "Build filter".
     * Not once the last step (filter and release) has begun.
     * @returns {boolean} whether it was stopped
     */
    function cancel(id) {
        const rec = records.get(id);
        if (!rec || rec.state !== 'building' || rec.frozen) return false;
        rec.heldKey = rec.key;
        rec.confirmedKey = null;
        stop(rec, 'Cancelled');
        return true;
    }

    /** Retry a failed build. */
    function retry(id) {
        const panel = host.panel(id);
        const rec = records.get(id);
        if (!panel || !rec) return;
        rec.failedKey = null;
        if (rec.state === 'failed') set(rec, 'idle');
        need(id);
        host.notify(id, panel.kind);
    }

    /**
     * The table panel starts loading its own rows (it is being opened). A background build of the
     * table ends here, before it can load a second copy of the rows, and any result it still
     * delivers is void: the epoch rose.
     */
    function claim(id) {
        const rec = record(id);
        rec.epoch++;
        stop(rec, 'The table was opened');
        if (running === rec) { /* its finally frees `running` */ }
        rec.owner = 'panel';
        rec.opening = true;
        rec.outcome = null;
        set(rec, 'idle');
    }

    /** The opened table has its rows and its filter: dependants may read it. Called before it tells them. */
    function panelPublished(id) {
        const rec = records.get(id);
        if (!rec || !rec.opening && !rec.outcome) return;
        rec.opening = false;
        rec.outcome = null;
    }

    /**
     * The opened table did not come up: refused by the memory guard, failed, or cancelled. The
     * dependants say so instead of reading rows that are not there.
     * @param {string} id
     * @param {'refused'|'failed'|'cancelled'|'empty'} outcome
     * @param {string} [reason]
     */
    function panelSettled(id, outcome, reason = '') {
        const rec = records.get(id);
        if (!rec) return;
        const wasOpening = rec.opening;
        rec.opening = false;
        if (outcome === 'refused') rec.outcome = { state: 'refused', reason: 'memory', detail: reason };
        else if (outcome === 'failed') rec.outcome = { state: 'failed', reason };
        else if (outcome === 'cancelled') rec.outcome = { state: 'failed', reason: 'Opening was cancelled' };
        else rec.outcome = null;
        if (wasOpening || rec.outcome) {
            const panel = host.panel(id);
            host.notify(id, panel ? panel.kind : 'cell-table');
        }
    }

    /** The panel closed: its filter is in its closed selection; nothing is rebuilt. */
    function panelClosed(id) {
        const rec = records.get(id);
        if (!rec) return;
        const wasOpening = rec.opening;
        rec.epoch++;
        rec.owner = 'none';
        rec.opening = false;
        rec.outcome = null;
        if (wasOpening) {
            const panel = host.panel(id);
            host.notify(id, panel ? panel.kind : 'cell-table');
        }
    }

    /** The panel is gone for good (deleted, or replaced by one restored from a link or step). */
    function drop(id) {
        const rec = records.get(id);
        if (!rec) return;
        rec.epoch++;
        stop(rec, 'The table was removed');
        records.delete(id);
    }

    /** The cells (or the dataset) changed: builds for other cells end, what was decided is void. */
    function cellsChanged() {
        for (const rec of records.values()) {
            const panel = host.panel(rec.id);
            const key = panel ? host.cellsKey(panel.kind) : null;
            if (rec.key !== null && rec.key !== key) {
                rec.epoch++;
                stop(rec, 'The cells changed');
                if (rec.owner === 'background') rec.owner = 'none';
                rec.key = null;
                rec.confirmedKey = null;
                rec.failedKey = null;
                set(rec, 'idle');
            }
        }
    }

    /** Everything stops: a dataset switch, a panel set loaded. Opening tables keep their claim. */
    function reset() {
        for (const rec of records.values()) {
            rec.epoch++;
            stop(rec, 'Reset');
            if (rec.owner === 'background') rec.owner = 'none';
            rec.key = null;
            rec.confirmedKey = null;
            rec.failedKey = null;
            rec.wanted.clear();
            set(rec, 'idle');
        }
    }

    /**
     * A dependant went away (a plot closed, or filtered by something else): a build nothing needs
     * any more ends if it has not reached its uninterrupted step.
     */
    function reassess() {
        for (const rec of records.values()) {
            if (!liveWanted(rec).length) {
                rec.wanted.clear();
                if (rec.state === 'building' || rec.queued) {
                    stop(rec, 'Nothing needs the table');
                    if (rec.state !== 'building') set(rec, 'idle');
                }
            }
        }
    }

    /** A dependant no longer filters by this table. */
    function withdraw(dependantId) {
        for (const rec of records.values()) rec.wanted.delete(dependantId);
        reassess();
    }

    return {
        need, gate, status, accept, cancel, retry, claim, panelPublished, panelSettled, panelClosed, drop,
        cellsChanged, reset, reassess, withdraw,
        /** Tests: the limits in force, and a way to tune them. */
        get limits() { return { ...limits }; },
        setLimits(next) { limits = { ...TABLE_LIMITS, ...next }; },
        /** Tests: builds started, the table building now, the records. */
        get buildsStarted() { return builds; },
        get building() { return running ? running.id : null; },
        get host() { return host; },
        set host(next) { host = next; },
        epochOf(id) { const rec = records.get(id); return rec ? rec.epoch : 0; }
    };
}

const DEAD_HOST = {
    panel: () => null, isDependant: () => false, visible: () => false, cellsKey: () => '', rowCount: () => 0,
    mayLoad: () => ({ ok: true }), depends: () => [], build: async () => { throw new Error('No table builder'); },
    publish: () => {}, notify: () => {}, schedule: (fn) => setTimeout(fn, 0)
};

/**
 * The page's resolver. Its host is set by panels/table-utilities/table-background.js; until then
 * it knows no table.
 */
export const TableResolver = createResolver({ ...DEAD_HOST });
