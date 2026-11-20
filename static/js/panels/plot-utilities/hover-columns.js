import { DEFAULT_INPUT, DEFAULT_METHOD, methodShort } from '../../utils/signature-options.js';
import { entityLabel } from '../../utils/score-source-panels.js';

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

/** The picker's value for a score: `gene-score:<signature id>:<method>:<layer>` (layer empty for the signature's default). */
export const SCORE_PREFIX = 'gene-score:';

/** The picker value of one score. */
export const scoreValue = (id, method, layer = '') => `${SCORE_PREFIX}${id}:${method}:${layer || ''}`;

/** `{key, column, layer}` of a picker value of a score (layer only when the value names one). */
export function parseScoreValue(value) {
  const rest = value.slice(SCORE_PREFIX.length);
  const parts = rest.split(':');
  if (parts.length < 3) return { key: parts[0], column: parts[1] || DEFAULT_METHOD };
  const layer = parts.pop();
  const column = parts.pop();
  return { key: parts.join(':'), column, ...(layer ? { layer } : {}) };
}

/** The picker value of a stored hover entry that reads a score; one with no layer reads the source's own. */
export function hoverScoreValue(h, inputOf = () => DEFAULT_INPUT) {
  return scoreValue(h.key, h.column || DEFAULT_METHOD, h.layer || inputOf(h.key) || DEFAULT_INPUT);
}

/** The optgroup the scores sit in. */
export const SCORE_GROUP = 'Gene scores';

/**
 * The picker's entries for gene scores: each score a source offers (`source.options`: [{method, layer, label}]), then
 * any value in `kept` that it no longer offers (kept and marked, so the plot still has it). A source's first entry is
 * named by the source alone.
 * @param {Array<{id: string, title: string, kind?: string, options?: Object[]}>} sources
 * @param {Iterable<string>} kept - picker values chosen now
 * @returns {Array<{value: string, label: string}>}
 */
export function scoreHoverOptions(sources, kept) {
  const out = [];
  for (const source of sources) {
    const mine = (source.options || []).map(o => ({ value: scoreValue(source.id, o.method, o.layer), label: o.label }));
    for (const value of kept) {
      const got = parseScoreValue(value);
      if (got.key === source.id && !mine.some(m => m.value === value)) {
        mine.push({ value, label: `${methodShort(got.column)}${got.layer ? ` · ${got.layer}` : ''} (no longer offered)` });
      }
    }
    const name = entityLabel(source);
    mine.forEach((o, i) => out.push({ value: o.value, label: i === 0 ? name : `${name} · ${o.label}` }));
  }
  return out;
}

/**
 * Options for the picker: "No hover", then every annotation column, selected if configured; in a cell plot
 * then the gene scores (scoreHoverOptions).
 */
export function hoverColumnOptions(plotType, datasetStructure, hoverInfo, hoverOff, signatures = []) {
  const type = hoverAnnotation(plotType);
  const off = hoverOff === true || hoverOff === 'auto';
  const info = Array.isArray(hoverInfo) ? hoverInfo : [];
  const chosen = new Set(info.filter(h => h && h.type === type && !h.column).map(h => h.key));
  const options = [{ value: NO_HOVER, label: 'No hover', selected: off }].concat((datasetStructure?.[type]?.columns || [])
    .filter(c => c !== '_index')
    .map(c => ({ value: c, label: c, selected: !off && chosen.has(c) })));
  if (plotType === 'genes') return options;
  const inputOf = (key) => (signatures.find(s => s.id === key) || {}).input;
  const scored = new Set(info.filter(h => h && h.type === 'gene-score').map(h => hoverScoreValue(h, inputOf)));
  for (const o of scoreHoverOptions(signatures, scored)) {
    options.push({ ...o, selected: !off && scored.has(o.value), group: SCORE_GROUP });
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
export function populateHoverSelect(select, plotType, datasetStructure, hoverInfo, hoverOff, signatures = []) {
  if (!select) return;
  select.innerHTML = '';
  let group = null;
  let groupName = null;
  for (const o of hoverColumnOptions(plotType, datasetStructure, hoverInfo, hoverOff, signatures)) {
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
