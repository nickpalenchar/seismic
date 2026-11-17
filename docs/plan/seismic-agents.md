# Seismic agents and skills

## Goal

Every agent Seismic runs is defined the same way: a `SeismicAgent` subclass (role, model, skills,
MCPs, tools, prompt, briefing) that assembles an `AgentSpec` and starts it on a runtime. Every skill
is a `SeismicSkill`, built from its `plugin/skills/<dir>/SKILL.md`. Short single-purpose sessions
(the old "pseudo-skills") are `simpleAgents`: plain functions in their own directory. What the
harnesses do with all this stays in `src/server/llms/`.

When the plan is done, the lasting decisions and constraints go into `docs/design/code-organization.md`
and `docs/design.md`, and this doc goes.

## Done

- [x] `src/server/agents` renamed to `src/server/llms` (harnesses, skills, prompts).
- [x] `SeismicAgent` base class (`src/server/agents/seismicAgent.ts`): role, `getModel`, `getPrompt`,
  `getBriefing`, `getSkills`, `getMCPs`, `getTools`, `readOnly`, `toSpec`, `start`.
- [x] `SeismicSkill` (`src/server/agents/skills/seismicSkill.ts`), instances `labels` and `titles`.
- [x] `AgentSpec.skills`; `attachedSkills.ts` (`skillPlugins` for Claude, `skillListing` for Codex and agy),
  called from the harnesses.
- [x] `wish` moved to `src/server/agents/simpleAgents/`.

## Open: skills

- [ ] Instances for `browser`, `demo`, `settings` (`demo.ts` has `DEMO_SKILL`, `DEMO_SKILL_FILE` to replace).
- [ ] One registry of all `SeismicSkill`s; `bundledSkills()` (`skills.ts`) and the Codex/agy listing in
  `llms/harnesses/index.ts` read it instead of scanning the plugin directory.
- [ ] Remove the deprecated `labelsGuide`, `LABELS_SKILL_FILE`, `titlesGuide` once `koordinator.ts` uses
  the skills directly.
- [ ] Decide whether `getInstructions()` is embedded in the binary (Bun text import) or stays read from
  the resources directory. Skills with scripts (`browser/lib`, `demo/lib`) need real files either way.

## Open: simple agents

- [ ] `tagProposal`, `workRetro`, `codeReview` and the label helpers (`labelParams`, `labelsFrom`,
  `labelWords`) move from `llms/skills/` to `agents/simpleAgents/`; `llms/skills/` is then deleted.
- [ ] `readSession` leaves `koordinator.ts` (used by `tagProposal`, `workRetro`) for a shared one-shot
  session helper under `agents/`.
- [ ] `codeReview` and `workRetro` split into a service (board state, counters, owner decisions; the
  pure review-item functions to `core/`) and the agent sessions they start. `codeReview` imports
  `DueRestart` from `workers.ts`, the wrong direction.
- [ ] Inline prompts (`tagProposal`'s `system()` and `brief()`, `wish`'s `brief()`) into `llms/prompts/`
  (one prompt per file).
- [ ] `osName` in `wish.ts` duplicates the platform names of `ui/views/setup/setup.tsx`; one helper in
  `core/` (the plugin's copy in `plugin/skills/demo/lib/setup.ts` stays, the plugin is portable).

## Open: the worker as a `SeismicAgent`

`launch()` in `workers.ts` builds the worker's spec by hand. To make it a `SeismicAgent`:

- [ ] Hooks on `SeismicAgent` for the spec fields it does not set yet, each defaulting to nothing:
  `at`, `dirs`, `untrusted` and `claudeHeld` and `codexConfig` (the trust flags), `env`, `contextUpdate`,
  `askOwner`, `watch`, `autoReview`, `onLimit`, images. (`permissionMode` is not one of them: see below.)
- [ ] A context type for a run: card id, the card's row, `live` state, the pinned setting.
- [ ] `SeismicWorker` that gets its `system`, `tools`, `briefing` and `contextUpdate` from `Workers`
  (through callbacks or by making them public), and `launch()` calling `worker.start(...)`.
- [ ] `getSkills()` of the worker returns all five skills, replacing `plugins: [SEISMIC_PLUGIN]`.
- [ ] Move the prompt and tool code out of `workers.ts` into `agents/worker/` (this is workstream W4 of
  `docs/plan/server-layers.md`).
- [ ] The same for the other agents (`review`, `koordinator`, `explorer`, `chores`) after the worker.

## Permission mode

`--permission-mode` (default `auto`) is one value for the whole server, copied into the spec by six
classes (`Workers`, `Answers`, `Ahead`, `Advisor`, `Explorers`, `PlanAgents`, via `project.ts`).

Done: `AgentPermission` (`inherit | auto | ask | readOnly`, `agents/types.ts`), `SeismicAgent.getPermissionMode()`,
`AgentSpec.permission`, and the harnesses reading it through `agents/permission.ts` (`readOnlyRun`,
`autoReviewRun`, `claudeMode`) beside the older spec fields.

Mapping: `auto` is Claude's `auto` (classifier), Codex's `auto_review`, and on agy sandbox plus skipped
permissions (agy's own `--mode auto` is not available on every account: checked on 2026-11-16, it is
not on the owner's, so it is not used); `ask` is Claude's `default`, Codex's user approvals, dropped on
agy (headless, nobody answers); `readOnly` is `dontAsk` plus the read-only tool list, Codex's
`read-only` sandbox with `never` approvals, agy's `READ_ONLY_PERMISSIONS`.

- [ ] Callers set `readOnly: true`, `autoReview` and `permissionMode` on specs by hand (`commands.ts`,
  `koordinator.ts`, `codeReview.ts`, `wish.ts`, `workers.ts` and the other five); each moves to
  `getPermissionMode()` with its agent, then the old fields go.
- [ ] A runtime wrapper in `runtime.ts` (beside `withAgentSetting`) that resolves `inherit` from the
  server's flag, replacing the six copies. Sessions that never passed the flag get `auto` today,
  whatever the flag says: decide whether the wrapper changes that.
- [ ] `portable()` in `llms/harnesses/index.ts` still throws for Claude mode names Codex cannot apply;
  with neutral values nothing is left to refuse.
- [ ] agy's own Auto mode (`--mode auto`) where an account has it, detected by the warning on start;
  a static allow list (like `READ_ONLY_PERMISSIONS`) as the fallback if skipping permissions is too loose.

## Open: other

- [ ] `getMCPs()`: a class for MCP servers in place of the placeholder `AgentMcp` type; how the harnesses
  attach them (Claude, Codex, `agyMcp.ts`).
- [ ] Per-skill restriction: Claude loads a whole plugin, so an agent cannot be limited to some skills
  on that path; the prompt listing can. Decide whether that gap matters.
