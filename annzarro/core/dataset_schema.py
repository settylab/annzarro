"""The versioned schema of ``uns["annzarro"]``: what a dataset says about itself, and how to read it.

This module is pure: it works on a plain Python tree (what ``core/dataset_info.py`` reads from the
store: nested dicts, lists, strings, numbers) and returns normalised fields. It never touches a store.

Version marker
    Two plain text keys inside the dict, ``schema`` (``"annzarro.dataset-info"``) and
    ``schema_version`` (``"1.0"``). They are ordinary values, so they survive anndata's own write of
    a nested ``uns`` dict in zarr format 2 and 3 and in h5ad. (The ``encoding-type`` and
    ``encoding-version`` attributes are anndata's: it writes them on every group itself and a
    user's dict cannot set them.) A dict without the marker is version 1.

Compatibility rules
    Additive changes (a new optional key, a new accepted form) raise the minor version. Renames,
    removals and changes of meaning raise the major version. A reader ignores keys it does not
    know and never fails on them. A newer minor is read in full; a newer major is read by the
    newest reader this build has, for the fields that are still there, and says so (``schema.note``).
    There is one reader function per major version (``READERS``), so a version 2 reader can live
    beside the version 1 one.

Simple and rich forms
    Every field accepts its simple form (a string) and, where it makes sense, a richer one (an
    object or a list of them). Both are normalised to one shape, so a richer form never breaks an
    older reader of the simple fields and an old simple form keeps working in newer readers.
    A list of objects may also be written as an object keyed ``"0"``, ``"1"``, ... (anndata cannot
    write a list of dicts; ``annzarro store annotate`` writes that form).
"""
from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import quote

__all__ = ["SCHEMA_NAME", "CURRENT_VERSION", "FIELDS", "FIELD_SPECS", "READERS", "normalise", "parse_version",
           "format_version", "http_url", "contact_url", "MAX_FIELD_BYTES"]

SCHEMA_NAME = "annzarro.dataset-info"
#: The version ``annzarro store annotate`` writes and the newest reader understands.
CURRENT_VERSION = (1, 0)

#: Longest accepted text of one field (UTF-8 bytes); one long field is cut, not refused.
MAX_FIELD_BYTES = 16 * 1024
MAX_ITEM_BYTES = 500
MAX_LIST = 500
MAX_PROVENANCE = 20

#: ``(name, since, form, spellings, meaning)`` of every field, in the order the spec lists them.
FIELD_SPECS: List[Tuple[str, str, str, Tuple[str, ...], str]] = [
    ("title", "1.0", "text", ("title",), "A short title."),
    ("description", "1.0", "text", ("description",), "One or two sentences about the data."),
    ("license", "1.0", "text | {id, name, url, text}", ("license", "licence"), "An SPDX identifier or the licence in words."),
    ("license_url", "1.0", "http(s) URL", ("license_url", "licence_url"), "A link to the licence."),
    ("citation", "1.0", "text | {text}", ("citation",), "How to cite the data."),
    ("doi", "1.0", "text | {id}", ("doi",), "The DOI of the data or its paper."),
    ("authors", "1.0", "text | list of text | list of {name, orcid, affiliation}", ("authors", "author"), "Who made the data."),
    ("source_url", "1.0", "http(s) URL", ("source_url",), "Where the data came from."),
    ("contact", "1.0", "text | {name, email, url, role}", ("contact",), "A contact: an email address, a web address or a name."),
    ("contacts", "1.0", "list of text | list of {name, email, url, role}", ("contacts",), "Several contacts."),
    ("attribution", "1.0", "text", ("attribution",), "The credit the licence asks for."),
    ("funding", "1.0", "text | list of text | list of {funder, award, url}", ("funding",), "Who funded the data."),
    ("provenance", "1.0", "object of text", ("provenance",), "How the data came to be: source, processing, software, date, notes."),
]
#: ``{field: accepted spellings}``; the first spelling is the name.
FIELDS: Dict[str, Tuple[str, ...]] = {name: spellings for name, _since, _form, spellings, _doc in FIELD_SPECS}
MARKER_KEYS = ("schema", "schema_version")

_DOI = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)?(10\.\d{4,9}/\S+)$", re.IGNORECASE)
_EMAIL = re.compile(r"^[^\s@<>\"']+@[^\s@<>\"']+\.[^\s@<>\"']+$")
_ORCID = re.compile(r"^(?:https?://orcid\.org/)?(\d{4}-\d{4}-\d{4}-\d{3}[\dX])$")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_VERSION = re.compile(r"^\s*(\d{1,4})(?:\.(\d{1,4}))?\s*$")


# ---- small helpers ---------------------------------------------------------------------------

def http_url(value) -> Optional[str]:
    """``value`` when it is an http(s) address, else None."""
    if not isinstance(value, str) or not value or re.search(r"\s", value):
        return None
    return value if re.match(r"^https?://[^/\s]+", value, re.IGNORECASE) else None


def contact_url(value) -> Optional[str]:
    """A ``mailto:`` link for an email address, the address itself for an http(s) one, else None."""
    if not isinstance(value, str) or not value:
        return None
    return "mailto:" + value if _EMAIL.match(value) else http_url(value)


def _cut(text: str, limit: int) -> str:
    data = text.encode("utf-8", errors="replace")
    return text if len(data) <= limit else data[:limit].decode("utf-8", errors="ignore")


def _text(value, limit: int = MAX_FIELD_BYTES) -> Optional[str]:
    """A cleaned text, or None for anything that is not a non-empty string."""
    if not isinstance(value, str):
        return None
    text = _CONTROL.sub("", value).strip()
    return _cut(text, limit) if text else None


def _scalar_text(value, limit: int = MAX_ITEM_BYTES) -> Optional[str]:
    """Text for a string, number or bool (a provenance value, a version written as a number)."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return _text(value, limit)


def _items(value) -> List[Any]:
    """A list from a list, an object keyed ``"0"``, ``"1"``... (in that order), or one value."""
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)[:MAX_LIST]
    if isinstance(value, dict):
        if value and all(isinstance(k, str) and k.isdigit() for k in value):
            return [value[k] for k in sorted(value, key=int)][:MAX_LIST]
        return [value]
    return [value]


def _first_text(obj: Dict[str, Any], *keys: str, limit: int = MAX_ITEM_BYTES) -> Optional[str]:
    for key in keys:
        found = _text(obj.get(key), limit)
        if found:
            return found
    return None


def parse_version(value) -> Optional[Tuple[int, int]]:
    """``(major, minor)`` of ``"1.0"``, ``"2"``, ``1`` or ``1.1``, else None."""
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return None
    match = _VERSION.match(str(value))
    if not match or int(match.group(1)) < 1:
        return None
    return int(match.group(1)), int(match.group(2) or 0)


def format_version(version: Tuple[int, int]) -> str:
    return f"{version[0]}.{version[1]}"


# ---- the version 1 reader --------------------------------------------------------------------

def _lookup(tree: Dict[str, Any], name: str):
    for spelling in FIELDS[name]:
        if spelling in tree:
            return spelling, tree[spelling]
    return None, None


def _license(value, fields: Dict[str, Any], bad: List[str]) -> None:
    if isinstance(value, dict):
        text = _first_text(value, "text", "name", "id")
        ident = _first_text(value, "id")
        url = http_url(_first_text(value, "url", limit=2000))
        if _first_text(value, "url", limit=2000) and not url:
            bad.append("license.url")
        if text:
            fields["license"] = text
        if ident:
            fields["license_id"] = ident
        if url:
            fields["license_url"] = url
        if not (text or ident or url):
            bad.append("license")
        return
    text = _text(value)
    if text:
        fields["license"] = text
    elif not isinstance(value, str):
        bad.append("license")


def _author(item) -> Optional[Dict[str, Any]]:
    if isinstance(item, str):
        name = _text(item, 300)
        return {"name": name} if name else None
    if isinstance(item, dict):
        name = _first_text(item, "name", limit=300)
        if not name:
            return None
        out: Dict[str, Any] = {"name": name}
        affiliation = _first_text(item, "affiliation", limit=300)
        if affiliation:
            out["affiliation"] = affiliation
        orcid = _ORCID.match(_first_text(item, "orcid", limit=100) or "")
        if orcid:
            out["orcid"] = orcid.group(1)
            out["orcid_url"] = "https://orcid.org/" + orcid.group(1)
        return out
    return None


def _contact(item) -> Optional[Dict[str, Any]]:
    if isinstance(item, str):
        text = _text(item, 300)
        if not text:
            return None
        if _EMAIL.match(text):
            return {"email": text, "url": "mailto:" + text}
        if http_url(text):
            return {"url": text}
        return {"name": text}
    if isinstance(item, dict):
        out: Dict[str, Any] = {}
        for key in ("name", "role"):
            value = _first_text(item, key, limit=300)
            if value:
                out[key] = value
        email = _first_text(item, "email", limit=300)
        if email and _EMAIL.match(email):
            out["email"] = email
            out["url"] = "mailto:" + email
        link = http_url(_first_text(item, "url", limit=2000))
        if link and "url" not in out:
            out["url"] = link
        return out or None
    return None


def _funding(item) -> Optional[Dict[str, Any]]:
    if isinstance(item, str):
        text = _text(item, 300)
        return {"funder": text} if text else None
    if isinstance(item, dict):
        out: Dict[str, Any] = {}
        for key in ("funder", "award"):
            value = _first_text(item, key, limit=300)
            if value:
                out[key] = value
        link = http_url(_first_text(item, "url", limit=2000))
        if link:
            out["url"] = link
        return out if out.get("funder") or out.get("award") else None
    return None


def _read_v1(tree: Dict[str, Any]) -> Tuple[Dict[str, Any], set, List[str]]:
    """The version 1 fields of ``tree``: ``(fields, keys used, names of values that were ignored)``."""
    fields: Dict[str, Any] = {}
    used: set = set()
    bad: List[str] = []
    for name in FIELDS:
        spelling, value = _lookup(tree, name)
        if spelling is None:
            continue
        used.update(s for s in FIELDS[name] if s in tree)
        if name == "license":
            _license(value, fields, bad)
        elif name == "authors":
            people = [a for a in map(_author, _items(value)) if a]
            if people:
                fields["authors"] = [p["name"] for p in people]
                if any(len(p) > 1 for p in people):
                    fields["author_details"] = people
            else:
                bad.append(spelling)
        elif name in ("contact", "contacts"):
            people = [c for c in map(_contact, _items(value)) if c]
            if people:
                fields.setdefault("contacts", [])
                fields["contacts"] = (fields["contacts"] + people) if name == "contacts" else (people + fields["contacts"])
            else:
                bad.append(spelling)
        elif name == "funding":
            grants = [g for g in map(_funding, _items(value)) if g]
            if grants:
                fields["funding"] = grants
            else:
                bad.append(spelling)
        elif name == "provenance":
            if isinstance(value, dict):
                shown = {}
                for key in list(value)[:MAX_PROVENANCE]:
                    text = _scalar_text(value[key])
                    if text and isinstance(key, str):
                        shown[_cut(key, 50)] = text
                if shown:
                    fields["provenance"] = shown
                else:
                    bad.append(spelling)
            else:
                bad.append(spelling)
        elif name in ("license_url", "source_url"):
            raw = _text(value, 2000)
            url = http_url(raw)
            if url:
                fields[name] = url
            else:
                bad.append(spelling)
        elif name == "citation" and isinstance(value, dict):
            text = _first_text(value, "text", limit=MAX_FIELD_BYTES)
            if text:
                fields["citation"] = text
            else:
                bad.append(spelling)
        elif name == "doi" and isinstance(value, dict):
            text = _first_text(value, "id", "value", "doi")
            if text:
                fields["doi"] = text
            else:
                bad.append(spelling)
        else:
            text = _text(value)
            if text:
                fields[name] = text
            else:
                if not (isinstance(value, str)):          # an empty string is simply not there
                    bad.append(spelling)
    # derived: the simple fields the rest of the program shows
    doi = fields.get("doi")
    match = _DOI.match(doi) if doi else None
    if match:
        fields["doi"] = match.group(1)
        fields["doi_url"] = "https://doi.org/" + quote(match.group(1), safe="/()-._~:;")
    contacts = fields.get("contacts")
    if contacts:
        first = contacts[0]
        fields["contact"] = first.get("email") or first.get("url") or first.get("name")
        if first.get("url"):
            fields["contact_url"] = first["url"]
    return fields, used, bad


#: One reader per major version: ``{major: reader(tree) -> (fields, keys used, ignored names)}``.
READERS: Dict[int, Callable[[Dict[str, Any]], Tuple[Dict[str, Any], set, List[str]]]] = {1: _read_v1}


# ---- entry -----------------------------------------------------------------------------------

def normalise(tree: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Read a plain tree as ``uns["annzarro"]``.

    Returns ``{"fields", "unknown", "ignored", "schema"}``: the normalised fields, the names of
    keys this reader does not know (kept in the dataset, never an error), the names of known keys
    whose value could not be used, and ``{"name", "version", "declared", "newer", "reader", "note"}``.
    """
    tree = tree if isinstance(tree, dict) else {}
    ignored: List[str] = []
    declared = parse_version(tree.get("schema_version")) if "schema_version" in tree else None
    if "schema_version" in tree and declared is None:
        ignored.append("schema_version")
    version = declared or (1, 0)
    note = None
    name = _text(tree.get("schema"), 100) if "schema" in tree else None
    if name and name != SCHEMA_NAME:
        note = f"uns[\"annzarro\"] declares the schema {name!r}, not {SCHEMA_NAME!r}; reading it as {SCHEMA_NAME} {format_version(version)}."
    newer = None
    reader_major = version[0]
    if version[0] > max(READERS):
        reader_major = max(READERS)
        newer = "major"
        note = (f"This dataset was written for a newer AnnZarro (schema {format_version(version)}). "
                "Showing the fields this version understands.")
    elif version[0] == CURRENT_VERSION[0] and version[1] > CURRENT_VERSION[1]:
        newer = "minor"
    fields, used, bad = READERS[reader_major](tree)
    ignored.extend(bad)
    unknown = sorted(k for k in tree if k not in used and k not in MARKER_KEYS)    # stores list members in no fixed order
    return {"fields": fields, "unknown": unknown, "ignored": ignored,
            "schema": {"name": SCHEMA_NAME, "version": format_version(version), "declared": declared is not None,
                       "newer": newer, "reader": reader_major, "note": note}}
