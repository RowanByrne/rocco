// One request at a time for each thing the user can do: a second click while the first is still on its way does nothing.
const running = new Set();

export const busy = key => running.has(key);

// Runs fn unless key is already running. button: the one clicked, marked busy (aria-busy) until it's done.
// Returns what fn returns, or undefined when it was already running.
export async function once(key, fn, button = null) {
  if (running.has(key)) return undefined;
  running.add(key);
  button?.setAttribute('aria-busy', 'true');
  try { return await fn(); } finally {
    running.delete(key);
    button?.removeAttribute('aria-busy');
  }
}
