import type { Register } from 'claude-code'

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

  const statusText = () => {
    if (cwd && blocked().some(root => isUnder(cwd, root))) {
      return profile ? `${LABEL[profile]} · this folder belongs to the other profile` : 'No profile · this is a Work folder'
    }
    return profile ? LABEL[profile] : 'No profile · Work folders blocked'
  }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const raw = ((await $.env.get('WSOS_PROFILE')) ?? '').trim().toLowerCase()
    profile = raw === 'personal' || raw === 'work' ? raw : null
    cwd = resolve(String((e as { cwd?: string }).cwd ?? (await $.session.root())), '', '')
    home = resolve((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? cwd, '', '')
    $.ui.status(statusText())
    return result
  })

  // The boundary: a hard no for the other profile's folders and vault.
  on('tool.call', ($, e, next) => {
    const paths = touched(e.tool, e as unknown as Record<string, unknown>, cwd)
    if (paths && paths.some(inBlocked)) {
      return { deny: profile ? outsideProfile(profile) : NO_PROFILE }
    }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: CHECK_FAILED }))

  // The gate: these always ask you. A plugin's ask is answered by a person, never by
  // an auto-mode classifier or a saved always-allow rule. A deny below stays a deny.
  on('tool.check', async ($, e, next) => {
    const why = gateReason(e.tool, e.input)
    const verdict = await next(e)
    if (!why || verdict.decision === 'deny') return verdict
    return { decision: 'ask', reason: `workspace-os: ${why}.` }
  }).catch(() => ({ decision: 'deny', reason: 'workspace-os: its safety check failed, so the call was refused.' }))

  // One short section so Claude knows the rule before it tries a blocked folder. It
  // names no folder of the other profile.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const text = profile
      ? `This session is in the ${LABEL[profile]} profile (Workspace OS). Folders that belong to the other profile are off limits; calls that touch them are refused. Deploys, pushes, migrations and .env writes always ask the user first.`
      : 'This session has no Workspace OS profile, so Work folders are off limits; calls that touch them are refused. Deploys, pushes, migrations and .env writes always ask the user first.'
    return { ...result, sections: [...result.sections, { id: 'workspace-os:profile', text, scope: 'session' }] }
  })
}
