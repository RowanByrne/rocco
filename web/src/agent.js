// This PC's coding agent (server/agents.ps1): picked in Settings, opened for onboarding, and named wherever Rocco asks it
// for something. Never assume Claude: the user works with whichever agent their subscription gives them.
import { state, emit } from './state.js';
import { api } from './api.js';

// "Claude", "Codex", ...: for "Ask Codex", "Codex spotted".
export const agentShort = () => state.agent?.short || 'your agent';
// "Claude Code", "Gemini CLI", ...
export const agentName = () => state.agent?.name || 'your agent';

export async function loadAgent() {
  try { state.agent = await api.agent(); emit('agent'); } catch { /* the sidebar shows the server is offline */ }
}

export async function chooseAgent(id) {
  state.agent = await api.setAgent(id);
  emit('agent');
}
