/**
 * Shared by the Gene Set Analysis adapters: how a long result is shown
 * (the first rows, then all of them on request: nothing is cut without
 * saying so) and the attribution line every section carries.
 */
import { hostOf, ServiceError } from '../fetch-policy.js';
import { speciesOf } from '../species.js';
import { Coverage, GAP } from '../../../utils/coverage.js';

/** Rows shown before "Show all". */
export const FIRST_ROWS = 25;

/**
 * A table of `rows` with the first FIRST_ROWS shown and a "Show all N"
 * button that shows the rest (locally; nothing is fetched).
 * @param {Object} ctx - render context
 * @param {string} caption
 * @param {Array} columns
 * @param {Array<Array>} rows
 * @param {string} noun - 'terms', 'pathways'
 */
export function longTable(ctx, caption, columns, rows, noun) {
    const { el, table } = ctx;
    const box = el('div', { class: 'gs-long' });
    const draw = (all) => {
        ctx.clear(box);
        const shown = all ? rows : rows.slice(0, FIRST_ROWS);
        box.appendChild(table(caption, columns, shown));
        if (rows.length > FIRST_ROWS) {
            box.appendChild(el('div', { class: 'gs-more' },
                el('span', { text: all ? `All ${rows.length.toLocaleString('en-US')} ${noun}` : `First ${shown.length} of ${rows.length.toLocaleString('en-US')} ${noun}` }),
                el('button', { type: 'button', class: 'btn btn-link btn-sm', text: all ? 'Show fewer' : `Show all ${rows.length.toLocaleString('en-US')}`,
                    on: { click: () => draw(!all) } })));
        }
    };
    draw(false);
    return box;
}

/** "Data: STRING 12.5 (CC BY 4.0) · string-db.org" under a section's result. */
export function attribution(ctx, provider, extra = '') {
    const { el, link } = ctx;
    return el('div', { class: 'gs-attribution' },
        'Data: ', link(provider.home, `${provider.name}${provider.version ? ` ${provider.version}` : ''}`),
        provider.licence ? ` (${provider.licence})` : '', extra ? ` · ${extra}` : '');
}

/** A gene name that focuses the gene when it is in the dataset, else plain text. */
export function geneButton(ctx, name) {
    const { el } = ctx;
    if (name && ctx.hasGene && ctx.hasGene(name)) {
        return el('button', { type: 'button', class: 'btn btn-link btn-sm gs-gene', text: name,
            aria: { label: `Focus ${name}` }, on: { click: () => ctx.focusGene(name) } });
    }
    return el('span', { class: 'gs-gene-text', text: name || '' });
}

/** The host an adapter's base URL points at (for consent and errors). */
export function apiHost(url, fallback) {
    const h = hostOf(url || '');
    return h && h.includes('.') ? h : fallback;
}

/**
 * The section's coverage: `found` of the `input` genes known to `service`;
 * the rest named (the first few) in the strip.
 * @param {number} found
 * @param {string[]} genes - what was sent
 * @param {string[]} missing - what the service did not know
 * @param {string} service
 */
export function mappedCoverage(found, genes, missing, service) {
    const n = genes.length;
    if (found >= n) return Coverage.complete(n, 'genes');
    // the strip's line stays short; its breakdown lists every gene (gap.names)
    const summary = missing.slice(0, 5).join(', ') + (missing.length > 5 ? `, and ${(missing.length - 5).toLocaleString('en-US')} more` : '');
    return new Coverage({ shown: found, total: n, unit: 'genes', gaps: [{
        reason: GAP.UNAVAILABLE, kind: 'unmapped', source: service, count: n - found, detail: summary, names: missing.slice() }] });
}

function speciesName(tax) {
    const s = speciesOf(tax);
    return s.name ? `${s.name} (taxon ${tax})` : `taxon ${tax}`;
}

/**
 * A service that knows none of the genes: usually the wrong species, or ids
 * the service does not read. Said so, with the species asked for and, when
 * the dataset's ids point elsewhere (input.dataTaxonomyId), that species.
 */
export function noneKnown(service, input) {
    const n = input.genes.length;
    let message = `${service} knows none of these ${n.toLocaleString('en-US')} genes for ${speciesName(input.taxonomyId)}. Is the species right?`;
    if (input.dataTaxonomyId && String(input.dataTaxonomyId) !== String(input.taxonomyId)) {
        message += ` The dataset's genes look like ${speciesName(input.dataTaxonomyId)}.`;
    } else if (input.idType && input.idType !== 'unknown') {
        message += ` The ids are read as ${({ symbol: 'gene names', ensembl: 'Ensembl ids', entrez: 'Entrez ids' })[input.idType]}; check IDs too.`;
    }
    return new ServiceError({ kind: 'unmapped', message });
}

/**
 * The note under a table that pools several categories (sources), each
 * corrected on its own by the service. Nothing is recomputed: the service
 * returns only the terms passing its threshold, so a pooled correction of
 * them would be wrong.
 */
export function withinNote(stat, unit, service, n) {
    return `${stat} is corrected within each ${unit} by ${service}, not across the ${n} ${unit === 'category' ? 'categories' : `${unit}s`} shown together. `
        + `Expect more false positives than the ${stat} column suggests; pick a ${unit} for a corrected list.`;
}
