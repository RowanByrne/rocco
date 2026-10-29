// Connections: how everything is hooked up. A health summary first, then only what needs attention,
// then every connection as a tile: this project's links, and this PC's tools by kind. A tile opens its details.
import { state, emit, currentProject } from '../state.js';
import { $, esc } from '../lib/dom.js';
import { agoText } from '../lib/format.js';
import { icon } from '../lib/icons.js';
import { logoHTML, useGlyphFallback } from '../lib/brands.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';
import { showSheet } from '../ui/sheet.js';

const PC_GROUPS = [['AI', 'AI'], ['Roblox', 'Roblox'], ['Tools', 'Developer tools']];
const LABEL = { ok: 'Up to date', update: 'Update available', warn: 'Needs attention', missing: 'Missing', off: 'Off' };
const COLOR = { ok: 'var(--green)', update: 'var(--update)', warn: 'var(--amber)', missing: 'var(--red)', off: 'var(--gray)' };
const needsAttention = c => c.status === 'update' || c.status === 'warn' || c.status === 'missing';
const stateLabel = c => c.status === 'ok' ? (c.group === 'Project' || !c.version ? 'Connected' : LABEL.ok) : (LABEL[c.status] || c.status);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
let timer = null;

// The server checks this PC in the background; while it does, ask again every two seconds.
export async function loadConnections(force) {
  clearTimeout(timer);
  try {
    state.conn = await api.connections(force);
    emit('connections');
    if (state.conn.checking) timer = setTimeout(() => loadConnections(false), 2000);
  } catch { /* the sidebar shows the server is offline */ }
}

const versionsHTML = c => (c.version ? `<span class="ver">${esc(c.version)}</span>` : '')
  + (c.status === 'update' && c.latest ? `${c.version ? '<span class="arrow">→</span>' : ''}<span class="ver new">${esc(c.latest)}</span>` : '');

const fixHTML = c => (c.update ? `<span>${esc(c.update)}</span>` : '')
  + (c.command ? `<code>${esc(c.command)}</code><button class="copy" data-copy="${esc(c.command)}">${icon.copy}Copy</button>` : '');

function healthHTML(items) {
  const n = status => items.filter(c => c.status === status).length;
  const problems = n('warn') + n('missing'), updates = n('update');
  const kind = problems ? 'warn' : updates ? 'update' : 'ok';
  const title = problems ? `${plural(problems, 'thing')} need${problems === 1 ? 's' : ''} attention`
    : updates ? `${plural(updates, 'update')} available` : 'Everything is connected and up to date';
  const parts = [`${n('ok')} of ${items.length} up to date`];
  if (problems && updates) parts.push(plural(updates, 'update'));
  if (n('off')) parts.push(`${n('off')} off`);
  const pills = [['ok', 'connected'], ['update', 'updates'], ['warn', 'need attention'], ['missing', 'missing']]
    .filter(([s]) => n(s)).map(([s, label]) => `<span class="pill" style="--c:${COLOR[s]}"><i></i><b>${n(s)}</b>${label}</span>`).join('');
  return `<div class="health k-${kind}"><span class="health-mark">${kind === 'ok' ? icon.checkSm : kind === 'update' ? icon.up : icon.alert}</span>`
    + `<div class="health-text"><div class="health-title">${title}</div><div class="health-sub">${parts.join(' · ')}</div></div>`
    + `<div class="health-pills">${pills}</div></div>`;
}

function attentionHTML(items) {
  const rows = items.map((c, i) => [c, i]).filter(([c]) => needsAttention(c));
  if (!rows.length) return '';
  return `<div class="section">Needs attention</div><div class="attn">`
    + rows.map(([c, i]) => `<div class="attn-row k-${esc(c.status)}" data-conn="${i}">${logoHTML(c, 'sm')}`
      + `<div class="attn-main"><div class="attn-title">${esc(c.name)}<span class="attn-ver">${versionsHTML(c)}</span></div>`
      + `<div class="attn-fix">${c.update || c.command ? fixHTML(c) : esc(c.detail)}</div></div>`
      + `<span class="state-pill">${esc(stateLabel(c))}</span></div>`).join('')
    + `</div>`;
}

const tileHTML = (c, i) => `<button class="tile k-${esc(c.status)}" data-conn="${i}">`
  + `<span class="tile-top">${logoHTML(c)}<span class="tile-dot" title="${esc(stateLabel(c))}"></span></span>`
  + `<span class="tile-name">${esc(c.name)}</span><span class="tile-detail">${esc(c.detail)}</span>`
  + `<span class="tile-foot">${c.version ? `<span class="ver">${esc(c.version)}</span>` : ''}<span class="tile-state">${esc(stateLabel(c))}</span></span></button>`;

function groupsHTML(items) {
  const indexed = items.map((c, i) => [c, i]);
  const tiles = group => indexed.filter(([c]) => c.group === group).map(([c, i]) => tileHTML(c, i)).join('');
  const project = tiles('Project');
  const pc = PC_GROUPS.map(([group, label]) => {
    const list = tiles(group);
    return list ? `<div class="kind"><div class="kind-head">${label}</div><div class="tiles">${list}</div></div>` : '';
  }).join('');
  return (project ? `<div class="section">This project<span class="sec-name">${esc(currentProject().name)}</span></div><div class="tiles">${project}</div>` : '')
    + (pc ? `<div class="section">This PC<span class="sec-name">${esc(state.me?.pc || '')}</span></div>${pc}` : '');
}

export function renderConnections() {
  const conn = state.conn;
  const items = conn?.items || [];
  const attention = items.filter(needsAttention).length;
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
  $('#connHealth').innerHTML = healthHTML(items);
  $('#connBody').innerHTML = attentionHTML(items) + groupsHTML(items);
}

// A connection's details in the sheet: versions, what it's for, and how to fix or update it.
function openConnection(i) {
  const c = state.conn?.items[i];
  if (!c) return;
  const row = (key, value) => value ? `<div class="kv-row"><span>${key}</span><span>${esc(value)}</span></div>` : '';
  const body = `<div class="cd-head">${logoHTML(c, 'lg')}<div class="cd-title"><h2 class="s-title">${esc(c.name)}</h2><div class="s-where">${esc(c.detail)}</div></div></div>`
    + `<div class="cd-rows">${row('Status', stateLabel(c))}${row('Installed', c.version)}${row('Latest', c.latest)}${row('Checked on', c.group === 'Project' ? currentProject().name : state.me?.pc || 'This PC')}</div>`
    + (c.status !== 'ok' && (c.update || c.command) ? `<div class="cd-fix"><small>${c.status === 'update' ? 'How to update' : 'How to fix'}</small><div class="attn-fix">${fixHTML(c)}</div></div>` : '');
  showSheet(`conn:${i}`, { color: COLOR[c.status], chip: stateLabel(c), id: c.group === 'Project' ? 'This project' : 'This PC', body });
}

export function initConnections() {
  const view = $('.view[data-view="connections"]');
  useGlyphFallback(view);
  useGlyphFallback($('#sheet'));
  $('#connCheck').addEventListener('click', () => loadConnections(true));
  document.addEventListener('click', e => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy).then(() => toast('Copied'), () => toast("Couldn't copy", 'var(--red)'));
      return;
    }
    const item = e.target.closest('.view[data-view="connections"] [data-conn]');
    if (item) openConnection(+item.dataset.conn);
  });
}
