"""
The data gate (annzarro/server/access.py) over every route of the app.

The matrix is read from ``app.url_map``, with no handwritten route list, so a
new endpoint that declares no gate fails here first. Until the grants exist
(``is_restricted`` false, ``may_read`` allows all) the gate changes no reply;
the tests that need a restricted requester inject a deny-list in place of
those two functions. Slice A2 replaces the deny-list with the real grants and
reuses ``Harness`` and the path-trick helpers below.
"""
import os
import unicodedata

import pytest

from annzarro.server import access
from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.tests.server.rich_store import make_rich_store

PASSWORD = "pw-for-tests"
RESTRICTED = "bob"
USERS = {"alice": True, "carol": False, RESTRICTED: False}   # name: is_admin

#: Extra query arguments a route needs to get as far as its reader.
EXTRA_QUERY = {
    "search_names": {"q": "gene", "scope": "dataset"},
    "locate_subset_rows": {"dataset_rows": "0"},
    "get_statistics": {"data_path": "X"},
    "get_data_by_path": {"path": "X"},
    "list_dataset_search": {"q": "zarr"},
    "get_paginated_data": {"matrix_type": "X", "rows": "0,1", "cols": "0,1"},
    "get_obsm_dataframe_columns": {"key": "X_umap"},
    "get_varm_dataframe_columns": {"key": "x"},
}
#: Values for URL converters (``<path:layer_name>``); ``dataset_path`` is the target.
URL_VALUES = {"layer_name": "counts", "obsm_key": "X_umap", "varm_key": "x", "obsp_key": "conn",
              "varp_key": "corr", "uns_key": "title"}
#: The argument that names the folder on the listing routes that take one.
FOLDER_ARG = {"list_directory": "path", "list_dataset_folder": "folder", "list_legacy_datasets": "dir"}
CHECKED_KINDS = ("dataset", "remote", "listing")
#: Routes whose reply carries state of the call (a rate-limited refresh): compare the status only.
STATEFUL = ("refresh_dataset",)


# --- the app and its fixture -------------------------------------------------

@pytest.fixture
def layout(tmp_path):
    """data/{in.zarr, out.zarr, pub/, hidden/deep.zarr}: what a grant covers is ``in.zarr`` and ``pub``."""
    data = tmp_path / "data"
    make_rich_store(data / "in.zarr")
    make_rich_store(data / "out.zarr")
    (data / "pub").mkdir()
    make_rich_store(data / "hidden" / "deep.zarr")
    return tmp_path


@pytest.fixture
def app(layout):
    manager = AuthManager(user_file=str(layout / "users.json"))
    for name, admin in USERS.items():
        manager.add_user(name, PASSWORD, is_admin=admin)
    return create_app({
        "TESTING": True,
        "host": "127.0.0.1",
        "data_dir": str(layout / "data"),
        "log_file": str(layout / "test.log"),
        "auth_enabled": True,
        "user_file": str(layout / "users.json"),
        "secret_key": "test-only-secret",
    })


def _client(app, username=None):
    client = app.test_client()
    if username:
        assert client.post("/login", data={"username": username, "password": PASSWORD}).status_code == 302
    return client


def fold(path):
    """The spelling a deny-list compares: case and Unicode form folded (APFS treats them as one name)."""
    return unicodedata.normalize("NFC", unicodedata.normalize("NFD", path).casefold())


def inject_deny_list(monkeypatch, app, denied, remote=False):
    """Make ``RESTRICTED`` a restricted user who may read everything except ``denied`` (paths under them too).

    A2 replaces this with real grants; the harness below does not change.
    """
    roots = [fold(os.path.realpath(path)) for path in denied]

    def may_read(user, path):
        if "://" in path:
            return not remote
        path = fold(path)
        return not any(path == root or path.startswith(root + os.sep) for root in roots)

    monkeypatch.setattr(access, "is_restricted", lambda user: user == RESTRICTED)
    monkeypatch.setattr(access, "may_read", may_read)


def ungated(app):
    """Endpoints of ``app.url_map`` with no gate, or with one that is not a known kind."""
    return sorted({rule.endpoint for rule in app.url_map.iter_rules()
                   if access.gate_of(app, rule.endpoint) not in access.GATE_KINDS})


# --- the harness: one request per (rule, method, target) ----------------------

class Harness:
    """Builds the request a rule needs for a target path and compares replies."""

    def __init__(self, app, layout):
        self.app = app
        self.data = str(layout / "data")
        # target spellings: a store for the dataset routes, a folder for the listing routes
        self.stores = {"in": f"{self.data}/in.zarr", "out": f"{self.data}/out.zarr",
                       "nope": f"{self.data}/nope.zarr"}
        self.folders = {"in": f"{self.data}/pub", "out": f"{self.data}/hidden", "nope": f"{self.data}/nodir"}

    def rules(self, kinds=CHECKED_KINDS):
        for rule in sorted(self.app.url_map.iter_rules(), key=lambda r: (r.rule, r.endpoint)):
            if access.gate_of(self.app, rule.endpoint) in kinds:
                for method in sorted(rule.methods - {"HEAD", "OPTIONS"}):
                    yield rule, method

    def request(self, client, rule, method, target, spelled=None):
        """Call ``rule`` naming ``target`` ("in", "out", "nope"); ``spelled`` overrides the path text."""
        kind = access.gate_of(self.app, rule.endpoint)
        folder = rule.endpoint in FOLDER_ARG
        path = spelled or (self.folders if folder else self.stores)[target]
        values = {arg: URL_VALUES.get(arg, "x") for arg in rule.arguments}
        query = dict(EXTRA_QUERY.get(rule.endpoint, {}))
        if "dataset_path" in rule.arguments:
            values["dataset_path"] = os.path.relpath(path, self.data)
        elif folder:
            query[FOLDER_ARG[rule.endpoint]] = path
        elif kind == "remote":
            query["url"] = {"in": "https://granted.example/in.zarr", "out": "https://other.example/out.zarr",
                            "nope": "https://other.example/nope.zarr"}[target]
        elif kind == "dataset":
            query["dataset_path"] = path
        url = rule.rule
        for arg, value in values.items():
            for converter in ("path:", "string:", ""):
                url = url.replace(f"<{converter}{arg}>", str(value))
        return client.open(url, method=method, query_string=query)

    def spelling(self, rule, target):
        """The text of the path the request names, to blank out of an error message."""
        if access.gate_of(self.app, rule.endpoint) == "remote":
            return {"in": "granted.example/in.zarr", "out": "other.example/out.zarr",
                    "nope": "other.example/nope.zarr"}[target]
        return (self.folders if rule.endpoint in FOLDER_ARG else self.stores)[target]


def same_reply(rule, a, b):
    """Whether two replies of ``rule`` are the same (status only for the stateful routes)."""
    if rule.endpoint in STATEFUL:
        return a.status_code == b.status_code
    return (a.status_code, a.data) == (b.status_code, b.data)


def blank(reply, *spellings):
    """(status, body) with the requested path spelled out of the body, so two replies compare."""
    body = reply.get_data(as_text=True)
    for spelling in spellings:
        for form in (spelling, os.path.relpath(spelling) if os.path.isabs(spelling) else spelling,
                     os.path.basename(spelling)):
            body = body.replace(form, "<P>")
    return reply.status_code, body


# --- every route declares a gate ------------------------------------------------

def test_every_rule_declares_a_known_gate(app):
    assert ungated(app) == []


def test_an_undeclared_route_is_found_and_refused_for_everyone(app, layout):
    app.add_url_rule("/api/v1/zz_new", "zz_new", lambda: "secret")
    assert ungated(app) == ["zz_new"]
    for name in (None, "alice", RESTRICTED):
        reply = _client(app, name).get("/api/v1/zz_new")
        assert reply.status_code == 404 and b"secret" not in reply.data


def test_the_gate_kinds_cover_every_documented_kind(app):
    kinds = {access.gate_of(app, rule.endpoint) for rule in app.url_map.iter_rules()}
    assert kinds == set(access.GATE_KINDS)


def test_a_gate_decorator_rejects_an_unknown_kind():
    with pytest.raises(ValueError):
        access.gate("secret")


# --- the stub changes no reply -----------------------------------------------------

def test_allow_all_stub_gives_a_restricted_name_the_same_replies_as_admin(app, layout):
    harness = Harness(app, layout)
    admin, bob = _client(app, "alice"), _client(app, RESTRICTED)
    for rule, method in harness.rules():
        for target in ("in", "out", "nope"):
            a = harness.request(admin, rule, method, target)
            b = harness.request(bob, rule, method, target)
            assert same_reply(rule, a, b), (rule.rule, method, target)


def test_anonymous_gets_401_on_every_checked_route(app, layout):
    harness = Harness(app, layout)
    anon = app.test_client()
    for rule, method in harness.rules():
        for target in ("in", "out"):
            assert harness.request(anon, rule, method, target).status_code == 401, (rule.rule, method, target)


# --- a requester outside the grant gets the nonexistent store's reply ---------------

@pytest.fixture
def restricted(monkeypatch, app, layout):
    """The harness with ``bob`` denied out.zarr, hidden/ and every remote URL."""
    inject_deny_list(monkeypatch, app, [layout / "data" / "out.zarr", layout / "data" / "hidden"], remote=True)
    return Harness(app, layout)


def test_out_of_grant_reply_is_the_nonexistent_reply_on_every_route(app, restricted):
    bob = _client(app, RESTRICTED)
    checked = 0
    for rule, method in restricted.rules():
        denied = restricted.request(bob, rule, method, "out")
        if access.gate_of(app, rule.endpoint) == "remote":
            assert denied.status_code == 404   # a remote URL has no "nonexistent" reply: it is not fetched
            continue
        nothing = restricted.request(bob, rule, method, "nope")
        assert blank(denied, restricted.spelling(rule, "out")) == \
            blank(nothing, restricted.spelling(rule, "nope")), (rule.rule, method)
        checked += 1
    assert checked >= 35   # the dataset and listing routes of the inventory, not an empty loop


def test_in_grant_reply_is_the_admin_reply_on_every_route(app, restricted):
    admin, bob = _client(app, "alice"), _client(app, RESTRICTED)
    served = 0
    for rule, method in restricted.rules():
        if access.gate_of(app, rule.endpoint) == "remote" or \
                (access.gate_of(app, rule.endpoint) == "listing" and rule.endpoint not in FOLDER_ARG):
            continue   # a remote URL and the listings that name no path are checked on their own
        a = restricted.request(admin, rule, method, "in")
        b = restricted.request(bob, rule, method, "in")
        assert same_reply(rule, a, b), (rule.rule, method)
        served += a.status_code == 200
    assert served >= 20


def test_unrestricted_user_and_admin_are_never_gated(app, restricted):
    for name in ("alice", "carol"):
        client = _client(app, name)
        assert restricted.request(client, *_rule(app, "get_obs"), "out").status_code == 200


def _rule(app, endpoint):
    rule = next(r for r in app.url_map.iter_rules() if r.endpoint == endpoint)
    return rule, sorted(rule.methods - {"HEAD", "OPTIONS"})[0]


def test_remote_url_outside_the_grant_is_refused_and_unrestricted_is_not(app, restricted, monkeypatch):
    rule, method = _rule(app, "validate_zarr_url")
    assert restricted.request(_client(app, RESTRICTED), rule, method, "out").status_code == 404
    # the gate does not run the validator for them: nothing is fetched
    monkeypatch.setattr(access, "may_read", lambda user, path: path.startswith("https://granted.example/"))
    assert restricted.request(_client(app, RESTRICTED), rule, method, "in").status_code != 404


def test_listings_never_show_an_out_of_grant_entry(app, restricted):
    bob, admin = _client(app, RESTRICTED), _client(app, "alice")
    data = restricted.data
    for client, hidden in ((admin, False), (bob, True)):
        names = lambda payload: {e["name"] for e in payload}
        everything = client.get("/api/v1/datasets").get_json()
        assert ("out.zarr" not in names(everything)) == hidden
        assert "in.zarr" in names(everything)
        listing = client.get("/api/v1/directories/list", query_string={"path": data}).get_json()
        assert ("out.zarr" not in names(listing["zarr_stores"])) == hidden
        assert ("hidden" not in names(listing["directories"])) == hidden
        folder = client.get("/api/v1/datasets/folder", query_string={"folder": data}).get_json()
        assert ("out.zarr" not in names(folder["entries"])) == hidden
        assert ("hidden" not in names(folder["entries"])) == hidden
        found = client.get("/api/v1/datasets/search", query_string={"q": "zarr"}).get_json()
        assert ({"out.zarr", "deep.zarr"} & names(found["results"]) == set()) == hidden
        legacy = client.get("/api/v1/core/datasets").get_json()
        assert not any("out.zarr" in str(d.get("path")) for d in legacy["datasets"]) == hidden


# --- caches and conditional requests sit behind the gate -----------------------------

def test_a_cached_reply_is_never_served_before_the_gate(app, restricted):
    admin, bob = _client(app, "alice"), _client(app, RESTRICTED)
    rule, method = _rule(app, "get_obs")
    warm = restricted.request(admin, rule, method, "out")
    etag = warm.headers.get("ETag")
    assert warm.status_code == 200 and etag
    # the same tag is honoured for the admin (the conditional path is live) ...
    again = admin.get("/api/v1/data/obs", query_string={"dataset_path": restricted.stores["out"]},
                      headers={"If-None-Match": etag})
    assert again.status_code == 304
    # ... and never for a requester who may not read the store
    refused = bob.get("/api/v1/data/obs", query_string={"dataset_path": restricted.stores["out"]},
                      headers={"If-None-Match": etag})
    assert refused.status_code == 404 and etag not in refused.get_data(as_text=True)
    assert "ETag" not in refused.headers


def test_listing_caches_stay_filtered_after_an_unrestricted_request_warms_them(app, restricted):
    admin, bob = _client(app, "alice"), _client(app, RESTRICTED)
    assert any(e["name"] == "out.zarr" for e in admin.get("/api/v1/datasets").get_json())
    assert not any(e["name"] == "out.zarr" for e in bob.get("/api/v1/datasets").get_json())
    assert any(e["name"] == "out.zarr" for e in admin.get("/api/v1/datasets").get_json())


def test_data_replies_vary_on_the_cookie_and_public_ones_do_not(app, restricted):
    app.add_url_rule("/api/v1/zz_public", "zz_public", access.gate("public")(lambda: "ok"))
    admin = _client(app, "alice")
    for endpoint in ("get_obs", "get_dataset_structure", "list_all_datasets"):
        rule, method = _rule(app, endpoint)
        reply = restricted.request(admin, rule, method, "in")
        assert "Cookie" in reply.vary, endpoint
    with app.test_request_context("/api/v1/zz_public"):
        assert "Cookie" not in access.mark_vary(app.make_response("ok")).vary
    assert "Cookie" in _client(app, RESTRICTED).get(
        "/api/v1/data/obs", query_string={"dataset_path": restricted.stores["out"]}).vary


# --- path tricks (A2 extends these with the real grants) -----------------------------

def test_dotdot_and_extra_slashes_resolve_before_the_check(app, restricted):
    bob = _client(app, RESTRICTED)
    data = restricted.data
    for spelled in (f"{data}/pub/../out.zarr", f"{data}//out.zarr", f"{data}/./out.zarr",
                    f"{data}/out.zarr/", f"{data}/in.zarr/../out.zarr", f"{data}/hidden/../out.zarr"):
        reply = bob.get("/api/v1/data/obs", query_string={"dataset_path": spelled})
        assert reply.status_code == 404, spelled
    # the same spelling through the URL segment, percent-encoded or not
    for segment in ("pub/../out.zarr", "pub/%2e%2e/out.zarr", "pub%2f..%2fout.zarr", "./out.zarr"):
        reply = bob.get(f"/api/v1/datasets/{segment}/info")
        assert reply.status_code == 404, segment
        assert b"cells" not in reply.data and b"n_obs" not in reply.data, segment


def test_relative_spelling_resolves_against_the_data_directory(app, restricted):
    bob = _client(app, RESTRICTED)
    assert bob.get("/api/v1/data/obs", query_string={"dataset_path": "out.zarr"}).status_code == 404
    assert bob.get("/api/v1/data/obs", query_string={"dataset_path": "pub/../out.zarr"}).status_code == 404
    assert bob.get("/api/v1/data/obs", query_string={"dataset_path": "in.zarr"}).status_code == 200


def test_symlink_into_a_denied_store_is_denied_and_out_of_a_denied_folder_is_allowed(app, restricted):
    data = restricted.data
    os.symlink(f"{data}/out.zarr", f"{data}/pub/shortcut.zarr")
    os.symlink(f"{data}/in.zarr", f"{data}/hidden/back.zarr")
    bob = _client(app, RESTRICTED)
    assert bob.get("/api/v1/data/obs", query_string={"dataset_path": f"{data}/pub/shortcut.zarr"}).status_code == 404
    assert bob.get("/api/v1/data/obs", query_string={"dataset_path": f"{data}/hidden/back.zarr"}).status_code == 200


def test_prefix_collision_is_not_containment(app, restricted):
    data = restricted.data
    make_rich_store(f"{data}/hidden2/deep.zarr")
    bob = _client(app, RESTRICTED)
    assert bob.get("/api/v1/data/obs", query_string={"dataset_path": f"{data}/hidden2/deep.zarr"}).status_code == 200
    assert bob.get("/api/v1/data/obs", query_string={"dataset_path": f"{data}/hidden/deep.zarr"}).status_code == 404


def spelling_variants(path):
    """Spellings of ``path`` a case-insensitive or Unicode-normalising filesystem would still open."""
    head, name = os.path.split(path)
    return [os.path.join(head, name.upper()), os.path.join(head, name.title()),
            os.path.join(head, unicodedata.normalize("NFD", name)),
            os.path.join(head, unicodedata.normalize("NFC", name))]


def test_case_and_unicode_spellings_of_a_denied_store_are_never_served(app, restricted):
    """On APFS a variant opens the same store; on Linux it is another, absent name. Either way: 404."""
    bob = _client(app, RESTRICTED)
    for spelled in spelling_variants(restricted.stores["out"]):
        if spelled == restricted.stores["out"]:
            continue
        reply = bob.get("/api/v1/data/obs", query_string={"dataset_path": spelled})
        assert reply.status_code == 404, spelled


def test_case_variants_are_different_directories_where_the_filesystem_is_case_sensitive(layout):
    probe = layout / "CaseProbe"
    probe.mkdir()
    if (layout / "caseprobe").exists():
        pytest.skip("case-insensitive filesystem: variants name the same directory")
    assert not (layout / "caseprobe").exists()


# --- a missing store is the standard 404 on every route (it was a 500 or an odd 404 on five) ---

@pytest.mark.parametrize("endpoint", ["refresh_dataset", "get_obsm_dataframe_columns",
                                      "get_varm_dataframe_columns", "get_uns_data", "get_anndata_structure"])
def test_a_missing_store_is_the_standard_404(app, layout, endpoint):
    harness = Harness(app, layout)
    rule, method = _rule(app, endpoint)
    reply = harness.request(_client(app, "alice"), rule, method, "nope")
    assert reply.status_code == 404
    assert reply.get_json() == {"error": f"Dataset not found: {harness.stores['nope']}",
                                "exception": "FileNotFoundError", "reason": "not_found"}
