// The command palette (Ctrl+K): find any task, view, project or action and go there.
import { state } from '../state.js';
import { $ } from '../lib/dom.js';
import { html, render } from '../lib/html.js';
import { ACTIONS, keyFor, run } from '../hotkeys.js';
import { go } from '../router.js';
import { switchProject } from '../projects.js';
import { openTask, openTaskById } from '../views/workboard.js';
import { showArchive } from '../views/archive.js';
import { showUsage } from '../views/usage.js';
import { showDoc } from '../views/docs.js';
import { openOnboarding } from './onboarding.js';
import { shownTheme, toggleTheme } from '../theme.js';

const modal = $('#paletteModal');
const input = $('#paletteInput');
const list = $('#paletteList');
const STATUS = { inbox: 'Suggested', queued: 'Up next', working: 'Working', stuck: 'Needs you', ready: 'To test', done: 'Approved' };
let items = [], shown = [], active = 0;

export const paletteOpen = () => modal.classList.contains('open');

function collect() {
  const views = ['workboard', 'history', 'docs', 'updates', 'thumbnails', 'connections', 'settings', 'metrics', 'ads'];
  return [
    ...ACTIONS.filter(a => !a.id.startsWith('go-') && a.id !== 'palette').map(a => ({ group: 'Actions', label: a.label, hint: keyFor(a.id), run: () => run(a.id) })),
    { group: 'Actions', label: shownTheme() === 'dark' ? 'Light mode' : 'Dark mode', hint: 'Theme', run: toggleTheme },
    { group: 'Actions', label: 'New project', run: () => openOnboarding() },
    { group: 'Actions', label: 'Archive: older tasks', run: () => { go('workboard'); showArchive(); } },
    { group: 'Actions', label: 'Usage: time and tokens by task', run: () => { go('workboard'); showUsage(); } },
    ...views.map(v => ({ group: 'Go to', label: v[0].toUpperCase() + v.slice(1), hint: keyFor(`go-${v}`), run: () => go(v) })),
    ...state.tasks.filter(t => t.status !== 'removed').map(t => ({
      group: 'Tasks', label: `${t.id} ${t.title}`, hint: t.kind === 'plan' ? 'Feature plan' : t.kind === 'question' ? (t.status === 'ready' ? 'Answered' : 'Question') : STATUS[t.status] || '',
      run: () => { go('workboard'); openTask(t.id); },
    })),
    ...state.projects.filter(p => p.id !== state.project).map(p => ({ group: 'Switch project', label: p.name, hint: p.phase, run: () => switchProject(p.id) })),
    ...(state.docs?.docs || []).map(d => ({ group: 'Docs', label: d.path, hint: d.title, run: () => showDoc(d.path) })),
  ];
}

function draw() {
  const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
  shown = items.filter(i => words.every(w => `${i.label} ${i.group} ${i.hint || ''}`.toLowerCase().includes(w))).slice(0, 40);
  // A task's id that isn't on the board opens it from the archive; any other words can be looked for there.
  const typed = input.value.trim(), id = typed.toUpperCase();
  if (/^T-\d+$/.test(id) && !state.tasks.some(t => t.id === id)) shown.push({ group: 'Archive', label: `Open ${id}`, hint: 'From the archive', run: () => { go('workboard'); openTaskById(id); } });
  else if (typed.length > 1) shown.push({ group: 'Archive', label: `Search older tasks for "${typed}"`, hint: 'Archive', run: () => { go('workboard'); showArchive(typed); } });
  active = Math.min(active, Math.max(0, shown.length - 1));
  render(shown.length ? shown.map((i, n) => html`${i.group !== shown[n - 1]?.group ? html`<div class="pl-group">${i.group}</div>` : ''}<div class="pl-item${n === active ? ' on' : ''}" data-n=${n} role="option" aria-selected=${n === active ? 'true' : 'false'}><span>${i.label}</span><span class="pl-hint">${i.hint || ''}</span></div>`)
    : html`<div class="pl-empty">Nothing matches</div>`, list);
  list.querySelector('.pl-item.on')?.scrollIntoView({ block: 'nearest' });
}

export function openPalette() {
  if (paletteOpen()) { closePalette(); return; }
  items = collect();
  input.value = '';
  active = 0;
  draw();
  modal.classList.add('open');
  input.focus(); // at once, so keys typed straight after Ctrl+K land in it
}

export function closePalette() { modal.classList.remove('open'); }

function choose(n) {
  const item = shown[n];
  if (!item) return;
  closePalette();
  item.run();
}

input.addEventListener('input', () => { active = 0; draw(); });
input.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, shown.length - 1); draw(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); draw(); }
  else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
});
list.addEventListener('click', e => { const el = e.target.closest('.pl-item'); if (el) choose(+el.dataset.n); });
modal.addEventListener('click', e => { if (e.target === modal) closePalette(); });
