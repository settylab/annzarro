/**
 * Decoding of the server's binary vector replies (`format=f32`).
 *
 * The protocol is documented in `annzarro/core/array_response.py`:
 *   X-Annzarro-Shape     "n" or "rows,cols" (row-major)
 *   X-Annzarro-Dtype     "float32" | "float64"
 *   X-Annzarro-Encoding  "dense" | "sparse"
 *   X-Annzarro-Nnz       stored entries (sparse only)
 * dense:  prod(shape) little-endian values
 * sparse: nnz values, then nnz uint32 flat positions; everything else is 0
 *
 * `decodeVector` returns the dense typed array (NaN preserved) and the
 * shape. `toJSONShape` turns it into exactly what the JSON body's `data`
 * used to parse to, so the plotting and table code is unchanged: plain
 * arrays, nested for a 2-D slice unless the caller flattens, and `null`
 * where the value is not finite (JSON had NaN literals, which the parse
 * fallback turned into null).
 */

export const BINARY_FORMAT = 'f32';
export const BINARY_MIMETYPE = 'application/octet-stream';

/** True when a fetch Response carries the binary encoding. */
export function isBinaryResponse(response) {
    const type = response.headers.get('Content-Type') || '';
    return type.toLowerCase().startsWith(BINARY_MIMETYPE);
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function _readValues(buffer, byteOffset, count, dtype) {
    const Ctor = dtype === 'float64' ? Float64Array : Float32Array;
    const width = Ctor.BYTES_PER_ELEMENT;
    if (LITTLE_ENDIAN && byteOffset % width === 0) {
        return new Ctor(buffer, byteOffset, count);
    }
    // Big-endian host or unaligned view: read through a DataView.
    const view = new DataView(buffer, byteOffset, count * width);
    const out = new Ctor(count);
    for (let i = 0; i < count; i++) {
        out[i] = width === 8 ? view.getFloat64(i * 8, true) : view.getFloat32(i * 4, true);
    }
    return out;
}

/**
 * @param {ArrayBuffer} buffer   response body
 * @param {Headers|Map|Object} headers  response headers (`get(name)` or plain object)
 * @returns {{values: Float32Array|Float64Array, shape: number[], dtype: string, encoding: string}}
 */
export function decodeVector(buffer, headers) {
    const header = (name) => (typeof headers.get === 'function'
        ? headers.get(name)
        : headers[name] ?? headers[name.toLowerCase()]);
    const shapeText = header('X-Annzarro-Shape') || '0';
    const shape = shapeText.split(',').map(d => parseInt(d, 10));
    if (shape.some(d => !Number.isInteger(d) || d < 0)) {
        throw new Error(`Malformed X-Annzarro-Shape: ${shapeText}`);
    }
    const dtype = header('X-Annzarro-Dtype') === 'float64' ? 'float64' : 'float32';
    const encoding = header('X-Annzarro-Encoding') || 'dense';
    const width = dtype === 'float64' ? 8 : 4;
    const n = shape.reduce((a, b) => a * b, 1);

    let values;
    if (encoding === 'sparse') {
        const nnz = parseInt(header('X-Annzarro-Nnz') || '0', 10);
        if (buffer.byteLength !== nnz * (width + 4)) {
            throw new Error(`Sparse body is ${buffer.byteLength} bytes, expected ${nnz * (width + 4)}`);
        }
        const stored = _readValues(buffer, 0, nnz, dtype);
        const positions = LITTLE_ENDIAN
            ? new Uint32Array(buffer, nnz * width, nnz)
            : Uint32Array.from({ length: nnz }, (_, i) => new DataView(buffer).getUint32(nnz * width + i * 4, true));
        values = dtype === 'float64' ? new Float64Array(n) : new Float32Array(n);
        for (let i = 0; i < nnz; i++) values[positions[i]] = stored[i];
    } else {
        if (buffer.byteLength !== n * width) {
            throw new Error(`Dense body is ${buffer.byteLength} bytes, expected ${n * width}`);
        }
        values = _readValues(buffer, 0, n, dtype);
    }
    return { values, shape, dtype, encoding };
}

/** One plain-array copy of a typed array, non-finite values as null. */
export function toPlainArray(typed, start = 0, end = typed.length) {
    const out = new Array(end - start);
    for (let i = start; i < end; i++) {
        const v = typed[i];
        out[i - start] = Number.isFinite(v) ? v : null;
    }
    return out;
}

/**
 * The value the JSON body's `data` field would have parsed to.
 * @param {{values, shape}} decoded  from decodeVector
 * @param {boolean} flatten  return one flat array when the slice is a single
 *                           row or column (n x 1 or 1 x n); ignored otherwise
 */
export function toJSONShape(decoded, flatten = false) {
    const { values, shape } = decoded;
    const [rows, cols] = shape;
    if (shape.length !== 2 || (flatten && (rows === 1 || cols === 1))) return toPlainArray(values);
    const out = new Array(rows);
    for (let r = 0; r < rows; r++) out[r] = toPlainArray(values, r * cols, (r + 1) * cols);
    return out;
}
