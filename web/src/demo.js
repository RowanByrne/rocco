// Sample data for working on the design without real tasks: open http://localhost:34860/?demo.
// It answers the same calls as the server, and its actions mirror server/tasks.ps1 Invoke-TaskAction.
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
  { id: 'sample-game', name: 'Sample Game', phase: 'Production', template: false },
  { id: 'sky-farm', name: 'Sky Farm', phase: 'Core loop', template: false },
  { id: 'template', name: 'RoDev template', phase: 'Template', template: true },
];

function seed(id) {
  const base = { attempt: 1, where: 'main', options: [], shots: [], log: [], pending: '' };
  if (id !== 'sample-game') return { id, tasks: [], lanes: { count: 0, open: [], main: false, mine: null }, conductor: { state: 'none' }, main: { at: ago(600), subject: 'Start from the template' } };
  return {
    id,
    lanes: { count: 8, open: [1, 2, 3, 4, 5, 6, 7], main: true, mine: 8 },
    main: { at: ago(4), subject: 'Merge agent/daily-reward' },
    tasks: [
      { ...base, id: 'T-038', status: 'ready', type: 'bug', lane: 2, attempt: 2, title: 'Daily reward claimable twice after rejoin', shots: [picture(200)],
        note: 'daily reward lets me claim twice if i leave and rejoin quick', summary: 'The claim saves before the reward is given now.',
        test: 'Claim the reward, leave and rejoin within 5 s\nThe countdown shows, not a second reward', branch: 'agent/daily-reward',
        log: [{ who: 'conductor', at: ago(59), text: 'Lane 2.' }, { who: 'worker', at: ago(42), text: 'Saves on claim instead of on autosave.' },
          { who: 'you', at: ago(21), text: 'Still happens if I rejoin really fast.' },
          { who: 'worker', at: ago(6), text: 'Save lands before the reward, and loading waits for the session lock. 20 fast rejoins: no double claims.' },
          // As an agent writes it: shown tidied, with "Show original" under it (prose.js).
          { who: 'conductor', at: ago(4), text: 'MERGED TO MAIN at a91f3c2 -- lane 2 is free again.' }] },
      { ...base, id: 'T-041', status: 'ready', type: 'tweak', lane: 4, title: 'Shop prices wrap on phone', shots: [picture(30)], note: 'shop prices wrap to 2 lines on phone',
        summary: 'Prices shrink to fit on phone.', test: 'Open the shop at phone size. Prices stay on one line.', branch: 'agent/shop-price-fit',
        log: [{ who: 'conductor', at: ago(31), text: 'Lane 4.' }, { who: 'worker', at: ago(17), text: 'Labels shrink to fit. Checked phone, tablet, desktop.' }, { who: 'conductor', at: ago(5), text: 'Merged.' }] },
      { ...base, id: 'T-044', status: 'ready', type: 'feature', feature: true, where: 'lane', lane: 5, attempt: 3, branch: 'feature/pet-follow', title: 'Pets follow the player',
        note: 'pets should follow you around, not just sit at spawn',
        // Written before Rocco kept these short: the hover cuts it, and the sheet has it all.
        summary: 'Pets follow you everywhere now. They path around obstacles with the same navigation the NPCs use, and when one falls more than 40 studs behind (off the tower, through a wall, or after you teleport) it catches up in under a second by teleporting to a free spot right behind you, so it never lands inside you or in a wall.',
        test: 'Equip any pet and run a long loop around spawn, then jump off the tower and check it lands near you. Then teleport to the shop and check it arrives with you. Try it with two pets equipped as well, since they share the follow spots and could overlap.',
        log: [{ who: 'conductor', at: ago(170), text: 'Feature branch, lane 5.' }, { who: 'you', at: ago(100), text: 'They lag way behind when I run.' },
          { who: 'you', at: ago(46), text: 'They get stuck when I jump off the tower.' }, { who: 'worker', at: ago(9), text: 'Teleport when 40+ studs behind. Always catches up within 1 s.' }] },

      // Trading: an approved feature plan, built as three tasks on its own branch.
      // It has an agent of its own (server/leads.ps1): a tab above the chat, with its own thread (featureThread).
      { ...base, id: 'T-040', status: 'queued', pending: '', kind: 'plan', type: 'feature', where: 'lane', lane: 6, branch: 'feature/trading', title: 'Trading between players', lead: true,
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

      // A model at its gate: the question's own pictures to look at (ask -Show).
      { ...base, id: 'T-059', status: 'stuck', type: 'feature', lane: 8, title: 'Shop counter model', note: 'a counter for the shop',
        summary: 'The gray model is built from the picked concept.',
        questions: [{ text: 'The gray model, from the front and the side. Build the textures on it?', images: [scene(150), scene(170)],
          options: [{ label: 'Looks right' }, { label: 'Change it' }] }],
        log: [{ who: 'worker', at: ago(6), text: 'Gray model done, waiting at the gate.' }] },
      { ...base, id: 'T-043', status: 'stuck', type: 'bug', lane: 7, title: 'Sword swing has no sound', note: 'no sound when i swing the sword',
        summary: 'The old sound was deleted from the store. Found three replacements.',
        questions: [
          { text: 'Pick a new swing sound.', options: [{ label: 'Short whoosh', audio: sound(1) }, { label: 'Blade swing', audio: sound(2) }, { label: 'Air cut', audio: sound(3, 300) }] },
          { text: 'Play it on every swing, or only when it hits?', options: [{ label: 'Every swing' }, { label: 'Only on hits' }] },
        ],
        log: [{ who: 'worker', at: ago(20), text: 'Sound asset deleted. Found 3 replacements.' }] },
      { ...base, id: 'T-046', status: 'working', type: 'bug', lane: 3, startedAt: ago(12), step: 'Testing 6 hallway spots', progress: 70, title: 'Camera clips into walls',
        note: 'camera goes inside the walls in the hallway by the shop', shots: [picture(260), picture(280)], branch: 'agent/camera-clip',
        // Its time at work, and the checks its worker ran (rocco.ps1 result): the card shows both.
        worked: 0, workSince: ago(12),
        checks: [{ at: ago(8), ok: false, text: 'Camera test: 2 of 6 hallway spots still clip', file: 'check-1.txt', attempt: 1 }, { at: ago(4), ok: true, text: 'Camera test: 6 of 6 hallway spots clear', file: 'check-2.txt', attempt: 1 }],
        log: [{ who: 'conductor', at: ago(12), text: 'Lane 3.' }, { who: 'worker', at: ago(10), text: 'Found it: the camera only checks walls behind the head.' },
          { who: 'worker', at: ago(6), text: 'Raycast from the head to the camera.' }, { who: 'worker', at: ago(3), text: 'Camera pulls in on wall hits.' }] },
      { ...base, id: 'T-047', status: 'working', type: 'bug', lane: 1, startedAt: ago(6), step: 'Coding', title: 'New players show 0 coins on leaderboard',
        note: 'my alt shows 0 coins on the leaderboard till it rejoins', followups: 1, pending: 'followup', branch: 'agent/leaderboard-zero',
        log: [{ who: 'conductor', at: ago(6), text: 'Lane 1.' }, { who: 'worker', at: ago(5), text: 'Leaderstats are made before the data loads.' },
          { who: 'you', at: ago(2), text: 'Gems do the same thing, check those too.' }] },
      // The conductor on a note itself: no lane.
      { ...base, id: 'T-054', status: 'working', type: 'bug', kind: 'note', startedAt: ago(3), step: 'Playtesting in Main', title: 'Keep the baseplate in playtests',
        note: "put the baseplate back when you playtest it shouldn't disapear", summary: 'The playground hid it whenever a track was in the place.',
        log: [{ who: 'conductor', at: ago(3), text: 'On it myself: one file.' }] },
      { ...base, id: 'T-048', status: 'queued', type: 'tweak', kind: 'note', order: 1, after: ['T-047'], title: 'Sort leaderboard by level', note: 'leaderboard should sort by level', waiting: 'After T-047 (same file)' },
      { ...base, id: 'T-049', status: 'queued', type: 'tweak', kind: 'task', order: 2, after: ['T-043'], title: 'Coin pickup sound too loud', note: 'coin pickup sound is way too loud', waiting: 'After T-043 (same file)' },
      { ...base, id: 'T-050', status: 'queued', type: 'bug', kind: 'note', order: 4, pending: 'plan', waiting: 'Waiting for the conductor', title: "NPC dialog runs off the bubble when it's long", note: "npc dialog runs off the bubble when it's long", shots: [picture(120)] },
      { ...base, id: 'T-051', status: 'queued', type: 'bug', kind: 'note', order: 5, pending: 'plan', waiting: 'Rocco has read it', title: 'FPS drops near the spawn fountain', note: 'fps drops near the spawn fountain' },
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
        summary: 'Pets earn XP while equipped and evolve at level 10 and 25, with a new look each time.\nLeft out: trading evolved pets, and evolving more than twice.\nMy call: XP only while the pet is equipped (proposed).',
        spec: 'docs/game/features/pet-evolution.md',
        steps: [{ title: 'Pet XP and levels, saved with the pet', lane: 2, tier: 'heavy' }, { title: 'Evolve at 10 and 25, with the new models', lane: 4, tier: 'standard' },
          { title: 'Level bar and evolve effect in the pet menu', lane: 7, tier: 'standard' }],
        log: [{ who: 'conductor', at: ago(3), text: 'Plan ready: three tasks, on a feature branch.' }] },

      { ...base, id: 'T-034', status: 'done', kind: 'errand', doneAt: ago(3), title: 'Open Main and 4 lanes', note: 'startup 4 lanes and main', summary: 'Main and lanes 1 to 4 are open in Studio, each syncing.' },
      { ...base, id: 'T-035', status: 'done', type: 'bug', doneAt: ago(80), title: 'Spawn faces a wall', note: 'you spawn facing a wall', summary: 'Spawn faces the plaza now.' },
      { ...base, id: 'T-036', status: 'done', type: 'bug', doneAt: ago(65), title: "Music toggle doesn't save", note: "music toggle doesn't save", summary: 'Saved with player data now.' },
      { ...base, id: 'T-037', status: 'done', type: 'tweak', doneAt: ago(50), title: 'Tutorial arrow points at old shop', note: 'tutorial arrow points at the old shop spot', summary: 'Arrow finds the shop by tag.' },
    ],
    conductor: { state: 'busy', agent: 'Claude Code', doing: 'Merge the daily reward fix into main' },
    thread: sampleThread(),
    // The threads with an agent of their own, and what each agent is doing.
    threads: { 'T-040': featureThread() },
    agents: { 'T-040': { state: 'listening', agent: 'Claude Code' } },
  };
}

// A feature's own thread: its agent building it step by step, and the user talking to it directly.
function featureThread() {
  const at = ago;
  const items = [
    { id: 'C-000101', at: at(124), who: 'rocco', kind: 'event', text: 'Rocco opened Claude Code for this feature, in lane 6', task: 'T-040' },
    { id: 'C-000102', at: at(122), who: 'conductor', kind: 'said', text: "I'm on Trading. Three steps on `feature/trading`, one at a time in this lane:\n1. Trade requests\n2. The trade window and its countdown\n3. Trade history\n\nYou get each one to test as it's done." },
    { id: 'C-000103', at: at(118), who: 'conductor', kind: 'asked', via: 'hook', questions: [
      { text: 'Can a player have more than one trade request open at a time?', header: 'Requests', multi: false, options: [{ label: 'One at a time' }, { label: 'Up to three' }] }] },
    { id: 'C-000104', at: at(116), who: 'you', kind: 'answered', to: 'C-000103', answers: ['One at a time'], text: 'Can a player have more than one trade request open at a time? One at a time' },
    { id: 'C-000105', at: at(84), who: 'rocco', kind: 'event', text: 'Ready to test: Trade requests', task: 'T-042' },
    { id: 'C-000106', at: at(80), who: 'you', kind: 'sent', act: 'approve', task: 'T-042', title: 'Trade requests', text: '' },
    { id: 'C-000107', at: at(78), who: 'conductor', kind: 'said', text: 'Trade requests are in. Starting the trade window: both inventories side by side, an offer slot each, and a confirm button that starts the countdown.' },
    { id: 'C-000108', at: at(40), who: 'you', kind: 'message', text: 'make the accept button green, and put it on the right', via: 'rocco' },
    { id: 'C-000109', at: at(38), who: 'conductor', kind: 'said', text: 'Done: the accept button is green and on the right, with Cancel on the left.' },
    { id: 'C-000110', at: at(12), who: 'rocco', kind: 'event', text: 'Needs your answer: Trade window and the confirm countdown', task: 'T-045' },
    { id: 'C-000111', at: at(11), who: 'conductor', kind: 'said', text: "The window works end to end. Two rules are yours to decide before I finish it: what happens when someone opens the shop mid-trade, and how long the countdown is. They're on the card." },
  ];
  const steps = [[121, 'Reading LEAD.md'], [120, 'Reading docs/game/features/trading.md'], [110, 'Editing TradeService.luau'], [95, 'Using Studio: start stop play'], [70, 'Editing TradeWindow.luau'],
    [52, 'Editing TradeWindow.luau'], [39, 'Editing TradeWindow.luau'], [20, 'Using Studio: start stop play'], [13, 'Asking on the card'], [10, 'Wait for what the feature needs']].map(([m, text]) => ({ at: at(m), text }));
  return { items, steps };
}

// The conductor's thread (server/thread.ps1): what it said and asked, what the user sent, milestones, and its steps.
function sampleThread() {
  const at = ago;
  const items = [
    { id: 'C-000001', at: at(200), who: 'rocco', kind: 'event', text: 'Rocco opened Claude Code as the conductor' },
    { id: 'C-000002', at: at(181), who: 'you', kind: 'sent', act: 'note', task: 'T-044', title: 'Pets follow the player', text: 'pets should follow the player around' },
    { id: 'C-000003', at: at(176), who: 'conductor', kind: 'said', text: "One task: pets follow on a feature branch, so you can try it in lane 5 before it goes into Main." },
    { id: 'C-000004', at: at(170), who: 'rocco', kind: 'event', text: 'Started in lane 5: Pets follow the player', task: 'T-044' },
    { id: 'C-000005', at: at(130), who: 'rocco', kind: 'event', text: 'Posted a plan for your OK: Trading between players', task: 'T-040' },
    { id: 'C-000006', at: at(124), who: 'you', kind: 'sent', act: 'approve-plan', task: 'T-040', title: 'Trading between players', text: '' },
    { id: 'C-000018', at: at(124), who: 'rocco', kind: 'event', text: 'Trading between players has its own thread now: an agent of its own builds it there', task: 'T-040' },
    // A question, answered here with no card kept (rocco.ps1 reply -Answer).
    { id: 'C-000019', at: at(90), who: 'you', kind: 'sent', act: 'question', task: 'T-039', title: 'Does the shop restock while nobody is online?', text: 'does the shop restock while nobody is online?' },
    { id: 'C-000020', at: at(89), who: 'conductor', kind: 'said', re: 'Does the shop restock while nobody is online?', task: 'T-039', text: "No. The restock timer only runs while a server is up, and it starts again from the shop's saved time when the first player joins. So after a quiet night the shop restocks about a minute after you join, once." },
    { id: 'C-000007', at: at(61), who: 'conductor', kind: 'permission', tool: 'Bash', text: 'Push main to GitHub', detail: 'git push origin main', worker: false },
    { id: 'C-000008', at: at(60), who: 'you', kind: 'decided', to: 'C-000007', allow: true },
    { id: 'C-000009', at: at(31), who: 'conductor', kind: 'said', text: "**Done**\n- Daily reward can't be claimed twice: it saves on claim now (T-038, lane 2).\n- Shop prices fit on phones (T-041).\n\n**Flagged**\n- The trade countdown has no sound yet. I'll ask you which one when it's built.\n- `T-046` found the camera only checks walls behind the head; the fix is in progress." },
    { id: 'C-000010', at: at(28), who: 'you', kind: 'message', text: 'nice. do the camera next', via: 'rocco' },
    // Check-ins with nothing in them: the history folds a run of these into one line.
    { id: 'C-000015', at: at(24), who: 'conductor', kind: 'said', text: 'Watching.' },
    { id: 'C-000016', at: at(20), who: 'conductor', kind: 'said', text: 'Watching the board.' },
    { id: 'C-000017', at: at(16), who: 'conductor', kind: 'said', text: 'Watching.' },
    { id: 'C-000011', at: at(4), who: 'rocco', kind: 'event', text: 'Ready to test: Daily reward claimable twice after rejoin', task: 'T-038' },
    // An errand: done and said, with no card to approve (rocco.ps1 reply -Done).
    { id: 'C-000021', at: at(4), who: 'you', kind: 'sent', act: 'note', task: 'T-034', title: 'Open Main and 4 lanes', text: 'startup 4 lanes and main' },
    { id: 'C-000022', at: at(3), who: 'conductor', kind: 'said', re: 'Open Main and 4 lanes', task: 'T-034', text: 'Main and lanes 1 to 4 are open in Studio, each syncing.' },
    // Concepts to pick from: each option has its picture (server/tasks.ps1 Add-Pictures).
    { id: 'C-000014', at: at(3), who: 'conductor', kind: 'asked', via: 'hook', questions: [
      { text: 'Which shop interior should the room be built from? The four concepts are in ..\\art\\generated\\shop-concept\\.', header: 'Shop look', multi: false, images: [],
        options: [{ label: '1: Dusk market', detail: 'shop-01: warm orange lamps, wooden stalls, a big counter up front', image: scene(24) },
          { label: '2: Neon arcade', detail: 'shop-02: dark blue and magenta, glass cases along the walls', image: scene(250) },
          { label: '3: Sunny bazaar', detail: 'shop-03: bright yellow awnings, crates and plants', image: scene(52) },
          { label: '4: Clean showroom', detail: 'shop-04: white and grey, items on plinths, room for menus', image: scene(200) }] }] },
    { id: 'C-000012', at: at(2), who: 'conductor', kind: 'asked', via: 'hook', questions: [
      { text: 'The trade countdown needs a sound when it ends. Which one?', header: 'Trade sound', multi: false,
        options: [{ label: 'Soft chime', detail: 'A short two-note chime' }, { label: 'Cash register', detail: 'Ka-ching, a bit louder' }, { label: 'None', detail: 'Silent, the window just closes' }] },
      { text: 'Which players hear it?', header: 'Who hears', multi: true,
        options: [{ label: 'Both traders', detail: '' }, { label: 'Players nearby', detail: 'Within 30 studs' }] }] },
    { id: 'C-000013', at: at(1), who: 'conductor', kind: 'permission', tool: 'Bash', text: 'Delete the old shop branch', detail: 'git branch -D agent/old-shop', worker: false },
  ];
  const steps = [
    [44, 'Reading CONDUCTOR.md'], [43, 'List what waits on the conductor'], [41, 'Starting a worker: Daily reward claimable twice'], [38, 'Merge agent/daily-reward into main'],
    [36, 'Running the tests'], [33, 'Push main to GitHub'], [26, 'Starting a worker: Camera clips into walls'],
    [25, 'Wait for what the board needs'], [21, 'Wait for what the board needs'], [17, 'Wait for what the board needs'], [12, 'Reading CameraController.luau'],
    [9, 'Using Studio: start stop play'], [6, 'Merge the daily reward fix into main'],
  ].map(([m, text]) => ({ at: at(m), text }));
  return { items, steps };
}

// A thread's lines: the conductor's (the main chat), or, by its id, one of a feature or card with an agent of its own.
const threadOf = (d, id = '') => id ? ((d.threads ??= {})[id] ??= { items: [], steps: [] }) : (d.thread ??= { items: [], steps: [] });
const addLine = (d, kind, fields, who = 'conductor', thread = '') => { const e = { id: `C-${String(next++).padStart(6, '0')}`, at: new Date().toISOString(), who, kind, ...fields }; threadOf(d, thread).items.push(e); return e; };
// Each thread's agent: what it's doing.
const agentOf = (d, id = '') => (id ? (d.agents ??= {})[id] : d.conductor) || { state: 'listening', agent: 'Claude Code' };
const setAgentState = (d, id, value) => { if (id) (d.agents ??= {})[id] = value; else d.conductor = value; };

// What a thread's status line shows, worked out as the server does (thread.ps1, Get-ConductorThread).
function conductorView(d, id = '') {
  const t = threadOf(d, id), has = (kind, to) => t.items.some(x => x.kind === kind && x.to === to);
  const open = t.items.filter(e => (e.kind === 'asked' && !has('answered', e.id)) || (e.kind === 'permission' && !has('decided', e.id) && !has('expired', e.id)));
  const last = [...t.items].reverse().find(e => e.kind === 'said');
  const replied = !!last && t.items.some(e => e.who === 'you' && e.at > last.at);
  return { doing: '', ...agentOf(d, id), open, elsewhere: [], last: last ? { id: last.id, at: last.at, text: last.text, replied } : null, stamp: `${t.items.length}.${t.steps.length}` };
}

// The threads with an agent of their own (server/leads.ps1, Get-LeadsState).
const leadsView = d => d.tasks.filter(t => t.lead && onBoard(t)).map(t => ({
  id: t.id, title: t.title, kind: t.kind === 'plan' ? 'feature' : 'card', lane: t.lane || null, done: t.status === 'done', handoff: t.pending === 'handoff',
  waiting: t.pending === 'handoff' ? '' : t.leadWaiting || '', conductor: conductorView(d, t.id),
}));

export async function conductorThread(stamp, thread = '') {
  const d = current(), t = threadOf(d, thread), now = `${t.items.length}.${t.steps.length}`;
  return stamp === now ? { same: true } : { stamp: now, items: t.items, steps: t.steps };
}

// The demo's agents carry on a moment after the user answers or writes.
function carryOn(d, text, step, thread = '') {
  setTimeout(() => { threadOf(d, thread).steps.push({ at: new Date().toISOString(), text: step }); setAgentState(d, thread, { ...agentOf(d, thread), state: 'busy', doing: step }); }, 1200);
  setTimeout(() => { addLine(d, 'said', { text }, 'conductor', thread); setAgentState(d, thread, { ...agentOf(d, thread), state: 'listening', doing: '' }); }, 3500);
}

export async function conductorAnswer(id, answers, text, thread = '') {
  const d = current();
  addLine(d, 'answered', { to: id, answers, text }, 'you', thread);
  carryOn(d, `Going with: ${answers.join('; ')}. This is the demo, so nothing is built.`, 'Wiring the trade countdown sound', thread);
  return { ok: true, opened: '' };
}
export async function conductorPermission(id, allow, thread = '') { addLine(current(), 'decided', { to: id, allow }, 'you', thread); return { ok: true }; }
export async function conductorMessage(text, to, thread = '') {
  const d = current();
  const e = addLine(d, 'message', { text, to, via: 'rocco' }, 'you', thread);
  carryOn(d, thread ? "Got it. In a real project this feature's own agent reads this through rocco.ps1 wait, and answers here."
    : 'Got it. In a real project the conductor reads this through rocco.ps1 wait and answers here.', 'Reading your message', thread);
  return { id: e.id, opened: '' };
}
export async function showConductor() { return { shown: true }; }

const data = {};
const current = () => (data[state.project] ??= seed(state.project));
const find = id => current().tasks.find(t => t.id === id);
const nextOrder = () => Math.max(0, ...current().tasks.filter(t => t.status === 'queued').map(t => t.order || 0)) + 1;
let next = 100;
const bookmarks = new Set();

export async function projects() { return { home: 'sample-game', projects: PROJECTS }; }

// A task on the board: not deleted, and not approved more than three days ago (the server's cut, tasks.ps1).
const onBoard = t => t.status !== 'removed' && !(t.status === 'done' && t.doneAt && Date.now() - Date.parse(t.doneAt) > 3 * 864e5);

export async function snapshot() {
  const d = current();
  // Another sample project with a card waiting, to show the project picker's mark for it.
  const others = state.project === 'sample-game' ? [{ id: 'sky-farm', name: 'Sky Farm', stuck: 1, ready: 0, asks: 0 }] : [];
  return JSON.stringify({ rocco: 'demo', project: { template: false, ...PROJECTS.find(p => p.id === state.project) }, lanes: d.lanes, conductor: conductorView(d), leads: leadsView(d), main: d.main, tasks: d.tasks.filter(onBoard), others });
}

// ---- The archive, usage, one task, and a changed file's lines (tasks.ps1, sessions.ps1, history.ps1) ----

// Tasks finished long ago: what the sample game's archive holds. Each: id, title, note, days ago, seconds at work,
// tokens used.
const OLD = /** @type {[string, string, string, number, number, number][]} */ ([
  ['T-012', 'Trade window opens from the HUD', 'trade window should open from a HUD button', 21, 5400, 1.9e6],
  ['T-015', 'Coins save on leave', 'coins reset when i leave quick', 18, 2700, 0.8e6],
  ['T-019', 'Shop sign faces the path', 'the shop sign faces the wall', 12, 900, 0.3e6],
  ['T-023', 'Pets idle animation', 'pets just stand still, give them an idle', 9, 6100, 2.4e6],
  ['T-027', 'Old tutorial arrow', 'remove the old tutorial arrow', 7, 0, 0],
]).map(([id, title, note, days, worked, used], n) => ({ id, title, note, kind: 'task', type: n % 2 ? 'tweak' : 'bug', status: id === 'T-027' ? 'removed' : 'done', pending: '', attempt: 1, where: 'main',
  lane: (n % 4) + 1, branch: id === 'T-027' ? '' : `agent/${title.toLowerCase().replace(/[^a-z]+/g, '-')}`, summary: id === 'T-027' ? '' : `${title}.`, test: '', questions: [], shots: [], after: [], plan: '', steps: [],
  created: ago(days * 1440 + 300), updated: ago(days * 1440), doneAt: id === 'T-027' ? null : ago(days * 1440), worked, used,
  log: [{ who: 'conductor', at: ago(days * 1440 + 200), text: `Lane ${(n % 4) + 1}.` }, { who: 'you', at: ago(days * 1440), text: id === 'T-027' ? 'Deleted.' : 'Approved.' }] }));

export async function archive(q = '', skip = 0) {
  if (state.project !== 'sample-game') return { total: 0, skip, tasks: [] };
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const gone = current().tasks.filter(t => !onBoard(t));
  const rows = [...gone, ...OLD].filter(t => words.every(w => `${t.id} ${t.title} ${t.note} ${t.summary || ''} ${(t.log || []).map(l => l.text).join(' ')}`.toLowerCase().includes(w)));
  return { total: rows.length, skip, tasks: rows.slice(skip, skip + 50) };
}

export async function task(id) {
  const t = find(id) || OLD.find(x => x.id === id);
  if (!t) throw Object.assign(new Error(`There's no task ${id} in this project.`), { status: 404 });
  return t;
}

// What a task's sessions used: a made-up count that grows with its time at work.
const usedBy = t => { const n = t.used ?? Math.round(((t.worked || 0) + (t.workSince ? (Date.now() - Date.parse(t.workSince)) / 1000 : 0)) * 2400); return { in: Math.round(n * 0.0001), out: Math.round(n * 0.012), cacheRead: Math.round(n * 0.95), cacheWrite: Math.round(n * 0.038) }; };

export async function usage() {
  if (state.project !== 'sample-game') return { tasks: [], plans: [], conductor: null, sessions: 0 };
  const all = [...current().tasks, ...OLD];
  const tasks = all.filter(t => t.worked || t.workSince || t.used).map(t => ({
    id: t.id, title: t.title, status: t.status, plan: t.plan || '', lane: t.lane ?? null, attempt: t.attempt || 1, doneAt: t.doneAt || null,
    worked: Math.round((t.worked || 0) + (t.status === 'working' && t.workSince ? (Date.now() - Date.parse(t.workSince)) / 1000 : 0)), ...usedBy(t), sessions: 1, models: ['claude-opus-5-5'],
  })).sort((a, b) => (b.cacheRead + b.out) - (a.cacheRead + a.out));
  return { tasks, sessions: tasks.length, plans: all.filter(t => t.kind === 'plan').map(p => ({ id: p.id, title: p.title })),
    conductor: { in: 456, out: 107401, cacheRead: 42343467, cacheWrite: 553499, messages: 200, model: 'claude-opus-5-5' } };
}

export async function diff(id, path) {
  const text = [`diff --git a/${path} b/${path}`, 'index 4f2a1c9..b81e0d3 100644', `--- a/${path}`, `+++ b/${path}`, '@@ -12,7 +12,9 @@ function Occlusion.update(camera, head)',
    '   local params = RaycastParams.new()', '   params.FilterDescendantsInstances = { head.Parent }', '-  local back = head.CFrame.LookVector * -1', '-  local hit = workspace:Raycast(head.Position, back * distance, params)',
    '+  -- From the head to where the camera wants to be: a wall at the side counts too.', '+  local toCamera = camera.CFrame.Position - head.Position', '+  local hit = workspace:Raycast(head.Position, toCamera, params)',
    '   if hit then', '+    camera.CFrame = CFrame.new(hit.Position + hit.Normal * 0.4, head.Position)', '   end', ' end'].join('\n');
  return { path, binary: /\.(png|rbxm|ogg)$/i.test(path), text: /\.(png|rbxm|ogg)$/i.test(path) ? '' : text, cut: false };
}

export async function checkOutput(id, name) {
  return name === 'check-1.txt'
    ? 'CameraWalls: 6 spots\n  shop door ........ clear\n  stairs corner .... CLIPPED (0.0 studs)\n  hallway mid ...... clear\n  hallway end ...... CLIPPED (0.0 studs)\n  counter .......... clear\n  back room ........ clear\n\n2 of 6 spots clip. FAILED'
    : 'CameraWalls: 6 spots\n  shop door ........ clear\n  stairs corner .... clear\n  hallway mid ...... clear\n  hallway end ...... clear\n  counter .......... clear\n  back room ........ clear\n\n6 of 6 spots clear. PASSED\n\nStudio console: no errors, 1 warning\n  [warn] Occlusion: camera pulled in 14 times this run';
}

export async function me() {
  return { name: 'Sample User', login: 'sample-user', email: 'you@example.com', claude: 'you@example.com', pc: 'THIS-PC', avatar: '' };
}

// Each kind of one-click fix (server/actions.ps1). A fix that's been run shows its row up to date.
const fixed = new Set();
const done = item => item.action && fixed.has(item.action.id)
  ? { ...item, status: 'ok', version: item.latest || item.version, action: undefined, update: '', command: '', detail: item.fixedDetail || item.detail } : item;

export async function connections() {
  return { checking: false, checkedAt: ago(3), online: true, items: [
    { group: 'Project', name: 'Template', status: 'update', version: 'v1.1.0', latest: 'v1.3.0', detail: 'Template v1.3.0 is out; this game is on v1.1.0.',
      update: "Ask your agent to bring it in: it merges the release and keeps this game's own docs (TEMPLATE.md).",
      release: { tag: 'template/v1.3.0', notes: 'v1.3.0\nDocs: a WORLD.md for the map\nLANES.md: how many lanes a PC opens\n\nv1.2.0\nRocco: Docs view' },
      action: { kind: 'ask', label: 'Ask your agent to update', note: 'Update from template to template/v1.3.0 (TEMPLATE.md "Taking an update").' } },
    // Sky Farm has no GitHub repo yet: its row asks for one.
    state.project === 'sky-farm' ? { group: 'Project', name: 'GitHub', status: 'warn', detail: 'No GitHub repo yet, so nothing is backed up.', fixedDetail: 'you/sky-farm',
      update: 'Create an empty private repo on GitHub (no README), then connect it: Rocco adds it and pushes main (NEW-PROJECT.md).', command: 'git remote add origin <url>',
      action: { kind: 'input', label: 'Connect', id: 'github-connect', placeholder: 'https://github.com/you/game.git' } }
      : { group: 'Project', name: 'GitHub', status: 'ok', detail: 'you/sample-game' },
    { group: 'Project', name: 'Commit check', status: 'warn', detail: 'Off: big files can get into git.', fixedDetail: 'Refuses files over 5 MB.',
      update: 'Turn it on in repo\\:', command: 'git config core.hooksPath tools/hooks', action: { kind: 'run', label: 'Turn on', id: 'hooks-on' } },
    { group: 'Project', name: 'Studio sync', status: 'ok', detail: 'Lync is serving Main and 7 lanes.' },
    { group: 'Libraries', name: 'TopbarPlus', status: 'ok', version: 'v3.5.0', latest: 'v3.5.0', detail: 'github.com/1ForeverHD/TopbarPlus · no local patches' },
    { group: 'Libraries', name: 'Cmdr', status: 'update', version: 'v1.9.0', latest: 'v1.13.1', detail: 'github.com/evaera/Cmdr · local patches: admin check reads Config',
      update: 'Your agent updates it: vendors the new release, re-applies any local patches, and updates ARCHITECTURE.md (CODING.md "Third-party code").',
      action: { kind: 'ask', label: 'Ask your agent to update', note: 'Update Cmdr from v1.9.0 to v1.13.1 (CODING.md "Third-party code").' } },
    { group: 'AI', name: 'Claude Code', status: 'ok', version: '2.1.312', latest: '2.1.312', detail: 'Signed in as you@example.com' },
    { group: 'AI', name: 'Codex', status: 'update', version: '0.165.0', latest: '0.166.0', detail: 'Signed in · makes images', update: 'It updates with the Codex app: restart the app.' },
    { group: 'Roblox', name: 'Roblox Studio', status: 'ok', version: '0.745.0', latest: '0.745.0', detail: '8 open' },
    { group: 'Roblox', name: 'Studio MCP', status: 'ok', detail: 'Registered as Roblox_Studio' },
    { group: 'Roblox', name: 'Lync', status: 'update', version: '0.30.12', latest: '0.30.14', detail: "In the RoDev folder's _tools\\lync",
      update: 'Download the latest release into _tools\\lync (WORKSTATION.md).', action: { kind: 'window', label: 'Update', id: 'lync-update' } },
    { group: 'Roblox', name: 'Lync plugin', status: 'ok', detail: 'Lync installs and updates it.' },
    // A plugin this PC has but the game doesn't need: listed, never flagged.
    { group: 'Roblox', name: 'Moon Animator plugin', status: 'update', version: '2.4.0', latest: '2.5.1', detail: 'github.com/sample/moon-animator', update: 'Get the new version from github.com/sample/moon-animator/releases.',
      action: { kind: 'link', label: 'Get it', url: 'https://github.com/sample/moon-animator/releases/latest' } },
    roccoUpdated ? { group: 'Tools', name: 'Rocco', status: 'ok', version: 'v0.3.0', latest: 'v0.3.0', detail: "In the RoDev folder's _tools\\rocco" }
      : { group: 'Tools', name: 'Rocco', status: 'update', version: 'v0.2.0', latest: 'v0.3.0', detail: "In the RoDev folder's _tools\\rocco",
        update: 'Update it from here, or in _tools\\rocco check out v0.3.0 and restart Rocco.',
        release: { tag: 'v0.3.0', notes: 'Docs: every doc in the repo, with previews, an ask box, and edit and push.\nConnections: Rocco tells you when a new release is out, and updates itself.' },
        action: { kind: 'rocco', label: 'Update to v0.3.0', tag: 'v0.3.0' } },
    { group: 'Tools', name: 'Git', status: 'update', version: '2.55.0', latest: '2.56.0', detail: 'Git for Windows', update: 'Update it:', command: 'git update-git-for-windows',
      action: { kind: 'window', label: 'Update', id: 'git-update' } },
    { group: 'Tools', name: 'GitHub CLI', status: 'off', detail: 'Optional, not installed.', fixedDetail: 'gh', update: 'Install it if you want your agent to handle GitHub for you:',
      command: 'winget install --id GitHub.cli --exact', action: { kind: 'window', label: 'Install', id: 'gh-install' } },
    robloxRow(),
    elevenLabs(),
  ].map(done) };
}

// The demo's fixes: quick ones at once, updates "in their own window" for a few seconds.
const runs = {};
export async function action(id, value = '') {
  await new Promise(resolve => setTimeout(resolve, 500));
  if (id === 'hooks-on') { fixed.add(id); return { message: 'The commit check is on.' }; }
  if (id === 'github-connect') {
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(value.trim())) throw new Error("That isn't a GitHub repo address, like https://github.com/you/game.git");
    fixed.add(id);
    return { message: 'Connected to GitHub, and main is pushed.' };
  }
  const run = `demo-${id}`;
  runs[run] = { id, until: Date.now() + 3500, label: { 'lync-update': 'Updating Lync', 'git-update': 'Updating Git for Windows', 'gh-install': 'Installing the GitHub CLI',
    'gemini-update': 'Installing the latest Gemini CLI', 'codex-login': 'Signing in to Codex', 'gemini-login': 'Signing in to Gemini CLI', 'claude-login': 'Signing in to Claude Code' }[id] || 'Updating' };
  return { run, label: runs[run].label };
}
export async function actionRun(run) {
  const r = runs[run], running = Date.now() < r.until;
  if (!running) fixed.add(r.id);
  return { running, ok: !running, label: r.label };
}

// ElevenLabs starts unlinked; any key links, on the Starter plan.
let eleven = null;
const elevenLabs = () => ({
  group: 'AI', name: 'ElevenLabs', link: 'elevenlabs', linked: !!eleven, hint: eleven || '',
  ...(eleven ? { status: 'ok', detail: 'Linked · Starter plan · 4,200 of 30,000 credits used' }
    : { status: 'off', detail: "Not linked: sound effects and music can't be generated on this PC.", update: 'Link your ElevenLabs account in its details, to make sound effects and music (AUDIO-PIPELINE.md).' }),
});
let robloxKey = 'x9Qa';
const robloxRow = () => ({
  group: 'Roblox', name: 'Roblox Open Cloud', link: 'roblox', linked: !!robloxKey, hint: robloxKey || '',
  ...(robloxKey ? { status: 'ok', detail: 'Linked.' }
    : { status: 'off', detail: 'Not linked: Updates and Thumbnails show only what Roblox makes public.', update: 'Link your Roblox Open Cloud key in its details.' }),
});
export async function link(service, key) {
  if (!key.trim()) throw new Error("That doesn't look like an API key.");
  if (service === 'roblox') { robloxKey = key.trim().slice(-4); return { note: '' }; }
  eleven = key.trim().slice(-4);
  return { tier: 'starter' };
}
export async function unlink(service) { if (service === 'roblox') robloxKey = null; else eleven = null; return { ok: true }; }

// hold: the note waits for its screenshots (the server keeps it from the conductor until release).
export async function note(text, type, hold = false) {
  const title = (text || 'Screenshot').split('\n')[0], question = type === 'question';
  const t = { id: `T-${next++}`, kind: question ? 'question' : 'note', type: type || '', attempt: 1, where: 'main', title, note: text, shots: [], options: [], log: [] };
  current().tasks.push(toConductor(t, hold ? '' : question ? 'question' : 'plan'));
  if (hold) { t.uploading = new Date().toISOString(); t.waiting = 'Adding its screenshots'; return { id: t.id }; }
  addLine(current(), 'sent', { act: question ? 'question' : 'note', task: t.id, title, text }, 'you');
  if (question) answerSoon(t);
  return { id: t.id };
}

// The held note's screenshots are on it (or didn't make it): the conductor gets it now.
export async function release(id) {
  const t = find(id);
  if (!t) throw new Error(`There's no task ${id}.`);
  if (!t.uploading) return { ok: true, opened: '' };
  const question = t.kind === 'question';
  Object.assign(t, { uploading: null, pending: question ? 'question' : 'plan', waiting: 'Waiting for the conductor' });
  addLine(current(), 'sent', { act: question ? 'question' : 'note', task: t.id, title: t.title, text: t.note }, 'you');
  if (question) answerSoon(t);
  return { ok: true, opened: '' };
}

// The demo's conductor answers questions after a few seconds.
function answerSoon(t) {
  setTimeout(() => {
    if (t.status !== 'queued') return;
    // As rocco.ps1 reply -Answer does: the answer is said in the chat, and no card is kept.
    const reply = 'This is the demo, so here is a stand-in answer. In a real project Rocco answers a question here in the chat, and keeps no card for it.';
    Object.assign(t, { status: 'done', doneAt: new Date().toISOString(), pending: '', waiting: '', summary: reply });
    t.log.push({ who: 'conductor', at: new Date().toISOString(), text: reply });
    addLine(current(), 'said', { text: reply, re: t.title, task: t.id });
  }, 5000);
}

export async function shot(id, file) {
  const t = find(id);
  t.shots.push(URL.createObjectURL(file));
  return { name: `shot-${t.shots.length}.png` };
}

// A feature or a card given an agent of its own: its thread starts, and the main chat says where it went.
function ownAgent(t, opened, hello) {
  const d = current();
  Object.assign(t, { lead: true, lane: t.lane || 2 });
  addLine(d, 'event', { text: opened, task: t.id }, 'rocco', t.id);
  addLine(d, 'event', { text: `${t.title} has its own thread now: an agent of its own ${t.kind === 'plan' ? 'builds it' : 'works on it'} there`, task: t.id }, 'rocco');
  setAgentState(d, t.id, { state: 'busy', agent: 'Claude Code', doing: 'Reading LEAD.md' });
  setTimeout(() => { addLine(d, 'said', { text: hello }, 'conductor', t.id); setAgentState(d, t.id, { state: 'listening', agent: 'Claude Code' }); }, 2500);
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
    case 'answer': saveUndo(t); toConductor(t, 'answer'); say(text); break;
    case 'queue': saveUndo(t); toConductor(t, 'plan'); say('Queued.'); break;
    case 'remove': {
      // As the server does: a plan's unfinished tasks go with it, and running work waits on the conductor (cancel).
      const running = k => k.status === 'working' || k.status === 'stuck' || (k.where === 'lane' && k.branch && (k.status !== 'done' || k.pending === 'merge'));
      const drop = (k, with_) => { saveUndo(k); k.pending = running(k) ? 'cancel' : ''; k.status = 'removed'; k.removedWith = with_; };
      drop(t, '');
      if (t.kind === 'plan') current().tasks.filter(k => k.plan === t.id && k.status !== 'removed' && (k.status !== 'done' || k.pending === 'merge')).forEach(k => drop(k, t.id));
      break;
    }
    case 'followup': if (!text) throw new Error('A follow-up needs some text.'); say(text); t.followups = (t.followups || 0) + 1; t.pending ||= 'followup'; break;
    case 'undo': {
      const u = t.undo;
      if (!u) throw new Error('Nothing to undo.');
      const restore = k => { const v = k.undo; Object.assign(k, { status: v.status, pending: v.pending, waiting: v.waiting, doneAt: v.doneAt, order: v.order, undo: null, removedWith: '' }); k.log.length = v.logCount; };
      restore(t);
      if (t.kind === 'plan') current().tasks.filter(k => k.status === 'removed' && k.removedWith === t.id && k.undo).forEach(restore);
      break;
    }
    case 'approve-plan':
      Object.assign(t, { status: 'queued', pending: 'approved', waiting: 'Waiting for the conductor' }); say('Approved the plan.');
      // As the server does: it gets an agent and a thread of its own, unless that's turned off (Settings).
      if (leadsOn) ownAgent(t, `Rocco opened Claude Code for this feature, in lane ${t.lane || 2}`, "I've read the plan. Starting on its first step now; you get each one to test as it's done.");
      break;
    // A card that keeps coming back gets an agent of its own: a worker still on it lets go first (handoff).
    case 'promote':
      if (t.kind === 'plan' || t.kind === 'question') throw new Error(`${id} isn't a card of work.`);
      if (t.lead) throw new Error(`${id} already has an agent of its own.`);
      say('Give it an agent of its own.');
      if (t.status === 'working' || t.status === 'stuck') {
        Object.assign(t, { lead: true, pending: 'handoff' });
        setTimeout(() => { if (t.pending === 'handoff') { t.pending = ''; ownAgent(t, 'Its worker has let go. Rocco opened Claude Code for this card', `I have ${t.title} now. Tell me what's still wrong and we'll work it through here.`); } }, 3000);
      } else ownAgent(t, 'Rocco opened Claude Code for this card', `I have ${t.title} now. Tell me what's still wrong and we'll work it through here.`);
      break;
    case 'make-task':
      if (t.kind !== 'question') throw new Error(`${id} isn't an answered question.`);
      Object.assign(t, { kind: 'note', type: '' }); toConductor(t, 'plan'); say(text || 'Make this a task.');
      break;
    // Stepping in on its worker, as the server does: the demo's conductor "handles" each a few seconds later.
    case 'pause':
      t.held = true; say('Paused.');
      if (t.status === 'working' || t.status === 'stuck') { t.pending = 'stop'; setTimeout(() => { if (t.pending === 'stop') Object.assign(t, { status: 'queued', pending: '', order: nextOrder(), workSince: null, step: '', progress: null }); }, 3000); }
      break;
    case 'resume':
      if (!t.held) throw new Error(`${id} isn't paused.`);
      t.held = false; say('Resumed.');
      if (t.pending === 'stop') t.pending = '';
      else if (t.status === 'queued') { toConductor(t, 'resume'); setTimeout(() => { if (t.pending === 'resume') Object.assign(t, { status: 'working', pending: '', waiting: '', startedAt: new Date().toISOString(), workSince: new Date().toISOString(), step: 'Carrying on' }); }, 3000); }
      break;
    case 'restart':
      t.attempt += 1; t.held = false; t.pending = 'restart'; say(text ? `Start again with a fresh worker: ${text}` : 'Start again with a fresh worker.');
      setTimeout(() => { if (t.pending === 'restart') Object.assign(t, { pending: '', status: 'working', startedAt: new Date().toISOString(), step: 'Starting again', progress: null }); }, 3000);
      break;
    case 'assign': {
      const lane = /lane\s*=\s*(\d+)/i.exec(text || ''), tier = /tier\s*=\s*([a-z]+)/i.exec(text || '');
      if (!lane && !tier) throw new Error('Say which lane or worker: lane=3, tier=heavy.');
      if (tier && !['any', 'heavy', 'standard', 'light'].includes(tier[1].toLowerCase())) throw new Error('A worker is one of: heavy, standard, light.');
      if (lane) t.wantLane = +lane[1] || null;
      if (tier) t.wantTier = tier[1].toLowerCase() === 'any' ? '' : tier[1].toLowerCase();
      say(`Use ${[lane && (+lane[1] ? `lane ${lane[1]}` : 'any lane'), tier && (t.wantTier ? `the ${t.wantTier} worker` : 'any worker')].filter(Boolean).join(', ')}.`);
      if (t.status === 'working' || t.status === 'stuck') { t.pending = 'assign'; setTimeout(() => { if (t.pending === 'assign') Object.assign(t, { pending: '', lane: t.wantLane || t.lane }); }, 3000); }
      break;
    }
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

// A card's agent session (server/sessions.ps1): the camera fix's worker, as Claude Code writes it, a line per entry.
function demoSession() {
  const lines = [], at = m => ago(m);
  const user = (m, content) => lines.push({ type: 'user', timestamp: at(m), message: { role: 'user', content } });
  const said = (m, text) => lines.push({ type: 'assistant', timestamp: at(m), message: { role: 'assistant', content: [{ type: 'text', text }] } });
  let n = 0;
  const tool = (m, name, input, result, error = false) => {
    const id = `toolu_demo${++n}`;
    lines.push({ type: 'assistant', timestamp: at(m), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
    if (result !== undefined) lines.push({ type: 'user', timestamp: at(m - 0.2), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result, is_error: error }] } });
  };
  user(12, 'You are the worker for **T-046: "Camera clips into walls."**\n\nLane 3, branch `agent/camera-clip`. The user\'s note: *camera goes inside the walls in the hallway by the shop*.\n\nRead `docs/workflow/WORKER.md` and `TESTING.md` first. Report on the card as you go: `rocco.ps1 set T-046 -Step "..."`.');
  tool(11.8, 'Bash', { command: 'git -C lanes/lane3 switch -c agent/camera-clip origin/main', description: 'Start the branch in lane 3' }, "Switched to a new branch 'agent/camera-clip'");
  tool(11.5, 'Read', { file_path: 'E:\\Games\\Sample\\lanes\\lane3\\src\\client\\Camera\\Occlusion.luau' }, '1\tlocal Occlusion = {}\n2\t-- Pulls the camera in when a wall is behind the player\n3\tfunction Occlusion.update(camera, head)\n4\t\tlocal back = head.CFrame.LookVector * -1\n…');
  said(10, "Found it. The camera only checks for walls **behind the head**, so in a narrow hallway a wall at the side slips between the camera and you.\n\nThe fix: cast a ray from the head to where the camera wants to be, and pull it in to the first hit.");
  tool(9, 'Edit', { file_path: 'E:\\Games\\Sample\\lanes\\lane3\\src\\client\\Camera\\Occlusion.luau', old_string: 'local back = head.CFrame.LookVector * -1', new_string: 'local toCamera = camera.CFrame.Position - head.Position\nlocal hit = workspace:Raycast(head.Position, toCamera, params)' }, 'The file has been updated.');
  tool(7, 'mcp__Roblox_Studio__start_stop_play', { mode: 'start_play' }, 'Playtest started in DEMO-Lane3');
  tool(6, 'mcp__Roblox_Studio__execute_luau', { code: 'return require(game.ReplicatedStorage.Tests.CameraWalls).run()' }, 'hallway spots: 6\nclipped: 0\nworst gap to wall: 0.4 studs');
  said(4, 'Tested **6 spots** in the hallway by the shop: the camera stays out of the walls in all of them.\n\n| Spot | Before | After |\n|---|---|---|\n| By the shop door | clipped | clear |\n| Corner by the stairs | clipped | clear |');
  tool(3, 'mcp__Roblox_Studio__screen_capture', {}, [{ type: 'text', text: 'Captured the viewport' }]);
  tool(1, 'Bash', { command: 'rocco.ps1 set T-046 -Step "Testing 6 hallway spots" -Progress 70', description: 'Report progress on the card' });
  return lines.map(l => JSON.stringify(l)).join('\n') + '\n';
}

export async function sessions(id) {
  return id === 'T-046' ? [{ key: 'agent-demo', desc: 'Camera clips into walls (T-046)', type: 'roblox-dev-standard', started: ago(12), size: demoSession().length, tasks: 1,
    usage: { in: 72, out: 28924, cacheRead: 2924205, cacheWrite: 97639, messages: 36, model: 'claude-opus-5-5' } }] : [];
}

export async function session(id, key, from) {
  const text = demoSession();
  return from ? { text: '', next: from } : { text, next: text.length };
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

// ---- Your agent, and onboarding (server/agents.ps1, server/onboarding.ps1) ----

const AGENTS = [{ id: 'claude', name: 'Claude Code', short: 'Claude' }, { id: 'codex', name: 'Codex', short: 'Codex' }, { id: 'gemini', name: 'Gemini CLI', short: 'Gemini' }];
let agentId = 'claude';
// Gemini CLI isn't on this sample PC until its Install window has run.
const installed = id => id !== 'gemini' || fixed.has('gemini-update');
// The conductor's model, kept per agent (server/agents.ps1): only Claude Code takes one from Rocco.
const models = {};
// Whether a feature the user approves gets an agent of its own (server/leads.ps1).
let leadsOn = true;
export async function agent() {
  const a = AGENTS.find(x => x.id === agentId), takes = a.id === 'claude';
  return { ...a, installed: installed(a.id), chosen: true, model: models[a.id] || '', takesModel: takes, models: takes ? ['fable', 'opus', 'sonnet', 'haiku', 'opusplan'] : [],
    leads: leadsOn, agents: AGENTS.map(x => ({ ...x, installed: installed(x.id) })) };
}
export async function setLeads(on) { leadsOn = !!on; return agent(); }
export async function setAgent(id) { agentId = id; return agent(); }
export async function setAgentModel(model) {
  if (model && !/^[A-Za-z0-9][\w.:[\]-]{0,79}$/.test(model)) throw new Error("That doesn't look like a model's name (like opus, sonnet, or a full name such as claude-opus-5-5).");
  models[agentId] = model;
  return agent();
}

// Your accounts (server/accounts.ps1): Claude Code is signed in; Codex is installed but signed out until its sign-in window runs.
const PLANS = { claude: 'A Claude Pro or Max plan, or Anthropic API credit', codex: 'A ChatGPT plan, or OpenAI API credit', gemini: 'A Google account (free to start), or a Gemini API key' };
const SIGNED_IN = { claude: 'Signed in as you@example.com (max)', codex: 'Signed in with ChatGPT', gemini: 'Signed in with Google' };
export async function accounts() {
  await new Promise(resolve => setTimeout(resolve, 400));
  const of = id => !installed(id) ? ['missing', 'Not installed'] : id === 'claude' || fixed.has(`${id}-login`) ? ['ok', SIGNED_IN[id]] : ['signin', 'Not signed in'];
  const agents = AGENTS.map(x => {
    const [state, detail] = of(x.id);
    return { ...x, plan: PLANS[x.id], state, detail, chosen: x.id === agentId, install: x.id === 'claude' ? 'claude-install' : `${x.id}-update`, login: `${x.id}-login` };
  });
  const [state, detail] = of('codex');
  return {
    agent: agentId, ready: agents.find(x => x.chosen).state === 'ok', agents,
    images: { state, detail, login: 'codex-login', install: 'codex-update' },
    github: { state: 'ok', detail: 'Signed in as sample-user', login: '' },
    elevenlabs: { linked: !!eleven, hint: eleven || '' }, roblox: { linked: !!robloxKey, hint: robloxKey || '' },
  };
}

// The survey is the template's own, from the Rocco serving the demo.
export async function survey() {
  const res = await fetch('/api/onboarding/survey', { cache: 'no-store' });
  if (!res.ok) throw new Error('Start Rocco to see the onboarding.');
  return res.json();
}
const answersOf = {};
export async function onboarding() { return { survey: await survey(), answers: answersOf[state.project] || { flow: 'new', source: '', answers: {} } }; }
export async function saveAnswers(project, body) {
  const saved = answersOf[project] ??= { flow: body.flow || 'new', source: body.source || '', answers: {} };
  for (const [id, text] of Object.entries(body.answers || {})) { if (String(text).trim()) saved.answers[id] = text; else delete saved.answers[id]; }
  return { saved: true, committed: true, pushed: true, note: '' };
}
export async function startSetup(project, part, tiles) {
  const a = await agent();
  const title = { new: 'Write the first docs from the onboarding answers', existing: 'Bring the game in, and fill in its docs from its code', more: `Fill in more detail: ${tiles.join(', ')}` }[part];
  const t = { id: `T-${next++}`, kind: 'task', type: '', attempt: 1, where: 'main', title, note: title, shots: [], options: [], status: 'working', step: 'Writing the docs',
    startedAt: new Date().toISOString(), log: [{ who: 'conductor', at: new Date().toISOString(), text: `Opened ${a.name} on it.` }] };
  (data[project] ??= seed(project)).tasks.push(t);
  return { task: t.id, opened: a.installed, agent: a.name, prompt: `Follow docs/workflow/SETUP.md, part ${part}, for Workboard task ${t.id}. The answers are in docs/game/ONBOARDING.md.` };
}

// A new project takes a few seconds, then joins the project list.
const jobs = {};
export async function newProject({ name }) {
  if (PROJECTS.some(p => p.id.toLowerCase() === name.toLowerCase())) throw new Error(`There's already a ${name} in this RoDev folder.`);
  const id = `demo${Object.keys(jobs).length}`;
  jobs[id] = { until: Date.now() + 4000, name };
  return { job: id };
}
export async function laneAdvice() { return { pc: 'THIS-PC', memory: 32, threads: 16, cpu: 'Sample 8-Core Processor', perLane: 3, suggested: 7, most: 7, mine: null }; }
export async function openLanes(project, count) {
  const d = (data[project || state.project] ??= seed(project || state.project));
  const id = `lanes${Object.keys(jobs).length}`;
  if (count !== null) d.lanes = { ...d.lanes, count, mine: count };
  jobs[id] = { until: Date.now() + 3000, name: project, lanes: d, count: d.lanes.count };
  return { job: id, saved: { committed: true, pushed: true, note: '' } };
}
export async function openConductor() { const a = await agent(); return { agent: a.name }; }
export async function restartConductor(thread = '') {
  const a = await agent(), d = current();
  setAgentState(d, thread, { state: 'listening', agent: a.name });
  addLine(d, 'event', { text: thread ? 'You restarted its agent' : 'You restarted the conductor' }, 'rocco', thread);
  return { agent: a.name };
}
export async function cancelJob(id) {
  const j = jobs[id], running = !!j && Date.now() < j.until;
  if (running) { j.until = 0; j.stopped = true; }
  return { stopped: running };
}
export async function job(id) {
  const j = jobs[id], running = Date.now() < j.until;
  if (j.stopped) return { running: false, ok: false, project: j.name, output: 'Stopped: you cancelled it.' };
  if (j.lanes) {
    if (!running) j.lanes.lanes = { ...j.lanes.lanes, main: true, open: Array.from({ length: j.count }, (_, i) => i + 1) };
    return { running, ok: !running, project: j.name, output: running ? 'Lane 1: making its checkout' : `Open: Main and ${j.count} lanes.` };
  }
  if (!running && !PROJECTS.some(p => p.id === j.name)) PROJECTS.push({ id: j.name, name: j.name, phase: 'Pitch', template: false });
  return { running, ok: !running, project: j.name, output: running ? 'Copying the template ...' : `${j.name} is ready.` };
}

// The demo "updates" at once: the Rocco row turns up to date, with no restart.
let roccoUpdated = false;
export async function updateRocco() {
  await new Promise(resolve => setTimeout(resolve, 700));
  roccoUpdated = true;
  return { ok: true };
}

export async function history() {
  if (state.project !== 'sample-game') return { repo: '', main: { remote: false, unpushed: 0, total: 1, live: null, commits: [
    { full: 'c0ffee1', hash: 'c0ffee1', author: 'You', at: ago(600), subject: 'Start from the template', merge: false, branch: '', agent: '', pushed: false }] }, branches: [], lanes: [] };
  const commit = (hash, minutes, subject, extra = {}) => {
    const full = hash + '0'.repeat(33);
    return { full, hash, author: 'Sample User', at: ago(minutes), subject, merge: false, branch: '', agent: 'Claude Opus 5.5', pushed: true, release: '', live: false, bookmarked: bookmarks.has(full), ...extra };
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
      commit('8812ab4', 1500, 'Shop: phone layout for item cards', { agent: '', author: 'You', release: `release/${day(1500)}`, live: true }),
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
      // The conductor checking a merge here before it pushes it to main.
      { lane: 4, branch: '', head: 'e4b7a10', dirty: 0, ahead: 1, open: true, events: [ev(1, 'merge', 'Merged origin/agent/swing-sound'), ev(5, 'refresh', 'Back on the latest main'), ev(17, 'commit', 'Shop price labels shrink to fit'), ev(30, 'switch', 'Switched to agent/shop-price-fit')] },
      { lane: 5, branch: 'feature/pet-follow', head: '2f8a9d0', dirty: 0, open: true, events: [ev(9, 'commit', 'Pets teleport to you when 40+ studs behind'), ev(48, 'merge', 'Merged main'), ev(96, 'commit', 'Pets follow on the client'), ev(168, 'switch', 'Switched to feature/pet-follow')] },
      { lane: 6, branch: 'feature/trading', head: '9e3c1aa', dirty: 1, open: true, events: [ev(12, 'commit', 'Trade window: offers and the confirm countdown'), ev(80, 'commit', 'Trade requests'), ev(118, 'switch', 'Switched to feature/trading')] },
      { lane: 7, branch: 'agent/swing-sound', head: '5d0b7e2', dirty: 0, open: true, events: [ev(20, 'commit', 'Sword: swing sound from the sounds registry'), ev(39, 'switch', 'Switched to agent/swing-sound')] },
      { lane: 8, branch: '', head: 'a91f3c2', dirty: 0, open: false, events: [ev(300, 'refresh', 'Back on the latest main')] },
    ],
  };
}

// ---- Docs: a few sample docs per project; saves mirror server/docs.ps1 Save-Doc ----

const md = (...lines) => lines.join('\n') + '\n';
const lf = text => String(text).replace(/\r\n?/g, '\n');
const hashOf = text => [...lf(text)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(16);
const TEMPLATE_OWNED = /^(AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.claude\/|docs\/workflow\/|tools\/)/;
const docData = {};

function sampleDocs() {
  const doc = (text, minutes, subject, extra = {}) => ({ text, at: ago(minutes), by: 'Sample User', subject, ...extra });
  return docData[state.project] ??= {
    'README.md': doc(md('# Sample Game', '', 'A pet-collecting Roblox game made with an AI coding agent, from the RoDev template. What it is: `docs/game/PITCH.md`. Where it stands: `docs/game/PROJECT.md` and `docs/game/ROADMAP.md`.',
      '', '## Working on it', '', '1. **Open your agent** in `repo\\` and say **"refresh"** to sync with GitHub.', '2. **Start Lync:** `tools\\serve-all.bat`.', '3. **Before you stop:** save and close Studio, then say "refresh".'), 2900, 'README.md: work session steps'),
    'CLAUDE.md': doc(md('# Agent rules', '', 'A Roblox game built from the RoDev template. Luau source in `src/` is synced into Studio by Lync. GitHub `origin/main` is the source of truth for code and every text file.',
      '', '## Talking to the user', '', 'Keep replies short: what\'s **done**, and what\'s **flagged**.', '', '## Rules', '', '- Merge, don\'t rebase, into `main`, and pull right before pushing it.',
      '- Code against `docs/game/CONTRACTS.md` and `docs/game/EVENT-CATALOG.md`.', '- New feature: its own spec in `docs/game/features/`.', '', '## Docs', '', '| Read | When |', '|---|---|',
      '| `docs/workflow/WORKFLOW.md` | Starting a phase |', '| `docs/workflow/TESTING.md` | Before using Studio tools |'), 4300, 'CLAUDE.md: short replies'),
    'docs/README.md': doc(md('# docs', '', 'Every doc in the project, by folder. Agents find which to read when in CLAUDE.md "Docs".', '', '## game/: what this game is', '',
      '| Doc | What |', '|---|---|', '| `PITCH.md` | What we\'re making and why it can win |', '| `GDD.md` | The design map |', '| `features/` | One spec per feature |'), 4300, 'docs/README.md: index'),
    'docs/game/PROJECT.md': doc(md('# Sample Game', '', 'This game\'s details. CLAUDE.md imports this file, so every session sees it.', '', '## At a glance', '', '| | |', '|---|---|',
      '| Game | Sample Game |', '| Code | `SG` |', '| Phase | Production |', '| Lanes | 8 |', '', '## Current focus', '', 'Pets that follow you, then trading.'), 1500, 'PROJECT.md: Production phase'),
    'docs/game/PITCH.md': doc(md('# Pitch', '', 'Collect pets on floating islands, raise them, and trade the rare ones. Short sessions, a pet that grows with you, and a reason to come back every day.',
      '', '## Why it can win', '', '- Pet games keep players for months when trading is safe.', '- Every island is a short, clear goal.', '', '## Not doing', '', '- Paid random eggs (PLATFORM-RISKS.md).'), 9000, 'PITCH.md: the pitch'),
    'docs/game/features/pet-evolution.md': doc(md('# Feature: Pet evolution', '', '**Status:** specced.', '', '## Goal', '', 'Pets grow with you: the longer one is out, the stronger and better-looking it gets.', '',
      '## How it plays', '', '1. An equipped pet earns XP as you collect.', '2. At level 10 and 25 it evolves, with an effect and a new model.', '', '## Left out', '', '- Trading evolved pets.', '- A third evolution.', '',
      '## Open questions', '', '- XP only while equipped, or for every pet you own? **Equipped only (proposed).**'), 30, 'Spec: pet evolution'),
    'docs/game/GDD.md': doc(md('# Game design', '', 'The design map: the loop, the systems, and how they feed each other. Each feature has its own spec in `features/`.', '', '## Loop', '',
      'Explore an island, collect coins, hatch pets, upgrade them, unlock the next island.', '', '## Currencies', '', '| Currency | From | Spent on |', '|---|---|---|',
      '| Coins | Collecting, quests | Eggs, upgrades |', '| Gems | Daily reward, events | Cosmetics |', '', '## Systems', '', '- **Pets:** follow you and level up (`docs/game/features/pets.md`).',
      '- **Trading:** player to player, with a confirm countdown (`docs/game/features/trading.md`).', '- **Daily reward:** a streak that resets after a missed day.'), 50, 'GDD.md: currencies table'),
    'docs/game/DECISIONS.md': doc(md('# Decisions', '', 'The user\'s decisions, one dated line each, so they aren\'t reopened.', '', '- 2026-10-02: No paid random eggs. Eggs cost coins only.',
      '- 2026-10-11: Pets evolve at levels 10 and 25.', '- 2026-10-24: Trades need both players to confirm, then a 5 second countdown.'), 600, 'DECISIONS.md: trade countdown'),
    'docs/game/ROADMAP.md': doc(md('# Roadmap', '', 'Milestones to launch, and what\'s now, next and later.', '', '## Now', '', '- [x] Pets follow you', '- [ ] Pet evolution', '- [ ] Trading', '',
      '## Later', '', '- Seasonal islands', '- Guilds'), 180, 'ROADMAP.md: now and later'),
    'docs/game/features/pets.md': doc(md('# Pets', '', 'Pets follow the player, earn XP from collecting, and evolve at levels 10 and 25 with a new look each time.', '', '## How it works', '',
      '1. A hatched pet follows its owner on the client.', '2. Collecting gives the equipped pets XP (server).', '3. At 40+ studs behind, a pet teleports to its owner.', '', '## Done when', '',
      '- Pets keep up on every island.', '- Evolving shows the new model within a second.'), 9, 'pets.md: teleport when far behind'),
    'docs/game/features/trading.md': doc(md('# Trading', '', 'Two players offer pets, both confirm, then a short countdown before the swap, so nobody is rushed into a bad trade.', '', '## Flow', '',
      '1. Send a trade request.', '2. Both players add offers.', '3. Both confirm; a 5 second countdown starts.', '4. Any change cancels the countdown.'), 12, 'trading.md: the confirm countdown', { dirty: true }),
    'docs/workflow/WORKFLOW.md': doc(md('# Workflow', '', 'How we make games: the phases from pitch to live, and the gate at the end of each.', '', '## Phases', '',
      '| Phase | Gate |', '|---|---|', '| Pitch | The user says go on the pitch |', '| Foundation | Lanes, places and the data layer work |', '| Core loop | The loop is fun with programmer art |',
      '| Production | Launch scope is built |'), 4300, 'WORKFLOW.md: phases and gates'),
    'docs/workflow/TESTING.md': doc(md('# Testing', '', 'Studio tools, playtests and measuring. Prove behaviour with numbers; screenshot only to answer "does this look right?".', '', '## Playtests', '',
      '- Mark every playtest you start so it stays silent.', '- Never leave one running.'), 4300, 'TESTING.md: playtests'),
    'live/RELEASES.md': doc(md('# Releases', '', 'Every publish to players, newest first.', '', '| Date | Build | What changed |', '|---|---|---|',
      `| ${ago(1500).slice(0, 10)} | release/${ago(1500).slice(0, 10)} | Shop: phone layout for item cards |`), 1500, 'RELEASES.md: shop phone layout'),
    '.claude/agents/roblox-dev-standard.md': doc(md('---', 'name: roblox-dev-standard', 'description: A worker for routine Roblox tasks in one lane.', '---', '',
      'You build one task in your lane: code in `src/`, tested in your lane\'s place, committed to your `agent/` branch.'), 4300, 'Worker agents'),
  };
}

// What the hover shows, as server/docs.ps1 Get-DocSummary finds it.
function summarize(text) {
  let title = '', inCode = false, inFront = false, done = false;
  const sections = [], para = [];
  lf(text).split('\n').forEach((line, n) => {
    if (n === 0 && line === '---') { inFront = true; return; }
    if (inFront) { if (line === '---') inFront = false; else if (!title && /^name:\s*(.+)$/.test(line)) title = line.replace(/^name:\s*/, '').trim(); return; }
    if (/^\s*(```|~~~)/.test(line)) { inCode = !inCode; if (para.length) done = true; return; }
    if (inCode) return;
    if (!title && /^#\s+/.test(line)) { title = line.replace(/^#\s+/, '').trim(); return; }
    if (/^#{2,3}\s+/.test(line)) { if (sections.length < 8) sections.push(line.replace(/^#+\s+/, '').replace(/`/g, '')); if (para.length) done = true; return; }
    if (done) return;
    if (!line.trim() || /^\s*(\||>|---|<!--|@)/.test(line)) { if (para.length) done = true; return; }
    para.push(line.trim().replace(/^([-*+]|\d+\.)\s+/, ''));
  });
  let preview = para.join(' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
  if (preview.length > 240) preview = preview.slice(0, preview.lastIndexOf(' ', 236)) + '…';
  return { title, preview, sections };
}

const isTemplate = () => !!PROJECTS.find(p => p.id === state.project)?.template;
const docLocked = path => !isTemplate() && TEMPLATE_OWNED.test(path);

export async function docs() {
  return {
    repo: state.project === 'sample-game' ? 'https://github.com/you/sample-game' : '', template: isTemplate(),
    docs: Object.entries(sampleDocs()).map(([path, f]) => ({
      path, ...summarize(f.text), hash: hashOf(f.text), size: f.text.length, dirty: !!f.dirty, locked: docLocked(path), at: f.at, by: f.dirty ? '' : f.by,
    })),
  };
}

export async function doc(path) {
  const f = sampleDocs()[path];
  if (!f) throw new Error(`There's no doc ${path}.`);
  return { path, text: f.text, hash: hashOf(f.text), dirty: !!f.dirty, locked: docLocked(path), last: { at: f.at, by: f.by, subject: f.subject } };
}

export async function saveDoc(path, text, base, message) {
  const f = sampleDocs()[path];
  if (!f) throw new Error(`There's no doc ${path}.`);
  if (docLocked(path)) throw new Error(`${path} belongs to the template, so it changes there, not in a game. Ask your agent to change it.`);
  if (hashOf(f.text) !== base) return { conflict: true, hash: hashOf(f.text) };
  if (lf(text) === lf(f.text)) return { nothing: true };
  await new Promise(resolve => setTimeout(resolve, 700)); // a push takes a moment
  Object.assign(f, { text, at: ago(0), by: 'Sample User', subject: message || `${path.split('/').pop()}: edited in Rocco`, dirty: false });
  return { saved: true, commit: 'd0c5e1a', pushed: true, note: '' };
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

// ---- Live ops: Updates and Thumbnails ----

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const at = (n, h) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
// A sample image: a 16:9 scene in one hue, with a "character" and a "prize", so concepts look like thumbnails.
const scene = h => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'>
  <defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='hsl(${h},70%,64%)'/><stop offset='1' stop-color='hsl(${h + 40},60%,38%)'/></linearGradient></defs>
  <rect width='480' height='270' fill='url(#g)'/><ellipse cx='240' cy='250' rx='300' ry='60' fill='hsl(${h + 90},40%,32%)'/>
  <circle cx='330' cy='120' r='54' fill='hsl(${h + 180},85%,62%)' stroke='white' stroke-width='6'/><rect x='120' y='110' width='70' height='110' rx='18' fill='hsl(${h + 200},40%,28%)'/>
  <circle cx='155' cy='92' r='30' fill='hsl(${h + 20},50%,80%)'/></svg>`);

const liveOps = {};
const ops = () => (liveOps[state.project] ??= {
  lead: 14,
  cards: [
    { id: 'pet-evolution', title: 'Pet evolution', date: day(5), time: '17:00', kind: 'Update', notes: 'Pets earn XP while equipped and evolve at level 10 and 25, with a new look each time.', event: 'drafted', eventId: '9001', task: '', image: '', candidates: ['events/pet-evolution/card-01.png', 'events/pet-evolution/card-02.png', 'events/pet-evolution/card-03.png'] },
    { id: 'halloween-hunt', title: 'Halloween egg hunt', date: day(12), time: '', kind: 'Live event', notes: 'Hidden pumpkins across the islands for a week; a spooky pet for finding all 20.', event: 'queued', task: 'T-047', candidates: [] },
    { id: 'trading-plaza', title: 'Trading plaza', date: day(26), time: '', kind: 'Update', notes: 'A plaza where players trade pets safely, with a confirm step and a countdown.', event: 'notyet', candidates: [] },
    { id: 'summer-sale', title: 'Summer sale', date: day(-20), time: '', kind: 'Timed release', notes: '', event: 'over', candidates: [] },
  ],
  events: [
    { id: '9000', title: 'Double coins weekend!', subtitle: '', start: at(-1, 15), end: at(2, 15), visibility: 'public', image: scene(42), interested: 1840, url: '#' },
    { id: '9001', title: 'Your pets can EVOLVE!', subtitle: 'Level them up', start: at(5, 17), end: at(12, 17), visibility: 'private', image: scene(280), url: '#' },
  ],
});
const cardState = c => {
  const e = ops().events.find(x => x.id === c.eventId);
  if (!e) return c.event;
  return e.visibility !== 'public' ? 'drafted' : new Date(e.start) > new Date() ? 'scheduled' : 'live';
};
export async function updates() {
  const o = ops();
  return { file: 'live/CALENDAR.md', exists: true, lead: o.lead, cards: o.cards.map(c => ({ ...c, event: cardState(c), onRoblox: !!o.events.find(x => x.id === c.eventId) })),
    roblox: { universe: '4790265012', linked: !!robloxKey, loading: false, source: robloxKey ? 'cloud' : 'public', access: robloxKey ? 'ok' : '', error: '',
      events: o.events.filter(e => robloxKey || e.visibility === 'public') }, auto: null };
}
export async function saveUpdate(card) {
  const o = ops();
  if (!card.title.trim()) throw new Error('Give the update a name.');
  if (!card.date) throw new Error('Give the update a date.');
  let c = o.cards.find(x => x.id === card.id);
  if (!c) { c = { id: card.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'update', event: 'notyet', candidates: [] }; o.cards.push(c); }
  Object.assign(c, { title: card.title.trim(), date: card.date, time: card.time, kind: card.kind, notes: card.notes.trim() });
  if (!card.announce) c.event = 'none'; else if (c.event === 'none') c.event = 'notyet';
  o.cards.sort((a, b) => a.date.localeCompare(b.date));
  return { id: c.id, saved: { committed: true, pushed: true, note: '' } };
}
export async function removeUpdate(id) { const o = ops(); o.cards = o.cards.filter(c => c.id !== id); return { saved: {} }; }
export async function queueUpdateEvent(id) {
  const c = ops().cards.find(x => x.id === id);
  const t = { id: `T-${next++}`, kind: 'task', type: '', attempt: 1, where: 'main', title: `Game page event: ${c.title}`, note: `Make the game page event for ${c.title}.`, shots: [], options: [], log: [] };
  toConductor(t, 'plan');
  current().tasks.push(t);
  Object.assign(c, { event: 'queued', task: t.id });
  return { queued: [{ id, title: c.title, task: t.id }] };
}
export async function setUpdateLead(days) { ops().lead = days; return { saved: {} }; }
export async function pickCardImage(id, image) { ops().cards.find(x => x.id === id).image = '../art/generated/' + image; return { saved: {} }; }
export async function publishEvent(eventId) {
  const e = ops().events.find(x => x.id === eventId);
  if (!e) throw new Error('Not an event id.');
  e.visibility = 'public';
  return { published: true };
}

const DIRECTIONS = [
  { id: 'evolution-moment', name: 'The evolution moment', why: 'Thumbnail 2 (a pet mid-glow) gets the best play-through: lean into the transformation, the game\'s newest hook.', prompt: 'Roblox game thumbnail for Pet Islands: a small pet bursting into its evolved form in a swirl of light, a delighted player character beside it. Bright pastel colours, chunky low-poly style, no text. Wide 16:9, subject centred.' },
  { id: 'island-overview', name: 'Islands from above', why: 'Players ask where they can go: show the floating islands and their variety in one shot.', prompt: 'Roblox game thumbnail for Pet Islands: a sweeping view of colourful floating islands linked by bridges, pets everywhere, a player character waving in the foreground. Bright pastel colours, chunky low-poly style, no text. Wide 16:9.' },
  { id: 'rare-pet', name: 'The rarest pet', why: 'The legendary pet is the most shared screenshot in the community: make it huge.', prompt: 'Roblox game thumbnail for Pet Islands: a giant glowing legendary dragon pet in the centre, sparkles around it, an amazed player character looking up. Bright pastel colours, chunky low-poly style, no text. Wide 16:9.' },
];
const thumbOps = {};
const thumbs = () => (thumbOps[state.project] ??= {
  run: null,
  concepts: [
    { file: 'thumbnails/rare-pet/rare-pet-01.png', direction: 'The rarest pet', created: ago(60 * 26), prompt: DIRECTIONS[2].prompt, status: 'candidate', task: '' },
    { file: 'thumbnails/rare-pet/rare-pet-02.png', direction: 'The rarest pet', created: ago(60 * 26), prompt: DIRECTIONS[2].prompt, status: 'picked', task: 'T-044' },
  ],
});
export async function thumbnails() {
  const t = thumbs();
  // Codex "finishes" a few seconds after the click.
  if (t.run?.running && Date.now() - t.run.at > 4000) {
    const d = DIRECTIONS.find(x => x.name === t.run.direction);
    for (let i = 1; i <= t.run.count; i++) t.concepts.unshift({ file: `thumbnails/${d.id}/${d.id}-0${i}.png`, direction: d.name, created: ago(0), prompt: d.prompt, status: 'candidate', task: '' });
    t.run = { ...t.run, running: false, done: t.run.count };
  }
  const linked = !!robloxKey;
  const shots = [
    { id: '1501', rank: 1, approved: true, image: scene(200), stats: { impressions: 48200, plays: 1350, ptr: 0.028 } },
    { id: '1502', rank: 2, approved: true, image: scene(300), stats: { impressions: 47100, plays: 2120, ptr: 0.045 } },
    { id: '1503', rank: 3, approved: true, image: scene(120), stats: { impressions: 46400, plays: 1490, ptr: 0.032 } },
  ].map(s => linked ? s : { ...s, stats: undefined });
  return {
    page: { universe: '4790265012', linked, loading: false, error: '', statsError: '', access: linked ? 'ok' : '', days: 7, thumbnails: shots, other: [] },
    hints: linked ? ['Thumbnail 2 turns 4.5% of impressions into qualified plays; thumbnail 1 only 2.8%. Try a new direction in place of 1, and put 2 first.']
      : ['Link your Roblox Open Cloud key in Connections to see how each thumbnail does: impressions and qualified play-through.'],
    directions: DIRECTIONS.map(d => ({ ...d, starter: false })), ownDirections: true, concepts: t.concepts, run: t.run, codex: true,
  };
}
export async function makeConcepts(direction, count) {
  const t = thumbs();
  const d = DIRECTIONS.find(x => x.id === direction);
  t.run = { running: true, direction: d.name, count, done: 0, started: ago(0), error: '', at: Date.now() };
  return t.run;
}
export async function cancelConcepts() {
  const t = thumbs();
  if (t.run?.running) t.run = { ...t.run, running: false, error: 'Stopped.' };
  return t.run;
}
export async function useConcept(file) {
  const c = thumbs().concepts.find(x => x.file === file);
  const t = { id: `T-${next++}`, kind: 'task', type: '', attempt: 1, where: 'main', title: `Thumbnail: put ${file.split('/').pop()} on the game page`, note: 'The user picked it.', shots: [], options: [], log: [] };
  toConductor(t, 'plan');
  current().tasks.push(t);
  Object.assign(c, { status: 'picked', task: t.id });
  return { task: t.id };
}
export async function askDirections() {
  const t = { id: `T-${next++}`, kind: 'task', type: '', attempt: 1, where: 'main', title: 'Thumbnail directions', note: 'Suggest directions.', shots: [], options: [], log: [] };
  toConductor(t, 'plan');
  current().tasks.push(t);
  return { task: t.id };
}
// Sample images for concepts and event cards: one hue per name.
export function artFile(rel) {
  return scene([...rel].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 7));
}
