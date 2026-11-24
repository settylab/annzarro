/**
 * The area-proportional (Euler) layout of a Venn of one to three sets: circles whose areas follow the sets' sizes and
 * whose overlaps follow the sets' intersections (the Count Plot's Venn with Area reflects counts on).
 *
 * Pure, with no import: draw-sets.js reads it, and that module is drawn in a page with no server.
 *
 * Two sets are exact: the distance of the centres is solved numerically (bisection) so the lens of the two circles has the
 * area of their intersection. Three sets are an approximation, found the way venn.js does it (the method, written here,
 * nothing vendored): start from the pairwise distances, then move the third circle and the gap of the first two by
 * Nelder-Mead to minimise the squared error of the drawn intersections against the counted ones, each drawn area exact
 * (the intersection of circles is a polygon with circular arcs). Three sets cannot always be drawn with circles, so the
 * result says how far the drawing is from the counts: `error`, the largest difference, over the regions, between a
 * region's share of the drawn area and its share of the counted cells, as a fraction.
 */

const EPS = 1e-9;
const clamp1 = (v) => Math.max(-1, Math.min(1, v));
const minOf = (a) => a.reduce((m, v) => (v < m ? v : m), Infinity);
const maxOf = (a) => a.reduce((m, v) => (v > m ? v : m), -Infinity);

/** The area of the overlap of two circles of radii `r1`, `r2` whose centres are `d` apart. */
// export-unused-ok: the layout's tests hold the exact areas against a count of points
export function lensArea(r1, r2, d) {
    if (r1 <= 0 || r2 <= 0 || d >= r1 + r2) return 0;
    if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
    const a1 = Math.acos(clamp1((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)));
    const a2 = Math.acos(clamp1((d * d + r2 * r2 - r1 * r1) / (2 * d * r2)));
    return r1 * r1 * (a1 - Math.sin(2 * a1) / 2) + r2 * r2 * (a2 - Math.sin(2 * a2) / 2);
}

/**
 * The distance of two centres at which circles of radii `r1`, `r2` overlap in `area` (the area falls as they part), by
 * bisection to machine precision. An area of at least the smaller circle's is contained (the distance of the radii's
 * difference); an area of 0 or less just touches.
 */
// export-unused-ok: the layout's tests hold the exact areas against a count of points
export function lensDistance(r1, r2, area) {
    let lo = Math.abs(r1 - r2), hi = r1 + r2;
    if (area >= Math.PI * Math.min(r1, r2) ** 2) return lo;
    if (area <= 0) return hi;
    for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        if (lensArea(r1, r2, mid) > area) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
}

/** The points where two circles cross (none, or two; a touch counts as none). */
function crossings(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d < EPS || d >= a.r + b.r || d <= Math.abs(a.r - b.r)) return [];
    const along = (d * d + a.r * a.r - b.r * b.r) / (2 * d);
    const off = Math.sqrt(Math.max(0, a.r * a.r - along * along));
    const mx = a.x + (dx * along) / d, my = a.y + (dy * along) / d;
    return [{ x: mx + (dy * off) / d, y: my - (dx * off) / d }, { x: mx - (dy * off) / d, y: my + (dx * off) / d }];
}

/** The area inside every one of `circles` (`{x, y, r}`), exact: a polygon of the crossings plus an arc segment on each side. */
// export-unused-ok: the layout's tests hold the exact areas against a count of points
export function intersectionArea(circles) {
    if (circles.length === 0 || circles.some((c) => !(c.r > 0))) return 0;
    if (circles.length === 1) return Math.PI * circles[0].r ** 2;
    if (circles.length === 2) return lensArea(circles[0].r, circles[1].r, Math.hypot(circles[1].x - circles[0].x, circles[1].y - circles[0].y));
    const points = [];
    for (let i = 0; i < circles.length; i++) {
        for (let j = i + 1; j < circles.length; j++) {
            for (const p of crossings(circles[i], circles[j])) {
                if (!circles.every((c) => Math.hypot(p.x - c.x, p.y - c.y) <= c.r + 1e-7)) continue;
                const same = points.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-7);
                if (same) { same.on.add(i); same.on.add(j); } else points.push({ x: p.x, y: p.y, on: new Set([i, j]) });
            }
        }
    }
    if (points.length === 0) {
        // no crossing inside all: the smallest circle is inside every other one, or the overlap is empty
        const small = circles.reduce((a, c) => (c.r < a.r ? c : a));
        const inside = circles.every((c) => Math.hypot(small.x - c.x, small.y - c.y) + small.r <= c.r + 1e-9);
        return inside ? Math.PI * small.r ** 2 : 0;
    }
    if (points.length === 1) return 0;
    const cx = points.reduce((a, p) => a + p.x, 0) / points.length, cy = points.reduce((a, p) => a + p.y, 0) / points.length;
    points.sort((p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx));
    if (points.length === 2) {
        // two corners: the lens of the two circles through both
        const both = [...points[0].on].filter((i) => points[1].on.has(i));
        if (both.length < 2) return 0;
        const [a, b] = [circles[both[0]], circles[both[1]]];
        return lensArea(a.r, b.r, Math.hypot(b.x - a.x, b.y - a.y));
    }
    let area = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const p = points[i], q = points[(i + 1) % n];
        area += (p.x * q.y - q.x * p.y) / 2;
        const shared = [...p.on].find((c) => q.on.has(c));
        if (shared === undefined) continue;
        const c = circles[shared];
        const chord = Math.hypot(q.x - p.x, q.y - p.y);
        const theta = 2 * Math.asin(Math.min(1, chord / (2 * c.r)));
        // the arc is the short one when the circle's centre is on the polygon's side of the chord, else the long one
        const side = (q.x - p.x) * (c.y - p.y) - (q.y - p.y) * (c.x - p.x);
        const mid = (q.x - p.x) * (cy - p.y) - (q.y - p.y) * (cx - p.x);
        const angle = side * mid >= 0 ? theta : 2 * Math.PI - theta;
        area += (c.r * c.r * (angle - Math.sin(angle))) / 2;
    }
    return Math.abs(area);
}

/**
 * The area of each exclusive region of the circles (`{x, y, r}`, one per set), by the bit code of its sets: the
 * inclusion-exclusion of the circles' intersections.
 * @returns {number[]} index = code (1 to 2^k - 1); index 0 is 0
 */
function regionAreas(circles) {
    const k = circles.length, all = (1 << k) - 1;
    const inter = new Map();
    const area = (mask) => {
        if (!inter.has(mask)) inter.set(mask, intersectionArea(circles.filter((_, i) => mask & (1 << i))));
        return inter.get(mask);
    };
    const out = new Array(all + 1).fill(0);
    for (let code = 1; code <= all; code++) {
        const rest = all & ~code;
        let sum = 0;
        for (let sub = rest; ; sub = (sub - 1) & rest) {
            let bits = 0;
            for (let b = sub; b; b &= b - 1) bits++;
            sum += (bits % 2 ? -1 : 1) * area(code | sub);
            if (sub === 0) break;
        }
        out[code] = Math.max(0, sum);
    }
    return out;
}

/** Nelder-Mead minimum of `f` from `x0` (a fixed number of rounds at most; deterministic). */
function minimise(f, x0, step, rounds = 600) {
    const n = x0.length;
    let simplex = [x0.slice()];
    for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += step; simplex.push(p); }
    let values = simplex.map(f);
    const order = () => {
        const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
        simplex = idx.map((i) => simplex[i]); values = idx.map((i) => values[i]);
    };
    const mix = (a, b, t) => a.map((v, i) => v + t * (b[i] - v));
    for (let r = 0; r < rounds; r++) {
        order();
        if (values[n] - values[0] < 1e-18) break;
        const centroid = simplex[0].map((_, i) => simplex.slice(0, n).reduce((a, p) => a + p[i], 0) / n);
        const worst = simplex[n];
        const reflected = mix(centroid, worst, -1), fr = f(reflected);
        if (fr < values[0]) {
            const expanded = mix(centroid, worst, -2), fe = f(expanded);
            if (fe < fr) { simplex[n] = expanded; values[n] = fe; } else { simplex[n] = reflected; values[n] = fr; }
        } else if (fr < values[n - 1]) { simplex[n] = reflected; values[n] = fr; } else {
            const contracted = mix(centroid, worst, fr < values[n] ? -0.5 : 0.5), fc = f(contracted);
            if (fc < Math.min(fr, values[n])) { simplex[n] = contracted; values[n] = fc; } else {
                for (let i = 1; i <= n; i++) { simplex[i] = mix(simplex[0], simplex[i], 0.5); values[i] = f(simplex[i]); }
            }
        }
    }
    order();
    return simplex[0];
}

/**
 * The layout of `k` (1 to 3) sets from the count of each exclusive region.
 * @param {number} k
 * @param {(code: number) => number} count - the cells in the region with this bit code (1 to 2^k - 1)
 * @returns {{circles: {x: number, y: number, r: number}[], error: number, exact: boolean} | null} the circles (the largest
 *   of radius 1, the group centred on the origin), the largest error of a region (a fraction of the cells in the sets)
 *   and whether it is exact (one or two sets); null when no set has a cell
 */
export function eulerLayout(k, count) {
    const all = (1 << k) - 1;
    const inter = (mask) => { let n = 0; for (let c = 1; c <= all; c++) if ((c & mask) === mask) n += count(c); return n; };
    const sizes = Array.from({ length: k }, (_, i) => inter(1 << i));
    const biggest = maxOf(sizes);
    if (!(biggest > 0)) return null;
    const radii = sizes.map((s) => Math.sqrt(s / biggest));
    const target = (mask) => (inter(mask) * Math.PI) / biggest;
    let circles;
    if (k === 1) circles = [{ x: 0, y: 0, r: radii[0] }];
    else if (k === 2) circles = [{ x: 0, y: 0, r: radii[0] }, { x: lensDistance(radii[0], radii[1], target(3)), y: 0, r: radii[1] }];
    else {
        const d01 = Math.max(EPS, lensDistance(radii[0], radii[1], target(3)));
        const d02 = lensDistance(radii[0], radii[2], target(5)), d12 = lensDistance(radii[1], radii[2], target(6));
        const x = (d01 * d01 + d02 * d02 - d12 * d12) / (2 * d01);
        const y = Math.sqrt(Math.max(0, d02 * d02 - x * x));
        const build = (p) => [{ x: 0, y: 0, r: radii[0] }, { x: p[0], y: 0, r: radii[1] }, { x: p[1], y: p[2], r: radii[2] }];
        // the squared error of the three pairwise overlaps and of the triple one (venn.js minimises the same, pairs and up)
        const loss = (p) => {
            const cs = build(p);
            let sum = 0;
            for (const [i, j, mask] of [[0, 1, 3], [0, 2, 5], [1, 2, 6]]) {
                sum += (lensArea(radii[i], radii[j], Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y)) - target(mask)) ** 2;
            }
            return sum + (intersectionArea(cs) - target(7)) ** 2;
        };
        circles = build(minimise(loss, [d01, x, -y], 0.1 * maxOf([0.1, ...radii])));
    }
    // centre the group of circles on the origin
    const mx = (minOf(circles.map((c) => c.x - c.r)) + maxOf(circles.map((c) => c.x + c.r))) / 2;
    const my = (minOf(circles.map((c) => c.y - c.r)) + maxOf(circles.map((c) => c.y + c.r))) / 2;
    circles = circles.map((c) => ({ x: c.x - mx, y: c.y - my, r: c.r }));
    const drawn = regionAreas(circles);
    const drawnTotal = drawn.reduce((a, v) => a + v, 0);
    let counted = 0;
    for (let c = 1; c <= all; c++) counted += count(c);
    let error = 0;
    for (let c = 1; c <= all; c++) error = Math.max(error, Math.abs((drawnTotal > 0 ? drawn[c] / drawnTotal : 0) - count(c) / counted));
    return { circles, error, exact: k <= 2 };
}

/**
 * The best place for the label of a region: the point inside exactly the circles of its code with the most room
 * around it, found on a grid over the circles of the code that is refined twice.
 * @returns {{x: number, y: number, room: number}} `room` is the radius of the largest circle around the point that stays in
 *   the region (the distance to the nearest circle edge), 0 or less when the region has no area
 */
export function regionPoint(circles, code) {
    const inKey = circles.filter((_, i) => code & (1 << i));
    let x0 = minOf(inKey.map((c) => c.x - c.r)), x1 = maxOf(inKey.map((c) => c.x + c.r));
    let y0 = minOf(inKey.map((c) => c.y - c.r)), y1 = maxOf(inKey.map((c) => c.y + c.r));
    const room = (x, y) => circles.reduce((a, c, i) => {
        const d = Math.hypot(x - c.x, y - c.y);
        return Math.min(a, code & (1 << i) ? c.r - d : d - c.r);
    }, Infinity);
    let best = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, room: -Infinity };
    const G = 48;
    for (let pass = 0; pass < 3; pass++) {
        const sx = (x1 - x0) / G, sy = (y1 - y0) / G;
        for (let i = 0; i <= G; i++) {
            for (let j = 0; j <= G; j++) {
                const x = x0 + i * sx, y = y0 + j * sy, v = room(x, y);
                if (v > best.room) best = { x, y, room: v };
            }
        }
        x0 = best.x - 2 * sx; x1 = best.x + 2 * sx; y0 = best.y - 2 * sy; y1 = best.y + 2 * sy;
    }
    return best;
}
