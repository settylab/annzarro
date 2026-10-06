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
  folder (Windows, Linux);
- `LICENSE`: AnnZarro's own licence.

The only GPL-licensed code in the apps comes with an exception for distribution in other
programs: the GCC runtime libraries (GCC Runtime Library Exception) and PyInstaller's launcher
(the PyInstaller bootloader exception). libquadmath, on Linux, is LGPL-2.1. The build refuses a
server that would include GNU Readline or ncurses.

## Citing AnnZarro

Otto, D. J., Baasri, S. and Setty, M. AnnZarro: interactive exploration of cell-by-cell and
gene-by-gene relationships in single-cell data. In preparation.
