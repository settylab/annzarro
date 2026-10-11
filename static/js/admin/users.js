/**
 * Users section (design 5, "Users"): the user table from GET /admin/users.
 * Stub of slice 1: it renders the data; the actions (add, reset password,
 * admin right, unlock, remove) arrive with the Users slice.
 */

import { h, setChildren, badge, table } from './dom.js';
import { formatTimestamp, formatCount } from './admin-format.js';

/** @param {Object} user - one entry of GET /admin/users */
export function lockedCell(user) {
    const locks = Array.isArray(user.locked) ? user.locked : [];
    if (!locks.length) return '-';
    return badge(`${locks.length} ${locks.length === 1 ? 'address' : 'addresses'}`, 'warning',
        locks.map((l) => `${l.address}: ${l.failures} failures`).join('\n'));
}

export function userRows(users, me) {
    return users.map((u) => [
        h('span', null, u.username, u.username === me ? h('span', { class: 'text-muted ms-1', text: '(you)' }) : null),
        u.is_admin ? badge('admin', 'primary') : 'no',
        formatTimestamp(u.last_login),
        formatCount(u.panel_sets),
        lockedCell(u),
        formatTimestamp(u.last_seen),
    ]);
}

let root = null;
let apiRef = null;
let meRef = null;

async function load() {
    const users = await apiRef.users.list();
    setChildren(root,
        h('div', { class: 'd-flex align-items-center mb-2' },
            h('h2', { class: 'h5 mb-0', text: `Users (${users.length})` })),
        table(['User', 'Admin', 'Last login', 'Panel sets', 'Locked', 'Last seen'], userRows(users, meRef && meRef.username)));
}

export default {
    id: 'users',
    title: 'Users',
    async mount(el, api, ctx = {}) {
        root = el;
        apiRef = api;
        meRef = ctx.me || null;
        await load();
    },
    refresh: () => load(),
};
