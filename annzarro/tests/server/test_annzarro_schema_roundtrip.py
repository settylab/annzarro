"""uns["annzarro"] written by ``store annotate`` and by plain anndata, read by the server, across versions.

anndata is not installed in the test environment, so "plain anndata" is a writer in this file that
writes what ``adata.uns["annzarro"] = {...}; write_zarr / write_h5ad`` writes (an ``encoding-type: dict``
group of ``string`` and ``string-array`` members, numbers as ``numeric-scalar``), without any of this
program's code; the h5ad twin copies that tree member by member.
"""
import os
import shutil

import numpy as np
import pytest
import zarr

from annzarro.core import dataset_annotate, dataset_schema
from annzarro.server.core import create_app
from annzarro.server.routes import data_routes, dataset_info as info_routes
from annzarro.tests import zarr_compat
from annzarro.tests.core.h5ad_twin import h5ad_twin

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
FIXTURES = {"v2": os.path.join(DATA, "fixture_small.zarr"), "v3": os.path.join(DATA, "fixture_small_v3.zarr")}
ZARR3 = int(zarr.__version__.split(".")[0]) >= 3
KINDS = ["v2", pytest.param("v3", marks=pytest.mark.skipif(not ZARR3, reason="needs zarr >= 3")), "h5ad"]
URL = "/api/v1/datasets/info"


def anndata_write(root, tree):
    """Write ``tree`` as uns["annzarro"] the way anndata does."""
    uns = root.require_group("uns")
    uns.attrs.update({"encoding-type": "dict", "encoding-version": "0.1.0"})

    def put(group, name, value):
        if isinstance(value, dict):
            child = group.require_group(name)
            child.attrs.update({"encoding-type": "dict", "encoding-version": "0.1.0"})
            for k, v in value.items():
                put(child, k, v)
            return
        if isinstance(value, list):
            strings = bool(value) and isinstance(value[0], str)
            # zarr 2 needs a codec for an object array: write strings as anndata does (vlen-utf8)
            node = zarr_compat.write_strings(group, name, value) if strings else zarr_compat.write_array(group, name, np.array(value))
            node.attrs.update({"encoding-type": "string-array" if strings else "array", "encoding-version": "0.2.0"})
            return
        node = zarr_compat.write_array(group, name, np.asarray(value))
        node.attrs.update({"encoding-type": "string" if isinstance(value, str) else "numeric-scalar", "encoding-version": "0.2.0"})
    put(uns, "annzarro", tree)


@pytest.fixture
def client(tmp_path):
    data_routes._LISTING_PROBE_CACHE.clear()
    info_routes.clear_cache()
    (tmp_path / "data").mkdir()
    config = {"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path / "data"), "log_file": str(tmp_path / "t.log"),
              "user_file": str(tmp_path / "users.json"), "secret_key": "test-only-secret"}
    app = create_app(config)
    app.root = tmp_path / "data"
    return app.test_client(), app.root


def store_of(root, kind, writer, tree=None, fields=None):
    """A store of ``kind`` (zarr v2, v3 or an h5ad twin) carrying ``tree`` written by ``writer`` (anndata) or ``fields`` (annotate)."""
    name = "v2" if kind == "h5ad" else kind
    path = root / f"{kind}_{writer}.zarr"
    shutil.copytree(FIXTURES[name], path)
    if writer == "anndata":
        anndata_write(zarr_compat.open_group(path, mode="r+"), tree)
        zarr_compat.consolidate(path)
    else:
        dataset_annotate.annotate_store(str(path), fields)
    if kind == "h5ad":
        h5ad_twin(path, root / f"{kind}_{writer}.h5ad")
        return root / f"{kind}_{writer}.h5ad"
    return path


def about(client, store):
    body = client.get(URL, query_string={"path": str(store), "parts": "about"})
    assert body.status_code == 200, body.get_json()
    return body.get_json()["about"]


V1_PLAIN = {"title": "Liver atlas", "license": "CC-BY-4.0", "doi": "10.1234/abcd", "authors": ["Jane Doe", "John Roe"],
            "contact": "jane@example.org"}


@pytest.mark.parametrize("kind", KINDS)
def test_v1_without_a_marker_from_plain_anndata(client, kind):
    c, root = client
    got = about(c, store_of(root, kind, "anndata", V1_PLAIN))
    assert got["schema"]["version"] == "1.0" and got["schema"]["declared"] is False and got["schema"]["note"] is None
    assert got["title"] == "Liver atlas" and got["authors"] == ["Jane Doe", "John Roe"]
    assert got["license_url"].endswith("CC-BY-4.0.html") and got["doi_url"] == "https://doi.org/10.1234/abcd"
    assert got["contact_url"] == "mailto:jane@example.org" and got["unknown"] == []


@pytest.mark.parametrize("kind", KINDS)
def test_v1_with_a_marker_from_plain_anndata_and_from_annotate_read_the_same(client, kind):
    c, root = client
    marked = {"schema": dataset_schema.SCHEMA_NAME, "schema_version": "1.0", **V1_PLAIN}
    from_anndata = about(c, store_of(root, kind, "anndata", marked))
    from_annotate = about(c, store_of(root, kind, "annotate", fields=dict(V1_PLAIN)))
    assert from_anndata["schema"]["declared"] is True and from_annotate["schema"]["declared"] is True
    assert from_annotate["schema"]["version"] == "1.0"
    assert from_anndata == from_annotate


@pytest.mark.parametrize("kind", KINDS)
def test_a_fake_v1_1_with_extra_keys_reads_everything_it_knows(client, kind):
    c, root = client
    tree = {"schema": dataset_schema.SCHEMA_NAME, "schema_version": "1.1", **V1_PLAIN,
            "telemetry": "opt-in", "future": {"nested": {"a": "b"}, "n": 3},
            "license": "CC-BY-4.0", "funding": ["NIH R35"]}
    got = about(c, store_of(root, kind, "anndata", tree))
    assert got["schema"]["version"] == "1.1" and got["schema"]["newer"] == "minor" and got["schema"]["note"] is None
    assert got["title"] == "Liver atlas" and got["funding"] == [{"funder": "NIH R35"}]
    assert got["unknown"] == ["future", "telemetry"] and got["ignored"] == []


@pytest.mark.parametrize("kind", KINDS)
def test_a_fake_v2_with_a_renamed_field_reads_what_did_not_change_and_says_so(client, kind):
    c, root = client
    tree = {"schema": dataset_schema.SCHEMA_NAME, "schema_version": "2.0", "title": "Liver atlas",
            "authors": ["Jane Doe"], "licence_terms": {"id": "CC-BY-4.0"}}
    got = about(c, store_of(root, kind, "anndata", tree))
    assert got["schema"]["version"] == "2.0" and got["schema"]["newer"] == "major" and "newer AnnZarro" in got["schema"]["note"]
    assert got["title"] == "Liver atlas" and got["authors"] == ["Jane Doe"]
    assert "license" not in got and got["unknown"] == ["licence_terms"]


@pytest.mark.parametrize("kind", KINDS)
def test_rich_forms_round_trip_through_annotate_and_plain_anndata(client, kind):
    """A list of objects is an object keyed 0, 1 ... on disk (anndata cannot write a list of dicts)."""
    c, root = client
    rich = {"license": {"id": "CC-BY-4.0", "url": "https://example.org/terms"},
            "authors": [{"name": "Jane Doe", "orcid": "0000-0002-1825-0097"}, {"name": "John Roe"}],
            "contacts": [{"name": "Jane", "email": "jane@example.org", "role": "curator"}, {"name": "Lab", "url": "https://example.org"}],
            "funding": [{"funder": "NIH", "award": "R35GM147125"}], "provenance": {"source": "GEO", "n": 3}}
    on_disk = {"authors": {"0": rich["authors"][0], "1": rich["authors"][1]},
               "contacts": {"0": rich["contacts"][0], "1": rich["contacts"][1]},
               "funding": {"0": rich["funding"][0]}, "license": rich["license"], "provenance": rich["provenance"]}
    via_annotate = about(c, store_of(root, kind, "annotate", fields=rich))
    via_anndata = about(c, store_of(root, kind, "anndata", on_disk))
    for got in (via_annotate, via_anndata):
        assert got["authors"] == ["Jane Doe", "John Roe"] and got["author_details"][0]["orcid_url"].endswith("0000-0002-1825-0097")
        assert [x.get("name") for x in got["contacts"]] == ["Jane", "Lab"] and got["contact"] == "jane@example.org"
        assert got["funding"] == [{"funder": "NIH", "award": "R35GM147125"}]
        assert got["license"] == "CC-BY-4.0" and got["license_url"] == "https://example.org/terms"
        assert got["provenance"] == {"source": "GEO", "n": "3"}
    assert via_annotate["unknown"] == [] and via_annotate["ignored"] == []


def test_annotate_writes_the_current_version_and_keeps_it_when_a_field_changes(client):
    c, root = client
    path = store_of(root, "v2", "anndata", {"title": "Old", "schema_version": "1.0"})
    dataset_annotate.annotate_store(str(path), {"title": "New"})
    grp = zarr.open_group(str(path), mode="r")["uns"]["annzarro"]
    assert grp["schema"][()] == dataset_schema.SCHEMA_NAME and grp["schema_version"][()] == "1.0"
    assert about(c, path)["title"] == "New"


def test_annotate_refuses_what_the_reader_would_not_use(client):
    c, root = client
    path = root / "x.zarr"
    shutil.copytree(FIXTURES["v2"], path)
    for fields in ({"title": 42}, {"license": {"id": "MIT", "url": "javascript:x"}}, {"authors": [{"nameless": 1}]}):
        with pytest.raises(dataset_annotate.AnnotateError, match="not a form AnnZarro reads"):
            dataset_annotate.annotate_store(str(path), fields)


def test_annotate_from_json_with_rich_forms(client, tmp_path):
    import json
    from annzarro.store_command import store_annotate_command
    c, root = client
    path = root / "j.zarr"
    shutil.copytree(FIXTURES["v2"], path)
    spec = tmp_path / "info.json"
    spec.write_text(json.dumps({"title": "J", "funding": [{"funder": "ERC"}], "license": {"id": "MIT"}}), encoding="utf-8")

    class Args:
        pass
    args = Args()
    args.store, args.readme, args.from_json = str(path), None, str(spec)
    for name in dataset_annotate.FIELDS:
        setattr(args, name, None)
    args.title = "Overridden"
    assert store_annotate_command(args) == 0
    got = about(c, path)
    assert got["title"] == "Overridden" and got["funding"] == [{"funder": "ERC"}] and got["license_id"] == "MIT"
    args.from_json = str(tmp_path / "missing.json")
    assert store_annotate_command(args) == 2
