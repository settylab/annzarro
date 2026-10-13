"""Suite-wide fixtures.

``ANNZARRO_TEST_ZARR_FORMAT=3`` (or ``3-sharded``) runs the suites on zarr format 3: for the length of
the session the committed ``data/fixture_small.zarr`` is replaced by a converted copy, and
``zarr_compat`` builds its stores in format 3. Unset, nothing here does anything.
"""
import atexit
import os
import re
import shutil
import tempfile

import pytest
from flask import Flask
from flask.testing import FlaskClient

_DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_FIXTURE = os.path.join(_DATA, "fixture_small.zarr")
_ASIDE = os.path.join(_DATA, ".fixture_small.zarr.format2")
_MARK = os.path.join(_DATA, ".fixture_swap.pid")


def _restore_fixture():
    """Put the committed format 2 fixture back (also after a run that was killed half way)."""
    if os.path.isdir(_ASIDE):
        shutil.rmtree(_FIXTURE, ignore_errors=True)
        os.rename(_ASIDE, _FIXTURE)
    if os.path.exists(_MARK):
        os.remove(_MARK)


_swapped_here = False


def _swapped_by_another_run():
    """The pid of a live run that has the fixture swapped, else None."""
    try:
        with open(_MARK) as fh:
            pid = int(fh.read())
        os.kill(pid, 0)
    except (OSError, ValueError):
        return None
    return pid if pid != os.getpid() else None


def pytest_configure(config):
    if hasattr(config, "workerinput"):      # an xdist worker: the controller swaps
        return
    other = _swapped_by_another_run()
    if other:
        pytest.exit(f"pid {other} is running the suites on a format 3 fixture in this checkout "
                    f"(ANNZARRO_TEST_ZARR_FORMAT); wait for it, or use another worktree", returncode=3)
    _restore_fixture()
    from annzarro.tests.zarr_compat import NEW_FORMAT, SHARDED
    if NEW_FORMAT != 3:
        return
    from annzarro.tests.utils.make_fixture_zarr_v3 import convert
    work = tempfile.mkdtemp(prefix="annzarro-fixture-v3-")
    try:
        kw = dict(target=400, shard_factor=2, pair_shard_factor=4, min_shard_bytes=0) if SHARDED else {}
        converted = convert(_FIXTURE, os.path.join(work, "fixture_small.zarr"), sharded=SHARDED, **kw)
        with open(_MARK, "w") as fh:
            fh.write(str(os.getpid()))
        os.rename(_FIXTURE, _ASIDE)
        shutil.move(converted, _FIXTURE)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    global _swapped_here
    _swapped_here = True
    atexit.register(_restore_fixture)


def pytest_unconfigure(config):
    if _swapped_here:
        _restore_fixture()


@pytest.fixture(autouse=True, scope="session")
def _private_state_dir(tmp_path_factory):
    """Keep logs, PID files and generated secrets out of the real ~/.annzarro.

    Any test that builds an app writes its log to the state directory
    (``annzarro.utils.paths.user_state_dir``); point it at a throwaway one.
    """
    mp = pytest.MonkeyPatch()
    mp.setenv("ANNZARRO_HOME", str(tmp_path_factory.mktemp("annzarro_home")))
    yield
    mp.undo()


def _allow_create_array_data():
    """zarr 3.0 has no ``data=`` on Group.create_array (3.1 added it); many fixtures here use it."""
    try:
        import zarr
        import numpy as np
        if int(zarr.__version__.split(".")[0]) < 3 or "data" in zarr.Group.create_array.__code__.co_varnames:
            return
    except Exception:
        return
    original = zarr.Group.create_array

    def create_array(self, name, *args, data=None, **kwargs):
        if data is None:
            return original(self, name, *args, **kwargs)
        data = np.asarray(data)
        kwargs.setdefault("shape", data.shape)
        kwargs.setdefault("dtype", data.dtype)
        array = original(self, name, *args, **kwargs)
        if data.ndim:
            array[...] = data
        else:
            array[()] = data
        return array

    zarr.Group.create_array = create_array


_allow_create_array_data()


class _BrowsesLikeAPage(FlaskClient):
    """A test client that does what the page does (server/csrf.py): opens the sign-in page
    before it posts to it, so the form's token and cookie come along, and sends the signed-in
    user's token (static/js/utils/csrf.js) with a request that changes state. It leaves the
    admin API alone, whose tests send or withhold the token themselves. Tests about the token
    (tests/server/test_app_csrf.py) use a plain ``FlaskClient``."""

    def open(self, *args, **kwargs):
        method = (kwargs.get("method") or "GET").upper()
        data = kwargs.get("data")
        path = (args[0] if args and isinstance(args[0], str) else kwargs.get("path", "")).split("?")[0]
        if (method == "POST" and isinstance(data, dict) and "login_csrf" not in data
                and path.endswith("/login")):
            same_request = {k: kwargs[k] for k in ("headers", "base_url", "environ_base", "environ_overrides")
                            if k in kwargs}      # the page is opened as the form will be posted
            page = self.get(path, **same_request).get_data(as_text=True)
            found = re.search(r'name="login_csrf" value="([^"]*)"', page)
            if found:
                kwargs["data"] = dict(data, login_csrf=found.group(1))
        elif (method not in ("GET", "HEAD", "OPTIONS") and "/api/v1/admin/" not in path
                and "X-AnnZarro-CSRF" not in dict(kwargs.get("headers") or {})):
            try:
                with self.session_transaction(path) as sess:
                    if sess.get("user_id") and not sess.get("csrf"):
                        sess["csrf"] = "test-token"
                    token = sess.get("csrf")
            except RuntimeError:          # login off: no secret key, no session, no token
                token = None
            if token:
                kwargs["headers"] = {**dict(kwargs.get("headers") or {}), "X-AnnZarro-CSRF": token}
        return super().open(*args, **kwargs)


@pytest.fixture(autouse=True)
def _browser_like_test_client(monkeypatch):
    monkeypatch.setattr(Flask, "test_client_class", _BrowsesLikeAPage)
