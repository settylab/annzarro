# Annzarro

Annzarro is a modern, browser-based single-cell data visualization tool that allows for comprehensive analysis of AnnData objects stored in zarr format without requiring a Python backend.

## Features

- **Pure HTML/JavaScript implementation** - runs in any modern browser without server requirements
- **Zarr.js integration** - load AnnData objects directly from local files, URLs, or S3 storage
- **Interactive visualizations** with Plotly.js for scatter plots, heatmaps, and more
- **DataTables integration** for powerful data filtering and exploration
- **STRING-DB integration** for gene set enrichment and protein interaction networks
- **Customizable layout** with ability to split the view into multiple visualization panels
- **Full access to AnnData structure** (.obs, .var, .obsm, .layers, etc.)
- **Gene and cell focused modes** with interactive selection
- **Specialized kompot run visualization** for differential expression analysis

## Getting Started

1. Clone this repository
2. Open `index.html` in your browser
3. Load your AnnData zarr file using the file picker or URL input

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