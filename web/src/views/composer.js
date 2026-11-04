// The note box at the top of the Workboard: type or say a note, pick its type, attach, paste, drop or
// capture screenshots (and draw on them); Enter adds it to Up next.
import { state, on, emit } from '../state.js';
import { $ } from '../lib/dom.js';
import { api } from '../api.js';
import { refresh } from '../sync.js';
import { toast } from '../ui/toast.js';
import { settings } from '../settings.js';
import { keyFor } from '../hotkeys.js';
import { capturing, captureFrame, stopCapture } from '../capture.js';
import { voiceSupported, listening, listeningFor, toggleVoice } from '../voice.js';
import { shotOf, imagesIn, shotsHTML, shotClick } from '../ui/shots.js';
import { openSheetKey } from '../ui/sheet.js';
import { go } from '../router.js';
import { noteMode, sendInMode, leaveMode } from './conductor.js';

// Question isn't work: it goes to the conductor to answer, and the answer shows under the note box.
const TYPES = [['bug', 'Bug'], ['tweak', 'Tweak'], ['idea', 'Idea'], ['question', 'Question']];
let drafts = []; // screenshots going with the next note: { file, url }
let type = '';
let voiceTimer = null;

const text = () => $('#noteText');
const hint = id => keyFor(id) ? ` (${keyFor(id)})` : '';
const svg = paths => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

function renderDrafts() { $('#drafts').innerHTML = shotsHTML(drafts); }

// The toolbar's live parts: capture, type chips and the mic.
export function renderComposerTools() {
  $('#captureSlot').innerHTML = capturing()
    ? `<span class="cap on"><button type="button" class="tool-label" data-capture title="Capture Studio${hint('capture')}"><i></i>Capture</button><button type="button" class="cap-stop" data-capture-stop title="Stop sharing Studio" aria-label="Stop sharing Studio">×</button></span>`
    : `<button type="button" class="tool-label" data-capture title="Pick Studio's window once, then capture it any time${hint('capture')}">${svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/>')}Capture Studio</button>`;
  $('#types').innerHTML = TYPES.map(([id, label]) => `<button type="button" class="type t-${id}${type === id ? ' on' : ''}" data-type="${id}" role="radio" aria-checked="${type === id}" title="${id === 'question' ? 'Just need to know something? Ask, and the answer shows here' : label}${hint('type')}">${label}</button>`).join('');
  const asking = type === 'question', mode = noteMode();
  text().placeholder = mode ? mode.placeholder : asking ? 'What do you want to know?' : 'What did you notice?';
  $('#sendBtn').title = mode ? 'Send' : asking ? 'Ask' : 'Add to Up next';
  $('#sendBtn').setAttribute('aria-label', $('#sendBtn').title);
  const on = settings().voice && voiceSupported();
  $('#voiceSlot').innerHTML = on ? (listening()
    ? `<button type="button" class="mic on" data-voice title="Stop${hint('voice')}">${svg('<rect x="7" y="7" width="10" height="10" rx="2"/>')}<span>${Math.floor(listeningFor() / 60)}:${String(listeningFor() % 60).padStart(2, '0')}</span></button>`
    : `<button type="button" class="mic" data-voice title="Voice note${hint('voice')}" aria-label="Voice note">${svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>')}</button>`) : '';
}

function attach(file) {
  const shot = shotOf(file);
  if (!shot) return;
  drafts.push(shot);
  renderDrafts();
}

function grow() {
  text().style.height = 'auto';
  text().style.height = text().scrollHeight + 'px';
}

async function addNote() {
  if (listening()) toggleVoice(() => {});
  const note = text().value.trim(), shots = drafts, noteType = type;
  // Answering the conductor, or replying to it: words only. Screenshots stay for a note.
  if (noteMode()) {
    if (!note) { text().focus(); return; }
    text().value = '';
    grow();
    try { await sendInMode(note); } catch { text().value = note; grow(); }
    return;
  }
  if (!note && !shots.length) return;
  text().value = '';
  drafts = [];
  type = '';
  renderDrafts();
  renderComposerTools();
  grow();
  try {
    const { id, opened } = await api.note(note, noteType);
    for (const d of shots) await api.shot(id, d.file);
    await refresh();
    emit('note-sent', noteType);
    // opened: no conductor was running, so Rocco opened the user's agent to pick it up.
    toast((noteType === 'question' ? 'Asked. The answer shows here.' : 'Added to Up next') + (opened ? ` ${opened} started, minimized in your taskbar, to pick it up.` : ''),
      noteType === 'question' || opened ? 'var(--claude)' : 'var(--violet)');
  } catch (e) {
    // Put it all back so nothing is lost.
    text().value = note;
    drafts = shots;
    type = noteType;
    renderDrafts();
    renderComposerTools();
    grow();
    toast(`Couldn't add the note: ${e.message}`, 'var(--red)');
  }
}

export const focusComposer = () => { go('workboard'); text().focus(); };

export async function captureStudio() {
  try {
    attach(await captureFrame());
    focusComposer();
  } catch (e) {
    if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(`Couldn't capture: ${e.message}`, 'var(--red)');
  }
}

export function toggleVoiceNote() {
  if (!voiceSupported()) { toast('This browser has no speech recognition. Use Chrome or Edge.', 'var(--amber)'); return; }
  if (!settings().voice) { toast('Voice notes are off', 'var(--amber)', { label: 'Settings', run: () => go('settings') }); return; }
  focusComposer();
  const before = text().value.trim();
  try {
    toggleVoice(words => { text().value = before + (before && words ? ' ' : '') + words; grow(); });
  } catch (e) { toast(e.message, 'var(--amber)'); }
}

export function cycleType() {
  const ids = ['', ...TYPES.map(t => t[0])];
  type = ids[(ids.indexOf(type) + 1) % ids.length];
  renderComposerTools();
}

export function initComposer() {
  const form = $('#composer');
  renderComposerTools();
  text().addEventListener('input', grow);
  text().addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(); } });
  form.addEventListener('submit', e => { e.preventDefault(); addNote(); });
  form.addEventListener('click', async e => {
    const el = e.target.closest('button, img');
    if (!el) return;
    // Picking a type makes it a note, even with the conductor's question open.
    if (el.dataset.type) { type = type === el.dataset.type ? '' : el.dataset.type; if (type && noteMode()) leaveMode(); renderComposerTools(); }
    else if (el.hasAttribute('data-capture')) captureStudio();
    else if (el.hasAttribute('data-capture-stop')) stopCapture();
    else if (el.hasAttribute('data-voice')) toggleVoiceNote();
    else if (await shotClick(el, drafts)) renderDrafts();
  });
  $('#attachBtn').addEventListener('click', () => $('#attachInput').click());
  $('#attachInput').addEventListener('change', e => { [...e.target.files].forEach(attach); e.target.value = ''; text().focus(); });
  // A screenshot pasted anywhere on the Workboard goes with the next note; with a task's sheet open, it's the sheet's.
  document.addEventListener('paste', e => {
    if (state.view !== 'workboard' || openSheetKey()) return;
    const files = imagesIn(e.clipboardData?.items);
    if (!files.length) return;
    e.preventDefault();
    files.forEach(attach);
    text().focus();
  });
  form.addEventListener('dragover', e => { e.preventDefault(); form.classList.add('drag'); });
  form.addEventListener('dragleave', () => form.classList.remove('drag'));
  form.addEventListener('drop', e => { e.preventDefault(); form.classList.remove('drag'); [...e.dataTransfer.files].forEach(attach); });

  on('capture', renderComposerTools);
  on('settings', renderComposerTools);
  on('note-mode', renderComposerTools);
  on('voice', () => {
    renderComposerTools();
    clearInterval(voiceTimer);
    if (listening()) voiceTimer = setInterval(renderComposerTools, 1000);
  });
  on('voice-error', error => toast(error === 'not-allowed' ? 'The microphone is blocked for this site' : `Voice stopped: ${error}`, 'var(--amber)'));
}
