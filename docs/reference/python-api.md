# Python API

AnnZarro is first a web application, but its readers are ordinary Python. Everything on this page
is importable from the top-level package (`from annzarro import ZarrReader`) and is listed in
`annzarro.__all__`; a test holds this page to that list. Other modules and names are internal and
may change without notice.

```python
from annzarro import ZarrReader

reader = ZarrReader()
path = "/data/bm_aging_annzarro.zarr"
root, metadata = reader.open_dataset_by_path(path)   # the zarr group, and what the store holds
print(metadata["shape"])                              # (n_cells, n_genes)
genes = reader.get_var_names(path)
```

Docstrings use the Google style. Types of `anndata`, `zarr` and `numpy` link to their own
documentation.

(python-api-version)=
## Version

```{py:data} annzarro.__version__
:type: str

The installed version, from the package metadata.
```

## Reading a store

`ZarrReader` reads the AnnData layout of a zarr store (local, `s3://`, `gs://` or `http(s)://`;
zarr format 2 or 3) lazily, without loading what a call does not ask for, and keeps decoded
slices in a bounded cache. It is the class the web server is built on, so a call here has the
same limits as the HTTP API ({doc}`http-api`).

```{eval-rst}
.. autoclass:: annzarro.ZarrReader
   :members: open_dataset_by_path, get_metadata, get_basic_counts, get_X, get_layer, get_obs_var,
             get_obsm_varm, get_obsp_varp, get_uns_keys, get_uns_structure, get_uns,
             get_cell_gene_names, get_obs_names, get_var_names, get_cache_info, clear_cache,
             validate_zarr_url
```

```{py:data} annzarro.zarr_reader
:type: annzarro.ZarrReader

The reader the server and `DataManager` share: one per process, with the cache settings of the
configuration. Use it to read through the same cache as a running server in the same process;
make your own `ZarrReader()` for anything else.
```

### Errors

These are raised by the reader. The first two are `ValueError`s, `MissingKeyError` a `KeyError`,
so code that caught the general type keeps working.

```{eval-rst}
.. autoexception:: annzarro.UnsupportedEncodingError
.. autoexception:: annzarro.ZarrFormatError
.. autoexception:: annzarro.StoreReadError
.. autoexception:: annzarro.MissingKeyError
```

## Listing datasets

```{eval-rst}
.. autoclass:: annzarro.DataManager
   :members: discover_datasets, list_datasets, get_dataset_info
```

```{py:data} annzarro.data_manager
:type: annzarro.DataManager

The manager the server's dataset routes use.
```

## Checking a store's layout

`check_store` is what {doc}`annzarro store check <cli>` runs: it reads metadata only, and reports
the layouts that make AnnZarro slow, with a fix for each ({doc}`../data/chunking`).

```{eval-rst}
.. autofunction:: annzarro.check_store
.. autoexception:: annzarro.StoreCheckError
```

## Serving

```{eval-rst}
.. autofunction:: annzarro.run_server
.. autofunction:: annzarro.create_app
.. autofunction:: annzarro.create_wsgi_app
```

## Figures

`annzarro export` writes a figure with the view that drew it inside the file
({doc}`../user-guide/reproducing`). `read_recipe` reads it back.

```{eval-rst}
.. autofunction:: annzarro.read_recipe
.. autoexception:: annzarro.ExportError
```
