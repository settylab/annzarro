// The grouping fixture for the browser's JS tests: the same numbers the server tests assert.
//
// `expected` is tests/data/grouping_expected.json (groups, grid counts and moments of named recipes, written by
// tests/core/grouping_store.py, which fails when the file is stale). `columns` is grouping_columns.json beside
// this file: the obs columns of the 1,200 x 40 store (categoricals as codes), the gene sets and the shown subset.
// Regenerate both with `python -m annzarro.tests.core.grouping_store`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

export const expected = read(path.join(here, "..", "..", "data", "grouping_expected.json"));
export const columns = read(path.join(here, "grouping_columns.json"));

/** The labels of a categorical column, one per cell. */
export function categoryLabels(name) {
  const col = columns.obs[name];
  if (!col.categories) throw new Error(`column ${name} has no stored category list`);
  return col.codes.map((c) => (c < 0 ? null : col.categories[c]));
}

/** `{label: count}` of a categorical column, in the column's category order. */
export function categoryCounts(name) {
  const col = columns.obs[name];
  const out = Object.fromEntries(col.categories.map((c) => [c, 0]));
  for (const c of col.codes) if (c >= 0) out[col.categories[c]] += 1;
  return out;
}
