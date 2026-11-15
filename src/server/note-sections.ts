import type { Annotation, NoteSection } from '../shared.ts';

export interface SectionHeading {
  id: string; title: string; level: number;
  ranges?: Record<string, [number, number][]>;
  /** PDF coordinates normalized from the top of a zero-based page. */
  position?: { page: number; top: number };
}
export interface NoteSections { sections: NoteSection[]; contexts: Record<string, string[]>; unplaced: number }

/** Source ranges are authoritative (including columns and included files).
 * Without a source anchor, use exact bookmark destinations, never page-only
 * guesses between headings on the same page. Stale marks are not selected. */
export function groupSectionNotes(notes: Annotation[], key: string, headings: SectionHeading[]): NoteSections {
  const sections = headings.map(({ id, title, level }) => ({ id, title, level, notes: [] as string[] }));
  const paths: number[][] = [], stack: number[] = [];
  headings.forEach((heading, index) => {
    while (stack.length && headings[stack.at(-1)!].level >= heading.level) stack.pop();
    stack.push(index); paths.push([...stack]);
  });
  const contexts: Record<string, string[]> = {};
  let unplaced = 0;
  for (const note of notes) {
    if (note.key !== key) { unplaced++; continue; }
    let chosen = -1;
    if (note.source) {
      // Require the whole source range: a mark crossing sibling sections
      // belongs to their shared parent, not arbitrarily to the last sibling.
      headings.forEach((heading, index) => {
        if (heading.ranges?.[note.source!.file]?.some(([start, end]) => start <= note.source!.lines[0] && end >= note.source!.lines[1])
          && (chosen < 0 || heading.level > headings[chosen].level)) chosen = index;
      });
    }
    if (chosen < 0) {
      const top = (note.rects?.length ? note.rects[0] : note.rect)[1];
      // The last heading before the mark, in document order. Unknown
      // destinations break certainty until a later known heading starts.
      for (let index = 0; index < headings.length; index++) {
        const at = headings[index].position;
        if (!at) continue;
        if (at.page < note.page || (at.page === note.page && at.top <= top + 0.002)) chosen = index;
      }
      if (chosen >= 0) {
        const next = headings[chosen + 1];
        if (next && !next.position) chosen = -1;
      }
    }
    if (chosen < 0) { unplaced++; continue; }
    for (const index of paths[chosen]) sections[index].notes.push(note.id);
    contexts[note.id] = ['Section: ' + paths[chosen].map(index => headings[index].title).join(' > ')];
  }
  return { sections, contexts, unplaced };
}
