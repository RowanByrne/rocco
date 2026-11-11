// lib/tidy.js: a terminal's habits in what an agent writes, tidied for reading. The text itself is never changed on
// disk, and code is left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tidy } from '../../web/src/lib/tidy.js';

test('a double hyphen between words becomes a dash', () => {
  assert.equal(tidy('fast -- very fast'), 'fast — very fast');
});

test('commit hashes drop out of a sentence', () => {
  assert.equal(tidy('Merged to main at af8a0be.'), 'Merged to main.');
  assert.equal(tidy('It is in (commit 28cf9e9) now'), 'It is in now');
  assert.equal(tidy('See commit 28cf9e9 for it'), 'See a commit for it');
});

test('a word that only looks like a hash stays', () => {
  assert.equal(tidy('The facade (decaded) held'), 'The facade (decaded) held');
  assert.equal(tidy('Lap 1234567 was fast'), 'Lap 1234567 was fast');
});

test('a shouted lead-in turns bold, in sentence case', () => {
  assert.equal(tidy('NOTE: check the hairpin'), '**Note:** check the hairpin');
  assert.equal(tidy('- WARNING: it slides'), '- **Warning:** it slides');
});

test('a run of capitals turns bold, in sentence case', () => {
  assert.equal(tidy('THE CAR IS FAST'), '**The car is fast**');
  assert.equal(tidy('It works. ALL TESTS PASS now'), 'It works. **All tests pass** now');
});

test('abbreviations keep their capitals', () => {
  assert.equal(tidy('THE UI IS DONE'), '**The UI is done**');
  assert.equal(tidy('API: ready'), 'API: ready');
});

test('code is left exactly as written', () => {
  assert.equal(tidy('Run `git log -- FILE NAME` (af8a0be1)'), 'Run `git log -- FILE NAME` (af8a0be1)'.replace(' (af8a0be1)', ''));
  assert.equal(tidy('```\nTHE CAR -- IS FAST at af8a0be\n```'), '```\nTHE CAR -- IS FAST at af8a0be\n```');
});

test('nothing to tidy comes back unchanged', () => {
  const plain = 'The trade window opens from the HUD, and closes on Escape.';
  assert.equal(tidy(plain), plain);
  assert.equal(tidy(''), '');
  assert.equal(tidy(null), '');
});
