"""
The model of per-user access (annzarro/server/access.py): what ``may_read`` says
about a path, how grants are resolved and written, and what happens when
``access.json`` cannot be trusted.

HTTP behaviour over every route is in ``test_access_matrix_real.py``, listings
in ``test_access_listings.py``, panel sets in ``test_access_panelsets.py`` and
propagation across workers in ``test_access_propagation.py``.
"""
import json
import os
import unicodedata

import pytest

from annzarro.server import access, atomic_store
from annzarro.server.admin import settings
from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.tests.server.rich_store import make_rich_store

PASSWORD = "pw-for-tests"
USERS = {"alice": True, "bob": False, "carol": False}


@pytest.fixture
def world(tmp_path):
    """data/{a, ab, a/x.zarr, ab/y.zarr, solo.zarr} beside an outside directory, an app and its users."""
    data = tmp_path / "data"
    make_rich_store(data / "a" / "x.zarr")
    make_rich_store(data / "ab" / "y.zarr")
    make_rich_store(data / "solo.zarr")
    make_rich_store(data / "other.zarr")
    outside = tmp_path / "outside"
    make_rich_store(outside / "z.zarr")
    manager = AuthManager(user_file=str(tmp_path / "users.json"))
    for name, admin in USERS.items():
        manager.add_user(name, PASSWORD, is_admin=admin)
    app = create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(data),
                      "log_file": str(tmp_path / "t.log"), "auth_enabled": True,
                      "user_file": str(tmp_path / "users.json"), "secret_key": "test-only-secret"})
    app.world = type("World", (), {"data": str(data), "outside": str(outside), "tmp": tmp_path})()
    return app


def grant(app, kind, path, user="bob", restrict=True):
    stored = access.add_grant(app.config, user, kind, path, actor="alice")
    if restrict:
        access.set_restricted(app.config, user, True)
    return stored


def reads(app, user, path):
    """``may_read`` inside a request context, as the routes call it."""
    with app.test_request_context("/"):
        return access.may_read(user, path)


def client(app, name=None):
    c = app.test_client()
    if name:
        assert c.post("/login", data={"username": name, "password": PASSWORD}).status_code == 302
    return c


# --- the default, and who is restricted ----------------------------------------------

def test_nobody_is_restricted_by_default(world):
    with world.test_request_context("/"):
        for user in USERS:
            assert not access.is_restricted(user)
            assert access.may_read(user, f"{world.world.data}/solo.zarr")
            assert access.may_read(user, f"{world.world.outside}/z.zarr")   # confinement's job, not the grants'


def test_restricted_false_null_or_absent_is_unrestricted_and_anything_else_restricts(world):
    path = settings.access_path(world.config)
    for flag, expected in ((False, False), (None, False), (True, True), ("false", True), (0, True), ("", True), ([], True)):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        atomic_store.write_json(path, {"version": 1, "principals": {"user:bob": {"restricted": flag}}})
        with world.test_request_context("/"):
            assert access.is_restricted("bob") is expected, flag


def test_a_restricted_user_with_no_grants_reads_nothing(world):
    access.set_restricted(world.config, "bob", True)
    assert not reads(world, "bob", f"{world.world.data}/solo.zarr")
    assert not reads(world, "bob", f"{world.world.data}")


def test_an_admin_is_never_restricted(world):
    grant(world, "dir", f"{world.world.data}/a", user="alice")
    assert reads(world, "alice", f"{world.world.data}/solo.zarr")


def test_principals_of_is_the_user_alone(world):
    assert access.principals_of("bob") == ["user:bob"]


def test_other_fields_of_the_entry_survive_every_change(world):
    path = settings.access_path(world.config)
    settings.update_user_policy(world.config, "bob", lambda stored: (None, {"outbound.allow_external": False}))
    grant(world, "dir", f"{world.world.data}/a")
    access.set_restricted(world.config, "bob", False)
    entry = json.load(open(path))["principals"]["user:bob"]
    assert entry["policy"] == {"outbound.allow_external": False} and len(entry["grants"]) == 1
    # and the policy change keeps the grants
    settings.update_user_policy(world.config, "bob", lambda stored: (None, {}))
    entry = json.load(open(path))["principals"]["user:bob"]
    assert "policy" not in entry and len(entry["grants"]) == 1


# --- may_read on paths -------------------------------------------------------------------

def test_a_dir_grant_covers_its_subtree_and_a_store_grant_its_store(world):
    data = world.world.data
    grant(world, "dir", f"{data}/a")
    grant(world, "store", f"{data}/solo.zarr")
    for path in (f"{data}/a", f"{data}/a/x.zarr", f"{data}/a/x.zarr/X", f"{data}/solo.zarr", f"{data}/solo.zarr/obs/x"):
        assert reads(world, "bob", path), path
    for path in (data, f"{data}/other.zarr", f"{data}/ab", f"{data}/ab/y.zarr", "/", world.world.outside):
        assert not reads(world, "bob", path), path


def test_a_grant_prefix_collision_is_not_containment(world):
    data = world.world.data
    grant(world, "dir", f"{data}/a")
    assert reads(world, "bob", f"{data}/a/x.zarr")
    assert not reads(world, "bob", f"{data}/ab/y.zarr")
    assert not reads(world, "bob", f"{data}/ab")


def test_dotdot_url_tricks_and_trailing_slash(world):
    data = world.world.data
    grant(world, "dir", f"{data}/a")
    assert reads(world, "bob", f"{data}/a/")
    assert reads(world, "bob", f"{data}/a/./x.zarr")
    assert reads(world, "bob", f"{data}/ab/../a/x.zarr")
    assert not reads(world, "bob", f"{data}/a/../ab/y.zarr")
    assert not reads(world, "bob", f"{data}/a/x.zarr/../../solo.zarr")
    assert not reads(world, "bob", f"{data}/a%2f..%2fsolo.zarr")      # no such name: the percent signs are literal
    assert not reads(world, "bob", f"{data}/a\x00/../solo.zarr")
    assert not reads(world, "bob", "")
    assert not reads(world, "bob", None)
    assert not reads(world, "bob", "file://" + f"{data}/a/x.zarr")


def test_a_symlink_inside_a_granted_folder_that_leads_out_is_not_covered(world):
    data = world.world.data
    os.symlink(f"{data}/other.zarr", f"{data}/a/escape.zarr")
    os.symlink(world.world.outside, f"{data}/a/escape_dir")
    grant(world, "dir", f"{data}/a")
    assert reads(world, "bob", f"{data}/a/x.zarr")
    assert not reads(world, "bob", f"{data}/a/escape.zarr")
    assert not reads(world, "bob", f"{data}/a/escape_dir/z.zarr")


def test_a_link_to_a_granted_store_from_outside_the_grant_is_covered(world):
    data = world.world.data
    os.symlink(f"{data}/a/x.zarr", f"{data}/solo_link.zarr")
    grant(world, "dir", f"{data}/a")
    assert reads(world, "bob", f"{data}/solo_link.zarr")


def test_a_granted_link_is_followed_to_its_target(world):
    """Granting the link grants what it leads to, and no more of its folder."""
    data = world.world.data
    os.symlink(f"{data}/other.zarr", f"{data}/a/link.zarr")
    grant(world, "store", f"{data}/a/link.zarr")
    assert reads(world, "bob", f"{data}/other.zarr")
    assert reads(world, "bob", f"{data}/a/link.zarr")
    assert not reads(world, "bob", f"{data}/a/x.zarr")


def test_a_granted_link_re_pointed_outside_the_data_directory_goes_inactive(world, monkeypatch):
    monkeypatch.setattr(access, "RESOLVE_TTL_S", 0)      # a link swapped while the server runs is seen at once
    data = world.world.data
    link = f"{data}/a/link.zarr"
    os.symlink(f"{data}/other.zarr", link)
    grant(world, "store", link)
    assert reads(world, "bob", f"{data}/other.zarr")
    os.unlink(link)
    os.symlink(f"{world.world.outside}/z.zarr", link)
    assert not reads(world, "bob", f"{world.world.outside}/z.zarr")
    assert not reads(world, "bob", link)
    with world.test_request_context("/"):
        report = access.describe("bob")
    assert report["grants"][0]["active"] is False and report["grants"][0]["inactive_reason"] == "outside_data_directories"


def test_a_grant_outside_the_current_data_roots_is_inactive_and_revives_with_the_root(world, monkeypatch, tmp_path):
    monkeypatch.setattr(access, "RESOLVE_TTL_S", 0)
    # written by hand: add_grant refuses a path outside the roots, but a root can be removed afterwards
    world.config["allowed_dirs"] = [world.world.outside]
    grant(world, "dir", world.world.outside)
    assert reads(world, "bob", f"{world.world.outside}/z.zarr")
    world.config["allowed_dirs"] = []
    assert not reads(world, "bob", f"{world.world.outside}/z.zarr")
    with world.test_request_context("/"):
        assert access.describe("bob")["grants"][0]["inactive_reason"] == "outside_data_directories"
    world.config["allowed_dirs"] = [world.world.outside]
    assert reads(world, "bob", f"{world.world.outside}/z.zarr")


def test_a_malformed_grant_is_inactive_and_does_not_break_the_others(world):
    data = world.world.data
    path = settings.access_path(world.config)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    atomic_store.write_json(path, {"version": 1, "principals": {"user:bob": {"restricted": True, "grants": [
        "nonsense", {"kind": "dir"}, {"kind": "dir", "path": "relative/path"}, {"kind": "moon", "path": data},
        {"kind": "dir", "path": f"{data}/a"}]}}})
    assert reads(world, "bob", f"{data}/a/x.zarr")
    assert not reads(world, "bob", f"{data}/solo.zarr")
    with world.test_request_context("/"):
        reasons = [g["inactive_reason"] for g in access.describe("bob")["grants"]]
    assert reasons == ["malformed", "malformed", "not_absolute", "malformed", None]


def test_a_malformed_entry_restricts_its_user_to_nothing_and_no_one_else(world):
    path = settings.access_path(world.config)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    atomic_store.write_json(path, {"version": 1, "principals": {"user:bob": "restricted please"}})
    data = world.world.data
    assert not reads(world, "bob", f"{data}/solo.zarr")
    assert reads(world, "carol", f"{data}/solo.zarr")


# --- case and Unicode ------------------------------------------------------------------

def test_only_the_exact_spelling_of_a_granted_path_is_read(world):
    data = world.world.data
    grant(world, "store", f"{data}/solo.zarr")
    assert reads(world, "bob", f"{data}/solo.zarr")
    for variant in (f"{data}/SOLO.zarr", f"{data}/Solo.Zarr", f"{data}/solo.zarr".upper()):
        assert not reads(world, "bob", variant), variant


def test_unicode_forms_are_not_the_same_string(world):
    name = "café.zarr"          # e acute
    make_rich_store(f"{world.world.data}/{name}")
    grant(world, "store", f"{world.world.data}/{name}")
    nfc, nfd = (unicodedata.normalize(form, name) for form in ("NFC", "NFD"))
    assert nfc != nfd
    spelled_on_disk = [n for n in os.listdir(world.world.data) if unicodedata.normalize("NFC", n) == nfc][0]
    other = nfd if spelled_on_disk == nfc else nfc
    assert reads(world, "bob", f"{world.world.data}/{spelled_on_disk}")
    assert not reads(world, "bob", f"{world.world.data}/{other}")


def test_a_grant_typed_in_another_case_is_spelled_as_the_directory_spells_it(world):
    """Where the filesystem folds case (APFS) the grant still matches what the listings hand out; elsewhere it is a different name."""
    data = world.world.data
    typed = data.replace("/data", "/DATA")
    if not os.path.exists(typed):
        pytest.skip("case-sensitive filesystem: another case is another directory")
    grant(world, "store", f"{typed}/solo.zarr", restrict=True)
    assert reads(world, "bob", f"{data}/solo.zarr")
    assert not reads(world, "bob", f"{typed}/solo.zarr")


def test_case_variants_are_different_names_on_a_case_sensitive_filesystem(world):
    if os.path.exists(world.world.data.replace("/data", "/DATA")):
        pytest.skip("case-insensitive filesystem")
    grant(world, "store", f"{world.world.data}/solo.zarr")
    assert not reads(world, "bob", f"{world.world.data}/SOLO.zarr")


# --- writing grants --------------------------------------------------------------------

def test_add_grant_validates_and_classifies(world):
    data = world.world.data
    assert access.add_grant(world.config, "bob", "auto", f"{data}/solo.zarr")["kind"] == "store"
    assert access.add_grant(world.config, "bob", "auto", f"{data}/a")["kind"] == "dir"
    assert access.add_grant(world.config, "bob", "auto", f"{data}/a/x.zarr")["kind"] == "store"
    with pytest.raises(access.GrantError) as err:
        access.add_grant(world.config, "bob", "auto", f"{data}/a")
    assert err.value.reason == "already_granted"
    with pytest.raises(access.GrantError) as err:
        access.add_grant(world.config, "bob", "dir", world.world.outside)
    assert err.value.reason == "outside_data_roots"
    with pytest.raises(access.GrantError) as err:
        access.add_grant(world.config, "bob", "dir", f"{data}/nothing-here")
    assert err.value.reason == "not_found"
    with pytest.raises(access.GrantError) as err:
        access.add_grant(world.config, "bob", "dir", f"{data}/solo.zarr/X/../../other.zarr/obs/../X/../../../data/solo.zarr/.zgroup")
    assert err.value.reason in ("not_a_directory", "not_found")
    with pytest.raises(access.GrantError) as err:
        access.add_grant(world.config, "bob", "volume", f"{data}/a")
    assert err.value.reason == "bad_kind"
    with pytest.raises(access.GrantError) as err:
        access.add_grant(world.config, "bob", "auto", "")
    assert err.value.reason == "bad_path"


def test_a_symlink_into_the_data_directory_is_stored_as_written_not_resolved(world):
    data = world.world.data
    os.symlink(f"{data}/other.zarr", f"{data}/a/link.zarr")
    stored = access.add_grant(world.config, "bob", "store", f"{data}/a/link.zarr")
    assert stored["path"] == f"{data}/a/link.zarr"


def test_a_link_leading_outside_the_data_roots_cannot_be_granted(world):
    data = world.world.data
    os.symlink(f"{world.world.outside}/z.zarr", f"{data}/escape.zarr")
    with pytest.raises(access.GrantError) as err:
        access.add_grant(world.config, "bob", "store", f"{data}/escape.zarr")
    assert err.value.reason == "outside_data_roots"


def test_remove_grant_by_stored_path_or_by_any_spelling_of_the_real_path(world):
    data = world.world.data
    os.symlink(f"{data}/a", f"{data}/a_link")
    access.add_grant(world.config, "bob", "dir", f"{data}/a")
    access.add_grant(world.config, "bob", "store", f"{data}/solo.zarr")
    assert [g["path"] for g in access.remove_grant(world.config, "bob", f"{data}/a_link")] == [f"{data}/a"]
    assert [g["path"] for g in access.remove_grant(world.config, "bob", f"{data}/solo.zarr/")] == [f"{data}/solo.zarr"]
    assert access.remove_grant(world.config, "bob", f"{data}/solo.zarr") == []
    assert json.load(open(settings.access_path(world.config)))["principals"] == {}


def test_forget_drops_the_whole_entry_and_a_removed_user_starts_unrestricted(world):
    grant(world, "dir", f"{world.world.data}/a")
    manager = world.auth_manager
    assert manager.remove_user("bob")
    assert json.load(open(settings.access_path(world.config)))["principals"] == {}
    manager.add_user("bob", PASSWORD)
    assert reads(world, "bob", f"{world.world.data}/solo.zarr")


def test_a_refused_removal_keeps_the_restriction(world):
    """Dropping the entry before a removal that is then refused would widen access."""
    grant(world, "dir", f"{world.world.data}/a", user="alice")
    manager = world.auth_manager
    with pytest.raises(Exception):
        manager.remove_user("alice")      # the last admin
    assert "user:alice" in json.load(open(settings.access_path(world.config)))["principals"]


# --- an access.json that cannot be trusted -------------------------------------------------

@pytest.mark.parametrize("content", ["{not json", "", "[]", '{"version": 1}', '{"principals": []}', '{"principals": "x"}', "null"])
def test_an_unreadable_access_file_refuses_every_non_admin_and_no_admin(world, content):
    path = settings.access_path(world.config)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content)
    data = world.world.data
    for name, expected in (("alice", 200), ("bob", 503), ("carol", 503)):
        c = client(world, name)
        reply = c.get("/api/v1/data/obs", query_string={"dataset_path": f"{data}/solo.zarr"})
        assert reply.status_code == expected, (name, content)
        if expected == 503:
            assert reply.get_json()["reason"] == "access_unavailable"
            assert reply.get_json()["code"] == "store_unreadable"
            assert c.get("/api/v1/datasets").status_code == 503
            assert c.get("/api/v1/sessions/list").status_code == 503
            assert c.get("/api/v1/data/obs", query_string={"dataset_path": f"{world.world.outside}/z.zarr"}).status_code == 503
    # login and the page shell keep working, so the user can see something is wrong
    assert client(world, "bob").get("/api/v1/auth/me").status_code == 200
    # and the repair brings everyone back at once
    atomic_store.write_json(path, {"version": 1, "principals": {}})
    assert client(world, "bob").get("/api/v1/data/obs", query_string={"dataset_path": f"{data}/solo.zarr"}).status_code == 200


def test_login_off_has_no_users_to_restrict_and_ignores_the_file(tmp_path):
    data = tmp_path / "data"
    make_rich_store(data / "solo.zarr")
    app = create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(data), "log_file": str(tmp_path / "t.log"),
                      "auth_enabled": False, "user_file": str(tmp_path / "users.json")})
    path = settings.access_path(app.config)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w").write("{broken")
    reply = app.test_client().get("/api/v1/data/obs", query_string={"dataset_path": str(data / "solo.zarr")})
    assert reply.status_code == 200


def test_auth_me_reports_restricted(world):
    assert client(world, "bob").get("/api/v1/auth/me").get_json()["restricted"] is False
    access.set_restricted(world.config, "bob", True)
    assert client(world, "bob").get("/api/v1/auth/me").get_json()["restricted"] is True
    assert client(world, "alice").get("/api/v1/auth/me").get_json()["restricted"] is False


# --- remote prefixes ---------------------------------------------------------------------

@pytest.fixture
def remote_world(world):
    """The app with remote stores allowed under two prefixes (the policy is process-wide: restored afterwards)."""
    from annzarro.core import remote
    saved = remote._policy
    remote.configure_remote_policy({"remote_stores": "allow",
                                    "remote_allowlist": ["s3://lab-public/", "https://data.example.org/shared/"]})
    yield world
    remote._policy = saved


def test_a_remote_grant_matches_on_a_slash_boundary(remote_world):
    app = remote_world
    grant(app, "remote", "s3://lab-public/pbmc")
    assert reads(app, "bob", "s3://lab-public/pbmc/a.zarr")
    assert reads(app, "bob", "s3://lab-public/pbmc/")
    assert reads(app, "bob", "s3://lab-public/pbmc")
    assert reads(app, "bob", "S3://LAB-PUBLIC/pbmc/a.zarr")        # scheme and host are case-insensitive
    assert not reads(app, "bob", "s3://lab-public/pbmc2/a.zarr")
    assert not reads(app, "bob", "s3://lab-public/other/a.zarr")
    assert not reads(app, "bob", "s3://lab-publicity/pbmc/a.zarr")
    assert not reads(app, "bob", "s3://lab-public/pbmc/../secret/a.zarr")
    assert not reads(app, "bob", "s3://lab-public/pbmc/%2e%2e/secret/a.zarr")
    assert not reads(app, "bob", "s3://lab-public/pbmc/a.zarr?X-Amz-Signature=1")
    assert not reads(app, "bob", "s3://user:pw@lab-public/pbmc/a.zarr")
    assert not reads(app, "bob", "gs://lab-public/pbmc/a.zarr")


def test_a_bucket_prefix_collision_is_not_containment(remote_world):
    app = remote_world
    grant(app, "remote", "s3://lab-public/")
    assert reads(app, "bob", "s3://lab-public/anything.zarr")
    assert not reads(app, "bob", "s3://lab-public-two/anything.zarr")


def test_a_remote_grant_outside_the_allowlist_cannot_be_made_and_one_made_before_goes_inactive(remote_world):
    app = remote_world
    with pytest.raises(access.GrantError) as err:
        access.add_grant(app.config, "bob", "remote", "s3://elsewhere/x/")
    assert err.value.reason == "remote_not_allowed"
    grant(app, "remote", "https://data.example.org/shared/pbmc/")
    assert reads(app, "bob", "https://data.example.org/shared/pbmc/a.zarr")
    from annzarro.core.remote import configure_remote_policy
    configure_remote_policy({"remote_stores": "allow", "remote_allowlist": ["s3://lab-public/"]})   # restored by the fixture
    import time
    time.sleep(access.RESOLVE_TTL_S + 0.1)
    assert not reads(app, "bob", "https://data.example.org/shared/pbmc/a.zarr")
    configure_remote_policy({"remote_stores": "deny"})
    time.sleep(access.RESOLVE_TTL_S + 0.1)
    assert not reads(app, "bob", "s3://lab-public/pbmc/a.zarr")


def test_a_restricted_user_without_a_remote_grant_gets_the_standard_404_on_zarr_url(remote_world):
    app = remote_world
    access.set_restricted(app.config, "bob", True)
    c = client(app, "bob")
    reply = c.get("/api/v1/zarr/url", query_string={"url": "s3://lab-public/pbmc/a.zarr"})
    assert reply.status_code == 404
    grant(app, "remote", "s3://lab-public/pbmc/")
    reply = c.get("/api/v1/zarr/url", query_string={"url": "s3://lab-public/pbmc/a.zarr"})
    assert reply.status_code != 404 or "not_found" not in reply.get_data(as_text=True)


# --- routes that are not about one dataset, and still say where the data is ----------------

def test_a_restricted_user_cannot_read_the_status_or_the_cache_listing(world):
    """/status names the data directory and counts its stores; /cache/info names every cached dataset."""
    data = world.world.data
    access.set_restricted(world.config, "bob", True)
    bob, carol = client(world, "bob"), client(world, "carol")
    # warm the cache with another dataset, as another user's browsing would
    assert carol.get("/api/v1/data/obs", query_string={"dataset_path": f"{data}/solo.zarr"}).status_code == 200
    for url in ("/api/v1/status", "/api/v1/cache/info"):
        reply = bob.get(url)
        assert reply.status_code == 403 and reply.get_json()["reason"] == "admin_only", url
        assert data not in reply.get_data(as_text=True) and "solo.zarr" not in reply.get_data(as_text=True)
    # unchanged for everyone else until slice 4 closes them for all non-admins
    assert carol.get("/api/v1/status").status_code == 200
    assert client(world, "alice").get("/api/v1/cache/info").status_code == 200


# --- may_read against an independent model, over spellings it was not written for ---------

def test_may_read_agrees_with_pathlib_on_random_spellings(world):
    """A seeded sweep of ``..``, ``.``, empty segments, links, near-miss names and case variants.

    The model is the resolved path being a granted path or below one, by pathlib's parents, which
    shares no code with the ancestor lookup in ``Grants.allows_local``; the two must agree on every
    spelling. A case variant (``A``, ``SOLO.zarr``) resolves to a different string, so the model also
    says no on a case-insensitive volume.
    """
    import pathlib
    import random
    data = world.world.data
    os.symlink(f"{data}/a", f"{data}/to_a")
    os.symlink(f"{data}/ab", f"{data}/a/to_ab")
    os.symlink(world.world.outside, f"{data}/ab/out")
    os.symlink(f"{data}/solo.zarr", f"{data}/a/solo_link")
    grants = [f"{data}/a", f"{data}/solo.zarr"]
    for path in grants:
        grant(world, "dir" if path.endswith("/a") else "store", path)
    allowed = [pathlib.Path(os.path.realpath(g)) for g in grants]
    pieces = ["a", "ab", "a", "..", ".", "", "x.zarr", "y.zarr", "solo.zarr", "to_a", "to_ab", "out", "solo_link",
              "z.zarr", "A", "SOLO.zarr", "other.zarr", "a ", "a​", "%2e%2e", "a/b/../..", "..."]
    rng = random.Random(20261011)
    covered = {True: 0, False: 0}
    with world.test_request_context("/"):
        for _ in range(3000):
            spelled = data + "".join("/" + rng.choice(pieces) for _ in range(rng.randint(1, 6)))
            if rng.random() < 0.15:
                spelled += "/"
            real = pathlib.Path(os.path.realpath(spelled))
            expected = any(real == g or g in real.parents for g in allowed)
            got = access.may_read("bob", spelled)
            covered[got] += 1
            assert got == expected, spelled
    assert covered[True] > 100 and covered[False] > 100


def test_a_remote_url_on_a_dataset_route_is_the_standard_404_without_a_grant(remote_world):
    """Nothing is fetched for a restricted user whose grants do not cover the URL."""
    app = remote_world
    grant(app, "remote", "s3://lab-public/pbmc/")
    bob = client(app, "bob")
    seen = []
    from annzarro.core import remote
    original = remote.open_remote_group
    remote.open_remote_group = lambda *a, **k: seen.append(a) or original(*a, **k)
    try:
        for url in ("s3://lab-public/other/x.zarr", "https://data.example.org/shared/x.zarr", "s3://lab-public/pbmc2/x.zarr",
                    "s3://lab-public/pbmc/../other/x.zarr"):
            reply = bob.get("/api/v1/data/obs", query_string={"dataset_path": url})
            assert reply.status_code == 404, url
            assert reply.get_json() == {"error": f"Dataset not found: {url}", "exception": "FileNotFoundError",
                                        "reason": "not_found"}, url
    finally:
        remote.open_remote_group = original
    assert seen == []


def test_store_error_agrees_with_the_shared_store_state_helper(world):
    """access.store_error is slice S's access_store_state, asked without the per-call path lookup."""
    path = settings.access_path(world.config)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for content in (None, '{"version": 1, "principals": {}}', "{broken", ""):
        if content is None:
            if os.path.exists(path):
                os.unlink(path)
        else:
            open(path, "w").write(content)
        state = settings.access_store_state(world.config)
        assert (access.store_error(world.config) is None) == state["ok"], content
        if not state["ok"]:
            assert access.store_error(world.config) == state["error"]
