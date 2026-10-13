/**
 * What a Cell Plot's controls offer while the panel is above the large-plot
 * threshold (large-plot.js), and the rules both share.
 *
 * Above the threshold the panel draws only what large-plot mode can draw. The
 * controls say so instead of letting a choice fail: the axis and colour types
 * the mode cannot draw are disabled, and so are the 3D toggle and z axis,
 * the Hover picker (the tooltip shows the name, position and colour; extra
 * columns are not read) and the table filter (a cell table cannot list this
 * many cells), each with a tooltip naming the way out. Hover, click and the
 * Highlight Focused Cell toggle work in this mode.
 * Below the threshold (or with a subset on) everything is enabled again, with
 * the tooltips it had before. A toggle that is on keeps its state;
 * styles.css draws it as off while `data-large-off` is set, so it neither
 * reads as on nor loses the user's choice.
 *
 * DOM only, no other imports, so it can be tested without a browser.
 */

/** Data sources large-plot mode can draw, per axis. */
export const LARGE_TYPES = Object.freeze({
  x: Object.freeze(['obsm', 'obs', 'layer']),
  y: Object.freeze(['obsm', 'obs', 'layer']),
  color: Object.freeze(['obsm', 'obs', 'layer', 'none'])
});

/** Points above which a Cell Plot uses large-plot mode; `defaults` is Config.DEFAULTS. */
export function largeThreshold(defaults) {
  const v = defaults && defaults.LARGE_PLOT_POINTS;
  return typeof v === 'number' && v >= 0 ? v : 1000000;
}

/** The title of an axis choice large-plot mode cannot draw. */
export const TEXT_AXIS_TIP = 'Categorical: use a subset or a numeric column';

/**
 * Whether an obs column's info (from the dataset structure) says its values are
 * labels: a categorical column, or strings stored as text. Large-plot mode draws
 * an axis from numbers only.
 * @param {{type?: string}|undefined} info
 */
export function isTextColumn(info) {
  const t = info && typeof info.type === 'string' ? info.type : '';
  // dtype names as the server reports them: object, str, StringDType(), <U7, |S4 ...
  return t === 'categorical' || /(str|object|unicode)/i.test(t) || /^[<>|=]?[US]\d*$/.test(t);
}

/**
 * The obs columns that cannot be an x or y axis of a large plot.
 * @returns {Set<string>}
 */
export function textObsColumns(structure) {
  const info = structure && structure.obs && structure.obs.columns_info;
  const out = new Set();
  if (info) for (const key of Object.keys(info)) if (isTextColumn(info[key])) out.add(key);
  return out;
}

/** "5M", "95.6M" or "12,000". */
export function formatPoints(n) {
  if (n >= 1e6) return `${Number((n / 1e6).toFixed(1))}M`;
  return Number(n).toLocaleString('en-US');
}

/** The tooltip on a control that large-plot mode turns off. */
export function largePlotTooltip(threshold) {
  return `Not available for more than ${formatPoints(threshold)} cells. Make a subset of up to ${formatPoints(threshold)} cells to use it.`;
}

function _off(el, tip) {
  if (!el) return;
  if (el.dataset.largeOff !== '1') {
    el.dataset.largeOff = '1';
    el.dataset.largeWasDisabled = el.disabled ? '1' : '0';
    el.dataset.largeTitle = el.getAttribute('title') || '';
  }
  el.disabled = true;
  el.setAttribute('title', tip);
}

function _on(el) {
  if (!el || el.dataset.largeOff !== '1') return;
  el.disabled = el.dataset.largeWasDisabled === '1';
  if (el.dataset.largeTitle) el.setAttribute('title', el.dataset.largeTitle);
  else el.removeAttribute('title');
  delete el.dataset.largeOff;
  delete el.dataset.largeWasDisabled;
  delete el.dataset.largeTitle;
}

/**
 * Turn the panel's controls to what large-plot mode supports (`active`), or
 * back. Idempotent; safe to call on every draw.
 * @param {Element} root  the panel (holds the plot controls)
 * @param {boolean} active  the panel shows more points than `threshold`
 * @param {number} threshold
 */
/**
 * Grey out (or restore) the label columns in an obs axis's key select. They stay
 * listed, with a title saying why, so users see the limit instead of a missing column.
 * @param {HTMLSelectElement} keySelect
 * @param {boolean} active  large-plot mode is on
 * @param {Set<string>} blocked  textObsColumns(structure)
 */
export function limitTextAxisOptions(keySelect, active, blocked) {
  if (!keySelect) return;
  const obs = keySelect.dataset.keyType === 'obs';
  for (const option of Array.from(keySelect.options || [])) {
    if (active && obs && blocked && blocked.has(option.value)) _off(option, TEXT_AXIS_TIP);
    else _on(option);
  }
}

export function updateLargePlotControls(root, active, threshold, structure = null) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const tip = largePlotTooltip(threshold);
  const set = (el) => (active ? _off(el, tip) : _on(el));
  for (const axis of ['x', 'y', 'color']) {
    for (const select of root.querySelectorAll(`select.axis-type-select[data-axis="${axis}"]`)) {
      for (const option of Array.from(select.options || [])) {
        if (!LARGE_TYPES[axis].includes(option.value) && option.value !== '') set(option);
      }
    }
  }
  if (structure) {
    const blocked = textObsColumns(structure);
    for (const axis of ['x', 'y']) {
      for (const select of root.querySelectorAll(`select.axis-key-select[data-axis="${axis}"]`)) {
        const type = root.querySelector(`select.axis-type-select[data-axis="${axis}"]`);
        select.dataset.keyType = type ? type.value : '';
        limitTextAxisOptions(select, active, blocked);
      }
    }
  }
  for (const el of root.querySelectorAll(
    'select.axis-type-select[data-axis="z"], select.hover-columns-select, select.table-filter-select, '
    + 'button[id^="z-axis-toggle-"]')) {
    set(el);
  }
}
