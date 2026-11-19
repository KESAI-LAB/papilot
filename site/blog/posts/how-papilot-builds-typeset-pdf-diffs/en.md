Ask a coding agent to tighten a two-page proof or unify notation across a LaTeX manuscript, and its raw `git diff` will arrive in seconds. Reading that diff is where the real delay begins. A single renamed macro, a rewrapped paragraph, or an adjusted `\begin{aligned}` block turns into dozens of red and green source lines. Even if you run `latexdiff` across the whole project, fragile display environments often break, page breaks shift downstream, and there is still no clean way to accept paragraph two, reject equation four, and write only your chosen source edits back to disk.

For [Papilot](https://github.com/PapilotAI/papilot) to make the compiled PDF the primary workspace, typeset comparisons cannot feel like a slow batch export at the end of a build. Every round of agent edits has to stay isolated from your working tree, compile in roughly the time of a single incremental `latexmk` pass, attribute highlights accurately to individual notes, and record every accept or reject decision in an undoable review journal. Here is how that pipeline works under the hood.

## Isolating Agent Turns in Git Worktrees and Fast Tree Snapshots

Safety comes before speed. When you highlight sentences or box equations on a PDF page and send them to Codex, Claude, Cursor, or Papilot Writer, the agent never edits your manuscript's working directory directly. Instead, each task runs inside its own disposable Git worktree.

To compare revisions reproducibly—and ensure SyncTeX always points to the exact source version being displayed—every build runs in an immutable build directory rather than mutating the author's folder in place. Creating a fresh build snapshot on a large thesis could easily become a bottleneck if Git hashed the entire repository each time. Papilot avoids that by recording snapshots through private Git snapshot indexes (`.git/papilot/working-index` for the manuscript and `papilot/snapshot-index` in each task worktree), seeded from the previous snapshot or the repository index so Git rehashes only files whose size or modification time actually changed.

![Four-stage engineering pipeline diagram: Git worktree snapshot, seeded incremental chapter builds, typeset diff attribution, and undoable review journal.](/assets/blog/review-pipeline.en.svg "Each agent turn runs in an isolated Git worktree, reuses warm LaTeX state for parallel chapter builds, attributes fine-grained prose and atomic math diffs, and records undoable decisions before touching your working tree.")

## Making Immutable LaTeX Builds Cost Seconds, Not a Clean Rebuild

Running `pdflatex` or `xelatex` from scratch on a multi-chapter paper or a 300-page thesis takes multiple passes to resolve citations, cross-references, and `minted` or TikZ caches. Because Papilot isolates builds in separate directories, naive isolation would throw away all of `latexmk`'s incremental state on every turn.

Papilot keeps isolated builds fast through four mechanisms:

1. **Cloning the closest recent build.** When preparing a new build folder, Papilot inspects recent completed builds of the same chapter set and picks the candidate whose Git tree differs in the fewest files. On macOS with APFS, `cp -c` copy-on-write clones the entire build directory in one step, then streams only the changed blobs from Git.
2. **In-place SyncTeX and auxiliary state carryover.** `latexmk`'s `.fdb_latexmk` database, `.aux` and `.bbl` files, and `minted` caches carry over into the cloned directory. Because build folders use equal-length directory keys, Papilot rewrites paths inside kept SyncTeX data and logs in place without invalidating byte offsets—so `latexmk` usually runs just a single incremental pass, or nothing at all when inputs have not changed.
3. **Parallel `\includeonly` chapter builds for reviews.** When an agent edits one or two chapters of a multi-file manuscript, a review round does not recompile the entire book. Both the baseline and revised versions compile only the touched chapters in parallel via `\includeonly`, seeded with `.aux` files from a full base build so cross-references, figure numbers, and citations from untouched chapters remain accurate. Both builds also pin a shared timestamp so `\today` never creates phantom diffs across midnight.
4. **First-pass previews and automatic clean fallback.** When an edit changes pagination or citations and `latexmk` schedules additional passes, a pass hook surfaces the newly typeset pages and SyncTeX map right after pass one while reference numbers finish settling in the background. If leftover auxiliary state ever causes an error inside generated files, Papilot automatically retries once from a clean directory.

| Build and review stage | Naive clean-build pipeline | Papilot incremental review pipeline |
| --- | --- | --- |
| Workspace isolation | Mutates working folder or copies every file from scratch | Task-scoped Git worktree + private Git snapshot indexes (`working-index` / `snapshot-index`), cloned via `cp -c` on APFS |
| Multi-chapter review compilation | Full-document multi-pass rebuild before and after | Parallel `\includeonly` builds seeded from the base build's auxiliary files, with pinned date |
| SyncTeX & auxiliary state | Rebuilt from zero on every isolated directory | Equal-length build keys allow in-place SyncTeX path rewriting and `latexmk` state reuse |
| Multi-pass latency on screen | Waits for every BibTeX and cross-reference pass to finish | Surfaces updated PDF pages after pass one while remaining passes settle numbers |

## Fine-Grained Prose Attribution and Atomic Math Comparisons

Once the baseline and revised PDFs are compiled, rendering two full pages side by side is still not enough: an author wants to decide on each logical change where it sits on the page, without losing typographic context.

Papilot separates **what can be split** from **what must stay whole**:

- **Fine-grained prose offsets.** Within ordinary paragraphs, each edit maps to exact character offsets in the `.tex` source and separately attributed highlight marks on the rendered PDF. Invisible whitespace or line-wrap adjustments in the `.tex` file are grouped automatically with the nearest substantive edit in the same paragraph so authors never have to click through formatting noise.
- **Atomic TeX constructs.** Display equations, tables, figures, and bibliography entries remain atomic units, and overlapping PDF regions merge into a single coherent comparison block with surrounding lines kept in place—preserving true line breaks, kerning, and math spacing.

![Papilot interface showing a boxed equation and a highlighted sentence on the compiled PDF, each with an author note ready for the agent.](/assets/blog/notes.en.png "PDF notes link specific quotations and equation regions to source offsets so reviews can focus on one note at a time.")

When you attach PDF notes to a task, Papilot can also ask the connected agent to prepare concise **per-note alternatives** alongside its main proposal in the same turn. Before the review opens, Papilot validates each alternative patch against the exact source ranges linked to that note and compiles candidate previews in isolation. Clicking a note focuses only that note's highlights on the page and lets you switch between prepared wordings—or toggle the exact `.tex` diff—from local cache, with **zero additional LLM calls** during review.

## An Undoable Review Journal Before Anything Touches `main`

In source-centric editors, clicking "Keep" in an AI chat panel immediately mutates your working files. In Papilot, reviewing and delivering are deliberately decoupled.

Accepting a change—or accepting an alternative for a single note—writes to an undoable review journal inside the task. Rejecting a note restores its original `.tex` source ranges immediately while leaving unrelated edits and decisions intact. Only when you finish reviewing do you choose whether to **Apply** the approved changes to your working directory without committing (and, if linked, sync them in roughly a second to coauthors on Overleaf) or **Commit** only this task's accepted edits directly onto the manuscript's current branch.

You can test per-note typeset comparisons, prepared task replays, and local Git staging right in your browser with the [static online demo](/demo/). The full review engine, compiler pipeline, and desktop application are open source under the MIT license—explore the code, open an issue, or [star Papilot on GitHub](https://github.com/PapilotAI/papilot).
