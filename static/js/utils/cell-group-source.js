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
 * own (utils/grouping-colours.js). Anything else throws `SourceUnavailable`: a colour falls back to neutral points
 * and an axis to a placeholder, both with the notice over the plot in a grouping's words (SHR-35). When the state
 * changes, the plot is drawn again.
 *
 * LARGE PLOTS (CAT-3, CAT-4). A grouping is the colour of a large plot, never an axis (`largeAxes`): `loadLarge` gives
 * the codes the group store holds, nothing copied. Before the codes are asked for, `cost` says what they weigh and the
 * memory guard is asked (`codesCheck`): codes that do not fit are refused with no request of any kind, in the guard's
 * words, and the plot is drawn with no color and the notice over it. A plot that already holds its codes asks nothing
 * more. The group count is what the last reply said (1 byte a cell until a reply says more than 255 groups).
 *
 * The plots reach all of it through the provider registered at the end (utils/source-registry.js).
 *
 * THE TYPE is exported as a function declaration as well as a constant: panels/cell-grouping/factors.js names it, and
 * the two modules are on an import cycle (this one imports utils/group-host.js, which imports factors.js). A function
 * declaration is defined before either module runs, so the type is readable whichever the page loads first.
 */
import { drawPlaceholder } from './panel-surface.js';
import { Coverage, GAP } from './coverage.js';
import { describeSource, paintProgress, sentenceOf, coverageKindOf, sizeRefusalText } from './source-notices.js';
import { actions } from './source-actions.js';
import { createHostBinding, isHover, isVisible, panelIdOf, PENDING } from './host-binding.js';
import { registerSource, SourceUnavailable } from './source-registry.js';
import { registerPanelSourceType } from './panel-references.js';
import { groupSources } from './group-host.js';
import { codeBytes } from './group-store.js';
import { codesCheck, shortRefusalText } from './memory-guard-ui.js';
import { DataManager } from '../data-manager.js';
import { datasetLayersNow } from './score-source.js';
import { GROUP_COLOURS, grouped, groupOf, groupLegendLabel } from './categories.js';
import { VOCABULARY } from './vocabulary.js';
import { createGroupTable } from '../panels/cell-grouping/table-column.js';

const W = VOCABULARY.word;
const PL = VOCABULARY.plural;
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

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
    return panel ? panel.getTitle() : (setting && (setting.label || setting.key)) || '';
}

/**
 * Write into a consumer's setting what it is called: `label`, the grouping's title (kept for when it is deleted). A
 * grouping's title has one line, so a `labelFull` left over from another source is dropped (titles read it first).
 * @returns {boolean} whether it changed
 */
function nameSetting(setting) {
    const panel = groupingPanel(setting.key);
    const changed = (!!panel && setting.label !== panel.getTitle()) || setting.labelFull !== undefined;
    if (panel) setting.label = panel.getTitle();
    delete setting.labelFull;
    return changed;
}

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

/** reply -> {names, colours, rankOf, groupNames}: what a series of a reply is made of, once per reply and names. */
const PARTS = new WeakMap();

function partsOf(id, reply, names) {
    let parts = PARTS.get(reply);
    if (parts && parts.names === names) return parts;
    const many = grouped(names.length);
    // the colours of each group (SHR-11, utils/grouping-colours.js): one grouping has the same colours in every panel; past
    // 64 groups a plot colours its colour groups
    parts = { names, many, colours: many ? null : groupSources().sources.coloursOf(id, reply).groups, rankOf: null, groupNames: null };
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
function groupSeries(id, values, names, { hover = false } = {}) {
    const { codes } = values;
    const MISSING = missingOf(codes);
    const parts = partsOf(id, values.reply, names);
    const series = { type: 'categorical', codes, MISSING, categories: names, colours: parts.colours, rankOf: parts.rankOf, ranked: false,
        groupNames: null, missingLabel: NOT_IN_ANY_GROUP, coverage: Coverage.complete(codes.length, 'cells') };
    if (hover) series.values = hoverValues(codes, MISSING, names);
    return series;
}

/**
 * A ready grouping in a large plot's form (`loadLarge`): typed codes only, never a plain array per point. Up to 64
 * groups, with their names and colours; past 64, the codes are the groups' ranks already (a group's code is its place
 * in group order), so they are `ranked` and `groupNames` names the legend entry of each colour group.
 * @param {{codes: ArrayBufferView, reply: Object}} values
 * @param {string[]} names
 */
function groupLargeSeries(id, values, names) {
    const { codes } = values;
    const MISSING = missingOf(codes);
    const parts = partsOf(id, values.reply, names);
    const missingLabel = NOT_IN_ANY_GROUP;
    if (parts.many) return { type: 'categorical', codes, MISSING, categories: [], ranked: true, groupNames: parts.groupNames, missingLabel };
    return { type: 'categorical', codes, MISSING, categories: names, colours: parts.colours, missingLabel };
}

// ---------------------------------------------------------------------------------------------- the codes' cost

/** grouping id -> how many groups its last reply had: what `cost` knows of a grouping it has not asked for yet. */
const KNOWN_GROUPS = new Map();

/**
 * What the codes of a grouping weigh on the memory guard's ledger (CAT-4): one byte a cell up to 255 groups, two above.
 * @param {{cells: number, groups?: number}} p - `groups` is left out when it is not known yet: the narrow codes
 * @returns {{bytes: number}}
 */
function cost({ cells, groups = 0 }) {
    return { bytes: codeBytes(Math.max(0, Number(cells) || 0), groups) };
}

/** Whether a plot already holds the current codes of grouping `id`: asking for them again costs nothing (one copy is shared). */
function holdsCodes(id) {
    if (!_binding) return false;
    for (const host of _binding.hosts()) {
        for (const rec of _binding.recordsOf(host).values()) {
            if (rec.groupId !== id || rec.handle.refusal) continue;
            const snap = rec.handle.read();
            if (snap.values && snap.values.codes) return true;
        }
    }
    return false;
}

/**
 * Whether the memory guard refuses the codes of grouping `id` for the cells shown, asked before they are requested, by
 * the plot `panelId`.
 * The guard must never be why a plot is not drawn when it cannot answer: then nothing is refused.
 * @returns {null|{reason: string, binding: string, why: string}}
 */
export function codesRefusal(id, panelId = null) {
    if (holdsCodes(id)) return null;
    const cells = (DataManager.getCells() || []).length;
    if (!(cells > 0)) return null;
    let result;
    try {
        result = codesCheck({ bytes: cost({ cells, groups: KNOWN_GROUPS.get(id) }).bytes, n: cells, panelId });
    } catch (error) {
        console.warn('Browser memory check failed; reading the groups without it', error);
        return null;
    }
    if (!result || result.verdict !== 'block') return null;
    return { reason: MEMORY_REASON, binding: result.binding, why: shortRefusalText(result) };
}

/** What a record holds in place of a handle when the guard refused its codes: it says so, and asks for nothing. */
function refusedHandle(id, refusal) {
    const none = () => {};
    return { refusal, read: () => ({ state: 'refused', key: null, title: groupingTitle({ key: id }), refused: refusal, values: null }),
        sharers: () => 1, release: none, compute: none, retry: none, cancel: none };
}

// ---------------------------------------------------------------------------------------------- notices

/** The reason of a grouping the memory guard refused, before the request (CAT-4). */
const MEMORY_REASON = 'browser_memory';

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
            if (snap.refused && snap.refused.reason === MEMORY_REASON) {
                return f.out('refused', 'warning', f.tagOf('refused', `${f.Result} not loaded`), `${f.t} was not loaded.`,
                    `${snap.refused.why}${f.none}`, [f.choose]);
            }
            const said = sizeRefusalText(snap.refused);
            if (!said) return undefined;
            return f.out('refused', 'warning', f.tagOf('refused', `${f.Result} refused`), `${f.t} ${said}, so it was not computed.`, '', [f.open, f.choose]);
        }
    }
});

/**
 * The notice of a plot's grouping in one state, or null when nothing is to be said (ready, no edits waiting). Pure: a
 * refusal for its size names its figures from `snap.refused` (the binding adds them from the store).
 * @param {Object} snap - from a handle's read()
 * @param {{role?: string, sharers?: number}} [ctx] - `role`: 'colour', 'x', 'y', 'z' or 'hover'
 */
function describeGrouping(snap, ctx = {}) {
    return describeSource(snap, ctx, VOCAB);
}

/** A refused snapshot with the route's figures (the group store keeps them in the header), for its sentence. */
function withFigures(snap) {
    if (!snap || snap.state !== 'refused' || !snap.key || snap.refused) return snap;
    const header = groupSources().store.snapshot(snap.key).header;
    return header && header.refused ? { ...snap, refused: header.refused } : snap;
}

/** A setting's role as a notice says it. */
const roleWord = (role) => (role === 'color' ? 'colour' : (isHover(role) ? 'hover' : role));

/** The series cannot be drawn yet, and why. */
const unavailable = (notice, coverage, state = null) => new SourceUnavailable(notice.headline, notice, coverage, state, GROUP_TYPE);

/** A coverage that says the grouping's series is not there, in the notice's words. */
const missingCoverage = (notice, setting, unit, total, kind) => Coverage.missing(GAP.UNAVAILABLE, sentenceOf(notice),
    { source: `${W.grouping} ${groupingTitle(setting)}`, unit, total, kind });

// ---------------------------------------------------------------------------------------------- records

/** Whether the plot still reads the grouping a record holds (the user may have changed the axis). */
function stillUsed(rec) {
    const panel = rec.panelId ? PanelManager.getPanel(rec.panelId) : null;
    if (!panel || typeof panel.getConfig !== 'function') return true;
    const cfg = panel.getConfig();
    if (isHover(rec.role)) return (cfg.hoverInfo || []).some((h) => h && h.type === GROUP_TYPE && h.key === rec.groupId);
    const s = cfg[rec.role];
    return !!(s && s.type === GROUP_TYPE && s.key === rec.groupId);
}

/** Draw the panel of a host again: the groups it drew changed. */
function refreshPanel(host) {
    const panel = PanelManager.getPanel(panelIdOf(host));
    const reload = panel && (panel.refreshPlot || panel.refreshTable);
    if (typeof reload === 'function') Promise.resolve(reload()).catch(() => {});
}

/**
 * The placeholder an axis shows while its grouping cannot be drawn, with the notice's progress bar. Also the progress
 * repaint: it replaces itself.
 */
function drawGroupPlaceholder(host, notice) {
    if (!host) return;
    const unit = 'cells';
    const cov = Coverage.missing(GAP.UNAVAILABLE, notice.headline, { source: W.grouping, unit, total: null, kind: coverageKindOf(notice) });
    drawPlaceholder(host, cov, unit, {
        actions: notice.actions,
        say: { severity: notice.severity === 'error' ? 'error' : 'notice', headline: notice.headline, lines: notice.text ? [notice.text] : [] }
    });
    const box = host.querySelector('.coverage-placeholder');
    if (box) {
        box.dataset.scoreState = notice.state;
        paintProgress(box, notice.progress || null, sentenceOf(notice));
    }
    host.__sourcePlaceholder = true;
}

/** The id of the plots' grouping provider: its notices on the painter, its actions in the registry. */
const PLOT_PROVIDER = 'plot-group';

let _binding = null;

/** The plots' records of groupings, made when first needed. */
function binding() {
    if (!_binding) {
        _binding = createHostBinding({
            id: PLOT_PROVIDER,
            open: (host, role, setting, onChange) => {
                const id = setting.key;
                const consumer = { kind: 'plot', role, panelId: panelIdOf(host), host };
                const refusal = codesRefusal(id, consumer.panelId);
                if (refusal) return { groupId: id, handle: refusedHandle(id, refusal), consumer };
                const handle = groupSources().sources.watch(id, { consumer, option: { codes: true }, visible: () => isVisible(host), onChange });
                return { groupId: id, handle, consumer };
            },
            matches: (rec, setting) => rec.groupId === setting.key,
            describe: (snap, ctx) => describeGrouping(withFigures(snap), ctx),
            stillUsed,
            // drawn again when the grouping was renamed (its legend and axis titles name it), or when what the strip
            // said of a grouping with no value changed (a factor added to an empty grouping: computing now)
            stale: (rec, snap) => (!!rec.drawnKey && !!snap.title && snap.title !== rec.setting.label)
                // drawn again when a color was changed in the grouping (no request: the colors are read from its recipe)
                || (!!rec.drawnColours && !!snap.values && !!snap.values.reply && groupSources().sources.coloursOf(rec.setting.key, snap.values.reply) !== rec.drawnColours)
                || (rec.drawnKey === null && rec.drawnKind !== undefined && coverageKindOf(snap) !== rec.drawnKind),
            refresh: refreshPanel,
            visibilityChanged: () => groupSources().sources.visibilityChanged(),
            placeholder: drawGroupPlaceholder
        });
    }
    return _binding;
}

// ---------------------------------------------------------------------------------------------- loads

/**
 * The series of a grouping for one role of a plot.
 * @param {Object} setting - `{type: 'cell-group', key, label}`
 * @param {{host: HTMLElement, role: string, expected: (number|null), unit?: string, large?: boolean, quiet?: boolean}} opts
 * @returns {Object} groupSeries's (or groupLargeSeries's, with `large`)
 * @throws {SourceUnavailable} when no groups can be drawn
 */
function loadGroupSeries(setting, { host, role, expected, unit = 'cells', large = false, quiet = false }) {
    nameSetting(setting);
    if (!host || !setting.key) {
        const notice = describeGrouping({ state: 'unset', title: '' }, { role: roleWord(role) });
        throw unavailable(notice, missingCoverage(notice, setting, unit, expected, 'stopped'));
    }
    let rec = binding().recordFor(host, role, setting);
    // codes the guard refused are asked of it again: something may have been closed since
    if (rec.handle.refusal && !codesRefusal(setting.key, panelIdOf(host))) {
        binding().release(host, role);
        rec = binding().recordFor(host, role, setting);
    }
    rec.quiet = quiet;
    const snap = rec.handle.read();
    if (snap.values && snap.values.codes) {
        if (Array.isArray(snap.values.reply.groups)) KNOWN_GROUPS.set(setting.key, snap.values.reply.groups.length);
        rec.drawnKey = snap.shownKey || snap.key;
        rec.drawnKind = undefined;
        binding().paint(host);
        const names = groupSources().sources.namesOf(setting.key, snap.values.reply);
        rec.drawnColours = groupSources().sources.coloursOf(setting.key, snap.values.reply);
        return large ? groupLargeSeries(setting.key, snap.values, names) : groupSeries(setting.key, snap.values, names, { hover: isHover(role) });
    }
    rec.drawnKey = null;
    rec.drawnKind = coverageKindOf(snap);
    const ctx = { role: roleWord(role), sharers: rec.handle.sharers() };
    const notice = describeGrouping(withFigures(snap), ctx) || describeGrouping({ ...snap, state: 'estimating' }, ctx);
    // a caller that waits for the groups says nothing yet (rec.quiet): no notice and no tag until it is known to last
    if (!(quiet && PENDING.includes(snap.state))) binding().paint(host);
    throw unavailable(notice, missingCoverage(notice, setting, unit, expected, coverageKindOf(snap)), snap.state);
}

/** A Gene Plot cannot take a grouping (a link can name it there): that axis says so, and the rest of the link works. */
function notCells(setting, role, unit, expected) {
    const notice = describeGrouping({ state: 'notcells', title: '' }, { role: roleWord(role) });
    return Promise.reject(unavailable(notice, missingCoverage(notice, setting, unit, expected, 'stopped')));
}

/**
 * A plot's series of a grouping: waits for it while the plot has a drawing to keep (the binding's loadWhenReady). A
 * hover line does not hold the plot back: it is left out until the groups are there, and the plot draws again then.
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
    return binding().loadWhenReady((quiet) => loadGroupSeries(setting, { host, role, expected, unit, quiet }), { host, role }, signal);
}

/**
 * A large plot's series of a grouping: the codes the group store holds, nothing copied; waits as loadForPlot does.
 * @param {Object} setting
 * @param {{host, role: string, expected: (number|null), unit?: string, signal: (AbortSignal|null)}} opts
 */
function loadLargeForPlot(setting, { host, role, expected, unit = 'cells', signal }) {
    if (unit === 'genes') return notCells(setting, role, unit, expected);
    return binding().loadWhenReady((quiet) => loadGroupSeries(setting, { host, role, expected, unit, large: true, quiet }), { host, role }, signal);
}

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
 * Panels were added, removed, closed, reopened or renamed: a deleted grouping shows, a returned one resolves, and a
 * renamed one is named again. (A closed plot's records went with it: cell-plot.js releases them in every provider.)
 */
function panelsChanged() {
    if (!_binding || !_binding.hosts().length) return;
    const { sources } = groupSources();
    sources.recheck();
    sources.contextChanged();
    for (const host of _binding.hosts()) {
        for (const rec of _binding.recordsOf(host).values()) {
            if (rec.drawnKey && groupingTitle(rec.setting) !== rec.setting.label) _binding.refreshSoon(host);
        }
        _binding.schedulePaint(host);
    }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('annzarro:panels-changed', () => panelsChanged());
}

// ---------------------------------------------------------------------------------------------- the Hover picker

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

// ---------------------------------------------------------------------------------------------- the axis row

/** Why a large plot lists the groupings greyed on an axis (the colour of a large plot is one). */
const LARGE_AXIS_REASON = 'A grouping can color a large plot, not be one of its axes.';

/** The title of the row's layer select while a grouping is chosen. */
const NO_LAYER_REASON = 'A cell grouping reads no layer.';

const SECTION_ENTRY = (g) => ({ entry: g.id, text: g.open ? g.title : `${g.title} (closed)` });

/**
 * The groupings in an axis's item picker (utils/axis-aggregate.js), under "Cell groupings", last: the cell-side set after
 * the gene-side ones. A grouping is the group each cell is in, not an aggregate, so it has no aggregation button
 * (`methods` is null), and the row's layer select stays on the layer it had, disabled (`layers`).
 */
const groupAggregate = {
    sections: () => [{ heading: VOCABULARY.aggregation.sections.groupings,
        entries: [...groupingList().map(SECTION_ENTRY), { entry: NEW_GROUPING, text: `New ${W.grouping}\u2026` }] }],
    // the stored setting is the provider's own, as before: only the row that shows it changed. The layer the row was on is
    // kept in the setting's history, where a layer source keeps it, so the row shows it again
    start: (id, layer, previous = null) => {
        const history = (previous && previous.history) || {};
        return { type: GROUP_TYPE, key: id, column: '', history: { ...history, layer: { ...(history.layer || {}), key: layer } } };
    },
    entryOf: (setting) => setting.key,
    layerOf: (setting) => (setting.history && setting.history.layer && setting.history.layer.key) || '',
    methods: () => null,
    // the groups of a grouping, once it has been read (a picker greys the ones over a plot's cap with their count)
    levelCount: (id) => (KNOWN_GROUPS.has(id) ? KNOWN_GROUPS.get(id) : null),
    layers: (setting) => {
        const keys = datasetLayersNow() || ['X'];
        const kept = (setting.history && setting.history.layer && setting.history.layer.key) || '';
        return { options: keys.map((k) => ({ value: k, text: k })), chosen: keys.includes(kept) ? kept : keys[0], disabled: true, title: NO_LAYER_REASON };
    },
    after: () => ({ say: '' }),
    symbolOf: () => ''
};

// ---------------------------------------------------------------------------------------------- the provider

// a plot's colour, axes and hover entries of a grouping, and a table's columns, follow their panel in a remap (CAT-9)
registerPanelSourceType(GROUP_TYPE);

registerSource({
    type: GROUP_TYPE,
    label: VOCABULARY.sourceType.grouping,
    valueType: 'categorical',
    entity: 'cells',
    consumers: ['cell-plot', 'cell-table'],
    axes: ['x', 'y', 'z', 'color', 'hover', 'column'],
    // large-plot mode draws a grouping as colour, never as an axis (CAT-3)
    largeAxes: ['color'],
    largeAxesReason: LARGE_AXIS_REASON,
    aggregate: groupAggregate,
    defaultSub: '',
    // a grouping's colours are its own (SHR-11): the first palette option says so, not the dataset's uns
    paletteLabel: VOCABULARY.phrase.ownColors(W.grouping),
    entities: groupingList,
    keyEntries: groupKeyEntries,
    newEntity: { value: NEW_GROUPING, run: (nextTo) => PanelManager.createPanelNextTo(GROUPING_PANEL, nextTo) || null },
    subKeys: () => [],
    load: loadForPlot,
    loadLarge: loadLargeForPlot,
    cost,
    hover: {
        group: GROUPINGS,
        options: groupHoverOptions,
        valueOf: (setting) => groupValue(setting.key),
        parse: (value) => ({ key: value.slice(GROUP_PREFIX.length) }),
        label: groupingTitle
    },
    titleOf: (setting) => `${W.grouping} ${groupingTitle(setting)}`,
    // a grouping as a column of a Cell Table (CAT-6, CAT-7): panels/cell-grouping/table-column.js
    table: createGroupTable({ sources: () => groupSources().sources, titleOf: groupingTitle, groupingPanel,
        describe: (snap, ctx) => describeGrouping(withFigures(snap), ctx), open: openGrouping, missingOf }),
    placeholder: drawGroupPlaceholder,
    releaseHost: (host) => { if (_binding) _binding.releaseHost(host); },
    vocabulary: { result: W.grouping }
});
