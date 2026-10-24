// Pure secret detection: no engine calls, so it can be tested on its own.

export type Found = { name: string; value: string }

export const PLACEHOLDER = /\{\{secret:([A-Z][A-Z0-9_]*)\}\}/g

const PLACEHOLDER_VALUE = /^(your[_-]|example|changeme|xxx+|<|\$\{|\$[A-Z]|\*+$|\.\.\.|\{\{secret:)/i

const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIAL)/
const ENV_LINE = /^[ \t]*(?:export[ \t]+)?([A-Z][A-Z0-9_]*)[ \t]*=[ \t]*["']?([^\s"'#]{6,})["']?/gm

const JSON_KEY =
  /"(accountAuthToken|applicationKey|apiKey|api_key|secret|clientSecret|client_secret|password|passwd|token|accessToken|access_token|refreshToken|refresh_token|authToken|privateKey|private_key)"\s*:\s*"([^"]{6,})"/g

const HAS_URL_CREDS = /^[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]{3,}@/i
const URL_CREDS = /\b([a-z][a-z0-9+.-]*):\/\/[^\s:/@]+:[^\s@/]{3,}@[^\s"'<>`]+/gi

const PREFIXED: [RegExp, string][] = [
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/g, 'ANTHROPIC_API_KEY'],
  [/\bsk_(?:live|test)_[A-Za-z0-9]{16,}/g, 'STRIPE_SECRET_KEY'],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, 'OPENAI_API_KEY'],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/g, 'GITHUB_TOKEN'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, 'GITHUB_TOKEN'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, 'SLACK_TOKEN'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AWS_ACCESS_KEY_ID'],
  [/\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/g, 'RESEND_API_KEY'],
  [/\bnpg_[A-Za-z0-9]{8,}/g, 'NEON_PASSWORD'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, 'GOOGLE_API_KEY'],
  [/\bK00[0-9A-Za-z+/]{28}\b/g, 'B2_APPLICATION_KEY'],
  [/\b4_[0-9a-f]{20,}_[0-9a-f]{6,}_[0-9a-f]{6,}_[A-Za-z0-9_]+_[A-Za-z0-9_=-]{10,}/g, 'B2_AUTH_TOKEN'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'JWT_TOKEN'],
]

// "password: X", "Password = X", "the password for the postgres is X"
const PASSWORD_PHRASE =
  /\b(pass(?:word)?|pwd|passcode)\b(?:[ \t]+for[ \t]+[^\n:=]{1,40}?)?[ \t]*(?:is[ \t]+|:[ \t]*|=[ \t]*)["']?([^\s"']{4,})["']?/gi

// A login list: "name@example.com    s3cret" per line, under a heading
// that mentions passwords.
const EMAIL_ROW = /^[ \t]*([\w.+-]+)@[\w-]+(?:\.[\w-]+)+[\s|,;:]+(\S{6,})[ \t]*$/gm

function urlName(scheme: string): string {
  const s = scheme.toLowerCase()
  if (s.startsWith('postgres') || s.startsWith('mysql') || s === 'mariadb' || s === 'sqlserver') return 'DATABASE_URL'
  if (s.startsWith('redis') || s === 'rediss') return 'REDIS_URL'
  if (s.startsWith('mongodb')) return 'MONGODB_URI'
  if (s === 'amqp' || s === 'amqps') return 'AMQP_URL'
  return 'SECRET_URL'
}

function decodeURIComponentSafe(v: string): string {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

function snake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()
}

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_VALUE.test(value)
}

/**
 * Finds secrets in `text`, most specific first, and returns each one with a
 * suggested variable name. A value found by an earlier rule is not reported
 * again by a later one.
 */
export function findSecrets(text: string): Found[] {
  const found: Found[] = []
  const seen = new Set<string>()
  const add = (name: string, value: string, inner = false) => {
    if (value.length < 4 || isPlaceholder(value) || seen.has(value)) return
    // Skip a value that sits inside one already found, unless it is that
    // value's own password, which can also turn up on its own elsewhere.
    if (!inner) for (const v of seen) if (v.includes(value)) return
    seen.add(value)
    found.push({ name, value })
  }

  for (const m of text.matchAll(ENV_LINE)) {
    const [, key, value] = m
    if (SECRET_NAME.test(key) || HAS_URL_CREDS.test(value)) add(key, value)
  }
  for (const m of text.matchAll(JSON_KEY)) add(snake(m[1]), m[2])
  for (const m of text.matchAll(URL_CREDS)) add(urlName(m[1]), m[0])
  // The password inside every credentialed URL found so far.
  for (const v of [...seen]) {
    const pw = /^[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@/]{6,})@/i.exec(v)?.[1]
    if (pw) add(pw.startsWith('npg_') ? 'NEON_PASSWORD' : 'DB_PASSWORD', decodeURIComponentSafe(pw), true)
  }
  for (const [re, name] of PREFIXED) for (const m of text.matchAll(re)) add(name, m[0])
  if (/password/i.test(text)) {
    for (const m of text.matchAll(EMAIL_ROW)) {
      if (/[0-9]|[^A-Za-z0-9]/.test(m[2]) && !m[2].includes('@')) add(`PASSWORD_${snake(m[1])}`, m[2])
    }
  }
  // A phrase value must look like a password, not a word: "the password is incorrect".
  for (const m of text.matchAll(PASSWORD_PHRASE)) if (/[0-9]|[^A-Za-z0-9]/.test(m[2])) add('PASSWORD', m[2])
  return found
}

/** Parses a .env file into name → value. */
export function parseEnv(text: string): Map<string, string> {
  const vars = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1)
    }
    vars.set(m[1], value)
  }
  return vars
}

export function envLine(name: string, value: string): string {
  return `${name}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Gives each found secret a name that is free in `existing` (or reuses the
 * name already holding the same value), and returns the names to write.
 */
export function assignNames(found: Found[], existing: Map<string, string>): { name: string; value: string; isNew: boolean }[] {
  const taken = new Map(existing)
  return found.map(({ name, value }) => {
    for (const [k, v] of taken) if (v === value) return { name: k, value, isNew: false }
    let candidate = name
    for (let i = 2; taken.has(candidate); i++) candidate = `${name}_${i}`
    taken.set(candidate, value)
    return { name: candidate, value, isNew: true }
  })
}

/** Replaces each value with its {{secret:NAME}} placeholder, longest first. */
export function redact(text: string, named: { name: string; value: string }[]): string {
  let out = text
  for (const { name, value } of [...named].sort((a, b) => b.value.length - a.value.length)) {
    out = out.split(value).join(`{{secret:${name}}}`)
  }
  return out
}
