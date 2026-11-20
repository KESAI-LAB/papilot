# Annotation-to-diff links: two reproduced failures

Verified locally on 2026-11-20. Investigation only: no application code changes and no live model calls.

## Environment and verification boundaries

- macOS arm64, Node.js 22.22.0, local TeX Live 2025 / latexmk / pdflatex / SyncTeX, headless Chrome.
- Repository HEAD: `da9a36c334bf127afa70d5ee4b4edfa6432fbd8c`.
- Remote main inspected: `aa3893ffd369617c304b471ea38ad78075fc9373` (Papilot 0.12.0).
- The inspected matching, source-location, note-result UI, review-link UI, engine change and round-detail files have no diff between this HEAD and remote main.
- The synthetic repository is isolated from the user's manuscripts and application data. No supplied screenshots or manuscript contents were used.
- The review engine was accessed through real HTTP endpoints for task creation, publishing, state and round details; its database was not edited directly.
- Each annotation's quote and selection rectangle were obtained from the actual rendered PDF; `locateMark()` ran real SyncTeX. Every selected location resolved to the expected source line.
- Agent edits and workspace conversation metadata were deterministic fixture data. No real agent turn or manual mouse-drag annotation creation was exercised. The matcher, compilation, generated diff strips and built React interfaces were real.
- Root and engine frontends were freshly built to temporary directories. Browser runs had zero page errors and zero unexpected requests. Screenshots were visually inspected, including both PDF renders.
- Existing focused tests passed: `node --import tsx --test tests/note-results.test.ts tests/note-comparison-scope.test.ts` (15/15). These passing tests do not cover the failures below with real rendered rounds.

## Failure 1: ordinary LaTeX constructs suppress correct links

`reproduce.mts` makes eight annotated locations and changes `fast` to `efficient` in each. The engine publishes eight visible changes with no compilation/rendering warnings. The matching API returns two matched notes and six unmatched notes with empty `changes` arrays.

| Selection in original PDF | Source line | Full selection links | Select just `fast` as a diagnostic control |
| --- | --- | --- | --- |
| Plain sentence | 6 | Yes | Yes |
| Sentence with `\emph{fast}` | 9 | Yes | Yes |
| Sentence containing a rendered citation `[1]` | 12 | No | Yes |
| Sentence containing inline `α > 0` | 15 | No | Yes |
| Sentence containing `\href{...}{fast}` | 18 | No | No |
| Sentence containing escaped `\&` | 21 | No | Yes |
| Text inside `\section{...}` | 23 | No | No |
| Text inside `\caption{...}` | 28 | No | No |

These are deliberately chosen diagnostic cases, not an estimate of the failure rate in arbitrary papers.

The actual UI exhibits both reported symptoms: the corresponding change has no annotation badge, and selecting its note displays **No linked change**. Compare `plain-linked.png` with `citation-unlinked.png`, `heading-unlinked.png` and `caption-unlinked.png`.

### Cause

`src/server/note-results.ts`:

- `quoteSource()` (line 20) converts source to normalized visible text but only recognizes a small list of transparent formatting commands. Other commands and arguments become opaque boundaries.
- `quotedUnit()` (line 57) requires the entire normalized PDF quote to have one exact occurrence in `old_context`. An unresolved quote returns false at line 78.
- `matchNoteChanges()` filters candidates through that check at line 100, even when the source file/line correctly overlaps the actual edit.

Consequently a citation, math command or escaped symbol anywhere in a selected sentence can prevent linking a plain-word edit elsewhere in that same sentence. Section headings, captions and hyperlink display text are themselves hidden by the command handling. Narrowing the quote to `fast` rescues the citation, math and escaped-symbol cases, but not the commands that hide the edited word itself.

`src/web/review-note-connections.tsx` lines 29–31 only renders badges for returned associations, and `src/web/note-results.tsx` line 289 displays **No linked change** for an unmatched result. The missing UI links follow directly from the matching result in these cases.

The existing title and basic source-anchor tests use simplified units without the exact `text_ops` plus `old_context` combination that real published rounds supply; they do not exercise this rejection path.

## Failure 2: a follow-up note on unaccepted proposed text cannot match the next round

1. Start with `The baseline method is fast and reliable.`
2. In round 1, propose `fast` → `efficient`. Leave the change pending.
3. Select the proposed sentence in round 1's PDF and annotate: `Replace efficient with scalable in this sentence.`
4. Change that occurrence to `scalable` and publish round 2.

Real SyncTeX resolves the follow-up selection to `main.tex:6`. The second round shows the expected final edit, but its comparison is still against the unaccepted baseline:

- Note quote: `The baseline method is efficient and reliable.`
- Round 2 before: `The baseline method is fast and reliable.`
- Round 2 after: `The baseline method is scalable and reliable.`
- Follow-up result: `state: unmatched`, `changes: []`.

The built UI simultaneously shows the round 2 change without its follow-up badge and **No linked change** for the selected follow-up note. See `followup-unlinked.png` and `followup-results.json`.

### Cause

For notes carrying `anchor.round`, `matchNoteChanges()` avoids trusting source lines from a prior revision (line 89), then searches the new round's before strips / `unit.old_text` (lines 91–94). It does not resolve the quote against the earlier proposal's after revision and follow that location into the new round. Here the quoted `efficient` text exists in neither the next comparison's before nor after text, so no candidate survives.

Original notes also remain associated with their historical round, so they do not badge unchanged pending fragments shown in the newer round. This additional observed behavior needs a deliberate history-versus-current-link policy; the follow-up note's own missing association above is independently reproduced.

## Fix direction, not implemented

Preserve the protection against associating or accepting unrelated edits on the same source line. Simply removing the exact check or matching every overlapping line would reintroduce the cases the existing tests protect against.

The mapping needs to account for rendered LaTeX and the revision where the annotation was created: preserve exact source/selection evidence, interpret supported printable commands, and track a prior proposal's selected fragment across later source revisions. Add real-round regression cases for the six constructs, the unaccepted follow-up sequence, repeated text and unrelated edits on the same line.

## Re-run

Use an installed Papilot checkout with its root and engine dependencies, Node.js 22.22+ and the normal TeX toolchain on PATH. Chrome is used by default; set `PAPILOT_BROWSER_CHANNEL=chromium` if the Playwright Chromium browser is installed instead.

From the checkout (replace the script directory):

```sh
export PAPILOT_REPO="$PWD"
export PAPILOT_REPRO_DIR="$(mktemp -d /tmp/papilot-note-links.XXXXXX)"
export PAPILOT_REPRO_SCRIPTS="/path/to/Papilot-annotation-links-repro-20261120"
node --import tsx "$PAPILOT_REPRO_SCRIPTS/reproduce.mts"
node node_modules/vite/bin/vite.js build --outDir "$PAPILOT_REPRO_DIR/web"
(cd engine && node node_modules/vite/bin/vite.js build --outDir "$PAPILOT_REPRO_DIR/engine-web")
node --import tsx "$PAPILOT_REPRO_SCRIPTS/browser.mts"
node --import tsx "$PAPILOT_REPRO_SCRIPTS/followup.mts"
node --import tsx "$PAPILOT_REPRO_SCRIPTS/browser-followup.mts"
```

Run in this order; the follow-up script intentionally creates a second round in the same disposable repository. Use a new temporary directory for another run. Each script closes its local servers and browser when finished. Published JSON records redact temporary server tokens and replace machine-local paths with placeholders. A re-run generates paths for its own temporary directory.

The provided archive omits the temporary Git repository, application databases, dependency trees and compiled JS bundles. It retains synthetic sources/PDFs, real rendered diff assets, raw API results, screenshots and runnable scripts.
