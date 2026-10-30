// Sample data for working on the design without real tasks: open http://localhost:34860/?demo.
// It answers the same calls as the server, and its actions mirror rocco/server/tasks.ps1 Invoke-TaskAction.
import { state } from './state.js';

const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const picture = h => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'>
  <rect width='320' height='180' fill='hsl(${h},42%,62%)'/><rect y='128' width='320' height='52' fill='hsl(${h + 90},28%,36%)'/>
  <rect x='38' y='84' width='48' height='44' rx='4' fill='hsl(${h + 20},26%,30%)'/><rect x='208' y='66' width='66' height='62' rx='4' fill='hsl(${h + 40},20%,27%)'/>
  <circle cx='150' cy='114' r='12' fill='hsl(${h + 180},45%,50%)'/></svg>`);

// A short whoosh for the sample audio options: noise through a sweeping filter, as a WAV data address.
function sound(seed, ms = 420) {
  const rate = 22050, n = Math.floor(rate * ms / 1000);
  const bytes = new Uint8Array(44 + n * 2), v = new DataView(bytes.buffer);
  const text = (at, s) => [...s].forEach((c, i) => { bytes[at + i] = c.charCodeAt(0); });
  text(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); text(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, n * 2, true);
  let random = seed * 9301 + 49297, low = 0;
  for (let i = 0; i < n; i++) {
    random = (random * 9301 + 49297) % 233280;
    const p = i / n, shape = Math.sin(Math.PI * Math.pow(p, 0.6 + seed * 0.25));
    low += (0.02 + 0.25 * seed * shape) * ((random / 233280) * 2 - 1 - low);
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, low * shape * 3)) * 32767 * 0.8, true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return 'data:audio/wav;base64,' + btoa(binary);
}

const PROJECTS = [
  { id: 'sample-game', name: 'Sample Game', phase: 'Production' },
  { id: 'sky-farm', name: 'Sky Farm', phase: 'Core loop' },
  { id: 'template', name: 'RoDev template', phase: 'Template', template: true },
];

function seed(id) {
  const base = { attempt: 1, where: 'main', options: [], shots: [], log: [], pending: '' };
  if (id !== 'sample-game') return { id, tasks: [], lanes: { count: 4, open: [], main: false }, main: { at: ago(600), subject: 'Start from the template' } };
  return {
    id,
    lanes: { count: 8, open: [1, 2, 3, 4, 5, 6, 7], main: true },
    main: { at: ago(4), subject: 'Merge agent/daily-reward' },
    tasks: [
      { ...base, id: 'T-038', status: 'ready', type: 'bug', lane: 2, attempt: 2, title: 'Daily reward claimable twice after rejoin', shots: [picture(200)],
        note: 'daily reward lets me claim twice if i leave and rejoin quick', summary: 'The claim saves before the reward is given now.',
        test: 'Claim, leave, rejoin within 5 s. It should show the countdown.', branch: 'agent/daily-reward',
        log: [{ who: 'conductor', at: ago(59), text: 'Lane 2.' }, { who: 'worker', at: ago(42), text: 'Saves on claim instead of on autosave.' },
          { who: 'you', at: ago(21), text: 'Still happens if I rejoin really fast.' },
          { who: 'worker', at: ago(6), text: 'Save lands before the reward, and loading waits for the session lock. 20 fast rejoins: no double claims.' },
          { who: 'conductor', at: ago(4), text: 'Merged.' }] },
      { ...base, id: 'T-041', status: 'ready', type: 'tweak', lane: 4, title: 'Shop prices wrap on phone', shots: [picture(30)], note: 'shop prices wrap to 2 lines on phone',
        summary: 'Prices shrink to fit on phone.', test: 'Open the shop at phone size. Prices stay on one line.', branch: 'agent/shop-price-fit',
        log: [{ who: 'conductor', at: ago(31), text: 'Lane 4.' }, { who: 'worker', at: ago(17), text: 'Labels shrink to fit. Checked phone, tablet, desktop.' }, { who: 'conductor', at: ago(5), text: 'Merged.' }] },
      { ...base, id: 'T-044', status: 'ready', type: 'feature', feature: true, where: 'lane', lane: 5, attempt: 3, branch: 'feature/pet-follow', title: 'Pets follow the player',
        note: 'pets should follow you around, not just sit at spawn', summary: 'Pets follow, and teleport to you if they fall 40+ studs behind.', test: 'Equip a pet, run, jump off the tower.',
        log: [{ who: 'conductor', at: ago(170), text: 'Feature branch, lane 5.' }, { who: 'you', at: ago(100), text: 'They lag way behind when I run.' },
          { who: 'you', at: ago(46), text: 'They get stuck when I jump off the tower.' }, { who: 'worker', at: ago(9), text: 'Teleport when 40+ studs behind. Always catches up within 1 s.' }] },

      // Trading: an approved feature plan, built as three tasks on its own branch.
      { ...base, id: 'T-040', status: 'queued', pending: '', kind: 'plan', type: 'feature', where: 'lane', lane: 6, branch: 'feature/trading', title: 'Trading between players',
        note: 'players should be able to trade items', summary: 'Two players swap items through a trade window, with a countdown before it goes through.',
        steps: [{ title: 'Trade requests', lane: 6, tier: 'standard' }, { title: 'Trade window and the confirm countdown', lane: 6, tier: 'heavy' }, { title: 'Trade history', lane: 6, tier: 'light' }],
        log: [{ who: 'conductor', at: ago(130), text: 'Plan: three tasks on feature/trading.' }, { who: 'you', at: ago(124), text: 'Approved the plan.' }] },
      { ...base, id: 'T-042', status: 'done', type: 'feature', plan: 'T-040', where: 'lane', lane: 6, doneAt: ago(80), title: 'Trade requests', summary: 'Players can send and accept trade requests.' },
      { ...base, id: 'T-045', status: 'stuck', type: 'feature', plan: 'T-040', where: 'lane', lane: 6, branch: 'feature/trading', title: 'Trade window and the confirm countdown',
        note: 'players should be able to trade items', summary: 'Trading works. Two rules to decide.',
        questions: [
          { text: 'Someone opens the shop mid-trade. What happens?', options: [{ label: 'Cancel the trade' }, { label: 'Lock the shop' }] },
          { text: 'How long is the confirm countdown?', options: [{ label: '3 seconds' }, { label: '5 seconds' }, { label: '10 seconds' }] },
        ],
        log: [{ who: 'worker', at: ago(12), text: 'Needs two rules: the shop mid-trade, and the countdown length.' }] },
      { ...base, id: 'T-055', status: 'queued', type: 'feature', kind: 'task', plan: 'T-040', after: ['T-045'], order: 3, title: 'Trade history', waiting: 'After T-045' },

      { ...base, id: 'T-043', status: 'stuck', type: 'bug', lane: 7, title: 'Sword swing has no sound', note: 'no sound when i swing the sword',
        summary: 'The old sound was deleted from the store. Found three replacements.',
        questions: [
          { text: 'Pick a new swing sound.', options: [{ label: 'Short whoosh', audio: sound(1) }, { label: 'Blade swing', audio: sound(2) }, { label: 'Air cut', audio: sound(3, 300) }] },
          { text: 'Play it on every swing, or only when it hits?', options: [{ label: 'Every swing' }, { label: 'Only on hits' }] },
        ],
        log: [{ who: 'worker', at: ago(20), text: 'Sound asset deleted. Found 3 replacements.' }] },
      { ...base, id: 'T-046', status: 'working', type: 'bug', lane: 3, startedAt: ago(12), step: 'Testing 6 hallway spots', progress: 70, title: 'Camera clips into walls',
        note: 'camera goes inside the walls in the hallway by the shop', shots: [picture(260), picture(280)], branch: 'agent/camera-clip',
        log: [{ who: 'conductor', at: ago(12), text: 'Lane 3.' }, { who: 'worker', at: ago(10), text: 'Found it: the camera only checks walls behind the head.' },
          { who: 'worker', at: ago(6), text: 'Raycast from the head to the camera.' }, { who: 'worker', at: ago(3), text: 'Camera pulls in on wall hits.' }] },
      { ...base, id: 'T-047', status: 'working', type: 'bug', lane: 1, startedAt: ago(6), step: 'Coding', title: 'New players show 0 coins on leaderboard',
        note: 'my alt shows 0 coins on the leaderboard till it rejoins', followups: 1, pending: 'followup', branch: 'agent/leaderboard-zero',
        log: [{ who: 'conductor', at: ago(6), text: 'Lane 1.' }, { who: 'worker', at: ago(5), text: 'Leaderstats are made before the data loads.' },
          { who: 'you', at: ago(2), text: 'Gems do the same thing, check those too.' }] },
      { ...base, id: 'T-048', status: 'queued', type: 'tweak', kind: 'note', order: 1, after: ['T-047'], title: 'Sort leaderboard by level', note: 'leaderboard should sort by level', waiting: 'After T-047 (same file)' },
      { ...base, id: 'T-049', status: 'queued', type: 'tweak', kind: 'task', order: 2, after: ['T-043'], title: 'Coin pickup sound too loud', note: 'coin pickup sound is way too loud', waiting: 'After T-043 (same file)' },
      { ...base, id: 'T-050', status: 'queued', type: 'bug', kind: 'note', order: 4, pending: 'plan', waiting: 'Waiting for the conductor', title: "NPC dialog runs off the bubble when it's long", note: "npc dialog runs off the bubble when it's long", shots: [picture(120)] },
      { ...base, id: 'T-051', status: 'queued', type: 'bug', kind: 'note', order: 5, pending: 'plan', waiting: 'Waiting for the conductor', title: 'FPS drops near the spawn fountain', note: 'fps drops near the spawn fountain' },
      { ...base, id: 'T-052', status: 'inbox', type: 'tweak', kind: 'suggestion', title: 'Shop button overlaps the health bar on small phones', note: 'Shop button overlaps the health bar on small phones',
        summary: 'Spotted while fixing the shop prices (T-041).' },
      { ...base, id: 'T-053', status: 'inbox', type: 'idea', kind: 'suggestion', title: 'Daily reward claims have no analytics event', note: 'Daily reward claims have no analytics event',
        summary: "Spotted while fixing T-038: claims aren't logged, so the dashboard can't count them." },

      // Questions the user asked from the note box: one answered, one waiting.
      { ...base, id: 'T-057', status: 'ready', kind: 'question', type: 'question', title: 'Do pets save if I leave mid-trade?', note: 'Do pets save if I leave mid-trade?',
        summary: "Yes. A trade only goes through after both players confirm and the countdown ends, so leaving before that keeps everything you had. If you leave during the countdown, the trade is cancelled and nothing moves.",
        log: [{ who: 'you', at: ago(8), text: 'Do pets save if I leave mid-trade?' }, { who: 'conductor', at: ago(2), text: 'Yes. A trade only goes through after both players confirm.' }] },
      { ...base, id: 'T-058', status: 'queued', kind: 'question', type: 'question', pending: 'question', waiting: 'Waiting for the conductor',
        title: 'How many lanes are free right now?', note: 'How many lanes are free right now?' },

      // A feature plan waiting for the user's go-ahead.
      { ...base, id: 'T-056', status: 'inbox', kind: 'plan', type: 'feature', title: 'Pet evolution', note: 'pets should level up and evolve after a while',
        summary: 'Pets earn XP while equipped and evolve at level 10 and 25, with a new look each time.',
        steps: [{ title: 'Pet XP and levels, saved with the pet', lane: 2, tier: 'heavy' }, { title: 'Evolve at 10 and 25, with the new models', lane: 4, tier: 'standard' },
          { title: 'Level bar and evolve effect in the pet menu', lane: 7, tier: 'standard' }],
        log: [{ who: 'conductor', at: ago(3), text: 'Plan ready: three tasks, on a feature branch.' }] },

      { ...base, id: 'T-035', status: 'done', type: 'bug', doneAt: ago(80), title: 'Spawn faces a wall', note: 'you spawn facing a wall', summary: 'Spawn faces the plaza now.' },
      { ...base, id: 'T-036', status: 'done', type: 'bug', doneAt: ago(65), title: "Music toggle doesn't save", note: "music toggle doesn't save", summary: 'Saved with player data now.' },
      { ...base, id: 'T-037', status: 'done', type: 'tweak', doneAt: ago(50), title: 'Tutorial arrow points at old shop', note: 'tutorial arrow points at the old shop spot', summary: 'Arrow finds the shop by tag.' },
    ],
  };
}

const data = {};
const current = () => (data[state.project] ??= seed(state.project));
const find = id => current().tasks.find(t => t.id === id);
const nextOrder = () => Math.max(0, ...current().tasks.filter(t => t.status === 'queued').map(t => t.order || 0)) + 1;
let next = 100;
const bookmarks = new Set();

export async function projects() { return { home: 'sample-game', projects: PROJECTS }; }

export async function snapshot() {
  const d = current();
  return JSON.stringify({ project: PROJECTS.find(p => p.id === state.project), lanes: d.lanes, main: d.main, tasks: d.tasks.filter(t => t.status !== 'removed') });
}

export async function me() {
  return { name: 'Sample User', login: 'sample-user', email: 'you@example.com', claude: 'you@example.com', pc: 'THIS-PC', avatar: '' };
}

export async function connections() {
  return { checking: false, checkedAt: ago(3), online: true, items: [
    { group: 'Project', name: 'Template', status: 'update', detail: '3 new template commits (as of the last fetch).', update: 'Say "update from template" to the conductor.' },
    { group: 'Project', name: 'GitHub', status: 'ok', detail: 'you/sample-game' },
    { group: 'Project', name: 'Commit check', status: 'ok', detail: 'Refuses files over 5 MB.' },
    { group: 'Project', name: 'Studio sync', status: 'ok', detail: 'Lync is serving Main and 7 lanes.' },
    { group: 'Libraries', name: 'TopbarPlus', status: 'ok', version: 'v3.5.0', latest: 'v3.5.0', detail: 'github.com/1ForeverHD/TopbarPlus · no local patches' },
    { group: 'Libraries', name: 'Cmdr', status: 'update', version: 'v1.9.0', latest: 'v1.13.1', detail: 'github.com/evaera/Cmdr · local patches: admin check reads Config',
      update: 'Ask the conductor to update it: vendor the new release, re-apply any local patches, and update ARCHITECTURE.md (CODING.md "Third-party code").' },
    { group: 'AI', name: 'Claude Code', status: 'ok', version: '2.1.312', latest: '2.1.312', detail: 'Signed in as you@example.com' },
    { group: 'AI', name: 'Codex', status: 'update', version: '0.165.0', latest: '0.166.0', detail: 'Signed in · makes images', update: 'It updates with the Codex app: restart the app.' },
    { group: 'Roblox', name: 'Roblox Studio', status: 'ok', version: '0.745.0', latest: '0.745.0', detail: '8 open' },
    { group: 'Roblox', name: 'Studio MCP', status: 'ok', detail: 'Registered as Roblox_Studio' },
    { group: 'Roblox', name: 'Lync', status: 'ok', version: 'Alpha 30', latest: '0.30.14', detail: "In the RoDev folder's _tools\\lync" },
    { group: 'Roblox', name: 'Lync plugin', status: 'ok', detail: 'Lync installs and updates it.' },
    { group: 'Tools', name: 'Git', status: 'update', version: '2.55.0', latest: '2.56.0', detail: 'Git for Windows', update: 'Update it:', command: 'git update-git-for-windows' },
    { group: 'Tools', name: 'GitHub CLI', status: 'off', detail: 'Optional, not installed.', update: 'Install it if you want Claude to handle GitHub for you:', command: 'winget install GitHub.cli' },
    elevenLabs(),
  ] };
}

// ElevenLabs starts unlinked; any key links, on the Starter plan.
let eleven = null;
const elevenLabs = () => ({
  group: 'AI', name: 'ElevenLabs', link: 'elevenlabs', linked: !!eleven, hint: eleven || '',
  ...(eleven ? { status: 'ok', detail: 'Linked · Starter plan · 4,200 of 30,000 credits used' }
    : { status: 'off', detail: "Not linked: sound effects and music can't be generated on this PC.", update: 'Link your ElevenLabs account in its details, to make sound effects and music (AUDIO-PIPELINE.md).' }),
});
export async function link(service, key) {
  if (!key.trim()) throw new Error("That doesn't look like an ElevenLabs API key.");
  eleven = key.trim().slice(-4);
  return { tier: 'starter' };
}
export async function unlink() { eleven = null; return { ok: true }; }

export async function note(text, type) {
  const title = (text || 'Screenshot').split('\n')[0], question = type === 'question';
  const t = { id: `T-${next++}`, kind: question ? 'question' : 'note', type: type || '', attempt: 1, where: 'main', title, note: text, shots: [], options: [], log: [] };
  current().tasks.push(toConductor(t, question ? 'question' : 'plan'));
  if (question) answerSoon(t);
  return { id: t.id };
}

// The demo's conductor answers questions after a few seconds.
function answerSoon(t) {
  setTimeout(() => {
    if (t.status !== 'queued') return;
    const reply = 'This is the demo, so here is a stand-in answer. In a real project the conductor answers with rocco reply, and it shows here.';
    Object.assign(t, { status: 'ready', pending: '', waiting: '', summary: reply });
    t.log.push({ who: 'conductor', at: new Date().toISOString(), text: reply });
  }, 5000);
}

export async function shot(id, file) {
  find(id).shots.push(URL.createObjectURL(file));
  return {};
}

const toConductor = (t, pending) => {
  if (t.status !== 'queued') t.order = nextOrder();
  return Object.assign(t, { status: 'queued', pending, waiting: 'Waiting for the conductor' });
};
const saveUndo = t => { t.undo = { status: t.status, pending: t.pending, waiting: t.waiting, doneAt: t.doneAt, order: t.order, logCount: t.log.length }; };

export async function act(id, action, text) {
  const t = find(id), now = new Date().toISOString();
  const say = words => t.log.push({ who: 'you', at: now, text: words });
  switch (action) {
    case 'approve': saveUndo(t); Object.assign(t, { status: 'done', doneAt: now }); say(t.kind === 'question' ? 'Got it.' : 'Approved.'); if (t.where === 'lane') t.pending = 'merge'; break;
    case 'reopen':
      t.attempt += 1;
      toConductor(t, t.kind === 'question' ? 'question' : 'reopen');
      say(text || 'Not right yet.');
      if (t.kind === 'question') answerSoon(t);
      break;
    case 'answer': toConductor(t, 'answer'); say(text); break;
    case 'queue': saveUndo(t); toConductor(t, 'plan'); say('Queued.'); break;
    case 'remove': saveUndo(t); t.status = 'removed'; break;
    case 'followup': if (!text) throw new Error('A follow-up needs some text.'); say(text); t.followups = (t.followups || 0) + 1; t.pending ||= 'followup'; break;
    case 'undo': {
      const u = t.undo;
      if (!u) throw new Error('Nothing to undo.');
      Object.assign(t, { status: u.status, pending: u.pending, waiting: u.waiting, doneAt: u.doneAt, order: u.order, undo: null });
      t.log.length = u.logCount;
      break;
    }
    case 'approve-plan': Object.assign(t, { status: 'queued', pending: 'approved', waiting: 'Waiting for the conductor' }); say('Approved the plan.'); break;
    case 'revise': if (!text) throw new Error('Say what to change.'); t.pending = 'revise'; say(text); break;
    default: throw new Error(`Unknown action '${action}'.`);
  }
  return { ok: true };
}

export async function send() {
  const inbox = current().tasks.filter(t => t.status === 'inbox' && t.kind !== 'plan');
  inbox.forEach(t => toConductor(t, 'plan'));
  return { sent: inbox.length };
}

// The same check as the server's Set-QueueOrder: nothing goes before a task it waits on.
export async function order(ids) {
  const at = new Map(ids.map((id, i) => [id, i]));
  for (const id of ids) for (const dep of find(id)?.after || []) {
    if (at.has(dep) && at.get(dep) > at.get(id)) throw new Error(`${id} has to come after ${dep}: it needs that done first.`);
  }
  ids.forEach((id, i) => { find(id).order = i + 1; });
  return { ok: true };
}

export async function changes(id) {
  const t = find(id);
  if (!t?.branch) return { source: '', url: '', files: [] };
  const files = {
    'agent/daily-reward': [['src/server/Services/RewardService.luau', 38, 12], ['src/server/Services/DataService.luau', 9, 3], ['docs/game/CONTRACTS.md', 4, 1]],
    'agent/shop-price-fit': [['src/client/UI/Shop/ItemCard.luau', 14, 6]],
    'feature/pet-follow': [['src/client/Pets/Follow.luau', 112, 0], ['src/server/Services/PetService.luau', 41, 8], ['src/shared/Config/Pets.luau', 6, 0], ['docs/game/features/pets.md', 22, 3]],
    'agent/camera-clip': [['src/client/Camera/Occlusion.luau', 57, 4]],
  }[t.branch] || [['src/server/Services/TradeService.luau', 140, 0]];
  const merged = t.where !== 'lane' && (t.status === 'done' || t.status === 'ready');
  return {
    source: merged ? 'merged' : 'branch',
    url: merged ? 'https://github.com/you/sample-game/commit/a91f3c2' : `https://github.com/you/sample-game/compare/main...${t.branch}`,
    files: files.map(([path, added, removed]) => ({ path, added, removed })),
  };
}

export async function bookmark(hash) {
  if (bookmarks.has(hash)) bookmarks.delete(hash); else bookmarks.add(hash);
  return { ok: true };
}

export async function newProject() { throw new Error('Start Rocco with rocco\\Rocco.bat to create projects.'); }

export async function history() {
  if (state.project !== 'sample-game') return { repo: '', main: { remote: false, unpushed: 0, total: 1, live: null, commits: [
    { full: 'c0ffee1', hash: 'c0ffee1', author: 'You', at: ago(600), subject: 'Start from the template', merge: false, branch: '', claude: false, pushed: false }] }, branches: [], lanes: [] };
  const commit = (hash, minutes, subject, extra = {}) => {
    const full = hash + '0'.repeat(33);
    return { full, hash, author: 'Sample User', at: ago(minutes), subject, merge: false, branch: '', claude: true, pushed: true, release: '', live: false, bookmarked: bookmarks.has(full), ...extra };
  };
  const merge = (hash, minutes, branch, extra = {}) => commit(hash, minutes, `Merge branch '${branch}'`, { merge: true, branch, ...extra });
  const ev = (minutes, kind, text) => ({ hash: 'abc1234', at: ago(minutes), kind, text });
  const day = minutes => ago(minutes).slice(0, 10);
  return {
    repo: 'https://github.com/you/sample-game',
    main: { remote: true, unpushed: 1, total: 214, live: { tag: `release/${day(1500)}`, commit: '8812ab4' + '0'.repeat(33) }, commits: [
      merge('a91f3c2', 4, 'agent/daily-reward', { pushed: false }),
      merge('7c2d8e1', 5, 'agent/shop-price-fit'),
      commit('3b8e0aa', 9, 'CLAIMS.md: lanes 2 and 4 for the reward and shop fixes'),
      merge('e04d1f7', 50, 'agent/tutorial-arrow'),
      merge('19aa6c3', 65, 'agent/music-toggle-save'),
      commit('d5e2b90', 70, 'EVENT-CATALOG.md: SettingChanged'),
      merge('f7c1d02', 80, 'agent/spawn-facing'),
      commit('8812ab4', 1500, 'Shop: phone layout for item cards', { claude: false, author: 'You', release: `release/${day(1500)}`, live: true }),
      merge('0b3e9d1', 1560, 'agent/quest-list-scroll'),
      commit('6a71c3e', 4400, 'PROJECT.md: Production phase', { release: `release/${day(4400)}` }),
    ] },
    branches: [
      { name: 'feature/pet-follow', local: true, pushed: true, at: ago(9), subject: 'Pets teleport to you when 40+ studs behind', author: 'Sample User', behind: 3, ahead: 11, lane: 5 },
      { name: 'feature/trading', local: true, pushed: true, at: ago(12), subject: 'Trade window: offers and the confirm countdown', author: 'Sample User', behind: 6, ahead: 7, lane: 6 },
      { name: 'agent/camera-clip', local: true, pushed: false, at: ago(3), subject: 'Camera pulls in on wall hits', author: 'Sample User', behind: 0, ahead: 2, lane: 3 },
      { name: 'agent/leaderboard-zero', local: true, pushed: false, at: ago(5), subject: 'Leaderstats read coins after the data loads', author: 'Sample User', behind: 0, ahead: 1, lane: 1 },
      { name: 'agent/swing-sound', local: true, pushed: true, at: ago(20), subject: 'Sword: swing sound from the sounds registry', author: 'Sample User', behind: 1, ahead: 1, lane: 7 },
      { name: 'agent/spawn-facing', local: true, pushed: true, at: ago(82), subject: 'Spawn faces the plaza', author: 'Sample User', behind: 0, ahead: 0, lane: null },
    ],
    lanes: [
      { lane: 1, branch: 'agent/leaderboard-zero', head: 'b71e0c4', dirty: 2, open: true, events: [ev(5, 'commit', 'Leaderstats read coins after the data loads'), ev(6, 'switch', 'Switched to agent/leaderboard-zero'), ev(49, 'refresh', 'Back on the latest main'), ev(52, 'commit', 'Tutorial arrow finds the shop by tag')] },
      { lane: 2, branch: '', head: 'a91f3c2', dirty: 0, open: true, events: [ev(4, 'refresh', 'Back on the latest main'), ev(6, 'commit', 'Claim saves before the reward is given'), ev(40, 'commit', 'Daily reward saves on claim'), ev(58, 'switch', 'Switched to agent/daily-reward')] },
      { lane: 3, branch: 'agent/camera-clip', head: '4c09e1b', dirty: 0, open: true, events: [ev(3, 'commit', 'Camera pulls in on wall hits'), ev(11, 'commit', 'Camera: raycast from the head'), ev(12, 'switch', 'Switched to agent/camera-clip')] },
      { lane: 4, branch: '', head: '7c2d8e1', dirty: 0, open: true, events: [ev(5, 'refresh', 'Back on the latest main'), ev(17, 'commit', 'Shop price labels shrink to fit'), ev(30, 'switch', 'Switched to agent/shop-price-fit')] },
      { lane: 5, branch: 'feature/pet-follow', head: '2f8a9d0', dirty: 0, open: true, events: [ev(9, 'commit', 'Pets teleport to you when 40+ studs behind'), ev(48, 'merge', 'Merged main'), ev(96, 'commit', 'Pets follow on the client'), ev(168, 'switch', 'Switched to feature/pet-follow')] },
      { lane: 6, branch: 'feature/trading', head: '9e3c1aa', dirty: 1, open: true, events: [ev(12, 'commit', 'Trade window: offers and the confirm countdown'), ev(80, 'commit', 'Trade requests'), ev(118, 'switch', 'Switched to feature/trading')] },
      { lane: 7, branch: 'agent/swing-sound', head: '5d0b7e2', dirty: 0, open: true, events: [ev(20, 'commit', 'Sword: swing sound from the sounds registry'), ev(39, 'switch', 'Switched to agent/swing-sound')] },
      { lane: 8, branch: '', head: 'a91f3c2', dirty: 0, open: false, events: [ev(300, 'refresh', 'Back on the latest main')] },
    ],
  };
}

// One worker steps along and finishes shortly after opening, to show live steps and a card arriving.
export function start() {
  const camera = () => data['sample-game']?.tasks.find(x => x.id === 'T-046');
  setTimeout(() => {
    const t = camera();
    if (!t || t.status !== 'working') return;
    Object.assign(t, { step: 'Checking the shop doorway', progress: 90 });
    t.log.push({ who: 'worker', at: ago(0), text: 'Hallway: no clipping in 6 spots.' });
  }, 7000);
  setTimeout(() => {
    const t = camera();
    if (!t || t.status !== 'working') return;
    Object.assign(t, { status: 'ready', progress: null, summary: "The camera pulls in when a wall's in the way.", test: 'Spin the camera in the shop hallway.' });
    t.log.push({ who: 'worker', at: ago(0), text: 'Pulls in on wall hits. Checked 6 hallway spots: no clipping.' });
    data['sample-game'].main.at = ago(0);
  }, 15000);
}
