// The model and effort the conductor (and a feature's own agent) is opened on, picked by the note box's Send button,
// the way a coding agent's own app picks them: "Opus 5.5 · High", opening to a list of models and a row of effort
// levels. Kept per PC by the server (server/agents.ps1). A change applies to the next agent Rocco opens: one that's
// running already is on what it was opened with, and Restart opens it again on the new one.
import { state, on } from '../state.js';
import { $ } from '../lib/dom.js';
import { html, render, nothing } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { once } from '../lib/busy.js';
import { api } from '../api.js';
import { refresh } from '../sync.js';
import { toast } from '../ui/toast.js';
import { openMenu, closeMenus } from '../ui/menu.js';
import { modelName, effortName, MODEL_NOTES, chooseModel, chooseEffort } from '../agent.js';

const CHEV = html`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
const menu = () => $('#modelMenu');
const open = () => menu().classList.contains('open');

// The running conductor, when it's on something other than what's picked now.
function behind() {
  const a = state.agent, c = state.meta.conductor || {};
  if (!a || c.state === 'none' || !c.state) return false;
  return (a.takesModel && (c.model || '') !== (a.model || '')) || (a.takesEffort && (c.effort || '') !== (a.effort || ''));
}

function content() {
  const a = state.agent;
  const item = (id, label, note) => html`<button class="menu-item" role="menuitemradio" aria-checked=${a.model === id ? 'true' : 'false'} data-model=${id}><span class="mi-text"><span class="mi-name">${label}</span>${
    note ? html`<span class="mi-sub">${note}</span>` : nothing}</span>${a.model === id ? html`<span class="tick">${icon.checkSm}</span>` : nothing}</button>`;
  // A name typed in Settings that isn't in the list still shows, picked.
  const models = a.model && !a.models.includes(a.model) ? [...a.models, a.model] : a.models;
  return html`${a.takesModel ? html`<div class="menu-label">Model</div>${models.map(id => item(id, modelName(id), MODEL_NOTES[id] || ''))}${item('', `${a.short}'s default`, 'Whatever it uses by itself')}` : nothing}${
    a.takesEffort ? html`${a.takesModel ? html`<div class="menu-sep"></div>` : nothing}<div class="menu-label">Effort</div><div class="mp-efforts" role="radiogroup" aria-label="Effort">${
      a.efforts.map(e => html`<button class="mp-effort${a.effort === e ? ' on' : ''}" role="radio" aria-checked=${a.effort === e ? 'true' : 'false'} data-effort=${e} title=${effortName(e)}>${e === 'xhigh' ? 'X-high' : effortName(e)}</button>`)}</div>` : nothing}<div class="menu-sep"></div>${
    behind() ? html`<div class="mp-foot"><span>Rocco is still on what it was opened with.</span><button class="btn-sm go" data-mp-restart>Restart it now</button></div>`
      : html`<div class="mp-foot"><span>Applies when Rocco next opens your agent.</span></div>`}`;
}

export function renderModelPick() {
  const a = state.agent, slot = $('#modelSlot');
  if (!a || (!a.takesModel && !a.takesEffort)) { render(nothing, slot); return; }
  const label = [a.takesModel ? modelName(a.model) : '', a.takesEffort && a.effort ? effortName(a.effort) : ''].filter(Boolean).join(' · ');
  render(html`<button type="button" class="mp-btn${behind() ? ' behind' : ''}" id="modelBtn" aria-haspopup="menu" aria-expanded=${open() ? 'true' : 'false'} title="The model and effort your agent is opened on">${label}${CHEV}</button>`, slot);
  if (open()) render(content(), menu());
}

async function pick(fn, value, what) {
  await once('model-pick', async () => {
    try { await fn(value); } catch (e) { toast(`Couldn't change the ${what}: ${e.message}`, 'var(--red)'); }
  });
  renderModelPick();
}

export function initModelPick() {
  on('agent', renderModelPick);
  on('conductor', renderModelPick);
  $('#modelSlot').addEventListener('click', e => {
    if (!e.target.closest('#modelBtn')) return;
    openMenu(menu(), $('#modelBtn'), content(), { up: true, end: true });
  });
  menu().addEventListener('click', e => {
    const hit = s => e.target.closest(s);
    if (hit('[data-model]')) pick(chooseModel, hit('[data-model]').dataset.model, 'model');
    else if (hit('[data-effort]')) pick(chooseEffort, hit('[data-effort]').dataset.effort, 'effort');
    else if (hit('[data-mp-restart]')) {
      closeMenus();
      once('conductor:restart', async () => {
        try {
          const r = await api.restartConductor();
          await refresh();
          toast(r.agent ? `${r.agent} started again on ${modelName(state.agent.model)}${state.agent.effort ? `, ${effortName(state.agent.effort).toLowerCase()} effort` : ''}` : 'Its session is ended. No agent could be opened in its place', r.agent ? 'var(--claude)' : 'var(--amber)');
        } catch (err) { toast(`Couldn't restart it: ${err.message}`, 'var(--red)'); }
      });
    }
  });
}
