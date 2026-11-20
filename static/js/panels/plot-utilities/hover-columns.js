import { getSource, hoverSources } from '../../utils/source-registry.js';

/**
 * The panel's "Hover" picker: which obs (cell plot) or var (gene plot)
 * columns the hover label lists after x / y / colour, then each provider's
 * entries (a signature's scores, a grouping) in a group of their own.
 *
 * settings.hoverInfo ([{type, key, column?}]) is saved in configs, panel
 * sets and links and read by loadHoverColumns, but nothing in the panel let
 * you change it. The picker offers the 1-D annotation columns; entries it
 * cannot show (the default `_index`, matrix columns from a link) are kept
 * as they are when the selection changes. A provider's entries are what its
 * `hover` says (utils/source-registry.js): its group, its entries and the
 * picker value of each, `${type}:...`; the picker names no source type.
 */

/**
 * The picker's "No hover" option (settings.hoverOff, utils/categories.js):
 * no hover label at all, and for a colour of many categories no labels
 * read. It starts selected past HOVER_OFF_LABELS colour labels.
 */
export const NO_HOVER = '__no_hover__';

export function hoverAnnotation(plotType) {
  return plotType === 'genes' ? 'var' : 'obs';
}

/** The consumer a plot's Hover picker lists providers for. */
const consumerOf = (plotType) => (plotType === 'genes' ? 'gene-plot' : 'cell-plot');

/** The picker value of a stored hover entry: a provider's own (its hover.valueOf), else the column's key. */
export function pickerValue(h) {
  const provider = h && getSource(h.type);
  return provider && provider.hover ? provider.hover.valueOf(h) : h.key;
}

/** The provider among `providers` whose entry a picker value is (`${type}:...`), or null for a column. */
function providerOf(value, providers) {
  return providers.find(p => value.startsWith(`${p.type}:`)) || null;
}

/**
 * Options for the picker: "No hover", then every annotation column, selected if configured; then each provider's
 * entries (its hover.options), in its group.
 */
export function hoverColumnOptions(plotType, datasetStructure, hoverInfo, hoverOff) {
  const type = hoverAnnotation(plotType);
  const off = hoverOff === true || hoverOff === 'auto';
  const info = Array.isArray(hoverInfo) ? hoverInfo : [];
  const chosen = new Set(info.filter(h => h && h.type === type && !h.column).map(h => h.key));
  const options = [{ value: NO_HOVER, label: 'No hover', selected: off }].concat((datasetStructure?.[type]?.columns || [])
    .filter(c => c !== '_index')
    .map(c => ({ value: c, label: c, selected: !off && chosen.has(c) })));
  for (const provider of hoverSources(consumerOf(plotType))) {
    const chosenHere = new Set(info.filter(h => h && h.type === provider.type).map(h => provider.hover.valueOf(h)));
    for (const o of provider.hover.options(chosenHere)) {
      options.push({ ...o, selected: !off && chosenHere.has(o.value), group: provider.hover.group });
    }
  }
  return options;
}

/**
 * settings.hoverOff after a picker change: "No hover" picked alone (or
 * newly) turns the hover off; a column picked while it was off turns it on.
 * @param {string[]} selected  the picker's selected values
 * @param {boolean|'auto'|undefined} previous
 * @returns {boolean} whether the hover is off now
 */
export function hoverOffFromSelection(selected, previous) {
  const none = (selected || []).includes(NO_HOVER);
  const columns = (selected || []).some(v => v !== NO_HOVER);
  const wasOff = previous === true || previous === 'auto';
  if (!none) return false;
  return !(columns && wasOff);
}

/** The hoverInfo a picker selection stands for. */
export function hoverInfoFromSelection(plotType, selected, previous) {
  const type = hoverAnnotation(plotType);
  const providers = hoverSources(consumerOf(plotType));
  selected = (selected || []).filter(v => v !== NO_HOVER);
  const picked = selected.filter(v => providerOf(v, providers));
  selected = selected.filter(v => !providerOf(v, providers));
  // the picker lists every entry of its providers: their entries are what it selects; another provider's (one this
  // page has not loaded, from a link) is kept
  const kept = (Array.isArray(previous) ? previous : [])
    .filter(h => h && !(h.type === type && !h.column && h.key !== '_index') && !providers.some(p => p.type === h.type));
  if (!kept.some(h => h.type === type && h.key === '_index')) kept.unshift({ type, key: '_index' });
  return kept.concat((selected || []).filter(k => k && k !== '_index').map(key => ({ type, key })),
    picked.map(v => { const provider = providerOf(v, providers); return { type: provider.type, ...provider.hover.parse(v) }; }));
}

/** Fill a <select multiple> with the options. */
export function populateHoverSelect(select, plotType, datasetStructure, hoverInfo, hoverOff) {
  if (!select) return;
  select.innerHTML = '';
  let group = null;
  let groupName = null;
  for (const o of hoverColumnOptions(plotType, datasetStructure, hoverInfo, hoverOff)) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    opt.selected = o.selected;
    if (o.group) {
      if (groupName !== o.group) {
        group = document.createElement('optgroup');
        group.label = o.group;
        select.appendChild(group);
        groupName = o.group;
      }
      group.appendChild(opt);
    } else {
      select.appendChild(opt);
    }
  }
}

/**
 * Follow what each provider offers in a Hover picker that is built (panels came or went, a signature changed what it
 * offers): a provider's group is rebuilt in place when its entries changed, and what is chosen stays chosen.
 * @param {HTMLSelectElement} select
 * @param {'cells'|'genes'} plotType
 */
export function refreshHoverGroups(select, plotType) {
  for (const provider of hoverSources(consumerOf(plotType))) {
    const label = provider.hover.group;
    const group = Array.from(select.querySelectorAll('optgroup')).find(g => g.label === label);
    const have = group ? Array.from(group.querySelectorAll('option')) : [];
    const chosen = new Set(have.filter(o => o.selected).map(o => o.value));
    const wanted = provider.hover.options(chosen);
    const same = have.length === wanted.length && wanted.every((o, i) => have[i].value === o.value && have[i].textContent === o.label);
    if (same) continue;
    if (!wanted.length) { if (group) group.remove(); continue; }
    const next = document.createElement('optgroup');
    next.label = label;
    for (const o of wanted) next.appendChild(new Option(o.label, o.value, false, chosen.has(o.value)));
    if (group) group.replaceWith(next);
    else select.appendChild(next);
  }
}
