# Licence

AnnZarro is released under the MIT licence:

```text
MIT License

Copyright (c) 2025-2026 Dominik J. Otto, Siddharth Baasri, Manu Setty
```

The full text is in [`LICENSE`](https://github.com/settylab/annzarro/blob/main/LICENSE) and is
installed with the package (`annzarro-<version>.dist-info/licenses/LICENSE`).

## Third-party components

The web interface ships the following libraries, unmodified, under `annzarro/static/vendor/`.
Each file keeps its original copyright header. The versions are pinned with SHA-256 checksums in
`scripts/vendor-assets.json`; every wheel and sdist contains exactly those files.

| Component | Version | Licence (SPDX) |
|---|---|---|
| [Bootstrap](https://getbootstrap.com/) (includes Popper) | 5.2.3 | `MIT` |
| [jQuery](https://jquery.com/) | 3.6.4 | `MIT` |
| [DataTables](https://datatables.net/) | 1.13.4 | `MIT` |
| DataTables Buttons (includes FileSaver.js) | 2.3.6 | `MIT` |
| DataTables SearchBuilder | 1.4.2 | `MIT` |
| DataTables Select | 1.6.2 | `MIT` |
| DataTables FixedHeader | 3.3.2 | `MIT` |
| [Plotly.js](https://plotly.com/javascript/) (bundles npm modules, see below) | 2.20.0 | `MIT AND ISC AND BSD-3-Clause AND BSD-2-Clause AND Zlib AND Unlicense` |
| [Select2](https://select2.org/) | 4.1.0-rc.0 | `MIT` |
| [chroma.js](https://gka.github.io/chroma.js/) | 2.4.2 | `BSD-3-Clause AND Apache-2.0` |
| [Font Awesome Free](https://fontawesome.com/) | 6.4.0 | `MIT AND OFL-1.1` |

The full licence texts, source URLs and checksums of every file are in
[`annzarro/THIRD_PARTY_LICENSES/`](https://github.com/settylab/annzarro/tree/main/annzarro/THIRD_PARTY_LICENSES),
which the package installs both inside `annzarro/THIRD_PARTY_LICENSES/` and in its
`dist-info/licenses/` directory. The minified Plotly.js file is a bundle of npm modules under
MIT, ISC, BSD-3-Clause (mapbox-gl, d3), BSD-2-Clause, Zlib and Unlicense licences;
`plotly-bundled.txt` there holds the licence text of every package in Plotly.js 2.20.0's
dependency tree. The Python dependencies (Flask, zarr, NumPy, pandas and others) are installed
separately by pip under their own licences.

## Desktop apps

The desktop apps also contain CPython (PSF licence), the Python packages the server uses, native
libraries from the build machine (OpenSSL, zlib, libffi and others; on Linux the GCC runtime
libraries, under the GCC Runtime Library Exception) and Electron with Chromium. Their licence
texts ship in the app:

- `server/THIRD_PARTY_NOTICES/` in the app's resources: an index (`README.txt`), CPython's
  licence and acknowledgements, the licence files of every bundled Python package and the
  licences of the native libraries;
- `LICENSE.electron.txt` and `LICENSES.chromium.html` in the app's resources (macOS) or install
  folder (Windows, Linux); on macOS also `LICENSES.macos-frameworks.txt` (Electron's updater
  frameworks Squirrel.Mac, Mantle and ReactiveObjC, MIT);
- `LICENSE`: AnnZarro's own licence.

Every release is checked before it is published: a CI step unpacks each release file (.deb,
AppImage, Windows zip and installer, macOS zip and dmg) and accounts for every executable and
shared library in it, with its licence (`annzarro/desktop/scripts/licence_check.py`). It fails
on any GPL or AGPL component, on an unknown licence, and on LGPL code that is not a separate,
replaceable shared library. What remains under a copyleft licence:

- GPL with an exception for use in other programs: the GCC runtime libraries on Linux
  (libstdc++, libgcc_s, libgfortran; GCC Runtime Library Exception) and PyInstaller's launcher
  (bootloader exception);
- LGPL-2.1 as separate shared libraries, with their notices: FFmpeg (`libffmpeg.so`,
  `ffmpeg.dll`, `libffmpeg.dylib`, Chromium's build without GPL parts) and, on Linux,
  libquadmath from NumPy's wheel;
- Chromium itself contains LGPL code from WebKit/Blink, linked into the Electron executable,
  as in every Electron application; its sources are published by the Chromium and Electron
  projects and listed in `LICENSES.chromium.html`. Decision (2026-10-07): this is accepted as
  standard Electron practice, with `LICENSES.chromium.html` shipped. The check allows
  statically linked LGPL in exactly the Electron executable (on macOS, the Electron Framework
  it consists of) and fails on it anywhere else.

The v0.4.0 Linux packages also contained GNU Readline (GPL-3.0) and, in the AppImage,
libindicator (GPL-3.0) and three LGPL desktop-integration libraries; from v0.4.1 on they are
gone: Python's `readline` module is left out of the server, and the AppImage is repacked
without the libraries electron-builder adds (AnnZarro uses no tray icon and no notifications).
The AppImage keeps the X11 libraries libXss and libXtst (MIT), with their notices in
`LICENSES.appimage-libraries.txt`.

## Citing AnnZarro

The citation metadata are in
[`CITATION.cff`](https://github.com/settylab/annzarro/blob/main/CITATION.cff) at the top of the
repository; GitHub's "Cite this repository" button reads it. To cite the software, cite the
release you used:

Otto, D. J., Baasri, S. and Setty, M. AnnZarro (software), version X.Y.Z.
<https://github.com/settylab/annzarro>

The paper describing AnnZarro is in preparation: Otto, D. J., Baasri, S. and Setty, M. AnnZarro:
scalable, interactive exploration of cell-by-cell and gene-by-gene relationships in single-cell
data. Once it has a DOI, it will be added to `CITATION.cff` as the preferred citation.
