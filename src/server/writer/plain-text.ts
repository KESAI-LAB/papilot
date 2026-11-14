// The paper's text as a reader sees it, with a way back to the source. A
// phrase in the PDF is often broken up in the LaTeX: by line breaks, ~, \emph,
// a macro standing for a name (\method), a comment or a citation. Searching
// this projection finds the phrase anyway, and each character remembers the
// source offset it came from, so a match is reported as file:line.

/** Macros whose arguments are not running text: dropped with their arguments. */
const DROP = new Set(['label', 'ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref', 'vref', 'Vref', 'nameref', 'cpageref', 'Cpageref', 'labelcref',
  'cite', 'citep', 'citet', 'citealp', 'citealt', 'citeauthor', 'citeyear', 'citeyearpar', 'parencite', 'textcite', 'autocite', 'footcite', 'nocite', 'Cite', 'Citep', 'Citet',
  'begin', 'end', 'input', 'include', 'includegraphics', 'includepdf', 'usepackage', 'RequirePackage', 'documentclass', 'bibliography', 'bibliographystyle', 'addbibresource',
  'vspace', 'hspace', 'vskip', 'hskip', 'setlength', 'addtolength', 'setcounter', 'addtocounter', 'color', 'pagecolor', 'linespread', 'fontsize', 'newcommand', 'renewcommand',
  'providecommand', 'DeclareMathOperator', 'newenvironment', 'renewenvironment', 'def', 'let', 'graphicspath', 'pagestyle', 'thispagestyle', 'hypersetup', 'definecolor', 'url']);
/** Macros whose first argument is dropped and the rest kept (\textcolor{red}{text}, \href{url}{text}). */
const DROP_FIRST = new Set(['textcolor', 'href', 'colorbox']);
/** Placeholders for references and citations, so "Figure~\ref{x} shows" reads "Figure [ref] shows". */
const STAND_IN: Record<string, string> = { ref: '[ref]', eqref: '([ref])', autoref: '[ref]', cref: '[ref]', Cref: '[ref]', cite: '[cite]', citep: '[cite]', citet: '[cite]', parencite: '[cite]', textcite: '[cite]', autocite: '[cite]' };
const SYMBOLS: Record<string, string> = { '&': '&', '%': '%', '$': '$', '#': '#', '_': '_', '{': '{', '}': '}', ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ', '/': '', '-': '', '@': '' };
const WORDS: Record<string, string> = { LaTeX: 'LaTeX', TeX: 'TeX', ldots: '...', dots: '...', textendash: '–', textemdash: '—', S: '§', ie: 'i.e.', eg: 'e.g.', etal: 'et al.' };

export interface Projection { text: string; offsets: number[] }

/** Simple macros defined in the paper (no arguments, plain text body). */
export function simpleMacros(sources: string[]) {
  const macros = new Map<string, string>();
  for (const source of sources) for (const m of source.matchAll(/\\(?:re)?newcommand\*?\s*\{?\\([a-zA-Z@]+)\}?\s*\{((?:[^{}]|\{[^{}]*\})*)\}|\\def\\([a-zA-Z@]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
    const name = m[1] || m[3], body = m[2] ?? m[4];
    // A body with # takes arguments; one with math or structure is not plain text.
    if (!/[#$]|\\(?:begin|ensuremath|mathrm|mathbf|operatorname)/.test(body)) macros.set(name, project(body, new Map()).text.trim());
  }
  return macros;
}

// The end of a balanced {...} group starting at an opening brace.
function groupEnd(source: string, at: number) {
  let depth = 0;
  for (let i = at; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '%') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i + 1;
  }
  return source.length;
}
const skipSpace = (source: string, at: number) => { while (at < source.length && /[ \t]/.test(source[at])) at++; return at; };
function skipOptional(source: string, at: number) {
  const next = skipSpace(source, at);
  if (source[next] !== '[') return at;
  let depth = 0;
  for (let i = next; i < source.length; i++) { if (source[i] === '[') depth++; else if (source[i] === ']' && --depth === 0) return i + 1; }
  return at;
}

/** Projects LaTeX source onto reading text. */
export function project(source: string, macros: Map<string, string>): Projection {
  let text = '';
  const offsets: number[] = [];
  const emit = (value: string, from: number) => {
    for (const ch of value) {
      if (/\s/.test(ch)) { if (text && !text.endsWith(' ')) { text += ' '; offsets.push(from); } }
      else { text += ch; offsets.push(from); }
    }
  };
  for (let i = 0; i < source.length;) {
    const ch = source[i];
    if (ch === '%') { while (i < source.length && source[i] !== '\n') i++; i++; i = skipSpace(source, i); continue; }
    if (ch === '{' || ch === '}') { i++; continue; }
    if (ch === '~') { emit(' ', i); i++; continue; }
    if (ch === '\\') {
      const word = /^[a-zA-Z@]+\*?/.exec(source.slice(i + 1, i + 60))?.[0];
      if (!word) {
        const next = source[i + 1];
        if (next === '\\') { emit(' ', i); i = skipOptional(source, i + 2); continue; }
        if (next && next in SYMBOLS) { emit(SYMBOLS[next], i); i += 2; continue; }
        // An accent such as \'e or \"o: keep the letter.
        i += 2; continue;
      }
      const name = word.replace(/\*$/, ''), start = i;
      i += 1 + word.length;
      if (DROP.has(name) || DROP_FIRST.has(name)) {
        let count = DROP_FIRST.has(name) ? 1 : name === 'newcommand' || name === 'renewcommand' || name === 'providecommand' || name === 'definecolor' ? 3 : name === 'setlength' || name === 'addtolength' || name === 'setcounter' || name === 'addtocounter' ? 2 : 1;
        if (name === 'def') { i = groupEnd(source, source.indexOf('{', i)); emit(' ', start); continue; }
        while (count-- > 0) {
          i = skipOptional(source, i); i = skipOptional(source, i);
          const open = skipSpace(source, i);
          if (source[open] === '{') i = groupEnd(source, open);
          else if (source[open] === '\\') i = open + 1 + (/^[a-zA-Z@]+/.exec(source.slice(open + 1))?.[0].length || 1);
        }
        if (STAND_IN[name]) emit(` ${STAND_IN[name]}`, start);
        else if (name !== 'begin' && name !== 'end') emit(' ', start);
        continue;
      }
      const replacement = macros.get(name) ?? WORDS[name];
      if (replacement !== undefined) {
        emit(replacement, start);
        // \method{} and "\method " both end the macro name.
        const after = skipSpace(source, i);
        if (source.startsWith('{}', after)) i = after + 2;
        else if (source[i] === ' ' && replacement) emit(' ', i);
        continue;
      }
      // Any other macro: its name disappears and its arguments read as text.
      i = skipOptional(source, i);
      continue;
    }
    emit(ch, i);
    i++;
  }
  return { text, offsets };
}

/** The line, counted from 1, of an offset in the source. */
export function lineAt(source: string, offset: number) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

/** The balanced argument of the first \name{...} in a source, or null. */
export function argumentOf(source: string, name: string) {
  const m = new RegExp(`\\\\${name}\\*?\\s*(?:\\[[^\\]]*\\]\\s*)?\\{`).exec(source);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  return { start: open + 1, end: groupEnd(source, open) - 1 };
}
