// Rocco starts here: find the project, wire up every part, decide what re-renders on each change, then keep the data current.
import { state, on } from './state.js';
import { storage } from './lib/storage.js';
import { DEMO } from './api.js';
import * as demo from './demo.js';
import * as sync from './sync.js';
import { loadProjects } from './projects.js';
import { showView, go, syncUrl } from './router.js';
import { initSidebar, renderSidebar, renderMe, loadMe } from './sidebar.js';
import { initWorkboard, renderWorkboard } from './views/workboard.js';
import { initComposer, focusComposer } from './views/composer.js';
import { initConnections, renderConnections, loadConnections } from './views/connections.js';
import { initHistory, renderHistory, loadHistory } from './views/history.js';
import { initNewProject, newProjectOpen, closeNewProject } from './dialogs/new-project.js';
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
on('view', () => {
  closeSheet();
  closeMenus();
  if (state.view === 'connections') loadConnections(false);
  if (state.view === 'history') { renderHistory(); loadHistory(); }
});
on('project', () => {
  closeSheet();
  closeMenus();
  syncUrl();
  sync.reset();
  renderSidebar();
  renderWorkboard();
  renderConnections();
  renderHistory();
  sync.load();
  loadConnections(false);
  loadHistory();
});

// Esc closes the top-most thing; N starts a note from anywhere.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (newProjectOpen()) closeNewProject();
    else if (menuOpen()) closeMenus();
    else closeSheet();
    return;
  }
  const typing = e.target.matches?.('textarea, input');
  if (!typing && e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !newProjectOpen()) {
    e.preventDefault();
    if (state.view !== 'workboard') go('workboard');
    focusComposer();
  }
});

(async () => {
  try { await loadProjects(); } catch { state.online = false; }
  initSidebar();
  initWorkboard();
  initComposer();
  initConnections();
  initHistory();
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
  setInterval(() => loadConnections(false), 5 * 60000);
  setInterval(() => { if (!openSheetKey()) { renderSidebar(); renderWorkboard(); } }, 30000); // keeps "12m" and "4m ago" current
  if (DEMO) demo.start();
})();
