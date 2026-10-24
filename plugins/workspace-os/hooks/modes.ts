// The four learning modes. Each is a short block of instructions added to the
// system prompt; it sits after the output style, so it can switch the style's
// teaching rules on or off for the session.

export type ModeId = 'tutor' | 'build' | 'do' | 'review'

export const MODES: Record<ModeId, { label: string; text: string }> = {
  tutor: {
    label: 'Tutor',
    text:
      'Mode: Tutor. Teach before doing. Explain the idea and the approach, check understanding with one question at a time, and give hints rather than full solutions. Write code only when the user asks for it, then explain each part. This takes precedence over any rule in the output style about how much to explain.',
  },
  build: {
    label: 'Build with me',
    text:
      'Mode: Build with me. Build the task together with the user. Explain implementation choices briefly as you go. When a decision genuinely shapes the feature (business logic, error handling, data structures, user experience, architecture), prepare the surrounding code with a clear TODO and invite the user to write the 5-10 lines that matter. Skip the invitation for boilerplate, or when the user says to just build it.',
  },
  do: {
    label: 'Do it for me',
    text:
      'Mode: Do it for me. Do the task directly and efficiently. Tell the user only what they need: what changed, what was checked, what is left. No insight boxes, no teaching asides and no invitations to write code, even where the output style asks for them.',
  },
  review: {
    label: 'Review mine',
    text:
      "Mode: Review mine. The user writes the code and you review it. Don't write or edit their code unless they ask. Say what works, what to fix and why, most important first, with file and line references, and describe the fix rather than making it.",
  },
}

const NAMES: Record<string, ModeId> = {
  tutor: 'tutor',
  build: 'build',
  'build-with-me': 'build',
  do: 'do',
  'do-it': 'do',
  'do-it-for-me': 'do',
  review: 'review',
  'review-mine': 'review',
}

// "Build with me", "build", "BUILD-WITH-ME" all name the same mode.
export function modeFromName(name: string): ModeId | null {
  return NAMES[name.trim().toLowerCase().replace(/\s+/g, '-')] ?? null
}

// The mode at the start of a /mode line, and whatever follows it. The longest match wins, so
// 'build with me' is one mode and 'tutor write a parser' is Tutor plus the rest.
export function modeAtStart(words: readonly string[]): { mode: ModeId | null; rest: string } {
  for (let n = Math.min(4, words.length); n >= 1; n--) {
    const mode = modeFromName(words.slice(0, n).join(' '))
    if (mode) return { mode, rest: words.slice(n).join(' ') }
  }
  return { mode: null, rest: words.join(' ') }
}

export const SCRATCH_TEXT =
  'This is a scratch session for a one-off task: there is no project here. Keep any files in this folder, and if the task turns out to need a real project, say so.'

export const MODE_HELP =
  'Modes: /mode tutor · /mode build · /mode do · /mode review (this session). /mode default <mode> sets this folder\'s default.'
