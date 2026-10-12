"""An admin change reaches every gunicorn worker, end to end (admin slice 6, design sections 4 and 6).

A hosted server with two workers, signed in through the login page, changed
through the real admin API (CSRF token, Origin, password window and all). Each
test hammers the server with fresh connections right after a change, so both
workers answer, and requires zero stale answers:

* a data directory added by an admin is readable by an ordinary user at once,
  and refused at once after it is removed;
* a policy change shows in what /api/v1/policy/effective answers and in the
  Content-Security-Policy of the page;
* concurrent admin changes to different settings lose none of them, and the
  audit log written by both workers has gapless, unique sequence numbers and a
  chain that verifies.
"""
import concurrent.futures
import threading
import urllib.parse

import pytest

from annzarro.tests.server.multiworker_helpers import start_cluster, stop_all

ROUNDS = 3
HAMMER = 96
THREADS = 8


def hammer(call, n=HAMMER):
    """``call()`` n times from several threads at once, so that both workers are busy."""
    with concurrent.futures.ThreadPoolExecutor(max_workers=THREADS) as pool:
        return list(pool.map(lambda _: call(), range(n)))


@pytest.fixture
def cluster(tmp_path):
    procs = []
    try:
        yield start_cluster(tmp_path, workers=2, procs=procs)
    finally:
        stop_all(procs)


def _info(client, store):
    return client.get("/api/v1/data/info?dataset_path=" + urllib.parse.quote(store, safe="/"))


def both_workers_answer(client):
    """Precondition of every test here: the hammer reaches both workers (else
    it proves nothing about the other one). Fails after five rounds."""
    pids = set()
    for _ in range(5):
        pids |= {r.json()["pid"] for r in hammer(lambda: client.get("/_test/overlay"))}
        if len(pids) == 2:
            return pids
    pytest.fail(f"only worker(s) {sorted(pids)} answered 480 concurrent requests")


def test_an_added_data_directory_is_readable_at_once_and_refused_at_once_after_removal(cluster):
    admin = cluster.client("root", admin_page=True)
    user = cluster.client("alice")
    both_workers_answer(user)
    lab2 = str(cluster.parent / "lab2")
    store = lab2 + "/cells.zarr"
    for _ in range(ROUNDS):
        before = hammer(lambda: _info(user, store))
        assert {r.status for r in before} == {403}, "readable before it was added"
        assert {r.json()["reason"] for r in before} == {"outside_data_dir"}

        added = admin.post("/api/v1/admin/data-roots", {"path": lab2})
        assert added.status == 201, added.body
        answers = [r.status for r in hammer(lambda: _info(user, store))]
        assert set(answers) == {200}, f"a worker still refused the new directory: {sorted(set(answers))}"

        removed = admin.delete("/api/v1/admin/data-roots", {"path": lab2})
        assert removed.status == 200, removed.body
        answers = [r.status for r in hammer(lambda: _info(user, store))]
        assert set(answers) == {403}, f"a worker still read the removed directory: {sorted(set(answers))}"


def test_a_policy_change_reaches_the_effective_values_and_the_page_csp_of_both_workers(cluster):
    admin = cluster.client("root", admin_page=True)
    user = cluster.client("alice")

    def effective():
        reply = user.get("/api/v1/policy/effective")
        return reply.json(), reply.headers["X-AnnZarro-Policy"]

    both_workers_answer(user)
    first = hammer(effective)
    versions = {version for _, version in first}
    assert len(versions) == 1 and all(v["values"]["panel.gene-set.enabled"] for v, _ in first)
    csp = user.get("/").headers["Content-Security-Policy"]
    assert "https://mygene.info" in csp, csp

    changed = admin.put("/api/v1/admin/policy", {"panel.gene-set.enabled": False,
                                                  "panel.gene-set.external_requests": "none"})
    assert changed.status == 200, changed.body
    after = hammer(effective)
    assert all(body["values"]["panel.gene-set.enabled"] is False for body, _ in after), "a worker is stale"
    assert {v for _, v in after}.isdisjoint(versions), "a worker still sends the old policy version"
    assert len({v for _, v in after}) == 1, "the workers disagree about the policy version"
    for reply in hammer(lambda: user.get("/")):
        csp = reply.headers["Content-Security-Policy"]
        assert "https://" not in csp, f"a worker's page still allows an external host: {csp}"

    reset = admin.put("/api/v1/admin/policy", {"panel.gene-set.enabled": None,
                                                "panel.gene-set.external_requests": None})
    assert reset.status == 200, reset.body
    assert all(body["values"]["panel.gene-set.enabled"] for body, _ in hammer(effective))
    assert "https://mygene.info" in user.get("/").headers["Content-Security-Policy"]


def test_concurrent_changes_to_different_settings_lose_none_and_the_audit_chain_holds(cluster):
    admin = cluster.client("root", admin_page=True)
    both_workers_answer(cluster.client("alice"))
    keys = [f"panel.{t}.enabled" for t in ("cell-plot", "gene-plot", "cell-table", "gene-table", "gene-set")]

    def turn_off(key):
        return admin.put("/api/v1/admin/policy", {key: False}).status

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(keys)) as pool:
        statuses = list(pool.map(turn_off, keys))
    assert statuses == [200] * len(keys), statuses
    values = cluster.client("alice").get("/api/v1/policy/effective").json()["values"]
    assert [values[k] for k in keys] == [False] * len(keys), "a concurrent change was lost"

    # many more writes, from threads, through both workers
    def flip(i):
        return admin.put("/api/v1/admin/policy", {"panel.gene-set.links": bool(i % 2)}).status

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        assert set(pool.map(flip, range(24))) == {200}

    audit = admin.get("/api/v1/admin/audit?limit=500").json()
    assert audit["chain"]["ok"], audit["chain"]
    seqs = sorted(r["seq"] for r in audit["records"])
    assert seqs == list(range(seqs[0], seqs[0] + len(seqs))), "sequence numbers have a gap or a repeat"
    assert len(seqs) == len(set(seqs)) >= len(keys) + 24
    assert {r["action"] for r in audit["records"]} >= {"policy.update"}


def test_two_admins_demoting_each_other_at_once_leave_exactly_one(tmp_path):
    procs = []
    try:
        cluster = start_cluster(tmp_path, workers=2, procs=procs,
                                users=(("ann", True), ("ben", True), ("alice", False)))
        for round_ in range(3):
            ann = cluster.client("ann", admin_page=True)
            ben = cluster.client("ben", admin_page=True)
            both_workers_answer(cluster.client("alice"))
            barrier = threading.Barrier(2)

            def demote(client, target):
                barrier.wait()
                return client.post(f"/api/v1/admin/users/{target}/admin", {"is_admin": False})

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                replies = list(pool.map(lambda args: demote(*args), [(ann, "ben"), (ben, "ann")]))
            statuses = sorted(r.status for r in replies)
            assert statuses == [200, 409], (round_, statuses, [r.body for r in replies])
            refused = next(r for r in replies if r.status == 409)
            assert refused.json()["reason"] == "last_admin"
            survivor = ann if replies[0].status == 200 else ben   # ann's request demoted ben
            listed = survivor.get("/api/v1/admin/users")
            assert listed.status == 200, listed.body
            users = listed.json()
            assert sum(u["is_admin"] for u in users) == 1, users
            # give the demoted one their right back for the next round
            other = "ben" if survivor is ann else "ann"
            back = survivor.post(f"/api/v1/admin/users/{other}/admin", {"is_admin": True})
            assert back.status == 200, back.body
    finally:
        stop_all(procs)


def test_a_password_reset_ends_the_users_session_on_every_worker(cluster):
    admin = cluster.client("root", admin_page=True)
    alice = cluster.client("alice")
    both_workers_answer(alice)
    reset = admin.post("/api/v1/admin/users/alice/password", {"generate": True})
    assert reset.status == 200 and reset.json()["password"], reset.body
    answers = {r.status for r in hammer(lambda: alice.get("/api/v1/auth/me"))}
    assert answers <= {401, 302}, f"a worker still honoured the old session: {answers}"
