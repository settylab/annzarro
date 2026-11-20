/**
 * What the numbers of an input look like (`GET /api/v1/data/matrix_kind`, core/matrix_kind.py).
 *
 * Scores are meant for normalised, log-transformed values. When a layer a source offers looks like raw counts, or
 * like normalised values that are not log-transformed, Scores offered says so on the layer's row and names a layer
 * that looks log-normalised when there is one (the sentences are utils/signature-options.js layerLines). The answer
 * comes from a sample of a few thousand stored values on the server, so it is cheap and is kept for the session, per
 * dataset and input.
 *
 * `fetchImpl` is injected so Node tests need no server.
 */
import { csrfFetch } from './csrf.js';

/**
 * @param {{url: string, fetchImpl?: Function}} options - `url`: the route (Config.API.MATRIX_KIND)
 */
export function createKindClient({ url, fetchImpl = (u, init) => csrfFetch(u, init) }) {
    /** @type {Map<string, Promise<Object|null>>} */
    const cache = new Map();
    return {
        /**
         * What `input` of `dataset` looks like; null when the server cannot say (the panel then stays quiet).
         * @param {string} dataset
         * @param {string} input
         * @param {{suggest?: boolean}} [opts] - `suggest: false` skips looking at the other matrices for one to offer instead
         */
        kind(dataset, input, { suggest = true } = {}) {
            const key = `${dataset}\u0001${input}\u0001${suggest ? 1 : 0}`;
            if (!cache.has(key)) {
                const query = new URLSearchParams({ dataset_path: dataset, input });
                if (!suggest) query.set('suggest', '0');
                cache.set(key, Promise.resolve(fetchImpl(`${url}?${query}`)).then(
                    (response) => (response.ok ? response.json() : null), () => null
                ).then((reply) => {
                    if (!reply) cache.delete(key);        // asked again next time
                    return reply;
                }));
            }
            return cache.get(key);
        },
        clear() { cache.clear(); }
    };
}
