import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Proposal, Scan } from '../types'

// Finds the tasks the person keeps asking Claude for and proposes a skill for
// each, plus lessons from one project's memory worth sharing with every
// project. Nothing is written without the person approving it in the pane.

const PANE = 'learner'
const MODEL = 'haiku'
const WEEK_MS = 7 * 86_400_000
const LESSONS_HEADING = '## Lessons from past projects'

const scan = atom({ plugin: 'learner', key: 'scan' } as const, { phase: 'idle', message: '', proposals: [] } as Scan)

type Collected = {
  messages: { project: string; date: string; text: string }[]
  memory: { project: string; file: string; text: string }[]
  sharedLessons: string
}

const SKILLS_PROMPT = (requests: string, existing: string) => `Below are requests a developer typed to Claude over recent weeks, one per line as [project date] text, followed by the skills and commands they already have.

Find tasks they asked for repeatedly — at least 3 times, on at least 2 different days — that no existing skill already covers well, and propose a reusable skill for each. Ignore one-off requests, approvals, and anything about sharing passwords. Never put a password, key, token or connection string in a draft. Prefer fewer, broader skills; at most 5.

Reply with JSON only, in this shape (an empty list when nothing qualifies):
{"skills":[{"name":"kebab-case-name","title":"Short title","why":"One sentence: what repeats and how often","evidence":["a short quote of a request", "..."],"description":"When to use the skill, phrased as triggers, one or two sentences","body":"The SKILL.md body in Markdown: the outcome, then the steps the skill follows, in the developer's context"}]}

REQUESTS
${requests}

EXISTING SKILLS AND COMMANDS
${existing}`

const LESSONS_PROMPT = (memory: string, shared: string) => `Below are notes a developer's assistant keeps for individual projects, then the lessons already shared across all projects.

Find lessons that would help in OTHER projects too: tooling gotchas, deployment and database pitfalls, workflow rules. Skip facts about one project's features, anything already in the shared lessons, and anything containing a password, key or token. At most 8.

Reply with JSON only, in this shape (an empty list when nothing qualifies):
{"lessons":[{"title":"Short title","text":"One or two sentences: the rule, and why","source":"the project it came from","evidence":"a short quote from the notes"}]}

PROJECT NOTES
${memory}

ALREADY SHARED
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

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'new-skill'

async function home($: any): Promise<string> {
  return ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
}

async function setScan($: any, next: Scan): Promise<void> {
  await update($, scan, () => next)
  await $.store.set('scan', next)
}

async function runScan($: any): Promise<void> {
  await setScan($, { phase: 'scanning', message: 'Reading your history…', proposals: [] })
  try {
    const run = await $.process.run(['node', `${$.plugin.root}/hooks/collect.mjs`], { timeoutMs: 120_000 })
    if (run.exitCode !== 0) throw new Error(run.stderr.trim().split('\n').pop() || 'the collector failed')
    const data: Collected = JSON.parse(run.stdout)

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
      await setScan($, { phase: 'scanning', message: 'Looking for lessons worth sharing across projects…', proposals })
      const notes = data.memory.map(m => `### ${m.project} (${m.file})\n${m.text}`).join('\n\n')
      const lessonsReply = await $.model.complete({ model: MODEL, prompt: LESSONS_PROMPT(notes, data.sharedLessons), maxTokens: 4000 })
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
  const base = `${await home($)}/.claude`

  if (p.kind === 'skill') {
    const path = `${base}/skills/${p.name}/SKILL.md`
    if (await $.fs.exists(path)) {
      await mark($, id, 'exists')
      return
    }
    const front = `---\nname: ${p.name}\ndescription: ${JSON.stringify(p.description)}\n---\n\n`
    await $.fs.write(path, `${front}# ${p.title}\n\n${p.body}\n`)
    $.ui.toast(`Added the /${p.name} skill. It appears in new sessions.`)
  } else {
    const path = `${base}/CLAUDE.md`
    const current = (await $.fs.exists(path)) ? ((await $.fs.read(path)) as string) : ''
    const line = `- **${p.title}**: ${p.text}${p.source ? ` (learned on ${p.source})` : ''}`
    const body = current.includes(LESSONS_HEADING)
      ? current.replace(LESSONS_HEADING, `${LESSONS_HEADING}\n${line}`)
      : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${LESSONS_HEADING}\n${line}\n`
    await $.fs.write(path, body)
    $.ui.toast('Added the lesson to ~/.claude/CLAUDE.md, which every project reads.')
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'skill-ideas', description: 'Open the Learner pane with the last proposals, without a new scan' })
    await $.command.register({
      name: 'learn-skills',
      description: 'Find tasks you keep repeating and lessons worth sharing, and propose skills for them (uses a little usage)',
    })
    const saved = (await $.store.get('scan')) as Scan | undefined
    if (saved && saved.phase !== 'scanning') await update($, scan, () => saved)

    const lastRun = Number((await $.store.get('lastRun')) ?? 0)
    if ((await $.clock.now()) - lastRun > WEEK_MS) {
      $.ui.toast(lastRun ? 'A week since the last check: /learn-skills can look for new repeated tasks.' : 'New: /learn-skills finds tasks you repeat and proposes skills for them.')
    }
    return result
  })

  on('command.run', { command: 'skill-ideas' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Learner' })
    return { text: 'Learner opened with the proposals from the last scan.' }
  })

  on('command.run', { command: 'learn-skills' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Learner' })
    void runScan($)
    return { text: 'Scanning your history; proposals will appear in the Learner pane.' }
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
            <Button key={`approve-${p.id}`} label={p.kind === 'skill' ? 'Add skill' : 'Share lesson'} variant="primary" onPress={() => approve($, p.id)} />
            <Button key={`skip-${p.id}`} label="Skip" onPress={() => skip($, p.id)} />
          </Box>
        ) : (
          <Text color={p.status === 'added' ? 'green' : undefined} dimColor={p.status !== 'added'}>
            {p.status === 'added' ? '✓ Added' : p.status === 'skipped' ? 'Skipped' : 'A skill with this name already exists'}
          </Text>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Text color={s.phase === 'error' ? 'red' : undefined}>
          {s.phase === 'idle' ? 'Run /learn-skills to look for tasks you repeat.' : s.message}
        </Text>
        {skills.length > 0 && <Text bold>Skills for tasks you repeat</Text>}
        {skills.map(card)}
        {lessons.length > 0 && <Text bold>Lessons worth sharing with every project</Text>}
        {lessons.map(card)}
        {s.phase !== 'scanning' && (
          <Button key="rescan" label={s.phase === 'idle' ? 'Scan now' : 'Scan again'} onPress={() => runScan($)} />
        )}
      </Box>
    )
  })
}
