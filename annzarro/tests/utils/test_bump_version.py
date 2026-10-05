"""bump_version.py writes every version string of a release, and they agree.

The desktop app's package-lock.json said 0.1.1 at 0.2.0 because the script
did not touch it. A copy of the five places is bumped in a temporary
directory; the checkout itself is only read.
"""
import importlib.util
import json
import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ELECTRON = Path("annzarro") / "desktop" / "electron"
FILES = [Path("annzarro") / "__init__.py", Path("pyproject.toml"),
         ELECTRON / "package.json", ELECTRON / "package-lock.json"]


def _script():
    spec = importlib.util.spec_from_file_location("bump_version", REPO / "bump_version.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _copy(tmp_path):
    for rel in FILES:
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / rel, tmp_path / rel)
    return tmp_path


def test_the_checkout_agrees_on_one_version():
    found = _script().versions(REPO)
    assert len(set(found.values())) == 1, found


def test_a_bump_reaches_every_file_and_nothing_else(tmp_path):
    bump = _script()
    root = _copy(tmp_path)
    before_lock = json.loads((root / ELECTRON / "package-lock.json").read_text())
    before_toml = (root / "pyproject.toml").read_text()

    bump.update_python_init("9.8.7", root)
    bump.update_pyproject_toml("9.8.7", root)
    bump.update_package_json("9.8.7", root)
    bump.update_package_lock("9.8.7", root)

    assert set(bump.versions(root).values()) == {"9.8.7"}
    after_lock = json.loads((root / ELECTRON / "package-lock.json").read_text())
    before_lock["version"] = before_lock["packages"][""]["version"] = "9.8.7"
    assert after_lock == before_lock          # the dependencies' versions are untouched
    toml = (root / "pyproject.toml").read_text()
    assert [l for l in toml.splitlines() if "version" in l and not l.startswith("version")] == \
           [l for l in before_toml.splitlines() if "version" in l and not l.startswith("version")]


def test_rewriting_the_same_version_changes_no_byte(tmp_path):
    bump = _script()
    root = _copy(tmp_path)
    current = bump.get_current_version(root)
    for rel in (ELECTRON / "package.json", ELECTRON / "package-lock.json"):
        before = (root / rel).read_bytes()
        (bump.update_package_json if rel.name == "package.json" else bump.update_package_lock)(current, root)
        assert (root / rel).read_bytes() == before, rel
