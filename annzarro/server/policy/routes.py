"""The policy over HTTP, and the decorator that enforces it on a route.

``GET /api/v1/policy/effective`` answers with the values the requester gets
(the client never resolves anything itself), and every API reply carries
``X-AnnZarro-Policy``, the version, so an open tab notices a change on its
next request.
"""
import logging
from functools import wraps
from typing import List, Optional

from flask import current_app, jsonify, request

from .registry import REGISTRY, Registry, load_declarations
from .resolver import PolicyEngine

logger = logging.getLogger(__name__)

POLICY_HEADER = "X-AnnZarro-Policy"
EXTENSION = "annzarro_policy"
REQUIRES_ATTR = "_annzarro_requires"


def engine(app=None) -> PolicyEngine:
    """The policy engine of ``app`` (default: the current app)."""
    return (app or current_app).extensions[EXTENSION]


def requester() -> Optional[str]:
    """The user whose policy applies; None when login is off."""
    from .. import permissions
    return permissions.current_user()[0]


def requires(*names: str):
    """Gate a route on policy keys: 403 ``{reason: "disabled_by_policy", key}``
    when the requester's value of any of them is "off" (``False`` for an
    enabled switch, the ``off`` ids of an enum). Put it under ``@app.route``.
    ``check_routes`` holds it to the keys' ``routes`` declarations."""
    def decorate(view):
        @wraps(view)
        def gated(*args, **kwargs):
            eng = engine()
            resolved = eng.resolve_all(requester(), names)
            for name in names:
                key = eng.registry.keys[name]
                if resolved[name].value in key.type.off:
                    return jsonify({"error": f"{name} is turned off by the administrator",
                                    "reason": "disabled_by_policy", "key": name}), 403
            return view(*args, **kwargs)
        gated.__dict__[REQUIRES_ATTR] = tuple(getattr(view, REQUIRES_ATTR, ())) + names
        return gated
    return decorate


def check_routes(app, registry: Optional[Registry] = None) -> List[str]:
    """Problems between the keys' ``routes`` and the routes' ``requires``,
    both directions; empty when consistent."""
    registry = registry or engine(app).registry
    problems = []
    for key in registry:
        for endpoint in key.routes:
            view = app.view_functions.get(endpoint)
            if view is None:
                problems.append(f"{key.name} lists the route {endpoint!r}, which does not exist")
            elif key.name not in getattr(view, REQUIRES_ATTR, ()):
                problems.append(f"{key.name} lists the route {endpoint!r}, which does not carry requires({key.name!r})")
    for endpoint, view in app.view_functions.items():
        for name in getattr(view, REQUIRES_ATTR, ()):
            key = registry.get(name)
            if key is None:
                problems.append(f"{endpoint} requires {name!r}, which is not declared")
            elif endpoint not in key.routes:
                problems.append(f"{endpoint} requires {name!r}, which does not list it in routes")
    return problems


def install(app, api_version: str = "v1", registry: Optional[Registry] = None) -> PolicyEngine:
    """Create the app's engine, its ``/policy/effective`` route and the version header."""
    if registry is None:
        load_declarations()
    eng = PolicyEngine(app.config, registry or REGISTRY)
    app.extensions[EXTENSION] = eng

    @app.route(f"/api/{api_version}/policy/effective", methods=["GET"])
    def policy_effective():
        """The policy as the requester gets it: ``{version, values}`` for the keys
        that are ``client`` keys. ``?keys=a,b`` limits it to those (names that are
        not client keys are left out)."""
        wanted = [k for k in request.args.get("keys", "").split(",") if k.strip()]
        values = eng.effective(requester(), [k.strip() for k in wanted] or None, client_only=True)
        response = jsonify({"version": eng.version(), "values": values})
        response.headers["Cache-Control"] = "no-store"
        response.headers["Vary"] = "Cookie"
        return response

    @app.after_request
    def _policy_version(response):
        if request.path.startswith("/api/") and POLICY_HEADER not in response.headers:
            from .. import permissions
            from ..core import is_logged_in
            if not permissions.auth_enabled() or is_logged_in():
                response.headers[POLICY_HEADER] = eng.version()
        return response

    return eng
