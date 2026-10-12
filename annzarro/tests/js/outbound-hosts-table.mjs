/**
 * The hosts the Gene Set Analysis panel's code contacts, as the code states
 * them: what the server's panel keys (server/policy/panels.py) must equal.
 * outbound-hosts.test.mjs checks its shape; tests/server/test_policy_csp.py
 * runs this file (`node outbound-hosts-table.mjs`) and compares the JSON.
 */
import { pathToFileURL } from 'node:url';

const registry = await import('../../../static/js/panels/gene-set-utilities/registry.js');
const { ADAPTERS } = await import('../../../static/js/panels/gene-set-utilities/services/index.js');
const { remoteSpeciesSearch } = await import('../../../static/js/panels/gene-set-utilities/species.js');

export const CUSTOM_STRING = 'https://string.example.org:8443/api';

/** `[id, hosts]` of every adapter, for the default STRING and for a configured base URL. */
export function adapterHosts() {
    const configured = { services: { string: { api: CUSTOM_STRING } } };
    return {
        default: ADAPTERS.map(a => [a.id, registry.hostsOf(a, {})]),
        configured: ADAPTERS.map(a => [a.id, registry.hostsOf(a, configured)])
    };
}

/** The hosts a species search tries when the first does not answer. */
export async function speciesHosts() {
    const seen = [];
    const fetchImpl = async (url) => {
        const host = new URL(url).host;
        if (!seen.includes(host)) seen.push(host);
        if (host !== 'www.ebi.ac.uk') throw new TypeError('Failed to fetch');
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => '[]' };
    };
    await remoteSpeciesSearch('mouse', {
        fetchImpl, setTimeout: (...a) => setTimeout(...a), clearTimeout: (t) => clearTimeout(t), now: () => Date.now(),
        online: () => true
    });
    return seen;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.stdout.write(JSON.stringify({ adapters: adapterHosts(), species: await speciesHosts(), customString: CUSTOM_STRING }));
}
