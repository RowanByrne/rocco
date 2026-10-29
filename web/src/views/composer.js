// The note box at the top of the Workboard: type a note, paste or drop screenshots, Enter adds it to the inbox.
import { state } from '../state.js';
import { $ } from '../lib/dom.js';
import { api } from '../api.js';
import { refresh } from '../sync.js';
import { toast } from '../ui/toast.js';

let drafts = []; // screenshots waiting to go with the next note: { file, url }

const text = () => $('#noteText');

function renderDrafts() {
  $('#drafts').innerHTML = drafts.map((d, i) =>
    `<span class="th"><img src="${d.url}" alt="Attached screenshot"><button type="button" data-unshot="${i}" aria-label="Remove screenshot">×</button></span>`).join('');
}

function attach(file) {
  if (!file || !file.type.startsWith('image/')) return;
  drafts.push({ file, url: URL.createObjectURL(file) });
  renderDrafts();
}

function grow() {
  text().style.height = 'auto';
  text().style.height = text().scrollHeight + 'px';
}

async function addNote() {
  const note = text().value.trim(), shots = drafts;
  if (!note && !shots.length) return;
  text().value = '';
  drafts = [];
  renderDrafts();
  grow();
  try {
    const { id } = await api.note(note);
    for (const d of shots) await api.shot(id, d.file);
    await refresh();
  } catch (e) {
    // Put it all back so nothing is lost.
    text().value = note;
    drafts = shots;
    renderDrafts();
    grow();
    toast(`Couldn't add the note: ${e.message}`, 'var(--red)');
  }
}

export const focusComposer = () => text().focus();

export function initComposer() {
  const form = $('#composer');
  text().addEventListener('input', grow);
  text().addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(); } });
  form.addEventListener('submit', e => { e.preventDefault(); addNote(); });
  $('#drafts').addEventListener('click', e => {
    const remove = e.target.closest('[data-unshot]');
    if (remove) { drafts.splice(+remove.dataset.unshot, 1); renderDrafts(); }
  });
  // A screenshot pasted anywhere on the Workboard goes with the next note.
  document.addEventListener('paste', e => {
    if (state.view !== 'workboard') return;
    const files = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile());
    if (!files.length) return;
    e.preventDefault();
    files.forEach(attach);
    focusComposer();
  });
  form.addEventListener('dragover', e => { e.preventDefault(); form.classList.add('drag'); });
  form.addEventListener('dragleave', () => form.classList.remove('drag'));
  form.addEventListener('drop', e => { e.preventDefault(); form.classList.remove('drag'); [...e.dataTransfer.files].forEach(attach); });
}
