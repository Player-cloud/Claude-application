import { expect, test } from 'claude-code/testing'

const COLLECTED = {
  messages: [
    { project: 'basketball platform', date: '2026-09-02', text: 'export the PRD to a Word doc' },
    { project: 'tournament app scaffold', date: '2026-09-10', text: 'write a design document i can email to my employer' },
    { project: 'mr isreal parent app', date: '2026-09-30', text: 'make it an email to send to my boss' },
  ],
  memory: [{ project: 'basketball platform', file: 'notes.md', text: 'Gotcha: never run next build while next dev is running.' }],
  sharedLessons: '',
}

const n = (p: string) => p.replace(/\\/g, '/')

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

for (const surface of ['terminal', 'desktop'] as const) {
  test(`proposes, adds and skips on ${surface}`, async ($, on) => {
    const files: Record<string, string> = {}
    const store: Record<string, unknown> = {}
    const prompts: string[] = []

    on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(COLLECTED), stderr: '', isStdoutTruncated: false } }) as never)
    on('command.list', () => ({ value: [{ name: 'next-part', description: 'Build the next part', source: 'user' }] }) as never)
    on('model.complete', (_$, e) => {
      prompts.push(e.prompt)
      const text = e.prompt.includes('PROJECT NOTES') ? LESSONS_REPLY : SKILLS_REPLY
      return { value: { isAnswered: true, text, usage: {} } } as never
    })
    on('store.get', (_$, e) => ({ value: store[e.key] }) as never)
    on('store.set', (_$, e) => {
      store[e.key] = e.value
      return { value: undefined } as never
    })
    on('env.get', () => ({ value: 'C:\\Users\\Lapto' }) as never)
    on('clock.now', () => ({ value: Date.parse('2026-10-05T12:00:00Z') }) as never)
    on('fs.exists', (_$, e) => ({ value: n(e.path) in files }) as never)
    on('fs.read', (_$, e) => ({ value: files[n(e.path)] }) as never)
    on('fs.write', (_$, e) => {
      files[e.path.replace(/\\/g, '/')] = e.text
      return { value: undefined } as never
    })
    on('ui.toast', () => ({ value: undefined }) as never)

    const ui = await $.ui.mount({ plugin: 'learner', surface, component: 'Pane', requestId: 'learner', props: {} as never })
    await ui.press({ key: 'rescan' })

    // The request history reached the model; both proposals are shown.
    expect(prompts[0]).toContain('make it an email to send to my boss')
    expect(await ui.find({ key: 'approve-skill:boss-email' })).toBeDefined()
    expect(await ui.find({ key: 'approve-lesson:one-build-at-a-time' })).toBeDefined()

    // Approving writes the skill; skipping remembers the choice.
    await ui.press({ key: 'approve-skill:boss-email' })
    const skill = files['C:/Users/Lapto/.claude/skills/boss-email/SKILL.md']
    expect(skill).toContain('name: boss-email')
    expect(skill).toContain('Summarise the work')

    await ui.press({ key: 'skip-lesson:one-build-at-a-time' })
    expect(store.skipped).toEqual(['lesson:one-build-at-a-time'])
    expect(files['C:/Users/Lapto/.claude/CLAUDE.md']).toBeUndefined()
  })
}

test('sharing a lesson adds it under one heading in CLAUDE.md', async ($, on) => {
  const files: Record<string, string> = { 'C:/Users/Lapto/.claude/CLAUDE.md': '# My notes\n' }
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(COLLECTED), stderr: '', isStdoutTruncated: false } }) as never)
  on('command.list', () => ({ value: [] }) as never)
  on('model.complete', (_$, e) =>
    ({ value: { isAnswered: true, text: e.prompt.includes('PROJECT NOTES') ? LESSONS_REPLY : '{"skills":[]}', usage: {} } }) as never,
  )
  on('store.get', () => ({ value: undefined }) as never)
  on('store.set', () => ({ value: undefined }) as never)
  on('env.get', () => ({ value: 'C:/Users/Lapto' }) as never)
  on('clock.now', () => ({ value: 0 }) as never)
  on('fs.exists', (_$, e) => ({ value: n(e.path) in files }) as never)
  on('fs.read', (_$, e) => ({ value: files[n(e.path)] }) as never)
  on('fs.write', (_$, e) => {
    files[n(e.path)] = e.text
    return { value: undefined } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)

  const ui = await $.ui.mount({ plugin: 'learner', surface: 'desktop', component: 'Pane', requestId: 'learner', props: {} as never })
  await ui.press({ key: 'rescan' })
  await ui.press({ key: 'approve-lesson:one-build-at-a-time' })

  const md = files['C:/Users/Lapto/.claude/CLAUDE.md']
  expect(md).toContain('# My notes')
  expect(md).toContain('## Lessons from past projects\n- **One build at a time**')
  expect(md).toContain('(learned on basketball platform)')
})
