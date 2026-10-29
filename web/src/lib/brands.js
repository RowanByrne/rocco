// Logos for Connections: brand marks from Simple Icons (served by jsDelivr), else one of our line icons.
import { icon } from './icons.js';

const SIMPLE_ICONS = 'https://cdn.jsdelivr.net/npm/simple-icons@16.33.0/icons/';

// By connection name. Colors are each brand's own (Simple Icons' hex), or ours for tools without one.
const BRANDS = {
  'Claude Code':  { logo: 'claude', glyph: 'terminal', color: '#D97757' },
  'Codex':        { glyph: 'terminal', color: '#2a2b33' },
  'Roblox Studio':{ logo: 'robloxstudio', glyph: 'plug', color: '#00A2FF' },
  'Studio MCP':   { logo: 'modelcontextprotocol', glyph: 'plug', color: '#2a2b33' },
  'Lync':         { glyph: 'sync', color: '#6d4aff' },
  'Lync plugin':  { glyph: 'package', color: '#6d4aff' },
  'Git':          { logo: 'git', glyph: 'branch', color: '#F03C2E' },
  'GitHub CLI':   { logo: 'github', glyph: 'terminal', color: '#24262d' },
  'Template':     { glyph: 'layers', color: '#7c6cff' },
  'GitHub':       { logo: 'github', glyph: 'branch', color: '#24262d' },
  'Commit check': { glyph: 'shield', color: '#0f9f7a' },
  'Studio sync':  { glyph: 'sync', color: '#0284c7' },
};
const brandOf = item => BRANDS[item.name] || { glyph: / plugin$/.test(item.name) ? 'package' : 'plug', color: '#3b3f52' };

// size: '' (40px), 'sm' (30px) or 'lg' (52px).
export function logoHTML(item, size = '') {
  const b = brandOf(item);
  const mark = b.logo ? `<img src="${SIMPLE_ICONS}${b.logo}.svg" alt="" data-glyph="${b.glyph}">` : icon[b.glyph];
  return `<span class="brand${size ? ' ' + size : ''}" style="--brand:${b.color}">${mark}</span>`;
}

// Offline, the brand marks can't load: swap in the line icon.
export function useGlyphFallback(root) {
  root.addEventListener('error', e => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.dataset.glyph) img.outerHTML = icon[img.dataset.glyph];
  }, true);
}
