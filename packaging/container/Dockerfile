# syntax=docker/dockerfile:1
#
# AnnZarro server image: gunicorn serving the app, login on, data read-only.
#
#   docker build -f packaging/container/Dockerfile -t annzarro:local .
#   docker build -f packaging/container/Dockerfile --build-arg EXTRAS=remote -t annzarro:remote .
#
# Build context is the repository root.

# python:3.12-slim, pinned by digest (multi-arch index); bump it deliberately.
ARG PYTHON_IMAGE=python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1

FROM ${PYTHON_IMAGE} AS build
WORKDIR /src
COPY scripts/vendor_assets.py scripts/vendor-assets.json scripts/
# The frontend bundles (jQuery, Plotly, ...) are downloaded here and verified against the SHA-256
# in scripts/vendor-assets.json; a changed upstream file fails the build. setup.py then packages them.
RUN python scripts/vendor_assets.py
COPY pyproject.toml setup.py MANIFEST.in README.md LICENSE CHANGELOG.md ./
COPY annzarro annzarro
COPY static static
COPY templates templates
# static/vendor was filled above (the .dockerignore keeps a local copy out of the context).
ARG EXTRAS=
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/venv/bin/pip install --no-cache-dir ".${EXTRAS:+[$EXTRAS]}" "gunicorn>=22" \
 && /opt/venv/bin/python -c "import annzarro; print('annzarro', annzarro.__version__)"

FROM ${PYTHON_IMAGE}
ARG VERSION=unknown
ARG REVISION=unknown
LABEL org.opencontainers.image.title="AnnZarro" \
      org.opencontainers.image.description="Read-only browser viewer for AnnData (zarr, h5ad), production server" \
      org.opencontainers.image.source="https://github.com/settylab/annzarro" \
      org.opencontainers.image.url="https://annzarro.readthedocs.io" \
      org.opencontainers.image.documentation="https://annzarro.readthedocs.io" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

# A fixed uid/gid, so a bind-mounted /state can be chown'ed on the host: chown -R 10001:10001 state
RUN groupadd --system --gid 10001 annzarro \
 && useradd --system --uid 10001 --gid annzarro --home-dir /state --shell /usr/sbin/nologin annzarro \
 && mkdir -p /data /state /etc/annzarro && chown annzarro:annzarro /state
COPY --from=build /opt/venv /opt/venv
COPY packaging/container/container.yaml /etc/annzarro/container.yaml
COPY packaging/container/healthcheck.py packaging/container/entrypoint.sh /opt/

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ANNZARRO_HOME=/state \
    ANNZARRO_CONFIG=/etc/annzarro/container.yaml

USER annzarro
WORKDIR /state
# /data: the datasets, mount read-only. /state: users, panel sets, admin settings, logs.
VOLUME ["/state"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "/opt/healthcheck.py"]

ENTRYPOINT ["/opt/entrypoint.sh"]
# Once `annzarro serve` ships, this becomes: CMD ["annzarro", "serve"]
CMD ["gunicorn", "-c", "python:annzarro.server.gunicorn_config", "annzarro.server.wsgi:create_wsgi_app()"]
