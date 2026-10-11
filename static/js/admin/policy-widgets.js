/**
 * Widgets for the Settings tab, generated from the policy registry
 * (design 10.3, 10.6): one row per key, a widget chosen by the key's type, a
 * source badge, a lock or read-only state, and "reset to inherited".
 *
 * A key as served by GET /api/v1/admin/policy:
 *   {name, type, default, scope, area, description, combine, outbound_hosts_now,
 *    restart, locked, value, source, config_value}
 * `type` is {kind, ...}: bool; enum {choices}; int|float {min, max};
 * hosts; paths; subset {choices} (choices are ids or {id, label, host}).
 * A bare string is read as {kind}.
 *
 * The pure helpers (typeSpec, validateValue, formatValue, groupByArea,
 * keyState) run under `node --test`; the renderers build DOM through dom.js.
 */

import { h, setChildren, badge } from './dom.js';

/** Order and titles of the registry's `area` values; an unknown area follows, titled from its name. */
export const AREAS = [
    ['panels', 'Panels'],
    ['outbound', 'Outbound'],
    ['data', 'Data'],
    ['features', 'Features'],
    ['limits', 'Limits'],
];

const SOURCE_TONE = { default: 'secondary', config: 'info', admin: 'primary', user: 'primary' };

/**
 * @param {Object|string} type - a key's `type`
 * @returns {{kind: string, choices: Array, min: (number|null), max: (number|null)}}
 */
export function typeSpec(type) {
    const t = typeof type === 'string' ? { kind: type } : (type || {});
    return {
        kind: String(t.kind || t.name || 'text').toLowerCase(),
        choices: Array.isArray(t.choices) ? t.choices : [],
        min: typeof t.min === 'number' ? t.min : null,
        max: typeof t.max === 'number' ? t.max : null,
    };
}

/** The id and label of a choice that is a plain id or {id, label, host}. */
export function choiceOf(choice) {
    if (choice && typeof choice === 'object') {
        return { id: String(choice.id), label: String(choice.label || choice.id), host: choice.host || '' };
    }
    return { id: String(choice), label: String(choice), host: '' };
}

/**
 * Check a value against its type before it is sent; the server checks again.
 * @param {Object|string} type
 * @param {*} value
 * @returns {string|null} the problem, or null when acceptable
 */
export function validateValue(type, value) {
    const spec = typeSpec(type);
    switch (spec.kind) {
        case 'bool':
            return typeof value === 'boolean' ? null : 'Must be on or off.';
        case 'int':
        case 'float': {
            if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a number.';
            if (spec.kind === 'int' && !Number.isInteger(value)) return 'Enter a whole number.';
            if (spec.min !== null && value < spec.min) return `At least ${spec.min}.`;
            if (spec.max !== null && value > spec.max) return `At most ${spec.max}.`;
            return null;
        }
        case 'enum':
            return spec.choices.some((c) => choiceOf(c).id === value) ? null : 'Pick one of the listed values.';
        case 'subset':
            return Array.isArray(value) && value.every((v) => spec.choices.some((c) => choiceOf(c).id === v))
                ? null : 'Pick from the listed values.';
        case 'hosts':
            if (!Array.isArray(value)) return 'Enter a list of hosts.';
            return value.every((v) => /^[A-Za-z0-9.-]+(:\d+)?$/.test(v)) ? null : 'Hosts are bare names such as example.org.';
        case 'paths':
            if (!Array.isArray(value)) return 'Enter a list of paths.';
            return value.every((v) => typeof v === 'string' && v.startsWith('/')) ? null : 'Paths must be absolute.';
        default:
            return null;
    }
}

/**
 * A value as read-only text.
 * @param {Object|string} type
 * @param {*} value
 * @returns {string}
 */
export function formatValue(type, value) {
    const spec = typeSpec(type);
    if (value === null || value === undefined) return 'not set';
    if (spec.kind === 'bool') return value ? 'on' : 'off';
    if (Array.isArray(value)) return value.length ? value.join(', ') : 'none';
    return String(value);
}

/**
 * How a key may be edited.
 * @param {Object} key
 * @param {{frozen: string}} [opts] - a reason that rules out editing whatever the key is
 * @returns {{editable: boolean, note: string}} `note` says why it is not
 */
export function keyState(key, { frozen = '' } = {}) {
    if (frozen) return { editable: false, note: frozen };
    if (key.restart) return { editable: false, note: 'change in the config file and restart' };
    if (key.scope === 'config') return { editable: false, note: 'read-only, from the config file' };
    if (key.locked) return { editable: false, note: 'locked by the config file' };
    return { editable: true, note: '' };
}

/**
 * Keys by area, in AREAS order and then by name; areas with no key are left out.
 * @param {Array<Object>} keys
 * @returns {Array<{area: string, title: string, keys: Array<Object>}>}
 */
export function groupByArea(keys) {
    const byArea = new Map();
    for (const key of keys) {
        const area = key.area || 'other';
        if (!byArea.has(area)) byArea.set(area, []);
        byArea.get(area).push(key);
    }
    const order = AREAS.map(([a]) => a);
    const names = Object.fromEntries(AREAS);
    return [...byArea.keys()]
        .sort((a, b) => {
            const ia = order.indexOf(a);
            const ib = order.indexOf(b);
            return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib) || a.localeCompare(b);
        })
        .map((area) => ({
            area,
            title: names[area] || area.charAt(0).toUpperCase() + area.slice(1),
            keys: byArea.get(area).sort((a, b) => a.name.localeCompare(b.name)),
        }));
}

/** The label shown for a key: its name without the area prefix it is grouped under. */
export function keyLabel(key) {
    const parts = key.name.split('.');
    return parts.length > 1 ? parts.slice(1).join('.') : key.name;
}

/** Whether two policy values are the same (they are JSON: scalars and lists). */
export function sameValue(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * What "reset to inherited" returns to, for a row of the layer being edited.
 * @param {Object} key
 * @param {string} layer - "admin" (the Settings tab) or "user" (a user's overrides)
 * @returns {{set: boolean, inherited: *, capped: boolean}} `set`: the layer holds a value
 *          that counts; `capped`: a lower layer keeps the effective value from being that value
 */
export function layerState(key, layer) {
    let inherited = key.inherited;
    if (!inherited && layer === 'admin' && key.source === 'admin') {
        // an older server sends no per-layer breakdown: the layer below the admin is the config, then the default
        inherited = { admin: key.config_value !== undefined ? key.config_value : key.default };
    }
    inherited = inherited || {};
    const set = Object.prototype.hasOwnProperty.call(inherited, layer);
    const own = layer === 'user' ? key.override : (key.layers || {})[layer];
    return {
        set,
        inherited: set ? inherited[layer] : key.value,
        capped: set && own !== undefined && own !== null && !sameValue(own, key.value),
    };
}

/** Sentences for the reasons the server gives for a stored value it ignores. */
export const ISSUE_TEXT = {
    unknown_key: 'not a setting this version knows',
    bad_type: 'has the wrong type',
    out_of_range: 'is out of range',
    bad_choice: 'is not an allowed value',
    config_scope: 'can only be set in the config file',
    server_scope: 'is server-wide, not per user',
    locked_by_config: 'is locked by the config file',
    admin_user: 'is an override on an administrator, which has no effect',
};

/** What a refused change says on its row, by the server's reason for that setting. */
export const REFUSAL_TEXT = {
    unknown_key: 'This server does not know this setting.',
    bad_type: 'The value has the wrong type.',
    out_of_range: 'The value is out of range.',
    bad_choice: 'That is not one of the allowed values.',
    locked_by_config: 'The config file locks this setting.',
    config_scope: 'This can only be changed in the config file.',
    server_scope: 'This setting is server-wide and cannot be set per user.',
    config_ceiling: 'The config file does not allow a wider value than it sets.',
    admin_user: 'Administrators have no per-user overrides.',
};

/**
 * Editor for a list of strings (hosts, paths).
 * @param {string[]} values
 * @param {function(string[]): void} commit
 * @param {Object} opts - {disabled, placeholder, mono}
 */
function listEditor(values, commit, { disabled, placeholder }) {
    const current = Array.isArray(values) ? values.slice() : [];
    const list = h('ul', { class: 'list-unstyled mb-1 policy-list' }, current.map((v, i) => h('li', { class: 'd-flex align-items-center gap-2' },
        h('code', { text: v }),
        disabled ? null : h('button', {
            type: 'button', class: 'btn btn-sm btn-link text-danger p-0', 'aria-label': `Remove ${v}`, title: 'Remove',
            onclick: () => commit(current.filter((_, j) => j !== i)),
        }, h('i', { class: 'fas fa-times', 'aria-hidden': 'true' })))));
    if (disabled) return h('div', null, current.length ? list : h('span', { class: 'text-muted', text: 'none' }));
    const input = h('input', { type: 'text', class: 'form-control form-control-sm', placeholder, 'aria-label': 'Add an entry' });
    const add = () => {
        const v = input.value.trim();
        if (v && !current.includes(v)) commit([...current, v]);
    };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); add(); }
    });
    return h('div', null, list, h('div', { class: 'input-group input-group-sm' }, input,
        h('button', { type: 'button', class: 'btn btn-outline-secondary', text: 'Add', onclick: add })));
}

/**
 * The input for one key. `commit(value, revert)` is called with a validated
 * value and a function that puts the input back as it was (for a refused
 * change); `fail(message)` shows a client-side problem.
 * @param {Object} key
 * @param {boolean} disabled
 * @param {function(*): void} commit
 * @param {function(string): void} fail
 * @returns {HTMLElement}
 */
export function renderControl(key, disabled, commit, fail) {
    const spec = typeSpec(key.type);
    const id = `policy-${key.name.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    switch (spec.kind) {
        case 'bool':
            return h('div', { class: 'form-check form-switch' },
                h('input', {
                    class: 'form-check-input', type: 'checkbox', role: 'switch', id, checked: key.value === true, disabled,
                    onchange: (e) => commit(Boolean(e.target.checked), () => { e.target.checked = key.value === true; }),
                }),
                h('label', { class: 'form-check-label', for: id, text: key.value ? 'on' : 'off' }));
        case 'enum':
            return h('select', {
                class: 'form-select form-select-sm', id, disabled, 'aria-label': key.name,
                onchange: (e) => commit(e.target.value, () => { e.target.value = key.value; }),
            }, spec.choices.map((c) => {
                const { id: cid, label } = choiceOf(c);
                return h('option', { value: cid, selected: cid === key.value, text: label });
            }));
        case 'int':
        case 'float': {
            const input = h('input', {
                class: 'form-control form-control-sm', type: 'number', id, disabled, 'aria-label': key.name,
                value: key.value === null || key.value === undefined ? '' : String(key.value),
                min: spec.min, max: spec.max, step: spec.kind === 'int' ? '1' : 'any',
            });
            input.addEventListener('change', () => {
                const n = input.value === '' ? NaN : Number(input.value);
                const problem = validateValue(key.type, n);
                if (problem) fail(problem);
                else commit(n, () => { input.value = key.value === null || key.value === undefined ? '' : String(key.value); });
            });
            return input;
        }
        case 'subset': {
            const selected = new Set(Array.isArray(key.value) ? key.value : []);
            return h('div', null, spec.choices.map((c) => {
                const { id: cid, label, host } = choiceOf(c);
                const box = `${id}-${cid}`;
                return h('div', { class: 'form-check' },
                    h('input', {
                        class: 'form-check-input', type: 'checkbox', id: box, checked: selected.has(cid), disabled,
                        onchange: (e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(cid); else next.delete(cid);
                            commit(spec.choices.map((x) => choiceOf(x).id).filter((x) => next.has(x)),
                                () => { e.target.checked = selected.has(cid); });
                        },
                    }),
                    h('label', { class: 'form-check-label', for: box }, label, host ? h('span', { class: 'text-muted ms-2 small', text: host }) : null));
            }));
        }
        case 'hosts':
        case 'paths':
            return listEditor(key.value, (next) => {
                const problem = validateValue(key.type, next);
                if (problem) fail(problem);
                else commit(next);
            }, { disabled, placeholder: spec.kind === 'hosts' ? 'host.example.org' : '/absolute/path' });
        default:
            return h('code', { text: formatValue(key.type, key.value) });
    }
}

/**
 * One settings row.
 * @param {Object} key - a key of GET /admin/policy (or of GET /admin/users/<u>/policy)
 * @param {Object} handlers
 * @param {function(string, *): Promise<*>} handlers.onChange - called with
 *        (name, value), or (name, null) to reset to the inherited value; a
 *        rejection with `fieldErrors` or a message is shown on the row
 * @param {string} [handlers.layer] - "admin" (default) or "user": which stored
 *        layer the row edits
 * @param {string} [handlers.frozen] - a reason this whole block cannot be edited
 * @returns {HTMLElement}
 */
export function renderPolicyRow(key, { onChange, layer = 'admin', frozen = '' } = {}) {
    const state = keyState(key, { frozen });
    const own = layerState(key, layer);
    const message = h('div', { class: 'invalid-feedback d-block', role: 'alert', hidden: true });
    const fail = (text) => {
        message.textContent = text;
        message.hidden = !text;
    };
    const run = async (value, revert) => {
        fail('');
        try {
            await onChange(key.name, value);
        } catch (e) {
            const field = e && e.fieldErrors && e.fieldErrors[key.name];
            fail((field && (REFUSAL_TEXT[field] || field)) || (e && e.message) || 'The change failed.');
            if (revert) revert();
        }
    };
    const control = state.editable
        ? renderControl(key, false, run, fail)
        : (typeSpec(key.type).kind === 'bool' || ['hosts', 'paths', 'subset'].includes(typeSpec(key.type).kind)
            ? renderControl(key, true, () => {}, () => {})
            : h('code', { class: 'policy-readonly-value', text: formatValue(key.type, key.value) }));
    const source = key.locked ? 'locked' : (key.source || 'default');
    const hosts = Array.isArray(key.outbound_hosts_now) && key.outbound_hosts_now.length
        ? h('div', { class: 'small text-muted', text: `Browsers may contact: ${key.outbound_hosts_now.join(', ')}` }) : null;
    const inherited = own.set
        ? h('div', { class: 'small text-muted policy-inherited', text: `inherited: ${formatValue(key.type, own.inherited)}` }) : null;
    const capped = own.capped
        ? h('div', { class: 'small text-warning-emphasis policy-capped', text: `capped by a wider setting: ${formatValue(key.type, key.value)} applies` }) : null;
    return h('div', { class: 'policy-row', data: { key: key.name } },
        h('div', { class: 'policy-name' },
            h('div', { class: 'fw-semibold', text: keyLabel(key) }),
            h('div', { class: 'small text-muted', text: key.description || '' })),
        h('div', { class: 'policy-control' }, control, hosts, inherited, capped, message,
            state.note ? h('div', { class: 'small text-muted fst-italic', text: state.note }) : null),
        h('div', { class: 'policy-meta' },
            key.locked ? h('i', { class: 'fas fa-lock text-muted me-1', title: 'Locked by the config file', 'aria-label': 'locked' }) : null,
            badge(source, key.locked ? 'dark' : (SOURCE_TONE[key.source] || 'secondary'), `Value comes from: ${source}`),
            state.editable && own.set
                ? h('button', {
                    type: 'button', class: 'btn btn-sm btn-link', text: 'reset', title: 'Remove this value and inherit again',
                    onclick: () => run(null),
                }) : null));
}

/**
 * The stored values the server ignores, flagged, each with a remove button.
 * `policy.issues` lists them all (unknown names, bad values, locked or
 * out-of-scope keys); a server that only sends `unknown` is read as unknown names.
 */
function renderIssues(policy, onRemove, titles) {
    const issues = Array.isArray(policy.issues)
        ? policy.issues
        : (policy.unknown || []).map((u) => ({ name: u.name, value: u.value, reason: 'unknown_key' }));
    if (!issues.length) return null;
    return h('section', { class: 'policy-group policy-unknown', data: { area: 'unknown' } },
        h('h2', { class: 'h5', text: issues.every((i) => i.reason === 'unknown_key') ? titles[0] : titles[1] }),
        h('p', { class: 'text-muted small', text: 'Kept in the file and ignored. A newer or older version may have written them.' }),
        issues.map((i) => h('div', { class: 'policy-row', data: { key: i.name } },
            h('div', { class: 'policy-name' }, h('code', { text: i.name }),
                h('div', { class: 'small text-warning-emphasis', text: ISSUE_TEXT[i.reason] || i.reason })),
            h('div', { class: 'policy-control' }, h('code', { text: JSON.stringify(i.value) })),
            h('div', { class: 'policy-meta' }, h('button', {
                type: 'button', class: 'btn btn-sm btn-outline-danger', text: 'remove',
                onclick: () => onRemove && onRemove(i.name),
            })))));
}

/**
 * The whole Settings body into `el`.
 * @param {HTMLElement} el
 * @param {{keys: Array<Object>, unknown: Array<Object>}} policy - GET /admin/policy
 * @param {{onChange: function, onRemoveUnknown: function}} handlers
 */
export function renderPolicy(el, policy, { onChange, onRemoveUnknown } = {}) {
    const keys = policy.keys || [];
    const master = keys.find((k) => k.name === 'outbound.allow_external');
    const groups = groupByArea(keys.filter((k) => k !== master));
    const blocks = [];
    if (master) {
        blocks.push(renderMasterSwitch(master, onChange));
    }
    for (const group of groups) {
        const readOnlyArea = group.keys.every((k) => !keyState(k).editable);
        blocks.push(h('section', { class: 'policy-group', data: { area: group.area } },
            h('h2', { class: 'h5' }, group.title,
                readOnlyArea && group.area === 'limits' ? h('small', { class: 'text-muted ms-2', text: 'read-only, from the config file' }) : null),
            group.keys.map((k) => renderPolicyRow(k, { onChange }))));
    }
    const issues = renderIssues(policy, onRemoveUnknown, ['Unknown keys in stored files', 'Stored values that are ignored']);
    if (issues) blocks.push(issues);
    setChildren(el, blocks);
}

/**
 * A user's overrides, for the Users and Access dialogs: the keys of scope
 * "user" with the inherited value next to the override.
 * @param {HTMLElement} el
 * @param {Object} policy - GET /admin/users/<u>/policy
 * @param {{onChange: function, onRemoveUnknown: function}} handlers
 */
export function renderUserPolicy(el, policy, { onChange, onRemoveUnknown } = {}) {
    const frozen = policy.is_admin ? 'Administrators get no per-user overrides.' : '';
    const groups = groupByArea(policy.keys || []);
    const blocks = [];
    if (frozen) {
        blocks.push(h('p', { class: 'alert alert-secondary small mb-2', role: 'status', text: frozen }));
    }
    for (const group of groups) {
        blocks.push(h('section', { class: 'policy-group', data: { area: group.area } },
            h('h3', { class: 'h6', text: group.title }),
            group.keys.map((k) => renderPolicyRow(k, { onChange, layer: 'user', frozen }))));
    }
    if (!groups.length) blocks.push(h('p', { class: 'text-muted', text: 'No setting can be overridden per user.' }));
    const issues = renderIssues(policy, onRemoveUnknown, ['Unknown keys in stored overrides', 'Stored overrides that are ignored']);
    if (issues) blocks.push(issues);
    setChildren(el, blocks);
}

/**
 * "No external hosts", the inverse of `outbound.allow_external`, as the
 * header switch of the tab: on means the key is false.
 */
function renderMasterSwitch(key, onChange) {
    const state = keyState(key);
    const noExternal = key.value === false;
    const message = h('span', { class: 'text-danger small ms-2', role: 'alert', hidden: true });
    const input = h('input', {
        class: 'form-check-input', type: 'checkbox', role: 'switch', id: 'policy-no-external', checked: noExternal,
        disabled: !state.editable,
        onchange: async (e) => {
            message.hidden = true;
            try {
                await onChange(key.name, !e.target.checked);
            } catch (err) {
                message.textContent = (err && err.message) || 'The change failed.';
                message.hidden = false;
                e.target.checked = !e.target.checked;
            }
        },
    });
    return h('div', { class: 'policy-master d-flex align-items-center justify-content-between', data: { key: key.name } },
        h('div', null, h('div', { class: 'fw-semibold', text: 'No external hosts' }),
            h('div', { class: 'small text-muted', text: key.description || 'Stops the browser from contacting any outside service.' })),
        h('div', { class: 'form-check form-switch m-0' }, input,
            h('label', { class: 'form-check-label', for: 'policy-no-external', text: noExternal ? 'ON' : 'OFF' }),
            h('span', { class: 'ms-2' }, badge(key.locked ? 'locked' : (key.source || 'default'), key.locked ? 'dark' : (SOURCE_TONE[key.source] || 'secondary'))),
            message));
}
