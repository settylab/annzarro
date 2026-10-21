# Desktop app

The desktop app is AnnZarro packaged with Electron: one window, its own server inside, no
separate Python installation and no login. It is the "Desktop app" arrangement of
{doc}`../deployment/modes`: one user, data on the same computer, nothing leaves it.

## Download

Standalone apps for macOS, Windows and Linux are published with each release on the
[GitHub releases page](https://github.com/settylab/annzarro/releases) of `settylab/annzarro`.
`<version>` below is the release, for example `0.6.0`.

| System | File | What it is |
|---|---|---|
| macOS, Apple silicon (M1 and later) | `AnnZarro-<version>-macos-arm64.dmg` | disk image: drag AnnZarro to Applications |
| | `AnnZarro-<version>-macos-arm64.zip` | the same app, zipped |
| macOS, Intel | `AnnZarro-<version>-macos-x64.dmg` / `.zip` | as above |
| Windows 10/11, 64-bit | `AnnZarro-<version>-windows-x64-setup.exe` | installer, per user, no admin rights needed |
| | `AnnZarro-<version>-windows-x64.zip` | portable: unzip and run `AnnZarro.exe` |
| Linux x86-64 | `AnnZarro-<version>-linux-x86_64.AppImage` | single file: `chmod +x` it and run |
| Debian/Ubuntu | `AnnZarro-<version>-linux-amd64.deb` | `sudo apt install ./AnnZarro-<version>-linux-amd64.deb` |
| | `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, `*.blockmap` | update information the app reads ({ref}`desktop-updates`); you do not need them |
| | `SHA256SUMS.txt` | checksums: `shasum -a 256 -c SHA256SUMS.txt --ignore-missing` |

```{important}
Use the latest release on that page. Older releases may lack features described in this
documentation (login, panel-set ownership, share links, the binary transfer format) and some
ship only some of the files above. The Python package ({doc}`installation`) is the alternative.
```

The app contains its own AnnZarro server, frozen with PyInstaller together with Python, numpy,
zarr, h5py, Flask, waitress and the web interface (57 to 98 MB installed, depending on the platform). The
downloads are 122 to 132 MB: the .dmg 125 MB (Apple silicon) or 132 MB (Intel), the Windows
installer 127 MB, the AppImage and .deb 123 MB. You do not need Python on the computer.

On macOS and Windows the window has no title bar of its own: the AnnZarro header is the title bar. Drag its empty part to
move the window, double-click it to zoom, and use the window buttons at the top left (macOS) or top right (Windows).
Linux keeps the normal window frame.

The app works fully offline. Python, the server and every script, style and font of the
interface are in the download; nothing is fetched at install, at first launch or later, and no
page loads anything from the internet. Remote stores (S3, GCS, HTTP) are not supported in the
app; use the Python package with the `remote` extra for those ({doc}`installation`).

## First launch

- **macOS**: open the `.dmg`, drag **AnnZarro** to **Applications**, and open it. The `.zip` holds
  the same app. (Version 0.4.x and earlier: see Older versions below.)
- **macOS with Homebrew**: `brew install --cask settylab/annzarro/annzarro` installs the app for your
  chip; the app then updates itself (`brew upgrade --cask --greedy annzarro` also does) and `brew uninstall --cask --zap annzarro` removes it with
  its settings and logs (not `~/annzarro-data`).
- **Windows**: the build is not code-signed. SmartScreen says "Windows protected your PC". Click
  **More info**, then **Run anyway**.
- **Linux**: no extra step beyond `chmod +x` for the AppImage. On Ubuntu 24.04 and later an
  AppImage that fails to start may need `--no-sandbox`.

The very first start can take longer than later ones, up to about a minute, while the system's
malware scanner (Windows Defender, or Gatekeeper on macOS apps of 0.4.x and earlier) checks the bundled
server; the loading screen counts the seconds and says so. Later starts take a few seconds. The wait is bounded: if the server has not answered after 180 s, or
the interface has not loaded 60 s after that, the window shows an error page with the reason,
the path of the log file and a **Retry** button. Starting the app again while it runs brings
the open window to the front instead of starting a second server. Quitting the app stops the
server.

The app then behaves like `annzarro start` on your own computer:

- The server listens on `127.0.0.1` only, starting at port 39487 and taking the next free port
  if that one is busy, also when another program takes it while the server starts. Login is off.
- The data folder is `~/annzarro-data` (in your home folder), created if it is missing. Put or link
  datasets directly into it; the app only reads there and creates nothing inside it. A
  `datasets` folder from an earlier version stays as it is and is listed as before. Saved panel
  sets and everything else the app writes go to its own state folder ({ref}`desktop-files`), not
  into your data. The data folder is also the default of `annzarro start`, so the app and a
  command-line server on the same computer see the same datasets.
- **Open file or folder...** in the dataset browser and on the Welcome screen opens your system's
  dialog; choosing a `.zarr` folder or an `.h5ad` file anywhere on disk opens it directly.
- Remote stores (`s3://`, `gs://`, `http(s)://`) are not supported in the desktop app; use
  `pip install 'annzarro[remote]'` and `annzarro start` for those
  ({doc}`../user-guide/remote-datasets`).

Everything else (panels, focus, panel sets, share links, export) works as described in the
{doc}`../user-guide/index`. Share links from the desktop app contain a `127.0.0.1` address and a
path on your disk, so they only reopen on the same computer.

### Older versions

macOS apps up to 0.4.x are not notarized, so macOS blocks the first launch. On macOS 15 and later,
click **Done** on the "Not Opened" message, open **System Settings > Privacy & Security**, scroll
to **Security**, click **Open Anyway** next to AnnZarro and confirm (once; right-click > Open no
longer works there). On macOS 14 and earlier, right-click (Control-click) the app and choose
**Open**.

## Open a dataset

The **File** menu opens datasets from anywhere on your computer:

- **Open Dataset...** (`Cmd+O` on macOS, `Ctrl+O` elsewhere) opens the dataset browser.
- **Open File or Folder...** (`Cmd+Shift+O`, macOS) shows one system dialog in which you pick an
  `.h5ad` file or a `.zarr` folder. Windows and Linux cannot show such a dialog, so there are two
  items: **Open .h5ad File...** (`Ctrl+Shift+O`) and **Open .zarr Folder...**.
- **Open Recent** lists the last ten datasets you opened from this computer; **Clear Menu** empties
  it. A dataset that has been moved or deleted is dropped from the list when you choose it.
- **Refresh Dataset** reads the open dataset again, as the refresh button beside the dataset box does.

You can also:

- **Drag** a `.zarr` folder or an `.h5ad` file onto the window. A target covers the window while you
  drag; drop to open. If you drop several items, the first is opened and a message says the rest were not.
  Anything else is refused with "AnnZarro opens .zarr folders and .h5ad files".
- **Double-click** an `.h5ad` file, or choose **Open With > AnnZarro** (for an `.h5ad` file or a
  `.zarr` folder), or drop it on the app's icon in the Dock or taskbar. On macOS a `.zarr` folder stays
  a plain folder in Finder, so you can still look inside it. Linux associates `.h5ad` files only,
  because a file manager has no type for a folder.
- Start the app from a terminal with a path: `AnnZarro /data/sample.zarr`. If AnnZarro is already
  running, that window opens the dataset.

On macOS, the window's title bar shows the open dataset's file as a proxy icon (drag it into
another app, or Cmd-click the title for its folders). Datasets opened from the File menu, by drop or
through the system also appear in the Dock icon's recent items and the Windows jump list.

(desktop-updates)=
## Updates

The app looks for a newer release on launch and then at most once a day while it runs. It
never downloads anything without asking: a window says "AnnZarro X.Y.Z is available" with
**Download**, **Later**, **Skip this version** and **Release notes** (the GitHub release page).
After **Download** the app fetches the update, checks it against the checksum published with
the release, and asks **Restart to update**; it then saves your open panels, closes, installs
and starts again. If you choose **Later**, the next launch offers the update again.

| Installation | What happens |
|---|---|
| macOS (dmg or zip) | updates itself |
| Windows installer (`-setup.exe`) | updates itself, per user, no admin rights |
| Linux AppImage | replaces the AppImage file in place |
| Linux `.deb` (or any non-AppImage Linux install), Windows portable zip | cannot update itself: the window says a new version is available and opens the release page, where you download the new file |

- **Check now:** **AnnZarro > Check for Updates...** on macOS, **Help > Check for Updates...**
  on Windows and Linux. This also shows an update you skipped.
- **Turn automatic checks off:** untick **Check for Updates Automatically** in the same menu.
  The choice, the version you skipped and the time of the last check are kept in
  `update-settings.json` in the app's settings folder: macOS
  `~/Library/Application Support/AnnZarro`, Windows `%APPDATA%\AnnZarro`, Linux `~/.config/AnnZarro`.
- **Turn updates off completely** (managed installs): start the app with the environment variable
  `ANNZARRO_DISABLE_UPDATES=1`. The app then never contacts GitHub; the menu item says so.
- **Privacy:** a check requests the release list and update information from `github.com`, and a
  download comes from `github.com`, which redirects to `objects.githubusercontent.com`. Nothing
  else is contacted, and the request carries no dataset, user or usage information beyond what
  any HTTPS request to GitHub reveals (your IP address and the app's user agent). The datasets and
  the server stay local either way.

```{note}
Updating starts with 0.5.3. If you run 0.5.2 or older, download
the newest release by hand once (the files above); from then on the app updates itself. macOS
updates need the notarized builds, so a build you made yourself ({ref}`building <building-the-app>`)
does not update.
```

(desktop-files)=
## Where the app keeps its files

| What | Where |
|---|---|
| Datasets (read only) | `~/annzarro-data` (copy or symlink stores here) |
| App log, including the server's output (`server:` lines) | macOS `~/Library/Logs/AnnZarro/main.log`, Windows `%APPDATA%\AnnZarro\logs\main.log`, Linux `~/.config/AnnZarro/logs/main.log` |
| State: saved panel sets (`panel-sets/`), server log, PID file, caches | the `state` folder of the app's profile: macOS `~/Library/Application Support/AnnZarro/state`, Windows `%APPDATA%\AnnZarro\state`, Linux `~/.config/AnnZarro/state` |
| Optional settings | `~/.config/annzarro/config.yaml`, read as by `annzarro start` ({doc}`../reference/configuration`); host, port, data directory and login are fixed by the app |

**Panel sets from an earlier version.** Versions before 0.7.2 saved panel sets in
`~/annzarro-data/sessions`. If that folder holds panel sets, the app keeps using it, and once per
launch asks whether to copy them to the state folder: **Copy now** copies them and reports the
result, **Not now** asks again at the next launch, **Don't ask again** stops the question (the
choice is kept in the app's settings). The copy never deletes anything; once you have checked
the new location you can delete `~/annzarro-data/sessions` yourself. The same copy runs
from a terminal as `annzarro panel-sets migrate` ({ref}`panel-sets-location`).

If the server does not start, the app shows an error page that names the log file and offers
**Retry**.

(building-the-app)=
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
to `annzarro/__init__.py`, `annzarro/desktop/electron/package.json` and its `package-lock.json`.
CI refuses a build whose `package.json` differs, and `annzarro/tests/utils/test_bump_version.py`
checks that all of them agree.

1. `python bump_version.py 0.6.0`, commit, merge.
2. Tag and push: `git tag v0.6.0 && git push origin v0.6.0`.
3. The workflow `.github/workflows/build.yml` builds and smoke-tests macOS (arm64, x64), Windows
   and Linux, then creates a **draft** release with all files and `SHA256SUMS.txt`. Review it
   and publish.

To build without releasing, run the workflow by hand (Actions > Desktop apps > Run workflow, or
`gh workflow run build.yml --ref <branch>`); the files are then kept as workflow artifacts.
