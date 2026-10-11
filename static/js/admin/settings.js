/**
 * Settings section (design 10.6): generated from GET /admin/policy. The
 * widgets live in policy-widgets.js; this module loads the registry, sends
 * changes and shows what the server refused.
 */

import { h, setChildren } from './dom.js';
import { renderPolicy } from './policy-widgets.js';

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
