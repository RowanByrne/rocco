// Docs: every Markdown file in the repo, by folder; hover one for a preview. Open one to read it, ask the agent to
// change it (a note in Up next), or edit it here and push the change to GitHub (server/docs.ps1).
import { state, emit } from '../state.js';
import { $, webUrl } from '../lib/dom.js';
import { html, render, nothing, live, ifDefined, unsafeHTML } from '../lib/html.js';
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
let asking = false;         // the ask box's note is on its way
let saving = false;
let conflict = null;        // { hash }: the doc changed on disk since it was opened
let notice = '';            // why the last push didn't reach GitHub
let loadError = '';         // why the list of docs couldn't be read
let timer = null;
const drafts = new Map();   // project/path -> the user's edit, not pushed yet
const messages = new Map(); // project/path -> the commit message they typed
const key = path => `${state.project}/${path}`;
const nameOf = path => path.split('/').pop();
const docOf = path => state.docs?.docs.find(d => d.path === path);
const lf = text => String(text).replace(/\r\n?/g, '\n');
export const hasDrafts = () => drafts.size > 0;
// Why a doc can't be edited here: it's the template's, or (lockedWhy, from the server) it isn't saved as UTF-8.
const locked = d => d?.lockedWhy || `Owned by the template: in a game it changes through the template, so ask Rocco to change it.`;

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
    // A server started before Docs existed answers Not found. One that's stopped is the sidebar's to say.
    loadError = /not found/i.test(e.message) ? 'Restart Rocco to see Docs: this server started before Docs existed (close its window, then run tools\\rocco.bat in any project).'
      : e.offline ? '' : `Couldn't load the docs: ${e.message}`;
    emit('docs');
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
  // It changed on disk (the agent edited it, or a refresh pulled it in): show the new text, or warn about the edit.
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
  } catch { /* what's shown stays; the list is asked for again by itself */ }
}

// ---- Finding docs: the doc a mention names ----

// A path from the repo root, the tail of a longer path (template\repo\docs\...), or a file name only one doc has
// (or the one in the open doc's own folder).
export function docRef(text, base) {
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
function branch(node, depth) {
  const folders = [...node.folders.values()].sort((a, b) => (a.name.startsWith('.') - b.name.startsWith('.')) || a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => nameOf(a.path).localeCompare(nameOf(b.path)));
  return html`${folders.map(f => folder(f, depth))}${files.map(d => file(d, depth))}`;
}

function folder(f, depth) {
  const shut = closed.has(f.path) && !filter;
  return html`<div class="dt-group${shut ? ' shut' : ''}"><button class="dt-folder" data-folder=${f.path} style="--d:${depth}" aria-expanded=${shut ? 'false' : 'true'}><span class="dt-chev">${icon.chev}</span>${icon.folder}<span class="dt-name">${f.name}</span><span class="dt-count">${total(f)}</span></button>${
    shut ? nothing : branch(f, depth + 1)}</div>`;
}

function file(d, depth) {
  const mark = drafts.has(key(d.path)) ? html`<i class="dt-dot draft" title="Your edit, not pushed yet"></i>`
    : d.dirty ? html`<i class="dt-dot" title="Uncommitted changes in repo\\"></i>` : nothing;
  return html`<button class="dt-file${d.path === state.doc ? ' on' : ''}" data-doc=${d.path} style="--d:${depth}">${icon.doc}<span class="dt-name">${nameOf(d.path)}</span>${mark}${
    d.locked ? html`<span class="dt-lock" title="Owned by the template">${icon.lock}</span>` : nothing}</button>`;
}

// The list couldn't be read: why, and a way to try again. What was loaded before stays under it.
const failed = () => loadError ? html`<div class="load-error">${icon.alert}<span>${loadError}</span><button class="btn-sm" data-docs-retry>Retry</button></div>` : nothing;

function renderTree() {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const docs = (state.docs?.docs || []).filter(d => words.every(w => `${d.path} ${d.title} ${d.preview}`.toLowerCase().includes(w)));
  render(!state.docs ? (loadError ? failed() : html`<div class="empty">Loading docs…</div>`)
    : html`${failed()}${docs.length ? branch(build(docs), 0) : html`<div class="empty">${filter ? 'No docs match' : 'No Markdown files in this repo yet'}</div>`}`, $('#docsTree'));
}

function toggleFolder(path) {
  if (closed.has(path)) closed.delete(path); else closed.add(path);
  storage.set('rocco.docs.closed', JSON.stringify([...closed]));
  renderTree();
}

// The hover: title, where it is, its first lines, its sections, and when it last changed.
function summary(d) {
  const when = d.dirty ? 'Uncommitted changes' : `Changed ${agoText(d.at)}${d.by ? ` by ${d.by}` : ''}`;
  const sections = d.sections || [];
  return html`<div class="ph">${icon.doc}<span>${d.title || nameOf(d.path)}</span></div><div class="pop-path">${d.path}</div>${
    d.preview ? html`<div class="pop-text">${d.preview}</div>` : nothing}${
    sections.length ? html`<div class="pop-secs">${sections.slice(0, 6).map(x => html`<span>${x}</span>`)}${sections.length > 6 ? html`<span>+${sections.length - 6}</span>` : nothing}</div>` : nothing
  }<div class="pop-meta">${when}${d.locked ? ' · owned by the template' : ''}${drafts.has(key(d.path)) ? ' · your edit isn\'t pushed' : ''}</div>`;
}

// ---- The open doc ----

function meta(d) {
  return html`${d.last?.at ? html`<span title=${d.last.subject || ''}>Changed ${agoText(d.last.at)}${d.last.by ? ` by ${d.last.by}` : ''}</span>` : html`<span>Not committed yet</span>`}${
    drafts.has(key(d.path)) ? html`<span class="doc-flag draft"><i></i>Your edit, not pushed</span>` : nothing}${
    d.dirty ? html`<span class="doc-flag warn"><i></i>Uncommitted changes in repo\\</span>` : nothing}${
    d.locked ? html`<span class="doc-flag" title=${locked(d)}>${icon.lock}${d.lockedWhy ? 'Not UTF-8, so read only' : 'Owned by the template'}</span>` : nothing}`;
}

function head(d) {
  const parts = d.path.split('/');
  const editing = mode === 'edit' && !d.locked;
  const tab = (m, label, on, off = false) => html`<button role="tab" data-mode=${m} class=${on ? 'on' : ''} aria-selected=${on ? 'true' : 'false'} ?disabled=${off} title=${ifDefined(off ? locked(d) : undefined)}>${label}</button>`;
  return html`<div class="doc-head"><div class="doc-crumbs" title=${d.path}>${parts.map((p, n) => n === parts.length - 1 ? html`<b>${p}</b>` : html`${p}<i>/</i>`)}</div><div class="doc-tabs" role="tablist">${
    tab('read', 'Read', !editing)}${tab('edit', html`${icon.pen}Edit`, editing, !!d.locked)}</div>${
    state.docs?.repo ? html`<a class="icon-btn" href=${webUrl(`${state.docs.repo}/blob/main/${encodeURI(d.path)}`)} target="_blank" rel="noreferrer" title="Open on GitHub" aria-label="Open on GitHub">${icon.external}</a>` : nothing
  }</div><div class="doc-meta" id="docMeta">${meta(d)}</div>`;
}

const SEND_ICON = html`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>`;

const askBox = d => html`<form class="doc-ask" id="docAskForm" autocomplete="off"><span class="doc-ask-icon">${icon.sparkle}</span><textarea id="docAsk" rows="1" placeholder=${
  d.locked && !d.lockedWhy ? `Ask Rocco to change this doc (it goes through the template)` : `Ask Rocco to change this doc…`} aria-label="Ask Rocco to change this doc" .value=${live(askText)}></textarea><button class="send" type="submit" title="Add to Up next" aria-label="Add to Up next">${SEND_ICON}</button></form>`;

function notes(d) {
  const mine = drafts.has(key(d.path));
  return html`${conflict ? html`<div class="doc-note" style="--c:var(--amber)">${icon.alert}<span>${nameOf(d.path)} changed since you opened it${mine ? '. Pushing your edit now would undo that change.' : '.'}</span><button class="mini" data-act="latest">Load the latest</button>${
    mine ? html`<button class="mini" data-act="force">Push mine anyway</button>` : nothing}</div>` : nothing}${
    notice ? html`<div class="doc-note" style="--c:var(--amber)">${icon.alert}<span>${notice}</span><button class="mini" data-act="dismiss">OK</button></div>` : nothing}${
    d.dirty && mode === 'edit' && !d.locked ? html`<div class="doc-note" style="--c:var(--blue)">${icon.alert}<span>This doc has changes in repo\\ that aren't committed yet, likely your agent's work in progress. Pushing commits them along with your edit.</span></div>` : nothing}`;
}

function bar(d) {
  const k = key(d.path), mine = drafts.has(k);
  return html`<div class="doc-bar"><input class="input" id="docMsg" placeholder="${nameOf(d.path)}: what changed (optional)" .value=${live(messages.get(k) || '')} aria-label="What changed, for the commit"><button class="btn" data-act="discard" ?disabled=${!mine}>Discard</button><button class="btn accent" data-act="push" id="docPush" ?disabled=${!mine || saving}>${
    saving ? html`<span class="spin"></span>Pushing…` : html`${icon.up}Push changes`}</button></div>`;
}

function blank() {
  const recent = (state.docs?.docs || []).slice().sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 6);
  return html`<div class="panel doc doc-blank"><div class="blank-icon">${icon.doc}</div><div class="blank-title">Pick a doc</div><div class="blank-sub">Hover one for a preview. Open it to read it, edit it and push, or ask Rocco to change it.</div>${
    recent.length ? html`<div class="doc-recents"><div class="doc-recents-label">Changed lately</div>${recent.map(d => html`<button class="doc-recent" data-doc=${d.path}>${icon.doc}<span class="dr-name">${d.title || nameOf(d.path)}</span><span class="dr-path">${d.path}</span><span class="dr-at">${agoText(d.at)}</span></button>`)}</div>` : nothing}</div>`;
}

function pane() {
  if (!state.doc) return state.docs || !loadError ? blank() : html`<div class="panel doc doc-blank">${failed()}</div>`;
  if (!open || open.path !== state.doc) return html`<div class="panel doc"><div class="doc-wait"><span class="spin"></span>Opening ${state.doc}</div></div>`;
  const d = open;
  if (d.error) return html`<div class="panel doc"><div class="doc-wait"><div class="load-error">${icon.alert}<span>Couldn't open ${d.path}: ${d.error}</span><button class="btn-sm" data-act="reopen">Retry</button></div></div></div>`;
  const k = key(d.path), editing = mode === 'edit' && !d.locked, mine = drafts.has(k);
  return html`<div class="panel doc">${head(d)}${askBox(d)}${notes(d)}<div class="doc-body">${
    editing ? html`<textarea class="field doc-editor" id="docEditor" aria-label="Edit ${d.path}" .value=${live(drafts.get(k) ?? lf(d.text))}></textarea>`
      : html`<div class="md">${unsafeHTML(markdown(drafts.get(k) ?? d.text, { base: d.path, docRef, href: docUrl }))}</div>`
  }</div>${editing || mine ? bar(d) : nothing}</div>`;
}

// Grows with its text. The page scrolls, not the box, so keep the page where it was.
function fit(el) {
  const main = $('.main'), top = main.scrollTop;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 2 + 'px';
  main.scrollTop = top;
}

// Only what changed is touched, so whatever the user is typing in stays, with its caret.
function renderDoc() {
  render(pane(), $('#docPane'));
  for (const id of ['#docEditor', '#docAsk']) { const el = $(id); if (el) fit(el); }
}

export function renderDocs() {
  const d = state.docs;
  $('#docsRepo').hidden = !d?.repo;
  if (d?.repo) $('#docsRepo').href = webUrl(d.repo);
  $('#docsDetails').hidden = !d || d.template; // the onboarding's detail tiles: a game's, not the template's
  const dirty = d ? d.docs.filter(x => x.dirty).length : 0, owned = d ? d.docs.filter(x => x.locked).length : 0;
  $('#docsSub').textContent = d ? [`${d.docs.length} docs`, dirty && `${dirty} with uncommitted changes`, owned && `${owned} owned by the template`].filter(Boolean).join(' · ') : '';
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
  if (!text || !open || asking) return;
  asking = true;
  try {
    await api.note(`Change ${open.path}: ${text}`, '');
    // Only what was sent goes: more typed while it was on its way stays in the box.
    if (askText.trim() === text) askText = '';
    renderDoc();
    toast('Added to Up next', 'var(--violet)', { label: 'Workboard', run: () => go('workboard') });
    sync.refresh();
  } catch (e) { toast(`Couldn't add the note: ${e.message}`, 'var(--red)'); }
  asking = false;
}

async function push(force) {
  if (!open || saving) return;
  const d = open, k = key(d.path), text = drafts.get(k);
  if (text === undefined) return;
  saving = true;
  renderDoc();
  try {
    const r = await api.saveDoc(d.path, text, force && conflict ? conflict.hash : d.hash, messages.get(k) || '');
    if (r.conflict) { conflict = { hash: r.hash }; return; }
    // What was typed while the push was on its way isn't in it: that stays an edit, still open.
    const more = drafts.has(k) && drafts.get(k) !== text;
    if (!more) { drafts.delete(k); if (state.doc === d.path) mode = 'read'; }
    messages.delete(k);
    conflict = null;
    notice = r.pushed || r.nothing ? '' : r.note;
    const since = more ? '. What you typed since is still an edit' : '';
    if (r.nothing) toast(`Nothing to push: it matches the saved doc${since}`, 'var(--gray)');
    else if (r.pushed) toast(`Pushed ${nameOf(d.path)} to GitHub${since}`);
    else toast(`Committed ${nameOf(d.path)}, but it isn't on GitHub yet${since}`, 'var(--amber)');
    renderTree();
    await reopen();
    loadDocs();
  } catch (e) {
    toast(`Couldn't push: ${e.message}`, 'var(--red)');
  } finally {
    saving = false;
    renderDoc();
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
  initPopover('.dt-file, .doc-ref, .doc-recent', el => { const d = docOf(el.dataset.doc); return d ? summary(d) : null; });

  const filterInput = $('#docsFilter');
  filterInput.addEventListener('input', () => { filter = filterInput.value.trim(); renderTree(); });
  filterInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const first = $('#docsTree .dt-file'); if (first) openDoc(first.dataset.doc); }
    else if (e.key === 'Escape' && filter) { e.stopPropagation(); filterInput.value = filter = ''; renderTree(); }
  });

  $('#docsTree').addEventListener('click', e => {
    if (e.target.closest('[data-docs-retry]')) { loadDocs(); return; }
    const group = e.target.closest('[data-folder]');
    if (group) { toggleFolder(group.dataset.folder); return; }
    const item = e.target.closest('[data-doc]');
    if (item) openDoc(item.dataset.doc);
  });

  const box = $('#docPane');
  box.addEventListener('click', e => {
    if (e.target.closest('[data-docs-retry]')) { loadDocs(); return; }
    const ref = e.target.closest('[data-doc]');
    if (ref) {
      if (ref.tagName === 'A' && (e.ctrlKey || e.metaKey || e.shiftKey)) return; // a new tab or window
      e.preventDefault();
      openDoc(ref.dataset.doc);
      return;
    }
    const anchor = e.target.closest('[data-anchor]');
    if (anchor) { e.preventDefault(); box.querySelector(`#${CSS.escape(anchor.dataset.anchor)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const tab = e.target.closest('[data-mode]');
    if (tab) { if (!tab.disabled) setMode(tab.dataset.mode); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'push') push(false);
    else if (act === 'force') push(true);
    else if (act === 'discard') discard();
    else if (act === 'latest') loadLatest();
    else if (act === 'dismiss') { notice = ''; renderDoc(); }
    else if (act === 'reopen') openDoc(state.doc);
  });

  box.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'docAsk') { askText = el.value; fit(el); return; }
    if (!open) return;
    const k = key(open.path);
    if (el.id === 'docMsg') { messages.set(k, el.value); return; }
    if (el.id !== 'docEditor') return;
    const had = drafts.has(k);
    if (el.value === lf(open.text)) drafts.delete(k); else drafts.set(k, el.value);
    fit(el);
    // Its first change, or back to the saved text: the tree's dot, the flags and Push follow.
    if (had !== drafts.has(k)) { renderTree(); renderDoc(); }
  });

  box.addEventListener('keydown', e => {
    if (e.target.id === 'docAsk' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(); }
  });
  box.addEventListener('submit', e => { e.preventDefault(); ask(); });

  // Edits live only in this tab until they're pushed.
  addEventListener('beforeunload', e => { if (drafts.size) { e.preventDefault(); e.returnValue = ''; } });
}
