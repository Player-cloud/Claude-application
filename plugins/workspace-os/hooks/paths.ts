// Path handling for the profile boundary. Windows paths are case-insensitive and
// take either slash, so every path is reduced to one form before it is compared.

// c:/users/me/code: lower case, forward slashes, no trailing slash. Git Bash's
// /c/Users form becomes c:/users. Quotes around a path are dropped.
export function norm(path: string): string {
  let s = path.trim().replace(/^["']+|["']+$/g, '').replace(/\\/g, '/')
  s = s.replace(/^\/([a-zA-Z])(\/|$)/, '$1:/')
  s = s.replace(/\/{2,}/g, '/')
  if (s.length > 3) s = s.replace(/\/+$/, '')
  return s.toLowerCase()
}

const isAbsolute = (p: string) => /^[a-z]:\//.test(p) || p.startsWith('/')

// Resolves . and .. so c:/work/../personal can't pass as a path under c:/work.
function collapse(p: string): string {
  const drive = /^[a-z]:/.exec(p)?.[0] ?? ''
  const out: string[] = []
  for (const part of p.slice(drive.length).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return `${drive}/${out.join('/')}`
}

// An absolute, normalised path: relative paths resolve against the session's
// folder and ~ against the home folder.
export function resolve(path: string, cwd: string, home: string): string {
  let p = norm(path)
  if (p === '~' || p.startsWith('~/')) p = norm(home) + p.slice(1)
  if (!isAbsolute(p)) p = `${norm(cwd)}/${p}`
  return collapse(p)
}

// The folder list from an option: separated by ;, normalised, empty ones dropped.
export function parseRoots(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value.split(';').map(v => v.trim()).filter(Boolean).map(v => collapse(norm(v)))
}

export function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
}

// Absolute paths written in a shell command: C:\x or C:/x (quoted ones may hold
// spaces), Git Bash /c/x, and ~/x. Paths built at run time can't be seen here,
// so this is a guard rail for the shell, not a sandbox.
export function pathsInCommand(command: string): string[] {
  const found: string[] = []
  const add = (p: string | undefined) => {
    if (p) found.push(p)
  }
  for (const m of command.matchAll(/"([a-zA-Z]:[\\/][^"]*)"|'([a-zA-Z]:[\\/][^']*)'/g)) add(m[1] ?? m[2])
  for (const m of command.matchAll(/(?:^|[\s=("'`])([a-zA-Z]:[\\/][^\s"'`|;&<>()]*)/g)) add(m[1])
  for (const m of command.matchAll(/(?:^|[\s=("'`])(\/[a-zA-Z]\/[^\s"'`|;&<>()]*)/g)) add(m[1])
  for (const m of command.matchAll(/(?:^|[\s=("'`])(~[\\/][^\s"'`|;&<>()]*)/g)) add(m[1])
  return found
}

// secret-shield keeps each project's real secrets in ~/.claude/secret-shield/<slug>.env,
// the slug being the project's folder path with every run of other characters turned
// into "-". A file there belongs to a root when its name is the root's slug, or the
// slug followed by "-" (a project inside it). All three arguments are normalised.
export function isSecretVaultOf(path: string, home: string, root: string): boolean {
  const dir = `${home}/.claude/secret-shield/`
  if (!path.startsWith(dir)) return false
  const name = path.slice(dir.length)
  const slug = root.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug !== '' && (name === `${slug}.env` || name.startsWith(`${slug}-`))
}
