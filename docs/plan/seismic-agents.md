# Seismic agents and skills

## Goal

Every agent Seismic runs is defined the same way: a `SeismicAgent` subclass (role, model, skills,
MCPs, tools, prompt, briefing) that assembles an `AgentSpec` and starts it on a runtime. Every skill
is a `SeismicSkill`, built from its `plugin/skills/<dir>/SKILL.md`. Short single-purpose sessions
(the old "pseudo-skills") are agent jobs, `agentJobs`: plain functions in their own directory. What the
harnesses do with all this stays in `src/server/llms/`.

When the plan is done, the lasting decisions and constraints go into `docs/design/code-organization.md`
and `docs/design.md`, and this doc goes.

## Done

- [x] `src/server/agents` renamed to `src/server/llms` (harnesses, skills, prompts).
- [x] `SeismicAgent` base class (`src/server/llms/agents/seismicAgent.ts`): role, `getModel`, `getPrompt`,
  `getBriefing`, `getSkills`, `getMCPs`, `getTools`, `readOnly`, `toSpec`, `start`.
- [x] `SeismicSkill` (`src/server/llms/skills/seismicSkill.ts`), instances `labels` and `titles`.
- [x] `AgentSpec.skills`; `attachedSkills.ts` (`skillPlugins` for Claude, `skillListing` for Codex and agy),
  called from the harnesses.
- [x] `wish` moved to `src/server/llms/agents/agentJobs/`.

## Open: skills

- [x] Instances for `browser`, `demo`, `settings` (`demo.ts` still has `DEMO_SKILL`, `DEMO_SKILL_FILE`; they can use `demoSkill` once their callers move).
- [x] One registry (`skills/registry.ts`, an explicit list of the instances; a test fails when a plugin
  folder has none); `project.ts` and the Codex/agy listing in `llms/harnesses/index.ts` read it.
- [ ] Remove the deprecated `labelsGuide`, `LABELS_SKILL_FILE`, `titlesGuide` once `koordinator.ts` uses
  the skills directly.
- [ ] Decide whether `getInstructions()` is embedded in the binary (Bun text import) or stays read from
  the resources directory. Skills with scripts (`browser/lib`, `demo/lib`) need real files either way.

## Open: agent jobs

- [x] `readSession` (`llms/agents/agentJobs/readSession.ts`) left `koordinator.ts`; `tagProposal` and `workRetro`
  moved to `llms/agents/agentJobs/`.
- [x] The agent jobs are classes: `SeismicJob` (`llms/agents/seismicJob.ts`: read-only, role `chores`, the `finish`
  handshake, `run()` settling with the error that ended it) for `tagProposal` (`TagProposalSession`) and `workRetro`
  (`FrictionNotesSession`, `RetroSession`); `wish` (`WishSession`) extends `SeismicAgent` since it settles on its own
  timeout and usage-limit hook. A job is built per run, so its tools keep their state in fields.
- [x] A job names the role it runs under (`role` on the subclass: `chores` by default, `koordinator` for the
  Koordinator's own one-shots) and what it needs of its model (`needs`, `AgentNeeds`: `{ images: 'optional' | 'required' }`).
  The spec carries it (`AgentSpec.needs`) and the harness that knows the model enforces it: Codex, whose model list
  names its input types, leaves optional screenshots out and tells the session, and fails a required need with an
  error naming it; agy and Claude do not report a model's input types, so they pass images through as before.
  The agents' next need is added only when a job really lacks it; settings could warn the owner of a role whose model
  lacks what a job needs.
- [ ] The Koordinator's sessions in `koordinator.ts`, `merges.ts`, `revisions.ts` and `share.ts` still call
  `readSession` directly; they become jobs (then `readSession.ts` goes). Done: card naming (`agentJobs/cardName.ts`) and
  the labels at a card's start (`cardLabels.ts`), their prompts in `llms/prompts/` (`nameSystem.ts`, `labelsSystem.ts`).
  Left: the plan's dependencies, the retrospective, the learner, the two duplicate and schedule turns in `koordinator.ts`,
  `merges.ts`, `revisions.ts`, and the two in `share.ts`.
- [ ] Later, once an agent has jobs: `SeismicAgent.runJob(job)` so the agent that runs a job is chosen apart from the job
  (the job names a default); `delegateJob` between agents when something needs subagents. Tools are fixed when a session
  starts in all three harnesses, so a job always opens a session of its own.
- [x] The code review's agent session is `ReviewerAgent` (`llms/agents/review/reviewerAgent.ts`: role `review`,
  read-only, the `review` tool, the brief); `CodeReviews` (`workerSupervisor/codeReview.ts`) stays the service that
  decides when it runs and hands in the card's state as the context.
- [ ] The label helpers (`labelParams`, `labelsFrom`, `labelWords`, in `llms/skills/`) are the Koordinator's
  and move with it.
- [ ] `codeReview` and `workRetro` split further into a service (board state, counters, owner decisions; the
  pure review-item functions to `core/`) and the agent sessions they start; the sessions are agents already.
- [ ] Inline prompts (`tagProposal`'s `system()` and `brief()`, `wish`'s `brief()`) into `llms/prompts/`
  (one prompt per file).
- [ ] `osName` in `wish.ts` duplicates the platform names of `ui/views/setup/setup.tsx`; one helper in
  `core/` (the plugin's copy in `plugin/skills/demo/lib/setup.ts` stays, the plugin is portable).

## The worker as a `SeismicAgent`

Done: `WorkerAgent` (`agents/worker/workerAgent.ts`) defines the worker's role, model, skills (all five)
and permission; `launch()` in `workerSupervisor/workerSupervisor.ts` starts it with `workerAgent.start(...)`. `SeismicAgent` gained
`getSessionOptions()` (`at`, `dirs`, `untrusted`, `env`, `contextUpdate`, `askOwner`, `watch`) and
`AgentRun.images`.

- [x] The worker's system prompt (`agents/worker/systemPrompt.ts`), tools (`tools.ts`) and briefing (`briefing.ts`:
  `workerBriefing` with the review, folder and prototype variants) moved out of `workerSupervisor/workerSupervisor.ts`; `WorkerAgent`
  calls them with the card's state (`WorkerContext`). They reach `WorkerSupervisor` through `WorkerHost` and `BriefingHost`,
  `Pick`s of the members they use, which are public now (about 40 methods plus `o`, `live`, `folder`, `shares`).
  The constants and helpers they share with `workerSupervisor/workerSupervisor.ts` (`END_TURN`, `landedOf`, `snoozedUntil`, the proposal
  questions and others) are the `WorkerConfig` class (`src/server/worker-config.ts`, one default instance `workerConfig`, to be injected
  later); `agents/worker/*` import `workerSupervisor/workerSupervisor.ts` for types only.
- [x] The parts of the worker's `contextUpdate` (`agents/worker/contextUpdate.ts`: the owner's words that waited, the
  demo page's news, preferences, decisions of its plan, a restart or pause still due) are functions of the card's
  state and `WorkerSupervisor` (`ContextHost`); the restart and pause notices and `DueRestart` moved to
  `agents/worker/restartNotices.ts`.
- [ ] `WorkerHost` still lists about 40 members of `WorkerSupervisor` (made public for the moved code); it shrinks once the
  card-state helpers they reach move into their own classes.
- [ ] The trust flags `claudeHeld` and `codexConfig`, `onLimit` and `permissionMode`-like extras of the other
  agents go through `getSessionOptions()` as each agent moves.
- [x] The exploration agent is `ExplorerAgent` (`llms/agents/explorer/`: `systemPrompt.ts`, `tools.ts`, `briefing.ts`
  for a session from scratch, `contextUpdate.ts` for what it hears mid-session, the agent class); `Explorers` hands in
  the idea's state and reaches it through `ExplorerHost`. The messages `Explorers` itself sends (`OPENING*`, `RESUMED`,
  `UNREAD_NOTE`) stay in `explorers.ts` for now; they are prompts and could go to `llms/prompts/`. It has no permission of its
  own (`getPermissionMode()` may return none: the harness follows the owner's mode as before, which for Codex is
  "ask", not its automatic review).
- [ ] The same for the other agents (`koordinator`, `chores`); the Koordinator's briefing and `contextUpdate`
  parts move out the way the explorer's did.

## Permission mode

Done: `AgentPermission` (`ask | acceptEdits | auto | dangerouslyBypassPermissions | readOnly`,
`agents/types.ts`). `--permission-mode` takes the first four (and Claude Code's `default` and
`bypassPermissions` as aliases; `plan` and `dontAsk` are refused at start) and sets the owner's
permission once (`agents/permission.ts`). `SeismicAgent.getPermissionMode()` returns it unless the agent
overrides; `readOnly` is an agent's choice. A spec without a `permission` follows the owner's in the
Claude harness. `AgentSpec.readOnly`, `autoReview` and `permissionMode` and the six classes' copies of the
flag are gone.

Mapping: `ask` is Claude's `default`; `acceptEdits` Claude's `acceptEdits`; `auto` Claude's `auto`
(classifier), Codex's `auto_review`; `dangerouslyBypassPermissions` Claude's `bypassPermissions` (with the
SDK's `allowDangerouslySkipPermissions`), Codex's `danger-full-access` with `never` approvals; `readOnly`
is `dontAsk` plus the read-only tool list, Codex's `read-only` sandbox, agy's `READ_ONLY_PERMISSIONS`.

- [ ] agy runs every mode but `readOnly` as it did: sandbox plus skipped permissions. Its own flags exist
  (`--mode accept-edits`, `--mode auto`; checked on 2026-11-16: `auto` is not available on the owner's
  account) but a headless session has nobody to answer a prompt, so `ask` and `acceptEdits` need a check
  before they map.
- [ ] Codex's `auto` (its automatic review) is the owner's `codexAutoReview` setting, not the flag: a
  Codex session without a permission asks, except under `dangerouslyBypassPermissions`. A `WorkerAgent`
  on Codex has to override `getPermissionMode()` for that.
- [ ] `acceptEdits` on Codex is the same as `ask` (a workspace-write sandbox already lets edits through).

## Open: other

- [ ] `getMCPs()`: a class for MCP servers in place of the placeholder `AgentMcp` type; how the harnesses
  attach them (Claude, Codex, `agyMcp.ts`).
- [ ] Per-skill restriction: Claude loads a whole plugin, so an agent cannot be limited to some skills
  on that path; the prompt listing can. Decide whether that gap matters.
