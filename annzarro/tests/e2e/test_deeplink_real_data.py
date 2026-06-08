"""Real-dataset deep-link check -- runs only where served data is present.

The committed ``fixture_small.zarr`` covers the data contract structurally, but a
real harmonized store exercises the reader against actual anndata encodings (the
class of thing the h5ad-shape bug hid in). This test discovers a real dataset
under ``served-data/`` and drives the same deep-link data path; it is marked
``real_data`` and skips cleanly in CI / any clone without the (gitignored) data,
so it never false-fails.
"""
import glob
import os

import pytest

from .conftest import REPO_ROOT

API = "/api/v1"
SERVED = os.path.join(REPO_ROOT, "served-data", "datasets")

pytestmark = pytest.mark.real_data


def _first_real_dataset():
    if not os.path.isdir(SERVED):
        return None
    hits = sorted(glob.glob(os.path.join(SERVED, "*.zarr")))
    return hits[0] if hits else None


def test_real_dataset_deeplink_paths(client):
    ds = _first_real_dataset()
    if ds is None:
        pytest.skip("no served-data/datasets/*.zarr in this environment")

    # info
    info = client.get(f"{API}/data/info?dataset_path={ds}")
    assert info.status_code == 200, info.get_data(as_text=True)
    meta = info.get_json()
    n_obs = meta["n_obs"]
    assert n_obs > 0 and meta["n_vars"] > 0
    assert meta["has_obs"] and meta["has_var"]

    # an obs column the deep-link could color by
    obs_cols = [c for c in meta.get("obs_columns", []) if c != "_index"]
    assert obs_cols, "real dataset exposed no obs columns"
    col_resp = client.get(
        f"{API}/data/obs?dataset_path={ds}&columns={obs_cols[0]}"
    )
    assert col_resp.status_code == 200, col_resp.get_data(as_text=True)
    data = col_resp.get_json()["data"]
    values = data[obs_cols[0]] if isinstance(data, dict) else data
    assert len(values) == n_obs

    # a single gene's expression column (the contiguous-CSC read path)
    x_resp = client.get(f"{API}/data/X?dataset_path={ds}&cols=0")
    assert x_resp.status_code == 200, x_resp.get_data(as_text=True)
    rows = x_resp.get_json()["data"]
    assert len(rows) == n_obs


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v", "-m", "real_data"]))
