# Configuration

AnnZarro reads one merged configuration made of layers. Later layers win, key by key, so a file
only needs the keys it changes.

| # | Layer | Where |
|---|---|---|
| 1 | Built-in defaults | `base.yaml`, then `production.yaml` (or `development.yaml` with `--development`), inside the installed package |
| 2 | System file | `/etc/annzarro/config.yaml` |
| 3 | User file | `~/.config/annzarro/config.yaml` (`$XDG_CONFIG_HOME` honoured) |
| 4 | Project file | `./config.yaml` in the directory the command runs from |
| 5 | Named file | `--config FILE`, or else the file named by `ANNZARRO_CONFIG` (read by every `annzarro` command and by the gunicorn entry point); must exist |
| 6 | Environment | `ANNZARRO_<SECTION>_<KEY>` |
| 7 | Command line | `--host`, `--port`, `--data-dir`, `--auth-disabled` |

Files may be YAML (`.yaml`, `.yml`) or JSON. After merging, a few values are derived (default
paths, login on a network address) and the result is validated: `server.host`, `server.port`
(an integer 1 to 65535) and `server.data_dir` must be set, and a duplicated top-level key in a
YAML file is an error.

See exactly what a server will run with, and where each value came from:

```bash
annzarro config show --config site.yaml            # what `annzarro start --config site.yaml` uses
annzarro config show --host 0.0.0.0 --format json  # same, as JSON, for a network address
```

The output starts with every layer and whether it was loaded, not found or ignored, and ends
with each value that does not come from the built-in defaults:

```text
# Values not taken from the built-in defaults, and where they came from:
#   auth.enabled     <- derived:non-loopback host
#   auth.user_file   <- derived:user state dir
#   server.host      <- cli:--host
#   server.log_file  <- derived:user state dir
```

## `server`

Defaults are those of `annzarro start` and gunicorn (the `production` layer over `base.yaml`).
Keys marked * are not in the built-in files; set them in your own file.

| Key | Default | Meaning |
|---|---|---|
| `host` | `127.0.0.1` | Bind address for `annzarro start`. Any other value than `127.0.0.1`, `localhost`, `::1` makes the server shared and turns login on. Also the bind address of the bundled gunicorn configuration (`-b` on the gunicorn command line overrides it). |
| `port` | `8000` | Port for `annzarro start` and the bundled gunicorn configuration. |
| `url_prefix` | `""` | Path the app is served under behind a reverse proxy, e.g. `/explore`; empty means the root. A value that is not a plain path (`..`, `//`, `?`, `#`, spaces, a URL) stops the server at startup. Env `ANNZARRO_SERVER_URL_PREFIX`. See {doc}`../deployment/lab-server`. |
| `workers` * | 2 x CPUs + 1, at most 4 | gunicorn worker processes, read by `annzarro.server.gunicorn_config`. Each has its own cache. |
| `threads` | `4` | Threads per gunicorn worker. The bundled configuration uses the `gthread` worker class, so a slow request does not hold a whole worker; the server answers `workers x threads` requests at once. |
| `data_dir` | `~/annzarro-data` | Data directory: the datasets offered in the dataset browser (stores at its top level and in its `datasets/` subdirectory), and `sessions/` for panel sets. A configured relative path is taken from the working directory; `~` is expanded. |
| `allowed_dirs` * | none | Extra directory trees a shared server may open, e.g. targets of symlinks in `data_dir`. Every store under them can be opened by path. |
| `arbitrary_paths` | `admins` | Who may open a dataset path outside `data_dir` and `allowed_dirs` (after symlinks and `..` are resolved). `admins`: admins of a shared server with login, so an admin login can read any file the server process can (each such open is logged with the admin's name), and the one user of a local server (loopback, no login: a laptop, the desktop app); other users never. `local-only`: only that local user; on a shared server nobody, admins included. `none`: nobody, local servers included. Any other value stops the server at startup. Env `ANNZARRO_SERVER_ARBITRARY_PATHS`. |
| `hosted` * | unset | `true` forces shared-server behaviour (path confinement, remote policy, compression, exposure warning) whatever the host; `false` forces local behaviour. Unset: decided by login and host. The gunicorn entry point sets `true` unless you set `false`. |
| `proxy_count` | `0` | Number of reverse proxies whose `X-Forwarded-For/-Proto/-Host` headers are trusted. Set `1` behind nginx or Apache; never more than the proxies you run, or clients can forge their address. Any value above 0 also counts as "shared" for the remote-store policy `auto`. The admin interface needs it behind a proxy that terminates TLS or rewrites `Host`: it accepts a change only from an `Origin` equal to the address the server believes it has ({doc}`../deployment/admin`). |
| `debug` | `false` | Flask debug mode (reloader and interactive debugger). `true` only in the `development` layer; never on a reachable server. |
| `log_file` | `~/.annzarro/logs/annzarro_server.log` | Server log. Relative paths are taken from the working directory. |
| `log_level` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` or `CRITICAL`. |
| `max_response_elements` | `10000000` | Largest reply in array elements; larger slices are refused with `413 {"reason": "response_too_large"}` before anything is read. One full row or column is always allowed. |
| `cross_origin_isolation` | `off` | `off`, `on` or `auto`: send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. A page served with them is cross-origin isolated, and Chromium then lets it measure its own memory (`performance.measureUserAgentSpecificMemory`), so the browser memory guard (`ui.memory`) works from measured rather than estimated numbers. AnnZarro serves all its scripts and fonts itself and logs in by redirect, so the headers do not break it as a page of its own; an isolated page cannot be shown in a frame of another site, so `auto` leaves them off for requests the browser makes for a frame (`Sec-Fetch-Dest: iframe`). Off by default until tested behind your proxy and login; quote the value in YAML (`"off"`). |
| `compress_responses` * | `auto` | gzip (level 1) for JSON replies: `auto` on a shared server only, or `true` / `false`. Set `false` if the proxy compresses already. |
| `cache_enabled` | `true` | Server-side cache of dataset metadata and read results. |
| `cache_memory_mb` | `4000` | Memory bound of that cache, per process (per gunicorn worker). `base.yaml` alone: 1000. |
| `cache_dataset_limit` | `20` | Datasets kept open in the cache. |
| `max_read_mb` | auto | Memory one read of an `obsp` or `varp` matrix may hold, in MB, estimated from the store's metadata before any chunk is read: a dense matrix costs rows x columns x itemsize of what the request returns (`cols` only filters the rows asked for) plus the chunks being decompressed (up to 10 at a time, each whole: one row of an array chunked (1000, n) decompresses 1000 x n values, 4.8 GB at 1.2 million cells, so a refusal names the chunk shape and suggests rewriting with smaller chunks); a sparse one costs its stored `data`, `indices` and `indptr` as loaded (a CSR row selection loads that share) plus the dense block returned. A request over it is refused with `413 {"reason": "read_too_large"}` naming the element, its shape and the estimated size. Unset: 5% of the machine's RAM, between 256 MB and 4 GB. It applies to every user, admins included, and no request parameter changes it. A dense *n* x *n* `obsp` is 120 GB at 175,000 cells; one row of it stays small. Pairwise matrices are read by rows only (`rows_required`, at most 1000 rows per request). A `uns` member is sized the same way before it is read whole (`/data/uns/<key>`): about 100 bytes per value, 160 per string, since the reply is built as Python lists; a matrix stored in `uns` is refused over the limit, and read by a smaller member (`uns/key/member`) instead. |
| `max_names_json_mb` | `2048` | MB a reply of every cell or gene name may hold when it is built whole, estimated at 170 bytes a name from the axis length before any name is read (2048 is about 12 million names); over it the request is a `413 {"reason": "read_too_large", "limit_name": "max_names_json_mb"}`. A zarr store is not limited: it streams its names a chunk at a time, and so does a cell subset of more than 250,000 cells (a smaller one is read whole). The limit applies to h5ad files and to an index stored as a categorical or nullable group. `0` removes it. |
| `names_stream_max_concurrent` | `2` | Streams of every cell or gene name one worker sends at once. A stream holds a server thread until its client has read the reply, and a client that stops reading holds it until it hangs up, so the number is capped; one more is answered `503 {"reason": "read_busy"}` with `Retry-After` before any byte is sent. `0` removes the cap. A stream does not use the `obsp`/`varp` read budget. |
| `names_stream_slot_above` | `1000000` | Only lists of more names than this count against `names_stream_max_concurrent`; shorter ones (opening a dataset reads one per axis) stream without a slot, so slow readers of a huge list cannot make every dataset open a 503. |
| `read_budget_mb` | auto | What all the `obsp`/`varp` reads in flight in one worker process may hold together, in MB, each charged its `max_read_mb` estimate. Unset: twice `max_read_mb`. A read that does not fit waits up to `read_wait_s` seconds (default 5) for others to finish, then is answered `503 {"reason": "read_busy"}` with a `Retry-After` header; the web client retries once after it. A single read over `max_read_mb` is already a 413, so the budget cannot deadlock. Each gunicorn worker has its own budget. |
| `read_wait_s` | `5` | Seconds a pairwise read waits for `read_budget_mb` before the 503. |
| `name_index_max_mb` | auto | Memory the name-search indices (the header's Focused Cell and Focused Gene typeahead) may hold together, per worker process, in MB. Unset: 15% of the machine's RAM, between 512 MB and 16 GB. The index of a dataset costs about 30 bytes per cell name (30 GB for a billion cells); one that would not fit is not built. Its names are scanned instead, a zarr chunk at a time with no index in memory, and `GET /api/v1/data/names` says so: `partial: true` and a `note` when the scan stopped before the end (an exact match is found, or `name_search_scan_names` names were read), `GET /data/names/status` answers `streaming`, and the Focused Cell box searches only the cells shown. Least recently used indices are dropped to stay within the budget. |
| `name_search_scan_names` | `100000000` | Names a scanning name search reads at most before it answers with what it has (about 7 s at this size). |
| `name_search_max_regex_chars` | `200` | Longest regular expression a name search (`mode=regex`) runs, in characters; a longer one is refused with `400 {"reason": "regex_too_long"}`. A pattern that repeats a repeat or branches inside one (`(a+)+`) or has more than four open-ended repeats is refused with `400 regex_too_complex` as a cheap first filter. Every match also runs under `name_search_timeout_s` with the `regex` package, which stops inside a match, so a pattern the filter misses cannot hold a worker. See {doc}`../deployment/resource-limits`. |
| `name_search_timeout_s` | `10` | Seconds a regex name search scans before it answers with the matches found so far (`partial: true`, `timed_out: true`, with a `note`). `0` turns the limit off. |
| `read_user_share_percent` | `50` | On a shared server (login on, or a network address) the percentage of `read_budget_mb` one user may hold of the pairwise reads in flight, so one user's reads cannot make everyone else's `503 read_busy`, and of the `subset_budget_mb` while another user waits for it. With login off the unit is the client address (the proxy's address, unless `proxy_count` is set; an IPv6 /64 is one address). Never below one `max_read_mb` read or one subset. `0` = no share (any user may hold the whole budgets). See {doc}`../deployment/resource-limits`. |
| `subset_budget_mb` | auto | Memory the cell subsets one worker process computes at once may hold together, in MB. Each subset (`GET /api/v1/data/subset`, a pass over a column of every cell) is charged 55 bytes per cell of its dataset, a figure measured on the 95.6-million-cell store for the worst way a column is read (a Python list: 5 GB for one subset, 30 GB for six at once). A numeric filter on a numeric column holds about 19 bytes per cell (six at once: 10.8 GB), so the charge is conservative for it. Unset: 15% of the machine's RAM per worker, which is two or three filters of that dataset and about a hundred of a 1-million-cell one. A subset waits `subset_wait_s` for the budget, then `503 read_busy` with `Retry-After`. One larger than the whole budget is not refused: it runs alone, when nothing else is held, and the log says so. Sharing between users follows `read_user_share_percent`. Not applied to a server only one person uses. |
| `subset_wait_s` | `30` | Seconds a subset waits for `subset_budget_mb` before the `503`. Waiting holds one of the worker's threads, so keep it near the time one subset takes (3.6 s for a numeric filter at 95.6 million cells). |
| `max_requests` | `20000` | gunicorn only: requests a worker serves before it is replaced. Memory that crept is returned and the worker's caches start empty (a 95-million-cell name index is rebuilt on its first search, about 30 s). `0` = never. |
| `max_requests_jitter` | `2000` | gunicorn only: each worker's limit is `max_requests` plus a random number up to this, so workers do not restart together. |
| `limit_request_line`, `limit_request_fields`, `limit_request_field_size` | `0`, `100`, `8190` | gunicorn only: longest request line (0 = unlimited) and header field in bytes, and most header fields; a longer field is answered `400` by gunicorn. The line is unlimited because the web client sends the cells or genes it asks for in the URL (2,000 genes are about 12 KB, over the 4,094 gunicorn allows by default and the 8,190 it allows at most); the reverse proxy bounds it. |
| `max_request_mb` | `64` | Largest request body, in MB. Panel sets (saved, imported) are the only uploads; a larger body is refused with `413 {"reason": "request_too_large"}` before it is read. `0` turns the limit off. |
| `max_sessions_per_user` | `500` | Panel sets one user may keep (the owner is whoever first saved it; with login off every set is one user's). Saving, duplicating or importing a new set past it is refused with `409 {"reason": "session_quota_user"}`; overwriting a set you have is not. `0` turns it off. |
| `max_sessions` | `5000` | Panel sets the whole server keeps (files in `<data_dir>/sessions`); past it `409 session_quota_total`. `0` turns it off. |
| `max_sessions_mb` | `256` | MB all panel sets may take together, counted with the one being written; past it `409 session_quota_total`. `0` turns it off. |
| `dataset_folder_max_entries` | `500` | Entries (folders and stores) one request of the dataset browser's folder listing (`GET /api/v1/datasets/folder`) returns, and the most matches its subfolder search returns; a larger folder is read in pages ("show more"), and only the page is opened. |
| `dataset_search_max_depth` | `6` | Folders deep the dataset browser's search of the data directory (`GET /api/v1/datasets/search`) goes. |
| `dataset_search_max_entries` | `20000` | Entries that search looks at before it stops and answers `"truncated": true`. It also stops after 3 s (not a setting). With `mode=regex` the pattern goes through the same guard as the name search (`name_search_max_regex_chars`, `regex_too_complex`). |
| `dataset_details_check_budget_s` | `1.5` | Seconds the dataset browser's details request (`GET /api/v1/datasets/details`) spends on the store check of one zarr store. When it runs out the request answers with the findings so far and `budget_reached: true`. `0` turns the check off there (the command `annzarro store check` is not affected). |
| `lock_timeout_s` | `10` | Seconds a request waits for the lock on the users file (every login writes it), the admin state or the panel sets before it answers `503 busy` with `Retry-After`. |
| `admin_data_roots` | `[]` | Directories inside which an admin may add data directories in the browser ({doc}`../deployment/admin`). Empty: adding is off and the list is read-only. Keep them writable by trusted accounts only. |
| `admin_reauth_minutes` | `30` | Minutes the admin's password entry lets them change things in the admin interface. `0`: never asked. |
| `admin_rate_per_minute` | `30` | Admin changes per minute per admin and gunicorn worker; reads get eight times as many. Over it `429 admin_rate_limited`. At least 1. |
| `admin_audit_max_mb` | `50` | Size at which the audit log (`annzarro_admin/audit.jsonl` beside the users file) rotates; five rotations are kept. `0`: never. |
| `dataset_scan_max_entries` | `200000` | Directory entries the legacy dataset listing (`GET /api/v1/core/datasets`), a directory listing (`GET /api/v1/directories/list`) and the store count in `GET /api/v1/status` read before they stop. A store's own chunk files are never walked (a 95-million-cell store has hundreds of thousands). A listing then answers `"truncated": true` with a `note`; `/status` says `zarr_file_count_truncated`. `/status` reuses its count for 30 s. |
| `refresh_min_interval_s` | `10` | `POST /api/v1/data/refresh` (Refresh dataset, open to every user) walks a dataset's files at most this often, in all workers together. A refresh sooner does not wait in the server: it schedules one walk for the end of the interval, shared by everyone, and answers at once `status: "scheduled"`; the browser asks again after `retry_after_s` with `after=`, and gets that walk's result. A refresh is never answered by a walk older than itself. Each walk stops after 3 s: a store with more files than that (the 95.6M-cell Tahoe store) answers `status: "partial"`, and an in-place chunk write to it needs an admin's `POST /api/v1/cache/reset`. |
| `remote_stores` | `auto` | `auto`, `allow` or `deny` for `s3://`, `gs://`, `gcs://`, `http(s)://` stores (no other scheme is remote); see {doc}`../deployment/authentication`. |
| `remote_allowlist` | `[]` | URL prefixes remote stores must start with, e.g. `["s3://lab-bucket/atlases/"]`. |
| `remote_credentials` | `anonymous` | `anonymous` (unsigned requests) or `environment` (the AWS and Google standard credential chains of the server account). |
| `remote_connect_timeout_s` | `10` | Seconds to establish a connection to a remote store. |
| `remote_read_timeout_s` | `30` | Seconds to wait between bytes before the request fails with 504. |
| `remote_request_timeout_s` | auto | Seconds one request may spend on remote reads in total, however many chunks. The two timeouts above bound a single wait, so a host that sends a byte every 29 s never trips them; this one does. When it runs out the connection is closed and the request is answered `504 {"reason": "remote_deadline"}`, naming the host and the limit. Unset: `120` on a hosted server (the `proxy_read_timeout` the deployment guide recommends), `600` on a single-user one, so a dead host cannot hang the desktop forever. `0` turns it off. Each request has its own deadline; the background fingerprint of a remote store gets ten times it. Env: `ANNZARRO_REMOTE_REQUEST_TIMEOUT`. |
| `remote_chunk_cache_mb` | `256` | Raw-bytes LRU per open remote store (zarr 3 only); `0` turns it off. |
| `https_enabled`, `cert_file`, `key_file` | `false`, `config/ssl/cert.pem`, `config/ssl/key.pem` | TLS in `annzarro start` itself. Use a reverse proxy instead ({doc}`../deployment/lab-server`). |
| `cors_enabled`, `cors_origins` | `false`, `*` | Cross-origin access to `/api/*` from the listed origins. Off by default: no `Access-Control-Allow-Origin` header is sent. |
| `unified_server` | `true` | Historical; no effect. |

## `auth`

| Key | Default | Meaning |
|---|---|---|
| `enabled` | unset | Unset: off for `annzarro start` on a loopback host, on for a network host and for gunicorn. `true` / `false` decides explicitly; `false` on a shared server logs a `SECURITY` warning. |
| `user_file` | `~/.annzarro/auth/users.json` | Users file. A source checkout that still has `config/auth/users.json` keeps using it. Relative paths are taken from the checkout root, or from `~/.annzarro` for an installed package. |
| `secret_key` | unset | Key that signs login cookies. Leave unset: a random key is generated once and kept as `annzarro_secret_key` (mode 0600) beside `user_file`. Placeholder values are ignored. |
| `session_timeout` | `28800` | Seconds without a request after which a login expires; `0` = never. |
| `cookie_secure` | `auto` | `Secure` flag on the login cookie. `auto`: when the request arrived over HTTPS, directly or per `X-Forwarded-Proto` from the `proxy_count` trusted proxies. `true` always (login over plain HTTP then fails), `false` never. |

## `branding`

Shown on the login page and as the app title.

| Key | Default | Meaning |
|---|---|---|
| `app_name` | `AnnZarro` | Title in the header and on the login page. |
| `project_description` | `Zarr-based AnnData Visualization Tool` | Line under the login form. HTML is allowed. |
| `admin_contact` | `null` | Whom a user who sees only some datasets is told to ask for access: the dataset browser says "Ask *admin_contact* for access." when a link or panel set names a dataset they cannot read. A name or an email address; nothing is said when empty. |
| `contact_info.lab_name`, `.lab_url`, `.email` | `null` | Contact block on the login page, shown only when set. |
| `contact_info.custom_html` | `null` | Extra HTML under the contact block. |

## `ui`

Defaults sent to the browser through `/api/v1/config`.

| Key | Default | Meaning |
|---|---|---|
| `enabled_panel_types` | `cell-plot`, `gene-plot`, `cell-table`, `gene-table`, `gene-set` | Panel types offered in "Create New Panel". |
| `defaults.point_size`, `defaults.point_opacity` | `5`, `1.0` | Marker size and opacity for a few thousand points; with more points a panel's automatic values shrink from these (see Cell and gene plots). |
| `defaults.color_scale` | `Portland` | Initial continuous colour scale. |
| `defaults.max_cells`, `defaults.max_genes` | `1000000` | Client-side limits on the number of cells and genes. |
| `defaults.taxonomy_id` | `9606` | NCBI taxonomy id for gene annotations (9606 human, 10090 mouse). |
| `defaults.subset_threshold` | `200000` | A dataset with more cells than this opens on a reproducible cell subset; `0` means always. |
| `defaults.large_plot_points` | `1000000` | A Cell Plot with more points than this is drawn in large-plot mode: table filters and 3D are off (see {doc}`../user-guide/subsets`). |
| `defaults.names_on_demand_above` | `5000000` | A dataset with more cells than this does not download the names of the cells it shows, whatever the subset: hover, click, the focused cell and a table's page ask the server for the names they show, and sorting or searching a table on the names loads them all once. See {ref}`names-on-demand`. |
| `defaults.prefetch_next_part` | `auto` | After a part is shown, read the next part's cells and embedding coordinates in the background, at low priority, so stepping forward waits for little. `auto`: on a single-user server (the laptop, the desktop app) only; `true` or `false` force it. |
| `defaults.subset_size`, `defaults.subset_seed` | `100000`, `0` | Cells in that default subset, and its seed. See {doc}`../design/subsetting`. |
| `memory.enforce` | `block` | Browser memory guard: what happens when an action would not fit in the browser tab's memory. `block` disables it and says why, `warn` says so and lets it run, `off` never interferes. See [Browser memory](#browser-memory-uimemory). |
| `memory.heap_gb` | `null` | JavaScript memory the tab may use, in GB. `null`: what the browser reports (Chrome: 4.4 GB on a 64-bit computer), 4.4 where it reports nothing. |
| `memory.total_gb` | `null` | Everything the tab may hold, JavaScript and typed arrays, in GB. `null`: for a browser on the server's computer (the desktop app, or a browser on localhost), that computer's memory less a quarter, at least 4 GB, for the system and the browser; for a browser on another computer, 16; at most half the device's memory on devices that report 4 GB or less. |
| `memory.margin` | `0.2` | Predictions are multiplied by 1 + margin before they are compared. |
| `cache.max_entries`, `cache.max_size_mb` | `1000`, `1024` | Browser-side cache. |
| `autosave.*` | enabled, every 10,000 ms | Autosave of the current layout to the browser's local storage. |

(browser-memory-uimemory)=
### Browser memory (`ui.memory`)

**What it limits.** A browser closes a tab that runs out of memory, with everything on screen.
Before every action whose memory grows with the number of points (drawing a Cell Plot, opening or
duplicating one, applying a larger subset or every cell, a full-resolution image export, a
recolour, reading the hover labels of a column with more than 65,536 categories), the browser estimates what the action needs and compares it with what is left after
the panels already open. An action that does not fit is refused (`enforce: block`) with what it
needs, what is free and what helps; the user guide shows how it looks ({ref}`browser-memory`).

**What binds.** Chrome gives a tab's JavaScript heap 4.4 GB on a 64-bit computer (it reports this
as `performance.memory.jsHeapSizeLimit`), and no flag raises it; a test tab died at 4.03 GB used.
Typed arrays are outside that heap and are limited only by the computer's memory. So `heap_gb`
is the setting that matters for regular plots; large-plot mode keeps its points in typed arrays,
and for it `total_gb` is the limit to set.

**How the estimates were made.** On an Apple M3 Max laptop with Chrome, drawing up to 182 million
points (the paper's scale benchmark, {ref}`paper-companion`): a Cell Plot in large-plot mode keeps
its points outside the JavaScript heap (0.1 bytes of heap per point; about 65 bytes per point of
typed arrays, and 200 million points drew with a 13.6 GB tab and 35 MB of heap); a regular plot coloured by a gene 640 bytes per point at its peak (3.36 GB at 5
million); the app itself 0.17 GB; hover labels of a categorical column 34 bytes per point plus 62 bytes
and 2 per character per distinct label (measured at a million points: 999,998 barcodes 114 MB,
65,000 labels 38 MB, plus the reply while it loads). There is no cap on the number of labels: a
hover whose labels do not fit stays off, and the plot stays coloured. A full-resolution image export draws the plot again and needs
about the plot's own share again while it runs. Some costs are still estimated from the code
rather than measured (the export, a recolour, 3D, a table row); the guard multiplies every
prediction by 1 + `margin` and adds 0.25 to the margin in a browser whose tab closed during a
marked action. Firefox and Safari report no memory figures; they are held to Chrome's limit.

**Defaults.** `enforce: block`, `heap_gb: null` (the browser's own limit), `total_gb: null`,
`margin: 0.2`. With these the heap limits regular plots (a few million points) and the total
limits large-plot mode, whose points are outside the heap (about 73 bytes per point, 8 of them the hover and click index). A browser
cannot see the computer's memory, so the server tells a browser on its own computer how much
there is (a loopback request no proxy forwarded); the budget is that memory less a quarter,
at least 4 GB, for the system and the browser. On a 16 GB computer that is 12 GB, and a large
plot of 200 million points (13.6 GB measured) is refused; on 128 GB it is drawn. A browser on
another computer gets 16 GB unless `total_gb` says otherwise (server-wide; there is no
per-browser setting). There is no cap on the number of points: 200 million is only the largest
size tested (128 GB, Chrome). The budget is a guard for the computer, not for the browser, which
can run out of array buffers at a size no table predicts (on that 128 GB computer, at 15 to 17 GB
of tab memory, with 250 million points and up). So a large plot first asks the browser for the
buffers it will need, before it requests any data; if the browser refuses, the panel says
"This browser cannot hold N points; use a subset (k parts of m)" and offers the subset. The
same question is asked before applying a larger subset, a full-resolution export, a hover-label
read, a recolour and a new large panel, and a plot whose WebGL context is lost (the graphics
memory ran out) is released with the same message and a Redraw.

**When to change them.**

- Users on thin clients, shared remote desktops or small laptops whose tabs close below these
  sizes: set `total_gb` to what one tab may take (for example `4`), or lower `heap_gb`.
- A site that prefers to let users try and risk the tab: `enforce: warn` (the plot is drawn with
  a warning in its status line).
- Exploring the limits on a benchmark machine: `enforce: off`.
- Raising `heap_gb` above the browser's real limit does not give the tab more memory; it only
  stops the guard from preventing the crash.

```yaml
ui:
  memory:
    enforce: block     # or warn, or "off" (quoted: YAML reads a bare off as false)
    total_gb: 4
```

`server.cross_origin_isolation: auto` lets Chromium measure the page's memory, and the guard
then corrects its estimate with the measured total ("measured" in the subset dialog).

## `integrations`

The external services the Gene Set Analysis panel asks ({doc}`../user-guide/gene-set`). Public:
the browser calls them itself, the server never does.

| Key | Default | Meaning |
|---|---|---|
| `external_requests` | `ask` | Whether the panel may send gene ids to external services. `ask`: the user is asked once per service (Enrichr and Reactome, which keep what they are sent where others can read it, every time). `on`: without asking, for a site whose users agreed beforehand. `off`: never; the panel's Links still work. `none`: never, and the Links are removed too. `ask` leaves it to the browser: the user's answers per service and a share link's consent for its selection (order in the user guide's Consent section). Quote the value in YAML (`"off"`): a bare off is read as false (which also means off). The environment variable `ANNZARRO_EXTERNAL_REQUESTS=off\|ask\|on\|none` overrides it. |
| `gene_set.services` | `null` | The sections offered, by adapter id (`string-network`) or service (`string`, `gprofiler`, `mygene`, `enrichr`, `reactome`, `hpa`). `null`: all of them. |
| `gene_set.timeout_ms` | `20000` | Time one request may take, in ms. A timed-out request is tried once more. |
| `string_db.base_url` | `https://version-12-5.string-db.org/api` | STRING's API. A versioned host, so a result can be reproduced; it says its version in the section. |
| `string_db.version` | `12.5` | The version shown with STRING's results. |

```yaml
integrations:
  external_requests: "off"     # an air-gapped or confidential deployment
```

```yaml
integrations:
  external_requests: "on"      # users agreed out of band; no question asked
  gene_set:
    services: [string, gprofiler, mygene]
```

## `policy`

The policy registry holds the settings an administrator can change at run time. This file stays
the operator's.

| Key | Default | Meaning |
|---|---|---|
| `locked` | `[]` | Policy keys only this file decides (for example `[outbound.allow_external]`). A locked key ignores the admin settings and the per-user overrides, and the Settings page shows it as read-only. |

## Security tiers

Every key in the configuration schema (`annzarro/config/schema.yaml`) has a tier, set on the key
or inherited from its section; a key without one is `internal`.

| Tier | Keys | Where the value appears |
|---|---|---|
| `public` | `server.host`, `server.port`, `server.https_enabled`, `server.unified_server`, `server.url_prefix`, `auth.enabled`, all of `branding`, `ui` and `integrations` | sent to every browser by `GET /api/v1/config`; printed by `config show` |
| `internal` | the default for any key without a tier: every other key, including `server.data_dir`, `allowed_dirs`, `log_file`, the cache, limit and remote-store keys, `auth.user_file`, `session_timeout`, `cookie_secure` | printed by `config show`; never sent to the browser |
| `sensitive` | `auth.secret_key`, `server.cert_file`, `server.key_file` | masked as `********` by `config show` and `config info`; never sent |

`GET /api/v1/config` serves exactly the public keys (plus two flags for the desktop app), so
the browser never learns server paths such as the data directory. If the schema cannot be read,
nothing is published. `config info` also masks environment variables whose name mentions a
secret, password, token or credential, and `--password` arguments.

## A minimal file per mode

Personal server on a shared HPC node (login on although bound to loopback):

```yaml
auth:
  enabled: true
```

Any server behind one reverse proxy:

```yaml
server:
  proxy_count: 1          # trust X-Forwarded-* from the proxy in front
```

Lab server behind nginx: see {doc}`../deployment/lab-server`.

(config-environment)=
## Environment variables

`ANNZARRO_SERVER_PORT=9000` sets `server.port`; underscores inside key names are matched, so
`ANNZARRO_SERVER_CACHE_MEMORY_MB=1000` sets `server.cache_memory_mb`. Values `true/yes/1` and
`false/no/0` become booleans, numbers become numbers, and list keys such as
`server.allowed_dirs` take a comma-separated list. Any key of the configuration schema can be
set this way, including ones with no default such as `auth.enabled`, `auth.secret_key`,
`server.hosted` and `server.allowed_dirs`. The full list of variables, including `ANNZARRO_HOME` and
`ANNZARRO_AUTH_DISABLED`, is in {doc}`cli`.

**Environment beats the files.** Layer 6 sits above every file (layers 2 to 5), so a variable
overrides the same key in `site.yaml`, and only a command-line option beats it. One setting of
the policy registry also has a variable of its own, which the registry treats as decisive:

| Variable | Setting | Notes |
|---|---|---|
| `ANNZARRO_EXTERNAL_REQUESTS` | `integrations.external_requests` | `on`, `ask`, `off` or `none`. It decides the setting for the policy registry too, and beats the YAML in both directions, so a deployment can force a value either way. The admin Settings page shows its source as `env`. A value the setting does not accept is logged and ignored: the YAML decides. |

Seven variables are aliases of `server` keys whose names do not follow `ANNZARRO_<SECTION>_<KEY>`
(`ENV_ALIASES` in `annzarro/utils/config_manager.py`). They are ordinary environment values, above
the files, and `config show` reports them as set:

| Variable | Key |
|---|---|
| `ANNZARRO_REMOTE_STORES` | `server.remote_stores` |
| `ANNZARRO_REMOTE_ALLOWLIST` | `server.remote_allowlist` (comma-separated) |
| `ANNZARRO_REMOTE_CREDENTIALS` | `server.remote_credentials` |
| `ANNZARRO_REMOTE_CONNECT_TIMEOUT` | `server.remote_connect_timeout_s` |
| `ANNZARRO_REMOTE_READ_TIMEOUT` | `server.remote_read_timeout_s` |
| `ANNZARRO_REMOTE_REQUEST_TIMEOUT` | `server.remote_request_timeout_s` (120 s hosted, 600 s single-user; 0 switches it off) |
| `ANNZARRO_REMOTE_CHUNK_CACHE_MB` | `server.remote_chunk_cache_mb` |

(The registry's list is `ENV_OVERRIDES` in `annzarro/server/policy/resolver.py`.) Any other
variable, such as `ANNZARRO_SERVER_PROXY_COUNT=1`, acts as a YAML value: for the policy
registry it is the operator's "config" layer.
