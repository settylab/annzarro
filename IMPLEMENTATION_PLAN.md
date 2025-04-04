# Implementation Plan for Annzarro

This plan outlines the necessary changes to address the reported issues and required improvements to the Annzarro application.

## Current Status (Updated on April 3, 2025)

We have made significant progress with Annzarro, implementing a stateless server architecture, fixing critical JavaScript errors, unifying the server approach, and adding proper support for additional matrix types like .varm, .obsp, and .varp.

Key accomplishments:
- Successfully implemented stateless server architecture with direct file access (completed)
- Added dataset_path parameter to all data access endpoints, eliminating server-side dataset state
- Created comprehensive test coverage for the stateless API endpoints (all tests now passing)
- Implemented configurable limits for request sizes to handle datasets with millions of cells
- Fixed JavaScript SyntaxError in main.js by completely removing file:// protocol support
- Implemented a unified server approach using a single port for both frontend and backend
- Added comprehensive support for .obsp and .varp matrices in both server and client code
- Fixed UI-related errors with proper null-checking in the codebase
- Created robust unit and integration testing infrastructure

The stateless server architecture now:
1. Supports multiple simultaneous active datasets without server-side state
2. Provides efficient direct file access for each request using the zarr_reader.open_dataset_by_path() method
3. Returns complete metadata in the initial dataset request
4. Enables highly scalable access to large single-cell datasets
5. Allows for configurable request limits for large datasets

All API endpoints now accept a dataset_path parameter, enabling concurrent use by multiple users with different datasets without requiring server-side state maintenance. This improves scalability and reliability while simplifying the server implementation.

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
- [x] Resolve the dual server architecture (Python vs. frontend)
- [x] Clarify and document why different ports are used for frontend and backend
- [x] Fix server startup errors and ensure consistent port usage
- [x] Eliminate support for file:// protocol completely
- [x] Remove all file:// protocol code paths from the codebase
- [x] Document the server architecture clearly in README.md
- [ ] Refactor server.py into multiple modules for better maintainability:
  - [ ] Remove all selection and focus endpoints completely
  - [ ] Split into core.py, data_routes.py, zarr_routes.py, static_routes.py
  - [ ] Create a central routes registry
  - [ ] Implement better error handling for all modules
- [ ] Enhance support for remote zarr archives:
  - [ ] Ensure all dataset_path parameters can handle URLs (S3, HTTP)
  - [ ] Add credential handling for remote storage
  - [ ] Implement caching mechanism for remote datasets

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
- [ ] Complete support for obsm/varm multi-column matrices
  - [ ] Fix metadata extraction for all obsm and varm matrices
  - [ ] Ensure consistent handling for both obsm and varm matrices
  - [ ] Properly expose all matrices (like kompot_de_* in varm) in aging.zarr
  - [ ] Add specialized visualization support for differential expression data in varm
  - [ ] Create frontend UI to work with both obsm and varm multi-dimensional data
  - [ ] Handle non-standard matrix types consistently in both obsm and varm
- [x] Implement lazy loading with dataset-identifier architecture
  - [x] Return complete metadata in initial dataset load
  - [x] Include matrix dimensions, types, and summary statistics
  - [x] Modify API endpoints to accept dataset_id parameter
  - [x] Support partial matrix loading via row/column indices
  - [x] Implement chunked loading with pagination
  - [ ] Add progress indicators for large matrix operations
  - [ ] Create server-side caching by dataset ID
- [ ] Integrate matrix data as selectable sources in existing visualizations
  - [ ] Add .obsp and .varp as data source options alongside .obs, .obsm, and layers
  - [ ] For .obsp matrices, allow selecting specific cells or the focused cell
  - [ ] For .varp matrices, allow selecting specific genes or the focused gene
  - [ ] Make these matrix data sources update when focused cells or genes change
  - [ ] Remove unnecessary standalone matrix visualization code
- [ ] Test UI controls for all matrix type selection
- [ ] Add comprehensive matrix type documentation

## 5. Dataset-Centric Frontend State Management
- [x] Implement dataset-centric state management
  - [x] Associate all state (selections, focused items) with specific dataset ID 
  - [x] Store dataset registry in client-side state with active datasets
  - [x] Enable dataset-level operations (close, refresh, compare)
  - [x] Implement switching between datasets without losing state
  - [x] Support multiple simultaneous active datasets
- [x] Create fully stateless server architecture
  - [x] Include dataset_path parameter in all data requests
  - [x] Eliminate POST endpoints for dataset loading/unloading
  - [ ] Make server completely stateless regarding all data (partially complete)
    - [x] Remove selection and focus endpoints completely (these are client-side concerns)
    - [x] Ensure no server-side state for any query
    - [ ] Update all paths, routes, and parameters to support both local and remote datasets
  - [x] Convert all loading operations to on-demand data fetching
  - [x] Use direct file access for each request without maintaining state
  - [ ] Use query parameters for all selection/filter criteria (incomplete)
  - [x] Support URL-based state sharing with dataset context
- [ ] Implement frontend-only selection and filtering
  - [x] Store selections in client-side state linked to dataset ID
  - [x] Pass selections as parameters in data requests
  - [ ] Support URL-based sharing of selections
  - [x] Create dataset-aware visualization components
- [ ] Add filesystem change detection and notifications
  - [ ] Implement server-side file watching for data directory
  - [ ] Add WebSocket support for real-time notifications
  - [ ] Create UI components for data change notifications
  - [ ] Add refresh options for plots, tables, and indices
  - [ ] Support automatic or manual refresh modes
- [ ] Enhance remote dataset access
  - [ ] Implement proper caching for remote datasets (S3, HTTP)
  - [ ] Add progress indicators for remote data access
  - [ ] Support authenticated access to remote datasets
  - [ ] Create specialized data fetching strategies for different storage backends

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

## 7. Dataset-Identifier Based Loading Architecture
- [x] Refactor loadDemoData to loadDataFromPath (complete terminology shift)
- [x] Rename loadAvailableDemoData to loadAvailableData throughout codebase
- [x] Implement dataset-identifier based architecture
  - [x] Modify API endpoints to accept dataset_id parameter for all data requests
  - [x] Create client-side dataset registry to track multiple active datasets
  - [x] Support switching between datasets without requiring reload from server
  - [x] Maintain dataset-specific selections/state in the client
  - [x] Enable dataset comparison views with multiple active datasets
- [x] Convert to fully stateless server implementation
  - [x] Eliminate server-side dataset loading/unloading state
  - [x] Implement direct zarr file access for each request
  - [x] Use path-based dataset identification without server-side state
  - [x] Support multiple concurrent users of the same datasets efficiently
  - [x] Ensure proper file closing after each request
- [x] Enhance metadata and lazy loading mechanism
  - [x] Return complete metadata for all matrices in initial load (obsm, varm, obsp, varp)
  - [x] Include size information for all matrix types
  - [x] Add data type information (categorical vs continuous, sparse vs dense)
  - [x] Support lazy loading with partial matrix loading via indices
  - [x] Implement view pagination for large matrices
- [ ] Optimize data access performance
  - [ ] Leverage zarr's chunking for efficient partial reads
  - [ ] Use query parameters to request only needed data chunks
  - [ ] Implement client-side caching and cache invalidation
  - [ ] Add progressive loading for large matrices
- [ ] Implement proper loading indicators and error messages
- [ ] Test data loading from various sources (URL, S3)
- [ ] Add better error handling for malformed or incomplete zarr archives
- [ ] Implement progress indicators for large dataset loading
- [ ] Refactor code for better maintainability
  - [ ] Split server.py into multiple modules by functionality
  - [ ] Create a common API parameter validation layer
  - [ ] Implement unified error handling for all routes
  - [ ] Add comprehensive logging for API requests
- [ ] Enhance remote dataset support
  - [ ] Update zarr_reader to properly handle all URL types (http://, s3://, etc.)
  - [ ] Create specialized handlers for different storage backends
  - [ ] Implement smart caching for remote datasets
  - [ ] Add authentication support for private repositories

## 8. Remote Storage Integration
- [ ] Verify zarr's native S3 support is working correctly
- [ ] Test with real S3 buckets containing zarr data
- [ ] Implement HTTP storage backend for remote zarr over HTTP/HTTPS
- [ ] Add GCP storage backend support
- [ ] Document configuration requirements for all remote storage options
- [ ] Implement proper error handling for remote access issues
- [ ] Add better credential management for authenticated storage
- [ ] Create a unified storage abstraction layer in zarr_reader
- [ ] Implement smart caching of remote data chunks
- [ ] Add options for connection timeout and retry strategies
- [ ] Create specialized performance optimizations for remote data

## 9. Always Visible Information
- [ ] Create a persistent UI element to show focused gene, cell, species, and basic anndata info
- [ ] Update species customization UI to support custom species ID and name
- [ ] Store selection information client-side with URL parameters
- [ ] Make sure this information is visible at all times, regardless of panel layout

## Implementation Priority
1. 🔴 Achieve Truly Stateless Architecture (HIGHEST PRIORITY)
   - ✅ Remove all POST/DELETE endpoints from server.py
   - ✅ Remove server-side state for selection and focus
   - ✅ Move all state management to client side
   - [ ] Update all client code to include dataset_path parameters
   - [ ] Convert loadDataFromPath to selectDataset without server-side state
   - [ ] Implement client-side caching for improved performance
   - [ ] Ensure all dataset_path parameters can handle both local paths and URLs (S3, HTTP)

2. 🔴 Refactor Server Code and Enhance Remote Support (HIGH PRIORITY)
   - [ ] Split server.py into multiple modules for better maintainability
   - [ ] Create handlers for different storage backends (local, S3, HTTP)
   - [ ] Implement unified validation and error handling for all routes
   - [ ] Add caching layer for remote datasets to improve performance
   - [ ] Create utility functions for URL/path handling across all code

3. 🔴 Fix obsm/varm Metadata and Data Access Issues (HIGH PRIORITY)
   - [ ] Complete the metadata extraction for both obsm and varm in zarr_reader.py
   - [ ] Ensure all multi-dimensional matrices are properly included in dataset metadata
   - [ ] Add consistent handling for obsm and varm matrices including non-standard entries
   - [ ] Add explicit support for multi-column dataframes like kompot_de_* matrices
   - [ ] Create specialized visualization components for both cell-level and gene-level data
   - [ ] Add frontend UI for exploring gene-level statistics from varm matrices
   - [ ] Add visualization tools for obsm data beyond standard embeddings

3. ✅ Fix JavaScript errors - Critical issue preventing the application from working properly
   - ✅ Focus on the SyntaxError at line 1054 in main.js (unexpected 'else' token)
   - ✅ Remove all file:// protocol support code as it's no longer needed
   - ✅ Ensure zarr library is properly loaded 
   - ✅ Fix server startup issues with clear port configuration

4. ✅ Unify server architecture and configuration
   - ✅ Implement single-server approach on one port
   - ✅ Make data directory fully configurable
   - ✅ Document server architecture clearly

5. ✅ Revise matrix data integration approach
   - ✅ Modify data source selection UI to include matrix types alongside existing sources
     - ✅ Update the data source dropdown in plot configurations to include .obsp/.varp
     - ✅ Add cell/gene selection for matrix data sources (or use focused cell/gene)
     - ✅ Implement appropriate UI for selecting matrix columns/cells
   - ✅ Implement data fetching logic for selected matrix cells/genes
     - ✅ For .obsp matrices, fetch data for selected cells or focused cell
     - ✅ For .varp matrices, fetch data for selected genes or focused gene
   - ✅ Connect matrix data sources to focused cell/gene changes
     - ✅ Add event listeners for focus changes to update visualizations
     - ✅ Implement caching for better performance
   - ✅ Remove unnecessary standalone matrix visualization code
   - ✅ Update tests to reflect the new approach

4. Implement dataset-identifier based architecture (HIGHEST PRIORITY)
   - ✅ Create dataset-aware API endpoints that accept dataset_id parameters
   - ✅ Redesign frontend to support multiple active datasets simultaneously
   - ✅ Create client-side dataset registry for tracking loaded datasets
   - ✅ Implement dataset-specific state management
   - ✅ Add enhanced dataset metadata with complete matrix information
   - ✅ Support lazy loading through specific matrix indices
   - ✅ Enable dataset comparison views
   - ✅ Convert to fully stateless server implementation
   - ✅ Eliminate server-side dataset loading state
   - ✅ Implement direct zarr file access for each request without server state
   - [ ] **CRITICAL**: Update frontend to match stateless API architecture  
     - [ ] Revise UI to properly handle dataset selection instead of loading
     - [ ] Update all client functions to include dataset_path in API requests
     - [ ] Harmonize terminology (datasets are "selected" not "loaded")

5. Enhance client-side UI for dataset management
   - Add dataset-centric UI controls (open, close, switch between datasets)
   - Create visual indicators for current active dataset
   - Design dataset information panels with complete metadata
   - Implement dataset search and filtering functionality
   - Add support for dataset tagging and organization

6. Add filesystem change detection and notifications
   - Implement WebSocket-based file change notifications
   - Add UI components for data change alerts
   - Support manual and automatic refresh options
   - Create dataset-aware refresh functionality

7. Implement comprehensive testing infrastructure
   - Add command-line browser testing capabilities
   - Create automated tests for all core functionality
   - Implement tests specifically for multi-dataset functionality
   - Document testing procedures

8. Interface improvements and polish
   - Fix splitting and resizing behavior
   - Add persistent information panel
   - Improve error handling and user feedback
   - Enhance dataset loading progress indicators

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
- ⚠️ **INTERFACE MISMATCH**: Current frontend still uses "load dataset" functions but backend is fully stateless using dataset_path parameters
- ⚠️ Frontend functions need updating to align with stateless API (particularly loadDataFromPath)
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

## Critical Implementation Issues

There are three critical issues in the current implementation that must be addressed:

### 1. POST/DELETE Endpoints Must Be Removed

The server still contains stateful endpoints using POST/DELETE methods for selections and focus:
- `/api/v1/data/selection/cells` (GET/POST/DELETE)
- `/api/v1/data/selection/genes` (GET/POST/DELETE)
- `/api/v1/data/focus/cell` (GET/POST/DELETE)
- `/api/v1/data/focus/gene` (GET/POST/DELETE)

All of these stateful endpoints should be removed:
- Selection and focus state should be maintained entirely client-side
- Only GET endpoints should remain, and only as read-only references
- All operations must be on-demand with no server-side session state
- Connections to external resources should be managed by the client
- Any resource connections that need to be reused should be maintained by the client

### 2. Frontend-Backend Interface Mismatch

There's a mismatch between how the frontend and backend handle datasets. The backend is only partially converted to a stateless API where endpoints accept a `dataset_path` parameter. However, the frontend still uses a "load dataset" model with functions like `loadDataFromPath()` designed for the previous architecture.

Required changes:

1. The `loadDataFromPath()` function in main.js must be redesigned to:
   - Focus on dataset selection rather than "loading" - no state kept on server
   - Properly pass dataset_path to all API requests
   - Maintain all state client-side, including selections and focus
   - Fully support the stateless API model with no persistent server connections

2. All frontend API requests need to include the dataset_path parameter:
   - Remove any code that relies on server-side state
   - Pass the necessary context with each request
   - Implement client-side caching for performance
   - Remove all POST requests for selections and focus

3. UI terminology must be updated to reflect the new approach:
   - Replace "Load Dataset" with "Select Dataset"
   - Update all documentation and tooltips
   - Maintain a consistent mental model across the application

### 3. Incomplete obsm/varm Metadata and Access

Inspection of the aging.zarr dataset shows important multi-dimensional matrices in varm are not properly accessible. The same issue likely affects obsm data as well.

- File structure in data/aging.zarr/varm/ shows:
  - PCs
  - kompot_de_mahalanobis_Young_to_Old_groups 
  - kompot_de_mean_lfc_Young_to_Old_groups
  - kompot_de_weighted_lfc_Young_to_Old_groups

- Similar multi-dimensional matrices may exist in obsm beyond the standard embeddings.

Issues to fix:
- The metadata for both obsm and varm is incomplete in API responses
- Ensure all obsm/varm matrices are exposed consistently in dataset info
- Add explicit endpoint support for accessing both obsm/varm data
- Update the frontend to properly display and interact with all multi-dimensional matrices
- Ensure proper data typing for multi-column matrices in both obsm and varm
- Add frontend visualization tools for differential expression data (varm) and cell-level metadata (obsm)
- Implement consistent handling across both obsm and varm matrices

## TODOs for Next Implementation Session
1. ✅ Fix the JavaScript errors in main.js:
   - ✅ Fixed SyntaxError at line 1054 with unexpected 'else' token
   - ✅ **COMPLETELY REMOVED** all file:// protocol code paths
   - [ ] Debug zarr library loading issues
   - [ ] Test with command-line browser tools
   - [ ] Update frontend to align with stateless API architecture

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

5. [ ] Implement frontend-only state management (HIGHEST PRIORITY):
   - [ ] Move ALL selection and focus state to frontend components
   - [ ] Remove all POST/DELETE endpoints from server.py
   - [ ] Convert all client-server interactions to stateless GET requests
   - [ ] Add dataset_path parameters to all remaining API calls
   - [ ] Implement URL-based state sharing for selections and focus
   - [ ] Add client-side caching for improved performance
   - [ ] Update all UI terminology to "Select Dataset" instead of "Load Dataset"

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