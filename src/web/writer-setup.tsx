import { useEffect, useState } from 'react';
import type { WriterAuth, WriterProvider } from '../shared.ts';
import { Icon } from './icons.tsx';
import { errorText, t } from './i18n.ts';

// Papilot Writer's model providers: sign in with a ChatGPT or GitHub Copilot
// subscription, or save an API key. Papilot keeps these apart from any Pi
// installation on the host. Sign-in pages open in the browser; when their
// redirect cannot reach the Papilot host, the author pastes it here.
export function WriterSetup({ writer, online }: { writer: (route: string, body?: unknown) => Promise<WriterAuth>; online: boolean }) {
  const [auth, setAuth] = useState<WriterAuth | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({}), [code, setCode] = useState('');
  const waiting = auth?.logins.some(login => login.status === 'waiting');
  useEffect(() => {
    let stopped = false;
    const load = () => writer('/auth').then(value => { if (!stopped) { setAuth(value); setError(null); } }, e => { if (!stopped) setError(e instanceof Error ? e.message : String(e)); });
    void load();
    const timer = waiting ? setInterval(load, 1500) : undefined;
    return () => { stopped = true; if (timer) clearInterval(timer); };
  }, [writer, waiting]);
  async function act(key: string, route: string, body: unknown = {}) {
    setBusy(key); setError(null);
    try { setAuth(await writer(route, body)); return true; } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; } finally { setBusy(null); }
  }
  if (!auth) return error ? <p className="runtime-agent-error" role="alert">{error}</p> : <p className="runtime-agent-note" role="status">{t('Checking…')}</p>;
  const row = (provider: WriterProvider) => {
    const login = auth.logins.filter(item => item.provider === provider.id).at(-1);
    const live = login?.status === 'waiting';
    return <li key={provider.id} className="writer-provider" data-configured={provider.configured}>
      <div className="writer-provider-line">
        <span className="writer-provider-name">{provider.name}</span>
        {provider.configured && <span className="diagnostic-availability ready"><Icon name="check" size={12}/>{provider.kind === 'login' ? t('Signed in') : provider.source === 'environment' ? t('From {variable}', { variable: provider.env || '' }) : t('Saved')}</span>}
        <span className="writer-provider-actions">
          {provider.kind === 'login' && !live && (provider.configured
            ? <button type="button" className="button secondary compact" disabled={!online || Boolean(busy)} onClick={() => void act(provider.id, `/providers/${provider.id}/remove`)}>{t('Sign out')}</button>
            : <button type="button" className="button compact" disabled={!online || Boolean(busy)} onClick={() => void act(provider.id, '/logins', { provider: provider.id })}>{t('Sign in')}</button>)}
          {provider.kind === 'key' && provider.source === 'stored' && <button type="button" className="button secondary compact" disabled={!online || Boolean(busy)} onClick={() => void act(provider.id, `/providers/${provider.id}/remove`)}>{t('Remove')}</button>}
        </span>
      </div>
      {provider.kind === 'key' && !provider.configured && <form className="writer-key" onSubmit={event => { event.preventDefault(); void act(provider.id, '/keys', { provider: provider.id, key: keys[provider.id] || '' }).then(ok => { if (ok) setKeys(current => ({ ...current, [provider.id]: '' })); }); }}>
        <input type="password" autoComplete="off" spellCheck={false} aria-label={t('API key for {provider}', { provider: provider.name })} placeholder={provider.env} value={keys[provider.id] || ''} onChange={event => setKeys(current => ({ ...current, [provider.id]: event.target.value }))}/>
        <button type="submit" className="button secondary compact" disabled={!online || Boolean(busy) || !keys[provider.id]?.trim()}>{t('Save')}</button>
      </form>}
      {live && <div className="writer-login" role="status">
        {/* Provider instructions, such as a device code, are shown as given. */}
        {login.instructions && <p className="writer-login-instructions">{login.instructions}</p>}
        <div className="runtime-setup-actions">
          {login.url && <a className="button compact" href={login.url} target="_blank" rel="noopener noreferrer">{t('Open sign-in page')}<Icon name="external" size={12}/></a>}
          {login.url && <CopyLink url={login.url}/>}
          <button type="button" className="button secondary compact" onClick={() => void act(login.id, `/logins/${login.id}/cancel`)}>{t('Cancel')}</button>
        </div>
        {provider.id === 'openai-codex' && <form className="writer-key" onSubmit={event => { event.preventDefault(); void act(login.id, `/logins/${login.id}/code`, { code }).then(ok => { if (ok) setCode(''); }); }}>
          <input type="text" autoComplete="off" spellCheck={false} aria-label={t('Paste the redirect URL if the sign-in page cannot finish')} placeholder={t('Paste the redirect URL if the sign-in page cannot finish')} value={code} onChange={event => setCode(event.target.value)}/>
          <button type="submit" className="button secondary compact" disabled={Boolean(busy) || !code.trim()}>{t('Save')}</button>
        </form>}
      </div>}
      {login?.status === 'failed' && <p className="runtime-agent-error" role="alert">{login.error}</p>}
    </li>;
  };
  return <section className="writer-setup" aria-label={t('Model providers')}>
    <h5>{t('Subscriptions')}</h5>
    <ul className="writer-providers">{auth.providers.filter(provider => provider.kind === 'login').map(row)}</ul>
    <h5>{t('API keys')}</h5>
    <ul className="writer-providers">{auth.providers.filter(provider => provider.kind === 'key').map(row)}</ul>
    <p className="runtime-agent-note">{t('Claude works with an Anthropic API key only. Papilot keeps these credentials in its own data folder, separate from any Pi installation.')}</p>
    {error && <p className="runtime-agent-error" role="alert">{error}</p>}
  </section>;
}

// For signing in from another browser or device, where opening the page here does not help.
function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1600); return () => clearTimeout(timer); }, [copied]);
  async function copy() {
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; }
    catch {
      const area = document.createElement('textarea');
      area.value = url; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.append(area); area.select();
      try { ok = document.execCommand('copy'); } finally { area.remove(); }
    }
    setCopied(ok);
  }
  return <button type="button" className="button secondary compact" onClick={() => void copy()}><Icon name={copied ? 'check' : 'copy'} size={12}/>{copied ? t('Copied') : t('Copy link')}</button>;
}
