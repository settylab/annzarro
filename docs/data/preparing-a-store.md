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
4. `ad.settings.zarr_write_format = 2; adata.write_zarr("datasets/name.zarr")`, or 3 for fewer
   files when every server runs zarr 3 (Python 3.11 or newer) ({ref}`zarr-format`).
5. Optional: rechunk large dense arrays ({doc}`chunking`), shard them in format 3, and
   re-consolidate.
:::

## General recipe

The script below converts any h5ad. It was run as written, with `ZARR_FORMAT = 2` and
`ZARR_FORMAT = 3`, on a 3,000-cell test file and the resulting stores served by AnnZarro (checked
with the requests at the end of this section).

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

# 3. write (consolidated metadata is written by default)
ZARR_FORMAT = 3   # 2 works everywhere; 3 (sharded below) needs zarr >= 3 (Python 3.11+) on the server
ad.settings.zarr_write_format = ZARR_FORMAT
adata.write_zarr("datasets/my_data.zarr")

# 4. optional: rechunk dense arrays (and in format 3 shard them), then re-consolidate
def layer_chunks(n_obs, n_vars, target=5e5):
    rows = 2 ** round(math.log2(math.sqrt(target * n_obs / n_vars)))
    cols = 2 ** round(math.log2(target / rows))
    return min(rows, n_obs), min(cols, n_vars)

def row_chunks(n, target=1e6):
    return max(1, min(n, int(target // n))), n

def shard_shape(chunks, shape, per_axis):
    """Shards of ``per_axis`` inner chunks along each axis, cut at the array's edge."""
    return tuple(min(c * k, -(-s // c) * c) for c, k, s in zip(chunks, per_axis, shape))

g = zarr.open_group("datasets/my_data.zarr", mode="r+", use_consolidated=False)
for slot in ("layers", "obsp", "varp"):
    for key, arr in getattr(adata, slot).items():
        if sp.issparse(arr) or np.ndim(arr) != 2:
            continue
        chunks = layer_chunks(*arr.shape) if slot == "layers" else row_chunks(arr.shape[1])
        kwargs = {"chunks": chunks}
        if ZARR_FORMAT == 3:    # layers: 4 x 4 chunks per shard; obsp/varp: 16 row blocks, full width
            kwargs["shards"] = shard_shape(chunks, arr.shape, (4, 4) if slot == "layers" else (16, 1))
        ad.io.write_elem(g[slot], key, arr, dataset_kwargs=kwargs)
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

**Format 2 or 3.**
: See {ref}`zarr-format` below.

**Rechunking.**
: Only needed for large dense arrays written by other tools; anndata 0.12 with zarr 3 already
  picks chunks of the right shape. The rule and the measurements are on {doc}`chunking`.

:::{warning}
Step 4 must open the store with `use_consolidated=False` and must end with
`zarr.consolidate_metadata`. Without the first, zarr refuses: `ValueError: Cannot
overwrite/edit a store with consolidated metadata`. Without the second, `.zmetadata` still
describes the old arrays: `anndata.read_zarr` fails with `ValueError: cannot reshape array of
size 512 into shape (300,50)` and AnnZarro refuses that array with `500` `stale_metadata`,
naming the mismatch ("consolidated metadata says chunks (300, 50), the array on disk has
(16, 16)") and the fix (both reproduced with a 300 × 50 store).
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
rewriting a store in place, restart the server or call `POST /api/v1/cache/reset` (admins only
on a shared server).
```

(zarr-format)=
## Zarr format 2 or 3

AnnZarro reads both on-disk formats. Which one a server can read depends on the zarr library it
runs, not on AnnZarro:

| Server's zarr | Python | Reads format 2 | Reads format 3 |
|---|---|---|---|
| 3.0.9 or newer | 3.11 or newer (zarr 3.4 needs 3.12) | yes | yes, plain and sharded |
| 3.0.0 to 3.0.8 | 3.11 | not reliably | no: 3.0.0 to 3.0.2 read sharded arrays wrongly, 3.0.3 to 3.0.8 fail to find some members of consolidated format 2 stores; the package excludes them |
| 2.x | 3.9 and newer | yes | no |

On a zarr 2 server a format 3 store is listed with its error in place of cell and gene counts,
and every data route answers `400` with `"reason": "unsupported_type"` and a sentence that says
what the store is and how to fix it (rewrite it as format 2, or run the server with zarr 3).
The suites also ran on Python 3.11 with zarr 3.0.9, 3.0.10 and 3.1.6 (3.0.0 to 3.0.8 fail as the table says). Both rows were run for this page, with the demonstration store written both ways: zarr 3.4.1 on
Python 3.12 served format 2, plain format 3 and sharded format 3 alike; zarr 2.18.2 on Python 3.9
served format 2 and refused the format 3 stores as described.

**Format 2 is fully supported and is not slower to serve; format 3 is not faster.** On the
demonstration store, on local disk, through the same server and zarr 3.4.1, a request on format 3
took 20 to 70 % more time than on format 2, still tens of milliseconds ({ref}`zarr-format-timing`).
What format 3 gives is far fewer files, with sharding, and that it is where anndata is heading
(0.12 warns that format 2 will stop being the default; 0.13.4 already writes format 3, sharded).

- **Choose format 3** (Python 3.11 or newer on every server that opens the store) when file count
  matters: a network file system, an object store, an archive or a transfer of the store, or when
  you want what anndata writes by default. Size the shards for row reads (below).
- **Choose format 2** when any server that will open the store runs zarr 2 (Python 3.9 or 3.10), when
  another tool you use reads only format 2, or when none of the above applies. It is what the
  paper validated, and the demonstration store is format 2.

```python
import anndata as ad

ad.settings.zarr_write_format = 3        # anndata 0.12; 0.13 writes format 3 without it
adata.write_zarr("datasets/my_data.zarr")
```

This is enough to be served. anndata writes the consolidated metadata AnnZarro reads (0.12.19
prints "Consolidated metadata is currently not part in the Zarr format 3 specification", a
warning that does not matter here). Stores written by anndata 0.12.19 (zarr 3.1.6) and 0.13.4
(zarr 3.4.1) were served and answered every route that was tried.

### Sharding

A format 3 array can be sharded: many chunks are stored in one file, the shard, and the file
carries an index of them. The chunk stays the unit of compression and of reading. The shard is only
the unit of storage. Measured on the demonstration store (8,090 cells, 16,285 genes):

| Store | Files | Size (`du`) |
|---|---|---|
| Format 2, as published | 4,243 | 5.4 GiB |
| Format 3, the same chunks | 3,878 | 5.1 GiB |
| Format 3, sharded as below | 1,024 | 5.1 GiB |

A store with a few hundred files moves faster than one with four thousand: in `rsync`, in an
object store, on a network file system with a slow `ls`. Nothing here measures that; the count is
what sharding changes.

AnnZarro reads a sharded array through zarr's partial reads: the shard's index, then only the
chunks a request needs. Read from a local disk, one row of a (16,000, 16,000) float32 array
with (62, 16,000) chunks in 63 MB shards raised the server's peak memory by 7.3 MB, against
7.2 MB for the same chunks without shards. Over HTTP the same read is a range request for the
index and one for the chunk (about 70 B and 3 kB for one row of a 200 × 200 test matrix, not the
shard file). So size chunks by the rule on {doc}`chunking`, and let the shard be a multiple of the chunk:

- **Chunks inside the shard.** Use the aspect rule for cells × genes layers and whole rows for
  `obsp` / `varp`, exactly as for an unsharded array. The server bounds a pairwise read by the
  chunk, not by the shard (`server.max_read_mb`).
- **Shards.** The demonstration store uses 4 × 4 chunks (2,048 × 4,096 values, 32 MB) for layers
  and 16 row blocks for `obsp` / `varp` (1,968 rows of the 8,090-row matrices, 976 of the 16,285-row
  ones, 61 MB). No other size was compared here. A shard has
  to fit in memory when it is written.

The script under "General recipe" writes exactly this: with `ZARR_FORMAT = 3` it passes `chunks`
and `shards` to `write_elem`. It was run with anndata 0.12.19 and 0.13.4, and the arrays read back
equal. Check what a store has with `array.chunks` (the inner chunk) and `array.shards`
(`None` when unsharded) in zarr 3.

```{note}
anndata 0.13.4 shards by default, with shards of up to 1 GB uncompressed and inner chunks it
picks (506 × 506 for an 8,090 × 8,090 matrix, 509 × 509 for 16,285 × 16,285). Such a store is
served as it is. The server sizes a row of the 16,285 × 16,285 matrix at about 10 MB (ten chunks);
measured over 20 rows of the written store, the process grew by under 7 MB. Before the guard was
changed to size by the chunk, it counted the 1 GB shard (950 MB) and could refuse the row on a small
server. With anndata 0.12.19 the default is format 2, and format 3 is written unsharded unless you
pass `shards`.
```

(zarr-format-timing)=
### What it costs to serve

Measured on the demonstration store with AnnZarro 0.4.2 plus these changes, an Apple M3 Max,
local NVMe, a fresh server per repetition (15 repetitions locally, 5 to 7 over HTTP), medians.
Local disk, zarr 3.4.1 for all three columns (format 2 through zarr 3's format 2 path):

| Request | Format 2 | Format 3 plain | Format 3 sharded |
|---|---|---|---|
| Open, dataset structure | 98 ms | 105 ms | 108 ms |
| Gene column of `X` (CSC) | 16 ms | 20 ms | 23 ms |
| Gene column of a dense layer | 18 ms | 23 ms | 25 ms |
| Cell row of a dense `obsp` | 14 ms | 19 ms | 31 ms |
| Gene row of `varp` | 20 ms | 35 ms | 22 ms |

Format 3 is not faster on a local disk; it is slower by a few milliseconds per request. The
same format 2 store read by zarr 2.18.2 in another environment took 60, 5, 32, 3.5 and 51 ms for the
same five requests, so the library matters as much as the format.

Over HTTP, from a local server that honours `Range`, the sharded store sends far fewer bytes and
files for the pairwise rows (requests the store server saw; bytes it sent):

| Request | Format 2 | Format 3 sharded |
|---|---|---|
| Gene row of `varp` | 16 requests, 58 MB | 2 requests, 3.5 MB |
| Cell row of a dense `obsp` | 1 request, 1.6 MB | 2 requests, 3.4 MB |
| Gene column of a dense layer | 8 requests, 21 MB | 12 requests, 13 MB |
| Gene column of `X` | 3 requests, 1.8 MB | 5 requests, 1.9 MB |

The `obsp` row of this small matrix costs more when sharded because its shard index and chunk are
two requests. With 20 ms added to every request the sharded store was not faster for any request
(`varp` row 60 ms against 70 ms; `X` column 131 ms against 80 ms): on this store the saving is in
bytes and files, not in latency. The store has 4,243 files in format 2, 3,878 in format 3 and 1,024
sharded.

**Remote stores.** A sharded store served over HTTP needs a server that honours the `Range`
header (nginx, Apache, S3, GCS do; `python -m http.server` does not). Without it the first
read fails with a `500` that says so. The remote chunk cache ({doc}`../user-guide/remote-datasets`)
keeps the index and the chunks of a sharded store, so a second row of a chunk already read is not
fetched again (two requests for two rows of one chunk, against four without the cache).

**Converting a format 2 store.** Reading a format 2 store and writing it as format 3 with
anndata (`ad.read_zarr(src).write_zarr(dst)` with `ad.settings.zarr_write_format = 3`) loads the
store into memory. For a store larger than memory, copy array by array with zarr, as in
{doc}`chunking`; the test helper `annzarro/tests/utils/make_fixture_zarr_v3.py` does so in blocks
of whole shard rows and wrote the 5.4 GiB demonstration store in 6 s on an Apple M3 Max. Every
array of both format 3 stores was compared with its source (values, dtypes and attributes, which
hold the sparse, categorical and nullable encodings), anndata decoded every element of both
to the same objects, and every panel set of the tutorials opened and drew from them.

## Where to put the store

`annzarro start --data-dir DIR` lists the datasets at the top level of `DIR` and in
`DIR/datasets/` (without `--data-dir`, `DIR` is `~/annzarro-data`). Deeper folders are not
scanned. An entry is listed when it is a
`.h5ad` file or a directory that looks like a zarr store (a `.zarr` name, a `.zgroup`, or `X`,
`obs`, `var`, `obsm`, `layers` inside) and opens as AnnData. Symbolic links are followed, so
`ln -s /big/disk/atlas.zarr DIR/` works. h5ad files are served directly; see below for when to
convert them.

## h5ad files

An `.h5ad` file opens like a zarr store: every route the web client uses (obs, var, obsm, varm,
obsp and varp rows, X and layers by gene or by cell, uns including nested keys, the dataset
structure) gives the same answers for an h5ad as for the same data in zarr, including the
`format=f32` binary replies. AnnZarro only reads the file; each request opens and closes it, so
gunicorn workers and threads never share an HDF5 handle. Remote `.h5ad` URLs are not supported.

What decides speed is the layout `write_h5ad` leaves:

- **X as CSR** (the usual `write_h5ad` output). A cell row is cheap; a gene column has to scan
  every stored index. On the demonstration data (5.6 GB h5ad) a gene column of X took 167 ms
  from the page cache, and about 1 GB of I/O per gene from a cold disk. **CSC** reverses this.
- **Dense layers** are written contiguous, without chunks. A gene column is then one strided read
  per row: 20 ms for 8,090 x 16,285 and 60 ms for 1M x 200 from the page cache, against 10 ms for
  the same 1M x 200 column stored in chunks. From a cold or network disk a column touches nearly
  every page of the array.

So: h5ad is fine for small data on a local disk. For large data, or data on a network file
system, convert to zarr with X as CSC (as `bm_aging.zarr` is; see the [general recipe](#general-recipe)), or at least write the h5ad with X as CSC and a compression setting, which
makes h5py store dense arrays in chunks:

```python
adata.X = adata.X.tocsc()
adata.write_h5ad("atlas.h5ad", compression="gzip")
```

These numbers were measured on the h5ad written from the demonstration data, in the pull
request that made h5ad reads lazy (settylab/annzarro#51). On this branch, a gene column of X from
`murine_bone_marrow_aging_processed.h5ad` (CSR) took 190-220 ms per request and a cell row 2 ms,
from the page cache.

Two more cases:

- An `.h5ad` written by anndata older than 0.7 (obs and var as compound datasets) is refused with
  `400 unsupported_type` and the message "This .h5ad was written by anndata older than 0.7 …
  Re-save it with a current anndata: anndata.read_h5ad(path).write_h5ad(new_path)."
- On file systems that refuse HDF5's file locks (some Lustre and NFS mounts: "unable to lock
  file, errno = 38"), AnnZarro opens the file again without locking. It never writes, so this is
  safe.

## The Procedure's steps for the demonstration data

The paper's Procedure (Steps 3-10) builds `bm_aging.zarr` from the Kompot tutorial data. The
paper budgets about 10 minutes on a 16-core workstation with 32 GB RAM, most of it the 2.4 GB
download.

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

{download}`bm_aging.py <../_tools/datasets/bm_aging.py>` (in this repository's
`docs/_tools/datasets/`) runs all of them, with the versions the paper validated
({doc}`demo-data`):

```bash
pip install kompot==0.8.0 palantir==1.4.5 mellon==1.7.1 anndata==0.12.19 zarr==3.1.6 \
    numpy==2.4.6 scipy==1.17.1
python bm_aging.py --workdir bm_aging     # Steps 3-10; writes bm_aging/bm_aging.zarr
```

Measured run (Apple M3 Max, 128 GB, local NVMe): 3 min 51 s in all, of which the download took
2 min and Kompot 59 s, with a peak of 30.0 GB. Memory is dominated by the float64 Kompot layers
of the 5.6 GB processed h5ad; plan for 32 GB at this size.

```{note}
The published `bm_aging.zarr` was made before the Procedure text settled on the aspect rule,
so its dense arrays have (1024, 1024) chunks and `logged_counts` is still CSR. Both are fine at
8,090 cells ({doc}`chunking`). The current Procedure text gives (512, 1024) for these layers and
converts `logged_counts` to CSC, as `bm_aging.py` does.
```
