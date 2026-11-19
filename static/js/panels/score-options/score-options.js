/**
 * The score options of a source of a gene score, as one component: the "Scores offered" section and Inspect, wired to
 * the page. A Gene Signature panel and a Gene Table panel both use it, so the section, its options model
 * (utils/signature-options.js), the kind of each layer and the way an edit reaches plots and tables are the same code
 * for both; a panel supplies only where its option fields live.
 *
 *   const options = createScoreOptions({ id, D, getOptions, setOptions, getTitle, focusGene, onApplied });
 *   host.append(options.warning, options.scoring.element);     // the section, with the default layer's warning
 *   host.append(options.inspect.element);                      // Inspect
 *
 * `getOptions()` returns the option fields (a signature passes its whole recipe, which has them); `setOptions(patch)`
 * stores a patch of them and repaints the panel's own parts. This component then tells the plots and tables that read
 * the score (an edit is applied at once when the score is cheap and collected behind Update score when it is not,
 * utils/score-sources.js) and the saved state.
 */
import { DataManager } from '../../data-manager.js';
import { Config } from '../../config.js';
import { createKindClient, warningFor } from '../../utils/matrix-kind-client.js';
import { layerKeys } from '../../utils/structure-keys.js';
import { aggregationsInUse, layersInUse, signatureChanged, signatureRenamed } from '../../utils/score-source.js';
import { offeredOptions } from '../../utils/signature-options.js';
import { createScoringSection } from './scoring-section.js';
import { createInspect } from './inspect-section.js';

/** What the layers look like, asked once per dataset and layer for the whole page. */
const KIND_CLIENT = createKindClient({ url: Config.API.MATRIX_KIND });

/** The edits that change what plots and tables may pick: their menus and titles follow. */
const MENU_KEYS = ['offered', 'layers', 'input', 'method'];

/**
 * @param {Object} o
 * @param {string} o.id - the panel's id
 * @param {{el: Function, clear: Function}} o.D - the DOM builder
 * @param {() => Object} o.getOptions - the option fields now
 * @param {(patch: Object) => void} o.setOptions - store a patch of option fields and repaint the panel
 * @param {() => string} o.getTitle
 * @param {(gene: string) => void} o.focusGene
 * @param {() => void} [o.onApplied] - after an edit was stored and told to its readers
 * @param {boolean} [o.withInspect] - make Inspect too (default true)
 * @param {{countAsUp: () => void}|null} [o.directions] - a source whose genes can be up or down (a signature, not a table)
 */
export function createScoreOptions({ id, D, getOptions, setOptions, getTitle, focusGene, onApplied = () => {}, withInspect = true, directions = null }) {
    let scoring = null;

    function apply(patch) {
        setOptions(patch);
        signatureChanged(id);
        if (window.sessionManager && typeof window.sessionManager.notifyPanelUpdate === 'function') {
            window.sessionManager.notifyPanelUpdate();
        }
        if (MENU_KEYS.some(key => key in patch)) signatureRenamed(id);
        if ('input' in patch || 'layers' in patch) scoring.refreshKind();
        onApplied(patch);
    }

    scoring = createScoringSection({
        D, id, getRecipe: getOptions, apply,
        getInputs: async () => layerKeys(await DataManager.getDatasetStructure(DataManager.getCurrentDataset())),
        getKind: (input, opts) => KIND_CLIENT.kind(DataManager.getCurrentDataset(), input, opts),
        onKinds: () => { signatureRenamed(id); }, directions,
        getInUse: () => aggregationsInUse(id), getLayersInUse: () => layersInUse(id), warningFor
    });
    const inspect = withInspect ? createInspect({ id, D, getTitle, getRecipe: getOptions, getOptions: () => offeredOptions(getOptions(), null, scoring.getKinds()), focusGene }) : null;

    return {
        scoring,
        inspect,
        warning: scoring.warning,
        /** What plots and tables are offered: every offered method of every offered layer that can be computed. */
        getOfferedOptions: () => offeredOptions(getOptions(), null, scoring.getKinds()),
        /** The dataset is there: read the layers and what the chosen ones look like. */
        load() {
            scoring.refreshInputs();
            scoring.refreshKind();
        },
        /** Another dataset: what the layers looked like is forgotten, and asked again. */
        datasetChanged() {
            KIND_CLIENT.clear();
            scoring.refreshInputs();
            scoring.refreshKind();
        },
        /** The option fields changed from outside (a saved config, Back and Forward). */
        changed(keys) {
            if (keys && (keys.includes('input') || keys.includes('layers'))) scoring.refreshKind();
            scoring.paint();
        },
        paint: () => scoring.paint(),
        /** Open Scores offered and put the cursor there ("Offer other scores…"). */
        reveal: () => scoring.reveal(),
        /** The score's state changed: the section shows what is in use. */
        paintAggregations: () => scoring.paintAggregations(),
        destroy() {
            if (inspect) inspect.destroy();
            scoring.destroy();
        }
    };
}
