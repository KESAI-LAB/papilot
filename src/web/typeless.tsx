import { useEffect, useId, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { TypelessStatus } from '../../desktop/typeless-control.ts';
import { browserStorage } from './storage.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';

export const typelessAvailable = Boolean(window.papilotDesktop?.platform === 'darwin' && window.papilotDesktop.typelessShortcut);
const KEY = 'papilot:typeless';
const listeners = new Set<() => void>();
const read = () => typelessAvailable && browserStorage.getItem(KEY) === 'on';
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
window.addEventListener('storage', event => { if (event.key === KEY || event.key === null) listeners.forEach(listener => listener()); });
function useEnabled() { return useSyncExternalStore(subscribe, read); }

function description(info: TypelessStatus): string {
  switch (info.status) {
    case 'ready': return t('Typeless shortcut: {shortcut}', { shortcut: info.shortcut! });
    case 'sent': return t('Sent {shortcut}. Check the Typeless voice bar.', { shortcut: info.shortcut! });
    case 'not-detected': return t('Install Typeless on this Mac to use voice notes.');
    case 'shortcut-unavailable': return t('Set a supported keyboard shortcut in Typeless, then refresh.');
    case 'permission': return t('Allow Papilot in System Settings → Privacy & Security → Accessibility, then refresh.');
    case 'not-running': return t('Open Typeless, then try again.');
    case 'keys-held': return t('Release the modifier keys, then try again.');
    default: return t('Could not send the Typeless shortcut. Focus this note and try again.');
  }
}

export function TypelessExperiment() {
  const id = useId(), enabled = useEnabled();
  const [info, setInfo] = useState<TypelessStatus | null>(null), [loading, setLoading] = useState(false);
  async function refresh() {
    setLoading(true);
    try { setInfo(await window.papilotDesktop!.typelessStatus!()); }
    catch { setInfo({ status: 'unavailable' }); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (typelessAvailable) void refresh(); }, []);
  if (!typelessAvailable) return null;
  return <div className="settings-card typeless-experiment">
    <div className="settings-row settings-toggle">
      <div className="settings-text">
        <label className="settings-name" htmlFor={id}>{t('Voice notes with Typeless')}</label>
        <p id={id + '-detail'}>{t('New PDF notes send your Typeless shortcut. Use the microphone button to send it again; wait for the transcript before leaving the note.')}</p>
        <p role="status">{info ? description(info) : t('Loading…')}</p>
        <button type="button" className="button secondary compact" onClick={() => void refresh()} disabled={loading}>{t('Refresh')}</button>
      </div>
      <input id={id} type="checkbox" role="switch" className="switch" checked={enabled} aria-describedby={id + '-detail'} disabled={!enabled && (loading || info?.status !== 'ready')} onChange={event => {
        browserStorage.setItem(KEY, event.target.checked ? 'on' : 'off');
        listeners.forEach(listener => listener());
      }}/>
    </div>
  </div>;
}

export function useTypelessNote(input: RefObject<HTMLTextAreaElement | null>, eligible: boolean) {
  const inputId = useId(), enabled = useEnabled(), attempted = useRef(false), pending = useRef(false);
  const [sending, setSending] = useState(false), [info, setInfo] = useState<TypelessStatus | null>(null);
  const available = enabled && eligible;
  useEffect(() => {
    // Keep the target stable for the short native delivery handshake. This
    // also stops an unconsumed shortcut reaching the note's Enter/Escape paths.
    const hold = (event: Event) => { if (pending.current) { event.preventDefault(); event.stopImmediatePropagation(); } };
    window.addEventListener('pointerdown', hold, true);
    window.addEventListener('click', hold, true);
    window.addEventListener('keydown', hold, true);
    return () => { window.removeEventListener('pointerdown', hold, true); window.removeEventListener('click', hold, true); window.removeEventListener('keydown', hold, true); };
  }, []);
  async function send() {
    const element = input.current;
    if (!available || pending.current || !element?.isConnected) return;
    element.focus({ preventScroll: true });
    pending.current = true; setSending(true);
    try { setInfo(await window.papilotDesktop!.typelessShortcut!(inputId)); }
    catch { setInfo({ status: 'unavailable' }); }
    finally { pending.current = false; setSending(false); }
  }
  useEffect(() => {
    if (attempted.current || !eligible) return;
    const frame = requestAnimationFrame(() => {
      attempted.current = true;
      if (available && input.current === document.activeElement) void send();
    });
    return () => cancelAnimationFrame(frame);
  }, [available, eligible]);
  // No recording state is inferred from key delivery. In particular, closing
  // the card must never send a speculative toggle that could start recording.
  const label = t('Send Typeless shortcut');
  return {
    inputId,
    pending,
    button: available && <button type="button" className="icon-button" aria-label={label} title={label} disabled={sending} onPointerDown={event => event.preventDefault()} onClick={event => { if (event.detail < 2) void send(); }}><Icon name="microphone" size={16}/></button>,
    hint: available && <p className="typeless-note-status" role="status">{info ? description(info) : t('Wait for Typeless to finish before leaving this note.')}</p>,
  };
}
