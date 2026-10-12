/**
 * Users section (design 5, "Users"): the user table from GET /admin/users and
 * the actions on it: add, reset password, grant or revoke admin, unlock and
 * remove.
 *
 * A generated password is shown once, in a notice that is only ever held in
 * this module's memory: closing it, or leaving the section, drops it.
 * The server refuses removing or demoting the last admin or yourself; the
 * buttons are disabled in those cases too, with the reason as a tooltip, but
 * the server is what enforces it.
 */

import { h, setChildren, badge, table } from './dom.js';
import { formatTimestamp, formatCount, isValidUsername } from './admin-format.js';

/** @param {Object} user - one entry of GET /admin/users */
export function lockedCell(user) {
    const locks = Array.isArray(user.locked) ? user.locked : [];
    if (!locks.length) return '-';
    return badge(`${locks.length} ${locks.length === 1 ? 'address' : 'addresses'}`, 'warning',
        locks.map((l) => `${l.address}: ${l.failures} failures`).join('\n'));
}

/**
 * Why an admin right or an account cannot be taken from `user`, or '' when it can.
 * @param {Object} user
 * @param {Object[]} users - the whole table
 * @param {string|null} me - the signed-in username
 */
export function protectedReason(user, users, me) {
    if (user.username === me) return 'Your own account: use another administrator or the command line.';
    const admins = users.filter((u) => u.is_admin).length;
    if (user.is_admin && admins <= 1) return 'The last administrator.';
    return '';
}

/**
 * The rows of the table. `actions(user)` supplies the last cell (a node or
 * nothing); without it the table is read-only.
 * @param {Object[]} users
 * @param {string|null} me
 * @param {function(Object): (Node|null)} [actions]
 */
export function userRows(users, me, actions) {
    return users.map((u) => {
        const cells = [
            h('span', null, u.username, u.username === me ? h('span', { class: 'text-muted ms-1', text: '(you)' }) : null),
            u.is_admin ? badge('admin', 'primary') : 'no',
            formatTimestamp(u.last_login),
            formatCount(u.panel_sets),
            lockedCell(u),
            formatTimestamp(u.last_seen),
        ];
        if (actions) cells.push(actions(u));
        return cells;
    });
}

let root = null;
let apiRef = null;
let meRef = null;
let toastRef = null;
let users = [];
/** What is open above the table: {kind: 'add'|'reset'|'remove', user?}. */
let open = null;
/** The one-time password notice: {username, password}. Memory only. */
let secret = null;

const say = (message, level = 'success') => { if (toastRef) toastRef(message, level); };

/** The change was made but the server could not write its audit record (it is in the server log). */
function warnIfUnaudited(reply) {
    if (reply && reply.audit_failed) say('The change was made, but the audit record could not be written. Tell the operator (see the server log).', 'warning');
    if (reply && reply.reassign_failed) say('The user was removed, but their panel sets could not be handed over.', 'warning');
    return reply;
}

function button(text, onclick, { tone = 'outline-secondary', title, disabled = false, name } = {}) {
    return h('button', {
        type: 'button', class: `btn btn-sm btn-${tone} me-1`, text, title, disabled, onclick,
        data: name ? { action: name } : undefined,
    });
}

async function copyText(text) {
    const nav = globalThis.navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText) {
        await nav.clipboard.writeText(text);
        return true;
    }
    return false;
}

function secretNotice() {
    if (!secret) return null;
    const { username, password } = secret;
    return h('div', { class: 'alert alert-warning d-flex flex-wrap align-items-center gap-2', role: 'alert', id: 'users-secret' },
        h('span', null, `Password for ${username}: `, h('code', { class: 'user-select-all', id: 'users-secret-value', text: password })),
        h('strong', { text: 'Shown once. Copy it now.' }),
        h('span', { class: 'ms-auto' },
            button('Copy', async (event) => {
                const ok = await copyText(password);
                event.target.textContent = ok ? 'Copied' : 'Select and copy it';
            }, { name: 'copy-secret' }),
            button('Done', () => { secret = null; draw(); }, { name: 'dismiss-secret' })));
}

function errorLine(message) {
    return h('div', { class: 'invalid-feedback d-block mb-2', role: 'alert', text: message || '', hidden: !message });
}

/** Run `work`, showing a failure in `errorEl` instead of throwing. */
async function attempt(errorEl, work) {
    errorEl.hidden = true;
    try {
        await work();
        return true;
    } catch (e) {
        errorEl.textContent = (e && e.message) || 'The change failed.';
        errorEl.hidden = false;
        return false;
    }
}

async function reload() {
    users = await apiRef.users.list();
    draw();
}

function addPanel() {
    const err = errorLine('');
    const name = h('input', { class: 'form-control form-control-sm', id: 'add-username', autocomplete: 'off', required: true });
    const pw = h('input', { class: 'form-control form-control-sm', id: 'add-password', type: 'password', autocomplete: 'new-password', disabled: true });
    const generate = h('input', { class: 'form-check-input', type: 'radio', name: 'add-mode', id: 'add-generate', checked: true });
    const manual = h('input', { class: 'form-check-input', type: 'radio', name: 'add-mode', id: 'add-manual' });
    const admin = h('input', { class: 'form-check-input', type: 'checkbox', id: 'add-admin' });
    const sync = () => { pw.disabled = !manual.checked; };
    generate.addEventListener('change', sync);
    manual.addEventListener('change', sync);
    const create = h('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'Create', id: 'add-submit' });
    const form = h('form', { class: 'card card-body mb-3', novalidate: true, id: 'users-add' },
        h('h3', { class: 'h6', text: 'Add user' }),
        h('div', { class: 'row g-2 align-items-end' },
            h('div', { class: 'col-md-4' }, h('label', { class: 'form-label', for: 'add-username', text: 'Username' }), name),
            h('div', { class: 'col-md-4' },
                h('div', { class: 'form-check' }, generate, h('label', { class: 'form-check-label', for: 'add-generate', text: 'Generate a password' })),
                h('div', { class: 'form-check' }, manual, h('label', { class: 'form-check-label', for: 'add-manual', text: 'Set a password' })),
                pw),
            h('div', { class: 'col-md-2' },
                h('div', { class: 'form-check' }, admin, h('label', { class: 'form-check-label', for: 'add-admin', text: 'Administrator' }))),
            h('div', { class: 'col-md-2 text-end' }, create,
                h('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm ms-1', text: 'Cancel', onclick: () => { open = null; draw(); } }))),
        err);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const username = name.value.trim();
        if (!isValidUsername(username)) {
            err.textContent = 'Usernames use letters, digits and . _ @ - (up to 64 characters).';
            err.hidden = false;
            return;
        }
        const body = { username, is_admin: admin.checked };
        if (manual.checked) body.password = pw.value;
        else body.generate = true;
        create.disabled = true;
        const ok = await attempt(err, async () => {
            const made = warnIfUnaudited(await apiRef.users.add(body));
            secret = made && made.password ? { username, password: made.password } : null;
            open = null;
            say(`Created ${username}.`);
            await reload();
        });
        if (!ok) create.disabled = false;
    });
    return form;
}

function resetPanel(user) {
    const err = errorLine('');
    const pw = h('input', { class: 'form-control form-control-sm', id: 'reset-password', type: 'password', autocomplete: 'new-password', disabled: true });
    const generate = h('input', { class: 'form-check-input', type: 'radio', name: 'reset-mode', id: 'reset-generate', checked: true });
    const manual = h('input', { class: 'form-check-input', type: 'radio', name: 'reset-mode', id: 'reset-manual' });
    const sync = () => { pw.disabled = !manual.checked; };
    generate.addEventListener('change', sync);
    manual.addEventListener('change', sync);
    const go = h('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'Reset password', id: 'reset-submit' });
    const form = h('form', { class: 'card card-body mb-3', novalidate: true, id: 'users-reset' },
        h('h3', { class: 'h6', text: `Reset the password of ${user.username}` }),
        h('p', { class: 'small text-muted mb-2', text: 'Their existing logins end.' }),
        h('div', { class: 'form-check' }, generate, h('label', { class: 'form-check-label', for: 'reset-generate', text: 'Generate a password' })),
        h('div', { class: 'form-check mb-1' }, manual, h('label', { class: 'form-check-label', for: 'reset-manual', text: 'Set a password' })),
        pw, err,
        h('div', { class: 'mt-2' }, go,
            h('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm ms-1', text: 'Cancel', onclick: () => { open = null; draw(); } })));
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const body = manual.checked ? { password: pw.value } : { generate: true };
        go.disabled = true;
        const ok = await attempt(err, async () => {
            const made = warnIfUnaudited(await apiRef.users.setPassword(user.username, body));
            secret = made && made.password ? { username: user.username, password: made.password } : null;
            open = null;
            say(`Changed the password of ${user.username}.`);
            await reload();
        });
        if (!ok) go.disabled = false;
    });
    return form;
}

function removePanel(user) {
    const err = errorLine('');
    const others = users.filter((u) => u.username !== user.username);
    const owns = user.panel_sets > 0;
    const target = h('select', { class: 'form-select form-select-sm', id: 'remove-reassign', 'aria-label': 'Hand the panel sets to' },
        h('option', { value: '', text: 'keep them (the owner is then a removed user)' }),
        others.map((u) => h('option', { value: u.username, text: u.username })));
    const go = h('button', { type: 'submit', class: 'btn btn-danger btn-sm', text: 'Remove', id: 'remove-submit' });
    const form = h('form', { class: 'card card-body mb-3 border-danger', novalidate: true, id: 'users-remove' },
        h('h3', { class: 'h6', text: `Remove ${user.username}` }),
        owns ? h('div', { class: 'mb-2' },
            h('label', { class: 'form-label small', for: 'remove-reassign',
                text: `${user.username} owns ${user.panel_sets} panel ${user.panel_sets === 1 ? 'set' : 'sets'}. Hand them to:` }), target) : null,
        err,
        h('div', null, go,
            h('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm ms-1', text: 'Cancel', onclick: () => { open = null; draw(); } })));
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const body = owns && target.value ? { reassign_to: target.value } : {};
        go.disabled = true;
        const ok = await attempt(err, async () => {
            const done = warnIfUnaudited(await apiRef.users.remove(user.username, body));
            open = null;
            const moved = done && done.panel_sets_reassigned ? ` ${done.panel_sets_reassigned} panel sets handed over.` : '';
            say(`Removed ${user.username}.${moved}`);
            await reload();
        });
        if (!ok) go.disabled = false;
    });
    return form;
}

async function act(label, work) {
    try {
        await work();
        await reload();
    } catch (e) {
        say(`${label}: ${(e && e.message) || 'failed'}`, 'danger');
    }
}

function actionCell(user) {
    const why = protectedReason(user, users, meRef && meRef.username);
    const lockedReason = why;
    return h('span', { class: 'text-nowrap' },
        button('Reset password', () => { open = { kind: 'reset', user }; draw(); }, { name: 'reset' }),
        user.is_admin
            ? button('Revoke admin', () => act('Revoke admin', async () => {
                warnIfUnaudited(await apiRef.users.setAdmin(user.username, false));
                say(`${user.username} is no longer an administrator.`);
            }), { disabled: !!why, title: why || undefined, name: 'revoke-admin' })
            : button('Make admin', () => act('Make admin', async () => {
                warnIfUnaudited(await apiRef.users.setAdmin(user.username, true));
                say(`${user.username} is now an administrator.`);
            }), { name: 'make-admin' }),
        (user.locked || []).length
            ? button('Unlock', () => act('Unlock', async () => {
                warnIfUnaudited(await apiRef.users.unlock(user.username));
                say(`Unlocked ${user.username}.`);
            }), { name: 'unlock' })
            : null,
        button('Remove', () => { open = { kind: 'remove', user }; draw(); },
            { tone: 'outline-danger', disabled: !!lockedReason, title: lockedReason || undefined, name: 'remove' }));
}

function draw() {
    let panel = null;
    if (open && open.kind === 'add') panel = addPanel();
    else if (open && open.kind === 'reset') panel = resetPanel(open.user);
    else if (open && open.kind === 'remove') panel = removePanel(open.user);
    setChildren(root,
        h('div', { class: 'd-flex align-items-center mb-2' },
            h('h2', { class: 'h5 mb-0', text: `Users (${users.length})` }),
            h('span', { class: 'ms-auto' }, button('Add user', () => { open = { kind: 'add' }; draw(); },
                { tone: 'primary', name: 'add' }))),
        secretNotice(),
        panel,
        table(['User', 'Admin', 'Last login', 'Panel sets', 'Locked', 'Last seen', 'Actions'],
            userRows(users, meRef && meRef.username, actionCell)));
}

async function load() {
    secret = null;     // a reload by the router or the Refresh button never re-shows it
    open = null;
    await reload();
}

export default {
    id: 'users',
    title: 'Users',
    async mount(el, api, ctx = {}) {
        root = el;
        apiRef = api;
        meRef = ctx.me || null;
        toastRef = ctx.toast || null;
        await load();
    },
    refresh: () => reload(),
};
