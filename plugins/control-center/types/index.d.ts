export type Page = 'home' | 'actions' | 'skills' | 'plugins' | 'workflows' | 'system' | 'installed' | 'favourites' | 'settings' | 'weather'

export type ExecSpec =
  | { via: 'command'; command: string; args?: string }
  | { via: 'fill'; text: string }
  | { via: 'prompt'; text: string }

/** The run in progress: from the preview to its result. */
export type Flow = {
  kind: 'capability' | 'workflow' | 'fix'
  /** Capability or workflow id; for a fix, a label. */
  id: string
  /** What a fix runs (fixes are not in the registry by id). */
  fix?: { label: string; exec: ExecSpec; note?: string }
  phase: 'preview' | 'launched' | 'running' | 'done' | 'filled' | 'failed'
  turnId?: string
  message?: string
  at: number
}

/** A settings change waiting for the person to confirm it. */
export type PendingSetting = { kind: 'output-style'; style: 'off' | 'learning' | 'explanatory' }

export type EnvSnapshot = {
  project: {
    root: string
    name: string
    hasGit: boolean
    branch: string | null
    changed: number
    github: boolean
    next: boolean
    prisma: boolean
    auth: string | null
    resend: boolean
    handoff: { title: string; status: string } | null
  } | null
  commands: string[]
  plugins: Record<string, { version: string; enabled: boolean }> | null
  mcp: Record<string, { status: 'ok' | 'auth' | 'failed'; detail?: string }> | null
  mcpCheckedAt: number | null
  clis: Record<string, boolean>
  checkedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'control-center': {
      page: Page
      query: string
      flow: Flow | null
      env: EnvSnapshot
      stage: string | null
      favourites: string[]
      expanded: string | null
      pending: PendingSetting | null
      autoOpen: boolean
      notice: string | null
    }
  }
}
