export type Forecast = {
  /** Context tokens after each recent main-loop turn, oldest first (at most 12). */
  history: number[]
  /** The model's context window, in tokens. */
  window: number
}

export type Limit = {
  /** `five_hour`, `seven_day`, or a gateway's `spend_limit`. */
  kind: string
  /** 0 to 100. */
  percentUsed: number
  /** ISO 8601, when the window resets. */
  resetsAt?: string
}

declare module 'claude-code' {
  interface PluginState {
    'token-weather': { forecast: Forecast | null; limits: Limit[] }
  }
}
