# Performance: what one click costs

```{figure} ../_static/figures/paper/performance.png
:alt: Four panels: bytes per click against the number of cells, latency per click on a laptop, peak server memory against matrix size, and the chunk shape trade-off between cell rows and gene columns. The HPC and pairwise series are marked as awaiting v0.4.0 runs.
:width: 100%

*Interactions cost one vector, and memory stays flat*, a figure of the AnnZarro paper (Otto,
Baasri and Setty, in preparation), made by `figures/fig6_performance.py` in the paper
repository. The laptop series are final; the HPC and pairwise series are being re-measured on
AnnZarro v0.4.0 and are marked "awaiting v0.4.0 runs".
```

This figure is measured, not drawn in the app. Each panel answers one question about what a
click costs: bytes sent (a), time (b), server memory (c) and the effect of chunk shape (d).
What these mean for your own data and how to tune a store is in
{doc}`../reference/performance` and {doc}`../data/chunking`. This page records the measurement
conditions and how to rerun the benchmark. For the same costs at the scale of Tahoe-100M, in the
browser, see {doc}`scale`.

| Panel | Measures | Key numbers, as in the paper's caption |
|---|---|---|
| a | bytes sent per click against the number of cells: gene column, cell row (5,000 genes), row of a dense pairwise matrix | at one million cells a 20 GB layer is shown through a 4 MB gene column, one part in 5,000 (binary float32, 4 bytes per value) |
| b | latency per click on the laptop, cold and warm | gene columns stay under 1 s up to one million cells |
| c | peak resident memory of the server against the uncompressed size of the matrix read | the server's peak stays at 81 to 102 MiB while the layer read grows a hundredfold, from 0.2 to 20 GB; the idle server uses 78 MiB |
| d | cold cell row against cold gene column, one point per chunk shape, 1 million × 5,000 | whole-gene chunks make one cell row decompress the whole layer (2.9 s); anndata's default chunks keep each read to a small part of the layer |

Conditions: every number is AnnZarro v0.4.0 (release candidate `3bdeb09`, the tree of the
v0.4.0 tag), with vectors sent in the binary float32 format the web client uses. Laptop: Apple
M3 Max, 16 cores, 128 GB RAM, NVMe/APFS, macOS; synthetic n × 5,000 float32 stores; *cold* is a
fresh server on a fresh APFS clone of the store, *warm* a new random index with the page cache
warm. The HPC series (Xeon Gold 6254 nodes, data on an NFS scratch filer) and the rows of dense
pairwise matrices, which were measured only on HPC nodes, are being re-measured on v0.4.0; the
paper and this page give no HPC number until those runs land. The results are
`benchmark/results/scale_v040.csv` and `sweep_v040.csv` in the paper repository.

Medians from `scale_v040.csv`, cold / warm, in milliseconds (5 cold and 10 warm requests per
cell, each for a new random index):

| Interaction | 10k cells | 100k cells | 1M cells |
|---|---|---|---|
| Gene column of a dense layer | 32 / 5 | 36 / 12 | 96 / 86 |
| Cell row (5,000 genes) | 59 / 26 | 52 / 26 | 46 / 27 |
| obsm column | 24 / 2 | 22 / 2 | 21 / 6 |
| kNN graph row (sparse obsp) | 23 / 6 | 28 / 7 | 27 / 11 |

## Rerunning the benchmark

The harness lives in `benchmark/` of the paper's companion repository
(`settylab/annzarro-paper`, private until the paper is published; {ref}`paper-companion`). It writes synthetic, seeded zarr v2 stores,
starts AnnZarro servers on localhost, and records latency, response bytes and server memory
for each request. The measurement conditions and CSV columns are documented in
`benchmark/README.md`.

| File | Role |
|---|---|
| `generate_data.py` | writes the stores to `data/bench/` and records them in `data/bench/manifest.json` |
| `run_benchmark.py` | starts servers, issues HTTP requests, writes `results/<experiment><suffix>.csv` |
| `queue_perf.sh` | the v0.4.0 laptop run: builds a release, then scale, sparse and chunk-sweep measurements, one store at a time |
| `../figures/fig6_performance.py` | assembles the paper figure from `results/scale_v040.csv` and `results/sweep_v040.csv` |

### Environment

The v0.4.0 run served from AnnZarro 0.4.0 under Python 3.13.9 with zarr 3.4.0, numcodecs 0.17.0,
numpy 2.5.3 and Flask 3.1.3; the harness itself ran under Python 3.11
(`results/scale_v040_environment.json` lists every version and the AnnZarro commit).
`run_benchmark.py --server-python` names the interpreter of the AnnZarro build to measure, and
`--suffix` names the result files, so one harness measures any release:

```bash
cd benchmark
PY=../.venv/bin/python
$PY generate_data.py check                       # prints anndata's default chunks for 100k x 5k
$PY generate_data.py scale --sizes 10000 30000 100000
$PY run_benchmark.py scale --sizes 10000 30000 100000 \
    --server-python /path/to/annzarro-0.4.0/bin/python --suffix _mine
$PY run_benchmark.py env --server-python /path/to/annzarro-0.4.0/bin/python --suffix _mine
```

The default wire format is binary (`--wire binary`), as the web client sends. The cold condition
clones each store with `cp -c` (an APFS clone), so the harness is written for macOS. A small run
like this takes a few minutes; the full laptop run (`queue_perf.sh <release> <suffix>`, every
size to one million cells, the sparse stores and the 1M chunk sweep, one store at a time) takes
hours and up to about 70 GB of disk. These commands were not rerun for this page.

### Rebuilding the figure

From the root of the paper repository:

```bash
.venv/bin/python figures/fig6_performance.py
```

It reads the laptop CSVs from `benchmark/results/` and writes
`manuscript/figures/fig6_performance.{pdf,png}` and the supplementary `figS_interactions` and
`figS_chunk_sweep`. The docs' copy is made from that PNG by `docs/_tools/make_paper_figs.py`.

## Measuring a click in your own browser

Open the browser's developer tools on the **Network** tab, filter for `api/v1/data`, and
click a gene or a cell: each panel that follows the focus issues one request, whose **Size**
and **Time** are the cost of that click. In headless Chromium on `bm_aging.zarr`, laptop,
localhost, AnnZarro v0.4.0 (view `docs/_tools/views/click-cost.json`, measured by
`docs/_tools/shoot_figs79.py` over three runs):

| Click | Request | Body | Duration |
|---|---|---|---|
| a gene in the volcano | `layer/kompot_de_Young_to_Old_fold_change?cols=…&format=f32` | 32,360 B (8,090 × 4 B) | 13 to 19 ms |
| a cell in the embedding | `layer/kompot_de_Young_to_Old_fold_change?rows=…&format=f32` | 65,140 B (16,285 × 4 B) | 33 to 39 ms |
| "Previous gene", back to one already shown | none | | |

More on measuring and tuning on your own deployment is in {doc}`../reference/performance`.
