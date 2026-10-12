"""The access admin endpoints: a user's restriction and grants, what they add up to, the check tool.

Who may call them, the CSRF token, what is refused (and that a refusal changes nothing), the
audit record of every change, two admins writing at once, a corrupt ``access.json``, and that a
change is the next request's truth for the restricted user (the gate itself is tested in
``test_access_*``).
"""
import json
import os
import shutil

import pytest

from annzarro.server import access
from annzarro.server.admin import audit, settings
from annzarro.server.auth import AuthManager
from annzarro.tests.server.admin_helpers import ADMIN, PASSWORD, USER, login, make_app, unsafe_headers

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small.zarr")
BASE = "/api/v1/admin"
BOB = "bob"


@pytest.fixture
def layout(tmp_path):
    """data/{in.zarr, out.zarr, pub/{p1.zarr, sub/p2.zarr, link -> ../out.zarr}}; outside/x.zarr is in no data directory."""
    data = tmp_path / "data"
    for name in ("in.zarr", "out.zarr", "pub/p1.zarr", "pub/sub/p2.zarr"):
        shutil.copytree(FIXTURE, data / name)
    os.symlink(data / "out.zarr", data / "pub" / "link.zarr")
    (data / "afile.txt").write_text("x")
    shutil.copytree(FIXTURE, tmp_path / "outside" / "x.zarr")
    return tmp_path


@pytest.fixture
def app(layout):
    app = make_app(layout, refresh_min_interval_s=0)
    AuthManager(user_file=app.config["user_file"]).create_user(BOB, PASSWORD)
    app.layout = layout
    return app


@pytest.fixture
def admin(app):
    return login(app, ADMIN)


def send(client, method, url, body):
    return client.open(BASE + url, method=method, data=json.dumps(body), headers=unsafe_headers(client))


def put_access(client, restricted, user=BOB):
    return send(client, "PUT", f"/users/{user}/access", {"restricted": restricted})


def grant(client, kind, path, user=BOB):
    return send(client, "POST", f"/users/{user}/grants", {"kind": kind, "path": str(path)})


def revoke(client, path, user=BOB):
    return send(client, "DELETE", f"/users/{user}/grants", {"path": str(path)})


def view(client, user=BOB, **query):
    return client.get(f"{BASE}/users/{user}/access", query_string=query)


def check(client, path, user=BOB):
    return client.get(f"{BASE}/access/check", query_string={"user": user, "path": str(path)})


def records(app, **match):
    return [r for r in audit.read(app.admin_dir, limit=500) if all(r.get(k) == v for k, v in match.items())]


def stored(app):
    with open(settings.access_path(app.config)) as fh:
        return json.load(fh)


def info(client, path):
    return client.get("/api/v1/data/info", query_string={"dataset_path": str(path)}).status_code


# --- who -------------------------------------------------------------------------

def calls(layout):
    d = layout / "data"
    return [("GET", f"/users/{BOB}/access", None), ("PUT", f"/users/{BOB}/access", {"restricted": True}),
            ("POST", f"/users/{BOB}/grants", {"kind": "dir", "path": str(d / "pub")}),
            ("DELETE", f"/users/{BOB}/grants", {"path": str(d / "pub")}),
            ("GET", "/access", None), ("GET", f"/access/check?user={BOB}&path={d}/in.zarr", None)]


def test_only_an_admin_reads_or_changes_access(app):
    anon, alice, root = app.test_client(), login(app, USER), login(app, ADMIN)
    for method, url, body in calls(app.layout):
        for client, status in ((anon, 401), (alice, 403)):
            response = send(client, method, url, body) if client is alice and body is not None \
                else client.open(BASE + url, method=method, json=body)
            assert response.status_code == status, (method, url, client is alice)
    assert not os.path.exists(settings.access_path(app.config)), "a refused request wrote access.json"
    assert records(app, action="access.grant") == []
    assert root.get(f"{BASE}/access").status_code == 200


def test_an_unsafe_call_needs_the_csrf_token(app, admin):
    for method, url, body in calls(app.layout):
        if method == "GET":
            continue
        response = admin.open(BASE + url, method=method, data=json.dumps(body),
                              headers={"Content-Type": "application/json"})
        assert response.status_code == 403 and response.get_json()["reason"] == "csrf_failed", (method, url)
        form = admin.open(BASE + url, method=method, data=body, headers={"X-AnnZarro-CSRF": unsafe_headers(admin)["X-AnnZarro-CSRF"]})
        assert form.status_code in (403, 415), (method, url)
    assert not os.path.exists(settings.access_path(app.config))


def test_every_call_answers_404_for_an_unknown_user(app, admin):
    for method, url, body in calls(app.layout):
        if url == "/access":
            continue        # the overview names no user
        url = url.replace(BOB, "nobody")
        response = admin.get(BASE + url) if method == "GET" else send(admin, method, url, body)
        assert response.status_code == 404 and response.get_json()["reason"] == "unknown_user", (method, url)
    assert not os.path.exists(settings.access_path(app.config))


# --- the default, and restricting ------------------------------------------------

def test_a_user_with_no_entry_sees_everything(app, admin):
    body = view(admin).get_json()
    assert body["restricted"] is False and body["all"] is True and body["grants"] == []
    assert body["stores"]["items"] == [] and body["policy_overrides"] == 0
    assert not os.path.exists(settings.access_path(app.config)), "reading created the file"


def test_restricting_with_no_grants_reads_nothing_and_unrestricting_restores_it(app, admin):
    bob = login(app, BOB)
    store = app.layout / "data" / "in.zarr"
    assert info(bob, store) == 200
    reply = put_access(admin, True)
    assert reply.status_code == 200 and reply.get_json()["restricted"] is True
    assert info(bob, store) == 404, "restricted with no grants must read nothing"
    assert view(admin).get_json()["all"] is False
    assert put_access(admin, False).get_json()["restricted"] is False
    assert info(bob, store) == 200
    assert "restricted" not in stored(app).get("principals", {}).get("user:bob", {})


def test_an_administrator_cannot_be_restricted(app, admin):
    reply = put_access(admin, True, user=ADMIN)
    assert reply.status_code == 409 and reply.get_json()["reason"] == "admin_unrestricted"
    assert not os.path.exists(settings.access_path(app.config))
    assert records(app, action="access.restrict", outcome="refused:admin_unrestricted")[0]["target"] == ADMIN
    assert put_access(admin, False, user=ADMIN).status_code == 200      # clearing it is harmless


@pytest.mark.parametrize("value", [None, "yes", 1, [], {}])
def test_restricted_must_be_a_boolean(app, admin, value):
    reply = send(admin, "PUT", f"/users/{BOB}/access", {"restricted": value})
    assert reply.status_code == 400 and reply.get_json()["reason"] == "bad_request"
    assert send(admin, "PUT", f"/users/{BOB}/access", {}).status_code == 400
    assert not os.path.exists(settings.access_path(app.config))


# --- grants ------------------------------------------------------------------------

def test_grant_then_the_restricted_user_reads_only_it_then_revoke(app, admin):
    bob, data = login(app, BOB), app.layout / "data"
    put_access(admin, True)
    reply = grant(admin, "dir", data / "pub")
    assert reply.status_code == 201
    added = reply.get_json()["added"]
    assert [(g["kind"], g["path"], g["added_by"]) for g in added] == [("dir", str(data / "pub"), ADMIN)]
    assert grant(admin, "store", data / "in.zarr").status_code == 201
    assert info(bob, data / "in.zarr") == 200 and info(bob, data / "pub" / "p1.zarr") == 200
    assert info(bob, data / "pub" / "sub" / "p2.zarr") == 200
    assert info(bob, data / "out.zarr") == 404
    assert info(bob, data / "pub" / "link.zarr") == 404, "a link leading out of a granted folder is not covered"

    body = view(admin).get_json()
    assert [(g["kind"], g["active"]) for g in body["grants"]] == [("dir", True), ("store", True)]
    assert all(g["real"] and g["added_at"] for g in body["grants"])

    removed = revoke(admin, data / "pub").get_json()["removed"]
    assert removed == [{"kind": "dir", "path": str(data / "pub")}]
    assert info(bob, data / "pub" / "p1.zarr") == 404, "the next read after a revoke must be refused"
    assert info(bob, data / "in.zarr") == 200
    assert revoke(admin, data / "in.zarr").status_code == 200
    assert info(bob, data / "in.zarr") == 404
    assert view(admin).get_json()["grants"] == [] and view(admin).get_json()["restricted"] is True


def test_the_effective_stores_follow_the_grants_and_the_fence(app, admin):
    data = app.layout / "data"
    put_access(admin, True)
    grant(admin, "dir", data / "pub")
    grant(admin, "store", data / "in.zarr")
    stores = view(admin).get_json()["stores"]
    assert stores["capped"] is False and stores["total"] == 3
    assert sorted(i["name"] for i in stores["items"]) == ["in.zarr", "p1.zarr", "p2.zarr"], \
        "the link to out.zarr leaves the granted folder and is not counted"
    page = view(admin, offset=1, limit=1).get_json()["stores"]
    assert page["total"] == 3 and len(page["items"]) == 1 and page["offset"] == 1
    assert view(admin, limit="x").status_code == 400
    assert len(view(admin, limit=0).get_json()["stores"]["items"]) == 1      # clamped to one, not an error


@pytest.mark.parametrize("kind, path, status, reason", [
    ("folder", "{d}/pub", 400, "bad_kind"),
    (None, "{d}/pub", 400, "bad_kind"),
    ("dir", "{d}/nothing", 404, "not_found"),
    ("dir", "{o}/outside", 403, "outside_data_roots"),
    ("store", "{o}/outside/x.zarr", 403, "outside_data_roots"),
    ("dir", "{d}/afile.txt", 400, "not_a_directory"),
    ("remote", "s3://lab-public/pbmc/", 403, "remote_not_allowed"),
    ("remote", "ftp://elsewhere/x/", 400, "bad_path"),
])
def test_a_grant_that_cannot_be_given_is_refused_and_changes_nothing(app, admin, kind, path, status, reason):
    path = path.format(d=app.layout / "data", o=app.layout)
    put_access(admin, True)
    before = stored(app)
    reply = send(admin, "POST", f"/users/{BOB}/grants", {"kind": kind, "path": path})
    assert reply.status_code == status and reply.get_json()["reason"] == reason, reply.get_json()
    assert stored(app) == before
    assert records(app, action="access.grant", outcome="refused:" + reason)[-1]["target"] == BOB


@pytest.mark.parametrize("body", [{"kind": "dir"}, {"kind": "dir", "path": ""}, {"kind": "dir", "path": 5},
                                  {"kind": "dir", "path": "a\0b"}, {"kind": "dir", "path": "x" * 5000}, []])
def test_a_grant_needs_a_usable_path(app, admin, body):
    reply = send(admin, "POST", f"/users/{BOB}/grants", body)
    assert reply.status_code == 400 and reply.get_json()["reason"] == "bad_request"
    assert not os.path.exists(settings.access_path(app.config))


def test_granting_twice_is_a_conflict(app, admin):
    path = app.layout / "data" / "pub"
    assert grant(admin, "dir", path).status_code == 201
    again = grant(admin, "dir", path)
    assert again.status_code == 409 and again.get_json()["reason"] == "already_granted"
    assert len(stored(app)["principals"]["user:bob"]["grants"]) == 1


def test_a_relative_or_dotted_spelling_is_stored_absolute_and_confined(app, admin):
    data = app.layout / "data"
    reply = grant(admin, "dir", f"{data}/pub/../pub")
    assert reply.status_code == 201
    assert reply.get_json()["added"][0]["path"] == str(data / "pub")
    assert grant(admin, "dir", f"{data}/pub/../../outside").status_code == 403


def test_revoking_what_was_never_granted_is_404(app, admin):
    grant(admin, "dir", app.layout / "data" / "pub")
    before = stored(app)
    reply = revoke(admin, app.layout / "data" / "in.zarr")
    assert reply.status_code == 404 and reply.get_json()["reason"] == "not_found"
    assert stored(app) == before
    assert send(admin, "DELETE", f"/users/{BOB}/grants", {}).status_code == 400
    assert records(app, action="access.revoke", outcome="refused:not_found")


def test_stores_in_grants_one_store_each_and_skips_a_link_that_leaves_the_data_directories(app, admin):
    data = app.layout / "data"
    curated = data / "curated"
    curated.mkdir()
    os.symlink(data / "in.zarr", curated / "a.zarr")
    os.symlink(app.layout / "outside" / "x.zarr", curated / "escape.zarr")
    put_access(admin, True)
    reply = send(admin, "POST", f"/users/{BOB}/grants", {"kind": "stores_in", "path": str(curated)})
    assert reply.status_code == 201
    body = reply.get_json()
    assert [(g["kind"], os.path.basename(g["path"])) for g in body["added"]] == [("store", "a.zarr")]
    assert [s["reason"] for s in body["skipped"]] == ["outside_data_roots"]
    grants = stored(app)["principals"]["user:bob"]["grants"]
    assert [g["kind"] for g in grants] == ["store"]
    bob = login(app, BOB)
    assert info(bob, data / "in.zarr") == 200 and info(bob, app.layout / "outside" / "x.zarr") == 404
    again = send(admin, "POST", f"/users/{BOB}/grants", {"kind": "stores_in", "path": str(curated)}).get_json()
    assert again["added"] == [] and [s["reason"] for s in again["skipped"]].count("already_granted") == 1


def test_stores_in_is_bounded(app, admin):
    app.config["dataset_folder_max_entries"] = 1
    reply = send(admin, "POST", f"/users/{BOB}/grants", {"kind": "stores_in", "path": str(app.layout / "data")})
    assert reply.status_code == 400 and reply.get_json()["reason"] == "too_many"
    assert not os.path.exists(settings.access_path(app.config))


def test_stores_in_a_missing_folder_is_404(app, admin):
    reply = send(admin, "POST", f"/users/{BOB}/grants", {"kind": "stores_in", "path": str(app.layout / "data" / "nope")})
    assert reply.status_code == 404 and reply.get_json()["reason"] == "not_found"


@pytest.fixture
def remote_policy():
    """Remote stores allowed under one prefix. The policy is process-wide: restored afterwards."""
    from annzarro.core import remote
    saved = remote._policy
    remote.configure_remote_policy({"remote_stores": "allow", "remote_allowlist": ["s3://lab-public/"]})
    yield
    remote._policy = saved


def test_a_remote_prefix_is_granted_checked_and_revoked(app, admin, remote_policy):
    put_access(admin, True)
    reply = grant(admin, "remote", "S3://Lab-Public/pbmc")
    assert reply.status_code == 201 and reply.get_json()["added"][0]["path"] == "s3://lab-public/pbmc/"
    assert view(admin).get_json()["remote_prefixes"] == 1
    inside = check(admin, "s3://lab-public/pbmc/a.zarr").get_json()
    assert inside["allowed"] is True and inside["via"] == {"kind": "remote", "path": "s3://lab-public/pbmc/"}
    assert check(admin, "s3://lab-public/pbmc2/a.zarr").get_json()["allowed"] is False
    assert revoke(admin, "s3://lab-public/pbmc/").status_code == 200
    assert check(admin, "s3://lab-public/pbmc/a.zarr").get_json()["allowed"] is False


# --- the audit log -------------------------------------------------------------------

def test_every_change_is_audited_with_who_what_and_to_whom(app, admin):
    data = app.layout / "data"
    put_access(admin, True)
    grant(admin, "dir", data / "pub")
    revoke(admin, data / "pub")
    put_access(admin, False)
    done = {(r["action"], r["target"], r["actor"], r["outcome"]) for r in audit.read(app.admin_dir, limit=500)}
    for action in ("access.restrict", "access.grant", "access.revoke", "access.unrestrict"):
        assert (action, BOB, ADMIN, "ok") in done, action
    grant_record = records(app, action="access.grant")[0]
    assert grant_record["detail"]["kind"] == "dir" and grant_record["detail"]["path"] == str(data / "pub")
    assert audit.verify(app.admin_dir)["ok"]


def test_reading_writes_no_audit_record(app, admin):
    view(admin)
    check(admin, app.layout / "data" / "in.zarr")
    admin.get(f"{BASE}/access")
    assert [r for r in records(app) if r["action"].startswith("access.")] == []


# --- two admins, and the policy that lives in the same entry ----------------------

def test_the_last_writer_wins_and_no_write_is_lost(app, admin):
    other = login(app, ADMIN)
    data = app.layout / "data"
    assert put_access(admin, True).status_code == 200
    assert grant(other, "dir", data / "pub").status_code == 201
    assert put_access(other, False).status_code == 200
    assert put_access(admin, True).status_code == 200                        # the last word on the flag
    assert grant(admin, "store", data / "in.zarr").status_code == 201
    entry = stored(app)["principals"]["user:bob"]
    assert entry["restricted"] is True
    assert [g["path"] for g in entry["grants"]] == [str(data / "pub"), str(data / "in.zarr")], \
        "a grant given while the flag changed was lost"


def test_changes_keep_the_users_policy_overrides_and_other_users(app, admin):
    data = app.layout / "data"
    AuthManager(user_file=app.config["user_file"]).create_user("carol", PASSWORD)
    settings.update_user_policy(app.config, BOB, lambda s: (None, {"outbound.allow_external": False}))
    grant(admin, "dir", data / "pub", user="carol")
    put_access(admin, True)
    grant(admin, "dir", data / "pub")
    revoke(admin, data / "pub")
    put_access(admin, False)
    principals = stored(app)["principals"]
    assert principals["user:bob"] == {"policy": {"outbound.allow_external": False}}
    assert [g["path"] for g in principals["user:carol"]["grants"]] == [str(data / "pub")]
    assert view(admin).get_json()["policy_overrides"] == 1


def test_removing_a_user_drops_their_entry_and_a_namesake_starts_unrestricted(app, admin):
    put_access(admin, True)
    grant(admin, "dir", app.layout / "data" / "pub")
    assert send(admin, "DELETE", f"/users/{BOB}", {}).status_code == 200
    assert "user:bob" not in stored(app).get("principals", {})
    AuthManager(user_file=app.config["user_file"]).create_user(BOB, PASSWORD)
    assert view(admin).get_json()["restricted"] is False


# --- the overview ---------------------------------------------------------------------

def test_the_overview_counts_per_user_and_names_who_is_granted_each_data_directory(app, admin):
    data = app.layout / "data"
    put_access(admin, True)
    grant(admin, "dir", data / "pub")
    grant(admin, "store", data / "in.zarr")
    body = admin.get(f"{BASE}/access").get_json()
    assert body["store"]["ok"] is True
    assert body["users"][BOB] == {"restricted": True, "is_admin": False, "grants": 2, "active": 2, "policy_overrides": 0}
    assert body["users"][USER]["restricted"] is False and body["users"][ADMIN]["restricted"] is False
    assert body["roots"] == {os.path.realpath(data): [BOB]}


def test_an_inactive_grant_is_listed_but_not_attributed_to_a_root(app, admin):
    os.makedirs(os.path.dirname(settings.access_path(app.config)), exist_ok=True)
    gone = str(app.layout / "outside" / "x.zarr")
    with open(settings.access_path(app.config), "w") as fh:
        json.dump({"version": 1, "principals": {"user:bob": {"restricted": True, "grants": [
            {"kind": "store", "path": gone, "added_by": "old", "added_at": "2026-01-01T00:00:00"}]}}}, fh)
    body = view(admin).get_json()
    assert body["grants"][0]["active"] is False and body["grants"][0]["inactive_reason"] == "outside_data_directories"
    assert body["stores"]["items"] == []
    overview = admin.get(f"{BASE}/access").get_json()
    assert overview["users"][BOB]["grants"] == 1 and overview["users"][BOB]["active"] == 0
    assert overview["roots"] == {}


# --- the check tool ---------------------------------------------------------------------

def test_check_says_allowed_via_which_grant_or_why_not(app, admin):
    data = app.layout / "data"
    put_access(admin, True)
    grant(admin, "dir", data / "pub")
    inside = check(admin, data / "pub" / "sub" / "p2.zarr").get_json()
    assert inside["allowed"] is True and inside["via"] == {"kind": "dir", "path": str(data / "pub")}
    assert "folder" in inside["reason"]
    outside = check(admin, data / "in.zarr").get_json()
    assert outside["allowed"] is False and outside["via"] is None and "No active grant" in outside["reason"]
    link = check(admin, data / "pub" / "link.zarr").get_json()
    assert link["allowed"] is False, "a link leading out of a granted folder is not covered"
    assert records(app, action="access.check") == []


def test_check_agrees_with_the_gate_for_every_path(app, admin):
    data = app.layout / "data"
    put_access(admin, True)
    grant(admin, "dir", data / "pub")
    grant(admin, "store", data / "in.zarr")
    bob = login(app, BOB)
    for path in (data / "in.zarr", data / "out.zarr", data / "pub" / "p1.zarr", data / "pub" / "link.zarr",
                 data / "pub" / "sub" / "p2.zarr", data / "pub" / ".." / "out.zarr", data / "pub2"):
        said = check(admin, path).get_json()["allowed"]
        assert said == (info(bob, path) == 200) or not os.path.exists(path), path


def test_check_for_an_unrestricted_user_and_an_administrator(app, admin):
    data = app.layout / "data"
    free = check(admin, data / "out.zarr").get_json()
    assert free["allowed"] is True and free["via"] is None and "not restricted" in free["reason"]
    stray = check(admin, app.layout / "outside" / "x.zarr").get_json()
    assert stray["allowed"] is False and "outside every data directory" in stray["reason"]
    boss = check(admin, data / "out.zarr", user=ADMIN).get_json()
    assert boss["allowed"] is True and "Administrators" in boss["reason"]


def test_check_names_an_inactive_grant_that_would_have_covered_it(app, admin):
    data = app.layout / "data"
    with open(os.path.join(app.admin_dir, "access.json"), "w") as fh:
        json.dump({"version": 1, "principals": {"user:bob": {"restricted": True, "grants": [
            {"kind": "dir", "path": str(app.layout / "outside"), "added_by": "old"}]}}}, fh)
    said = check(admin, app.layout / "outside" / "x.zarr").get_json()
    assert said["allowed"] is False and "inactive" in said["reason"] and "outside_data_directories" in said["reason"]
    assert data.exists()


@pytest.mark.parametrize("query, status", [
    ({"user": BOB}, 400), ({"user": BOB, "path": ""}, 400), ({"user": BOB, "path": "relative/x.zarr"}, 400),
    ({"user": BOB, "path": "file:///etc/passwd"}, 400), ({"user": BOB, "path": "a\0b"}, 400),
    ({"user": BOB, "path": "/" + "x" * 5000}, 400), ({"path": "/x"}, 404), ({"user": "nobody", "path": "/x"}, 404),
])
def test_check_validates_its_input(app, admin, query, status):
    assert admin.get(f"{BASE}/access/check", query_string=query).status_code == status


# --- a corrupt access.json ------------------------------------------------------------

def test_a_corrupt_access_file_is_reported_never_replaced_and_fails_closed(app, admin):
    path = settings.access_path(app.config)
    put_access(admin, True)
    grant(admin, "dir", app.layout / "data" / "pub")
    with open(path, "w") as fh:
        fh.write("{broken")
    for response in (view(admin), put_access(admin, False), grant(admin, "dir", app.layout / "data" / "pub"),
                     revoke(admin, app.layout / "data" / "pub")):
        assert response.status_code == 503 and response.get_json()["reason"] == "store_unreadable"
    assert open(path).read() == "{broken", "an admin call replaced a file it could not read"

    overview = admin.get(f"{BASE}/access")
    assert overview.status_code == 200 and overview.get_json()["store"]["ok"] is False
    assert overview.get_json()["users"][BOB]["restricted"] is None, "an unreadable file must not be read as 'unrestricted'"

    said = check(admin, app.layout / "data" / "in.zarr").get_json()
    assert said["allowed"] is False and "unreadable" in said["reason"]
    assert check(admin, app.layout / "data" / "in.zarr", user=ADMIN).get_json()["allowed"] is True
    bob = login(app, BOB)
    assert info(bob, app.layout / "data" / "in.zarr") == 503, "the data routes must refuse every non-admin"
    assert info(admin, app.layout / "data" / "in.zarr") == 200


def test_a_wrongly_shaped_entry_is_not_overwritten(app, admin):
    path = settings.access_path(app.config)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump({"version": 1, "principals": {"user:bob": ["not", "an", "entry"]}}, fh)
    before = open(path).read()
    reply = put_access(admin, True)
    assert reply.status_code == 503 and reply.get_json()["reason"] == "store_unreadable"
    assert open(path).read() == before


# --- the shell contract ---------------------------------------------------------------------

def test_responses_are_not_cached(app, admin):
    for response in (view(admin), admin.get(f"{BASE}/access"), check(admin, app.layout / "data" / "in.zarr")):
        assert "no-store" in response.headers.get("Cache-Control", "")


def test_the_new_routes_are_registered_as_admin_routes(app):
    rules = {(r.rule, m) for r in app.url_map.iter_rules() for m in r.methods if r.rule.startswith(BASE)}
    for method, url in (("GET", "/access"), ("GET", "/access/check"), ("GET", "/users/<username>/access"),
                        ("PUT", "/users/<username>/access"), ("POST", "/users/<username>/grants"),
                        ("DELETE", "/users/<username>/grants")):
        assert (BASE + url, method) in rules, (method, url)
    assert access.GRANT_KINDS == ("dir", "store", "remote")
