# Workspace OS app

Sets up the toolkit on a Windows PC and checks it afterwards. Double-click **Workspace OS.cmd** in the toolkit folder; it opens a page in your browser. Leave the black window open while you use the page.

The app never talks to Claude, so it needs no API key. It changes Claude's setup through Claude Code's own plugin commands (`claude plugin …`), and Claude itself still runs in Claude Desktop and Cowork. Every change is shown with a tick box first, and `~\.claude\settings.json` is backed up (`settings.json.bak-wsos-<time>`) before Claude's settings change.

## What you need

- Node.js (LTS). The launcher links nodejs.org if it is missing.
- Claude Desktop, opened once with the Code tab. The app looks for its `claude.exe`; if it can't find one, setup step 1 takes a path, and without one the changes are written into `settings.json` for Claude to pick up when it starts.
- Git, only for **Update toolkit**.

## Setup steps

| Step | What it does |
|---|---|
| 1 Check this PC | Node, Git, Claude Code, where the toolkit folder is, packs found |
| 2 Clear old installs | Removes plugins listed in `conflicts.json` (control-panel, blast-radius, reflect-mod, savvy-progress), a second copy of a toolkit plugin from another marketplace, and a user-level Windows `WSOS_PROFILE`; points the `my-toolkit` marketplace at this folder. Old folders stay on disk |
| 3 Choose profiles | Personal, Work or both. Creates `Preferences`, `Vault\_inbox`, `Studio` (from `studio/template`) and marks the root with `WSOS_PROFILE` in `<root>\.claude\settings.local.json` (only that key is changed) |
| 4 Plugins | Installs, updates and configures the picked toolkit plugins with your profile folders; turns off unpicked ones. Profile folders already in the settings are kept unless you untick them |
| 5 Restore from a pack | Copies each profile in a pack into the same profile here, without replacing files, and installs the pack's kept mods |
| 6 Check the install | Plugins on at the toolkit's versions, toolkit installed from this folder, no conflicts, folders marked, Studio built |

## Pack for another PC

Saves Studio, Preferences and Vault per profile (Work only if you tick it), optional video lessons, and your kept mods (the `local-mods` plugins in `~\.claude\mod-src` that aren't in `conflicts.json`) into `pack\<YYYY-MM-DD_HHmmss>\` in the toolkit folder, with a `manifest.json`. `pack/` is git-ignored. Files named like `.env`, keys and certificates are skipped; the check is by name only. Your Claude sign-in, transcripts and secret-shield's store never go in.

## Where things live

- Per-PC state: `%USERPROFILE%\.workspace-os\state.json` (profile folders, last change and its backup, last pack).
- Server: `127.0.0.1:47821` only. API calls need the page's token; changes need the page's own origin.

## Tests

```
node --test app/test/*.test.mjs
```

`server.test.mjs` also runs setup end to end through the real `claude` command in a throwaway home folder when `claude` is installed (skipped on Windows and where it isn't).
