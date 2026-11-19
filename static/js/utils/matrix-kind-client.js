/**
 * What the numbers of an input look like (`GET /api/v1/data/matrix_kind`, core/matrix_kind.py), and the
 * sentences the Gene Signature panel says about it.
 *
 * Scores are meant for normalised, log-transformed values. When the input a signature reads looks like raw
 * counts, or like normalised values that are not log-transformed, the panel says so, and names a layer that
 * looks log-normalised when there is one. It is a warning, never a block. The answer comes from a sample of a
 * few thousand stored values on the server, so it is cheap and is kept for the session, per dataset and input.
 *
 * `fetchImpl` is injected so Node tests need no server.
 */
import { csrfFetch } from './csrf.js';

/** Kinds the panel warns about. */
export const WARN_KINDS = ['counts', 'normalised'];

function fmtMax(value) {
    return Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '';
}

/**
 * The warning for one reply of the route, or null when the input is fine (or nothing is known).
 * @param {{input: string, kind: string, stats?: {max?: number}, suggest?: (string|null)}} reply
 * @returns {{kind: string, text: string, suggest: (string|null)}|null}
 */
export function warningFor(reply) {
    if (!reply || !WARN_KINDS.includes(reply.kind)) return null;
    const top = reply.stats && Number.isFinite(reply.stats.max) ? ` (whole numbers up to ${fmtMax(reply.stats.max)})` : '';
    const suggest = reply.suggest || null;
    const lead = reply.kind === 'counts'
        ? `${reply.input === 'X' ? 'X' : `Layer ${reply.input}`} looks like raw counts${top}. `
          + 'Scores should be computed on normalised, log-transformed data, or they follow sequencing depth.'
        : `${reply.input === 'X' ? 'X' : `Layer ${reply.input}`} looks normalised but not log-transformed `
          + `(values reach ${fmtMax(reply.stats && reply.stats.max)}). `
          + 'Scores should be computed on log-transformed data, or one highly expressed gene can dominate them.';
    return { kind: reply.kind, text: suggest ? `${lead} ${suggest} looks log-normalised.` : lead, suggest };
}

/**
 * The raw-count check for one layer, wherever a layer is chosen (the signature's panel, a plot, a table).
 * @param {{kind: Function}} client - from createKindClient
 * @param {string} dataset
 * @param {string} layer - X or a layer's name
 * @returns {Promise<{kind: string, text: string, suggest: (string|null)}|null>} null when the layer is fine or unknown
 */
export async function layerWarning(client, dataset, layer) {
    return warningFor(await client.kind(dataset, layer));
}

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
         */
        kind(dataset, input) {
            const key = `${dataset}\u0001${input}`;
            if (!cache.has(key)) {
                const query = new URLSearchParams({ dataset_path: dataset, input });
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
