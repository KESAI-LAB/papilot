import { useId, useState } from 'react';
import { AgentPicker, type AgentOption } from './agent-picker.tsx';
import { agentLabel } from './agent-choice.ts';
import { saveCommitMessageAgent, useCommitMessageAgent, type CommitMessageChoice } from './commit-agent-preferences.ts';
import { t } from './i18n.ts';
import type { RefreshUsage } from './usage.tsx';

export function CommitAgentSettings({ current, agents, reconnect, refreshUsage }: { current: CommitMessageChoice; agents: AgentOption[]; reconnect?: () => Promise<void>; refreshUsage?: RefreshUsage }) {
  const id = useId(), preference = useCommitMessageAgent();
  const [reconnecting, setReconnecting] = useState(false), [error, setError] = useState('');
  const following = preference === 'conversation';
  const options = agents.some(item => item.value === current.agent) ? agents : [...agents, { value: current.agent, label: agentLabel(current.agent), runtime: { connected: false, authenticated: false, installed: false, account: null, error: null, models: [] } }];
  const models = options.find(item => item.value === current.agent)?.runtime?.models || [];
  const model = models.find(item => current.model ? item.id === current.model : item.isDefault);
  return <>
    <div className="settings-row settings-toggle">
      <div className="settings-text">
        <label className="settings-name" htmlFor={id}>{t('Follow current conversation')}</label>
        <p id={`${id}-detail`}>{t('Use the conversation’s model and reasoning effort, or the new-task settings if none. An explicit choice applies only to commit messages and is saved in this browser.')}</p>
      </div>
      <input id={id} type="checkbox" role="switch" className="switch" aria-describedby={`${id}-detail`} checked={following} onChange={event => saveCommitMessageAgent(event.target.checked ? 'conversation' : current)}/>
    </div>
    <div className="settings-row settings-choice">
      <div className="settings-text"><span className="settings-name">{t('Commit-message agent')}</span>{error && <p role="alert">{error}</p>}</div>
      <AgentPicker refreshUsage={refreshUsage} agents={options} agent={current.agent} model={current.model} effort={current.effort} fast={Boolean(current.serviceTier && current.serviceTier !== 'default')}
        reconnecting={reconnecting} onReconnect={() => { if (!reconnect) return; setReconnecting(true); setError(''); void reconnect().catch(error => setError(error instanceof Error ? error.message : String(error))).finally(() => setReconnecting(false)); }}
        onSelect={(agent, selected) => {
          const next = options.find(item => item.value === agent)?.runtime?.models.find(item => selected ? item.id === selected : item.isDefault);
          saveCommitMessageAgent({ agent, model: selected, effort: next?.efforts.includes(current.effort) ? current.effort : '', ...(agent === 'codex' ? { serviceTier: current.agent === agent && next?.fastMode?.serviceTier === current.serviceTier ? current.serviceTier : 'default' } : {}) });
        }}
        onChange={change => saveCommitMessageAgent({ ...current, ...(change.effort !== undefined ? { effort: change.effort } : {}), ...(change.fast !== undefined ? { serviceTier: change.fast ? model?.fastMode?.serviceTier : 'default' } : {}) })}/>
    </div>
  </>;
}
