/**
 * The panel's "Hover" picker: which obs (cell plot) or var (gene plot)
 * columns the hover label lists after x / y / colour.
 *
 * settings.hoverInfo ([{type, key, column?}]) is saved in configs, panel
 * sets and links and read by loadHoverColumns, but nothing in the panel let
 * you change it. The picker offers the 1-D annotation columns; entries it
 * cannot show (the default `_index`, matrix columns from a link) are kept
 * as they are when the selection changes.
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

/** Options for the picker: "No hover", then every annotation column, selected if configured. */
export function hoverColumnOptions(plotType, datasetStructure, hoverInfo, hoverOff) {
  const type = hoverAnnotation(plotType);
  const off = hoverOff === true || hoverOff === 'auto';
  const chosen = new Set((Array.isArray(hoverInfo) ? hoverInfo : [])
    .filter(h => h && h.type === type && !h.column)
    .map(h => h.key));
  return [{ value: NO_HOVER, label: 'No hover', selected: off }].concat((datasetStructure?.[type]?.columns || [])
    .filter(c => c !== '_index')
    .map(c => ({ value: c, label: c, selected: !off && chosen.has(c) })));
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
  selected = (selected || []).filter(v => v !== NO_HOVER);
  const kept = (Array.isArray(previous) ? previous : [])
    .filter(h => h && !(h.type === type && !h.column && h.key !== '_index'));
  if (!kept.some(h => h.type === type && h.key === '_index')) kept.unshift({ type, key: '_index' });
  return kept.concat((selected || []).filter(k => k && k !== '_index').map(key => ({ type, key })));
}

/** Fill a <select multiple> with the options. */
export function populateHoverSelect(select, plotType, datasetStructure, hoverInfo, hoverOff) {
  if (!select) return;
  select.innerHTML = '';
  for (const o of hoverColumnOptions(plotType, datasetStructure, hoverInfo, hoverOff)) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    opt.selected = o.selected;
    select.appendChild(opt);
  }
}
