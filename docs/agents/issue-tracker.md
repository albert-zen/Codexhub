# Issue Tracker

GitHub Issues are the active execution source of truth for Codexhub.

Related repo sources:

- `docs/github-issues.md` keeps a local backlog synthesis for manager agents and human maintainers.
- `.github/ISSUE_TEMPLATE/task_spec.yml` defines the GitHub task-spec issue shape.
- `docs/task-spec-template.md` defines the same task-spec content for local drafting.

## Mechanics

Use the `gh` CLI from this repo checkout.

- Create issue: `gh issue create --title "..." --body-file <file>`
- Read issue: `gh issue view <number> --comments --json number,title,body,labels,comments,state,url`
- List issues: `gh issue list --state open --json number,title,labels,state,url`
- Comment: `gh issue comment <number> --body-file <file>`
- Label: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

Infer the GitHub repo from `git remote -v`: `https://github.com/albert-zen/Codexhub.git`.

## Work Item Contract

PRDs, task specs, issue slices, and DAG nodes should preserve the task-spec fields used by `docs/task-spec-template.md`:

- Problem
- Intent
- Scope
- Non-Scope
- Required Behavior
- Acceptance Criteria
- Validation
- Review Focus

## Dependencies

- Publish blockers before blocked work so real issue identifiers can be referenced.
- Record `Blocked by` and `Blocks` in issue bodies or comments.
- If a local DAG artifact exists, link it from the GitHub issue and keep the GitHub issue as the active execution item.

## Status

Use issue comments and PR/review state for execution status. Do not treat Codexhub review metadata as a quality verdict; it is observability only.
