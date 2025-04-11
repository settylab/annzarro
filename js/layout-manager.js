/**
 * Layout Manager module for AnnZarro
 * Handles layout hierarchy, state management, and restoration
 * 
 * This module implements a tiling window manager approach where:
 * 1. Panels always use their maximum available space
 * 2. Resizing happens by moving separation lines (handles)
 * 3. Closing a panel removes its divider with no trace
 * 4. The bottom always has a selection tile for adding new panels
 */

const LayoutManager = (function() {
    // Constants
    const MIN_PANE_SIZE_PERCENT = 10;
    const DEFAULT_SPLIT_RATIO = 50;
    const DEFAULT_PANEL_HEIGHT = 500; // Default panel height in pixels
    const MIN_PANEL_HEIGHT = 100; // Minimum panel height in pixels
    
    // Private variables
    let _addTileCallback = null;
    
    /**
     * Initialize the layout manager
     * @param {Function} addTileCallback - Callback to create a selection tile
     */
    function init(addTileCallback) {
        _addTileCallback = addTileCallback;
        
        // Setup the necessary event listeners
        window.addEventListener('resize', _onWindowResize);
        
        console.log('Layout Manager initialized');
    }
    
    /**
     * Handle window resize events
     * @private
     */
    function _onWindowResize() {
        // Force all split containers to recalculate dimensions
        document.querySelectorAll('.split-container').forEach(container => {
            _refreshSplitContainer(container);
        });
    }
    
    /**
     * Refresh a split container's dimensions after size changes
     * @param {HTMLElement} container - The split container to refresh
     * @private
     */
    function _refreshSplitContainer(container) {
        const panes = container.querySelectorAll('.split-pane');
        if (panes.length !== 2) return;
        
        const direction = container.dataset.splitDirection;
        const isHorizontal = direction === 'horizontal';
        
        // Get percentages from data attributes
        const pane1 = panes[0];
        const pane2 = panes[1];
        
        const pane1Percent = parseFloat(pane1.dataset.flexPercentage || '50');
        const pane2Percent = parseFloat(pane2.dataset.flexPercentage || '50');
        
        // Apply correct flex and dimensions
        pane1.style.flex = `${pane1Percent}`;
        pane2.style.flex = `${pane2Percent}`;
    }
    
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
                controlsVisible: element.querySelector('.plot-controls')?.style.display !== 'none'
            };
        }
        
        // Base case: element is a tile selector
        if (element.classList.contains('tile-selector')) {
            return {
                type: 'selector'
            };
        }
        
        // Handle split container
        if (element.classList.contains('split-container')) {
            const direction = element.dataset.splitDirection || 'horizontal';
            const panes = element.querySelectorAll('.split-pane');
            
            // Default hierarchy object for split container
            const splitContainer = {
                type: 'split',
                direction: direction,
                children: []
            };
            
            // Process each pane in the split
            if (panes.length === 2) {
                const pane1 = panes[0];
                const pane2 = panes[1];
                
                // Get flex percentages
                const pane1Percentage = parseFloat(pane1.dataset.flexPercentage || '50');
                const pane2Percentage = parseFloat(pane2.dataset.flexPercentage || '50');
                
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
        
        // If not a recognized element, return null
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
            
            // Add the tile to the parent
            parentElement.appendChild(tileElement);
            
            // Create panel instance using passed callback
            createPanelInstance(node.id, tileElement);
            
            // Set control visibility if specified
            if ('controlsVisible' in node) {
                const contentContainer = tileElement.querySelector('.tile-content');
                const plotControls = contentContainer?.querySelector('.plot-controls');
                
                if (plotControls) {
                    plotControls.style.display = node.controlsVisible ? 'flex' : 'none';
                }
            }
            
            return tileElement;
        } else if (node.type === 'selector') {
            // Create a selection tile (empty tile for adding new panels)
            if (_addTileCallback) {
                const selectorElement = _addTileCallback(parentElement);
                // Mark it as a selection tile that should not be closable
                if (selectorElement && selectorElement.classList.contains('tile-selector')) {
                    selectorElement.dataset.isBottomSelector = 'true';
                }
            }
            return parentElement.lastChild;
        } else if (node.type === 'split') {
            // Create a split container
            const splitContainer = document.createElement('div');
            
            // Set the right direction
            if (node.direction === 'vertical') {
                splitContainer.className = 'split-container split-vertical';
                splitContainer.style.flexDirection = 'column';
            } else {
                splitContainer.className = 'split-container split-horizontal';
                splitContainer.style.flexDirection = 'row';
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
                firstPane.style.flex = `${pane1Percentage}`;
                firstPane.dataset.flexPercentage = pane1Percentage;
                
                secondPane.style.flex = `${pane2Percentage}`;
                secondPane.dataset.flexPercentage = pane2Percentage;
                
                // Set control visibility state
                if (Object.prototype.hasOwnProperty.call(node.panes[0], 'controlsVisible')) {
                    firstPane.dataset.controlsVisible = node.panes[0].controlsVisible;
                }
                
                if (Object.prototype.hasOwnProperty.call(node.panes[1], 'controlsVisible')) {
                    secondPane.dataset.controlsVisible = node.panes[1].controlsVisible;
                }
            } else {
                // Default equal split
                firstPane.style.flex = '1';
                firstPane.dataset.flexPercentage = '50';
                secondPane.style.flex = '1';
                secondPane.dataset.flexPercentage = '50';
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
            if (newFirstPercentage > MIN_PANE_SIZE_PERCENT && newSecondPercentage > MIN_PANE_SIZE_PERCENT) {
                // Update flex values for both panes
                firstPane.style.flex = `${newFirstPercentage}`;
                secondPane.style.flex = `${newSecondPercentage}`;
                
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
    
    /**
     * Creates a new split in the container
     * @param {HTMLElement} container - The container to split
     * @param {HTMLElement} element - The element being split
     * @param {string} direction - Split direction ('horizontal' or 'vertical')
     * @returns {Object} - Object containing the created panes
     */
    function createSplit(container, element, direction) {
        // Create the split container
        const splitContainer = document.createElement('div');
        
        if (direction === 'vertical') {
            splitContainer.className = 'split-container split-vertical';
            splitContainer.style.flexDirection = 'column';
        } else {
            splitContainer.className = 'split-container split-horizontal';
            splitContainer.style.flexDirection = 'row';
        }
        
        splitContainer.dataset.splitDirection = direction;
        
        // Create the two panes and the handle
        const firstPane = document.createElement('div');
        firstPane.className = 'split-pane';
        firstPane.style.flex = DEFAULT_SPLIT_RATIO;
        firstPane.dataset.flexPercentage = DEFAULT_SPLIT_RATIO;
        
        const handle = document.createElement('div');
        handle.className = `split-handle ${direction === 'vertical' ? 'horizontal' : 'vertical'}`;
        
        // Make the handle more visible
        handle.style.cssText = direction === 'vertical' 
            ? 'height: 8px; background-color: #adb5bd; cursor: row-resize; position: relative;'
            : 'width: 8px; background-color: #adb5bd; cursor: col-resize; position: relative;';
            
        // Add grip indicator for better visibility
        const gripIndicator = document.createElement('div');
        if (direction === 'vertical') {
            gripIndicator.style.cssText = 'width: 30px; height: 2px; background-color: #495057; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);';
        } else {
            gripIndicator.style.cssText = 'width: 2px; height: 30px; background-color: #495057; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);';
        }
        handle.appendChild(gripIndicator);
        
        const secondPane = document.createElement('div');
        secondPane.className = 'split-pane';
        secondPane.style.flex = DEFAULT_SPLIT_RATIO;
        secondPane.dataset.flexPercentage = DEFAULT_SPLIT_RATIO;
        
        // Replace the element with the split container
        container.insertBefore(splitContainer, element);
        container.removeChild(element);
        
        // Add the element to the first pane and a selection tile to the second pane
        firstPane.appendChild(element);
        
        // Create a selection tile in the second pane if callback is provided
        if (_addTileCallback) {
            const selectorElement = _addTileCallback(secondPane);
            // Mark it as a selection tile that should not be closable
            if (selectorElement && selectorElement.classList.contains('tile-selector')) {
                selectorElement.dataset.isBottomSelector = 'true';
            }
        }
        
        // Assemble the split container
        splitContainer.appendChild(firstPane);
        splitContainer.appendChild(handle);
        splitContainer.appendChild(secondPane);
        
        // Set up the resize handle
        setupResizableHandle(handle, firstPane, secondPane, direction);
        
        return {
            container: splitContainer,
            firstPane,
            secondPane,
            handle
        };
    }

    /**
     * Closes a panel and properly cleans up all related elements
     * @param {HTMLElement} element - The element to close (can be a tile, pane, or other container)
     */
    function closePanel(element) {
        // Don't close selection tiles
        if (element.classList.contains('tile-selector') ||
            element.dataset.isBottomSelector === 'true') {
            // Ignore selection tiles closing
            return;
        }
        
        // Variable to hold the actual tile element
        let tileElement;
        
        // Special case for split panes with selection tiles
        if (element.classList.contains('split-pane')) {
            // Check if this pane contains a selection tile
            const selectionTile = element.querySelector('.tile-selector');
            if (selectionTile) {
                console.log('Closing a split pane containing a selection tile');
                
                // Find the split container
                const splitContainer = element.closest('.split-container');
                if (splitContainer) {
                    // Find the other pane
                    const otherPane = Array.from(splitContainer.querySelectorAll('.split-pane'))
                        .find(pane => pane !== element);
                    
                    // Find the parent container
                    const containerParent = splitContainer.parentElement;
                    
                    if (otherPane && containerParent) {
                        // Move the other pane's contents to the parent container
                        const otherPaneContents = Array.from(otherPane.children);
                        otherPaneContents.forEach(child => {
                            containerParent.insertBefore(child, splitContainer);
                        });
                    }
                    
                    // Remove the entire split container
                    splitContainer.remove();
                    return;
                } else {
                    // Just remove the pane if no container found
                    element.remove();
                    return;
                }
            }
            
            // For standard panels, try to find the tile inside the pane
            const tileInPane = element.querySelector('.tile');
            if (tileInPane) {
                tileElement = tileInPane;
            } else {
                // No tile or selection tile found, just remove the pane
                element.remove();
                return;
            }
        } else {
            // Not a split pane, use the element directly
            tileElement = element;
        }
        
        // Get the panel ID to identify related elements
        const panelId = tileElement.dataset.tileId;
        if (!panelId) {
            // If there's no panel ID, just remove the element
            console.warn('No panel ID found for tile element', tileElement);
            element.remove(); // Remove the original element, not just the tileElement
            return;
        }
        
        // First try to find the split container associated with this panel
        const panelSplitContainer = document.querySelector(`.split-container[data-panel-id="${panelId}"]`);
        if (panelSplitContainer) {
            // Check if we need to save a selection tile
            const selectionTile = panelSplitContainer.querySelector('.tile-selector');
            const container = panelSplitContainer.parentElement;
            
            // Move selection tile to main container if one exists
            if (selectionTile && container) {
                // Remove from the split container
                selectionTile.parentElement.removeChild(selectionTile);
                
                // Add directly to the container
                container.appendChild(selectionTile);
            }
            
            // Now remove the entire split container (includes panel, handle, etc.)
            panelSplitContainer.remove();
            
            // Ensure container has a selection tile if needed
            const needsSelectionTile = container &&
                container.classList.contains('tile-container') &&
                !container.querySelector('.tile-selector') &&
                !container.querySelector('.split-container');
                
            if (needsSelectionTile && _addTileCallback) {
                _addTileCallback(container);
            }
            
            return;
        }
        
        // Find and remove the panel wrapper if it exists
        const wrapper = document.querySelector(`.panel-wrapper[data-panel-id="${panelId}"]`);
        if (wrapper) {
            // Simply remove the entire wrapper (includes panel and handle)
            wrapper.remove();
            return;
        }
        
        // Otherwise, find and remove any associated resize elements
        const associatedElements = document.querySelectorAll(`[data-panel-id="${panelId}"]`);
        associatedElements.forEach(el => {
            if (el !== tileElement) {
                el.remove();
            }
        });
        
        // Legacy panel group (old structure)
        const panelGroup = document.querySelector(`.panel-group[data-panel-id="${panelId}"]`);
        if (panelGroup) {
            // Save contents of any selection tiles in the group
            const selectionTile = panelGroup.querySelector('.tile-selector');
            const container = panelGroup.parentElement;
            
            // Remove the panel group
            panelGroup.remove();
            
            // Ensure container has a selection tile if needed
            const needsSelectionTile = container &&
                container.classList.contains('tile-container') &&
                !container.querySelector('.tile-selector') &&
                !container.querySelector('.panel-group');
                
            if (needsSelectionTile && _addTileCallback) {
                _addTileCallback(container);
            }
            
            return;
        }
        
        // Handle regular split panes
        const parentPane = tileElement.closest('.split-pane');
        if (!parentPane) {
            // If there's no parent pane, simply remove the tile
            tileElement.remove();
            return;
        }
        
        // Find the split container
        const splitContainer = parentPane.parentElement;
        if (!splitContainer || !splitContainer.classList.contains('split-container')) {
            // No valid container, just remove the element
            tileElement.remove();
            return;
        }
        
        // Find the other pane
        const allPanes = splitContainer.querySelectorAll('.split-pane');
        let otherPane = null;
        for (const pane of allPanes) {
            if (pane !== parentPane) {
                otherPane = pane;
                break;
            }
        }
        
        // If no other pane found, just remove the element
        if (!otherPane) {
            tileElement.remove();
            return;
        }
        
        // Get the parent of the split container
        const containerParent = splitContainer.parentElement;
        if (!containerParent) {
            // Just remove the tile if no parent found
            tileElement.remove();
            return;
        }
        
        // Check if the other pane contains a selection tile
        const otherPaneContents = Array.from(otherPane.children);
        const hasSelectionTile = otherPaneContents.some(el => 
            el.classList.contains('tile-selector') || el.dataset.isBottomSelector === 'true'
        );
        
        // Move all contents from the other pane to the container parent
        otherPaneContents.forEach(child => {
            containerParent.insertBefore(child, splitContainer);
        });
        
        // Remove the split container
        splitContainer.remove();
        
        // Only add a selection tile if the container is empty and is the main container
        const isEmptyMainContainer = 
            containerParent.classList.contains('tile-container') && 
            !hasSelectionTile && 
            !containerParent.querySelector('.tile') && 
            !containerParent.querySelector('.tile-selector') &&
            !containerParent.querySelector('.panel-group');
            
        if (isEmptyMainContainer && _addTileCallback) {
            _addTileCallback(containerParent);
        }
    }
    
    /**
     * Creates a panel with a simple horizontal resizer
     * @param {HTMLElement} container - The container element  
     * @param {HTMLElement} selectionTile - The selection tile element
     * @param {Function} createPanelCallback - Function to create the panel
     * @param {string} panelType - The type of panel to create
     * @param {Object} panelConfig - Optional panel configuration
     * @returns {Object} - The created panel instance
     */
    function createPanelWithSelectionTile(container, selectionTile, createPanelCallback, panelType, panelConfig = {}) {
        // Create a wrapper div for better resize control
        const wrapper = document.createElement('div');
        wrapper.className = 'panel-wrapper';
        wrapper.style.cssText = `
            width: 100%;
            margin-bottom: 4px;
            position: relative;
        `;
        
        // Create the panel element with fixed initial height
        const panelElement = document.createElement('div');
        panelElement.className = 'tile';
        panelElement.style.cssText = `
            height: ${DEFAULT_PANEL_HEIGHT}px; 
            min-height: ${MIN_PANEL_HEIGHT}px;
            width: 100%;
            margin: 0;
            padding: 0;
        `;
        
        // Create the horizontal resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'split-handle horizontal';
        resizeHandle.style.cssText = `
            height: 8px;
            background-color: #adb5bd;
            cursor: row-resize;
            width: 100%;
            margin-top: 0;
        `;
        
        // Add grip line for better visibility
        const gripLine = document.createElement('div');
        gripLine.style.cssText = `
            width: 30px;
            height: 2px;
            background-color: #495057; 
            margin: 3px auto;
        `;
        resizeHandle.appendChild(gripLine);
        
        // Add to wrapper and insert before selection tile
        wrapper.appendChild(panelElement);
        wrapper.appendChild(resizeHandle);
        container.insertBefore(wrapper, selectionTile);
        
        // Create the panel in the panel element
        const panel = createPanelCallback(panelType, panelConfig, panelElement);
        const panelId = panel.getId();
        
        // Add IDs for cleanup
        panelElement.dataset.tileId = panelId;
        panelElement.dataset.panelId = panelId;
        wrapper.dataset.panelId = panelId;
        resizeHandle.dataset.panelId = panelId;
        
        // Simple resize functionality
        let startY, startHeight;
        
        resizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startY = e.clientY;
            startHeight = panelElement.offsetHeight;
            
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            
            // Visual feedback
            resizeHandle.style.backgroundColor = '#6c757d';
            document.body.style.cursor = 'row-resize';
        });
        
        function handleMouseMove(e) {
            if (!startY) return;
            
            const deltaY = e.clientY - startY;
            const newHeight = Math.max(MIN_PANEL_HEIGHT, startHeight + deltaY);
            
            // Apply height directly to panel element
            panelElement.style.height = `${newHeight}px`;
        }
        
        function handleMouseUp() {
            startY = null;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            
            // Reset visual state
            resizeHandle.style.backgroundColor = '#adb5bd';
            document.body.style.cursor = '';
        }
        
        // Override panel height functions to ensure resizing works after splitting
        const originalGetConfig = panel.getConfig;
        if (originalGetConfig) {
            panel.getConfig = function() {
                const config = originalGetConfig.apply(this, arguments);
                config.height = panelElement.style.height;
                return config;
            };
        }
        
        return panel;
    }

    // Public API
    return {
        init,
        buildLayoutHierarchy,
        rebuildLayoutFromHierarchy,
        setupResizableHandle,
        createSplit,
        closePanel,
        createPanelWithSelectionTile
    };
})();

// Export the module
export { LayoutManager };