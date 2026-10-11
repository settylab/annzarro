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
    Limit("dataset_scan_max_entries", 200_000),
    Limit("max_request_mb", 16, integer=False, zero_off=True),
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
