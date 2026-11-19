/**
 * The "Scores offered" section of the Gene Signature panel: what the signature offers plots and tables, and how each
 * option is computed. A plot or table only picks from what is offered; the model is utils/signature-options.js.
 *
 * Collapsed, one row states what is offered ("z-score mean, mean, sum · X"). Open, methods first, then layers:
 *
 *   [x] Z-score mean   Each gene scaled to mean 0 and SD 1, then averaged.        2 plots, 1 table
 *         Clip at ± [10]  One rare gene can otherwise dominate the average.   Reset
 *   [x] Mean           Average of the genes' values.
 *         warning: On raw_counts this follows sequencing depth.
 *   Layers  [x] X  scaled   [ ] logged_counts  log-normalised
 *
 * A method's parameters show only while it is offered. Every setting is part of the recipe (link, panel set, score
 * key). A number is checked on Enter or on leaving the box: an invalid one keeps the last valid value and says what is
 * expected. Nothing here computes; the page applies an edit to plots and tables by the rules for recipe edits.
 *
 * `makeDom(document)` and the callbacks are injected, so the section touches no page state of its own.
 */
import {
    BINS_RANGE, CONTROLS_RANGE, DEFAULT_BINS, DEFAULT_CLIP, DEFAULT_CONTROLS, DEFAULT_INPUT, DEFAULT_SEED, parseClipText,
    parseSeedText, parseThresholdText, parseWholeText
} from '../../utils/gene-signature.js';
import { directionFormula } from '../../utils/gene-signature.js';
import {
    DEFAULT_METHOD, DEFAULT_OFFERED, METHOD_INFO, canScoreDown, PARAM_DEFAULTS, cleanLayers, cleanOffered, gradeOption, isMethodDefault, kindWord,
    methodShort, offeredSummary, offeredSummaryShort, useText
} from '../../utils/signature-options.js';

/** The help texts, so the page and its tests say the same thing. */
export const SCORING_HELP = Object.freeze({
    where: 'Plots and tables pick from these. Nothing is computed until a plot or table shows it.',
    clip: 'One rare gene can otherwise dominate the average.',
    clipOff: 'Not clipped: one rare gene can dominate the average.',
    detectAbove: 'A gene counts as detected in a cell when its value is above this.',
    seed: 'The same seed gives the same control genes, so the same score.',
    layers: 'Plots and tables choose among the offered layers.',
    lastLayer: 'At least one layer stays offered.',
    lastMethod: 'At least one option stays offered.',
    directions: 'Score = average of up genes minus average of down genes.'
});

/** Layers listed before "Show more": the offered ones and this many others. */
const LAYERS_SHOWN = 5;

/**
 * @param {Object} options
 * @param {{el: Function, clear: Function}} options.D - the DOM builder (panels/gene-set-utilities/dom.js)
 * @param {string} options.id - the panel's id, for unique element ids
 * @param {() => Object} options.getRecipe - the signature's recipe now
 * @param {(patch: Object) => void} options.apply - make `patch` (keys of a recipe) part of the recipe
 * @param {() => Promise<string[]>} options.getInputs - the matrices a score can read, X first
 * @param {(input: string, opts?: Object) => Promise<(Object|null)>} options.getKind - what a layer looks like (matrix-kind-client.js)
 * @param {() => Array<{value: string, plots: number, tables: number}>} [options.getInUse] - options plots and tables use
 * @param {() => Array<{value: (string|null), plots: number, tables: number}>} [options.getLayersInUse] - layers they use
 * @param {(reply: Object) => (Object|null)} options.warningFor - the warning for one kind reply
 * @param {() => void} [options.onKinds] - what a layer looks like became known: menus may change
 * @param {{countAsUp: () => void}|null} [options.directions] - the source can score genes as down (a signature can, a gene
 *   table cannot): the section then has the switch "Score some genes as down" and the formula. `countAsUp` moves every
 *   down gene to up as one undoable step, for the switch turned off while down genes exist.
 */
export function createScoringSection({ D, id, getRecipe, apply, getInputs, getKind, getInUse = () => [],
    getLayersInUse = () => [], warningFor, onKinds = () => {}, directions = null }) {
    const { el } = D;
    const sid = (x) => `gsig-scoring-${x}-${id}`;
    let open = false;
    let showAllLayers = false;
    let inputs = [DEFAULT_INPUT];
    let lastClip = DEFAULT_CLIP;
    let destroyed = false;
    let notice = null;                  // {text, undo: patch} after an option in use was switched off
    let confirmReset = null;            // the sentence asking before a reset removes options in use
    const warnings = new Map();         // layer -> {kind, text, suggest}
    const kinds = new Map();            // layer -> what it looks like
    const asked = new Map();            // layer -> token of the question in flight

    const toggle = el('button', { type: 'button', class: 'gsig-scoring__toggle', id: sid('toggle'),
        aria: { expanded: 'false', controls: sid('body') }, on: { click: () => { open = !open; if (open) askAllKinds(); paint(); } } });
    const caret = el('span', { class: 'gsig-scoring__caret', aria: { hidden: 'true' } }, '▸');
    const label = el('span', { class: 'gsig-scoring__label', text: 'Scores offered' });
    const summary = el('span', { class: 'gsig-scoring__summary', id: sid('summary') });
    toggle.append(caret, ' ', label, ' ', summary);

    const where = el('div', { class: 'gsig-scoring__help', data: { aggregationsHelp: '' }, text: SCORING_HELP.where });
    const noticeLine = el('div', { class: 'gsig-scoring__notice', role: 'status', aria: { live: 'polite' }, hidden: true });
    const methodSet = el('fieldset', { class: 'gsig-scoring__set' }, el('legend', { class: 'gsig-scoring__heading', text: 'Methods' }));
    const methodRows = el('div', { class: 'gsig-scoring__options' });
    methodSet.append(methodRows);
    const layerSet = el('fieldset', { class: 'gsig-scoring__set' }, el('legend', { class: 'gsig-scoring__heading', text: 'Layers' }));
    const layerRows = el('div', { class: 'gsig-scoring__layers' });
    const moreLayers = el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link', hidden: true,
        on: { click: () => { showAllLayers = !showAllLayers; paint(); } } });
    layerSet.append(layerRows, moreLayers, el('div', { class: 'gsig-scoring__help', text: SCORING_HELP.layers }));
    // Score some genes as down: only for a source that can have down genes. Off by default, so nothing about direction shows.
    let askOff = false;                 // turned off while down genes exist: the question is in place
    const dirBox = directions ? el('input', { type: 'checkbox', class: 'gsig-scoring__offer', id: sid('directions'),
        data: { directions: '' }, on: { change: () => onDirectionSwitch(dirBox.checked) } }) : null;
    const dirFormula = directions ? el('div', { class: 'gsig-scoring__help', data: { directionFormula: '' } }) : null;
    const dirAsk = directions ? el('div', { class: 'gsig-scoring__notice', role: 'status', hidden: true, data: { directionAsk: '' } }) : null;
    const dirBlock = directions ? el('div', { class: 'gsig-scoring__direction', data: { directionBlock: '' } },
        el('div', { class: 'gsig-scoring__optionhead' }, dirBox,
            el('label', { for: sid('directions'), class: 'gsig-scoring__optionname', text: 'Score some genes as down' })),
        el('div', { class: 'gsig-scoring__help', text: SCORING_HELP.directions }), dirFormula, dirAsk) : null;
    const resetNote = el('div', { class: 'gsig-scoring__notice', role: 'status', hidden: true });
    const reset = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary gsig-scoring__reset',
        on: { click: () => resetAll(false) } }, 'Reset to defaults');
    const body = el('div', { class: 'gsig-scoring__body', id: sid('body'), hidden: true },
        where, noticeLine, ...(dirBlock ? [dirBlock] : []), methodSet, layerSet, resetNote, el('div', { class: 'gsig-scoring__actions' }, reset));
    // the warning for the first offered layer, in the status zone: seen with the section collapsed
    const warningLine = el('div', { class: 'gsig-inputwarn', role: 'status', hidden: true, data: { inputWarning: 'status' } });
    const element = el('section', { class: 'gsig-scoring', aria: { label: 'Scores offered' } }, toggle, body);
    const doc = () => element.ownerDocument;

    // ------------------------------------------------------------ numbers

    /** A number box: checked as typed, applied on Enter or on leaving it, the last valid value put back otherwise. */
    function numberBox({ key, name, parse, read, write, width }) {
        const input = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
            class: 'form-control form-control-sm gsig-scoring__number', id: sid(key), data: { param: key },
            aria: { label: name, describedby: sid(`${key}-error`) } });
        if (width) input.style.width = width;
        const error = el('div', { class: 'gsig-scoring__error', id: sid(`${key}-error`), role: 'alert', hidden: true });
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

    // The boxes are made afresh each time the rows are painted: a box that is typed in is never moved or removed
    // while it holds the focus (that would fire its blur in the middle of the removal).
    let boxes = {};

    function makeBoxes() {
        const clipBox = el('input', { type: 'checkbox', class: 'gsig-scoring__clipbox', id: sid('clipbox'),
            aria: { label: 'Clip z-scores' }, on: { change: () => apply({ clip: clipBox.checked ? lastClip : null }) } });
        boxes = {
            clipBox,
            clip: numberBox({ key: 'clip', name: 'Clip z-scores at plus and minus this value', parse: parseClipText,
                read: (r) => (r.clip === null ? lastClip : r.clip), write: (v) => { lastClip = v; return { clip: v }; }, width: '5rem' }),
            bins: numberBox({ key: 'bins', name: 'Number of gene bins', parse: (t) => parseWholeText(t, BINS_RANGE),
                read: (r) => r.bins, write: (v) => ({ bins: v }), width: '4rem' }),
            controls: numberBox({ key: 'controls', name: 'Control genes per bin', parse: (t) => parseWholeText(t, CONTROLS_RANGE),
                read: (r) => r.controls, write: (v) => ({ controls: v }), width: '4.5rem' }),
            seed: numberBox({ key: 'seed', name: 'Seed of the control genes', parse: parseSeedText,
                read: (r) => (r.seed === null ? DEFAULT_SEED : r.seed), write: (v) => ({ seed: v }), width: '5.5rem' }),
            detect: numberBox({ key: 'detect', name: 'A gene counts as detected above this value', parse: parseThresholdText,
                read: (r) => r.detect_above, write: (v) => ({ detect_above: v }), width: '5rem' })
        };
    }

    const field = (text, control, forId) => el('span', { class: 'gsig-scoring__field' }, el('label', { for: forId, text }), control);
    const params = {
        zscore_mean: () => el('div', { class: 'gsig-scoring__params' },
            el('span', { class: 'gsig-scoring__field' }, boxes.clipBox, el('label', { for: sid('clipbox'), text: 'Clip at ±' }), boxes.clip.input),
            el('span', { class: 'gsig-scoring__help', data: { clipHelp: '' } }), boxes.clip.error),
        control_adjusted: () => el('div', { class: 'gsig-scoring__params' },
            field('Bins', boxes.bins.input, sid('bins')), field('Controls per bin', boxes.controls.input, sid('controls')),
            field('Seed', boxes.seed.input, sid('seed')), boxes.bins.error, boxes.controls.error, boxes.seed.error,
            el('span', { class: 'gsig-scoring__help', text: SCORING_HELP.seed })),
        detected: () => el('div', { class: 'gsig-scoring__params' },
            field('Detected above', boxes.detect.input, sid('detect')), boxes.detect.error,
            el('span', { class: 'gsig-scoring__help', text: SCORING_HELP.detectAbove }))
    };

    // ------------------------------------------------------------ direction

    function onDirectionSwitch(on) {
        const recipe = getRecipe();
        if (on) { askOff = false; apply({ directions: true }); paint(); return; }
        if (recipe.down.length) { askOff = true; paint(); return; }       // down genes would silently count as up: ask first
        askOff = false;
        apply({ directions: false });
        paint();
    }

    function paintDirection(recipe) {
        if (!dirBlock) return;
        const n = recipe.down.length;
        dirBox.checked = !!recipe.directions;
        const signed = cleanOffered(recipe.offered, recipe.method).some(canScoreDown);
        dirFormula.textContent = [directionFormula(recipe),
            n && !signed ? 'None of the offered methods can score down genes. Offer z-score mean, mean or control-adjusted.' : ''].filter(Boolean).join(' ');
        dirFormula.hidden = !dirFormula.textContent;
        askOff = askOff && n > 0;
        dirAsk.hidden = !askOff;
        D.clear(dirAsk);
        if (askOff) {
            dirAsk.append(`${n.toLocaleString('en-US')} down gene${n === 1 ? '' : 's'} will count as up. `,
                el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link', data: { countAsUp: '' },
                    on: { click: () => { askOff = false; directions.countAsUp(); paint(); } } }, 'Count as up'), ' ',
                el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link', data: { keepDown: '' },
                    on: { click: () => { askOff = false; paint(); } } }, 'Keep'));
        }
    }

    // ------------------------------------------------------------ edits

    const usesOf = (list, value) => {
        const u = list.find(x => x.value === value);
        return u ? { plots: u.plots || 0, tables: u.tables || 0 } : { plots: 0, tables: 0 };
    };

    /** "1 plot keeps it and says so." / "2 plots, 1 table keep it and say so." */
    const keepsText = (used) => (/^1 [a-z]+$/.test(used) ? `${used} keeps it and says so.` : `${used} keep it and say so.`);

    function toggleMethod(method, on) {
        const recipe = getRecipe();
        const before = { offered: cleanOffered(recipe.offered, recipe.method), method: recipe.method };
        const next = new Set(before.offered);
        if (on) next.add(method); else next.delete(method);
        const nextList = cleanOffered([...next], recipe.method);
        apply({ offered: nextList, ...(on || recipe.method !== method ? {} : { method: nextList[0] }) });
        const used = useText(usesOf(getInUse(), method));
        notice = !on && used ? { text: `${methodShort(method)} is no longer offered. ${keepsText(used)}`, undo: before } : null;
        paint();
    }

    /** Offer exactly these layers, in this order; the first is the one a new consumer starts on. */
    function applyLayers(list) {
        apply({ layers: list, input: list[0] });
    }

    function toggleLayer(layer, on) {
        const recipe = getRecipe();
        const before = { layers: cleanLayers(recipe.layers, recipe.input), input: recipe.input };
        const next = new Set(before.layers);
        if (on) next.add(layer); else next.delete(layer);
        applyLayers([...next]);
        if (on) askKind(layer);
        const used = useText(usesOf(getLayersInUse(), layer));
        notice = !on && used ? { text: `${layer} is no longer offered. ${keepsText(used)}`, undo: before } : null;
        paint();
    }

    function resetMethod(method) {
        const patch = { ...PARAM_DEFAULTS[method] };
        if (method === 'zscore_mean') lastClip = DEFAULT_CLIP;
        apply(patch);
    }

    function resetAll(confirmed) {
        const recipe = getRecipe();
        const keep = new Set(cleanOffered(DEFAULT_OFFERED, DEFAULT_METHOD));
        const removed = cleanOffered(recipe.offered, recipe.method).filter(m => !keep.has(m)).concat(
            cleanLayers(recipe.layers, recipe.input).filter(l => l !== DEFAULT_INPUT));
        const inUse = getInUse().filter(u => removed.includes(u.value)).reduce((n, u) => n + u.plots + u.tables, 0)
            + getLayersInUse().filter(u => u.value && removed.includes(u.value)).reduce((n, u) => n + u.plots + u.tables, 0);
        if (inUse && !confirmed) {
            confirmReset = inUse === 1 ? '1 plot or table uses an option this removes.' : `${inUse} plots and tables use options this removes.`;
            paint();
            return;
        }
        confirmReset = null;
        notice = null;
        lastClip = DEFAULT_CLIP;
        apply({ input: DEFAULT_INPUT, clip: DEFAULT_CLIP, seed: null, bins: DEFAULT_BINS, controls: DEFAULT_CONTROLS, detect_above: 0,
            method: DEFAULT_METHOD, offered: [...DEFAULT_OFFERED], layers: [DEFAULT_INPUT] });
        paint();
    }

    function isDefault(recipe) {
        return recipe.input === DEFAULT_INPUT && recipe.clip === DEFAULT_CLIP && (recipe.seed === null || recipe.seed === DEFAULT_SEED)
            && recipe.bins === DEFAULT_BINS && recipe.controls === DEFAULT_CONTROLS && recipe.detect_above === 0
            && recipe.method === DEFAULT_METHOD
            && cleanOffered(recipe.offered, recipe.method).join() === DEFAULT_OFFERED.join()
            && cleanLayers(recipe.layers, recipe.input).join() === DEFAULT_INPUT;
    }

    // ------------------------------------------------------------ painting

    /** The sentences that grade one method on the offered layers: said once, here, never in a plot. */
    function gradeLines(method, layers, recipe) {
        const lines = [];
        for (const layer of layers) {
            const g = gradeOption(method, layer, kinds.get(layer), !!(recipe.down && recipe.down.length));
            if (g.grade === 'ok') continue;
            // a reason that holds whatever the layer (down genes) is said once
            if (g.down) { if (!lines.some(l => l.down)) lines.push({ grade: g.grade, text: g.reason, layer: '', down: true }); }
            else lines.push({ grade: g.grade, text: g.reason, layer });
        }
        return lines;
    }

    function paintMethods(recipe) {
        makeBoxes();
        D.clear(methodRows);
        const offered = new Set(cleanOffered(recipe.offered, recipe.method));
        const layers = cleanLayers(recipe.layers, recipe.input);
        const used = getInUse();
        for (const info of METHOD_INFO) {
            const on = offered.has(info.value);
            const last = on && offered.size === 1;
            const box = el('input', { type: 'checkbox', class: 'gsig-scoring__offer', id: sid(`offer-${info.value}`), checked: on,
                data: { offerMethod: info.value }, disabled: last, title: last ? SCORING_HELP.lastMethod : '',
                on: { change: () => toggleMethod(info.value, box.checked) } });
            const use = useText(usesOf(used, info.value));
            const head = el('div', { class: 'gsig-scoring__optionhead' }, box,
                el('label', { for: sid(`offer-${info.value}`), class: 'gsig-scoring__optionname', text: info.label }),
                use ? el('span', { class: 'gsig-scoring__use', data: { inUse: info.value }, text: use }) : null);
            const row = el('div', { class: `gsig-scoring__option${on ? '' : ' is-off'}`, data: { method: info.value } },
                head, el('div', { class: 'gsig-scoring__definition', text: info.definition }));
            if (on && params[info.value]) {
                const block = params[info.value]();
                if (!isMethodDefault(recipe, info.value)) {
                    block.append(el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link gsig-scoring__resetmethod',
                        data: { resetMethod: info.value }, on: { click: () => resetMethod(info.value) } }, 'Reset'));
                }
                row.append(block);
            }
            if (on) {
                for (const line of gradeLines(info.value, layers, recipe)) {
                    row.append(el('div', { class: `gsig-scoring__grade gsig-scoring__grade--${line.grade}`, role: 'status',
                        data: { grade: line.grade, gradeLayer: line.layer } }, el('span', { 'aria-hidden': 'true', text: '⚠ ' }), line.text));
                }
            }
            methodRows.append(row);
        }
    }

    function paintLayers(recipe) {
        D.clear(layerRows);
        const layers = new Set(cleanLayers(recipe.layers, recipe.input));
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
            const box = el('input', { type: 'checkbox', class: 'gsig-scoring__offer', id: sid(`layer-offer-${name}`),
                checked: layers.has(name), disabled: last, data: { layerOffer: name },
                title: last ? SCORING_HELP.lastLayer : '', on: { change: () => toggleLayer(name, box.checked) } });
            const word = kindWord(kinds.get(name));
            const use = useText(usesOf(used.map(u => ({ ...u, value: u.value === null ? recipe.input : u.value })), name));
            const warning = warnings.get(name);
            layerRows.append(el('div', { class: 'gsig-scoring__layer', data: { layer: name } },
                el('div', { class: 'gsig-scoring__optionhead' }, box,
                    el('label', { for: sid(`layer-offer-${name}`), class: 'gsig-scoring__optionname', text: known ? name : `${name} (not in this dataset)` }),
                    word ? el('span', { class: 'gsig-scoring__kind', data: { kind: kinds.get(name) }, text: word }) : null,
                    use ? el('span', { class: 'gsig-scoring__use', text: use }) : null),
                warning ? el('div', { class: 'gsig-inputwarn', role: 'status', data: { inputWarning: 'layer', layer: name } },
                    el('span', { 'aria-hidden': 'true', text: '⚠ ' }), warning.text,
                    warning.suggest ? [' ', el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link',
                        data: { useInput: warning.suggest }, on: { click: () => offerInstead(name, warning.suggest) } },
                    `Offer ${warning.suggest} instead`)] : null) : null));
        }
    }

    /**
     * The raw-count warning's button: offer `better` (a layer that looks log-normalised) in place of `raw`, unless a plot
     * or table reads `raw`, which then stays offered.
     */
    function offerInstead(raw, better) {
        const recipe = getRecipe();
        const layers = cleanLayers(recipe.layers, recipe.input);
        const inUse = getLayersInUse().some(u => (u.value === null ? recipe.input : u.value) === raw && (u.plots || u.tables));
        let next;
        if (layers.includes(better)) next = inUse ? [...layers] : layers.filter(l => l !== raw);
        else if (inUse) next = [...layers, better];
        else next = layers.map(l => (l === raw ? better : l));            // in the raw layer's place, so it stays first if it was
        applyLayers(next.length ? next : [better]);
        askKind(better);
    }

    function paintWarning(recipe) {
        D.clear(warningLine);
        const warning = warnings.get(recipe.input);
        warningLine.hidden = !warning || open;
        if (!warning) return;
        warningLine.dataset.kind = warning.kind;
        warningLine.append(el('span', { text: warning.text }));
        if (warning.suggest) {
            warningLine.append(' ', el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link', data: { useInput: warning.suggest },
                on: { click: () => offerInstead(recipe.input, warning.suggest) } }, `Offer ${warning.suggest} instead`));
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

    /** Fill the parameter boxes (not the one being typed in) and say why a box is off. */
    function paintParams(recipe) {
        const clipOn = recipe.clip !== null;
        if (clipOn) lastClip = recipe.clip;
        const focused = doc().activeElement;
        const set = (box, value) => { if (focused !== box.input) box.input.value = String(value); };
        set(boxes.clip, clipOn ? recipe.clip : lastClip);
        set(boxes.bins, recipe.bins);
        set(boxes.controls, recipe.controls);
        set(boxes.seed, recipe.seed === null ? DEFAULT_SEED : recipe.seed);
        set(boxes.detect, recipe.detect_above);
        boxes.clipBox.checked = clipOn;
        boxes.clip.input.disabled = !clipOn;
        const help = element.querySelector('[data-clip-help]');
        if (help) help.textContent = clipOn ? SCORING_HELP.clip : SCORING_HELP.clipOff;
    }

    function paint(force = false) {
        if (destroyed) return;
        const recipe = getRecipe();
        const full = offeredSummary(recipe);
        summary.textContent = full;
        summary.title = full;
        toggle.setAttribute('aria-label', `Scores offered: ${full}`);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.dataset.short = offeredSummaryShort(recipe);
        caret.textContent = open ? '▾' : '▸';
        body.hidden = !open;
        const typing = doc().activeElement && doc().activeElement.dataset && doc().activeElement.dataset.param
            && body.contains(doc().activeElement);
        if ((open || methodRows.childNodes.length === 0) && !(typing && !force)) {
            // the box being used keeps the focus across the repaint
            const keep = typing ? doc().activeElement.dataset.param : null;
            paintDirection(recipe);
            paintMethods(recipe);
            paintLayers(recipe);
            paintParams(recipe);
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
        const warning = reply && warningFor ? warningFor(reply) : null;
        if (warning) warnings.set(layer, warning); else warnings.delete(layer);
        paint();
        if (reply && reply.kind && before !== reply.kind) onKinds();
    }

    /** What every listed layer looks like (one sample each, no look at the others): for the kind word and the grades. */
    function askAllKinds() {
        const offered = new Set(cleanLayers(getRecipe().layers, getRecipe().input));
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
        warnings.clear();
        return Promise.all(cleanLayers(recipe.layers, recipe.input).map(l => askKind(l)));
    }

    return {
        element,
        warning: warningLine,
        paint,
        paintAggregations: () => { if (!destroyed && open) paint(); },
        refreshInputs,
        refreshKind,
        /** Open the section and put the cursor on it: where a consumer's "Offer other scores…" leads. */
        reveal() { if (destroyed) return; open = true; paint(); toggle.focus(); },
        getKinds: () => Object.fromEntries(kinds),
        destroy() { destroyed = true; },
        /** For tests. */
        state: () => ({ open, inputs: [...inputs], warnings: [...warnings.keys()], kinds: Object.fromEntries(kinds), lastClip })
    };
}
