# Workspace OS portable app: spec

Status: reviewed 2026-10-27 (goldfish review, fixes folded in). Owner thread: "Package Workspace OS as a portable app".
Wireframe (approved layout): https://claude.ai/artifact/2U1dAS49pmBAyETn4Q6Kux
Repo: Player-cloud/Claude-application, branch `claude/project-thread-r1q0z9`, code under `app/` plus `Workspace OS.cmd`.

## Goal
joshua can take everything built so far (the toolkit plugins, his kept local mods, Learning Studio, Personal/Work profiles, plugin settings) to any Windows PC, set it up in one sitting, and use a small dashboard afterwards.

## Hard constraint
The app never calls Claude. A local app that talks to Claude needs a paid API key, and the claude.ai login can't be used by third-party apps (that is why the Electron app was dropped). The app installs, checks and opens things. Claude runs in Claude Desktop (Code tab) and Cowork.

## Terms
- **Toolkit plugins**: the 8 plugins in `.claude-plugin/marketplace.json` (marketplace `my-toolkit`): control-center, secret-shield, token-weather, deploy-status, handoff, learner, nudges, workspace-os. The default set for a new PC without a pack is the laptop's 6: workspace-os, secret-shield, handoff, nudges, control-center, learner.
- **Kept mods**: plugins installed from the `local-mods` marketplace, which is the folder `~\.claude\mod-src` (one folder per mod with its own `.claude-plugin\plugin.json`, listed in `mod-src\.claude-plugin\marketplace.json`), minus anything in `app/conflicts.json`. On the laptop: replay-theater, cache-tax (locally patched), filetree, skins.
- **Profile mark**: `env.WSOS_PROFILE = personal|work` in `<root>\.claude\settings.local.json`. A profile is healthy when its root exists, is marked, and `Studio\library.js` exists.
- **Handbook**: the Workspace OS help guide, https://claude.ai/artifact/J1eS7PTyp1EbUhuyqo9NCb.
- **Pack**: a folder `pack\<YYYY-MM-DD_HHmm>\` inside the toolkit folder (git-ignored).

## Shape
- The toolkit folder itself is the app: a Git clone, on a USB stick or on disk.
- `Workspace OS.cmd` (repo root): checks Node is installed (links nodejs.org if not), runs `node app\server.mjs --open`.
- `app/server.mjs`: plain Node HTTP server on 127.0.0.1:47821, no dependencies. Rejects any Host other than 127.0.0.1/localhost:port; every `/api/` call needs a per-run token injected into the page; POSTs must also carry the page's own Origin. On a busy port it opens the running instance only if `/whoami` answers with the secret it wrote to `~\.workspace-os\server.json`; otherwise it says the port is taken.
- Per-PC state: `%USERPROFILE%\.workspace-os\state.json` (toolkit folder last seen, profile roots, Claude path, last change with its results and backup, last pack). Nothing PC-specific goes in the toolkit folder except packs.
- On each launch the app compares its folder with the one in state.json. If it moved (a new USB drive letter), the dashboard says so and step 2 re-points Claude.
- Programs run without a shell, arguments as a list (`claude.exe`, or `node <cli.js>` for an npm install). Tested with spaces, `&`, `%`, `"`, `^`.

### Claude Code access (review finding 3)
- If the CLI is found, changes use `claude plugin marketplace add|update`, `install [--config k=v]`, `enable`, `disable`, `update`, `uninstall --scope`, `configure --values-stdin` (verified in a throwaway home on Linux, 2026-10-27).
- Claude Desktop doesn't put `claude` on PATH. Search order: saved path, PATH, `~\.local\bin\claude.exe`, `%APPDATA%\Claude\claude-code\<newest version>\claude.exe`, `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\cli.js`. A candidate counts only if `--version` says "Claude Code". Step 1 takes a typed path.
- If no CLI is found, the same changes are written into the backed-up `~\.claude\settings.json` keys: `extraKnownMarketplaces`, `enabledPlugins` (`false` instead of uninstall) and `pluginConfigs.<id>.options`. Claude Code installs them at its next start. **To verify on the laptop.**

### Change lists
Steps 2, 3, 4 and 5, Update toolkit, and Pack use change lists. The server builds the list from a read-only snapshot, and the page shows it with a tick per change. Apply sends only the ticked ids, and the server rebuilds the list and runs those ids (the page never sends commands). Ids are `<kind>:<subject>`, for example `remove:control-panel@my-toolkit`, `toolkit:here`, `mark:work`, `install:nudges`, `config:learner`, `pack:personal:Vault`. Apply stops at the first failure. Before any change to Claude's settings, `settings.json` is copied to `settings.json.bak-wsos-<timestamp to ms>`. Each apply is recorded in state.json; if it stopped, the dashboard offers **Resume** (back to that step) or **Put settings back** (copies that backup over `settings.json`). Steps 1 and 6 are read-only. Step 7 just finishes.

### API
| Method | Path | Does |
|---|---|---|
| GET | /api/state | state.json, toolkit folder, moved-from folder |
| GET | /api/check | step 1 facts, catalog, current profile roots, wizard defaults, packs |
| GET | /api/health | dashboard |
| GET | /api/verify | step 6 checks |
| POST | /api/plan | `{step, input}` → change list (no ops) |
| POST | /api/apply | `{step, input, ids}` → results + backup path |
| POST | /api/restore-backup | puts the last change's settings backup back |
| POST | /api/settings | saves a Claude Code path after checking it |
| POST | /api/open | opens one of a fixed set of places |
| POST | /api/setup-done | marks setup finished |

## Setup wizard
1. **Check this PC**: Node, Git, Claude Code (path + version), toolkit folder (and whether it moved), packs found.
2. **Clear old installs** (joshua: "remove anything that would conflict"). A conflict is:
   - a plugin named in `app/conflicts.json`, from any marketplace. The format is `{"plugins":[{"name","why"}]}`, currently control-panel, blast-radius, reflect-mod and savvy-progress. Fix: `claude plugin uninstall <id> --scope <scope>`;
   - a toolkit plugin name installed from a marketplace other than `my-toolkit`. Fix: uninstall that copy;
   - a user-level Windows `WSOS_PROFILE`. Fix: `reg delete HKCU\Environment /v WSOS_PROFILE /f`. A machine-level one is only reported;
   - `my-toolkit` missing or pointing elsewhere. Fix: `claude plugin marketplace add <this folder>`, which re-points an existing `my-toolkit` and keeps installed plugins. The old folder is left on disk.
3. **Choose profiles**: Personal, Work, or both, each with a root folder. Roots may not overlap each other or the toolkit folder, and a root not on C: gets a USB warning. For each picked profile: create root, `Preferences`, `Vault\_inbox`, `Studio\inbox`; copy `studio\template\` (STUDIO.md, build-library.mjs, index.html, types.md) into `<root>\Studio\` where missing; run `build-library.mjs` once if `library.js` is missing; merge only `env.WSOS_PROFILE` into `<root>\.claude\settings.local.json`. Root paths never come from a pack.
4. **Plugins**: tick list of the 8. Default: newest pack's list, else what's on now, else the laptop's 6. Picked: install (with options), enable, update if the version differs from the toolkit, configure changed options. Unpicked and on: disable. Options per manifest: workspace-os `personalRoots`, `workRoots` (`;`-separated), `personalVault`, `workVault` (= `<root>\Vault`); learner `personalRoots`, `workRoots`. Roots already set are all kept (missing ones shown as "not found on this PC") unless unticked; this PC's root goes first.
5. **Restore from a pack**: newest pack preselected, picker if more than one. A pack profile is restored only into the same profile, copying Preferences, Vault, Studio and Learning\videos without replacing existing files. Mods not installed here: copy into `~\.claude\mod-src`, add them to its marketplace.json (existing entries stay), add `local-mods` to Claude, install. Refuses packs with a newer manifest version.
6. **Check the install**: toolkit installed from this folder; no conflicts left; each enabled toolkit plugin at the toolkit's version; each picked profile's root exists, is marked, and its Studio is built.
7. **Done**: reminder to restart Claude Desktop, then the dashboard.

## Dashboard
Tiles: Plugins (x of 8 on, out of date, from this folder?), Install check (step 6 result), Toolkit (commit, branch, local edits), Profiles (marked?), Last pack. Open: Claude Desktop (`%LOCALAPPDATA%\AnthropicClaude\claude.exe`, else the download page), Cowork (claude.ai), each profile's Studio and folder, the Handbook. Buttons: Check again, **Update toolkit** (`git pull --ff-only`, then `claude plugin marketplace update my-toolkit` and `claude plugin update` per installed toolkit plugin; refuses over local edits), Pack for another PC, Add or change a profile. A "Needs you" list links each item to its step.

## Pack for another PC
Into `<toolkit>\pack\<YYYY-MM-DD_HHmm>\<profile>\…`: picked profiles' Preferences, Vault, Studio (+ Learning\videos if ticked); Work is unticked by default and warns when ticked. Kept mods go into `mods\<name>\` without `.git` and `node_modules`. `manifest.json`:
```json
{ "version": 1, "createdAt": "ISO time", "toolkitCommit": "e4d7aa8", "profiles": ["personal"],
  "plugins": ["workspace-os", "..."], "options": { "nudges@my-toolkit": { "workFridayUpdate": true } }, "mods": ["filetree"] }
```
Only true/false plugin options travel; folder options are asked again. Skipped by name: `.env*`, `*.pem|key|pfx|p12`, `id_rsa|ed25519|ecdsa(.pub)`. The check is by name only, and the page says so. Never included: secret-shield's store, Claude sign-in, transcripts. `pack/` is in `.gitignore` (the repo is public).

## Out of scope for release 1
Mac/Linux polish, auto-start, installing Node/Git/Claude for the person, Cowork folder connections, video tools (ffmpeg/whisper), deleting old folders, running the toolkit's own test suites (developers run those in the repo).

## To verify on the laptop
- Findings 3 and 16: whether Claude Code picks up plugins written straight into settings.json, and whether a mark at a profile root reaches sessions opened in a subfolder. If it doesn't, the plan is a per-project mark, or opening sessions at the root.
- Where Claude Desktop keeps `claude.exe`.

## Review log
- 2026-10-27, goldfish review (`goldfish-review-2026-10-27.md`), joshua's picks: **fixed** 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 (documented; laptop check pending), 17, 18, 19, 20, 21, 22, 23, 24, 25, 26. **Skipped** 1, 2, 5 (they would undo the approved dashboard, the browser screens, and the conflict removal joshua asked for).
- Finding 3 was applied as a fallback. The CLI stays primary because it was verified to work and it also handles uninstall, update and the plugin cache. Settings keys are written directly only when the CLI isn't found.
