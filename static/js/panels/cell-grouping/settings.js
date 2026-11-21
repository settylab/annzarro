/**
 * The Settings row of a Cell Grouping (UX 2.1 zone 5, UX 2.5, SHR-9, SHR-12): the separator between level labels,
 * the small-group threshold and what happens to small groups (keep, collect into "Small groups (under 10 cells)",
 * hide): their stored form, the collapsed row's text and the entries refused. Pure; the row itself is drawn by
 * panels/cell-grouping.js. Every change is one undoable step of the panel; the separator changes no number, so it
 * asks for nothing (GRP-8).
 */
import { VOCABULARY } from '../../utils/vocabulary.js';

const DEFAULT_SEPARATOR = ' | ';
const DEFAULT_SMALL = Object.freeze({ threshold: 10, mode: 'keep' });
const MODE_WORD = Object.freeze({ keep: 'kept', collect: 'collected', hide: 'hidden' });

/** The small-group setting with its defaults filled in. */
export function smallOf(recipe) {
    return { ...DEFAULT_SMALL, ...(recipe.small || {}) };
}

/** The separator, the default when none is stored. */
export function separatorOf(recipe) {
    return recipe.separator === undefined ? DEFAULT_SEPARATOR : recipe.separator;
}

/** A separator as the recipe stores it: the default is not written. */
export function storedSeparator(text) {
    return text === DEFAULT_SEPARATOR ? undefined : text;
}

/** A small-group setting as the recipe stores it: defaults left out, nothing at all when both are the default. */
export function storedSmall(small) {
    const out = {};
    if (small.threshold !== DEFAULT_SMALL.threshold) out.threshold = small.threshold;
    if (small.mode !== DEFAULT_SMALL.mode) out.mode = small.mode;
    return Object.keys(out).length ? out : undefined;
}

/** What a mode does to small groups, as the summary says it: kept, collected, hidden. */
export function smallModeWord(mode) {
    return MODE_WORD[mode] || mode;
}

/** The collapsed row: 'Separator " | " · small groups under 10 cells kept'. */
export function settingsSummary(recipe) {
    const small = smallOf(recipe);
    return `Separator "${separatorOf(recipe)}" · ${VOCABULARY.word.smallGroup}s under ${small.threshold} cells ${smallModeWord(small.mode)}`;
}

/** Why a typed threshold cannot be used, or null. */
export function thresholdProblem(text) {
    const s = String(text).trim();
    return /^\d+$/.test(s) && Number(s) >= 1 ? null : 'Enter a whole number of cells, 1 or more.';
}

/** Why a typed separator cannot be used, or null. */
export function separatorProblem(text) {
    return String(text).length ? null : 'A separator needs at least one character.';
}
