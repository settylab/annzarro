/**
 * Entity names held as one UTF-8 byte buffer plus offsets, outside the V8 heap.
 *
 * A JS array of 95.6M short strings costs about 3 GB of a tab's 4 GB V8 heap
 * (measured: 32 B per name plus the array). Here the bytes and offsets are
 * ArrayBuffers, which do not count against that heap: 23 B per 19-character
 * name in total. A name is decoded only when it is asked for.
 *
 * It answers what the cell-name consumers use: `length`, `indexOf`,
 * `includes`, `at`, `slice`, iteration, and `[i]` through the Proxy that
 * `PackedNames.fromJSON` returns. Bulk array methods (`map`, `filter`, ...)
 * decode every name; they exist for compatibility, not for the large path.
 */
import { scanJSONArrays, decodeElement } from './json-stream.js';

const _decoder = new TextDecoder();
const _encoder = new TextEncoder();

export class PackedNames {
    constructor(bytes, offsets, length) {
        this.bytes = bytes;
        this.offsets = offsets;   // length + 1 entries
        this.length = length;
    }

    at(i) {
        if (i < 0) i += this.length;
        if (!(i >= 0 && i < this.length)) return undefined;
        return _decoder.decode(this.bytes.subarray(this.offsets[i], this.offsets[i + 1]));
    }

    indexOf(name) {
        if (typeof name !== 'string') return -1;
        const want = _encoder.encode(name);
        const len = want.length, off = this.offsets, bytes = this.bytes;
        const first = len ? want[0] : 0;
        for (let i = 0; i < this.length; i++) {
            const a = off[i];
            if (off[i + 1] - a !== len || (len && bytes[a] !== first)) continue;
            let k = 1;
            while (k < len && bytes[a + k] === want[k]) k++;
            if (k >= len) return i;
        }
        return -1;
    }

    includes(name) { return this.indexOf(name) !== -1; }

    slice(start = 0, end = this.length) {
        const out = [];
        for (let i = Math.max(0, start); i < Math.min(end, this.length); i++) out.push(this.at(i));
        return out;
    }

    *[Symbol.iterator]() { for (let i = 0; i < this.length; i++) yield this.at(i); }
    forEach(fn) { for (let i = 0; i < this.length; i++) fn(this.at(i), i, this); }
    map(fn) { const out = new Array(this.length); for (let i = 0; i < this.length; i++) out[i] = fn(this.at(i), i, this); return out; }
    filter(fn) { const out = []; for (let i = 0; i < this.length; i++) { const v = this.at(i); if (fn(v, i, this)) out.push(v); } return out; }

    /**
     * The names of the array under `key` in a JSON response (`{"cells": [...]}`),
     * read as a stream (see json-stream.js). `sizeHint` is the body size in
     * bytes, if known, to size the buffer once.
     */
    static async fromJSON(response, key, sizeHint = 0) {
        let bytes = new Uint8Array(Math.max(1 << 20, sizeHint));
        let offsets = new Uint32Array(Math.max(1 << 16, Math.ceil(sizeHint / 8)));
        let n = 0, used = 0;
        await scanJSONArrays(response, (owner, parent, buf, start, end, escaped) => {
            if (owner !== key || parent !== null) return;
            let src = buf, a = start, b = end;
            if (start < 0) { src = null; a = b = 0; }
            else if (escaped) { src = _encoder.encode(decodeElement(buf, start, end, true)); a = 0; b = src.length; }
            const len = b - a;
            if (used + len > bytes.length) {
                const grown = new Uint8Array(Math.max(bytes.length * 2, used + len));
                grown.set(bytes.subarray(0, used));
                bytes = grown;
            }
            if (n + 2 > offsets.length) {
                const grown = new Uint32Array(offsets.length * 2);
                grown.set(offsets);
                offsets = grown;
            }
            if (len) bytes.set(src.subarray(a, b), used);
            used += len;
            if (used > 0xFFFFFFFF) throw new RangeError('names exceed 4 GiB');
            offsets[++n] = used;
        });
        const names = new PackedNames(bytes.subarray(0, used), offsets.subarray(0, n + 1), n);
        // `names[i]` for the consumers that index the cell list directly
        return new Proxy(names, {
            get(target, prop, receiver) {
                if (typeof prop === 'string') {
                    const c = prop.charCodeAt(0);
                    if (c >= 48 && c <= 57) return target.at(Number(prop));
                }
                const v = Reflect.get(target, prop, receiver);
                return typeof v === 'function' ? v.bind(target) : v;
            }
        });
    }
}

/**
 * Category codes of a categorical obs column from its JSON response
 * (`{"categories": {col: [...]}, "data": {col: [...]}}`), read as a stream.
 * Returns `{codes, categories}`: `codes[i]` indexes `categories`, 0xFFFF
 * where the value is missing (null). Each value is matched to a category by
 * its bytes; only the distinct values are decoded.
 */
export async function categoryCodesFromJSON(response, column, expected = 0) {
    const MISSING = 0xFFFF;
    let codes = new Uint16Array(Math.max(1 << 16, expected));
    let n = 0;
    const listed = [];            // the response's category list
    const seen = [];              // distinct values in order of first appearance
    const buckets = new Map();    // FNV-1a hash of bytes -> [{bytes, code}]
    const lookup = (buf, start, end) => {
        let h = 0x811c9dc5;
        for (let k = start; k < end; k++) h = Math.imul(h ^ buf[k], 0x01000193);
        const list = buckets.get(h);
        if (list) {
            for (const e of list) {
                if (e.bytes.length !== end - start) continue;
                let k = 0;
                while (k < e.bytes.length && e.bytes[k] === buf[start + k]) k++;
                if (k === e.bytes.length) return e.code;
            }
        }
        const code = seen.length;
        if (code >= MISSING) throw new RangeError('more than 65534 categories');
        seen.push(decodeElement(buf, start, end, false));
        const entry = { bytes: buf.slice(start, end), code };
        if (list) list.push(entry); else buckets.set(h, [entry]);
        return code;
    };
    await scanJSONArrays(response, (owner, parent, buf, start, end, escaped) => {
        if (owner !== column) return;
        if (parent === 'categories') {
            if (start >= 0) listed.push(decodeElement(buf, start, end, escaped));
            return;
        }
        if (parent !== 'data') return;
        if (n >= codes.length) {
            const grown = new Uint16Array(codes.length * 2);
            grown.set(codes);
            codes = grown;
        }
        if (start < 0) codes[n++] = MISSING;
        else if (escaped) {
            const v = decodeElement(buf, start, end, true);
            let code = seen.indexOf(v);
            if (code === -1) { code = seen.length; seen.push(v); }
            codes[n++] = code;
        } else codes[n++] = lookup(buf, start, end);
    });
    codes = codes.subarray(0, n);
    // Report codes against the response's category order (the dataset's),
    // with values it does not list appended.
    const categories = listed.slice();
    const remap = new Uint16Array(seen.length);
    seen.forEach((v, i) => {
        let k = categories.indexOf(v);
        if (k === -1) { k = categories.length; categories.push(v); }
        remap[i] = k;
    });
    for (let i = 0; i < n; i++) if (codes[i] !== MISSING) codes[i] = remap[codes[i]];
    return { codes, categories, MISSING };
}
