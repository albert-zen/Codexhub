# Issue Tracker

Record where PRDs, issue slices, and DAG status live for this repo. This file must contain the concrete mechanics for the selected tracker, not only the tracker name.

## Tracker

Use one of:

- GitHub Issues — seed from [issue-tracker-github.md](issue-tracker-github.md)
- Linear — seed from [issue-tracker-linear.md](issue-tracker-linear.md)
- Local markdown — seed from [issue-tracker-local.md](issue-tracker-local.md)
- Other — record the user's workflow in prose, including how to create, update, link, block, and close work items

## Publishing Rules

- PRDs are parent work items.
- Issue slices are child work items or linked work items.
- Publish blockers before blocked issues so real identifiers can be referenced.
- Record dependency edges in both the issue body and the DAG artifact.
- Define the exact command, API, connector, or file operation used to publish and update each work item type.

## Labels Or States

Map these canonical roles to the tracker:

| Role              | Tracker label/state | Meaning                                 |
| ----------------- | ------------------- | --------------------------------------- |
| `needs-triage`    | `needs-triage`      | Maintainer evaluation needed            |
| `needs-info`      | `needs-info`        | Waiting on reporter/user                |
| `ready-for-agent` | `ready-for-agent`   | AFK-ready                               |
| `ready-for-human` | `ready-for-human`   | Human judgment or implementation needed |
| `wontfix`         | `wontfix`           | Will not be actioned                    |

## Status Updates

Define how manager agents record:

- Issue started
- Worker assigned
- Blocked
- Evidence attached
- Review requested
- Review passed
- Done
