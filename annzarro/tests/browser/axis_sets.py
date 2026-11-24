"""Driving an axis row that reads a set (axis-aggregate-picker-080): `[layer] [layer name] [item] [aggregation]`.

A signature or a group is no source of its own: the source is `layer`, the layer name is the row's key select, the item
picker lists the focused gene or cell and then the sets in sections, and a button after it holds the aggregation.
Tests of the old rows (a `gene-score` type, a method select, a layer select) go through these helpers.
"""
from annzarro.tests.browser.test_memory_guard import until

MARK = "\x01"


def sel(tile, axis, kind):
    return f"{tile} select.axis-{kind}-select[data-axis='{axis}']"


def button(tile, axis):
    return f"{tile} button.axis-agg-btn[data-axis='{axis}']"


def set_value(provider, entry):
    """The item picker's value of a set."""
    return f"{MARK}{provider}{MARK}{entry}"


def pick_set(page, tile, axis, entry, provider="gene-score", layer=None):
    """Type layer, the layer, then the set in the item picker: the way a user chooses a signature or a group."""
    if page.input_value(sel(tile, axis, "type")) != "layer":
        page.select_option(sel(tile, axis, "type"), "layer")
    value = set_value(provider, entry)
    until(page, "([s, v]) => [...document.querySelector(s).options].some(o => o.value === v)", [sel(tile, axis, "column"), value])
    if layer and page.input_value(sel(tile, axis, "key")) != layer:
        page.select_option(sel(tile, axis, "key"), layer)
        until(page, "([s, v]) => [...document.querySelector(s).options].some(o => o.value === v)", [sel(tile, axis, "column"), value])
    page.select_option(sel(tile, axis, "column"), value)
    page.wait_for_selector(button(tile, axis))


def layer_options(page, tile, axis):
    """The row's layer list: [{v, off, title, text}]."""
    return page.evaluate("""(s) => [...document.querySelector(s).options].map(o => ({ v: o.value, off: o.disabled, title: o.title, text: o.textContent }))""",
                         sel(tile, axis, "key"))


def aggregations(page, tile, axis):
    """What the button's menu lists: [{v, off, title, text}]; the menu is closed again."""
    page.click(button(tile, axis))
    rows = page.evaluate("""() => [...document.querySelectorAll("[data-popover='aggregation'] [data-agg]")].map(r => ({ v: r.dataset.agg, off: r.disabled,
        title: r.title, text: r.textContent.replace(/\\s+/g, ' ').trim(), on: r.getAttribute('aria-checked') === 'true' }))""")
    page.keyboard.press("Escape")
    return rows


def choose_aggregation(page, tile, axis, value):
    page.click(button(tile, axis))
    page.click(f"[data-popover='aggregation'] [data-agg='{value}']")


def aggregation_of(page, tile, axis):
    """The aggregation the row holds, as its menu marks it."""
    return next((r["v"] for r in aggregations(page, tile, axis) if r["on"]), None)


def label_of(page, tile, axis):
    return page.get_attribute(button(tile, axis), "aria-label")


def until_methods(page, panel, axis, predicate, timeout=30):
    """Wait until `predicate` (a JS arrow over the aggregation options [{value, disabled, title}]) holds for the set an axis of
    `panel` reads: the grading follows what the page learns of each layer, with no menu to open."""
    until(page, """async ([id, a, pred]) => {
        const R = await import('/static/js/utils/source-registry.js');
        const s = window.PanelManager.getPanel(id).getConfig()[a];
        const p = s && R.getSource(s.type);
        if (!p || !p.aggregate) return false;
        return !!(0, eval)(pred)(p.aggregate.methods(s).options);
    }""", [panel, axis, predicate], timeout=timeout)
