/**
 * What the Cell-Gene Plot draws around its matrix (0.8.0 step X4b; CXG-6, CXG-12, CXG-13, CXG-14, CXG-17, CXG-24; UX 3.2
 * "in the plot"): section brackets with their titles, the group strips, the totals bar, dendrograms, and the tick
 * labels thinned by the pixels they have. `annotateFigure(figure, model, theme)` takes the figure draw.js built and adds
 * these to it. It is pure, holds no DOM, and reads the model's rows and groups, never its matrix, so its cost grows with
 * the genes and groups drawn, not with the cells.
 *
 * **Input.** The model of draw.js, plus
 * ```
 * pixels?: { width, height }       the figure's size; labels thin by what it gives them (default 900 x 600)
 * annotations?: {
 *   brackets?: { titles?: boolean },   a bracket over each run of rows of one section (rows[].section: {index, title,
 *                                      note?}); `note` is the "3 genes not in this dataset" line of the hover
 *   strips?: [{ title, colours: string[], levels?: string[] }],   one per factor: a color per group, drawn order
 *   totals?: boolean,                  cells per group (groups[].n), a bar along the cell axis
 *   dendrograms?: { genes?: Block[], groups?: Block[] },   Block = { merges, positions }, see dendrogramBlocks()
 *   labels?: { genes?: boolean, groups?: boolean }          false hides that axis's labels (default shown)
 * }
 * groups[].small?: boolean           a small group (SHR-12) gets "small" after its label
 * ```
 *
 * **Where things go.** Each annotation is a pair of axes of its own, `matches`-linked to the matrix axis it follows, so
 * a zoom keeps them aligned. The gene labels stand on the near side of the matrix with the brackets beyond them; the
 * group labels stand on the other axis with the strips between them and the matrix (the labels stand off by the
 * strips' width). Dendrograms and totals are on the far side of each axis, the tree next to the matrix. Swap axes
 * turns all of it: the bands follow the axes. The room for labels is set aside by their length, so the bands can be
 * placed in pixels; a label too long for it is cut with an ellipsis and the hover keeps the whole name.
 *
 * **Thinning.** A tick label takes one line of the font along its axis, rotated or not. Ticks are kept from the first
 * on, each at least a line away from the last one kept, so labels never overlap and every label stays when they fit.
 * The hover names every gene and group however few labels are drawn (CXG-17). This replaces draw.js's stopgap cap.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { PLOT_PALETTES } from '../../utils/plot-theme.js';

/** The strings of the bands. "small" is UX 3.2's own word for a small group's label. */
const WORDS = Object.freeze({
    small: 'small',
    totals: `${VOCABULARY.cellGene.csv.cells} per ${VOCABULARY.word.group}`,
    totalsAxis: VOCABULARY.cellGene.csv.cells,
    ellipsis: '…'
});

const DEFAULT_PIXELS = Object.freeze({ width: 900, height: 600 });
/** Plotly's modebar (camera, zoom, pan) at the figure's top right: about this tall, and this wide in px. */
export const MODEBAR_PX = 36;
const MODEBAR_WIDTH_PX = 180;
const STRIP_PX = 10;
const STRIP_GAP = 2;
const BRACKET_TITLED_PX = 30;
const BRACKET_BARE_PX = 10;
const TREE_PX = 70;
const TOTALS_PX = 80;
const BAND_GAP = 6;
/** A label's width in em, on average; room is set aside by it and a label that would not fit is cut by it. */
const CHAR_EM = 0.58;
const LABEL_PAD = 8;
const LABEL_ROOM_MAX = 0.3;
const LINE_EM = 1.25;
const FIRST_BAND_ID = 90;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const cut = (text, chars) => (text.length <= chars ? text : `${text.slice(0, Math.max(chars - 1, 1))}${WORDS.ellipsis}`);
const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
const verticalSide = (side) => side === 'left' || side === 'right';

/**
 * Which of the ticks to label: the indices, ascending, of ticks at `pixels` (ascending) kept so that each is at least
 * `gap` after the last one kept. The first is always kept; all are kept when they fit.
 * @param {ArrayLike<number>} pixels
 * @param {number} gap
 * @returns {Int32Array}
 */
// export-unused-ok: the tests hold the rule itself
export function thinTicks(pixels, gap) {
    const kept = [];
    let last = -Infinity;
    for (let i = 0; i < pixels.length; i++) {
        if (pixels[i] - last >= gap) {
            kept.push(i);
            last = pixels[i];
        }
    }
    return Int32Array.from(kept);
}

/**
 * The dendrograms of X2b's blocks as this module draws them: a leaf goes where the order drew its row.
 * @param {{state: string, clustered?: Int32Array, merges?: Float64Array}[]} blocks - order().rowBlocks or .groupBlocks
 * @param {Int32Array} order - order().rows or .groups: the matrix index at each drawn position
 * @returns {{merges: Float64Array, positions: Int32Array}[]} `positions[i]` is the drawn index of the block's i-th
 *   clustered row, the leaf `i` of `merges` (scipy's linkage matrix, flat); blocks with no tree are left out
 */
// export-unused-ok: X3a passes the order's blocks through it
export function dendrogramBlocks(blocks, order) {
    const drawnAt = new Int32Array(order.length);
    for (let p = 0; p < order.length; p++) drawnAt[order[p]] = p;
    return blocks.filter((b) => b.state === 'clustered' && b.merges && b.merges.length > 0)
        .map((b) => ({ merges: b.merges, positions: Int32Array.from(b.clustered, (row) => drawnAt[row]) }));
}

/** The axis coordinate of every row (gaps between sections skipped) and the axis's extent. clicks.js reads a click by it. */
export function rowCoordinates(rows) {
    const pos = new Array(rows.length);
    let at = 0;
    rows.forEach((row, r) => {
        at += (row.gapBefore || 0) + (r === 0 ? 0 : 1);
        pos[r] = at;
    });
    return { pos, extent: rows.length === 0 ? 1 : at + 1 };
}

/** The room in px a set of labels needs along their own length, at most `cap`; 0 when they are not shown. */
function labelRoom(labels, fontPx, cap) {
    let longest = 0;
    for (const text of labels) if (text.length > longest) longest = text.length;
    return Math.min(cap, Math.ceil(longest * CHAR_EM * fontPx) + LABEL_PAD);
}

/** Runs of consecutive rows in one section: `[{section, first, last}]` as indices into the rows. */
function sectionRuns(rows) {
    const runs = [];
    rows.forEach((row, r) => {
        const s = row.section;
        if (!s) return;
        const last = runs[runs.length - 1];
        if (last && last.section.index === s.index && last.last === r - 1) last.last = r;
        else runs.push({ section: s, first: r, last: r });
    });
    return runs;
}

/** Heights of a tree as polyline points: x and y alternate with `null` between merges (Plotly's gap in a line). */
function treePoints(blocks, coordOf) {
    const lead = [];
    const height = [];
    let top = 0;
    for (const { merges, positions } of blocks) {
        const k = positions.length;
        const at = new Float64Array(2 * k - 1);
        const at0 = new Float64Array(2 * k - 1);
        for (let i = 0; i < k; i++) at[i] = coordOf[positions[i]];
        for (let m = 0; m < k - 1; m++) {
            const a = merges[m * 4];
            const b = merges[m * 4 + 1];
            const h = merges[m * 4 + 2];
            const id = k + m;
            at[id] = (at[a] + at[b]) / 2;
            at0[id] = h;
            lead.push(at[a], at[a], at[b], at[b], null);
            height.push(at0[a], h, h, at0[b], null);
            if (h > top) top = h;
        }
    }
    return { lead, height, top };
}

/** The pixel size of the figure inside its margins. */
function innerSize(layout, pixels) {
    const m = layout.margin;
    return { w: Math.max(pixels.width - m.l - m.r, 1), h: Math.max(pixels.height - m.t - m.b, 1) };
}

/**
 * The bands' sizes in px around the matrix (labels, brackets, strips, trees, totals) for a model, from its rows and
 * groups and their labels only. annotateFigure places the bands with it; matrixPixels asks it before any trace is made.
 * @param {object} model
 * @param {{w: number, h: number}} inner - the figure inside its margins, px
 * @param {number} fontPx
 * @param {number} reachPx - how far right the matrix reaches, px from the figure's left edge: a band on top that reaches
 *   under the modebar is moved down by its height (the legend column does the same)
 */
function bandPixels(model, inner, fontPx, reachPx) {
    const note = model.annotations || {};
    const swap = Boolean(model.swap);
    const rows = model.rows;
    const groups = model.groups;
    const showLabels = { genes: !(note.labels && note.labels.genes === false), groups: !(note.labels && note.labels.groups === false) };
    const geneLabelSide = swap ? 'left' : 'top';
    const groupLabelSide = swap ? 'bottom' : 'left';
    const runs = note.brackets ? sectionRuns(rows) : [];
    const strips = note.strips || [];
    const geneTrees = (note.dendrograms && note.dendrograms.genes) || [];
    const groupTrees = (note.dendrograms && note.dendrograms.groups) || [];
    const bands = runs.length > 0 || strips.length > 0 || !!note.totals || geneTrees.length > 0 || groupTrees.length > 0;

    const capAlong = (dim) => LABEL_ROOM_MAX * (dim === 'x' ? inner.w : inner.h);
    const geneRoom = bands && showLabels.genes ? labelRoom(rows.map((r) => r.label), fontPx, capAlong(swap ? 'x' : 'y')) : 0;
    const groupRoom = bands && showLabels.groups ? labelRoom(groups.map((g) => (g.small ? `${g.label} ${WORDS.small}` : g.label)), fontPx, capAlong(swap ? 'y' : 'x')) : 0;

    const bracketPx = runs.length ? (note.brackets.titles === false ? BRACKET_BARE_PX : BRACKET_TITLED_PX) : 0;
    const stripPx = strips.length ? strips.length * STRIP_PX + STRIP_GAP : 0;
    const groupTreePx = groupTrees.length ? TREE_PX : 0;
    const geneTreePx = geneTrees.length ? TREE_PX : 0;
    const totalsPx = note.totals ? TOTALS_PX : 0;
    const farGroupPx = groupTreePx + (totalsPx ? (groupTreePx ? BAND_GAP : 0) + totalsPx : 0);

    const px = { left: 0, right: 0, top: 0, bottom: 0 };
    px[geneLabelSide] += geneRoom + bracketPx;
    px[groupLabelSide] += groupRoom + stripPx;
    px[opposite[geneLabelSide]] += geneTreePx;
    px[opposite[groupLabelSide]] += farGroupPx;
    const pixels = model.pixels || DEFAULT_PIXELS;
    if (px.top > 0 && reachPx > pixels.width - MODEBAR_WIDTH_PX) px.top += MODEBAR_PX;
    return { note, swap, showLabels, geneLabelSide, groupLabelSide, runs, strips, geneTrees, groupTrees, bands,
        geneRoom, groupRoom, bracketPx, stripPx, groupTreePx, geneTreePx, totalsPx, px };
}

/**
 * The px the matrix gets along its gene axis, before any trace is made: what draw.js weighs to keep a column of the
 * matrix wide enough at a narrow width (it drops bands first).
 * @param {object} model - with `pixels`
 * @param {{right: number, fontPx: number, margin: {l: number, r: number, t: number, b: number}}} at - the matrix's
 *   right edge in paper units (the legend column starts past it), the font, and the figure's margins
 * @returns {number}
 */
export function matrixPixels(model, { right, fontPx, margin }) {
    const pixels = model.pixels || DEFAULT_PIXELS;
    const inner = innerSize({ margin }, pixels);
    const b = bandPixels(model, inner, fontPx, margin.l + right * inner.w);
    if (!b.bands) return model.swap ? inner.h : right * inner.w;
    return model.swap ? Math.max(inner.h - b.px.top - b.px.bottom, 0) : Math.max(right * inner.w - b.px.left - b.px.right, 0);
}

/**
 * @param {{data: object[], layout: object, config: object}} figure - draw.js's buildFigure(model, theme), changed here
 * @param {object} model - see the top of this file
 * @param {object} [theme] - the palette the figure was built with
 * @returns {{data: object[], layout: object, config: object}} the same figure
 */
// export-unused-ok: draw.js calls it at the end of buildFigure
export function annotateFigure(figure, model, theme) {
    const th = { ...PLOT_PALETTES.light, ...theme };
    const { layout } = figure;
    const fontPx = (layout.font && layout.font.size) || 12;
    const pixels = model.pixels || DEFAULT_PIXELS;
    const rows = model.rows;
    const groups = model.groups;
    const { pos, extent: geneExtent } = rowCoordinates(rows);
    const groupExtent = Math.max(groups.length, 1);

    // pixel room: the labels' lengths set the room, and how many characters fit in it; the bands' sizes in px
    const inner = innerSize(layout, pixels);
    const { note, swap, showLabels, geneLabelSide, groupLabelSide, runs, strips, geneTrees, groupTrees, bands,
        geneRoom, groupRoom, bracketPx, stripPx, groupTreePx, px } = bandPixels(model, inner, fontPx, layout.margin.l + layout.xaxis.domain[1] * inner.w);

    // which axis is which: genes on x, groups on y, unless swapped; labels of genes on the near side
    const geneDim = swap ? 'y' : 'x';
    const groupDim = swap ? 'x' : 'y';
    const geneAxis = layout[`${geneDim}axis`];
    const groupAxis = layout[`${groupDim}axis`];

    const smallWord = ` <i>${WORDS.small}</i>`;
    const charsIn = (room) => Math.max(Math.floor((room - LABEL_PAD) / (CHAR_EM * fontPx)), 3);
    const geneChars = bands ? charsIn(geneRoom) : Infinity;
    const groupChars = bands ? charsIn(groupRoom) : Infinity;
    if (bands && layout.title) layout.margin.t = Math.max(layout.margin.t, 40);

    const wide = innerSize(layout, pixels);
    const right = layout.xaxis.domain[1];
    const plot = {
        x: [px.left / wide.w, right - px.right / wide.w],
        y: [px.bottom / wide.h, 1 - px.top / wide.h]
    };
    if (bands) {
        layout.xaxis.domain = plot.x;
        layout.yaxis.domain = plot.y;
        layout.xaxis.automargin = false;
        layout.yaxis.automargin = false;
        if (swap) layout.xaxis.tickangle = -90;
        if (stripPx) groupAxis.ticklabelstandoff = stripPx;
    }
    const domainOf = (dim) => layout[`${dim}axis`].domain;
    const lengthPx = (dim) => (domainOf(dim)[1] - domainOf(dim)[0]) * (dim === 'x' ? wide.w : wide.h);

    // --- tick labels, thinned by the pixels --------------------------------------------------------------------
    const lineGap = fontPx * LINE_EM;
    const thin = (axis, coords, textOf, extent, dim, shown) => {
        if (!shown) {
            axis.showticklabels = false;
            return;
        }
        const length = lengthPx(dim);
        const at = coords.map((c) => ((c + 0.5) / extent) * length);
        const keep = thinTicks(at, lineGap);
        axis.tickvals = Array.from(keep, (i) => coords[i]);
        axis.ticktext = Array.from(keep, (i) => textOf(i));
    };
    const geneText = (i) => {
        const text = esc(cut(rows[i].label, geneChars));
        return rows[i].own ? `<i>${text}</i>` : text;
    };
    const groupLabel = (i) => {
        const g = groups[i];
        return `${esc(cut(g.label, groupChars - (g.small ? WORDS.small.length + 1 : 0)))}${g.small ? smallWord : ''}`;
    };
    thin(geneAxis, pos, geneText, geneExtent, geneDim, showLabels.genes);
    thin(groupAxis, groups.map((_, g) => g), groupLabel, groupExtent, groupDim, showLabels.groups);
    if (!bands) return figure;

    // --- the bands ---------------------------------------------------------------------------------------------
    let nextId = FIRST_BAND_ID;
    layout.barmode = 'stack';
    layout.bargap = 0;
    layout.annotations = layout.annotations || [];

    /** A pair of axes in `side`'s band, `offset` px from the matrix and `size` px deep, following `alignedDim`. */
    const bandAxes = (side, offset, size, depthRange, depthExtra) => {
        const id = nextId++;
        const alignedDim = verticalSide(side) ? 'y' : 'x';
        const depthDim = verticalSide(side) ? 'x' : 'y';
        const [d0, d1] = domainOf(depthDim);
        const unit = depthDim === 'x' ? wide.w : wide.h;
        const slot = side === 'left' || side === 'bottom'
            ? [d0 - (offset + size) / unit, d0 - offset / unit]
            : [d1 + offset / unit, d1 + (offset + size) / unit];
        const main = layout[`${alignedDim}axis`];
        layout[`${alignedDim}axis${id}`] = {
            matches: alignedDim, domain: [...domainOf(alignedDim)], range: [...main.range], visible: false, anchor: `${depthDim}${id}`
        };
        layout[`${depthDim}axis${id}`] = {
            domain: slot, range: depthRange, visible: false, fixedrange: true, anchor: `${alignedDim}${id}`, ...depthExtra
        };
        return { id, alignedDim, depthDim, ref: (dim) => `${dim}${id}`, place: (trace) => Object.assign(trace, { xaxis: `x${id}`, yaxis: `y${id}` }) };
    };
    /** The range of a band's depth axis with 0 next to the matrix. */
    const depthRange = (side, top) => (side === 'left' || side === 'bottom' ? [top, 0] : [0, top]);

    // brackets, beyond the gene labels (CXG-6)
    if (runs.length) {
        const side = geneLabelSide;
        const b = bandAxes(side, geneRoom, bracketPx, depthRange(side, 1));
        const line = [];
        const along = [];
        const middle = [];
        const hover = [];
        const lengthAlong = lengthPx(geneDim);
        const titles = note.brackets.titles !== false;
        const depth = { base: 0.3, tick: 0.05 };
        for (const { section, first, last } of runs) {
            const a = pos[first] - 0.4;
            const z = pos[last] + 0.4;
            along.push(a, a, z, z, null);
            line.push(depth.tick, depth.base, depth.base, depth.tick, null);
            const mid = (pos[first] + pos[last]) / 2;
            middle.push(mid);
            hover.push(section.note ? `${esc(section.title)}<br>${esc(section.note)}` : esc(section.title));
            if (titles) {
                const chars = Math.floor((((z - a) / geneExtent) * lengthAlong) / (CHAR_EM * fontPx));
                if (chars >= 2) {
                    layout.annotations.push({
                        name: 'section title', text: esc(cut(section.title, chars)), showarrow: false, font: { color: th.textColor },
                        xref: b.ref('x'), yref: b.ref('y'),
                        ...(verticalSide(side)
                            ? { x: depth.base + 0.1, y: mid, textangle: -90, xanchor: 'right', yanchor: 'middle' }
                            : { x: mid, y: depth.base + 0.1, xanchor: 'center', yanchor: 'bottom' })
                    });
                }
            }
        }
        const vertical = verticalSide(side);
        figure.data.push(b.place({
            type: 'scatter', mode: 'lines', name: 'section brackets', hoverinfo: 'skip', showlegend: false,
            x: vertical ? line : along, y: vertical ? along : line, line: { color: th.axisColor, width: 1 }
        }));
        const point = (v) => middle.map(() => v);
        figure.data.push(b.place({
            type: 'scatter', mode: 'markers', name: 'section hover', hoverinfo: 'text', showlegend: false, hovertext: hover,
            x: vertical ? point(depth.base) : middle, y: vertical ? middle : point(depth.base), marker: { size: 12, opacity: 0.01, color: th.axisColor }
        }));
    }

    // strips of the grouping's colors, one per factor, between the group labels and the matrix (CXG-14)
    if (strips.length) {
        const side = groupLabelSide;
        const b = bandAxes(side, STRIP_GAP, stripPx - STRIP_GAP, depthRange(side, strips.length));
        const vertical = verticalSide(side);
        const cells = groups.map((_, g) => g);
        for (const strip of strips) {
            const text = groups.map((g, i) => `${esc(g.label)}<br>${esc(strip.title)}: ${esc(strip.levels ? strip.levels[i] : '')}`.replace(/: $/, ''));
            const ones = groups.map(() => 1);
            figure.data.push(b.place({
                type: 'bar', name: 'group strip', orientation: vertical ? 'h' : 'v', showlegend: false, hoverinfo: 'text', hovertext: text, textposition: 'none',
                x: vertical ? ones : cells, y: vertical ? cells : ones, width: 1, marker: { color: strip.colours, line: { width: 0 } }
            }));
        }
    }

    // trees, next to the matrix on the side the labels are not (CXG-24)
    const tree = (blocks, dim, coords, side, name) => {
        const { lead, height, top } = treePoints(blocks, coords);
        const reach = top > 0 ? top * 1.05 : 1;
        const b = bandAxes(side, 0, TREE_PX, depthRange(side, reach));
        const vertical = verticalSide(side);
        figure.data.push(b.place({
            type: 'scatter', mode: 'lines', name, hoverinfo: 'skip', showlegend: false,
            x: vertical ? height : lead, y: vertical ? lead : height, line: { color: th.axisColor, width: 1 }
        }));
    };
    if (geneTrees.length) tree(geneTrees, geneDim, pos, opposite[geneLabelSide], 'dendrogram genes');
    if (groupTrees.length) tree(groupTrees, groupDim, groups.map((_, g) => g), opposite[groupLabelSide], 'dendrogram groups');

    // totals: cells per group, past the tree (CXG-13)
    if (note.totals) {
        const side = opposite[groupLabelSide];
        let most = 0;
        for (const g of groups) if (g.n > most) most = g.n;
        const vertical = verticalSide(side);
        const cells = groups.map((_, g) => g);
        const counts = groups.map((g) => g.n);
        const b = bandAxes(side, groupTreePx ? groupTreePx + BAND_GAP : 0, TOTALS_PX, depthRange(side, most > 0 ? most * 1.05 : 1), {
            visible: true, showgrid: false, zeroline: false, showticklabels: true, nticks: 3, linecolor: th.axisColor, tickcolor: th.axisColor,
            tickfont: { color: th.textColor, size: fontPx - 2 }, title: { text: WORDS.totalsAxis, font: { color: th.textColor, size: fontPx - 2 }, standoff: 2 },
            side: vertical ? 'top' : 'left'
        });
        figure.data.push(b.place({
            type: 'bar', name: 'cells per group', orientation: vertical ? 'h' : 'v', showlegend: false, hoverinfo: 'text', width: 0.9, textposition: 'none',
            hovertext: groups.map((g) => `${esc(g.label)}<br>${WORDS.totals}: ${g.n.toLocaleString('en-US')}`),
            x: vertical ? counts : cells, y: vertical ? cells : counts, marker: { color: th.axisColor, opacity: 0.55, line: { width: 0 } }
        }));
    }
    return figure;
}
