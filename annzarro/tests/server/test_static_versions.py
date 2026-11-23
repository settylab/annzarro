"""After an upgrade the browser loads the new version's scripts and styles.

Flask serves static files with an ETag and Last-Modified only, so a browser may
reuse an old copy heuristically, and 0.8.0 changes files in place (the Plotly
file keeps its name). Two measures together:

* every static URL a page names carries ``?v=<token>`` (the app's version; in
  a source checkout also the file's mtime, since the version does not move
  between edits), except ES-module scripts;
* every .js and .css reply is ``Cache-Control: no-cache``, so the browser
  revalidates it (a 304 through the ETag, cheap) on every load. Flask 2 and
  later send this by default (the dependency floor is flask>=2.0), so the tests
  below pin it rather than the server adding it.

Module scripts stay unversioned because a module is identified by its URL: the
entries (config.js, data-manager.js ...) are also imported by other modules by
relative path, which carries no query, so a versioned entry would run twice, as
two separate modules with two copies of their state. Imported modules cannot
carry the token either (a relative import resolves without the importer's
query), so revalidation is what guarantees no new HTML runs with old modules.
"""
import re
from pathlib import Path

import pytest

import annzarro
from annzarro.server.core import create_app

TEMPLATES = Path(__file__).resolve().parents[3] / "templates"
STATIC_REF = re.compile(r"""(?:src|href)="([^"]*?/static/[^"]*)\"|url\("([^"]*?/static/[^"]*)"\)""")


@pytest.fixture
def client(tmp_path):
    return create_app({"auth_enabled": False, "data_dir": str(tmp_path)}).test_client()


def _index_refs(client):
    html = client.get("/").get_data(as_text=True)
    refs = []
    for line in html.splitlines():
        for m in STATIC_REF.finditer(line):
            refs.append((m.group(1) or m.group(2), 'type="module"' in line))
    return refs


def test_the_index_page_names_static_files(client):
    assert len(_index_refs(client)) > 30


def test_every_classic_static_url_in_the_index_page_carries_the_token(client):
    bare = [u for u, module in _index_refs(client) if not module and not re.search(r"\?v=[^&\"]+$", u)]
    assert bare == []


def test_module_scripts_stay_unversioned_so_a_module_loads_once(client):
    modules = [u for u, module in _index_refs(client) if module]
    assert len(modules) >= 10
    assert [u for u in modules if "?" in u] == []


def test_no_template_names_a_static_file_without_the_helper():
    """Every static reference goes through static_url, except module scripts (url_for)."""
    offenders = []
    for path in sorted(TEMPLATES.glob("*.html")):
        for n, line in enumerate(path.read_text().splitlines(), 1):
            if "url_for('static'" in line and 'type="module"' not in line:
                offenders.append(f"{path.name}:{n}")
    assert offenders == []


def test_the_token_changes_with_the_version(client, monkeypatch):
    before = {u for u, module in _index_refs(client) if not module}
    monkeypatch.setattr(annzarro, "__version__", "9.9.9")
    after = {u for u, module in _index_refs(client) if not module}
    assert before and after and not (before & after)
    assert all("v=9.9.9" in u for u in after)


def test_an_installed_copy_uses_the_version_alone(tmp_path, monkeypatch):
    from annzarro.server import static_versions
    f = tmp_path / "a.js"
    f.write_text("x")
    monkeypatch.setattr(static_versions, "in_source_checkout", lambda: False)
    monkeypatch.setattr(annzarro, "__version__", "1.2.3")
    assert static_versions.token_for(f) == "1.2.3"


def test_a_source_checkout_adds_the_files_own_edit_time(tmp_path, monkeypatch):
    import os
    from annzarro.server import static_versions
    f = tmp_path / "a.js"
    f.write_text("x")
    monkeypatch.setattr(static_versions, "in_source_checkout", lambda: True)
    monkeypatch.setattr(annzarro, "__version__", "1.2.3")
    os.utime(f, (1_000_000, 1_000_000))
    one = static_versions.token_for(f)
    os.utime(f, (2_000_000, 2_000_000))
    two = static_versions.token_for(f)
    assert one.startswith("1.2.3.") and two.startswith("1.2.3.") and one != two


@pytest.mark.parametrize("path", [
    "/static/js/main.js", "/static/js/utils/app-url.js", "/static/css/theme.css",
    "/static/vendor/css/bootstrap.min.css", "/static/js/main.js?v=0.8.0",
])
def test_scripts_and_styles_are_revalidated_on_every_load(client, path):
    resp = client.get(path)
    assert resp.status_code == 200
    assert "no-cache" in resp.headers["Cache-Control"]
    assert resp.headers.get("ETag")
    again = client.get(path.split("?")[0], headers={"If-None-Match": resp.headers["ETag"]})
    assert again.status_code == 304
    assert "no-cache" in again.headers["Cache-Control"]
