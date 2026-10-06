# Writers' brief for the AnnZarro docs (read fully before starting)

## Where things are
- Docs worktree (branch `dominik/docs`, stacked on PR #44 `dominik/fast-transfer` → PR #43):
  `/Users/dotto/gits/annzarro/.claude/worktrees/docs`. Sphinx sources in `docs/`.
- Python env with annzarro (editable, this worktree), sphinx, playwright+chromium, anndata, zarr:
  `/Users/dotto/gits/annzarro/.claude/worktrees/docs/.venv-docs`. Analysis env with scanpy, kompot,
  palantir, matplotlib: `/Users/dotto/gits/annzarro-paper/.venv`.
- Demo data: `/Users/dotto/gits/annzarro-paper/data/bm_aging.zarr` (8,090 cells x 16,285 genes,
  processed Kompot tutorial, Young vs Old murine bone marrow). How it was built:
  `/Users/dotto/gits/annzarro-paper/data_prep/` (README.md, VALIDATION.md, run_kompot.py,
  prepare_annzarro_store.py, demo_panelsets/*.view.json, examples.json).
- Paper repo (read only for you): `/Users/dotto/gits/annzarro-paper`. Manuscript
  `manuscript/main.tex`, `manuscript/body.tex`, `manuscript/sections/*.tex` (captions in
  `sections/figs_results.tex`), figure scripts `figures/*.py`, numbers `figures/NOTES.md`,
  `figures/numbers/*.json`, `figures/PERFORMANCE_NOTES.md`, screenshot script
  `figures/screenshots.py`, notes `figures/SCREENSHOTS.md`, benchmark `benchmark/`.
- Paper figures: never write a figure number in docs titles, cards or prose; numbers change when
  the paper is renumbered. Name a figure by its page (docs/paper/<slug>.md) or its subject, e.g.
  "the paper's cell-by-cell figure, panel b". Pages, in the paper's order: overview (focus model,
  slot map, tool comparison; `figures/fig1_overview`), interface (`figures/fig5_app.py`),
  procedure (`manuscript/figures/fig_procedure.tex`), cell-by-cell (`figures/fig2_cell_by_cell.py`),
  gene-by-gene (`figures/fig3_gene_by_gene.py`), cells-and-genes (`figures/fig4_cells_by_genes.py`),
  deployment (`manuscript/figures/fig_deploy.tex`), scale (Tahoe-100M, `figures/scale/`),
  performance (`figures/fig6_performance.py`). Old fig<N>-*.md pages are redirect stubs.
- AnnZarro source: `annzarro/` in the worktree (server `annzarro/server`, frontend `annzarro/ui` and
  `static/`), README.md, `docs/reference/deep-links.md` (the deep-link grammar).

## Showcase data (being built in parallel by the showcase agent)
`/Users/dotto/gits/annzarro-paper/data/bm_aging_showcase.zarr` = bm_aging.zarr plus extra fields so every
paper figure and feature can be shown in the app; field list in
`/Users/dotto/gits/annzarro-paper/data/bm_aging_showcase.FIELDS.md`. It is usable once
`/Users/dotto/gits/annzarro-paper/data/bm_aging_showcase.READY` exists. A small public spatial dataset
`spatial_demo.zarr` follows with `spatial_demo.READY`. Do everything that works on `bm_aging.zarr`
first; if you need a showcase field, wait for the READY file with a background-friendly loop
(`until [ -f …READY ]; do sleep 30; done` under a Bash timeout of 600000, repeated if needed).
If you need a field that is not in the planned list, say so in your final report; do not build
your own copy of the data.

## Rules
- Write ONLY the files your task assigns you (plus your own `docs/_tools/shoot_<name>.py`,
  `docs/_tools/views/<name>*.json`, `docs/_static/screens/<section>/...`). Other writers work in the
  same worktree at the same time. Do NOT run any git command that writes (no add/commit/stash/
  checkout/reset); the lead commits and pushes. Read-only git is fine.
- Do not change AnnZarro source code. Report bugs, missing features or misleading UI in your final
  report with file:line and a repro; another agent is fixing UI bugs on `dominik/ui-fixes`.
- Never touch the live service on gizmok87 :8766. Run your own server only via the helper.
- Screenshots: every PNG must come from a script `docs/_tools/shoot_<name>.py` that uses
  `docs/_tools/shots.py` (see its docstring and `docs/_tools/shoot_index.py`), so the lead can
  regenerate all of them after UI fixes land. Use YOUR port (given in your task). Prefer tile crops
  (`tiles=` in `shot`) over full pages; full page only where the layout is the point. Keep each PNG
  under ~400 KB (PIL `optimize=True`; quantize to 256 colours if it still looks right). Look at
  every screenshot you produce (Read the PNG) and check it shows what the text claims. Known UI
  bugs you will see in console logs: "dependencies failed to load", "searchBuilderConfig getter",
  controls reopening on deep-link restore (the helper works around it). Ignore those; report others.
- Views: build deep-link `view` objects (see `docs/reference/deep-links.md`; examples in
  `/Users/dotto/gits/annzarro-paper/data_prep/demo_panelsets/*.view.json` and
  `figures/screenshots.py`). Save each as `docs/_tools/views/<name>.json`. Where useful, also make
  the same view downloadable from the page as a panel set or share link.
- Build check: `cd docs && ../.venv-docs/bin/sphinx-build -W --keep-going -q -b html . /private/tmp/claude-501/docs-build-<yourname>`
  must give no warnings from your pages. Use your own output dir.
- Markdown is MyST: `{figure}` with `:class: screenshot`, `{note}`/`{important}`/`{warning}`,
  sphinx-design tabs/cards, `{cite:p}` with keys from `docs/references.bib`, `{doc}` cross refs to
  other pages (all page names exist as stubs, see the section `index.md` files).

## Voice
- Factual, specific, direct. No marketing words (powerful, seamless, cutting-edge, blazing).
  Few dashes as sentence structure. British spelling in prose (colour), but quote UI labels exactly
  as the app shows them (e.g. "Color", "Save Panel Set").
- Steps are numbered and click-level: which control, which value, what you should then see.
- Every number must come from the data, the paper's NOTES/JSON, or your own measurement. Never
  invent. If AnnZarro cannot reproduce part of a figure, say so plainly and show the closest
  equivalent, or how to precompute the missing field in Python.
- AnnZarro is read-only by design (no write-back, no code execution); panel sets are stored
  server-side and shared with all users of a server; any obsm columns can be axes, including
  spatial positions; table filters take arbitrary AND/OR logic; the target is dense chunked
  matrices; license MIT; paper is a preprint in preparation (cite as Otto, Baasri and Setty, in
  preparation).
