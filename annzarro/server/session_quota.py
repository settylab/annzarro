"""How much one server's panel sets may take, and what listing them costs.

Panel sets are JSON files in the panel-sets directory (``server/panel_sets.py``), written by
whoever may save: with login off, anyone who reaches the server. Nothing bounded their
number or their total size, so a loop of saves filled the disk, and
``sessions/list`` parsed every file on every call.

Three limits (``max_sessions_per_user``, ``max_sessions``, ``max_sessions_mb``)
are checked when a set is created, duplicated or imported, or grows by being
overwritten. The routes that write a set hold ``session_store.locked`` from
the check to the write, so two requests racing at the limit cannot both pass.
The admin interface reads the same numbers (:func:`usage_by_owner`,
:func:`totals`), so what it shows is what the check enforces.
"""
import json
import logging
import os
import threading
from typing import Any, Dict, List, NamedTuple, Optional

logger = logging.getLogger(__name__)

DEFAULT_MAX_PER_USER = 500
DEFAULT_MAX_SESSIONS = 5000
DEFAULT_MAX_MB = 256

_summaries: Dict[str, tuple] = {}
_lock = threading.Lock()


class Summary(NamedTuple):
    path: str
    size: int
    data: Dict[str, Any]


class QuotaRefused(Exception):
    """A save, duplicate or import the quotas forbid; answered 409 with ``reason``."""

    def __init__(self, reason: str, message: str, limit, used):
        super().__init__(message)
        self.reason, self.limit, self.used = reason, limit, used


def summary(path: str) -> Optional[Summary]:
    """The file's stored fields (the whole panel set), parsed again only when
    its mtime or size changed; None when it cannot be read as a JSON object."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    stamp = (st.st_mtime_ns, st.st_size)
    with _lock:
        hit = _summaries.get(path)
    if hit is not None and hit[0] == stamp:
        return hit[1]
    try:
        with open(path, "r") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            raise ValueError("not a JSON object")
    except Exception as exc:
        logger.warning(f"Error reading session file {os.path.basename(path)}: {exc}")
        return None
    result = Summary(path, st.st_size, data)
    with _lock:
        if len(_summaries) > 4 * DEFAULT_MAX_SESSIONS:
            _summaries.clear()
        _summaries[path] = (stamp, result)
    return result


def entries(sessions_dir: str) -> List[Summary]:
    """Every readable ``*.json`` set in the directory."""
    found = []
    try:
        names = os.listdir(sessions_dir)
    except OSError:
        return found
    for name in names:
        if name.endswith(".json"):
            item = summary(os.path.join(sessions_dir, name))
            if item is not None:
                found.append(item)
    return found


def _limit(config, key: str, default):
    value = config.get(key)
    return default if value is None else value


def limits(config):
    """``(per_user, total, max_bytes)``; 0 switches a limit off."""
    return (int(_limit(config, "max_sessions_per_user", DEFAULT_MAX_PER_USER)),
            int(_limit(config, "max_sessions", DEFAULT_MAX_SESSIONS)),
            int(float(_limit(config, "max_sessions_mb", DEFAULT_MAX_MB)) * 2 ** 20))


def usage_by_owner(config, held: List[Summary]) -> List[Dict[str, Any]]:
    """``[{owner, count, bytes, limit}]`` for every owner in ``held`` (the
    result of :func:`entries`), the busiest first. ``limit`` is the per-user
    limit that :func:`check` enforces, None when it is off. ``owner`` is None
    for sets saved before owners were recorded (and with login off)."""
    per_user, _, _ = limits(config)
    tally: Dict[Optional[str], List[int]] = {}
    for e in held:
        owner = e.data.get("owner")
        counts = tally.setdefault(owner if isinstance(owner, str) else None, [0, 0])
        counts[0] += 1
        counts[1] += e.size
    rows = [{"owner": owner, "count": n, "bytes": size, "limit": per_user or None}
            for owner, (n, size) in tally.items()]
    rows.sort(key=lambda r: (-r["count"], r["owner"] or ""))
    return rows


def totals(config, held: List[Summary]) -> Dict[str, Any]:
    """The server-wide numbers against the two server-wide limits."""
    _, total, max_bytes = limits(config)
    return {"count": len(held), "max": total or None,
            "mb": round(sum(e.size for e in held) / 2 ** 20, 2),
            "max_mb": round(max_bytes / 2 ** 20, 2) if max_bytes else None}


def check(config, sessions_dir: str, file_path: str, owner: Optional[str], new_size: int) -> None:
    """QuotaRefused unless writing ``new_size`` bytes to ``file_path`` for
    ``owner`` keeps every limit (0 switches a limit off).

    ``owner`` is the requester (None with login off: all sets are then one
    person's). A file that exists is replaced, so it adds no set and its old
    size is not counted; its owner stays what it was.
    """
    per_user, total, max_bytes = limits(config)
    if not (per_user or total or max_bytes):
        return
    held = entries(sessions_dir)
    here = os.path.realpath(file_path)
    replacing = next((e for e in held if os.path.realpath(e.path) == here), None)
    if max_bytes:
        used = sum(e.size for e in held) - (replacing.size if replacing else 0) + new_size
        if used > max_bytes:
            raise QuotaRefused(
                "session_quota_total",
                f"The panel sets on this server take {used / 2 ** 20:,.0f} MB with this one; the limit is "
                f"{max_bytes / 2 ** 20:,.0f} MB (server.max_sessions_mb). Delete panel sets you no longer need.",
                max_bytes / 2 ** 20, used / 2 ** 20)
    if replacing is not None:
        return
    if total and len(held) + 1 > total:
        raise QuotaRefused(
            "session_quota_total",
            f"This server already holds {len(held):,} panel sets, the most it keeps (server.max_sessions). "
            "Delete panel sets you no longer need.", total, len(held))
    if per_user:
        mine = sum(1 for e in held if e.data.get("owner") == owner)
        if mine + 1 > per_user:
            raise QuotaRefused(
                "session_quota_user",
                f"You already have {mine:,} panel sets, the most one user may keep (server.max_sessions_per_user). "
                "Delete panel sets you no longer need.", per_user, mine)
