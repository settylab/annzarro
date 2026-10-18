/**
 * Data sources section (design 5): the allowed parents and every
 * effective root from GET /admin/data-roots, adding a directory by browsing
 * an allowed parent, removing one an admin added, and a paged look at the
 * datasets inside a root. Below them the Remote datasets card (remote-datasets.js)
 * sets whether the server may read s3://, gs:// and http(s):// stores.
 */

import { h, setChildren, badge, table } from './dom.js';
import { formatTimestamp, formatCount } from './admin-format.js';
import { grantedToText } from './access.js';
import { controlHelp } from './help-catalog.js';
import { KEY as REMOTE_KEY, renderRemoteDatasets } from './remote-datasets.js';

const SOURCE_TEXT = { data_dir: 'data_dir', config: 'config', admin: 'admin' };

/** What the server's `inactive_reason` codes mean; anything else is shown as sent. */
const INACTIVE_TEXT = {
    outside_parents: 'outside every allowed parent',
    missing: 'the directory is missing',
    not_absolute: 'the stored path is not absolute',
};

export const inactiveText = (reason) => INACTIVE_TEXT[reason] || reason || '';

/**
 * The cells of one root's row.
 * @param {Object} root - one entry of `roots`
 * @param {Object} [actions] - the last cell's content (nodes), a fifth column
 * @param {Object} [granted] - `roots` of GET /admin/access; adds the "Granted to" column when given
 */
export function rootRow(root, actions, granted) {
    const reason = inactiveText(root.inactive_reason);
    const path = h('span', null, h('code', { text: root.path }),
        root.active === false ? h('span', { class: 'ms-2' }, badge('inactive', 'warning', reason)) : null,
        root.active === false && reason ? h('div', { class: 'small text-muted', text: reason }) : null);
    const stores = root.stores === undefined || root.stores === null ? '-'
        : `${formatCount(root.stores)}${root.stores_capped ? '+' : ''}`;
    const added = root.added_by ? `${root.added_by}, ${formatTimestamp(root.added_at)}` : '-';
    const cells = [path, SOURCE_TEXT[root.source] || root.source, stores, added];
    if (granted) cells.push(grantedToText(granted, root));
    if (actions !== undefined) cells.push(actions);
    return cells;
}

/** "200 cells x 20 genes" for a listing entry, or the reason it cannot be read. */
export function storeText(entry) {
    if (entry.error) return entry.error;
    if (entry.cells === null || entry.cells === undefined) return '-';
    return `${formatCount(entry.cells)} cells x ${formatCount(entry.genes)} genes`;
}

let el = null;
let apiRef = null;
let ctxRef = {};
// the state of this page between reloads of the table
let confirming = null;      // path of the root whose Remove is awaiting confirmation
let viewing = null;         // {root, folder, entries, offset, more, total, error}
let chooser = null;         // {path, dirs, capped, error}: the add dialog's browse state
let typed = '';
let notice = null;          // {level, text}
let listing = null;         // the last GET /admin/data-roots
let granted = null;         // `roots` of the last GET /admin/access, or null
let remoteKey = null;       // the remote datasets key of the last GET /admin/policy, or {error}

function say(level, text) {
    notice = { level, text };
    if (ctxRef.toast) ctxRef.toast(text, level === 'danger' ? 'danger' : level);
}

const fail = (e) => say('danger', (e && e.message) || 'The request failed.');

async function addRoot(path) {
    try {
        await apiRef.dataRoots.add(path);
        typed = '';
        chooser = null;
        say('success', `Added ${path}.`);
    } catch (e) {
        fail(e);
    }
    await load();
}

async function removeRoot(path) {
    try {
        const out = await apiRef.dataRoots.remove(path);
        const n = out && out.panel_sets_affected;
        say('success', `Removed ${path}.` + (n ? ` ${n} saved panel set${n === 1 ? '' : 's'} named a dataset in it and will not open until it is added again.` : ''));
        if (viewing && viewing.root === path) viewing = null;
        chooser = null;
    } catch (e) {
        fail(e);
    }
    confirming = null;
    await load();
}

async function browse(path) {
    try {
        const out = await apiRef.dataRoots.browse(path);
        chooser = { path: out.path === undefined ? path : out.path, dirs: out.dirs || [], capped: !!out.capped, error: null };
    } catch (e) {
        chooser = { path: path || '', dirs: [], capped: false, error: e.message };
    }
    await load(false);
}

async function listDatasets(root, folder, more) {
    const base = more && viewing && viewing.root === root && viewing.folder === folder ? viewing : null;
    const offset = base ? base.entries.length : 0;
    try {
        const page = await apiRef.dataRoots.datasets({ root, folder, offset });
        viewing = {
            root, folder, offset, total: page.total, more: !!page.more,
            entries: (base ? base.entries : []).concat(page.entries || []), error: null,
        };
    } catch (e) {
        viewing = { root, folder, offset: 0, total: 0, more: false, entries: [], error: e.message };
    }
    await load(false);
}

function actionsCell(root) {
    const buttons = [];
    if (root.active !== false) {
        buttons.push(h('button', {
            type: 'button', class: 'btn btn-sm btn-outline-secondary me-1', data: { action: 'datasets', path: root.path },
            text: 'Datasets', onclick: () => listDatasets(root.path, '', false),
        }));
    }
    if (root.source === 'admin') {
        if (confirming === root.path) {
            buttons.push(h('span', { class: 'small me-2', text: 'Users lose access to its datasets.' }),
                h('button', {
                    type: 'button', class: 'btn btn-sm btn-danger me-1', data: { action: 'confirm-remove', path: root.path },
                    text: 'Remove', onclick: () => removeRoot(root.path),
                }),
                h('button', {
                    type: 'button', class: 'btn btn-sm btn-outline-secondary', text: 'Cancel',
                    onclick: () => { confirming = null; load(false); },
                }));
        } else {
            buttons.push(h('button', {
                type: 'button', class: 'btn btn-sm btn-outline-danger', data: { action: 'remove', path: root.path },
                text: 'Remove', onclick: () => { confirming = root.path; load(false); },
            }));
        }
    }
    return h('span', { class: 'text-nowrap' }, buttons);
}

function chooserView(parents) {
    const input = h('input', {
        type: 'text', class: 'form-control form-control-sm font-monospace', id: 'data-root-path', value: typed,
        placeholder: '/absolute/path/to/a/directory', 'aria-label': 'Directory to add', autocomplete: 'off',
        oninput: (ev) => { typed = ev.target.value; },
    });
    const submit = () => { if (typed.trim()) addRoot(typed.trim()); };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } });
    const here = chooser && chooser.path ? chooser.path : '';
    const up = here ? parentOf(here, parents) : null;
    const rows = chooser ? chooser.dirs.map((d) => h('div', { class: 'd-flex align-items-center py-1 border-bottom', data: { dir: d.path } },
        h('button', {
            type: 'button', class: 'btn btn-link btn-sm p-0 me-3 text-start font-monospace', data: { action: 'open-dir' },
            text: d.name, onclick: () => browse(d.path),
        }),
        d.is_root ? badge('added', 'success') : h('button', {
            type: 'button', class: 'btn btn-sm btn-outline-primary py-0', data: { action: 'use-dir' },
            text: 'Use', onclick: () => { typed = d.path; load(false); },
        }))) : [];
    return h('div', { class: 'card mb-3', id: 'data-root-add', data: { setting: 'data.add-directory' } },
        h('div', { class: 'card-body' },
            h('h2', { class: 'h6' }, 'Add a directory', controlHelp('data.add-directory', { describes: [input] })),
            h('div', { class: 'input-group input-group-sm mb-2' }, input,
                h('button', { type: 'button', class: 'btn btn-primary', id: 'data-root-add-button', text: 'Add', onclick: submit })),
            h('div', { class: 'small text-muted mb-1' },
                'Type a path inside an allowed parent, or browse: ',
                h('button', {
                    type: 'button', class: 'btn btn-link btn-sm p-0', id: 'data-root-browse', text: chooser ? 'start over' : 'browse',
                    onclick: () => browse(''),
                }),
                chooser && here ? h('span', null, ' - ', h('code', { text: here }),
                    up !== null ? h('button', {
                        type: 'button', class: 'btn btn-link btn-sm p-0 ms-2', data: { action: 'up' }, text: 'up',
                        onclick: () => browse(up),
                    }) : null,
                    h('button', {
                        type: 'button', class: 'btn btn-link btn-sm p-0 ms-2', data: { action: 'use-here' }, text: 'use this one',
                        onclick: () => { typed = here; load(false); },
                    })) : null),
            chooser && chooser.error ? h('div', { class: 'text-danger small', text: chooser.error }) : null,
            chooser ? h('div', { class: 'admin-browse' }, rows,
                !rows.length && !chooser.error ? h('div', { class: 'text-muted small', text: 'No subdirectories.' }) : null,
                chooser.capped ? h('div', { class: 'text-muted small', text: 'Only the first entries are shown; type the path instead.' }) : null) : null));
}

/** The directory above `path`, or '' (the list of parents) when `path` is one of them. */
function parentOf(path, parents) {
    if (parents.some((p) => p.path === path)) return '';
    const cut = path.replace(/\/+$/, '').lastIndexOf('/');
    return cut > 0 ? path.slice(0, cut) : null;
}

function datasetsView() {
    if (!viewing) return null;
    const v = viewing;
    const rows = v.entries.map((e) => (e.kind === 'folder'
        ? h('div', { class: 'py-1 border-bottom', data: { entry: e.name } },
            h('button', {
                type: 'button', class: 'btn btn-link btn-sm p-0 font-monospace', text: `${e.name}/`,
                onclick: () => listDatasets(v.root, e.path, false),
            }))
        : h('div', { class: 'py-1 border-bottom d-flex justify-content-between', data: { entry: e.name } },
            h('span', { class: 'font-monospace', text: e.name }),
            h('span', { class: 'small text-muted', text: `${storeText(e)}${e.format ? `, ${e.format}` : ''}` }))));
    return h('div', { class: 'card mb-3', id: 'data-root-datasets' },
        h('div', { class: 'card-body' },
            h('div', { class: 'd-flex justify-content-between' },
                h('h2', { class: 'h6' }, 'Datasets in ', h('code', { text: v.folder || v.root })),
                h('span', null,
                    v.folder ? h('button', {
                        type: 'button', class: 'btn btn-sm btn-outline-secondary me-1', text: 'Up',
                        onclick: () => listDatasets(v.root, parentFolder(v.root, v.folder), false),
                    }) : null,
                    h('button', {
                        type: 'button', class: 'btn btn-sm btn-outline-secondary', text: 'Close',
                        onclick: () => { viewing = null; load(false); },
                    }))),
            v.error ? h('div', { class: 'text-danger small', text: v.error }) : null,
            rows,
            !rows.length && !v.error ? h('div', { class: 'text-muted small', text: 'Nothing here.' }) : null,
            v.more ? h('button', {
                type: 'button', class: 'btn btn-sm btn-link', text: `Show more (${formatCount(v.total - v.entries.length)} left)`,
                onclick: () => listDatasets(v.root, v.folder, true),
            }) : null));
}

/** The folder above `folder` inside `root`; '' when that is the root itself. */
function parentFolder(root, folder) {
    const cut = folder.replace(/\/+$/, '').lastIndexOf('/');
    const up = cut > 0 ? folder.slice(0, cut) : '';
    return up.length > root.length && up.startsWith(root) ? up : '';
}

async function saveRemote(value) {
    const out = await apiRef.policy.set({ [REMOTE_KEY]: value });
    say('success', 'Remote datasets setting saved.');
    remoteKey = (out.keys || []).find((k) => k.name === REMOTE_KEY) || remoteKey;
    await load(false);
}

async function resetRemote() {
    const out = await apiRef.policy.set({ [REMOTE_KEY]: null });
    say('success', 'Remote datasets setting reset to the default.');
    remoteKey = (out.keys || []).find((k) => k.name === REMOTE_KEY) || remoteKey;
    await load(false);
}

function remoteCard() {
    const body = h('div', { class: 'card-body' });
    if (!remoteKey || remoteKey.error) {
        setChildren(body, h('h2', { class: 'h6', text: 'Remote datasets' }),
            h('div', { class: 'text-danger small', text: remoteKey ? remoteKey.error : 'Not loaded.' }));
    } else {
        renderRemoteDatasets(body, remoteKey, { save: saveRemote, reset: resetRemote });
    }
    return h('div', { class: 'card mb-3', id: 'remote-datasets', data: { source: remoteKey && remoteKey.source || '', setting: REMOTE_KEY } }, body);
}

async function load(fetchRoots = true) {
    if (fetchRoots || !listing || !remoteKey) {
        listing = await apiRef.dataRoots.list();
        try {
            granted = (await apiRef.access.overview()).roots;
        } catch {
            granted = null;     // the table stays useful without the column
        }
        try {
            const policy = await apiRef.policy.get();
            remoteKey = (policy.keys || []).find((k) => k.name === REMOTE_KEY) || { error: 'This server does not offer the remote datasets setting.' };
        } catch (e) {
            remoteKey = { error: (e && e.message) || 'The remote datasets setting could not be read.' };
        }
    }
    const data = listing;
    const parents = data.parents || [];
    const roots = data.roots || [];
    const rows = roots.map((r) => rootRow(r, actionsCell(r), granted || undefined));
    setChildren(el,
        data.overlay && data.overlay.ok === false
            ? h('div', { class: 'alert alert-danger', role: 'alert', id: 'data-root-overlay-error' },
                'The admin data directories file cannot be read; only the configured directories are served. ',
                data.overlay.error ? h('code', { text: data.overlay.error }) : null)
            : null,
        notice && !ctxRef.toast ? h('div', { class: `alert alert-${notice.level}`, role: 'status', text: notice.text }) : null,
        h('h2', { class: 'h5', id: 'local-data-heading', text: 'Local data directories' }),
        h('div', { class: 'mb-3', data: { setting: 'data.parents' } },
            h('h2', { class: 'h6' }, 'Allowed parents (server.admin_data_roots)', controlHelp('data.parents')),
            parents.length
                ? h('div', null, parents.map((p) => h('span', { class: 'me-3' }, h('code', { text: p.path }),
                    p.ok === false ? h('span', { class: 'ms-1' }, badge('missing', 'warning')) : null)))
                : h('p', { class: 'text-muted mb-0', text: 'Adding directories is off. Set server.admin_data_roots.' })),
        table(['Directory', 'Source', 'Stores', 'Added', ...(granted ? ['Granted to'] : []), ''], rows),
        datasetsView(),
        parents.length ? chooserView(parents) : null,
        remoteCard());
}

export default {
    id: 'data',
    title: 'Data sources',
    async mount(target, api, ctx = {}) {
        el = target;
        apiRef = api;
        ctxRef = ctx;
        confirming = viewing = chooser = notice = listing = granted = remoteKey = null;
        typed = '';
        await load();
    },
    refresh: () => load(),
};
