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

on the demonstration store `bm_aging_annzarro.zarr` (8,090 cells × 16,285 genes). Outputs are copied
from those calls; long paths are shortened to `$DS`.

## Conventions

Paths
: Every route below is under `/api/v1`. On a server mounted under a path
  (`server.url_prefix`, {doc}`../deployment/lab-server`) they are under `<prefix>/api/v1`.

Changing requests
: With login on, every `POST`, `PUT` and `DELETE` of a signed-in session (panel-set saves, renames,
  imports and deletes, `/data/refresh`, `/cache/reset`, `/logout`, and every admin route) must send
  the session's token in `X-AnnZarro-CSRF`. The web client reads it from `<meta name="annzarro-csrf">`
  of the page. A browser's `Origin` must equal the server's own address (behind a proxy that
  terminates TLS or rewrites `Host`, set `server.proxy_count`), and `Sec-Fetch-Site`, when sent, must be
  `same-origin`; otherwise `403` `csrf_failed`. An anonymous request passes this check and is
  answered `401`. Scripts that sign in with a session cookie must send the header; `GET`
  routes and token-less clients of a server with login off (`curl`, `annzarro export`) are not
  affected, though a browser-sent `Origin` is still checked. `POST /login` instead carries the
  form's `login_csrf` field with the matching `annzarro_login_csrf` cookie (both come from `GET /login`),
  and `/logout` is `POST` only: `GET /logout` answers `405` with a one-button form.

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
: With login enabled, every route except `/login`, `/logout` and the public site pages
  ({ref}`http-site`) needs the session cookie set
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
| `/data/obsp/<key>` | `obsp[key]` | `rows=<cell>` (required; up to 1,000 rows, and `cols=` only filters them) | obsp key |
| `/data/varp/<key>` | `varp[key]` | `rows=<gene>` (required, as obsp) | varp key |
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
STORE = "/path/to/bm_aging_annzarro.zarr"


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
among the cells shown. Here part 2 of `{"n":3000,"seed":0}` on `bm_aging_annzarro.zarr`, and dataset
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

(http-gene-score)=
## Gene signature scores

`POST /data/gene_score?dataset_path=` gives one number per cell for a list of genes, a *signature*.
The dataset is named in the query, as on every data route (the access gate and the path checks read it);
the recipe and the cells to show go in a JSON body, because a long list of gene names does not fit a request line.

```json
{"recipe": {"genes": ["CD3E", "CD8A"], "input": "X", "method": "zscore_mean", "clip": 10},
 "subset": {"n": 100000, "seed": 0},
 "estimate_only": false,
 "confirm": false}
```

The **recipe** is the whole definition of a score. Only `genes` is required.

| Field | Default | Meaning |
|---|---|---|
| `genes` | (required) | gene names, matched exactly; a repeated name counts once. There is no limit on their number: the body may be up to 16 MB (`413 request_too_large` above it), and the cost estimate refuses a score that would take too long |
| `input` | `"X"` | `"X"`, or the name of a layer |
| `method` | `"zscore_mean"` | `zscore_mean`: the mean over genes of the z-score `(x - mean) / sd`, clipped at plus and minus `clip`. `mean`: the mean over genes of `x`. `sum`: the sum over genes of `x` (a gene with no value in a cell adds nothing; a cell with no value for any gene is NaN). `detected`: the share of the genes whose value is above `detect_above` in the cell, 0 to 1 (a share, so it is unchanged by a gene missing from the dataset). `fraction_of_total`: the sum over genes of `x` over the sum of the cell's finite values over **all** genes, times 100, so in percent (see below). `control_adjusted`: the mean over genes of `x`, less the mean of `x` over control genes (Tirosh et al. 2016, as scanpy's `score_genes`; see below). Mean and SD are taken over **all cells of the dataset**, zeros included, so a score does not change with the cells shown |
| `clip` | `10` | a number above 0, or `null` for no clipping; anything else is `400 bad_clip`. Only the z-score mean clips: the recipe keeps the value, but it changes nothing under `mean` or `control_adjusted` |
| `seed` | `null` | a whole number from 0 up (`400 bad_seed` otherwise), or `null`. Only the control-adjusted score draws anything: it picks the control genes, and `null` means 0. The reply's `recipe.seed` is the seed used (`null` for the other methods) |
| `detect_above` | `0` | `detected` only: a number from 0 up (`400 bad_detect_above`); a gene is detected in a cell when its value is above it. The reply's `recipe.detect_above` is `null` for the other methods |
| `bins`, `controls` | `25`, `50` | control-adjusted only: gene bins (a whole number from 2 to 200, `400 bad_bins`) and control genes drawn per bin (1 to 1,000, `400 bad_controls`). The reply's `recipe` holds them, and `null` for the other methods |
| `down` | `[]` | down genes: the score is the up genes (`genes`) minus the down genes. Only `zscore_mean`, `mean` and `control_adjusted` have a signed version; any other method with down genes is `400 method_no_down`. A gene named on both sides counts as up (the reply's `overlap` lists them) |
| `down_weight` | `"gene"` | how down genes weigh in `zscore_mean` and `mean`. `gene`: the signs of the down genes are flipped and every usable gene is averaged, (sum of up - sum of down) / (number of up + number of down). `side`: the mean of the up genes minus the mean of the down genes. `control_adjusted` ignores it: each side always subtracts its own controls. Anything else is `400 bad_down_weight` |
| `version` | `1` | the algorithm version; a recipe for another version is `400 unsupported_version` |

**The fraction of total.** The total of every cell over all genes is one pass over the matrix (every stored entry of a store held by gene or by cell, every element of a dense one), so the estimate counts it: `stat_entries` joins `entries`, and `seconds` follows at the layout's rate. For a matrix held by gene with 1,500 stored genes per cell, 10 million cells is 15 billion entries, which the estimate puts in the `confirm` tier (not `auto`) and double that is `refused`, with the usual message. The share is only meaningful for counts and linear normalised values; when the input looks log-transformed or scaled the reply's `warnings` hold `fraction_not_meaningful`. The denominator is every gene of the matrix, the signature's own included: that is what the share of a cell's counts means. A cell whose total is 0 has no value (NaN).

**The control-adjusted score.** Genes are cut into 25 bins by how often they are detected (the share of cells with a stored non-zero value), as scanpy cuts them by mean expression: ranked, then `rank // round(genes / 24)`, so equal figures share a bin. For every bin that holds a signature gene, 50 genes of that bin outside the signature are drawn as controls, or all of them when the bin holds fewer. The score of a cell is its mean over the signature genes less its mean over all the controls. The draw ranks a bin's genes by a fixed hash of the gene's position and the `seed` and takes the lowest 50, so a stored seed gives the same controls on every machine, and adding a gene to the signature moves the controls of its own bin only. Detection costs nothing to read on a store held by gene (CSC); on a store held by cell or a dense matrix the estimate adds one pass over the matrix, and its `controls` is `null` until the pass has run. With no control to draw (a signature that fills every bin it falls in) there is no score, with `reason: "no_control_genes"`. The reply carries `n_controls` and `n_controls_used` (controls that held a value) and `binning` (`detection`). Binning by detection instead of by mean was checked against binning by the mean on two real datasets, a murine bone marrow study and a human PBMC set: the gene rankings agree (Spearman 0.997 and 0.9998), and scores made from either binning with different seeds agree as well as two seeds of one binning do.

A gene that is not in the dataset is listed and left out. A gene with the same value in every cell is left
out of the z-score mean and listed. If a name occurs more than once in the dataset the first is used, and
the reply says so. Values that are not finite (NaN, infinity) are missing: ignored for that gene, so a cell
scores from the genes it has, and is NaN when it has none. With no usable gene there is no score (never a
column of zeros), and the reply says why.

**The estimate.** `estimate_only: true` reads no gene and answers `200` with the cost, known from the
store's index before any data is read:

```json
{"estimate": {"entries": 1810234, "seconds": 0.24, "tier": "auto", "live_max_s": 5.0, "auto_max_s": 60.0, "max_s": 600.0,
              "layout": "csc", "n_cells": 100000, "genes": 50, "genes_requested": 50, "genes_missing": 0},
 "missing": [], "duplicated": [], "recipe": {"method": "zscore_mean", "input": "X", "clip": 10.0,
                                                "version": 1, "genes": 50}}
```

`live_max_s` (5 s) is where a client stops updating an open signature live and collects edits behind a button; the estimate is cheap (it reads the store's index, never a gene), so a client may ask on each edit. The `tier` follows `seconds`. `auto` (up to 60 s): compute without asking. `confirm` (60 s to 10 minutes):
the request must carry `confirm: true`, else it is `409 confirmation_required`. `refused` (over 10 minutes):
`413 score_too_expensive`, whatever `confirm` says; the message says what would help (fewer genes, or for a
matrix stored by cell, a copy stored by gene). The estimate is a bound from the entries to read and a
conservative rate per layout; a matrix stored by cell (CSR) must be scanned whole to read a gene, so it
costs far more than one stored by gene (CSC), and a remote store is estimated at a tenth of a local rate.

**The stream.** Otherwise the reply is `application/x-annzarro-score-stream`: JSON frames, one per line, then
raw bytes.

1. `{"type":"progress","done":k,"total":n,"entries_done":e,"entries_total":E,"running_s":s,"queue":{"ahead":a,"sharing":m}}`
   as genes are read: genes, stored entries, the seconds the score has held its lane (waits left out) and its
   place. A score that has to wait is sent one at once, with `done` and `entries_done` 0, and another whenever
   its place changes.
2. `{"type":"result", ...}`, then `byte_length` bytes: little-endian float32, one value per cell shown, in the
   order the cells are shown (the `subset`'s order; all cells without one). The frame has `scored`, `reason`
   and `message` (why there is no score, and `byte_length: 0`), `n_cells` (the dataset), `n_shown`,
   `n_used` (with `n_used_up` and `n_used_down`), `recipe` (what was computed: `clip` is `null` for `mean`), `genes`
   (per gene: `name`, `column`, `direction` `up` or `down`, `status` `used`, `constant` or `no_values`, `mean`, `sd`,
   `detected`, the fraction of cells with a non-zero value, and `clipped`, the fraction beyond the clip), `missing`,
   `missing_down`, `overlap`, `duplicated`, `warnings`, `entries_read` and `seconds`; for a control-adjusted score also `n_controls`, `n_controls_used` and `binning`.
3. `{"type":"error","reason":...,"message":...}` if the work fails after the stream began. The status is
   already `200`, so a stream that ends without a `result` frame has failed.

Nothing is cached or kept: the server holds a score only while it computes it.

(http-cell-groups)=

## Cell groups

`POST /data/cell_groups?dataset_path=` puts the cells shown into groups and, per group, counts and summarises genes,
scores and per-cell columns. One route serves three shapes: `grouping` (the groups of a list of partitionings, one
code per cell, moments per group), `grid` (the dense counts of a count plot) and `genes` (the moments of every gene
over one group of cells, {ref}`http-cell-groups-genes`). The dataset is in the query, as on
every data route; the JSON body is `{shape, partitionings, sets, subset, small, features, measures, want, mode,
density, estimate_only, confirm}` (and, for `genes`, `group`, `member`, `layer` and `thresholds`). A field the shape does not take is `400 unknown_field`, a field no shape takes
`400 bad_request`.

Like the score route it has the access gate, the CSRF check, the 16 MB body limit (`413 request_too_large`),
`estimate_only` (answers `{"estimate": {...}, "missing": {...}}` and reads nothing), the cost tiers (`409
confirmation_required`, `413 groups_too_expensive`) and cancellation by closing the connection. It adds `422` for
limits met before any read (`grid_too_large`, `too_many_sets`, `too_many_partitionings`, `obsp_too_large`) and
`400 set_length_mismatch` for a table's bitset that does not cover the cells shown.

The reply is `application/x-annzarro-groups-stream`: JSON lines (`start`, `progress` frames with `stage`, `done`,
`total`, `entries_done`, `entries_total`, `running_s` and `queue`, then `result`, or `error`), then the binary blocks
the `result` frame lists. A request that has to wait for its lane or for memory is sent a `progress` frame at once
with its `queue`; a wait longer than 30 seconds ends in an `error` frame with reason `read_busy`.

Requests whose estimate is under 5 seconds and that read no whole matrix run in the light lane (two at a time per
worker); every other request takes the heavy slot, which one job at a time holds and gives back between read batches
when another waits. The estimate names the lane.

The web client's Cell Grouping, Cell-Gene Plot and Cell Count Plot ({doc}`../user-guide/cell-grouping`,
{doc}`../user-guide/cell-gene-plot`, {doc}`../user-guide/cell-count-plot`) are built on this route alone: the browser
never holds the per-cell data of these views, only the counts, the moments and, for a grouping that colours a plot, one
code per cell.

### The request

```json
{"shape": "grouping",
 "partitionings": [
   {"source": {"type": "obs", "key": "cell_type"}},
   {"source": {"type": "obs", "key": "depth"},
    "binning": {"method": "equal_count", "bins": 2, "zero_bin": true}}],
 "features": [{"id": "f0", "kind": "gene", "name": "Cd3e", "layer": "logged"}],
 "want": {"codes": true}}
```

| Field | Shape | Meaning |
|---|---|---|
| `shape` | both | `grouping` (the default) or `grid` |
| `partitionings` | both | the list of partitionings (below). A grouping takes up to 8, counted again across nesting up to 64 (`422 too_many_partitionings`); a grid takes the axes of its `mode` |
| `sets` | both | the bitsets of cell tables, by the `ref` a `table` source names: `{"s0": {"encoding": "bitset-base64", "length": 8090, "data": "..."}}`. Cell `i` of the cells shown is bit `i & 7`, least significant first, of byte `i >> 3` (numpy's `packbits(..., bitorder="little")`); bits past `length` are 0. A `length` other than the number of cells shown is `400 set_length_mismatch` |
| `subset` | both | the cells shown, a subset spec as the score route takes it (the `?subset=` of the other routes, as a string or as its JSON); absent, every cell |
| `small` | grouping | `{"threshold": 10, "mode": "keep"}`: groups with fewer cells than `threshold` are kept (`keep`), collected into one group with the key `["@small"]` (`collect`), or put in no group (`hide`) |
| `features` | grouping | rows of a Cell-Gene Plot: `{"id", "kind": "gene", "name", "layer": "X", "detect_above": 0}` (optionally `"transform": "zscore"` with `"clip": 10`, a number above 0 or `null`: the moments are those of the gene's z-score over all cells of the dataset, clipped, as a one-gene z-score mean signature would score it; the threshold is then on the z-score; a gene with no spread has the status `constant`; `clip` needs `transform`), or `{"id", "kind": "score", "recipe", "column", "layer", "above": 0}`, where `recipe` is the score route's ({ref}`http-gene-score`) and `column` (the method) and `layer` (its input) override it |
| `measures` | both | one numeric per-cell source per measure: `{"id", "source", "above": 0}`, the source an `obs`, `obsm`, `layer`, `obsp` or `gene-score` source as below. A grouping takes up to 16, a grid 1 (`too_many_measures`) |
| `want` | grouping | `{"codes": false, "histograms": []}`: whether to send one code per cell, and the indices of the binned partitionings whose distribution (a 100-bin count with its share of zeros) to send |
| `mode` | grid | `1d` (x, then an optional split), `2d` (x, y, an optional split), `categorical` (x, y, and an optional factor whose most frequent level is wanted) or `sets` (2 to 16 binary partitionings) |
| `density` | grid | `true` for the two passes of a density (`1d` and `2d` only): the first takes each density axis's `n`, SD and its 0.1st and 99.9th percentiles, the second bins the range those give, padded by 3 bandwidths. The smoothing is the browser's |
| `estimate_only`, `confirm` | both | as on the score route |

A **partitioning** is `{source, binning?, levels?, rest?, member?}`:

- `source` is the setting a cell plot stores. `obs` (`key`; the name of the obs index gives one level per cell),
  `obsm`, `layer` and `obsp` (`key` and `column`: the embedding's column, the gene, the cell whose row is read),
  `table` (`ref` into `sets`), `gene-score` (`recipe`, the score route's, with `column` the method and `layer` the
  input) and `cell-group` (`recipe`: `{partitionings, small?}`, another grouping written out inline, up to 4 deep,
  `nested_too_deep` beyond). The server never sees a panel, so a `key` on the last three is accepted and not used.
- `binning` makes a numeric source into bins: `{method, bins, thresholds, zero_bin, range, edges_from, outside}`.
  `method` is `equal_count` (the default), `equal_width`, `log`, `manual` (with `thresholds`) or `categories` (one level
  per value). `bins` is 2 to 1,000 in a grouping; on a grid an axis takes up to its mode's level limit (below:
  2,000 for the x of a 1D grid, 512 per axis in 2D). Other counts are `400 bad_bins`. Bins are closed below and open above, the last one closed.
  `zero_bin: true` gives exact zeros a level of their own. `range` is `[lo, hi]` with `null` for a side taken from the
  data. `edges_from` is `shown` (the default: edges from the cells shown) or `all` (from every cell of the dataset,
  the same for every subset). `outside` is `clamp` (values outside a stored range fall into the end bins) or
  `exclude` (they are left out and counted); a grouping takes `clamp` only, since every cell shown must be in a level.
- `levels` keeps some categories, by their level ids, in that order, and `rest` says where the others go: `other`
  (one level `@other`, the default) or `exclude` (no group). On a table, `rest: "exclude"` drops the `@out` level.
- `member` makes the partitioning strictly in or out, for the sets of a Venn or UpSet: `{"levels": [ids]}`,
  `{"op": ">" | ">=" | "<" | "<=", "value": x}` or `{"group": [ids]}` (one group of a `cell-group` source). A cell
  without a value is out.

**Level ids** are typed, so a category can never be taken for a reserved level: `c:<text>` for a category (`c:B cell`,
and `c:other` for a category called "other"), `bin:<i>` from 0 upward, and the reserved `@zero`, `@in`, `@out`,
`@other` and `@na` (no value). A category's text is the value as written, a boolean is `c:true` or `c:false`, an
integer its digits, and a float is written as JavaScript writes a number (`3.0` is `c:3`); a column in which two
values give the same text is refused (`ambiguous_categories`). A level of a `cell-group` source is `g:` followed by the
JSON of the group's key. A group's **key** is the list of its level ids, one per partitioning. Names, colours and the
separator never reach the server: the browser makes them from the keys.

Unknown fields are refused everywhere, so fields can be added later: on the body `400 bad_request` for a field no
shape takes and `400 unknown_field` for one this shape does not take, and the same for a field of a partitioning,
a source, a binning, a member or `small`.

### The estimate

`estimate_only: true` reads no data and answers `200`:

```json
{"estimate": {"auto_max_s": 60.0, "entries": 675, "lane": "light", "layout": "csc", "live_max_s": 5.0, "max_s": 600.0,
              "n_cells": 1200, "seconds": 0.2, "tier": "auto",
              "parts": [{"entries": 0, "layout": "column", "seconds": 0.0, "type": "obs"},
                        {"entries": 0, "layout": "column", "seconds": 0.0, "type": "obs"}]},
 "missing": {}}
```

`entries` are the stored values the genes, scores and measures will read, known from the store's index; `parts` is
the cost of each partitioning; `lane` is where the request will run; `missing` lists genes the dataset does not have
(`{"genes": [...]}`). The tiers are the score route's: up to 60 s runs, up to 10 minutes needs `confirm: true` (`409
confirmation_required` otherwise), and beyond is `413 groups_too_expensive`, whose message says what would help. An
`obsm` column is charged its whole matrix, because the store's chunks hold every column of a row range together.

### The stream

Otherwise the reply is `application/x-annzarro-groups-stream`, JSON frames one per line, then after the `result` frame
the binary blocks it lists, little-endian, in the order listed:

```
{"type": "start", "codes": "miss", "lane": "light", "entries_total": 675, "queue": {"ahead": 0, "sharing": 0}}
{"type": "progress", "stage": "groups", "done": 1, "total": 2, "entries_done": 0, "entries_total": 675, "running_s": 0.015, "queue": {"ahead": 0, "sharing": 0}}
{"type": "progress", "stage": "features", "done": 1, "total": 1, "entries_done": 675, "entries_total": 675, "running_s": 0.03, "queue": {"ahead": 0, "sharing": 0}}
{"type": "result", "version": 1, "shape": "grouping", "n_shown": 1200, "n_grouped": 1200,
 "partitionings": [
   {"kind": "categorical", "levels": [{"id": "c:B cell", "n": 500}, {"id": "c:T cell", "n": 300}, ...],
    "categories": ["c:B cell", "c:T cell", ...], "n_no_value": 0},
   {"kind": "binned", "levels": [{"id": "@zero", "n": 732}, {"id": "bin:0", "n": 234, "lo": 0.0917, "hi": 2.6165},
                                 {"id": "bin:1", "n": 234, "lo": 2.6165, "hi": 15.6397}],
    "edges": [0.0917, 2.6165, 15.6397], "edges_from": "shown", "edges_n": 1200, "bins_asked": 2, "bins_made": 2,
    "degenerate": false, "outside": "clamp", "n_no_value": 0, "n_outside": [0, 0]}],
 "groups": [{"key": ["c:B cell", "@zero"], "n": 313}, {"key": ["c:B cell", "bin:0"], "n": 91}, ...],
 "small": {"threshold": 10, "mode": "keep", "n_small": 4},
 "features": [{"id": "f0", "status": "ok"}], "measures": [],
 "moments": ["n", "sum", "sumsq", "n_above", "sum_above"],
 "blocks": [{"name": "codes", "dtype": "uint8", "length": 1200},
            {"name": "feature_moments", "dtype": "float64", "shape": [1, 17, 5]}]}
<1,200 bytes of codes><680 bytes of moments>
```

- `start` says whether the grouping came from the worker's **code cache** (`codes: "hit"`, nothing of the grouping is
  read again) or not (`miss`), the lane, the stored entries to read and the place in the queue. A grid has no `codes`.
- `progress` frames carry the `stage` (`groups`, `features` or `grid`), what is done of it, the stored entries read of
  all to read, the seconds the job has held its lane (waits and give-way pauses left out, so `entries_done /
  running_s` is a rate) and `queue`: `ahead`, the jobs before this one in its lane, and `sharing`, those it takes turns
  with. The server never says whose a job is.
- `result` of a grouping: the cells shown and those in a group; per partitioning its levels in order with their cells,
  and for a binned one the edges, the population they came from (`edges_from`, `edges_n`), the bins asked and made
  (equal edges merge, so fewer may be made), whether every value was equal (`degenerate`), the cells without a value
  and those clamped below and above (`n_outside`), and, when asked, its `histogram`; `categories` lists every category
  of a categorical column, and kept levels that hold no cell are listed with `n` 0 under `absent`. `groups` is in the
  order the groups are drawn, and a group's index there is its code. Each `features` and `measures` entry has a
  `status`: `ok`, `missing` (a gene the dataset lacks) or `no_score` with its `reason`.
- The blocks of a grouping: `codes` (`uint8` up to 255 groups, the value 255 meaning no group; else `uint16` and
  65535), one per cell shown, when `want.codes` asked; `feature_moments` and `measure_moments`, `float64` of shape
  `[features, groups, 5]`.
- `result` of a grid: `axes`, each with its levels (ids only), the same binning fields and `n_outside` (each cell left
  out counted once, on the first axis whose range it fails), and for a density `density: {n, sigma, bandwidth,
  quantiles, range}`; `n_counted`, the cells counted. Its blocks: `counts` (`uint32`, one per combination of levels,
  empty ones included, the first axis slowest) and `measure_moments` (`[1, combinations, 5]`). A grid never sends
  codes. An axis lists every declared level (all categories, kept or not, all bins) and of `@other`, `@na` and `@zero`
  only those that hold a cell; `@in` and `@out` are always listed.
- `error`: `{"reason", "message"}` when the work fails after the stream began. The status is already `200`, so a
  stream that ends without a `result` frame has failed.

**The moments.** For each group and each feature or measure, five numbers over the group's cells with a finite value
`x`: `n`, the sum of `x`, the sum of `x²`, the number of cells with `x` above the threshold (`detect_above` of a
gene, `above` of a score or measure), and the sum of `x` over those. Every statistic the plots offer (mean, %
expressing, mean of expressing cells, sum, SD, the z-scores) and every scaling is derived from them in the browser, so
a change of statistic or scaling sends no request. A value that is not finite is left out of all five; a cell in no
group is in no group's moments.

**A limit met once the levels are known** is a `result` with `refused` and no blocks, for example
`{"refused": {"reason": "grid_too_large", "count": 7864320, "limit": 2097152, "mode": "2d", "levels": [512, 512]}}`.
The reasons: `too_many_levels` (a partitioning over 2,000 levels holding a cell), `too_many_groups` (over 2,000
groups), `too_many_categories`, `ambiguous_categories`, `too_many_bins` and `grid_too_large` (a grid over its mode's
limits, below). `too_many_values` refuses a grouping whose groups times features and measures pass 400,000.

| Grid `mode` | Axes | Levels per axis | Refused |
|---|---|---|---|
| `1d` | x, split | 2,000 × 200 | `422` (`grid_too_large`, `too_many_bins`, `too_many_levels`) when the sizes are known from the request, else in the `result` once the levels are read |
| `2d` | x, y, split | 512 × 512 × 8 | the same |
| `categorical` | x, y, factor | 200 × 200 | the same |
| `sets` | 2 to 16 sets | in or out | `422 too_many_sets`, `too_few_sets` |

Measures are counted over at most 2,097,152 combinations (512 × 512 × 8, 84 MB of moments).

**Memory and turns.** A request holds its estimate on the worker's compute ledger while it runs
(`server.compute_budget_mb`, {doc}`../deployment/resource-limits`) and waits when it does not fit, after the code cache
has been emptied. A worker keeps the codes of the groupings it resolved, up to `server.group_code_cache_mb`, so a plot
coloured by a grouping and a Cell-Gene Plot over it read the grouping once; a cached grouping is dropped when its
store's freshness check sees it change (Refresh dataset forces the check). A request kept waiting only by its own
user's running computations waits without the 30-second limit and is told its place every 5 seconds; behind another
user's work the wait ends after 30 seconds in the `read_busy` error frame.

(http-cell-groups-genes)=

### The genes shape

`shape: "genes"` answers the question a Gene Plot colours by: what is each gene's statistic over the cells of one
group? The moments above (`n`, `sum`, `sumsq`, `n_above`, `sum_above`) are sent for every gene of a matrix over one
group, so the browser derives mean, % expressing, mean of expressing cells, sum and SD from them without another
request.

```json
{"shape": "genes",
 "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}], "group": ["c:B cell"],
 "layer": "logged", "thresholds": [0]}
```

| Field | Meaning |
|---|---|
| `partitionings`, `small`, `group` | the grouping and the key of the group, as its `groups` list gives it: a list of level ids, or the JSON of that list. A grouping the worker holds (the code cache) is not resolved again. A key the grouping lacks is `422 group_missing` |
| `sets`, `member` | instead of a group: the cells of a table's bitset, `member` naming the set. Exactly one of `group` and `member` |
| `layer` | `X` (the default) or a layer; `404 key_not_found` when the dataset has none |
| `thresholds` | the "expressed above" values, one to 4 distinct finite numbers (default `[0]`); `n_above` and `sum_above` are taken at each |
| `transform`, `clip` | `"transform": "zscore"` (with `clip`, default 10, a number above 0 or `null`) returns the moments of each gene's z-score over the group: its mean and SD are taken over **all cells** of the matrix, so the statistic `sum / n` is the same number as a z-scored gene feature of a grouping request and as a one-gene signature's z-score mean. `n_above` and `sum_above` are 0. Only a compressed-sparse-column layer reads every stored entry for any group, which gives the reference in the same pass; a CSR or dense layer is `422 zscore_needs_csc`. `clip` without `transform` is `400 bad_feature` |
| `subset`, `estimate_only`, `confirm` | as above; the group is of the cells shown |

The result frame has `n_shown`, `n_group`, `n_var`, `moments` (the five names), `thresholds` and `group`, and one
float64 block `moments` of shape `[n_var, 5 * len(thresholds)]`: column `5 * t + m` is moment `m` at
`thresholds[t]`. Progress frames have `stage` `groups` while an unresolved grouping is read and `genes` after; for
`genes`, `done` and `total` are stored entries, as `entries_done` and `entries_total` are.

A CSR matrix reads only the stored ranges of the group's rows, a CSC matrix every gene, a dense array the row chunks
that hold a cell of the group. The estimate therefore counts the stored entries of the **data chunks** the rows touch,
from the row pointers and the chunk size: a group scattered over the dataset touches every chunk, so costs the whole
layer, while a group stored together costs its chunks only. The estimate carries `coverage`: `{entries,
layer_entries, fraction, known, n_group}`. It is exact (`known: true`) for a table's cells and for a grouping in the
code cache; for a grouping not yet resolved it is the whole layer (`known: false`), and the tier of the exact figure
is applied once the grouping has been resolved and kept: a request that needs asking or is refused then ends with a
`result` frame holding `refused: {reason: "confirmation_required" | "groups_too_expensive", message, seconds, tier,
limit, estimate}` and no block. The tiers are the others': above 60 s `409 confirmation_required`, above 10 minutes
`413 groups_too_expensive`, whose message suggests a subset (at 100 million cells only a group stored together in a
CSR matrix is cheap).

(http-matrix-kind)=
### What an input looks like

`GET /data/matrix_kind?dataset_path=&input=X&suggest=1` says what the numbers of `X`, or of the layer named by `input`,
look like, so a client can warn before a score is read from raw counts. `layout` is how the matrix is stored (`csc`, `csr` or `dense`):

```json
{"input": "X", "kind": "counts", "layout": "csc", "stats": {"kind": "counts", "n": 65536, "whole": 1.0, "min": 1.0, "max": 267.0, "negative": 0.0, "density": 0.0412, "quantiles": [1.0, 1.0, "...", 267.0]},
 "suggest": "logged_counts", "checked": {"logged_counts": "log", "MAGIC_imputed_data": "log"}}
```

It reads a sample of a few thousand stored values spread over the whole matrix, never the matrix. `stats.density` is the share of all elements that are non-zero and `stats.quantiles` the 51 values of the non-zero sample at 0, 2, ... 100 percent, which is enough to say what share of a layer lies above any threshold of 0 or more: density times the share of the quantiles above it (`null` when the sample says nothing). `kind` is
`counts` (at least 99% whole numbers, none negative, reaching 10 or more), `normalised` (not whole, none negative,
reaching 50 or more: normalised but not log-transformed), `log` (not whole, none negative, below 50),
`signed` (1% or more negative values: scaled, centred, fold changes), `other` (whole numbers that stay small)
or `unknown` (under 100 non-zero values). Only for `counts`, `normalised` and `signed` are the other matrices
(up to 12) looked at, to fill `checked` and to set `suggest` to a layer that looks log-transformed and whose
name says `log` (first) or `norm`; imputed and smoothed layers look log-transformed too and are never
suggested on their looks alone. With `suggest=0` the other matrices are not looked at (`suggest` stays `null`, `checked` empty), which is what a client listing every layer's kind uses. `404 key_not_found` for a layer the dataset does not have; the access and path
checks of every data route apply.

A closed connection stops the work: the next progress write fails and the work ends after the read in
progress. Scores take a worker's heavy lane one at a time; a running score gives way between read batches
while another waits, so a long score delays a later one by one batch at most. A score that waits more than
30 s for the lane or its memory ends with the error frame `read_busy` (the stream has already begun, so it is
not a 503). The memory a score holds (the running sum for the cells shown, and the entries read ahead, at most
about 48 million entries) is held on the worker's compute ledger (4.5 GB by default) and counts against
`server.read_budget_mb` while it runs.
The request body is at most 1 MB (`413 request_too_large`). It only reads, but it is a POST, so the forgery
check of every other POST applies.

## Dataset discovery and structure

| Route | Returns |
|---|---|
| `GET /datasets` | list of `{name, path, rel_path, cells, genes, is_link}` for the stores at the top of the data directory and in its `datasets/` subdirectory (`rel_path` says which); a store the server's zarr cannot read is listed with `cells: null` and an `error` sentence |
| `GET /datasets/folder?folder=&offset=&limit=&sort=&order=` | one folder of the data directory, a page at a time: `{folder, rel_path, parent, entries, total, offset, limit, more}`. An entry is `{name, path, rel_path, is_link, kind}` with `kind` `folder` (plus `modified`) or `store` (plus `cells`, `genes`, `format`, `modified`, or `cells: null` and an `error`). Folders come first. `sort` is `name` (default) or `modified` and `order` `asc` (default) or `desc`; the sort covers the whole folder before it is cut into pages, uses file times only (no store is opened to order it) and breaks ties by name, so pages never overlap. `limit` is capped at `server.dataset_folder_max_entries`. `404` `not_found` for a folder that is missing or that the user may not read, `400` `bad_sort` |
| `GET /datasets/search?q=&mode=&folder=&limit=` | stores below the data directory (or below `folder`) whose name or path matches `q` (a substring, or a regular expression with `mode=regex`): `{results, truncated, visited}`, each result shaped like a store entry above. `folder` limits the walk to that folder (a path, or one relative to the data directory); the path part of a match is read relative to it, depth counts from it, and the data directories an admin added are searched only when no `folder` is given. Same caps as an unscoped search. `404` `not_found` for a `folder` that is missing or not readable, `400` for a refused pattern |
| `GET /datasets/text-search?q=&folder=&limit=&offset=&current=` | stores whose attribution (title, description, authors, contacts, DOI, citation, attribution, licence, funding, provenance, source URL) or README (first 64 KB) holds every term of `q`: `{results, more, partial, index}`. `q` is words and `"quoted phrases"` (at most 8 terms and 200 characters), matched case- and accent-insensitively; a regular expression is `400 regex_not_supported`, a longer query `400 query_too_long`, more terms `400 too_many_terms`. A result is `{name, path, rel_path, title, score, matched, snippet, cells, genes, format, modified}` (counts as in a folder entry), best first (the title weighs most, then name and path, authors and contacts, the descriptive fields, the README); `current` (the path of the dataset the user has open) puts that dataset first when it matches. `snippet` is `{field, text, highlights}`, about 160 characters of the best matching field with `highlights` as `[start, end]` offsets into `text`, counted in UTF-16 code units as JavaScript counts. The text is plain: the client marks it with `textContent`, never as HTML. `folder` limits the search to the stores below it (as in `GET /datasets/search`; `404 not_found` for a folder that is missing or unreadable). `limit` defaults to 50 and is capped at 200; `offset` (default 0) skips that many hits, and `more` is how many matches the requester may open come after the page, so a client asks again with `offset` set to what it has. `partial: true` says the 1 s limit stopped the search (`more` is then a lower bound). `index` says how far the description index is, for the line under the search: `{complete: true}` when every store has its text searched, else `{complete: false, capped}` and, for an unrestricted user, `searched` (stores whose text is searched) and `total` (stores found, `null` before the first crawl ends). `capped` is `true` when part of the datasets are left out for good: more stores than `server.text_index_max_stores` or more text than `server.text_index_max_mb`. A restricted user is never told a count. A search never starts a crawl: the server builds the index by itself after it starts and keeps it fresh, so until the first crawl ends the results are empty. Local stores only; remote stores are not indexed. `403 disabled_by_policy` when `datasets.text-search.enabled` is off for the requester |
| `GET /datasets/details?path=&check=` | what one store holds, from its metadata only (no matrix is read): `name`, `path` (an absolute path; `null` for a restricted user), `rel_path`, `cells`, `genes`, `format` (`h5ad`, `zarr format 2`, `zarr format 3`, `zarr format 3, sharded`), `zarr_format`, `sharded`, `modified`, `is_link`, `link_target` (`null` unless a link and the user may see paths), `size_bytes` (an `.h5ad` file), `remote`, `readable`, `error`, `obs_columns` and `var_columns` (`[{name, kind}]`, `kind` is `categorical`, `integer`, `float`, `bool`, `string`, `datetime` or `other`; at most 500, the count in `obs_columns_total` and `var_columns_total`), `obsm_keys`, `layers_keys` (with `obsm_total`, `layers_total`), `uns_count` and `store_check`. A store that cannot be read as AnnData answers `200` with `readable: false` and the reason in `error`. `store_check` is `{ran, reason, complete, budget_reached, budget_s, worst, counts, findings, docs}` with the findings of `annzarro store check` ({doc}`../data/chunking`), stopped after `server.dataset_details_check_budget_s` (1.5 s) with `complete: false` and `budget_reached: true`. When `ran` is `false`, `reason` is `not_requested` (`check=0`, or a remote store without `check=1`), `h5ad`, `disabled` (budget `0`), `unreadable` or `unavailable`. `check=1` runs the check on a remote store, `check=0` skips it on a local one. The answer is cached by the store's file times, so asking again costs a few `stat` calls. A missing store, and one the user may not read, answer alike: `404` `not_found`, as `/data/info` does; `403` for a path outside the server's data directories or a remote URL the server refuses |
| `GET /datasets/info?path=&parts=` | what a dataset says about itself, one part at a time; `parts` is a comma-separated choice of `about`, `readme` and `structure` (all three by default; anything else is `400 bad_parts`). The reply is `{name, about?, readme?, structure?}` and never carries the path. `about`: `{present, source, fallbacks, ignored, unknown, schema, has_readme, title?, description?, license?, license_url?, citation?, doi?, doi_url?, authors?, source_url?, contact?, contact_url?, attribution?}` from `uns["annzarro"]`, read by the reader of its schema version (`schema` is `{name, version, declared, newer, reader, note}`; `unknown` lists the keys this version does not know; {ref}`dataset-info-schema`); `contacts`, `funding`, `provenance`, `author_details` and `license_id` appear for the richer forms (`source` is `annzarro`, `uns` for the keys other tools write, or `null`); links are only `http`, `https` or `mailto`, a text over 16 KB is cut, and a value that is not text is listed in `ignored`. `readme`: `{present, text, truncated, bytes, limit_bytes, problem}` from `uns["README"]`, cut at 256 KB; `problem` is `null`, `not_text` or `too_large` (stored over 8 MB, not read). `structure`: `{n_obs, n_vars, X, obs, var, obsm, varm, obsp, varp, layers, raw, uns, other, capped, caps}`, one typed entry per element named after the AnnData on-disk spec: `encoding` (`encoding-type`, or `array`), `shape`, `dtype`, and what the encoding adds (`nnz` and `density` for `csr_matrix`/`csc_matrix`; `columns` and `column_names` for `dataframe`; `categories` and `ordered` for `categorical`; `length` and `form` for `awkward-array`). A column is `{name, kind, dtype, encoding, nullable, categories?, ordered?, codes_dtype?, colors?, colors_mismatch?, labels?, label_colors?}` (at most 500; `total` says how many; `labels` are the first 10 category labels, read for the first 100 categorical columns of a local store only); `obs.index` and `index_dtype` name the index. An encoded `uns` member (dataframe, categorical, sparse matrix) is one entry with `type: encoded`, never a group of its parts; short scalars and `*_colors` lists carry a `value` or `colors` preview (100 per reply). `raw` (`null` without one) is `{X, var_columns, varm_keys, shown_in_plots: false}`; `other` lists top-level groups the spec does not have. The `uns` tree is cut at depth 4 and 400 nodes, labels at 100 characters. On a remote store the read stops after 10 s with `capped: "deadline"`. `caps` states every limit applied. It reads metadata and the text values only, never `X` or a matrix, from `.h5ad`, zarr format 2 and 3 and remote stores ({doc}`../deployment/dataset-attribution`). A store that cannot be read as AnnData is `422 unreadable`; a missing store, and one the user may not read, answer `404 not_found`; `403` as for `/datasets/details`. Cached by the store's file times, and for `uns`, so annotating a store shows at the next request. A local store's reply carries a weak `ETag` (from the parts and the same file times) and `Cache-Control: private, no-cache`; a request with a matching `If-None-Match` is answered `304` without reading; a remote store's has neither |
| `GET /data/dataset_structure?dataset_path=` | everything the menus need: `shape`, `n_obs`, `n_vars`, and per slot `available`, `keys` / `columns`, `info` (shape and type per key), `columns_info` (dtype per obs/var column), dataframe columns of `obsm`/`varm`. A store without `X` has `"X": {"available": false, "shape": null}` |
| `GET /data/fingerprint?dataset_path=&wait=` | the store's fingerprint for saved views: `{status, fingerprint, path, rel_path, annzarro_version}`. `status` is `ready`, or `pending` while a large store's cell and gene names are hashed in the background (then `fingerprint` holds `n_obs`, `n_var`, `meta`, `groups` and `fields` only); `wait` (seconds, at most 10) waits for it, and is what starts the hashing: a call with `wait=0` (opening a dataset) answers from what is known and never starts it. The metadata tier (`meta`, `groups`, `fields`) is read from the store's consolidated metadata, one file plus a directory listing each of the root and the field groups, whatever the number of nodes; a store without consolidated metadata, or whose consolidated metadata is out of date (a refresh found it stale, or its members are not those on disk), is walked instead, which on a network file system takes seconds when cached and minutes when cold. `rel_path` is the path relative to the data directory, `null` outside it. Missing store: 404 `not_found` ({doc}`../user-guide/reproducing`) |
| `GET /data/info?dataset_path=` | a shorter summary: `shape`, `has_*` flags, `obs_columns`, `var_columns`, `layers`, `embeddings` |
| `GET /data/genes?dataset_path=` | `{"genes": [...], "dataset_path": ...}`, all `var_names` (146 kB here). The key order is the JSON provider's: `dataset_path` comes first. A zarr store streams the names, with `X-Annzarro-Names` and no `Content-Length` (as for `/data/cells`) |
| `GET /data/cells?dataset_path=` | `{"cells": [...], ...}`, all `obs_names` (275 kB here). A zarr store streams them a chunk at a time (chunked transfer, no `Content-Length`; `X-Annzarro-Names` is their number and `X-Annzarro-Names-Bytes-Estimate` about their JSON size; gzip is applied as the stream goes). With `subset=`, the subset's names only, in dataset order; the server reads just those (below) |
| `GET /data/obsm_dataframe_columns?dataset_path=&key=` | `{"columns": [...]}` of a dataframe-valued obsm entry |
| `GET /data/varm_dataframe_columns?dataset_path=&key=` | the same for varm |

```console
$ curl -s "http://127.0.0.1:8812/api/v1/datasets" | python -m json.tool | head -9
[
    {
        "cells": 8090,
        "genes": 16285,
        "is_link": false,
        "name": "bm_aging_annzarro.zarr",
        "path": "/Users/me/annzarro-data/bm_aging_annzarro.zarr",
        "rel_path": "bm_aging_annzarro.zarr"
    },
```

```console
$ curl -s "http://127.0.0.1:8812/api/v1/datasets/details?path=liver.zarr" | python -m json.tool
{
    "cells": 8090,
    "format": "zarr format 2",
    "genes": 16285,
    "name": "liver.zarr",
    "obs_columns": [{"kind": "categorical", "name": "cell_type"}, ...],
    "obsm_keys": ["X_umap"],
    "store_check": {"ran": true, "complete": true, "budget_reached": false, "worst": "ok", "findings": [], ...},
    ...
}
```

### Looking up datasets by path

`POST /datasets/lookup` with `{"paths": [...]}` (a JSON body, at most 200 paths) answers
`{"results": [...]}`, one result per path, in the order sent. This is how the list of recently opened
datasets is shown: it can name a store in a subfolder or a remote URL, which the top-level listing does
not carry.

- A store the requester may read comes back as the entry `GET /datasets/folder` lists for it: `name`,
  `path`, `kind`, `rel_path` (inside the data directory only), `cells`, `genes`, `format`, `modified` and
  `is_link`; a store that cannot be read as AnnData has `cells: null` and an `error` sentence. A remote
  store has `remote: true`.
- Anything else is `{"path": "<as sent>", "status": "unavailable"}`. A store that does not exist, one
  outside the data directories, one a restricted user ({ref}`http-restricted`) is not granted, a folder that
  is not a store, a remote URL this server or this user may not open and a remote store that does not
  answer all get this one answer, so it never tells a missing store from one the requester may not read.
- Counts of a local store come from the listing's probe, cached by the store's stat signature. A remote
  store is opened only where remote stores are enabled and the requester may read the URL, and its counts
  are kept for five minutes. At most 20 remote stores are opened per request; the others are answered
  `{"path": ..., "status": "unchecked"}` and a repeat of the request gets them.
- It only reads, but it is a POST, so the forgery check of every other POST applies: the page's
  `X-AnnZarro-CSRF` header with login on, the `Origin` check without.
- More than 200 paths, or a body that is not `{"paths": [strings]}`: `400` (`cap_exceeded`, `bad_request`).

## Panel sets

Panel sets are JSON files in `<state_dir>/panel-sets/` ({ref}`panel-sets-location`), shared by all users of a server
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
| `GET /auth/me` | `{auth_enabled, username, is_admin, exposed, may_open_any_path, remote_stores, restricted}`; `restricted` is true for a user who sees only the datasets they are granted ({ref}`http-restricted`); `exposed` is true when the server listens beyond localhost with login off; `may_open_any_path` says whether this requester may open paths outside the data directories (`server.arbitrary_paths`) |
| `GET /config` | the `public` tier of the configuration ({doc}`configuration`): `server` (`host`, `port`, `https_enabled`, `unified_server`), `auth.enabled` (when set), `branding`, `ui` and `integrations`, plus the flat keys the web client reads (`host`, `port`, `app_name`, `project_description`, `contact_info`, `enabled_panel_types`, `integrations`, `ui_*`) and the flags `electron_mode` and `local_mode`. Never `data_dir`, log or users-file paths, limits, cache or remote-store settings |
| `GET /health` | `{"status": "ok"}` with `Cache-Control: no-store`, for a service manager's, container runtime's or load balancer's probe ({ref}`lab-server-health`). Open without login, reads no dataset and names nothing of the server; `HEAD` works too |
| `GET /status` | version, uptime, memory, data directory checks. On a shared server only an admin gets this (it names the data directory, the host and the process); everybody else gets `{"server": {"status": "running", "version"}}`. It needs a login when login is on; a probe uses `/health` |
| `GET /cache/info` | the server's result cache of the process that answers: datasets, items, `memory_usage_mb` (exactly what the cache holds), `max_memory_mb`. On a shared server admins only (`403 admin_only` otherwise: the datasets named are what other users opened) |
| `POST /cache/reset` | clear it, for all datasets or `?dataset_path=`, and start a new generation of them (new ETags, {ref}`revalidation`). On a shared server admins only (`403 admin_only` otherwise), and the audit log records it. Each gunicorn worker has its own cache: the one that answers clears it now, the others drop the dataset's entries on their next request, when they see the new generation |
| `POST /data/refresh?dataset_path=` | walk the dataset's files (modification time and size) and start a new generation, always, so every worker reads the dataset again and the browser's revalidations get new tags; the walk's finding is reported (`changed`), not required. Open to every user who may read the dataset; a user's refresh is what makes every user's cached reads of that dataset new, so it is limited to one walk per dataset per `server.refresh_min_interval_s`. Bounded: concurrent refreshes in a worker share one walk; a dataset is walked at most once per `server.refresh_min_interval_s` (10 s) across workers, and a refresh sooner never waits in the server: it schedules one walk for the interval's end, shared by every refresh meanwhile, and answers at once `{"status": "scheduled", "after", "retry_after_s"}`; `POST /data/refresh?dataset_path=&after=<after>` then returns the result of the first walk that started at or after `after` (or `scheduled` again until there is one), so the answer always comes from a walk that started after the first request (the browser does this); a walk stops after 3 s, and a store too large to fingerprint fully answers `status: "partial"` (with a `message`; `changed` is then unknown) and is bumped all the same, so its in-place chunk writes are served (the app shows the `partial` answer to the user as a notice, once per Refresh press). Answers `{"status": "full" or "partial" or "remote" or "scheduled", "changed": bool, "checked": bool, "refreshed": true, "waited_s", "consolidated_metadata": null or {"stale": true, "detail", "message", "fix"}}`; when the store's consolidated metadata no longer describes it (an element added or rewritten without `zarr.consolidate_metadata`), the store is read without it until it is consolidated again, and `dataset_structure` carries the same `consolidated_metadata` notice. The header's Refresh dataset and each panel's Refresh call it |
| `GET /policy/effective?keys=a,b` | the policy as this requester gets it (the client never resolves anything itself): `{version, values}` for the settings the page reads, or only the named ones. The reply is `no-store`, and every API reply carries `X-AnnZarro-Policy` with the same `version`, so an open page notices a change on its next request ({doc}`../design/policy-registry`). Open to every signed-in user |
| `GET /admin/...` | the admin interface, {ref}`below <http-admin>` |
| `GET /directories/home`, `GET /directories/list?path=` | the data directory and its entries (dataset browser). For a restricted user `directory` is `null` and the listing starts at their grants |
| `GET /zarr/url?url=` | whether a URL is an acceptable remote store |

Also registered but not used by the web client: `/data/paginated`, `/data/statistics`,
`/data/by_path`, `/core/datasets`, `/zarr/to_anndata` (a metadata summary: shape, the first ten obs and var names, key lists, column types; it opens no matrix, so a store with a dense 175,000 x 175,000 `obsp` answers it at once), and the path-segment forms
`/datasets/<path>`, `/datasets/<path>/info`, `/datasets/<path>/uns/...`, and
`/datasets/uns/<key>?dataset_path=`. In the path-segment
forms `<path>` is relative to the data directory (`/datasets/bm_aging_annzarro.zarr`,
`/datasets/bm_aging_annzarro.zarr/uns/neighbors/params`); a path that does not exist is `404 not_found`,
one that is not a dataset `400 unsupported_type`.

(http-site)=
## Public site pages

Outside `/api/v1`, under `server.url_prefix`, and open without sign-in, so they can be linked from
outside. They are configured under `site` ({doc}`../deployment/public-site`).

| Route | Returns |
|---|---|
| `GET /site/imprint`, `/site/privacy`, `/site/accessibility`, `/site/terms` | the text as a plain HTML page (no JavaScript); a text configured with a `url` redirects there (`302`); a text that is not configured is a plain-text `404` |
| `GET /site/about` | the About dialog as a page: the site's block and AnnZarro's credit |
| `GET /site/data` | Data & privacy, generated from the running configuration: what the browser keeps, the cookies, what the Gene Set panel may send to which services, and the privacy notice if one is configured |
| `GET /robots.txt` | `User-agent: *` and `Disallow: /` when `site.robots` asks search engines to stay away (`noindex`, or `auto` with login on; every reply then also carries `X-Robots-Tag: noindex, nofollow`); otherwise `404` |
| `GET /.well-known/security.txt` | `Contact`, `Expires` (a year ahead) and `Preferred-Languages` (RFC 9116) when `site.security_contact` is set; otherwise `404` |

(http-admin)=
## Admin API

The admin page ({doc}`../deployment/admin`) uses these routes, and a script can use them with
a session cookie. Every route is under `/api/v1/admin/`. With login off each answers `404`
`admin_requires_login`. `GET /admin` is the page itself. Request and reply bodies are JSON.
Replies are `Cache-Control: no-store`.

Every admin route checks, in this order, and answers at the first failure:

| Check | Refusal |
|---|---|
| Signed in | `401` (a redirect to the login page for `/admin`) |
| The user is an admin, read from the users file on every request | `403` `admin_only` (audited for an unsafe method) |
| For `POST`, `PUT`, `DELETE`: the CSRF token of the session in the header `X-AnnZarro-CSRF` (the page carries it in `<meta name="annzarro-csrf">`; `GET /auth/me` does not return it), an `Origin` equal to the server's own address (see `server.proxy_count`), and `Sec-Fetch-Site` `same-origin` if sent | `403` `csrf_failed` |
| For the same methods: `Content-Type: application/json` | `415` `json_required` |
| For the same methods except `reauth`: the password was entered within `server.admin_reauth_minutes` (30) | `403` `reauth_required`, with `reauth_url` |
| At most `server.admin_rate_per_minute` (30) changes a minute per admin and worker, eight times as many reads | `429` `admin_rate_limited`, with `Retry-After` and `retry_after` |

Errors are `{"error": <sentence>, "reason": <code>}`, plus fields named below. A stored file
that does not parse (`overlay.json`, `access.json`) is `503` `overlay_unreadable` or
`store_unreadable`: nothing is written until it is repaired. A lock held longer than
`server.lock_timeout_s` is `503` `busy`.

### Re-authentication and the audit log

| Route | Body or query | Returns |
|---|---|---|
| `POST /admin/reauth` | `{"password"}` | `200 {"reauth_until": <ISO time>}`: the password is confirmed and changes are allowed for `server.admin_reauth_minutes`. `401` `bad_password` (counts toward the login lockout), `423` `locked`, `400` `bad_request`, `500` `password_unsupported` |
| `GET /admin/audit` | `before_seq` (records older than this), `limit` (1 to 500, default 100) | `{"records": [...]}` newest first. Without `before_seq` also `"chain"`: `{ok, first_bad_seq, problem, first_seq, last_seq, records, torn}`. `problem` is `tampered`, `truncated` or `head_unreadable` when `ok` is false. `400` `bad_request` for a value that is not an integer |

A record is `{seq, ts, actor, addr, via, action, target, detail, outcome, prev, hash}`; `via` is
`web` or `cli:<user>`, `outcome` is `ok` or `refused:<reason>`.

### Users

Changes go through the same code as `annzarro user`, under the lock of the users file. A username
is letters, digits and `. _ @ -`, up to 64 characters. A password has at least 10 characters and
differs from the username. Where a password is asked for, `"generate": true` asks the server to
make one instead: it is in the reply to that request and nowhere else (not in the logs, not in the
audit log).

| Route | Body | Returns |
|---|---|---|
| `GET /admin/users` | | A list of `{username, is_admin, last_login, password_changed_at, locked: [{address, until, failures}], panel_sets, last_seen}`. `last_seen` is the user's latest request on any worker within the session timeout, else `null` |
| `POST /admin/users` | `{"username", "password"` or `"generate": true, "is_admin"?}` | `201 {"username", "password"?}`. `400` `invalid_username`, `weak_password`, `bad_request`; `409` `user_exists`. Audited as `user.add` |
| `DELETE /admin/users/<username>` | `{"reassign_to"?}` | `{"removed", "panel_sets_reassigned"}`. With `reassign_to` the removed user's panel sets pass to that user (audited as `panelset.reassign`); without it they keep the removed name as owner, so only an admin can change them. `404` `unknown_user`; `400` `bad_request`; `409` `self`, `last_admin`. Audited as `user.remove`. The user's logins end |
| `POST /admin/users/<username>/password` | `{"password"` or `"generate": true}` | `{}` or `{"password"}`. The user's other logins end; an admin who resets their own password stays signed in. `400` `weak_password`; `404`. Audited as `user.password` |
| `POST /admin/users/<username>/admin` | `{"is_admin"}` | `{"is_admin"}`. `409` `self` (you cannot revoke your own right here), `409` `last_admin`. Audited as `user.set_admin` |
| `POST /admin/users/<username>/unlock` | `{"address"?}` | `{"cleared"}`: how many failed-login records were cleared, for one address or all. Audited as `user.unlock` |

A refused change (`self`, `last_admin`, `user_exists`) is audited with the outcome `refused:<reason>`. If only
the audit write fails, the change stands and the reply has `audit_failed: true`. A user the
command line removes, or whose password it changes, is handled the same way.

The signed-in user changes their own password with a page and one route, open to every user (not
admin routes; they need the CSRF token and a JSON body like the admin routes):

| Route | Returns |
|---|---|
| `GET /account/password` | the change-password page |
| `POST /api/v1/account/password` `{"current", "new"}` | `{"changed": true}`. `403` `bad_password` (counts toward the same lockout as sign-in), `423` `locked`, `400` `weak_password`, `same_password`, `bad_request`; `403` `csrf_failed`; `415` `json_required`. The user's other logins end, this one stays. Audited as `account.password` |

### Data directories

Adding needs `server.admin_data_roots` ({ref}`admin data directories <admin-data-roots>`).

| Route | Body or query | Returns |
|---|---|---|
| `GET /admin/data-roots` | | `{"parents": [{path, ok}], "roots": [...], "overlay": {ok, error}}`. A root is `{path, real, source, active, stores, stores_capped}`; `source` is `data_dir`, `config` or `admin`; an admin root also has `added_by`, `added_at`, and an inactive one `inactive_reason` |
| `GET /admin/data-roots/browse` | `path` (absolute; none lists the parents) | `{"path", "dirs": [{name, path, is_root}], "capped"}`: the sub-directories that lie inside a parent. `403` `admin_roots_disabled`, `400` `not_absolute`, `403` `outside_admin_parents`, `404` `not_found` |
| `GET /admin/data-roots/datasets` | `root`, `folder`, `offset`, `limit` | one page of the stores in a folder of an active root, as the dataset browser lists them. `403` `not_a_root`, `400` `bad_request`, `404` `not_found` |
| `POST /admin/data-roots` | `{"path"}` | `201` with the root. `400` `bad_request`, `not_absolute`, `not_a_directory`; `403` `admin_roots_disabled`, `outside_admin_parents`, `is_a_parent`, `contains_server_state`; `409` `already_allowed`, `too_many` (100). Audited as `data_roots.add` |
| `DELETE /admin/data-roots` | `{"path"}` | `{"removed", "panel_sets_affected"}`. `409` `from_config` (a directory of the YAML), `404` `unknown_root`. Audited as `data_roots.remove` |

### Health and cache

| Route | Body | Returns |
|---|---|---|
| `GET /admin/version-check` | | `{enabled, current, latest, update_available, upgrade_command, url}` for an admin. `current` is the running version. When `server.update_check` is on (and the server is not the desktop app) the server asks PyPI, at most once in six hours per process, and `update_available` is true only for a newer final release: then `latest`, `upgrade_command` and `url` (the release notes) are set. A failed request answers `update_available: false`. Off, or in the desktop app: `{enabled: false, reason: "disabled" or "desktop", current}` |
| `GET /admin/health` | | `{workers, totals, active, window_s, panel_sets, warnings, description_search}`. `description_search` is `{enabled, state, built_at, complete, capped, stores, searchable, not_yet, unreadable}`: `state` is `idle`, `running`, `done`, `partial` or `failed`, `built_at` seconds since the epoch. A worker is `{pid, host, started, age_s, stale, requests, refusals, read_guard, cache, rss_mb}`: `refusals` counts replies by their `reason`, `read_guard` is `{budget_mb, share_mb, in_flight_mb, by_requester}`, `cache` is `{datasets, memory_mb, max_mb, name_index_mb}`. `rss_mb` is the worker's resident memory. A worker is `stale` when its snapshot is over a minute old; `totals` (`refusals`, `cache_mb`, `read_in_flight_mb`, `rss_mb`) sums the workers that are not. `active` lists the users seen within `window_s` (the session timeout). Each worker's snapshot is at most 2 s old |
| `POST /admin/cache/clear` | `{"dataset_path"?}` | the result of the clear, as `POST /cache/reset`, in every worker. `400` `bad_request`. Audited as `cache.clear` |
| `POST /admin/text-index/rebuild` | `{}` | crawl the datasets now so the description index is read again for what changed: the Health block's description search, plus `started` (`false` while a crawl runs). `409 disabled` while the search is off. Audited as `text_index.rebuild`; no rate limit beyond the one crawl at a time |

### Panel sets

The files of `<data_dir>/sessions/`, by owner. A reassign or delete holds the same lock as every
save, so a save running at the same time loses neither.

| Route | Body or query | Returns |
|---|---|---|
| `GET /admin/panel-sets` | `owner` (only this owner's), `offset`, `limit` (1 to 1000, default 100) | `{"items": [{name, owner, dataset, bytes, modified_at, modified_by}], "total", "usage": [{owner, count, bytes, limit}], "server": {count, max, mb, max_mb}}`. Newest first. `usage` and `server` cover the whole server, against `server.max_sessions_per_user` and the server limits; `owner` is `null` for sets saved before owners were recorded, `limit` and `max` are `null` when off. `400` `bad_request` for a value that is not an integer |
| `POST /admin/panel-sets/reassign` | `{"to_owner", "names": [...]}` or `{"to_owner", "from_owner"}` (not both; 1 to 1000 names) | `{"moved", "unchanged", "over_quota"}`. All or nothing: `404` `not_found` with `names` for a set that does not exist, `409` `unreadable` with `names` for a file that cannot be read, `404` `unknown_user` for `to_owner`, `400` `bad_request`. An admin may take a user past their quota; `over_quota` says so. Audited as `panel_sets.reassign` (target: the new owner; the count, up to 50 names and the previous owners) |
| `DELETE /admin/panel-sets` | `{"names": [...]}` (1 to 1000) | `{"deleted", "missing"}`; names that are not sets are listed in `missing`. Audited as `panel_sets.delete` (the count and up to 50 names with their owners) |

### Access

Who may read which datasets ({ref}`admin-access`). All of these are admin routes with the checks above
and are audited (`access.restrict`, `access.unrestrict`, `access.grant`, `access.revoke`; a refusal
as `refused:<reason>`). Changes run under the lock of `access.json`, next to the per-user settings
that live in the same entry, which they keep. A file that exists but does not parse is never
replaced: the routes answer `503 store_unreadable` and the data routes refuse every non-admin
until it is repaired.

| Route | Body or query | Returns |
|---|---|---|
| `GET /admin/access` | | `{"store": {ok, error}, "users": {<name>: {restricted, is_admin, grants, active, policy_overrides}}, "roots": {<real path of a data directory>: [users]}}`. The line per user of the Users table, and, for each data directory, the restricted users with an active local grant in it or below it. `restricted` is `false` for an admin whatever is stored. While `access.json` is unreadable (`store.ok` false), `restricted`, `grants`, `active` and `policy_overrides` are `null` ("unknown", not a guess) and `roots` is empty |
| `GET /admin/users/<u>/access` | `offset`, `limit` (1 to 500, default 100) | `{restricted, stored_restricted, is_admin, all, grants: [{kind, path, real, active, inactive_reason, added_by, added_at}], stores: {items: [{name, path}], total, offset, capped}, remote_prefixes, policy_overrides}`. `all` is true when the user reads everything (not restricted, or an admin). `stores` lists what the active local grants add up to (at most 5,000; `capped` says when it stopped there, and the walk shares the `dataset_scan_max_entries` budget; a link leading out of a granted folder is not counted). `stored_restricted` is the stored flag, which stays true for an admin who was restricted before being made one. `404` `unknown_user`, `400` `bad_request`, `503` `store_unreadable` |
| `PUT /admin/users/<u>/access` | `{"restricted": true or false}` | the same document after the change. `409` `admin_unrestricted` for an administrator. Un-restricting keeps the grants |
| `POST /admin/users/<u>/grants` | `{"kind": "dir" or "store" or "remote" or "stores_in", "path"}` | `201 {"added": [{kind, path, added_by}], "skipped": [...]}`. `stores_in` adds one `store` grant for every store directly in the folder. `400` `bad_path`, `bad_kind`, `not_a_directory`, `too_many`, `bad_request`; `403` `outside_data_roots` (the path is not inside a data directory), `remote_not_allowed` (remote stores are off or the URL is outside `server.remote_allowlist`); `404` `not_found`; `409` `already_granted` |
| `DELETE /admin/users/<u>/grants` | `{"path"}` | `{"removed": [{kind, path}]}`. `404` `not_found` |
| `GET /admin/access/check` | `user`, `path` (an absolute path or a remote URL) | `{"allowed", "via": {kind, path} or null, "reason"}`: a sentence for the admin, including that a grant is inactive and why, or that the path is outside every data directory. `404` `unknown_user`, `400` `bad_request` |

### Settings

The settings are the keys of the policy registry ({doc}`../design/policy-registry`).

| Route | Body | Returns |
|---|---|---|
| `GET /admin/policy` | | `{version, store_problems, keys, unknown, issues}`. A key is its declaration (`name`, `type`, `scope`, `area`, `description`, `combine`, `restart`, `routes`, `config_path`, `section`, `guide`, `label`, `config_file`, `config_file_setting`) with `default`, `value`, `source` (`user`, `admin`, `env`, `config`, `default` or `forced`), `locked`, `layers` (the value of each layer that set it), `inherited` (what applies if the admin value is removed) and `outbound_hosts_now`. `unknown` lists stored names no version declares; `issues` the stored values that are ignored |
| `PUT /admin/policy` | `{"<key>": value, ...}`; `null` removes a value. `feature.remote_stores` (Remote datasets, with a `section` of `data`) takes `{"mode": "off" or "allowlist" or "any", "allowlist": [URL prefix]}`; its key also carries `config_value` and `config_origin` (`config` or `env`) when the operator set it; a refused value is `400` with `messages` naming the problem per key | the same document after the change, and `capped` (for values wider than the layer below) |
| `GET /admin/site/texts` | | `{"texts": {"imprint": ..., "privacy": ..., "accessibility": ..., "terms": ...}}`: each text as the pages show it now, `{label, url, markdown}` or `null` when not shown. A text the config file reads from a `file` carries the file's content as read at start; the Public site section previews it from here |
| `GET /admin/users/<username>/policy` | | the keys a user may override, with `override` and `has_override`, `values` (what is stored), and `effective`. `404` `unknown_user` |
| `PUT /admin/users/<username>/policy` | as above | the same document after the change |

A `PUT` is all or nothing. It is refused with `400` `invalid_settings` for an unknown key, a
value of the wrong type, out of range or not among the choices (`errors` maps each key to its
code: `unknown_key`, `bad_type`, `out_of_range`, `bad_choice`), and with `409` for a key
the operator decided (`reason` `locked_by_config`), one the YAML alone sets
(`config_scope`, the `limits.*` keys), a per-user value on a server-wide key
(`server_scope`), a restrict key set wider than the YAML allows (`config_ceiling`), and any key
for an administrator's per-user policy (`admin_user`). Audited as `policy.update`; if only the
audit write fails the change stands and the reply has `audit_failed: true`.

(http-restricted)=
## Restricted users

An administrator can restrict a user to chosen datasets ({ref}`admin-access`). The routes are the
same; what differs for a restricted user:

- A dataset, folder or search outside their grants answers exactly as one that does not exist
  (`404 not_found`, or an empty list on the legacy `core/datasets?dir=`), whatever the cause:
  allowed directory or not, present or missing. `If-None-Match` of an earlier read does not get a `304`.
- `GET /datasets/details` leaves `path` and `link_target` out (`null`) and gives `rel_path` from the name of
  the granted folder or store; a `folder=` of `GET /datasets/search` or `GET /datasets/text-search` must lie inside a grant.
  `GET /datasets/text-search` returns only stores inside their grants, with the `path` of the store (as their listings give it) and `rel_path` from the granted folder or store's name; its `index` never tells them how many stores the server holds.
- `GET /directories/home` answers `{"directory": null}`. Their listings start at their grants
  and name no folder above one: `parent` is `null` at a grant, and `rel_path` is relative to the
  granted folder (`null` on `/datasets/<path>`).
- `GET /sessions/list`, `load`, `export` and the other panel-set routes show their own sets and
  those whose datasets they can all read; the others answer as missing. A save over the name of a
  hidden one is `409 name_taken` (the owner is not named). Fields that hold the sessions
  directory's path (`file`, `old_file`, `new_file`, `source_file`) are `null`.
- `GET /status` and `GET /cache/info` answer `403 admin_only`.
- If `access.json` cannot be read, every non-admin data route answers
  `503 {"reason": "access_unavailable", "code": "store_unreadable"}` until it is repaired; admins
  keep working, and the policy for non-admins falls back to the most restrictive values.

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
| 400 | `regex_too_long`, `regex_too_complex`, `bad_regex` | a `/data/names` pattern (`mode=regex`) over `server.name_search_max_regex_chars`, one that repeats a repeat or branches inside a repeat (`(a+)+`), or that does not compile |
| 400 | (none) | a required parameter is missing, e.g. `{"error":"dataset_path parameter is required"}` |
| 401 | (none) | login on, no session; checked first |
| 403 | `outside_data_dir` | local path outside the data directory and `allowed_dirs`, on a shared server (or anywhere with `server.arbitrary_paths: none`), for a requester `server.arbitrary_paths` does not let through (the message names no server directories) |
| 403 | `access_denied` | remote store refused by the remote-store policy |
| 403 | `csrf_failed` | a changing request without the session's `X-AnnZarro-CSRF` token, or from another origin |
| 403 | `not_owner`, `legacy_admin_only`, `admin_only` | panel-set permissions; `admin_only` also for `POST /cache/reset` on a shared server |
| 404 | `not_found` | dataset path does not exist; panel set not found (no `reason`) |
| 404 | `key_not_found` | a layer, obsm, varm, obsp, varp or uns key, an obs/var column or an obsm/varm `column_name` that the dataset does not have (also when the whole `layers`/`obsp`/`varp` group is missing); `X` in a store without `X`; a subset column that does not exist |
| 409 | `session_quota_user`, `session_quota_total` | saving, duplicating or importing a panel set would pass `server.max_sessions_per_user`, `server.max_sessions` or `server.max_sessions_mb`; the body has `limit` and `used`. Delete sets you no longer need |
| 400 | `bad_recipe`, `bad_clip`, `bad_method`, `bad_seed`, `bad_bins`, `bad_controls`, `bad_detect_above`, `bad_down_weight`, `method_no_down`, `unsupported_version` | `POST /data/gene_score`: a recipe the server cannot use ({ref}`http-gene-score`) |
| 409 | `confirmation_required` | a gene score whose estimate is over 60 s and not over 10 minutes, sent without `confirm: true` |
| 413 | `score_too_expensive` | a gene score estimated over 10 minutes |
| 413 | `groups_too_expensive` | a `POST /data/cell_groups` request estimated over 10 minutes ({ref}`http-cell-groups`) |
| 400 | `bad_request`, `unknown_field`, `bad_bins`, `bad_thresholds`, `set_length_mismatch`, `nested_too_deep` | `POST /data/cell_groups`: a request the server cannot use ({ref}`http-cell-groups`) |
| 422 | `grid_too_large`, `too_many_bins`, `too_many_levels`, `too_many_sets`, `too_few_sets`, `too_many_partitionings`, `too_many_thresholds`, `obsp_too_large` | `POST /data/cell_groups`: a limit met before any read, with `count` and `limit` |
| 413 | `request_too_large` | the request body is over `server.max_request_mb` (64 MB; panel-set saves and imports) |
| 413 | `response_too_large` | the slice exceeds `max_response_elements` (below) |
| 431 | (none) | `annzarro start` only: the request line and headers together are over 262,144 bytes (waitress answers, not the app; under gunicorn a header field over `server.limit_request_field_size` is a `400`) |
| 503 | `read_busy` | the `obsp`/`varp` reads in flight hold `server.read_budget_mb`, or this user already holds `server.read_user_share_percent` of it, or the cell subsets being computed hold `server.subset_budget_mb` for longer than `server.subset_wait_s`; `Retry-After` seconds and `retry_after_s` say when to ask again (the web client does once) |
| 400 | `rows_required`, `too_many_rows` | an `obsp`/`varp` request (`/data/obsp/<key>`, `/data/varp/<key>`, and those paths in `/data/by_path`, `/data/paginated`, `/data/statistics`) that names no rows, or more than 1,000. Pairwise matrices are read by rows only: send `rows=` (or `dataset_rows=`); `cols=` only filters the rows asked for. Nothing is read |
| 413 | `read_too_large` | an `obsp`/`varp` read, or a `uns` member read whole (`/data/uns/<key>`, about 100 bytes per value as a JSON reply), would hold more than `server.max_read_mb` in memory (estimated from metadata, before reading); the body has `limit_mb`, `requested_mb` and `elements` (the element, its stored shape, rows, columns and estimated MB) |
| 400 | `too_many_categories` | `/data/subset` balancing across a column of more than 10,000 categories. No reply is refused for its number of labels: a categorical codes reply (`format=f32&categorical=codes`, one column) is streamed in bounded memory. A JSON reply, and any request for several columns, is not: it builds every label of the rows asked at once, so for a column with millions of categories (a barcode on every cell) ask for that column alone through the codes route |
| 500 | `stale_metadata` | the store's consolidated metadata (`.zmetadata`) no longer matches an array on disk, usually after an in-place rewrite. `POST /data/refresh` (Refresh dataset) reads the store without the stale metadata from then on; re-consolidate (`zarr.consolidate_metadata(path)`) and refresh again |
| 500 | `read_failed` | any other failure to read an array the store lists, with the exception text |
| 501 | `missing_dependency` | a remote store without the `annzarro[remote]` extras |
| 504 | `remote_timeout` | a remote store did not answer in time |
| 504 | `remote_deadline` | one request used up `server.remote_request_timeout_s` on a remote store; the body has `host`, `limit_name` and `limit_s` |

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
| `server.max_read_mb` | 5% of RAM (256 MB to 4 GB) | memory an `obsp`/`varp` read, or a `uns` member read whole, would hold, from shape, dtype and stored sizes, before reading (`/data/obsp`, `/data/varp`, `/data/by_path`, `/data/paginated`, `/data/statistics`) | `413 read_too_large` |
| `server.read_budget_mb` | 2 × `max_read_mb` | pairwise reads in flight in one worker, each by its estimate; waits `server.read_wait_s` (5 s) | `503 read_busy` |
| `server.name_search_max_regex_chars`, `server.name_search_timeout_s` | 200 characters, 10 s | a regex name search (`/data/names?mode=regex`): the pattern, then the scan | `400 regex_too_long`, `400 regex_too_complex`; after the time limit a `200` with `partial: true` and `timed_out: true` |
| `server.dataset_scan_max_entries` | 200,000 | directory entries read by `GET /core/datasets` and the store count in `GET /status` | `200` with `truncated: true` |
| `server.max_request_mb` | 64 | the request body (`POST /sessions/save`, `/sessions/import`, `/login`), from `Content-Length` and while reading | `413 request_too_large` |
| `server.max_sessions_per_user`, `server.max_sessions`, `server.max_sessions_mb` | 500, 5,000, 256 MB | panel sets of the user, of the server, and their total size, when one is saved, duplicated or imported | `409 session_quota_user`, `409 session_quota_total` |
| `server.dataset_folder_max_entries`, `dataset_search_max_depth`, `dataset_search_max_entries` | 500, 6, 20,000 (and 3 s) | the dataset browser's folder listing (`GET /datasets/folder`) and search (`GET /datasets/search`) | `200` with `more` / `truncated: true`; `400` `regex_too_long`, `regex_too_complex`, `invalid_regex`, `query_too_long` |
| `server.dataset_details_check_budget_s` | 1.5 s | the store check inside `GET /datasets/details` | `200` with `store_check.budget_reached: true` |
| `server.text_index_workers`, `text_index_store_timeout_s`, `text_index_max_stores`, `text_index_readme_kb`, `text_index_max_mb` | 2, 15 s, 20,000, 64 KB, 64 MB | the crawl behind `GET /datasets/text-search`: one at a time on the server, bounded in threads, time per store, stores, and index size | `index.complete: false` (and `capped: true`); a store that timed out is left out of the search until it is read again |
| `server.text_index_ttl_s` | 1800 s | how often the server reads the datasets again for changes | the index is up to that old |
| `POST /datasets/lookup` paths | 200 | the paths in the body | `400 cap_exceeded` |
| `max_cells=` / `max_genes=` query parameters | none | number of requested cell / gene indices | `400 cap_exceeded` |
| groups for subset balancing | 10,000 | a column's categories (metadata) | `400 too_many_categories` |

One full row or one full column always passes the size guard, at any dataset size: that is the
unit every view asks for. `max_cells=` and `max_genes=` are the client's own guard against
asking for more than it can draw (the web client sends its `ui.defaults.max_cells` /
`max_genes`); they are not a server limit, and a request without them is not capped.
