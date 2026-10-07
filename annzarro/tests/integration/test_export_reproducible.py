"""The same view and store, exported twice, give the same figure.

``annzarro export`` (annzarro/export.py) is run as a user runs it, twice per
format, each time in a fresh server process and a fresh headless Chromium.
The SVGs must be identical byte for byte and the PNGs pixel for pixel (and
here byte for byte too). WebGL points are drawn by SwiftShader, Chromium's
software renderer, which the command pins, so no GPU enters the result.

Also checked: the figure carries its recipe (the view as a panel set, the
store's fingerprint, the AnnZarro version), ``--from`` makes the same
figure again from it, and a store with other cells is refused unless asked.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import json
import os
import shutil
import subprocess
import sys

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api  # noqa: F401,E402  (required: fail, do not skip)
else:
    pytest.importorskip("playwright.sync_api")

from annzarro import __version__
from annzarro.export import png_text, read_recipe

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")

UMAP = {"x": {"type": "obsm", "key": "X_umap", "column": "0"},
        "y": {"type": "obsm", "key": "X_umap", "column": "1"}}
PANEL_SET = {
    "name": "two-plots",
    "dataset": "fixture_small.zarr",
    "view": {
        "v": 1,
        "constants": {"focusedGene": "GENE004", "focusedCell": "cell_0011"},
        "layout": {"v": 1, "controlState": {},
                   "hierarchy": [{"type": "split", "direction": "horizontal",
                                  "panes": [{"percentage": 50}, {"percentage": 50}],
                                  "children": [{"type": "tile", "id": "cell-plot-1"},
                                               {"type": "tile", "id": "cell-plot-2"}]}],
                   "panelConfigs": {
                       "cell-plot-1": {"id": "cell-plot-1", **UMAP,
                                       "color": {"type": "obs", "key": "cell_type", "column": ""},
                                       "exportWidth": 900, "exportHeight": 600},
                       "cell-plot-2": {"id": "cell-plot-2", **UMAP,
                                       "color": {"type": "layer", "key": "X", "column": "GENE004"},
                                       "exportWidth": 700, "exportHeight": 700, "scaleExport": True}}},
    },
}


def _export(args, cwd):
    env = dict(os.environ, PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.run([sys.executable, "-m", "annzarro.cli", "export", *args], cwd=cwd, env=env,
                          capture_output=True, text=True, timeout=600)
    return proc


@pytest.fixture(scope="module")
def work(tmp_path_factory):
    base = tmp_path_factory.mktemp("export")
    store = base / "fixture_small.zarr"
    shutil.copytree(FIXTURE, store)
    (base / "view.json").write_text(json.dumps(PANEL_SET))
    return base, store


@pytest.fixture(scope="module")
def runs(work):
    base, store = work
    out = {}
    for run in (1, 2):
        for fmt in ("svg", "png"):
            target = base / f"run{run}.{fmt}"
            proc = _export([str(base / "view.json"), "--store", str(store), "--out", str(target)], base)
            assert proc.returncode == 0, proc.stderr + proc.stdout
            out[(run, fmt)] = target
    return out


def _files(path):
    """Both plots: <stem>-<panel id>.<ext>"""
    return sorted(path.parent.glob(f"{path.stem}-cell-plot-*{path.suffix}"))


def test_svg_is_byte_identical(runs):
    a, b = _files(runs[(1, "svg")]), _files(runs[(2, "svg")])
    assert [p.name.split("-", 1)[1] for p in a] == ["cell-plot-1.svg", "cell-plot-2.svg"]
    for x, y in zip(a, b):
        assert x.read_bytes() == y.read_bytes(), f"{x.name} differs between runs"


def test_png_is_pixel_identical(runs):
    from PIL import Image, ImageChops
    a, b = _files(runs[(1, "png")]), _files(runs[(2, "png")])
    assert len(a) == 2
    for x, y in zip(a, b):
        ia, ib = Image.open(x).convert("RGBA"), Image.open(y).convert("RGBA")
        assert ia.size == ib.size
        assert ImageChops.difference(ia, ib).getbbox() is None, f"{x.name}: pixels differ between runs"
        # and, with the same encoder, the same bytes
        assert x.read_bytes() == y.read_bytes()


def test_png_size_follows_the_panel_settings(runs):
    from PIL import Image
    one, two = _files(runs[(1, "png")])
    assert Image.open(one).size == (900, 600)
    assert Image.open(two).size == (1400, 1400)      # scaleExport: twice the size


def test_the_figure_carries_its_recipe(runs):
    png = _files(runs[(1, "png")])[0]
    assert png_text(png.read_bytes()) is not None
    for path in (png, _files(runs[(1, "svg")])[1]):
        recipe = read_recipe(str(path))
        assert recipe["annzarro_version"] == __version__
        view = recipe["panel_set"]["view"]
        assert recipe["panel"] in view["layout"]["panelConfigs"]
        assert view["store"]["path"] == "fixture_small.zarr"
        assert "abs" not in view["store"], "a published figure must not name a server's absolute path"
        assert view["store"]["fp"]["n_obs"] == 200 and view["store"]["fp"]["data"]
        assert view["annzarro"] == __version__


def test_from_the_figure_makes_the_same_figure(runs, work):
    base, store = work
    for fmt in ("svg", "png"):
        original = _files(runs[(1, fmt)])[1]
        again = base / f"again.{fmt}"
        proc = _export(["--from", str(original), "--store", str(store), "--out", str(again)], base)
        assert proc.returncode == 0, proc.stderr + proc.stdout
        assert again.read_bytes() == original.read_bytes(), f"--from {fmt} is not the same figure"


def test_a_store_with_other_cells_is_refused(runs, work, tmp_path):
    from annzarro.tests.zarr_compat import open_group, write_strings
    base, _ = work
    other = tmp_path / "fixture_small.zarr"
    shutil.copytree(FIXTURE, other)
    group = open_group(other / "obs", mode="a")
    attrs = dict(group["_index"].attrs)
    del group["_index"]
    write_strings(group, "_index", [f"x{i}" for i in range(200)]).attrs.update(attrs)
    original = _files(runs[(1, "svg")])[0]
    proc = _export(["--from", str(original), "--store", str(other), "--out", str(tmp_path / "o.svg")], base)
    assert proc.returncode == 2
    assert "not the store this view was saved on" in proc.stderr
