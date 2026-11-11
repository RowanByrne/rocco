// lib/markdown.js: what agents and docs write, turned into HTML. Its text is escaped here, and it's the one place
// the app puts HTML it didn't build from a template on the page, so these are the checks that matter most.
import test from 'node:test';
import assert from 'node:assert/strict';
import { markdown, slug } from '../../web/src/lib/markdown.js';

test('text is escaped, tags and all', () => {
  const html = markdown('<script>alert(1)</script> & <img src=x onerror=alert(2)>');
  assert.ok(!/<script|<img/i.test(html), html);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &lt;img/);
});

test('code is escaped too, inline and fenced', () => {
  assert.match(markdown('`<b>`'), /<code>&lt;b&gt;<\/code>/);
  assert.match(markdown('```\n<b>bold</b>\n```'), /<pre><code>&lt;b&gt;bold&lt;\/b&gt;<\/code><\/pre>/);
});

test('a link only goes to a web address, a doc or a heading', () => {
  assert.match(markdown('[site](https://example.com/a?b=1)'), /<a href="https:\/\/example\.com\/a\?b=1" target="_blank" rel="noreferrer">site<\/a>/);
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>', 'vbscript:x', 'file:///C:/x']) {
    const html = markdown(`[click](${bad})`);
    assert.ok(!/href="(javascript|data|vbscript|file)/i.test(html), html);
    assert.ok(!/<script/i.test(html), html);
  }
});

test('an address or a title can\'t break out of its attribute', () => {
  const html = markdown('[x](https://example.com/"onmouseover="alert(1))');
  assert.ok(!/"onmouseover="/.test(html), html);
});

test('a stray percent sign in a link is left as written', () => {
  assert.doesNotThrow(() => markdown('[a](#100%)'));
  assert.doesNotThrow(() => markdown('[a](docs/50%.md)'));
  assert.doesNotThrow(() => markdown('[a](docs/%E0%A4%A.md)'));
});

test('headings get an id to link to', () => {
  assert.equal(slug('What waits on you'), 'md-what-waits-on-you');
  assert.match(markdown('## What waits on you'), /<h2 id="md-what-waits-on-you">What waits on you<\/h2>/);
});

test('a table, a list and a quote', () => {
  const table = markdown('| A | B |\n|---|:-:|\n| 1 | 2 |');
  assert.match(table, /<th>A<\/th>/);
  assert.match(table, /<td style="text-align:center">2<\/td>/);
  assert.match(markdown('- one\n- two'), /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(markdown('3. three\n4. four'), /<ol start="3">/);
  assert.match(markdown('> quoted'), /<blockquote><p>quoted<\/p><\/blockquote>/);
});

test('bold and italics, and a line break kept when asked', () => {
  assert.match(markdown('**bold** and *it*'), /<strong>bold<\/strong> and <em>it<\/em>/);
  assert.match(markdown('one\ntwo', { breaks: true }), /<p>one<br>two<\/p>/);
  assert.match(markdown('one\ntwo'), /<p>one two<\/p>/);
});

test('a task id and a doc\'s name become what the app gives for them', () => {
  const html = markdown('See T-049 and `T-050` in WORKFLOW.md', {
    task: id => `<a data-task="${id}">${id}</a>`,
    docRef: ref => ref === 'WORKFLOW.md' ? 'docs/workflow/WORKFLOW.md' : '',
  });
  assert.match(html, /<a data-task="T-049">T-049<\/a>/);
  assert.match(html, /<a data-task="T-050">T-050<\/a>/);
  assert.match(html, /<a class="doc-ref" href="#docs\/docs\/workflow\/WORKFLOW\.md" data-doc="docs\/workflow\/WORKFLOW\.md">WORKFLOW\.md<\/a>/);
});

test('front matter shows as it is, and a comment doesn\'t show', () => {
  assert.match(markdown('---\nname: worker\n---\nBody'), /<pre class="md-front"><code>name: worker<\/code><\/pre><p>Body<\/p>/);
  assert.equal(markdown('<!-- a note for editors -->\nShown'), '<p>Shown</p>');
});
