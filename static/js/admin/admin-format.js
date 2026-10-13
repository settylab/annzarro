/**
 * Pure formatting helpers for the admin interface (bytes, ages, quota
 * percentages, the username rule). No DOM, so they run under `node --test`.
 */

/** The server's rule for new usernames (design 1.7); the server enforces it too. */
export const USERNAME_PATTERN = /^[A-Za-z0-9._@-]{1,64}$/;

/**
 * @param {*} name
 * @returns {boolean} whether `name` is an acceptable new username
 */
export function isValidUsername(name) {
    return typeof name === 'string' && USERNAME_PATTERN.test(name);
}

/**
 * Binary units, one decimal under 10 and none above, e.g. "12 KB", "1.5 GB".
 * @param {number|null|undefined} n - bytes
 * @returns {string} "-" for a missing or negative value
 */
export function formatBytes(n) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '-';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = n;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i += 1;
    }
    const text = i === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
    return `${text} ${units[i]}`;
}

/**
 * Megabytes as the health page shows them ("410 MB", "1.9 GB").
 * @param {number|null|undefined} mb
 * @returns {string}
 */
export function formatMb(mb) {
    if (typeof mb !== 'number' || !Number.isFinite(mb) || mb < 0) return '-';
    return formatBytes(mb * 1024 * 1024);
}

/**
 * A duration in seconds as its two largest units: "2 s", "5 min", "3 h 10 min", "2 d 4 h".
 * @param {number|null|undefined} seconds
 * @returns {string}
 */
export function formatAge(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '-';
    const s = Math.floor(seconds);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
    const d = Math.floor(h / 24);
    return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/**
 * "2026-10-11 09:12" in the viewer's local time, from an ISO timestamp.
 * @param {string|null|undefined} iso
 * @returns {string} "-" when missing or unparsable
 */
export function formatTimestamp(iso) {
    if (!iso) return '-';
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return '-';
    const p = (v) => String(v).padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

/**
 * Thousands separators: 12031 -> "12,031".
 * @param {number|null|undefined} n
 * @returns {string}
 */
export function formatCount(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Share of a limit used, clamped to 0..100. An unlimited or missing limit gives 0.
 * @param {number} used
 * @param {number|null|undefined} limit
 * @returns {number} whole percent
 */
export function quotaPercent(used, limit) {
    if (typeof used !== 'number' || typeof limit !== 'number' || !(limit > 0)) return 0;
    return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
}

/**
 * Bootstrap contextual colour for a quota bar: warn at 80%, danger at 100%.
 * @param {number} percent
 * @returns {'success'|'warning'|'danger'}
 */
export function quotaLevel(percent) {
    if (percent >= 100) return 'danger';
    if (percent >= 80) return 'warning';
    return 'success';
}
