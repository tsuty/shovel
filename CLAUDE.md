# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**shovel（シャベル）** is an Electron + React + TypeScript desktop chat application that lets a
user drive an AI coding agent (e.g. Claude Code) running inside a **Docker Sandboxes** (`sbx`)
container, from a GUI on the host, using the **Agent Client Protocol (ACP)**.

Design goal: keep the agent's execution, file edits, and tool calls isolated inside the sandbox,
while running a lightweight GUI on the host — so that even non-engineers can watch/drive an agent
without risking their local machine. All project documentation is written in **Japanese**.

**Current status: broad first implementation. The ACP connection path has been confirmed working
against a real sandbox** (a user created a project and exchanged prompts/responses with a live
agent through it) — `src/main/acp/` is no longer purely theoretical, though it has only been
exercised on the happy path so far (not, e.g., permission-card flows, mode/config-option
switching, or the auth-required error path added after that check). Everything under `src/` —
scaffold (Electron + electron-vite + React + TypeScript + Tailwind), main-process domain layer
(sbx CLI wrapper, path translation, project persistence, ACP connection/translation, filer,
one-shot command execution, sign-in status check/guidance),
the IPC contract, and the renderer (Project Manager window with all three creation flows plus a
per-project details/diagnostics dialog; main window with tabs (right-click menu: close / close
other files / close all files — the bulk actions never close chat or history tabs, decisions.md
G-1-12), transcript rendering (per-message
copy, clickable tool-call locations/diffs, clickable attachment chips, code-block copy buttons and shiki highlighting of fenced code blocks (finalized blocks only),
GFM task lists in agent replies rendered as interactive checkboxes + Send, a slash-command
autocomplete dropdown driven by `available_commands_update`, a dedicated live-thinking strip above
the composer that streaming `agent_thought_chunk`s render into (finalizes into the usual `Thinking`
collapsible once the block closes), a floating "jump to latest" button + a "back to turn start"
link per turn, and an expand/collapse caret on tool-call rows that have non-diff `content` (e.g.
`search`/`fetch`/`other` kinds) that preserves the clicked row's on-screen position across the
toggle), permission cards (their diff summary is opened via the same tool-call-row "view diff"
link, not a duplicate affordance on the card), Mode/Model selectors plus a token-usage readout
(shown only once `usage_update` has been received), a sign-in dialog, file tree (create
folder/Markdown file, rename, delete, move via drag & drop, and clipboard copy/paste, all from the
right-click menu — including on empty space for root-level creation/paste — plus copy-in from the
OS file manager by paste or drop (always a copy, never a move; `readClipboardFilePaths` reads
Electron 44's `text/uri-list` clipboard format (+ `x-special/gnome-copied-files` on Linux), drops use `webUtils.getPathForFile`), a manual refresh button, a
file-*contents* search (🔎 in the Filer header, or a folder's right-click "search in this folder";
`FileSearchDialog.tsx` remembers its query/scope/results per project across closes; host-side
`src/main/domain/fileSearch.ts` skips `.`-prefixed folders, `node_modules`, binaries and non-UTF-8 files;
clicking a result opens the file and jumps to the match via `openFile(relPath, at)` → `FileReveal`,
`revealMatch.ts`, decisions.md N-3-11), and
"Open in Finder/Explorer" for folders; `.git` is always hidden, the old toggle is gone; files open
on double-click or Enter — single click/arrow keys only select, folders still toggle on single
click (decisions.md N-3-4); a right-click "open with default app" for files was deliberately
rejected because `shell.openPath` can execute agent-written scripts on the host) with a
read-only syntax-highlighted viewer (images previewed in-app with a size + width×height status
bar — `—` for SVGs without absolute `width`/`height`, since Chromium reports 300×150 for those. Editable text files all
open in one `TextFileEditor` (formerly `MarkdownEditor`; decisions.md N-3-1 再改訂, extension check in
`src/shared/fileKinds.ts`): Markdown, Mermaid and HTML get split/source/preview (Mermaid's preview is the diagram, debounced; HTML renders in a script-less `sandbox="allow-popups"` srcdoc iframe — `HtmlPreview.tsx`, links go out via `<base target="_blank">` → `setWindowOpenHandler`),
JSON/YAML (and plain `.txt`, uncoloured) get a highlighted "表示" view by default plus an "編集" toggle (`usesViewEditModes`). The editing
surface is still a plain textarea, plus Tab/Shift+Tab indent (via `execCommand('insertText')` so undo works), a
line-number gutter with no wrapping for everything but Markdown (Markdown keeps wrapping, no gutter), and a clickable
"JSON の書式に誤り（N 行目 M 列目）" status-bar entry (`src/renderer/main-window/textEditing.ts`). The Filer's
creation items live under a "新規ファイル ▸" submenu (Markdown / Text / Mermaid / HTML / JSON / YAML; JSON starts as `{}`, Mermaid
with a starter template); other binaries show an
"open with default app" button rather than opening automatically; text views and the Markdown
editor have a status bar with size/encoding/line ending (plus the last autosave time in the editor) — writes preserve the file's original
line ending and BOM, and non-UTF-8 files are view-only, see decisions.md N-3-2) and a split-view Markdown
editor (any editable file type, not just Markdown) that can also be attached to the right of a chat tab or an un-resumed history tab
(decisions.md G-1-9: bound to that tab, not in the tab bar, closes with it, carried over on
Resume, source/preview only; if the target isn't obvious — active tab isn't a chat and there are
several chat/history tabs — a picker dialog asks which one), a command-execution drawer (terminal-styled surface, resizable/persisted height, per-entry history delete, and a
per-run "TTY" toggle that swaps the output for an `@xterm/xterm` terminal backed by a PTY created inside the sandbox by
`src/main/sbx/ptyWrapper.ts` — needs `python3` there, decisions.md N-4「TTY モード」), a
session-history panel backed by local snapshots with rename/delete, a per-tab refresh action
(↻, reuses the connection and sends a fresh `session/new`), Cmd/Ctrl+0-9 tab-switching shortcuts, a Cmd/Ctrl+F find bar
(`FindBar.tsx`: searches the visible text of the tab area via the CSS Custom Highlight API, not `webContents.findInPage()` —
that matched the find box's own text and stole its focus, decisions.md N-1-a), a "connecting" tab shown immediately on "+" that lists
each connect step (sign-in check → sandbox liveness → adapter start/`initialize` → `session/new`)
with the command being run and elapsed time, swapped in place for the session tab on success
(flows.md §3 接続中タブ; progress via `session:openProgress`),
background-tab notifications (a pulsing tab label while that session is sending, a small badge
while it has a pending permission request — both suppressed on the active tab), context-attachment
chips (Filer "add to context" → sent as `resource_link` content blocks — path only, the agent
reads the file itself inside the sandbox (decisions.md G-1-5a); rendered on the USER transcript
block, and restored as chips from `session/load` replay, where claude-agent-acp echoes them back
as `[@name](file://…)` mentions; optional auto-attach-last-opened-file setting), resizable + persisted-width
sidebar panels, and a settings dialog (changes broadcast to every open window) for language/theme/transcript
font size (drives `text-transcript*` sizes in the transcript and history views)/file-view font
size (`editorFontSize` → `text-editor*`: viewer, Markdown editor source+preview, diff view; no
font-family setting, decisions.md G-1-13)/send key (Enter vs Cmd/Ctrl+Enter,
prompt input only)/default diff layout (side-by-side vs unified, `diffLayout`)), and a Markdown "印刷用表示" (print view: a separate
`print-preview.html` window per file that embeds ```` ```mermaid ```` as diagrams — the one exception to "Mermaid code blocks
only render in the popup" — always light theme, print button disabled until every diagram/highlight has rendered
(`renderTracker.ts`), then the OS print dialog via `webContents.print`; PDF is left to the OS, decisions.md N-3-10) — type-checks, lints, and
builds cleanly, and the packaged app has been smoke-tested (boots, no renderer exceptions) under
Xvfb.

This dev sandbox does have a display available (Xvfb) and has been used for real interactive
testing (mouse clicks, screenshots, DOM/clipboard assertions via Playwright's `_electron` API and
CDP attach) — it does not have `sbx`, so ACP/agent flows still can't be exercised end-to-end here;
that verification happens on the user's machine. The restore/backup paths *have* been exercised
here against a fake `sbx` on `PATH` (a small Node script that answers liveness/auth checks and
speaks minimal ACP over stdio with a scripted `session/load` replay) — useful again for anything
that touches `connection.ts`, but it proves protocol handling only, not real agent behavior. Don't assume something is broken just because it
can't be exercised from here; don't assume it works beyond what's actually been run, either.

Known, deliberate scope-narrowings worth knowing about before extending this code:
- Session history can now be genuinely resumed (`session/load` / `session/resume`), not just
  replayed read-only. The SDK's high-level `ActiveSession` only wraps `session/new`, so restored
  sessions run on a hand-rolled update queue (`ManualSession` in `src/main/acp/connection.ts`) fed
  by an explicit `onNotification(session_update, …)` handler — safe because the SDK's internal
  router returns `Handled.no` and lets the notification through to it. Restore follows
  decisions.md C-1/C-2 "Local Record First" (`load` preferred over `resume`): a non-empty local
  snapshot is drawn immediately and `session/load`'s replay is *not* drawn — it is compared by
  `agent_message` `messageId` (`compareByMessageId`/`reconcileReplay`), and only on a mismatch is
  the local file moved to `{id}.json.{ms}.backup` and the display replaced (plus a `notice`
  transcript line). The comparison is guarded by a `restoreEpoch` counter (new turn / ↻ / close
  discard it). Snapshots carry `acpSessionId` and per-AGENT-entry `messageId`. The **tab id**
  (`sessionId`, event routing) and the **snapshot id** (`{id}.json`) are separate:
  they start equal, but ↻ closes the current record and starts a new snapshot id, so a refreshed
  tab never overwrites its previous conversation (`OpenedSession.snapshotId`, `TabInfo.snapshotId`;
  rename and history filtering key off the snapshot id). Resuming a snapshot writes back to that
  snapshot's id, and reuses it as the tab id unless a live tab already holds it. Agents supporting neither method surface
  `RESTORE_UNSUPPORTED` and the history stays read-only. Session delete is a soft delete
  (`.deleted`, backups renamed along with it; C-5); backups/deleted records open as Read Only
  `history` tabs (`readOnlyKind`) and are searchable via the 🔎 in the history panel (C-6,
  `src/main/domain/localSearch.ts`). Neither backups nor deleted records are ever pruned.
- The history list is the **union of `session/list` and local snapshots** (decisions.md C-1/C-2
  補遺, `listHistory` in `sessionManager.ts`), matched by `acpSessionId`, with a per-row state
  (`both` / `localOnly` / `agentOnly` / `unknown` when `session/list` couldn't be fetched).
  `session/list` and `session/delete` borrow any live tab's connection in the project; with no
  live tab the state is `unknown`. Open tabs and soft-deleted sessions (`.deleted` files'
  `acpSessionId` act as tombstones) are excluded. Deletion sends `session/delete` when possible
  and soft-deletes locally either way. Agent-only rows open a content-less `HistoryView`
  (no connection until Resume → `resumeAgentSession`), can't be renamed, and can only be deleted
  when `session/delete` is available. Pristine-session `session/delete` is deliberately
  not implemented (`claude-agent-acp` doesn't list unprompted sessions).
- Transcript events emitted before a tab's `SessionView` subscribes (snapshot seed, live replay,
  early `available_commands_update`) are buffered twice: in main (`pendingEvents` in
  `sessionManager.ts`, until `openAcpSession` returns — dropped if it fails) and in the renderer
  (`src/renderer/main-window/sessionEvents.ts`, until the view subscribes).
- External-change detection for the Markdown editor uses light polling (every few seconds) rather
  than a file watcher — `chokidar` was deliberately not added (open-issues.md V-8 leaves file
  watching undecided; polling avoids the dependency without deciding it either way).
- `shiki`'s default bundle pulls in every language's chunk at build time (each still loads lazily
  at runtime, so this is a packaged-app-size concern, not a behavior bug).
- The sidebar's "not exclusive, stack left to right" panel behavior is approximated with a fixed
  panel order rather than click order. Panel widths now persist (ui.md §3's "サイズは記憶される"),
  and so does the command-execution drawer's height.
- The "auto-attach active file" setting seeds a new tab's attachment chip with whatever file was
  last opened in the Filer at tab-creation time — it isn't a live "whatever file is focused right
  now" binding, since there's no single always-current "active file" concept across the tab model.
- `TranscriptAction` (`openFile`/`openDiff`/`openAttachment`/`copyBlock`/`copyText`/`submitChoices`/
  `openUrl`/`ready`) is handled inside the renderer; only `permission` actually crosses the
  main⇔renderer IPC boundary. See
  architecture.md §5 for the full per-action breakdown and `sessionManager.ts`'s
  `dispatchTranscriptAction` for the (permanently unreached) rest of the switch.
- The Diff viewer (`src/renderer/shared/components/DiffView.tsx` + `src/shared/diff.ts`) is
  hand-written — no diff dependency was added. It renders either side-by-side (default; long lines
  wrap, removes/adds in a change block paired top-to-bottom 1:1 via `toSplitRows`) or unified (both
  line-number gutters, no wrap); the default comes from the `diffLayout` setting and the modal's
  toggle only overrides it while that modal is open. Paired remove/add lines get word-level
  highlights in both layouts (`withInlineChanges`, `Intl.Segmenter` words so Japanese works, skipped
  for dissimilar lines) — decisions.md N-3-8 (revised 2026-10-07). Its only input now is a tool call's own before/after text
  (`TextDiffView`, LCS-computed, far context collapsed to `… N lines`) — the LCS falls back to a
  whole-block replace past ~4M cells so a huge file can't hang the renderer. It used to also render
  the "changes" sidebar's cumulative `git diff` via a second component (`UnifiedDiffView`); that
  path was removed along with the sidebar itself (see the bullet below).
- **The "changes" sidebar (cumulative `git diff` + restore-to-HEAD) has been removed entirely**
  (decisions.md A-3-8), along with the "git init on project creation" checkbox that only existed to
  back it — `gitInit` is gone from `CreateNewDirRequest`/`CreateExistingDirRequest` and
  `projectService.ts` no longer runs `git init`. Rationale: shovel doesn't want to assume a single
  use case. In the "brainstorming/spec-drafting with the agent" use case, a restore feature is a
  liability (an easy way to accidentally wipe notes/decisions that were never meant to be
  reverted); in the "investigate an existing codebase" use case, the project is normally already
  under the user's own git anyway, so shovel's own restore UI added little. The per-tool-call diff
  view in the transcript (`TextDiffView`/`DiffModal`, still present) is unaffected — it shows what
  the agent just did, not a revertible cumulative state. Safety model is 3 layers now, not 4
  (architecture.md §6): isolation → prevention (permission cards) → policy (ACP Mode). No recovery
  layer. `sbx exec ... git ...` no longer appears anywhere in `src/main/`.
- GFM task lists (`- [ ] option`) in a finalized AGENT reply are extracted into `choices` by
  `translate.ts` and rendered as an interactive checklist + Send button below the prose (the same
  lines are stripped from the rendered prose so they don't also show up as remark-gfm's inert
  checkboxes). Plan/user/thought blocks are deliberately left alone — only finalized AGENT replies
  get this treatment.

Read `docs/design/open-issues.md` before extending any of this — it lists which design questions
are resolved vs. still open. Verify all of the above against `git log` / the working tree for
what has since changed, since this note is a snapshot.

## Documentation map (read in this order)

| File | Contents |
| :--- | :--- |
| `docs/design/README.md` | Index + design principles + terminology — **start here** |
| `docs/design/architecture.md` | Process layout, ACP connection, path translation, IPC, safety model, tech stack |
| `docs/design/data-model.md` | Project / agent table / Session / persistence / transcript protocol shapes |
| `docs/design/flows.md` | Step-by-step flows: startup, project creation, connect, turn execution, permissions, session restore, commands, deletion |
| `docs/design/ui.md` | Window/tab/sidebar/transcript/screen layouts |
| `docs/design/decisions.md` | **Decision log** — why things are the way they are, including rejected alternatives. Check this before re-litigating a design choice |
| `docs/design/open-issues.md` | Unresolved/unverified items (labelled V-N for things needing hands-on verification, and lettered items for undiscussed topics) |

`docs/DEVELOPMENT.md` is the environment setup guide and lists the build/lint/typecheck/test
commands (`pnpm typecheck`, `pnpm lint`, `pnpm test`). Unit tests live under `test/` (Vitest) and
cover pure logic only; run all three after changes.

## Development environment

- Supported dev OS: **macOS and Linux only** (the app itself targets Windows/macOS, but dev-env
  setup is not documented for Windows).
- Node.js `>=22`, pnpm `>=9` (see `package.json` engines, `.node-version`).
- Tool version management via [mise](https://mise.jdx.dev/) is **recommended but not required**
  (`mise.toml` pins `node = "22"`, `pnpm = "latest"`). Non-mise users can use Volta/nvm/Corepack
  against `.node-version` and `package.json#engines` instead.

```bash
mise trust && mise install   # if using mise
pnpm install                 # once the app has real dependencies
sbx diagnose                 # verify Docker Sandboxes CLI prerequisites
```

`sbx` (Docker Sandboxes CLI) is a hard runtime dependency of the app itself — it is not installed
by this repo's setup steps; the user installs it separately per Docker's docs.

## Architecture (once implemented)

- **Electron, single main process** owns everything OS-facing: the ACP client
  (`@agentclientprotocol/sdk`), spawning/managing `sbx` CLI subprocesses, filesystem access,
  persistence, and logging. shovel does not run `git` itself anywhere (the "changes"
  sidebar / restore feature that used to be the only caller was removed — decisions.md A-3-8);
  if the agent runs git inside the sandbox on its own, that's between the agent and the sandbox.
- **1 window = 1 project = 1 sandbox.** **1 tab = 1 ACP session = 1 `sbx exec` child process**,
  capped at 10 tabs.
- Agent connection: `sbx exec -i "<sandbox>" npx -y <acp-package>@<version>`, argv-based spawn
  (`shell: false`) — never build a shell command string. The version is always explicit (a bare
  package name makes `npx` reuse its stale cache): `Project.acpVersion` (recorded from
  `initialize`'s `agentInfo.version`) → the latest version cached from the ACP registry (fetched
  when the Project Manager opens) → `latest`. When a newer registry version exists, the project
  window asks "update / keep" before opening its first tab (decisions.md N-2-5b,
  `src/main/domain/acpVersionService.ts`). Only `stdout` is fed to the JSON-RPC
  parser; `stderr` is captured separately for logs (mixing them breaks parsing because `npx`
  writes progress to stderr). Line splitting must accept both `\n` and `\r\n`.
- ACP v1 only, and all client capabilities (`fs.readTextFile`, `fs.writeTextFile`, `terminal`) are
  reported as `false` — the agent always reads/writes files itself inside the sandbox. This is
  the load-bearing assumption behind the safety model (§6 of `architecture.md`): shovel never
  intermediates file operations, so there is no enforcement point to bypass.
- Renderer: React + Tailwind + shadcn/ui, `react-markdown` + `remark-gfm` + `remark-gemoji`
  (`:shortcode:` emoji) for Markdown (no `rehype-raw` — raw HTML in Markdown is shown as text; the
  one exception is `<details>`/`<summary>`, turned into elements by our own `remarkDetails` plugin,
  only in Markdown *file* views (editor preview / print view, `allowDetails`), never in the
  transcript — decisions.md D-5 追記), `shiki` for syntax highlighting,
  `react-arborist` for the file tree. preload uses `contextBridge` only — never expose Node APIs
  directly to renderer (`contextIsolation: true`, `nodeIntegration: false`).
  Built renderer pages load from `app://renderer/...` (served by main from `out/renderer` via
  `fs`, `src/main/windows/rendererProtocol.ts`), not `file://` — Electron 44's `file://` loader
  fails many concurrent dynamic imports, which broke shiki/Mermaid chunks (decisions.md F-1b).
- Path translation: every `Project` stores both `hostPath` and `sandboxPath`; `sandboxPath` is
  **measured** right after sandbox creation via `sbx exec <name> pwd`, never assumed from a
  hard-coded mount convention (macOS mounts are identity; Windows uses MSYS-style `/c/...` paths).
  All translation logic must live in one place.
- Safety model is layered, not a single mechanism: ① sandbox isolation (automatic, hard boundary)
  → ② permission-request cards from `session/request_permission` (automatic) → ③ ACP session Mode
  chosen by the user (policy). There is deliberately **no "read-only" mode** in the product —
  half-guarantees are treated as worse than no guarantee. A 4th layer (④ git-based recovery: a
  "changes" sidebar with cumulative diff + restore-to-HEAD) existed earlier but was removed
  (decisions.md A-3-8) — shovel doesn't want to assume every project is either disposable-if-wrong
  or already under the user's own git, so it stopped offering a built-in undo for agent edits.
  Likewise, shovel deliberately does **not** lock the Filer/Markdown editor to read-only while a
  turn is running (decisions.md N-5) — with up to 10 tabs running turns concurrently in the same
  project, "locked while any turn is active" would mean almost-always-locked, which conflicts with
  the app's core "investigate something else in another tab" use case. Conflicts are instead
  resolved with autosave + a `<name>.conflict-<timestamp>.<ext>` copy, never a lock or dialog.

## Conventions and constraints to preserve

- **Specs live in Markdown, not in code comments.** Behavior specs, design rationale, and
  references like `decisions.md N-x-y` belong in `docs/design/*.md`. Code comments are limited to
  explaining what the code does and describing variables, constants, and fields.
- **Tooltips: just write `title`.** Native tooltips are never shown — `TooltipLayer` (mounted once
  per window in each `main.tsx`) moves `title` to `data-tip` on hover and draws its own popup
  (decisions.md G-1-15). For an ⓘ-only hint use `InfoTip`. Don't add per-component tooltip code.
- **`dependencies` = only what main/preload `require` at runtime** (`@agentclientprotocol/sdk`,
  `zod`, `ignore`). Renderer libraries and anything main should bundle (e.g. ESM-only
  `electron-store`) go in `devDependencies` — electron-builder ships every `dependencies` entry
  in `app.asar`, and renderer code is already bundled into `out/renderer` (docs/DEVELOPMENT.md).
- **Zero native modules.** Do not add `node-pty`, `better-sqlite3`, or anything requiring
  per-OS/per-arch native builds — this is a deliberate constraint to keep code-signing and
  distribution simple (see `decisions.md` F-2b). Terminal needs are met via `sbx exec -i`
  (no TTY), a "TTY mode" that creates the PTY *inside the sandbox* (a base64-embedded
  `python3` `pty.fork()` wrapper; host side stays plain pipes, rendered with pure-JS
  `@xterm/xterm` — decisions.md N-4「TTY モード」), plus handing off to the OS terminal;
  persistence uses `electron-store` (JSON).
- **Secrets live in the sandbox, not the host.** Agent credentials go through `sbx secret`; never
  write them into this repo, `.env`, or host-side config.
- **Never assume the host has git or any specific agent installed.** Minimizing host
  prerequisites is a core design principle — don't write dev code that silently requires them.
- Destructive-feeling operations should be recoverable/visible, not silent: file deletion goes
  through `shell.trashItem()` (OS trash), not `fs.rm`; edit conflicts produce a conflict copy
  rather than overwriting; `git clean` is not used programmatically.
- Do not introduce libraries already rejected in `decisions.md` (Vercel AI SDK,
  `@ai-sdk/harness-acp`, Monaco/CodeMirror, `node-pty`, `better-sqlite3`,
  memfs+unionfs) without re-reading why they were rejected first.
