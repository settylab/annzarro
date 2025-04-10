/**
 * Layout Manager module for AnnZarro
 * Handles layout hierarchy, state management, and restoration
 * 
 * This module manages the hierarchical structure of panels and split containers,
 * providing a clean way to save and restore complex layout structures.
 */

const LayoutManager = (function() {
    /**
     * Recursively builds a hierarchy tree of the layout
     * @param {HTMLElement} element - The current element to process (container or tile)
     * @returns {Object} - A layout node representing this element and its children
     */
    function buildLayoutHierarchy(element) {
        // Base case: element is a tile
        if (element.classList.contains('tile')) {
            const id = element.dataset.tileId;
            return {
                type: 'tile',
                id: id,
                // Capture dimensions
                dimensions: {
                    height: element.style.height || window.getComputedStyle(element).height,
                    width: element.style.width || window.getComputedStyle(element).width
                },
                // Capture state of controls
                controlsVisible: element.querySelector('.plot-controls')?.style.display !== 'none'
            };
        }
        
        // Handle split container
        if (element.classList.contains('split-container')) {
            const direction = element.dataset.splitDirection || 
                             (element.classList.contains('split-horizontal') ? 'horizontal' : 'vertical');
            
            const splitType = element.dataset.splitType || 
                             (direction === 'horizontal' ? 'sideBySide' : 'stacked');
                             
            const panes = element.querySelectorAll('.split-pane');
            
            // Default hierarchy object for split container
            const splitContainer = {
                type: 'split',
                direction: direction,
                splitType: splitType,
                children: []
            };
            
            // Process each pane in the split
            if (panes.length === 2) {
                const pane1 = panes[0];
                const pane2 = panes[1];
                
                // Get flex percentages
                const pane1Percentage = parseInt(pane1.dataset.flexPercentage || '50', 10);
                const pane2Percentage = parseInt(pane2.dataset.flexPercentage || '50', 10);
                
                // Add pane info to the container
                splitContainer.panes = [
                    {
                        percentage: pane1Percentage,
                        controlsVisible: pane1.dataset.controlsVisible === 'true'
                    },
                    {
                        percentage: pane2Percentage,
                        controlsVisible: pane2.dataset.controlsVisible === 'true'
                    }
                ];
                
                // Process children of each pane
                // Pane 1 children
                const pane1Children = pane1.children;
                if (pane1Children.length > 0) {
                    const pane1Child = pane1Children[0]; // Typically a tile or nested split
                    splitContainer.children.push(buildLayoutHierarchy(pane1Child));
                }
                
                // Pane 2 children
                const pane2Children = pane2.children;
                if (pane2Children.length > 0) {
                    const pane2Child = pane2Children[0]; // Typically a tile or nested split
                    splitContainer.children.push(buildLayoutHierarchy(pane2Child));
                }
            }
            
            return splitContainer;
        }
        
        // If not a tile or split container, return null
        return null;
    }
    
    /**
     * Recursively constructs DOM from layout hierarchy
     * @param {Object} node - The layout node to process
     * @param {HTMLElement} parentElement - The parent element to add to
     * @param {Function} createTileElement - Function to create a tile element
     * @param {Function} createPanelInstance - Function to create a panel instance
     * @returns {HTMLElement} - The constructed DOM element
     */
    function rebuildLayoutFromHierarchy(node, parentElement, createTileElement, createPanelInstance) {
        if (!node) return null;
        
        if (node.type === 'tile') {
            // Create tile element
            const tileElement = createTileElement(node.id);
            
            // Set dimensions if available
            if (node.dimensions) {
                if (node.dimensions.height) tileElement.style.height = node.dimensions.height;
                if (node.dimensions.width) tileElement.style.width = node.dimensions.width;
            }
            
            // Add the tile to the parent
            parentElement.appendChild(tileElement);
            
            // Create panel instance using passed callback
            createPanelInstance(node.id, tileElement);
            
            // Set control visibility if specified
            if (node.hasOwnProperty('controlsVisible')) {
                const contentContainer = tileElement.querySelector('.tile-content');
                const plotControls = contentContainer?.querySelector('.plot-controls');
                
                if (plotControls) {
                    plotControls.style.display = node.controlsVisible ? 'flex' : 'none';
                }
            }
            
            return tileElement;
        } else if (node.type === 'split') {
            // Create a split container
            const splitContainer = document.createElement('div');
            
            // Set the right direction and flexDirection
            if (node.splitType === 'stacked' || node.direction === 'vertical') {
                splitContainer.className = 'split-container split-vertical';
                splitContainer.style.flexDirection = 'column';
                splitContainer.dataset.splitType = 'stacked';
            } else {
                splitContainer.className = 'split-container split-horizontal';
                splitContainer.style.flexDirection = 'row';
                splitContainer.dataset.splitType = 'sideBySide';
            }
            
            splitContainer.dataset.splitDirection = node.direction;
            
            // Create the panes and handle
            const firstPane = document.createElement('div');
            firstPane.className = 'split-pane';
            
            const handle = document.createElement('div');
            handle.className = `split-handle ${node.direction === 'vertical' ? 'horizontal' : 'vertical'}`;
            
            const secondPane = document.createElement('div');
            secondPane.className = 'split-pane';
            
            // Set flex percentages if available
            if (node.panes && node.panes.length === 2) {
                const pane1Percentage = node.panes[0].percentage || 50;
                const pane2Percentage = node.panes[1].percentage || 50;
                
                // Set flex to control the relative sizes
                // The key is to set flex-grow only without flex-basis or flex-shrink
                firstPane.style.flex = `${pane1Percentage}`;
                firstPane.dataset.flexPercentage = pane1Percentage;
                
                secondPane.style.flex = `${pane2Percentage}`;
                secondPane.dataset.flexPercentage = pane2Percentage;
                
                // Explicitly set min-width for horizontal splits to ensure they don't shrink too much
                if (node.splitType === 'sideBySide' || node.direction === 'horizontal') {
                    // For side-by-side layout, set explicit percentage widths too
                    firstPane.style.width = `${pane1Percentage}%`;
                    secondPane.style.width = `${pane2Percentage}%`;
                    firstPane.style.minWidth = '100px';
                    secondPane.style.minWidth = '100px';
                }
                
                // Set control visibility state
                if (node.panes[0].hasOwnProperty('controlsVisible')) {
                    firstPane.dataset.controlsVisible = node.panes[0].controlsVisible;
                }
                
                if (node.panes[1].hasOwnProperty('controlsVisible')) {
                    secondPane.dataset.controlsVisible = node.panes[1].controlsVisible;
                }
            } else {
                // Default equal split
                firstPane.style.flex = '1';
                firstPane.dataset.flexPercentage = '50';
                secondPane.style.flex = '1';
                secondPane.dataset.flexPercentage = '50';
                
                // Explicitly set min-width for horizontal splits
                if (node.splitType === 'sideBySide' || node.direction === 'horizontal') {
                    firstPane.style.width = '50%';
                    secondPane.style.width = '50%';
                    firstPane.style.minWidth = '100px';
                    secondPane.style.minWidth = '100px';
                }
            }
            
            // Assemble the split container
            splitContainer.appendChild(firstPane);
            splitContainer.appendChild(handle);
            splitContainer.appendChild(secondPane);
            
            // Add the split container to the parent
            parentElement.appendChild(splitContainer);
            
            // Recursively build children if they exist
            if (node.children && node.children.length > 0) {
                if (node.children[0]) {
                    rebuildLayoutFromHierarchy(node.children[0], firstPane, createTileElement, createPanelInstance);
                }
                
                if (node.children.length > 1 && node.children[1]) {
                    rebuildLayoutFromHierarchy(node.children[1], secondPane, createTileElement, createPanelInstance);
                }
            }
            
            return splitContainer;
        }
        
        return null;
    }
    
    /**
     * Setup resize functionality for a split handle
     * @param {HTMLElement} handle - The resize handle element
     * @param {HTMLElement} firstPane - First pane element
     * @param {HTMLElement} secondPane - Second pane element
     * @param {string} direction - Split direction ('horizontal' or 'vertical')
     */
    function setupResizableHandle(handle, firstPane, secondPane, direction) {
        let startPosition = 0;
        let startTotalSize = 0;
        let startFirstPercentage = 0;
        
        const onMouseDown = (e) => {
            e.preventDefault();
            
            // Store the starting position
            startPosition = direction === 'horizontal' ? e.clientX : e.clientY;
            
            // Get the parent container's total size
            const parentContainer = firstPane.parentElement;
            startTotalSize = direction === 'horizontal' ? 
                parentContainer.offsetWidth : parentContainer.offsetHeight;
            
            // Calculate the first pane's percentage
            const firstPaneSize = direction === 'horizontal' ? 
                firstPane.offsetWidth : firstPane.offsetHeight;
            startFirstPercentage = (firstPaneSize / startTotalSize) * 100;
            
            // Add event listeners for dragging
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            
            // Add dragging class
            handle.classList.add('dragging');
        };
        
        const onMouseMove = (e) => {
            e.preventDefault();
            
            // Calculate the new position
            const currentPosition = direction === 'horizontal' ? e.clientX : e.clientY;
            const delta = currentPosition - startPosition;
            
            // Calculate the delta as a percentage of total size
            const deltaPercentage = (delta / startTotalSize) * 100;
            
            // Calculate new percentages
            const newFirstPercentage = startFirstPercentage + deltaPercentage;
            const newSecondPercentage = 100 - newFirstPercentage;
            
            // Apply new percentages if they're valid (min 10%)
            if (newFirstPercentage > 10 && newSecondPercentage > 10) {
                const ratio = newFirstPercentage / newSecondPercentage;
                
                // For horizontal splits (side-by-side), apply width percentages directly
                if (direction === 'horizontal') {
                    // Set direct percentage width to ensure horizontal splits work correctly
                    firstPane.style.width = `${newFirstPercentage}%`;
                    secondPane.style.width = `${newSecondPercentage}%`;
                    
                    // Keep flex for compatibility but use ratio
                    firstPane.style.flex = `${ratio}`;
                    secondPane.style.flex = '1';
                } else {
                    // For vertical splits, just use flex proportions
                    firstPane.style.flex = `${newFirstPercentage}`;
                    secondPane.style.flex = `${newSecondPercentage}`;
                }
                
                // Store the percentages as data attributes for restoration
                firstPane.dataset.flexPercentage = newFirstPercentage;
                secondPane.dataset.flexPercentage = newSecondPercentage;
                
                // Store the control panel state when resizing
                const firstPaneControls = firstPane.querySelector('.plot-controls');
                const secondPaneControls = secondPane.querySelector('.plot-controls');
                
                if (firstPaneControls) {
                    const isVisible = firstPaneControls.style.display !== 'none';
                    firstPane.dataset.controlsVisible = isVisible;
                }
                
                if (secondPaneControls) {
                    const isVisible = secondPaneControls.style.display !== 'none';
                    secondPane.dataset.controlsVisible = isVisible;
                }
            }
        };
        
        const onMouseUp = () => {
            // Remove event listeners
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            
            // Remove dragging class
            handle.classList.remove('dragging');
        };
        
        // Set up the handle for dragging
        handle.addEventListener('mousedown', onMouseDown);
    }
    
    // Public API
    return {
        buildLayoutHierarchy,
        rebuildLayoutFromHierarchy,
        setupResizableHandle
    };
})();

// Export the module
export { LayoutManager };