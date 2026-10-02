"""Unit tests for remote dataset dispatch and the remote-store access policy.

No network: every test here either refuses before a request is made or stubs
the opener. The HTTP round trip is covered by
``annzarro/tests/integration/test_remote_http_store.py``.
"""

import pytest

import annzarro.core as core
from annzarro.core import remote
from annzarro.core.remote import (
    RemoteAccessDenied,
    RemoteDependencyError,
    RemotePolicy,
    is_remote_path,
    remote_scheme,
)

LOCAL = {"host": "127.0.0.1", "auth_enabled": False, "proxy_count": 0}


@pytest.fixture(autouse=True)
def _restore_policy():
    saved = remote.get_remote_policy()
    yield
    remote._policy = saved


# --------------------------------------------------------------------------
# path classification
# --------------------------------------------------------------------------

@pytest.mark.parametrize("path,scheme", [
    ("s3://bucket/data/pbmc.zarr", "s3"),
    ("S3://bucket/pbmc.zarr", "s3"),
    ("gs://bucket/pbmc.zarr", "gs"),
    ("gcs://bucket/pbmc.zarr", "gcs"),
    ("http://host/pbmc.zarr", "http"),
    ("https://host:8443/a/b/pbmc.zarr/", "https"),
    ("/data/pbmc.zarr", None),
    ("data/pbmc.zarr", None),
    ("C:\\data\\pbmc.zarr", None),
    ("file:///data/pbmc.zarr", None),
    ("ftp://host/pbmc.zarr", None),
    (None, None),
])
def test_remote_scheme(path, scheme):
    assert remote_scheme(path) == scheme
    assert is_remote_path(path) == (scheme is not None)


# --------------------------------------------------------------------------
# get_reader dispatch
# --------------------------------------------------------------------------

@pytest.fixture
def opened(monkeypatch):
    """Record remote opens instead of making them."""
    calls = []
    monkeypatch.setattr(core.zarr_reader, "_get_remote_root",
                        lambda url: calls.append(url) or object())
    return calls


@pytest.mark.parametrize("url", [
    "s3://bucket/pbmc.zarr",
    "gs://bucket/pbmc.zarr",
    "http://127.0.0.1:9/pbmc.zarr",
    "https://data.example.org/atlas/pbmc.zarr/",
    # a bucket prefix with no .zarr suffix is still a valid store root
    "s3://bucket/some/prefix",
])
def test_get_reader_sends_remote_urls_to_zarr_without_local_check(url, opened):
    assert core.get_reader(url) is core.zarr_reader
    assert opened == [url]


@pytest.mark.parametrize("url", [
    "s3://bucket/pbmc.h5ad",
    "https://data.example.org/pbmc.H5AD",
    "http://host/pbmc.h5ad/",
])
def test_get_reader_refuses_remote_h5ad(url, opened):
    with pytest.raises(ValueError, match="Remote .h5ad files are not supported"):
        core.get_reader(url)
    assert opened == []


def test_get_reader_local_paths_unchanged(tmp_path):
    with pytest.raises(FileNotFoundError):
        core.get_reader(str(tmp_path / "missing.zarr"))
    store = tmp_path / "ok.zarr"
    store.mkdir()
    assert core.get_reader(str(store)) is core.zarr_reader
    h5 = tmp_path / "ok.h5ad"
    h5.write_bytes(b"")
    assert core.get_reader(str(h5)) is core.h5ad_reader_obj


def test_get_reader_enforces_policy_before_any_request(monkeypatch):
    remote.configure_remote_policy({"host": "0.0.0.0"}, environ={})

    def boom(*a, **k):  # pragma: no cover - must not be reached
        raise AssertionError("a refused URL must not be opened")

    monkeypatch.setattr(remote.zarr, "open_group", boom)
    monkeypatch.setattr(remote.zarr, "open_consolidated", boom, raising=False)
    with pytest.raises(RemoteAccessDenied):
        core.get_reader("https://169.254.169.254/latest/meta-data.zarr")


# --------------------------------------------------------------------------
# policy resolution
# --------------------------------------------------------------------------

def _policy(environ=None, **config):
    return RemotePolicy.from_config(config, environ=environ or {})


def test_auto_allows_local_single_user_server():
    p = _policy(**LOCAL)
    assert p.enabled and not p.restricted
    p.check("https://anywhere.example.org/x.zarr")
    p.check("http://localhost:8080/x.zarr")


@pytest.mark.parametrize("override", [
    {"auth_enabled": True},
    {"host": "0.0.0.0"},
    {"host": "lab-server.internal"},
    {"proxy_count": 1},
])
def test_auto_disables_remote_on_hosted_server(override):
    p = _policy(**{**LOCAL, **override})
    assert not p.enabled
    with pytest.raises(RemoteAccessDenied, match="disabled"):
        p.check("s3://bucket/x.zarr")


def test_auto_hosted_with_allowlist_allows_only_the_allowlist():
    p = _policy(**{**LOCAL, "auth_enabled": True,
                   "remote_allowlist": ["s3://lab-bucket/atlases/", "https://Data.Example.org"]})
    assert p.enabled and p.restricted
    p.check("s3://lab-bucket/atlases/pbmc.zarr")
    p.check("s3://lab-bucket/atlases")
    p.check("https://data.example.org/any/where.zarr")
    for url in [
        "s3://lab-bucket/other/pbmc.zarr",          # outside the prefix
        "s3://lab-bucket/atlases-private/x.zarr",   # prefix but not a path boundary
        "s3://lab-bucket-evil/atlases/x.zarr",      # bucket name prefix
        "https://data.example.org.evil.com/x.zarr", # host name prefix
        "http://data.example.org/x.zarr",           # scheme downgrade
        "https://data.example.org:8443/x.zarr",     # different port
        "gs://lab-bucket/atlases/x.zarr",           # different scheme
    ]:
        with pytest.raises(RemoteAccessDenied):
            p.check(url)


def test_allowlist_cannot_be_escaped_with_dot_segments():
    p = _policy(**LOCAL, remote_allowlist="https://data.example.org/public/")
    with pytest.raises(ValueError, match=r"'\.\.'"):
        p.check("https://data.example.org/public/../private/x.zarr")


def test_explicit_allow_and_deny():
    assert _policy(**{**LOCAL, "auth_enabled": True}, remote_stores="allow").enabled
    assert not _policy(**LOCAL, remote_stores="deny").enabled
    assert not _policy(**LOCAL, remote_stores=False).enabled
    # deny wins over an allowlist
    p = _policy(**LOCAL, remote_stores="deny", remote_allowlist=["s3://b/"])
    with pytest.raises(RemoteAccessDenied):
        p.check("s3://b/x.zarr")


def test_environment_overrides_config():
    env = {"ANNZARRO_REMOTE_STORES": "deny"}
    assert not _policy(env, **LOCAL, remote_stores="allow").enabled
    env = {"ANNZARRO_REMOTE_ALLOWLIST": "s3://a/, https://b.org/x/"}
    p = _policy(env, **{**LOCAL, "auth_enabled": True})
    assert p.enabled
    p.check("https://b.org/x/y.zarr")
    env = {"ANNZARRO_REMOTE_CREDENTIALS": "environment"}
    assert _policy(env, **LOCAL).credentials == "environment"


@pytest.mark.parametrize("config", [
    {"remote_stores": "maybe"},
    {"remote_credentials": "root"},
    {"remote_allowlist": ["/local/path"]},
    {"remote_allowlist": ["https://user:pw@host/"]},
])
def test_invalid_config_is_rejected(config):
    with pytest.raises(ValueError):
        _policy(**LOCAL, **config)


@pytest.mark.parametrize("url,match", [
    ("https://user:secret@host/x.zarr", "credentials"),
    ("https://host/x.zarr?X-Amz-Signature=abc", "query string"),
    ("https://host/x.zarr#frag", "query string"),
    ("s3:///x.zarr", "no host"),
])
def test_url_shapes_that_would_leak_or_mislead_are_refused(url, match):
    with pytest.raises(ValueError, match=match):
        _policy(**LOCAL).check(url)


def test_refusal_message_does_not_echo_credentials():
    with pytest.raises(ValueError) as info:
        _policy(**LOCAL).check("https://user:hunter2@host/x.zarr")
    assert "hunter2" not in str(info.value)


# --------------------------------------------------------------------------
# credentials -> storage options
# --------------------------------------------------------------------------

def test_storage_options_default_to_anonymous():
    p = _policy(**LOCAL)
    assert p.storage_options("s3://b/x.zarr") == {"anon": True}
    assert p.storage_options("gs://b/x.zarr") == {"token": "anon"}
    # plain HTTP has no credentials; only the 403-as-missing hook is set
    assert p.storage_options("https://h/x.zarr") == {
        "client_kwargs": {"raise_for_status": remote._http_status}}


def test_storage_options_environment_uses_backend_credential_chain():
    p = _policy(**LOCAL, remote_credentials="environment")
    # no explicit keys: s3fs/gcsfs fall back to env vars, profiles, roles
    assert p.storage_options("s3://b/x.zarr") == {}
    assert p.storage_options("gs://b/x.zarr") == {}


def test_allowlisted_http_does_not_follow_redirects():
    p = _policy(**LOCAL, remote_allowlist=["https://h/"])
    opts = p.storage_options("https://h/x.zarr")
    assert opts["allow_redirects"] is False
    assert opts["client_kwargs"]["raise_for_status"] is remote._http_status_restricted


def test_http_403_reads_as_a_missing_key_and_redirects_as_refusal():
    import asyncio

    class Resp:
        def __init__(self, status):
            self.status, self.url = status, "https://h/x.zarr/.zattrs"

    run = asyncio.run
    assert run(remote._http_status(Resp(200))) is None
    assert run(remote._http_status(Resp(302))) is None
    with pytest.raises(FileNotFoundError):
        run(remote._http_status(Resp(403)))
    with pytest.raises(RemoteAccessDenied, match="redirect"):
        run(remote._http_status_restricted(Resp(302)))
    with pytest.raises(FileNotFoundError):
        run(remote._http_status_restricted(Resp(403)))


def test_policy_description_contains_no_secrets(monkeypatch):
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "s3cr3t-value")
    p = _policy(**LOCAL, remote_credentials="environment")
    assert "s3cr3t-value" not in p.describe()


# --------------------------------------------------------------------------
# missing optional dependencies
# --------------------------------------------------------------------------

def test_missing_backend_names_the_extra(monkeypatch):
    import builtins
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "s3fs":
            raise ImportError("No module named 's3fs'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    with pytest.raises(RemoteDependencyError, match=r"annzarro\[remote\]") as info:
        remote.open_remote_group("s3://bucket/x.zarr", policy=_policy(**LOCAL))
    assert isinstance(info.value, ImportError)
    assert "s3fs" in str(info.value)
