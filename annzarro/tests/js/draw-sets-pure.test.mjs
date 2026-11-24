/**
 * draw-sets.js is pure: it is drawn in a page with no server (tests/browser/test_draw_sets_export.py), so nothing it
 * imports, however deep, may load the app's state. The set colours once came from set-plot-model.js, whose imports reach
 * config.js; that module fetches the server's configuration when loaded and logged an error in the export test's page.
 *
 * Run:  node --test annzarro/tests/js/draw-sets-pure.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATIC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../static/js');
const IMPORT = /^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;

/** Every module a module imports, statically and however deep, as paths under static/js. */
function graph(entry) {
    const seen = new Set();
    const walk = (file) => {
        if (seen.has(file)) return;
        seen.add(file);
        for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) {
            const spec = m[1] || m[2];
            if (spec.startsWith('.')) walk(resolve(dirname(file), spec));
        }
    };
    walk(resolve(STATIC, entry));
    return [...seen].map((f) => f.slice(STATIC.length + 1));
}

test('the Venn and UpSet figure imports nothing that loads the app or asks the server', () => {
    const reached = graph('panels/cell-count/draw-sets.js');
    for (const app of ['config.js', 'data-manager.js', 'panel-manager.js', 'utils/group-host.js', 'utils/set-plot-model.js']) {
        assert.ok(!reached.includes(app), `draw-sets.js reaches ${app}: ${reached.join(', ')}`);
    }
    assert.ok(reached.includes('utils/set-colours.js'), 'the set colours come from their own pure module');
});
