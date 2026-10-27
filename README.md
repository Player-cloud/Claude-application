# Workspace OS (my-toolkit)

This repo also holds [Learning Studio](studio/README.md), a design reference library viewer that works alongside the plugins.

Workspace OS as a plugin pack for Claude Code, running in the Claude Desktop Code tab on a Pro plan. It replaces the separate Electron app, which Anthropic requires to use a paid API key.

## Plugins

| Plugin | What it does |
|---|---|
| `control-center` | The pack's one pane: the work stage (Brief, Plan, Build, Review, Ship, Report), a search, and every skill, plugin and workflow with one-click runs, including the Plan, Build, Check workflow (goldfish review, build, drift check, qa, then ship) |
| `deploy-status` | Latest Vercel deployments in the status line; `/deploy-status` lists them |
| `handoff` | Picks up the plan in `.claude/handoff.md` and gives it to Claude with the first message |
| `learner` | Finds tasks you keep asking for in this profile (or, without one, this project) and proposes a skill for each. It shows what it would send before any model call, and writes approved skills and lessons only into the current project, never `~/.claude`. It proposes a skill only for work that is repeated, stable and costly to get wrong |
| `nudges` | Suggests the next command above the prompt, with a Run button that asks first; in the Work profile only, the week's manager update on Friday afternoon (setting: Friday update in Work) |
| `secret-shield` | Replaces secrets in your messages with placeholders before Claude sees them and keeps the values outside your projects |
| `token-weather` | A context-window forecast in the band above the prompt |
| `workspace-os` | Personal and Work profiles: the profile comes from the saved environment a session starts in (`WSOS_PROFILE`), or, when that is unset, from the profile folder the session starts in, the other profile's folders are blocked, deploys, pushes, migrations and `.env` writes always ask, other mods can't write the shared `~/.claude/CLAUDE.md`, the `feedback` skill is the one writer of each profile's `Preferences` notes, `/mode tutor|build|do|review` picks a learning mode per session (`/mode default …` per folder), and the `learn-from-video` skill turns source-cited video lessons into practice without silently changing your taste, watches local videos through the optional `claude-video-vision` tools (pinned 1.4.0, local Whisper), and checks each lesson against the toolkit before proposing a change; the `wrap-up` skill summarises a session (decided, ruled out, still open, next move) and offers to save it to the vault inbox; the `goldfish-review` skill has four fresh subagents review a plan in `docs/designs/` (simpler option, clarity, what breaks, buildable without guessing) and fixes only the findings the user picks, and `drift-check` lists where the built code differs from its plan (both from the Elephant-Goldfish Model, egm.dev, without installing it); goldfish-review adds a design reviewer when the plan has screens and can start a plan from `spec-template.md`; the `qa` skill clicks through the plan's journeys in a real browser, in named test states, and reports with screenshots without changing code (from Remy, goremy.ai, without using it); each risky action you approve (push, deploy, recursive delete, `.env` write) is noted as one line in the profile vault's `_log/actions.md`, secrets masked; recursive deletes and discarding uncommitted work also always ask; profile `Vault` notes are accessed through the guarded vault tools, with drafts in `_inbox` and approved edits only |

## Quiet by default

The chat stays the main UI. These are the rules every plugin is reworked to follow (the old `control-panel` pane is retired; `control-center` is the pack's one pane):

1. No pane opens by itself; panes open from a command or a button, and Escape closes them.
2. One pane and one status-line entry for the pack, not one per plugin.
3. The band above the prompt is empty unless something needs a decision.
4. No toasts for routine events.
5. Safety hooks show nothing until they block or ask.

## Install

Add this folder as a marketplace (`claude plugin marketplace add <this folder>`), then install plugins one at a time. A folder marketplace is read in place, so an edit plus `/reload-plugins` reaches a running session.

## Tests

- Mod tests: `claude plugin test plugins/<name>` for each plugin.
- Manifest and hooks: `claude plugin validate plugins/<name>`.
- secret-shield's scrubber, which starts real processes: `node --test plugins/secret-shield/hooks/scrub.spec.mjs`.
- learner's collector, run against a throwaway home folder: `node --test plugins/learner/hooks/collect.spec.mjs`.
- The two copies of the secret detector (`detect.ts` in secret-shield and workspace-os) must match; secret-shield's is the source: `node --test plugins/workspace-os/hooks/detect-copy.spec.mjs`.
