// Sample data for working on the design without real tasks: open http://localhost:34860/?demo.
// It answers the same calls as the server, and its actions mirror rocco/server/tasks.ps1 Invoke-TaskAction.
import { state } from './state.js';

const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const picture = h => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'>
  <rect width='320' height='180' fill='hsl(${h},42%,62%)'/><rect y='128' width='320' height='52' fill='hsl(${h + 90},28%,36%)'/>
  <rect x='38' y='84' width='48' height='44' rx='4' fill='hsl(${h + 20},26%,30%)'/><rect x='208' y='66' width='66' height='62' rx='4' fill='hsl(${h + 40},20%,27%)'/>
  <circle cx='150' cy='114' r='12' fill='hsl(${h + 180},45%,50%)'/></svg>`);

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
      { ...base, id: 'T-038', status: 'ready', lane: 2, attempt: 2, title: 'Daily reward claimable twice after rejoin', shots: [picture(200)],
        note: 'daily reward lets me claim twice if i leave and rejoin quick', summary: 'The claim saves before the reward is given now.',
        test: 'Claim, leave, rejoin within 5 s. It should show the countdown.',
        log: [{ who: 'conductor', at: ago(59), text: 'Lane 2.' }, { who: 'worker', at: ago(42), text: 'Saves on claim instead of on autosave.' },
          { who: 'you', at: ago(21), text: 'Still happens if I rejoin really fast.' },
          { who: 'worker', at: ago(6), text: 'Save lands before the reward, and loading waits for the session lock. 20 fast rejoins: no double claims.' },
          { who: 'conductor', at: ago(4), text: 'Merged.' }] },
      { ...base, id: 'T-041', status: 'ready', lane: 4, title: 'Shop prices wrap on phone', shots: [picture(30)], note: 'shop prices wrap to 2 lines on phone',
        summary: 'Prices shrink to fit on phone.', test: 'Open the shop at phone size. Prices stay on one line.',
        log: [{ who: 'conductor', at: ago(31), text: 'Lane 4.' }, { who: 'worker', at: ago(17), text: 'Labels shrink to fit. Checked phone, tablet, desktop.' }, { who: 'conductor', at: ago(5), text: 'Merged.' }] },
      { ...base, id: 'T-044', status: 'ready', feature: true, where: 'lane', lane: 5, attempt: 3, branch: 'feature/pet-follow', title: 'Pets follow the player',
        note: 'pets should follow you around, not just sit at spawn', summary: 'Pets follow, and teleport to you if they fall 40+ studs behind.', test: 'Equip a pet, run, jump off the tower.',
        log: [{ who: 'conductor', at: ago(170), text: 'Feature branch, lane 5.' }, { who: 'you', at: ago(100), text: 'They lag way behind when I run.' },
          { who: 'you', at: ago(46), text: 'They get stuck when I jump off the tower.' }, { who: 'worker', at: ago(9), text: 'Teleport when 40+ studs behind. Always catches up within 1 s.' }] },
      { ...base, id: 'T-045', status: 'stuck', feature: true, where: 'lane', lane: 6, branch: 'feature/trading', title: 'Trading between players',
        note: 'players should be able to trade items', summary: 'Trading works. One rule to decide.', question: 'Someone opens the shop mid-trade. What happens?',
        options: ['Cancel the trade', 'Lock the shop'], log: [{ who: 'worker', at: ago(12), text: 'Needs a rule for the shop mid-trade.' }] },
      { ...base, id: 'T-043', status: 'stuck', lane: 7, title: 'Sword swing has no sound', note: 'no sound when i swing the sword',
        summary: 'The old sound was deleted from the store.', question: 'Pick a new swing sound.', options: ['Short whoosh', 'Blade swing', 'Air cut'],
        log: [{ who: 'worker', at: ago(20), text: 'Sound asset deleted. Found 3 replacements.' }] },
      { ...base, id: 'T-046', status: 'working', lane: 3, startedAt: ago(12), step: 'Testing', title: 'Camera clips into walls',
        note: 'camera goes inside the walls in the hallway by the shop', shots: [picture(260), picture(280)] },
      { ...base, id: 'T-047', status: 'working', lane: 1, startedAt: ago(6), step: 'Coding', title: 'New players show 0 coins on leaderboard', note: 'my alt shows 0 coins on the leaderboard till it rejoins' },
      { ...base, id: 'T-048', status: 'queued', title: 'Sort leaderboard by level', note: 'leaderboard should sort by level', waiting: 'After T-047 (same file)' },
      { ...base, id: 'T-049', status: 'queued', title: 'Coin pickup sound too loud', note: 'coin pickup sound is way too loud', waiting: 'After T-043 (same file)' },
      { ...base, id: 'T-050', status: 'inbox', title: "NPC dialog runs off the bubble when it's long", note: "npc dialog runs off the bubble when it's long", shots: [picture(120)] },
      { ...base, id: 'T-051', status: 'inbox', title: 'FPS drops near the spawn fountain', note: 'fps drops near the spawn fountain' },
      { ...base, id: 'T-035', status: 'done', doneAt: ago(80), title: 'Spawn faces a wall', note: 'you spawn facing a wall', summary: 'Spawn faces the plaza now.' },
      { ...base, id: 'T-036', status: 'done', doneAt: ago(65), title: "Music toggle doesn't save", note: "music toggle doesn't save", summary: 'Saved with player data now.' },
      { ...base, id: 'T-037', status: 'done', doneAt: ago(50), title: 'Tutorial arrow points at old shop', note: 'tutorial arrow points at the old shop spot', summary: 'Arrow finds the shop by tag.' },
    ],
  };
}

const data = {};
const current = () => (data[state.project] ??= seed(state.project));
const find = id => current().tasks.find(t => t.id === id);
let next = 100;

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
    { group: 'AI', name: 'Claude Code', status: 'ok', version: '2.1.312', latest: '2.1.312', detail: 'Signed in as you@example.com' },
    { group: 'AI', name: 'Codex', status: 'update', version: '0.165.0', latest: '0.166.0', detail: 'Signed in · makes images', update: 'It updates with the Codex app: restart the app.' },
    { group: 'Roblox', name: 'Roblox Studio', status: 'ok', version: '0.745.0', latest: '0.745.0', detail: '8 open' },
    { group: 'Roblox', name: 'Studio MCP', status: 'ok', detail: 'Registered as Roblox_Studio' },
    { group: 'Roblox', name: 'Lync', status: 'ok', version: 'Alpha 30', latest: '0.30.14', detail: "In the RoDev folder's _tools\\lync" },
    { group: 'Roblox', name: 'Lync plugin', status: 'ok', detail: 'Lync installs and updates it.' },
    { group: 'Tools', name: 'Git', status: 'update', version: '2.55.0', latest: '2.56.0', detail: 'Git for Windows', update: 'Update it:', command: 'git update-git-for-windows' },
    { group: 'Tools', name: 'GitHub CLI', status: 'off', detail: 'Optional, not installed.', update: 'Install it if you want Claude to handle GitHub for you:', command: 'winget install GitHub.cli' },
  ] };
}

export async function note(text) {
  const title = (text || 'Screenshot').split('\n')[0];
  const t = { id: `T-${next++}`, status: 'inbox', attempt: 1, where: 'main', title, note: text, shots: [], options: [], log: [], pending: '' };
  current().tasks.push(t);
  return { id: t.id };
}

export async function shot(id, file) {
  find(id).shots.push(URL.createObjectURL(file));
  return {};
}

const toConductor = (t, pending) => Object.assign(t, { status: 'queued', pending, waiting: 'Waiting for the conductor' });

export async function act(id, action, text) {
  const t = find(id), now = new Date().toISOString();
  switch (action) {
    case 'approve': Object.assign(t, { status: 'done', doneAt: now }); t.log.push({ who: 'you', at: now, text: 'Approved.' }); if (t.where === 'lane') t.pending = 'merge'; break;
    case 'reopen': t.attempt += 1; toConductor(t, 'reopen'); t.log.push({ who: 'you', at: now, text: text || 'Not right yet.' }); break;
    case 'answer': toConductor(t, 'answer'); t.log.push({ who: 'you', at: now, text }); break;
    case 'remove': t.status = 'removed'; break;
  }
  return { ok: true };
}

export async function send() {
  const inbox = current().tasks.filter(t => t.status === 'inbox');
  inbox.forEach(t => toConductor(t, 'plan'));
  return { sent: inbox.length };
}

export async function newProject() { throw new Error('Start Rocco with rocco\\Rocco.bat to create projects.'); }

export async function history() {
  if (state.project !== 'sample-game') return { repo: '', main: { remote: false, unpushed: 0, total: 1, commits: [
    { full: 'c0ffee1', hash: 'c0ffee1', author: 'You', at: ago(600), subject: 'Start from the template', merge: false, branch: '', claude: false, pushed: false }] }, branches: [], lanes: [] };
  const commit = (hash, minutes, subject, extra = {}) => ({ full: hash + '0'.repeat(33), hash, author: 'Sample User', at: ago(minutes), subject, merge: false, branch: '', claude: true, pushed: true, ...extra });
  const merge = (hash, minutes, branch, extra = {}) => commit(hash, minutes, `Merge branch '${branch}'`, { merge: true, branch, ...extra });
  const ev = (minutes, kind, text) => ({ hash: 'abc1234', at: ago(minutes), kind, text });
  return {
    repo: 'https://github.com/you/sample-game',
    main: { remote: true, unpushed: 1, total: 214, commits: [
      merge('a91f3c2', 4, 'agent/daily-reward', { pushed: false }),
      merge('7c2d8e1', 5, 'agent/shop-price-fit'),
      commit('3b8e0aa', 9, 'CLAIMS.md: lanes 2 and 4 for the reward and shop fixes'),
      merge('e04d1f7', 50, 'agent/tutorial-arrow'),
      merge('19aa6c3', 65, 'agent/music-toggle-save'),
      commit('d5e2b90', 70, 'EVENT-CATALOG.md: SettingChanged'),
      merge('f7c1d02', 80, 'agent/spawn-facing'),
      commit('8812ab4', 1500, 'Shop: phone layout for item cards', { claude: false, author: 'You' }),
      merge('0b3e9d1', 1560, 'agent/quest-list-scroll'),
      commit('6a71c3e', 1600, 'PROJECT.md: Production phase'),
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

// One worker finishes shortly after opening, to show a card arriving.
export function start() {
  setTimeout(() => {
    const t = data['sample-game']?.tasks.find(x => x.id === 'T-046');
    if (!t || t.status !== 'working') return;
    Object.assign(t, { status: 'ready', summary: "The camera pulls in when a wall's in the way.", test: 'Spin the camera in the shop hallway.' });
    t.log.push({ who: 'worker', at: ago(0), text: 'Pulls in on wall hits. Checked 6 hallway spots: no clipping.' });
    data['sample-game'].main.at = ago(0);
  }, 15000);
}
