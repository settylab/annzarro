 Annzarro

[![CI Status](https://github.com/settylab/annzarro/workflows/Annzarro%20CI/badge.svg)](https://github.com/settylab/annzarro/actions)
[![Python Version](https://img.shields.io/badge/python-3.8%2B-blue)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE)

Annzarro is a modern, Python-based single-cell data visualization tool that allows for comprehensive analysis of AnnData objects stored in zarr format.

## Features

- **Python-centric architecture** - efficient data handling with Python's zarr library
- **Web UI** - clean, intuitive interface for visualization and exploration
- **Lazy loading** - efficiently work with large datasets without loading everything into memory
- **REST API** - programmatic access to all data and functionality
- **Interactive visualizations** for scatter plots, heatmaps, and more
- **Powerful data filtering** and exploration capabilities
- **STRING-DB integration** for gene set enrichment and protein interaction networks
- **Full access to AnnData structure** (.obs, .var, .obsm, .layers, etc.)
- **Gene and cell selection tools** for focused analysis

## Installation

### Prerequisites

- Python 3.8+ for the backend
- Node.js 16+ (for development only)

### Option 1: Install from PyPI (Recommended)

```bash
# Install the package
pip install annzarro

# Run the server
annzarro server --port 8000
```

### Option 2: Install from source

```bash
# Clone the repository
git clone https://github.com/settylab/annzarro.git
cd annzarro

# Install package in development mode
pip install -e .

# Run the server
annzarro server --port 8000
```

### Option 3: Use the run_annzarro.py script

```bash
# Clone the repository
git clone https://github.com/settylab/annzarro.git
cd annzarro

# Install requirements
pip install flask zarr numpy pandas matplotlib flask-cors

# Run the server
python run_annzarro.py --start --port 8000
```

## Getting Started

### Starting the Server

```bash
# Using the installed package
annzarro server --port 8000

# OR using the run_annzarro.py script
python run_annzarro.py --start
```

Then open your browser and navigate to:
```
http://localhost:8000
```

### Server Management

AnnZarro provides tools to manage the unified server:

1. Check server status:
   ```bash
   python server_status.py
   ```

2. Start the server:
   ```bash
   python run_annzarro.py --start
   ```

3. Stop the server:
   ```bash
   python run_annzarro.py --stop
   ```

4. Configure the server:
   ```bash
   python run_annzarro.py --start --port 8000 --data-dir /path/to/data
   ```

### Troubleshooting

If you encounter "Address already in use" errors when starting the server:

1. Check what's using the port:
   ```bash
   python server_status.py
   ```

2. Stop any conflicting processes:
   ```bash
   python run_annzarro.py --stop
   ```

3. If the issue persists, you can change the port in `annzarro/server/config.json` or use the `--port` command-line argument:
   ```bash
   python run_annzarro.py --start --port 8001
   ```

### Command Line Interface (CLI)

Annzarro provides a comprehensive CLI for data management:

```bash
# List all available commands
annzarro --help

# List available datasets
annzarro data list --directory /path/to/datasets

# Get information about a specific dataset
annzarro data info /path/to/dataset.zarr

# Start the server
annzarro server --port 8000 --host 0.0.0.0
```

### Python API

You can also use Annzarro as a Python library:

```python
from annzarro.core.zarr_reader import zarr_reader
from annzarro.data.manager import data_manager

# Open a zarr dataset
zarr_reader.open_zarr('/path/to/dataset.zarr')

# Get metadata about the dataset
metadata = zarr_reader.get_metadata()

# Get observation names (cells)
cells = zarr_reader.get_obs_names()

# Get variable names (genes)
genes = zarr_reader.get_var_names()

# Get X matrix with lazy loading (only loads what you need)
x_data = zarr_reader.get_X(row_indices=[0, 1, 2], col_indices=[0, 1, 2])

# Use DataManager for higher-level operations
data_manager.load_dataset('/path/to/dataset.zarr')
data_manager.set_selected_cells(['cell1', 'cell2'])
data_manager.get_obsm('X_umap', indices=[0, 1, 2])
```

## Adding Demo Datasets

To add your own demo datasets, copy or symlink your .zarr directories to the `data/` folder:

```bash
# Copy a dataset
cp -r /path/to/your-dataset.zarr data/

# Or create a symlink
ln -s /path/to/your-dataset.zarr data/
```

The application will automatically detect and display all .zarr directories in the data/ folder.

## Data Requirements

AnnData objects should be saved in zarr format. The tool expects standard AnnData structure:

- `.X` - Main expression matrix
- `.obs` - Cell annotations
- `.var` - Gene annotations
- `.obsm` - Multi-dimensional cell annotations (e.g., UMAP, PCA)
- `.layers` - Named alternative expression matrices
- `.uns` - Unstructured annotations

## Testing

Annzarro includes a comprehensive test suite:

```bash
# Run all tests
python run_tests.py

# Run specific test suites
python run_tests.py --unit       # Run unit tests
python run_tests.py --integration # Run integration tests
python run_tests.py --js         # Run JavaScript tests
python run_tests.py --e2e        # Run end-to-end tests

# Run tests with specific options
python run_tests.py --coverage   # Generate coverage reports
python run_tests.py --ci         # Run in CI mode (skip certain tests)
```

You can also use the console script:

```bash
annzarro-tests --unit --integration
```

## Development Setup

### Backend (Python)

```bash
# Clone the repository
git clone https://github.com/settylab/annzarro.git
cd annzarro

# Install in development mode with development dependencies
pip install -e ".[dev]"

# Run tests
pytest annzarro/tests

# Start the server for development
python -m annzarro.server
```

### Frontend (JavaScript)

```bash
# Install node dependencies
npm install

# Run JavaScript tests
npm test

# Run linter
npm run lint

# Serve the web UI (if using the legacy dual-server approach)
npm run serve
```

## API Documentation

The Annzarro server exposes a RESTful API for programmatic access:

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/v1/datasets` | GET | List available datasets |
| `/api/v1/datasets/<path>` | GET | Get dataset information |
| `/api/v1/datasets/<path>/load` | POST | Load a dataset |
| `/api/v1/data/info` | GET | Get information about the loaded dataset |
| `/api/v1/data/obs` | GET | Get observation annotations |
| `/api/v1/data/var` | GET | Get variable annotations |
| `/api/v1/data/X` | GET | Get X matrix data |
| `/api/v1/data/layer/<layer_name>` | GET | Get layer data |
| `/api/v1/data/obsm/<obsm_key>` | GET | Get obsm data |
| `/api/v1/data/cells` | GET | Get cell names |
| `/api/v1/data/genes` | GET | Get gene names |
| `/api/v1/data/selection/cells` | GET/POST/DELETE | Handle cell selection operations |
| `/api/v1/data/selection/genes` | GET/POST/DELETE | Handle gene selection operations |
| `/api/v1/data/focus/cell` | GET/POST/DELETE | Handle cell focus operations |
| `/api/v1/data/focus/gene` | GET/POST/DELETE | Handle gene focus operations |

## Browser Requirements

Annzarro works best with recent versions of:
- Chrome
- Firefox
- Safari
- Edge

## License

GPL-3.0-or-later (as specified in package.json)
