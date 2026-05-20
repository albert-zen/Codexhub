# Artifact Paths

Use these defaults unless the repo already has stronger conventions.

| Artifact                     | Default path                                   |
| ---------------------------- | ---------------------------------------------- |
| Architecture Canvas Markdown | `docs/architecture/CANVAS.md`                  |
| Architecture Canvas HTML     | `docs/architecture/canvas.html`                |
| PRD                          | `docs/prd/<slug>.md`                           |
| Issue DAG                    | `docs/implementation/<slug>-dag.md`            |
| Execution evidence           | `docs/implementation/<slug>-evidence.md`       |
| Review report                | `docs/implementation/<slug>-review.md`         |
| Open questions               | `docs/implementation/<slug>-open-questions.md` |

## Naming

- Use short kebab-case slugs.
- Use the same slug across PRD, DAG, evidence, and review artifacts.
- If artifacts are published to an issue tracker, keep the local artifact path linked from the tracker item.
