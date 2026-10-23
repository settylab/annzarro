/**
 * Paste to focus: what pasted text names.
 *
 * Pure: no page, no network. main.js listens to the document's `paste` event, calls
 * `matchRules` with the clipboard text and the rules (the policy keys
 * ui.paste_focus.rules / .enabled; annzarro/server/paste_focus.py), then looks the cell or gene
 * up in the open dataset and focuses it. The admin page's test box calls the same functions, so
 * what it shows is what a paste does.
 *
 * A rule is {pattern, dataset_match, enabled}: `pattern` a regular expression (JavaScript
 * flavour) whose named groups `cell`, `gene` and `dataset` carry the names, `dataset_match`
 * ("exact" | "prefix" | "contains", default "prefix") how the `dataset` group is compared with a
 * store's name without its extension. The rules run in order and the first that matches and
 * extracts a cell or a gene wins. With both groups the cell is tried first, then the gene.
 *
 * Patterns run here, in the page: the text is capped at MAX_TEXT characters, so a pattern that
 * backtracks badly slows only the tab of a user of that site.
 */

/** Pasted text longer than this is ignored. */
export const MAX_TEXT = 4096;
export const DATASET_MATCHES = ['exact', 'prefix', 'contains'];
/** Shown in the page when the policy gives no rules; the same as annzarro/server/paste_focus.py. */
export const DEFAULT_RULES = Object.freeze([Object.freeze({
    pattern: '^(?=(?<gene>\\S+)$)(?<cell>\\S+)$', dataset_match: 'prefix', enabled: true
})]);

/**
 * Compile one pattern.
 * @param {string} pattern
 * @returns {{regex: RegExp}|{error: string}}
 */
export function compilePattern(pattern) {
    if (typeof pattern !== 'string' || !pattern) return { error: 'The pattern is empty.' };
    try {
        const regex = new RegExp(pattern);
        // a group name the pattern does not use cannot be told from a mistake: the rule must name cell or gene
        const names = [...pattern.matchAll(/\(\?<([A-Za-z_$][\w$]*)>/g)].map(m => m[1]);
        if (!names.includes('cell') && !names.includes('gene')) return { error: 'Name a (?<cell>...) or a (?<gene>...) group.' };
        return { regex };
    } catch (e) {
        return { error: String((e && e.message) || e).replace(/^Invalid regular expression: /, '') };
    }
}

/**
 * Rules as the policy gives them, compiled; a disabled rule or one that does not compile is left
 * out (it stays in the list for the admin to fix, its index is kept).
 * @param {Array<Object>|null|undefined} rules
 * @returns {Array<{index: number, regex: RegExp, datasetMatch: string}>}
 */
export function compileRules(rules) {
    const out = [];
    (Array.isArray(rules) ? rules : []).forEach((rule, index) => {
        if (!rule || rule.enabled === false) return;
        const compiled = compilePattern(rule.pattern);
        if (compiled.error) return;
        const datasetMatch = DATASET_MATCHES.includes(rule.dataset_match) ? rule.dataset_match : 'prefix';
        out.push({ index, regex: compiled.regex, datasetMatch });
    });
    return out;
}

/**
 * What the policy values say: whether pasting is on, and the rules. A server with no policy gets
 * the default rule.
 * @param {(key: string, fallback?: *) => *} get - Policy.get
 */
export function pasteSettings(get) {
    const enabled = get('ui.paste_focus.enabled', true) !== false;
    const rules = get('ui.paste_focus.rules', undefined);
    return { enabled, rules: Array.isArray(rules) ? rules : DEFAULT_RULES.map(r => ({ ...r })) };
}

/**
 * The first rule that matches `text` and names a cell or a gene.
 * @param {string} text - the clipboard text
 * @param {Array<Object>} rules - policy rules (compiled here)
 * @returns {{rule: number, datasetMatch: string, cell: string, gene: string, dataset: string}|null}
 *   null for text longer than MAX_TEXT, empty text, or no rule that matches
 */
export function matchRules(text, rules) {
    if (typeof text !== 'string' || text.length > MAX_TEXT) return null;
    const trimmed = text.trim();
    if (!trimmed) return null;
    for (const rule of compileRules(rules)) {
        const m = rule.regex.exec(trimmed);
        if (!m) continue;
        const groups = m.groups || {};
        const cell = (groups.cell || '').trim();
        const gene = (groups.gene || '').trim();
        if (!cell && !gene) continue;
        return { rule: rule.index, datasetMatch: rule.datasetMatch, cell, gene, dataset: (groups.dataset || '').trim() };
    }
    return null;
}

/** A store's name without its folder and its extension: ".../BL_1697_spatial_annzarro.zarr" -> "BL_1697_spatial_annzarro". */
export function storeBase(pathOrName) {
    const base = String(pathOrName || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    return base.replace(/\.(zarr|h5ad)$/i, '');
}

/** Whether `wanted` names the store called `name` under `mode`. */
export function datasetNameMatches(wanted, name, mode = 'prefix') {
    if (!wanted || !name) return false;
    if (mode === 'exact') return name === wanted;
    if (mode === 'contains') return name.includes(wanted);
    return name.startsWith(wanted);
}

/**
 * Which dataset a `dataset` group refers to.
 * @param {string} wanted - the extracted text (may be empty)
 * @param {Array<{path: string, name?: string, error?: *}>} listing - the dataset listing
 * @param {string|null} currentPath - the open dataset
 * @param {string} mode
 * @returns {{kind: 'current'}|{kind: 'none'}|{kind: 'one', entry: Object}|{kind: 'many', entries: Object[]}}
 *   'current': it names the open dataset (also when others match as well); 'none': it names
 *   no dataset (or none was given), so the open dataset is tried
 */
export function resolveDataset(wanted, listing, currentPath, mode) {
    if (!wanted) return { kind: 'none' };
    if (currentPath && datasetNameMatches(wanted, storeBase(currentPath), mode)) return { kind: 'current' };
    const entries = (listing || []).filter(e => e && e.path && !e.error && e.path !== currentPath
        && datasetNameMatches(wanted, storeBase(e.name || e.path), mode));
    if (entries.length === 1) return { kind: 'one', entry: entries[0] };
    if (entries.length > 1) return { kind: 'many', entries };
    return { kind: 'none' };
}

/**
 * Whether a paste into `target` is the browser's own (a text field) and must be left alone.
 * @param {Element|null} target
 */
export function isTextTarget(target) {
    if (!target || typeof target.closest !== 'function') return false;
    if (target.isContentEditable) return true;
    return !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}
