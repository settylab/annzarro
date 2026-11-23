"""Version tokens for the URLs of static files.

A page names its scripts, styles, fonts and images as ``/static/...?v=<token>``,
so that after an upgrade the browser asks for the new file even when something
between it and the server (a proxy, a CDN, the browser's own heuristics) would
have reused the old one.

The token is the version of AnnZarro. In a source checkout the version does not
move between edits, so the file's own modification time is added.

ES-module scripts are the exception and keep their plain URL: a module is
identified by its URL, so a versioned entry would load a second time, with its
own state, when another module imports it by relative path (which carries no
query). They are kept current by the server instead: Flask answers every static
file ``Cache-Control: no-cache`` with an ETag, so the browser revalidates each
module on every load.
"""
import os

from flask import current_app, url_for

from annzarro.utils.paths import source_checkout_root


def in_source_checkout() -> bool:
    return source_checkout_root() is not None


def token_for(path) -> str:
    """The token for the file at ``path``: the version, plus its edit time in a source checkout."""
    import annzarro
    token = annzarro.__version__
    if in_source_checkout():
        try:
            token += f".{os.stat(path).st_mtime_ns:x}"
        except OSError:
            pass
    return token


def static_url(filename: str) -> str:
    """URL of a static file, carrying its version token."""
    return url_for("static", filename=filename,
                   v=token_for(os.path.join(current_app.static_folder or "", filename)))


def install(app) -> None:
    """Make ``static_url`` available to every template."""
    app.jinja_env.globals["static_url"] = static_url
