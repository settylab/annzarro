"""
Forged-request protection for the whole app
-------------------------------------------

The checks the admin guard introduced (``admin/guard.py`` imports them from
here), applied to every other route that changes state.

``enforce`` is a ``before_request`` hook for unsafe methods:

* login on and the requester logged in: the session's token must come back in
  ``X-AnnZarro-CSRF`` (``csrf_ok``), and the ``Origin`` and ``Sec-Fetch-Site``
  checks apply as well;
* login on and nobody logged in: the request passes, because the route's own
  login check answers it (401 or a redirect) and an anonymous request changes
  nothing. A client whose login just expired thereby still learns that, instead
  of getting a 403 about its token;
* login off (a single-user desktop or a trusted network): there is no session
  to hold a token, so only ``Origin`` and ``Sec-Fetch-Site`` are checked. A
  request without either header (``curl``, ``annzarro export``) passes.

Routes that guard themselves are skipped: admin routes (``_annzarro_admin``,
see ``admin/guard.py``) and those marked with ``exempt`` (``POST /login``,
which has no session yet and uses a double-submit token instead, below).

Login CSRF: the sign-in page sets a random nonce in a short-lived
``SameSite=Strict`` cookie and puts a keyed hash of it (``login_field``) in a
hidden field of the form; the POST must return a cookie and a field that belong
together. A page on another site can neither read the cookie nor make the
browser send it with a cross-site request. The hash matters against a page on a
sibling subdomain, which can *set* the cookie for the whole domain: without the
server's key it cannot compute the field that goes with a nonce of its choosing.
"""

import hmac
import logging
import secrets
from urllib.parse import urlsplit

from flask import current_app, jsonify, make_response, request, session

logger = logging.getLogger(__name__)

CSRF_HEADER = "X-AnnZarro-CSRF"
#: The logout form cannot set a header, so it sends the token in this field.
CSRF_FIELD = "csrf_token"
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")

LOGIN_COOKIE = "annzarro_login_csrf"
LOGIN_FIELD = "login_csrf"
#: Seconds the sign-in page stays valid.
LOGIN_TTL = 600


def own_origin():
    return request.host_url.rstrip("/")


def proxy_hint():
    """Said when an honest-looking change fails the Origin check on a server
    that is not told about its proxy."""
    origin = request.headers.get("Origin")
    if origin and origin != own_origin() and not current_app.config.get("proxy_count", 0):
        return (" - if a reverse proxy terminates TLS or rewrites Host, set server.proxy_count "
                "(and have it send X-Forwarded-Proto and X-Forwarded-Host), else every change fails")
    return ""


def start_session():
    """A fresh token for a new login (call after ``session.clear()``)."""
    session["csrf"] = secrets.token_urlsafe(32)


def csrf_token():
    """The session's CSRF token, minted if the login predates it."""
    if not session.get("csrf"):
        start_session()
    return session["csrf"]


def token_ok(allow_form=False):
    token = session.get("csrf")
    sent = request.headers.get(CSRF_HEADER, "")
    if not sent and allow_form:
        sent = request.form.get(CSRF_FIELD, "")
    return bool(token and sent and hmac.compare_digest(token.encode("utf-8"), sent.encode("utf-8")))


def origin_ok():
    """What a browser volunteers: a foreign ``Origin`` or a ``Sec-Fetch-Site``
    other than ``same-origin`` is a request made by another page."""
    origin = request.headers.get("Origin")
    if origin is not None and origin != own_origin():
        return False
    site = request.headers.get("Sec-Fetch-Site")
    if site is not None and site != "same-origin":
        return False
    if origin is None and site is None:
        # an older browser sends neither on some cross-site posts, but still a Referer
        referer = request.headers.get("Referer")
        if referer:
            parts = urlsplit(referer)
            if f"{parts.scheme}://{parts.netloc}" != own_origin():
                return False
    return True


def csrf_ok(allow_form=False):
    return token_ok(allow_form) and origin_ok()


def log_refusal(username, allow_form=False, log=logger):
    # Origin and Host are logged because a proxy that rewrites Host without
    # server.proxy_count makes every honest change look cross-origin
    sent = request.headers.get(CSRF_HEADER) or (allow_form and request.form.get(CSRF_FIELD))
    log.warning("Refused %s %s from %r (%s): CSRF check failed (token %s, Origin %r, "
                   "Sec-Fetch-Site %r, this server is %r)", request.method, request.path,
                   username, request.remote_addr, "sent" if sent else "missing",
                   request.headers.get("Origin"), request.headers.get("Sec-Fetch-Site"),
                   own_origin() + proxy_hint())


def refuse():
    message = "The page is out of date. Reload it and try again."
    origin = request.headers.get("Origin")
    if origin and origin != own_origin() and not current_app.config.get("proxy_count", 0):
        message += (" If this server runs behind a reverse proxy, set server.proxy_count to the number "
                    "of proxies, or the address the browser uses does not match the one the server sees.")
    if request.path.startswith("/api/"):
        response = jsonify(error=message, reason="csrf_failed")
    else:
        response = make_response(f"<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
                                 f"<title>403</title></head><body><h1>403</h1><p>{message}</p></body></html>")
        response.mimetype = "text/html"
    response.status_code = 403
    response.headers["Cache-Control"] = "no-store"
    return response


def exempt(view):
    """Mark a view that does its own forgery check (``POST /login``)."""
    view._annzarro_csrf_exempt = True
    return view


def guards_itself(view):
    return bool(getattr(view, "_annzarro_admin", False) or getattr(view, "_annzarro_csrf_exempt", False))


def enforce():
    """``before_request`` hook, see the module docstring."""
    if request.method in SAFE_METHODS:
        return None
    view = current_app.view_functions.get(request.endpoint)
    if view is None or guards_itself(view):
        return None
    if current_app.config.get("auth_enabled", False):
        from .core import is_logged_in
        if not is_logged_in():
            return None
        form = request.endpoint == "logout"
        if csrf_ok(allow_form=form):
            return None
        log_refusal(session.get("user_id"), allow_form=form)
        return refuse()
    if origin_ok():
        return None
    log_refusal(None)
    return refuse()


def warn_about_proxy(config):
    """A shared server with login off that listens on loopback is almost
    certainly behind a reverse proxy. Without ``server.proxy_count`` it sees its
    own http://127.0.0.1 origin, not the https:// one the browser sends, and the
    Origin check refuses every change. (With login on, admin/__init__.py says it.)"""
    from . import confinement
    if (not config.get("auth_enabled") and not config.get("proxy_count", 0)
            and config.get("host") in ("127.0.0.1", "localhost", "::1")
            and confinement.is_hosted(config)):
        logger.warning(
            "This server is shared (server.hosted) and listens on %s with login off and server.proxy_count 0. "
            "Behind a reverse proxy that terminates TLS or rewrites Host, every save and delete "
            "will fail with csrf_failed; set server.proxy_count to the number of proxies.",
            config.get("host"))


def install(app):
    warn_about_proxy(app.config)
    app.before_request(enforce)


def new_login_token():
    """A nonce for the cookie; the form gets ``login_field`` of it."""
    return secrets.token_urlsafe(24)


def login_field(nonce):
    """What the form must carry for the cookie ``nonce``: a keyed hash, so that
    a cookie set by another page (cookie tossing) comes without its field."""
    key = current_app.secret_key
    key = key.encode("utf-8") if isinstance(key, str) else key
    return hmac.new(key, b"annzarro-login-form:" + nonce.encode("utf-8"), "sha256").hexdigest()


def set_login_cookie(response, token):
    interface = current_app.session_interface
    secure = interface.get_cookie_secure(current_app) if hasattr(interface, "get_cookie_secure") else False
    response.set_cookie(LOGIN_COOKIE, token, max_age=LOGIN_TTL, httponly=True, samesite="Strict",
                        secure=bool(secure), path=request.script_root or "/")
    return response


def login_token_ok():
    cookie = request.cookies.get(LOGIN_COOKIE, "")
    sent = request.form.get(LOGIN_FIELD, "")
    return bool(cookie and sent and hmac.compare_digest(login_field(cookie).encode("utf-8"), sent.encode("utf-8")))
