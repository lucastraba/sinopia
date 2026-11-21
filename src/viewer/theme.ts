import { ref } from 'vue';

export type ThemeChoice = 'auto' | 'light' | 'dark';

/** Shared with the inline script in index.html and the map index page (serve.ts). */
export const THEME_KEY = 'sinopia-theme';

const ORDER: ThemeChoice[] = ['auto', 'light', 'dark'];

const stored = (): ThemeChoice => {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'auto';
  } catch {
    return 'auto';
  }
};

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

/** The user's choice: Auto follows the device; Light and Dark are remembered per browser. */
export const theme = ref<ThemeChoice>(stored());

const apply = () => {
  const dark = theme.value === 'dark' || (theme.value === 'auto' && systemDark.matches);
  document.documentElement.classList.toggle('dark', dark);
};

systemDark.addEventListener('change', apply);
apply();

export const cycleTheme = () => {
  theme.value = ORDER[(ORDER.indexOf(theme.value) + 1) % ORDER.length] ?? 'auto';
  try {
    if (theme.value === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme.value);
  } catch {
    // Storage blocked (private mode): the choice lasts until the page closes.
  }
  apply();
};
