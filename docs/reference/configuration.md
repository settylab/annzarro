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
| `data_dir` | `~/annzarro-data` | Data directory: the datasets offered in the picker (stores at its top level and in its `datasets/` subdirectory), and `sessions/` for panel sets. A configured relative path is taken from the working directory; `~` is expanded. |
| `allowed_dirs` * | none | Extra directory trees a shared server may open, e.g. targets of symlinks in `data_dir`. Every store under them can be opened by path. |
| `hosted` * | unset | `true` forces shared-server behaviour (path confinement, remote policy, compression, exposure warning) whatever the host; `false` forces local behaviour. Unset: decided by login and host. The gunicorn entry point sets `true` unless you set `false`. |
| `proxy_count` | `0` | Number of reverse proxies whose `X-Forwarded-For/-Proto/-Host` headers are trusted. Set `1` behind nginx or Apache; never more than the proxies you run, or clients can forge their address. Any value above 0 also counts as "shared" for the remote-store policy `auto`. |
| `debug` | `false` | Flask debug mode (reloader and interactive debugger). `true` only in the `development` layer; never on a reachable server. |
| `log_file` | `~/.annzarro/logs/annzarro_server.log` | Server log. Relative paths are taken from the working directory. |
| `log_level` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` or `CRITICAL`. |
| `max_response_elements` | `10000000` | Largest reply in array elements; larger slices are refused with `413 {"reason": "response_too_large"}` before anything is read. One full row or column is always allowed. |
| `cross_origin_isolation` | `off` | `off`, `on` or `auto`: send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. A page served with them is cross-origin isolated, and Chromium then lets it measure its own memory (`performance.measureUserAgentSpecificMemory`), so the browser memory guard (`ui.memory`) works from measured rather than estimated numbers. AnnZarro serves all its scripts and fonts itself and logs in by redirect, so the headers do not break it as a page of its own; an isolated page cannot be shown in a frame of another site, so `auto` leaves them off for requests the browser makes for a frame (`Sec-Fetch-Dest: iframe`). Off by default until tested behind your proxy and login; quote the value in YAML (`"off"`). |
| `compress_responses` * | `auto` | gzip (level 1) for JSON replies: `auto` on a shared server only, or `true` / `false`. Set `false` if the proxy compresses already. |
| `cache_enabled` | `true` | Server-side cache of dataset metadata and read results. |
| `cache_memory_mb` | `4000` | Memory bound of that cache, per process (per gunicorn worker). `base.yaml` alone: 1000. |
| `cache_dataset_limit` | `20` | Datasets kept open in the cache. |
| `remote_stores` | `auto` | `auto`, `allow` or `deny` for `s3://`, `gs://`, `gcs://`, `http(s)://` stores (no other scheme is remote); see {doc}`../deployment/authentication`. |
| `remote_allowlist` | `[]` | URL prefixes remote stores must start with, e.g. `["s3://lab-bucket/atlases/"]`. |
| `remote_credentials` | `anonymous` | `anonymous` (unsigned requests) or `environment` (the AWS and Google standard credential chains of the server account). |
| `remote_connect_timeout_s` | `10` | Seconds to establish a connection to a remote store. |
| `remote_read_timeout_s` | `30` | Seconds to wait between bytes before the request fails with 504. |
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
| `contact_info.lab_name`, `.lab_url`, `.email` | `null` | Contact block on the login page, shown only when set. |
| `contact_info.custom_html` | `null` | Extra HTML under the contact block. |

## `ui`

Defaults sent to the browser through `/api/v1/config`.

| Key | Default | Meaning |
|---|---|---|
| `enabled_panel_types` | `cell-plot`, `gene-plot`, `cell-table`, `gene-table` | Panel types offered in "Create New Panel". |
| `defaults.point_size`, `defaults.point_opacity` | `5`, `1.0` | Marker size and opacity for a few thousand points; with more points a panel's automatic values shrink from these (see Cell and gene plots). |
| `defaults.color_scale` | `Portland` | Initial continuous colour scale. |
| `defaults.max_cells`, `defaults.max_genes` | `1000000` | Client-side limits on the number of cells and genes. |
| `defaults.taxonomy_id` | `9606` | NCBI taxonomy id for gene annotations (9606 human, 10090 mouse). |
| `defaults.subset_threshold` | `200000` | A dataset with more cells than this opens on a reproducible cell subset; `0` means always. |
| `defaults.large_plot_points` | `1000000` | A Cell Plot with more points than this is drawn in large-plot mode: hover, click and table filters are off (see {doc}`../user-guide/subsets`). |
| `defaults.subset_size`, `defaults.subset_seed` | `100000`, `0` | Cells in that default subset, and its seed. See {doc}`../design/subsetting`. |
| `memory.enforce` | `block` | Browser memory guard: what happens when an action would not fit in the browser tab's memory. `block` disables it and says why, `warn` says so and lets it run, `off` never interferes. See [Browser memory](#browser-memory-uimemory). |
| `memory.heap_gb` | `null` | JavaScript memory the tab may use, in GB. `null`: what the browser reports (Chrome: 4.4 GB on a 64-bit computer), 4.4 where it reports nothing. |
| `memory.total_gb` | `null` | Everything the tab may hold, JavaScript and typed arrays, in GB. `null`: no limit, except half the device's memory on devices that report 4 GB or less. |
| `memory.margin` | `0.2` | Predictions are multiplied by 1 + margin before they are compared. |
| `cache.max_entries`, `cache.max_size_mb` | `1000`, `1024` | Browser-side cache. |
| `autosave.*` | enabled, every 10,000 ms | Autosave of the current layout to the browser's local storage. |

(browser-memory-uimemory)=
### Browser memory (`ui.memory`)

**What it limits.** A browser closes a tab that runs out of memory, with everything on screen.
Before every action whose memory grows with the number of points (drawing a Cell Plot, opening or
duplicating one, applying a larger subset or every cell, a full-resolution image export, a
recolour), the browser estimates what the action needs and compares it with what is left after
the panels already open. An action that does not fit is refused (`enforce: block`) with what it
needs, what is free and what helps; the user guide shows how it looks ({ref}`browser-memory`).

**What binds.** Chrome gives a tab's JavaScript heap 4.4 GB on a 64-bit computer (it reports this
as `performance.memory.jsHeapSizeLimit`), and no flag raises it; a test tab died at 4.03 GB used.
Typed arrays are outside that heap and are limited only by the computer's memory. So `heap_gb`
is the setting that matters; `total_gb` is for computers with little memory.

**How the estimates were made.** On an Apple M3 Max laptop with Chrome, drawing up to 182 million
points (annzarro-paper `benchmark/scale`): a Cell Plot in large-plot mode holds 20.2 bytes of the
JavaScript heap per point (1.94 GB at 95.6 million points, 3.53 GB at 175 million; 182 million
crashed); a regular plot coloured by a gene 640 bytes per point at its peak (3.36 GB at 5
million); the app itself 0.17 GB. A full-resolution image export draws the plot again and needs
about the plot's own share again while it runs. Some costs are still estimated from the code
rather than measured (the export, a recolour, 3D, a table row); the guard multiplies every
prediction by 1 + `margin` and adds 0.25 to the margin in a browser whose tab closed during a
marked action. Firefox and Safari report no memory figures; they are held to Chrome's limit.

**Defaults.** `enforce: block`, `heap_gb: null` (the browser's own limit), `total_gb: null`,
`margin: 0.2`. With these, a single plot of up to about 160 million points is allowed in
large-plot mode, and two plots of 95.6 million points are not.

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

## Environment variables

`ANNZARRO_SERVER_PORT=9000` sets `server.port`; underscores inside key names are matched, so
`ANNZARRO_SERVER_CACHE_MEMORY_MB=1000` sets `server.cache_memory_mb`. Values `true/yes/1` and
`false/no/0` become booleans, numbers become numbers, and list keys such as
`server.allowed_dirs` take a comma-separated list. Any key of the configuration schema can be
set this way, including ones with no default such as `auth.enabled`, `auth.secret_key`,
`server.hosted` and `server.allowed_dirs`. The full list of variables, including `ANNZARRO_HOME` and
`ANNZARRO_AUTH_DISABLED`, is in {doc}`cli`.
