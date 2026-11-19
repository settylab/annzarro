/**
 * Which options (method x layer) a signature offers its consumers, behind one function so the real
 * model can replace the stand-in without touching a menu: the signature panel decides what is offered
 * and how each option is computed (`offeredOptions(recipe, datasetLayers)` of utils/signature-options.js,
 * owned by the scoring-options step). Until that module is wired in with `setOfferProvider`, the
 * stand-in offers every method the server computes over the signature's own input and each layer of
 * the dataset.
 *
 * An option is `{id, method, layer, label, definition}`; `layer` is '' for the signature's own input,
 * the form a consumer stores. No DOM and no page state.
 */
import { METHODS, DEFAULT_METHOD } from './gene-signature.js';

const METHOD_LABELS = { zscore_mean: 'z-score mean', mean: 'mean', sum: 'sum' };

let _provider = null;
let _layers = null;           // the dataset's layers (X first), as last noted

/** Plug in the real model: `{offeredOptions(recipe, layers), enable?(signatureId, {method, layer})}`. */
export function setOfferProvider(provider) {
    _provider = provider;
}

/** The dataset's layer names, noted when a menu is built from the dataset's structure. */
export function noteLayers(layers) {
    _layers = Array.isArray(layers) ? [...layers] : null;
}

export function methodLabel(method) {
    return METHOD_LABELS[method] || method;
}

/** The stand-in: every method over the signature's own input and each layer. */
function standIn(recipe, layers) {
    const own = recipe.input || 'X';
    const all = [own, ...(layers || []).filter(l => l !== own)];
    const out = [];
    for (const method of METHODS) {
        for (const layer of all) {
            const shown = layer === own ? '' : layer;
            out.push({ id: `${method}@${shown}`, method, layer: shown,
                label: shown ? `${methodLabel(method)} · ${shown}` : methodLabel(method),
                definition: `${methodLabel(method)} of ${layer}` });
        }
    }
    return out.sort((a, b) => METHODS.indexOf(a.method) - METHODS.indexOf(b.method) || 0);
}

/** The options a signature offers, z-score mean first. */
export function offeredFor(recipe) {
    const list = _provider ? _provider.offeredOptions(recipe, _layers || []) : standIn(recipe, _layers);
    return list.map(o => ({ ...o, layer: o.layer || '' }));
}

/** The distinct layers offered ('' first: the signature's own). */
export function offeredLayers(recipe) {
    return [...new Set(offeredFor(recipe).map(o => o.layer))].sort((a, b) => (a === '') ? -1 : (b === '') ? 1 : 0);
}

/** The methods offered over one layer, in the model's order. */
export function offeredMethods(recipe, layer = '') {
    return offeredFor(recipe).filter(o => o.layer === layer).map(o => o.method);
}

/**
 * Whether a consumer's choice is offered. A layer the dataset does not have is left to the server to
 * say so (a state of its own), so it counts as offered here.
 */
export function isOffered(recipe, method, layer = '') {
    if (layer && _layers && !_layers.includes(layer)) return true;
    const want = method || DEFAULT_METHOD;
    return offeredFor(recipe).some(o => o.method === want && o.layer === (layer === recipe.input ? '' : layer || ''));
}

/** One-click re-enable of an option the signature stopped offering; false when the model cannot. */
export function enableOption(signatureId, option) {
    return !!(_provider && typeof _provider.enable === 'function' && _provider.enable(signatureId, option) !== false);
}
