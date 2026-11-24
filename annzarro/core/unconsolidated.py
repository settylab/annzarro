"""Open a local zarr 3 group from the nodes' own metadata, at every depth.

``zarr.open_group(path, use_consolidated=False)`` skips the consolidated
listing for the ROOT group only. zarr 3 writes a ``consolidated_metadata``
entry (an empty one for a group without members of its own listing) into
every group's own metadata when a store is consolidated; a child group
opened from the root reads that entry and answers its members from it, so
``var`` of a store with a stale ``.zmetadata`` listed no members at all and
the gene names came back as ``[]`` (found after a Refresh).

The store wrapper here removes that entry from the group metadata it
reads, so every group lists and opens its members from the files. It only
reads: nothing is ever written to the dataset.
"""
import json

import zarr
from zarr.storage import LocalStore, WrapperStore

_GROUP_DOCS = (".zgroup", "zarr.json")


class _WithoutListing(WrapperStore):
    async def get(self, key, prototype, byte_range=None):
        buf = await self._store.get(key, prototype, byte_range)
        if buf is None or byte_range is not None or key.rsplit("/", 1)[-1] not in _GROUP_DOCS:
            return buf
        try:
            doc = json.loads(buf.to_bytes())
        except ValueError:
            return buf
        if not isinstance(doc, dict) or "consolidated_metadata" not in doc:
            return buf
        del doc["consolidated_metadata"]
        return prototype.buffer.from_bytes(json.dumps(doc).encode("utf-8"))


def open_group(path):
    """The root group of the local store at ``path``, read-only, every group from its own metadata."""
    store = _WithoutListing(LocalStore(str(path), read_only=True))
    return zarr.open_group(store, mode="r", use_consolidated=False)
