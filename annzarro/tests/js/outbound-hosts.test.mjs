/**
 * The hosts the Gene Set Analysis panel contacts (outbound-hosts-table.mjs)
 * have the shape the server's table (server/policy/panels.py) is compared
 * against in tests/server/test_policy_csp.py: that comparison is what keeps a
 * new adapter or host from slipping past the Content-Security-Policy.
 *
 * Run:  node --test annzarro/tests/js/outbound-hosts.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adapterHosts, speciesHosts, CUSTOM_STRING } from './outbound-hosts-table.mjs';

test('every adapter names the host it calls, and STRING follows its base URL', () => {
    const { default: plain, configured } = adapterHosts();
    assert.equal(plain.length, 9);
    for (const [id, hosts] of [...plain, ...configured]) {
        assert.ok(hosts.length >= 1 && hosts.every(h => /^[a-z0-9.-]+(:\d+)?$/.test(h)), `${id}: ${hosts}`);
    }
    assert.deepEqual(plain.find(([id]) => id === 'string-network')[1], ['version-12-5.string-db.org']);
    assert.deepEqual(configured.find(([id]) => id === 'string-network')[1], [new URL(CUSTOM_STRING).host]);
    assert.deepEqual(configured.find(([id]) => id === 'mygene-card')[1], ['mygene.info']);
});

test('a species search tries NCBI, then the ENA, and nothing else', async () => {
    assert.deepEqual(await speciesHosts(), ['api.ncbi.nlm.nih.gov', 'www.ebi.ac.uk']);
});

test('the gene-set code names no host that the table does not account for', () => {
    // every https:// host written in the panel's service and species code
    const root = new URL('../../../static/js/panels/gene-set-utilities/', import.meta.url);
    const found = new Set();
    for (const file of ['species.js', 'services/string.js', 'services/gprofiler.js', 'services/mygene.js', 'services/optional.js']) {
        for (const m of readFileSync(new URL(file, root), 'utf8').matchAll(/https:\/\/([a-z0-9.-]+)/g)) found.add(m[1]);
    }
    const { default: plain } = adapterHosts();
    const known = new Set([...plain.flatMap(([, h]) => h), 'api.ncbi.nlm.nih.gov', 'www.ebi.ac.uk',
        'string-db.org']);   // STRING's provider host, named by the consent bar and replaced by the API host
    assert.deepEqual([...found].filter(h => !known.has(h)), []);
});
