# Video lessons: source-grounded working notes

These are principles extracted from the user's supplied transcripts and PDFs. They are learning material, not product documentation and not the user's approved taste. Treat product names, plan access, prices, model tiers, availability, and performance claims as historical examples until checked in current first-party Claude documentation or the current UI.

## Source map

Use the supplied local originals for detail. Page numbers below are the PDF page labels; timestamps are transcript timestamps.

| Source | Topic and useful locations |
|---|---|
| `Ai slop.pdf` | Taste library, references, tools, and iterative web design. pp. 1–2 (0:00–6:55); pp. 3–4 (6:55–9:28); pp. 5–9 (9:28–22:05); pp. 9–10 contain later iteration/review. |
| `graphic design.pdf` | Client brief and code-based motion design. pp. 1–3 (0:00–4:49); pp. 5–8 (6:45–12:25); pp. 9–11 (14:20–19:55). Treat business, price, deadline, and income claims as one creator's case study. |
| `claude mods.pdf` | Claude Code mods: pp. 1–2 (0:00–4:08), pp. 3–4 (4:08–10:01), pp. 5–6 (10:01–12:37). Product availability and usage claims are time-sensitive. |
| `videoplayback (1) (1).pdf` | Cowork workspace and scheduled builder case study: pp. 1–2 (0:00–7:38), pp. 3–7 (7:38–15:22). |
| `videoplayback.mp4` | The same Cowork video (15:23). Re-transcribed locally with Whisper `small` and sampled for on-screen text the PDF lacks: operating instructions 1:10–2:45, PRD and builder routing 3:28–3:40, builder task and folders 12:58–13:38. Sponsor segment 8:06–9:15 ignored. |
| `videoplayback (2) (1).pdf` | Claude Code project setup and features: pp. 1–6 (0:00–12:59), pp. 7–14 (12:59–29:59). The transcript says its feature snapshot was recorded 9 October 2026 and notes that the source is longer than 30 minutes, so this transcript is partial. |
| `videoplayback (3) (1).pdf` | Claude Code techniques: pp. 1–2 (0:00–5:13), pp. 3–6 (5:13 onward). |
| `Claude 2.0.txt` | Desktop Code interface update: nested project sessions 3:08–6:16; side chats and split view 6:43–8:12; artifacts 8:14–10:06; output-style/doctor/advisor/mods 10:08–13:39. |
| `Pasted text(3).txt` | Think-first learning routine, scaffold versus offloading, and the included `think-first` skill. Read the complete attached transcript when teaching from its research claims; the summary below is the workflow distilled from it. |

The MP4 uploads include repeated copies. These notes are grounded in the distinct transcripts/PDFs above, plus the sampled frames of `videoplayback.mp4` listed in the map; do not imply every frame of every raw video was independently transcribed. Ask for captions or a transcript when a future video has no readable companion source.

## Lessons to use

### 1. Keep the user's thinking in the loop

**Source:** `Pasted text(3).txt`, sections on fast/slow thinking and the four-step routine.

- For a meaningful decision, invite the user to write their own first thought, draft, or preference before Claude supplies a polished answer. Keep this brief; do not make routine work cumbersome.
- Test that first thought with a few useful challenges: the weakest assumption, the least-supported point, and one question that could change the decision.
- Let the user decide and name the reason. Draft or build after that decision, retaining the user's language where it helps.
- Treat AI as a scaffold for practice, comparison, and critique. Avoid quietly taking over the judgment the user wants to develop.
- The cited survey in the transcript reports associations, not proof of causation. Do not present its findings as settled causal science.
- Offer a short explanation of a reusable choice or correction after the work. Ask before saving a repeated preference.

**Try and check:** On one real decision, capture the user's first instinct, compare it with Claude's critique, then ask whether the result left the user more able to explain and repeat the reasoning.

### 2. Start with a clear brief and right-sized plan

**Sources:** `videoplayback (2) (1).pdf`, pp. 3–8; `videoplayback (3) (1).pdf`, pp. 4–5; Cowork case study `videoplayback (1) (1).pdf`, pp. 1–2.

- Before substantial work, establish the intended outcome, audience, constraints, known decisions, and how success will be checked. Ask targeted questions instead of guessing.
- Use Plan mode for multi-step, costly-to-reverse, or ambiguous work. Review scope, file/data access, dependencies, risks, and acceptance criteria before building.
- Keep small, clear requests direct. Do not wrap every task in a PRD or a long discovery interview.
- Set a checkpoint after the plan and before execution. For significant work, report progress and verify the result against the agreed criteria.
- In Cowork, a written PRD, open questions, and explicit sign-off helped the creator keep a large build aligned. Apply the governance pattern; do not copy their investment dashboards, provider setup, or overnight autonomous builder without a user need.
- Keep changes reversible where practical. Ask before destructive changes, publishing, external messages, purchases, credentials, or broad permission changes.

The creator's on-screen operating instructions (`videoplayback.mp4`, 1:10–2:45) add four habits the spoken transcript only summarises:

- **Check what exists before building.** Before proposing a custom build, look at loaded skills, connectors, plugins, existing scripts, and earlier PRDs or projects (1:10).
- **Name contradictions.** When a request conflicts with something already on file, say so and ask how to reconcile, instead of silently overwriting (2:10).
- **Use a routine for destructive actions.** List the specific items affected, note what is irreversible, ask to proceed, wait for an explicit yes, and dry-run first where possible (2:30).
- **Re-interview on change.** When the user says things have changed, ask what changed before continuing on the old plan (2:40).

Her instructions say "PRD first. Always." and push back once if she tries to skip it. That is one person's setup for frequent large builds; keep the right-sized approach above unless the user decides otherwise.

**Try and check:** For the next substantial project, approve a one-page brief and plan before implementation. Check whether that prevented rework; shorten it if it did not.

### 3. Manage context and reusable project knowledge

**Sources:** `Claude 2.0.txt`, 3:08–8:12; `videoplayback (2) (1).pdf`, pp. 3, 9–12; `videoplayback (3) (1).pdf`, pp. 2–4.

- Use a Project or project folder for ongoing work that needs shared background. Start separate sessions for distinct tasks when that keeps the conversation focused.
- Keep project instructions short and useful: non-obvious conventions, decisions, commands, and how to find relevant details. Put longer references in focused files and load only what the task needs.
- Preserve a clean handoff or decision note when a phase ends. At the end of a substantive session, summarise what was decided (and why), what was ruled out, what is still open, and the next move, then *offer* to save it; do not save it unasked (`videoplayback.mp4`, 2:20). The creator's instructions also say to take notes "aggressively" without being asked; she later reports her memory "does start bloating" (14:49), which supports offering rather than auto-saving.
- Start a clean context when a long thread has accumulated stale guesses, logs, and repeated corrections.
- Use an available side chat or branch for a review or tangential question when it prevents interrupting the main task. Product labels and availability can change.
- Delegate research only when the task benefits from parallel investigation. Ask for concise findings with sources instead of importing every explored file into the main thread.
- The techniques video gives a 40–60% context-use target as a creator heuristic, not a universal Claude limit. Prioritize relevance and the live context indicator over that number.

**Try and check:** On a multi-step task, keep a short decision/next-steps note and compare a focused fresh session with continuing a stale thread.

### 4. Make creative work specific to the user

**Source:** `Ai slop.pdf`, pp. 1–2 (0:00–6:55), pp. 5–9 (9:28–22:05).

Use four inputs to shape a creative brief:

1. **Aesthetic:** describe the family or feeling in plain words. Use design vocabulary only when it helps the user name what they like.
2. **Reference:** use user-selected screenshots or URLs to communicate mood, proportion, hierarchy, texture, or interaction. Learn from the qualities; do not copy the source's content or distinctive design wholesale.
3. **Intent:** state what is being made, for whom, what they need to understand, and what action they should take.
4. **Guardrails:** record the user's concrete keep/avoid preferences, accessibility needs, brand requirements, and technical constraints.

Build or curate an inspiration library with the user when recurring design work justifies it. Label examples with the user's own reactions and useful vocabulary; do not assume a creator's library, a downloaded screenshot, or an AI-generated image is automatically approved taste.

For a substantial visual exploration, show a small set of distinct directions together so the user can compare them. Refine the selected one in stages: layout and hierarchy, key asset, typography/color, then detail and responsive behavior. Change one or a few explicit variables at a time and inspect the rendered result. Do not apply a fixed “five concepts then three variants” ritual to every task.

Challenge generic patterns across typography, color, spacing, layout, responsiveness, interaction, motion, and UX writing. Avoid replacing one generic recipe with another: do not ban a font, color, gradient, card, or layout unless the user or brand has said so. Ask what feels generic or wrong and use that critique to guide the next pass.

**Try and check:** Give one task a brief with aesthetic, reference, intent, and guardrails. Ask the user to select the direction and name what feels distinctive; check the delivered work against those words.

### 5. Treat motion as story plus craft

**Source:** `graphic design.pdf`, pp. 5–8 (6:45–12:25), pp. 9–11 (14:20–19:55).

- Establish the story before animation. For a launch or explainer, make the scene sequence communicate a clear progression rather than a pile of attractive effects.
- Write a storyboard with each scene's purpose, visible elements, approximate duration, and camera or transition behavior.
- Supply the actual brand assets, type, colors, and UI components when available. Use vectors such as SVG when a composition needs to scale or zoom sharply.
- Define timing and easing deliberately; inspect for overlap, jumps, clipped content, inconsistent type, simultaneous entrances, and confusing camera movement.
- Review the rendered piece scene by scene and revise the specific fault. A prompt or skill does not guarantee a polished first render.
- The video is a creator's paid-project case study. Its earnings, prices, turnaround, client outcome, and comparison with a hired designer are not general evidence about market rates or human-versus-AI quality.

**Try and check:** Storyboard a short motion piece before generating it. Ask a viewer to describe the story after one watch, then verify legibility and timing at the intended playback size.

### 6. Use Claude features and extensions selectively

**Sources:** `videoplayback (2) (1).pdf`, pp. 12–14; `videoplayback (3) (1).pdf`, pp. 5–6; `Claude 2.0.txt`, 10:08–13:39; `claude mods.pdf`.

- Choose a skill when a recurring task needs reusable steps. Keep it focused and load it only when relevant.
- A connector or MCP can provide data or actions; inspect its permissions and whether it can write, send, or publish before connecting it.
- A plugin packages capabilities; a mod changes the Claude Code experience. Prefer the smallest extension that solves a repeated friction point.
- Mods demonstrated in the source: Savvy Progress (work progress), Claude skins (visual styling), You Should Know (surfaces notable details, with an additional model call), FileTree (files being touched), a usage/caching cost warning (transcribed as “Cash Tax”), Blast Radius (review of destructive effects), Reflect (feedback capture), Terminal Browser (preview), and Replay Theater (change replay). Names and availability may vary. Review source, maintenance, permissions, cost, and current compatibility before trying one; don't install based only on the video.
- Use a scheduled task for a stable, bounded routine such as a digest or check. Start with read-only inputs and a dry run. Require review before external or consequential actions. A 30-minute autonomous build queue from a creator's setup is not a default recommendation.
- If a build queue is ever justified, borrow the governance in the creator's builder (`videoplayback.mp4`, 13:08–13:38), not its schedule: the human approves each brief *before* it enters the queue; each run processes one brief and exits silently when none is pending; briefs move through `pending → in-progress → done` or `failed` (with an error log); every run appends to a dated log; a field in the brief routes it to the right runner (3:36). The folders make state visible and a failure recoverable without reading chat history.
- This plugin cannot create or manage Claude Cowork schedules. Apply these as planning principles only; use Cowork's current UI for schedule configuration and keep it under the user's control.
- Use Plan mode, model/effort controls, fast mode, or advisor only when available and appropriate in the current Claude UI. Validate current behavior and usage implications before changing a setting. Do not assume video-era plan access or model names are still current.
- A transcript's product tutorial teaches where a creator found a setting at that time; it does not prove the setting exists in today's Claude Pro plan.

**Try and check:** Before adding an extension or schedule, write down the repeated friction, the exact permission it needs, a no-extension alternative, and what success would look like. Keep it only if it earns its place in actual work.

### 7. Build the data layer before the views

**Source:** `videoplayback.mp4`, 6:23–7:55 (the "lake" analogy); `videoplayback (1) (1).pdf`, pp. 2–3.

- When a project involves several outputs that draw on the same information (a dashboard, a daily brief, a research skill), set up the data first: where each source comes from, where it is stored, and how it stays fresh.
- Treat each output as a view that reads and reshapes that shared data. A dashboard presents it, a brief compiles it, a builder turns a brief into software.
- Building views first tends to give each one its own fetching and its own copy of the truth, and they drift apart.
- This is the creator's framing for a personal-hub build, not a rule for every project. A single small tool can fetch its own data directly.

**Try and check:** Before the next multi-output project, list the data sources and the views separately. Check whether any two views need the same source; if so, give that source one home.

## The user's taste remains the authority

- Read the active profile's approved taste notes when available. Apply only the relevant lines.
- Treat every video-derived design rule as an idea to test, not as a saved personal preference.
- After an iteration, propose a concise preference line only if the user has expressed a clear repeated preference. Route saving through the existing `feedback` skill and its approval flow.
- If the user rejects a direction, correct this task first. Do not promote a single rejection into a universal rule without asking.

## Source handling

These notes paraphrase the supplied materials and cite their locations. The PDF transcripts are attributed to TurboScribe in the files and may contain transcription errors. Check the original clip when exact wording, visual detail, or a claim that depends on context matters. For product specifications and current availability, prefer current official Claude documentation over a video.
