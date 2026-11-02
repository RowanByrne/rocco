// Onboarding: every game starts here, new or already made. A short survey, one question at a time; the answers go to
// docs/game/ONBOARDING.md and the user's agent turns them into the first docs (the template's SETUP.md). Tiles add more
// detail, now or later (Docs, "Add game details"). The questions are the template's tools/onboarding.json, so they
// change with the docs they fill. A survey in progress is kept in this browser until it's finished.
// Before the first one, the accounts screen: RoDev runs on the user's own AI plans, so it checks each one on this PC and
// signs in from there.
import { state, currentProject } from '../state.js';
import { $, esc } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { storage } from '../lib/storage.js';
import { api, DEMO } from '../api.js';
import { toast } from '../ui/toast.js';
import { loadProjects, switchProject } from '../projects.js';
import { go } from '../router.js';
import { agentName, agentShort } from '../agent.js';
import { LINKS } from '../views/connections.js';
import { loadAccounts, yourAgent, notReady, runAccountAction, useAgent, accRowHTML, agentRowHTML, fixButtons, windowButton, imagesNeed } from '../accounts.js';

const root = $('#onboarding');
const DRAFT = 'rocco.onboarding';
const SEEN = 'rocco.accounts'; // the accounts screen was shown in this browser: after that, the survey starts at its first choice
const KINDS = [
  ['github', 'On GitHub', 'https://github.com/you/game.git', 'Its repo comes along with its history; the template is merged into it.'],
  ['folder', 'In a folder', 'D:\\Games\\MyGame', 'A git folder comes along with its history; any other folder is copied in for your agent to sort.'],
  ['place', 'In a place file', 'D:\\Places\\MyGame.rbxl', 'The place is copied into the project (and backed up); your agent exports its scripts.'],
  ['studio', 'Only in Studio', '', 'Open it in Studio when your agent asks: it exports the scripts from there.'],
];
let ob = null;     // the survey in progress: { mode, screen, flow, basics, answers, index, tile, job, project, setup, saved, unsent, error }
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
  const draft = fresh ? null : readDraft();
  ob = draft ? { ...draft, unsent: new Set() } : { mode: 'start', screen: storage.get(SEEN) ? 'start' : 'accounts', flow: 'new', basics: { name: '', code: '', repo: '', kind: 'github', from: '' }, answers: {}, index: 0, unsent: new Set() };
  root.classList.add('open');
  render();
  if (ob.job?.state === 'making') poll();
  checkAccounts(false);
}

// The accounts screen on its own (Settings, "Your accounts").
export function openAccounts() {
  ob = { mode: 'accounts', screen: 'accounts', unsent: new Set() };
  root.classList.add('open');
  render();
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
  render();
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

function topHTML(label, progress) {
  return `<div class="ob-top"><span class="ob-label">${label}</span>`
    + (progress !== undefined ? `<span class="ob-progress"><i style="width:${Math.round(progress * 100)}%"></i></span>` : '<span class="sp"></span>')
    + (ob.mode === 'start' && !['start', 'accounts'].includes(ob.screen) && !ob.setup ? '<button class="mini" data-ob="restart">Start over</button>' : '')
    + `<button class="icon-btn" data-ob="close" aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;
}

const foot = (left, right) => `<div class="ob-foot">${left || ''}<span class="sp"></span>${right || ''}</div>`;
const button = (action, label, cls = 'btn', disabled = false) => `<button class="${cls}" data-ob="${action}"${disabled ? ' disabled' : ''}>${label}</button>`;

// ---- Your accounts ----

// Nothing is included: each AI tool runs on the user's own plan, signed in on this PC. Each row says what it needs and
// whether it's ready, with the tool's own install or sign-in one click away (accounts.js).
async function checkAccounts(refresh) {
  checking = true;
  if (ob?.screen === 'accounts') render();
  await loadAccounts(refresh);
  checking = false;
  rerenderAccounts();
}

function rerenderAccounts() { if (onboardingOpen() && ['accounts', 'start', 'review'].includes(ob?.screen)) render(); }

// ElevenLabs and Roblox: a key the user makes on the service's site and pastes here (the same link as in Connections).
function keyRowHTML(service, need) {
  const l = LINKS[service], k = state.accounts[service];
  const form = linking === service ? `<div class="acc-form"><p class="acc-why">${esc(l.why)}</p>`
    + `<div class="link-form"><input class="input" id="accKey" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your ${esc(l.name)} API key">`
    + `<button class="btn accent" data-ob="acc-save:${service}">${busy ? '<span class="spin"></span>Checking' : 'Link'}</button></div>`
    + `<div class="link-help">Make a key at <a href="${esc(l.keys)}" target="_blank" rel="noreferrer">${esc(new URL(l.keys).host)}</a>. ${esc(l.where)}</div></div>` : '';
  return accRowHTML({ name: l.name, need, tone: k.linked ? 'ok' : 'off', detail: k.linked ? `Linked, with the key ending ${k.hint}` : 'Not linked',
    buttons: k.linked ? '' : `<button class="btn-sm" data-ob="acc-link:${service}">${linking === service ? 'Cancel' : 'Link'}</button>`, form });
}

function accountsHTML() {
  const alone = ob.mode === 'accounts', a = state.accounts;
  const section = (title, sub, rows) => `<div class="acc-sec"><div class="acc-sec-head"><b>${title}</b><span>${sub}</span></div>${rows}</div>`;
  const intro = '<h2 class="ob-title">Your accounts</h2><p class="ob-lede">RoDev runs on your own accounts: no AI plan comes with it, and nothing is shared. '
    + 'Each tool below uses your own plan, signed in on this PC, and what it does counts against that plan. Sign in here; Rocco checks again when you come back.</p>';
  const next = button('acc-continue', alone ? 'Done' : !a || a.ready ? 'Continue' : 'Continue anyway', 'btn accent');
  if (!a) return topHTML(alone ? 'Your accounts' : 'Before you start')
    + `<div class="ob-body">${intro}<div class="ob-status"><span class="spin"></span><span>Checking this PC…</span></div></div>` + foot('', next);
  const mine = yourAgent(), images = { ...a.images, name: 'Codex' };
  return topHTML(alone ? 'Your accounts' : 'Before you start')
    + `<div class="ob-body">${intro}`
    + section('A coding agent', 'Needed. One is enough: it plans, builds and keeps the docs, in your name.', a.agents.map(agentRowHTML).join(''))
    + (mine && !a.ready ? `<div class="ob-status warn">${icon.alert}<span>${esc(mine.name)} ${notReady(mine)} yet. You can still go on: the game is made, and its setup waits in Up next until your agent is ready.</span></div>` : '')
    + section('Images', 'Recommended. Without it, this PC can\'t make art.',
      accRowHTML({ name: 'Codex', need: imagesNeed(), tone: images.state === 'ok' ? 'ok' : 'warn', detail: images.detail, buttons: fixButtons(images) }))
    + section('Later, when you need them', 'Optional. Each can be linked any time in Connections.',
      accRowHTML({ name: 'GitHub', need: 'Your own account: where each game\'s code is kept, and how your PCs share it.', tone: a.github.state === 'ok' ? 'ok' : 'off', detail: a.github.detail,
        buttons: a.github.login ? windowButton(a.github.login, 'Sign in', 'btn-sm go') : '' })
      + keyRowHTML('elevenlabs', 'Sound effects and music. Game audio needs a paid plan (Starter or above).')
      + keyRowHTML('roblox', 'The game page: events, thumbnails and how each one does. Once the game is on Roblox.'))
    + '</div>'
    + foot(button('acc-check', checking ? '<span class="spin"></span>Checking' : 'Check again', 'btn ghost-btn', checking), next);
}

async function linkKey(service) {
  const key = keyDraft.trim();
  if (!key) { root.querySelector('#accKey')?.focus(); return; }
  busy = true;
  render();
  try {
    const { tier, note } = await api.link(service, key);
    toast(note || `${LINKS[service].name} linked${tier ? ` · ${tier[0].toUpperCase()}${tier.slice(1)} plan` : ''}`, note && !note.startsWith('Linked.') ? 'var(--amber)' : undefined);
    linking = ''; keyDraft = '';
    busy = false;
    await checkAccounts(true);
  } catch (e) {
    busy = false;
    render();
    toast(e.message, 'var(--red)');
  }
}

function startHTML() {
  const choice = (flow, title, text) => `<button class="ob-choice" data-ob="flow:${flow}"><b>${title}</b><span>${text}</span></button>`;
  const mine = yourAgent();
  return topHTML('New project')
    + `<div class="ob-body"><h2 class="ob-title">What are you starting?</h2>`
    + `<p class="ob-lede">A few questions about the game, one at a time. Answer as much or as little as you like: your agent (${esc(agentName())}) turns the answers into the first docs.</p>`
    + `<div class="ob-choices">${choice('new', 'A new game', esc(survey.flows.new.blurb))}${choice('existing', 'A game I&#39;ve already made', esc(survey.flows.existing.blurb))}</div>`
    + (mine && !state.accounts.ready ? `<div class="ob-status warn">${icon.alert}<span>${esc(mine.name)} ${notReady(mine)} on this PC, so it can't write the docs yet.</span>${button('accounts', 'Sort it out', 'btn-sm go')}</div>` : '')
    + '</div>' + foot(button('accounts', 'Your accounts', 'btn ghost-btn'), '');
}

function basicsHTML() {
  const b = ob.basics, existing = ob.flow === 'existing';
  const kind = KINDS.find(k => k[0] === b.kind) || KINDS[0];
  // Once the project is being made, these are fixed: Start over changes them.
  const locked = !!ob.job && ob.job.state !== 'failed';
  const field = (id, label, value, placeholder, extra = '') => `<label class="lbl">${label}<input class="input" data-field="${id}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false"${extra}${locked ? ' disabled' : ''}></label>`;
  return topHTML(existing ? 'Bring in a game' : 'A new game', 0)
    + `<div class="ob-body"><h2 class="ob-title">${existing ? 'Which game?' : 'Name it'}</h2>`
    + `<p class="ob-lede">${existing ? 'Its name in this RoDev folder, and where it is now.' : 'You can change the name players see later; this one names its folder.'}</p>`
    + `<div class="ob-fields"><div class="two">${field('name', 'Name', b.name, existing ? 'MyGame' : 'SkyFarm')}${field('code', 'Code <small>2 to 4 letters, for its place files</small>', b.code, 'SF', ' maxlength="4"')}</div>`
    + (existing ? `<div class="lbl">Where is it?<div class="ob-kinds">${KINDS.map(([id, label]) => `<button class="ob-kind${b.kind === id ? ' on' : ''}" data-ob="kind:${id}"${locked ? ' disabled' : ''}>${label}</button>`).join('')}</div>`
      + `<span class="ob-note">${kind[3]}</span></div>`
      + (kind[2] ? field('from', b.kind === 'github' ? 'Its GitHub repo' : b.kind === 'folder' ? 'The folder' : 'The place file', b.from, kind[2]) : '') : '')
    + (!existing || b.kind !== 'github' ? field('repo', `A new GitHub repo <small>optional: an empty private one, to back the game up</small>`, b.repo, 'https://github.com/you/game.git') : '')
    + `</div>${locked ? '<div class="ob-note">The project is already being made with these. Start over to change them.</div>' : ''}${ob.error ? `<div class="ob-status err">${icon.alert}<span>${esc(ob.error)}</span></div>` : ''}</div>`
    + foot(button('back', 'Back'), button('basics-next', busy ? '<span class="spin"></span>Starting' : 'Next', 'btn accent', busy));
}

function questionHTML() {
  const list = questions(), q = list[ob.index];
  const value = ob.answers[q.id] || '';
  return topHTML(`${esc(q.step)} <span class="ob-count">${ob.index + 1} of ${list.length}</span>`, (ob.index + 1) / (list.length + 1))
    + `<div class="ob-body"><h2 class="ob-title">${esc(q.prompt)}</h2>${q.hint ? `<p class="ob-lede">${esc(q.hint)}</p>` : ''}`
    + `<textarea class="field ob-text" id="obText" placeholder="${esc(q.placeholder || 'As much or as little as you like')}" aria-label="${esc(q.prompt)}">${esc(value)}</textarea>`
    + `<div class="ob-for">Goes into ${esc((q.for || []).join(', '))}</div></div>`
    + foot(button('back', 'Back'), ob.editing ? button('next', 'Done <kbd>Ctrl</kbd><kbd>Enter</kbd>', 'btn accent')
      : `${value.trim() ? '' : button('skip', 'Skip', 'btn ghost-btn')}${button('next', 'Next <kbd>Ctrl</kbd><kbd>Enter</kbd>', 'btn accent')}`);
}

function jobHTML() {
  const j = ob.job;
  if (!j) return '';
  if (j.state === 'making') return `<div class="ob-status"><span class="spin"></span><span>Making ${esc(ob.basics.name)}…</span></div>`;
  if (j.state === 'ready') return `<div class="ob-status ok">${icon.checkSm}<span>${esc(ob.basics.name)} is ready in the RoDev folder.</span></div>`;
  return `<div class="ob-status err">${icon.alert}<span>Making the project didn't work. Fix what it says, then go back to the name.</span></div><pre class="m-log err">${esc(j.output || '')}</pre>`;
}

function reviewHTML() {
  const list = questions();
  const filled = list.filter(q => answered(q.id)).length;
  const agent = state.agent;
  const handoff = !agent?.installed ? `${esc(agentName())} isn't installed on this PC, so the job waits in Up next for whichever agent you open.`
    : state.accounts && !state.accounts.ready ? `${esc(agent.name)} opens in its own window. It isn't signed in yet, so it asks you to first, then writes the docs from your answers.`
    : `${esc(agent.name)} opens in its own window and writes the docs from your answers.`;
  return topHTML('Ready', 1)
    + `<div class="ob-body"><h2 class="ob-title">Ready to save?</h2><p class="ob-lede">${filled} of ${list.length} answered. ${handoff} Click any answer to change it.</p>`
    + `<div class="ob-review">${list.map((q, i) => `<button class="ob-rev" data-ob="goto:${i}"><small>${esc(q.step)}</small><span class="q">${esc(q.prompt)}</span>`
      + `<span class="a${answered(q.id) ? '' : ' skipped'}">${answered(q.id) ? esc(ob.answers[q.id]) : 'Skipped'}</span></button>`).join('')}</div>${jobHTML()}</div>`
    + foot(button('back', 'Back'), button('finish', busy ? '<span class="spin"></span>Saving' : 'Save and start setup', 'btn accent', busy || ob.job?.state !== 'ready'));
}

function setupHTML() {
  const s = ob.setup, saved = ob.saved;
  if (!s) return '';
  const done = text => `<div class="ob-result">${icon.checkSm}<span>${text}</span></div>`;
  return `<div class="ob-results">${done(`${esc(currentProjectName())} is set up in the RoDev folder.`)}`
    + done(`Your answers are in <code>docs/game/ONBOARDING.md</code>${saved?.pushed ? ', pushed to GitHub' : ''}.${saved?.note ? ` <span class="ob-note">${esc(saved.note)}</span>` : ''}`)
    + (s.opened ? done(`${esc(s.agent)} is writing the docs in its own window. Follow it on the Workboard (${esc(s.task)}).`)
      : `<div class="ob-result">${icon.alert}<span>${esc(s.task)} is in Up next for your agent. To start it now, give your agent this:</span></div>`
        + `<div class="ob-prompt"><code>${esc(s.prompt)}</code><button class="copy" data-copy="${esc(s.prompt)}">${icon.copy}Copy</button></div>`)
    + '</div>';
}

const currentProjectName = () => ob.basics?.name || currentProject().name;

function tilesHTML() {
  const after = ob.mode === 'done';
  const sendable = ob.unsent.size > 0;
  return topHTML(after ? 'All set' : `More detail for ${esc(currentProject().name)}`)
    + `<div class="ob-body">${after ? `<h2 class="ob-title">All set</h2>${setupHTML()}<h3 class="ob-sub">Want to add more?</h3>` : '<h2 class="ob-title">Add game details</h2>'}`
    + `<p class="ob-lede">Optional. Pick any of these and write as much or as little as you like. ${esc(agentShort())} files each into its doc.</p>`
    + `<div class="ob-tiles">${survey.tiles.map(t => `<button class="ob-tile${tileFilled(t) ? ' filled' : ''}" data-ob="tile:${esc(t.id)}">`
      + `<span class="ob-tile-head"><b>${esc(t.title)}</b>${tileFilled(t) ? icon.checkSm : ''}</span><span>${esc(t.blurb)}</span></button>`).join('')}</div></div>`
    + foot(sendable ? `<span class="ob-note">${ob.unsent.size} saved, not sent to ${esc(agentShort())} yet</span>` : '',
      `${button('send', busy ? '<span class="spin"></span>Sending' : `Send to ${esc(agentShort())}`, 'btn', busy || !sendable)}${button('done', 'Done', 'btn accent')}`);
}

function tileHTML() {
  const t = survey.tiles.find(x => x.id === ob.tile);
  return topHTML(esc(t.title))
    + `<div class="ob-body"><h2 class="ob-title">${esc(t.title)}</h2><p class="ob-lede">${esc(t.blurb)}</p>`
    + t.questions.map(q => `<label class="ob-tq"><span class="ob-tq-prompt">${esc(q.prompt)}</span>${q.hint ? `<span class="ob-note">${esc(q.hint)}</span>` : ''}`
      + `<textarea class="field ob-text sm" data-answer="${esc(q.id)}" placeholder="As much or as little as you like">${esc(ob.answers[q.id] || '')}</textarea></label>`).join('') + '</div>'
    + foot(button('tiles', 'Back'), button('save-tile', busy ? '<span class="spin"></span>Saving' : 'Save', 'btn accent', busy));
}

function render() {
  if (!ob) return;
  const html = { accounts: accountsHTML, start: startHTML, basics: basicsHTML, question: questionHTML, review: reviewHTML, tiles: tilesHTML, tile: tileHTML }[ob.screen] || startHTML;
  const scroll = root.querySelector('.ob-body')?.scrollTop || 0, typing = document.activeElement?.id === 'accKey';
  root.innerHTML = `<div class="ob-card">${html()}</div>`;
  root.querySelectorAll('textarea').forEach(fit);
  // The accounts screen re-renders as checks come back: keep its place, and a key being typed.
  if (ob.screen === 'accounts') {
    root.querySelector('.ob-body').scrollTop = scroll;
    const key = root.querySelector('#accKey');
    if (key) { key.value = keyDraft; if (typing) key.focus(); }
    return;
  }
  const focus = root.querySelector('#obText') || root.querySelector('[data-field="name"]:placeholder-shown') || root.querySelector('textarea');
  // At once, so a quick Ctrl+Enter or keystroke after the last one lands here.
  if (focus && ob.screen !== 'tiles') focus.focus({ preventScroll: true });
}

function fit(el) { el.style.height = 'auto'; el.style.height = Math.min(Math.max(el.scrollHeight + 2, el.classList.contains('sm') ? 90 : 160), 420) + 'px'; }

// ---- Moving through ----

function show(screen, extra = {}) {
  Object.assign(ob, { screen, error: '' }, extra);
  saveDraft();
  render();
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
  const b = ob.basics;
  ob.error = validBasics();
  if (ob.error) { render(); return; }
  busy = true;
  render();
  try {
    const existing = ob.flow === 'existing' ? { kind: b.kind, from: b.kind === 'studio' ? '' : b.from.trim() } : null;
    const repo = ob.flow === 'existing' && b.kind === 'github' ? '' : b.repo.trim();
    const { job } = await api.newProject({ name: b.name, code: b.code.toUpperCase(), repo, existing });
    ob.job = { id: job, state: 'making', output: '' };
    busy = false;
    show('question', { index: 0 });
    poll();
  } catch (e) {
    busy = false;
    show('basics', {});
    ob.error = e.message;
    render();
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
        if (onboardingOpen() && ob.screen === 'review') render();
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
  render();
  try {
    const project = ob.project;
    ob.saved = await api.saveAnswers(project, { flow: ob.flow, source: ob.flow === 'existing' ? source() : '', answers: ob.answers });
    ob.setup = await api.startSetup(project, ob.flow === 'existing' ? 'existing' : 'new', []);
    storage.set(DRAFT, '');
    ob.mode = 'done'; // finished: no longer a draft to pick up
    await loadProjects();
    switchProject(project);
    go('workboard');
    busy = false;
    show('tiles');
  } catch (e) {
    busy = false;
    render();
    toast(`Couldn't finish: ${e.message}`, 'var(--red)');
  }
}

async function saveTile() {
  const t = survey.tiles.find(x => x.id === ob.tile);
  const answers = {};
  root.querySelectorAll('[data-answer]').forEach(el => { answers[el.dataset.answer] = el.value; ob.answers[el.dataset.answer] = el.value; });
  busy = true;
  render();
  try {
    await api.saveAnswers(ob.project || state.project, { answers });
    if (tileFilled(t)) ob.unsent.add(t.id);
    toast(`${t.title}: saved`);
    busy = false;
    show('tiles');
  } catch (e) {
    busy = false;
    render();
    toast(`Couldn't save: ${e.message}`, 'var(--red)');
  }
}

async function send() {
  if (busy || !ob.unsent.size) return;
  busy = true;
  render();
  try {
    const s = await api.startSetup(ob.project || state.project, 'more', [...ob.unsent]);
    ob.unsent.clear();
    toast(s.opened ? `${s.agent} is filling them in, in its own window (${s.task})` : `${s.task} is in Up next for your agent`, 'var(--violet)');
  } catch (e) { toast(`Couldn't send them: ${e.message}`, 'var(--red)'); }
  busy = false;
  render();
}

function step(delta) {
  // An answer opened from the review goes back to it.
  if (ob.editing) { show('review', { editing: false }); return; }
  const list = questions();
  const next = ob.index + delta;
  if (next < 0) show('basics');
  else if (next >= list.length) show('review');
  else show('question', { index: next });
}

export function initOnboarding() {
  root.addEventListener('click', e => {
    const run = e.target.closest('[data-acc-run]'), use = e.target.closest('[data-acc-use]');
    if (run) { runAccountAction(run.dataset.accRun, rerenderAccounts); return; }
    if (use) { useAgent(use.dataset.accUse).then(rerenderAccounts); return; }
    const el = e.target.closest('[data-ob]');
    if (!el || el.disabled) return;
    const [action, arg] = el.dataset.ob.split(':');
    if (action === 'close') closeOnboarding();
    else if (action === 'accounts') { show('accounts'); checkAccounts(true); }
    else if (action === 'acc-continue') { storage.set(SEEN, 'shown'); linking = ''; keyDraft = ''; ob.mode === 'accounts' ? closeOnboarding() : show('start'); }
    else if (action === 'acc-check') checkAccounts(true);
    else if (action === 'acc-link') {
      linking = linking === arg ? '' : arg; keyDraft = '';
      render();
      root.querySelector('#accKey')?.focus();
    }
    else if (action === 'acc-save') linkKey(arg);
    else if (action === 'restart') { storage.set(DRAFT, ''); openOnboarding({ fresh: true }); }
    else if (action === 'flow') show('basics', { flow: arg });
    else if (action === 'kind') { ob.basics.kind = arg; ob.basics.from = ''; show('basics'); }
    else if (action === 'basics-next') ob.job && ob.job.state !== 'failed' ? show('question', { index: 0 }) : (ob.job = null, startProject());
    else if (action === 'back') ob.screen === 'basics' ? show('start') : ob.screen === 'review' ? show('question', { index: questions().length - 1 }) : step(-1);
    else if (action === 'next' || action === 'skip') step(1);
    else if (action === 'goto') show('question', { index: +arg, editing: true });
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
      const q = questions()[ob.index];
      ob.answers[q.id] = el.value;
      fit(el);
      saveDraft();
      // Skip turns into nothing once there's an answer.
      const skip = root.querySelector('[data-ob="skip"]');
      if (skip) skip.hidden = !!el.value.trim();
    } else if (el.id === 'accKey') keyDraft = el.value;
    else if (el.matches('textarea')) fit(el);
  });
  // Back from a sign-in in the browser: check again.
  addEventListener('focus', () => { if (onboardingOpen() && ob?.screen === 'accounts' && !checking) checkAccounts(true); });
  root.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'accKey') { e.preventDefault(); linkKey(linking); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ob?.screen === 'question') { e.preventDefault(); step(1); }
    if (e.key === 'Enter' && ob?.screen === 'basics' && e.target.matches('input')) { e.preventDefault(); root.querySelector('[data-ob="basics-next"]')?.click(); }
  });
  root.addEventListener('click', e => { if (e.target === root) closeOnboarding(); });
}
