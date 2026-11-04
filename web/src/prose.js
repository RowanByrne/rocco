// What agents write, for reading in Rocco: Markdown (lib/markdown.js), with a terminal's habits tidied as it's shown.
// The text itself stays as written. ALL-CAPS lead-ins turn bold in sentence case, -- turns into a dash, commit hashes
// drop out of sentences, a task id shows as the task's name and opens it, and a doc's path opens the doc.
import { state, byId, emit } from './state.js';
import { esc } from './lib/dom.js';
import { markdown } from './lib/markdown.js';
import { docUrl } from './router.js';
import { docRef } from './views/docs.js';
import { tidy } from './lib/tidy.js';

const taskChip = id => {
  const t = byId(id);
  return t ? `<a href="#" class="task-ref" data-task-ref="${esc(id)}" title="${esc(id)}">${esc(t.title)}</a>` : '';
};
const opts = { docRef: (text, base) => state.docs ? docRef(text, base) : '', href: docUrl, task: taskChip, breaks: true };

// A message, an answer, a summary: blocks of Markdown.
export const prose = text => `<div class="prose">${markdown(tidy(text), opts)}</div>`;

// One line of it (a step to try, a question): bold, code and links, with no blocks.
export const proseLine = text => markdown(tidy(text).replace(/\n+/g, ' '), opts).replace(/^<p>([\s\S]*)<\/p>$/, '$1');

// Text for a spot that shows one plain line, like a card's face: the Markdown marks taken out.
export const plainLine = text => tidy(text).replace(/\*\*|__|`/g, '').replace(/^#+\s*/gm, '').replace(/\s*\n+\s*/g, ' ').trim();

// A task's name opens its card, wherever it's shown.
export function initProse() {
  document.addEventListener('click', e => {
    const ref = e.target.closest('[data-task-ref]');
    if (!ref) return;
    e.preventDefault();
    e.stopPropagation();
    emit('open-task', ref.dataset.taskRef);
  }, true);
}
