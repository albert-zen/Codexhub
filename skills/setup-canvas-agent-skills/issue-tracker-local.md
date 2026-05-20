# Issue Tracker: Local Markdown

Use local markdown files for PRDs, issue slices, dependency links, and status updates.

## Paths

Use paths from `docs/agents/artifact-paths.md`.

Do not maintain local issue paths here. This file defines how local markdown work items behave; `artifact-paths.md` defines where they live.

## Issue IDs

Use stable local IDs:

```text
<slug>-001
<slug>-002
```

## Dependencies

- Publish blocker issue files first.
- Record `Blocked by` and `Blocks` sections in each issue file.
- Keep the DAG artifact as the canonical dependency graph.

## Status

Each issue file must include:

```markdown
Status: ready-for-agent | in-progress | review-requested | changes-requested | done
```
