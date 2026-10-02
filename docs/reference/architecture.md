# Architecture

AnnZarro is a Flask server that reads AnnData stores slice by slice and a browser client that
asks for exactly the slices on screen. Nothing else is in between: no database, no
precomputation step, no copy of the data.

```{figure} ../_static/figures/architecture.svg
:alt: Three columns. Browser: panels, layout and panel-set managers, data-manager with in-flight coalescing, cache-manager, wire decoder, browser HTTP cache. Server: login and path confinement, revalidation (ETag, 304), size guard (413), result cache, readers, encoding (binary or JSON), panel sets. Storage: zarr stores, h5ad files, remote zarr, and the sessions directory. Arrows: GET one slice from browser to server; one vector or a 304 back; compressed chunks from storage into the readers; panel sets read and written in the sessions directory.
:width: 100%

**One request, top to bottom.** A click sends one `GET` per affected panel. The server checks
access, answers an unchanged repeat with `304` before reading, refuses slices above the size
limit, serves from its result cache or reads only the overlapping chunks, and encodes one
vector.
```

## What happens on a click

Clicking a gene in a Gene Plot that is linked to a Cell Plot coloured by a layer:

1. The focused gene changes (header selector, history). Every panel whose configuration depends
   on the focused gene asks `DataManager` for its slice, here
   `GET /api/v1/data/layer/<key>?dataset_path=…&cols=<gene>&format=f32`.
2. `DataManager` returns a cached decoded slice if it has one (60 s), or joins a request already
   in flight for the same URL, or starts one.
3. The browser sends `If-None-Match` if it holds an earlier reply.
4. Server: login check (when enabled) and path confinement (hosted servers only), then
   `http_cache.conditional` computes the ETag from the URL and a `stat()` of the store and
   answers `304` on a match, without reading.
5. The route parses indices, applies the per-request caps (`400`) and the size guard (`413`),
   both from metadata only.
6. `get_reader` picks the zarr or h5ad reader. The reader's result cache (`core/caching.py`)
   answers a repeat of the same slice; otherwise zarr decompresses the chunks overlapping the
   requested column, or for a CSC matrix only `data[indptr[j]:indptr[j+1]]`.
7. `array_response` encodes the vector: binary float32 (float64 when not exact), dense or
   sparse, or JSON.
8. `wire.js` decodes it into a typed array; the panel restyles the existing plot.

Only step 6 touches the data, and only one chunk column of it.

## Server

| Module | Role |
|---|---|
| `annzarro/cli.py` | `annzarro start/stop/user/config/desktop`; merges the configuration: built-in `base.yaml` and `<env>.yaml` (`production` unless `--development`), `/etc/annzarro/config.yaml`, `~/.config/annzarro/config.yaml`, `./config.yaml`, `--config`, `ANNZARRO_<SECTION>_<KEY>` variables, flags ({doc}`configuration`) |
| `server/core.py`, `server/server.py`, `server/wsgi.py` | Flask app factory and route registration; the built-in threaded server for `annzarro start`, a WSGI factory for gunicorn |
| `server/routes/data_routes.py` | slice routes, dataset listing, size guard, error mapping, panel-set routes |
| `server/routes/core.py`, `zarr_routes.py`, `static_routes.py` | config, status, auth/me, cache info/reset, remote-URL check, the single-page app |
| `server/http_cache.py` | ETag/304 and gzip |
| `server/auth.py`, `permissions.py`, `confinement.py` | users and login, panel-set ownership, keeping a hosted server inside its data directory |
| `core/__init__.py` | `get_reader`: `.zarr` and remote URLs to the zarr reader, `.h5ad` to the h5ad reader |
| `core/zarr_reader.py` | opens stores (consolidated metadata, zarr format 2, and 3 under zarr 3), slices dense arrays, CSR/CSC/COO groups, dataframes, categoricals and nullable encodings |
| `core/h5ad_reader.py` | the same interface over h5py for local h5ad files; sparse matrices are loaded whole |
| `core/remote.py` | remote-store policy (allowlist, timeouts, credentials) and fsspec access |
| `core/caching.py` | per-dataset result cache with LRU eviction under `cache_memory_mb` |
| `core/array_response.py` | the wire format ({doc}`wire-format`) |

The server is stateless per request apart from caches: any process can answer any request,
which is what makes several gunicorn workers behind one proxy work
({doc}`../deployment/lab-server`).

### Caches, from browser to disk

| Cache | Where | Keyed by | Bound | Invalidated by |
|---|---|---|---|---|
| decoded-slice cache | browser, `cache-manager.js` | request URL | 1,000 entries, 1 GB, 60 s each | expiry; dataset change |
| in-flight table | browser, `data-manager.js` | request URL | requests currently running | completion |
| HTTP cache | browser | URL + ETag | browser policy | ETag changes when the store is rewritten |
| result cache | server, `core/caching.py` | dataset, method and arguments | `cache_memory_mb` (4,000 MB in the default production environment), `cache_dataset_limit` (20) datasets, LRU | `POST /api/v1/cache/reset`, restart |
| open stores and metadata | server, reader | dataset path | | the same |
| remote chunk cache | server, per remote store (zarr 3) | chunk key | `remote_chunk_cache_mb` (256) | restart |
| page cache | operating system | file | free RAM | the OS |

All server caches assume a store does not change while the server runs. After rewriting a
store in place, call `POST /api/v1/cache/reset` or restart. On a shared server the reset is
admins only, and under gunicorn it clears only the worker that answers, so restart there.

### Memory

Server memory follows the chunks being read, not the store. The paper's lab deployment served
33 datasets totalling 2.2 TiB on disk with three server processes of 0.58-0.75 GB resident
memory each. On the paper's HPC benchmark, serving one row of a 160 GB dense matrix peaked at
109 MB. The exceptions are the access patterns that load a whole matrix: a gene column of a
CSR matrix, a cell row of a CSC matrix, a cell row of a layer stored in whole-gene chunks
(12 GB at 1M × 5,000 in the paper's laptop sweep), and any sparse matrix in an h5ad file.
See {doc}`performance`.

## Browser

The client is plain JavaScript modules served by the same Flask app (`static/js`), with
plotly.js for plots, DataTables (with SearchBuilder) for tables, select2 and chroma.js.

| Module | Role |
|---|---|
| `main.js` | boot, header (dataset menu, Focused Gene / Focused Cell with history), deep-link handling, Share Link |
| `panel-manager.js`, `layout-manager.js` | tiled panels, splits, drag handles; `saveLayout` / `restoreLayout` |
| `session-manager.js` | panel sets: save, load, import, export; autosave |
| `selection-tile.js` | the Welcome tile and "Create New Panel" |
| `panels/cell-plot.js`, `gene-plot.js` | the two plot primitives (2D or 3D scatter); sources obs, obsm, obsp, layer and var, varm, varp, layer |
| `panels/cell-table.js`, `gene-table.js` | DataTables with filters; a plot can mask to a table's rows |
| `panels/plot-utilities/*`, `table-utilities/*` | controls, colour scales, aesthetics, listeners |
| `data-manager.js` | every request, coalescing, focus state and history |
| `cache-manager.js` | the decoded-slice cache |
| `utils/wire.js` | binary decoding |
| `utils/deeplink.js` | the `#view=` grammar ({doc}`deep-links`) |
| `utils/coverage.js`, `utils/panel-surface.js` | every panel says what is missing and why instead of drawing an empty plot |
| `config.js` | API endpoints, defaults, limits |

The browser holds only the vectors on screen: one float per cell per displayed vector, plus
the cell and gene name lists. At 1.17 million cells the cell-name list alone is 36 MB, which is
the slow part of opening such a dataset ({doc}`troubleshooting`).

## What AnnZarro does not do

It never writes to a dataset and never runs user code. The only files it writes are panel sets
in `<data_dir>/sessions/`, server logs, and (with login) the user file. That is what lets a lab
host datasets for many users without granting write or compute access
({doc}`../deployment/index`).
