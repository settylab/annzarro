// X2b: the order of the Cell-Gene Plot's rows and groups, and the scopes of its clustering (static/js/utils/cell-gene-order.js;
// CXG-7, CXG-13, CXG-22, CXG-23, CXG-25). The clustering itself is X1's and is held against scipy in hclust.test.mjs;
// here it runs synchronously through clusterRows behind a Promise, and every test checks which blocks are sent,
// what each block contains, and that the answer comes back in the right place.
import test from "node:test";
import assert from "node:assert/strict";

import { clusterRows, MAX_ROWS } from "../../../static/js/utils/hclust.js";
import { createCellGeneOrder } from "../../../static/js/utils/cell-gene-order.js";

const SETTINGS = { linkage: "complete", distance: "correlation" };

function recorder() {
  const calls = [];
  const cluster = (values, rows, cols, opts) => {
    calls.push({ values: Float64Array.from(values), rows, cols, opts: { ...opts } });
    return Promise.resolve(clusterRows(values, rows, cols, opts));
  };
  return { calls, cluster };
}

// A small seeded generator, so a sweep is the same on every run.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function matrix(rows, groups, rand, gaps = 0) {
  const v = new Float64Array(rows * groups);
  for (let i = 0; i < v.length; i++) v[i] = rand() < gaps ? NaN : Math.round(rand() * 1e6) / 1e3;
  return v;
}

const geneSection = (...genes) => ({ kind: "genes", genes });
const setSection = () => ({ kind: "set" });
const rowsOf = (s) => (s.kind === "set" ? 1 : s.genes.length);
const flatGroups = (n) => Array.from({ length: n }, (_, i) => ({ key: [`c:g${i}`], n: 10 + i }));

function input(over) {
  return {
    sections: [geneSection("A", "B", "C")],
    groups: flatGroups(4),
    partitionings: 1,
    cluster: { genes: "off", groups: "off", ...SETTINGS },
    sortBySize: false,
    ...over,
  };
}

// The group-major copy of `groups` over the matrix rows `features`.
function transpose(values, G, groups, features) {
  const out = new Float64Array(groups.length * features.length);
  groups.forEach((g, b) => features.forEach((r, f) => { out[b * features.length + f] = values[r * G + g]; }));
  return out;
}

const ident = (n, from = 0) => Array.from({ length: n }, (_, i) => from + i);

test("with clustering off, rows keep the source order and groups the grouping's order", async () => {
  const rand = rng(1);
  const { calls, cluster } = recorder();
  const sections = [geneSection("A", "B", "C"), setSection(), geneSection("D", "E")];
  const values = matrix(6, 5, rand);
  const o = await createCellGeneOrder({ cluster }).order(input({ values, sections, groups: flatGroups(5) }));
  assert.deepEqual(Array.from(o.rows), ident(6));
  assert.deepEqual(Array.from(o.groups), ident(5));
  assert.equal(o.groupsScope, "off");
  assert.equal(calls.length, 0);
  assert.deepEqual(o.rowBlocks.map((b) => [b.start, b.count, b.state]), [[0, 3, "off"], [3, 1, "off"], [4, 2, "off"]]);
  assert.equal(o.rowsLeftOut, 0);
  assert.equal(o.groupsLeftOut, 0);
});

test("genes within sections: sections never mix or move, aggregated rows are not clustered (seeded sweep)", async () => {
  const rand = rng(7);
  for (let trial = 0; trial < 200; trial++) {
    const sections = [];
    const n = 1 + Math.floor(rand() * 5);
    let gene = 0;
    for (let s = 0; s < n; s++) {
      if (rand() < 0.3) sections.push(setSection());
      else sections.push(geneSection(...Array.from({ length: Math.floor(rand() * 9) }, () => `G${gene++}`)));
    }
    const R = sections.reduce((a, s) => a + rowsOf(s), 0);
    const G = 2 + Math.floor(rand() * 6);
    const values = matrix(R, G, rand, trial % 3 === 0 ? 0.15 : 0);
    const before = Float64Array.from(values);
    const { calls, cluster } = recorder();
    const o = await createCellGeneOrder({ cluster }).order(input({
      values, sections, groups: flatGroups(G), cluster: { genes: "sections", groups: "off", ...SETTINGS },
    }));
    assert.deepEqual(values, before, "the input is not modified");
    let start = 0, sent = 0, leftOut = 0;
    sections.forEach((s, i) => {
      const count = rowsOf(s);
      const block = o.rowBlocks[i];
      assert.equal(block.start, start, `trial ${trial}: section ${i} starts where it did`);
      assert.equal(block.count, count);
      const drawn = Array.from(o.rows.slice(start, start + count));
      assert.deepEqual([...drawn].sort((a, b) => a - b), ident(count, start), `trial ${trial}: section ${i} keeps its own rows`);
      if (s.kind === "set") {
        assert.equal(block.state, "off");
        assert.deepEqual(drawn, [start], "an aggregated row stays where it is");
      } else if (count >= 2) {
        assert.equal(block.state, "clustered");
        const want = clusterRows(values.subarray(start * G, (start + count) * G), count, G, SETTINGS);
        assert.deepEqual(drawn, Array.from(want.order, (r) => start + r), `trial ${trial}: section ${i} in X1's order`);
        assert.deepEqual(Array.from(block.excluded), Array.from(want.excluded, (r) => start + r));
        assert.deepEqual(Array.from(block.clustered), Array.from(want.clustered, (r) => start + r));
        assert.deepEqual(Array.from(block.merges), Array.from(want.merges));
        leftOut += want.excluded.length;
        sent++;
      }
      start += count;
    });
    assert.equal(calls.length, sent, `trial ${trial}: one request per gene section of two or more rows`);
    assert.ok(calls.every((c) => c.cols === G), "genes are clustered across the groups");
    assert.equal(o.rowsLeftOut, leftOut);
    assert.deepEqual(Array.from(o.groups), ident(G), "clustering genes leaves the groups alone");
  }
});

test("one section is the whole gene axis", async () => {
  const rand = rng(3);
  const values = matrix(7, 4, rand);
  const { cluster } = recorder();
  const o = await createCellGeneOrder({ cluster }).order(input({
    values, sections: [geneSection("A", "B", "C", "D", "E", "F", "G")], cluster: { genes: "sections", groups: "off", ...SETTINGS },
  }));
  assert.deepEqual(Array.from(o.rows), Array.from(clusterRows(values, 7, 4, SETTINGS).order));
});

test("rows left out of a block go last in it and are counted", async () => {
  // Row 1 has one value only, row 3 is constant under correlation.
  const values = Float64Array.from([
    1, 2, 3, 4,
    NaN, NaN, 5, NaN,
    4, 3, 2, 1,
    7, 7, 7, 7,
    1, 3, 2, 4,
  ]);
  const { cluster } = recorder();
  const o = await createCellGeneOrder({ cluster }).order(input({
    values, sections: [geneSection("A", "B", "C", "D", "E")], cluster: { genes: "sections", groups: "off", ...SETTINGS },
  }));
  assert.deepEqual(Array.from(o.rows.slice(3)), [1, 3]);
  assert.deepEqual(Array.from(o.rowBlocks[0].excluded), [1, 3]);
  assert.equal(o.rowsLeftOut, 2);
});

test("all groups: one block over the gene rows, as displayed", async () => {
  const rand = rng(11);
  const sections = [geneSection("A", "B", "C", "D")];
  const values = matrix(4, 6, rand);
  const { calls, cluster } = recorder();
  const o = await createCellGeneOrder({ cluster }).order(input({
    values, sections, groups: flatGroups(6), cluster: { genes: "off", groups: "all", ...SETTINGS },
  }));
  const want = clusterRows(transpose(values, 6, ident(6), ident(4)), 6, 4, SETTINGS);
  assert.equal(o.groupsScope, "all");
  assert.deepEqual(Array.from(o.groups), Array.from(want.order));
  assert.deepEqual(Array.from(o.rows), ident(4), "clustering groups leaves the rows alone");
  assert.equal(calls.length, 1);
  assert.deepEqual(o.groupBlocks.map((b) => [b.start, b.count, b.state]), [[0, 6, "clustered"]]);
  assert.deepEqual(Array.from(o.groupBlocks[0].merges), Array.from(want.merges));
});

test("a gene drawn in two sections counts once, and aggregated rows do not count, when groups are clustered", async () => {
  const rand = rng(13);
  // Rows: A B C | set | B D | set. The features are A, B, C, D: rows 0, 1, 2, 5.
  const sections = [geneSection("A", "B", "C"), setSection(), geneSection("B", "D"), setSection()];
  const values = matrix(7, 5, rand);
  const { calls, cluster } = recorder();
  const o = await createCellGeneOrder({ cluster }).order(input({
    values, sections, groups: flatGroups(5), cluster: { genes: "off", groups: "all", ...SETTINGS },
  }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cols, 4, "four distinct genes");
  assert.deepEqual(calls[0].values, transpose(values, 5, ident(5), [0, 1, 2, 5]));
  const want = clusterRows(transpose(values, 5, ident(5), [0, 1, 2, 5]), 5, 4, SETTINGS);
  assert.deepEqual(Array.from(o.groups), Array.from(want.order));
});

test("with no gene rows, groups are clustered on the aggregated rows", async () => {
  const rand = rng(17);
  const sections = [setSection(), geneSection(), setSection(), setSection()];
  const values = matrix(3, 5, rand);
  const { calls, cluster } = recorder();
  const o = await createCellGeneOrder({ cluster }).order(input({
    values, sections, groups: flatGroups(5), cluster: { genes: "off", groups: "all", ...SETTINGS },
  }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cols, 3);
  assert.deepEqual(calls[0].values, transpose(values, 5, ident(5), [0, 1, 2]));
  assert.deepEqual(Array.from(o.groups), Array.from(clusterRows(calls[0].values, 5, 3, SETTINGS).order));
});

// Two partitionings: cell type (3 levels, runs of 3, 1 and 4 groups) by age.
const twoFactor = () => [
  ...["y", "m", "o"].map((a, i) => ({ key: ["c:T", `c:${a}`], n: 30 - i })),
  { key: ["c:B", "c:y"], n: 50 },
  ...["y", "m", "o", "x"].map((a, i) => ({ key: ["c:NK", `c:${a}`], n: 5 + i })),
];

test("within the first partitioning: its blocks stay intact and in order", async () => {
  const rand = rng(19);
  const groups = twoFactor();
  const values = matrix(5, groups.length, rand);
  const { calls, cluster } = recorder();
  const o = await createCellGeneOrder({ cluster }).order(input({
    values, sections: [geneSection("A", "B", "C", "D", "E")], groups, partitionings: 2,
    cluster: { genes: "off", groups: "first", ...SETTINGS },
  }));
  assert.equal(o.groupsScope, "first");
  assert.deepEqual(o.groupBlocks.map((b) => [b.start, b.count]), [[0, 3], [3, 1], [4, 4]]);
  assert.equal(calls.length, 2, "a block of one group is not sent");
  for (const block of [o.groupBlocks[0], o.groupBlocks[2]]) {
    const members = ident(block.count, block.start);
    const want = clusterRows(transpose(values, groups.length, members, ident(5)), block.count, 5, SETTINGS);
    assert.deepEqual(Array.from(o.groups.slice(block.start, block.start + block.count)), Array.from(want.order, (g) => block.start + g));
  }
  assert.equal(o.groups[3], 3);
});

test("'first' with one partitioning acts as off", async () => {
  const rand = rng(23);
  const values = matrix(3, 6, rand);
  const { calls, cluster } = recorder();
  const o = await createCellGeneOrder({ cluster }).order(input({
    values, groups: flatGroups(6), partitionings: 1, cluster: { genes: "off", groups: "first", ...SETTINGS },
  }));
  assert.equal(o.groupsScope, "off");
  assert.equal(calls.length, 0);
  assert.deepEqual(Array.from(o.groups), ident(6));
});

const withSmall = (n) => [...flatGroups(n), { key: ["@small"], n: 1000 }];

test("the collected small group is never clustered and never moves, under every scope and under size sort", async () => {
  const rand = rng(29);
  for (const [groupsScope, partitionings, sortBySize] of [["all", 1, false], ["first", 2, false], ["off", 1, true]]) {
    const groups = partitionings === 2
      ? [...twoFactor(), { key: ["@small"], n: 1000 }]
      : withSmall(6);
    const values = matrix(4, groups.length, rand);
    const { calls, cluster } = recorder();
    const o = await createCellGeneOrder({ cluster }).order(input({
      values, sections: [geneSection("A", "B", "C", "D")], groups, partitionings, sortBySize,
      cluster: { genes: "off", groups: groupsScope, ...SETTINGS },
    }));
    const last = groups.length - 1;
    assert.equal(o.groups[last], last, `${groupsScope}: the collected group is last`);
    if (groupsScope !== "off") assert.ok(calls.length > 0, `${groupsScope}: the other groups are clustered`);
    assert.ok(calls.reduce((a, c) => a + c.rows, 0) < groups.length, "it is in no block sent");
    const lastBlock = o.groupBlocks[o.groupBlocks.length - 1];
    assert.deepEqual([lastBlock.start, lastBlock.count, lastBlock.state], [last, 1, "off"]);
    for (const c of calls) {
      const smallColumn = transpose(values, groups.length, [last], ident(4));
      for (let r = 0; r < c.rows; r++) {
        assert.notDeepEqual(c.values.slice(r * 4, r * 4 + 4), smallColumn, "its values are not sent");
      }
    }
  }
});

test("sort by size: descending by cells, ties in the grouping's order, only while groups are not clustered", async () => {
  const groups = [5, 9, 5, 12, 1].map((n, i) => ({ key: [`c:g${i}`], n }));
  const rand = rng(31);
  const values = matrix(4, 5, rand);
  const { cluster } = recorder();
  const order = createCellGeneOrder({ cluster });
  const sorted = await order.order(input({ values, sections: [geneSection("A", "B", "C", "D")], groups, sortBySize: true }));
  assert.deepEqual(Array.from(sorted.groups), [3, 1, 0, 2, 4]);
  const clustered = await order.order(input({
    values, sections: [geneSection("A", "B", "C", "D")], groups, sortBySize: true, cluster: { genes: "off", groups: "all", ...SETTINGS },
  }));
  assert.deepEqual(Array.from(clustered.groups), Array.from(clusterRows(transpose(values, 5, ident(5), ident(4)), 5, 4, SETTINGS).order),
    "clustering wins over size sort");
});

test("a block over the clustering limit is not sent and keeps its order", async () => {
  const G = MAX_ROWS + 1;
  const groups = flatGroups(G);
  const values = new Float64Array(2 * G).map((_, i) => (i * 7919) % 101);
  const { calls, cluster } = recorder();
  const o = await createCellGeneOrder({ cluster }).order(input({
    values, sections: [geneSection("A", "B")], groups, cluster: { genes: "sections", groups: "all", ...SETTINGS },
  }));
  assert.deepEqual(o.groupBlocks.map((b) => [b.start, b.count, b.state]), [[0, G, "too_many"]]);
  assert.deepEqual(Array.from(o.groups), ident(G));
  assert.equal(calls.length, 1, "only the gene section is clustered");
  assert.equal(calls[0].rows, 2);
});

test("deterministic: the same input gives the same order", async () => {
  const rand = rng(37);
  const groups = twoFactor();
  const sections = [geneSection("A", "B", "C"), setSection(), geneSection("D", "E", "F", "A")];
  const values = matrix(8, groups.length, rand, 0.1);
  const make = () => input({
    values: Float64Array.from(values), sections, groups, partitionings: 2,
    cluster: { genes: "sections", groups: "first", linkage: "average", distance: "euclidean" },
  });
  const a = await createCellGeneOrder(recorder()).order(make());
  const b = await createCellGeneOrder(recorder()).order(make());
  assert.deepEqual(a, b);
});

test("asking again for the shown matrix costs no clustering and no new answer", async () => {
  const rand = rng(41);
  const values = matrix(6, 8, rand);
  const sections = [geneSection("A", "B", "C", "D", "E", "F")];
  const groups = flatGroups(8);
  const cluster = { genes: "sections", groups: "all", ...SETTINGS };
  const rec = recorder();
  const order = createCellGeneOrder({ cluster: rec.cluster });
  const first = order.order(input({ values, sections, groups, cluster }));
  await first;
  const sent = rec.calls.length;
  for (let i = 0; i < 100; i++) {
    assert.equal(order.order(input({ values, sections, groups, cluster: { ...cluster } })), first, "the same promise");
  }
  assert.equal(rec.calls.length, sent, "no clustering per paint");
  await order.order(input({ values, sections, groups, cluster: { ...cluster, linkage: "average" } }));
  assert.equal(rec.calls.length, sent * 2, "a changed setting clusters again");
});

test("a failed clustering is not remembered", async () => {
  let fail = true;
  const cluster = (v, r, c, o) => (fail ? Promise.reject(new Error("worker gone")) : Promise.resolve(clusterRows(v, r, c, o)));
  const order = createCellGeneOrder({ cluster });
  const values = matrix(3, 4, rng(43));
  const ask = () => order.order(input({ values, cluster: { genes: "sections", groups: "off", ...SETTINGS } }));
  await assert.rejects(ask(), /worker gone/);
  fail = false;
  const o = await ask();
  assert.equal(o.rowBlocks[0].state, "clustered");
});

test("a matrix of the wrong shape is refused", () => {
  const order = createCellGeneOrder(recorder());
  assert.throws(() => order.order(input({ values: new Float64Array(5) })), /3 x 4/);
});
