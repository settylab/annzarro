/**
 * The Gene Set Analysis panel's sections: one adapter per external service
 * request (services/*.js register theirs). The adapter contract:
 *
 * @typedef {Object} GeneSetAdapter
 * @property {string} id              stable, in links: 'string-enrichment'
 * @property {string} version         bump when the request or the result shape changes (part of the input key)
 * @property {string} label           'Enrichment'
 * @property {{name: string, host: string, home: string, version?: string,
 *   licence?: string, minIntervalMs?: number, maxConcurrent?: number}} provider
 *   `host` is what the consent bar and the errors name ('string-db.org')
 * @property {string[]} [hosts]       every host the adapter calls (default [provider.host])
 * @property {(input: Object) => string[]} [hostsFor]  the hosts for this input (a configured base URL)
 * @property {'set'|'gene'} kind      the snapshot's genes, or the focused gene
 * @property {boolean} defaultVisible
 * @property {{minGenes: number, maxGenes: number}} limits  never truncated: more is refused
 * @property {('symbol'|'ensembl'|'entrez')[]} [idTypes]   ids it understands (default: any)
 * @property {(taxonomyId: string) => boolean|'unknown'} supportsSpecies
 * @property {Object<string, {type: 'number'|'enum'|'multi'|'bool', default: *, label: string,
 *   options?: Array, min?: number, max?: number}>} [params]  small options, in the section's settings
 * @property {{stores: 'public'|'token', text: string}} [privacy]  the service keeps the list where
 *   others can read it: asked every session, never "always"
 * @property {(input: Object, io: Object) => Promise<*>} fetch
 *   reaches the network only through io (io.fetchJson/fetchText/fetchBlob, which pass io.signal);
 *   never touches the DOM, DataManager or PanelManager
 * @property {(result: *, el: HTMLElement, ctx: Object) => (void|(() => void))} render
 *   builds DOM under `el` with ctx.el / ctx.table, text only; images only through ctx.blobImage
 * @property {(result: *, input: Object) => Object|null} [coverage]  a Coverage for the section's strip
 * @property {(input: Object, result?: *) => string|null} [openUrl]  the service's own page for this input
 * @property {(result: *) => {columns: string[], rows: Array[]}} [exportRows]  the result as CSV
 */

const _adapters = [];

/** Why `adapter` does not satisfy the contract, or [] when it does. */
export function adapterProblems(adapter) {
    const p = [];
    if (!adapter || typeof adapter !== 'object') return ['not an object'];
    if (typeof adapter.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(adapter.id)) p.push('id');
    if (adapter.id === 'links') p.push('id "links" is the Links section');
    if (typeof adapter.version !== 'string' || !adapter.version) p.push('version');
    if (typeof adapter.label !== 'string' || !adapter.label) p.push('label');
    const pr = adapter.provider;
    if (!pr || typeof pr.name !== 'string' || typeof pr.host !== 'string' || typeof pr.home !== 'string'
        || !pr.home.startsWith('https://')) p.push('provider {name, host, home}');
    if (adapter.hosts !== undefined && (!Array.isArray(adapter.hosts) || !adapter.hosts.every(h => typeof h === 'string'))) p.push('hosts');
    if (adapter.hostsFor !== undefined && typeof adapter.hostsFor !== 'function') p.push('hostsFor');
    if (adapter.kind !== 'set' && adapter.kind !== 'gene') p.push('kind');
    if (typeof adapter.defaultVisible !== 'boolean') p.push('defaultVisible');
    const l = adapter.limits;
    if (!l || !(l.minGenes >= 0) || !(l.maxGenes >= 1) || l.minGenes > l.maxGenes) p.push('limits');
    if (typeof adapter.supportsSpecies !== 'function') p.push('supportsSpecies');
    if (typeof adapter.fetch !== 'function' || adapter.fetch.length < 2) p.push('fetch(input, io)');
    if (typeof adapter.render !== 'function') p.push('render');
    for (const name of ['coverage', 'openUrl', 'exportRows']) {
        if (adapter[name] !== undefined && typeof adapter[name] !== 'function') p.push(name);
    }
    for (const [name, spec] of Object.entries(adapter.params || {})) {
        if (!spec || !['number', 'enum', 'multi', 'bool'].includes(spec.type) || spec.default === undefined
            || typeof spec.label !== 'string') p.push(`params.${name}`);
        else if ((spec.type === 'enum' || spec.type === 'multi') && !Array.isArray(spec.options)) p.push(`params.${name}.options`);
    }
    if (adapter.privacy !== undefined && (!adapter.privacy || typeof adapter.privacy.text !== 'string')) p.push('privacy');
    return p;
}

/**
 * Add a section. A broken adapter is refused: thrown in tests (`strict`),
 * logged and skipped in the app, so one bad adapter cannot take the panel down.
 */
export function registerAdapter(adapter, { strict = false } = {}) {
    const problems = adapterProblems(adapter);
    if (!problems.length && _adapters.some(a => a.id === adapter.id)) problems.push(`duplicate id ${adapter.id}`);
    if (problems.length) {
        const msg = `gene-set adapter ${adapter && adapter.id}: ${problems.join(', ')}`;
        if (strict) throw new Error(msg);
        console.error(msg);
        return false;
    }
    _adapters.push(Object.freeze({ hosts: [adapter.provider.host], ...adapter }));
    return true;
}

/** Every registered adapter, in registration order. */
export function allAdapters() {
    return _adapters.slice();
}

/**
 * The adapters this server allows: integrations.gene_set.services, a list
 * of adapter ids or service names ('string' for every string-* adapter;
 * null or absent: all of them).
 * @param {{services: string[]|null}} integrations
 */
export function enabledAdapters(integrations) {
    const allowed = integrations && Array.isArray(integrations.services) ? integrations.services : null;
    return _adapters.filter(a => !allowed || allowed.includes(a.id) || allowed.includes(a.id.split('-')[0]));
}

/** The hosts an adapter will call for this input. */
export function hostsOf(adapter, input) {
    try {
        if (typeof adapter.hostsFor === 'function') return adapter.hostsFor(input);
    } catch { /* fall back to the declared hosts */ }
    return adapter.hosts || [adapter.provider.host];
}

/** For tests: forget every adapter. */
export function _resetRegistry() {
    _adapters.length = 0;
}
