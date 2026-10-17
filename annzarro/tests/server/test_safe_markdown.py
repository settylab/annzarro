"""The safe Markdown renderer (annzarro/utils/safe_markdown.py): same output as the browser's, and no XSS."""
import json
import os
import random
import re
import time

import pytest

from annzarro.utils.safe_markdown import MAX_CHARS, render_safe_markdown, safe_url

CASES = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                    "data", "safe_markdown_cases.json"), encoding="utf-8"))

TAG_RE = re.compile(r"<[^>]*>")
ALLOWED_TAG = re.compile(
    r"^</?(p|h[1-6]|ul|ol|li|strong|em|code|br)>$"
    r"|^<a href=\"(https?://|mailto:)[^\"<>\s]*\" rel=\"noopener noreferrer\"( target=\"_blank\")?>$"
    r"|^</a>$", re.IGNORECASE)


def assert_safe(html):
    """Every tag in the output is one the renderer is meant to write, and nothing else is markup."""
    for tag in TAG_RE.findall(html):
        assert ALLOWED_TAG.match(tag), f"unexpected markup {tag!r} in {html!r}"
    text = TAG_RE.sub("", html)
    assert "<" not in text and ">" not in text, f"a bare angle bracket survives in {html!r}"
    assert not re.search(r"&(?!amp;|lt;|gt;|quot;|#39;)", html), f"an unescaped ampersand in {html!r}"


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_cases(case):
    options = case["options"]
    assert render_safe_markdown(case["markdown"], **options) == case["html"]
    assert_safe(case["html"])


@pytest.mark.parametrize("url", ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x",
                                 "//evil.example", "/relative", "ftp://x.org", "https://", "https:// x", "",
                                 "java\tscript:alert(1)", "&#106;avascript:alert(1)", "file:///etc/passwd"])
def test_unsafe_urls_are_refused(url):
    assert safe_url(url) is None


@pytest.mark.parametrize("url", ["https://example.org", "HTTP://EXAMPLE.ORG/a?b=c&d=e#f", "mailto:me@example.org"])
def test_safe_urls_pass(url):
    assert safe_url(url) == url


def test_links_never_carry_other_attributes():
    html = render_safe_markdown('[x](https://e.org/" onclick="alert(1) "x=")')
    assert_safe(html)
    assert "onclick=" not in TAG_RE.sub("", html) or "&quot;" in html


def test_random_hostile_text_never_makes_unexpected_markup():
    rng = random.Random(20261017)
    pieces = ["<", ">", "\"", "'", "&", "&lt;", "&#x3c;", "[", "]", "(", ")", "*", "**", "_", "`", "\n", "\n\n", "  ",
              "\\", "#", "- ", "1. ", "javascript:", "https://e.org", "mailto:a@b.c", "<script>", "</script>",
              "onerror=", "x", "a b", "\t", "\x00", "![", "](", "<img src=x onerror=1>", "<a href=\"javascript:1\">",
              "&#106;", "%3c", "‮", "\u0000"]
    for _ in range(3000):
        text = "".join(rng.choice(pieces) for _ in range(rng.randint(1, 40)))
        assert_safe(render_safe_markdown(text, heading_base=rng.randint(1, 6)))


def test_heading_levels_are_capped_at_six():
    assert render_safe_markdown("# a", heading_base=9).startswith("<h6>")
    assert render_safe_markdown("###### a", heading_base=3) == "<h6>a</h6>"


def test_input_is_capped():
    html = render_safe_markdown("a" * (MAX_CHARS * 3))
    assert len(html) < MAX_CHARS + 100
    assert render_safe_markdown("abcdef", max_chars=3) == "<p>abc</p>"


@pytest.mark.parametrize("text", ["**a" * 60000, "[" * 100000, "*" * 100000, "_a" * 80000, "`" * 100000,
                                  "[a](" * 50000, "*a " * 70000, "- " * 60000, "#" * 100000, "\\\n" * 50000,
                                  "**" + "a " * 5000 + "*" * 50000])
def test_hostile_input_is_bounded_in_time(text):
    started = time.time()
    html = render_safe_markdown(text)
    assert time.time() - started < 3.0, "a pattern backtracks without a bound"
    assert_safe(html)


def test_deep_nesting_is_cut_off():
    html = render_safe_markdown("*" * 3 + "x" * 3 + "*" * 3 + " " + "**a *b **c *d **e *f g* h** i* j** k* l**")
    assert html.count("<strong>") + html.count("<em>") <= 12
    assert_safe(html)


def test_non_strings_give_nothing():
    for value in (None, 5, [], {}, b"x"):
        assert render_safe_markdown(value) == ""


CAP = MAX_CHARS
ADVERSARIAL = {
    "**a": "**a" * (CAP // 3), "*a": "*a" * (CAP // 2), "_a": "_a" * (CAP // 2),
    "*** and x": "***" + "x " * (CAP // 2), "[": "[" * CAP, "[a](": "[a](" * (CAP // 4),
    "backtick": "`" + "a" * (CAP - 1), "stars in one paragraph": "*" * 10000,
    "many short lines": "\n".join(["**a b"] * (CAP // 5)), "bold lines apart": "\n\n".join(["**a b"] * (CAP // 6)),
    "emphasis then spaces": "**" + " a" * (CAP // 2),
}


@pytest.mark.parametrize("name", list(ADVERSARIAL))
def test_worst_case_input_at_the_cap_is_fast(name):
    started = time.perf_counter()
    html = render_safe_markdown(ADVERSARIAL[name])
    elapsed = time.perf_counter() - started
    print(f"safe_markdown {name!r}: {elapsed * 1000:.0f} ms")
    assert elapsed < 1.0
    assert_safe(html)
