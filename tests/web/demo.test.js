// The demo (?demo in the address) answers every server call with sample data, from src/demo.js. It's written by
// hand, so it can fall behind the server. Two checks keep it honest:
//   every call api.js can make has a twin in demo.js, and
//   what each twin answers has the fields tests/shapes.json lists, which tests/run.ps1 checks the real server
//   against too. A field one side drops, or the other never had, fails a test on that side.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const shapes = JSON.parse(read('../shapes.json'));

test('every server call has a twin in the demo', () => {
  const used = new Set([...read('../../web/src/api.js').matchAll(/\bdemo\.(\w+)\(/g)].map(m => m[1]));
  const twins = new Set([...read('../../web/src/demo.js').matchAll(/^export (?:async )?function (\w+)|^export const (\w+)/gm)].map(m => m[1] || m[2]));
  assert.ok(used.size > 40, `api.js names ${used.size} demo calls`);
  assert.deepEqual([...used].filter(name => !twins.has(name)), []);
});

// The fields a value is missing, by name: for an array, checked on its first item.
function missing(value, keys) {
  const one = Array.isArray(value) ? value[0] : value;
  if (one == null) return ['(nothing came back)'];
  return keys.filter(key => !(key in one));
}

test('the demo answers with the fields the server does', async () => {
  globalThis.location ??= { search: '?demo', hash: '' };
  const { state } = await import('../../web/src/state.js');
  const demo = await import('../../web/src/demo.js');
  const { projects } = await demo.projects();
  state.projects = projects;
  state.project = projects[0].id;
  const problems = [];
  const snapshot = JSON.parse(await demo.snapshot());
  // {task} stands for a task that has a branch and a session: one the demo's board has.
  const sample = (snapshot.tasks.find(t => t.branch) || snapshot.tasks[0]).id;
  for (const [name, shape] of Object.entries(shapes)) {
    if (!shape.demo) continue;
    let value = await demo[shape.demo](...(shape.demoArgs || []).map(arg => arg === '{task}' ? sample : arg));
    if (typeof value === 'string') value = JSON.parse(value);
    for (const [path, keys] of Object.entries(shape.fields)) {
      const part = path === '.' ? value : path.split('.').reduce((v, key) => (Array.isArray(v) ? v[0] : v)?.[key], value);
      // demoFields: where the demo's sample data is sparser than the server's (a task's optional fields), the ones
      // the app can't do without.
      const gone = missing(part, shape.demoFields?.[path] || keys);
      if (gone.length) problems.push(`${name} ${path}: ${gone.join(', ')}`);
    }
  }
  assert.deepEqual(problems, []);
});
