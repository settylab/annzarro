"""Source guard: no ``Math.min(...arr)`` / ``Math.max(...arr)`` over data arrays.

BUG #2 was a spread of a ~100k-element column into ``Math.min`` / ``Math.max``,
overflowing V8's call stack. The fix routes color-scale extrema through the
loop-based helpers in ``static/js/utils/array-stats.js``. This guard greps the
front-end source so the dangerous idiom can't creep back into a color/min-max
path -- it needs no node runtime, so it runs even where the JS test is skipped.

Self-activating: it only enforces once the helper module exists (i.e. once the
fix has landed), so it never false-fails a pre-fix checkout.
"""
import os
import re

import pytest

_THIS = os.path.abspath(__file__)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(_THIS))))
JS_ROOT = os.path.join(REPO_ROOT, "static", "js")
HELPER = os.path.join(JS_ROOT, "utils", "array-stats.js")

# Spreading any identifier (an array/typed-array) into Math.min/Math.max is the
# overflow-prone idiom. Spreading a literal list (Math.max(...[a, b])) is fine but
# vanishingly rare and still better expressed otherwise, so we flag the bare
# `...<identifier>` form only.
UNSAFE = re.compile(r"Math\.(?:min|max)\(\s*\.\.\.\s*[A-Za-z_$]")


def _js_files():
    for root, _dirs, files in os.walk(JS_ROOT):
        for f in files:
            if f.endswith(".js"):
                yield os.path.join(root, f)


def test_no_unsafe_math_minmax_spread():
    if not os.path.isfile(HELPER):
        pytest.skip(
            "array-stats.js not present -- stack-overflow fix not yet applied; "
            "source guard inactive"
        )
    offenders = []
    for path in _js_files():
        # The helper's own module doc-comment names the idiom on purpose.
        if os.path.abspath(path) == os.path.abspath(HELPER):
            continue
        with open(path, encoding="utf-8") as fh:
            for lineno, line in enumerate(fh, 1):
                if UNSAFE.search(line):
                    rel = os.path.relpath(path, REPO_ROOT)
                    offenders.append(f"{rel}:{lineno}: {line.strip()}")
    assert not offenders, (
        "Math.min(...)/Math.max(...) spread over an array can overflow the stack "
        "on large columns (BUG #2). Use arrayMin/arrayMax/arrayMinMax from "
        "static/js/utils/array-stats.js instead:\n" + "\n".join(offenders)
    )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
