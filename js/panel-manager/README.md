# Panel Manager Modules

This directory contains the modular implementation of the panel manager functionality. 
The modules are organized to make the codebase more maintainable and easier to extend.

## Current Status

The modular implementation is a work in progress. Currently, we are using the original 
monolithic implementation from `panel-manager.js` via the `panel-manager-adapter.js` file,
which provides enhancements and fixes while keeping all the original functionality:

1. **Better Array-Based Matrix Support**:
   - Improved handling of array-based matrices in obsm and varm
   - Support for numeric column indices in obsm and varm matrices
   - Better labeling of array dimensions (e.g., "Dimension 1" instead of "0")

2. **Marker Size and Opacity Fix**:
   - Fixed an issue where changing marker size and opacity settings had no effect
   - Ensures settings are properly applied to all plot traces, including categorical data

## Module Structure

- `index.js` - Main entry point that re-exports all panel manager modules
- `core.js` - Core panel management functionality (panel creation, layout, etc.)
- `data-categories.js` - Data category definitions and field loading 
- `plot-panel.js` - Plot panel implementation (scatter plots, etc.)
- `cell-table-panel.js` - Cell table panel implementation
- `gene-table-panel.js` - Gene table panel implementation 
- `gene-set-panel.js` - Gene set panel implementation
- `module-loader.js` - Helper for loading modules dynamically

## Usage

For now, the application is using the original `panel-manager.js` file directly. 
We've added a compatibility layer called `panel-manager-adapter.js` that bridges 
between the monolithic and modular approaches.

Applications should use `PanelManagerAdapter` instead of directly accessing `PanelManager`.
This will make the transition to the fully modular version seamless when it's ready.

```javascript
// Instead of:
if (window.PanelManager) {
    PanelManager.createPanel(...);
}

// Use:
if (window.PanelManagerAdapter) {
    PanelManagerAdapter.createPanel(...);
}
```

Alternatively, use the helper from `main.js`:

```javascript
const panelManager = getPanelManager();
if (panelManager) {
    panelManager.createPanel(...);
}
```

## Next Steps

1. Complete the modular implementation of each panel type
2. Test and ensure feature parity with the original implementation
3. Gradually migrate from the monolithic to the modular implementation
4. Update documentation and examples