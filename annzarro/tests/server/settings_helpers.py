"""An admin app whose policy registry has keys to write.

The real registry declares no writable key until the panel keys land, so the
settings tests swap in a small registry of their own: one engine per app, wired
to the real overlay and per-user stores (``wire_sources``). Run as a script it
serves such an app, for the browser test::

    python settings_helpers.py <state dir> <port>
"""
import os
import sys

from annzarro.server.policy import Bool, Enum, Hosts, Int, Key, PolicyEngine, Registry
from annzarro.server.policy.routes import EXTENSION
from annzarro.tests.server.admin_helpers import make_app

MODES = [{"id": "ask", "label": "Ask"}, {"id": "off", "label": "Off"}, {"id": "none", "label": "None"}]
WRITABLE = [f"t.w{n:02d}" for n in range(16)]


def sample_registry():
    registry = Registry()

    def add(name, type_, default, scope, combine="override", area="features", **kw):
        registry.declare(Key(name=name, type=type_, default=default, scope=scope, combine=combine, area=area,
                             description=f"the {name} setting", config_path=name, **kw))

    add("t.limit", Int(min=1, max=10), 5, "server")
    add("t.hosts", Hosts(), ["a.example.org"], "server", area="outbound")
    add("t.switch", Bool(), True, "server", "restrict", area="panels")
    add("t.mode", Enum(MODES, off=["off", "none"]), "ask", "server", "restrict", area="outbound")
    add("t.user_switch", Bool(), True, "user", "restrict", area="panels")
    add("t.user_num", Int(min=1, max=10), 5, "user")
    add("t.fixed", Int(min=1), 7, "config", area="limits")
    for name in WRITABLE:
        add(name, Int(min=0, max=1000), 0, "server")
    return registry


def sample_app(tmp_path, **config):
    """An app with login on (admin ``root``, user ``alice``) and the sample registry."""
    app = make_app(tmp_path, **config)
    from annzarro.server.admin.settings import wire_sources
    app.extensions[EXTENSION] = PolicyEngine(app.config, sample_registry())
    wire_sources(app)
    return app


if __name__ == "__main__":
    from pathlib import Path
    app = sample_app(Path(sys.argv[1]), t={"fixed": 9, "switch": False}, policy={"locked": ["t.mode"]})
    from werkzeug.serving import run_simple
    run_simple("127.0.0.1", int(sys.argv[2]), app, threaded=True)
