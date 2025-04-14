"""
Tests for the ZarrReader class.
"""
import os
import tempfile
import unittest
import numpy as np
import zarr
from unittest.mock import patch, MagicMock

# For tests we use absolute imports to ensure we're testing the installed package
from annzarro.core.zarr_reader import ZarrReader

class TestZarrReader(unittest.TestCase):
    """Test cases for ZarrReader."""

    def setUp(self):
        """Set up the test environment."""
        self.reader = ZarrReader()
        
        # Create a temporary directory for test files
        self.temp_dir = tempfile.TemporaryDirectory()
        self.zarr_path = os.path.join(self.temp_dir.name, 'test.zarr')
        
        # Create a simple zarr store
        self.create_test_zarr()

    def tearDown(self):
        """Clean up the test environment."""
        self.temp_dir.cleanup()

    def create_test_zarr(self):
        """Create a test zarr archive."""
        # Create a new zarr store
        root = zarr.open_group(self.zarr_path, mode='w')
        
        # Create X matrix
        X = np.random.rand(100, 50).astype('float32')
        root.create_dataset('X', data=X)
        
        # Create obs
        obs_group = root.create_group('obs')
        cell_ids = np.array([f'cell_{i}' for i in range(100)])
        obs_group.create_dataset('_index', data=cell_ids)
        cell_types = np.array(['type_A'] * 50 + ['type_B'] * 50)
        obs_group.create_dataset('cell_type', data=cell_types)
        
        # Create var
        var_group = root.create_group('var')
        gene_ids = np.array([f'gene_{i}' for i in range(50)])
        var_group.create_dataset('_index', data=gene_ids)
        gene_names = np.array([f'GENE_{i}' for i in range(50)])
        var_group.create_dataset('gene_name', data=gene_names)
        
        # Create obsm with a standard matrix
        obsm_group = root.create_group('obsm')
        umap = np.random.rand(100, 2).astype('float32')
        obsm_group.create_dataset('X_umap', data=umap)
        
        # Create a dataframe-encoded obsm matrix (like AbCapture in the aging.zarr dataset)
        df_obsm = obsm_group.create_group('cell_markers')
        # Set dataframe attributes
        df_obsm.attrs['encoding-type'] = 'dataframe'
        df_obsm.attrs['encoding-version'] = '0.2.0'
        df_obsm.attrs['_index'] = '_index'
        df_obsm.attrs['column-order'] = ['CD4', 'CD8', 'CD19']
        
        # Create index column
        index_group = df_obsm.create_group('_index')
        index_group.create_dataset('0', data=cell_ids)
        index_group.attrs['encoding-type'] = 'string-array'
        
        # Create data columns
        for col_name in ['CD4', 'CD8', 'CD19']:
            col_group = df_obsm.create_group(col_name)
            col_data = np.random.rand(100).astype('float32')
            col_group.create_dataset('0', data=col_data)
            col_group.attrs['encoding-type'] = 'array'
        
        # Create varm with a standard matrix
        varm_group = root.create_group('varm')
        pca_loadings = np.random.rand(50, 10).astype('float32')
        varm_group.create_dataset('PCs', data=pca_loadings)
        
        # Create a dataframe-encoded varm matrix (like kompot_de_* in the aging.zarr dataset)
        df_varm = varm_group.create_group('differential_expression')
        # Set dataframe attributes
        df_varm.attrs['encoding-type'] = 'dataframe'
        df_varm.attrs['encoding-version'] = '0.2.0'
        df_varm.attrs['_index'] = '_index'
        df_varm.attrs['column-order'] = ['cell type A', 'cell type B', 'cell type C']
        
        # Create index column
        index_group = df_varm.create_group('_index')
        index_group.create_dataset('0', data=gene_ids)
        index_group.attrs['encoding-type'] = 'string-array'
        
        # Create data columns with spaces in names
        for col_name in ['cell type A', 'cell type B', 'cell type C']:
            col_group = df_varm.create_group(col_name)
            col_data = np.random.rand(50).astype('float32')
            col_group.create_dataset('0', data=col_data)
            col_group.attrs['encoding-type'] = 'array'
        
        # Create obsp (observation-observation matrices)
        obsp_group = root.create_group('obsp')
        # Create a connectivities matrix (sparse representation of cell-cell relationships)
        connectivities = np.random.rand(100, 100).astype('float32')
        np.fill_diagonal(connectivities, 1.0)  # Cells always connect to themselves
        obsp_group.create_dataset('connectivities', data=connectivities)
        # Create a distances matrix
        distances = np.random.rand(100, 100).astype('float32')
        np.fill_diagonal(distances, 0.0)  # Distance to self is zero
        obsp_group.create_dataset('distances', data=distances)
        
        # Create varp (variable-variable matrices)
        varp_group = root.create_group('varp')
        # Create a correlation matrix between genes
        correlation = np.random.rand(50, 50).astype('float32')
        np.fill_diagonal(correlation, 1.0)  # Self-correlation is 1
        varp_group.create_dataset('correlation', data=correlation)
        
        # Create layers group
        layers_group = root.create_group('layers')
        
        # Create a regular dense layer
        raw = np.random.rand(100, 50).astype('float32')
        layers_group.create_dataset('raw', data=raw)
        
        # 1. Create a CSR sparse matrix layer (Compressed Sparse Row)
        csr_group = layers_group.create_group('logged_counts')
        
        # Create data for sparse matrix (around 10% non-zero values)
        n_nonzero = int(100 * 50 * 0.1)
        data = np.random.rand(n_nonzero).astype('float32')
        
        # Create random indices
        indices = np.random.randint(0, 50, size=n_nonzero)
        
        # Create indptr (CSR format)
        # Each row has approximately the same number of non-zero elements
        nnz_per_row = n_nonzero // 100
        indptr = np.zeros(101, dtype=np.int32)
        for i in range(1, 101):
            indptr[i] = indptr[i-1] + nnz_per_row
        
        # Create the CSR components
        csr_group.create_dataset('data', data=data)
        csr_group.create_dataset('indices', data=indices)
        csr_group.create_dataset('indptr', data=indptr)
        
        # Set attributes for CSR sparse matrix
        csr_group.attrs['encoding-type'] = 'csr_matrix'
        csr_group.attrs['encoding-version'] = '0.1.0'
        csr_group.attrs['shape'] = [100, 50]
        
        # 2. Create a CSC sparse matrix layer (Compressed Sparse Column)
        csc_group = layers_group.create_group('csc_matrix')
        
        # Create data for sparse matrix (around 10% non-zero values)
        n_nonzero = int(100 * 50 * 0.1)
        data = np.random.rand(n_nonzero).astype('float32')
        
        # Create random indices
        indices = np.random.randint(0, 100, size=n_nonzero)  # Row indices for CSC
        
        # Create indptr (CSC format)
        # Each column has approximately the same number of non-zero elements
        nnz_per_col = n_nonzero // 50
        indptr = np.zeros(51, dtype=np.int32)
        for i in range(1, 51):
            indptr[i] = indptr[i-1] + nnz_per_col
        
        # Create the CSC components
        csc_group.create_dataset('data', data=data)
        csc_group.create_dataset('indices', data=indices)
        csc_group.create_dataset('indptr', data=indptr)
        
        # Set attributes for CSC sparse matrix
        csc_group.attrs['encoding-type'] = 'csc_matrix'
        csc_group.attrs['encoding-version'] = '0.1.0'
        csc_group.attrs['shape'] = [100, 50]
        
        # 3. Create a COO sparse matrix layer (Coordinate format)
        coo_group = layers_group.create_group('coo_matrix')
        
        # Create data for sparse matrix (around 10% non-zero values)
        n_nonzero = int(100 * 50 * 0.1)
        data = np.random.rand(n_nonzero).astype('float32')
        
        # Create random row and column indices
        row_indices = np.random.randint(0, 100, size=n_nonzero)
        col_indices = np.random.randint(0, 50, size=n_nonzero)
        
        # Create the COO components
        coo_group.create_dataset('data', data=data)
        coo_group.create_dataset('row', data=row_indices)
        coo_group.create_dataset('col', data=col_indices)
        
        # Set attributes for COO sparse matrix
        coo_group.attrs['encoding-type'] = 'coo_matrix'
        coo_group.attrs['encoding-version'] = '0.1.0'
        coo_group.attrs['shape'] = [100, 50]

    def test_open_zarr(self):
        """Test opening zarr from local path."""
        # Test opening a valid zarr file
        dataset_id = self.reader.open_zarr(self.zarr_path)
        self.assertIsNotNone(dataset_id)
        self.assertTrue(self.reader.is_initialized(dataset_id))
        
        # Test opening an invalid path with a try-except block
        reader2 = ZarrReader()
        try:
            dataset_id2 = reader2.open_zarr('/invalid/path')
            self.fail("Should have raised an exception with invalid path")
        except Exception:
            # This is expected
            pass
        self.assertFalse(reader2.is_initialized())

    def test_get_metadata(self):
        """Test getting metadata."""
        dataset_id = self.reader.open_zarr(self.zarr_path)
        metadata = self.reader.get_metadata(dataset_id)
        
        # Check that metadata contains expected fields
        self.assertEqual(metadata['shape'], (100, 50))
        self.assertTrue(metadata['has_obs'])
        self.assertTrue(metadata['has_var'])
        self.assertTrue(metadata['has_obsm'])
        self.assertTrue(metadata['has_layers'])
        self.assertTrue(metadata['has_obsp'])
        self.assertTrue(metadata['has_varp'])
        
        # Check that embeddings are detected
        if 'embeddings' in metadata:
            self.assertIn('X_umap', metadata['embeddings'])
        elif 'obsm' in metadata:
            self.assertIn('X_umap', metadata['obsm'])
            
        # Check that layers are detected
        if 'layers' in metadata:
            if isinstance(metadata['layers'], list):
                self.assertIn('raw', metadata['layers'])
            elif isinstance(metadata['layers'], dict) and 'keys' in metadata['layers']:
                self.assertIn('raw', metadata['layers']['keys'])
            
        # Check that obs and var columns are detected
        self.assertIn('cell_type', metadata['obs_columns'])
        self.assertIn('gene_name', metadata['var_columns'])
        
        # Check that obsp and varp matrices are detected
        if 'obsp' in metadata:
            if isinstance(metadata['obsp'], list):
                self.assertIn('connectivities', metadata['obsp'])
                self.assertIn('distances', metadata['obsp'])
            elif isinstance(metadata['obsp'], dict) and 'keys' in metadata['obsp']:
                self.assertIn('connectivities', metadata['obsp']['keys'])
                self.assertIn('distances', metadata['obsp']['keys'])
                
        if 'varp' in metadata:
            if isinstance(metadata['varp'], list):
                self.assertIn('correlation', metadata['varp'])
            elif isinstance(metadata['varp'], dict) and 'keys' in metadata['varp']:
                self.assertIn('correlation', metadata['varp']['keys'])
                
        # Check for dataframe metadata in obsm
        self.assertIn('obsm_dataframes', metadata)
        self.assertIn('cell_markers', metadata['obsm_dataframes'])
        df_columns = metadata['obsm_dataframes']['cell_markers']['columns']
        self.assertEqual(len(df_columns), 3)
        self.assertIn('CD4', df_columns)
        self.assertIn('CD8', df_columns)
        self.assertIn('CD19', df_columns)
        
        # Check for dataframe metadata in varm
        self.assertIn('varm_dataframes', metadata)
        self.assertIn('differential_expression', metadata['varm_dataframes'])
        df_columns = metadata['varm_dataframes']['differential_expression']['columns']
        self.assertEqual(len(df_columns), 3)
        self.assertIn('cell type A', df_columns)
        self.assertIn('cell type B', df_columns)
        self.assertIn('cell type C', df_columns)
        
        # Verify encoding type and version are included
        self.assertEqual(metadata['obsm_dataframes']['cell_markers']['encoding_type'], 'dataframe')
        self.assertEqual(metadata['obsm_dataframes']['cell_markers']['encoding_version'], '0.2.0')
        self.assertEqual(metadata['varm_dataframes']['differential_expression']['encoding_type'], 'dataframe')
        self.assertEqual(metadata['varm_dataframes']['differential_expression']['encoding_version'], '0.2.0')
    
    def test_load_zarr_with_dataset_id(self):
        """Test loading zarr with dataset ID."""
        # Load with explicit dataset ID
        dataset_id = "test_dataset_1"
        result_id = self.reader.load_zarr(self.zarr_path, dataset_id=dataset_id)
        
        # Verify dataset was loaded correctly
        self.assertEqual(result_id, dataset_id)
        self.assertTrue(dataset_id in self.reader.dataset_stores)
        self.assertEqual(self.reader.active_dataset_id, dataset_id)
        
        # Load another dataset with different ID
        dataset_id2 = "test_dataset_2"
        zarr_path2 = os.path.join(self.temp_dir.name, 'test2.zarr')
        # Create another test zarr file
        root = zarr.open_group(zarr_path2, mode='w')
        root.create_dataset('X', data=np.random.rand(50, 30).astype('float32'))
        
        result_id2 = self.reader.load_zarr(zarr_path2, dataset_id=dataset_id2)
        
        # Verify second dataset was loaded correctly
        self.assertEqual(result_id2, dataset_id2)
        self.assertTrue(dataset_id2 in self.reader.dataset_stores)
        
        # The active dataset should now be the second one
        self.assertEqual(self.reader.active_dataset_id, dataset_id2)
        
        # Check that both datasets are in the loaded datasets list
        loaded_datasets = self.reader.get_loaded_datasets()
        self.assertEqual(len(loaded_datasets), 2)
        self.assertIn(dataset_id, loaded_datasets)
        self.assertIn(dataset_id2, loaded_datasets)
        
        # Test switching between datasets
        self.reader.set_active_dataset(dataset_id)
        self.assertEqual(self.reader.active_dataset_id, dataset_id)
        metadata = self.reader.get_metadata()
        self.assertEqual(metadata['shape'], (100, 50))
        
        self.reader.set_active_dataset(dataset_id2)
        self.assertEqual(self.reader.active_dataset_id, dataset_id2)
        metadata = self.reader.get_metadata()
        self.assertEqual(metadata['shape'], (50, 30))
        
        # Test unloading a dataset
        self.reader.unload_dataset(dataset_id2)
        self.assertNotIn(dataset_id2, self.reader.dataset_stores)
        self.assertEqual(self.reader.active_dataset_id, dataset_id)  # Should switch back to dataset_id
        loaded_datasets = self.reader.get_loaded_datasets()
        self.assertEqual(len(loaded_datasets), 1)
        self.assertIn(dataset_id, loaded_datasets)

    def test_get_obs_names(self):
        """Test getting observation names."""
        self.reader.open_zarr(self.zarr_path)
        obs_names = self.reader.get_obs_names()
        
        # Check that we get 100 cell names
        self.assertEqual(len(obs_names), 100)
        self.assertEqual(obs_names[0], 'cell_0')
        self.assertEqual(obs_names[99], 'cell_99')
        
    def test_get_data_with_dataset_id(self):
        """Test getting data with dataset ID."""
        # Load two datasets
        dataset_id1 = "test_dataset_1"
        self.reader.load_zarr(self.zarr_path, dataset_id=dataset_id1)
        
        # Create a second zarr with different data
        zarr_path2 = os.path.join(self.temp_dir.name, 'test2.zarr')
        root = zarr.open_group(zarr_path2, mode='w')
        # Create X matrix with different dimensions
        root.create_dataset('X', data=np.random.rand(50, 30).astype('float32'))
        # Create obs with different cell names
        obs_group = root.create_group('obs')
        cell_ids2 = np.array([f'cell2_{i}' for i in range(50)])
        obs_group.create_dataset('_index', data=cell_ids2)
        
        dataset_id2 = "test_dataset_2"
        self.reader.load_zarr(zarr_path2, dataset_id=dataset_id2)
        
        # Test getting data from first dataset
        X1 = self.reader.get_X(dataset_id=dataset_id1)
        self.assertEqual(X1.shape, (100, 50))
        
        # Test getting data from second dataset
        X2 = self.reader.get_X(dataset_id=dataset_id2)
        self.assertEqual(X2.shape, (50, 30))
        
        # Test getting obs names from both datasets
        cells1 = self.reader.get_obs_names(dataset_id=dataset_id1)
        cells2 = self.reader.get_obs_names(dataset_id=dataset_id2)
        
        self.assertEqual(len(cells1), 100)
        self.assertEqual(len(cells2), 50)
        self.assertEqual(cells1[0], 'cell_0')
        self.assertEqual(cells2[0], 'cell2_0')

    def test_get_var_names(self):
        """Test getting variable names."""
        dataset_id = self.reader.open_zarr(self.zarr_path)
        var_names = self.reader.get_var_names(dataset_id=dataset_id)
        
        # Check that we get 50 gene names
        self.assertEqual(len(var_names), 50)
        self.assertEqual(var_names[0], 'gene_0')
        self.assertEqual(var_names[49], 'gene_49')

    def test_get_X(self):
        """Test getting X matrix."""
        dataset_id = self.reader.open_zarr(self.zarr_path)
        
        # Test getting the entire matrix
        X = self.reader.get_X(dataset_id=dataset_id)
        self.assertEqual(X.shape, (100, 50))
        
        # Test getting a subset of rows
        row_indices = [0, 1, 2]
        X_rows = self.reader.get_X(row_indices=row_indices, dataset_id=dataset_id)
        self.assertEqual(X_rows.shape, (3, 50))
        np.testing.assert_array_equal(X_rows, X[row_indices, :])
        
        # Test getting a subset of columns
        col_indices = [0, 1, 2]
        X_cols = self.reader.get_X(col_indices=col_indices, dataset_id=dataset_id)
        self.assertEqual(X_cols.shape, (100, 3))
        np.testing.assert_array_equal(X_cols, X[:, col_indices])
        
        # Test getting a subset of both rows and columns
        X_subset = self.reader.get_X(row_indices=row_indices, col_indices=col_indices, dataset_id=dataset_id)
        self.assertEqual(X_subset.shape, (3, 3))
        np.testing.assert_array_equal(X_subset, X[row_indices, :][:, col_indices])

    def test_get_layer(self):
        """Test getting layer data."""
        dataset_id = self.reader.open_zarr(self.zarr_path)
        
        # Test getting the entire dense layer
        raw = self.reader.get_layer('raw', dataset_id=dataset_id)
        self.assertEqual(raw.shape, (100, 50))
        
        # Test getting a subset of rows from dense layer
        row_indices = [0, 1, 2]
        raw_rows = self.reader.get_layer('raw', row_indices=row_indices, dataset_id=dataset_id)
        self.assertEqual(raw_rows.shape, (3, 50))
        
        # Test getting a subset of columns from dense layer
        col_indices = [0, 1, 2]
        raw_cols = self.reader.get_layer('raw', col_indices=col_indices, dataset_id=dataset_id)
        self.assertEqual(raw_cols.shape, (100, 3))
        
        # Test getting a subset of both rows and columns from dense layer
        raw_subset = self.reader.get_layer('raw', row_indices=row_indices, col_indices=col_indices, dataset_id=dataset_id)
        self.assertEqual(raw_subset.shape, (3, 3))
        
        # Test getting a non-existent layer
        nonexistent = self.reader.get_layer('nonexistent', dataset_id=dataset_id)
        self.assertEqual(len(nonexistent), 0)
        
    def test_sparse_matrix_csr(self):
        """Test getting CSR sparse matrix layer data."""
        dataset_id = self.reader.open_zarr(self.zarr_path)
        
        # Test getting the entire CSR sparse matrix
        csr_matrix = self.reader.get_layer('logged_counts', dataset_id=dataset_id)
        self.assertEqual(csr_matrix.shape, (100, 50))
        
        # Test getting a subset of rows from CSR sparse matrix
        row_indices = [0, 1, 2]
        csr_rows = self.reader.get_layer('logged_counts', row_indices=row_indices, dataset_id=dataset_id)
        self.assertEqual(csr_rows.shape, (3, 50))
        
        # Test getting a subset of columns from CSR sparse matrix
        col_indices = [0, 1, 2]
        csr_cols = self.reader.get_layer('logged_counts', col_indices=col_indices, dataset_id=dataset_id)
        self.assertEqual(csr_cols.shape, (100, 3))
        
        # Test getting a subset of both rows and columns from CSR sparse matrix
        csr_subset = self.reader.get_layer('logged_counts', row_indices=row_indices, col_indices=col_indices, dataset_id=dataset_id)
        self.assertEqual(csr_subset.shape, (3, 3))
        
        # Check format and attributes of the CSR sparse matrix
        root = self.reader._get_root(dataset_id)
        self.assertIn('layers', root)
        self.assertIn('logged_counts', root['layers'])
        self.assertEqual(root['layers']['logged_counts'].attrs['encoding-type'], 'csr_matrix')
        self.assertEqual(tuple(root['layers']['logged_counts'].attrs['shape']), (100, 50))
        
    def test_sparse_matrix_csc(self):
        """Test getting CSC sparse matrix layer data."""
        dataset_id = self.reader.open_zarr(self.zarr_path)
        
        # Test getting the entire CSC sparse matrix
        csc_matrix = self.reader.get_layer('csc_matrix', dataset_id=dataset_id)
        self.assertEqual(csc_matrix.shape, (100, 50))
        
        # Test getting a subset of rows from CSC sparse matrix
        row_indices = [0, 1, 2]
        csc_rows = self.reader.get_layer('csc_matrix', row_indices=row_indices, dataset_id=dataset_id)
        self.assertEqual(csc_rows.shape, (3, 50))
        
        # Test getting a subset of columns from CSC sparse matrix
        col_indices = [0, 1, 2]
        csc_cols = self.reader.get_layer('csc_matrix', col_indices=col_indices, dataset_id=dataset_id)
        self.assertEqual(csc_cols.shape, (100, 3))
        
        # Test getting a subset of both rows and columns from CSC sparse matrix
        csc_subset = self.reader.get_layer('csc_matrix', row_indices=row_indices, col_indices=col_indices, dataset_id=dataset_id)
        self.assertEqual(csc_subset.shape, (3, 3))
        
        # Check format and attributes of the CSC sparse matrix
        root = self.reader._get_root(dataset_id)
        self.assertIn('layers', root)
        self.assertIn('csc_matrix', root['layers'])
        self.assertEqual(root['layers']['csc_matrix'].attrs['encoding-type'], 'csc_matrix')
        self.assertEqual(tuple(root['layers']['csc_matrix'].attrs['shape']), (100, 50))
        
    def test_sparse_matrix_coo(self):
        """Test getting COO sparse matrix layer data."""
        dataset_id = self.reader.open_zarr(self.zarr_path)
        
        # Test getting the entire COO sparse matrix
        coo_matrix = self.reader.get_layer('coo_matrix', dataset_id=dataset_id)
        self.assertEqual(coo_matrix.shape, (100, 50))
        
        # Test getting a subset of rows from COO sparse matrix
        row_indices = [0, 1, 2]
        coo_rows = self.reader.get_layer('coo_matrix', row_indices=row_indices, dataset_id=dataset_id)
        self.assertEqual(coo_rows.shape, (3, 50))
        
        # Test getting a subset of columns from COO sparse matrix
        col_indices = [0, 1, 2]
        coo_cols = self.reader.get_layer('coo_matrix', col_indices=col_indices, dataset_id=dataset_id)
        self.assertEqual(coo_cols.shape, (100, 3))
        
        # Test getting a subset of both rows and columns from COO sparse matrix
        coo_subset = self.reader.get_layer('coo_matrix', row_indices=row_indices, col_indices=col_indices, dataset_id=dataset_id)
        self.assertEqual(coo_subset.shape, (3, 3))
        
        # Check format and attributes of the COO sparse matrix
        root = self.reader._get_root(dataset_id)
        self.assertIn('layers', root)
        self.assertIn('coo_matrix', root['layers'])
        self.assertEqual(root['layers']['coo_matrix'].attrs['encoding-type'], 'coo_matrix')
        self.assertEqual(tuple(root['layers']['coo_matrix'].attrs['shape']), (100, 50))

    def test_get_obs(self):
        """Test getting observation annotations."""
        dataset_id = self.reader.open_zarr(self.zarr_path)
        
        # Test getting all columns
        obs = self.reader.get_obs(dataset_id=dataset_id)
        self.assertIn('_index', obs)
        self.assertIn('cell_type', obs)
        self.assertEqual(len(obs['_index']), 100)
        
        # Test getting a specific column
        cell_types = self.reader.get_obs('cell_type', dataset_id=dataset_id)
        self.assertEqual(len(cell_types), 100)
        self.assertEqual(cell_types[0], 'type_A')
        self.assertEqual(cell_types[50], 'type_B')
        
        # Test getting a subset of rows
        indices = [0, 1, 2]
        cell_types_subset = self.reader.get_obs('cell_type', indices=indices, dataset_id=dataset_id)
        self.assertEqual(len(cell_types_subset), 3)
        
        # Test getting a non-existent column
        nonexistent = self.reader.get_obs('nonexistent', dataset_id=dataset_id)
        self.assertEqual(len(nonexistent), 0)

    def test_get_var(self):
        """Test getting variable annotations."""
        dataset_id = self.reader.open_zarr(self.zarr_path)
        
        # Test getting all columns
        var = self.reader.get_var(dataset_id=dataset_id)
        self.assertIn('_index', var)
        self.assertIn('gene_name', var)
        self.assertEqual(len(var['_index']), 50)
        
        # Test getting a specific column
        gene_names = self.reader.get_var('gene_name', dataset_id=dataset_id)
        self.assertEqual(len(gene_names), 50)
        self.assertEqual(gene_names[0], 'GENE_0')
        
        # Test getting a subset of rows
        indices = [0, 1, 2]
        gene_names_subset = self.reader.get_var('gene_name', indices=indices, dataset_id=dataset_id)
        self.assertEqual(len(gene_names_subset), 3)
        
        # Test getting a non-existent column
        nonexistent = self.reader.get_var('nonexistent', dataset_id=dataset_id)
        self.assertEqual(len(nonexistent), 0)

    def test_get_obsm(self):
        """Test getting obsm data."""
        dataset_id = self.reader.open_zarr(self.zarr_path)
        
        # Test getting a valid obsm key
        umap = self.reader.get_obsm('X_umap', dataset_id=dataset_id)
        self.assertEqual(umap.shape, (100, 2))
        
        # Test getting a subset of rows
        indices = [0, 1, 2]
        umap_subset = self.reader.get_obsm('X_umap', indices=indices, dataset_id=dataset_id)
        self.assertEqual(umap_subset.shape, (3, 2))
        
        # Test getting a non-existent key
        nonexistent = self.reader.get_obsm('nonexistent', dataset_id=dataset_id)
        self.assertEqual(len(nonexistent), 0)

    @patch('zarr.open_group')
    def test_with_url_store(self, mock_open_group):
        """Test the URL store functionality."""
        # Set up mock
        mock_group = MagicMock()
        mock_group.__getitem__.side_effect = lambda key: {
            'X': MagicMock(shape=(100, 50)),
            'obs': MagicMock(keys=lambda: ['_index', 'cell_type']),
            'var': MagicMock(keys=lambda: ['_index', 'gene_name']),
            'obsm': MagicMock(keys=lambda: ['X_umap']),
            'layers': MagicMock(keys=lambda: ['raw']),
        }.get(key, MagicMock())
        mock_open_group.return_value = mock_group
        
        # Call the method
        result = self.reader.open_zarr_url('http://example.com/test.zarr')
        
        # Check result
        self.assertTrue(result)
        mock_open_group.assert_called_once_with('http://example.com/test.zarr', mode='r')
        
    def test_load_chunked_data(self):
        """Test loading chunked data with optimized strategy."""
        dataset_id = self.reader.open_zarr(self.zarr_path)
        
        # Get the root from the correct dataset
        root = self.reader._get_root(dataset_id)
        
        # Mock the chunks attribute
        original_get_item = root.__getitem__
        
        def mocked_get_item(key):
            array = original_get_item(key)
            if key == 'X':
                array.chunks = (20, 10)  # Add chunks attribute
            return array
            
        root.__getitem__ = mocked_get_item
        
        # Test chunked loading with row selection
        row_indices = list(range(30))
        chunked_data = self.reader._load_chunked_data('X', row_indices=row_indices, dataset_id=dataset_id)
        self.assertEqual(chunked_data.shape, (30, 50))
        
        # Test chunked loading with column selection
        col_indices = list(range(25))
        chunked_data = self.reader._load_chunked_data('X', col_indices=col_indices, dataset_id=dataset_id)
        self.assertEqual(chunked_data.shape, (100, 25))
        
        # Test chunked loading with both row and column selection
        chunked_data = self.reader._load_chunked_data('X', row_indices=row_indices, col_indices=col_indices, dataset_id=dataset_id)
        self.assertEqual(chunked_data.shape, (30, 25))
        
        # Test with no chunks info
        root.__getitem__ = original_get_item
        regular_data = self.reader._load_chunked_data('X', row_indices=row_indices, dataset_id=dataset_id)
        self.assertEqual(regular_data.shape, (30, 50))
        
    def test_downsample_array(self):
        """Test downsampling large arrays."""
        dataset_id = self.reader.open_zarr(self.zarr_path)
        
        # Test downsampling with default parameters
        downsampled = self.reader._downsample_array('X', max_size=20, dataset_id=dataset_id)
        self.assertLessEqual(downsampled.shape[0], 100)
        self.assertLessEqual(downsampled.shape[1], 50)
        
        # Test downsampling with small max_size
        downsampled = self.reader._downsample_array('X', max_size=5, dataset_id=dataset_id)
        self.assertLessEqual(downsampled.shape[0], 100)
        self.assertLessEqual(downsampled.shape[1], 50)
        self.assertGreaterEqual(downsampled.shape[0], 1)
        self.assertGreaterEqual(downsampled.shape[1], 1)
        
    def test_load_progressively(self):
        """Test progressive loading with callbacks."""
        dataset_id = self.reader.open_zarr(self.zarr_path)
        
        # Create a mock callback
        callback_calls = []
        def mock_callback(chunk, progress):
            callback_calls.append((chunk.shape, progress))
        
        # Test progressive loading
        result = self.reader.load_progressively('X', chunk_size=20, callback=mock_callback, dataset_id=dataset_id)
        
        # Check result
        self.assertEqual(result.shape, (100, 50))
        
        # Check that callback was called with increasing progress values
        self.assertGreater(len(callback_calls), 0)
        progress_values = [call[1] for call in callback_calls]
        self.assertTrue(all(progress_values[i] <= progress_values[i+1] for i in range(len(progress_values)-1)))
        self.assertAlmostEqual(progress_values[-1], 1.0)
        
    def test_progressive_load_with_dataset_id(self):
        """Test progressive loading with dataset ID."""
        # Load two datasets
        dataset_id1 = "test_dataset_1"
        self.reader.load_zarr(self.zarr_path, dataset_id=dataset_id1)
        
        # Create a second zarr with different data
        zarr_path2 = os.path.join(self.temp_dir.name, 'test2.zarr')
        root = zarr.open_group(zarr_path2, mode='w')
        # Create X matrix with different dimensions
        root.create_dataset('X', data=np.random.rand(50, 30).astype('float32'))
        
        dataset_id2 = "test_dataset_2"
        self.reader.load_zarr(zarr_path2, dataset_id=dataset_id2)
        
        # Create mock callbacks for both datasets
        callback_calls1 = []
        def mock_callback1(chunk, progress):
            callback_calls1.append((chunk.shape, progress))
            
        callback_calls2 = []
        def mock_callback2(chunk, progress):
            callback_calls2.append((chunk.shape, progress))
        
        # Test progressive loading from first dataset
        result1 = self.reader.load_progressively('X', chunk_size=20, callback=mock_callback1, dataset_id=dataset_id1)
        
        # Check result from first dataset
        self.assertEqual(result1.shape, (100, 50))
        
        # Test progressive loading from second dataset
        result2 = self.reader.load_progressively('X', chunk_size=20, callback=mock_callback2, dataset_id=dataset_id2)
        
        # Check result from second dataset
        self.assertEqual(result2.shape, (50, 30))
        
        # Verify callbacks were called for both datasets
        self.assertGreater(len(callback_calls1), 0)
        self.assertGreater(len(callback_calls2), 0)
        
    def test_get_obsp(self):
        """Test getting observation-observation matrices (obsp)."""
        self.reader.open_zarr(self.zarr_path)
        
        # Test getting a valid obsp key
        connectivities = self.reader.get_obsp('connectivities')
        self.assertEqual(connectivities.shape, (100, 100))
        
        # Test getting a subset using indices
        indices = [0, 1, 2]
        conn_subset = self.reader.get_obsp('connectivities', indices=indices)
        self.assertEqual(conn_subset.shape, (3, 3))
        
        # Verify diagonal values of connectivities (should be 1.0)
        np.testing.assert_almost_equal(np.diag(connectivities), np.ones(100))
        
        # Test getting distances matrix
        distances = self.reader.get_obsp('distances')
        self.assertEqual(distances.shape, (100, 100))
        
        # Verify diagonal values of distances (should be 0.0)
        np.testing.assert_almost_equal(np.diag(distances), np.zeros(100))
        
        # Test getting a non-existent key
        nonexistent = self.reader.get_obsp('nonexistent')
        self.assertEqual(len(nonexistent), 0)
        
    def test_obsp_with_dataset_id(self):
        """Test getting obsp matrices with dataset ID."""
        # Load two datasets
        dataset_id1 = "test_dataset_1"
        self.reader.load_zarr(self.zarr_path, dataset_id=dataset_id1)
        
        # Create a second zarr with different data
        zarr_path2 = os.path.join(self.temp_dir.name, 'test2.zarr')
        root = zarr.open_group(zarr_path2, mode='w')
        
        # Create smaller obsp matrices for second dataset
        obsp_group = root.create_group('obsp')
        # Create a connectivities matrix with different dimensions
        connectivities2 = np.random.rand(40, 40).astype('float32')
        np.fill_diagonal(connectivities2, 2.0)  # Use different diagonal values to test
        obsp_group.create_dataset('connectivities', data=connectivities2)
        
        dataset_id2 = "test_dataset_2"
        self.reader.load_zarr(zarr_path2, dataset_id=dataset_id2)
        
        # Get obsp from first dataset
        conn1 = self.reader.get_obsp('connectivities', dataset_id=dataset_id1)
        self.assertEqual(conn1.shape, (100, 100))
        np.testing.assert_almost_equal(np.diag(conn1), np.ones(100))
        
        # Get obsp from second dataset
        conn2 = self.reader.get_obsp('connectivities', dataset_id=dataset_id2)
        self.assertEqual(conn2.shape, (40, 40))
        np.testing.assert_almost_equal(np.diag(conn2), 2.0 * np.ones(40))
        
    def test_get_varp(self):
        """Test getting variable-variable matrices (varp)."""
        self.reader.open_zarr(self.zarr_path)
        
        # Test getting a valid varp key
        correlation = self.reader.get_varp('correlation')
        self.assertEqual(correlation.shape, (50, 50))
        
        # Test getting a subset using indices
        indices = [0, 1, 2]
        corr_subset = self.reader.get_varp('correlation', indices=indices)
        self.assertEqual(corr_subset.shape, (3, 3))
        
        # Verify diagonal values of correlation (should be 1.0)
        np.testing.assert_almost_equal(np.diag(correlation), np.ones(50))
        
        # Test getting a non-existent key
        nonexistent = self.reader.get_varp('nonexistent')
        self.assertEqual(len(nonexistent), 0)
        
    def test_varp_with_dataset_id(self):
        """Test getting varp matrices with dataset ID."""
        # Load two datasets
        dataset_id1 = "test_dataset_1"
        self.reader.load_zarr(self.zarr_path, dataset_id=dataset_id1)
        
        # Create a second zarr with different data
        zarr_path2 = os.path.join(self.temp_dir.name, 'test2.zarr')
        root = zarr.open_group(zarr_path2, mode='w')
        
        # Create varp matrices for second dataset
        varp_group = root.create_group('varp')
        # Create a correlation matrix with different dimensions
        correlation2 = np.random.rand(30, 30).astype('float32')
        np.fill_diagonal(correlation2, 0.5)  # Use different diagonal values to test
        varp_group.create_dataset('correlation', data=correlation2)
        
        dataset_id2 = "test_dataset_2"
        self.reader.load_zarr(zarr_path2, dataset_id=dataset_id2)
        
        # Get varp from first dataset
        corr1 = self.reader.get_varp('correlation', dataset_id=dataset_id1)
        self.assertEqual(corr1.shape, (50, 50))
        np.testing.assert_almost_equal(np.diag(corr1), np.ones(50))
        
        # Get varp from second dataset
        corr2 = self.reader.get_varp('correlation', dataset_id=dataset_id2)
        self.assertEqual(corr2.shape, (30, 30))
        np.testing.assert_almost_equal(np.diag(corr2), 0.5 * np.ones(30))
        
    def test_open_dataset_by_path(self):
        """Test opening a dataset in stateless mode."""
        # Test opening a dataset without storing any state
        root, metadata = self.reader.open_dataset_by_path(self.zarr_path)
        
        # Verify we got the root object
        self.assertIsNotNone(root)
        
        # Verify we got metadata
        self.assertIsNotNone(metadata)
        self.assertEqual(metadata['shape'], (100, 50))
        self.assertTrue(metadata['has_obs'])
        self.assertTrue(metadata['has_var'])
        self.assertTrue(metadata['has_obsm'])
        self.assertTrue(metadata['has_layers'])
        
        # Verify the dataset isn't stored in the reader's state
        self.assertEqual(len(self.reader.dataset_stores), 0)
        self.assertIsNone(self.reader.active_dataset_id)
        
        # Test we can use the root to access data directly
        X = root['X'][:]
        self.assertEqual(X.shape, (100, 50))
        
        obs = root['obs']['cell_type'][:]
        self.assertEqual(len(obs), 100)
        self.assertEqual(obs[0], 'type_A')
        
        # Test non-existent path
        with self.assertRaises(Exception):
            self.reader.open_dataset_by_path('/nonexistent/path')
            
    def test_stateless_multi_access(self):
        """Test stateless access to multiple datasets without interference."""
        # Create a second zarr file with different data
        zarr_path2 = os.path.join(self.temp_dir.name, 'test2.zarr')
        root2 = zarr.open_group(zarr_path2, mode='w')
        
        # Create X matrix with different dimensions
        X2 = np.random.rand(50, 30).astype('float32')
        root2.create_dataset('X', data=X2)
        
        # Create obs with different values
        obs_group2 = root2.create_group('obs')
        cell_ids2 = np.array([f'cell2_{i}' for i in range(50)])
        obs_group2.create_dataset('_index', data=cell_ids2)
        cell_types2 = np.array(['type_C'] * 25 + ['type_D'] * 25)
        obs_group2.create_dataset('cell_type', data=cell_types2)
        
        # Access first dataset
        root1, metadata1 = self.reader.open_dataset_by_path(self.zarr_path)
        
        # Access second dataset
        root2, metadata2 = self.reader.open_dataset_by_path(zarr_path2)
        
        # Verify we can still access both datasets correctly
        X1 = root1['X'][:]
        X2 = root2['X'][:]
        
        self.assertEqual(X1.shape, (100, 50))
        self.assertEqual(X2.shape, (50, 30))
        
        # Check metadata
        self.assertEqual(metadata1['shape'], (100, 50))
        self.assertEqual(metadata2['shape'], (50, 30))
        
        # Check observation data
        obs1 = root1['obs']['cell_type'][:]
        obs2 = root2['obs']['cell_type'][:]
        
        self.assertEqual(len(obs1), 100)
        self.assertEqual(len(obs2), 50)
        self.assertEqual(obs1[0], 'type_A')
        self.assertEqual(obs2[0], 'type_C')
        
        # Verify the reader doesn't store any state
        self.assertEqual(len(self.reader.dataset_stores), 0)
        self.assertIsNone(self.reader.active_dataset_id)

    def test_get_dataset_shape_helper(self):
        """Test the _get_dataset_shape helper method."""
        # Load a dataset
        dataset_id = self.reader.open_zarr(self.zarr_path)
        root = self.reader._get_root(dataset_id)
        
        # Test shape discovery from X directly
        shape = self.reader._get_dataset_shape(root)
        self.assertEqual(shape, (100, 50))
        
        # Create a temporary directory for a new zarr file
        with tempfile.TemporaryDirectory() as temp_dir:
            zarr_path = os.path.join(temp_dir, 'shape_test.zarr')
            
            # Test shape discovery from X attributes (shape in attributes)
            test_root = zarr.open_group(zarr_path, mode='w')
            # Create X as a group with shape attribute instead of direct array
            x_group = test_root.create_group('X')
            x_group.attrs['shape'] = [200, 100]
            
            shape = self.reader._get_dataset_shape(test_root)
            self.assertEqual(shape, (200, 100))
            
            # Test shape inference from obs and var lengths
            # Re-open the file (overwrite by default in zarr library)
            test_root = zarr.open_group(zarr_path, mode='w')
            obs_group = test_root.create_group('obs')
            var_group = test_root.create_group('var')
            
            # Create _index arrays with known lengths
            obs_index = np.array([f'cell_{i}' for i in range(150)])
            var_index = np.array([f'gene_{i}' for i in range(75)])
            
            obs_group.create_dataset('_index', data=obs_index)
            var_group.create_dataset('_index', data=var_index)
            
            # No X, should infer from obs and var lengths
            shape = self.reader._get_dataset_shape(test_root)
            self.assertEqual(shape, (150, 75))
            
            # Test shape discovery from layers
            # Re-open the file (overwrite by default in zarr library)
            test_root = zarr.open_group(zarr_path, mode='w')
            layers_group = test_root.create_group('layers')
            
            # Create a layer with shape
            raw = np.random.rand(180, 90).astype('float32')
            layers_group.create_dataset('raw', data=raw)
            
            # Should discover from layer shape
            shape = self.reader._get_dataset_shape(test_root)
            self.assertEqual(shape, (180, 90))
            
            # Test shape discovery from sparse matrix in layers
            # Re-open the file (overwrite by default in zarr library)
            test_root = zarr.open_group(zarr_path, mode='w')
            layers_group = test_root.create_group('layers')
            sparse_group = layers_group.create_group('sparse')
            
            # Set shape attribute for sparse matrix
            sparse_group.attrs['shape'] = [300, 150]
            
            # Should discover from layer attributes
            shape = self.reader._get_dataset_shape(test_root)
            self.assertEqual(shape, (300, 150))
            
    def test_get_matrix_info_helper(self):
        """Test the _get_matrix_info helper method."""
        dataset_id = self.reader.open_zarr(self.zarr_path)
        root = self.reader._get_root(dataset_id)
        
        # Test getting info for dense array
        dense_matrix = root['X']
        info = self.reader._get_matrix_info(dense_matrix)
        self.assertEqual(info['shape'], (100, 50))
        self.assertIn('dtype', info)
        
        # Test getting info for sparse matrix (CSR)
        csr_matrix = root['layers']['logged_counts']
        info = self.reader._get_matrix_info(csr_matrix)
        self.assertEqual(tuple(info['shape']), (100, 50))
        self.assertEqual(info['encoding-type'], 'csr_matrix')
        self.assertEqual(info['encoding-version'], '0.1.0')
        
        # Test getting info for sparse matrix (CSC)
        csc_matrix = root['layers']['csc_matrix']
        info = self.reader._get_matrix_info(csc_matrix)
        self.assertEqual(tuple(info['shape']), (100, 50))
        self.assertEqual(info['encoding-type'], 'csc_matrix')
        self.assertEqual(info['encoding-version'], '0.1.0')
        
        # Test getting info for sparse matrix (COO)
        coo_matrix = root['layers']['coo_matrix']
        info = self.reader._get_matrix_info(coo_matrix)
        self.assertEqual(tuple(info['shape']), (100, 50))
        self.assertEqual(info['encoding-type'], 'coo_matrix')
        self.assertEqual(info['encoding-version'], '0.1.0')
        
    def test_dataframe_detection_and_access(self):
        """Test detection and access of dataframe columns."""
        dataset_id = self.reader.open_zarr(self.zarr_path)
        
        # Test is_dataframe helper method
        root = self.reader._get_root(dataset_id)
        self.assertTrue(self.reader._is_dataframe(root['obsm']['cell_markers']))
        self.assertTrue(self.reader._is_dataframe(root['varm']['differential_expression']))
        self.assertFalse(self.reader._is_dataframe(root['obsm']['X_umap']))
        
        # Test get_dataframe_columns helper method
        obsm_columns = self.reader._get_dataframe_columns(root['obsm']['cell_markers'])
        self.assertEqual(len(obsm_columns), 3)
        self.assertIn('CD4', obsm_columns)
        self.assertIn('CD8', obsm_columns)
        self.assertIn('CD19', obsm_columns)
        
        varm_columns = self.reader._get_dataframe_columns(root['varm']['differential_expression'])
        self.assertEqual(len(varm_columns), 3)
        self.assertIn('cell type A', varm_columns)
        self.assertIn('cell type B', varm_columns)
        self.assertIn('cell type C', varm_columns)
        
        # Test public API methods for getting dataframe columns
        obsm_cols = self.reader.get_obsm_dataframe_columns('cell_markers', dataset_id=dataset_id)
        self.assertEqual(len(obsm_cols), 3)
        self.assertIn('CD4', obsm_cols)
        
        varm_cols = self.reader.get_varm_dataframe_columns('differential_expression', dataset_id=dataset_id)
        self.assertEqual(len(varm_cols), 3)
        self.assertIn('cell type B', varm_cols)
        
        # Test getting specific dataframe column
        # For obsm
        obsm_col_data = self.reader.get_obsm('cell_markers', column_name='CD4', dataset_id=dataset_id)
        self.assertEqual(obsm_col_data.shape, (100,))  # Should be a 1D array of length 100
        
        # For varm
        varm_col_data = self.reader.get_varm('differential_expression', column_name='cell type A', dataset_id=dataset_id)
        self.assertEqual(varm_col_data.shape, (50,))  # Should be a 1D array of length 50
        
        # Test path-based access
        obsm_data_path = self.reader.get_data_by_path('obsm/cell_markers/CD8', dataset_id=dataset_id)
        self.assertEqual(obsm_data_path.shape, (100,))
        
        varm_data_path = self.reader.get_data_by_path('varm/differential_expression/cell type C', dataset_id=dataset_id)
        self.assertEqual(varm_data_path.shape, (50,))
        
        # Test with indices
        indices = [0, 1, 2]
        obsm_subset = self.reader.get_obsm('cell_markers', column_name='CD4', indices=indices, dataset_id=dataset_id)
        self.assertEqual(obsm_subset.shape, (3,))
        
        varm_subset = self.reader.get_varm('differential_expression', column_name='cell type A', 
                                        indices=indices, dataset_id=dataset_id)
        self.assertEqual(varm_subset.shape, (3,))
        
    def test_matrix_info_extraction(self):
        """Test that matrix info extraction correctly identifies the sparse format and components."""
        dataset_id = self.reader.open_zarr(self.zarr_path)
        
        # Get metadata for the dataset
        metadata = self.reader.get_metadata(dataset_id)
        
        # Check that layers section includes all three sparse matrix types
        self.assertIn('layers', metadata)
        
        # Depending on how layers are represented in metadata, assert they are present
        if isinstance(metadata['layers'], list):
            self.assertIn('logged_counts', metadata['layers'])
            self.assertIn('csc_matrix', metadata['layers'])
            self.assertIn('coo_matrix', metadata['layers'])
        elif isinstance(metadata['layers'], dict) and 'keys' in metadata['layers']:
            self.assertIn('logged_counts', metadata['layers']['keys'])
            self.assertIn('csc_matrix', metadata['layers']['keys'])
            self.assertIn('coo_matrix', metadata['layers']['keys'])
            
        # Create a test using open_dataset_by_path for stateless access
        root, metadata = self.reader.open_dataset_by_path(self.zarr_path)
        
        # Check metadata includes sparse matrices in layers
        self.assertTrue(metadata['has_layers'])
        if isinstance(metadata['layers'], list):
            self.assertIn('logged_counts', metadata['layers'])
            self.assertIn('csc_matrix', metadata['layers'])
            self.assertIn('coo_matrix', metadata['layers'])
        elif isinstance(metadata['layers'], dict) and 'keys' in metadata['layers']:
            self.assertIn('logged_counts', metadata['layers']['keys'])
            self.assertIn('csc_matrix', metadata['layers']['keys'])
            self.assertIn('coo_matrix', metadata['layers']['keys'])
            
        # Check that matrix info is properly extracted for each type
        self.assertEqual(root['layers']['logged_counts'].attrs['encoding-type'], 'csr_matrix')
        self.assertEqual(root['layers']['csc_matrix'].attrs['encoding-type'], 'csc_matrix')
        self.assertEqual(root['layers']['coo_matrix'].attrs['encoding-type'], 'coo_matrix')
        
        # Check that shape information is correctly extracted
        self.assertEqual(tuple(root['layers']['logged_counts'].attrs['shape']), (100, 50))
        self.assertEqual(tuple(root['layers']['csc_matrix'].attrs['shape']), (100, 50))
        self.assertEqual(tuple(root['layers']['coo_matrix'].attrs['shape']), (100, 50))

if __name__ == '__main__':
    unittest.main()