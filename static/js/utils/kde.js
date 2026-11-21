/**
 * Smoothing of binned counts into a density (V3, CNT-10).
 *
 * The engine bins the cells onto a fixed grid (512 bins, or 256 by 256) and reports `n` and `sigma` of its pre-pass; the
 * browser smooths those counts with a Gaussian kernel whose bandwidth is Scott's rule per axis, `h = adjust * sigma *
 * n^(-1/(d+4))`, raised to at least 1.5 grid steps (a finer bandwidth would be lost between the bins). The bandwidth is
 * DIAGONAL: each axis has its own and the kernel is their product, so the density ignores the correlation between the
 * axes (it is not `scipy.stats.gaussian_kde`, which uses the full covariance).
 *
 * The density is evaluated at the cell centres as `1/m * sum_i c_i * prod_d phi((x_d - x_id) / h_d) / h_d`, with `c_i`
 * the counts and `m` their sum, so a density integrates to 1 where the kernel does not meet the range's edge. Mass beyond
 * the edge is lost, not reflected, as for the cells the engine excluded.
 *
 * Cost grows with the grid and the bandwidth, never with the number of cells: a kernel of a few taps is summed
 * directly (skipping empty cells), a wide one is applied by a transform whose cost does not depend on its width, so
 * the widest kernel on 512 x 512 costs what the narrowest does. Nothing here keeps state between calls.
 */

/** The bandwidth never goes below this many grid steps (CNT-10). */
// export-unused-ok: the floor test reads the constant the sentence is about
export const FLOOR_STEPS = 1.5;

/** The kernel is cut where it is below 4e-6 of its peak. */
const CUT_SIGMAS = 5;
/** A kernel of at most this many taps each side is summed directly; a wider one goes by transform. */
const DIRECT_TAPS = 24;

/**
 * The bandwidth of one axis, as the panel states it.
 * @param {{sigma: number, n: number, dims: number, adjust?: number, step: number}} p - the pre-pass's `sigma` and `n`, the
 *   number of density axes, the user's factor (default 1) and the grid's step on this axis
 * @returns {{scott: number, raw: number, h: number, floored: boolean}} Scott's rule, with the adjust, with the floor
 */
export function bandwidthOf({ sigma, n, dims, adjust = 1, step }) {
    const scott = n > 1 ? sigma * n ** (-1 / (dims + 4)) : 0;
    const raw = scott * adjust;
    const floor = FLOOR_STEPS * step;
    return { scott, raw, h: Math.max(raw, floor), floored: raw < floor };
}

// --- the kernel and its transform ------------------------------------------------------------------------------------

/** The kernel of one axis: `w[k] = phi(k * step / h) / h` for k = 0..radius, cut at 5 bandwidths and at the grid. */
function kernelOf(len, step, h) {
    const radius = Math.min(len - 1, Math.ceil((CUT_SIGMAS * h) / step));
    const w = new Float64Array(radius + 1);
    const norm = 1 / (h * Math.sqrt(2 * Math.PI));
    for (let k = 0; k <= radius; k++) {
        const u = (k * step) / h;
        w[k] = norm * Math.exp(-0.5 * u * u);
    }
    return { radius, w };
}

/** A transform's twiddle factors, by size (a handful of sizes ever occur). */
const TWIDDLES = new Map();
function twiddles(n) {
    let t = TWIDDLES.get(n);
    if (!t) {
        const cos = new Float64Array(n / 2);
        const sin = new Float64Array(n / 2);
        for (let k = 0; k < n / 2; k++) {
            cos[k] = Math.cos((2 * Math.PI * k) / n);
            sin[k] = Math.sin((2 * Math.PI * k) / n);
        }
        TWIDDLES.set(n, t = { cos, sin });
    }
    return t;
}

/** In-place radix-2 transform of `re` + i `im` (length a power of two); `inverse` leaves the sum unscaled. */
function transform(re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            let t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
        }
    }
    const { cos, sin } = twiddles(n);
    const sign = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1;
        const stride = n / size;
        for (let start = 0; start < n; start += size) {
            for (let k = 0, w = 0; k < half; k++, w += stride) {
                const wr = cos[w];
                const wi = sign * sin[w];
                const a = start + k;
                const b = a + half;
                const xr = re[b] * wr - im[b] * wi;
                const xi = re[b] * wi + im[b] * wr;
                re[b] = re[a] - xr; im[b] = im[a] - xi;
                re[a] += xr; im[a] += xi;
            }
        }
    }
}

/** The transform of a symmetric kernel laid out circularly: real, so it scales a packed pair of lines as it scales each. */
function kernelSpectrum(kernel, size) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let k = 0; k <= kernel.radius; k++) {
        re[k] = kernel.w[k];
        if (k) re[size - k] = kernel.w[k];
    }
    transform(re, im, false);
    return re;
}

/**
 * Smooths every line of `src` along one axis into `dst` (zero outside the grid). A line is `len` values `elem` apart,
 * and the lines start `line` apart.
 */
function smoothAxis(src, dst, lines, len, line, elem, kernel, method) {
    if (method === 'direct' || (method !== 'fft' && kernel.radius <= DIRECT_TAPS)) {
        const { radius, w } = kernel;
        for (let l = 0; l < lines; l++) {
            const base = l * line;
            for (let i = 0; i < len; i++) {
                const c = src[base + i * elem];
                if (c === 0) continue;
                const from = Math.max(0, i - radius);
                const to = Math.min(len - 1, i + radius);
                for (let j = from; j <= to; j++) dst[base + j * elem] += c * w[j > i ? j - i : i - j];
            }
        }
        return;
    }
    // Two real lines are packed into one complex transform: the kernel's spectrum is real, so it scales both.
    let size = 1;
    while (size < len + kernel.radius) size <<= 1;
    const spectrum = kernelSpectrum(kernel, size);
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let l = 0; l < lines; l += 2) {
        const a = l * line;
        const b = l + 1 < lines ? (l + 1) * line : -1;
        re.fill(0);
        im.fill(0);
        for (let i = 0; i < len; i++) {
            re[i] = src[a + i * elem];
            if (b >= 0) im[i] = src[b + i * elem];
        }
        transform(re, im, false);
        for (let k = 0; k < size; k++) { re[k] *= spectrum[k]; im[k] *= spectrum[k]; }
        transform(re, im, true);
        const scale = 1 / size;
        for (let i = 0; i < len; i++) {
            dst[a + i * elem] = Math.max(0, re[i] * scale);
            if (b >= 0) dst[b + i * elem] = Math.max(0, im[i] * scale);
        }
    }
}

const total = (counts) => { let m = 0; for (let i = 0; i < counts.length; i++) m += counts[i]; return m; };

/** Divides by the cells counted, so the density of the cells; no cells leave zeros. */
function normalise(out, m) {
    if (m > 0) for (let i = 0; i < out.length; i++) out[i] /= m;
    return out;
}

/**
 * The density of binned counts on a line, at the bins' centres.
 * @param {ArrayLike<number>} counts - the cells in each bin
 * @param {number} step - the bin width
 * @param {number} h - the bandwidth, floored (`bandwidthOf(...).h`)
 * @param {{method?: 'direct'|'fft'}} [options] - to force a path; by default the kernel's width chooses
 * @returns {Float64Array} the probability density (it integrates to 1 over the range, less what the edges lose)
 */
export function smooth1(counts, step, h, options = {}) {
    const len = counts.length;
    const src = Float64Array.from(counts);
    const out = new Float64Array(len);
    smoothAxis(src, out, 1, len, 0, 1, kernelOf(len, step, h), options.method);
    return normalise(out, total(src));
}

/**
 * The density of binned counts on a plane, at the cells' centres: the product of one kernel per axis, applied to the
 * rows and then the columns.
 * @param {ArrayLike<number>} counts - `nx * ny` counts, x slowest (`counts[ix * ny + iy]`)
 * @param {{nx: number, ny: number, stepX: number, stepY: number, hx: number, hy: number, method?: string}} grid
 * @returns {Float64Array} the density, in the same order
 */
export function smooth2(counts, { nx, ny, stepX, stepY, hx, hy, method }) {
    const src = Float64Array.from(counts);
    const mid = new Float64Array(nx * ny);
    const out = new Float64Array(nx * ny);
    smoothAxis(src, mid, nx, ny, ny, 1, kernelOf(ny, stepY, hy), method); // along y: nx lines of ny values
    smoothAxis(mid, out, ny, nx, 1, ny, kernelOf(nx, stepX, hx), method); // along x: ny lines of nx values
    return normalise(out, total(src));
}
