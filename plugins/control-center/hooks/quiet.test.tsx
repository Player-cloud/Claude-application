import { expect, test } from 'claude-code/testing'

// Quiet by default: the Control Center opens when asked, not at every session start.

function engine(on: any, saved: Record<string, unknown> = {}) {
  const opened: string[] = []
  const store: Record<string, unknown> = { ...saved }
  on('session.root', () => ({ value: 'C:/Users/Tester/app' }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: 1791216000000 }))
  on('store.get', (_$: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_$: any, e: any) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('command.list', () => ({ value: [] }))
  on('ui.open', (_$: any, e: any) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('fs.exists', () => ({ value: false }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'not here', isStdoutTruncated: false } }) as never)
  return opened
}

// Session start leaves a refresh running unawaited; let it finish before the test ends.
const settle = () => new Promise(resolve => setTimeout(resolve, 50))

async function start($: any) {
  await $.session.start({ source: 'startup', cwd: 'C:/Users/Tester/app', surface: null, isInteractive: true } as never)
  await settle()
}

test('a session start opens no pane by default', async ($, on) => {
  const opened = engine(on)
  await start($)
  expect(opened).toEqual([])
})

test('/cc opens it when asked', async ($, on) => {
  const opened = engine(on)
  await start($)
  await $.command.run({ command: 'cc', args: '' } as never)
  await settle()
  expect(opened.length).toBe(1)
})

test('someone who turned "open at start" on still gets it at start', async ($, on) => {
  const opened = engine(on, { autoOpen: true })
  await start($)
  expect(opened.length).toBe(1)
})
