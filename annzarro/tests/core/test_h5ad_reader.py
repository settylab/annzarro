import unittest
import tempfile
import numpy as np
import pandas as pd
import h5py
import scipy.sparse as sp

from annzarro.core.h5ad_reader import h5adReader

class TestH5ADReader(unittest.TestCase):
    """Test cases for H5ADReader."""

    def setUp(self):
        """Set up the test environment."""
        self.reader = h5adReader()  # replace with your reader class

        # Create a temporary file for the h5ad
        self.temp_file = tempfile.NamedTemporaryFile(suffix=".h5ad", delete=False)
        self.h5ad_path = self.temp_file.name

        # Create a test h5ad
        self.create_test_h5ad()

    def tearDown(self):
        """Clean up the test environment."""
        self.temp_file.close()
        try:
            import os
            os.unlink(self.h5ad_path)
        except Exception:
            pass

    def create_test_h5ad(self):
        n_cells = 100
        n_genes = 50

        with h5py.File(self.h5ad_path, "w") as f:
            # X matrix
            f.create_dataset('X', data=np.random.rand(n_cells, n_genes).astype('float32'))

            # obs
            obs_grp = f.create_group('obs')
            cell_ids = np.array([f'cell_{i}' for i in range(n_cells)], dtype='S')
            obs_grp.create_dataset('_index', data=cell_ids)
            cell_types = np.array(['type_A']*50 + ['type_B']*50, dtype='S')
            obs_grp.create_dataset('cell_type', data=cell_types)

            # var
            var_grp = f.create_group('var')
            gene_ids = np.array([f'gene_{i}' for i in range(n_genes)], dtype='S')
            var_grp.create_dataset('_index', data=gene_ids)
            gene_names = np.array([f'GENE_{i}' for i in range(n_genes)], dtype='S')
            var_grp.create_dataset('gene_name', data=gene_names)

            # obsm embeddings
            obsm_grp = f.create_group('obsm')
            obsm_grp.create_dataset('X_umap', data=np.random.rand(n_cells, 2).astype('float32'))

            # obsm dataframe-encoded
            df_obsm_grp = obsm_grp.create_group('cell_markers')
            df_obsm_grp.attrs['encoding-type'] = 'dataframe'
            df_obsm_grp.attrs['encoding-version'] = '0.2.0'
            df_obsm_grp.attrs['_index'] = '_index'
            df_obsm_grp.attrs['column-order'] = ['CD4', 'CD8', 'CD19']

            # index
            idx_grp = df_obsm_grp.create_group('_index')
            idx_grp.attrs['encoding-type'] = 'string-array'
            idx_grp.create_dataset('0', data=cell_ids)

            # columns
            for col_name in ['CD4', 'CD8', 'CD19']:
                col_grp = df_obsm_grp.create_group(col_name)
                col_grp.attrs['encoding-type'] = 'array'
                col_grp.create_dataset('0', data=np.random.rand(n_cells).astype('float32'))

            # varm
            varm_grp = f.create_group('varm')
            varm_grp.create_dataset('PCs', data=np.random.rand(n_genes, 10).astype('float32'))

            # dataframe-encoded varm
            df_varm_grp = varm_grp.create_group('differential_expression')
            df_varm_grp.attrs['encoding-type'] = 'dataframe'
            df_varm_grp.attrs['encoding-version'] = '0.2.0'
            df_varm_grp.attrs['_index'] = '_index'
            df_varm_grp.attrs['column-order'] = ['cell type A', 'cell type B', 'cell type C']

            # index
            idx_grp = df_varm_grp.create_group('_index')
            idx_grp.attrs['encoding-type'] = 'string-array'
            idx_grp.create_dataset('0', data=gene_ids)

            # columns
            for col_name in ['cell type A', 'cell type B', 'cell type C']:
                col_grp = df_varm_grp.create_group(col_name)
                col_grp.attrs['encoding-type'] = 'array'
                col_grp.create_dataset('0', data=np.random.rand(n_genes).astype('float32'))

            # obsp
            obsp_grp = f.create_group('obsp')
            connectivities = np.random.rand(n_cells, n_cells).astype('float32')
            np.fill_diagonal(connectivities, 1.0)
            obsp_grp.create_dataset('connectivities', data=connectivities)
            distances = np.random.rand(n_cells, n_cells).astype('float32')
            np.fill_diagonal(distances, 0.0)
            obsp_grp.create_dataset('distances', data=distances)

            # varp
            varp_grp = f.create_group('varp')
            correlation = np.random.rand(n_genes, n_genes).astype('float32')
            np.fill_diagonal(correlation, 1.0)
            varp_grp.create_dataset('correlation', data=correlation)

            # layers
            layers_grp = f.create_group('layers')
            layers_grp.create_dataset('raw', data=np.random.rand(n_cells, n_genes).astype('float32'))

            # CSR sparse layer
            csr_grp = layers_grp.create_group('logged_counts')
            n_nonzero = int(n_cells * n_genes * 0.1)
            data = np.random.rand(n_nonzero).astype('float32')
            indices = np.random.randint(0, n_genes, size=n_nonzero)
            indptr = np.zeros(n_cells+1, dtype=np.int32)
            nnz_per_row = n_nonzero // n_cells
            for i in range(1, n_cells+1):
                indptr[i] = indptr[i-1] + nnz_per_row
            csr_grp.create_dataset('data', data=data)
            csr_grp.create_dataset('indices', data=indices)
            csr_grp.create_dataset('indptr', data=indptr)
            csr_grp.attrs['encoding-type'] = 'csr_matrix'
            csr_grp.attrs['encoding-version'] = '0.1.0'
            csr_grp.attrs['shape'] = [n_cells, n_genes]

            # uns (unstructured annotations)
            uns_grp = f.create_group('uns')

            # Add various types of unstructured data
            # 1. String array dataset
            uns_grp.create_dataset('description', data=np.array([b'Test dataset for unit testing']))

            # 2. Numeric array
            uns_grp.create_dataset('analysis_params', data=np.array([0.1, 0.5, 1.0]))

            # 3. Nested group with datasets
            analysis_grp = uns_grp.create_group('analysis')
            analysis_grp.create_dataset('explained_variance', data=np.random.rand(10).astype('float32'))
            analysis_grp.create_dataset('method', data=np.array([b'pca']))

    def test_get_metadata(self):
        metadata = self.reader.get_metadata(dataset_path = self.h5ad_path)

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
        self.assertEqual(len(df_columns), 4)
        self.assertIn('CD4', df_columns)
        self.assertIn('CD8', df_columns)
        self.assertIn('CD19', df_columns)
        self.assertIn('_index', df_columns)
        
        # Check for dataframe metadata in varm
        self.assertIn('varm_dataframes', metadata)
        self.assertIn('differential_expression', metadata['varm_dataframes'])
        df_columns = metadata['varm_dataframes']['differential_expression']['columns']
        self.assertEqual(len(df_columns), 4)
        self.assertIn('cell type A', df_columns)
        self.assertIn('cell type B', df_columns)
        self.assertIn('cell type C', df_columns)
        self.assertIn('_index', df_columns)
        
        # Verify encoding type and version are included
        self.assertEqual(metadata['obsm_dataframes']['cell_markers']['encoding_type'], 'dataframe')
        self.assertEqual(metadata['obsm_dataframes']['cell_markers']['encoding_version'], '0.2.0')
        self.assertEqual(metadata['varm_dataframes']['differential_expression']['encoding_type'], 'dataframe')
        self.assertEqual(metadata['varm_dataframes']['differential_expression']['encoding_version'], '0.2.0')
    
    def test_get_obs(self):
        """Test getting observation annotations."""
        
        # Test getting all columns
        obs = self.reader.get_obs_var(dataset_path=self.h5ad_path, entity = "cells")
        self.assertIn('_index', obs['data'])
        self.assertIn('cell_type', obs['data'])
        self.assertEqual(len(obs['data']['_index']), 100)
        
        # Test getting a specific column
        cols = ['cell_type']
        cell_types_dict = self.reader.get_obs_var(column_names = cols, entity = "cells", dataset_path=self.h5ad_path)
        self.assertIn('cell_type', cell_types_dict['data'])
        cell_types = cell_types_dict['data']['cell_type']
        self.assertEqual(len(cell_types), 100)
        self.assertEqual(cell_types[0], 'type_A')
        self.assertEqual(cell_types[50], 'type_B')
        
        # Test getting a subset of rows
        indices = [0, 1, 2]
        cell_types_subset_dict = self.reader.get_obs_var(column_names = cols, entity = "cells", indices=indices, dataset_path=self.h5ad_path)
        self.assertIn('cell_type', cell_types_subset_dict['data'])
        self.assertEqual(len(cell_types_subset_dict['data']['cell_type']), 3)
        
        # Test getting a non-existent column
        cols_not_exist = ['nonexistent']
        nonexistent = self.reader.get_obs_var(column_names = cols_not_exist, entity = "cells", dataset_path=self.h5ad_path)
        self.assertIn("data", nonexistent)
        self.assertEqual(len(nonexistent["data"]), 0)

    def test_get_var(self):
        """Test getting variable annotations."""
        
        # Test getting all columns
        var = self.reader.get_obs_var(dataset_path=self.h5ad_path, entity = "genes")
        self.assertIn('_index', var['data'])
        self.assertIn('gene_name', var['data'])
        self.assertEqual(len(var['data']['_index']), 50)
        
        # Test getting a specific column
        cols = ['gene_name']
        gene_names_dict = self.reader.get_obs_var(column_names= cols, entity = "genes", dataset_path=self.h5ad_path)
        self.assertIn('gene_name', gene_names_dict['data'])
        gene_names = gene_names_dict['data']['gene_name']
        self.assertEqual(len(gene_names), 50)
        self.assertEqual(gene_names[0], 'GENE_0')
        
        # Test getting a subset of rows
        indices = [0, 1, 2]
        gene_names_subset_dict = self.reader.get_obs_var(column_names = cols, entity = "genes", indices=indices, dataset_path=self.h5ad_path)
        self.assertIn('gene_name', gene_names_subset_dict['data'])
        self.assertEqual(len(gene_names_subset_dict['data']['gene_name']), 3)
        
        # Test getting a non-existent column
        cols_not_exist = ['nonexistent']
        nonexistent = self.reader.get_obs_var(column_names = cols_not_exist, entity = "genes", dataset_path=self.h5ad_path)
        self.assertIn("data", nonexistent)
        self.assertEqual(len(nonexistent["data"]), 0)
    
    def test_get_cell_names(self):
        obs_names = self.reader.get_cell_gene_names(dataset_path=self.h5ad_path, entity= "cells")
        
        # Check that we get 100 cell names
        self.assertEqual(len(obs_names), 100)
        self.assertEqual(obs_names[0], 'cell_0')
        self.assertEqual(obs_names[99], 'cell_99')
        #Check random elements
        self.assertEqual(obs_names[21], 'cell_21')
        self.assertEqual(obs_names[48], 'cell_48')
        self.assertEqual(obs_names[67], 'cell_67')
    
    def test_get_gene_names(self):
        var_names = self.reader.get_cell_gene_names(dataset_path=self.h5ad_path, entity = "genes")

        # Check that we get 50 gene names
        self.assertEqual(len(var_names), 50)
        self.assertEqual(var_names[0], 'gene_0')
        self.assertEqual(var_names[49], 'gene_49')
        #Check random elements
        self.assertEqual(var_names[8], 'gene_8')
        self.assertEqual(var_names[23], 'gene_23')
        self.assertEqual(var_names[37], 'gene_37')

    def test_get_obsm(self):
        """Test getting observation multi-dimensional annotations."""

        # Test getting a regular 2D array (X_umap)
        umap = self.reader.get_obsm_varm(entity="cells", key="X_umap", dataset_path=self.h5ad_path)
        self.assertEqual(umap.shape, (100, 2))
        self.assertEqual(umap.dtype, np.float32)

        # Test getting a subset of rows for X_umap
        indices = [0, 1, 2]
        umap_subset = self.reader.get_obsm_varm(entity="cells", key="X_umap", dataset_path=self.h5ad_path, indices=indices)
        self.assertEqual(umap_subset.shape, (3, 2))

        # Test getting a subset of columns for X_umap: n x 1, as the zarr
        # reader answers (column_name, below, is the 1-D form)
        col_indices = [0]
        umap_col_subset = self.reader.get_obsm_varm(entity="cells", key="X_umap", dataset_path=self.h5ad_path, col_indices=col_indices)
        self.assertEqual(umap_col_subset.shape, (100, 1))
        umap_by_name = self.reader.get_obsm_varm(entity="cells", key="X_umap", dataset_path=self.h5ad_path, column_name="0")
        np.testing.assert_array_equal(umap_by_name, umap[:, 0])

        # Test getting both row and column subsets
        umap_both_subset = self.reader.get_obsm_varm(entity="cells", key="X_umap", dataset_path=self.h5ad_path,
                                                      indices=indices, col_indices=col_indices)
        self.assertEqual(umap_both_subset.shape, (3, 1))

        # Test getting a dataframe-encoded obsm (cell_markers)
        cd4_column = self.reader.get_obsm_varm(entity="cells", key="cell_markers", dataset_path=self.h5ad_path,
                                                column_name="CD4")
        self.assertEqual(len(cd4_column), 100)
        self.assertEqual(cd4_column.dtype, np.float32)

        # Test getting a specific column with row indices for dataframe
        cd8_subset = self.reader.get_obsm_varm(entity="cells", key="cell_markers", dataset_path=self.h5ad_path,
                                                column_name="CD8", indices=[0, 1, 2])
        self.assertEqual(len(cd8_subset), 3)

        # Test getting a non-existent key
        nonexistent = self.reader.get_obsm_varm(entity="cells", key="nonexistent", dataset_path=self.h5ad_path)
        self.assertEqual(len(nonexistent), 0)

        # Test getting a non-existent column from dataframe
        nonexistent_col = self.reader.get_obsm_varm(entity="cells", key="cell_markers", dataset_path=self.h5ad_path,
                                                     column_name="nonexistent")
        # Should return empty array if column doesn't exist
        self.assertTrue(len(nonexistent_col) == 0 or nonexistent_col is not None)

    def test_get_varm(self):
        """Test getting variable multi-dimensional annotations."""

        # Test getting a regular 2D array (PCs)
        pcs = self.reader.get_obsm_varm(entity="genes", key="PCs", dataset_path=self.h5ad_path)
        self.assertEqual(pcs.shape, (50, 10))
        self.assertEqual(pcs.dtype, np.float32)

        # Test getting a subset of rows for PCs
        indices = [0, 1, 2]
        pcs_subset = self.reader.get_obsm_varm(entity="genes", key="PCs", dataset_path=self.h5ad_path, indices=indices)
        self.assertEqual(pcs_subset.shape, (3, 10))

        # Test getting a subset of columns for PCs
        col_indices = [0, 1]
        pcs_col_subset = self.reader.get_obsm_varm(entity="genes", key="PCs", dataset_path=self.h5ad_path, col_indices=col_indices)
        self.assertEqual(pcs_col_subset.shape, (50, 2))

        # Test getting both row and column subsets
        pcs_both_subset = self.reader.get_obsm_varm(entity="genes", key="PCs", dataset_path=self.h5ad_path,
                                                     indices=indices, col_indices=col_indices)
        self.assertEqual(pcs_both_subset.shape, (3, 2))

        # Test getting a dataframe-encoded varm (differential_expression)
        cell_type_a = self.reader.get_obsm_varm(entity="genes", key="differential_expression", dataset_path=self.h5ad_path,
                                                 column_name="cell type A")
        self.assertEqual(len(cell_type_a), 50)
        self.assertEqual(cell_type_a.dtype, np.float32)

        # Test getting a specific column with row indices for dataframe
        cell_type_b_subset = self.reader.get_obsm_varm(entity="genes", key="differential_expression", dataset_path=self.h5ad_path,
                                                        column_name="cell type B", indices=[0, 1, 2])
        self.assertEqual(len(cell_type_b_subset), 3)

        # Test getting a non-existent key
        nonexistent = self.reader.get_obsm_varm(entity="genes", key="nonexistent", dataset_path=self.h5ad_path)
        self.assertEqual(len(nonexistent), 0)

        # Test getting a non-existent column from dataframe
        nonexistent_col = self.reader.get_obsm_varm(entity="genes", key="differential_expression", dataset_path=self.h5ad_path,
                                                     column_name="nonexistent")
        # Should return empty array if column doesn't exist
        self.assertTrue(len(nonexistent_col) == 0 or nonexistent_col is not None)

    def test_get_uns(self):
        """Test getting unstructured annotations using the get_uns method."""

        # Test getting string array dataset
        description = self.reader.get_uns('description', dataset_path=self.h5ad_path)
        self.assertIsNotNone(description)
        # h5py returns arrays, check the content
        if isinstance(description, np.ndarray):
            self.assertEqual(len(description), 1)
            desc_str = description[0]
            if isinstance(desc_str, bytes):
                desc_str = desc_str.decode('utf-8')
            self.assertEqual(desc_str, 'Test dataset for unit testing')

        # Test getting numeric array
        params = self.reader.get_uns('analysis_params', dataset_path=self.h5ad_path)
        self.assertIsNotNone(params)
        self.assertEqual(len(params), 3)
        np.testing.assert_array_almost_equal(params, [0.1, 0.5, 1.0])

        # Test getting nested group (returns dict with subkeys)
        analysis = self.reader.get_uns('analysis', dataset_path=self.h5ad_path)
        self.assertIsNotNone(analysis)
        self.assertIsInstance(analysis, dict)
        self.assertIn('explained_variance', analysis)
        self.assertIn('method', analysis)
        self.assertEqual(len(analysis['explained_variance']), 10)

        # A missing key raises KeyError, as in the zarr reader (the route
        # answers 404 key_not_found)
        with self.assertRaises(KeyError):
            self.reader.get_uns('nonexistent', dataset_path=self.h5ad_path)

        # Verify metadata includes uns
        metadata = self.reader.get_metadata(dataset_path=self.h5ad_path)
        self.assertTrue(metadata.get('has_uns', False))

    def test_get_X(self):
        """Test getting X matrix."""

        # Test getting the entire matrix
        X = self.reader.get_X(dataset_path=self.h5ad_path)
        self.assertEqual(X.shape, (100, 50))

        # Test getting a subset of rows
        row_indices = [0, 1, 2]
        X_rows = self.reader.get_X(row_indices=row_indices, dataset_path=self.h5ad_path)
        self.assertEqual(X_rows.shape, (3, 50))
        np.testing.assert_array_equal(X_rows, X[row_indices, :])

        # Test getting a subset of columns
        col_indices = [0, 1, 2]
        X_cols = self.reader.get_X(col_indices=col_indices, dataset_path=self.h5ad_path)
        self.assertEqual(X_cols.shape, (100, 3))
        np.testing.assert_array_equal(X_cols, X[:, col_indices])

        # Test getting a subset of both rows and columns
        X_subset = self.reader.get_X(row_indices=row_indices, col_indices=col_indices, dataset_path=self.h5ad_path)
        self.assertEqual(X_subset.shape, (3, 3))
        np.testing.assert_array_equal(X_subset, X[row_indices, :][:, col_indices])

    def test_get_layer(self):
        """Test getting layer data."""

        # Test getting the entire dense layer
        raw = self.reader.get_layer('raw', dataset_path=self.h5ad_path)
        self.assertEqual(raw.shape, (100, 50))

        # Test getting a subset of rows from dense layer
        row_indices = [0, 1, 2]
        raw_rows = self.reader.get_layer('raw', row_indices=row_indices, dataset_path=self.h5ad_path)
        self.assertEqual(raw_rows.shape, (3, 50))

        # Test getting a subset of columns from dense layer
        col_indices = [0, 1, 2]
        raw_cols = self.reader.get_layer('raw', col_indices=col_indices, dataset_path=self.h5ad_path)
        self.assertEqual(raw_cols.shape, (100, 3))

        # Test getting a subset of both rows and columns from dense layer
        raw_subset = self.reader.get_layer('raw', row_indices=row_indices, col_indices=col_indices, dataset_path=self.h5ad_path)
        self.assertEqual(raw_subset.shape, (3, 3))

        # Test getting a non-existent layer
        nonexistent = self.reader.get_layer('nonexistent', dataset_path=self.h5ad_path)
        self.assertEqual(len(nonexistent), 0)

        # Test getting the entire CSR sparse layer
        logged_counts = self.reader.get_layer('logged_counts', dataset_path=self.h5ad_path)
        self.assertEqual(logged_counts.shape, (100, 50))

        # Test getting a subset of rows from CSR sparse layer
        logged_rows = self.reader.get_layer('logged_counts', row_indices=row_indices, dataset_path=self.h5ad_path)
        self.assertEqual(logged_rows.shape, (3, 50))

        # Test getting a subset of columns from CSR sparse layer
        logged_cols = self.reader.get_layer('logged_counts', col_indices=col_indices, dataset_path=self.h5ad_path)
        self.assertEqual(logged_cols.shape, (100, 3))

        # Test getting a subset of both rows and columns from CSR sparse layer
        logged_subset = self.reader.get_layer('logged_counts', row_indices=row_indices, col_indices=col_indices, dataset_path=self.h5ad_path)
        self.assertEqual(logged_subset.shape, (3, 3))

    def test_get_obsp(self):
        """Test getting observation-observation matrices (obsp)."""

        # Test getting a valid obsp key
        connectivities = self.reader.get_obsp_varp('connectivities', entity="cells", dataset_path=self.h5ad_path)
        self.assertEqual(connectivities.shape, (100, 100))

        # Test getting a subset using row_indices and col_indices
        indices = [0, 1, 2]
        conn_subset = self.reader.get_obsp_varp('connectivities', entity="cells", dataset_path=self.h5ad_path,
                                                 row_indices=indices, col_indices=indices)
        self.assertEqual(conn_subset.shape, (3, 3))

        # Verify diagonal values of connectivities (should be 1.0)
        np.testing.assert_almost_equal(np.diag(connectivities), np.ones(100))

        # Test getting distances matrix
        distances = self.reader.get_obsp_varp('distances', entity="cells", dataset_path=self.h5ad_path)
        self.assertEqual(distances.shape, (100, 100))

        # Verify diagonal values of distances (should be 0.0)
        np.testing.assert_almost_equal(np.diag(distances), np.zeros(100))

        # Test getting a non-existent key
        nonexistent = self.reader.get_obsp_varp('nonexistent', entity="cells", dataset_path=self.h5ad_path)
        self.assertEqual(len(nonexistent), 0)

    def test_get_varp(self):
        """Test getting variable-variable matrices (varp)."""

        # Test getting a valid varp key
        correlation = self.reader.get_obsp_varp('correlation', entity="genes", dataset_path=self.h5ad_path)
        self.assertEqual(correlation.shape, (50, 50))

        # Test getting a subset using row_indices and col_indices
        indices = [0, 1, 2]
        corr_subset = self.reader.get_obsp_varp('correlation', entity="genes", dataset_path=self.h5ad_path,
                                                 row_indices=indices, col_indices=indices)
        self.assertEqual(corr_subset.shape, (3, 3))

        # Verify diagonal values of correlation (should be 1.0)
        np.testing.assert_almost_equal(np.diag(correlation), np.ones(50))

        # Test getting a non-existent key
        nonexistent = self.reader.get_obsp_varp('nonexistent', entity="genes", dataset_path=self.h5ad_path)
        self.assertEqual(len(nonexistent), 0)

if __name__ == '__main__':
    unittest.main()

