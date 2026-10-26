import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Suggestion } from '../types'

// Suggests the right command at the right moment, one at a time, above the
// prompt with a Run button. Nothing runs without a click: these commands
// build, deploy or write documents.

const suggestion = atom({ plugin: 'nudges', key: 'suggestion' } as const, null as Suggestion | null)

const DAY_MS = 86_400_000

const COMMIT = /\bgit\s+(?:-C\s+\S+\s+)?commit\b/
const PUSH = /\bgit\s+(?:-C\s+\S+\s+)?push\b/
const SHIP_WORDS = /\b(deploy|ship it|ready to (?:ship|deploy|go live)|go live|push (?:it )?live|preview link)\b/i
const PLAN_DOC = /plan|roadmap|checkpoint|milestone/i

// Shown in the confirm step before a suggested command runs.
const RUN = 'Run it'
const WHAT_HAPPENS: Record<string, string> = {
  'ship-check': 'It runs the build, test and migration checks, then asks before deploying anything.',
  'next-part': 'It plans the next part for your approval before changing any code.',
}

const today = (ms: number) => new Date(ms).toISOString().slice(0, 10)

async function isSnoozed($: any, id: string): Promise<boolean> {
  const snoozed = ((await $.store.get('snoozed')) as Record<string, string> | undefined) ?? {}
  return snoozed[id] === today(await $.clock.now())
}

// True when this session has the command (as typed, or a plugin's `plugin:name`).
// If the list can't be read, assume it's there rather than go quiet.
async function hasCommand($: any, name: string): Promise<boolean> {
  try {
    const list: { name: string }[] = await $.command.list()
    return list.some(c => c.name === name || c.name.endsWith(`:${name}`))
  } catch {
    return true
  }
}

// Shows a suggestion unless it was put off today or its command isn't installed here;
// a newer one replaces an older one.
async function suggest($: any, next: Suggestion): Promise<void> {
  if (await isSnoozed($, next.id)) return
  if (!(await hasCommand($, next.command))) return
  await update($, suggestion, () => next)
}

async function clear($: any): Promise<void> {
  await update($, suggestion, () => null)
}

async function snooze($: any, id: string): Promise<void> {
  const now = await $.clock.now()
  const snoozed = ((await $.store.get('snoozed')) as Record<string, string> | undefined) ?? {}
  // Keep only today's entries, so the store doesn't grow forever.
  const kept = Object.fromEntries(Object.entries(snoozed).filter(([, day]) => day === today(now)))
  await $.store.set('snoozed', { ...kept, [id]: today(now) })
  await clear($)
}

async function git($: any, args: string[]): Promise<string | null> {
  const root: string = await $.session.root()
  const run = await $.process.run(['git', '-C', root, ...args], { timeoutMs: 15_000 })
  return run.exitCode === 0 ? run.stdout : null
}

// At the start of a session: uncommitted work left lying around, or a clean
// project with a plan to carry on with.
async function checkProject($: any): Promise<void> {
  const status = await git($, ['status', '--porcelain'])
  if (status === null) return // not a git project

  const changed = status.split('\n').map(l => l.slice(3).trim()).filter(Boolean)
  if (changed.length > 0) {
    const root: string = await $.session.root()
    const now: number = await $.clock.now()
    let oldest = now
    for (const file of changed.slice(0, 50)) {
      const stat = await $.fs.stat(`${root}/${file.replace(/^"|"$/g, '')}`).catch(() => null)
      if (stat && stat.mtimeMs < oldest) oldest = stat.mtimeMs
    }
    const days = Math.floor((now - oldest) / DAY_MS)
    if (days >= 1) {
      await suggest($, {
        id: 'commit-old-work',
        command: 'next-part',
        text: `${changed.length} files changed ${days === 1 ? 'yesterday' : `${days} days ago`} aren't committed yet. Finish and commit them?`,
      })
    }
    return
  }

  const root: string = await $.session.root()
  const docs = (await $.fs.exists(`${root}/docs`)) ? ((await $.fs.list(`${root}/docs`)) as { name: string }[]) : []
  const hasPlan = docs.some(d => PLAN_DOC.test(d.name)) || (await $.fs.exists(`${root}/.claude/handoff.md`))
  if (hasPlan) await suggest($, { id: 'next-part', command: 'next-part', text: 'Everything is committed. Carry on with the next part of the plan?' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'nudge', description: 'Show the current suggestion; "later" silences it until tomorrow' })
    void checkProject($)
    return result
  })

  // After a commit or a push, the next step is checking it's safe to ship.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      if (PUSH.test(e.command)) await suggest($, { id: 'ship-after-push', command: 'ship-check', text: 'You just pushed. Check it and deploy a preview?' })
      else if (COMMIT.test(e.command)) await suggest($, { id: 'ship-after-commit', command: 'ship-check', text: 'You just committed. Check it is safe to ship?' })
    }
    return ran
  })

  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    const ran = await next(e)
    const command = String((e as { command?: string }).command ?? '')
    if (ran.deny === undefined && (ran as { isError?: boolean }).isError !== true) {
      if (PUSH.test(command)) await suggest($, { id: 'ship-after-push', command: 'ship-check', text: 'You just pushed. Check it and deploy a preview?' })
      else if (COMMIT.test(command)) await suggest($, { id: 'ship-after-commit', command: 'ship-check', text: 'You just committed. Check it is safe to ship?' })
    }
    return ran
  })

  // Talking about deploying, without running the check yet.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer') {
      const current = await read($, suggestion)
      const slash = /^\s*\/([\w:-]+)/.exec(e.text)?.[1]
      if (slash && current && slash === current.command) await clear($)
      else if (!slash && SHIP_WORDS.test(e.text)) await suggest($, { id: 'ship-on-ask', command: 'ship-check', text: 'Sounds like a deploy. Run the ship check first?' })
    }
    return next(e)
  })

  on('command.run', { command: 'nudge' }, async ($, e) => {
    const s = await read($, suggestion)
    if (!s) return { text: 'No suggestion right now.' }
    const arg = e.args.trim().toLowerCase()
    if (arg === 'later') {
      await snooze($, s.id)
      return { text: `Okay, no more "${s.command}" suggestions of this kind today.` }
    }
    return { text: `Suggestion: ${s.text} (/${s.command})` }
  })

  // Running the suggested command, from anywhere, settles the suggestion.
  on('command.run', async ($, e, next) => {
    const current = await read($, suggestion)
    if (current && e.command === current.command) await clear($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const beneath = await next(e)
    const s = await read($, suggestion)
    if (!s || e.props.hasSurvey) return beneath

    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box key="nudge" flexDirection="row" gap={1}>
          <Text color="claude">✻</Text>
          <Text>{s.text}</Text>
          <Button
            key="nudge-run"
            label={`Run /${s.command}`}
            variant="primary"
            onPress={async () => {
              // These commands build, deploy or write documents: say what happens and ask first.
              // Closing the dialog rejects; that counts as "not yet".
              const answer = await $.ui.ask(`Run /${s.command} now? ${WHAT_HAPPENS[s.command] ?? ''}`.trim(), [RUN, 'Not yet']).catch(() => null)
              if (answer !== RUN) return
              // This plugin doesn't see its own command go by, so settle it here.
              await clear($)
              await $.command.run({ command: s.command, args: '' })
            }}
          />
          <Button key="nudge-later" label="Not now" plain onPress={() => snooze($, s.id)} />
        </Box>
        {beneath}
      </Box>
    )
  })
}
