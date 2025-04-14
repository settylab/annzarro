# Annzarro

[![CI Status](https://github.com/settylab/annzarro/workflows/Annzarro%20CI/badge.svg)](https://github.com/settylab/annzarro/actions)
[![Python Version](https://img.shields.io/badge/python-3.8%2B-blue)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE)

Annzarro is a modern, browser-based single-cell data visualization tool that allows for comprehensive analysis of AnnData objects stored in zarr format. It runs in any modern browser with a lightweight Python backend for data access.

## Features

- **Browser-based Visualization** - Interactive plots using plotly.js with no Python required for visualization
- **Stateless Architecture** - Efficient data handling with a stateless API for better scalability
- **Lazy Loading** - Work with large datasets without loading everything into memory
- **Flexible Panel System** - Customizable layout with multiple visualization and table panels
- **Interactive DataTables** - Powerful search and filtering with the DataTables search builder
- **Complete AnnData Support** - Access to all components (.obs, .var, .obsm, .varm, .obsp, .varp, .layers, etc.)
- **Dataframe Support** - Special handling for dataframe-encoded matrices in obsm/varm
- **Sparse Matrix Support** - Efficient handling of CSR, CSC, and COO formats
- **Remote Dataset Access** - Connect to zarr archives via local filesystem, HTTP, or S3
- **Session Management** - Save and restore your analysis setup
- **StringDB Integration** - Gene set enrichment and protein interaction networks

## Getting Started

### Starting the Server

```bash
# Clone the repository
git clone https://github.com/settylab/annzarro.git
cd annzarro

# Install requirements
./annzarro-cli install

# Start the server (production mode by default)
./annzarro-cli start

# Start in development mode (less secure)
./annzarro-cli start --development

# Start with options
./annzarro-cli start --port 8080 --data-dir /path/to/data
```

Then open your browser and navigate to:
```
http://localhost:8000
```

### Authentication and User Management

The default admin credentials are:
- Username: admin
- Password: annzarro-password

Authentication is enabled by default in production mode and can be configured in the YAML configuration files (`config/base.yaml`, `config/production.yaml`, and `config/development.yaml`).

Use the CLI to manage users:

```bash
# Add a new user
./annzarro-cli user add

# Add an admin user
./annzarro-cli user add -u username -p password -a

# List all users
./annzarro-cli user list

# Remove a user
./annzarro-cli user remove -u username
```

### Server Management

```bash
# Start server in the background (daemon mode)
./annzarro-cli start --detach

# Stop the server
./annzarro-cli stop

# Start with specific configuration
./annzarro-cli start --config /path/to/custom_config.yaml

# Start in development mode (usually has auth disabled)
./annzarro-cli start --development

# Show current configuration
./annzarro-cli config show

# Initialize a custom configuration
./annzarro-cli config init --output my_config.yaml

# For production deployment with Gunicorn:
cd annzarro/server
./run_gunicorn.sh
```

### Data Management

Use the CLI to manage datasets:

```bash
# List available datasets
./annzarro-cli data list

# Get dataset information
./annzarro-cli data info /path/to/dataset.zarr
```

## User Interface

Annzarro provides a modern, intuitive interface for single-cell data exploration:

### Global Components

- **Dataset Selection** - Browse and select from available datasets
- **Gene Focus** - Searchable dropdown to select a focused gene
- **Cell Focus** - Searchable dropdown to select a focused cell
- **Taxonomy Information** - Track species information for gene analysis
- **Session Management** - Save and restore analysis sessions

### Visualization Panels

- **Plot Panels** - Create scatter plots, heatmaps, and other visualizations
- **Table Panels** - Filter and select cells/genes with DataTables
- **Metadata Panels** - Explore AnnData structure and dataset information

### Plot Configuration

Plots can be created with:
- Data selection from any AnnData component (.obs, .var, .obsm, .varm, .layers, etc.)
- Dimension mapping (X, Y, Z axes)
- Color mapping based on data fields (numerical or categorical)
- Custom hover information
- Interactive selection and filtering

## Working with Data

### Adding Datasets

To add your own datasets, copy or symlink your .zarr directories to the `data/` folder:

```bash
# Copy a dataset
cp -r /path/to/your-dataset.zarr data/

# Or create a symlink
ln -s /path/to/your-dataset.zarr data/

# Start with a specific data directory
./run_start.sh --data-dir /path/to/datasets
```

The application will automatically detect and display all .zarr directories in the data/ folder.

### Data Requirements

AnnData objects should be saved in zarr format with standard components:

- `.X` - Main expression matrix
- `.obs` - Cell annotations
- `.var` - Gene annotations
- `.obsm` - Multi-dimensional cell annotations (e.g., UMAP, PCA)
- `.varm` - Multi-dimensional gene annotations
- `.obsp` - Cell-cell relationships
- `.varp` - Gene-gene relationships
- `.layers` - Named alternative expression matrices
- `.uns` - Unstructured annotations

## Development

### Backend (Python)

```bash
# Install in development mode
pip install -e .

# Run tests
python run_tests.py --unit

# Start the server for development
python run_annzarro.py --start --debug
```

### Frontend (JavaScript)

```bash
# Install node dependencies
npm install

# Run JavaScript tests
npm test

# Run linter
npm run lint
```

## Architecture

Annzarro uses a unified stateless server architecture:

- **Frontend**: Pure JavaScript with plotly.js and DataTables
- **Backend**: Flask server providing both API and static file serving
- **API**: RESTful endpoints for data access with the dataset_path parameter
- **Storage**: Support for local and remote zarr archives
- **Authentication**: Secure session-based authentication with password hashing
- **Production-Ready**: Gunicorn support for multi-worker deployment

### Server Components

- `annzarro/server/` - Main server package with modular components
- `annzarro/cli.py` - Command line interface with server and user management
- `annzarro-cli` - Executable script for easily accessing all features

For more details, see:
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) - Overall implementation strategy
- [SERVER_ARCHITECTURE.md](SERVER_ARCHITECTURE.md) - Server design and API endpoints
- [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md) - Frontend component design

## Browser Requirements

Annzarro works best with recent versions of:
- Chrome
- Firefox
- Safari
- Edge

## License

GPL-3.0-or-later