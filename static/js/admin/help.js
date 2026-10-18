/**
 * The help every setting of the admin pages carries: an info mark whose text shows on hover
 * and on keyboard focus, and a "Guide" link to the place in the docs that explains it.
 *
 * A setting of the policy registry brings both from the server (`description` and `guide` of
 * GET /api/v1/admin/policy); one that is no registry key (a field of the Users dialogs, the
 * data directories) takes them from help-catalog.js. Either way the row is built with
 * `settingHelp`, so every page looks and behaves alike: the mark is a button (reachable by
 * Tab), the text is also in the page for screen readers (`aria-describedby`), Escape closes
 * the tip, and the text is plain text, never markup.
 *
 * tests/browser/test_admin_help.py walks every admin page for a control with neither.
 */

import { h } from './dom.js';

/** The marks that have a Bootstrap tooltip, to close the tips of marks the page has since replaced. */
const live = new Set();

/**
 * Close the tips of marks that are no longer in the page (a section drew again while one showed),
 * or of every mark with `all`: the router calls it before it draws another section.
 * @param {boolean} [all]
 */
export function closeHelp(all = false) {
    const Tooltip = globalThis.bootstrap && globalThis.bootstrap.Tooltip;
    for (const mark of [...live]) {
        if (!all && mark.isConnected) continue;
        const tip = Tooltip && Tooltip.getInstance(mark);
        if (tip) tip.dispose();
        live.delete(mark);
    }
}

export const DOCS = 'https://annzarro.readthedocs.io/en/latest/';

let counter = 0;

const CONTROLS = ['INPUT', 'SELECT', 'TEXTAREA'];

/** `node` if it is a form control, else the first one inside it, else `node`. */
function controlIn(node) {
    const find = (n) => {
        if (CONTROLS.includes(n.tagName)) return n;
        for (const child of n.children || []) {
            const found = find(child);
            if (found) return found;
        }
        return null;
    };
    return find(node) || node;
}

/**
 * @param {string} guide - a page under the docs root with an anchor, "deployment/admin.html#panels"
 * @returns {string} the address on the published docs
 */
export function docsUrl(guide) {
    return DOCS + String(guide || '').replace(/^\/+/, '');
}

/** The last line of a tip: nodes with the path or the key in code. */
function configLine({ setting, path, name }) {
    const code = (text) => h('code', { class: 'admin-help-path', text });
    return setting ? ['Config file: ', code(path)]
        : ['Config file: none. Set here or per user; to lock it, list ', code(name), ' under ', code('policy.locked'), '.'];
}

/**
 * The info mark. The text shows in a Bootstrap tooltip on hover and focus; without Bootstrap it
 * is the title.
 * @param {string} title - what the setting is called (the mark's accessible name)
 * @param {string} text - one or two plain sentences
 * @param {Object} [opts]
 * @param {HTMLElement[]} [opts.describes] - controls the text also describes (`aria-describedby`); for a
 *        wrapper, the first input, select or textarea inside it
 * @param {{path: string, setting: boolean, name: string}} [opts.configFile] - where the config file has it:
 *        the YAML path, shown as a last line in monospace; `setting` false means the file has no value
 *        for it (it is set here or per user) and the line says how to lock it, with `name`, the key
 * @returns {HTMLElement}
 */
export function helpMark(title, text, { describes = [], configFile = null } = {}) {
    counter += 1;
    const id = `admin-help-${counter}`;
    const line = !configFile ? '' : configFile.setting ? `Config file: ${configFile.path}`
        : `Config file: none. Set here or per user; to lock it, list ${configFile.name} under policy.locked.`;
    const plain = configFile ? `${text}\n${line}` : text;
    const mark = h('button', {
        type: 'button', class: 'btn btn-link btn-sm p-0 ms-1 admin-help-mark', 'aria-label': `Help: ${title}`,
        title: plain, 'aria-describedby': id, 'data-config-file': configFile ? (configFile.setting ? configFile.path : 'none') : false, 'data-bs-toggle': 'tooltip', 'data-bs-placement': 'right', 'data-help': '',
    }, h('i', { class: 'fas fa-circle-info', 'aria-hidden': 'true' }));
    const hidden = h('span', { class: 'visually-hidden', id, text: configFile ? `${text} ${line}` : text });
    for (const wrapper of describes) {
        const control = controlIn(wrapper);
        const before = control.getAttribute('aria-describedby');
        control.setAttribute('aria-describedby', before ? `${before} ${id}` : id);
    }
    const bootstrap = globalThis.bootstrap;
    if (bootstrap && bootstrap.Tooltip) {
        const body = configFile ? h('div', { class: 'text-start' }, h('div', { text }),
            h('div', { class: 'mt-1' }, ...configLine(configFile))) : null;
        const tip = bootstrap.Tooltip.getOrCreateInstance(mark, { container: 'body', ...(body ? { html: true, title: body } : {}) });
        // Bootstrap swaps aria-describedby for the tip while it shows and drops it after
        live.add(mark);
        mark.addEventListener('show.bs.tooltip', () => closeHelp());
        mark.addEventListener('hidden.bs.tooltip', () => mark.setAttribute('aria-describedby', id));
        mark.addEventListener('keydown', (e) => { if (e.key === 'Escape') tip.hide(); });
    }
    return h('span', { class: 'admin-help text-nowrap' }, mark, hidden);
}

/**
 * The "Guide" link to the docs.
 * @param {string} guide - see docsUrl
 * @param {string} title - what the setting is called (read out after "Guide")
 * @param {string} [text]
 * @returns {HTMLElement|null} null without a guide
 */
export function guideLink(guide, title, text = 'Guide') {
    if (!guide) return null;
    return h('a', {
        class: 'small ms-2 admin-guide', href: docsUrl(guide), target: '_blank', rel: 'noopener noreferrer',
        'data-guide': guide,
    }, text, h('span', { class: 'visually-hidden', text: ` for ${title}` }));
}

/**
 * The mark and the link of one setting, to put after its name.
 * @param {{title: string, text: string, guide: string}} help
 * @param {Object} [opts] - see helpMark
 * @returns {Array<HTMLElement>}
 */
export function settingHelp({ title, text, guide }, opts) {
    return [helpMark(title, text || title, opts), guideLink(guide, title)];
}
