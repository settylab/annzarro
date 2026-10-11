"""
The data access matrix again, with the real grants in place of the deny-list.

``test_data_access_matrix.py`` proves the gate over every route of ``app.url_map``
with an injected deny-list. This module runs the same checks (the functions are
imported, so a change to the harness reaches both) against ``access.may_read``
as slice A2 ships it: ``bob`` is restricted to the store ``in.zarr`` and the
folder ``pub``, ``carol`` is unrestricted, ``alice`` is an admin.

It adds what an allow-list on real paths must show that a deny-list could not:
variant spellings of a GRANTED store are refused too (fail closed), a sibling
whose name starts like a grant is not covered, and a restricted user is told
nothing about the roots.
"""
import pytest

from annzarro.server import access
from annzarro.tests.server.rich_store import make_rich_store
# the fixtures the matrix module builds (the data layout, the hosted app) and its harness
from annzarro.tests.server.test_data_access_matrix import (  # noqa: F401
    FOLDER_ARG, RESTRICTED, Harness, _client, _rule, app, layout, outside, same_but_not_told, same_reply, spelling_variants,
    # the checks that hold for any gate, run here against the real one
    test_a_cached_reply_is_never_served_before_the_gate,
    test_a_denied_directory_on_the_legacy_listing_is_an_empty_list_like_a_missing_one,
    test_a_restricted_user_cannot_tell_outside_the_roots_from_a_store_they_may_not_read,
    test_anonymous_gets_401_on_every_checked_route,
    test_case_and_unicode_spellings_of_a_denied_store_are_never_served,
    test_dotdot_and_extra_slashes_resolve_before_the_check,
    test_data_replies_vary_on_the_cookie_and_public_ones_do_not,
    test_in_grant_reply_is_the_admin_reply_on_every_route,
    test_listing_caches_stay_filtered_after_an_unrestricted_request_warms_them,
    test_out_of_grant_reply_is_the_nonexistent_reply_on_every_route,
    test_outside_the_roots_is_unchanged_for_everyone_else,
    test_refusals_are_logged_at_most_a_burst_a_minute_then_summarised,
    test_relative_spelling_resolves_against_the_data_directory,
    test_the_reply_echoes_the_clients_spelling_not_the_server_layout,
    test_symlink_into_a_denied_store_is_denied_and_out_of_a_denied_folder_is_allowed,
    test_unrestricted_user_and_admin_are_never_gated,
)


@pytest.fixture
def restricted(app, layout):
    """The harness with ``bob`` restricted to ``in.zarr`` and ``pub/``."""
    data = layout / "data"
    access.add_grant(app.config, RESTRICTED, "store", str(data / "in.zarr"), actor="alice")
    access.add_grant(app.config, RESTRICTED, "dir", str(data / "pub"), actor="alice")
    access.set_restricted(app.config, RESTRICTED, True)
    return Harness(app, layout)


def test_the_restricted_flag_alone_leaves_nothing(app, layout):
    """Restricted with no grants sees nothing; the same name unrestricted sees everything."""
    harness = Harness(app, layout)
    bob = _client(app, RESTRICTED)
    rule, method = _rule(app, "get_obs")
    assert harness.request(bob, rule, method, "in").status_code == 200
    access.set_restricted(app.config, RESTRICTED, True)
    assert harness.request(bob, rule, method, "in").status_code == 404
    assert bob.get("/api/v1/datasets").get_json() == []
    access.set_restricted(app.config, RESTRICTED, False)
    assert harness.request(bob, rule, method, "in").status_code == 200


def test_variant_spellings_of_a_granted_store_are_refused_too(app, restricted):
    """An allow-list on exact strings: on APFS a variant opens the store, so refusing it is the fail-closed answer."""
    bob = _client(app, RESTRICTED)
    exact = restricted.stores["in"]
    assert bob.get("/api/v1/data/obs", query_string={"dataset_path": exact}).status_code == 200
    variants = [v for v in spelling_variants(exact) if v != exact]
    assert variants
    for spelled in variants:
        assert bob.get("/api/v1/data/obs", query_string={"dataset_path": spelled}).status_code == 404, spelled


def test_a_sibling_that_starts_like_a_grant_is_not_covered(app, restricted):
    data = restricted.data
    make_rich_store(f"{data}/in.zarr2")
    make_rich_store(f"{data}/pub2/x.zarr")
    make_rich_store(f"{data}/pub/x.zarr")
    bob = _client(app, RESTRICTED)
    for path, status in ((f"{data}/in.zarr2", 404), (f"{data}/pub2/x.zarr", 404), (f"{data}/pub/x.zarr", 200),
                         (f"{data}/in.zarr", 200)):
        assert bob.get("/api/v1/data/obs", query_string={"dataset_path": path}).status_code == status, path


def test_a_restricted_user_is_not_told_where_the_roots_are(app, restricted, tmp_path):
    """Outside every root, inside a root but ungranted, and missing: one reply, with the client's spelling."""
    bob = _client(app, RESTRICTED)
    outside = tmp_path / "elsewhere" / "x.zarr"
    outside.parent.mkdir()
    make_rich_store(outside)
    replies = {}
    for label, spelled in (("outside", str(outside)), ("outside-missing", str(tmp_path / "elsewhere" / "no.zarr")),
                           ("ungranted", f"{restricted.data}/out.zarr"), ("missing", f"{restricted.data}/nope.zarr")):
        reply = bob.get("/api/v1/data/obs", query_string={"dataset_path": spelled})
        assert reply.status_code == 404, label
        body = reply.get_data(as_text=True)
        assert restricted.data not in body.replace(spelled, ""), label    # data_dir is never echoed
        assert "outside" not in body.lower() and "allowed_dirs" not in body, label
        replies[label] = body.replace(spelled, "<P>")
    assert len(set(replies.values())) == 1, replies


def test_a_relative_spelling_is_echoed_as_the_client_wrote_it(app, restricted):
    bob = _client(app, RESTRICTED)
    reply = bob.get("/api/v1/data/obs", query_string={"dataset_path": "out.zarr"})
    assert reply.status_code == 404
    assert "out.zarr" in reply.get_data(as_text=True)
    assert restricted.data not in reply.get_data(as_text=True)
    reply = bob.get("/api/v1/data/obs", query_string={"dataset_path": "../data/out.zarr"})
    assert reply.status_code == 404 and restricted.data not in reply.get_data(as_text=True)


def test_every_gated_route_for_each_kind_of_requester(app, restricted):
    """Every gated route x {admin, unrestricted, restricted in grant, restricted out of grant, anonymous}."""
    clients = {"admin": _client(app, "alice"), "unrestricted": _client(app, "carol"),
               "restricted": _client(app, RESTRICTED), "anonymous": app.test_client()}
    seen = 0
    for rule, method in restricted.rules(("dataset", "listing")):
        reply = {(who, target): restricted.request(client, rule, method, target)
                 for who, client in clients.items() for target in ("in", "out")}
        assert reply["anonymous", "out"].status_code == 401, rule.rule
        assert reply["anonymous", "in"].status_code == 401, rule.rule
        for target in ("in", "out"):
            assert same_reply(rule, reply["admin", target], reply["unrestricted", target]), (rule.rule, target)
        if access.gate_of(app, rule.endpoint) == "listing" and rule.endpoint not in FOLDER_ARG:
            continue      # names no path: what the user sees is checked by content in the listing tests
        assert same_but_not_told(rule, reply["admin", "in"], reply["restricted", "in"]), rule.rule
        if rule.endpoint != "list_legacy_datasets":      # a missing folder is a 200 with no entries there
            assert reply["restricted", "out"].status_code == 404, rule.rule
        seen += 1
    assert seen >= 30      # the dataset routes and the three folder listings of the inventory, not an empty loop
