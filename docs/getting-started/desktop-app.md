# Desktop app

The desktop app is AnnZarro packaged with Electron: one window, its own server inside, no
separate Python installation and no login. It is the "Desktop app" arrangement of
{doc}`../deployment/modes`: one user, data on the same computer, nothing leaves it.

## Download

Standalone apps for macOS, Windows and Linux are published with each release on the
[GitHub releases page](https://github.com/settylab/annzarro/releases) of `settylab/annzarro`.
`<version>` below is the release, for example `0.2.0`.

| System | File | What it is |
|---|---|---|
| macOS, Apple silicon (M1 and later) | `AnnZarro-<version>-macos-arm64.dmg` | disk image: drag AnnZarro to Applications |
| | `AnnZarro-<version>-macos-arm64.zip` | the same app, zipped |
| macOS, Intel | `AnnZarro-<version>-macos-x64.dmg` / `.zip` | as above |
| Windows 10/11, 64-bit | `AnnZarro-<version>-windows-x64-setup.exe` | installer, per user, no admin rights needed |
| | `AnnZarro-<version>-windows-x64.zip` | portable: unzip and run `AnnZarro.exe` |
| Linux x86-64 | `AnnZarro-<version>-linux-x86_64.AppImage` | single file: `chmod +x` it and run |
| Debian/Ubuntu | `AnnZarro-<version>-linux-amd64.deb` | `sudo apt install ./AnnZarro-<version>-linux-amd64.deb` |
| | `SHA256SUMS.txt` | checksums: `shasum -a 256 -c SHA256SUMS.txt --ignore-missing` |

```{important}
Releases on that page that predate the preprint release do not have the features described in
this documentation (login, panel-set ownership, share links, remote datasets, the binary
transfer format) and ship only some of the files above. Until the new release is out, use the
Python package ({doc}`installation`).
```

The app contains its own AnnZarro server, frozen with PyInstaller together with Python, numpy,
zarr, h5py, Flask and the web interface (57 to 98 MB installed, depending on the platform). The
downloads are 122 to 132 MB: the .dmg 125 MB (Apple silicon) or 132 MB (Intel), the Windows
installer 127 MB, the AppImage and .deb 123 MB. You do not need Python on the computer.

The app works fully offline. Python, the server and every script, style and font of the
interface are in the download; nothing is fetched at install, at first launch or later, and no
page loads anything from the internet. Remote stores (S3, GCS, HTTP) are not supported in the
app; use the Python package with the `remote` extra for those ({doc}`installation`).

## First launch

The builds are not code-signed yet, so the first launch needs one extra step:

- **macOS**: the system says Apple cannot check AnnZarro for malicious software. Open
  **System Settings > Privacy & Security**, scroll to the message about AnnZarro and click
  **Open Anyway** (once). Or, in a terminal:
  `xattr -dr com.apple.quarantine /Applications/AnnZarro.app`.
- **Windows**: SmartScreen says "Windows protected your PC". Click **More info**, then
  **Run anyway**.
- **Linux**: no extra step beyond `chmod +x` for the AppImage. On Ubuntu 24.04 and later an
  AppImage that fails to start may need `--no-sandbox`.

The very first start can take up to a minute while the system's malware scanner (Gatekeeper,
Defender) checks the bundled server; the window shows a loading screen until the server answers.
Later starts take a few seconds. Quitting the app stops the server.

The app then behaves like `annzarro start` on your own computer:

- The server listens on `127.0.0.1` only, starting at port 39487 and taking the next free port
  if that one is busy. Login is off.
- The data directory is `~/annzarro-data` (in your home folder). Put or link datasets into
  `~/annzarro-data/datasets`; the Dataset picker lists stores both there and directly in
  `~/annzarro-data`. Saved panel sets go to `~/annzarro-data/sessions`. This is also the default
  data directory of `annzarro start`, so the app and a command-line server on the same computer
  see the same datasets and panel sets.
- A folder button next to the Dataset picker opens your system's folder dialog; choosing a
  `.zarr` folder anywhere on disk opens it directly.
- Remote stores (`s3://`, `gs://`, `http(s)://`) are not supported in the desktop app; use
  `pip install 'annzarro[remote]'` and `annzarro start` for those
  ({doc}`../user-guide/remote-datasets`).

Everything else (panels, focus, panel sets, share links, export) works as described in the
{doc}`../user-guide/index`. Share links from the desktop app contain a `127.0.0.1` address and a
path on your disk, so they only reopen on the same computer.

## Where the app keeps its files

| What | Where |
|---|---|
| Datasets | `~/annzarro-data/datasets` (copy or symlink stores here) |
| Saved panel sets | `~/annzarro-data/sessions` |
| App log, including the server's output (`server:` lines) | macOS `~/Library/Logs/AnnZarro/main.log`, Windows `%APPDATA%\AnnZarro\logs\main.log`, Linux `~/.config/AnnZarro/logs/main.log` |
| Server state (PID file, server log) | `~/.annzarro`, as for `annzarro start` |
| Optional settings | `~/.config/annzarro/config.yaml`, read as by `annzarro start` ({doc}`../reference/configuration`); host, port, data directory and login are fixed by the app |

If the server does not start, the app shows an error page that names the log file.

## Building the app yourself

The `annzarro desktop` commands build and run the app from a **source checkout**; a pip
installation does not contain the Electron sources. You need Python (releases are built with
3.11; 3.9 and later work), Node.js LTS and npm. Each platform must be built on that platform,
because the frozen server contains native libraries of the system it was built on.

```bash
git clone https://github.com/settylab/annzarro.git && cd annzarro
pip install -e .
annzarro desktop run                    # start the app from the checkout
annzarro desktop build                  # freeze the server, then package for this platform
annzarro desktop build --platform linux # or windows, mac
```

`annzarro desktop run` uses the frozen server in `annzarro/desktop/electron/server/` if one
exists, and otherwise runs `python3 -m annzarro.cli start` (set `ANNZARRO_PYTHON` to choose the
interpreter). `annzarro desktop build --no-build-server` reuses an existing frozen server.
Packages land in `annzarro/desktop/electron/dist/`. The individual steps, a smoke test of a
built app and code-signing secrets are described in `annzarro/desktop/README.md`; every option
is in {doc}`../reference/cli`.

## Making a release

The app version is the Python package version in `pyproject.toml`. `bump_version.py` writes it
to `annzarro/__init__.py` and `annzarro/desktop/electron/package.json`, and CI refuses a build
where they differ.

1. `python bump_version.py 0.2.0`, commit, merge.
2. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. The workflow `.github/workflows/build.yml` builds and smoke-tests macOS (arm64, x64), Windows
   and Linux, then creates a **draft** release with all files and `SHA256SUMS.txt`. Review it
   and publish.

To build without releasing, run the workflow by hand (Actions > Desktop apps > Run workflow, or
`gh workflow run build.yml --ref <branch>`); the files are then kept as workflow artifacts.
