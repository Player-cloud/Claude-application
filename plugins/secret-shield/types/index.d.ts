/** What secret-shield publishes about itself: counts and times, never values. */
export type ShieldStatus = {
  /** Named secrets held across every project's vault. */
  protectedCount: number
  /** When the last real (not dry-run) scrub of old transcripts finished. */
  lastScrubAt: number | null
  lastScrubFiles: number
  lastScrubReplacements: number
}

declare module 'claude-code' {
  interface PluginState {
    'secret-shield': { status: ShieldStatus }
  }
}
