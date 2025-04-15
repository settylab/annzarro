/**
 * Desktop Integration Script for AnnZarro
 * 
 * This script enhances the web UI to work better in the desktop context.
 * It's injected into the renderer process and modifies the web UI behavior.
 */

// Wait for the page to fully load
window.addEventListener('DOMContentLoaded', () => {
  console.log('AnnZarro Desktop Integration loaded');

  // Add desktop class to body for CSS targeting
  document.body.classList.add('desktop-app');
  
  // Inject desktop-specific CSS
  injectDesktopStyles();
  
  // Enhance the dataset selector to use native file picker
  enhanceDatasetSelector();
  
  // Listen for keyboard events (enhanced shortcuts in desktop)
  setupDesktopKeyboardShortcuts();
});

/**
 * Injects desktop-specific CSS styles
 */
function injectDesktopStyles() {
  // Define the base URL for desktop CSS (will be injected by the main process)
  const cssContent = `
    /**
     * Custom CSS styles for the AnnZarro Desktop application
     */
    
    /* Add desktop-specific styles when in desktop mode */
    body.desktop-app {
      /* Adjust UI elements for desktop context */
      --dataset-selector-width: calc(100% - 80px); /* Make room for browse button */
    }
    
    /* The new browse button for dataset selection */
    #browse-dataset {
      display: inline-flex;
      justify-content: center;
      align-items: center;
      height: 38px;
      width: 38px;
      padding: 0;
    }
    
    /* Desktop-specific adjustments for panels */
    body.desktop-app .tile {
      border: 1px solid rgba(0, 0, 0, 0.15);
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
    }
    
    /* Nicer scrollbars for desktop */
    body.desktop-app ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    
    body.desktop-app ::-webkit-scrollbar-track {
      background: #f1f1f1;
      border-radius: 4px;
    }
    
    body.desktop-app ::-webkit-scrollbar-thumb {
      background: #c1c1c1;
      border-radius: 4px;
    }
    
    body.desktop-app ::-webkit-scrollbar-thumb:hover {
      background: #a8a8a8;
    }
    
    /* Desktop-specific modal styling */
    body.desktop-app .modal-content {
      border-radius: 8px;
      box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
    }
    
    /* When hovering over dataset selector items in desktop mode */
    body.desktop-app .select2-results__option--highlighted {
      background-color: #4285f4 !important;
      color: white !important;
    }
  `;
  
  // Create a style element and add the CSS
  const style = document.createElement('style');
  style.textContent = cssContent;
  style.id = 'desktop-styles';
  
  // Append to head
  document.head.appendChild(style);
  console.log('Desktop styles injected');
}

/**
 * Enhances the dataset selector to use the native file picker
 */
function enhanceDatasetSelector() {
  // Wait for the dataset selector to be available
  const checkForSelector = setInterval(() => {
    const datasetSelector = document.getElementById('dataset-selector');
    const refreshButton = document.getElementById('refresh-dataset');
    
    if (datasetSelector && refreshButton) {
      clearInterval(checkForSelector);
      
      // Create a browse button
      const browseButton = document.createElement('button');
      browseButton.id = 'browse-dataset';
      browseButton.className = 'btn btn-outline-secondary ms-1';
      browseButton.title = 'Browse for dataset';
      browseButton.innerHTML = '<i class="fas fa-folder-open"></i>';
      
      // Insert the browse button after the refresh button
      refreshButton.parentNode.insertBefore(browseButton, refreshButton.nextSibling);
      
      // Add click handler for the browse button
      browseButton.addEventListener('click', async () => {
        try {
          // Show native file picker dialog
          const selectedDir = await window.api.selectDirectory();
          
          if (selectedDir) {
            console.log('Selected directory:', selectedDir);
            
            // If using Select2
            if (window.$ && $.fn.select2 && $(datasetSelector).hasClass('select2-hidden-accessible')) {
              // Check if option already exists
              let exists = false;
              for (let i = 0; i < datasetSelector.options.length; i++) {
                if (datasetSelector.options[i].value === selectedDir) {
                  exists = true;
                  break;
                }
              }
              
              // If not exists, create a new option
              if (!exists) {
                const newOption = new Option(selectedDir, selectedDir, true, true);
                $(datasetSelector).append(newOption);
              }
              
              // Set the value and trigger change
              $(datasetSelector).val(selectedDir).trigger('change');
            } else {
              // Standard select element
              let exists = false;
              for (let i = 0; i < datasetSelector.options.length; i++) {
                if (datasetSelector.options[i].value === selectedDir) {
                  datasetSelector.selectedIndex = i;
                  exists = true;
                  break;
                }
              }
              
              if (!exists) {
                const option = document.createElement('option');
                option.value = selectedDir;
                option.text = selectedDir;
                datasetSelector.add(option);
                datasetSelector.value = selectedDir;
              }
              
              // Trigger change event
              datasetSelector.dispatchEvent(new Event('change'));
            }
          }
        } catch (error) {
          console.error('Error selecting directory:', error);
        }
      });
      
      console.log('Dataset selector enhanced for desktop app');
    }
  }, 500);
}

/**
 * Sets up enhanced keyboard shortcuts for desktop app
 */
function setupDesktopKeyboardShortcuts() {
  // If the Config object is available with KEYBOARD_SHORTCUTS
  if (window.Config && window.Config.KEYBOARD_SHORTCUTS) {
    // Disable browser compatibility mode for desktop app
    window.Config.KEYBOARD_SHORTCUTS.BROWSER_COMPATIBLE = false;
    console.log('Keyboard shortcuts enhanced for desktop app');
  } else {
    // Wait for Config to be available
    const checkForConfig = setInterval(() => {
      if (window.Config && window.Config.KEYBOARD_SHORTCUTS) {
        window.Config.KEYBOARD_SHORTCUTS.BROWSER_COMPATIBLE = false;
        console.log('Keyboard shortcuts enhanced for desktop app');
        clearInterval(checkForConfig);
      }
    }, 500);
  }
}