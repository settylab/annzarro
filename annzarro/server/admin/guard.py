"""
The guard every admin route sits behind
---------------------------------------

``require_admin`` is applied to each admin view itself (not only by the
wrapper loop in ``register_auth_routes``), marks it with
``_annzarro_admin`` (a test walks ``app.url_map`` and fails for a rule
without the mark), and checks, in this order, answering at the first failure:

1. login is off: 404 ``admin_requires_login``;
2. nobody is logged in: 401 JSON for the API, a redirect to the login page
   for ``/admin``;
3. the user is not an admin (read from the user store, not the cookie): 403
   ``admin_only``. Recorded in the audit log when the method is unsafe;
4. unsafe method: the CSRF checks (403 ``csrf_failed``), then a JSON body
   (415 ``json_required``);
5. unsafe method, except the re-authentication itself: the password was
   entered within ``server.admin_reauth_minutes`` (403 ``reauth_required``);
6. the per-admin rate limit (429 ``admin_rate_limited``);
7. the view runs, and its answer is ``Cache-Control: no-store``.

The CSRF token is ``session["csrf"]``, minted at login; the page carries it in
``<meta name="annzarro-csrf">`` and the API client sends it as
``X-AnnZarro-CSRF``. Beside the token: a JSON content type (with the custom
header it forces a CORS preflight that this server never grants with
credentials), an ``Origin`` that is this server's own, and a
``Sec-Fetch-Site`` of ``same-origin`` when the browser sends one.
"""

import hmac
import html
import logging
import math
import secrets
import threading
import time
from functools import wraps

from flask import current_app, jsonify, make_response, request, session

from . import audit, rate_per_minute, reauth_minutes

logger = logging.getLogger(__name__)

CSRF_HEADER = "X-AnnZarro-CSRF"
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")
#: Reads get this many times the mutation rate.
READ_RATE_FACTOR = 8
#: Refused attempts by one non-admin that are audited per minute and worker.
#: Without a cap any account could flush the real history out of the rotated
#: files by hammering an admin route; the rest go to the server log only.
REFUSAL_AUDIT_PER_MINUTE = 6

CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data:; object-src 'none'; base-uri 'none'; "
       "frame-ancestors 'none'; form-action 'self'")


def _now():
    return time.monotonic()


def start_admin_session():
    """Called by ``login()`` after ``session.clear()``: a fresh CSRF token for
    this login, and the password just entered opens the re-auth window."""
    session["csrf"] = secrets.token_urlsafe(32)
    session["admin_auth_at"] = time.time()


def csrf_token():
    """The session's CSRF token, minted if the login predates it."""
    if not session.get("csrf"):
        session["csrf"] = secrets.token_urlsafe(32)
    return session["csrf"]


class RateLimiter:
    """A token bucket per (admin, kind) in this worker.

    ``rate`` tokens per minute, capacity ``rate``. Gunicorn runs several
    workers, so the effective limit is that many times higher."""

    def __init__(self):
        self._buckets = {}
        self._lock = threading.Lock()

    def take(self, key, rate):
        """None if allowed, else the seconds to wait."""
        now = _now()
        with self._lock:
            tokens, stamp = self._buckets.get(key, (rate, now))
            tokens = min(rate, tokens + (now - stamp) * rate / 60.0)
            if tokens >= 1:
                self._buckets[key] = (tokens - 1, now)
                return None
            self._buckets[key] = (tokens, now)
            return max(1, math.ceil((1 - tokens) * 60.0 / rate))


def _limiter():
    state = current_app.extensions.setdefault("annzarro_admin", {})
    if "limiter" not in state:
        state["limiter"] = RateLimiter()
    return state["limiter"]


def _is_api():
    return request.path.startswith("/api/")


def _harden(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def with_csp(response):
    response.headers["Content-Security-Policy"] = CSP
    return response


def refuse(status, reason, message, **extra):
    """An error answer: JSON for the API, a small HTML page for ``/admin``."""
    if _is_api():
        response = jsonify(dict(error=message, reason=reason, **extra))
    else:
        response = make_response(
            "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>"
            f"{status}</title></head><body><h1>{status}</h1><p>{html.escape(message)}</p>"
            "</body></html>")
        response.mimetype = "text/html"
        with_csp(response)
    response.status_code = status
    return _harden(response)


def _own_origin():
    return request.host_url.rstrip("/")


def _csrf_ok():
    token = session.get("csrf")
    sent = request.headers.get(CSRF_HEADER, "")
    if not token or not sent or not hmac.compare_digest(token.encode("utf-8"), sent.encode("utf-8")):
        return False
    origin = request.headers.get("Origin")
    if origin is not None and origin != _own_origin():
        return False
    site = request.headers.get("Sec-Fetch-Site")
    if site is not None and site != "same-origin":
        return False
    return True


def _action_name(default):
    return default or f"{request.method} {request.path}"


def _check(reauth, action):
    config = current_app.config
    if not config.get("auth_enabled", False):
        return refuse(404, "admin_requires_login",
                      "The admin interface needs login. Enable it, or use the annzarro CLI.")
    from ..core import is_logged_in, login_required_response
    if not is_logged_in():
        return login_required_response()
    from .. import permissions
    username, is_admin = permissions.current_user()
    unsafe = request.method not in SAFE_METHODS
    if not is_admin:
        logger.warning("Refused %s %s: %r is not an admin (%s)", request.method, request.path,
                       username, request.remote_addr)
        if unsafe and _limiter().take((username, "refused-audit"), REFUSAL_AUDIT_PER_MINUTE) is None:
            try:
                audit.record(_action_name(action), None, None, "refused:admin_only")
            except Exception:
                logger.exception("Could not write the audit record of a refused admin request")
        return refuse(403, "admin_only", "This needs an administrator.")
    if unsafe:
        if not _csrf_ok():
            # Origin and Host are logged because a proxy that rewrites Host without
            # server.proxy_count makes every honest change look cross-origin
            logger.warning("Refused %s %s from %r (%s): CSRF check failed (token %s, Origin %r, "
                           "Sec-Fetch-Site %r, this server is %r)", request.method, request.path,
                           username, request.remote_addr,
                           "sent" if request.headers.get(CSRF_HEADER) else "missing",
                           request.headers.get("Origin"), request.headers.get("Sec-Fetch-Site"),
                           _own_origin())
            return refuse(403, "csrf_failed", "The page is out of date. Reload it and try again.")
        if request.mimetype != "application/json":
            return refuse(415, "json_required", "Send the request as application/json.")
        minutes = reauth_minutes(config)
        if reauth and minutes:
            try:
                age = time.time() - float(session.get("admin_auth_at", 0))
            except (TypeError, ValueError):
                age = float("inf")
            if not 0 <= age <= minutes * 60:
                return refuse(403, "reauth_required", "Confirm your password to make changes.",
                              reauth_url=request.script_root + "/api/v1/admin/reauth")
    rate = rate_per_minute(config)
    if unsafe:
        wait = _limiter().take((username, "write"), rate)
    else:
        wait = _limiter().take((username, "read"), rate * READ_RATE_FACTOR)
    if wait is not None:
        response = refuse(429, "admin_rate_limited", "Too many admin requests. Slow down.",
                          retry_after=wait)
        response.headers["Retry-After"] = str(wait)
        return response
    return None


def require_admin(view=None, *, reauth=True, action=None):
    """Guard an admin view. ``reauth=False`` exempts it from the re-auth
    window (only the re-authentication endpoint). ``action`` names the audit
    action recorded when a non-admin tries it (default: method and path)."""
    def decorate(fn):
        @wraps(fn)
        def guarded(*args, **kwargs):
            denied = _check(reauth, action)
            if denied is not None:
                return denied
            return _harden(make_response(fn(*args, **kwargs)))
        guarded._annzarro_admin = True
        return guarded
    return decorate(view) if view is not None else decorate
