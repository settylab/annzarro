// The shared grouping fixture reads, and its numbers are internally consistent: the browser tests of the
// grouping, Cell-Gene and count panels assert against these.
import test from "node:test";
import assert from "node:assert/strict";
import { expected, columns, categoryCounts } from "./fixtures/grouping.mjs";

test("the fixture is 1,200 cells by 40 genes", () => {
  assert.equal(expected.n_obs, 1200);
  assert.equal(expected.n_var, 40);
  assert.equal(columns.n_obs, 1200);
  assert.equal(columns.var_names.length, 40);
});

test("cell types have the planned sizes, and the sample called other is there", () => {
  assert.deepEqual(Object.values(categoryCounts("cell_type")).sort((a, b) => b - a), [500, 300, 200, 150, 45, 5]);
  const samples = categoryCounts("sample");
  assert.equal(Object.keys(samples).length, 30);
  assert.equal(samples.other, 40);
  assert.equal(columns.obs.many.codes.length, 1200);
});

test("every grouping recipe's groups add up to the cells grouped", () => {
  for (const [name, r] of Object.entries(expected.grouping)) {
    if (r.refused) continue;
    const total = r.groups.reduce((s, g) => s + g.n, 0);
    assert.equal(total, r.n_grouped, name);
    assert.ok(r.n_grouped <= r.n_shown, name);
    for (const g of r.groups) assert.ok(g.n > 0, `${name}: empty group ${g.key}`);
  }
});

test("a recipe over the level limit is refused with its count", () => {
  assert.deepEqual(expected.grouping.many_all_kept_over_limit.refused, { reason: "too_many_levels", count: 2001, limit: 2000 });
});

test("unused stored categories do not count for the level limit", () => {
  // SHR-6, SHR-7: 2,001 stored categories, 1,200 holding a cell
  assert.equal(expected.grouping.many_unused_categories.groups.length, 1200);
});

test("a category called other keeps its own id beside @other", () => {
  const keys = expected.grouping.sample_other_vs_at_other.groups.map((g) => g.key[0]);
  assert.deepEqual(keys, ["c:other", "c:S00", "@other"]);
});

test("every grid's counts fill the product of its axes and add up", () => {
  for (const [name, g] of Object.entries(expected.grid)) {
    const cells = g.axes.reduce((p, a) => p * a.levels.length, 1);
    assert.equal(g.counts.length, cells, name);
    assert.equal(g.counts.reduce((s, c) => s + c, 0), g.n_counted, name);
  }
});

test("gene sets: nine present and three absent genes in with_missing", () => {
  const have = new Set(columns.var_names);
  const set = columns.gene_sets.with_missing;
  assert.equal(set.length, 12);
  assert.equal(set.filter((g) => have.has(g)).length, 9);
  assert.equal(columns.gene_sets.b_markers.length, 12);
  assert.equal(columns.gene_sets.t_markers.length, 12);
  assert.equal(columns.gene_sets.all.length, 40);
  assert.equal(columns.signatures.up_only.down.length, 0);
  assert.ok(columns.signatures.up_and_down.down.length > 0);
});
