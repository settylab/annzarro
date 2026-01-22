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
    
    def test_get_metadata(self):
        metadata = self.reader.get_metadata(file_path = self.h5ad_path)

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
        obs_names = self.reader.get_cell_gene_names(file_name=self.h5ad_path, entity= "cells")
        
        # Check that we get 100 cell names
        self.assertEqual(len(obs_names), 100)
        self.assertEqual(obs_names[0], 'cell_0')
        self.assertEqual(obs_names[99], 'cell_99')
        #Check random elements
        self.assertEqual(obs_names[21], 'cell_21')
        self.assertEqual(obs_names[48], 'cell_48')
        self.assertEqual(obs_names[67], 'cell_67')
    
    def test_get_gene_names(self):
        var_names = self.reader.get_cell_gene_names(file_name=self.h5ad_path, entity = "genes")
        
        # Check that we get 50 gene names
        self.assertEqual(len(var_names), 50)
        self.assertEqual(var_names[0], 'gene_0')
        self.assertEqual(var_names[49], 'gene_49')
        #Check random elements
        self.assertEqual(var_names[8], 'gene_8')
        self.assertEqual(var_names[23], 'gene_23')
        self.assertEqual(var_names[37], 'gene_37')

