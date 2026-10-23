"""Paste to focus: the rules that turn pasted text into a focused cell or gene.

Pressing Ctrl+V / Cmd+V outside a text field makes the page read the clipboard text and try the
rules in order (static/js/utils/paste-focus.js). A rule is ``{pattern, dataset_match, enabled}``:
a JavaScript regular expression with the named groups ``cell``, ``gene`` and optionally
``dataset``, and how the ``dataset`` group is compared with the listed stores' names.

Two policy keys, both read by the browser:

* ``ui.paste_focus.enabled``: the switch.
* ``ui.paste_focus.rules``: the rules. The default is one rule, the whole trimmed text as one
  token, tried as a cell name and then as a gene name.

The patterns run in the page, in the browser's own regex engine, so they are checked here for the
JavaScript flavour: a pattern Python accepts that JavaScript refuses (``(?P<n>``, ``(?i)``, atomic
groups, possessive quantifiers, ``\\A``) is refused, and so is one JavaScript accepts that Python
cannot compile (a lookbehind of unbounded length). That is stricter than JavaScript, never looser.
A pattern that backtracks badly slows only the tabs of the people the site serves; the page caps
the pasted text at 4,096 characters.
"""
import re
from typing import Any, List

from annzarro.server.policy.registry import Key, declare, policy_guide
from annzarro.server.policy.types import BAD_TYPE, OUT_OF_RANGE, Bool, PolicyType, PolicyValueError

ENABLED_KEY = "ui.paste_focus.enabled"
RULES_KEY = "ui.paste_focus.rules"
MAX_RULES = 20
MAX_PATTERN = 500
MAX_TEXT = 4096
DATASET_MATCHES = ("exact", "prefix", "contains")
#: The whole trimmed text is one token: a cell name, else a gene name (the lookahead captures it twice)
DEFAULT_PATTERN = r"^(?=(?<gene>\S+)$)(?<cell>\S+)$"
DEFAULT_RULE = {"pattern": DEFAULT_PATTERN, "dataset_match": "prefix", "enabled": True}

_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*$")
#: escapes JavaScript knows (without the u flag) that mean the same in Python
_ESCAPES = set("dDwWsStnrfv0bB")


def check_pattern(pattern: Any) -> str:
    """The pattern, or PolicyValueError saying what is wrong with it for a JavaScript regex."""
    if not isinstance(pattern, str) or not pattern.strip():
        raise PolicyValueError(BAD_TYPE, "a rule needs a pattern")
    if len(pattern) > MAX_PATTERN:
        raise PolicyValueError(OUT_OF_RANGE, f"a pattern has at most {MAX_PATTERN} characters")
    translated: List[str] = []
    names: List[str] = []
    i, n = 0, len(pattern)
    in_class = False
    quantifier = False          # the previous token was a quantifier (a `+` right after is possessive)
    while i < n:
        c = pattern[i]
        if c == "\\":
            if i + 1 >= n:
                raise PolicyValueError(BAD_TYPE, "the pattern ends with a lone backslash")
            d = pattern[i + 1]
            if d == "k" and not in_class:
                m = re.match(r"k<([A-Za-z_][A-Za-z0-9_]*)>", pattern[i + 1:])
                if not m:
                    raise PolicyValueError(BAD_TYPE, r"\k must be followed by <group name>")
                translated.append(f"(?P={m.group(1)})")
                i += 1 + m.end()
                quantifier = False
                continue
            if d.isalpha() and d not in _ESCAPES and d not in "xuc":
                raise PolicyValueError(BAD_TYPE, f"\\{d} is not supported in JavaScript regular expressions")
            if d == "c":
                raise PolicyValueError(BAD_TYPE, r"\c is not supported here")
            translated.append(pattern[i:i + 2])
            i += 2
            quantifier = False
            continue
        if in_class:
            if c == "]":
                in_class = False
            elif c == "[":
                translated.append("\\")      # a literal [ inside a class; Python warns about nested sets
            translated.append(c)
            i += 1
            continue
        if c == "[":
            in_class = True
            translated.append(c)
            i += 1
            if i < n and pattern[i] == "^":
                translated.append("^")
                i += 1
            if i < n and pattern[i] == "]":      # JavaScript: [] is empty, []] is not a class with ]
                raise PolicyValueError(BAD_TYPE, "an empty character class [] is not supported")
            quantifier = False
            continue
        if c == "(" and pattern.startswith("(?", i):
            m = re.match(r"\(\?(?:<([A-Za-z_$][A-Za-z0-9_$]*)>|:|=|!|<=|<!)", pattern[i:])
            if not m:
                raise PolicyValueError(BAD_TYPE, "only (?:...), (?=...), (?!...), (?<=...), (?<!...) and "
                                                 "(?<name>...) groups exist in JavaScript regular expressions")
            if m.group(1) is not None:
                name = m.group(1)
                if not _NAME.match(name):
                    raise PolicyValueError(BAD_TYPE, f"group name {name!r}: use letters, digits and _")
                names.append(name)
                translated.append(f"(?P<{name}>")
            else:
                translated.append(m.group(0))
            i += m.end()
            quantifier = False
            continue
        brace = re.match(r"\{\d+(,\d*)?\}", pattern[i:]) if c == "{" else None
        if c in "*+?" or brace:
            if quantifier and c == "+":
                raise PolicyValueError(BAD_TYPE, "possessive quantifiers (*+, ++) are not supported in JavaScript")
            width = brace.end() if brace else 1
            translated.append(pattern[i:i + width])
            i += width
            # a `?` right after a quantifier makes it lazy and ends it
            quantifier = not (quantifier and c == "?")
            continue
        translated.append(c)
        i += 1
        quantifier = False
    if in_class:
        raise PolicyValueError(BAD_TYPE, "unterminated character class")
    try:
        re.compile("".join(translated))
    except (re.error, RecursionError, OverflowError) as exc:
        raise PolicyValueError(BAD_TYPE, f"not a valid regular expression: {exc}")
    if "cell" not in names and "gene" not in names:
        raise PolicyValueError(BAD_TYPE, "the pattern needs a (?<cell>...) or a (?<gene>...) group")
    return pattern


class PasteRules(PolicyType):
    """A list of ``{pattern, dataset_match, enabled}``, tried in order."""

    kind = "paste_rules"

    def validate(self, value):
        if not isinstance(value, (list, tuple)):
            raise PolicyValueError(BAD_TYPE, "expected a list of rules")
        if len(value) > MAX_RULES:
            raise PolicyValueError(OUT_OF_RANGE, f"at most {MAX_RULES} rules")
        out = []
        for position, rule in enumerate(value, 1):
            if not isinstance(rule, dict) or set(rule) - {"pattern", "dataset_match", "enabled"}:
                raise PolicyValueError(BAD_TYPE, f"rule {position}: expected pattern, dataset_match and enabled")
            match = rule.get("dataset_match", "prefix")
            if match not in DATASET_MATCHES:
                raise PolicyValueError(BAD_TYPE, f"rule {position}: dataset_match is one of {', '.join(DATASET_MATCHES)}")
            enabled = rule.get("enabled", True)
            if not isinstance(enabled, bool):
                raise PolicyValueError(BAD_TYPE, f"rule {position}: enabled is true or false")
            try:
                pattern = check_pattern(rule.get("pattern"))
            except PolicyValueError as exc:
                raise PolicyValueError(exc.reason, f"rule {position}: {exc}")
            out.append({"pattern": pattern, "dataset_match": match, "enabled": enabled})
        return out

    def restrict(self, values):
        return values[0]

    def describe(self):
        return {"kind": self.kind, "max_rules": MAX_RULES, "max_pattern": MAX_PATTERN, "max_text": MAX_TEXT,
                "dataset_matches": list(DATASET_MATCHES), "default_rule": dict(DEFAULT_RULE)}

    def samples(self):
        return ([dict(DEFAULT_RULE)], [])


def _declare() -> None:
    declare(Key(
        name=ENABLED_KEY, type=Bool(), default=True, scope="server", area="features",
        config_path=ENABLED_KEY, label="Paste to focus", guide=policy_guide(ENABLED_KEY, "deployment/admin.html"),
        description="Pressing Ctrl+V or Cmd+V outside a text field sets the focused cell or gene from the "
                    "clipboard text, by the rules below. On by default."))
    declare(Key(
        name=RULES_KEY, type=PasteRules(), default=[dict(DEFAULT_RULE)], scope="server", area="features",
        config_path=RULES_KEY, label="Paste to focus rules", guide=policy_guide(RULES_KEY, "deployment/admin.html"),
        description="How pasted text names a cell or a gene: regular expressions with the named groups cell, gene "
                    "and optionally dataset, tried in order, the first match wins. The default rule takes the whole "
                    "text as one cell or gene name."))


_declare()
