// Connections: how everything is hooked up, for the project being worked on. Rocco isn't a manager for every tool and
// plugin on the PC, so it leads with what matters to this project: what needs attention, then the vital things Rocco and
// the template can't work without, each one click from connected. Then everything, vital or not, by kind, as tiles. A row or
// tile opens its details.
import { state, emit, currentProject } from '../state.js';
import { $, esc } from '../lib/dom.js';
import { agoText } from '../lib/format.js';
import { icon } from '../lib/icons.js';
import { logoHTML, useGlyphFallback } from '../lib/brands.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';
import { showSheet, closeSheet } from '../ui/sheet.js';
import { loadAccounts, yourAgent, notReady, runAccountAction, waitForRun, accRowHTML, fixButtons, chip, imagesNeed } from '../accounts.js';
import { openAccounts } from '../dialogs/onboarding.js';

const LABEL = { ok: 'Up to date', update: 'Update available', warn: 'Needs attention', missing: 'Missing', off: 'Off' };
const COLOR = { ok: 'var(--green)', update: 'var(--update)', warn: 'var(--amber)', missing: 'var(--red)', off: 'var(--gray)' };
const TONE = { ok: 'ok', update: 'update', warn: 'warn', missing: 'bad', off: 'off' };
const ofProject = c => c.group === 'Project' || c.group === 'Libraries'; // the rest are this PC's
const stateLabel = c => c.status === 'ok' ? (c.group === 'Project' || !c.version ? 'Connected' : LABEL.ok) : (LABEL[c.status] || c.status);
let timer = null;

// Vital, in the order they're set up: what each is for. Your agent and Codex (images) lead the list, from the accounts check.
const VITAL = [
  ['Git', 'Keeps every change, and syncs the game with GitHub.'],
  ['GitHub', 'This game\'s repo: where every PC and agent gets the code.'],
  ['Template', 'Where this game\'s workflow and docs get their updates.'],
  ['Commit check', 'Stops files too big for git going in.'],
  ['Roblox Studio', 'Where the game is built and played.'],
  ['Lync', 'Syncs the code from git into Studio.'],
  ['Studio sync', 'Lync serving this game\'s places now.'],
  ['Studio MCP', 'Lets your agent and its workers use Studio.'],
  ['Rocco', 'This app.'],
];
const VITAL_NAMES = new Set(VITAL.map(([name]) => name));
const agentItem = c => c.group === 'AI' && c.name === state.agent?.name;
const isVital = c => VITAL_NAMES.has(c.name) || agentItem(c) || c.name === 'Codex';
const isPlugin = c => / plugin$/.test(c.name);
// What affects this project: its own links and libraries, the vital things, and a linked account that stopped working.
// Tools' own updates show on their rows; only this project's (the template, a library) and Rocco's ask for attention.
const counts = c => c.group === 'Project' || c.group === 'Libraries' || isVital(c) || !!c.link;
const needsAttention = c => counts(c) && (c.status === 'warn' || c.status === 'missing'
  || (c.status === 'update' && (c.group === 'Project' || c.group === 'Libraries' || c.name === 'Rocco')));
// Your agent and Codex, when they aren't ready to work (accounts.js).
const accountProblems = () => {
  const a = state.accounts;
  if (!a) return [];
  const mine = yourAgent();
  return [mine && mine.state !== 'ok' ? { ...mine, label: 'Your agent', text: `${mine.name} ${notReady(mine)}, so nothing can be planned or built on this PC.` } : null,
    a.images.state !== 'ok' ? { ...a.images, name: 'Codex', label: 'Images', text: `Codex ${notReady(a.images)}, so this PC can't make art.` } : null].filter(Boolean);
};

// The server checks this PC in the background; while it does, ask again every two seconds. The accounts come with it.
export async function loadConnections(force) {
  clearTimeout(timer);
  loadAccounts(force);
  try {
    state.conn = await api.connections(force);
    emit('connections');
    if (state.conn.checking) timer = setTimeout(() => loadConnections(false), 2000);
  } catch { /* the sidebar shows the server is offline */ }
}

const versionsHTML = c => (c.version ? `<span class="ver">${esc(c.version)}</span>` : '')
  + (c.status === 'update' && c.latest ? `${c.version ? '<span class="arrow">→</span>' : ''}<span class="ver new">${esc(c.latest)}</span>` : '');

// A row's one-click fix (server/actions.ps1), by kind: run (Rocco does it now), window (an update in a window of its
// own, which Rocco waits for), input (run, with a value the user gives in the details), ask (a note for the agent),
// rocco (Rocco's own update), link (a page to get it from). What's running keeps its spinner through re-renders.
const busy = new Map();   // action key -> what its button says while it runs
const asked = new Set();  // notes already added to Up next
const actionKey = c => c.action.id || `${c.action.kind}:${c.name}`;

function actionHTML(c, i, inSheet) {
  const a = c.action;
  if (!a) return '';
  if (a.kind === 'link') return `<a class="btn-sm go act" href="${esc(a.url)}" target="_blank" rel="noreferrer">${esc(a.label)}${icon.external}</a>`;
  if (busy.has(actionKey(c))) return `<button class="btn-sm go act" disabled><span class="spin"></span>${esc(busy.get(actionKey(c)))}</button>`;
  if (a.kind === 'ask' && asked.has(a.note)) return `<button class="btn-sm act" disabled>${icon.checkSm}Asked</button>`;
  if (a.kind === 'input' && inSheet) {
    return `<span class="act-input"><input class="input" id="actInput" placeholder="${esc(a.placeholder || '')}" autocomplete="off" spellcheck="false">`
      + `<button class="btn-sm go act" data-conn-act="${i}">${esc(a.label)}</button></span>`;
  }
  return `<button class="btn-sm go act" data-conn-act="${i}">${esc(a.label)}${a.kind === 'input' ? '…' : ''}</button>`;
}

// What to do, then its button. With a button, the command it stands for shows only in the details, for doing it by hand,
// along with the words that lead into it ("Update it:").
const fixHTML = (c, i, inSheet = false) => (c.update && (inSheet || !c.action || !/:\s*$/.test(c.update)) ? `<span>${esc(c.update)}</span>` : '')
  + (c.command && (inSheet || !c.action) ? `<code>${esc(c.command)}</code><button class="copy" data-copy="${esc(c.command)}">${icon.copy}Copy</button>` : '')
  + actionHTML(c, i, inSheet);

// With nothing to do, one line says so; otherwise Needs attention leads the page.
const allGoodHTML = () => `<div class="health k-ok"><span class="health-mark">${icon.checkSm}</span><div class="health-text">`
  + `<div class="health-title">Everything ${esc(currentProject().name)} needs is connected</div><div class="health-sub">Updates to this PC's tools show on their rows.</div></div></div>`;

function attentionHTML(items) {
  const rows = items.map((c, i) => [c, i]).filter(([c]) => needsAttention(c) && !agentItem(c) && c.name !== 'Codex');
  const accounts = accountProblems();
  if (!rows.length && !accounts.length) return '';
  return `<div class="section">Needs attention</div><div class="attn">`
    + accounts.map(x => `<div class="attn-row k-warn">${logoHTML(x, 'sm')}<div class="attn-main"><div class="attn-title">${esc(x.label)}</div>`
      + `<div class="attn-fix"><span>${esc(x.text)}</span>${fixButtons(x)}</div></div><span class="state-pill">${x.state === 'missing' ? 'Not installed' : x.state === 'expired' ? 'Sign-in expired' : 'Not signed in'}</span></div>`).join('')
    + rows.map(([c, i]) => `<div class="attn-row k-${esc(c.status)}" data-conn="${i}">${logoHTML(c, 'sm')}`
      + `<div class="attn-main"><div class="attn-title">${esc(c.name)}<span class="attn-ver">${versionsHTML(c)}</span></div>`
      + `<div class="attn-fix">${c.update || c.command || c.action ? fixHTML(c, i) : esc(c.detail)}</div></div>`
      + `<span class="state-pill">${esc(stateLabel(c))}</span></div>`).join('')
    + `</div>`;
}

// Your agent or Codex: signed in or not (the accounts check), with this PC's version and any update from the tools check.
function accountVitalHTML(x, label, need, found, extra = '') {
  const [c, i] = found || [];
  const ready = x.state === 'ok', update = ready && c?.status === 'update';
  return accRowHTML({ name: x.name, need, tone: ready ? (update ? 'update' : 'ok') : 'warn', chip: chip(label),
    detail: x.detail + (c?.version ? ` · ${c.version}` : '') + (update ? ' · update available' : ''),
    buttons: fixButtons(x) + (update ? actionHTML(c, i) : '') + extra, attrs: c ? ` data-conn="${i}"` : '' });
}

function vitalHTML(items) {
  const indexed = items.map((c, i) => [c, i]);
  const a = state.accounts, mine = yourAgent();
  const accounts = a && mine ? accountVitalHTML(mine, 'Your agent', mine.plan, indexed.find(([c]) => agentItem(c)), '<button class="btn-sm" data-accounts>Change</button>')
    + accountVitalHTML({ ...a.images, name: 'Codex' }, 'Images', imagesNeed(), indexed.find(([c]) => c.name === 'Codex')) : '';
  const rows = VITAL.flatMap(([name, need]) => indexed.filter(([c]) => c.name === name).map(([c, i]) => accRowHTML({
    name: c.name, need, tone: TONE[c.status] || 'off', detail: `${c.status === 'ok' ? '' : `${stateLabel(c)} · `}${c.detail}${c.version ? ` · ${c.version}` : ''}`,
    buttons: c.status === 'ok' ? '' : actionHTML(c, i), attrs: ` data-conn="${i}"` }))).join('');
  return `<div class="section">Vital<span class="sec-name">what Rocco and the template need, on this PC and in ${esc(currentProject().name)}</span></div>`
    + `<div class="vital">${accounts}${rows}</div>`;
}

const tileHTML = (c, i) => `<button class="tile k-${esc(c.status)}" data-conn="${i}">`
  + `<span class="tile-top">${logoHTML(c)}<span class="tile-dot" title="${esc(stateLabel(c))}"></span></span>`
  + `<span class="tile-name">${esc(c.name)}</span><span class="tile-detail">${esc(c.detail)}</span>`
  + `<span class="tile-foot">${c.version ? `<span class="ver">${esc(c.version)}</span>` : ''}<span class="tile-state">${esc(stateLabel(c))}</span></span></button>`;

// Everything, vital or not, by kind: the full picture of each.
const KINDS = [
  ['Project', 'This project', c => c.group === 'Project'],
  ['AI', 'AI', c => c.group === 'AI'],
  ['Roblox', 'Roblox', c => c.group === 'Roblox' && !isPlugin(c)],
  ['Plugins', 'Roblox plugins', isPlugin],
  ['Libraries', 'Roblox libraries in the game', c => c.group === 'Libraries'],
  ['Tools', 'Developer tools', () => true],
];
function groupsHTML(items) {
  const left = items.map((c, i) => [c, i]);
  return KINDS.map(([, label, has]) => {
    const mine = left.filter(([c]) => has(c));
    mine.forEach(entry => left.splice(left.indexOf(entry), 1));
    return mine.length ? `<div class="kind"><div class="kind-head">${label}</div><div class="tiles">${mine.map(([c, i]) => tileHTML(c, i)).join('')}</div></div>` : '';
  }).join('');
}

export function renderConnections() {
  const conn = state.conn;
  const items = conn?.items || [];
  const attention = items.filter(c => needsAttention(c) && !agentItem(c) && c.name !== 'Codex').length + accountProblems().length;
  $('#connBadge').textContent = attention;
  $('#connBadge').hidden = !attention;

  $('#connSub').innerHTML = conn?.checking ? '<span class="spin"></span>Checking this PC…'
    : esc(`${conn?.checkedAt ? `Checked ${agoText(conn.checkedAt)}` : ''}${conn && !conn.online ? ' · offline, so no new versions' : ''}`);
  $('#connCheck').disabled = !!conn?.checking;

  if (!items.length) {
    $('#connHealth').innerHTML = '';
    $('#connBody').innerHTML = `<div class="blank" style="min-height:40vh"><div class="blank-in"><div class="blank-icon">${icon.plug}</div>`
      + `<div class="blank-title">Checking connections</div><div class="blank-sub">This takes a few seconds the first time.</div></div></div>`;
    return;
  }
  $('#connHealth').innerHTML = attention ? '' : allGoodHTML();
  $('#connBody').innerHTML = attentionHTML(items) + vitalHTML(items) + groupsHTML(items);
}

// Accounts the user links here, and on onboarding's accounts screen. The key goes to the server, which checks it with the
// service before keeping it.
export const LINKS = {
  elevenlabs: {
    name: 'ElevenLabs',
    keys: 'https://elevenlabs.io/app/settings/api-keys',
    why: 'Makes sound effects and music for the game (AUDIO-PIPELINE.md). Game audio needs a paid plan (Starter or above): the free plan doesn\'t allow commercial use.',
    where: 'Rocco checks the key with ElevenLabs, then keeps it on this PC as ELEVENLABS_API_KEY in your Windows account, where your agent\'s tools read it. It never shows the key again, and it never goes into git. Agent sessions that are already open need a restart to see it.',
  },
  roblox: {
    name: 'Roblox Open Cloud',
    keys: 'https://create.roblox.com/dashboard/credentials?activeTab=ApiKeysTab',
    why: 'Shows draft game page events and publishes them (Updates), shows how each thumbnail does (Thumbnails), and lets your agent put events and thumbnails on the game page. Give the key this game\'s experience, with: events read and write, analytics read, and for your agent\'s uploads, assets write and the game page\'s thumbnails (legacy universe manage). If you restrict the key by IP address, add 0.0.0.0/0, since a home connection\'s address changes. Keys stop working after 60 days unused.',
    where: 'Rocco checks the key on this game\'s events, then keeps it on this PC as ROBLOX_API_KEY in your Windows account, where your agent\'s tools read it. It never shows the key again, and it never goes into git. Agent sessions that are already open need a restart to see it.',
  },
};

function linkHTML(c) {
  const l = LINKS[c.link];
  if (!l) return '';
  const form = `<div class="link-form"${c.linked ? ' hidden' : ''}><input class="input" id="linkKey" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your ${esc(l.name)} API key">`
    + `<button class="btn accent" data-link="${esc(c.link)}">Link</button></div>`
    + `<div class="link-help">Make a key at <a href="${esc(l.keys)}" target="_blank" rel="noreferrer">${esc(new URL(l.keys).host)}</a>. ${esc(l.where)}</div>`;
  return `<div class="cd-link"><small>${c.linked ? 'Linked account' : 'Link your account'}</small><p>${esc(l.why)}</p>`
    + (c.linked ? `<div class="link-state">${icon.checkSm}<span>Linked with the key ending <code>${esc(c.hint || '····')}</code></span><span class="sp"></span>`
      + `<button class="btn-sm" data-link-replace>Replace key</button><button class="btn-sm danger" data-unlink="${esc(c.link)}">Unlink</button></div>` : '')
    + form + `</div>`;
}

// A connection's details in the sheet: versions, what it's for, and how to fix or update it.
function openConnection(i) {
  const c = state.conn?.items[i];
  if (!c) return;
  const row = (key, value) => value ? `<div class="kv-row"><span>${key}</span><span>${esc(value)}</span></div>` : '';
  const body = `<div class="cd-head">${logoHTML(c, 'lg')}<div class="cd-title"><h2 class="s-title">${esc(c.name)}</h2><div class="s-where">${esc(c.detail)}</div></div></div>`
    + `<div class="cd-rows">${row('Status', stateLabel(c))}${row(c.group === 'Libraries' ? 'In the game' : 'Installed', c.version)}${row('Latest', c.latest)}${row('Checked on', ofProject(c) ? currentProject().name : state.me?.pc || 'This PC')}</div>`
    + ((c.status !== 'ok' || c.action) && !c.link && (c.update || c.command || c.action) ? `<div class="cd-fix"><small>${c.status === 'update' ? 'How to update' : 'How to fix'}</small><div class="attn-fix">${fixHTML(c, i, true)}</div></div>` : '')
    + (c.link && c.status === 'warn' && c.update ? `<div class="cd-fix"><small>Heads up</small><div class="attn-fix"><span>${esc(c.update)}</span></div></div>` : '')
    + (c.release?.notes ? `<div class="cd-fix"><small>What's new${c.action?.kind === 'ask' ? '' : ` in ${esc(c.release.tag)}`}</small><p class="cd-notes">${esc(c.release.notes)}</p></div>` : '')
    + linkHTML(c);
  showSheet(`conn:${i}`, { color: COLOR[c.status], chip: stateLabel(c), id: ofProject(c) ? 'This project' : 'This PC', body });
}

// After linking or unlinking: fresh connections, and the same account's sheet again.
async function reopenLink(service) {
  await loadConnections(false);
  const i = state.conn?.items.findIndex(c => c.link === service);
  if (i >= 0) openConnection(i);
}

async function link(button) {
  const field = $('#linkKey'), key = field.value.trim(), service = button.dataset.link;
  if (!key) { field.focus(); return; }
  button.disabled = true;
  button.innerHTML = '<span class="spin"></span>Checking';
  try {
    const { tier, note } = await api.link(service, key);
    field.value = '';
    toast(note || `${LINKS[service].name} linked${tier ? ` · ${tier[0].toUpperCase()}${tier.slice(1)} plan` : ''}`, note && !note.startsWith('Linked.') ? 'var(--amber)' : undefined);
    await reopenLink(service);
  } catch (e) {
    toast(e.message, 'var(--red)');
    button.disabled = false;
    button.textContent = 'Link';
    field.select();
  }
}

// A row's button (actionHTML). Afterwards the PC is checked again, so the row shows what's true now.
async function runAction(button) {
  const i = +button.dataset.connAct, c = state.conn?.items[i], a = c?.action;
  if (!a) return;
  const inSheet = !!button.closest('#sheet');
  // The value goes in the details. They slide in, and a field can't take focus until they're showing.
  if (a.kind === 'input' && !inSheet) { openConnection(i); setTimeout(() => $('#actInput')?.focus(), 80); return; }
  if (a.kind === 'ask') {
    button.disabled = true;
    try {
      await api.note(a.note, '');
      asked.add(a.note);
      toast('Added to Up next', 'var(--violet)');
      button.innerHTML = `${icon.checkSm}Asked`;
    } catch (e) { toast(`Couldn't add the note: ${e.message}`, 'var(--red)'); button.disabled = false; }
    return;
  }
  const value = a.kind === 'input' ? ($('#actInput')?.value || '').trim() : '';
  if (a.kind === 'input' && !value) { $('#actInput')?.focus(); return; }
  const key = actionKey(c), label = button.textContent;
  busy.set(key, a.kind === 'rocco' || a.kind === 'window' ? 'Updating' : 'Working');
  button.disabled = true;
  button.innerHTML = `<span class="spin"></span>${busy.get(key)}`;
  renderConnections();
  let ok = false;
  try {
    // Rocco switches to the release and restarts; when the new version answers, the page reloads (main.js).
    if (a.kind === 'rocco') { await api.updateRocco(a.tag); ok = true; toast(`Updating Rocco to ${a.tag}. It restarts in a moment`, 'var(--update)'); return; }
    const r = await api.action(a.id, value);
    if (r.run) {
      toast(`${r.label} in its own window`, 'var(--update)');
      const done = await waitForRun(r.run);
      ok = done.ok;
      toast(ok ? `${done.label}: done` : `${done.label} didn't finish. Its window said why`, ok ? 'var(--green)' : 'var(--red)');
    } else {
      ok = true;
      toast(r.message);
    }
  } catch (e) {
    toast(e.message, 'var(--red)');
  } finally {
    busy.delete(key);
    if (button.isConnected && !ok) { button.disabled = false; button.textContent = label; }
    if (ok && inSheet) closeSheet();
    loadConnections(true);
  }
}

async function unlink(button) {
  // A second click confirms.
  if (!button.classList.contains('confirm')) { button.classList.add('confirm'); button.textContent = 'Unlink from this PC?'; return; }
  const service = button.dataset.unlink;
  try {
    await api.unlink(service);
    toast(`${LINKS[service].name} unlinked`, 'var(--gray)');
    await reopenLink(service);
  } catch (e) { toast(`Couldn't unlink: ${e.message}`, 'var(--red)'); }
}

export function initConnections() {
  const view = $('.view[data-view="connections"]');
  useGlyphFallback(view);
  useGlyphFallback($('#sheet'));
  $('#connCheck').addEventListener('click', () => loadConnections(true));
  $('#sheet').addEventListener('click', e => {
    const hit = selector => e.target.closest(selector);
    if (hit('[data-link]')) link(hit('[data-link]'));
    else if (hit('[data-unlink]')) unlink(hit('[data-unlink]'));
    else if (hit('[data-link-replace]')) { const form = $('.link-form'); form.hidden = !form.hidden; if (!form.hidden) $('#linkKey').focus(); }
  });
  $('#sheet').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'linkKey') { e.preventDefault(); $('[data-link]')?.click(); }
    if (e.target.id === 'actInput') { e.preventDefault(); $('#sheet [data-conn-act]')?.click(); }
  });
  document.addEventListener('click', e => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy).then(() => toast('Copied'), () => toast("Couldn't copy", 'var(--red)'));
      return;
    }
    const act = e.target.closest('[data-conn-act]');
    if (act) { runAction(act); return; }
    // Your agent and Codex: an install or sign-in (accounts.js), or the accounts screen to pick another agent.
    const run = e.target.closest('.view[data-view="connections"] [data-acc-run]');
    if (run) { runAccountAction(run.dataset.accRun, renderConnections).then(() => loadConnections(true)); return; }
    if (e.target.closest('.view[data-view="connections"] [data-accounts]')) { openAccounts(); return; }
    const item = e.target.closest('.view[data-view="connections"] [data-conn]');
    if (item) openConnection(+item.dataset.conn);
  });
}
