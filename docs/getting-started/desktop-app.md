# Desktop app

The desktop app is AnnZarro packaged with Electron: one window, its own server inside, no
separate Python installation and no login. It is the "Desktop app" arrangement of
{doc}`../deployment/modes`: one user, data on the same computer, nothing leaves it.

## Download

Standalone apps for macOS, Windows and Linux will be published with the preprint release on the
[GitHub releases page](https://github.com/settylab/annzarro/releases) of `settylab/annzarro`.
Download the file for your operating system from the newest release there.

```{important}
Releases on that page that predate the preprint release do not have the features described in
this documentation (login, panel-set ownership, share links, remote datasets, the binary
transfer format). Until the new release is out, use the Python package
({doc}`installation`).
```

If your system refuses to open an app downloaded from the internet, allow it once through the
system's own prompt (on macOS: Control-click the app, then **Open**). On Linux, make an AppImage
executable first with `chmod +x`.

## First start

On first launch the app prepares a Python environment in its application-data folder and then
starts its server; the window shows a loading screen until the server answers. Later starts
reuse that environment.

The app then behaves like `annzarro start` on your own computer:

- The server listens on `127.0.0.1` only, starting at port 39487 and taking the next free port
  if that one is busy. Login is off.
- The data directory is `~/annzarro-data` (in your home folder). The app creates it with two
  subfolders, `datasets` and `sessions`. The Dataset picker lists stores (or links to them) both
  directly in `~/annzarro-data` and in `~/annzarro-data/datasets`. Saved panel sets go to
  `~/annzarro-data/sessions`. This is also the default data directory of `annzarro start`, so the
  app and a command-line server on the same computer see the same datasets and panel sets.
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
