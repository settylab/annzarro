"""
The key that signs login cookies
--------------------------------

Flask keeps the logged-in username and admin flag in a cookie signed with
``secret_key``. Anyone who knows the key can mint a cookie naming any user,
admins included, so a published key is the same as no login.

The shipped configs used to carry placeholder keys ("change-this-in-production"
and friends), and a deployment that never changed them was wide open. Now:

* an explicitly configured key that is not a known placeholder is used as is;
* otherwise a random key is generated once, stored with mode 0600 next to the
  users file, and reused on every later start -- so logins survive restarts
  and every gunicorn worker sharing that users file signs with the same key;
* a configured placeholder is ignored, with a warning saying so.
"""

import logging
import os
import secrets
import tempfile

logger = logging.getLogger(__name__)

#: Values that have shipped in this repository's configs. Never used as keys.
PLACEHOLDER_SECRET_KEYS = frozenset({
    "change-this-in-production",
    "change-this-to-a-secure-random-value",
    "__CHANGE_THIS_TO_A_RANDOM_STRING__",
})

#: File name of the generated key, stored beside the users file.
SECRET_KEY_FILENAME = "annzarro_secret_key"


def secret_key_path(user_file_path):
    """Where the generated key lives for a given (resolved) users file."""
    return os.path.join(os.path.dirname(os.path.abspath(user_file_path)), SECRET_KEY_FILENAME)


def _read_key(path):
    try:
        with open(path, "r") as f:
            key = f.read().strip()
        return key or None
    except FileNotFoundError:
        return None


def _create_key(path):
    """Write a new key to ``path`` atomically, or return the one already there.

    The key is written to a 0600 temporary file and hard-linked into place, so
    a second process starting at the same moment either wins the link or
    reads the complete key the first one wrote -- never a half-written file.
    """
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    key = secrets.token_hex(32)
    fd, tmp = tempfile.mkstemp(prefix=".annzarro_secret_", dir=directory)
    try:
        # mkstemp creates the file 0600, so the key is never world-readable
        with os.fdopen(fd, "w") as f:
            f.write(key + "\n")
        try:
            os.link(tmp, path)
        except FileExistsError:
            existing = _read_key(path)
            if existing:
                return existing
            raise
        logger.warning(f"Generated a new login secret key at {path} (mode 0600). "
                       f"Keep this file private; deleting it logs everyone out.")
        return key
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def resolve_secret_key(configured, user_file_path):
    """Return the key to sign login cookies with. Never a placeholder.

    Args:
        configured: ``secret_key`` from the configuration, possibly ``None``.
        user_file_path: Resolved path of the users file; the generated key is
            kept in the same directory.
    """
    if configured and configured not in PLACEHOLDER_SECRET_KEYS:
        return configured
    if configured in PLACEHOLDER_SECRET_KEYS:
        logger.warning(
            "SECURITY: the configured secret_key is a shipped placeholder that "
            "anyone can read in the source; it is being IGNORED. Using the "
            "generated key beside the users file instead. Remove secret_key from "
            "your configuration, or set it to a long random value."
        )
    path = secret_key_path(user_file_path)
    try:
        return _read_key(path) or _create_key(path)
    except OSError as e:
        logger.warning(
            f"SECURITY: could not read or store a secret key at {path} ({e}). "
            "Using a random in-memory key: logins end at every restart and do "
            "not work across multiple worker processes. Make that directory "
            "writable or set auth.secret_key."
        )
        return secrets.token_hex(32)
