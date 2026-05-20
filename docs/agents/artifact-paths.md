# Artifact Paths

This file is the source of truth for Canvas-driven workflow artifact paths in Codexhub.

| Artifact                     | Path                                           |
| ---------------------------- | ---------------------------------------------- |
| Architecture Canvas Markdown | `docs/architecture/CANVAS.md`                  |
| Architecture Canvas HTML     | `docs/architecture/canvas.html`                |
| PRD / design spec draft      | `docs/prd/<slug>.md`                           |
| Issue DAG                    | `docs/implementation/<slug>-dag.md`            |
| Execution evidence           | `docs/implementation/<slug>-evidence.md`       |
| Review report                | `docs/implementation/<slug>-review.md`         |
| Open questions               | `docs/implementation/<slug>-open-questions.md` |

GitHub Issues remain the active execution source of truth. Local PRD, DAG, evidence, and review artifacts should link to the relevant GitHub issue when one exists.

Use short kebab-case slugs and keep the same slug across related artifacts.
