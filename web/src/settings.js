// The user's settings, kept in this browser. emit('settings') after every change.
import { emit } from './state.js';
import { storage } from './lib/storage.js';

const DEFAULTS = {
  notifications: true,  // desktop notifications while Rocco is in the background
  liveSteps: true,      // Working cards show the worker's last steps; off: just a progress bar
  mascot: true,         // Rocco on top of the note box
  voice: false,         // voice notes stay off until the user accepts where the audio goes
  voiceLang: 'en-US',
  keys: {},             // hotkey overrides: action id -> combo, '' for none
};

let current = { ...DEFAULTS };
try { current = { ...DEFAULTS, ...JSON.parse(storage.get('rocco.settings') || '{}') }; } catch { /* keep the defaults */ }

export const settings = () => current;

export function setSetting(key, value) {
  current = { ...current, [key]: value };
  storage.set('rocco.settings', JSON.stringify(current));
  emit('settings');
}
