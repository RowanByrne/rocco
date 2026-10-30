// Desktop notifications while Rocco is in the background (Settings can turn them off).
import { settings } from './settings.js';

export const notificationsAllowed = () => 'Notification' in window && Notification.permission === 'granted';

export async function askPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

// onClick: what to open when the user clicks it.
export function notify(title, body, onClick) {
  if (!settings().notifications || !document.hidden || !notificationsAllowed()) return;
  const n = new Notification(title, { body, icon: 'assets/rocco.svg', tag: title + body });
  n.onclick = () => { window.focus(); n.close(); onClick?.(); };
}
