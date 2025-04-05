# Frontend-Backend Interaction in Annzarro

This document explains how the frontend JavaScript modules interact with the backend API in Annzarro, providing a reference for developers.

## Architecture Overview

The frontend of Annzarro follows a modular architecture with these key components:

1. **DataManager**: Central module for data access and state management
2. **PanelManager**: Handles UI panels and their layout
3. **PlotManager**: Creates and manages visualization plots

The interaction with the backend API primarily happens through the **DataManager** module, which provides data access functions to other components.

## DataManager

### Core Responsibilities

- Load and cache dataset metadata
- Fetch data for visualizations (coordinates, annotations, expressions)
- Maintain application state (focused genes/cells, data selections)
- Handle data transformations and caching

### Key API Interaction Methods

#### Loading Dataset Information

```javascript
async function loadDataset(path) {
    const response = await fetch(`/api/v1/data/dataset_structure?dataset_path=${encodeURIComponent(path)}`);
    const structureInfo = await response.json();
    
    _activeDataset = path;
    _datasetInfo = structureInfo;
    _datasetRegistry[path] = structureInfo;
    
    // Cache management and event dispatching
    clearCache();
    document.dispatchEvent(new CustomEvent('dataLoaded', { 
        detail: { 
            datasetPath: path,
            info: _datasetInfo
        } 
    }));
}
```

#### Loading Matrix Data (X, layers)

```javascript
async function loadX(rowIndices, colIndices) {
    // Check cache first
    const cacheKey = `X_${rowIndices.join(',')}_${colIndices.join(',')}`;
    if (_dataCache[cacheKey]) {
        return _dataCache[cacheKey];
    }
    
    const params = new URLSearchParams({
        dataset_path: _activeDataset,
        rows: rowIndices.join(','),
        cols: colIndices.join(',')
    });
    
    const response = await fetch(`/api/v1/data/X?${params}`);
    const result = await response.json();
    
    // Cache the result
    _dataCache[cacheKey] = result.data;
    
    return result.data;
}
```

#### Loading Observation Annotations (obs)

```javascript
async function loadObs(rowIndices = [], columns = null) {
    // Cache key construction
    const columnsKey = columns ? columns.join(',') : 'all';
    const rowKey = rowIndices && rowIndices.length > 0 ? rowIndices.join(',') : 'all';
    const cacheKey = `obs_${rowKey}_${columnsKey}`;
    
    if (_dataCache[cacheKey]) {
        return _dataCache[cacheKey];
    }
    
    // Create parameters based on backend API expectations
    const params = new URLSearchParams({
        dataset_path: _activeDataset,
        max_cells: 100000  // Important: Set high limit to ensure all requested data is returned
    });
    
    if (rowIndices && rowIndices.length > 0) {
        params.append('rows', rowIndices.join(','));
    }
    
    if (columns) {
        params.append('columns', columns.join(','));
    }
    
    const response = await fetch(`/api/v1/data/obs?${params}`);
    const result = await response.json();
    
    _dataCache[cacheKey] = result.data;
    return result.data;
}
```

#### Loading Embeddings (obsm)

```javascript
async function loadObsm(key, rowIndices, colIndices, columnName = null) {
    // Create cache key
    const rowIndicesStr = rowIndices ? rowIndices.join(',') : 'null';
    const colIndicesStr = colIndices ? colIndices.join(',') : 'null';
    const cacheKey = `obsm_${key}_${rowIndicesStr}_${colIndicesStr}_${columnName || ''}`;
    
    if (_dataCache[cacheKey]) {
        return _dataCache[cacheKey];
    }
    
    const params = new URLSearchParams({
        dataset_path: _activeDataset
    });
    
    // Only add non-null parameters
    if (rowIndices) {
        params.append('rows', rowIndices.join(','));
    }
    
    if (colIndices) {
        params.append('cols', colIndices.join(','));
    }
    
    // Add column name for dataframe-encoded matrices
    if (columnName) {
        params.append('column_name', columnName);
    }
    
    const response = await fetch(`/api/v1/data/obsm/${encodeURIComponent(key)}?${params}`);
    const result = await response.json();
    
    _dataCache[cacheKey] = result.data;
    return result.data;
}
```

## Critical Implementation Details

### Parameter Handling

The backend expects specific parameter formats:

1. **`max_cells` parameter**: This is critical for the `loadObs` function. The backend expects this parameter rather than `fetch_all` for limiting cell data.

```javascript
// CORRECT implementation
const params = new URLSearchParams({
    dataset_path: dataset,
    max_cells: 100000  // Set high limit to ensure all data is returned
});

// INCORRECT implementation that would fail
const params = new URLSearchParams({
    dataset_path: dataset,
    fetch_all: 'true'  // This parameter is not recognized by the backend
});
```

2. **Column types in obs data**: When loading observation data, especially categorical data like 'Age', the type must be explicitly set to 'column':

```javascript
// In panel-manager.js when applying axis selection:
if (categorySelect && categorySelect.value === 'obs') {
    // This fixes the issue with 'Age' loading
    console.log(`Detected obs selection, ensuring type is set to 'column'`);
    fieldInfo.type = 'column';
}
```

### Data Flow for Plot Updates

When a user selects a new data field for a plot axis or coloring:

1. User clicks a data field in the dropdown menu
2. PanelManager captures this selection and creates a field info object:
   ```javascript
   const fieldInfo = {
       key: "age",
       type: "column",
       label: "Age"
   };
   ```

3. PanelManager calls `applyAxisSelection` or `applyColorSelection` with this info
4. These functions update the panel configuration and call `PlotManager.updatePlot`
5. PlotManager loads the necessary data via DataManager
6. DataManager makes the appropriate API calls to get the data
7. PlotManager renders the updated visualization

### Error Handling and Debugging

The frontend implements multiple levels of error handling:

1. **API call errors**: Try/catch blocks with specific error messages
2. **Data validation**: Checks for null/undefined values and array lengths
3. **Fallback strategies**: Alternative API calls when primary methods fail
4. **Detailed logging**: Extensive console.log statements for debugging
5. **Visual error feedback**: User-friendly error messages in the UI

Example from PlotManager:

```javascript
try {
    // API call and data processing
} catch (error) {
    console.error('Error creating scatter plot:', error);
    console.error('Error stack trace:', error.stack);
    
    element.innerHTML = `
        <div class="alert alert-danger">
            <h5>Error Creating Plot</h5>
            <p>${error.message}</p>
            <div class="mt-3">
                <strong>Troubleshooting:</strong>
                <ul>
                    <li>Check if the dataset contains embedding data (UMAP, tSNE, PCA)</li>
                    <li>Verify that 'obsm' section exists and contains embedding matrices</li>
                    <li>Check browser console for detailed error logs</li>
                </ul>
            </div>
        </div>
    `;
}
```

## Bootstrap Dropdown Handling

The application uses Bootstrap for UI components, including dropdowns for axis selection. A key implementation detail is allowing Bootstrap to naturally close dropdowns:

```javascript
// Apply selection first - important to update data before closing
applyAxisSelection(panelId, axis, fieldInfo);

// Let the dropdown close naturally via Bootstrap's built-in behavior
// No need to call hide() manually
```

Previously, dropdowns were being manually closed before the data update completed, causing UI issues:

```javascript
// INCORRECT implementation - causes issues with updating plots
$(dropdownElement).dropdown('hide');  // Closing before the update completes
applyAxisSelection(panelId, axis, fieldInfo);
```

## CSS Considerations

The application includes specific CSS for dropdown menus to ensure proper visibility:

```css
/* Axis selection dropdown */
.axis-dropdown {
    max-width: 350px;
    width: 350px;
    max-height: 80vh;
    overflow-y: auto;
    z-index: 1050 !important;  /* Ensure proper stacking order */
}
```

## Performance Optimizations

1. **Data Caching**: All API responses are cached using a simple key-value store
2. **Parameter Limiting**: Only required data is requested from the backend
3. **Batch Loading**: Related data (like gene/cell names) is loaded in parallel
4. **Field Filtering**: UI shows only fields applicable to the current entity type (cell/gene)

## Common Issues and Solutions

1. **Plot not updating when selecting new data**:
   - Ensure the `max_cells` parameter is provided in `loadObs` function
   - Let Bootstrap handle dropdown closing naturally
   - Verify the `PlotManager.updatePlot` function is being called with the correct panel ID

2. **Data not loading correctly**:
   - Check that field types are correctly set (especially for 'obs' data)
   - Verify API parameters match what the backend expects
   - Check the browser console for detailed error messages

3. **Panel ID resolution issues**:
   - The application uses multiple formats for panel IDs (`panel-0`, `plot-0`, etc.)
   - Normalize IDs when looking up panels or plots:
   ```javascript
   const normalizedPlotId = plotId.includes('plot-') ? plotId : `plot-${plotId.replace('panel-', '')}`;
   ```

## Best Practices

1. **Always use the correct parameter names** that the backend expects
2. **Include detailed error logging** for troubleshooting
3. **Use data type verification** before rendering visualizations
4. **Implement fallbacks** for missing or corrupt data
5. **Cache API responses** to minimize server load
6. **Let UI frameworks handle their own events** (like dropdown closing)

## Example: Complete Plot Update Flow

1. User selects "Age" from the observation (obs) data dropdown for the Y-axis

2. PanelManager captures this selection:
   ```javascript
   const fieldInfo = {
       key: "age",
       type: "column",
       label: "Age"
   };
   ```

3. Panel configuration is updated:
   ```javascript
   panel.config.yAxis = {
       path: "obs/age",
       label: "Age"
   };
   ```

4. PlotManager is notified to update the plot:
   ```javascript
   PlotManager.updatePlot(plotId, panel.config);
   ```

5. PlotManager loads the necessary data:
   ```javascript
   // For X-axis (e.g., UMAP_1)
   const xData = await loadAxisData("obsm/X_umap", 0);
   
   // For Y-axis (Age)
   const yData = await loadAxisData("obs/age", null);
   ```

6. The `loadAxisData` function calls `DataManager.loadObs`:
   ```javascript
   const obsData = await DataManager.loadObs([], ["age"], true);
   ```

7. DataManager makes the API request with proper parameters:
   ```javascript
   const params = new URLSearchParams({
       dataset_path: _activeDataset,
       columns: "age",
       max_cells: 100000
   });
   
   const response = await fetch(`/api/v1/data/obs?${params}`);
   ```

8. The backend returns the age data, which is used to update the plot