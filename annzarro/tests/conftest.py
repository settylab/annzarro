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


_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _test_this_checkout():
    """Servers and CLIs the tests spawn import this checkout's annzarro, not an installed copy.

    A child process started from another directory (most tests use a temporary one) imports
    whichever annzarro the Python environment has installed: from a worktree that is another
    tree, and the suite passes or fails on code it is not testing. The checkout goes first on
    PYTHONPATH, which every child inherits (tests/utils/test_checkout_is_tested.py checks it).
    """
    old = os.environ.get("PYTHONPATH", "")
    if _REPO not in old.split(os.pathsep):
        os.environ["PYTHONPATH"] = _REPO + (os.pathsep + old if old else "")


def _servers_end_with_this_run():
    """Servers the tests spawn exit once this process is gone (ANNZARRO_EXIT_WITH_PARENT).

    A killed pytest (or xdist worker) runs no fixture teardown; without this its servers
    stay behind, each with its listening port and open connections. Every xdist worker
    names itself, so its own servers end with it.
    """
    os.environ["ANNZARRO_EXIT_WITH_PARENT"] = str(os.getpid())


def _end_leftover_children():
    """Terminate, wait, then kill the processes a fixture left running (a failed setup, a
    fixture without a finally)."""
    try:
        import psutil
        children = psutil.Process().children(recursive=True)
    except Exception:
        return
    for child in children:
        try:
            child.terminate()
        except psutil.Error:
            pass
    _, alive = psutil.wait_procs(children, timeout=5)
    for child in alive:
        try:
            child.kill()
        except psutil.Error:
            pass


def pytest_sessionfinish(session, exitstatus):
    _end_leftover_children()


def pytest_configure(config):
    _test_this_checkout()
    _servers_end_with_this_run()
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


def pytest_addoption(parser):
    parser.addoption("--shard", metavar="I/N", default=None,
                     help="run only shard I of N of the collected test files (annzarro/tests/shards.py)")


def _shard_file(config, item):
    return os.path.relpath(str(item.path), str(config.rootpath)).replace(os.sep, "/")


def pytest_collection_modifyitems(config, items):
    if not config.getoption("--shard"):
        return
    from annzarro.tests.shards import load_durations, parse_shard, split
    i, n = parse_shard(config.getoption("--shard"))
    mine = set(split({_shard_file(config, it) for it in items}, n, load_durations())[i - 1])
    keep = [it for it in items if _shard_file(config, it) in mine]
    dropped = [it for it in items if _shard_file(config, it) not in mine]
    if dropped:
        config.hook.pytest_deselected(items=dropped)
    items[:] = keep
    config._annzarro_shard = f"shard {i}/{n}: {len(mine)} files, {len(keep)} tests"


def pytest_report_collectionfinish(config):
    return getattr(config, "_annzarro_shard", None)


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


@pytest.fixture(autouse=True)
def _forget_loaded_state_dir(monkeypatch, tmp_path_factory):
    """Loading configuration fixes the state directory for the process (paths.set_state_dir);
    a later test that sets ANNZARRO_HOME must see it take effect, not an earlier test's value.
    Each test also gets its own state directory: panel sets are kept there (server/panel_sets.py),
    and one test's must not be another's."""
    from annzarro.utils import paths
    monkeypatch.setenv("ANNZARRO_HOME", str(tmp_path_factory.mktemp("annzarro_home")))
    paths.set_state_dir(None)
    yield
    paths.set_state_dir(None)


@pytest.fixture(autouse=True)
def _no_background_crawl(monkeypatch):
    """An app built without TESTING starts the description index keeper (text_index.start_keeper); in a
    test its first round would land in the middle of whatever the test checks. Push it out of reach: a
    test of the keeper starts one with its own timings."""
    from annzarro.server import text_index
    monkeypatch.setattr(text_index, "KEEPER_FIRST_S", 24 * 3600.0)


@pytest.fixture(autouse=True)
def _restore_remote_policy():
    """Every app a test builds sets the process-wide remote store policy (server/core.py); put
    it back, or a later test in the same process (an xdist worker runs any mix of files) reads
    remote stores under whatever app came before it: an auth-enabled one denies them."""
    from annzarro.core import remote
    saved = remote.get_remote_policy()
    yield
    remote._policy = saved


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
    (tests/server/test_app_csrf.py) use a plain ``FlaskClient``.

    To send NO token from this client, pass the header yourself, even empty
    (``headers={"X-AnnZarro-CSRF": ""}``): a request that names the header is left as it is. A test
    that claims "no token is refused" without that, or a plain client, tests nothing: the client
    adds one. A spawned process builds its app with ``admin_helpers.make_app``, which installs this
    client too."""

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
