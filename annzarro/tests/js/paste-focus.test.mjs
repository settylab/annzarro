/**
 * Paste to focus: which cell, gene and dataset pasted text names
 * (static/js/utils/paste-focus.js).
 *
 * Run:  node --test annzarro/tests/js/paste-focus.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
    MAX_TEXT, DEFAULT_RULES, compilePattern, compileRules, pasteSettings, matchRules, storeBase,
    datasetNameMatches, resolveDataset, resolveDatasetPath, isTextTarget
} = await import('../../../static/js/utils/paste-focus.js');

const ROW = 'BL_1697\t5127.7\t7483.4\thdfihbcc-1\tEndothelial\tLSEC\tLSEC\tonboard';
const ROW_RULE = { pattern: '^(?<dataset>[^\\t]+)\\t[^\\t]*\\t[^\\t]*\\t(?<cell>[^\\t]+)', dataset_match: 'prefix', enabled: true };
const DEFAULT = DEFAULT_RULES.map(r => ({ ...r }));

test('the example row names a cell and a dataset', () => {
    const hit = matchRules(ROW, [ROW_RULE]);
    assert.equal(hit.cell, 'hdfihbcc-1');
    assert.equal(hit.dataset, 'BL_1697');
    assert.equal(hit.gene, '');
    assert.equal(hit.datasetMatch, 'prefix');
});

test('trailing spaces and a newline are trimmed', () => {
    assert.equal(matchRules(`${ROW}  \n`, [ROW_RULE]).cell, 'hdfihbcc-1');
    assert.equal(matchRules('  CD34 \n', DEFAULT).cell, 'CD34');
});

test('the default rule takes one token as a cell and a gene (the cell is tried first)', () => {
    const hit = matchRules('TP53', DEFAULT);
    assert.deepEqual([hit.cell, hit.gene, hit.dataset], ['TP53', 'TP53', '']);
});

test('the default rule ignores text of several words and the example row', () => {
    assert.equal(matchRules('two words', DEFAULT), null);
    assert.equal(matchRules(ROW, DEFAULT), null);
    assert.equal(matchRules('a\nb', DEFAULT), null);
});

test('a gene-only rule names a gene', () => {
    const hit = matchRules('gene: CD34', [{ pattern: '^gene:\\s*(?<gene>\\S+)$' }]);
    assert.deepEqual([hit.cell, hit.gene], ['', 'CD34']);
});

test('the first matching rule wins; a rule that extracts nothing is skipped', () => {
    const rules = [
        { pattern: '^(?<cell>x+)(?<gene>y*)$', enabled: false },
        { pattern: '^(?<cell>a)?b$' },
        { pattern: '^(?<gene>b)$' },
        { pattern: '^(?<cell>b)$' }
    ];
    assert.equal(matchRules('b', rules).gene, 'b');      // rule 1 matched but named nothing
    assert.equal(matchRules('b', rules).rule, 2);
    assert.equal(matchRules('xx', rules), null);         // the disabled rule does not run
});

test('no rule matches: null', () => {
    assert.equal(matchRules('nothing here', [ROW_RULE]), null);
    assert.equal(matchRules('', DEFAULT), null);
    assert.equal(matchRules('   ', DEFAULT), null);
    assert.equal(matchRules(undefined, DEFAULT), null);
});

test('text longer than the cap is ignored', () => {
    assert.ok(matchRules('a'.repeat(MAX_TEXT), DEFAULT));
    assert.equal(matchRules('a'.repeat(MAX_TEXT + 1), DEFAULT), null);
    assert.equal(MAX_TEXT, 4096);
});

test('a pattern that does not compile is left out, the others still run', () => {
    const rules = [{ pattern: '(?<cell>' }, { pattern: '(' }, { pattern: '^(?<cell>\\w+)$' }];
    assert.equal(matchRules('abc', rules).rule, 2);
    assert.equal(compileRules([{ pattern: '[' }]).length, 0);
});

test('compilePattern needs a cell or gene group and says what is wrong', () => {
    assert.ok(compilePattern('^(?<cell>a)$').regex);
    assert.ok(compilePattern('^(?<gene>a)$').regex);
    assert.match(compilePattern('^(?<x>a)$').error, /cell|gene/);
    assert.ok(compilePattern('(?<cell').error);
    assert.ok(compilePattern('').error);
});

test('policy settings: on by default, the default rule without a policy', () => {
    const none = (key, fallback) => fallback;
    assert.equal(pasteSettings(none).enabled, true);
    assert.deepEqual(pasteSettings(none).rules, DEFAULT);
    const set = { 'ui.paste_focus.enabled': false, 'ui.paste_focus.rules': [] };
    const off = pasteSettings((key, fallback) => (key in set ? set[key] : fallback));
    assert.equal(off.enabled, false);
    assert.deepEqual(off.rules, []);       // the admin removed the default rule
});

test('the default rule is the one the server ships', () => {
    const py = readFileSync(new URL('../../server/paste_focus.py', import.meta.url), 'utf8');
    const m = py.match(/DEFAULT_PATTERN = r"(.*)"/);
    assert.equal(DEFAULT_RULES[0].pattern, m[1]);
});

test('a store name has no folder and no extension', () => {
    assert.equal(storeBase('/data/x/BL_1697_spatial_annzarro.zarr'), 'BL_1697_spatial_annzarro');
    assert.equal(storeBase('/data/a.h5ad/'), 'a');
    assert.equal(storeBase('s3://bucket/run.zarr'), 'run');
    assert.equal(storeBase('plain'), 'plain');
});

test('dataset matching: exact, prefix, contains', () => {
    assert.ok(datasetNameMatches('BL_1697', 'BL_1697', 'exact'));
    assert.ok(!datasetNameMatches('BL_1697', 'BL_1697_spatial', 'exact'));
    assert.ok(datasetNameMatches('BL_1697', 'BL_1697_spatial', 'prefix'));
    assert.ok(!datasetNameMatches('1697', 'BL_1697_spatial', 'prefix'));
    assert.ok(datasetNameMatches('1697', 'BL_1697_spatial', 'contains'));
    assert.ok(datasetNameMatches('BL_1697', 'BL_1697_spatial'));            // prefix by default
    assert.ok(!datasetNameMatches('', 'x', 'prefix'));
});

const LISTING = [
    { name: 'BL_1697_spatial_annzarro.zarr', path: '/d/BL_1697_spatial_annzarro.zarr' },
    { name: 'BL_1698_spatial_annzarro.zarr', path: '/d/BL_1698_spatial_annzarro.zarr' },
    { name: 'other.zarr', path: '/d/other.zarr' },
    { name: 'BL_1697_broken.zarr', path: '/d/BL_1697_broken.zarr', error: 'bad' }
];

test('a dataset group naming the open dataset: just focus', () => {
    const open = '/d/BL_1697_spatial_annzarro.zarr';
    assert.deepEqual(resolveDataset('BL_1697', LISTING, open, 'prefix'), { kind: 'current' });
    assert.deepEqual(resolveDataset('BL_1697_spatial_annzarro', LISTING, open, 'exact'), { kind: 'current' });
    assert.deepEqual(resolveDataset('spatial', LISTING, open, 'contains'), { kind: 'current' });
});

test('a dataset group naming one other listed dataset', () => {
    const r = resolveDataset('BL_1697', LISTING, '/d/other.zarr', 'prefix');
    assert.equal(r.kind, 'one');
    assert.equal(r.entry.path, '/d/BL_1697_spatial_annzarro.zarr');       // the unreadable store is not offered
});

test('a dataset group naming several datasets', () => {
    const r = resolveDataset('BL_169', LISTING, '/d/other.zarr', 'prefix');
    assert.equal(r.kind, 'many');
    assert.equal(r.entries.length, 2);
});

test('a dataset group naming no dataset, or none given: try the open one', () => {
    assert.deepEqual(resolveDataset('zzz', LISTING, '/d/other.zarr', 'prefix'), { kind: 'none' });
    assert.deepEqual(resolveDataset('', LISTING, '/d/other.zarr', 'prefix'), { kind: 'none' });
    assert.deepEqual(resolveDataset('BL_1697', [], null, 'prefix'), { kind: 'none' });
});

test('exact mode does not take a prefix', () => {
    assert.deepEqual(resolveDataset('BL_1697', LISTING, '/d/other.zarr', 'exact'), { kind: 'none' });
});

test('text fields keep their paste', () => {
    const el = (tag, extra = {}) => ({ tagName: tag, isContentEditable: false, closest: sel => (sel.split(',').map(s => s.trim()).includes(tag.toLowerCase()) ? {} : null), ...extra });
    assert.ok(isTextTarget(el('INPUT')));
    assert.ok(isTextTarget(el('TEXTAREA')));
    assert.ok(isTextTarget(el('SELECT')));
    assert.ok(isTextTarget(el('DIV', { isContentEditable: true })));
    assert.ok(!isTextTarget(el('DIV')));
    assert.ok(!isTextTarget(null));
});

test('a copied view names its store by path: the open one, a listed one, or none', () => {
    const listing = [{ path: '/d/a.zarr' }, { path: '/d/b.zarr' }, { path: '/d/bad.zarr', error: 'x' }];
    assert.deepEqual(resolveDatasetPath('/d/a.zarr', listing, '/d/a.zarr'), { kind: 'current' });
    assert.deepEqual(resolveDatasetPath('', listing, '/d/a.zarr'), { kind: 'current' });
    assert.deepEqual(resolveDatasetPath('/d/b.zarr', listing, '/d/a.zarr'), { kind: 'one', entry: listing[1] });
    assert.deepEqual(resolveDatasetPath('/d/bad.zarr', listing, '/d/a.zarr'), { kind: 'none' });
    assert.deepEqual(resolveDatasetPath('/d/zzz.zarr', listing, '/d/a.zarr'), { kind: 'none' });
    assert.deepEqual(resolveDatasetPath('/d/b.zarr', null, null), { kind: 'none' });
});
