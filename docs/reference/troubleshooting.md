# Troubleshooting

Problems by the stage at which they show up. "Reproduced" marks entries whose error message was
produced on this branch while writing these docs; the others come from the paper's
Troubleshooting table and validation notes. Step numbers refer to the paper's Procedure.

## Preparing the store

| Symptom | Cause | Fix |
|---|---|---|
| Fold-change or smoothed layers missing (Steps 4, 7) | `kompot.cleanup()` was run before saving, as in the Kompot tutorial | Re-run differential expression without the cleanup call ({doc}`../data/kompot`) |
| `TypeError: string indices must be integers` when reading `last_run_info` (Step 5) | Kompot 0.8 stores the run record as a JSON string | `json.loads` it first ({doc}`../data/kompot`) |
| A key from `field_names` is not in the object | `field_names` lists keys that were not stored | Test membership before use |
| `ValueError: Cannot overwrite/edit a store with consolidated metadata` (Step 10). Reproduced | `write_zarr` consolidated the store | Open with `zarr.open_group(path, mode="r+", use_consolidated=False)` |
| `ValueError: cannot reshape array of size … into shape (…)` from `anndata.read_zarr` after rechunking. Reproduced | Metadata not re-consolidated: `.zmetadata` still describes the old array | `zarr.consolidate_metadata(path)` |
| `write_zarr(chunks=…)` had no effect on layers | `chunks` applies to `X` only | Rechunk with `ad.io.write_elem(..., dataset_kwargs={"chunks": …})` ({doc}`../data/chunking`) |
| Out of memory computing a dense obsp or varp | 4n² bytes, plus `rankdata`'s float64 copy for Spearman | Sparse walk, or a gene subset written into a NaN-filled full matrix ({doc}`../data/pairwise-matrices`) |
| anndata warns "Writing zarr v2 data will no longer be the default" | anndata 0.12 | Harmless; keep `ad.settings.zarr_write_format = 2` |

## Opening the dataset

| Symptom | Cause | Fix |
|---|---|---|
| Dataset missing from the Dataset menu (Step 12) | Store outside the data directory, deeper than one level, or not a `.zarr`/`.h5ad` path; or `<data_dir>/datasets/` exists, in which case only that folder is listed | Move or symlink the store into the listed folder and reload ({doc}`../data/preparing-a-store`) |
| Dataset listed without cell and gene counts, with an error | zarr format 3 store on a server running zarr 2 | Rewrite as format 2, or run the server with zarr ≥ 3 |
| Dataset opens but one array shows no data; the API returns `200` with `"data": []`. Reproduced | `.zmetadata` out of date after an in-place rewrite (AnnZarro does not report it); or a key or index that does not exist | Re-consolidate; check the key with `GET /api/v1/data/dataset_structure`; call `POST /api/v1/cache/reset` |
| Changes to a store do not show up | Server caches assume stores do not change; an in-place overwrite of chunk files also keeps the old ETag | `POST /api/v1/cache/reset` or restart the server |
| First view slow on datasets with about 1M cells (Step 12) | The Focused Cell selector lists every cell name (36 MB at 1.17M cells) | Expected in this release; selecting cells by clicking works |
| Remote dataset refused: `Remote datasets are disabled on this server (remote_stores: auto (server is behind a proxy; …))`, `403`, on a laptop. Reproduced | In builds before commit 58122bc (PR #43), `annzarro start` used `production.yaml`'s `proxy_count: 1`, so `auto` treated even a loopback server as proxied. Fixed there: the default is now 0 | Upgrade; on an older build set `server: {remote_stores: allow}`, or `proxy_count: 0` when no proxy is in front; with the latter the log reads `remote_stores: auto (local single-user server)` ({doc}`../user-guide/remote-datasets`) |
| `501` `missing_dependency`: `Reading https:// datasets needs the optional package(s) fsspec, aiohttp`. Reproduced | Remote extras not installed | `pip install 'annzarro[remote]'` |
| `Configuration error: Missing required configuration: server.host / server.port / server.data_dir` | AnnZarro before PR #43, started outside its source tree | Upgrade; with this branch `annzarro start --data-dir … --port …` works from any directory (verified) |

## Building views

| Symptom | Cause | Fix |
|---|---|---|
| X is not in any source menu | As of this version the plot sources are obs/obsm/obsp/layer and var/varm/varp/layer; X is not offered | Store the matrix as a layer: `adata.layers["X"] = adata.X` ({doc}`../data/slot-map`) |
| Gene Plot shows no options (Step 18) | Default source is varm and the dataset has none | Switch the axis source to var |
| Volcano all grey (Step 20) | Focused gene has no row in the varp matrix (outside a gene subset) | Click a gene that is in the matrix, or pick one from the Focused Gene selector |
| Colour range looks wrong after loading a view (Steps 22-23) | Range restored from another focus | Toggle Lock Range or reset min and max |
| Each gene click takes seconds (Steps 15, 22) | The layer is CSR (whole-matrix load per gene), or dense and chunked wide in genes | Store it CSC, or rechunk by the aspect rule ({doc}`../data/chunking`) |
| First click on a new cell in a cell-row plot takes over 20 s (Steps 25-27) | Layer chunked as whole gene columns (all cells × a few genes), so one cell row decompresses the entire layer | Rechunk; repeat clicks are faster but still decompress the layer |
| Cell rows of X are slow (215 ms here, more at scale) | X stored CSC: cell rows load the whole matrix | Expected trade-off; use a dense layer for cell-row views |

## Sharing and hosting

| Symptom | Cause | Fix |
|---|---|---|
| Shared link returns "Request Line is too large" (Step 34) | A legacy `?view=` link longer than gunicorn's 4,094-byte request line | Use Share Link on this release: it puts the view in the `#view=` fragment, compressed, which never reaches the server ({doc}`deep-links`) |
| Remote users see no login (Step 38) | Server bound to localhost, or started with `--auth-disabled` | Start with `--host 0.0.0.0` and without `--auth-disabled` ({doc}`../deployment/lab-server`) |
| `403` with `"reason": "outside_data_dir"`. Reproduced | Hosted server (login on, or network host) and a `dataset_path` outside the data directory | Put the store under the data directory, or add its folder to `server.allowed_dirs` |
| Cannot delete or overwrite a panel set: `403`, `legacy_admin_only` or `not_owner`. Reproduced | With login on, only the owner or an admin may change a set; sets saved before owners were recorded are admin-only | Save under a new name, or ask an admin |

## Scripting the API

| Symptom | Cause | Fix |
|---|---|---|
| `413` `response_too_large`. Reproduced | The slice exceeds `max_response_elements` (10,000,000 by default) | Request one row or column, or fewer at a time ({doc}`http-api`) |
| `400` `cap_exceeded`. Reproduced | More indices than `max_cells_per_request` / `max_genes_per_request` (20,000 by default) | Fewer indices, or pass `max_cells=` / `max_genes=` |
| `400` `bad_indices`. Reproduced | `rows=` empty or not integers (e.g. a trailing comma from macOS `seq -s,`) | Send `rows=1,2,3` or `rows=[1,2,3]` |
| `401` although you sent `Authorization: Bearer <token>` from `/auth/token`. Reproduced | No route accepts the token; only the session cookie | Log in through `POST /login` and reuse the cookie ({doc}`http-api`) |
| `GET /data/uns/<key>` returns `"data": null` for a string, or strings like `<Array file:///… shape=() dtype=StringDType()>` for a group. Reproduced | The uns route does not read zarr string scalars | Read `uns` in Python with zarr or anndata |
| `ANNZARRO_SERVER_COMPRESS_RESPONSES=true` has no effect. Reproduced | Environment variables only override keys present in the built-in config, and `compress_responses` is not in `base.yaml` | Set it in a config file passed with `--config` |
| A negative index returns data | Indices follow numpy: `-1` is the last row | Validate indices client side |

## Diagnosing

- `GET /api/v1/data/dataset_structure?dataset_path=…` shows exactly what the server sees: keys,
  shapes and types per slot.
- Every error reply carries `error` (a sentence) and, on newer routes, `reason` (a code):
  {doc}`http-api` lists them.
- The server log is `~/.annzarro/logs/annzarro_server.log` unless `server.log_file` is set;
  every slice read is logged with its shape.
- `annzarro config show` prints the effective configuration and where each value came from.
