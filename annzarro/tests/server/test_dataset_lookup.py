"""
POST /api/v1/datasets/lookup answers the recently opened list: for each path the
entry /datasets/folder lists when the requester may read the store, else
``{path, status: "unavailable"}`` that is the same for a store that is not there
and one the requester may not read (routes/dataset_lookup.py).
"""
import os
import re
import shutil

import pytest
from flask.testing import FlaskClient

from annzarro.core import remote
from annzarro.server import access
from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.server.routes import data_routes, dataset_lookup
from annzarro.tests.server.rich_store import make_rich_store

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small.zarr")
PASSWORD = "pw-for-tests"
URL = "/api/v1/datasets/lookup"


def _app(tmp_path, **extra):
    config = {"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path / "data"),
              "log_file": str(tmp_path / "test.log"), "user_file": str(tmp_path / "users.json"),
              "secret_key": "test-only-secret"}
    config.update(extra)
    return create_app(config)


@pytest.fixture
def layout(tmp_path):
    data = tmp_path / "data"
    (data / "projects" / "liver").mkdir(parents=True)
    shutil.copytree(FIXTURE, data / "top.zarr")
    shutil.copytree(FIXTURE, data / "projects" / "liver" / "deep.zarr")
    (data / "projects" / "liver" / "broken.zarr").mkdir()
    (data / "plain").mkdir()
    outside = tmp_path / "outside"
    shutil.copytree(FIXTURE, outside / "secret.zarr")
    data_routes._LISTING_PROBE_CACHE.clear()
    dataset_lookup._remote_cache.clear()
    saved = remote._policy
    yield tmp_path
    remote._policy = saved
    data_routes._LISTING_PROBE_CACHE.clear()
    dataset_lookup._remote_cache.clear()


def _lookup(client, *paths):
    return client.post(URL, json={"paths": list(paths)})


def test_a_store_in_a_subfolder_and_one_at_the_top_come_back_as_listing_entries(layout):
    client = _app(layout).test_client()
    body = _lookup(client, "projects/liver/deep.zarr", "top.zarr", str(layout / "data" / "top.zarr")).get_json()
    deep, top, absolute = body["results"]
    assert deep["name"] == "deep.zarr" and deep["cells"] == 200 and deep["genes"] == 20
    assert deep["kind"] == "store" and deep["rel_path"] == os.path.join("projects", "liver", "deep.zarr")
    assert deep["path"] == str(layout / "data" / "projects" / "liver" / "deep.zarr")
    assert deep["format"].startswith("zarr format ") and deep["modified"] > 0
    assert top["rel_path"] == "top.zarr"
    assert absolute["path"] == top["path"]


def test_results_keep_the_order_and_a_missing_path_is_unavailable_as_sent(layout):
    client = _app(layout).test_client()
    body = _lookup(client, "nope.zarr", "top.zarr", "plain").get_json()["results"]
    assert body[0] == {"path": "nope.zarr", "status": "unavailable"}
    assert body[1]["name"] == "top.zarr"
    assert body[2] == {"path": "plain", "status": "unavailable"}, "a folder that is not a store is not a dataset"


def test_an_unreadable_store_keeps_its_row_with_the_reason(layout):
    entry = _lookup(_app(layout).test_client(), "projects/liver/broken.zarr").get_json()["results"][0]
    assert entry["error"] and entry["cells"] is None and "status" not in entry


def test_a_path_outside_the_data_directory_is_open_on_a_local_server_and_has_no_rel_path(layout):
    entry = _lookup(_app(layout).test_client(), str(layout / "outside" / "secret.zarr")).get_json()["results"][0]
    assert entry["cells"] == 200 and "rel_path" not in entry


def test_a_hosted_server_answers_a_path_outside_its_roots_as_a_missing_one(layout):
    client = _app(layout, host="0.0.0.0").test_client()
    outside = _lookup(client, str(layout / "outside" / "secret.zarr"), "../outside/secret.zarr").get_json()["results"]
    missing = _lookup(client, str(layout / "outside" / "nothing.zarr"), "../outside/nothing.zarr").get_json()["results"]
    assert [r["status"] for r in outside] == ["unavailable"] * 2
    assert [{k: v for k, v in r.items() if k != "path"} for r in outside] == \
        [{k: v for k, v in r.items() if k != "path"} for r in missing]


def test_the_list_is_capped_and_must_be_strings(layout):
    client = _app(layout).test_client()
    full = _lookup(client, *["top.zarr"] * dataset_lookup.MAX_PATHS)
    assert full.status_code == 200 and len(full.get_json()["results"]) == dataset_lookup.MAX_PATHS
    over = _lookup(client, *["top.zarr"] * (dataset_lookup.MAX_PATHS + 1))
    assert over.status_code == 400 and over.get_json()["reason"] == "cap_exceeded"
    assert over.get_json()["limit"] == dataset_lookup.MAX_PATHS
    for bad in ({"paths": "top.zarr"}, {"paths": [1]}, {"nope": []}, [], None):
        assert client.post(URL, json=bad).status_code == 400, bad
    assert client.post(URL, data="not json", content_type="text/plain").status_code == 400
    assert _lookup(client).get_json() == {"results": []}


def test_a_repeat_lookup_opens_no_store_again(layout, monkeypatch):
    client = _app(layout).test_client()
    _lookup(client, "top.zarr", "projects/liver/deep.zarr")
    opened = []
    real = data_routes.zarr_reader.get_basic_counts
    monkeypatch.setattr(data_routes.zarr_reader, "get_basic_counts", lambda p: (opened.append(p), real(p))[1])
    _lookup(client, "top.zarr", "projects/liver/deep.zarr")
    assert opened == [], "the stat-signature cache answers a repeat"


def test_a_path_with_a_nul_byte_is_unavailable(layout):
    assert _lookup(_app(layout).test_client(), "top\x00.zarr").get_json()["results"][0]["status"] == "unavailable"


# --- remote stores ---------------------------------------------------------------------

def _remote_client(layout, policy):
    """A client of an app whose remote policy is ``policy`` (the app sets the policy when it is created)."""
    client = _app(layout).test_client()
    remote.configure_remote_policy(policy)
    return client


def _fake_remote(monkeypatch, known):
    """Remote URLs in ``known`` open with the given (cells, genes); the others do not exist."""
    from annzarro import core
    opened = []

    def get_reader(path):
        if path in known:
            return None
        raise FileNotFoundError(path)

    def open_dataset_by_path(path, use_cache=True):
        opened.append(path)
        return None, {"shape": known[path]}

    monkeypatch.setattr(core, "get_reader", get_reader)
    monkeypatch.setattr(core.zarr_reader, "open_dataset_by_path", open_dataset_by_path)
    return opened


def test_a_remote_store_is_probed_once_and_kept(layout, monkeypatch):
    client = _remote_client(layout, {"remote_stores": "allow"})
    opened = _fake_remote(monkeypatch, {"s3://lab/pbmc.zarr": (900, 30)})
    first = _lookup(client, "s3://lab/pbmc.zarr", "s3://lab/gone.zarr").get_json()["results"]
    assert first[0]["cells"] == 900 and first[0]["genes"] == 30 and first[0]["remote"] is True
    assert first[0]["path"] == "s3://lab/pbmc.zarr" and first[0]["name"] == "pbmc.zarr"
    assert first[1] == {"path": "s3://lab/gone.zarr", "status": "unavailable"}
    _lookup(client, "s3://lab/pbmc.zarr")
    assert opened == ["s3://lab/pbmc.zarr"]


def test_a_remote_store_is_not_probed_where_remote_stores_are_off(layout, monkeypatch):
    client = _remote_client(layout, {"remote_stores": "deny"})
    opened = _fake_remote(monkeypatch, {"s3://lab/pbmc.zarr": (900, 30)})
    result = _lookup(client, "s3://lab/pbmc.zarr").get_json()["results"][0]
    assert result == {"path": "s3://lab/pbmc.zarr", "status": "unavailable"} and opened == []


def test_a_remote_store_outside_the_allowlist_is_unavailable(layout, monkeypatch):
    client = _remote_client(layout, {"remote_stores": "allow", "remote_allowlist": ["s3://lab-public/"]})
    opened = _fake_remote(monkeypatch, {"s3://other/x.zarr": (1, 1), "s3://lab-public/x.zarr": (2, 3)})
    found = _lookup(client, "s3://other/x.zarr", "s3://lab-public/x.zarr").get_json()["results"]
    assert found[0]["status"] == "unavailable" and found[1]["cells"] == 2
    assert opened == ["s3://lab-public/x.zarr"]


def test_remote_probes_per_request_are_capped(layout, monkeypatch):
    client = _remote_client(layout, {"remote_stores": "allow"})
    urls = {f"s3://lab/s{i}.zarr": (i + 1, 1) for i in range(dataset_lookup.MAX_REMOTE_PROBES + 3)}
    opened = _fake_remote(monkeypatch, urls)
    results = _lookup(client, *urls).get_json()["results"]
    assert len(opened) == dataset_lookup.MAX_REMOTE_PROBES
    assert [r.get("status") for r in results[-3:]] == ["unchecked"] * 3


# --- login, forged requests and restricted users ------------------------------------------

def _hosted(layout):
    manager = AuthManager(user_file=str(layout / "users.json"))
    for name, admin in {"alice": True, "bob": False, "carol": False}.items():
        manager.add_user(name, PASSWORD, is_admin=admin)
    make_rich_store(layout / "data" / "in.zarr")
    make_rich_store(layout / "data" / "out.zarr")
    make_rich_store(layout / "data" / "pub" / "p1.zarr")
    return _app(layout, auth_enabled=True)


def _signed_in(app, name):
    client = FlaskClient(app, app.response_class, use_cookies=True)
    page = client.get("/login").get_data(as_text=True)
    nonce = re.search(r'name="login_csrf" value="([^"]+)"', page).group(1)
    assert client.post("/login", data={"username": name, "password": PASSWORD, "login_csrf": nonce}).status_code == 302
    with client.session_transaction() as sess:
        client.csrf = sess["csrf"]
    return client


def _post(client, *paths, token=True, **headers):
    if token:
        headers["X-AnnZarro-CSRF"] = client.csrf
    return client.post(URL, json={"paths": list(paths)}, headers=headers)


def test_the_forgery_check_applies_and_an_anonymous_request_is_not_answered(layout):
    app = _hosted(layout)
    carol = _signed_in(app, "carol")
    assert _post(carol, "in.zarr").get_json()["results"][0]["cells"]
    forged = _post(carol, "in.zarr", token=False)
    assert forged.status_code == 403 and forged.get_json()["reason"] == "csrf_failed"
    assert _post(carol, "in.zarr", Origin="https://evil.example").status_code == 403
    anonymous = app.test_client()
    assert anonymous.post(URL, json={"paths": ["in.zarr"]}).status_code in (302, 401)


def test_a_restricted_user_gets_unavailable_for_what_they_may_not_read_exactly_as_for_what_is_missing(layout):
    app = _hosted(layout)
    data = str(layout / "data")
    access.add_grant(app.config, "bob", "store", f"{data}/in.zarr", actor="alice")
    access.add_grant(app.config, "bob", "dir", f"{data}/pub", actor="alice")
    access.set_restricted(app.config, "bob", True)
    bob = _signed_in(app, "bob")
    ask = ["in.zarr", "pub/p1.zarr", "out.zarr", "nothing.zarr", f"{data}/out.zarr", f"{data}/nothing.zarr",
           str(layout / "outside.zarr"), "../data/out.zarr"]
    results = _post(bob, *ask).get_json()["results"]
    assert results[0]["cells"] and results[1]["cells"]
    assert results[1]["rel_path"] == "pub/p1.zarr", "from the granted folder's name down, not above it"
    forbidden, missing = results[2:5:2], results[3:6:2]
    assert [r["status"] for r in results[2:]] == ["unavailable"] * 6
    assert [set(r) for r in forbidden + missing] == [{"path", "status"}] * 4
    assert {k: v for k, v in forbidden[0].items() if k != "path"} == {k: v for k, v in missing[0].items() if k != "path"}
    # an unrestricted user reads all of them but the ones that are not there
    carol = _signed_in(app, "carol")
    assert _post(carol, "out.zarr").get_json()["results"][0]["cells"]


def test_a_restricted_user_needs_a_remote_grant_to_see_a_remote_store(layout, monkeypatch):
    app = _hosted(layout)
    remote.configure_remote_policy({"remote_stores": "allow", "remote_allowlist": ["s3://lab-public/"]})
    opened = _fake_remote(monkeypatch, {"s3://lab-public/a.zarr": (5, 6), "s3://lab-public/b.zarr": (7, 8)})
    access.add_grant(app.config, "bob", "remote", "s3://lab-public/a.zarr", actor="alice")
    access.set_restricted(app.config, "bob", True)
    results = _post(_signed_in(app, "bob"), "s3://lab-public/a.zarr", "s3://lab-public/b.zarr").get_json()["results"]
    assert results[0]["cells"] == 5
    assert results[1] == {"path": "s3://lab-public/b.zarr", "status": "unavailable"}
    assert opened == ["s3://lab-public/a.zarr"], "a store the user may not read is never opened"
