/**
 * Text for CSV files and for shares shown as percentages: one CSV field, and a share (0 to 1) as "41.2%". Pure (no DOM,
 * no page state). The Count Plot, the Cell-Gene Plot and the Cell Grouping write their CSV files with `csvField`.
 */

/** A fraction (0 to 1) as text, three decimals at most: "0.412", "0.4", "<0.001"; 0 and 1 plain, never a % sign. */
export function fmtFraction(fraction) {
    if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '';
    if (fraction === 0 || fraction === 1) return String(fraction);
    if (fraction < 0.001) return '<0.001';
    return fraction.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
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
