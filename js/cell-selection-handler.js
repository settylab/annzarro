/**
 * Cell Selection Handler
 * Enhances the cell plots with click handling to update the global focused cell
 */
(function() {
    // Wait for document to be fully loaded
    document.addEventListener('DOMContentLoaded', function() {
        // Set up a mutation observer to watch for new plot containers
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                    // Look for plot container divs
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === 1 && node.querySelector) { // Element node
                            const plotContainers = node.querySelectorAll('.plot-container');
                            if (plotContainers.length > 0) {
                                setupPlotHandlers(plotContainers);
                            }
                        }
                    });
                }
            });
        });
        
        // Start observing the document
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        // Add handlers to existing plot containers
        const existingPlots = document.querySelectorAll('.plot-container');
        if (existingPlots.length > 0) {
            setupPlotHandlers(existingPlots);
        }
    });
    
    /**
     * Set up click handlers for plot containers
     * @param {NodeList} plotContainers - List of plot container elements
     */
    function setupPlotHandlers(plotContainers) {
        plotContainers.forEach(function(container) {
            // Skip already processed containers
            if (container.dataset.clickHandlerInitialized) return;
            
            // Mark as processed
            container.dataset.clickHandlerInitialized = 'true';
            
            // Listen for Plotly click events
            container.addEventListener('plotly_click', function(e) {
                const event = e.detail || e;
                
                // Check if we have valid points data
                if (!event || !event.points || event.points.length === 0) return;
                
                const point = event.points[0];
                const pointIndex = point.pointIndex;
                const pointNumber = point.pointNumber;
                const curveNumber = point.curveNumber;
                
                console.log(`Plot clicked: index=${pointIndex}, pointNumber=${pointNumber}, curve=${curveNumber}`);
                
                // Try to get the cell ID from custom data if available
                let cellId = null;
                
                // First try customdata if available in the point
                if (point.customdata) {
                    cellId = point.customdata;
                }
                
                // Next try to use the text property if available
                if (!cellId && point.text) {
                    // Extract cell ID from hover text if possible
                    const textParts = point.text.split('<br>');
                    for (const part of textParts) {
                        if (part.includes('Cell:')) {
                            cellId = part.split('Cell:')[1].trim();
                            break;
                        }
                    }
                }
                
                // Finally, try to get cell ID from the DataManager using the index
                // This might be the most reliable method if the index corresponds to the cell index
                if (!cellId && window.DataManager && window.DataManager.getCells) {
                    const cells = window.DataManager.getCells();
                    if (cells && cells[pointIndex]) {
                        cellId = cells[pointIndex];
                    }
                }
                
                // If we found a cell ID, update the focused cell
                if (cellId && window.DataManager && window.DataManager.setFocusedCell) {
                    console.log(`Setting focused cell to: ${cellId}`);
                    window.DataManager.setFocusedCell(cellId);
                    
                    // Also update the focused cell selector in the UI if it exists
                    const focusedCellSelect = document.getElementById('focused-cell');
                    if (focusedCellSelect) {
                        focusedCellSelect.value = cellId;
                        
                        // Trigger change event for Select2 if it's being used
                        if (window.$ && $.fn.select2) {
                            $(focusedCellSelect).trigger('change');
                        }
                    }
                }
            });
        });
    }
})();