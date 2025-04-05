This should be a page that uses only html, javascript, plotly, and DataTables for vizualization and data selection. You can find an example dataset in the data directory (read the BACKEND_API_REFERENCE.md and use the python request package to interact with it and understand it. The server runs currently on port 8000). The idea is to make a comprehensive vizualization tool for anndata that is stored in the zarr format. The interface should be modern, simple, but very useful. It should present options to make plots for cells (using .obs, .obsm, and .layers data), and for genes (using .var .varm, acn .layers data). Note that cells are identified by the `_index` "column" of the .obs and genes by the `_index` column of .var. There are some constants we should keep track of on the frontend side:

1) the currently focused gene (can also be cleared)
If selected it should always be highlighted in the gene plots. Additionally, it aids to select the right column of the .layers in any gene plots. This constant should be always visible, and editable on the top of the page through a dropdown menu that you can also strat typing in to search it.
2) the currently focused cell (can also be cleared). This should work like the focused gene but select a row of any .layers for gene plots
3) an NCBI taxonomy ID and the associated species (homo sapiens as default)
4) Sets of gene, selected by the search builder in DataTaples panels (each panal makes a set)

The interface should be a tile manager. A button on the bottom to add a tile, each tile the option to split horizontally or vertically, spwaning a new tile. Each tile should be an object with its own state (configuration not the data it is showing). Tiles can be renamed. Tiles can be closed. All tiles (closed or open) are available to make a new tile. If a tile is used as a new tile wihile being opened, it is dublicated with a training number in the name to make it distinct. There should be a way to delet tiles. All pannels should be able to read and change each others state. Each panel type may be defined in its own file. It should be easy to make new panel types in the future.

Available tile types should be:
 1) Cell plot. A tile using any data from .obs, .obsm, .obsp, and .layers to make plots (description below).
 2) Gene plot. Like the cell plot but using data from .var, .varm, .varp, and layers.
 3) Cell table. Using DataTables to show cells with Searchbuilder, and columns from anywhere in .obs, .obsm, .obsp, and .layers.
 4) Gene tables. Same as Cell table but using data from .var, .varm, .varp, and layers.
 5) Gene set analysis. This is to show fetch and show results about gene sets similar to how it was done in `stringdb.py`.

### Cell plot
The plots should allow to pic any combination of x-, y-, and optionally z-axis, coloring, and hover info.
E.g., for the x-axis the first menue should allow to select .obs, .obsm, .obsp, or .layers. If .obs is selected, allow to select a column in a searchable menue. If .obsm is selected, first allow to select the obsm field from a dropdown menue, then allow to select a column within this array/dataframe. If .obsp is selected use the row of the focused cell (if the focused cell chanes this should be updated and the plot redrawn). If a layer is selected, then use the column of the focused gene (this can update as well and should trigger a redraw).
If a z-axis is selected, then the plot should switch to a 3-d plot. Make sure to accomodate be consistent with this, e.g., when drawing a legend.
Same data fields should be available when selecting a color. However, make sure to use it differently dependnng on it being numerical or a discrete (e.g., string). For discret coloring use a legend, and when a .obs column is selected and it is categorical, see if a list of colors is in .uns[col_name + "_colors"] (it has the same order as the categories but might not be quite the right length).
When the data to color by is numerical, allow selecting the colorpallet, and provide sliders to select the maximum and minim value (dependning on the actual range of the data). Cells with color values outside of this range should either be clipped to the boundary or removed from the plot (this should be controled witht a toggle).
By default the cell name should be in the hover info. However, there should be a way to append additional columns to this info (same columns as for the axis and colors).
This should allow to, e.g., use the first umap coordinate from the .obsm["X_umap"] for the x-axis and the .obs["log10_total_counts"] for the y-axis,  using the columns "HSC" from .obsm["fate_probabilities"], and using the cell name, .obs["celltype"] and .obsm["fate_probabilities"]["Ery"] in the hover info.
The panale should also have ways to control point size and opacity (default to full opacity).
The axis and colorbar labels should always be named by the field they show. E.g., f"obsm.{field_name}.{column_name}" for a field from .obsm.
When clicking on a point in the plot, this cell becomes the focused cell.
There should be selection to subset cells based on the subset selected in a cell table. A toggle should regulate wether to hide other cells from the plot or to just color them in light grey.

### Gene plot
This should be almost exactly like the cells plot but use .var, .varm, .vap, and .layers instead. When a layer is selected the focused cell should select the row and in .vap the focused gene should select the row too. When clicking on a point, this gene becomes the focused gene.

### Cell table
Shows a DataTable listing all cells and the first up to 5 columns of .obs by default. Any additional column, that can be used in the plot, can also be included as a column in the DataTable. Make a hideble side bar that lists all showing columns with a button to remove the column from the table for each column, and a plots button on the button that opens a menue to add a new column. Make sure to name it, e.g., f"obsm.{field_name}.{column_name}" for a column in .obsm to avoid name colissions. When selecting an .obsp field use the focused cell to select the row but do not update it when the focused cell changes. For a layer use the selected gene to pick a column but do not change the column when the focused gene changes. When clicking on a cell name, this cell should become the focused cell.
The DataTable should have the search builder enabled to filter the cells based on the column data.
The list of cells currently shown should be available for other panels, e.g., the cells plot. There should be a register toi list a reference to this set that allows the other panels to find it. When the selection is updated, e.g., though new filter criteria, then all panels that use it should be updated to reflect the new selection.
Stored lists remain available even when the panel is closed. However, when the panel is deleted from the list of restorable panels, then the list should go away too.

### Gene table
Just like the cell table but for genes, and columns from .var, .varm, .varp, and layers.

### Gene set analysis
This panel should be able to fetch a gene set from the gene table. Additionally, it should allow to map these to actual gene names by fetching the respective column from .var for the selected genes. The option to map to actual gene names should be prominent, but by default it should assume the listed genes are actually the gene names.
The panel should contain some collapsable results that are only fetched when they are expanded. The results should be:
A gene network image fetched from stringDB like in `stringdb.py`.
A scrollable list of the genes with links to all the resources like in `stringdb.py`.
Gene set enrichment analysis results like in `stringdb.py`.

We should see some basic stats about the curently selected anndata incuding the number of cells, and genes, etc. visible somewhere.

The user should be able to save and restore the sessions. There is an api to save, rename, fetch, and delet sessions. Sessions should also be made available for download and uploda. The session should include everything to restore the state of the client, including which dataset is used, the constants (focused gene, cell, taxonomy id), the panels, and the settings of each panel inlcuding the search builder. If the dataset is not found the user should have to select the dataset from a different source or under a different name. If certain data is missing to make a panel, than a warning should be displayed in the broken panel but everything else should be reconstructed as far as possible. In fact, there should be a way to change the dataset and thereby all the data, while trying to maintain the complete panel configuratuion, onlys swaping out the actual data values, attempting to remake the same plots/tables/sets etc. as far as possible with the new data.