"""The site this server is: its legal texts, contact, robots policy and security.txt.

Configured under ``site:`` (config/base.yaml, docs/deployment/public-site.md). Nothing
shows until something is set, so a local or desktop AnnZarro is unchanged.

* Each text (``imprint``, ``privacy``, ``accessibility``, ``terms``) is a link to a page
  the operator already has (``url``: http, https or mailto), a Markdown text written in the
  configuration (``markdown``) or a Markdown file (``file``, read at start). Texts are
  rendered by :mod:`annzarro.utils.safe_markdown` (escaped first, a small allow-list of
  markup), never as raw HTML.
* The templates get a ``site`` object (:class:`SiteView`) from a context processor: the
  footer links, the About dialog's "This site" block, the text pages.
* ``/site/<kind>`` serves a text without signing in (a link to a ``url`` redirects there),
  ``/robots.txt`` and ``X-Robots-Tag`` implement ``site.robots``, and
  ``/.well-known/security.txt`` implements ``site.security_contact`` (RFC 9116).
* ``/site/data`` ("Data & privacy") says what the software keeps and sends, generated from the
  running configuration, and ``/site/about`` is the About dialog as a page. A hosted server (one
  other people reach: :func:`is_hosted`) links both from its footer even with nothing configured,
  and warns at start when it publishes no imprint and no privacy notice.
* Every ``site.*`` key is also a policy key (``section="site"``), so an admin edits it on the
  admin page's Public site section: the overlay wins over the YAML unless ``policy.locked`` names
  the key, and :func:`current` rebuilds the site when the overlay changes, without a restart.
  Each key's type checks a value with :meth:`Site.from_config` itself, so the admin page refuses
  exactly what stops the server at start; a text's ``file`` is the YAML's alone.

A wrong value (a ``javascript:`` address, a missing file) stops the server at start.
"""
import datetime
import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple

from flask import Flask, Response, current_app, g, has_request_context, make_response, redirect, render_template, request

from annzarro.server.policy.registry import Key, declare
from annzarro.server.policy.types import BAD_TYPE, Bool, Enum, PolicyType, PolicyValueError
from annzarro.utils.safe_markdown import MAX_CHARS, render_safe_markdown

logger = logging.getLogger(__name__)

KINDS = ("imprint", "privacy", "accessibility", "terms")
DEFAULT_LABELS = {"imprint": "Imprint", "privacy": "Privacy", "accessibility": "Accessibility",
                  "terms": "Terms of use"}
FILE_MAX_BYTES = 256 * 1024
LABEL_MAX = 60
FOOTER_MODES = ("auto", "about-only")
ROBOTS_MODES = ("auto", "index", "noindex")
CONTACT_LABEL = "Contact"
ABOUT_LABEL = "About"
DATA_LABEL = "Data & privacy"
#: Pages the software writes itself, beside the operator's four texts
GENERATED = ("about", "data")
GUIDE_URL = "https://annzarro.readthedocs.io/en/latest/deployment/public-site.html"

#: What the browser keeps (key, what it holds, kind), as docs/deployment/public-site.md lists it;
#: /site/data shows it. test_site.py checks it against the keys the scripts use.
STORAGE_INVENTORY = (
    ("annzarro-theme", "Light, dark or system", "Your choice"),
    ("annzarro.pins:<origin>|<user>", "Datasets you pinned", "Your choice"),
    ("annzarro.subsetSize:<origin>|<user>", "The subset size you chose, for this tab only (session storage)",
     "Your choice"),
    ("annzarro_session_style", "The plot look you made the session default, for this tab only (session storage)",
     "Your choice"),
    ("annzarro.structure-search", "The regex and case switches of the Dataset information search", "Your choice"),
    ("annzarro:external-ok", "Your \u201cAlways\u201d or \u201cNever\u201d for each outside service of the Gene Set panel",
     "Your choice"),
    ("annzarro_autosave", "The panel layout, dataset and focus, offered at your next visit", "Convenience"),
    ("annzarro_last_sessions", "Earlier autosaved sessions (up to three)", "Convenience"),
    ("annzarro_restoring", "A marker that a session was being restored, so one that did not finish is not "
                           "restored by itself again", "Technical"),
    ("annzarro.recents:<origin>|<user>", "Recently opened datasets", "Convenience"),
    ("annzarro.recentDatasets:<origin>", "The older form of the recent datasets, moved to the key above",
     "Convenience"),
    ("annzarro_memory_pending, annzarro_memory_margin", "A marker that a heavy action was under way, and the "
     "memory margin learned from it for actions of that size, so a tab that ran out of memory does not repeat it "
     "(forgotten after a week, when an action that large succeeds, or with Reset the margin)", "Technical"),
)

_URL_RE = re.compile(r"^(?:https?://[^\s]+|mailto:[^\s]+)$", re.IGNORECASE)
_HTTP_RE = re.compile(r"^https?://[^\s]+$", re.IGNORECASE)
_EMAIL_RE = re.compile(r"^[^@\s<>\"']+@[^@\s<>\"']+\.[^@\s<>\"']+$")
_LANG_RE = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f<>]")


def _clean(value: Any) -> Optional[str]:
    """A configured string, stripped; None for null or an empty string."""
    if value is None:
        return None
    text = str(value).strip() if isinstance(value, (str, int, float)) else None
    return text or None


class SiteText:
    """One of the four texts: a link, or an inline text rendered for the dialog and for its page."""

    def __init__(self, kind: str, label: str, url: Optional[str], markdown: Optional[str]):
        self.kind = kind
        self.label = label
        self.url = url
        self.markdown = markdown       # as written (or read from the file), for the admin page's preview
        # rendered once, at start: the dialog nests it under its own headings, the page under the label
        self.dialog_html = render_safe_markdown(markdown, heading_base=4) if markdown else None
        self.page_html = render_safe_markdown(markdown, heading_base=2) if markdown else None

    @property
    def inline(self) -> bool:
        return self.url is None and self.page_html is not None


class Site:
    """The validated ``site:`` section."""

    def __init__(self):
        self.texts: Dict[str, SiteText] = {}
        self.operator: Optional[str] = None
        self.contact: Optional[str] = None
        self.contact_fallback: Optional[str] = None
        self.contact_label = CONTACT_LABEL
        self.footer_links = "auto"
        self.robots = "auto"
        self.security_contact: Optional[str] = None
        self.language = "en"
        self.persistent_convenience = True
        self.software_credits = True
        self.warnings: List[str] = []

    @property
    def configured(self) -> bool:
        return bool(self.texts or self.operator or self.contact)

    def text(self, kind: str) -> Optional[SiteText]:
        return self.texts.get(kind)

    @staticmethod
    def contact_href(contact: Optional[str]) -> Optional[str]:
        if not contact:
            return None
        return f"mailto:{contact}" if _EMAIL_RE.match(contact) else contact

    @classmethod
    def from_config(cls, config: Dict[str, Any]) -> "Site":
        """Read and check ``config["site"]``; ValueError lists every problem."""
        section = config.get("site")
        if section is None:
            section = {}
        if not isinstance(section, dict):
            raise ValueError("site must be a mapping")
        site = cls()
        problems: List[str] = []

        for kind in KINDS:
            entry = section.get(kind)
            if entry is None:
                continue
            if not isinstance(entry, dict):
                problems.append(f"site.{kind} must be a mapping with url, markdown, file and label")
                continue
            label = entry.get("label")
            label = DEFAULT_LABELS[kind] if label is None else str(label).strip()
            if not label or len(label) > LABEL_MAX or _CONTROL_RE.search(label):
                problems.append(f"site.{kind}.label must be plain text of 1 to {LABEL_MAX} characters")
                label = DEFAULT_LABELS[kind]
            url = _clean(entry.get("url"))
            if url is not None and not _URL_RE.match(url):
                problems.append(f"site.{kind}.url must be an http://, https:// or mailto: address, not {url!r}")
                url = None
            markdown = entry.get("markdown")
            if markdown is not None and not isinstance(markdown, str):
                problems.append(f"site.{kind}.markdown must be text")
                markdown = None
            if markdown is not None and len(markdown) > MAX_CHARS:
                problems.append(f"site.{kind}.markdown is longer than {MAX_CHARS} characters; use site.{kind}.file")
                markdown = None
            path = _clean(entry.get("file"))
            if path is not None:
                text = cls._read(kind, path, problems)
                if text is not None and markdown is not None:
                    site.warnings.append(f"site.{kind}: markdown and file are both set; the file is used")
                markdown = text if text is not None else markdown
            if not (markdown and markdown.strip()):
                markdown = None
            if url is not None and markdown is not None:
                site.warnings.append(f"site.{kind}: url and a text are both set; the url is used")
                markdown = None
            if url is None and markdown is None:
                continue
            site.texts[kind] = SiteText(kind, label, url, markdown)

        operator = _clean(section.get("operator"))
        if operator is not None and (len(operator) > 200 or _CONTROL_RE.search(operator) or "\n" in operator):
            problems.append("site.operator must be one line of plain text, 200 characters at most")
            operator = None
        site.operator = operator

        contact = _clean(section.get("contact"))
        if contact is not None and not (_EMAIL_RE.match(contact) or _URL_RE.match(contact)):
            problems.append(f"site.contact must be an e-mail address or an http(s) address, not {contact!r}")
            contact = None
        site.contact = contact
        fallback = _clean(((config.get("contact_info") or {}).get("email")))
        if fallback is not None and _EMAIL_RE.match(fallback):
            site.contact_fallback = fallback

        label = section.get("contact_label")
        label = CONTACT_LABEL if label is None else str(label).strip()
        if not label or len(label) > LABEL_MAX or _CONTROL_RE.search(label):
            problems.append(f"site.contact_label must be plain text of 1 to {LABEL_MAX} characters")
            label = CONTACT_LABEL
        site.contact_label = label

        footer = section.get("footer_links", "auto")
        if footer not in FOOTER_MODES:
            problems.append(f"site.footer_links must be one of {', '.join(FOOTER_MODES)}, not {footer!r}")
            footer = "auto"
        site.footer_links = footer
        robots = section.get("robots", "auto")
        if robots not in ROBOTS_MODES:
            problems.append(f"site.robots must be one of {', '.join(ROBOTS_MODES)}, not {robots!r}")
            robots = "auto"
        site.robots = robots

        security = _clean(section.get("security_contact"))
        if security is not None and not (security.lower().startswith("mailto:") and _URL_RE.match(security)
                                         or security.lower().startswith("https://") and _HTTP_RE.match(security)):
            problems.append(f"site.security_contact must be a mailto: or https:// address, not {security!r}")
            security = None
        site.security_contact = security

        language = _clean(section.get("languages")) or "en"
        if not _LANG_RE.match(language):
            problems.append(f"site.languages must be a language tag such as en or de, not {language!r}")
            language = "en"
        site.language = language

        storage = section.get("storage")
        if storage is not None and not isinstance(storage, dict):
            problems.append("site.storage must be a mapping")
            storage = {}
        convenience = (storage or {}).get("persistent_convenience", True)
        if not isinstance(convenience, bool):
            problems.append("site.storage.persistent_convenience must be true or false")
            convenience = True
        site.persistent_convenience = convenience

        credits = section.get("software_credits", True)
        if not isinstance(credits, bool):
            problems.append("site.software_credits must be true or false")
            credits = True
        site.software_credits = credits

        if problems:
            raise ValueError("; ".join(problems))
        return site

    @staticmethod
    def _read(kind: str, path: str, problems: List[str]) -> Optional[str]:
        full = os.path.expanduser(path)
        try:
            size = os.path.getsize(full)
        except OSError as exc:
            problems.append(f"site.{kind}.file {path!r} cannot be read: {exc.strerror or exc}")
            return None
        if size > FILE_MAX_BYTES:
            problems.append(f"site.{kind}.file {path!r} is {size} bytes; the limit is {FILE_MAX_BYTES}")
            return None
        try:
            with open(full, "r", encoding="utf-8") as handle:
                return handle.read()
        except (OSError, UnicodeDecodeError) as exc:
            problems.append(f"site.{kind}.file {path!r} cannot be read as UTF-8 text: {exc}")
            return None

    def noindex(self, auth_enabled: bool) -> bool:
        """Whether search engines are told to stay away: asked for, or the default on a login-on server."""
        return self.robots == "noindex" or (self.robots == "auto" and bool(auth_enabled))


class SiteView:
    """What the templates see as ``site``, for one request (links depend on where the app is mounted)."""

    def __init__(self, site: Site, root: str, hosted: bool = False):
        self.configured = site.configured
        self.operator = site.operator
        self.language = site.language
        self.software_credits = site.software_credits
        contact = site.contact or site.contact_fallback
        href = Site.contact_href(contact)
        self.contact = {"label": site.contact_label, "text": contact, "href": href,
                        "external": bool(href) and href.lower().startswith("http")} if contact else None
        self.texts = []
        for kind in KINDS:
            text = site.text(kind)
            if text is None:
                continue
            self.texts.append({
                "kind": kind, "label": text.label,
                "url": text.url, "external": bool(text.url) and not text.url.lower().startswith("mailto:"),
                "page": f"{root}/site/{kind}", "inline": text.inline, "html": text.dialog_html,
            })
        # the footer: every text, then the contact, when something was configured to link to; a hosted
        # server also has About first and Data & privacy before the contact, configured or not
        self.footer: List[Dict[str, Any]] = []
        explicit_contact = site.contact is not None
        if site.footer_links == "auto" and (self.texts or explicit_contact or hosted):
            if hosted:
                self.footer.append({"kind": "about", "label": ABOUT_LABEL, "href": f"{root}/site/about",
                                    "external": False, "inline": False})
            for text in self.texts:
                if text["inline"]:
                    self.footer.append({"kind": text["kind"], "label": text["label"], "href": text["page"],
                                        "external": False, "inline": True})
                else:
                    self.footer.append({"kind": text["kind"], "label": text["label"], "href": text["url"],
                                        "external": text["external"], "inline": False})
            if hosted:
                self.footer.append({"kind": "data", "label": DATA_LABEL, "href": f"{root}/site/data",
                                    "external": False, "inline": False})
            if self.contact:
                self.footer.append({"kind": "contact", "label": site.contact_label, "href": self.contact["href"],
                                    "external": self.contact["external"], "inline": False})
        self.show_block = bool(site.operator or self.texts or site.contact)


def get_site(app: Flask) -> Site:
    """The site as the YAML configured it, checked at start."""
    return app.extensions["annzarro_site"]


def is_hosted(config: Dict[str, Any]) -> bool:
    """Whether other people reach this server: login on, or not a single-user local server
    (``server.hosted``, a network bind host, a proxy). The same test as the start warning
    about ``external_requests``; the desktop app and a loopback personal server are not."""
    from annzarro.core.remote import hosted_reasons
    return bool(hosted_reasons(config)) or bool(config.get("auth_enabled"))


def _engine(app: Flask):
    from annzarro.server.policy.routes import EXTENSION
    eng = app.extensions.get(EXTENSION)
    return eng if eng is not None and SITE_KEYS[0] in eng.registry else None


def current(app: Optional[Flask] = None) -> Site:
    """The site in effect now: the YAML's, with what an admin set on the Public site section
    over it. Rebuilt when the policy version changes (one ``stat`` of the overlay per call)."""
    app = app or current_app
    base = get_site(app)
    eng = _engine(app)
    if eng is None:
        return base
    if has_request_context() and "_annzarro_site" in g.__dict__:      # once per request
        return g._annzarro_site
    version = eng.version()
    cached = app.extensions.get("annzarro_site_live")
    if cached is not None and cached[0] == version:
        site = cached[1]
    else:
        resolved = eng.resolve_all(None, SITE_KEYS)
        site = base
        if any(r.source == "admin" for r in resolved.values()):
            site = _from_resolved(app.config, base, resolved)
        app.extensions["annzarro_site_live"] = (version, site)
    if has_request_context():
        g._annzarro_site = site
    return site


def _from_resolved(config: Dict[str, Any], base: Site, resolved) -> Site:
    """A :class:`Site` of the resolved ``site.*`` values. A text that does not come from the admin
    is the one read at start, so a ``file`` is read once, as the YAML promises."""
    section: Dict[str, Any] = {}
    for name, res in resolved.items():
        path = name[len("site."):]
        if path in KINDS and res.source != "admin":
            continue
        node = section
        *parents, leaf = path.split(".")
        for part in parents:
            node = node.setdefault(part, {})
        node[leaf] = res.value
    try:
        site = Site.from_config({"site": section, "contact_info": config.get("contact_info")})
    except ValueError as exc:      # each value passed this check when it was stored; a guard, not a path
        logger.error("Site: the admin's site settings are not usable (%s); the configuration file's apply", exc)
        return base
    for kind in KINDS:
        if resolved[f"site.{kind}"].source != "admin" and kind in base.texts:
            site.texts[kind] = base.texts[kind]
    site.texts = {kind: site.texts[kind] for kind in KINDS if kind in site.texts}
    return site


def install(app: Flask) -> Site:
    """Validate ``site:``, log what deserves a warning, and wire the context processor,
    the robots header and the routes. Raises ValueError for a wrong value."""
    site = Site.from_config(app.config)
    app.extensions["annzarro_site"] = site
    for warning in site.warnings:
        logger.warning("Site: %s", warning)
    if site.texts and site.footer_links == "about-only":
        logger.warning("Site: footer_links is about-only, so the imprint and privacy links are not visible on "
                       "every page. German and EU guidance expect them on each page of a public site.")
    warn_about_config(app.config)
    hosted = is_hosted(app.config)

    @app.context_processor
    def _site_context():
        return {"site": SiteView(current(app), request.script_root if has_request_context() else "", hosted)}

    @app.after_request
    def _robots_header(response):
        if current(app).noindex(app.config.get("auth_enabled", False)):
            response.headers["X-Robots-Tag"] = "noindex, nofollow"
        return response

    register_routes(app)
    return site


def warn_if_unpublished(app: Flask) -> None:
    """At start, once the policy engine is wired: a hosted server with neither an imprint nor a
    privacy notice (from the YAML or the admin page) says where to add them."""
    if not is_hosted(app.config):
        return
    site = current(app)
    if site.text("imprint") or site.text("privacy"):
        return
    where = ("the admin page's Public site section (/admin#site) or " if app.config.get("auth_enabled") else "")
    logger.warning("Site: this server is reachable by other people and publishes no imprint and no privacy "
                   "notice. Add them in %sthe site: section of the configuration; the guide says what a public "
                   "site owes its visitors: %s", where, GUIDE_URL)


def _not_found() -> Response:
    """Plain text, so a missing page is not an HTML document (every HTML page carries a CSP)."""
    return Response("Not found\n", status=404, mimetype="text/plain")


def _page(app: Flask, site: Site, title: str, body: str, generated: bool = False) -> Response:
    from .admin.guard import CSP
    response = make_response(render_template(
        "site_page.html", app_name=app.config.get("app_name", "AnnZarro"), title=title, body=body,
        language="en" if generated else site.language))
    response.headers["Content-Security-Policy"] = CSP
    response.headers["Cache-Control"] = "no-cache"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


def data_facts(app: Flask, site: Site) -> Dict[str, Any]:
    """What /site/data states, from the running configuration and the server's policy (the
    widest any account gets: a per-user override can only narrow an outbound key)."""
    from annzarro import __version__
    from annzarro.server.policy.panels import GENE_SET_SERVICES, PUBLISHING_SERVICES, SPECIES_HOSTS
    from annzarro.server.policy.routes import EXTENSION
    eng = app.extensions.get(EXTENSION)
    values = eng.effective(None) if eng is not None else {}
    mode = values.get("panel.gene-set.external_requests", "ask")
    if values.get("panel.gene-set.enabled") is False:
        mode = "none"
    services = values.get("panel.gene-set.services", [])
    providers = {"string": "STRING", "gprofiler": "g:Profiler", "mygene": "MyGene.info",
                 "hpa": "Human Protein Atlas", "enrichr": "Enrichr", "reactome": "Reactome"}
    labels = []
    for service in GENE_SET_SERVICES:
        label = providers.get(service["id"].split("-")[0], service["label"])
        if service["id"] in services and label not in labels:
            labels.append(label)
    custom = (app.config.get("contact_info") or {}).get("custom_html")
    return {
        "auth": bool(app.config.get("auth_enabled")), "convenience": site.persistent_convenience,
        "storage": STORAGE_INVENTORY, "mode": mode, "services": labels if mode in ("ask", "on") else [],
        "publishing": [s["label"] for s in GENE_SET_SERVICES
                       if s["id"] in PUBLISHING_SERVICES and s["id"] in services] if mode in ("ask", "on") else [],
        "species": bool(values.get("panel.gene-set.species_search")) and mode in ("ask", "on"),
        "species_hosts": SPECIES_HOSTS, "links": bool(values.get("panel.gene-set.links", True)) and mode != "none",
        "third_party_login": isinstance(custom, str) and bool(_RISKY_HTML_RE.search(custom)),
        "privacy": site.text("privacy"), "operator": site.operator, "version": __version__, "guide": GUIDE_URL,
    }


def register_routes(app: Flask) -> None:
    """``/site/<kind>``, ``/robots.txt`` and ``/.well-known/security.txt``. Their endpoints start with
    ``site_``: the sign-in wrapper (core.register_auth_routes) leaves those open. They read the site in
    effect (:func:`current`)."""
    from . import access

    @app.route("/site/<kind>", methods=["GET"])
    @access.gate("public")
    def site_page(kind):
        site = current(app)
        if kind == "data":
            body = render_template("_site_data.html", facts=data_facts(app, site),
                                   root=request.script_root, data_label=DATA_LABEL)
            return _page(app, site, DATA_LABEL, body, generated=True)
        if kind == "about":
            from annzarro import __version__
            body = render_template("_site_about.html", version=__version__)
            return _page(app, site, f"About {app.config.get('app_name', 'AnnZarro')}", body, generated=True)
        text = site.text(kind) if kind in KINDS else None
        if text is None:
            return _not_found()
        if text.url:
            return redirect(text.url, code=302)
        return _page(app, site, text.label, text.page_html)

    @app.route("/robots.txt", methods=["GET"])
    @access.gate("public")
    def site_robots():
        if not current(app).noindex(app.config.get("auth_enabled", False)):
            return _not_found()
        response = make_response("User-agent: *\nDisallow: /\n")
        response.headers["Content-Type"] = "text/plain; charset=utf-8"
        return response

    @app.route("/.well-known/security.txt", methods=["GET"])
    @access.gate("public")
    def site_security_txt():
        site = current(app)
        if not site.security_contact:
            return _not_found()
        expires = (datetime.datetime.now(datetime.timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
                   + datetime.timedelta(days=364))
        lines = [f"Contact: {site.security_contact}",
                 f"Expires: {expires.strftime('%Y-%m-%dT%H:%M:%S.000Z')}",
                 f"Preferred-Languages: {site.language}", ""]
        response = make_response("\n".join(lines))
        response.headers["Content-Type"] = "text/plain; charset=utf-8"
        return response


_RISKY_HTML_RE = re.compile(
    r"<\s*(?:script|iframe|object|embed)\b|\bsrc\s*=\s*[\"']?\s*(?:https?:)?//"
    r"|<\s*link\b[^>]*\bhref\s*=\s*[\"']?\s*(?:https?:)?//", re.IGNORECASE)


def warn_about_config(config: Dict[str, Any]) -> None:
    """Startup warnings about what makes a deployer responsible for more than the defaults:
    third-party content on the login page, and sending gene lists to outside services unasked."""
    custom = (config.get("contact_info") or {}).get("custom_html")
    if isinstance(custom, str) and _RISKY_HTML_RE.search(custom):
        logger.warning(
            "Site: branding.contact_info.custom_html contains a script, an iframe, an embed or an address on "
            "another server. Third-party content can receive your visitors' IP addresses and may need their "
            "consent; the privacy notice must name it (docs/deployment/public-site.md).")
    integrations = config.get("integrations") or {}
    mode = os.environ.get("ANNZARRO_EXTERNAL_REQUESTS", "").strip().lower() or integrations.get("external_requests")
    if mode == "on":
        from annzarro.core.remote import hosted_reasons
        if hosted_reasons(config) or config.get("auth_enabled"):
            logger.warning(
                "Site: integrations.external_requests is \"on\" on a shared server, so the Gene Set panel sends "
                "gene lists and every visitor's IP address to outside services (STRING, g:Profiler, MyGene.info, "
                "Enrichr ...) without asking. Tell your users in the privacy notice and make sure you have a "
                "legal basis, or use \"ask\" (docs/deployment/public-site.md).")


# ---- the site.* policy keys: what the admin page's Public site section edits ----------------------

TEXT_FIELDS = ("label", "url", "markdown", "file")


def _check(path: str, value: Any) -> None:
    """Refuse ``value`` for ``site.<path>`` exactly as the server's start does."""
    section: Dict[str, Any] = {}
    node = section
    *parents, leaf = path.split(".")
    for part in parents:
        node = node.setdefault(part, {})
    node[leaf] = value
    try:
        Site.from_config({"site": section})
    except ValueError as exc:
        raise PolicyValueError(BAD_TYPE, str(exc))


class TextSetting(PolicyType):
    """One of the four texts: ``{label, url, markdown, file}``, each field null when unset."""

    kind = "site_text"

    def __init__(self, text_kind: str):
        self.text_kind = text_kind

    def validate(self, value):
        if not isinstance(value, dict) or set(value) - set(TEXT_FIELDS):
            raise PolicyValueError(BAD_TYPE, f"site.{self.text_kind} must be a mapping with url, markdown, file and label")
        _check(self.text_kind, value)
        label = value.get("label")
        markdown = value.get("markdown")
        return {"label": DEFAULT_LABELS[self.text_kind] if label is None else str(label).strip(),
                "url": _clean(value.get("url")),
                "markdown": markdown if isinstance(markdown, str) and markdown.strip() else None,
                "file": _clean(value.get("file"))}

    def validate_stored(self, value):
        canonical = self.validate(value)
        if canonical["file"] is not None:
            raise PolicyValueError(BAD_TYPE, f"site.{self.text_kind}.file can only be set in the configuration file "
                                             "(a page anyone can open must not publish a file of the server's "
                                             "choosing from the browser); paste the text, or give a url")
        return canonical

    def restrict(self, values):
        return values[0]

    def describe(self):
        return {"kind": self.kind, "text": self.text_kind, "default_label": DEFAULT_LABELS[self.text_kind],
                "label_max": LABEL_MAX, "markdown_max": MAX_CHARS}

    def samples(self):
        empty = dict.fromkeys(TEXT_FIELDS)
        return ({**empty, "label": DEFAULT_LABELS[self.text_kind], "url": "https://example.org/text"},
                {**empty, "label": DEFAULT_LABELS[self.text_kind], "markdown": "A text"})


class LineSetting(PolicyType):
    """A one-line text (an address, a label, a language tag); ``default`` stands for null or empty."""

    kind = "site_line"

    def __init__(self, path: str, samples: Tuple[str, str], default: Optional[str] = None, format: str = "text"):
        self.path = path
        self.default = default
        self.format = format
        self._samples = samples

    def validate(self, value):
        if value is not None and not isinstance(value, str):
            raise PolicyValueError(BAD_TYPE, f"site.{self.path} must be text")
        _check(self.path, value)
        cleaned = _clean(value)
        return self.default if cleaned is None else cleaned

    def restrict(self, values):
        return values[0]

    def describe(self):
        return {"kind": self.kind, "format": self.format, "nullable": self.default is None}

    def samples(self):
        return self._samples


def _text_reader(kind: str):
    """The YAML's ``site.<kind>``, when some file other than the package's defaults set a field of it
    (the config manager records each field, not the mapping)."""
    path = f"site.{kind}"

    def read(config):
        tree = config.get("config_tree")
        if tree is None:
            entry = (config.get("site") or {}).get(kind)
            return entry is not None, entry, False
        origins = config.get("config_origins") or {}
        mine = [o for k, o in origins.items() if k == path or k.startswith(path + ".")]
        if not any(not str(o).startswith("defaults:") for o in mine):
            return False, None, False
        entry = (tree.get("site") or {}).get(kind)
        return entry is not None, entry, False
    return read


#: The help of each key, shown on hover in the admin page and by GET /api/v1/admin/policy
_HELP = {
    "imprint": "Who provides this site, as the law of your country asks (in Germany the Impressum, \u00a7 5 DDG: "
               "name, address, a fast contact). Shown in the footer, in About and at /site/imprint.",
    "privacy": "Your privacy notice: what you, as the operator, collect and why (GDPR Art. 13). Shown in the "
               "footer, in About and at /site/privacy; the Data & privacy page links it.",
    "accessibility": "An accessibility statement (the EU directive 2016/2102 asks public bodies for one; "
                     "Barrierefreiheit in Germany). Shown in the footer, in About and at /site/accessibility.",
    "terms": "Terms of use, if you have any. Shown in the footer, in About and at /site/terms.",
    "operator": "Who runs this site, as one line (\u201cExample Institute, University of X\u201d). Shown in About "
                "and on the Data & privacy page. Never filled in for you.",
    "contact": "An e-mail address or an http(s) address for the site. Shown in the footer and in About; About "
               "falls back to branding.contact_info.email. A German imprint needs a fast way to reach you.",
    "contact_label": "The link text of the contact in the footer and in About (German sites: Kontakt).",
    "footer_links": "auto: a small footer line on every page links the texts (and, on a hosted server, About "
                    "and Data & privacy). about-only: only the About dialog lists them.",
    "robots": "Whether search engines may index the site. auto: not when login is on. index: always. noindex "
              "sends X-Robots-Tag and serves a robots.txt that disallows everything.",
    "security_contact": "A mailto: or https:// address for vulnerability reports; serves "
                        "/.well-known/security.txt (RFC 9116).",
    "languages": "The language of your texts (en, de ...): the lang of the text pages and Preferred-Languages "
                 "in security.txt.",
    "software_credits": "Keeps AnnZarro's credit in About (the Setty Lab, the NIH funding, how to cite it). "
                        "Off leaves the name, version, licence and links. It credits the software, never your site.",
    "storage.persistent_convenience": "Off keeps the layout autosave, the last sessions and the recent datasets "
                                      "only until the tab closes, so the browser keeps nothing between visits but "
                                      "the visitor's own choices.",
}


#: the short name of each key on the admin page
_LABELS = {
    "imprint": "Imprint",
    "privacy": "Privacy notice",
    "accessibility": "Accessibility statement",
    "terms": "Terms of use",
    "operator": "Operator",
    "contact": "Contact",
    "contact_label": "Contact link text",
    "security_contact": "Security contact",
    "languages": "Language of the texts",
    "footer_links": "Footer links",
    "robots": "Search engines",
    "software_credits": "AnnZarro credit in About",
    "storage.persistent_convenience": "Keep convenience items between visits",
}

#: the anchor of each key on the public-site guide (docs/deployment/public-site.md)
_GUIDE = {
    "imprint": "imprint-checklist-for-germany", "privacy": "privacy-notice-template-english",
    "accessibility": "accessibility", "footer_links": "where-the-texts-appear",
    "storage.persistent_convenience": "browser-storage",
}


def _declare_site_keys() -> None:
    def add(path, type_, default, **kw):
        declare(Key(name=f"site.{path}", type=type_, default=default, scope="server", area="site", section="site",
                    client=False, config_path=f"site.{path}", description=_HELP[path], label=_LABELS[path],
                    guide="deployment/public-site.html#" + _GUIDE.get(path, "configuring-the-site"), **kw))

    for kind in KINDS:
        add(kind, TextSetting(kind), {**dict.fromkeys(TEXT_FIELDS), "label": DEFAULT_LABELS[kind]},
            config_reader=_text_reader(kind))
    add("operator", LineSetting("operator", ("Example Institute", "Example Lab")), None)
    add("contact", LineSetting("contact", ("office@example.org", "https://example.org/contact"), format="contact"), None)
    add("contact_label", LineSetting("contact_label", ("Contact", "Kontakt"), default=CONTACT_LABEL), CONTACT_LABEL)
    add("footer_links", Enum(list(FOOTER_MODES)), "auto")
    add("robots", Enum(list(ROBOTS_MODES)), "auto")
    add("security_contact", LineSetting("security_contact", ("mailto:security@example.org",
                                                             "https://example.org/security"), format="security"), None)
    add("languages", LineSetting("languages", ("en", "de"), default="en", format="language"), "en")
    add("software_credits", Bool(), True)
    add("storage.persistent_convenience", Bool(), True)


_declare_site_keys()
#: Every site.* key, in the order the admin page shows them
SITE_KEYS = tuple(f"site.{p}" for p in (*KINDS, "operator", "contact", "contact_label", "footer_links", "robots",
                                         "security_contact", "languages", "software_credits",
                                         "storage.persistent_convenience"))
