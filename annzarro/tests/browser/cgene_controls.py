"""The Cell-Gene Plot's Color, Size and Height as the tests reach them: `[label] [layer ▾] [aggregation button]`.

The statistic is the aggregation button (`button.cgene-<which>`), its menu `[data-popover='aggregation']` lists every
statistic as `[data-agg=<value>]`; the threshold ("Expressed above") is a number box in that menu,
`input[data-field='above']`, and shows on the button when the measure has one of its own (`>0.5`).
"""
MENU = "[data-popover='aggregation']"


def button(tp, which):
    return f"{tp} button.cgene-{which}"


def open_menu(page, tp, which):
    page.click(button(tp, which))
    page.locator(MENU).wait_for(state="visible")


def close_menu(page):
    """Escape closes the menu; a first one in a number box only ends the edit (data-az-own-escape), so ask again."""
    page.keyboard.press("Escape")
    if page.locator(MENU).count():
        page.keyboard.press("Escape")
    page.locator(MENU).wait_for(state="hidden")


def pick_stat(page, tp, which, value):
    """Choose a statistic in the button's menu (the menu closes on the choice)."""
    open_menu(page, tp, which)
    page.click(f"{MENU} [data-agg='{value}']")
    page.locator(MENU).wait_for(state="hidden")


def stat_entries(page, tp, which):
    """[{v, off, title, on}] of the menu, in order; the menu is closed again."""
    open_menu(page, tp, which)
    rows = page.evaluate("""() => [...document.querySelectorAll("[data-popover='aggregation'] [data-agg]")].map(r => ({ v: r.dataset.agg,
        off: r.disabled, title: r.title, on: r.getAttribute('aria-checked') === 'true' }))""")
    close_menu(page)
    return rows


def stat_names(page, tp, which):
    """The names the menu shows, in order (the menu is closed again)."""
    open_menu(page, tp, which)
    names = page.eval_on_selector_all(f"{MENU} [data-agg] .axis-agg-name", "os => os.map(o => o.textContent)")
    close_menu(page)
    return names


def chosen_stat(page, tp, which):
    return next((r["v"] for r in stat_entries(page, tp, which) if r["on"]), None)


def above(page, tp, which):
    """The threshold box as the menu shows it: {value, placeholder, title}, or None when the measure has no threshold."""
    open_menu(page, tp, which)
    box = page.locator(f"{MENU} input[data-field='above']")
    out = None
    if box.count():
        out = {"value": box.input_value(), "placeholder": box.get_attribute("placeholder"), "title": box.get_attribute("title")}
    close_menu(page)
    return out


def set_above(page, tp, which, text):
    """Type the threshold in the menu and press Enter; the menu is closed again."""
    open_menu(page, tp, which)
    box = page.locator(f"{MENU} input[data-field='above']")
    box.fill(text)
    box.press("Enter")
    close_menu(page)
