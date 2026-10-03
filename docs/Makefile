# Build:  make -C docs html   (output in docs/_build/html)
SPHINXBUILD ?= sphinx-build
html:
	$(SPHINXBUILD) -W --keep-going -b html . _build/html
linkcheck:
	$(SPHINXBUILD) -b linkcheck . _build/linkcheck
clean:
	rm -rf _build
