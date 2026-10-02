# <span style="color: #357AFA;">AnnZarro</span> <img src="annzarro/desktop/electron/icons/icon.png" width="40" height="40" align="center" alt="AnnZarro logo">

[![Python Version](https://img.shields.io/badge/python-3.8%2B-blue)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE)

AnnZarro is a modern single-cell data visualization tool for analyzing AnnData objects stored in zarr format. It features a browser-based interface with a lightweight Python backend and can be used as either a web application or standalone desktop app.

## Key Features

- **Interactive Visualization** - Scatter plots, heatmaps and tables using plotly.js
- **Comprehensive AnnData Support** - Access all components (.obs, .var, .obsm, .varm, .obsp, .varp, .layers)
- **Efficient Data Handling** - Lazy loading and sparse matrix support for large datasets
- **Flexible Access** - Local files, HTTP, or S3 connectivity
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
./annzarro-cli user add --admin       # may delete/overwrite anyone's panel sets
                                      # (a running server sees user changes at once)
./annzarro-cli user list
./annzarro-cli user remove --username username
```

### Sharing a Server: Login and Permissions

AnnZarro never writes your datasets. The only thing users write is **panel
sets**, saved as JSON in `<data-dir>/sessions/` and visible to every user of the
server.

- **Login** is required automatically when the server binds to anything other
  than `127.0.0.1`/`localhost`. `--auth-disabled` (or `ANNZARRO_AUTH_DISABLED`)
  turns it off; doing that on a network address logs a `SECURITY` warning at
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
- **With login**, everyone can load, export and duplicate any panel set and
  save new ones. Deleting, renaming, or saving/importing **over** an existing
  set is allowed only to the user who first saved it (its owner, recorded in
  the file) and to **admins** (`user add --admin`). Sets saved before owners
  were recorded can only be changed by an admin.
- **Without login** (local, single-user) there are no restrictions.
- **Panel sets from before owners were recorded** stay admin-only until an
  admin hands them to someone: while logged in as an admin,
  `POST /api/v1/sessions/owner` with `{"name": "<set>", "owner": "<user>"}`
  (the owner must be an existing user; this also reassigns any other set).

### Deploying on a Lab Server

Run gunicorn on loopback behind a TLS-terminating reverse proxy, using the
hosted WSGI factory:

```bash
cd /opt/annzarro                      # config/*.yaml are read from here
export ANNZARRO_CONFIG=/etc/annzarro/site.yaml
gunicorn -w 4 -b 127.0.0.1:8000 "annzarro.server.wsgi:create_wsgi_app()"
# or: annzarro/server/run_gunicorn.sh, or the systemd unit annzarro/server/annzarro.service
```

`create_wsgi_app()` loads the same merged configuration as `annzarro start`
and, because it cannot know where gunicorn binds, treats the server as
**hosted**: login is on and datasets are confined to `data_dir` (plus
`server.allowed_dirs`) unless the config says otherwise. `auth.enabled: false`
is still honoured but logs a `SECURITY` banner and shows "No login" in the
header. Do not use `create_app()` directly as a gunicorn target: with no
configuration it runs with laptop defaults (no login, no confinement).

A minimal `site.yaml`:

```yaml
server:
  data_dir: /srv/annzarro/data
  proxy_count: 1          # trust X-Forwarded-* from the one proxy in front
auth:
  user_file: /srv/annzarro/users.json   # the login key is generated beside it
```

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
text. Share links carry the dataset path and the view state in the URL itself
(`?dataset_path=...&view=...`), so they appear in proxy and gunicorn access
logs; treat those logs as revealing which datasets people look at.

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
