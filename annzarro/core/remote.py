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


class RemoteAccessDenied(PermissionError):
    """The server's remote-store policy forbids opening this URL."""


class RemoteDependencyError(ImportError):
    """The optional packages needed to read this URL scheme are not installed."""


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

        ``ANNZARRO_REMOTE_STORES``, ``ANNZARRO_REMOTE_ALLOWLIST`` and
        ``ANNZARRO_REMOTE_CREDENTIALS`` override the config keys.
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

        if mode == "deny":
            enabled, reason = False, "remote_stores: deny"
        elif mode == "allow":
            enabled, reason = True, "remote_stores: allow"
        else:
            hosted = []
            if config.get("auth_enabled", False):
                hosted.append("auth is enabled")
            host = str(config.get("host", "127.0.0.1")).strip().lower()
            if host not in _LOOPBACK_HOSTS and not host.startswith("127."):
                hosted.append(f"host {host} is not loopback")
            if int(config.get("proxy_count", 0) or 0) > 0:
                hosted.append("server is behind a proxy")
            if not hosted:
                enabled, reason = True, "remote_stores: auto (local single-user server)"
            elif allowlist:
                enabled, reason = True, f"remote_stores: auto ({', '.join(hosted)}; allowlist only)"
            else:
                enabled, reason = False, (f"remote_stores: auto ({', '.join(hosted)}; "
                                          f"set remote_allowlist or remote_stores: allow)")
        return cls(enabled=enabled, allowlist=allowlist, credentials=credentials,
                   reason=reason)

    def describe(self) -> str:
        if not self.enabled:
            return f"remote stores disabled [{self.reason}]"
        scope = ", ".join(str(p) for p in self.allowlist) if self.allowlist else "any URL"
        return f"remote stores allowed for {scope}; credentials={self.credentials} [{self.reason}]"

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
        """fsspec ``storage_options`` for opening ``url`` under this policy."""
        scheme = remote_scheme(url)
        anonymous = self.credentials == "anonymous"
        if scheme == "s3":
            return {"anon": True} if anonymous else {}
        if scheme in ("gs", "gcs"):
            return {"token": "anon"} if anonymous else {}
        if scheme in ("http", "https"):
            if self.restricted:
                return {"allow_redirects": False,
                        "client_kwargs": {"raise_for_status": _http_status_restricted}}
            return {"client_kwargs": {"raise_for_status": _http_status}}
        return {}


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
    try:
        if _ZARR_V3:
            # zarr 3 reads consolidated metadata on its own when present.
            from zarr.storage import FsspecStore
            allowed = (FileNotFoundError, IsADirectoryError, NotADirectoryError)
            if remote_scheme(url) == "s3":
                # s3fs raises PermissionError for a 403, which is how S3 says
                # "no such key" to a caller without ListBucket (see _http_status).
                allowed += (PermissionError,)
            store = FsspecStore.from_url(target, storage_options=options, read_only=True,
                                         allowed_exceptions=allowed)
            group = zarr.open_group(store, mode="r")
            consolidated = getattr(group.metadata, "consolidated_metadata", None) is not None
        else:
            # zarr 2 must be asked for consolidated metadata. One .zmetadata
            # request replaces a request per member: ms versus seconds remotely.
            try:
                group = zarr.open_consolidated(target, mode="r", storage_options=options)
                consolidated = True
            except KeyError:
                group = zarr.open_group(target, mode="r", storage_options=options)
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
    except (RemoteAccessDenied, ValueError) as exc:
        if _is_missing_group(exc):
            raise FileNotFoundError(missing) from exc
        if "contains an array" in str(exc).lower():
            raise ValueError(f"URL points at a zarr array, not an AnnData group: {url}") from exc
        raise
    except PermissionError as exc:
        hint = (" The store may require credentials; set remote_credentials: environment."
                if policy.credentials == "anonymous" else "")
        raise RemoteAccessDenied(f"Remote store refused access to {url}.{hint}") from exc
    except Exception as exc:
        if _is_missing_group(exc):
            raise FileNotFoundError(missing) from exc
        raise RuntimeError(f"Could not open remote store {url}: {type(exc).__name__}: {exc}") from exc
