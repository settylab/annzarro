/**
 * Operator- or author-written text (a dataset's README, the imprint ...) as safe HTML.
 *
 * Everything is escaped first; only the small subset below is then turned into
 * markup, so no input can produce a tag, an attribute or an event handler of its own:
 *
 *   - paragraphs (a blank line between them; two trailing spaces or a backslash end a line)
 *   - headings `#` to `######` (`headingBase` shifts the levels, e.g. 3 for `<h3>`)
 *   - flat bullet lists (`-`, `*`, `+`) and numbered lists (`1.`, `1)`)
 *   - `**bold**`, `*italic*`, `_italic_`, `code` in backticks, nested emphasis
 *   - links `[text](url)` with an http://, https:// or mailto: address only,
 *     always rel="noopener noreferrer"
 *
 *   - GitHub-style pipe tables (alignment by :---, :---:, ---:), at most MAX_TABLE_ROWS rows and
 *     MAX_TABLE_COLUMNS columns, the rest announced as "... N more rows"
 *   - fenced (``` or ~~~) and indented (4 spaces or a tab) code blocks, escaped, no highlighting
 *   - horizontal rules, setext headings (=== and --- under a line), blockquotes (>, three deep)
 *
 * An indented line starts a code block even right under a paragraph line (CommonMark would continue
 * the paragraph), because READMEs written by hand put code under a line of prose; right under a list
 * item it continues the item.
 *
 * No raw HTML, no images, no nested lists. Input is capped (`maxChars`), a
 * paragraph at MAX_BLOCK_CHARS, and every pattern is bounded, so a hostile text costs a
 * bounded amount of work. Pure: no DOM access; set the result with `innerHTML`.
 *
 * annzarro/utils/safe_markdown.py is the same renderer for the server; both must give the
 * same output for annzarro/tests/data/safe_markdown_cases.json.
 */

export const MAX_CHARS = 200000;
export const MAX_BLOCK_CHARS = 10000;
export const MAX_BLOCKS = 2000;
const MAX_DEPTH = 4;
const MAX_TABLE_ROWS = 500;
const MAX_TABLE_COLUMNS = 30;
const MAX_CELL_CHARS = 2000;
const MAX_CODE_LINES = 2000;
const MAX_CODE_LINE_CHARS = 2000;
const MAX_QUOTE_DEPTH = 3;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// control characters other than tab and newline; \x01 then marks a hard line break
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f\u2028\u2029\ufeff]/g;
const BREAK = '\x01';

const INLINE_SOURCE =
    '`([^`\\n]{1,500})`' +
    '|\\[([^\\[\\]\\n]{1,300})\\]\\(\\s*([^()\\s]{1,2000})\\s*\\)' +
    '|\\*\\*\\*(\\S(?:.{0,998}?\\S)??)\\*\\*\\*' +
    '|\\*\\*(\\S(?:.{0,998}?\\S)??)\\*\\*' +
    '|\\*(\\S(?:[^*\\n]{0,998}?\\S)??)\\*' +
    '|_(\\S(?:[^_\\n]{0,998}?\\S)??)_';
const URL_RE = /^(?:https?:\/\/[^\s]+|mailto:[^\s]+)$/i;
const HEADING_RE = /^[ \t]{0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$/;
const BULLET_RE = /^[ \t]{0,3}[-*+][ \t]+(.*)$/;
const NUMBER_RE = /^[ \t]{0,3}\d{1,9}[.)][ \t]+(.*)$/;
const WORD_RE = /[A-Za-z0-9]/;
const FENCE_RE = /^[ ]{0,3}(`{3,}|~{3,})(.*)$/;
const HR_RE = /^[ ]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT_RE = /^[ ]{0,3}(?:=+|-+)[ \t]*$/;
const QUOTE_RE = /^[ ]{0,3}>[ ]?(.*)$/;
const INDENT_RE = /^(?: {4}|\t)/;
const DELIMITER_RE = /^[ ]{0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** `text` with & < > " ' replaced, so it is inert in element content and in an attribute. */
export function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** `url` (trimmed) when it is an http, https or mailto address, else null. */
export function safeUrl(url) {
    const trimmed = String(url || '').trim();
    return URL_RE.test(trimmed) ? trimmed : null;
}

function literal(text) {
    return escapeHtml(text).split(BREAK).join('<br>').split('\n').join(' ');
}

function inline(raw, depth = 0, links = true) {
    if (depth > MAX_DEPTH) return literal(raw);
    const re = new RegExp(INLINE_SOURCE, 'g');
    const out = [];
    let pos = 0;
    while (pos < raw.length) {
        re.lastIndex = pos;
        const match = re.exec(raw);
        if (!match) break;
        const start = match.index;
        out.push(literal(raw.slice(pos, start)));
        const [whole, code, text, url, both, strong, emStar, emUnder] = match;
        let end = start + whole.length;
        if (code !== undefined) {
            out.push('<code>' + escapeHtml(code) + '</code>');
        } else if (text !== undefined) {
            const href = links ? safeUrl(url) : null;
            if (href === null) {
                out.push(literal(whole));
            } else {
                const target = href.toLowerCase().startsWith('mailto:') ? '' : ' target="_blank"';
                out.push('<a href="' + escapeHtml(href) + '" rel="noopener noreferrer"' + target + '>'
                    + inline(text, depth + 1, false) + '</a>');
            }
        } else if (both !== undefined) {
            out.push('<strong><em>' + inline(both, depth + 1, links) + '</em></strong>');
        } else if (strong !== undefined) {
            out.push('<strong>' + inline(strong, depth + 1, links) + '</strong>');
        } else if (emStar !== undefined) {
            out.push('<em>' + inline(emStar, depth + 1, links) + '</em>');
        } else {
            const before = start > 0 ? raw[start - 1] : '';
            const after = end < raw.length ? raw[end] : '';
            if ((before && WORD_RE.test(before)) || (after && WORD_RE.test(after))) {
                out.push('_');          // snake_case_name: not emphasis
                end = start + 1;
            } else {
                out.push('<em>' + inline(emUnder, depth + 1, links) + '</em>');
            }
        }
        pos = end;
    }
    out.push(literal(raw.slice(pos)));
    return out.join('');
}

function joinLines(lines) {
    let result = '';
    lines.forEach((line, i) => {
        const hard = line.endsWith('  ') || line.endsWith('\\');
        let text = line.trim();
        if (text.endsWith('\\')) text = text.slice(0, -1).trimEnd();
        if (result && !result.endsWith(BREAK)) result += ' ';
        result += text + (hard && i < lines.length - 1 ? BREAK : '');
    });
    return result;
}

function splitCells(line) {
    const text = line.trim();
    let cells = [];
    let current = '';
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\\' && text[i + 1] === '|') {
            current += '|';
            i++;
        } else if (ch === '|') {
            cells.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    cells.push(current);
    if (text.startsWith('|')) cells = cells.slice(1);
    if (text.endsWith('|') && !text.endsWith('\\|') && cells.length) cells = cells.slice(0, -1);
    return cells.map((c) => c.trim());
}

function alignment(cell) {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    return left && right ? 'center' : left ? 'left' : right ? 'right' : '';
}

function isTableAt(lines, i) {
    if (i + 1 >= lines.length || !lines[i].includes('|') || !lines[i + 1].includes('|') || !DELIMITER_RE.test(lines[i + 1])) return false;
    return splitCells(lines[i]).length === splitCells(lines[i + 1]).length;
}

function startsBlock(line) {
    return HEADING_RE.test(line) || FENCE_RE.test(line) || QUOTE_RE.test(line) || HR_RE.test(line);
}

function table(lines, i) {
    const header = splitCells(lines[i]);
    const aligns = splitCells(lines[i + 1]).map(alignment);
    const width = Math.min(header.length, MAX_TABLE_COLUMNS);
    const rows = [];
    let total = 0;
    let j = i + 2;
    while (j < lines.length && lines[j].trim() && lines[j].includes('|') && !startsBlock(lines[j])) {
        total++;
        if (rows.length < MAX_TABLE_ROWS) {
            const cells = splitCells(lines[j]).slice(0, width);
            while (cells.length < width) cells.push('');
            rows.push(cells);
        }
        j++;
    }
    const cell = (tag, text, k) => {
        const cls = aligns[k] ? ` class="md-${aligns[k]}"` : '';
        return `<${tag}${cls}>` + inline(text.slice(0, MAX_CELL_CHARS)) + `</${tag}>`;
    };
    const out = ['<div class="md-table"><table><thead><tr>'
        + header.slice(0, width).map((h, k) => cell('th', h, k)).join('') + '</tr></thead><tbody>'];
    for (const row of rows) out.push('<tr>' + row.map((c, k) => cell('td', c, k)).join('') + '</tr>');
    if (total > rows.length) out.push(`<tr><td class="md-more" colspan="${width}">\u2026 ${total - rows.length} more rows</td></tr>`);
    out.push('</tbody></table></div>');
    return [out.join(''), j];
}

function code(body, hidden = 0) {
    const lines = hidden ? [...body, `\u2026 ${hidden} more lines`] : body;
    return '<pre><code>' + escapeHtml(lines.join('\n')) + '</code></pre>';
}

function renderBlocks(lines, base, depth, state) {
    const blocks = [];
    const paragraph = [];
    const items = [];
    let paragraphChars = 0;
    let kind = null;
    let afterBlank = true;
    const n = lines.length;

    const emit = (html) => {
        state.count++;
        blocks.push(html);
    };
    const flushParagraph = () => {
        paragraphChars = 0;
        if (paragraph.length) emit('<p>' + inline(joinLines(paragraph).slice(0, MAX_BLOCK_CHARS)) + '</p>');
        paragraph.length = 0;
    };
    const flushList = () => {
        if (items.length) {
            const tag = kind === 'bullet' ? 'ul' : 'ol';
            emit(`<${tag}>` + items.map((i) => '<li>' + inline(i.slice(0, MAX_BLOCK_CHARS)) + '</li>').join('') + `</${tag}>`);
        }
        items.length = 0;
        kind = null;
    };

    let i = 0;
    while (i < n) {
        if (state.count >= MAX_BLOCKS) break;
        const line = lines[i];
        if (!line.trim()) {
            flushParagraph();
            flushList();
            afterBlank = true;
            i++;
            continue;
        }
        const inList = items.length > 0 && !afterBlank;
        afterBlank = false;
        const fence = FENCE_RE.exec(line);
        if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) {
            flushParagraph();
            flushList();
            const marker = fence[1];
            const closer = new RegExp('^[ ]{0,3}' + (marker[0] === '`' ? '`' : '~') + '{' + marker.length + ',}[ \\t]*$');
            const body = [];
            let hidden = 0;
            i++;
            while (i < n && !closer.test(lines[i])) {
                if (body.length < MAX_CODE_LINES) body.push(lines[i].slice(0, MAX_CODE_LINE_CHARS));
                else hidden++;
                i++;
            }
            emit(code(body, hidden));
            i++;
            continue;
        }
        if (paragraph.length && !inList && SETEXT_RE.test(line)) {
            const level = Math.min(6, (line.trim()[0] === '=' ? 1 : 2) + base - 1);
            emit(`<h${level}>` + inline(joinLines(paragraph).slice(0, MAX_BLOCK_CHARS)) + `</h${level}>`);
            paragraph.length = 0;
            paragraphChars = 0;
            i++;
            continue;
        }
        if (HR_RE.test(line)) {
            flushParagraph();
            flushList();
            emit('<hr>');
            i++;
            continue;
        }
        const heading = HEADING_RE.exec(line);
        if (heading) {
            flushParagraph();
            flushList();
            const level = Math.min(6, heading[1].length + base - 1);
            emit(`<h${level}>` + inline(heading[2].slice(0, MAX_BLOCK_CHARS)) + `</h${level}>`);
            i++;
            continue;
        }
        if (depth < MAX_QUOTE_DEPTH && QUOTE_RE.test(line)) {
            flushParagraph();
            flushList();
            const inner = [];
            while (i < n && QUOTE_RE.test(lines[i])) {
                inner.push(QUOTE_RE.exec(lines[i])[1]);
                i++;
            }
            emit('<blockquote>' + renderBlocks(inner, base, depth + 1, state) + '</blockquote>');
            continue;
        }
        const bullet = BULLET_RE.exec(line);
        const number = bullet ? null : NUMBER_RE.exec(line);
        if (bullet || number) {
            flushParagraph();
            const want = bullet ? 'bullet' : 'number';
            if (kind !== want) {
                flushList();
                kind = want;
            }
            items.push((bullet || number)[1].trim());
            i++;
            continue;
        }
        if (INDENT_RE.test(line)) {
            if (inList) {                       // a continuation of the item above, not code
                items[items.length - 1] = (items[items.length - 1] + ' ' + line.trim()).slice(0, MAX_BLOCK_CHARS);
                i++;
                continue;
            }
            flushParagraph();
            const body = [];
            let blanks = 0;
            let hidden = 0;
            while (i < n) {
                if (!lines[i].trim()) {
                    blanks++;
                } else if (INDENT_RE.test(lines[i])) {
                    for (; blanks > 0; blanks--) body.push('');
                    if (body.length < MAX_CODE_LINES) body.push(lines[i].replace(/^(?: {4}|\t)/, '').slice(0, MAX_CODE_LINE_CHARS));
                    else hidden++;
                } else {
                    break;
                }
                i++;
            }
            emit(code(body.slice(0, MAX_CODE_LINES), hidden));
            continue;
        }
        if (isTableAt(lines, i)) {
            flushParagraph();
            flushList();
            const [html, next] = table(lines, i);
            emit(html);
            i = next;
            continue;
        }
        flushList();
        // lines past the paragraph cap are read but not kept, so a text of endless short lines costs a bounded amount
        if (paragraphChars < MAX_BLOCK_CHARS) {
            paragraph.push(line);
            paragraphChars += line.length + 1;
        }
        i++;
    }
    flushParagraph();
    flushList();
    return blocks.join('\n');
}

/**
 * @param {*} markdown - The text; anything that is not a string gives ''.
 * @param {{headingBase?: number, maxChars?: number}} [options]
 * @returns {string} Safe HTML (see the module comment).
 */
export function renderSafeMarkdown(markdown, { headingBase = 1, maxChars = MAX_CHARS } = {}) {
    if (typeof markdown !== 'string') return '';
    const text = markdown.slice(0, maxChars).replace(/\r\n?/g, '\n').replace(CONTROL_RE, '');
    const base = Math.max(1, Math.min(6, Math.trunc(headingBase) || 1));
    return renderBlocks(text.split('\n'), base, 0, { count: 0 });
}
