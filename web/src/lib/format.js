// Times, initials and colors, the way the app shows them.
export const hhmm = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};
export const minsSince = iso => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso)) / 60000)) : 0;
export const isToday = iso => !!iso && new Date(iso).toDateString() === new Date().toDateString();
export const agoText = iso => {
  if (!iso) return 'unknown';
  const m = minsSince(iso);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
};
export const initial = name => ((String(name || '').match(/[A-Za-z0-9]/) || ['?'])[0]).toUpperCase();

// A project's logo gradient, the same every time for the same id.
const hue = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 17);
export const logoVars = id => `--l1:hsl(${hue(id)},78%,64%);--l2:hsl(${(hue(id) + 70) % 360},72%,54%)`;

// A feature's own color, the same every time for the same plan.
export const featureVars = id => `--fc:hsl(${(hue(id) * 7) % 360},82%,68%)`;
