import { expect, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-05T12:00:00Z')
const HEAD = 'fb63fbf764be482ec4ae35dc2bb987e02bcb6466'

const DEPLOYMENTS = [
  { id: 2, sha: HEAD, environment: 'Preview', created_at: '2026-10-05T11:00:00Z' },
  { id: 1, sha: 'f1e209bd68f0f93b740b522425e9485893fa7839', environment: 'Production', created_at: '2026-09-21T14:18:48Z' },
]
const STATUS: Record<number, object[]> = {
  2: [{ state: 'success', environment_url: 'https://preview.example.vercel.app', created_at: '2026-10-05T11:02:00Z' }],
  1: [{ state: 'success', environment_url: 'https://my-app.example.com', created_at: '2026-09-21T14:20:00Z' }],
}

function answer(argv: readonly string[]): string | null {
  if (argv[0] === 'git' && argv.includes('get-url')) return 'https://github.com/example-org/my-app.git'
  if (argv[0] === 'git' && argv.includes('rev-parse')) return HEAD
  if (argv[0] === 'curl') {
    const url = argv[argv.length - 1]
    const st = /deployments\/(\d+)\/statuses/.exec(url)
    if (st) return JSON.stringify(STATUS[Number(st[1])])
    if (/\/deployments\?/.test(url)) return JSON.stringify(DEPLOYMENTS)
  }
  return null
}

test('lists the latest production and preview deployments', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('session.root', () => ({ value: 'C:/Users/Lapto/Downloads/my-app' }))
  on('clock.now', () => ({ value: NOW }))
  on('process.run', (_$, e) => {
    const out = answer(e.argv)
    return { value: { exitCode: out === null ? 1 : 0, stdout: out ?? '', stderr: '', isStdoutTruncated: false } } as never
  })
  on('ui.status', (_$, e) => {
    statuses.push((e as { text?: string }).text)
    return { value: undefined } as never
  })

  const result = await $.command.run({ command: 'deploy-status', args: '' } as never)
  const text = (result as { text: string }).text

  expect(text).toContain('example-org/my-app')
  expect(text).toContain('prod')
  expect(text).toContain('f1e209b')
  expect(text).toContain('https://my-app.example.com')
  expect(text).toContain('deployed to preview')
  expect(statuses.at(-1)).toBe('▲ prod ✓ f1e209b 14d ago · preview ✓ fb63fbf 58m ago · this commit on preview')
})

test('stays quiet for a project with no GitHub remote', async ($, on) => {
  on('session.root', () => ({ value: 'C:/scratch' }))
  on('clock.now', () => ({ value: NOW }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'no remote', isStdoutTruncated: false } }) as never)
  on('ui.status', () => ({ value: undefined }) as never)

  const result = await $.command.run({ command: 'deploy-status', args: '' } as never)
  expect((result as { text: string }).text).toContain('no GitHub remote')
})
