# Open Sans (webfont, bundled)

Open Sans, copyright 2020 The Open Sans Project Authors, SIL Open Font License 1.1 (`OFL.txt`; also shipped as
`annzarro/THIRD_PARTY_LICENSES/open-sans-OFL.txt`).

- Source: https://github.com/googlefonts/opensans, `fonts/variable/OpenSans[wdth,wght].ttf`, commit
  `6cbc400d4855abee59d85c4ed871d510399bce7b` (2026-11-10). The font is not modified except as below.
- Made with `scripts/build_open_sans_subset.py` (fontTools 4.68): width axis pinned at 100, weight axis kept from 400 to 700
  (Regular to Bold, one file), then subset to Basic Latin, Latin-1, Latin Extended-A, Greek, General Punctuation and the symbols
  the plots draw (± − × ÷ ≥ ≤ ≠ ≈ ∞ Σ Δ σ μ, the combining macron U+0304 for x̄ z̄, ‹ ›, ⁺, %, ·, …, €), as WOFF2.
- Not in Open Sans, so drawn by the next font of the stack: → ↑ ↓ ✓.
- Loaded by `static/css/fonts.css`; embedded in exported SVG and PNG images by `static/js/utils/fonts.js`.
