# Thread State And Chat UI Refactor Review

Date: 2026-05-22

Review scope: current working tree implementation for
`docs/implementation/thread-state-ui-refactor-dag.md`, covering TS-01 through
TS-07.

## First Clean-Context Review Pass

### Spec Review Blocking Findings

- TS-03 did not actually ensure runtime readiness for detached/exited Threads.
  Response: implemented Codex app-server `thread/resume` request construction,
  `CodexRuntime.resumeSession`, supervisor resume forwarding, and
  ProductManager readiness on Thread send. Existing session send compatibility
  remains unchanged.
- Empty Threads projected `runtime_state: "starting"`.
  Response: `toThreadSummary` now maps empty backing sessions to
  `runtime_state: "notStarted"`.
- TS-04 collapsed/expanded tool-call projection was incomplete.
  Response: `projectToolCalls` now supports expanded source items, and the
  server `tool-calls` route accepts `tools=expanded`.
- TS-06 wait modes were advertised but ignored by the server.
  Response: `POST /threads/:id/messages` now parses `wait` and `timeout` and
  waits for `accepted`, `first-event`, or `turn-complete`.

### Standards Review Blocking Findings

- Server test for tool-call projection failed because `item/tool/result` was
  not classified as `toolresult`.
  Response: classifier now handles `item/tool/result`, with core and server
  regression coverage.
- Root lint failed due obsolete Web code left behind after the UI simplification.
  Response: removed unused start-session/follow-up form code and reran lint.
- Detached-runtime readiness was not implemented to spec.
  Response: same as Spec Review response above.

### Non-Blocking Findings Addressed

- Context endpoint performed an unbounded `listMessages`.
  Response: context route now uses the bounded transcript page for response
  transcript and avoids the unnecessary full message read.
- `archive` appeared in allowed actions without a backing API.
  Response: removed `archive` from `ThreadAction` and allowed-action
  projection.
- Empty Threads exposed `stop_runtime`.
  Response: `allowed_actions` for `runtime_state: "notStarted"` is now only
  `send`.

## Second Clean-Context Review Pass

### Spec Review Blocking Findings

- ProductManager still rejected completed/failed/stopped backing sessions before
  Thread send could resume them.
  Response: `sendWorkerMessage` now permits `thread send` with
  `ensureRuntimeReady` for terminal sessions that still have a
  `codex_thread_id`; the lower-level session endpoint retains terminal-session
  rejection.
- Runtime readiness failures happened before the normal send failure handling,
  so a message could remain queued and the Thread could be marked failed.
  Response: readiness and send failures are now handled inside the same
  Thread-send guarded path. A failed implicit resume marks only the attempted
  message failed, clears stale session failure state, and leaves the Thread
  readable/retryable.
- Web still exposed session terminology and transcript-window cursor details in
  the primary Thread UI.
  Response: visible primary labels now use Thread terminology and visible
  message counts. Raw/debug pagination remains available only in controls.

### Standards Review Blocking Findings

- Empty Thread rows could be reconciled to failed on API restart because they
  were stored as `starting`.
  Response: repository reconciliation excludes not-started empty Thread rows,
  with an API restart regression test.
- Thread allowed actions advertised send for terminal rows while ProductManager
  rejected them.
  Response: ProductManager, `ThreadSummary.codex_thread_id`, allowed actions,
  and Web composer state now agree on resumable exited/failed Thread behavior.
- Documentation gate was incomplete because README and
  `skills/codexhub/SKILL.md` remained session-first.
  Response: both now document Thread-first manager-agent commands and explain
  that session commands are compatibility/debug surfaces.

### Non-Blocking Findings Addressed

- CLI `thread tool-calls` lacked `--tools hidden|collapsed|expanded`.
  Response: added the option and CLI endpoint coverage.
- Web had no focused state tests for the new Thread composer behavior.
  Response: added `apps/web/src/thread-ui-state.ts` and tests for empty Thread
  sendability, resumable terminal Threads, and visible conversation labels.

## Final Review Pass

### Third-Pass Fixes Before Final Review

- First-send runtime startup failure now keeps an empty Thread retryable:
  failed initial message is recorded, backing session is restored to
  `starting`/not-started fields, and `thread send` returns retryable
  `session_process_unavailable`.
- Failed sends now appear in transcript/context projections and set
  `failed_to_send` attention.
- `thread tool-calls --tools hidden` now returns an empty projection.
- Project row/new Thread controls and mobile buttons received CSS fixes.
- Empty/resumable Thread composer no longer renders hidden session-action help.
- `docs/runtime-supervisor.md` now documents Thread send resume/fallback
  behavior separately from lower-level session follow-up behavior.
- Retryable first-send idempotency failures now release failed key bindings so
  the same idempotency key can retry and later bind to the successful message.
- New `continue` sends against non-empty `starting`/`running` Threads now return
  `thread_turn_in_progress` before creating a message.
- Mobile selected Thread layout now keeps textarea and Send visible, and
  transcript navigation buttons keep intrinsic width.
- Thread send now rejects empty content for every mode, including direct API
  attempts to start an empty Thread with `mode: "initial"` and no content.

Final clean-context Spec and Standards reviews should use this evidence:

- `pnpm quality` passed on 2026-05-22 after the final fixes.
- Browser verification passed for desktop and mobile using Chrome CDP against
  local API/Web dev servers.
- Screenshots were written under `docs/prototypes/`.

Final reviewer responses are appended by the manager when both clean-context
review subagents return.
