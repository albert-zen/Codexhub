# Symphony Lessons

Reusable lessons from the Symphony control-plane work that apply to Codexhub:

- Launch Codex app-server with clean stdio. Protocol processes should not run
  through shells or profiles that can print banners, hook output, prompts, or
  color control sequences before JSON-RPC traffic starts.
- Treat Windows shell hooks separately from protocol process launch. Interactive
  convenience hooks belong in human shells, not in child process launch paths.
- Keep each worker cwd under a dedicated workspace root. The control plane
  should know the workspace path and cwd before starting a worker so logs,
  commands, and file changes are attributable.
- Preserve raw Codex event/item payloads before creating projections. Derived
  fields are allowed to change as classifiers improve; raw payloads are the
  source of truth.
- Store monotonic per-session sequence numbers. Manager agents need cheap
  incremental reads instead of scanning or replaying a whole stream.
- Keep manager-agent reads compact. The default surface should expose status,
  last agent message, and filtered recent items rather than the full transcript.
- Make state transitions explicit and shared. API, CLI, and GUI behavior should
  all use the same rules for when `steer` and `continue` are valid.
- Separate task planning from runtime transport. GitHub or Linear can hold issue
  specs, but the running worker state lives in Codexhub.
- Prefer small issue slices. Control-plane work has many shared files, so issues
  should name expected files and avoid opportunistic refactors.
- Keep process supervision observable before making it clever. V1 needs clear
  process metadata, failure reasons, and logs more than sophisticated scheduling.
- Design for interruption. A worker may fail, be stopped, or await input; the
  stored session record should make the next operator action obvious.
- Document handoffs in repo docs. Parallel agents need a durable trail of what
  was claimed, what was discovered, and what remains risky.

Rejected assumptions for Codexhub v1:

- Linear is not the queue.
- Claim leases are not the core model.
- Validation gates, escalation, and fixed flywheel policy are out of scope.
- Remote worker fleets are out of scope.
- Multi-tenant auth is out of scope.
- Full transcript replay is not the default manager-agent API.
- Derived projections do not replace raw event storage.

Implementation consequences:

- Add a narrow launcher boundary before wiring the real Codex app-server.
- Test ingestion with fixture payloads before relying on live workers.
- Keep SQLite schema names close to the shared core types.
- Make every API that lists items cursor-friendly from the start.
- Keep stop/failure paths visible in the UI even if cleanup behavior is basic.
