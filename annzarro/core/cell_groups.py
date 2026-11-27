"""The grouping shape: partitionings of the cells shown, resolved into groups (SHR-1 to SHR-13, SHR-28).

A *partitioning* gives every cell shown one *level* (a category, a bin, in or out of a table, a group of another
grouping); a *grouping* is a list of partitionings, and its *groups* are the combinations of one level per
partitioning that hold at least one cell. This module turns a request into those groups: the group table (keys in
SHR-10 order, cell counts), one code per cell shown, and what each partitioning made (levels, edges, counts).
Features and measures per group are ``core/group_features.py``; the dense grid of the count plot is
``core/cell_grid.py``. Both read the partitionings through this module.

Level ids are typed (plan 1.6): ``c:<canonical text>`` for a category (:func:`canonical_label`), ``bin:<i>``, and
the reserved ``@zero``, ``@in``, ``@out``, ``@other``, ``@na``; a level of a grouping used as a source is
``g:<canonical JSON of its key>`` (:func:`group_key_json`). A group's key is the list of its level ids, one per
partitioning, except the collected small group, whose key is ``["@small"]``.

Memory (CMP-4), per cell shown unless said. Codes are worked on in place, 2 B a cell (``uint16``; 4 B while an
intermediate intersection has more than 65,534 combinations, with the 2 B codes alive while they are widened). A fold
whose code space reaches 65,535 also holds its partitioning's slots, 1 B a cell (2 B past 254 slots). A source
column is held once, in its stored type, while its edges are found and its cells assigned (every cell's when the
edges come from all cells); the exact select adds at most 192 MB (one batch and its sort buffer). A score source
adds its values (4 B a cell) to the score's own memory while it runs; a grouping source adds what its own resolve
holds while it runs, then its codes (1 or 2 B a cell) until it is folded. Narrowing the final codes to ``uint8``
adds 1 B a cell. Slab and span temporaries stay near 128 MB. At 100M cells and a float64 column: 0.2 GB of codes,
0.8 GB of column, 0.1 GB of slots and 0.3 GB of temporaries, about 1.4 GB. What a source reads with
(``core/cell_sources.py``) comes on top.

The wire (what ``parse_request`` takes), per partitioning ``{source, binning?, levels?, rest?, member?}``:

* ``source`` is the setting a cell plot uses: ``obs`` (``key``; the obs index member's own name gives the cell
  names), ``obsm`` / ``layer`` / ``obsp`` (``key``, ``column``), ``table`` (``ref`` into ``sets``),
  ``gene-score`` (``column`` the method, ``layer`` the input, and ``recipe``, the score route's recipe) and
  ``cell-group`` (``recipe``: ``{partitionings, small?}``, the upstream grouping inline). The server cannot see a
  panel's recipe by its id, so the ``key`` of the last three is accepted and not used.
* ``sets`` maps a ref to ``{"encoding": "bitset-base64", "length": n, "data": ...}``: cell ``i`` of the cells shown
  is bit ``i & 7`` (least significant first) of byte ``i >> 3``; bits past ``length`` are 0.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import math
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterator, List, Optional, Sequence, Tuple

import numpy as np

from . import binning as bn
from . import cell_sources as cs
from . import cost_limits
from . import gene_score as gs
from .remote import is_remote_path

ALGORITHM_VERSION = 1

#: The group limit (operator decision P1): the most levels a partitioning may make and the most groups a grouping
#: may have. These are the defaults of limits.groups and limits.partitionings; ``grouping_limits()`` names the values
#: in force (the request's, annzarro/core/cost_limits.py).
GROUP_LIMIT = cost_limits.COST_LIMITS["groups"].default
GROUPING_LIMITS = dict(partitionings=cost_limits.COST_LIMITS["partitionings"].default, levels=GROUP_LIMIT,
                       groups=GROUP_LIMIT)


def grouping_limits() -> Dict[str, int]:
    """The grouping limits in force: partitionings per grouping, levels per partitioning, groups per grouping."""
    groups = cost_limits.get("groups")
    return dict(partitionings=cost_limits.get("partitionings"), levels=groups, groups=groups)

SMALL_THRESHOLD = 10
SMALL_MODES = ("keep", "collect", "hide")
SMALL_KEY = "@small"
#: A grouping used as a partitioning source may itself use one, this deep.
MAX_NESTING = 4

#: Seconds per million cells and partitioning for the resolve (CMP-1).
RESOLVE_SECONDS_PER_MCELL = 0.012

SHAPES = ("grouping", "grid", "genes")
_BODY_FIELDS = ("shape", "partitionings", "sets", "small", "subset", "features", "measures", "want",
                "estimate_only", "confirm")
_PART_FIELDS = ("source", "binning", "levels", "rest", "member")
_SOURCE_FIELDS = {
    "obs": ("type", "key"),
    "obsm": ("type", "key", "column"),
    "layer": ("type", "key", "column"),
    "obsp": ("type", "key", "column"),
    "table": ("type", "ref", "key"),
    "gene-score": ("type", "key", "column", "layer", "recipe"),
    "cell-group": ("type", "key", "recipe"),
}
_WANT_FIELDS = ("codes", "histograms")
_OPS = {">": np.greater, ">=": np.greater_equal, "<": np.less, "<=": np.less_equal}

#: Codes: the value of a cell in no group.
NONE16 = 0xFFFF
NONE32 = 0xFFFFFFFF
#: Level slabs with ``allow_exclude`` (a count plot's axis): a cell outside the range, below or above it. In no
#: level, like ``NONE16``, but told apart so the grid can say which axis left it out.
OUT_BELOW = 0xFFFE
OUT_ABOVE = 0xFFFD
#: An intersection whose combinations number less than this is folded into the uint16 codes in place.
_NARROW_MAX = NONE16
#: Combinations up to which the occupied ones are marked in a table; beyond, they are collected sorted.
_TABLE_MAX = 1 << 26


class GroupError(gs.ScoreError):
    """A request the engine refuses before computing: ``status``, a stable ``reason``, and extra fields."""


# --------------------------------------------------------------------------------------------------------------
# Ids
# --------------------------------------------------------------------------------------------------------------


def _shortest(text: str) -> Tuple[str, int]:
    """``(s, n)`` of ECMAScript's Number::toString from a shortest round-trip text of a positive number: the
    digits ``s`` without leading or trailing zeros and the position ``n`` of the decimal point after them."""
    mant, _, exp = text.partition("e")
    whole, _, frac = mant.partition(".")
    digits = whole + frac
    n = len(whole) + (int(exp) if exp else 0)
    lead = len(digits) - len(digits.lstrip("0"))
    return (digits.strip("0") or "0"), n - lead


def _number_text(value: float, text: str) -> str:
    """``Number.prototype.toString`` given the value and its shortest digits (``repr``-like text)."""
    if value == 0:
        return "0"
    s, n = _shortest(text.lstrip("-"))
    k = len(s)
    sign = "-" if value < 0 else ""
    if k <= n <= 21:
        return sign + s + "0" * (n - k)
    if 0 < n <= 21:
        return sign + s[:n] + "." + s[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + s
    e = n - 1
    return sign + s[0] + ("." + s[1:] if k > 1 else "") + ("e+" if e >= 0 else "e-") + str(abs(e))


def canonical_label(value: Any) -> str:
    """The level id of one category (plan 1.6, S3): ``c:`` and its canonical text, or ``@na``.

    A string as it is; a boolean (tested before integers) ``true``/``false``; an integer its decimal digits; a
    finite float as ECMAScript writes a Number, a float32 by its shortest digits as float32; the infinities as
    ``Infinity``/``-Infinity``; None and NaN are ``@na``.
    """
    if value is None:
        return "@na"
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    if isinstance(value, str):
        return "c:" + value
    if isinstance(value, (bool, np.bool_)):
        return "c:true" if value else "c:false"
    if isinstance(value, (int, np.integer)):
        return "c:" + str(int(value))
    if isinstance(value, (float, np.floating)):
        v = float(value)
        if math.isnan(v):
            return "@na"
        if math.isinf(v):
            return "c:Infinity" if v > 0 else "c:-Infinity"
        if isinstance(value, np.floating) and value.dtype.itemsize < 8:
            return "c:" + _number_text(v, str(np.float32(value)))
        return "c:" + _number_text(v, repr(v))
    if type(value).__name__ == "NAType":
        return "@na"
    return "c:" + str(value)


def group_key_json(key: Sequence[str]) -> str:
    """The canonical JSON of a group key: ``JSON.stringify(key)``. The id of the level it is is ``g:`` and this."""
    return json.dumps(list(key), separators=(",", ":"), ensure_ascii=False)


# --------------------------------------------------------------------------------------------------------------
# The request
# --------------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Partitioning:
    source: Dict[str, Any]
    binning: Optional[Dict[str, Any]] = None       # raw; parsed in plan(), when the source's kind is known
    levels: Optional[Tuple[str, ...]] = None
    rest: str = "other"
    member: Optional[Dict[str, Any]] = None
    nested: Optional["Grouping"] = None             # a cell-group source's grouping


@dataclass(frozen=True)
class Grouping:
    partitionings: Tuple[Partitioning, ...]
    small_threshold: int = SMALL_THRESHOLD
    small_mode: str = "keep"


@dataclass(frozen=True)
class Request:
    shape: str
    grouping: Grouping
    sets: Dict[str, np.ndarray]                     # ref -> bool per cell shown, as decoded
    set_hashes: Dict[str, str]
    subset: Any = None
    features: Tuple[Any, ...] = ()                  # raw: core/group_features.py parses them
    measures: Tuple[Any, ...] = ()
    want_codes: bool = False
    histograms: Tuple[int, ...] = ()
    estimate_only: bool = False
    confirm: bool = False


def _bad(message: str, reason: str = "bad_request", **extra) -> GroupError:
    return GroupError(400, reason, message, **extra)


def _unknown(obj: Dict[str, Any], allowed: Sequence[str], where: str) -> None:
    extra = sorted(str(k) for k in obj if k not in allowed)
    if extra:
        raise _bad(f"Unknown field in {where}: {', '.join(extra)}.", "unknown_field", fields=extra)


def _flag(body: Dict[str, Any], name: str) -> bool:
    v = body.get(name, False)
    if not isinstance(v, bool):
        raise _bad(f"{name} must be true or false.")
    return v


def decode_set(ref: str, raw: Any) -> np.ndarray:
    """A table's bitset over the cells shown, as a bool array of its ``length``."""
    if not isinstance(raw, dict):
        raise _bad(f"Set '{ref}' must be an object.", "bad_set")
    _unknown(raw, ("encoding", "length", "data"), f"set '{ref}'")
    if raw.get("encoding") != "bitset-base64":
        raise _bad(f"Set '{ref}' must use the encoding 'bitset-base64'.", "bad_set")
    length, data = raw.get("length"), raw.get("data")
    if not isinstance(length, int) or isinstance(length, bool) or length < 0 or not isinstance(data, str):
        raise _bad(f"Set '{ref}' needs a length (cells) and base64 data.", "bad_set")
    try:
        packed = np.frombuffer(base64.b64decode(data, validate=True), dtype=np.uint8)
    except (binascii.Error, ValueError):
        raise _bad(f"Set '{ref}' is not valid base64.", "bad_set") from None
    if packed.size != (length + 7) // 8:
        raise _bad(f"Set '{ref}' holds {packed.size} bytes; {length} cells need {(length + 7) // 8}.", "bad_set")
    bits = np.unpackbits(packed, bitorder="little")
    if bits[length:].any():
        raise _bad(f"Set '{ref}' has bits set past its length.", "bad_set")
    return bits[:length].astype(bool)


def _parse_source(raw: Any, depth: int) -> Tuple[Dict[str, Any], Optional[Grouping]]:
    if not isinstance(raw, dict):
        raise _bad("A partitioning needs a source object.")
    kind = raw.get("type")
    if kind not in _SOURCE_FIELDS:
        raise _bad(f"Unknown source type {kind!r}.", "unknown_source_type")
    _unknown(raw, _SOURCE_FIELDS[kind], f"a {kind} source")
    src = dict(raw)
    if kind == "table":
        if not isinstance(src.get("ref"), str):
            raise _bad("A table source names its set with 'ref'.")
    elif kind in ("obs", "obsm", "layer", "obsp"):
        if not isinstance(src.get("key"), str) or not src["key"]:
            raise _bad(f"A {kind} source needs a key.")
        if kind != "obs" and src.get("column") is None:
            raise _bad(f"A {kind} source needs a column.")
    elif kind == "gene-score":
        if not isinstance(src.get("recipe"), dict):
            raise _bad("A gene-score source carries its recipe.")
    else:
        if depth >= MAX_NESTING:
            raise _bad(f"Groupings may use groupings at most {MAX_NESTING} deep.", "nested_too_deep",
                       limit=MAX_NESTING)
        rec = src.get("recipe")
        if not isinstance(rec, dict):
            raise _bad("A cell-group source carries its grouping's recipe.")
        _unknown(rec, ("partitionings", "small"), "a cell-group recipe")
        return src, _parse_grouping(rec.get("partitionings"), rec.get("small"), depth + 1)
    return src, None


def _parse_member(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise _bad("member must be an object.")
    if "op" in raw or "value" in raw:
        _unknown(raw, ("op", "value"), "member")
        if raw.get("op") not in _OPS:
            raise _bad("member op must be one of >, >=, <, <=.")
        v = raw.get("value")
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(float(v)):
            raise _bad("member value must be a finite number.")
        return {"op": raw["op"], "value": float(v)}
    if "levels" in raw:
        _unknown(raw, ("levels",), "member")
        return {"levels": _parse_ids(raw["levels"], "member levels")}
    if "group" in raw:
        _unknown(raw, ("group", "groupWas", "follow"), "member")          # groupWas, follow: the browser's
        key = raw["group"]
        if not isinstance(key, list) or not key or not all(isinstance(k, str) for k in key):
            raise _bad("member group must be a group key (a list of level ids).")
        return {"group": tuple(key)}
    raise _bad("member needs levels, op and value, or group.")


def _parse_ids(raw: Any, what: str) -> Tuple[str, ...]:
    if not isinstance(raw, list) or not all(isinstance(v, str) for v in raw):
        raise _bad(f"{what} must be a list of level ids.")
    if len(set(raw)) != len(raw):
        raise _bad(f"{what} names a level twice.")
    bad = [v for v in raw if not (v.startswith("c:") or v.startswith("g:"))]
    if bad:
        raise _bad(f"{what} holds ids that are not categories: {', '.join(bad[:5])}.", "bad_levels", ids=bad[:20])
    return tuple(raw)


def _parse_partitioning(raw: Any, depth: int) -> Partitioning:
    if not isinstance(raw, dict):
        raise _bad("A partitioning must be an object.")
    _unknown(raw, _PART_FIELDS, "a partitioning")
    source, nested = _parse_source(raw.get("source"), depth)
    rest = raw.get("rest", "other")
    if rest not in ("other", "exclude"):
        raise _bad("rest must be 'other' or 'exclude'.")
    b = raw.get("binning")
    if b is not None and not isinstance(b, dict):
        raise _bad("binning must be an object.")
    levels = _parse_ids(raw["levels"], "levels") if raw.get("levels") is not None else None
    member = None
    if raw.get("member") is not None:
        if b is not None or levels is not None or "rest" in raw:
            raise _bad("A member partitioning has no binning, levels or rest: it is in or out.")
        if source["type"] == "table":
            raise _bad("A table is in or out already; it takes no member.")
        member = _parse_member(raw["member"])
    return Partitioning(source=source, binning=b, levels=levels, rest=rest, member=member, nested=nested)


def _parse_grouping(parts: Any, small: Any, depth: int) -> Grouping:
    if not isinstance(parts, list) or not parts:
        raise _bad("A grouping needs at least one partitioning.")
    limit = grouping_limits()["partitionings"]
    if len(parts) > limit:
        raise GroupError(422, "too_many_partitionings", f"A grouping has at most {limit} factors; this one has "
                         f"{len(parts)}.", count=len(parts), limit=limit)
    threshold, mode = SMALL_THRESHOLD, "keep"
    if small is not None:
        if not isinstance(small, dict):
            raise _bad("small must be an object.")
        _unknown(small, ("threshold", "mode"), "small")
        threshold = small.get("threshold", SMALL_THRESHOLD)
        mode = small.get("mode", "keep")
        if not isinstance(threshold, int) or isinstance(threshold, bool) or not 1 <= threshold <= 10 ** 9:
            raise _bad("small threshold must be a whole number of cells, 1 or more.")
        if mode not in SMALL_MODES:
            raise _bad("small mode must be keep, collect or hide.")
    return Grouping(tuple(_parse_partitioning(p, depth) for p in parts), threshold, mode)


def _sources_of(g: Grouping) -> Iterator[Partitioning]:
    for p in g.partitionings:
        yield p
        if p.nested is not None:
            yield from _sources_of(p.nested)


def parse_request(body: Any) -> Request:
    """Validate a ``grouping`` request body (plan 1.2). Refusals are ``GroupError`` (400 unless stated).

    ``features`` and ``measures`` are kept as sent for ``core/group_features.py``; ``subset`` for the route.
    """
    if not isinstance(body, dict):
        raise _bad("The body must be a JSON object.")
    _unknown(body, _BODY_FIELDS, "the request")
    shape = body.get("shape", "grouping")
    if shape not in SHAPES:
        raise _bad("shape must be 'grouping', 'grid' or 'genes'.", "bad_shape")
    if shape != "grouping":
        raise _bad("This parser takes the grouping shape; the grid and the genes shape have their own "
                   "(core/cell_grid.py, core/gene_moments.py).", "bad_shape")
    grouping = _parse_grouping(body.get("partitionings"), body.get("small"), 0)
    raw_sets = body.get("sets") or {}
    if not isinstance(raw_sets, dict):
        raise _bad("sets must be an object.")
    sets = {str(ref): decode_set(str(ref), raw) for ref, raw in raw_sets.items()}
    hashes = {ref: hashlib.sha256(np.packbits(v, bitorder="little").tobytes() + str(v.size).encode()).hexdigest()
              for ref, v in sets.items()}
    for p in _sources_of(grouping):
        if p.source["type"] == "table" and p.source["ref"] not in sets:
            raise _bad(f"The request has no set '{p.source['ref']}'.", "set_missing")
    want = body.get("want") or {}
    if not isinstance(want, dict):
        raise _bad("want must be an object.")
    _unknown(want, _WANT_FIELDS, "want")
    codes = want.get("codes", False)
    if not isinstance(codes, bool):
        raise _bad("want.codes must be true or false.")
    hist = want.get("histograms", [])
    n_parts = len(grouping.partitionings)
    if not isinstance(hist, list) or not all(isinstance(i, int) and not isinstance(i, bool) and 0 <= i < n_parts
                                             for i in hist):
        raise _bad("want.histograms lists partitioning positions.")
    for name in ("features", "measures"):
        v = body.get(name)
        if v is not None and not isinstance(v, list):
            raise _bad(f"{name} must be a list.")
    return Request(shape=shape, grouping=grouping, sets=sets, set_hashes=hashes, subset=body.get("subset"),
                   features=tuple(body.get("features") or ()), measures=tuple(body.get("measures") or ()),
                   want_codes=codes, histograms=tuple(sorted(set(hist))),
                   estimate_only=_flag(body, "estimate_only"), confirm=_flag(body, "confirm"))


# --------------------------------------------------------------------------------------------------------------
# The plan
# --------------------------------------------------------------------------------------------------------------


@dataclass
class PartPlan:
    spec: Partitioning
    kind: str                       # category | bool | text | index | number | set | grouping
    binning: Optional[bn.Binning] = None
    integer: bool = False           # a numeric obs column of whole numbers (``categories`` ids then are integers)
    seconds: float = 0.0
    entries: int = 0
    layout: str = "column"
    whole_matrix: bool = False      # the read decodes the whole matrix (SHR-41)
    score: Optional[gs.Plan] = None
    nested: Optional["GroupingPlan"] = None

    @property
    def categorical(self) -> bool:
        return self.kind in ("category", "bool", "text", "index", "grouping") or \
            (self.binning is not None and self.binning.method == "categories")

    @property
    def member(self) -> Optional[Dict[str, Any]]:
        return self.spec.member

    def describe(self, request: Request) -> Dict[str, Any]:
        """The partitioning as it enters the cache key: what changes its levels, nothing else (PER-3)."""
        src = {k: v for k, v in self.spec.source.items() if k not in ("key", "ref", "recipe")}
        if self.spec.source["type"] in ("obs", "obsm", "layer", "obsp"):
            src["key"] = self.spec.source["key"]
        if self.spec.source["type"] == "table":
            src["set"] = request.set_hashes[self.spec.source["ref"]]
        if self.score is not None:
            r = self.score.recipe
            src["recipe"] = {**r.describe(), "genes": list(r.genes), "down": list(r.down)}
        if self.nested is not None:
            src["grouping"] = self.nested.describe(request)
        out: Dict[str, Any] = {"source": src}
        if self.binning is not None:
            out["binning"] = self.binning.to_dict()
        if self.spec.levels is not None:
            out["levels"] = list(self.spec.levels)
        if self.spec.rest != "other":
            out["rest"] = self.spec.rest
        if self.spec.member is not None:
            out["member"] = {k: list(v) if isinstance(v, tuple) else v for k, v in self.spec.member.items()}
        return out


@dataclass
class GroupingPlan:
    grouping: Grouping
    parts: List[PartPlan]

    def describe(self, request: Request) -> Dict[str, Any]:
        return {"partitionings": [p.describe(request) for p in self.parts],
                "small": [self.grouping.small_threshold, self.grouping.small_mode]}

    def all_parts(self) -> Iterator[PartPlan]:
        for p in self.parts:
            yield p
            if p.nested is not None:
                yield from p.nested.all_parts()


@dataclass
class Plan:
    """What a request means for one store, before any column is read."""
    reader: Any
    dataset_path: str
    request: Request
    top: GroupingPlan
    n_cells: int
    seconds: float
    entries: int
    layout: str
    tier: str
    lane: str
    cache_key: str

    def estimate(self) -> Dict[str, Any]:
        return {"seconds": round(self.seconds, 2), "tier": self.tier,
                **gs.tier_limits(), "try": gs.try_info(self.seconds),
                "entries": self.entries, "layout": self.layout, "n_cells": self.n_cells, "lane": self.lane,
                "parts": [{"type": p.spec.source["type"], "seconds": round(p.seconds, 3), "entries": p.entries,
                           "layout": p.layout} for p in self.top.parts]}


def _obs_node_kind(reader, dataset_path: str, key: str) -> Tuple[Optional[str], bool]:
    """``(kind, integer)`` of an obs column from the store's metadata, or ``(None, False)`` when it cannot tell."""
    with cs.root(reader, dataset_path) as root:
        if "obs" not in root:
            raise cs.CellSourceError(404, "key_not_found", "This dataset has no obs table.")
        obs = root["obs"]
        index = obs.attrs.get("_index", "_index")
        if isinstance(index, bytes):
            index = index.decode()
        if key == index:
            return "index", False
        if key not in obs:
            raise cs.CellSourceError(404, "key_not_found", f"This dataset has no obs column '{key}'.")
        node = obs[key]
        if cs.is_group(node):
            enc = str(node.attrs.get("encoding-type", ""))
            if enc == "categorical" or ("codes" in node and "categories" in node):
                return "category", False
            if enc == "nullable-boolean":
                return "bool", False
            if enc.startswith("nullable"):
                return "number", enc == "nullable-integer"
            return None, False
        if "categories" in getattr(node, "attrs", {}):
            return "category", False
        dt = np.dtype(node.dtype)
        if dt.kind == "b":
            return "bool", False
        if dt.kind in "iu":
            return "number", True
        if dt.kind == "f":
            return "number", False
        return "text", False


def _rate_seconds(layout: str, entries: int, remote: bool) -> float:
    rate = gs.RATES.get(layout, gs.RATES["dense"]) * (gs.REMOTE_RATE_FACTOR if remote else 1.0)
    return entries / rate


def _plan_part(reader, dataset_path: str, p: Partitioning, request: Request, n_cells: int,
               remote: bool, *, allow_exclude: bool = False, max_bins: int = bn.BINS_MAX) -> PartPlan:
    """One partitioning against the store. ``allow_exclude`` and ``max_bins`` are a count plot's: values outside a
    range may be left out (a grouping clamps, SHR-45), and its axis's bin limit (a grouping's is 1,000)."""
    t = p.source["type"]
    if t == "obs":
        kind, integer = _obs_node_kind(reader, dataset_path, p.source["key"])
        part = PartPlan(spec=p, kind=kind or "number", integer=integer)
        part.whole_matrix = cs.cost(reader, dataset_path, p.source).heavy    # a text column: a pass over every string
    elif t in ("obsm", "layer", "obsp"):
        c = cs.cost(reader, dataset_path, p.source)
        part = PartPlan(spec=p, kind="number", entries=c.entries, layout=c.layout,
                        seconds=_rate_seconds("dense" if t == "obsm" else c.layout, c.entries, remote))
        part.whole_matrix = (t == "layer" and c.layout in ("csr", "dense")) or (t == "obsp" and c.layout == "csc")
    elif t == "table":
        part = PartPlan(spec=p, kind="set")
    elif t == "gene-score":
        raw = dict(p.source["recipe"])
        if p.source.get("column") is not None:
            raw["method"] = p.source["column"]
        if p.source.get("layer") is not None:
            raw["input"] = p.source["layer"]
        sp = gs.plan(reader, dataset_path, gs.parse_recipe(raw))
        part = PartPlan(spec=p, kind="number", score=sp, entries=sp.entries, layout=sp.layout,
                        seconds=max(sp.seconds - gs.BASE_SECONDS, 0.0), whole_matrix=True)
    else:
        nested = _plan_grouping(reader, dataset_path, p.nested, request, n_cells, remote)
        part = PartPlan(spec=p, kind="grouping", nested=nested,
                        entries=sum(q.entries for q in nested.all_parts()),
                        seconds=sum(q.seconds for q in nested.parts),
                        whole_matrix=any(q.whole_matrix for q in nested.all_parts()))
    part.seconds += RESOLVE_SECONDS_PER_MCELL * n_cells / 1e6
    _check_part(part, allow_exclude, max_bins)
    return part


def _check_part(part: PartPlan, allow_exclude: bool = False, max_bins: int = bn.BINS_MAX) -> None:
    """Refuse what the source's kind rules out; parse the binning of a numeric source."""
    p, kind = part.spec, part.kind
    numeric = kind == "number"
    if p.member is not None:
        if "op" in p.member and not numeric:
            raise _bad("A comparison needs a numeric source.", "member_not_numeric")
        if "levels" in p.member and numeric:
            raise _bad("Levels of a numeric source are bins; compare it with a value instead.", "member_numeric")
        if "group" in p.member and kind != "grouping":
            raise _bad("Only a grouping's group can be named as a member.")
        return
    if p.binning is not None and kind in ("category", "bool", "text", "index", "set", "grouping"):
        method = p.binning.get("method", "categories")
        if method != "categories" or set(p.binning) - {"method"}:
            raise _bad("Only a numeric source can be binned.", "not_numeric")
    if numeric:
        try:
            part.binning = bn.parse(p.binning, numeric=True, max_bins=max_bins)
        except bn.BinningError as e:
            raise GroupError(400, e.reason, e.message, **e.extra) from None
        if part.binning.outside == "exclude" and part.binning.method != "categories" and not allow_exclude:
            raise _bad("A grouping clamps values outside the range (outside: 'clamp'), so every cell has a level.",
                       "outside_exclude")
    if p.levels is not None and not part.categorical:
        raise _bad("Levels can be kept only for a categorical source.", "levels_not_categorical")
    if kind == "set" and p.levels is not None:
        raise _bad("A table has the levels in and out.")


def _plan_grouping(reader, dataset_path, g: Grouping, request, n_cells, remote) -> GroupingPlan:
    return GroupingPlan(g, [_plan_part(reader, dataset_path, p, request, n_cells, remote) for p in g.partitionings])


def plan(reader, dataset_path: str, request: Request) -> Plan:
    """Resolve the request's sources against the store and estimate it (CMP-1, CMP-7). Reads no column.

    The estimate is 0.012 s per million cells and partitioning, plus each matrix read at the score engine's
    rates (an obsm column charged its whole matrix at the dense rate, CMP-13) and each score's own estimate. The
    lane is light when the estimate is live and no source reads a whole matrix (SHR-41).
    """
    with cs.root(reader, dataset_path) as root:
        n_cells = cs.n_cells(root)
    remote = is_remote_path(dataset_path)
    top = _plan_grouping(reader, dataset_path, request.grouping, request, n_cells, remote)
    parts = list(top.all_parts())
    seconds = gs.BASE_SECONDS + sum(p.seconds for p in top.parts)
    entries = sum(p.entries for p in parts if p.nested is None)
    layouts = sorted({p.layout for p in parts if p.entries})
    tier = gs.tier_of(seconds)
    lane = "light" if seconds <= gs.live_max_s() and not any(p.whole_matrix for p in parts) else "heavy"
    # the group limit decides whether a grouping is refused, so a grouping resolved under another is another entry
    key = json.dumps({"v": ALGORITHM_VERSION, "shape": request.shape, "grouping": top.describe(request),
                      "subset": request.subset, "limits": grouping_limits()}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return Plan(reader=reader, dataset_path=dataset_path, request=request, top=top, n_cells=n_cells,
                seconds=seconds, entries=entries, layout=layouts[0] if len(layouts) == 1 else
                ("mixed" if layouts else "column"), tier=tier, lane=lane,
                cache_key=hashlib.sha256(key.encode("utf-8")).hexdigest())


# --------------------------------------------------------------------------------------------------------------
# Levels of one partitioning
# --------------------------------------------------------------------------------------------------------------


class _Refused(Exception):
    """A partitioning or grouping over a limit: the result says so and carries no blocks."""

    def __init__(self, **refused):
        super().__init__(refused.get("reason"))
        self.refused = refused


@dataclass
class _Ctx:
    reader: Any
    dataset_path: str
    request: Request
    rows: Optional[np.ndarray]
    n_shown: int
    should_stop: Optional[Callable[[], bool]]
    pause: Any
    on_entries: Optional[Callable[[int], None]] = None
    told: int = 0                                   # entries reported so far, by tell()

    def check(self) -> None:
        if self.should_stop is not None and self.should_stop():
            raise gs.ScoreCancelled()
        if self.pause is not None and self.pause.wanted():
            self.pause.wait()

    def tell(self, n: int) -> None:
        """Stored entries read: a score's as it reads them, a column's once it is read."""
        self.told += int(n)
        if self.on_entries is not None and n:
            self.on_entries(int(n))


def _spans(n: int) -> Iterator[Tuple[int, int]]:
    step = max(int(cs.SLAB_ROWS), 1)
    for a in range(0, n, step):
        yield a, min(a + step, n)


class _Levels:
    """One partitioning's levels over the cells shown.

    ``prepare()`` reads what fixes the levels and sets ``slots``, the level ids in SHR-10 order (a slot is a
    possible level; the reserved ones are listed in the reply only when a cell is in them). Iterating then gives
    ``(start, level)`` slabs, ``uint16`` slot indices with ``NONE16`` for a cell in no group, which tile the cells
    shown; ``counts`` holds the cells per slot afterwards. ``info`` holds the reply fields of the kind.
    """

    def __init__(self, part: PartPlan, ctx: _Ctx, index: int, allow_exclude: bool = False):
        self.part, self.ctx, self.index = part, ctx, index
        self.allow_exclude = allow_exclude      # a count plot's axis: OUT_BELOW, OUT_ABOVE for cells left out
        self.bin_counts: Optional[bn.Counts] = None     # a binned partitioning's, once its slabs are read
        self.slots: List[str] = []
        self.bounds: Dict[int, Tuple[Optional[float], Optional[float]]] = {}
        self.categories: Optional[List[str]] = None
        self.absent: List[str] = []
        #: The level limit the stored categories are compared with before any cell is read (a count plot's axis
        #: sets its own); past it, the categories that hold a cell shown are counted instead (SHR-6, SHR-7).
        self.level_limit: Optional[int] = None
        self.info: Dict[str, Any] = {}
        self.counts: Optional[np.ndarray] = None
        self.count = True
        self._slabs: Iterator[Tuple[int, np.ndarray]] = iter(())
        self._score_values: Optional[np.ndarray] = None     # a score source computed by precompute()
        self._sub: Optional["GroupingResult"] = None        # a grouping source resolved by precompute()

    # -- the reply --------------------------------------------------------------------------------------------

    @property
    def n_levels(self) -> int:
        """Levels for the limit: every slot that is not reserved."""
        return sum(1 for s in self.slots if not s.startswith("@"))

    def reply(self) -> Dict[str, Any]:
        part = self.part
        kind = ("member" if part.member is not None else "table" if part.kind == "set" else
                "grouping" if part.kind == "grouping" else "categorical" if part.categorical else "binned")
        levels = []
        for i, sid in enumerate(self.slots):
            n = int(self.counts[i]) if self.counts is not None else 0
            if sid.startswith("@") and sid not in ("@in", "@out") and n == 0:
                continue
            lv: Dict[str, Any] = {"id": sid, "n": n}
            if i in self.bounds:
                lv["lo"], lv["hi"] = self.bounds[i]
            levels.append(lv)
        out: Dict[str, Any] = {"kind": kind, "levels": levels, **self.info}
        if self.categories is not None:
            out["categories"] = self.categories
        if self.absent:
            out["absent"] = self.absent
        return out

    # -- reading ----------------------------------------------------------------------------------------------

    def __iter__(self):
        """The level slabs. Cells per slot are counted here only when ``count`` is set: when no partitioning
        leaves a cell in no group, every cell is in a group and the groups' counts give the levels' for free."""
        counts = np.zeros(NONE16 + 1, dtype=np.int64)
        for start, lv in self._slabs:
            self.ctx.check()
            if self.count:
                counts += np.bincount(lv, minlength=NONE16 + 1)      # a uint16 slot: NONE16 has its own bin
            yield start, lv
        if self.count:
            self.counts = counts[:len(self.slots)]

    def _column(self, rows) -> Iterator[cs.Slab]:
        req = self.ctx.request
        return cs.column(self.ctx.reader, self.ctx.dataset_path, self.part.spec.source, rows, sets=req.sets,
                         should_stop=self.ctx.should_stop)

    def precompute(self) -> Iterator[Tuple[int, int]]:
        """Before ``prepare()``: compute a score source, or resolve a grouping source, yielding the progress
        ``(genes_done, genes_total)`` of every score this computes, so a resolve is never silent while a score runs.
        ``prepare()`` then takes what this computed; without it, ``prepare()`` computes the same silently (a count
        plot's axis)."""
        part = self.part
        if part.score is not None:
            self._score_values = yield from self._score(self._rows_read())
        elif part.nested is not None:
            self._sub = yield from _scores_while_resolving(part.nested, self.ctx)

    def _rows_read(self) -> Optional[np.ndarray]:
        """The rows a numeric source is read for: every cell when its edges come from all of them, else those shown."""
        b = self.part.binning
        if b is not None and b.edges_from == "all" and self.ctx.rows is not None:
            return None
        return self.ctx.rows

    def _score(self, rows) -> Iterator[Tuple[int, int]]:
        """The score's values for ``rows``, yielding its progress; refused when it has none."""
        values = None
        for event, payload in gs.compute(self.part.score, rows, self.ctx.should_stop, self.ctx.pause,
                                         on_entries=self.ctx.tell):
            if event == "result":
                values = payload.values
                if values is None:
                    raise GroupError(422, "no_score", gs.NO_SCORE_MESSAGES.get(payload.reason, "No score."),
                                     partitioning=self.index, score_reason=payload.reason)
            else:
                yield payload
        return values

    def prepare(self) -> None:
        part = self.part
        if part.kind == "set":
            self._prepare_set()
        elif part.member is not None and "op" in part.member:
            self._prepare_compare()
        elif part.categorical:
            self._prepare_categorical()
        else:
            self._prepare_binned()
        limit = grouping_limits()["levels"]
        if self.n_levels > limit:
            raise _Refused(reason="too_many_levels", count=self.n_levels, limit=limit,
                           partitioning=self.index)

    def _prepare_set(self) -> None:
        exclude = self.part.spec.rest == "exclude"
        self.slots = ["@in"] if exclude else ["@in", "@out"]
        out = NONE16 if exclude else 1

        def slabs():
            for slab in self._column(self.ctx.rows):
                yield slab.start, np.where(slab.values, np.uint16(0), np.uint16(out)).astype(np.uint16)
        self._slabs = slabs()

    # numeric values ------------------------------------------------------------------------------------------

    def _numbers(self, rows) -> List[np.ndarray]:
        """The source's values for ``rows`` (None: all cells), held as slabs in their stored type."""
        part = self.part
        if part.score is not None:
            values, self._score_values = self._score_values, None
            if values is None:
                values = _drain(self._score(rows))
            return [values[a:b] for a, b in _spans(values.size)]
        held = []
        for slab in self._column(rows):
            if slab.kind != "number":
                raise _bad("This source is not numeric.", "not_numeric", partitioning=self.index)
            held.append(slab.values)
        return held

    def _shown_values(self, held: List[np.ndarray], from_all: bool) -> Iterator[Tuple[int, np.ndarray]]:
        """The held values of the cells shown, slab by slab; each held slab is released once used."""
        rows = self.ctx.rows
        if not from_all or rows is None:
            start = 0
            while held:
                v = held.pop(0)
                yield start, v
                start += v.size
            return
        ends = np.cumsum([h.size for h in held])
        firsts = ends - np.asarray([h.size for h in held])
        for a, b in _spans(rows.size):
            r = rows[a:b]
            which = np.searchsorted(ends, r, side="right")
            out = np.empty(r.size, dtype=held[0].dtype if held else np.float64)
            for w in np.unique(which):
                m = which == w
                out[m] = held[w][r[m] - firsts[w]]
            yield a, out

    def _prepare_compare(self) -> None:
        m = self.part.member
        op, value = _OPS[m["op"]], m["value"]
        self.slots = ["@in", "@out"]
        self.info["n_no_value"] = 0

        def slabs():
            held = self._numbers(self.ctx.rows)
            for start, v in self._shown_values(held, False):
                v = v.astype(np.float64, copy=False)
                ok = np.isfinite(v)
                self.info["n_no_value"] += int(ok.size - np.count_nonzero(ok))
                inside = np.zeros(v.size, dtype=bool)
                inside[ok] = op(v[ok], value)
                yield start, np.where(inside, np.uint16(0), np.uint16(1)).astype(np.uint16)
        self._slabs = slabs()

    def _binning_of(self, held: List[np.ndarray]) -> bn.Binning:
        """The binning the edges are found with, given the held values. A count plot's density takes its range
        from the values here (``core/cell_grid.py``)."""
        return self.part.binning

    def _prepare_binned(self) -> None:
        part = self.part
        from_all = part.binning.edges_from == "all" and self.ctx.rows is not None
        held = self._numbers(None if from_all else self.ctx.rows)
        b = self._binning_of(held)
        try:
            e = bn.edges(lambda: iter(held), b)
        except bn.BinningError as err:
            raise GroupError(422, err.reason, err.message, partitioning=self.index, **err.extra) from None
        ids = bn.level_ids(e)
        exclude = part.spec.rest == "exclude"
        self.slots = ids + ([] if exclude else ["@na"])
        for i, (lo, hi) in enumerate(bn.level_bounds(e)):
            if ids[i] != "@zero":
                self.bounds[i] = (lo, hi)
        if self.index in self.ctx.request.histograms:
            self.info["histogram"] = bn.preview(lambda: iter(held))
        counts = self.bin_counts = bn.Counts()
        self.info.update(e.to_reply())
        na = NONE16 if exclude else len(ids)
        # Left out (SHR-45): only a count plot's axis, and only where a cell can fall outside the edges.
        drop = self.allow_exclude and b.outside == "exclude" and b.method in bn.DEFAULT_BINS and not e.degenerate
        lo, hi = (float(e.edges[0]), float(e.edges[-1])) if drop else (0.0, 0.0)
        log = b.method == "log"

        def slabs():
            for start, v in self._shown_values(held, from_all):
                lv = bn.assign(v, e, counts)
                gone = lv == bn.NO_LEVEL if drop else None
                if gone is not None and gone.any():
                    x = np.asarray(v[gone], dtype=np.float64)
                    below = x < lo                          # NaN compares false: it has no value
                    if log:
                        below &= x > 0                      # under log-spaced bins, <= 0 has no value
                    lv[gone] = np.where(below, OUT_BELOW, np.where(x > hi, OUT_ABOVE, na))
                elif na != NONE16:
                    np.minimum(lv, na, out=lv)          # every level is below na; only NO_LEVEL is above
                yield start, lv
            self.info["n_no_value"] = counts.n_no_value
            self.info["n_outside"] = counts.n_outside
        self._slabs = slabs()

    # categories ----------------------------------------------------------------------------------------------

    def _set_categories(self, ids: List[str]) -> np.ndarray:
        """Slots from the category ids in their order; returns the slot of each category and, last, of a missing
        value (``NONE16`` for a cell in no group)."""
        if len(set(ids)) != len(ids):
            seen, twice = set(), []
            for i in ids:
                if i in seen and i not in twice:
                    twice.append(i)
                seen.add(i)
            raise _Refused(reason="ambiguous_categories", partitioning=self.index, ids=twice[:20],
                           count=len(twice))
        part = self.part
        member = part.member
        exclude = part.spec.rest == "exclude"
        lut = np.full(len(ids) + 1, NONE16, dtype=np.uint16)
        if member is not None:
            self.slots = ["@in", "@out"]
            want = set(member.get("levels") or ()) | ({"g:" + group_key_json(member["group"])}
                                                       if "group" in member else set())
            lut[:] = 1
            for i, cid in enumerate(ids):
                if cid in want:
                    lut[i] = 0
            have = set(ids)
            self.absent = [cid for cid in sorted(want) if cid not in have]
            self.categories = ids
            return lut
        if part.spec.levels is not None:
            kept = list(part.spec.levels)
            have = {cid: i for i, cid in enumerate(ids)}
            self.absent = [cid for cid in kept if cid not in have]
            self.slots = kept + ([] if exclude else ["@other", "@na"])
            other = NONE16 if exclude else len(kept)
            lut[:-1] = other
            for k, cid in enumerate(kept):
                if cid in have:
                    lut[have[cid]] = k
            lut[-1] = NONE16 if exclude else len(kept) + 1
        else:
            self.slots = list(ids) + ([] if exclude else ["@na"])
            lut[:-1] = np.arange(len(ids), dtype=np.uint16)
            lut[-1] = NONE16 if exclude else len(ids)
        self.categories = list(ids)
        return lut

    def _prepare_categorical(self) -> None:
        kind = self.part.kind
        if kind == "index":
            self._prepare_index()
        elif kind == "grouping":
            self._prepare_grouping()
        elif kind == "number":
            self._prepare_value_categories()
        else:
            self._prepare_column_categories()

    def _from_codes(self, ids: List[str], codes_slabs: Iterator[Tuple[int, np.ndarray]],
                    lut: Optional[np.ndarray] = None) -> None:
        """Codes index ``ids``; -1 is a missing value (``lut[-1]``, the slot of a missing value, is last). ``lut``
        given: the slots are set already (``_from_occupied``)."""
        lut = self._set_categories(ids) if lut is None else lut
        self.info["n_no_value"] = 0

        def slabs():
            for start, codes in codes_slabs:
                c = np.asarray(codes)
                self.info["n_no_value"] += int(np.count_nonzero(c < 0))
                yield start, lut[c]
        self._slabs = slabs()

    def _from_occupied(self, ids: List[str], first_read: Iterator[cs.Slab], limit: int) -> None:
        """More stored categories than the level limit: the levels are the categories that hold a cell shown
        (SHR-6, SHR-7; a subset keeps every category of its atlas). One pass over the codes counts them. Over the
        limit, ``prepare()`` refuses with that count; within it, a second read assigns the cells. ``categories``
        still lists every stored category."""
        self._set_categories(ids)                    # the ambiguity check, and categories
        counts = np.zeros(len(ids) + 1, dtype=np.int64)
        for slab in first_read:
            self.ctx.check()
            c = np.asarray(slab.values)
            counts += np.bincount(np.where(c < 0, len(ids), c), minlength=len(ids) + 1)
        used = np.flatnonzero(counts[:-1])
        exclude = self.part.spec.rest == "exclude"
        self.slots = [ids[i] for i in used.tolist()] + ([] if exclude else ["@na"])
        if used.size > limit:
            return
        lut = np.full(len(ids) + 1, NONE16, dtype=np.uint16)
        lut[used] = np.arange(used.size, dtype=np.uint16)
        lut[-1] = NONE16 if exclude else used.size
        self._from_codes(ids, ((s.start, s.values) for s in self._column(self.ctx.rows)), lut=lut)

    def _prepare_index(self) -> None:
        n = self.ctx.n_shown
        limit = grouping_limits()["levels"]
        if n > limit:
            raise _Refused(reason="too_many_levels", count=n, limit=limit, partitioning=self.index)
        rows = self.ctx.rows if self.ctx.rows is not None else np.arange(n, dtype=np.int64)
        names = self.ctx.reader.get_cell_gene_names_at(self.ctx.dataset_path, "cells", rows)
        ids = [canonical_label(v) for v in names]
        self._from_codes(ids, iter([(0, np.arange(n, dtype=np.int64))]) if n else iter(()))

    def _prepare_grouping(self) -> None:
        sub, self._sub = self._sub, None
        if sub is None:
            sub = _resolve(self.part.nested, self.ctx)
        if sub.refused is not None:
            raise GroupError(422, "upstream_refused", "The grouping used as a factor cannot be computed.",
                             partitioning=self.index, upstream=sub.refused)
        ids = ["g:" + group_key_json(g["key"]) for g in sub.groups]
        none = _none_of(sub.codes)

        def codes():                                # one span at a time: the upstream codes are not copied whole
            for a, b in _spans(sub.codes.size):
                c = sub.codes[a:b].astype(np.int32)
                c[c == none] = -1
                yield a, c
        self._from_codes(ids, codes())

    def _prepare_value_categories(self) -> None:
        """A numeric column split by its values (the ``categories`` method)."""
        part, b = self.part, self.part.binning
        from_all = b.edges_from == "all" and self.ctx.rows is not None
        held = self._numbers(None if from_all else self.ctx.rows)
        try:
            e = bn.edges(lambda: iter(held), b)
        except bn.BinningError as err:
            raise GroupError(422, err.reason, err.message, partitioning=self.index, **err.extra) from None
        dtype = held[0].dtype if held else np.dtype(np.float64)
        values = e.edges
        if part.integer or dtype.kind in "iu":
            if values.size and np.abs(values).max() >= 2.0 ** 53:
                raise _Refused(reason="ambiguous_categories", partitioning=self.index, count=0, ids=[])
            ids = [canonical_label(int(v)) for v in values]
        elif dtype == np.float32:
            ids = [canonical_label(np.float32(v)) for v in values]
        else:
            ids = [canonical_label(float(v)) for v in values]
        counts = bn.Counts()
        self.info["edges_from"] = b.edges_from
        self.info["edges_n"] = int(e.edges_n)

        def codes():
            for start, v in self._shown_values(held, from_all):
                lv = bn.assign(v, e, counts).astype(np.int64)
                lv[lv == bn.NO_LEVEL] = -1
                yield start, lv
        self._from_codes(ids, codes())

    def _prepare_column_categories(self) -> None:
        """An obs column of categories, booleans or text."""
        slabs = self._column(self.ctx.rows)
        try:
            first = next(slabs, None)
        except cs.CellSourceError as e:
            if e.reason != "too_many_categories":
                raise
            raise _Refused(reason="too_many_categories", partitioning=self.index, **e.extra) from None
        if first is None:
            self._from_codes([], iter(()))
            return

        def rest():
            yield first
            yield from slabs
        if first.kind == "category":
            ids = [canonical_label(v) for v in first.categories]
            levels = grouping_limits()["levels"]
            limit = levels if self.level_limit is None else min(self.level_limit, levels)
            if len(ids) > limit and self.part.member is None and self.part.spec.levels is None:
                self._from_occupied(ids, rest(), limit)
            else:
                self._from_codes(ids, ((s.start, s.values) for s in rest()))
            self._uns_colors(ids)
        elif first.kind == "bool":
            ids = ["c:false", "c:true"]
            self.info["boolean"] = True        # a text column whose categories are "true" and "false" has the same ids
            self._from_codes(ids, ((s.start, _bool_codes(s.values)) for s in rest()))
            self._uns_colors(ids)
        elif first.kind == "text":
            # a plain string column arrives as categories (cell_sources); values only a list can give are of a type
            # no level id is defined for (dates, complex numbers)
            raise _bad("This column's values are neither numbers, categories nor text.", "unsupported_column",
                       partitioning=self.index)
        else:
            raise _bad("This column is numeric: bin it, or split it by its values (method 'categories').",
                       "not_categorical", partitioning=self.index)

    def _uns_colors(self, ids: List[str]) -> None:
        """``colors``, ``{id: css}``, from ``uns/<key>_colors`` when it has at least one entry per category, as scanpy
        takes them (SHR-11, decision 33): entry i is the colour of category i of the column's full category list (ids),
        whichever cells are shown, and entries past the categories are unused. A boolean's list is [False, True], as
        scanpy writes it."""
        name = f"{self.part.spec.source['key']}_colors"
        with cs.root(self.ctx.reader, self.ctx.dataset_path) as root:
            if "uns" not in root or name not in root["uns"] or cs.is_group(root["uns"][name]):
                return
            values = np.asarray(root["uns"][name][...]).reshape(-1).tolist()
        values = [v.decode("utf-8") if isinstance(v, bytes) else v for v in values]
        used = values[:len(ids)]
        if ids and len(used) == len(ids) and all(isinstance(v, str) and v for v in used):
            self.info["colors"] = dict(zip(ids, used))


def _bool_codes(values: np.ndarray) -> np.ndarray:
    if values.dtype == bool:
        return values.astype(np.int64)
    return np.asarray([-1 if v is None else int(bool(v)) for v in values], dtype=np.int64)


def _none_of(codes: np.ndarray) -> int:
    return 0xFF if codes.dtype == np.uint8 else NONE16


# --------------------------------------------------------------------------------------------------------------
# Intersection
# --------------------------------------------------------------------------------------------------------------


class _Fold:
    """The running intersection: one code per cell shown and, per code, the slot of each partitioning.

    Codes are mixed-radix (first partitioning slowest) while the product of the slot counts fits a ``uint16``,
    and are compacted to the occupied combinations, in the same order, when it would not. Compacted codes are
    numbered in key order, so the order of the groups is SHR-10's without a sort of the cells.
    """

    def __init__(self, n: int):
        self.codes = np.zeros(n, dtype=np.uint16)
        self.k = 1                                      # code space
        self.keys = np.zeros((1, 0), dtype=np.int32)    # slots of each compacted code
        self.radices: List[int] = []                    # partitionings folded in since the last compaction
        self.pending: Optional[np.ndarray] = None       # compact(apply=False): the numbering not yet applied
        self.over = False                               # fold(last=True) found more groups than the limit

    @property
    def none(self) -> int:
        return NONE16 if self.codes.dtype == np.uint16 else NONE32

    def fold(self, levels: _Levels, last: bool = False) -> None:
        """Fold one partitioning in. On the ``last`` one, a wide fold over the group limit only counts the groups
        (``over`` is set) and writes no codes: the result is a refusal, which needs the count alone."""
        width = len(levels.slots)
        if self.codes.dtype == np.uint16 and self.k * width >= _NARROW_MAX and self.radices:
            self.compact()
        if self.codes.dtype == np.uint16 and self.k * width < _NARROW_MAX:
            self._narrow(levels, width)
        else:
            self._wide(levels, width, last)

    def _narrow(self, levels: _Levels, width: int) -> None:
        codes = self.codes
        for start, lv in levels:
            r = codes[start:start + lv.size]
            bad = r == NONE16
            bad |= lv == NONE16
            r *= np.uint16(width)                       # below 65,535 wherever both are set; the rest is reset
            r += lv
            np.copyto(r, NONE16, where=bad)
        self.k *= width
        self.radices.append(width)

    def _occupied(self, chunks: Iterator[np.ndarray], space: int) -> np.ndarray:
        """The sorted distinct values of ``chunks`` (each below ``space``)."""
        if space <= _TABLE_MAX:
            table = np.zeros(space, dtype=bool)
            for c in chunks:
                table[c] = True
            return np.flatnonzero(table)
        seen = np.empty(0, dtype=np.int64)
        for c in chunks:
            seen = np.union1d(seen, np.unique(c))
        return seen

    def _wide(self, levels: _Levels, width: int, last: bool) -> None:
        """Fold through the full slot array: one pass for the occupied combinations, one to write their codes."""
        n = self.codes.size
        small = width < 0xFF                            # the slots in one byte each, 0xFF for no group
        lv_none = 0xFF if small else NONE16
        lv_all = np.empty(n, dtype=np.uint8 if small else np.uint16)
        for start, lv in levels:
            lv_all[start:start + lv.size] = np.minimum(lv, lv_none) if small else lv
        none = self.none

        def combined():
            for a, b in _spans(n):
                r, lv = self.codes[a:b].astype(np.int64), lv_all[a:b]
                ok = (r != none) & (lv != lv_none)
                yield a, b, ok, r * width + lv
        occupied = self._occupied((c[ok] for _, _, ok, c in combined()), self.k * width)
        if last and occupied.size > grouping_limits()["groups"]:
            self.k, self.over = int(occupied.size), True
            return
        new_dtype = np.uint16 if occupied.size < NONE16 else np.uint32
        new_none = NONE16 if new_dtype == np.uint16 else NONE32
        out = self.codes if new_dtype == self.codes.dtype else np.empty(n, dtype=new_dtype)
        for a, b, ok, c in combined():
            v = np.full(b - a, new_none, dtype=new_dtype)
            v[ok] = np.searchsorted(occupied, c[ok])
            out[a:b] = v
        self.codes = out
        del lv_all
        self.keys = np.concatenate([self.keys[occupied // width], (occupied % width)[:, None].astype(np.int32)], axis=1)
        self.k = int(occupied.size)
        self.radices = []

    def compact(self, apply: bool = True) -> np.ndarray:
        """Number the occupied codes 0, 1, ... in order; returns the cells per new code.

        With ``apply`` false the codes are left as they are and ``pending`` holds the lookup that would number
        them, so the caller can fold a further renumbering into the same pass over the cells.
        """
        none = self.none
        if self.codes.dtype == np.uint16:
            counts = np.zeros(NONE16 + 1, dtype=np.int64)
            for a, b in _spans(self.codes.size):
                counts += np.bincount(self.codes[a:b], minlength=NONE16 + 1)
            counts = counts[:self.k]
        else:
            counts = np.zeros(self.k, dtype=np.int64)
            for a, b in _spans(self.codes.size):
                c = self.codes[a:b]
                counts += np.bincount(c[c != none], minlength=self.k)
        occupied = np.flatnonzero(counts)
        if self.radices:
            digits, rem = [], occupied.copy()
            for w in reversed(self.radices):
                digits.append(rem % w)
                rem //= w
            self.keys = np.concatenate([self.keys[rem]] + [d[:, None].astype(np.int32) for d in reversed(digits)],
                                       axis=1)
        else:
            self.keys = self.keys[occupied]
        self.pending = None
        if occupied.size != self.k:
            lut = _lookup(occupied, self.k, none, self.codes.dtype)
            if apply:
                self.remap(lut)
            else:
                self.pending = lut
        self.k = int(occupied.size)
        self.radices = []
        return counts[occupied]

    def remap(self, lut: np.ndarray) -> None:
        """Codes through ``lut`` (indexed by code, with the value of a cell in no group last)."""
        full = _full_lookup(lut, self.codes.dtype)
        for a, b in _spans(self.codes.size):
            c = self.codes[a:b]
            c[:] = full[c] if full is not None else lut[np.where(c == self.none, lut.size - 1, c)]


def _full_lookup(lut: np.ndarray, dtype) -> Optional[np.ndarray]:
    """For uint16 codes: ``lut`` over every uint16 value, so a code indexes it directly (NONE16 included)."""
    if dtype != np.uint16:
        return None
    full = np.full(NONE16 + 1, lut[-1], dtype=lut.dtype)
    full[:lut.size - 1] = lut[:-1]
    return full


def _lookup(old: np.ndarray, k: int, none: int, dtype) -> np.ndarray:
    lut = np.full(k + 1, none, dtype=dtype)
    lut[old] = np.arange(old.size, dtype=dtype)
    return lut


# --------------------------------------------------------------------------------------------------------------
# Compute
# --------------------------------------------------------------------------------------------------------------


@dataclass
class GroupingResult:
    """A resolved grouping: what the code cache holds and what the reply is made of."""
    n_shown: int
    n_grouped: int = 0
    groups: List[Dict[str, Any]] = field(default_factory=list)     # {"key": [ids], "n": cells}, in code order
    partitionings: List[Dict[str, Any]] = field(default_factory=list)
    codes: Optional[np.ndarray] = None       # uint8 (255: in no group) up to 255 groups, else uint16 (65535)
    refused: Optional[Dict[str, Any]] = None
    small: Dict[str, Any] = field(default_factory=dict)

    def to_reply(self, want_codes: bool) -> Tuple[Dict[str, Any], List[Tuple[str, np.ndarray]]]:
        """The ``result`` frame's grouping fields and its blocks (only ``codes``, when asked)."""
        head: Dict[str, Any] = {"type": "result", "version": ALGORITHM_VERSION, "shape": "grouping",
                                "n_shown": self.n_shown}
        if self.refused is not None:
            head["refused"] = self.refused
            return head, []
        head.update(n_grouped=self.n_grouped, partitionings=self.partitionings, groups=self.groups, small=self.small)
        blocks = []
        if want_codes:
            blocks.append(("codes", self.codes))
        head["blocks"] = [{"name": name, "dtype": a.dtype.name, "length": int(a.size)} for name, a in blocks]
        return head, blocks


def _drain(steps: Iterator[Any]) -> Any:
    """Run a generator to its end; its return value."""
    while True:
        try:
            next(steps)
        except StopIteration as stop:
            return stop.value


def _resolve(gp: GroupingPlan, ctx: _Ctx) -> GroupingResult:
    return _drain(_resolving(gp, ctx))


def _scores_while_resolving(gp: GroupingPlan, ctx: _Ctx) -> Iterator[Tuple[int, int]]:
    """Resolve a grouping used as a source, yielding the progress of its scores; returns the GroupingResult."""
    steps = _resolving(gp, ctx)
    while True:
        try:
            event, payload = next(steps)
        except StopIteration as stop:
            return stop.value
        if event == "score":
            yield payload


def _resolving(gp: GroupingPlan, ctx: _Ctx) -> Iterator[Tuple[str, Any]]:
    """Resolve ``gp``, yielding ``("part", partitionings done)`` and, while a score source computes (here or in a
    grouping used as a source), ``("score", (genes_done, genes_total))``; returns the GroupingResult.

    Each partitioning's stored entries are reported through ``ctx.tell``: a score's as it reads them, and what the
    plan counted beyond that once the partitioning is folded, so the calls add up to the plan's entries.

    When no partitioning can leave a cell in no group, the number of groups only grows from one partitioning to the
    next. Once it is over the limit the grouping is refused before the next partitioning is read (its ``count`` is
    then the groups so far, a lower bound)."""
    result = GroupingResult(n_shown=ctx.n_shown)
    fold = _Fold(ctx.n_shown)
    made: List[_Levels] = []
    every_cell_grouped = not any(p.spec.rest == "exclude" and p.member is None for p in gp.parts)
    limit = grouping_limits()["groups"]
    try:
        for i, part in enumerate(gp.parts):
            ctx.check()
            last = i == len(gp.parts) - 1
            told = ctx.told
            levels = _Levels(part, ctx, i)
            levels.count = not every_cell_grouped
            for progress in levels.precompute():
                yield "score", progress
            levels.prepare()
            fold.fold(levels, last=last)
            made.append(levels)
            if part.nested is None and part.entries > ctx.told - told:
                ctx.tell(part.entries - (ctx.told - told))
            if every_cell_grouped and not last and fold.k > limit:
                if fold.radices:
                    fold.compact()
                if fold.k > limit:
                    raise _Refused(reason="too_many_groups", count=int(fold.k), limit=limit)
            yield "part", i + 1
        counts = None if fold.over else fold.compact(apply=False)
        if fold.k > limit:
            raise _Refused(reason="too_many_groups", count=int(fold.k), limit=limit)
    except _Refused as r:
        result.refused = {**r.refused, "levels": [lv.n_levels for lv in made]}
        return result
    if every_cell_grouped:
        for p, lv in enumerate(made):
            lv.counts = np.bincount(fold.keys[:, p], weights=counts, minlength=len(lv.slots)).astype(np.int64)
    result.partitionings = [lv.reply() for lv in made]
    keys = [[made[p].slots[s] for p, s in enumerate(row)] for row in fold.keys.tolist()]
    result.groups, result.codes, result.small = _small_groups(fold, keys, counts, gp.grouping)
    result.n_grouped = int(sum(g["n"] for g in result.groups))
    return result


def _small_groups(fold: _Fold, keys: List[List[str]], counts: np.ndarray, g: Grouping):
    """Apply the small-group treatment (SHR-12) and narrow the codes to uint8 when the groups allow it."""
    small = counts < g.small_threshold
    info = {"threshold": g.small_threshold, "mode": g.small_mode, "n_small": int(small.sum())}
    k = len(keys)
    if g.small_mode == "keep" or not small.any():
        new_of = np.arange(k, dtype=np.int64)
        out_keys, out_counts = keys, counts.tolist()
    else:
        big = np.flatnonzero(~small)
        new_of = np.full(k, -1, dtype=np.int64)
        new_of[big] = np.arange(big.size)
        out_keys = [keys[i] for i in big]
        out_counts = counts[big].tolist()
        if g.small_mode == "collect":
            new_of[small] = big.size
            out_keys.append([SMALL_KEY])
            out_counts.append(int(counts[small].sum()))
    n_groups = len(out_keys)
    dtype = np.uint8 if n_groups <= 0xFF else np.uint16
    none = 0xFF if dtype == np.uint8 else NONE16
    lut = np.where(new_of >= 0, new_of, none).astype(dtype)
    lut = np.append(lut, np.array([none], dtype=dtype))
    if fold.pending is not None:                   # the compaction's numbering and this one, in one pass
        lut = lut[np.where(fold.pending == fold.none, k, fold.pending)]
    elif np.array_equal(new_of, np.arange(k)):
        lut = None
    if dtype == fold.codes.dtype:                  # in place: the codes are never held twice (CMP-4)
        if lut is not None:
            fold.remap(lut)
        codes = fold.codes
    else:
        codes = np.empty(fold.codes.size, dtype=dtype)
        if lut is None:
            lut = np.append(np.arange(k), none).astype(dtype)
        full = _full_lookup(lut, fold.codes.dtype)
        for a, b in _spans(codes.size):
            c = fold.codes[a:b]
            codes[a:b] = full[c] if full is not None else lut[np.where(c == fold.none, lut.size - 1, c)]
    groups = [{"key": key, "n": int(n)} for key, n in zip(out_keys, out_counts)]
    return groups, codes, info


def compute(plan_: Plan, shown_rows: Optional[np.ndarray] = None, *, codes: Optional[GroupingResult] = None,
            should_stop: Optional[Callable[[], bool]] = None, pause=None,
            on_entries: Optional[Callable[[int], None]] = None) -> Iterator[Tuple[str, Any]]:
    """Resolve the grouping over the cells ``shown_rows`` (sorted dataset rows; None: all cells).

    Yields ``("progress", {"stage": "groups", "done", "total"})`` per partitioning and a final
    ``("result", GroupingResult)``. While a score source computes (a ``gene-score`` partitioning, or one inside a
    grouping used as a source) its reads add ``("progress", {"stage": "groups", "done", "total", "genes_done",
    "genes_total"})``, ``done`` still the partitionings done, so the stream is never silent for long.
    ``codes`` is a result from the code cache: it is the answer, nothing is read.
    ``should_stop`` is asked between slabs (true raises ``gene_score.ScoreCancelled``); ``pause`` (``wanted()``,
    ``wait()``) is honoured between slabs and passed to a score's pipeline. ``on_entries(n)`` is told the stored
    entries read: a score's as it reads them, a column's once it is read; the calls add up to ``plan_.entries``
    unless the grouping is refused before every partitioning is read.
    """
    total = len(plan_.top.parts)
    if codes is not None:
        yield "result", codes
        return
    rows = None if shown_rows is None else np.asarray(shown_rows, dtype=np.int64)
    n_shown = plan_.n_cells if rows is None else int(rows.size)
    ctx = _Ctx(plan_.reader, plan_.dataset_path, plan_.request, rows, n_shown, should_stop, pause, on_entries)
    yield "progress", {"stage": "groups", "done": 0, "total": total}
    steps = _resolving(plan_.top, ctx)
    done = 0
    while True:
        try:
            event, payload = next(steps)
        except StopIteration as stop:
            yield "result", stop.value
            return
        if event == "part":
            done = payload
            yield "progress", {"stage": "groups", "done": done, "total": total}
        else:
            yield "progress", {"stage": "groups", "done": done, "total": total, "genes_done": payload[0],
                               "genes_total": payload[1]}
