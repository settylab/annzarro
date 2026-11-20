/**
 * The browser's side of `POST /api/v1/data/cell_groups` (SHR-29, plan 1.2): the groups of a grouping, a count plot's
 * grid, and the moments of features and measures.
 *
 * The body is the request (utils/cell-grouping.js `serverRequest`, or a count plot's grid request) with the cells shown
 * as `subset`, and `estimate_only` or `confirm`; the dataset is in the query. Everything decided before the stream is
 * plain HTTP (400, 409 confirmation_required, 413, 422); after that the reply is one stream
 * (utils/frame-stream-client.js): a `start` frame, `progress` frames, then the `result` frame and the binary blocks it
 * lists, or an `error` frame (`read_busy` when the server stayed busy past its wait). A block is sized by its `length`
 * or, for moments and grids, by its `shape`.
 *
 * A result that is refused for its size (too many levels or groups) has no blocks and is no error: its reason is
 * lifted to the header, where the store reads a reply with nothing in it.
 *
 * `fetchImpl` is injected so Node tests drive it with a fake server.
 */
import { csrfFetch } from './csrf.js';
import { readFrameStream } from './frame-stream-client.js';
import { errorOf } from './gene-score-client.js';

const ITEM_BYTES = { uint8: 1, int8: 1, uint16: 2, int16: 2, uint32: 4, int32: 4, float32: 4, float64: 8 };

/** The blocks after a result frame, each sized by its `length` or by the product of its `shape`. */
function blocksOf(header) {
    return (header.blocks || []).map((b) => {
        const size = ITEM_BYTES[b.dtype];
        if (!size) throw Object.assign(new Error(`The server sent a block of an unknown type (${b.dtype}).`), { reason: 'bad_frame' });
        const n = Array.isArray(b.shape) ? b.shape.reduce((p, k) => p * Number(k), 1) : Number(b.length);
        return { name: b.name, dtype: b.dtype, bytes: n * size };
    });
}

/**
 * Read a groups stream. Frames before the result reach `onProgress(entries_done, entries_total, frame)`: the first
 * frame (`start`, with the job's place in its lane) and each progress frame.
 * @param {Response} response - a 200 reply
 * @param {{onProgress?: (done: number, total: number, frame: Object) => void}} [opts]
 * @returns {Promise<{header: Object, values: Object<string, ArrayBufferView>}>} `values`: the blocks by name
 */
async function readGroupsStream(response, { onProgress = () => {} } = {}) {
    const { header, blocks } = await readFrameStream(response, {
        onFrame: (f) => {
            if (f.type === 'start' || f.type === 'progress') onProgress(Number(f.entries_done) || 0, Number(f.entries_total) || 0, f);
        },
        blocksOf,
        words: { cut: 'The groups stream ended before the groups were complete.', failed: 'The groups could not be computed.' }
    });
    if (header.refused) return { header: { ...header, reason: header.refused.reason }, values: {} };
    return { header, values: blocks };
}

/**
 * The api the group store uses (utils/group-store.js).
 * @param {{url: string, fetchImpl?: Function}} options - `url`: the route
 */
// export-unused-ok: G8a gives the page's group store this api
export function createGroupsApi({ url, fetchImpl = (u, init) => csrfFetch(u, init) }) {
    const post = (dataset, body, signal) => fetchImpl(`${url}?${new URLSearchParams({ dataset_path: dataset })}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
    });
    return {
        /** The cost of a request; nothing is computed. */
        async estimate({ recipe, dataset }) {
            const response = await post(dataset, { ...recipe, estimate_only: true });
            if (!response.ok) throw await errorOf(response);
            return response.json();
        },
        /** Compute a request for the cells shown (`subset`); `recipe` is the request without them. */
        async compute({ recipe, dataset, subset, confirm, signal, onProgress }) {
            const body = { ...recipe, subset: subset || null };
            if (confirm) body.confirm = true;
            const response = await post(dataset, body, signal);
            if (!response.ok) throw await errorOf(response);
            return readGroupsStream(response, { onProgress });
        }
    };
}
