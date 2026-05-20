# HTML Canvas Format

The HTML Canvas is a durable architecture artifact, not only a temporary report. Save it to the Architecture Canvas HTML path defined in `docs/agents/artifact-paths.md`.

If `docs/agents/artifact-paths.md` is missing, run `setup-canvas-agent-skills` before creating a durable Canvas.

Use Matt Pocock's HTML architecture report style as the baseline: Tailwind via CDN, Mermaid via CDN, concise prose, and visual before/after diagrams.

## Scaffold

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Architecture Canvas — {{system name}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({
        startOnLoad: true,
        theme: "neutral",
        securityLevel: "loose",
      });
    </script>
    <style>
      .seam {
        stroke-dasharray: 4 4;
      }
      .leak {
        stroke: #dc2626;
      }
      .deep {
        background: linear-gradient(135deg, #0f172a, #1e293b);
      }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-6xl mx-auto px-6 py-10 space-y-10">
      <!-- canvas sections -->
    </main>
  </body>
</html>
```

## Required Sections

- **System Goal**: the product/domain purpose.
- **Domain Model**: concepts and relationships.
- **System Map**: Mermaid or hand-built diagram of major modules and dependency direction.
- **Key Flows**: end-to-end runtime or user flows.
- **Modules And Interfaces**: cards for important modules, with interface, seam, dependencies, test surface, and design judgment.
- **Risk Map**: visual callouts for shallow modules, weak seams, missing tests, security/performance concerns.
- **Decisions**: ADR links and hard-to-reverse tradeoffs.
- **Open Questions**: unresolved alignment points.

## Visual Patterns

Use Mermaid for graph-shaped structures:

- dependency maps
- call graphs
- sequence diagrams
- DAGs

Use hand-built HTML/SVG for:

- deep vs shallow module mass diagrams
- before/after deepening visuals
- cross-sections of layered shallowness
- hotspot/risk maps

## Style

- Let diagrams carry the architecture.
- Use concise prose.
- Use the architecture vocabulary exactly: module, interface, implementation, depth, deep, shallow, seam, adapter, leverage, locality.
- Avoid generic labels like component, service, API, boundary when the precise term applies.
- Include file references as evidence, not as the primary structure.

## Sync With Markdown

If both Markdown and HTML Canvas exist:

- Keep the same section names.
- Keep the same system map and key risks.
- Update both when architecture understanding changes.
- Prefer HTML for human review sessions and Markdown for diff review.
