"""Operator-written text (the imprint, the privacy notice ...) as safe HTML.

Everything is escaped first; only the small subset below is then turned into
markup, so no input can produce a tag, an attribute or an event handler of its own:

* paragraphs (a blank line between them; two trailing spaces or a backslash end a line)
* headings ``#`` to ``######`` (``heading_base`` shifts the levels, e.g. 3 for ``<h3>``)
* flat bullet lists (``-``, ``*``, ``+``) and numbered lists (``1.``, ``1)``)
* ``**bold**``, ``*italic*``, ``_italic_``, ``code`` in backticks, nested emphasis
* links ``[text](url)`` with an ``http://``, ``https://`` or ``mailto:`` address only,
  always ``rel="noopener noreferrer"``

No raw HTML, no images, no tables, no nested lists. Input is capped
(``max_chars``), a paragraph at ``MAX_BLOCK_CHARS``, and every pattern is bounded,
so a hostile text costs a bounded amount of work.

static/js/utils/safe-markdown.js is the same renderer for the browser; both must give
the same output for the cases in annzarro/tests/data/safe_markdown_cases.json.
"""
import re

MAX_CHARS = 200_000
MAX_BLOCK_CHARS = 10_000
MAX_BLOCKS = 2_000
MAX_DEPTH = 4

_ESCAPES = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}
_ESCAPE_RE = re.compile(r"[&<>\"']")
# control characters other than tab and newline; \x01 then marks a hard line break
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f\u2028\u2029\ufeff]")
_BREAK = "\x01"

_INLINE_RE = re.compile(
    r"`([^`\n]{1,500})`"
    r"|\[([^\[\]\n]{1,300})\]\(\s*([^()\s]{1,2000})\s*\)"
    r"|\*\*\*(\S(?:.{0,998}?\S)??)\*\*\*"
    r"|\*\*(\S(?:.{0,998}?\S)??)\*\*"
    r"|\*(\S(?:[^*\n]{0,998}?\S)??)\*"
    r"|_(\S(?:[^_\n]{0,998}?\S)??)_"
)
_URL_RE = re.compile(r"^(?:https?://[^\s]+|mailto:[^\s]+)$", re.IGNORECASE)
_HEADING_RE = re.compile(r"^[ \t]{0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$")
_BULLET_RE = re.compile(r"^[ \t]{0,3}[-*+][ \t]+(.*)$")
_NUMBER_RE = re.compile(r"^[ \t]{0,3}\d{1,9}[.)][ \t]+(.*)$")
_WORD_RE = re.compile(r"[A-Za-z0-9]")


def escape(text):
    """``text`` with & < > " ' replaced, so it is inert in element content and in an attribute."""
    return _ESCAPE_RE.sub(lambda m: _ESCAPES[m.group(0)], text)


def safe_url(url):
    """``url`` (stripped) when it is an http, https or mailto address, else None."""
    url = (url or "").strip()
    return url if _URL_RE.match(url) else None


def _literal(text):
    return escape(text).replace(_BREAK, "<br>").replace("\n", " ")


def _inline(raw, depth=0, links=True):
    if depth > MAX_DEPTH:
        return _literal(raw)
    out = []
    pos = 0
    while pos < len(raw):
        match = _INLINE_RE.search(raw, pos)
        if not match:
            break
        start = match.start()
        out.append(_literal(raw[pos:start]))
        code, text, url, both, strong, em_star, em_under = match.groups()
        end = match.end()
        if code is not None:
            out.append("<code>" + escape(code) + "</code>")
        elif text is not None:
            href = safe_url(url) if links else None
            if href is None:
                out.append(_literal(match.group(0)))
            else:
                target = "" if href.lower().startswith("mailto:") else ' target="_blank"'
                out.append('<a href="' + escape(href) + '" rel="noopener noreferrer"' + target + ">"
                           + _inline(text, depth + 1, False) + "</a>")
        elif both is not None:
            out.append("<strong><em>" + _inline(both, depth + 1, links) + "</em></strong>")
        elif strong is not None:
            out.append("<strong>" + _inline(strong, depth + 1, links) + "</strong>")
        elif em_star is not None:
            out.append("<em>" + _inline(em_star, depth + 1, links) + "</em>")
        else:
            before = raw[start - 1] if start > 0 else ""
            after = raw[end] if end < len(raw) else ""
            if (before and _WORD_RE.match(before)) or (after and _WORD_RE.match(after)):
                out.append("_")          # snake_case_name: not emphasis
                end = start + 1
            else:
                out.append("<em>" + _inline(em_under, depth + 1, links) + "</em>")
        pos = end
    out.append(_literal(raw[pos:]))
    return "".join(out)


def _join_lines(lines):
    """One paragraph's lines as one text; a line ending in two spaces or a backslash breaks."""
    result = ""
    for i, line in enumerate(lines):
        hard = line.endswith("  ") or line.endswith("\\")
        text = line.strip()
        if text.endswith("\\"):
            text = text[:-1].rstrip()
        if result and not result.endswith(_BREAK):
            result += " "
        result += text + (_BREAK if hard and i < len(lines) - 1 else "")
    return result


def render_safe_markdown(markdown, heading_base=1, max_chars=MAX_CHARS):
    """``markdown`` as safe HTML (see the module docstring). Anything that is not a string gives ``""``."""
    if not isinstance(markdown, str):
        return ""
    text = markdown[:max_chars].replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL_RE.sub("", text)
    base = max(1, min(6, int(heading_base)))
    blocks = []
    paragraph = []
    items = []
    paragraph_chars = 0
    kind = None

    def flush_paragraph():
        nonlocal paragraph_chars
        paragraph_chars = 0
        if paragraph:
            blocks.append("<p>" + _inline(_join_lines(paragraph)[:MAX_BLOCK_CHARS]) + "</p>")
            paragraph.clear()

    def flush_list():
        nonlocal kind
        if items:
            tag = "ul" if kind == "bullet" else "ol"
            blocks.append("<" + tag + ">" + "".join("<li>" + _inline(i[:MAX_BLOCK_CHARS]) + "</li>"
                                                       for i in items) + "</" + tag + ">")
            items.clear()
        kind = None

    for line in text.split("\n"):
        if len(blocks) >= MAX_BLOCKS:
            break
        if not line.strip():
            flush_paragraph()
            flush_list()
            continue
        heading = _HEADING_RE.match(line)
        bullet = None if heading else _BULLET_RE.match(line)
        number = None if heading or bullet else _NUMBER_RE.match(line)
        if heading:
            flush_paragraph()
            flush_list()
            level = min(6, len(heading.group(1)) + base - 1)
            blocks.append(f"<h{level}>" + _inline(heading.group(2)[:MAX_BLOCK_CHARS]) + f"</h{level}>")
        elif bullet or number:
            flush_paragraph()
            want = "bullet" if bullet else "number"
            if kind != want:
                flush_list()
                kind = want
            items.append((bullet or number).group(1).strip())
        else:
            flush_list()
            # lines past the paragraph cap are read but not kept, so a text of endless short lines costs a bounded amount
            if paragraph_chars < MAX_BLOCK_CHARS:
                paragraph.append(line)
                paragraph_chars += len(line) + 1
    flush_paragraph()
    flush_list()
    return "\n".join(blocks)
