// Settings: notifications, the Workboard's Working cards, voice notes, and hotkeys. Kept in this browser.
import { $, esc } from '../lib/dom.js';
import { settings, setSetting } from '../settings.js';
import { ACTIONS, keyFor, comboOf, bind, resetKeys, pause } from '../hotkeys.js';
import { askPermission } from '../notify.js';
import { voiceSupported } from '../voice.js';
import { toast } from '../ui/toast.js';

let recording = null; // the action whose new hotkey is being pressed

const toggle = (key, on) => `<button class="switch" role="switch" aria-checked="${on}" data-setting="${key}"><span></span></button>`;
const row = (title, sub, control) => `<div class="set-row"><div class="set-text"><div class="set-title">${title}</div><div class="set-sub">${sub}</div></div>${control}</div>`;
const keyHTML = combo => combo ? combo.split('+').map(k => `<kbd>${esc(k)}</kbd>`).join('') : '<span class="unset">None</span>';

export function renderSettings() {
  const s = settings();
  const permission = 'Notification' in window ? Notification.permission : 'unsupported';
  const blocked = permission === 'denied' ? ' Your browser is blocking them: allow notifications for this site in its settings.' : '';
  $('#setBody').innerHTML = `<div class="set-group"><div class="set-head">Notifications</div>`
    + row('Desktop notifications', `A notification when something is ready to test, stuck, or waiting for your OK while Rocco is in the background.${blocked}`, toggle('notifications', s.notifications))
    + `</div><div class="set-group"><div class="set-head">Workboard</div>`
    + row('Live steps on Working cards', 'Show what the worker did last on each Working card. Off: a progress bar only.', toggle('liveSteps', s.liveSteps))
    + row('Rocco on the note box', 'A little Rocco who walks along the note box, does odd jobs, and watches you type.', toggle('mascot', s.mascot))
    + `</div><div class="set-group"><div class="set-head">Voice notes</div>`
    + row('Voice notes', voiceSupported()
      ? 'Talk instead of typing. Your browser turns speech into text by sending the audio to Google (Chrome) or Microsoft (Edge). Nothing is sent until this is on and you press the mic.'
      : 'This browser has no speech recognition. Use Chrome or Edge.', voiceSupported() ? toggle('voice', s.voice) : '')
    + (s.voice && voiceSupported() ? row('Language', 'The language you speak in.', `<select class="input set-select" data-setting="voiceLang">${['en-US', 'en-GB', 'en-AU', 'es-ES', 'fr-FR', 'de-DE', 'pt-BR'].map(l => `<option${l === s.voiceLang ? ' selected' : ''}>${l}</option>`).join('')}</select>`) : '')
    + `</div><div class="set-group"><div class="set-head">Hotkeys<span class="set-note">while Rocco's window has focus</span><span class="sp"></span><button class="mini" data-reset-keys>Reset all</button></div>`
    + ACTIONS.map(a => `<div class="set-row key-row"><div class="set-title">${esc(a.label)}</div>`
      + `<button class="keybind${recording === a.id ? ' recording' : ''}" data-bind="${a.id}" title="Change">${recording === a.id ? 'Press keys… (Esc cancels, Backspace clears)' : keyHTML(keyFor(a.id))}</button>`
      + `<button class="icon-btn" data-reset-key="${a.id}" title="Back to ${esc(a.key)}" aria-label="Reset"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></svg></button></div>`).join('')
    + `</div>`;
}

function stopRecording() {
  recording = null;
  pause(false);
  renderSettings();
}

export function initSettings() {
  const body = $('#setBody');
  body.addEventListener('click', async e => {
    const sw = e.target.closest('.switch');
    if (sw) {
      const key = sw.dataset.setting, on = sw.getAttribute('aria-checked') !== 'true';
      if (key === 'notifications' && on && (await askPermission()) === 'denied') toast('Your browser is blocking notifications for this site', 'var(--amber)');
      setSetting(key, on);
      return;
    }
    const b = e.target.closest('[data-bind]');
    if (b) { recording = b.dataset.bind; pause(true); renderSettings(); return; }
    const r = e.target.closest('[data-reset-key]');
    if (r) { resetKeys(r.dataset.resetKey); return; }
    if (e.target.closest('[data-reset-keys]')) resetKeys();
  });
  body.addEventListener('change', e => {
    if (e.target.dataset.setting) setSetting(e.target.dataset.setting, e.target.value);
  });
  // Recording a binding: the next combo pressed becomes it.
  document.addEventListener('keydown', e => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { stopRecording(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { bind(recording, ''); stopRecording(); return; }
    const combo = comboOf(e);
    if (!combo) return;
    bind(recording, combo);
    stopRecording();
  }, true);
}
