"""Tests for the stateless server API endpoints.

These run the real routes and the real reader against the committed
``fixture_small.zarr`` (200 cells x 20 genes). They used to mock reader methods
against a dataset that did not exist; once the routes began checking that a
dataset exists before reading it, every request answered 404 and two of the
mocked methods (get_obs, get_var) had been removed from the reader.
"""
import json
import os
import unittest

import numpy as np

from annzarro.core.zarr_reader import ZarrReader
from annzarro.server.core import create_app

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
DATASET = 'fixture_small.zarr'


class TestStatelessAPI(unittest.TestCase):

    def setUp(self):
        self.app = create_app({'TESTING': True, 'DEBUG': False, 'data_dir': DATA_DIR})
        self.client = self.app.test_client()

    def _get(self, url):
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200, response.data[:300])
        return json.loads(response.data)

    def test_get_dataset_metadata(self):
        data = self._get(f'/api/v1/datasets/{DATASET}/info')
        self.assertEqual((data['n_obs'], data['n_vars']), (200, 20))
        self.assertTrue(data['has_obs'])
        self.assertTrue(data['has_var'])
        self.assertTrue(data['has_obsm'])
        self.assertIn('cell_type', data['obs_columns'])
        self.assertIn('X_umap', data['embeddings'])
        self.assertEqual(data['name'], 'Fixture Small')

    def test_get_obs(self):
        data = self._get(f'/api/v1/data/obs?dataset_path={DATASET}&rows=0,1')
        self.assertEqual(data['data']['_index'], ['cell_0000', 'cell_0001'])
        self.assertEqual(len(data['data']['cell_type']), 2)
        self.assertIn('cell_type', data['categories'])
        self.assertTrue(data['dataset_path'].endswith(DATASET))

    def test_get_var(self):
        data = self._get(f'/api/v1/data/var?dataset_path={DATASET}&cols=0,1')
        self.assertEqual(data['data']['_index'], ['GENE000', 'GENE001'])
        self.assertTrue(data['dataset_path'].endswith(DATASET))

    def test_get_anndata_structure(self):
        data = self._get(f'/api/v1/zarr/to_anndata?dataset_path={DATASET}')
        self.assertEqual((data['n_obs'], data['n_vars']), (200, 20))
        self.assertEqual(data['obs_columns_info']['cell_type']['type'], 'categorical')
        self.assertTrue(data['dataset_path'].endswith(DATASET))

    def test_get_X(self):
        data = self._get(f'/api/v1/data/X?dataset_path={DATASET}&rows=0,1&cols=0,1')
        expected = ZarrReader().get_X(dataset_path=os.path.join(DATA_DIR, DATASET),
                                      row_indices=[0, 1], col_indices=[0, 1])
        np.testing.assert_allclose(np.asarray(data['data']), expected)
        self.assertTrue(data['dataset_path'].endswith(DATASET))


if __name__ == '__main__':
    unittest.main()
