/**
 * The page's side of the `group-stat` source: a Cell Grouping's group as the cells whose statistic colours a Gene Plot, or
 * is its x, y or z axis (each axis its own setting and record; the moments are shared by the key they are asked under)
 * (offered-removal-080.md 10.1, SO-8b). Each gene's value is one statistic (mean, % expressing, mean of expressing cells,
 * sum, SD) of that gene over the group's cells, on a layer.
 *
 * A setting is `{type, key, column, stat, layer, groupWas, follow?}` (utils/group-stat-model.js): the grouping's panel id,
 * the canonical JSON of the group's key, the statistic, the layer, the default labels of the group's levels when it was
 * chosen, and whether it follows its key. The server sends the five moments of every gene over the group once
 * (`shape: "genes"`); every statistic is derived here, so switching between statistics sends nothing, and an edit of the
 * grouping's Expressed above sends one request.
 *
 * Two handles back one record: the GROUPING's (its groups, to resolve the group's reference: ok, changed or gone) and the
 * MOMENTS' (utils/group-sources.js `watchGenes`), made once the grouping's groups are there and the group is one of them.
 * A group that is gone asks for nothing. Its structure follows utils/cell-group-source.js.
 *
 * The notices are the sources' (utils/source-notices.js) in a grouping's words, with two of their own: a group that has
 * changed (Keep, Choose another) and one that is gone (Choose another).
 */
import { drawPlaceholder } from './panel-surface.js';
import { Coverage, GAP } from './coverage.js';
import { describeSource, paintProgress, sentenceOf, coverageKindOf } from './source-notices.js';
import { actions } from './source-actions.js';
import { createHostBinding, isVisible, panelIdOf } from './host-binding.js';
import { registerSource, SourceUnavailable } from './source-registry.js';
import { registerPanelSourceType } from './panel-references.js';
import { groupSources } from './group-host.js';
import { VOCABULARY } from './vocabulary.js';
import { referToGroup, resolveGroup, keepGroup, describeGroupReference } from './group-reference.js';
import { layerFacts, datasetLayersNow } from './score-source.js';
import * as M from './group-stat-model.js';

const W = VOCABULARY.word;
const PL = VOCABULARY.plural;

/** The type of the source this module provides: what a consumer's setting names. */
const TYPE = 'group-stat';

/** The panel type whose panels are groupings. */
const GROUPING_PANEL = 'cell-grouping';

/** The value that is not a grouping: "New grouping…" in the key list. */
const NEW_GROUPING = '__new_grouping__';

/** The page's panel registry (window.PanelManager): importing panel-manager.js would load every panel. */
const PanelManager = {
    getPanel: (id) => (globalThis.PanelManager ? globalThis.PanelManager.getPanel(id) : null),
    getAllPanels: () => (globalThis.PanelManager ? globalThis.PanelManager.getAllPanels() : []),
    getActivePanels: () => (globalThis.PanelManager ? globalThis.PanelManager.getActivePanels() : []),
    reopenClosedPanel: (id, opts) => globalThis.PanelManager.reopenClosedPanel(id, opts),
    createPanelNextTo: (type, nextTo) => globalThis.PanelManager.createPanelNextTo(type, nextTo)
};

const isGrouping = (panel) => !!panel && typeof panel.getType === 'function' && panel.getType() === GROUPING_PANEL;

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

/** The key list of a setting: every grouping, open or closed; the one held when it is gone; and the way to make one. */
function keyEntries(list, setting) {
    const options = list.map((g) => ({ value: g.id, text: g.title }));
    const held = setting && setting.key;
    if (held && held.startsWith(`${GROUPING_PANEL}-`) && !list.some((g) => g.id === held)) {
        options.push({ value: held, text: `${setting.label || held} (deleted)` });
    }
    if (!options.length) options.push({ value: '', text: `No ${PL.grouping} yet` });
    options.push({ value: NEW_GROUPING, text: `New ${W.grouping}…` });
    return options;
}

// ---------------------------------------------------------------------------------------------- the groups of a grouping

/** grouping id -> {handle, reply}: what the menus read of a grouping's groups (held while a menu may list them). */
const MENUS = new Map();

/**
 * The reply of a grouping (its groups) as a menu reads it: null until it is there. The first ask holds a watch on the
 * grouping, which computes it if nothing else has; the menus are built again when the reply arrives.
 */
function menuReply(id) {
    let held = MENUS.get(id);
    if (!held) {
        held = { reply: null, handle: null, names: null, off: null };
        MENUS.set(id, held);
        held.handle = groupSources().sources.watch(id, {
            consumer: { kind: 'plot', role: 'menu', panelId: null, host: null }, option: {}, visible: () => true,
            onChange: (snap) => {
                const reply = snap.values && snap.values.reply ? snap.values.reply : null;
                if (reply === held.reply) return;
                held.reply = reply;
                if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('annzarro:panels-changed'));
            }
        });
        const snap = held.handle.read();
        held.reply = snap.values && snap.values.reply ? snap.values.reply : null;
        // a rename of a group (or of a level) is an edit of the grouping that asks for nothing: the menus and the plots'
        // titles name it again (the names are made once per reply and recipe, so this is false until they change)
        held.off = groupSources().sources.onSource(id, () => {
            const names = held.reply ? groupSources().sources.namesOf(id, held.reply) : null;
            if (names === held.names) return;
            held.names = names;
            if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('annzarro:panels-changed'));
        });
        held.names = held.reply ? groupSources().sources.namesOf(id, held.reply) : null;
    }
    return held.reply;
}

/** A menu's hold on a grouping is let go when the grouping is gone. */
function forgetMenus() {
    for (const [id, held] of [...MENUS]) {
        if (groupingPanel(id)) continue;
        held.handle.release();
        if (held.off) held.off();
        MENUS.delete(id);
    }
}

/** The name the grouping gives the group a setting names now (a rename shows), else the labels it was chosen by. */
function groupNameOf(setting) {
    const held = MENUS.get(setting.key);
    const key = M.groupKeyOf(setting);
    if (held && held.reply && key) {
        const i = held.reply.groups.findIndex((g) => M.columnOf(g.key) === setting.column);
        if (i >= 0) return groupSources().sources.namesOf(setting.key, held.reply)[i];
    }
    return Array.isArray(setting.groupWas) ? setting.groupWas.join(' | ') : '';
}

const kindsNow = () => layerFacts(datasetLayersNow() || [M.DEFAULT_LAYER]).kinds;
const layoutsNow = () => layerFacts(datasetLayersNow() || [M.DEFAULT_LAYER]).layouts;
const layersNow = () => datasetLayersNow() || [M.DEFAULT_LAYER];

/**
 * The group select (the registry's subKeyMenu): every group of the grouping by its name, in group order; none chosen
 * until the user picks one (nothing is asked before that); a held group the grouping no longer has stays, marked.
 */
function groupMenu(setting) {
    const id = setting && setting.key;
    const reply = id && groupingPanel(id) ? menuReply(id) : null;
    const choose = { value: '', text: id ? (reply ? 'Choose a group' : 'Groups…') : 'Choose a grouping first', column: '', disabled: true };
    if (!reply) return { options: [choose], chosen: '', adopt: null, search: true };
    const names = groupSources().sources.namesOf(id, reply);
    // a group is found by the name it is shown with (a label the user gave it) and by its generated name
    const generated = groupSources().sources.coloursOf(id, reply).generated;
    const options = [choose, ...reply.groups.map((g, i) => ({ value: M.columnOf(g.key), text: names[i], column: M.columnOf(g.key),
        alt: generated[i] !== names[i] ? generated[i] : '' }))];
    const held = setting.column || '';
    if (held && M.groupKeyOf(setting) && !options.some((o) => o.value === held)) {
        const was = Array.isArray(setting.groupWas) ? setting.groupWas.join(' | ') : held;
        options.push({ value: held, text: `${was} (no longer a group)`, column: held });
    }
    return { options, chosen: held, adopt: null, search: true };
}

/** The statistic select (the registry's statMenu): every statistic graded on the layer the setting holds. */
function statMenu(setting) {
    return M.statMenu(setting, kindsNow(), layoutsNow());
}

/** The layer select (the registry's layerMenu): every layer, graded for the setting's statistic. */
function layerMenu(setting) {
    return M.layerMenu(setting, kindsNow(), layersNow());
}

/**
 * The setting's fields after the user touched one of its selects (the registry's settingAfter): the group chosen (its
 * key and default labels, no longer following), or the statistic or the layer, the other moving only when it became
 * impossible, said once. A first group chosen also writes the statistic and layer the menus show.
 * @returns {Object|null} the fields to write (`undefined` removes one), with `say`; null when nothing changes
 */
function settingAfter(setting, touched, value) {
    if (touched === 'stat' || touched === 'layer') {
        const p = M.pairAfter(setting, touched, value, kindsNow(), layersNow());
        return { stat: p.stat, layer: p.layer, say: p.say };
    }
    const reply = setting.key ? menuReply(setting.key) : null;
    if (!value) return { column: '', groupWas: undefined, follow: undefined, say: '' };
    const key = M.groupKeyOf({ column: value });
    const labelled = reply && key ? groupSources().sources.labelsOf(setting.key, reply) : null;
    const ref = labelled ? referToGroup(labelled, key) : null;
    return { column: value, groupWas: ref ? ref.groupWas : key, follow: undefined, stat: M.statOf(setting), layer: M.layerOf(setting), say: '' };
}

// ---------------------------------------------------------------------------------------------- names

/**
 * Write into a consumer's setting what it is called: `label`, the grouping's title (kept for when it is deleted), and
 * `labelFull`, the two lines a colour bar is titled by: the grouping and the group, then the statistic and the layer.
 * @returns {boolean} whether either changed
 */
function nameSetting(setting) {
    const title = groupingTitle(setting);
    const panel = groupingPanel(setting.key);
    const above = panel && typeof panel.getConfig === 'function' ? M.thresholdOf(panel.getConfig()) : 0;
    const threshold = ['pct_expressing', 'mean_expressing'].includes(M.statOf(setting)) ? ` (> ${Number(above.toPrecision(4))})` : '';
    // the Cell-Gene Plot's words for a statistic: "Mean · logged", "% expressing (> 0) · counts"
    const lines = [[title, groupNameOf(setting)].filter(Boolean).join(' · '), `${VOCABULARY.cellGene.statistic[M.statOf(setting)]}${threshold} · ${M.layerOf(setting)}`].join('\n');
    const changed = (!!title && setting.label !== title) || setting.labelFull !== lines;
    if (title) setting.label = title;
    setting.labelFull = lines;
    return changed;
}

// ---------------------------------------------------------------------------------------------- notices

/** What a group's notices call things (utils/source-notices.js): the grouping's words, with the group's own states. */
const VOCAB = Object.freeze({
    thing: W.grouping, source: W.grouping, result: 'group statistic', Computing: 'Computing', progressUnit: 'values',
    found: 'cells', act: { to: 'group', ing: W.grouping },
    tags: { computing: 'Group statistic…', refused: 'Group statistic refused', failed: 'Group statistic failed' },
    off: 'Cell Grouping is turned off on this server.',
    states: {
        unset(snap, f) {
            return f.out('unset', 'notice', 'No group', 'No group is chosen.', '', [f.choose]);
        },
        gone(snap, f) {
            const d = describeGroupReference({ state: 'gone', was: snap.was, say: false }, snap.title || 'the grouping');
            return f.out('gone', 'warning', d.tag, d.text, '', [f.choose]);
        },
        changed(snap, f) {
            const g = snap.group;
            const d = describeGroupReference(g, snap.title || 'the grouping');
            return f.out('changed', 'notice', d.tag, d.text || `This group has changed: was '${g.was}', now '${g.now}'.`, '',
                [['group-keep', 'Keep'], f.choose]);
        }
    }
});

function describe(snap, ctx = {}) {
    // a group that has changed still draws; its tag says so
    if (snap && snap.group && snap.group.state === 'changed' && snap.values) return describeSource({ ...snap, state: 'changed' }, ctx, VOCAB);
    return describeSource(snap, ctx, VOCAB);
}

const roleWord = (role) => (role === 'color' ? 'colour' : role);

const unavailable = (notice, coverage, state = null) => new SourceUnavailable(notice.headline, notice, coverage, state, TYPE);

const missingCoverage = (notice, setting, unit, total, kind) => Coverage.missing(GAP.UNAVAILABLE, sentenceOf(notice),
    { source: `${W.grouping} ${groupingTitle(setting)}`, unit, total, kind });

// ---------------------------------------------------------------------------------------------- records

/** Whether the plot still reads the group a record holds (the user may have changed the colour). */
function stillUsed(rec) {
    const panel = rec.panelId ? PanelManager.getPanel(rec.panelId) : null;
    if (!panel || typeof panel.getConfig !== 'function') return true;
    const s = panel.getConfig()[rec.role];
    return !!(s && s.type === TYPE && s.key === rec.groupId && (s.column || '') === rec.column && M.layerOf(s) === rec.layer
        && (M.statOf(s) === M.ZSCORE) === rec.z);
}

function refreshPanel(host) {
    const panel = PanelManager.getPanel(panelIdOf(host));
    const reload = panel && (panel.refreshPlot || panel.refreshTable);
    if (typeof reload === 'function') Promise.resolve(reload()).catch(() => {});
}

function drawGroupPlaceholder(host, notice) {
    if (!host) return;
    const unit = 'genes';
    const cov = Coverage.missing(GAP.UNAVAILABLE, notice.headline, { source: 'group statistic', unit, total: null, kind: coverageKindOf(notice) });
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

/** The id of this provider: its notices on the painter, its actions in the registry. */
const PROVIDER = 'plot-group-stat';

let _binding = null;

/**
 * The handle a record reads: the grouping's and, once the group is one of its groups, the moments'. Its snapshot is the
 * moments' with what the group's reference says (`group`), or the state the group or the grouping is in.
 */
function openRecord(host, role, setting, onChange) {
    const { sources } = groupSources();
    const id = setting.key;
    const consumer = { kind: 'plot', role, panelId: panelIdOf(host), host };
    const rec = { groupId: id, column: setting.column || '', layer: M.layerOf(setting), z: M.statOf(setting) === M.ZSCORE, consumer, seen: new Map(), handle: null, stat: null };
    const visible = () => isVisible(host);
    let note = () => {};
    const grouping = sources.watch(id, { consumer, option: {}, visible, onChange: () => note() });
    let moments = null;
    const stop = () => { if (moments) { moments.release(); moments = null; } };

    function read() {
        const s = rec.setting || setting;
        const g = grouping.read();
        const title = g.title || groupingTitle(s);
        if (!(g.values && g.values.reply)) { stop(); return { ...g, title }; }
        const ref = M.referenceOf(s);
        if (!ref) { stop(); return { state: 'unset', title, key: null }; }
        const labelled = sources.labelsOf(id, g.values.reply);
        const found = resolveGroup(ref, labelled, rec.seen);
        if (found.state === 'gone') { stop(); return { state: 'gone', title, was: found.was, key: null, group: found }; }
        if (found.update) Object.assign(s, { groupWas: found.update.groupWas });     // follows its key, silently
        if (!moments) {
            moments = sources.watchGenes(id, { consumer, option: { group: ref.group, layer: M.layerOf(s), ...(rec.z ? { transform: 'zscore' } : {}) }, visible, onChange: () => note() });
        }
        const out = moments.read();
        return { ...out, title, group: found, held: g.held, groupName: groupNameOf(s) };
    }
    note = () => onChange(read());
    rec.handle = {
        read,
        release() { stop(); grouping.release(); },
        sharers: () => (moments ? moments.sharers() : grouping.sharers()),
        // the buttons go to whichever of the two is waiting
        compute() { (moments && grouping.read().values ? moments : grouping).compute(); },
        retry() { (moments && grouping.read().values ? moments : grouping).retry(); },
        cancel() { (moments && grouping.read().values ? moments : grouping).cancel(); }
    };
    return rec;
}

function binding() {
    if (!_binding) {
        _binding = createHostBinding({
            id: PROVIDER,
            open: openRecord,
            matches: (rec, setting) => rec.groupId === setting.key && rec.column === (setting.column || '') && rec.layer === M.layerOf(setting)
                && rec.z === (M.statOf(setting) === M.ZSCORE),
            describe,
            stillUsed,
            stale: (rec, snap) => (!!rec.drawnKey && !!snap.title && snap.title !== rec.setting.label)
                || (!!rec.drawnKey && rec.drawnName !== undefined && snap.groupName !== undefined && snap.groupName !== rec.drawnName)
                || (rec.drawnKey === null && rec.drawnKind !== undefined && coverageKindOf(snap) !== rec.drawnKind),
            refresh: refreshPanel,
            visibilityChanged: () => groupSources().sources.visibilityChanged(),
            placeholder: drawGroupPlaceholder
        });
    }
    return _binding;
}

// ---------------------------------------------------------------------------------------------- the series

/** moments -> {stat -> values}: a statistic is made once from the moments it is read of. */
const DERIVED = new WeakMap();

/** The statistic of every gene as a plain array (the regular plot's form), made once per moments and statistic. */
function valuesOf(moments, stat, genes) {
    let byStat = DERIVED.get(moments);
    if (!byStat) DERIVED.set(moments, byStat = new Map());
    let values = byStat.get(stat);
    if (!values) byStat.set(stat, values = Array.from(M.statValues(stat, moments, genes)));
    return values;
}

/**
 * The series of a group's statistic for a Gene Plot's colour.
 * @param {Object} setting
 * @param {{host: HTMLElement, role: string, expected: (number|null), unit?: string, quiet?: boolean}} opts
 * @throws {SourceUnavailable} when no values can be drawn
 */
function loadSeries(setting, { host, role, expected, unit = 'genes', quiet = false }) {
    nameSetting(setting);
    if (!host || !setting.key || !M.groupKeyOf(setting)) {
        const notice = describe({ state: 'unset', title: groupingTitle(setting) }, { role: roleWord(role) });
        throw unavailable(notice, missingCoverage(notice, setting, unit, expected, 'stopped'));
    }
    const rec = binding().recordFor(host, role, setting);
    const snap = rec.handle.read();
    if (snap.values && snap.values.moments) {
        const genes = Number(snap.values.reply.n_var);
        rec.drawnKey = snap.shownKey || snap.key;
        rec.drawnName = snap.groupName;
        rec.drawnKind = undefined;
        binding().paint(host);
        const values = valuesOf(snap.values.moments, M.statOf(setting), genes);
        return { type: 'numerical', values, coverage: Coverage.complete(values.length, 'genes') };
    }
    rec.drawnKey = null;
    rec.drawnKind = coverageKindOf(snap);
    const ctx = { role: roleWord(role), sharers: rec.handle.sharers() };
    const notice = describe(snap, ctx) || describe({ ...snap, state: 'estimating' }, ctx);
    if (!(quiet && ['idle', 'estimating', 'queued', 'computing', 'updating'].includes(snap.state))) binding().paint(host);
    throw unavailable(notice, missingCoverage(notice, setting, unit, expected, coverageKindOf(snap)), snap.state);
}

function loadForPlot(setting, { host, role, expected, unit = 'genes', signal }) {
    return binding().loadWhenReady((quiet) => loadSeries(setting, { host, role, expected, unit, quiet }), { host, role }, signal);
}

// ---------------------------------------------------------------------------------------------- actions

/** The select a plot's grouping is chosen in, to take the user to: null when the plot has none. */
function chooser(host, role) {
    const tile = host.closest ? host.closest('.tile') : null;
    const select = tile && tile.querySelector(`.axis-key-select[data-axis="${role}"]`);
    if (!select) return null;
    return { focus() { if (select.scrollIntoView) select.scrollIntoView({ block: 'nearest' }); select.focus(); } };
}

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

/** Keep (UX 2.8): the group as it is now, following its key from now on. The plot draws again with the setting. */
function keep(rec, host) {
    const panel = PanelManager.getPanel(panelIdOf(host));
    const held = panel && typeof panel.getConfig === 'function' ? panel.getConfig()[rec.role] : null;
    const reply = menuReply(rec.groupId);
    const ref = held ? M.referenceOf(held) : null;
    if (!held || !ref || !reply) return;
    Object.assign(held, keepGroup(ref, groupSources().sources.labelsOf(rec.groupId, reply)));
    nameSetting(held);
    refreshPanel(host);
}

actions.register({
    id: PROVIDER,
    owns: (host) => !!binding().shownRecord(host),
    actions: {
        'score-compute': { target: (host) => (binding().recordsOf(host).size ? host : null), run: (host) => { for (const r of binding().recordsOf(host).values()) r.handle.compute(); } },
        'score-cancel': { target: (host) => binding().shownRecord(host) || null, run: (rec) => { rec.handle.cancel(); } },
        'score-retry': { target: (host) => binding().shownRecord(host) || null, run: (rec) => { rec.handle.retry(); } },
        'score-update': { target: (host) => binding().shownRecord(host) || null, run: (rec) => { groupSources().sources.update(rec.groupId); } },
        'score-open': { target: (host) => { const rec = binding().shownRecord(host); return rec && groupingPanel(rec.groupId) ? rec : null; },
            run: (rec, host) => { openGrouping(rec.groupId, panelIdOf(host)); } },
        'score-choose': { target: (host) => { const rec = binding().shownRecord(host); return rec ? chooser(host, rec.role) : null; }, run: (place) => { place.focus(); } },
        'group-keep': { target: (host) => { const rec = binding().shownRecord(host); return rec && rec.handle.read().group && rec.handle.read().group.state === 'changed' ? rec : null; },
            run: (rec, host) => { keep(rec, host); } }
    }
});

// ---------------------------------------------------------------------------------------------- events from the page

/** Panels were added, removed, closed, reopened or renamed: a deleted grouping shows, a returned one resolves. */
function panelsChanged() {
    forgetMenus();
    if (!_binding || !_binding.hosts().length) return;
    const { sources } = groupSources();
    sources.recheck();
    sources.contextChanged();
    for (const host of _binding.hosts()) {
        for (const rec of _binding.recordsOf(host).values()) {
            if (rec.drawnKey && (groupingTitle(rec.setting) !== rec.setting.label
                || (rec.drawnName !== undefined && groupNameOf(rec.setting) !== rec.drawnName))) _binding.refreshSoon(host);
        }
        _binding.schedulePaint(host);
    }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('annzarro:panels-changed', () => panelsChanged());
}

// ---------------------------------------------------------------------------------------------- the provider

// a Gene Plot's colour of a group's statistic follows its grouping in a remap, as the grouping's own sources do
registerPanelSourceType(TYPE);

registerSource({
    type: TYPE,
    label: VOCABULARY.sourceType.groupStat,
    valueType: 'numerical',
    entity: 'genes',
    consumers: ['gene-plot'],
    axes: ['x', 'y', 'z', 'color'],
    defaultSub: '',
    layered: true,
    // made over the cells shown: a change of the cell subset changes it (utils/subset-reads.js)
    readsCellSubset: true,
    entities: groupingList,
    keyEntries,
    newEntity: { value: NEW_GROUPING, run: (nextTo) => PanelManager.createPanelNextTo(GROUPING_PANEL, nextTo) || null },
    subKeys: () => [],
    subKeyMenu: groupMenu,
    statMenu,
    layerMenu,
    settingAfter,
    load: loadForPlot,
    titleOf: (setting) => `${W.grouping} ${groupingTitle(setting)}`,
    placeholder: drawGroupPlaceholder,
    releaseHost: (host) => { if (_binding) _binding.releaseHost(host); },
    vocabulary: { result: 'group statistic' }
});
