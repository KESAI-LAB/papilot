Every research group eventually settles into a quiet compromise around LaTeX. One coauthor prefers a browser tab that opens anywhere without installing a four-gigabyte TeX distribution; another lives inside a local code editor wired to Git, keyboard shortcuts, and a coding agent; a third prints the compiled PDF—or opens it on a tablet—because only on the typeset page do weak transitions, crowded tables, and slipped notation actually stand out.

When people search for an AI-assisted LaTeX setup today, they rarely lack capable language models. Modern coding agents already navigate multi-file repositories, follow custom macros, and repair `.bib` entries with ease. What determines day-to-day writing quality is the **workspace contract** around the model: where you express what should change, how you verify what the AI edited, and whether adopting a better tool forces your coauthors to abandon theirs.

Rather than claiming one tool replaces every other in all situations, it is more useful to compare the three main LaTeX workflows side by side—browser split-screen editors such as Overleaf, local source IDEs paired with coding agents, and [Papilot](https://github.com/PapilotAI/papilot)'s PDF-first workspace—and see how live synchronization lets them work together on the same manuscript.

## What Existing LaTeX Workflows Get Right

Before examining where source-first AI editing breaks down, it is worth recognizing why Overleaf and local code editors earned their place in academic writing.

**Overleaf solved collaborative onboarding.** Before browser-based TeX, starting a paper with coauthors across institutions meant debugging mismatched TeX Live years, missing `.sty` packages, and Git merge conflicts before writing a single abstract. Sharing a project link where everyone types in a browser and sees immediate character-by-character cursors remains the lowest-friction way for a mixed team to collaborate, especially from machines without a local TeX installation.

**Local source IDEs solved repository scale and automation.** Pairing VS Code and LaTeX Workshop—or Cursor, Neovim, and terminal agents such as Claude Code or Codex—with a local Git checkout gives authors fast multi-file search, offline compilation with `latexmk`, reproducible build scripts, and direct control when authoring `.cls` document classes, `.sty` packages, or programmatic TikZ figures.

Both workflows run into friction at the same point: **reviewing substantive AI revisions to an actual argument or derivation**.

![Three LaTeX workflows compared side by side: Overleaf's browser split screen, a source IDE with a coding agent, and Papilot's PDF-first workspace with live Overleaf sync.](/assets/blog/three-workflows.en.svg "Overleaf optimizes zero-setup browser collaboration and source IDEs optimize raw markup editing, while Papilot centers AI revision and review on the compiled PDF and syncs live with Overleaf.")

In a browser split screen or a code IDE, an AI assistant edits `.tex` markup and presents its proposal as a red-and-green source diff. On prose refactored across line wraps, or on a multi-line `\begin{align}` derivation using project-specific macros, reading the patch means mentally compiling LaTeX in your head—or recompiling the full PDF and hunting down what subtly changed on page nine.

## Comparing the Three Workflows Across Six Dimensions

The table below summarizes how each environment handles day-to-day drafting, AI revision, verification, and collaboration.

| Workflow dimension | Overleaf (browser editor) | Source IDE + coding agent (VS Code, Cursor, CLI) | Papilot (PDF-first agentic workspace) |
| --- | --- | --- | --- |
| Primary workspace | Split screen: `.tex` editor on the left, compiled PDF preview on the right | `.tex` file tree and code panes, with a secondary PDF preview tab | The compiled PDF manuscript itself; source remains inspectable on demand |
| Directing AI edits | Copy snippets into chat or prompt inside the `.tex` buffer | Prompt by file path, line range, or selected `.tex` code | Highlight text or box equations and figures directly on the PDF; SyncTeX maps exact source lines |
| Reviewing AI edits | Inspect raw `.tex` changes or recompile and visually scan the new PDF | Line-based `git diff` over raw LaTeX markup | Typeset before-and-after PDF diffs in place, with per-note alternatives and a source toggle |
| Coauthor collaboration | Native real-time browser editing via project or sharing links | Git push/pull; friction when coauthors prefer Overleaf | Built-in Git worktrees **plus** ~1 s live bidirectional Overleaf sync |
| AI model & agent choice | Platform-bundled assistant options | Tied to the IDE's vendor or one configured CLI tool | Bring your own login or key across 16 agents: built-in Papilot Writer plus 15 coding agents (Codex, Claude, Cursor, Copilot, Antigravity, Pi, OpenCode, and more) |
| Setup, files & license | Cloud-hosted project; zero local TeX install required | Local plain-text files + Git + TeX distribution | Local plain-text files + Git + TeX distribution; free and open source (MIT) |

## Collaborating Without Forcing Coauthors to Switch

The most common reason researchers hesitate to adopt a local LaTeX tool has nothing to do with features: *"My advisor and three coauthors are already editing on Overleaf."* Exporting a ZIP, running an AI revision locally, and pasting changed `.tex` files back into a browser tab invites overwritten paragraphs almost immediately.

Starting in Papilot 0.11, **Sync with Overleaf** removes that tradeoff. You can paste an Overleaf project link—or an edit-enabled sharing link—directly into Papilot, or link an existing local manuscript folder to its Overleaf counterpart. While Papilot runs, local files and the Overleaf project stay in step through Overleaf's real-time editing service:

- **Sub-second round-trip updates.** Changes you accept and apply in Papilot reach coauthors' Overleaf browser tabs in roughly a second, and edits they type on Overleaf flow back into your local `.tex` files and compiled PDF.
- **Character-by-character concurrent merging.** Edits made to the same paragraph at the same moment merge character by character, just as they do between two Overleaf browser tabs.
- **No paid Git add-on required.** Live synchronization works with a standard free Overleaf account (and supports self-hosted Overleaf instances as well), while still letting you isolate AI tasks in local Git worktrees before anything is applied to the shared draft.

![Papilot product illustration showing a typeset before-and-after comparison on the PDF page, with accept, reject, and comment actions.](/assets/blog/review.en.png "Review every proposed AI change as a typeset before-and-after diff before anything is applied to the shared Overleaf project.")

Getting a manuscript into the workspace is equally direct: **Import or open** accepts arXiv paper URLs (abstract, PDF, or HTML links), Overleaf view or edit links, and public GitHub repository URLs, automatically detecting the main `.tex` entry file and compiler engine. When starting from scratch, [Papilot Universe](https://papilot.ai/universe/) provides ready-to-compile templates for journals, theses, slides, posters, CVs, books, and more than 400 conferences.

## Choosing the Right Tool for Each Stage of a Paper

Because Papilot works on standard `.tex` and `.bib` files on disk, these workflows are complementary rather than mutually exclusive:

1. **Use Overleaf in the browser** when you are away from a machine with TeX installed, making quick manual wording fixes on a borrowed laptop, or inviting non-technical collaborators who want zero local setup.
2. **Open a source IDE** when you are engineering custom `.sty` style files, debugging low-level macro expansion, or scripting repository-wide data-generation pipelines that produce `.tex` tables from Python or R.
3. **Work in Papilot** when drafting, restructuring, checking derivations, and polishing the manuscript itself with AI agents—where pointing at the typeset page and reviewing every proposed change as a rendered before-and-after PDF diff keeps scholarly judgment sharp and protects the shared draft until you explicitly apply your decisions.

You can explore the PDF annotation and typeset review loop right now in the browser with our [interactive demo](/demo/), with no local TeX or model setup required. If this workflow fits how you write papers, download the desktop app for macOS, Windows, or Linux at [papilot.ai](/)—and consider [starring Papilot on GitHub](https://github.com/PapilotAI/papilot) so you can find it when your next deadline begins.
