/**
 * A consumer that names one group of a grouping: a count plot's set "Group of a grouping", later a group-stat column
 * (SHR-8, SHR-38, UX 2.8). The reference is stored as `{group, groupWas, follow?}` (plan 1.6): the group's key, the
 * DEFAULT label of each of its levels when last seen, and whether it follows its key.
 *
 *   ok        the key is a group and its default labels are those stored; or they differ and the reference follows,
 *             and `update` is the reference to store, silently, with no history step
 *   changed   the key is a group and its default labels differ: the consumer keeps drawing that key and says so
 *   gone      the key is no longer a group
 *
 * Default labels are compared, so a rename of a level, the separator and the " (2)" of two groups with one name are
 * never a change. A change is said once (N10): the sentence stays while the change lasts, a name toggled back to the
 * stored one clears it silently, and a name already reported this session shows only the tag. `seen` is the caller's
 * memory of that for the session: a Map, empty at first, kept per consumer.
 *
 * The labelled groups (`labelledGroups`) are made once per reply; a resolve is then a lookup, so it may run on every
 * paint. Pure, so Node tests cover it.
 */
import { groupLabels } from './cell-grouping.js';
import { canonKey } from './level-id.js';

const DEFAULT_SEPARATOR = ' | ';

const TAG = Object.freeze({ changed: 'Group changed', gone: 'No longer a group' });
const ACTION = Object.freeze({
    keep: Object.freeze({ id: 'keep', label: 'Keep' }),
    chooseAnother: Object.freeze({ id: 'chooseAnother', label: 'Choose another' }),
    keepAll: Object.freeze({ id: 'keepAll', label: 'Keep all' }),
    review: Object.freeze({ id: 'review', label: 'Review' })
});

/**
 * Each group of a reply by its key, with its default labels: what a reference is resolved against. O(groups): make
 * it once per reply (utils/group-sources.js `labelsOf` memoises it).
 * @param {Object} recipe - from normalizeGrouping
 * @param {Object} reply - the reply as the browser reads it
 * @param {(source: Object) => (string|undefined)} [titleOf] - the title of the panel behind a source
 * @returns {{byKey: Map<string, string[]>, separator: string}}
 */
export function labelledGroups(recipe, reply, titleOf) {
    const byKey = new Map();
    for (const { key, labels } of groupLabels(recipe, reply, titleOf)) byKey.set(canonKey(key), labels);
    return { byKey, separator: recipe.separator === undefined ? DEFAULT_SEPARATOR : recipe.separator };
}

const sameLabels = (a, b) => a.length === b.length && a.every((text, i) => text === b[i]);

/**
 * A reference to a group the user picked: the key and its default labels now, not following.
 * @param {{byKey: Map<string, string[]>}} labelled - from labelledGroups
 * @param {string[]} key
 * @returns {{group: string[], groupWas: string[]}|null} null when the key is not a group
 */
// export-unused-ok: V1 writes the reference of a set "Group of a grouping"
export function referToGroup(labelled, key) {
    const labels = labelled.byKey.get(canonKey(key));
    return labels ? { group: [...key], groupWas: [...labels] } : null;
}

/**
 * Where a reference stands.
 * @param {{group: string[], groupWas: string[], follow?: boolean}} ref
 * @param {{byKey: Map<string, string[]>, separator: string}} labelled - from labelledGroups
 * @param {Map<string, {current: (string|null), say: boolean, reported: Set<string>}>} seen - the session's memory
 * @returns {{state: 'ok'|'changed'|'gone', was?: string, now?: string, update?: Object, say: boolean}}
 */
// export-unused-ok: V1 resolves each group set of a count plot (UX 4.6)
export function resolveGroup(ref, labelled, seen) {
    const id = canonKey(ref.group);
    const was = ref.groupWas.join(labelled.separator);
    const labels = labelled.byKey.get(id);
    if (!labels) return { state: 'gone', was, say: false };
    const memory = seen.get(id) || { current: null, say: false, reported: new Set() };
    seen.set(id, memory);
    if (sameLabels(labels, ref.groupWas)) {
        memory.current = null;
        return { state: 'ok', say: false };
    }
    if (ref.follow === true) {
        memory.current = null;
        return { state: 'ok', say: false, update: { group: [...ref.group], groupWas: [...labels], follow: true } };
    }
    const now = labels.join(labelled.separator);
    // one change lasts while its name does: said throughout when it is new, never when it was reported before
    if (memory.current !== now) {
        memory.current = now;
        memory.say = !memory.reported.has(now);
        memory.reported.add(now);
    }
    return { state: 'changed', was, now, say: memory.say };
}

/**
 * Keep (UX 2.8): the new labels, and following the key from now on.
 * @returns {{group: string[], groupWas: string[], follow: true}} the reference to store; the given one is not edited
 */
// export-unused-ok: V1's Keep and Keep all
export function keepGroup(ref, labelled) {
    const labels = labelled.byKey.get(canonKey(ref.group));
    return { group: [...ref.group], groupWas: labels ? [...labels] : [...ref.groupWas], follow: true };
}

/**
 * One line for several changes said at once (one subset toggle moves every bin): null for fewer than two.
 * @param {Array<{state: string, say: boolean}>} results - from resolveGroup
 * @returns {null|{count: number, text: string, actions: Array<{id: string, label: string}>}}
 */
// export-unused-ok: V1 sums up the group sets that changed
export function summariseChanges(results) {
    const count = results.filter((r) => r.state === 'changed' && r.say).length;
    if (count < 2) return null;
    return { count, text: `${count.toLocaleString('en-US')} groups have changed after the subset changed.`,
        actions: [ACTION.keepAll, ACTION.review] };
}

/**
 * What a consumer shows for one reference: the strip tag, the sentence (null when there is nothing to say now) and
 * the buttons. Null when the reference is ok.
 * @param {{state: string, was?: string, now?: string, say: boolean}} result - from resolveGroup
 * @param {string} groupingTitle
 * @returns {null|{tag: string, text: (string|null), actions: Array<{id: string, label: string}>}}
 */
// export-unused-ok: V1 paints a group set's tag and sentence
export function describeGroupReference(result, groupingTitle) {
    if (result.state === 'changed') {
        return { tag: TAG.changed, text: result.say ? `This group has changed: was '${result.was}', now '${result.now}'.` : null,
            actions: [ACTION.keep, ACTION.chooseAnother] };
    }
    if (result.state === 'gone') {
        return { tag: TAG.gone, text: `'${result.was}' is no longer a group of '${groupingTitle}'.`, actions: [ACTION.chooseAnother] };
    }
    return null;
}
