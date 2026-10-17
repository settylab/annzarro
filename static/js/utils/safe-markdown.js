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
 * No raw HTML, no images, no tables, no nested lists. Input is capped (`maxChars`), a
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

/**
 * @param {*} markdown - The text; anything that is not a string gives ''.
 * @param {{headingBase?: number, maxChars?: number}} [options]
 * @returns {string} Safe HTML (see the module comment).
 */
export function renderSafeMarkdown(markdown, { headingBase = 1, maxChars = MAX_CHARS } = {}) {
    if (typeof markdown !== 'string') return '';
    const text = markdown.slice(0, maxChars).replace(/\r\n?/g, '\n').replace(CONTROL_RE, '');
    const base = Math.max(1, Math.min(6, Math.trunc(headingBase) || 1));
    const blocks = [];
    const paragraph = [];
    const items = [];
    let paragraphChars = 0;
    let kind = null;

    const flushParagraph = () => {
        if (paragraph.length) blocks.push('<p>' + inline(joinLines(paragraph).slice(0, MAX_BLOCK_CHARS)) + '</p>');
        paragraph.length = 0;
        paragraphChars = 0;
    };
    const flushList = () => {
        if (items.length) {
            const tag = kind === 'bullet' ? 'ul' : 'ol';
            blocks.push(`<${tag}>` + items.map((i) => '<li>' + inline(i.slice(0, MAX_BLOCK_CHARS)) + '</li>').join('') + `</${tag}>`);
        }
        items.length = 0;
        kind = null;
    };

    for (const line of text.split('\n')) {
        if (blocks.length >= MAX_BLOCKS) break;
        if (!line.trim()) {
            flushParagraph();
            flushList();
            continue;
        }
        const heading = HEADING_RE.exec(line);
        const bullet = heading ? null : BULLET_RE.exec(line);
        const number = heading || bullet ? null : NUMBER_RE.exec(line);
        if (heading) {
            flushParagraph();
            flushList();
            const level = Math.min(6, heading[1].length + base - 1);
            blocks.push(`<h${level}>` + inline(heading[2].slice(0, MAX_BLOCK_CHARS)) + `</h${level}>`);
        } else if (bullet || number) {
            flushParagraph();
            const want = bullet ? 'bullet' : 'number';
            if (kind !== want) {
                flushList();
                kind = want;
            }
            items.push((bullet || number)[1].trim());
        } else {
            flushList();
            // lines past the paragraph cap are read but not kept, so a text of endless short lines costs a bounded amount
            if (paragraphChars < MAX_BLOCK_CHARS) {
                paragraph.push(line);
                paragraphChars += line.length + 1;
            }
        }
    }
    flushParagraph();
    flushList();
    return blocks.join('\n');
}
