# Typeless integration investigation

Status: installation and shortcut detection are implemented as a read-only probe.
Automatic dictation is **not implemented**. This does not yet resolve [#231](https://github.com/PapilotAI/papilot/issues/231).

## Reproduce detection

Run on the Mac displaying the editor, rather than on a remote Papilot server:

```sh
node --import tsx scripts/inspect-typeless.ts
node --import tsx --test tests/typeless.test.ts
```

The probe checks `Typeless.app` in `/Applications` and `~/Applications`, validates
the `now.typeless.desktop` bundle identifier, and reads the configured dictation
bindings from Typeless's `app-settings.json`. It reports unknown or unreadable
configuration explicitly. It does not assume that the shortcut is Fn, use a
translation or Ask anything shortcut, launch Typeless, send keys, or start a
microphone. It returns no other settings and does not read recordings or history.
Other platforms are reported as unsupported by this probe, not as evidence that
Typeless itself is unavailable there.

On macOS with Typeless 2.11.0, the probe detected the application and a configured
`Fn` dictation binding in `featureShortcutBindings.dictationMode`. This matched
the shortcut shown in Typeless's Settings. The older `keyboardShortcut` object
also remained in the settings file, so modern bindings must take precedence.
An empty modern list must stay empty; malformed modern settings must not silently
reactivate an old shortcut.

## What remains unverified

| Capability | Result |
| --- | --- |
| Identify the installed Mac application | Verified locally |
| Read the configured dictation shortcut | Verified locally against Settings |
| Manual Fn dictation into a disposable TextEdit document | Final insertion observed locally |
| Start/stop dictation from Papilot | Unverified |
| Read an authoritative recording/processing state | No external interface established |
| Cancel only a Papilot-owned session | No external interface established |
| Acknowledge final insertion or cancellation | No external interface established |
| Complete the PDF annotation workflow with voice | Not verified |
| Windows or browser integration | Not implemented or verified |

Typeless's [Dictate guide](https://www.typeless.com/help/quickstart/dictate)
documents starting and stopping with its shortcut and checking the Voice bar or
interaction sound. Its [Settings guide](https://www.typeless.com/help/quickstart/settings)
documents changing and adding shortcuts. These are user controls, not a confirmed
application control protocol. The available documentation does not establish a
session identifier, recording-state subscription, cancellation acknowledgement,
or final-transcription callback for Papilot. Absence from these guides does not
prove that no integration API exists.

The probe therefore always reports `control.status: "unverified"` and
`control.recording: "unknown"`, even when installation and shortcuts are detected.
No experiment switch or microphone button is exposed yet.

A manual native smoke test on 2026-11-19 inserted the spoken test sentence into
a disposable TextEdit document. This establishes ordinary dictation insertion,
not Papilot-controlled start/stop, recording-state detection, cancellation, or
the PDF annotation workflow. The recording and processing transitions were not
captured in that test.

A second test asked the user to start recording, then attempted Escape through
the computer-control tool. The user confirmed that recording had **not** ended
and stopped it manually with Fn. A historical "silent audio" entry was not an
acknowledgement of the current session's state. This test did not establish a
working cancellation path. The tool also rejected Fn key injection, so it did
not test whether a native macOS helper could emit a shortcut Typeless accepts.
These are limits of this experiment, not proof that native control is impossible.

## Requirements before enabling the experiment

The native desktop bridge must establish reliable start, stop, state and cancel
semantics on the editor's computer. A successful key injection alone cannot
confirm that recording started: Typeless might already be recording, its shortcut
may have changed, permissions may be missing, or the event may not be accepted.

The annotation must retain focus through final insertion. Switching or dismissing
it must cancel its own session and establish that no late text can reach another
field. Stopping must never save or send the annotation. Browser clients must not
control Typeless on the server's computer.

Verify those capabilities with the real application before implementing the UI,
then test repeated clicks, already-active dictation, final insertion, cancellation,
focus changes, permission failures and shutdown through a mocked native bridge.
Keep native voice results separate from deterministic tests.

## Validation of the probe

- Five deterministic tests pass, including malformed and empty modern settings,
  legacy settings, bundle identity, unreadable files and unsupported platforms.
- `npm run typecheck` and `npm run build` pass.
- An independent review found no blocking issue in the read-only probe.
- `npm test` was started but stopped after failures in ACP process shutdown and
  TeX compilation/comparison tests. This is not a passing full-suite result;
  those failures have not been reproduced on an untouched baseline.
