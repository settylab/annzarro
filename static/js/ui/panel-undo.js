/**
 * Undo for a panel whose whole state is its stored config (the Cell Plot, the Gene Plot, the Cell Table, the Gene Table).
 *
 * The panels of 0.8.0 (Cell-Gene, Count, Grouping) keep their own steps, each a labelled recipe before a change they make
 * themselves. These panels have many places that change their config (a control, a table's header, a chooser, a filter), so
 * the helper does not wrap each: the panel says "something may have changed" (`observe`), and the helper compares the
 * stored config with the one it knew. A difference that nothing external explains is one step: the config as it was, with
 * a label. `undo` takes the last step off and re-applies that config through the panel's own path (`restore`), which is the
 * path a link or Back and Forward would take: what a config draws is the config's.
 *
 * Rules, the same for every panel:
 *  - A step is the config BEFORE a change. Changes of one kind closer together than `coalesceMs` (typing in a search box, a
 *    slider) are one step, whose config is the earliest.
 *  - The stack is per panel and per session, capped at `max` (50, as the new panels').
 *  - A change that arrives from outside (a link, a panel set, another panel's edit, Back and Forward) is not the user's step
 *    here: the panel calls `rebase()`, which forgets the steps and takes the config as it is now as the start, so Undo
 *    never jumps to a state unrelated to what is on screen. Back and Forward themselves are untouched: an undo is a change
 *    like any other to the address bar (the view is captured after it), so the entry it makes can be gone back from.
 *  - Nothing the panel does while `undo` restores a config is recorded.
 *
 * Usage:
 *   const undo = createPanelUndo({ snapshot: () => plainConfig(), restore: (config) => applyConfig(config) });
 *   undo.rebase();                          // once the panel is built: the config as it is is the start
 *   toolbar.append(undo.button());          // "Undo", disabled with nothing to undo, title "Undo: <label>"
 *   // after the user changed something (a control's handler, a debounced listener):  undo.observe('change the sort');
 *   // a config arrives from outside:  undo.rebase();
 *
 * Pure of the page (no DOM unless `button` is called), so Node tests cover it.
 */

/** The steps are at most this many, as the panels of 0.8.0 keep. */
// export-unused-ok: the Cell Plot and Gene Plot (WP-5b) and the tables wire it
export const UNDO_MAX = 50;
/** Changes of one kind closer than this are one step. */
// export-unused-ok: the Cell Plot and Gene Plot (WP-5b) and the tables wire it
export const UNDO_COALESCE_MS = 1500;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A label for a change from the keys that differ: `names` maps a config key to the words ("columns" -> "change the columns").
 * The first differing key with a name decides; with none named, "change <the first key>".
 * @param {Object} before
 * @param {Object} after
 * @param {Object<string, string>} names
 * @returns {string}
 */
// export-unused-ok: the Cell Plot and Gene Plot (WP-5b) and the tables wire it
export function labelByKeys(before, after, names = {}) {
    const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
    const changed = keys.filter((k) => !same((before || {})[k], (after || {})[k]));
    const named = changed.find((k) => names[k]);
    if (named) return names[named];
    return changed.length ? `change ${changed[0]}` : 'change';
}

/**
 * @param {Object} opts
 * @param {() => Object} opts.snapshot - the panel's stored config now, plain (JSON-able), without what is transient
 * @param {(config: Object) => (void|Promise<void>)} opts.restore - re-apply a config through the panel's own path
 * @param {number} [opts.max]
 * @param {number} [opts.coalesceMs]
 * @param {() => number} [opts.now] - the clock (tests)
 * @param {(before: Object, after: Object) => string} [opts.label] - a label for a change seen without one
 */
// export-unused-ok: the Cell Plot and Gene Plot (WP-5b) and the tables wire it
export function createPanelUndo({ snapshot, restore, max = UNDO_MAX, coalesceMs = UNDO_COALESCE_MS, now = Date.now, label = labelByKeys }) {
    const steps = [];                 // {label, before, at, kind}
    const listeners = new Set();
    let base = null;                  // the config as last known: the start of the next change
    let restoring = false;
    let buttons = [];

    // a button whose panel was replaced is no longer in the page: it is dropped, so the list does not grow with every replacement
    const tell = () => {
        for (const fn of listeners) fn();
        buttons = buttons.filter((b) => b.isConnected !== false);
        for (const b of buttons) paintButton(b);
    };
    const known = () => { if (base === null) base = snapshot(); return base; };
    // the config at the start, when the panel can say it already; a panel that cannot yet calls `rebase()` once it is built
    try { base = snapshot(); } catch { base = null; }

    function paintButton(b) {
        const step = steps[steps.length - 1];
        b.disabled = !step;
        const text = step ? `Undo: ${step.label}` : 'Nothing to undo';
        b.title = text;
        b.setAttribute('aria-label', step ? text : 'Undo');
    }

    const api = {
        /**
         * The panel says the user may have changed its config. A difference from the config last known is one step labelled
         * `text` (or by the helper's `label`); one of the same label soon after the last joins it.
         * @param {string} [text]
         * @returns {boolean} whether a change was recorded
         */
        observe(text) {
            if (restoring) return false;
            const was = known();
            const now_ = snapshot();
            if (same(was, now_)) return false;
            const words = text || label(was, now_);
            const at = now();
            const last = steps[steps.length - 1];
            if (last && last.label === words && at - last.at <= coalesceMs) last.at = at;
            else {
                steps.push({ label: words, before: was, at });
                if (steps.length > max) steps.shift();
            }
            base = now_;
            tell();
            return true;
        },

        /**
         * Undo the last step: its config is re-applied through `restore`, and becomes the config known.
         * @returns {Promise<boolean>} false when there was nothing to undo
         */
        async undo() {
            const step = steps.pop();
            if (!step) return false;
            restoring = true;
            try {
                await restore(JSON.parse(JSON.stringify(step.before)));
            } finally {
                restoring = false;
                base = snapshot();
                tell();
            }
            return true;
        },

        /**
         * A change the panel made on its own as part of the step before it (a default it fills in when what it waited for
         * arrives): the config as it is now is the one known, so it is not a step of its own.
         */
        absorb() {
            if (restoring) return;
            base = snapshot();
        },

        /** A config arrived from outside: the steps are forgotten and the config as it is now is the start. */
        rebase() {
            steps.length = 0;
            base = snapshot();
            tell();
        },

        /** Whether `undo` is running: what the panel does meanwhile is not a change to record. */
        get restoring() { return restoring; },
        get canUndo() { return steps.length > 0; },
        get size() { return steps.length; },
        /** "Undo: <label>", or "Nothing to undo". */
        get title() { const s = steps[steps.length - 1]; return s ? `Undo: ${s.label}` : 'Nothing to undo'; },
        peek() { return steps.length ? { label: steps[steps.length - 1].label, before: steps[steps.length - 1].before } : null; },

        /** `fn` runs whenever the steps change (a button, a test). Returns what stops it. */
        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

        /**
         * An "Undo" button kept in step with the stack: disabled when empty, titled "Undo: <label>". The panel puts it in its
         * control row, with the class of the Undo buttons of the 0.8.0 panels (`btn btn-sm btn-outline-secondary`).
         * @param {{document?: Document, className?: string, text?: string}} [opts]
         * @returns {HTMLButtonElement}
         */
        button({ document: doc = globalThis.document, className = 'btn btn-sm btn-outline-secondary panel-undo', text = 'Undo' } = {}) {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = className;
            b.textContent = text;
            b.addEventListener('click', () => { api.undo(); });
            buttons.push(b);
            paintButton(b);
            return b;
        },

        destroy() { steps.length = 0; listeners.clear(); buttons = []; }
    };
    return api;
}
