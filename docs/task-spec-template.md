# Task Spec Template

Use this template for non-trivial worker tasks. The task spec is input to the
worker and reviewer. The worker should not rewrite the spec to match the
implementation after the fact.

## Problem

What user or system pain does this task address?

## Intent

Why does this change matter? What product boundary or architecture principle
should it protect?

## Scope

Expected components, packages, files, API routes, CLI commands, GUI views, or
docs.

## Non-Scope

What must not be included, even if nearby?

## Required Behavior

User-visible, API-visible, CLI-visible, persistence, runtime, or workflow
behavior.

## Acceptance Criteria

- Concrete pass/fail requirement.
- Concrete pass/fail requirement.
- Concrete pass/fail requirement.

## Validation

- Exact command or check.
- Exact command or check.
- Manual/browser verification if relevant.

## Review Focus

What should the review subagent scrutinize most closely?

## Handoff Requirements

- Changed files.
- Implementation summary.
- Commands run and results.
- Review findings and worker responses.
- Risks, assumptions, and follow-up issues.
