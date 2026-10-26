# Workspace OS (my-toolkit)

Workspace OS as a plugin pack for Claude Code, running in the Claude Desktop Code tab on a Pro plan. It replaces the separate Electron app, which Anthropic requires to use a paid API key.

## Plugins

| Plugin | What it does |
|---|---|
| `control-center` | The pack's one pane: the work stage (Brief, Plan, Build, Review, Ship, Report), a search, and every skill, plugin and workflow with one-click runs |
| `deploy-status` | Latest Vercel deployments in the status line; `/deploy-status` lists them |
| `handoff` | Picks up the plan in `.claude/handoff.md` and gives it to Claude with the first message |
| `learner` | Finds tasks you keep asking for and proposes a skill for each; nothing is added without your approval |
| `nudges` | Suggests the next command above the prompt, with a Run button that asks first |
| `secret-shield` | Replaces secrets in your messages with placeholders before Claude sees them and keeps the values outside your projects |
| `token-weather` | A context-window forecast in the band above the prompt |
| `workspace-os` | Personal and Work profiles: the profile comes from the saved environment a session starts in (`WSOS_PROFILE`), the other profile's folders are blocked, deploys, pushes, migrations and `.env` writes always ask, other mods can't write the shared `~/.claude/CLAUDE.md`, the `feedback` skill is the one writer of each profile's `Preferences` notes, `/mode tutor|build|do|review` picks a learning mode per session (`/mode default …` per folder), and the `learn-from-video` skill turns source-cited video lessons into practice without silently changing your taste; profile `Vault` notes are accessed through the guarded vault tools, with drafts in `_inbox` and approved edits only |

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
