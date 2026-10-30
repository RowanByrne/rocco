// The command palette (Ctrl+K): find any task, view, project or action and go there.
import { state } from '../state.js';
import { $, esc } from '../lib/dom.js';
import { ACTIONS, keyFor, run } from '../hotkeys.js';
import { go } from '../router.js';
import { switchProject } from '../projects.js';
import { openTask } from '../views/workboard.js';
import { openNewProject } from './new-project.js';

const modal = $('#paletteModal');
const input = $('#paletteInput');
const list = $('#paletteList');
const STATUS = { inbox: 'Inbox', queued: 'Up next', working: 'Working', stuck: 'Stuck', ready: 'To test', done: 'Approved' };
let items = [], shown = [], active = 0;

export const paletteOpen = () => modal.classList.contains('open');

function collect() {
  const views = ['workboard', 'history', 'connections', 'settings', 'metrics'];
  return [
    ...ACTIONS.filter(a => !a.id.startsWith('go-') && a.id !== 'palette').map(a => ({ group: 'Actions', label: a.label, hint: keyFor(a.id), run: () => run(a.id) })),
    { group: 'Actions', label: 'New project', run: openNewProject },
    ...views.map(v => ({ group: 'Go to', label: v[0].toUpperCase() + v.slice(1), hint: keyFor(`go-${v}`), run: () => go(v) })),
    ...state.tasks.filter(t => t.status !== 'removed').map(t => ({
      group: 'Tasks', label: `${t.id} ${t.title}`, hint: t.kind === 'plan' ? 'Feature plan' : t.kind === 'question' ? (t.status === 'ready' ? 'Answered' : 'Question') : STATUS[t.status] || '',
      run: () => { go('workboard'); openTask(t.id); },
    })),
    ...state.projects.filter(p => p.id !== state.project).map(p => ({ group: 'Switch project', label: p.name, hint: p.phase, run: () => switchProject(p.id) })),
  ];
}

function render() {
  const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
  shown = items.filter(i => words.every(w => `${i.label} ${i.group} ${i.hint || ''}`.toLowerCase().includes(w))).slice(0, 40);
  active = Math.min(active, Math.max(0, shown.length - 1));
  let group = '';
  list.innerHTML = shown.length ? shown.map((i, n) => {
    const head = i.group !== group ? `<div class="pl-group">${esc(group = i.group)}</div>` : '';
    return `${head}<div class="pl-item${n === active ? ' on' : ''}" data-n="${n}" role="option" aria-selected="${n === active}"><span>${esc(i.label)}</span><span class="pl-hint">${esc(i.hint || '')}</span></div>`;
  }).join('') : '<div class="pl-empty">Nothing matches</div>';
  list.querySelector('.pl-item.on')?.scrollIntoView({ block: 'nearest' });
}

export function openPalette() {
  if (paletteOpen()) { closePalette(); return; }
  items = collect();
  input.value = '';
  active = 0;
  render();
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

input.addEventListener('input', () => { active = 0; render(); });
input.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, shown.length - 1); render(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
  else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
});
list.addEventListener('click', e => { const el = e.target.closest('.pl-item'); if (el) choose(+el.dataset.n); });
modal.addEventListener('click', e => { if (e.target === modal) closePalette(); });
