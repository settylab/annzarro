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
 *
 * Every exported PNG and SVG carries its recipe (embedRecipe): the view it
 * was made from, as a panel set (layout, every panel's settings, focus, the
 * store's path and fingerprint), the panel, and the AnnZarro version. The
 * figure can then be made again from itself (`annzarro export --from
 * fig.png`), exactly so with the same store and version.
 */
import { exportWithCoverage } from './panel-surface.js';
import { releasePlot } from './release-plot.js';
import { syncSceneCamera } from './scene-camera.js';

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
        // a 3D plot: the camera on screen, which Plotly may not have recorded
        // in gd.layout yet (scene-camera.js)
        syncSceneCamera(gd);
        const data = (gd.data || []).map(copyObjects);
        const layout = { ...copyLayout(gd.layout), width, height };
        const config = { ...(gd._context || {}), _exportedPlot: true, staticPlot: true, setBackground: false };
        await P.newPlot(clone, data, layout, config);
        await S.getRedrawFunc(clone)();
        await new Promise(resolve => setTimeout(resolve, S.getDelay(clone._fullLayout)));
        w = clone._fullLayout.width;
        h = clone._fullLayout.height;
        svg = stableSvgIds(S.toSVG(clone, format, scale), uidTokens(clone));
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
    return stableSvgIds(new XMLSerializer().serializeToString(paper), uidTokens(gd));
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

// ── The recipe in the figure ──────────────────────────────────────────────

/** The PNG text chunk keyword and the SVG metadata element id. */
export const RECIPE_KEY = 'annzarro-recipe';
const RECIPE_NS = 'https://annzarro.readthedocs.io/recipe';

let _recipeProvider = null;

/**
 * main.js registers what a figure's recipe holds (the view, the panel,
 * the version); see exportImageData.
 * @param {(gd: HTMLElement, info: Object) => Object|null} fn
 */
export function setRecipeProvider(fn) {
    _recipeProvider = typeof fn === 'function' ? fn : null;
}

/** A copy with every object's keys in sorted order (arrays kept in order). */
function _sorted(value) {
    if (Array.isArray(value)) return value.map(_sorted);
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) out[key] = _sorted(value[key]);
        return out;
    }
    return value;
}

/**
 * JSON with sorted keys (the same view gives the same text, however its
 * objects were built) and every non-ASCII character escaped: valid JSON,
 * Latin-1 safe for a PNG tEXt chunk.
 */
export function asciiJson(value) {
    return JSON.stringify(_sorted(value)).replace(/[\u007f-\uffff]/g,
        c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

let _crcTable = null;
function _crc32(bytes) {
    if (!_crcTable) {
        _crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            _crcTable[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = _crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A PNG with a tEXt chunk added after IHDR (any chunk of that keyword
 * already there is replaced).
 * @param {Uint8Array} png
 * @param {string} keyword
 * @param {string} text - Latin-1 (use asciiJson)
 * @returns {Uint8Array}
 */
export function pngWithText(png, keyword, text) {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    if (png.length < 33 || sig.some((b, i) => png[i] !== b)) throw new Error('Not a PNG');
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const chunks = [];
    let at = 8;
    while (at + 12 <= png.length) {
        const len = view.getUint32(at);
        const type = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7]);
        chunks.push({ start: at, end: at + 12 + len, type, data: png.subarray(at + 8, at + 8 + len) });
        at += 12 + len;
        if (type === 'IEND') break;
    }
    const isOurs = c => c.type === 'tEXt' && String.fromCharCode(...c.data.subarray(0, keyword.length + 1)) === keyword + '\0';
    const body = new Uint8Array(keyword.length + 1 + text.length);
    for (let i = 0; i < keyword.length; i++) body[i] = keyword.charCodeAt(i) & 0xff;
    for (let i = 0; i < text.length; i++) body[keyword.length + 1 + i] = text.charCodeAt(i) & 0xff;
    const chunk = new Uint8Array(12 + body.length);
    const cv = new DataView(chunk.buffer);
    cv.setUint32(0, body.length);
    chunk.set([116, 69, 88, 116], 4);   // 'tEXt'
    chunk.set(body, 8);
    cv.setUint32(8 + body.length, _crc32(chunk.subarray(4, 8 + body.length)));
    const parts = [png.subarray(0, 8)];
    chunks.forEach((c, i) => {
        if (isOurs(c)) return;
        parts.push(png.subarray(c.start, c.end));
        if (i === 0) parts.push(chunk);   // after IHDR
    });
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
}

/** The text of a PNG's tEXt chunk `keyword`, or null. */
export function pngText(png, keyword) {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    let at = 8;
    while (at + 12 <= png.length) {
        const len = view.getUint32(at);
        const type = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7]);
        if (type === 'tEXt') {
            const data = png.subarray(at + 8, at + 8 + len);
            const zero = data.indexOf(0);
            if (zero > 0 && String.fromCharCode(...data.subarray(0, zero)) === keyword) {
                let text = '';
                for (let i = zero + 1; i < data.length; i++) text += String.fromCharCode(data[i]);
                return text;
            }
        }
        if (type === 'IEND') break;
        at += 12 + len;
    }
    return null;
}

const _xmlEscape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * An SVG with the recipe as its first child, in a <metadata> element.
 * @param {string} svg
 * @param {string} json
 * @returns {string}
 */
export function svgWithRecipe(svg, json) {
    const cleaned = svg.replace(/<metadata id="annzarro-recipe">[\s\S]*?<\/metadata>/, '');
    const open = cleaned.match(/<svg\b[^>]*>/);
    if (!open) throw new Error('Not an SVG');
    const at = open.index + open[0].length;
    const meta = `<metadata id="${RECIPE_KEY}"><annzarro:recipe xmlns:annzarro="${RECIPE_NS}">` +
        `${_xmlEscape(json)}</annzarro:recipe></metadata>`;
    return cleaned.slice(0, at) + meta + cleaned.slice(at);
}

/** The recipe JSON text of an SVG, or null. */
export function svgRecipe(svg) {
    const m = String(svg).match(/<metadata id="annzarro-recipe"><annzarro:recipe[^>]*>([\s\S]*?)<\/annzarro:recipe><\/metadata>/);
    if (!m) return null;
    return m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function _dataUrlBytes(url) {
    const b64 = url.slice(url.indexOf(',') + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function _bytesDataUrl(bytes, mime) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return `data:${mime};base64,${btoa(bin)}`;
}

/**
 * An exported image with its recipe in it: SVG metadata, or a PNG tEXt
 * chunk. Other formats (jpeg, webp) are returned as they are.
 * @param {string} image - SVG text or a data URL
 * @param {string} format
 * @param {Object|null} recipe
 * @returns {string}
 */
export function embedRecipe(image, format, recipe) {
    if (!recipe) return image;
    const json = asciiJson(recipe);
    if (format === 'svg') return svgWithRecipe(image, json);
    if (format === 'png') return _bytesDataUrl(pngWithText(_dataUrlBytes(image), RECIPE_KEY, json), 'image/png');
    return image;
}

/**
 * Plotly names an SVG's clip paths, gradients and defs after a random id per
 * plot (fullLayout._uid) and per trace (uid), so two exports of the same
 * view differed in those names alone. Each token is renamed, in order, to
 * a fixed name wherever it is used as a name (id="...", class="..." such as
 * a colour bar's "cb<uid>", url(#...), href="#..."), never inside image data. The SVG text is then a function of
 * the view.
 * @param {string} svg
 * @param {string[]} tokens - the random ids, e.g. uidTokens(gd)
 * @returns {string}
 */
export function stableSvgIds(svg, tokens) {
    const names = [...new Set((tokens || []).filter(t => typeof t === 'string' && t.length >= 4))];
    if (!names.length) return svg;
    const rename = (value) => names.reduce((v, token, i) => v.split(token).join(`az${i}`), value);
    return svg.replace(/(\bid="|\bclass="|url\(['"]?#|url\(&quot;#|href="#)([^")'&]+)/g, (m, pre, name) => pre + rename(name));
}

/** The random ids Plotly gave a drawn plot: the layout's and each trace's. */
export function uidTokens(gd) {
    const out = [];
    if (gd && gd._fullLayout && gd._fullLayout._uid) out.push(String(gd._fullLayout._uid));
    for (const trace of (gd && gd._fullData) || []) if (trace && trace.uid) out.push(String(trace.uid));
    return out;
}

/**
 * Export `gd` as the Export button does, with its recipe: `how` 'full'
 * (opts.width/height/scale) or 'shown'. The coverage gap is in the image.
 * @returns {Promise<string>} SVG text or a data URL
 */
export async function exportImageData(gd, how, { format = 'png', width = 1200, height = 800, scale = 1 } = {}) {
    let image = await exportWithCoverage(gd, () => how === 'shown'
        ? snapshotImage(gd, { format })
        : fullImage(gd, { format, width, height, scale }));
    let recipe = null;
    try {
        recipe = _recipeProvider ? _recipeProvider(gd, { how, format, width, height, scale }) : null;
    } catch (error) {
        console.warn('No recipe for this figure:', error);
    }
    return embedRecipe(image, format, recipe);
}

/**
 * Export `gd` and save it: `how` 'full' (opts.width/height/scale) or
 * 'shown'. The coverage gap and the recipe are in the image either way.
 */
export async function exportImage(gd, how, { format = 'png', width = 1200, height = 800, scale = 1, filename = 'plot' } = {}) {
    const image = await exportImageData(gd, how, { format, width, height, scale });
    saveBlob(await toBlob(image, format), `${filename}.${format === 'jpeg' ? 'jpg' : format}`);
}
