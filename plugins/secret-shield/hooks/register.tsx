import { atom, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ShieldStatus } from '../types'

import { PLACEHOLDER, assignNames, envLine, findSecrets, parseEnv, redact } from './detect'

// Start a message with this to send it untouched.
const BYPASS = /^\s*allow-secrets:\s*/i

// Secrets live outside every project, so nothing the app loads or git sees
// picks them up: ~/.claude/secret-shield/<project>.env
async function vaultPath($: any): Promise<string> {
  const root: string = await $.session.root()
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? root
  const slug = root.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${home}/.claude/secret-shield/${slug}.env`
}

async function readVault($: any, path: string): Promise<Map<string, string>> {
  if (!(await $.fs.exists(path))) return new Map()
  return parseEnv(await $.fs.read(path))
}

// Published for other mods (the Control Center): counts and times only.
const status = atom({ plugin: 'secret-shield', key: 'status' } as const, {
  protectedCount: 0,
  lastScrubAt: null,
  lastScrubFiles: 0,
  lastScrubReplacements: 0,
} as ShieldStatus)

type LastScrub = { at: number; files: number; replacements: number }

// Counts the named secrets in every vault; never keeps or returns a value.
async function countProtected($: any): Promise<number> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  const dir = `${home}/.claude/secret-shield`
  if (!(await $.fs.exists(dir))) return 0
  let count = 0
  for (const entry of (await $.fs.list(dir)) as { name: string; kind: string }[]) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.env')) continue
    const text: string = await $.fs.read(`${dir}/${entry.name}`)
    count += (text.match(/^[A-Za-z_][A-Za-z0-9_]*=/gm) ?? []).length
  }
  return count
}

async function publish($: any, scrubbed?: ScrubSummary): Promise<void> {
  if (scrubbed && !scrubbed.dryRun) {
    const last: LastScrub = { at: await $.clock.now(), files: scrubbed.filesChanged, replacements: scrubbed.replacements }
    await $.store.set('lastScrub', last)
  }
  const last = ((await $.store.get('lastScrub')) as LastScrub | undefined) ?? null
  const next: ShieldStatus = {
    protectedCount: await countProtected($),
    lastScrubAt: last ? last.at : null,
    lastScrubFiles: last ? last.files : 0,
    lastScrubReplacements: last ? last.replacements : 0,
  }
  await update($, status, () => next)
}

type ScrubSummary = {
  dryRun: boolean
  knownSecrets: number
  newlyDetected: number
  replacements: number
  filesChanged: number
  skippedBusy: number
  files: string[]
}

// Runs hooks/scrub.mjs over finished transcripts, memory and remember logs.
async function scrub($: any, extra: string[] = []): Promise<ScrubSummary> {
  const script = `${$.plugin.root}/hooks/scrub.mjs`
  const id: string = await $.session.id()
  const run = await $.process.run(
    ['node', '--no-warnings', '--experimental-strip-types', script, '--exclude', id, ...extra],
    { timeoutMs: 300_000 },
  )
  if (run.exitCode !== 0) throw new Error(run.stderr.trim().split('\n').pop() || `scrubber exited ${run.exitCode}`)
  return JSON.parse(run.stdout.trim().split('\n').pop()!)
}

function describe(s: ScrubSummary): string {
  if (s.replacements === 0) return `secret-shield: no secrets found in old transcripts (${s.knownSecrets} known).`
  const verb = s.dryRun ? 'would replace' : 'replaced'
  const found = s.newlyDetected ? `, found ${s.newlyDetected} new` : ''
  return `secret-shield ${verb} ${s.replacements} secret copies in ${s.filesChanged} files${found}.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'scrub-secrets',
      description: 'Replace secrets in old Claude Code transcripts with placeholders (add "dry" to preview)',
    })
    void publish($).catch(() => {})
    // In the background: a slow scrub must not hold up the session.
    void scrub($)
      .then(async s => {
        await publish($, s)
        if (s.replacements > 0) $.ui.toast(describe(s))
      })
      .catch(() => {})
    return result
  })

  on('command.run', { command: 'scrub-secrets' }, async ($, e) => {
    const dry = /\bdry\b/i.test(e.args)
    try {
      const s = await scrub($, dry ? ['--dry-run'] : [])
      await publish($, s)
      const lines = [describe(s), ...s.files.map(f => `  ${f}`)]
      if (s.skippedBusy) lines.push(`Skipped ${s.skippedBusy} transcripts changed in the last 10 minutes (sessions still running).`)
      if (!dry && s.filesChanged) lines.push('Backups of changed files are in ~/.claude/secret-shield/backups/.')
      return { text: lines.join('\n') }
    } catch (err) {
      return { text: `secret-shield scrub failed: ${(err as Error).message}` }
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer') return next(e)

    if (BYPASS.test(e.text)) {
      return next({ ...e, text: e.text.replace(BYPASS, '') })
    }

    const found = findSecrets(e.text)
    if (found.length === 0) return next(e)

    const path = await vaultPath($)
    const existing = await readVault($, path)
    const named = assignNames(found, existing)

    const added = named.filter(n => n.isNew)
    if (added.length > 0) {
      const current = (await $.fs.exists(path)) ? await $.fs.read(path) : '# secret-shield vault: values hidden from Claude chats\n'
      const body = current.endsWith('\n') ? current : `${current}\n`
      await $.fs.write(path, body + added.map(n => envLine(n.name, n.value)).join('\n') + '\n')
      void publish($).catch(() => {})
    }

    const names = [...new Set(named.map(n => n.name))]
    $.ui.toast(`secret-shield hid ${names.length === 1 ? 'a secret' : `${names.length} secrets`}: ${names.join(', ')}`)

    const note =
      `secret-shield: the user's message contained secrets. Each was replaced with a {{secret:NAME}} placeholder before you saw it. ` +
      `The real values are saved in ${path} under those names (${names.join(', ')}). ` +
      `Refer to them by name and never ask the user to paste them again. ` +
      `If a value is needed in the project's .env, copy that line from the vault with a shell command that does not print it ` +
      `(for example: grep '^NAME=' "<vault>" >> .env), and only when the user asks for that.`

    return next({ ...e, text: redact(e.text, named), context: [...(e.context ?? []), note] })
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const text: string = e.props.text
    const names = [...new Set([...text.matchAll(PLACEHOLDER)].map(m => m[1]))]
    if (names.length === 0 || !e.props.isExpanded) return next(e)

    const vault = await readVault($, await vaultPath($))
    const { Box, Text } = $.ui.resolve(e)

    const parts: any[] = []
    let last = 0
    for (const m of text.matchAll(PLACEHOLDER)) {
      if (m.index! > last) parts.push(text.slice(last, m.index))
      parts.push(
        <Text key={`p${m.index}`} color="yellow">
          🔒{m[1]}
        </Text>,
      )
      last = m.index! + m[0].length
    }
    if (last < text.length) parts.push(text.slice(last))

    return (
      <Box flexDirection="column">
        <Text>{parts}</Text>
        {names.map(name => {
          const value = vault.get(name)
          return (
            <Box key={`secret-${name}`} flexDirection="row" gap={1}>
              <Text dimColor>🔒 {name}</Text>
              <Text dimColor>{value === undefined ? '(not in vault)' : '•••••••• hover to show'}</Text>
              {value !== undefined && (
                <Box display="none" hover={{ display: 'flex' }}>
                  <Text color="cyan">{value}</Text>
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
