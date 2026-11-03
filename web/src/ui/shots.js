// Screenshots going with something the user sends: a note from the note box, or a task sent back from its sheet.
// Pasted, dropped or picked, they show as thumbnails to draw on (dialogs/markup.js) or remove.
import { openMarkup } from '../dialogs/markup.js';

const pen = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4-1 11-11-3-3L5 16z"/></svg>';
export const clip = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11.5l-8.4 8.4a5 5 0 0 1-7.1-7.1l8.8-8.8a3.3 3.3 0 0 1 4.7 4.7l-8.8 8.8a1.7 1.7 0 0 1-2.4-2.4l8.1-8.1"/></svg>';

// A file as a screenshot to send, or null when it isn't an image.
export const shotOf = file => file?.type?.startsWith('image/') ? { file, url: URL.createObjectURL(file) } : null;

// The images in a paste (clipboardData.items) or a drop (dataTransfer.files).
export const imagesIn = items => [...(items || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile ? i.getAsFile() : i);

export const shotsHTML = list => list.map((d, i) => `<span class="th" title="Draw on it"><img src="${d.url}" alt="Attached screenshot" data-draw="${i}">`
  + `<span class="th-draw">${pen}</span><button type="button" data-unshot="${i}" aria-label="Remove screenshot">×</button></span>`).join('');

// A click in the thumbnails: remove one, or draw on it. Returns true when the list changed.
export async function shotClick(el, list) {
  if (el.dataset.unshot !== undefined) { list.splice(+el.dataset.unshot, 1); return true; }
  if (el.dataset.draw !== undefined) {
    const i = +el.dataset.draw, drawn = await openMarkup(list[i].file);
    if (drawn) { list[i] = shotOf(drawn); return true; }
  }
  return false;
}
