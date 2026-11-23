/**
 * Text for CSV files and for shares shown as percentages: one CSV field, and a share (0 to 1) as "41.2%". Pure (no DOM,
 * no page state). The Count Plot, the Cell-Gene Plot and the Cell Grouping write their CSV files with `csvField`.
 */

/** A share (0 to 1) as a percentage: "41.2%", "0.4%", "<0.1%". */
export function fmtPercent(fraction) {
    if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '';
    if (fraction === 0) return '0%';
    const p = fraction * 100;
    if (p < 0.1) return '<0.1%';
    return `${p.toFixed(1)}%`;
}

/**
 * One CSV field. Quoted when it holds a comma, quote or line break. Text that a spreadsheet would
 * run as a formula (it starts with = + - @ and is not a plain number) gets a leading apostrophe.
 */
export function csvField(value, { text = false } = {}) {
    if (value === null || value === undefined) return '';
    let s = String(value);
    if (text && /^[=+\-@\t\r]/.test(s) && !Number.isFinite(Number(s))) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
