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

export function hoverAnnotation(plotType) {
  return plotType === 'genes' ? 'var' : 'obs';
}

/** Options for the picker: every annotation column, selected if configured. */
export function hoverColumnOptions(plotType, datasetStructure, hoverInfo) {
  const type = hoverAnnotation(plotType);
  const chosen = new Set((Array.isArray(hoverInfo) ? hoverInfo : [])
    .filter(h => h && h.type === type && !h.column)
    .map(h => h.key));
  return (datasetStructure?.[type]?.columns || [])
    .filter(c => c !== '_index')
    .map(c => ({ value: c, label: c, selected: chosen.has(c) }));
}

/** The hoverInfo a picker selection stands for. */
export function hoverInfoFromSelection(plotType, selected, previous) {
  const type = hoverAnnotation(plotType);
  const kept = (Array.isArray(previous) ? previous : [])
    .filter(h => h && !(h.type === type && !h.column && h.key !== '_index'));
  if (!kept.some(h => h.type === type && h.key === '_index')) kept.unshift({ type, key: '_index' });
  return kept.concat((selected || []).filter(k => k && k !== '_index').map(key => ({ type, key })));
}

/** Fill a <select multiple> with the options. */
export function populateHoverSelect(select, plotType, datasetStructure, hoverInfo) {
  if (!select) return;
  select.innerHTML = '';
  for (const o of hoverColumnOptions(plotType, datasetStructure, hoverInfo)) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    opt.selected = o.selected;
    select.appendChild(opt);
  }
}
