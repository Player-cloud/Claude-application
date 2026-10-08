export type Command = { name: string; description: string }

declare module 'claude-code' {
  interface PluginState {
    'control-panel': {
      /** Every slash command and skill this session offers. */
      commands: Command[]
      /** What the search box holds. */
      query: string
      /** The pipeline stage of the last command run from anywhere. */
      stage: string | null
      /** The stage the person is looking at in the panel; null follows `stage`. */
      selected: string | null
    }
  }
}
