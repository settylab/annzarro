/**
 * The Scoring section of the Gene Signature panel: the settings a signature shares with every score made from
 * it. The section edits those only (the input matrix, the clip of z-scores, the seed of the control genes);
 * how the genes are combined is chosen where the score is used, in the plot or the table.
 *
 * Collapsed, it is one row that states the settings in use (the line above it states the whole definition), so a
 * link opened with other settings is never hidden. Expanded:
 *
 *   Input    [ X                v ]   the matrix the scores read
 *            warning when it looks like raw counts (also shown with the section collapsed)
 *   Clip     [x] Clip z-scores at ± [ 10 ]   One rare gene can otherwise dominate the average.
 *   Seed     [ 0 ]                          Picks the control genes of a control-adjusted score.
 *                                      [ Reset to defaults ]
 *
 * Every setting is part of the recipe: it goes into the link, the panel set and the score's key. A number is
 * checked when it is entered (Enter or leaving the box): an invalid one keeps the last valid value and says
 * what is expected. Nothing here computes; the page applies the edit to plots and tables by the rules for
 * recipe edits (live when quick, behind **Update score** from 5 seconds).
 *
 * `makeDom(document)` and the callbacks are injected, so the section touches no page state of its own.
 */
import { DEFAULT_CLIP, DEFAULT_INPUT, DEFAULT_SEED, DEFAULT_METHOD, settingsText, parseClipText, parseSeedText } from '../utils/gene-signature.js';
import { warningFor } from '../utils/matrix-kind-client.js';

/** The help texts, so the page and its tests say the same thing. */
export const SCORING_HELP = Object.freeze({
    input: 'The matrix the scores are read from. Scores are meant for normalised, log-transformed values.',
    clip: 'One rare gene can otherwise dominate the average. Only the z-score mean uses this.',
    clipOff: 'Not clipped: one rare gene can dominate the average. Only the z-score mean uses this.',
    seed: 'Picks the control genes of a control-adjusted score: the same seed gives the same score.'
});

/**
 * @param {Object} options
 * @param {{el: Function, clear: Function}} options.D - the DOM builder (panels/gene-set-utilities/dom.js)
 * @param {string} options.id - the panel's id, for unique element ids
 * @param {() => Object} options.getRecipe - the signature's recipe now
 * @param {(patch: Object) => void} options.apply - make `patch` (keys of a recipe) part of the recipe
 * @param {() => Promise<string[]>} options.getInputs - the matrices a score can read, X first
 * @param {(input: string) => Promise<(Object|null)>} options.getKind - what an input looks like (matrix-kind-client.js)
 * @returns {{element: HTMLElement, warning: HTMLElement, paint: () => void, refreshInputs: () => Promise<void>, refreshKind: () => Promise<void>, destroy: () => void, state: () => Object}}
 */
export function createScoringSection({ D, id, getRecipe, apply, getInputs, getKind }) {
    const { el } = D;
    const sid = (x) => `gsig-scoring-${x}-${id}`;
    let open = false;
    let inputs = [DEFAULT_INPUT];
    let lastClip = DEFAULT_CLIP;
    let warning = null;                 // {kind, text, suggest} for the input shown, or null
    let destroyed = false;
    let kindToken = 0;

    const toggle = el('button', { type: 'button', class: 'gsig-scoring__toggle', id: sid('toggle'),
        aria: { expanded: 'false', controls: sid('body') }, on: { click: () => { open = !open; paint(); } } });
    const caret = el('span', { class: 'gsig-scoring__caret', aria: { hidden: 'true' } }, '▸');
    const label = el('span', { class: 'gsig-scoring__label', text: 'Scoring' });
    const summary = el('span', { class: 'gsig-scoring__summary', id: sid('summary') });
    toggle.append(caret, ' ', label, ' ', summary);

    const select = el('select', { class: 'form-select form-select-sm gsig-scoring__input', id: sid('input'),
        aria: { describedby: sid('input-help') }, on: { change: () => apply({ input: select.value }) } });
    const inputHelp = el('div', { class: 'gsig-scoring__help', id: sid('input-help'), text: SCORING_HELP.input });
    const inputWarning = el('div', { class: 'gsig-inputwarn gsig-inputwarn--inline', role: 'status', hidden: true,
        data: { inputWarning: 'inline' } });

    const clipBox = el('input', { type: 'checkbox', class: 'gsig-scoring__clipbox', id: sid('clipbox'),
        on: { change: () => apply({ clip: clipBox.checked ? lastClip : null }) } });
    const clipInput = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
        class: 'form-control form-control-sm gsig-scoring__number', id: sid('clip'),
        aria: { label: 'Clip z-scores at plus and minus this value', describedby: `${sid('clip-help')} ${sid('clip-error')}` },
        on: { input: () => check(clipInput, parseClipText, clipError), change: () => commitNumber(clipInput, parseClipText, clipError, 'clip') } });
    const clipError = el('div', { class: 'gsig-scoring__error', id: sid('clip-error'), role: 'alert', hidden: true });
    const clipHelp = el('div', { class: 'gsig-scoring__help', id: sid('clip-help') });

    const seedInput = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false',
        class: 'form-control form-control-sm gsig-scoring__number', id: sid('seed'),
        aria: { describedby: `${sid('seed-help')} ${sid('seed-error')}` },
        on: { input: () => check(seedInput, parseSeedText, seedError), change: () => commitNumber(seedInput, parseSeedText, seedError, 'seed') } });
    const seedError = el('div', { class: 'gsig-scoring__error', id: sid('seed-error'), role: 'alert', hidden: true });
    const seedHelp = el('div', { class: 'gsig-scoring__help', id: sid('seed-help'), text: SCORING_HELP.seed });

    const reset = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary gsig-scoring__reset',
        on: { click: resetAll } }, 'Reset to defaults');

    const row = (name, forId, ...cells) => el('div', { class: 'gsig-scoring__row' },
        el('label', { class: 'gsig-scoring__name', for: forId, text: name }), el('div', { class: 'gsig-scoring__field' }, ...cells));
    const body = el('div', { class: 'gsig-scoring__body', id: sid('body'), hidden: true },
        row('Input', sid('input'), select, inputWarning, inputHelp),
        row('Clip', sid('clip'),
            el('div', { class: 'gsig-scoring__inline' }, clipBox, el('label', { for: sid('clipbox'), text: 'Clip z-scores at ±' }), clipInput),
            clipError, clipHelp),
        row('Seed', sid('seed'), seedInput, seedError, seedHelp),
        el('div', { class: 'gsig-scoring__actions' }, reset));

    // the warning in the status zone: seen with the section collapsed
    const warningLine = el('div', { class: 'gsig-inputwarn', role: 'status', hidden: true, data: { inputWarning: 'status' } });

    const element = el('section', { class: 'gsig-scoring', aria: { label: 'Scoring' } }, toggle, body);

    function check(input, parse, errorEl) {
        const parsed = parse(input.value);
        input.classList.toggle('is-invalid', !parsed.ok);
        errorEl.hidden = parsed.ok;
        errorEl.textContent = parsed.ok ? '' : parsed.error;
        return parsed;
    }

    /** On Enter or leaving the box: a valid number is applied; an invalid one is put back as it was, with the reason. */
    function commitNumber(input, parse, errorEl, key) {
        const parsed = parse(input.value);
        if (!parsed.ok) {
            const message = parsed.error;
            paint();                                   // the last valid value comes back
            errorEl.hidden = false;
            errorEl.textContent = message;
            return;
        }
        errorEl.hidden = true;
        input.classList.remove('is-invalid');
        const current = getRecipe();
        if (key === 'clip') {
            lastClip = parsed.value;
            if (current.clip !== parsed.value) apply({ clip: parsed.value });
        } else if (current.seed !== parsed.value) {
            apply({ seed: parsed.value });
        }
        paint();
    }

    function resetAll() {
        lastClip = DEFAULT_CLIP;
        apply({ input: DEFAULT_INPUT, clip: DEFAULT_CLIP, seed: null, method: DEFAULT_METHOD });
    }

    function isDefault(recipe) {
        return recipe.input === DEFAULT_INPUT && recipe.clip === DEFAULT_CLIP && (recipe.seed === null || recipe.seed === DEFAULT_SEED)
            && recipe.method === DEFAULT_METHOD;
    }

    function paintInputs(recipe) {
        D.clear(select);
        const names = inputs.includes(recipe.input) ? inputs : [...inputs, recipe.input];
        for (const name of names) {
            const missing = !inputs.includes(name);
            select.append(el('option', { value: name, selected: name === recipe.input,
                text: missing ? `${name} (not in this dataset)` : name === 'X' ? 'X' : name }));
        }
        select.value = recipe.input;
    }

    function paintWarning() {
        for (const node of [warningLine, inputWarning]) {
            D.clear(node);
            node.hidden = !warning;
        }
        // one copy at a time: in the section when it is open, else in the status zone
        warningLine.hidden = !warning || open;
        inputWarning.hidden = !warning || !open;
        if (!warning) return;
        for (const node of [warningLine, inputWarning]) {
            node.dataset.kind = warning.kind;
            node.append(el('span', { text: warning.text }));
            if (warning.suggest) {
                node.append(' ', el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link', data: { useInput: warning.suggest },
                    on: { click: () => apply({ input: warning.suggest }) } }, `Use ${warning.suggest}`));
            }
        }
    }

    function paint() {
        if (destroyed) return;
        const recipe = getRecipe();
        summary.textContent = settingsText(recipe);
        toggle.setAttribute('aria-expanded', String(open));
        caret.textContent = open ? '▾' : '▸';
        body.hidden = !open;
        paintInputs(recipe);
        const clipOn = recipe.clip !== null;
        if (clipOn) lastClip = recipe.clip;
        clipBox.checked = clipOn;
        clipInput.disabled = !clipOn;
        if (element.ownerDocument.activeElement !== clipInput) clipInput.value = String(clipOn ? recipe.clip : lastClip);
        clipInput.classList.remove('is-invalid');
        clipHelp.textContent = clipOn ? SCORING_HELP.clip : SCORING_HELP.clipOff;
        if (element.ownerDocument.activeElement !== seedInput) seedInput.value = String(recipe.seed === null ? DEFAULT_SEED : recipe.seed);
        seedInput.classList.remove('is-invalid');
        reset.disabled = isDefault(recipe);
        paintWarning();
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

    /** Ask what the input now chosen looks like; the answer for an input chosen since is dropped. */
    async function refreshKind() {
        const mine = ++kindToken;
        const input = getRecipe().input;
        let reply = null;
        try {
            reply = await getKind(input);
        } catch {
            reply = null;
        }
        if (destroyed || mine !== kindToken || getRecipe().input !== input) return;
        warning = reply ? warningFor(reply) : null;
        paintWarning();
    }

    return {
        element,
        warning: warningLine,
        paint,
        refreshInputs,
        refreshKind,
        destroy() { destroyed = true; },
        /** For tests. */
        state: () => ({ open, inputs: [...inputs], warning, lastClip })
    };
}
