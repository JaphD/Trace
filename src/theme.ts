export type Theme = 'dark' | 'light';

const storageKey = 'trace-theme';

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function restoreTheme() {
  let theme: Theme = 'light';
  try {
    if (localStorage.getItem(storageKey) === 'dark') theme = 'dark';
  } catch {
    // The default theme also works when browser storage is unavailable.
  }
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    // Keep the current view usable even if the preference cannot be saved.
  }
}
