/**
 * The "Remote datasets" card of the Data sources section: whether the server may
 * read zarr stores from s3://, gs://, gcs:// and http(s):// URLs. One policy key,
 * `feature.remote_stores`, whose value is {mode: off|allowlist|any, allowlist: [prefix]}.
 * The configuration file (or an environment variable) is a ceiling: an
 * administrator may narrow it, never widen it, and the card shows what it allows.
 *
 * The pure helpers (normalisePrefix, addPrefix, optionStates, sourceText, sameAccess)
 * run under `node --test`; the renderer builds DOM through dom.js.
 */

import { h, setChildren, badge } from './dom.js';

export const KEY = 'feature.remote_stores';
export const SCHEMES = ['s3', 'gs', 'gcs', 'http', 'https'];
export const MODES = [
    { id: 'off', label: 'Off', help: 'The server opens no remote dataset.' },
    { id: 'allowlist', label: 'Only these locations', help: 'The server opens remote datasets whose URL starts with one of the locations below.' },
    { id: 'any', label: 'Any location', help: 'The server opens any remote URL a user gives it.' },
];

/**
 * Check and normalise one allowlist entry the way the server does.
 * @param {string} text
 * @returns {{value: string, error: string}} `value` is the canonical prefix ('' on error)
 */
export function normalisePrefix(text) {
    const raw = String(text || '').trim();
    const fail = (error) => ({ value: '', error });
    if (!raw) return fail('Enter a location.');
    const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/.exec(raw);
    const scheme = m ? m[1].toLowerCase() : '';
    if (!SCHEMES.includes(scheme)) return fail(`Start with ${SCHEMES.map((s) => `${s}://`).join(', ')}.`);
    const rest = m[2];
    if (/[?#]/.test(rest)) return fail('No query string or fragment (pre-signed URLs do not work).');
    const slash = rest.indexOf('/');
    const authority = slash < 0 ? rest : rest.slice(0, slash);
    const path = slash < 0 ? '' : rest.slice(slash);
    if (authority.includes('@')) return fail('No credentials in the URL. Credentials come from the server environment.');
    if (!authority) return fail('Add a host or bucket name.');
    if (/\s/.test(raw)) return fail('A URL has no spaces.');
    const segments = path.split('/');
    if (segments.includes('.') || segments.includes('..')) return fail("No '.' or '..' segments.");
    const clean = segments.filter((s, i) => s !== '' || i === 0 || i === segments.length - 1);
    const body = clean.join('/').replace(/\/+$/, '');
    return { value: `${scheme}://${authority.toLowerCase()}${body}/`, error: '' };
}

/**
 * Add an entry to a list: normalised, a duplicate ignored.
 * @param {string[]} list
 * @param {string} text
 * @returns {{list: string[], error: string}}
 */
export function addPrefix(list, text) {
    const { value, error } = normalisePrefix(text);
    if (error) return { list, error };
    return { list: list.includes(value) ? list : [...list, value], error: '' };
}

/** Whether prefix `inner` lies inside `outer` (both canonical, ending in '/'). */
export const isInside = (inner, outer) => inner.startsWith(outer);

/** Whether two {mode, allowlist} values are the same. */
export function sameAccess(a, b) {
    if (!a || !b) return a === b;
    return a.mode === b.mode && JSON.stringify(a.allowlist || []) === JSON.stringify(b.allowlist || []);
}

/**
 * Which of the three states the administrator may pick, and why not.
 * @param {Object} key - the policy key as served
 * @returns {{off: string, allowlist: string, any: string, all: string}} '' when allowed, else the reason;
 *          `all` is set when nothing can be changed
 */
export function optionStates(key) {
    const out = { off: '', allowlist: '', any: '', all: '' };
    if (key.locked) {
        out.all = 'Locked by policy.locked in the configuration file.';
    } else if (key.config_value && key.config_value.mode === 'off') {
        out.all = `${originText(key)} turns remote datasets off. Change it there and restart the server to allow them.`;
    }
    if (out.all) {
        for (const mode of ['off', 'allowlist', 'any']) out[mode] = out.all;
        return out;
    }
    const ceiling = key.config_value;
    if (ceiling && ceiling.mode === 'allowlist') {
        out.any = `${originText(key)} limits remote datasets to ${ceiling.allowlist.join(', ')}.`;
    }
    return out;
}

function originText(key) {
    return key.config_origin === 'env'
        ? 'The environment (ANNZARRO_REMOTE_STORES, ANNZARRO_REMOTE_ALLOWLIST)'
        : 'The configuration file (server.remote_stores, server.remote_allowlist)';
}

/** One sentence on where the effective value comes from. */
export function sourceText(key) {
    if (key.locked) return 'Locked by policy.locked in the configuration file.';
    switch (key.source) {
        case 'admin': {
            const ceiling = key.config_value;
            return `Set by an administrator.${ceiling ? ` ${originText(key)} sets an upper limit that can be narrowed, not widened.` : ''}`;
        }
        case 'env': return `Set by ${originText(key).replace(/^The /, 'the ')}, which wins over the configuration file.`;
        case 'config': return `Set by ${originText(key).replace(/^The /, 'the ')}.`;
        default: return 'Default: off on a shared (login or network) server, any location on a single-user local server.';
    }
}

const SOURCE_TONE = { default: 'secondary', config: 'info', env: 'warning', admin: 'primary' };

/**
 * Render the card into `target`.
 * @param {HTMLElement} target
 * @param {Object} key - `feature.remote_stores` of GET /admin/policy
 * @param {{save: function(Object): Promise<void>, reset: function(): Promise<void>}} handlers
 */
export function renderRemoteDatasets(target, key, { save, reset }) {
    const states = optionStates(key);
    let draft = { mode: key.value.mode, allowlist: [...(key.value.allowlist || [])] };
    let busy = false;
    const message = h('div', { class: 'text-danger small mt-2', role: 'alert', hidden: true });
    const say = (text) => { message.textContent = text; message.hidden = !text; };

    const draw = () => {
        const changed = !sameAccess(draft, key.value);
        const radios = MODES.map((mode) => {
            const id = `remote-mode-${mode.id}`;
            const reason = states[mode.id];
            return h('div', { class: 'form-check mb-1' },
                h('input', {
                    class: 'form-check-input', type: 'radio', name: 'remote-mode', id, value: mode.id,
                    checked: draft.mode === mode.id, disabled: !!reason, data: { mode: mode.id },
                    onchange: () => { draft.mode = mode.id; if (mode.id !== 'allowlist') draft.allowlist = []; say(''); draw(); },
                }),
                h('label', { class: 'form-check-label', for: id },
                    h('span', { class: 'fw-semibold', text: mode.label }),
                    h('span', { class: 'text-muted small ms-2', text: reason || mode.help })));
        });
        const children = [h('div', { role: 'radiogroup', 'aria-label': 'Remote datasets' }, radios)];
        if (draft.mode === 'allowlist') children.push(allowlistEditor());
        if (draft.mode === 'any') {
            children.push(h('div', { class: 'alert alert-warning py-2 mt-2 mb-0', role: 'alert', id: 'remote-any-warning' },
                h('strong', { text: 'Any location. ' }),
                'The server will fetch any URL a user gives it, including addresses on its internal network ' +
                '(for example cloud metadata services or other machines behind the firewall). ' +
                'Prefer a list of locations on a shared server.'));
        }
        const actions = states.all ? [] : [h('div', { class: 'mt-3 d-flex align-items-center gap-2' },
            h('button', {
                type: 'button', class: 'btn btn-sm btn-primary', id: 'remote-save', text: 'Save',
                disabled: !changed || busy || (draft.mode === 'allowlist' && !draft.allowlist.length), onclick: apply,
            }),
            changed ? h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', text: 'Discard', onclick: () => { draft = { mode: key.value.mode, allowlist: [...key.value.allowlist] }; say(''); draw(); } }) : null,
            key.source === 'admin' ? h('button', {
                type: 'button', class: 'btn btn-sm btn-link', id: 'remote-reset', text: 'Reset to the default',
                title: 'Remove the administrator setting', disabled: busy, onclick: undo,
            }) : null)];
        setChildren(target,
            h('div', { class: 'd-flex justify-content-between align-items-start mb-2' },
                h('div', null,
                    h('h2', { class: 'h6 mb-1', text: 'Remote datasets' }),
                    h('div', { class: 'small text-muted', text: 'Whether the server may read datasets from s3://, gs://, gcs:// and http(s):// URLs. Does not affect Gene Set Analysis.' })),
                h('span', { class: 'text-nowrap' },
                    key.locked ? h('i', { class: 'fas fa-lock text-muted me-1', title: 'Locked', 'aria-label': 'locked' }) : null,
                    badge(key.locked ? 'locked' : key.source, key.locked ? 'dark' : (SOURCE_TONE[key.source] || 'secondary')))),
            children, message,
            h('div', { class: 'small text-muted mt-2', id: 'remote-source', text: sourceText(key) }),
            states.all ? h('div', { class: 'small fst-italic mt-1', id: 'remote-locked', text: states.all }) : null,
            actions);
    };

    const allowlistEditor = () => {
        const ceiling = key.config_value && key.config_value.mode === 'allowlist' ? key.config_value.allowlist : null;
        const input = h('input', {
            type: 'text', class: 'form-control form-control-sm font-monospace', id: 'remote-prefix',
            placeholder: 's3://bucket/prefix/ or https://host/path/', 'aria-label': 'Add a location', autocomplete: 'off',
            disabled: !!states.all,
        });
        const add = () => {
            const out = addPrefix(draft.allowlist, input.value);
            if (out.error) { say(out.error); return; }
            const added = normalisePrefix(input.value).value;
            if (ceiling && !ceiling.some((c) => isInside(added, c))) {
                say(`${added} is outside what ${originText(key).toLowerCase()} allows (${ceiling.join(', ')}).`);
                return;
            }
            say('');
            draft.allowlist = out.list;
            draw();
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
        return h('div', { class: 'mt-2', id: 'remote-allowlist' },
            h('ul', { class: 'list-unstyled mb-2' }, draft.allowlist.map((p, i) => h('li', { class: 'd-flex align-items-center gap-2', data: { prefix: p } },
                h('code', { text: p }),
                states.all ? null : h('button', {
                    type: 'button', class: 'btn btn-sm btn-link text-danger p-0', 'aria-label': `Remove ${p}`, title: 'Remove',
                    onclick: () => { draft.allowlist = draft.allowlist.filter((_, j) => j !== i); say(''); draw(); },
                }, h('i', { class: 'fas fa-times', 'aria-hidden': 'true' })))),
            ),
            draft.allowlist.length ? null : h('div', { class: 'text-muted small mb-2', text: 'No location yet. Add at least one.' }),
            states.all ? null : h('div', { class: 'input-group input-group-sm' }, input,
                h('button', { type: 'button', class: 'btn btn-outline-secondary', id: 'remote-add', text: 'Add', onclick: add })),
            h('div', { class: 'form-text', text: 'A URL prefix ending at a folder boundary: s3://bucket/atlases/ allows everything below it, not s3://bucket/atlases-other/.' }));
    };

    async function run(fn) {
        busy = true;
        say('');
        draw();
        try {
            await fn();
        } catch (e) {
            busy = false;
            say((e && e.message) || 'The change failed.');
            draw();
        }
    }
    const apply = () => run(() => save({ mode: draft.mode, allowlist: draft.mode === 'allowlist' ? draft.allowlist : [] }));
    const undo = () => run(() => reset());
    draw();
}
