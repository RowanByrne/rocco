// Logos for Connections: brand marks from Simple Icons, kept in assets/brands (simple-icons 16.33.0, CC0-1.0; each
// mark belongs to its brand), else one of our line icons.
import { html } from './html.js';
import { icon } from './icons.js';

const MARKS = 'assets/brands/';

// By connection name. Colors are each brand's own (Simple Icons' hex), or ours for tools without one.
const BRANDS = {
  'Claude Code':  { logo: 'claude', glyph: 'terminal', color: '#D97757' },
  'Codex':        { glyph: 'terminal', color: '#2a2b33' },
  'Gemini CLI':   { logo: 'googlegemini', glyph: 'terminal', color: '#8E75B2' },
  'ElevenLabs':   { logo: 'elevenlabs', glyph: 'speaker', color: '#24262d' },
  'Roblox Studio':{ logo: 'robloxstudio', glyph: 'plug', color: '#00A2FF' },
  'Roblox Open Cloud': { logo: 'roblox', glyph: 'plug', color: '#2a2b33' },
  'Studio MCP':   { logo: 'modelcontextprotocol', glyph: 'plug', color: '#2a2b33' },
  'Rocco':        { img: 'assets/rocco.svg', glyph: 'sparkle', color: '#2a2b33' },
  'Lync':         { glyph: 'sync', color: '#6d4aff' },
  'Lync plugin':  { glyph: 'package', color: '#6d4aff' },
  'Git':          { logo: 'git', glyph: 'branch', color: '#F03C2E' },
  'GitHub CLI':   { logo: 'github', glyph: 'terminal', color: '#24262d' },
  'Template':     { glyph: 'layers', color: '#7c6cff' },
  'GitHub':       { logo: 'github', glyph: 'branch', color: '#24262d' },
  'Commit check': { glyph: 'shield', color: '#0f9f7a' },
  'Studio sync':  { glyph: 'sync', color: '#0284c7' },
  'TopbarPlus':   { glyph: 'layers', color: '#0f766e' },
  'Cmdr':         { glyph: 'terminal', color: '#334155' },
};
const brandOf = item => BRANDS[item.name] || { glyph: / plugin$/.test(item.name) || item.group === 'Libraries' ? 'package' : 'plug', color: '#3b3f52' };

// size: '' (40px), 'sm' (30px) or 'lg' (52px).
export function logo(item, size = '') {
  const b = brandOf(item);
  // Our own logo keeps its colors and fills the tile; brand marks are drawn white on the brand's color.
  const mark = b.img ? html`<img class="own" src=${b.img} alt="">` : b.logo ? html`<img src="${MARKS}${b.logo}.svg" alt="">` : icon[b.glyph];
  return html`<span class="brand${size ? ` ${size}` : ''}" style="--brand:${b.color}">${mark}</span>`;
}
