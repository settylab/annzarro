# AnnZarro Desktop Application

The desktop app is an Electron window around the AnnZarro server. Users
download it from the [releases page](https://github.com/settylab/annzarro/releases)
(files, first-launch steps: see "Download" in the top-level README); they do
not need Python.

## How it works

- `server/annzarro-server.spec` freezes the `annzarro` command with PyInstaller
  into a self-contained directory, `annzarro-server/` (Python, numpy, zarr,
  h5py, scipy.sparse, Flask, the web frontend with every vendored library and
  font, configuration defaults, licenses): 56 MB on macOS, 90 MB on Windows
  and Linux, where numpy brings its own OpenBLAS. `annzarro.desktop.freeze`
  lists what goes in and what is left out (scipy beyond `scipy.sparse`,
  cryptography, ...); a test serves requests and fails if the server imports
  anything left out.
- The app works with no network: nothing is downloaded at first launch or
  later, and no page loads anything from a CDN. `electron/test/offline-session.js`
  checks this on every CI build (see "Testing").
- The `[remote]` extra (s3/gs/http stores) is not bundled: it adds about
  100 MB (botocore, grpc, google-auth, aiohttp) to a 56 MB server, the app is
  meant for data on the user's own disk, and it works offline. Use
  `pip install "annzarro[remote]"` for remote stores.
- electron-builder copies it into the app's resources (`resources/server/`).
- `electron/main.js` runs, on a free port from 39487:

  ```
  annzarro-server start --host 127.0.0.1 --port <port> \
      --data-dir ~/annzarro-data --auth-disabled --no-browser
  ```

  so the server listens on the loopback interface only, with login off: the
  same local single-user mode as `annzarro start` on a laptop. Datasets are
  only read. The window loads the UI once `GET /api/v1/datasets` answers
  (up to 180 s: the first start after installing is slowed by Gatekeeper and
  Defender scanning the server). Quitting the app stops the server.
- Starting is bounded: the loading screen counts the seconds and explains a
  slow first start; if the server has not answered after 180 s, or the
  interface has not loaded 60 s after that, the window shows an error page
  with the reason, the log path and a Retry button. A second launch focuses
  the running window (one instance per profile). Each launch tags its server
  with a random token (`ANNZARRO_INSTANCE_ID`, sent back in an
  `X-AnnZarro-Instance` header) and only trusts the server that answers with
  it, so two launches that pick the same port at once never adopt each other's
  server; the one that loses the port tries the next.
- `electron/preload.js` gives the page a native folder dialog (the folder
  button next to the Dataset picker) and an autosave hook before quit.

### Where things are

| What | Where |
|---|---|
| Datasets (listed in the Dataset picker) | `~/annzarro-data/datasets` (copy or symlink stores here) |
| Saved panel sets | `~/annzarro-data/sessions` |
| App log, including the server's output (`server:` lines) | macOS `~/Library/Logs/AnnZarro/main.log`, Windows `%APPDATA%\AnnZarro\logs\main.log`, Linux `~/.config/AnnZarro/logs/main.log` |
| Server state (PID file, server log) | `~/.annzarro` (as for `annzarro start`) |
| Optional settings | `~/.config/annzarro/config.yaml`, read as by `annzarro start`; host, port, data directory and login are fixed by the app |

The error page (shown if the server does not start) names the log file.

## Building from source

Needs Python 3.11 (the version releases are built with; 3.9+ works), Node.js
LTS and npm. Each platform must be built on that platform: the frozen server
contains native libraries for the system it was built on.

```bash
python annzarro/desktop/scripts/build_server.py   # clean venv + PyInstaller -> electron/server/
python annzarro/desktop/scripts/smoke_server.py \
    annzarro/desktop/electron/server/annzarro-server/annzarro-server \
    --dataset annzarro/tests/data/fixture_small.zarr  # start it, read a gene column
cd annzarro/desktop/electron
npm ci
npx electron-builder --publish never              # dmg+zip / nsis+zip / AppImage+deb in dist/
```

`annzarro desktop build [--platform mac|windows|linux]` runs the same steps
(`--no-build-server` reuses an existing frozen server). `annzarro desktop run`
(or `npm start` in `electron/`) starts the app from the checkout: it uses the
frozen server in `electron/server/` if there is one, otherwise
`python3 -m annzarro.cli start` (set `ANNZARRO_PYTHON` to choose the
interpreter).

### Testing

To test a built app without clicking:

```bash
python annzarro/desktop/scripts/smoke_app.py dist/mac-arm64/AnnZarro.app/Contents/MacOS/AnnZarro
```

It runs the app with `ANNZARRO_DESKTOP_SMOKE=1`: the app starts its server,
loads the UI, checks that Plotly loaded and `/api/v1/datasets` answers, prints
`ANNZARRO_DESKTOP_SMOKE ok ...` and quits. Other switches:
`ANNZARRO_DESKTOP_DATA_DIR` (data directory), `ANNZARRO_DESKTOP_USER_DATA`
(profile: settings, local storage, log and the single-instance lock; the
self-test and the offline test always use a temporary one, so they never hand
a user's launch to a test window or leave state in the user's profile),
`ANNZARRO_SERVER_BINARY` (server to run). The app prints `ANNZARRO_DESKTOP_READY <url>` once the server
answers. In this mode every request the window makes beyond 127.0.0.1 is
cancelled and fails the check.

A full session with the network cut off (needs `npm ci` in `electron/`):

```bash
node annzarro/desktop/electron/test/offline-session.js \
    annzarro/desktop/electron/dist/mac-arm64/AnnZarro.app/Contents/MacOS/AnnZarro \
    annzarro/tests/data/fixture_small.zarr report.json
```

It opens the dataset, a cell plot, focuses a gene and a cell, opens a cell
table and exports the plot as PNG, while the app's main process cancels and
records every request not to 127.0.0.1. It fails on any such request, on a
missing page or asset, a 5xx or a page error, and it first checks that a CDN
fetch really is cancelled. `report.json` lists every static file the UI
loaded. `scripts/size_report.py` prints the size of each component.

Two start-up tests guard against an app that never gets past a spinner:

- `scripts/port_clash_test.py <app>`: port 39487 held by a program that
  accepts connections and never answers, and (macOS/Linux) the port taken
  while the server starts. The app must come up on another port.
- `node electron/test/dataset-gone.js <app> <dataset>`: open a copy of a
  dataset, delete it, start again with the same profile; five seconds later
  nothing may still be spinning and new panels can be added.

## Versions and releases

The app version is the Python package version: `bump_version.py` writes
`pyproject.toml`'s version into `electron/package.json`, a test and the
workflow fail if they differ, and a release tag must be `v<version>`.

`.github/workflows/build.yml` builds macOS arm64 (macos-14), macOS x64
(macos-15-intel), Windows x64 and Linux x64 (ubuntu-22.04, for an old enough
glibc). Each job freezes the server, smoke-tests it on the v2 and v3 test
fixtures, packages the app and launches it in self-test mode. A `v*` tag then
creates a draft release with every file and `SHA256SUMS.txt`;
`workflow_dispatch` only builds (files are kept as workflow artifacts).

## Licences in the app

`scripts/build_server.py` ends by writing `server/THIRD_PARTY_NOTICES/`
(`scripts/notices.py`): CPython's licence and acknowledgements, the licence
files of every pip distribution PyInstaller froze in (read from PyInstaller's
TOC files, so exactly what is in the bundle), and the licences of native
libraries copied from the build machine, from `notices/`. The build stops if
a native library has no known notice, or if GNU Readline or ncurses (GPL) got
in: `freeze.EXCLUDES` keeps Python's `readline` module out. Electron's and
Chromium's licences ship as `LICENSE.electron.txt` and
`LICENSES.chromium.html` (on macOS through `mac.extraResources` from
`node_modules/electron/dist`, which `npm ci` populates via `install-electron`).

## Code signing

Release builds are unsigned (macOS: ad-hoc signed). To sign, add repository
secrets; the workflow uses them only when present:

- macOS: `CSC_LINK` and `CSC_KEY_PASSWORD` (Developer ID Application
  certificate, `.p12` as base64), `APPLE_SIGNING_IDENTITY`
  (`Developer ID Application: Name (TEAMID)`), and for notarisation
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. The hardened
  runtime entitlements are in `electron/entitlements.mac.plist`.
- Windows: `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` (Authenticode `.pfx`).

## Structure

- `electron/` - the Electron app: `main.js` (server lifecycle, window),
  `preload.js`, `loading.html`, `error.html`, `icons/`, `package.json`
  (electron-builder configuration), `package-lock.json`
- `server/` - PyInstaller entry point and spec
- `freeze.py` - what the frozen server contains
- `scripts/build_server.py`, `scripts/smoke_server.py`, `scripts/smoke_app.py`
- `scripts/download_uv.sh` - used by the source installer (`annzarro-cli install`), not by the app
- `builder.py` - `annzarro desktop` commands
- `icon_generator.py` - `annzarro desktop icons`
