/**
 * The cost limits the server enforces, as this tab must keep to them (limits.* in the server's configuration and on
 * its admin Settings page; annzarro/core/cost_limits.py holds the table, docs/deployment/resource-limits.md
 * "Cost limits" explains each).
 *
 * The values come from GET /api/v1/policy/effective (policy.js), so a check made here before a request (the Cell-Gene
 * matrix, the groups of a grouping, the cells of a count grid) uses the server's number, and a limit only the browser
 * keeps (the 3D bars, the export, the dendrogram rows) is still the administrator's to set. A server that sends no
 * policy (an older one), or before the policy has loaded, gets the defaults of limits-defaults.json, which is written
 * from the server's table (`python -m annzarro.core.cost_limits`; a test fails when it is stale).
 *
 * Read a limit when it is needed, not once at import: the administrator can change it under an open tab, and the
 * policy reloads when a reply names another version. A refusal from the server names the limit in force (`limit`);
 * prefer that number when there is one.
 */
import { Policy } from '../policy.js';
import DEFAULTS from '../limits-defaults.json' with { type: 'json' };

const PREFIX = 'limits.';

/** The names of every cost limit, as the server's table has them. */
// export-unused-ok: the tests hold the defaults file to the table through it
export const LIMIT_NAMES = Object.freeze(Object.keys(DEFAULTS).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length)));

/**
 * The default of limit `name`, as the server ships it.
 * @param {string} name - e.g. 'matrix_values'
 * @returns {number}
 */
export function limitDefault(name) {
    const value = DEFAULTS[PREFIX + name];
    if (typeof value !== 'number') throw new Error(`Unknown limit "${name}"`);
    return value;
}

/**
 * Limit `name` in force: the server's value, or the default when the server sends none (or one that is not a finite
 * number, which a server never does).
 * @param {string} name - e.g. 'matrix_values', 'groups', 'bars_3d_max'
 * @param {{get: (key: string, fallback?: *) => *}} [policy] - the policy to read; the page's by default
 * @returns {number}
 */
export function limit(name, policy = Policy) {
    const fallback = limitDefault(name);
    const value = policy.get(PREFIX + name, fallback);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
