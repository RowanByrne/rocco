// The note box at the top of the Workboard: type or say a note, pick its type, attach, paste, drop or
// capture screenshots (and draw on them); Enter adds it to Up next. What's typed is kept, by project, until it's sent
// (lib/drafts.js), so a reload doesn't lose it.
import { state, on, emit } from '../state.js';
import { $ } from '../lib/dom.js';
import { html, render, nothing } from '../lib/html.js';
import { lineIcon } from '../lib/icons.js';
import { draft } from '../lib/drafts.js';
import { api } from '../api.js';
import { refresh } from '../sync.js';
import { toast } from '../ui/toast.js';
import { settings } from '../settings.js';
import { keyFor } from '../hotkeys.js';
import { capturing, captureFrame, stopCapture } from '../capture.js';
import { voiceSupported, listening, listeningFor, toggleVoice, cancelVoice } from '../voice.js';
import { shotOf, imagesIn, shotThumbs, shotClick } from '../ui/shots.js';
import { openSheetKey } from '../ui/sheet.js';
import { go } from '../router.js';
import { noteMode, sendInMode, leaveMode } from './conductor.js';

// Question isn't work: it goes to the conductor to answer, and the answer shows under the note box.
const TYPES = [['bug', 'Bug'], ['tweak', 'Tweak'], ['idea', 'Idea'], ['question', 'Question']];
const CAMERA = lineIcon('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/>', 16, 1.9);
const STOP = lineIcon('<rect x="7" y="7" width="10" height="10" rx="2"/>', 16, 1.9);
const MIC = lineIcon('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>', 16, 1.9);
let drafts = []; // screenshots going with the next note: { file, url }
let type = '';
let voiceTimer = null;
let sending = false; // a note is on its way: Enter again doesn't send it twice

const text = () => $('#noteText');
const hint = id => keyFor(id) ? ` (${keyFor(id)})` : '';

function renderDrafts() { render(shotThumbs(drafts), $('#drafts')); }

// What's in the box, shown and kept.
function setText(value) {
  text().value = value;
  draft.set('note', value);
  grow();
}

// The toolbar's live parts: capture, type chips and the mic.
export function renderComposerTools() {
  render(capturing()
    ? html`<span class="cap on"><button type="button" class="tool-label" data-capture title="Capture Studio${hint('capture')}"><i></i>Capture</button><button type="button" class="cap-stop" data-capture-stop title="Stop sharing Studio" aria-label="Stop sharing Studio">×</button></span>`
    : html`<button type="button" class="tool-label" data-capture title="Pick Studio's window once, then capture it any time${hint('capture')}">${CAMERA}Capture Studio</button>`, $('#captureSlot'));
  render(TYPES.map(([id, label]) => html`<button type="button" class="type t-${id}${type === id ? ' on' : ''}" data-type=${id} role="radio" aria-checked=${type === id ? 'true' : 'false'} title="${id === 'question' ? 'Just need to know something? Ask, and the answer shows here' : label}${hint('type')}">${label}</button>`), $('#types'));
  const asking = type === 'question', mode = noteMode();
  text().placeholder = mode ? mode.placeholder : asking ? 'What do you want to know?' : 'What did you notice?';
  $('#sendBtn').title = mode ? 'Send' : asking ? 'Ask' : 'Add to Up next';
  $('#sendBtn').setAttribute('aria-label', $('#sendBtn').title);
  const mic = !settings().voice || !voiceSupported() ? nothing : listening()
    ? html`<button type="button" class="mic on" data-voice title="Stop${hint('voice')}">${STOP}<span>${Math.floor(listeningFor() / 60)}:${String(listeningFor() % 60).padStart(2, '0')}</span></button>`
    : html`<button type="button" class="mic" data-voice title="Voice note${hint('voice')}" aria-label="Voice note">${MIC}</button>`;
  render(mic, $('#voiceSlot'));
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

// The screenshots, one at a time; returns the ones that didn't go up.
async function upload(id, shots) {
  const failed = [];
  for (const d of shots) { try { await api.shot(id, d.file); } catch { failed.push(d); } }
  return failed;
}

// The note is in, without some of its screenshots: Retry sends just those, to the same note.
function shotsFailed(id, failed) {
  const n = failed.length;
  toast(`Note added, but ${n} screenshot${n === 1 ? '' : 's'} didn't upload`, 'var(--amber)', { label: 'Retry', run: async () => {
    const still = await upload(id, failed);
    await refresh();
    if (still.length) shotsFailed(id, still); else toast(`${n === 1 ? 'The screenshot is' : 'The screenshots are'} on the note now`);
  } }, 20000);
}

// A note with screenshots is made on hold, so the conductor doesn't pick it up before they're on it; this lets it go.
async function release(id) {
  try { return (await api.release(id)).opened || ''; }
  catch (e) {
    toast(`Note added, but it couldn't be handed to Rocco: ${e.message}`, 'var(--red)', { label: 'Retry', run: async () => { const opened = await release(id); await refresh(); if (opened !== null) toast('Handed to Rocco', 'var(--violet)'); } }, 20000);
    return null;
  }
}

async function addNote() {
  if (sending) return;
  // What it still hears after this isn't part of the note.
  if (listening()) cancelVoice();
  const note = text().value.trim(), shots = drafts, noteType = type;
  // Answering the conductor, or replying to it: words only. Screenshots stay for a note.
  if (noteMode()) {
    if (!note) { text().focus(); return; }
    setText('');
    sending = true;
    try { await sendInMode(note); } catch { setText(note); }
    sending = false;
    return;
  }
  if (!note && !shots.length) return;
  setText('');
  drafts = [];
  type = '';
  renderDrafts();
  renderComposerTools();
  sending = true;
  let made;
  try {
    made = await api.note(note, noteType, shots.length > 0);
  } catch (e) {
    // Put it all back so nothing is lost.
    setText(note);
    drafts = shots;
    type = noteType;
    renderDrafts();
    renderComposerTools();
    toast(`Couldn't add the note: ${e.message}`, 'var(--red)');
    sending = false;
    return;
  }
  // From here the note exists: a screenshot that fails doesn't put the text back, or sending it again would add it twice.
  const failed = await upload(made.id, shots);
  const handed = shots.length ? await release(made.id) : made.opened || '';
  // opened: no conductor was running, so Rocco opened the user's agent to pick it up.
  const opened = handed || made.opened || '';
  await refresh();
  sending = false;
  emit('note-sent', noteType);
  if (failed.length) shotsFailed(made.id, failed);
  if (handed === null) return; // its own toast said so
  toast((noteType === 'question' ? 'Asked. The answer shows here.' : 'Added to Up next') + (opened ? ` ${opened} started, minimized in your taskbar, to pick it up.` : ''),
    noteType === 'question' || opened ? 'var(--claude)' : 'var(--violet)');
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
    toggleVoice(words => setText(before + (before && words ? ' ' : '') + words));
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
  text().value = draft.get('note');
  grow();
  text().addEventListener('input', () => { draft.set('note', text().value); grow(); });
  text().addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); addNote(); } });
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
  // A different project: its own note in progress, and none of the old one's screenshots or type.
  on('project', () => {
    if (listening()) cancelVoice();
    drafts = [];
    type = '';
    text().value = draft.get('note');
    grow();
    renderDrafts();
    renderComposerTools();
  });
  on('voice', () => {
    renderComposerTools();
    clearInterval(voiceTimer);
    if (listening()) voiceTimer = setInterval(renderComposerTools, 1000);
  });
  on('voice-error', error => toast(error === 'not-allowed' ? 'The microphone is blocked for this site' : `Voice stopped: ${error}`, 'var(--amber)'));
}
