// Settings: your agent, quitting Rocco, notifications, the Workboard's Working cards, voice notes, the sidebar, and
// hotkeys. Kept in this browser.
import { $ } from '../lib/dom.js';
import { html, render, nothing } from '../lib/html.js';
import { lineIcon } from '../lib/icons.js';
import { once } from '../lib/busy.js';
import { settings, setSetting } from '../settings.js';
import { ACTIONS, keyFor, comboOf, bind, resetKeys, pause } from '../hotkeys.js';
import { askPermission } from '../notify.js';
import { voiceSupported } from '../voice.js';
import { toast } from '../ui/toast.js';
import { state } from '../state.js';
import { chooseAgent, chooseModel, chooseEffort, modelName, effortName } from '../agent.js';
import { resetNav } from '../sidebar.js';
import { openAccounts } from '../dialogs/onboarding.js';
import { api } from '../api.js';
import { THEMES, theme, setTheme } from '../theme.js';

const LANGS = ['en-US', 'en-GB', 'en-AU', 'es-ES', 'fr-FR', 'de-DE', 'pt-BR'];
const RESET = lineIcon('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>', 14, 2);
let recording = null; // the action whose new hotkey is being pressed
let quitArmed = null;  // Quit asks once more for a few seconds: it stops Lync too, mid-task or not

function quit() {
  if (!quitArmed) { quitArmed = setTimeout(() => { quitArmed = null; renderSettings(); }, 4000); renderSettings(); return; }
  clearTimeout(quitArmed);
  quitArmed = null;
  renderSettings();
  once('quit', async () => {
    try { await api.quit(); toast('Rocco and Lync stopped. Run tools\\rocco.bat to start Rocco again.', 'var(--gray)'); }
    catch (err) { toast(`Couldn't quit: ${err.message}`, 'var(--red)'); }
  });
}

const toggle = (key, on) => html`<button class="switch" role="switch" aria-checked=${on ? 'true' : 'false'} data-setting=${key}><span></span></button>`;
const row = (title, sub, control = nothing) => html`<div class="set-row"><div class="set-text"><div class="set-title">${title}</div><div class="set-sub">${sub}</div></div>${control}</div>`;
const keys = combo => combo ? combo.split('+').map(k => html`<kbd>${k}</kbd>`) : html`<span class="unset">None</span>`;

// This PC's coding agent (agent.js): any of them can run the project, since every agent reads the project's AGENTS.md.
function agents() {
  const a = state.agent;
  if (!a) return nothing;
  return html`<div class="set-group"><div class="set-head">Your agent<span class="set-note">on this PC</span><span class="sp"></span><button class="mini" data-accounts>Your accounts</button></div>${
    a.agents.map(x => html`<button class="set-row agent-row${x.id === a.id ? ' on' : ''}" data-agent=${x.id} role="radio" aria-checked=${x.id === a.id ? 'true' : 'false'}><span class="radio"></span><span class="set-text"><span class="set-title">${x.name}</span><span class="set-sub">${x.installed ? 'Installed' : 'Not installed on this PC (Connections)'}</span></span></button>`)
  }${model(a)}${effort(a)}${
    row('Features get an agent of their own', `A feature you approve is built by its own ${a.short} session, in a lane it keeps, and you talk to it on its own tab above the chat. Off: the conductor builds it with its workers, and everything goes through the conductor.`,
      html`<button class="switch" role="switch" aria-checked=${a.leads !== false ? 'true' : 'false'} data-leads aria-label="Features get an agent of their own"><span></span></button>`)
  }<div class="set-row set-foot">Rocco opens your agent for onboarding and names it wherever it asks for something. Any of them works: every agent follows the project's AGENTS.md (MODELS.md has more).</div></div>`;
}

// The model the conductor is opened on, for an agent that takes one on its command line (server/agents.ps1): one from
// its list, or any name it accepts, typed. It applies to the next conductor Rocco opens.
const OTHER = '(other)';
let typingModel = false;
function model(a) {
  if (!a.takesModel) return nothing;
  const listed = (a.models || []).includes(a.model), custom = typingModel || (!!a.model && !listed);
  return row("The conductor's model", `What ${a.name} runs on when Rocco opens it as the conductor. Its own default is whatever it's set to use by itself. A change applies to the next conductor Rocco opens.`,
    html`<span class="set-model"><select class="input set-select" data-model aria-label="The conductor's model"><option value="" ?selected=${!a.model && !custom}>${a.short}'s default</option>${
      (a.models || []).map(m => html`<option value=${m} ?selected=${a.model === m && !custom}>${modelName(m)}</option>`)}<option value=${OTHER} ?selected=${custom}>Another…</option></select>${
      custom ? html`<input class="input set-select" data-model-name placeholder="A model's name" aria-label="A model's name" .value=${listed ? '' : a.model || ''}>` : nothing}</span>`);
}

// How hard it thinks, for an agent that takes an effort level (also by the note box's Send button).
const effort = a => !a.takesEffort ? nothing : row("The conductor's effort", `How hard ${a.name} thinks when Rocco opens it. More is slower and uses more of your plan. Applies to the next one Rocco opens.`,
  html`<select class="input set-select" data-effort aria-label="The conductor's effort"><option value="" ?selected=${!a.effort}>${a.short}'s default</option>${
    (a.efforts || []).map(e => html`<option value=${e} ?selected=${a.effort === e}>${effortName(e)}</option>`)}</select>`);

function setModel(name) {
  once('model', async () => {
    try {
      await chooseModel(name);
      typingModel = false;
      toast(name ? `The next conductor opens on ${name}` : `The next conductor opens on ${state.agent.short}'s default`);
    } catch (err) { toast(`Couldn't set the model: ${err.message}`, 'var(--red)'); }
    renderSettings();
  });
}

export function renderSettings() {
  const s = settings();
  const permission = 'Notification' in window ? Notification.permission : 'unsupported';
  const blocked = permission === 'denied' ? ' Your browser is blocking them: allow notifications for this site in its settings.' : '';
  render(html`<div class="set-group"><div class="set-head">Look<span class="set-note">in this browser</span></div>${
    row('Theme', 'Light, dark, or whichever your system is on. Dark mode is also a switch in your menu, at the bottom of the sidebar.',
      html`<span class="seg" role="radiogroup" aria-label="Theme">${THEMES.map(([id, label]) => html`<button class="seg-b${theme() === id ? ' on' : ''}" role="radio" aria-checked=${theme() === id ? 'true' : 'false'} data-theme-pick=${id}>${label}</button>`)}</span>`)
  }</div>${agents()}<div class="set-group"><div class="set-head">Rocco<span class="set-note">on this PC</span></div>${
    row('Runs in the background', 'Rocco and Lync run with no windows. Quitting stops both, so Studio stops syncing. Run tools\\rocco.bat in any project to start Rocco again.',
      html`<button class="mini" data-quit>${quitArmed ? 'Quit, and stop Lync?' : 'Quit Rocco'}</button>`)
  }</div><div class="set-group"><div class="set-head">Notifications</div>${
    row('Desktop notifications', `A notification when something is ready to test, stuck, or waiting for your OK while Rocco is in the background.${blocked}`, toggle('notifications', s.notifications))
  }</div><div class="set-group"><div class="set-head">Workboard</div>${
    row('Live steps on Working cards', 'Show what the worker did last on each Working card. Off: a progress bar only.', toggle('liveSteps', s.liveSteps))}${
    row('Rocco on the note box', 'A little Rocco who walks along the top of the note box, does odd jobs, and watches you type.', toggle('mascot', s.mascot))
  }</div><div class="set-group"><div class="set-head">Voice notes</div>${
    row('Voice notes', voiceSupported()
      ? 'Talk instead of typing. Your browser turns speech into text by sending the audio to Google (Chrome) or Microsoft (Edge). Nothing is sent until this is on and you press the mic.'
      : 'This browser has no speech recognition. Use Chrome or Edge.', voiceSupported() ? toggle('voice', s.voice) : nothing)}${
    s.voice && voiceSupported() ? row('Language', 'The language you speak in.', html`<select class="input set-select" data-setting="voiceLang" .value=${s.voiceLang}>${LANGS.map(l => html`<option ?selected=${l === s.voiceLang}>${l}</option>`)}</select>`) : nothing
  }</div><div class="set-group"><div class="set-head">Sidebar<span class="set-note">in this browser</span></div>${
    row('Order and folded categories', "Drag a category or a tab in the sidebar to move it (or Alt+↑ and Alt+↓), and click a category's name to fold it.", html`<button class="mini" data-reset-nav>Reset</button>`)
  }</div><div class="set-group"><div class="set-head">Hotkeys<span class="set-note">while Rocco's window has focus</span><span class="sp"></span><button class="mini" data-reset-keys>Reset all</button></div>${
    ACTIONS.map(a => html`<div class="set-row key-row"><div class="set-title">${a.label}</div><button class="keybind${recording === a.id ? ' recording' : ''}" data-bind=${a.id} title="Change">${
      recording === a.id ? 'Press keys… (Esc cancels, Backspace clears)' : keys(keyFor(a.id))}</button><button class="icon-btn" data-reset-key=${a.id} title="Back to ${a.key}" aria-label="Reset">${RESET}</button></div>`)
  }</div>`, $('#setBody'));
}

function stopRecording() {
  recording = null;
  pause(false);
  renderSettings();
}

export function initSettings() {
  const body = $('#setBody');
  body.addEventListener('click', async e => {
    const pick = e.target.closest('[data-theme-pick]');
    if (pick) { setTheme(pick.dataset.themePick); return; }
    // Whether an approved feature gets its own agent: this PC's, kept by the server (server/leads.ps1).
    const leads = e.target.closest('[data-leads]');
    if (leads) {
      const turnOn = leads.getAttribute('aria-checked') !== 'true';
      once('leads', async () => {
        try { state.agent = await api.setLeads(turnOn); toast(turnOn ? 'The next feature you approve gets an agent of its own' : 'The conductor builds the next feature you approve'); }
        catch (err) { toast(`Couldn't change it: ${err.message}`, 'var(--red)'); }
        renderSettings();
      });
      return;
    }
    const sw = e.target.closest('.switch');
    if (sw) {
      const key = sw.dataset.setting, on = sw.getAttribute('aria-checked') !== 'true';
      if (key === 'notifications' && on && (await askPermission()) === 'denied') toast('Your browser is blocking notifications for this site', 'var(--amber)');
      setSetting(key, on);
      return;
    }
    const agent = e.target.closest('[data-agent]');
    if (agent) {
      once('agent', async () => {
        try { await chooseAgent(agent.dataset.agent); toast(`${state.agent.name} is your agent on this PC`); }
        catch (err) { toast(`Couldn't change your agent: ${err.message}`, 'var(--red)'); }
      });
      return;
    }
    const b = e.target.closest('[data-bind]');
    if (b) { recording = b.dataset.bind; pause(true); renderSettings(); return; }
    const r = e.target.closest('[data-reset-key]');
    if (r) { resetKeys(r.dataset.resetKey); return; }
    if (e.target.closest('[data-accounts]')) { openAccounts(); return; }
    if (e.target.closest('[data-quit]')) { quit(); return; }
    if (e.target.closest('[data-reset-nav]')) { resetNav(); toast('The sidebar is back in its usual order'); return; }
    if (e.target.closest('[data-reset-keys]')) resetKeys();
  });
  body.addEventListener('change', e => {
    if (e.target.dataset.setting) setSetting(e.target.dataset.setting, e.target.value);
    // The conductor's model: one from the list is set at once; "Another" opens a box to type one in.
    else if ('model' in e.target.dataset) {
      if (e.target.value === OTHER) { typingModel = true; renderSettings(); body.querySelector('[data-model-name]')?.focus(); }
      else setModel(e.target.value);
    } else if ('modelName' in e.target.dataset && e.target.value.trim()) setModel(e.target.value.trim());
    else if ('effort' in e.target.dataset) once('effort', async () => {
      try { await chooseEffort(e.target.value); toast(e.target.value ? `The next conductor opens at ${effortName(e.target.value).toLowerCase()} effort` : `The next conductor opens at ${state.agent.short}'s default effort`); }
      catch (err) { toast(`Couldn't set the effort: ${err.message}`, 'var(--red)'); }
      renderSettings();
    });
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
