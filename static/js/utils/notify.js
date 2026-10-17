/**
 * Let any module show a notice through the app's notification UI without
 * importing main.js (which would be circular). main.js listens for the
 * event and calls its _showNotification.
 *
 * @param {string} title
 * @param {string} message
 * @param {'info'|'warning'|'error'|'success'} [type]
 * @param {number} [duration] - ms; omitted: the rules of the toast (an error until
 *   closed, otherwise by the words); 0: until closed
 */
export const NOTIFY_EVENT = 'annzarro:notify';

export function notify(title, message, type = 'warning', duration = undefined) {
    if (typeof document === 'undefined' || typeof document.dispatchEvent !== 'function') return;
    const Ctor = typeof CustomEvent === 'function' ? CustomEvent : null;
    if (!Ctor) return;
    document.dispatchEvent(new Ctor(NOTIFY_EVENT, { detail: duration === undefined ? { title, message, type } : { title, message, type, duration } }));
}
