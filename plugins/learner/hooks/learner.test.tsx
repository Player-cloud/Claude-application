import { expect, test } from 'claude-code/testing'

const COLLECTED = {
  messages: [
    { project: 'basketball platform', date: '2026-09-02', text: 'export the PRD to a Word doc' },
    { project: 'tournament app scaffold', date: '2026-09-10', text: 'write a design document i can email to my employer' },
    { project: 'mr isreal parent app', date: '2026-09-30', text: 'make it an email to send to my boss' },
  ],
  memory: [{ project: 'basketball platform', file: 'notes.md', text: 'Gotcha: never run next build while next dev is running.' }],
}

const HOME = 'C:/Users/test'
const ROOT = 'C:/Users/test/Code/personal/app'
const OPTIONS = { personalRoots: 'C:/Users/test/Code/personal; D:/Notes', workRoots: 'C:/Users/test/Code/work' }

// One spelling for every path; off Windows the harness puts the plugin folder in front of C:/, which is dropped.
const n = (p: string) => p.replace(/\\/g, '/').replace(/^.*?(?=[A-Za-z]:\/)/, '')
// Paths are matched by their end, so the tests read the same on Windows and elsewhere.
const at = (files: Record<string, string>, end: string) => Object.entries(files).find(([p]) => p.endsWith(end))?.[1]
const underHomeClaude = (files: Record<string, string>) => Object.keys(files).filter(p => p.includes('/Users/test/.claude/'))

const SKILLS_REPLY = JSON.stringify({
  skills: [
    {
      name: 'boss-email',
      title: 'Email for my manager',
      why: 'Asked to turn work into an email for the manager 3 times',
      evidence: ['make it an email to send to my boss'],
      description: 'Use when the user wants an email to their manager about their work.',
      body: '1. Summarise the work.\n2. Write the email in plain English.',
    },
  ],
})
const LESSONS_REPLY = JSON.stringify({
  lessons: [{ title: 'One build at a time', text: 'Never run next build while next dev runs; it corrupts .next.', source: 'basketball platform', evidence: 'never run next build' }],
})

function engine(on: any, opts: { profile?: string; files?: Record<string, string>; collected?: unknown } = {}) {
  const files: Record<string, string> = { ...(opts.files ?? {}) }
  const store: Record<string, unknown> = {}
  const prompts: string[] = []
  const runs: string[][] = []
  const toasts: string[] = []

  on('process.run', (_$: any, e: any) => {
    runs.push(e.argv ?? e.command ?? e.args ?? [])
    return { value: { exitCode: 0, stdout: JSON.stringify(opts.collected ?? COLLECTED), stderr: '', isStdoutTruncated: false } } as never
  })
  on('command.list', () => ({ value: [{ name: 'next-part', description: 'Build the next part', source: 'user' }] }) as never)
  on('model.complete', (_$: any, e: any) => {
    prompts.push(e.prompt)
    const text = e.prompt.includes('PROJECT NOTES') ? LESSONS_REPLY : SKILLS_REPLY
    return { value: { isAnswered: true, text, usage: {} } } as never
  })
  on('store.get', (_$: any, e: any) => ({ value: store[e.key] }) as never)
  on('store.set', (_$: any, e: any) => {
    store[e.key] = e.value
    return { value: undefined } as never
  })
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'WSOS_PROFILE' ? opts.profile : HOME }) as never)
  on('session.root', () => ({ value: ROOT }) as never)
  on('clock.now', () => ({ value: Date.parse('2026-10-05T12:00:00Z') }) as never)
  on('fs.exists', (_$: any, e: any) => ({ value: n(e.path) in files }) as never)
  on('fs.read', (_$: any, e: any) => ({ value: files[n(e.path)] }) as never)
  on('fs.write', (_$: any, e: any) => {
    files[n(e.path)] = e.text
    return { value: undefined } as never
  })
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(String(e.text ?? e.message ?? ''))
    return { value: undefined } as never
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  return { files, store, prompts, runs, toasts }
}

const argvOf = (run: unknown): string[] => (Array.isArray(run) ? run.map(String) : [])

for (const surface of ['terminal', 'desktop'] as const) {
  test(`previews, then proposes, adds into the project and skips on ${surface}`, async ($, on) => {
    const w = engine(on)
    const ui = await $.ui.mount({ plugin: 'learner', surface, component: 'Pane', requestId: 'learner', props: {} as never })
    await ui.press({ key: 'rescan' })

    // The scan stops at a preview: nothing has gone to the model yet.
    expect(w.prompts).toEqual([])
    expect(await ui.find({ key: 'send' })).toBeDefined()
    expect(await ui.find({ text: /3 requests and 1 memory notes, from 3 projects/ } as never)).toBeDefined()

    await ui.press({ key: 'send' })
    expect(w.prompts[0]).toContain('make it an email to send to my boss')
    expect(await ui.find({ key: 'approve-skill:boss-email' })).toBeDefined()
    expect(await ui.find({ key: 'approve-lesson:one-build-at-a-time' })).toBeDefined()

    // Approving writes the skill into this project; skipping remembers the choice.
    await ui.press({ key: 'approve-skill:boss-email' })
    const skill = at(w.files, '/Code/personal/app/.claude/skills/boss-email/SKILL.md')
    expect(skill).toContain('name: boss-email')
    expect(skill).toContain('Summarise the work')

    await ui.press({ key: 'skip-lesson:one-build-at-a-time' })
    expect(w.store.skipped).toEqual(['lesson:one-build-at-a-time'])
    expect(at(w.files, '/app/CLAUDE.md')).toBeUndefined()
    expect(underHomeClaude(w.files)).toEqual([])
  })
}

test('Cancel sends nothing, and Send afterwards does nothing', async ($, on) => {
  const w = engine(on)
  const ui = await $.ui.mount({ plugin: 'learner', surface: 'desktop', component: 'Pane', requestId: 'learner', props: {} as never })
  await ui.press({ key: 'rescan' })
  await ui.press({ key: 'cancel' })
  expect(await ui.find({ text: /Nothing was sent/ } as never)).toBeDefined()
  expect(await ui.find({ key: 'send' })).toBeUndefined()
  expect(w.prompts).toEqual([])
})

test('a lesson goes into this project\'s CLAUDE.md under one heading, never the global one', async ($, on) => {
  const w = engine(on, { files: { [`${ROOT}/CLAUDE.md`]: '# My notes\n', [`${HOME}/.claude/CLAUDE.md`]: '# Global\n' } })
  const ui = await $.ui.mount({ plugin: 'learner', surface: 'desktop', component: 'Pane', requestId: 'learner', props: {} as never })
  await ui.press({ key: 'rescan' })
  await ui.press({ key: 'send' })
  // The project's own notes are what the model is told is already there.
  expect(w.prompts.find(p => p.includes('PROJECT NOTES'))).toContain('# My notes')
  await ui.press({ key: 'approve-lesson:one-build-at-a-time' })

  const md = at(w.files, '/Code/personal/app/CLAUDE.md')
  expect(md).toContain('# My notes')
  expect(md).toContain('## Lessons from past projects\n- **One build at a time**')
  expect(md).toContain('(learned on basketball platform)')
  expect(at(w.files, '/Users/test/.claude/CLAUDE.md')).toBe('# Global\n')
})

test('with no profile, the collector is given only this project', async ($, on) => {
  const w = engine(on)
  const ui = await $.ui.mount({ plugin: 'learner', surface: 'terminal', component: 'Pane', requestId: 'learner', props: {} as never })
  await ui.press({ key: 'rescan' })
  const argv = argvOf(w.runs[0])
  const roots = argv[argv.indexOf('--roots') + 1]
  expect(n(roots).endsWith('/Code/personal/app')).toBe(true)
  expect(roots.includes(';')).toBe(false)
  expect(await ui.find({ text: /this project only/ } as never)).toBeDefined()
})

test('a Personal session gives the collector the Personal folders, never the Work ones', { options: OPTIONS }, async ($, on) => {
  const w = engine(on, { profile: 'personal' })
  const ui = await $.ui.mount({ plugin: 'learner', surface: 'terminal', component: 'Pane', requestId: 'learner', props: {} as never })
  await ui.press({ key: 'rescan' })
  const argv = argvOf(w.runs[0])
  const roots = argv[argv.indexOf('--roots') + 1]
  expect(roots).toBe('C:/Users/test/Code/personal;D:/Notes')
  expect(roots).not.toContain('work')
})

test('no toast at session start', async ($, on) => {
  const w = engine(on)
  await $.session.start({ source: 'startup', cwd: ROOT, surface: null, isInteractive: true } as never)
  expect(w.toasts).toEqual([])
})
