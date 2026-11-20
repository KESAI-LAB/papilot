import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { AnnotationBatch, AnnotationBatchResult } from '../shared.ts';
import { errorText, t, tn } from './i18n.ts';

export function ClearAnnotationsDialog({ target, name, disabled, unconfirmed, clear, onClose }: {
  target: AnnotationBatch;
  name: string;
  disabled: boolean;
  unconfirmed: boolean;
  clear: (target: AnnotationBatch) => Promise<AnnotationBatchResult>;
  onClose: () => void;
}) {
  const id = useId(), dialog = useRef<HTMLDialogElement>(null), running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(target.ids);
  const [failures, setFailures] = useState<string[]>([]);
  const retrying = unconfirmed || failures.length > 0;

  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  async function submit() {
    if (running.current || disabled) return;
    running.current = true;
    setBusy(true);
    try {
      const result = await clear({ ...target, ids: remaining });
      if (!result.failed.length) onClose();
      else {
        setRemaining(result.failed.map(note => note.id));
        setFailures([...new Set(result.failed.map(note => errorText(note.error)))]);
      }
    } catch (error) {
      setFailures([errorText(error instanceof Error ? error.message : String(error))]);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return <dialog ref={dialog} className="modal-backdrop clear-annotations-backdrop" aria-labelledby={id + '-title'} aria-describedby={id + '-scope'}
    closedby={busy ? 'none' : 'closerequest'}
    onCancel={event => { event.preventDefault(); if (!running.current) onClose(); }}>
    <section className="modal delete-dialog">
      <h2 id={id + '-title'}>{t('Clear all annotations?')}</h2>
      <div id={id + '-scope'}>
        <p className="delete-task-name">{name} · {tn(target.ids.length, '{n} annotation', '{n} annotations')}</p>
        <p>{t('Clears the confirmed annotations from this document. You can undo this.')}</p>
      </div>
      {busy && <progress aria-label={t('Clearing annotations…')}/>}
      {!busy && retrying && <div role="alert">
        <p>{unconfirmed ? t('Could not confirm which annotations were cleared.') : tn(remaining.length, '{n} annotation could not be cleared.', '{n} annotations could not be cleared.')}</p>
        {!!failures.length && <ul className="bulk-task-errors">{failures.map(error => <li key={error}>{error}</li>)}</ul>}
      </div>}
      <div className="button-row">
        <button type="button" autoFocus className="button secondary" disabled={busy} onClick={onClose}>{retrying ? t('Close') : t('Cancel')}</button>
        <button type="button" className="button danger" disabled={busy || disabled} onClick={() => void submit()}>{busy ? t('Clearing annotations…') : retrying ? t('Retry') : t('Clear all annotations')}</button>
      </div>
    </section>
  </dialog>;
}
