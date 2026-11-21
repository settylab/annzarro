"""What the compute routes share: the body, the cost tiers, the lanes, the memory ledger, frames and blocks.

The compute routes (``gene_score``; ``cell_groups``) answer a computation with one stream: JSON frames, one per line,
then after the ``result`` frame the binary blocks it lists, little-endian, in the order listed. Everything decided
before any wait is plain HTTP (a bad request, the access gate, ``409``, ``413``, ``422``).

**Lanes (SHR-41).** One per worker process (``LANES``). The heavy lane runs one job at a time, first come first
served; the light lane runs ``LIGHT_WIDTH`` at a time and never waits on the heavy one. A heavy job gives the lane back
between read batches when another job waits: a :class:`Job` is the ``pause`` of ``gene_score.compute`` (``wanted()``
and ``wait()``), so the pipeline drains its read-ahead, the job's reservation shrinks to its accumulators, and the job
rejoins the queue at its back. Jobs that have run and take turns so are *sharing*. A job joins those turns only
while every one of them, itself included, could grow back to its whole reservation beside the accumulators of the
others (with the lanes' ledger); otherwise the running job keeps the lane, and the job waits for room. A job that
has given way may pass a new one that does not fit, so turns never wait on memory only the turns hold.

**The read guard's admission is part of the fit.** A job that takes a read-guard admission (``admit_bytes``) holds it
from its first turn until it ends, given way or not. A new job whose admission would not fit beside those of the
jobs that have run (its requester's share, ``read_guard.share_bytes``, and the whole budget) is not given a turn: it
waits in its lane's queue, is told its place, and runs when a holder ends; jobs behind it, of other requesters, pass
it. So no job sits in the read guard's own wait, and ends busy, because a longer job of its requester is running. A
requester with no job of its own running is admitted as before. While only its own requester's admissions hold a
job (another requester's alone would let it in), its wait has no time limit: at 100M cells one grouping with genes
runs for minutes, and a user's dependants must not fail as busy behind the user's own work. It is sent a queued frame
every ``OWN_WAIT_HEARTBEAT_S`` meanwhile, so a closed connection still ends it; the time limit applies again, for
what is left of it, as soon as another requester's holding is what keeps it waiting.

**A queued job is told at once (SHR-47).** A job that finds its lane taken gets a stream at once: a frame with its
``queue`` (``{"ahead", "sharing"}``), another whenever that changes, and either the work once its turn comes or, past
the route's wait, an ``error`` frame with reason ``read_busy`` (the status is already 200, so it cannot be a 503). A
job that finds its lane free and its memory free sends no such frame and behaves as before.

**Ledger (CMP-15).** One per worker (``LEDGER``), bounded by ``DEFAULT_LEDGER_BYTES`` unless built with another
bound. A reservation that does not fit waits, after every registered evictable (the code cache) was emptied, and
proceeds when a release makes room. A reservation over the bound is taken as the whole bound: it runs alone.
"""
import json
import math
import threading
import time
from collections import deque
from typing import Callable, Dict, Iterable, Iterator, Optional

import numpy as np
from flask import Response, jsonify, request

from ...core import read_guard

#: Bytes of a binary block written at once, so a closed connection is noticed between writes.
WRITE_CHUNK = 1 << 20
#: Light jobs a worker runs at once (SHR-41).
LIGHT_WIDTH = 2
#: The ledger's default bound per worker, the default of the server setting ``compute_budget_mb`` (4608 MiB, 4.5 GB;
#: CMP-15: the heavy slot 2.3 GB, one resolve 1.5 GB, the code cache 0.5 GB, jobs that have given way under 0.1 GB).
DEFAULT_LEDGER_BYTES = 4608 << 20
#: Seconds a reservation waits before it asks the evictables to empty again, when one stayed full.
_EVICT_RETRY_S = 0.05
#: Seconds between the queued frames of a job waiting, without a time limit, for its own requester's jobs: each frame
#: is a write, so a closed connection is noticed and the job leaves the queue.
OWN_WAIT_HEARTBEAT_S = 5.0
#: The lanes, in the words of the frames.
LANE_NAMES = ("light", "heavy")
#: The group code cache's size per worker, the server setting ``group_code_cache_mb`` (512 MiB by default). The cache
#: (core/group_cache.py, step E6b) reads it from here; it is counted inside the ledger's bound.
CODE_CACHE_BYTES = 512 << 20


class Busy(read_guard.ReadBusyError):
    """A lane or the ledger stayed taken for the whole wait. Before the stream began it is the route's ``503
    read_busy``; after, the ``read_busy`` error frame."""

    def __init__(self, message: str, wait_s: float):
        super().__init__(message, max(1, int(math.ceil(wait_s))))


# ---------------------------------------------------------------------------
# Body, refusals, frames and blocks
# ---------------------------------------------------------------------------

def error_response(status: int, reason: str, message: str, **extra):
    return jsonify({"error": message, "reason": reason, **extra}), status


def read_body(fields: Iterable[str], max_bytes: int, flags: Iterable[str] = ("estimate_only", "confirm")):
    """The request body as an object, or ``(None, (status, reason, message))``.

    A body over ``max_bytes`` is refused before it is parsed, a field not in ``fields`` is refused (so fields can be
    added later without ambiguity), and each of ``flags`` must be a boolean when present.
    """
    too_large = (413, "request_too_large", f"The request is over {max_bytes // 2 ** 20} MB.")
    declared = request.content_length
    if declared is not None and declared > max_bytes:
        return None, too_large
    raw = request.stream.read(max_bytes + 1)
    if len(raw) > max_bytes:
        return None, too_large
    try:
        body = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None, (400, "bad_request", "The body must be a JSON object.")
    if not isinstance(body, dict):
        return None, (400, "bad_request", "The body must be a JSON object.")
    unknown = sorted(set(body) - set(fields))
    if unknown:
        return None, (400, "bad_request", f"Unknown field(s): {', '.join(unknown)}.")
    for flag in flags:
        if not isinstance(body.get(flag, False), bool):
            return None, (400, "bad_request", f"{flag} must be true or false.")
    return body, None


def tier_refusal(tier: str, confirmed: bool, estimate: dict, *, too_expensive: str, refused_message: str,
                 confirm_message: str):
    """The plain-HTTP answer to a cost tier that may not run now, or None: ``refused`` is a ``413`` with the route's
    reason, ``confirm`` without ``confirm: true`` a ``409 confirmation_required``. Both carry the estimate."""
    if tier == "refused":
        return error_response(413, too_expensive, refused_message, estimate=estimate)
    if tier == "confirm" and not confirmed:
        return error_response(409, "confirmation_required", confirm_message, estimate=estimate)
    return None


def frame(obj) -> bytes:
    """One JSON line. NaN and infinity are refused: a frame carries only finite numbers or null."""
    return json.dumps(obj, separators=(",", ":"), allow_nan=False).encode("utf-8") + b"\n"


def busy_frame(exc: read_guard.ReadBusyError) -> dict:
    return {"type": "error", "reason": "read_busy", "message": str(exc)}


def block(name: str, array: np.ndarray) -> dict:
    """The ``blocks`` entry of a result frame for ``array``: its name, dtype and length, and its shape if not 1-D."""
    entry = {"name": name, "dtype": array.dtype.name, "length": int(array.size)}
    if array.ndim != 1:
        entry["shape"] = [int(n) for n in array.shape]
    return entry


def block_bytes(arrays: Iterable[np.ndarray]) -> Iterator[bytes]:
    """The bytes of each array, little-endian and C-ordered, one after another, in pieces of at most WRITE_CHUNK."""
    for array in arrays:
        little = np.ascontiguousarray(array, dtype=array.dtype.newbyteorder("<"))
        data = memoryview(little).cast("B")
        for start in range(0, len(data), WRITE_CHUNK):
            yield bytes(data[start:start + WRITE_CHUNK])


# ---------------------------------------------------------------------------
# The memory ledger
# ---------------------------------------------------------------------------

class Reservation:
    """Bytes held on a ledger until ``release``. ``resize`` shrinks at once and grows only as room allows."""

    def __init__(self, ledger: "Ledger", nbytes: int, what: str):
        self._ledger, self.nbytes, self.what = ledger, nbytes, what

    def resize(self, nbytes: int, wait_s: float = 0.0) -> None:
        self._ledger._resize(self, nbytes, wait_s)

    def release(self) -> None:
        self._ledger._resize(self, 0, 0.0)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.release()


class Ledger:
    """The memory a worker's computations hold at once (SHR-41, CMP-15).

    ``register_evictable(name, size, evict)`` enters something that can be emptied to make room (the code cache):
    ``size()`` is its bytes now and counts against the bound, ``evict()`` empties it. Both are called without the
    ledger's lock held, so they may take their own.
    """

    def __init__(self, bound: int = DEFAULT_LEDGER_BYTES, clock: Callable[[], float] = time.monotonic):
        if int(bound) <= 0:
            raise ValueError("The ledger's bound must be positive.")
        self.bound = int(bound)
        self._clock = clock
        self._cond = threading.Condition()
        self._held = 0
        self._evictables: Dict[str, tuple] = {}

    def register_evictable(self, name: str, size: Callable[[], int], evict: Callable[[], None]) -> None:
        with self._cond:
            self._evictables[name] = (size, evict)

    def held(self) -> int:
        """Bytes reserved now, the evictables left out."""
        with self._cond:
            return self._held

    def reserve(self, nbytes: int, wait_s: float, what: str) -> Reservation:
        """Hold ``nbytes`` (at most the bound), waiting up to ``wait_s`` for room; ``Busy`` when none came."""
        reservation = Reservation(self, 0, what)
        self._resize(reservation, nbytes, wait_s)
        return reservation

    def _evictable_bytes(self, evictables) -> int:
        return sum(int(size()) for size, _ in evictables)

    def _resize(self, reservation: Reservation, nbytes: int, wait_s: float) -> None:
        want = min(max(int(nbytes), 0), self.bound)
        deadline = self._clock() + max(wait_s, 0.0)
        emptied = False                       # the evictables were asked to empty once in this call
        with self._cond:
            while want > reservation.nbytes:
                evictables = list(self._evictables.values())
                self._cond.release()
                try:
                    cached = self._evictable_bytes(evictables)
                finally:
                    self._cond.acquire()
                if self._held - reservation.nbytes + want + cached <= self.bound:
                    break
                if cached and not emptied:
                    # asked once however little time is allowed; asked again only after a pause (below), so an
                    # evictable that stays full (pinned entries, a refill by another thread) ends in Busy at the
                    # deadline and is not asked in a spin
                    emptied = True
                    self._cond.release()
                    try:
                        for _, evict in evictables:
                            evict()
                    finally:
                        self._cond.acquire()
                    continue
                left = deadline - self._clock()
                if left <= 0:
                    raise Busy(f"The server is holding {self._held / 2 ** 30:.1f} GB of computations of the "
                               f"{self.bound / 2 ** 30:.1f} GB it may hold at once, and {reservation.what} needs "
                               f"{(want - reservation.nbytes) / 2 ** 30:.2f} GB more; try again in a moment.", wait_s)
                self._cond.wait(min(left, _EVICT_RETRY_S) if cached else (None if math.isinf(left) else left))
                emptied = False
            self._held += want - reservation.nbytes
            reservation.nbytes = want
            self._cond.notify_all()


# ---------------------------------------------------------------------------
# Lanes
# ---------------------------------------------------------------------------

class Job:
    """One computation in a lane, from ``Lanes.enter`` to ``leave``.

    It is the ``pause`` of ``gene_score.compute``: ``wanted()`` is true while a heavy job runs and another waits that
    may take its turn, except on its first call of a turn (the pipeline asks before each read, so a turn always reads
    at least one batch and two jobs cannot hand the lane back and forth without reading), and ``wait()`` gives the
    lane way (``Lanes.give_way``). ``running_s()`` counts the time the job has held its lane, its
    waits and turns given away left out (SHR-48).
    """

    def __init__(self, lanes: "Lanes", lane: str, full_bytes: int, keep_bytes: int, admit_bytes: int = 0,
                 owner: Optional[str] = None):
        self._lanes, self.lane = lanes, lane
        self.admit_bytes = admit_bytes   # the read-guard admission it holds from its first turn until it ends
        self.owner = owner               # whose share of the read budget that is (read_guard.current_requester)
        self.state = "waiting"           # waiting (never ran), running, yielded (gave way), done
        self.started = False
        self._fresh = False              # a turn has begun and has not yet been asked to give way
        self._ran = 0.0
        self._since: Optional[float] = None
        self.reservation: Optional[Reservation] = None
        self.full_bytes = full_bytes     # the job's reservation while it runs
        self.keep_bytes = keep_bytes     # what the reservation shrinks to while the job has given way
        self.wait_s = 0.0                # how long the reservation may wait to grow back
        self.excused_s = 0.0             # time queued behind its own requester alone, outside the queue's limit

    @property
    def running(self) -> bool:
        return self.state == "running"

    def hold(self, reservation: Reservation, wait_s: float) -> None:
        """The job's memory: shrunk to ``keep_bytes`` while it gives way, and grown back when its turn returns.
        ``wait_s`` is how long the first reservation may wait; the growing back waits for as long as it takes."""
        self.reservation, self.wait_s = reservation, wait_s

    def running_s(self) -> float:
        return self._lanes.running_s(self)

    def queue(self) -> dict:
        return self._lanes.queue_of(self)

    def wanted(self) -> bool:
        return self._lanes.wanted(self)

    def wait(self) -> None:
        self._lanes.give_way(self)

    def leave(self) -> None:
        self._lanes.leave(self)


class Lanes:
    """The light and heavy lanes of one worker process (SHR-41)."""

    def __init__(self, light_width: int = LIGHT_WIDTH, clock: Callable[[], float] = time.monotonic,
                 ledger: Optional["Ledger"] = None):
        self._clock, self._ledger = clock, ledger
        self._cond = threading.Condition()
        self._width = {"light": int(light_width), "heavy": 1}
        self._running = {lane: [] for lane in LANE_NAMES}
        self._waiting = {lane: deque() for lane in LANE_NAMES}

    def enter(self, lane: str, full_bytes: int = 0, keep_bytes: int = 0, admit_bytes: int = 0,
              owner: Optional[str] = None) -> Job:
        """A new job, running at once when its lane has room and nobody waits, else at the back of the queue.
        ``full_bytes`` is the reservation it will hold while it runs, ``keep_bytes`` while it has given way;
        ``admit_bytes`` the read-guard admission it will take for ``owner`` (its requester)."""
        if lane not in self._width:
            raise ValueError(f"lane must be one of {', '.join(LANE_NAMES)}")
        full = max(int(full_bytes), 0)
        if self._ledger is not None:
            full = min(full, self._ledger.bound)
        admit = min(max(int(admit_bytes), 0), read_guard.budget_bytes())
        job = Job(self, lane, full, min(max(int(keep_bytes), 0), full), admit, owner)
        with self._cond:
            self._waiting[lane].append(job)
            self._promote(lane)
        return job

    def leave(self, job: Job) -> None:
        """The job is over (finished, failed or cancelled, also while queued); the next one in its lane may start."""
        with self._cond:
            if job.state == "done":
                return
            if job in self._running[job.lane]:
                self._stop_clock(job)
                self._running[job.lane].remove(job)
            else:
                self._waiting[job.lane].remove(job)
            job.state = "done"
            for lane in LANE_NAMES:              # its admission may have held a job of either lane
                self._promote(lane)

    def wait_turn(self, job: Job, deadline: float, last: Optional[dict], wait_s: float) -> Optional[dict]:
        """Wait until the job runs (None) or its queue differs from ``last`` (the new queue). ``Busy`` at the
        ``deadline`` (on this lanes' clock; ``wait_s`` is the whole wait, for the retry hint); the job stays queued
        until it leaves."""
        with self._cond:
            while True:
                if job.state == "running":
                    return None
                queue = self._queue_of(job)
                if queue != last:
                    return queue
                if self._held_by_own(job):
                    since = self._clock()
                    self._cond.wait(OWN_WAIT_HEARTBEAT_S)
                    job.excused_s += self._clock() - since
                    if job.state != "running" and self._queue_of(job) == last:
                        return queue                   # a heartbeat: the place again, so a closed stream is seen
                    continue
                left = deadline + job.excused_s - self._clock()
                if left <= 0:
                    raise Busy("Other computations are using the server; try again in a moment.", wait_s)
                self._cond.wait(None if math.isinf(left) else left)

    def give_way(self, job: Job) -> None:
        """Inside a heavy job, between read batches: when another job waits, shrink the job's reservation to its
        accumulators, give the lane to the next job, rejoin the queue and wait for the turn to come back, then grow
        the reservation again. Nothing happens when nobody waits."""
        with self._cond:
            if job.state != "running" or self._next(job.lane) is None:
                return
        if job.reservation is not None:
            job.reservation.resize(job.keep_bytes)
        with self._cond:
            self._stop_clock(job)
            self._running[job.lane].remove(job)
            job.state = "yielded"
            self._waiting[job.lane].append(job)
            self._promote(job.lane)
            while job.state == "yielded":
                self._cond.wait()
            if job.state == "done":                  # left while it waited: nothing to grow back
                return
        if job.reservation is not None:
            # The job has run, perhaps for minutes: it waits for room as long as it takes (the light lane's
            # reservations are finite and the others hold only their accumulators), and is never told it is busy.
            job.reservation.resize(job.full_bytes, math.inf)

    def wanted(self, job: Job) -> bool:
        """Whether a running heavy job should give way now: another job waits that may take its turn."""
        with self._cond:
            if job.state != "running":
                return False
            if job._fresh:
                job._fresh = False
                return False
            return job.lane == "heavy" and bool(self._waiting[job.lane]) and self._next(job.lane) is not None

    def _next(self, lane: str) -> Optional[Job]:
        """The waiting job that takes the next turn: the first that has run before, or the first new job whose
        admission may be taken (``_admissible``) if it fits beside the turns (``_fits``); such new jobs never pass
        each other. None when no job may take a turn."""
        new_seen = False
        turns = None
        admitted = None
        for job in self._waiting[lane]:
            if job.started:
                return job
            if not new_seen:
                if admitted is None:
                    admitted = self._admitted()
                if not self._admissible(job, admitted):
                    continue                     # held by its requester's own jobs: the next may pass it
                new_seen = True
                if turns is None:
                    turns = [j for j in self._running[lane] + list(self._waiting[lane]) if j.started]
                if self._fits(job, turns):
                    return job
        return None

    def _admitted(self) -> tuple:
        """``(bytes, bytes by requester)`` of the read-guard admissions the jobs that have run hold now."""
        total, by_owner = 0, {}
        for lane in LANE_NAMES:
            for j in self._running[lane] + list(self._waiting[lane]):
                if j.started and j.admit_bytes:
                    total += j.admit_bytes
                    if j.owner is not None:
                        by_owner[j.owner] = by_owner.get(j.owner, 0) + j.admit_bytes
        return total, by_owner

    @staticmethod
    def _admissible(job: Job, admitted: tuple) -> bool:
        """Whether a new job's admission fits now beside those held: the read guard's budget, and its requester's
        share when the requester holds some already (as ``read_guard.admit`` decides)."""
        if job.started or not job.admit_bytes:
            return True
        total, by_owner = admitted
        if total and total + job.admit_bytes > read_guard.budget_bytes():
            return False
        mine = by_owner.get(job.owner, 0) if job.owner is not None else 0
        return not (mine and mine + job.admit_bytes > read_guard.share_bytes())

    def _held_by_own(self, job: Job) -> bool:
        """Whether a queued job is kept out only by its own requester's admissions: it does not fit now, and would
        beside the other requesters' holdings alone."""
        if job.started or not job.admit_bytes or job.owner is None:
            return False
        admitted = self._admitted()
        if self._admissible(job, admitted):
            return False
        total, by_owner = admitted
        mine = by_owner.get(job.owner, 0)
        others = total - mine
        return bool(mine) and not (others and others + job.admit_bytes > read_guard.budget_bytes())

    def _first_admissible(self, lane: str) -> Optional[Job]:
        admitted = self._admitted()
        return next((j for j in self._waiting[lane] if self._admissible(j, admitted)), None)

    def _fits(self, job: Job, turns) -> bool:
        """Whether the jobs taking turns, with ``job`` among them, can each grow back to its whole reservation while
        the others hold their accumulators."""
        if self._ledger is None or not turns:
            return True
        keeps = sum(j.keep_bytes for j in turns) + job.keep_bytes
        regrow = max(max(j.full_bytes - j.keep_bytes for j in turns), job.full_bytes - job.keep_bytes)
        return keeps + regrow <= self._ledger.bound

    def queue_of(self, job: Job) -> dict:
        with self._cond:
            return self._queue_of(job)

    def running_s(self, job: Job) -> float:
        with self._cond:
            return job._ran + (self._clock() - job._since if job._since is not None else 0.0)

    def _queue_of(self, job: Job) -> dict:
        """``ahead``: for a job that never ran, the jobs running in its lane and those queued before it; ``sharing``:
        for a job that has run, the other jobs of its lane that have run and are not over (SHR-47)."""
        running, waiting = self._running[job.lane], self._waiting[job.lane]
        if job.started:
            others = sum(1 for j in running if j.started and j is not job) + \
                     sum(1 for j in waiting if j.started and j is not job)
            return {"ahead": 0, "sharing": others}
        ahead = len(running)
        for other in waiting:
            if other is job:
                break
            ahead += 1
        return {"ahead": ahead, "sharing": 0}

    def _promote(self, lane: str) -> None:
        running, waiting = self._running[lane], self._waiting[lane]
        while waiting and len(running) < self._width[lane]:
            job = ((self._next(lane) if lane == "heavy" else None) or self._first_admissible(lane))
            if job is None:
                break                            # every waiting job waits for an admission to be given back
            waiting.remove(job)
            job.state, job.started, job._since, job._fresh = "running", True, self._clock(), True
            running.append(job)
        self._cond.notify_all()

    def _stop_clock(self, job: Job) -> None:
        if job._since is not None:
            job._ran += self._clock() - job._since
            job._since = None

    def now(self) -> float:
        return self._clock()

    def holder(self, lane: str) -> "Holder":
        return Holder(self, lane)


class Holder:
    """A lane held like a semaphore, by something that is not a computation and never gives way: ``acquire``
    queues like a job and waits for its turn, ``release`` lets the lane go (``ValueError`` if nothing is held)."""

    def __init__(self, lanes: Lanes, lane: str):
        self._lanes, self._lane = lanes, lane
        self._held: deque = deque()
        self._lock = threading.Lock()

    def acquire(self, blocking: bool = True, timeout: Optional[float] = None) -> bool:
        job = self._lanes.enter(self._lane)
        if not job.running and blocking:
            wait_s = math.inf if timeout is None else max(timeout, 0.0)
            deadline = self._lanes.now() + wait_s
            last = None
            try:
                while (last := self._lanes.wait_turn(job, deadline, last, wait_s)) is not None:
                    pass
            except Busy:
                pass
        if not job.running:
            job.leave()
            return False
        with self._lock:
            self._held.append(job)
        return True

    def release(self) -> None:
        with self._lock:
            if not self._held:
                raise ValueError("The lane is not held.")
            job = self._held.popleft()
        job.leave()


#: The ledger and the lanes of this worker process.
LEDGER = Ledger()
LANES = Lanes(ledger=LEDGER)


def _megabytes(value, default: int) -> int:
    """``value`` megabytes as bytes; the default for anything that is not a positive number."""
    try:
        mb = float(value)
    except (TypeError, ValueError):
        return default
    return int(mb * 2 ** 20) if math.isfinite(mb) and mb > 0 else default


def configure(compute_budget_mb=None, group_code_cache_mb=None) -> None:
    """Read the server settings ``compute_budget_mb`` and ``group_code_cache_mb`` (when the server starts).

    The ledger and the lanes of this worker stay the same objects: the lanes' fit test reads the ledger's bound. A
    value that is not a positive number leaves the default.
    """
    global CODE_CACHE_BYTES
    with LEDGER._cond:
        LEDGER.bound = _megabytes(compute_budget_mb, DEFAULT_LEDGER_BYTES)
        LEDGER._cond.notify_all()
    CODE_CACHE_BYTES = _megabytes(group_code_cache_mb, 512 << 20)


# ---------------------------------------------------------------------------
# A computation's reply
# ---------------------------------------------------------------------------

def progress_fields(job: Job, entries_done: int, entries_total: int) -> dict:
    """What every progress frame carries (SHR-47, SHR-48): stored entries done and in all, the seconds the job has
    held its lane, and its place in the queue."""
    return {"entries_done": int(entries_done), "entries_total": int(entries_total),
            "running_s": round(job.running_s(), 3), "queue": job.queue()}


def respond(lane: str, *, nbytes: int, keep_bytes: int, what: str, wait_s: float,
            admit: Callable[[], Callable[[], None]], work: Callable[[Job], Iterator[bytes]],
            queued_frame: Callable[[Job], dict], mimetype: str, headers: Optional[Dict[str, str]] = None,
            lanes: Optional[Lanes] = None, ledger: Optional[Ledger] = None,
            admit_bytes: Optional[int] = None, on_release: Optional[Callable[[], None]] = None) -> Response:
    """The streamed reply of one computation in ``lane``.

    ``nbytes`` is reserved on the ledger for the job (``keep_bytes`` of it while the job has given way, ``what``
    names it in a refusal); ``admit()`` takes any other admission (the read guard) and returns its release; ``work(job)``
    gives the bytes of the reply (frames and blocks) and turns its own failures into an error frame; ``admit_bytes``
    is what ``admit()`` takes of the read guard's budget (None: ``nbytes``; 0: nothing), entered in the lanes' fit;
    ``on_release()`` is called with the other releases, once, however the stream ends (the code cache's unpin);
    ``queued_frame(job)`` is the frame a waiting job is sent at once and whenever its queue changes.

    A job whose lane and memory are free at once streams ``work`` as it is, and a refusal of ``admit()`` is raised
    (the route's ``503``). Otherwise the stream starts with ``queued_frame``; a wait past ``wait_s`` (the lane and
    the ledger together) ends in the ``read_busy`` error frame. The lane, the reservation and the admission are given
    back exactly once, when the stream ends, fails or is closed, also when it never started.
    """
    lanes = LANES if lanes is None else lanes
    ledger = LEDGER if ledger is None else ledger
    job = lanes.enter(lane, nbytes, keep_bytes, nbytes if admit_bytes is None else admit_bytes,
                      read_guard.current_requester())
    releases = [job.leave] if on_release is None else [on_release, job.leave]
    released = []

    def release():
        if released:
            return
        released.append(True)
        while releases:
            releases.pop()()

    def take_memory(wait):
        reservation = ledger.reserve(nbytes, wait, what)
        releases.append(reservation.release)
        job.hold(reservation, wait_s)
        try:
            releases.append(admit())
        except Busy:
            raise
        except read_guard.ReadBusyError as exc:       # the guard's words are about pairwise reads: say it in ours
            raise read_guard.ReadBusyError(
                f"Other reads hold the server's read budget, and {what} could wait for them no longer; "
                "try again in a moment.", exc.retry_after_s) from exc

    ready = False
    if job.running:
        try:
            take_memory(0.0)
            ready = True
        except Busy:
            pass                                    # the memory is taken: wait for it in the stream
        except BaseException:
            release()
            raise

    def waited():
        deadline = lanes.now() + wait_s
        told = queued_frame(job)
        try:
            while True:
                yield frame(told)
                # compared with the place told, not the place when the reader comes back for more
                if lanes.wait_turn(job, deadline, told["queue"], wait_s) is None:
                    break
                told = queued_frame(job)
            take_memory(max(deadline + job.excused_s - lanes.now(), 0.0))
        except read_guard.ReadBusyError as exc:
            yield frame(busy_frame(exc))
            return
        yield from work(job)

    def body():
        try:
            yield from (work(job) if ready else waited())
        finally:
            release()

    response = Response(body(), mimetype=mimetype)
    response.call_on_close(release)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Accel-Buffering"] = "no"
    for key, value in (headers or {}).items():
        response.headers[key] = value
    return response
