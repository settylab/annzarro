# Fig. 7 · What one click costs

```{figure} ../_static/figures/paper/fig7.png
:alt: Six panels: bytes per click, latency per click, peak server memory, chunk shape trade-off, time breakdown at 1M cells, and JSON versus binary transfer.
:width: 100%

Paper Fig. 7. Interactions cost one vector, and memory stays flat. HPC numbers are
provisional pending a rerun on a quieter file system.
```

Fig. 7 is measured, not drawn in the app. Each panel answers one question about what a
click costs: bytes sent (a), time (b), server memory (c), the effect of chunk shape (d), where
the time goes (e) and the gain from binary transfer (f). What these mean for your own data
and how to tune a store is in {doc}`../reference/performance` and {doc}`../data/chunking`.
This page records the measurement conditions and how to rerun the benchmark.

| Panel | Measures | Key numbers (median) |
|---|---|---|
| a | JSON response bytes per click vs cells | gene column 213 kB (10k) to 21.5 MB (1M) from a 20 GB layer; cell row 97.6 kB at every size |
| b | client time to last byte, localhost | laptop gene column 20 ms cold at 10k, 675 ms at 1M; cell row 44–49 ms; HPC dense pairwise row 305 ms cold at 200k cells; HPC gene column 1.75 s cold at 1.17M cells |
| c | peak server RSS in one cold request | idle 81–82 MB; laptop gene column 326 MB for a 20 GB layer; HPC pairwise row 109 MB for a 160 GB matrix |
| d | cold cell row vs cold gene column per chunk shape, ~1M cells | laptop anndata default (15625, 79): 0.66 s / 0.058 s; whole-gene (n, 64): cell row 2.86 s; HPC whole-gene (n, 4): cell row 45.3 s |
| e | warm request split at 1M cells | dense gene column 94 ms zarr read, 194 ms tolist, 314 ms JSON, 35 ms rest |
| f | JSON vs binary float32 (AnnZarro PR 44), warm, 1M cells | gene column 576 → 100 ms; obsm column 323 → 6 ms; kNN row 82 → 13 ms |

Conditions: medians with IQR whiskers. Laptop: Apple M3 Max, 128 GB, NVMe/APFS, synthetic
n × 5,000 float32 stores; *cold* is a fresh server on a fresh APFS clone (n = 5), *warm* a new
index with the page cache warm (n = 10). HPC: Xeon Gold 6254 nodes, 4 CPUs per job, NFS
(`/hpc/temp`), real datasets; *warm* repeats the same index (n = 25), the more favourable
definition. HPC numbers are provisional. Panels a to e measure JSON transfer at AnnZarro
commit `63b57e6`; the AnnZarro this documentation describes already sends binary vectors
(panel f), whose numbers come from a separate run stored in `figures/fast_transfer_pr44.csv`.
The source of every number is `figures/PERFORMANCE_NOTES.md` in the paper repository.

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
`annzarro start` runs. Later AnnZarro versions removed that module entry point; on them the
harness starts `annzarro start --no-browser --auth-disabled` with the cache pinned to the same
1000 MB, so new runs stay comparable. `run_benchmark.py env` records the commit of the AnnZarro checkout
in `ANNZARRO_REPO` (default: `annzarro/` next to the paper repository); set it if your checkout
lives elsewhere. The cold condition clones each store with `cp -c` (an APFS clone), so
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
byte-identical PNGs. It reads the laptop CSVs from `benchmark/results/` of the clone it
sits in.

## Measuring a click in your own browser

Open the browser's developer tools on the **Network** tab, filter for `api/v1/data`, and
click a gene or a cell: each panel that follows the focus issues one request, whose **Size**
and **Time** are the cost of that click. In headless Chromium on `bm_aging.zarr`, laptop,
localhost (view `docs/_tools/views/fig9-click-cost.json`, named after the figure's earlier number, measured by
`docs/_tools/shoot_figs79.py` over four runs, the latest on the build with PRs 46 to 57):

| Click | Request | Body | Duration |
|---|---|---|---|
| a gene in the volcano | `layer/kompot_de_Young_to_Old_fold_change?cols=…&format=f32` | 32,360 B (8,090 × 4 B) | 14 to 20 ms |
| a cell in the embedding | `layer/kompot_de_Young_to_Old_fold_change?rows=…&format=f32` | 65,140 B (16,285 × 4 B) | 19 to 22 ms |
| "Previous gene", back to one already shown | none | | |

More on measuring and tuning on your own deployment is in {doc}`../reference/performance`.
