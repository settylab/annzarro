# <span style="color: #357AFA;">AnnZarro</span> <img src="annzarro/desktop/electron/icons/icon.png" width="40" height="40" align="center" alt="AnnZarro logo">

[![Python Version](https://img.shields.io/badge/python-3.9%2B-blue)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

AnnZarro is a modern single-cell data visualization tool for analyzing AnnData objects stored in zarr format. It features a browser-based interface with a lightweight Python backend and can be used as either a web application or standalone desktop app.

## Key Features

- **Interactive Visualization** - Scatter plots, heatmaps and tables using plotly.js
- **Comprehensive AnnData Support** - Access all components (.obs, .var, .obsm, .varm, .obsp, .varp, .layers)
- **Efficient Data Handling** - Lazy loading and sparse matrix support for large datasets
- **Flexible Access** - Local .zarr and .h5ad files; remote zarr stores over S3, GCS or HTTP(S) (optional extra, see [Remote datasets](#remote-datasets))
- **Desktop Application** - Standalone app for Windows, macOS and Linux, server included (no Python needed)

## Installation & Usage

### Quick Start

```bash
# Clone the repository
git clone https://github.com/settylab/annzarro.git
cd annzarro

# Install dependencies (uses virtual environment by default)
./annzarro-cli install

# Start the server
./annzarro-cli start

# Or run the desktop app
./annzarro-cli desktop run
```

Then open http://localhost:8000 in your browser if using server mode.

### Installation Options

These are options of the checkout's `./annzarro-cli` wrapper and
`annzarro-install.py`; the `annzarro` command a pip install provides does not
take them.

```bash
# Install without virtual environment
./annzarro-cli install --no-venv

# Clean reinstall 
./annzarro-cli install --clean

# Use standalone installer directly
python annzarro-install.py

# Skip optional dependencies
./annzarro-cli install --no-extras
```

### Server Commands

```bash
# Start with custom settings
./annzarro-cli start --port 8080 --data-dir /path/to/data

# Run in background
./annzarro-cli start --detach

# Stop the server
./annzarro-cli stop

# Manage users
./annzarro-cli user add
./annzarro-cli user add --admin       # may delete/overwrite anyone's panel sets
                                      # (a running server sees user changes at once)
./annzarro-cli user list
./annzarro-cli user remove --username username
./annzarro-cli user passwd --username username      # signs out their existing logins
./annzarro-cli user set-admin --username username   # --no-admin to revoke
```

### Sharing a Server: Login and Permissions

AnnZarro never writes your datasets. The only thing users write is **panel
sets**, saved as JSON in `<data-dir>/sessions/` and visible to every user of the
server.

- **Login** is required automatically when the server binds to anything other
  than `127.0.0.1`/`localhost`. `--auth-disabled` (or `ANNZARRO_AUTH_DISABLED=true`;
  only `true`/`yes`/`1`/`on` count, `false`/`0` keep login on) turns it off; doing that on a network address logs a `SECURITY` warning at
  startup and shows a "No login" badge in the header, because anyone who can
  reach the port can then open every shared dataset and delete every panel set.
- **Shared datasets only.** When login is on or the host is not localhost, every
  dataset path and directory listing must resolve (symlinks and `..` followed)
  inside `--data-dir`, or a directory listed in `server.allowed_dirs`;
  anything else is refused. A dataset symlinked into the data directory from
  elsewhere therefore needs its target's directory in `allowed_dirs` (startup
  names any such links). Local single-user mode browses freely, as before.
- **Login cookies** are signed with `auth.secret_key`. Leave it unset: on first
  start a random key is generated and kept (mode 0600) beside the users file as
  `annzarro_secret_key`, shared by every worker and reused across restarts.
  The old shipped placeholder values are ignored with a warning.
  The cookie is `HttpOnly` and `SameSite=Lax`, and `Secure` whenever the
  request came over HTTPS (`auth.cookie_secure: auto`; behind a proxy this
  needs `server.proxy_count`). A login expires after `auth.session_timeout`
  seconds without a request (default 8 hours; 0 = never), and at once when
  the user is removed or their password is changed.
- **Unauthenticated requests** get 401 (API) or the login page before any
  path check, and the login page returns to the requested link, `#view=`
  included.
- **With login**, everyone can load, export and duplicate any panel set and
  save new ones. Deleting, renaming, or saving/importing **over** an existing
  set is allowed only to the user who first saved it (its owner, recorded in
  the file) and to **admins** (`user add --admin`). Sets saved before owners
  were recorded can only be changed by an admin. On a shared server only
  admins can empty the shared cache (`POST /api/v1/cache/reset`).
- **Without login** (local, single-user) there are no restrictions.
- **Panel sets from before owners were recorded** stay admin-only until an
  admin hands them to someone: while logged in as an admin,
  `POST /api/v1/sessions/owner` with `{"name": "<set>", "owner": "<user>"}`
  (the owner must be an existing user; this also reassigns any other set).

### Deploying on a Lab Server

Run gunicorn on loopback behind a TLS-terminating reverse proxy, using the
hosted WSGI factory:

```bash
export ANNZARRO_CONFIG=/etc/annzarro/site.yaml   # start from annzarro/server/site.example.yaml
gunicorn -c python:annzarro.server.gunicorn_config "annzarro.server.wsgi:create_wsgi_app()"
# or: annzarro/server/run_gunicorn.sh, or the systemd unit annzarro/server/annzarro.service
```

`ANNZARRO_CONFIG` is read by the `annzarro` command too (when `--config` is
not given), so `annzarro config show` and `annzarro user add` see the same
site file as gunicorn.

The gunicorn config binds to `server.host:server.port` from the same
configuration (default `127.0.0.1:8000`), runs `server.workers` workers
(default 4; each keeps its own dataset cache), and logs to stderr.

`create_wsgi_app()` loads the same merged configuration as `annzarro start`
and, because it cannot know where gunicorn binds, treats the server as
**hosted**: login is on and datasets are confined to `data_dir` (plus
`server.allowed_dirs`) unless the config says otherwise. `auth.enabled: false`
is still honoured but logs a `SECURITY` banner and shows "No login" in the
header. Do not use `create_app()` directly as a gunicorn target: with no
configuration it runs with laptop defaults (no login, no confinement).

A minimal `site.yaml` (see `annzarro/server/site.example.yaml`):

```yaml
server:
  data_dir: /srv/annzarro/data
  proxy_count: 1          # trust X-Forwarded-For/-Proto from the one proxy in front
auth:
  user_file: /srv/annzarro/users.json   # the login key is generated beside it
```

`proxy_count` defaults to 0: no `X-Forwarded-*` header is trusted, so the
server sees the proxy's address and plain HTTP, and the login cookie is not
marked `Secure`. Set it to the number of proxies in front.

CORS is off: the frontend is served by the same server. `server.cors_enabled:
true` with `server.cors_origins` allows other origins to call `/api/*`
(never with the login cookie).

Every setting can also come from an `ANNZARRO_<SECTION>_<KEY>` variable, e.g.
`ANNZARRO_SERVER_DATA_DIR`, `ANNZARRO_AUTH_ENABLED`, `ANNZARRO_AUTH_SECRET_KEY`,
`ANNZARRO_SERVER_ALLOWED_DIRS` (comma-separated). `annzarro config show` lists
the merged result, where each value came from, and any variable it ignored.

TLS belongs in the proxy, e.g. nginx:

```nginx
server {
    listen 443 ssl;
    server_name annzarro.example.org;
    ssl_certificate     /etc/letsencrypt/live/annzarro.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/annzarro.example.org/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Without TLS, login passwords and session cookies cross the network in clear
text. Share links carry the dataset path in the query string
(`?dataset_path=...#view=...`), so access logs reveal which datasets people
open; the view state itself sits in the URL fragment, which browsers never send
to the server.

### Desktop Application

The desktop app bundles its own server: no Python installation is needed.
Download it from the [releases page](https://github.com/settylab/annzarro/releases)
(see [Download](#download)). To run or build it from a source checkout
(needs Node.js and npm):

```bash
./annzarro-cli desktop run      # development mode, uses this checkout's Python
./annzarro-cli desktop build    # freezes the server, then packages for this platform
```

Details: [`annzarro/desktop/README.md`](annzarro/desktop/README.md).

## Working with Data

Add datasets by copying or linking .zarr directories (or .h5ad files) into the
data directory, `~/annzarro-data` unless `server.data_dir` or `--data-dir` says
otherwise (the desktop app uses the same folder):

```bash
# Copy a dataset
cp -r /path/to/your-dataset.zarr ~/annzarro-data/

# Or create a symlink
ln -s /path/to/your-dataset.zarr ~/annzarro-data/

# Use a custom data directory
./annzarro-cli start --data-dir /path/to/datasets
```

### Sharing a view

**Share Link** in the header copies a URL that reopens the current dataset with
the same split layout, panel settings and focused cell/gene. The view travels
compressed in the URL fragment (`?dataset_path=…#view=…`), so it never reaches
the server and long layouts do not hit request-line limits. Without clipboard
access (e.g. plain http on a cluster node) the link is shown for manual copying.
See the [deep-link reference](https://annzarro.readthedocs.io/en/latest/reference/deep-links.html) for the format.

### Remote datasets

A zarr store can also be opened by URL: type it into the dataset box instead
of a local path.

```
s3://bucket/path/pbmc.zarr
gs://bucket/path/pbmc.zarr
https://data.example.org/pbmc.zarr
```

This needs the optional remote dependencies (`fsspec`, `s3fs`, `gcsfs`,
`aiohttp`), which `./annzarro-cli install` includes unless `--no-extras` is
given; with pip, `pip install 'annzarro[remote]'`. Without them, opening a URL
fails with a message naming that extra.

What works and what does not:

- **zarr only.** `.h5ad` is read from local disk; a remote `.h5ad` URL is
  refused. Convert with `adata.write_zarr(...)`.
- **Anonymous by default.** Public buckets and plain HTTP need nothing. For
  private buckets set `remote_credentials: environment`; the server then uses
  the standard credential chain (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`,
  `AWS_PROFILE` and `~/.aws`, instance roles; Google application default
  credentials for `gs://`). Credentials are never accepted inside the URL
  (`https://user:pass@...`), and query strings (pre-signed URLs) are refused.
- **HTTP needs consolidated metadata.** HTTP cannot list a directory, so obs
  columns and obsm/layers keys are only discoverable from `.zmetadata`
  (written by `anndata`'s `write_zarr` by default; add one with
  `zarr.consolidate_metadata(path)`). S3 and GCS list natively.
- **Latency.** The store root, metadata and (with zarr 3) recently read
  chunks are kept in memory per URL; anything else is fetched. Measured on
  public Vitessce AnnData stores: first open with full structure 4 to 7 s;
  then 0.1 to 0.7 s per gene, obs column or embedding (13k cells, `gs://`).
  A CSR-encoded X must read the whole matrix for one gene: 4 s per gene
  uncached, 1 to 1.5 s once its chunks are in the chunk cache (4k spots,
  HTTPS).
- **Caches assume the store does not change** while the server runs; restart
  the server or `POST /api/v1/cache/reset` after rewriting a store.

#### Who may open remote URLs

A remote dataset path makes the *server* fetch a URL the *client* chose. On
your own machine that is just you reading your data; on a shared server it
would let any visitor point it at internal services or cloud metadata
endpoints. So it is policy-controlled, in the `server:` section of the config
(or the matching `ANNZARRO_REMOTE_*` environment variables, which win):

```yaml
server:
  remote_stores: auto          # auto | allow | deny
  remote_allowlist: []         # e.g. ["s3://lab-bucket/atlases/", "https://data.example.org/zarr/"]
  remote_credentials: anonymous  # anonymous | environment
  remote_connect_timeout_s: 10   # a store that does not answer in time
  remote_read_timeout_s: 30      # fails the request with HTTP 504
  remote_chunk_cache_mb: 256     # raw-bytes LRU per open remote store (zarr 3); 0 = off
```

- `auto` (default) allows any URL on a local single-user server (loopback
  host, auth disabled, no reverse proxy). Otherwise remote stores are off
  unless `remote_allowlist` is set, and then only URLs under those prefixes
  open (matched on exact scheme and host and on whole path segments; HTTP
  redirects are not followed).
- `allow` turns them on regardless; with an allowlist it still restricts.
- `deny` turns them off.

A refused URL is answered with HTTP 403 and never fetched.

## Development

```bash
# Run tests
python -m pytest

# Start in development mode
./annzarro-cli start --development
```

## Architecture

- **Frontend**: Pure JavaScript with plotly.js and DataTables
- **Backend**: Flask-based REST API with comprehensive zarr support
- **Desktop**: Electron window around the server, frozen with PyInstaller

## Download

Each release on the [releases page](https://github.com/settylab/annzarro/releases)
carries the desktop app for every platform (`<version>` is the release, e.g. `0.2.0`):

| System | File | What it is |
|---|---|---|
| macOS, Apple silicon (M1 and later) | `AnnZarro-<version>-macos-arm64.dmg` | disk image: drag AnnZarro to Applications |
| | `AnnZarro-<version>-macos-arm64.zip` | the same app, zipped |
| macOS, Intel | `AnnZarro-<version>-macos-x64.dmg` / `.zip` | as above |
| Windows 10/11, 64-bit | `AnnZarro-<version>-windows-x64-setup.exe` | installer (per user, no admin rights needed) |
| | `AnnZarro-<version>-windows-x64.zip` | portable: unzip and run `AnnZarro.exe` |
| Linux x86-64 | `AnnZarro-<version>-linux-x86_64.AppImage` | single file: `chmod +x` it and run |
| Debian/Ubuntu | `AnnZarro-<version>-linux-amd64.deb` | `sudo apt install ./AnnZarro-<version>-linux-amd64.deb` |
| | `SHA256SUMS.txt` | checksums: `shasum -a 256 -c SHA256SUMS.txt --ignore-missing` |

The builds are not code-signed yet, so the first launch needs one extra step:

- **macOS**: opening it says Apple cannot check it for malicious software.
  Open **System Settings > Privacy & Security**, scroll to the message about
  AnnZarro and click **Open Anyway** (once). Or, in a terminal:
  `xattr -dr com.apple.quarantine /Applications/AnnZarro.app`.
- **Windows**: SmartScreen says "Windows protected your PC". Click
  **More info**, then **Run anyway**.
- **Linux**: no extra step (AppImage needs `chmod +x`; on Ubuntu 24.04 and
  later an AppImage may need `--no-sandbox` if it fails to start).

The very first start can take up to a minute while the system scans the
bundled server; later starts take a few seconds. The app starts its server on
`127.0.0.1` only (first free port from 39487), with login off, and uses
`~/annzarro-data` as its data directory: put or link datasets into
`~/annzarro-data/datasets`, or open any `.zarr` folder with the folder button.
Saved panel sets go to `~/annzarro-data/sessions`. Remote (s3/gs/http) stores
are not supported in the desktop app; use `pip install "annzarro[remote]"`.

### Creating a new release

The app version is the Python package version (`pyproject.toml`);
`bump_version.py` writes it to `annzarro/__init__.py` and
`annzarro/desktop/electron/package.json`, and CI refuses a build where they differ.

1. `python bump_version.py 0.2.0`, commit, merge.
2. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. `.github/workflows/build.yml` builds and smoke-tests macOS (arm64, x64),
   Windows and Linux, then creates a **draft** release with all files and
   `SHA256SUMS.txt`. Review it and publish.

Run the workflow by hand (Actions > Desktop apps > Run workflow, or
`gh workflow run build.yml --ref <branch>`) to build without releasing.

## License

MIT

### Third-party components

The web interface bundles unmodified third-party libraries (Bootstrap, jQuery,
DataTables and extensions, Plotly.js, Select2, chroma.js, Font Awesome Free)
under `annzarro/static/vendor/`, each under its own permissive license
(MIT, BSD-3-Clause, Apache-2.0, SIL OFL 1.1). Versions, sources, checksums and
full license texts are listed in
[`annzarro/THIRD_PARTY_LICENSES/`](annzarro/THIRD_PARTY_LICENSES/README.md).
The pinned list is `scripts/vendor-assets.json`; `python scripts/vendor_assets.py`
installs it into a source checkout, and every wheel/sdist build ships it.
