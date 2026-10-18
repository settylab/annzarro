/**
 * Which bundled libraries are missing, and what the page says (utils/vendor-check.js).
 *
 * Run:  node --test annzarro/tests/js/vendor-check.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { missingLibraries, vendorProblem } from '../../../static/js/utils/vendor-check.js';

function all() {
    const $ = () => {};
    $.fn = { DataTable: () => {} };
    return { $, bootstrap: {}, Plotly: {}, chroma: () => {} };
}

test('nothing missing, nothing to say', () => {
    assert.deepEqual(missingLibraries(all()), []);
    assert.equal(vendorProblem(all()), null);
});

test('each library is named when it is missing', () => {
    const g = all();
    delete g.bootstrap;
    delete g.Plotly;
    assert.deepEqual(missingLibraries(g), ['Bootstrap', 'Plotly']);
    // no jQuery: DataTables, which hangs off it, is missing too
    const h = all();
    delete h.$;
    assert.deepEqual(missingLibraries(h), ['jQuery', 'DataTables']);
});

test('the message names the libraries, the files that failed once each, and the fix', () => {
    const g = all();
    delete g.bootstrap;
    g.__annzarroVendorFailed = ['bootstrap.bundle.min.js', 'bootstrap.min.css', 'bootstrap.bundle.min.js'];
    const p = vendorProblem(g);
    assert.equal(p.title, 'AnnZarro did not start');
    assert.deepEqual(p.files, ['bootstrap.bundle.min.js', 'bootstrap.min.css']);
    assert.match(p.message, /libraries the page needs: Bootstrap \(bootstrap\.bundle\.min\.js, bootstrap\.min\.css\)\./);
    assert.match(p.message, /Reload the page/);
    assert.match(p.message, /static\/vendor/);
    assert.match(p.message, /python scripts\/vendor_assets\.py/);
    assert.doesNotMatch(p.message, /Can't find variable/);
});

test('without the watcher\'s list the message leaves the files out', () => {
    const g = all();
    delete g.chroma;
    assert.match(vendorProblem(g).message, /needs: chroma\.js\. Reload/);
});
