/**
 * The browser's reading of a compute stream (annzarro/server/routes/compute_stream.py): JSON frames, one
 * per line, until the `result` frame, then the binary blocks that frame lists, little-endian, in the
 * order listed. An `error` frame, or a stream that ends before its blocks are complete, is a failure.
 *
 * Every frame before the result goes to `onFrame`; `progress` frames carry `entries_done`,
 * `entries_total`, `running_s` and `queue: {ahead, sharing}` (SHR-47, SHR-48). Until the first frame
 * arrives, nothing is known of the job's place.
 */

/** Typed array constructors by the dtype names the server writes (numpy's). */
const DTYPES = {
    uint8: Uint8Array, int8: Int8Array, uint16: Uint16Array, int16: Int16Array,
    uint32: Uint32Array, int32: Int32Array, float32: Float32Array, float64: Float64Array
};

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

const NEWLINE = 10;

/** Getter names of DataView by dtype, for a big-endian host. */
const GETTERS = {
    uint8: 'getUint8', int8: 'getInt8', uint16: 'getUint16', int16: 'getInt16',
    uint32: 'getUint32', int32: 'getInt32', float32: 'getFloat32', float64: 'getFloat64'
};

/** An error carrying what the server said: `reason`, and whatever else is given. */
function streamError(message, fields = {}) {
    const error = new Error(message);
    Object.assign(error, fields);
    return error;
}

/** The blocks a result frame lists (`blocks: [{name, dtype, length}]`), each with its byte size. */
function listedBlocks(header) {
    return (header.blocks || []).map(b => {
        const Type = DTYPES[b.dtype];
        if (!Type) throw streamError(`The server sent a block of an unknown type (${b.dtype}).`, { reason: 'bad_frame' });
        return { name: b.name, dtype: b.dtype, bytes: Number(b.length) * Type.BYTES_PER_ELEMENT };
    });
}

/**
 * Read a compute stream.
 * @param {Response} response - a 200 reply
 * @param {Object} [opts]
 * @param {(frame: Object) => void} [opts.onFrame] - every frame before the result
 * @param {(header: Object) => Array<{name: string, dtype: string, bytes: number}>} [opts.blocksOf] - the
 *   blocks after the result frame (default: its `blocks` list)
 * @param {{cut?: string, failed?: string}} [opts.words] - the messages of a cut stream and of an error
 *   frame without a message
 * @returns {Promise<{header: Object, blocks: Object<string, ArrayBufferView>}>}
 */
export async function readFrameStream(response, { onFrame = () => {}, blocksOf = listedBlocks, words = {} } = {}) {
    const cut = words.cut || 'The stream ended before the result was complete.';
    const failed = words.failed || 'The computation failed.';
    const reader = response.body.getReader();
    let line = [];                  // chunks of the JSON line being read
    let header = null;
    let wanted = [];                // the blocks still to fill, in order
    let current = null;             // {name, dtype, out, filled}
    const blocks = {};

    const parse = (bytes) => {
        try {
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch {
            throw streamError('The server sent a frame that is not JSON.', { reason: 'bad_frame' });
        }
    };
    const next = () => {
        while (!current && wanted.length) {
            const b = wanted.shift();
            current = { name: b.name, dtype: b.dtype, out: new Uint8Array(new ArrayBuffer(b.bytes)), filled: 0 };
            if (!b.bytes) finish();
        }
    };
    const finish = () => {
        blocks[current.name] = typed(current.dtype, current.out);
        current = null;
    };

    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        let at = 0;
        while (at < value.length && !header) {
            const nl = value.indexOf(NEWLINE, at);
            if (nl < 0) {
                line.push(value.subarray(at));
                at = value.length;
                break;
            }
            line.push(value.subarray(at, nl));
            at = nl + 1;
            const joined = line.length === 1 ? line[0] : concat(line);
            line = [];
            if (!joined.length) continue;
            const f = parse(joined);
            if (f.type === 'error') throw streamError(f.message || failed, { reason: f.reason || 'failed' });
            if (f.type === 'result') {
                header = f;
                wanted = blocksOf(f);
                next();
            } else {
                onFrame(f);
            }
        }
        while (header && current && at < value.length) {
            const take = Math.min(value.length - at, current.out.length - current.filled);
            current.out.set(value.subarray(at, at + take), current.filled);
            current.filled += take;
            at += take;
            if (current.filled === current.out.length) {
                finish();
                next();
            }
        }
        if (header && !current) {
            await reader.cancel().catch(() => {});
            break;
        }
    }
    if (!header || current) throw streamError(cut, { reason: 'stream_cut' });
    return { header, blocks };
}

/** The values of a block's little-endian bytes (an own, aligned buffer). */
function typed(dtype, bytes) {
    const Type = DTYPES[dtype];
    const values = new Type(bytes.buffer, 0, bytes.length / Type.BYTES_PER_ELEMENT);
    if (!LITTLE_ENDIAN && Type.BYTES_PER_ELEMENT > 1) {
        const view = new DataView(bytes.buffer.slice(0));
        const get = GETTERS[dtype];
        for (let i = 0; i < values.length; i++) values[i] = view[get](i * Type.BYTES_PER_ELEMENT, true);
    }
    return values;
}

function concat(chunks) {
    let n = 0;
    for (const c of chunks) n += c.length;
    const all = new Uint8Array(n);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.length; }
    return all;
}
