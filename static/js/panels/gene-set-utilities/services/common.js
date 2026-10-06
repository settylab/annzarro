/**
 * Shared by the Gene Set Analysis adapters: how a long result is shown
 * (the first rows, then all of them on request: nothing is cut without
 * saying so) and the attribution line every section carries.
 */
import { hostOf } from '../fetch-policy.js';
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

/** The genes that were not found, all of them, in a details element. */
export function unmappedList(ctx, names, service) {
    const { el } = ctx;
    if (!names.length) return null;
    return el('details', { class: 'gs-unmapped' },
        el('summary', { text: `${names.length.toLocaleString('en-US')} not found in ${service}` }),
        el('p', { class: 'gs-unmapped__list', text: names.join(', ') }));
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
    const names = missing.slice(0, 5).join(', ') + (missing.length > 5 ? ', …' : '');
    return new Coverage({ shown: found, total: n, unit: 'genes', gaps: [{
        reason: GAP.UNAVAILABLE, kind: 'unmapped', source: service, count: n - found, detail: names }] });
}
