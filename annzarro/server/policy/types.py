"""The value types of policy keys.

A type knows four things about its values: whether one is valid (and its
canonical form), which of several is the most restrictive (``combine:
"restrict"``), which one means "off" (what ``policy.requires`` refuses on),
and how to describe itself to the Settings page. It knows nothing about
layers or storage.

``validate`` returns the canonical value or raises :class:`PolicyValueError`
with one of the reasons the admin API reports: ``bad_type``, ``out_of_range``
or ``bad_choice``.
"""
import math
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

BAD_TYPE = "bad_type"
OUT_OF_RANGE = "out_of_range"
BAD_CHOICE = "bad_choice"


class PolicyValueError(ValueError):
    """A value a type does not accept. ``reason`` is one of the constants above."""

    def __init__(self, reason: str, message: str = ""):
        super().__init__(message or reason)
        self.reason = reason


class PolicyType:
    """Base of the value types. ``kind`` is what the Settings page switches on."""

    kind = ""

    def validate(self, value: Any) -> Any:
        raise NotImplementedError

    def restrict(self, values: Sequence[Any]) -> Any:
        """The most restrictive of ``values`` (at least one, all valid)."""
        raise NotImplementedError

    @property
    def off(self) -> Tuple[Any, ...]:
        """The values ``policy.requires`` treats as "disabled"; empty when the
        type cannot gate a route."""
        return ()

    def describe(self) -> Dict[str, Any]:
        return {"kind": self.kind}

    def samples(self) -> Optional[Tuple[Any, Any]]:
        """``(permissive, restrictive)``: two distinct valid values, the second
        more restrictive than the first, or None when the type has only one
        value. Lets tests exercise any key without knowing what it governs."""
        raise NotImplementedError


class Bool(PolicyType):
    """True or false. ``restrictive`` is the value that restricts: False for an
    "enabled" switch (the default), True for a "disabled" one."""

    kind = "bool"

    def __init__(self, restrictive: bool = False):
        self.restrictive = bool(restrictive)

    def validate(self, value):
        if not isinstance(value, bool):
            raise PolicyValueError(BAD_TYPE, "expected true or false")
        return value

    def restrict(self, values):
        return self.restrictive if any(v is self.restrictive for v in values) else not self.restrictive

    @property
    def off(self):
        return (self.restrictive,)

    def samples(self):
        return (not self.restrictive, self.restrictive)


class Enum(PolicyType):
    """One of a list of ids.

    ``choices`` are ids, or ``{id, label, host}`` dicts the Settings page shows
    with their labels. They are listed from the most permissive to the most
    restrictive, which is the order ``restrict`` uses. ``off`` names the ids
    ``policy.requires`` refuses. ``aliases`` maps spellings the YAML has always
    allowed (``True``, ``"off"``) to an id.
    """

    kind = "enum"

    def __init__(self, choices: Sequence[Any], off: Sequence[str] = (), aliases: Optional[Dict[Any, str]] = None):
        self.choices = list(choices)
        self.ids = [c["id"] if isinstance(c, dict) else c for c in self.choices]
        if not self.ids or len(set(self.ids)) != len(self.ids) or not all(isinstance(i, str) for i in self.ids):
            raise ValueError(f"Enum needs distinct string ids, got {self.ids!r}")
        unknown = [o for o in off if o not in self.ids]
        if unknown:
            raise ValueError(f"Enum off values {unknown!r} are not choices")
        self._off = tuple(off)
        self.aliases = dict(aliases or {})

    def validate(self, value):
        if not isinstance(value, (bool, str)):
            raise PolicyValueError(BAD_TYPE, "expected one of " + ", ".join(self.ids))
        if value in self.ids:
            return value
        spelling = value.strip().lower() if isinstance(value, str) else value
        if spelling in self.aliases:
            return self.aliases[spelling]
        if isinstance(value, bool):
            raise PolicyValueError(BAD_TYPE, "expected one of " + ", ".join(self.ids))
        raise PolicyValueError(BAD_CHOICE, f"{value!r} is not one of " + ", ".join(self.ids))

    def restrict(self, values):
        return max(values, key=self.ids.index)

    @property
    def off(self):
        return self._off

    def describe(self):
        return {"kind": self.kind, "choices": list(self.choices)}

    def samples(self):
        return (self.ids[0], self.ids[-1]) if len(self.ids) > 1 else None


class _Number(PolicyType):
    integer = False

    def __init__(self, min: Optional[float] = None, max: Optional[float] = None, restrictive: str = "low"):
        if restrictive not in ("low", "high"):
            raise ValueError("restrictive is 'low' or 'high'")
        if min is not None and max is not None and min > max:
            raise ValueError("min is above max")
        self.min, self.max, self.restrictive = min, max, restrictive

    def validate(self, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise PolicyValueError(BAD_TYPE, "expected a number")
        if isinstance(value, float) and not math.isfinite(value):
            raise PolicyValueError(BAD_TYPE, "expected a finite number")
        if self.integer and isinstance(value, float):
            if not value.is_integer():
                raise PolicyValueError(BAD_TYPE, "expected a whole number")
            value = int(value)
        if (self.min is not None and value < self.min) or (self.max is not None and value > self.max):
            raise PolicyValueError(OUT_OF_RANGE, f"expected {self._range()}")
        return value

    def _range(self) -> str:
        if self.min is not None and self.max is not None:
            return f"{self.min} to {self.max}"
        return f"at least {self.min}" if self.min is not None else f"at most {self.max}"

    def restrict(self, values):
        return min(values) if self.restrictive == "low" else max(values)

    def describe(self):
        out = {"kind": self.kind}
        if self.min is not None:
            out["min"] = self.min
        if self.max is not None:
            out["max"] = self.max
        return out

    def samples(self):
        lo = self.min if self.min is not None else (self.max - 2 if self.max is not None else 0)
        hi = self.max if self.max is not None else lo + 2
        if lo == hi:
            return None
        lo, hi = (lo, hi) if not self.integer else (math.ceil(lo), math.floor(hi))
        if lo == hi:
            return None
        return (hi, lo) if self.restrictive == "low" else (lo, hi)


class Int(_Number):
    kind = "int"
    integer = True


class Float(_Number):
    kind = "float"


_HOST = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*(:\d{1,5})?$")


class _List(PolicyType):
    """A list with no repeats. The most restrictive of several is what they all
    contain: a layer can narrow the list, never add to it."""

    def _item(self, item: Any) -> Any:
        raise NotImplementedError

    def validate(self, value):
        if not isinstance(value, (list, tuple)):
            raise PolicyValueError(BAD_TYPE, "expected a list")
        out: List[Any] = []
        for item in value:
            item = self._item(item)
            if item not in out:
                out.append(item)
        return self._order(out)

    def _order(self, items: List[Any]) -> List[Any]:
        return items

    def restrict(self, values):
        common = [v for v in values[0] if all(v in other for other in values[1:])]
        return self._order(common)

    def samples(self):
        return None if not self._universe() else ([*self._universe()], [])

    def _universe(self) -> List[Any]:
        return ["example.org", "example.net"]


class Hosts(_List):
    """Host names the browser may contact (lower case, optional port)."""

    kind = "hosts"

    def _item(self, item):
        if not isinstance(item, str):
            raise PolicyValueError(BAD_TYPE, "expected host names")
        host = item.strip().lower()
        if not _HOST.match(host):
            raise PolicyValueError(BAD_TYPE, f"{item!r} is not a host name")
        return host


class Paths(_List):
    """Absolute server paths."""

    kind = "paths"

    def _item(self, item):
        if not isinstance(item, str) or not item.strip() or "\x00" in item:
            raise PolicyValueError(BAD_TYPE, "expected paths")
        return item.strip()

    def _universe(self):
        return ["/srv/a", "/srv/b"]


class Subset(_List):
    """Any subset of ``choices`` (ids, or ``{id, label, host}`` dicts), kept in
    the order of ``choices``."""

    kind = "subset"

    def __init__(self, choices: Sequence[Any]):
        self.choices = list(choices)
        self.ids = [c["id"] if isinstance(c, dict) else c for c in self.choices]
        if len(set(self.ids)) != len(self.ids) or not all(isinstance(i, str) for i in self.ids):
            raise ValueError(f"Subset needs distinct string ids, got {self.ids!r}")

    def _item(self, item):
        if not isinstance(item, str):
            raise PolicyValueError(BAD_TYPE, "expected ids")
        if item not in self.ids:
            raise PolicyValueError(BAD_CHOICE, f"{item!r} is not one of " + ", ".join(self.ids))
        return item

    def _order(self, items):
        return sorted(items, key=self.ids.index)

    def describe(self):
        return {"kind": self.kind, "choices": list(self.choices)}

    def _universe(self):
        return list(self.ids)


class RemoteAccess(PolicyType):
    """Which remote (URL) locations the server may read datasets from.

    The value is ``{"mode": "off" | "allowlist" | "any", "allowlist": [prefix, ...]}``;
    the list is empty unless the mode is ``allowlist``. Prefixes are normalised
    (lower-case scheme and host, a trailing ``/``) and validated like
    ``server.remote_allowlist``. The most restrictive of several values is
    ``off`` if any is off, else what every allowlist permits (prefixes narrowed
    pairwise; nothing in common is ``off``), else ``any``.
    """

    kind = "remote_access"
    MODES = ("any", "allowlist", "off")

    @staticmethod
    def prefix(item: Any) -> str:
        """The canonical form of one allowlist entry, or a PolicyValueError saying what is wrong."""
        from ...core.remote import REMOTE_SCHEMES, _Prefix, validate_remote_url
        if not isinstance(item, str) or not item.strip():
            raise PolicyValueError(BAD_TYPE, "expected a URL prefix")
        text = item.strip()
        scheme = text.split("://", 1)[0].lower() if "://" in text else ""
        if scheme not in REMOTE_SCHEMES:
            raise PolicyValueError(BAD_TYPE, f"{text!r} must start with one of "
                                   + ", ".join(f"{s}://" for s in sorted(REMOTE_SCHEMES)))
        try:
            validate_remote_url(text)
            parsed = _Prefix.parse(text)
        except ValueError as exc:
            raise PolicyValueError(BAD_TYPE, str(exc))
        return f"{parsed.scheme}://{parsed.netloc}{parsed.path or '/'}"

    def validate(self, value):
        if not isinstance(value, dict):
            raise PolicyValueError(BAD_TYPE, "expected {mode, allowlist}")
        mode = value.get("mode")
        if mode not in self.MODES:
            raise PolicyValueError(BAD_CHOICE, "mode is one of " + ", ".join(self.MODES))
        listed = value.get("allowlist", [])
        if not isinstance(listed, (list, tuple)):
            raise PolicyValueError(BAD_TYPE, "allowlist must be a list")
        out: List[str] = []
        for item in listed:
            item = self.prefix(item)
            if item not in out:
                out.append(item)
        if mode == "allowlist" and not out:
            raise PolicyValueError(BAD_TYPE, "an allowlist needs at least one location")
        if mode != "allowlist" and out:
            raise PolicyValueError(BAD_TYPE, "only the allowlist mode takes locations")
        return {"mode": mode, "allowlist": out}

    @staticmethod
    def _under(inner: str, outer: str) -> bool:
        return inner.startswith(outer)      # both end in '/', so this is a path boundary

    def restrict(self, values):
        if any(v["mode"] == "off" for v in values):
            return {"mode": "off", "allowlist": []}
        lists = [v["allowlist"] for v in values if v["mode"] == "allowlist"]
        if not lists:
            return {"mode": "any", "allowlist": []}
        common = lists[0]
        for other in lists[1:]:
            narrowed: List[str] = []
            for a in common:
                for b in other:
                    keep = a if self._under(a, b) else (b if self._under(b, a) else None)
                    if keep is not None and keep not in narrowed:
                        narrowed.append(keep)
            common = narrowed
        return {"mode": "allowlist", "allowlist": common} if common else {"mode": "off", "allowlist": []}

    def describe_change(self, old, new):
        """For the audit log: the allowlist entries added and removed."""
        before = set((old or {}).get("allowlist", []))
        after = set((new or {}).get("allowlist", []))
        return {"allowlist_added": sorted(after - before), "allowlist_removed": sorted(before - after)}

    def samples(self):
        return ({"mode": "any", "allowlist": []}, {"mode": "off", "allowlist": []})
