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

## What it does

- Colours any plot by the focused cell's row of an `obsp` matrix or the focused gene's row of a `varp` matrix.
- Plots any `obs`, `var`, `obsm`, `varm` column or `layers` row/column against any other, spatial coordinates included.
- Links cells and genes: one cell's values across genes, one gene's values across cells, in every layer.
- Filters cell and gene tables with AND/OR conditions that mask the plots; saves layouts as panel sets and share links.
- Reads only the chunks behind what is on screen, so cost follows the view, not the dataset size; locally or from S3, GCS and HTTP.
- Never writes to your data and never runs code: a lab server can show datasets without giving write or compute access.

![Cell x cell, gene x gene, cells x genes and table filters](https://raw.githubusercontent.com/settylab/annzarro/main/docs/_static/readme/features.png)

## Install

```bash
pip install annzarro              # or 'annzarro[remote]' for s3://, gs:// and https:// stores
```

Desktop apps for Windows, macOS and Linux (no Python needed, works offline) are on the
[releases page](https://github.com/settylab/annzarro/releases). From source:
`git clone https://github.com/settylab/annzarro.git && pip install -e ./annzarro`.
Details: [installation](https://annzarro.readthedocs.io/en/latest/getting-started/installation.html),
[desktop app](https://annzarro.readthedocs.io/en/latest/getting-started/desktop-app.html).

## Desktop app or server

| | Desktop app | Server mode |
|---|---|---|
| For | one person, data on their computer | a lab or institute sharing datasets in the browser |
| Strengths | no Python needed, works offline, private to your computer, opens local `.zarr` stores | multi-user access with login, panel sets shared between users, large datasets read on the server (the browser receives only the slices a view needs), per-user dataset access control and an admin page, less memory on each user's computer |
| Set up | [Desktop app](https://annzarro.readthedocs.io/en/latest/getting-started/desktop-app.html) | [Lab server](https://annzarro.readthedocs.io/en/latest/deployment/lab-server.html) |

Use the desktop app if you are the only user and the data are on your computer; use a server
if several people share datasets or some collaborators may see only some of them.
[Full comparison](https://annzarro.readthedocs.io/en/latest/getting-started/desktop-or-server.html).

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
- **Lab server**: gunicorn behind HTTPS, read-only, with login and shared panel sets. [Set up](https://annzarro.readthedocs.io/en/latest/deployment/lab-server.html)

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
is archived on Zenodo with its own version DOI (v0.4.3:
[10.5281/zenodo.23306026](https://doi.org/10.5281/zenodo.23306026)); the concept DOI below always
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
