/**
 * The links the header offers a signed-in user, from `auth/me`.
 *
 * Everyone signed in gets "Change password"; an admin also gets the admin
 * interface. Whether a link shows is cosmetic: the server checks the user on
 * every request to /admin and answers 403 to anyone else. Pure, so it runs under `node --test`.
 */
import { appUrl } from './app-url.js';

/**
 * @param {Object|null} me - `{auth_enabled, username, is_admin}`.
 * @returns {Array<{id: string, text: string, title: string, href: string}>}
 */
export function accountLinks(me) {
    if (!me || !me.auth_enabled || !me.username) return [];
    const links = [];
    if (me.is_admin) {
        links.push({ id: 'admin', text: 'Admin', title: 'Open the admin interface', href: appUrl('/admin') });
    }
    links.push({ id: 'password', text: 'Change password', title: 'Change your password', href: appUrl('/account/password') });
    return links;
}
