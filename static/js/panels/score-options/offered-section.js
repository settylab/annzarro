/**
 * The "offered" section of a panel whose consumers pick from a method table: which methods and which layers it offers,
 * what each costs a consumer who reads it, and how each pairing is graded. The Gene Signature's "Scores offered" and the
 * Cell Grouping's "Statistics offered" are this one section over two method tables (utils/options-model.js).
 *
 * Collapsed, one row states what is offered ("z-score mean, mean, sum · X"). Open, methods first, then layers:
 *
 *   [x] Z-score mean   Each gene scaled to mean 0 and SD 1, then averaged.        2 plots, 1 table
 *         (the provider's parameter block)
 *   [x] Mean           Average of the genes' values.
 *         warning: On raw_counts this follows sequencing depth.
 *   Layers  [x] X  scaled   [ ] logged_counts  log-normalised
 *
 * What the provider adds goes through `hooks`; everything else (the rows, the layers, undo of a switched-off option in
 * use, reset, the kind of each layer, the one-line warning for the default layer) is here. Nothing here computes; the
 * page applies an edit to plots and tables by the rules for recipe edits. A repaint happens only when something the rows
 * show changed, so a store event that changes nothing visible touches no node.
 *
 * `makeDom(document)` and the callbacks are injected, so the section touches no page state of its own.
 */
import { kindWord, useText } from '../../utils/options-model.js';

/** Layers listed before "Show more": the offered ones and this many others. */
const LAYERS_SHOWN = 5;

/**
 * @param {Object} options
 * @param {{el: Function, clear: Function}} options.D - the DOM builder (panels/gene-set-utilities/dom.js)
 * @param {string} options.id - the panel's id, for unique element ids
 * @param {Object} options.model - from createOptionsModel
 * @param {string} options.title - the section's name ("Scores offered")
 * @param {Object} options.text - { where, layers, lastLayer, lastMethod }: the section's help sentences
 * @param {string} [options.cls] - the class prefix; element ids are `${cls}-<name>-${id}` (default `gsig-scoring`)
 * @param {() => Object} options.getRecipe - the source's option fields now
 * @param {(patch: Object) => void} options.apply - make `patch` (keys of a recipe) part of the recipe
 * @param {() => Promise<string[]>} options.getInputs - the matrices a score can read, default layer first
 * @param {(input: string, opts?: Object) => Promise<(Object|null)>} options.getKind - what a layer looks like (matrix-kind-client.js)
 * @param {() => Array<{value: string, plots: number, tables: number}>} [options.getInUse] - options plots and tables use
 * @param {() => Array<{value: (string|null), plots: number, tables: number}>} [options.getLayersInUse] - layers they use
 * @param {() => void} [options.onKinds] - what a layer looks like became known: menus may change
 * @param {Object} [options.hooks] - what the provider adds, all optional:
 *   bodyBlocks      nodes placed after the notice line, before the methods
 *   makeParams(api) called once per repaint of the rows, before them: make the parameter boxes (`api` has numberBox, field, sid)
 *   paramBlock(method, recipe) the parameters of an offered method, or null
 *   resetMethod(method) restore a method's parameters
 *   definition(recipe, info) -> { text, signed } replaces a method's definition
 *   methodExtras(recipe, info) -> nodes appended to an offered method's row before its parameters
 *   paintExtras(recipe) / paintParams(recipe) repaint the provider's blocks and boxes with the rows
 *   resetPatch() -> the parameter fields a reset restores; paramsAreDefault(recipe) -> boolean
 */
export function createOfferedSection({ D, id, model, title, text, cls = 'gsig-scoring', getRecipe, apply, getInputs, getKind,
    getInUse = () => [], getLayersInUse = () => [], onKinds = () => {}, hooks = {} }) {
    const { el } = D;
    const sid = (x) => `${cls}-${x}-${id}`;
    const { offeredMethods, offeredLayers } = model;
    const DEFAULT_INPUT = model.defaultLayer;
    let open = false;
    let showAllLayers = false;
    let inputs = [DEFAULT_INPUT];
    let destroyed = false;
    let notice = null;                  // {text, undo: patch} after an option in use was switched off
    let confirmReset = null;            // the sentence asking before a reset removes options in use
    const suggestions = new Map();      // layer -> a layer that looks log-normalised, offered instead of this one
    const kinds = new Map();            // layer -> what it looks like
    const stats = new Map();            // layer -> what the server sampled of it (the share above a threshold follows from it)
    const asked = new Map();            // layer -> token of the question in flight

    const toggle = el('button', { type: 'button', class: `${cls}__toggle`, id: sid('toggle'),
        aria: { expanded: 'false', controls: sid('body') }, on: { click: () => { open = !open; if (open) askAllKinds(); paint(); } } });
    const caret = el('span', { class: `${cls}__caret`, aria: { hidden: 'true' } }, '▸');
    const label = el('span', { class: `${cls}__label`, text: title });
    const summary = el('span', { class: `${cls}__summary`, id: sid('summary') });
    toggle.append(caret, ' ', label, ' ', summary);

    const where = el('div', { class: `${cls}__help`, data: { aggregationsHelp: '' }, text: text.where });
    const noticeLine = el('div', { class: `${cls}__notice`, role: 'status', aria: { live: 'polite' }, hidden: true });
    const methodSet = el('fieldset', { class: `${cls}__set` }, el('legend', { class: `${cls}__heading`, text: 'Methods' }));
    const methodRows = el('div', { class: `${cls}__options` });
    methodSet.append(methodRows);
    const layerSet = el('fieldset', { class: `${cls}__set` }, el('legend', { class: `${cls}__heading`, text: 'Layers' }));
    const layerRows = el('div', { class: `${cls}__layers` });
    const moreLayers = el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link', hidden: true,
        on: { click: () => { showAllLayers = !showAllLayers; paint(); } } });
    layerSet.append(layerRows, moreLayers, el('div', { class: `${cls}__help`, text: text.layers }));
    const resetNote = el('div', { class: `${cls}__notice`, role: 'status', hidden: true });
    const reset = el('button', { type: 'button', class: `btn btn-sm btn-outline-secondary ${cls}__reset`,
        on: { click: () => resetAll(false) } }, 'Reset to defaults');
    const body = el('div', { class: `${cls}__body`, id: sid('body'), hidden: true },
        where, noticeLine, ...(hooks.bodyBlocks || []), methodSet, layerSet, resetNote, el('div', { class: `${cls}__actions` }, reset));
    // the warning for the first offered layer, in the status zone: seen with the section collapsed
    const warningLine = el('div', { class: 'gsig-inputwarn', role: 'status', hidden: true, data: { inputWarning: 'status' } });
    const element = el('section', { class: cls, aria: { label: title } }, toggle, body);
    const doc = () => element.ownerDocument;

    // ------------------------------------------------------------ numbers

    /** A number box: checked as typed, applied on Enter or on leaving it, the last valid value put back otherwise. */
    function numberBox({ key, name, parse, read, write, width }) {
        const input = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
            class: `form-control form-control-sm ${cls}__number`, id: sid(key), data: { param: key },
            aria: { label: name, describedby: sid(`${key}-error`) } });
        if (width) input.style.width = width;
        const error = el('div', { class: `${cls}__error`, id: sid(`${key}-error`), role: 'alert', hidden: true });
        const show = (message) => { error.hidden = !message; error.textContent = message || ''; input.classList.toggle('is-invalid', !!message);
            input.setAttribute('aria-invalid', String(!!message)); };
        input.addEventListener('input', () => { const p = parse(input.value); show(p.ok ? '' : p.error); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = String(read(getRecipe())); show(''); } });
        input.addEventListener('change', () => {
            const p = parse(input.value);
            if (!p.ok) {
                input.value = String(read(getRecipe()));              // the last valid value comes back
                show(p.error);
                return;
            }
            show('');
            if (read(getRecipe()) !== p.value) apply(write(p.value));
            paint(true);
        });
        return { input, error, show, read };
    }

    const field = (label_, control, forId) => el('span', { class: `${cls}__field` }, el('label', { for: forId, text: label_ }), control);
    const api = { sid, numberBox, field, paint: (force) => paint(force) };

    // ------------------------------------------------------------ edits

    const usesOf = (list, value) => {
        const u = list.find(x => x.value === value);
        return u ? { plots: u.plots || 0, tables: u.tables || 0 } : { plots: 0, tables: 0 };
    };

    /** "1 plot keeps it and says so." / "2 plots, 1 table keep it and say so." */
    const keepsText = (used) => (/^1 [a-z]+$/.test(used) ? `${used} keeps it and says so.` : `${used} keep it and say so.`);

    function toggleMethod(method, on) {
        const recipe = getRecipe();
        const before = { offered: offeredMethods(recipe), method: recipe.method };
        const next = new Set(before.offered);
        if (on) next.add(method); else next.delete(method);
        const nextList = model.cleanOffered([...next], recipe.method);
        apply({ offered: nextList, ...(on || recipe.method !== method ? {} : { method: nextList[0] }) });
        const used = useText(usesOf(getInUse(), method));
        notice = !on && used ? { text: `${model.methodShort(method)} is no longer offered. ${keepsText(used)}`, undo: before } : null;
        paint();
    }

    /** Offer exactly these layers, in this order; the first is the one a new consumer starts on. */
    function applyLayers(list) {
        apply({ layers: list, input: list[0] });
    }

    function toggleLayer(layer, on) {
        const recipe = getRecipe();
        const before = { layers: offeredLayers(recipe), input: recipe.input };
        const next = new Set(before.layers);
        if (on) next.add(layer); else next.delete(layer);
        applyLayers([...next]);
        if (on) askKind(layer);
        const used = useText(usesOf(getLayersInUse(), layer));
        notice = !on && used ? { text: `${layer} is no longer offered. ${keepsText(used)}`, undo: before } : null;
        paint();
    }

    function resetAll(confirmed) {
        const recipe = getRecipe();
        const defaults = model.defaultFields();
        const keep = new Set(defaults.offered);
        const removed = offeredMethods(recipe).filter(m => !keep.has(m)).concat(
            offeredLayers(recipe).filter(l => l !== DEFAULT_INPUT));
        const inUse = getInUse().filter(u => removed.includes(u.value)).reduce((n, u) => n + u.plots + u.tables, 0)
            + getLayersInUse().filter(u => u.value && removed.includes(u.value)).reduce((n, u) => n + u.plots + u.tables, 0);
        if (inUse && !confirmed) {
            confirmReset = inUse === 1 ? '1 plot or table uses an option this removes.' : `${inUse} plots and tables use options this removes.`;
            paint();
            return;
        }
        confirmReset = null;
        notice = null;
        apply({ ...(hooks.resetPatch ? hooks.resetPatch() : {}), ...defaults, offered: [...defaults.offered], layers: [...defaults.layers] });
        paint();
    }

    const isDefault = (recipe) => model.isDefaultOffer(recipe) && (!hooks.paramsAreDefault || hooks.paramsAreDefault(recipe));

    // ------------------------------------------------------------ painting

    /** Who uses which method and layer, as text: what the rows were last drawn with. */
    const usageNow = () => JSON.stringify([getInUse(), getLayersInUse()]);
    let usageShown = '';

    function paintMethods(recipe) {
        usageShown = usageNow();
        if (hooks.makeParams) hooks.makeParams(api);
        D.clear(methodRows);
        const offered = new Set(offeredMethods(recipe));
        const layers = offeredLayers(recipe);
        const used = getInUse();
        const known = { kinds: Object.fromEntries(kinds), stats: Object.fromEntries(stats) };
        for (const info of model.methods) {
            const on = offered.has(info.value);
            const last = on && offered.size === 1;
            const box = el('input', { type: 'checkbox', class: `${cls}__offer`, id: sid(`offer-${info.value}`), checked: on,
                data: { offerMethod: info.value }, disabled: last, title: last ? text.lastMethod : '',
                on: { change: () => toggleMethod(info.value, box.checked) } });
            const use = useText(usesOf(used, info.value));
            const head = el('div', { class: `${cls}__optionhead` }, box,
                el('label', { for: sid(`offer-${info.value}`), class: `${cls}__optionname`, text: info.label }),
                use ? el('span', { class: `${cls}__use`, data: { inUse: info.value }, text: use }) : null);
            const def = hooks.definition ? hooks.definition(recipe, info) : null;
            const signedText = def && def.signed ? def.text : '';
            const row = el('div', { class: `${cls}__option${on ? '' : ' is-off'}`, data: { method: info.value } },
                head, el('div', { class: `${cls}__definition`, data: signedText ? { signed: '' } : {}, text: signedText || (def && def.text) || info.definition }));
            if (on && hooks.methodExtras) for (const node of hooks.methodExtras(recipe, info)) row.append(node);
            const block = on && hooks.paramBlock ? hooks.paramBlock(info.value, recipe) : null;
            if (block) {
                if (!model.isMethodDefault(recipe, info.value)) {
                    block.append(el('button', { type: 'button', class: `btn btn-link btn-sm gsig-link ${cls}__resetmethod`,
                        data: { resetMethod: info.value }, on: { click: () => { if (hooks.resetMethod) hooks.resetMethod(info.value); } } }, 'Reset'));
                }
                row.append(block);
            }
            if (on) {
                // only what holds whatever the layer: a property of some layers is said on their rows
                for (const line of model.methodLines(info.value, layers, recipe, known.kinds, known.stats)) {
                    row.append(el('div', { class: `${cls}__grade ${cls}__grade--${line.grade}`, role: 'status',
                        data: { grade: line.grade } }, el('span', { 'aria-hidden': 'true', text: '⚠ ' }), line.text));
                }
            }
            methodRows.append(row);
        }
    }

    function paintLayers(recipe) {
        D.clear(layerRows);
        const layers = new Set(offeredLayers(recipe));
        const names = [...new Set([...inputs, ...layers])];
        // the offered layers and the first few others; the rest behind "Show more"
        const shown = [];
        let others = 0;
        for (const name of names) {
            if (layers.has(name) || showAllLayers || others < LAYERS_SHOWN) { shown.push(name); if (!layers.has(name)) others++; }
        }
        const hidden = names.length - shown.length;
        moreLayers.hidden = !hidden && !showAllLayers;
        moreLayers.textContent = showAllLayers ? 'Show fewer layers' : `Show ${hidden} more layer${hidden === 1 ? '' : 's'}`;
        const used = getLayersInUse();
        for (const name of shown) {
            const last = layers.has(name) && layers.size === 1;
            const known = inputs.includes(name);
            const box = el('input', { type: 'checkbox', class: `${cls}__offer`, id: sid(`layer-offer-${name}`),
                checked: layers.has(name), disabled: last, data: { layerOffer: name },
                title: last ? text.lastLayer : '', on: { change: () => toggleLayer(name, box.checked) } });
            const word = kindWord(kinds.get(name));
            const use = useText(usesOf(used.map(u => ({ ...u, value: u.value === null ? recipe.input : u.value })), name));
            // a layer says its properties once, short, and only while it is offered (they matter to what is offered)
            const lines = layers.has(name) ? model.layerLines(name, recipe, kinds.get(name), stats.get(name)) : [];
            const suggest = suggestions.get(name);
            layerRows.append(el('div', { class: `${cls}__layer`, data: { layer: name } },
                el('div', { class: `${cls}__optionhead` }, box,
                    el('label', { for: sid(`layer-offer-${name}`), class: `${cls}__optionname`, text: known ? name : `${name} (not in this dataset)` }),
                    word ? el('span', { class: `${cls}__kind`, data: { kind: kinds.get(name) }, text: word }) : null,
                    use ? el('span', { class: `${cls}__use`, text: use }) : null),
                ...lines.map(line => el('div', { class: `gsig-inputwarn gsig-inputwarn--${line.grade}`, role: 'status',
                    data: { inputWarning: 'layer', layer: name, code: line.code } },
                el('span', { 'aria-hidden': 'true', text: '⚠ ' }), line.text,
                suggest && ['depth', 'normalised'].includes(line.code) ? [' ', el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link',
                    data: { useInput: suggest }, on: { click: () => offerInstead(name, suggest) } }, `Offer ${suggest} instead`)] : null))));
        }
    }

    /**
     * The raw-count warning's button: offer `better` (a layer that looks log-normalised) in place of `raw`, unless a plot
     * or table reads `raw`, which then stays offered.
     */
    function offerInstead(raw, better) {
        const recipe = getRecipe();
        const layers = offeredLayers(recipe);
        const inUse = getLayersInUse().some(u => (u.value === null ? recipe.input : u.value) === raw && (u.plots || u.tables));
        let next;
        if (layers.includes(better)) next = inUse ? [...layers] : layers.filter(l => l !== raw);
        else if (inUse) next = [...layers, better];
        else next = layers.map(l => (l === raw ? better : l));            // in the raw layer's place, so it stays first if it was
        applyLayers(next.length ? next : [better]);
        askKind(better);
    }

    /** With the section closed: what a first layer that is raw or unlogged says, since it changes what the user would pick. */
    function paintWarning(recipe) {
        D.clear(warningLine);
        const line = model.layerLines(recipe.input, recipe, kinds.get(recipe.input), stats.get(recipe.input))
            .find(l => ['depth', 'normalised'].includes(l.code));
        warningLine.hidden = !line || open;
        if (!line) return;
        warningLine.dataset.kind = kinds.get(recipe.input) || '';
        warningLine.append(el('span', { text: line.text }));
        const suggest = suggestions.get(recipe.input);
        if (suggest) {
            warningLine.append(' ', el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link', data: { useInput: suggest },
                on: { click: () => offerInstead(recipe.input, suggest) } }, `Offer ${suggest} instead`));
        }
    }

    function paintNotice() {
        D.clear(noticeLine);
        noticeLine.hidden = !notice;
        if (notice) {
            noticeLine.append(notice.text, ' ', el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link', data: { undo: '' },
                on: { click: () => { const undo = notice.undo; notice = null; apply(undo); paint(); } } }, 'Undo'));
        }
        D.clear(resetNote);
        resetNote.hidden = !confirmReset;
        if (confirmReset) {
            resetNote.append(confirmReset, ' ',
                el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link', data: { resetAnyway: '' }, on: { click: () => resetAll(true) } }, 'Reset anyway'), ' ',
                el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link', on: { click: () => { confirmReset = null; paint(); } } }, 'Cancel'));
        }
    }

    function paint(force = false) {
        if (destroyed) return;
        const recipe = getRecipe();
        const full = model.offeredSummary(recipe);
        summary.textContent = full;
        summary.title = full;
        toggle.setAttribute('aria-label', `${title}: ${full}`);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.dataset.short = model.offeredSummaryShort(recipe);
        caret.textContent = open ? '▾' : '▸';
        body.hidden = !open;
        const typing = doc().activeElement && doc().activeElement.dataset && doc().activeElement.dataset.param
            && body.contains(doc().activeElement);
        if ((open || methodRows.childNodes.length === 0) && !(typing && !force)) {
            // the box being used keeps the focus across the repaint
            const keep = typing ? doc().activeElement.dataset.param : null;
            if (hooks.paintExtras) hooks.paintExtras(recipe);
            paintMethods(recipe);
            paintLayers(recipe);
            if (hooks.paintParams) hooks.paintParams(recipe, element);
            paintNotice();
            if (keep) { const again = element.querySelector(`[data-param="${keep}"]`); if (again) again.focus(); }
        }
        reset.disabled = isDefault(recipe);
        paintWarning(recipe);
    }

    // ------------------------------------------------------------ what the layers look like

    async function askKind(layer, { suggest = true } = {}) {
        const mine = (asked.get(layer) || 0) + 1;
        asked.set(layer, mine);
        let reply;
        try {
            reply = await getKind(layer, { suggest });
        } catch {
            reply = null;
        }
        if (destroyed || asked.get(layer) !== mine) return;
        const before = kinds.get(layer);
        if (reply && reply.kind) kinds.set(layer, reply.kind);
        if (reply && reply.stats) stats.set(layer, reply.stats);
        if (reply && reply.suggest && ['counts', 'normalised'].includes(reply.kind)) suggestions.set(layer, reply.suggest);
        else suggestions.delete(layer);
        paint();
        if (reply && reply.kind && before === undefined) onKinds();          // grades follow what is now known
    }

    /** What every listed layer looks like (one sample each, no look at the others): for the kind word and the grades. */
    function askAllKinds() {
        const offered = new Set(offeredLayers(getRecipe()));
        for (const name of inputs) if (!offered.has(name) && !kinds.has(name)) askKind(name, { suggest: false });
    }

    async function refreshInputs() {
        try {
            const list = await getInputs();
            if (destroyed) return;
            inputs = list && list.length ? list : [DEFAULT_INPUT];
        } catch {
            inputs = [DEFAULT_INPUT];
        }
        paint();
    }

    /** Ask what every offered layer looks like (answers are kept per dataset and layer). */
    function refreshKind() {
        const recipe = getRecipe();
        suggestions.clear();
        return Promise.all(offeredLayers(recipe).map(l => askKind(l)));
    }

    return {
        element,
        warning: warningLine,
        paint,
        /** The score's state changed (each progress frame says so): the rows are drawn again only when who uses what did. */
        paintUsage: () => { if (!destroyed && open && usageNow() !== usageShown) paint(); },
        refreshInputs,
        refreshKind,
        /** Open the section and put the cursor on it: where a consumer's "Offer other scores…" leads. */
        reveal() { if (destroyed) return; open = true; paint(); toggle.focus(); },
        getKinds: () => Object.fromEntries(kinds),
        getStats: () => Object.fromEntries(stats),
        destroy() { destroyed = true; },
        /** For tests. */
        state: () => ({ open, inputs: [...inputs], warnings: [...suggestions.keys()], kinds: Object.fromEntries(kinds) })
    };
}
