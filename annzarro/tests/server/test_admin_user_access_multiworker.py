"""A grant, a revoke and a restriction reach every gunicorn worker at once (design 9.7, propagation).

A hosted server with two workers; an administrator changes a user's access through the real
admin API (CSRF token, Origin, password window) and the user's requests, from fresh connections
that both workers answer, must show zero stale answers: a store is refused until it is granted,
read at once after, refused at once after the revoke, and everything is read again when the
restriction is lifted. A corrupt access.json refuses every non-administrator on both workers
and leaves the administrator working, and its repair is seen at once.
"""
import concurrent.futures
import json
import os
import shutil
import urllib.parse

import pytest

from annzarro.tests.server.multiworker_helpers import FIXTURE, start_cluster, stop_all

ROUNDS = 3
HAMMER = 96
THREADS = 8
ACCESS = "/api/v1/admin/users/alice"


def hammer(call, n=HAMMER):
    with concurrent.futures.ThreadPoolExecutor(max_workers=THREADS) as pool:
        return list(pool.map(lambda _: call(), range(n)))


@pytest.fixture
def cluster(tmp_path):
    procs = []
    try:
        cluster = start_cluster(tmp_path, workers=2, procs=procs)
        shutil.copytree(FIXTURE, tmp_path / "data" / "other.zarr")
        yield cluster
    finally:
        stop_all(procs)


def statuses(client, store):
    url = "/api/v1/data/info?dataset_path=" + urllib.parse.quote(store, safe="/")
    return {r.status for r in hammer(lambda: client.get(url))}


def both_workers_answer(client):
    pids = set()
    for _ in range(5):
        pids |= {r.json()["pid"] for r in hammer(lambda: client.get("/_test/overlay"))}
        if len(pids) == 2:
            return pids
    pytest.fail(f"only worker(s) {sorted(pids)} answered the requests")


def test_grant_revoke_and_restriction_reach_both_workers_at_once(cluster):
    admin, alice = cluster.client("root", admin_page=True), cluster.client("alice")
    both_workers_answer(alice)
    home, other = str(cluster.tmp_path / "data" / "home.zarr"), str(cluster.tmp_path / "data" / "other.zarr")
    assert statuses(alice, home) == {200} and statuses(alice, other) == {200}
    for _ in range(ROUNDS):
        assert admin.put(ACCESS + "/access", {"restricted": True}).status == 200
        assert statuses(alice, home) == {404} == statuses(alice, other), "a worker missed the restriction"

        granted = admin.post(ACCESS + "/grants", {"kind": "store", "path": home})
        assert granted.status == 201, granted.body
        assert statuses(alice, home) == {200}, "a worker still refused a granted store"
        assert statuses(alice, other) == {404}, "a worker read a store that was never granted"

        revoked = admin.delete(ACCESS + "/grants", {"path": home})
        assert revoked.status == 200, revoked.body
        assert statuses(alice, home) == {404}, "a worker still served a revoked grant"

        assert admin.put(ACCESS + "/access", {"restricted": False}).status == 200
        assert statuses(alice, home) == {200} and statuses(alice, other) == {200}, "a worker kept the restriction"


def test_the_check_tool_agrees_with_both_workers(cluster):
    admin, alice = cluster.client("root", admin_page=True), cluster.client("alice")
    both_workers_answer(alice)
    home = str(cluster.tmp_path / "data" / "home.zarr")
    assert admin.put(ACCESS + "/access", {"restricted": True}).status == 200
    assert admin.post(ACCESS + "/grants", {"kind": "store", "path": home}).status == 201
    query = "/api/v1/admin/access/check?user=alice&path=" + urllib.parse.quote(home, safe="/")
    assert {r.json()["allowed"] for r in hammer(lambda: admin.get(query))} == {True}
    assert admin.delete(ACCESS + "/grants", {"path": home}).status == 200
    assert {r.json()["allowed"] for r in hammer(lambda: admin.get(query))} == {False}
    assert statuses(alice, home) == {404}


def test_a_corrupt_access_file_refuses_every_user_on_both_workers_and_its_repair_is_seen_at_once(cluster):
    admin, alice = cluster.client("root", admin_page=True), cluster.client("alice")
    both_workers_answer(alice)
    home = str(cluster.tmp_path / "data" / "home.zarr")
    assert admin.put(ACCESS + "/access", {"restricted": True}).status == 200
    assert admin.post(ACCESS + "/grants", {"kind": "store", "path": home}).status == 201
    path = os.path.join(cluster.admin_dir, "access.json")
    saved = open(path).read()
    open(path, "w").write("{broken")
    assert statuses(alice, home) == {503}, "a worker guessed who is restricted"
    assert statuses(admin, home) == {200}, "an administrator must keep working"
    assert admin.put(ACCESS + "/access", {"restricted": False}).status == 503
    assert open(path).read() == "{broken", "an admin call replaced a file it could not read"
    open(path, "w").write(saved)
    assert statuses(alice, home) == {200}
    assert json.loads(open(path).read())["principals"]["user:alice"]["restricted"] is True
