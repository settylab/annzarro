"""A relative dataset_path is the same store as the dropdown's entry for it.

``?dataset_path=bm.zarr`` (a share link) used to be rewritten to an ABSOLUTE
path, while the listing names the entry ``<data_dir>/bm.zarr`` as the data
directory was configured (``../data`` for a relative one). The client found
no matching option, so the dataset opened under the absolute path as a second
dropdown entry. Checked for a symlinked entry (the documented way to add a
dataset) and a relative data directory, in both access modes.
"""
import os
import shutil

import pytest

from annzarro.server.core import create_app

FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small.zarr"
)


@pytest.fixture
def layout(tmp_path, monkeypatch):
    """data/linked.zarr -> real/linked.zarr (outside data), cwd = tmp/cwd."""
    (tmp_path / "data").mkdir()
    (tmp_path / "real").mkdir()
    (tmp_path / "cwd").mkdir()
    shutil.copytree(FIXTURE, tmp_path / "real" / "linked.zarr")
    os.symlink(tmp_path / "real" / "linked.zarr", tmp_path / "data" / "linked.zarr")
    shutil.copytree(FIXTURE, tmp_path / "outside.zarr")
    monkeypatch.chdir(tmp_path / "cwd")
    return tmp_path


def _client(data_dir, **extra):
    cfg = {"TESTING": True, "DEBUG": False, "auth_enabled": False, "data_dir": data_dir}
    cfg.update(extra)
    return create_app(cfg).test_client()


def _fingerprint(client, path):
    return client.get("/api/v1/data/fingerprint", query_string={"dataset_path": path})


@pytest.mark.parametrize("spelling", ["absolute", "relative"])
@pytest.mark.parametrize("extra", [{}, {"allowed_dirs": ["REAL"], "hosted": True}], ids=["local", "hosted"])
def test_relative_link_has_the_listings_identity(layout, spelling, extra):
    data_dir = str(layout / "data") if spelling == "absolute" else "../data"
    extra = {k: ([str(layout / "real")] if v == ["REAL"] else v) for k, v in extra.items()}
    client = _client(data_dir, **extra)
    listing = {d["rel_path"]: d for d in client.get("/api/v1/datasets").get_json()}
    entry = listing["linked.zarr"]
    assert entry["is_link"] is True
    resp = _fingerprint(client, "linked.zarr")
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    assert body["path"] == entry["path"]          # not an absolute, resolved path
    assert body["rel_path"] == "linked.zarr"
    assert not os.path.realpath(body["path"]) == body["path"] or spelling == "absolute"


def test_dotslash_and_nested_spellings_normalise_to_the_listing(layout):
    client = _client("../data")
    entry = client.get("/api/v1/datasets").get_json()[0]
    assert _fingerprint(client, "./linked.zarr").get_json()["path"] == entry["path"]


def test_a_link_is_refused_in_hosted_mode_when_its_target_is_outside(layout):
    client = _client(str(layout / "data"), hosted=True)   # no allowed_dirs for real/
    resp = _fingerprint(client, "linked.zarr")
    assert resp.status_code == 403 and resp.get_json()["reason"] == "outside_data_dir"


@pytest.mark.parametrize("data_dir", ["abs", "rel"])
def test_absolute_path_outside_is_refused_when_hosted(layout, data_dir):
    client = _client(str(layout / "data") if data_dir == "abs" else "../data", hosted=True)
    resp = _fingerprint(client, str(layout / "outside.zarr"))
    assert resp.status_code == 403 and resp.get_json()["reason"] == "outside_data_dir"


@pytest.mark.parametrize("data_dir", ["abs", "rel"])
def test_dotdot_cannot_escape_the_data_dir_when_hosted(layout, data_dir):
    client = _client(str(layout / "data") if data_dir == "abs" else "../data", hosted=True)
    for value in ("../outside.zarr", "./../outside.zarr", "x/../../outside.zarr"):
        resp = _fingerprint(client, value)
        assert resp.status_code == 403 and resp.get_json()["reason"] == "outside_data_dir", value


def test_hosted_relative_path_never_means_the_working_directory(layout):
    # cwd holds a store of the same name; a hosted server still means data_dir
    shutil.copytree(FIXTURE, layout / "cwd" / "shadow.zarr")
    client = _client(str(layout / "data"), hosted=True)
    resp = _fingerprint(client, "shadow.zarr")
    assert resp.status_code != 200            # not found in data_dir, not read from cwd


def test_absolute_path_is_allowed_on_a_local_server(layout):
    client = _client(str(layout / "data"))
    resp = _fingerprint(client, str(layout / "outside.zarr"))
    assert resp.status_code == 200 and resp.get_json()["rel_path"] is None


@pytest.mark.parametrize("data_dir", ["abs", "rel"])
def test_a_link_to_outside_the_data_dir_is_listed_and_opened_by_its_relative_name(layout, data_dir):
    """The operator's setup: data/linked.zarr -> a store elsewhere (local server)."""
    client = _client(str(layout / "data") if data_dir == "abs" else "../data")
    entry = client.get("/api/v1/datasets").get_json()[0]
    assert entry["rel_path"] == "linked.zarr" and entry["is_link"] is True
    assert not os.path.realpath(entry["path"]).startswith(os.path.realpath(str(layout / "data")))
    body = _fingerprint(client, "linked.zarr").get_json()
    assert body["path"] == entry["path"] and body["rel_path"] == "linked.zarr"
    assert "real" not in body["rel_path"]
