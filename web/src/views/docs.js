// Docs: every Markdown file in the repo, by folder; hover one for a preview. Open one to read it, ask Claude to
// change it (a note in Up next), or edit it here and push the change to GitHub (rocco/server/docs.ps1).
import { state, emit } from '../state.js';
import { $, esc } from '../lib/dom.js';
import { agoText } from '../lib/format.js';
import { icon } from '../lib/icons.js';
import { storage } from '../lib/storage.js';
import { markdown } from '../lib/markdown.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';
import { initPopover } from '../ui/popover.js';
import { go, syncUrl, docUrl } from '../router.js';
import * as sync from '../sync.js';

let open = null;            // the open doc as the server sent it: { path, text, hash, dirty, locked, last }, or { path, error }
let opening = '';           // the doc being fetched
let mode = 'read';          // 'read' or 'edit'
let filter = '';
let askText = '';
let saving = false;
let conflict = null;        // { hash }: the doc changed on disk since it was opened
let notice = '';            // why the last push didn't reach GitHub
let loadError = '';
let timer = null;
let lastTree = '';
const drafts = new Map();   // project/path -> the user's edit, not pushed yet
const messages = new Map(); // project/path -> the commit message they typed
const key = path => `${state.project}/${path}`;
const nameOf = path => path.split('/').pop();
const docOf = path => state.docs?.docs.find(d => d.path === path);
const lf = text => String(text).replace(/\r\n?/g, '\n');
const LOCKED = 'Owned by the template: in a game it changes through the template, so ask Claude to change it.';

// Folders the user closed, kept in this browser. .claude (agent definitions) starts closed.
let closed;
try { closed = new Set(JSON.parse(storage.get('rocco.docs.closed') || 'null') ?? ['.claude']); } catch { closed = new Set(['.claude']); }

export async function loadDocs() {
  clearTimeout(timer);
  try {
    state.docs = await api.docs();
    loadError = '';
    afterList();
    emit('docs');
  } catch (e) {
    // A server started before Docs existed answers Not found.
    loadError = /not found/i.test(e.message) ? 'Restart Rocco to see Docs: this server started before Docs existed (close its window, then run rocco\\Rocco.bat).' : '';
    if (loadError) emit('docs');
  }
  if (state.view === 'docs') timer = setTimeout(loadDocs, 15000);
}

// After the list loads: open the doc in the address, and pick up changes to the open one.
function afterList() {
  const listed = state.doc && docOf(state.doc);
  if (state.doc && !listed) { state.doc = ''; open = null; if (state.view === 'docs') syncUrl(); return; }
  if (!listed) return;
  if ((!open || open.path !== state.doc) && opening !== state.doc) { openDoc(state.doc); return; }
  if (!open || open.error || opening || listed.hash === open.hash) return;
  // It changed on disk (Claude edited it, or a refresh pulled it in): show the new text, or warn about the edit.
  if (!drafts.has(key(open.path))) reopen();
  else if (!conflict) { conflict = { hash: listed.hash }; renderDoc(); }
}

// A different project: the open doc belonged to the old one.
export function resetDocs() {
  open = null;
  opening = '';
  conflict = null;
  notice = '';
  askText = '';
  mode = 'read';
  lastTree = '';
}

export async function openDoc(path) {
  if (open?.path !== path) { conflict = null; notice = ''; askText = ''; $('.main').scrollTop = 0; }
  state.doc = path;
  mode = drafts.has(key(path)) ? 'edit' : 'read';
  opening = path;
  syncUrl();
  renderTree();
  renderDoc();
  try {
    const d = await api.doc(path);
    if (state.doc === path) open = d;
  } catch (e) {
    if (state.doc === path) open = { path, error: e.message };
  }
  if (opening === path) opening = '';
  if (state.doc === path) renderDoc();
}

// Open a doc from anywhere (the palette).
export function showDoc(path) {
  go('docs');
  openDoc(path);
}

async function reopen() {
  const path = state.doc;
  if (!path) return;
  try {
    const d = await api.doc(path);
    if (state.doc === path) { open = d; renderDoc(); }
  } catch { /* the sidebar shows the server is offline */ }
}

// ---- Finding docs: the doc a mention names ----

// A path from the repo root, the tail of a longer path (template\repo\docs\...), or a file name only one doc has
// (or the one in the open doc's own folder).
function docRef(text, base) {
  const docs = state.docs?.docs || [];
  const paths = new Set(docs.map(d => d.path));
  const parts = text.replace(/\\/g, '/').split('/').filter(p => p && p !== '.' && p !== '..');
  for (let n = 0; n < parts.length - 1; n++) { const p = parts.slice(n).join('/'); if (paths.has(p)) return p; }
  const name = parts[parts.length - 1];
  const same = docs.filter(d => nameOf(d.path) === name);
  if (same.length === 1) return same[0].path;
  const dir = base.split('/').slice(0, -1).join('/');
  return same.find(d => d.path === (dir ? `${dir}/${name}` : name))?.path || '';
}

// ---- The tree ----

function build(docs) {
  const root = { path: '', folders: new Map(), files: [] };
  for (const d of docs) {
    let node = root;
    for (const part of d.path.split('/').slice(0, -1)) {
      const path = node.path ? `${node.path}/${part}` : part;
      if (!node.folders.has(part)) node.folders.set(part, { name: part, path, folders: new Map(), files: [] });
      node = node.folders.get(part);
    }
    node.files.push(d);
  }
  return root;
}

const total = f => f.files.length + [...f.folders.values()].reduce((n, c) => n + total(c), 0);

// Folders first (dot-folders last), then files; alphabetical within each.
function nodeHTML(node, depth) {
  const folders = [...node.folders.values()].sort((a, b) => (a.name.startsWith('.') - b.name.startsWith('.')) || a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => nameOf(a.path).localeCompare(nameOf(b.path)));
  return folders.map(f => folderHTML(f, depth)).join('') + files.map(d => fileHTML(d, depth)).join('');
}

function folderHTML(f, depth) {
  const shut = closed.has(f.path) && !filter;
  return `<div class="dt-group${shut ? ' shut' : ''}"><button class="dt-folder" data-folder="${esc(f.path)}" style="--d:${depth}" aria-expanded="${!shut}">`
    + `<span class="dt-chev">${icon.chev}</span>${icon.folder}<span class="dt-name">${esc(f.name)}</span><span class="dt-count">${total(f)}</span></button>`
    + (shut ? '' : nodeHTML(f, depth + 1)) + '</div>';
}

function fileHTML(d, depth) {
  const mark = drafts.has(key(d.path)) ? '<i class="dt-dot draft" title="Your edit, not pushed yet"></i>'
    : d.dirty ? '<i class="dt-dot" title="Uncommitted changes in repo\\"></i>' : '';
  return `<button class="dt-file${d.path === state.doc ? ' on' : ''}" data-doc="${esc(d.path)}" style="--d:${depth}">${icon.doc}`
    + `<span class="dt-name">${esc(nameOf(d.path))}</span>${mark}${d.locked ? `<span class="dt-lock" title="Owned by the template">${icon.lock}</span>` : ''}</button>`;
}

function renderTree() {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const docs = (state.docs?.docs || []).filter(d => words.every(w => `${d.path} ${d.title} ${d.preview}`.toLowerCase().includes(w)));
  const html = !state.docs ? `<div class="empty">${loadError ? 'Needs a Rocco restart' : 'Loading docs…'}</div>`
    : docs.length ? nodeHTML(build(docs), 0) : `<div class="empty">${filter ? 'No docs match' : 'No Markdown files in this repo yet'}</div>`;
  if (html !== lastTree) $('#docsTree').innerHTML = lastTree = html;
}

function toggleFolder(path) {
  if (closed.has(path)) closed.delete(path); else closed.add(path);
  storage.set('rocco.docs.closed', JSON.stringify([...closed]));
  renderTree();
}

// The hover: title, where it is, its first lines, its sections, and when it last changed.
function summaryHTML(d) {
  const when = d.dirty ? 'Uncommitted changes' : `Changed ${agoText(d.at)}${d.by ? ` by ${esc(d.by)}` : ''}`;
  const sections = d.sections || [];
  return `<div class="ph">${icon.doc}<span>${esc(d.title || nameOf(d.path))}</span></div><div class="pop-path">${esc(d.path)}</div>`
    + (d.preview ? `<div class="pop-text">${esc(d.preview)}</div>` : '')
    + (sections.length ? `<div class="pop-secs">${sections.slice(0, 6).map(s => `<span>${esc(s)}</span>`).join('')}${sections.length > 6 ? `<span>+${sections.length - 6}</span>` : ''}</div>` : '')
    + `<div class="pop-meta">${when}${d.locked ? ' · owned by the template' : ''}${drafts.has(key(d.path)) ? ' · your edit isn\'t pushed' : ''}</div>`;
}

// ---- The open doc ----

function metaHTML(d) {
  const last = d.last?.at ? `<span title="${esc(d.last.subject)}">Changed ${agoText(d.last.at)}${d.last.by ? ` by ${esc(d.last.by)}` : ''}</span>` : '<span>Not committed yet</span>';
  return last
    + (drafts.has(key(d.path)) ? '<span class="doc-flag draft"><i></i>Your edit, not pushed</span>' : '')
    + (d.dirty ? '<span class="doc-flag warn"><i></i>Uncommitted changes in repo\\</span>' : '')
    + (d.locked ? `<span class="doc-flag" title="${esc(LOCKED)}">${icon.lock}Owned by the template</span>` : '');
}

function headHTML(d) {
  const parts = d.path.split('/');
  const crumbs = parts.map((p, n) => n === parts.length - 1 ? `<b>${esc(p)}</b>` : `${esc(p)}<i>/</i>`).join('');
  const editing = mode === 'edit' && !d.locked;
  const tab = (m, label, on, extra = '') => `<button role="tab" data-mode="${m}" class="${on ? 'on' : ''}" aria-selected="${on}"${extra}>${label}</button>`;
  const github = state.docs?.repo ? `<a class="icon-btn" href="${esc(`${state.docs.repo}/blob/main/${encodeURI(d.path)}`)}" target="_blank" rel="noreferrer" title="Open on GitHub" aria-label="Open on GitHub">${icon.external}</a>` : '';
  return `<div class="doc-head"><div class="doc-crumbs" title="${esc(d.path)}">${crumbs}</div>`
    + `<div class="doc-tabs" role="tablist">${tab('read', 'Read', !editing)}${tab('edit', `${icon.pen}Edit`, editing, d.locked ? ` disabled title="${esc(LOCKED)}"` : '')}</div>${github}</div>`
    + `<div class="doc-meta" id="docMeta">${metaHTML(d)}</div>`;
}

function askHTML(d) {
  const hint = d.locked ? 'Ask Claude to change this doc (it goes through the template)' : 'Ask Claude to change this doc…';
  return `<form class="doc-ask" id="docAskForm" autocomplete="off"><span class="doc-ask-icon">${icon.sparkle}</span>`
    + `<textarea id="docAsk" rows="1" placeholder="${esc(hint)}" aria-label="Ask Claude to change this doc"></textarea>`
    + '<button class="send" type="submit" title="Add to Up next" aria-label="Add to Up next"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg></button></form>';
}

function notesHTML(d) {
  const mine = drafts.has(key(d.path));
  let html = '';
  if (conflict) {
    html += `<div class="doc-note" style="--c:var(--amber)">${icon.alert}<span>${esc(nameOf(d.path))} changed since you opened it${mine ? '. Pushing your edit now would undo that change.' : '.'}</span>`
      + `<button class="mini" data-act="latest">Load the latest</button>${mine ? '<button class="mini" data-act="force">Push mine anyway</button>' : ''}</div>`;
  }
  if (notice) html += `<div class="doc-note" style="--c:var(--amber)">${icon.alert}<span>${esc(notice)}</span><button class="mini" data-act="dismiss">OK</button></div>`;
  if (d.dirty && mode === 'edit' && !d.locked) {
    html += `<div class="doc-note" style="--c:var(--blue)">${icon.alert}<span>This doc has changes in repo\\ that aren't committed yet, likely Claude's work in progress. Pushing commits them along with your edit.</span></div>`;
  }
  return html;
}

function pushLabel() { return saving ? '<span class="spin"></span>Pushing…' : `${icon.up}Push changes`; }

function barHTML(d) {
  const mine = drafts.has(key(d.path));
  return '<div class="doc-bar">'
    + `<input class="input" id="docMsg" placeholder="${esc(nameOf(d.path))}: what changed (optional)" value="${esc(messages.get(key(d.path)) || '')}" aria-label="What changed, for the commit">`
    + `<button class="btn" data-act="discard"${mine ? '' : ' disabled'}>Discard</button>`
    + `<button class="btn accent" data-act="push" id="docPush"${mine && !saving ? '' : ' disabled'}>${pushLabel()}</button></div>`;
}

function blankHTML() {
  const recent = (state.docs?.docs || []).slice().sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 6);
  return `<div class="panel doc doc-blank"><div class="blank-icon">${icon.doc}</div><div class="blank-title">Pick a doc</div>`
    + '<div class="blank-sub">Hover one for a preview. Open it to read it, edit it and push, or ask Claude to change it.</div>'
    + (recent.length ? `<div class="doc-recents"><div class="doc-recents-label">Changed lately</div>${recent.map(d => `<button class="doc-recent" data-doc="${esc(d.path)}">${icon.doc}`
      + `<span class="dr-name">${esc(d.title || nameOf(d.path))}</span><span class="dr-path">${esc(d.path)}</span><span class="dr-at">${agoText(d.at)}</span></button>`).join('')}</div>` : '')
    + '</div>';
}

function paneHTML() {
  if (!state.doc) return state.docs || !loadError ? blankHTML() : `<div class="panel doc doc-blank"><div class="blank-sub">${esc(loadError)}</div></div>`;
  if (!open || open.path !== state.doc) return `<div class="panel doc"><div class="doc-wait"><span class="spin"></span>Opening ${esc(state.doc)}</div></div>`;
  const d = open;
  if (d.error) return `<div class="panel doc"><div class="doc-wait">Couldn't open ${esc(d.path)}: ${esc(d.error)}</div></div>`;
  const editing = mode === 'edit' && !d.locked, mine = drafts.has(key(d.path));
  return `<div class="panel doc">${headHTML(d)}${askHTML(d)}${notesHTML(d)}<div class="doc-body">`
    + (editing ? `<textarea class="field doc-editor" id="docEditor" aria-label="Edit ${esc(d.path)}"></textarea>`
      : `<div class="md">${markdown(drafts.get(key(d.path)) ?? d.text, { base: d.path, docRef, href: docUrl })}</div>`)
    + `</div>${editing || mine ? barHTML(d) : ''}</div>`;
}

// Grows with its text. The page scrolls, not the box, so keep the page where it was.
function fit(el) {
  const main = $('.main'), top = main.scrollTop;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 2 + 'px';
  main.scrollTop = top;
}

function renderDoc() {
  // Re-rendering keeps whatever the user was typing in, and where.
  const active = document.activeElement, id = active?.closest?.('#docPane') ? active.id : '';
  const selection = id && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  $('#docPane').innerHTML = paneHTML();
  const editor = $('#docEditor');
  if (editor) { editor.value = drafts.get(key(open.path)) ?? lf(open.text); fit(editor); }
  const ask = $('#docAsk');
  if (ask) { ask.value = askText; fit(ask); }
  const again = id && document.getElementById(id);
  if (again) { again.focus({ preventScroll: true }); if (selection) again.setSelectionRange(...selection); }
}

function updateBar() {
  const mine = !!open && drafts.has(key(open.path));
  const discard = $('#docPane [data-act="discard"]');
  if (discard) discard.disabled = !mine;
  const push = $('#docPush');
  if (push) { push.disabled = !mine || saving; push.innerHTML = pushLabel(); }
}

export function renderDocs() {
  const d = state.docs;
  $('#docsRepo').hidden = !d?.repo;
  if (d?.repo) $('#docsRepo').href = d.repo;
  const dirty = d ? d.docs.filter(x => x.dirty).length : 0, locked = d ? d.docs.filter(x => x.locked).length : 0;
  $('#docsSub').textContent = d ? [`${d.docs.length} docs`, dirty && `${dirty} with uncommitted changes`, locked && `${locked} owned by the template`].filter(Boolean).join(' · ') : '';
  renderTree();
  if (!state.doc || !open) renderDoc();
}

// ---- What the user does ----

function setMode(m) {
  if (m === mode || !open || open.error) return;
  mode = m;
  renderDoc();
  if (m === 'edit') $('#docEditor')?.focus({ preventScroll: true });
}

async function ask() {
  const text = askText.trim();
  if (!text || !open) return;
  try {
    await api.note(`Change ${open.path}: ${text}`, '');
    askText = '';
    const el = $('#docAsk');
    if (el) { el.value = ''; fit(el); }
    toast('Added to Up next', 'var(--violet)', { label: 'Workboard', run: () => go('workboard') });
    sync.refresh();
  } catch (e) { toast(`Couldn't add the note: ${e.message}`, 'var(--red)'); }
}

async function push(force) {
  if (!open || saving) return;
  const d = open, k = key(d.path), text = drafts.get(k);
  if (text === undefined) return;
  saving = true;
  updateBar();
  try {
    const r = await api.saveDoc(d.path, text, force && conflict ? conflict.hash : d.hash, messages.get(k) || '');
    if (r.conflict) { conflict = { hash: r.hash }; renderDoc(); return; }
    drafts.delete(k);
    messages.delete(k);
    conflict = null;
    mode = 'read';
    notice = r.pushed || r.nothing ? '' : r.note;
    if (r.nothing) toast('Nothing to push: it matches the saved doc', 'var(--gray)');
    else if (r.pushed) toast(`Pushed ${nameOf(d.path)} to GitHub`);
    else toast(`Committed ${nameOf(d.path)}, but it isn't on GitHub yet`, 'var(--amber)');
    renderTree();
    await reopen();
    loadDocs();
  } catch (e) {
    toast(`Couldn't push: ${e.message}`, 'var(--red)');
  } finally {
    saving = false;
    updateBar();
  }
}

function discard() {
  if (!open) return;
  const path = open.path, k = key(path), text = drafts.get(k);
  if (text === undefined) return;
  drafts.delete(k);
  mode = 'read';
  if (conflict) { conflict = null; reopen(); }
  renderTree();
  renderDoc();
  toast('Edit discarded', 'var(--amber)', { label: 'Undo', run: () => {
    drafts.set(k, text);
    if (state.doc === path) { mode = 'edit'; renderDoc(); }
    renderTree();
  } });
}

// The newer text replaces the user's edit; their edit can still be copied, to put back by hand.
async function loadLatest() {
  if (!open) return;
  const k = key(open.path), text = drafts.get(k);
  drafts.delete(k);
  conflict = null;
  mode = 'read';
  renderTree();
  await reopen();
  if (text !== undefined) toast('Loaded the latest. Your edit is set aside', 'var(--amber)', { label: 'Copy my edit', run: () => navigator.clipboard.writeText(text) });
}

export function initDocs() {
  initPopover('.dt-file, .doc-ref, .doc-recent', el => { const d = docOf(el.dataset.doc); return d ? summaryHTML(d) : ''; });

  const filterInput = $('#docsFilter');
  filterInput.addEventListener('input', () => { filter = filterInput.value.trim(); renderTree(); });
  filterInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const first = $('#docsTree .dt-file'); if (first) openDoc(first.dataset.doc); }
    else if (e.key === 'Escape' && filter) { e.stopPropagation(); filterInput.value = filter = ''; renderTree(); }
  });

  $('#docsTree').addEventListener('click', e => {
    const folder = e.target.closest('[data-folder]');
    if (folder) { toggleFolder(folder.dataset.folder); return; }
    const file = e.target.closest('[data-doc]');
    if (file) openDoc(file.dataset.doc);
  });

  const pane = $('#docPane');
  pane.addEventListener('click', e => {
    const ref = e.target.closest('[data-doc]');
    if (ref) {
      if (ref.tagName === 'A' && (e.ctrlKey || e.metaKey || e.shiftKey)) return; // a new tab or window
      e.preventDefault();
      openDoc(ref.dataset.doc);
      return;
    }
    const anchor = e.target.closest('[data-anchor]');
    if (anchor) { e.preventDefault(); pane.querySelector(`#${CSS.escape(anchor.dataset.anchor)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const tab = e.target.closest('[data-mode]');
    if (tab) { if (!tab.disabled) setMode(tab.dataset.mode); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'push') push(false);
    else if (act === 'force') push(true);
    else if (act === 'discard') discard();
    else if (act === 'latest') loadLatest();
    else if (act === 'dismiss') { notice = ''; renderDoc(); }
  });

  pane.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'docAsk') { askText = el.value; fit(el); return; }
    if (!open) return;
    const k = key(open.path);
    if (el.id === 'docMsg') { messages.set(k, el.value); return; }
    if (el.id !== 'docEditor') return;
    const had = drafts.has(k);
    if (el.value === lf(open.text)) drafts.delete(k); else drafts.set(k, el.value);
    fit(el);
    if (had !== drafts.has(k)) { renderTree(); $('#docMeta').innerHTML = metaHTML(open); }
    updateBar();
  });

  pane.addEventListener('keydown', e => {
    if (e.target.id === 'docAsk' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
  });
  pane.addEventListener('submit', e => { e.preventDefault(); ask(); });

  // Edits live only in this tab until they're pushed.
  addEventListener('beforeunload', e => { if (drafts.size) { e.preventDefault(); e.returnValue = ''; } });
}
