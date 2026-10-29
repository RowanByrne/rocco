// New project: the server runs the template's tools\new-project.ps1; the dialog shows its output, then opens the project.
import { $ } from '../lib/dom.js';
import { api } from '../api.js';
import { loadProjects, switchProject } from '../projects.js';
import { toast } from '../ui/toast.js';

const modal = $('#newModal');
const log = $('#npLog');

export const newProjectOpen = () => modal.classList.contains('open');

export function openNewProject() {
  $('#newForm').reset();
  log.hidden = true;
  log.classList.remove('err');
  $('#npCreate').disabled = false;
  modal.classList.add('open');
  setTimeout(() => $('#npName').focus(), 50);
}

export function closeNewProject() { modal.classList.remove('open'); }

async function create() {
  const name = $('#npName').value.trim(), code = $('#npCode').value.trim().toUpperCase(), repo = $('#npRepo').value.trim();
  $('#npCreate').disabled = true;
  log.hidden = false;
  log.classList.remove('err');
  log.textContent = 'Starting…';
  try {
    const { job } = await api.newProject({ name, code, repo });
    for (;;) {
      await new Promise(r => setTimeout(r, 1000));
      const s = await api.job(job);
      log.textContent = s.output || 'Working…';
      log.scrollTop = log.scrollHeight;
      if (s.running) continue;
      if (!s.ok) throw new Error('see the output above');
      await loadProjects();
      closeNewProject();
      switchProject(s.project);
      toast(`${name} is ready`);
      return;
    }
  } catch (e) {
    log.classList.add('err');
    if (log.textContent === 'Starting…') log.textContent = e.message;
    $('#npCreate').disabled = false;
    toast(`Couldn't create ${name}: ${e.message}`, 'var(--red)');
  }
}

export function initNewProject() {
  $('#newForm').addEventListener('submit', e => { e.preventDefault(); create(); });
  $('#npCancel').addEventListener('click', closeNewProject);
  modal.addEventListener('click', e => { if (e.target === modal) closeNewProject(); });
}
