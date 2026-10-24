import type { Register } from 'claude-code'

import { MODE_HELP, MODES, SCRATCH_TEXT, modeFromName, type ModeId } from './modes'
import { isUnder, parseRoots, pathsInCommand, resolve } from './paths'
import { gateReason } from './rules'

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
  const inBlocked = (path: string) => blocked().some(root => isUnder(resolve(path, cwd, home), root))

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
    return result
  })

  on('command.run', { command: 'mode' }, async ($, e) => {
    if (!profile) return { text: 'workspace-os: modes need a profile. Start the session from the Personal or Work environment.' }
    const words = String(e.args ?? '').trim().split(/\s+/).filter(Boolean)
    const isDefault = words[0]?.toLowerCase() === 'default'
    const name = (isDefault ? words.slice(1) : words).join(' ')
    if (!name) {
      const mode = currentMode()
      return { text: `Mode: ${mode ? MODES[mode].label : 'none'}. ${MODE_HELP}` }
    }
    const mode = modeFromName(name)
    if (!mode) return { text: `workspace-os: "${name}" isn't a mode. ${MODE_HELP}` }
    if (isDefault) {
      await $.store.set(storeKey(), mode)
      folderDefault = mode
      sessionMode = null
    } else {
      sessionMode = mode
    }
    $.ui.status(statusText())
    return {
      text: isDefault
        ? `Mode: ${MODES[mode].label}, now the default for this folder (from your next message).`
        : `Mode: ${MODES[mode].label} for this session (from your next message).`,
    }
  })

  // The boundary: a hard no for the other profile's folders and vault.
  on('tool.call', ($, e, next) => {
    const paths = touched(e.tool, e as unknown as Record<string, unknown>, cwd)
    if (paths && paths.some(inBlocked)) {
      return { deny: profile ? outsideProfile(profile) : NO_PROFILE }
    }
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
    const why = gateReason(e.tool, e.input) ?? memoryReason(e.tool, e.input)
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
    const extra = [inScratch() ? SCRATCH_TEXT : '', mode ? MODES[mode].text : ''].filter(Boolean).map(t => ` ${t}`).join('')
    const text = profile
      ? `This session is in the ${LABEL[profile]} profile (Workspace OS). Folders that belong to the other profile are off limits; calls that touch them are refused. Deploys, pushes, migrations and .env writes always ask the user first.${taste}${extra}`
      : 'This session has no Workspace OS profile, so Work folders are off limits; calls that touch them are refused. Deploys, pushes, migrations and .env writes always ask the user first.'
    return { ...result, sections: [...result.sections, { id: 'workspace-os:profile', text, scope: 'session' }] }
  })
}
