/**
 * Panel sets section (design 5): per-user usage and the table of sets from
 * GET /admin/panel-sets. Stub of slice 1: no selection, reassign or delete yet.
 */

import { h, setChildren, table } from './dom.js';
import { formatBytes, formatCount, formatTimestamp, quotaLevel, quotaPercent } from './admin-format.js';

/** One "alice 300/500" bar of the quota strip. */
export function usageBar(u) {
    const pct = quotaPercent(u.count, u.limit);
    return h('div', { class: 'admin-usage' },
        h('span', { class: 'admin-usage-name', text: u.owner || '(none)' }),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
            h('div', { class: `progress-bar bg-${quotaLevel(pct)}`, style: `width: ${pct}%` })),
        h('span', { class: 'small text-muted', text: u.limit ? `${u.count}/${u.limit}` : String(u.count) }));
}

export function setRows(items) {
    return items.map((s) => [
        s.name, s.owner || '-', h('code', { text: s.dataset || '-' }), formatBytes(s.bytes),
        `${formatTimestamp(s.modified_at)}${s.modified_by ? ` ${s.modified_by}` : ''}`,
    ]);
}

let el = null;
let apiRef = null;

async function load() {
    const data = await apiRef.panelSets.list({ limit: 1000 });
    const server = data.server || {};
    setChildren(el,
        h('div', { class: 'd-flex justify-content-between flex-wrap mb-2' },
            h('h2', { class: 'h5 mb-0', text: `Panel sets (${formatCount(data.total)})` }),
            h('div', { class: 'text-muted small', text: server.max
                ? `Server: ${formatCount(server.count)} / ${formatCount(server.max)} sets, ${server.mb} / ${server.max_mb} MB`
                : `Server: ${formatCount(server.count)} sets` })),
        h('div', { class: 'admin-usage-strip mb-3' }, (data.usage || []).map(usageBar)),
        table(['Name', 'Owner', 'Dataset', 'Size', 'Modified'], setRows(data.items || [])));
}

export default {
    id: 'panel-sets',
    title: 'Panel sets',
    async mount(target, api) {
        el = target;
        apiRef = api;
        await load();
    },
    refresh: () => load(),
};
