// Markdown to HTML for reading docs: the parts the repo's docs use (headings, paragraphs, lists, tables, code,
// quotes, rules, front matter). Everything is escaped; links go only to web addresses, other docs, or this doc's headings.
import { esc } from './dom.js';

// o.docRef(mention, base): the doc a mention like `WORKFLOW.md` or docs/game/GDD.md names, or ''.
// o.href(path): that doc's address in the app. o.base: the open doc's path, for relative links.
export function markdown(src, o = {}) {
  const opts = { docRef: () => '', href: path => `#docs/${encodeURI(path)}`, base: '', ...o };
  let lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  let front = '';
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) { front = `<pre class="md-front"><code>${esc(lines.slice(1, end).join('\n'))}</code></pre>`; lines = lines.slice(end + 1); }
  }
  return front + blocks(lines, opts);
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*(```+|~~~+)/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const indentOf = line => line.match(/^\s*/)[0].length;
const isTable = (lines, i) => /^\s*\|/.test(lines[i]) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '');
const startsBlock = (lines, i) => FENCE.test(lines[i]) || /^#{1,6}\s/.test(lines[i]) || /^\s*>/.test(lines[i]) || /^\s*<!--/.test(lines[i])
  || RULE.test(lines[i]) || LIST.test(lines[i]) || isTable(lines, i);
export const slug = text => 'md-' + String(text).toLowerCase().replace(/[`*_]/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

function blocks(lines, o) {
  let html = '', i = 0, m;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if ((m = line.match(FENCE))) {
      const body = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(m[1]); i++) body.push(lines[i]);
      html += `<pre><code>${esc(body.join('\n'))}</code></pre>`;
      i++;
      continue;
    }
    // Comments are notes for whoever edits the file.
    if (/^\s*<!--/.test(line)) {
      while (i < lines.length && !lines[i].includes('-->')) i++;
      i++;
      continue;
    }
    if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      const n = m[1].length;
      html += `<h${n} id="${slug(m[2])}">${inline(m[2], o)}</h${n}>`;
      i++;
      continue;
    }
    if (RULE.test(line)) { html += '<hr>'; i++; continue; }
    if (/^\s*>/.test(line)) {
      const body = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) body.push(lines[i].replace(/^\s*>\s?/, ''));
      html += `<blockquote>${blocks(body, o)}</blockquote>`;
      continue;
    }
    if (isTable(lines, i)) { html += table(lines, i, o); i = skipTable(lines, i); continue; }
    if (LIST.test(line)) { const [h, next] = list(lines, i, o); html += h; i = next; continue; }
    // A paragraph runs until a blank line or another block.
    const para = [line.trim()];
    for (i++; i < lines.length && lines[i].trim() && !startsBlock(lines, i); i++) para.push(lines[i].trim());
    html += `<p>${inline(para.join(' '), o)}</p>`;
  }
  return html;
}

// ---- Tables ----

// Cells split on | outside code; \| is a literal bar.
function cells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out = [];
  let cell = '', code = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '\\' && s[k + 1] === '|') { cell += '|'; k++; continue; }
    if (c === '`') code = !code;
    if (c === '|' && !code) { out.push(cell.trim()); cell = ''; continue; }
    cell += c;
  }
  out.push(cell.trim());
  return out;
}

function skipTable(lines, i) {
  for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++);
  return i;
}

function table(lines, i, o) {
  const head = cells(lines[i]);
  const align = cells(lines[i + 1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : '');
  const rows = [];
  for (let k = i + 2; k < lines.length && /^\s*\|/.test(lines[k]); k++) rows.push(cells(lines[k]));
  const cell = (tag, text, n) => `<${tag}${align[n] ? ` style="text-align:${align[n]}"` : ''}>${inline(text || '', o)}</${tag}>`;
  // The docs' key-value tables have an empty header row: leave it out.
  const thead = head.some(Boolean) ? `<thead><tr>${head.map((c, n) => cell('th', c, n)).join('')}</tr></thead>` : '';
  return `<div class="md-table"><table>${thead}<tbody>${rows.map(r => `<tr>${head.map((_, n) => cell('td', r[n], n)).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// ---- Lists ----

function list(lines, i, o) {
  const first = lines[i].match(LIST), indent = first[1].length, ordered = /\d/.test(first[2]);
  const items = [];
  let content = indent + first[2].length + 1;
  while (i < lines.length) {
    const line = lines[i], m = line.match(LIST);
    if (m && m[1].length === indent) {
      if (/\d/.test(m[2]) !== ordered) break;
      items.push([m[3]]);
      content = indent + m[2].length + 1;
      i++;
      continue;
    }
    if (!line.trim()) {
      // A blank line ends the list, unless what follows is still part of it.
      const next = lines[i + 1];
      if (next !== undefined && next.trim() && (indentOf(next) > indent || next.match(LIST)?.[1].length === indent)) { items[items.length - 1].push(''); i++; continue; }
      break;
    }
    if (indentOf(line) > indent) { items[items.length - 1].push(line.slice(Math.min(indentOf(line), content))); i++; continue; }
    if (!startsBlock(lines, i)) { items[items.length - 1].push(line.trim()); i++; continue; } // a line that wraps the item
    break;
  }
  const start = ordered && parseInt(first[2], 10) !== 1 ? ` start="${parseInt(first[2], 10)}"` : '';
  const tag = ordered ? 'ol' : 'ul';
  return [`<${tag}${start}>${items.map(item => `<li>${itemHTML(item, o)}</li>`).join('')}</${tag}>`, i];
}

// An item's own text stays tight (no <p>); what's nested under it renders as blocks.
function itemHTML(lines, o) {
  let k = 0;
  const text = [];
  while (k < lines.length && lines[k].trim() && !(k > 0 && startsBlock(lines, k))) text.push(lines[k++].trim());
  let own = inline(text.join(' '), o);
  const box = own.match(/^\[( |x|X)\]\s+/);
  if (box) own = `<input type="checkbox" disabled${box[1] === ' ' ? '' : ' checked'}>` + own.slice(box[0].length);
  return own + blocks(lines.slice(k), o);
}

// ---- Inline ----

const TOKEN = /(`+)([\s\S]*?[^`])\1(?!`)|(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<(https?:\/\/[^\s>]+)>/g;

function inline(src, o) {
  let out = '', last = 0;
  for (const m of src.matchAll(TOKEN)) {
    out += prose(src.slice(last, m.index), o);
    if (m[1]) out += code(m[2].replace(/^ (.+) $/, '$1'), o);
    else if (m[6]) out += `<a href="${esc(m[6])}" target="_blank" rel="noreferrer">${esc(m[6])}</a>`;
    else out += link(m[4], m[5], !!m[3], o);
    last = m.index + m[0].length;
  }
  return out + prose(src.slice(last), o);
}

const docLink = (path, inner, o) => `<a class="doc-ref" href="${esc(o.href(path))}" data-doc="${esc(path)}">${inner}</a>`;

function code(text, o) {
  const path = /\.md\b/i.test(text) ? o.docRef(text, o.base) : '';
  return path ? docLink(path, `<code>${esc(text)}</code>`, o) : `<code>${esc(text)}</code>`;
}

// A path relative to the open doc's folder.
function resolve(base, rel) {
  const parts = base.split('/').slice(0, -1);
  for (const p of rel.split('/')) { if (p === '..') parts.pop(); else if (p && p !== '.') parts.push(p); }
  return parts.join('/');
}

function link(label, url, image, o) {
  const text = prose(label, o, false);
  if (image) return `<span class="md-img" title="${esc(url)}">${text || 'image'}</span>`;
  if (/^(https?:|mailto:)/i.test(url)) return `<a href="${esc(url)}" target="_blank" rel="noreferrer">${text}</a>`;
  if (url.startsWith('#')) return `<a href="#" data-anchor="${esc(slug(decodeURIComponent(url.slice(1)).replace(/-/g, ' ')))}">${text}</a>`;
  const target = decodeURIComponent(url.split('#')[0]);
  const path = /\.md$/i.test(target) ? o.docRef(resolve(o.base, target), o.base) || o.docRef(target, o.base) : '';
  return path ? docLink(path, text, o) : `<span class="md-link" title="${esc(url)}">${text}</span>`;
}

// mentions: false inside a link's own text, where another link can't go.
function prose(s, o, mentions = true) {
  let h = esc(s)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*]*?[^\s*])\*(?![\w*])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  if (!mentions) return h;
  // A mention of another doc, like WORKFLOW.md or docs/game/GDD.md, opens it.
  h = h.replace(/(^|[^\w/\\.-])((?:[\w.-]+[\\/])*[\w-]+\.md)(?![\w])/g, (all, pre, ref) => {
    const path = o.docRef(ref, o.base);
    return path ? pre + docLink(path, ref, o) : all;
  });
  return h;
}
