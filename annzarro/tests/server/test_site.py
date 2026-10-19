"""The site's legal links, texts, robots policy and security.txt (annzarro/server/site.py)."""
import datetime
import logging
import os
import re
import shutil

import pytest
from flask import Flask
from jinja2 import FileSystemLoader

from annzarro.server.core import create_app
from annzarro.tests.server.admin_helpers import ADMIN, PASSWORD, USER, login, make_app
from annzarro.utils.config_manager import ConfigManager

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
TEMPLATES = os.path.join(REPO, "templates")

IMPRINT = "# Imprint\n\n**Example Institute**  \nMain Street 1, 12345 Town\n\nE-mail: [office@example.org](mailto:office@example.org)"
SITE = {"imprint": {"markdown": IMPRINT, "label": "Impressum"},
        "privacy": {"url": "https://example.org/privacy", "label": "Datenschutz"},
        "operator": "Example Institute, University of X",
        "contact": "office@example.org", "contact_label": "Kontakt", "languages": "de"}


def app_with(tmp_path, site=None, auth=False, **config):
    config = dict(config)
    if site is not None:
        config["site"] = site
    return make_app(tmp_path, auth=auth, **config)


def get(app, path, **kw):
    return app.test_client().get(path, **kw)


def body(response):
    return response.get_data(as_text=True)


# ---- defaults: nothing changes ------------------------------------------------------------

def strip_site_markup(source):
    return re.sub(r"\{# site:begin #\}.*?\{# site:end #\}", "", source, flags=re.S)


@pytest.fixture
def stripped_templates(tmp_path):
    """The templates as if the site's markup had never been added."""
    target = tmp_path / "stripped"
    shutil.copytree(TEMPLATES, target)
    for name in os.listdir(target):
        path = target / name
        path.write_text(strip_site_markup(path.read_text(encoding="utf-8")), encoding="utf-8")
    return str(target)


def normalise(html):
    html = re.sub(r'(name="login_csrf" value=")[^"]*', r"\1X", html)
    html = re.sub(r'(name="csrf_token" value=")[^"]*', r"\1X", html)
    return re.sub(r'(name="annzarro-csrf" content=")[^"]*', r"\1X", html)


def pages(app):
    """The five HTML pages' bodies; login pages need an admin session."""
    out = {"/": body(get(app, "/"))}
    if app.config.get("auth_enabled"):
        out["/login"] = body(get(app, "/login"))
        out["/logout"] = body(get(app, "/logout"))
        client = login(app, ADMIN)
        out["/account/password"] = body(client.get("/account/password"))
        out["/admin"] = body(client.get("/admin"))
    return out


def test_unconfigured_pages_are_byte_identical_to_the_templates_without_the_site(tmp_path, stripped_templates):
    """A personal server (loopback, login off) and the desktop app: nothing configured, nothing shown."""
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    with_site_code = app_with(tmp_path / "a")
    without = app_with(tmp_path / "b")
    without.jinja_env.loader = FileSystemLoader(stripped_templates)
    got, expected = pages(with_site_code), pages(without)
    assert got.keys() == expected.keys()
    for path in got:
        assert normalise(got[path]) == normalise(expected[path]), f"{path} changed with nothing configured"
        assert "site-footer" not in got[path] and "about-this-site" not in got[path]


def without_footer(html):
    html = re.sub(r'<footer id="site-footer".*?</footer>', "", html, flags=re.S)
    return html.replace(' class="has-site-footer site-centered"', "").replace(" has-site-footer", "")


@pytest.mark.parametrize("config", [{"auth": True}, {"host": "0.0.0.0", "auth": False}, {"hosted": True, "auth": False}],
                         ids=["login", "network-host", "hosted"])
def test_a_hosted_server_has_about_and_data_in_its_footer_and_nothing_else_changes(tmp_path, stripped_templates, config):
    """Other people reach it, so the footer shows About and Data & privacy before anything is configured
    (the design of the site defaults; the pages are otherwise the templates without the site's markup)."""
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    with_site_code = app_with(tmp_path / "a", **config)
    without = app_with(tmp_path / "b", **config)
    without.jinja_env.loader = FileSystemLoader(stripped_templates)
    got, expected = pages(with_site_code), pages(without)
    if config["auth"]:      # "/" is the redirect to the sign-in page there; the signed-in main page instead
        got["/"] = body(login(with_site_code, ADMIN).get("/"))
        expected["/"] = body(login(without, ADMIN).get("/"))
    for path in got:
        footer = re.search(r'<footer id="site-footer".*?</footer>', got[path], re.S).group(0)
        assert re.findall(r">([^<]+)</a>", footer) == ["About", "Data &amp; privacy"], path
        assert 'href="/site/about"' in footer and 'href="/site/data"' in footer
        assert normalise(without_footer(got[path])) == normalise(expected[path]), f"{path} changed beyond the footer"
        assert "about-this-site" not in got[path]
    assert "data-about-open" in got["/"], "on the main page About opens the dialog"


def test_the_defaults_configure_nothing():
    manager = ConfigManager()
    manager.load_config(env="production")
    site = manager.to_flask_config()["site"]
    for kind in ("imprint", "privacy", "accessibility", "terms"):
        assert site[kind]["url"] is None and site[kind]["markdown"] is None and site[kind]["file"] is None
    assert site["operator"] is None and site["contact"] is None and site["security_contact"] is None
    assert site["robots"] == "auto" and site["footer_links"] == "auto"
    assert site["storage"]["persistent_convenience"] is True


def test_the_browser_sees_the_site_but_never_a_file_path(tmp_path):
    (tmp_path / "text.md").write_text("Hello", encoding="utf-8")
    manager = ConfigManager()
    manager.load_config(env="production")
    manager.config["site"]["imprint"]["file"] = str(tmp_path / "text.md")
    manager.config["site"]["operator"] = "Example"
    manager.config["site"]["storage"]["persistent_convenience"] = False
    app = create_app({**manager.to_flask_config(), "TESTING": True, "data_dir": str(tmp_path),
                      "log_file": str(tmp_path / "l.log"), "auth_enabled": False})
    config = get(app, "/api/v1/config").get_json()
    assert config["site"]["operator"] == "Example"
    assert config["site"]["storage"]["persistent_convenience"] is False
    assert "file" not in config["site"]["imprint"], "the server's file path must not reach the browser"


# ---- what is rendered where -----------------------------------------------------------------

def test_the_footer_links_the_configured_texts_on_the_main_page(tmp_path):
    html = body(get(app_with(tmp_path, SITE), "/"))
    footer = re.search(r'<footer id="site-footer".*?</footer>', html, re.S).group(0)
    assert re.findall(r">([^<]+)</a>", footer) == ["Impressum", "Datenschutz", "Kontakt"]
    assert 'href="/site/imprint" data-about-section="imprint"' in footer
    assert 'href="https://example.org/privacy" target="_blank" rel="noopener noreferrer"' in footer
    assert 'href="mailto:office@example.org"' in footer
    # the last row of the page's scroller (#tile-container), so it is at the bottom of the page
    assert html.index('id="tile-container"') < html.index('id="site-footer"') < html.index("</main>") < html.index('id="about-modal"')


def test_the_about_dialog_carries_the_site_block(tmp_path):
    html = body(get(app_with(tmp_path, SITE), "/"))
    block = re.search(r'<section id="about-this-site".*?</section>', html, re.S).group(0)
    assert "Operated by Example Institute, University of X" in block
    assert 'Kontakt: <a href="mailto:office@example.org">office@example.org</a>' in block
    assert re.search(r'<details id="about-imprint" class="about-text"><summary>Impressum</summary>', block)
    assert "<strong>Example Institute</strong><br>Main Street 1" in block
    assert '<h4>Imprint</h4>' in block, "a heading in the text sits under the dialog's own"
    assert '<div class="about-text about-text-link"><a href="https://example.org/privacy"' in block
    assert "about-terms" not in block and "Accessibility" not in block, "only what is configured"
    assert html.index('id="about-this-site"') < html.index('id="about-version"'), "the site's block comes first"


def test_the_about_text_describes_the_software_not_the_site(tmp_path):
    for site in (None, SITE):
        (tmp_path / ("sited" if site else "plain")).mkdir()
        html = body(get(app_with(tmp_path / ("sited" if site else "plain"), site), "/"))
        assert "AnnZarro is developed by the " in html
        assert "The development of AnnZarro is supported by" in html
        assert 'id="about-title">About AnnZarro<' in html


def test_the_desktop_privacy_statement_is_in_the_page_but_hidden(tmp_path):
    html = body(get(app_with(tmp_path), "/"))
    assert re.search(r'<p id="about-desktop-privacy"[^>]* hidden>', html)
    assert "github.com for the newest release" in html and "IP address" in html


def test_about_only_has_no_footer_but_keeps_the_block(tmp_path, caplog):
    with caplog.at_level(logging.WARNING):
        html = body(get(app_with(tmp_path, {**SITE, "footer_links": "about-only"}), "/"))
    assert "site-footer" not in html and 'id="about-this-site"' in html
    assert "not visible on every page" in caplog.text


def test_a_site_with_only_an_operator_has_a_block_and_no_footer(tmp_path):
    html = body(get(app_with(tmp_path, {"operator": "Example Lab"}), "/"))
    assert "Operated by Example Lab" in html and "site-footer" not in html


def test_contact_falls_back_to_the_branding_email_in_about_but_does_not_make_a_footer(tmp_path):
    app = app_with(tmp_path, {"operator": "Example Lab"}, contact_info={"email": "lab@example.org"})
    html = body(get(app, "/"))
    assert 'Contact: <a href="mailto:lab@example.org">lab@example.org</a>' in html
    assert "site-footer" not in html


def test_the_login_and_logout_pages_carry_the_footer(tmp_path):
    app = app_with(tmp_path, SITE, auth=True)
    for path in ("/login", "/logout"):
        html = body(get(app, path))
        assert 'class="site-footer"' in html and 'class="has-site-footer site-centered"' in html
        # no About dialog on these pages: the imprint link goes to its page
        assert 'href="/site/imprint"' in html and "data-about-section" not in html


def test_the_account_and_admin_pages_carry_the_footer(tmp_path):
    app = app_with(tmp_path, SITE, auth=True)
    client = login(app, ADMIN)
    for path in ("/account/password", "/admin"):
        html = body(client.get(path))
        assert 'class="site-footer"' in html and "has-site-footer" in html and "Impressum" in html


def test_links_follow_the_mount_point(tmp_path):
    app = app_with(tmp_path, SITE, url_prefix="/explore")
    html = body(app.test_client().get("/explore/", base_url="http://localhost"))
    assert 'href="/explore/site/imprint"' in html


# ---- /site/<kind> -----------------------------------------------------------------------------

def test_a_text_page_needs_no_login(tmp_path):
    app = app_with(tmp_path, SITE, auth=True)
    response = get(app, "/site/imprint")
    assert response.status_code == 200
    html = body(response)
    assert '<html lang="de">' in html and "<h1>Impressum</h1>" in html
    assert "<h2>Imprint</h2>" in html, "the text's own headings sit under the page's"
    assert "<strong>Example Institute</strong>" in html and "<script>" not in html
    assert "script-src 'self'" in response.headers["Content-Security-Policy"]
    assert 'href="/"' in html


def test_a_url_text_redirects_and_unset_or_unknown_ones_are_404(tmp_path):
    app = app_with(tmp_path, SITE, auth=True)
    redirect = get(app, "/site/privacy")
    assert redirect.status_code == 302 and redirect.headers["Location"] == "https://example.org/privacy"
    for path in ("/site/terms", "/site/accessibility", "/site/nonsense", "/site/__init__"):
        response = get(app, path)
        assert response.status_code == 404 and "text/plain" in response.headers["Content-Type"]


def test_a_file_is_read_at_start_and_rendered_safely(tmp_path):
    (tmp_path / "privacy.md").write_text("## Privacy\n\n<script>alert(1)</script> [x](javascript:alert(1))\n", encoding="utf-8")
    app = app_with(tmp_path, {"privacy": {"file": str(tmp_path / "privacy.md")}}, auth=True)
    html = body(get(app, "/site/privacy"))
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html and "<script>" not in html
    assert 'href="javascript' not in html


def test_inline_texts_are_escaped_in_the_dialog_too(tmp_path):
    app = app_with(tmp_path, {"imprint": {"markdown": '<img src=x onerror=alert(1)> [a](javascript:1) [b](https://e.org/"x)'}})
    html = body(get(app, "/"))
    assert "<img src=x" not in html and "onerror=alert(1)>" not in html
    assert 'href="javascript' not in html


# ---- refusals ---------------------------------------------------------------------------------

@pytest.mark.parametrize("site, fragment", [
    ({"imprint": {"url": "javascript:alert(1)"}}, "site.imprint.url"),
    ({"privacy": {"url": "data:text/html,x"}}, "site.privacy.url"),
    ({"terms": {"url": "ftp://example.org/t"}}, "site.terms.url"),
    ({"accessibility": {"url": "/relative"}}, "site.accessibility.url"),
    ({"imprint": {"label": ""}}, "site.imprint.label"),
    ({"imprint": {"label": "<b>x</b>"}}, "site.imprint.label"),
    ({"imprint": {"label": "x" * 80}}, "site.imprint.label"),
    ({"imprint": {"file": "/no/such/file.md"}}, "site.imprint.file"),
    ({"imprint": "text"}, "site.imprint must be a mapping"),
    ({"contact": "javascript:alert(1)"}, "site.contact"),
    ({"contact": "not an address"}, "site.contact"),
    ({"operator": "two\nlines"}, "site.operator"),
    ({"operator": "<b>x</b>"}, "site.operator"),
    ({"security_contact": "http://example.org/security"}, "site.security_contact"),
    ({"security_contact": "javascript:1"}, "site.security_contact"),
    ({"robots": "sometimes"}, "site.robots"),
    ({"footer_links": "never"}, "site.footer_links"),
    ({"languages": "<x>"}, "site.languages"),
    ({"storage": {"persistent_convenience": "yes"}}, "persistent_convenience"),
    ({"software_credits": "no"}, "site.software_credits"),
])
def test_wrong_values_stop_the_server_at_start(tmp_path, site, fragment):
    with pytest.raises(ValueError, match=re.escape(fragment)):
        app_with(tmp_path, site)


def test_a_file_over_the_cap_is_refused(tmp_path):
    (tmp_path / "big.md").write_text("x" * (256 * 1024 + 1), encoding="utf-8")
    with pytest.raises(ValueError, match="limit"):
        app_with(tmp_path, {"imprint": {"file": str(tmp_path / "big.md")}})


def test_a_file_that_is_not_text_is_refused(tmp_path):
    (tmp_path / "bin.md").write_bytes(b"\xff\xfe\x00\x01")
    with pytest.raises(ValueError, match="UTF-8"):
        app_with(tmp_path, {"imprint": {"file": str(tmp_path / "bin.md")}})


def test_a_url_beats_a_text_with_a_warning(tmp_path, caplog):
    with caplog.at_level(logging.WARNING):
        app = app_with(tmp_path, {"imprint": {"url": "https://example.org/i", "markdown": "text"}})
    assert "url and a text are both set" in caplog.text
    assert get(app, "/site/imprint").headers["Location"] == "https://example.org/i"


def test_every_problem_is_reported_at_once(tmp_path):
    with pytest.raises(ValueError) as error:
        app_with(tmp_path, {"imprint": {"url": "javascript:1"}, "robots": "x", "contact": "?"})
    for fragment in ("site.imprint.url", "site.robots", "site.contact"):
        assert fragment in str(error.value)


# ---- robots, security.txt -------------------------------------------------------------------

def test_a_login_server_is_noindex_by_default(tmp_path):
    app = app_with(tmp_path, auth=True)
    for path in ("/login", "/robots.txt", "/api/v1/config"):
        assert get(app, path).headers["X-Robots-Tag"] == "noindex, nofollow", path
    robots = get(app, "/robots.txt")
    assert robots.status_code == 200 and body(robots) == "User-agent: *\nDisallow: /\n"
    assert "text/plain" in robots.headers["Content-Type"]


def test_a_server_without_login_is_indexable_by_default(tmp_path):
    app = app_with(tmp_path, auth=False)
    assert "X-Robots-Tag" not in get(app, "/").headers
    assert get(app, "/robots.txt").status_code == 404


@pytest.mark.parametrize("auth, robots, noindex", [(True, "index", False), (False, "noindex", True),
                                                   (True, "noindex", True), (False, "auto", False)])
def test_robots_can_be_set_either_way(tmp_path, auth, robots, noindex):
    app = app_with(tmp_path, {"robots": robots}, auth=auth)
    assert ("X-Robots-Tag" in get(app, "/login" if auth else "/").headers) == noindex
    assert (get(app, "/robots.txt").status_code == 200) == noindex


def test_security_txt_follows_the_rfc(tmp_path):
    app = app_with(tmp_path, {"security_contact": "mailto:security@example.org", "languages": "en"}, auth=True)
    response = get(app, "/.well-known/security.txt")
    assert response.status_code == 200 and "text/plain" in response.headers["Content-Type"]
    lines = dict(line.split(": ", 1) for line in body(response).splitlines() if line)
    assert lines["Contact"] == "mailto:security@example.org" and lines["Preferred-Languages"] == "en"
    expires = datetime.datetime.strptime(lines["Expires"], "%Y-%m-%dT%H:%M:%S.000Z").replace(tzinfo=datetime.timezone.utc)
    ahead = expires - datetime.datetime.now(datetime.timezone.utc)
    assert datetime.timedelta(days=360) < ahead < datetime.timedelta(days=366), "at most a year ahead, as RFC 9116 asks"


def test_security_txt_is_404_when_unset(tmp_path):
    assert get(app_with(tmp_path), "/.well-known/security.txt").status_code == 404


def test_an_https_security_contact_is_accepted(tmp_path):
    app = app_with(tmp_path, {"security_contact": "https://example.org/security"})
    assert "Contact: https://example.org/security" in body(get(app, "/.well-known/security.txt"))


# ---- invariants a public site relies on ---------------------------------------------------------

def test_a_login_off_site_sets_no_cookie_at_all(tmp_path):
    app = app_with(tmp_path, SITE, auth=False)
    client = app.test_client()
    for path in ("/", "/api/v1/datasets", "/api/v1/config", "/site/imprint", "/robots.txt", "/login", "/api/v1/auth/me"):
        response = client.get(path)
        assert not response.headers.getlist("Set-Cookie"), f"{path} set a cookie"
    assert client.get_cookie("session") is None


def test_the_content_security_policy_does_not_change_with_the_site(tmp_path):
    (tmp_path / "p").mkdir()
    plain = get(app_with(tmp_path / "p"), "/")
    sited = get(app_with(tmp_path, SITE), "/")
    assert plain.headers["Content-Security-Policy"] == sited.headers["Content-Security-Policy"]
    sources = plain.headers["Content-Security-Policy"].split()
    assert sources[:4] == ["connect-src", "'self'", "data:", "blob:"]
    assert all(s.startswith("https://") for s in sources[4:]), "only hosts the policy accounts for"


def test_no_template_or_stylesheet_loads_anything_from_another_server():
    pattern = re.compile(r"""(<script[^>]+src|<link[^>]+href|<img[^>]+src|<iframe[^>]+src|<source[^>]+src)\s*=\s*["']\s*(https?:)?//"""
                         r"""|url\(\s*["']?\s*(https?:)?//|@import\s+(url\()?\s*["']?(https?:)?//""", re.I)
    offenders = []
    for folder, extensions in ((TEMPLATES, (".html",)), (os.path.join(REPO, "static", "css"), (".css",))):
        for name in os.listdir(folder):
            if name.endswith(extensions):
                text = open(os.path.join(folder, name), encoding="utf-8").read()
                offenders += [f"{name}: {m.group(0)}" for m in pattern.finditer(text)]
    assert not offenders, offenders


# ---- startup warnings -------------------------------------------------------------------------

@pytest.mark.parametrize("html", ["<script>1</script>", '<iframe src="/x"></iframe>',
                                  '<img src="https://tracker.example/p.gif">', '<link rel="stylesheet" href="//cdn.example/x.css">', "<EMBED src=x>"])
def test_risky_custom_html_is_warned_about(tmp_path, caplog, html):
    with caplog.at_level(logging.WARNING):
        app_with(tmp_path, contact_info={"custom_html": html})
    assert "custom_html contains a script" in caplog.text


def test_plain_custom_html_is_not(tmp_path, caplog):
    with caplog.at_level(logging.WARNING):
        app_with(tmp_path, contact_info={"custom_html": '<p>See <a href="https://example.org">us</a></p>'})
    assert "custom_html" not in caplog.text


def test_external_requests_on_a_shared_server_is_warned_about(tmp_path, caplog, monkeypatch):
    monkeypatch.delenv("ANNZARRO_EXTERNAL_REQUESTS", raising=False)
    with caplog.at_level(logging.WARNING):
        app_with(tmp_path, auth=True, integrations={"external_requests": "on"})
    assert 'external_requests is "on" on a shared server' in caplog.text


@pytest.mark.parametrize("auth, mode", [(True, "ask"), (True, "off"), (False, "on")])
def test_no_warning_for_ask_or_a_local_server(tmp_path, caplog, monkeypatch, auth, mode):
    monkeypatch.delenv("ANNZARRO_EXTERNAL_REQUESTS", raising=False)
    with caplog.at_level(logging.WARNING):
        app_with(tmp_path, auth=auth, integrations={"external_requests": mode})
    assert 'external_requests is "on"' not in caplog.text


# ---- what the browser stores: the inventory the privacy notice describes ------------------------

#: Every key the app writes to the browser, with where the docs describe it (docs/deployment/public-site.md).
#: A new key fails test_the_storage_inventory_is_complete until it is listed here AND in the docs.
STORAGE_KEYS = {
    "annzarro.structure-search": "static/js/utils/structure-search.js",
    "annzarro-theme": "static/js/utils/theme.js",
    "annzarro_autosave": "static/js/config.js",
    "annzarro_session_style": "static/js/utils/session-style.js",
    "annzarro_last_sessions": "static/js/utils/last-sessions.js",
    "annzarro_restoring": "static/js/utils/last-sessions.js",
    "annzarro.recents:": "static/js/utils/dataset-recents.js",
    "annzarro.recentDatasets:": "static/js/utils/dataset-recents.js",
    "annzarro.pins:": "static/js/utils/dataset-pins.js",
    "annzarro.subsetSize:": "static/js/utils/subset-carry.js",
    "annzarro_memory_pending": "static/js/utils/memory-guard.js",
    "annzarro_memory_margin": "static/js/utils/memory-guard.js",
    "annzarro:external-ok": "static/js/panels/gene-set-utilities/consent.js",
}
#: annzarro* strings that are not storage keys: meta tags, DOM events, file names, metadata in exported files
NOT_STORAGE = {"annzarro-csrf", "annzarro-root", "annzarro:open-dataset-browser", "annzarro:open-subset",
               "annzarro:memory-changed", "annzarro:notify", "annzarro:themechange", "annzarro_plot", "annzarro-recipe"}
#: the only source files that touch localStorage or sessionStorage; a new one needs a look at what it keeps
STORAGE_USERS = {"static/js/theme-init.js", "static/js/session-manager.js", "static/js/main.js",
                 "static/js/panels/gene-set.js", "static/js/utils/memory-guard-ui.js", "static/js/utils/theme.js",
                 "static/js/utils/site-storage.js", "static/js/utils/convenience-storage.js",
                 "static/js/utils/memory-guard.js", "static/js/panels/gene-set-utilities/consent.js",
                 "static/js/utils/structure-search.js", "static/js/utils/session-style.js"}


def js_files():
    for folder, _, names in os.walk(os.path.join(REPO, "static", "js")):
        for name in names:
            if name.endswith(".js"):
                yield os.path.relpath(os.path.join(folder, name), REPO)


def test_the_storage_inventory_is_complete():
    found, users = {}, set()
    for relative in js_files():
        text = open(os.path.join(REPO, relative), encoding="utf-8").read()
        if re.search(r"\b(localStorage|sessionStorage)\b", text):
            users.add(relative)
        for key in re.findall(r"""['"`](annzarro[-_.:][A-Za-z0-9_.:-]*)""", text):
            found.setdefault(key, relative)
    assert users == STORAGE_USERS, (
        f"files that use browser storage changed: {sorted(users ^ STORAGE_USERS)}; "
        "check what they keep, then list them here and describe it in docs/deployment/public-site.md")
    unknown = {k: f for k, f in found.items() if k not in STORAGE_KEYS and k not in NOT_STORAGE}
    assert not unknown, (f"new annzarro* strings {unknown}: if one is a browser storage key, add it to STORAGE_KEYS "
                         "and the privacy notice in docs/deployment/public-site.md; otherwise to NOT_STORAGE")
    for key, where in STORAGE_KEYS.items():
        assert key in found, f"{key} is no longer in the source: remove it from the inventory and the docs"


def test_the_data_page_lists_every_storage_key():
    from annzarro.server.site import STORAGE_INVENTORY
    listed = " ".join(key for key, _, _ in STORAGE_INVENTORY)
    for key in STORAGE_KEYS:
        assert key in listed, f"/site/data (site.STORAGE_INVENTORY) does not list {key}"


def test_the_docs_describe_every_storage_key():
    docs = open(os.path.join(REPO, "docs", "deployment", "public-site.md"), encoding="utf-8").read()
    for key in STORAGE_KEYS:
        assert f"`{key}" in docs, f"docs/deployment/public-site.md does not describe {key}"


def test_the_cookies_the_server_sets_are_the_documented_ones():
    docs = open(os.path.join(REPO, "docs", "deployment", "public-site.md"), encoding="utf-8").read()
    for cookie in ("session", "annzarro_login_csrf"):
        assert f"`{cookie}`" in docs
    sources = ""
    for folder, _, names in os.walk(os.path.join(REPO, "annzarro", "server")):
        for name in names:
            if name.endswith(".py"):
                sources += open(os.path.join(folder, name), encoding="utf-8").read()
    assert len(re.findall(r"set_cookie\(", sources)) == 1, "a new cookie: describe it in the docs, then update this count"
    assert "annzarro_login_csrf" in sources


CREDIT = ("settylab-logo", "fredhutch", "R35GM147125", "Citing AnnZarro", "AnnZarro is developed by the ")


def test_the_software_credit_stays_by_default_everywhere_and_below_the_site_block(tmp_path):
    for name, site in (("plain", None), ("sited", SITE)):
        (tmp_path / name).mkdir()
        html = body(get(app_with(tmp_path / name, site), "/"))
        for needle in CREDIT:
            assert needle in html, f"{needle} missing ({name})"
    assert html.index('id="about-this-site"') < html.index("Citing AnnZarro")


def test_software_credits_off_leaves_name_version_licence_and_two_links(tmp_path):
    html = body(get(app_with(tmp_path, {**SITE, "software_credits": False}), "/"))
    modal = html[html.index('id="about-modal"'):html.index('id="session-modal"')]
    for needle in CREDIT:
        assert needle not in modal
    assert 'id="about-version"' in modal and "AnnZarro is released under the MIT licence." in modal
    assert 'href="https://annzarro.readthedocs.io"' in modal and 'href="https://github.com/settylab/annzarro"' in modal
    assert 'id="about-this-site"' in modal, "the site's own block is unaffected"
    assert "site-footer" in html, "so is the footer"
