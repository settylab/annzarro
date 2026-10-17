"""Operator-written text (the imprint, the privacy notice ...) as safe HTML.

Everything is escaped first; only the small subset below is then turned into
markup, so no input can produce a tag, an attribute or an event handler of its own:

* paragraphs (a blank line between them; two trailing spaces or a backslash end a line)
* headings ``#`` to ``######`` (``heading_base`` shifts the levels, e.g. 3 for ``<h3>``)
* flat bullet lists (``-``, ``*``, ``+``) and numbered lists (``1.``, ``1)``)
* ``**bold**``, ``*italic*``, ``_italic_``, ``code`` in backticks, nested emphasis
* bare ``http(s)://`` addresses and ``<address>`` autolinks, under the same rules
* links ``[text](url)`` with an ``http://``, ``https://`` or ``mailto:`` address only,
  always ``rel="noopener noreferrer"``

* GitHub-style pipe tables (alignment by ``:---``, ``:---:``, ``---:``), at most ``MAX_TABLE_ROWS`` rows
  and ``MAX_TABLE_COLUMNS`` columns, the rest announced as "... N more rows"
* fenced (``` or ~~~) and indented (4 spaces or a tab) code blocks, escaped, no highlighting
* horizontal rules, setext headings (``===`` and ``---`` under a line), blockquotes (``>``, three deep)

An indented line starts a code block even right under a paragraph line (CommonMark would continue the
paragraph), because READMEs written by hand put code under a line of prose; right under a list item it
continues the item.

No raw HTML, no images, no nested lists. Input is capped
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
MAX_TABLE_ROWS = 500
MAX_TABLE_COLUMNS = 30
MAX_CELL_CHARS = 2_000
MAX_CODE_LINES = 2_000
MAX_CODE_LINE_CHARS = 2_000
MAX_QUOTE_DEPTH = 3

_ESCAPES = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}
_ESCAPE_RE = re.compile(r"[&<>\"']")
# control characters other than tab and newline; \x01 then marks a hard line break
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f\u2028\u2029\ufeff]")
_BREAK = "\x01"

_INLINE_RE = re.compile(
    r"`([^`\n]{1,500})`"
    r"|\[([^\[\]\n]{1,300})\]\(\s*([^()\s]{1,2000})\s*\)"
    r"|<((?:https?://|mailto:)[^\s<>\x01]{1,2000})>"
    r"|(https?://[^\s<>\x01]{1,2000})"
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
_FENCE_RE = re.compile(r"^[ ]{0,3}(`{3,}|~{3,})(.*)$")
_HR_RE = re.compile(r"^[ ]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$")
_SETEXT_RE = re.compile(r"^[ ]{0,3}(?:=+|-+)[ \t]*$")
_QUOTE_RE = re.compile(r"^[ ]{0,3}>[ ]?(.*)$")
_INDENT_RE = re.compile(r"^(?: {4}|\t)")
_DELIMITER_RE = re.compile(r"^[ ]{0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$")


def escape(text):
    """``text`` with & < > " ' replaced, so it is inert in element content and in an attribute."""
    return _ESCAPE_RE.sub(lambda m: _ESCAPES[m.group(0)], text)


def safe_url(url):
    """``url`` (stripped) when it is an http, https or mailto address, else None."""
    url = (url or "").strip()
    return url if _URL_RE.match(url) else None


def _literal(text):
    return escape(text).replace(_BREAK, "<br>").replace("\n", " ")


def _anchor(href, text, escaped=False):
    target = "" if href.lower().startswith("mailto:") else ' target="_blank"'
    return ('<a href="' + escape(href) + '" rel="noopener noreferrer"' + target + ">"
            + (text if escaped else escape(text)) + "</a>")


def _trim_url(url):
    """A bare address without the punctuation that ends the sentence around it (GFM): ``?!.,:;*_~'"``,
    and a closing parenthesis the address does not open."""
    while url:
        if url[-1] in "?!.,:;*_~'\"":
            url = url[:-1]
        elif url[-1] == ")" and url.count(")") > url.count("("):
            url = url[:-1]
        else:
            break
    return url


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
        code, text, url, angle, bare, both, strong, em_star, em_under = match.groups()
        end = match.end()
        if code is not None:
            out.append("<code>" + escape(code) + "</code>")
        elif text is not None:
            href = safe_url(url) if links else None
            if href is None:
                out.append(_literal(match.group(0)))
            else:
                out.append(_anchor(href, _inline(text, depth + 1, False), escaped=True))
        elif angle is not None:
            href = safe_url(angle) if links else None
            if href is None:
                out.append(_literal(match.group(0)))
            else:
                out.append(_anchor(href, href))
        elif bare is not None:
            before = raw[start - 1] if start > 0 else ""
            url = _trim_url(bare)
            if not links or (before and _WORD_RE.match(before)) or safe_url(url) is None:
                out.append(_literal(raw[start]))      # not a link: go on after its first character
                end = start + 1
            else:
                out.append(_anchor(url, url))
                end = start + len(url)
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


def _split_cells(line):
    """The cells of a table row: split on pipes that are not escaped (``\\|`` is a pipe in the text), the
    pipes at the row's two ends not counted."""
    cells, current, i = [], [], 0
    text = line.strip()
    while i < len(text):
        ch = text[i]
        if ch == "\\" and i + 1 < len(text) and text[i + 1] == "|":
            current.append("|")
            i += 2
            continue
        if ch == "|":
            cells.append("".join(current))
            current = []
        else:
            current.append(ch)
        i += 1
    cells.append("".join(current))
    if text.startswith("|"):
        cells = cells[1:]
    if text.endswith("|") and not text.endswith("\\|") and cells:
        cells = cells[:-1]
    return [c.strip() for c in cells]


def _alignment(cell):
    left, right = cell.startswith(":"), cell.endswith(":")
    return "center" if left and right else "left" if left else "right" if right else ""


def _is_table_at(lines, i):
    """Whether lines[i] is a table's header row: it has a pipe and the next line is a delimiter row of as many cells."""
    if i + 1 >= len(lines) or "|" not in lines[i] or "|" not in lines[i + 1] or not _DELIMITER_RE.match(lines[i + 1]):
        return False
    return len(_split_cells(lines[i])) == len(_split_cells(lines[i + 1]))


def _table(lines, i):
    """(html, next index) of the table whose header row is lines[i]."""
    header = _split_cells(lines[i])
    aligns = [_alignment(c) for c in _split_cells(lines[i + 1])]
    width = min(len(header), MAX_TABLE_COLUMNS)
    rows, total, j = [], 0, i + 2
    while j < len(lines) and lines[j].strip() and "|" in lines[j] and not _starts_block(lines[j]):
        total += 1
        if len(rows) < MAX_TABLE_ROWS:
            cells = _split_cells(lines[j])[:width]
            rows.append(cells + [""] * (width - len(cells)))
        j += 1

    def cell(tag, text, k):
        cls = f' class="md-{aligns[k]}"' if aligns[k] else ""
        return f"<{tag}{cls}>" + _inline(text[:MAX_CELL_CHARS]) + f"</{tag}>"

    out = ['<div class="md-table"><table><thead><tr>'
           + "".join(cell("th", header[k], k) for k in range(width)) + "</tr></thead><tbody>"]
    for row in rows:
        out.append("<tr>" + "".join(cell("td", row[k], k) for k in range(width)) + "</tr>")
    if total > len(rows):
        out.append(f'<tr><td class="md-more" colspan="{width}">\u2026 {total - len(rows)} more rows</td></tr>')
    out.append("</tbody></table></div>")
    return "".join(out), j


def _starts_block(line):
    """Whether a line begins a block of its own, which ends a table."""
    return bool(_HEADING_RE.match(line) or _FENCE_RE.match(line) or _QUOTE_RE.match(line) or _HR_RE.match(line))


def _code(body, hidden=0):
    if hidden:
        body = body + [f"\u2026 {hidden} more lines"]
    return "<pre><code>" + escape("\n".join(body)) + "</code></pre>"


def _render_blocks(lines, base, depth, state):
    blocks = []
    paragraph = []
    items = []
    paragraph_chars = 0
    kind = None
    after_blank = True
    n = len(lines)

    def emit(html):
        state[0] += 1
        blocks.append(html)

    def flush_paragraph():
        nonlocal paragraph_chars
        paragraph_chars = 0
        if paragraph:
            emit("<p>" + _inline(_join_lines(paragraph)[:MAX_BLOCK_CHARS]) + "</p>")
            paragraph.clear()

    def flush_list():
        nonlocal kind
        if items:
            tag = "ul" if kind == "bullet" else "ol"
            emit("<" + tag + ">" + "".join("<li>" + _inline(i[:MAX_BLOCK_CHARS]) + "</li>" for i in items) + "</" + tag + ">")
            items.clear()
        kind = None

    i = 0
    while i < n:
        if state[0] >= MAX_BLOCKS:
            break
        line = lines[i]
        if not line.strip():
            flush_paragraph()
            flush_list()
            after_blank = True
            i += 1
            continue
        in_list = bool(items) and not after_blank
        after_blank = False
        fence = _FENCE_RE.match(line)
        if fence and not (fence.group(1)[0] == "`" and "`" in fence.group(2)):
            flush_paragraph()
            flush_list()
            marker = fence.group(1)
            closer = re.compile(r"^[ ]{0,3}" + re.escape(marker[0]) + "{" + str(len(marker)) + r",}[ \t]*$")
            body, hidden, i = [], 0, i + 1
            while i < n and not closer.match(lines[i]):
                if len(body) < MAX_CODE_LINES:
                    body.append(lines[i][:MAX_CODE_LINE_CHARS])
                else:
                    hidden += 1
                i += 1
            emit(_code(body, hidden))
            i += 1
            continue
        if paragraph and not in_list and _SETEXT_RE.match(line):
            level = min(6, (1 if line.strip()[0] == "=" else 2) + base - 1)
            emit(f"<h{level}>" + _inline(_join_lines(paragraph)[:MAX_BLOCK_CHARS]) + f"</h{level}>")
            paragraph.clear()
            paragraph_chars = 0
            i += 1
            continue
        if _HR_RE.match(line):
            flush_paragraph()
            flush_list()
            emit("<hr>")
            i += 1
            continue
        heading = _HEADING_RE.match(line)
        if heading:
            flush_paragraph()
            flush_list()
            level = min(6, len(heading.group(1)) + base - 1)
            emit(f"<h{level}>" + _inline(heading.group(2)[:MAX_BLOCK_CHARS]) + f"</h{level}>")
            i += 1
            continue
        if depth < MAX_QUOTE_DEPTH and _QUOTE_RE.match(line):
            flush_paragraph()
            flush_list()
            inner = []
            while i < n and _QUOTE_RE.match(lines[i]):
                inner.append(_QUOTE_RE.match(lines[i]).group(1))
                i += 1
            emit("<blockquote>" + _render_blocks(inner, base, depth + 1, state) + "</blockquote>")
            continue
        bullet = _BULLET_RE.match(line)
        number = None if bullet else _NUMBER_RE.match(line)
        if bullet or number:
            flush_paragraph()
            want = "bullet" if bullet else "number"
            if kind != want:
                flush_list()
                kind = want
            items.append((bullet or number).group(1).strip())
            i += 1
            continue
        if _INDENT_RE.match(line):
            if in_list:                         # a continuation of the item above, not code
                items[-1] = (items[-1] + " " + line.strip())[:MAX_BLOCK_CHARS]
                i += 1
                continue
            flush_paragraph()
            body, blanks, hidden = [], 0, 0
            while i < n:
                if not lines[i].strip():
                    blanks += 1
                elif _INDENT_RE.match(lines[i]):
                    for _ in range(blanks):
                        body.append("")
                    blanks = 0
                    if len(body) < MAX_CODE_LINES:
                        body.append(re.sub(r"^(?: {4}|\t)", "", lines[i], count=1)[:MAX_CODE_LINE_CHARS])
                    else:
                        hidden += 1
                else:
                    break
                i += 1
            emit(_code(body[:MAX_CODE_LINES], hidden))
            continue
        if _is_table_at(lines, i):
            flush_paragraph()
            flush_list()
            html, i = _table(lines, i)
            emit(html)
            continue
        flush_list()
        # lines past the paragraph cap are read but not kept, so a text of endless short lines costs a bounded amount
        if paragraph_chars < MAX_BLOCK_CHARS:
            paragraph.append(line)
            paragraph_chars += len(line) + 1
        i += 1
    flush_paragraph()
    flush_list()
    return "\n".join(blocks)


def render_safe_markdown(markdown, heading_base=1, max_chars=MAX_CHARS):
    """``markdown`` as safe HTML (see the module docstring). Anything that is not a string gives ``""``."""
    if not isinstance(markdown, str):
        return ""
    text = markdown[:max_chars].replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL_RE.sub("", text)
    base = max(1, min(6, int(heading_base)))
    return _render_blocks(text.split("\n"), base, 0, [0])
