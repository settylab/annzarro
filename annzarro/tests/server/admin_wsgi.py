"""A WSGI app for the multi-worker tests: the hosted app plus a route that shows the overlay."""
import os

from flask import jsonify

from annzarro.server import access
from annzarro.server.admin import overlay
from annzarro.server.wsgi import create_wsgi_app as _create


def create_wsgi_app():
    app = _create()

    @app.route("/_test/overlay")
    @access.gate("public")   # a route with no declared gate is refused (access.py)
    def _overlay():
        return jsonify(pid=os.getpid(), active=overlay.active_data_roots(app.config))

    return app
