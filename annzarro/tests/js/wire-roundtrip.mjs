/**
 * Decode replies the real server produced (written by test_js_wire.py) with
 * the browser's decoder, and compare with the JSON route's `data`.
 *
 * Usage: node wire-roundtrip.mjs <manifest.json>
 * Each manifest case: {name, body (file), headers, json (the JSON reply's data)};
 * a categorical reply is compared as the values its codes stand for.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const { categoricalValues, decodeVector, toJSONShape } = await import('../../../static/js/utils/wire.js');

const manifestPath = process.argv[2];
const cases = JSON.parse(readFileSync(manifestPath, 'utf8'));
for (const c of cases) {
    const bytes = readFileSync(join(dirname(manifestPath), c.body));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const decoded = decodeVector(buffer, new Headers(c.headers));
    if (decoded.encoding === 'categorical') {
        assert.deepEqual(categoricalValues(decoded), c.json, c.name);
        console.log(`ok ${c.name} categorical ${decoded.dtype} [${decoded.shape}]`);
        continue;
    }
    const got = toJSONShape(decoded, false);
    // The JSON body writes float32 in shortest form; the binary carries the
    // exact float32. Compare at the wire dtype's precision.
    const round = decoded.dtype === 'float32' ? Math.fround : (v) => v;
    const norm = (v) => Array.isArray(v) ? v.map(norm) : (v === null ? null : round(v));
    assert.deepEqual(norm(got), norm(c.json), c.name);
    console.log(`ok ${c.name} ${decoded.encoding} ${decoded.dtype} [${decoded.shape}]`);
}
