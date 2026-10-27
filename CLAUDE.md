# Working in this repo

- Plans live in `docs/designs/<name>.md` (template: `plugins/workspace-os/skills/goldfish-review/spec-template.md`). A change that alters what a planned component does updates its plan in the same PR, so the plan stays the source of truth. The `drift-check` skill finds the places where they've drifted apart.
- Run the tests listed in the README for every plugin you touch before opening a PR.
