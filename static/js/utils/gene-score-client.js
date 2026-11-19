/**
 * The browser's side of `POST /api/v1/data/gene_score` (annzarro/server/routes/gene_score.py).
 *
 * The body carries the recipe, because 2,000 gene names do not fit a request
 * line. The reply to a computation is one stream: JSON lines (`progress`
 * frames, then a `result` frame with the vector's header, the gene figures and
 * the warnings, or an `error` frame when the work fails after the stream has
 * begun), followed by `byte_length` bytes of little-endian float32, one value
 * per cell shown. A stream that ends without a `result` frame has failed.
 *
 * `fetchImpl` is injected so Node tests drive the parser with a fake stream.
 */
import { csrfFetch } from './csrf.js';
import { serverRecipe } from './gene-signature.js';

/** The bytes of the float32 values are little-endian; a big-endian host would need them swapped. */
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

const NEWLINE = 10;

/** An error carrying what the server said: `status`, `reason`, `message` and, for 409/413, `estimate`. */
export function scoreError(message, fields = {}) {
    const error = new Error(message);
    Object.assign(error, fields);
    return error;
}

/**
 * The body of a refused or failed reply, as an error.
 * @param {Response} response
 */
export async function errorOf(response) {
    let body;
    try {
        body = JSON.parse(await response.text());
    } catch {
        body = null;
    }
    const message = (body && (body.error || body.message)) || `The server answered ${response.status}.`;
    return scoreError(message, {
        status: response.status,
        reason: (body && body.reason) || (body && body.error_type) || `http_${response.status}`,
        estimate: (body && body.estimate) || null
    });
}

/**
 * Read a score stream.
 * @param {Response} response - a 200 reply
 * @param {{onProgress?: (done: number, total: number) => void}} [opts]
 * @returns {Promise<{header: Object, values: (Float32Array|null)}>}
 */
export async function readScoreStream(response, { onProgress = () => {} } = {}) {
    const reader = response.body.getReader();
    let line = [];                  // chunks of the JSON line being read
    let header = null;
    let out = null;                 // the Uint8Array the values fill
    let filled = 0;
    const ended = () => scoreError('The score stream ended before the score was complete.', { reason: 'stream_cut' });

    const frame = (bytes) => {
        try {
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch {
            throw scoreError('The server sent a frame that is not JSON.', { reason: 'bad_frame' });
        }
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
            const f = frame(joined);
            if (f.type === 'progress') onProgress(f.done, f.total);
            else if (f.type === 'error') throw scoreError(f.message || 'The score could not be computed.', { reason: f.reason || 'failed' });
            else if (f.type === 'result') {
                header = f;
                const bytes = Number(f.byte_length) || 0;
                out = bytes ? new Uint8Array(new ArrayBuffer(bytes)) : null;
            }
        }
        if (header && at < value.length && out) {
            const take = Math.min(value.length - at, out.length - filled);
            out.set(value.subarray(at, at + take), filled);
            filled += take;
        }
        if (header && (!out || filled >= out.length)) {
            await reader.cancel().catch(() => {});
            break;
        }
    }
    if (!header) throw ended();
    if (!out) return { header, values: null };
    if (filled < out.length) throw ended();
    const values = new Float32Array(out.buffer);
    if (!LITTLE_ENDIAN) {
        const view = new DataView(out.buffer);
        for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(i * 4, true);
    }
    return { header, values };
}

function concat(chunks) {
    let n = 0;
    for (const c of chunks) n += c.length;
    const all = new Uint8Array(n);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.length; }
    return all;
}

/**
 * The api the score store uses.
 * @param {{url: string, fetchImpl?: Function}} options - `url`: the route (Config.API.GENE_SCORE)
 */
export function createScoreApi({ url, fetchImpl = (u, init) => csrfFetch(u, init) }) {
    const post = (dataset, body, signal) => fetchImpl(`${url}?${new URLSearchParams({ dataset_path: dataset })}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
    });
    return {
        async estimate({ recipe, dataset }) {
            const response = await post(dataset, { recipe: serverRecipe(recipe), estimate_only: true });
            if (!response.ok) throw await errorOf(response);
            return response.json();
        },
        async compute({ recipe, dataset, subset, confirm, signal, onProgress }) {
            const body = { recipe: serverRecipe(recipe) };
            if (subset) body.subset = subset;
            if (confirm) body.confirm = true;
            const response = await post(dataset, body, signal);
            if (!response.ok) throw await errorOf(response);
            return readScoreStream(response, { onProgress });
        }
    };
}
