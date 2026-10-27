// Small helpers for running programs and finding paths on this PC.
// Everything runs without a shell: arguments are passed as a list, never joined into a command line.

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, delimiter, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const isWin = process.platform === 'win32'
export const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const home = () => homedir()
export const claudeDir = () => join(homedir(), '.claude')

export function run(cmd, args = [], { cwd, input, timeout = 600000, env } = {}) {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let child
    try {
      child = spawn(cmd, args, { cwd, env: env ? { ...process.env, ...env } : process.env, windowsHide: true })
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e.message || e) })
      return
    }
    const timer = setTimeout(() => child.kill(), timeout)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout: out, stderr: err + String(e.message || e) }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout: out, stderr: err }) })
    if (input != null) child.stdin.end(input)
    else child.stdin.end()
  })
}

// Opens a folder, file or web address with the PC's default program.
export function openThing(target) {
  const cmd = isWin ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  try {
    const child = spawn(cmd, [target], { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

function onPath(names) {
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue
    for (const name of names) {
      const p = join(dir, name)
      if (existsSync(p)) return p
    }
  }
  return null
}

function versionDirs(root) {
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((n) => /^\d+\.\d+\.\d+/.test(n))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((n) => join(root, n))
}

// Claude Desktop's own copies: <data>\claude-code\<version>\[<build>\]claude.exe, newest version first.
// Seen on Windows 2026-10-27: %LOCALAPPDATA%\Claude-Data\claude_<id>\claude-code\2.1.308\<build>\claude.exe.
export function desktopCopies(roots) {
  const found = []
  for (const root of roots) {
    for (const v of versionDirs(root)) {
      const version = basename(v)
      if (existsSync(join(v, 'claude.exe'))) found.push({ version, path: join(v, 'claude.exe') })
      try {
        for (const b of readdirSync(v, { withFileTypes: true })) {
          if (b.isDirectory() && existsSync(join(v, b.name, 'claude.exe'))) found.push({ version, path: join(v, b.name, 'claude.exe') })
        }
      } catch {}
    }
  }
  return found.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true })).map((f) => f.path)
}

function desktopRoots() {
  const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  const roots = [join(appData, 'Claude', 'claude-code')]
  const data = join(local, 'Claude-Data')
  try {
    for (const d of readdirSync(data, { withFileTypes: true })) if (d.isDirectory()) roots.push(join(data, d.name, 'claude-code'))
  } catch {}
  return roots
}

// Where Claude Code's command line might be. Claude Desktop keeps its own copy and does not put it on PATH.
export function claudeCandidates(saved) {
  const list = []
  if (saved) list.push(saved)
  const found = onPath(isWin ? ['claude.exe'] : ['claude'])
  if (found) list.push(found)
  if (isWin) {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    list.push(join(homedir(), '.local', 'bin', 'claude.exe'))
    list.push(...desktopCopies(desktopRoots()))
    list.push(join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'))
  } else {
    list.push(join(homedir(), '.local', 'bin', 'claude'))
  }
  return [...new Set(list)].filter((p) => existsSync(p))
}

// Returns { cmd, pre, path, version } for the first candidate that answers --version as Claude Code.
export async function findClaude(saved) {
  for (const p of claudeCandidates(saved)) {
    const tool = p.endsWith('.js') ? { cmd: process.execPath, pre: [p] } : { cmd: p, pre: [] }
    const r = await run(tool.cmd, [...tool.pre, '--version'], { timeout: 20000 })
    if (r.code === 0 && /Claude Code/i.test(r.stdout)) {
      return { ...tool, path: p, version: r.stdout.trim().split(/\s+/)[0] }
    }
  }
  return null
}

export async function claude(tool, args, opts) {
  if (!tool) return { code: -1, stdout: '', stderr: 'Claude Code was not found on this PC.' }
  return run(tool.cmd, [...tool.pre, ...args], opts)
}

// Parses the last JSON value printed by a --json command.
export function lastJson(text) {
  const t = text.trim()
  try { return JSON.parse(t) } catch {}
  const lines = t.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines.slice(i).join('\n')) } catch {}
  }
  return null
}

export function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) } catch { return fallback }
}

export function isDir(p) {
  try { return statSync(p).isDirectory() } catch { return false }
}
