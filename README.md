# <span style="color: #357AFA;">AnnZarro</span> <img src="annzarro/desktop/electron/icons/icon.png" width="40" height="40" align="center" alt="AnnZarro logo">

[![Python Version](https://img.shields.io/badge/python-3.8%2B-blue)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE)

AnnZarro is a modern single-cell data visualization tool for analyzing AnnData objects stored in zarr format. It features a browser-based interface with a lightweight Python backend and can be used as either a web application or standalone desktop app.

## Key Features

- **Interactive Visualization** - Scatter plots, heatmaps and tables using plotly.js
- **Comprehensive AnnData Support** - Access all components (.obs, .var, .obsm, .varm, .obsp, .varp, .layers)
- **Efficient Data Handling** - Lazy loading and sparse matrix support for large datasets
- **Flexible Access** - Local .zarr and .h5ad files; remote zarr stores over S3, GCS or HTTP(S) (optional extra, see [Remote datasets](#remote-datasets))
- **Desktop Application** - Standalone cross-platform electron app

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
./annzarro-cli user list
./annzarro-cli user remove -u username
```

### Desktop Application

```bash
# Run desktop app
./annzarro-cli desktop run

# Build for distribution
./annzarro-cli desktop build --platform [windows|mac|linux]
```

## Working with Data

Add datasets by copying or linking .zarr directories to the data/ folder:

```bash
# Copy a dataset
cp -r /path/to/your-dataset.zarr data/

# Or create a symlink
ln -s /path/to/your-dataset.zarr data/

# Use a custom data directory
./annzarro-cli start --data-dir /path/to/datasets
```

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
- **Latency.** The store root and metadata are cached per URL, but every new
  slice is fetched from the network. Measured on public Vitessce AnnData
  stores (13k cells, `gs://`): first open with full structure 4 to 7 s, then
  0.2 to 0.7 s per gene, obs column or embedding.
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
- **Desktop**: Electron application with integrated Python server

## Download

Get the latest desktop app for your platform:

- [Windows](https://github.com/settylab/annzarro/releases/latest/download/AnnZarro-Setup.exe)
- [macOS](https://github.com/settylab/annzarro/releases/latest/download/AnnZarro.dmg)
- [Linux](https://github.com/settylab/annzarro/releases/latest/download/AnnZarro.AppImage)

### Creating a new release

To create a new release with desktop apps for all platforms:

1. Update version in `annzarro/desktop/electron/package.json`
2. Create and push a new tag:
   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```
3. GitHub Actions will automatically build the desktop apps and create a release

## License

GPL-3.0-or-later
