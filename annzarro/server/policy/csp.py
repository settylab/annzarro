"""The Content-Security-Policy of the HTML documents: the real control for
outbound requests.

Every host the browser may contact comes from a key's ``outbound_hosts`` at the
value the requester resolves, so the policy, the CSP and the client agree. Only
``connect-src`` is set: it covers ``fetch``, XHR, ``sendBeacon``, ``EventSource``
and WebSocket, and a fuller policy would break Plotly's regl (``new Function``)
and ``index.html``'s inline scripts. The browser then refuses a host the
administrator turned off even from a modified client or a script in the console.

``data:`` and ``blob:`` stay allowed: plot export fetches them.
"""
import logging
from typing import List, Optional

from flask import Response

from .resolver import PolicyEngine

logger = logging.getLogger(__name__)

#: what a document may always connect to
BASE_SOURCES = ("'self'", "data:", "blob:")


def csp_hosts(engine: PolicyEngine, user: Optional[str] = None) -> List[str]:
    """The external hosts ``user`` may contact, sorted: the ``outbound_hosts`` of
    every key at its effective value, except keys whose ``gated_by`` key is off."""
    resolved = engine.resolve_all(user)
    hosts = set()
    for key in engine.registry.with_outbound_hosts():
        if any(resolved[g].value in engine.registry.keys[g].type.off for g in key.gated_by):
            continue
        hosts.update(h.lower() for h in key.outbound_hosts(resolved[key.name].value, engine.config))
    return sorted(hosts)


def connect_src(engine: Optional[PolicyEngine], user: Optional[str] = None) -> str:
    """The ``connect-src`` directive for a requester; with no way to tell (no
    engine, or a failure), the one that allows no external host."""
    hosts: List[str] = []
    if engine is not None:
        try:
            hosts = csp_hosts(engine, user)
        except Exception:
            logger.exception("Could not compute the Content-Security-Policy hosts; allowing none")
    return " ".join(("connect-src",) + BASE_SOURCES + tuple(f"https://{h}" for h in hosts))


def apply(response: Response, engine: Optional[PolicyEngine], user: Optional[str] = None,
          external: bool = True) -> Response:
    """Put the CSP on an HTML document's response. ``external`` False (the login
    page) allows no external host whatever the policy says. The policy decides
    per requester, so the document is never cached or shared."""
    response.headers["Content-Security-Policy"] = connect_src(engine if external else None, user)
    response.headers["Cache-Control"] = "no-store"
    vary = response.headers.get("Vary")
    if "cookie" not in (vary or "").lower():
        response.headers["Vary"] = f"{vary}, Cookie" if vary else "Cookie"
    return response
