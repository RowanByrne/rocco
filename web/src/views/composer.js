// The note box under the chat: type or say a message, say what it is (or leave that to Rocco), attach, paste, drop
// or capture screenshots (and draw on them); Enter sends it. What's typed is kept, by project, until it's sent
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
import { noteMode, sendInMode } from './conductor.js';

// What a message is (README.md "Sorting"). Auto leaves it to Rocco, which sorts each one first: a question is
// answered in the chat with no card kept, a fix becomes a card that's done and handed back to test, and a feature
// is planned first, then built in a thread of its own. Picking one says so yourself.
const TYPES = [
  ['', 'Auto', 'Rocco sorts it: an answer, a fix, or a feature', 'Message Rocco: something to fix, a question, a feature'],
  ['fix', 'Fix', 'A small change: a card that gets done, then you test it', 'What needs fixing?'],
  ['question', 'Ask', 'Just a question: answered here, with no card', 'What do you want to know?'],
  ['feature', 'Feature', 'Something bigger: Rocco plans it first, then it gets a thread of its own', 'Describe the feature'],
];
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
  // Something for one message, card or thread isn't sorted: it has no kind to pick.
  const mode = noteMode(), kind = TYPES.find(t => t[0] === type) || TYPES[0];
  render(mode ? nothing : TYPES.map(([id, label, title]) => html`<button type="button" class="type${type === id ? ' on' : ''}" data-type=${id} role="radio" aria-checked=${type === id ? 'true' : 'false'} title="${title}${hint('type')}">${label}</button>`), $('#types'));
  text().placeholder = mode ? mode.placeholder : kind[3];
  $('#sendBtn').title = `${mode ? 'Send' : type === 'question' ? 'Ask' : 'Send to Rocco'} (Enter)`;
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
  const box = text();
  box.style.height = 'auto';
  // Empty, it's one line: there's nothing to measure (a placeholder that wraps would be measured instead).
  if (box.value) box.style.height = box.scrollHeight + 'px';
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
  // It shows in the chat, so nothing more is said, unless an agent had to be opened for it.
  if (opened) toast(`${opened} started, minimized in your taskbar, to pick it up.`, 'var(--claude)');
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
  const ids = TYPES.map(t => t[0]);
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
    if (el.hasAttribute('data-type')) { type = el.dataset.type; renderComposerTools(); text().focus(); }
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

  // Measured again once the page has its size, and whenever that changes: what's typed wraps differently.
  requestAnimationFrame(grow);
  addEventListener('resize', grow);
  on('view', grow);
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
