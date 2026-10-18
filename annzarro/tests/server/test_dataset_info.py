"""/api/v1/datasets/info: a dataset's attribution, README and AnnData structure, one part at a time.

Metadata only (never X), size-capped, the text read only after the store has said how big it is, and
answered under the details route's access rules.
"""
import os
import shutil

import numpy as np
import pytest
import zarr

from annzarro.core import dataset_annotate, dataset_info
from annzarro.server import access
from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.server.routes import data_routes, dataset_info as info_routes
from annzarro.tests import zarr_compat
from annzarro.tests.core.h5ad_twin import h5ad_twin
from annzarro.tests.rich_info_store import MARKER, build_rich_store, sparse

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
FIXTURE = os.path.join(DATA, "fixture_small.zarr")
FIXTURE_V3 = os.path.join(DATA, "fixture_small_v3.zarr")
PASSWORD = "pw-for-tests"
ZARR3 = int(zarr.__version__.split(".")[0]) >= 3
URL = "/api/v1/datasets/info"
FIELDS = {"title": "Liver atlas", "description": "Cells of the adult liver.", "license": "CC-BY-4.0",
          "citation": "Doe et al. (2026) Nature.", "doi": "10.1234/abcd.5", "authors": ["Jane Doe", "John Roe"],
          "source_url": "https://example.org/liver", "contact": "jane@example.org", "attribution": "Liver Consortium"}
README = "# Liver atlas\n\nSee **the paper**.\n"


def _config(tmp_path, **extra):
    config = {"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path / "data"),
              "log_file": str(tmp_path / "t.log"), "user_file": str(tmp_path / "users.json"),
              "secret_key": "test-only-secret"}
    config.update(extra)
    return config


@pytest.fixture(autouse=True)
def fresh_caches():
    data_routes._LISTING_PROBE_CACHE.clear()
    info_routes.clear_cache()
    yield
    data_routes._LISTING_PROBE_CACHE.clear()
    info_routes.clear_cache()


@pytest.fixture
def data(tmp_path):
    root = tmp_path / "data"
    root.mkdir()
    shutil.copytree(FIXTURE, root / "plain.zarr")
    shutil.copytree(FIXTURE, root / "v2.zarr")
    dataset_annotate.annotate_store(str(root / "v2.zarr"), FIELDS, README)
    if ZARR3:
        shutil.copytree(FIXTURE_V3, root / "v3.zarr")
        dataset_annotate.annotate_store(str(root / "v3.zarr"), FIELDS, README)
    h5ad_twin(root / "v2.zarr", root / "table.h5ad")
    return root


@pytest.fixture
def client(tmp_path, data):
    return create_app(_config(tmp_path)).test_client()


def info(client, path, **args):
    return client.get(URL, query_string={"path": str(path), **args})


def put(store, rel, value, dtype=str):
    """Write ``value`` (a string, a number, an array) at uns/``rel`` of the zarr store, replacing it."""
    root = zarr_compat.open_group(store, mode="r+")
    group = root.require_group("uns")
    *parents, name = rel.split("/")
    for part in parents:
        group = group.require_group(part)
    if name in group:
        del group[name]
    arr = np.asarray(value)
    if zarr_compat.ZARR_V3:
        node = group.create_array(name, shape=arr.shape, dtype=str if arr.dtype.kind in "UO" else arr.dtype)
        node[...] = arr
    else:
        node = group.create_dataset(name, data=arr)
    zarr_compat.drop_consolidated(store) if os.path.exists(os.path.join(store, ".zmetadata")) else None
    return node


# --- the convention, in every kind of store ---------------------------------------------------------

STORES = ["v2.zarr", pytest.param("v3.zarr", marks=pytest.mark.skipif(not ZARR3, reason="needs zarr >= 3")), "table.h5ad"]


@pytest.mark.parametrize("name", STORES)
def test_about_and_readme_in_every_store_kind(client, data, name):
    body = info(client, data / name, parts="about,readme").get_json()
    about = body["about"]
    assert about["present"] and about["source"] == "annzarro" and about["ignored"] == []
    for key in ("title", "description", "license", "citation", "source_url", "contact", "attribution"):
        assert about[key] == FIELDS[key], key
    assert about["authors"] == ["Jane Doe", "John Roe"]
    assert about["doi"] == "10.1234/abcd.5" and about["doi_url"] == "https://doi.org/10.1234/abcd.5"
    assert about["license_url"] == "https://spdx.org/licenses/CC-BY-4.0.html"
    assert about["contact_url"] == "mailto:jane@example.org"
    readme = body["readme"]
    assert about["has_readme"] is True
    assert readme["text"] == README and readme["present"] and not readme["truncated"] and readme["problem"] is None
    assert body["name"] == name and "structure" not in body


@pytest.mark.parametrize("name", STORES)
def test_structure_in_every_store_kind(client, data, name):
    s = info(client, data / name, parts="structure").get_json()["structure"]
    assert (s["n_obs"], s["n_vars"]) == (200, 20)
    cols = {c["name"]: c for c in s["obs"]["columns"]}
    assert cols["cell_type"]["kind"] == "categorical" and cols["cell_type"]["categories"] > 1
    assert cols["total_counts"]["kind"] == "float" and cols["total_counts"]["dtype"].startswith("float")
    assert s["obs"]["total"] == 3 and [c["name"] for c in s["var"]["columns"]] == ["gene_name"]
    umap = s["obsm"]["items"][0]
    assert umap["name"] == "X_umap" and umap["shape"] == [200, 2]
    assert s["X"]["shape"] == [200, 20]
    assert s["layers"] == {"items": [], "total": 0}
    uns = {c["name"]: c for c in s["uns"]["children"]}
    assert uns["annzarro"]["type"] == "group" and uns["annzarro"]["total"] == len(FIELDS) + 2
    assert uns["README"]["type"] == "array"


def test_all_parts_by_default_and_only_the_asked_ones(client, data):
    assert set(info(client, data / "v2.zarr").get_json()) == {"name", "about", "readme", "structure"}
    assert set(info(client, data / "v2.zarr", parts="readme").get_json()) == {"name", "readme"}


def test_a_dataset_without_the_fields_says_so(client, data):
    body = info(client, data / "plain.zarr").get_json()
    assert body["about"]["present"] is False and body["about"]["source"] is None
    assert set(body["about"]) == {"present", "source", "fallbacks", "ignored", "has_readme", "unknown", "schema"}
    assert body["about"]["schema"]["declared"] is False and body["about"]["schema"]["version"] == "1.0"
    assert body["about"]["has_readme"] is False
    assert body["readme"] == {"present": False, "text": None, "truncated": False, "bytes": 0, "problem": None}
    assert body["structure"]["n_obs"] == 200


def test_cellxgene_fields_are_the_fallback(client, data):
    store = str(data / "plain.zarr")
    put(store, "title", "Lung, CELLxGENE")
    put(store, "citation", "Publication: https://doi.org/10.1/x Dataset Version: https://x")
    about = info(client, store, parts="about").get_json()["about"]
    assert about["source"] == "uns" and about["fallbacks"] == ["title", "citation"]
    assert about["title"] == "Lung, CELLxGENE" and about["citation"].startswith("Publication")


def test_annzarro_fields_win_over_the_fallback(client, data):
    store = str(data / "v2.zarr")
    put(store, "title", "other title")
    about = info(client, store, parts="about").get_json()["about"]
    assert about["title"] == "Liver atlas" and about["fallbacks"] == []


# --- odd values --------------------------------------------------------------------------------------

def test_a_huge_readme_is_cut_and_says_so(client, data, monkeypatch):
    store = str(data / "plain.zarr")
    text = "line of text\n" * 60_000          # 780 KB
    put(store, "README", text)
    readme = info(client, store, parts="readme").get_json()["readme"]
    assert readme["truncated"] is True and readme["bytes"] == len(text) and readme["limit_bytes"] == 256 * 1024
    assert len(readme["text"].encode()) <= 256 * 1024 and text.startswith(readme["text"])


def test_the_cut_never_splits_a_character(client, data):
    store = str(data / "plain.zarr")
    put(store, "README", "é" * 200_000)      # 2 bytes each
    text = info(client, store, parts="readme").get_json()["readme"]["text"]
    assert set(text) == {"é"} and len(text.encode()) <= 256 * 1024


def test_a_readme_stored_too_big_is_not_read(client, data, monkeypatch):
    store = str(data / "plain.zarr")
    put(store, "README", "x" * 5000)
    monkeypatch.setattr(dataset_info, "MAX_STORED_TEXT", 10)
    monkeypatch.setattr(dataset_info, "_stored_bytes", lambda node: 11)
    readme = info(client, store, parts="readme").get_json()["readme"]
    assert readme["problem"] == "too_large" and readme["text"] is None


@pytest.mark.parametrize("value", [7, 2.5, [1.0, 2.0], ["a", "b"], [["a"], ["b"]]])
def test_a_readme_that_is_not_one_string(client, data, value):
    store = str(data / "plain.zarr")
    put(store, "README", np.asarray(value))
    readme = info(client, store, parts="readme").get_json()["readme"]
    assert readme["problem"] == "not_text" and readme["text"] is None and readme["present"] is True


def test_a_readme_that_is_a_group(client, data):
    store = str(data / "plain.zarr")
    put(store, "README/inner", "x")
    readme = info(client, store, parts="readme").get_json()["readme"]
    assert readme["problem"] == "not_text" and readme["text"] is None


def test_odd_attribution_values_are_ignored_not_fatal(client, data):
    store = str(data / "plain.zarr")
    put(store, "annzarro/title", np.asarray(42))
    put(store, "annzarro/license", "MIT")
    put(store, "annzarro/license_url", "javascript:alert(1)")
    put(store, "annzarro/source_url", "ftp://example.org/x")
    put(store, "annzarro/doi", "not a doi at all")
    put(store, "annzarro/contact", "see the lab website")
    put(store, "annzarro/authors", "Solo Author")
    put(store, "annzarro/citation", np.asarray(["a", "b"]))
    put(store, "annzarro/unknown_key", "x")
    about = info(client, store, parts="about").get_json()["about"]
    assert "title" not in about and "citation" not in about
    assert about["license"] == "MIT" and about["license_url"] == "https://spdx.org/licenses/MIT.html"
    assert "source_url" not in about and "unknown_key" not in about
    assert about["doi"] == "not a doi at all" and "doi_url" not in about
    assert "contact_url" not in about and about["authors"] == ["Solo Author"]
    assert set(about["ignored"]) >= {"annzarro/title", "annzarro/citation", "annzarro/source_url"}


def test_a_licence_text_is_shown_and_a_custom_url_wins(client, data):
    store = str(data / "plain.zarr")
    put(store, "annzarro/licence", "Free for non-commercial research (see link)")
    put(store, "annzarro/licence_url", "https://example.org/terms")
    about = info(client, store, parts="about").get_json()["about"]
    assert about["license"].startswith("Free for") and about["license_url"] == "https://example.org/terms"


def test_doi_forms_are_normalised(client, data):
    store = str(data / "plain.zarr")
    for spelled in ("10.5281/zenodo.123", "doi:10.5281/zenodo.123", "https://doi.org/10.5281/zenodo.123"):
        put(store, "annzarro/doi", spelled)
        info_routes.clear_cache()
        about = info(client, store, parts="about").get_json()["about"]
        assert about["doi"] == "10.5281/zenodo.123" and about["doi_url"] == "https://doi.org/10.5281/zenodo.123"


def test_annzarro_that_is_not_a_group(client, data):
    store = str(data / "plain.zarr")
    put(store, "annzarro", "just text")
    about = info(client, store, parts="about").get_json()["about"]
    assert about["present"] is False and about["ignored"] == ["annzarro"]


def test_a_long_field_is_cut_and_markup_is_returned_as_is(client, data):
    store = str(data / "plain.zarr")
    put(store, "annzarro/description", "<script>alert(1)</script>" + "d" * 40_000)
    about = info(client, store, parts="about").get_json()["about"]
    assert len(about["description"].encode()) <= dataset_info.MAX_FIELD_BYTES
    assert about["description"].startswith("<script>")      # the page shows text as text


def test_control_characters_are_dropped(client, data):
    store = str(data / "plain.zarr")
    put(store, "annzarro/title", "A\x00B\x07C")
    assert info(client, store, parts="about").get_json()["about"]["title"] == "ABC"


# --- the structure is capped -------------------------------------------------------------------------

def test_the_uns_tree_is_capped_in_depth_and_count(client, data, monkeypatch):
    store = str(data / "plain.zarr")
    put(store, "deep/a/b/c/d/e/leaf", "x")
    for i in range(8):
        put(store, f"many/k{i}", "x")
    monkeypatch.setattr(dataset_info, "MAX_UNS_DEPTH", 3)
    monkeypatch.setattr(dataset_info, "MAX_UNS_CHILDREN", 5)
    uns = {c["name"]: c for c in info(client, store, parts="structure").get_json()["structure"]["uns"]["children"]}
    assert uns["many"]["total"] == 8 and len(uns["many"]["children"]) == 5
    node = uns["deep"]
    for _ in range(2):
        node = node["children"][0]
    assert node["children"] == [] and node["total"] == 1, "the tree stops at the depth and says what is below"


def test_the_uns_tree_has_a_node_budget(client, data, monkeypatch):
    store = str(data / "plain.zarr")
    for i in range(30):
        put(store, f"g{i}/x", "x")
    monkeypatch.setattr(dataset_info, "MAX_UNS_NODES", 10)
    uns = info(client, store, parts="structure").get_json()["structure"]["uns"]
    assert uns["capped"] is True and len(uns["children"]) < 30


def test_obs_columns_and_matrix_keys_are_capped(client, data, monkeypatch):
    from annzarro.core import store_details
    monkeypatch.setattr(store_details, "MAX_NAMES", 2)
    monkeypatch.setattr(dataset_info, "MAX_ITEMS", 0)
    s = info(client, data / "v2.zarr", parts="structure").get_json()["structure"]
    assert len(s["obs"]["columns"]) == 2 and s["obs"]["total"] == 3
    assert s["obsm"] == {"items": [], "total": 1}


def test_the_structure_reads_only_heads_of_categories_and_small_uns_values(client, data, monkeypatch):
    read = []
    real = zarr.Array.__getitem__

    def watch(self, selection):
        read.append(self.path)
        return real(self, selection)
    monkeypatch.setattr(zarr.Array, "__getitem__", watch)
    assert info(client, data / "v2.zarr", parts="structure").status_code == 200
    assert all(not p.startswith(("X", "obsm", "layers", "raw")) and (p.startswith("uns/") or p.endswith("categories")) for p in read), read
    read.clear()
    assert info(client, data / "v2.zarr", parts="about,readme").status_code == 200
    assert read and all(p.startswith("uns/") for p in read), read


# --- errors and arguments ----------------------------------------------------------------------------

def test_arguments(client, data):
    assert client.get(URL).status_code == 400
    bad = info(client, data / "v2.zarr", parts="about,secrets")
    assert bad.status_code == 400 and bad.get_json()["reason"] == "bad_parts"
    assert info(client, data / "v2.zarr", parts=",").status_code == 400


def test_a_missing_store_answers_as_data_info_does(client, data):
    gone = data / "gone.zarr"
    mine = info(client, gone)
    theirs = client.get("/api/v1/data/info", query_string={"dataset_path": str(gone)})
    assert (mine.status_code, mine.get_json()) == (theirs.status_code, theirs.get_json()) and mine.status_code == 404


def test_a_broken_store_is_a_422_with_the_reason(client, data):
    (data / "broken.zarr").mkdir()
    reply = info(client, data / "broken.zarr")
    assert reply.status_code == 422 and reply.get_json()["reason"] == "unreadable" and reply.get_json()["error"]


def test_the_reply_never_carries_the_path(client, data):
    assert str(data) not in info(client, data / "v2.zarr").get_data(as_text=True)


# --- cache -------------------------------------------------------------------------------------------

def test_parts_are_cached_and_a_changed_store_is_read_again(client, data, monkeypatch):
    calls = []
    real = dataset_info.read_info

    def counting(path, parts, remote=False):
        calls.append(tuple(parts))
        return real(path, parts, remote=remote)
    monkeypatch.setattr(dataset_info, "read_info", counting)
    store = data / "v2.zarr"
    info(client, store, parts="about")
    info(client, store, parts="about")
    assert calls == [("about",)]
    info(client, store, parts="about,readme")
    assert calls == [("about",), ("readme",)], "only the part not yet held is read"
    dataset_annotate.annotate_store(str(store), {"title": "Renamed"})
    os.utime(store / "uns" / "annzarro", (1, 1))        # a coarse clock must not hide the change from the test
    assert info(client, store, parts="about").get_json()["about"]["title"] == "Renamed"


# --- remote ------------------------------------------------------------------------------------------

REMOTE = "s3://lab-bucket/atlas.zarr"


def test_a_remote_store_is_read_through_the_remote_opener(client, data, monkeypatch):
    from annzarro.core import remote, zarr_reader
    opened = []
    monkeypatch.setattr(remote, "check_remote_access", lambda url: None)
    monkeypatch.setattr(zarr_reader, "_get_root", lambda path: opened.append(path) or zarr_compat.open_group(data / "v2.zarr", mode="r"))
    monkeypatch.setattr(info_routes.time, "time", lambda: 1_000_000.0)     # one TTL window, whatever the clock says
    body = info(client, REMOTE).get_json()
    assert opened == [REMOTE] and body["name"] == "atlas.zarr"
    assert body["about"]["title"] == "Liver atlas" and body["structure"]["n_obs"] == 200
    info(client, REMOTE)
    assert opened == [REMOTE], "cached for a minute"


def test_remote_stores_follow_the_server_policy(tmp_path):
    client = create_app(_config(tmp_path, remote_stores="deny")).test_client()
    reply = info(client, REMOTE)
    assert reply.status_code == 403 and reply.get_json()["reason"] == "access_denied"


# --- who may ask -------------------------------------------------------------------------------------

@pytest.fixture
def shared(tmp_path, data):
    """data/{in.zarr, out.zarr, pub/p1.zarr}: bob is restricted to in.zarr and pub."""
    shutil.copytree(data / "v2.zarr", data / "in.zarr")
    shutil.copytree(data / "v2.zarr", data / "out.zarr")
    (data / "pub").mkdir()
    shutil.copytree(data / "v2.zarr", data / "pub" / "p1.zarr")
    manager = AuthManager(user_file=str(tmp_path / "users.json"))
    for name, admin in (("alice", True), ("bob", False)):
        manager.add_user(name, PASSWORD, is_admin=admin)
    app = create_app(_config(tmp_path, auth_enabled=True))
    access.add_grant(app.config, "bob", "store", str(data / "in.zarr"), actor="alice")
    access.add_grant(app.config, "bob", "dir", str(data / "pub"), actor="alice")
    access.set_restricted(app.config, "bob", True)
    app.data = data
    return app


def login(app, name):
    client = app.test_client()
    assert client.post("/login", data={"username": name, "password": PASSWORD}).status_code == 302
    return client


def test_a_restricted_user_reads_only_what_is_granted(shared):
    bob = login(shared, "bob")
    for granted in (shared.data / "in.zarr", shared.data / "pub" / "p1.zarr"):
        body = info(bob, granted).get_json()
        assert body["about"]["title"] == "Liver atlas" and str(shared.data) not in str(body)
    missing = info(bob, shared.data / "nope.zarr")
    assert missing.status_code == 404
    shape = lambda reply, spelled: (reply.status_code, reply.get_data(as_text=True).replace(str(spelled), "PATH"))  # noqa: E731
    out = shared.data / "out.zarr"
    assert shape(info(bob, out), out) == shape(missing, shared.data / "nope.zarr"), "forbidden looks like missing"
    assert "Liver atlas" not in info(bob, out).get_data(as_text=True)


def test_login_comes_first(shared):
    reply = shared.test_client().get(URL, query_string={"path": str(shared.data / "in.zarr")})
    assert reply.status_code in (302, 401)


def test_a_hosted_server_refuses_a_path_outside_its_roots(tmp_path, data):
    outside = tmp_path / "outside"
    shutil.copytree(FIXTURE, outside / "secret.zarr")
    app = create_app(_config(tmp_path, host="0.0.0.0"))
    reply = info(app.test_client(), outside / "secret.zarr")
    assert reply.status_code == 403 and reply.get_json()["reason"] == "outside_data_dir"


# --- the structure, element by element -------------------------------------------------------------------


@pytest.fixture
def rich(tmp_path):
    return build_rich_store(tmp_path / "rich.zarr", FIXTURE)


def structure(client, store):
    return info(client, store, parts="structure").get_json()["structure"]


def test_an_encoded_uns_member_is_one_element_not_a_group(client, rich):
    uns = {c["name"]: c for c in structure(client, rich)["uns"]["children"]}
    assert (uns["df"]["type"], uns["df"]["encoding"], uns["df"]["columns"]) == ("encoded", "dataframe", 3)
    assert uns["df"]["column_names"] == ["a", "b", "c"]
    assert (uns["cat"]["encoding"], uns["cat"]["categories"], uns["cat"]["ordered"]) == ("categorical", 2, False)
    assert (uns["mat"]["encoding"], uns["mat"]["shape"], uns["mat"]["nnz"]) == ("csr_matrix", [4, 4], 4)
    for entry in uns.values():
        assert "children" not in entry or entry["name"] == "annzarro"


def test_a_dataframe_in_obsm_follows_column_order_and_sparse_has_nnz_and_density(client, rich):
    s = structure(client, rich)
    items = {i["name"]: i for i in s["obsm"]["items"]}
    assert items["frame"]["columns"] == 2 and items["frame"]["column_names"] == ["u", "v"] and items["frame"]["shape"] == [4, 2]
    sparse = items["X_sparse"]
    assert (sparse["encoding"], sparse["nnz"], sparse["density"]) == ("csr_matrix", 4, 0.25)
    assert (items["awk"]["encoding"], items["awk"]["length"]) == ("awkward-array", 200) and "children" not in items["awk"]
    x = s["X"]
    assert x["encoding"] in ("csc_matrix", "csr_matrix") and x["nnz"] > 0 and 0 < x["density"] <= 1


def test_density_of_an_empty_matrix_does_not_divide_by_zero(client, rich):
    root = zarr_compat.open_group(rich, mode="r+")
    node = sparse(root["layers"], "empty", np.zeros((0, 5)))
    zarr_compat.consolidate(rich)
    item = [i for i in structure(client, rich)["layers"]["items"] if i["name"] == "empty"][0]
    assert item["nnz"] == 0 and item["density"] is None and node is not None


def test_colours_are_counted_against_categories_and_flags_are_kept(client, rich):
    cols = {c["name"]: c for c in structure(client, rich)["obs"]["columns"]}
    ct, leiden = cols["cell_type"], cols["leiden"]
    assert (ct["categories"], ct["colors"], ct["colors_mismatch"], ct["ordered"]) == (3, 2, True, True)
    assert (leiden["categories"], leiden["colors"], leiden["colors_mismatch"], leiden["ordered"]) == (5, 5, False, False)
    assert leiden["label_colors"] == ["#111111", "#222222", "#333333", "#444444", "#555555"] and len(leiden["labels"]) == 5
    assert ct["codes_dtype"].startswith("int")
    assert "colors" not in cols["total_counts"] and cols["age"]["nullable"] is True and cols["age"]["kind"] == "integer"


def test_the_index_name_and_dtype_are_reported(client, rich):
    obs = structure(client, rich)["obs"]
    assert obs["index"] == "_index" and obs["index_dtype"] == "string"


def test_labels_are_the_head_of_the_categories_under_a_budget(client, rich, monkeypatch):
    monkeypatch.setattr(dataset_info, "CATEGORY_LABELS", 2)
    cols = {c["name"]: c for c in structure(client, rich)["obs"]["columns"]}
    assert len(cols["leiden"]["labels"]) == 2 and len(cols["leiden"]["label_colors"]) == 2
    info_routes.clear_cache()
    monkeypatch.setattr(dataset_info, "MAX_LABEL_COLUMNS", 1)
    cols = structure(client, rich)["obs"]["columns"]
    assert sum("labels" in c for c in cols) == 1, "labels are read for the first columns only"


def test_remote_structure_reads_no_labels_and_stops_at_its_deadline(client, rich, monkeypatch):
    from annzarro.core import remote, zarr_reader
    monkeypatch.setattr(remote, "check_remote_access", lambda url: None)
    monkeypatch.setattr(zarr_reader, "_get_root", lambda path: zarr_compat.open_group(rich, mode="r"))
    body = info(client, REMOTE, parts="structure").get_json()["structure"]
    assert body["capped"] is None and all("labels" not in c for c in body["obs"]["columns"])
    assert body["caps"]["remote_budget_s"] == dataset_info.REMOTE_BUDGET_S
    info_routes.clear_cache()
    monkeypatch.setattr(dataset_info, "REMOTE_BUDGET_S", -1.0)
    cut = info(client, REMOTE, parts="structure").get_json()["structure"]
    assert cut["capped"] == "deadline" and cut["obs"]["total"] == 5 and len(cut["obs"]["columns"]) < 5


def test_raw_and_unknown_groups_are_listed(client, rich):
    s = structure(client, rich)
    assert s["raw"]["shown_in_plots"] is False and s["raw"]["X"]["shape"] == [200, 30]
    assert s["raw"]["var_columns"] == 2 and s["raw"]["varm_keys"] == []
    assert s["other"] == [{"name": "obst", "encoding": "dict"}]


def test_a_store_without_raw_or_extras_says_nothing(client, data):
    s = structure(client, data / "plain.zarr")
    assert s["raw"] is None and s["other"] == [] and s["caps"]["label_chars"] == 100 and s["capped"] is None


def test_uns_previews_are_short_and_capped(client, rich, monkeypatch):
    uns = {c["name"]: c for c in structure(client, rich)["uns"]["children"]}
    assert uns["n"]["value"] == "7" and uns["note"]["value"] == MARKER and "value" not in uns["big"]
    assert uns["cell_type_colors"]["colors"] == ["#ff0000", "red; background:url(x)"]
    info_routes.clear_cache()
    monkeypatch.setattr(dataset_info, "MAX_UNS_PREVIEWS", 0)
    assert "value" not in {c["name"]: c for c in structure(client, rich)["uns"]["children"]}["n"]


def test_a_long_string_value_and_names_are_cut(client, rich):
    put(str(rich), "long", "z" * 5000)
    put(str(rich), "k" * 250, "v")
    uns = {c["name"]: c for c in structure(client, rich)["uns"]["children"]}
    assert len(uns["long"]["value"]) == dataset_info.LABEL_CHARS
    assert [n for n in uns if n.startswith("kkk")] and max(len(n) for n in uns) <= 200


def test_a_record_dtype_has_a_short_label(client, rich):
    dtype = np.dtype([(f"f{i}", "U5") for i in range(30)])
    assert dataset_info._dtype_label(dtype) == "record, 30 fields"
    assert len(dataset_info._dtype_label(np.dtype("U" + "5"))) <= 100
    assert len(dataset_info._short("x" * 10_000)) == 100


def test_the_marker_in_every_name_stays_text(client, rich):
    """Every place the structure carries dataset text: it is data, and the client sets it as text."""
    body = info(client, rich, parts="structure").get_data(as_text=True)
    assert "MARKER" in body
    s = structure(client, rich)
    names = [c["name"] for c in s["obs"]["columns"]] + [c["name"] for c in s["uns"]["children"]]
    assert names.count(MARKER) == 2


def test_the_rich_store_reads_the_same_from_an_h5ad_twin(client, rich, tmp_path):
    h5ad_twin(rich, rich.parent / "twin.h5ad")
    s = structure(client, rich.parent / "twin.h5ad")
    uns = {c["name"]: c for c in s["uns"]["children"]}
    assert uns["df"]["encoding"] == "dataframe" and uns["mat"]["nnz"] == 4
    assert s["raw"]["X"]["shape"] == [200, 30] and s["other"][0]["name"] == "obst"
