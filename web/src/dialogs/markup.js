// Draw on a screenshot before it's sent: pen, arrow and box, in a few colors. Saves a new PNG at full size.
import { $, esc } from '../lib/dom.js';

const modal = $('#markupModal');
const view = $('#markupCanvas');
const TOOLS = [['pen', 'Pen', '<path d="M4 20l4-1 11-11-3-3L5 16z"/>'], ['arrow', 'Arrow', '<path d="M5 19L19 5"/><path d="M10 5h9v9"/>'], ['box', 'Box', '<rect x="4" y="5" width="16" height="14" rx="2"/>']];
const COLORS = ['#ff4d4f', '#fbbf24', '#ffffff'];

let image = null, strokes = [], current = null, tool = 'pen', color = COLORS[0], resolveOpen = null;

export const markupOpen = () => modal.classList.contains('open');

function toolbarHTML() {
  const icon = paths => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return TOOLS.map(([id, label, paths]) => `<button class="tool${tool === id ? ' on' : ''}" data-tool="${id}" title="${label}" aria-label="${label}">${icon(paths)}</button>`).join('')
    + '<span class="tool-sep"></span>'
    + COLORS.map(c => `<button class="swatch${color === c ? ' on' : ''}" data-color="${c}" style="--sw:${c}" aria-label="Color ${esc(c)}"></button>`).join('')
    + '<span class="tool-sep"></span>'
    + `<button class="tool" data-undo title="Undo" aria-label="Undo">${icon('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>')}</button>`
    + `<button class="tool" data-clear title="Clear" aria-label="Clear">${icon('<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>')}</button>`;
}

const width = () => Math.max(3, Math.round(Math.min(image.width, image.height) / 160));

function drawStroke(ctx, s) {
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (s.tool === 'pen') {
    s.points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  } else {
    const [[x1, y1], [x2, y2]] = [s.points[0], s.points[s.points.length - 1]];
    if (s.tool === 'box') ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    else {
      const a = Math.atan2(y2 - y1, x2 - x1), head = s.width * 5;
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.moveTo(x2, y2); ctx.lineTo(x2 - head * Math.cos(a - .5), y2 - head * Math.sin(a - .5));
      ctx.moveTo(x2, y2); ctx.lineTo(x2 - head * Math.cos(a + .5), y2 - head * Math.sin(a + .5));
    }
  }
  ctx.stroke();
}

// The view shows the image scaled down; strokes are kept in the image's own pixels.
function redraw() {
  const ctx = view.getContext('2d');
  const scale = view.width / image.width;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(image, 0, 0, view.width, view.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  [...strokes, current].filter(Boolean).forEach(s => drawStroke(ctx, s));
}

function point(e) {
  const r = view.getBoundingClientRect();
  return [(e.clientX - r.left) * image.width / r.width, (e.clientY - r.top) * image.height / r.height];
}

// Opens the editor on an image file; resolves with the drawn-on file, or null if cancelled.
export function openMarkup(file) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      image = img;
      strokes = [];
      current = null;
      const fit = Math.min(1, Math.min(innerWidth * .86, 1100) / img.width, innerHeight * .62 / img.height);
      view.width = Math.round(img.width * fit);
      view.height = Math.round(img.height * fit);
      $('#markupTools').innerHTML = toolbarHTML();
      redraw();
      resolveOpen = resolve;
      modal.classList.add('open');
    };
    img.src = URL.createObjectURL(file);
  });
}

function close(result) {
  modal.classList.remove('open');
  const done = resolveOpen;
  resolveOpen = null;
  done?.(result);
}

async function save() {
  if (!strokes.length) { close(null); return; }
  const out = document.createElement('canvas');
  out.width = image.width;
  out.height = image.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(image, 0, 0);
  strokes.forEach(s => drawStroke(ctx, s));
  const blob = await new Promise(r => out.toBlob(r, 'image/png'));
  close(new File([blob], 'marked-up.png', { type: 'image/png' }));
}

export const closeMarkup = () => close(null);

view.addEventListener('pointerdown', e => {
  view.setPointerCapture(e.pointerId);
  current = { tool, color, width: width(), points: [point(e)] };
});
view.addEventListener('pointermove', e => {
  if (!current) return;
  if (current.tool === 'pen') current.points.push(point(e)); else current.points[1] = point(e);
  redraw();
});
view.addEventListener('pointerup', () => {
  if (current && current.points.length > 1) strokes.push(current);
  current = null;
  redraw();
});
modal.addEventListener('click', e => {
  const el = e.target.closest('button');
  if (e.target === modal) { close(null); return; }
  if (!el) return;
  if (el.dataset.tool) tool = el.dataset.tool;
  else if (el.dataset.color) color = el.dataset.color;
  else if (el.hasAttribute('data-undo')) strokes.pop();
  else if (el.hasAttribute('data-clear')) strokes = [];
  else if (el.dataset.markup === 'save') { save(); return; }
  else if (el.dataset.markup === 'cancel') { close(null); return; }
  $('#markupTools').innerHTML = toolbarHTML();
  redraw();
});
