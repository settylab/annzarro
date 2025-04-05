# Annzarro Implementation Fixes

This document summarizes the key issues in the frontend-backend interaction and the fixes implemented to resolve them.

## Primary Issues and Fixes

### Issue 1: Plot Not Updating on Data Selection

**Problem**: When selecting new data for x-axis, y-axis, or coloring, the plot would not update. The dropdown would close but no changes would be visible in the plot.

**Root Causes**:
1. **Incorrect API Parameters**: Frontend was using `fetch_all: 'true'` but the backend expected `max_cells` parameter
2. **Premature Dropdown Closing**: Dropdowns were being manually closed before data loading completed
3. **Field Type Inconsistency**: Certain observation columns needed explicit type setting to 'column'

**Fixes**:

1. **Updated API Parameters**:
   ```javascript
   // Before - INCORRECT
   const params = new URLSearchParams({
       dataset_path: dataset,
       fetch_all: 'true'
   });
   
   // After - CORRECT
   const params = new URLSearchParams({
       dataset_path: dataset,
       max_cells: 100000
   });
   ```

2. **Fixed Dropdown Handling**:
   ```javascript
   // Before - INCORRECT
   $(dropdownElement).dropdown('hide');  // Manual close before update
   applyAxisSelection(panelId, axis, fieldInfo);
   
   // After - CORRECT
   applyAxisSelection(panelId, axis, fieldInfo);
   // Let the dropdown close naturally via Bootstrap's built-in behavior
   ```

3. **Fixed Field Type Setting**:
   ```javascript
   // Added in panel-manager.js
   if (categorySelect && categorySelect.value === 'obs') {
       // This fixes the issue with 'Age' loading
       console.log(`Detected obs selection, ensuring type is set to 'column'`);
       fieldInfo.type = 'column';
   }
   ```

### Issue 2: Plot ID Resolution

**Problem**: The application uses multiple ID formats for panels and plots, causing lookup failures when updating plots.

**Fix**:
```javascript
// Added normalization logic in plot-manager.js
const normalizedPlotId = plotId.includes('plot-') ? plotId : `plot-${plotId.replace('panel-', '')}`;
console.log(`Looking for plot with ID: ${plotId} (normalized: ${normalizedPlotId})`);

// Try multiple plot ID formats
let plot = _plots[plotId] || _plots[normalizedPlotId];
```

### Issue 3: CSS for Dropdowns

**Problem**: Dropdown menus for axis selection had visibility issues.

**Fix**:
```css
/* Added in styles.css */
.axis-dropdown {
    max-width: 350px;
    width: 350px;
    max-height: 80vh;
    overflow-y: auto;
    z-index: 1050 !important;
}
```

### Issue 4: Error Handling and Debugging

**Problem**: Limited error information made debugging difficult.

**Fix**:
```javascript
// Added detailed error handling in plot-manager.js
try {
    // API call and data processing
} catch (error) {
    console.error('Error creating scatter plot:', error);
    console.error('Error stack trace:', error.stack);
    
    // Improved error display
    element.innerHTML = `
        <div class="alert alert-danger">
            <h5>Error Creating Plot</h5>
            <p>${error.message}</p>
            <div class="mt-3">
                <strong>Troubleshooting:</strong>
                <ul>
                    <li>Check if the dataset contains embedding data</li>
                    <li>Verify that 'obsm' section exists</li>
                    <li>Check browser console for detailed error logs</li>
                </ul>
            </div>
        </div>
    `;
}
```

## Key Backend API Insights

### Critical Parameters

1. **Cell Data Limitation**:
   - `/api/v1/data/obs` uses `max_cells` (not `fetch_all`)
   - Default server limit is 10,000 cells

2. **Column Selection**:
   - Always specify `columns` parameter when possible to reduce data transfer

3. **Matrix Data Access**:
   - For non-embedding data, use proper path construction (e.g., `obs/age`)
   - For embedding data (like UMAP), specify dimension index if needed

### API Structure

The backend provides these key endpoints:

1. **Dataset Information**:
   - `/api/v1/data/dataset_structure` for complete dataset structure
   - `/api/v1/data/info` for basic dataset info

2. **Data Access**:
   - `/api/v1/data/X` for expression matrix
   - `/api/v1/data/obs` for cell annotations
   - `/api/v1/data/var` for gene annotations
   - `/api/v1/data/obsm/{key}` for cell embeddings
   - `/api/v1/data/layer/{key}` for alternative expression layers

3. **Metadata Access**:
   - `/api/v1/data/genes` for gene names
   - `/api/v1/data/cells` for cell names

## Implementation Recommendations

1. **Always Use Proper Parameters**:
   - Match backend expectations exactly
   - Avoid deprecated parameters

2. **Let UI Frameworks Work Naturally**:
   - Don't manually close dropdowns
   - Let Bootstrap handle its own event flow

3. **Implement Robust Error Handling**:
   - Log detailed error information
   - Provide user-friendly error messages
   - Include troubleshooting guidance in error displays

4. **Implement Effective Caching**:
   - Cache API responses with appropriate keys
   - Clear cache when changing datasets

5. **Use Normalized IDs**:
   - When looking up panels or plots, normalize ID formats
   - Try alternative formats as fallbacks

## Documentation

Two complementary documentation files have been created:

1. `BACKEND_API_REFERENCE.md` - Comprehensive guide to all backend API endpoints
2. `FRONTEND_BACKEND_INTERACTION.md` - Detailed explanation of frontend interaction patterns

These documents should be consulted when implementing new features or debugging existing functionality.

## Backend API Fixes (2025-04-04)

Additional backend issues were discovered and fixed when testing with the aging.zarr dataset:

### 1. Categorical Data Handling in AnnData Zarr Format

**Issue**: The API couldn't handle categorical data in the obs and var objects of AnnData zarr format.

**Root cause**: In AnnData's zarr format, categorical variables are stored as groups with 'codes' and 'categories' arrays:
- 'codes': Integer indices into the categories array
- 'categories': The actual category values (strings)

When trying to access these values directly with array-like syntax, the code would fail because it didn't account for this special structure.

**Solution**:
- Added a new helper method `_get_categorical_values()` that:
  - Detects when a group has categorical encoding
  - Properly maps category codes to their string values
  - Returns the mapped data
- Updated `get_obs()` and `get_var()` methods to use this helper
- Filter out the special '_index' column which is used internally

### 2. Parameter Passing in API Routes

**Issue**: The parameters passed to the zarr_reader from the API routes were being passed positionally instead of by name, causing confusion.

**Root cause**: The route handlers in data_routes.py were calling the zarr_reader methods as:
```python
data = zarr_reader.get_obs(dataset_path, row_indices, column_names)
```

This positional argument passing was incorrect, as the method expects parameters in a different order.

**Solution**:
- Changed all calls to use explicit named parameters:
```python
data = zarr_reader.get_obs(dataset_path=dataset_path, indices=row_indices, column_names=column_names)
```
- Updated documentation to highlight the importance of using named parameters

These fixes ensure proper loading of categorical data from AnnData zarr files, which is critical for correctly visualizing cell metadata like cell types, conditions, and other categorical annotations.