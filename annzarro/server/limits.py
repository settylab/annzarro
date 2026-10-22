"""The resource limits of a shared server, in one place.

Each limit is a ``server.*`` setting with a default, declared in
``config/base.yaml``, ``config/schema.yaml`` and ``server/core.py``
(DEFAULT_CONFIG) and documented in ``docs/reference/configuration.md`` and
``docs/deployment/resource-limits.md``; tests/server/test_limits_registry.py
holds those places to this table. ``annzarro config validate`` and server
start-up refuse a value that is not a number of the right kind.

``0`` switches a limit off where the table says ``zero_off``; otherwise the
minimum is 1. ``None`` is allowed only for a limit whose default is derived
from the machine (``nullable``).
"""
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class Limit:
    key: str
    default: Any
    integer: bool = True
    zero_off: bool = False
    nullable: bool = False

    @property
    def minimum(self) -> int:
        return 0 if self.zero_off else 1


LIMITS: Dict[str, Limit] = {limit.key: limit for limit in (
    Limit("name_search_max_regex_chars", 200),
    Limit("name_search_timeout_s", 10, integer=False, zero_off=True),
    Limit("max_sessions_per_user", 500, zero_off=True),
    Limit("max_sessions", 5000, zero_off=True),
    Limit("max_sessions_mb", 256, integer=False, zero_off=True),
    Limit("dataset_folder_max_entries", 500),
    Limit("dataset_search_max_depth", 6),
    Limit("dataset_search_max_entries", 20_000),
    Limit("dataset_details_check_budget_s", 1.5, integer=False, zero_off=True),
    Limit("dataset_scan_max_entries", 200_000),
    Limit("text_index_workers", 2),
    Limit("text_index_store_timeout_s", 15, integer=False),
    Limit("text_index_max_stores", 20_000),
    Limit("text_index_readme_kb", 64),
    Limit("text_index_max_mb", 64, integer=False),
    Limit("text_index_ttl_s", 1800, integer=False),
    Limit("read_user_share_percent", 50, integer=False, zero_off=True),
    Limit("subset_budget_mb", None, integer=False, nullable=True),
    Limit("subset_wait_s", 30, integer=False, zero_off=True),
    Limit("max_requests", 20000, zero_off=True),
    Limit("max_requests_jitter", 2000, zero_off=True),
    Limit("limit_request_line", 0, zero_off=True),
    Limit("limit_request_fields", 100, zero_off=True),
    Limit("limit_request_field_size", 8190, zero_off=True),
    Limit("max_request_mb", 64, integer=False, zero_off=True),
)}


#: Settings that 0.7.2 and the early 0.7.3 builds knew and are gone; a config file that still sets one is
#: accepted, with a warning, and the value is ignored
DEPRECATED = {
    "text_index_background": "the server always keeps the description index fresh; turn the search off with text_index_enabled or the Settings page",
    "text_index_crawl_timeout_s": "a crawl that runs long is continued by the server, so there is nothing to set",
    "text_index_min_interval_s": "a search no longer starts a crawl; the server refreshes every text_index_ttl_s",
}


def deprecated_settings(server: Optional[Dict[str, Any]]) -> List[str]:
    """One warning for every removed ``server.*`` setting that ``server`` still sets."""
    return [f"server.{key} is no longer used ({why}); remove it from the configuration"
            for key, why in DEPRECATED.items() if server and key in server]


def validate_limits(server: Optional[Dict[str, Any]]) -> List[str]:
    """Messages for every limit in ``server`` (the merged ``server`` section)
    that is not a number of the right kind. Absent keys are fine."""
    errors = []
    for key, limit in LIMITS.items():
        if not server or key not in server:
            continue
        value = server[key]
        if value is None:
            if not limit.nullable:
                errors.append(f"Invalid server.{key}: it needs a number, not empty")
            continue
        bad = isinstance(value, bool) or not isinstance(value, (int, float)) \
            or (limit.integer and isinstance(value, float) and not value.is_integer()) \
            or value < limit.minimum
        if bad:
            kind = "a whole number" if limit.integer else "a number"
            errors.append(f"Invalid server.{key}: {value!r} (expected {kind} >= {limit.minimum}"
                          + (", 0 turns it off" if limit.zero_off else "") + ")")
    return errors


#: Limits gunicorn (or the request-size setting) reads once, when the server starts
_RESTART = {"max_requests", "max_requests_jitter", "limit_request_line", "limit_request_fields",
            "limit_request_field_size", "max_request_mb"}


#: What each limit does, shown as its help on the Settings page; the default is appended
_HELP = {
    "name_search_max_regex_chars": "Longest regular expression, in characters, that a name search runs; a longer one is refused. Bounds the CPU one pattern can cost.",
    "name_search_timeout_s": "Seconds a regular-expression name search scans before it answers with the matches found so far. 0 turns the limit off.",
    "max_sessions_per_user": "Panel sets one user may keep; saving another is refused. Protects disk. 0 turns it off.",
    "max_sessions": "Panel sets the whole server keeps; past it saving is refused. Protects disk. 0 turns it off.",
    "max_sessions_mb": "Megabytes all saved panel sets may take together. Protects disk. 0 turns it off.",
    "dataset_folder_max_entries": "Entries (folders and stores) one request of the dataset browser's folder listing returns; a larger folder is read in pages.",
    "dataset_search_max_depth": "How many folders deep the dataset browser's search of the data directory goes.",
    "dataset_search_max_entries": "Entries the dataset browser's search looks at before it stops and marks the result truncated.",
    "dataset_details_check_budget_s": "Seconds the dataset browser spends checking one zarr store when it shows its details; it then reports what it found so far. 0 turns the check off there.",
    "dataset_scan_max_entries": "Directory entries a listing of the data directory, or the store count in the server status, reads before it stops and marks the result truncated.",
    "text_index_workers": "Threads the crawl of the description index reads stores with. The crawl runs once per server, in one worker, and is started by the server itself.",
    "text_index_store_timeout_s": "Seconds the description crawl waits for one store before it marks the store timed out and goes on with a spare thread; the store's answer is still kept if it comes before the crawl ends. Late reads count against the spare threads of the server process across crawls; when there are as many as reader threads, a crawl stops.",
    "text_index_max_stores": "Stores one crawl of the description index covers; past it the crawl is marked partial.",
    "text_index_readme_kb": "Kilobytes of each README the description index keeps.",
    "text_index_max_mb": "Megabytes of text the description index may hold, and every worker holds in memory; past it the READMEs are dropped from the largest down.",
    "text_index_ttl_s": "Seconds after which the server reads the datasets again for changes and refreshes the description index; it also continues a crawl that stopped partway.",
    "read_user_share_percent": "Percentage of the shared read and subset memory budgets that one user may hold while another waits, so one user cannot make everyone else's requests fail with 503 read_busy. 0 gives a user the whole budgets. Applies to a server that other people can reach.",
    "subset_wait_s": "Seconds a cell subset waits for its memory budget before it is answered 503 read_busy. 0 turns the limit off.",
    "max_requests": "Requests a gunicorn worker serves before it is replaced, which returns memory that crept and empties its caches. 0 never replaces it. Read when the server starts.",
    "max_requests_jitter": "Random number of requests, up to this, added to each worker's max_requests so the workers do not restart together. 0 turns it off. Read when the server starts.",
    "limit_request_line": "Longest request line gunicorn accepts, in bytes; 0 is unlimited, and then the reverse proxy should bound it. Read when the server starts.",
    "limit_request_fields": "Most header fields gunicorn accepts in one request. 0 turns the limit off. Read when the server starts.",
    "limit_request_field_size": "Longest header field gunicorn accepts, in bytes; a longer one is answered 400. 0 turns the limit off. Read when the server starts.",
    "max_request_mb": "Largest request body, in megabytes; a larger one is refused with 413 before it is read. Panel sets are the only uploads. 0 turns the limit off. Read when the server starts.",
}


#: the short name of each limit on the admin pages
_LABEL = {
    "name_search_max_regex_chars": "Longest name-search pattern (characters)",
    "name_search_timeout_s": "Name-search time limit (s)",
    "max_sessions_per_user": "Panel sets per user",
    "max_sessions": "Panel sets on the server",
    "max_sessions_mb": "Panel set storage (MB)",
    "dataset_folder_max_entries": "Folder listing size (entries)",
    "dataset_search_max_depth": "Dataset search depth (folders)",
    "dataset_search_max_entries": "Dataset search size (entries)",
    "dataset_details_check_budget_s": "Store check time (s)",
    "dataset_scan_max_entries": "Directory scan size (entries)",
    "text_index_workers": "Description crawl threads",
    "text_index_store_timeout_s": "Description crawl time per store (s)",
    "text_index_max_stores": "Description crawl size (stores)",
    "text_index_readme_kb": "README text indexed (KB)",
    "text_index_max_mb": "Description index size (MB)",
    "text_index_ttl_s": "Description index refresh interval (s)",
    "read_user_share_percent": "Per-user share of read budgets (%)",
    "subset_budget_mb": "Cell subset memory (MB)",
    "subset_wait_s": "Cell subset wait (s)",
    "max_requests": "Requests per worker",
    "max_requests_jitter": "Worker restart jitter (requests)",
    "limit_request_line": "Longest request line (bytes)",
    "limit_request_fields": "Most header fields",
    "limit_request_field_size": "Longest header field (bytes)",
    "max_request_mb": "Largest request body (MB)",
    "max_read_mb": "Largest read (MB)",
    "read_budget_mb": "Read budget per worker (MB)",
    "read_wait_s": "Read wait (s)",
}


def limit_guide(key: str) -> str:
    """The row of ``key`` in docs/deployment/resource-limits.md (it carries ``{#limit-<key>}``)."""
    return "deployment/resource-limits.html#limit-" + key.replace("_", "-")


def _declare_policy_keys() -> None:
    """Show every limit in the policy registry, read-only (the YAML decides)."""
    from annzarro.server.policy import Float, Int, Key, declare
    for key, limit in LIMITS.items():
        if limit.nullable:                  # a default derived from the machine: declared below
            continue
        number = Int if limit.integer else Float
        declare(Key(
            name=f"limits.{key}", type=number(min=limit.minimum), default=limit.default, scope="config",
            description=f"{_HELP[key]} Default {limit.default:,}. Set in the config file as server.{key}.",
            area="limits", config_path=f"server.{key}", client=False, restart=key in _RESTART, guide=limit_guide(key), label=_LABEL[key]))

    def derived_max_mb(config):
        from annzarro.core import read_guard
        return read_guard.default_limit_bytes() / 2 ** 20

    def derived_budget_mb(config):
        configured = config.get("max_read_mb")
        return 2 * (configured if configured else derived_max_mb(config))

    def derived_subset_mb(config):
        from annzarro.core import subset
        return subset.default_budget_bytes() / 2 ** 20

    for name, default, text in (
            ("subset_budget_mb", derived_subset_mb,
             "Megabytes the cell subsets one worker computes at once may hold, charged 55 bytes a cell. A subset that cannot "
             "start within subset_wait_s is answered 503 read_busy. Default 15% of the machine's RAM per worker; 0 uses the default."),
            ("max_read_mb", derived_max_mb,
             "Megabytes one read of an obsp or varp matrix may hold, estimated before any chunk is read; a larger request is "
             "refused with 413. Default 5% of the machine's RAM, between 256 MB and 4 GB; 0 uses the default."),
            ("read_budget_mb", derived_budget_mb,
             "Megabytes all pairwise (obsp and varp) reads in flight in one worker may hold together. A read that does not fit "
             "waits up to read_wait_s. Default twice max_read_mb; 0 uses the default.")):
        declare(Key(name=f"limits.{name}", type=Float(min=0), default=default, scope="config",
                    description=f"{text} Set in the config file as server.{name}.", area="limits",
                    config_path=f"server.{name}", client=False, guide=limit_guide(name),
                    label=_LABEL[name]))
    declare(Key(name="limits.read_wait_s", type=Float(min=0), default=5, scope="config",
                description="Seconds a pairwise read waits for the read budget before it is answered 503 read_busy. Default 5. "
                            "Set in the config file as server.read_wait_s.",
                area="limits", config_path="server.read_wait_s", client=False, guide=limit_guide("read_wait_s"),
                label=_LABEL["read_wait_s"]))


_declare_policy_keys()
