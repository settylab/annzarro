# Desktop app

The desktop app is AnnZarro packaged with Electron: one window, its own server inside, no
separate Python installation and no login. It is the "Desktop app" arrangement of
{doc}`../deployment/modes`: one user, data on the same computer, nothing leaves it.

## Download

Builds are attached to the
[GitHub releases](https://github.com/settylab/annzarro/releases) of `settylab/annzarro`. Choose
the file for your system:

| System | File |
|---|---|
| macOS (Apple silicon) | `AnnZarro-<version>-arm64.dmg` (or the `-mac.zip`) |
| Linux | `AnnZarro-<version>.AppImage`, or `annzarro-desktop_<version>_amd64.deb` |
| Windows | `AnnZarro Setup <version>.exe` (NSIS installer), when the release has one |

```{important}
Check the release date against the version of this documentation. At the time of writing the
newest release on GitHub (v0.1.1, April 2025) predates most features described here (login,
panel-set ownership, share links, remote datasets, the binary transfer format) and has no
Windows or Intel-Mac build. Until a newer release is published, use the Python package
({doc}`installation`) for current features.
```

The macOS build is not signed with an Apple Developer ID, so Gatekeeper refuses the first
launch. Open it once with right-click (or Control-click) on the app, then **Open**. On Linux,
make the AppImage executable first: `chmod +x AnnZarro-*.AppImage`.

## First start

On first launch the app prepares a Python environment in its application-data folder and then
starts its server; the window shows a loading screen until the server answers. Later starts
reuse that environment.

The app then behaves like `annzarro start` on your own computer:

- The server listens on `127.0.0.1` only, starting at port 39487 and taking the next free port
  if that one is busy. Login is off.
- The data directory is `~/annzarro-data` (in your home folder). The app creates it with two
  subfolders, `datasets` and `sessions`. Because `datasets` exists, **the Dataset picker lists
  only what is in `~/annzarro-data/datasets`**: put stores (or links to them) there. Saved panel
  sets go to `~/annzarro-data/sessions`.
- A folder button next to the Dataset picker opens your system's folder dialog; choosing a
  `.zarr` folder anywhere on disk opens it directly.

Everything else (panels, focus, panel sets, share links, export) works as described in the
{doc}`../user-guide/index`. Share links from the desktop app contain a `127.0.0.1` address and a
path on your disk, so they only reopen on the same computer.

## Where the app keeps its files

| What | Where |
|---|---|
| Datasets and panel sets | `~/annzarro-data/datasets`, `~/annzarro-data/sessions` |
| App configuration (`config/electron_config.yaml`), server log (`logs/annzarro_server.log`), Python environment (`venv/`) | the app's application-data folder (Electron's `userData` directory, under `~/Library/Application Support/` on macOS, `~/.config/` on Linux and `%APPDATA%` on Windows) |

`electron_config.yaml` is written once, on first start, and read on every later start. Edit it
to change server settings such as `cache_memory_mb`; delete it to get the defaults back.

## Building the app yourself

The `annzarro desktop` commands build and run the app from a **source checkout**; they are not
usable from a pip installation, which does not contain the Electron sources. You need Node.js and
npm.

```bash
git clone https://github.com/settylab/annzarro.git && cd annzarro
pip install -e .
annzarro desktop run                    # development mode
annzarro desktop build                  # installer for this platform
annzarro desktop build --platform linux # or windows, mac, all
```

Builds land in `annzarro/desktop/electron/dist/`. Pushing a `v*` tag runs the GitHub Actions
workflow `.github/workflows/build.yml`, which builds Linux, Windows and macOS packages and
attaches them to a GitHub release. See {doc}`../reference/cli` for every option.
