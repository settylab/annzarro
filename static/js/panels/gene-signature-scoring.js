/**
 * The Score options section of the Gene Signature panel: what the signature offers plots and tables, and how
 * each option is computed. A plot or table only picks from what is offered here (source gene-score, then this
 * signature, then the option); the model is utils/signature-options.js.
 *
 * Collapsed, one row states what is offered ("Offered: z-score mean, mean, sum · layer X"). Open:
 *
 *   Options   for each aggregation: [x] Offer, its one-line definition, its parameters when offered
 *               z-score mean   Clip z-scores at ± [10] (or off)
 *               control-adjusted   Bins [25]   Controls per bin [50]   Seed [0]
 *             and which options plots and tables use now
 *   Layers    for each matrix: [x] Offer, ( ) default; a warning where one looks like raw counts
 *
 * Every setting is part of the recipe: it goes into the link, the panel set and the score's key. A number is
 * checked on Enter or on leaving the box: an invalid one keeps the last valid value and says what is expected.
 * Nothing here computes; the page applies an edit to plots and tables by the rules for recipe edits.
 *
 * `makeDom(document)` and the callbacks are injected, so the section touches no page state of its own.
 */
import {
    BINS_RANGE, CONTROLS_RANGE, DEFAULT_BINS, DEFAULT_CLIP, DEFAULT_CONTROLS, DEFAULT_INPUT, DEFAULT_SEED, parseClipText,
    parseSeedText, parseWholeText
} from '../utils/gene-signature.js';
import { DEFAULT_METHOD, DEFAULT_OFFERED, METHOD_INFO, cleanLayers, cleanOffered, offeredSummary } from '../utils/signature-options.js';

/** The help texts, so the page and its tests say the same thing. */
export const SCORING_HELP = Object.freeze({
    where: 'Plots and tables pick from what is offered here: choose gene-score as the source, then this signature, then the option.',
    clip: 'One rare gene can otherwise dominate the average.',
    clipOff: 'Not clipped: one rare gene can dominate the average.',
    needsOffer: 'Offer this option to set its parameters.',
    seed: 'The same seed gives the same control genes, so the same score.',
    layers: 'Plots and tables choose among the offered layers. The default is used where none is chosen.',
    defaultLayer: 'The default layer is always offered.'
});

/**
 * @param {Object} options
 * @param {{el: Function, clear: Function}} options.D - the DOM builder (panels/gene-set-utilities/dom.js)
 * @param {string} options.id - the panel's id, for unique element ids
 * @param {() => Object} options.getRecipe - the signature's recipe now
 * @param {(patch: Object) => void} options.apply - make `patch` (keys of a recipe) part of the recipe
 * @param {() => Promise<string[]>} options.getInputs - the matrices a score can read, X first
 * @param {(input: string) => Promise<(Object|null)>} options.getKind - what a layer looks like (matrix-kind-client.js)
 * @param {() => Array<{value: string, count: number}>} [options.getInUse] - aggregations plots and tables use
 * @param {() => Array<{value: (string|null), count: number}>} [options.getLayersInUse] - layers plots and tables use
 * @param {(reply: Object) => (Object|null)} options.warningFor - the warning for one kind reply
 */
export function createScoringSection({ D, id, getRecipe, apply, getInputs, getKind, getInUse = () => [],
    getLayersInUse = () => [], warningFor }) {
    const { el } = D;
    const sid = (x) => `gsig-scoring-${x}-${id}`;
    const doc = () => element.ownerDocument;
    let open = false;
    let inputs = [DEFAULT_INPUT];
    let lastClip = DEFAULT_CLIP;
    let destroyed = false;
    const warnings = new Map();         // layer -> {kind, text, suggest}
    const asked = new Map();            // layer -> token of the question in flight

    const toggle = el('button', { type: 'button', class: 'gsig-scoring__toggle', id: sid('toggle'),
        aria: { expanded: 'false', controls: sid('body') }, on: { click: () => { open = !open; paint(); } } });
    const caret = el('span', { class: 'gsig-scoring__caret', aria: { hidden: 'true' } }, '▸');
    const label = el('span', { class: 'gsig-scoring__label', text: 'Score options' });
    const summary = el('span', { class: 'gsig-scoring__summary', id: sid('summary') });
    toggle.append(caret, ' ', label, ' ', summary);

    const where = el('div', { class: 'gsig-scoring__help', data: { aggregationsHelp: '' }, text: SCORING_HELP.where });
    const optionRows = el('div', { class: 'gsig-scoring__options', role: 'group', aria: { label: 'Options offered' } });
    const layerRows = el('div', { class: 'gsig-scoring__layers', role: 'group', aria: { label: 'Layers offered' } });
    const layersHelp = el('div', { class: 'gsig-scoring__help', text: SCORING_HELP.layers });
    const reset = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary gsig-scoring__reset',
        on: { click: resetAll } }, 'Reset to defaults');
    const body = el('div', { class: 'gsig-scoring__body', id: sid('body'), hidden: true },
        where,
        el('div', { class: 'gsig-scoring__heading', text: 'Options' }), optionRows,
        el('div', { class: 'gsig-scoring__heading', text: 'Layers' }), layerRows, layersHelp,
        el('div', { class: 'gsig-scoring__actions' }, reset));
    // the warning for the default layer, in the status zone: seen with the section collapsed
    const warningLine = el('div', { class: 'gsig-inputwarn', role: 'status', hidden: true, data: { inputWarning: 'status' } });
    const element = el('section', { class: 'gsig-scoring', aria: { label: 'Score options' } }, toggle, body);

    // ------------------------------------------------------------ numbers

    /** A number box: checked as typed, applied on Enter or on leaving it, the last valid value put back otherwise. */
    function numberBox({ key, name, parse, read, write, width }) {
        const input = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
            class: 'form-control form-control-sm gsig-scoring__number', id: sid(key), data: { param: key },
            aria: { label: name, describedby: sid(`${key}-error`) } });
        if (width) input.style.width = width;
        const error = el('div', { class: 'gsig-scoring__error', id: sid(`${key}-error`), role: 'alert', hidden: true });
        const show = (message) => { error.hidden = !message; error.textContent = message || ''; input.classList.toggle('is-invalid', !!message); };
        input.addEventListener('input', () => { const p = parse(input.value); show(p.ok ? '' : p.error); });
        input.addEventListener('change', () => {
            const p = parse(input.value);
            if (!p.ok) {
                input.value = String(read(getRecipe()));              // the last valid value comes back
                show(p.error);
                return;
            }
            show('');
            if (read(getRecipe()) !== p.value) apply(write(p.value));
            paint();
        });
        return { input, error, show, read };
    }

    const clipBox = el('input', { type: 'checkbox', class: 'gsig-scoring__clipbox', id: sid('clipbox'),
        aria: { label: 'Clip z-scores' }, on: { change: () => apply({ clip: clipBox.checked ? lastClip : null }) } });
    const clip = numberBox({ key: 'clip', name: 'Clip z-scores at plus and minus this value', parse: parseClipText,
        read: (r) => (r.clip === null ? lastClip : r.clip), write: (v) => { lastClip = v; return { clip: v }; }, width: '5.5rem' });
    const bins = numberBox({ key: 'bins', name: 'Number of gene bins', parse: (t) => parseWholeText(t, BINS_RANGE),
        read: (r) => r.bins, write: (v) => ({ bins: v }), width: '4.5rem' });
    const controls = numberBox({ key: 'controls', name: 'Control genes per bin', parse: (t) => parseWholeText(t, CONTROLS_RANGE),
        read: (r) => r.controls, write: (v) => ({ controls: v }), width: '4.5rem' });
    const seed = numberBox({ key: 'seed', name: 'Seed of the control genes', parse: parseSeedText,
        read: (r) => (r.seed === null ? DEFAULT_SEED : r.seed), write: (v) => ({ seed: v }), width: '6rem' });

    const params = {
        zscore_mean: () => el('div', { class: 'gsig-scoring__params' },
            clipBox, el('label', { for: sid('clipbox'), text: 'Clip z-scores at ±' }), clip.input, clip.error,
            el('div', { class: 'gsig-scoring__help', data: { clipHelp: '' } })),
        control_adjusted: () => el('div', { class: 'gsig-scoring__params' },
            el('label', { for: sid('bins'), text: 'Bins' }), bins.input,
            el('label', { for: sid('controls'), text: 'Controls per bin' }), controls.input,
            el('label', { for: sid('seed'), text: 'Seed' }), seed.input, bins.error, controls.error, seed.error,
            el('div', { class: 'gsig-scoring__help', text: SCORING_HELP.seed }))
    };

    // ------------------------------------------------------------ edits

    function toggleMethod(method, on) {
        const recipe = getRecipe();
        const next = new Set(cleanOffered(recipe.offered, recipe.method));
        if (on) next.add(method); else next.delete(method);
        apply({ offered: [...next], ...(on ? {} : (recipe.method === method ? { method: cleanOffered([...next])[0] } : {})) });
    }

    function toggleLayer(layer, on) {
        const recipe = getRecipe();
        const next = new Set(cleanLayers(recipe.layers, recipe.input));
        if (on) next.add(layer); else next.delete(layer);
        apply({ layers: [...next] });
        if (on) askKind(layer);
    }

    function resetAll() {
        lastClip = DEFAULT_CLIP;
        apply({ input: DEFAULT_INPUT, clip: DEFAULT_CLIP, seed: null, bins: DEFAULT_BINS, controls: DEFAULT_CONTROLS,
            method: DEFAULT_METHOD, offered: [...DEFAULT_OFFERED], layers: [DEFAULT_INPUT] });
    }

    function isDefault(recipe) {
        return recipe.input === DEFAULT_INPUT && recipe.clip === DEFAULT_CLIP && (recipe.seed === null || recipe.seed === DEFAULT_SEED)
            && recipe.bins === DEFAULT_BINS && recipe.controls === DEFAULT_CONTROLS && recipe.method === DEFAULT_METHOD
            && cleanOffered(recipe.offered, recipe.method).join() === DEFAULT_OFFERED.join()
            && cleanLayers(recipe.layers, recipe.input).join() === DEFAULT_INPUT;
    }

    // ------------------------------------------------------------ painting

    function paintOptions(recipe) {
        D.clear(optionRows);
        const offered = new Set(cleanOffered(recipe.offered, recipe.method));
        const used = new Map(getInUse().map(u => [u.value, u.count]));
        for (const info of METHOD_INFO) {
            const on = offered.has(info.value);
            const box = el('input', { type: 'checkbox', class: 'gsig-scoring__offer', id: sid(`offer-${info.value}`), checked: on,
                data: { offerMethod: info.value }, disabled: on && offered.size === 1,
                title: on && offered.size === 1 ? 'At least one option stays offered.' : '',
                on: { change: () => toggleMethod(info.value, box.checked) } });
            const count = used.get(info.value) || 0;
            const row = el('div', { class: `gsig-scoring__option${on ? '' : ' is-off'}`, data: { method: info.value } },
                el('div', { class: 'gsig-scoring__optionhead' }, box,
                    el('label', { for: sid(`offer-${info.value}`), class: 'gsig-scoring__optionname', text: info.label }),
                    on && recipe.method === info.value ? el('span', { class: 'gsig-scoring__tag', text: 'default' }) : null,
                    count ? el('span', { class: 'gsig-scoring__tag gsig-scoring__tag--use', data: { inUse: info.value },
                        text: `used by ${count}` }) : null),
                el('div', { class: 'gsig-scoring__help', text: info.definition }));
            if (params[info.value]) {
                const block = params[info.value]();
                for (const control of block.querySelectorAll('input')) control.disabled = !on;
                if (!on) block.append(el('div', { class: 'gsig-scoring__help', data: { needsOffer: '' }, text: SCORING_HELP.needsOffer }));
                row.append(block);
            }
            optionRows.append(row);
        }
    }

    function paintLayers(recipe) {
        D.clear(layerRows);
        const layers = new Set(cleanLayers(recipe.layers, recipe.input));
        const names = [...new Set([...inputs, ...layers])];
        const used = new Map(getLayersInUse().map(u => [u.value === null ? recipe.input : u.value, u.count]));
        for (const name of names) {
            const isDefaultLayer = name === recipe.input;
            const known = inputs.includes(name);
            const box = el('input', { type: 'checkbox', class: 'gsig-scoring__offer', id: sid(`layer-offer-${name}`),
                checked: layers.has(name), disabled: isDefaultLayer, data: { layerOffer: name },
                title: isDefaultLayer ? SCORING_HELP.defaultLayer : '', on: { change: () => toggleLayer(name, box.checked) } });
            const radio = el('input', { type: 'radio', name: sid('default-layer'), class: 'gsig-scoring__defaultlayer',
                id: sid(`layer-default-${name}`), checked: isDefaultLayer, data: { layerDefault: name },
                aria: { label: `Default layer ${name}` }, on: { change: () => { if (radio.checked) apply({ input: name, layers: [...layers, name] }); if (radio.checked) askKind(name); } } });
            const warning = warnings.get(name);
            const count = used.get(name) || 0;
            layerRows.append(el('div', { class: 'gsig-scoring__layer', data: { layer: name } },
                el('div', { class: 'gsig-scoring__optionhead' }, box,
                    el('label', { for: sid(`layer-offer-${name}`), class: 'gsig-scoring__optionname', text: known ? name : `${name} (not in this dataset)` }),
                    el('label', { class: 'gsig-scoring__default', for: sid(`layer-default-${name}`) }, radio, ' default'),
                    count ? el('span', { class: 'gsig-scoring__tag gsig-scoring__tag--use', text: `used by ${count}` }) : null),
                warning ? el('div', { class: 'gsig-inputwarn', role: 'status', data: { inputWarning: 'layer', layer: name } },
                    warning.text, warning.suggest ? [' ', el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link',
                        data: { useInput: warning.suggest }, on: { click: () => { apply({ input: warning.suggest, layers: [...layers, warning.suggest] }); askKind(warning.suggest); } } },
                        `Use ${warning.suggest}`)] : null) : null));
        }
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
                on: { click: () => { apply({ input: warning.suggest, layers: [...cleanLayers(recipe.layers, recipe.input), warning.suggest] }); askKind(warning.suggest); } } },
            `Use ${warning.suggest}`));
        }
    }

    /** Fill the parameter boxes (not the one being typed in) and say why a box is off. */
    function paintParams(recipe) {
        const clipOn = recipe.clip !== null;
        if (clipOn) lastClip = recipe.clip;
        const offered = cleanOffered(recipe.offered, recipe.method);
        const focused = doc().activeElement;
        const set = (box, value) => { if (focused !== box.input && box.input.isConnected) box.input.value = String(value); };
        set(clip, clipOn ? recipe.clip : lastClip);
        set(bins, recipe.bins);
        set(controls, recipe.controls);
        set(seed, recipe.seed === null ? DEFAULT_SEED : recipe.seed);
        clipBox.checked = clipOn;
        clip.input.disabled = !clipOn || !offered.includes('zscore_mean');
        clipBox.disabled = !offered.includes('zscore_mean');
        const help = element.querySelector('[data-clip-help]');
        if (help) {
            help.textContent = !offered.includes('zscore_mean') ? '' : clipOn ? SCORING_HELP.clip : SCORING_HELP.clipOff;
        }
    }

    function paint() {
        if (destroyed) return;
        const recipe = getRecipe();
        summary.textContent = offeredSummary(recipe);
        toggle.setAttribute('aria-expanded', String(open));
        caret.textContent = open ? '▾' : '▸';
        body.hidden = !open;
        if (open || optionRows.childNodes.length === 0) {
            paintOptions(recipe);
            paintLayers(recipe);
            paintParams(recipe);
        }
        reset.disabled = isDefault(recipe);
        paintWarning(recipe);
    }

    // ------------------------------------------------------------ what the layers look like

    async function askKind(layer) {
        const mine = (asked.get(layer) || 0) + 1;
        asked.set(layer, mine);
        let reply;
        try {
            reply = await getKind(layer);
        } catch {
            reply = null;
        }
        if (destroyed || asked.get(layer) !== mine) return;
        const warning = reply && warningFor ? warningFor(reply) : null;
        if (warning) warnings.set(layer, warning); else warnings.delete(layer);
        paint();
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

    /** Ask what the default layer and every offered layer look like (answers are kept per dataset and layer). */
    function refreshKind() {
        const recipe = getRecipe();
        const layers = cleanLayers(recipe.layers, recipe.input);
        warnings.clear();
        return Promise.all(layers.map(askKind));
    }

    return {
        element,
        warning: warningLine,
        paint,
        paintAggregations: () => { if (!destroyed && open) { const r = getRecipe(); paintOptions(r); paintLayers(r); paintParams(r); } },
        refreshInputs,
        refreshKind,
        destroy() { destroyed = true; },
        /** For tests. */
        state: () => ({ open, inputs: [...inputs], warnings: [...warnings.keys()], lastClip })
    };
}
