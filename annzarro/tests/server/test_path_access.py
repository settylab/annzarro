"""
Which dataset paths each requester may open (``server.arbitrary_paths``).

On a shared server (login on, or a network host) every local path a request
names must resolve -- realpath, so ``..`` and symlinks are followed --
inside ``data_dir`` or ``allowed_dirs``, except for admins under the default
``admins`` (each such open is logged with the admin's name). The single
user of a local server (loopback, no login: a laptop, the desktop app) may
open any path. ``local-only`` confines admins of a shared server too; ``none``
confines everyone, local servers included.

Every route that takes a path is listed in ROUTES and probed with each
escape in ESCAPES; test_every_route_is_classified fails when a route is
added without deciding whether it takes a path.
"""
import os
import shutil

import pytest

from annzarro.core import h5ad_reader_obj, zarr_reader
from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.utils.config_manager import ConfigManager

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "data", "fixture_small.zarr")

#: (method, URL template, how the path is passed). {p} is a full path,
#: {d} a directory, {seg} a path relative to data_dir.
ROUTES = [
    ("GET", "/api/v1/data/info?dataset_path={p}"),
    ("GET", "/api/v1/data/info?dataset_id={p}"),
    ("GET", "/api/v1/data/dataset_structure?dataset_path={p}"),
    ("GET", "/api/v1/data/X?dataset_path={p}&cols=0"),
    ("GET", "/api/v1/data/layer/counts?dataset_path={p}&cols=0"),
    ("GET", "/api/v1/data/obs?dataset_path={p}&columns=leiden"),
    ("GET", "/api/v1/data/var?dataset_path={p}&columns=gene_name"),
    ("GET", "/api/v1/data/obsm/X_umap?dataset_path={p}&rows=0"),
    ("GET", "/api/v1/data/varm/x?dataset_path={p}"),
    ("GET", "/api/v1/data/obsp/x?dataset_path={p}"),
    ("GET", "/api/v1/data/varp/x?dataset_path={p}"),
    ("GET", "/api/v1/data/uns/x?dataset_path={p}"),
    ("GET", "/api/v1/data/cells?dataset_path={p}"),
    ("GET", "/api/v1/data/genes?dataset_path={p}"),
    ("GET", "/api/v1/data/names?dataset_path={p}&axis=obs&q=cell"),
    ("GET", "/api/v1/data/subset?dataset_path={p}"),
    ("GET", "/api/v1/data/subset/locate?dataset_path={p}"),
    ("GET", "/api/v1/data/statistics?dataset_path={p}"),
    ("GET", "/api/v1/data/by_path?dataset_path={p}&path=obsm/X_umap"),
    ("GET", "/api/v1/data/paginated?dataset_path={p}&matrix_type=X&rows=0"),
    ("GET", "/api/v1/data/obsm_dataframe_columns?dataset_path={p}&obsm_key=X_umap"),
    ("GET", "/api/v1/data/varm_dataframe_columns?dataset_path={p}&varm_key=x"),
    ("GET", "/api/v1/datasets/uns/x?dataset_path={p}"),
    ("GET", "/api/v1/zarr/to_anndata?dataset_path={p}"),
    ("POST", "/api/v1/data/refresh?dataset_path={p}"),
    ("POST", "/api/v1/cache/reset?dataset_path={p}"),
    ("GET", "/api/v1/core/datasets?dir={d}"),
    ("GET", "/api/v1/directories/list?path={d}"),
    ("GET", "/api/v1/datasets/{seg}"),
    ("GET", "/api/v1/datasets/{seg}/info"),
    ("GET", "/api/v1/datasets/{seg}/uns/structure"),
    ("GET", "/api/v1/datasets/{seg}/uns/x"),
]

#: Endpoints that take no filesystem path from the request (or only one
#: confined by its own rule, like panel-set files in the sessions directory).
NO_PATH = {
    "serve_static", "static", "get_current_user", "get_cache_info", "get_config", "get_status",
    "list_all_datasets", "get_home_directory", "validate_zarr_url",  # remote policy, below
    "delete_session", "duplicate_session", "check_session_exists", "export_session",
    "import_session", "list_sessions", "load_session", "set_session_owner",
    "rename_session", "save_session", "login_page", "login", "logout",
}


@pytest.fixture(scope="module")
def layout(tmp_path_factory):
    root = tmp_path_factory.mktemp("paths")
    data, outside = root / "data", root / "outside"
    data.mkdir()
    outside.mkdir()
    shutil.copytree(FIXTURE, data / "inside.zarr")
    shutil.copytree(FIXTURE, outside / "secret.zarr")
    (outside / "secret.h5ad").write_bytes(b"not read")
    os.symlink(outside / "secret.zarr", data / "link.zarr")
    os.symlink(outside, data / "linkdir")
    users = root / "users.json"
    manager = AuthManager(user_file=str(users))
    manager.create_user("alice", "pw")
    manager.create_user("root", "pw", is_admin=True)
    return root


def escapes(root):
    data, outside = root / "data", root / "outside"
    return {
        "absolute": str(outside / "secret.zarr"),
        "dotdot": str(data / ".." / "outside" / "secret.zarr"),
        "symlinked store": str(data / "link.zarr"),
        "symlinked dir": str(data / "linkdir" / "secret.zarr"),
        "relative to data_dir": "../outside/secret.zarr",
        "file://": "file://" + str(outside / "secret.zarr"),
        "h5ad": str(outside / "secret.h5ad"),
    }


_CLIENTS = {}


def _cached_client(root, who, **settings):
    """One app per (who, settings) for the route sweeps; creating one per
    route and case made this module take minutes."""
    key = (str(root), who, tuple(sorted(settings.items())))
    if key not in _CLIENTS:
        _CLIENTS[key] = _client(root, who, **settings)
    return _CLIENTS[key]


def _client(root, who, **settings):
    """who: local | open-net | user | admin"""
    config = {"TESTING": True, "data_dir": str(root / "data"), "log_file": str(root / "l.log"),
              "user_file": str(root / "users.json"), "secret_key": "s" * 32,
              "refresh_min_interval_s": 0,   # the sweep refreshes each store many times
              "host": "0.0.0.0" if who == "open-net" else "127.0.0.1",
              "auth_enabled": who in ("user", "admin")}
    config.update(settings)
    zarr_reader.clear_cache()
    h5ad_reader_obj.clear_cache()
    client = create_app(config).test_client()
    if who in ("user", "admin"):
        client.post("/login", data={"username": "alice" if who == "user" else "root", "password": "pw"})
    return client


def _url(template, root, path):
    data = root / "data"
    seg = os.path.relpath(path, data) if os.path.isabs(path) else path
    return template.format(p=path, d=os.path.dirname(path) or path, seg=seg)


def _refused(resp):
    return resp.status_code == 403 and (resp.get_json(silent=True) or {}).get("reason") == "outside_data_dir"


def _probe(client, root, method, template, name, path):
    if "{seg}" in template and "://" in path:
        return None                                  # not expressible as a URL path segment
    if "{d}" in template and name in ("symlinked store", "h5ad", "file://"):
        return None                                  # the parent is data_dir or the same dir as another case
    return client.open(_url(template, root, path), method=method)


CONFINED = [("open-net", {}), ("user", {}), ("user", {"arbitrary_paths": "admins"}),
            ("admin", {"arbitrary_paths": "local-only"}), ("user", {"arbitrary_paths": "none"}),
            ("local", {"arbitrary_paths": "none"}), ("admin", {"arbitrary_paths": "none"})]


@pytest.mark.parametrize("who,settings", CONFINED, ids=[f"{w}-{s.get('arbitrary_paths', 'default')}" for w, s in CONFINED])
@pytest.mark.parametrize("method,template", ROUTES, ids=[t.split("?")[0] for _, t in ROUTES])
def test_escapes_are_refused(layout, who, settings, method, template):
    client = _cached_client(layout, who, **settings)
    for name, path in escapes(layout).items():
        resp = _probe(client, layout, method, template, name, path)
        if resp is None:
            continue
        assert _refused(resp), f"{name} {path!r}: {resp.status_code} {resp.get_data(as_text=True)[:200]}"


OPEN = [("local", {}), ("local", {"arbitrary_paths": "local-only"}), ("admin", {}),
        ("admin", {"arbitrary_paths": "admins"})]


@pytest.mark.parametrize("who,settings", OPEN, ids=[f"{w}-{s.get('arbitrary_paths', 'default')}" for w, s in OPEN])
@pytest.mark.parametrize("method,template", ROUTES, ids=[t.split("?")[0] for _, t in ROUTES])
def test_arbitrary_paths_where_allowed(layout, who, settings, method, template):
    client = _cached_client(layout, who, **settings)
    for name, path in escapes(layout).items():
        resp = _probe(client, layout, method, template, name, path)
        if resp is None:
            continue
        assert not _refused(resp), f"{name}: refused"


@pytest.mark.parametrize("who,settings", CONFINED + OPEN)
def test_paths_inside_the_data_dir_always_open(layout, who, settings):
    client = _cached_client(layout, who, **settings)
    inside = str(layout / "data" / "inside.zarr")
    for method, template in ROUTES:
        resp = client.open(_url(template, layout, inside), method=method)
        assert not _refused(resp), template


def test_every_route_is_classified(layout):
    app = create_app({"TESTING": True, "data_dir": str(layout / "data"), "log_file": str(layout / "l.log"),
                      "user_file": str(layout / "users.json"), "auth_enabled": True, "secret_key": "s" * 32})
    probed = set()
    for _, template in ROUTES:
        path = template.split("?")[0].replace("{seg}", "x.zarr")
        adapter = app.url_map.bind("localhost")
        method = "POST" if template in ("/api/v1/data/refresh?dataset_path={p}",
                                        "/api/v1/cache/reset?dataset_path={p}") else "GET"
        probed.add(adapter.match(path, method=method)[0])
    unclassified = {rule.endpoint for rule in app.url_map.iter_rules()} - probed - NO_PATH
    assert not unclassified, f"routes neither probed for path escapes nor declared path-free: {unclassified}"


def test_revoking_admin_takes_effect_at_once(layout):
    client = _client(layout, "admin", arbitrary_paths="admins")
    url = "/api/v1/data/info?dataset_path=" + escapes(layout)["absolute"]
    assert not _refused(client.get(url))
    AuthManager(user_file=str(layout / "users.json")).set_admin("root", False)
    try:
        assert _refused(client.get(url))
    finally:
        AuthManager(user_file=str(layout / "users.json")).set_admin("root", True)


def test_admins_may_open_any_path_by_default_and_each_open_is_logged(layout):
    import logging
    client = _client(layout, "admin")          # create_app resets the root handlers
    records = []
    handler = logging.Handler(level=logging.INFO)
    handler.emit = records.append
    log = logging.getLogger("annzarro.server.confinement")
    log.addHandler(handler)
    level = log.level
    log.setLevel(logging.INFO)
    try:
        path = escapes(layout)["absolute"]
        resp = client.get("/api/v1/data/info", query_string={"dataset_path": path})
    finally:
        log.removeHandler(handler)
        log.setLevel(level)
    assert resp.status_code == 200
    assert any("Admin 'root' opened a path outside the data directory" in r.getMessage() and path in r.getMessage()
               for r in records)


def test_the_default_is_admins(layout, monkeypatch, tmp_path):
    from annzarro.server.confinement import arbitrary_paths_mode
    assert arbitrary_paths_mode({}) == "admins"
    for var in list(os.environ):
        if var.startswith("ANNZARRO_"):
            monkeypatch.delenv(var)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(ConfigManager, "SYSTEM_CONFIG_PATH", str(tmp_path / "none.yaml"))
    mgr = ConfigManager()
    mgr.load_config(env="production")
    assert mgr.config["server"]["arbitrary_paths"] == "admins"
    assert mgr._load_schema()["server"]["properties"]["arbitrary_paths"]["default"] == "admins"


def test_anonymous_gets_401_not_403(layout):
    client = _client(layout, "user", arbitrary_paths="admins")
    client.get("/logout")
    resp = client.get("/api/v1/data/info?dataset_path=" + escapes(layout)["absolute"])
    assert resp.status_code == 401


@pytest.mark.parametrize("who,settings,expected", [
    ("local", {}, True), ("local", {"arbitrary_paths": "none"}, False), ("open-net", {}, False),
    ("user", {}, False), ("admin", {}, True), ("admin", {"arbitrary_paths": "local-only"}, False),
    ("admin", {"arbitrary_paths": "none"}, False), ("user", {"arbitrary_paths": "admins"}, False),
])
def test_auth_me_says_whether_any_path_opens(layout, who, settings, expected):
    assert _client(layout, who, **settings).get("/api/v1/auth/me").get_json()["may_open_any_path"] is expected


def test_listing_shows_escaping_links_only_to_who_may_open_them(layout):
    def names(client):
        listed = client.get("/api/v1/directories/list", query_string={"path": str(layout / "data")}).get_json()
        return {e["name"] for e in listed["zarr_stores"] + listed["directories"]}
    assert "link.zarr" not in names(_client(layout, "user", arbitrary_paths="admins"))
    assert "link.zarr" in names(_client(layout, "admin", arbitrary_paths="admins"))


def test_remote_urls_follow_the_remote_store_policy(layout):
    client = _client(layout, "user")
    resp = client.get("/api/v1/data/info", query_string={"dataset_path": "http://127.0.0.1:9/x.zarr"})
    assert resp.status_code == 403 and resp.get_json()["reason"] == "access_denied"
    assert client.get("/api/v1/zarr/url", query_string={"url": "http://127.0.0.1:9/x.zarr"}).get_json()["valid"] is False


def test_a_misspelt_setting_is_refused(layout, monkeypatch, tmp_path):
    with pytest.raises(ValueError, match="arbitrary_paths"):
        _client(layout, "local", arbitrary_paths="everyone")
    for var in list(os.environ):
        if var.startswith("ANNZARRO_"):
            monkeypatch.delenv(var)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(ConfigManager, "SYSTEM_CONFIG_PATH", str(tmp_path / "none.yaml"))
    monkeypatch.setenv("ANNZARRO_SERVER_ARBITRARY_PATHS", "everyone")
    mgr = ConfigManager()
    mgr.load_config(env="production")
    valid, errors = mgr.validate_config()
    assert not valid and any("arbitrary_paths" in e for e in errors)
