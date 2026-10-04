/**
 * Image export of a plot, in two ways:
 *
 * - FULL: the plot drawn again off screen at the export's size, as
 *   Plotly.toImage does. Its cost is the points: Plotly reruns its calc and
 *   uploads new GPU buffers for every point, so at 95.6M points in
 *   large-plot mode it needs about as much JS memory again as the plot holds.
 *   Unlike Plotly.toImage, the traces' arrays are shared with the plot
 *   rather than deep-copied (the regular path's arrays are plain JS arrays,
 *   and the copy alone cost a second set of them), and the off-screen plot's
 *   WebGL side is released (release-plot.js) before the image is encoded.
 *
 * - AS SHOWN: the plot as it is on screen, from what is already drawn: the
 *   page's SVG layers, cloned, and the WebGL canvases read back (Plotly
 *   creates them with preserveDrawingBuffer). It costs the pixels, never the
 *   points. Plotly's own Snapshot.toSVG cannot be used for this: it moves
 *   the live graph's layers and removes its drag layer.
 *
 * Both state the coverage gap in the image (exportWithCoverage).
 */
import { exportWithCoverage } from './panel-surface.js';
import { releasePlot } from './release-plot.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
/** Plotly draws its WebGL canvases at config plotGlPixelRatio (default 2); an AS SHOWN image keeps it. */
export function ratioOf(gd) {
    const r = gd && gd._context && Number(gd._context.plotGlPixelRatio);
    return r > 0 ? r : 2;
}

const isPlain = (v) => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

/**
 * A copy of a trace (or layout) whose plain objects are new and whose
 * arrays are the same: Plotly may write into the objects it is given
 * (uid, ranges found by autorange), but does not write into data arrays.
 */
export function copyObjects(value) {
    if (!isPlain(value)) return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = isPlain(v) ? copyObjects(v) : v;
    return out;
}

/** A layout copy safe to draw elsewhere: objects new, small arrays (annotations, ranges) copied too. */
function copyLayout(layout) {
    const out = copyObjects(layout || {});
    for (const [k, v] of Object.entries(out)) {
        if (Array.isArray(v)) out[k] = v.map(copyObjects);
        else if (isPlain(v)) {
            for (const [k2, v2] of Object.entries(v)) if (Array.isArray(v2) && v2.length < 1000) v[k2] = v2.map(copyObjects);
        }
    }
    return out;
}

function _plotly() {
    if (typeof Plotly === 'undefined' || !Plotly.Snapshot) throw new Error('Plotly is not loaded');
    return Plotly;
}

/**
 * The FULL export of `gd`: a data URL (png, jpeg, webp) or SVG text.
 * @param {HTMLElement} gd
 * @param {{format: string, width: number, height: number, scale: number}} opts
 * @returns {Promise<string>}
 */
export async function fullImage(gd, { format = 'png', width = 1200, height = 800, scale = 1 } = {}) {
    const P = _plotly();
    const S = P.Snapshot;
    const clone = document.createElement('div');
    clone.style.position = 'absolute';
    clone.style.left = '-5000px';
    document.body.appendChild(clone);
    let svg, w, h;
    try {
        const data = (gd.data || []).map(copyObjects);
        const layout = { ...copyLayout(gd.layout), width, height };
        const config = { ...(gd._context || {}), _exportedPlot: true, staticPlot: true, setBackground: false };
        await P.newPlot(clone, data, layout, config);
        await S.getRedrawFunc(clone)();
        await new Promise(resolve => setTimeout(resolve, S.getDelay(clone._fullLayout)));
        w = clone._fullLayout.width;
        h = clone._fullLayout.height;
        svg = S.toSVG(clone, format, scale);
    } finally {
        // before the image is encoded: the off-screen plot's points and GPU
        // buffers are not needed for it
        releasePlot(clone);
        clone.remove();
    }
    if (format === 'svg') return svg;
    return S.svgToImg({ format, width: w, height: h, scale, canvas: document.createElement('canvas'), svg, promise: true });
}

/** Whether `gd` can be exported AS SHOWN (2D plots; a 3D scene does not keep its drawn image). */
export function canSnapshot(gd) {
    const fl = gd && gd._fullLayout;
    if (!fl || !fl._paper) return false;
    return !((fl._subplots && fl._subplots.gl3d) || []).length;
}

/** Pixel size of an AS SHOWN export of `gd`. */
export function snapshotSize(gd, ratio = ratioOf(gd)) {
    const fl = gd && gd._fullLayout;
    return fl ? { width: Math.round(fl.width * ratio), height: Math.round(fl.height * ratio), cssWidth: fl.width, cssHeight: fl.height }
        : { width: 0, height: 0, cssWidth: 0, cssHeight: 0 };
}

/**
 * The plot as shown, as SVG text: the paper layer cloned, the WebGL
 * canvases as images where Plotly's own export puts them (the glimages
 * group), then the top layer (legend, colour bar, annotations).
 */
export function snapshotSvg(gd) {
    const fl = gd._fullLayout;
    const width = fl.width, height = fl.height;
    const paper = fl._paper.node().cloneNode(true);
    paper.querySelectorAll('.draglayer').forEach(n => n.remove());
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', '0');
    bg.setAttribute('y', '0');
    bg.setAttribute('width', String(width));
    bg.setAttribute('height', String(height));
    bg.setAttribute('fill', fl.paper_bgcolor || '#fff');
    paper.insertBefore(bg, paper.firstChild);
    paper.style.background = '';

    const layer = paper.querySelector('.glimages') || paper;
    const origin = gd.getBoundingClientRect();
    for (const canvas of gd.querySelectorAll('.gl-container canvas')) {
        if (canvas.classList.contains('gl-canvas-pick') || !canvas.width || !canvas.height) continue;
        const r = canvas.getBoundingClientRect();
        const img = document.createElementNS(SVG_NS, 'image');
        img.setAttributeNS(XLINK_NS, 'xlink:href', canvas.toDataURL('image/png'));
        img.setAttribute('x', String(r.left - origin.left));
        img.setAttribute('y', String(r.top - origin.top));
        img.setAttribute('width', String(r.width || width));
        img.setAttribute('height', String(r.height || height));
        img.setAttribute('preserveAspectRatio', 'none');
        layer.appendChild(img);
    }
    const top = fl._toppaper && fl._toppaper.node();
    if (top) {
        for (const child of Array.from(top.childNodes)) {
            if (!child.childNodes || !child.childNodes.length) continue;
            const copy = child.cloneNode(true);
            if (copy.classList && copy.classList.contains('hoverlayer')) continue;
            copy.querySelectorAll && copy.querySelectorAll('.hoverlayer').forEach(n => n.remove());
            paper.appendChild(copy);
        }
    }
    paper.setAttributeNS(XMLNS_NS, 'xmlns', SVG_NS);
    paper.setAttributeNS(XMLNS_NS, 'xmlns:xlink', XLINK_NS);
    paper.setAttribute('width', String(width));
    paper.setAttribute('height', String(height));
    paper.setAttribute('viewBox', `0 0 ${width} ${height}`);
    return new XMLSerializer().serializeToString(paper);
}

/**
 * The AS SHOWN export of `gd`: a data URL (png, jpeg, webp) at `ratio`
 * times its size on screen, or SVG text.
 */
export async function snapshotImage(gd, { format = 'png', ratio = ratioOf(gd) } = {}) {
    const P = _plotly();
    const svg = snapshotSvg(gd);
    if (format === 'svg') return svg;
    const fl = gd._fullLayout;
    return P.Snapshot.svgToImg({ format, width: fl.width, height: fl.height, scale: ratio,
        canvas: document.createElement('canvas'), svg, promise: true });
}

/** An image (data URL or SVG text) as a Blob. */
export async function toBlob(image, format) {
    if (format === 'svg') return new Blob([image], { type: 'image/svg+xml' });
    return (await fetch(image)).blob();
}

/** Save `blob` as `filename` through a download link. */
export function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Export `gd` and save it: `how` 'full' (opts.width/height/scale) or
 * 'shown'. The coverage gap is in the image either way.
 */
export async function exportImage(gd, how, { format = 'png', width = 1200, height = 800, scale = 1, filename = 'plot' } = {}) {
    const image = await exportWithCoverage(gd, () => how === 'shown'
        ? snapshotImage(gd, { format })
        : fullImage(gd, { format, width, height, scale }));
    saveBlob(await toBlob(image, format), `${filename}.${format === 'jpeg' ? 'jpg' : format}`);
}
