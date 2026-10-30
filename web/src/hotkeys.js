// Hotkeys: every action that has one, its default, and the user's own binding (Settings).
// They work while Rocco's window has focus.
import { settings, setSetting } from './settings.js';

export const ACTIONS = [
  { id: 'note',           label: 'Write a note',          key: 'N' },
  { id: 'voice',          label: 'Voice note: start or stop', key: 'Alt+V' },
  { id: 'capture',        label: 'Capture Studio',        key: 'Alt+S' },
  { id: 'type',           label: 'Change the note type',  key: 'Alt+T' },
  { id: 'palette',        label: 'Command palette',       key: 'Ctrl+K' },
  { id: 'go-workboard',   label: 'Go to Workboard',       key: 'Alt+1' },
  { id: 'go-history',     label: 'Go to History',         key: 'Alt+2' },
  { id: 'go-connections', label: 'Go to Connections',     key: 'Alt+3' },
  { id: 'go-settings',    label: 'Go to Settings',        key: 'Alt+4' },
];

const runners = {};
let paused = false; // while Settings is recording a new binding

export const keyFor = id => settings().keys[id] ?? ACTIONS.find(a => a.id === id)?.key ?? '';
export const register = (id, run) => { runners[id] = run; };
export const run = id => runners[id]?.();
export const pause = on => { paused = on; };

// 'Ctrl+Alt+K' from a key event; '' for a lone modifier.
export function comboOf(e) {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return '';
  const key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', key].filter(Boolean).join('+');
}

export function bind(id, combo) {
  const keys = { ...settings().keys };
  // A combo belongs to one action: take it off any other first.
  for (const a of ACTIONS) if (a.id !== id && keyFor(a.id) === combo && combo) keys[a.id] = '';
  keys[id] = combo;
  setSetting('keys', keys);
}

export function resetKeys(id) {
  const keys = { ...settings().keys };
  if (id) delete keys[id]; else for (const k of Object.keys(keys)) delete keys[k];
  setSetting('keys', keys);
}

// Plain keys (no Ctrl or Alt) only count when you're not typing.
document.addEventListener('keydown', e => {
  if (paused || e.repeat) return;
  const combo = comboOf(e);
  if (!combo) return;
  const typing = e.target.matches?.('input, textarea, select, [contenteditable]');
  const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
  if (plain && (typing || document.querySelector('.modal.open'))) return;
  const action = ACTIONS.find(a => keyFor(a.id) === combo);
  if (!action || !runners[action.id]) return;
  e.preventDefault();
  runners[action.id]();
});
