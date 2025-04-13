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
    const DEFAULT_PANEL_HEIGHT = 1000; // Default panel height in pixels
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
        // Check if this split is happening within a panel wrapper
        const isInsidePanelWrapper = container.classList.contains('panel-wrapper') || 
                                     container.closest('.panel-wrapper') !== null;
        
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
        
        // Create the two panes
        const firstPane = document.createElement('div');
        firstPane.className = 'split-pane';
        firstPane.style.flex = DEFAULT_SPLIT_RATIO;
        firstPane.dataset.flexPercentage = DEFAULT_SPLIT_RATIO;
        
        const handle = document.createElement('div');
        handle.className = `split-handle ${direction === 'vertical' ? 'horizontal' : 'vertical'}`;
        
        const secondPane = document.createElement('div');
        secondPane.className = 'split-pane';
        secondPane.style.flex = DEFAULT_SPLIT_RATIO;
        secondPane.dataset.flexPercentage = DEFAULT_SPLIT_RATIO;
        
        // Replace the element with the split container
        container.insertBefore(splitContainer, element);
        container.removeChild(element);
        
        // Add the element to the first pane
        firstPane.appendChild(element);
        
        // Create a selection tile in the second pane
        if (_addTileCallback) {
            _addTileCallback(secondPane);
        }
        
        // Assemble the split container
        splitContainer.appendChild(firstPane);
        splitContainer.appendChild(handle);
        splitContainer.appendChild(secondPane);
        
        // Set up the resize handle
        setupResizableHandle(handle, firstPane, secondPane, direction);
        
        // If splitting a panel inside a wrapper, set data attributes to track the relationship
        if (isInsidePanelWrapper) {
            // Find the wrapper
            const panelWrapper = container.classList.contains('panel-wrapper') ? 
                                container : container.closest('.panel-wrapper');
            
            if (panelWrapper && panelWrapper.dataset.panelWrapper === 'true') {
                // Mark this split container as belonging to a panel wrapper
                splitContainer.dataset.inPanelWrapper = 'true';
                splitContainer.dataset.wrapperParentId = panelWrapper.dataset.wrapperId;
            }
        }
        
        return {
            container: splitContainer,
            firstPane,
            secondPane,
            handle
        };
    }
    
    /**
     * Setup height resize functionality for a panel handle
     * @param {HTMLElement} handle - The resize handle element
     * @param {HTMLElement} panelElement - The panel element to resize
     */
    function setupPanelHeightHandle(handle, panelElement) {
        let startY = 0;
        let startHeight = 0;
        
        const onMouseDown = (e) => {
            e.preventDefault();
            
            // Store the starting position and height
            startY = e.clientY;
            startHeight = panelElement.offsetHeight;
            
            // Add event listeners for dragging
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            
            // Add dragging class
            handle.classList.add('dragging');
        };
        
        const onMouseMove = (e) => {
            e.preventDefault();
            
            // Calculate the new position
            const currentY = e.clientY;
            const delta = currentY - startY;
            
            // Calculate new height
            const newHeight = startHeight + delta;
            
            // Apply new height if it's valid (minimum height)
            if (newHeight >= MIN_PANEL_HEIGHT) {
                panelElement.style.height = `${newHeight}px`;
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
     * Closes a panel and properly cleans up all related elements
     * @param {HTMLElement} element - The element to close (can be a tile, pane, or other container)
     */
    function closePanel(element) {
        // Don't close selection tiles, especially not the welcome tile
        if (element.classList.contains('tile-selector') ||
            element.dataset.isBottomSelector === 'true') {
            return;
        }
        
        // Find the actual tile element if we're given a pane
        let tileElement = element;
        if (element.classList.contains('split-pane')) {
            const tile = element.querySelector('.tile');
            if (tile) {
                tileElement = tile;
            } else {
                element.remove();
                return;
            }
        }
        
        // Get the panel ID
        const panelId = tileElement.dataset.tileId;
        if (!panelId) {
            console.warn('No panel ID found for tile element', tileElement);
            element.remove();
            return;
        }
        
        // Find if this tile is inside a panel wrapper
        const panelWrapper = tileElement.closest('.panel-wrapper');
        
        // Find the parent pane of this tile
        const parentPane = tileElement.closest('.split-pane');
        
        // Check if panel is in a wrapper 
        if (panelWrapper && panelWrapper.dataset.panelWrapper === 'true') {
            const panelId = tileElement.dataset.tileId;
            const wrapperId = panelWrapper.dataset.wrapperId;
            
            // Only check for removing if this is a direct split from the original wrapper
            // (Later splits will have different panel IDs than the wrapper ID)
            if (panelId === wrapperId) {
                // Don't remove wrapper yet, check if it contains any children or split containers
                const remainingTiles = panelWrapper.querySelectorAll('.tile:not(.tile-selector)');
                const remainingSplits = panelWrapper.querySelectorAll('.split-container');
                
                // Consider the current tile to be closed already
                const effectiveTileCount = remainingTiles.length - 1;
                
                const hasRemainingPanels = effectiveTileCount > 0 || remainingSplits.length > 0;
                
                if (!hasRemainingPanels) {
                    // Last panel in the wrapper, remove wrapper and handle
                    const nextSibling = panelWrapper.nextElementSibling;
                    if (nextSibling && nextSibling.classList.contains('split-handle') && 
                        nextSibling.dataset.panelHandle === 'true') {
                        nextSibling.remove();
                    }
                    
                    // Remove the wrapper itself
                    panelWrapper.remove();
                    
                    // Check if there are any remaining panel wrappers
                    const container = document.querySelector('.tile-container');
                    const remainingWrappers = container.querySelectorAll('.panel-wrapper');
                    
                    // If no panel wrappers left, remove all height handles
                    if (remainingWrappers.length === 0) {
                        const heightHandles = container.querySelectorAll('.split-handle[data-panel-handle="true"]');
                        heightHandles.forEach(handle => handle.remove());
                    }
                    return;
                }
            }
        }
        
        if (!parentPane) {
            // Not in a split, just remove it
            tileElement.remove();
            
            // Check if there are any remaining panels
            const container = document.querySelector('.tile-container');
            const remainingPanels = container.querySelectorAll('.tile:not(.tile-selector)');
            
            // If no panels left, remove all height handles
            if (remainingPanels.length === 0) {
                const heightHandles = container.querySelectorAll('.split-handle[data-panel-handle="true"]');
                heightHandles.forEach(handle => handle.remove());
            }
            return;
        }
        
        // Find the split container
        const splitContainer = parentPane.parentElement;
        if (!splitContainer || !splitContainer.classList.contains('split-container')) {
            tileElement.remove();
            return;
        }
        
        // Find the other pane in this split
        const otherPane = Array.from(splitContainer.querySelectorAll('.split-pane'))
            .find(pane => pane !== parentPane);
        
        if (!otherPane) {
            // No other pane, just remove the tile
            tileElement.remove();
            return;
        }
        
        // Get the container parent
        const containerParent = splitContainer.parentElement;
        if (!containerParent) {
            tileElement.remove();
            return;
        }
        
        // Move all content from the other pane to the parent container
        const otherPaneContents = Array.from(otherPane.children);
        otherPaneContents.forEach(child => {
            containerParent.insertBefore(child, splitContainer);
        });
        
        // Remove the split container with both panes and the handle
        splitContainer.remove();
        
        // Add a selection tile if we're in the main container and there's no welcome tile
        const needsSelectionTile = 
            containerParent.classList.contains('tile-container') && 
            !containerParent.querySelector('.tile-selector');
        
        if (needsSelectionTile && _addTileCallback) {
            _addTileCallback(containerParent);
        }
        
        // Check if this was the last split in a panel wrapper
        if (containerParent.classList.contains('panel-wrapper') && 
            containerParent.dataset.panelWrapper === 'true') {
            
            // Check if there are any remaining panels or splits in the wrapper
            const remainingTiles = containerParent.querySelectorAll('.tile:not(.tile-selector)');
            const remainingSplits = containerParent.querySelectorAll('.split-container');
            
            // If no panels left in the wrapper, remove the wrapper and its handle
            if (remainingTiles.length === 0 && remainingSplits.length === 0) {
                const nextSibling = containerParent.nextElementSibling;
                if (nextSibling && nextSibling.classList.contains('split-handle') && 
                    nextSibling.dataset.panelHandle === 'true') {
                    nextSibling.remove();
                }
                
                // Remove the wrapper itself
                containerParent.remove();
            }
        }
        
        // Check if there are any remaining panels in the main container
        const mainContainer = document.querySelector('.tile-container');
        if (mainContainer) {
            const remainingWrappers = mainContainer.querySelectorAll('.panel-wrapper');
            
            // If no panel wrappers left, remove all height handles
            if (remainingWrappers.length === 0) {
                const heightHandles = mainContainer.querySelectorAll('.split-handle[data-panel-handle="true"]');
                heightHandles.forEach(handle => handle.remove());
            }
        }
    }
    
    /**
     * Creates a panel with a simple horizontal resizer, keeping the welcome tile
     * @param {HTMLElement} container - The container element  
     * @param {HTMLElement} selectionTile - The selection tile element
     * @param {Function} createPanelCallback - Function to create the panel
     * @param {string} panelType - The type of panel to create
     * @param {Object} panelConfig - Optional panel configuration
     * @returns {Object} - The created panel instance
     */
    function createPanelWithSelectionTile(container, selectionTile, createPanelCallback, panelType, panelConfig = {}) {
        // Create a wrapper div that won't be replaced
        const panelWrapper = document.createElement('div');
        panelWrapper.className = 'panel-wrapper';
        panelWrapper.style.height = `${DEFAULT_PANEL_HEIGHT}px`;
        panelWrapper.style.width = '100%';
        panelWrapper.style.overflow = 'hidden';
        panelWrapper.style.position = 'relative';
        panelWrapper.dataset.panelWrapper = 'true';
        
        // Create a panel element inside the wrapper
        const panelElement = document.createElement('div');
        panelElement.className = 'tile';
        panelElement.style.width = '100%';
        panelElement.style.height = '100%';
        
        // Add panel to wrapper
        panelWrapper.appendChild(panelElement);
        
        // Create a horizontal resize handle
        const handle = document.createElement('div');
        handle.className = 'split-handle horizontal';
        handle.dataset.panelHandle = 'true';
        
        // Insert the wrapper and handle before the selection tile
        container.insertBefore(panelWrapper, selectionTile);
        container.insertBefore(handle, selectionTile);
        
        // Create the panel in the panel element
        const panel = createPanelCallback(panelType, panelConfig, panelElement);
        const panelId = panel.getId();
        
        // Add ID to panel element and wrapper for tracking
        panelElement.dataset.tileId = panelId;
        panelWrapper.dataset.wrapperId = panelId;
        
        // Setup resize functionality for the handle
        setupPanelHeightHandle(handle, panelWrapper);
        
        // Store reference to the handle in the wrapper
        panelWrapper.dataset.resizeHandle = true;
        
        // We don't remove the welcome tile - it stays at the bottom
        
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