/**
 * Server health section (design 5, 2.5): workers, caches, memory, refusals and active
 * users from GET /admin/health. Refreshes every 10 s while the tab is visible
 * (the router reads `autoRefreshMs`). "Clear cache" asks once, then empties the caches of every
 * worker (POST /admin/cache/clear, audited). The "Description search" block shows the state of the index
 * the dataset browser searches, with "Rebuild now" (POST /admin/text-index/rebuild, audited).
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

/** "480 MB" for a worker's result caches, plus its name indices when it holds any. */
export function cacheText(cache) {
    if (!cache) return '-';
    return cache.name_index_mb >= 1 ? `${formatMb(cache.memory_mb)} + ${formatMb(cache.name_index_mb)} names` : formatMb(cache.memory_mb);
}

export function workerRows(workers) {
    return workers.map((w) => [
        String(w.pid),
        w.stale ? badge('stale', 'warning', 'No report for over a minute: the worker is stuck, or it ran on another host and is gone')
            : formatAge(w.age_s),
        formatCount(w.requests),
        w.read_guard ? meter(w.read_guard.in_flight_mb, w.read_guard.budget_mb) : 'idle',
        cacheText(w.cache),
        formatMb(w.rss_mb),
        refusalText(w.refusals),
    ]);
}

/** The state of the description index in words. */
export function searchStateText(info) {
    if (!info.enabled) return 'Off (Settings, "Search descriptions and READMEs")';
    if (info.state === 'running') return 'Building';
    if (info.state === 'failed') return 'The last build failed';
    if (info.complete) return 'Up to date';
    if (info.state === 'idle' && !info.built_at) return 'Waiting for its first build';
    return 'Not complete, the server continues';
}

/** The "Description search" block: state, how many datasets are searchable, not yet, or unreadable, when it was
 *  built, and the button that builds it now. Nothing when the server did not report it. */
export function descriptionSearchBlock(info, rebuild) {
    if (!info) return null;
    const running = info.state === 'running';
    return h('div', { class: 'small mb-3', id: 'admin-description-search' },
        h('div', { class: 'd-flex flex-wrap align-items-center gap-3' },
            h('strong', { text: 'Description search' }),
            h('span', { id: 'admin-description-state', text: searchStateText(info) }),
            h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', id: 'admin-description-rebuild', text: running ? 'Building...' : 'Rebuild now',
                disabled: !info.enabled || running, onclick: rebuild })),
        info.enabled ? h('div', { class: 'text-muted', id: 'admin-description-counts',
            text: `${formatCount(info.searchable)} searchable, ${formatCount(info.not_yet)} not yet, ${formatCount(info.unreadable)} unreadable; `
                + (info.built_at ? `last built ${formatTimestamp(new Date(info.built_at * 1000).toISOString())}` : 'not built yet') + (info.capped ? '; more datasets than the size limit allows' : '') }) : null);
}

let body = null;
let bar = null;
let apiRef = null;
let ctxRef = null;

function askToClear() {
    setChildren(bar,
        h('span', { class: 'me-2', text: 'Clear the cache of every worker? Open datasets are read from disk again.' }),
        h('button', { type: 'button', class: 'btn btn-sm btn-danger me-2', id: 'admin-cache-confirm', text: 'Yes, clear', onclick: clear }),
        h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', text: 'Cancel', onclick: drawButton }));
}

async function clear() {
    setChildren(bar, h('span', { class: 'text-muted', text: 'Clearing...' }));
    try {
        await apiRef.health.clearCache();
        if (ctxRef && ctxRef.toast) ctxRef.toast('Cache cleared.', 'success');
    } finally {
        drawButton();
    }
    await load();
}

async function rebuildIndex() {
    try {
        await apiRef.health.rebuildTextIndex();
        if (ctxRef && ctxRef.toast) ctxRef.toast('Description search: building the index.', 'success');
    } finally {
        await load();
    }
}

function drawButton() {
    setChildren(bar, h('button', { type: 'button', class: 'btn btn-sm btn-outline-danger', id: 'admin-cache-clear', text: 'Clear cache', onclick: askToClear }));
}

async function load() {
    const data = await apiRef.health.get();
    const workers = data.workers || [];
    const totals = data.totals || {};
    const since = workers.map((w) => w.started).filter(Boolean).sort()[0];
    const active = data.active || [];
    const cacheMax = workers.reduce((sum, w) => sum + ((w.cache && w.cache.max_mb) || 0), 0);
    setChildren(body,
        h('div', { class: 'admin-summary d-flex flex-wrap gap-4 mb-3' },
            h('div', null, h('div', { class: 'text-muted small', text: 'Workers' }),
                h('div', { class: 'fs-5', id: 'admin-health-workers', text: `${workers.length}${since ? ` (since ${formatTimestamp(since).slice(11)})` : ''}` })),
            h('div', null, h('div', { class: 'text-muted small', text: data.window_s ? `Active users (last ${formatAge(data.window_s)})` : 'Active users' }),
                h('div', { class: 'fs-5', text: String(active.length) })),
            h('div', null, h('div', { class: 'text-muted small', text: 'Cache' }),
                h('div', { class: 'fs-5', text: `${formatMb(totals.cache_mb)} / ${formatMb(cacheMax)}` })),
            typeof totals.rss_mb === 'number' ? h('div', null, h('div', { class: 'text-muted small', text: 'Memory' }),
                h('div', { class: 'fs-5', text: formatMb(totals.rss_mb) })) : null),
        table(['pid', 'Age', 'Requests', 'Read budget', 'Cache', 'Memory', 'Refusals'], workerRows(workers), 'No workers reported.'),
        panelSetsLine(data.panel_sets),
        descriptionSearchBlock(data.description_search, rebuildIndex),
        warningsBlock(data.warnings),
        h('p', { class: 'small' }, h('strong', { text: 'Refusals by reason: ' }), refusalText(sumRefusals(workers))),
        h('p', { class: 'small' }, h('strong', { text: 'Top readers now: ' }), readersText(workers)),
        h('p', { class: 'small' }, h('strong', { text: 'Active users: ' }),
            active.length ? active.map((a) => `${a.username} ${formatTimestamp(a.last_seen).slice(11)}`).join(' | ') : 'none'));
}

/** Server warnings (state kept inside a data root); nothing when there are none. */
export function warningsBlock(warnings) {
    if (!warnings || !warnings.length) return null;
    return h('div', { class: 'small text-break', id: 'admin-health-warnings' },
        ...warnings.map((w) => h('p', { class: 'mb-1' }, badge('warning', 'warning', 'Server warning'), h('span', { class: 'ms-2', text: w }))));
}

/** The "Panel sets:" paragraph: where they are kept; a legacy location says so, with the server's note
 *  (which names `annzarro panel-sets migrate`). Nothing when the server did not report it. */
export function panelSetsLine(info) {
    if (!info || !info.path) return null;
    return h('p', { class: 'small text-break', id: 'admin-health-panel-sets' },
        h('strong', { text: 'Panel sets: ' }), h('code', { text: info.path }),
        info.legacy ? h('span', { class: 'ms-2' }, badge('legacy', 'warning', 'Panel sets are still in the data directory')) : null,
        info.note ? h('span', { class: `ms-2 ${info.legacy ? '' : 'text-muted'}`, id: 'admin-health-panel-sets-note', text: info.note }) : null);
}

/** "bob 410 MB (share 512 MB)" for the largest holders of the read budget, over all workers. */
export function readersText(workers) {
    const held = [];
    for (const w of workers) {
        const guard = w.read_guard || {};
        for (const r of guard.by_requester || []) held.push({ who: r.who, mb: r.mb, share: guard.share_mb });
    }
    held.sort((a, b) => b.mb - a.mb);
    return held.length ? held.slice(0, 5).map((r) => `${r.who} ${formatMb(r.mb)} (share ${formatMb(r.share)})`).join(' | ') : 'none';
}

export default {
    id: 'health',
    title: 'Server health',
    autoRefreshMs: 10000,
    async mount(target, api, ctx) {
        apiRef = api;
        ctxRef = ctx;
        bar = h('div', { class: 'mb-3' });
        body = h('div');
        setChildren(target, bar, body);
        drawButton();
        await load();
    },
    refresh: () => load(),
};
