// What always asks you first, whatever the permission mode: things that leave
// this machine or can't be taken back. Each rule says why, and the ask shows it.

type Rule = { test: RegExp; why: string }

// Read-only Vercel commands; every other vercel call can deploy or change the project.
const VERCEL_READS = /\bvercel\s+(ls|list|logs|inspect|whoami|help|--help|-h|--version|-v|project\s+ls|domains\s+ls)\b/i

const SHELL: Rule[] = [
  { test: /\bgit\b[^|;&\n]*\spush\b/i, why: 'pushes always ask' },
  { test: /\bwrangler\s+(deploy|publish|pages\s+deploy|secret\s+put)\b/i, why: 'deploys always ask' },
  { test: /\bprisma\s+(migrate\s+(deploy|reset)|db\s+push)\b/i, why: 'database migrations always ask' },
  { test: /\b(npm|pnpm|yarn)\s+publish\b/i, why: 'publishing always asks' },
  { test: /\bgh\s+(release\s+create|workflow\s+run)\b/i, why: 'releases and workflow runs always ask' },
  { test: />>?\s*["']?[^\s"'|;&]*\.env(\.[\w.-]+)?["']?(\s|$)/i, why: 'writing to a .env file always asks' },
]

const ENV_FILE = /(^|[\\/])\.env(\.[\w.-]+)?$/i
const MCP_RISKY = /deploy|publish|release/i

// Why this call must ask, or null when the gate has nothing to say about it.
export function gateReason(tool: string, input: unknown): string | null {
  const i = (input ?? {}) as Record<string, unknown>
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = typeof i.command === 'string' ? i.command : ''
    if (/\bvercel\b/i.test(command) && !VERCEL_READS.test(command)) return 'deploys always ask'
    return SHELL.find(r => r.test.test(command))?.why ?? null
  }
  if (tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit') {
    const path = String(i.file_path ?? i.notebook_path ?? '')
    return ENV_FILE.test(path) ? 'writing to a .env file always asks' : null
  }
  if (tool.startsWith('mcp__') && MCP_RISKY.test(tool)) return 'deploys and releases always ask'
  return null
}
