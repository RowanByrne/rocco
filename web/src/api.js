// Every call to the Rocco server (server/http.ps1). With ?demo in the address, src/demo.js answers instead.
import { state } from './state.js';
import * as demo from './demo.js';

export const DEMO = new URLSearchParams(location.search).has('demo');

const withProject = (path, extra = '') => `${path}?p=${encodeURIComponent(state.project)}${extra}`;

async function request(path, options) {
  const res = await fetch(path, { cache: 'no-store', ...options });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res;
}
const getJson = async path => (await request(path)).json();
// Writes carry X-Rocco: a page on another site can't add it without a preflight the server never answers.
const post = async (path, body, type = 'application/json') => (await request(path, {
  method: 'POST',
  headers: { 'Content-Type': type, 'X-Rocco': '1' },
  body: type === 'application/json' ? JSON.stringify(body || {}) : body,
})).json();

export const api = {
  projects: () => DEMO ? demo.projects() : getJson('/api/projects'),
  // The raw text, so the caller can skip work when nothing changed.
  state: async () => DEMO ? demo.snapshot() : (await request(withProject('/api/state'))).text(),
  me: () => DEMO ? demo.me() : getJson('/api/me'),
  connections: force => DEMO ? demo.connections() : getJson(withProject('/api/connections', force ? '&refresh=1' : '')),
  history: () => DEMO ? demo.history() : getJson(withProject('/api/history')),
  note: (text, type) => DEMO ? demo.note(text, type) : post(withProject('/api/note'), { text, type }),
  shot: (id, file) => DEMO ? demo.shot(id, file) : post(withProject(`/api/tasks/${id}/shot`), file, file.type),
  act: (id, action, text) => DEMO ? demo.act(id, action, text) : post(withProject(`/api/tasks/${id}/${action}`), { text }),
  // Up next in this order; the server refuses an order that puts a task before one it needs.
  order: ids => DEMO ? demo.order(ids) : post(withProject('/api/order'), { ids }),
  changes: id => DEMO ? demo.changes(id) : getJson(withProject(`/api/tasks/${id}/changes`)),
  docs: () => DEMO ? demo.docs() : getJson(withProject('/api/docs')),
  doc: path => DEMO ? demo.doc(path) : getJson(withProject('/api/docs/file', `&path=${encodeURIComponent(path)}`)),
  // The user's edit, committed on main and pushed. { conflict, hash } instead if the doc changed since base.
  saveDoc: (path, text, base, message) => DEMO ? demo.saveDoc(path, text, base, message) : post(withProject('/api/docs/save'), { path, text, base, message }),
  bookmark: hash =>DEMO ? demo.bookmark(hash) : post(withProject('/api/history/bookmark'), { hash }),
  // Accounts linked on this PC; the key is only ever sent, never read back.
  link: (service, key) => DEMO ? demo.link(service, key) : post(withProject(`/api/links/${service}`), { key }),
  unlink: service => DEMO ? demo.unlink(service) : post(withProject(`/api/links/${service}/remove`)),
  // A Connections row's button: { message } once it's done, or { run, label } for an update in its own window.
  action: (id, value) => DEMO ? demo.action(id, value) : post(withProject(`/api/actions/${id}`), { value }),
  actionRun: run => DEMO ? demo.actionRun(run) : getJson(`/api/actions/runs/${run}`),
  // Rocco moves to a newer release and restarts; the page reloads when the new version answers.
  updateRocco: tag => DEMO ? demo.updateRocco(tag) : post(withProject('/api/rocco/update'), { tag }),
  send: () =>DEMO ? demo.send() : post(withProject('/api/send')),
  // This PC's coding agent (server/agents.ps1).
  agent: () => DEMO ? demo.agent() : getJson('/api/agent'),
  setAgent: id => DEMO ? demo.setAgent(id) : post(withProject('/api/agent'), { id }),
  // Onboarding (server/onboarding.ps1). A game being made isn't the open project yet, so these name theirs.
  survey: () => DEMO ? demo.survey() : getJson('/api/onboarding/survey'),
  onboarding: () => DEMO ? demo.onboarding() : getJson(withProject('/api/onboarding')),
  saveAnswers: (project, body) => DEMO ? demo.saveAnswers(project, body) : post(`/api/onboarding/answers?p=${encodeURIComponent(project)}`, body),
  startSetup: (project, part, tiles) => DEMO ? demo.startSetup(project, part, tiles) : post(`/api/onboarding/setup?p=${encodeURIComponent(project)}`, { part, tiles }),
  // { name, code, repo, existing: { kind, from } }: a new game, or one brought in. Returns { job }.
  newProject: details => DEMO ? demo.newProject(details) : post('/api/projects/new', details),
  job: id => DEMO ? demo.job(id) : getJson(`/api/jobs/${id}`),
  file: (taskId, name) => withProject(`/files/${taskId}/${encodeURIComponent(name)}`),
  // Updates: the calendar's cards (live/CALENDAR.md) and the game page's events.
  updates: force => DEMO ? demo.updates() : getJson(withProject('/api/updates', force ? '&refresh=1' : '')),
  saveUpdate: card => DEMO ? demo.saveUpdate(card) : post(withProject('/api/updates/save'), card),
  removeUpdate: id => DEMO ? demo.removeUpdate(id) : post(withProject('/api/updates/remove'), { id }),
  queueUpdateEvent: id => DEMO ? demo.queueUpdateEvent(id) : post(withProject('/api/updates/queue'), { id }),
  setUpdateLead: days => DEMO ? demo.setUpdateLead(days) : post(withProject('/api/updates/lead'), { days }),
  pickCardImage: (id, image) => DEMO ? demo.pickCardImage(id, image) : post(withProject('/api/updates/image'), { id, image }),
  publishEvent: eventId => DEMO ? demo.publishEvent(eventId) : post(withProject('/api/updates/publish'), { eventId }),
  // Thumbnails: the game page's, directions, and concepts made with Codex.
  thumbnails: force => DEMO ? demo.thumbnails() : getJson(withProject('/api/thumbnails', force ? '&refresh=1' : '')),
  makeConcepts: (direction, count) => DEMO ? demo.makeConcepts(direction, count) : post(withProject('/api/thumbnails/generate'), { direction, count }),
  useConcept: file => DEMO ? demo.useConcept(file) : post(withProject('/api/thumbnails/use'), { file }),
  askDirections: () => DEMO ? demo.askDirections() : post(withProject('/api/thumbnails/directions')),
  // A candidate image in ..\art\generated: 'thumbnails/<direction>/<file>' or 'events/<card>/<file>'.
  artFile: rel => DEMO ? demo.artFile(rel) : withProject(`/files/art/${rel.split('/').map(encodeURIComponent).join('/')}`),
};
