"""``annzarro store annotate``: writes uns["annzarro"] and uns["README"] where the info route reads them."""
import os
import shutil

import pytest
import zarr

from annzarro.core import dataset_annotate, dataset_info
from annzarro.store_command import store_annotate_command
from annzarro.tests import zarr_compat

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
STORES = ["fixture_small.zarr", pytest.param("fixture_small_v3.zarr", marks=pytest.mark.skipif(
    int(zarr.__version__.split(".")[0]) < 3, reason="needs zarr >= 3"))]


@pytest.fixture(params=STORES, ids=["v2", "v3"])
def store(request, tmp_path):
    shutil.copytree(os.path.join(DATA, request.param), tmp_path / "s.zarr")
    return str(tmp_path / "s.zarr")


def read(store, *parts):
    return dataset_info.read_info(store, parts)


def test_fields_and_readme_round_trip(store):
    written = dataset_annotate.annotate_store(store, {"title": "T", "license": "MIT", "authors": ["A", "B"]}, "# Hi")
    assert written == ["uns/annzarro/title", "uns/annzarro/license", "uns/annzarro/authors", "uns/README"]
    got = read(store, "about", "readme")
    assert got["about"]["title"] == "T" and got["about"]["authors"] == ["A", "B"] and got["readme"]["text"] == "# Hi"


def test_a_second_call_changes_only_what_it_gives(store):
    dataset_annotate.annotate_store(store, {"title": "T", "license": "MIT"}, "# Hi")
    dataset_annotate.annotate_store(store, {"title": "T2"})
    about = read(store, "about", "readme")
    assert about["about"]["title"] == "T2" and about["about"]["license"] == "MIT" and about["readme"]["text"] == "# Hi"


def test_a_consolidated_store_stays_readable(store):
    zarr_compat.consolidate(store)
    dataset_annotate.annotate_store(store, {"title": "T"})
    root = zarr.open_group(store, mode="r")
    assert "annzarro" in root["uns"]
    assert read(store, "about")["about"]["title"] == "T"


def test_anndata_attributes_are_written_as_anndata_does(store):
    dataset_annotate.annotate_store(store, {"title": "T", "authors": ["A"]}, "r")
    uns = zarr.open_group(store, mode="r")["uns"]
    assert dict(uns.attrs)["encoding-type"] == "dict" and dict(uns["annzarro"].attrs)["encoding-type"] == "dict"
    assert dict(uns["annzarro"]["title"].attrs)["encoding-type"] == "string"
    assert dict(uns["annzarro"]["authors"].attrs)["encoding-type"] == "string-array"
    assert dict(uns["README"].attrs)["encoding-type"] == "string"


@pytest.mark.parametrize("fields,readme,words", [
    ({"nope": "x"}, None, "unknown field"),
    ({}, None, "nothing to write"),
    ({"title": "T"}, "x" * (dataset_info.MAX_README_BYTES + 1), "shorten"),
])
def test_refusals(store, fields, readme, words):
    with pytest.raises(dataset_annotate.AnnotateError, match=words):
        dataset_annotate.annotate_store(store, fields, readme)


def test_remote_h5ad_and_non_stores_are_refused(tmp_path):
    for target, words in (("s3://b/x.zarr", "local"), (str(tmp_path / "a.h5ad"), "not a zarr store"), (str(tmp_path), "does not look")):
        (tmp_path / "a.h5ad").write_text("x")
        with pytest.raises(dataset_annotate.AnnotateError, match=words):
            dataset_annotate.annotate_store(target, {"title": "T"})


def test_the_command(store, tmp_path, capsys):
    readme = tmp_path / "README.md"
    readme.write_text("# From a file\n", encoding="utf-8")

    class Args:
        pass
    args = Args()
    args.store, args.readme = store, str(readme)
    for name in dataset_annotate.FIELDS:
        setattr(args, name, None)
    args.license, args.authors = "CC-BY-4.0", ["A", "B"]
    assert store_annotate_command(args) == 0
    assert "wrote uns/README" in capsys.readouterr().out
    got = read(store, "about", "readme")
    assert got["about"]["license_url"].endswith("CC-BY-4.0.html") and got["readme"]["text"] == "# From a file\n"
    args.readme = str(tmp_path / "missing.md")
    assert store_annotate_command(args) == 2 and "cannot read" in capsys.readouterr().err
    args.readme, args.store = None, "s3://b/x.zarr"
    assert store_annotate_command(args) == 2
