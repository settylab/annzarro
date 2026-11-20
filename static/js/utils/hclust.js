// Hierarchical clustering of the rows of a matrix (CXG-21, CXG-24, CXG-25): the nearest-neighbour chain over one
// n x n Float32 distance matrix, O(n^2) time. It reproduces scipy's `linkage` and `leaves_list` (the oracle of
// tests/data/oracle/linkage.npz), including its tie rule, which is original order: the chain starts at the lowest
// active row, keeps the earlier chain member on equal distances, and the merges are put in height order by a stable
// sort. The functions are pure; the worker (hclust-worker.js) and the client below only move the work off the main
// thread and remember answers.
//
// Settings: linkage "complete" (default, as sc.tl.dendrogram), "average" or "ward"; distance "correlation"
// (1 - Pearson r, default) or "euclidean". Ward needs Euclidean distance and is refused with correlation.
//
// Missing values are NaN. A pair of rows is compared on the columns where both have a value. Euclidean distance on
// those columns is scaled by sqrt(cols / shared), so rows with different gaps stay comparable and complete rows
// give the plain Euclidean distance. A row takes no part, and goes last in its block in its original order, when
//   * it has fewer than two values, or under correlation all its values are equal (a constant row), or
//   * it shares fewer than two columns with another row that takes part (judged once, both rows of the pair leave).
// When the values two rows share are all equal their correlation is undefined and the distance is 1 (r = 0).

// export-unused-ok: X5 words the over-2,000-rows sentence from it
export const MAX_ROWS = 2000;
const MEMO_SIZE = 16;
const LINKAGES = ["complete", "average", "ward"];
const DISTANCES = ["correlation", "euclidean"];

function settingsOf(opts) {
  const linkage = opts.linkage ?? "complete";
  const distance = opts.distance ?? "correlation";
  if (!LINKAGES.includes(linkage)) throw new Error(`Unknown linkage "${linkage}": use complete, average or ward.`);
  if (!DISTANCES.includes(distance)) throw new Error(`Unknown distance "${distance}": use correlation or euclidean.`);
  if (linkage === "ward" && distance === "correlation") throw new Error("Ward needs Euclidean distance.");
  return { linkage, distance };
}

function checkShape(values, rows, cols) {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 0 || cols < 0 || values.length !== rows * cols) {
    throw new Error(`The values do not make a ${rows} x ${cols} matrix.`);
  }
  if (rows > MAX_ROWS) throw new Error(`A block is clustered up to ${MAX_ROWS.toLocaleString("en-US")} rows; this one has ${rows}.`);
}

// Rows that can take part (before the pairwise test): at least two values, and not constant under correlation.
function participants(values, rows, cols, distance) {
  const keep = [];
  let anyMissing = false;
  for (let r = 0; r < rows; r++) {
    let n = 0, first = NaN, constant = true;
    for (let j = 0, o = r * cols; j < cols; j++) {
      const v = values[o + j];
      if (v !== v) { anyMissing = true; continue; }
      if (n === 0) first = v; else if (v !== first) constant = false;
      n++;
    }
    if (n >= 2 && !(distance === "correlation" && constant)) keep.push(r);
  }
  return { keep, anyMissing };
}

// Distances of the rows `rowsIn` (k of them) into a k x k Float32 matrix. Returns it with the positions (0..k-1)
// that share fewer than two columns with some other row (only possible when there are missing values).
function distanceMatrix(values, cols, rowsIn, distance, anyMissing) {
  const k = rowsIn.length;
  const D = new Float32Array(k * k);
  const lonely = new Uint8Array(k);
  if (!anyMissing) {
    const S = new Float64Array(k * cols);
    for (let a = 0; a < k; a++) {
      const src = rowsIn[a] * cols, dst = a * cols;
      if (distance === "correlation") {
        let mean = 0;
        for (let j = 0; j < cols; j++) mean += values[src + j];
        mean /= cols;
        let ss = 0;
        for (let j = 0; j < cols; j++) { const d = values[src + j] - mean; S[dst + j] = d; ss += d * d; }
        const inv = 1 / Math.sqrt(ss);
        for (let j = 0; j < cols; j++) S[dst + j] *= inv;
      } else {
        for (let j = 0; j < cols; j++) S[dst + j] = values[src + j];
      }
    }
    for (let a = 0; a < k; a++) {
      const oa = a * cols;
      for (let b = a + 1; b < k; b++) {
        const ob = b * cols;
        let s = 0;
        if (distance === "correlation") {
          for (let j = 0; j < cols; j++) s += S[oa + j] * S[ob + j];
          s = 1 - s;
          if (s < 0) s = 0;
        } else {
          for (let j = 0; j < cols; j++) { const d = S[oa + j] - S[ob + j]; s += d * d; }
          s = Math.sqrt(s);
        }
        D[a * k + b] = s;
        D[b * k + a] = s;
      }
    }
    return { D, lonely };
  }
  // Missing values. Each row is zero-filled (and, under correlation, centred on its own mean first), so the sum of
  // products over the shared columns is one plain dot product. The other sums over the shared columns are the row's
  // totals less its entries in the columns the other row lacks: one short loop over that row's missing columns.
  const X = new Float64Array(k * cols), X2 = new Float64Array(k * cols), M = new Uint8Array(k * cols);
  const T = new Float64Array(k), Q = new Float64Array(k), seen = new Int32Array(k);
  const gapAt = new Int32Array(k + 1);
  const gaps = [];
  for (let a = 0; a < k; a++) {
    const src = rowsIn[a] * cols, dst = a * cols;
    let n = 0, mean = 0;
    for (let j = 0; j < cols; j++) { const v = values[src + j]; if (v === v) { n++; mean += v; } }
    mean = distance === "correlation" ? mean / n : 0;   // a shift changes Euclidean distances, not correlations
    for (let j = 0; j < cols; j++) {
      const v = values[src + j];
      if (v === v) { const c = v - mean; X[dst + j] = c; X2[dst + j] = c * c; M[dst + j] = 1; T[a] += c; Q[a] += c * c; } else gaps.push(j);
    }
    seen[a] = n;
    gapAt[a + 1] = gaps.length;
  }
  for (let a = 0; a < k; a++) {
    const oa = a * cols;
    for (let b = a + 1; b < k; b++) {
      const ob = b * cols;
      let sab = 0;
      for (let j = 0; j < cols; j++) sab += X[oa + j] * X[ob + j];
      let n = seen[a], sa = T[a], saa = Q[a], sb = T[b], sbb = Q[b];
      for (let g = gapAt[b]; g < gapAt[b + 1]; g++) {
        const j = gaps[g];
        if (M[oa + j]) { n--; sa -= X[oa + j]; saa -= X2[oa + j]; }
      }
      for (let g = gapAt[a]; g < gapAt[a + 1]; g++) {
        const j = gaps[g];
        if (M[ob + j]) { sb -= X[ob + j]; sbb -= X2[ob + j]; }
      }
      let s;
      if (n < 2) {
        lonely[a] = 1; lonely[b] = 1; s = 0;
      } else if (distance === "euclidean") {
        s = Math.sqrt(Math.max(0, saa + sbb - 2 * sab) * cols / n);
      } else {
        const va = saa - sa * sa / n, vb = sbb - sb * sb / n;
        s = va > 1e-12 * saa && vb > 1e-12 * sbb ? 1 - (sab - sa * sb / n) / Math.sqrt(va * vb) : 1;
        if (s < 0) s = 0;
      }
      D[a * k + b] = s;
      D[b * k + a] = s;
    }
  }
  return { D, lonely };
}

// The k x k matrix of the positions `stay` of an n x n one.
function compact(D, n, stay) {
  const k = stay.length, out = new Float32Array(k * k);
  for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) out[a * k + b] = D[stay[a] * n + stay[b]];
  return out;
}

// scipy's nn_chain, then its stable sort by height and its labelling. Returns the (k-1) x 4 linkage matrix.
function nnChain(D, k, linkage) {
  const size = new Int32Array(k).fill(1);
  const chain = new Int32Array(k);
  const merged = new Float64Array((k - 1) * 4);
  for (let m = 0; m < k - 1; m++) {
    let len = 0;
    for (let i = 0; i < k; i++) if (size[i] > 0) { chain[0] = i; len = 1; break; }
    let x, y = -1, min;
    for (;;) {
      x = chain[len - 1];
      const row = x * k;
      if (len > 1) { y = chain[len - 2]; min = D[row + y]; } else min = Infinity;
      for (let i = 0; i < k; i++) {
        if (size[i] === 0 || i === x) continue;
        const d = D[row + i];
        if (d < min) { min = d; y = i; }
      }
      if (len > 1 && y === chain[len - 2]) break;
      chain[len++] = y;
    }
    if (x > y) { const t = x; x = y; y = t; }
    const nx = size[x], ny = size[y];
    merged[m * 4] = x; merged[m * 4 + 1] = y; merged[m * 4 + 2] = min; merged[m * 4 + 3] = nx + ny;
    size[x] = 0; size[y] = nx + ny;
    for (let i = 0; i < k; i++) {
      const si = size[i];
      if (si === 0 || i === y) continue;
      const dx = D[i * k + x], dy = D[i * k + y];
      let d;
      if (linkage === "complete") d = dx > dy ? dx : dy;
      else if (linkage === "average") d = (nx * dx + ny * dy) / (nx + ny);
      else {
        const t = 1 / (si + nx + ny);
        d = Math.sqrt((si + nx) * t * dx * dx + (si + ny) * t * dy * dy - si * t * min * min);
      }
      D[i * k + y] = d;
      D[y * k + i] = d;
    }
  }
  return label(merged, k);
}

function label(merged, k) {
  const n = k - 1;
  const by = Array.from({ length: n }, (_, i) => i).sort((a, b) => merged[a * 4 + 2] - merged[b * 4 + 2] || a - b);
  const Z = new Float64Array(n * 4);
  const parent = new Int32Array(2 * k - 1).fill(-1);
  const find = (v) => {
    let r = v;
    while (parent[r] >= 0) r = parent[r];
    while (parent[v] >= 0) { const next = parent[v]; parent[v] = r; v = next; }
    return r;
  };
  const sizeOf = new Int32Array(2 * k - 1).fill(1);
  by.forEach((src, i) => {
    const xr = find(merged[src * 4]), yr = find(merged[src * 4 + 1]);
    Z[i * 4] = Math.min(xr, yr); Z[i * 4 + 1] = Math.max(xr, yr);
    Z[i * 4 + 2] = merged[src * 4 + 2];
    sizeOf[k + i] = sizeOf[xr] + sizeOf[yr];
    Z[i * 4 + 3] = sizeOf[k + i];
    parent[xr] = k + i; parent[yr] = k + i;
  });
  return Z;
}

// scipy's leaves_list: depth first, the lower-numbered cluster of each merge first.
function leafOrder(Z, k) {
  if (k === 1) return Int32Array.of(0);
  const out = new Int32Array(k);
  let w = 0;
  const stack = [2 * k - 2];
  while (stack.length) {
    const id = stack.pop();
    if (id < k) { out[w++] = id; continue; }
    const row = (id - k) * 4;
    stack.push(Z[row + 1], Z[row]);
  }
  return out;
}

/**
 * Cluster the rows of a row-major matrix.
 * @param {ArrayLike<number>} values rows x cols, NaN for a missing value (not modified)
 * @returns {{order: Int32Array, clustered: Int32Array, excluded: Int32Array, merges: Float64Array}}
 *   `order`: every row, the clustered ones in leaf order then the excluded ones in original order.
 *   `clustered`: the input row of each clustered position; the linkage ids of `merges` index into it.
 *   `excluded`: the rows that took no part. `merges`: scipy's (clustered - 1) x 4 linkage matrix, flat
 *   (left, right, height, size).
 */
export function clusterRows(values, rows, cols, opts = {}) {
  const { linkage, distance } = settingsOf(opts);
  checkShape(values, rows, cols);
  const { keep, anyMissing } = participants(values, rows, cols, distance);
  let part = keep, D = null;
  if (keep.length > 1) {
    const built = distanceMatrix(values, cols, keep, distance, anyMissing);
    D = built.D;
    if (built.lonely.some((v) => v === 1)) {
      const stay = [];
      keep.forEach((_, i) => { if (!built.lonely[i]) stay.push(i); });
      part = stay.map((i) => keep[i]);
      D = compact(D, keep.length, stay);
    }
  }
  const k = part.length;
  const taking = new Uint8Array(rows);
  for (const r of part) taking[r] = 1;
  const excluded = Int32Array.from({ length: rows }, (_, r) => r).filter((r) => !taking[r]);
  let merges = new Float64Array(0), leaves = Int32Array.from({ length: k }, (_, i) => i);
  if (k > 1) {
    merges = nnChain(D, k, linkage);
    leaves = leafOrder(merges, k);
  }
  const clustered = Int32Array.from(part);
  const order = new Int32Array(rows);
  leaves.forEach((p, i) => { order[i] = clustered[p]; });
  order.set(excluded, k);
  return { order, clustered, excluded, merges };
}

function hashOf(values) {
  const u = new Uint32Array(values.buffer, values.byteOffset, values.length * 2);
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  for (let i = 0; i < u.length; i++) {
    h1 = Math.imul(h1 ^ u[i], 0x01000193);
    h2 = Math.imul(h2 + u[i], 0x85ebca6b) ^ (h2 >>> 13);
  }
  return `${(h1 >>> 0).toString(36)}.${(h2 >>> 0).toString(36)}`;
}

const spawnWorker = () => new Worker(new URL("./hclust-worker.js", import.meta.url), { type: "module" });

/**
 * A clustering client that runs `clusterRows` in a worker. It remembers the last 16 answers by a hash of the
 * input and its settings, and asks once for identical requests in flight. A failed request is not remembered.
 */
// export-unused-ok: X2b and X3b consume the client; no module imports it yet
export function createHclustClient(makeWorker = spawnWorker) {
  let worker = null, ended = false, nextId = 1;
  const pending = new Map();
  const memo = new Map();

  function open() {
    if (worker) return worker;
    worker = makeWorker();
    worker.onmessage = ({ data }) => {
      const job = pending.get(data.id);
      if (!job) return;
      pending.delete(data.id);
      if (data.error !== undefined) job.reject(new Error(data.error)); else job.resolve(data.result);
    };
    worker.onerror = (e) => failAll(new Error(e?.message || "The clustering worker failed."));
    return worker;
  }

  function failAll(err) {
    for (const job of pending.values()) job.reject(err);
    pending.clear();
  }

  return {
    cluster(values, rows, cols, opts = {}) {
      if (ended) return Promise.reject(new Error("The clustering worker was terminated."));
      const linkage = opts.linkage ?? "complete", distance = opts.distance ?? "correlation";
      const copy = Float64Array.from(values);
      const key = `${rows}x${cols}|${linkage}|${distance}|${hashOf(copy)}`;
      const known = memo.get(key);
      if (known) {
        memo.delete(key);
        memo.set(key, known);
        return known;
      }
      const id = nextId++;
      const answer = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        open().postMessage({ id, values: copy, rows, cols, linkage, distance }, [copy.buffer]);
      });
      memo.set(key, answer);
      answer.catch(() => { if (memo.get(key) === answer) memo.delete(key); });
      while (memo.size > MEMO_SIZE) memo.delete(memo.keys().next().value);
      return answer;
    },
    terminate() {
      ended = true;
      if (worker) worker.terminate();
      failAll(new Error("The clustering worker was terminated."));
      memo.clear();
    },
  };
}
