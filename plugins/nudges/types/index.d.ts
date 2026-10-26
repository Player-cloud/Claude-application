export type Suggestion = {
  /** Which nudge this is; "Not now" silences it by this id until tomorrow. */
  id: 'ship-after-push' | 'ship-after-commit' | 'ship-on-ask' | 'next-part' | 'commit-old-work'
  /** The command the Run button runs, without the slash. */
  command: string
  /** The line shown above the prompt. */
  text: string
}

declare module 'claude-code' {
  interface PluginState {
    nudges: { suggestion: Suggestion | null }
  }
}
