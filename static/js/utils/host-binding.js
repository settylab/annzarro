/**
 * The page side of a derived source on its consumers' hosts (a plot's or a table's container), written once for every
 * provider: the gene score (utils/score-source.js), the cell grouping (G8a), and the tables' score columns.
 *
 * TWO PARTS.
 *
 * - `createHostBinding(spec)`: one provider's RECORDS, one per (host, role): the handle a role reads, the setting it
 *   was made for, what the plot last drew, the waiters of a load that keeps the drawing. With them, what every
 *   provider needs and nobody should copy: whether the host is on screen (one IntersectionObserver per host, whoever
 *   asks), whether the host still reads the record (`stillUsed`), a repaint batched over a burst of progress frames, a
 *   redraw of the panel when the values it drew changed, and a load that waits for a pending value while the plot has
 *   a drawing to keep (`loadWhenReady`).
 *
 * - THE PAINTER (`painter`, one for the page): what a host says. Every provider is a source of notices
 *   (`painter.register({id, entries, placeholder})`; a binding registers itself); `painter.paint(host)` collects what
 *   EVERY provider has on that host, shows the worst (utils/source-notices.js `worstNotice`) with its progress bar
 *   (operator decision 21: once the wait is long, by estimate or by clock), and remembers whose notice it shows. The
 *   action registry (utils/source-actions.js) routes a notice's button to that provider, by its id. So a plot with a
 *   score on x and a grouping on colour shows one notice, the grouping's Compute computes the grouping, and a score's
 *   event never wipes the grouping's notice.
 *
 * A provider's painter id and its action provider id are the same string ('plot-score', 'table-score').
 */
import { worstNotice, paintNotice, paintStripProgress, progressBar, barAfterS } from './source-notices.js';
import { actions } from './source-actions.js';

/** The axes a source can be an x, y or z of; their notice may block the plot (a placeholder instead of a drawing). */
const AXIS_ROLES = Object.freeze(['x', 'y', 'z']);

/** States that pass by themselves: asked for, queued or computed. The others last until the user acts. */
export const PENDING = Object.freeze(['idle', 'estimating', 'queued', 'computing', 'updating']);

/** Notice states of a job on its way: its clock runs from the first paint that sees it (the 10 s rule). */
const ON_ITS_WAY = Object.freeze(['estimating', 'queued', 'computing', 'updating']);

/** Hover entries have a role each (`hover:<source>:<option>`): they say nothing over the plot. */
export const isHover = (role) => typeof role === 'string' && role.startsWith('hover');

/** Whether a plot shows a drawing now (not a placeholder): a switch keeps it until the new data is there. */
function hasDrawing(host) {
    return !!(host && host._fullLayout && Array.isArray(host.data) && host.data.length && !host.querySelector('.coverage-placeholder'));
}

/** The panel id of a host: a plot's container id, or what a table's container carries. */
export function panelIdOf(host) {
    return host && typeof host.id === 'string' && host.id.startsWith('plot-container-')
        ? host.id.slice('plot-container-'.length) : (host && host.__azPanelId) || null;
}

// ---------------------------------------------------------------------------------------------- the painter

/**
 * @typedef {Object} NoticeSource
 * @property {string} id - the provider's id, the same as its action provider's
 * @property {(host: HTMLElement) => Array<{role: string, snap: Object, notice: (Object|null), quiet?: Object, rec?: Object}>} entries
 *   what it has to say on this host now: one entry per role it serves there (a notice of null says nothing). `quiet` is
 *   the notice a load that keeps its drawing holds back: it is not said over the plot, but once its wait is long a slim
 *   bar in the plot's status strip says it
 * @property {(host: HTMLElement, notice: Object) => void} [placeholder] - draws an axis that cannot be drawn
 */

/**
 * A painter of hosts. The page has one (`painter`); a test makes its own with a fake clock and timers.
 * @param {Object} [options]
 * @param {() => number} [options.now] - milliseconds
 * @param {(fn: Function, ms: number) => *} [options.setTimer]
 * @param {(timer: *) => void} [options.clearTimer]
 * @param {(host: HTMLElement, notice: (Object|null), opts: Object) => void} [options.paint] - source-notices.js paintNotice
 * @param {(host: HTMLElement, bar: (Object|null), notice?: Object, snap?: Object) => void} [options.strip] - the strip's
 *   bar of a quiet load: source-notices.js paintStripProgress
 */
// export-unused-ok: the page's painter is made here; a test makes one with its own clock and timers (the 10 s rule)
export function createPainter({ now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t),
    paint = paintNotice, strip = paintStripProgress } = {}) {
    /** @type {Map<string, NoticeSource>} */
    const sources = new Map();
    /** host -> {since: Map(entry key -> ms), timer, shown, placeholder} */
    const states = new WeakMap();

    function stateOf(host) {
        let st = states.get(host);
        if (!st) {
            st = { since: new Map(), timer: null, shown: null, strip: false };
            states.set(host, st);
        }
        return st;
    }

    /** Since when the page has seen each job on its way, keyed by provider, role and value key; others forgotten. */
    function clock(st, all, t) {
        const seen = new Set();
        for (const e of all) {
            if (!(e.notice || e.quiet) || !ON_ITS_WAY.includes(e.snap && e.snap.state)) continue;
            const key = `${e.provider}\u0001${e.role}\u0001${(e.snap && e.snap.key) || ''}`;
            e.clockKey = key;
            seen.add(key);
            if (!st.since.has(key)) st.since.set(key, t);
        }
        for (const key of [...st.since.keys()]) if (!seen.has(key)) st.since.delete(key);
    }

    const elapsedOf = (st, e, t) => (e && e.clockKey && st.since.has(e.clockKey) ? (t - st.since.get(e.clockKey)) / 1000 : 0);

    /** The notice with its bar, or the notice alone. */
    function withBar(st, e, t) {
        if (!e || !e.notice) return null;
        const bar = progressBar(e.snap, elapsedOf(st, e, t));
        return bar ? { ...e.notice, progress: bar } : e.notice;
    }

    /** A job on its way that has no bar yet gets one at 10 s by the clock, with no frame needed to ask for it. */
    function armClock(host, st, waiting, t) {
        if (st.timer !== null) { clearTimer(st.timer); st.timer = null; }
        let left = Infinity;
        const after = barAfterS();
        for (const e of waiting) if (e.clockKey) left = Math.min(left, after - elapsedOf(st, e, t));
        if (!(left > 0) || left === Infinity) return;
        st.timer = setTimer(() => { st.timer = null; paintHost(host); }, Math.ceil(left * 1000) + 5);
    }

    /** The first quiet load that has run 10 s (by the clock, not the estimate), with its bar; null when none has. */
    function quietBar(st, quiet, t) {
        for (const e of quiet) {
            const bar = progressBar(e.snap, elapsedOf(st, e, t), { byEstimate: false });
            if (bar) return { e, bar };
        }
        return null;
    }

    function paintHost(host) {
        if (!host) return;
        const st = stateOf(host);
        const all = [];
        for (const source of sources.values()) {
            for (const e of source.entries(host) || []) all.push({ ...e, provider: source.id, source });
        }
        const t = now();
        clock(st, all, t);
        const blocking = all.filter(e => AXIS_ROLES.includes(e.role) && e.notice && e.notice.blocksAxis);
        const axisNotice = worstNotice(blocking.map(e => e.notice));
        const axisEntry = blocking.find(e => e.notice === axisNotice) || null;
        const worst = worstNotice(all.map(e => e.notice));
        const shownEntry = all.find(e => e.notice === worst) || null;
        st.shown = shownEntry ? { provider: shownEntry.provider, role: shownEntry.role, rec: shownEntry.rec || null } : null;
        const notice = withBar(st, shownEntry, t);
        // an axis that cannot be drawn: nothing truthful can be shown, so the plot area says it, as a placeholder
        paint(host, notice, { overlay: !axisEntry });
        // a load that keeps its drawing is never covered: once it has run 10 s, the strip under the plot says it
        const quiet = all.filter(e => !e.notice && e.quiet);
        const said = quietBar(st, quiet, t);
        if (said) {
            strip(host, said.bar, said.e.quiet, said.e.snap);
            st.strip = true;
        } else if (st.strip) {
            strip(host, null);
            st.strip = false;
        }
        armClock(host, st, [...(notice && !notice.progress ? [shownEntry] : []), ...(said ? [] : quiet)], t);
        if (axisEntry) {
            const placed = host.__sourcePlaceholder || (typeof host.querySelector === 'function' && host.querySelector('.coverage-placeholder'));
            if (placed && axisEntry.source.placeholder) axisEntry.source.placeholder(host, withBar(st, axisEntry, t));
            return;
        }
        host.__sourcePlaceholder = false;
    }

    return {
        /**
         * Add a source of notices. @returns {() => void} the way to remove it
         * @param {NoticeSource} source
         */
        register(source) {
            if (sources.has(source.id)) throw new Error(`Notice source '${source.id}' is already registered`);
            sources.set(source.id, source);
            return () => { if (sources.get(source.id) === source) sources.delete(source.id); };
        },
        /** Say what every provider on this host has to say: the worst of it, with its bar. */
        paint: paintHost,
        /** Whose notice the host shows: {provider, role, rec}, or null. */
        shownOf: (host) => (host && states.has(host) ? states.get(host).shown : null),
        ids: () => [...sources.keys()]
    };
}

/** The page's painter. */
export const painter = createPainter();

// a notice's button goes to the provider whose notice it is
actions.routeBy((host) => { const shown = painter.shownOf(host); return shown ? shown.provider : null; });

// ---------------------------------------------------------------------------------------------- visibility

/** host -> {visible, observer, listeners: Set<() => void>}: one observer per host, whichever providers ask. */
const SEEN = new WeakMap();

/** Whether a host is on screen (true until an observer says otherwise, and where there is none). */
export function isVisible(host) {
    if (!host || !host.isConnected) return false;
    const seen = SEEN.get(host);
    return !seen || seen.visible !== false;
}

function watchVisibility(host, listener) {
    let seen = SEEN.get(host);
    if (!seen) {
        seen = { visible: true, observer: null, listeners: new Set() };
        SEEN.set(host, seen);
        if (typeof IntersectionObserver !== 'undefined') {
            seen.observer = new IntersectionObserver((entries) => {
                const now = !!entries[entries.length - 1].isIntersecting;
                if (now === seen.visible) return;
                seen.visible = now;
                for (const fn of [...seen.listeners]) fn();
            });
            seen.observer.observe(host);
        }
    }
    seen.listeners.add(listener);
}

function unwatchVisibility(host, listener) {
    const seen = SEEN.get(host);
    if (!seen) return;
    seen.listeners.delete(listener);
    if (seen.listeners.size) return;
    if (seen.observer) seen.observer.disconnect();
    SEEN.delete(host);
}

// ---------------------------------------------------------------------------------------------- one provider's records

/**
 * One provider's records on the page's hosts, registered with the painter.
 * @param {Object} spec
 * @param {string} spec.id - the provider's id: its notices' and its actions'
 * @param {(host: HTMLElement, role: string, setting: Object, onChange: (snap: Object) => void) => Object} spec.open -
 *   a record's own fields for this setting, with at least `handle` (read, release, sharers): what the role reads, and
 *   `consumer` ({kind, role, panelId, host}): who reads it, which `describe` is given
 * @param {(rec: Object, setting: Object) => boolean} spec.matches - whether a record still serves this setting
 * @param {(snap: Object, ctx: {role: string, sharers: number, consumer?: Object}) => (Object|null)} spec.describe - the notice
 *   of a snapshot; `consumer` is the watch's consumer ({kind, role, panelId, host}) when `open` returns it as the record's
 *   `consumer`, so a provider can word a notice from what its panel knows
 * @param {(rec: Object) => boolean} [spec.stillUsed] - whether the host still reads what the record holds
 * @param {(rec: Object, snap: Object) => boolean} [spec.stale] - whether what the plot drew for a record that has no
 *   value says something the new state does not (its coverage in the strip): the plot is drawn again
 * @param {(host: HTMLElement) => void} [spec.refresh] - draw the panel again (its values changed)
 * @param {() => void} [spec.visibilityChanged] - a host of this provider came on screen or left it
 * @param {(host: HTMLElement, notice: Object) => void} [spec.placeholder] - draws an axis that cannot be drawn
 * @param {ReturnType<typeof createPainter>} [spec.painter] - the page's by default
 * @param {number} [spec.paintMs] - a burst of changes is painted once, this long after the first
 * @param {Function} [spec.setTimer]
 */
export function createHostBinding({ id, open, matches, describe, stillUsed = () => true, stale = () => false, refresh = () => {},
    visibilityChanged = () => {},
    placeholder = null, painter: own = painter, paintMs = 120, setTimer = (fn, ms) => setTimeout(fn, ms) }) {
    /** host -> Map(role -> record) */
    const HOSTS = new WeakMap();
    /** hosts with records */
    const live = new Set();
    /** hosts with a paint or a refresh due */
    const due = new WeakMap();

    const roleWord = (role) => (role === 'color' ? 'colour' : (isHover(role) ? 'hover' : role));

    function recordsOf(host) {
        let map = HOSTS.get(host);
        if (!map) {
            map = new Map();
            HOSTS.set(host, map);
        }
        return map;
    }

    function noticeOf(rec) {
        const snap = rec.handle.read();
        // while a load waits for a value that is only pending, nothing is said over the plot: it keeps what it shows and
        // its loading pill speaks, and after 10 s a bar in its strip (the painter's)
        const notice = describe(snap, { role: roleWord(rec.role), sharers: rec.handle.sharers(), consumer: rec.consumer });
        if (rec.quiet && PENDING.includes(snap.state)) return { role: rec.role, snap, notice: null, quiet: notice, rec };
        return { role: rec.role, snap, notice, rec };
    }

    const paint = (host) => own.paint(host);

    function schedulePaint(host) {
        const d = due.get(host) || {};
        if (d.paint) return;
        d.paint = setTimer(() => { d.paint = null; paint(host); }, paintMs);
        due.set(host, d);
    }

    function refreshSoon(host) {
        const d = due.get(host) || {};
        if (d.refresh) return;
        d.refresh = setTimer(() => { d.refresh = null; refresh(host); }, 30);
        due.set(host, d);
    }

    function release(host, role) {
        const map = HOSTS.get(host);
        const rec = map && map.get(role);
        if (!rec) return;
        rec.handle.release();
        map.delete(role);
        // a load waiting on this record ends with it: it must not reopen what was let go (that is a loop the moment the
        // reason for letting go is still there), a new load for the next setting makes its own record
        for (const wake of rec.waiters.splice(0)) wake(true);
        if (!map.size) {
            live.delete(host);
            unwatchVisibility(host, visibilityChanged);
        }
        paint(host);
    }

    function changed(host, rec, snap) {
        // a record nothing reads any more goes, and what waits on it ends with it (release wakes the waiters as dropped)
        if (!host.isConnected || !stillUsed(rec)) {
            if (recordsOf(host).get(rec.role) === rec) release(host, rec.role);
            return;
        }
        if (rec.waiters.length) for (const wake of rec.waiters.splice(0)) wake();
        const showing = snap.values ? (snap.shownKey || snap.key) : null;
        const moved = (rec.drawnKey !== undefined && showing !== rec.drawnKey) || stale(rec, snap);
        if (!rec.quiet && snap.state !== 'updating' && moved) refreshSoon(host);
        schedulePaint(host);
    }

    /** The record of (host, role) for this setting: the one there, or a new one when there is none or it serves another. */
    function recordFor(host, role, setting) {
        const map = recordsOf(host);
        let rec = map.get(role);
        if (rec && !matches(rec, setting)) {
            release(host, role);
            rec = null;
        }
        if (!rec) {
            rec = { role, setting, panelId: panelIdOf(host), drawnKey: undefined, quiet: false, waiters: [], handle: null };
            const mine = rec;
            Object.assign(rec, open(host, role, setting, (snap) => changed(host, mine, snap)));
            map.set(role, rec);
            live.add(host);
            watchVisibility(host, visibilityChanged);
        }
        rec.setting = setting;
        return rec;
    }

    /**
     * Wait for the next change of a record; an abort rejects, and its listener goes with the wait. Resolves true when the
     * record was let go (or there is none) instead of changing: what waited on it is over.
     */
    function nextChange(host, role, signal) {
        const rec = recordsOf(host).get(role);
        return new Promise((resolve, reject) => {
            if (!rec) { resolve(true); return; }
            const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
            rec.waiters.push((dropped = false) => { if (signal) signal.removeEventListener('abort', onAbort); resolve(dropped); });
            if (signal) signal.addEventListener('abort', onAbort, { once: true });
        });
    }

    /**
     * Load a role's values, waiting while they are pending when the plot has a drawing to keep: the old drawing stays,
     * the plot's own loading pill shows, and nothing is claimed (no notice, no tag) until the state is known to last.
     * With no drawing yet, or in a lasting state, it throws as `load` does.
     * @param {(quiet: boolean) => Promise<*>} load - one attempt; throws a SourceUnavailable with its `state`
     * @param {{host: HTMLElement, role: string}} at
     * @param {AbortSignal|null} [signal]
     */
    async function loadWhenReady(load, { host, role }, signal = null) {
        const keep = hasDrawing(host);
        for (;;) {
            try {
                const got = await load(keep);
                const done = host ? recordsOf(host).get(role) : null;
                if (done) done.quiet = false;
                return got;
            } catch (error) {
                if (!keep || !error || error.name !== 'SourceUnavailable' || !PENDING.includes(error.state)) {
                    // it lasts (or there is nothing to keep): say so
                    const rec = host ? recordsOf(host).get(role) : null;
                    if (rec) { rec.quiet = false; paint(host); }
                    throw error;
                }
                if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
                // the record this attempt waits on, and nothing else: if it is let go while we wait the load is over (a
                // generation: each reopening is an attempt's own, never a wake's)
                if (await nextChange(host, role, signal)) throw new DOMException('Aborted', 'AbortError');
            }
        }
    }

    own.register({
        id,
        entries: (host) => {
            const map = HOSTS.get(host);
            return map ? [...map.values()].filter(r => !isHover(r.role)).map(noticeOf) : [];
        },
        placeholder: placeholder || undefined
    });

    return {
        id,
        recordsOf,
        recordFor,
        release,
        /** A host closes: its records go, and a value nothing else needs stops computing. */
        releaseHost(host) {
            const map = HOSTS.get(host);
            if (!map) return;
            for (const role of [...map.keys()]) release(host, role);
        },
        paint,
        schedulePaint,
        refreshSoon,
        loadWhenReady,
        /** The record whose notice the host shows, or its first record. */
        shownRecord(host) {
            const map = HOSTS.get(host);
            if (!map) return null;
            const shown = own.shownOf(host);
            return (shown && shown.provider === id && map.get(shown.role)) || [...map.values()][0] || null;
        },
        /** The hosts this provider has records on. */
        hosts: () => [...live],
        /** The notice a record would say now, for a host's own use (an axis placeholder of a load that failed). */
        describe: (snap, role, sharers = 1) => describe(snap, { role: roleWord(role), sharers })
    };
}
