/**
 * G9a: the Cell Grouping panel's models, without a page.
 *
 *   - its references (one declaration, plan 1.4): a factor's table, score or grouping is a `partitioning` reference
 *     that follows a remap, is an edge of the graph, and makes the panel a user of that panel (GRP-13);
 *   - the factors (GRP-3, GRP-4, GRP-8, GRP-10): what each Add factor entry makes, the limits (SHR-6, SHR-13), the
 *     operations of a card (move, duplicate, remove, tick, rename, the rest), and the options of a reference menu
 *     that would close a loop, unavailable with their reason (operator decision 15);
 *   - the status of UX 2.3 and every state of UX 2.6 (GRP-7, GRP-11, GRP-14, GRP-16, SHR-12, SHR-13, SHR-34);
 *   - the Settings row (SHR-12, UX 2.5).
 *
 * Run:  node --test annzarro/tests/js/cell-grouping-panel.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    registerReferences, remapReferences, dependsOn, usersOf, setReferenceHost, referencedFields
} from '../../../static/js/utils/panel-references.js';
import { normalizeGrouping } from '../../../static/js/utils/cell-grouping.js';
import {
    groupingReferences, factorKind, columnFactor, cellNamesFactor, cellNamesRefusal, addFactorRefusal,
    moveFactor, duplicateFactor, removeFactor, referenceChoices, missingFactors, factorTitle, factorSummary,
    levelPreview, tickLevel, tickAll, tickNone, sortByCells, renameLevel, setRest, moveLevel, levelRows,
    tooManyLevelsText, scoreFactor, geneFactor, tableFactor, neighborsFactor
} from '../../../static/js/panels/cell-grouping/factors.js';
import { describeStatus, smallLine, noGroupReasons, usedByText, deleteInUseText } from '../../../static/js/panels/cell-grouping/status.js';
import { settingsSummary, separatorProblem, thresholdProblem } from '../../../static/js/panels/cell-grouping/settings.js';

const golden = (name) => JSON.parse(readFileSync(new URL(`../data/golden/${name}.json`, import.meta.url), 'utf8'));

registerReferences('cell-grouping', groupingReferences);

const STRUCTURE = {
    obs: { columns: ['_index', 'cell_type', 'condition', 'depth', 'is_doublet', 'batch'],
        columns_info: { cell_type: { type: 'categorical', n_categories: 6 }, condition: { type: 'categorical', n_categories: 2 },
            depth: { type: 'float64' }, is_doublet: { type: 'bool' }, batch: { type: 'int64' } } },
    obsm: { dataframes: {}, keys: ['X_umap', 'X_wide'], info: { X_umap: { shape: [1200, 2] }, X_wide: { shape: [1200, 50] } } },
    layers: ['logged', 'counts'],
    obsp: { keys: ['connectivities'] }
};

// ------------------------------------------------------------------------------------------- references

const tableSource = (key) => ({ source: { type: 'table', key } });
const scoreSource = (key) => ({ source: { type: 'gene-score', key, column: 'zscore_mean', layer: 'X' } });
const groupSource = (key) => ({ source: { type: 'cell-group', key } });

test('a factor naming a table, a score or a grouping is a partitioning reference, and nothing else is', () => {
    const config = { title: 'Grouping 1', version: 1, partitionings: [
        { source: { type: 'obs', key: 'cell_type' } }, tableSource('cell-table-1'), scoreSource('gene-signature-2'),
        groupSource('cell-grouping-3'), { source: { type: 'layer', key: 'logged', column: 'GENE001' }, binning: { method: 'equal_count' } }] };
    const refs = groupingReferences(config);
    assert.deepEqual(refs.map(r => [r.id, r.via, r.field]),
        [['cell-table-1', 'partitioning', 'partitionings'], ['gene-signature-2', 'partitioning', 'partitionings'],
         ['cell-grouping-3', 'partitioning', 'partitionings']]);
    assert.deepEqual(referencedFields(config, 'cell-grouping'), ['partitionings']);
    // a hand-edited link never throws
    for (const bad of [{}, { partitionings: 'x' }, { partitionings: [null, 3, { source: null }, { source: { type: 'table' } }] }]) {
        assert.deepEqual(groupingReferences(bad), []);
    }
});

test('a remap round trip moves every reference of a grouping, ids that swap places included (CAT-9)', () => {
    for (const name of ['cell_grouping_1', 'cell_grouping_3', 'cell_grouping_6_named40']) {
        const config = { id: 'cell-grouping-A', title: 'G', ...golden(name) };
        const before = JSON.stringify(config);
        remapReferences([config], { 'cell-table-x': 'cell-table-y' });
        assert.equal(JSON.stringify(config), before, `${name}: a remap that names none of its panels changes nothing`);
    }
    const config = { id: 'cell-grouping-A', partitionings: [tableSource('t1'), tableSource('t2'), groupSource('g1'), scoreSource('s1')] };
    remapReferences([config], { t1: 't2', t2: 't1', g1: 'g9', s1: 's7' });
    assert.deepEqual(config.partitionings.map(p => p.source.key), ['t2', 't1', 'g9', 's7']);
    remapReferences([config], { t2: 't1', t1: 't2', g9: 'g1', s7: 's1' });
    assert.deepEqual(config.partitionings.map(p => p.source.key), ['t1', 't2', 'g1', 's1']);
    // the normalised recipe reads the remapped config unchanged
    assert.deepEqual(normalizeGrouping(config).recipe.partitionings.map(p => p.source.key), ['t1', 't2', 'g1', 's1']);
});

/** A page of panels for the graph: id -> {type, config}. */
function page(panels) {
    setReferenceHost({ panel: (id) => panels[id] || null, ids: () => Object.keys(panels) });
}

test('a grouping depends on its tables, scores and groupings, and is a user of each (GRP-13)', () => {
    page({
        'cell-table-T': { type: 'cell-table', config: {} },
        'gene-signature-S': { type: 'gene-signature', config: {} },
        'cell-grouping-A': { type: 'cell-grouping', config: { partitionings: [tableSource('cell-table-T'), scoreSource('gene-signature-S')] } },
        'cell-grouping-B': { type: 'cell-grouping', config: { partitionings: [groupSource('cell-grouping-A')] } }
    });
    assert.deepEqual(dependsOn('cell-grouping-A'), ['cell-table-T', 'gene-signature-S']);
    assert.deepEqual(dependsOn('cell-grouping-B'), ['cell-grouping-A']);
    assert.deepEqual(usersOf('cell-grouping-A'), [{ panelId: 'cell-grouping-B', kind: 'cell-grouping' }]);
    assert.deepEqual(usersOf('cell-table-T'), [{ panelId: 'cell-grouping-A', kind: 'cell-grouping' }]);
});

test('"Used by" names the users by kind: plots, tables, groupings (GRP-7)', () => {
    assert.equal(usedByText([]), '');
    assert.equal(usedByText([{ kind: 'cell-plot' }]), 'Used by 1 plot');
    assert.equal(usedByText([{ kind: 'cell-plot' }, { kind: 'cell-count' }, { kind: 'cell-table' }]), 'Used by 2 plots, 1 table');
    assert.equal(usedByText([{ kind: 'cell-grouping' }, { kind: 'cell-gene' }]), 'Used by 1 plot, 1 grouping');
    assert.equal(usedByText([{ kind: 'gene-set' }, { kind: 'some-future-type' }]), 'Used by 2 panels', 'a kind not declared counts as a panel');
    assert.equal(deleteInUseText('T cell score', [{ kind: 'cell-plot' }]), "Delete 'T cell score'? 1 plot uses it.");
    assert.equal(deleteInUseText('Grouping 1', [{ kind: 'cell-plot' }, { kind: 'cell-count' }, { kind: 'gene-table' }]),
        "Delete 'Grouping 1'? 2 plots and 1 table use it.");
});

// ------------------------------------------------------------------------------------------- loops in menus

test('a reference menu shows the options that would close a loop as unavailable, with the reason (OD 15)', () => {
    page({
        'cell-grouping-A': { type: 'cell-grouping', config: { partitionings: [] } },
        // the table is filtered by grouping A: it depends on A
        'cell-table-T': { type: 'cell-table', config: { tableFilter: 'cell-grouping-A' } },
        'cell-table-U': { type: 'cell-table', config: {} },
        // grouping B uses grouping A
        'cell-grouping-B': { type: 'cell-grouping', config: { partitionings: [groupSource('cell-grouping-A')] } }
    });
    const choices = referenceChoices('cell-grouping-A', [
        { id: 'cell-table-T', title: 'Table 1' }, { id: 'cell-table-U', title: 'Table 2' },
        { id: 'cell-grouping-B', title: 'Grouping 2' }, { id: 'cell-grouping-A', title: 'Grouping 1' }
    ]);
    assert.deepEqual(choices.map(c => [c.id, c.disabled]),
        [['cell-table-T', true], ['cell-table-U', false], ['cell-grouping-B', true]], 'itself is not listed');
    assert.equal(choices.find(c => c.id === 'cell-grouping-B').reason, 'Uses Grouping 2, which depends on this grouping');
    assert.equal(choices.find(c => c.id === 'cell-table-T').reason, 'Uses Table 1, which depends on this grouping');
    assert.equal(choices.find(c => c.id === 'cell-table-U').reason, null);
});

// ------------------------------------------------------------------------------------------- factors

test('Add factor: a column is categorical at once, a number gets equal-count bins (GRP-3)', () => {
    assert.deepEqual(columnFactor(STRUCTURE, 'obs', 'cell_type'), { source: { type: 'obs', key: 'cell_type' } });
    assert.deepEqual(columnFactor(STRUCTURE, 'obs', 'is_doublet'), { source: { type: 'obs', key: 'is_doublet' } });
    assert.deepEqual(columnFactor(STRUCTURE, 'obs', 'depth'), { source: { type: 'obs', key: 'depth' }, binning: { method: 'equal_count' } });
    assert.deepEqual(columnFactor(STRUCTURE, 'obs', 'batch'), { source: { type: 'obs', key: 'batch' }, binning: { method: 'equal_count' } });
    assert.deepEqual(columnFactor(STRUCTURE, 'obsm', 'X_umap', '1'),
        { source: { type: 'obsm', key: 'X_umap', column: '1' }, binning: { method: 'equal_count' } });
    assert.deepEqual(geneFactor('logged', 'GENE001'),
        { source: { type: 'layer', key: 'logged', column: 'GENE001' }, binning: { method: 'equal_count' } });
    assert.deepEqual(scoreFactor('gene-signature-S', 'zscore_mean', 'X'),
        { source: { type: 'gene-score', key: 'gene-signature-S', column: 'zscore_mean', layer: 'X' }, binning: { method: 'equal_count' } });
    assert.deepEqual(tableFactor('cell-table-T'), { source: { type: 'table', key: 'cell-table-T' } });
    assert.deepEqual(neighborsFactor('connectivities', 'CELL0001'),
        { source: { type: 'obsp', key: 'connectivities', column: 'CELL0001' }, binning: { method: 'equal_count' } });
    assert.deepEqual(cellNamesFactor(STRUCTURE), { source: { type: 'obs', key: '_index' } });
    // every factor made here passes the recipe's normaliser unchanged
    for (const p of [columnFactor(STRUCTURE, 'obs', 'depth'), tableFactor('t'), cellNamesFactor(STRUCTURE)]) {
        assert.deepEqual(normalizeGrouping({ partitionings: [p] }).recipe.partitionings[0], p);
    }
    assert.equal(factorKind(columnFactor(STRUCTURE, 'obs', 'cell_type')), 'categorical');
    assert.equal(factorKind(columnFactor(STRUCTURE, 'obs', 'depth')), 'binned');
    assert.equal(factorKind(tableFactor('t')), 'table');
    assert.equal(factorKind(groupSource('g')), 'grouping');
});

test('the limits: 8 factors (SHR-13) and one group per cell up to 2,000 cells shown (SHR-6)', () => {
    const eight = { partitionings: Array.from({ length: 8 }, () => ({ source: { type: 'obs', key: 'cell_type' } })) };
    assert.equal(addFactorRefusal({ partitionings: [] }), null);
    assert.equal(addFactorRefusal(eight), 'A grouping holds up to 8 factors. Remove one first.');
    assert.equal(cellNamesRefusal(2000), null);
    assert.equal(cellNamesRefusal(8090),
        'One group per cell needs at most 2,000 cells shown; 8,090 are shown. Use a subset, or bin a numeric value instead.');
    assert.equal(tooManyLevelsText('cell_id', 8090),
        'cell_id has 8,090 levels; a factor holds up to 2,000. Tick the levels to keep, use a subset, or bin a numeric value.');
});

test('move, duplicate and remove return new lists and leave the old one alone (GRP-4)', () => {
    const list = [{ source: { type: 'obs', key: 'a' } }, { source: { type: 'obs', key: 'b' } }, { source: { type: 'obs', key: 'c' } }];
    const keys = (l) => l.map(p => p.source.key);
    assert.deepEqual(keys(moveFactor(list, 2, 0)), ['c', 'a', 'b']);
    assert.deepEqual(keys(moveFactor(list, 0, 1)), ['b', 'a', 'c']);
    assert.deepEqual(keys(moveFactor(list, 0, -1)), ['a', 'b', 'c'], 'past the ends: no move');
    const dup = duplicateFactor(list, 1);
    assert.deepEqual(keys(dup), ['a', 'b', 'b', 'c']);
    assert.notEqual(dup[2], dup[1], 'an independent copy');
    assert.deepEqual(keys(removeFactor(list, 0)), ['b', 'c']);
    assert.deepEqual(keys(list), ['a', 'b', 'c']);
});

const INFO = { kind: 'categorical', levels: ['c:B cell', 'c:T cell', 'c:NK cell', '@na'], counts: [500, 300, 200, 20] };

test('a categorical card: tick, tick all and none, sort by cells, rename, the rest (SHR-2, SHR-10, GRP-8)', () => {
    const p = { source: { type: 'obs', key: 'cell_type' } };
    const off = tickLevel(p, INFO, 'c:T cell', false);
    assert.deepEqual(off.levels, ['c:B cell', 'c:NK cell'], 'unticking keeps a chosen list, @na is no choice');
    assert.deepEqual(tickLevel(off, INFO, 'c:T cell', true).levels, ['c:B cell', 'c:NK cell', 'c:T cell'], 'a ticked level goes last');
    assert.equal(tickAll(off).levels, undefined, 'all ticked is the default: nothing stored');
    assert.deepEqual(tickNone(p, INFO).levels, []);
    const sorted = sortByCells({ source: p.source, levels: ['c:NK cell', 'c:B cell'] }, INFO);
    assert.deepEqual(sorted.levels, ['c:B cell', 'c:NK cell']);
    assert.deepEqual(sortByCells(p, INFO).levels, ['c:B cell', 'c:T cell', 'c:NK cell']);
    assert.deepEqual(moveLevel({ ...p, levels: ['c:B cell', 'c:T cell'] }, INFO, 'c:T cell', -1).levels, ['c:T cell', 'c:B cell']);
    assert.deepEqual(moveLevel(p, INFO, 'c:NK cell', -1).levels, ['c:B cell', 'c:NK cell', 'c:T cell']);
    const renamed = renameLevel(p, 'c:T cell', 'T lymphocyte');
    assert.deepEqual(renamed.labels, { 'c:T cell': 'T lymphocyte' });
    assert.equal(renameLevel(renamed, 'c:T cell', '  ').labels, undefined, 'an empty name returns the default');
    assert.equal(renameLevel(renamed, 'c:T cell', 'T cell', 'T cell').labels, undefined, 'the default name is no rename');
    assert.equal(setRest(p, 'exclude').rest, 'exclude');
    assert.equal(setRest({ ...p, rest: 'exclude' }, 'other').rest, undefined, 'the default is not written');
    assert.equal(p.levels, undefined, 'the partitioning given is never changed');
});

test('level rows: ticked levels first in their order, then the unticked, "no value" last and not tickable', () => {
    const p = { source: { type: 'obs', key: 'cell_type' }, levels: ['c:NK cell', 'c:B cell'], labels: { 'c:B cell': 'B' } };
    const labels = new Map([['c:B cell', 'B cell'], ['c:T cell', 'T cell'], ['c:NK cell', 'NK cell'], ['@na', 'cell_type no value']]);
    assert.deepEqual(levelRows(p, INFO, labels).map(r => [r.id, r.label, r.ticked, r.n, r.tickable, r.was]), [
        ['c:NK cell', 'NK cell', true, 200, true, null],
        ['c:B cell', 'B', true, 500, true, 'B cell'],
        ['c:T cell', 'T cell', false, 300, true, null],
        ['@na', 'no value', null, 20, false, null]
    ]);
});

test('a card: its title, its kind and levels, and a preview of the first levels with counts', () => {
    const titleOf = (s) => (s.key === 'cell-table-T' ? 'Table 1' : undefined);
    assert.equal(factorTitle({ source: { type: 'obs', key: 'cell_type' } }, titleOf), 'cell_type');
    assert.equal(factorTitle(tableFactor('cell-table-T'), titleOf), 'in Table 1');
    assert.equal(factorTitle(geneFactor('logged', 'Cd3e'), titleOf), 'Cd3e');
    assert.equal(factorTitle({ source: { type: 'obs', key: 'cell_type' } }, titleOf, true), 'cell_type (not in this dataset)');
    assert.equal(factorSummary({ source: { type: 'obs', key: 'cell_type' } }, INFO), 'categorical · 4 levels');
    assert.equal(factorSummary(geneFactor('logged', 'Cd3e'), { levels: ['bin:0', 'bin:1'] }), 'binned · Equal count · 2 levels');
    assert.equal(factorSummary(tableFactor('t'), { levels: ['@in', '@out'] }), 'table · 2 levels');
    assert.equal(factorSummary({ source: { type: 'obs', key: 'cell_type' } }, null), 'categorical');
    const labels = new Map([['c:B cell', 'B cell'], ['c:T cell', 'T cell'], ['c:NK cell', 'NK cell'], ['@na', 'no value']]);
    assert.equal(levelPreview(INFO, labels, 2), 'B cell 500 · T cell 300 · +2');
    assert.equal(levelPreview({ levels: ['c:x'], counts: [1204] }, new Map([['c:x', 'x']]), 2), 'x 1,204');
});

test('a source the dataset lacks is found and named (GRP-14)', () => {
    const recipe = normalizeGrouping({ partitionings: [{ source: { type: 'obs', key: 'cell_type' } }, { source: { type: 'obs', key: 'gone' } },
        geneFactor('logged', 'Cd3e'), geneFactor('nolayer', 'GENE001'), { source: { type: 'obsm', key: 'X_pca', column: '0' }, binning: { method: 'equal_count' } },
        tableFactor('cell-table-gone'), tableFactor('cell-table-here')] }).recipe;
    const genes = new Set(['GENE001']);
    const found = missingFactors(recipe, STRUCTURE, { hasGene: (g) => genes.has(g), hasPanel: (id) => id === 'cell-table-here' });
    assert.deepEqual(found, [1, 2, 3, 4, 5]);
});

// ------------------------------------------------------------------------------------------- status

const nameOf = (names) => (i) => names[i];

test('the status of a computed grouping: groups, cells in a group, cells in no group (UX 2.3)', () => {
    const reply = { n_shown: 8090, n_grouped: 8012, groups: Array.from({ length: 28 }, () => ({ key: [], n: 1 })), small: { threshold: 10, mode: 'keep', n_small: 3 } };
    const totals = (r) => {
        const d = describeStatus({ recipe: normalizeGrouping({ partitionings: [{ source: { type: 'obs', key: 'k' } }] }).recipe,
            snap: { state: 'ready', values: { reply: r } }, cells: r.n_shown, nameOf: () => 'k', missing: [] });
        return { text: d.text, noGroup: d.noGroup };
    };
    assert.deepEqual(totals(reply), { text: '28 groups · 8,012 of 8,090 cells in a group', noGroup: 78 });
    assert.deepEqual(totals({ ...reply, n_grouped: 8090 }), { text: '28 groups · 8,090 of 8,090 cells in a group', noGroup: 0 });
    assert.equal(totals({ n_shown: 5, n_grouped: 5, groups: [{ key: [], n: 5 }] }).text, '1 group · 5 of 5 cells in a group');
    assert.equal(smallLine(reply), '3 small groups (under 10 cells), kept');
    assert.equal(smallLine({ small: { threshold: 20, mode: 'collect', n_small: 1 } }), '1 small group (under 20 cells), collected into "Small groups (under 20 cells)"');
    assert.equal(smallLine({ small: { threshold: 10, mode: 'hide', n_small: 2 } }), '2 small groups (under 10 cells), hidden: their cells are in no group');
    assert.equal(smallLine({ small: { threshold: 10, mode: 'keep', n_small: 0 } }), null);
});

test('"in no group" says why: each factor that leaves cells out, and hidden small groups', () => {
    const recipe = normalizeGrouping({ partitionings: [
        { source: { type: 'layer', key: 'logged', column: 'Cd3e' }, binning: { method: 'equal_count' }, rest: 'exclude' },
        { source: { type: 'obs', key: 'cell_type' }, levels: ['c:B cell'], rest: 'exclude' },
        { source: { type: 'table', key: 't' }, rest: 'exclude' },
        { source: { type: 'obs', key: 'condition' } }], small: { mode: 'hide' } }).recipe;
    const reply = { n_shown: 1000, n_grouped: 600, small: { threshold: 10, mode: 'hide', n_small: 2 }, partitionings: [
        { levels: ['bin:0', 'bin:1'], counts: [500, 422] }, { levels: ['c:B cell', 'c:T cell'], counts: [900, null] },
        { levels: ['@in'], counts: [700] }, { levels: ['c:a', 'c:b'], counts: [500, 500] }] };
    assert.deepEqual(noGroupReasons(recipe, reply, nameOf(['Cd3e', 'cell_type', 'Table 1', 'condition'])), [
        '78 have no value for Cd3e', '100 are in no ticked level of cell_type', '300 are not in Table 1',
        '2 small groups (under 10 cells) are hidden']);
    assert.deepEqual(noGroupReasons(normalizeGrouping({ partitionings: [{ source: { type: 'obs', key: 'condition' } }] }).recipe,
        { n_shown: 10, n_grouped: 10, partitionings: [{ levels: ['c:a'], counts: [10] }] }, nameOf(['condition'])), []);
});

const base = { title: 'Grouping 1', cells: 8090, nameOf: nameOf(['cell_type', 'sample', 'Cd3e']), missing: [] };
const recipe3 = normalizeGrouping({ partitionings: [{ source: { type: 'obs', key: 'cell_type' } }, { source: { type: 'obs', key: 'sample' } },
    geneFactor('logged', 'Cd3e')] }).recipe;
const actions = (s) => s.actions.map(a => [a.id, a.label]);

test('every state of UX 2.6, worded as the design says', () => {
    const empty = describeStatus({ ...base, recipe: normalizeGrouping({}).recipe, snap: null });
    assert.equal(empty.state, 'empty');
    assert.equal(empty.text, 'Add a factor to divide the cells into groups.');

    const computing = describeStatus({ ...base, recipe: recipe3, snap: { state: 'computing', progress: { done: 1, total: 3 } } });
    assert.equal(computing.text, 'Grouping 8,090 cells…');
    assert.deepEqual(actions(computing), [['cancel', 'Cancel']]);

    const held = describeStatus({ ...base, recipe: recipe3, snap: { state: 'ready', held: { edits: 2, seconds: 40 } } });
    assert.equal(held.state, 'held');
    assert.equal(held.text, '2 changes not applied. About 40 s.');
    assert.deepEqual(actions(held), [['update', 'Update groups']]);
    assert.equal(describeStatus({ ...base, recipe: recipe3, snap: { state: 'ready', held: { edits: 1, seconds: 150 } } }).text,
        '1 change not applied. About 3 min.');

    const wide = normalizeGrouping({ partitionings: [{ source: { type: 'obsm', key: 'X_pca', column: '3' }, binning: { method: 'equal_count' } }] }).recipe;
    const obsm = describeStatus({ ...base, recipe: wide, nameOf: nameOf(['X_pca 3']), obsmWidth: () => 50,
        snap: { state: 'ready', held: { edits: 1, seconds: 20 } } });
    assert.equal(obsm.text, 'X_pca 3 reads all 50 columns of X_pca: about 20 s.');
    assert.deepEqual(actions(obsm), [['update', 'Update groups']]);

    const asks = describeStatus({ ...base, cells: 95.6e6, recipe: recipe3, snap: { state: 'awaiting', estimate: { seconds: 120, tier: 'confirm' } } });
    assert.equal(asks.text, 'Grouping 95.6M cells will take about 2 minutes.');
    assert.deepEqual(actions(asks), [['compute', 'Compute'], ['cancel', 'Not now']]);

    const groups = describeStatus({ ...base, recipe: recipe3, snap: { state: 'refused', reason: 'too_many_groups' },
        header: { refused: { reason: 'too_many_groups', count: 6840, limit: 2000, levels: [14, 380, 4] } } });
    assert.equal(groups.text, '6,840 groups: a grouping holds up to 2,000. Nothing was computed. sample has 380 levels.');
    assert.deepEqual(actions(groups), [['levels:1', 'Choose levels of sample'], ['binfewer', 'Bin fewer']]);

    const levels = describeStatus({ ...base, recipe: recipe3, snap: { state: 'refused', reason: 'too_many_levels' },
        header: { refused: { reason: 'too_many_levels', count: 8090, limit: 2000, partitioning: 0 } } });
    assert.equal(levels.text, 'cell_type has 8,090 levels; a factor holds up to 2,000. Nothing was computed.');
    assert.deepEqual(levels.card, { index: 0, text: tooManyLevelsText('cell_type', 8090) });

    const tableCells = describeStatus({ ...base, recipe: recipe3, snap: { state: 'refused', reason: 'table_too_many_cells',
        message: 'A cell table cannot list 12M cells. Use a subset of up to 1M cells, or divide by a column.' } });
    assert.equal(tableCells.text, 'A cell table cannot list 12M cells. Use a subset of up to 1M cells, or divide by a column.');

    const missing = describeStatus({ ...base, recipe: recipe3, missing: [0], snap: null });
    assert.equal(missing.state, 'missing');
    assert.equal(missing.text, 'Nothing computed until cell_type is replaced or removed.');
    assert.equal(describeStatus({ ...base, recipe: recipe3, missing: [0, 2], snap: null }).text,
        'Nothing computed until cell_type and Cd3e are replaced or removed.');

    const cycle = describeStatus({ ...base, recipe: recipe3, snap: { state: 'cycle', cycle: ['Grouping 1', 'Table 2'] },
        cycleIds: ['cell-grouping-A', 'cell-table-T'], self: 'cell-grouping-A' });
    assert.equal(cycle.text, 'Grouping 1 and Table 2 depend on each other.');
    assert.deepEqual(actions(cycle), [['open:cell-table-T', 'Open Table 2']]);
    const ring = describeStatus({ ...base, recipe: recipe3, loopUndo: true, snap: { state: 'cycle', cycle: ['Grouping 1', 'Table 2', 'Grouping 3'] },
        cycleIds: ['cell-grouping-A', 'cell-table-T', 'cell-grouping-C'], self: 'cell-grouping-A' });
    assert.equal(ring.text, 'Grouping 1, Table 2 and Grouping 3 depend on each other.');
    assert.deepEqual(actions(ring), [['undo', 'Undo'], ['open:cell-table-T', 'Open Table 2'], ['open:cell-grouping-C', 'Open Grouping 3']]);

    const failed = describeStatus({ ...base, recipe: recipe3, snap: { state: 'failed', message: 'the server did not answer' } });
    assert.equal(failed.text, 'Groups could not be computed: the server did not answer.');
    assert.deepEqual(actions(failed), [['retry', 'Retry']]);

    const ready = describeStatus({ ...base, recipe: recipe3, snap: { state: 'ready', values: { reply: {
        n_shown: 8090, n_grouped: 8012, groups: [{ key: [], n: 8012 }], small: { threshold: 10, mode: 'keep', n_small: 0 } } } } });
    assert.equal(ready.state, 'ready');
    assert.equal(ready.text, '1 group · 8,012 of 8,090 cells in a group');
    assert.equal(ready.noGroup, 78);

    const off = describeStatus({ ...base, recipe: recipe3, snap: { state: 'off' } });
    assert.equal(off.text, 'Cell Grouping is turned off on this server.');
});

test('a table factor waits on its table: the resolver\'s state, with Open table (GRP-15)', () => {
    const recipe = normalizeGrouping({ partitionings: [tableFactor('cell-table-T')] }).recipe;
    const building = describeStatus({ ...base, recipe, nameOf: nameOf(['in Table 1']), tableTitle: () => 'Table 1',
        snap: { state: 'building', gate: { state: 'building' } }, gateTable: 'cell-table-T' });
    assert.equal(building.text, "Building 'Table 1'…");
    assert.deepEqual(actions(building), [['open:cell-table-T', 'Open table']]);
    const ask = describeStatus({ ...base, recipe, tableTitle: () => 'Table 1', gateTable: 'cell-table-T',
        snap: { state: 'ask', gate: { state: 'ask', rows: 300000 } } });
    assert.equal(ask.text, "'Table 1' needs a click to build its filter (300,000 rows).");
    assert.deepEqual(actions(ask), [['compute', 'Build filter'], ['open:cell-table-T', 'Open table']]);
});

// ------------------------------------------------------------------------------------------- settings

test('Settings: its summary, and the entries it refuses (SHR-12, UX 2.5)', () => {
    assert.equal(settingsSummary(normalizeGrouping({}).recipe), 'Separator " | " · small groups under 10 cells kept');
    assert.equal(settingsSummary(normalizeGrouping({ separator: ' / ', small: { threshold: 20, mode: 'collect' } }).recipe),
        'Separator " / " · small groups under 20 cells collected');
    assert.equal(settingsSummary(normalizeGrouping({ small: { mode: 'hide' } }).recipe),
        'Separator " | " · small groups under 10 cells hidden');
    assert.equal(thresholdProblem('12'), null);
    assert.equal(thresholdProblem('0'), 'Enter a whole number of cells, 1 or more.');
    assert.equal(thresholdProblem('2.5'), 'Enter a whole number of cells, 1 or more.');
    assert.equal(separatorProblem(' | '), null);
    assert.equal(separatorProblem(''), 'A separator needs at least one character.');
});
