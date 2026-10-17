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

A wrong value (a ``javascript:`` address, a missing file) stops the server at start.
"""
import datetime
import logging
import os
import re
from typing import Any, Dict, List, Optional

from flask import Flask, Response, has_request_context, make_response, redirect, render_template, request

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

    def __init__(self, site: Site, root: str):
        self.configured = site.configured
        self.operator = site.operator
        self.language = site.language
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
        # the footer: every text, then the contact, when something was configured to link to
        self.footer: List[Dict[str, Any]] = []
        explicit_contact = site.contact is not None
        if site.footer_links == "auto" and (self.texts or explicit_contact):
            for text in self.texts:
                if text["inline"]:
                    self.footer.append({"kind": text["kind"], "label": text["label"], "href": text["page"],
                                        "external": False, "inline": True})
                else:
                    self.footer.append({"kind": text["kind"], "label": text["label"], "href": text["url"],
                                        "external": text["external"], "inline": False})
            if self.contact:
                self.footer.append({"kind": "contact", "label": site.contact_label, "href": self.contact["href"],
                                    "external": self.contact["external"], "inline": False})
        self.show_block = bool(site.operator or self.texts or site.contact)


def get_site(app: Flask) -> Site:
    return app.extensions["annzarro_site"]


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

    @app.context_processor
    def _site_context():
        return {"site": SiteView(site, request.script_root if has_request_context() else "")}

    @app.after_request
    def _robots_header(response):
        if site.noindex(app.config.get("auth_enabled", False)):
            response.headers["X-Robots-Tag"] = "noindex, nofollow"
        return response

    register_routes(app, site)
    return site


def _not_found() -> Response:
    """Plain text, so a missing page is not an HTML document (every HTML page carries a CSP)."""
    return Response("Not found\n", status=404, mimetype="text/plain")


def register_routes(app: Flask, site: Site) -> None:
    """``/site/<kind>``, ``/robots.txt`` and ``/.well-known/security.txt``. Their endpoints start with
    ``site_``: the sign-in wrapper (core.register_auth_routes) leaves those open."""
    from . import access
    from .admin.guard import CSP

    @app.route("/site/<kind>", methods=["GET"])
    @access.gate("public")
    def site_page(kind):
        text = site.text(kind) if kind in KINDS else None
        if text is None:
            return _not_found()
        if text.url:
            return redirect(text.url, code=302)
        response = make_response(render_template(
            "site_page.html", app_name=app.config.get("app_name", "AnnZarro"), title=text.label,
            body=text.page_html, language=site.language))
        response.headers["Content-Security-Policy"] = CSP
        response.headers["Cache-Control"] = "no-cache"
        response.headers["Referrer-Policy"] = "same-origin"
        return response

    @app.route("/robots.txt", methods=["GET"])
    @access.gate("public")
    def site_robots():
        if not site.noindex(app.config.get("auth_enabled", False)):
            return _not_found()
        response = make_response("User-agent: *\nDisallow: /\n")
        response.headers["Content-Type"] = "text/plain; charset=utf-8"
        return response

    @app.route("/.well-known/security.txt", methods=["GET"])
    @access.gate("public")
    def site_security_txt():
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
