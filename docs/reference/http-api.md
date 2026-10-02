# HTTP API

The web client talks to the server only through the JSON/binary API under `/api/v1`. The same
API is open to scripts: anything the browser can show, `curl` or Python can fetch. It is
read-only for data; the only writes are panel sets.

Every endpoint, parameter and status code below was checked against the code and called against
a server started with

```bash
annzarro start --host 127.0.0.1 --port 8812 --no-browser --auth-disabled \
    --data-dir ~/gits/annzarro-paper/data
```

on the demonstration store `bm_aging.zarr` (8,090 cells × 16,285 genes). Outputs are copied
from those calls; long paths are shortened to `$DS`.

## Conventions

`dataset_path`
: Every data route takes the dataset as a query parameter: an absolute local path to a
  `.zarr` directory or `.h5ad` file, or a remote zarr URL (`s3://`, `gs://`, `https://`; see
  {doc}`../user-guide/remote-datasets`). On a hosted server (login on, or listening beyond
  localhost) local paths must resolve inside the data directory, otherwise `403`
  `outside_data_dir`.

`rows`, `cols`
: Positional indices, comma-separated (`rows=2089` or `cols=1,5,9`) or a JSON list
  (`cols=[1,5,9]`). Rows index cells (for `obsp`, `X`, layers, `obsm`, `obs`) or genes (for
  `varp`, `varm`, `var`); columns index genes for `X` and layers. Omitted means all. A parameter
  that is present but not a list of non-negative integers (`rows=`, `cols=abc`, `cols=-1`) is
  refused with `400` `bad_indices`; it is never widened to "everything". An index at or beyond
  the length of its axis is refused with `400` `index_out_of_range`.

`format=f32`
: Ask for the binary encoding of a numeric slice ({doc}`wire-format`). Accepted on `/data/X`,
  `/data/layer/<k>`, `/data/obsm/<k>`, `/data/varm/<k>`, `/data/obsp/<k>`, `/data/varp/<k>`, and on
  `/data/obs` and `/data/var` when exactly one column is requested. Non-numeric slices answer JSON
  regardless; check `Content-Type`.

Errors
: JSON `{"error": "<sentence>", "reason": "<code>", ...}`. `reason` is machine-readable (table
  below); older routes send only `error`.

Authentication
: With login enabled, every route except `/login` and `/logout` needs the session cookie set
  by `POST /login` (form fields `username`, `password`); without it API routes answer `401`
  `{"error": "Authentication required"}` before anything else is checked. See the note on
  `/auth/token` below.

Cross-origin requests
: No `Access-Control-Allow-Origin` header is sent unless `server.cors_enabled` is set; then it
  applies to `/api/*` for the origins in `server.cors_origins` ({doc}`configuration`).

## Data slices

These are the routes one click uses. All are `GET`, all accept `If-None-Match` and answer
`304` when the store has not changed ({doc}`wire-format`).

| Route | Slice | Typical request (one click) | Path value |
|---|---|---|---|
| `/data/layer/<key>` | `layers[key]` | `cols=<gene>` (Cell Plot colour) or `rows=<cell>` (Gene Plot colour) | layer name |
| `/data/X` | `X` | `cols=<gene>` or `rows=<cell>` | none |
| `/data/obsp/<key>` | `obsp[key]` | `rows=<cell>` | obsp key |
| `/data/varp/<key>` | `varp[key]` | `rows=<gene>` | varp key |
| `/data/obsm/<key>` | `obsm[key]` | `column_name=0` (one axis; the web client names the column, which also works for dataframe-valued keys) or `cols=0` | obsm key |
| `/data/varm/<key>` | `varm[key]` | `cols=<i>`; `column_name=` | varm key |
| `/data/obs` | `obs` columns | `columns=<name>[,<name>...]`, optional `rows=`, `include_categories=false` | none |
| `/data/var` | `var` columns | `columns=<name>[,...]`, optional `cols=` (gene indices) | none |
| `/data/uns/<key>` | one `uns` entry, decoded: string, number, list or (for a group) a dict | `/data/uns/leiden_colors`, `/data/uns/neighbors/params/n_neighbors` | uns key, `/` for nesting |

JSON replies are `{"data": ..., <identifying fields>}`. A 2-D slice keeps its shape (a gene
column is a list of one-element lists); `obs`/`var` reply `{"data": {"<column>": [...]}}` plus
`"categories": {"<column>": [...]}` for categoricals.

```console
$ curl -s "http://127.0.0.1:8812/api/v1/data/obsm/X_umap?dataset_path=$DS&rows=2089"
{"data":[[15.542579,-0.469834]],"obsm_key": "X_umap", "dataset_path": "$DS"}

$ curl -s "http://127.0.0.1:8812/api/v1/data/obs?dataset_path=$DS&columns=kompot_da_Young_to_Old_lfc_zscore&rows=2089,4236"
{"data":{"kompot_da_Young_to_Old_lfc_zscore":[10.990220651790553,-3.3363849826473744]},"dataset_path":"$DS"}

$ curl -s -D - -o fc.bin "http://127.0.0.1:8812/api/v1/data/layer/kompot_de_Young_to_Old_fold_change?dataset_path=$DS&cols=2551&format=f32"
HTTP/1.1 200 OK
X-Annzarro-Shape: 8090,1
X-Annzarro-Dtype: float32
Access-Control-Expose-Headers: X-Annzarro-Shape, X-Annzarro-Dtype, X-Annzarro-Encoding, X-Annzarro-Nnz, ETag
X-Annzarro-Encoding: dense
Content-Type: application/octet-stream
Content-Length: 32360
ETag: W/"bacbfc34ca6b53360c0b06d1992739a6767bfba0"
Cache-Control: private, no-cache
```

(Server and Date headers omitted.) 32,360 bytes = 8,090 float32 values.

### From Python

A complete client for numeric slices, run against the demonstration store:

```python
import numpy as np
import requests

BASE = "http://127.0.0.1:8812/api/v1"
STORE = "/path/to/bm_aging.zarr"


def get_slice(route, **params):
    """One slice of a matrix as a dense numpy array, via the binary encoding."""
    r = requests.get(f"{BASE}/data/{route}",
                     params={"dataset_path": STORE, "format": "f32", **params})
    r.raise_for_status()
    if not r.headers["Content-Type"].startswith("application/octet-stream"):
        return r.json()["data"]                      # not numeric: JSON fallback
    shape = tuple(int(d) for d in r.headers["X-Annzarro-Shape"].split(","))
    dtype = "<f4" if r.headers["X-Annzarro-Dtype"] == "float32" else "<f8"
    if r.headers["X-Annzarro-Encoding"] == "dense":
        return np.frombuffer(r.content, dtype=dtype).reshape(shape)
    nnz = int(r.headers["X-Annzarro-Nnz"])
    width = np.dtype(dtype).itemsize
    values = np.frombuffer(r.content, dtype=dtype, count=nnz)
    positions = np.frombuffer(r.content, dtype="<u4", count=nnz, offset=nnz * width)
    out = np.zeros(int(np.prod(shape)), dtype=dtype)
    out[positions] = values
    return out.reshape(shape)


genes = requests.get(f"{BASE}/data/genes", params={"dataset_path": STORE}).json()["genes"]
g = genes.index("S100a9")
fc = get_slice("layer/kompot_de_Young_to_Old_fold_change", cols=g)
print("S100a9 fold change:", fc.shape, fc.dtype, round(float(fc.min()), 3), round(float(fc.max()), 3))

kernel_row = get_slice("obsp/DM_Kernel", rows=2089)
print("DM_Kernel row of cell 2089:", kernel_row.shape, kernel_row.dtype, "non-zero:", np.count_nonzero(kernel_row))

age = get_slice("obs", columns="Age")
print("Age (categorical, JSON fallback):", type(age).__name__, age["Age"][:3])
```

```text
S100a9 fold change: (8090, 1) float32 -1.458 0.314
DM_Kernel row of cell 2089: (1, 8090) float64 non-zero: 31
Age (categorical, JSON fallback): dict ['Young', 'Young', 'Young']
```

`DM_Kernel` is stored as float64 and its values do not survive a round trip through float32,
so it travels as float64; the 31 non-zeros arrive as 372 bytes.

## Dataset discovery and structure

| Route | Returns |
|---|---|
| `GET /datasets` | list of `{name, path, rel_path, cells, genes, is_link}` for the data directory (from `<data_dir>/datasets/` if it exists); a store the server's zarr cannot read is listed with `cells: null` and an `error` sentence |
| `GET /data/dataset_structure?dataset_path=` | everything the menus need: `shape`, `n_obs`, `n_vars`, and per slot `available`, `keys` / `columns`, `info` (shape and type per key), `columns_info` (dtype per obs/var column), dataframe columns of `obsm`/`varm`. A store without `X` has `"X": {"available": false, "shape": null}` |
| `GET /data/info?dataset_path=` | a shorter summary: `shape`, `has_*` flags, `obs_columns`, `var_columns`, `layers`, `embeddings` |
| `GET /data/genes?dataset_path=` | `{"genes": [...], "dataset_path": ...}`, all `var_names` (146 kB here) |
| `GET /data/cells?dataset_path=` | `{"cells": [...], ...}`, all `obs_names` (275 kB here; 36 MB at 1.17M cells) |
| `GET /data/obsm_dataframe_columns?dataset_path=&key=` | `{"columns": [...]}` of a dataframe-valued obsm entry |
| `GET /data/varm_dataframe_columns?dataset_path=&key=` | the same for varm |

```console
$ curl -s "http://127.0.0.1:8812/api/v1/datasets" | python -m json.tool | head -9
[
    {
        "cells": 8090,
        "genes": 16285,
        "is_link": false,
        "name": "bm_aging.zarr",
        "path": "/Users/dotto/gits/annzarro-paper/data/bm_aging.zarr",
        "rel_path": "bm_aging.zarr"
    },
```

## Panel sets

Panel sets are JSON files in `<data_dir>/sessions/`, shared by all users of a server
({doc}`../user-guide/panel-sets`). With login on, deleting, renaming or overwriting is limited
to the owner and admins; a refusal is `403` with `reason` `not_owner` or `legacy_admin_only`.

| Route | Parameters | Returns |
|---|---|---|
| `GET /sessions/list` | | list of `{name, file, dataset, datasetName, timestamp, owner, can_modify, ...}` |
| `GET /sessions/load` | `name` or `file` | the stored panel set; `404` if absent |
| `GET /sessions/exists` | `name` | `{exists, file, sanitized_name, owner, can_modify}` |
| `GET /sessions/export` | `name` or `file` | the panel set as an indented JSON download |
| `POST /sessions/save` | JSON body with `name` (and the panel set) | `{status, message, file, sanitized_name}` |
| `POST /sessions/rename` | JSON `{old_name, new_name}` | |
| `POST /sessions/duplicate` | JSON `{source_name, new_name}` | |
| `POST /sessions/import` | multipart `file` (.json), optional `name`, `overwrite` | |
| `POST /sessions/owner` | JSON `{name, owner}`; admin only | |
| `DELETE /sessions/delete` | `name` or `file` | `{status, message}` |

Names are sanitised to letters, digits, space, `_` and `-`. Save, exists, delete and load
were exercised in that order: `200`, `200`, `200`, then `404` for the deleted set.

## Server

| Route | Returns |
|---|---|
| `GET /auth/me` | `{auth_enabled, username, is_admin, exposed}`; `exposed` is true when the server listens beyond localhost with login off |
| `GET /config` | the public part of the configuration (UI defaults, branding, login settings) |
| `GET /status` | version, uptime, memory, data directory checks |
| `GET /cache/info` | the server's result cache: datasets, items, `memory_usage_mb`, `max_memory_mb` |
| `POST /cache/reset` | clear it, for all datasets or `?dataset_path=`. On a shared server admins only (`403 admin_only` otherwise). Each gunicorn worker has its own cache; this clears only the worker that answers |
| `GET /directories/home`, `GET /directories/list?path=` | the data directory and its entries (dataset browser) |
| `GET /zarr/url?url=` | whether a URL is an acceptable remote store |
| `POST /auth/token` | see the note below |

```{warning}
`POST /api/v1/auth/token` issues a JWT, but no route accepts it: `Authorization: Bearer <token>`
is answered `401`, and the token route itself requires the session cookie. It exists only when
login is on. For scripted access to a server with login on, log in through the form and reuse
the cookie: `curl -c jar -d "username=...&password=..." https://host/login`, then
`curl -b jar ...`.
```

Also registered but not used by the web client: `/data/paginated`, `/data/statistics`,
`/data/by_path`, `/core/datasets`, `/zarr/to_anndata`, and the path-segment forms
`/datasets/<path>`, `/datasets/<path>/info`, `/datasets/<path>/uns/...`. In the path-segment
forms `<path>` is relative to the data directory (`/datasets/bm_aging.zarr`,
`/datasets/bm_aging.zarr/uns/neighbors/params`); a path that does not exist is `404 not_found`,
one that is not a dataset `400 unsupported_type`.

## Status codes

| Status | `reason` | When |
|---|---|---|
| 200 | | the slice, as JSON or binary |
| 304 | | `If-None-Match` matched: same URL, store unchanged |
| 400 | `bad_indices` | `rows`/`cols` present but not a list of non-negative integers |
| 400 | `index_out_of_range` | an index at or beyond the length of its axis |
| 400 | `cap_exceeded` | more indices than the client's own `max_cells=` / `max_genes=` parameter (below) |
| 400 | `unsupported_type` | not a `.zarr`/`.h5ad`, or a zarr format the server's zarr cannot read |
| 400 | (none) | a required parameter is missing, e.g. `{"error":"dataset_path parameter is required"}` |
| 401 | (none) | login on, no session; checked first |
| 403 | `outside_data_dir` | hosted server, local path outside the data directory and `allowed_dirs` (the message names no server directories) |
| 403 | `access_denied` | remote store refused by the remote-store policy |
| 403 | `not_owner`, `legacy_admin_only`, `admin_only` | panel-set permissions; `admin_only` also for `POST /cache/reset` on a shared server |
| 404 | `not_found` | dataset path does not exist; panel set not found (no `reason`) |
| 404 | `key_not_found` | a layer, obsm, varm, obsp, varp or uns key, or an obs/var column, that the dataset does not have; `X` in a store without `X` |
| 413 | `response_too_large` | the slice exceeds `max_response_elements` (below) |
| 500 | `stale_metadata` | the store's consolidated metadata (`.zmetadata`) no longer matches an array on disk, usually after an in-place rewrite. Re-consolidate (`zarr.consolidate_metadata(path)`), then `POST /cache/reset` or restart |
| 500 | `read_failed` | any other failure to read an array the store lists, with the exception text |
| 501 | `missing_dependency` | a remote store without the `annzarro[remote]` extras |
| 504 | `remote_timeout` | a remote store did not answer in time |

```console
$ curl -s -w "\nHTTP %{http_code}\n" "http://127.0.0.1:8812/api/v1/data/layer/kompot_de_Young_to_Old_fold_change?dataset_path=$DS"
{"error":"Response too large: 8090 x 16285 = 131745650 elements requested from layer/kompot_de_Young_to_Old_fold_change; the limit is 10000000 (max_response_elements). Request one row or column, or fewer of them.","limit":10000000,"reason":"response_too_large","requested":131745650,"shape":[8090,16285]}
HTTP 413

$ curl -s -w "\nHTTP %{http_code}\n" "http://127.0.0.1:8812/api/v1/data/X?dataset_path=$DS&rows=&cols=1"
{"error":"Invalid index list '': expected comma-separated integers","reason":"bad_indices"}
HTTP 400

$ curl -s -w "\nHTTP %{http_code}\n" "http://127.0.0.1:8812/api/v1/data/obs?dataset_path=/nope/nothing.zarr"
{"error":"Dataset not found: /nope/nothing.zarr","exception":"FileNotFoundError","reason":"not_found"}
HTTP 404

$ curl -s -w "\nHTTP %{http_code}\n" "http://127.0.0.1:8812/api/v1/data/layer/nope?dataset_path=$DS&cols=1"
{"error":"No layers key 'nope' in this dataset.","reason":"key_not_found"}
HTTP 404

$ curl -s -w "\nHTTP %{http_code}\n" "http://127.0.0.1:8812/api/v1/data/obsp/DM_Kernel?dataset_path=$DS&rows=8090"
{"error":"rows index 8090 is out of range: this axis has 8090 entries (0-8089).","reason":"index_out_of_range"}
HTTP 400
```

## Limits

| Setting or parameter | Default | Checked against | Error |
|---|---|---|---|
| `server.max_response_elements` | 10,000,000 | rows × cols of the slice, from metadata, before reading | `413 response_too_large` |
| `max_cells=` / `max_genes=` query parameters | none | number of requested cell / gene indices | `400 cap_exceeded` |

One full row or one full column always passes the size guard, at any dataset size: that is the
unit every view asks for. `max_cells=` and `max_genes=` are the client's own guard against
asking for more than it can draw (the web client sends its `ui.defaults.max_cells` /
`max_genes`); they are not a server limit, and a request without them is not capped.
