# Issue Tracker: GitHub

Use GitHub Issues for PRDs, issue slices, dependency links, and status updates.

## Mechanics

- Create issue: `gh issue create --title "..." --body-file <file>`
- Read issue: `gh issue view <number> --comments --json number,title,body,labels,comments,state,url`
- List issues: `gh issue list --state open --json number,title,labels,state,url`
- Comment: `gh issue comment <number> --body-file <file>`
- Label: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` when running inside a clone.

## Dependencies

- Publish blockers before blocked issues.
- Put `Blocked by: #123` and `Blocks: #456` in the issue body.
- If the repo uses GitHub issue relationships or project fields, record the exact command/API here.

## Status

Use labels or comments for:

- `ready-for-agent`
- `in-progress`
- `review-requested`
- `changes-requested`
- `done`
