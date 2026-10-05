"""Cross-origin isolation (``server.cross_origin_isolation``).

With ``Cross-Origin-Opener-Policy: same-origin`` and
``Cross-Origin-Embedder-Policy: require-corp`` on its responses, a page is
cross-origin isolated, and Chromium lets it measure its own memory
(``performance.measureUserAgentSpecificMemory``). The browser memory guard
(static/js/utils/memory-guard.js) then works from measured numbers instead
of estimates alone.

AnnZarro serves every script, style and font itself, opens no pop-ups and
logs in by redirect, so the headers do not break it when it is the page.
Inside a frame of another site they do: an isolated document can only be
framed by an isolated parent that allows it. Hence three settings:

- ``off`` (default): no headers.
- ``on``: always.
- ``auto``: except for documents the browser says it is loading into a
  frame (``Sec-Fetch-Dest: iframe``, ``frame``, ``embed`` or ``object``).
"""
from flask import request

FRAME_DESTINATIONS = {"iframe", "frame", "embed", "object"}


def isolation_mode(config):
    """``off``, ``on`` or ``auto`` from the setting (YAML may give a boolean)."""
    setting = config.get("cross_origin_isolation", "off")
    if setting is True:
        return "on"
    if setting is False or setting is None:
        return "off"
    value = str(setting).strip().lower()
    if value in ("on", "true", "yes", "1"):
        return "on"
    if value == "auto":
        return "auto"
    return "off"


def install_isolation(app):
    """Add the COOP/COEP headers to every response, per the setting."""
    mode = isolation_mode(app.config)
    if mode == "off":
        return

    @app.after_request
    def _isolate(response):
        if mode == "auto" and (request.headers.get("Sec-Fetch-Dest") or "").lower() in FRAME_DESTINATIONS:
            return response
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        response.headers.setdefault("Cross-Origin-Embedder-Policy", "require-corp")
        # same-origin subresources need no CORP header; this one lets them be
        # used by an isolated document of this origin explicitly
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        return response
