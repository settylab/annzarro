"""Guard (0.8.0): a new front-end module exports nothing that nobody imports.

"New" is any ``static/js`` module not in ``base_js_modules.json`` (the modules of the 0.8.0 bundle base). Each of
its exports must be imported by another ``static/js`` module (a test importing it does not count: a function only
a test calls is dead code), or carry ``// export-unused-ok: <reason>`` on the export line or the line above, for
an interface a later step of the build consumes. ``export *`` and ``import * as ns`` count as using everything.
"""
import json
import pathlib
import re

JS_ROOT = pathlib.Path(__file__).resolve().parents[3] / "static" / "js"
BASE = set(json.loads(pathlib.Path(__file__).with_name("base_js_modules.json").read_text())["modules"])

EXPORT_DECL = re.compile(r"^\s*export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)", re.M)
EXPORT_LIST = re.compile(r"^\s*export\s*\{([^}]*)\}(?!\s*from)", re.M | re.S)
EXPORT_FROM = re.compile(r"^\s*export\s*\{([^}]*)\}\s*from\s*['\"]([^'\"]+)['\"]", re.M | re.S)
EXPORT_DEFAULT = re.compile(r"^\s*export\s+default\b", re.M)
IMPORT = re.compile(
    r"\b(?:import|export)\s*(\*(?:\s+as\s+[\w$]+)?|\{[^}]*\}|[\w$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+))?)\s*from\s*['\"]([^'\"]+)['\"]")
IMPORT_BARE_DYNAMIC = re.compile(r"import\(\s*['\"]([^'\"]+)['\"]\s*\)")
OK_MARK = "export-unused-ok:"


def _names(block):
    out = []
    for part in block.split(","):
        part = part.strip()
        if part:
            out.append(re.split(r"\s+as\s+", part)[-1].strip() if " as " in part else part)
    return out


def exports_of(text):
    """``{name: line number}`` of a module's named exports (``default`` included)."""
    found = {}
    for m in EXPORT_DECL.finditer(text):
        found[m.group(1)] = text.count("\n", 0, m.start(1)) + 1
    for m in EXPORT_LIST.finditer(text):
        for name in _names(m.group(1)):
            found[name] = text.count("\n", 0, m.start()) + 1
    for m in EXPORT_FROM.finditer(text):
        for name in _names(m.group(1)):
            found[name] = text.count("\n", 0, m.start()) + 1
    for m in EXPORT_DEFAULT.finditer(text):
        found["default"] = text.count("\n", 0, m.start()) + 1
    return found


def _imported_names(clause):
    """Names a module pulls in from one import clause; ``None`` when it takes the whole namespace."""
    clause = clause.strip()
    if clause.startswith("*") or "* as" in clause:
        return None
    names = set()
    if "{" in clause:
        inside = clause[clause.index("{") + 1:clause.index("}")]
        for part in inside.split(","):
            part = part.strip()
            if part:
                names.add(part.split()[0])
        clause = clause[:clause.index("{")]
    if clause.strip().strip(",").strip():
        names.add("default")
    return names


def usage(root):
    """``{module relative path: set of names imported, or None for all}`` over every module in ``root``."""
    used = {}
    for path in sorted(root.glob("**/*.js")):
        text = path.read_text(encoding="utf-8")
        here = path.parent
        for m in IMPORT.finditer(text):
            spec = m.group(2)
            if not spec.startswith("."):
                continue
            target = (here / spec).resolve()
            try:
                rel = target.relative_to(root.resolve()).as_posix()
            except ValueError:
                continue
            names = _imported_names(m.group(1))
            if names is None or used.get(rel, set()) is None:
                used[rel] = None
            else:
                used.setdefault(rel, set()).update(names)
        for m in IMPORT_BARE_DYNAMIC.finditer(text):
            if m.group(1).startswith("."):
                rel = (here / m.group(1)).resolve().relative_to(root.resolve()).as_posix()
                used[rel] = None
    return used


def unused_exports(root, base):
    used = usage(root)
    bad = []
    for path in sorted(root.glob("**/*.js")):
        rel = path.relative_to(root).as_posix()
        if rel in base:
            continue
        lines = path.read_text(encoding="utf-8").split("\n")
        got = used.get(rel, set())
        for name, line in exports_of("\n".join(lines)).items():
            if got is None or name in got:
                continue
            nearby = lines[line - 1] + (lines[line - 2] if line >= 2 else "")
            if OK_MARK in nearby:
                continue
            bad.append(f"{rel}:{line}: export {name} is imported by no module")
    return bad


def test_new_modules_export_only_what_is_used():
    bad = unused_exports(JS_ROOT, BASE)
    assert not bad, ("Remove the export, or mark an interface a later step consumes with "
                     "`// export-unused-ok: <reason>`:\n" + "\n".join(bad))


def test_base_list_names_real_modules():
    missing = [m for m in BASE if not (JS_ROOT / m).is_file()]
    assert not missing, "base_js_modules.json lists modules that are gone (a rename?): " + ", ".join(missing)


def test_planted_unused_exports_are_found(tmp_path):
    (tmp_path / "utils").mkdir()
    (tmp_path / "old.js").write_text("export function legacy() {}\n")
    (tmp_path / "utils" / "fresh.js").write_text(
        "export function used() {}\n"
        "export const unused = 1;\n"
        "// export-unused-ok: consumed by G8a\n"
        "export function promised() {}\n"
        "export class Dead {}\n"
        "function a() {}\nfunction b() {}\n"
        "export { a, b as renamed };\n"
        "export default function () {}\n")
    (tmp_path / "main.js").write_text("import { used, a } from './utils/fresh.js';\nimport { legacy } from './old.js';\n")
    bad = unused_exports(tmp_path, {"old.js", "main.js"})
    assert [b.split(": export ")[1].split(" ")[0] for b in bad] == ["unused", "Dead", "renamed", "default"]


def test_namespace_import_uses_everything(tmp_path):
    (tmp_path / "mod.js").write_text("export const a = 1;\nexport const b = 2;\n")
    (tmp_path / "main.js").write_text("import * as m from './mod.js';\n")
    assert unused_exports(tmp_path, {"main.js"}) == []
    (tmp_path / "main.js").write_text("export * from './mod.js';\n")
    assert unused_exports(tmp_path, {"main.js"}) == []


def test_reexport_counts_as_use(tmp_path):
    (tmp_path / "mod.js").write_text("export const a = 1;\nexport const b = 2;\n")
    (tmp_path / "main.js").write_text("export { a } from './mod.js';\n")
    assert [b.split("export ")[1].split(" ")[0] for b in unused_exports(tmp_path, {"main.js"})] == ["b"]
