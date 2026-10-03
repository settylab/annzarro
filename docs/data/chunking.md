# Chunking

A zarr array is stored as compressed chunks, and a read decompresses every chunk it touches,
whole. One click in AnnZarro reads one row or one column, so the chunk shape decides how much
data a click decompresses. It is the one storage decision that can turn a 10 ms click into a
45 s one.

## The rule

For a dense cells × genes layer:

- A **gene column** touches one column of chunks: all cells × the chunk's *width* in genes.
- A **cell row** touches one row of chunks: all genes × the chunk's *height* in cells.

Both stay small when the chunk's aspect ratio follows the matrix's own, rows / cols ≈
n_cells / n_genes, at about 5 × 10⁵ values per chunk (2 MB in float32):

```python
import math

def layer_chunks(n_obs, n_vars, target=5e5):
    rows = 2 ** round(math.log2(math.sqrt(target * n_obs / n_vars)))
    cols = 2 ** round(math.log2(target / rows))
    return min(rows, n_obs), min(cols, n_vars)

layer_chunks(8_090, 16_285)       # (512, 1024)   demonstration data
layer_chunks(1_165_934, 12_731)   # (8192, 64)    1.17M-cell atlas
```

Pairwise matrices (`obsp`, `varp`) are only ever read by row, so their chunks span whole rows:
`(max(1, 10**6 // n), n)`. Sparse matrices have no 2-D chunks; their direction is set by CSR
against CSC ({doc}`preparing-a-store`).

```{tip}
**You usually do not need to do anything.** anndata 0.12 with zarr 3 already chooses chunks
of this shape: (15625, 79) for 1M × 5,000 and (6250, 125) for 200,000 × 2,000. Rechunk only
stores written by other tools or older versions, in particular any with **whole-gene chunks**
(all cells × a few genes), which are common and are the slow case.
```

## Measured

The figure was measured for these docs through AnnZarro itself on this branch: one synthetic
200,000 × 2,000 float32 layer written five times with different chunks, read with the binary
transfer the browser uses. Each point is the median of 15 requests, each for a new random gene
or cell; whiskers are the interquartile range (too small to see for most points).

```{figure} ../_static/figures/chunk-sweep.svg
:alt: Scatter of time for one cell row against time for one gene column, log axes. Whole-gene chunks (200000 x 8) are fastest for a gene column at 13 ms but slowest for a cell row at 129 ms. Whole-cell chunks (256 x 2000) are the reverse, 193 ms per gene column and 4 ms per cell row. Square (1024 x 1024) is 83 ms and 6 ms. The aspect rule (8192 x 64, filled point) and the anndata default (6250 x 125) sit near the origin at 16 and 12 ms, and 22 and 9 ms.
:width: 85%

**Chunk shape decides which click is slow.** The aspect-rule shape (filled) and anndata's
default keep both reads near 10-20 ms. Whole-gene chunks make a cell row 10× slower; square
and whole-cell chunks make a gene column 5-12× slower. Apple M3 Max, local NVMe, page cache
warm, localhost. Script: `docs/_tools/bench_chunks.py`; data: `docs/_tools/data/chunk_sweep.csv`.
```

| Chunks | Gene column | Cell row |
|---|---|---|
| (200000, 8) whole-gene | 13 ms | 129 ms |
| (8192, 64) aspect rule | 16 ms | 12 ms |
| (6250, 125) anndata default | 22 ms | 9 ms |
| (1024, 1024) square | 83 ms | 6 ms |
| (256, 2000) whole-cell | 193 ms | 4 ms |

The penalty grows with the matrix. At 200,000 cells a whole-gene layer costs 129 ms per cell
row with the files in the page cache. The paper measured the same layout at 1.17 million cells
on an HPC node with a cold cache: **45 s** for one cell row, against 0.41 s after rechunking to
(4096, 64) (provisional HPC numbers; {doc}`../reference/performance`). On the paper's laptop
sweep at 1M × 5,000, whole-gene (n, 64) chunks needed 2.86 s and 12 GB of server memory for a
cell row, enough to swap a 16 GB laptop.

At the size of the demonstration data the choice matters little. Direct zarr reads of the
8,090 × 16,285 fold-change layer, from the paper's validation:

| Chunks | Gene column | Cell row |
|---|---|---|
| (1024, 1024), as published | 5.2 ms | 9.8 ms |
| (256, 256) | 6.0 ms | 11.4 ms |
| (4096, 4096) | 59 ms | 61 ms |
| (64, 16285) | 62 ms | 4.2 ms |
| (8090, 64) | 2.1 ms | 70 ms |
| one chunk | 457 ms | 458 ms |

## Rechunking an existing store

Rewrite only the dense 2-D arrays, then re-consolidate. `use_consolidated=False` and the final
`consolidate_metadata` are both required ({doc}`preparing-a-store` shows what breaks without
them).

```python
import anndata as ad, numpy as np, scipy.sparse as sp, zarr

path = "datasets/atlas.zarr"
adata = ad.read_zarr(path)          # or read only the arrays you rewrite
g = zarr.open_group(path, mode="r+", use_consolidated=False)
for slot in ("layers", "obsp", "varp"):
    for key, arr in getattr(adata, slot).items():
        if sp.issparse(arr) or np.ndim(arr) != 2:
            continue
        chunks = layer_chunks(*arr.shape) if slot == "layers" else (max(1, 10**6 // arr.shape[1]), arr.shape[1])
        ad.io.write_elem(g[slot], key, np.asarray(arr, dtype=np.float32),
                         dataset_kwargs={"chunks": chunks})
zarr.consolidate_metadata(path)
```

`ad.read_zarr` loads the arrays into memory. For a store larger than RAM, copy one array at a
time with zarr (`zarr.open_array` on the source, `zarr.create_array` with the new `chunks`,
then copy in blocks of whole chunk rows) and keep the `.zattrs` (`encoding-type: array`,
`encoding-version: 0.2.0`) so anndata and AnnZarro still recognise it.

```{note}
`adata.write_zarr(path, chunks=...)` applies `chunks` to `X` only, not to layers or pairwise
matrices.
```
