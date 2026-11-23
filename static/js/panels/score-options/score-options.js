/**
 * The score options of a source of a gene score, as one component: the Methods pop-over (methods-popover.js) and what
 * each layer looks like, wired to the page. A Gene Signature panel and a Gene Table panel both use it, so the pop-over,
 * its options model (utils/signature-options.js), the kind of each layer and the way an edit reaches plots and tables
 * are the same code for both; a panel supplies only where its option fields live.
 *
 *   const options = createScoreOptions({ id, D, getOptions, setOptions });
 *   toolbar.append(options.methods.button);             // Methods ▾
 *
 * `getOptions()` returns the option fields (a signature passes its whole recipe, which has them); `setOptions(patch)`
 * stores a patch of them and repaints the panel's own parts. This component then tells the plots and tables that read
 * the score (an edit is applied at once when the score is cheap and collected behind Update score when it is not,
 * utils/score-sources.js) and the saved state.
 *
 * Decision 31: nothing is "offered". A consumer chooses any method on any layer, graded by what each layer looks like
 * (`getGrading`), so the kind of EVERY layer of the dataset is asked once, without alternatives, for the whole page.
 */
import { DataManager } from '../../data-manager.js';
import { Config } from '../../config.js';
import { createKindClient } from '../../utils/matrix-kind-client.js';
import { layerKeys } from '../../utils/structure-keys.js';
import { aggregationsInUse, layersInUse, onSourceStatus, sourceChanged, sourceRenamed } from '../../utils/score-source.js';
import { METHODS, offeredOptions } from '../../utils/signature-options.js';
import { createMethodsPopover } from './methods-popover.js';

/** What the layers look like, asked once per dataset and layer for the whole page. */
export const KIND_CLIENT = createKindClient({ url: Config.API.MATRIX_KIND });

/**
 * Every method on every layer that can be computed, as the menus that still list combinations read them
 * (utils/score-source.js scoreOptions). Nothing is offered or withheld (decision 31); SO-3 removes this with those menus.
 * @param {Object} fields - the source's option fields
 * @param {string[]} [layers] - the dataset's layers; the source's own layer when not known
 * @param {{kinds?: Object, stats?: Object}} [grading]
 */
export function everyOption(fields, layers, { kinds = {}, stats = {} } = {}) {
    const list = Array.isArray(layers) && layers.length ? layers : [fields.input || 'X'];
    return offeredOptions({ ...fields, offered: [...METHODS], layers: list }, null, kinds, stats);
}

/**
 * @param {Object} o
 * @param {string} o.id - the panel's id
 * @param {{el: Function, clear: Function}} o.D - the DOM builder
 * @param {() => Object} o.getOptions - the option fields now
 * @param {(patch: Object) => void} o.setOptions - store a patch of option fields and repaint the panel
 * @param {string} [o.label] - the pop-over button's text ("Methods"; a gene table says "Score methods")
 * @param {boolean} [o.directions] - a source whose genes can be up or down (a signature, not a table)
 */
export function createScoreOptions({ id, D, getOptions, setOptions, label = 'Methods', directions = false }) {
    let destroyed = false;
    let layers = [];
    const kinds = new Map();            // layer -> what it looks like
    const stats = new Map();            // layer -> what the server sampled of it (the share above a threshold follows from it)
    const asked = new Map();            // layer -> token of the question in flight

    function apply(patch) {
        setOptions(patch);
        sourceChanged(id, Object.keys(patch));
        if (window.sessionManager && typeof window.sessionManager.notifyPanelUpdate === 'function') {
            window.sessionManager.notifyPanelUpdate();
        }
    }

    const methods = createMethodsPopover({
        D, id, label, getRecipe: getOptions, apply, directions,
        getInUse: () => aggregationsInUse(id), getLayersInUse: () => layersInUse(id)
    });
    // a plot or table began or stopped reading the score: the pop-over says who uses what
    const unwatch = onSourceStatus(id, () => methods.paintUsage());

    async function askKind(layer) {
        const mine = (asked.get(layer) || 0) + 1;
        asked.set(layer, mine);
        let reply;
        try {
            reply = await KIND_CLIENT.kind(DataManager.getCurrentDataset(), layer, { suggest: false });
        } catch {
            reply = null;
        }
        if (destroyed || asked.get(layer) !== mine) return;
        const before = kinds.get(layer);
        if (reply && reply.kind) kinds.set(layer, reply.kind);
        if (reply && reply.stats) stats.set(layer, reply.stats);
        if (reply && reply.kind && before === undefined) sourceRenamed(id);      // the menus' grades follow what is now known
    }

    /** The dataset's layers, and what each looks like (one sample each, no look at the others: `suggest: false`). */
    async function refreshKinds() {
        try {
            const list = layerKeys(await DataManager.getDatasetStructure(DataManager.getCurrentDataset()));
            if (destroyed) return;
            layers = list && list.length ? list : ['X'];
        } catch {
            layers = ['X'];
        }
        await Promise.all(layers.map(askKind));
    }

    /** What the layers look like and what the server sampled of them, for grading a method on a layer (decision 31). */
    const getGrading = () => ({ kinds: Object.fromEntries(kinds), stats: Object.fromEntries(stats) });

    return {
        methods,
        getGrading,
        /**
         * Every method on every layer of the dataset that can be computed, as the menus that still list combinations
         * read them (utils/score-source.js scoreOptions). SO-3 removes it with those menus.
         */
        getOfferedOptions: () => everyOption(getOptions(), layers, getGrading()),
        /** The dataset is there: read its layers and what they look like. */
        load: () => refreshKinds(),
        /** Another dataset: what the layers looked like is forgotten, and asked again. */
        datasetChanged() {
            KIND_CLIENT.clear();
            kinds.clear();
            stats.clear();
            return refreshKinds();
        },
        /** The option fields changed from outside (a saved config, Back and Forward). */
        changed: () => methods.paint(),
        paint: () => methods.paint(),
        /** Open the Methods pop-over and put the cursor there (a consumer's "Offer other scores…" until SO-3 removes it). */
        reveal: () => methods.open(),
        destroy() {
            destroyed = true;
            unwatch();
            methods.destroy();
        }
    };
}
