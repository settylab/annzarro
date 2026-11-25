"""The ``genes`` shape of ``POST /api/v1/data/cell_groups`` (SO-8a): the moments of every gene over one group of cells,
so a Gene Plot can be coloured by a statistic of a group (offered-removal-080 section 10.1).

The cells are one group of a grouping::

    {"shape": "genes", "partitionings": [...], "group": ["c:B cell"], "layer": "logged", "thresholds": [0]}

(``group`` is the group's key as the grouping's ``groups`` list gives it, as a list of ids or its canonical JSON), or
the cells of a table's bitset, as a grouping's table factor sends it::

    {"shape": "genes", "sets": {"t": {"encoding": "bitset-base64", ...}}, "member": "t", "layer": "X"}

``small`` and ``subset`` are the grouping's; ``estimate_only`` and ``confirm`` the route's. ``layer`` is ``X`` or a
layer (default ``X``); ``thresholds`` are one to ``limits.thresholds`` distinct finite numbers (default ``[0]``), the
"expressed above" values the group's ``n_above`` and ``sum_above`` are taken at.

The reply is the moments of ``group_features.MOMENTS``, ``n, sum, sumsq, n_above, sum_above``, over the cells of the
group with a finite value, for every gene: one float64 block ``moments`` of shape ``[n_var, 5 * len(thresholds)]``,
threshold-major (column ``5 * t + m`` is moment ``m`` at ``thresholds[t]``; the first three do not depend on ``t``).
Statistics come from the moments in the browser, as for the Cell-Gene plot, so a change of statistic costs no request.

**Reads.** ``gene_score._Source.row_moments``: a CSR matrix reads only the stored ranges of the group's rows, a CSC
matrix every gene, a dense array the row chunks that hold a cell of the group. Memory is the mask (a byte a cell), the
read-ahead and ``n_var * (4 + 2 * thresholds)`` float64.

**Cost.** :func:`coverage` counts the stored entries of the *data chunks* the rows touch (a group scattered over the
dataset touches every chunk: the whole layer), from the row pointers and the chunk size, before anything is read. A
grouping whose codes the worker does not hold yet is resolved when the job runs; until then the estimate is the whole
layer (``coverage.known`` false), and the tier of the exact figure is applied then, in the stream.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple

import numpy as np

from . import cell_groups as cg
from . import cost_limits
from . import gene_score as gs
from . import group_features as gf
from .remote import is_remote_path

ALGORITHM_VERSION = 1
SHAPE = "genes"

#: Every field the shape takes (the route's body reader refuses any other).
BODY_FIELDS = ("shape", "partitionings", "small", "group", "sets", "member", "layer", "thresholds", "subset",
               "estimate_only", "confirm", "force", "transform", "clip")

#: The moments, as a grouping's features have them.
MOMENTS = gf.MOMENTS
#: Entries read ahead of the arithmetic: a grouping's features'.
READ_AHEAD_ENTRIES = gs.MOMENT_READ_AHEAD_ENTRIES

#: The cost tiers are the score engine's, from the limits in force (``gene_score.tier_of``, ``tier_limits``): asked first
#: above ``limits.ask_first_s``, refused above ``limits.refuse_s``, light lane up to ``limits.live_update_s``. The most
#: thresholds a request is compared with is ``limits.thresholds``.


def _bad(message: str, reason: str = "bad_request", **extra) -> cg.GroupError:
    return cg.GroupError(400, reason, message, **extra)


# --------------------------------------------------------------------------------------------------------------
# The request
# --------------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Request:
    grouping: Optional[cg.Request]              # the grouping the group is of (None: a table's cells)
    group: Optional[Tuple[str, ...]]            # the group's key
    sets: Dict[str, np.ndarray]                 # ref -> bool per cell shown
    member: Optional[str]                       # the set whose cells are the group
    layer: str
    thresholds: Tuple[float, ...]
    subset: Any = None
    estimate_only: bool = False
    confirm: bool = False
    transform: Optional[str] = None             # None, or "zscore": the moments of each gene's z-score (G1a)
    clip: Optional[float] = None


def _group_key(raw: Any) -> Tuple[str, ...]:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raise _bad("group must be a group key: a list of ids or its JSON.", "bad_group") from None
    if not isinstance(raw, list) or not raw or not all(isinstance(i, str) for i in raw):
        raise _bad("group must be a group key: a non-empty list of ids.", "bad_group")
    return tuple(raw)


def _thresholds(raw: Any) -> Tuple[float, ...]:
    if raw is None:
        return (0.0,)
    ok = isinstance(raw, list) and raw and all(isinstance(t, (int, float)) and not isinstance(t, bool)
                                               and math.isfinite(float(t)) for t in raw)
    if not ok:
        raise _bad("thresholds must be a list of finite numbers.", "bad_threshold")
    values = tuple(float(t) for t in raw)
    if len(set(values)) != len(values):
        raise _bad("thresholds must be distinct.", "bad_threshold")
    most = cost_limits.get("thresholds")
    if len(values) > most:
        raise cg.GroupError(422, "too_many_thresholds", f"A request is compared with at most {most} "
                            f"thresholds; this one has {len(values)}.", count=len(values), limit=most)
    return values


def parse_request(body: Any) -> Request:
    """Validate a ``genes`` request body. Refusals are ``cell_groups.GroupError`` (400 unless stated)."""
    if not isinstance(body, dict):
        raise _bad("The body must be a JSON object.")
    cg._unknown(body, BODY_FIELDS, "the request")
    if body.get("shape") != SHAPE:
        raise _bad("This parser takes the genes shape.", "bad_shape")
    layer = body.get("layer", "X")
    if not isinstance(layer, str) or not layer:
        raise _bad("layer must be the name of a matrix: X or a layer.")
    raw_sets = body.get("sets") or {}
    if not isinstance(raw_sets, dict):
        raise _bad("sets must be an object.")
    group, member = body.get("group"), body.get("member")
    if (group is None) == (member is None):
        raise _bad("A genes request names its cells by either a group (with partitionings) or a member (with sets).")
    thresholds = _thresholds(body.get("thresholds"))
    transform, clip = None, None
    if "transform" in body:
        if body["transform"] != "zscore":
            raise _bad("transform is 'zscore'.", "bad_feature")
        transform = "zscore"
        clip = gs.parse_clip(body["clip"]) if "clip" in body else gs.DEFAULT_CLIP
    elif "clip" in body:
        raise _bad("clip belongs to a transform.", "bad_feature")
    if member is not None:
        if body.get("partitionings") is not None or body.get("small") is not None:
            raise _bad("A member names a set; partitionings and small belong with a group.")
        if not isinstance(member, str) or member not in raw_sets:
            raise _bad(f"The request has no set '{member}'.", "set_missing")
        sets = {str(ref): cg.decode_set(str(ref), raw) for ref, raw in raw_sets.items()}
        return Request(None, None, sets, member, layer, thresholds, body.get("subset"),
                       cg._flag(body, "estimate_only"), cg._flag(body, "confirm"), transform, clip)
    key = _group_key(group)
    grouping = cg.parse_request({"shape": "grouping", "partitionings": body.get("partitionings"),
                                 "small": body.get("small"), "sets": raw_sets, "subset": body.get("subset")})
    return Request(grouping, key, grouping.sets, None, layer, thresholds, body.get("subset"),
                   cg._flag(body, "estimate_only"), cg._flag(body, "confirm"), transform, clip)


# --------------------------------------------------------------------------------------------------------------
# The plan
# --------------------------------------------------------------------------------------------------------------


@dataclass
class Plan:
    """What a request means for one store, before any column is read: the matrix and the grouping's plan."""
    reader: Any
    dataset_path: str
    request: Request
    groups: Optional[cg.Plan]                   # the grouping's plan (None for a table's cells)
    n_cells: int
    n_var: int
    layout: str
    layer_entries: int                          # stored entries (elements of a dense array) of the whole matrix
    remote: bool

    @property
    def cache_key(self) -> Optional[str]:
        return None if self.groups is None else self.groups.cache_key


def plan(reader, dataset_path: str, request: Request) -> Plan:
    """Resolve the layer against the store and plan the grouping. Reads no column. ``ScoreError`` 404 when the store
    has no such layer."""
    remote = is_remote_path(dataset_path)
    with gs.open_source(reader, dataset_path, request.layer) as source:
        n_obs, n_var, layout = source.n_obs, source.n_var, source.layout
        entries = int(source.nnz) if layout == "csr" else int(source.indptr[-1]) if layout == "csc" else n_obs * n_var
    if request.transform and layout != "csc":
        raise gs.ZscoreNeedsPass(layout)
    groups = None if request.grouping is None else cg.plan(reader, dataset_path, request.grouping)
    return Plan(reader, dataset_path, request, groups, n_obs, n_var, layout, entries, remote)


# --------------------------------------------------------------------------------------------------------------
# The cells
# --------------------------------------------------------------------------------------------------------------


def mask_of(plan_: Plan, rows: Optional[np.ndarray], grouping: Optional[cg.GroupingResult]) -> np.ndarray:
    """The group's cells as a bool per cell of the dataset. ``rows``: the dataset rows shown (None: every cell);
    ``grouping``: the resolved grouping (None for a table's cells). 422 ``group_missing`` when the grouping has no
    such group."""
    request = plan_.request
    if request.member is not None:
        shown = request.sets[request.member]
    else:
        keys = [tuple(g["key"]) for g in grouping.groups]
        if request.group not in keys:
            raise cg.GroupError(422, "group_missing", "The grouping has no such group.", group=list(request.group))
        shown = grouping.codes == keys.index(request.group)
    if rows is None:
        if shown.size != plan_.n_cells:
            raise cg.GroupError(400, "set_length_mismatch", f"The set has {shown.size} cells; the dataset has "
                                f"{plan_.n_cells}.", count=int(shown.size), shown=plan_.n_cells)
        return np.ascontiguousarray(shown, dtype=bool)
    mask = np.zeros(plan_.n_cells, dtype=bool)
    mask[np.asarray(rows, dtype=np.int64)[shown]] = True
    return mask


def coverage(plan_: Plan, mask: Optional[np.ndarray]) -> Dict[str, Any]:
    """``{"entries", "layer_entries", "fraction", "known", "n_group"}``: the stored entries of the data chunks the
    group's rows touch. Without a mask (a grouping not yet resolved) the whole layer, ``known`` false."""
    if mask is None:
        return {"entries": plan_.layer_entries, "layer_entries": plan_.layer_entries, "fraction": 1.0,
                "known": False, "n_group": None}
    with gs.open_source(plan_.reader, plan_.dataset_path, plan_.request.layer) as source:
        entries = int(source.row_coverage(mask))
    return {"entries": entries, "layer_entries": plan_.layer_entries,
            "fraction": entries / max(plan_.layer_entries, 1), "known": True, "n_group": int(np.count_nonzero(mask))}


def estimate(plan_: Plan, cover: Dict[str, Any], *, resolve: bool = False) -> Dict[str, Any]:
    """The estimate, shaped as the other shapes' (``seconds``, ``tier``, the limits, ``entries``, ``layout``,
    ``n_cells``, ``lane``) with ``coverage`` added. ``resolve``: the grouping is still to be resolved, which is
    added to the seconds and keeps the lane heavy unless it is live."""
    seconds = gs.estimate_seconds(plan_.layout, cover["entries"], plan_.remote)
    if resolve and plan_.groups is not None:
        seconds += max(plan_.groups.seconds - gs.BASE_SECONDS, 0.0)
    whole = cover["entries"] >= plan_.layer_entries and plan_.layer_entries > 0
    live = seconds <= gs.live_max_s() and not whole
    light = live and (plan_.groups is None or not resolve or plan_.groups.lane == "light")
    return {"seconds": round(seconds, 2), "tier": gs.tier_of(seconds), **gs.tier_limits(), "try": gs.try_info(seconds), "entries": cover["entries"], "layout": plan_.layout,
            "n_cells": plan_.n_cells, "lane": "light" if light else "heavy", "coverage": cover,
            "n_var": plan_.n_var}


# --------------------------------------------------------------------------------------------------------------
# Computing
# --------------------------------------------------------------------------------------------------------------


@dataclass
class Result:
    """The moments of every gene over the group."""
    n_cells: int                                # cells shown (the grouping's or the set's)
    n_group: int
    thresholds: Tuple[float, ...]
    moments: np.ndarray                         # float64 [n_var, thresholds, 5]
    group: Optional[Tuple[str, ...]] = None

    def to_reply(self) -> Tuple[Dict[str, Any], List[Tuple[str, np.ndarray]]]:
        """The ``result`` frame and its one block: ``moments``, float64 ``[n_var, 5 * thresholds]``."""
        flat = np.ascontiguousarray(self.moments.reshape(self.moments.shape[0], -1))
        head = {"type": "result", "version": ALGORITHM_VERSION, "shape": SHAPE, "n_shown": self.n_cells,
                "n_group": self.n_group, "n_var": int(flat.shape[0]), "moments": list(MOMENTS),
                "thresholds": list(self.thresholds), "group": None if self.group is None else list(self.group),
                "blocks": [{"name": "moments", "dtype": "float64", "shape": [int(n) for n in flat.shape]}]}
        return head, [("moments", flat)]


def compute(plan_: Plan, mask: np.ndarray, *, should_stop: Optional[Callable[[], bool]] = None, pause=None,
            n_shown: Optional[int] = None, entries_total: Optional[int] = None) -> Iterator[Tuple[str, Any]]:
    """The moments of every gene over the cells of ``mask`` (a bool per cell of the dataset).

    Yields ``("progress", {"stage": "genes", "done": entries read, "total": entries_total})`` after each read, and a
    final ``("result", Result)``. Stops (``ScoreCancelled``) when ``should_stop`` is true between reads; ``pause`` is
    honoured between reads. A read never holds more than ``READ_AHEAD_ENTRIES`` entries ahead. ``n_shown``: the cells
    shown (default every cell of the dataset), reported in the result.
    """
    request = plan_.request
    total = int(entries_total if entries_total is not None else coverage(plan_, mask)["entries"])
    done = 0
    yield "progress", {"stage": "genes", "done": 0, "total": total}
    with gs.open_source(plan_.reader, plan_.dataset_path, request.layer) as source:
        if request.transform:
            steps = source.row_zscore_moments(mask, request.clip, should_stop, pause, budget=READ_AHEAD_ENTRIES)
        else:
            steps = source.row_moments(mask, request.thresholds, should_stop, pause, budget=READ_AHEAD_ENTRIES)
        while True:
            try:
                done += next(steps)
            except StopIteration as stop:
                moments = stop.value
                break
            yield "progress", {"stage": "genes", "done": done, "total": total}
    if request.transform:                       # [n_var, 5] -> [n_var, thresholds, 5]: a z-score has no threshold here
        moments = np.repeat(moments[:, None, :], len(request.thresholds), axis=1)
    yield "result", Result(n_cells=plan_.n_cells if n_shown is None else int(n_shown), n_group=int(np.count_nonzero(mask)),
                           thresholds=request.thresholds, moments=moments, group=request.group)

