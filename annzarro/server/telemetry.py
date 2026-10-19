"""Per-request telemetry: metrics (``/metrics``) and JSON access lines.

One WSGI middleware, outermost, sees every request the app answers, including
those a ``before_request`` hook refuses and an unhandled error, and measures it
from the first byte in to the last byte out (a streamed reply of every cell
name is timed until the client has read it, which is what holds a server
thread). It is installed only when ``server.metrics_enabled`` or
``server.log_format: json`` asks for it; otherwise the app is not wrapped at all.

Requests are grouped by route, never by URL: ``data/obs``, ``datasets/folder``,
``admin``, ``static``. The group comes from the URL *rule* Flask matched, so a
dataset path, a cell name or a user name can never become a label or a log field.
"""

import logging
import re
import time

from flask import request

from . import jsonlog

__all__ = ["install", "route_group", "METHODS"]

logger = logging.getLogger(__name__)
access_logger = logging.getLogger(jsonlog.ACCESS_LOGGER)

#: Methods that get their own label value; any other (a probe's made-up verb) is "OTHER".
METHODS = ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
_API_PREFIX = re.compile(r"^/api/v\d+/")


def route_group(req):
    """The route group of a Flask request: a short fixed name for the matched URL rule.

    ``/api/v1/data/obs`` is ``data/obs``, ``/api/v1/data/layer/<path:layer_name>`` is
    ``data/layer``, every admin endpoint is ``admin``, the page shell and its deep links
    are ``page``, a URL that matched nothing is ``unmatched``. At most about a hundred
    values exist: one per rule, with the parameters cut.
    """
    rule = req.url_rule
    if rule is None:
        return "unmatched"
    template = rule.rule
    if _API_PREFIX.match(template):
        parts = [p for p in _API_PREFIX.sub("", template).split("/") if p and not p.startswith("<")]
        if parts and parts[0] == "admin":
            return "admin"
        return "/".join(parts[:2]) or "api"
    parts = [p for p in template.split("/") if p]
    if not parts or parts[0].startswith("<"):
        return "page"
    return "admin" if parts[0] == "admin" else parts[0].lstrip(".")


def _method(name):
    return name if name in METHODS else "OTHER"


class _Body:
    """The reply's body iterator, counting bytes and reporting the request done at the end."""

    def __init__(self, iterable, done):
        self._iterable = iterable
        self._iter = iter(iterable)
        self._done = done
        self.nbytes = 0

    def __iter__(self):
        return self

    def __next__(self):
        try:
            chunk = next(self._iter)
        except StopIteration:
            self._done(self.nbytes)
            raise
        self.nbytes += len(chunk)
        return chunk

    def close(self):
        try:
            close = getattr(self._iterable, "close", None)
            if close is not None:
                close()
        finally:
            self._done(self.nbytes)


class RequestTelemetry:
    """WSGI middleware: time each request, count its bytes, feed the collector and the access log."""

    def __init__(self, wsgi_app, collector=None, json_access=False):
        self.wsgi_app = wsgi_app
        self.collector = collector
        self.json_access = json_access

    def __call__(self, environ, start_response):
        started = time.perf_counter()
        method = _method(environ.get("REQUEST_METHOD", "GET"))
        if self.json_access:
            environ[jsonlog.REQUEST_ID_KEY] = jsonlog.new_request_id(environ.get("HTTP_X_REQUEST_ID"))
        if self.collector is not None:
            self.collector.begin()
        seen = {"status": 500, "finished": False}

        def done(nbytes):
            if seen["finished"]:
                return
            seen["finished"] = True
            self._finish(environ, method, seen["status"], time.perf_counter() - started, nbytes)

        def capture(status, headers, exc_info=None):
            try:
                seen["status"] = int(status.split(" ", 1)[0])
            except ValueError:
                pass
            return start_response(status, headers, exc_info)

        try:
            body = self.wsgi_app(environ, capture)
        except BaseException:
            done(0)
            raise
        return _Body(body, done)

    def _finish(self, environ, method, status, seconds, nbytes):
        group = environ.get(jsonlog.ROUTE_GROUP_KEY, "unmatched")
        try:
            if self.collector is not None:
                self.collector.end(group, method, status, seconds, nbytes)
            if self.json_access:
                level = logging.DEBUG if group == "metrics" else logging.INFO
                access_logger.log(level, "%s %s %s", method, group, status, extra={
                    "request_id": environ.get(jsonlog.REQUEST_ID_KEY), "method": method,
                    "route_group": group, "status": status, "duration_ms": round(seconds * 1000, 1)})
        except Exception:
            logger.exception("Request telemetry failed")


def install(app):
    """Wrap ``app`` when metrics or JSON logs are on; return the collector (None without metrics).

    Call last in ``create_app``, so the middleware is the outermost layer.
    """
    from . import metrics
    collector = metrics.install(app)
    json_access = jsonlog.normalise_format(app.config.get("log_format")) == "json"
    if collector is None and not json_access:
        return None

    @app.after_request
    def _tag(response):
        request.environ[jsonlog.ROUTE_GROUP_KEY] = route_group(request)
        rid = request.environ.get(jsonlog.REQUEST_ID_KEY)
        if rid:
            response.headers["X-Request-Id"] = rid
        return response

    app.wsgi_app = RequestTelemetry(app.wsgi_app, collector, json_access)
    return collector
