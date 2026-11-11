// What agents write, for reading in Rocco: Markdown (lib/markdown.js), with a terminal's habits tidied as it's shown.
// The text itself stays as written. ALL-CAPS lead-ins turn bold in sentence case, -- turns into a dash, commit hashes
// drop out of sentences, a task id shows as the task's name and opens it, and a doc's path opens the doc. Where the
// tidying changed anything, "Show original" under it shows the text as the agent wrote it.
import { state, byId, emit } from './state.js';
import { esc } from './lib/dom.js';
import { html, nothing, unsafeHTML } from './lib/html.js';
import { markdown } from './lib/markdown.js';
import { docUrl } from './router.js';
import { docRef } from './views/docs.js';
import { tidy } from './lib/tidy.js';

// Markdown's own output is a string it has escaped (lib/markdown.js), so the chip is too.
const taskChip = id => {
  const t = byId(id);
  return t ? `<a href="#" class="task-ref" data-task-ref="${esc(id)}" title="${esc(id)}">${esc(t.title)}</a>` : '';
};
const opts = { docRef: (text, base) => state.docs ? docRef(text, base) : '', href: docUrl, task: taskChip, breaks: true };

// Texts the user asked to see as written, each by a short key of its own text.
const asWritten = new Set();
const keyOf = text => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${text.length}.${h.toString(36)}`;
};

// The text to show, and whether tidying changed it.
function read(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n'), tidied = tidy(src);
  const changed = tidied !== src, key = changed ? keyOf(src) : '', original = changed && asWritten.has(key);
  return { shown: original ? src : tidied, changed, key, original };
}

const toggle = r => r.changed ? html`<button type="button" class="linkish prose-raw" data-prose-raw=${r.key} title=${r.original ? 'Back to the tidied text' : 'See it as its agent wrote it'}>${r.original ? 'Show tidied' : 'Show original'}</button>` : nothing;

// A message, an answer, a summary: blocks of Markdown.
export function prose(text) {
  const r = read(text);
  return html`<div class="prose">${unsafeHTML(markdown(r.shown, opts))}${toggle(r)}</div>`;
}

// One line of it (a step to try, a question): bold, code and links, with no blocks.
export function proseLine(text) {
  const r = read(text);
  return html`${unsafeHTML(markdown(r.shown.replace(/\n+/g, ' '), opts).replace(/^<p>([\s\S]*)<\/p>$/, '$1'))}${toggle(r)}`;
}

// A task's name opens its card, wherever it's shown; "Show original" switches the text it's under.
export function initProse() {
  document.addEventListener('click', /** @param {MouseEvent & { target: any }} e */ e => {
    const ref = e.target.closest('[data-task-ref]'), raw = e.target.closest('[data-prose-raw]');
    if (!ref && !raw) return;
    e.preventDefault();
    e.stopPropagation();
    if (ref) { emit('open-task', ref.dataset.taskRef); return; }
    const key = raw.dataset.proseRaw;
    if (asWritten.has(key)) asWritten.delete(key); else asWritten.add(key);
    emit('prose'); // every view that shows agents' text draws it again
  }, true);
}
