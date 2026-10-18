/**
 * Public site section: the `site.*` keys (annzarro/server/site.py), what the footer, the About
 * dialog and the /site/* pages show.
 *
 * They are policy keys with `section: "site"`, so this page reads and writes them through
 * GET/PUT /api/v1/admin/policy like the Settings tab: the overlay wins over the config file
 * unless `policy.locked` names the key, a value is checked by the same code that checks the
 * config file at start, and a change shows on every page at once, without a restart. A text's
 * `file` can only be set in the config file; this page shows it read-only.
 *
 * Every field has a help on hover or focus (the key's description, from the server) and a
 * link to the public-site guide (the key's `guide`), both from the shared help.js. A text written in Markdown is previewed with the renderer the
 * About dialog and the pages use (utils/safe-markdown.js), inside a sandboxed frame: no script
 * runs there and it cannot reach this page, so the preview is as inert as the text's output.
 *
 * The pure helpers (siteKeys, textMode, textPayload, checklist, previewDocument) run under
 * `node --test`.
 */

import { h, setChildren, badge } from './dom.js';
import { guideLink } from './help.js';
import { keyHelp } from './help-catalog.js';
import { renderSafeMarkdown } from '../utils/safe-markdown.js';
import { appUrl } from '../utils/app-url.js';

export const TEXTS = ['imprint', 'privacy', 'accessibility', 'terms'];

/** Titles (and placeholders) of each key, by its name without `site.`; the help and guide come from the server */
export const FIELDS = {
    imprint: { title: 'Imprint' },
    privacy: { title: 'Privacy notice' },
    accessibility: { title: 'Accessibility statement' },
    terms: { title: 'Terms of use' },
    operator: { title: 'Operator' },
    contact: { title: 'Contact', placeholder: 'office@example.org or https://...' },
    contact_label: { title: 'Contact link text', placeholder: 'Contact' },
    security_contact: { title: 'Security contact', placeholder: 'mailto:security@example.org' },
    languages: { title: 'Language of the texts', placeholder: 'en' },
    footer_links: { title: 'Footer links' },
    robots: { title: 'Search engines' },
    software_credits: { title: 'AnnZarro credit in About' },
    'storage.persistent_convenience': { title: 'Keep convenience items between visits' },
};

const GROUPS = [
    ['Who runs the site', ['operator', 'contact', 'contact_label', 'security_contact', 'languages']],
    ['Behaviour', ['footer_links', 'robots', 'software_credits', 'storage.persistent_convenience']],
];

const SOURCE_TEXT = { admin: 'set here', config: 'config file', env: 'environment', default: 'default' };
const SOURCE_TONE = { admin: 'primary', config: 'info', env: 'warning', default: 'secondary' };

/**
 * The site keys of a policy reply, by their name without `site.`.
 * @param {Object} policy - GET /api/v1/admin/policy
 * @returns {Object<string, Object>}
 */
export function siteKeys(policy) {
    const out = {};
    for (const key of (policy && policy.keys) || []) {
        if (key.section === 'site' && key.name.startsWith('site.')) out[key.name.slice(5)] = key;
    }
    return out;
}

/**
 * Which form a text value takes, as the server reads it: a url wins, then a file, then markdown.
 * @param {Object|null} value - {label, url, markdown, file}
 * @returns {'url'|'file'|'markdown'|'none'}
 */
export function textMode(value) {
    const v = value || {};
    if (v.url) return 'url';
    if (v.file) return 'file';
    if (v.markdown && String(v.markdown).trim()) return 'markdown';
    return 'none';
}

/**
 * The value to store for a text from what the form holds.
 * @param {string} mode - 'none' | 'url' | 'markdown'
 * @param {{label: string, url: string, markdown: string}} fields
 * @returns {{label: (string|null), url: (string|null), markdown: (string|null), file: null}}
 */
export function textPayload(mode, { label = '', url = '', markdown = '' } = {}) {
    const trimmed = String(label).trim();
    return {
        label: trimmed || null,
        url: mode === 'url' ? (String(url).trim() || null) : null,
        markdown: mode === 'markdown' ? (String(markdown) || null) : null,
        file: null,
    };
}

/**
 * What a public site owes its visitors, set or missing.
 * @param {Object<string, Object>} keys - siteKeys()
 * @returns {Array<{id: string, title: string, set: boolean}>}
 */
export function checklist(keys) {
    const text = (kind) => Boolean(keys[kind]) && textMode(keys[kind].value) !== 'none';
    return [
        { id: 'imprint', title: 'Imprint', set: text('imprint') },
        { id: 'privacy', title: 'Privacy notice', set: text('privacy') },
        { id: 'contact', title: 'Contact', set: Boolean(keys.contact && keys.contact.value) },
        { id: 'accessibility', title: 'Accessibility statement', set: text('accessibility') },
    ];
}

const SAFE_COLOUR = /^[#(),.%\w\s-]+$/;

/**
 * The preview frame's document: the safe renderer's output under a few styles in the page's colours.
 * @param {string} markdown
 * @param {{text?: string, background?: string, link?: string, border?: string}} [colours]
 * @returns {string}
 */
export function previewDocument(markdown, colours = {}) {
    const c = (value, fallback) => (typeof value === 'string' && SAFE_COLOUR.test(value) ? value : fallback);
    const text = c(colours.text, '#212529');
    const background = c(colours.background, '#ffffff');
    const link = c(colours.link, '#0d6efd');
    const border = c(colours.border, '#dee2e6');
    const body = String(markdown || '').trim()
        ? renderSafeMarkdown(markdown, { headingBase: 2 })
        : '<p style="opacity:.6">Nothing to preview yet.</p>';
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
        + `body{margin:.5rem .75rem;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:${text};background:${background}}`
        + `a{color:${link}}h2{font-size:1.2rem}h3{font-size:1.05rem}h4,h5,h6{font-size:1rem}`
        + `table{border-collapse:collapse}th,td{border:1px solid ${border};padding:.2rem .45rem}`
        + `pre{border:1px solid ${border};padding:.4rem;overflow:auto}blockquote{border-left:3px solid ${border};margin:0;padding-left:.75rem}`
        + `</style></head><body>${body}</body></html>`;
}

function pageColours() {
    const doc = globalThis.document;
    if (!doc || !globalThis.getComputedStyle) return {};
    const style = globalThis.getComputedStyle(doc.body);
    const prop = (name) => style.getPropertyValue(name).trim();
    return {
        text: style.color, background: prop('--bs-body-bg') || style.backgroundColor,
        link: prop('--bs-link-color') || undefined, border: prop('--bs-border-color') || undefined,
    };
}

function sourceBadge(key) {
    if (key.locked) return badge('locked', 'dark', 'policy.locked in the config file names this key: only the config file sets it');
    const source = key.source || 'default';
    return badge(SOURCE_TEXT[source] || source, SOURCE_TONE[source] || 'secondary', `The value in effect comes from: ${SOURCE_TEXT[source] || source}`);
}

function fieldHead(name, key, extra, describes) {
    const field = { ...(FIELDS[name] || { title: name }), ...(key.label ? { title: key.label } : {}) };
    return h('div', { class: 'd-flex flex-wrap align-items-center gap-1 site-field-head' },
        h('span', { class: 'fw-semibold', id: `site-${css(name)}-title`, text: field.title }),
        keyHelp(key, field.title, { describes }),
        h('code', { class: 'small text-muted', text: key.name }),
        sourceBadge(key),
        extra || null);
}

function css(name) {
    return name.replace(/[^A-Za-z0-9_-]/g, '-');
}

/**
 * The section's state: what the form holds that differs from the server, the inline errors.
 * Kept across a reload that a save causes, so the admin sees which field was refused.
 */
function createForm(keys, onDirty) {
    const pending = {};
    const errors = {};
    const errorNodes = {};
    return {
        keys,
        pending,
        set(name, value) {
            const key = keys[name];
            if (key && JSON.stringify(value) === JSON.stringify(key.value)) delete pending[name];
            else pending[name] = value;
            if (errorNodes[name]) errorNodes[name].hidden = true;
            onDirty(Object.keys(pending).length);
        },
        errorNode(name) {
            const node = h('div', { class: 'invalid-feedback d-block site-error', role: 'alert', hidden: !errors[name], text: errors[name] || '' });
            errorNodes[name] = node;
            return node;
        },
        showErrors(map) {
            for (const [name, message] of Object.entries(map)) {
                errors[name] = message;
                const node = errorNodes[name];
                if (node) {
                    node.textContent = message;
                    node.hidden = false;
                }
            }
        },
        clearErrors() {
            for (const name of Object.keys(errors)) delete errors[name];
            for (const node of Object.values(errorNodes)) node.hidden = true;
        },
    };
}

function lockedNote(key) {
    return key.locked ? h('p', { class: 'small text-muted mb-1', text: 'Only the config file sets this (policy.locked names it).' }) : null;
}

function resetButton(name, key, onReset) {
    if (key.source !== 'admin' || key.locked) return null;
    const back = Object.prototype.hasOwnProperty.call(key, 'config_value') ? 'the config file\'s value' : 'the default';
    return h('button', {
        type: 'button', class: 'btn btn-sm btn-link p-0 ms-1', data: { reset: name },
        text: `Reset to ${back}`, onclick: () => onReset(`site.${name}`),
    });
}

function renderText(kind, key, form, onReset) {
    const value = key.value || {};
    const fileFromConfig = textMode(value) === 'file';
    let mode = fileFromConfig ? 'file' : textMode(value);
    const id = `site-${kind}`;
    const disabled = Boolean(key.locked);
    const label = h('input', {
        type: 'text', class: 'form-control form-control-sm', id: `${id}-label`, maxlength: 60, disabled,
        value: value.label || '', placeholder: (key.type && key.type.default_label) || '',
    });
    const url = h('input', {
        type: 'url', class: 'form-control form-control-sm', id: `${id}-url`, disabled,
        value: value.url || '', placeholder: 'https://example.org/imprint',
    });
    const markdown = h('textarea', {
        class: 'form-control form-control-sm font-monospace site-markdown', id: `${id}-markdown`, rows: 9, disabled,
        spellcheck: 'true', 'aria-describedby': `${id}-md-help`,
    });
    markdown.value = value.markdown || '';
    const frame = h('iframe', {
        class: 'site-preview', sandbox: '', title: `Preview of the ${FIELDS[kind].title.toLowerCase()}`,
        referrerpolicy: 'no-referrer', data: { preview: kind },
    });
    let timer = null;
    const preview = () => frame.setAttribute('srcdoc', previewDocument(markdown.value, pageColours()));
    preview();

    const panes = {
        url: h('div', { class: 'site-pane', data: { pane: 'url' } },
            h('label', { class: 'form-label small mb-1', for: url.id, text: 'Address (http, https or mailto)' }), url),
        markdown: h('div', { class: 'site-pane', data: { pane: 'markdown' } },
            h('div', { class: 'site-editor' },
                h('div', null,
                    h('label', { class: 'form-label small mb-1', for: markdown.id, text: 'Text, in Markdown' }), markdown,
                    h('div', { class: 'form-text', id: `${id}-md-help`, text: 'Headings, lists, bold, italic, links, tables. Raw HTML and images are shown as text.' })),
                h('div', null, h('div', { class: 'form-label small mb-1', text: 'Preview' }), frame))),
        file: fileFromConfig ? h('div', { class: 'site-pane', data: { pane: 'file' } },
            h('p', { class: 'small mb-0' }, 'Read at start from the config file\'s ', h('code', { text: value.file }),
                '. Choose a link or a text to override it here; a file can only be set in the config file.')) : null,
    };
    const choices = [['none', 'Not shown'], ['url', 'Link to a page'], ['markdown', 'Text written here']];
    if (fileFromConfig) choices.push(['file', 'File (config file)']);
    const radios = h('div', { class: 'btn-group btn-group-sm flex-wrap', role: 'radiogroup', 'aria-labelledby': `site-${kind}-title` },
        choices.map(([m, text]) => {
            const rid = `${id}-mode-${m}`;
            return [
                h('input', {
                    type: 'radio', class: 'btn-check', name: `${id}-mode`, id: rid, value: m, checked: m === mode, disabled,
                    onchange: () => { mode = m; show(); changed(); },
                }),
                h('label', { class: 'btn btn-outline-secondary', for: rid, text }),
            ];
        }));
    function show() {
        for (const [m, pane] of Object.entries(panes)) if (pane) pane.hidden = m !== mode;
    }
    function changed() {
        if (mode === 'file') form.set(kind, key.value);
        else form.set(kind, textPayload(mode, { label: label.value, url: url.value, markdown: markdown.value }));
    }
    label.addEventListener('input', changed);
    url.addEventListener('input', changed);
    markdown.addEventListener('input', () => {
        changed();
        clearTimeout(timer);
        timer = setTimeout(preview, 150);
    });
    show();

    return h('section', { class: 'card site-card mb-3', id: `site-card-${kind}`, data: { key: `site.${kind}`, setting: `site.${kind}` } },
        h('div', { class: 'card-body' },
            fieldHead(kind, key, resetButton(kind, key, onReset)),
            lockedNote(key),
            h('div', { class: 'row g-2 align-items-end mt-1 mb-2' },
                h('div', { class: 'col-auto' }, radios),
                h('div', { class: 'col-sm-4 ms-sm-auto' },
                    h('label', { class: 'form-label small mb-1', for: label.id, text: 'Link text' }), label)),
            panes.url, panes.markdown, panes.file,
            form.errorNode(kind)));
}

function renderScalar(name, key, form, onReset) {
    const spec = key.type || {};
    const id = `site-${css(name)}`;
    const disabled = Boolean(key.locked);
    let control;
    if (spec.kind === 'bool') {
        control = h('div', { class: 'form-check form-switch' },
            h('input', {
                class: 'form-check-input', type: 'checkbox', role: 'switch', id, checked: key.value === true, disabled,
                'aria-labelledby': `${id}-title`, onchange: (e) => form.set(name, Boolean(e.target.checked)),
            }));
    } else if (spec.kind === 'enum') {
        control = h('select', {
            class: 'form-select form-select-sm', id, disabled, 'aria-labelledby': `${id}-title`,
            onchange: (e) => form.set(name, e.target.value),
        }, (spec.choices || []).map((c) => {
            const cid = typeof c === 'object' ? c.id : c;
            return h('option', { value: cid, selected: cid === key.value, text: cid });
        }));
    } else {
        control = h('input', {
            type: 'text', class: 'form-control form-control-sm', id, disabled, 'aria-labelledby': `${id}-title`,
            value: key.value === null || key.value === undefined ? '' : String(key.value),
            placeholder: (FIELDS[name] && FIELDS[name].placeholder) || '',
            // an empty field stores "" (no value, over the config file's); null would remove the admin's value
            oninput: (e) => {
                const text = e.target.value.trim();
                form.set(name, text === '' && key.value === null ? null : text);
            },
        });
    }
    return h('div', { class: 'site-row', data: { key: `site.${name}`, setting: `site.${name}` } },
        h('div', null, fieldHead(name, key, resetButton(name, key, onReset), [control]), lockedNote(key)),
        h('div', null, control, form.errorNode(name)));
}

function renderChecklist(keys) {
    const items = checklist(keys);
    const missing = items.filter((i) => !i.set).length;
    return h('section', { class: 'card site-checklist mb-3', id: 'site-checklist' },
        h('div', { class: 'card-body' },
            h('h2', { class: 'h6 card-title' }, 'What a public site owes its visitors',
                guideLink('deployment/public-site.html#what-a-public-site-owes-its-visitors', 'what a public site owes its visitors', 'Why')),
            h('ul', { class: 'list-unstyled mb-2 site-checklist-items' }, items.map((item) => h('li', { data: { check: item.id, set: item.set ? '1' : '0' } },
                h('i', { class: item.set ? 'fas fa-check text-success me-2' : 'fas fa-xmark text-danger me-2', 'aria-hidden': 'true' }),
                h('span', { text: item.title }), ' ',
                badge(item.set ? 'set' : 'missing', item.set ? 'success' : 'danger')))),
            h('p', { class: 'small mb-0' },
                missing ? `${missing} missing. ` : 'All four are set. ',
                'This server also publishes ',
                h('a', { href: appUrl('/site/data'), target: '_blank', rel: 'noopener', text: 'Data & privacy' }),
                ', generated from its configuration, and ',
                h('a', { href: appUrl('/site/about'), target: '_blank', rel: 'noopener', text: 'About' }),
                '; the footer of every page links both.')));
}

let el = null;
let apiRef = null;
let ctxRef = {};

async function load(errors = {}) {
    const policy = await apiRef.policy.get();
    const keys = siteKeys(policy);
    if (!Object.keys(keys).length) {
        setChildren(el, h('p', { class: 'text-muted', text: 'This server has no site settings.' }));
        return;
    }
    const save = h('button', { type: 'button', class: 'btn btn-primary btn-sm', id: 'site-save', disabled: true, text: 'Save changes' });
    const status = h('span', { class: 'small text-muted', id: 'site-status', 'aria-live': 'polite', text: 'No changes.' });
    const form = createForm(keys, (n) => {
        save.disabled = n === 0;
        status.textContent = n ? `${n} unsaved change${n === 1 ? '' : 's'}.` : 'No changes.';
    });
    const reset = async (name) => {
        try {
            await apiRef.policy.set({ [name]: null });
            if (ctxRef.toast) ctxRef.toast('Reset. The pages show the config file\'s value now.', 'success');
            await load();
        } catch (e) {
            if (ctxRef.toast) ctxRef.toast(e.message, 'danger');
        }
    };
    save.addEventListener('click', async () => {
        const changes = Object.fromEntries(Object.entries(form.pending).map(([n, v]) => [`site.${n}`, v]));
        save.disabled = true;
        form.clearErrors();
        try {
            await apiRef.policy.set(changes);
            if (ctxRef.toast) ctxRef.toast('Saved. Every page and /site/* show it now; no restart needed.', 'success');
            await load();
        } catch (e) {
            const body = e.body || {};
            const messages = body.messages || {};
            const inline = {};
            for (const [name, reason] of Object.entries(body.errors || {})) {
                inline[name.replace(/^site\./, '')] = messages[name] || `${name}: ${reason.replace(/_/g, ' ')}`;
            }
            form.showErrors(inline);
            save.disabled = false;
            if (ctxRef.toast) ctxRef.toast(Object.keys(inline).length ? 'Nothing was saved: a value is refused (see the field).' : e.message, 'danger');
        }
    });

    const textCards = TEXTS.filter((k) => keys[k]).map((k) => renderText(k, keys[k], form, reset));
    const groups = GROUPS.map(([title, names]) => h('section', { class: 'site-group mb-3' },
        h('h2', { class: 'h6 site-group-title', text: title }),
        names.filter((n) => keys[n]).map((n) => renderScalar(n, keys[n], form, reset))));
    setChildren(el,
        h('div', { class: 'd-flex flex-wrap align-items-baseline gap-2 mb-2' },
            h('h1', { class: 'h5 mb-0', text: 'Public site' }),
            h('span', { class: 'small text-muted', text: 'What the footer, the About dialog and the /site/ pages show. Changes apply at once, without a restart.' }),
            guideLink('deployment/public-site.html', 'the public site', 'Public-site guide')),
        renderChecklist(keys),
        h('h2', { class: 'h6 site-group-title', text: 'Texts' }),
        textCards,
        groups,
        h('div', { class: 'site-actions d-flex align-items-center gap-3' }, save, status));
    form.showErrors(errors);
}

export default {
    id: 'site',
    title: 'Public site',
    async mount(target, api, ctx = {}) {
        el = target;
        apiRef = api;
        ctxRef = ctx;
        await load();
    },
    refresh: () => load(),
};
