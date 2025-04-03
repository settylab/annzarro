# Annzarro

Annzarro is a modern, browser-based single-cell data visualization tool that allows for comprehensive analysis of AnnData objects stored in zarr format without requiring a Python backend.

## Features

- **Pure HTML/JavaScript implementation** - runs in any modern browser without server requirements
- **Zarr.js integration** - load AnnData objects directly from local files, URLs, or S3 storage
- **Adaptive demo data** - auto-discovery of datasets in the data/ directory
- **Interactive visualizations** with Plotly.js for scatter plots, heatmaps, and more
- **DataTables integration** for powerful data filtering and exploration
- **STRING-DB integration** for gene set enrichment and protein interaction networks
- **Customizable layout** with ability to split the view into multiple visualization panels
- **Full access to AnnData structure** (.obs, .var, .obsm, .layers, etc.)
- **Gene and cell focused modes** with interactive selection
- **Specialized kompot run visualization** for differential expression analysis

## Getting Started

1. Clone this repository
2. Start the application using one of these methods:
   - **Recommended**: Use the included server script for the best experience:
     ```bash
     ./run_server.sh
     ```
   - Alternatively, open `index.html` directly in your browser (with limited features)
   - Or use any web server of your choice (e.g., `python -m http.server`)
3. Load your AnnData zarr file using the file picker, URL input, or select one of the demo datasets

### Using the Server Script

The included `run_server.sh` script provides a convenient way to run Annzarro with secure access:

```bash
# Start with default settings (port 8000)
./run_server.sh

# Start on a specific port
./run_server.sh --port 8888

# Set a custom password
./run_server.sh --password my_secure_password

# Show all options
./run_server.sh --help
```

**Features:**
- Secure token-based authentication (no password needed with token)
- Optional additional password protection as fallback
- Comprehensive access logging
- Automatic directory listing for demo datasets

### Running on Different Environments

#### Local Laptop Usage (Quick Start)

For quick personal use on your local machine:

1. **Simple Method**: Open `index.html` directly in your browser
   - File > Open or drag the file to your browser
   - Demo data tab will show hardcoded datasets only
   - All other features work normally
   - Best for quick exploration or testing

2. **Better Method**: Run the server script for full functionality
   ```bash
   ./run_server.sh
   ```
   - Open the displayed URL (with token) in your browser
   - All features including demo data auto-discovery will work
   - Browser and server run on the same machine

#### Headless Server / Remote Access

For running on a remote/headless server with multi-user access:

1. Start the server with specific port and password:
   ```bash
   # Run in a screen/tmux session or as a background process
   ./run_server.sh --port 8080 --password secure_password &

   # Or with nohup to keep running after logout
   nohup ./run_server.sh --port 8080 --password secure_password > server.out &
   ```

2. Configure network access if needed:
   - Ensure the port is accessible (adjust firewall if needed)
   - For public servers, consider setting up a reverse proxy with HTTPS

3. Connect from client machines:
   - Use the token URL for direct authenticated access
   - IP address example: `http://192.168.1.100:8080/?token=abcd1234`
   - Hostname example: `http://your-server.example.com:8080/?token=abcd1234`

4. Monitor usage via the log file:
   - Check `annzarro_server.log` for access records and errors

#### Requirements for the Server Script

The server script requires:
- Bash shell environment
- Python 3.x

If you encounter issues running the server:
```bash
# Check your Python version
python3 --version

# If Python 3 is not installed on your system:
# - On Ubuntu/Debian:
sudo apt update && sudo apt install python3

# - On CentOS/RHEL:
sudo yum install python3

# - On macOS with Homebrew:
brew install python3

# - On Windows:
#   Use Python from the Microsoft Store or use WSL for Linux environment
```

For secure installations in production environments, consider:
- Setting up a proper web server like Nginx or Apache as a reverse proxy
- Configuring HTTPS with a valid certificate
- Running the server script as a systemd service for automatic startup

## Adding Demo Datasets

To add your own demo datasets, simply copy or symlink your .zarr directories to the `data/` folder:

```bash
# Copy a dataset
cp -r /path/to/your-dataset.zarr data/

# Or create a symlink
ln -s /path/to/your-dataset.zarr data/
```

The application will automatically detect and display all .zarr directories in the data/ folder when you open the Demo Data tab.

## Data Requirements

AnnData objects should be saved in zarr format. The tool expects standard AnnData structure with:

- `.X` - Main expression matrix
- `.obs` - Cell annotations
- `.var` - Gene annotations
- `.obsm` - Multi-dimensional cell annotations (e.g., UMAP, PCA)
- `.layers` - Named alternative expression matrices
- `.uns` - Unstructured annotations

## Browser Requirements

Annzarro works best with recent versions of:
- Chrome
- Firefox
- Safari
- Edge

## Development

This project uses:
- [zarr.js](https://github.com/gzuidhof/zarr.js) for zarr format parsing
- [Plotly.js](https://plotly.com/javascript/) for interactive visualizations
- [DataTables](https://datatables.net/) for data exploration
- [Bootstrap](https://getbootstrap.com/) for responsive layout

## Testing

Annzarro includes a comprehensive testing framework:

```bash
# Install dependencies first
npm install

# Run tests
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests in watch mode during development
npm run test:watch
```

The testing framework includes:
- Unit tests for individual components
- Integration tests for component interactions
- DOM tests for UI functionality
- Continuous integration via GitHub Actions

## License

MIT