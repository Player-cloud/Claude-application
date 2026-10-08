import type { Register } from 'claude-code'

// Picks up the handoff Cowork writes to <project>/.claude/handoff.md: says so
// when the session opens, and gives it to Claude with the first message.

const FILE = '.claude/handoff.md'

type Handoff = { path: string; text: string; title: string; status: string }

// Whether this load has yet to hand the file to Claude.
let isPending = false

async function load($: any): Promise<Handoff | null> {
  const root: string = await $.session.root()
  const path = `${root}/${FILE}`
  if (!(await $.fs.exists(path))) return null
  const text: string = await $.fs.read(path)
  const front = /^---\s*\n([\s\S]*?)\n---/.exec(text)?.[1] ?? ''
  const field = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, 'mi').exec(front)?.[1].trim()
  return { path, text, title: field('title') ?? 'Untitled handoff', status: (field('status') ?? 'open').toLowerCase() }
}

async function setStatus($: any, h: Handoff, status: string): Promise<void> {
  const text = /^status:.*$/m.test(h.text)
    ? h.text.replace(/^status:.*$/m, `status: ${status}`)
    : h.text.replace(/^---\s*\n/, `---\nstatus: ${status}\n`)
  await $.fs.write(h.path, text)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'handoff',
      description: 'Show the Cowork handoff for this project ("done" marks it finished, "reopen" opens it again)',
    })
    const h = await load($)
    isPending = h !== null && h.status !== 'done'
    if (h && isPending) $.ui.toast(`Handoff from Cowork: ${h.title}. Claude reads it with your first message.`)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isPending || e.origin.kind !== 'composer') return next(e)
    const h = await load($)
    isPending = false
    if (!h || h.status === 'done') return next(e)

    const note =
      `This project has a handoff from Cowork at ${h.path} (status: ${h.status}). It is the agreed brief for the work: ` +
      `the goal, scope, decisions, constraints and what "done" means. Plan from it before changing anything, ` +
      `raise its open questions, and ask before departing from its decisions. When the work it describes is complete, ` +
      `set its status to done. Its contents:\n\n${h.text}`
    if (h.status === 'open') await setStatus($, h, 'in progress')
    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    const h = await load($)
    if (!h) return { text: `No handoff here. In Cowork, agree the plan and run /handoff-to-code to write ${FILE} in this project.` }
    const arg = e.args.trim().toLowerCase()
    if (arg === 'done' || arg === 'reopen') {
      const status = arg === 'done' ? 'done' : 'open'
      await setStatus($, h, status)
      isPending = status === 'open'
      return { text: `Handoff "${h.title}" marked ${status}.` }
    }
    return { text: `Handoff "${h.title}" (${h.status}) at ${h.path}\n\n${h.text}` }
  })
}
