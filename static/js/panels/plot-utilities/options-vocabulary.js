/**
 * One name for one setting, on every plot (pop-over unification). Each field of the shared Plot Options has a concept: its own
 * id, or the one its id maps to (`CONCEPTS`: the Cell Plot and Gene Plot keep their stored keys, `showGrid`, `gridLineWidth`, and
 * the Cell-Gene and Count plots theirs, `grid`, `gridWidth`). A concept in `LABELS` has that label whatever the plot declares
 * (options-schema.js applies it when a field is registered), so one plot cannot call a setting something else.
 * Interface text: US spelling. Pure, no DOM.
 */

/** concept -> the label every plot shows */
// export-unused-ok: the Node test holds every kind to it
export const LABELS = Object.freeze({
    fontFamily: 'Font', fontSize: 'Font size (px)', textColor: 'Text color', bgColor: 'Background',
    grid: 'Grid lines', gridColor: 'Grid color', gridWidth: 'Grid line width (px)',
    axisLines: 'Axis lines', axisColor: 'Axis color', axisWidth: 'Axis line width (px)',
    zeroLines: 'Zero lines', zeroColor: 'Zero line color', zeroWidth: 'Zero line width (px)',
    axisTitles: 'Axis titles', tickLabels: 'Tick labels', tickMarks: 'Tick marks', tickCount: 'Ticks per axis',
    showLegend: 'Show legend', legendPosition: 'Legend position', legendTitle: 'Legend title', legendColumns: 'Columns', legendColumnGap: 'Column gap (px)',
    exportWidth: 'Width (px)', exportHeight: 'Height (px)', export2x: 'Export at 2x'
});

/** field id -> concept, where the id is not the concept's own name */
// export-unused-ok: the Node test reads the concept of a field id
export const CONCEPTS = Object.freeze({
    showGrid: 'grid', gridLineWidth: 'gridWidth', showAxisLines: 'axisLines', axisLineWidth: 'axisWidth', showZeroLines: 'zeroLines',
    zeroLineColor: 'zeroColor', zeroLineWidth: 'zeroWidth', showAxisTitles: 'axisTitles', showAxisLabels: 'tickLabels',
    showTickMarks: 'tickMarks', showLegendTitle: 'legendTitle', scaleExport: 'export2x'
});

/** `field` with its concept and, when the vocabulary has it, the one label (a copy). */
export function withVocabulary(field) {
    const concept = CONCEPTS[field.id] || field.id;
    return { ...field, concept, label: LABELS[concept] || field.label };
}
