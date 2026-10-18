"""Admin interface: the site's texts as they are in effect, for the Public site section.

``GET /api/v1/admin/site/texts`` answers, for each of the four texts, what the pages show now
(:func:`annzarro.server.site.current`): its link, or its Markdown as written, and for a text the
config file reads from a ``file``, that file's content as it was read at start. The section's
setting values (``GET /api/v1/admin/policy``) carry only the path, so without this the page could
not show what a file text says.
"""
from flask import current_app, jsonify

from .guard import require_admin


@require_admin
def site_texts():
    """GET /api/v1/admin/site/texts: ``{texts: {kind: {label, url, markdown} | null}}``."""
    from .. import site
    effective = site.current(current_app)
    texts = {}
    for kind in site.KINDS:
        text = effective.text(kind)
        texts[kind] = None if text is None else {"label": text.label, "url": text.url, "markdown": text.markdown}
    return jsonify(texts=texts)


def register(blueprint):
    blueprint.add_url_rule("/api/v1/admin/site/texts", "site_texts", site_texts)
