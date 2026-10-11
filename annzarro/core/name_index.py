"""Search over obs/var names without shipping the whole list to the browser.

The header's Focused Cell / Focused Gene pickers used to download every name
and hand it to a <select>; at a million cells that is a 15 MB response and a
tab that is unresponsive for ~15 s. They now ask this index for the few names
that match what the user has typed.

One index per (dataset, axis) is built on first use from the reader's name
list and kept in a small LRU, keyed against a stat() signature so a rewritten
store is re-read. Matching is case-insensitive and runs on one lower-cased,
newline-joined copy of the names, so a substring or prefix query is a C-level
``str.find`` over a single string rather than a Python loop over a million
objects; offsets map back to row indices with a binary search.
"""

from __future__ import annotations

import os
import re
import sys
import threading
import time
from collections import OrderedDict
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np

MAX_LIMIT = 500
DEFAULT_LIMIT = 50
_CACHE_SIZE = 8

#: Characters a regex search pattern may have (server.name_search_max_regex_chars)
DEFAULT_MAX_REGEX_CHARS = 200
#: Seconds a regex scan may run before it answers with what it has
#: (server.name_search_timeout_s)
DEFAULT_SEARCH_TIMEOUT_S = 10.0
#: Unbounded repeats (``*``, ``+``, ``{n,}``, ``{n,1000+}``) one pattern may have.
#: Each adds a power of the name's length to the worst case of one match.
MAX_UNBOUNDED_REPEATS = 4
_UNBOUNDED_FROM = 1000

_SEP = "\n"


class RegexRefusedError(ValueError):
    """A regex search pattern the server will not run: too long, or built so
    that matching one name can take exponential time. ``re`` cannot be
    interrupted, and it holds the GIL, so one such request stops every
    thread of its worker. Answered 400 with ``reason``."""

    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason


class IndexOverBudget(Exception):
    """The name index of this axis would not fit the memory budget; search it
    with stream_search() instead."""

    def __init__(self, needed: int, budget: int):
        super().__init__(f"a name index needs about {needed / 2**30:.1f} GiB, over the "
                         f"{budget / 2**30:.1f} GiB budget")
        self.needed, self.budget = needed, budget


class NameChunks:
    """Names handed to NameIndex a chunk at a time: each chunk a list of
    strings or a ``(joined_bytes, lengths)`` pair (string_chunks.iter_chunks).

    ``n``: how many names there are, when known (lets the index size itself
    before reading them). ``factory``: a callable returning a fresh iterator
    over the chunks, which allows sizing from the first chunk and scanning
    the names again without an index (stream_search)."""

    def __init__(self, chunks, n: Optional[int] = None, factory: Optional[Callable] = None):
        self.chunks = chunks
        self.n = n
        self.factory = factory
        self._sample = None

    def __iter__(self):
        if self.factory is not None:
            return iter(self.factory())
        return iter(self.chunks)

    def sample(self) -> Optional[Tuple[float, bool]]:
        """(bytes per name including its separator, whether the first chunk
        has upper-case names) from the first chunk; None when the chunks
        cannot be read twice."""
        if self._sample is None and self.factory is not None:
            it = iter(self.factory())
            try:
                first = next(it, None)
            finally:
                close = getattr(it, "close", None)
                if close:
                    close()
            if first is None:
                self._sample = (0.0, False)
            elif isinstance(first, tuple):
                joined, lengths = first
                k = max(int(lengths.size), 1)
                self._sample = ((len(joined) + 1) / k + (1 if lengths.size == 0 else 0),
                                joined.lower() != joined)
            else:
                names = ["" if v is None else str(v) for v in first]
                joined = _SEP.join(names)
                self._sample = ((len(joined.encode()) + 1) / max(len(names), 1),
                                joined.lower() != joined)
        return self._sample


def estimate_bytes(n: int, per_name: float, has_upper: bool = False) -> int:
    """Memory a built index of ``n`` names of ``per_name`` bytes each (with
    separator) holds: the lower-cased haystack (plus the original spelling
    when names have upper case), 4- or 8-byte starts, and bytearray slack."""
    hay = int(n * per_name * (2 if has_upper else 1) * 1.125) + 2
    return hay + n * (4 if n * per_name < 2 ** 32 else 8)


def _regex_parser():
    try:
        import re._parser as parser         # Python 3.11+
    except ImportError:                      # pragma: no cover
        import sre_parse as parser
    return parser


def _subpatterns(av):
    """The sub-patterns an opcode's argument holds, at any depth of tuples and lists."""
    parser = _regex_parser()
    if isinstance(av, parser.SubPattern):
        yield av
    elif isinstance(av, (tuple, list)):
        for item in av:
            yield from _subpatterns(item)


def _repeat_ops(parser):
    return tuple(getattr(parser, n) for n in ("MAX_REPEAT", "MIN_REPEAT", "POSSESSIVE_REPEAT")
                 if hasattr(parser, n))


def _contains_repeat(sub, ops) -> bool:
    for op, av in sub:
        if op in ops and av[1] > 1:
            return True
        if any(_contains_repeat(inner, ops) for inner in _subpatterns(av)):
            return True
    return False


def check_regex(pattern: str) -> None:
    """RegexRefusedError unless ``pattern`` is safe to run over every name.

    Refused: a pattern over server.name_search_max_regex_chars; a repeat of
    something that repeats or branches (``(a+)+``, ``(a|a)*``, ``(\\w+\\w*)+``),
    whose worst case on one 18-character cell name is a quarter of a second
    and doubles with every character; and more than MAX_UNBOUNDED_REPEATS
    unbounded repeats (``.*.*.*.*.*``). A pattern that does not compile is not
    judged here: re.compile reports it. What passes can still be slow over
    millions of names, which the search's time limit (server.name_search_timeout_s) bounds.
    """
    if len(pattern) > _max_regex_chars:
        raise RegexRefusedError(
            "regex_too_long", f"The pattern has {len(pattern)} characters; at most {_max_regex_chars} "
            "(server.name_search_max_regex_chars).")
    parser = _regex_parser()
    try:
        tree = parser.parse(pattern, re.IGNORECASE)
    except re.error:
        return
    ops = _repeat_ops(parser)
    unbounded = 0

    def refuse(what):
        raise RegexRefusedError(
            "regex_too_complex", f"This pattern is refused: {what}. Matching it against a long name can take "
            "exponential time. Write the repeats side by side instead (e.g. 'ab+c' rather than '(a+b+)+c').")

    def walk(sub, in_variable_repeat):
        nonlocal unbounded
        for op, av in sub:
            if op in ops:
                low, high, body = av
                if in_variable_repeat and high > 1:
                    refuse("a repeat inside a repeat")
                variable = high > low and high > 1
                if variable and _contains_repeat(body, ops):
                    refuse("a repeat inside a repeat")
                if high >= _UNBOUNDED_FROM:
                    unbounded += 1
                    if unbounded > MAX_UNBOUNDED_REPEATS:
                        raise RegexRefusedError(
                            "regex_too_complex", f"More than {MAX_UNBOUNDED_REPEATS} open-ended repeats "
                            "(*, +, {{n,}}) in one pattern; use fewer.")
                walk(body, in_variable_repeat or variable)
            elif op == parser.BRANCH:
                if in_variable_repeat:
                    refuse("an alternation (a|b) inside a repeat")
                for inner in av[1]:
                    walk(inner, in_variable_repeat)
            else:
                for inner in _subpatterns(av):
                    walk(inner, in_variable_repeat)

    walk(tree, False)


def _deadline() -> Optional[float]:
    return time.monotonic() + _timeout_s if _timeout_s > 0 else None


def _expired(deadline: Optional[float]) -> bool:
    return deadline is not None and time.monotonic() > deadline


def _timed_out(scanned: int) -> Dict:
    """The reply fields of a regex scan that ran out of time."""
    return {"partial": True, "scanned": int(scanned), "timed_out": True,
            "note": (f"The search stopped after {_timeout_s:g} s (server.name_search_timeout_s), having read "
                     f"{int(scanned):,} names; the matches shown are from those. Use a simpler pattern, "
                     "or a plain text search.")}


try:                        # a dependency (pyproject); absent, regex search is refused
    import regex as _regex
except ImportError:         # pragma: no cover - depends on the environment
    _regex = None

#: Seconds a regex match may run when the scan has no clock (name_search_timeout_s 0)
UNCLOCKED_MATCH_S = 10.0


class CompiledRegex:
    """A user pattern, compiled with the ``regex`` package, whose every match runs under a timeout.

    The stdlib ``re`` cannot be interrupted and holds the GIL: one pattern such as
    ``.?`` x33 + ``!`` took more than 200 s on ONE 18-character name and stopped every
    thread of the worker, however the pattern was vetted (a list of shapes to refuse is
    never complete). ``regex.search(..., timeout=)`` stops inside the match and lets
    other threads run, so the time limit is a guarantee, not a hope: ``search`` raises
    TimeoutError when the deadline passes, mid-match included. ``check_regex`` stays in
    front as a cheap first filter.
    """

    def __init__(self, pattern: str):
        try:
            self._rx = _regex.compile(pattern, _regex.IGNORECASE)
        except _regex.error as exc:
            raise re.error(str(exc)) from exc

    def search(self, name: str, deadline: Optional[float]) -> bool:
        """Whether the pattern matches ``name``; TimeoutError past ``deadline``
        (a time from time.monotonic, None: UNCLOCKED_MATCH_S for this match)."""
        left = UNCLOCKED_MATCH_S if deadline is None else deadline - time.monotonic()
        if left <= 0:
            raise TimeoutError("regex search deadline passed")
        return self._rx.search(name, timeout=left) is not None


def compile_regex(pattern: str) -> CompiledRegex:
    """The case-insensitive compiled pattern, after check_regex."""
    check_regex(pattern)
    if _regex is None:
        raise RegexRefusedError(
            "regex_unavailable", "Regular-expression search needs the `regex` package, which is not installed "
            "on this server (pip install regex).")
    return CompiledRegex(pattern)


class NameIndex:
    """Case-insensitive exact / prefix / substring / regex lookup over names.

    Stored lean, for tens of millions of names: the lower-cased names as one
    newline-joined UTF-8 ``bytes`` haystack plus a ``uint32``/``uint64`` array
    of where each name starts in it. The original names are kept the same way
    (one blob plus offsets) only when some name differs from its haystack
    form (upper case, non-lowerable characters, a newline); otherwise a name is
    read back from the haystack. A list of 50M Python strings took about
    10 GB; this is about 1.2 GB for 50M 19-character names.

    Searching a UTF-8 haystack with a UTF-8 needle finds exactly the matches a
    ``str`` search would (UTF-8 is self-synchronising), so results are the
    same as the former list-of-strings index.
    """

    #: names per build step: bounds the transient per-name objects
    _CHUNK = 1 << 20

    def __init__(self, names, max_bytes: Optional[int] = None):
        """``names``: a sequence of names, or a NameChunks of them (read a
        chunk at a time, never all as Python strings at once).

        Built in place: the haystack grows in one bytearray (no list of parts
        joined at the end, which held every name twice), the start offsets
        are written chunk by chunk into one array sized up front (no
        full-length temporaries: a cumsum, an arange and a concatenation of
        the lengths made a second and third copy of the offsets), and the
        original spelling is kept only for the chunks whose names differ from
        their lower-cased form. ``max_bytes``: give up with IndexOverBudget
        as soon as the index would hold more.
        """
        self._max_bytes = max_bytes
        known_n = None
        if isinstance(names, NameChunks):
            chunks, known_n = iter(names), names.n
            sample = names.sample()
            per_name = sample[0] if sample else 0.0
        else:
            chunks = (names[a:a + self._CHUNK] for a in range(0, len(names), self._CHUNK))
            known_n, per_name = len(names), 0.0
        sep = _SEP.encode()
        self._hay = bytearray(sep)
        # (first row, blob, offsets) for chunks whose names are not their
        # lower-cased form; every other name is read back from the haystack
        self._orig_chunks: List[Tuple[int, bytes, np.ndarray]] = []
        self._orig_bytes = 0
        self._n_added = 0
        # the offsets of the names added so far: preallocated when the number
        # of names is known, else grown by pieces
        self._wide = bool(known_n and known_n * max(per_name, 1.0) >= 2 ** 32 - 2 ** 20)
        dtype = np.uint64 if self._wide else np.uint32
        self._starts_buf = np.empty(known_n, dtype=dtype) if known_n is not None else None
        self._starts_pieces: List[np.ndarray] = []
        self._known_n = known_n
        for chunk in chunks:
            if isinstance(chunk, tuple):
                self._add_joined(*chunk)
            else:
                self._add_list(["" if v is None else str(v) for v in chunk])
            self._check_budget(known_n)
        n = self._n_added
        self._n = n
        if not n:
            self._hay = bytearray(sep * 2)
        if self._starts_buf is not None:
            starts = self._starts_buf if n == self._starts_buf.size else self._starts_buf[:n].copy()
        elif self._starts_pieces:
            starts = np.concatenate(self._starts_pieces)
        else:
            starts = np.zeros(0, np.uint32)
        self._starts_buf = None
        self._starts_pieces = []
        self._starts = starts
        self._orig_first = np.array([c[0] for c in self._orig_chunks], dtype=np.int64)
        del self._n_added, self._known_n

    def _check_budget(self, known_n: Optional[int]) -> None:
        if self._max_bytes is None:
            return
        so_far = sys.getsizeof(self._hay) + self._orig_bytes
        so_far += self._starts_buf.nbytes if self._starts_buf is not None else sum(
            p.nbytes for p in self._starts_pieces)
        if so_far > self._max_bytes:
            held = so_far
            self._hay = bytearray()
            self._orig_chunks = []
            self._starts_buf, self._starts_pieces = None, []
            raise IndexOverBudget(held, self._max_bytes)

    def nbytes(self) -> int:
        """Memory this index holds."""
        return sys.getsizeof(self._hay) + self._starts.nbytes + self._orig_bytes

    def _note_starts(self, first: int, lens: np.ndarray) -> None:
        """Record where each name of a chunk starts: ``first`` is the
        haystack offset of the chunk's first name, ``lens`` the byte lengths."""
        k = int(lens.size)
        at = np.empty(k, dtype=np.int64)
        at[0] = first
        if k > 1:
            np.cumsum(lens[:-1], dtype=np.int64, out=at[1:])
            at[1:] += np.arange(1, k, dtype=np.int64)
            at[1:] += first
        base = self._n_added
        if self._starts_buf is not None:
            if base + k > self._starts_buf.size:                   # more names than announced
                grown = np.empty(max(base + k, self._starts_buf.size * 2), dtype=self._starts_buf.dtype)
                grown[:base] = self._starts_buf[:base]
                self._starts_buf = grown
            if self._starts_buf.dtype == np.uint32 and int(at[-1]) + int(lens[-1]) >= 2 ** 32:
                wide = np.empty(self._starts_buf.size, dtype=np.uint64)   # estimate was low
                wide[:base] = self._starts_buf[:base]
                self._starts_buf = wide
            self._starts_buf[base:base + k] = at
        else:
            big = int(at[-1]) + int(lens[-1]) >= 2 ** 32 or any(
                p.dtype == np.uint64 for p in self._starts_pieces)
            self._starts_pieces.append(at.astype(np.uint64 if big else np.uint32))

    def _note_orig(self, joined: bytes, lengths: np.ndarray) -> None:
        """Keep a chunk's original spelling (its names differ from the
        haystack's lower-cased form)."""
        off = np.zeros(lengths.size + 1, dtype=np.int64)
        np.cumsum(lengths, out=off[1:])
        self._orig_chunks.append((self._n_added, joined, off))
        self._orig_bytes += len(joined) + off.nbytes

    def _add_joined(self, joined: bytes, lengths: np.ndarray) -> None:
        """One chunk as newline-joined UTF-8 and item byte lengths
        (string_chunks.joined_items): ASCII without newlines in the names is
        lower-cased as bytes, which for ASCII is what str.lower() does."""
        k = int(lengths.size)
        if k == 0:
            return
        if joined.isascii() and joined.count(_SEP.encode()) == k - 1:
            low = joined.lower()
            first = len(self._hay)
            self._hay += low
            self._hay += _SEP.encode()
            lens = np.asarray(lengths, dtype=np.int32)
            if low != joined:
                self._note_orig(joined.replace(_SEP.encode(), b""), lens)
            self._note_starts(first, lens)
            self._n_added += k
            return
        names, pos = [], 0
        for ln in lengths.tolist():
            names.append(joined[pos:pos + ln].decode())
            pos += ln + 1
        self._add_list(names)

    def _add_list(self, part: List[str]) -> None:
        if not part:
            return
        sep = _SEP.encode()
        first = len(self._hay)
        joined = _SEP.join(part)
        if joined.isascii() and joined.count(_SEP) == len(part) - 1:
            # one byte per character, no newline inside a name: whole-chunk ops
            lens = np.fromiter(map(len, part), dtype=np.int32, count=len(part))
            low = joined.lower()
            self._hay += low.encode("ascii")
            if low != joined:
                self._note_orig(joined.replace(_SEP, "").encode("ascii"), lens)
        else:
            # lower() may change a name's length ('İ'); a newline becomes a space
            low = [x.lower().replace(_SEP, " ").encode() for x in part]
            enc = [x.encode() for x in part]
            self._hay += sep.join(low)
            lens = np.fromiter(map(len, low), dtype=np.int32, count=len(low))
            if any(lo != e for lo, e in zip(low, enc)):
                self._note_orig(b"".join(enc), np.fromiter(map(len, enc), dtype=np.int32, count=len(enc)))
        self._hay += sep
        self._note_starts(first, lens)
        self._n_added += len(part)

    def __len__(self) -> int:
        return self._n

    def name(self, row: int) -> str:
        """The original name of ``row``."""
        if self._orig_first.size:
            k = int(np.searchsorted(self._orig_first, row, side="right")) - 1
            if k >= 0:
                first, blob, off = self._orig_chunks[k]
                if row - first < off.size - 1:
                    i = row - first
                    return blob[int(off[i]):int(off[i + 1])].decode()
        a = int(self._starts[row])
        b = int(self._starts[row + 1]) - 1 if row + 1 < self._n else len(self._hay) - 1
        return self._hay[a:b].decode()

    def _names_from(self, start: int):
        """Original names in dataset order from ``start``, decoded a chunk at a time."""
        for a in range(start, self._n, self._CHUNK):
            b = min(a + self._CHUNK, self._n)
            if self._orig_first.size:
                for r in range(a, b):
                    yield self.name(r)
            else:
                lo = int(self._starts[a])
                hi = int(self._starts[b]) - 1 if b < self._n else len(self._hay) - 1
                yield from self._hay[lo:hi].decode().split(_SEP)

    def _row_at(self, offset: int) -> int:
        # the offset in the array's own dtype: a Python int would make numpy
        # cast the whole (uint32) array to int64 on every call
        return int(np.searchsorted(self._starts, self._starts.dtype.type(offset), side="right") - 1)

    def _find_rows(self, needle: bytes, want: int, skip: set, out: List[int]) -> bool:
        """Append rows whose haystack contains ``needle`` (first occurrence per
        row) to ``out`` until ``want`` rows are collected. Returns True if more
        matches exist beyond the ones collected."""
        hay = self._hay
        sep = _SEP.encode()
        pos = hay.find(needle)
        seen_last = -1
        while pos != -1:
            row = self._row_at(pos + (1 if needle.startswith(sep) else 0))
            if row != seen_last and row not in skip:
                if len(out) >= want:
                    return True
                out.append(row)
                skip.add(row)
            seen_last = row
            # jump to the next name: one row contributes at most once
            nxt = self._starts[row + 1] - 1 if row + 1 < len(self._starts) else len(hay)
            pos = hay.find(needle, max(pos + 1, int(nxt)))
        return False

    def search(self, query: str, limit: int = DEFAULT_LIMIT, mode: str = "substring") -> Dict:
        """Return ``{"matches": [{"name", "index"}], "truncated": bool}``.

        Order: an exact (case-sensitive, then case-insensitive) match first,
        then names that start with the query, then names that contain it, each
        group in dataset order. ``mode="regex"`` applies a case-insensitive
        ``re.search`` instead; ``mode="exact"`` returns only an exact match.
        """
        limit = max(1, min(int(limit), MAX_LIMIT))
        query = "" if query is None else str(query)
        rows: List[int] = []
        truncated = False

        if mode == "regex":
            rx = compile_regex(query)
            deadline = _deadline()
            timed_out = False
            for i, name in enumerate(self._names_from(0)):
                try:
                    hit = rx.search(name, deadline)
                except TimeoutError:         # also inside a single match
                    timed_out = True
                    break
                if hit:
                    if len(rows) >= limit:
                        truncated = True
                        break
                    rows.append(i)
            result = self._result(rows, truncated)
            if timed_out:
                result.update(_timed_out(i))
            return result

        if query == "":
            rows = list(range(min(limit, self._n)))
            return self._result(rows, self._n > limit)

        q = query.lower()
        if _SEP in q:
            return self._result([], False)
        qb = q.encode()
        sep = _SEP.encode()

        skip: set = set()
        exact = self._exact_rows(query, qb)
        for r in exact[:1]:
            rows.append(r)
            skip.add(r)
        if mode == "exact":
            return self._result(rows, False)

        # _find_rows stops at the first row it has no room for, so "truncated"
        # means a further matching name really exists, not just a full page.
        truncated = (self._find_rows(sep + qb, limit, skip, rows)
                     or self._find_rows(qb, limit, skip, rows))
        return self._result(rows, truncated)

    def _exact_rows(self, query: str, qb: bytes) -> List[int]:
        """Rows whose name equals the query: case-sensitive hits first."""
        sep = _SEP.encode()
        needle = sep + qb + sep
        hits = []
        pos = self._hay.find(needle)
        while pos != -1:
            hits.append(self._row_at(pos + 1))
            pos = self._hay.find(needle, pos + 1)
        hits.sort(key=lambda r: (self.name(r) != query, r))
        return hits

    def _result(self, rows: List[int], truncated: bool) -> Dict:
        return {
            "matches": [{"name": self.name(r), "index": int(r)} for r in rows],
            "truncated": bool(truncated),
        }


def _signature(dataset_path: str) -> Tuple:
    """Cheap fingerprint of a local store; remote paths are trusted as-is."""
    sig = []
    for member in ("", "obs", "var", ".zattrs", "zarr.json"):
        p = os.path.join(dataset_path, member) if member else dataset_path
        try:
            st = os.stat(p)
            sig.append((member, st.st_mtime_ns, st.st_size))
        except OSError:
            continue
    return tuple(sig)


_cache: "OrderedDict[Tuple[str, str], Tuple[Tuple, NameIndex]]" = OrderedDict()
_lock = threading.Lock()

#: (dataset, axis) -> (signature, estimated bytes) of an index refused for its size
_refused: "Dict[Tuple[str, str], Tuple[Tuple, int]]" = {}

#: bytes all cached indices may hold together; None = default_budget()
_budget: Optional[int] = None

#: names stream_search reads before it gives up with a partial answer
DEFAULT_SCAN_NAMES = 100_000_000
_scan_names: int = DEFAULT_SCAN_NAMES
_max_regex_chars: int = DEFAULT_MAX_REGEX_CHARS
_timeout_s: float = DEFAULT_SEARCH_TIMEOUT_S


def default_budget() -> int:
    """15% of this machine's memory, between 512 MiB and 16 GiB. A server
    runs several workers, each with its own cache."""
    try:
        import psutil
        total = psutil.virtual_memory().total
    except Exception:
        total = 8 * 2 ** 30
    return int(min(max(total * 0.15, 512 * 2 ** 20), 16 * 2 ** 30))


def configure(budget_mb: Optional[float] = None, scan_names: Optional[int] = None,
              max_regex_chars: Optional[int] = None, timeout_s: Optional[float] = None) -> None:
    """Set the bytes the cached indices may hold together (None or 0: the
    default, default_budget()), how many names a stream_search reads, the
    longest regex pattern a search runs and the seconds a regex scan may take
    (None: the defaults; 0 for the timeout: no limit)."""
    global _budget, _scan_names, _max_regex_chars, _timeout_s
    _budget = int(budget_mb * 2 ** 20) if budget_mb else None
    _scan_names = int(scan_names) if scan_names else DEFAULT_SCAN_NAMES
    _max_regex_chars = int(max_regex_chars) if max_regex_chars else DEFAULT_MAX_REGEX_CHARS
    _timeout_s = DEFAULT_SEARCH_TIMEOUT_S if timeout_s is None else float(timeout_s)


def budget_bytes() -> int:
    return _budget if _budget is not None else default_budget()


def scan_limit() -> int:
    return _scan_names


def cached_bytes() -> int:
    """Memory the cached indices hold."""
    with _lock:
        return sum(ix.nbytes() for _, ix in _cache.values())


def _evict(room: int, keep: Optional[Tuple[str, str]] = None) -> None:
    """Drop least-recently-used indices until the cache plus ``room`` bytes
    fits the budget. Called with _lock held."""
    budget = budget_bytes()
    total = sum(ix.nbytes() for _, ix in _cache.values())
    for key in list(_cache):
        if total + room <= budget and len(_cache) <= _CACHE_SIZE:
            break
        if key == keep:
            continue
        total -= _cache.pop(key)[1].nbytes()


def _estimate(source) -> Optional[int]:
    """Bytes the index of ``source`` would hold, or None when it cannot be
    told before reading every name."""
    if isinstance(source, NameChunks):
        sample = source.sample()
        if source.n is None or sample is None:
            return None
        return estimate_bytes(source.n, sample[0], sample[1])
    n = len(source)
    if n <= 1_000_000:
        return None             # small: build it
    head = ["" if v is None else str(v) for v in source[:1000]]
    joined = _SEP.join(head)
    return estimate_bytes(n, (len(joined.encode()) + 1) / max(len(head), 1), joined.lower() != joined)


#: (dataset, axis) -> Event set when its index, being built, is in _cache
_building: "Dict[Tuple[str, str], threading.Event]" = {}


def get_index(dataset_path: str, entity: str, load_names: Callable[[], List[str]]) -> NameIndex:
    """The cached NameIndex for one axis of one dataset, built on first use.

    One build per (dataset, axis) at a time: a request that arrives while it
    is built waits for that build rather than starting another (at 95.6M
    cells a build takes about 30 s and 1-2 GB; a picker asks on every
    keystroke). index_state() says whether one is being built.

    The cached indices together stay within budget_bytes(): the least
    recently used are dropped to make room, and an axis whose index would not
    fit on its own is not built at all: IndexOverBudget is raised, and the
    caller answers with stream_search() on the names it can read again.
    """
    key = (dataset_path, entity)
    sig = _signature(dataset_path)
    while True:
        with _lock:
            found = _cache.get(key)
            if found is not None and found[0] == sig:
                _cache.move_to_end(key)
                return found[1]
            refused = _refused.get(key)
            if refused is not None and refused[0] == sig and refused[1] > budget_bytes():
                raise IndexOverBudget(refused[1], budget_bytes())
            pending = _building.get(key)
            if pending is None:
                pending = _building[key] = threading.Event()
                mine = True
            else:
                mine = False
        if not mine:
            pending.wait()
            continue            # built (or failed): read the cache again
        try:
            source = load_names()
            budget = budget_bytes()
            need = _estimate(source)
            # Only names that can be read again can be searched without an
            # index; a list already in memory (a subset's few names) is
            # indexed whatever the budget, the cache just makes room for it.
            can_stream = isinstance(source, NameChunks) and source.factory is not None
            if can_stream and need is not None and need > budget:
                with _lock:
                    _refused[key] = (sig, need)
                raise IndexOverBudget(need, budget)
            with _lock:
                _cache.pop(key, None)       # a stale index of this axis
                _evict(need or 0)           # room first, so old and new never coexist
            try:
                index = NameIndex(source, max_bytes=budget if can_stream else None)
            except IndexOverBudget as exc:
                with _lock:
                    _refused[key] = (sig, exc.needed)
                raise
            with _lock:
                _refused.pop(key, None)
                _cache[key] = (sig, index)
                _cache.move_to_end(key)
                _evict(0, keep=key)
            return index
        finally:
            with _lock:
                _building.pop(key, None)
            pending.set()


def index_state(dataset_path: str, entity: str,
                load_names: Optional[Callable[[], List[str]]] = None) -> str:
    """'ready' (searches answer at once), 'building' (a search waits for a
    build under way), 'streaming' (too large for the memory budget: searches
    scan the names) or 'absent' (the next search builds it). With
    ``load_names``, an absent index is sized from its first chunk (nothing is
    built) and reported 'streaming' when it would not fit."""
    key = (dataset_path, entity)
    with _lock:
        sig = _signature(dataset_path)
        found = _cache.get(key)
        if found is not None and found[0] == sig:
            return "ready"
        refused = _refused.get(key)
        if refused is not None and refused[0] == sig and refused[1] > budget_bytes():
            return "streaming"
        if key in _building:
            return "building"
    if load_names is not None:
        try:
            source = load_names()
            need = _estimate(source) if isinstance(source, NameChunks) and source.factory is not None else None
        except Exception:
            need = None
        if need is not None and need > budget_bytes():
            with _lock:
                _refused[key] = (sig, need)
            return "streaming"
    return "absent"


def clear(dataset_path: Optional[str] = None) -> None:
    with _lock:
        if dataset_path is None:
            _cache.clear()
            _refused.clear()
        else:
            for key in [k for k in _cache if k[0] == dataset_path]:
                del _cache[key]
            for key in [k for k in _refused if k[0] == dataset_path]:
                del _refused[key]


def stream_search(source: NameChunks, query: str, limit: int = DEFAULT_LIMIT, mode: str = "substring",
                  max_scan: Optional[int] = None) -> Dict:
    """NameIndex.search() without a resident index: scan the names a chunk at
    a time, holding one chunk's index at once.

    The answer is the index's, up to where the scan stopped. It stops early
    when the answer cannot change any more (an exact match for mode "exact",
    ``limit`` + 2 names starting with the query, ``limit`` + 1 regex hits), and
    after ``max_scan`` names (scan_limit() by default). Either way the reply
    says what was covered: ``partial`` is True when names were left unread
    and the answer may differ from a full search (an exact match further on
    would have come first; a better group of matches may exist), ``scanned``
    counts the names read and ``note`` says so in words.
    """
    limit = max(1, min(int(limit), MAX_LIMIT))
    query = "" if query is None else str(query)
    cap = scan_limit() if max_scan is None else int(max_scan)
    n_total = source.n
    sep = _SEP.encode()
    base = 0
    exact_cs = exact_ci = None
    prefix: List[Tuple[int, str]] = []
    sub: List[Tuple[int, str]] = []
    plain: List[Tuple[int, str]] = []       # regex / empty query hits
    q = query.lower()
    qb = q.encode()
    stopped_early = False
    rx = compile_regex(query) if mode == "regex" else None
    deadline = _deadline()
    timed_out = False
    if mode != "regex" and query != "" and _SEP in q:
        return {"matches": [], "truncated": False, "partial": False, "scanned": 0}
    it = iter(source)
    try:
        for chunk in it:
            if base >= cap:
                stopped_early = True
                break
            if rx is not None and _expired(deadline):
                stopped_early = timed_out = True
                break
            ix = NameIndex(NameChunks([chunk]))
            k = len(ix)
            if k == 0:
                continue
            if rx is not None or query == "":
                for i, name in enumerate(ix._names_from(0)):
                    try:
                        hit = rx is None or rx.search(name, deadline)
                    except TimeoutError:     # also inside a single match
                        timed_out = True
                        break
                    if hit:
                        plain.append((base + i, name))
                        if len(plain) > limit:
                            break
                if timed_out:
                    base += i
                    stopped_early = True
                    break
                if len(plain) > limit:
                    base += k
                    stopped_early = True
                    break
            else:
                for r in ix._exact_rows(query, qb):
                    name = ix.name(r)
                    if name == query:
                        exact_cs = exact_cs or (base + r, name)
                    else:
                        exact_ci = exact_ci or (base + r, name)
                if mode == "exact":
                    if exact_cs:
                        base += k
                        stopped_early = True
                        break
                else:
                    want = limit + 2
                    if len(prefix) < want:
                        rows: List[int] = []
                        ix._find_rows(sep + qb, want - len(prefix), set(), rows)
                        prefix += [(base + r, ix.name(r)) for r in rows]
                    if len(prefix) >= want:
                        base += k
                        stopped_early = True
                        break
                    if len(sub) < want:
                        in_prefix = {r - base for r, _ in prefix if base <= r < base + k}
                        rows = []
                        ix._find_rows(qb, want - len(sub), in_prefix, rows)
                        sub += [(base + r, ix.name(r)) for r in rows]
            base += k
    finally:
        close = getattr(it, "close", None)
        if close:
            close()
    finished = (n_total is not None and base >= n_total) or (n_total is None and not stopped_early) \
        or (not stopped_early and base >= n_total)

    if rx is not None or query == "":
        got = plain[:limit]
        truncated = len(plain) > limit
        # the first hits in dataset order are complete as far as they go
        partial = False
        if (query == "" or timed_out) and stopped_early and not truncated:
            partial = True
    else:
        got = []
        skip = set()
        for found in (exact_cs or exact_ci,):
            if found:
                got.append(found)
                skip.add(found[0])
        truncated = False
        if mode != "exact":
            rest = [m for m in prefix if m[0] not in skip]
            room = limit - len(got)
            got += rest[:room]
            truncated = len(rest) > room
            if not truncated:
                skip |= {m[0] for m in prefix}
                rest = [m for m in sub if m[0] not in skip]
                room = limit - len(got)
                got += rest[:room]
                truncated = len(rest) > room
        # An early stop on an exact match (mode exact) settles the answer; one
        # on a full page of prefix hits does not rule out an exact match
        # further on, which an index would have put first.
        partial = not finished and not (mode == "exact" and exact_cs)
    out = {"matches": [{"name": nm, "index": int(r)} for r, nm in got], "truncated": bool(truncated),
           "partial": bool(partial), "scanned": int(base)}
    if timed_out:
        out.update(_timed_out(base))
        out["partial"] = True
    elif partial:
        of = f" of {n_total:,}" if n_total is not None else ""
        out["note"] = ("This dataset has too many names to keep an index in memory; "
                       f"{base:,}{of} names were searched.")
    return out
