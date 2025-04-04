# Implementation Plan for Annzarro

This plan outlines the vision, required components, and implementation status for Annzarro, a comprehensive browser-based visualization tool for AnnData in zarr format.

## Core Vision

Annzarro is designed to be a browser-based single-cell data exploration tool that:
- Runs in any modern browser without requiring Python installation
- Uses zarr for lazy loading of AnnData structures
- Provides an intuitive, modern interface for data visualization and exploration
- Enables complex data selections and filtering
- Supports multiple visualization types through plotly
- Allows saving and sharing of analysis sessions

## Current Status (Updated: April 4, 2025)

### Key Accomplishments
- ✅ Implemented stateless server architecture with direct file access
- ✅ Fixed critical JavaScript errors and removed file:// protocol support
- ✅ Unified server approach using a single port for both frontend and backend
- ✅ Added support for dataframe-encoded matrices in obsm/varm with column access
- ✅ Implemented support for sparse matrices (CSR, CSC, COO formats)
- ✅ Created comprehensive test coverage for API endpoints
- ✅ Implemented frontend dataframe UI components for visualization and selection
- ✅ Fixed API metadata endpoint to include obsm_dataframes and varm_dataframes information
- ✅ Revamped landing page to focus on dataset browsing instead of loading datasets
- ✅ Removed automatic creation of UMAP panels, now requiring explicit user selection
- ✅ Implemented persistent header with gene/cell focus and control elements
- ✅ Added session management for saving and loading analysis state
- ✅ Implemented flexible panel system with panel-manager.js
- ✅ Added panel splitting, maximizing, and configuration functionality
- ✅ Created multiple specialized panel types for different visualizations

### In Progress
- ⚠️ Interactive plot configuration components
- ⚠️ Integration of dataframe visualization with main visualization system
- ⚠️ Implementation of comprehensive plotting capabilities for scRNA-seq data

## Technical Foundation

1. **Frontend Technologies**
   - ✅ Pure browser-based implementation using JavaScript
   - ⏳ Plotly.js for visualization
   - ⏳ DataTables for tabular data with search builder functionality
   - ✅ Bootstrap for responsive UI layout
   - ✅ Client-side stateless API access

2. **Key Data Structures**
   - ✅ AnnData in zarr format with standard components (.obs, .var, .X, .obsm, .varm, .layers, .uns, etc.)
   - ✅ Support for dataframe-encoded matrices in obsm/varm
   - ✅ Support for sparse matrices (.obsp, .varp, and in .layers)

3. **Data Management**
   - ✅ Stateless API architecture
   - ✅ Client-side caching and state management
   - ✅ Lazy loading of data subsets as needed
   - ⏳ Support for local and remote datasets (via file system, HTTP, S3, etc.)

## Core Components

### 1. Server Architecture and API
- ✅ Unified stateless server architecture with direct file access
- ✅ Dataset_path parameter on all data endpoints
- ✅ Modular server organization (core.py, data_routes.py, zarr_routes.py, static_routes.py)
- ✅ API endpoints for all AnnData components
- ✅ Support for dataframe column access in obsm/varm
- ✅ Path-based data notation (e.g., "varm/matrix_name/column_name")
- ✅ Pagination support for large matrices
- ⏳ Full remote storage integration (S3, HTTP, etc.)
- ⏳ Caching mechanism for remote datasets

### 2. User Interface Framework
- ✅ Persistent header with focused gene/cell and dataset information
- ✅ Dataset browsing focused home page
- ⚠️ Panel-based layout system with resizing and splitting
- ✅ User-driven panel creation interface
- ⚠️ Panel creation and configuration interface
- ✅ Global error reporting and notification system

### 3. Visualization Components
- ⏳ Plot panels with Plotly.js integration
- ⏳ Hierarchical data source selection
- ⏳ Axis mapping (X, Y, Z) from any data source
- ⏳ Color mapping for continuous and categorical data
- ⏳ Interactive zoom, pan, and selection
- ⏳ Custom hover information
- ⏳ 2D and 3D visualization support

### 4. Data Selection and Filtering
- ⏳ Table panels with DataTables
- ⏳ Search builder for complex filtering
- ⏳ Gene and cell set management
- ⏳ Set operations (union, intersection, difference)
- ⏳ Export/import of selected sets

### 5. Session Management
- ✅ Session state serialization
- ✅ Local storage and file-based save/load
- ⏳ URL parameter encoding for sharing
- ⏳ Cross-dataset session compatibility

## Detailed Implementation Tasks

### 1. Server Architecture (Status: ✅ COMPLETE)
- ✅ Implement unified stateless server architecture
- ✅ Serve both API and static files from single server
- ✅ Create modular server code organization
- ✅ Add dataset_path parameter to all endpoints
- ✅ Implement proper error handling for API requests
- ✅ Create comprehensive API documentation
- ✅ Add dataframe support for obsm/varm matrices
- ✅ Implement path-based data access notation
- ✅ Add pagination for large data requests
- ⏳ Enhance remote storage support (S3, HTTP, etc.)
- ⏳ Implement caching mechanism for remote datasets
- ⏳ Create middleware for error handling and logging

### 2. Data Access Layer (Status: ✅ COMPLETE)
- ✅ Create zarr_reader.py with comprehensive AnnData support
- ✅ Implement dataframe detection and column access in obsm/varm
- ✅ Add support for sparse matrices (CSR, CSC, COO)
- ✅ Create helper methods for shape and type discovery
- ✅ Implement metadata extraction with complete information
- ✅ Support partial data loading with indices
- ✅ Add chunked loading for large matrices
- ✅ Implement stateless operation with direct file access
- ⏳ Add progress indicators for large operations
- ⏳ Create specialized adapters for different storage backends

### 3. Frontend Data Management (Status: ✅ MOSTLY COMPLETE)
- ✅ Create data-manager.js with client-side state management
- ✅ Implement dataset registry with multi-dataset support
- ✅ Add focused gene/cell tracking
- ✅ Create selection set management
- ✅ Implement client-side caching
- ✅ Add methods for accessing all AnnData components
- ✅ Create dataframe support in loadObsm and loadVarm
- ✅ Add dataframe column information methods
- ✅ Implement path-based data access
- ✅ Add UI components for dataframe column selection
- ✅ Create specialized visualization components for dataframe data
- ⏳ Create visualization-ready data transformation
- ⏳ Implement set operations for selections

### 4. User Interface Framework (Status: ✅ MOSTLY COMPLETE)
- ✅ Create home page focused on dataset browsing
- ✅ Fix server directory path handling for dataset browsing
- ✅ Implement persistent header with gene/cell focus
- ✅ Create flexible panel-based layout system with panel-manager.js
- ✅ Implement on-demand panel creation by user selection
- ✅ Add resizing and splitting functionality
- ✅ Create different panel types (scatter, heatmap, violin, table, gene, cell, matrix, dataframe)
- ✅ Add full-screen and panel operation controls
- ✅ Implement global error and notification system
- ✅ Create responsive design for different screen sizes

### 5. Visualization Components (Status: ⏳ PLANNED)
- ⏳ Implement plotly.js integration
- ⏳ Create data source selection components
- ⏳ Add axis mapping interface for X, Y, Z
- ⏳ Implement color mapping for continuous and categorical data
- ⏳ Create custom hover information configuration
- ⏳ Add interactive selection and filtering
- ⏳ Implement 2D and 3D visualization modes
- ⏳ Create specialized visualizations for different data types
- ⏳ Add scale adjustment controls

### 6. Data Selection and Filtering (Status: ⏳ PLANNED)
- ⏳ Integrate DataTables with search builder
- ⏳ Create table panels for obs and var data
- ⏳ Implement column customization
- ⏳ Add set creation and management
- ⏳ Create export functionality
- ⏳ Implement StringDB integration for gene sets
- ⏳ Add URL-based sharing of selections

### 7. Session Management (Status: ✅ COMPLETE)
- ✅ Implement state serialization
- ✅ Create local storage mechanism
- ✅ Add file-based save/load
- ✅ Implement automatic session recovery
- ✅ Add consistent UI for session management
- ⏳ Add URL parameter encoding
- ⏳ Add cross-dataset compatibility

### 8. Testing and Quality Assurance (Status: ⚠️ IN PROGRESS)
- ✅ Create unit tests for server components
- ✅ Implement integration tests for API endpoints
- ✅ Add tests for zarr_reader functionality
- ✅ Create test cases for complex data structures
- ⚠️ Implement frontend unit tests
- ⏳ Add integration tests for UI components
- ⏳ Create end-to-end testing with real data
- ⏳ Implement automated browser testing
- ⏳ Add performance testing for large datasets

## Technical Challenges and Solutions

### 1. Dataframe Support in obsm/varm (Status: ✅ COMPLETE)
- **Challenge**: AnnData can store complex dataframe structures in obsm/varm with multiple named columns, but these aren't easily accessible.
- **Solution**:
  - ✅ Backend: Detect dataframe encoding during metadata extraction
  - ✅ Backend: Record column names and metadata for each dataframe
  - ✅ Backend: Add methods to access specific columns
  - ✅ Backend: Enable path notation for intuitive access (e.g., "varm/matrix_name/column_name")
  - ✅ Backend: Include obsm_dataframes and varm_dataframes in API metadata response
  - ✅ Frontend: Add methods to detect dataframes and get column lists
  - ✅ Frontend: Extend loadObsm/loadVarm to accept column names
  - ✅ Frontend: Implement loadDataByPath for path-based access
  - ✅ Frontend: Create UI components for exploring dataframe structures
  - ✅ Frontend: Add visualization support for dataframe columns (histograms and heatmaps)
  - ✅ Frontend: Implement interactive selectors for dataframe matrices and columns

### 2. Sparse Matrix Handling (Status: ✅ BACKEND COMPLETE)
- **Challenge**: Some datasets use sparse matrices (CSR, CSC, COO) for efficient storage, requiring special handling.
- **Solution**:
  - ✅ Add detection and information extraction for sparse formats
  - ✅ Implement support for converting between sparse formats
  - ✅ Create helper methods for accessing sparse matrix data
  - ✅ Add special metadata for sparse matrices
  - ⏳ Create efficient visualization techniques for sparse data
  - ⏳ Add UI indicators for sparse vs. dense matrices

### 3. Large Dataset Performance (Status: ⏳ PLANNED)
- **Challenge**: Single-cell datasets can be very large, causing performance issues in the browser.
- **Solution**:
  - ✅ Implement lazy loading with on-demand data fetching
  - ✅ Add chunked loading with pagination
  - ✅ Create client-side caching to minimize redundant requests
  - ⏳ Implement progressive loading with visual feedback
  - ⏳ Add downsampling for very large visualizations
  - ⏳ Use Web Workers for heavy data processing

### 4. Multi-Dimensional Data Selection (Status: ⏳ PLANNED)
- **Challenge**: Users need intuitive ways to select data from multiple dimensions and sources.
- **Solution**:
  - ⏳ Create hierarchical data source selector
  - ⏳ Implement type-ahead search for large lists
  - ⏳ Add visualization previews for data sources
  - ⏳ Create specialized selectors for different data types
  - ⏳ Implement "favorites" for commonly used data paths

### 5. Cross-Dataset Compatibility (Status: ⏳ PLANNED)
- **Challenge**: Sessions created with one dataset should work with similar datasets.
- **Solution**:
  - ⏳ Create metadata comparison to identify compatible components
  - ⏳ Implement graceful fallbacks for missing data
  - ⏳ Add clear error reporting for incompatible components
  - ⏳ Create migration tools for session adaptation

### 6. Data Directory Path Handling (Status: ✅ COMPLETE)
- **Challenge**: The server has a configured data directory, but client-side code doesn't know this path.
- **Solution**:
  - ✅ Add data_dir information to server status/config endpoint
  - ✅ Make client fetch server configuration at startup 
  - ✅ Use configured data directory in dataset browsing
  - ✅ Handle relative paths correctly

## Feature Requests Implementation

### 1. Gene/Cell Focus Tracking (Status: ✅ COMPLETE)
- ✅ Implement focused gene and cell in dataManager
- ✅ Create event system for focus changes
- ✅ Add persistent header with focused gene/cell display
- ✅ Create searchable dropdowns for gene/cell selection
- ✅ Implement click-to-focus in plots and tables
- ✅ Add visual highlighting for focused elements

### 2. Taxonomy Information (Status: ✅ COMPLETE)
- ✅ Add taxonomyId and species tracking in dataManager
- ✅ Create UI for taxonomy selection
- ✅ Implement StringDB integration with taxonomy
- ✅ Add preset taxonomy options with autocomplete

### 3. Advanced Plot Configuration (Status: ⏳ PLANNED)
- ⏳ Create axis selection from any data source
- ⏳ Implement color mapping with range selection
- ⏳ Add option to filter or clip out-of-range values
- ⏳ Create 3D mode with axis scaling controls
- ⏳ Implement custom hover info with multi-field support
- ⏳ Add support for categorical colors from .uns

### 4. Gene/Cell Selection Sets (Status: ⚠️ PARTIALLY IMPLEMENTED)
- ✅ Add selection set tracking in dataManager
- ✅ Implement client-side filtering with selections
- ⏳ Create DataTables with search builder
- ⏳ Add UI for set operations
- ⏳ Implement StringDB integration for gene sets
- ⏳ Create export/import functionality for sets

### 5. Panel System (Status: ✅ COMPLETE)
- ✅ Implement flexible grid-based layout
- ✅ Add panel creation, splitting, and merging
- ✅ Replace automatic UMAP panel with user-driven panel selection
- ✅ Create multiple panel types (plots, tables, metadata)
- ✅ Add panel-specific toolbars and settings
- ✅ Implement panel configuration UI 
- ✅ Create full-screen option for individual panels

### 6. Session Management (Status: ✅ COMPLETE)
- ✅ Implement complete state serialization
- ✅ Add local storage and file-based saving
- ✅ Create auto-saving with recovery options
- ✅ Add UI for session operations
- ⏳ Create URL parameter encoding for sharing
- ⏳ Implement cross-dataset compatibility

### 7. Dataset Browsing (Status: ✅ COMPLETE)
- ✅ Implement directory scanning for zarr datasets
- ✅ Add symlink support for linked datasets
- ✅ Create UI for browsing and selecting datasets
- ✅ Fix server data directory path handling
- ✅ Implement refresh functionality
- ✅ Add clear dataset information display

### 8. Remote Dataset Access (Status: ⚠️ PARTIALLY IMPLEMENTED)
- ✅ Add support for dataset_path parameter in all endpoints
- ⚠️ Implement S3 storage backend
- ⚠️ Add HTTP/HTTPS storage backend
- ⏳ Create credential handling for private storage
- ⏳ Implement caching for remote datasets

## Implementation Priorities

1. **Core Functionality (HIGHEST PRIORITY)**
   - ✅ Stateless server architecture with dataset_path parameter
   - ✅ Dataset browsing focused interface
   - ✅ Gene/cell focus tracking mechanism
   - ⚠️ Basic plot panel implementation with plotly

2. **Data Visualization (HIGH PRIORITY)**
   - ⏳ Complete axis selection mechanism
   - ⏳ Color mapping for continuous and categorical data
   - ⏳ Interactive plot functionality
   - ⏳ Hover information customization

3. **Data Selection (MEDIUM PRIORITY)**
   - ⏳ DataTables implementation with search builder
   - ⏳ Table column customization
   - ⏳ Set creation and management
   - ⏳ Export functionality

4. **Session Management (MEDIUM PRIORITY)**
   - ✅ Session save/restore mechanism
   - ✅ URL-based state sharing
   - ⏳ Cross-dataset compatibility

5. **Advanced Features (LOWER PRIORITY)**
   - ⏳ Remote dataset access
   - ⏳ StringDB integration
   - ⏳ Custom visualization presets

## Testing Strategy

### 1. Backend Testing (Status: ✅ MOSTLY COMPLETE)
- ✅ Unit tests for server components
- ✅ Integration tests for API endpoints
- ✅ Testing with real datasets (aging.zarr)
- ✅ Test cases for complex data types
- ⏳ Performance testing for large datasets

### 2. Frontend Testing (Status: ⚠️ IN PROGRESS)
- ⚠️ Unit tests for JavaScript modules
- ⏳ Component tests for UI elements
- ⏳ Integration tests for interactive features
- ⏳ End-to-end testing with real workflows
- ⏳ Browser compatibility testing

### 3. Test Automation (Status: ⏳ PLANNED)
- ✅ Test runner script for backend tests
- ⏳ Automated browser testing with Puppeteer/Playwright
- ⏳ Continuous integration setup
- ⏳ Screenshot-based visual regression testing

## Development Guidelines

1. **Code Organization**
   - Modular design with clear separation of concerns
   - Consistent naming conventions
   - Comprehensive documentation
   - Event-based communication between components

2. **Performance Considerations**
   - Lazy loading for large datasets
   - Client-side caching
   - Throttling/debouncing for interactive elements
   - Progressive rendering for large visualizations

3. **Error Handling**
   - Comprehensive error reporting
   - Graceful degradation
   - Clear user feedback
   - Logging for diagnostics

4. **Accessibility**
   - Keyboard shortcuts
   - Screen reader compatibility
   - Color contrast for visual elements
   - Responsive design for different screen sizes