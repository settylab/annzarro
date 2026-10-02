# Preparing a store

AnnZarro reads AnnData objects written as zarr stores (or local `.h5ad` files). Preparing a
store is a few lines of anndata code, run once, after your analysis. This page gives the
general recipe, then the exact steps the paper's Procedure uses for the demonstration data.

:::{admonition} The short version
:class: tip

1. Put everything you want to see in the right slot ({doc}`slot-map`): coordinates in `obsm`,
   annotations in `obs`, per-gene statistics in `var`, cells × genes matrices in `layers`,
   pairwise matrices in `obsp` / `varp`.
2. Cast float arrays to float32.
3. Store sparse layers you colour cells by as CSC.
4. `ad.settings.zarr_write_format = 2; adata.write_zarr("datasets/name.zarr")`.
5. Optional: rechunk large dense arrays ({doc}`chunking`) and re-consolidate.
:::

## General recipe

The script below converts any h5ad. It was run as written on a 3,000-cell test file and the
resulting store served by AnnZarro (checked with the requests at the end of this section).

```python
import math
import anndata as ad
import numpy as np
import scipy.sparse as sp
import zarr

adata = ad.read_h5ad("my_data.h5ad")

# 1. float32 for every float array AnnZarro slices, dense or sparse
for slot in ("layers", "obsp", "varp", "obsm"):
    for key, arr in getattr(adata, slot).items():
        if getattr(arr, "dtype", None) == np.float64:
            getattr(adata, slot)[key] = arr.astype(np.float32)

# 2. CSC for sparse layers you colour cells by (gene columns)
adata.layers["logged_counts"] = sp.csc_matrix(adata.layers["logged_counts"], dtype=np.float32)

# 3. write zarr format 2 (consolidated metadata is written by default)
ad.settings.zarr_write_format = 2
adata.write_zarr("datasets/my_data.zarr")

# 4. optional: rechunk dense arrays, then re-consolidate
def layer_chunks(n_obs, n_vars, target=5e5):
    rows = 2 ** round(math.log2(math.sqrt(target * n_obs / n_vars)))
    cols = 2 ** round(math.log2(target / rows))
    return min(rows, n_obs), min(cols, n_vars)

def row_chunks(n, target=1e6):
    return max(1, min(n, int(target // n))), n

g = zarr.open_group("datasets/my_data.zarr", mode="r+", use_consolidated=False)
for slot in ("layers", "obsp", "varp"):
    for key, arr in getattr(adata, slot).items():
        if sp.issparse(arr) or np.ndim(arr) != 2:
            continue
        chunks = layer_chunks(*arr.shape) if slot == "layers" else row_chunks(arr.shape[1])
        ad.io.write_elem(g[slot], key, arr, dataset_kwargs={"chunks": chunks})
zarr.consolidate_metadata("datasets/my_data.zarr")
```

What each step buys:

**float32.**
: Halves storage and the bytes decompressed per click, and lets the server send 4 bytes per
  value. A float64 array whose values are not exactly representable in float32 travels as
  float64 ({doc}`../reference/wire-format`). On the demonstration data, casting the three
  float64 Kompot layers took the store from 6.08 GB to 4.78 GB.

**CSC for gene reads.**
: AnnZarro reads one column of a CSC matrix, or one row of a CSR matrix, without touching the
  rest (`zarr_reader._lazy_sparse_slice`). The other direction loads every non-zero of the
  matrix. Measured through the server on the demonstration store: a gene column of the CSR
  `logged_counts` layer takes 72 ms, a gene column of a dense layer 12 ms, and a cell row of the
  CSC `X` 215 ms against 12 ms for its gene column ({doc}`../reference/performance`). A Cell Plot
  coloured by a layer reads gene columns; a Gene Plot coloured by a layer reads cell rows. Pick
  the direction you use most, or store the layer dense if it fits.

**Format 2.**
: See {ref}`zarr-format` below.

**Rechunking.**
: Only needed for large dense arrays written by other tools; anndata 0.12 with zarr 3 already
  picks chunks of the right shape. The rule and the measurements are on {doc}`chunking`.

:::{warning}
Step 4 must open the store with `use_consolidated=False` and must end with
`zarr.consolidate_metadata`. Without the first, zarr refuses: `ValueError: Cannot
overwrite/edit a store with consolidated metadata`. Without the second, `.zmetadata` still
describes the old arrays: `anndata.read_zarr` fails with `ValueError: cannot reshape array of
size 512 into shape (300,50)` and AnnZarro answers `200` with an empty `data` list for that
array (both reproduced with a 300 × 50 store).
:::

Check the result before you serve it. This prints what AnnZarro will slice:

```python
import zarr

def describe_store(path):
    """Print encoding, shape, dtype and chunks of every 2-D array AnnZarro reads by slice."""
    root = zarr.open_group(path, mode="r")
    print("zarr format:", root.metadata.zarr_format)
    for slot in ("X", "layers", "obsp", "varp"):
        if slot not in root:
            continue
        nodes = [("X", root["X"])] if slot == "X" else list(root[slot].members())
        for name, node in nodes:
            label = "X" if slot == "X" else f"{slot}/{name}"
            enc = node.attrs.get("encoding-type")
            if enc in ("csr_matrix", "csc_matrix"):
                shape, dtype = tuple(node.attrs["shape"]), node["data"].dtype
                print(f"{label:45s} {enc:10s} {str(shape):16s} {dtype}")
            else:
                print(f"{label:45s} {'dense':10s} {str(node.shape):16s} {node.dtype}  chunks {node.chunks}")

describe_store("bm_aging.zarr")
```

On the demonstration store it prints:

```text
zarr format: 2
X                                             csc_matrix (8090, 16285)    float32
layers/cc_counts                              csr_matrix (8090, 16285)    float32
layers/kompot_de_Old_smoothed                 dense      (8090, 16285)    float32  chunks (1024, 1024)
layers/kompot_de_Young_smoothed               dense      (8090, 16285)    float32  chunks (1024, 1024)
layers/kompot_de_Young_to_Old_fold_change     dense      (8090, 16285)    float32  chunks (1024, 1024)
layers/logged_counts                          csr_matrix (8090, 16285)    float32
layers/MAGIC_imputed_data                     dense      (8090, 16285)    float32  chunks (1024, 1024)
layers/normalized_counts                      csr_matrix (8090, 16285)    float32
layers/raw_counts                             csr_matrix (8090, 16285)    float32
obsp/connectivities                           csr_matrix (8090, 8090)     float32
obsp/diffusion_walk_t5                        dense      (8090, 8090)     float32  chunks (1024, 1024)
obsp/distances                                csr_matrix (8090, 8090)     float64
obsp/DM_Kernel                                csr_matrix (8090, 8090)     float64
obsp/DM_Similarity                            csr_matrix (8090, 8090)     float64
varp/spearman_fold_change                     dense      (16285, 16285)   float32  chunks (1024, 1024)
varp/spearman_smoothed                        dense      (16285, 16285)   float32  chunks (1024, 1024)
```

Then ask a running server for one slice of each array you care about. Every reply should be
`200` with the shape you expect (see {doc}`../reference/http-api`):

```console
$ B=http://127.0.0.1:8812/api/v1/data; S=$PWD/datasets/my_data.zarr
$ curl -s -D - -o /dev/null "$B/layer/smoothed?dataset_path=$S&rows=5&format=f32" | grep -i '^x-annzarro'
X-Annzarro-Shape: 1,2000
X-Annzarro-Dtype: float32
X-Annzarro-Encoding: dense
$ curl -s -D - -o /dev/null "$B/obsp/connectivities?dataset_path=$S&rows=5&format=f32" | grep -i '^x-annzarro'
X-Annzarro-Shape: 1,3000
X-Annzarro-Dtype: float32
X-Annzarro-Encoding: sparse
X-Annzarro-Nnz: 9
```

```{note}
The server caches what it read and assumes stores do not change while it runs. After
rewriting a store in place, restart the server or call `POST /api/v1/cache/reset`.
```

(zarr-format)=
## Zarr format 2 or 3

Write **format 2** (`ad.settings.zarr_write_format = 2`). It is what the paper validated and
what every AnnZarro installation reads. anndata 0.12 warns that format 2 will stop being the
default in its next minor release; set it explicitly.

Format 3 status, measured on this branch: the reader opens a format 3 store when the server's
zarr library is version 3 or later. A 300 × 50 store written with
`ad.settings.zarr_write_format = 3` served layers, `obsm` and the structure endpoint correctly
under zarr 3.1.6. A server running zarr 2 cannot read format 3. According to the code
(`zarr_reader.zarr_format_problem`, `data_routes._reader_error_response`), the dataset list then
shows the store with the reason and the fix, and data routes answer `400` with
`"reason": "unsupported_type"` and the same sentence; this path was not run here, because the
docs environment has zarr 3. AnnZarro's own dependency is `zarr>=2.13`, so which case
you are in depends on the environment.

## Where to put the store

`annzarro start --data-dir DIR` lists datasets from `DIR/datasets/` if that folder exists,
otherwise from `DIR` itself. Only the first level is scanned. An entry is listed when it is a
`.h5ad` file or a directory that looks like a zarr store (a `.zarr` name, a `.zgroup`, or `X`,
`obs`, `var`, `obsm`, `layers` inside) and opens as AnnData. Symbolic links are followed, so
`ln -s /big/disk/atlas.zarr DIR/` works. h5ad files are served directly, but their sparse
matrices are loaded whole on first access; convert anything large to zarr.

## The Procedure's steps for the demonstration data

The paper's Procedure (Steps 3-10) builds `bm_aging.zarr` from the Kompot tutorial data. The
companion repository runs them as scripts; about 10 minutes on a 16-core workstation with
32 GB RAM, most of it the 2.4 GB download.

```{list-table}
:header-rows: 1
:widths: 10 50 40

* - Step
  - What
  - Where it is explained
* - 3
  - Download `murine_bone_marrow_aging.h5ad` from Zenodo {cite:p}`zenodo_bm_aging` and check its
    md5 `3e346c91e029e5fde551a9ebf9ecee78`
  - {doc}`demo-data`
* - 4
  - Run Kompot differential abundance and expression, Young vs Old, **without**
    `kompot.cleanup()`
  - {doc}`kompot`
* - 5
  - Read Kompot's output keys from `uns[...]["last_run_info"]` (a JSON string)
  - {doc}`kompot`
* - 6
  - Add a dense five-step diffusion walk to `obsp`
  - {doc}`pairwise-matrices`
* - 7
  - Add two gene × gene Spearman matrices to `varp`
  - {doc}`pairwise-matrices`
* - 8
  - Cast to float32; X and `logged_counts` to CSC
  - this page
* - 9
  - Write zarr format 2
  - this page
* - 10
  - Optional rechunk and re-consolidate
  - {doc}`chunking`
```

Commands, from the root of the companion repository `settylab/annzarro-paper`:

```bash
N=16 data_prep/download_data.sh data                         # Step 3
python data_prep/run_kompot.py                               # Step 4, writes the processed h5ad
python data_prep/prepare_annzarro_store.py \
    --input data/murine_bone_marrow_aging_processed.h5ad \
    --output data/bm_aging.zarr --report data/prepare_report.json   # Steps 5-10
```

Measured run (Apple M3 Max, 128 GB, local NVMe): `run_kompot.py` 62 s with a 29 GB peak,
`prepare_annzarro_store.py` 51 s with a 24.6 GB peak. Memory is dominated by the float64
Kompot layers of the 5.6 GB h5ad; plan for 32 GB at this size.

```{note}
The published `bm_aging.zarr` was made before the Procedure text settled on the aspect rule,
so its dense arrays have (1024, 1024) chunks and `logged_counts` is still CSR. Both are fine at
8,090 cells ({doc}`chunking`). The current Procedure text gives (512, 1024) for these layers and
converts `logged_counts` to CSC.
```
