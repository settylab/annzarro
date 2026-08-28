"""Source guard: a panel may not draw without stating what it is missing.

## What this exists to prevent

On 2026-08-28 users reported that liver-met samples "show no celltype / sample
columns". For 10 of 33 datasets the reader raised, a bare ``except`` returned
``[], []``, and the API answered HTTP 200 with ``{"celltype": [], "sample": []}``.
The UI drew an empty plot and said nothing. Every layer reported success.

Repairing the reader closes that one hole. It does not stop the NEXT render
path from being silent, and the front end had a dozen places where "no data"
reached the screen as a bare ``alert-warning`` naming a symptom
("Insufficient data for plotting") with no cause, or as nothing at all.

The fix routes every draw through ``static/js/utils/panel-surface.js``, whose
entry points each take a ``Coverage`` (``static/js/utils/coverage.js``) and
render ``Coverage.unreported()`` -- a loud, visible badge -- when handed none.
That makes forgetting VISIBLE. This guard makes routing AROUND it visible too.

## What is checked, and what is not

Three structural invariants, each with an in-test positive control so the
predicate is never merely asserted:

  1. ``Plotly.newPlot`` / ``Plotly.react`` appear only inside the surface
     module. Those two create a plot from nothing; every other Plotly verb
     (``restyle``, ``relayout``, ``addTraces``, ``purge``) mutates a plot that
     already carries its notice, so they are deliberately NOT restricted.
  2. No panel module assigns a raw Bootstrap ``alert-danger`` / ``alert-warning``
     block into a container. That is the "symptom without a cause" idiom the
     incident produced; ``drawPlaceholder`` is the replacement and it cannot be
     called without a reason.
  3. No bare ``except`` handler in ``annzarro/server/routes/`` -- the server-side
     half of the same defect, which answered every reader failure with a single
     wrong sentence ("Cannot handle this file type"). Checked via AST, so a
     docstring quoting the old idiom is documentation rather than an instance.

COVERAGE BOUNDARY, one sentence: this guard is keyed on the two SOURCE
CONSTRUCTS through which pixels reach a panel (the Plotly create verbs and
container ``innerHTML`` assignment) plus one server construct (a bare handler),
so it catches a new render path written in the existing idioms and does NOT
catch one that paints by a mechanism none of those three describe -- e.g. a new
charting library, ``appendChild`` of a pre-built node, or a template rendered
server-side.
"""
import ast
import os
import re

import pytest

_THIS = os.path.abspath(__file__)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(_THIS))))
JS_ROOT = os.path.join(REPO_ROOT, "static", "js")
PANELS_ROOT = os.path.join(JS_ROOT, "panels")
SURFACE = os.path.join(JS_ROOT, "utils", "panel-surface.js")
COVERAGE_MOD = os.path.join(JS_ROOT, "utils", "coverage.js")
ROUTES_ROOT = os.path.join(REPO_ROOT, "annzarro", "server", "routes")

# `newPlot` and `react` build a plot from nothing and so must carry a Coverage.
# Mutating verbs act on a plot that already has its notice and are exempt.
PLOTLY_CREATE = re.compile(r"\bPlotly\.(newPlot|react)\s*\(")

# The "symptom without a cause" idiom: a Bootstrap alert block written straight
# into a container. `alert-info` is NOT included -- it is used for advisory
# hints appended UNDER a placeholder, which is guidance, not a gap statement.
RAW_ALERT = re.compile(r"innerHTML\s*=(?![=]).{0,400}?alert-(?:danger|warning)", re.S)


# --------------------------------------------------------------------------
# predicates (pure, so they can be exercised on known input below)
# --------------------------------------------------------------------------

def _find(pattern, text):
    """Line numbers in `text` matching `pattern`. 1-indexed."""
    return sorted({text.count("\n", 0, m.start()) + 1 for m in pattern.finditer(text)})


def _bare_handler_lines(source):
    """Line numbers of bare `except:` HANDLERS, via AST -- not text matching."""
    tree = ast.parse(source)
    return sorted(
        h.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.Try)
        for h in node.handlers
        if h.type is None
    )


def _js_files(root):
    for dirpath, _dirs, files in os.walk(root):
        for f in sorted(files):
            if f.endswith(".js"):
                yield os.path.join(dirpath, f)


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _rel(path):
    return os.path.relpath(path, REPO_ROOT)


# --------------------------------------------------------------------------
# 0. the mechanism itself must be present and must fail loud
# --------------------------------------------------------------------------

def test_the_chokepoint_exists_and_defaults_loudly():
    """A guard whose subject is absent proves nothing; assert the subject first.

    This is not ceremony. The rest of this file checks that nobody ROUTES
    AROUND `panel-surface.js`; if that module were deleted or its loud default
    quietly removed, every other test here would still pass while the UI went
    back to drawing silently.
    """
    assert os.path.isfile(COVERAGE_MOD), f"missing {_rel(COVERAGE_MOD)}"
    assert os.path.isfile(SURFACE), f"missing {_rel(SURFACE)}"

    surface = _read(SURFACE)
    assert "Coverage.unreported(" in surface, (
        f"{_rel(SURFACE)} no longer falls back to Coverage.unreported(). "
        "A missing coverage must render a visible badge, not nothing -- that "
        "loud default is the entire mechanism."
    )
    cov = _read(COVERAGE_MOD)
    for reason in ("EMPTY", "FAILED", "FILTERED", "UNAVAILABLE", "CAPPED", "UNREPORTED"):
        assert f"{reason}:" in cov, f"GAP.{reason} missing from {_rel(COVERAGE_MOD)}"


# --------------------------------------------------------------------------
# 1. Plotly create verbs are confined to the surface module
# --------------------------------------------------------------------------

def test_plotly_create_predicate_flags_a_bypass():
    """Positive control: the predicate must actually fire on the bad shape."""
    bad = "function draw(el, t, l) {\n  Plotly.newPlot(el, t, l, {});\n}\n"
    assert _find(PLOTLY_CREATE, bad) == [2]
    assert _find(PLOTLY_CREATE, "  Plotly.react(el, t, l);\n") == [1]


def test_plotly_create_predicate_ignores_mutating_verbs():
    """Negative control: the exemptions are exemptions, not oversights."""
    ok = ("Plotly.restyle(el, u, [0]);\nPlotly.relayout(el, u);\n"
          "Plotly.addTraces(el, t);\nPlotly.deleteTraces(el, 0);\nPlotly.purge(el);\n")
    assert _find(PLOTLY_CREATE, ok) == []


def test_no_plotly_create_outside_the_surface_module():
    offenders = []
    for path in _js_files(JS_ROOT):
        if os.path.abspath(path) == os.path.abspath(SURFACE):
            continue
        for lineno in _find(PLOTLY_CREATE, _read(path)):
            offenders.append(f"{_rel(path)}:{lineno}")
    assert not offenders, (
        "Plotly.newPlot/react creates a plot from nothing and so must state the "
        "panel's Coverage. Call drawPlot() from static/js/utils/panel-surface.js "
        "instead -- it takes the Coverage and cannot draw without deciding what "
        "to say about it:\n  " + "\n  ".join(offenders)
    )


# --------------------------------------------------------------------------
# 2. no raw alert block written into a panel container
# --------------------------------------------------------------------------

def test_raw_alert_predicate_flags_the_old_idiom():
    """Positive control, using the exact text this guard was written against."""
    bad = (
        "plotContainer.innerHTML =\n"
        "  '<div class=\"alert alert-warning\">Insufficient data for plotting</div>';\n"
    )
    assert _find(RAW_ALERT, bad) == [1], "the predicate missed the incident's own idiom"
    bad2 = '_tableContainer.innerHTML = `<div class="alert alert-danger">Error: ${e}</div>`;\n'
    assert _find(RAW_ALERT, bad2) == [1]


def test_raw_alert_predicate_ignores_advisory_hints_and_comparisons():
    """Negative control: advisory `alert-info` and equality tests are not gaps."""
    ok = (
        'extra.innerHTML = `${errorDetails}${suggestedActions}`;\n'
        "suggestedActions = '<div class=\"alert alert-info mt-3\">Try this</div>';\n"
        'if (el.innerHTML === wanted) { return; }\n'
    )
    assert _find(RAW_ALERT, ok) == []


def test_no_raw_alert_blocks_in_panel_modules():
    offenders = []
    for path in _js_files(PANELS_ROOT):
        for lineno in _find(RAW_ALERT, _read(path)):
            offenders.append(f"{_rel(path)}:{lineno}")
    assert not offenders, (
        "A raw alert block states a SYMPTOM with no cause -- exactly what left "
        "users unable to tell an empty column from a broken one. Use "
        "drawPlaceholder(container, coverage) from "
        "static/js/utils/panel-surface.js, which requires a reason:\n  "
        + "\n  ".join(offenders)
    )


# --------------------------------------------------------------------------
# 3. no bare except handler in the API routes
# --------------------------------------------------------------------------

def test_bare_handler_predicate_flags_and_exempts_correctly():
    """Positive AND negative control for the AST predicate in one place.

    The negative half matters as much as the positive: a text-matching version
    of this check flagged its own docstring, which is how a guard ends up being
    weakened to make itself pass.
    """
    bad = "def f():\n    try:\n        g()\n    except:\n        return None\n"
    assert _bare_handler_lines(bad) == [4]

    ok = (
        'def f():\n'
        '    """Replaces a bare handler written as except: with a typed one."""\n'
        '    try:\n'
        '        g()\n'
        '    except (ValueError, TypeError):\n'
        '        return None\n'
        '    except Exception as exc:\n'
        '        raise RuntimeError(str(exc))\n'
    )
    assert _bare_handler_lines(ok) == []


def test_no_bare_except_in_api_routes():
    offenders = []
    for f in sorted(os.listdir(ROUTES_ROOT)):
        if not f.endswith(".py"):
            continue
        path = os.path.join(ROUTES_ROOT, f)
        for lineno in _bare_handler_lines(_read(path)):
            offenders.append(f"{_rel(path)}:{lineno}")
    assert not offenders, (
        "A bare except in a route destroys the reason the front end needs to "
        "tell 'empty' from 'broken' -- every one of these used to answer "
        "'Cannot handle this file type' regardless of what actually happened. "
        "Catch the type you mean and return a `reason` code:\n  "
        + "\n  ".join(offenders)
    )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
