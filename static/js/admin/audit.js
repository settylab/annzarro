/**
 * Audit log section (design 2.2, 5): chain status and records from
 * GET /admin/audit, newest first, "Load older" pages back by `before_seq`.
 */

import { h, setChildren, badge } from './dom.js';
import { formatTimestamp } from './admin-format.js';

const PAGE = 100;

/** The record's detail object as `{a:1,b:false}` text, empty when none. */
export function detailText(detail) {
    if (!detail || typeof detail !== 'object' || !Object.keys(detail).length) return '';
    return JSON.stringify(detail);
}

/** @param {Object} r - one audit record */
export function recordRow(r) {
    const refused = typeof r.outcome === 'string' && r.outcome.startsWith('refused');
    return h('tr', { class: refused ? 'table-warning' : '' },
        h('td', { class: 'text-nowrap', text: formatTimestamp(r.ts) }),
        h('td', null, r.actor || '-', h('span', { class: 'text-muted', text: r.addr ? ` @${r.addr}` : '' }),
            r.via && r.via !== 'web' ? h('span', { class: 'ms-1' }, badge(r.via, 'secondary')) : null),
        h('td', null, h('code', { text: r.action })),
        h('td', { text: r.target || '' }),
        h('td', null, h('code', { class: 'admin-detail', text: detailText(r.detail) })),
        h('td', { class: 'text-nowrap', text: r.outcome || '' }));
}

/** The chain line: verified through `seq`, or the first bad record. */
export function chainText(chain, newestSeq) {
    if (!chain) return 'Chain not checked.';
    if (chain.ok) return `Chain verified OK${newestSeq ? ` through seq ${newestSeq}` : ''}.`;
    return `Chain BROKEN at seq ${chain.first_bad_seq}.`;
}

let el = null;
let apiRef = null;
let records = [];
let chain = null;
let exhausted = false;

function draw() {
    const newest = records.length ? records[0].seq : 0;
    setChildren(el,
        h('div', { class: `alert ${chain && chain.ok ? 'alert-success' : 'alert-danger'} py-2`, role: 'status', text: chainText(chain, newest) }),
        h('div', { class: 'table-responsive' }, h('table', { class: 'table table-sm align-middle admin-table' },
            h('thead', null, h('tr', null, ['Time', 'Actor', 'Action', 'Target', 'Detail', 'Outcome'].map((c) => h('th', { scope: 'col', text: c })))),
            h('tbody', null, records.length ? records.map(recordRow)
                : h('tr', null, h('td', { colspan: 6, class: 'text-muted', text: 'No records yet.' }))))),
        exhausted || !records.length ? null : h('button', {
            type: 'button', class: 'btn btn-outline-secondary btn-sm', text: 'Load older',
            onclick: async () => { await loadPage(records[records.length - 1].seq); },
        }));
}

async function loadPage(beforeSeq) {
    const data = await apiRef.audit.list({ before_seq: beforeSeq, limit: PAGE });
    const page = data.records || [];
    records = beforeSeq ? records.concat(page) : page;
    chain = data.chain || chain;
    exhausted = page.length < PAGE;
    draw();
}

export default {
    id: 'audit',
    title: 'Audit log',
    async mount(target, api) {
        el = target;
        apiRef = api;
        await loadPage(undefined);
    },
    refresh: () => loadPage(undefined),
};
