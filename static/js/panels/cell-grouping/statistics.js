/**
 * The Statistics offered section of a Cell Grouping (GRP-9, SHR-25 to SHR-27, UX 2.7): which statistics and layers the
 * grouping offers the plots and tables that read it, and the one detection threshold two of the statistics share.
 *
 * It is the Gene Signature's Scores offered section (panels/score-options/offered-section.js) over the grouping's
 * method table (utils/group-statistics.js), so the two look and behave alike; this file adds the threshold at the top
 * of the body and wires the section to the panel: the layers the dataset has, what each looks like (the page-wide kind
 * cache), who reads the grouping, and every edit as one undoable step of the panel. Nothing here computes: a statistic
 * is computed from the moments of the groups when a plot shows it.
 *
 * The panel mounts it through panels/cell-grouping.js `PARTS.statistics`: `mount(host, ctx)` returns `{update, destroy}`.
 * The section does not fold in the panel: `host` (a slot of the toolbar) holds one button, Statistics ▾, and the section's
 * body is the content of a wide pop-over (ui/popover.js), so opening it moves nothing.
 */
import { DataManager } from '../../data-manager.js';
import { createPopover } from '../../ui/popover.js';
import { makeDom } from '../gene-set-utilities/dom.js';
import { createOfferedSection } from '../score-options/offered-section.js';
import { KIND_CLIENT } from '../score-options/score-options.js';
import { layerKeys } from '../../utils/structure-keys.js';
import { groupSources } from '../../utils/group-host.js';
import { parseThresholdText } from '../../utils/options-model.js';
import { GROUP_STATISTICS_MODEL as model, recipePatch, statisticUsage, thresholdLine } from '../../utils/group-statistics.js';

/** The help texts, so the page and its tests say the same thing. */
const STATISTICS_HELP = Object.freeze({
    title: 'Statistics offered',
    where: 'Plots pick from these. Nothing is computed until a plot shows it.',
    methods: 'Statistics',
    methodsNote: 'Cell count is always offered.',
    layers: 'Plots choose among the offered layers.',
    pinnedLayer: 'X is always offered.',
    lastLayer: 'At least one layer stays offered.',
    lastMethod: 'At least one statistic stays offered.'
});

/** The undo step an edit is, named by what it changed. */
function stepLabel(patch) {
    const parts = [];
    if ('offered' in patch) parts.push('statistics offered');
    if ('layers' in patch) parts.push('layers offered');
    if ('detect_above' in patch) parts.push('threshold');
    return parts.length > 1 && 'offered' in patch && 'layers' in patch ? 'reset statistics offered' : parts.join(' and ') || 'statistics offered';
}

const sameValue = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

/**
 * @param {HTMLElement} host - `.cgrp-statistics`
 * @param {{panelId: string, recipe: () => Object, set: (patch: Object, label: string) => void}} ctx
 * @returns {{update: () => void, destroy: () => void}}
 */
function mount(host, ctx) {
    const D = makeDom(host.ownerDocument);
    const { el } = D;
    const id = ctx.panelId;
    const sid = (x) => `gsig-scoring-${x}-${id}`;
    let section = null;
    let dataset = null;
    let layersKey = null;
    let slot = null;
    let box = null;
    let help = null;

    /** An edit of the section, as one undoable step of the panel, unless it changes nothing. */
    function apply(patch) {
        const edit = recipePatch(patch);
        const recipe = ctx.recipe();
        if (Object.entries(edit).every(([k, v]) => sameValue(recipe[k], v))) return;
        ctx.set(edit, stepLabel(edit));
    }

    // the threshold sits once, at the top: two statistics share it (SHR-26)
    slot = el('div', { class: 'gsig-scoring__params cgrp-statistics__threshold', data: { threshold: '' } });
    function makeBox({ numberBox, field }) {
        box = numberBox({ key: 'detect', name: 'A cell counts as expressing above this value', parse: parseThresholdText,
            read: (r) => (typeof r.detect_above === 'number' ? r.detect_above : 0), write: (v) => ({ detect_above: v }), width: '5rem' });
        help = el('span', { class: 'gsig-scoring__help', data: { thresholdHelp: '' } });
        D.clear(slot);
        slot.append(field('Expressed above', box.input, sid('detect')), help, box.error);
    }

    function paintBox(recipe, element) {
        if (!box) return;
        if (element.ownerDocument.activeElement !== box.input) box.input.value = String(typeof recipe.detect_above === 'number' ? recipe.detect_above : 0);
        help.textContent = thresholdLine(recipe);
    }

    section = createOfferedSection({
        D, id, model, title: STATISTICS_HELP.title, text: STATISTICS_HELP, popover: { label: 'Statistics' }, getRecipe: () => ctx.recipe(), apply,
        getInputs: async () => layerKeys(await DataManager.getDatasetStructure(DataManager.getCurrentDataset())),
        getKind: (layer, opts) => KIND_CLIENT.kind(DataManager.getCurrentDataset(), layer, opts),
        getInUse: () => statisticUsage(groupSources().sources.consumersOf(id)).statistics,
        getLayersInUse: () => statisticUsage(groupSources().sources.consumersOf(id)).layers,
        hooks: {
            bodyBlocks: [slot],
            pinnedLayer: model.defaultLayer,
            makeParams: makeBox,
            paintParams: paintBox,
            resetPatch: () => ({ detect_above: 0 }),
            paramsAreDefault: (recipe) => !recipe.detect_above
        }
    });
    host.append(section.element);
    // the section's classes style its body: the pop-over's content is wrapped in a `.gsig-scoring` of its own
    const pop = createPopover({ anchor: section.toggle, name: 'statistics', title: STATISTICS_HELP.title, wide: true,
        render: (content) => {
            const wrap = el('div', { class: 'gsig-scoring gsig-scoring--in-pop' }, section.body);
            content.append(wrap);
            section.setOpen(true);
            return () => { section.setOpen(false); wrap.remove(); };
        } });
    const unwatch = groupSources().sources.onSource(id, () => section.paintUsage());

    /** The dataset is there, or changed, or the offered layers did (a link, Back and Forward, Undo): ask what the layers look like. */
    function refresh() {
        const now = DataManager.isDatasetLoaded() ? DataManager.getCurrentDataset() : null;
        const key = JSON.stringify(ctx.recipe().layers || null);
        if (now && (now !== dataset || key !== layersKey)) {
            if (now !== dataset) section.refreshInputs();
            section.refreshKind();
            dataset = now;
            layersKey = key;
        }
    }
    /** What the section shows of the recipe: it is drawn again only when this changes, never per progress frame of the panel. */
    let drawn = null;
    function paint() {
        const r = ctx.recipe();
        const now = JSON.stringify([r.offered || null, r.layers || null, r.detect_above || 0]);
        if (now !== drawn) { drawn = now; section.paint(); }
    }
    refresh();
    paint();

    return {
        /** Open the pop-over: where a Cell-Gene Plot's "Offer other…" leads (WP-4). Its anchor must be shown. */
        reveal: () => { if (!pop.isOpen()) pop.open(); },
        update() {
            refresh();
            paint();
            section.paintUsage();
        },
        destroy() {
            unwatch();
            pop.destroy();
            section.destroy();
            D.clear(host);
        }
    };
}

/** What `PARTS.statistics` of panels/cell-grouping.js is. */
export const STATISTICS_PART = Object.freeze({ mount });
