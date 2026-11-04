// This PC's coding agent (server/agents.ps1): picked in Settings, and opened as the conductor and for onboarding.
// Never assume Claude: the user works with whichever agent their subscription gives them. In the app, the agent at
// work in a game is called Rocco, whichever agent it is ("Rocco is listening", "Ask Rocco"); the agent's own name is
// for the program itself: Settings, Connections, starting it, and its window.
import { state, emit } from './state.js';
import { api } from './api.js';

// "Claude Code", "Gemini CLI", ...
export const agentName = () => state.agent?.name || 'your agent';

export async function loadAgent() {
  try { state.agent = await api.agent(); emit('agent'); } catch { /* the sidebar shows the server is offline */ }
}

export async function chooseAgent(id) {
  state.agent = await api.setAgent(id);
  emit('agent');
}
