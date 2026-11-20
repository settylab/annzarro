/**
 * The "Scores offered" section of the Gene Signature panel: what the signature offers plots and tables, and how each
 * option is computed. A plot or table only picks from what is offered; the model is utils/signature-options.js (the
 * signature's method table over utils/options-model.js) and the rows, layers, undo and reset are the shared
 * offered-section.js. This file adds what only the signature has: the clip, the control-adjusted and detection
 * parameters, and up and down genes.
 *
 * Every setting is part of the recipe (link, panel set, score key). A number is checked on Enter or on leaving the box:
 * an invalid one keeps the last valid value and says what is expected. Nothing here computes.
 *
 * `makeDom(document)` and the callbacks are injected, so the section touches no page state of its own.
 */
import { createOfferedSection } from './offered-section.js';
import {
    BINS_RANGE, CONTROLS_RANGE, DEFAULT_BINS, DEFAULT_CLIP, DEFAULT_CONTROLS, DEFAULT_DOWN_WEIGHT, DEFAULT_INPUT, DEFAULT_SEED,
    cleanDownWeight, directionFormula, downDefinition, parseClipText, parseSeedText, parseThresholdText, parseWholeText
} from '../../utils/gene-signature.js';
import {
    DOWN_WEIGHT_WORDS, SIGNATURE_MODEL as model, WEIGHTED_METHODS, canScoreDown, offeredMethods, clipLine, downWeightLine, thresholdLine
} from '../../utils/signature-options.js';

/** The help texts, so the page and its tests say the same thing. The sentences that state a setting are functions of it (signature-options.js). */
export const SCORING_HELP = Object.freeze({
    where: 'Plots and tables pick from these. Nothing is computed until a plot or table shows it.',
    seed: 'The same seed gives the same control genes, so the same score.',
    layers: 'Plots and tables choose among the offered layers.',
    lastLayer: 'At least one layer stays offered.',
    lastMethod: 'At least one option stays offered.',
    downWeight: 'Down genes',
    downWeightGene: DOWN_WEIGHT_WORDS.gene,
    downWeightSide: DOWN_WEIGHT_WORDS.side,
    downWeightWhy: 'Control-adjusted takes each side minus its own controls, so each side always weighs equally.'
});

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
 * @param {() => void} [options.onKinds] - what a layer looks like became known: menus may change
 * @param {{countAsUp: () => void}|null} [options.directions] - the source can score genes as down (a signature can, a gene
 *   table cannot): the section then has the switch "Score some genes as down" and the formula. `countAsUp` moves every
 *   down gene to up as one undoable step, for the switch turned off while down genes exist.
 */
export function createScoringSection({ D, id, getRecipe, apply, getInputs, getKind, getInUse = () => [],
    getLayersInUse = () => [], onKinds = () => {}, directions = null }) {
    const { el } = D;
    const sid = (x) => `gsig-scoring-${x}-${id}`;
    let lastClip = DEFAULT_CLIP;
    let askOff = false;                 // turned off while down genes exist: the question is in place
    let boxes = {};
    let section = null;
    const paint = (force) => section.paint(force);

    // ------------------------------------------------------------ numbers
    // The boxes are made afresh each time the rows are painted: a box that is typed in is never moved or removed
    // while it holds the focus (that would fire its blur in the middle of the removal).

    function makeBoxes({ numberBox }) {
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
            el('span', { class: 'gsig-scoring__help', data: { detectHelp: '' } }))
    };

    // ------------------------------------------------------------ direction

    // Score some genes as down: only for a source that can have down genes. Off by default, so nothing about direction shows.
    const dirBox = directions ? el('input', { type: 'checkbox', class: 'gsig-scoring__offer', id: sid('directions'),
        data: { directions: '' }, on: { change: () => onDirectionSwitch(dirBox.checked) } }) : null;
    const dirHint = directions ? el('div', { class: 'gsig-scoring__help' }) : null;
    const dirFormula = directions ? el('div', { class: 'gsig-scoring__help', data: { directionFormula: '' } }) : null;
    const dirAsk = directions ? el('div', { class: 'gsig-scoring__notice', role: 'status', hidden: true, data: { directionAsk: '' } }) : null;
    const dirBlock = directions ? el('div', { class: 'gsig-scoring__direction', data: { directionBlock: '' } },
        el('div', { class: 'gsig-scoring__optionhead' }, dirBox,
            el('label', { for: sid('directions'), class: 'gsig-scoring__optionname', text: 'Score some genes as down' })),
        dirHint, dirFormula, dirAsk) : null;

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
        const signed = offeredMethods(recipe).some(canScoreDown);
        dirFormula.textContent = [directionFormula(recipe),
            n && !signed ? 'None of the offered methods can score down genes. Offer z-score mean, mean or control-adjusted.' : ''].filter(Boolean).join(' ');
        dirFormula.hidden = !dirFormula.textContent;
        dirHint.textContent = downWeightLine(recipe.down_weight);
        dirHint.hidden = !dirFormula.hidden;               // the formula with its numbers says it better than the hint
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

    /** "Down genes: (o) each gene weighs equally ( ) each side weighs equally", the same setting under each method it applies to. */
    function weightControl(recipe, method) {
        const now = cleanDownWeight(recipe.down_weight);
        const group = `gsig-dw-${id}-${method}`;
        const radio = (value, text) => {
            const input = el('input', { type: 'radio', name: group, id: sid(`dw-${method}-${value}`), checked: now === value,
                data: { downWeight: value }, on: { change: () => { if (input.checked) { apply({ down_weight: value }); paint(); } } } });
            return el('label', { class: 'gsig-scoring__field', for: sid(`dw-${method}-${value}`) }, input, ` ${text}`);
        };
        return el('div', { class: 'gsig-scoring__params', role: 'radiogroup', aria: { label: SCORING_HELP.downWeight }, data: { weighting: method } },
            el('span', { text: `${SCORING_HELP.downWeight}: ` }), radio('gene', SCORING_HELP.downWeightGene), radio('side', SCORING_HELP.downWeightSide));
    }

    // ------------------------------------------------------------ parameters

    function resetMethod(method) {
        const patch = { ...model.paramDefaults[method] };
        if (method === 'zscore_mean') lastClip = DEFAULT_CLIP;
        apply(patch);
    }

    /** Fill the parameter boxes (not the one being typed in) and state each setting in force. */
    function paintParams(recipe, element) {
        const clipOn = recipe.clip !== null;
        if (clipOn) lastClip = recipe.clip;
        const focused = element.ownerDocument.activeElement;
        const set = (box, value) => { if (focused !== box.input) box.input.value = String(value); };
        set(boxes.clip, clipOn ? recipe.clip : lastClip);
        set(boxes.bins, recipe.bins);
        set(boxes.controls, recipe.controls);
        set(boxes.seed, recipe.seed === null ? DEFAULT_SEED : recipe.seed);
        set(boxes.detect, recipe.detect_above);
        boxes.clipBox.checked = clipOn;
        boxes.clip.input.disabled = !clipOn;
        const help = element.querySelector('[data-clip-help]');
        if (help) help.textContent = clipLine(recipe.clip);
        const detectHelp = element.querySelector('[data-detect-help]');
        if (detectHelp) detectHelp.textContent = thresholdLine(recipe.detect_above);
    }

    section = createOfferedSection({
        D, id, model, title: 'Scores offered', text: SCORING_HELP, getRecipe, apply, getInputs, getKind, getInUse, getLayersInUse, onKinds,
        hooks: {
            bodyBlocks: dirBlock ? [dirBlock] : [],
            makeParams: makeBoxes,
            paramBlock: (method) => (params[method] ? params[method]() : null),
            resetMethod,
            definition: (recipe, info) => (recipe.directions ? { text: downDefinition(recipe, info.value), signed: true } : null),
            methodExtras: (recipe, info) => {
                const out = [];
                if (recipe.directions && info.value === 'control_adjusted') {
                    out.push(el('div', { class: 'gsig-scoring__help', data: { downWeightWhy: '' }, text: SCORING_HELP.downWeightWhy }));
                }
                if (recipe.directions && WEIGHTED_METHODS.includes(info.value)) out.push(weightControl(recipe, info.value));
                return out;
            },
            paintExtras: paintDirection,
            paintParams,
            resetPatch: () => {
                lastClip = DEFAULT_CLIP;
                return { input: DEFAULT_INPUT, clip: DEFAULT_CLIP, seed: null, bins: DEFAULT_BINS, controls: DEFAULT_CONTROLS, detect_above: 0,
                    ...(directions ? { down_weight: DEFAULT_DOWN_WEIGHT } : {}) };
            },
            paramsAreDefault: (recipe) => recipe.clip === DEFAULT_CLIP && (recipe.seed === null || recipe.seed === DEFAULT_SEED)
                && recipe.bins === DEFAULT_BINS && recipe.controls === DEFAULT_CONTROLS && recipe.detect_above === 0
                && (!recipe.down_weight || recipe.down_weight === DEFAULT_DOWN_WEIGHT)
        }
    });

    return {
        ...section,
        /** For tests. */
        state: () => ({ ...section.state(), lastClip })
    };
}
