"""
Remote zarr stores: which URLs count as remote, who may open them, and how.

A dataset path is either a local filesystem path or a URL with one of the
schemes in ``REMOTE_SCHEMES``. Remote paths are only ever read through zarr
(h5ad is read with h5py from local disk), and every remote open goes through
``open_remote_group`` so the access policy is enforced in exactly one place.

Why there is a policy at all: a remote dataset path makes the SERVER issue
outbound requests to a URL the CLIENT chose. On a single-user desktop that is
the user fetching their own data. On a hosted instance it is server-side
request forgery: any visitor can point the server at cloud metadata endpoints
(``http://169.254.169.254/``), services on its private network, or buckets the
server's own credentials can read. So the default depends on where the server
runs (see ``RemotePolicy.from_config``).
"""

import os
import logging
from collections import OrderedDict
import urllib.parse
from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional, Tuple

import zarr

logger = logging.getLogger(__name__)

_ZARR_V3 = int(zarr.__version__.split(".")[0]) >= 3

# scheme -> the fsspec implementation package that serves it
REMOTE_SCHEMES = {
    "s3": "s3fs",
    "gs": "gcsfs",
    "gcs": "gcsfs",
    "http": "aiohttp",
    "https": "aiohttp",
}

INSTALL_HINT = "pip install 'annzarro[remote]'"

# Hosts a server bound only to the loopback interface listens on. Anything
# else (0.0.0.0, a LAN address, a hostname) is reachable by other machines.
_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", "[::1]"}

_MODES = ("auto", "allow", "deny")
_CREDENTIALS = ("anonymous", "environment")

ENV_MODE = "ANNZARRO_REMOTE_STORES"
ENV_ALLOWLIST = "ANNZARRO_REMOTE_ALLOWLIST"
ENV_CREDENTIALS = "ANNZARRO_REMOTE_CREDENTIALS"
ENV_CONNECT_TIMEOUT = "ANNZARRO_REMOTE_CONNECT_TIMEOUT"
ENV_READ_TIMEOUT = "ANNZARRO_REMOTE_READ_TIMEOUT"
ENV_CHUNK_CACHE = "ANNZARRO_REMOTE_CHUNK_CACHE_MB"

DEFAULT_CONNECT_TIMEOUT_S = 10.0
DEFAULT_READ_TIMEOUT_S = 30.0
DEFAULT_CHUNK_CACHE_MB = 256


class RemoteAccessDenied(PermissionError):
    """The server's remote-store policy forbids opening this URL."""


class RemoteDependencyError(ImportError):
    """The optional packages needed to read this URL scheme are not installed."""


class RemoteTimeout(TimeoutError):
    """A remote store did not connect or answer within the configured timeout."""


# Timeouts arrive as different types per backend: aiohttp's ServerTimeoutError
# and asyncio's TimeoutError (both TimeoutError on Python >= 3.11), botocore's
# Connect/ReadTimeoutError (not TimeoutError at all), urllib3's, or wrapped by
# zarr or this reader in a RuntimeError. So match on the whole cause chain.
_TIMEOUT_NAMES = {"TimeoutError", "ServerTimeoutError", "ConnectTimeoutError",
                  "ReadTimeoutError", "ConnectTimeout", "ReadTimeout",
                  "SocketTimeoutError", "ConnectionTimeoutError"}


def raise_if_timeout(exc: BaseException) -> None:
    """Re-raise a timeout as ``RemoteTimeout``; do nothing for anything else.

    The reader has dozens of ``except Exception`` fallbacks that turn a read
    failure into an empty result (HTTP 200, no data). Harmless-ish for a
    corrupt local file; for a remote store that merely went quiet it means a
    stall is shown as "this column is empty". Each fallback calls this first,
    so a timeout always reaches the route and becomes a 504.
    """
    if is_timeout(exc):
        if isinstance(exc, RemoteTimeout):
            raise exc
        raise RemoteTimeout(f"Remote store did not respond in time: "
                            f"{type(exc).__name__}: {exc}") from exc


def is_timeout(exc: BaseException) -> bool:
    """True if ``exc`` or anything in its cause/context chain is a timeout."""
    seen = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        if isinstance(exc, TimeoutError) or type(exc).__name__ in _TIMEOUT_NAMES:
            return True
        exc = exc.__cause__ or exc.__context__
    return False


def remote_scheme(path: Any) -> Optional[str]:
    """Return the lower-cased URL scheme if ``path`` names a remote store."""
    if not isinstance(path, str) or "://" not in path:
        return None
    scheme = path.split("://", 1)[0].lower()
    return scheme if scheme in REMOTE_SCHEMES else None


def is_remote_path(path: Any) -> bool:
    return remote_scheme(path) is not None


def validate_remote_url(url: str) -> urllib.parse.SplitResult:
    """Reject remote URLs whose shape this server will not open.

    - Credentials in the URL (``https://user:pass@host``) and query strings
      (pre-signed URLs) are refused: dataset paths are logged, cached as keys
      and echoed in responses, so a secret placed in one leaks everywhere.
      Credentials come from the environment instead (``remote_credentials``).
      A zarr store is also a directory of keys; a query string cannot be
      carried onto each key, so pre-signed URLs would not work anyway.
    - ``.`` and ``..`` segments are refused so a URL cannot climb out of an
      allow-listed prefix after an HTTP server normalises it.
    """
    parts = urllib.parse.urlsplit(url)
    if not parts.netloc:
        raise ValueError(f"Remote dataset URL has no host or bucket: {url!r}")
    if parts.username is not None or parts.password is not None:
        raise ValueError(
            "Remote dataset URLs must not embed credentials; configure "
            "remote_credentials: environment and use the standard credential "
            "environment variables or profile instead")
    if parts.query or parts.fragment:
        raise ValueError(
            "Remote dataset URLs must not carry a query string or fragment "
            "(pre-signed URLs are not supported for zarr stores)")
    segments = parts.path.split("/")
    if "." in segments or ".." in segments:
        raise ValueError(f"Remote dataset URL must not contain '.' or '..' segments: {url!r}")
    return parts


def _seconds(value: Any, key: str) -> float:
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{key} must be a number of seconds, got {value!r}")
    if not seconds > 0:
        raise ValueError(f"{key} must be positive, got {value!r}")
    return seconds


def _split_list(value: Any) -> Tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        value = value.split(",")
    return tuple(str(v).strip() for v in value if str(v).strip())


def _normalise_mode(value: Any) -> str:
    if isinstance(value, bool):
        return "allow" if value else "deny"
    mode = str(value).strip().lower()
    aliases = {"true": "allow", "yes": "allow", "on": "allow",
               "false": "deny", "no": "deny", "off": "deny"}
    mode = aliases.get(mode, mode)
    if mode not in _MODES:
        raise ValueError(f"remote_stores must be one of {_MODES}, got {value!r}")
    return mode


@dataclass(frozen=True)
class _Prefix:
    scheme: str
    netloc: str
    path: str  # '' or '/a/b/' -- always ends with '/' when non-empty

    @classmethod
    def parse(cls, entry: str) -> "_Prefix":
        if not is_remote_path(entry):
            raise ValueError(
                f"remote_allowlist entry {entry!r} must be a URL with one of the "
                f"schemes {sorted(REMOTE_SCHEMES)}")
        parts = validate_remote_url(entry)
        path = parts.path.rstrip("/")
        return cls(parts.scheme.lower(), parts.netloc.lower(), path + "/" if path else "")

    def matches(self, parts: urllib.parse.SplitResult) -> bool:
        # Compare host exactly and the path on a '/' boundary, so neither
        # https://data.example.org.evil.com nor s3://bucket-other slips past
        # https://data.example.org or s3://bucket.
        if parts.scheme.lower() != self.scheme or parts.netloc.lower() != self.netloc:
            return False
        return (parts.path.rstrip("/") + "/").startswith(self.path or "/")

    def __str__(self) -> str:
        return f"{self.scheme}://{self.netloc}{self.path}"


def hosted_reasons(config: Mapping[str, Any]) -> Tuple[str, ...]:
    """Why this server is NOT a local single-user instance; empty if it is.

    The one place ``remote_stores: auto`` decides "desktop or hosted". Keep it
    the only one: an explicit hosted-mode setting, when the server grows one,
    should be read here and nowhere else.
    """
    # An explicit server.hosted (set by the WSGI entry point, or by the
    # operator) is the same switch that turns on path confinement and the
    # exposure warning, so the two can never disagree about the deployment.
    hosted = config.get("hosted")
    if hosted is not None:
        return ("server.hosted is true",) if hosted else ()
    reasons = []
    if config.get("auth_enabled", False):
        reasons.append("auth is enabled")
    host = str(config.get("host", "127.0.0.1")).strip().lower()
    if host not in _LOOPBACK_HOSTS and not host.startswith("127."):
        reasons.append(f"host {host} is not loopback")
    if int(config.get("proxy_count", 0) or 0) > 0:
        reasons.append("server is behind a proxy")
    return tuple(reasons)


@dataclass(frozen=True)
class RemotePolicy:
    """Effective remote-store policy: whether, which, and with what credentials.

    ``enabled`` False refuses every remote URL. With a non-empty ``allowlist``
    only URLs under one of its prefixes are opened, and HTTP redirects are
    refused so an allow-listed host cannot bounce the server elsewhere.
    ``credentials`` is ``anonymous`` (unsigned requests) or ``environment``
    (the backend's standard credential chain: AWS_* variables, AWS_PROFILE /
    ~/.aws, instance roles; Google application default credentials).
    """
    enabled: bool = True
    allowlist: Tuple[_Prefix, ...] = ()
    credentials: str = "anonymous"
    reason: str = "library default"
    connect_timeout: float = DEFAULT_CONNECT_TIMEOUT_S
    read_timeout: float = DEFAULT_READ_TIMEOUT_S
    chunk_cache_mb: int = DEFAULT_CHUNK_CACHE_MB

    @property
    def restricted(self) -> bool:
        return bool(self.allowlist)

    @classmethod
    def from_config(cls, config: Optional[Mapping[str, Any]] = None,
                    environ: Optional[Mapping[str, str]] = None) -> "RemotePolicy":
        """Resolve the policy from the flat server config plus env overrides.

        Keys (``server:`` section of the YAML config, flat in Flask config):

        ``remote_stores``  ``auto`` (default) | ``allow`` | ``deny``
            ``auto`` allows remote stores only when the server is a local,
            single-user instance: bound to a loopback host, auth disabled and
            not behind a reverse proxy (``proxy_count`` 0). Otherwise remote
            stores are disabled unless ``remote_allowlist`` is set, in which
            case only those prefixes are allowed.
        ``remote_allowlist``  list (or comma-separated string) of URL prefixes
        ``remote_credentials``  ``anonymous`` (default) | ``environment``
        ``remote_connect_timeout_s`` / ``remote_read_timeout_s``  seconds
            (default 10 / 30) to establish a connection / between bytes read
        ``remote_chunk_cache_mb``  in-memory LRU of raw store bytes, per open
            remote store (default 256; 0 disables)

        ``ANNZARRO_REMOTE_STORES``, ``_ALLOWLIST``, ``_CREDENTIALS``,
        ``_CONNECT_TIMEOUT``, ``_READ_TIMEOUT`` and ``_CHUNK_CACHE_MB``
        override the config keys.
        """
        config = config or {}
        environ = os.environ if environ is None else environ

        mode = _normalise_mode(environ.get(ENV_MODE, config.get("remote_stores", "auto")))
        raw_allowlist = _split_list(environ.get(ENV_ALLOWLIST, config.get("remote_allowlist")))
        allowlist = tuple(_Prefix.parse(e) for e in raw_allowlist)
        credentials = str(environ.get(ENV_CREDENTIALS,
                                      config.get("remote_credentials", "anonymous"))).strip().lower()
        if credentials not in _CREDENTIALS:
            raise ValueError(f"remote_credentials must be one of {_CREDENTIALS}, got {credentials!r}")
        connect_timeout = _seconds(environ.get(ENV_CONNECT_TIMEOUT, config.get(
            "remote_connect_timeout_s", DEFAULT_CONNECT_TIMEOUT_S)), "remote_connect_timeout_s")
        try:
            chunk_cache_mb = int(environ.get(ENV_CHUNK_CACHE, config.get(
                "remote_chunk_cache_mb", DEFAULT_CHUNK_CACHE_MB)))
        except (TypeError, ValueError):
            raise ValueError("remote_chunk_cache_mb must be a whole number of MB")
        if chunk_cache_mb < 0:
            raise ValueError("remote_chunk_cache_mb must be >= 0 (0 disables it)")
        read_timeout = _seconds(environ.get(ENV_READ_TIMEOUT, config.get(
            "remote_read_timeout_s", DEFAULT_READ_TIMEOUT_S)), "remote_read_timeout_s")

        if mode == "deny":
            enabled, reason = False, "remote_stores: deny"
        elif mode == "allow":
            enabled, reason = True, "remote_stores: allow"
        else:
            hosted = hosted_reasons(config)
            if not hosted:
                enabled, reason = True, "remote_stores: auto (local single-user server)"
            elif allowlist:
                enabled, reason = True, f"remote_stores: auto ({', '.join(hosted)}; allowlist only)"
            else:
                enabled, reason = False, (f"remote_stores: auto ({', '.join(hosted)}; "
                                          f"set remote_allowlist or remote_stores: allow)")
        return cls(enabled=enabled, allowlist=allowlist, credentials=credentials,
                   reason=reason, connect_timeout=connect_timeout, read_timeout=read_timeout,
                   chunk_cache_mb=chunk_cache_mb)

    def describe(self) -> str:
        if not self.enabled:
            return f"remote stores disabled [{self.reason}]"
        scope = ", ".join(str(p) for p in self.allowlist) if self.allowlist else "any URL"
        return (f"remote stores allowed for {scope}; credentials={self.credentials}; "
                f"timeouts connect={self.connect_timeout:g}s read={self.read_timeout:g}s; "
                f"chunk cache {self.chunk_cache_mb} MB/store "
                f"[{self.reason}]")

    def check(self, url: str) -> urllib.parse.SplitResult:
        """Raise ``RemoteAccessDenied`` unless this policy permits ``url``."""
        parts = validate_remote_url(url)
        if not self.enabled:
            raise RemoteAccessDenied(
                f"Remote datasets are disabled on this server ({self.reason})")
        if self.allowlist and not any(p.matches(parts) for p in self.allowlist):
            raise RemoteAccessDenied(
                f"Remote dataset URL is not under an allowed prefix "
                f"(remote_allowlist: {', '.join(str(p) for p in self.allowlist)})")
        return parts

    def storage_options(self, url: str) -> Dict[str, Any]:
        """fsspec ``storage_options`` for opening ``url`` under this policy.

        Every backend gets a connect and a read timeout. Without them a store
        that accepts the connection and then goes quiet holds a server thread
        for aiohttp's 5-minute default -- or indefinitely for gcsfs, which
        passes ``timeout=None`` on every request.
        """
        scheme = remote_scheme(url)
        anonymous = self.credentials == "anonymous"
        if scheme == "s3":
            options = {"config_kwargs": {"connect_timeout": self.connect_timeout,
                                         "read_timeout": self.read_timeout}}
            if anonymous:
                options["anon"] = True
            return options
        if scheme in ("gs", "gcs"):
            # gcsfs hands requests_timeout to every aiohttp request, which
            # overrides any session-level timeout.
            options = {"requests_timeout": self._aiohttp_timeout()}
            if anonymous:
                options["token"] = "anon"
            return options
        if scheme in ("http", "https"):
            client_kwargs = {"timeout": self._aiohttp_timeout()}
            if self.restricted:
                client_kwargs["raise_for_status"] = _http_status_restricted
                return {"allow_redirects": False, "client_kwargs": client_kwargs}
            client_kwargs["raise_for_status"] = _http_status
            return {"client_kwargs": client_kwargs}
        return {}

    def _aiohttp_timeout(self):
        import aiohttp
        # sock_read bounds the gap between bytes, not the whole transfer, so a
        # large chunk on a slow but live link still completes.
        return aiohttp.ClientTimeout(total=None, sock_connect=self.connect_timeout,
                                     sock_read=self.read_timeout)


async def _http_status(response) -> None:
    """aiohttp response hook: a 403 on a key is a MISSING key.

    Zarr probes for keys that legitimately do not exist (``.zattrs``,
    ``zarr.json``, empty chunks). S3 -- and every CloudFront/HTTP front end on
    a bucket -- answers those with 403, not 404, unless the caller may list
    the bucket. fsspec raises a generic ClientResponseError for that, which
    zarr treats as a hard failure, so a public AnnData store on S3 could not
    be opened at all. FileNotFoundError is what fsspec raises for 404 and what
    zarr reads as "key absent".
    """
    if response.status == 403:
        raise FileNotFoundError(f"HTTP 403 for {response.url} (treated as a missing key)")


async def _http_status_restricted(response) -> None:
    """As ``_http_status``, and a 3xx under an allowlist is an error, not data.

    With ``allow_redirects=False`` aiohttp hands the 3xx response back and
    fsspec only raises for status >= 400, so without this hook the redirect
    body would be parsed as zarr metadata.
    """
    if 300 <= response.status < 400:
        raise RemoteAccessDenied(
            f"Remote store answered with a redirect (HTTP {response.status}); "
            f"redirects are not followed when remote_allowlist is set")
    await _http_status(response)


# The policy for code that never configures one (the reader used as a library,
# scripts, tests) is permissive: there is no other user to protect. The server
# replaces it at startup via ``configure_remote_policy``.
_policy = RemotePolicy()


def configure_remote_policy(config: Optional[Mapping[str, Any]] = None,
                            environ: Optional[Mapping[str, str]] = None) -> RemotePolicy:
    global _policy
    _policy = RemotePolicy.from_config(config, environ)
    logger.info("Remote store policy: %s", _policy.describe())
    if _policy.enabled and not _policy.restricted and (config or {}).get("auth_enabled"):
        logger.warning("Remote stores are allowed for ANY URL on a server with auth enabled; "
                       "every user can make this server fetch arbitrary URLs. "
                       "Consider setting remote_allowlist.")
    return _policy


def get_remote_policy() -> RemotePolicy:
    return _policy


def check_remote_access(url: str) -> None:
    _policy.check(url)


def require_backend(url: str) -> None:
    """Raise ``RemoteDependencyError`` if ``url``'s fsspec backend is missing."""
    scheme = remote_scheme(url)
    needed = ["fsspec", REMOTE_SCHEMES[scheme]]
    missing = []
    for module in needed:
        try:
            __import__(module)
        except ImportError:
            missing.append(module)
    if missing:
        raise RemoteDependencyError(
            f"Reading {scheme}:// datasets needs the optional package(s) "
            f"{', '.join(missing)}; install them with: {INSTALL_HINT}")


def _is_missing_group(exc: BaseException) -> bool:
    # zarr 3: GroupNotFoundError subclasses FileNotFoundError.
    # zarr 2: GroupNotFoundError is a ValueError; a missing .zmetadata is a KeyError.
    return isinstance(exc, (FileNotFoundError, KeyError)) or type(exc).__name__ == "GroupNotFoundError"


def open_remote_group(url: str, policy: Optional[RemotePolicy] = None):
    """Open the zarr group at ``url`` read-only, enforcing the remote policy.

    Raises:
        ValueError: malformed URL, or the URL holds an array rather than a group
        RemoteAccessDenied: the policy refuses the URL, or the store refused
            the (anonymous) request
        RemoteDependencyError: the scheme's optional backend is not installed
        FileNotFoundError: no zarr group at the URL
        RemoteTimeout: no connection or no answer within the policy's timeouts
        RuntimeError: any other failure (network, DNS, TLS, ...)
    """
    policy = policy or _policy
    policy.check(url)
    require_backend(url)
    # fsspec keys are paths; a trailing '/' would produce '//.zgroup'.
    target = url.rstrip("/")
    options = policy.storage_options(target)

    missing = (f"No readable zarr group at {url}: it does not exist"
               + (" or it needs credentials (remote_credentials: environment)"
                  if policy.credentials == "anonymous"
                  and remote_scheme(url) not in ("http", "https") else ""))
    # Exceptions the store reads as "key absent". Deliberately NOT OSError as a
    # whole: a timeout is an OSError, and zarr fills an "absent" chunk with
    # the fill value -- a stalled read would come back as zeros, not an error.
    missing_key = (FileNotFoundError, IsADirectoryError, NotADirectoryError)
    if remote_scheme(url) == "s3":
        # s3fs raises PermissionError for a 403, which is how S3 says
        # "no such key" to a caller without ListBucket (see _http_status).
        missing_key += (PermissionError,)
    try:
        if _ZARR_V3:
            # zarr 3 reads consolidated metadata on its own when present.
            store = _fsspec_store(target, options, missing_key, policy)
            group = zarr.open_group(store, mode="r")
            consolidated = getattr(group.metadata, "consolidated_metadata", None) is not None
        else:
            # zarr 2's FSStore defaults to treating every IOError as absent.
            store = zarr.storage.FSStore(target, mode="r", exceptions=(KeyError,) + missing_key,
                                         **options)
            # zarr 2 must be asked for consolidated metadata. One .zmetadata
            # request replaces a request per member: ms versus seconds remotely.
            try:
                group = zarr.open_consolidated(store, mode="r")
                consolidated = True
            except KeyError:
                group = zarr.open_group(store, mode="r")
                consolidated = False
        if not consolidated and remote_scheme(url) in ("http", "https"):
            # HTTP has no listing primitive. Without .zmetadata, member names
            # (obs columns, obsm/layers keys) are only discoverable if the
            # server renders HTML directory indexes; most object stores and
            # CDNs do not, and the dataset then looks empty though every
            # named read still works.
            logger.warning("Remote store %s has no consolidated metadata (.zmetadata); over "
                           "HTTP its members may not be listable. Consolidate it with "
                           "zarr.consolidate_metadata() or serve it via s3:// / gs://.", url)
        return group
    except Exception as exc:
        error = _classify_open_error(exc, url, policy, missing)
        if error is exc:
            raise
        raise error from exc


def _fsspec_store(target: str, options: Dict[str, Any], missing_key: tuple,
                  policy: RemotePolicy):
    """The zarr 3 store for a remote open: plain, or with a chunk cache.

    The reader caches decoded RESULTS keyed by the exact request, so asking
    for gene 5 after gene 0 re-downloads every chunk both share -- for a CSR
    X that is the whole indices/data arrays, every time. ``_LRUFsspecStore``
    keeps recently read raw bytes in memory instead, bounded per open store
    by ``remote_chunk_cache_mb``; the reader keeps at most
    ``cache_dataset_limit`` remote roots open, which bounds the total.

    It is a small subclass of FsspecStore rather than zarr's own
    ``zarr.experimental.cache_store.CacheStore`` because that only exists in
    newer zarr 3 releases (absent in 3.1.3, for one), and this must behave
    the same on every zarr 3 the package accepts. zarr 2 is not cached: its
    LRUStoreCache around FSStore turned a timed-out chunk read back into a
    missing chunk (zeros, HTTP 200).
    """
    from zarr.storage import FsspecStore
    cls = FsspecStore
    if policy.chunk_cache_mb > 0:
        global _LRUFsspecStore
        if _LRUFsspecStore is None:
            _LRUFsspecStore = _define_lru_store(FsspecStore)
        cls = _LRUFsspecStore
    store = cls.from_url(target, storage_options=options, read_only=True,
                         allowed_exceptions=missing_key)
    if cls is not FsspecStore:
        store._lru_max = policy.chunk_cache_mb * 1024 * 1024
    return store


_LRUFsspecStore = None


def _define_lru_store(base):
    class LRUFsspecStore(base):
        """FsspecStore with an in-memory LRU of whole-key reads.

        Only successful, whole-key reads are kept: a missing key, a byte-range
        read or any error (a timeout above all) is never cached, so a failed
        read is retried next time rather than remembered. Every operation
        runs on zarr's single event loop with no await between lookup and
        update, so the OrderedDict needs no lock.
        """

        def _lru(self):
            # Instances zarr derives from this one (with_read_only, ...) start
            # with an empty cache rather than sharing state.
            if "_lru_data" not in self.__dict__:
                self._lru_data = OrderedDict()
                self._lru_bytes = 0
                self.__dict__.setdefault("_lru_max", 0)
            return self._lru_data

        async def get(self, key, prototype, byte_range=None):
            cache = self._lru()
            if byte_range is None and key in cache:
                cache.move_to_end(key)
                return cache[key]
            value = await super().get(key, prototype, byte_range)
            if byte_range is None and value is not None:
                size = len(value)
                if 0 < size <= self._lru_max:
                    cache[key] = value
                    self._lru_bytes += size
                    while self._lru_bytes > self._lru_max:
                        _, old = cache.popitem(last=False)
                        self._lru_bytes -= len(old)
            return value

    return LRUFsspecStore


def timeout_message(url: str, policy: Optional[RemotePolicy] = None) -> str:
    policy = policy or _policy
    return (f"Remote store {url} did not respond in time (connect timeout "
            f"{policy.connect_timeout:g}s, read timeout {policy.read_timeout:g}s; "
            f"see remote_connect_timeout_s / remote_read_timeout_s)")


def _classify_open_error(exc: Exception, url: str, policy: RemotePolicy,
                         missing: str) -> Exception:
    """The typed error ``open_remote_group`` promises, for whatever was raised."""
    if is_timeout(exc):
        return RemoteTimeout(timeout_message(url, policy))
    if _is_missing_group(exc):
        return FileNotFoundError(missing)
    if isinstance(exc, RemoteAccessDenied):
        return exc
    if isinstance(exc, ValueError):
        if "contains an array" in str(exc).lower():
            return ValueError(f"URL points at a zarr array, not an AnnData group: {url}")
        return exc
    if isinstance(exc, PermissionError):
        hint = (" The store may require credentials; set remote_credentials: environment."
                if policy.credentials == "anonymous" else "")
        return RemoteAccessDenied(f"Remote store refused access to {url}.{hint}")
    return RuntimeError(f"Could not open remote store {url}: {type(exc).__name__}: {exc}")
