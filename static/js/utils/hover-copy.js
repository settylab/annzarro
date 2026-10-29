/**
 * Press C over a point to copy what its hover label says.
 *
 * The text is the label the plot draws, built from the trace's own
 * hovertemplate and arrays (name, x, y, z, colour, the Hover picker's
 * columns), one "label: value" per line, so it holds whole values and every
 * column, whatever the label's width. Large-plot mode has no Plotly label;
 * its tooltip (panels/plot-utilities/large-interact.js) is read instead.
 *
 * C copies only while a label is showing and otherwise does nothing (toggling a
 * panel's controls is T, config.js). Typing in a field and any
 * Ctrl, Cmd or Alt chord are left alone, so Cmd+C copies a selection as usual.
 */
import { copyText, copyTextWith } from './clipboard.js';
import { notify } from './notify.js';
import { descriptorFor, VIEW_MIME } from './view-copy.js';
import { viewSummary } from './view-descriptor.js';

/** The value a template key names for one point: x, y, z, text, marker.color, hovertext, customdata. */
function valueOf(trace, pt, key) {
  const i = pt.pointNumber;
  const at = (arr) => (arr !== null && arr !== undefined && typeof arr !== 'string' && typeof arr.length === 'number' ? arr[i] : arr);
  if (key === 'x' || key === 'y' || key === 'z') return pt[key] !== undefined ? pt[key] : at(trace[key]);
  if (key === 'marker.color') return at(trace.marker && trace.marker.color);
  if (key === 'text' || key === 'hovertext' || key === 'customdata') return at(trace[key]);
  return undefined;
}

/** A number to 4 significant digits (what `.4~g` draws), anything else as text; missing values are left out. */
function formatValue(v, format) {
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
  if (typeof v === 'number' && format) return String(Number(v.toPrecision(4)));
  return String(v);
}

/**
 * The lines of a point's hover label: its trace's hovertemplate filled in
 * from the point (`<br>` starts a line, the `<extra>` box is the trace name
 * and is left out). Without a template: the name, x and y.
 * @param {Object} trace  the trace (fullData or data)
 * @param {Object} pt  a Plotly hover point: {pointNumber, x, y, z?}
 * @returns {string[]}
 */
export function hoverLines(trace, pt) {
  const template = trace && typeof trace.hovertemplate === 'string' ? trace.hovertemplate : '';
  const source = template || '%{text}<br>x: %{x}<br>y: %{y}' + (pt.z !== undefined ? '<br>z: %{z}' : '');
  const filled = source.replace(/<extra>[\s\S]*?<\/extra>/g, '')
    .replace(/%\{([^}:]+)(?::([^}]*))?\}/g, (_, key, format) => formatValue(valueOf(trace, pt, key.trim()), format));
  return filled.split(/<br\s*\/?>/i).map(s => s.trim()).filter(Boolean);
}

/**
 * Keep the points a graph's hover label is on (`gd.__azHovered`). Plotly sets
 * `_hoverdata` for 2D plots only; its 3D scenes just emit plotly_hover and
 * plotly_unhover, so both are followed here. Once per graph.
 * @param {HTMLElement} gd
 */
export function trackHover(gd) {
  if (!gd || typeof gd.on !== 'function' || gd.__azHoverTracked) return;
  gd.__azHoverTracked = true;
  gd.on('plotly_hover', (e) => { gd.__azHovered = e && Array.isArray(e.points) ? e.points : null; });
  gd.on('plotly_unhover', () => { gd.__azHovered = null; });
}

/** The graphs of the page that are drawn with Plotly (regular and large-plot mode). */
function graphs(root) {
  return root.querySelectorAll ? [...root.querySelectorAll('.js-plotly-plot')] : [];
}

/**
 * The text of the hover label showing now, or null when none does. A graph
 * counts when the pointer is over it and it has a label (`trackHover`, or Plotly's
 * `_hoverdata` while one shows) or its large-plot tooltip is up.
 * @param {Document|HTMLElement} [root]
 * @returns {string|null}
 */
export function hoverCopyText(root = document) {
  const hit = hoverCopyInfo(root);
  return hit ? hit.text : null;
}

/** Like hoverCopyText, and the graph the label is on: {text, gd}, or null. */
export function hoverCopyInfo(root = document) {
  for (const gd of graphs(root)) {
    if (typeof gd.matches === 'function' && !gd.matches(':hover')) continue;
    const st = gd.__largeState;
    if (st && st.index) {
      const tip = typeof document !== 'undefined' && document.querySelector('.large-plot-tip');
      if (st.hovered >= 0 && tip && tip.style.display !== 'none') {
        const rows = [...tip.children].map(d => d.textContent.trim()).filter(Boolean);
        if (rows.length) return { text: rows.join('\n'), gd };
      }
      continue;
    }
    const pts = gd.__azHovered || gd._hoverdata;
    if (!Array.isArray(pts) || !pts.length) continue;
    const blocks = pts.map((pt) => {
      const trace = (gd._fullData && gd._fullData[pt.curveNumber]) || (gd.data && gd.data[pt.curveNumber]) || pt.fullData;
      return trace ? hoverLines(trace, pt).join('\n') : '';
    }).filter(Boolean);
    if (blocks.length) return { text: blocks.join('\n'), gd };
  }
  return null;
}

/** True where a key press is typing: an input, textarea, select or editable element. */
function typing(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target.isContentEditable;
}

/**
 * Copy `text` and say so: "Copied hover info", or why it could not be.
 * @param {string} text
 * @param {{write?: function(string): Promise, say?: function}} [io]  for tests
 */
export async function copyHover(text, io = {}, gd = null) {
  const say = io.say || notify;
  let ok;
  try {
    // with a view: the text and the view descriptor in one gesture (view-copy.js)
    let view = null;
    try { view = gd ? descriptorFor(gd, text, io.dataset || null) : null; } catch { /* the text alone */ }
    // io.write is for tests and throws on failure; copyText resolves false instead
    if (io.write) { await io.write(text, view); ok = true; }
    else ok = view ? await copyTextWith(text, { [VIEW_MIME]: JSON.stringify(view) }) : await copyText(text);
  } catch (err) {
    console.info('Copying hover info failed:', err);
    ok = false;
  }
  if (ok) {
    say('Copied hover info', '', 'success', 1500);
    return true;
  }
  say('Not copied', 'The browser did not allow copying. Select the text and use Ctrl+C instead.', 'warning');
  return false;
}

/**
 * The drawn plot the pointer is over (its area, axes, modebar or legend), with or without a hovered
 * point; null when it is over none.
 * @param {Document|HTMLElement} [root]
 * @returns {?HTMLElement}
 */
export function plotUnderPointer(root = document) {
  return graphs(root).find(gd => gd.__azSettings && typeof gd.matches === 'function' && gd.matches(':hover')) || null;
}

/**
 * Copy the view of a plot with no point hovered: a one-line description as the text, the view
 * descriptor (no entity) as the custom flavour. Says "View copied", or why not.
 * @param {HTMLElement} gd
 * @param {{write?: function(string, Object): Promise, say?: function, dataset?: string}} [io]  for tests
 */
export async function copyView(gd, io = {}) {
  const say = io.say || notify;
  let ok = false;
  try {
    const view = descriptorFor(gd, '', io.dataset || null, { entity: false });
    if (!view) return false;
    const text = viewSummary(view);
    if (io.write) { await io.write(text, view); ok = true; }
    else ok = await copyTextWith(text, { [VIEW_MIME]: JSON.stringify(view) });
  } catch (err) {
    console.info('Copying the view failed:', err);
  }
  if (ok) {
    say('View copied', '', 'success', 1500);
    return true;
  }
  say('Not copied', 'The browser did not allow copying.', 'warning');
  return false;
}

/**
 * Add the C key. Over a point with a label it copies the label and the view; over the rest of a
 * plot, the view alone; anywhere else the event is not touched.
 * @param {function(): ?string} [currentDataset]  the open dataset, for a graph that does not know its own
 * @returns {function(): void}  removes the listener
 */
export function installHoverCopy(currentDataset = null) {
  const onKey = (e) => {
    if (e.key !== 'c' && e.key !== 'C') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || e.isComposing) return;
    if (typing(e.target) || typing(document.activeElement)) return;
    const dataset = currentDataset ? currentDataset() : null;
    const hit = hoverCopyInfo();
    if (hit !== null) {
      e.preventDefault();
      e.stopPropagation();
      copyHover(hit.text, { dataset }, hit.gd);
      return;
    }
    const gd = plotUnderPointer();
    if (!gd) return;
    e.preventDefault();
    e.stopPropagation();
    copyView(gd, { dataset });
  };
  document.addEventListener('keydown', onKey, true);
  return () => document.removeEventListener('keydown', onKey, true);
}
