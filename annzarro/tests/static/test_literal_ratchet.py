"""Guard (0.8.0): the literals 'gene-score', 'cell-group' and 'group-stat' leave the shared code.

The seam steps (F3a to F3d) move every place that branches on a source type behind a provider interface. Until
they have, each file holds the count it held on the base (59b13127) and may not hold more; a file not listed
holds none. Provider files, which define a source type, are exempt. A step that removes literals lowers the
numbers here in its own commit; nothing may raise them.
"""
import pathlib
import re

JS_ROOT = pathlib.Path(__file__).resolve().parents[3] / "static" / "js"
LITERAL = re.compile(r"""['"](gene-score|cell-group|group-stat)['"]""")

#: files that define a source type; they may name it
PROVIDER_FILES = {"utils/score-source.js", "utils/cell-group-source.js"}

#: the base run (59b13127): 53 occurrences in 18 files, provider files left out; the ceiling may only fall from it
BASE_TOTAL, BASE_FILES = 53, 18

#: occurrences allowed per file now; F4 took utils/deeplink.js from 2 to 0; F3c-1 took the menus, loads, titles, view
#: descriptor and panel-set follow to the provider; F3c-2 the Hover picker and lines, large-plot mode and the colour
#: groups (the plots hold none now); F3d the tables' chooser, key, handle and column (only the score's wording is left); G8a the grouping's factors (they import the provider's type)
CEILING = {
    "utils/score-column.js": 1,                # the score's own wording; the one name, for Node holding it without a registry
}


def counts(root, providers=PROVIDER_FILES):
    out = {}
    for path in sorted(root.glob("**/*.js")):
        rel = path.relative_to(root).as_posix()
        if rel in providers:
            continue
        n = len(LITERAL.findall(path.read_text(encoding="utf-8")))
        if n:
            out[rel] = n
    return out


def over(found, ceiling):
    return [f"{rel}: {n} literals, ceiling {ceiling.get(rel, 0)}" for rel, n in found.items() if n > ceiling.get(rel, 0)]


def test_no_file_holds_more_literals_than_on_the_base():
    bad = over(counts(JS_ROOT), CEILING)
    assert not bad, ("Branching on a source type by its name belongs in a provider (utils/source-registry.js); "
                     "do not add literals:\n" + "\n".join(bad))


def test_the_ceiling_only_falls_from_the_base_run():
    assert sum(CEILING.values()) <= BASE_TOTAL and len(CEILING) <= BASE_FILES


def test_the_ceiling_is_tight():
    """A step that removes literals lowers the ceiling in the same commit, so no slack is left to spend later."""
    found = counts(JS_ROOT)
    slack = [f"{rel}: ceiling {n}, holds {found.get(rel, 0)}" for rel, n in CEILING.items() if found.get(rel, 0) < n]
    assert not slack, "Lower these ceilings to what the files hold:\n" + "\n".join(slack)


def test_planted_literal_is_found(tmp_path):
    (tmp_path / "panels").mkdir()
    (tmp_path / "panels" / "new.js").write_text("if (type === 'cell-group') {}\nconst s = \"group-stat\";\n")
    (tmp_path / "utils").mkdir()
    (tmp_path / "utils" / "cell-group-source.js").write_text("export const T = 'cell-group';\n")
    (tmp_path / "session-manager.js").write_text("a('gene-score'); b('gene-score'); c(\"gene-score\"); d('gene-score');\n")
    found = counts(tmp_path)
    assert found == {"panels/new.js": 2, "session-manager.js": 4}
    assert over(found, CEILING) == ["panels/new.js: 2 literals, ceiling 0", "session-manager.js: 4 literals, ceiling 0"]
