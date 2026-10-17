/**
 * Panel sets section (design 5): per-user usage against the quotas, and the
 * table of sets from GET /admin/panel-sets with reassign and delete.
 *
 * Selecting rows offers "reassign to" a user and "delete". With the table
 * filtered to one owner, "reassign all of their sets" moves every set they
 * own, including the ones not on this page. Delete asks for a second click.
 */

import { h, setChildren } from './dom.js';
import { formatBytes, formatCount, formatTimestamp, quotaLevel, quotaPercent } from './admin-format.js';

const PAGE = 1000;

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

/** What the server did, in a sentence for a toast, and its colour. */
export function reassignMessage(reply, to) {
    const moved = `${formatCount(reply.moved)} panel ${reply.moved === 1 ? 'set' : 'sets'} now belong${reply.moved === 1 ? 's' : ''} to ${to}`;
    const same = reply.unchanged ? ` (${formatCount(reply.unchanged)} already did)` : '';
    if (reply.over_quota) return { text: `${moved}${same}. ${to} is now over the per-user limit.`, level: 'warning' };
    return { text: `${moved}${same}.`, level: 'success' };
}

export function deleteMessage(reply) {
    const gone = `${formatCount(reply.deleted)} panel ${reply.deleted === 1 ? 'set' : 'sets'} deleted`;
    const missing = reply.missing && reply.missing.length ? `, ${formatCount(reply.missing.length)} were already gone` : '';
    return `${gone}${missing}.`;
}

let el = null;
let apiRef = null;
let toast = () => {};
const state = { owner: '', offset: 0, text: '', selected: new Set(), target: '', confirming: false, users: [] };

async function run(action, done) {
    try {
        const reply = await action();
        done(reply);
        state.selected = new Set();
        state.confirming = false;
        await load();
    } catch (e) {
        toast(e.message || String(e), 'danger', 0);
        state.confirming = false;
        await load().catch(() => {});
    }
}

const controls = { reassign: null, reassignAll: null, owned: null };

/** Enable the reassign buttons for the current selection and target without redrawing (typing keeps focus). */
function syncActions() {
    if (controls.reassign) controls.reassign.disabled = !(state.selected.size && state.target);
    if (controls.reassignAll) controls.reassignAll.disabled = !(controls.owned && state.target && state.target !== state.owner);
}

function actionBar(data) {
    const count = state.selected.size;
    const parts = [];
    controls.reassign = controls.reassignAll = controls.owned = null;
    // a text box with suggestions: a user who owns no set yet is a valid target too, and the server checks the name
    const known = [...new Set([...state.users, ...(data.usage || []).map((u) => u.owner).filter(Boolean)])].sort();
    const users = h('input', {
        type: 'text', class: 'form-control form-control-sm w-auto', 'aria-label': 'Reassign to', id: 'ps-target',
        placeholder: 'Reassign to user', list: 'ps-users', autocomplete: 'off', value: state.target,
        oninput: (e) => { state.target = e.target.value.trim(); syncActions(); },
    });
    parts.push(h('datalist', { id: 'ps-users' }, known.map((u) => h('option', { value: u }))));
    parts.push(users);
    controls.reassign = h('button', {
        type: 'button', class: 'btn btn-sm btn-primary', id: 'ps-reassign', disabled: !(count && state.target),
        text: count ? `Reassign ${formatCount(count)} selected` : 'Reassign selected',
        onclick: () => run(() => apiRef.panelSets.reassign({ names: [...state.selected], to_owner: state.target }),
            (r) => { const m = reassignMessage(r, state.target); toast(m.text, m.level, m.level === 'warning' ? 0 : undefined); }),
    });
    parts.push(controls.reassign);
    if (state.owner) {
        controls.owned = (data.usage || []).find((u) => u.owner === state.owner);
        controls.reassignAll = h('button', {
            type: 'button', class: 'btn btn-sm btn-outline-primary', id: 'ps-reassign-all',
            disabled: !(controls.owned && state.target && state.target !== state.owner),
            title: `Every set ${state.owner} owns, on every page`,
            text: `Reassign all of ${state.owner}'s ${controls.owned ? formatCount(controls.owned.count) : 0}`,
            onclick: () => run(() => apiRef.panelSets.reassign({ from_owner: state.owner, to_owner: state.target }),
                (r) => { const m = reassignMessage(r, state.target); toast(m.text, m.level, m.level === 'warning' ? 0 : undefined); }),
        });
        parts.push(controls.reassignAll);
    }
    if (state.confirming) {
        parts.push(h('button', {
            type: 'button', class: 'btn btn-sm btn-danger', id: 'ps-delete-confirm',
            text: `Delete ${formatCount(count)} for good`,
            onclick: () => run(() => apiRef.panelSets.remove([...state.selected]), (r) => toast(deleteMessage(r), 'success')),
        }), h('button', {
            type: 'button', class: 'btn btn-sm btn-outline-secondary', text: 'Cancel',
            onclick: () => { state.confirming = false; render(data); },
        }));
    } else {
        parts.push(h('button', {
            type: 'button', class: 'btn btn-sm btn-outline-danger', id: 'ps-delete', disabled: !count,
            text: count ? `Delete ${formatCount(count)} selected` : 'Delete selected',
            onclick: () => { state.confirming = true; render(data); },
        }));
    }
    return h('div', { class: 'd-flex flex-wrap gap-2 align-items-center mb-2', id: 'ps-actions' }, parts);
}

function toolbar(data) {
    const owners = (data.usage || []).map((u) => u.owner).filter(Boolean);
    const filter = h('select', {
        class: 'form-select form-select-sm w-auto', 'aria-label': 'Show owner', id: 'ps-owner',
        onchange: (e) => { state.owner = e.target.value; state.offset = 0; state.selected = new Set(); state.confirming = false; load(); },
    }, h('option', { value: '', text: 'All owners' }), owners.map((o) => h('option', { value: o, text: o })));
    filter.value = state.owner;
    const search = h('input', {
        type: 'search', class: 'form-control form-control-sm w-auto', id: 'ps-search', placeholder: 'Filter by name',
        'aria-label': 'Filter by name', value: state.text,
        oninput: (e) => { state.text = e.target.value; render(data, true); },
    });
    return h('div', { class: 'd-flex flex-wrap gap-2 align-items-center mb-2' }, filter, search);
}

function pager(data) {
    const total = data.total || 0;
    if (total <= PAGE) return null;
    const last = Math.min(state.offset + PAGE, total);
    return h('div', { class: 'd-flex gap-2 align-items-center mb-2' },
        h('button', {
            type: 'button', class: 'btn btn-sm btn-outline-secondary', text: 'Previous', disabled: state.offset === 0,
            onclick: () => { state.offset = Math.max(0, state.offset - PAGE); load(); },
        }),
        h('span', { class: 'small text-muted', text: `${formatCount(state.offset + 1)} to ${formatCount(last)} of ${formatCount(total)}` }),
        h('button', {
            type: 'button', class: 'btn btn-sm btn-outline-secondary', text: 'Next', disabled: last >= total,
            onclick: () => { state.offset += PAGE; load(); },
        }));
}

function setTable(data) {
    const needle = state.text.trim().toLowerCase();
    const shown = (data.items || []).filter((s) => !needle || s.name.toLowerCase().includes(needle));
    const all = h('input', {
        type: 'checkbox', class: 'form-check-input', 'aria-label': 'Select all shown', id: 'ps-select-all',
        checked: shown.length > 0 && shown.every((s) => state.selected.has(s.name)),
        onchange: (e) => {
            for (const s of shown) { if (e.target.checked) state.selected.add(s.name); else state.selected.delete(s.name); }
            state.confirming = false;
            render(data);
        },
    });
    const rows = shown.length
        ? shown.map((s) => h('tr', { class: state.selected.has(s.name) ? 'table-active' : null, data: { name: s.name } },
            h('td', null, h('input', {
                type: 'checkbox', class: 'form-check-input ps-row', 'aria-label': `Select ${s.name}`,
                checked: state.selected.has(s.name),
                onchange: (e) => {
                    if (e.target.checked) state.selected.add(s.name); else state.selected.delete(s.name);
                    state.confirming = false;
                    render(data);
                },
            })),
            setRows([s])[0].map((c) => h('td', null, c))))
        : [h('tr', null, h('td', { colspan: 6, class: 'text-muted', text: 'No panel sets.' }))];
    return h('div', { class: 'table-responsive' },
        h('table', { class: 'table table-sm table-hover align-middle admin-table', id: 'ps-table' },
            h('thead', null, h('tr', null, h('th', { scope: 'col' }, all),
                ['Name', 'Owner', 'Dataset', 'Size', 'Modified'].map((c) => h('th', { scope: 'col', text: c })))),
            h('tbody', null, rows)));
}

function render(data, keepFocus = false) {
    const server = data.server || {};
    const focused = keepFocus ? globalThis.document.activeElement : null;
    setChildren(el,
        h('div', { class: 'd-flex justify-content-between flex-wrap mb-2' },
            h('h2', { class: 'h5 mb-0', text: `Panel sets (${formatCount(data.total)})` }),
            h('div', { class: 'text-muted small', text: server.max
                ? `Server: ${formatCount(server.count)} / ${formatCount(server.max)} sets, ${server.mb} / ${server.max_mb} MB`
                : `Server: ${formatCount(server.count)} sets` })),
        h('div', { class: 'admin-usage-strip mb-3' }, (data.usage || []).map(usageBar)),
        toolbar(data), actionBar(data), setTable(data), pager(data));
    if (focused && focused.id) {
        const again = globalThis.document.getElementById(focused.id);
        if (again) { again.focus(); if (again.setSelectionRange) again.setSelectionRange(again.value.length, again.value.length); }
    }
}

async function load() {
    const query = { limit: PAGE, offset: state.offset || undefined, owner: state.owner || undefined };
    const [data, users] = await Promise.all([apiRef.panelSets.list(query), apiRef.users.list().catch(() => null)]);
    if (users) state.users = users.map((u) => u.username);
    const present = new Set((data.items || []).map((s) => s.name));
    state.selected = new Set([...state.selected].filter((n) => present.has(n)));
    if (state.owner && !(data.usage || []).some((u) => u.owner === state.owner)) state.owner = '';
    render(data);
}

export default {
    id: 'panel-sets',
    title: 'Panel sets',
    async mount(target, api, ctx = {}) {
        el = target;
        apiRef = api;
        toast = ctx.toast || (() => {});
        Object.assign(state, { owner: '', offset: 0, text: '', selected: new Set(), target: '', confirming: false });
        await load();
    },
    refresh: () => load(),
};
