# Codexhub Worker Control Plane Skill

Use this skill when a manager agent wants to use Codexhub to create, launch,
observe, continue, and coordinate Codex worker threads with low context cost.

This is a repo-local skill document. Do not install it into a machine-level
Codex skills directory unless the user explicitly asks.

## Purpose

Codexhub is a worker scheduler and control plane, not a project manager,
validation system, escalation system, or context compiler.

Use it to:

- Create or reuse a project.
- Create a workspace from a local directory, Git clone, or Git worktree.
- Create a project-scoped worker thread in that workspace.
- Start or resume the Codex runtime by sending a message to the thread.
- Read recent high-signal output, especially complete agent messages.
- Page through session history without re-reading already consumed context.
- Inspect raw or filtered item streams when debugging.
- Send explicit steer or continue messages.
- Record useful friction or follow-up work.

## Manager-Agent Workflow

1. Define the task spec outside the worker.
2. Create or select a Codexhub project.
3. Create a workspace with an explicit repo/path/cwd/branch.
4. Create a project-scoped thread for the workspace.
5. Send the first message to start the Codex runtime.
6. Poll or watch bounded output instead of dumping full history.
7. Use `thread context`, `thread trace`, or `thread latest` for normal status
   checks.
8. Use `thread items` or `thread tool-calls` only when raw item detail is
   needed.
9. Send another `thread send` message when the worker needs a steer or
   continuation. Codexhub resumes the runtime first when the backing Codex
   thread can be resumed.
10. Stop only when the worker should be interrupted.

The lower-level `session` commands remain available for compatibility,
debugging, explicit follow-up sessions, review metadata, and raw lifecycle
inspection. Prefer the thread surface for new manager-agent automation.

Legacy session-first flow:

1. Define the task spec outside the worker.
2. Create or select a Codexhub project.
3. Create a workspace with an explicit repo/path/cwd/branch.
4. Start a worker session with the task prompt and task-spec metadata.
5. Poll or watch bounded output instead of dumping full history.
6. Use `session result`, `session trace`, or `session latest` for normal status
   checks.
7. Use `session items` only when raw item detail is needed.
8. Send `steer` while the worker is running.
9. Send `continue` after the worker is awaiting input.
10. Start `session follow-up` when work must continue from a stopped,
    completed, or failed session.
11. Stop only when the worker should be interrupted.

Always send meaningful message content. Do not use empty continue messages.

## Clean JSON Invocation

Manager-agent scripts must keep stdout machine-readable when they pipe
`--json` output into a parser. Prefer a built or linked `codexhub` command:

```powershell
codexhub sessions recent --project <project_id_or_name> --limit 10 --json | ConvertFrom-Json
```

When running from a source checkout through pnpm, add `--silent` before the
filter so pnpm lifecycle banners do not corrupt stdout:

```powershell
pnpm --silent --filter @codexhub/cli dev -- session trace <session_id> --after <sequence> --limit 20 --json | ConvertFrom-Json
```

Do not pipe plain `pnpm --filter @codexhub/cli dev -- ... --json` into
`ConvertFrom-Json`, `jq`, or another JSON parser. If parsing fails after a
side-effecting command such as creating a project, workspace, thread, session,
follow-up session, message, or run group, inspect existing Codexhub state before
retrying so the manager does not duplicate the side effect.

## Task Specs

Every non-trivial worker task should include enough specification for the worker
to act without guessing and for a reviewer to audit the result.

Include:

- Goal: the concrete outcome expected.
- Intent: why the change matters and which product boundary it protects.
- Scope: files, packages, APIs, commands, or GUI areas the worker owns.
- Non-scope: files, modules, or product decisions it must not touch.
- Requirements: user-visible, API-visible, CLI-visible, persistence, or runtime
  behavior.
- Acceptance criteria: observable pass/fail requirements.
- Validation: exact commands, tests, screenshots, or manual checks.
- Review focus: what a review agent should inspect most closely.

Workers execute the task spec. They should not rewrite the spec after the fact
to match the implementation.

## Delegating Workers

Give each worker a full, bounded prompt:

```text
You are Worker <name> on <workspace/cwd>.

Goal:
- <single concrete outcome>

Intent:
- <why this matters>

Scope:
- You own: <files/directories/responsibility>
- Do not edit: <files/directories/responsibilities owned by others>

Requirements:
- <behavioral requirement>
- <data/API/CLI/UI contract requirement>
- <compatibility or safety constraint>

Acceptance criteria:
- <specific observable result>
- <specific output/API response/test behavior>
- <no unrelated refactors or metadata churn>

Validation:
- Run: <command>
- If a command cannot be run, explain why and what remains unverified.

Handoff:
- List changed files.
- Summarize implementation decisions.
- Report commands run and results.
- Report risks, assumptions, and follow-up issues.
```

For parallel work, prefer disjoint workspaces or Git worktrees and disjoint file
ownership. Tell workers they are not alone in the codebase, must not revert
others' changes, and must adapt to nearby edits.

Use clone workspaces when each worker should have a self-contained `.git`
directory and maximum metadata isolation. Use worktree workspaces when workers
need fast branch-per-worker setup on one source checkout; Codexhub's default
sandbox includes the source repo Git metadata root for linked worktrees so
worker commits can update objects, refs, and worktree indexes. If a session uses
a custom sandbox policy, include those metadata roots explicitly before asking a
worktree worker to commit.

For pnpm workspaces, run `pnpm install` in the source checkout before creating
worktree workers. When Codexhub sees `pnpm-lock.yaml` in the source checkout, it
hydrates each created worktree with `pnpm install --offline --frozen-lockfile
--ignore-scripts --prod=false`, using the source install's recorded pnpm store
when present. This creates ignored `node_modules/` entries in the worktree so
validation can resolve workspace dependencies without network access. If the
source checkout is not installed or its store is missing, workspace creation
should stop before creating the worktree where possible, with that blocker
instead of asking workers to debug missing `@types/node`, `vitest`, or workspace
package links. If hydration fails after Git creates the worktree, Codexhub
removes that worktree and prunes Git worktree metadata before returning the
failure. Existing worker `node_modules` links must resolve inside the worker
workspace before pnpm runs. If pnpm reports a store permission error, rerun
Codexhub where it can write to the source install's recorded store or reinstall
the source checkout with a writable store.

## Reading Results

Prefer bounded reads:

```powershell
codexhub thread context <thread_id> --limit 10 --tools collapsed --json
codexhub thread trace <thread_id> --limit 20
codexhub thread latest <thread_id>
codexhub thread tool-calls <thread_id> --tools expanded --json
codexhub session result <session_id>
codexhub session trace <session_id> --limit 20
codexhub session trace <session_id> --after <sequence> --limit 20 --json
codexhub session latest <session_id>
codexhub sessions recent --project <project_id_or_name> --limit 10 --json
```

`session latest` is the stable completed-agent-message surface, including with
`--type all`. During an active turn, inspect `session trace` or raw
`session items` for streaming agent message deltas instead of treating those
deltas as a final latest result.

Use raw item reads for debugging:

```powershell
codexhub session items <session_id> --type agentmessage --limit 20 --json
codexhub session items <session_id> --type toolcall --limit 20 --json
codexhub session items <session_id> --limit 20 --after <sequence> --json
```

Default to `agentmessage` when the manager only needs high-signal status.
Request tool calls, tool results, and raw items only when necessary.

Thread ids currently use the same canonical `sess_<uuid>` backing id as the
underlying persisted session. Store and report the canonical id in manager
state.

Session commands accept the canonical `sess_<uuid>` id, a unique leading prefix
including `sess_`, or a unique leading prefix from only the UUID portion. Keep
storing and reporting canonical ids in manager state. If a prefix is ambiguous,
use the JSON error payload's `candidate_ids` to choose a longer prefix or the
full id.

## Sending Messages

For the normal agent-facing path, create an empty thread and send messages to
that thread:

```powershell
codexhub thread create --project <project_id_or_name> --workspace <workspace_id> --idempotency-key <stable_key> --json
codexhub thread send <thread_id> --message "Inspect this workspace and report status." --wait turn-complete --idempotency-key <stable_key> --json
codexhub thread send <thread_id> --message "Continue with the next acceptance criterion and report validation results." --wait accepted --json
```

`thread send` starts the runtime when the thread is empty. If the backing
session is detached, stopped, completed, or failed but still has a Codex thread
cursor, Codexhub attempts to resume before sending. Treat resume as implicit;
do not ask the human or manager agent to press a separate resume control.

Use explicit session modes only when you intentionally operate on the lower-level
session surface:

```powershell
codexhub session send <session_id> --mode steer --message "Stay within apps/cli and keep JSON output stable."
codexhub session send <session_id> --mode continue --message "Continue with the next acceptance criterion and report validation results."
```

Side-effect commands reject ambiguous session prefixes before changing state.
JSON errors include `candidate_ids` when a session prefix is ambiguous.

Mode expectations:

- `initial`: first prompt persisted at session start.
- `steer`: mid-turn correction or extra constraint while running.
- `continue`: explicit next instruction after `awaiting_input`.

Do not rely on the worker to infer intent from an empty message.

Stopped, completed, and failed sessions cannot be messaged through
`session send` because that lower-level command does not resume Codex processes.
Start a fresh related session instead:

```powershell
codexhub session follow-up <terminal_session_id> --message "Continue from the previous result and report status." --json
```

The follow-up defaults to the previous workspace, can use `--workspace
<workspace_id>` for another workspace in the same project, records
`previous_session_id`, and copies the previous task-spec metadata unless new
task-spec options are supplied.

## Review Loop

For substantial work:

1. Worker implements from the original task spec.
2. Worker runs validation.
3. Manager starts a read-only review worker with the original task spec, changed
   files, summary, and validation output.
4. Reviewer checks intent, scope, acceptance criteria, tests, docs, and risks.
5. Worker responds to each finding as accepted, rejected, or deferred.
6. Worker reruns relevant validation after accepted fixes.

Record reusable friction, coordination lessons, or follow-up issues in the
project's docs or issue tracker.

## Product Boundaries

Do not use Codexhub as if it were:

- A validation gate.
- An escalation hierarchy.
- A context compiler.
- A Linear/GitHub replacement.
- A CI or reviewer-agent replacement.
- A project management system.

Codexhub can store worker-reported validation output, task metadata, and review
status, but those are observability records, not quality verdicts.
