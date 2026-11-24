"""A non-admin's Refresh of a large dataset is limited by ``limits.refresh_min_interval_large_s``.

Every Refresh makes every user read the dataset again (decision 44), so on a shared server a user may start one of a
dataset above ``limits.refresh_large_cells`` only once per ``limits.refresh_min_interval_large_s``; inside the window
the answer is ``scheduled`` (the walk runs at the window's end), with a sentence saying when. An admin, and any user of
a local server, keep ``server.refresh_min_interval_s``. The cells are counted from the store: the fixture has 200, so
a lowered ``refresh_large_cells`` makes it "large".
"""
import os

import pytest

from annzarro.core import freshness
from annzarro.core import zarr_reader
from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.tests.server.rich_store import make_rich_store

LARGE = {"refresh_large_cells": 1, "refresh_min_interval_large_s": 300}


def _app(tmp_path, limits, hosted=True):
    config = {"TESTING": True, "data_dir": str(tmp_path), "log_file": str(tmp_path / "t.log"),
              "refresh_min_interval_s": 0, "limits": limits}
    if hosted:
        users = tmp_path / "users.json"
        manager = AuthManager(user_file=str(users))
        manager.create_user("bob", "pw")
        manager.create_user("root", "pw", is_admin=True)
        config.update(host="127.0.0.1", auth_enabled=True, user_file=str(users))
    return create_app(config)


def _client(app, user=None):
    client = app.test_client()
    if user:
        client.post("/login", data={"username": user, "password": "pw"})
    return client


def _refresh(client, path):
    r = client.post("/api/v1/data/refresh", query_string={"dataset_path": path})
    assert r.status_code == 200, r.get_data(as_text=True)
    return r.get_json()


@pytest.fixture(autouse=True)
def cold():
    zarr_reader.clear_cache()
    yield
    zarr_reader.clear_cache()


def test_a_user_refresh_of_a_large_dataset_inside_the_interval_is_scheduled_not_run(tmp_path):
    path = make_rich_store(tmp_path / "r.zarr")
    bob = _client(_app(tmp_path, LARGE), "bob")
    assert _refresh(bob, path)["status"] == "full"
    gen = freshness.generation(path)
    again = _refresh(bob, path)
    assert again["status"] == "scheduled" and again["retry_after_s"] > 200
    assert "more than 1 cells" in again["message"] and "once every 300 s" in again["message"]
    assert freshness.generation(path) == gen, "nothing was started"


def test_an_admin_keeps_the_plain_interval(tmp_path):
    path = make_rich_store(tmp_path / "r.zarr")
    root = _client(_app(tmp_path, LARGE), "root")
    assert [_refresh(root, path)["status"] for _ in range(2)] == ["full", "full"]


def test_a_local_server_keeps_the_plain_interval(tmp_path):
    path = make_rich_store(tmp_path / "r.zarr")
    local = _client(_app(tmp_path, LARGE, hosted=False))
    assert [_refresh(local, path)["status"] for _ in range(2)] == ["full", "full"]


def test_a_dataset_below_the_served_cell_limit_is_not_large(tmp_path):
    """The limit is the served one: at its default (10 million cells) the 200 cell store is small."""
    path = make_rich_store(tmp_path / "r.zarr")
    app = _app(tmp_path, {"refresh_min_interval_large_s": 300})
    bob = _client(app, "bob")
    values = bob.get("/api/v1/policy/effective").get_json()["values"]
    assert values["limits.refresh_large_cells"] == 10_000_000 and values["limits.refresh_min_interval_large_s"] == 300
    assert [_refresh(bob, path)["status"] for _ in range(2)] == ["full", "full"]


def test_the_limits_come_from_the_served_values(tmp_path):
    app = _app(tmp_path, LARGE)
    values = _client(app, "bob").get("/api/v1/policy/effective").get_json()["values"]
    assert values["limits.refresh_large_cells"] == 1 and values["limits.refresh_min_interval_large_s"] == 300
