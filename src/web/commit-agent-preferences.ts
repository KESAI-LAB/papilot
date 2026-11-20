import { useSyncExternalStore } from 'react';
import { isAgentId, type AgentId } from '../shared.ts';
import { isPlayground } from './playground-mode.ts';
import { browserStorage } from './storage.ts';

export type CommitMessageChoice = { agent: AgentId; model: string; effort: string; serviceTier?: string };
export type CommitMessageAgent = CommitMessageChoice | 'conversation';

function agentPreference(key: string) {
  const read = (): CommitMessageAgent => {
    const value = browserStorage.getItem(key);
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
    if (event.key === key || event.key === null) apply(read());
  });
  return {
    save(value: CommitMessageAgent) {
      if (value === 'conversation') browserStorage.removeItem(key);
      else browserStorage.setItem(key, JSON.stringify(value));
      apply(value);
    },
    usePreference() {
      return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => choice);
    },
  };
}

export const { save: saveCommitMessageAgent, usePreference: useCommitMessageAgent } = agentPreference('papilot:commit-message-agent');
export const { save: saveConflictAgent, usePreference: useConflictAgent } = agentPreference('papilot:conflict-resolution-agent');

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
