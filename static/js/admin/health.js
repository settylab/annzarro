/**
 * Server health section (design 5, 2.5): workers, caches, refusals and active
 * users from GET /admin/health. Refreshes every 10 s while the tab is visible
 * (the router reads `autoRefreshMs`). Stub of slice 1: no cache-clear button yet.
 */

import { h, setChildren, badge, table } from './dom.js';
import { formatAge, formatCount, formatMb, formatTimestamp, quotaPercent, quotaLevel } from './admin-format.js';

/** A progress bar for `used` of `limit` MB. */
export function meter(usedMb, limitMb) {
    if (typeof usedMb !== 'number') return 'idle';
    const pct = quotaPercent(usedMb, limitMb);
    return h('div', { class: 'admin-meter' },
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
            h('div', { class: `progress-bar bg-${quotaLevel(pct)}`, style: `width: ${pct}%` })),
        h('span', { class: 'small text-muted', text: `${Math.round(usedMb)}/${Math.round(limitMb)} MB` }));
}

/** "read_busy 3, quota 1" for a worker's refusals map, "-" when none. */
export function refusalText(refusals) {
    const entries = Object.entries(refusals || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    return entries.length ? entries.map(([reason, n]) => `${reason} ${n}`).join(', ') : '-';
}

/** Sum the workers' {reason: n} maps. */
export function sumRefusals(workers) {
    const total = {};
    for (const w of workers) {
        for (const [reason, n] of Object.entries(w.refusals || {})) total[reason] = (total[reason] || 0) + n;
    }
    return total;
}

export function workerRows(workers) {
    return workers.map((w) => [
        String(w.pid),
        w.stale ? badge('stale', 'warning') : formatAge(w.age_s),
        formatCount(w.requests),
        w.read_guard ? meter(w.read_guard.in_flight_mb, w.read_guard.budget_mb) : 'idle',
        w.cache ? formatMb(w.cache.memory_mb) : '-',
        refusalText(w.refusals),
    ]);
}

let el = null;
let apiRef = null;

async function load() {
    const data = await apiRef.health.get();
    const workers = data.workers || [];
    const totals = data.totals || {};
    const since = workers.map((w) => w.started).filter(Boolean).sort()[0];
    const active = data.active || [];
    const cacheMax = workers.reduce((sum, w) => sum + ((w.cache && w.cache.max_mb) || 0), 0);
    setChildren(el,
        h('div', { class: 'admin-summary d-flex flex-wrap gap-4 mb-3' },
            h('div', null, h('div', { class: 'text-muted small', text: 'Workers' }),
                h('div', { class: 'fs-5', text: `${workers.length}${since ? ` (since ${formatTimestamp(since).slice(11)})` : ''}` })),
            h('div', null, h('div', { class: 'text-muted small', text: 'Active users' }),
                h('div', { class: 'fs-5', text: String(active.length) })),
            h('div', null, h('div', { class: 'text-muted small', text: 'Cache' }),
                h('div', { class: 'fs-5', text: `${formatMb(totals.cache_mb)} / ${formatMb(cacheMax)}` }))),
        table(['pid', 'Age', 'Requests', 'Read budget', 'Cache', 'Refusals'], workerRows(workers), 'No workers reported.'),
        h('p', { class: 'small' }, h('strong', { text: 'Refusals by reason: ' }), refusalText(sumRefusals(workers))),
        h('p', { class: 'small' }, h('strong', { text: 'Active users: ' }),
            active.length ? active.map((a) => `${a.username} ${formatTimestamp(a.last_seen).slice(11)}`).join(' | ') : 'none'));
}

export default {
    id: 'health',
    title: 'Server health',
    autoRefreshMs: 10000,
    async mount(target, api) {
        el = target;
        apiRef = api;
        await load();
    },
    refresh: () => load(),
};
