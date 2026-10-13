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
    Limit("dataset_scan_max_entries", 200_000),
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


def _declare_policy_keys() -> None:
    """Show every limit in the policy registry, read-only (the YAML decides)."""
    from annzarro.server.policy import Float, Int, Key, declare
    for key, limit in LIMITS.items():
        if limit.nullable:                  # a default derived from the machine: declared below
            continue
        number = Int if limit.integer else Float
        declare(Key(
            name=f"limits.{key}", type=number(min=limit.minimum), default=limit.default, scope="config",
            description=f"server.{key}" + (" (0 turns it off)" if limit.zero_off else ""),
            area="limits", config_path=f"server.{key}", client=False, restart=key in _RESTART))

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
             "MB the cell subsets one worker computes at once may hold, 55 B a cell (0: 15% of RAM)"),
            ("max_read_mb", derived_max_mb, "MB one read of an obsp/varp matrix may hold (0: 5% of RAM)"),
            ("read_budget_mb", derived_budget_mb, "MB all pairwise reads in flight in one worker may hold (0: twice max_read_mb)")):
        declare(Key(name=f"limits.{name}", type=Float(min=0), default=default, scope="config",
                    description=f"server.{name}: {text}", area="limits", config_path=f"server.{name}", client=False))
    declare(Key(name="limits.read_wait_s", type=Float(min=0), default=5, scope="config",
                description="server.read_wait_s: seconds a pairwise read waits for the budget before a 503",
                area="limits", config_path="server.read_wait_s", client=False))


_declare_policy_keys()
