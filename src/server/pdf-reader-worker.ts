import path from 'node:path';
import { readTrace, type CompiledPaper } from './writer/build-map.ts';
import { groupSectionNotes, type SectionHeading } from './note-sections.ts';
import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import type { OutlineEntry } from '../../engine/src/render/pdf.ts';
import type { Annotation } from '../shared.ts';
import { AnnotationPages, placeAnnotation, type AnnotationPlacement } from './annotation-placement.ts';
import { locateMark, type LineOp, type MarkRequest } from './note-location.ts';

const { engine } = workerData as { engine: string };
const [{ PdfDocument, containsCenter }, { opcodesWithin }] = await Promise.all([
  import(pathToFileURL(path.join(engine, 'src/render/pdf.ts')).href),
  import(pathToFileURL(path.join(engine, 'src/core/diff.ts')).href),
]);
type Document = InstanceType<typeof PdfDocument>;

// The documents one request reads, each opened once and closed at its end.
async function reading<T>(work: (open: (file: string) => Document) => Promise<T>) {
  const documents = new Map<string, Document>();
  try {
    return await work(file => {
      let document = documents.get(file);
      if (!document) documents.set(file, document = new PdfDocument(file));
      return document;
    });
  } finally { for (const document of documents.values()) document.close(); }
}

const operations = {
  sections: ({ compiled, key, notes }: { compiled: CompiledPaper; key: string; notes: Annotation[] }) => reading(async open => {
    const document = open(compiled.pdf);
    let traced;
    try { traced = readTrace(compiled, null); } catch { /* Older builds use PDF bookmarks. */ }
    const bookmarks: OutlineEntry[] = document.outline.filter((item: OutlineEntry) => item.page >= 0 && item.page < document.length);
    const position = (item: typeof bookmarks[number]) => {
      const page = document.page(item.page);
      return { page: item.page, top: (item.y - page.bounds[1]) / page.height };
    };
    const clean = (title: string) => title.replace(/\s+/g, ' ').trim();
    const headings: SectionHeading[] = traced?.headings.length ? traced.headings.map((heading, index) => {
      const title = clean([heading.number, heading.title].filter(Boolean).join(' '));
      const matches = bookmarks.filter(item => (heading.anchor && item.name === heading.anchor) || clean(item.title) === clean(title) || clean(item.title) === clean(heading.title));
      return { id: `section-${index}`, title, level: heading.level, ranges: heading.ranges, ...(matches.length === 1 ? { position: position(matches[0]) } : {}) };
    }) : bookmarks.map((item, index) => ({ id: `bookmark-${index}`, title: clean(item.title), level: item.level, position: position(item) }));
    // Stored source anchors may have followed edits made after this PDF.
    // Relocate in its immutable snapshot so heading and mark lines agree.
    const anchored: Annotation[] = [];
    for (const note of notes) {
      if (!traced?.headings.length || note.key !== key) { anchored.push(note); continue; }
      const located = await locateMark(document, { pdf: compiled.pdf, root: compiled.root, sourceDir: compiled.sourceDir, page: note.page, rect: note.rect, rects: note.rects || [], selected: note.quote }, { containsCenter, opcodesWithin }).catch(() => null);
      anchored.push({ ...note, source: located?.source || null });
    }
    return groupSectionNotes(anchored, key, headings);
  }),
  locate: (request: MarkRequest) => reading(open => locateMark(open(request.pdf), request, { containsCenter, opcodesWithin: opcodesWithin as (a: string[], b: string[], timeout: number) => LineOp[] | null })),
  // Notes from earlier PDFs, placed on the current one. A note whose place
  // cannot be verified, or whose PDF cannot be read, stays where it was.
  place: ({ current, notes }: { current: string; notes: { note: Annotation; previous: string }[] }) => reading(async open => {
    const pages = new Map<string, AnnotationPages>(), of = (file: string) => {
      let found = pages.get(file);
      if (!found) pages.set(file, found = new AnnotationPages(open(file)));
      return found;
    };
    const target = of(current), placed: (AnnotationPlacement | null)[] = [];
    for (const { note, previous } of notes) {
      try { placed.push(await placeAnnotation(note, of(previous), target)); }
      catch { placed.push(null); }
    }
    return placed;
  }),
};

parentPort!.on('message', async ({ id, op, args }: { id: number; op: keyof typeof operations; args: never }) => {
  try { parentPort!.postMessage({ id, value: await operations[op](args) }); }
  catch (error) { parentPort!.postMessage({ id, error: (error as Error)?.message || String(error) }); }
});
