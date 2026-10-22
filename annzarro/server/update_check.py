"""
The admin update notice: is a newer AnnZarro on PyPI?
------------------------------------------------------

Asked only when an admin's Server health page loads (``GET /api/v1/admin/version-check``);
never at start-up, for other users or in the background. The answer is kept in memory for
a few hours per process, so reloading the page does not reach PyPI again. Any failure
(offline, timeout, bad JSON, a non-200 reply) answers "no newer version" and is logged at
DEBUG. ``server.update_check: false`` turns the request off; the desktop app has its own updater and
never asks.
"""

import json
import logging
import os
import re
import threading
import time
import urllib.request

import annzarro

logger = logging.getLogger(__name__)

PYPI_URL = "https://pypi.org/pypi/annzarro/json"
RELEASES_URL = "https://github.com/settylab/annzarro/releases"
UPGRADE_COMMAND = "pip install -U annzarro"
TIMEOUT_S = 3.0
CACHE_S = 6 * 3600          # a good answer
FAILURE_CACHE_S = 15 * 60   # a failed one, so an offline server does not retry on every page load

_lock = threading.Lock()
_cached = None              # (expires_at, latest or None)
_RELEASE = re.compile(r"^\d+(\.\d+)*$")   # a final release; 0.8.0rc1, 0.8.0.dev1 and the like are not


def parse(version):
    """``(0, 7, 3)`` for ``"0.7.3"``; None for anything that is not a final release."""
    if not isinstance(version, str) or not _RELEASE.match(version.strip()):
        return None
    return tuple(int(part) for part in version.strip().split("."))


def is_newer(latest, current):
    """Whether ``latest`` is a final release above ``current`` (trailing zeros do not count)."""
    a, b = parse(latest), parse(current)
    if a is None or b is None:
        return False
    size = max(len(a), len(b))
    return a + (0,) * (size - len(a)) > b + (0,) * (size - len(b))


def in_desktop_app():
    return os.environ.get("ANNZARRO_ELECTRON_APP", "false").strip().lower() in ("true", "1")


def enabled(config):
    value = config.get("update_check", True)
    return value.strip().lower() in ("true", "yes", "1", "on") if isinstance(value, str) else bool(value)


def fetch_latest():
    """The version PyPI lists, or None. A plain GET with the default user agent."""
    try:
        with urllib.request.urlopen(PYPI_URL, timeout=TIMEOUT_S) as reply:
            if getattr(reply, "status", 200) != 200:
                logger.debug("Update check: PyPI answered %s", reply.status)
                return None
            version = json.load(reply)["info"]["version"]
    except Exception as exc:   # offline, timeout, bad JSON, missing key: no notice
        logger.debug("Update check failed: %s", exc)
        return None
    return version if parse(version) is not None else None


def latest_version():
    """The cached answer, asking PyPI when it is older than CACHE_S."""
    global _cached
    with _lock:
        if _cached is not None and _cached[0] > time.monotonic():
            return _cached[1]
        latest = fetch_latest()
        _cached = (time.monotonic() + (CACHE_S if latest else FAILURE_CACHE_S), latest)
        return latest


def reset_cache():
    global _cached
    with _lock:
        _cached = None


def check(config):
    """The reply of the endpoint: ``{enabled, current, latest, update_available, ...}``."""
    current = annzarro.__version__
    if not enabled(config):
        return {"enabled": False, "reason": "disabled", "current": current}
    if in_desktop_app():
        return {"enabled": False, "reason": "desktop", "current": current}
    latest = latest_version()
    newer = bool(latest) and is_newer(latest, current)
    reply = {"enabled": True, "current": current, "latest": latest if newer else None, "update_available": newer}
    if newer:
        reply.update(upgrade_command=UPGRADE_COMMAND, url=f"{RELEASES_URL}/tag/v{latest}")
    return reply
