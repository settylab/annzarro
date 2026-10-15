/**
 * The header's theme toggle: three icon buttons, System (default), Light and
 * Dark, the chosen one pressed. Shared by the main page and the admin pages
 * (both load Font Awesome). The choice is kept per browser by utils/theme.js.
 */
import { THEME_MODES, startTheme } from './theme.js';

const CHOICES = {
    system: { icon: 'fa-desktop', label: 'System', title: 'Colour theme: follow the system' },
    light: { icon: 'fa-sun', label: 'Light', title: 'Colour theme: light' },
    dark: { icon: 'fa-moon', label: 'Dark', title: 'Colour theme: dark' }
};

/**
 * Fill `container` with the toggle and start the theme.
 * @param {Element} container
 * @param {Object} [controller] a startTheme() result; started here when absent
 * @returns the controller
 */
export function mountThemeToggle(container, controller) {
    const theme = controller || startTheme();
    container.textContent = '';
    const group = document.createElement('div');
    group.className = 'btn-group btn-group-sm theme-toggle-group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Colour theme');
    const buttons = {};
    for (const mode of THEME_MODES) {
        const c = CHOICES[mode];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-outline-secondary theme-toggle-btn';
        b.dataset.themeMode = mode;
        b.title = c.title;
        b.setAttribute('aria-label', c.label);
        const i = document.createElement('i');
        i.className = `fas ${c.icon}`;
        i.setAttribute('aria-hidden', 'true');
        b.appendChild(i);
        b.addEventListener('click', () => { theme.setMode(mode); sync(); });
        buttons[mode] = b;
        group.appendChild(b);
    }
    const sync = () => {
        for (const mode of THEME_MODES) {
            const on = theme.mode === mode;
            buttons[mode].classList.toggle('active', on);
            buttons[mode].setAttribute('aria-pressed', on ? 'true' : 'false');
        }
    };
    sync();
    container.appendChild(group);
    return theme;
}
