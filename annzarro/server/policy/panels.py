"""Panel and outbound keys: which panels a user may open, and which external
hosts the browser may contact for them.

``panel.<type>.enabled`` is declared for every entry of
``static/js/panels/panel-types.json`` (the panel registry the client reads), so
a new panel type gets its switch without a line here. The Gene Set Analysis
panel is the one panel that sends data out: its keys say how (``external_requests``),
to whom (``services``, ``species_search``) and whether it links out (``links``).
``outbound.allow_external`` is the "No external hosts" switch. The hosts these
keys allow become the page's Content-Security-Policy (``csp.py``), which is
what holds even against a modified client. See docs/design/policy-registry.md.
"""
import json
from typing import Any, Dict, List
from urllib.parse import urlsplit

from ...utils import paths
from .registry import Key, REGISTRY, declare
from .resolver import config_lookup
from .types import _HOST, BAD_CHOICE, BAD_TYPE, Bool, Enum, PolicyValueError, Subset

GENE_SET = "gene-set"

#: the host the STRING adapters call when integrations.string_db.base_url says nothing
STRING_DEFAULT_BASE_URL = "https://version-12-5.string-db.org/api"
#: ``panel.gene-set.species_search``: where a typed species name goes (species.js remoteSpeciesSearch)
SPECIES_HOSTS = ("api.ncbi.nlm.nih.gov", "www.ebi.ac.uk")
#: keep in step with ``ADAPTERS`` in static/js/panels/gene-set-utilities/services/index.js
#: and the ``provider.host`` of each (tests/js/outbound-hosts.test.mjs compares the two).
#: ``host`` None: the configured STRING base URL.
GENE_SET_SERVICES = (
    {"id": "string-enrichment", "label": "STRING enrichment", "host": None},
    {"id": "string-network", "label": "STRING network", "host": None},
    {"id": "string-partners", "label": "STRING partners", "host": None},
    {"id": "gprofiler-gost", "label": "g:Profiler", "host": "biit.cs.ut.ee"},
    {"id": "mygene-mapping", "label": "MyGene.info mapping", "host": "mygene.info"},
    {"id": "mygene-card", "label": "MyGene.info gene card", "host": "mygene.info"},
    {"id": "hpa", "label": "Human Protein Atlas", "host": "www.proteinatlas.org"},
    {"id": "enrichr", "label": "Enrichr", "host": "maayanlab.cloud"},
    {"id": "reactome", "label": "Reactome", "host": "reactome.org"},
)
#: services that keep the gene list where others can read it (their adapters' ``privacy``):
#: off by default on a hosted server
PUBLISHING_SERVICES = ("enrichr", "reactome")
EXTERNAL_REQUESTS = ("on", "ask", "off", "none")


def panel_types() -> List[Dict[str, Any]]:
    """The entries of panels/panel-types.json."""
    path = paths.frontend_dir("static") / "js" / "panels" / "panel-types.json"
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def string_host(config) -> str:
    """The host of ``integrations.string_db.base_url``. The client uses STRING's
    versioned host unless the URL is https (config.js readIntegrations), and so
    does this; any valid host name is taken, a mirror without a dot included."""
    for url in (config_lookup(config or {}, "integrations.string_db.base_url")[1], STRING_DEFAULT_BASE_URL):
        if isinstance(url, str) and url.startswith("https://"):
            try:
                host = urlsplit(url).netloc.lower()
            except ValueError:
                continue
            if "@" not in host and _HOST.match(host):
                return host
    return urlsplit(STRING_DEFAULT_BASE_URL).netloc


def service_hosts(ids, config) -> List[str]:
    hosts: List[str] = []
    for service in GENE_SET_SERVICES:
        if service["id"] in ids:
            host = service["host"] or string_host(config)
            if host not in hosts:
                hosts.append(host)
    return hosts


class ServiceSubset(Subset):
    """A subset of the adapter ids. The YAML has always also taken service
    names (``string`` for every ``string-*`` adapter); they are expanded."""

    def validate(self, value):
        if not isinstance(value, (list, tuple)):
            raise PolicyValueError(BAD_TYPE, "expected a list")
        ids: List[str] = []
        for item in value:
            if not isinstance(item, str):
                raise PolicyValueError(BAD_TYPE, "expected ids")
            matched = [i for i in self.ids if i == item or i.split("-")[0] == item]
            if not matched:
                raise PolicyValueError(BAD_CHOICE, f"{item!r} is not one of " + ", ".join(self.ids))
            ids.extend(i for i in matched if i not in ids)
        return self._order(ids)


class ExternalRequests(Enum):
    """``on > ask > off > none``, read as the client reads the YAML: trimmed and
    lower-case, and a bare YAML ``on``/``off`` (a boolean) as the word."""

    def validate(self, value):
        return super().validate(value.strip().lower() if isinstance(value, str) else value)


def _default_services(config) -> List[str]:
    """Everything on a single-user server (today's set); on a hosted one, without
    the services that publish the gene list (an operator decision)."""
    from ...core.remote import hosted_reasons
    hosted = bool(hosted_reasons(config or {}))
    return [s["id"] for s in GENE_SET_SERVICES if not (hosted and s["id"] in PUBLISHING_SERVICES)]


def _declare_panel_keys() -> None:
    for entry in panel_types():
        declare(Key(
            name=f"panel.{entry['type']}.enabled", type=Bool(), default=True, scope="user", combine="restrict",
            description=f"Whether the {entry.get('label', entry['type'])} panel may be used", area="panels"))


def _declare_outbound_keys() -> None:
    declare(Key(
        name="outbound.allow_external", type=Bool(), default=True, scope="user", combine="restrict", area="outbound",
        description="Whether the browser may contact hosts outside this server (off: the \"No external hosts\" switch, "
                    "which turns every outbound setting off)"))
    gate = ("panel.gene-set.enabled", "panel.gene-set.external_requests")
    declare(Key(
        name="panel.gene-set.external_requests", type=ExternalRequests(list(EXTERNAL_REQUESTS), off=["off", "none"],
                                                                   aliases={True: "on", False: "off"}),
        default="ask", scope="user", combine="restrict", area="outbound", config_path="integrations.external_requests",
        description="Whether Gene Set Analysis may send gene ids to external services: on (without asking), ask, "
                    "off (never; its links still work) or none (never, and no links)"))
    declare(Key(
        name="panel.gene-set.services", type=ServiceSubset([{"id": s["id"], "label": s["label"]} for s in GENE_SET_SERVICES]),
        default=_default_services, scope="user", combine="restrict", area="outbound", gated_by=gate,
        config_path="integrations.gene_set.services",
        outbound_hosts=lambda value, config: service_hosts(value, config),
        description="The external services Gene Set Analysis offers. Each one sends the selected gene ids to its host"))
    declare(Key(
        name="panel.gene-set.species_search", type=Bool(), default=True, scope="user", combine="restrict",
        area="outbound", gated_by=gate, outbound_hosts=lambda value, config: list(SPECIES_HOSTS) if value else [],
        description="Whether a typed species name may be looked up at NCBI Taxonomy and the ENA (no genes are sent)"))
    declare(Key(
        name="panel.gene-set.links", type=Bool(), default=True, scope="user", combine="restrict", area="outbound",
        description="Whether Gene Set Analysis offers links to third-party sites (opened by a click; the browser "
                    "cannot be stopped from navigating, so the links are removed instead)"))


def _no_external_hosts(values: Dict[str, Any]) -> Dict[str, Any]:
    """``outbound.allow_external`` false forces every outbound key to its no-outbound
    value, and ``external_requests: none`` is the same without the switch."""
    forced: Dict[str, Any] = {}
    if values.get("outbound.allow_external") is False:
        forced["panel.gene-set.external_requests"] = "none"
    if forced.get("panel.gene-set.external_requests", values.get("panel.gene-set.external_requests")) == "none":
        forced.update({"panel.gene-set.services": [], "panel.gene-set.species_search": False,
                       "panel.gene-set.links": False})
    return forced


_declare_panel_keys()
_declare_outbound_keys()
REGISTRY.constrain(_no_external_hosts)
