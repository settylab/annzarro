/**
 * The Gene Set Analysis panel's state (panels/gene-set-utilities/state.js):
 * what a snapshot is, when a section's result is stale, and what is refused
 * before any request.
 *
 * A section shows the result made for one input key. These tests pin that
 * the key moves with everything the request depends on (genes, species,
 * params, adapter version, ID column) and nothing else (gene order,
 * repeats), that a reply to an older start never paints, and that a list
 * over a service's limit is refused, never cut to fit.
 *
 * Run:  node --test annzarro/tests/js/gene-set-state.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../../../static/js/panels/gene-set-utilities/state.js');

const adapter = (over = {}) => ({
    id: 'string-enrichment', version: '1', kind: 'set', label: 'Enrichment',
    provider: { name: 'STRING', host: 'string-db.org' },
    limits: { minGenes: 1, maxGenes: 2000 }, supportsSpecies: () => 'unknown', ...over
});

test('setHash ignores order and repeats, and differs on one gene', () => {
    const a = S.setHash(['TP53', 'MDM2', 'ATM']);
    assert.equal(S.setHash(['ATM', 'TP53', 'MDM2', 'TP53']), a);
    assert.notEqual(S.setHash(['TP53', 'MDM2', 'CHEK2']), a);
    assert.notEqual(S.setHash(['TP53', 'MDM2']), a);
    assert.equal(S.setHash([]), S.setHash([]));
    // 30k genes in one pass (no sort): fast enough for every table redraw
    const many = Array.from({ length: 30000 }, (_, i) => `GENE${i}`);
    const t = performance.now();
    const h = S.setHash(many);
    assert.ok(performance.now() - t < 200, 'setHash of 30k names is cheap');
    assert.equal(S.setHash([...many].reverse()), h);
});

test('inputKey moves with species, params, adapter version, ID column and service, not with param order', () => {
    const parts = { genesHash: S.setHash(['A', 'B']), taxonomyId: '9606', idColumn: '_index', params: { a: 1, b: [2, 3] } };
    const k = S.inputKey(adapter(), parts);
    assert.equal(S.inputKey(adapter(), { ...parts, params: { b: [2, 3], a: 1 } }), k, 'param key order is irrelevant');
    assert.notEqual(S.inputKey(adapter(), { ...parts, taxonomyId: '10090' }), k);
    assert.notEqual(S.inputKey(adapter(), { ...parts, params: { a: 2, b: [2, 3] } }), k);
    assert.notEqual(S.inputKey(adapter({ version: '2' }), parts), k);
    assert.notEqual(S.inputKey(adapter(), { ...parts, idColumn: 'gene_name' }), k);
    assert.notEqual(S.inputKey(adapter(), { ...parts, genesHash: S.setHash(['A']) }), k);
    assert.notEqual(S.inputKey(adapter(), { ...parts, backgroundHash: 'x' }), k);
    assert.notEqual(S.inputKey(adapter(), { ...parts, service: 'https://version-12-0.string-db.org/api' }), k);
    // a gene section follows the focus, not the genes
    const g = adapter({ id: 'string-partners', kind: 'gene' });
    const kg = S.inputKey(g, { ...parts, focusId: 'TP53' });
    assert.equal(S.inputKey(g, { ...parts, focusId: 'TP53', genesHash: 'other' }), kg);
    assert.notEqual(S.inputKey(g, { ...parts, focusId: 'MDM2' }), kg);
});

test('a run goes idle -> loading -> ok; a new key makes it stale with its result kept', () => {
    let r = S.idleRun();
    r = S.startRun(r, 'k1', 0);
    assert.equal(r.status, 'loading');
    const tok = r.token;
    r = S.resolveRun(r, tok, { rows: 1 }, 5);
    assert.equal(r.status, 'ok');
    assert.equal(r.lastInputHash, 'k1');
    r = S.settleRun(r, 'k2');
    assert.equal(r.status, 'stale');
    assert.deepEqual(r.result, { rows: 1 }, 'the stale result stays on screen');
    r = S.settleRun(r, 'k1');
    assert.equal(r.status, 'ok', 'back to the key it was made for: fresh again');
    assert.ok(S.needsFetch(r, 'k2'));
    assert.ok(!S.needsFetch(r, 'k1'));
});

test('a reply to a superseded start is dropped; an abort goes back to what was shown', () => {
    let r = S.resolveRun(S.startRun(S.idleRun(), 'k1', 0), 1, 'first', 1);
    r = S.startRun(r, 'k2', 2);
    const old = r.token;
    r = S.startRun(r, 'k3', 3);
    assert.equal(S.resolveRun(r, old, 'late', 4), r, 'late reply for k2 ignored');
    assert.equal(S.rejectRun(r, old, { kind: 'timeout', message: 'x' }, 4), r, 'late failure ignored');
    const back = S.rejectRun(r, r.token, { kind: 'aborted', message: 'cancelled' }, 5);
    assert.equal(back.status, 'ok');
    assert.equal(back.lastInputHash, 'k1');
    assert.equal(back.result, 'first');
    assert.ok(back.token > r.token, 'any later reply to the cancelled start is dropped too');
    const failed = S.rejectRun(r, r.token, { kind: 'timeout', message: 'timed out' }, 6);
    assert.equal(failed.status, 'error');
    assert.equal(failed.lastInputHash, 'k3');
    assert.equal(S.cancelRun(S.idleRun()).status, 'idle');
});

test('blocked before any request: empty, over the limit (never truncated), species, id type, no focus', () => {
    const base = { genes: ['A'], focus: null, taxonomyId: '9606', speciesName: 'Homo sapiens', idType: 'symbol' };
    assert.equal(S.blockedReason(adapter(), base), null);
    assert.equal(S.blockedReason(adapter(), { ...base, genes: [] }).kind, 'empty');
    const genes = Array.from({ length: 2001 }, (_, i) => `G${i}`);
    const capped = S.blockedReason(adapter(), { ...base, genes });
    assert.equal(capped.kind, 'capped');
    assert.match(capped.message, /2,001 genes; STRING enrichment accepts at most 2,000/);
    assert.equal(genes.length, 2001, 'the list is not touched');
    assert.equal(S.blockedReason(adapter({ supportsSpecies: (t) => t === '9606' }), { ...base, taxonomyId: '10090', speciesName: 'Mus musculus' }).kind, 'species');
    assert.equal(S.blockedReason(adapter({ supportsSpecies: () => { throw new Error('x'); } }), base), null, 'a throwing test is "unknown", not a block');
    assert.equal(S.blockedReason(adapter({ idTypes: ['symbol'] }), { ...base, idType: 'ensembl' }).kind, 'idtype');
    assert.equal(S.blockedReason(adapter({ minGenes: 3, limits: { minGenes: 3, maxGenes: 10 } }), { ...base, genes: ['A', 'B'] }).kind, 'empty');
    const gene = adapter({ kind: 'gene', limits: { minGenes: 1, maxGenes: 1 } });
    assert.equal(S.blockedReason(gene, base).kind, 'unfocused');
    assert.equal(S.blockedReason(gene, { ...base, focus: { id: 'TP53', name: 'TP53' } }), null);
});

test('the source: open, waiting, closed (its frozen names), closed and unknown, missing', () => {
    const genes = ['G0', 'G1', 'G2', 'G3'];
    const table = (cfg, ready = true) => ({ getTitle: () => 'Gene Table 1', isReady: () => ready, getConfig: () => cfg });
    assert.deepEqual(S.readTableSelection(null, { open: false, geneNames: genes }), { status: 'missing', names: null, title: '' });
    assert.equal(S.readTableSelection(table({ currentEntries: [] }, false), { open: true, geneNames: genes }).status, 'waiting');
    assert.deepEqual(S.readTableSelection(table({ currentEntries: [3, 1, 9] }), { open: true, geneNames: genes }).names, ['G3', 'G1'],
        'indexes past the genes are skipped');
    const closed = S.readTableSelection(table({ closedSelection: { passing: new Set(['G2']) } }), { open: false, geneNames: genes });
    assert.deepEqual(closed, { status: 'closed', names: ['G2'], title: 'Gene Table 1' });
    assert.equal(S.readTableSelection(table({ closedSelection: null }), { open: false, geneNames: genes }).status, 'closed-unknown');
});

test('ids from an ID column: missing values counted, repeats sent once, names kept parallel', () => {
    const col = { G0: 'TP53', G1: '', G2: 'TP53', G3: 'nan', G4: 7157, G5: 'MDM2' };
    const r = S.selectionIds(['G0', 'G1', 'G2', 'G3', 'G4', 'G5'], { idColumn: 'symbol', idOf: (n) => col[n] });
    assert.deepEqual(r.genes, ['TP53', '7157', 'MDM2']);
    assert.deepEqual(r.names, ['G0', 'G4', 'G5']);
    assert.equal(r.missingIds, 2);
    assert.equal(r.duplicates, 1);
    assert.deepEqual(S.selectionIds(['A', 'B'], { idColumn: '_index' }).genes, ['A', 'B']);
});

test('the bar: stale for the selection, the species, the ID column, the source', () => {
    const snap = S.makeSnapshot({ genes: ['A', 'B'], names: ['A', 'B'], sourceId: 't1', sourceTitle: 'Gene Table 1',
        taxonomyId: '9606', speciesName: 'Homo sapiens', idColumn: '_index', takenAt: 0 });
    assert.ok(Object.isFrozen(snap));
    const now = { hash: snap.hash, count: 2, taxonomyId: '9606', speciesName: 'Homo sapiens', idColumn: '_index', sourceId: 't1' };
    assert.equal(S.panelStaleness(snap, now), null);
    assert.equal(S.panelStaleness(null, now), null);
    const sel = S.panelStaleness(snap, { ...now, hash: S.setHash(['A']), count: 1 });
    assert.deepEqual(sel.reasons, ['selection']);
    assert.match(sel.text, /"Gene Table 1" now has 1 gene; results are for 2/);
    assert.match(S.panelStaleness(snap, { ...now, taxonomyId: '10090', speciesName: 'Mus musculus' }).text, /Species changed to Mus musculus/);
    assert.deepEqual(S.panelStaleness(snap, { ...now, idColumn: 'gene_name' }).reasons, ['idColumn']);
    assert.deepEqual(S.panelStaleness(snap, { ...now, sourceId: 't2' }).reasons, ['source']);
});

test('params are checked against their spec; bad values fall back to defaults with a warning', () => {
    const specs = {
        score: { type: 'number', default: 400, label: 'x', options: [{ value: 150 }, { value: 400 }] },
        lib: { type: 'enum', default: 'a', label: 'x', options: ['a', 'b'] },
        src: { type: 'multi', default: ['x'], label: 'x', options: [{ value: 'x' }, { value: 'y' }] },
        flag: { type: 'bool', default: false, label: 'x' }
    };
    const warnings = [];
    const p = S.checkParams(specs, { score: 999, lib: 'b', src: ['y', 'x', 'y'], flag: 'yes', extra: 1 }, (m) => warnings.push(m));
    assert.deepEqual(p, { score: 400, lib: 'b', src: ['x', 'y'], flag: false });
    assert.equal(warnings.length, 2);
    assert.deepEqual(S.checkParams(specs, undefined), { score: 400, lib: 'a', src: ['x'], flag: false });
});

test('the id column is found in var: ids first, then names, any case, common variants; else the var index', () => {
    assert.equal(S.pickIdColumn(['gene_symbol', 'gene_name', 'gene_ids', 'gene_id']), 'gene_id');
    assert.equal(S.pickIdColumn(['gene_symbol', 'gene_name', 'Gene_IDs']), 'Gene_IDs');
    assert.equal(S.pickIdColumn(['symbol', 'ensembl_id']), 'ensembl_id');
    assert.equal(S.pickIdColumn(['gene_ensembl_id', 'gene_ids']), 'gene_ensembl_id');
    assert.equal(S.pickIdColumn(['highly_variable', 'feature_name']), 'feature_name');
    assert.equal(S.pickIdColumn(['means', 'GENE_SYMBOL']), 'GENE_SYMBOL');
    assert.equal(S.pickIdColumn(['means', 'dispersions']), '_index');
    assert.equal(S.pickIdColumn([]), '_index');
    // bm_aging's var: gene_ids (Ensembl) before the symbols of the index
    assert.equal(S.pickIdColumn(['gene_ids', 'feature_types', 'genome', 'highly_variable']), 'gene_ids');
    assert.deepEqual(S.ID_TYPES, ['auto', 'symbol', 'ensembl', 'entrez']);
    const cfg = S.normalizeConfig({ idType: 'nonsense' }, []);
    assert.equal(cfg.idType, 'auto');
    assert.equal(S.normalizeConfig({ idType: 'entrez', idColumn: 'gene_id' }, []).idType, 'entrez');
});

test('over the limit: refused with the limit, unless forced (Try anyway); the list is never cut', () => {
    const base = { genes: Array.from({ length: 2001 }, (_, i) => `G${i}`), focus: null, taxonomyId: '9606', speciesName: '', idType: 'symbol' };
    const refused = S.blockedReason(adapter(), base);
    assert.equal(refused.kind, 'capped');
    assert.match(refused.message, /accepts at most 2,000\. Filter the table to fewer genes, or try anyway\./);
    assert.equal(S.blockedReason(adapter(), base, { force: true }), null);
    assert.equal(base.genes.length, 2001);
    // forcing lifts only the limit
    assert.equal(S.blockedReason(adapter(), { ...base, genes: [] }, { force: true }).kind, 'empty');
    assert.equal(S.blockedReason(adapter({ supportsSpecies: () => false }), base, { force: true }).kind, 'species');
});
