// The user's own accounts on this PC (server/accounts.ps1): each agent's sign-in, Codex for images, GitHub, and the
// linked keys. Nothing comes with RoDev: each tool runs on the user's own plan. Shared by onboarding's accounts screen
// and the Vital section of Connections. Installs and sign-ins run the tool's own command in a window of its own
// (actions.ps1); when it closes, the accounts are checked again.
import { state, emit } from './state.js';
import { html, nothing, ifDefined } from './lib/html.js';
import { logo } from './lib/brands.js';
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
  ? html`<button class=${cls} disabled><span class="spin"></span>In its window</button>` : html`<button class=${cls} data-acc-run=${action}>${label}</button>`;

// tone: ok, update, warn, bad or off. buttons, chip and form are templates. conn: the connection whose details the
// row opens (Connections).
export function accRow({ name, need, tone, detail, buttons = nothing, chip = nothing, form = nothing, conn = null }) {
  return html`<div class="acc-row k-${tone}" data-conn=${ifDefined(conn)}>${logo({ name }, 'sm')}<div class="acc-text"><div class="acc-name">${name}${chip}</div>${
    need ? html`<div class="acc-need">${need}</div>` : nothing}<div class="acc-state"><i></i><span>${detail}</span></div></div><div class="acc-btns">${buttons}</div>${form}</div>`;
}

export const chip = text => html`<span class="acc-chip">${text}</span>`;

// Install or sign in: whatever the account needs next.
export const fixButtons = x => x.state === 'missing' ? windowButton(x.install, 'Install')
  : x.state === 'signin' || x.state === 'expired' ? windowButton(x.login, 'Sign in', 'btn-sm go') : nothing;

// The one this PC uses must be ready; the others are optional.
export const agentTone = x => x.state === 'ok' ? 'ok' : x.chosen ? 'warn' : 'off';

export function agentRow(x) {
  const pick = x.state !== 'missing' && !x.chosen ? html`<button class="btn-sm" data-acc-use=${x.id}>Use this one</button>` : nothing;
  return accRow({ name: x.name, need: x.plan, tone: agentTone(x), detail: x.detail, buttons: html`${fixButtons(x)}${pick}`, chip: x.chosen ? chip('Your agent') : nothing });
}

// Codex makes the images, whichever agent the PC uses.
export const imagesNeed = () => `Makes concepts, card images and UI art: the template's image tool. Runs on a ChatGPT plan${state.accounts?.agent === 'codex' ? ', the same sign-in as your agent' : ''}.`;
