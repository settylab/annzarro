/**
 * Every section the Gene Set Analysis panel offers, registered in the order
 * the panel lists them (after Links, which is not an adapter).
 */
import { registerAdapter } from '../registry.js';
import { stringEnrichment, stringNetwork, stringPartners } from './string.js';
import { gprofilerGost } from './gprofiler.js';
import { mygeneMapping, mygeneCard } from './mygene.js';
import { enrichr, reactome, hpa } from './optional.js';

export const ADAPTERS = [mygeneCard, stringEnrichment, gprofilerGost, stringNetwork, mygeneMapping,
    stringPartners, hpa, enrichr, reactome];

let _registered = false;

/** Register them once per page (the panel module and tests call this). */
export function registerAll(opts) {
    if (_registered) return;
    _registered = true;
    for (const a of ADAPTERS) registerAdapter(a, opts);
}
