"""No browser test waits on an async predicate with page.wait_for_function.

Playwright's wait_for_function does not await a promise the predicate
returns: an async predicate returns a Promise, which is truthy, so the wait
passes at once and the test races the app (memory-guard found it: its waits
for the ledger and for cell names never waited). Poll with page.evaluate
instead (see `until` in test_memory_guard.py).
"""
import pathlib
import re

BROWSER = pathlib.Path(__file__).resolve().parents[1] / "browser"
ASYNC_WAIT = re.compile(r"wait_for_function\(\s*f?(\"\"\"|\"|')\s*async\b")


def test_no_async_predicates():
    offenders = []
    for path in sorted(BROWSER.glob("*.py")):
        text = path.read_text()
        for m in ASYNC_WAIT.finditer(text):
            offenders.append(f"{path.name}:{text.count(chr(10), 0, m.start()) + 1}")
    assert not offenders, "wait_for_function with an async predicate passes at once: " + ", ".join(offenders)
