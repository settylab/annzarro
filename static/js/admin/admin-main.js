/**
 * The admin page: tab router and section registry (design 5).
 *
 * Each section module default-exports {id, title, mount(el, api, ctx),
 * refresh(), autoRefreshMs?}. The tab is the URL fragment (#users, #data,
 * #health, #panel-sets, #settings, #audit). A section that throws while it
 * loads shows the message and a Retry button instead of an empty page.
 * `autoRefreshMs` makes the router call refresh() on that period while the
 * section is shown and the document is visible.
 *
 * Pure helpers are exported for `node --test`; boot() runs only in the page.
 */

import { createAdminApi } from './admin-api.js';
import { createReauthModal } from './reauth-modal.js';
import { h, setChildren } from './dom.js';
import { mountThemeToggle } from '../utils/theme-toggle.js';
import { mayReplace, noticeDuration } from '../utils/notice-rules.js';
import users from './users.js';
import dataRoots from './data-roots.js';
import health from './health.js';
import panelSets from './panel-sets.js';
import settings from './settings.js';
import audit from './audit.js';

export const SECTIONS = [users, dataRoots, health, panelSets, settings, audit];

/**
 * The section a URL fragment names.
 * @param {string} hash - "#health", "health" or ""
 * @param {Array<{id: string}>} [sections]
 * @returns {string} the first section's id for an empty or unknown fragment
 */
export function sectionFromHash(hash, sections = SECTIONS) {
    const id = String(hash || '').replace(/^#/, '');
    return sections.some((s) => s.id === id) ? id : sections[0].id;
}

/**
 * Show a message as a dismissing Bootstrap alert, by the rules of the main
 * page's toasts (utils/notice-rules.js): a new message replaces those of
 * equal or lower severity and stacks below a more severe one; an error stays
 * until closed, the others for a time that scales with their length; the
 * clock is held while the pointer or focus is on a message.
 * @param {HTMLElement} host
 * @param {string} message
 * @param {string} [level] - Bootstrap colour ('danger' is an error)
 * @param {number} [ms] - how long (0 keeps it until dismissed); default by level and length
 */
export function showToast(host, message, level = 'info', ms = undefined) {
    const type = level === 'danger' ? 'error' : level;
    for (const shown of [...host.children]) {
        if (mayReplace(shown.noticeType, type)) host.removeChild(shown);
    }
    const node = h('div', { class: `alert alert-${level} alert-dismissible shadow-sm py-2`, role: 'alert' },
        h('span', { text: message }),
        h('button', { type: 'button', class: 'btn-close', 'aria-label': 'Close', onclick: () => host.removeChild(node) }));
    node.noticeType = type;
    host.appendChild(node);
    const total = noticeDuration(type, '', message, ms);
    if (total > 0) {
        let left = total;
        let since = 0;
        let timer = null;
        let held = 0;      // the pointer and the focus: 0 when neither is on the message
        const start = () => {
            since = Date.now();
            timer = setTimeout(() => { if (node.parentNode === host) host.removeChild(node); }, left);
        };
        const hold = (on) => {
            held = Math.max(0, held + (on ? 1 : -1));
            if (on && held === 1 && timer !== null) {
                clearTimeout(timer);
                timer = null;
                left = Math.max(0, left - (Date.now() - since));
            } else if (!on && held === 0 && timer === null) {
                left = Math.max(2000, left);
                start();
            }
        };
        for (const [begin, end] of [['mouseenter', 'mouseleave'], ['focusin', 'focusout']]) {
            node.addEventListener(begin, () => hold(true));
            node.addEventListener(end, () => hold(false));
        }
        start();
    }
    return node;
}

/**
 * The router. `view` is the section container, `nav` the tab list.
 * @param {Object} options
 * @param {HTMLElement} options.nav
 * @param {HTMLElement} options.view
 * @param {Object} options.api
 * @param {Object} [options.ctx] - passed to sections as the third argument to mount
 * @param {Array} [options.sections]
 * @param {function(function, number): *} [options.setTimer] - for tests
 * @returns {{show: function(string): Promise<void>, current: function(): (string|null), stop: function}}
 */
export function createRouter({ nav, view, api, ctx = {}, sections = SECTIONS, setTimer = setInterval, clearTimer = clearInterval }) {
    let current = null;
    let timer = null;
    let token = 0;

    const tabs = sections.map((s) => h('li', { class: 'nav-item' },
        h('a', { class: 'nav-link', href: `#${s.id}`, data: { section: s.id }, text: s.title })));
    setChildren(nav, tabs);

    function markActive(id) {
        sections.forEach((s, i) => {
            const link = tabs[i].firstChild;
            const on = s.id === id;
            link.setAttribute('class', on ? 'nav-link active' : 'nav-link');
            if (on) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
        });
    }

    function stopTimer() {
        if (timer !== null) clearTimer(timer);
        timer = null;
    }

    async function show(id) {
        const section = sections.find((s) => s.id === id) || sections[0];
        const mine = ++token;
        stopTimer();
        current = section.id;
        markActive(section.id);
        const body = h('div', { class: 'admin-section', id: `admin-${section.id}` },
            h('p', { class: 'text-muted', text: 'Loading' }));
        setChildren(view, body);
        try {
            await section.mount(body, api, ctx);
        } catch (e) {
            if (mine !== token) return;
            setChildren(body, h('div', { class: 'alert alert-danger', role: 'alert' },
                h('div', { text: (e && e.message) || 'Could not load this section.' }),
                h('button', { type: 'button', class: 'btn btn-sm btn-outline-danger mt-2', text: 'Retry', onclick: () => show(section.id) })));
            return;
        }
        if (mine !== token) return;
        if (section.autoRefreshMs) {
            timer = setTimer(async () => {
                if (globalThis.document && globalThis.document.hidden) return;
                try {
                    await section.refresh();
                } catch (e) {
                    if (ctx.toast) ctx.toast(e.message, 'warning');
                }
            }, section.autoRefreshMs);
        }
    }

    return { show, current: () => current, stop: stopTimer };
}

/** Wire the page. */
export async function boot(doc = globalThis.document) {
    const themeHost = doc.getElementById('theme-toggle');
    if (themeHost) mountThemeToggle(themeHost);
    const toasts = doc.getElementById('admin-toasts');
    const toast = (message, level, ms) => showToast(toasts, message, level, ms);
    let modal = null;
    const api = createAdminApi({
        requestReauth: () => modal.request(),
        onSlowDown: (wait) => toast(wait ? `Slow down. Try again in ${wait} s.` : 'Slow down.', 'warning'),
    });
    modal = createReauthModal({ api });

    let me = null;
    try {
        me = await api.adminFetch('/api/v1/auth/me');
    } catch (e) {
        toast(e.message, 'danger', 0);
    }
    const who = doc.getElementById('admin-user');
    if (who && me && me.username) who.textContent = `${me.username}${me.is_admin ? ' (admin)' : ''}`;

    const router = createRouter({
        nav: doc.getElementById('admin-nav'), view: doc.getElementById('admin-main'), api, ctx: { me, toast },
    });
    const go = () => router.show(sectionFromHash(globalThis.location.hash));
    globalThis.addEventListener('hashchange', go);
    await go();
    return router;
}

if (typeof document !== 'undefined' && document.getElementById('admin-main')) {
    boot();
}
