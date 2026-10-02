# Fig. 9: what one click costs

```{figure} ../_static/figures/paper/fig9.png
:alt: Six panels: bytes per click, latency per click, peak server memory, chunk shape trade-off, time breakdown at 1M cells, and JSON versus binary transfer.
:width: 100%

Paper Fig. 9. Interactions cost one vector, and memory stays flat. HPC numbers are
provisional pending a rerun on a quieter file system.
```

Fig. 9 is measured, not drawn in the app. This guide explains what each panel measures and
under which conditions, how to rerun the benchmark that produced it, and how to measure the
cost of a click in your own browser on your own data.

## What each panel measures

All points are medians with interquartile-range whiskers. *Cold* means a fresh server process
reading data that is not in the operating system's page cache; *warm* means the page cache is
warm. Laptop: Apple M3 Max, 128 GB, internal NVMe (APFS), synthetic stores of n cells ×
5,000 genes, float32. HPC: Fred Hutch nodes (Xeon Gold 6254, 4 CPUs per job), data on
`/hpc/temp` (NFS), real datasets.

**a. Bytes per click.** The size of the response body for one click, as JSON, against the
number of cells, with the size of the whole matrix for reference. A gene column of a dense
n × 5,000 layer is 213 kB at 10k cells, 2.13 MB at 100k and 21.5 MB at 1M; the whole layer at
1M cells is 20 GB, about 930 times more. A cell row is 97.5 to 97.6 kB at every size, because
its length is the number of genes. A row of a fully dense n × n pairwise matrix on HPC is
1.08 MB at 50k cells, 2.15 MB at 100k and 4.28 MB at 200k.

**b. Time per click.** Client-side time until the whole body has arrived, over localhost.

| Interaction | 10k | 30k | 100k | 300k | 1M |
|---|---|---|---|---|---|
| Gene column, laptop, cold / warm (ms) | 20 / 9 | 34 / 18 | 83 / 62 | 205 / 179 | 675 / 638 |

A laptop cell row takes 44 to 49 ms cold and 29 to 32 ms warm at every size.

On HPC a row of the dense distance matrix takes 111, 193 and 305 ms cold (50k, 100k, 200k
cells) and 43, 90 and 153 ms warm. A gene column of a whole-gene-chunked Kompot layer takes
0.86 s cold at 460k cells and 1.75 s at 1.17M cells, almost all of it JSON encoding and
HTTP; the zarr read is 0.16 s. "Under one second" holds for every laptop interaction up to
1M cells and for HPC pairwise rows up to 200k cells; it does not hold for HPC gene columns
above about 0.5M cells. HPC *warm* repeats the same index (n = 25); laptop *warm* requests a
new index each time (n = 10), so the HPC warm numbers are the more favourable definition.

**c. Server memory.** Peak resident memory of the server process during one cold request,
against the uncompressed size of the matrix being read. The idle server uses 81 to 82 MB. A
laptop gene column peaks at 89 MB for a 0.2 GB layer and 326 MB for a 20 GB layer; the growth
is the 1M-value list and its JSON string, not the matrix. An HPC pairwise row peaks at
92 to 109 MB for matrices of 1.6 to 160 GB.

**d. Chunk shape.** Cold cell-row time against cold gene-column time, one point per chunk
shape, at about 1M cells. On the laptop (1M × 5,000), whole-gene chunks (n, 64) make a cell
row take 2.86 s and wide chunks (256, 4096) make a gene column take 2.89 s, while anndata
0.12's default (15625, 79) gives 0.66 s and 0.058 s. On HPC (1,165,934 × 12,731 Kompot
layer), the whole-gene layout as served, (n, 4), makes a cell row take 45.3 s; (4096, 64)
gives 2.41 s and 0.41 s. Chunks whose aspect ratio follows the matrix's, at 0.25 to 1 million
values per chunk, are fast in both directions; see {doc}`../data/chunking`.

**e. Where the time goes.** A warm request at 1M cells on the laptop, split into zarr read,
`ndarray.tolist()`, JSON encoding and the rest. For a dense gene column: 94, 194, 314 and
35 ms; list conversion and JSON encoding are 508 of 629 ms (81%).

**f. Binary transfer.** The same requests after AnnZarro pull request 44, which sends vectors
as little-endian float32 (sparse rows as their non-zeros), warm, at 1M cells × 5,000 genes,
client side including parsing: gene column 576 to 100 ms and 21.5 to 4.0 MB; obsm column 323
to 6 ms; kNN row 82 to 13 ms and 4.0 MB to 152 bytes; cell row 26 to 24 ms. These come from a
separate run whose numbers are stored in `figures/fast_transfer_pr44.csv`; the benchmark
harness below measures the JSON path only.

```{note}
The AnnZarro you install from this documentation already uses the binary transfer of panel f:
the browser asks for vectors with `format=f32`. Panels a to e describe the JSON transfer of
the commit they were measured on (`63b57e6`), which other HTTP clients still get by default.
```

## Rerunning the benchmark

The harness lives in `benchmark/` of the paper's companion repository
(`settylab/annzarro-paper`, not yet public). It writes synthetic, seeded zarr v2 stores,
starts AnnZarro servers on localhost, and records latency, response bytes and server memory
for each request. Results and their interpretation are in `benchmark/FINDINGS.md`; the
measurement conditions and CSV columns are documented in `benchmark/README.md`.

| File | Role |
|---|---|
| `generate_data.py` | writes the stores to `data/bench/` and records them in `data/bench/manifest.json` |
| `run_benchmark.py` | starts servers, issues HTTP requests, writes `results/<experiment>.csv` |
| `sweep_1m.sh` | chunk-shape sweep at 1M cells, one ~18 GB store at a time |
| `make_plots.py` | reads `results/*.csv`, writes `plots/*.pdf`/`.png` and two derived CSVs |
| `../figures/fig6_performance.py` | assembles the paper figure from the laptop CSVs and the HPC CSVs |

### Environment

The published run used Python 3.11, anndata 0.12.19, zarr 3.1.6, numcodecs 0.16.5, Flask
3.1.3, psutil and requests, with AnnZarro installed editable from a checkout at commit
`63b57e6` (`results/environment.json` lists every version). The harness starts the server as
`python -m annzarro.server` with `ANNZARRO_HEADLESS=1`, the same Flask app that
`annzarro start` runs. The cold condition clones each store with `cp -c` (an APFS clone), so
it is written for macOS.

### A small run (verified)

This runs the scale experiment at 10k, 30k and 100k cells, enough to check the setup and to
reproduce the small end of panels a, b, c and e. Run it from `benchmark/`:

```bash
PY=../.venv/bin/python
$PY generate_data.py check                 # prints anndata's default chunks for 100k x 5k
$PY generate_data.py scale --sizes 10000 30000 100000 --chunks c2048x32
$PY run_benchmark.py scale --fresh        # measures every scale store in the manifest
$PY run_benchmark.py breakdown
$PY run_benchmark.py env
$PY make_plots.py
```

```{warning}
`--fresh` overwrites `results/scale.csv`, and `breakdown` always rewrites
`results/breakdown.csv`, which are the published results. To keep them, run in a copy of
`benchmark/` (the scripts locate `data/bench/` relative to their own directory, so a copy
next to its own `data/` and `.venv` works).
```

On the M3 Max laptop, in such a copy, generation took 8 s and wrote 2.4 GB
(176 MB, 532 MB and 1.7 GB for the three stores; `check` takes a few seconds more);
`run_benchmark.py scale` took 1 min 33 s, `breakdown` 8 s and `make_plots.py` 2 s.
`make_plots.py` skips the chunk-sweep and sparse plots when their CSVs are missing and
writes `figA_bytes_vs_cells`, `figB_latency_vs_cells`, `figD_server_memory` and
`figG_time_breakdown`. The medians agree with the published run:

| Interaction (cold / warm), median | 10k | 30k | 100k | Published 100k |
|---|---|---|---|---|
| Gene column, ms | 15.6 / 8.2 | 28.7 / 19.3 | 76.0 / 64.7 | 83 / 62 |
| Gene column, bytes | 213.5 kB | 647.6 kB | 2.13 MB | 2.13 MB |
| Cell row, ms | 41.2 / 30.8 | 40.4 / 30.8 | 39.8 / 31.5 | 44–49 / 29–32 |
| obsm column, ms | 14.6 / 5.4 | 22.9 / 13.3 | 70.1 / 51.6 | 74 / 48 |
| kNN graph row, ms | 13.7 / 4.9 | 13.0 / 6.5 | 20.2 / 11.7 | 23 / 10 |

Warm is `warm_new` (page cache warm, new index), n = 5 cold and 10 warm per cell. Server
peak memory for the 100k gene column was 107 MB cold.

### The full run

The full laptop run, as in `benchmark/README.md`:

```bash
PY=../.venv/bin/python
$PY generate_data.py check
$PY generate_data.py sweep                 # 11 chunk shapes at 100k x 5k (~19 GB)
$PY run_benchmark.py sweep --fresh
./sweep_1m.sh default c1024x1024 c4096x256 c1024x64 c4096x16 c16384x16 c2048x32 c256x4096 cNx64
$PY generate_data.py scale --chunks c2048x32   # 10k-1M cells (~25 GB)
$PY generate_data.py sparse                # CSR + CSC at 100k and 1M x 20k (~5 GB; 1M takes ~2.5 h)
$PY run_benchmark.py scale --fresh
$PY run_benchmark.py sparse --fresh
$PY run_benchmark.py breakdown
$PY run_benchmark.py env
$PY make_plots.py
```

Measurement takes about 1.5 h on a 16-core M3 Max and generating the 1M-cell sparse matrix
about 2.5 h more. Peak disk use is about 70 GB; `sweep_1m.sh` deletes each 1M-cell store after
measuring it. Do not generate and measure at the same time: both are CPU and disk bound. The
1M-cell sweep was not rerun for this documentation.

### Rebuilding the figure

The HPC results are on branch `dominik/hpc-bench` of the paper repository. Copy them out and
point the figure script at them, from the repository root:

```bash
mkdir -p /tmp/hpc
git archive origin/dominik/hpc-bench benchmark/hpc/results | tar -x -C /tmp/hpc
.venv/bin/python figures/fig6_performance.py --hpc-dir /tmp/hpc/benchmark/hpc/results
```

It takes about 2 s and overwrites `manuscript/figures/fig6_performance.{pdf,png}`,
`figS_chunk_sweep` and `figS_interactions`; rebuilding from the committed CSVs gives
byte-identical PNGs. The script reads the laptop CSVs from an absolute path (the
`REPO` constant at the top of the script); edit it if your clone lives elsewhere.

## Measuring a click in your own browser

The numbers above come from a Python client. To see what a click costs in your browser, on
your data and your deployment, use the browser's developer tools.

1. Open AnnZarro with a dataset and a panel whose colour follows the focus (for example
   **Color** `layer`, a fold-change layer, "Focused gene …").
2. Open the developer tools (Chrome and Edge: {kbd}`Ctrl+Shift+I`, macOS {kbd}`Cmd+Option+I`;
   Firefox: {kbd}`Ctrl+Shift+E`) and select **Network**.
3. Type `api/v1/data` into the filter box so only data requests are listed.
4. Click a gene in a gene plot. One request appears per panel that follows the focused gene,
   for example `layer/kompot_de_Young_to_Old_fold_change?…&cols=6025&format=f32`. Its
   **Size** column is the bytes that crossed the network and **Time** the time to the last
   byte; hover over the request's bar in the **Waterfall** column to split that time into
   waiting for the server and downloading.
5. For the same numbers as text, paste this into the **Console**:

   ```javascript
   performance.getEntriesByType('resource')
     .filter(e => e.name.includes('/api/v1/data/'))
     .map(e => ({url: e.name.split('?')[0], ms: Math.round(e.duration), bytes: e.encodedBodySize}))
   ```

   and `performance.clearResourceTimings()` before the next click to start a fresh list.

Measured this way in headless Chromium on `bm_aging.zarr` (8,090 cells × 16,285 genes),
laptop, server on localhost, with an embedding coloured by the focused gene and a volcano
coloured by the focused cell (the view in `docs/_tools/views/fig9-click-cost.json`):

| Click | Request | Body | Duration |
|---|---|---|---|
| A gene (Tomm40) in the volcano | `layer/kompot_de_Young_to_Old_fold_change?cols=6025&format=f32` | 32,360 B (8,090 × 4 B) | 14 to 20 ms |
| A cell in the embedding | `layer/kompot_de_Young_to_Old_fold_change?rows=2993&format=f32` | 65,140 B (16,285 × 4 B) | 19 to 21 ms |
| "Previous gene" back to H2-Q7 | none | | |

One click is one request, and its body is exactly one float32 per cell (gene click) or per
gene (cell click). Returning to a gene shown earlier in the session sent no request: the
browser already held that vector. Durations are from three runs of
`docs/_tools/shoot_figs79.py`; they vary with machine and load, so measure on your own setup
before drawing conclusions.

```{figure} ../_static/screens/paper/fig9-after-clicks.png
:class: screenshot
:alt: Two linked panels after the clicks: UMAP coloured by Tomm40 fold change and a volcano coloured by the fold change in cell HSPC_Old_3#GGGTGTCGTAGCGTCC-1.

The measured view after the two clicks: the embedding shows the new focused gene (Tomm40),
the volcano the new focused cell.
```

On a personal server behind an SSH tunnel or a lab server behind a proxy, the same requests
also include network transfer, which is where the 4-byte-per-value binary format matters
most. {doc}`fig8-deployment` describes those arrangements, and
{doc}`../reference/performance` collects tuning advice.
