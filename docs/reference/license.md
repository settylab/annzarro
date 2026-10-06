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
| [Plotly.js](https://plotly.com/javascript/) | 2.20.0 | `MIT AND BSD-3-Clause` |
| [Select2](https://select2.org/) | 4.1.0-rc.0 | `MIT` |
| [chroma.js](https://gka.github.io/chroma.js/) | 2.4.2 | `BSD-3-Clause AND Apache-2.0` |
| [Font Awesome Free](https://fontawesome.com/) | 6.4.0 | `MIT AND OFL-1.1` |

The full licence texts, source URLs and checksums of every file are in
[`annzarro/THIRD_PARTY_LICENSES/`](https://github.com/settylab/annzarro/tree/main/annzarro/THIRD_PARTY_LICENSES),
which the package installs both inside `annzarro/THIRD_PARTY_LICENSES/` and in its
`dist-info/licenses/` directory. The Python dependencies (Flask, zarr, NumPy, pandas and others)
are installed separately by pip under their own licences.

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
