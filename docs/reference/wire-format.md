# Wire format

One click moves one vector: a gene column, a cell row, an embedding axis, a kNN row. This page
specifies how that vector travels. The protocol is defined in
`annzarro/core/array_response.py` (server) and `static/js/utils/wire.js` (browser); everything
below was checked against both and observed on a running server.

## Choosing the encoding

The client chooses per request with the query parameter `format=f32`. A query parameter rather
than an `Accept` header keeps the two encodings at different URLs, so neither the browser cache
nor the client cache can confuse them. The web client asks for `format=f32` on every numeric
slice; JSON stays the default for everyone else.

| Request | Slice is numeric (int or float, 1-D or 2-D) | One categorical obs/var column | Other slices (string, bool) |
|---|---|---|---|
| no `format` | JSON | JSON | JSON |
| `format=f32` | **binary** (`application/octet-stream`) | JSON | JSON |
| `format=f32&categorical=codes` | **binary** | **binary codes** ({ref}`categorical-codes`) | JSON |

So a client must branch on `Content-Type`, not on what it asked for, and for a binary reply on
`X-Annzarro-Encoding`. Requesting the categorical `obs/Age` with `format=f32` alone returns
JSON with a `categories` field, as it did before the codes existed; a client opts in to codes
with `categorical=codes`. The web client sends both on every single-column obs/var request.

## Binary replies

```{figure} ../_static/figures/wire-layout.svg
:alt: Dense body is n consecutive little-endian floats. Sparse body is nnz little-endian floats followed by nnz little-endian uint32 positions.
:width: 100%

Body layout of the two binary encodings.
```

### Headers

| Header | Value | Example |
|---|---|---|
| `Content-Type` | `application/octet-stream` | |
| `X-Annzarro-Shape` | `n` for a 1-D slice, `rows,cols` for 2-D (row-major) | `8090,1` (gene column), `1,8090` (obsp row), `8090` (one obs column) |
| `X-Annzarro-Dtype` | `float32` or `float64`; for categorical codes `int8`, `int16` or `int32` | |
| `X-Annzarro-Encoding` | `dense`, `sparse` or `categorical` | |
| `X-Annzarro-Nnz` | number of stored entries; sparse only | `15` |
| `X-Annzarro-Categories-Bytes` | length of the categories prefix; categorical only | `48` |
| `ETag`, `Cache-Control` | see {ref}`revalidation` | |
| `Access-Control-Expose-Headers` | the five `X-Annzarro-*` headers and `ETag`, so a cross-origin page can read them when `server.cors_enabled` allows its origin | |

### Dtype

Values travel as little-endian **float32 whenever that is exact**, otherwise float64, so the
binary form never loses information the JSON form carried:

- float32 (and float16) sources: float32.
- Integers with magnitude below 2²⁴: float32. Larger: float64.
- float64 sources: float32 if every value survives the float64 → float32 → float64 round trip
  (NaN included), else float64.

Observed on the demonstration store: the float64 `obsp/distances` arrives as float32 (its values
were float32 to begin with); the float64 `obsp/DM_Kernel` and the Kompot z-scores in `obs` arrive
as float64.

### Dense or sparse

The server counts non-zero values (NaN and ±inf count as non-zero) and sends the sparse form
whenever it is smaller: `nnz × (itemsize + 4) < n × itemsize`. For float32 that is fewer than
half the values non-zero. Positions are uint32, so slices of 2³² elements or more always go
dense.

| Slice (demonstration store) | Sent | Bytes |
|---|---|---|
| gene column of the dense fold-change layer | dense float32, 8,090 values | 32,360 |
| row of `obsp/connectivities` (kNN graph) | sparse float32, 15 entries | 120 |
| row of `obsp/DM_Kernel` | sparse float64, 31 entries | 372 |
| row of the dense `obsp/diffusion_walk_t5` | sparse float32, 2,415 entries | 19,320 |
| row of `varp/spearman_fold_change` | dense float32, 16,285 values | 65,140 |
| gene column of the CSR `logged_counts` layer (S100a9) | dense float32 | 32,360 |

### Worked example: a sparse row

```console
$ curl -s -D - -o row.bin "http://127.0.0.1:8812/api/v1/data/obsp/connectivities?dataset_path=$DS&rows=2089&format=f32" | grep -i '^x-annzarro\|^content-length'
X-Annzarro-Shape: 1,8090
X-Annzarro-Dtype: float32
X-Annzarro-Encoding: sparse
X-Annzarro-Nnz: 15
Content-Length: 120
$ xxd row.bin | head -5
00000000: f9aa 533e b3ac 3c3e 0b38 523f 7fb2 fd3d  ..S>..<>.8R?...=
00000010: 0000 803f 366d 3c3e bb6a a23e d34c 083e  ...?6m<>.j.>.L.>
00000020: d5c7 b73e b896 a63e 90b2 d53d c693 953d  ...>...>...=...=
00000030: fadf 793e df2b d23d ec9e 9e3d b504 0000  ..y>.+.=...=....
00000040: 3705 0000 1f06 0000 0407 0000 2808 0000  7...........(...
```

The first 15 × 4 = 60 bytes are the float32 values, the next 60 bytes the uint32 positions:

```python
import numpy as np
body, nnz = open("row.bin", "rb").read(), 15
values = np.frombuffer(body, "<f4", nnz)
positions = np.frombuffer(body, "<u4", nnz, offset=4 * nnz)
print(values[:4], positions[:4])
```

```text
[0.2067069  0.18425255 0.82116765 0.12387561] [1205 1335 1567 1796]
```

For shape `1,8090` a flat position is the column index, so cell 2089's 15 kNN neighbours start
at cells 1205, 1335, 1567 and 1796; the strongest connection (1.0, bytes 16-19) is to cell 2088. A full
decoder in Python is in {doc}`http-api`; the browser's is `decodeVector` in `wire.js`, which
returns a dense `Float32Array` or `Float64Array` and checks that the body length matches the
headers.

(categorical-codes)=
### Categorical codes

A categorical column used to travel as one JSON string per cell even with `format=f32`: about
12 bytes per cell, 120 MB for the cell line of 10 million Tahoe-100M cells. With
`format=f32&categorical=codes` on `/data/obs` or `/data/var` (exactly one column, which is
categorical) the reply is the stored integer codes:

- `X-Annzarro-Encoding: categorical`, `X-Annzarro-Shape: n`.
- `X-Annzarro-Dtype`: `int8` for up to 128 categories, `int16` up to 32,768, else `int32`. Code
  `-1` is a missing value (anndata's convention); a stored code outside the categories is sent as
  `-1` too.
- Body: a UTF-8 JSON array of the categories, padded with spaces to
  `X-Annzarro-Categories-Bytes` bytes (a multiple of 4, so the codes are aligned), then `n`
  little-endian codes. Code `k` stands for `categories[k]`; categories keep their JSON types
  (strings, numbers, booleans).

Any other column under `categorical=codes` answers exactly as without it (numeric binary, or
JSON), as does a request for several columns.

```console
$ curl -s -D - -o age.bin "http://127.0.0.1:8812/api/v1/data/obs?dataset_path=$DS&columns=Age&format=f32&categorical=codes" | grep -i '^x-annzarro\|^content-length'
X-Annzarro-Encoding: categorical
X-Annzarro-Shape: 8090
X-Annzarro-Dtype: int8
X-Annzarro-Categories-Bytes: 24
Content-Length: 8114
```

```python
import json
import numpy as np
body, lead = open("age.bin", "rb").read(), 24
categories = json.loads(body[:lead])
codes = np.frombuffer(body, "<i1", offset=lead)
print(categories, codes[:5], [categories[c] for c in codes[:3]])
```

```text
['Mid', 'Old', 'Young'] [2 2 2 2 2] ['Young', 'Young', 'Young']
```

The same column is 8,114 bytes as codes against 54,571 bytes of JSON. The browser's decoder
(`decodeVector` and `categoricalValues` in `wire.js`) turns the codes back into the values and
`categories` the JSON body carried, so the plot and table code is unchanged.

## JSON replies

JSON is the default and keeps its historical shape contract:

- `{"data": <values>, <identifying fields>}`; identifying fields are `layer_name`, `obsm_key`,
  `obsp_key`, ... and `dataset_path`.
- A 2-D slice stays 2-D: a gene column is `[[v0],[v1],...]`, a cell row `[[v0, v1, ...]]`.
- Numbers are written in the shortest form that round-trips their own dtype (float32 `0.1` is
  `0.1`, not `0.10000000149011612`).
- Non-finite values are `null`.
- `obs` and `var`: `{"data": {"<column>": [...]}, "categories": {"<column>": [...]}}`.

The same gene column of the fold-change layer is 32,360 bytes binary and 111,869 bytes JSON;
a varp row 65,140 against 186,736 bytes. At 1M cells a JSON gene column is 21.5 MB and the
binary one 4.0 MB ({doc}`performance`).

(revalidation)=
## Revalidation: ETag and 304

Every dataset read (all `/data/*` slice routes, `dataset_structure`, `genes`, `cells`, `uns`)
carries

```text
ETag: W/"<sha1>"
Cache-Control: private, no-cache
```

The tag is computed **without reading any data**: a hash of the encoding version, the
AnnZarro version, the full request URL and the dataset's freshness token: a `stat()` fingerprint
of the store (modification times and sizes of the store directory and its top-level members
`.zgroup`, `.zattrs`, `zarr.json`, `.zmetadata`, `X`, `obs`, `var`, `layers`, `obsm`, `varm`,
`obsp`, `varp`, `uns`) plus its generation (below).
`no-cache` makes the browser keep the reply and revalidate every reuse. A repeat with a matching
`If-None-Match` is answered `304 Not Modified` with no body and no zarr read:

```console
$ U="http://127.0.0.1:8812/api/v1/data/layer/kompot_de_Young_to_Old_fold_change?dataset_path=$DS&cols=2551&format=f32"
$ curl -s -D - -o /dev/null "$U" | grep -i '^etag'
ETag: W/"bacbfc34ca6b53360c0b06d1992739a6767bfba0"
$ curl -s -D - -o /dev/null -H 'If-None-Match: W/"bacbfc34ca6b53360c0b06d1992739a6767bfba0"' "$U"
HTTP/1.1 304 NOT MODIFIED
ETag: W/"bacbfc34ca6b53360c0b06d1992739a6767bfba0"
Cache-Control: private, no-cache
```

In Chromium, three identical `fetch` calls for that gene column transferred 32,660 bytes the
first time and 300 bytes (headers only) for each repeat. Rewriting a store moves the directory
modification times, so old tags stop matching. Overwriting chunk files in place
(`g["obs/x"][:] = v`) moves none of them, so the tag also holds the dataset's **generation**: a
small file per dataset under `~/.annzarro/freshness` (`ANNZARRO_HOME`), replaced by
`POST /api/v1/cache/reset`. After a reset every tag of that dataset changes, in every server
process on the machine (each gunicorn worker stats the same file), and the server's own result
cache, keyed by the same token, is read afresh. Remote stores get no ETag.

## Compression

`server.compress_responses` (`auto`, `true`, `false`) gzips **JSON** replies of at least 4 kB at
level 1 when the client sends `Accept-Encoding: gzip`. `auto` turns it on only for a shared
server (login on, or a network host); on loopback the CPU costs more than the transfer saves.
Binary replies are never compressed: float32 noise barely shrinks and sparse replies are already
minimal. With `compress_responses: true` the 111,869-byte JSON gene column above went out as
46,138 bytes with `Content-Encoding: gzip` and `Vary: Accept-Encoding`; the binary one stayed
32,360 bytes.

```{note}
Set this key in a config file (`server: {compress_responses: true}`), not through the
environment: `ANNZARRO_SERVER_COMPRESS_RESPONSES` is ignored because the key is absent from the
built-in `base.yaml`, and the configuration manager only maps environment variables onto keys it
already has (verified).
```

## Client side: one request per URL

The browser's `DataManager` (`static/js/data-manager.js`) adds two layers before the network:

1. **In-flight coalescing.** While a request for a URL is running, a second caller for the same
   URL joins it instead of starting another; the request is aborted only when every caller has
   abandoned it. On a deep-link boot every panel used to ask for the same slices at once (30
   requests, 19.5 MB, for 13 unique ones, 6.2 MB). Opening the paper's view C (three Cell Plots
   on `X_umap`) on this branch issued 9 data requests, all unique: two `X_umap` axes shared by
   three panels, three layer columns, plus `datasets`, `dataset_structure`, `cells`, `genes`.
2. **Decoded-slice cache** (`cache-manager.js`): replies keyed by URL, kept 60 s, at most 1,000
   entries and 1 GB, evicting the oldest first. Binary slices are stored decoded as typed
   arrays, so a cache hit costs no parsing.

Behind those, the browser's own HTTP cache revalidates with the ETag as above.
