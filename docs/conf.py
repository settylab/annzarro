"""Sphinx configuration for the AnnZarro documentation (Read the Docs)."""
from importlib.metadata import PackageNotFoundError, version as _version

project = "AnnZarro"
author = "Dominik J. Otto, Siddharth Baasri, Manu Setty"
copyright = "2026, Setty Lab, Fred Hutch Cancer Center"
try:
    release = _version("annzarro")
except PackageNotFoundError:
    release = "dev"
version = release

extensions = [
    "myst_parser",
    "sphinx_copybutton",
    "sphinx_design",
    "sphinxcontrib.bibtex",
]

myst_enable_extensions = ["colon_fence", "deflist", "dollarmath", "attrs_inline", "attrs_block",
                          "fieldlist", "substitution"]
myst_heading_anchors = 3

bibtex_bibfiles = ["references.bib"]
bibtex_default_style = "unsrt"
bibtex_reference_style = "author_year"

source_suffix = {".md": "markdown", ".rst": "restructuredtext"}
exclude_patterns = ["_build", "_tools", "Thumbs.db", ".DS_Store"]

html_theme = "furo"
html_title = "AnnZarro"
html_static_path = ["_static"]
html_css_files = ["custom.css"]
html_theme_options = {
    "source_repository": "https://github.com/settylab/annzarro/",
    "source_branch": "main",
    "source_directory": "docs/",
}
copybutton_prompt_text = r"\$ |>>> "
copybutton_prompt_is_regexp = True
