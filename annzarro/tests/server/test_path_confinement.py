"""
A shared server only opens paths inside its data directory
(annzarro/server/confinement.py); a local single-user one browses freely.

Every check here is about whether the request is REFUSED (403
``outside_data_dir``) before any reader runs. Whether an allowed path then
opens is the readers' business, so allowed requests only assert "not 403".
"""
import os

import pytest

from annzarro.server.core import create_app
from annzarro.server.confinement import allowed_roots, is_inside


def _app(tmp_path, host="127.0.0.1", auth_enabled=False, **extra):
    config = {
        "TESTING": True,
        "host": host,
        "data_dir": str(tmp_path / "data"),
        "log_file": str(tmp_path / "test.log"),
        "auth_enabled": auth_enabled,
        "user_file": str(tmp_path / "users.json"),
        "secret_key": "test-only-secret",
    }
    config.update(extra)
    return create_app(config)


@pytest.fixture
def layout(tmp_path):
    """data/inside.zarr, outside/secret.zarr, and data/link.zarr -> outside."""
    data = tmp_path / "data"
    outside = tmp_path / "outside"
    (data / "inside.zarr").mkdir(parents=True)
    (outside / "secret.zarr").mkdir(parents=True)
    os.symlink(outside / "secret.zarr", data / "link.zarr")
    os.symlink(outside, data / "linkdir")
    return tmp_path


@pytest.fixture
def hosted(layout):
    # Network host with login disabled: hosted, and no login needed to probe
    return _app(layout, host="0.0.0.0").test_client()


def _refused(resp):
    return resp.status_code == 403 and (resp.get_json() or {}).get("reason") == "outside_data_dir"


def _structure(client, path):
    return client.get("/api/v1/data/dataset_structure", query_string={"dataset_path": path})


# --- refused when hosted ----------------------------------------------------

def test_absolute_path_outside_is_refused(hosted, layout):
    resp = _structure(hosted, str(layout / "outside" / "secret.zarr"))
    assert _refused(resp)
    assert "outside the data directory" in resp.get_json()["error"]


def test_dotdot_traversal_is_refused(hosted, layout):
    assert _refused(_structure(hosted, str(layout / "data" / ".." / "outside" / "secret.zarr")))
    assert _refused(_structure(hosted, str(layout / "data" / "inside.zarr" / ".." / ".." / "outside")))


def test_symlink_out_of_the_data_dir_is_refused(hosted, layout):
    assert _refused(_structure(hosted, str(layout / "data" / "link.zarr")))
    assert _refused(_structure(hosted, str(layout / "data" / "linkdir" / "secret.zarr")))


def test_sibling_with_shared_prefix_is_refused(hosted, layout):
    (layout / "data_old" / "x.zarr").mkdir(parents=True)
    assert _refused(_structure(hosted, str(layout / "data_old" / "x.zarr")))


def test_every_path_carrying_parameter_is_checked(hosted, layout):
    secret = str(layout / "outside" / "secret.zarr")
    # URL-path form only carries relative paths (resolved against the working
    # directory, like the readers do); "//abs" never reaches the route
    assert _refused(hosted.get(f"/api/v1/datasets/{os.path.relpath(secret)}/info"))
    assert _refused(hosted.get(f"/api/v1/datasets/{os.path.relpath(secret)}/uns/structure"))
    assert _refused(hosted.get("/api/v1/data/obs", query_string={"dataset_path": secret}))
    assert _refused(hosted.get("/api/v1/data/info", query_string={"dataset_id": secret}))
    assert _refused(hosted.get("/api/v1/zarr/to_anndata", query_string={"dataset_path": secret}))
    assert _refused(hosted.get("/api/v1/core/datasets", query_string={"dir": str(layout / "outside")}))
    assert _refused(hosted.get("/api/v1/directories/list", query_string={"path": "/"}))
    assert _refused(hosted.get("/api/v1/directories/list", query_string={"path": "../outside"}))


def test_login_enabled_on_localhost_is_also_confined(layout):
    client = _app(layout, auth_enabled=True).test_client()
    assert _refused(_structure(client, str(layout / "outside" / "secret.zarr")))


# --- allowed when hosted ----------------------------------------------------

def test_paths_inside_the_data_dir_are_allowed(hosted, layout):
    assert not _refused(_structure(hosted, str(layout / "data" / "inside.zarr")))
    assert not _refused(hosted.get("/api/v1/directories/list", query_string={"path": str(layout / "data")}))
    assert not _refused(hosted.get("/api/v1/directories/list", query_string={"path": "inside.zarr"}))


def test_allowed_dirs_extend_the_roots(layout):
    client = _app(layout, host="0.0.0.0", allowed_dirs=[str(layout / "outside")]).test_client()
    assert not _refused(_structure(client, str(layout / "data" / "link.zarr")))
    assert not _refused(_structure(client, str(layout / "outside" / "secret.zarr")))


def test_remote_urls_are_left_to_their_own_allowlist(hosted):
    for url in ("s3://bucket/x.zarr", "https://example.org/x.zarr", "http://example.org/x.zarr"):
        assert not _refused(_structure(hosted, url))


# --- local single-user mode browses freely ----------------------------------

def test_local_mode_is_unconfined(layout):
    client = _app(layout).test_client()
    assert not _refused(_structure(client, str(layout / "outside" / "secret.zarr")))
    assert not _refused(client.get("/api/v1/directories/list", query_string={"path": str(layout / "outside")}))


# --- the containment predicate itself -----------------------------------------

def test_is_inside(layout):
    roots = allowed_roots({"data_dir": str(layout / "data")})
    assert is_inside(str(layout / "data"), roots)
    assert is_inside(str(layout / "data" / "inside.zarr"), roots)
    assert not is_inside(str(layout / "data" / "link.zarr"), roots)
    assert not is_inside(str(layout / "data" / ".." / "outside"), roots)
    assert not is_inside("/", roots)
