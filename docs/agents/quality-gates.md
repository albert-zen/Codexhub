# Quality Gates

Do not duplicate the full quality-gate rules here. The source of truth is:

- `AGENTS.md` section `## Quality Gates`
- `package.json` scripts
- `.github/workflows/ci.yml`

This file maps those repo rules into the Canvas-driven agent workflow.

## Default Full Gate

Use the shortcut defined in `package.json`:

```powershell
pnpm quality
```

That expands to the full local gate documented in `AGENTS.md`:

```powershell
pnpm format
pnpm lint
pnpm check
pnpm test
pnpm build
```

## Narrow Gates

For scoped package work, use the package-level gates documented in `AGENTS.md`. Run broader root checks when the blast radius is unclear.

## Evidence Package

Workers and managers should report:

- Commands run and results.
- Failing output when a gate fails.
- Explanation when a failure is unrelated or a gate cannot be run.
- Changed files.
- Implementation summary.
- Tests added or updated.
- Review findings and worker responses.
- Risks, assumptions, and follow-up issues.
- Documentation-impact check result.

## Skip Policy

A gate may be skipped only when the command is unavailable in the environment, the gate is irrelevant to the touched area, or the human/manager explicitly accepts the risk. Skipped gates must be listed in the handoff.
