/**
 * The page's side of the `cell-group` source: a Cell Grouping as a categorical source of a Cell Plot's colour, x, y, z
 * and hover (CAT-1, CAT-2, CAT-5, CAT-8, SHR-35 to SHR-38, GRP-17). The groups come from the page's ONE group store and
 * group sources (utils/group-host.js `groupSources()`), so a plot, a table and the grouping's own panel that need the
 * same groups share one request and one copy of the codes; this binds them to the plots through one host binding
 * (utils/host-binding.js: records per host and role, visibility, the painter every provider shares). Its structure
 * follows utils/score-source.js, the gene score's provider.
 *
 * A plot's colour, axis or hover that reads `{type: 'cell-group', key: <the grouping's panel id>, label: <its title when
 * last seen>}` asks here for its series. A ready grouping is a CATEGORICAL series: the codes as the route sent them (one
 * per cell shown, 1 byte up to 255 groups and 2 above, held on the memory guard's ledger while a plot holds them,
 * pinned while one on screen does: CAT-4), the name of each group in group order (SHR-9) and its colour (SHR-11). A
 * cell in no group is the codes' missing value, drawn as a missing category (SHR-5). Past 64 groups the colour-group
 * rule applies (utils/categories.js), each group ranked by its place in group order, so its colour is the grouping's
 * own (cell-grouping.js `groupColours`). Anything else throws `SourceUnavailable`: a colour falls back to neutral points
 * and an axis to a placeholder, both with the notice over the plot in a grouping's words (SHR-35). When the state
 * changes, the plot is drawn again.
 *
 * The plots reach all of it through the provider registered at the end (utils/source-registry.js).
 *
 * THE TYPE is exported as a function declaration as well as a constant: panels/cell-grouping/factors.js names it, and
 * the two modules are on an import cycle (this one imports utils/group-host.js, which imports factors.js). A function
 * declaration is defined before either module runs, so the type is readable whichever the page loads first.
 */
import { drawPlaceholder } from './panel-surface.js';
import { Coverage, GAP } from './coverage.js';
import { describeSource, paintProgress, sentenceOf, coverageKindOf } from './source-notices.js';
import { actions } from './source-actions.js';
import { createHostBinding, isHover, isVisible, panelIdOf, PENDING } from './host-binding.js';
import { registerSource, SourceUnavailable } from './source-registry.js';
import { registerPanelSourceType } from './panel-references.js';
import { groupSources } from './group-host.js';
import { groupColours } from './cell-grouping.js';
import { GROUP_COLOURS, grouped, groupOf, groupLegendLabel } from './categories.js';
import { generateDiscreteColors, groupColours as colourGroupPalette } from '../panels/plot-utilities/colors.js';
import { VOCABULARY } from './vocabulary.js';

const W = VOCABULARY.word;
const PL = VOCABULARY.plural;
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const fmt = (n) => Number(n).toLocaleString('en-US');

/** The type of the source this module provides: what a consumer's setting names (see the module's note on the cycle). */
export function cellGroupType() {
    return 'cell-group';
}

/** The type of the source this module provides. */
const GROUP_TYPE = cellGroupType();

/** The panel type whose panels are groupings. */
const GROUPING_PANEL = 'cell-grouping';

/** The value that is not a grouping: "New grouping…" in the key list. */
const NEW_GROUPING = '__new_grouping__';

/** The heading of the groupings in the Hover picker and under obs in a key list (UX 5). */
const GROUPINGS = capital(PL.grouping);

/** The legend entry of the cells in no group (SHR-5, UX 5). */
const NOT_IN_ANY_GROUP = capital(W.notInAnyGroup);

/** The legend entry of the cells in no group (SHR-5, UX 5). */
const NOT_IN_ANY_GROUP = capital(W.notInAnyGroup);

/** The page's panel registry (window.PanelManager): importing panel-manager.js would load every panel. */
const PanelManager = {
    getPanel: (id) => (globalThis.PanelManager ? globalThis.PanelManager.getPanel(id) : null),
    getAllPanels: () => (globalThis.PanelManager ? globalThis.PanelManager.getAllPanels() : []),
    getActivePanels: () => (globalThis.PanelManager ? globalThis.PanelManager.getActivePanels() : []),
    reopenClosedPanel: (id, opts) => globalThis.PanelManager.reopenClosedPanel(id, opts),
    createPanelNextTo: (type, nextTo) => globalThis.PanelManager.createPanelNextTo(type, nextTo)
};

const isGrouping = (panel) => !!panel && typeof panel.getType === 'function' && panel.getType() === GROUPING_PANEL;

/** The grouping panel with this id, or null. */
function groupingPanel(id) {
    const panel = id ? PanelManager.getPanel(id) : null;
    return isGrouping(panel) ? panel : null;
}

/** Every grouping, open or closed, in the order they were made: [{id, title, open}]. */
function groupingList() {
    const open = new Set(PanelManager.getActivePanels().map((p) => p.getId()));
    return PanelManager.getAllPanels().filter(isGrouping).map((p) => ({ id: p.getId(), title: p.getTitle(), open: open.has(p.getId()) }));
}

/** The title of the grouping a setting names, or what it was called when last seen (the setting's `label`). */
function groupingTitle(setting) {
    const panel = groupingPanel(setting && setting.key);
// ---------------------------------------------------------------------------------------------- the key list

/**
 * The key list of a grouping: every grouping, open or closed, by its title; the one held when it is gone, so the plot
 * can say it was deleted; and the way to make one (CAT-1, GRP-17).
 * @param {Array<{id: string, title: string}>} list
 * @param {{key?: string, label?: string}} setting
 */
function groupKeyEntries(list, setting) {
    const options = list.map((g) => ({ value: g.id, text: g.title }));
    const held = setting && setting.key;
    // a key left over from another source type is not a deleted grouping: a grouping's id is its panel's
    if (held && held.startsWith(`${GROUPING_PANEL}-`) && !list.some((g) => g.id === held)) {
        options.push({ value: held, text: `${setting.label || held} (deleted)` });
    }
    if (!options.length) options.push({ value: '', text: `No ${PL.grouping} yet` });
    options.push({ value: NEW_GROUPING, text: `New ${W.grouping}…` });
    return options;
}

// ---------------------------------------------------------------------------------------------- the series

/** The missing value of codes of this width: 255 in 1 byte, 65535 in 2 (the route's, CAT-4). */
const missingOf = (codes) => (codes.BYTES_PER_ELEMENT === 1 ? 0xff : 0xffff);

/**
 * The colour of each group (SHR-11), in group order: a grouping of one categorical factor takes that column's colours,
 * where the reply has them; any other takes the app's palette in group order, as a plot coloured by a column of as many
 * categories takes it; past 64 groups the 64 colours of the colour groups, group i in colour i mod 64. One grouping
 * has the same colours in every panel.
 * @param {Object} reply - a snapshot's `values.reply`
 * @returns {string[]}
 */
function groupingColours(reply) {
    const n = Array.isArray(reply.groups) ? reply.groups.length : 0;
    const palette = grouped(n) ? colourGroupPalette(GROUP_COLOURS) : generateDiscreteColors(Math.max(1, n));
    // the reply's partitionings say what the recipe that made it said: a column's colours come only with an unbinned
    // categorical factor
    const made = { partitionings: (reply.partitionings || []).map(() => ({})) };
    return groupColours(made, reply, palette);
}

/** reply -> {names, colours, rankOf, groupNames}: what a series of a reply is made of, once per reply and names. */
const PARTS = new WeakMap();

function partsOf(reply, names) {
    let parts = PARTS.get(reply);
    if (parts && parts.names === names) return parts;
    const many = grouped(names.length);
    parts = { names, many, colours: many ? null : groupingColours(reply), rankOf: null, groupNames: null };
    if (many) {
        // a group's rank is its place in group order: its colour group is the grouping's own (groupOf)
        parts.rankOf = new Map(names.map((name, i) => [name, i]));
        const members = Array.from({ length: GROUP_COLOURS }, () => []);
        names.forEach((name, i) => members[groupOf(i)].push(name));
        parts.groupNames = members.map((list) => groupLegendLabel(list, list.length));
    }
    PARTS.set(reply, parts);
    return parts;
}

/** codes -> {names, values}: a hover line's values, one per cell, made once per codes and names. */
const HOVER = new WeakMap();

function hoverValues(codes, MISSING, names) {
    const was = HOVER.get(codes);
    if (was && was.names === names) return was.values;
    const none = W.notInAnyGroup;
    const values = Array.from(codes, (c) => (c === MISSING ? none : names[c]));
    HOVER.set(codes, { names, values });
    return values;
}

/**
 * A ready grouping as a regular plot's categorical series (utils/source-registry.js `load`): the codes as they came,
 * the group names in group order (`categories`), their colours up to 64 groups, and past 64 each group's rank in group
 * order (`rankOf`). A hover line also gets its `values`, which name a cell in no group.
 * @param {{codes: ArrayBufferView, reply: Object}} values - a snapshot's values
 * @param {string[]} names - the group names (group-sources.js `namesOf`), one per group of the reply
 * @param {{hover?: boolean}} [opts]
 */
function groupSeries(values, names, { hover = false } = {}) {
    const { codes } = values;
    const MISSING = missingOf(codes);
    const parts = partsOf(values.reply, names);
    const series = { type: 'categorical', codes, MISSING, categories: names, colours: parts.colours, rankOf: parts.rankOf, ranked: false,
        groupNames: null, coverage: Coverage.complete(codes.length, 'cells') };
    if (hover) series.values = hoverValues(codes, MISSING, names);
    return series;
}

/**
 * A ready grouping in a large plot's form (`loadLarge`): typed codes only, never a plain array per point. Up to 64
 * groups, with their names and colours; past 64, the codes are the groups' ranks already (a group's code is its place
        groupNames: null, missingLabel: NOT_IN_ANY_GROUP, coverage: Coverage.complete(codes.length, 'cells') };
 * @param {{codes: ArrayBufferView, reply: Object}} values
 * @param {string[]} names
 */
function groupLargeSeries(values, names) {
        groupNames: null, missingLabel: NOT_IN_ANY_GROUP, coverage: Coverage.complete(codes.length, 'cells') };
    const MISSING = missingOf(codes);
    const parts = partsOf(values.reply, names);
    if (parts.many) return { type: 'categorical', codes, MISSING, categories: [], ranked: true, groupNames: parts.groupNames };
    return { type: 'categorical', codes, MISSING, categories: names, colours: parts.colours };
}

// ---------------------------------------------------------------------------------------------- notices

/** What a grouping's figures of a refusal for its size say (the route's `refused`). */
function sizeRefusal(refused) {
    if (!refused || !Number.isFinite(Number(refused.count)) || !Number.isFinite(Number(refused.limit))) return null;
    if (refused.reason === 'too_many_groups') {
        return `has ${fmt(refused.count)} ${PL.group}: a ${W.grouping} holds up to ${fmt(refused.limit)}`;
    }
    if (refused.reason === 'too_many_levels') {
        return `has a ${W.factor} with ${fmt(refused.count)} ${PL.level}: a ${W.factor} holds up to ${fmt(refused.limit)}`;
    }
    return null;
}

/** What a grouping calls things in a notice (utils/source-notices.js), with the states only a grouping has. */
const VOCAB = Object.freeze({
    thing: W.grouping, source: W.grouping, result: W.grouping, Computing: 'Computing',
    // a grouping's progress counts the stored values it has read
    progressUnit: 'values',
    found: 'cells', act: { to: 'group', ing: W.grouping },
    tags: { computing: `${capital(W.grouping)}…`, cycle: `Circular ${PL.grouping}` },
    cycleKind: W.grouping,
    off: 'Cell Grouping is turned off on this server.',
    upstreamTitle: (snap) => {
        const panel = snap.table ? PanelManager.getPanel(snap.table) : null;
        return panel && typeof panel.getTitle === 'function' ? panel.getTitle() : null;
    },
    states: {
        notcells(snap, f) {
            return f.out('notcells', 'notice', 'Not a cell source', `${GROUPINGS} are a cell source; not available in a Gene Plot.`, '', []);
        },
        unset(snap, f) {
            return f.out('unset', 'notice', `No ${W.grouping}`, `No ${W.grouping} is chosen.`, '', [f.choose]);
        },
        refused(snap, f) {
            const said = sizeRefusal(snap.refused);
    }
});

/**
 * The notice of a plot's grouping in one state, or null when nothing is to be said (ready, no edits waiting). Pure: a
 */
function describeGrouping(snap, ctx = {}) {
    return describeSource(snap, ctx, VOCAB);

/** The series cannot be drawn yet, and why. */
const unavailable = (notice, coverage, state = null) => new SourceUnavailable(notice.headline, notice, coverage, state, GROUP_TYPE);

/** A coverage that says the grouping's series is not there, in the notice's words. */
const missingCoverage = (notice, setting, unit, total, kind) => Coverage.missing(GAP.UNAVAILABLE, sentenceOf(notice),
    { source: `${W.grouping} ${groupingTitle(setting)}`, unit, total, kind });

// ---------------------------------------------------------------------------------------------- records

    return describeSource(snap, ctx, VOCAB);
    const panel = PanelManager.getPanel(panelIdOf(host));
    const reload = panel && (panel.refreshPlot || panel.refreshTable);
    if (typeof reload === 'function') Promise.resolve(reload()).catch(() => {});
}

/**
 * The placeholder an axis shows while its grouping cannot be drawn, with the notice's progress bar. Also the progress
    return describeSource(snap, ctx, VOCAB);
        box.dataset.scoreState = notice.state;
        paintProgress(box, notice.progress || null, sentenceOf(notice));
    }
    host.__sourcePlaceholder = true;
}

/**
 * The handle of a grouping that has no factor yet: it asks nothing of the server, says so, and tells its record when
 * the grouping changes (a factor added), so the plot is drawn again and watches the groups.
 */
function emptyHandle(id, onChange) {
    const read = () => ({ id, state: 'nofactors', title: groupingTitle({ key: id }), key: null, held: null });
    const stop = groupSources().sources.onSource(id, () => onChange(read()));
    const no = () => false;
    return { read, release: stop, sharers: () => 1, compute: no, cancel: no, retry: no };
}

                const id = setting.key;
                if (isEmptyGrouping(id)) return { groupId: id, empty: true, handle: emptyHandle(id, onChange) };
                const handle = groupSources().sources.watch(id, {
                    consumer: { kind: 'plot', role, panelId: panelIdOf(host), host }, option: { codes: true },
                    visible: () => isVisible(host), onChange
                });
                return { groupId: id, empty: false, handle };
            },
            matches: (rec, setting) => rec.groupId === setting.key && rec.empty === isEmptyGrouping(setting.key),
            describe: (snap, ctx) => describeGrouping(withFigures(snap), ctx),
            stillUsed,
            // drawn again when: a factor was added to an empty grouping (or the last one removed); the grouping was
            stale: (rec, snap) => rec.empty !== isEmptyGrouping(rec.groupId)
                || (!!rec.drawnKey && !!snap.title && snap.title !== rec.setting.label)
                || (rec.drawnKey === null && rec.drawnKind !== undefined && coverageKindOf(snap) !== rec.drawnKind),
            refresh: refreshPanel,
                return { groupId: id, handle };
            placeholder: drawGroupPlaceholder
            matches: (rec, setting) => rec.groupId === setting.key,
    }
    return _binding;
            // drawn again when the grouping was renamed (its legend and axis titles name it), or when what the strip
    if (!host || !setting.key) {
        const notice = describeGrouping({ state: 'unset', title: '' }, { role: roleWord(role) });
        throw unavailable(notice, missingCoverage(notice, setting, unit, expected, 'stopped'));
    }
    const rec = binding().recordFor(host, role, setting);
    rec.quiet = quiet;
    const snap = rec.handle.read();
    if (snap.values && snap.values.codes) {
        rec.drawnKey = snap.shownKey || snap.key;
        rec.drawnKind = undefined;
        binding().paint(host);
        const names = groupSources().sources.namesOf(setting.key, snap.values.reply);
    }
    rec.drawnKey = null;
    rec.drawnKind = coverageKindOf(snap);
    const ctx = { role: roleWord(role), sharers: rec.handle.sharers() };
                return { groupId: id, handle };
    // a caller that waits for the groups says nothing yet (rec.quiet): no notice and no tag until it is known to last
            matches: (rec, setting) => rec.groupId === setting.key,
 * @param {Object} setting
 * @param {{host, role: string, axis: (string|null), expected: (number|null), unit: string, signal: (AbortSignal|null)}} opts
 */
function loadForPlot(setting, { host, role, expected, unit, signal }) {
    if (unit === 'genes') return notCells(setting, role, unit, expected);
    if (isHover(role)) {
        try {
            return Promise.resolve(loadGroupSeries(setting, { host, role, expected, unit }));
        } catch (error) {
            return Promise.reject(error);
        }
    }
}

/**
 * A large plot's series of a grouping: the codes the group store holds, nothing copied; waits as loadForPlot does.
                return { groupId: id, handle };
 * @param {Object} setting
            matches: (rec, setting) => rec.groupId === setting.key,
 */
function loadLargeForPlot(setting, { host, role, expected, unit = 'cells', signal }) {
            // drawn again when the grouping was renamed (its legend and axis titles name it), or when what the strip
            // said of a grouping with no value changed (a factor added to an empty grouping: computing now)
            stale: (rec, snap) => (!!rec.drawnKey && !!snap.title && snap.title !== rec.setting.label)
// ---------------------------------------------------------------------------------------------- actions

/**
 * The plots' provider of a grouping's notice actions (utils/source-actions.js), over the page's records of groupings.
 * @param {Object} deps
 */
function createPlotGroupActions({ shownRecord: shown, recordsOf: records, groupingPanel: panelOf, update, openGrouping: open, chooser,
    panelIdOf: hostPanelId }) {
    const record = (run) => ({ target: (host) => shown(host) || null, run });
    return {
        id: PLOT_PROVIDER,
        owns: (host) => !!shown(host),
        actions: {
            'score-compute': { target: (host) => (records(host).size ? host : null), run: (host) => { for (const r of records(host).values()) r.handle.compute(); } },
            'score-cancel': record((rec) => { rec.handle.cancel(); }),
            'score-retry': record((rec) => { rec.handle.retry(); }),
            'score-update': record((rec) => { update(rec.groupId); }),
            'score-open': { target: (host) => { const rec = shown(host); return rec && panelOf(rec.groupId) ? rec : null; },
                run: (rec, host) => { open(rec.groupId, hostPanelId(host)); } },
            'score-choose': { target: (host) => { const rec = shown(host); return rec ? chooser(host, rec) : null; }, run: (place) => { place.focus(); } }
        }
    };
}

/** The select a plot's grouping is chosen in, to take the user to: null when the plot has none. */
function groupChooser(host, rec) {
    const tile = host.closest ? host.closest('.tile') : null;
    const select = tile && tile.querySelector(`.axis-key-select[data-axis="${isHover(rec.role) ? 'color' : rec.role}"]`);
    if (!select) return null;
    return { focus() { if (select.scrollIntoView) select.scrollIntoView({ block: 'nearest' }); select.focus(); } };
}

/**
 * "Open grouping" (GRP-17): the grouping's panel, open already (scrolled to) or reopened beside `nextTo` with the same
 * id, so everything that names it keeps meaning it.
 * @param {string} id
 * @param {string|null} [nextTo] - the panel the request came from
 * @returns {Object|null} the open panel, or null when there is no such grouping
 */
function openGrouping(id, nextTo = null) {
    const panel = groupingPanel(id);
    if (!panel) return null;
    if (PanelManager.getActivePanels().includes(panel)) {
        const tile = typeof document !== 'undefined' ? document.querySelector(`.tile[data-tile-id="${CSS.escape(id)}"]`) : null;
        if (tile && tile.scrollIntoView) tile.scrollIntoView({ block: 'nearest' });
        return panel;
    }
    return PanelManager.reopenClosedPanel(id, { nextTo });
}

actions.register(createPlotGroupActions({
    shownRecord: (host) => binding().shownRecord(host), recordsOf: (host) => binding().recordsOf(host), groupingPanel,
    update: (id) => groupSources().sources.update(id), openGrouping, chooser: groupChooser, panelIdOf
}));

// ---------------------------------------------------------------------------------------------- events from the page

/**
 * Panels were added, removed, closed, reopened or renamed: a deleted grouping shows, a returned one resolves, a renamed
 * one is named again, and a closed plot's records go.
 */
function panelsChanged() {
    if (!_binding || !_binding.hosts().length) return;
    const { sources } = groupSources();
    sources.recheck();
    sources.contextChanged();
    for (const host of _binding.hosts()) {
        if (!host.isConnected) { _binding.releaseHost(host); continue; }
        for (const rec of _binding.recordsOf(host).values()) {
            if (rec.empty !== isEmptyGrouping(rec.groupId) || (rec.drawnKey && groupingTitle(rec.setting) !== rec.setting.label)) _binding.refreshSoon(host);
        }
        _binding.schedulePaint(host);
    }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('annzarro:panels-changed', () => panelsChanged());
}

// ---------------------------------------------------------------------------------------------- the Hover picker
            if (rec.drawnKey && groupingTitle(rec.setting) !== rec.setting.label) _binding.refreshSoon(host);
const GROUP_PREFIX = `${GROUP_TYPE}:`;

/** The picker's value of a grouping: `cell-group:<grouping id>`. */
const groupValue = (id) => `${GROUP_PREFIX}${id}`;

/**
 * The picker's entries for groupings: one per grouping, then any value in `kept` whose grouping is gone (kept and
 * marked, so the plot still has it).
 */
function groupHoverOptions(kept) {
    const out = groupingList().map((g) => ({ value: groupValue(g.id), label: g.title }));
    for (const value of kept) {
        if (typeof value === 'string' && value.startsWith(GROUP_PREFIX) && !out.some((o) => o.value === value)) {
            out.push({ value, label: `${value.slice(GROUP_PREFIX.length)} (deleted)` });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------------------------- the provider

// a plot's colour, axes and hover entries of a grouping, and a table's columns, follow their panel in a remap (CAT-9)
registerPanelSourceType(GROUP_TYPE);

registerSource({
    type: GROUP_TYPE,
    label: GROUP_TYPE,
    valueType: 'categorical',
    entity: 'cells',
    consumers: ['cell-plot'],
    axes: ['x', 'y', 'z', 'color', 'hover'],
    // large-plot mode draws a grouping once G8b says on which axes (CAT-3)
    largeAxes: [],
    defaultSub: '',
            if (rec.drawnKey && groupingTitle(rec.setting) !== rec.setting.label) _binding.refreshSoon(host);
    alsoListedUnder: 'obs',
    alsoListedGroup: GROUPINGS,
    entities: groupingList,
    keyEntries: groupKeyEntries,
    newEntity: { value: NEW_GROUPING, run: (nextTo) => PanelManager.createPanelNextTo(GROUPING_PANEL, nextTo) || null },
    subKeys: () => [],
    load: loadForPlot,
    loadLarge: loadLargeForPlot,
    hover: {
        group: GROUPINGS,
        options: groupHoverOptions,
        valueOf: (setting) => groupValue(setting.key),
        parse: (value) => ({ key: value.slice(GROUP_PREFIX.length) }),
        label: groupingTitle
    },
    titleOf: (setting) => `${W.grouping} ${groupingTitle(setting)}`,
    placeholder: drawGroupPlaceholder,
    vocabulary: { result: W.grouping }
});

 * Panels were added, removed, closed, reopened or renamed: a deleted grouping shows, a returned one resolves, and a
 * renamed one is named again. (A closed plot's records went with it: cell-plot.js releases them in every provider.)