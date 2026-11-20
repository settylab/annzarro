/**
 * The browser's side of `POST /api/v1/data/gene_score` (annzarro/server/routes/gene_score.py).
 *
 * The body carries the recipe, because a long list of gene names does not fit
 * a request line. The reply to a computation is one stream (frame-stream-client.js):
 * JSON lines (`progress` frames, then a `result` frame with the vector's header, the
 * gene figures and the warnings, or an `error` frame when the work fails after the
 * stream has begun, `read_busy` when the server stayed busy past its wait), followed
 * by `byte_length` bytes of little-endian float32, one value per cell shown. A stream
 * that ends without a `result` frame has failed.
 *
 * `fetchImpl` is injected so Node tests drive the parser with a fake stream.
 */
import { csrfFetch } from './csrf.js';
import { readFrameStream } from './frame-stream-client.js';
import { serverRecipe } from './gene-signature.js';

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
 *
 * `onProgress(done, total, frame)` is told of every progress frame: genes done and in all, and the
 * frame itself with `entries_done`, `entries_total`, `running_s` and `queue: {ahead, sharing}`. A score
 * that waits for the server's heavy lane is sent one at once (`done` 0) and another when its place
 * changes, so the frame tells a queued score from a computing one.
 * @param {Response} response - a 200 reply
 * @param {{onProgress?: (done: number, total: number, frame: Object) => void}} [opts]
 * @returns {Promise<{header: Object, values: (Float32Array|null)}>}
 */
export async function readScoreStream(response, { onProgress = () => {} } = {}) {
    const { header, blocks } = await readFrameStream(response, {
        onFrame: (f) => { if (f.type === 'progress') onProgress(f.done, f.total, f); },
        blocksOf: (h) => {
            const bytes = Number(h.byte_length) || 0;
            return bytes ? [{ name: 'values', dtype: 'float32', bytes }] : [];
        },
        words: { cut: 'The score stream ended before the score was complete.', failed: 'The score could not be computed.' }
    });
    return { header, values: blocks.values || null };
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
