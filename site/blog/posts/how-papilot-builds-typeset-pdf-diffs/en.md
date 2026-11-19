This post follows one review round through Papilot's code, from the agent's last file write to your decision on the page. Paths refer to the [repository](https://github.com/PapilotAI/papilot); the numbers come from [docs/performance.md](https://github.com/PapilotAI/papilot/blob/main/docs/performance.md), measured on a 240 MB thesis with XeLaTeX, BibTeX, minted and chapters split with `\include`.

## A worktree and a snapshot

Each task is a detached Git worktree created from a snapshot of the manuscript, uncommitted edits included (`engine/src/core/tasks.ts`). The agent runs with that worktree as its working directory and sandbox.

A round starts by recording the worktree as a Git tree. Hashing a thesis on every round would be slow, so the snapshot goes through a private index file, `papilot/snapshot-index` in the worktree's Git directory (the manuscript has its own, `.git/papilot/working-index`). The index is seeded from the previous snapshot or from the repository's index, so Git rehashes only files whose size or modification time changed. Each snapshot is taken twice and compared, so a file saved halfway through cannot produce a tree that never existed on disk. On the thesis, a snapshot went from 2.1 s to 0.1 s.

## Building both sides

Every build runs in its own folder, keyed by what it compiles, so SyncTeX always points at the exact source of the PDF on screen. Starting each folder empty would throw away latexmk's state, so a new folder starts from the closest previous one (`engine/src/core/build.ts`):

- **Pick a base.** Of the last 16 error-free builds with the same chapters, compiler settings and compiler version, the one whose tree differs from the new one in the fewest files (`git diff-tree`), the newer on a tie.
- **Clone, then patch.** The base's sources are cloned copy-on-write (`cp -c -R` on APFS). Files outside the new tree are removed, files with the same Git object and size are kept, and the rest stream from a single `git cat-file --batch`. LaTeX's output files are cloned with `COPYFILE_FICLONE`. Exporting the thesis takes 0.76 s; copying its LaTeX state, 0.06 s.
- **Keep latexmk's state.** `.aux`, `.bbl`, `.fdb_latexmk`, the minted cache and the rest carry over (all but `.fls`). Paths inside them contain the folder's 32-character cache key. Every key has the same length, so the old key is replaced byte for byte, which keeps the offsets in SyncTeX data valid (`.synctex.gz` is unzipped and zipped again). latexmk then decides what to run, as it would in your folder.

**Chapter rounds.** When the main file includes chapters with `\include` and every changed file belongs to one of them, each side is a single `\includeonly` build of the changed chapters. The other chapters' `.aux` files come from a full build of the task's base, so equation numbers, references and citations stay right. The two sides compile at the same time, with the same `SOURCE_DATE_EPOCH` (noon UTC of the round's date, with `FORCE_SOURCE_DATE=1`), so `\today` never shows up as a change. A chapter build of the thesis went from 68.7–88.5 s (3 passes, 2 BibTeX runs) to 25.8 s (1 pass).

**Before the turn ends.** Each file the agent writes starts a speculative build and comparison, cancelled by its next write (`engine/src/core/publish.ts`), so the round is often rendered by the time the agent stops.

**One machine, two TeX runs.** The manuscript preview, every task's rounds and the speculative builds share two TeX slots across all processes. When a more urgent run waits, a less urgent one is paused with `SIGSTOP` and continued later (`engine/src/core/pool.ts`).

**Failures.** A build whose errors point into leftover files under `build/` is retried once from a clean folder. If the revised document does not compile, the error goes back to the agent as a new turn. If the baseline does not compile, it is compiled past its errors; failing that, the round shows source changes only.

![Four stages: snapshot the task in a Git worktree, build both sides from warm LaTeX state, compare the typeset documents, and record each decision in a journal.](/assets/blog/review-pipeline.en.svg "One round: snapshot, build, compare, decide.")

## Finding each change on the page

**Units in the source.** The diff splits prose into words (characters in CJK text). Some constructs stay single tokens: comments, inline and display math, brace groups, commands with their arguments, and environments such as `equation`, `align`, `tabular`, `verbatim`, `minted` and `tikzpicture`. Edits separated only by spaces or punctuation are joined, and each resulting edit is one decision with an exact source range. Images and other binary files are whole-file units, and hunks touching the same `.bib` entry form one unit.

**Where the documents differ.** A worker process extracts the text of both PDFs with MuPDF and aligns the two documents word by word (`engine/src/render/effects.ts`): unique runs of eight words pin them together, the longest increasing chain of those anchors is kept, and the gaps between anchors are diffed. Runs of at least 20 letters and digits that moved are reported as moves. Comparing whole documents is what finds changes away from the edit: every use of a redefined macro, renumbered equations, a new bibliography entry.

**Where each edit is.** SyncTeX, compiled to WebAssembly and indexed once per build, maps each edit's old lines into the old PDF and its new lines into the new one, giving page crops; crops are cut at lines both documents share. Each edit is then classified as changed text, changed layout (pixel comparison at 2×), moved, typeset identically, or unmapped. Changes of ink only (font, colour, raised or lowered text) and vector drawings are compared separately. Crops that share a printed line merge into one region, while each edit keeps its own Accept and Reject. The strips on screen are vector SVG.

A whitespace-only edit that typesets identically is attached to the nearest real edit in the same paragraph, never across a blank line, `\par` or a section heading, and stays its own decision.

**Changes away from the edit (optional).** With **Track indirect changes** on, differences outside every edit's crop are traced to their cause by compiling variants: first the edits with no visible effect of their own, such as a macro definition, then halves of the edit set. The union of causes is verified, up to three places are drawn under each edit, and the rest load on demand.

## Decisions as a journal

A decision never writes your folder directly. Each one is recorded in a SQLite journal with the expected and target bytes of every write, checked against disk and rolled back if any step fails (`engine/src/core/review.ts`):

- **Accept** records the change in a private commit, `refs/papilot/<task>/accepted`.
- **Reject** reverts the change in the worktree with a three-way merge, so passages edited since are left alone. While the agent is working, rejects wait until its turn ends.
- **Undo** takes back the latest decision.
- **Apply** merges the accepted changes into your working files, again three-way. **Commit** writes only the task's changes onto `HEAD` with `git commit-tree` while holding `index.lock`, after checking that the branch has not moved, and keeps anything else you had staged.

If the manuscript changed in the same passages meanwhile, nothing is overwritten: the proposal is rebased onto the current manuscript and comes back as a new review in the same task.

## What the isolation costs

Against `latexmk` run in a copy of the same folder:

| Change | `latexmk` in the folder | Papilot |
| --- | --- | --- |
| Edit a chapter | 69.2 s, 1 pass | 71.2 s, 1 pass |
| Edit a file TeX does not read | 0.2 s, nothing to do | 1.9 s, no TeX run |
| Open the paper | 0.2 s, nothing to do | 71.3 s, 1 pass |

From an agent's edit to a ready round took 23.1–47.2 s. With the next manuscript build predicted during a 150 s review, the PDF was ready 0.8 s after the commit.
