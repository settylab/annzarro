# Performance

One click moves one vector, never a matrix, so the cost of an interaction grows with the
number of cells or genes and not with the size of the stored array. This page collects the
measured numbers, each with the conditions it was measured under. Read the conditions: a
"cold" request on a laptop NVMe and a cold request on a busy network filesystem differ by
orders of magnitude.

The paper's {doc}`Fig. 7 <../paper/fig7-performance>` summarises the benchmarks; its numbers are
reproduced below where they matter for setting up a store or a server.

```{important}
**HPC numbers are provisional.** They come from a benchmark run on Fred Hutch gizmok nodes
(`/hpc/temp`, NFS) that is awaiting a rerun on a quieter filesystem. Laptop numbers and the
demonstration-store numbers are final for the code they were measured on.
```

## On the demonstration store

Measured for these docs on this branch: `bm_aging.zarr` (8,090 cells × 16,285 genes), server
on the same machine (Apple M3 Max, 128 GB, local NVMe), `requests` over localhost, page cache
warm, a new random index for every request so that neither the server's result cache nor HTTP
revalidation answers it; median of 10. Script: `docs/_tools/bench_api.py`; data:
`docs/_tools/data/api_bm_aging.csv`.

| Request (what a click asks for) | JSON | Binary (`format=f32`) |
|---|---|---|
| gene column, dense layer (fold change) | 16.5 ms, 117 kB | 12.3 ms, 32 kB |
| gene column, X (CSC) | 13.7 ms, 108 kB | 11.7 ms, 32 kB |
| gene column, CSR layer (`logged_counts`) | 73.3 ms, 40 kB | 72.3 ms, 4.7 kB sparse |
| cell row, dense layer (fold change) | 20.6 ms, 204 kB | 17.7 ms, 65 kB |
| cell row, X (CSC) | 218.9 ms, 191 kB | 214.8 ms, 65 kB |
| obsp row, dense `diffusion_walk_t5` | 14.4 ms, 48 kB | 13.0 ms, 28 kB sparse |
| obsp row, kNN `connectivities` (CSR) | 9.2 ms, 16 kB | 8.9 ms, 144 B sparse |
| varp row, dense `spearman_fold_change` | 23.0 ms, 187 kB | 17.0 ms, 65 kB |
| obsm column `X_umap` (repeat, result cache) | 2.7 ms, 97 kB | 1.0 ms, 32 kB |
| obs column, DA z-score (repeat, result cache) | 3.0 ms, 157 kB | 1.0 ms, 65 kB float64 |

At this size the zarr read dominates and binary transfer saves a few milliseconds. Two rows
stand out, and both are storage layout, not transfer: a gene column of a CSR layer and a cell
row of a CSC matrix each have to decompress every chunk of the matrix (73 ms and 215 ms). Every
other interaction is under 25 ms. See {doc}`../data/preparing-a-store` for the CSR/CSC choice.

### Sparse reads on the other axis

A selection along the axis a sparse matrix is not compressed by (a cell row of CSC X, a gene
column of a CSR layer) used to load the whole matrix into memory. It is now a bounded scan of
the stored indices, 4M entries at a time, reading only the data between hits; a block of rows
and columns slices the compressed axis first. Latency stays about the same, because every chunk
is still decompressed; peak memory and small blocks change (settylab/annzarro#55, one click per
fresh process, median of 3, growth of peak RSS):

| Store | Click | Before | After |
|---|---|---|---|
| `bm_aging.zarr` (8,090 × 16,285) | X cell row (CSC) | 295 ms, 1,081 MB | 282 ms, 133 MB |
| | X, 3 rows × 2 columns | 298 ms, 1,075 MB | 20 ms, 4 MB |
| | `raw_counts` gene column (CSR) | 97 ms, 225 MB | 101 ms, 105 MB |
| 1M × 2,000 synthetic, 100M stored values | X cell row (CSC) | 303 ms, 870 MB | 233 ms, 98 MB |
| | CSR layer gene column | 233 ms, 866 MB | 270 ms, 116 MB |

On this branch, seven cell rows of X from `bm_aging.zarr` took 224-238 ms each after the first
(380 ms), and the server's resident memory grew from 103 MB to 244 MB over them.

### h5ad files

Measured on the 5.6 GB h5ad of the demonstration data (CSR X), app caches cleared before each
cold request (settylab/annzarro#51):

| Click | Cold | Warm (repeat) |
|---|---|---|
| gene column from X | 167 ms | 3.1 ms |
| cell row from X | 5.2 ms | 4.5 ms |
| gene column, sparse layer | 35 ms | 1.4 ms |
| gene column, dense layer | 20 ms | 1.5 ms |
| obs column | 2.3 ms | 0.9 ms |

Peak memory per click fell from 1,005 MB (whole sparse matrix) to 1.2 MB for an X cell row and
48 MB for an X gene column. A CSR gene column from a cold disk still reads about 1 GB; see
{doc}`../data/preparing-a-store` for the layout advice.

## At one million cells: binary against JSON

At 1M cells transfer dominates, and the binary encoding (AnnZarro PR #44, on this branch) is
where the time goes away.

```{figure} ../_static/figures/binary-transfer.svg
:alt: Dumbbell chart, log time axis. Gene column JSON 576 ms 21.5 MB, binary 100 ms 4.0 MB. obsm column JSON 323 ms 19.0 MB, binary 6 ms 4.0 MB. kNN row JSON 82 ms 4.0 MB, binary 13 ms 152 B. Cell row JSON 26 ms 98 kB, binary 24 ms 20 kB.
:width: 85%

**Warm request time and payload, JSON (grey) against binary (blue).** Laptop (Apple M3 Max,
NVMe), synthetic 1M cells × 5,000 genes, client side including parsing. Source: the
measurement for PR #44 as recorded in the paper repository (`figures/fast_transfer_pr44.csv`;
copied to `docs/_tools/data/`). Script: `docs/_tools/make_transfer_figure.py`.
```

| Interaction at 1M cells | JSON cold / warm | Binary cold / warm | Browser repeat (`304`) |
|---|---|---|---|
| gene column | 614 / 576 ms, 21.5 MB | 126 / 100 ms, 4.0 MB | 6 ms |
| cell row | 32 / 26 ms, 98 kB | 29 / 24 ms, 20 kB | 0.6 ms |
| obsm column | 327 / 323 ms, 19.0 MB | 12 / 6 ms, 4.0 MB | |
| kNN row | 82 / 82 ms, 4.0 MB | 14 / 13 ms, 152 B | |

Before the binary encoding, 81 % of a 1M-cell gene-column request was turning the array into
a Python list and encoding it as JSON (194 ms `tolist` + 314 ms JSON of 629 ms; the zarr read
was 94 ms).

## A real 50-million-cell store (Tahoe-100M)

Measured on 50,000,000 real cells of Tahoe-100M (`tahoe_50M_plot.zarr`: CSC `X` holding a panel
of 200 genes, five categorical obs columns, `obsm/X_pca_2d`, zarr format 2), opened on the
default 100,000-cell subset. Before is AnnZarro v0.2.0, after is the scale fixes (PR #63). Apple
M3 Max (128 GB), local NVMe. **Cold**: a fresh APFS clone of the store and a fresh server
process. **Warm**: a fresh server process on the same clone, its pages already cached. Every run
held a machine-wide lock, so no other benchmark ran at the same time. Peak server memory is the
largest resident set sampled every 10 ms during the request.

| Request (default subset unless stated) | Before, cold / warm | After, cold / warm | Peak memory before → after |
|---|---|---|---|
| resolve the subset (`/data/subset`) | 0.48 / 0.48 s | 0.36 / 0.35 s | 1.7 GB → 0.2 GB |
| cell names of the subset (`/data/cells`, 2.2 MB) | 12.7 / 12.9 s | 0.60 / 0.57 s | 7.0 GB → 0.24 GB |
| categorical column, subset (`cell_line_id`) | 0.23 s, 1.2 MB | 0.10 s, 0.10 MB | |
| categorical column, all 50M cells | 13.7 s, 600 MB | 0.09 s, 50 MB | |
| balanced subset (`balance: cell_line_id`) | 114 / 118 s | 0.73 / 0.74 s | 9.5 GB → 2.4 GB (after three gene columns) |
| filtered subset (`moa_fine in [one class]`) | 25.0 / 24.8 s | 0.18 / 0.17 s | 11.5 GB → 2.4 GB |
| gene column of a panel gene (server share of a recolour) | 0.25-0.63 s | 0.27-0.30 s (0.12-0.17 s since, below) | |

The open sequence the client sends (structure, subset, cell names, genes, name search) went from
13.3 s to 1.0 s cold. The cell names were the cost: the subset's 100,000 names used to be picked
from all 50 million, which were decoded and held in memory; now only the subset's names are read,
one chunk at a time. Balanced and filtered subsets used to evaluate every cell's value in Python;
they now work on the categorical codes, one lookup per category. A categorical column is sent as
one int8 code per cell instead of a JSON string ({ref}`categorical-codes`). A gene column of the subset is now read for the subset's rows only: the column's stored
entries are scanned in blocks of 16 million and only the subset's rows are kept, instead of
building the 50-million-row column (200 MB dense, then cached) and cutting it. For three panel
genes (30 million stored values each), on a fresh server process, cold / warm:

| Gene column within the subset | Before | After |
|---|---|---|
| server time per gene | 0.27-0.35 s | 0.12-0.17 s |
| server memory after three genes (from 0.2 GB at start) | 2.2 GB | 0.53 GB |

In the browser (headless Chromium, two Cell Plots on `X_pca_2d`, one coloured by the focused
gene, one by `cell_line_id`, 100,000 points each; three recolours by panel genes):

| | Before | After |
|---|---|---|
| first plot, cold server | 18.0 s | 5.4 s |
| recolour, Enter to the last redraw, cold / warm | 1.98-2.05 / 1.72-1.80 s | 0.44-0.47 / 0.18-0.19 s |
| redraws of the recoloured panel per recolour | 19 | 1 |

A recolour used to restyle the 100,000-point trace once per helper (colour, sort by colour,
hover, log colour bar, highlight, legend, aesthetics); now the edits are drawn with one
`Plotly.react`, and the trace, layout and pixels are the same as before.

On `bm_aging.zarr` (8,090 cells) nothing got slower: the open sequence took 0.071-0.074 s
against 0.076-0.081 s, a categorical column 0.05-0.06 s either way (8.4 kB of codes instead of
91 kB of JSON), and a recolour 0.10-0.11 s against 0.27-0.31 s (three runs each, under the same
lock).

## Scaling with dataset size (laptop, JSON transfer)

From the paper's laptop benchmark (`benchmark/FINDINGS.md`): Apple M3 Max, NVMe, synthetic
stores of 10,000 to 1,000,000 cells × 5,000 genes, dense float32 layer in (2048, 32) chunks,
AnnZarro 63b57e6 **before** the binary encoding. Cold = fresh APFS clone and fresh server
process (a lower bound for network storage); warm = page cache warm, new index.

| Cells | Gene column, cold / warm | Payload (JSON) | Cell row, cold / warm |
|---|---|---|---|
| 10,000 | 20 / 9 ms | 213 kB | 44-49 / 29-32 ms at every size |
| 30,000 | 34 / 18 ms | 648 kB | |
| 100,000 | 83 / 62 ms | 2.13 MB | |
| 300,000 | 205 / 179 ms | 6.44 MB | |
| 1,000,000 | 675 / 638 ms | 21.5 MB | |

A cell row costs the same at every size (98 kB, one row of 5,000 genes). A gene column grows
linearly with cells; the binary encoding cuts it to 4 bytes per cell (above).

## Very large Cell Plots (large-plot mode)

A browser tab's JavaScript heap is capped near 4.4 GB, and browser flags do not raise the cap
(`--js-flags=--max-old-space-size=16384` leaves `performance.memory.jsHeapSizeLimit` at 4.4 GB).
The regular Cell Plot spends 400 to 900 bytes of that heap per point. On an Apple M3 Max (headless
Chromium 153, WebGL on Metal) it draws 10 million points coloured by a category and 5 million
coloured by a gene. Beyond that, the tab runs out of memory and closes.

Above `ui.defaults.large_plot_points` (5 million by default) a Cell Plot keeps its data in typed
arrays, outside that heap, and draws one single-colour layer per category or per colour step. The
panel says it is in this mode (see {doc}`../user-guide/subsets`). It uses 20 bytes of heap per
point. Measured on a synthetic store of 95,624,334 cells, the size of Tahoe-100M, before the
final timing runs (other jobs shared the machine):

| | Coloured by category | Coloured by a gene |
|---|---|---|
| First plot | 89 s | 47.5 s |
| Recolour by another gene | | 6.3-6.9 s |
| JavaScript heap, peak | 1.9 GB | 1.9 GB |
| Browser tab memory (RSS) | 8.5 GB | 9.0 GB |

In that measurement most of the first plot was the server writing the 95.6 million cell names as
JSON (31-49 s); large-plot mode no longer downloads them (they stay on the server and are asked for
one at a time). On real Tahoe-100M data, 50 million cells (PCs 1-2, Chromium 153, three cold and
four warm runs; categorical colours as integer codes), opening every cell takes:

| | Coloured by cell line | Coloured by a gene |
|---|---|---|
| First plot, cold / warm | 3.9 / 2.6 s | 3.4 / 3.0 s |
| Before names stayed on the server (cold) | 22.6 s | 24.0 s |
| Recolour by another gene | | 3.1-3.3 s |
| JavaScript heap, peak | 1.0 GB | 1.0 GB |
| Browser tab memory (RSS) | 5.6-5.8 GB | 7.0-7.3 GB |
| Server memory (RSS) | 1.4 GB | 2.2-3.1 GB |

Pan by dragging redraws every point on each move: 0.4-0.6 s per redraw at the default point size,
so about two frames a second at 50 million points. Each finished zoom takes 0.8-1.0 s, because
Plotly uploads every point to the GPU again.

## Chunk shape

The slowest interaction is set by chunk layout, not by data size. Full discussion and a fresh
measurement through this branch: {doc}`../data/chunking`. The paper's numbers at about a million
cells, cold:

| Machine | Chunks | Gene column | Cell row |
|---|---|---|---|
| laptop, 1M × 5,000 | (n, 64) whole-gene | 0.78 s | **2.86 s** (12 GB server memory) |
| laptop | (15625, 79) anndata 0.12 default | 0.66 s | 0.058 s |
| laptop | (1024, 1024) | 1.20 s | 0.017 s |
| laptop | (256, 4096) | **2.89 s** | 0.018 s |
| HPC, 1,165,934 × 12,731 Kompot layer (provisional) | (n, 4) whole-gene, as served | 1.75 s | **45.3 s** |
| HPC (provisional) | (4096, 64) aspect rule | 2.41 s | 0.41 s |
| HPC (provisional) | (1024, 1024) | **5.98 s** | 0.13 s |

Laptop gene columns here still include about 0.5 s of JSON encoding; HPC gene columns at
1.17M cells are mostly JSON and HTTP (the raw zarr read was 0.16 s). On the busier `/fh/fast`
filesystem the whole-gene cell row took 229 s.

## Pairwise matrices (HPC, provisional)

One server process (gunicorn, one sync worker), page cache evicted before each cold request,
dense diffusion-distance obsp (fully dense, the worst case), chunks (16, n):

| Cells | Matrix (float32) | Row | Cold | Warm |
|---|---|---|---|---|
| 50,000 | 10 GB | 1.08 MB JSON | 0.087-0.111 s | 0.043 s |
| 100,000 | 40 GB | 2.15 MB | 0.14-0.19 s | 0.090 s |
| 200,000 | 160 GB | 4.28 MB | 0.23-0.31 s | 0.153 s |

The two cold values are the paper text's and the figure's medians, which come from different
summaries of the same run; quote the range until the rerun. A genes × genes correlation row
for 30,000 genes took 0.13 s.

## Server memory

| Setting | Peak resident memory |
|---|---|
| idle server | 77-82 MB (HPC 77 MiB; laptop 82 MB) |
| one row of a 10-160 GB dense pairwise matrix (HPC, provisional) | 85-117 MiB |
| gene column of a 20 GB layer at 1M cells, JSON (laptop) | 326 MB median, 388 MB max |
| cell row at any size (laptop) | 93-95 MB |
| cell row of CSC X, `bm_aging.zarr` / 1M cells (laptop, settylab/annzarro#55) | 133 MB / 98 MB growth |
| cell row with whole-gene chunks at 1M (laptop) | 12.1 GB |
| lab deployment, 33 datasets, 2.2 TiB on disk, three processes | 0.58-0.75 GB each, peak 0.92 GB |

Memory follows the chunks a request touches. The laptop gene-column number grew with n because
of the JSON list and string; the binary path does not build them.

## On a shared deployment

On the paper's lab deployment (Fred Hutch gizmok87, three sync gunicorn workers on a loaded
node, NFS storage; `benchmark/deployment/gizmok87_runtime_2026-10-01.md` in the paper
repository), single vectors of a 75,000-cell spatial store took 0.76-2.36 s under concurrent
traffic, a 75,000 × 75,000 dense matrix (about 22 GB in float32) was browsed one 1.3 MB JSON row
per click, and first load of the 75,000-cell dataset took about 10 s. These numbers predate the
binary encoding.

## Measure your own

```bash
annzarro start --host 127.0.0.1 --port 8812 --no-browser --auth-disabled --data-dir <dir>
python docs/_tools/bench_api.py --port 8812          # demonstration store, JSON vs binary
python docs/_tools/bench_chunks.py --port 8812 --work /scratch/dir   # chunk shapes
```

Edit the request list at the top of `bench_api.py` for your own store. For cold numbers on
Linux, drop the page cache between requests
(`vmtouch -e <store>` or `posix_fadvise(POSIX_FADV_DONTNEED)`) and restart the server; on macOS
cold reads need a fresh copy of the store.
