// Every call to the Rocco server (rocco/server/http.ps1). With ?demo in the address, src/demo.js answers instead.
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
  send: () => DEMO ? demo.send() : post(withProject('/api/send')),
  newProject: details => DEMO ? demo.newProject() : post('/api/projects/new', details),
  job: id => getJson(`/api/jobs/${id}`),
  file: (taskId, name) => withProject(`/files/${taskId}/${encodeURIComponent(name)}`),
};
