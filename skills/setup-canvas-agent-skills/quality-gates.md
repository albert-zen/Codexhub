# Quality Gates

Record the commands and evidence required before manager review can pass.

## Commands

| Gate              | Command     | Required? | Notes |
| ----------------- | ----------- | --------- | ----- |
| Format            | `<command>` | yes/no    |       |
| Lint              | `<command>` | yes/no    |       |
| Typecheck         | `<command>` | yes/no    |       |
| Unit tests        | `<command>` | yes/no    |       |
| Integration tests | `<command>` | yes/no    |       |
| E2E/browser       | `<command>` | yes/no    |       |

## Evidence

Implementation evidence must include:

- Commands run and results.
- Failing output when a gate fails.
- Explanation if failure is unrelated to the change.
- Browser screenshots or traces when UI behavior changed.
- Regression test evidence for bug fixes.
- Summary of behavior delivered.
- Changed files/modules.
- Tests added or updated.
- Standards risks.
- Spec gaps or open questions.

## Skip Policy

A gate may be skipped only when:

- The command does not exist yet.
- The gate is irrelevant to the touched area.
- The user explicitly accepts the risk.

Skipped gates must be listed in the evidence package.
