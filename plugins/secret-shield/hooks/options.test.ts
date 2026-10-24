import { expect, test } from 'claude-code/testing'

const ROOT = 'C:/Users/Tester/Downloads/app'
const SUMMARY = { dryRun: false, knownSecrets: 0, newlyDetected: 0, replacements: 0, filesChanged: 0, skippedBusy: 0, files: [] }
const SECRET_MESSAGE = 'connect with postgresql://admin:Fake-Pw-98765@db.example.com/app please'

// The engine beneath the plugin, with every process run recorded instead of started.
function engine(on: any, runs: string[][], fsExists: () => unknown = () => ({ value: false })) {
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'abc' }))
  on('env.get', () => ({ value: 'C:/Users/Tester' }) as never)
  on('clock.now', () => ({ value: 1791216000000 }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('fs.exists', fsExists)
  on('process.run', (_$: any, e: any) => {
    runs.push(e.argv ?? e.command ?? e.args ?? [])
    return { value: { exitCode: 0, stdout: JSON.stringify(SUMMARY), stderr: '', isStdoutTruncated: false } } as never
  })
}

// The scrub runs in the background after session.start resolves; give it a moment to be asked for.
const settle = () => new Promise(resolve => setTimeout(resolve, 100))

const start = ($: any) => $.session.start({ source: 'startup', cwd: ROOT, surface: null, isInteractive: true } as never)

test('by default a session start rewrites nothing', async ($, on) => {
  const runs: string[][] = []
  engine(on, runs)
  await start($)
  await settle()
  expect(runs.length).toBe(0)
})

test('with "Scrub old transcripts at every start" on, a start runs the scrubber without backups', { options: { autoScrub: true } }, async ($, on) => {
  const runs: string[][] = []
  engine(on, runs)
  await start($)
  await settle()
  expect(runs.length).toBe(1)
  expect(JSON.stringify(runs[0])).toContain('scrub.mjs')
  expect(JSON.stringify(runs[0])).not.toContain('--keep-backups')
})

test('backups are asked for only when "Keep unredacted backups" is on', { options: { keepBackups: true } }, async ($, on) => {
  const runs: string[][] = []
  engine(on, runs)
  await $.command.run({ command: 'scrub-secrets', args: '' } as never)
  expect(JSON.stringify(runs[0])).toContain('--keep-backups')
})

test('a typed secret still reaches Claude as a placeholder', async ($, on) => {
  const runs: string[][] = []
  engine(on, runs)
  on('fs.write', () => ({ value: undefined }))
  let arrived = ''
  on('prompt.submit', (_$: any, e: any) => {
    arrived = e.text
    return { text: e.text }
  })
  await $.prompt.submit({ text: SECRET_MESSAGE, origin: { kind: 'composer' } } as never)
  expect(arrived).toContain('{{secret:')
  expect(arrived).not.toContain('Fake-Pw-98765')
})

test('if the check fails, the message is held back, not sent unredacted', async ($, on) => {
  const runs: string[][] = []
  engine(on, runs, () => {
    throw new Error('disk unavailable')
  })
  let arrived: string | null = null
  on('prompt.submit', (_$: any, e: any) => {
    arrived = e.text
    return { text: e.text }
  })
  const result = (await $.prompt.submit({ text: SECRET_MESSAGE, origin: { kind: 'composer' } } as never)) as { drop?: string }
  expect(arrived).toBe(null)
  expect(result.drop).toContain('could not check this message')
})
