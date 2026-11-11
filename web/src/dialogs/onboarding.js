// Onboarding: every game starts here, new or already made. A short survey, one question at a time; the answers go to
// docs/game/ONBOARDING.md and the user's agent turns them into the first docs (the template's SETUP.md). Tiles add more
// detail, now or later (Docs, "Add game details"). The questions are the template's tools/onboarding.json, so they
// change with the docs they fill. A survey in progress is kept in this browser until it's finished.
// Before the first one, the accounts screen: RoDev runs on the user's own AI plans, so it checks each one on this PC and
// signs in from there. A new game then asks how many lanes this PC can run: finishing opens them (the Main place and each
// lane's, in Studio, with Lync syncing each) while the agent writes the docs and plans the first build, which the user
// approves on the Workboard before anything is built. The lanes screen also opens on its own, from the sidebar.
import { state, currentProject } from '../state.js';
import { $ } from '../lib/dom.js';
import { html, render, nothing, keyed, live, ifDefined } from '../lib/html.js';
import { icon, lineIcon } from '../lib/icons.js';
import { storage } from '../lib/storage.js';
import { api, DEMO } from '../api.js';
import { toast } from '../ui/toast.js';
import { loadProjects, switchProject } from '../projects.js';
import { go } from '../router.js';
import { agentName } from '../agent.js';
import { LINKS } from '../views/connections.js';
import { loadAccounts, yourAgent, notReady, runAccountAction, useAgent, accRow, agentRow, fixButtons, windowButton, imagesNeed } from '../accounts.js';

const root = $('#onboarding');
const DRAFT = 'rocco.onboarding';
const SEEN = 'rocco.accounts'; // the accounts screen was shown in this browser: after that, the survey starts at its first choice
const KINDS = [
  ['github', 'On GitHub', 'https://github.com/you/game.git', 'Its repo comes along with its history; the template is merged into it.'],
  ['folder', 'In a folder', 'D:\\Games\\MyGame', 'A git folder comes along with its history; any other folder is copied in for your agent to sort.'],
  ['place', 'In a place file', 'D:\\Places\\MyGame.rbxl', 'The place is copied into the project (and backed up); your agent exports its scripts.'],
  ['studio', 'Only in Studio', '', 'Open it in Studio when your agent asks: it exports the scripts from there.'],
];
const CLOSE = lineIcon('<path d="M6 6l12 12M18 6L6 18"/>', 16, 2);
const SPIN = html`<span class="spin"></span>`;
const CTRL_ENTER = html` <kbd>Ctrl</kbd><kbd>Enter</kbd>`;
let ob = null;     // the survey in progress: { mode, screen, flow, basics, answers, index, tile, job, project, setup, saved, unsent, error,
                   //   advice (this PC, for lanes), laneCount, lanesJob }
let survey = null; // tools/onboarding.json
let busy = false;
let checking = false;      // the accounts are being checked (state.accounts, accounts.js)
let linking = '';          // the account whose key field is open: elevenlabs or roblox
let keyDraft = '';         // what's typed in it, kept across re-renders

export const onboardingOpen = () => root.classList.contains('open');

const questions = () => survey.flows[ob.flow].steps.flatMap(step => step.questions.map(q => ({ ...q, step: step.title })));
const answered = id => !!(ob.answers[id] || '').trim();
const tileFilled = t => t.questions.some(q => answered(q.id));
function saveDraft() { if (ob?.mode === 'start') storage.set(DRAFT, JSON.stringify({ ...ob, unsent: [] })); }
function readDraft() { try { return JSON.parse(storage.get(DRAFT) || 'null'); } catch { return null; } }

// ---- Opening ----

// A new game or one brought in. A survey left half-way is picked up where it was.
export async function openOnboarding({ fresh = false } = {}) {
  try { survey = await api.survey(); } catch (e) { toast(`Couldn't load the onboarding: ${e.message}`, 'var(--red)'); return; }
  const saved = fresh ? null : readDraft();
  ob = saved ? { ...saved, unsent: new Set() } : { mode: 'start', screen: storage.get(SEEN) ? 'start' : 'accounts', flow: 'new', basics: { name: '', code: '', repo: '', kind: 'github', from: '' }, answers: {}, index: 0, unsent: new Set() };
  root.classList.add('open');
  draw();
  if (ob.job?.state === 'making') poll();
  checkAccounts(false);
}

// How many lanes this PC opens for the open project, on its own (the sidebar). Finishing opens them.
export function openLanesDialog() {
  ob = { mode: 'lanes', screen: 'lanes', project: state.project, laneCount: null, unsent: new Set() };
  root.classList.add('open');
  draw();
  loadAdvice(state.project);
}

// The accounts screen on its own (Settings, "Your accounts").
export function openAccounts() {
  ob = { mode: 'accounts', screen: 'accounts', unsent: new Set() };
  root.classList.add('open');
  draw();
  checkAccounts(true);
}

// More detail for the open project: just the tiles, with what's been answered so far.
export async function openDetails() {
  try {
    const data = await api.onboarding();
    survey = data.survey;
    ob = { mode: 'tiles', screen: 'tiles', flow: data.answers.flow || 'new', answers: { ...data.answers.answers }, project: state.project, unsent: new Set() };
  } catch (e) { toast(`Couldn't load the onboarding: ${e.message}`, 'var(--red)'); return; }
  root.classList.add('open');
  draw();
}

export function closeOnboarding() {
  root.classList.remove('open');
  linking = ''; keyDraft = '';
  if (ob?.mode === 'start' && !['start', 'accounts'].includes(ob.screen)) toast('Your answers are kept: New project picks up where you left off', 'var(--gray)');
}

// First run: no games in the RoDev folder yet. The Workboard offers the onboarding, and it opens once by itself.
export function renderFirstGame() {
  const none = !DEMO && state.projects.length > 0 && state.projects.every(p => p.template);
  $('#firstGame').hidden = !none;
  if (none && !storage.get('rocco.onboarded')) { storage.set('rocco.onboarded', 'shown'); openOnboarding(); }
}

// ---- Screens ----
// Each is a template. Labels and button text are plain text, or a template where they carry a spinner or keys.

function top(label, progress) {
  return html`<div class="ob-top"><span class="ob-label">${label}</span>${
    progress !== undefined ? html`<span class="ob-progress"><i style="width:${Math.round(progress * 100)}%"></i></span>` : html`<span class="sp"></span>`}${
    ob.mode === 'start' && !['start', 'accounts'].includes(ob.screen) && !ob.setup ? html`<button class="mini" data-ob="restart">Start over</button>` : nothing
  }<button class="icon-btn" data-ob="close" aria-label="Close">${CLOSE}</button></div>`;
}

const foot = (left, right) => html`<div class="ob-foot">${left || nothing}<span class="sp"></span>${right || nothing}</div>`;
const button = (action, label, cls = 'btn', disabled = false) => html`<button class=${cls} data-ob=${action} ?disabled=${disabled}>${label}</button>`;

// ---- Your accounts ----

// Nothing is included: each AI tool runs on the user's own plan, signed in on this PC. Each row says what it needs and
// whether it's ready, with the tool's own install or sign-in one click away (accounts.js).
async function checkAccounts(refresh) {
  checking = true;
  if (ob?.screen === 'accounts') draw();
  await loadAccounts(refresh);
  checking = false;
  redrawAccounts();
}

function redrawAccounts() { if (onboardingOpen() && ['accounts', 'start', 'review'].includes(ob?.screen)) draw(); }

// ElevenLabs and Roblox: a key the user makes on the service's site and pastes here (the same link as in Connections).
function keyRow(service, need) {
  const l = LINKS[service], k = state.accounts[service];
  const form = linking === service ? html`<div class="acc-form"><p class="acc-why">${l.why}</p><div class="link-form"><input class="input" id="accKey" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your ${l.name} API key" .value=${live(keyDraft)}><button class="btn accent" data-ob="acc-save:${service}" ?disabled=${busy}>${
    busy ? html`${SPIN}Checking` : 'Link'}</button></div><div class="link-help">Make a key at <a href=${l.keys} target="_blank" rel="noreferrer">${new URL(l.keys).host}</a>. ${l.where}</div></div>` : nothing;
  return accRow({ name: l.name, need, tone: k.linked ? 'ok' : 'off', detail: k.linked ? `Linked, with the key ending ${k.hint}` : 'Not linked',
    buttons: k.linked ? nothing : html`<button class="btn-sm" data-ob="acc-link:${service}">${linking === service ? 'Cancel' : 'Link'}</button>`, form });
}

function accounts() {
  const alone = ob.mode === 'accounts', a = state.accounts;
  const section = (title, sub, rows) => html`<div class="acc-sec"><div class="acc-sec-head"><b>${title}</b><span>${sub}</span></div>${rows}</div>`;
  const intro = html`<h2 class="ob-title">Your accounts</h2><p class="ob-lede">RoDev runs on your own accounts: no AI plan comes with it, and nothing is shared. Each tool below uses your own plan, signed in on this PC, and what it does counts against that plan. Sign in here; Rocco checks again when you come back.</p>`;
  const next = button('acc-continue', alone ? 'Done' : !a || a.ready ? 'Continue' : 'Continue anyway', 'btn accent');
  const head = top(alone ? 'Your accounts' : 'Before you start');
  if (!a) return html`${head}<div class="ob-body">${intro}<div class="ob-status">${SPIN}<span>Checking this PC…</span></div></div>${foot(nothing, next)}`;
  const mine = yourAgent(), images = { ...a.images, name: 'Codex' };
  return html`${head}<div class="ob-body">${intro}${
    section('A coding agent', 'Needed. One is enough: it plans, builds and keeps the docs, in your name.', a.agents.map(agentRow))}${
    mine && !a.ready ? html`<div class="ob-status warn">${icon.alert}<span>${mine.name} ${notReady(mine)} yet. You can still go on: the game is made, and its setup waits in Up next until your agent is ready.</span></div>` : nothing}${
    section('Images', 'Recommended. Without it, this PC can\'t make art.',
      accRow({ name: 'Codex', need: imagesNeed(), tone: images.state === 'ok' ? 'ok' : 'warn', detail: images.detail, buttons: fixButtons(images) }))}${
    section('Later, when you need them', 'Optional. Each can be linked any time in Connections.', html`${
      accRow({ name: 'GitHub', need: 'Your own account: where each game\'s code is kept, and how your PCs share it.', tone: a.github.state === 'ok' ? 'ok' : 'off', detail: a.github.detail,
        buttons: a.github.login ? windowButton(a.github.login, 'Sign in', 'btn-sm go') : nothing })}${
      keyRow('elevenlabs', 'Sound effects and music. Game audio needs a paid plan (Starter or above).')}${
      keyRow('roblox', 'The game page: events, thumbnails and how each one does. Once the game is on Roblox.')}`)
  }</div>${foot(button('acc-check', checking ? html`${SPIN}Checking` : 'Check again', 'btn ghost-btn', checking), next)}`;
}

async function linkKey(service) {
  const key = keyDraft.trim();
  if (!key) { root.querySelector('#accKey')?.focus(); return; }
  if (busy) return;
  busy = true;
  draw();
  try {
    const { tier, note } = await api.link(service, key);
    toast(note || `${LINKS[service].name} linked${tier ? ` · ${tier[0].toUpperCase()}${tier.slice(1)} plan` : ''}`, note && !note.startsWith('Linked.') ? 'var(--amber)' : undefined);
    linking = ''; keyDraft = '';
    busy = false;
    await checkAccounts(true);
  } catch (e) {
    busy = false;
    draw();
    toast(e.message, 'var(--red)');
  }
}

function start() {
  const choice = (flow, title, text) => html`<button class="ob-choice" data-ob="flow:${flow}"><b>${title}</b><span>${text}</span></button>`;
  const mine = yourAgent();
  return html`${top('New project')}<div class="ob-body"><h2 class="ob-title">What are you starting?</h2><p class="ob-lede">A few questions about the game, one at a time. Answer as much or as little as you like: your agent (${agentName()}) turns the answers into the first docs.</p><div class="ob-choices">${
    choice('new', 'A new game', survey.flows.new.blurb)}${choice('existing', 'A game I\'ve already made', survey.flows.existing.blurb)}</div>${
    mine && !state.accounts.ready ? html`<div class="ob-status warn">${icon.alert}<span>${mine.name} ${notReady(mine)} on this PC, so it can't write the docs yet.</span>${button('accounts', 'Sort it out', 'btn-sm go')}</div>` : nothing
  }</div>${foot(button('accounts', 'Your accounts', 'btn ghost-btn'), nothing)}`;
}

function basics() {
  const b = ob.basics, existing = ob.flow === 'existing';
  const kind = KINDS.find(k => k[0] === b.kind) || KINDS[0];
  // Once the project is being made, these are fixed: Start over changes them.
  const locked = !!ob.job && ob.job.state !== 'failed';
  const field = (id, label, value, placeholder, maxlength) => html`<label class="lbl">${label}<input class="input" data-field=${id} .value=${live(value)} placeholder=${placeholder} autocomplete="off" spellcheck="false" maxlength=${ifDefined(maxlength)} ?disabled=${locked}></label>`;
  return html`${top(existing ? 'Bring in a game' : 'A new game', 0)}<div class="ob-body"><h2 class="ob-title">${existing ? 'Which game?' : 'Name it'}</h2><p class="ob-lede">${
    existing ? 'Its name in this RoDev folder, and where it is now.' : 'You can change the name players see later; this one names its folder.'}</p><div class="ob-fields"><div class="two">${
    field('name', 'Name', b.name, existing ? 'MyGame' : 'SkyFarm')}${field('code', html`Code <small>2 to 4 letters, for its place files</small>`, b.code, 'SF', 4)}</div>${
    existing ? html`<div class="lbl">Where is it?<div class="ob-kinds">${KINDS.map(([id, label]) => html`<button class="ob-kind${b.kind === id ? ' on' : ''}" data-ob="kind:${id}" ?disabled=${locked}>${label}</button>`)}</div><span class="ob-note">${kind[3]}</span></div>${
      kind[2] ? field('from', b.kind === 'github' ? 'Its GitHub repo' : b.kind === 'folder' ? 'The folder' : 'The place file', b.from, kind[2]) : nothing}` : nothing}${
    !existing || b.kind !== 'github' ? field('repo', html`A new GitHub repo <small>optional: an empty private one, to back the game up</small>`, b.repo, 'https://github.com/you/game.git') : nothing
  }</div>${locked ? html`<div class="ob-note">The project is already being made with these. Start over to change them.</div>` : nothing}${
    ob.error ? html`<div class="ob-status err">${icon.alert}<span>${ob.error}</span></div>` : nothing
  }</div>${foot(button('back', 'Back'), button('basics-next', busy ? html`${SPIN}Starting` : 'Next', 'btn accent', busy))}`;
}

function question() {
  const list = questions(), q = list[ob.index];
  const value = ob.answers[q.id] || '';
  return html`${top(html`${q.step} <span class="ob-count">${ob.index + 1} of ${list.length}</span>`, (ob.index + 1) / (list.length + 1))}<div class="ob-body"><h2 class="ob-title">${q.prompt}</h2>${
    q.hint ? html`<p class="ob-lede">${q.hint}</p>` : nothing
  }<textarea class="field ob-text" id="obText" placeholder=${q.placeholder || 'As much or as little as you like'} aria-label=${q.prompt} .value=${live(value)}></textarea><div class="ob-for">Goes into ${(q.for || []).join(', ')}</div></div>${
    foot(button('back', 'Back'), ob.editing ? button('next', html`Done${CTRL_ENTER}`, 'btn accent')
      : html`${value.trim() ? nothing : button('skip', 'Skip', 'btn ghost-btn')}${button('next', html`Next${CTRL_ENTER}`, 'btn accent')}`)}`;
}

// ---- Lanes: how many this PC opens ----

async function loadAdvice(project) {
  try { ob.advice = await api.laneAdvice(project); } catch (e) { ob.advice = { error: e.message }; }
  if (ob.laneCount == null && !ob.advice.error) ob.laneCount = ob.advice.mine ?? ob.advice.suggested;
  saveDraft();
  if (onboardingOpen() && ob.screen === 'lanes') draw();
}

const lanesText = n => n ? `${n} lane${n === 1 ? '' : 's'}` : 'no lanes';

function lanes() {
  const a = ob.advice, alone = ob.mode === 'lanes', total = alone ? 0 : questions().length;
  const head = alone ? top('Lanes on this PC') : top('Lanes', (total + 0.5) / (total + 1));
  const title = html`<h2 class="ob-title">How many lanes can this PC run?</h2>`;
  const next = alone ? button('lanes-open', busy ? html`${SPIN}Opening` : 'Open them', 'btn accent', busy || !a || !!a.error)
    : button('lanes-next', ob.editing ? 'Done' : 'Next', 'btn accent', !a);
  const back = alone ? button('close', 'Cancel') : button('back', 'Back');
  if (!a) return html`${head}<div class="ob-body">${title}<div class="ob-status">${SPIN}<span>Checking this PC…</span></div></div>${foot(back, next)}`;
  if (a.error) return html`${head}<div class="ob-body">${title}<div class="ob-status err">${icon.alert}<span>${a.error}</span></div></div>${foot(back, alone ? nothing : button('lanes-next', 'Skip', 'btn'))}`;
  const pick = ob.laneCount ?? a.suggested;
  return html`${head}<div class="ob-body">${title}<p class="ob-lede">A lane is a worker's own copy of the game, with its own Studio place, so several workers build and test at the same time. Each one is a Studio window, so how many depends on this PC.</p><div class="ob-pc"><b>${a.pc}</b><span>${a.memory} GB memory · ${a.threads} threads · ${a.cpu}</span></div><div class="ob-kinds ob-lanes">${
    Array.from({ length: a.most + 1 }, (_, i) => html`<button class="ob-kind ob-lane${pick === i ? ' on' : ''}${a.suggested === i ? ' suggested' : ''}" data-ob="lanes-count:${i}" title=${i === a.suggested ? 'Suggested for this PC' : lanesText(i)}>${i || 'None'}</button>`)
  }</div><p class="ob-note">Suggested: ${a.suggested}, at about ${a.perLane} GB a lane, with room for the Main place and your other apps. More lanes build faster, and use your agent's plan faster.${pick === 0 ? ' With none, your agent builds alone, in the Main place.' : ''}</p><p class="ob-note">${
    alone ? 'Rocco opens them now' : 'When you finish, Rocco opens them'}: the Main place and ${pick ? `${lanesText(pick)}, each` : 'its'} in Studio, with Lync syncing ${pick ? 'each one' : 'it'}. Change the number any time from Lanes in the sidebar.</p></div>${foot(back, next)}`;
}

// From the sidebar: record this PC's number, and open them in the background.
async function openLanesNow() {
  if (busy) return;
  busy = true;
  draw();
  try {
    const r = await api.openLanes(ob.project, ob.laneCount);
    busy = false;
    closeOnboarding();
    toast(`Opening ${lanesText(ob.laneCount)} and the Main place: Lync starts in the background, and Studio opens each place${r.saved?.note ? `. ${r.saved.note}` : ''}`, 'var(--cyan)');
  } catch (e) {
    busy = false;
    draw();
    toast(`Couldn't open them: ${e.message}`, 'var(--red)');
  }
}

async function pollLanes() {
  const id = ob.lanesJob?.id;
  while (ob?.lanesJob?.id === id && ob.lanesJob.state === 'opening') {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const s = await api.job(id);
      if (ob?.lanesJob?.id !== id) return;
      Object.assign(ob.lanesJob, { output: s.output || '', state: s.running ? 'opening' : s.ok ? 'open' : 'failed' });
      if (onboardingOpen() && ob.screen === 'tiles') draw();
    } catch { /* Rocco restarting: ask again */ }
  }
}

function lanesJob() {
  const j = ob.lanesJob;
  if (!j) return nothing;
  const last = (j.output || '').trim().split('\n').at(-1) || 'Starting';
  if (j.state === 'opening') return html`<div class="ob-result">${SPIN}<span>Opening the Main place and ${lanesText(ob.laneCount)}: ${last}</span><button class="linkish" data-ob="cancel-job:${j.id}">Stop</button></div>`;
  if (j.state === 'open') return html`<div class="ob-result">${icon.checkSm}<span>${last}</span></div>`;
  return html`<div class="ob-result">${icon.alert}<span>Opening the lanes didn't finish: ${j.error || last}. Lanes in the sidebar tries again.</span></div>`;
}

function job() {
  const j = ob.job;
  if (!j) return nothing;
  if (j.state === 'making') return html`<div class="ob-status">${SPIN}<span>Making ${ob.basics.name}…</span><button class="linkish" data-ob="cancel-job:${j.id}">Stop</button></div>`;
  if (j.state === 'ready') return html`<div class="ob-status ok">${icon.checkSm}<span>${ob.basics.name} is ready in the RoDev folder.</span></div>`;
  return html`<div class="ob-status err">${icon.alert}<span>Making the project didn't work. Fix what it says, then go back to the name.</span></div><pre class="m-log err">${j.output || ''}</pre>`;
}

function review() {
  const list = questions();
  const filled = list.filter(q => answered(q.id)).length;
  const agent = state.agent;
  const building = ob.flow === 'new' ? ', then plans the first build. The plan waits on the Workboard for your OK before anything is built' : '';
  const handoff = !agent?.installed ? `${agentName()} isn't installed on this PC, so the job waits in Up next for whichever agent you open.`
    : state.accounts && !state.accounts.ready ? `${agent.name} starts, minimized in your taskbar. It isn't signed in yet, so it asks you to first, then writes the docs from your answers${building}.`
    : `${agent.name} starts, minimized in your taskbar, and writes the docs from your answers${building}.`;
  return html`${top('Ready', 1)}<div class="ob-body"><h2 class="ob-title">Ready to start?</h2><p class="ob-lede">${filled} of ${list.length} answered. ${handoff} Click any answer to change it.</p><div class="ob-review">${
    list.map((q, i) => html`<button class="ob-rev" data-ob="goto:${i}"><small>${q.step}</small><span class="q">${q.prompt}</span><span class="a${answered(q.id) ? '' : ' skipped'}">${answered(q.id) ? ob.answers[q.id] : 'Skipped'}</span></button>`)}${
    ob.flow === 'new' ? html`<button class="ob-rev" data-ob="goto-lanes"><small>Lanes</small><span class="q">How many lanes can this PC run?</span><span class="a">${ob.laneCount == null ? 'Not picked' : `${lanesText(ob.laneCount)}, opened with the Main place when you finish`}</span></button>` : nothing
  }</div>${job()}</div>${foot(button('back', 'Back'), button('finish', busy ? html`${SPIN}Starting` : ob.flow === 'new' ? 'Start' : 'Save and start setup', 'btn accent', busy || ob.job?.state !== 'ready'))}`;
}

function setup() {
  const s = ob.setup, saved = ob.saved;
  if (!s) return nothing;
  const done = text => html`<div class="ob-result">${icon.checkSm}<span>${text}</span></div>`;
  const work = ob.flow === 'new' ? 'writing the docs, then a plan for the first build that you approve on the Workboard' : 'writing the docs';
  return html`<div class="ob-results">${done(`${currentProjectName()} is set up in the RoDev folder.`)}${
    done(html`Your answers are in <code>docs/game/ONBOARDING.md</code>${saved?.pushed ? ', pushed to GitHub' : ''}.${saved?.note ? html` <span class="ob-note">${saved.note}</span>` : nothing}`)}${lanesJob()}${
    s.opened ? done(`${s.agent} is ${work}, minimized in your taskbar. Follow it on the Workboard (${s.task}).`)
      : s.running ? done(`${s.task} is on the Workboard for the ${s.agent} session that's already running.`)
      : html`<div class="ob-result">${icon.alert}<span>${s.task} is in Up next for your agent. To start it now, give your agent this:</span></div><div class="ob-prompt"><code>${s.prompt}</code><button class="copy" data-copy=${s.prompt}>${icon.copy}Copy</button></div>`}</div>`;
}

const currentProjectName = () => ob.basics?.name || currentProject().name;

function tiles() {
  const after = ob.mode === 'done';
  const sendable = ob.unsent.size > 0;
  return html`${top(after ? 'All set' : `More detail for ${currentProject().name}`)}<div class="ob-body">${
    after ? html`<h2 class="ob-title">All set</h2>${setup()}<h3 class="ob-sub">Want to add more?</h3>` : html`<h2 class="ob-title">Add game details</h2>`
  }<p class="ob-lede">Optional. Pick any of these and write as much or as little as you like. Rocco files each into its doc.</p><div class="ob-tiles">${
    survey.tiles.map(t => html`<button class="ob-tile${tileFilled(t) ? ' filled' : ''}" data-ob="tile:${t.id}"><span class="ob-tile-head"><b>${t.title}</b>${tileFilled(t) ? icon.checkSm : nothing}</span><span>${t.blurb}</span></button>`)
  }</div></div>${foot(sendable ? html`<span class="ob-note">${ob.unsent.size} saved, not sent to Rocco yet</span>` : nothing,
    html`${button('send', busy ? html`${SPIN}Sending` : 'Send to Rocco', 'btn', busy || !sendable)}${button('done', 'Done', 'btn accent')}`)}`;
}

function tile() {
  const t = survey.tiles.find(x => x.id === ob.tile);
  // The boxes start from what's saved and are then the user's, until Save reads them.
  return html`${top(t.title)}<div class="ob-body"><h2 class="ob-title">${t.title}</h2><p class="ob-lede">${t.blurb}</p>${
    t.questions.map(q => html`<label class="ob-tq"><span class="ob-tq-prompt">${q.prompt}</span>${q.hint ? html`<span class="ob-note">${q.hint}</span>` : nothing}<textarea class="field ob-text sm" data-answer=${q.id} placeholder="As much or as little as you like" .value=${ob.answers[q.id] || ''}></textarea></label>`)
  }</div>${foot(button('tiles', 'Back'), button('save-tile', busy ? html`${SPIN}Saving` : 'Save', 'btn accent', busy))}`;
}

const SCREENS = { accounts, start, basics, question, lanes, review, tiles, tile };
// What makes a screen a different one: each question and each tile starts from fresh fields.
const screenKey = () => `${ob.screen}:${ob.screen === 'question' ? ob.index : ob.screen === 'tile' ? ob.tile : ''}`;

// Draws the screen the survey is on. The same screen again changes only what differs, so its scroll, and a field
// being typed in, stay as they are.
function draw() {
  if (!ob) return;
  render(html`<div class="ob-card">${keyed(screenKey(), (SCREENS[ob.screen] || start)())}</div>`, root);
  root.querySelectorAll('textarea').forEach(fit);
  if (ob.screen === 'accounts' || ob.screen === 'tiles') return;
  // Focus goes to the screen's first field at once, so a quick Ctrl+Enter or keystroke lands there, unless the user
  // is already in one of its fields.
  const at = document.activeElement;
  if (root.contains(at) && at.matches('input, textarea')) return;
  const first = root.querySelector('#obText') || root.querySelector('[data-field="name"]:placeholder-shown') || root.querySelector('textarea');
  if (first) first.focus({ preventScroll: true });
}

function fit(el) { el.style.height = 'auto'; el.style.height = Math.min(Math.max(el.scrollHeight + 2, el.classList.contains('sm') ? 90 : 160), 420) + 'px'; }

// ---- Moving through ----

function show(screen, extra = {}) {
  Object.assign(ob, { screen, error: '' }, extra);
  saveDraft();
  draw();
}

function validBasics() {
  const b = ob.basics;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(b.name)) return 'The name: 2 to 40 letters, numbers, - or _, starting with a letter or number.';
  if (state.projects.some(p => p.id.toLowerCase() === b.name.toLowerCase())) return `There's already a ${b.name} in this RoDev folder.`;
  if (!/^[A-Za-z0-9]{2,4}$/.test(b.code)) return 'The code: 2 to 4 letters or numbers.';
  if (ob.flow === 'existing' && b.kind !== 'studio' && !b.from.trim()) return 'Say where the game is.';
  return '';
}

// The project is made in the background while the questions go on: name, code and where it is are all it needs.
async function startProject() {
  if (busy) return;
  const b = ob.basics;
  ob.error = validBasics();
  if (ob.error) { draw(); return; }
  busy = true;
  draw();
  try {
    const existing = ob.flow === 'existing' ? { kind: b.kind, from: b.kind === 'studio' ? '' : b.from.trim() } : null;
    const repo = ob.flow === 'existing' && b.kind === 'github' ? '' : b.repo.trim();
    const { job: id } = await api.newProject({ name: b.name, code: b.code.toUpperCase(), repo, existing });
    ob.job = { id, state: 'making', output: '' };
    busy = false;
    show('question', { index: 0 });
    poll();
  } catch (e) {
    busy = false;
    show('basics', {});
    ob.error = e.message;
    draw();
  }
}

async function poll() {
  const id = ob.job?.id;
  while (ob?.job?.id === id && ob.job.state === 'making') {
    await new Promise(r => setTimeout(r, 1200));
    try {
      const s = await api.job(id);
      if (ob?.job?.id !== id) return;
      ob.job.output = s.output || '';
      if (!s.running) {
        Object.assign(ob.job, { state: s.ok ? 'ready' : 'failed' });
        if (s.ok) ob.project = s.project;
        saveDraft();
        if (onboardingOpen() && ob.screen === 'review') draw();
      }
    } catch { /* Rocco restarting: ask again */ }
  }
}

function source() {
  const b = ob.basics;
  const kind = { github: 'a GitHub repo', folder: 'a folder on this PC', place: 'a place file' }[b.kind];
  return b.kind === 'studio' ? 'Only in Roblox Studio: the agent exports the scripts from the open place' : `${b.from.trim()} (${kind})`;
}

async function finish() {
  if (busy || ob.job?.state !== 'ready') return;
  busy = true;
  draw();
  try {
    const project = ob.project;
    ob.saved = await api.saveAnswers(project, { flow: ob.flow, source: ob.flow === 'existing' ? source() : '', answers: ob.answers });
    // A new game's lanes: recorded before the agent starts (it reads PROJECT.md), then opened while it writes the docs.
    if (ob.flow === 'new' && ob.laneCount != null) {
      try { ob.lanesJob = { id: (await api.openLanes(project, ob.laneCount)).job, state: 'opening', output: '' }; }
      catch (e) { ob.lanesJob = { id: '', state: 'failed', error: e.message }; }
    }
    ob.setup = await api.startSetup(project, ob.flow === 'existing' ? 'existing' : 'new', []);
    storage.set(DRAFT, '');
    ob.mode = 'done'; // finished: no longer a draft to pick up
    await loadProjects();
    switchProject(project);
    go('workboard');
    busy = false;
    show('tiles');
    if (ob.lanesJob?.state === 'opening') pollLanes();
  } catch (e) {
    busy = false;
    draw();
    toast(`Couldn't finish: ${e.message}`, 'var(--red)');
  }
}

async function saveTile() {
  if (busy) return;
  const t = survey.tiles.find(x => x.id === ob.tile);
  const answers = {};
  root.querySelectorAll('[data-answer]').forEach(el => { answers[el.dataset.answer] = el.value; ob.answers[el.dataset.answer] = el.value; });
  busy = true;
  draw();
  try {
    await api.saveAnswers(ob.project || state.project, { answers });
    if (tileFilled(t)) ob.unsent.add(t.id);
    toast(`${t.title}: saved`);
    busy = false;
    show('tiles');
  } catch (e) {
    busy = false;
    draw();
    toast(`Couldn't save: ${e.message}`, 'var(--red)');
  }
}

async function send() {
  if (busy || !ob.unsent.size) return;
  busy = true;
  draw();
  try {
    const s = await api.startSetup(ob.project || state.project, 'more', [...ob.unsent]);
    ob.unsent.clear();
    toast(s.opened ? `${s.agent} is filling them in, minimized in your taskbar (${s.task})` : `${s.task} is in Up next for your agent`, 'var(--violet)');
  } catch (e) { toast(`Couldn't send them: ${e.message}`, 'var(--red)'); }
  busy = false;
  draw();
}

function step(delta) {
  // An answer opened from the review goes back to it.
  if (ob.editing) { show('review', { editing: false }); return; }
  const list = questions();
  const next = ob.index + delta;
  if (next < 0) show('basics');
  else if (next >= list.length) ob.flow === 'new' ? showLanes() : show('review');
  else show('question', { index: next });
}

function showLanes(extra = {}) {
  show('lanes', extra);
  if (!ob.advice || ob.advice.error) loadAdvice();
}

export function initOnboarding() {
  root.addEventListener('click', e => {
    const run = e.target.closest('[data-acc-run]'), use = e.target.closest('[data-acc-use]');
    if (run) { runAccountAction(run.dataset.accRun, redrawAccounts); return; }
    if (use) { useAgent(use.dataset.accUse).then(redrawAccounts); return; }
    const el = e.target.closest('[data-ob]');
    if (!el || el.disabled) return;
    const [action, arg] = el.dataset.ob.split(':');
    // A job that's taking too long, or was started by mistake: stopped, with whatever it started. Its line then says so.
    if (action === 'cancel-job') { api.cancelJob(arg).catch(err => toast(`Couldn't stop it: ${err.message}`, 'var(--red)')); return; }
    if (action === 'close') closeOnboarding();
    else if (action === 'accounts') { show('accounts'); checkAccounts(true); }
    else if (action === 'acc-continue') { storage.set(SEEN, 'shown'); linking = ''; keyDraft = ''; ob.mode === 'accounts' ? closeOnboarding() : show('start'); }
    else if (action === 'acc-check') checkAccounts(true);
    else if (action === 'acc-link') {
      linking = linking === arg ? '' : arg; keyDraft = '';
      draw();
      root.querySelector('#accKey')?.focus();
    }
    else if (action === 'acc-save') linkKey(arg);
    else if (action === 'restart') { storage.set(DRAFT, ''); openOnboarding({ fresh: true }); }
    else if (action === 'flow') show('basics', { flow: arg });
    else if (action === 'kind') { ob.basics.kind = arg; ob.basics.from = ''; show('basics'); }
    else if (action === 'basics-next') ob.job && ob.job.state !== 'failed' ? show('question', { index: 0 }) : (ob.job = null, startProject());
    else if (action === 'back') ob.screen === 'basics' ? show('start')
      : ob.screen === 'review' ? (ob.flow === 'new' ? showLanes() : show('question', { index: questions().length - 1 }))
      : ob.screen === 'lanes' ? (ob.editing ? show('review', { editing: false }) : show('question', { index: questions().length - 1 }))
      : step(-1);
    else if (action === 'next' || action === 'skip') step(1);
    else if (action === 'goto') show('question', { index: +arg, editing: true });
    else if (action === 'goto-lanes') showLanes({ editing: true });
    else if (action === 'lanes-count') { ob.laneCount = +arg; saveDraft(); draw(); }
    else if (action === 'lanes-next') show('review', { editing: false });
    else if (action === 'lanes-open') openLanesNow();
    else if (action === 'finish') finish();
    else if (action === 'tile') show('tile', { tile: arg });
    else if (action === 'tiles') show('tiles');
    else if (action === 'save-tile') saveTile();
    else if (action === 'send') send();
    else if (action === 'done') closeOnboarding();
  });
  root.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.field) {
      ob.basics[el.dataset.field] = el.value;
      // A code from the name's capitals or first letters, until the user types their own.
      if (el.dataset.field === 'name' && !ob.codeTyped) {
        const caps = (el.value.match(/[A-Z0-9]/g) || []).join('').slice(0, 4);
        ob.basics.code = (caps.length >= 2 ? caps : el.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 2)).toUpperCase();
        const code = root.querySelector('[data-field="code"]');
        if (code) code.value = ob.basics.code;
      }
      if (el.dataset.field === 'code') ob.codeTyped = true;
      saveDraft();
    } else if (el.id === 'obText') {
      const q = questions()[ob.index], had = answered(q.id);
      ob.answers[q.id] = el.value;
      fit(el);
      saveDraft();
      // Skip turns into nothing once there's an answer.
      if (had !== answered(q.id)) draw();
    } else if (el.id === 'accKey') keyDraft = el.value;
    else if (el.matches('textarea')) fit(el);
  });
  // Back from a sign-in in the browser: check again.
  addEventListener('focus', () => { if (onboardingOpen() && ob?.screen === 'accounts' && !checking) checkAccounts(true); });
  root.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'accKey') { e.preventDefault(); linkKey(linking); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ob?.screen === 'question') { e.preventDefault(); step(1); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ob?.screen === 'lanes' && ob.mode === 'start' && ob.advice) { e.preventDefault(); show('review', { editing: false }); }
    if (e.key === 'Enter' && ob?.screen === 'basics' && e.target.matches('input')) { e.preventDefault(); root.querySelector('[data-ob="basics-next"]')?.click(); }
  });
  root.addEventListener('click', e => { if (e.target === root) closeOnboarding(); });
}
