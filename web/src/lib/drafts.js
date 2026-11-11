// What the user is in the middle of typing or picking, kept in this browser so a reload, a Rocco update or a send that
// fails doesn't lose it. Each is kept by project and what it's for ('note', 'sheet:T-041'), and cleared when it's sent.
import { state } from '../state.js';
import { storage } from './storage.js';

const KEY = 'rocco.drafts';
let all = {};
try { all = JSON.parse(storage.get(KEY) || '{}') || {}; } catch { all = {}; }

let timer = 0;
const write = () => { clearTimeout(timer); timer = 0; storage.set(KEY, JSON.stringify(all)); };
const save = () => { if (!timer) timer = setTimeout(write, 250); };
const key = name => `${state.project}|${name}`;
const empty = value => value == null || value === '' || (Array.isArray(value) && !value.length);

export const draft = {
  get: (name, /** @type {any} */ fallback = '') => all[key(name)] ?? fallback,
  has: name => key(name) in all,
  // A string, or something small that JSON keeps (picked answers, a reply box's mode and text).
  set(name, value) {
    if (empty(value)) delete all[key(name)]; else all[key(name)] = value;
    save();
  },
  clear(name) { this.set(name, ''); },
  // This project's drafts whose name starts with prefix, as [rest of the name, value].
  list: prefix => Object.entries(all).filter(([k]) => k.startsWith(key(prefix))).map(([k, value]) => [k.slice(key(prefix).length), value]),
  // Drops this project's drafts under prefix that aren't for one of ids (a task that's gone).
  prune(prefix, ids) {
    const keep = new Set(ids);
    for (const [id] of this.list(prefix)) if (!keep.has(id)) { delete all[key(prefix + id)]; save(); }
  },
};

// The last keystrokes before the page goes.
addEventListener('pagehide', () => { if (timer) write(); });
