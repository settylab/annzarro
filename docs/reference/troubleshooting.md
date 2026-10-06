# Troubleshooting

Problems by the stage at which they show up. "Reproduced" marks entries whose error message was
produced on this branch while writing these docs; the others come from the paper's
Troubleshooting table and validation notes. Step numbers refer to the paper's Procedure.

## Preparing the store

| Symptom | Cause | Fix |
|---|---|---|
| Fold-change or smoothed layers missing (Step 5) | `kompot.cleanup()` was run before saving, as in the Kompot tutorial | Re-run differential expression without the cleanup call ({doc}`../data/kompot`) |
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
| Dataset missing from the Dataset menu (Step 12) | Store outside the data directory (by default `~/annzarro-data`), deeper than the top level or `datasets/`, or not a `.zarr`/`.h5ad` path | Move or symlink the store into the data directory or its `datasets/` folder and click refresh ({doc}`../data/preparing-a-store`) |
| `annzarro stop` says "No server to stop" or "not an AnnZarro server of yours" | `stop` only stops a server started with `--detach` by the same user (same `ANNZARRO_HOME`); a reused PID is refused and the stale PID file removed | Stop a foreground server with Ctrl+C; otherwise find the process yourself |
| Dataset listed without cell and gene counts, with an error | zarr format 3 store on a server running zarr 2 | Rewrite as format 2, or run the server with zarr ≥ 3 |
| One array fails to load with `500` `stale_metadata`: "The store's consolidated metadata (.zmetadata) is out of date" | The store was rewritten in place without re-consolidating, so `.zmetadata` disagrees with the array on disk | Click **Refresh dataset**: the server finds the consolidated metadata out of date, reads the store without it and says so in a notice. Then run `zarr.consolidate_metadata(path)` and refresh again (a store opens faster with it) |
| A column, layer or obsp/varp key written with `anndata.io.write_elem` is missing from the menus, or answers `404` `key_not_found` | The store has consolidated metadata, and it was not updated after the write (`zarr.consolidate_metadata`), so zarr does not list the new element | The same: **Refresh dataset** (notice "Consolidated metadata out of date"; the element appears), then `zarr.consolidate_metadata(path)` and refresh |
| `404` `key_not_found` ("No layers key '…' in this dataset") or `400` `index_out_of_range`. Reproduced | A key, column or index the dataset does not have, often from a panel set or link made for another store | Check the keys with `GET /api/v1/data/dataset_structure` |
| Changes to a store do not show up | A rewrite (anndata `write_elem`, a new `.h5ad`) is seen on the next read; an in-place overwrite of chunk files (`g["obs/x"][:] = v`) is not, because nothing at the store's top level changes | Click **Refresh dataset** in the header: any user may, and the server re-checks the store on disk and serves a change from every worker. `POST /api/v1/data/refresh?dataset_path=` does the same from a script; `POST /api/v1/cache/reset` (admins only on a shared server) also clears the server's cache ({ref}`revalidation`) |
| Remote dataset refused with `403` `access_denied`: "Remote datasets are disabled on this server (remote_stores: auto (…))" or "Remote dataset URL is not under an allowed prefix" | The server is shared (login on, a network host, gunicorn, or `proxy_count` above 0) and the URL is not in `remote_allowlist`. Builds before 58122bc (PR #43) also refused on a laptop because `proxy_count` defaulted to 1 | Add the URL prefix to `server.remote_allowlist`; on a single-user laptop server check that `proxy_count` is 0 and login is off, then the startup log reads `remote_stores: auto (local single-user server)` ({doc}`../user-guide/remote-datasets`) |
| `501` `missing_dependency`: `Reading https:// datasets needs the optional package(s) fsspec, aiohttp`. Reproduced | Remote extras not installed | `pip install 'annzarro[remote]'` |
| `Configuration error: Missing required configuration: server.host / server.port / server.data_dir` | AnnZarro before PR #43, started outside its source tree | Upgrade; with this branch `annzarro start --data-dir … --port …` works from any directory (verified) |

## Desktop app

| Symptom | Cause | Fix |
|---|---|---|
| macOS: “AnnZarro” Not Opened, “Apple could not verify “AnnZarro” is free of malware…” | The app is ad-hoc signed and not notarized; since macOS 15, right-click > Open no longer gets past this | Click **Done**, then **System Settings > Privacy & Security > Open Anyway** and confirm, once ({doc}`../getting-started/desktop-app`, First launch) |
| The loading screen stays for more than a few seconds | First start after installing: Gatekeeper or Defender scans the bundled server | Wait; the screen counts the seconds. After 180 s the app shows an error page instead |
| Error page "AnnZarro could not start: …" | The server did not answer within 180 s, exited, or the interface did not load within 60 s | Read the log named on the page (its `server:` lines are the server's own output), then **Retry** ({doc}`../getting-started/desktop-app`) |
| A panel says "No dataset loaded" after starting the app. Reproduced | The layout was restored from the last session, but its dataset was moved or deleted; a "Failed to load dataset" notice names it | Choose a dataset in the Dataset picker, or close the panel. Builds before PR #54 showed a spinner here that never stopped |
| Starting the app again does nothing visible | AnnZarro is already running; the second start brings its window to the front | Look for the existing window (Dock, taskbar) |
| An AnnZarro desktop app from before the preprint release needs a Python on the computer, and when it cannot stop its own server on quitting it stops every Python process whose command line contains `annzarro` | Old build | Delete it and install the current release |

## Building views

| Symptom | Cause | Fix |
|---|---|---|
| X is not in any source menu | X is listed under the **layer** source, first, not as a source of its own; a layer named `X` takes its place | Choose source **layer**, key **X**; to see the matrix X next to such a layer, rename the layer ({doc}`../data/slot-map`) |
| Gene Plot shows no options (Step 18) | Default source is varm and the dataset has none | Switch the axis source to var |
| Volcano all grey (Step 20) | Focused gene has no row in the varp matrix (outside a gene subset) | Click a gene that is in the matrix, or pick one from the Focused Gene selector |
| Colour range looks wrong after loading a view (Step 23) | Range restored from another focus | Toggle Lock Range or reset min and max |
| Each gene click takes seconds (Step 22) | The layer is CSR (whole-matrix load per gene), or dense and chunked wide in genes | Store it CSC, or rechunk by the aspect rule ({doc}`../data/chunking`) |
| First click on a new cell in a cell-row plot takes over 20 s (Step 25) | Layer chunked as whole gene columns (all cells × a few genes), so one cell row decompresses the entire layer | Rechunk; repeat clicks are faster but still decompress the layer |
| First search for a cell by name takes several seconds on tens of millions of cells (Step 35) | The server builds its index of cell names on the first search (6.3-6.8 s at 50 million cells in the paper's runs; 0.8 s once a local server has built it in the background) | Expected once per dataset and server; later searches are fast |
| Hover and clicks do nothing in a Cell Plot; a notice above it reads Large-plot mode (Step 36) | More than 1 million points are drawn, for example with the subset switched off | Switch the subset back on (Step 32) and step through parts (Step 34) ({doc}`../user-guide/subsets`) |
| Cell rows of X are slow (215 ms here, more at scale) | X stored CSC: a cell row scans every chunk of the matrix (in bounded blocks, so memory stays small) | Expected trade-off; use a dense layer for cell-row views |

## Sharing and hosting

| Symptom | Cause | Fix |
|---|---|---|
| Shared link returns "Request Line is too large" (Step 39) | A legacy `?view=` link longer than gunicorn's 4,094-byte request line | Use Share Link on this release: it puts the view in the `#view=` fragment, compressed, which never reaches the server ({doc}`deep-links`) |
| Remote users see no login (Step 43) | Server bound to localhost, or started with `--auth-disabled` or `ANNZARRO_AUTH_DISABLED=true` | Run behind a proxy with gunicorn, or start with `--host 0.0.0.0` and without `--auth-disabled` ({doc}`../deployment/lab-server`) |
| Login works over `http://` but not over `https://`, or the reverse | `auth.cookie_secure: true` sends the cookie only over HTTPS; behind a TLS proxy with `proxy_count: 0` the server does not see that the request was HTTPS | Leave `cookie_secure: auto` and set `proxy_count` to the number of proxies ({doc}`../deployment/authentication`) |
| Everyone is locked out after a few failed logins | Lockout is per username and client address; with `proxy_count` too low all users appear to come from the proxy's address | Set `server.proxy_count: 1` behind nginx |
| `403` with `"reason": "outside_data_dir"`. Reproduced | Hosted server (login on, or network host) and a `dataset_path` outside the data directory | Put the store under the data directory, or add its folder to `server.allowed_dirs` |
| Cannot delete or overwrite a panel set: `403`, `legacy_admin_only` or `not_owner`. Reproduced | With login on, only the owner or an admin may change a set; sets saved before owners were recorded are admin-only | Save under a new name, or ask an admin |

## Scripting the API

| Symptom | Cause | Fix |
|---|---|---|
| `413` `response_too_large`. Reproduced | The slice exceeds `max_response_elements` (10,000,000 by default) | Request one row or column, or fewer at a time ({doc}`http-api`) |
| `400` `cap_exceeded`. Reproduced | More indices than the request's own `max_cells=` / `max_genes=` parameter | Raise or drop that parameter; the server sets no such cap itself |
| `400` `bad_indices`. Reproduced | `rows=` empty, not integers (e.g. a trailing comma from macOS `seq -s,`) or negative | Send `rows=1,2,3` or `rows=[1,2,3]` |
| `403` `admin_only` on `POST /api/v1/cache/reset` | On a shared server only admins may clear the cache | To see a changed store, use `POST /api/v1/data/refresh` (Refresh dataset), open to every user; to clear the cache, sign in as an admin |

## Diagnosing

- `GET /api/v1/data/dataset_structure?dataset_path=…` shows exactly what the server sees: keys,
  shapes and types per slot.
- Every error reply carries `error` (a sentence) and, on newer routes, `reason` (a code):
  {doc}`http-api` lists them.
- The server log is `~/.annzarro/logs/annzarro_server.log` unless `server.log_file` is set;
  every slice read is logged with its shape.
- `annzarro config show` prints the effective configuration and where each value came from.
