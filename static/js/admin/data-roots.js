/**
 * Data directories section (design 5): the allowed parents and every
 * effective root from GET /admin/data-roots. Stub of slice 1: listing only.
 */

import { h, setChildren, badge, table } from './dom.js';
import { formatTimestamp, formatCount } from './admin-format.js';

const SOURCE_TEXT = { data_dir: 'data_dir', config: 'config', admin: 'admin' };

/** @param {Object} root - one entry of `roots` */
export function rootRow(root) {
    const path = h('span', null, h('code', { text: root.path }),
        root.active === false ? h('span', { class: 'ms-2' }, badge('inactive', 'warning', root.inactive_reason || '')) : null,
        root.active === false && root.inactive_reason ? h('div', { class: 'small text-muted', text: root.inactive_reason }) : null);
    const stores = root.stores === undefined || root.stores === null ? '-'
        : `${formatCount(root.stores)}${root.stores_capped ? '+' : ''}`;
    const added = root.added_by ? `${root.added_by}, ${formatTimestamp(root.added_at)}` : '-';
    return [path, SOURCE_TEXT[root.source] || root.source, stores, added];
}

let el = null;
let apiRef = null;

async function load() {
    const data = await apiRef.dataRoots.list();
    const parents = data.parents || [];
    setChildren(el,
        h('div', { class: 'mb-3' },
            h('h2', { class: 'h6', text: 'Allowed parents (server.admin_data_roots)' }),
            parents.length
                ? h('div', null, parents.map((p) => h('span', { class: 'me-3' }, h('code', { text: p.path }),
                    p.ok === false ? h('span', { class: 'ms-1' }, badge('missing', 'warning')) : null)))
                : h('p', { class: 'text-muted mb-0', text: 'Adding directories is off. Set server.admin_data_roots.' })),
        table(['Directory', 'Source', 'Stores', 'Added'], (data.roots || []).map(rootRow)));
}

export default {
    id: 'data',
    title: 'Data directories',
    async mount(target, api) {
        el = target;
        apiRef = api;
        await load();
    },
    refresh: () => load(),
};
