/**
 * Cell names that are fetched when needed (huge datasets), and the part control
 * that steps from the part asked for.
 *
 * A part of 100,000 cells of a 1B-cell store touches all 477 chunks of the
 * name column, so its names are not downloaded: panels hold a token per cell,
 * a hover, click or table page asks for the names it shows, and only a search
 * or sort on the names loads them all. These tests pin that on the pieces.
 *
 * Run:  node --test annzarro/tests/js/names-on-demand.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { RemoteNames } from '../../../static/js/utils/remote-names.js';
import { DataManager } from '../../../static/js/data-manager.js';
import { Config } from '../../../static/js/config.js';
import { partSpec, describeParts } from '../../../static/js/utils/subset.js';

const NAMES = Array.from({ length: 1000 }, (_, i) => `AAAC_${i}-1`);

function remote({ withAll = true } = {}) {
    const asked = [];
    const looked = [];
    let downloads = 0;
    const names = new RemoteNames(NAMES.length,
        async (indices) => { asked.push([...indices]); return indices.map(i => NAMES[i]); },
        async (name) => { looked.push(name); return NAMES.indexOf(name); },
        { fetchAll: withAll ? async () => { downloads++; return NAMES.slice(); } : null });
    return { names: RemoteNames.wrap(names), asked, looked, downloads: () => downloads };
}

test('a token stands for the cell at a position, and no name looks like one', () => {
    const { names } = remote();
    const tokens = names.tokens();
    assert.equal(tokens.length, 1000);
    assert.equal(new Set(tokens).size, 1000);
    assert.ok(RemoteNames.isToken(tokens[17]));
    assert.equal(RemoteNames.tokenIndex(tokens[17]), 17);
    assert.equal(names.tokenAt(17), tokens[17]);
    assert.ok(!RemoteNames.isToken('AAAC_17-1'));
    assert.ok(!RemoteNames.isToken('⁣17x'));
    assert.ok(!RemoteNames.isToken(17));
    assert.equal(names.tokens(), tokens, 'built once');
});

test('names are fetched for the cells asked for only, together, and once', async () => {
    const { names, asked } = remote();
    assert.equal(names[5], undefined, 'not fetched yet');
    assert.equal(names.peek(5), undefined);
    await names.ensure([5, 6, 7, 5]);
    assert.deepEqual(asked, [[5, 6, 7]]);
    assert.deepEqual([names[5], names[6], names[7]], ['AAAC_5-1', 'AAAC_6-1', 'AAAC_7-1']);
    await names.ensure([6, 7, 8]);
    assert.deepEqual(asked[1], [8], 'the cached ones are not asked for again');
    assert.equal(names.indexOf('AAAC_8-1'), 8, 'a fetched name knows its position');
    assert.equal(await names.nameAt(8), 'AAAC_8-1');
    assert.equal(asked.length, 2);
});

test('a name asked for twice at once is one request', async () => {
    const { names, asked } = remote();
    const [a, b] = await Promise.all([names.nameAt(40), names.nameAt(40)]);
    assert.equal(a, b);
    assert.equal(asked.length, 1);
});

test('a large batch is split so the row list stays short', async () => {
    const { names, asked } = remote();
    await names.ensure(Array.from({ length: 1000 }, (_, i) => i));
    assert.ok(asked.length >= 2 && asked.every(a => a.length <= 500), asked.map(a => a.length).join());
    assert.equal(names[999], 'AAAC_999-1');
});

test('walking the names is refused until all of them are loaded', async () => {
    const { names, downloads } = remote();
    assert.throws(() => names.map(x => x), (e) => e.data && e.data.reason === 'names_not_loaded');
    assert.throws(() => [...names], (e) => e.data && e.data.reason === 'names_not_loaded');
    assert.equal(names.allLoaded, false);
    const all = await names.all();
    assert.equal(all.length, 1000);
    await names.all();
    assert.equal(downloads(), 1, 'downloaded once');
    assert.equal(names.allLoaded, true);
    assert.equal(names[999], 'AAAC_999-1');
    assert.equal(names.map(n => n.length).length, 1000);
    assert.equal([...names].length, 1000);
    assert.equal(await names.resolve('AAAC_321-1'), 321, 'found without the server');
});

test('a set too large to name refuses to load all', async () => {
    const { names } = remote({ withAll: false });
    assert.equal(names.canLoadAll, false);
    await assert.rejects(() => names.all(), (e) => e.data && e.data.reason === 'names_not_loaded');
});

test('the dataset size, not only the cells shown, decides that names stay on the server', () => {
    const was = [Config.DEFAULTS.LARGE_PLOT_POINTS, Config.DEFAULTS.NAMES_ON_DEMAND_ABOVE];
    try {
        Config.DEFAULTS.LARGE_PLOT_POINTS = 1_000_000;
        Config.DEFAULTS.NAMES_ON_DEMAND_ABOVE = 5_000_000;
        assert.equal(DataManager.namesStayOnServer(100_000, 1_000_000_000), 'huge');
        assert.equal(DataManager.namesStayOnServer(100_000, 5_000_000), 'none', 'the threshold itself is not above it');
        assert.equal(DataManager.namesStayOnServer(100_000, 5_000_001), 'huge');
        assert.equal(DataManager.namesStayOnServer(100_000, 300_000), 'none', 'a small dataset names its cells');
        assert.equal(DataManager.namesStayOnServer(2_000_000, 50_000_000), 'large', 'too many to name at all');
        assert.equal(DataManager.namesStayOnServer(100, null), 'none');
        Config.DEFAULTS.NAMES_ON_DEMAND_ABOVE = 100;
        assert.equal(DataManager.namesStayOnServer(60, 200), 'huge', 'lowered by the server config');
    } finally {
        [Config.DEFAULTS.LARGE_PLOT_POINTS, Config.DEFAULTS.NAMES_ON_DEMAND_ABOVE] = was;
    }
});

test('the server config sets the threshold', async () => {
    const { readUiSettings } = await import('../../../static/js/config.js');
    assert.equal(readUiSettings({ ui: { defaults: { names_on_demand_above: 100 } } }).namesOnDemandAbove, 100);
    assert.equal(readUiSettings({}).namesOnDemandAbove, null);
    assert.equal(readUiSettings({ ui: { defaults: { prefetch_next_part: 'auto' } } }).prefetchNextPart, 'auto');
});

test('the part to step from is the one asked for, not the one the reply already names', () => {
    const info = { subset: { n: 60, seed: 0, part: 2 }, parts: 4, part: 2, n_eligible: 200 };
    assert.equal(describeParts(info).part, 2);
    // asked for part 4 (index 3) while the reply still says 3: stepping back goes to part 3
    assert.deepEqual(partSpec(info, 2, false, 3), { n: 60, seed: 0, part: 2 });
    // from the shown part itself, the same target is nothing to do
    assert.equal(partSpec(info, 2), null);
    assert.equal(partSpec(info, 4, false, 3), null, 'past the last part');
});
