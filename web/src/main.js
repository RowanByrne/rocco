// Rocco starts here: find the project, wire up every part, decide what re-renders on each change, then keep the data current.
import { state, on } from './state.js';
import { storage } from './lib/storage.js';
import { DEMO } from './api.js';
import * as demo from './demo.js';
import * as sync from './sync.js';
import { register } from './hotkeys.js';
import { loadProjects } from './projects.js';
import { showView, go, syncUrl } from './router.js';
import { initSidebar, renderSidebar, renderMe, loadMe } from './sidebar.js';
import { initWorkboard, renderWorkboard, openTask } from './views/workboard.js';
import { initComposer, focusComposer, captureStudio, toggleVoiceNote, cycleType } from './views/composer.js';
import { initMascot } from './mascot.js';
import { initConnections, renderConnections, loadConnections } from './views/connections.js';
import { initHistory, renderHistory, loadHistory } from './views/history.js';
import { initDocs, renderDocs, loadDocs, resetDocs } from './views/docs.js';
import { initSettings, renderSettings } from './views/settings.js';
import { initNewProject, newProjectOpen, closeNewProject } from './dialogs/new-project.js';
import { openPalette, paletteOpen, closePalette } from './dialogs/palette.js';
import { markupOpen, closeMarkup } from './dialogs/markup.js';
import { closeSheet, openSheetKey } from './ui/sheet.js';
import { closeMenus, menuOpen } from './ui/menu.js';

// The project in the address, else the last one opened here (demo mode keeps its own sample projects).
state.project = new URLSearchParams(location.search).get('p') || (DEMO ? '' : storage.get('rocco.project')) || '';

// What re-renders when something changes. A task's sheet stays as it is until it closes.
on('tasks', () => {
  renderSidebar();
  if (!openSheetKey() || openSheetKey() === 'approved') renderWorkboard();
  if (state.view === 'history' && state.history) renderHistory(); // lane cards show their tasks
});
on('side', renderSidebar);
on('sheet-closed', renderWorkboard);
on('me', () => { renderMe(); renderConnections(); });
on('connections', renderConnections);
on('history', renderHistory);
on('docs', renderDocs);
on('settings', () => { renderSettings(); renderWorkboard(); });
on('open-task', id => { go('workboard'); openTask(id); }); // a desktop notification was clicked
on('view', () => {
  closeSheet();
  closeMenus();
  if (state.view === 'connections') loadConnections(false);
  if (state.view === 'history') { renderHistory(); loadHistory(); }
  if (state.view === 'docs') { renderDocs(); loadDocs(); }
  if (state.view === 'settings') renderSettings();
});
on('project', () => {
  closeSheet();
  closeMenus();
  syncUrl();
  sync.reset();
  resetDocs();
  renderSidebar();
  renderWorkboard();
  renderConnections();
  renderHistory();
  renderDocs();
  sync.load();
  loadConnections(false);
  loadHistory();
  loadDocs();
});

// What each hotkey does (the keys themselves are in hotkeys.js, and the user's own in Settings).
register('note', focusComposer);
register('voice', toggleVoiceNote);
register('capture', captureStudio);
register('type', cycleType);
register('palette', openPalette);
for (const view of ['workboard', 'history', 'docs', 'connections', 'settings']) register(`go-${view}`, () => go(view));

// A view or doc typed or pasted into the address.
addEventListener('hashchange', () => showView(location.hash.slice(1)));

// Esc closes the top-most thing.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (markupOpen()) closeMarkup();
  else if (paletteOpen()) closePalette();
  else if (newProjectOpen()) closeNewProject();
  else if (menuOpen()) closeMenus();
  else closeSheet();
});

(async () => {
  try { await loadProjects(); } catch { state.online = false; }
  initSidebar();
  initWorkboard();
  initComposer();
  initMascot();
  initConnections();
  initHistory();
  initDocs();
  initSettings();
  initNewProject();
  showView(location.hash.slice(1));
  syncUrl();
  renderMe();
  renderSidebar();
  renderWorkboard();
  renderConnections();
  sync.start();
  loadMe();
  loadConnections(false); // for the sidebar badge
  if (state.view !== 'docs') loadDocs(); // for the palette; opening Docs loads them anyway
  setInterval(() => loadConnections(false), 5 * 60000);
  setInterval(() => { if (!openSheetKey()) { renderSidebar(); renderWorkboard(); } }, 30000); // keeps "12m" and "4m ago" current
  if (DEMO) demo.start();
})();
