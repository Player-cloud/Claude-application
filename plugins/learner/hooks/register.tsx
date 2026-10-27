import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Proposal, Scan } from '../types'

// Finds the tasks the person keeps asking Claude for and proposes a skill for
// each, plus lessons from past projects' memory worth keeping in this one.
// It reads only sessions inside this profile's folders (or, without a profile,
// this project), shows what it would send before any model call, and writes
// only into this project, each write approved in the pane.

const PANE = 'learner'
const MODEL = 'haiku'
const LESSONS_HEADING = '## Lessons from past projects'

const scan = atom({ plugin: 'learner', key: 'scan' } as const, { phase: 'idle', message: '', proposals: [] } as Scan)

type Collected = {
  messages: { project: string; date: string; text: string }[]
  memory: { project: string; file: string; text: string }[]
}

type Options = { personalRoots?: string; workRoots?: string }

// What a scan collected, held until the person presses Send or Cancel.
let collected: Collected | null = null

const SKILLS_PROMPT = (requests: string, existing: string) => `Below are requests a developer typed to Claude over recent weeks, one per line as [project date] text, followed by the skills and commands they already have.

Find tasks they asked for repeatedly — at least 3 times, on at least 2 different days — that no existing skill already covers well, and propose a reusable skill for each. Propose one only when the task is also stable (done the same way each time, not still being worked out) and costly to get wrong or tedious to redo; exploratory work that keeps changing shape stays a habit, because a skill would freeze the wrong approach. Ignore one-off requests, approvals, and anything about sharing passwords. Never put a password, key, token or connection string in a draft. Prefer fewer, broader skills; at most 5.

Reply with JSON only, in this shape (an empty list when nothing qualifies):
{"skills":[{"name":"kebab-case-name","title":"Short title","why":"One sentence: what repeats and how often","evidence":["a short quote of a request", "..."],"description":"When to use the skill, phrased as triggers, one or two sentences","body":"The SKILL.md body in Markdown: the outcome, then the steps the skill follows, in the developer's context"}]}

REQUESTS
${requests}

EXISTING SKILLS AND COMMANDS
${existing}`

const LESSONS_PROMPT = (memory: string, shared: string) => `Below are notes a developer's assistant keeps for individual projects, then the notes already in the project they are working in now.

Find lessons worth keeping in the project they are working in now: tooling gotchas, deployment and database pitfalls, workflow rules. Skip facts about one project's features, anything already in this project's notes, and anything containing a password, key or token. At most 8.

Reply with JSON only, in this shape (an empty list when nothing qualifies):
{"lessons":[{"title":"Short title","text":"One or two sentences: the rule, and why","source":"the project it came from","evidence":"a short quote from the notes"}]}

PROJECT NOTES
${memory}

ALREADY IN THIS PROJECT
${shared || '(none yet)'}`

function parseJson(text: string): any {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'new-skill'

async function projectRoot($: any): Promise<string> {
  return String(await $.session.root()).replace(/\\/g, '/').replace(/\/+$/, '')
}

// The folders a scan may read: the session's profile folders (WSOS_PROFILE, as
// workspace-os uses it), else only this project.
async function scope($: any, options: Options): Promise<{ label: string; roots: string[] }> {
  const profile = ((await $.env.get('WSOS_PROFILE')) ?? '').trim().toLowerCase()
  const raw = profile === 'personal' ? options.personalRoots : profile === 'work' ? options.workRoots : ''
  const roots = String(raw ?? '').split(';').map(s => s.trim()).filter(Boolean)
  if (roots.length > 0) return { label: `the ${profile === 'work' ? 'Work' : 'Personal'} profile's folders`, roots }
  return { label: 'this project only', roots: [await projectRoot($)] }
}

const tokens = (chars: number) => Math.max(1, Math.round(chars / 4 / 100) * 100)

async function setScan($: any, next: Scan): Promise<void> {
  await update($, scan, () => next)
  await $.store.set('scan', next)
}

// Step one reads history on this machine and calls no model: it ends on a
// preview of what Send would pass to the model.
async function runScan($: any, options: Options): Promise<void> {
  collected = null
  const where = await scope($, options)
  await setScan($, { phase: 'scanning', message: `Reading your history (${where.label})…`, proposals: [] })
  try {
    const run = await $.process.run(['node', `${$.plugin.root}/hooks/collect.mjs`, '--roots', where.roots.join(';')], { timeoutMs: 120_000 })
    if (run.exitCode !== 0) throw new Error(run.stderr.trim().split('\n').pop() || 'the collector failed')
    const data: Collected = JSON.parse(run.stdout)
    if (data.messages.length === 0 && data.memory.length === 0) {
      await setScan($, { phase: 'done', message: `Nothing to look at in ${where.label}. Nothing was sent.`, proposals: [] })
      return
    }
    collected = data
    const projects = [...new Set([...data.messages.map(m => m.project), ...data.memory.map(m => m.project)])]
    const chars = data.messages.reduce((n, m) => n + m.text.length + 30, 0) + data.memory.reduce((n, m) => n + m.text.length, 0)
    await setScan($, {
      phase: 'preview',
      message: 'Nothing has been sent yet. Send passes this to the model (Haiku, on your plan):',
      proposals: [],
      preview: { scope: where.label, requests: data.messages.length, notes: data.memory.length, projects, tokens: tokens(chars) },
    })
  } catch (err) {
    await setScan($, { phase: 'error', message: `The scan failed: ${(err as Error).message}`, proposals: [] })
  }
}

async function cancel($: any): Promise<void> {
  collected = null
  await setScan($, { phase: 'idle', message: 'Cancelled. Nothing was sent.', proposals: [] })
}

// Step two, only after Send: the model calls and the proposals.
async function send($: any): Promise<void> {
  const data = collected
  if (!data || (await read($, scan)).phase !== 'preview') return
  collected = null
  await setScan($, { phase: 'scanning', message: 'Sending…', proposals: [] })
  try {
    const skipped = new Set(((await $.store.get('skipped')) as string[] | undefined) ?? [])
    const commands: { name: string; description: string }[] = await $.command.list()
    const existing = commands.map(c => `/${c.name} — ${c.description.slice(0, 120)}`).join('\n')
    const requests = data.messages.map(m => `[${m.project} ${m.date}] ${m.text}`).join('\n')

    await setScan($, { phase: 'scanning', message: `Looking for repeated tasks in ${data.messages.length} requests…`, proposals: [] })
    const proposals: Proposal[] = []

    const skillsReply = await $.model.complete({ model: MODEL, prompt: SKILLS_PROMPT(requests, existing), maxTokens: 8000 })
    const skills = skillsReply.isAnswered ? parseJson(skillsReply.text)?.skills ?? [] : []
    const names = new Set(commands.map(c => c.name))
    for (const s of skills) {
      const name = slug(String(s.name ?? s.title ?? ''))
      if (skipped.has(`skill:${name}`)) continue
      proposals.push({
        id: `skill:${name}`,
        kind: 'skill',
        title: String(s.title ?? name),
        why: String(s.why ?? ''),
        evidence: (Array.isArray(s.evidence) ? s.evidence : []).slice(0, 3).map(String),
        name,
        description: String(s.description ?? ''),
        body: String(s.body ?? ''),
        status: names.has(name) ? 'exists' : 'new',
      })
    }

    if (data.memory.length > 0) {
      await setScan($, { phase: 'scanning', message: 'Looking for lessons worth keeping in this project…', proposals })
      const notes = data.memory.map(m => `### ${m.project} (${m.file})\n${m.text}`).join('\n\n')
      const here = `${await projectRoot($)}/CLAUDE.md`
      const shared = (await $.fs.exists(here)) ? String(await $.fs.read(here)) : ''
      const lessonsReply = await $.model.complete({ model: MODEL, prompt: LESSONS_PROMPT(notes, shared), maxTokens: 4000 })
      const lessons = lessonsReply.isAnswered ? parseJson(lessonsReply.text)?.lessons ?? [] : []
      for (const l of lessons) {
        const id = `lesson:${slug(String(l.title ?? ''))}`
        if (skipped.has(id)) continue
        proposals.push({
          id,
          kind: 'lesson',
          title: String(l.title ?? 'Lesson'),
          why: '',
          evidence: l.evidence ? [String(l.evidence)] : [],
          text: String(l.text ?? ''),
          source: String(l.source ?? ''),
          status: 'new',
        })
      }
    }

    await $.store.set('lastRun', await $.clock.now())
    const found = proposals.filter(p => p.status === 'new').length
    await setScan($, {
      phase: 'done',
      message: found === 0 ? 'Nothing new to propose. Your skills already cover what you repeat.' : `${found} proposals. Approve the ones you want.`,
      proposals,
    })
  } catch (err) {
    await setScan($, { phase: 'error', message: `The scan failed: ${(err as Error).message}`, proposals: [] })
  }
}

async function approve($: any, id: string): Promise<void> {
  const current = await read($, scan)
  const p = current.proposals.find(x => x.id === id)
  if (!p || p.status !== 'new') return
  // Only ever this project: never ~/.claude, which every project and both profiles read.
  const root = await projectRoot($)

  if (p.kind === 'skill') {
    const path = `${root}/.claude/skills/${p.name}/SKILL.md`
    if (await $.fs.exists(path)) {
      await mark($, id, 'exists')
      return
    }
    const front = `---\nname: ${p.name}\ndescription: ${JSON.stringify(p.description)}\n---\n\n`
    await $.fs.write(path, `${front}# ${p.title}\n\n${p.body}\n`)
  } else {
    const path = `${root}/CLAUDE.md`
    const current = (await $.fs.exists(path)) ? ((await $.fs.read(path)) as string) : ''
    const line = `- **${p.title}**: ${p.text}${p.source ? ` (learned on ${p.source})` : ''}`
    const body = current.includes(LESSONS_HEADING)
      ? current.replace(LESSONS_HEADING, `${LESSONS_HEADING}\n${line}`)
      : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${LESSONS_HEADING}\n${line}\n`
    await $.fs.write(path, body)
  }
  await mark($, id, 'added')
}

async function skip($: any, id: string): Promise<void> {
  const skipped = ((await $.store.get('skipped')) as string[] | undefined) ?? []
  await $.store.set('skipped', [...new Set([...skipped, id])])
  await mark($, id, 'skipped')
}

async function mark($: any, id: string, status: Proposal['status']): Promise<void> {
  const current = await read($, scan)
  await setScan($, { ...current, proposals: current.proposals.map(x => (x.id === id ? { ...x, status } : x)) })
}

export const register: Register = (on, options: Options = {}) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'skill-ideas', description: 'Open the Learner pane with the last proposals, without a new scan' })
    await $.command.register({
      name: 'learn-skills',
      description: "Find tasks you keep repeating in this profile and propose project skills for them; shows what it would send before using any usage",
    })
    // A preview's collected history isn't kept between sessions, so neither is the preview.
    const saved = (await $.store.get('scan')) as Scan | undefined
    if (saved && saved.phase !== 'scanning' && saved.phase !== 'preview') await update($, scan, () => saved)
    return result
  })

  on('command.run', { command: 'skill-ideas' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Learner' })
    return { text: 'Learner opened with the proposals from the last scan.' }
  })

  on('command.run', { command: 'learn-skills' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Learner' })
    void runScan($, options)
    return { text: 'Reading your history; the Learner pane shows what it would send before anything is sent.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = await read($, scan)
    const skills = s.proposals.filter(p => p.kind === 'skill')
    const lessons = s.proposals.filter(p => p.kind === 'lesson')

    const card = (p: Proposal) => (
      <Box key={`card-${p.id}`} flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>
          {p.kind === 'skill' ? `/${p.name}` : p.title}
          {p.kind === 'skill' ? <Text dimColor> · {p.title}</Text> : null}
        </Text>
        {p.kind === 'skill' ? <Text>{p.why}</Text> : <Text>{p.text}</Text>}
        {p.kind === 'lesson' && p.source ? <Text dimColor>from {p.source}</Text> : null}
        {p.evidence.map((q, i) => (
          <Text key={`ev-${p.id}-${i}`} dimColor>
            “{q.slice(0, 110)}”
          </Text>
        ))}
        {p.status === 'new' ? (
          <Box flexDirection="row" gap={1}>
            <Button key={`approve-${p.id}`} label={p.kind === 'skill' ? 'Add to this project' : "Add to this project's CLAUDE.md"} variant="primary" onPress={() => approve($, p.id)} />
            <Button key={`skip-${p.id}`} label="Skip" onPress={() => skip($, p.id)} />
          </Box>
        ) : (
          <Text color={p.status === 'added' ? 'green' : undefined} dimColor={p.status !== 'added'}>
            {p.status === 'added' ? '✓ Added to this project' : p.status === 'skipped' ? 'Skipped' : 'A skill with this name already exists'}
          </Text>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Text color={s.phase === 'error' ? 'red' : undefined}>
          {s.phase === 'idle' && !s.message ? 'Run /learn-skills to look for tasks you repeat.' : s.message}
        </Text>
        {s.phase === 'preview' && s.preview ? (
          <Box key="preview" flexDirection="column" borderStyle="round" paddingX={1}>
            <Text>Read from: {s.preview.scope}</Text>
            <Text>
              {s.preview.requests} requests and {s.preview.notes} memory notes, from {s.preview.projects.length} projects
            </Text>
            <Text dimColor>{clip(s.preview.projects.join(', '), 200)}</Text>
            <Text>About {s.preview.tokens.toLocaleString('en-GB')} tokens</Text>
            <Box flexDirection="row" gap={1}>
              <Button key="send" label="Send" variant="primary" onPress={() => send($)} />
              <Button key="cancel" label="Cancel" onPress={() => cancel($)} />
            </Box>
          </Box>
        ) : null}
        {skills.length > 0 && <Text bold>Skills for tasks you repeat</Text>}
        {skills.map(card)}
        {lessons.length > 0 && <Text bold>Lessons worth keeping in this project</Text>}
        {lessons.map(card)}
        {lessons.length > 0 && <Text dimColor>For a preference that should apply to the whole profile, use the feedback skill instead.</Text>}
        {s.phase !== 'scanning' && s.phase !== 'preview' && (
          <Button key="rescan" label={s.phase === 'idle' ? 'Scan now' : 'Scan again'} onPress={() => runScan($, options)} />
        )}
      </Box>
    )
  })
}
