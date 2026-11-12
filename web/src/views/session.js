// A card's session: everything the task's agent did and said, word for word, as it happens (server/sessions.ps1), with
// what you and Rocco said on the card in between, like a chat with the agent. Its messages show as written (Markdown),
// each tool it ran folds into a line you can open to see what went in and what came back, and the card's note box
// sends it your words. An agent whose sessions Rocco can't read (anything but Claude Code, so far) shows the card's
// History the same way.
import { api } from '../api.js';
import { byId, on, emit } from '../state.js';
import { $ } from '../lib/dom.js';
import { html, render, nothing } from '../lib/html.js';
import { hhmm } from '../lib/format.js';
import { icon } from '../lib/icons.js';
import { prose } from '../prose.js';
import { openSheetKey } from '../ui/sheet.js';

const POLL = 2500;
const RESULT_MAX = 6000;

let view = null; // { id, sessions: Map(key -> { from, desc, items, tools }), timer, open: Set, stamp, loaded, progress, reading, again, error }

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

// v: the view this read is for; one that's been closed since stops being filled. The server sends a long session a few
// megabytes at a time, so it's read to the end, one piece after another, before it's shown: shown half read, the card's
// newer lines (your message) would sit under the agent's older steps, as if they were the latest. Until then the
// loading line says how far it has got.
async function pull(v) {
  const list = await api.sessions(v.id);
  const total = list.reduce((n, info) => n + (info.size || 0), 0);
  const done = () => [...v.sessions.values()].reduce((n, s) => n + s.from, 0);
  let changed = false;
  for (const info of list) {
    let s = v.sessions.get(info.key);
    if (!s) { s = { from: 0, desc: info.desc, started: info.started, items: [], tools: new Map() }; v.sessions.set(info.key, s); changed = true; }
    // What it has used so far, and how many tasks it worked on (its usage is shared between them).
    if (info.usage) { s.usage = info.usage; s.share = info.tasks || 1; }
    while (info.size > s.from) {
      const { text, next } = await api.session(v.id, info.key, s.from);
      if (view !== v) return false;
      for (const line of text.split('\n')) { if (line.trim()) { try { addLine(s, JSON.parse(line)); } catch { /* a line still being written */ } } }
      if (!(next > s.from)) break;
      s.from = next;
      changed = true;
      if (!v.loaded && total) { v.progress = Math.min(99, Math.round(done() / total * 100)); draw(false); }
    }
  }
  return changed;
}

// What the open card's sessions have used so far: tokens in and out, and read from or written to the prompt cache
// (server/sessions.ps1). A session that worked on several tasks counts in part, as the server shares it. null until
// a session with usage has been read.
export function sessionUsage(id) {
  if (!view || view.id !== id) return null;
  const total = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, sessions: 0, shared: false };
  for (const s of view.sessions.values()) {
    if (!s.usage?.messages) continue;
    const share = Math.max(1, s.share || 1);
    for (const key of ['in', 'out', 'cacheRead', 'cacheWrite']) total[key] += (s.usage[key] || 0) / share;
    total.sessions++;
    if (share > 1) total.shared = true;
  }
  return total.sessions ? total : null;
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
const pre = (s, cls = '') => html`<pre class="sx-pre${cls}">${cut(String(s ?? ''))}</pre>`;
const prefix = (s, mark) => String(s ?? '').split('\n').map(l => mark + l).join('\n');
const path = input => html`<div class="sx-path">${input.file_path || ''}</div>`;

function inputView(name, input) {
  if (/^(Bash|PowerShell)$/.test(name)) return pre(input.command);
  if (name === 'Edit') return html`${path(input)}${pre(`${prefix(input.old_string, '- ')}\n${prefix(input.new_string, '+ ')}`, ' diff')}`;
  if (name === 'MultiEdit') return html`${path(input)}${(input.edits || []).map(e => pre(`${prefix(e.old_string, '- ')}\n${prefix(e.new_string, '+ ')}`, ' diff'))}`;
  if (name === 'Write') return html`${path(input)}${pre(input.content)}`;
  if (name === 'Read') return path(input);
  if (/execute_luau$/.test(name) && input.code) return pre(input.code);
  return pre(JSON.stringify(input, null, 2));
}

function resultView(it) {
  if (it.result === undefined) return html`<div class="sx-wait"><span class="spin"></span>Running</div>`;
  const parts = (typeof it.result === 'string' ? [{ type: 'text', text: it.result }] : (it.result || []))
    .filter(p => (p.type === 'image' && p.source?.data) || p.type === 'text');
  if (!parts.length) return html`<div class="sx-wait">No output</div>`;
  return parts.map(p => p.type === 'image'
    ? html`<img class="sx-img" src="data:${/^image\/[\w.+-]+$/.test(p.source.media_type || '') ? p.source.media_type : 'image/png'};base64,${p.source.data}" alt="What it saw">`
    : pre(p.text, it.error ? ' err' : ''));
}

function tool(it) {
  const open = view.open.has(it.id);
  return html`<div class="sx-tool${open ? ' open' : ''}${it.error ? ' err' : ''}"><button class="sx-tool-head" data-sx=${it.id}><span class="sx-dot"></span><span class="sx-tool-line">${toolLine(it.name, it.input)}</span>${
    it.result === undefined ? html`<span class="spin"></span>` : nothing}</button>${
    open ? html`<div class="sx-tool-body"><div class="sx-label">${it.name.replace(/^mcp__.+?__/, '')}</div>${inputView(it.name, it.input)}<div class="sx-label">Result</div>${resultView(it)}</div>` : nothing}</div>`;
}

// Tools run between two messages fold into one line that opens to the list: the latest stays open while it works.
function toolGroup(group, live) {
  const key = `g:${group[0].id}`, open = view.open.has(key) || (live && !view.open.has(`${key}:shut`)), last = group.at(-1);
  return html`<div class="sx-group${open ? ' open' : ''}"><button class="sx-group-head" data-sx=${key} data-sx-live=${live ? '1' : ''}>${icon.chev}<span>${group.length} step${group.length === 1 ? '' : 's'}</span><span class="sx-group-last">${toolLine(last.name, last.input)}</span><span class="at">${hhmm(group[0].at)}</span></button>${
    open ? html`<div class="sx-rows">${group.map(tool)}</div>` : nothing}</div>`;
}

const WHO = { you: 'You', conductor: 'Rocco', worker: 'Worker', rocco: 'Rocco' };

function row(r) {
  const at = html`<span class="at">${hhmm(r.at)}</span>`;
  switch (r.kind) {
    case 'brief': {
      const open = view.open.has(`b:${r.at}`);
      return html`<div class="sx-brief${open ? ' open' : ''}"><div class="sx-head"><span class="sx-who">Rocco's brief</span>${r.desc ? html`<span class="sx-desc">${r.desc}</span>` : nothing}${at}</div><div class="sx-text">${prose(r.text)}</div><button class="linkish sx-more" data-sx="b:${r.at}">${open ? 'Show less' : 'Show all'}</button></div>`;
    }
    case 'said': return html`<div class="sx-msg agent"><div class="sx-head"><span class="sx-who">Agent</span>${at}</div><div class="sx-text">${prose(r.text)}</div></div>`;
    case 'told': return html`<div class="sx-msg rocco"><div class="sx-head"><span class="sx-who">Rocco</span>${at}</div><div class="sx-text">${prose(r.text)}</div></div>`;
    case 'log': return r.who === 'you'
      ? html`<div class="sx-msg you"><div class="sx-head">${at}</div><div class="sx-text">${r.text}</div></div>`
      : html`<div class="sx-msg note"><div class="sx-head"><span class="sx-who">${WHO[r.who] || r.who}</span>${at}</div><div class="sx-text">${prose(r.text)}</div></div>`;
  }
  return nothing;
}

// Reading it failed: say so under what's already shown. It's tried again by itself; Retry tries now.
const problem = () => view.error ? html`<div class="load-error">${icon.alert}<span>Couldn't read its session: ${view.error}</span><button class="btn-sm" data-sx-retry>Retry</button></div>` : nothing;

function stream(t) {
  if (!view.loaded) return view.error ? problem() : html`<div class="sx-empty"><span class="spin"></span>Loading its session${view.progress ? ` · ${view.progress}%` : ''}</div>`;
  const rows = (t.log || []).map(l => ({ kind: 'log', at: l.at, who: l.who, text: l.text }));
  for (const s of view.sessions.values()) rows.push(...s.items.map(it => it.kind === 'brief' ? { ...it, desc: s.desc } : it));
  if (!rows.length) return html`<div class="sx-empty">Nothing yet. What its agent does shows here as it works.</div>${problem()}`;
  // The card's times carry the PC's offset, the session's are UTC: compared as times, not text.
  const time = r => Date.parse(r.at) || 0;
  rows.sort((a, b) => time(a) - time(b));
  const live = t.status === 'working';
  const out = [];
  let group = [];
  const flush = last => { if (group.length) { out.push(toolGroup(group, live && last)); group = []; } };
  rows.forEach((r, i) => {
    if (r.kind === 'tool') { group.push(r); if (i === rows.length - 1) flush(true); return; }
    flush(false);
    out.push(row(r));
  });
  return html`${out}${problem()}`;
}

// ---- The view: shown in a card's sheet, kept current while it's open ----

// Reading at the end, it follows what comes in.
function draw(follow = true) {
  const box = $('#sx'), t = view && byId(view.id);
  if (!box || !t) return;
  const scroller = $('#sBody');
  const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
  render(stream(t), box);
  if (follow && atEnd) scroller.scrollTop = scroller.scrollHeight;
}

// One read at a time: asked for again while one is on its way, it reads once more as soon as that one is done.
async function tick(id) {
  if (!view || view.id !== id || openSheetKey() !== id) { stopSession(); return; }
  const v = view;
  if (v.reading) { v.again = true; return; }
  v.reading = true;
  try {
    const changed = await pull(v);
    if (view !== v) return;
    // The card's line about what it took (taskparts.js) follows its sessions.
    const used = JSON.stringify(sessionUsage(id));
    if (used !== v.used) { v.used = used; emit('session-usage', id); }
    const t = byId(id), stamp = `${t?.log?.length}|${t?.status}`, hadError = !!v.error;
    v.error = '';
    if (changed || stamp !== v.stamp || !v.loaded || hadError) {
      v.stamp = stamp;
      const first = !v.loaded;
      v.loaded = true;
      // A card opens at the end of its session, like a chat; its top stays in view above (workboard.js).
      draw(!first);
      if (first) $('#sBody').scrollTop = $('#sBody').scrollHeight;
    }
  } catch (e) {
    if (view !== v) return;
    if (v.error !== e.message) { v.error = e.message; draw(false); }
  }
  v.reading = false;
  clearTimeout(v.timer);
  v.timer = setTimeout(() => tick(id), v.again ? 0 : POLL);
  v.again = false;
}

// Called when a task's sheet opens (or opens again, after you send it something): what's been read is kept.
export function startSession(id) {
  if (view?.id !== id) { stopSession(); view = { id, sessions: new Map(), open: new Set(), stamp: '', loaded: false, progress: 0, timer: 0, reading: false, again: false, error: '' }; }
  clearTimeout(view.timer);
  draw();
  tick(id);
}

export function stopSession() {
  if (view) clearTimeout(view.timer);
  view = null;
}

// After you send something: show it, and keep reading.
export const scrollSessionToEnd = () => { const s = $('#sBody'); if (s) s.scrollTop = s.scrollHeight; };

export function initSession() {
  document.addEventListener('click', /** @param {MouseEvent & { target: any }} e */ e => {
    if (!view || !$('#sx')?.contains(e.target)) return;
    if (e.target.closest('[data-sx-retry]')) { tick(view.id); return; }
    const head = e.target.closest('[data-sx]');
    if (!head) return;
    const key = head.dataset.sx;
    if (head.dataset.sxLive) {
      // The live group is open until it's shut by hand.
      const shut = `${key}:shut`, isOpen = view.open.has(key) || !view.open.has(shut);
      if (isOpen) { view.open.delete(key); view.open.add(shut); } else { view.open.add(key); view.open.delete(shut); }
    } else if (view.open.has(key)) view.open.delete(key);
    else view.open.add(key);
    draw(false);
  });
  on('prose', () => draw(false));
}
