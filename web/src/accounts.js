// The user's own accounts on this PC (server/accounts.ps1): each agent's sign-in, Codex for images, GitHub, and the
// linked keys. Nothing comes with RoDev: each tool runs on the user's own plan. Shared by onboarding's accounts screen
// and the Vital section of Connections. Installs and sign-ins run the tool's own command in a window of its own
// (actions.ps1); when it closes, the accounts are checked again.
import { state, emit } from './state.js';
import { esc } from './lib/dom.js';
import { logoHTML } from './lib/brands.js';
import { api } from './api.js';
import { toast } from './ui/toast.js';
import { chooseAgent, loadAgent } from './agent.js';

const running = new Set(); // install and sign-in windows still open, by action

export async function loadAccounts(refresh) {
  try { state.accounts = await api.accounts(refresh); emit('accounts'); }
  catch (e) { if (refresh) toast(`Couldn't check your accounts: ${e.message}`, 'var(--red)'); }
  return state.accounts;
}

export const yourAgent = () => state.accounts?.agents.find(a => a.chosen);
export const notReady = a => a.state === 'missing' ? 'isn\'t installed' : a.state === 'expired' ? 'needs signing in again' : 'isn\'t signed in';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A window of its own (actions.ps1): done when it closes. It stays open on failure, until the user has read it.
export async function waitForRun(run) {
  for (;;) {
    await sleep(1500);
    try { const s = await api.actionRun(run); if (!s.running) return s; } catch { /* Rocco is busy or restarting: ask again */ }
  }
}

// An install or sign-in. rerender shows its button busy, then what's true once the window closes.
export async function runAccountAction(action, rerender) {
  if (running.has(action)) return;
  running.add(action);
  rerender();
  try {
    const r = await api.action(action, '');
    toast(`${r.label} in its own window`, 'var(--update)');
    const done = await waitForRun(r.run);
    toast(done.ok ? `${done.label}: done` : `${done.label} didn't finish. Its window said why`, done.ok ? 'var(--green)' : 'var(--red)');
  } catch (e) { toast(e.message, 'var(--red)'); }
  running.delete(action);
  if (!action.endsWith('-login')) await loadAgent(); // a new install changes which agents there are
  await loadAccounts(true);
  rerender();
}

export async function useAgent(id) {
  try {
    await chooseAgent(id);
    toast(`${state.agent.name} is your agent on this PC`);
    await loadAccounts(true);
  } catch (e) { toast(`Couldn't change your agent: ${e.message}`, 'var(--red)'); }
}

// ---- Rows ----

export const windowButton = (action, label, cls = 'btn-sm') => running.has(action)
  ? `<button class="${cls}" disabled><span class="spin"></span>In its window</button>` : `<button class="${cls}" data-acc-run="${esc(action)}">${label}</button>`;

// tone: ok, update, warn, bad or off. attrs: extra attributes for the row (Connections opens its details).
export function accRowHTML({ name, need, tone, detail, buttons = '', chip = '', form = '', attrs = '' }) {
  return `<div class="acc-row k-${tone}"${attrs}>${logoHTML({ name }, 'sm')}<div class="acc-text"><div class="acc-name">${esc(name)}${chip}</div>`
    + (need ? `<div class="acc-need">${esc(need)}</div>` : '') + `<div class="acc-state"><i></i><span>${esc(detail)}</span></div></div>`
    + `<div class="acc-btns">${buttons}</div>${form}</div>`;
}

export const chip = text => `<span class="acc-chip">${esc(text)}</span>`;

// Install or sign in: whatever the account needs next.
export const fixButtons = x => x.state === 'missing' ? windowButton(x.install, 'Install')
  : x.state === 'signin' || x.state === 'expired' ? windowButton(x.login, 'Sign in', 'btn-sm go') : '';

// The one this PC uses must be ready; the others are optional.
export const agentTone = x => x.state === 'ok' ? 'ok' : x.chosen ? 'warn' : 'off';

export function agentRowHTML(x) {
  const pick = x.state !== 'missing' && !x.chosen ? `<button class="btn-sm" data-acc-use="${esc(x.id)}">Use this one</button>` : '';
  return accRowHTML({ name: x.name, need: x.plan, tone: agentTone(x), detail: x.detail, buttons: fixButtons(x) + pick, chip: x.chosen ? chip('Your agent') : '' });
}

// Codex makes the images, whichever agent the PC uses.
export const imagesNeed = () => `Makes concepts, card images and UI art: the template's image tool. Runs on a ChatGPT plan${state.accounts?.agent === 'codex' ? ', the same sign-in as your agent' : ''}.`;
