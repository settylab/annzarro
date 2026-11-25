"""A one-row section as the tests reach it (aggregation-unify-080.md 11): Genes / One row is a select
(`select.cgene-section__rows`); a one-row section has no other control, only a tooltip (the rule each channel shows it by).
"""


def section(tp, i):
    return f"{tp} .cgene-section[data-index='{i}']"


def show_as(page, tp, i, rows):
    page.select_option(f"{section(tp, i)} select.cgene-section__rows", rows)


def rule(page, tp, i):
    """The section line's tooltip: the rule in force under Color and Size."""
    return page.get_attribute(f"{section(tp, i)} .cgene-section__head", "title")
