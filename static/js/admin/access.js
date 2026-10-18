/**
 * A user's access (design 9.6): whether they are restricted to chosen
 * datasets, the grants that make up what they may read, what that adds up to,
 * a check of one path, and their policy overrides (settings.js).
 *
 * Opened from the Users table as a panel above it. The Users table and the
 * Data directories table show the one-line summaries from GET /admin/access
 * (`accessCell`, `grantedToCell`). Every change goes to the server, which
 * decides; the panel then reloads what the server says. A restriction with no
 * grants reads nothing, and the panel says so.
 */

import { h, setChildren, badge, table } from './dom.js';
import { formatTimestamp, formatCount } from './admin-format.js';
import { mountUserPolicy } from './settings.js';
import { controlHelp } from './help-catalog.js';

/** The grant forms offered, in order: the label, and the `kind` the server takes. */
export const GRANT_MODES = [
    { id: 'dir', kind: 'dir', label: 'this folder', placeholder: '/path/to/a/folder' },
    { id: 'stores_in', kind: 'stores_in', label: 'every store in this folder', placeholder: '/path/to/a/folder' },
    { id: 'store', kind: 'store', label: 'one store', placeholder: '/path/to/dataset.zarr' },
    { id: 'remote', kind: 'remote', label: 'remote prefix', placeholder: 's3://bucket/prefix/' },
];

const KIND_TEXT = { dir: 'folder', store: 'store', remote: 'remote prefix' };

/** What the server's `inactive_reason` codes mean; anything else is shown as sent. */
const REASON_TEXT = {
    outside_data_directories: 'outside every data directory',
    remote_stores_disabled: 'remote stores are off',
    outside_remote_allowlist: 'outside the remote allowlist',
    invalid_url: 'not a valid URL',
    not_absolute: 'the stored path is not absolute',
    malformed: 'malformed',
};

export const kindText = (kind) => KIND_TEXT[kind] || String(kind);
export const reasonText = (reason) => REASON_TEXT[reason] || reason || '';

/**
 * The one-line summary of a user's access.
 * @param {Object|undefined} entry - one value of `users` in GET /admin/access
 * @returns {string}
 */
export function summaryText(entry) {
    if (!entry) return '-';
    if (entry.restricted === null || entry.restricted === undefined) return 'unknown';
    if (!entry.restricted) return 'all';
    const n = entry.grants || 0;
    const idle = n - (entry.active || 0);
    const text = `restricted: ${n} ${n === 1 ? 'grant' : 'grants'}`;
    return idle > 0 ? `${text} (${idle} inactive)` : text;
}

/**
 * The Access cell of the Users table.
 * @param {Object|undefined} entry
 */
export function accessCell(entry) {
    const text = summaryText(entry);
    const extras = [];
    if (entry && entry.restricted && !(entry.active > 0)) extras.push(badge('reads nothing', 'danger'));
    if (entry && entry.policy_overrides > 0) {
        extras.push(badge(`${entry.policy_overrides} ${entry.policy_overrides === 1 ? 'override' : 'overrides'}`, 'info',
            'This user has settings of their own.'));
    }
    return h('span', { class: 'text-nowrap', data: { access: text } }, text, extras.map((b) => h('span', { class: 'ms-1' }, b)));
}

/**
 * The "Granted to" cell of one data directory: restricted users with a grant in it.
 * @param {Object|undefined} roots - `roots` of GET /admin/access, {real path: [users]}
 * @param {Object} root - one entry of GET /admin/data-roots
 * @returns {string}
 */
export function grantedToText(roots, root) {
    const names = roots && root && root.real ? roots[root.real] : null;
    return names && names.length ? names.join(', ') : '-';
}

/**
 * The request for a grant form.
 * @param {string} mode - a GRANT_MODES id
 * @param {string} path
 * @returns {{kind: string, path: string}|null} null when nothing was typed
 */
export function grantRequest(mode, path) {
    const spec = GRANT_MODES.find((m) => m.id === mode);
    const text = String(path || '').trim();
    return spec && text ? { kind: spec.kind, path: text } : null;
}

/** "14 stores" or "at least 5,000 stores" for the effective-access line. */
export function storesText(stores) {
    if (!stores) return '';
    const n = stores.total || 0;
    return `${stores.capped ? 'at least ' : ''}${formatCount(n)} ${n === 1 ? 'store' : 'stores'}`;
}

/** The warning shown before a restriction changes. */
export function confirmText(username, kind) {
    return kind === 'restrict'
        ? `${username} has no active grant, so ${username} will lose access to everything now, until you add a grant.`
        : `${username} will be able to read every dataset in the data directories.`;
}

/** A sentence for the answer of the check tool. */
export function checkText(result) {
    if (!result) return '';
    return `${result.allowed ? 'Allowed' : 'Not allowed'}: ${result.reason || ''}`.trim();
}

/** "added 2 grants" and the stores that were skipped, for a toast. */
export function grantedText(reply, path) {
    const added = (reply && reply.added) || [];
    const skipped = (reply && reply.skipped) || [];
    const base = added.length === 1 ? `Granted ${added[0].path}.` : `Granted ${added.length} stores in ${path}.`;
    return skipped.length ? `${base} ${skipped.length} skipped.` : base;
}

const button = (text, onclick, { tone = 'outline-secondary', name, disabled = false, title } = {}) => h('button', {
    type: 'button', class: `btn btn-sm btn-${tone} me-1`, text, onclick, disabled, title, data: name ? { action: name } : undefined,
});

/**
 * Mount the panel.
 * @param {HTMLElement} target - emptied and filled
 * @param {Object} api - the admin API client
 * @param {string} username
 * @param {Object} [ctx] - {toast, onChange(): called after a change, onClose(): the Close button}
 * @returns {Promise<{refresh: function}>}
 */
export async function mountAccessPanel(target, api, username, ctx = {}) {
    let info = null;
    let loadError = '';
    let mode = 'dir';
    let typed = '';
    let browse = null;        // {roots|entries, folder, root, error}
    let showStores = false;
    let storeItems = [];
    let checkPath = '';
    let checked = null;       // {result|error}
    let error = '';
    let confirming = null;    // 'restrict' | 'unrestrict': the change awaiting its second click
    const policyHost = h('div', { id: 'access-policy' });
    const say = (message, level = 'success') => { if (ctx.toast) ctx.toast(message, level); };

    async function load() {
        try {
            info = await api.access.get(username);
            loadError = '';
            storeItems = info.stores ? info.stores.items.slice() : [];
        } catch (e) {
            info = null;
            loadError = (e && e.message) || 'Could not load the access of this user.';
        }
        draw();
    }

    async function changed() {
        await load();
        if (ctx.onChange) await ctx.onChange();
    }

    async function attempt(work) {
        error = '';
        try {
            await work();
            return true;
        } catch (e) {
            error = (e && e.message) || 'The change failed.';
            draw();
            return false;
        }
    }

    const setRestricted = (on) => attempt(async () => {
        await api.access.setRestricted(username, on);
        say(on ? `${username} now reads only what is granted.` : `${username} reads every dataset again.`);
        await changed();
    });

    // One click on the box never changes who can read what: widening always asks, and so does
    // restricting a user who has no active grant (they lose everything at once).
    function askBeforeChange(on) {
        const noGrant = !(info.grants || []).some((g) => g.active);
        if (!on || noGrant) {
            confirming = on ? 'restrict' : 'unrestrict';
            draw();
            return null;
        }
        return setRestricted(true);
    }

    const confirmChange = async () => {
        const on = confirming === 'restrict';
        confirming = null;
        await setRestricted(on);
        draw();
    };

    const grant = () => {
        const req = grantRequest(mode, typed);
        if (!req) {
            error = 'Type or choose a path first.';
            draw();
            return null;
        }
        return attempt(async () => {
            const reply = await api.access.grant(username, req.kind, req.path);
            say(grantedText(reply, req.path));
            typed = '';
            await changed();
        });
    };

    const revoke = (path) => attempt(async () => {
        await api.access.revoke(username, path);
        say(`Revoked ${path}.`);
        await changed();
    });

    async function moreStores() {
        try {
            const page = await api.access.get(username, { offset: storeItems.length });
            storeItems = storeItems.concat(page.stores.items);
            info.stores.total = page.stores.total;
            info.stores.capped = page.stores.capped;
        } catch (e) {
            error = (e && e.message) || 'Could not load more stores.';
        }
        draw();
    }

    async function runCheck() {
        const path = checkPath.trim();
        if (!path) return;
        try {
            checked = { result: await api.access.check(username, path) };
        } catch (e) {
            checked = { error: (e && e.message) || 'The check failed.' };
        }
        draw();
    }

    // the folder browser: the data directories, then the folders and stores below one
    async function open(rootReal, folder) {
        try {
            if (!rootReal) {
                const listing = await api.dataRoots.list();
                browse = { roots: (listing.roots || []).filter((r) => r.active), error: '' };
            } else {
                const page = await api.dataRoots.datasets({ root: rootReal, folder });
                browse = { root: rootReal, folder: folder || rootReal, entries: page.entries || [], more: !!page.more, error: '' };
            }
        } catch (e) {
            browse = { roots: [], error: (e && e.message) || 'Could not list the data directories.' };
        }
        draw();
    }

    const use = (path, nextMode) => { typed = path; if (nextMode) mode = nextMode; draw(); };

    function grantsTable() {
        const rows = (info.grants || []).map((g) => [
            kindText(g.kind),
            h('span', null, h('code', { text: g.path }),
                g.active ? null : h('div', { class: 'small text-warning', text: `inactive: ${reasonText(g.inactive_reason)}` })),
            g.active ? 'yes' : badge('no', 'warning', reasonText(g.inactive_reason)),
            g.added_by ? `${g.added_by}, ${formatTimestamp(g.added_at)}` : '-',
            button('Revoke', () => revoke(g.path), { tone: 'outline-danger', name: 'revoke' }),
        ]);
        const t = table(['Kind', 'Path', 'Active', 'Added', ''], rows, 'No grants.');
        t.setAttribute('id', 'access-grants');
        return t;
    }

    function browser() {
        if (!browse) return null;
        let body;
        if (browse.roots) {
            body = browse.roots.map((r) => h('div', { class: 'py-1 border-bottom', data: { dir: r.real } },
                h('button', { type: 'button', class: 'btn btn-link btn-sm p-0 font-monospace', data: { action: 'open-dir' },
                    text: r.path, onclick: () => open(r.real, '') })));
        } else {
            const up = browse.folder !== browse.root
                ? button('Up', () => open(browse.root, browse.folder.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || browse.root),
                    { name: 'browse-up' }) : button('Roots', () => open(null), { name: 'browse-roots' });
            body = [h('div', { class: 'mb-1' }, up, h('code', { text: browse.folder })),
                ...browse.entries.map((e) => h('div', { class: 'py-1 border-bottom d-flex justify-content-between', data: { entry: e.name } },
                    e.kind === 'folder'
                        ? h('button', { type: 'button', class: 'btn btn-link btn-sm p-0 font-monospace', data: { action: 'open-dir' },
                            text: `${e.name}/`, onclick: () => open(browse.root, e.path) })
                        : h('span', { class: 'font-monospace', text: e.name }),
                    button('Use', () => use(e.path, e.kind === 'folder' ? (mode === 'stores_in' ? 'stores_in' : 'dir') : 'store'),
                        { name: 'use-entry' }))),
                button('Use this folder', () => use(browse.folder, mode === 'stores_in' ? 'stores_in' : 'dir'), { name: 'use-here' })];
            if (browse.more) body.push(h('div', { class: 'small text-muted', text: 'Only the first entries are shown; type the path instead.' }));
        }
        return h('div', { class: 'admin-browse border rounded p-2 mb-2', id: 'access-browse' },
            browse.error ? h('div', { class: 'text-danger small', text: browse.error }) : null, body);
    }

    function grantForm() {
        const spec = GRANT_MODES.find((m) => m.id === mode);
        const input = h('input', {
            type: 'text', class: 'form-control form-control-sm font-monospace', id: 'access-grant-path', value: typed,
            placeholder: spec.placeholder, 'aria-label': 'Path to grant', autocomplete: 'off',
            oninput: (ev) => { typed = ev.target.value; },
        });
        input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); grant(); } });
        return h('div', { class: 'mb-3', id: 'access-grant-form', data: { setting: 'access.grant' } },
            h('div', { class: 'small fw-semibold mb-1' }, 'Grant', controlHelp('access.grant', { describes: [input] })),
            h('div', { class: 'mb-1' }, GRANT_MODES.map((m) => h('span', { class: 'form-check form-check-inline' },
                h('input', {
                    class: 'form-check-input', type: 'radio', name: 'access-mode', id: `access-mode-${m.id}`, checked: m.id === mode,
                    onchange: () => { mode = m.id; draw(); },
                }),
                h('label', { class: 'form-check-label', for: `access-mode-${m.id}`, text: m.label })))),
            h('div', { class: 'input-group input-group-sm mb-1' }, input,
                h('button', { type: 'button', class: 'btn btn-primary', id: 'access-grant-button', text: 'Grant', onclick: grant })),
            mode === 'remote' ? null : button('Browse data directories', () => open(null), { name: 'browse' }),
            browser());
    }

    function effective() {
        const stores = info.stores;
        const grants = info.grants || [];
        const live = grants.filter((g) => g.active).length;
        const head = h('div', { class: 'small mb-1', id: 'access-effective' },
            `Effective: ${live} ${live === 1 ? 'grant' : 'grants'}, ${storesText(stores)}`,
            info.remote_prefixes ? `, ${info.remote_prefixes} remote ${info.remote_prefixes === 1 ? 'prefix' : 'prefixes'}` : '',
            ' ', button(showStores ? 'hide' : 'show', () => { showStores = !showStores; draw(); }, { name: 'toggle-stores' }));
        if (!showStores) return head;
        const list = storeItems.map((s) => h('div', { class: 'font-monospace small', data: { store: s.name } }, s.path));
        return h('div', null, head, h('div', { class: 'border rounded p-2 mb-2' }, list,
            !list.length ? h('div', { class: 'text-muted small', text: 'No stores.' }) : null,
            storeItems.length < (stores.total || 0)
                ? button('Show more', moreStores, { name: 'more-stores' }) : null));
    }

    function checker() {
        const input = h('input', {
            type: 'text', class: 'form-control form-control-sm font-monospace', id: 'access-check-path', value: checkPath,
            placeholder: '/path/to/dataset.zarr', 'aria-label': 'Path to check', autocomplete: 'off',
            oninput: (ev) => { checkPath = ev.target.value; },
        });
        input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); runCheck(); } });
        const result = checked && checked.result
            ? h('div', { class: `small mt-1 ${checked.result.allowed ? 'text-success' : 'text-danger'}`, id: 'access-check-result',
                data: { allowed: checked.result.allowed }, text: checkText(checked.result) })
            : checked && checked.error ? h('div', { class: 'small mt-1 text-danger', id: 'access-check-result', text: checked.error }) : null;
        return h('div', { class: 'mb-3', data: { setting: 'access.check' } },
            h('div', { class: 'small fw-semibold mb-1' }, 'Check a path', controlHelp('access.check', { describes: [input] })),
            h('div', { class: 'input-group input-group-sm' }, input,
                h('button', { type: 'button', class: 'btn btn-outline-secondary', id: 'access-check-button', text: 'Check', onclick: runCheck })),
            result);
    }

    function draw() {
        const head = h('div', { class: 'd-flex align-items-center mb-2' },
            h('h3', { class: 'h6 mb-0', text: `Access of ${username}` }),
            h('span', { class: 'ms-auto' }, button('Close', () => { if (ctx.onClose) ctx.onClose(); }, { name: 'close-access' })));
        const failure = error ? h('div', { class: 'invalid-feedback d-block mb-2', role: 'alert', id: 'access-error', text: error }) : null;
        if (!info) {
            setChildren(target, head, h('div', { class: 'alert alert-danger', role: 'alert', id: 'access-load-error', text: loadError }),
                button('Retry', load, { name: 'retry-access' }));
            return;
        }
        const admin = !!info.is_admin;
        const on = h('input', { class: 'form-check-input', type: 'checkbox', id: 'access-restricted', checked: !!info.restricted, disabled: admin });
        on.addEventListener('change', () => {
            const wanted = on.checked;
            on.checked = !!info.restricted;       // the server decides; the box follows what it says
            askBeforeChange(wanted);
        });
        const confirmBox = confirming ? h('div', { class: 'alert alert-warning py-2 mb-2', role: 'alert', id: 'access-confirm-box' },
            h('div', { class: 'mb-1', text: confirmText(username, confirming) }),
            button(confirming === 'restrict' ? 'Restrict now' : 'Allow everything', confirmChange,
                { tone: 'warning', name: 'confirm-access' }),
            button('Cancel', () => { confirming = null; draw(); }, { name: 'cancel-access' })) : null;
        const note = admin
            ? 'Administrators read every dataset the server serves. They cannot be restricted.'
                + (info.stored_restricted ? ' Stored as restricted: that applies again if their admin right is revoked.' : '')
            : info.restricted
                ? ((info.grants || []).some((g) => g.active) ? null : 'Restricted with no active grant: this user reads nothing.')
                : 'Not restricted: this user reads every dataset in the data directories. Grants below apply once you restrict them.';
        setChildren(target, head, failure,
            h('div', { class: 'form-check mb-2', data: { setting: 'access.restricted' } }, on,
                h('label', { class: 'form-check-label', for: 'access-restricted', text: 'Restricted to these datasets' }),
                controlHelp('access.restricted', { describes: [on] })),
            confirmBox,
            note ? h('div', { class: `small mb-2 ${info.restricted && !admin ? 'text-danger' : 'text-muted'}`, id: 'access-note', text: note }) : null,
            admin ? null : [grantsTable(), grantForm(), effective()],
            checker(),
            h('div', { class: 'small fw-semibold mb-1', text: `Settings for ${username}` }),
            policyHost);
    }

    await load();
    try {
        await mountUserPolicy(policyHost, api, username, ctx);
    } catch (e) {
        setChildren(policyHost, h('div', { class: 'text-danger small', id: 'access-policy-error', text: (e && e.message) || 'Could not load the settings.' }));
    }
    return { refresh: load };
}
