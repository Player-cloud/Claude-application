import { atom, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { DeployInfo } from '../types'

// Shows the project's latest Vercel deployments in the status line, read from
// GitHub, where Vercel's Git integration records every deployment. Needs no
// Vercel login: a public GitHub repository is enough.

const EVERY_MS = 5 * 60_000
const AFTER_PUSH_MS = 90_000
const PUSHED = /\bgit\s+push\b|\bvercel\b/

type Deployment = { id: number; sha: string; environment: string; created_at: string }
type Status = { state: string; environment_url?: string; target_url?: string; created_at: string }
type Row = { env: string; sha: string; state: string; at: number; url?: string }

const info = atom({ plugin: 'deploy-status', key: 'info' } as const, { repo: null, rows: [], headDeployed: null, checkedAt: null } as DeployInfo)

const ICON: Record<string, string> = {
  success: '✓',
  failure: '✗',
  error: '✗',
  in_progress: '…',
  queued: '…',
  pending: '…',
  inactive: '–',
}

// What the last check found; a reload starts it over, the next check refills it.
let repo: string | null = null
let rows: Row[] = []
let headDeployed: string | null = null
let isRefreshing = false

async function sh($: any, argv: string[]): Promise<string | null> {
  const run = await $.process.run(argv, { timeoutMs: 20_000 })
  return run.exitCode === 0 ? run.stdout.trim() : null
}

async function github($: any, path: string): Promise<any> {
  const body = await sh($, ['curl', '-s', '-f', '-H', 'Accept: application/vnd.github+json', `https://api.github.com${path}`])
  return body ? JSON.parse(body) : null
}

function ago(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

async function refresh($: any): Promise<void> {
  if (isRefreshing) return
  isRefreshing = true
  try {
    const root: string = await $.session.root()
    const remote = await sh($, ['git', '-C', root, 'remote', 'get-url', 'origin'])
    const m = remote ? /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(remote) : null
    repo = m ? m[1] : null
    if (!repo) {
      rows = []
      $.ui.status(undefined)
      const none: DeployInfo = { repo: null, rows: [], headDeployed: null, checkedAt: await $.clock.now() }
      await update($, info, () => none)
      return
    }

    const list: Deployment[] | null = await github($, `/repos/${repo}/deployments?per_page=30`)
    if (!list || list.length === 0) {
      rows = []
      $.ui.status(undefined)
      const empty: DeployInfo = { repo, rows: [], headDeployed: null, checkedAt: await $.clock.now() }
      await update($, info, () => empty)
      return
    }

    const latest = new Map<string, Deployment>()
    for (const d of list) {
      const env = /prod/i.test(d.environment) ? 'prod' : 'preview'
      if (!latest.has(env)) latest.set(env, d)
    }
    const found: Row[] = []
    for (const env of ['prod', 'preview']) {
      const d = latest.get(env)
      if (!d) continue
      const statuses: Status[] | null = await github($, `/repos/${repo}/deployments/${d.id}/statuses?per_page=1`)
      const s = statuses?.[0]
      found.push({
        env,
        sha: d.sha.slice(0, 7),
        state: s?.state ?? 'pending',
        at: Date.parse(s?.created_at ?? d.created_at),
        url: s?.environment_url || s?.target_url,
      })
    }
    rows = found

    const head = await sh($, ['git', '-C', root, 'rev-parse', 'HEAD'])
    const hit = head ? list.find(d => d.sha === head) : undefined
    headDeployed = hit ? (/prod/i.test(hit.environment) ? 'prod' : 'preview') : null

    const now: number = await $.clock.now()
    const parts = rows.map(r => `${r.env} ${ICON[r.state] ?? r.state} ${r.sha} ${ago(now - r.at)}`)
    parts.push(headDeployed ? `this commit on ${headDeployed}` : 'this commit not deployed')
    $.ui.status(`▲ ${parts.join(' · ')}`)
    const published: DeployInfo = { repo, rows, headDeployed, checkedAt: now }
    await update($, info, () => published)
  } catch {
    // A failed check keeps the last status rather than showing a wrong one.
  } finally {
    isRefreshing = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'deploy-status', description: "Show this project's latest Vercel deployments and their links" })
    void refresh($)
    $.clock.every(EVERY_MS, () => void refresh($))
    return result
  })

  on('command.run', { command: 'deploy-status' }, async $ => {
    await refresh($)
    if (!repo) return { text: 'deploy-status: this project has no GitHub remote, so there are no deployments to show.' }
    if (rows.length === 0) return { text: `deploy-status: no Vercel deployments found for ${repo} (or the repository is private).` }
    const now = await $.clock.now()
    const lines = rows.map(r => `${r.env.padEnd(8)} ${r.state.padEnd(11)} ${r.sha}  ${ago(now - r.at).padEnd(8)} ${r.url ?? ''}`)
    lines.push(headDeployed ? `Your current commit is deployed to ${headDeployed}.` : 'Your current commit has not been deployed yet.')
    return { text: [`Deployments for ${repo}:`, ...lines].join('\n') }
  })

  // A push or deploy starts a new deployment: check again once Vercel has begun it.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (PUSHED.test(e.command)) $.clock.after(AFTER_PUSH_MS, () => void refresh($))
    return ran
  })

  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    const ran = await next(e)
    if (PUSHED.test(String((e as { command?: string }).command ?? ''))) $.clock.after(AFTER_PUSH_MS, () => void refresh($))
    return ran
  })
}
