# Frontend Architecture

## Overview

The Annzarro frontend is a modern browser-based application built with pure JavaScript, designed to provide interactive visualization and exploration of single-cell data stored in AnnData zarr format. It follows a component-based architecture with shared state management and event-based communication.

## Core Components

### 1. Module System

The frontend is organized into modules, each responsible for specific functionality:

- **data-manager.js**: Core data handling for AnnData, including:
  - Loading and caching data
  - Retrieving data from various AnnData components
  - Managing focused genes/cells and selections
  - Supporting dataframe-encoded matrices in obsm/varm

- **ui-manager.js**: Layout management and panel system:
  - Configurable grid layout
  - Panel creation, resizing, and management
  - Component registration and initialization
  - Event routing between UI components

- **plot-manager.js**: Visualization capabilities using plotly.js:
  - Plot creation and configuration
  - Axis and color mapping management
  - Interactive selection and filtering
  - 2D and 3D visualization support

- **table-manager.js**: Tabular data presentation with DataTables:
  - Search builder integration
  - Column customization
  - Set creation and management
  - Export functionality

- **zarr-loader.js**: Lazy loading interface to zarr data:
  - Stateless API communication
  - Caching of frequently accessed data
  - Progressive loading for large matrices
  - Support for multiple storage backends

### 2. State Management

The application maintains several key states across components:

- **Dataset Registry**: Collection of loaded datasets with their metadata
- **Active Dataset**: Currently selected dataset for visualization
- **Focused Items**: Currently focused gene and cell
- **Selection Sets**: Sets of selected genes and cells from tables
- **Panel Configurations**: Settings for each visualization panel
- **Session State**: Complete serializable application state

### 3. Event System

Components communicate through a central event system:

- **dataLoaded**: Triggered when a dataset is loaded
- **datasetChanged**: Triggered when switching between datasets
- **focusChanged**: Triggered when focused gene or cell changes
- **selectionChanged**: Triggered when gene or cell selections change
- **panelConfigChanged**: Triggered when a panel's configuration is updated

## User Interface Structure

### 1. Global Header

Persistent header with:
- Dataset selector and information
- Focused gene dropdown (searchable)
- Focused cell dropdown (searchable)
- Taxonomy/species selector
- Session management controls
- Global settings

### 2. Panel System

Dynamic grid-based layout with:
- Resizable and rearrangeable panels
- Multiple panel types (plot, table, metadata)
- Panel-specific toolbars and controls
- Support for splitting and merging panels

### 3. Plot Panels

Interactive data visualization with:
- Hierarchical data selectors for X/Y/Z axes
- Color mapping controls
- Hover information configuration
- Interactive selection
- Export functionality

### 4. Table Panels

Advanced data tables with:
- Search builder for complex filtering
- Column selection from any AnnData component
- Interactive row selection
- Set management
- Export options

### 5. Metadata Panels

Dataset exploration tools with:
- AnnData structure browser
- Dataset statistics and information
- External resource links
- Documentation and help

## Data Flow

### 1. Data Loading

1. User selects a dataset from available options
2. Frontend requests dataset metadata from server
3. Basic structure info is loaded and cached
4. UI components are updated with dataset information
5. Initial visualizations are created based on available data

### 2. Data Visualization

1. User configures a visualization panel (axes, colors, etc.)
2. Frontend requests specific data chunks from server
3. Data is transformed and prepared for visualization
4. Plot is rendered using plotly.js
5. Interactive elements are attached to the visualization

### 3. Data Selection

1. User interacts with visualizations or tables
2. Selected items are tracked in selection sets
3. Selection events are broadcasted to other components
4. Affected visualizations are updated to reflect selections
5. Table filters are applied based on selections

### 4. Session Management

1. User triggers session save
2. Complete application state is serialized to JSON
3. State is stored locally or on server
4. Sessions can be loaded, restoring all panels and selections
5. Cross-dataset compatibility is handled with graceful fallbacks

## Dataframe Support

Special attention has been given to supporting dataframe-encoded matrices in obsm/varm:

1. **Discovery**: Dataframe structures are detected during dataset loading
2. **Metadata**: Column information is extracted and made available to UI
3. **Access**: Column-specific data access is provided through:
   - Extended loadObsm/loadVarm methods with column_name parameter
   - Path-based data access for intuitive notation
4. **Visualization**: Specialized visualization options for dataframe data
5. **UI**: Hierarchical selectors for navigating dataframe columns

## Technical Implementation

### 1. JavaScript Module Structure

```
js/
├── data-manager.js      # Core data management
├── ui-manager.js        # Layout and panel management
├── plot-manager.js      # Visualization using plotly
├── table-manager.js     # Tables with DataTables
├── zarr-loader.js       # Zarr data access
├── string-db.js         # StringDB integration
├── utils.js             # Shared utilities
└── main.js              # Application entry point
```

### 2. Dependencies

- **plotly.js**: Interactive data visualization
- **DataTables**: Advanced table functionality with search builder
- **Bootstrap**: Responsive layout and UI components
- **Select2**: Enhanced dropdown menus with search

### 3. Browser Support

- Modern Chromium-based browsers (Chrome, Edge)
- Firefox
- Safari
- Mobile browsers (responsive design)

### 4. Performance Considerations

- Lazy loading for large datasets
- Chunked data requests with pagination
- Client-side caching of frequently accessed data
- Debounced/throttled event handlers for interactive elements
- Asynchronous operations with loading indicators