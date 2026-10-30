// Rocco himself: a little pixel guy who lives on top of the note box. He wanders and does odd jobs (more of them, in a
// hard hat, while workers are busy), reacts to the board, watches you type, and carries your note off when you send it.
// Settings can turn him off.
import { state, on } from './state.js';
import { $ } from './lib/dom.js';
import { settings } from './settings.js';
import { listening } from './voice.js';

const W = 72, H = 48, MID = 36;        // his box in px; his middle is 36px in
const STILL = matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const px = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${c}"/>`;

// Drawn on a grid of 2px cells: the body is 14 cells wide, and his feet stand on the note box at y 14.
const SPRITE = `<div class="m-jump"><svg class="m-svg" viewBox="-10 -10 36 24" width="${W}" height="${H}" shape-rendering="crispEdges">`
  // Props that sit on the note box
  + `<g class="m-prop p-plank">${px(17, 12.5, 6, 1.5, 'c-wood')}${px(19.5, 11.5, 0.5, 1, 'c-metal')}</g>`
  + `<g class="m-prop p-laptop">${px(16, 5.5, 7, 7, 'c-slate')}${px(16.5, 6, 6, 5.5, 'c-screen')}${px(17.5, 7, 3, 0.5, 'c-glow')}${px(17.5, 8.5, 4, 0.5, 'c-glow')}${px(17.5, 10, 2, 0.5, 'c-glow')}${px(14.5, 12.5, 9, 1.5, 'c-metal')}</g>`
  + `<g class="m-legs">${px(4, 12, 2, 2, 'c-dark leg-l')}${px(10, 12, 2, 2, 'c-dark leg-r')}</g>`
  + `<g class="m-bod">`
  +   `<g class="m-antenna">${px(7.5, 0.5, 1, 2.5, 'c-dark')}${px(7, -1.5, 2, 2, 'c-tip')}</g>`
  +   px(4, 3, 8, 1, 'c-body') + px(2, 4, 12, 1, 'c-body') + px(1, 5, 14, 5, 'c-body') + px(1, 10, 14, 1, 'c-shade') + px(2, 11, 12, 1, 'c-shade') + px(3, 4, 3, 1, 'c-light') + px(2, 5, 1, 2, 'c-light')
  +   `<g class="m-look"><g class="m-eyes">${px(4.5, 6, 2, 2.5, 'c-eye')}${px(9.5, 6, 2, 2.5, 'c-eye')}${px(5, 6.5, 0.5, 0.5, 'c-shine')}${px(10, 6.5, 0.5, 0.5, 'c-shine')}</g></g>`
  +   px(2.5, 8.5, 1.5, 1, 'c-cheek') + px(12, 8.5, 1.5, 1, 'c-cheek')
  +   `<g class="m-mouth mouth-smile">${px(6.5, 9, 1, 1, 'c-eye')}${px(7.5, 9.5, 1, 1, 'c-eye')}${px(8.5, 9, 1, 1, 'c-eye')}</g>`
  +   `<g class="m-mouth mouth-o">${px(7.5, 9, 1, 1.5, 'c-eye')}</g>`
  +   `<g class="m-mouth mouth-grin">${px(6.5, 9, 3, 1, 'c-eye')}${px(7, 10, 2, 0.5, 'c-eye')}</g>`
  +   `<g class="m-arms"><g class="m-arm-l">${px(-0.5, 7, 1.5, 2.5, 'c-shade')}</g><g class="m-arm-r">${px(15, 7, 1.5, 2.5, 'c-shade')}</g></g>`
  +   `<g class="m-arms-up">${px(-0.5, 1, 1.5, 4, 'c-shade')}${px(15, 1, 1.5, 4, 'c-shade')}</g>`
  // Props he wears or holds
  +   `<g class="m-prop p-hat">${px(5, 0.5, 6, 1, 'c-hat')}${px(3.5, 1.5, 9, 1.5, 'c-hat')}${px(2.5, 3, 11, 1, 'c-brim')}</g>`
  +   `<g class="m-prop p-box">${px(3, -5, 10, 6, 'c-box')}${px(7, -5, 2, 6, 'c-tape')}</g>`
  +   `<g class="m-prop p-note">${px(4, -4, 8, 5, 'c-paper')}${px(4, -4, 1, 1, 'c-accent')}${px(5, -3, 1, 1, 'c-accent')}${px(6, -2, 4, 1, 'c-accent')}${px(10, -3, 1, 1, 'c-accent')}${px(11, -4, 1, 1, 'c-accent')}</g>`
  +   `<g class="m-prop p-sign">${px(16, -3, 1, 11, 'c-wood')}${px(13.5, -9, 8, 6, 'c-ok')}${px(15, -6, 1, 1, 'c-shine')}${px(16, -5, 1, 1, 'c-shine')}${px(17, -6, 1, 1, 'c-shine')}${px(18, -7, 1, 1, 'c-shine')}${px(19, -8, 1, 1, 'c-shine')}</g>`
  +   `<g class="m-prop p-mug">${px(15.5, 6.5, 2.5, 3, 'c-paper')}${px(15.5, 6.5, 2.5, 0.5, 'c-coffee')}${px(18, 7, 1, 1.5, 'c-paper')}</g>`
  +   `<g class="m-prop p-hammer"><g class="swing">${px(15.5, 4, 1, 5, 'c-wood')}${px(14, 2.5, 4, 2, 'c-metal')}</g></g>`
  +   `<g class="m-prop p-broom"><g class="swing">${px(15.5, 5, 1, 8, 'c-wood')}${px(13.5, 12.5, 5, 1.5, 'c-straw')}</g></g>`
  + `</g>`
  + `<rect class="m-hit" x="0" y="-2" width="16" height="16"/>`
  + `</svg></div><div class="m-bubble"></div><div class="m-fx"></div>`;

const HEART = `<svg viewBox="0 0 7 6" width="10" height="9" shape-rendering="crispEdges">${['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...']
  .flatMap((row, y) => [...row].map((c, x) => c === 'X' ? `<rect x="${x}" y="${y}" width="1" height="1" fill="#ff8fc7"/>` : '')).join('')}</svg>`;

let el, box, text, ctx;
let pos = 140, face = 1, act = '', mood = 'smile';
let running = false, watching = false, asleep = false;
let gen = 0, raf = 0, seqTimer = 0, fxTimer = 0, sayTimer = 0;
let lastType = 0, lastUser = Date.now(), counts = null;

// ---- Where he is and how he looks ----

const bounds = () => ({ lo: 34, hi: Math.max(35, box.offsetWidth - 34) });
const clamp = x => { const b = bounds(); return Math.min(b.hi, Math.max(b.lo, x)); };
// Whole cells only, so the pixels stay sharp.
const place = () => { el.style.transform = `translateX(${Math.round((pos - MID) / 2) * 2}px)`; };
const setFace = f => { face = f; el.style.setProperty('--face', f); };
const setMood = m => { mood = m; el.dataset.mood = m; };
const look = (dx, dy) => el.querySelector('.m-look').setAttribute('transform', `translate(${Math.round(dx * 2) / 2} ${Math.round(dy * 2) / 2})`);

// Eyes toward a point on the page, in his own (possibly flipped) frame.
function lookToward(x, y) {
  const r = el.getBoundingClientRect(), hx = r.left + MID, hy = r.top + 17;
  look(Math.max(-1, Math.min(1, (x - hx) / 90)) * face, Math.max(-0.5, Math.min(1, (y - hy) / 90)));
}

function setAct(a) {
  act = a;
  el.dataset.act = a;
  clearInterval(fxTimer);
  // Little effects while he works: sparks off the hammer, dust from the broom, steam from the mug, z's while he naps.
  const every = { hammer: [500, () => fx('spark', 58, 44, 3)], sweep: [380, () => fx('dust', 50, 46)], sip: [800, () => fx('steam', 52, 30)], sleep: [1400, () => fx('z', 44, 8)] }[a];
  if (every && !STILL) {
    if (a === 'hammer') setTimeout(() => act === 'hammer' && every[1](), 280); // in time with the swing
    fxTimer = setInterval(every[1], every[0]);
  }
}

function fx(kind, x, y, n = 1) {
  if (STILL || !running) return;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    s.className = `fx fx-${kind}`;
    if (kind === 'z') s.textContent = 'z';
    if (kind === 'heart') s.innerHTML = HEART;
    s.style.left = `${face > 0 ? x : W - x}px`;
    s.style.top = `${y}px`;
    s.style.setProperty('--dx', `${rand(-8, 8).toFixed(1)}px`);
    s.style.setProperty('--dy', `${rand(-10, -3).toFixed(1)}px`);
    el.querySelector('.m-fx').append(s);
    setTimeout(() => s.remove(), 1700);
  }
}

function say(words, ms = 1900, tone = '') {
  const b = el.querySelector('.m-bubble');
  b.textContent = words;
  b.className = `m-bubble show ${tone}`;
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => { b.className = 'm-bubble'; }, ms);
}

function bounce(cls, ms) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}
const hop = () => bounce('hop', 520);
const nod = () => bounce('nod', 240);

// ---- What he does ----

// Each run of steps gets a number; anything new (typing, a click, a sent note) bumps it, and the old run stops.
function interrupt() {
  gen++;
  clearTimeout(seqTimer);
  cancelAnimationFrame(raf);
  el.classList.remove('walking');
  setAct('');
}
const live = g => g === gen && running;
const pause = ms => new Promise(r => { seqTimer = setTimeout(r, ms); });

function walkTo(x, speed = 34) {
  x = clamp(x);
  return new Promise(resolve => {
    if (STILL || Math.abs(x - pos) < 2) { pos = x; place(); resolve(); return; }
    setFace(x > pos ? 1 : -1);
    el.classList.add('walking');
    let last = performance.now();
    const step = now => {
      const move = speed * Math.min(64, now - last) / 1000;
      last = now;
      if (Math.abs(x - pos) <= move) { pos = x; place(); el.classList.remove('walking'); resolve(); return; }
      pos += Math.sign(x - pos) * move;
      place();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });
}

async function doFor(g, a, ms) {
  setAct(a);
  await pause(ms);
  if (live(g)) setAct('');
}

async function lookAround(g) {
  for (const [dx, ms] of [[-1, 700], [1, 700], [0, 400]]) {
    look(dx, 0);
    await pause(ms);
    if (!live(g)) return;
  }
}

// Odd jobs, picked by weight; hammering and typing are likelier while workers are busy.
const JOBS = [
  { weight: () => 4, run: () => walkTo(rand(bounds().lo, bounds().hi)) },
  { weight: () => 1, run: async g => { setAct('box'); await walkTo(pos > box.offsetWidth / 2 ? rand(40, 160) : rand(box.offsetWidth - 160, box.offsetWidth - 40), 28); if (live(g)) { setAct(''); fx('dust', 36, 46, 2); } } },
  { weight: () => counts?.working ? 4 : 0.5, run: g => doFor(g, 'hammer', rand(2600, 4200)) },
  { weight: () => counts?.working ? 3 : 0.5, run: g => doFor(g, 'type', rand(2400, 3800)) },
  { weight: () => 1, run: async g => { setAct('sweep'); await walkTo(pos + face * rand(30, 70), 12); if (live(g)) setAct(''); } },
  { weight: () => 1, run: g => doFor(g, 'sip', rand(2000, 2800)) },
  { weight: () => 2, run: g => lookAround(g) },
  { weight: () => 1, run: g => doFor(g, 'sit', rand(3000, 5000)) },
];

function next(ms = rand(900, 2600)) {
  clearTimeout(seqTimer);
  seqTimer = setTimeout(async () => {
    if (!running || watching || asleep || act === 'listen') return;
    const g = gen, total = JOBS.reduce((s, j) => s + j.weight(), 0);
    let roll = Math.random() * total;
    const job = JOBS.find(j => (roll -= j.weight()) <= 0) || JOBS[0];
    setMood('smile');
    await job.run(g);
    if (live(g)) next();
  }, ms);
}

// ---- What he reacts to ----

// Where the caret is along the note box, in px from its left edge.
function caretX() {
  const cs = getComputedStyle(text);
  ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
  const line = text.value.slice(0, text.selectionStart ?? text.value.length).split('\n').pop();
  const inner = Math.max(1, text.clientWidth - 16);
  return text.offsetLeft + 8 + ctx.measureText(line).width % inner;
}

function onTyping() {
  lastType = Date.now();
  wake();
  if (!running) return;
  const x = caretX();
  // He stands just left of the caret and watches it; if it gets away from him, he catches up.
  if (!watching || Math.abs(x - 22 - pos) > 70) {
    watching = true;
    interrupt();
    const g = gen;
    walkTo(x - 22, 190).then(() => {
      if (!live(g)) return;
      setFace(1);
      setAct('watch');
      look(1, 1);
    });
  } else if (act === 'watch') {
    look(Math.max(-1, Math.min(1, (x - pos) / 30)), 1);
    nod();
  }
}

function stopWatching() {
  if (!watching || Date.now() - lastType < 3500) return;
  watching = false;
  setAct('');
  look(0, 0);
  if (text.value.trim() && Math.random() < 0.5) { setMood('grin'); say(['Ooh, good one', 'Noted!', 'Mm-hm', 'Send it up!'][Math.floor(Math.random() * 4)]); }
  next(1400);
}

async function onSent(type) {
  if (!running) return;
  watching = false;
  interrupt();
  const g = gen;
  setMood('grin');
  hop();
  say(type === 'question' ? 'Asking!' : 'Got it!', 1400, type === 'question' ? 'claude' : 'accent');
  setAct('note');
  await pause(450);
  if (!live(g)) return;
  // Off to deliver it.
  await walkTo(bounds().hi, 95);
  if (!live(g)) return;
  setAct('');
  fx('dust', 36, 46, 2);
  next(1500);
}

async function react(kind) {
  if (!running || asleep) return;
  if (watching) { say({ ready: '✓', stuck: '?', answer: '!', ask: '✦' }[kind], 1400); return; }
  interrupt();
  const g = gen;
  if (kind === 'ready') { setMood('grin'); hop(); setAct('sign'); say('Ready to test!', 2200, 'ok'); await pause(2400); }
  else if (kind === 'stuck') { setMood('o'); say('Someone needs you', 2200, 'warn'); await lookAround(g); }
  else if (kind === 'answer') { setMood('grin'); hop(); say('Answered!', 2000, 'claude'); look(0, 1); await pause(1800); }
  else if (kind === 'ask') { setMood('o'); say('Ooh, new stuff', 1800, 'claude'); await pause(1600); }
  if (live(g)) { setAct(''); setMood('smile'); next(); }
}

function lineToSay() {
  const c = counts || {};
  const facts = [
    c.working && `${c.working} at work right now`,
    c.ready && `${c.ready} ready for you to test`,
    c.stuck && `${c.stuck} waiting on your answer`,
  ].filter(Boolean);
  const chatter = ["Hi! I'm Rocco.", 'Write it down, I pass it on.', 'Bug, tweak, idea or question?', 'I fix this box when it squeaks.', 'Playtest something!'];
  return facts.length && Math.random() < 0.6 ? facts[Math.floor(Math.random() * facts.length)] : chatter[Math.floor(Math.random() * chatter.length)];
}

async function onPoke() {
  wake();
  interrupt();
  const g = gen;
  setMood('grin');
  hop();
  fx('heart', 36, 4);
  say(lineToSay(), 2200);
  await pause(1600);
  if (live(g)) { setMood('smile'); setAct('wave'); await pause(900); }
  if (live(g)) { setAct(''); next(); }
}

// After a minute with nothing happening, he sits down for a nap.
function maybeNap() {
  if (!running || watching || asleep || Date.now() - lastUser < 60000) return;
  interrupt();
  asleep = true;
  setMood('smile');
  look(0, 0);
  setAct('sleep');
}

function wake() {
  lastUser = Date.now();
  if (!asleep) return;
  asleep = false;
  interrupt();
  setMood('o');
  hop();
  say('!', 900);
  next(1200);
}

function countTasks() {
  const c = { working: 0, ready: 0, stuck: 0, answer: 0, ask: 0 };
  for (const t of state.tasks) {
    if (t.kind === 'question') { if (t.status === 'ready') c.answer++; continue; }
    if (t.kind === 'plan') { if (t.status === 'inbox') c.ask++; continue; }
    if (t.status === 'inbox') c.ask++;
    else if (c[t.status] !== undefined) c[t.status]++;
  }
  return c;
}

function onTasks() {
  const before = counts;
  counts = countTasks();
  el.classList.toggle('on-job', counts.working > 0); // the hard hat
  if (!before) return;
  const rose = key => counts[key] > before[key];
  if (rose('ready')) react('ready');
  else if (rose('answer')) react('answer');
  else if (rose('stuck')) react('stuck');
  else if (rose('ask')) react('ask');
}

// ---- On and off ----

function update() {
  const want = settings().mascot && state.view === 'workboard' && !document.hidden;
  el.hidden = !settings().mascot;
  if (want === running) return;
  running = want;
  if (running) {
    pos = clamp(pos);
    place();
    lastUser = Date.now();
    next(700);
  } else {
    interrupt();
    watching = false;
    asleep = false;
  }
}

export function initMascot() {
  box = $('#composer');
  text = $('#noteText');
  el = $('#mascot');
  ctx = document.createElement('canvas').getContext('2d');
  el.innerHTML = SPRITE;
  el.querySelector('.m-eyes').style.animationDelay = `${-rand(0, 4).toFixed(2)}s`;
  setFace(1);
  setMood('smile');
  pos = rand(120, 240);

  text.addEventListener('input', onTyping);
  text.addEventListener('focus', () => { wake(); if (running && !watching && act !== 'sleep') look(Math.sign(caretX() - pos) * face, 1); });
  el.querySelector('.m-hit').addEventListener('click', onPoke);
  // Eyes follow the mouse while he isn't busy looking at something else.
  let pending = false;
  document.addEventListener('mousemove', e => {
    lastUser = Date.now();
    if (asleep) wake();
    if (!running || pending || watching || ['type', 'sleep', 'hammer'].includes(act)) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; lookToward(e.clientX, e.clientY); });
  });
  document.addEventListener('keydown', () => { lastUser = Date.now(); });
  document.addEventListener('visibilitychange', update);
  window.addEventListener('resize', () => { if (running) { pos = clamp(pos); place(); } });
  setInterval(() => { stopWatching(); maybeNap(); }, 600);

  on('tasks', onTasks);
  on('project', () => { counts = null; });
  on('note-sent', onSent);
  on('view', update);
  on('settings', update);
  // A voice note: he cups an ear until it stops.
  on('voice', () => {
    if (running && listening() && act !== 'listen') { watching = false; interrupt(); setAct('listen'); look(0, 1); say('Listening…', 1600, 'accent'); }
    else if (!listening() && act === 'listen') { setAct(''); next(); }
  });
  update();
}
