/**
 * The shared Plot Options pop-over (WP-5a; design note options-ux-080 sections 2f, 4 and 5; operator decisions 25, 30
 * and 33): one renderer of options-schema.js on the pop-over primitive (ui/popover.js), with each kind's defaults, for
 * the Cell-Gene Plot and the Cell Count Plot. WP-5b puts the Cell Plot and Gene Plot on it.
 *
 * WHAT IT SHOWS, top to bottom (`ORDER` of the schema): Presets (Default, Publication, Bare: one step each), Text, Background, Axes, the panel's own sections, Legend,
 * Margins, Export, Apply. Each section folds (`<details>`; folding inside the pop-over moves nothing in the panel), its
 * open state kept per kind for the page's life; Presets, Text, Legend, Export and the panel's own sections start open. A common
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
    sectionsOf, readField, writeField, defaultOf, helpOf, isSet, pickLook, adoptLook, resolveStyle, applyPreset, PRESETS, PRESET_LABELS,
    placeholderOf, shownOf, disabledOf, toPercent, fromPercent, resettable, readMargins, writeMargins, hasOwnPresets
} from './options-schema.js';
import { exportSettings } from './plot-style.js';
import { exportOptions } from './plot-options.js';
import { setSessionStyle, clearSessionStyle, hasSessionStyle, onSessionStyleChange, followLook } from '../../utils/session-style.js';

/** The image formats, in the order the Export section offers them. */
const IMAGE_FORMATS = Object.freeze(['png', 'svg', 'jpeg', 'webp']);

/** The plot kinds' names, as their panels are called. */
const KIND_NAMES = Object.freeze({ 'cell-gene': 'Cell-Gene', 'cell-count': 'Cell Count' });

/** Sections that start open; the rest fold until opened. */
const OPEN_FIRST = new Set(['presets', 'text', 'legend', 'export']);

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
 * @param {(format: string, settings: Object, how?: 'full'|'shown') => void} [ctx.exportImage]
 * @param {() => ({blocked: boolean, why: string, note: string, shown: string[], size: string}|null)} [ctx.exportGuard] - the memory
 *   guard: a full export that does not fit is greyed out with `why`, `note` says so under the buttons, and `shown` formats of
 *   the plot as on screen (`size` its pixels) are offered beside them
 * @param {{count: () => number, run: () => number}} [ctx.others] - the panel's own Apply to other plots (the kind's look is not the generic one)
 * @param {{set: () => void, clear: () => void, has: () => boolean, onDefault: () => boolean}} [ctx.session] - the same for the session default
 * @param {(settings: Object) => void} [ctx.copyImage] - the plot as a PNG on the clipboard (Export's Copy)
 * @param {() => {width?: number, height?: number}} [ctx.plotSize]
 * @param {() => void} [ctx.csv] - Download CSV
 * @param {() => boolean} [ctx.canExport] - whether there is a drawing to export
 * @param {(format: string) => string} [ctx.exportOff] - why a format is off now ('' when it is not)
 * @param {{export?: string, exportBtn?: string, csv?: string}} [ctx.classes] - the panel's own class names (test hooks)
 * @param {() => (HTMLElement|null)} [ctx.plot] - the graph: its modebar camera exports at the size and scale set here
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
        if (field.copy !== false && field.look !== false && now.styleDefault === true) delete next.styleDefault;
        if (JSON.stringify(next) === JSON.stringify(now)) { paint(); return; }
        ctx.commit(next, stepLabel(field, value));
    }

    /**
     * The margins composite: one box and slider for all four sides while they are linked, a box for each side when they
     * are not, and the switch between. Writes the four sides at once while linked (the top one's value, as the menu did).
     */
    function marginsControl(field) {
        const num = (key, label, cls) => el('input', { type: 'number', id: `margin-${key}-${panelId}`, class: `form-control form-control-sm az-pop-num ${cls}`,
            min: field.min ?? 0, max: field.max ?? 200, step: 1, aria: { label } });
        const all = el('input', { type: 'range', id: `margin-all-${panelId}`, class: 'form-range az-pop-range', min: field.min ?? 0, max: field.max ?? 200, step: 1,
            aria: { label: 'All four sides' } });
        const allBox = num('all-input', 'All four sides', 'margin-all-box');
        const side = { t: num('top', 'Top', 'margin-input'), b: num('bottom', 'Bottom', 'margin-input'), l: num('left', 'Left', 'margin-input'), r: num('right', 'Right', 'margin-input') };
        const link = el('input', { type: 'checkbox', id: `margins-unlink-${panelId}`, class: 'form-check-input', data: { option: `${field.id}Unlinked` } });
        const sidesRow = el('div', { class: 'az-pop-margin-sides', id: `margin-sides-${panelId}` },
            [['t', 'Top (px)'], ['b', 'Bottom (px)'], ['l', 'Left (px)'], ['r', 'Right (px)']].map(([k, label]) =>
                el('div', { class: 'az-pop-field' }, el('label', { class: 'az-pop-field__label', for: side[k].id, text: label }),
                    el('span', { class: 'az-pop-field__control' }, side[k]))));
        const write = (sides, unlinked) => {
            const now = config();
            const next = writeMargins(now, field, { sides, unlinked }, kind);
            if (field.look !== false && now.styleDefault === true) delete next.styleDefault;
            if (JSON.stringify(next) === JSON.stringify(now)) { paint(); return; }
            ctx.commit(next, 'margins');
        };
        const linked = (v) => {
            if (!Number.isFinite(v)) { paint(); return; }
            const n = Math.max(field.min ?? 0, Math.min(field.max ?? 200, Math.round(v)));
            write({ ...readMargins(config(), field, kind).sides, t: n, r: n, b: n, l: n }, false);
        };
        all.addEventListener('change', () => linked(Number(all.value)));
        all.addEventListener('input', () => { allBox.value = all.value; });
        allBox.addEventListener('change', () => linked(Number(allBox.value)));
        allBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); linked(Number(allBox.value)); } });
        for (const [k, box] of Object.entries(side)) {
            const commitSide = () => {
                const v = Number(box.value);
                if (box.value.trim() === '' || !Number.isFinite(v)) { paint(); return; }
                write({ ...readMargins(config(), field, kind).sides, [k]: v }, true);
            };
            box.addEventListener('change', commitSide);
            box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitSide(); } });
        }
        link.addEventListener('change', () => {
            const cur = readMargins(config(), field, kind).sides;
            // one value again: the top one
            write(link.checked ? cur : { ...cur, t: cur.t, r: cur.t, b: cur.t, l: cur.t }, link.checked);
        });
        const wrap = el('div', { class: 'az-pop-margins' },
            el('div', { class: 'az-pop-field' }, el('label', { class: 'az-pop-field__label', for: allBox.id, text: 'All sides (px)' }),
                el('span', { class: 'az-pop-field__control' }, all, allBox)),
            el('div', { class: 'az-pop-field az-pop-field--check' }, el('label', { class: 'az-pop-check', for: link.id }, link, ' Set each side separately')),
            sidesRow);
        controls.set(field.id, { field, input: all, wrap, auto: null, margins: { all, allBox, side, link, sidesRow } });
        return wrap;
    }

    function fieldControl(field) {
        const id = field.domId ? `${field.domId}-${panelId}` : `po-${panelId}-${field.id}`;
        const help = helpOf(field, kind);
        const helpEl = help || field.disabled ? el('small', { class: 'az-pop-help', text: help }) : null;
        if (field.element) {
            const node = field.element();
            const wrapEl = el('div', { class: 'az-pop-field az-pop-field--element' }, node);
            controls.set(field.id, { field, input: null, wrap: wrapEl, auto: null });
            return wrapEl;
        }
        if (field.type === 'margins') return marginsControl(field);
        let input;
        let wrap;
        let auto = null;
        if (field.type === 'check') {
            input = el('input', { type: 'checkbox', id, class: 'form-check-input', data: { option: field.id }, on: { change: () => set(field, input.checked) } });
            wrap = el('div', { class: 'az-pop-field az-pop-field--check' }, el('label', { class: 'az-pop-check', for: id }, input, ` ${field.label}`), helpEl);
        } else {
            if (field.type === 'select') {
                // a choice whose value is null is Auto: it writes absent (its option's value is '')
                input = el('select', { id, class: 'form-select form-select-sm', data: { option: field.id },
                    on: { change: () => set(field, input.value === '' && field.choices.some(([v]) => v === null) ? null : input.value) } },
                    field.choices.map(([v, t]) => el('option', { value: v === null ? '' : v, text: t })));
            } else if (field.type === 'color') {
                input = el('input', { type: 'color', id, class: 'form-control form-control-sm form-control-color', data: { option: field.id },
                    on: { change: () => set(field, input.value) } });
                if (defaultOf(field, kind) === null) {
                    auto = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary az-pop-auto', data: { auto: field.id },
                        title: 'Follow the app theme', aria: { pressed: 'false' }, on: { click: () => set(field, null) } }, 'Auto');
                }
            } else if (field.type === 'range') {
                // a slider and a number box that say the same value; either commits one step (Cell Plot's sliders too, WP-5b)
                // percent: the slider and the box show 100 times the stored fraction
                const pc = field.percent === true;
                const scale = (v) => (v === undefined || v === null ? v : pc ? v * 100 : v);
                const unscale = (v) => (v === null ? v : pc ? fromPercent(v) : v);
                const box = el('input', { type: 'number', id, class: 'form-control form-control-sm az-pop-num', data: { option: `${field.id}Number` },
                    min: scale(field.min), max: scale(field.max), step: scale(field.step) ?? 'any', aria: { label: field.label } });
                input = el('input', { type: 'range', class: 'form-range az-pop-range', data: { option: field.id }, min: scale(field.min), max: scale(field.max),
                    step: scale(field.step) ?? 'any', aria: { label: field.label },
                    on: { input: () => { box.value = input.value; }, change: () => set(field, unscale(Number(input.value))) } });
                const commitBox = () => {
                    const raw = box.value.trim();
                    const v = raw === '' ? null : Number(raw);
                    if (v !== null && !Number.isFinite(v)) { paint(); return; }
                    set(field, unscale(v));
                };
                box.addEventListener('change', commitBox);
                box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitBox(); } });
                auto = box;          // painted with the slider
            } else {
                const number = field.type === 'number';
                input = el('input', { type: number ? 'number' : 'text', id, class: `form-control form-control-sm ${number ? 'az-pop-num' : 'az-pop-text'}`,
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
            wrap = el('div', { class: `az-pop-field az-pop-field--${field.type}` },
                el('label', { class: 'az-pop-field__label', for: id, text: field.label }),
                el('span', { class: 'az-pop-field__control' }, input, auto), helpEl);
        }
        controls.set(field.id, { field, input, wrap, auto });
        return wrap;
    }

    // ---------------------------------------------------------------- Export and Apply
    // with a memory guard (the Cell Plot and Gene Plot) the buttons keep the ids their tests and the drift harness read
    const imageBtns = IMAGE_FORMATS.map((format) => el('button', { type: 'button', class: `btn btn-sm btn-outline-secondary az-pop-export-btn ${classes.exportBtn || ''}`,
        id: ctx.exportGuard ? `download-${format}-${panelId}` : null, data: { format, how: 'full' }, on: { click: () => exportAs(format) } }, format.toUpperCase()));
    const guardNote = el('div', { class: 'az-pop-help export-memory-note', role: 'note', hidden: true });
    const shownBtns = IMAGE_FORMATS.filter((f) => f === 'png' || f === 'svg').map((format) => el('button', { type: 'button',
        class: 'btn btn-sm btn-outline-secondary az-pop-export-btn', id: `download-shown-${format}-${panelId}`, data: { format, how: 'shown' },
        title: 'The plot as it is on screen; needs only its pixels', on: { click: () => exportAs(format, 'shown') } }, format.toUpperCase()));
    const shownLabel = el('span', { class: 'az-pop-help' });
    const shownRow = el('div', { class: 'az-pop-buttons export-shown-row', hidden: true }, shownLabel, shownBtns);
    // Copy: the plot as a PNG on the clipboard, at Export's size (plot-aesthetics-menu.js copyPlotToClipboard, passed in)
    const copyBtn = ctx.copyImage ? el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary az-pop-copy-btn',
        on: { click: () => ctx.copyImage(exportSettings(resolveStyle(config(), kind), ctx.plotSize ? ctx.plotSize() : {})) } }, 'Copy') : null;
    const csvBtn = ctx.csv ? el('button', { type: 'button', class: `btn btn-sm btn-outline-secondary az-pop-csv-btn ${classes.csv || ''}`, on: { click: () => ctx.csv() } }, 'Download CSV') : null;

    function exportAs(format, how = 'full') {
        if (!ctx.exportImage) return;
        const style = resolveStyle(config(), kind);
        ctx.exportImage(format, exportSettings(style, ctx.plotSize ? ctx.plotSize() : {}), how);
    }

    const others = () => {
        if (ctx.others) return { length: ctx.others.count() };
        const pm = typeof window !== 'undefined' ? window.PanelManager : null;
        if (!pm || typeof pm.getActivePanels !== 'function') return [];
        return pm.getActivePanels().filter((p) => p && p.getType && p.getType() === kind && p.getId() !== panelId);
    };
    const name = KIND_NAMES[kind] || kind;
    const applyBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary az-pop-apply-others' }, `Apply to other ${name} plots`);
    const askText = el('span', { class: 'az-pop-help' });
    const askYes = el('button', { type: 'button', class: 'btn btn-sm btn-primary az-pop-apply-yes' }, 'Apply');
    const askNo = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary az-pop-apply-no' }, 'Cancel');
    const ask = el('div', { class: 'az-pop-ask', hidden: true }, askText, el('span', { class: 'az-pop-ask__buttons' }, askYes, askNo));
    const applyDone = el('div', { class: 'az-pop-help az-pop-apply-done', role: 'status', aria: { live: 'polite' } });
    const sessionState = el('div', { class: 'az-pop-help az-pop-session-state' });
    const sessionSet = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary az-pop-session-set' }, 'Make this the session default');
    const sessionReset = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary az-pop-session-reset' }, 'Back to built-in');
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
        const n = ctx.others ? ctx.others.run() : applyToOthers();
        applyDone.textContent = `Applied to ${n} plot${n === 1 ? '' : 's'}.`;
        applyBtn.focus();
    });
    sessionSet.addEventListener('click', () => {
        if (ctx.session) { ctx.session.set(); paint(); return; }
        const now = config();
        setSessionStyle(kind, now);
        // its look is the default now: it follows it from here
        if (now.styleDefault !== true) ctx.replace({ ...now, styleDefault: true });
        paint();
    });
    sessionReset.addEventListener('click', () => { if (ctx.session) ctx.session.clear(); else clearSessionStyle(kind); paint(); });

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
    const root = el('div', { class: `az-pop-options az-pop-options--${kind}`, data: { kind } });
    // An empty number box shows its default (a placeholder); its arrows step from that, not from the minimum (`stepFrom`)
    const stepFrom = (t) => t && t.matches && t.matches('input[type="number"][data-step-from]') && t.value === '';
    let primed = null;
    root.addEventListener('keydown', (e) => {
        if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !stepFrom(e.target)) return;
        const t = e.target;
        e.preventDefault();
        t.value = t.dataset.stepFrom;
        if (e.key === 'ArrowUp') t.stepUp(); else t.stepDown();
        t.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // the same with the mouse: a press on the arrows puts the default in first, and a press that steps nothing takes it out again
    root.addEventListener('pointerdown', (e) => {
        if (!stepFrom(e.target) || e.clientX < e.target.getBoundingClientRect().right - 24) return;
        e.target.value = e.target.dataset.stepFrom;
        primed = e.target;
    }, true);
    root.addEventListener('input', (e) => { if (e.target === primed) primed = null; }, true);
    root.addEventListener('pointerup', () => setTimeout(() => {
        const t = primed;
        primed = null;
        if (t && t.value === t.dataset.stepFrom) t.value = '';
    }, 0), true);
    for (const sec of sectionsOf(kind)) {
        const own = sec.panel ? panelSections[sec.id] : null;
        if (sec.panel && !own) continue;
        const title = sec.panel ? own.title : sec.title;
        const key = `${kind}:${sec.id}`;
        const open = _open.has(key) ? _open.get(key) : (sec.panel || OPEN_FIRST.has(sec.id));
        const details = el('details', { class: `az-pop-section${sec.id === 'export' && classes.export ? ` ${classes.export}` : ''}`, data: { section: sec.id }, open },
            el('summary', { class: 'az-pop-section__title', text: title }));
        details.addEventListener('toggle', () => _open.set(key, details.open));
        const body = el('div', { class: 'az-pop-section__body' });
        if (own && own.element) body.append(own.element);
        for (const f of sec.fields) body.append(fieldControl(f));
        if (sec.id === 'export') {
            body.prepend(el('div', { class: 'az-pop-buttons az-pop-export-formats' }, imageBtns, copyBtn), guardNote, shownRow);
            if (csvBtn) body.append(el('div', { class: 'az-pop-buttons' }, csvBtn));
        }
        if (sec.id === 'presets') {
            body.append(el('div', { class: 'az-pop-buttons az-pop-presets' }, PRESETS.map((p) => el('button', { type: 'button',
                class: 'btn btn-sm btn-outline-secondary az-pop-preset', data: { preset: p }, on: { click: () => preset(p) } }, PRESET_LABELS[p]))));
        }
        if (sec.id === 'apply') {
            body.append(el('div', { class: 'az-pop-buttons' }, applyBtn), ask, applyDone,
                sessionState, el('div', { class: 'az-pop-buttons' }, sessionSet, sessionReset));
        }
        if (!sec.panel && sec.fields.length) {
            const reset = el('button', { type: 'button', class: 'btn btn-sm btn-link az-pop-reset', data: { reset: sec.id },
                on: { click: () => resetSection(sec) } }, 'Reset');
            body.append(el('div', { class: 'az-pop-section__foot' }, reset));
        }
        details.append(body);
        sectionEls.set(sec.id, details);
        root.append(details);
    }

    /**
     * A preset is one undoable step. Publication and Bare give the plot a look of its own; Default puts it back on the
     * session default (the built-in look when none is set), as Cell Plot's Default does.
     */
    function preset(name) {
        const now = config();
        const own = kindPresets();
        const next = own ? applyPreset(now, name, kind) : name === 'default' ? followLook(now, kind) : applyPreset(now, name, kind);
        if (!own && name !== 'default') delete next.styleDefault;
        if (JSON.stringify(next) === JSON.stringify(now)) return;
        ctx.commit(next, `${PRESET_LABELS[name].toLowerCase()} preset`);
    }

    /** Whether the kind has presets of its own (they decide everything, Default and the session default included). */
    const kindPresets = () => hasOwnPresets(kind);

    function resetSection(sec) {
        const now = config();
        let next = now;
        for (const f of resettable(sec.fields)) next = f.type === 'margins' ? writeMargins(next, f, { sides: defaultOf(f, kind), unlinked: false }, kind) : writeField(next, f, null, kind);
        if (sec.fields.some((f) => f.copy !== false && f.look !== false) && now.styleDefault === true) delete next.styleDefault;
        if (JSON.stringify(next) === JSON.stringify(now)) return;
        ctx.commit(next, `reset ${sec.title.toLowerCase()}`);
    }

    // ---------------------------------------------------------------- paint
    function paint() {
        const c = config();
        const env = { panelId, kind };
        for (const { field, input, wrap, auto, margins } of controls.values()) {
            const hide = typeof field.when === 'function' ? !field.when(c) : false;
            wrap.hidden = hide;
            if (field.element) continue;
            const off = disabledOf(field, c, env);
            if (margins) { paintMargins(field, c, margins, off); continue; }
            const v = readField(c, field, kind);
            const shown = shownOf(field, c, env);
            input.disabled = !!off;
            if (auto && auto !== input && auto.tagName === 'BUTTON') auto.disabled = !!off;
            const helpEl = wrap.querySelector('.az-pop-help');
            if (helpEl && field.disabled) {
                helpEl.textContent = off || helpOf(field, kind);
                if (off) input.title = off; else input.removeAttribute('title');
            }
            if (field.type === 'check') input.checked = v === null && shown !== undefined ? !!shown : !!v;
            else if (field.type === 'range') {
                const shownV = v === null || v === undefined ? v : field.percent ? toPercent(v) : v;
                if (document.activeElement !== input) input.value = String(shownV);
                if (document.activeElement !== auto) auto.value = String(shownV);
                auto.disabled = !!off;
            }
            else if (field.type === 'color') {
                const isAuto = v === null;
                input.value = sixDigits(isAuto && shown ? shown : (v ?? '#000000'));
                if (auto) {
                    auto.setAttribute('aria-pressed', String(isAuto));
                    auto.classList.toggle('active', isAuto);
                }
                input.classList.toggle('az-pop-color--auto', isAuto);
            } else if (field.type === 'select') input.value = v === null || v === undefined ? '' : String(v);
            else if (document.activeElement !== input) input.value = v === null || v === undefined ? '' : String(v);
            if (field.type === 'number') {
                const ph = placeholderOf(field, c, env) ?? (defaultOf(field, kind) !== null ? defaultOf(field, kind) : null);
                if (ph !== null) input.placeholder = String(ph); else input.removeAttribute('placeholder');
                const from = typeof field.stepFrom === 'number' ? field.stepFrom : field.stepFrom ? ph : null;
                if (from !== null) input.dataset.stepFrom = String(from); else delete input.dataset.stepFrom;
            }
        }
        for (const [id, details] of sectionEls) {
            const sec = sectionsOf(kind).find((s) => s.id === id);
            if (!sec) continue;
            const own = sec.panel ? panelSections[id] : null;
            const fields = sec.fields;
            const anyShown = (own && own.element) || fields.some((f) => !controls.get(f.id).wrap.hidden) || id === 'export' || id === 'apply' || id === 'presets';
            details.hidden = !anyShown || (own && typeof own.when === 'function' && !own.when(c));
            if (own && typeof own.paint === 'function') own.paint();
            const reset = details.querySelector('.az-pop-reset');
            if (reset) reset.disabled = !resettable(fields).some((f) => isSet(c, f, kind));
        }
        const can = ctx.canExport ? ctx.canExport() : true;
        const guard = ctx.exportGuard ? ctx.exportGuard() : null;
        for (const b of imageBtns) {
            const off = guard && guard.blocked ? guard.why : (ctx.exportOff ? ctx.exportOff(b.dataset.format) : '');
            b.disabled = !can || !!off;
            b.setAttribute('aria-disabled', String(b.disabled));
            if (off) b.title = off; else b.removeAttribute('title');
        }
        guardNote.hidden = !(guard && guard.note);
        guardNote.textContent = guard && guard.note ? guard.note : '';
        guardNote.classList.toggle('text-danger', !!(guard && guard.blocked));
        const showShown = !!(guard && guard.shown && guard.shown.length);
        shownRow.hidden = !showShown;
        if (showShown) {
            shownLabel.textContent = `As shown (${guard.size}):`;
            for (const b of shownBtns) b.hidden = !guard.shown.includes(b.dataset.format);
        }
        if (csvBtn) csvBtn.disabled = !can;
        if (copyBtn) copyBtn.disabled = !can;
        const onDefault = ctx.session ? ctx.session.onDefault() : c.styleDefault === true;
        const hasSession = ctx.session ? ctx.session.has() : hasSessionStyle(kind);
        sessionState.textContent = onDefault ? (hasSession ? 'On Default: this plot follows the session default.' : 'On Default (built-in).') : 'Own style.';
        sessionReset.hidden = !hasSession;
    }

    function paintMargins(field, c, m, off) {
        const { sides, unlinked } = readMargins(c, field, kind);
        const set = (el2, v) => { if (document.activeElement !== el2) el2.value = String(v); };
        set(m.all, sides.t);
        set(m.allBox, sides.t);
        for (const k of ['t', 'r', 'b', 'l']) set(m.side[k], sides[k]);
        m.all.disabled = unlinked || !!off;
        m.allBox.disabled = unlinked || !!off;
        m.link.checked = unlinked;
        m.sidesRow.hidden = !unlinked;
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
    // the modebar camera (plot-aesthetics-menu.js registerCameraExport) exports at Export's size and scale too
    const gd = ctx.plot ? ctx.plot() : null;
    if (gd) gd.__exportOptions = () => exportOptions(exportSettings(resolveStyle(config(), kind), ctx.plotSize ? ctx.plotSize() : {}));
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
