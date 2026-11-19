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

/** The picker's value for a signature's score: `gene-score:<the signature's panel id>:<aggregation>`. */
export const SCORE_PREFIX = 'gene-score:';

/** The aggregations a hover column can use, z-score mean first (the registry's list; this module has no imports). */
export const SCORE_SUBS = Object.freeze([{ value: 'zscore_mean', label: 'z-score mean' }, { value: 'mean', label: 'mean' },
  { value: 'control_adjusted', label: 'control-adjusted' }]);

/** The picker value of one score. */
export const scoreValue = (id, sub) => `${SCORE_PREFIX}${id}:${sub}`;

/** `{key, column}` of a picker value of a score. */
export function parseScoreValue(value) {
  const rest = value.slice(SCORE_PREFIX.length);
  const at = rest.lastIndexOf(':');
  return at < 0 ? { key: rest, column: SCORE_SUBS[0].value } : { key: rest.slice(0, at), column: rest.slice(at + 1) };
}

/** Options for the picker: "No hover", then every annotation column, selected if configured; in a cell plot then each signature's score. */
export function hoverColumnOptions(plotType, datasetStructure, hoverInfo, hoverOff, signatures = [], subs = SCORE_SUBS) {
  const type = hoverAnnotation(plotType);
  const off = hoverOff === true || hoverOff === 'auto';
  const info = Array.isArray(hoverInfo) ? hoverInfo : [];
  const chosen = new Set(info.filter(h => h && h.type === type && !h.column).map(h => h.key));
  const scored = new Set(info.filter(h => h && h.type === 'gene-score').map(h => scoreValue(h.key, h.column || subs[0].value)));
  const options = [{ value: NO_HOVER, label: 'No hover', selected: off }].concat((datasetStructure?.[type]?.columns || [])
    .filter(c => c !== '_index')
    .map(c => ({ value: c, label: c, selected: !off && chosen.has(c) })));
  if (plotType !== 'genes') {
    for (const sig of signatures) {
      subs.forEach((sub, i) => {
        const value = scoreValue(sig.id, sub.value);
        options.push({ value, label: i === 0 ? sig.title : `${sig.title} · ${sub.label}`, selected: !off && scored.has(value), group: 'Gene scores' });
      });
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
  selected = (selected || []).filter(v => v !== NO_HOVER);
  const scores = selected.filter(v => v.startsWith(SCORE_PREFIX));
  selected = selected.filter(v => !v.startsWith(SCORE_PREFIX));
  const kept = (Array.isArray(previous) ? previous : [])
    .filter(h => h && !(h.type === type && !h.column && h.key !== '_index') && h.type !== 'gene-score');
  if (!kept.some(h => h.type === type && h.key === '_index')) kept.unshift({ type, key: '_index' });
  return kept.concat((selected || []).filter(k => k && k !== '_index').map(key => ({ type, key })),
    scores.map(v => ({ type: 'gene-score', ...parseScoreValue(v) })));
}

/** Fill a <select multiple> with the options. */
export function populateHoverSelect(select, plotType, datasetStructure, hoverInfo, hoverOff, signatures = [], subs = SCORE_SUBS) {
  if (!select) return;
  select.innerHTML = '';
  let group = null;
  let groupName = null;
  for (const o of hoverColumnOptions(plotType, datasetStructure, hoverInfo, hoverOff, signatures, subs)) {
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
