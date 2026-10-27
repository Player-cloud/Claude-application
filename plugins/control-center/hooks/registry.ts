// The capability registry: one record per thing Claude Code can do for the
// person, and the rules that turn the live environment into a status for it.
// Every page draws from here; nothing about a capability is written twice.
// Pure data and functions: no engine calls.

export type Stage = 'brief' | 'plan' | 'build' | 'review' | 'ship' | 'report'

export type Exec =
  | { via: 'command'; command: string; args?: string }
  | { via: 'fill'; text: string }
  | { via: 'prompt'; text: string }

export type Fix = { label: string; exec: Exec; note?: string }

export type Need =
  | { kind: 'command'; name: string }
  | { kind: 'plugin'; id: string }
  | { kind: 'mcp'; server: string; label: string; optional?: boolean }
  | { kind: 'cli'; name: string; fix?: Fix }
  | { kind: 'project'; check: 'git' | 'next' | 'prisma' | 'github' | 'handoff' }

export type CapabilityType = 'skill' | 'command' | 'plugin skill' | 'agent' | 'action'
export type Source = 'personal' | 'toolkit' | 'marketplace' | 'account' | 'built-in'

export type Capability = {
  id: string
  name: string
  icon: string
  type: CapabilityType
  source: Source
  /** The plugin it comes from, as `claude plugin list` or the command list names it. */
  plugin?: string
  category: string
  description: string
  /** Words and phrases people use when they want this. */
  intents: string[]
  needs: Need[]
  exec: Exec
  /** What will happen, shown before it runs. */
  steps: string[]
  stage?: Stage
  /** Shown as next actions once it finishes. */
  next?: string[]
}

export type Workflow = {
  id: string
  name: string
  icon: string
  description: string
  intents: string[]
  /** Capability ids, in order. */
  steps: { cap: string; why: string }[]
  /** When set, the workflow asks for this before it starts (fills the prompt). */
  ask?: string
}

export type ModuleId = 'secret-shield' | 'token-weather' | 'nudges' | 'deploy-status' | 'handoff' | 'learner'

// ---------------------------------------------------------------- live environment

export type McpState = { status: 'ok' | 'auth' | 'failed'; detail?: string }

export type Env = {
  project: {
    root: string
    name: string
    hasGit: boolean
    branch: string | null
    changed: number
    github: boolean
    next: boolean
    prisma: boolean
    auth: string | null
    resend: boolean
    handoff: { title: string; status: string } | null
  } | null
  /** Names of every slash command and skill this session offers (no slash). */
  commands: string[]
  /** From `claude plugin list --json`: id → version and whether it is on. */
  plugins: Record<string, { version: string; enabled: boolean }> | null
  /** From `claude mcp list`: server name → health. Null until first checked. */
  mcp: Record<string, McpState> | null
  mcpCheckedAt: number | null
  /** Command-line tools found on PATH. */
  clis: Record<string, boolean>
  checkedAt: number | null
}

export const EMPTY_ENV: Env = { project: null, commands: [], plugins: null, mcp: null, mcpCheckedAt: null, clis: {}, checkedAt: null }

// ---------------------------------------------------------------- capabilities

const SIGN_IN = (label: string): Fix => ({
  label: `🔑 Connect ${label}`,
  exec: { via: 'fill', text: '/mcp' },
  note: `Opens Claude Code's MCP menu, where you sign in to ${label} yourself.`,
})

export const CAPABILITIES: Capability[] = [
  // Personal skills
  {
    id: 'next-part', name: 'Next Part', icon: '🏗', type: 'skill', source: 'personal', category: 'Build',
    description: "Plan, build, test, review and commit the next part of the project's plan.",
    intents: ['continue my project', 'carry on', 'next part', 'keep building', 'build the next', 'what next', 'continue the plan'],
    needs: [{ kind: 'command', name: 'next-part' }, { kind: 'project', check: 'git' }],
    exec: { via: 'command', command: 'next-part' },
    steps: ['Read the plan, memory and git history', 'Propose a plan for your approval (plan mode)', 'Build it', 'Run typecheck, lint, unit and end-to-end tests', 'Review the change for errors and test gaps', 'Commit (asks before pushing)', 'Update project memory and docs'],
    stage: 'build', next: ['ship-check', 'code-review'],
  },
  {
    id: 'ship-check', name: 'Ship Check', icon: '🚀', type: 'skill', source: 'personal', category: 'Ship',
    description: 'Check a Next.js + Prisma project is safe to deploy, then deploy a Vercel preview.',
    intents: ['deploy my app', 'deploy', 'ship', 'ship it', 'release', 'go live', 'preview', 'production', 'ready to deploy'],
    needs: [{ kind: 'command', name: 'ship-check' }, { kind: 'project', check: 'git' }, { kind: 'project', check: 'next' }],
    exec: { via: 'command', command: 'ship-check' },
    steps: ['Git status and unpushed commits', 'Typecheck, lint and tests', 'The CI build, reproduced without a database', 'Prisma migration checks', 'Environment variables compared by name', 'Vercel preview deployment (you confirm)'],
    stage: 'ship', next: ['deploy-status', 'manager-update'],
  },
  {
    id: 'manager-update', name: 'Manager Update', icon: '📝', type: 'skill', source: 'personal', category: 'Report',
    description: 'Turn git history and chats into your manager timesheet or update, and an email to paste.',
    intents: ['write an update for my manager', 'timesheet', 'weekly update', 'report', 'email my boss', 'progress report', 'what did i do'],
    needs: [{ kind: 'command', name: 'manager-update' }],
    exec: { via: 'command', command: 'manager-update' },
    steps: ["Find your manager's usual format", 'Gather commits, project memory and chats for the period', 'Ask about days with no record', 'Fill in the document', 'Draft the email (never sent)'],
    stage: 'report',
  },
  {
    id: 'handoff-to-code', name: 'Write Handoff', icon: '📤', type: 'skill', source: 'personal', category: 'Brief',
    description: 'Turn an agreed plan into .claude/handoff.md for Claude Code to pick up.',
    intents: ['write the handoff', 'hand this to code', 'brief', 'handoff'],
    needs: [{ kind: 'command', name: 'handoff-to-code' }],
    exec: { via: 'command', command: 'handoff-to-code' },
    steps: ['Check the plan has a goal, scope and "done when"', 'Write .claude/handoff.md in the project', 'Offer a Word copy for your manager'],
    stage: 'brief',
  },
  {
    id: 'copy', name: 'Copy File Formatted', icon: '📋', type: 'command', source: 'personal', category: 'Docs',
    description: 'Copy a file to the clipboard as rich text for Word, Docs, email or Slack.',
    intents: ['copy', 'clipboard', 'paste into word', 'rich text'],
    needs: [{ kind: 'command', name: 'copy' }],
    exec: { via: 'fill', text: '/copy ' },
    steps: ['Puts /copy in the prompt; add the file path and press Enter'],
  },
  // Toolkit commands
  {
    id: 'handoff', name: 'View Handoff', icon: '🔄', type: 'command', source: 'toolkit', plugin: 'handoff', category: 'Brief',
    description: 'Show the plan Cowork handed over for this project.',
    intents: ['handoff', 'brief', 'what was agreed', 'continue my project'],
    needs: [{ kind: 'command', name: 'handoff' }, { kind: 'project', check: 'handoff' }],
    exec: { via: 'command', command: 'handoff' },
    steps: ['Print the handoff into the conversation'],
    stage: 'brief', next: ['next-part'],
  },
  {
    id: 'deploy-status', name: 'Deploy Status', icon: '▲', type: 'command', source: 'toolkit', plugin: 'deploy-status', category: 'Ship',
    description: 'List the latest production and preview deployments with links.',
    intents: ['deployments', 'is it deployed', 'deploy status', 'vercel status', 'live site'],
    needs: [{ kind: 'command', name: 'deploy-status' }, { kind: 'project', check: 'github' }],
    exec: { via: 'command', command: 'deploy-status' },
    steps: ['Read the deployments Vercel recorded on GitHub', 'List them with links'],
    stage: 'ship',
  },
  {
    id: 'scrub-secrets', name: 'Scrub Secrets Now', icon: '🧽', type: 'command', source: 'toolkit', plugin: 'secret-shield', category: 'Secure',
    description: 'Replace known secrets in old transcripts with placeholders (backups kept).',
    intents: ['scrub', 'clean secrets', 'remove passwords from history'],
    needs: [{ kind: 'command', name: 'scrub-secrets' }],
    exec: { via: 'command', command: 'scrub-secrets' },
    steps: ['Scan finished transcripts, memory and remember logs', 'Replace known secret values with placeholders', 'Back up every changed file first'],
  },
  {
    id: 'learn-skills', name: 'Find Skill Ideas', icon: '🧠', type: 'command', source: 'toolkit', plugin: 'learner', category: 'Report',
    description: 'Scan your history for repeated tasks and propose skills (uses some usage).',
    intents: ['learn', 'new skills', 'what do i repeat', 'automate'],
    needs: [{ kind: 'command', name: 'learn-skills' }],
    exec: { via: 'command', command: 'learn-skills' },
    steps: ['Collect your requests from the last 60 days', 'Ask Haiku for repeated tasks and shareable lessons', 'Show proposals for your approval (nothing is added automatically)'],
    stage: 'report',
  },
  // Toolkit skills: plan, check against the plan, click through (the plan stays the source of truth)
  {
    id: 'goldfish-review', name: 'Goldfish Review', icon: '🐟', type: 'plugin skill', source: 'toolkit', plugin: 'workspace-os', category: 'Plan',
    description: 'Fresh reviewers who see only the plan check it before anything is built; you pick the fixes.',
    intents: ['review this plan', 'review the spec', 'goldfish review', 'check this plan', 'before we build', 'write a spec'],
    needs: [{ kind: 'command', name: 'workspace-os:goldfish-review' }],
    exec: { via: 'command', command: 'workspace-os:goldfish-review' },
    steps: ['Find the plan in docs/designs (or start one from the template)', 'Four fresh reviewers read only the plan and the code (a fifth for design when it has screens)', 'One table of findings; you pick which to fix', 'Fix only those and note the rest in the review log'],
    stage: 'plan', next: ['next-part'],
  },
  {
    id: 'drift-check', name: 'Drift Check', icon: '🧭', type: 'plugin skill', source: 'toolkit', plugin: 'workspace-os', category: 'Review',
    description: 'List every place the built code differs from its plan.',
    intents: ['drift check', 'does the code match the plan', 'check against the spec', 'match the plan'],
    needs: [{ kind: 'command', name: 'workspace-os:drift-check' }],
    exec: { via: 'command', command: 'workspace-os:drift-check' },
    steps: ['Read the plan and the code with fresh eyes', 'Mark each claim Matches, Differs or Missing', 'You decide: fix the code, update the plan, or leave it'],
    stage: 'review', next: ['qa'],
  },
  {
    id: 'qa', name: 'QA in the Browser', icon: '🖱', type: 'plugin skill', source: 'toolkit', plugin: 'workspace-os', category: 'Review',
    description: "Click through the plan's journeys in a real browser and report with screenshots. Changes no code.",
    intents: ['qa', 'test it in the browser', 'click through it', 'does it actually work', 'try the screens'],
    needs: [{ kind: 'command', name: 'workspace-os:qa' }],
    exec: { via: 'command', command: 'workspace-os:qa' },
    steps: ["Read the plan's journeys and named test states", 'Start it locally with a test state, never real folders', 'Click through each step and take screenshots', 'Report pass and fail; you pick what gets fixed'],
    stage: 'review', next: ['ship-check'],
  },
  // Built-in
  {
    id: 'code-review', name: 'Code Review', icon: '🔍', type: 'command', source: 'built-in', category: 'Review',
    description: 'Review the current changes for bugs.',
    intents: ['review my code', 'review', 'check my code', 'find bugs', 'code review'],
    needs: [{ kind: 'command', name: 'code-review' }, { kind: 'project', check: 'git' }],
    exec: { via: 'command', command: 'code-review' },
    steps: ['Read the current diff', 'Report correctness bugs and cleanups'],
    stage: 'review', next: ['claude-security', 'ship-check'],
  },
  {
    id: 'security-review', name: 'Security Review', icon: '🛡', type: 'command', source: 'built-in', category: 'Secure',
    description: 'A security review of the pending changes on this branch.',
    intents: ['security review', 'check security', 'is this safe', 'vulnerabilities'],
    needs: [{ kind: 'command', name: 'security-review' }, { kind: 'project', check: 'git' }],
    exec: { via: 'command', command: 'security-review' },
    steps: ['Read the branch changes', 'Report security issues'],
    stage: 'review',
  },
  {
    id: 'simplify', name: 'Simplify Code', icon: '✂', type: 'command', source: 'built-in', category: 'Review',
    description: 'Clean up recent changes for reuse, simplicity and efficiency.',
    intents: ['simplify', 'clean up', 'refactor', 'tidy'],
    needs: [{ kind: 'command', name: 'simplify' }, { kind: 'project', check: 'git' }],
    exec: { via: 'command', command: 'simplify' },
    steps: ['Review the changed code', 'Apply cleanups that keep behaviour the same'],
    stage: 'review',
  },
  {
    id: 'run-tests', name: 'Run Tests', icon: '🧪', type: 'action', source: 'built-in', category: 'Test',
    description: "Run the project's test suites and report what passes and fails.",
    intents: ['test', 'run tests', 'are tests passing', 'check tests'],
    needs: [{ kind: 'project', check: 'git' }],
    exec: { via: 'prompt', text: "Run this project's test suites (unit first, then end-to-end if it has them) and report the real results: what passes, what fails, and why the failures happen. Don't change any code." },
    steps: ['Find the test commands in package.json', 'Run unit tests, then end-to-end tests', 'Report passes and failures without changing code'],
    stage: 'review',
  },
  // Marketplace plugins
  {
    id: 'feature-dev', name: 'Feature Development', icon: '🧭', type: 'plugin skill', source: 'marketplace', plugin: 'feature-dev', category: 'Build',
    description: 'Guided feature work: explore the code, design the architecture, build, review.',
    intents: ['new feature', 'build a feature', 'add a feature', 'design a feature'],
    needs: [{ kind: 'command', name: 'feature-dev:feature-dev' }],
    exec: { via: 'command', command: 'feature-dev:feature-dev' },
    steps: ['Explore the existing code', 'Design the architecture with you', 'Build and review'],
    stage: 'plan',
  },
  {
    id: 'review-pr', name: 'PR Review Toolkit', icon: '🧾', type: 'plugin skill', source: 'marketplace', plugin: 'pr-review-toolkit', category: 'Review',
    description: 'Six specialist reviewers: quality, tests, silent failures, comments, types, simplicity.',
    intents: ['review my code', 'review pr', 'pull request review', 'thorough review'],
    needs: [{ kind: 'command', name: 'pr-review-toolkit:review-pr' }, { kind: 'project', check: 'git' }],
    exec: { via: 'command', command: 'pr-review-toolkit:review-pr' },
    steps: ['Run the specialist review agents on your changes', 'Collect their findings'],
    stage: 'review',
  },
  {
    id: 'claude-security', name: 'Security Audit', icon: '🔒', type: 'plugin skill', source: 'marketplace', plugin: 'claude-security', category: 'Secure',
    description: 'Deep vulnerability scan with every finding challenged; can draft verified patches.',
    intents: ['security', 'check security', 'security audit', 'vulnerability scan', 'pen test'],
    needs: [{ kind: 'command', name: 'claude-security:claude-security' }, { kind: 'project', check: 'git' }],
    exec: { via: 'command', command: 'claude-security:claude-security' },
    steps: ['Open the Claude Security menu to choose scope and effort', 'Scan, then challenge each finding', 'Report; patches only when you ask'],
    stage: 'review', next: ['ship-check'],
  },
  {
    id: 'code-simplifier', name: 'Code Simplifier Agent', icon: '🧹', type: 'agent', source: 'marketplace', plugin: 'code-simplifier', category: 'Review',
    description: 'An agent that tidies recently changed code without changing what it does.',
    intents: ['simplify', 'clean up', 'tidy code'],
    needs: [{ kind: 'plugin', id: 'code-simplifier@claude-plugins-official' }],
    exec: { via: 'prompt', text: 'Use the code-simplifier agent to simplify my recent changes for clarity and consistency, keeping behaviour exactly the same. Show me what it changed.' },
    steps: ['Ask Claude to run the code-simplifier agent on recent changes'],
    stage: 'review',
  },
  {
    id: 'vercel-deploy', name: 'Deploy to Vercel', icon: '▲', type: 'plugin skill', source: 'marketplace', plugin: 'vercel', category: 'Ship',
    description: 'Deploy the current project to Vercel (preview by default).',
    intents: ['deploy my app', 'vercel', 'deploy to vercel'],
    needs: [{ kind: 'command', name: 'vercel:deploy' }, { kind: 'cli', name: 'vercel', fix: { label: '⚙ Set up Vercel CLI', exec: { via: 'prompt', text: 'Help me install the Vercel CLI and link this project. I will run the login step myself.' } } }],
    exec: { via: 'command', command: 'vercel:deploy' },
    steps: ['Deploy a preview with the Vercel CLI'],
    stage: 'ship',
  },
  {
    id: 'vercel-env', name: 'Vercel Env Vars', icon: '🔐', type: 'plugin skill', source: 'marketplace', plugin: 'vercel', category: 'Ship',
    description: 'List, pull and compare Vercel environment variables.',
    intents: ['environment variables', 'env vars', 'vercel env'],
    needs: [{ kind: 'command', name: 'vercel:env' }, { kind: 'cli', name: 'vercel', fix: { label: '⚙ Set up Vercel CLI', exec: { via: 'prompt', text: 'Help me install the Vercel CLI and link this project. I will run the login step myself.' } } }],
    exec: { via: 'command', command: 'vercel:env' },
    steps: ['Read environment variables with the Vercel CLI'],
    stage: 'ship',
  },
  {
    id: 'frontend-design', name: 'Frontend Design', icon: '🎨', type: 'plugin skill', source: 'marketplace', plugin: 'frontend-design', category: 'Design',
    description: 'Distinctive, production-grade interface design.',
    intents: ['make this ui better', 'design', 'ui', 'make it look better', 'styling', 'frontend'],
    needs: [{ kind: 'command', name: 'frontend-design:frontend-design' }],
    exec: { via: 'command', command: 'frontend-design:frontend-design' },
    steps: ['Load the design guidance', 'Design and build the interface with you'],
    stage: 'build',
  },
  {
    id: 'web-guidance', name: 'Modern Web Guidance', icon: '🌐', type: 'plugin skill', source: 'marketplace', plugin: 'modern-web-guidance', category: 'Design',
    description: 'Current web platform best practices.',
    intents: ['best practices', 'modern web', 'accessibility', 'performance'],
    needs: [{ kind: 'command', name: 'modern-web-guidance:modern-web-guidance' }],
    exec: { via: 'command', command: 'modern-web-guidance:modern-web-guidance' },
    steps: ['Load current web guidance for the task'],
  },
  {
    id: 'figma', name: 'Figma to Code', icon: '🖌', type: 'plugin skill', source: 'marketplace', plugin: 'figma', category: 'Design',
    description: 'Turn Figma designs into code.',
    intents: ['figma', 'design to code', 'implement the design'],
    needs: [{ kind: 'command', name: 'figma:figma-design-to-code' }, { kind: 'mcp', server: 'plugin:figma:figma', label: 'Figma' }],
    exec: { via: 'command', command: 'figma:figma-design-to-code' },
    steps: ['Read the Figma design', 'Build it in the project'],
    stage: 'build',
  },
  {
    id: 'prisma', name: 'Database (Prisma)', icon: '🗄', type: 'plugin skill', source: 'marketplace', plugin: 'prisma', category: 'Data',
    description: "Check the Prisma schema and migrations, and explain what needs attention.",
    intents: ['database', 'prisma', 'migration', 'schema', 'postgres'],
    needs: [{ kind: 'project', check: 'prisma' }, { kind: 'mcp', server: 'plugin:prisma:Prisma-Local', label: 'Prisma (local)', optional: true }],
    exec: { via: 'prompt', text: "Check this project's Prisma schema and migration status (npx prisma migrate status) and explain anything that needs attention. Don't change the database." },
    steps: ['Read the Prisma schema', 'Check migration status', 'Explain issues without changing the database'],
    stage: 'build',
  },
  {
    id: 'auth0', name: 'Authentication (Auth0)', icon: '🔑', type: 'plugin skill', source: 'marketplace', plugin: 'auth0', category: 'Auth',
    description: 'Add or fix login, MFA, single sign-on and roles with Auth0.',
    intents: ['login', 'authentication', 'auth', 'sign in', 'mfa', 'sso'],
    needs: [{ kind: 'command', name: 'auth0:auth0' }],
    exec: { via: 'command', command: 'auth0:auth0' },
    steps: ['Detect the framework', 'Load the right Auth0 guide', 'Work through it with you'],
    stage: 'build',
  },
  {
    id: 'resend', name: 'Email (Resend)', icon: '✉', type: 'plugin skill', source: 'marketplace', plugin: 'resend', category: 'Email',
    description: 'Send and receive email, build React Email templates.',
    intents: ['email', 'send email', 'email template', 'resend'],
    needs: [{ kind: 'command', name: 'resend:resend' }, { kind: 'mcp', server: 'plugin:resend:resend', label: 'Resend', optional: true }],
    exec: { via: 'command', command: 'resend:resend' },
    steps: ['Load the Resend guide', 'Build or fix email with you'],
    stage: 'build',
  },
  {
    id: 'cloudflare', name: 'Cloudflare', icon: '☁', type: 'plugin skill', source: 'marketplace', plugin: 'cloudflare', category: 'Ship',
    description: 'Build and deploy on Cloudflare Workers.',
    intents: ['cloudflare', 'workers', 'wrangler'],
    needs: [{ kind: 'command', name: 'cloudflare:cloudflare' }, { kind: 'mcp', server: 'plugin:cloudflare:cloudflare', label: 'Cloudflare', optional: true }],
    exec: { via: 'command', command: 'cloudflare:cloudflare' },
    steps: ['Load Cloudflare guidance for the task'],
  },
  {
    id: 'scrape-plan', name: 'Plan a Web Scrape', icon: '🕸', type: 'plugin skill', source: 'marketplace', plugin: 'zyte-web-data', category: 'Data',
    description: 'Plan a scrape and validate an extraction spec.',
    intents: ['scrape', 'scraping', 'crawl a website', 'extract data from a site'],
    needs: [{ kind: 'command', name: 'zyte-web-data:scrape-plan' }],
    exec: { via: 'command', command: 'zyte-web-data:scrape-plan' },
    steps: ['Explore a page and propose the fields', 'Validate on more pages', 'Present the plan for approval'],
  },
  {
    id: 'project-artifact', name: 'Project Status Page', icon: '📊', type: 'plugin skill', source: 'marketplace', plugin: 'project-artifact', category: 'Report',
    description: 'A shareable status page: goals, workstreams, risks, decisions.',
    intents: ['status page', 'share progress', 'project status'],
    needs: [{ kind: 'command', name: 'project-artifact:project-artifact' }],
    exec: { via: 'command', command: 'project-artifact:project-artifact' },
    steps: ['Gather the project state', 'Publish a private status page you can share'],
    stage: 'report',
  },
  {
    id: 'revise-claude-md', name: 'Update CLAUDE.md', icon: '📚', type: 'plugin skill', source: 'marketplace', plugin: 'claude-md-management', category: 'Claude Code',
    description: "Save this session's learnings to CLAUDE.md.",
    intents: ['update claude md', 'save learnings', 'remember this'],
    needs: [{ kind: 'command', name: 'claude-md-management:revise-claude-md' }],
    exec: { via: 'command', command: 'claude-md-management:revise-claude-md' },
    steps: ['Collect the learnings', 'Propose edits to CLAUDE.md'],
    stage: 'report',
  },
  {
    id: 'automation-recommender', name: 'Recommend Automations', icon: '🤖', type: 'plugin skill', source: 'marketplace', plugin: 'claude-code-setup', category: 'Claude Code',
    description: 'Suggest hooks, skills and agents that would help this codebase.',
    intents: ['automate', 'recommend', 'improve my setup'],
    needs: [{ kind: 'command', name: 'claude-code-setup:claude-automation-recommender' }],
    exec: { via: 'command', command: 'claude-code-setup:claude-automation-recommender' },
    steps: ['Analyse the codebase', 'Recommend automations'],
  },
  {
    id: 'create-plugin', name: 'Create a Plugin', icon: '🧩', type: 'plugin skill', source: 'marketplace', plugin: 'plugin-dev', category: 'Claude Code',
    description: 'Guided plugin creation with validation.',
    intents: ['make a plugin', 'create plugin', 'new plugin'],
    needs: [{ kind: 'command', name: 'plugin-dev:create-plugin' }],
    exec: { via: 'command', command: 'plugin-dev:create-plugin' },
    steps: ['Design the plugin with you', 'Build and validate it'],
  },
  {
    id: 'skill-creator', name: 'Create a Skill', icon: '✨', type: 'plugin skill', source: 'marketplace', plugin: 'skill-creator', category: 'Claude Code',
    description: 'Create, improve and evaluate skills.',
    intents: ['make a skill', 'create skill', 'new skill'],
    needs: [{ kind: 'command', name: 'skill-creator:skill-creator' }],
    exec: { via: 'command', command: 'skill-creator:skill-creator' },
    steps: ['Draft the skill with you', 'Test and refine it'],
  },
  {
    id: 'remember', name: 'Save Session State', icon: '💾', type: 'plugin skill', source: 'marketplace', plugin: 'remember', category: 'Claude Code',
    description: 'Save where you are so the next session continues cleanly.',
    intents: ['save session', 'remember where i am', 'pick up later'],
    needs: [{ kind: 'command', name: 'remember:remember' }],
    exec: { via: 'command', command: 'remember:remember' },
    steps: ['Summarise the session into the remember logs'],
  },
  // Account plugins
  {
    id: 'debug', name: 'Debug', icon: '🐞', type: 'plugin skill', source: 'account', plugin: 'engineering', category: 'Debug',
    description: 'Structured debugging: reproduce, isolate, diagnose, fix.',
    intents: ['debug', 'fix a bug', 'something is broken', 'error', 'not working', 'it crashed'],
    needs: [{ kind: 'command', name: 'engineering:debug' }],
    exec: { via: 'command', command: 'engineering:debug' },
    steps: ['Reproduce the problem', 'Isolate and diagnose it', 'Propose and make the fix'],
    stage: 'build',
  },
  {
    id: 'testing-strategy', name: 'Test Plan', icon: '🧫', type: 'plugin skill', source: 'account', plugin: 'engineering', category: 'Test',
    description: 'Decide what tests a change needs.',
    intents: ['test plan', 'what tests', 'testing strategy'],
    needs: [{ kind: 'command', name: 'engineering:testing-strategy' }],
    exec: { via: 'command', command: 'engineering:testing-strategy' },
    steps: ['Look at the change', 'Propose the tests it needs'],
    stage: 'plan',
  },
  {
    id: 'deploy-checklist', name: 'Release Checklist', icon: '✅', type: 'plugin skill', source: 'account', plugin: 'engineering', category: 'Ship',
    description: 'Pre-release checklist with rollback plan.',
    intents: ['release checklist', 'before production', 'rollback plan'],
    needs: [{ kind: 'command', name: 'engineering:deploy-checklist' }],
    exec: { via: 'command', command: 'engineering:deploy-checklist' },
    steps: ['Walk through the release checklist', 'Record rollback triggers'],
    stage: 'ship',
  },
  {
    id: 'tech-debt', name: 'Tech Debt Audit', icon: '🧱', type: 'plugin skill', source: 'account', plugin: 'engineering', category: 'Review',
    description: 'Find and prioritise technical debt.',
    intents: ['tech debt', 'what should we refactor', 'code health'],
    needs: [{ kind: 'command', name: 'engineering:tech-debt' }],
    exec: { via: 'command', command: 'engineering:tech-debt' },
    steps: ['Survey the codebase', 'Rank the debt by impact'],
  },
  {
    id: 'qodo-review', name: 'Qodo Pre-PR Review', icon: '🔎', type: 'plugin skill', source: 'account', plugin: 'qodo', category: 'Review',
    description: "Send your local diff and its context to Qodo's review engine.",
    intents: ['qodo', 'pre pr review', 'review before push'],
    needs: [
      { kind: 'command', name: 'qodo:qodo-review' },
      { kind: 'cli', name: 'qodo', fix: { label: '⚡ Set up now', exec: { via: 'command', command: 'qodo:qodo-setup' }, note: 'Installs the Qodo CLI and signs in; it asks before each step.' } },
    ],
    exec: { via: 'command', command: 'qodo:qodo-review' },
    steps: ['Send your local diff and context to Qodo', 'Evaluate the findings with you'],
    stage: 'review',
  },
]

export const QUICK_ACTIONS: { label: string; icon: string; cap: string }[] = [
  { label: 'Build', icon: '🏗', cap: 'next-part' },
  { label: 'Debug', icon: '🐞', cap: 'debug' },
  { label: 'Review', icon: '🔍', cap: 'code-review' },
  { label: 'Test', icon: '🧪', cap: 'run-tests' },
  { label: 'Secure', icon: '🔒', cap: 'claude-security' },
  { label: 'Ship', icon: '🚀', cap: 'ship-check' },
]

export const STAGES: { id: Stage; title: string; primary: string }[] = [
  { id: 'brief', title: 'Brief', primary: 'handoff' },
  { id: 'plan', title: 'Plan', primary: 'feature-dev' },
  { id: 'build', title: 'Build', primary: 'next-part' },
  { id: 'review', title: 'Review', primary: 'code-review' },
  { id: 'ship', title: 'Ship', primary: 'ship-check' },
  { id: 'report', title: 'Report', primary: 'manager-update' },
]

// ---------------------------------------------------------------- workflows

export const WORKFLOWS: Workflow[] = [
  {
    id: 'full-stack', name: 'Full-Stack Feature', icon: '🧱',
    description: 'From design to a deployed preview, with review and security on the way.',
    intents: ['full stack', 'new feature', 'build a feature end to end'],
    ask: 'Feature to build: ',
    steps: [
      { cap: 'frontend-design', why: 'design the interface' },
      { cap: 'feature-dev', why: 'plan the architecture' },
      { cap: 'prisma', why: 'check the database changes' },
      { cap: 'auth0', why: 'cover sign-in, if the feature needs it' },
      { cap: 'resend', why: 'cover email, if the feature sends any' },
      { cap: 'code-review', why: 'review the change' },
      { cap: 'claude-security', why: 'check it for security issues' },
      { cap: 'ship-check', why: 'check and deploy a preview' },
    ],
  },
  {
    id: 'plan-first', name: 'Plan, Build, Check', icon: '🐟',
    description: 'Review the plan with fresh eyes, build it, then check the code and the screens against it before shipping.',
    intents: ['plan first', 'spec first', 'build from the plan', 'build it properly'],
    steps: [
      { cap: 'goldfish-review', why: 'catch gaps in the plan while they are cheap' },
      { cap: 'next-part', why: 'build it' },
      { cap: 'drift-check', why: 'check the code still matches the plan' },
      { cap: 'qa', why: 'click through the screens the way a person would' },
      { cap: 'ship-check', why: 'ship only once both checks are clean' },
    ],
  },
  {
    id: 'ship-safely', name: 'Security + Ship', icon: '🚀',
    description: 'Review, security-check and ship what is already built.',
    intents: ['ship safely', 'security and ship', 'release safely', 'deploy my app'],
    steps: [
      { cap: 'code-review', why: 'catch bugs' },
      { cap: 'security-review', why: 'catch security issues' },
      { cap: 'run-tests', why: 'make sure the tests pass' },
      { cap: 'ship-check', why: 'check and deploy a preview' },
    ],
  },
  {
    id: 'fix-bug', name: 'Fix a Bug', icon: '🐞',
    description: 'Reproduce, fix, test and review a bug.',
    intents: ['fix a bug', 'something is broken', 'bug'],
    ask: 'What is going wrong: ',
    steps: [
      { cap: 'debug', why: 'reproduce and diagnose' },
      { cap: 'run-tests', why: 'prove the fix' },
      { cap: 'code-review', why: 'review the fix' },
    ],
  },
  {
    id: 'polish-ui', name: 'Polish the UI', icon: '🎨',
    description: 'Improve how a page looks and feels, then tidy and review.',
    intents: ['make this ui better', 'polish', 'redesign'],
    ask: 'Page or component to polish: ',
    steps: [
      { cap: 'frontend-design', why: 'redesign it' },
      { cap: 'web-guidance', why: 'apply current best practice' },
      { cap: 'simplify', why: 'tidy the code' },
      { cap: 'code-review', why: 'review the result' },
    ],
  },
  {
    id: 'continue', name: 'Continue My Project', icon: '🔄',
    description: 'Pick up the handoff, then build the next part.',
    intents: ['continue my project', 'carry on', 'pick up where i left off'],
    steps: [
      { cap: 'handoff', why: 'read what was agreed' },
      { cap: 'next-part', why: 'build the next part' },
    ],
  },
  {
    id: 'wrap-week', name: 'Wrap Up the Week', icon: '📅',
    description: 'Write the manager update, save learnings, look for repeated work.',
    intents: ['end of week', 'wrap up', 'friday'],
    steps: [
      { cap: 'manager-update', why: 'write the update' },
      { cap: 'revise-claude-md', why: 'save what was learned' },
      { cap: 'learn-skills', why: 'look for tasks worth automating' },
    ],
  },
]

// ---------------------------------------------------------------- plugins

export type PluginInfo = {
  /** As `claude plugin list` names it, or the prefix account plugins use. */
  id: string
  name: string
  category: 'Toolkit' | 'Development' | 'Web / Deployment' | 'Claude Code' | 'Account' | 'Output styles'
  description: string
  mcp?: { server: string; label: string; optional?: boolean }[]
  cli?: { name: string; fix?: Fix }
  /** Account plugins come from claude.ai: present when their commands are. */
  account?: string
}

const OFFICIAL = '@claude-plugins-official'
const TOOLKIT = '@my-toolkit'

export const PLUGINS: PluginInfo[] = [
  { id: `secret-shield${TOOLKIT}`, name: 'secret-shield', category: 'Toolkit', description: 'Hides secrets you paste; scrubs old transcripts.' },
  { id: `token-weather${TOOLKIT}`, name: 'token-weather', category: 'Toolkit', description: 'Context and usage forecast above the prompt.' },
  { id: `nudges${TOOLKIT}`, name: 'nudges', category: 'Toolkit', description: 'One-click suggestions at the right moment.' },
  { id: `deploy-status${TOOLKIT}`, name: 'deploy-status', category: 'Toolkit', description: 'Latest Vercel deployments in the status line.' },
  { id: `handoff${TOOLKIT}`, name: 'handoff', category: 'Toolkit', description: 'Picks up the Cowork handoff.' },
  { id: `learner${TOOLKIT}`, name: 'learner', category: 'Toolkit', description: 'Proposes skills for repeated tasks.' },
  { id: `control-center${TOOLKIT}`, name: 'control-center', category: 'Toolkit', description: 'This Control Center.' },
  { id: `feature-dev${OFFICIAL}`, name: 'feature-dev', category: 'Development', description: 'Guided feature development with explorer, architect and reviewer agents.' },
  { id: `pr-review-toolkit${OFFICIAL}`, name: 'pr-review-toolkit', category: 'Development', description: 'Six specialist review agents.' },
  { id: `code-review${OFFICIAL}`, name: 'code-review', category: 'Development', description: 'Multi-agent pull request review.' },
  { id: `code-simplifier${OFFICIAL}`, name: 'code-simplifier', category: 'Development', description: 'Agent that tidies recent code.' },
  { id: `claude-security${OFFICIAL}`, name: 'claude-security', category: 'Development', description: 'Deep vulnerability scanning with verified patches.' },
  { id: `vercel${OFFICIAL}`, name: 'vercel', category: 'Web / Deployment', description: 'Deploy, env vars, status and Next.js guides.', mcp: [{ server: 'plugin:vercel:vercel', label: 'Vercel', optional: true }], cli: { name: 'vercel', fix: { label: '⚙ Set up Vercel CLI', exec: { via: 'prompt', text: 'Help me install the Vercel CLI and link this project. I will run the login step myself.' } } } },
  { id: `cloudflare${OFFICIAL}`, name: 'cloudflare', category: 'Web / Deployment', description: 'Workers, Wrangler, Durable Objects.', mcp: [{ server: 'plugin:cloudflare:cloudflare', label: 'Cloudflare' }] },
  { id: `prisma${OFFICIAL}`, name: 'prisma', category: 'Web / Deployment', description: 'Prisma Postgres, migrations, queries.', mcp: [{ server: 'plugin:prisma:Prisma-Local', label: 'Prisma (local)' }, { server: 'plugin:prisma:Prisma-Remote', label: 'Prisma (remote)', optional: true }] },
  { id: `auth0${OFFICIAL}`, name: 'auth0', category: 'Web / Deployment', description: 'Login, MFA, SSO and roles.' },
  { id: `resend${OFFICIAL}`, name: 'resend', category: 'Web / Deployment', description: 'Email sending and React Email.', mcp: [{ server: 'plugin:resend:resend', label: 'Resend' }] },
  { id: `frontend-design${OFFICIAL}`, name: 'frontend-design', category: 'Web / Deployment', description: 'Distinctive interface design.' },
  { id: `modern-web-guidance${OFFICIAL}`, name: 'modern-web-guidance', category: 'Web / Deployment', description: 'Current web best practices.' },
  { id: `figma${OFFICIAL}`, name: 'figma', category: 'Web / Deployment', description: 'Figma designs to code and back.', mcp: [{ server: 'plugin:figma:figma', label: 'Figma' }] },
  { id: `zyte-web-data${OFFICIAL}`, name: 'zyte-web-data', category: 'Web / Deployment', description: 'Web scraping with Scrapy.' },
  { id: `plugin-dev${OFFICIAL}`, name: 'plugin-dev', category: 'Claude Code', description: 'Guides for building plugins.' },
  { id: `skill-creator${OFFICIAL}`, name: 'skill-creator', category: 'Claude Code', description: 'Create and evaluate skills.' },
  { id: `claude-md-management${OFFICIAL}`, name: 'claude-md-management', category: 'Claude Code', description: 'Keep CLAUDE.md files current.' },
  { id: `claude-code-setup${OFFICIAL}`, name: 'claude-code-setup', category: 'Claude Code', description: 'Recommends automations for a codebase.' },
  { id: `remember${OFFICIAL}`, name: 'remember', category: 'Claude Code', description: 'Daily session logs in .remember/ (runs Haiku in the background).' },
  { id: `project-artifact${OFFICIAL}`, name: 'project-artifact', category: 'Claude Code', description: 'Shareable project status page.' },
  { id: `desktop-commander${OFFICIAL}`, name: 'desktop-commander', category: 'Claude Code', description: 'Terminal and file tools (mostly duplicates built-ins).', mcp: [{ server: 'plugin:desktop-commander:desktop-commander', label: 'Desktop Commander' }] },
  { id: 'engineering', name: 'engineering', category: 'Account', account: 'engineering', description: 'Debug, testing strategy, deploy checklist, standups, tech debt and more.' },
  { id: 'qodo', name: 'qodo', category: 'Account', account: 'qodo', description: 'Pre-PR review and codebase questions through the Qodo CLI.', cli: { name: 'qodo', fix: { label: '⚡ Set up now', exec: { via: 'command', command: 'qodo:qodo-setup' } } } },
  { id: 'anthropic-skills', name: 'anthropic-skills', category: 'Account', account: 'anthropic-skills', description: 'Word, PDF, PowerPoint, Excel, Google Workspace and more.' },
  { id: `learning-output-style${OFFICIAL}`, name: 'learning-output-style', category: 'Output styles', description: 'Stops at decision points to ask you to write code.' },
  { id: `explanatory-output-style${OFFICIAL}`, name: 'explanatory-output-style', category: 'Output styles', description: 'Adds "★ Insight" teaching notes.' },
]

export const OUTPUT_STYLE_PLUGINS = {
  learning: `learning-output-style${OFFICIAL}`,
  explanatory: `explanatory-output-style${OFFICIAL}`,
} as const

// ---------------------------------------------------------------- status

export type Level = 'ready' | 'attention' | 'setup' | 'signin' | 'connection' | 'error' | 'info' | 'disabled'

export type Problem = { level: Level; text: string; fix?: Fix; /** Which of the capability's needs it is about. */ need?: number }

export type Status = { level: Level; label: string; problems: Problem[]; checking: boolean }

export const LEVEL_ICON: Record<Level, string> = {
  ready: '🟢',
  attention: '🟡',
  setup: '🟡',
  signin: '🟡',
  connection: '🟠',
  error: '🔴',
  info: '🔵',
  disabled: '⚪',
}

export const LEVEL_LABEL: Record<Level, string> = {
  ready: 'READY',
  attention: 'NEEDS ATTENTION',
  setup: 'SETUP REQUIRED',
  signin: 'SIGN-IN REQUIRED',
  connection: 'CONNECTION ISSUE',
  error: 'ERROR',
  info: 'NOT FOR THIS PROJECT',
  disabled: 'DISABLED',
}

const SEVERITY: Level[] = ['error', 'disabled', 'connection', 'setup', 'signin', 'info', 'attention', 'ready']

function worst(problems: Problem[]): Level {
  if (problems.length === 0) return 'ready'
  return SEVERITY.find(l => problems.some(p => p.level === l)) ?? 'ready'
}

const PROJECT_TEXT: Record<string, string> = {
  git: 'Needs a project folder with git.',
  next: 'Needs a Next.js project (package.json with "next").',
  prisma: 'Needs a project that uses Prisma.',
  github: 'Needs a project with a GitHub remote.',
  handoff: 'No handoff in this project yet (.claude/handoff.md).',
}

function mcpProblem(env: Env, server: string, label: string, optional?: boolean): Problem | null {
  const state = env.mcp?.[server]
  if (!state) return null
  if (state.status === 'auth') return { level: optional ? 'attention' : 'signin', text: `${label} isn't signed in.${optional ? ' It still works without the connection.' : ''}`, fix: SIGN_IN(label) }
  if (state.status === 'failed') {
    return {
      level: optional ? 'attention' : 'connection',
      text: `${label} failed to connect${state.detail ? ` (${state.detail})` : ''}.${optional ? ' It still works without the connection.' : ''}`,
      fix: { label: '⚙ Fix connection', exec: { via: 'prompt', text: `Diagnose why the "${server}" MCP server fails to connect${state.detail ? ` (${state.detail})` : ''} and tell me how to fix it. Don't change anything yet.` } },
    }
  }
  return null
}

export function capabilityStatus(cap: Capability, env: Env): Status {
  const problems: Problem[] = []
  cap.needs.forEach((need, index) => {
    const before = problems.length
    if (need.kind === 'command' && env.commands.length > 0 && !env.commands.includes(need.name)) {
      problems.push({ level: 'disabled', text: `/${need.name} isn't available in this session (plugin not installed or turned off).`, fix: { label: '🧩 Open plugin manager', exec: { via: 'fill', text: '/plugin' } } })
    }
    if (need.kind === 'plugin' && env.plugins && !env.plugins[need.id]?.enabled) {
      problems.push({ level: 'disabled', text: `The ${need.id.split('@')[0]} plugin is ${env.plugins[need.id] ? 'turned off' : 'not installed'}.`, fix: { label: '🧩 Open plugin manager', exec: { via: 'fill', text: '/plugin' } } })
    }
    if (need.kind === 'mcp') {
      const p = mcpProblem(env, need.server, need.label, need.optional)
      if (p) problems.push(p)
    }
    if (need.kind === 'cli' && env.clis[need.name] === false) {
      problems.push({ level: 'setup', text: `The ${need.name} command-line tool isn't installed.`, fix: need.fix })
    }
    if (need.kind === 'project') {
      const p = env.project
      const ok = !p
        ? false
        : need.check === 'git'
          ? p.hasGit
          : need.check === 'next'
            ? p.next
            : need.check === 'prisma'
              ? p.prisma
              : need.check === 'github'
                ? p.github
                : p.handoff !== null
      if (!ok) problems.push({ level: 'info', text: PROJECT_TEXT[need.check] })
    }
    for (let i = before; i < problems.length; i++) problems[i].need = index
  })
  const level = worst(problems)
  const checking = env.checkedAt === null || (cap.needs.some(n => n.kind === 'mcp') && env.mcp === null)
  return { level, label: LEVEL_LABEL[level], problems, checking }
}

export function pluginStatus(info: PluginInfo, env: Env): Status & { version: string | null; installed: boolean } {
  const problems: Problem[] = []
  let version: string | null = null
  let installed = true
  if (info.account) {
    installed = env.commands.some(c => c.startsWith(`${info.account}:`))
    if (env.commands.length > 0 && !installed) problems.push({ level: 'disabled', text: 'Not offered by your claude.ai account in this session.' })
  } else if (env.plugins) {
    const p = env.plugins[info.id]
    installed = !!p
    version = p?.version ?? null
    if (!p) problems.push({ level: 'disabled', text: 'Not installed.', fix: { label: '🧩 Open plugin manager', exec: { via: 'fill', text: '/plugin' } } })
    else if (!p.enabled) problems.push({ level: 'disabled', text: 'Installed but turned off.', fix: { label: '🧩 Open plugin manager', exec: { via: 'fill', text: '/plugin' } } })
  }
  for (const m of info.mcp ?? []) {
    const p = mcpProblem(env, m.server, m.label, m.optional)
    if (p) problems.push(p)
  }
  if (info.cli && env.clis[info.cli.name] === false) problems.push({ level: 'setup', text: `The ${info.cli.name} command-line tool isn't installed.`, fix: info.cli.fix })
  const level = worst(problems)
  return { level, label: LEVEL_LABEL[level], problems, checking: env.plugins === null, version, installed }
}

// ---------------------------------------------------------------- search

export type SearchHit =
  | { kind: 'capability'; id: string; score: number }
  | { kind: 'workflow'; id: string; score: number }
  | { kind: 'plugin'; id: string; score: number }

const STOP = new Set(['my', 'the', 'a', 'an', 'to', 'for', 'this', 'it', 'and', 'i', 'me', 'please', 'can', 'you', 'do', 'want', 'claude', 'with', 'of', 'on', 'is'])

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w))

function score(query: string, name: string, description: string, intents: string[], extra = ''): number {
  const q = query.toLowerCase().trim()
  if (!q) return 0
  let total = 0
  for (const phrase of intents) {
    if (q === phrase) total += 12
    else if (q.includes(phrase) || phrase.includes(q)) total += 6
  }
  const hay = words(`${name} ${description} ${intents.join(' ')} ${extra}`)
  for (const w of words(q)) {
    if (words(name).some(n => n.startsWith(w))) total += 4
    else if (hay.some(h => h.startsWith(w) || (w.length > 4 && h.startsWith(w.slice(0, 4))))) total += 2
  }
  return total
}

export function search(query: string, limit = 8): SearchHit[] {
  const hits: SearchHit[] = []
  for (const c of CAPABILITIES) {
    const s = score(query, c.name, c.description, c.intents, `${c.category} ${c.plugin ?? ''} ${c.exec.via === 'command' ? c.exec.command : ''}`)
    if (s > 0) hits.push({ kind: 'capability', id: c.id, score: s })
  }
  for (const w of WORKFLOWS) {
    const s = score(query, w.name, w.description, w.intents)
    if (s > 0) hits.push({ kind: 'workflow', id: w.id, score: s - 1 })
  }
  for (const p of PLUGINS) {
    const s = score(query, p.name, p.description, [])
    if (s > 0) hits.push({ kind: 'plugin', id: p.id, score: s - 2 })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

export const capById = (id: string) => CAPABILITIES.find(c => c.id === id)
export const workflowById = (id: string) => WORKFLOWS.find(w => w.id === id)
export const pluginById = (id: string) => PLUGINS.find(p => p.id === id)

/** The prompt a workflow sends: its steps in order, by skill name, with a check-in between them. */
export function workflowPrompt(w: Workflow, env: Env, goal = ''): string {
  const lines = w.steps.map((s, i) => {
    const cap = capById(s.cap)!
    const st = capabilityStatus(cap, env)
    const how = cap.exec.via === 'command' ? `/${cap.exec.command}` : cap.name
    const skip = st.level === 'ready' || st.level === 'attention' ? '' : ` (skip: ${st.problems[0]?.text ?? st.label})`
    return `${i + 1}. ${how}: ${s.why}${skip}`
  })
  return [
    `Run my "${w.name}" workflow${goal ? ` for: ${goal}` : ''}.`,
    'Use these skills in order, and check in with me between steps:',
    ...lines,
  ].join('\n')
}
