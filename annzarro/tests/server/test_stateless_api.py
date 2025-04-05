"""
Tests for the stateless server API endpoints.
"""
import json
import unittest
from unittest.mock import patch, MagicMock
import numpy as np
import os
from pathlib import Path

from annzarro.server.core import create_app, DEFAULT_CONFIG

class TestStatelessAPI(unittest.TestCase):
    """Test cases for the stateless API endpoints."""

    def setUp(self):
        """Set up the test environment."""
        # Create and configure the app for testing
        self.app = create_app({
            'TESTING': True,
            'DEBUG': False,
            'data_dir': 'tests/data'
        })
        self.client = self.app.test_client()

    @patch('annzarro.core.zarr_reader.zarr_reader.open_dataset_by_path')
    def test_get_dataset_metadata(self, mock_open_dataset):
        """Test getting dataset metadata."""
        # Mock the dataset root and metadata
        mock_root = MagicMock()
        mock_metadata = {
            'shape': (100, 200),
            'has_obs': True,
            'has_var': True,
            'has_obsm': True,
            'has_varm': False,
            'has_layers': True,
            'has_uns': True,
            'obs_columns': ['cluster', 'cell_type'],
            'var_columns': ['gene_name', 'gene_id'],
            'layers': {'counts': {'shape': (100, 200)}}
        }

        # Mock additional data for embeddings
        mock_root['obsm'] = {}
        mock_root['obsm'].keys = MagicMock(return_value=['X_umap', 'X_pca'])
        mock_root['obsm']['X_umap'] = MagicMock()
        mock_root['obsm']['X_umap'].shape = (100, 2)
        mock_root['obsm']['X_umap'].dtype = 'float32'
        mock_root['obsm']['X_pca'] = MagicMock()
        mock_root['obsm']['X_pca'].shape = (100, 50)
        mock_root['obsm']['X_pca'].dtype = 'float32'

        # Set up the mock return value
        mock_open_dataset.return_value = (mock_root, mock_metadata)

        # Make the request
        response = self.client.get('/api/v1/datasets/test_dataset.zarr/info')
        
        # Check the response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        
        # Verify the data
        self.assertEqual(data['shape'], [100, 200])
        self.assertEqual(data['n_obs'], 100)
        self.assertEqual(data['n_vars'], 200)
        self.assertEqual(data['has_obs'], True)
        self.assertEqual(data['has_var'], True)
        self.assertEqual(data['has_obsm'], True)
        self.assertEqual(data['has_varm'], False)
        self.assertEqual(data['name'], 'Test Dataset')

    @patch('annzarro.core.zarr_reader.zarr_reader.get_obs')
    def test_get_obs(self, mock_get_obs):
        """Test getting observation annotations."""
        # Mock the data
        mock_data = [
            {'cell_id': 'cell_1', 'cluster': '1', 'cell_type': 'T cell'},
            {'cell_id': 'cell_2', 'cluster': '2', 'cell_type': 'B cell'}
        ]
        mock_get_obs.return_value = mock_data

        # Make the request
        response = self.client.get('/api/v1/data/obs?dataset_path=test_dataset.zarr&rows=0,1')
        
        # Check the response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        
        # Verify the data
        self.assertEqual(data['data'], mock_data)
        self.assertEqual(data['dataset_path'], 'test_dataset.zarr')

    @patch('annzarro.core.zarr_reader.zarr_reader.get_var')
    def test_get_var(self, mock_get_var):
        """Test getting variable annotations."""
        # Mock the data
        mock_data = [
            {'gene_id': 'gene_1', 'gene_name': 'FOXP3'},
            {'gene_id': 'gene_2', 'gene_name': 'CD4'}
        ]
        mock_get_var.return_value = mock_data

        # Make the request
        response = self.client.get('/api/v1/data/var?dataset_path=test_dataset.zarr&cols=0,1')
        
        # Check the response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        
        # Verify the data
        self.assertEqual(data['data'], mock_data)
        self.assertEqual(data['dataset_path'], 'test_dataset.zarr')
        
    @patch('annzarro.core.zarr_reader.zarr_reader.open_dataset_by_path')
    @patch('annzarro.core.zarr_reader.zarr_reader.get_anndata_structure')
    def test_get_anndata_structure_with_uns(self, mock_get_structure, mock_open_dataset):
        """Test getting AnnData structure with uns data."""
        # Mock the dataset root and metadata
        mock_root = MagicMock()
        mock_metadata = {
            'shape': (100, 200),
            'has_obs': True,
            'has_var': True,
            'has_obsm': True,
            'has_varm': False,
            'has_layers': True,
            'has_uns': True
        }
        
        # Set up the mock return value for open_dataset_by_path
        mock_open_dataset.return_value = (mock_root, mock_metadata)
        
        # Mock the get_anndata_structure response
        mock_structure = {
            'n_obs': 100,
            'n_vars': 200,
            'var_names': ['gene1', 'gene2', 'gene3'],
            'obs_names': ['cell1', 'cell2', 'cell3'],
            'layers': ['counts', 'normalized'],
            'obsm': ['X_pca', 'X_umap'],
            'varm': [],
            'obsp': [],
            'varp': [],
            'uns': ['spatial', 'neighbors', 'pca'],
            'uns_structure': {
                'spatial': {'encoding-type': 'dict'},
                'neighbors': {'encoding-type': 'dict'},
                'pca': {'encoding-type': 'array(float32)', 'shape': (50, 50)}
            }
        }
        mock_get_structure.return_value = mock_structure
        
        # Make the request
        response = self.client.get('/api/v1/zarr/to_anndata?dataset_path=test_dataset.zarr')
        
        # Check the response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        
        # Verify the data includes uns information
        self.assertEqual(data['n_obs'], 100)
        self.assertEqual(data['n_vars'], 200)
        self.assertEqual(data['uns'], ['spatial', 'neighbors', 'pca'])
        self.assertEqual(data['uns_structure']['spatial']['encoding-type'], 'dict')
        self.assertEqual(data['uns_structure']['pca']['encoding-type'], 'array(float32)')
        self.assertEqual(data['dataset_path'], 'test_dataset.zarr')

    @patch('annzarro.core.zarr_reader.zarr_reader.get_X')
    def test_get_X(self, mock_get_X):
        """Test getting X matrix data."""
        # Mock the data
        mock_data = [[1.0, 2.0], [3.0, 4.0]]
        mock_get_X.return_value = mock_data

        # Make the request
        response = self.client.get('/api/v1/data/X?dataset_path=test_dataset.zarr&rows=0,1&cols=0,1')
        
        # Check the response
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        
        # Verify the data
        self.assertEqual(data['data'], mock_data)
        self.assertEqual(data['dataset_path'], 'test_dataset.zarr')

if __name__ == '__main__':
    unittest.main()