/**
 * The settings adapter of the Cell Plot and the Gene Plot (pop-over unification U3; design note popover-unify-080 section 3):
 * what the shared Plot Options renderer (options-popover.js) needs of a panel that keeps its look on a mutable settings
 * object at keys of its own (aesthetics-kinds.js), rather than a configuration it replaces.
 *
 * `commit(next, label)` takes the configuration the renderer worked out (a copy of the settings with one field, or one
 * section's fields, changed) and, for every field whose value differs from the settings now:
 *   1. writes `settings[key]` (or deletes it), then lets `initialize` fill the defaults the plot stores (a value at its
 *      default is absent in `next`, but these plots have always kept it);
 *   2. runs the field's apply hook (`hooks[field.id]`: the plot's existing update function), once per hook;
 *   3. notifies `plotSettingsChanged` (Undo and the menu listen), one event per field;
 *   4. takes the plot off Default when the look changed (`styleDefault` true becomes false), as the menu always did.
 * A reset or a preset (the label says so) draws the plot from its settings in one go (`relook`) instead of
 * running each hook. There is no undo step of its own: plot-undo.js observes the settings.
 *
 * Pure: no DOM and no Plotly (everything that touches the plot is passed in), so annzarro/tests/js holds it in Node.
 */
import { fieldsOf, readField } from './options-schema.js';

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/**
 * @param {Object} o
 * @param {string} o.kind - 'cell-plot' or 'gene-plot'
 * @param {Object} o.settings - the panel's settings, written in place
 * @param {Object<string, (settings: Object) => *>} o.hooks - apply hook by field id
 * @param {(settings: Object) => void} o.initialize - fills the defaults the plot stores
 * @param {(settings: Object) => void} o.relook - draws the plot from its settings
 * @param {(setting: string, value: *) => void} o.notify - one `plotSettingsChanged`
 * @returns {{config: () => Object, commit: (next: Object, label: string) => string[]}}
 */
export function createSettingsAdapter({ kind, settings, hooks, initialize, relook, notify }) {
    return {
        config: () => settings,
        commit(next, label = '') {
            const changed = fieldsOf(kind).filter((f) => f.path && !f.element
                && !same(readField(next, f, kind), readField(settings, f, kind)));
            const was = settings.styleDefault === true;
            for (const f of changed) {
                if (next[f.path] === undefined) delete settings[f.path];
                else settings[f.path] = clone(next[f.path]);
            }
            initialize(settings);
            // a look of its own, whatever the default is (the renderer drops `styleDefault` from `next` for a look field)
            if (was && next.styleDefault === undefined) settings.styleDefault = false;
            if (!changed.length) return [];
            const whole = /^(reset|preset)/.test(label);
            if (whole) relook(settings);
            else {
                const ran = new Set();
                for (const f of changed) {
                    const hook = hooks[f.id];
                    if (!hook || ran.has(hook)) continue;
                    ran.add(hook);
                    hook(settings);
                }
            }
            if (whole && /^reset/.test(label)) notify(label, null);
            else for (const f of changed) notify(f.id, readField(settings, f, kind));
            return changed.map((f) => f.id);
        }
    };
}
