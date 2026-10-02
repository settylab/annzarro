<!-- Images use absolute URLs on the main branch so that PyPI renders them too; they resolve
     once this branch is merged to main. -->
# <img src="https://raw.githubusercontent.com/settylab/annzarro/main/annzarro/desktop/electron/icons/icon.png" width="40" height="40" align="center" alt=""> AnnZarro

<!-- PyPI version and Tests resolve after the first PyPI release and PR #50 (tests.yml). -->
[![PyPI](https://img.shields.io/pypi/v/annzarro)](https://pypi.org/project/annzarro/)
[![Python 3.9+](https://img.shields.io/badge/python-3.9%2B-blue)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/settylab/annzarro/blob/main/LICENSE)
[![Docs](https://readthedocs.org/projects/annzarro/badge/?version=latest)](https://annzarro.readthedocs.io)
[![Tests](https://github.com/settylab/annzarro/actions/workflows/tests.yml/badge.svg)](https://github.com/settylab/annzarro/actions/workflows/tests.yml)

A read-only browser viewer for AnnData in zarr (or h5ad) built around the matrices other viewers
leave out: cell x cell kernels and distances (`obsp`) and gene x gene similarities (`varp`),
explored one focused cell or gene at a time and linked to the cell x gene layers.

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

[annzarro.readthedocs.io](https://annzarro.readthedocs.io): user guide, guides that rebuild each
paper figure in the app, CLI, configuration and HTTP API reference.

## Citation

Otto D.J., Baasri S. and Setty M. AnnZarro. Protocol preprint in preparation.

```bibtex
% PLACEHOLDER: replace with the preprint entry once it has a DOI.
@unpublished{otto_annzarro,
  author = {Otto, Dominik J. and Baasri, Siddharth and Setty, Manu},
  title  = {AnnZarro},
  note   = {Preprint in preparation},
  year   = {2026}
}
```

## Development

`npm ci` once (Node.js 22+), then `python -m pytest` runs the Python tests, every JS suite and
ESLint. See [running the tests](https://annzarro.readthedocs.io/en/latest/getting-started/installation.html#running-the-tests).

## Licence

MIT ([LICENSE](https://github.com/settylab/annzarro/blob/main/LICENSE)). The web interface bundles unmodified third-party libraries under their
own permissive licences, listed in [`annzarro/THIRD_PARTY_LICENSES/`](https://github.com/settylab/annzarro/tree/main/annzarro/THIRD_PARTY_LICENSES).
