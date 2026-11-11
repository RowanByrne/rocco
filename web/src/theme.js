// The look: light (the default), dark, or whichever the system is on. Kept in this browser. index.html applies it
// before anything is drawn, so the page never flashes the other one; this keeps it current after that.
import { storage } from './lib/storage.js';
import { emit } from './state.js';

const KEY = 'rocco.theme';
const system = matchMedia('(prefers-color-scheme: dark)');

export const THEMES = [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']];
export const theme = () => { const t = storage.get(KEY); return THEMES.some(x => x[0] === t) ? t : 'light'; };
// What's on screen: 'light' or 'dark'.
export const shownTheme = () => theme() === 'system' ? (system.matches ? 'dark' : 'light') : theme();

function apply() { document.documentElement.dataset.theme = shownTheme(); }

export function setTheme(name) {
  storage.set(KEY, name);
  apply();
  emit('settings');
}
export const toggleTheme = () => setTheme(shownTheme() === 'dark' ? 'light' : 'dark');

system.addEventListener('change', () => { if (theme() === 'system') { apply(); emit('settings'); } });
apply();
