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
 * lifted to the header, and the store states it as `refused`.
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
            if (f.type === 'start' || f.type === 'progress') {
                // the items read (genes, scores) beside the stored entries: "Reading 200 genes: 61 of 200" (UX 3.5)
                const items = f.type === 'progress' && f.stage === 'features' ? { items: { done: Number(f.done) || 0, total: Number(f.total) || 0 } } : {};
                onProgress(Number(f.entries_done) || 0, Number(f.entries_total) || 0, { ...f, ...items });
            }
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

/**
 * The api of the moments of every gene over one group (`shape: "genes"`, the Gene Plot's `group-stat`), over the groups
 * api: the derived store's api (utils/derived-store.js).
 *
 * The estimate of a group the server does not know yet (its grouping is not in its code cache) is the whole layer, which
 * it says in `coverage.known`; its tier is then not decided, and is `auto` here, for the exact figure is applied by the
 * server once the grouping is resolved: a request that needs asking or is refused then ends in a `result` that says so
 * (`refused.reason` `confirmation_required` or `groups_too_expensive`), which is thrown as the 409 or 413 of a request
 * decided before the stream, so the store states it as `awaiting` or `refused`. Any other refusal is the result's.
 * @param {{estimate: Function, compute: Function}} groupsApi - createGroupsApi's
 */
// export-unused-ok: the page's group binding makes the store of the moments of genes with this api
export function createGenesApi(groupsApi) {
    return {
        async estimate(req) {
            const reply = await groupsApi.estimate(req);
            const known = !reply.estimate || !reply.estimate.coverage || reply.estimate.coverage.known !== false;
            return known ? reply : { ...reply, estimate: { ...reply.estimate, tier: 'auto' } };
        },
        async compute(req) {
            const { header, values } = await groupsApi.compute(req);
            const refused = header.refused;
            if (refused && (refused.reason === 'confirmation_required' || refused.reason === 'groups_too_expensive')) {
                throw Object.assign(new Error(refused.message), { status: refused.reason === 'confirmation_required' ? 409 : 413,
                    reason: refused.reason, estimate: refused.estimate });
            }
            if (refused) return { header, values: {} };
            return { header, values: { moments: values.moments, reply: header } };
        }
    };
}
