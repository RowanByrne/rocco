// A card's session: everything the task's agent did and said, word for word, as it happens (server/sessions.ps1), with
// what you and Rocco said on the card in between, like a chat with the agent. Its messages show as written (Markdown),
// each tool it ran folds into a line you can open to see what went in and what came back, and the card's note box
// sends it your words. An agent whose sessions Rocco can't read (anything but Claude Code, so far) shows the card's
// History the same way.
import { api } from '../api.js';
import { byId } from '../state.js';
import { $, esc } from '../lib/dom.js';
import { hhmm } from '../lib/format.js';
import { icon } from '../lib/icons.js';
import { prose } from '../prose.js';
import { openSheetKey } from '../ui/sheet.js';

const POLL = 2500;
const RESULT_MAX = 6000;

let view = null; // { id, sessions: Map(key -> { from, desc, items, tools }), logs, timer, open: Set, stamp }

// ---- Reading a session's lines ----

const SKIP_TEXT = /^\s*<([\w-]+)>[\s\S]*<\/\1>\s*$/; // the agent's own notices, like <task-notification>

function addLine(s, e) {
  const at = e.timestamp || '';
  const content = e.message?.content;
  if (e.isMeta || !content) return;
  if (e.type === 'assistant') {
    for (const c of content) {
      if (c.type === 'text' && c.text.trim()) s.items.push({ kind: 'said', at, text: c.text });
      else if (c.type === 'tool_use') { const it = { kind: 'tool', at, id: c.id, name: c.name, input: c.input || {} }; s.items.push(it); s.tools.set(c.id, it); }
    }
  } else if (e.type === 'user') {
    const told = text => { if (text.trim() && !SKIP_TEXT.test(text)) s.items.push({ kind: s.items.length ? 'told' : 'brief', at, text }); };
    if (typeof content === 'string') { told(content); return; }
    for (const c of content) {
      if (c.type === 'tool_result') { const it = s.tools.get(c.tool_use_id); if (it) { it.result = c.content; it.error = !!c.is_error; } }
      else if (c.type === 'text') told(c.text);
    }
  }
}

async function pull(id) {
  const list = await api.sessions(id);
  let changed = false;
  for (const info of list) {
    let s = view.sessions.get(info.key);
    if (!s) { s = { from: 0, desc: info.desc, started: info.started, items: [], tools: new Map() }; view.sessions.set(info.key, s); changed = true; }
    if (info.size <= s.from) continue;
    const { text, next } = await api.session(id, info.key, s.from);
    if (view?.id !== id) return false;
    for (const line of text.split('\n')) { if (line.trim()) { try { addLine(s, JSON.parse(line)); } catch { /* a line still being written */ } } }
    s.from = next;
    changed = true;
  }
  return changed;
}

// ---- What a tool did, in a line, and opened ----

const leaf = p => String(p || '').split(/[\\/]/).pop();
const firstLine = s => String(s || '').split('\n').map(x => x.trim()).find(Boolean) || '';
const host = u => { try { return new URL(u).host; } catch { return 'a web page'; } };

export function toolLine(name, input) {
  if (/^(Bash|PowerShell)$/.test(name)) return input.description ? firstLine(input.description) : `Ran ${firstLine(input.command)}`;
  if (name === 'Read') return `Read ${leaf(input.file_path)}`;
  if (/^(Edit|MultiEdit)$/.test(name)) return `Edited ${leaf(input.file_path)}`;
  if (name === 'Write') return `Wrote ${leaf(input.file_path)}`;
  if (name === 'NotebookEdit') return `Edited ${leaf(input.notebook_path)}`;
  if (/^(Grep|Glob)$/.test(name)) return `Searched for ${firstLine(input.pattern)}`;
  if (/^(Task|Agent)$/.test(name)) return `Started a helper: ${firstLine(input.description)}`;
  if (name === 'SendMessage') return 'Sent a message';
  if (name === 'WebFetch') return `Read ${host(input.url)}`;
  if (name === 'WebSearch') return `Looked up ${firstLine(input.query)}`;
  if (/^(TodoWrite|Task(Create|Update|List|Get))$/.test(name)) return 'Updated its to-do list';
  const m = name.match(/^mcp__(.+?)__(.+)$/);
  if (m) return `${/studio/i.test(m[1]) ? 'Studio' : m[1].replace(/_/g, ' ')}: ${m[2].replace(/_/g, ' ')}`;
  return name;
}

const cut = (s, n = RESULT_MAX) => s.length > n ? `${s.slice(0, n)}\n… ${(s.length - n).toLocaleString()} more characters` : s;
const pre = (s, cls = '') => `<pre class="sx-pre${cls}">${esc(cut(String(s ?? '')))}</pre>`;

function inputHTML(name, input) {
  if (/^(Bash|PowerShell)$/.test(name)) return pre(input.command);
  if (name === 'Edit') return `<div class="sx-path">${esc(input.file_path || '')}</div>${pre(`${prefix(input.old_string, '- ')}\n${prefix(input.new_string, '+ ')}`, ' diff')}`;
  if (name === 'MultiEdit') return `<div class="sx-path">${esc(input.file_path || '')}</div>${(input.edits || []).map(e => pre(`${prefix(e.old_string, '- ')}\n${prefix(e.new_string, '+ ')}`, ' diff')).join('')}`;
  if (name === 'Write') return `<div class="sx-path">${esc(input.file_path || '')}</div>${pre(input.content)}`;
  if (name === 'Read') return `<div class="sx-path">${esc(input.file_path || '')}</div>`;
  if (/execute_luau$/.test(name) && input.code) return pre(input.code);
  return pre(JSON.stringify(input, null, 2));
}
const prefix = (s, mark) => String(s ?? '').split('\n').map(l => mark + l).join('\n');

function resultHTML(it) {
  if (it.result === undefined) return `<div class="sx-wait"><span class="spin"></span>Running</div>`;
  const parts = typeof it.result === 'string' ? [{ type: 'text', text: it.result }] : (it.result || []);
  const html = parts.map(p => p.type === 'image' && p.source?.data
    ? `<img class="sx-img" src="data:${esc(p.source.media_type || 'image/png')};base64,${esc(p.source.data)}" alt="What it saw">`
    : p.type === 'text' ? pre(p.text, it.error ? ' err' : '') : '').join('');
  return html || '<div class="sx-wait">No output</div>';
}

function toolHTML(it) {
  const open = view.open.has(it.id);
  return `<div class="sx-tool${open ? ' open' : ''}${it.error ? ' err' : ''}"><button class="sx-tool-head" data-sx="${esc(it.id)}">`
    + `<span class="sx-dot"></span><span class="sx-tool-line">${esc(toolLine(it.name, it.input))}</span>${it.result === undefined ? '<span class="spin"></span>' : ''}</button>`
    + (open ? `<div class="sx-tool-body"><div class="sx-label">${esc(it.name.replace(/^mcp__.+?__/, ''))}</div>${inputHTML(it.name, it.input)}<div class="sx-label">Result</div>${resultHTML(it)}</div>` : '')
    + '</div>';
}

// Tools run between two messages fold into one line that opens to the list: the latest stays open while it works.
function groupHTML(group, live) {
  const key = `g:${group[0].id}`, open = view.open.has(key) || (live && !view.open.has(`${key}:shut`)), last = group.at(-1);
  return `<div class="sx-group${open ? ' open' : ''}"><button class="sx-group-head" data-sx="${esc(key)}" data-sx-live="${live ? 1 : ''}">${icon.chev}`
    + `<span>${group.length} step${group.length === 1 ? '' : 's'}</span><span class="sx-group-last">${esc(toolLine(last.name, last.input))}</span>`
    + `<span class="at">${hhmm(group[0].at)}</span></button>${open ? `<div class="sx-rows">${group.map(toolHTML).join('')}</div>` : ''}</div>`;
}

const WHO = { you: 'You', conductor: 'Rocco', worker: 'Worker', rocco: 'Rocco' };

function rowHTML(r) {
  const at = `<span class="at">${hhmm(r.at)}</span>`;
  switch (r.kind) {
    case 'brief': {
      const open = view.open.has(`b:${r.at}`);
      return `<div class="sx-brief${open ? ' open' : ''}"><div class="sx-head"><span class="sx-who">Rocco's brief</span>${r.desc ? `<span class="sx-desc">${esc(r.desc)}</span>` : ''}${at}</div>`
        + `<div class="sx-text">${prose(r.text)}</div><button class="linkish sx-more" data-sx="b:${esc(r.at)}">${open ? 'Show less' : 'Show all'}</button></div>`;
    }
    case 'said': return `<div class="sx-msg agent"><div class="sx-head"><span class="sx-who">Agent</span>${at}</div><div class="sx-text">${prose(r.text)}</div></div>`;
    case 'told': return `<div class="sx-msg rocco"><div class="sx-head"><span class="sx-who">Rocco</span>${at}</div><div class="sx-text">${prose(r.text)}</div></div>`;
    case 'log': return r.who === 'you'
      ? `<div class="sx-msg you"><div class="sx-head">${at}</div><div class="sx-text">${esc(r.text)}</div></div>`
      : `<div class="sx-msg note"><div class="sx-head"><span class="sx-who">${WHO[r.who] || esc(r.who)}</span>${at}</div><div class="sx-text">${prose(r.text)}</div></div>`;
  }
  return '';
}

function streamHTML(t) {
  const rows = (t.log || []).map(l => ({ kind: 'log', at: l.at, who: l.who, text: l.text }));
  for (const s of view.sessions.values()) rows.push(...s.items.map(it => it.kind === 'brief' ? { ...it, desc: s.desc } : it));
  if (!rows.length) return `<div class="sx-empty">Nothing yet. What its agent does shows here as it works.</div>`;
  // The card's times carry the PC's offset, the session's are UTC: compared as times, not text.
  const time = r => Date.parse(r.at) || 0;
  rows.sort((a, b) => time(a) - time(b));
  const live = t.status === 'working';
  let html = '', group = [];
  const flush = last => { if (group.length) { html += groupHTML(group, live && last); group = []; } };
  rows.forEach((r, i) => {
    if (r.kind === 'tool') { group.push(r); if (i === rows.length - 1) flush(true); return; }
    flush(false);
    html += rowHTML(r);
  });
  return html;
}

// ---- The view: shown in a card's sheet, kept current while it's open ----

// Reading at the end, it follows what comes in.
function render(follow = true) {
  const box = $('#sx'), t = view && byId(view.id);
  if (!box || !t) return;
  const scroller = $('#sBody');
  const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
  box.innerHTML = streamHTML(t);
  if (follow && atEnd) scroller.scrollTop = scroller.scrollHeight;
}

async function tick(id) {
  if (!view || view.id !== id || openSheetKey() !== id) { stopSession(); return; }
  try {
    const changed = await pull(id);
    const t = byId(id), stamp = `${t?.log?.length}|${t?.status}`;
    if (changed || stamp !== view.stamp || !view.loaded) {
      view.stamp = stamp;
      const first = !view.loaded;
      view.loaded = true;
      // A card at work opens at its latest step, like a session; any other at its top.
      render(!first);
      if (first && t?.status === 'working') $('#sBody').scrollTop = $('#sBody').scrollHeight;
    }
  } catch { /* the sidebar shows the server is offline; try again next time */ }
  if (view?.id === id) view.timer = setTimeout(() => tick(id), POLL);
}

// Called when a task's sheet opens (or opens again, after you send it something): what's been read is kept.
export function startSession(id) {
  if (view?.id !== id) { stopSession(); view = { id, sessions: new Map(), open: new Set(), stamp: '', loaded: false, timer: 0 }; }
  clearTimeout(view.timer);
  if (view.loaded) render();
  tick(id);
}

export function stopSession() {
  if (view) clearTimeout(view.timer);
  view = null;
}

// After you send something: show it, and keep reading.
export const scrollSessionToEnd = () => { const s = $('#sBody'); if (s) s.scrollTop = s.scrollHeight; };

export function initSession() {
  document.addEventListener('click', e => {
    const head = e.target.closest('[data-sx]');
    if (!head || !view || !$('#sx')?.contains(head)) return;
    const key = head.dataset.sx;
    if (head.dataset.sxLive) {
      // The live group is open until it's shut by hand.
      const shut = `${key}:shut`, isOpen = view.open.has(key) || !view.open.has(shut);
      if (isOpen) { view.open.delete(key); view.open.add(shut); } else { view.open.add(key); view.open.delete(shut); }
    } else if (view.open.has(key)) view.open.delete(key);
    else view.open.add(key);
    render(false);
  });
}
