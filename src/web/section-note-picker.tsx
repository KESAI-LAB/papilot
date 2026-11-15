import { useId, useState } from 'react';
import type { NoteSection } from '../shared.ts';
import { t } from './i18n.ts';
import './section-note-picker.css';

export function SectionNotePicker({ sections, unplaced = 0, disabled, has, select }: { sections: NoteSection[]; unplaced?: number; disabled: boolean; has: (id: string) => boolean; select: (ids: string[]) => void }) {
  const id = useId(), [choice, setChoice] = useState('');
  const current = sections.find(section => section.id === choice) || sections[0];
  const level = Math.min(...sections.map(section => section.level));
  const selected = current?.notes.filter(has).length || 0;
  return <div className="section-note-picker">
    <label htmlFor={id}>{t('Select comments by section')}</label>
    {current ? <>
      <select id={id} value={current.id} disabled={disabled} onChange={event => setChoice(event.target.value)}>
        {sections.map(section => <option key={section.id} value={section.id}>{'\u2003'.repeat(Math.max(0, Math.min(6, section.level - level)))}{section.title} · {section.notes.length}</option>)}
      </select>
      <div className="section-note-actions">
        <button type="button" className="button secondary compact" disabled={disabled || !current.notes.length || selected === current.notes.length} onClick={() => select(current.notes)}>{t('Select comments in this section')}</button>
        <span role="status">{t('{selected} of {total} selected', { selected, total: current.notes.length })}</span>
      </div>
      <p>{t('Includes subsections. Review the selected comments in New task before sending.')}</p>
      {unplaced > 0 && <p>{t('Unplaced comments: {n}. You can select them individually.', { n: unplaced })}</p>}
    </> : <p>{t('Section selection needs a compiled paper outline or PDF bookmarks.')}</p>}
  </div>;
}
