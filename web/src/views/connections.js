// Connections: how everything is hooked up, for the project being worked on. Rocco isn't a manager for every tool and
// plugin on the PC, so it leads with what matters to this project: what needs attention, then the vital things Rocco and
// the template can't work without, each one click from connected. Then everything, vital or not, by kind, as tiles. A row or
// tile opens its details.
import { state, emit, currentProject } from '../state.js';
import { $, webUrl } from '../lib/dom.js';
import { html, render, nothing } from '../lib/html.js';
import { agoText } from '../lib/format.js';
import { icon } from '../lib/icons.js';
import { logo } from '../lib/brands.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';
import { showSheet, closeSheet, openSheetKey } from '../ui/sheet.js';
import { loadAccounts, yourAgent, notReady, runAccountAction, waitForRun, accRow, fixButtons, chip, imagesNeed } from '../accounts.js';
import { openAccounts } from '../dialogs/onboarding.js';

const LABEL = { ok: 'Up to date', update: 'Update available', warn: 'Needs attention', missing: 'Missing', off: 'Off' };
const COLOR = { ok: 'var(--green)', update: 'var(--update)', warn: 'var(--amber)', missing: 'var(--red)', off: 'var(--gray)' };
const TONE = { ok: 'ok', update: 'update', warn: 'warn', missing: 'bad', off: 'off' };
const ofProject = c => c.group === 'Project' || c.group === 'Libraries'; // the rest are this PC's
const stateLabel = c => c.status === 'ok' ? (c.group === 'Project' || !c.version ? 'Connected' : LABEL.ok) : (LABEL[c.status] || c.status);
// A connection by what it is, not where it sits in the list: a check that comes back in another order still finds it.
const idOf = c => `${c.group}/${c.name}`;
const find = id => state.conn?.items.find(c => idOf(c) === id);
let timer = null;
let loadError = ''; // why the last check couldn't be read

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
    loadError = '';
    emit('connections');
    if (state.conn.checking) timer = setTimeout(() => loadConnections(false), 2000);
  } catch (e) {
    // The sidebar says when the server is gone; anything else it answered is shown here.
    loadError = e.offline ? '' : e.message;
    emit('connections');
  }
}

const versions = c => html`${c.version ? html`<span class="ver">${c.version}</span>` : nothing}${
  c.status === 'update' && c.latest ? html`${c.version ? html`<span class="arrow">→</span>` : nothing}<span class="ver new">${c.latest}</span>` : nothing}`;

// A row's one-click fix (server/actions.ps1), by kind: run (Rocco does it now), window (an update in a window of its
// own, which Rocco waits for), input (run, with a value the user gives in the details), ask (a note for the agent),
// rocco (Rocco's own update), link (a page to get it from). What's running keeps its spinner through re-renders.
const working = new Map(); // action key -> what its button says while it runs
const asked = new Set();   // notes already added to Up next
const actionKey = c => c.action.id || `${c.action.kind}:${c.name}`;

function action(c, inSheet) {
  const a = c.action;
  if (!a) return nothing;
  if (a.kind === 'link') return html`<a class="btn-sm go act" href=${webUrl(a.url)} target="_blank" rel="noreferrer">${a.label}${icon.external}</a>`;
  if (working.has(actionKey(c))) return html`<button class="btn-sm go act" disabled><span class="spin"></span>${working.get(actionKey(c))}</button>`;
  if (a.kind === 'ask' && asked.has(a.note)) return html`<button class="btn-sm act" disabled>${icon.checkSm}Asked</button>`;
  if (a.kind === 'input' && inSheet) return html`<span class="act-input"><input class="input" id="actInput" placeholder=${a.placeholder || ''} autocomplete="off" spellcheck="false"><button class="btn-sm go act" data-conn-act=${idOf(c)}>${a.label}</button></span>`;
  return html`<button class="btn-sm go act" data-conn-act=${idOf(c)}>${a.label}${a.kind === 'input' ? '…' : ''}</button>`;
}

// What to do, then its button. With a button, the command it stands for shows only in the details, for doing it by hand,
// along with the words that lead into it ("Update it:").
const fix = (c, inSheet = false) => html`${c.update && (inSheet || !c.action || !/:\s*$/.test(c.update)) ? html`<span>${c.update}</span>` : nothing}${
  c.command && (inSheet || !c.action) ? html`<code>${c.command}</code><button class="copy" data-copy=${c.command}>${icon.copy}Copy</button>` : nothing}${action(c, inSheet)}`;

// With nothing to do, one line says so; otherwise Needs attention leads the page.
const allGood = () => html`<div class="health k-ok"><span class="health-mark">${icon.checkSm}</span><div class="health-text"><div class="health-title">Everything ${currentProject().name} needs is connected</div><div class="health-sub">Updates to this PC's tools show on their rows.</div></div></div>`;

const flagged = items => items.filter(c => needsAttention(c) && !agentItem(c) && c.name !== 'Codex');

function attention(items) {
  const rows = flagged(items), accounts = accountProblems();
  if (!rows.length && !accounts.length) return nothing;
  return html`<div class="section">Needs attention</div><div class="attn">${accounts.map(x => html`<div class="attn-row k-warn">${logo(x, 'sm')}<div class="attn-main"><div class="attn-title">${x.label}</div><div class="attn-fix"><span>${x.text}</span>${fixButtons(x)}</div></div><span class="state-pill">${
    x.state === 'missing' ? 'Not installed' : x.state === 'expired' ? 'Sign-in expired' : 'Not signed in'}</span></div>`)}${
    rows.map(c => html`<div class="attn-row k-${c.status}" data-conn=${idOf(c)}>${logo(c, 'sm')}<div class="attn-main"><div class="attn-title">${c.name}<span class="attn-ver">${versions(c)}</span></div><div class="attn-fix">${
      c.update || c.command || c.action ? fix(c) : c.detail}</div></div><span class="state-pill">${stateLabel(c)}</span></div>`)}</div>`;
}

// Your agent or Codex: signed in or not (the accounts check), with this PC's version and any update from the tools check.
function accountVital(x, label, need, c, extra = nothing) {
  const ready = x.state === 'ok', update = ready && c?.status === 'update';
  return accRow({ name: x.name, need, tone: ready ? (update ? 'update' : 'ok') : 'warn', chip: chip(label),
    detail: x.detail + (c?.version ? ` · ${c.version}` : '') + (update ? ' · update available' : ''),
    buttons: html`${fixButtons(x)}${update ? action(c) : nothing}${extra}`, conn: c ? idOf(c) : undefined });
}

function vital(items) {
  const a = state.accounts, mine = yourAgent();
  const accounts = a && mine ? html`${accountVital(mine, 'Your agent', mine.plan, items.find(agentItem), html`<button class="btn-sm" data-accounts>Change</button>`)}${
    accountVital({ ...a.images, name: 'Codex' }, 'Images', imagesNeed(), items.find(c => c.name === 'Codex'))}` : nothing;
  const rows = VITAL.flatMap(([name, need]) => items.filter(c => c.name === name).map(c => accRow({
    name: c.name, need, tone: TONE[c.status] || 'off', detail: `${c.status === 'ok' ? '' : `${stateLabel(c)} · `}${c.detail}${c.version ? ` · ${c.version}` : ''}`,
    buttons: c.status === 'ok' ? nothing : action(c), conn: idOf(c) })));
  return html`<div class="section">Vital<span class="sec-name">what Rocco and the template need, on this PC and in ${currentProject().name}</span></div><div class="vital">${accounts}${rows}</div>`;
}

const tile = c => html`<button class="tile k-${c.status}" data-conn=${idOf(c)}><span class="tile-top">${logo(c)}<span class="tile-dot" title=${stateLabel(c)}></span></span><span class="tile-name">${c.name}</span><span class="tile-detail">${c.detail}</span><span class="tile-foot">${
  c.version ? html`<span class="ver">${c.version}</span>` : nothing}<span class="tile-state">${stateLabel(c)}</span></span></button>`;

// Everything, vital or not, by kind: the full picture of each. Each: its key, its heading, and which rows are its own.
/** @type {[string, string, (c: any) => boolean][]} */
const KINDS = [
  ['Project', 'This project', c => c.group === 'Project'],
  ['AI', 'AI', c => c.group === 'AI'],
  ['Roblox', 'Roblox', c => c.group === 'Roblox' && !isPlugin(c)],
  ['Plugins', 'Roblox plugins', isPlugin],
  ['Libraries', 'Roblox libraries in the game', c => c.group === 'Libraries'],
  ['Tools', 'Developer tools', () => true],
];
function groups(items) {
  const left = [...items];
  return KINDS.map(([, label, has]) => {
    const mine = left.filter(has);
    mine.forEach(c => left.splice(left.indexOf(c), 1));
    return mine.length ? html`<div class="kind"><div class="kind-head">${label}</div><div class="tiles">${mine.map(tile)}</div></div>` : nothing;
  });
}

const failed = () => loadError ? html`<div class="load-error">${icon.alert}<span>Couldn't check the connections: ${loadError}</span><button class="btn-sm" data-conn-retry>Retry</button></div>` : nothing;

export function renderConnections() {
  const conn = state.conn;
  const items = conn?.items || [];
  const attn = flagged(items).length + accountProblems().length;
  $('#connBadge').textContent = attn;
  $('#connBadge').hidden = !attn;

  render(conn?.checking ? html`<span class="spin"></span>Checking this PC…`
    : `${conn?.checkedAt ? `Checked ${agoText(conn.checkedAt)}` : ''}${conn && !conn.online ? ' · offline, so no new versions' : ''}`, $('#connSub'));
  $('#connCheck').disabled = !!conn?.checking;

  if (!items.length) {
    render(failed(), $('#connHealth'));
    render(loadError ? nothing : html`<div class="blank" style="min-height:40vh"><div class="blank-in"><div class="blank-icon">${icon.plug}</div><div class="blank-title">Checking connections</div><div class="blank-sub">This takes a few seconds the first time.</div></div></div>`, $('#connBody'));
  } else {
    render(html`${failed()}${attn ? nothing : allGood()}`, $('#connHealth'));
    render(html`${attention(items)}${vital(items)}${groups(items)}`, $('#connBody'));
  }
  // The details that are open follow the check, or close if what they were for is gone.
  if (sheetConn && openSheetKey() === `conn:${sheetConn}`) { if (find(sheetConn)) drawConnection(sheetConn); else closeSheet(); }
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

// ---- A connection's details, in the sheet ----

let sheetConn = '';                                                  // the connection whose details are open
let ui = { replace: false, linking: false, confirmUnlink: false };  // in them: the key form shown, a key being checked, Unlink asked once

function linkForm(c) {
  const l = LINKS[c.link];
  if (!l) return nothing;
  return html`<div class="cd-link"><small>${c.linked ? 'Linked account' : 'Link your account'}</small><p>${l.why}</p>${
    c.linked ? html`<div class="link-state">${icon.checkSm}<span>Linked with the key ending <code>${c.hint || '····'}</code></span><span class="sp"></span><button class="btn-sm" data-link-replace>Replace key</button><button class="btn-sm danger${ui.confirmUnlink ? ' confirm' : ''}" data-unlink=${c.link}>${ui.confirmUnlink ? 'Unlink from this PC?' : 'Unlink'}</button></div>` : nothing
  }<div class="link-form" ?hidden=${c.linked && !ui.replace}><input class="input" id="linkKey" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your ${l.name} API key"><button class="btn accent" data-link=${c.link} ?disabled=${ui.linking}>${
    ui.linking ? html`<span class="spin"></span>Checking` : 'Link'}</button></div><div class="link-help">Make a key at <a href=${l.keys} target="_blank" rel="noreferrer">${new URL(l.keys).host}</a>. ${l.where}</div></div>`;
}

// Versions, what it's for, and how to fix or update it.
function drawConnection(id) {
  const c = find(id);
  if (!c) return;
  const row = (key, value) => value ? html`<div class="kv-row"><span>${key}</span><span>${value}</span></div>` : nothing;
  const body = html`<div class="cd-head">${logo(c, 'lg')}<div class="cd-title"><h2 class="s-title">${c.name}</h2><div class="s-where">${c.detail}</div></div></div><div class="cd-rows">${
    row('Status', stateLabel(c))}${row(c.group === 'Libraries' ? 'In the game' : 'Installed', c.version)}${row('Latest', c.latest)}${row('Checked on', ofProject(c) ? currentProject().name : state.me?.pc || 'This PC')}</div>${
    (c.status !== 'ok' || c.action) && !c.link && (c.update || c.command || c.action) ? html`<div class="cd-fix"><small>${c.status === 'update' ? 'How to update' : 'How to fix'}</small><div class="attn-fix">${fix(c, true)}</div></div>` : nothing}${
    c.link && c.status === 'warn' && c.update ? html`<div class="cd-fix"><small>Heads up</small><div class="attn-fix"><span>${c.update}</span></div></div>` : nothing}${
    // A second way out of the same trouble, with a value of its own (GitHub: a different repo, when the first push failed).
    c.reconnect ? html`<div class="cd-fix"><small>${c.reconnect.label}</small><span class="act-input"><input class="input" id="reInput" placeholder=${c.reconnect.placeholder || ''} autocomplete="off" spellcheck="false"><button class="btn-sm act" data-conn-re=${idOf(c)} ?disabled=${working.has(`re:${idOf(c)}`)}>Connect</button></span></div>` : nothing}${
    c.release?.notes ? html`<div class="cd-fix"><small>What's new${c.action?.kind === 'ask' ? '' : ` in ${c.release.tag}`}</small><p class="cd-notes">${c.release.notes}</p></div>` : nothing}${linkForm(c)}`;
  showSheet(`conn:${id}`, { color: COLOR[c.status], chip: stateLabel(c), id: ofProject(c) ? 'This project' : 'This PC', body });
}

function openConnection(id) {
  if (!find(id)) return;
  if (sheetConn !== id || openSheetKey() !== `conn:${id}`) ui = { replace: false, linking: false, confirmUnlink: false };
  sheetConn = id;
  drawConnection(id);
}

// After linking or unlinking: fresh connections, and the same account's details again.
async function reopenLink(service) {
  await loadConnections(false);
  const c = state.conn?.items.find(x => x.link === service);
  if (c) { ui = { replace: false, linking: false, confirmUnlink: false }; openConnection(idOf(c)); }
}

async function link(service) {
  const field = $('#linkKey'), key = field.value.trim();
  if (!key) { field.focus(); return; }
  if (ui.linking) return;
  ui.linking = true;
  drawConnection(sheetConn);
  try {
    const { tier, note } = await api.link(service, key);
    field.value = '';
    toast(note || `${LINKS[service].name} linked${tier ? ` · ${tier[0].toUpperCase()}${tier.slice(1)} plan` : ''}`, note && !note.startsWith('Linked.') ? 'var(--amber)' : undefined);
    await reopenLink(service);
  } catch (e) {
    toast(e.message, 'var(--red)');
    ui.linking = false;
    drawConnection(sheetConn);
    field.select();
  }
}

// The details' second form (c.reconnect): the same kind of action as a row's button, with its own value.
async function reconnect(button) {
  const id = button.dataset.connRe, c = find(id), value = ($('#reInput')?.value || '').trim();
  if (!c?.reconnect) return;
  if (!value) { $('#reInput')?.focus(); return; }
  const key = `re:${id}`;
  if (working.has(key)) return;
  working.set(key, 'Working');
  drawConnection(id);
  try {
    const r = await api.action(c.reconnect.id, value);
    toast(r.message);
    if (openSheetKey() === `conn:${id}`) closeSheet();
  } catch (e) { toast(e.message, 'var(--red)'); }
  working.delete(key);
  renderConnections();
  loadConnections(true);
}

// A row's button (action). Afterwards the PC is checked again, so the row shows what's true now.
async function runAction(button) {
  const id = button.dataset.connAct, c = find(id), a = c?.action;
  if (!a) return;
  const inSheet = !!button.closest('#sheet');
  // The value goes in the details. They slide in, and a field can't take focus until they're showing.
  if (a.kind === 'input' && !inSheet) { openConnection(id); setTimeout(() => $('#actInput')?.focus(), 80); return; }
  const key = actionKey(c);
  if (working.has(key)) return;
  if (a.kind === 'ask') {
    if (asked.has(a.note)) return;
    working.set(key, 'Asking');
    renderConnections();
    try {
      await api.note(a.note, '');
      asked.add(a.note);
      toast('Added to Up next', 'var(--violet)');
    } catch (e) { toast(`Couldn't add the note: ${e.message}`, 'var(--red)'); }
    working.delete(key);
    renderConnections();
    return;
  }
  const value = a.kind === 'input' ? ($('#actInput')?.value || '').trim() : '';
  if (a.kind === 'input' && !value) { $('#actInput')?.focus(); return; }
  working.set(key, a.kind === 'rocco' || a.kind === 'window' ? 'Updating' : 'Working');
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
    working.delete(key);
    if (ok && inSheet && openSheetKey() === `conn:${id}`) closeSheet();
    renderConnections();
    loadConnections(true);
  }
}

async function unlink(service) {
  // A second click confirms.
  if (!ui.confirmUnlink) { ui.confirmUnlink = true; drawConnection(sheetConn); return; }
  try {
    await api.unlink(service);
    toast(`${LINKS[service].name} unlinked`, 'var(--gray)');
    await reopenLink(service);
  } catch (e) { toast(`Couldn't unlink: ${e.message}`, 'var(--red)'); }
}

export function initConnections() {
  $('#connCheck').addEventListener('click', () => loadConnections(true));
  $('#sheet').addEventListener('click', e => {
    if (!sheetConn || openSheetKey() !== `conn:${sheetConn}`) return;
    const hit = selector => e.target.closest(selector);
    if (hit('[data-link]')) link(hit('[data-link]').dataset.link);
    else if (hit('[data-unlink]')) unlink(hit('[data-unlink]').dataset.unlink);
    else if (hit('[data-link-replace]')) { ui.replace = !ui.replace; drawConnection(sheetConn); if (ui.replace) $('#linkKey').focus(); }
  });
  $('#sheet').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'linkKey') { e.preventDefault(); $('#sheet [data-link]')?.click(); }
    if (e.target.id === 'actInput') { e.preventDefault(); $('#sheet [data-conn-act]')?.click(); }
    if (e.target.id === 'reInput') { e.preventDefault(); $('#sheet [data-conn-re]')?.click(); }
  });
  document.addEventListener('click', /** @param {MouseEvent & { target: any }} e */ e => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy).then(() => toast('Copied'), () => toast("Couldn't copy", 'var(--red)'));
      return;
    }
    const act = e.target.closest('[data-conn-act]');
    if (act) { runAction(act); return; }
    const re = e.target.closest('[data-conn-re]');
    if (re) { reconnect(re); return; }
    if (e.target.closest('.view[data-view="connections"] [data-conn-retry]')) { loadConnections(true); return; }
    // Your agent and Codex: an install or sign-in (accounts.js), or the accounts screen to pick another agent.
    const run = e.target.closest('.view[data-view="connections"] [data-acc-run]');
    if (run) { runAccountAction(run.dataset.accRun, renderConnections).then(() => loadConnections(true)); return; }
    if (e.target.closest('.view[data-view="connections"] [data-accounts]')) { openAccounts(); return; }
    const item = e.target.closest('.view[data-view="connections"] [data-conn]');
    if (item) openConnection(item.dataset.conn);
  });
}
