/**
 * Read the string arrays of a JSON response without ever holding the body as
 * one string.
 *
 * `response.text()` fails above V8's maximum string length (2^29 - 24
 * characters, about 537 MB). The cell names of a 95.6M-cell dataset are a
 * 2.1 GB JSON body and one categorical obs column is 0.96 GB, so above a few
 * tens of millions of cells the JSON routes cannot be read the usual way. This
 * scans the body's bytes as they arrive and reports every element of every
 * array; nothing but the current element is decoded.
 *
 * `onElement(owner, parent, bytes, start, end, escaped)` is called once per
 * array element, in order. `owner` is the key the array sits under, `parent`
 * the key of the object holding that key (null at the top level), so
 * `{"data": {"cell_type": [...]}}` reports owner "cell_type", parent "data".
 * For a string, `bytes[start:end]` is its UTF-8 content between the quotes and
 * `escaped` says it contains a backslash escape (decode it with decodeElement).
 * Anything else (null, a number, a nested container) arrives with start = -1,
 * so element positions stay aligned with the array.
 */

const QUOTE = 34, BACKSLASH = 92, COMMA = 44;
const OPEN_OBJ = 123, CLOSE_OBJ = 125, OPEN_ARR = 91, CLOSE_ARR = 93;

const _decoder = new TextDecoder();

/** The JS string of a reported element (handles escapes). */
export function decodeElement(bytes, start, end, escaped) {
    const raw = _decoder.decode(bytes.subarray(start, end));
    return escaped ? JSON.parse(`"${raw}"`) : raw;
}

function _isScalarByte(c) {
    // the first byte of null, true, false or a number
    return c === 110 || c === 116 || c === 102 || c === 45 || (c >= 48 && c <= 57);
}

export async function scanJSONArrays(response, onElement) {
    const reader = response.body.getReader();
    // frames: {arr, owner, parent, key, expectKey}
    const stack = [];
    let rest = null;
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        let buf = value;
        if (rest) {
            buf = new Uint8Array(rest.length + value.length);
            buf.set(rest);
            buf.set(value, rest.length);
            rest = null;
        }
        const n = buf.length;
        let i = 0;
        while (i < n) {
            const c = buf[i];
            if (c === QUOTE) {
                let j = buf.indexOf(QUOTE, i + 1);
                while (j !== -1) {
                    let k = j - 1, slashes = 0;
                    while (k > i && buf[k] === BACKSLASH) { slashes++; k--; }
                    if ((slashes & 1) === 0) break;
                    j = buf.indexOf(QUOTE, j + 1);
                }
                if (j === -1) { rest = buf.slice(i); break; }
                const top = stack[stack.length - 1];
                let escaped = false;
                for (let k = i + 1; k < j; k++) if (buf[k] === BACKSLASH) { escaped = true; break; }
                if (top && !top.arr && top.expectKey) {
                    top.key = decodeElement(buf, i + 1, j, escaped);
                    top.expectKey = false;
                } else if (top && top.arr) {
                    onElement(top.owner, top.parent, buf, i + 1, j, escaped);
                }
                i = j + 1;
            } else if (c === OPEN_OBJ || c === OPEN_ARR) {
                const top = stack[stack.length - 1];
                if (top && top.arr) onElement(top.owner, top.parent, buf, -1, -1, false);
                const owner = top ? (top.arr ? top.owner : top.key) : null;
                const parent = top ? (top.arr ? top.parent : top.owner) : null;
                stack.push({ arr: c === OPEN_ARR, owner, parent, key: null, expectKey: c === OPEN_OBJ });
                i++;
            } else if (c === CLOSE_OBJ || c === CLOSE_ARR) {
                stack.pop();
                i++;
            } else if (c === COMMA) {
                const top = stack[stack.length - 1];
                if (top && !top.arr) top.expectKey = true;
                i++;
            } else if (_isScalarByte(c)) {
                let j = i + 1;
                while (j < n) {
                    const d = buf[j];
                    if (d === COMMA || d === CLOSE_ARR || d === CLOSE_OBJ || d <= 32) break;
                    j++;
                }
                if (j === n) { rest = buf.slice(i); break; }
                const top = stack[stack.length - 1];
                if (top && top.arr) onElement(top.owner, top.parent, buf, -1, -1, false);
                i = j;
            } else {
                i++;   // whitespace, ':'
            }
        }
    }
}
