# Implementation Plan for Annzarro

This plan outlines the necessary changes to address the reported issues and required improvements to the Annzarro application.

## Current Status (Updated on April 3, 2025)

We're working on improving Annzarro to handle browsing from the startup directory and add proper support for additional matrix types like .varm, .obsp, and .varp. 

We've fixed the JavaScript SyntaxError in main.js by completely removing file:// protocol support and restructuring the conditional logic. The specific error "Unexpected token 'else'" at line 1054 has been fixed by properly handling the case where no datasets are found without using an else clause that would be connected to a distant if statement.

We've also documented the server architecture and proposed a unified server approach that would use a single port for both frontend and backend. The API URL detection has been simplified to prioritize same-origin access. Since backward compatibility is not required, legacy code paths can be removed entirely in future updates.

The next steps are implementing the unified server approach, completing client-side support for .obsp and .varp matrices, adding robust testing infrastructure, and fixing any remaining issues with the directory browsing functionality.

## IMPORTANT: No Backward Compatibility Required

Since this application has not yet been released, we DO NOT need to maintain backward compatibility with any existing features, code paths, or UI elements. This means:

- We SHOULD completely remove the file:// protocol support as it cannot replace the Python backend
- We SHOULD eliminate all "demo data" terminology without maintaining legacy support
- We CAN break existing code paths if it leads to cleaner, more maintainable code
- We SHOULD focus on simplicity and consistency rather than preserving legacy behavior
- We CAN rewrite problematic sections from scratch rather than patching them

## 1. Server Architecture and Configuration
- [x] Fix port configuration to always read from server config
- [x] Remove hardcoded port values from main.js
- [x] Make sure correct ports are reported in the log and startup messages
- [x] Ensure API URL is properly constructed with correct port
- [x] Add proper error handling for connection failures
- [ ] Resolve the dual server architecture (Python vs. frontend)
- [ ] Clarify and document why different ports are used for frontend and backend
- [ ] Fix server startup errors and ensure consistent port usage
- [ ] Eliminate support for file:// protocol completely
- [ ] Remove all file:// protocol code paths from the codebase
- [ ] Document the server architecture clearly in README.md

## 2. Data Directory Management
- [x] Remove hardcoded demo datasets and replace with dynamic directory scanning
- [x] Add proper support for symlinks in the data directory
- [x] Update the UI to treat filesystem contents as browsable resources, not "demo data"
- [x] Test directory scanning with nested directories and symlinks
- [x] Add support for browsing from the startup directory
- [ ] Remove all remaining references to "demo data" throughout the codebase
- [ ] Implement better error handling for directory access issues

## 3. Interface and UI Fixes
- [x] Fix split lines going through headers issue
- [ ] Implement proper CSS grid-based resizing that works with all panel types
- [x] Fix inconsistencies with multiple splitting
- [ ] Ensure panels resize correctly with content
- [ ] Test resizing behavior across different layouts (single, horizontal, vertical, quad)
- [ ] Fix JavaScript errors causing unresponsive UI:
  - [ ] Fix SyntaxError in main.js at line 1054 with unexpected 'else' token
  - [ ] Fix any other syntax errors found during testing
- [ ] Add a comprehensive error reporting system
- [ ] Create command-line debugging tools for better testing

## 4. AnnData Matrix Field Support
- [x] Implement support for .varm fields in zarr_reader.py
- [x] Extend the UI to show hierarchical column selection for .varm fields
- [x] Add support for .obsp fields (observation-observation matrices)
  - [x] Create get_obsp method in zarr_reader.py
  - [x] Add REST API endpoint to expose .obsp data
  - [x] Implement client-side functions to retrieve .obsp matrices
- [x] Add support for .varp fields (variable-variable matrices)
  - [x] Create get_varp method in zarr_reader.py
  - [x] Add REST API endpoint to expose .varp data
  - [x] Implement client-side functions to retrieve .varp matrices
- [ ] Implement lazy loading for large matrices
  - [ ] Add Dask integration for large matrix operations
  - [ ] Implement chunked loading for .obsp and .varp matrices
  - [ ] Add progress indicators for large matrix operations
  - [ ] Support pagination and partial matrix loading
- [ ] Integrate matrix data as selectable sources in existing visualizations
  - [ ] Add .obsp and .varp as data source options alongside .obs, .obsm, and layers
  - [ ] For .obsp matrices, allow selecting specific cells or the focused cell
  - [ ] For .varp matrices, allow selecting specific genes or the focused gene
  - [ ] Make these matrix data sources update when focused cells or genes change
  - [ ] Remove unnecessary standalone matrix visualization code
- [ ] Test UI controls for all matrix type selection
- [ ] Add comprehensive matrix type documentation

## 5. Frontend State Management and Client Architecture
- [ ] Refactor state management for multi-user support
  - [ ] Move user-specific state (focused cell, gene, species) entirely to frontend
  - [ ] Eliminate POST requests to maintain read-only backend
  - [ ] Pass all necessary parameters in GET requests
  - [ ] Implement URL-based state sharing
- [ ] Implement frontend-only selection and filtering
  - [ ] Store selections in client-side state
  - [ ] Pass selections as parameters in data requests
  - [ ] Support URL-based sharing of selections
- [ ] Add filesystem change detection and notifications
  - [ ] Implement server-side file watching for data directory
  - [ ] Add WebSocket support for real-time notifications
  - [ ] Create UI components for data change notifications
  - [ ] Add refresh options for plots, tables, and indices
  - [ ] Support automatic or manual refresh modes

## 6. Testing and Debugging Infrastructure
- [x] Set up comprehensive automated testing strategy
  - [x] Define unit testing approach for server components
  - [x] Define integration testing strategy for unified server approach
  - [x] Document testing procedures for different components
  - [x] Implement test cases for unified server
  - [x] Unit tests for static file serving functionality
  - [x] Integration tests for unified server with both API and static content
  - [x] End-to-end tests for server endpoints
  - [x] Test configuration handling and environment variables
- [ ] Implement command-line browser testing with console access
  - [ ] Configure headless browser testing using Puppeteer or similar
  - [ ] Set up test environment with mocked server responses
  - [ ] Create detailed console logging for JavaScript errors
  - [ ] Add automated screenshots of rendering issues
- [ ] Add thorough error reporting and logging
  - [ ] Create structured logging system with levels and timestamps
  - [ ] Log all errors to a centralized location (server and client)
  - [ ] Implement error tracking and analysis tools
- [x] Create a test suite specifically for server interactions
  - [x] Test API endpoints with a variety of inputs
  - [x] Mock zarr files and data structures
  - [x] Test error conditions and edge cases
- [x] Implement end-to-end tests for the full application
  - [x] Test file browsing and selection
  - [x] Test static file serving
  - [x] Test API endpoints
- [x] Add tests for all matrix field types
  - [x] Create test cases for .obsm, .varm, .obsp, and .varp matrices
  - [x] Test selection and visualization of each matrix type
  - [x] Test with real data from aging.zarr sample dataset in data/ directory
- [ ] Automate testing of startup from different directories
  - [ ] Test with various directory structures and zarr files
  - [ ] Test with symlinks and nested directories
  - [ ] Test with special characters in paths
- [ ] Document testing procedures for contributors

### Testing Strategy

#### 1. Unit Testing
- **Backend (Python)**: 
  - Use pytest for testing individual components
  - Mock dependencies for isolated testing
  - Test each API endpoint independently
  - Command: `pytest annzarro/tests/`

- **Frontend (JavaScript)**:
  - Use Jest for testing JavaScript components
  - Mock API calls and responses
  - Test UI components in isolation
  - Command: `npm test`

#### 2. Integration Testing
- **Unified Server Testing**:
  - Test the entire server with both API and static content serving
  - Automate server startup and shutdown
  - Verify correct configuration loading
  - Test script: `python -m annzarro.tests.integration.test_unified_server`

- **API Integration Test**:
  - Test all API endpoints with real server
  - Verify correct responses and error handling
  - Test script: `python -m annzarro.tests.integration.test_api`

#### 3. End-to-End Testing
- **Browser Automation**:
  - Use Puppeteer/Playwright for headless browser testing
  - Test complete user flows from UI to backend
  - Capture screenshots and console logs
  - Command: `npm run test:e2e`

#### 4. Continuous Integration
- Run tests automatically on each commit
- Verify server startup and basic functionality
- Test on multiple platforms (where applicable)

#### 5. Manual Testing Checklist
- Server startup and configuration
- File browsing and navigation
- Dataset loading and visualization
- Matrix access and rendering
- Error handling and recovery

#### 6. Real Data Testing
- Use the aging.zarr sample dataset in data/ directory (mouse hematopoiesis data)
- Test loading and browsing real AnnData matrices
- Verify handling of large sparse matrices in .obsp and .varp
- Test visualizations with real embeddings (X_umap, X_pca)
- Test cell and gene selection with real biological data
- Implement graceful test skipping when dataset isn't available (e.g., in CI environments)

## 7. Data Loading Functionality
- [ ] Debug and fix data loading issues from local files
- [x] Refactor loadDemoData to loadDataFromPath (complete terminology shift)
- [x] Rename loadAvailableDemoData to loadAvailableData throughout codebase
- [ ] Implement proper loading indicators and error messages
- [ ] Test data loading from various sources (URL, S3)
- [ ] Add better error handling for malformed or incomplete zarr archives
- [ ] Implement progress indicators for large dataset loading

## 8. S3 Integration
- [ ] Verify zarr's native S3 support is working correctly
- [ ] Test with real S3 buckets containing zarr data
- [ ] Document configuration requirements for S3 access
- [ ] Implement proper error handling for S3 access issues
- [ ] Add better credential management for S3 access

## 9. Always Visible Information
- [ ] Create a persistent UI element to show focused gene, cell, species, and basic anndata info
- [ ] Update species customization UI to support custom species ID and name
- [ ] Store selection information client-side with URL parameters
- [ ] Make sure this information is visible at all times, regardless of panel layout

## Implementation Priority
1. Fix JavaScript errors - Critical issue preventing the application from working properly
   - Focus on the SyntaxError at line 1054 in main.js (unexpected 'else' token)
   - Remove all file:// protocol support code as it's no longer needed
   - Ensure zarr library is properly loaded 
   - Fix server startup issues with clear port configuration

2. Unify server architecture and configuration
   - Implement single-server approach on one port
   - Make data directory fully configurable
   - Document server architecture clearly

3. Revise matrix data integration approach
   - Modify data source selection UI to include matrix types alongside existing sources
     - Update the data source dropdown in plot configurations to include .obsp/.varp
     - Add cell/gene selection for matrix data sources (or use focused cell/gene)
     - Implement appropriate UI for selecting matrix columns/cells
   - Implement data fetching logic for selected matrix cells/genes
     - For .obsp matrices, fetch data for selected cells or focused cell
     - For .varp matrices, fetch data for selected genes or focused gene
   - Connect matrix data sources to focused cell/gene changes
     - Add event listeners for focus changes to update visualizations
     - Implement caching for better performance
   - Remove unnecessary standalone matrix visualization code
   - Update tests to reflect the new approach

4. Refactor state management for multi-user support
   - Move user state (focused cell, gene, species) to frontend only
   - Implement read-only backend with all selection in GET parameters
   - Add URL-based state sharing

5. Add filesystem change detection and notifications
   - Implement WebSocket-based file change notifications
   - Add UI components for data change alerts
   - Support manual and automatic refresh options

6. Revise client-side integration for matrix fields
   - Implement client-side functions to retrieve all matrix types
   - Integrate matrices as selectable data sources in existing visualizations
   - Add support for focused cell/gene in matrix data sources
   - Remove unnecessary standalone matrix visualization

7. Implement comprehensive testing infrastructure
   - Add command-line browser testing capabilities
   - Create automated tests for all core functionality
   - Document testing procedures

8. Interface improvements and polish
   - Fix splitting and resizing behavior
   - Add persistent information panel
   - Improve error handling and user feedback

## JavaScript Error Resolution Plan
1. ✅ Debug "registerModule is not a function" error
   - ✅ Added robust error checking for window.Annzarro.registerModule function
   - ✅ Implemented fallback registration for modules when function is unavailable
   - ✅ Ensured all modules properly register in the namespace even without the function
2. ✅ Fixed dataContainer reference errors in main.js
   - ✅ Changed dataContainer to demoContainer
3. ✅ Fix SyntaxError at line 1054 in main.js
   - ✅ **REMOVED completely** the file:// protocol code path
   - ✅ Ensured proper code structure after removing conditional blocks
   - ✅ Simplified API URL detection for unified server approach
4. [x] Remove zarr.js JavaScript library dependency
   - [x] Replace all zarr.js usage with Python zarr implementation via API
   - [x] Update documentation to clarify the removal of zarr.js
   - [x] Keep mock for test compatibility but remove actual dependency
5. [ ] Add comprehensive error handling for all JavaScript code

## Server Architecture Plan
1. ✅ Document current architecture with Python backend and frontend server
   - ✅ Created SERVER_ARCHITECTURE.md with detailed explanation
   - ✅ Documented recommendation to use a single unified server on one port
2. ✅ Simplify API URL detection for unified server
   - ✅ Updated main.js to prioritize same-origin API access
   - ✅ Added backward compatibility for legacy dual-server approach
   - ✅ Improved error handling and connection verification
3. [x] Implement unified server setup
   - [x] Modify server.py to serve both API and static content
   - [x] Update configuration to use a single port (8000)
   - [x] Simplify server startup scripts
4. [x] Add better error reporting for server issues
   - [x] Create a server status endpoint (/api/v1/status)
   - [x] Implement automatic reconnection for temporary disconnections
   - [x] Add background health check monitoring

## Notes for Implementation
- ✅ The data directory should be scanned recursively, including one level of subdirectories (now supports fully recursive scanning)
- ✅ Symlinks should be followed to allow users to link in datasets from elsewhere (implemented with follow_symlinks parameter)
- ✅ The UI should clearly indicate data discovery path vs. loaded dataset (added path and symlink indicators)
- ✅ Port configuration should be resilient to different network environments (implemented robust port configuration and detection)
- 🔴 **REMOVE** file:// protocol support entirely as it can never replace Python backend functionality
- 🔴 The browsable file system implementation should not refer to "demo data" as this concept has been removed completely
- 🚫 Do NOT maintain backward compatibility with existing code - the application hasn't been released
- 🚫 Do NOT hesitate to completely rewrite problematic sections of code
- ✅ Be generous with removing legacy code and consider complete rewrites where needed
- ⚠️ JavaScript errors need to be fixed to make the UI responsive again
- ⚠️ Server startup and port configuration issues need to be resolved
- .obsp and .varp should be integrated as selectable data sources for existing visualizations, with support for focused cell/gene changes
- Proper testing infrastructure needs to be implemented for reliable development

## Detailed Matrix Integration Plan

To properly integrate .obsp and .varp matrices as selectable data sources, the following steps need to be implemented:

1. **Data Source Selection UI Enhancement**
   - Update the data source selection dropdowns in plot configuration UI to include:
     - 'obsp' section with available obsp matrices (.connectivities, .distances, etc.)
     - 'varp' section with available varp matrices (.correlation, etc.)
   - Add appropriate UI for selecting specific cells/genes:
     - For obsp: Options to use "Current focused cell", "Selected cells", or specific cell
     - For varp: Options to use "Current focused gene", "Selected genes", or specific gene

2. **Data Retrieval Logic**
   - Modify data loading functions to handle matrix data sources:
     - When obsp source is selected, fetch row/column from the matrix for the selected/focused cell
     - When varp source is selected, fetch row/column from the matrix for the selected/focused gene
   - Add helper functions for transforming matrix data into visualization-ready formats
   - Implement efficient caching to avoid redundant API calls

3. **Focus Change Integration**
   - Add event listeners for focus changes (dataManager.addEventListener('focusChanged', ...))
   - When focus changes, update any visualizations using matrix data for the focused cell/gene
   - Implement smart updates to minimize re-rendering

4. **Visualization Component Updates**
   - Modify scatter plot, bar chart, and other visualization types to properly handle matrix data
   - Update hover text and legends to indicate data source (e.g., "Cell-cell connectivity: 0.75")
   - Add special handling for different matrix types (sparse, dense, etc.)

5. **Performance Optimization**
   - Implement lazy loading for large matrices using chunked requests
   - Add progress indicators for large matrix operations
   - Support pagination and partial loading for matrix exploration

6. **Code Cleanup**
   - Remove the specialized matrix visualization code from matrix-manager.js
   - Keep only the necessary API access methods
   - Update tests to reflect the new integrated approach

7. **Documentation and Testing**
   - Update documentation to explain the data source selection for matrices
   - Add comprehensive tests for matrix data source integration
   - Create examples demonstrating different use cases

## TODOs for Next Implementation Session
1. ✅ Fix the JavaScript errors in main.js:
   - ✅ Fixed SyntaxError at line 1054 with unexpected 'else' token
   - ✅ **COMPLETELY REMOVED** all file:// protocol code paths
   - [ ] Debug zarr library loading issues
   - [ ] Test with command-line browser tools

2. ✅ Document server architecture and port configuration:
   - ✅ Created SERVER_ARCHITECTURE.md with detailed explanation
   - ✅ Proposed unified server approach with single port
   - ✅ Updated API URL detection in main.js
   - ✅ Implement unified server setup

3. [x] Implement unified server approach:
   - [x] Modify server.py to serve both API and static content with one port
   - [x] Update configuration files to use a single port
   - [x] Add proper command-line argument support for data directory
     - [x] Add --data-dir argument to run_annzarro.py
     - [x] Pass data directory to server.py when starting backend
     - [x] Support both absolute and relative paths
   - [x] Enhance data directory configuration
     - [x] Use `data/` directory as the default location for zarr files
     - [x] Update code to clearly document data_dir option
     - [x] Add validation to ensure directory exists and create it if missing
     - [x] Add support for expanduser() to use ~ in paths
     - [x] Support all path types (absolute, relative, home directory)
     - [x] Add environment variable support (ANNZARRO_DATA_DIR)
     - [x] Document precedence order for configuration options
     - [x] Create README.md in data directory explaining usage
   - [x] Simplify startup scripts and processes
     - [x] Update run_annzarro.py to start only one server
     - [x] Add static directory configuration support
     - [x] Add environment variable support for port and static directory
     - [x] Document unified server architecture in SERVER_ARCHITECTURE.md

4. [x] Implement detailed matrix data integration:
   - [x] Update the UI components for data source selection:
     - [x] Modify visualization creation UI to include matrix data types
     - [x] Add matrix-specific options (cell/gene selection) in data source selection
     - [x] Create UI for selecting specific cells/genes or using focused items
   - [x] Implement data fetching and transformation:
     - [x] Create helper functions to fetch appropriate matrix data
     - [x] Add transformations for visualization-ready formats
     - [x] Implement response handlers for matrix data
   - [x] Add focused item integration:
     - [x] Connect matrix visualizations to focused cell/gene changes
     - [x] Update visualizations automatically when focus changes
     - [x] Add efficient caching for better performance
   - [ ] Implement lazy loading for large matrices:
     - [ ] Add Dask integration for lazy loading of large matrices
     - [ ] Implement chunked loading for .obsp and .varp matrices 
     - [ ] Add progressive loading with progress indicators
     - [ ] Support pagination for large matrix exploration

5. [ ] Implement frontend-only state management:
   - [ ] Move focused cell, gene, and species state to frontend
   - [ ] Eliminate POST requests to maintain read-only backend
   - [ ] Implement URL-based state sharing
   - [ ] Update GET requests to include all necessary parameters

6. [ ] Add file system change detection:
   - [ ] Implement server-side file watching for data directory
   - [ ] Add WebSocket support for real-time notifications
   - [ ] Create UI notifications for data changes
   - [ ] Add refresh options for affected components

7. [x] Revise matrix data integration approach:
   - [x] Implement client-side functions to retrieve .obsp and .varp matrices
   - [x] Integrate matrix data as selectable sources in existing visualization components
   - [x] Make matrix data respond to focused cell/gene changes
   - [x] Remove unnecessary standalone matrix visualization code
   - [ ] Test all matrix field types thoroughly

8. [x] Implement testing infrastructure:
   - [x] Create automated test suite for unified server
   - [x] Implement integration tests for server functionality
   - [x] Add end-to-end tests for API endpoints
   - [x] Create a test runner script (run_tests.py)
   - [ ] Set up command-line browser testing with console access
   - [ ] Add logging and error reporting to both client and server
   - [ ] Document testing procedures with examples