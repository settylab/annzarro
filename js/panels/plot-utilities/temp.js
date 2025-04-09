// Set up ResizeObserver to handle plot container resizing when the panel is resized
if (_plotContainer && window.ResizeObserver) {
  _resizeObserver = new ResizeObserver((entries) => {
      // Only proceed if we have a valid plot
      if (!_plotContainer || !_plot) return;
      
      for (const entry of entries) {
          if (entry.target === _plotContainer) {
              // Trigger Plotly relayout to properly resize the plot
              // Use a small delay to avoid excessive relayouts during continuous resize
              if (_resizeTimeout) clearTimeout(_resizeTimeout);
              _resizeTimeout = setTimeout(() => {
                  Plotly.relayout(_plotContainer, {
                      'autosize': true
                  });
              }, 100); // 100ms debounce
          }
      }
  });
  
  // Start observing the plot container
  _resizeObserver.observe(_plotContainer);
  console.log(`ResizeObserver set up for plot container ${_id}`);
}

_container.querySelectorAll('.axis-type-select').forEach(select => {
    select.addEventListener('change', async (e) => {
      const axis = e.target.dataset.axis;
      const type = e.target.value;
      const keySelect = _container.querySelector(`.axis-key-select[data-axis="${axis}"]`);
      const columnSelect = _container.querySelector(`.axis-column-select[data-axis="${axis}"]`);
  
      if (!keySelect || !columnSelect) {
        console.error(`Missing select elements for axis ${axis}`);
        return;
      }
  
      _settings[axis].type = type;
  
      const datasetStructure = await DataManager.getDatasetStructure();
      if (!datasetStructure) {
        console.error('No dataset structure available');
        return;
      }
  
      // Update key options
      populateKeySelector(_settings[axis], keySelect, axis, _plotType, datasetStructure);
  
      if (_settings[axis].type === 'none' && axis === 'color') {
        console.log('Color setting changed to "none", triggering optimized update');
        _loadColorDataAndUpdatePlot();
        return;
      }
  
      // Reset key to first valid value
      const keyValues = Array.from(keySelect.options).map(opt => opt.value);
      _settings[axis].key = keyValues[0] || '';
      keySelect.value = _settings[axis].key;
  
      // Update column options
      populateColumnSelector(_settings[axis], columnSelect, axis, _plotType, datasetStructure);
  
      const colValues = Array.from(columnSelect.options).map(opt => opt.value);
      const currentValue = _settings[axis].column;
      if (!colValues.includes(currentValue)) {
        const defaultIndex = { x: 0, y: 1, z: 2 }[axis];
        const fallback = colValues[defaultIndex] || colValues[0] || '';
        columnSelect.value = fallback;
        _settings[axis].column = fallback;
        console.log(`Updated ${axis} column to default: ${fallback}`);
      } else {
        columnSelect.value = currentValue;
      }
  
      // Trigger the appropriate plot update
      if (axis === 'color') {
        _loadColorDataAndUpdatePlot();
      } else if (['x', 'y', 'z'].includes(axis)) {
        try {
          const axisData = await _loadAxisData(axis);
          if (axisData?.values) {
            _data[axis] = axisData;
            _updatePlotElements({ [`${axis}Axis`]: true, layout: true });
          } else {
            _loadDataAndCreatePlot();
          }
        } catch (err) {
          console.warn(`Failed to update ${axis} axis, reloading plot.`);
          _loadDataAndCreatePlot();
        }
      } else {
        _loadDataAndCreatePlot();
      }
    });
  });

// Axis key selectors
_container.querySelectorAll('.axis-key-select').forEach(select => {
    select.addEventListener('change', async (e) => {
      const axis = e.target.dataset.axis;
      const key = e.target.value;
      const type = _container.querySelector(`.axis-type-select[data-axis="${axis}"]`).value;
      const columnSelect = _container.querySelector(`.axis-column-select[data-axis="${axis}"]`);
  
      if (!columnSelect) {
        console.error(`Column select element not found for axis ${axis}`);
        return;
      }
  
      _settings[axis].key = key;
  
      const datasetStructure = await DataManager.getDatasetStructure();
      if (!datasetStructure) {
        console.error('No dataset structure available');
        return;
      }
  
      // Update columns for the new key
      populateColumnSelector(_settings[axis], columnSelect, axis, _plotType, datasetStructure);
  
      const colValues = Array.from(columnSelect.options).map(opt => opt.value);
      const currentValue = _settings[axis].column;
  
      if (!colValues.includes(currentValue)) {
        const axisDefault = { x: 0, y: 1, z: 2 }[axis];
        const fallback = colValues[axisDefault] || colValues[0] || '';
        columnSelect.value = fallback;
        _settings[axis].column = fallback;
        console.log(`Auto-selected column ${fallback} for axis ${axis}`);
      } else {
        columnSelect.value = currentValue;
      }
  
      // Trigger appropriate updates
      if (axis === 'color' && _plot) {
        console.log('Color key changed, using optimized update');
        _loadColorDataAndUpdatePlot();
      } else if (['x', 'y', 'z'].includes(axis)) {
        try {
          const axisData = await _loadAxisData(axis);
          if (axisData?.values) {
            _data[axis] = axisData;
            _updatePlotElements({ [`${axis}Axis`]: true, layout: true });
          } else {
            _loadDataAndCreatePlot();
          }
        } catch (err) {
          console.warn(`Error updating ${axis} axis after key change`);
          _loadDataAndCreatePlot();
        }
      } else {
        _loadDataAndCreatePlot();
      }
    });
  });

// Axis column selectors
_container.querySelectorAll('.axis-column-select').forEach(select => {
    select.addEventListener('change', (e) => {
        const axis = e.target.dataset.axis;
        _settings[axis].column = e.target.value;
        
        if (axis === 'color' && _plot) {
            // Color column changes can use optimized update
            console.log('Color column changed, using optimized update');
            _loadColorDataAndUpdatePlot();
        } else if (axis === 'z') {
            console.log('Z-axis column changed, updating plot');
            _loadAxisData('z').then(zData => {
                if (zData && zData.values) {
                    _data.z = zData;
                    _updatePlotElements({ zAxis: true });
                } else {
                    _loadDataAndCreatePlot();
                }
            }).catch(() => _loadDataAndCreatePlot());
        } else if (axis === 'x' || axis === 'y') {
            console.log(`Position axis (${axis}) column changed, updating plot`);
            _loadAxisData(axis).then(axisData => {
                if (axisData && axisData.values) {
                    _data[axis] = axisData;
                    const updateObj = {};
                    updateObj[axis + 'Axis'] = true;
                    _updatePlotElements(updateObj);
                } else {
                    _loadDataAndCreatePlot();
                }
            }).catch(() => _loadDataAndCreatePlot());
        } else {
            _loadDataAndCreatePlot();
        }
    });
});