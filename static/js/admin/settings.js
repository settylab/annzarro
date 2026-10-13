/**
 * Settings section (design 10.6): generated from GET /admin/policy. The
 * widgets live in policy-widgets.js; this module loads the registry, sends
 * changes and shows what the server refused.
 */

import { h, setChildren } from './dom.js';
import { renderPolicy, renderUserPolicy } from './policy-widgets.js';

let el = null;
let apiRef = null;
let ctxRef = {};

async function load() {
    const policy = await apiRef.policy.get();
    renderPolicy(el, policy, {
        onChange: async (name, value) => {
            await apiRef.policy.set({ [name]: value });
            await load();
        },
        onRemoveUnknown: async (name) => {
            try {
                await apiRef.policy.set({ [name]: null });
                await load();
            } catch (e) {
                if (ctxRef.toast) ctxRef.toast(e.message, 'danger');
            }
        },
    });
    if (!(policy.keys || []).length) setChildren(el, h('p', { class: 'text-muted', text: 'The server declares no settings.' }));
}

/**
 * A user's overrides, as a component for the Users and Access dialogs.
 * @param {HTMLElement} target - emptied and filled
 * @param {Object} api - the admin API client
 * @param {string} username
 * @param {Object} [ctx] - {toast}
 * @returns {Promise<{refresh: function}>}
 */
export async function mountUserPolicy(target, api, username, ctx = {}) {
    const refresh = async () => {
        const policy = await api.policy.getUser(username);
        renderUserPolicy(target, policy, {
            onChange: async (name, value) => {
                await api.policy.setUser(username, { [name]: value });
                await refresh();
            },
            onRemoveUnknown: async (name) => {
                try {
                    await api.policy.setUser(username, { [name]: null });
                    await refresh();
                } catch (e) {
                    if (ctx.toast) ctx.toast(e.message, 'danger');
                }
            },
        });
    };
    await refresh();
    return { refresh };
}

export default {
    id: 'settings',
    title: 'Settings',
    async mount(target, api, ctx = {}) {
        el = target;
        apiRef = api;
        ctxRef = ctx;
        await load();
    },
    refresh: () => load(),
};
