"""The site settings on the admin page (the site.* policy keys), /site/data, /site/about and the start warning.

The admin page writes the keys through the Settings API (PUT /api/v1/admin/policy): its CSRF and
re-authentication, its overlay.json, its precedence (the overlay over the YAML unless policy.locked
names the key). What a key refuses is what stops the server at start (site.Site.from_config).
"""
import json
import os
import re

import pytest

from annzarro.tests.server.admin_helpers import ADMIN, USER, login, make_app, unsafe_headers

POLICY = "/api/v1/admin/policy"
IMPRINT = "# Impressum\n\n**Example Institute**  \nMain Street 1"


def put(client, body, **headers):
    return client.put(POLICY, data=json.dumps(body), headers=headers or unsafe_headers(client))


def site_keys(client):
    return {k["name"]: k for k in client.get(POLICY).get_json()["keys"] if k["name"].startswith("site.")}


def overlay(app):
    path = os.path.join(app.admin_dir, "overlay.json")
    if not os.path.exists(path):
        return {}
    with open(path) as fh:
        return json.load(fh).get("policy", {})


def footer_of(html):
    found = re.search(r'<footer id="site-footer".*?</footer>', html, re.S)
    return re.findall(r">([^<]+)</a>", found.group(0)) if found else None


def text(markdown=None, url=None, label=None):
    return {"markdown": markdown, "url": url, "label": label, "file": None}


@pytest.fixture
def app(tmp_path):
    return make_app(tmp_path)


@pytest.fixture
def admin(app):
    return login(app, ADMIN)


# ---- the keys and their help ------------------------------------------------------------------

def test_every_site_key_is_listed_for_the_public_site_section_with_its_help(admin):
    keys = site_keys(admin)
    assert set(keys) == {"site.imprint", "site.privacy", "site.accessibility", "site.terms", "site.operator",
                         "site.contact", "site.contact_label", "site.footer_links", "site.robots",
                         "site.security_contact", "site.languages", "site.software_credits",
                         "site.storage.persistent_convenience"}
    for key in keys.values():
        assert key["section"] == "site" and key["area"] == "site" and key["scope"] == "server"
        assert len(key["description"]) > 40, key["name"]
        assert key["source"] == "default" and not key["locked"]
    assert "Impressum" in keys["site.imprint"]["description"]
    assert keys["site.imprint"]["value"] == {"label": "Imprint", "url": None, "markdown": None, "file": None}
    assert keys["site.software_credits"]["value"] is True


def test_site_keys_never_reach_the_browser_policy(app):
    values = app.test_client().get("/api/v1/policy/effective")
    assert values.status_code in (200, 401)
    client = login(app, USER)
    assert not any(k.startswith("site.") for k in client.get("/api/v1/policy/effective").get_json()["values"])


# ---- the guard: CSRF, admins only, re-authentication -------------------------------------------

def test_a_change_without_the_request_token_is_refused(app, admin):
    reply = put(admin, {"site.operator": "Example"}, **{"Content-Type": "application/json"})
    assert reply.status_code == 403 and reply.get_json()["reason"] == "csrf_failed"
    reply = put(admin, {"site.operator": "Example"}, **{"Content-Type": "application/json", "X-AnnZarro-CSRF": "wrong"})
    assert reply.status_code == 403 and reply.get_json()["reason"] == "csrf_failed"
    assert overlay(app) == {}


def test_a_user_cannot_change_the_site(app):
    client = login(app, USER)
    reply = put(client, {"site.operator": "Example"})
    assert reply.status_code == 403 and reply.get_json()["reason"] == "admin_only"
    assert overlay(app) == {}


def test_a_change_needs_a_recent_password(app, admin):
    with admin.session_transaction() as sess:
        sess["admin_auth_at"] = 0
    reply = put(admin, {"site.operator": "Example"})
    assert reply.status_code == 403 and reply.get_json()["reason"] == "reauth_required"


# ---- persistence and taking effect without a restart ---------------------------------------------

def test_a_text_set_here_is_stored_and_shows_at_once(app, admin):
    assert put(admin, {"site.imprint": text(IMPRINT, label="Impressum"), "site.operator": "Example Institute",
                       "site.contact": "office@example.org", "site.contact_label": "Kontakt"}).status_code == 200
    stored = overlay(app)
    assert stored["site.imprint"]["markdown"] == IMPRINT and stored["site.operator"] == "Example Institute"
    keys = site_keys(admin)
    assert keys["site.imprint"]["source"] == "admin" and keys["site.operator"]["value"] == "Example Institute"

    home = admin.get("/").get_data(as_text=True)
    assert footer_of(home) == ["About", "Impressum", "Data &amp; privacy", "Kontakt"]
    assert "Operated by Example Institute" in home and "<strong>Example Institute</strong>" in home
    page = app.test_client().get("/site/imprint")
    assert page.status_code == 200 and "<h1>Impressum</h1>" in page.get_data(as_text=True)
    login_page = app.test_client().get("/login").get_data(as_text=True)
    assert footer_of(login_page) == ["About", "Impressum", "Data &amp; privacy", "Kontakt"]


def test_a_new_app_on_the_same_state_reads_the_stored_values(tmp_path):
    first = make_app(tmp_path)
    assert put(login(first, ADMIN), {"site.operator": "Example Lab"}).status_code == 200
    second = make_app(tmp_path)
    assert "Operated by Example Lab" in login(second, ADMIN).get("/").get_data(as_text=True)


def test_robots_security_txt_storage_and_credits_follow_the_admin(app, admin):
    assert "X-Robots-Tag" in app.test_client().get("/login").headers, "login on: noindex by default"
    assert app.test_client().get("/.well-known/security.txt").status_code == 404
    assert put(admin, {"site.robots": "index", "site.security_contact": "mailto:security@example.org",
                       "site.storage.persistent_convenience": False, "site.software_credits": False}).status_code == 200
    assert "X-Robots-Tag" not in app.test_client().get("/login").headers
    assert app.test_client().get("/robots.txt").status_code == 404
    security = app.test_client().get("/.well-known/security.txt")
    assert security.status_code == 200 and "Contact: mailto:security@example.org" in security.get_data(as_text=True)
    config = admin.get("/api/v1/config").get_json()
    assert config["site"]["storage"]["persistent_convenience"] is False
    home = admin.get("/").get_data(as_text=True)
    assert "The development of AnnZarro is supported by" not in home and "MIT licence" in home
    assert "kept only until the tab closes" in app.test_client().get("/site/data").get_data(as_text=True)


def test_about_only_takes_the_footer_away(app, admin):
    assert put(admin, {"site.footer_links": "about-only"}).status_code == 200
    assert footer_of(app.test_client().get("/login").get_data(as_text=True)) is None


# ---- validation: what stops the server at start is refused here, with the same sentence ------------

@pytest.mark.parametrize("name, value, fragment", [
    ("site.imprint", text(url="javascript:alert(1)"), "site.imprint.url must be an http://, https:// or mailto:"),
    ("site.privacy", text(url="data:text/html,x"), "site.privacy.url"),
    ("site.imprint", text("x", label="<b>x</b>"), "site.imprint.label must be plain text"),
    ("site.imprint", text("x", label="x" * 80), "site.imprint.label"),
    ("site.terms", text("x" * 200_001), "longer than"),
    ("site.imprint", {"markdown": "x", "colour": "red"}, "must be a mapping with url, markdown, file and label"),
    ("site.imprint", "a text", "must be a mapping"),
    ("site.operator", "two\nlines", "site.operator must be one line"),
    ("site.operator", "<b>x</b>", "site.operator"),
    ("site.operator", {"a": 1}, "site.operator must be text"),
    ("site.contact", "javascript:alert(1)", "site.contact must be an e-mail address"),
    ("site.contact_label", "", "site.contact_label must be plain text"),
    ("site.security_contact", "http://example.org/security", "site.security_contact must be a mailto: or https://"),
    ("site.languages", "<x>", "site.languages must be a language tag"),
])
def test_wrong_values_are_refused_inline_and_nothing_is_stored(app, admin, name, value, fragment):
    reply = put(admin, {name: value})
    assert reply.status_code == 400, reply.get_json()
    data = reply.get_json()
    assert data["errors"] == {name: "bad_type"}
    assert fragment in data["messages"][name] and fragment in data["error"]
    assert overlay(app) == {}


@pytest.mark.parametrize("name, value", [("site.footer_links", "never"), ("site.robots", "sometimes"),
                                         ("site.software_credits", "no"), ("site.storage.persistent_convenience", 1)])
def test_choices_and_switches_refuse_anything_else(app, admin, name, value):
    reply = put(admin, {name: value})
    assert reply.status_code == 400 and name in reply.get_json()["errors"]
    assert overlay(app) == {}


def test_a_file_can_only_come_from_the_config_file(app, admin, tmp_path):
    secret = tmp_path / "users" / "users.json"
    reply = put(admin, {"site.privacy": {"file": str(secret)}})
    assert reply.status_code == 400
    assert "can only be set in the configuration file" in reply.get_json()["messages"]["site.privacy"]
    assert overlay(app) == {}
    assert app.test_client().get("/site/privacy").status_code == 404


def test_one_refused_value_stores_nothing_of_the_change(app, admin):
    reply = put(admin, {"site.operator": "Example", "site.contact": "not an address"})
    assert reply.status_code == 400 and set(reply.get_json()["errors"]) == {"site.contact"}
    assert overlay(app) == {}


def test_the_rendered_text_is_safe(app, admin):
    assert put(admin, {"site.imprint": text("<script>alert(1)</script> [x](javascript:alert(1))")}).status_code == 200
    html = app.test_client().get("/site/imprint").get_data(as_text=True)
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html and "<script>alert" not in html
    assert 'href="javascript' not in html


# ---- precedence with the config file --------------------------------------------------------------

def test_the_admin_value_wins_over_the_config_file_and_reset_returns_to_it(tmp_path):
    app = make_app(tmp_path, site={"imprint": {"markdown": "From the file", "label": "Impressum"}, "operator": "Config Lab"})
    admin = login(app, ADMIN)
    keys = site_keys(admin)
    assert keys["site.imprint"]["source"] == "config" and keys["site.imprint"]["value"]["markdown"] == "From the file"
    assert keys["site.operator"]["config_value"] == "Config Lab"

    assert put(admin, {"site.imprint": text("From the admin", label="Impressum"), "site.operator": ""}).status_code == 200
    page = app.test_client().get("/site/imprint").get_data(as_text=True)
    assert "From the admin" in page and "From the file" not in page
    assert "Operated by" not in admin.get("/").get_data(as_text=True), "an empty value overrides the config's"

    assert put(admin, {"site.imprint": None, "site.operator": None}).status_code == 200
    assert overlay(app) == {}
    assert "From the file" in app.test_client().get("/site/imprint").get_data(as_text=True)
    assert "Operated by Config Lab" in admin.get("/").get_data(as_text=True)


def test_not_shown_set_here_hides_the_config_files_text(tmp_path):
    app = make_app(tmp_path, site={"terms": {"markdown": "Terms"}})
    admin = login(app, ADMIN)
    assert put(admin, {"site.terms": text()}).status_code == 200
    assert app.test_client().get("/site/terms").status_code == 404


def test_a_locked_key_is_read_only_with_its_source(tmp_path):
    app = make_app(tmp_path, site={"imprint": {"markdown": "Locked text"}}, policy={"locked": ["site.imprint"]})
    admin = login(app, ADMIN)
    key = site_keys(admin)["site.imprint"]
    assert key["locked"] is True and key["source"] == "config" and key["value"]["markdown"] == "Locked text"
    reply = put(admin, {"site.imprint": text("Mine")})
    assert reply.status_code == 409 and reply.get_json()["errors"] == {"site.imprint": "locked_by_config"}
    assert "Locked text" in app.test_client().get("/site/imprint").get_data(as_text=True)


def test_a_file_from_the_config_is_shown_and_read_once(tmp_path):
    path = tmp_path / "imprint.md"
    path.write_text("# From a file", encoding="utf-8")
    app = make_app(tmp_path, site={"imprint": {"file": str(path)}})
    admin = login(app, ADMIN)
    assert site_keys(admin)["site.imprint"]["value"]["file"] == str(path)
    path.unlink()          # read at start: still served, also after an unrelated admin change
    assert put(admin, {"site.operator": "Example"}).status_code == 200
    assert "From a file" in app.test_client().get("/site/imprint").get_data(as_text=True)


# ---- the start warning -------------------------------------------------------------------------------

WARNING = "publishes no imprint and no privacy notice"


def start_warnings(tmp_path):
    """The start warning, from the server's log file (create_app replaces the root logger's handlers)."""
    with open(tmp_path / "app.log", encoding="utf-8") as fh:
        return [line for line in fh if WARNING in line]


@pytest.mark.parametrize("config, warned", [
    ({"auth": True}, True),
    ({"auth": False, "host": "0.0.0.0"}, True),
    ({"auth": False, "hosted": True}, True),
    ({"auth": False}, False),
    ({"auth": True, "site": {"imprint": {"url": "https://example.org/imprint"}}}, False),
    ({"auth": True, "site": {"privacy": {"markdown": "Notice"}}}, False),
], ids=["login", "network", "hosted", "loopback", "imprint", "privacy"])
def test_a_hosted_server_without_imprint_and_privacy_warns_at_start(tmp_path, config, warned):
    make_app(tmp_path, **config)
    lines = start_warnings(tmp_path)
    assert len(lines) == (1 if warned else 0)
    if warned:
        assert "[WARNING]" in lines[0] and "public-site.html" in lines[0]
        assert ("Public site section (/admin#site)" in lines[0]) == config["auth"]


def test_an_imprint_set_on_the_admin_page_silences_the_warning(tmp_path):
    assert put(login(make_app(tmp_path), ADMIN), {"site.imprint": text("Imprint")}).status_code == 200
    assert len(start_warnings(tmp_path)) == 1, "the first start warned"
    make_app(tmp_path)
    assert len(start_warnings(tmp_path)) == 1, "the second, with the imprint stored, did not"


# ---- /site/data: what the software keeps and sends, from the running configuration ----------------------

def data_page(app):
    response = app.test_client().get("/site/data")
    assert response.status_code == 200
    assert "script-src 'self'" in response.headers["Content-Security-Policy"]
    return re.sub(r"\s+", " ", response.get_data(as_text=True))


def test_the_data_page_of_a_personal_server(tmp_path):
    html = data_page(make_app(tmp_path, auth=False))
    assert "This is not a privacy notice." in html and "has not published a privacy notice here" in html
    assert "This site sets no cookies." in html and "<code>session</code>" not in html
    for key in ("annzarro-theme", "annzarro_autosave", "annzarro:external-ok", "annzarro.recents:&lt;origin&gt;|&lt;user&gt;"):
        assert f"<code>{key}</code>" in html
    assert "kept between visits" in html
    assert "only after you agree" in html and "STRING" in html
    assert "no analytics, no advertising" in html
    assert "Operated by" not in html


def test_the_data_page_of_a_server_with_login(app):
    html = data_page(app)
    assert "<code>session</code>" in html and "<code>annzarro_login_csrf</code>" in html
    assert "sets no cookies" not in html
    assert "An account on this site may have fewer of these services." in html
    assert "Enrichr" not in html, "a hosted server offers no service that publishes the gene list by default"


def test_the_data_page_links_a_privacy_notice_when_there_is_one(tmp_path):
    html = data_page(make_app(tmp_path, site={"privacy": {"markdown": "Ours", "label": "Datenschutz"}}))
    assert "not a privacy notice" not in html
    assert 'The operator\'s privacy notice: <a href="/site/privacy">Datenschutz</a>' in html
    (tmp_path / "x").mkdir()
    html = data_page(make_app(tmp_path / "x", site={"privacy": {"url": "https://example.org/p"}}))
    assert '<a href="https://example.org/p" target="_blank" rel="noopener noreferrer">Privacy</a>' in html


@pytest.mark.parametrize("mode, sentence", [
    ("on", "without asking"), ("off", "sends nothing to outside services"), ("none", "sends nothing to outside services"),
])
def test_the_data_page_says_what_the_gene_set_panel_sends(tmp_path, mode, sentence):
    html = data_page(make_app(tmp_path, auth=False, integrations={"external_requests": mode}))
    assert sentence in html
    assert ("Links to documentation" in html) == (mode != "none")


def test_the_data_page_names_the_operator_only_when_configured_and_never_the_lab(tmp_path):
    html = data_page(make_app(tmp_path, auth=True, site={"operator": "Example Institute"}))
    assert "Operated by Example Institute." in html
    (tmp_path / "x").mkdir()
    html = data_page(make_app(tmp_path / "x", auth=True))
    assert "Operated by" not in html and "Setty" not in html and "Fred Hutch" not in html


def test_the_data_page_mentions_third_party_content_on_the_sign_in_page(tmp_path):
    html = data_page(make_app(tmp_path, contact_info={"custom_html": '<script src="https://cdn.example.org/x.js"></script>'}))
    assert "may load from other servers" in html


def test_the_data_page_follows_the_mount_point(tmp_path):
    app = make_app(tmp_path, site={"privacy": {"markdown": "Ours"}}, url_prefix="/explore")
    html = app.test_client().get("/explore/site/data", base_url="http://localhost").get_data(as_text=True)
    assert 'href="/explore/site/privacy"' in html


# ---- /site/about ---------------------------------------------------------------------------------------

def test_the_about_page_needs_no_login_and_carries_the_site_block_and_the_credit(tmp_path):
    app = make_app(tmp_path, site={"operator": "Example Institute", "imprint": {"url": "https://example.org/i"}})
    response = app.test_client().get("/site/about")
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    from annzarro import __version__
    assert "Operated by Example Institute" in html and 'href="https://example.org/i"' in html
    assert __version__ in html and "AnnZarro is developed by the" in html
    assert "<script>" not in html.split("</head>")[1]
