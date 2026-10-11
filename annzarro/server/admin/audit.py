"""
The admin audit log
-------------------

``<state dir>/audit.jsonl``: one canonical JSON object per line, each
carrying the hash of the one before it::

    {"seq": 42, "ts": "...", "actor": "alice", "addr": "10.0.0.5", "via": "web",
     "action": "user.set_admin", "target": "bob", "detail": {...},
     "outcome": "ok", "prev": "<hash of seq 41>", "hash": "<sha256(prev + record)>"}

``hash`` is the SHA-256 of ``prev`` followed by the canonical JSON of the
record without its ``hash``. Editing or deleting a line in the middle breaks
the chain, and :func:`verify` names the first record that no longer fits.
Cutting records off the end leaves no trace in the file, so every record is
also written to the ``annzarro.audit`` logger (journald under systemd, which
the service account cannot rewrite). A process that can write the file can
also forge FUTURE records; the log is evidence of what the admin interface
did, not protection against the account that runs it. ``chattr +a`` on the
file makes it append-only for that account.

At ``server.admin_audit_max_mb`` the file is rotated to ``audit.jsonl.1`` ..
``.5``; the first record of the new file carries the last hash of the old
one, so the chain and ``seq`` continue. Never stored: passwords, hashes,
tokens, cookie values.
"""

import hashlib
import json
import logging
import os
from datetime import datetime, timezone

from .. import atomic_store

logger = logging.getLogger("annzarro.audit")

FILE_NAME = "audit.jsonl"
ROTATIONS = 5
GENESIS = "0" * 64
#: A record whose detail serialises to more than this keeps only a marker.
MAX_DETAIL_BYTES = 2048
_TAIL = 8192


def _canonical(record):
    return json.dumps(record, sort_keys=True, separators=(",", ":"))


def _hash(prev, record):
    body = {k: v for k, v in record.items() if k != "hash"}
    return hashlib.sha256((prev + _canonical(body)).encode("utf-8")).hexdigest()


def _path(directory, n=0):
    base = os.path.join(directory, FILE_NAME)
    return base if n == 0 else f"{base}.{n}"


def _parse(line):
    try:
        record = json.loads(line)
    except ValueError:
        return None
    return record if isinstance(record, dict) else None


def _last_record(path):
    """The last line of ``path`` that parses, and whether the file ends in a newline."""
    try:
        size = os.path.getsize(path)
    except FileNotFoundError:
        return None, True
    if size == 0:
        return None, True
    window = _TAIL
    with open(path, "rb") as f:
        while True:
            start = max(0, size - window)
            f.seek(start)
            chunk = f.read(size - start)
            lines = chunk.split(b"\n")
            ends_in_newline = chunk.endswith(b"\n")
            if start > 0:
                lines = lines[1:]          # the first line may be cut
            for raw in reversed(lines):
                record = _parse(raw) if raw.strip() else None
                if record is not None and "seq" in record and "hash" in record:
                    return record, ends_in_newline
            if start == 0:
                return None, ends_in_newline
            window *= 4


def _rotate(directory):
    oldest = _path(directory, ROTATIONS)
    if os.path.exists(oldest):
        os.unlink(oldest)
    for n in range(ROTATIONS - 1, 0, -1):
        if os.path.exists(_path(directory, n)):
            os.replace(_path(directory, n), _path(directory, n + 1))
    os.replace(_path(directory), _path(directory, 1))


def append(directory, *, actor, addr, via, action, target=None, detail=None,
           outcome="ok", max_mb=0):
    """Append one record and return it. The directory must exist."""
    path = _path(directory)
    detail = detail or {}
    if len(_canonical(detail)) > MAX_DETAIL_BYTES:
        detail = {"truncated": True}
    with atomic_store.locked(path):
        last, ends_in_newline = _last_record(path)
        if last is None:
            # A new log, or one just rotated away: continue the previous file
            last, _ = _last_record(_path(directory, 1))
            ends_in_newline = True
        prev = last["hash"] if last else GENESIS
        record = {
            "seq": (last["seq"] + 1) if last else 1,
            "ts": datetime.now(timezone.utc).isoformat(),
            "actor": actor, "addr": addr, "via": via,
            "action": action, "target": target, "detail": detail, "outcome": outcome,
            "prev": prev,
        }
        record["hash"] = _hash(prev, record)
        line = _canonical(record)
        data = ("" if ends_in_newline else "\n") + line + "\n"
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            os.write(fd, data.encode("utf-8"))
            os.fsync(fd)
        finally:
            os.close(fd)
        if max_mb and os.path.getsize(path) >= max_mb * 2 ** 20:
            _rotate(directory)
    logger.info(line)
    return record


def record(action, target=None, detail=None, outcome="ok"):
    """Append a record for the current request: actor, address and the
    configured directory come from Flask."""
    from flask import current_app, request
    from .. import permissions
    from . import audit_max_mb, state_dir

    actor, _ = permissions.current_user()
    return append(state_dir(current_app.config, create=True), actor=actor,
                  addr=request.remote_addr, via="web", action=action, target=target,
                  detail=detail, outcome=outcome, max_mb=audit_max_mb(current_app.config))


def _files(directory):
    """Existing log files, oldest first."""
    paths = [_path(directory, n) for n in range(ROTATIONS, 0, -1)] + [_path(directory)]
    return [p for p in paths if os.path.exists(p)]


def verify(directory):
    """``(ok, first_bad_seq)`` over the current file and its rotations.

    The first record of the oldest file is the anchor: its ``prev`` is taken
    as given (older files were rotated away). A line that does not parse, a
    wrong hash, a ``prev`` that is not the previous hash, or a ``seq`` that
    does not follow, names the seq it should have had."""
    prev_hash, prev_seq = None, None
    for path in _files(directory):
        with open(path, "rb") as f:
            for raw in f:
                if not raw.strip():
                    continue
                expected = None if prev_seq is None else prev_seq + 1
                rec = _parse(raw)
                if (rec is None or not isinstance(rec.get("seq"), int)
                        or not isinstance(rec.get("prev"), str) or not isinstance(rec.get("hash"), str)):
                    return False, expected
                if _hash(rec["prev"], rec) != rec["hash"]:
                    return False, rec["seq"]
                if prev_hash is not None and (rec["prev"] != prev_hash or rec["seq"] != expected):
                    return False, rec["seq"]
                prev_hash, prev_seq = rec["hash"], rec["seq"]
    return True, None


_verified = {}


def verify_cached(directory):
    """:func:`verify`, reused until one of the log files changes."""
    stamps = tuple((p, atomic_store.stamp(p)) for p in _files(directory))
    cached = _verified.get(directory)
    if cached and cached[0] == stamps:
        return cached[1]
    result = verify(directory)
    _verified[directory] = (stamps, result)
    return result


def _reverse_lines(path, block=65536):
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        pos = f.tell()
        carry = b""
        while pos > 0:
            step = min(block, pos)
            pos -= step
            f.seek(pos)
            parts = (f.read(step) + carry).split(b"\n")
            carry = parts[0]
            for raw in reversed(parts[1:]):
                if raw.strip():
                    yield raw
        if carry.strip():
            yield carry


def read(directory, before_seq=None, limit=100):
    """Up to ``limit`` records with ``seq < before_seq``, newest first.

    Reads backwards from the end of the log, so the newest page costs the
    page, not the file. Lines that do not parse are skipped (``verify``
    reports them)."""
    out = []
    for path in reversed(_files(directory)):
        for raw in _reverse_lines(path):
            rec = _parse(raw)
            if rec is None or not isinstance(rec.get("seq"), int):
                continue
            if before_seq is not None and rec["seq"] >= before_seq:
                continue
            out.append(rec)
            if len(out) >= limit:
                return out
    return out
