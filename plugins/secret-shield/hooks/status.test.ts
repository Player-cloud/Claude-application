import { expect, test } from 'claude-code/testing'

const VAULT_DIR = 'C:/Users/Tester/.claude/secret-shield'
const VAULT = 'PASSWORD="Fake-Pass-123"\nDATABASE_URL="postgresql://u:fakepw@h/db"\n'
const SUMMARY = { dryRun: false, knownSecrets: 2, newlyDetected: 0, replacements: 5, filesChanged: 2, skippedBusy: 0, files: [] }

// Reads the published status the way the Control Center does: as another mod.
const READER = {
  name: 'status-reader',
  register: (on: any) => {
    on('command.run', { command: 'read-shield' }, async ($: any) => {
      const r = await $.state.get({ plugin: 'secret-shield', key: 'status' })
      return { text: JSON.stringify(r.value) }
    })
  },
}

test('publishes counts and the last scrub, never a value', { plugins: [READER] }, async ($, on) => {
  const store: Record<string, unknown> = {}
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: 'C:/Users/Tester/Downloads/app' }))
  on('session.id', () => ({ value: 'abc' }))
  on('env.get', () => ({ value: 'C:/Users/Tester' }) as never)
  on('clock.now', () => ({ value: 1791216000000 }))
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('fs.exists', (_$, e) => ({ value: e.path.replace(/\\/g, '/') === VAULT_DIR }))
  on('fs.list', () => ({ value: [{ name: 'C-Users-Tester-Downloads-app.env', kind: 'file' }, { name: 'backups', kind: 'dir' }] }) as never)
  on('fs.read', () => ({ value: VAULT }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(SUMMARY), stderr: '', isStdoutTruncated: false } }) as never)

  await $.session.start({ source: 'startup', cwd: 'C:/x', surface: null, isInteractive: true } as never)
  await $.command.run({ command: 'scrub-secrets', args: '' } as never)

  const text = ((await $.command.run({ command: 'read-shield', args: '' } as never)) as { text: string }).text
  expect(JSON.parse(text)).toEqual({ protectedCount: 2, lastScrubAt: 1791216000000, lastScrubFiles: 2, lastScrubReplacements: 5 })
  expect(text).not.toContain('Fake-Pass-123')
  expect(text).not.toContain('fakepw')
})
