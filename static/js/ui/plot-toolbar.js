/**
 * The plot toolbar: one row that ends every plot panel's control grid, its buttons always in the same order (design
 * note options-ux-080 section 4; operator, 2026-11-23: "place the plot options and other similar buttons similarly in
 * all plots"):
 *
 *   [panel actions] [menus ▾] ................................ [Undo] [⚙ Plot Options]
 *
 * - actions: the panel's own buttons (Save as grouping, 3D, Refresh, 3D Plot, Equal aspect, ...);
 * - menus: pop-over buttons that set how the values read (Cluster ▾, Color ▾);
 * - a gap that takes the rest of the row, so Undo and Plot Options sit at its right end in every panel;
 * - Undo, then Plot Options last.
 * Every button gets the same classes (`btn btn-sm btn-outline-secondary`), size and gap; Plot Options gets the gear.
 * Toggle Controls hides the row with the grid (it is in the grid's element). Used by the Cell-Gene Plot and the Cell
 * Count Plot (WP-5a); WP-5b puts the Cell Plot and Gene Plot on it. Styles: static/css/plot-options.css
 * (`.az-plot-toolbar`). Test hooks: `.az-plot-toolbar`, `[data-toolbar-slot=actions|menus|undo|options]`.
 */

const BUTTON = ['btn', 'btn-sm', 'btn-outline-secondary'];

/** A button styled as every toolbar button, marked with its place (`data-toolbar-slot`). */
function styled(button, place) {
    button.classList.add(...BUTTON);
    button.classList.remove('btn-link');
    button.dataset.toolbarSlot = place;
    return button;
}

/**
 * Make the toolbar. The buttons are the row's own children (no wrappers), in the order above.
 * @param {{actions?: HTMLElement[], menus?: HTMLElement[], undo?: HTMLElement, options?: HTMLElement, className?: string}} [parts]
 *   `className`: the panel's own class for the row (`ccnt-toolbar`), beside `az-plot-toolbar`
 * @returns {{element: HTMLElement, add: Function}} `add(parts)` puts more buttons in their places (a part mounted later)
 */
export function createPlotToolbar(parts = {}) {
    const element = document.createElement('div');
    element.className = `az-plot-toolbar${parts.className ? ` ${parts.className}` : ''}`;
    element.setAttribute('role', 'toolbar');
    element.setAttribute('aria-label', 'Plot');
    const gap = document.createElement('span');
    gap.className = 'az-plot-toolbar__gap';
    const now = { actions: [], menus: [], undo: null, options: null };

    function add({ actions = [], menus = [], undo = null, options = null } = {}) {
        now.actions.push(...actions.map((b) => styled(b, 'actions')));
        now.menus.push(...menus.map((b) => styled(b, 'menus')));
        if (undo) now.undo = styled(undo, 'undo');
        if (options) {
            now.options = styled(options, 'options');
            options.classList.add('az-plot-options-btn');
            if (!options.querySelector('.az-gear')) {
                const gear = document.createElement('i');
                gear.className = 'fas fa-cog az-gear';
                gear.setAttribute('aria-hidden', 'true');
                options.prepend(gear, ' ');
            }
        }
        element.replaceChildren(...now.actions, ...now.menus, gap, ...[now.undo, now.options].filter(Boolean));
    }
    add(parts);
    return { element, add };
}
