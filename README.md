<!-- Images use absolute URLs on the main branch so that PyPI renders them too; they resolve
     once this branch is merged to main. -->
# <img src="https://raw.githubusercontent.com/settylab/annzarro/main/annzarro/desktop/electron/icons/icon.png" width="40" height="40" align="center" alt=""> AnnZarro

<!-- PyPI version and Tests resolve after the first PyPI release and PR #50 (tests.yml). -->
[![PyPI](https://img.shields.io/pypi/v/annzarro)](https://pypi.org/project/annzarro/)
[![Python 3.9+](https://img.shields.io/badge/python-3.9%2B-blue)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/settylab/annzarro/blob/main/LICENSE)
[![Docs](https://readthedocs.org/projects/annzarro/badge/?version=latest)](https://annzarro.readthedocs.io)
[![Tests](https://github.com/settylab/annzarro/actions/workflows/tests.yml/badge.svg)](https://github.com/settylab/annzarro/actions/workflows/tests.yml)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23222216.svg)](https://doi.org/10.5281/zenodo.23222216)
[![bioRxiv](https://img.shields.io/badge/bioRxiv-10.64898%2F2026.10.10.758158-b31b1b)](https://doi.org/10.64898/2026.10.10.758158)

A read-only browser viewer for AnnData in zarr (or h5ad) built around the matrices other viewers
leave out: cell x cell kernels and distances (`obsp`) and gene x gene similarities (`varp`),
explored one focused cell or gene at a time and linked to the cell x gene layers.

**Documentation: [annzarro.readthedocs.io](https://annzarro.readthedocs.io)** (tutorials, user guide,
data preparation, deployment and reference). Developed by the [Setty Lab](https://settylab.org).

![Clicking a cell moves the diffusion-walk colouring; clicking a gene recolours its correlations and per-cell fold change](https://raw.githubusercontent.com/settylab/annzarro/main/docs/_static/readme/focus.gif)

## Install

```bash
pip install annzarro              # or 'annzarro[remote]' for s3://, gs:// and https:// stores
```

This installs AnnZarro on your own computer or on a server. Or download the desktop app, or set up a shared server, below.

From source:
`git clone https://github.com/settylab/annzarro.git && pip install -e ./annzarro`.
Details: [installation](https://annzarro.readthedocs.io/en/latest/getting-started/installation.html),
[desktop app](https://annzarro.readthedocs.io/en/latest/getting-started/desktop-app.html).

## Desktop app or server

**Desktop app** (download the latest release):

[![macOS](https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/settylab/annzarro/releases/latest/download/AnnZarro-macos-arm64.dmg) [![Windows](https://img.shields.io/badge/Windows-0078D4?style=for-the-badge&logo=data:image/svg%2Bxml;base64,PHN2ZyBmaWxsPSJ3aGl0ZSIgcm9sZT0iaW1nIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI%2BPHRpdGxlPldpbmRvd3M8L3RpdGxlPjxwYXRoIGQ9Ik0wLDBIMTEuMzc3VjExLjM3MkgwWk0xMi42MjMsMEgyNFYxMS4zNzJIMTIuNjIzWk0wLDEyLjYyM0gxMS4zNzdWMjRIMFptMTIuNjIzLDBIMjRWMjRIMTIuNjIzIi8%2BPC9zdmc%2B)](https://github.com/settylab/annzarro/releases/latest/download/AnnZarro-windows-x64-setup.exe) [![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/settylab/annzarro/releases/latest/download/AnnZarro-linux-x86_64.AppImage)

macOS: [Apple silicon](https://github.com/settylab/annzarro/releases/latest/download/AnnZarro-macos-arm64.dmg), [Intel](https://github.com/settylab/annzarro/releases/latest/download/AnnZarro-macos-x64.dmg), or `brew install --cask settylab/annzarro/annzarro`. Linux: [AppImage](https://github.com/settylab/annzarro/releases/latest/download/AnnZarro-linux-x86_64.AppImage), [.deb](https://github.com/settylab/annzarro/releases/latest/download/AnnZarro-linux-amd64.deb). [All files and checksums](https://github.com/settylab/annzarro/releases/latest).

- Standalone on your laptop, no Python needed
- Works offline
- Your data stay on your computer
- No login, no set-up
- Opens local `.zarr` stores

**Server** (one server, many users in the browser; [install](https://annzarro.readthedocs.io/en/latest/deployment/lab-server.html)):

[![Server](https://img.shields.io/badge/Server-1f6feb?style=for-the-badge&logo=data:image/svg%2Bxml;base64,PHN2ZyBmaWxsPSJ3aGl0ZSIgcm9sZT0iaW1nIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI%2BPHRpdGxlPlNlcnZlcjwvdGl0bGU%2BPHBhdGggZD0iTTMgM2gxOGExIDEgMCAwIDEgMSAxdjZhMSAxIDAgMCAxLTEgMUgzYTEgMSAwIDAgMS0xLTFWNGExIDEgMCAwIDEgMS0xWm0xIDJ2NGgxNlY1SDRabS0xIDhoMThhMSAxIDAgMCAxIDEgMXY2YTEgMSAwIDAgMS0xIDFIM2ExIDEgMCAwIDEtMS0xdi02YTEgMSAwIDAgMSAxLTFabTEgMnY0aDE2di00SDRaTTYuNSA2LjJhLjguOCAwIDEgMSAwIDEuNi44LjggMCAwIDEgMC0xLjZabTAgMTBhLjguOCAwIDEgMSAwIDEuNi44LjggMCAwIDEgMC0xLjZaIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiLz48L3N2Zz4%3D)](https://annzarro.readthedocs.io/en/latest/deployment/lab-server.html)

- Multi-user access in the browser, with login
- Panel sets shared and exchanged between users
- Large datasets stay on the server; only the slices a view needs travel to the browser
- Per-user dataset access control and an admin page
- Less memory on each user's computer

## What it does

- Colours any plot by the focused cell's row of an `obsp` matrix or the focused gene's row of a `varp` matrix.
- Plots any `obs`, `var`, `obsm`, `varm` column or `layers` row/column against any other, spatial coordinates included.
- Links cells and genes: one cell's values across genes, one gene's values across cells, in every layer.
- Filters cell and gene tables with AND/OR conditions that mask the plots; saves layouts as panel sets and share links.
- Reads only the chunks behind what is on screen, so cost follows the view, not the dataset size; locally or from S3, GCS and HTTP.
- Never writes to your data and never runs code: a lab server can show datasets without giving write or compute access.

![Cell x cell, gene x gene, cells x genes and table filters](https://raw.githubusercontent.com/settylab/annzarro/main/docs/_static/readme/features.png)

## Quickstart

```bash
mkdir -p ~/annzarro-data
ln -s /path/to/your.zarr ~/annzarro-data/
annzarro start --data-dir ~/annzarro-data      # opens http://127.0.0.1:8000
```

Walkthrough with the demonstration data: [quickstart](https://annzarro.readthedocs.io/en/latest/getting-started/quickstart.html).

## Prepare your data

Any AnnData written with `adata.write_zarr(...)` opens as is. Which slot feeds which view, how to
precompute `obsp`/`varp` matrices and how to chunk for speed: [preparing data](https://annzarro.readthedocs.io/en/latest/data/index.html).

## Deployment

- **Desktop app**: one person, data on the same computer. [Set up](https://annzarro.readthedocs.io/en/latest/getting-started/desktop-app.html)
- **Personal server**: `annzarro start` on a laptop or an HPC node, reached over an SSH tunnel. [Set up](https://annzarro.readthedocs.io/en/latest/deployment/personal-server.html)
- **Lab server**: `annzarro serve` (gunicorn) behind HTTPS, on a host or in a container, read-only, with login and shared panel sets. [Set up](https://annzarro.readthedocs.io/en/latest/deployment/lab-server.html)
- **Public site**: a lab server open to strangers, with an imprint, a privacy notice and dataset attribution. [What it owes its visitors](https://annzarro.readthedocs.io/en/latest/deployment/public-site.html)

## Documentation

[annzarro.readthedocs.io](https://annzarro.readthedocs.io): tutorials on cell and gene
similarity, the user guide, data preparation, deployment, and the CLI, configuration and HTTP API reference.

## Citing AnnZarro

If you use AnnZarro, please cite the preprint:

Otto, D. J., Baasri, S. and Setty, M. AnnZarro: scalable, interactive exploration of cell-by-cell and
gene-by-gene relationships in single-cell data. bioRxiv (2026).
[doi:10.64898/2026.10.10.758158](https://doi.org/10.64898/2026.10.10.758158)

```bibtex
@article{otto2026annzarro,
  author  = {Otto, Dominik J. and Baasri, Siddharth and Setty, Manu},
  title   = {{AnnZarro}: scalable, interactive exploration of cell-by-cell and gene-by-gene relationships in single-cell data},
  journal = {bioRxiv},
  year    = {2026},
  doi     = {10.64898/2026.10.10.758158},
  url     = {https://doi.org/10.64898/2026.10.10.758158}
}
```

To cite the software itself, for example the exact release you ran, use its Zenodo DOI. Each release
is archived on Zenodo with its own version DOI (v0.7.2:
[10.5281/zenodo.23547580](https://doi.org/10.5281/zenodo.23547580)); the concept DOI below always
resolves to the latest release.

```bibtex
@software{otto_annzarro_software,
  author    = {Otto, Dominik J. and Baasri, Siddharth and Setty, Manu},
  title     = {AnnZarro},
  publisher = {Zenodo},
  doi       = {10.5281/zenodo.23222216},
  url       = {https://doi.org/10.5281/zenodo.23222216}
}
```

Citation metadata are also in [`CITATION.cff`](https://github.com/settylab/annzarro/blob/main/CITATION.cff)
(GitHub's "Cite this repository"), which names the preprint as the preferred citation.

## Development

`npm ci` once (Node.js 22+), then `python -m pytest` runs the Python tests, every JS suite and
ESLint. See [running the tests](https://annzarro.readthedocs.io/en/latest/getting-started/installation.html#running-the-tests).

## Licence

MIT ([LICENSE](https://github.com/settylab/annzarro/blob/main/LICENSE)). The web interface bundles unmodified third-party libraries under their
own permissive licences, listed in [`annzarro/THIRD_PARTY_LICENSES/`](https://github.com/settylab/annzarro/tree/main/annzarro/THIRD_PARTY_LICENSES).

**Trademarks.** The Fred Hutch name and logo are trademarks of Fred Hutchinson Cancer Center and are not licensed under the MIT license that covers the rest of AnnZarro; they appear in AnnZarro with permission. Do not reuse them, or change them, without Fred Hutch's permission. The MIT license does not grant any rights to the names, logos, or trademarks of Fred Hutch. Forks and derivative works must remove Fred Hutch's name and logo and must not suggest endorsement by Fred Hutch. See [TRADEMARKS.md](https://github.com/settylab/annzarro/blob/main/TRADEMARKS.md).
