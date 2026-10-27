import type { EngineInterface, Register } from 'claude-code'

import { MODE_HELP, MODES, SCRATCH_TEXT, modeAtStart, modeFromName, type ModeId } from './modes'
import { isSecretVaultOf, isUnder, norm, parseRoots, pathsInCommand, resolve } from './paths'
import { gateReason } from './rules'
import { cleanRelative, countOf, draftName, excerpt, hasSecret, isHidden, isPrivate, linksTo, maskSecrets, noteName, score, versionOf } from './vault'

type Profile = 'personal' | 'work'

const LABEL: Record<Profile, string> = { personal: 'Personal', work: 'Work' }

// What Claude reads when a call is refused, and passes on to you: what happened in
// one sentence, and what to do only where there is something to do.
const outsideProfile = (p: Profile) => `workspace-os blocked this: the path is outside the ${LABEL[p]} profile.`
const NO_PROFILE =
  'workspace-os blocked this: Work folders are off limits in a session with no profile. To use them, start the session from the Work environment.'
const CHECK_FAILED = 'workspace-os blocked this: its folder check failed.'

// Another plugin writing shared or taste memory. ~/.claude/CLAUDE.md is read by every
// session, Personal and Work alike, so a mod's save there would cross the boundary.
const GLOBAL_DENY = 'workspace-os blocked this: ~/.claude/CLAUDE.md is shared by Personal and Work, so plugins can\'t write it.'
const GLOBAL_TOAST =
  "workspace-os: ~/.claude/CLAUDE.md is shared by Personal and Work, so global saves are off. Use 'This repo instead', or the feedback skill for taste."
const PREFS_DENY = 'workspace-os blocked this: Preferences notes are written only through the feedback skill, with your approval.'
const WRITE_CHECK_FAILED = 'workspace-os blocked this: its memory check failed.'
const VAULT_DIRECT = 'workspace-os blocked this: the notes vault is read only through the vault tools (vault_search, vault_read, vault_list, vault_backlinks).'

// ---- The vault (read-only) ----

const noVault = (dir: string | null) =>
  dir ? `This profile has no notes vault yet (expected at ${dir}).` : 'This session has no profile, so it has no notes vault.'
const MAX_NOTES = 2000
const MAX_NOTE_CHARS = 100_000

// Where the vault really is, every link followed, or null when it doesn't exist yet.
async function vaultRealPath($: EngineInterface, vaultDir: string): Promise<string | null> {
  try {
    const st = await $.fs.stat(vaultDir, { resolve: true })
    return st.kind === 'dir' && st.realPath ? norm(st.realPath) : null
  } catch {
    return null
  }
}

// Every note's path inside the vault. Only real folders are entered: a link is listed
// as `other` and skipped, so nothing outside the vault is pulled in; .obsidian is never
// entered.
async function walkNotes($: EngineInterface, vaultDir: string, rel = '', out: string[] = []): Promise<string[]> {
  if (out.length >= MAX_NOTES) return out
  const entries = await $.fs.list(rel ? `${vaultDir}/${rel}` : vaultDir)
  for (const entry of entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name
    if (isHidden(child)) continue
    if (entry.kind === 'dir') await walkNotes($, vaultDir, child, out)
    else if (entry.kind === 'file' && /\.md$/i.test(entry.name)) out.push(child)
    if (out.length >= MAX_NOTES) break
  }
  return out
}

// One note's text, or null when it isn't a note this tool may show: missing, private
// (`agent: none`), or landing outside the vault once every link is followed.
async function readNote($: EngineInterface, vaultDir: string, vaultReal: string, rel: string): Promise<string | null> {
  const path = `${vaultDir}/${rel}`
  try {
    const st = await $.fs.stat(path, { resolve: true })
    if (st.kind !== 'file' || !st.realPath || !isUnder(norm(st.realPath), vaultReal)) return null
    const text = String(await $.fs.read(path))
    return isPrivate(text) ? null : text
  } catch {
    return null
  }
}

// The paths a call would touch. A shell command also runs in the session's folder,
// and a search with no path searches it, so the folder itself counts.
function touched(tool: string, e: Record<string, unknown>, cwd: string): string[] | null {
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? [v] : [])
  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return s(e.file_path)
    case 'NotebookEdit':
      return s(e.notebook_path)
    case 'Glob':
      return [...s(e.path), ...pathsInCommand(String(e.pattern ?? ''))].concat(e.path ? [] : [cwd])
    case 'Grep':
      return e.path ? s(e.path) : [cwd]
    case 'Bash':
    case 'PowerShell':
      return [cwd, ...pathsInCommand(String(e.command ?? ''))]
    default:
      return null
  }
}

export const register: Register = (on, options) => {
  const roots: Record<Profile, string[]> = {
    personal: [...parseRoots(options.personalRoots), ...parseRoots(options.personalVault)],
    work: [...parseRoots(options.workRoots), ...parseRoots(options.workVault)],
  }

  // Read once when the session starts, from the saved environment it started in, so
  // nothing Claude reads later (a file, a page, a tool result) can change it.
  // Until then, and with any other value, the session has no profile.
  let profile: Profile | null = null
  let cwd = ''
  let home = ''

  // No profile fails closed: Work is blocked, so a forgotten environment can't reach it.
  const blocked = () => (profile === 'work' ? roots.personal : roots.work)
  // The other profile's secret-shield vault files count as its folders too.
  const inBlocked = (path: string) => {
    const p = resolve(path, cwd, home)
    return blocked().some(root => isUnder(p, root) || isSecretVaultOf(p, home, root))
  }

  // Taste notes live in a Preferences folder inside each profile folder, so the
  // boundary above already keeps one profile's taste from the other.
  const prefsFolders = () => [...roots.personal, ...roots.work].map(root => `${root}/preferences`)
  const resolved = (path: string) => resolve(path, cwd, home)
  const isGlobalMemory = (path: string) => resolved(path) === `${home}/.claude/claude.md`
  const inPrefs = (path: string) => prefsFolders().some(folder => isUnder(resolved(path), folder))

  // Why a call of Claude's that changes memory must ask, or null.
  const memoryReason = (tool: string, input: unknown): string | null => {
    const i = (input ?? {}) as Record<string, unknown>
    const paths =
      tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit'
        ? [String(i.file_path ?? i.notebook_path ?? '')]
        : tool === 'Bash' || tool === 'PowerShell'
          ? pathsInCommand(String(i.command ?? ''))
          : []
    if (paths.some(p => p && isGlobalMemory(p))) return 'changes to the global CLAUDE.md always ask'
    if (paths.some(p => p && inPrefs(p))) return 'changes to your Preferences always ask'
    return null
  }

  // This profile's vault: its own setting, else a Vault folder in the profile's first
  // folder. Inside the profile, so the boundary keeps the other profile out of it.
  const vaultDir = (): string | null => {
    if (!profile) return null
    const own = profile === 'work' ? options.workVault : options.personalVault
    if (typeof own === 'string' && own.trim()) return own.trim().replace(/[\\/]+$/, '')
    const raw = profile === 'work' ? options.workRoots : options.personalRoots
    const first = typeof raw === 'string' ? raw.split(';').map(s => s.trim()).find(Boolean) : undefined
    return first ? `${first.replace(/[\\/]+$/, '')}\\Vault` : null
  }
  const inOwnVault = (path: string) => {
    const dir = vaultDir()
    return dir !== null && isUnder(resolve(path, cwd, home), resolve(dir, '', ''))
  }

  // The folder this profile's taste notes are in, as you typed it in the settings.
  const prefsShown = () => {
    const raw = profile === 'work' ? options.workRoots : profile === 'personal' ? options.personalRoots : ''
    const first = typeof raw === 'string' ? raw.split(';').map(s => s.trim()).find(Boolean) : undefined
    return first ? `${first.replace(/[\\/]+$/, '')}\\Preferences` : null
  }

  const statusText = () => {
    if (cwd && blocked().some(root => isUnder(cwd, root))) {
      return profile ? `${LABEL[profile]} · this folder belongs to the other profile` : 'No profile · this is a Work folder'
    }
    if (!profile) return 'No profile · Work folders blocked'
    const mode = currentMode()
    return [LABEL[profile], inScratch() ? 'scratch' : '', mode ? MODES[mode].label : ''].filter(Boolean).join(' · ')
  }

  // Learning modes: this session's choice wins, then this folder's saved default,
  // then the profile's. A session with no profile gets none: the output style decides.
  let sessionMode: ModeId | null = null
  let folderDefault: ModeId | null = null
  const inScratch = () => profile !== null && roots[profile].some(root => isUnder(cwd, `${root}/scratch`))
  const currentMode = (): ModeId | null => {
    if (!profile) return null
    return sessionMode ?? folderDefault ?? (inScratch() || profile === 'work' ? 'do' : 'build')
  }
  const storeKey = () => `mode:${cwd}`

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const raw = ((await $.env.get('WSOS_PROFILE')) ?? '').trim().toLowerCase()
    profile = raw === 'personal' || raw === 'work' ? raw : null
    cwd = resolve(String((e as { cwd?: string }).cwd ?? (await $.session.root())), '', '')
    home = resolve((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? cwd, '', '')
    sessionMode = null
    // The profile above is the safety part; a missing store or command only costs the
    // mode, so neither may stop the start.
    try {
      const saved = await $.store.get(storeKey())
      folderDefault = typeof saved === 'string' ? modeFromName(saved) : null
    } catch {
      folderDefault = null
    }
    $.ui.status(statusText())
    try {
      await $.command.register({ name: 'mode', description: 'Learning mode: tutor, build, do or review', argumentHint: '[default] tutor|build|do|review' })
    } catch {
      // Without the command the profile's default mode still applies.
    }
    // The vault tools exist only in a session with a profile: each reads that profile's vault.
    if (profile) {
      try {
        const str = (description: string) => ({ type: 'string', description })
        await $.tool.register({
          name: 'vault_search',
          description: "Search this profile's notes vault. Every word must appear in a note's name or text. Returns matching note paths with a line of context, best first.",
          inputSchema: { type: 'object', properties: { query: str('Words to look for'), limit: { type: 'number', description: 'At most this many notes (default 10, up to 20)' } }, required: ['query'] },
          isDeferred: false,
        })
        await $.tool.register({
          name: 'vault_read',
          description: "Read one note from this profile's notes vault, by its path inside the vault (e.g. Projects/Idea.md).",
          inputSchema: { type: 'object', properties: { path: str('The note path inside the vault') }, required: ['path'] },
          isDeferred: false,
        })
        await $.tool.register({
          name: 'vault_list',
          description: "List the notes in this profile's notes vault, optionally only those in one folder of it.",
          inputSchema: { type: 'object', properties: { folder: str('A folder inside the vault (optional)') } },
          isDeferred: false,
        })
        await $.tool.register({
          name: 'vault_backlinks',
          description: "List the notes in this profile's notes vault that link to a note ([[Note]]).",
          inputSchema: { type: 'object', properties: { note: str('The note name or path') }, required: ['note'] },
          isDeferred: false,
        })
        await $.tool.register({
          name: 'vault_draft',
          description: "Save a new note into this profile's vault inbox (_inbox) for the user to review. Never overwrites: a clash gets a numbered name. For changing an existing note use vault_edit.",
          inputSchema: { type: 'object', properties: { title: str('The note title (becomes the file name)'), text: str('The note text, in markdown') }, required: ['title', 'text'] },
          isDeferred: false,
        })
        await $.tool.register({
          name: 'vault_edit',
          description: "Change an existing note in this profile's vault: replace old_text, which must appear exactly once, with new_text. Read the note with vault_read first and pass the version it shows. The user approves every edit.",
          inputSchema: {
            type: 'object',
            properties: { path: str('The note path inside the vault'), old_text: str('Exact text to replace (must appear once)'), new_text: str('The replacement text'), version: str('The version vault_read showed') },
            required: ['path', 'old_text', 'new_text', 'version'],
          },
          isDeferred: false,
        })
      } catch {
        // Without the tools the vault is simply unavailable this session.
      }
    }
    return result
  })

  // ---- The vault tools. Each answers for this session's profile only. ----

  on('tool.call', { tool: 'mcp__workspace-os__vault_search' }, async ($, e) => {
    const dir = vaultDir()
    const real = dir ? await vaultRealPath($, dir) : null
    if (!dir || !real) return { result: noVault(dir) }
    const query = String((e as unknown as { query?: unknown }).query ?? '').trim()
    if (!query) return { result: 'Give some words to search for.' }
    const limit = Math.min(Math.max(Number((e as unknown as { limit?: unknown }).limit) || 10, 1), 20)
    const hits: { rel: string; score: number; line: string }[] = []
    for (const rel of await walkNotes($, dir)) {
      const text = await readNote($, dir, real, rel)
      if (text === null) continue
      const s = score(rel, text, query)
      if (s > 0) hits.push({ rel, score: s, line: maskSecrets(excerpt(text, query)) })
    }
    if (hits.length === 0) return { result: `No notes match "${query}".` }
    hits.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel))
    return { result: hits.slice(0, limit).map(h => `- ${h.rel}${h.line ? `: ${h.line}` : ''}`).join('\n') }
  })

  on('tool.call', { tool: 'mcp__workspace-os__vault_read' }, async ($, e) => {
    const dir = vaultDir()
    const real = dir ? await vaultRealPath($, dir) : null
    if (!dir || !real) return { result: noVault(dir) }
    const rel = cleanRelative((e as unknown as { path?: unknown }).path)
    if (rel === null || rel === '' || isHidden(rel)) return { result: 'That path is not a note inside the vault.' }
    const withExt = /\.md$/i.test(rel) ? rel : `${rel}.md`
    // Missing, private and outside-the-vault all read the same, so a private note's
    // existence isn't given away.
    const text = await readNote($, dir, real, withExt)
    if (text === null) return { result: `No note at ${withExt}.` }
    const cut = text.length > MAX_NOTE_CHARS ? `${text.slice(0, MAX_NOTE_CHARS)}\n… (note cut at ${MAX_NOTE_CHARS} characters)` : text
    // The version is of the note as stored, so an edit can tell whether it changed since.
    return { result: `${maskSecrets(cut)}\n\n(version: ${versionOf(text)})` }
  })

  // Drafts go only into the inbox and never replace a note: nothing existing can be harmed,
  // so they don't ask. Changing an existing note is vault_edit's, which always asks.
  on('tool.call', { tool: 'mcp__workspace-os__vault_draft' }, async ($, e) => {
    const dir = vaultDir()
    const real = dir ? await vaultRealPath($, dir) : null
    if (!dir || !real) return { result: noVault(dir) }
    const input = e as unknown as { title?: unknown; text?: unknown }
    const name = draftName(input.title)
    if (!name) return { result: 'That title can\'t be a file name: avoid / \\ : * ? " < > | and titles made only of dots.' }
    const text = typeof input.text === 'string' ? input.text : ''
    if (!text.trim()) return { result: 'The draft has no text.' }
    if (hasSecret(text)) return { result: 'The draft contains what looks like a secret (a key, token or password). Remove it and try again.' }
    const inbox = `${dir}/_inbox`
    try {
      const st = await $.fs.stat(inbox, { resolve: true })
      // An inbox that is a link leading out of the vault isn't the vault's inbox.
      if (st.kind !== 'dir' || !st.realPath || !isUnder(norm(st.realPath), real)) return { result: 'The vault\'s _inbox isn\'t a folder inside the vault.' }
    } catch {
      // No inbox yet: writing the first draft creates it.
    }
    for (let n = 1; n <= 50; n++) {
      const file = n === 1 ? `${name}.md` : `${name} (${n}).md`
      let taken = true
      try {
        await $.fs.stat(`${inbox}/${file}`)
      } catch {
        taken = false
      }
      if (taken) continue
      await $.fs.write(`${inbox}/${file}`, text)
      return { result: `Draft saved to _inbox/${file}.` }
    }
    return { result: 'The inbox already has 50 drafts with that title.' }
  })

  on('tool.call', { tool: 'mcp__workspace-os__vault_edit' }, async ($, e) => {
    const dir = vaultDir()
    const real = dir ? await vaultRealPath($, dir) : null
    if (!dir || !real) return { result: noVault(dir) }
    const input = e as unknown as { path?: unknown; old_text?: unknown; new_text?: unknown; version?: unknown }
    const rel = cleanRelative(input.path)
    if (rel === null || rel === '' || isHidden(rel)) return { result: 'That path is not a note inside the vault.' }
    const withExt = /\.md$/i.test(rel) ? rel : `${rel}.md`
    const text = await readNote($, dir, real, withExt)
    if (text === null) return { result: `No note at ${withExt}.` }
    if (String(input.version ?? '') !== versionOf(text)) {
      return { result: `${withExt} changed since it was read (or no version was given). Read it again with vault_read, then edit.` }
    }
    const oldText = typeof input.old_text === 'string' ? input.old_text : ''
    const newText = typeof input.new_text === 'string' ? input.new_text : ''
    const found = countOf(text, oldText)
    if (found !== 1) return { result: found === 0 ? 'old_text isn\'t in the note exactly as given.' : `old_text appears ${found} times; give a longer piece that appears once.` }
    if (hasSecret(newText)) return { result: 'The new text contains what looks like a secret (a key, token or password). Remove it and try again.' }
    const updated = text.replace(oldText, () => newText)
    await $.fs.write(`${dir}/${withExt}`, updated)
    return { result: `Saved ${withExt} (version: ${versionOf(updated)}).` }
  })

  on('tool.call', { tool: 'mcp__workspace-os__vault_list' }, async ($, e) => {
    const dir = vaultDir()
    const real = dir ? await vaultRealPath($, dir) : null
    if (!dir || !real) return { result: noVault(dir) }
    const folder = cleanRelative((e as unknown as { folder?: unknown }).folder ?? '')
    if (folder === null || isHidden(folder)) return { result: 'That folder is not inside the vault.' }
    const shown: string[] = []
    for (const rel of await walkNotes($, dir)) {
      if (folder && !rel.toLowerCase().startsWith(`${folder.toLowerCase()}/`)) continue
      if ((await readNote($, dir, real, rel)) !== null) shown.push(rel)
    }
    return { result: shown.length ? shown.join('\n') : folder ? `No notes in ${folder}.` : 'The vault has no notes yet.' }
  })

  on('tool.call', { tool: 'mcp__workspace-os__vault_backlinks' }, async ($, e) => {
    const dir = vaultDir()
    const real = dir ? await vaultRealPath($, dir) : null
    if (!dir || !real) return { result: noVault(dir) }
    const target = cleanRelative((e as unknown as { note?: unknown }).note)
    if (!target) return { result: 'Name a note.' }
    const name = noteName(target)
    const linking: string[] = []
    for (const rel of await walkNotes($, dir)) {
      if (noteName(rel).toLowerCase() === name.toLowerCase()) continue
      const text = await readNote($, dir, real, rel)
      if (text !== null && linksTo(text, name)) linking.push(rel)
    }
    return { result: linking.length ? linking.join('\n') : `No notes link to ${name}.` }
  })

  on('command.run', { command: 'mode' }, async ($, e) => {
    // Desktop already names the plugin above a command's output, so replies carry no prefix.
    if (!profile) return { text: 'Modes need a profile. Start the session from the Personal or Work environment.' }
    const words = String(e.args ?? '').trim().split(/\s+/).filter(Boolean)
    const isDefault = words[0]?.toLowerCase() === 'default'
    const given = isDefault ? words.slice(1) : words
    if (given.length === 0) {
      return { text: `${statusText()}\n${MODE_HELP}` }
    }
    const { mode, rest } = modeAtStart(given)
    if (!mode) return { text: `"${given[0]}" isn't a mode. ${MODE_HELP}` }
    if (isDefault) {
      await $.store.set(storeKey(), mode)
      folderDefault = mode
      sessionMode = null
    } else {
      sessionMode = mode
    }
    $.ui.status(statusText())
    const applies = isDefault ? 'Now the default for this folder, from your next message.' : 'For this session, from your next message.'
    // A command can't pass text on to Claude, so words after the mode are handed back as a
    // reminder to send them as the next message.
    const task = rest.length > 200 ? `${rest.slice(0, 197)}...` : rest
    return { text: rest ? `${statusText()}\n${applies} Now send your task as a message: ${task}` : `${statusText()}\n${applies}` }
  })

  // The boundary: a hard no for the other profile's folders and vault.
  on('tool.call', ($, e, next) => {
    const paths = touched(e.tool, e as unknown as Record<string, unknown>, cwd)
    if (paths && paths.some(inBlocked)) {
      return { deny: profile ? outsideProfile(profile) : NO_PROFILE }
    }
    // The vault's own rules (private notes, masked secrets) hold only if every read goes
    // through the vault tools, so Claude's built-in tools can't open it directly.
    if (paths && paths.some(inOwnVault)) return { deny: VAULT_DIRECT }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: CHECK_FAILED }))

  // Memory: other plugins can't write the shared CLAUDE.md or anyone's Preferences.
  // Claude Code's own writes (`engine`, such as /memory) are yours and pass; Claude's
  // tools don't come through here at all, they go through the gate below.
  on('fs.write', async ($, e, next) => {
    if (next.origin.plugin === 'engine') return next(e)
    // A plugin can write before this session's start hook ran (a reload, a timer), so
    // the home folder is looked up here rather than left empty.
    if (!home) home = resolve((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '', '', '')
    if (isGlobalMemory(e.path)) {
      // The writing mod may not say its save failed, so say it here, once per refusal.
      void $.ui.toast(GLOBAL_TOAST)
      return { deny: GLOBAL_DENY }
    }
    if (inPrefs(e.path)) return { deny: PREFS_DENY }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: WRITE_CHECK_FAILED }))

  // The gate: these always ask you. A plugin's ask is answered by a person, never by
  // an auto-mode classifier or a saved always-allow rule. A deny below stays a deny.
  on('tool.check', async ($, e, next) => {
    const why =
      gateReason(e.tool, e.input) ??
      memoryReason(e.tool, e.input) ??
      (e.tool === 'mcp__workspace-os__vault_edit' ? 'changes to your notes always ask' : null)
    const verdict = await next(e)
    if (!why || verdict.decision === 'deny') return verdict
    return { decision: 'ask', reason: `workspace-os: ${why}.` }
  }).catch(() => ({ decision: 'deny', reason: 'workspace-os: its safety check failed, so the call was refused.' }))

  // One short section so Claude knows the rule before it tries a blocked folder. It
  // names no folder of the other profile.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const prefs = prefsShown()
    const taste = prefs
      ? ` The user's taste notes for this profile are in ${prefs}: before writing code or prose, read the matching file there (coding.md, writing.md, design.md, learning.md, general.md) if it exists. Only the feedback skill changes them.`
      : ''
    const mode = currentMode()
    const vault = vaultDir()
    const vaultLine = vault
      ? `This profile's notes vault is ${vault}: search and read it with the vault_search, vault_read, vault_list and vault_backlinks tools, save new notes to its inbox with vault_draft, and change a note with vault_edit (the user approves each edit); other tools can't open it. There is no tool to delete or move notes.`
      : ''
    const extra = [vaultLine, inScratch() ? SCRATCH_TEXT : '', mode ? MODES[mode].text : ''].filter(Boolean).map(t => ` ${t}`).join('')
    const text = profile
      ? `This session is in the ${LABEL[profile]} profile (Workspace OS). Folders that belong to the other profile are off limits; calls that touch them are refused. Deploys, pushes, migrations, .env writes, recursive deletes and discarding uncommitted work always ask the user first.${taste}${extra}`
      : 'This session has no Workspace OS profile, so Work folders are off limits; calls that touch them are refused. Deploys, pushes, migrations, .env writes, recursive deletes and discarding uncommitted work always ask the user first.'
    return { ...result, sections: [...result.sections, { id: 'workspace-os:profile', text, scope: 'session' }] }
  })
}
