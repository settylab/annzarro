/**
 * The Methods pop-over of a source of a gene score (decision 31, offered-removal-080.md section 3): the settings of each
 * score method, for every layer. Nothing is "offered": a plot or table chooses any method and any layer, and this
 * pop-over only holds what defines each method. A Gene Signature shows it as "Methods ▾", a Gene Table as
 * "Score methods ▾".
 *
 *   Methods ▾
 *   Plots and tables choose a method and a layer. These are the settings of each method, for every layer.
 *   Z-score mean      Each gene scaled to mean 0 and SD 1 ...
 *     [x] Clip at ± [10]   Z-scores are cut at ±10. ...
 *     Down genes: (•) each gene weighs equally ( ) each side weighs equally      (a signature with Up/Down on)
 *   Mean ...  Sum ...  Control-adjusted (bins, controls per bin, seed) ...  Fraction detected (detected above) ...
 *   % of total ...
 *   Used by 2 plots, 1 table: z-score mean, mean · X, counts                     [Reset to defaults]
 *
 * The surface is the pop-over primitive (ui/popover.js): Escape and a click outside close it, and opening it moves no
 * box of the panel. The button carries a dot while a parameter is not at its default, and its title names each one, so
 * no setting hides behind the closed pop-over.
 *
 * Every number is checked on Enter or on leaving the box: an invalid one keeps the last valid value and says what is
 * expected. Nothing here computes: an edit reaches the plots and tables that read the score by the rules for recipe
 * edits (applied at once when cheap, behind Update score when not), through `apply`.
 *
 * `D` (the DOM builder) and the callbacks are injected, so the pop-over touches no page state of its own.
 */
import { createPopover } from '../../ui/popover.js';
import {
    BINS_RANGE, CONTROLS_RANGE, DEFAULT_BINS, DEFAULT_CLIP, DEFAULT_CONTROLS, DEFAULT_DOWN_WEIGHT, DEFAULT_SEED,
    cleanDownWeight, directionFormula, downDefinition, parseClipText, parseSeedText, parseThresholdText, parseWholeText
} from '../../utils/gene-signature.js';
import {
    DOWN_WEIGHT_WORDS, SIGNATURE_MODEL as model, WEIGHTED_METHODS, clipLine, methodNotes, thresholdLine, useText
} from '../../utils/signature-options.js';

/** The texts, so the page and its tests say the same thing. The sentences that state a setting are functions of it (signature-options.js). */
const METHODS_HELP = Object.freeze({
    intro: 'Plots and tables choose a method and a layer. These are the settings of each method, for every layer.',
    plainTitle: 'The settings of each score method',
    seed: 'The same seed gives the same control genes, so the same score.',
    downWeight: 'Down genes',
    downWeightWhy: 'Control-adjusted takes each side minus its own controls, so each side always weighs equally.',
    notUsed: 'No plot or table shows this score yet.'
});

/** The parameter fields a reset restores (a source with down genes adds its weighting). */
const RESET_PATCH = Object.freeze({ clip: DEFAULT_CLIP, seed: null, bins: DEFAULT_BINS, controls: DEFAULT_CONTROLS, detect_above: 0 });

/**
 * @param {Object} o
 * @param {{el: Function, clear: Function}} o.D - the DOM builder (panels/gene-set-utilities/dom.js)
 * @param {string} o.id - the panel's id, for unique element ids
 * @param {string} [o.label] - the button's text ("Methods"; a gene table says "Score methods")
 * @param {() => Object} o.getRecipe - the option fields now (a signature passes its recipe)
 * @param {(patch: Object) => void} o.apply - make `patch` part of the option fields and tell the readers
 * @param {() => Array<{value: string, plots: number, tables: number}>} [o.getInUse] - methods plots and tables read
 * @param {() => Array<{value: (string|null), plots: number, tables: number}>} [o.getLayersInUse] - layers they read
 * @param {boolean} [o.directions] - the source can have down genes (a signature): the down weighting is listed under
 *   the methods that have one while its Up/Down switch is on
 */
export function createMethodsPopover({ D, id, label = 'Methods', getRecipe, apply, getInUse = () => [], getLayersInUse = () => [],
    directions = false }) {
    const { el } = D;
    const sid = (x) => `gsig-methods-${x}-${id}`;
    let lastClip = DEFAULT_CLIP;
    let confirmReset = null;            // the sentence asking before a reset changes a score in use
    let destroyed = false;

    // ------------------------------------------------------------ the button

    const dot = el('span', { class: 'gsig-methods__dot', hidden: true, aria: { hidden: 'true' } });
    const button = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary gsig-methods__toggle', id: sid('toggle'),
        data: { methods: '' } }, el('span', { text: label }), ' ', el('span', { class: 'gsig-methods__caret', aria: { hidden: 'true' }, text: '▾' }), dot);

    // ------------------------------------------------------------ numbers

    /** A number box: checked as typed, applied on Enter or on leaving it, the last valid value put back otherwise. */
    function numberBox({ key, name, parse, read, write, width }) {
        const input = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
            class: 'form-control form-control-sm gsig-scoring__number', id: sid(key), data: { param: key },
            aria: { label: name, describedby: sid(`${key}-error`) } });
        if (width) input.style.width = width;
        const error = el('div', { class: 'gsig-scoring__error', id: sid(`${key}-error`), role: 'alert', hidden: true });
        const show = (message) => {
            error.hidden = !message;
            error.textContent = message || '';
            input.classList.toggle('is-invalid', !!message);
            input.setAttribute('aria-invalid', String(!!message));
        };
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

    const clipBox = el('input', { type: 'checkbox', class: 'gsig-methods__clipbox', id: sid('clipbox'), aria: { label: 'Clip z-scores' },
        on: { change: () => { apply({ clip: clipBox.checked ? lastClip : null }); paint(); } } });
    const boxes = {
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
    const field = (text, control, forId) => el('span', { class: 'gsig-scoring__field' }, el('label', { for: forId, text }), control);
    const clipHelp = el('span', { class: 'gsig-scoring__help', data: { clipHelp: '' } });
    const detectHelp = el('span', { class: 'gsig-scoring__help', data: { detectHelp: '' } });
    const params = {
        zscore_mean: el('div', { class: 'gsig-scoring__params' },
            el('span', { class: 'gsig-scoring__field' }, clipBox, el('label', { for: sid('clipbox'), text: 'Clip at ±' }), boxes.clip.input),
            clipHelp, boxes.clip.error),
        control_adjusted: el('div', { class: 'gsig-scoring__params' },
            field('Bins', boxes.bins.input, sid('bins')), field('Controls per bin', boxes.controls.input, sid('controls')),
            field('Seed', boxes.seed.input, sid('seed')), boxes.bins.error, boxes.controls.error, boxes.seed.error,
            el('span', { class: 'gsig-scoring__help', text: METHODS_HELP.seed })),
        detected: el('div', { class: 'gsig-scoring__params' },
            field('Detected above', boxes.detect.input, sid('detect')), boxes.detect.error, detectHelp)
    };

    // ------------------------------------------------------------ down genes

    /** "Down genes: (o) each gene weighs equally ( ) each side weighs equally", under each method it applies to. */
    function weightControl(method) {
        const group = `gsig-methods-dw-${id}-${method}`;
        const radios = {};
        const radio = (value) => {
            const input = el('input', { type: 'radio', name: group, id: sid(`dw-${method}-${value}`), data: { downWeight: value },
                on: { change: () => { if (input.checked) { apply({ down_weight: value }); paint(); } } } });
            radios[value] = input;
            return el('label', { class: 'gsig-scoring__field', for: sid(`dw-${method}-${value}`) }, input, ` ${DOWN_WEIGHT_WORDS[value]}`);
        };
        const node = el('div', { class: 'gsig-scoring__params', role: 'radiogroup', aria: { label: METHODS_HELP.downWeight }, data: { weighting: method } },
            el('span', { text: `${METHODS_HELP.downWeight}: ` }), radio('gene'), radio('side'));
        return { node, radios };
    }

    // ------------------------------------------------------------ the rows, made once and painted in place

    const formula = el('div', { class: 'gsig-scoring__help', data: { directionFormula: '' }, hidden: true });
    const rows = model.methods.map((info) => {
        const definition = el('div', { class: 'gsig-scoring__definition', text: info.definition });
        const reset = el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link gsig-scoring__resetmethod', hidden: true,
            data: { resetMethod: info.value }, on: { click: () => resetMethod(info.value) } }, 'Reset');
        const why = info.value === 'control_adjusted' && directions
            ? el('div', { class: 'gsig-scoring__help', data: { downWeightWhy: '' }, hidden: true, text: METHODS_HELP.downWeightWhy }) : null;
        const weight = directions && WEIGHTED_METHODS.includes(info.value) ? weightControl(info.value) : null;
        const use = el('span', { class: 'gsig-scoring__use', data: { inUse: info.value } });
        const node = el('div', { class: 'gsig-scoring__option gsig-methods__method', data: { method: info.value } },
            el('div', { class: 'gsig-scoring__optionhead' }, el('span', { class: 'gsig-scoring__optionname', text: info.label }), use, reset),
            definition, why, params[info.value] || null, weight ? weight.node : null);
        return { info, node, definition, reset, why, weight, use };
    });
    const usedBy = el('div', { class: 'gsig-scoring__help gsig-methods__usedby', data: { usedBy: '' } });
    const resetNote = el('div', { class: 'gsig-scoring__notice', role: 'status', hidden: true, data: { resetNote: '' } });
    const resetAllBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary gsig-scoring__reset', data: { resetAll: '' },
        on: { click: () => resetAll(false) } }, 'Reset to defaults');
    const content = el('div', { class: 'gsig-scoring gsig-scoring--in-pop gsig-methods', data: { methodsBody: '' } },
        el('div', { class: 'gsig-scoring__body' },
            el('div', { class: 'gsig-scoring__help', data: { methodsIntro: '' }, text: METHODS_HELP.intro }),
            formula,
            el('div', { class: 'gsig-scoring__options' }, ...rows.map(r => r.node)),
            usedBy, resetNote, el('div', { class: 'gsig-scoring__actions' }, resetAllBtn)));

    // ------------------------------------------------------------ edits

    function resetMethod(method) {
        const patch = { ...model.paramDefaults[method] };
        if (method === 'zscore_mean') lastClip = DEFAULT_CLIP;
        apply(patch);
        paint();
    }

    const resetPatch = () => ({ ...RESET_PATCH, ...(directions ? { down_weight: DEFAULT_DOWN_WEIGHT } : {}) });

    /** The methods plots and tables read whose number a reset would change. */
    function changedInUse(recipe) {
        const sideNow = directions && recipe.down && recipe.down.length && cleanDownWeight(recipe.down_weight) !== DEFAULT_DOWN_WEIGHT;
        return getInUse().filter(u => (u.plots || u.tables)
            && (!model.isMethodDefault(recipe, u.value) || (sideNow && WEIGHTED_METHODS.includes(u.value))));
    }

    /** Back to the default parameters. It asks first only when a plot's or table's score would change. */
    function resetAll(confirmed) {
        const recipe = getRecipe();
        const users = changedInUse(recipe).reduce((n, u) => n + (u.plots || 0) + (u.tables || 0), 0);
        if (users && !confirmed) {
            confirmReset = users === 1 ? '1 plot or table shows a score this changes.' : `${users} plots and tables show scores this changes.`;
            paint();
            return;
        }
        confirmReset = null;
        lastClip = DEFAULT_CLIP;
        apply(resetPatch());
        paint();
    }

    const isDefault = (recipe) => model.methods.every(m => model.isMethodDefault(recipe, m.value))
        && (!directions || cleanDownWeight(recipe.down_weight) === DEFAULT_DOWN_WEIGHT);

    // ------------------------------------------------------------ painting

    /** "z-score mean: not clipped; control-adjusted: seed 3", with the down weighting when it is by side. */
    function notesText(recipe) {
        const parts = methodNotes(recipe).map(m => `${model.methodShort(m.method)}: ${m.notes.join(', ')}`);
        if (directions && cleanDownWeight(recipe.down_weight) !== DEFAULT_DOWN_WEIGHT) parts.push(`down genes: ${DOWN_WEIGHT_WORDS.side}`);
        return parts.join('; ');
    }

    /** "Used by 2 plots, 1 table: z-score mean, mean · X, counts". */
    function usedByText(recipe) {
        const methods = getInUse().filter(u => u.plots || u.tables);
        if (!methods.length) return METHODS_HELP.notUsed;
        const total = methods.reduce((t, u) => ({ plots: t.plots + (u.plots || 0), tables: t.tables + (u.tables || 0) }), { plots: 0, tables: 0 });
        const layers = [...new Set(getLayersInUse().filter(u => u.plots || u.tables).map(u => (u.value === null ? recipe.input : u.value)))];
        return `Used by ${useText(total)}: ${methods.map(u => model.methodShort(u.value)).join(', ')}${layers.length ? ` · ${layers.join(', ')}` : ''}`;
    }

    function paintButton(recipe) {
        const notes = notesText(recipe);
        dot.hidden = !notes;
        button.title = notes || METHODS_HELP.plainTitle;
        button.setAttribute('aria-label', notes ? `${label}: ${notes}` : label);
        button.dataset.nondefault = notes ? 'true' : 'false';
    }

    /** Fill the boxes (not the one being typed in) and state each setting in force. */
    function paintParams(recipe) {
        const clipOn = recipe.clip !== null;
        if (clipOn) lastClip = recipe.clip;
        const focused = content.ownerDocument.activeElement;
        const set = (box, value) => { if (focused !== box.input) { box.input.value = String(value); box.show(''); } };
        set(boxes.clip, clipOn ? recipe.clip : lastClip);
        set(boxes.bins, recipe.bins);
        set(boxes.controls, recipe.controls);
        set(boxes.seed, recipe.seed === null ? DEFAULT_SEED : recipe.seed);
        set(boxes.detect, recipe.detect_above);
        clipBox.checked = clipOn;
        boxes.clip.input.disabled = !clipOn;
        clipHelp.textContent = clipLine(recipe.clip);
        detectHelp.textContent = thresholdLine(recipe.detect_above);
    }

    function paintRows(recipe) {
        const on = directions && !!recipe.directions;
        formula.textContent = on ? directionFormula(recipe) : '';
        formula.hidden = !formula.textContent;
        const used = getInUse();
        for (const row of rows) {
            const signed = on ? downDefinition(recipe, row.info.value) : '';
            row.definition.textContent = signed || row.info.definition;
            if (signed) row.definition.dataset.signed = ''; else delete row.definition.dataset.signed;
            row.reset.hidden = model.isMethodDefault(recipe, row.info.value);
            if (row.why) row.why.hidden = !on;
            if (row.weight) {
                row.weight.node.hidden = !on;
                const now = cleanDownWeight(recipe.down_weight);
                for (const [value, radio] of Object.entries(row.weight.radios)) radio.checked = value === now;
            }
            const u = used.find(x => x.value === row.info.value);
            row.use.textContent = u ? useText(u) : '';
        }
    }

    function paint() {
        if (destroyed) return;
        const recipe = getRecipe();
        paintButton(recipe);
        paintRows(recipe);
        paintParams(recipe);
        usedBy.textContent = usedByText(recipe);
        D.clear(resetNote);
        resetNote.hidden = !confirmReset;
        if (confirmReset) {
            resetNote.append(confirmReset, ' ',
                el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link', data: { resetAnyway: '' }, on: { click: () => resetAll(true) } }, 'Reset anyway'), ' ',
                el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link', data: { resetCancel: '' }, on: { click: () => { confirmReset = null; paint(); } } }, 'Cancel'));
        }
        resetAllBtn.disabled = isDefault(recipe);
    }

    /** Who uses what, as text: the rows are painted again only when it changed. */
    const usageNow = () => JSON.stringify([getInUse(), getLayersInUse()]);
    let usageShown = '';

    const pop = createPopover({ anchor: button, name: 'methods', title: label, wide: true,
        render: (body) => {
            confirmReset = null;
            paint();
            usageShown = usageNow();
            body.append(content);
            return () => { content.remove(); };
        } });

    paint();

    return {
        /** The toolbar button ("Methods ▾"); it opens and closes the pop-over. */
        button,
        paint,
        /** The score's state changed (each progress frame says so): repainted only when who uses what did. */
        paintUsage() {
            if (destroyed) return;
            const now = usageNow();
            if (now === usageShown) return;
            usageShown = now;
            paint();
        },
        open: () => { if (!destroyed && !pop.isOpen()) pop.open(); },
        close: () => { if (pop.isOpen()) pop.close(); },
        isOpen: () => pop.isOpen(),
        destroy() {
            destroyed = true;
            pop.destroy();
        },
        /** For tests: the pop-over's content (in the surface while open) and the state. */
        content,
        state: () => ({ open: pop.isOpen(), lastClip, confirmReset })
    };
}
