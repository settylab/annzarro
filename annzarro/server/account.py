"""
The signed-in user's own account: change your password
------------------------------------------------------

``GET /account/password`` is the page, ``POST /api/v1/account/password
{current, new}`` the change. It needs the current password, so a stolen
cookie alone cannot lock the owner out. A wrong current password counts
toward the same per-(user, address) lockout as the login page, which is
also the rate limit: five wrong guesses and the address is refused for
``lockout_time`` seconds (423 ``locked``). The change ends the user's other
logins (``password_changed_at``); this one stays.

The change is protected like the admin API (``guard._csrf_ok``): the
session's token in ``X-AnnZarro-CSRF``, a JSON body, and the Origin checks.
"""

import logging
import time

from flask import current_app, jsonify, render_template, request, session

from . import access, permissions
from .admin import audit
from .admin.guard import _csrf_ok, _harden, csrf_token, with_csp
from .admin.users import weak_password_reason
from .auth import UnsupportedPasswordHash

logger = logging.getLogger(__name__)


def _error(status, reason, message):
    return _harden(jsonify(error=message, reason=reason)), status


def register_account_routes(app):
    """Register the account routes. Called with login on, before the wrapper
    that puts ``require_auth`` on every route."""

    @app.route("/account/password", methods=["GET"])
    @access.gate("public")
    def account_password_page():
        """The change-password form."""
        csrf_token()
        username, _ = permissions.current_user()
        return _harden(with_csp(app.make_response(render_template(
            "account.html", app_name=app.config.get("app_name", "AnnZarro"), username=username))))

    @app.route("/api/v1/account/password", methods=["POST"])
    @access.gate("public")
    def account_password_change():
        """Change the signed-in user's password; needs the current one."""
        username, _ = permissions.current_user()
        if not username:
            return _error(401, "login_required", "Authentication required")
        if not _csrf_ok():
            logger.warning("Refused password change of %r from %s: CSRF check failed", username,
                           request.remote_addr)
            return _error(403, "csrf_failed", "The page is out of date. Reload it and try again.")
        if request.mimetype != "application/json":
            return _error(415, "json_required", "Send the request as application/json.")
        body = request.get_json(silent=True)
        body = body if isinstance(body, dict) else {}
        current, new = body.get("current"), body.get("new")
        if not isinstance(current, str) or not current or not isinstance(new, str):
            return _error(400, "bad_request", "Give your current password and a new one.")
        manager = app.auth_manager
        address = request.remote_addr
        if manager.lock_remaining(username, address):
            return _error(423, "locked", "Too many wrong passwords. Try again later.")
        try:
            ok = manager.authenticate(username, current, client_ip=address, touch_last_login=False)
        except UnsupportedPasswordHash as exc:
            logger.error("Password change of %r impossible on this Python: %s", username, exc)
            return _error(500, "password_unsupported", "This server cannot check passwords on its current "
                          "Python installation (the server log says why).")
        if not ok:
            logger.warning("Wrong current password in a password change of %r from %s", username, address)
            if manager.lock_remaining(username, address):
                return _error(423, "locked", "Too many wrong passwords. Try again later.")
            return _error(403, "bad_password", "That is not your current password.")
        problem = weak_password_reason(new, username)
        if problem:
            return _error(400, "weak_password", problem)
        if new == current:
            return _error(400, "same_password", "Pick a password different from the current one.")
        if not manager.set_password(username, new):
            return _error(401, "login_required", "Authentication required")
        session["login_at"] = time.time()    # this login survives; the user's others end
        audit.record("account.password", username, None)
        return _harden(jsonify(changed=True))
