export type ProposalStatus = 'new' | 'added' | 'skipped' | 'exists'

export type Proposal = {
  id: string
  kind: 'skill' | 'lesson'
  title: string
  /** What repeats and how often (skills), or why it matters elsewhere (lessons). */
  why: string
  evidence: string[]
  /** Skills: the folder name, trigger description and SKILL.md body. */
  name?: string
  description?: string
  body?: string
  /** Lessons: the rule, and the project it came from. */
  text?: string
  source?: string
  status: ProposalStatus
}

/** What Send would pass to the model, shown before anything is sent. */
export type Preview = {
  scope: string
  requests: number
  notes: number
  projects: string[]
  tokens: number
}

export type Scan = {
  phase: 'idle' | 'scanning' | 'preview' | 'done' | 'error'
  message: string
  proposals: Proposal[]
  preview?: Preview
}

declare module 'claude-code' {
  interface PluginState {
    learner: { scan: Scan }
  }
}
