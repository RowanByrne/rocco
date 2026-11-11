// Small DOM helpers.
export const $ = selector => document.querySelector(selector);
export const $$ = selector => [...document.querySelectorAll(selector)];
// For the few places that still build markup as text (lib/markdown.js, and the task chip it's given): templates
// (lib/html.js) escape by themselves.
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// An address from data (a repo, a game page event), for a link: only a web address goes through.
export const webUrl = url => /^https?:\/\//i.test(String(url ?? '')) ? String(url) : '#';
