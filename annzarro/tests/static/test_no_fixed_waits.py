"""Guard (0.8.0): browser tests wait on conditions, never on the clock.

A browser or e2e test file may not call ``wait_for_timeout``, ``time.sleep`` or ``asyncio.sleep``. The one
allowed pause is a negative assertion through ``browser.waits.expect_stays(check, reason)``. Files that already
waited on the clock when this guard was added are listed in ``fixed_waits_legacy.json`` with their count as a
ceiling; the count may fall, never rise, and a file not listed has a ceiling of 0.
"""
import json
import pathlib
import re

TESTS = pathlib.Path(__file__).resolve().parents[1]
LEGACY = json.loads((pathlib.Path(__file__).with_name("fixed_waits_legacy.json")).read_text())["ceilings"]
FIXED = re.compile(r"wait_for_timeout\(|time\.sleep\(|asyncio\.sleep\(")
DIRS = ("browser", "e2e")
HELPER = "browser/waits.py"


def violations(root, legacy):
    """``["path: n fixed waits, ceiling m"]`` for every file over its ceiling, paths relative to ``root``."""
    found = []
    for d in DIRS:
        for path in sorted((root / d).glob("**/*.py")):
            rel = path.relative_to(root).as_posix()
            if rel == HELPER:
                continue
            n = len(FIXED.findall(path.read_text()))
            if n > legacy.get(rel, 0):
                found.append(f"{rel}: {n} fixed waits, ceiling {legacy.get(rel, 0)}")
    return found


def test_no_new_fixed_waits():
    found = violations(TESTS, LEGACY)
    assert not found, ("Wait on a condition (expect, wait_for_function, a response, [data-state]); before a negative "
                       "assertion use browser.waits.expect_stays(check, reason):\n" + "\n".join(found))


def test_every_legacy_file_still_exists():
    missing = [rel for rel in LEGACY if not (TESTS / rel).is_file()]
    assert not missing, "fixed_waits_legacy.json lists files that are gone; remove the entries: " + ", ".join(missing)


def _tree(tmp_path, files):
    for rel, text in files.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    return tmp_path


def test_planted_violations_are_found(tmp_path):
    root = _tree(tmp_path, {
        "browser/test_new.py": "def test_a(page):\n    page.wait_for_timeout(500)\n",
        "browser/test_new_sleep.py": "import time\ndef test_a():\n    time.sleep(1)\n",
        "e2e/test_new_async.py": "async def t():\n    await asyncio.sleep(1)\n",
        "browser/test_old.py": "def t(page):\n    page.wait_for_timeout(1)\n    page.wait_for_timeout(2)\n",
        "browser/test_clean.py": "def t(page):\n    expect(page.locator('x')).to_be_visible()\n",
        "browser/waits.py": "import time\ntime.sleep(1)\n",
    })
    found = violations(root, {"browser/test_old.py": 1})
    assert [f.split(":")[0] for f in found] == ["browser/test_new.py", "browser/test_new_sleep.py", "browser/test_old.py", "e2e/test_new_async.py"]
    assert violations(root, {"browser/test_old.py": 2, "browser/test_new.py": 1, "browser/test_new_sleep.py": 1, "e2e/test_new_async.py": 1}) == []
