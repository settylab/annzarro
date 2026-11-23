/**
 * The shared Plot Options pop-over (WP-5a; design note options-ux-080 sections 2f, 4 and 5; operator decisions 25, 30
 * and 33): one renderer of options-schema.js on the pop-over primitive (ui/popover.js), with each kind's defaults, for
 * the Cell-Gene Plot and the Cell Count Plot. WP-5b puts the Cell Plot and Gene Plot on it.
 *
 * WHAT IT SHOWS, top to bottom (`ORDER` of the schema): Text, Background, Axes, the panel's own sections, Legend,
 * Margins, Export, Apply. Each section folds (`<details>`; folding inside the pop-over moves nothing in the panel), its
 * open state kept per kind for the page's life; Text, Legend, Export and the panel's own sections start open. A common
 * section has a Reset that puts its fields back to the kind's defaults.
 *  - A field (`data-option=<id>`) edits the configuration live, one undoable step with a label (`ctx.commit`). A number
 *    box commits on change or Enter; empty is the default. A colour that follows the app theme has Auto.
 *  - A panel section is fields of the schema (`registerPanelFields`) or an element the panel made (`sections[id].element`,
 *    the Cell Count Plot's own controls), moved into the pop-over while it is open.
 *  - Export: PNG, SVG, JPEG and WEBP through exportPlot (plot-aesthetics-menu.js), at the size set or the size on screen,
 *    2x unless switched off; Download CSV.
 *  - Apply: the look to the other plots of the kind (after a question in place), and the session default
 *    (utils/session-style.js): make this plot's look the default, or go back to the built-in one.
 *
 * SESSION DEFAULT. A plot on Default (`styleDefault: true`, set by the chooser) takes the session default when it mounts
 * and whenever the default changes (`ctx.replace`, no undo step); any edit of a copied field gives it a look of its own.
 *
 * Usage (cell-gene/options.js, panels/cell-count.js):
 *   const po = mountPlotOptions({ anchor, kind, panelId, config, commit, replace, sections, exportImage, plotSize,
 *       csv, canExport, exportOff, classes });
 *   po.update();   // the configuration or the drawing changed
 *   po.destroy();
 */
import { createPopover } from '../../ui/popover.js';
import {
    sectionsOf, readField, writeField, defaultOf, helpOf, isSet, pickLook, adoptLook, resolveStyle
} from './options-schema.js';
import { exportSettings } from './plot-style.js';
import { setSessionStyle, clearSessionStyle, hasSessionStyle, onSessionStyleChange, followLook } from '../../utils/session-style.js';

/** The image formats, in the order the Export section offers them. */
export const IMAGE_FORMATS = Object.freeze(['png', 'svg', 'jpeg', 'webp']);

/** The plot kinds' names, as their panels are called. */
const KIND_NAMES = Object.freeze({ 'cell-gene': 'Cell-Gene', 'cell-count': 'Cell Count' });

/** Sections that start open; the rest fold until opened. */
const OPEN_FIRST = new Set(['text', 'legend', 'export']);

/** Per kind and section, whether it was left open (for the page's life). */
const _open = new Map();

/** The mounted pop-overs, for the session default to reach. */
const _mounted = new Set();

function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'data') for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
        else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
        else if (k === 'aria') for (const [ak, av] of Object.entries(v)) node.setAttribute(`aria-${ak}`, av);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
    return node;
}

/** '#abc' as '#aabbcc', what an <input type=color> takes. */
const sixDigits = (c) => (typeof c === 'string' && /^#[0-9a-f]{3}$/i.test(c) ? `#${[...c.slice(1)].map((h) => h + h).join('')}` : typeof c === 'string' ? c.slice(0, 7) : '#000000');

/** An undo step's label for a field set to `value`. */
function stepLabel(field, value) {
    const name = field.label.replace(/\s*\([^)]*\)\s*$/, '').toLowerCase();
    if (field.type === 'check') return `${value ? '' : 'no '}${name}`;
    return name;
}

/**
 * Mount the shared Plot Options on `anchor`.
 * @param {Object} ctx
 * @param {HTMLElement} ctx.anchor - the Plot Options button
 * @param {'cell-gene'|'cell-count'} ctx.kind
 * @param {string} ctx.panelId
 * @param {() => Object} ctx.config - the configuration now
 * @param {(next: Object, label: string) => void} ctx.commit - one undoable step
 * @param {(next: Object) => void} ctx.replace - the session default followed: no undo step
 * @param {Object<string, {title: string, element?: HTMLElement, paint?: Function}>} [ctx.sections] - the panel's sections
 * @param {(format: string, settings: Object) => void} [ctx.exportImage]
 * @param {() => {width?: number, height?: number}} [ctx.plotSize]
 * @param {() => void} [ctx.csv] - Download CSV
 * @param {() => boolean} [ctx.canExport] - whether there is a drawing to export
 * @param {(format: string) => string} [ctx.exportOff] - why a format is off now ('' when it is not)
 * @param {{export?: string, exportBtn?: string, csv?: string}} [ctx.classes] - the panel's own class names (test hooks)
 * @returns {{update: Function, destroy: Function, popover: Object, body: HTMLElement}}
 */
export function mountPlotOptions(ctx) {
    const { anchor, kind, panelId } = ctx;
    const classes = ctx.classes || {};
    const panelSections = ctx.sections || {};
    const controls = new Map();          // field id -> { field, input, wrap, auto? }
    const sectionEls = new Map();        // section id -> details
    const config = () => ctx.config() || {};

    function set(field, value) {
        const now = config();
        const next = writeField(now, field, value, kind);
        if (field.copy !== false && now.styleDefault === true) delete next.styleDefault;
        if (JSON.stringify(next) === JSON.stringify(now)) { paint(); return; }
        ctx.commit(next, stepLabel(field, value));
    }

    function fieldControl(field) {
        const id = `po-${panelId}-${field.id}`;
        const help = helpOf(field, kind);
        const helpEl = help ? el('small', { class: 'po-help', text: help }) : null;
        let input;
        let wrap;
        let auto = null;
        if (field.type === 'check') {
            input = el('input', { type: 'checkbox', id, class: 'form-check-input', data: { option: field.id }, on: { change: () => set(field, input.checked) } });
            wrap = el('div', { class: 'po-field po-field--check' }, el('label', { class: 'po-check', for: id }, input, ` ${field.label}`), helpEl);
        } else {
            if (field.type === 'select') {
                input = el('select', { id, class: 'form-select form-select-sm', data: { option: field.id }, on: { change: () => set(field, input.value) } },
                    field.choices.map(([v, t]) => el('option', { value: v, text: t })));
            } else if (field.type === 'color') {
                input = el('input', { type: 'color', id, class: 'form-control form-control-sm form-control-color', data: { option: field.id },
                    on: { change: () => set(field, input.value) } });
                if (defaultOf(field, kind) === null) {
                    auto = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary po-auto', data: { auto: field.id },
                        title: 'Follow the app theme', aria: { pressed: 'false' }, on: { click: () => set(field, null) } }, 'Auto');
                }
            } else {
                const number = field.type === 'number';
                input = el('input', { type: number ? 'number' : 'text', id, class: `form-control form-control-sm ${number ? 'po-num' : 'po-text'}`,
                    data: { option: field.id }, autocomplete: 'off',
                    ...(number ? { min: field.min, max: field.max, step: field.step ?? 'any' } : {}) });
                const commitIt = () => {
                    const raw = input.value.trim();
                    if (!number) { set(field, raw); return; }
                    if (raw === '') { set(field, null); return; }
                    const v = Number(raw);
                    if (!Number.isFinite(v)) { paint(); return; }
                    set(field, v);
                };
                input.addEventListener('change', commitIt);
                input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitIt(); } });
            }
            wrap = el('div', { class: `po-field po-field--${field.type}` },
                el('label', { class: 'po-field__label', for: id, text: field.label }),
                el('span', { class: 'po-field__control' }, input, auto), helpEl);
        }
        controls.set(field.id, { field, input, wrap, auto });
        return wrap;
    }

    // ---------------------------------------------------------------- Export and Apply
    const imageBtns = IMAGE_FORMATS.map((format) => el('button', { type: 'button', class: `btn btn-sm btn-outline-secondary po-export-btn ${classes.exportBtn || ''}`,
        data: { format }, on: { click: () => exportAs(format) } }, format.toUpperCase()));
    const csvBtn = ctx.csv ? el('button', { type: 'button', class: `btn btn-sm btn-outline-secondary po-csv-btn ${classes.csv || ''}`, on: { click: () => ctx.csv() } }, 'Download CSV') : null;

    function exportAs(format) {
        if (!ctx.exportImage) return;
        const style = resolveStyle(config(), kind);
        ctx.exportImage(format, exportSettings(style, ctx.plotSize ? ctx.plotSize() : {}));
    }

    const others = () => {
        const pm = typeof window !== 'undefined' ? window.PanelManager : null;
        if (!pm || typeof pm.getActivePanels !== 'function') return [];
        return pm.getActivePanels().filter((p) => p && p.getType && p.getType() === kind && p.getId() !== panelId);
    };
    const name = KIND_NAMES[kind] || kind;
    const applyBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary po-apply-others' }, `Apply to other ${name} plots`);
    const askText = el('span', { class: 'po-help' });
    const askYes = el('button', { type: 'button', class: 'btn btn-sm btn-primary po-apply-yes' }, 'Apply');
    const askNo = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary po-apply-no' }, 'Cancel');
    const ask = el('div', { class: 'po-ask', hidden: true }, askText, el('span', { class: 'po-ask__buttons' }, askYes, askNo));
    const applyDone = el('div', { class: 'po-help po-apply-done', role: 'status', aria: { live: 'polite' } });
    const sessionState = el('div', { class: 'po-help po-session-state' });
    const sessionSet = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary po-session-set' }, 'Make this the session default');
    const sessionReset = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary po-session-reset' }, 'Back to built-in');
    applyBtn.addEventListener('click', () => {
        const n = others().length;
        applyDone.textContent = '';
        if (!n) { applyDone.textContent = `There are no other ${name} plots.`; return; }
        askText.textContent = `Replace the look of ${n} other plot${n === 1 ? '' : 's'} with this one's?`;
        ask.hidden = false;
        applyBtn.hidden = true;
        askYes.focus();
    });
    askNo.addEventListener('click', () => { ask.hidden = true; applyBtn.hidden = false; applyBtn.focus(); });
    askYes.addEventListener('click', () => {
        ask.hidden = true;
        applyBtn.hidden = false;
        const n = applyToOthers();
        applyDone.textContent = `Applied to ${n} plot${n === 1 ? '' : 's'}.`;
        applyBtn.focus();
    });
    sessionSet.addEventListener('click', () => {
        const now = config();
        setSessionStyle(kind, now);
        // its look is the default now: it follows it from here
        if (now.styleDefault !== true) ctx.replace({ ...now, styleDefault: true });
        paint();
    });
    sessionReset.addEventListener('click', () => { clearSessionStyle(kind); paint(); });

    /** The look of this plot on every other plot of the kind; returns how many. */
    function applyToOthers() {
        const look = pickLook(config(), kind);
        const list = others();
        for (const p of list) {
            const next = adoptLook(p.getConfig(), look, kind);
            delete next.styleDefault;                      // a look of its own, whatever the default is
            const mine = mountedOf(p.getId());
            if (mine) mine.replace(next); else p.setConfig(next);
        }
        return list.length;
    }

    // ---------------------------------------------------------------- the sections
    const root = el('div', { class: `po-options po-options--${kind}`, data: { kind } });
    for (const sec of sectionsOf(kind)) {
        const own = sec.panel ? panelSections[sec.id] : null;
        if (sec.panel && !own) continue;
        const title = sec.panel ? own.title : sec.title;
        const key = `${kind}:${sec.id}`;
        const open = _open.has(key) ? _open.get(key) : (sec.panel || OPEN_FIRST.has(sec.id));
        const details = el('details', { class: `po-section${sec.id === 'export' && classes.export ? ` ${classes.export}` : ''}`, data: { section: sec.id }, open },
            el('summary', { class: 'po-section__title', text: title }));
        details.addEventListener('toggle', () => _open.set(key, details.open));
        const body = el('div', { class: 'po-section__body' });
        if (own && own.element) body.append(own.element);
        for (const f of sec.fields) body.append(fieldControl(f));
        if (sec.id === 'export') {
            body.prepend(el('div', { class: 'po-buttons po-export-formats' }, imageBtns));
            if (csvBtn) body.append(el('div', { class: 'po-buttons' }, csvBtn));
        }
        if (sec.id === 'apply') {
            body.append(el('div', { class: 'po-buttons' }, applyBtn), ask, applyDone,
                sessionState, el('div', { class: 'po-buttons' }, sessionSet, sessionReset));
        }
        if (!sec.panel && sec.fields.length) {
            const reset = el('button', { type: 'button', class: 'btn btn-sm btn-link po-reset', data: { reset: sec.id },
                on: { click: () => resetSection(sec) } }, 'Reset');
            body.append(el('div', { class: 'po-section__foot' }, reset));
        }
        details.append(body);
        sectionEls.set(sec.id, details);
        root.append(details);
    }

    function resetSection(sec) {
        const now = config();
        let next = now;
        for (const f of sec.fields) next = writeField(next, f, null, kind);
        if (sec.fields.some((f) => f.copy !== false) && now.styleDefault === true) delete next.styleDefault;
        if (JSON.stringify(next) === JSON.stringify(now)) return;
        ctx.commit(next, `reset ${sec.title.toLowerCase()}`);
    }

    // ---------------------------------------------------------------- paint
    function paint() {
        const c = config();
        for (const { field, input, wrap, auto } of controls.values()) {
            wrap.hidden = typeof field.when === 'function' ? !field.when(c) : false;
            const v = readField(c, field, kind);
            if (field.type === 'check') input.checked = !!v;
            else if (field.type === 'color') {
                input.value = sixDigits(v ?? '#000000');
                if (auto) {
                    const isAuto = v === null;
                    auto.setAttribute('aria-pressed', String(isAuto));
                    auto.classList.toggle('active', isAuto);
                    input.classList.toggle('po-color--auto', isAuto);
                }
            } else if (document.activeElement !== input) input.value = v === null || v === undefined ? '' : String(v);
            if (field.type === 'number' && defaultOf(field, kind) !== null) input.placeholder = String(defaultOf(field, kind));
        }
        for (const [id, details] of sectionEls) {
            const sec = sectionsOf(kind).find((s) => s.id === id);
            if (!sec) continue;
            const own = sec.panel ? panelSections[id] : null;
            const fields = sec.fields;
            const anyShown = (own && own.element) || fields.some((f) => !controls.get(f.id).wrap.hidden) || id === 'export' || id === 'apply';
            details.hidden = !anyShown || (own && typeof own.when === 'function' && !own.when(c));
            if (own && typeof own.paint === 'function') own.paint();
            const reset = details.querySelector('.po-reset');
            if (reset) reset.disabled = !fields.some((f) => isSet(c, f, kind));
        }
        const can = ctx.canExport ? ctx.canExport() : true;
        for (const b of imageBtns) {
            const off = ctx.exportOff ? ctx.exportOff(b.dataset.format) : '';
            b.disabled = !can || !!off;
            if (off) b.title = off; else b.removeAttribute('title');
        }
        if (csvBtn) csvBtn.disabled = !can;
        const onDefault = c.styleDefault === true;
        sessionState.textContent = onDefault ? (hasSessionStyle(kind) ? 'On Default: this plot follows the session default.' : 'On Default (built-in).') : 'Own style.';
        sessionReset.hidden = !hasSessionStyle(kind);
    }

    const popover = createPopover({
        anchor, name: 'plot-options', title: 'Plot Options',
        render: (host) => { host.appendChild(root); paint(); }
    });

    const me = {
        panelId, kind, config,
        replace: (next) => ctx.replace(next),
        follow() {
            const c = config();
            if (c.styleDefault !== true) return;
            const next = followLook(c, kind);
            if (JSON.stringify(next) !== JSON.stringify(c)) ctx.replace(next);
        }
    };
    _mounted.add(me);
    // a plot on Default takes the session default when it is made (after the panel's own set-up)
    setTimeout(() => { if (_mounted.has(me)) me.follow(); }, 0);

    return {
        update: paint,
        popover,
        body: root,
        destroy() {
            _mounted.delete(me);
            popover.destroy();
        }
    };
}

function mountedOf(panelId) {
    for (const m of _mounted) if (m.panelId === panelId) return m;
    return null;
}

// The session default was set, changed, reset or loaded: the plots on Default follow it
onSessionStyleChange(() => { for (const m of [..._mounted]) m.follow(); });
