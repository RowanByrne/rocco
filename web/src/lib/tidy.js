// A terminal's habits in what an agent writes, tidied for reading (prose.js shows it): ALL-CAPS runs turn bold in
// sentence case, -- turns into a dash, and commit hashes drop out of sentences. Code (fenced or inline) stays as written.

const HASH = '(?=[0-9a-f]*\\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,12}';
const HASH_ASIDE = new RegExp(`\\s*\\((?:commit\\s+|at\\s+)?${HASH}\\)`, 'g');      // "(af8a0be)", "(commit 28cf9e9)"
const HASH_AT = new RegExp(`\\s+(?:at|as)\\s+(?:commit\\s+)?${HASH}\\b`, 'g');       // "merged to main at af8a0be"
const HASH_LEFT = new RegExp(`\\bcommit\\s+${HASH}\\b`, 'g');
// A run of capitals: two or more words, numbers like 09:54 allowed between them.
const WORD = "[A-Z][A-Z'’-]*[A-Z]|[A-Z]|\\d[\\d:.,]*\\d|\\d";
const CAPS_RUN = new RegExp(`(?<![\\w-])(?:${WORD})(?:[ ,]+(?:${WORD}))+(?![\\w-])(:?)`, 'g');
// Abbreviations that keep their capitals in a run. Any other word does only if the text writes it that way elsewhere.
const KEEP = new Set(('I AI API CI CPU CCU DAU DLC FOV FPS GDD GPU GUI HP HUD ID IDS KPI LOD MAU MCP MVP NPC OK PR PVE PVP QA RAM RNG '
  + 'ROI SFX UGC UI URL USD UX VFX VIP XP').split(' '));
// A single shouted word that opens a line: "SO:", "NOTE:".
const CAPS_LEAD = /(^|\n)([ \t]*(?:[-*]\s+|\d+[.)]\s+)?)([A-Z]{2,}):/g;

// Words that stay as they are in a run: names written in capitals elsewhere (DRIFTO's road), or with a capital (Rocco).
function namesIn(text) {
  const names = new Map();
  const outside = text.replace(CAPS_RUN, ' ');
  for (const m of outside.matchAll(/\b[A-Z][A-Za-z]+\b/g)) {
    const w = m[0], key = w.toUpperCase();
    // A capital that starts a sentence isn't a name.
    if (w === key) names.set(key, w);
    else if (!names.has(key) && /[a-z,]\s+$/.test(outside.slice(Math.max(0, m.index - 4), m.index))) names.set(key, w);
  }
  return names;
}

function sentenceCase(run, names, start) {
  let first = start;
  return run.replace(/[A-Z][A-Z'’-]*/g, w => {
    const bare = w.replace(/['’](S)$/, ''), tail = w.slice(bare.length).toLowerCase();
    let out = names.get(bare) || (KEEP.has(bare) ? bare : bare.toLowerCase());
    if (first) { out = out[0].toUpperCase() + out.slice(1); first = false; }
    return out + tail;
  });
}

function tidyProse(s, names) {
  s = s.replace(/ -- /g, ' — ').replace(/(\w)--(\s)/g, '$1 —$2');
  s = s.replace(HASH_ASIDE, '').replace(HASH_AT, '').replace(HASH_LEFT, 'a commit');
  s = s.replace(CAPS_LEAD, (all, line, mark, word) => KEEP.has(word) || names.get(word) === word ? all : `${line}${mark}**${word[0]}${word.slice(1).toLowerCase()}:**`);
  return s.replace(CAPS_RUN, (run, colon, at, all) => {
    const words = run.match(/[A-Z][A-Z'’-]*/g) || [];
    if (words.length < 2 || !words.some(w => w.length >= 3)) return run;
    const before = all.slice(0, at);
    const start = !before.trim() || /(^|\n)\s*([-*]|\d+[.)]|#+)?\s*$/.test(before) || /[.!?:]\s*$/.test(before);
    const text = sentenceCase(run.slice(0, run.length - colon.length), names, start);
    return `**${text}${colon}**`;
  });
}

export function tidy(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const names = namesIn(src);
  return src.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/).map((part, i) => i % 2 ? part : tidyProse(part, names)).join('');
}

