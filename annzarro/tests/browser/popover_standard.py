"""One check of the pop-over body standard (static/css/popover.css, U1/U7 of the 0.8.0 pop-over unification).

Not a test module: the browser files of each panel call ``assert_body_standard`` on the pop-over they just opened, so the
Plot Options, the Grouping, the Count Plot, the Cell-Gene Plot and the Methods pop-overs are held to the same markup
(headings, sections, field rows, help under the field) and the same look (uppercase section titles, no cards, no
switches, no input-group prefix boxes).
"""

CHECK = """(sel) => {
    const root = document.querySelector(sel);
    if (!root) return { missing: true };
    const all = [...root.querySelectorAll('*')];
    const out = { options: !!root.querySelector('.az-pop-options'), sections: 0, titles: [], fields: 0, labelled: 0, help: 0,
        switches: 0, inputGroups: 0, strayHelp: [], cards: [], blanks: [] };
    for (const t of root.querySelectorAll('.az-pop-section > .az-pop-section__title, .az-pop-section > summary')) {
        const cs = getComputedStyle(t);
        out.titles.push({ text: t.textContent.trim(), transform: cs.textTransform, size: cs.fontSize, weight: cs.fontWeight });
    }
    out.sections = root.querySelectorAll('details.az-pop-section').length;
    out.fields = root.querySelectorAll('.az-pop-field').length;
    out.labelled = root.querySelectorAll('.az-pop-field .az-pop-field__label').length;
    out.help = root.querySelectorAll('.az-pop-help').length;
    out.switches = root.querySelectorAll('.form-switch').length;
    out.inputGroups = root.querySelectorAll('.input-group').length;
    for (const e of all) {
        const cls = [...e.classList];
        // help is one class: any element named for help carries the standard's
        if (cls.some((c) => /help/.test(c)) && !cls.includes('az-pop-help')) out.strayHelp.push(e.className);
        const cs = getComputedStyle(e);
        if (e.closest('.az-pop-section') && cs.boxShadow !== 'none' && !e.matches('input, select, button, textarea, [role=slider]')
            && !e.closest('.pbc-hist') && !e.closest('.az-popover-header')) out.cards.push(e.className);
    }
    return out;
}"""


def assert_body_standard(page, selector, *, fields=True, help=False, sections=1, shot=None):
    """The pop-over at ``selector`` is built the way Plot Options is: an ``az-pop-options`` body of foldable sections (an
    uppercase 0.6875rem title each), fields as label-left rows, help as ``az-pop-help``; no card, switch or prefix box."""
    if shot:
        shoot(page, selector, shot)       # before the checks, so a failing body is still seen
    got = page.evaluate(CHECK, selector)
    assert not got.get("missing"), f"{selector} is not open"
    assert got["options"], f"{selector}: the body is not an .az-pop-options"
    assert got["sections"] >= sections, f"{selector}: {got['sections']} sections, wanted {sections}"
    assert got["titles"], f"{selector}: no section title"
    for t in got["titles"]:
        assert t["transform"] == "uppercase" and t["size"] == "11px" and int(t["weight"]) >= 600, (selector, t)
    if fields:
        assert got["fields"] and got["labelled"] >= 1, f"{selector}: no label-left field row ({got['fields']} fields)"
    if help:
        assert got["help"], f"{selector}: no help text under a field"
    assert not got["switches"], f"{selector}: a switch; the standard is a plain checkbox"
    assert not got["inputGroups"], f"{selector}: an input-group prefix box"
    assert not got["strayHelp"], f"{selector}: help written with its own class: {got['strayHelp']}"
    assert not got["cards"], f"{selector}: a card (shadow) inside a section: {got['cards']}"
    return got


def shoot(page, selector, name):
    """When ANNZARRO_U7_SHOTS names a directory, save the pop-over at ``selector`` there, light and dark (``name``-light.png)."""
    import os
    folder = os.environ.get("ANNZARRO_U7_SHOTS")
    if not folder:
        return
    os.makedirs(folder, exist_ok=True)
    was = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
    try:
        for theme in ("light", "dark"):
            page.evaluate("(t) => document.documentElement.setAttribute('data-theme', t)", theme)
            page.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")   # the theme is painted
            page.locator(selector).screenshot(path=os.path.join(folder, f"{name}-{theme}.png"))
    finally:
        page.evaluate("(t) => t ? document.documentElement.setAttribute('data-theme', t) : document.documentElement.removeAttribute('data-theme')", was)
