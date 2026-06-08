# `served-data/` — the serve-a-directory convention

AnnZarro is a **general** single-cell visualization server. It does not embed
any particular dataset catalogue. Instead it serves whatever zarr stores it
finds in a directory at runtime:

1. Point the server at this directory via the `data_dir` config key
   (`app.config["data_dir"]`). It defaults to an instance-relative `data/`
   directory; in a typical deployment you set it to this `served-data/`.
2. Place one [AnnData](https://anndata.readthedocs.io/) **zarr store** per
   dataset under `served-data/datasets/<name>.zarr` (a symlink to a store
   elsewhere on disk works too).
3. The endpoint `GET /api/<version>/datasets` returns the discovered stores —
   it scans `datasets/` (falling back to `data_dir` itself) for `*.zarr`
   directories and `.zarray`/`.zgroup` markers. There is **no hardcoded
   dataset list anywhere in AnnZarro**; discovery is purely by directory scan
   (`annzarro/server/routes/data_routes.py`).

## Why this is the extension point

Deployments differ in *which* datasets they serve and *how* those datasets
were produced (harmonization, layer naming, embeddings). That is
deployment-specific knowledge and must **not** be hardcoded into AnnZarro
core. The serve-a-directory convention is the general seam:

- **AnnZarro core** owns discovery, the deep-link URL grammar
  (`?dataset_path=…&view=…`), and rendering — all dataset-agnostic.
- **A deployment** owns its dataset corpus: the harmonization scripts that
  produce the stores, and any manifest describing what *should* be served.
  Those artifacts live with the deployment, not here.

If a downstream consumer needs richer per-dataset metadata than directory
discovery provides, add it as a **general** mechanism (a convention the
deployment populates and AnnZarro reads — e.g. a sidecar file in each store,
or a manifest the deployment generates), never as a dataset list baked into
AnnZarro source.

## What is gitignored

`datasets/` (the live zarr stores) and `sessions/` (per-user state) are
large, host-specific runtime artifacts and are not committed (see
`.gitignore`). Only this convention doc and the ignore rules are tracked.
