"""R2: the committed oracle files (tests/data/oracle) are present, shaped as documented and in step with the fixture.

Needs numpy only (never scanpy or scipy.cluster). The oracles themselves are made by ``tests/data/oracle/make_*.py``
in a throwaway venv; this file guards what they leave behind, so a consumer step (E5, X1, X2a, V3, binning)
can trust the shapes and names its own tests index.
"""
import ast
import importlib.util
import json
import os

import numpy as np
import pytest

from annzarro.tests.core.grouping_store import make_data

ORACLE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "oracle")
PACKAGES = ("scanpy", "anndata", "scipy", "numpy", "pandas")


def _load(name):
    path = os.path.join(ORACLE, name)
    assert os.path.exists(path), f"{name} is missing; regenerate it, see {ORACLE}/README.md"
    return np.load(path, allow_pickle=False)


def _common():
    spec = importlib.util.spec_from_file_location("oracle_common", os.path.join(ORACLE, "_common.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def versions():
    with open(os.path.join(ORACLE, "VERSIONS.json"), encoding="utf-8") as f:
        return json.load(f)


# --- VERSIONS.json and the scripts ----------------------------------------------------------------------------

def _script_pins(script):
    with open(os.path.join(ORACLE, script), encoding="utf-8") as f:
        tree = ast.parse(f.read())
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "PINS" for t in node.targets):
            return ast.literal_eval(node.value), ast.get_docstring(tree)
    raise AssertionError(f"{script} has no PINS")


def test_versions_json_matches_every_script(versions):
    assert set(versions["versions"]) == set(PACKAGES)
    for script, out in versions["scripts"].items():
        pins, doc = _script_pins(script)
        assert pins == versions["versions"], script
        for pkg, ver in pins.items():
            assert f"{pkg} {ver}" in doc, f"{script}: docstring does not record {pkg} {ver}"
        assert os.path.exists(os.path.join(ORACLE, out)), out
    makers = sorted(f for f in os.listdir(ORACLE) if f.startswith("make_") and f.endswith(".py"))
    assert makers == sorted(versions["scripts"]), "a maker script is not listed in VERSIONS.json (or the reverse)"
    npz = sorted(f for f in os.listdir(ORACLE) if f.endswith(".npz"))
    assert npz == sorted(versions["scripts"].values())


def test_fixture_has_not_moved(versions):
    digest = _common().fixture_digest(make_data())
    assert digest == versions["fixture_digest"], "grouping_store changed; rerun the maker scripts (README.md)"
    for out in versions["scripts"].values():
        assert str(_load(out)["fixture_digest"]) == digest, out


def test_size_budget():
    total = sum(os.path.getsize(os.path.join(ORACLE, f)) for f in os.listdir(ORACLE)
                if os.path.isfile(os.path.join(ORACLE, f)))
    assert total < 2_000_000, total


# --- dotplot / matrixplot --------------------------------------------------------------------------------------

LAYERS = ["X", "logged", "counts"]
GROUPBYS = {"cell_type": 6, "condition": 2, "score_bin": 4, "tiny": 3}
SCALES = ["none", "var", "group"]


def test_dotplot_matrixplot_keys_and_shapes():
    z = _load("dotplot_matrixplot.npz")
    assert list(z["genes"]) == [f"GENE{i:03d}" for i in range(12)]
    n_dot = n_mat = 0
    for g, n in GROUPBYS.items():
        assert len(z[f"groups__{g}"]) == n
        assert z[f"n_cells__{g}"].sum() == (1200 if g != "score_bin" else 1200)
        for layer in LAYERS:
            for ss in SCALES:
                m = z[f"matrix__{layer}__{g}__ss{ss}"]
                assert m.shape == (n, 12) and np.isfinite(m).all()
                n_mat += 1
                for cut in ("0.0", "0.5"):
                    for mo in (0, 1):
                        k = f"dot__{layer}__{g}__cut{cut}__mo{mo}__ss{ss}"
                        color, size = z[k + "__color"], z[k + "__size"]
                        assert color.shape == size.shape == (n, 12), k
                        assert np.isfinite(color).all() and np.isfinite(size).all(), k   # scanpy writes 0, never NaN
                        assert size.min() >= 0 and size.max() <= 1, k
                        n_dot += 1
    assert n_dot == 4 * 3 * 3 * 2 * 2 * 1 and n_mat == 4 * 3 * 3


def test_dotplot_p3_group_without_expressing_cell_is_zero():
    z = _load("dotplot_matrixplot.npz")
    k = "dot__logged__tiny__cut0.0__mo1__ssnone"
    size, color = z[k + "__size"], z[k + "__color"]
    empty = size == 0
    assert empty.any() and empty[:, 3].all()          # GENE003 is expressed by nobody, tiny groups miss more
    assert (color[empty] == 0).all()                  # P3: scanpy writes 0 for "no expressing cell"
    assert (size[~empty] > 0).all() and (color[~empty] > 0).all()


def test_dotplot_agrees_with_plain_numpy_on_the_fixture():
    """The oracle is not trusted blindly: scanpy's cell_type / logged values equal a numpy recomputation."""
    z = _load("dotplot_matrixplot.npz")
    data = make_data()
    v = data.logged[:, :12].astype(np.float64)
    ct = data.obs["cell_type"].cat.codes.to_numpy()
    for cut in (0.0, 0.5):
        size = np.array([[(v[ct == g, j] > cut).mean() for j in range(12)] for g in range(6)])
        mean_all = np.array([v[ct == g].mean(axis=0) for g in range(6)])
        expr = np.array([[v[ct == g, j][v[ct == g, j] > cut].mean() if (v[ct == g, j] > cut).any() else 0.0
                          for j in range(12)] for g in range(6)])
        np.testing.assert_allclose(z[f"dot__logged__cell_type__cut{cut}__mo0__ssnone__size"], size, rtol=1e-12, atol=0)
        np.testing.assert_allclose(z[f"dot__logged__cell_type__cut{cut}__mo0__ssnone__color"], mean_all, rtol=1e-12)
        np.testing.assert_allclose(z[f"dot__logged__cell_type__cut{cut}__mo1__ssnone__color"], expr, rtol=1e-12)
    np.testing.assert_allclose(z["matrix__logged__cell_type__ssnone"], np.array([v[ct == g].mean(axis=0) for g in range(6)]),
                               rtol=1e-12)


# --- num_categories --------------------------------------------------------------------------------------------

def test_num_categories():
    z = _load("num_categories.npz")
    assert list(z["ns"]) == list(range(2, 13))
    for col in z["columns"]:
        v = z[f"values__{col}"]
        assert v.shape == (1200,)
        for n in z["ns"]:
            edges, codes, half = (z[f"{p}__{col}__{n}"] for p in ("edges", "codes", "halfopen"))
            assert edges.shape == (n + 1,) and np.isfinite(edges).all() and (np.diff(edges) > 0).all()
            assert codes.shape == half.shape == (1200,)
            assert ((codes == -1) == np.isnan(v)).all() and ((half == -1) == np.isnan(v)).all()
            assert codes.max() <= n - 1 and half.max() <= n - 1
            assert (np.bincount(codes[codes >= 0], minlength=n) > 0).sum() >= 1
    # (a, b] against [lo, hi): only values ON an inner edge may differ, and pseudotime has them
    diff = z["codes__pseudotime__4"] != z["halfopen__pseudotime__4"]
    assert diff.any()
    on_edge = np.isin(z["values__pseudotime"], z["edges__pseudotime__4"][1:-1])
    assert (diff <= on_edge).all()
    assert (z["codes__score__4"] == z["halfopen__score__4"]).all()      # continuous data: no cell on an edge


# --- linkage ---------------------------------------------------------------------------------------------------

CASES = {"means_ct": 6, "genes_ct": 11, "cells40": 40, "rand40": 40}
COMBOS = [("correlation", "complete"), ("correlation", "average"),
          ("euclidean", "complete"), ("euclidean", "average"), ("euclidean", "ward")]


def test_linkage_keys_and_shapes():
    z = _load("linkage.npz")
    for case, n in CASES.items():
        X = z[f"{case}__X"]
        assert X.shape[0] == n and np.isfinite(X).all()
        for dist in ("correlation", "euclidean"):
            d = z[f"{case}__dist_{dist}"]
            assert d.shape == (n * (n - 1) // 2,) and np.isfinite(d).all()
        for dist, method in COMBOS:
            Z, leaves = z[f"{case}__Z_{dist}_{method}"], z[f"{case}__leaves_{dist}_{method}"]
            assert Z.shape == (n - 1, 4) and np.isfinite(Z).all()
            assert sorted(leaves) == list(range(n))
            assert Z[-1, 3] == n and (np.diff(Z[:, 2]) >= -1e-12).all()      # monotone: no inversions for these methods
            assert (Z[:, :2] < n + np.arange(n - 1)[:, None]).all()          # a merge uses clusters that exist already
    assert not any(k.endswith("_correlation_ward") for k in z.files)


# --- kde -------------------------------------------------------------------------------------------------------

def test_kde():
    z = _load("kde.npz")
    for name, dim in (("score", 1), ("signed", 1), ("depth", 1), ("pseudotime", 1),
                      ("umap", 2), ("corr", 2), ("score_depth", 2)):
        bins = 512 if dim == 1 else 64
        for a in ("a0.5", "a1", "a2"):
            p = f"{name}__{a}__"
            h, hf, step = z[p + "h"], z[p + "h_floor"], z[p + "step"]
            assert h.shape == hf.shape == step.shape == z[p + "lo"].shape == (dim,)
            assert (hf >= h).all() and (hf >= 1.5 * step - 1e-12).all() and (h > 0).all()
            assert z[p + "n_in"] + z[p + "n_out"] == z[p + "n"] and z[p + "n_out"] <= 0.02 * z[p + "n"]
            for dens in ("density", "density_floor"):
                f = z[p + dens]
                assert f.shape == (bins,) * dim and np.isfinite(f).all() and (f >= 0).all()
                mass = f.sum() * np.prod(step)
                assert 0.85 < mass < 1.0 + 1e-6, (p, dens, mass)           # a density, less the tail beyond the range
