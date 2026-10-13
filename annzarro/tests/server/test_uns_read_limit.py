"""A uns member is not read whole when it would not fit the read limit.

The uns routes read an array whole, build nested Python lists and serialise
them: 10 million float64 values (76 MB on disk) answered a 193 MB reply and
raised the process by about 900 MB, for any client, in about 3 s of CPU. Only
pairwise matrices were sized first. A uns member is now sized from its shape
and dtype and refused over server.max_read_mb (413 read_too_large), and the
read counts against the in-flight budget.
"""
import os
import shutil

import numpy as np
import pytest
import zarr

from annzarro.core import read_guard
from annzarro.server.core import create_app
from annzarro.tests.zarr_compat import drop_consolidated, has_consolidated

FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small.zarr")


def _array(group, name, **kw):
    if hasattr(group, "create_array"):
        return group.create_array(name, **kw)
    return group.create_dataset(name, **kw)


@pytest.fixture
def served(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    store = str(data / "a.zarr")
    shutil.copytree(FIXTURE, store)
    # the members added below are not in the consolidated listing (.zmetadata in format 2, inside the
    # root zarr.json in format 3), and a reader trusts that listing
    if has_consolidated(store):
        drop_consolidated(store)
    root = zarr.open_group(store, mode="r+")
    uns = root["uns"] if "uns" in root else root.create_group("uns")
    _array(uns, "small", shape=(100,), chunks=(100,), dtype="float64")[:] = np.arange(100.0)
    # 400,000 values: 3.2 MB on disk, about 40 MB as a JSON reply
    _array(uns, "wide", shape=(400_000,), chunks=(100_000,), dtype="float64")[:] = 1.0
    group = uns.create_group("nested")
    _array(group, "inner", shape=(400_000,), chunks=(100_000,), dtype="float64")[:] = 2.0
    app = create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False, "data_dir": str(data),
                      "cache_enabled": False, "max_read_mb": 8})
    yield app.test_client(), store
    read_guard.configure()


def _uns(client, store, key):
    return client.get(f"/api/v1/data/uns/{key}", query_string={"dataset_path": store})


def test_a_member_over_the_limit_is_refused_before_it_is_read(served):
    client, store = served
    reply = _uns(client, store, "wide")
    assert reply.status_code == 413, reply.get_json()
    body = reply.get_json()
    assert body["reason"] == "read_too_large" and body["limit_name"] == "max_read_mb"
    assert body["limit_mb"] == 8 and body["requested_mb"] > 8
    assert body["elements"][0]["element"] == "uns/wide" and "max_read_mb" in body["error"]


def test_a_group_is_sized_by_everything_in_it(served):
    client, store = served
    assert _uns(client, store, "nested").status_code == 413
    assert _uns(client, store, "nested/inner").status_code == 413


def test_a_small_member_is_unchanged(served):
    client, store = served
    reply = _uns(client, store, "small")
    assert reply.status_code == 200 and reply.get_json()["data"] == [float(i) for i in range(100)]


@pytest.mark.parametrize("url", [
    "/api/v1/datasets/uns/wide?dataset_path={store}",
    "/api/v1/datasets/a.zarr/uns/wide",
])
def test_the_other_uns_routes_answer_the_same(served, url):
    client, store = served
    reply = client.get(url.format(store=store))
    assert reply.status_code == 413, (url, reply.get_data()[:200])
    assert reply.get_json()["reason"] == "read_too_large"


def test_a_read_in_flight_holds_the_budget(served):
    client, store = served
    read_guard.configure(max_mb=8, budget_mb=8, wait_s=0.05)
    with read_guard.admit(read_guard.budget_bytes()):
        reply = _uns(client, store, "small")
    assert reply.status_code == 503 and reply.get_json()["reason"] == "read_busy"


# --- strings: their length is in the data, not in the metadata ------------------------------------

import random
import string


def _text(n):
    rng = random.Random(7)
    return "".join(rng.choice(string.ascii_letters) for _ in range(n))     # does not compress away


@pytest.fixture
def served_strings(tmp_path):
    """Strings 2 to 3 times the 1 MB limit, in the two shapes an undercount missed:
    one huge scalar, and a few huge elements of a short array."""
    data = tmp_path / "data"
    data.mkdir()
    store = str(data / "a.zarr")
    shutil.copytree(FIXTURE, store)
    consolidated = os.path.join(store, ".zmetadata")
    if os.path.exists(consolidated):
        os.remove(consolidated)
    root = zarr.open_group(store, mode="r+")
    uns = root["uns"] if "uns" in root else root.create_group("uns")
    _array(uns, "bigstr", shape=(), dtype=str)[()] = _text(3_000_000)
    arr = _array(uns, "strarr", shape=(4,), chunks=(1,), dtype=str)
    arr[:] = np.array([_text(600_000) for _ in range(4)], dtype=object)
    _array(uns, "names", shape=(50,), chunks=(50,), dtype=str)[:] = np.array([f"name_{i}" for i in range(50)], dtype=object)
    app = create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False, "data_dir": str(data),
                      "cache_enabled": False, "max_read_mb": 1})
    yield app.test_client(), store
    read_guard.configure()


@pytest.mark.parametrize("key", ["bigstr", "strarr"])
def test_a_string_member_over_the_limit_is_refused_by_its_real_length(served_strings, key):
    """Estimated by element count (1 and 4 elements x 160 B) these passed with a 3 MB and a 2.4 MB reply."""
    client, store = served_strings
    reply = _uns(client, store, key)
    assert reply.status_code == 413, (key, reply.status_code, reply.get_data()[:200])
    body = reply.get_json()
    assert body["reason"] == "read_too_large" and body["elements"][0]["element"] == f"uns/{key}"
    assert "max_read_mb" in body["error"]


def test_a_short_string_array_is_unchanged(served_strings):
    client, store = served_strings
    reply = _uns(client, store, "names")
    assert reply.status_code == 200 and reply.get_json()["data"] == [f"name_{i}" for i in range(50)]


def test_a_refused_string_read_holds_nothing_in_the_budget(served_strings):
    client, store = served_strings
    assert _uns(client, store, "bigstr").status_code == 413
    assert read_guard.in_flight_bytes() == 0
