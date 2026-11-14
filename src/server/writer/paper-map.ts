import fs from 'node:fs';
import path from 'node:path';
import { engine } from '../references.ts';
import type { BibliographyReport } from '../../shared.ts';
import { argumentOf, blankComments, lineAt, project, simpleMacros } from './plain-text.ts';

// The paper map: what Papilot Writer knows about the manuscript before it
// reads a line. It is rebuilt from the sources at the start of every turn,
// so the model plans its reading and edits from the paper's structure
// (sections with their line ranges, labels, citations, floats, macros and
// the last build) instead of searching the file tree blind.

export interface Heading { id: string; title: string; number: string; kind: string; level: number; file: string; line: number; labels: string[]; ranges?: Record<string, [number, number][]>; parent?: string | null }
interface Paper {
  loadProject(root: string): { main: string };
  buildOutline(read: (file: string) => string | null, main: string): { nodes: Heading[] };
  documentFiles(read: (file: string) => string | null, main: string): { files: string[]; bibs: string[] };
  bibliographyReport(doc: { read(file: string): string | null; main: string; outline: unknown[] }): Omit<BibliographyReport, 'checks' | 'pending' | 'confirmed'>;
  stripComments(text: string): string;
}
export const paper = async () => (await engine()) as unknown as Paper;

/** The last build Papilot Writer ran in this task, if any. */
export interface BuildNote { ok: boolean; at: number; pages?: number; errors: string[]; warnings: string[] }

export interface PaperMap {
  main: string | null;
  text: string;
  files: string[];
  bibs: string[];
  outline: Heading[];
  /** Every document file's source, by worktree-relative path. */
  sources: Map<string, string>;
}

export function reader(root: string) {
  return (file: string) => {
    const target = path.resolve(root, file);
    if (target !== root && !target.startsWith(root + path.sep)) return null;
    try { return fs.statSync(target).isFile() ? fs.readFileSync(target, 'utf8') : null; } catch { return null; }
  };
}
// A main file when the project settings name none: the .tex file at the top
// that has \documentclass, preferring main.tex.
export function guessMain(root: string) {
  const names = fs.readdirSync(root).filter(name => name.endsWith('.tex')).sort((a, b) => Number(b === 'main.tex') - Number(a === 'main.tex') || a.localeCompare(b));
  return names.find(name => /^[^%\n]*\\documentclass/m.test(fs.readFileSync(path.join(root, name), 'utf8'))) || null;
}
const words = (text: string) => (text.replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?/g, ' ').match(/[\p{L}\p{N}]+/gu) || []).length;
const cap = <T>(items: T[], limit: number, show: (item: T) => string) =>
  items.length > limit ? `${items.slice(0, limit).map(show).join(', ')}, and ${items.length - limit} more` : items.map(show).join(', ');
const compactWords = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k words` : `${n} words`;

const REF = /\\(?:ref|eqref|pageref|autoref|cref|Cref|vref|Vref|nameref|cpageref|Cpageref|labelcref)\*?\s*\{([^}]*)\}/g;
const LABEL = /\\label\s*\{([^}]*)\}/g;
const FLOAT = /\\begin\s*\{(figure|table|algorithm|listing)\*?\}([\s\S]*?)\\end\s*\{\1\*?\}/g;
const MACRO = /\\(?:(?:re)?newcommand|providecommand|DeclareRobustCommand|NewDocumentCommand|DeclareMathOperator)\*?\s*\{?\\([a-zA-Z@]+)\}?\s*(?:\[(\d)\])?|\\def\\([a-zA-Z@]+)/g;

/** Builds the map of the paper in a worktree. Never throws. */
export async function paperMap(root: string, build?: BuildNote | null): Promise<PaperMap> {
  const lines: string[] = [];
  let main: string | null = null, files: string[] = [], bibs: string[] = [], outline: Heading[] = [], raw = new Map<string, string>();
  try {
    root = fs.realpathSync(root);
    const mods = await paper(), read = reader(root);
    try { main = mods.loadProject(root).main; } catch { main = guessMain(root); }
    if (!main || read(main) == null) main = guessMain(root);
    if (!main) {
      lines.push('No main LaTeX file was found in the worktree (no top-level .tex file with \\documentclass).');
      return { main, text: lines.join('\n'), files, bibs, outline, sources: raw };
    }
    ({ files, bibs } = mods.documentFiles(read, main));
    const sources = new Map(files.map(file => [file, mods.stripComments(read(file) || '')] as const));
    const head = sources.get(main) || '';
    const documentClass = /\\documentclass\s*(\[[^\]]*\])?\s*\{([^}]+)\}/.exec(head);
    lines.push(`Main file: ${main}${documentClass ? ` (\\documentclass${documentClass[1] || ''}{${documentClass[2]}})` : ''}`);
    lines.push(`Source files (${files.length}): ${cap(files, 40, file => `${file} (${(read(file) || '').split('\n').length} lines)`)}`);
    if (bibs.length) lines.push(`Bibliography files: ${bibs.join(', ')}`);

    // The title and abstract stay in view on every turn: most edits are
    // judged against what the paper claims.
    raw = new Map(files.map(file => [file, read(file) || ''] as const));
    const textMacros = simpleMacros([...raw.values()]);
    const pinned = (name: 'title' | 'abstract') => {
      // Drafts keep old titles commented out; only the live one counts.
      for (const [file, source] of [...raw].map(([file, text]) => [file, blankComments(text)] as const)) {
        const range = name === 'title' ? argumentOf(source, 'title')
          : (() => { const m = /\\begin\s*\{abstract\}([\s\S]*?)\\end\s*\{abstract\}/.exec(source); return m ? { start: m.index + m[0].indexOf('}') + 1, end: m.index + m[0].length - '\\end{abstract}'.length } : argumentOf(source, 'abstract'); })();
        if (range) return { file, line: lineAt(source, range.start), lastLine: lineAt(source, range.end), text: project(source.slice(range.start, range.end), textMacros).text.trim() };
      }
      return null;
    };
    const title = pinned('title'), abstract = pinned('abstract');
    lines.unshift(...[
      title ? `Title (${title.file}:${title.line}): ${title.text}` : 'Title: none found (no \\title).',
      abstract ? `Abstract (${abstract.file}:${abstract.line}-${abstract.lastLine}):\n${abstract.text.slice(0, 3000)}${abstract.text.length > 3000 ? ' …' : ''}` : 'Abstract: none found.',
      '',
    ]);

    outline = mods.buildOutline(read, main).nodes;
    if (outline.length) {
      lines.push('', 'Outline (each part with every file and line range it spans, subsections included):');
      const top = Math.min(...outline.map(node => node.level));
      lines.push(...outlineLines(outline, outline.length > 150 ? 1 : 9, raw, mods.stripComments, top));
      if (outline.length > 150) lines.push(`  … deeper headings omitted (${outline.length} in all); use paper_outline with a section.`);
    }

    const labels = new Map<string, string>(), refs = new Map<string, string[]>();
    for (const [file, text] of sources) {
      const at = (index: number) => `${file}:${text.slice(0, index).split('\n').length}`;
      for (const m of text.matchAll(LABEL)) labels.set(m[1].trim(), at(m.index!));
      for (const m of text.matchAll(REF)) for (const key of m[1].split(',').map(k => k.trim()).filter(Boolean)) refs.set(key, [...(refs.get(key) || []), at(m.index!)]);
    }
    const undefinedRefs = [...refs.keys()].filter(key => !labels.has(key));
    const unused = [...labels.keys()].filter(key => !refs.has(key) && !/^(?:eq|equation)/.test(key));
    lines.push('', `Labels: ${labels.size} defined, ${refs.size} referenced.`);
    if (undefinedRefs.length) lines.push(`Referenced but never defined: ${cap(undefinedRefs, 15, key => `${key} (${refs.get(key)![0]})`)}`);
    if (unused.length) lines.push(`Defined but never referenced: ${cap(unused, 15, key => key)}`);

    const floats: string[] = [];
    for (const [file, text] of sources) for (const m of text.matchAll(FLOAT)) {
      const caption = /\\caption\s*(?:\[[^\]]*\])?\s*\{([^]*?)\}\s*(?:\\label|\n|$)/.exec(m[2])?.[1].replace(/\s+/g, ' ').trim().slice(0, 90);
      const label = /\\label\s*\{([^}]*)\}/.exec(m[2])?.[1];
      floats.push(`${m[1]} ${label || '(no label)'} ${file}:${text.slice(0, m.index!).split('\n').length}${caption ? ` "${caption}${caption.length >= 90 ? '…' : ''}"` : ''}`);
    }
    if (floats.length) lines.push('', `Floats (${floats.length}):`, ...floats.slice(0, 40).map(line => `- ${line}`), ...(floats.length > 40 ? [`- … ${floats.length - 40} more`] : []));

    const macros = new Set<string>();
    for (const [, text] of sources) for (const m of text.matchAll(MACRO)) macros.add(`\\${m[1] || m[3]}${m[2] ? `[${m[2]}]` : ''}`);
    if (macros.size) lines.push('', `Macros defined by the paper (${macros.size}): ${cap([...macros], 60, name => name)}`);

    try {
      const report = mods.bibliographyReport({ read, main, outline });
      const cited = report.entries.filter(entry => entry.cited.length).length;
      lines.push('', `References: ${report.entries.length} ${report.entries.length === 1 ? 'entry' : 'entries'} in ${report.bibs.join(', ') || 'no .bib file'}, ${cited} cited.`);
      if (report.missing.length) lines.push(`Cited but missing from the bibliography: ${cap([...new Set(report.missing.map(item => item.key))], 15, key => key)}`);
      if (report.duplicates.length) lines.push(`Duplicate entries: ${cap(report.duplicates, 10, ids => ids.join(' = '))}`);
      if (report.absent.length) lines.push(`Bibliography files that do not exist: ${report.absent.join(', ')}`);
    } catch { /* A malformed .bib shows up in the build instead. */ }
  } catch (error) {
    lines.push(`The paper map could not be built: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (build) {
    lines.push('', `Last check_build (${new Date(build.at).toISOString().slice(11, 16)} UTC): ${build.ok ? 'compiled' : 'failed'}${build.pages ? `, ${build.pages} pages` : ''}, ${build.errors.length} errors, ${build.warnings.length} warnings.`);
    for (const error of build.errors.slice(0, 5)) lines.push(`- error: ${error}`);
  } else lines.push('', 'Not compiled by you yet in this task. Call check_build after edits that could break the build.');
  return { main, text: lines.join('\n'), files, bibs, outline, sources: raw };
}

const spans = (node: Heading) => Object.entries(node.ranges || {}).map(([file, list]) => `${file}:${list.map(([a, b]) => a === b ? `${a}` : `${a}-${b}`).join(',')}`).join('; ') || `${node.file}:${node.line}`;
/** The outline as a nested list: number, title, where it is, size, labels. */
export function outlineLines(nodes: Heading[], maxLevel: number, raw: Map<string, string>, strip: (text: string) => string, base = 0) {
  return nodes.filter(node => node.level - base <= maxLevel).map(node => {
    let size = 0;
    for (const [file, list] of Object.entries(node.ranges || {})) {
      const text = (raw.get(file) || '').split('\n');
      for (const [a, b] of list) size += words(strip(text.slice(a - 1, b).join('\n')));
    }
    return `${'  '.repeat(Math.max(0, node.level - base))}- ${node.number ? node.number + ' ' : ''}${node.title} — ${spans(node)} (${compactWords(size)})${node.labels.length ? ` [${node.labels.join(', ')}]` : ''}`;
  });
}

/** The map as the model sees it at the start of a turn. */
export const mapMessage = (map: PaperMap) =>
  `<paper-map>\nThis is the current map of the paper in your task worktree, rebuilt at the start of this turn. It replaces any earlier map. Line numbers are 1-based.\n\n${map.text}\n</paper-map>`;
