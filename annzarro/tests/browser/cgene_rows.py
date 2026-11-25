"""A one-row section as the tests reach it (aggregation-unify-080.md 10): Genes / One row is a select
(`select.cgene-section__rows`) and a one-row section has ONE gene-step button (`button.cgene-section__step`) whose menu is
the shared `[data-popover='aggregation']`: the ways to combine the gene rows, then the source's score methods, each
`[data-agg=<step>]`, greyed with its reason when Color or Size rules it out.
"""
MENU = "[data-popover='aggregation']"


def section(tp, i):
    return f"{tp} .cgene-section[data-index='{i}']"


def show_as(page, tp, i, rows):
    page.select_option(f"{section(tp, i)} select.cgene-section__rows", rows)


def button(tp, i):
    return f"{section(tp, i)} button.cgene-section__step"


def open_step(page, tp, i):
    page.click(button(tp, i))
    page.locator(MENU).wait_for(state="visible")


def close_step(page):
    page.keyboard.press("Escape")
    page.locator(MENU).wait_for(state="hidden")


def pick_step(page, tp, i, value):
    open_step(page, tp, i)
    page.click(f"{MENU} [data-agg='{value}']")
    page.locator(MENU).wait_for(state="hidden")


def entries(page, tp, i):
    """[{v, off, title, on, sym, name, heading}] of the menu in order; the menu is closed again."""
    open_step(page, tp, i)
    rows = page.evaluate("""() => [...document.querySelectorAll("[data-popover='aggregation'] [data-agg]")].map(r => {
        let h = r.previousElementSibling; while (h && !h.classList.contains('axis-agg-heading')) h = h.previousElementSibling;
        return { v: r.dataset.agg, off: r.disabled, title: r.title, on: r.getAttribute('aria-checked') === 'true',
                 sym: r.querySelector('.axis-agg-sym').textContent, name: r.querySelector('.axis-agg-name').textContent,
                 heading: h ? h.textContent : '' }; })""")
    close_step(page)
    return rows
