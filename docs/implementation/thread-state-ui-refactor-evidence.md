# Thread State And Chat UI Refactor Evidence

Date: 2026-05-22

Scope: implemented the Thread-oriented state, API, CLI, runtime readiness, and
primary Web chat surface described by
`docs/implementation/thread-state-ui-refactor-dag.md`.

## Implemented Slices

### TS-01 Core Thread Contracts

- Added shared `ThreadState`, `ConversationState`, `RuntimeState`,
  `ThreadSummary`, `ThreadContext`, `ThreadAction`, and `ToolCallSummary`
  contracts in `packages/core`.
- Added `toThreadSummary` so existing `WorkerSession` records project into
  Thread-facing lifecycle, conversation, and runtime states.
- Empty backing sessions now project to `thread_state: "empty"` and
  `runtime_state: "notStarted"` instead of surfacing runtime liveness as a
  user-facing failure.

### TS-02 Project-Scoped Thread APIs

- Added `POST /projects/:id/threads` to create an empty project-owned Thread
  backed by the existing session/workspace records.
- Added `GET /projects/:id/threads` and `GET /threads/:id` Thread-facing read
  APIs while preserving existing `/sessions` APIs.
- Added create idempotency via `thread_idempotency_keys`.

### TS-03 Runtime Readiness On Thread Send

- Added Thread send API `POST /threads/:id/messages`.
- Empty Thread first-send creates the initial persisted message and starts the
  runtime.
- Detached Thread sends use Codex app-server `thread/resume` before delivering
  the turn.
- Exited backing sessions with a Codex thread cursor are resumable through
  `thread send`; users and manager agents do not need a separate Resume action.
- Runtime readiness failures on the Thread path mark the attempted message
  failed while preserving the Thread as readable and retryable.
- First-send startup failures on empty Threads restore the Thread to
  `empty/notStarted`, mark the initial message failed, and allow retry through
  the same Thread composer/API.
- Failed first-send attempts with an idempotency key release the failed key
  binding so retrying the same request can start a new attempt; once a retry
  succeeds, the key resolves to the successful message.
- `continue` while a Thread turn is already `starting` or `running` returns
  `thread_turn_in_progress` without creating a failed message.
- Thread send rejects empty content for every caller-supplied mode, including
  `initial`, before creating a persisted message.
- Existing session send endpoints keep their old structured unavailable-runtime
  behavior for compatibility.
- Added send idempotency via `message_idempotency_keys`.
- Added a per-ProductManager in-flight guard for overlapping sends in the same
  API process.

### TS-04 Transcript, Context, And Tool Projections

- Added `GET /threads/:id/transcript`, `/items`, `/latest`, `/context`, and
  `/tool-calls` Thread aliases.
- `thread context` returns bounded transcript, latest agent message, allowed
  actions, attention reasons, cursors, and optional tool-call projections.
- Tool calls can be collapsed to summaries or expanded to include source raw
  item records.
- Failed sends are included in transcript/context projections so manager agents
  can see the failed attempted instruction and `failed_to_send` attention.
- Message windows remain query/read parameters; no durable message-window table
  was added.

### TS-05 Web Project -> Thread -> Chat UI

- Refactored the primary Web surface to a Project -> Thread -> Chat flow.
- Each project row has its own new Thread button.
- New Thread immediately selects an empty Thread, displays an empty transcript,
  and focuses the composer.
- The composer is always visible for the selected readable Thread.
- Terminal resumable Threads remain sendable through the same composer.
- Sending the first message transitions into the normal chat flow through the
  Thread send API.
- Removed primary Run Group, Resume, Stop, Complete, and start-session UI from
  the main chat path.
- Styled the project-row new Thread icon button and constrained mobile buttons
  so navigation controls do not expand into large blocks.
- Empty and resumable Threads no longer render hidden session-action help in the
  default composer.

### TS-06 Agent-Oriented Thread CLI

- Added `codexhub thread` commands for create, list, inspect, context, trace,
  latest, items, tool-calls, and send.
- Existing `session` commands and JSON output remain compatible.
- Thread send supports idempotency key, wait mode, timeout, and sender metadata.
- `thread tool-calls` supports `--tools hidden|collapsed|expanded`.
- `thread tool-calls --tools hidden` returns an empty tool-call projection.

### TS-07 Integration Hardening

- Ran root quality gate.
- Ran desktop and mobile browser verification against local dev server and fake
  Codex mode.
- Ran clean-context Spec and Standards reviews, then addressed blocking
  findings discovered during review passes.

## Validation

- `pnpm --filter @codexhub/core test`
  Passed: 12 files, 48 tests.
- `pnpm --filter @codexhub/server test`
  Passed: 9 files, 78 tests.
- `pnpm --filter @codexhub/cli test`
  Passed: 2 files, 40 tests.
- `pnpm --filter @codexhub/web test`
  Passed: 5 files, 16 tests.
- `pnpm --filter @codexhub/web build`
  Passed.
- `pnpm format`
  Passed.
- `pnpm lint`
  Passed after removing obsolete Web start/follow-up UI code.
- `pnpm check`
  Passed.
- `pnpm test`
  Passed.
- `pnpm build`
  Passed.
- `pnpm quality`
  Passed: format, lint, check, test, build.

## Browser Verification

Local verification used:

- API: `http://127.0.0.1:4317`
- Web: `http://127.0.0.1:4318`
- Fake Codex project with `default_codex_options: { fake: true }`

Verified behavior:

- Project row exposes a project-scoped new Thread button.
- New Thread selection opens a blank Thread view and focuses the composer.
- Composer placeholder is `Message this thread...`.
- Send button is enabled after entering text.
- Sending first message produces a normal chat transcript with the fake Codex
  response.
- Primary UI contains `Threads`, does not contain `Run Groups`, and does not
  contain `Resume`.
- Conversation header reports visible messages without exposing cursor/window
  internals.
- Project new Thread button is styled as a compact 28px icon button.
- Empty Thread composer does not show disabled session-action help.
- Mobile navigation buttons keep normal intrinsic width instead of expanding
  into oversized blocks.
- Mobile selected Thread view keeps both textarea and Send visible in the
  viewport.

Screenshots:

- `docs/prototypes/thread-ui-browser-verify-desktop.png`
- `docs/prototypes/thread-ui-browser-verify-mobile.png`

## Review Findings Addressed

First clean-context review found these blocking issues, now addressed:

- Empty Threads projected `runtime_state: "starting"` instead of
  `"notStarted"`.
- Tool-call projection did not support expanded source-item details and did not
  classify `item/tool/result`.
- CLI exposed wait modes while the server ignored `wait`.
- `archive` was advertised as an allowed action without an implemented action.
- Thread context endpoint performed an unnecessary unbounded message read.
- Runtime readiness only made failures readable; it did not use app-server
  `thread/resume`.
- Web lint failed because obsolete start/follow-up UI code remained after the
  primary UI was simplified.

Second clean-context review found these blocking issues, now addressed:

- Empty project-scoped Threads were persisted as `starting` rows and could be
  reconciled to `failed` after API restart.
  Response: empty Threads are excluded from transient-session reconciliation,
  with API restart regression coverage.
- Allowed actions and UI send affordances did not align with terminal Threads
  that can be resumed by Codex thread cursor.
  Response: `ThreadSummary` includes `codex_thread_id`; allowed actions and Web
  composer state treat exited/failed resumable Threads as sendable, and
  ProductManager permits `thread send` to resume them.
- ProductManager could leave a queued message when runtime readiness failed
  before send.
  Response: readiness and send failures are handled in one Thread-send path;
  failed sends are persisted as failed messages while keeping the Thread
  readable and retryable.
- README and `skills/codexhub/SKILL.md` were still session-first.
  Response: both now document the Thread-first agent path and keep session
  commands as compatibility/debug surfaces.
- CLI `thread tool-calls` did not expose the `--tools` detail option.
  Response: added the option and CLI coverage for read commands.
- Web labels still exposed session/window internals.
  Response: visible chat labels now say Thread and visible-message counts, with
  pure state tests covering the behavior.
- First-send runtime startup failures could strand an empty Thread as failed.
  Response: ProductManager now persists the attempted initial message as failed,
  restores the backing Thread to `empty/notStarted`, and returns a retryable
  Thread-send error.
- Retryable send failures were not visible through agent context.
  Response: failed messages are projected into transcript/context and surface
  `failed_to_send` attention.
- `thread tool-calls --tools hidden` was accepted but ignored.
  Response: the server endpoint now honors `hidden` with an empty projection.
- Project/thread UI had unstyled project row controls and mobile button
  expansion.
  Response: added project row/icon button CSS and limited mobile flex expansion
  to composer action buttons.
- Runtime supervisor docs did not describe Thread resume/fallback behavior.
  Response: `docs/runtime-supervisor.md` now distinguishes lower-level session
  failure/follow-up behavior from Thread send retry/resume behavior.
- Retrying a failed first-send with the same idempotency key returned the failed
  message instead of retrying.
  Response: failed idempotency bindings are released on retryable Thread-send
  failures, with ProductManager and API regression coverage.
- `continue` after an accepted turn while the Thread was still running was
  misclassified as runtime unavailable.
  Response: ProductManager now returns `thread_turn_in_progress` before message
  creation for non-empty `starting`/`running` Threads.
- Mobile selected Thread layout did not keep the composer fully visible.
  Response: mobile grid rows and panel heights were adjusted so project/thread
  lists are bounded and the selected Thread composer remains in view.
- Direct API callers could send `mode: "initial"` with empty content to an empty
  Thread.
  Response: ProductManager now rejects empty content for all modes before
  persistence, with ProductManager and API regression coverage.

## Documentation Impact

Docs changed:

- `docs/prd/thread-state-ui-refactor.md`
- `docs/implementation/thread-state-ui-refactor-dag.md`
- `docs/implementation/thread-state-ui-refactor-evidence.md`
- `docs/implementation/thread-state-ui-refactor-review.md`
- `docs/prototypes/codexhub-agent-cli-design.md`
- `docs/prototypes/codexhub-session-architecture-prototype.html`
- `docs/prototypes/codexhub-thread-state-architecture.md`
- `docs/prototypes/thread-ui-browser-verify-desktop.png`
- `docs/prototypes/thread-ui-browser-verify-mobile.png`
- `docs/runtime-supervisor.md`
- `README.md`
- `skills/codexhub/SKILL.md`

AGENTS, review gate, and roadmap did not need source-of-truth updates in this
slice. README, `docs/runtime-supervisor.md`, and the repo-local Codexhub skill
were updated because new manager-agent automation should use the Thread-first
surface and Thread send now has distinct resume/retry behavior from lower-level
session commands.

## Residual Risks

- The in-flight send guard is process-local. It prevents overlapping sends in a
  single API process, but a future multi-API deployment should move this to a DB
  compare-and-set or lease.
- Web virtual scrolling is prepared through bounded reads and pagination, but no
  virtual-list library is integrated yet.
