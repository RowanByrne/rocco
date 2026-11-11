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

// A model's name as people say it: claude-opus-5-5 is Opus 5.5. Any other name shows as it was typed.
const NAMED = { opusplan: 'Opus plan mode', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' };
export function modelName(id) {
  if (!id) return 'Default';
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/i.exec(id);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
  return NAMED[id] || id;
}
// What each is for, under its name in the picker.
export const MODEL_NOTES = {
  'claude-fable-5-2': 'Most capable, for the hardest work',
  'claude-opus-5-5': 'Strong all-round, for complex work',
  'claude-sonnet-5-5': 'Fast and capable, for everyday work',
  'claude-haiku-5-5': 'Fastest, for simple work',
  opusplan: 'Opus to plan, Sonnet to build',
};
export const effortName = e => e === 'xhigh' ? 'Extra high' : e ? e[0].toUpperCase() + e.slice(1) : 'Default';

export async function chooseModel(model) { state.agent = await api.setAgentModel(model); emit('agent'); }
export async function chooseEffort(effort) { state.agent = await api.setAgentEffort(effort); emit('agent'); }
