// This browser's preferences: the open project, the sidebar. Never data that must last; that lives in the project folder.
export const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
};
