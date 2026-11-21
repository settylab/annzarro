"""The code cache of a server worker: resolved groupings, least recently used first out (SHR-40, CMP-6).

A grouping's codes (one per cell shown) are what a request pays for before it can read any gene: 3.4 s at 100M
cells. A worker keeps the groupings it resolved, so a later request for the same grouping (other genes, another
measure, another dependant panel) skips the resolve; its first frame says ``codes: "hit"``.

**The key** (PER-3, review M10) is the dataset, its fingerprint and the engine's ``Plan.cache_key``:

* the dataset is its real path (a remote URL as it is), so two stores with the same content are two entries;
* the fingerprint is the store's freshness token (``core/freshness.py``): a stat of the store's top-level members
  and the dataset's generation, which a Refresh that finds the store changed, and every cache reset, moves in every
  worker at once. When it moves, the dataset's entries are dropped on its next lookup;
* ``cache_key`` is the engine's: the shape, the recipe without labels, the subset, the hash of each bitset and of
  each upstream recipe, and ``ALGORITHM_VERSION``;
* the cells shown are checked as well, so an entry is never answered for another number of cells.

**Histograms are kept outside the codes**, per partitioning: the request's ``want.histograms`` is not part of the
key, an entry remembers which partitionings' histograms it was resolved with, and a lookup hits only when every
histogram it asks for is held. The reply carries exactly the histograms asked for, so a hit's reply is the reply of
a miss. (A key with the histograms in it would make the grouping panel, which asks for its factors' histograms, and
its dependants, which ask for none, resolve the same grouping twice.)

**It holds codes only** (SHR-40): the grouping table (groups, levels, counts, edges, histograms) and the codes, read
only. Never moments, scores or columns. A refused grouping is not kept.

**Size.** The budget is a callable (the server setting ``group_code_cache_mb``, 512 MB by default, read on every
store). An entry is the bytes of its codes plus its table as JSON. The cache is registered with the worker's
memory ledger as its evictable: its bytes count against the ledger's bound, and the ledger empties it before any
reservation waits. A new entry is kept only if it fits the budget and the room the ledger has left; older entries
leave first to make room.

**A grouping being resolved** is claimed, so a request that needs it while another resolves it waits for that
resolve instead of paying for its own (CMP-6: a session opening with one grouping and three dependants resolves once
per worker it reaches). Only a claim that ends right after its resolve is waited for (a request with no features
and no measures, whose histograms cover the asked ones); any other request resolves on its own, in parallel. A
claim that ends without a grouping (failed, closed, refused) wakes its waiters, and one of them claims next.
"""

from __future__ import annotations

import json
import os
import threading
from collections import OrderedDict
from dataclasses import dataclass, replace
from typing import Callable, Dict, FrozenSet, Iterable, List, Optional, Tuple

from . import freshness
from .cell_groups import GroupingResult
from .remote import is_remote_path


@dataclass(frozen=True)
class Key:
    """What a cached grouping is looked up by: the dataset, its fingerprint, the engine's key and the cells shown."""
    dataset: str
    fingerprint: str
    cache_key: str
    n_shown: int


def dataset_name(dataset_path: str) -> str:
    """The dataset as it enters the key: the real path of a local store, a remote URL as it is."""
    name = str(dataset_path)
    return name if is_remote_path(name) else os.path.realpath(name)


def key_of(dataset_path: str, cache_key: str, n_shown: int) -> Optional[Key]:
    """The key of a grouping now, or None when the store has no fingerprint (a missing local path): not cached."""
    token = freshness.token(dataset_path)
    if token is None:
        return None
    return Key(dataset_name(dataset_path), token, str(cache_key), int(n_shown))


@dataclass
class _Entry:
    result: GroupingResult          # the table and the codes, histograms taken out
    histograms: Dict[int, dict]     # partitioning position -> its histogram
    asked: FrozenSet[int]           # the positions resolved with a histogram asked for
    nbytes: int


class Hit:
    """A lookup that found the grouping: ``result`` is the reply's grouping, with the histograms asked for."""

    def __init__(self, result: GroupingResult):
        self.result = result


class Pending:
    """A lookup that found the grouping being resolved by another request: ``wait(timeout)`` is true once that
    claim has ended (look up again then)."""

    def __init__(self, event: threading.Event):
        self._event = event

    def wait(self, timeout: Optional[float] = None) -> bool:
        return self._event.wait(timeout)


class Claim:
    """A lookup that missed: the caller resolves the grouping, then ``fill``s the claim with it, or ``abandon``s it.
    As a context manager it is abandoned on the way out unless filled."""

    def __init__(self, cache: "GroupCache", key: Key, asked: FrozenSet[int], prompt: bool):
        self._cache, self.key, self.asked, self.prompt = cache, key, asked, prompt
        self.event = threading.Event()

    def fill(self, result: GroupingResult) -> bool:
        """Keep ``result`` (when it can be kept) and end the claim; whether it was kept."""
        try:
            return self._cache.put(self.key, result, self.asked)
        finally:
            self.abandon()

    def abandon(self) -> None:
        if not self.event.is_set():
            self._cache._end(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.abandon()


def _table_bytes(result: GroupingResult) -> int:
    return len(json.dumps({"groups": result.groups, "partitionings": result.partitionings, "small": result.small},
                          separators=(",", ":"), default=str))


def _without_histograms(parts: Iterable[dict]) -> Tuple[List[dict], Dict[int, dict]]:
    kept, histograms = [], {}
    for i, part in enumerate(parts):
        if "histogram" in part:
            histograms[i] = part["histogram"]
            part = {k: v for k, v in part.items() if k != "histogram"}
        kept.append(part)
    return kept, histograms


class GroupCache:
    """The resolved groupings of one worker, least recently used first out, within ``budget()`` bytes.

    ``room()`` is the bytes the worker's ledger has left beside its reservations (the bound less what is held),
    None for no ledger. ``size`` and ``clear`` are what the ledger calls (``register_evictable``); every method is
    safe to call from any thread.
    """

    def __init__(self, budget: Callable[[], int], room: Optional[Callable[[], int]] = None):
        self._budget, self._room = budget, room
        self._lock = threading.Lock()
        self._entries: "OrderedDict[Key, _Entry]" = OrderedDict()
        self._bytes = 0
        self._claims: Dict[Key, List[Claim]] = {}
        self.stats = {"hits": 0, "misses": 0, "waits": 0, "kept": 0, "evicted": 0}

    # -- what the ledger sees ------------------------------------------------------------------------------------

    def size(self) -> int:
        """Bytes held now."""
        with self._lock:
            return self._bytes

    def clear(self) -> None:
        """Empty the cache (the ledger's evict, and a test's fresh start). Claims in progress are kept."""
        with self._lock:
            self.stats["evicted"] += len(self._entries)
            self._entries.clear()
            self._bytes = 0

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)

    # -- lookups -------------------------------------------------------------------------------------------------

    def peek(self, key: Key, histograms: Iterable[int] = ()) -> Optional[GroupingResult]:
        """The grouping when it is held with every histogram asked for (a hit, counted), else None. Claims nothing:
        a request decides its lane by it before it queues, and looks up again (``begin``) when its turn comes."""
        asked = frozenset(int(h) for h in histograms)
        with self._lock:
            self._drop_moved(key)
            entry = self._entries.get(key)
            if entry is None or not asked <= entry.asked:
                return None
            self._entries.move_to_end(key)
            self.stats["hits"] += 1
            return self._reply(entry, asked)

    def begin(self, key: Key, histograms: Iterable[int] = (), prompt: bool = False):
        """Look ``key`` up for a request asking for ``histograms``: a :class:`Hit`, a :class:`Pending` (another
        request is resolving it and will be done with it at once) or a :class:`Claim` (resolve it).

        ``prompt`` says this request ends right after its resolve (no features, no measures), so others may wait
        for its claim."""
        asked = frozenset(int(h) for h in histograms)
        with self._lock:
            self._drop_moved(key)
            entry = self._entries.get(key)
            if entry is not None and asked <= entry.asked:
                self._entries.move_to_end(key)
                self.stats["hits"] += 1
                return Hit(self._reply(entry, asked))
            for claim in self._claims.get(key, ()):
                if claim.prompt and asked <= claim.asked:
                    self.stats["waits"] += 1
                    return Pending(claim.event)
            self.stats["misses"] += 1
            claim = Claim(self, key, asked, bool(prompt))
            self._claims.setdefault(key, []).append(claim)
            return claim

    def put(self, key: Key, result: GroupingResult, asked: Iterable[int] = ()) -> bool:
        """Keep a resolved grouping under ``key``, resolved with the histograms of ``asked``; whether it was kept
        (a refused grouping, one without codes, or one larger than the budget or the ledger's room is not)."""
        if result.refused is not None or result.codes is None or result.codes.size != key.n_shown:
            return False
        codes = result.codes
        codes.flags.writeable = False                    # shared by every request that hits it: read only
        parts, histograms = _without_histograms(result.partitionings)
        table = replace(result, partitionings=parts, codes=codes)
        asked = frozenset(int(h) for h in asked)
        nbytes = int(codes.nbytes) + _table_bytes(table) + sum(len(json.dumps(h)) for h in histograms.values())
        room = None if self._room is None else int(self._room())
        limit = int(self._budget())
        if room is not None:
            limit = min(limit, room)                     # the ledger's room: its bound less its reservations
        with self._lock:
            self._drop_moved(key)
            if nbytes > limit:                           # never fits: what is held stays
                return False
            old = self._entries.pop(key, None)
            if old is not None:
                self._bytes -= old.nbytes
                histograms = {**old.histograms, **histograms}
                asked = asked | old.asked
            while self._entries and self._bytes + nbytes > limit:
                _, gone = self._entries.popitem(last=False)
                self._bytes -= gone.nbytes
                self.stats["evicted"] += 1
            self._entries[key] = _Entry(table, histograms, asked, nbytes)
            self._bytes += nbytes
            self.stats["kept"] += 1
            return True

    # -- inside --------------------------------------------------------------------------------------------------

    def _end(self, claim: Claim) -> None:
        with self._lock:
            claims = self._claims.get(claim.key, [])
            if claim in claims:
                claims.remove(claim)
            if not claims:
                self._claims.pop(claim.key, None)
            claim.event.set()

    def _drop_moved(self, key: Key) -> None:
        """Drop the dataset's entries made under another fingerprint (the store changed, or was refreshed)."""
        stale = [k for k in self._entries if k.dataset == key.dataset and k.fingerprint != key.fingerprint]
        for k in stale:
            self._bytes -= self._entries.pop(k).nbytes
            self.stats["evicted"] += 1

    @staticmethod
    def _reply(entry: _Entry, asked: FrozenSet[int]) -> GroupingResult:
        parts = [({**part, "histogram": entry.histograms[i]} if i in asked and i in entry.histograms else part)
                 for i, part in enumerate(entry.result.partitionings)]
        return replace(entry.result, partitionings=parts)
