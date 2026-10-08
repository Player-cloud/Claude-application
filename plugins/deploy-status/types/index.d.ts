export type DeployRow = { env: string; sha: string; state: string; at: number; url?: string }

/** What deploy-status last found, published for other mods (the Control Center). */
export type DeployInfo = {
  /** owner/repo on GitHub, or null when the project has no GitHub remote. */
  repo: string | null
  rows: DeployRow[]
  /** Which environment the current commit is deployed to, if any. */
  headDeployed: string | null
  checkedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'deploy-status': { info: DeployInfo }
  }
}
