# HTTP API

The web client talks to the server only through the JSON/binary API under `/api/v1`. The same
API is open to scripts: anything the browser can show, `curl` or Python can fetch. It is
read-only for data; the only writes are panel sets.

Every endpoint, parameter and status code below was checked against the code and called against
a server started with

```bash
annzarro start --host 127.0.0.1 --port 8812 --no-browser --auth-disabled \
    --data-dir ~/annzarro-data
```

on the demonstration store `bm_aging.zarr` (8,090 cells × 16,285 genes). Outputs are copied
from those calls; long paths are shortened to `$DS`.

## Conventions

Paths
: Every route below is under `/api/v1`. On a server mounted under a path
  (`server.url_prefix`, {doc}`../deployment/lab-server`) they are under `<prefix>/api/v1`.

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

`dataset_rows`
: Rows of the dataset, in the same forms as `rows`, on `/data/X`, `/data/layer/<k>`,
  `/data/obs`, `/data/obsm/<k>` and `/data/obsp/<k>`. It differs from `rows` only under a cell
  subset, where `rows` are positions among the cells shown and `dataset_rows` can name a cell
  the subset does not show ({ref}`http-outside-cells`). It is checked against the dataset's
  cell count. Sending it with `rows` is `400 rows_conflict`; any other data route refuses it
  with `400 dataset_rows_unsupported` instead of ignoring it.

`format=f32`
: Ask for the binary encoding of a numeric slice ({doc}`wire-format`). Accepted on `/data/X`,
  `/data/layer/<k>`, `/data/obsm/<k>`, `/data/varm/<k>`, `/data/obsp/<k>`, `/data/varp/<k>`, and on
  `/data/obs` and `/data/var` when exactly one column is requested. Non-numeric slices answer JSON
  regardless; check `Content-Type`.

`categorical=codes`
: With `format=f32` on `/data/obs` or `/data/var` and one column that is categorical: the column
  as integer codes plus its category list, one byte per cell up to 128 categories
  ({ref}`categorical-codes`). Without it a categorical column answers JSON, as it always has.

`categories=used` or `categories=ranked`
: On `/data/obs` and `/data/var` with one categorical column and `categorical=codes`. `used`: only
  the categories the returned rows use, the codes renumbered into them; the reply says the
  column's count (`X-Annzarro-Categories-Total`, or `n_categories` in JSON). A column with more
  than 65,536 categories is always answered the `used` way. `ranked`: no labels; each row's
  category is sent as its rank in the whole column, most cells first, ties in stored order
  (`X-Annzarro-Categories-Order: ranked`, `X-Annzarro-Categories-Used` categories used in the
  whole column). The ranking is computed once per store and column and cached (512 MB at most);
  the web client colours a column of more than 64 categories by rank mod 64
  ({ref}`categorical-codes`, {ref}`many-categories`).

`category_ranks=r1,r2,...`
: On `/data/obs` and `/data/var` with one categorical column: JSON
  `{"column", "ranks", "labels"}`, the labels of those ranks of the column's ranking, at most
  5,000 per request. The web client asks for the legend's names this way.

Errors
: JSON `{"error": "<sentence>", "reason": "<code>", ...}`. `reason` is machine-readable (table
  below); older routes send only `error`.

Authentication
: With login enabled, every route except `/login` and `/logout` needs the session cookie set
  by `POST /login` (form fields `username`, `password`); without it API routes answer `401`
  `{"error": "Authentication required"}` before anything else is checked. Scripts log in through
  the form and reuse the cookie: `curl -c jar -d "username=...&password=..." https://host/login`,
  then `curl -b jar ...`. There is no token endpoint.

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
| `/data/obsm/<key>` | `obsm[key]` | `column_name=0` (one axis; the web client names the column, which also works for dataframe-valued keys) or `cols=0`. Sparse obsm matrices are read with positional columns `0..n-1` | obsm key |
| `/data/varm/<key>` | `varm[key]` | `cols=<i>`; `column_name=` | varm key |
| `/data/obs` | `obs` columns | `columns=<name>[,<name>...]`, optional `rows=`, `include_categories=false`; one column: `format=f32`, `categorical=codes` | none |
| `/data/var` | `var` columns | `columns=<name>[,...]`, optional `cols=` (gene indices); one column: `format=f32`, `categorical=codes` | none |
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
Access-Control-Expose-Headers: X-Annzarro-Shape, X-Annzarro-Dtype, X-Annzarro-Encoding, X-Annzarro-Nnz, X-Annzarro-Categories-Bytes, ETag
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

A categorical column comes binary too when the client also asks for codes:

```python
import json


def get_categorical(route, column, **params):
    """A categorical obs/var column as (codes, categories); code -1 is missing."""
    r = requests.get(f"{BASE}/data/{route}", params={"dataset_path": STORE, "columns": column,
                     "format": "f32", "categorical": "codes", **params})
    r.raise_for_status()
    if r.headers.get("X-Annzarro-Encoding") != "categorical":
        raise ValueError(f"{column} is not categorical")
    lead = int(r.headers["X-Annzarro-Categories-Bytes"])
    codes = np.frombuffer(r.content, dtype=np.dtype(r.headers["X-Annzarro-Dtype"]).newbyteorder("<"),
                          offset=lead)
    return codes, json.loads(r.content[:lead])


codes, categories = get_categorical("obs", "Age")
print("Age codes:", codes.dtype, codes[:3], categories)
```

```text
Age codes: int8 [2 2 2] ['Mid', 'Old', 'Young']
```

`DM_Kernel` is stored as float64 and its values do not survive a round trip through float32,
so it travels as float64; the 31 non-zeros arrive as 372 bytes.

### When a column cannot be read

- `/data/obs` and `/data/var` with named `columns`: a column the dataset does not have is `404
  key_not_found`; a listed column that cannot be read is `400 unsupported_type` (the error names
  the column and its encoding) or `500 read_failed` / `stale_metadata`. A failed read is never
  answered `200` with an empty list.
- `/data/obs` and `/data/var` **without** `columns` (every column): one unreadable column does
  not fail the request. The reply then carries `"errors": {"<column>": {"reason": ..., "error":
  ...}}` next to `data`.
- `/data/obsm/<key>` and `/data/varm/<key>`: an unknown `column_name` is `404 key_not_found`
  (`obsm 'X_umap' has no column 'nope'`); an encoding the server cannot read is `400
  unsupported_type`.
- A request for a layer, obsp or varp key on a dataset that has no `layers`, `obsp` or `varp`
  group at all is `404 key_not_found`, like any other missing key.

## Cell subsets

Datasets with more cells than `ui.defaults.subset_threshold` (200,000) open on a reproducible
subset of `subset_size` cells (100,000, seed 0); the user can change it in the app. The design,
including the selection function, is in {doc}`../design/subsetting`.

A subset is described by a spec, sent as the `subset=` query parameter (compact JSON, at most
2,000 characters), or the words `all` and `auto`:

```json
{"n": 1000, "seed": 0}
{"n": 300, "seed": 0, "balance": "Age"}
{"n": null, "seed": 0, "where": [{"col": "Age", "op": "in", "values": ["Old"]}]}
```

`n: null` means every cell that passes `where`, an AND of conditions on obs columns: `in`,
`not_in` (`values`), `>`, `>=`, `<`, `<=`, `==`, `!=`, `between` (numbers), the case-insensitive
text conditions `contains`, `not_contains`, `starts_with`, `not_starts_with`, `ends_with`,
`not_ends_with` (one non-empty text `value`) and `empty`, `not_empty` (no value; a missing value
is empty text). An item of `where` may also be a group, `{"any": [...]}` (OR) or `{"all": [...]}`
(AND), whose members are conditions or groups, nested at most 2 deep (16 conditions in all). The same spec selects the same cells on
every machine and release.

`"part": j` (0-based, default 0) selects part j of the partition of the eligible cells into
`ceil(eligible / n)` disjoint parts, which together hold every eligible cell once. Part 0 is the
spec without `part`, and its `key` is written without it. Every route that takes `subset=` takes
the part; a part past the last is `400 part_out_of_range`.

`GET /data/subset?dataset_path=&subset=` resolves a spec and describes it. The reply has `n`
(cells in this part), `n_total`, `n_eligible`, `part`, `parts` (the number of parts) and, for a
balanced spec, per group `total`, `shown` (in this part) and `before` (in parts 0..part-1):

```console
$ curl -s "http://127.0.0.1:8812/api/v1/data/subset?dataset_path=$DS&subset=%7B%22n%22%3A300%2C%22seed%22%3A0%2C%22balance%22%3A%22Age%22%7D"
{"defaults":{"seed":0,"size":100000,"threshold":200000},"groups":{"Mid":{"before":0,"shown":100,"total":2057},"Old":{"before":0,"shown":100,"total":3116},"Young":{"before":0,"shown":100,"total":2917}},"key":"{\"n\":300,\"seed\":0,\"balance\":\"Age\"}","n":300,"n_eligible":8090,"n_total":8090,"part":0,"parts":27,"subset":{"balance":"Age","n":300,"seed":0}}
```

The last of the 27 parts (`"part": 26`) holds the 290 cells left; the 2,057 Mid cells were all
shown by earlier parts, so it is Old and Young only:

```text
"groups":{"Mid":{"before":2057,"shown":0,"total":2057},"Old":{"before":2872,"shown":244,"total":3116},"Young":{"before":2871,"shown":46,"total":2917}},"n":290,"part":26,"parts":27
```

With `subset=` the cell-axis routes (`/data/cells`, `/data/obs`, `/data/obsm`, `/data/obsp`,
`/data/X`, `/data/layer`, `/data/names`, `/data/dataset_structure`) answer for the subset only:
cell positions in requests and replies are positions within the subset, and whole-axis reads are
cut to it. Gene-axis routes are unchanged. JSON and `format=f32` both work; a fold-change gene
column for `{"n":1000,"seed":0}` came back as `X-Annzarro-Shape: 1000,1`, 4,000 bytes, with its
own `ETag`. `/data/cells` with a subset reads only the subset's names: the index is read one
chunk at a time and only the wanted names are decoded, so naming the 100,000 cells of a
10-million-cell store takes about 0.3 s instead of 2.9 s for reading every name
({doc}`performance`). `/data/paginated`, `/data/statistics` and `/data/by_path` cannot apply a subset and
refuse one with `400 subset_unsupported`. A malformed spec is `400 bad_subset` (it never falls
back to every cell); a `where` or `balance` column the dataset does not have is `404
key_not_found`.

`/data/subset` also lists what this server's cell-axis routes understand beyond `rows=`:
`"features": ["dataset_rows", "locate", "names_scope"]`. A client sends the parameters below
only to a server that lists them (an older server would ignore `dataset_rows` and answer for
every row).

(http-outside-cells)=
### A cell the subset does not show

A focused or locked cell from another part, or one a `where` filter leaves out, is still a
cell of the dataset, and its rows mean something over the cells shown: its kNN or diffusion row
coloured over them, its own expression row. `rows=` cannot name it, so the cell-axis routes take
its dataset row as `dataset_rows=`. An obsp row comes back over the subset's cells, exactly as
a shown cell's row does; a layer or `X` row is the cell's own; `cols` of obsp stay positions
among the cells shown. Here part 2 of `{"n":3000,"seed":0}` on `bm_aging.zarr`, and dataset
row 1, a cell of part 1:

```console
$ curl -s "http://127.0.0.1:8812/api/v1/data/names?dataset_path=$DS&subset=$S&entity=cells&q=HSPC_Young_1%23AAAGGATTCAAACCCA-1&mode=exact"
{"matches":[],"total":3000,"truncated":false}

$ curl -s "http://127.0.0.1:8812/api/v1/data/names?dataset_path=$DS&subset=$S&entity=cells&q=HSPC_Young_1%23AAAGGATTCAAACCCA-1&mode=exact&scope=dataset"
{"matches":[{"index":null,"name":"HSPC_Young_1#AAAGGATTCAAACCCA-1","row":1}],"total":8090,"truncated":false}

$ curl -s -D - -o row.bin "http://127.0.0.1:8812/api/v1/data/obsp/diffusion_walk_t5?dataset_path=$DS&subset=$S&dataset_rows=1&format=f32"
X-Annzarro-Shape: 1,3000
X-Annzarro-Encoding: sparse
X-Annzarro-Nnz: 1097
Content-Length: 8776
```

(`$S` is the URL-encoded spec `{"n":3000,"seed":0,"part":1}`; other headers omitted.) The
walk from that cell reaches 1,097 of the 3,000 cells of part 2. Without a subset `dataset_rows`
is the same as `rows`. A shown cell reads byte for byte the same either way, but the two URLs
have their own `ETag`s.

`/data/names` (the typeahead behind the header pickers) answers `{"matches": [{"name",
"index", "row"}], "truncated", "total"}`: `index` is the position among the cells shown, `row`
the dataset row (the same without a subset). Under a subset it searches the shown cells only;
`scope=dataset` searches every cell of the dataset, and a cell not shown has `"index": null`.
The dataset-wide search uses the same name index as a request without a subset, which the
server builds on first use (6.2 s at 50 million cells) and then keeps, within
`server.name_index_max_mb`. A dataset whose index would not fit (about 30 bytes per name:
30 GB at a billion cells) gets none: its names are scanned a chunk at a time, and the reply
also has `"scanned"` (names read) and `"partial"`: true when the scan stopped before the end
(`server.name_search_scan_names`, 100 million by default; or a full page of names starting
with the query, or the exact match, was found), so the matches may differ from a full
search, with a `"note"` in words. `GET /data/names/status` answers `streaming` for such a
dataset and builds nothing.

`/data/subset` also takes `client=` (an id the page makes for itself) and `priority=low`. A request
for another subset of the same dataset from the same `client` stops the computation of an older one
at its next block of a million rows (`409 {"reason": "subset_superseded"}` for the older); a
`priority=low` request, a read ahead of the next part, is stopped by any request of the page for a
subset and stops none. Requests without a `client` are never stopped. The cells of a part are read
for their names only when something asks: `/data/obs?columns=_index&rows=` reads the chunks of
those rows, and a dataset above `ui.defaults.names_on_demand_above` cells does not read all of
them for a part ({ref}`names-on-demand`).

`GET /data/subset/locate?dataset_path=&subset=` translates cells between the two index spaces
without names, up to 1,000 per call: `rows=` (positions) answers `{"dataset_rows": [...]}`,
`dataset_rows=` answers `{"rows": [...]}` with `-1` for a row the subset does not show. The
client uses it to carry the focused and locked cells across a part step:

```console
$ curl -s "http://127.0.0.1:8812/api/v1/data/subset/locate?dataset_path=$DS&subset=$S&rows=0,1,2"
{"dataset_rows":[0,6,7]}
$ curl -s "http://127.0.0.1:8812/api/v1/data/subset/locate?dataset_path=$DS&subset=$S&dataset_rows=0,1,2,2991"
{"rows":[0,-1,-1,-1]}
```

## Dataset discovery and structure

| Route | Returns |
|---|---|
| `GET /datasets` | list of `{name, path, rel_path, cells, genes, is_link}` for the stores at the top of the data directory and in its `datasets/` subdirectory (`rel_path` says which); a store the server's zarr cannot read is listed with `cells: null` and an `error` sentence |
| `GET /data/dataset_structure?dataset_path=` | everything the menus need: `shape`, `n_obs`, `n_vars`, and per slot `available`, `keys` / `columns`, `info` (shape and type per key), `columns_info` (dtype per obs/var column), dataframe columns of `obsm`/`varm`. A store without `X` has `"X": {"available": false, "shape": null}` |
| `GET /data/fingerprint?dataset_path=&wait=` | the store's fingerprint for saved views: `{status, fingerprint, path, rel_path, annzarro_version}`. `status` is `ready`, or `pending` while a large store's cell and gene names are hashed in the background (then `fingerprint` holds `n_obs`, `n_var`, `meta`, `groups` and `fields` only); `wait` (seconds, at most 10) waits for it, and is what starts the hashing: a call with `wait=0` (opening a dataset) answers from what is known and never starts it. `rel_path` is the path relative to the data directory, `null` outside it. Missing store: 404 `not_found` ({doc}`../user-guide/reproducing`) |
| `GET /data/info?dataset_path=` | a shorter summary: `shape`, `has_*` flags, `obs_columns`, `var_columns`, `layers`, `embeddings` |
| `GET /data/genes?dataset_path=` | `{"genes": [...], "dataset_path": ...}`, all `var_names` (146 kB here) |
| `GET /data/cells?dataset_path=` | `{"cells": [...], ...}`, all `obs_names` (275 kB here). With `subset=`, the subset's names only, in dataset order; the server reads just those (below) |
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
        "path": "/Users/me/annzarro-data/bm_aging.zarr",
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
| `GET /auth/me` | `{auth_enabled, username, is_admin, exposed, may_open_any_path}`; `exposed` is true when the server listens beyond localhost with login off; `may_open_any_path` says whether this requester may open paths outside the data directories (`server.arbitrary_paths`) |
| `GET /config` | the `public` tier of the configuration ({doc}`configuration`): `server` (`host`, `port`, `https_enabled`, `unified_server`), `auth.enabled` (when set), `branding`, `ui` and `integrations`, plus the flat keys the web client reads (`host`, `port`, `app_name`, `project_description`, `contact_info`, `enabled_panel_types`, `integrations`, `ui_*`) and the flags `electron_mode` and `local_mode`. Never `data_dir`, log or users-file paths, limits, cache or remote-store settings |
| `GET /status` | version, uptime, memory, data directory checks |
| `GET /cache/info` | the server's result cache of the process that answers: datasets, items, `memory_usage_mb` (exactly what the cache holds), `max_memory_mb` |
| `POST /cache/reset` | clear it, for all datasets or `?dataset_path=`, and start a new generation of them (new ETags, {ref}`revalidation`). On a shared server admins only (`403 admin_only` otherwise). Each gunicorn worker has its own cache: the one that answers clears it now, the others drop the dataset's entries on their next request, when they see the new generation |
| `POST /data/refresh?dataset_path=` | check the dataset against the disk (every file's modification time and size) and, if it changed, start a new generation, so every worker serves the change and the browser's revalidations get new tags. Open to every user who may read the dataset; an unchanged store keeps its generation and everyone's cached reads. Bounded: concurrent refreshes in a worker share one walk; a dataset is walked at most once per `server.refresh_min_interval_s` (10 s) across workers, and a refresh sooner never waits in the server: it schedules one walk for the interval's end, shared by every refresh meanwhile, and answers at once `{"status": "scheduled", "after", "retry_after_s"}`; `POST /data/refresh?dataset_path=&after=<after>` then returns the result of the first walk that started at or after `after` (or `scheduled` again until there is one), so the answer always comes from a walk that started after the first request (the browser does this); a walk stops after 3 s, and a store too large to fingerprint fully answers `status: "partial"` (with a `message`) and is not bumped: an admin's `POST /cache/reset` serves its in-place chunk writes (the app shows the `partial` answer to the user as a notice, once per Refresh press). Answers `{"status": "full" or "partial" or "remote" or "scheduled", "changed": bool, "checked": bool, "waited_s", "consolidated_metadata": null or {"stale": true, "detail", "message", "fix"}}`; when the store's consolidated metadata no longer describes it (an element added or rewritten without `zarr.consolidate_metadata`), the store is read without it until it is consolidated again, and `dataset_structure` carries the same `consolidated_metadata` notice. The header's Refresh dataset and each panel's Refresh call it |
| `GET /directories/home`, `GET /directories/list?path=` | the data directory and its entries (dataset browser) |
| `GET /zarr/url?url=` | whether a URL is an acceptable remote store |

Also registered but not used by the web client: `/data/paginated`, `/data/statistics`,
`/data/by_path`, `/core/datasets`, `/zarr/to_anndata` (a metadata summary: shape, the first ten obs and var names, key lists, column types; it opens no matrix, so a store with a dense 175,000 x 175,000 `obsp` answers it at once), and the path-segment forms
`/datasets/<path>`, `/datasets/<path>/info`, `/datasets/<path>/uns/...`. In the path-segment
forms `<path>` is relative to the data directory (`/datasets/bm_aging.zarr`,
`/datasets/bm_aging.zarr/uns/neighbors/params`); a path that does not exist is `404 not_found`,
one that is not a dataset `400 unsupported_type`.

## Status codes

| Status | `reason` | When |
|---|---|---|
| 200 | | the slice, as JSON or binary |
| 304 | | `If-None-Match` matched: same URL, store unchanged |
| 400 | `bad_indices` | `rows`/`cols` present but not a list of non-negative integers, in JSON and `format=f32` alike; the message quotes the value: `Indices must be comma-separated non-negative integers, got 'abc'` (`got ''` for an empty parameter) |
| 400 | `index_out_of_range` | an index at or beyond the length of its axis (for `dataset_rows`, the dataset's cell count) |
| 400 | `cap_exceeded` | more indices than the client's own `max_cells=` / `max_genes=` parameter (below), or more than 1,000 cells in one `/data/subset/locate` call |
| 400 | `unsupported_type` | not a `.zarr`/`.h5ad`, a zarr format the server's zarr cannot read, an h5ad written by anndata older than 0.7, or a named obs/var column or obsm/varm key whose encoding cannot be read |
| 400 | `bad_subset`, `subset_unsupported`, `part_out_of_range` | a malformed `subset=` spec; a route that cannot apply a subset; a `part` past the last part |
| 400 | `rows_conflict`, `dataset_rows_unsupported` | `rows` and `dataset_rows` in one request; `dataset_rows` on a route that does not read cells by dataset row |
| 400 | (none) | a required parameter is missing, e.g. `{"error":"dataset_path parameter is required"}` |
| 401 | (none) | login on, no session; checked first |
| 403 | `outside_data_dir` | local path outside the data directory and `allowed_dirs`, on a shared server (or anywhere with `server.arbitrary_paths: none`), for a requester `server.arbitrary_paths` does not let through (the message names no server directories) |
| 403 | `access_denied` | remote store refused by the remote-store policy |
| 403 | `not_owner`, `legacy_admin_only`, `admin_only` | panel-set permissions; `admin_only` also for `POST /cache/reset` on a shared server |
| 404 | `not_found` | dataset path does not exist; panel set not found (no `reason`) |
| 404 | `key_not_found` | a layer, obsm, varm, obsp, varp or uns key, an obs/var column or an obsm/varm `column_name` that the dataset does not have (also when the whole `layers`/`obsp`/`varp` group is missing); `X` in a store without `X`; a subset column that does not exist |
| 413 | `response_too_large` | the slice exceeds `max_response_elements` (below) |
| 413 | `read_too_large` | an `obsp`/`varp` read would hold more than `server.max_read_mb` in memory (estimated from metadata, before reading); the body has `limit_mb`, `requested_mb` and `elements` (the element, its stored shape, rows, columns and estimated MB) |
| 400 | `too_many_categories` | `/data/subset` balancing across a column of more than 10,000 categories. No reply is refused for its number of labels: a categorical codes reply (`format=f32&categorical=codes`, one column) is streamed in bounded memory. A JSON reply, and any request for several columns, is not: it builds every label of the rows asked at once, so for a column with millions of categories (a barcode on every cell) ask for that column alone through the codes route |
| 500 | `stale_metadata` | the store's consolidated metadata (`.zmetadata`) no longer matches an array on disk, usually after an in-place rewrite. `POST /data/refresh` (Refresh dataset) reads the store without the stale metadata from then on; re-consolidate (`zarr.consolidate_metadata(path)`) and refresh again |
| 500 | `read_failed` | any other failure to read an array the store lists, with the exception text |
| 501 | `missing_dependency` | a remote store without the `annzarro[remote]` extras |
| 504 | `remote_timeout` | a remote store did not answer in time |

```console
$ curl -s -w "\nHTTP %{http_code}\n" "http://127.0.0.1:8812/api/v1/data/layer/kompot_de_Young_to_Old_fold_change?dataset_path=$DS"
{"error":"Response too large: 8090 x 16285 = 131745650 elements requested from layer/kompot_de_Young_to_Old_fold_change; the limit is 10000000 (max_response_elements). Request one row or column, or fewer of them.","limit":10000000,"reason":"response_too_large","requested":131745650,"shape":[8090,16285]}
HTTP 413

$ curl -s -w "\nHTTP %{http_code}\n" "http://127.0.0.1:8812/api/v1/data/X?dataset_path=$DS&rows=&cols=1"
{"error":"Indices must be comma-separated non-negative integers, got ''","reason":"bad_indices"}
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
| `server.max_read_mb` | 5% of RAM (256 MB to 4 GB) | memory an `obsp`/`varp` read would hold, from shape, dtype and stored sizes, before reading (`/data/obsp`, `/data/varp`, `/data/by_path`, `/data/paginated`, `/data/statistics`) | `413 read_too_large` |
| `max_cells=` / `max_genes=` query parameters | none | number of requested cell / gene indices | `400 cap_exceeded` |
| groups for subset balancing | 10,000 | a column's categories (metadata) | `400 too_many_categories` |

One full row or one full column always passes the size guard, at any dataset size: that is the
unit every view asks for. `max_cells=` and `max_genes=` are the client's own guard against
asking for more than it can draw (the web client sends its `ui.defaults.max_cells` /
`max_genes`); they are not a server limit, and a request without them is not capped.
