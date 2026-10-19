"""JSON log lines (``server.log_format: json``).

One JSON object per line on stderr, for a log shipper (journald, Loki,
Elasticsearch) that would otherwise have to parse the text format::

    {"ts": "2026-10-19T08:15:02.113Z", "level": "INFO", "logger": "annzarro.access",
     "message": "GET data/obs 200", "request_id": "3f1c9a0b5d2e4a67", "method": "GET",
     "route_group": "data/obs", "status": 200, "duration_ms": 41.7}

``request_id``, ``method`` and ``route_group`` are on every line written while a
request is being served; ``status`` and ``duration_ms`` only on the one access
line each request gets (logger ``annzarro.access``). The access line carries no
client address, path or query string: less than the gunicorn access log it
replaces in this mode. The default (``text``) is unchanged.
"""

import json
import logging
import re
import uuid
from datetime import datetime, timezone

from flask import has_request_context, request

__all__ = ["JsonFormatter", "RequestContextFilter", "ACCESS_LOGGER", "REQUEST_ID_KEY", "log_dict_config",
           "new_request_id", "normalise_format"]

ACCESS_LOGGER = "annzarro.access"
#: The WSGI environ key that carries the request id for the life of the request.
REQUEST_ID_KEY = "annzarro.request_id"
ROUTE_GROUP_KEY = "annzarro.route_group"
FORMATS = ("text", "json")
_SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
#: Record attributes the formatter writes as fields when a record has them.
_FIELDS = ("request_id", "method", "route_group", "status", "duration_ms")


def normalise_format(value):
    """``text`` or ``json``; anything else is a configuration error, not a silent default."""
    text = str(value if value is not None else "text").strip().lower()
    if text not in FORMATS:
        raise ValueError(f"server.log_format must be one of {', '.join(FORMATS)} (got {value!r})")
    return text


def new_request_id(incoming=None):
    """The caller's ``X-Request-Id`` when it is a short plain token, else a fresh one.

    A header is untrusted text that ends up in every log line, so only
    letters, digits and ``._-`` up to 64 characters pass.
    """
    if incoming and _SAFE_ID.match(incoming):
        return incoming
    return uuid.uuid4().hex[:16]


class RequestContextFilter(logging.Filter):
    """Put the running request's id, method and route group on every record that lacks them."""

    def filter(self, record):
        if has_request_context() and not hasattr(record, "request_id"):
            environ = request.environ
            rid = environ.get(REQUEST_ID_KEY)
            if rid:
                from .telemetry import route_group
                record.request_id = rid
                record.method = request.method
                record.route_group = route_group(request)
        return True


class JsonFormatter(logging.Formatter):
    """One JSON object per record (see the module docstring for the fields)."""

    def format(self, record):
        moment = datetime.fromtimestamp(record.created, timezone.utc)
        line = {
            "ts": moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for name in _FIELDS:
            value = getattr(record, name, None)
            if value is not None:
                line[name] = value
        if record.exc_info:
            line["exception"] = self.formatException(record.exc_info)
        return json.dumps(line, ensure_ascii=False, default=str)


def log_dict_config(level):
    """gunicorn's ``logconfig_dict`` for JSON: its error log in the same format on stderr.

    gunicorn's own access log is switched off in this mode (``accesslog = None``):
    the app writes the access line itself, with the request id.
    """
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "root": {"level": level, "handlers": ["json"]},
        "loggers": {
            "gunicorn.error": {"level": level, "handlers": ["json"], "propagate": False,
                               "qualname": "gunicorn.error"},
            "gunicorn.access": {"level": "CRITICAL", "handlers": [], "propagate": False,
                                "qualname": "gunicorn.access"},
        },
        "handlers": {"json": {"class": "logging.StreamHandler", "formatter": "json",
                              "filters": ["request"], "stream": "ext://sys.stderr"}},
        "formatters": {"json": {"()": "annzarro.server.jsonlog.JsonFormatter"}},
        "filters": {"request": {"()": "annzarro.server.jsonlog.RequestContextFilter"}},
    }
