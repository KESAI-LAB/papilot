import { useSyncExternalStore } from 'react';
import { isAgentId, type AgentId } from '../shared.ts';
import { isPlayground } from './playground-mode.ts';
import { browserStorage } from './storage.ts';

const KEY = 'papilot:commit-message-agent';
export type CommitMessageChoice = { agent: AgentId; model: string; effort: string; serviceTier?: string };
export type CommitMessageAgent = CommitMessageChoice | 'conversation';
const read = (): CommitMessageAgent => {
  const value = browserStorage.getItem(KEY);
  // Migrate the original agent-only preference without changing its agent.
  if (isAgentId(value)) return { agent: value, model: '', effort: '' };
  try {
    const saved = JSON.parse(value || 'null');
    if (saved && isAgentId(saved.agent) && typeof saved.model === 'string' && typeof saved.effort === 'string') return { agent: saved.agent, model: saved.model, effort: saved.effort, ...(typeof saved.serviceTier === 'string' ? { serviceTier: saved.serviceTier } : {}) };
  } catch { /* An invalid preference follows the conversation. */ }
  return 'conversation';
};
let choice = read();
const listeners = new Set<() => void>();
function apply(value: CommitMessageAgent) { choice = value; listeners.forEach(listener => listener()); }
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === KEY || event.key === null) apply(read());
});
export function saveCommitMessageAgent(value: CommitMessageAgent) {
  if (value === 'conversation') browserStorage.removeItem(KEY);
  else browserStorage.setItem(KEY, JSON.stringify(value));
  apply(value);
}
export function useCommitMessageAgent() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => choice);
}

// Conversation context belongs to this tab; an override is shared across tabs.
// Session storage keeps Git reloads on the same conversation without allowing a
// different tab's conversation to change the agent under an open Git panel.
const conversations = new Map<string, string | null>();
export function commitConversation(key: string): string | null {
  if (!conversations.has(key)) {
    let saved = null;
    try { saved = sessionStorage.getItem((isPlayground ? 'playground:' : '') + key); } catch { /* Tab-local context still works. */ }
    conversations.set(key, saved);
  }
  return conversations.get(key) ?? null;
}
export function rememberCommitConversation(key: string, task: string) {
  conversations.set(key, task);
  try { sessionStorage.setItem((isPlayground ? 'playground:' : '') + key, task); } catch { /* Keep the in-memory context. */ }
}
