import { expect, test } from 'claude-code/testing'

const ROOT = 'C:/Users/Lapto/Downloads/my-app'
const MONDAY_10AM = new Date(2026, 9, 5, 10, 0).getTime()
const FRIDAY_4PM = new Date(2026, 9, 9, 16, 0).getTime()

function engine(on: any, opts: { now: number; status?: string; mtimeMs?: number; docs?: string[]; confirm?: string }) {
  const store: Record<string, unknown> = {}
  const ran: string[] = []
  const asked: string[] = []
  // The confirm step: $.ui.ask goes through the AskUserQuestion tool; answer as the person would.
  on('tool.call', { tool: 'AskUserQuestion' }, (_$: any, e: any) => {
    const q = e.questions[0].question
    asked.push(q)
    return { result: { questions: e.questions, answers: { [q]: opts.confirm ?? 'Run it' } }, isError: false } as never
  })
  on('session.root', () => ({ value: ROOT }))
  on('clock.now', () => ({ value: opts.now }))
  on('clock.every', () => ({ value: undefined }) as never)
  on('store.get', (_$: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_$: any, e: any) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: opts.status === undefined ? 128 : 0, stdout: opts.status ?? '', stderr: '', isStdoutTruncated: false } }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: opts.mtimeMs ?? opts.now, isLink: false } }) as never)
  on('fs.exists', (_$: any, e: any) => ({ value: /docs$/.test(e.path.replace(/\\/g, '/')) && (opts.docs ?? []).length > 0 }))
  on('fs.list', () => ({ value: (opts.docs ?? []).map(name => ({ name, kind: 'file' })) }) as never)
  on('command.run', (_$: any, e: any) => {
    ran.push(e.command)
    return { text: '' }
  })
  // What draws beneath nudges in the band (token-weather, for instance).
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>weather</Text>
  })
  on('tool.call', () => ({ result: { stdout: 'done', stderr: '', interrupted: false }, isError: false }) as never)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as never)
  return { store, ran, asked }
}

const band = ($: any, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'nudges', surface, component: 'AbovePrompt', props: { hasSurvey: false } as never })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a push suggests the ship check, and Run asks first, then runs it, on ${surface}`, async ($, on) => {
    const { ran, asked } = engine(on, { now: MONDAY_10AM })
    await $.tool.call({ tool: 'Bash', command: 'git push origin main' } as never)

    const ui = await band($, surface)
    expect((await ui.find({ text: /You just pushed/ } as never)) !== undefined).toBe(true)
    expect(await ui.find({ text: /weather/ } as never)).toBeDefined()

    await ui.press({ key: 'nudge-run' })
    expect(asked[0]).toContain('Run /ship-check now?')
    expect(asked[0]).toContain('asks before deploying')
    expect(ran).toContain('ship-check')
    expect(await ui.find({ key: 'nudge-run' })).toBeUndefined()
  })
}

test('"Not yet" in the confirm step runs nothing and keeps the suggestion', async ($, on) => {
  const { ran, asked } = engine(on, { now: MONDAY_10AM, confirm: 'Not yet' })
  await $.tool.call({ tool: 'Bash', command: 'git push origin main' } as never)
  const ui = await band($, 'desktop')
  await ui.press({ key: 'nudge-run' })
  expect(asked).toHaveLength(1)
  expect(ran).not.toContain('ship-check')
  expect(await ui.find({ key: 'nudge-run' })).toBeDefined()
})

test('"Not now" silences that nudge for the rest of the day', async ($, on) => {
  engine(on, { now: MONDAY_10AM })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' } as never)
  const ui = await band($, 'desktop')
  await ui.press({ key: 'nudge-later' })
  expect(await ui.find({ key: 'nudge-run' })).toBeUndefined()

  await $.tool.call({ tool: 'Bash', command: 'git commit -m "y"' } as never)
  expect(await ui.find({ key: 'nudge-run' })).toBeUndefined()
})

test('old uncommitted work is pointed out when a session starts', async ($, on) => {
  engine(on, { now: MONDAY_10AM, status: ' M app/page.tsx\n?? lib/new.ts\n', mtimeMs: MONDAY_10AM - 4 * 86_400_000 })
  await $.session.start({ source: 'startup', cwd: ROOT, surface: null, isInteractive: true } as never)
  const ui = await band($, 'terminal')
  expect(await ui.find({ text: /2 files changed 4 days ago/ } as never)).toBeDefined()
})

test('a clean project with a plan suggests the next part', async ($, on) => {
  engine(on, { now: MONDAY_10AM, status: '', docs: ['BUILD-PLAN.md'] })
  await $.session.start({ source: 'startup', cwd: ROOT, surface: null, isInteractive: true } as never)
  const ui = await band($, 'terminal')
  expect(await ui.find({ text: /next part of the plan/ } as never)).toBeDefined()
})

test('Friday afternoon suggests the manager update', async ($, on) => {
  engine(on, { now: FRIDAY_4PM })
  await $.session.start({ source: 'startup', cwd: ROOT, surface: null, isInteractive: true } as never)
  const ui = await band($, 'terminal')
  expect(await ui.find({ text: /Friday afternoon/ } as never)).toBeDefined()
})

test('/nudge later silences the current suggestion; another kind still shows', async ($, on) => {
  engine(on, { now: MONDAY_10AM })
  await $.tool.call({ tool: 'Bash', command: 'git push' } as never)
  const ui = await band($, 'terminal')

  await $.command.run({ command: 'nudge', args: 'later' } as never)
  expect(await ui.find({ key: 'nudge-run' })).toBeUndefined()

  await $.tool.call({ tool: 'Bash', command: 'git commit -m "z"' } as never)
  expect(await ui.find({ text: /You just committed/ } as never)).toBeDefined()
})
