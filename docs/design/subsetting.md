# Cell subsets for million-cell datasets

```{note}
Measurements here were taken during design on pre-release builds and are not current; current
numbers: {doc}`../reference/performance`. Each one says which build it was taken on.
```

Issues #7 (consistent subsetting), #14 (scalability to millions of cells, parts
1 to 6), #17 (atlas-scale rendering). Code: `annzarro/core/subset.py`,
`annzarro/server/routes/data_routes.py` (`_reader_for`, `/data/subset`),
`static/js/utils/subset.js`, `static/js/data-manager.js`,
`static/js/subset-dialog.js`.

## The invariant

Every panel shows the same cells. If the UMAP holds a subset of the cells, the
obs column colouring it, the gene vector, the kNN row, the cell table and the
cell name list are for exactly those cells, in the same order. A colouring that
belongs to other cells is wrong without looking wrong, so the subset is decided
in one place (the server) from one description (the spec), and every
cell-axis request names it.

## How a subset is defined

A spec, sent as compact JSON:

```text
{ "n": 100000,              // cells to show; null = every cell passing `where`
  "seed": 0,                // 0 .. 2^32-1
  "balance": "batch",       // optional: sample as evenly as the group sizes allow
  "where": [                // optional: AND of conditions on obs columns
    {"col": "cluster",  "op": "in",      "values": ["3", "5"]},
    {"col": "n_counts", "op": ">=",      "value": 500},
    {"col": "age",      "op": "between", "value": [2, 18]},
    {"col": "drug",     "op": "contains", "value": "mab"},
    {"any": [ {"col": "batch", "op": "empty"},          // a group: OR (or "all": AND)
              {"col": "n_counts", "op": "<", "value": 100} ]} ],
  "part": 0 }               // optional: which part of the partition (below); 0 when absent
```

Ops: `in`, `not_in` (matched on the value's text: `3` and `3.0` are `"3"`,
booleans are `"true"`/`"false"`), and `>`, `>=`, `<`, `<=`, `==`, `!=`,
`between` (inclusive) on numbers. A missing value passes no condition, including
`!=` and `not_in`.

Text conditions are the cell table's SearchBuilder string conditions: `contains`,
`not_contains`, `starts_with`, `not_starts_with`, `ends_with`, `not_ends_with` (one `value`,
compared case-insensitively: SearchBuilder lower-cases both sides) and `empty`, `not_empty`. They
see a missing value as empty text, as the table does, so a missing value passes `empty` and
every `not_*`. Groups `{"any": [...]}` / `{"all": [...]}` nest at most two deep.

Evaluation stays one pass over the cells at any size. A categorical column answers each text
condition once per category (a lookup table over the codes), so its cost is the codes' read and
one lookup per cell; a plain string column is tested a block of one million cells at a time,
with each distinct text tested once. Groups combine the conditions' masks in place; only the
column last named is held.

**Which cells.** Every row gets a rank key `splitmix64(splitmix64(seed) ^ row)`;
the subset is the `n` eligible rows with the smallest keys, in dataset order.
This is a fixed function, not a draw from numpy's generator, whose streams are
not guaranteed across versions: the same spec names the same cells on every
machine and release (pinned by `test_selection_is_frozen`; the rule is
re-derived from Python integers in a test, so a notebook can reproduce it).
The keys are a bijection of the row, so there are no ties, and:

- more cells with the same seed keep every cell of fewer (50,000 to 100,000
  adds cells, it does not swap the ones on screen);
- a filtered subset is the same rule applied to the passing cells.

**Balanced.** Groups of the `balance` column (a missing label is its own group)
get quotas by water-filling: a group smaller than its equal share is taken
whole and its unused share goes to the others; the rest get equal shares, the
remainder one each in group order. Within a group the cells with the smallest
keys are taken. 50,000 / 5,000 / 500 cells at n = 3,000 gives 1,250 / 1,250 /
500.

**Parts.** A subset is one part of a partition of the eligible cells into
k = ceil(eligible / n) disjoint parts that together hold every eligible cell
once; `part` (0-based, default 0) picks one. Stepping through the parts shows
every cell.

- Uniform: part j is the eligible cells of key rank [j*n, (j+1)*n). The last
  part holds the remainder.
- Balanced: part j is the balanced selection of n cells from the cells not in
  parts 0..j-1. Each group's quota per part follows from repeating the
  water-filling on the remaining group sizes (arithmetic on the sizes only),
  and group g's part-j cells are its key ranks [before, before + quota), where
  before is its quota summed over parts 0..j-1. Every part is as balanced as
  the remaining cells allow: once a small group is used up, later parts hold
  only the larger groups.
- Part 0 is the subset as it was defined before parts existed, and a spec of
  part 0 is written without `part`, so its key, its cache entries and every
  link that names it are unchanged.

Finding a part does not sort every eligible row. Rank keys are spread evenly
over the 64-bit range, so rank r of a group of size S sits near key r / S of
the range. One pass over the rows, a million at a time, counts each group's
rows below a key a little under the wanted ranks and collects the rows inside a
window a little above them; a group whose count and collection do not bracket
its ranks gets a wider window and is collected again. Only the collected rows
(about 1.1 x the part) are sorted, so a part costs about what part 0 does
(pre-release build before v0.3.0, 2026-10-02: synthetic 2M cells, 20 parts of 100,000, in-process: uniform 0.023 / 0.034 /
0.029 s for parts 0 / 10 / 19; balanced across 380 drugs 0.065 / 0.140 /
0.113 s). On the real 50-million-cell Tahoe store (500 parts of 100,000;
fresh server process per part, pages cached; laptop, under the benchmark lock),
`/data/subset` took 0.28 / 0.31 / 0.57 / 0.42 s for parts 0 / 1 / 250 / 499
uniform, and 0.78 / 0.81 / 1.08 / 0.82 s balanced across `cell_line_id`; the
part's 100,000 names then took 0.55 s. The quotas of the last of 957 balanced
parts over 5,000 groups take 0.12 s.

**Default.** A dataset with more than `ui.defaults.subset_threshold` cells
(200,000) opens on `{"n": subset_size, "seed": subset_seed}` (100,000, 0). At
or below the threshold nothing changes: no subset parameter is sent, and every
request is the request it was before.

## Where it lives

| place | what |
|---|---|
| request | `subset=<spec JSON>` on every cell-axis read: `/cells`, `/obs`, `/obsm/*`, `/obsp/*`, `/X`, `/layer/*`, `/names`, `/dataset_structure` |
| server | resolved index arrays in an LRU (16 specs) keyed by (dataset path, store stat signature, canonical spec). No per-client state. |
| browser | `DataManager` holds the `/data/subset` reply for the open dataset; `_fetchWithCache` adds its `key` to cell-axis requests for that dataset |
| share links, panel sets, autosave | `view.subset`: the spec, `null` (every cell of a dataset that would otherwise be subset) or absent (the default). See docs/deep-link-schema.md |
| config | `ui.defaults.subset_threshold`, `subset_size`, `subset_seed` |

**Spec in the request, not an index list or a server-side id.** An index list
(100,000 integers) on every request is ~600 kB of query string, and gunicorn
refuses request lines over 4,094 bytes. A server-side subset id needs state
that survives restarts and is shared between gunicorn workers, or every client
has to handle "unknown id" and re-register. The spec is short (tens of bytes,
capped at 2,000 characters), self-describing, and any worker resolves it to the
same indices. Its cost: the first request for a new spec computes the indices
(about 30 ms at 1.16M synthetic cells for a uniform subset, on a pre-release build before
v0.2.0; a filter reads its obs columns once).

## How the server serves a subset

`_reader_for(dataset_path)` wraps the reader in `SubsetView` when the request
names a subset. The view presents `adata[indices]`:

- **positions are subset positions.** `rows=5` is the subset's sixth cell; the
  view translates it to the dataset row. The client never sees a dataset row,
  so its existing index logic (focused cell, table rows, masks) is unchanged.
- **whole-axis reads come back cut to the subset**, in dataset order.
- **metadata reports the subset's shape**, so the existing request checks
  (`index_out_of_range`) and #44's 413 size guard apply to the subset unchanged.
- **gene-axis reads pass through** (`/var`, `/varm`, `/varp`, `/genes`, `/uns`).

Reads keep the reader's fast paths: "all cells, one gene" is read exactly as
before (contiguous CSC column, chunked dense column) and sliced in numpy;
asking zarr for 100,000 scattered rows of a cells-by-genes matrix would read
far more than the column. A focused cell's row is read by index and cut to the
subset's columns (obsp). obs columns are read by index (decoding a categorical
for 100,000 cells is cheaper than for all of them).

**Cache keys.** The reader's result cache is unchanged: a subset response is
the cached full-axis result, sliced (well under a millisecond at 100,000 cells).
The browser's response cache and #44's ETags key on the URL, which includes the
spec. A new seed is a new URL; nothing needs invalidating.

**Routes that cannot apply a subset** (`/data/paginated`, `/data/statistics`,
`/data/by_path`) answer 400 `subset_unsupported` if given one, rather than an
answer for every cell. A malformed spec is 400 `bad_subset`, an unknown column
404 `key_not_found`; never "every cell".

## Masks and table filters

The subset decides which cells are **loaded**; the existing masks decide which
loaded cells are **drawn**. Because every array the client holds is already the
subset's, the NaN, outlier and table-filter masks compose with it unchanged.

A cell table holds the subset's cells, so its SearchBuilder filter filters
within the subset (and a plot filtered by that table shows the intersection).
To filter the whole dataset instead, the dialog copies a table's filter into
the subset's `where`, which the server evaluates on every cell. Only what means
the same on both sides is copied: a top-level AND of `=`/`≠` on text and
`=`, `≠`, `<`, `≤`, `>`, `≥`, `between` on numbers, over obs columns. OR,
nested groups, contains/starts/ends, `!between`, empty/not-empty and non-obs
columns are listed as not copied, never dropped silently. One difference
remains: SearchBuilder lets a cell with no value pass `≠`; the subset does not.

## What the UI shows

- Stats bar, for example: `Cells: 100,000 of 1,160,000 [Subset · seed 0]`; with every cell,
  `Cells: 8,090 [All cells]`. The badge's tooltip spells out the spec
  (seed, balance, filter, cells passing the filter).
- The badge opens the dialog: on/off; size presets below the eligible count,
  1k, 5k, 10k, 50k and then 1-2-5 from 100k (the three largest rungs on a dataset too small
  for three from 1k), each with its parts ⌈eligible / n⌉ and an estimated load
  time, and "All" (every cell passing the filter); a marker before the presets
  above `ui.defaults.large_plot_points`; a "may exceed browser memory" warning
  above `BROWSER_POINT_CEILING` (150M; set from a pre-release build before v0.3.0; the paper's
  v0.4.0 numbers are in {doc}`../reference/configuration`), a size the dialog never picks by default; the cell count for any other size;
  seed and a "New seed" button, uniform or balanced sampling, filter
  conditions, "use a cell table's filter". It previews what the server would
  select (`/data/subset`) before anything changes, including per-group counts,
  "no cell passes the filter" (Apply disabled), and a warning when the cells to
  draw exceed the threshold.
- The load estimate (`static/js/utils/subset-presets.js`) is
  server(n_total) + fixed + perPoint · n, with one (fixed, perPoint) pair for
  the regular plot and one for large-plot mode. The defaults come from the clean
  runs of the paper's laptop benchmark on a pre-release build before v0.3.0 (20 ns per dataset
  cell to select, 0.53 s + 5.5 µs per point regular, 62 ns per point large). Each Cell Plot draw and
  recolour the page times rescales its path: a sample's log(measured / modelled)
  goes to the per-point cost by the per-point share of the modelled time and to
  the fixed cost by the rest, so small plots tune the fixed cost and large ones
  the slope. The preview request times the selection alone, so it can raise the
  modelled server cost but not lower it (reading a subset's rows from a large
  store costs more than selecting them).
  An estimate is flagged as extrapolated (grey) when n is past the largest
  clean benchmark run on its path (1M regular, 95.6M large), or, once this
  session's draws have measured the slope, more than 4x the largest of them.
- Other modules open the dialog without importing it: a document
  `CustomEvent('annzarro:open-subset', {detail: {preset: 'largest-regular'}})`
  opens it on the largest preset a regular Cell Plot draws (at most
  `ui.defaults.large_plot_points`), or on "All" when every passing cell fits.
- Apply reopens the current view (panels, layout, focus) on the new cells
  through the panel-set load path, so every panel is rebuilt on them.
- With more than one part, `‹ Part 3 of 957 ›` follows the badge: buttons for
  the previous and next part and a box to type a part number (counted from 1 in
  the UI, from 0 in the spec). A step reopens the view on the other part, like
  Apply. The badge's tooltip names the part and, for a balanced partition, the
  groups earlier parts already showed in full.
- Each plot's filter widget has a line `Not in cell subset: 1,060,000` (`Not in
  this part (3 of 957)` with parts), and its total is a share of every cell of
  the dataset.
- A focused cell outside the subset is not focused silently; a notice says why.
  A link whose subset the dataset cannot apply (a column it lacks) opens on the
  default, with a notice.

## State that names cells

| state | behaviour |
|---|---|
| `_cells` | the subset's names; every index into it is a subset position |
| focused cell | kept if in the subset, else the first cell, with a notice |
| table SearchBuilder criteria | conditions on columns, kept across subset changes; they now match other rows |
| `tableEntities` | rebuilt from the table, so within the subset |
| cell history | names; a name outside the subset focuses nothing (as for a dataset switch) |
| panel sets, links | record the subset, so their focused cell and tables mean the same cells again |

## Measured

Pre-release build before v0.2.0 (2026-10-02), JSON transfer. Synthetic store: 1,160,000 cells x
1,000 genes (CSC X, obs with 20 clusters and
4 batches, X_umap, 15-NN obsp), Apple M3 Max, headless Chromium, local server.
View: two UMAP panels, one coloured by cluster, one by a gene of X. "Every cell"
is this branch with `view.subset = null`, which sends the requests the base
sends plus one small `/data/subset`. Recolour is the median of four focused-gene
changes. Bytes count every request at open, including the duplicate requests
the base makes (PR #44 coalesces them).

| | every cell | subset 50,000 | subset 100,000 (default) | subset 200,000 |
|---|---|---|---|---|
| open the view (to network idle) | 17.1 s | 2.0 s | 2.2 s | 4.1 s |
| bytes transferred at open | 69.8 MB | 21.7 MB | 37.6 MB | 69.5 MB |
| JS heap after open | 874 MB | 49 MB | 94 MB | 180 MB |
| recolour by another gene | 21.6 s | 0.7 s | 1.3 s | 4.8 s |

Server side, per request (in process, warm): gene column 280 ms / 7.7 MB for
every cell, 27 ms / 0.66 MB for the subset; UMAP 740 ms / 46 MB vs 92 ms /
4 MB; kNN row 84 ms / 4.6 MB vs 8 ms / 0.4 MB. Resolving the default subset:
26 ms once, then 0.4 ms.

With PR #44 merged (binary transfer, still before v0.2.0), bytes at open drop to 8.6 MB for the
default subset; the recolour time is not lower (1.8 s; 26 s with every cell), because it is
spent in Plotly redrawing coloured points (profiled: Plotly's colour handling,
not AnnZarro code). Recolour time grows faster than linearly with the points
drawn, which is what the default size trades against.

## Not done

- **Density rendering** (#17's "datashader-style" mode). A subset already
  removes the frontend stress; a binned grid of every cell
  (`np.histogram2d` over an obsm pair, ~50 ms at 1.16M synthetic cells, pre-release build) drawn as a
  heatmap under the subset's points would show where the unloaded cells are.
  Not implemented here.
- **A pasted list of cell names** (#7, optional). It does not fit in a request
  line; it needs server-side registration (POST, a content hash as the key,
  re-registration after a restart). Workaround: mark the cells in an obs column
  and filter on it.
- **The gene axis.** `SubsetView` takes an entity and passes genes through; a
  gene subset would be the same mechanism on var.
- **Names download.** The browser still downloads the subset's names (1.5 MB at
  100,000 cells, pre-release build before v0.2.0) because `getCellIndex`, the tables and the plots index into
  that list; with the typeahead pickers (#46) nothing else needs every name.
