# Performance

One click moves one vector, never a matrix, so the cost of an interaction grows with the
number of cells or genes and not with the size of the stored array. This page collects the
measured numbers, each with the conditions it was measured under. Read the conditions: a
"cold" request on a laptop NVMe and a cold request on a busy network filesystem differ by
orders of magnitude.

Every number on this page is AnnZarro v0.4.0. The paper's performance figure
({doc}`../paper/performance`) and scale figure ({doc}`../paper/scale`) summarise the benchmarks;
their numbers are reproduced below where they matter for setting up a store or a server.

```{important}
**HPC numbers are being re-measured.** The paper's benchmark on HPC nodes (Xeon Gold 6254, data
on an NFS scratch filer), which covers dense pairwise matrices up to 160 GB and a
1.17-million-cell atlas, is being rerun on v0.4.0. Until it lands, neither the paper nor this
page gives an HPC number. Laptop and demonstration-store numbers are final for v0.4.0.
```

## On the demonstration store

Measured for these docs on AnnZarro v0.4.0: `bm_aging.zarr` (8,090 cells × 16,285 genes), server
on the same machine (Apple M3 Max, 128 GB, local NVMe), `requests` over localhost, page cache
warm, a new random index for every request so that neither the server's result cache nor HTTP
revalidation answers it; median of 10, binary transfer (`format=f32`) as the web client uses it.
Script: `docs/_tools/bench_api.py`; data: `docs/_tools/data/api_bm_aging.csv`.

| Request (what a click asks for) | Time | Body |
|---|---|---|
| gene column, dense layer (fold change) | 12.3 ms | 32 kB |
| gene column, X (CSC) | 11.7 ms | 32 kB |
| gene column, CSR layer (`logged_counts`) | 71.5 ms | 4.7 kB sparse |
| cell row, dense layer (fold change) | 15.8 ms | 65 kB |
| cell row, X (CSC) | 235.2 ms | 65 kB |
| obsp row, dense `diffusion_walk_t5` | 13.4 ms | 28 kB sparse |
| obsp row, kNN `connectivities` (CSR) | 9.4 ms | 144 B sparse |
| varp row, dense `spearman_fold_change` | 16.0 ms | 65 kB |
| obsm column `X_umap` (repeat, result cache) | 1.0 ms | 32 kB |
| obs column, DA z-score (repeat, result cache) | 1.2 ms | 65 kB float64 |

Two rows stand out, and both are storage layout, not transfer: a gene column of a CSR layer and
a cell row of a CSC matrix each have to decompress every chunk of the matrix (72 ms and 235 ms).
Every other interaction is under 20 ms. See {doc}`../data/preparing-a-store` for the CSR/CSC
choice.

### Sparse reads on the other axis

A selection along the axis a sparse matrix is not compressed by (a cell row of CSC X, a gene
column of a CSR layer) is a bounded scan of the stored indices, 4M entries at a time, reading
only the data between hits; a block of rows and columns slices the compressed axis first. Every
chunk is still decompressed, which is why those two rows above are the slow ones, but the server
never loads the whole matrix into memory.

### h5ad files

An `.h5ad` file is read in place, one slice per click, as a zarr store is, and the same layout
rules apply: a gene column from a CSR matrix scans the whole matrix. See
{doc}`../data/preparing-a-store` for the layout advice.

## Scaling with dataset size (laptop)

From the paper's laptop benchmark ({doc}`../paper/performance`): AnnZarro v0.4.0, Apple M3 Max,
NVMe, synthetic stores of 10,000 to 1,000,000 cells × 5,000 genes, dense float32 layer in
(2048, 32) chunks, binary float32 transfer. Cold = fresh APFS clone and fresh server process (a
lower bound for network storage); warm = page cache warm, new index. Medians of 5 cold and 10
warm requests (`benchmark/results/scale_v040.csv` in the paper repository):

| Cells | Gene column, cold / warm | Body | Cell row, cold / warm |
|---|---|---|---|
| 10,000 | 32 / 5 ms | 40 kB | 59 / 26 ms |
| 100,000 | 36 / 12 ms | 400 kB | 52 / 26 ms |
| 1,000,000 | 96 / 86 ms | 4.0 MB | 46 / 27 ms |

A cell row costs the same at every size (20 kB, one row of 5,000 genes). A gene column grows
linearly with cells, at 4 bytes per cell. At one million cells a 20 GB layer is shown through a
4 MB gene column, one part in 5,000.

## Tahoe-100M on a laptop

From the paper's scale benchmark ({doc}`../paper/scale`): all 95,624,334 cells of Tahoe-100M, a
200-gene panel in X, Apple M3 Max (128 GiB RAM), headless Chromium 153, medians over 3 cold runs.

On the default 100,000-cell subset:

| | Time |
|---|---|
| first plot after the page opened | 2.9 s (2.5 s coloured by cell line) |
| recolour by another gene | 0.43 s |
| step to the next of 957 parts | 1.8 s |
| switch to a subset balanced across the 50 cell lines, including the dialog | 3.1 s |
| first plot of a one-million-cell store, for comparison | 1.1 s |

These times grow with the number of cells in the dataset, not with the number shown. The tab's
renderer process used 0.5 GiB at every dataset size and the server process at most 1.7 GiB. The
first search for a cell by name builds the server's name index: 6.3 s at 50 million cells, or
0.8 s once a local server has built it in the background.

## Very large Cell Plots (large-plot mode)

A browser tab's JavaScript heap is capped at 4.1 GiB in Chromium, whatever the browser flags. The
regular Cell Plot, which keeps hover and focus, is the costly one: at 1 million cells, the most it
draws, the first plot coloured by a gene took 6.0 s and filled up to 1.3 GiB of that heap. Several
plots share the heap, so the default limit is 1 million points per regular plot.

Above `ui.defaults.large_plot_points` (1 million by default) a Cell Plot keeps its data in typed
arrays, outside that heap, and draws one single-colour layer per category or per colour step,
without hover, click to focus, table filters, obsp colours or 3D. The panel says it is in this
mode (see {doc}`../user-guide/subsets`). It holds about 20 bytes of heap per point (1.80 GiB at
95.6 million cells). In the paper's runs:

| | Time (3 cold runs) |
|---|---|
| 2 million cells | 0.71 s |
| 5 million cells | 0.9 s |
| all 95.6 million cells, point size 1, opacity 0.2, by cell line or by a gene | 5 to 6 s |
| all 95.6 million cells, automatic size and opacity | 5.6-5.8 s by a gene, 4.8-6.1 s by cell line |

Drawing every cell of Tahoe-100M, the tab's renderer process used up to 9.2 GiB and the server,
recolouring included, 6.8 GiB (resident memory). With the memory guard at its defaults, every cell
was drawn for stores up to 150 million cells and the first plot was declined at 160 million
({ref}`browser-memory`).

## Chunk shape

The slowest interaction is set by chunk layout, not by data size. Full discussion:
{doc}`../data/chunking`. The paper's laptop sweep at 1,000,000 × 5,000, cold, AnnZarro v0.4.0
(`benchmark/results/sweep_v040.csv`, median of 5):

| Chunks | Gene column | Cell row | Server peak, cell row |
|---|---|---|---|
| (1000000, 64) whole-gene | 0.20 s | **2.92 s** | 7.2 GiB |
| (15625, 79) anndata 0.12 default | 0.062 s | 0.055 s | 0.18 GiB |
| (2048, 32) | 0.086 s | 0.037 s | 0.08 GiB |
| (1024, 1024) | 0.56 s | 0.016 s | 0.12 GiB |
| (256, 4096) | **2.21 s** | 0.015 s | 0.09 GiB |

With whole-gene chunks every chunk holds part of each cell's row, so one cell row decompresses the
whole layer. The HPC sweep on the 1.17-million-cell Kompot layer is being re-measured on v0.4.0.

## Pairwise matrices

Dense cells × cells and genes × genes matrices are read one row per click, and a row costs what a
gene column of the same length costs. The paper's measurements on dense pairwise matrices of 10 to
160 GB were made on HPC nodes and are being re-measured on v0.4.0; this page will quote them when
they land.

## Server memory

| Setting | Peak resident memory |
|---|---|
| idle server (laptop) | 78 MiB |
| gene column or cell row of a 0.2-20 GB layer (laptop, 10k to 1M cells) | 81-102 MiB |
| cell row with whole-gene chunks at 1M cells (laptop) | 7.2 GiB |
| Tahoe-100M, default subset (laptop) | at most 1.7 GiB |
| Tahoe-100M, every cell drawn, recolouring included (laptop) | 6.8 GiB |

Memory follows the chunks a request touches; the binary path sends the array without building a
Python list or a JSON string.

## Measure your own

```bash
annzarro start --host 127.0.0.1 --port 8812 --no-browser --auth-disabled --data-dir <dir>
python docs/_tools/bench_api.py --port 8812          # demonstration store, one row per click type
python docs/_tools/bench_chunks.py --port 8812 --work /scratch/dir   # chunk shapes
```

Edit the request list at the top of `bench_api.py` for your own store. For cold numbers on
Linux, drop the page cache between requests
(`vmtouch -e <store>` or `posix_fadvise(POSIX_FADV_DONTNEED)`) and restart the server; on macOS
cold reads need a fresh copy of the store.
