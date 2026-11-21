# Code Organization

> [!note]
> **WIP** - this represents a future outcome

Code should be organized by **layers**, in which each layer is responsible for
some part of the end-to-end build, from UI to the database (sqlite). A layer
should only be able to respond to the layer directly above it, or talk to
the layer directly below it

## Overview of layers

### Data Layer

- relevant paths: `src/server/schemas/`

The data layer is the database, sqlite3

- sqlite3 is queried by the orm, drizzle
- table design is also managed by drizzle

#### Data Layer Rules

- schema files should only contain query logic (CRUD operations)
- a file name should map directly to a table.
- the file should contain the table schema, basic query operations, and any indexes.

### Service Layer

The service layer represents business logic with regards to models in the data layer. 
It may also represent external services and the communication between them (external service layer)

- relevant paths: `src/server/services`

#### Service Layer Rules

- methods should be named with active verbs, and omit its own name when acting on itself.
    - `Card.findOne()`
    - `Card.deleteOne()`
- methods should name secondary nouns at the end.
    - `Card.moveToProject()`
- methods should take ids first when needed to query.
- Services may have business logic in methods
- Servies that interact with an external service should end its class name with client:
    - `LinearClient`

### Router Layer

Represents endpoints that are registered to the server, which can be called in an API by the frontend.

- relevant paths: `/src/server/routes`

#### Service Layer Rules

- Route files should be in paths that mirror their REST route on the server (omitting path params:
  - `src/server/routes/card/activity.ts` might hold routes like `/card/:id/activity`
- Routes should be defined using the base class `HttpRoute`

## Other important modules

Not necesarilly "layers", but important to keep organized nonetheless

- `src/server/auth/` authentication logic
- `src/server/lib/` various helper funcitons
- `src/server/llms/` what Seismic asks of an LLM: agents, skills, prompts, harnesses (see below)
- `src/server/workerSupervisor/` the `WorkerSupervisor`: runs every card's worker session (leasing workstations,
  landing approved work, restarts, the owner's questions). The worker agent itself
  (prompt, tools, briefing) is `llms/agents/worker/`; the supervisor is not an agent.
- `src/server/test/` every test of the server, at the path of the code it tests (`test/workerSupervisor/landing.test.ts`
  tests `workerSupervisor/`), so that same-named tests of two folders don't collide. `test/helpers/` holds what
  tests share (the fake runtime and `gitRepo` in `testing.ts`, the worker supervisor's fixture, the preload
  `setup.ts`, `paths.ts` for reaching the sources and fixtures); `test/fixtures/` the captured data they read.
  Decided 2026-11-21: tests apart from the code, over the earlier colocation.

### LLMs

- `src/server/llms/skills/` the skills Seismic ships. `SeismicSkill` is one skill, built from
  `plugin/skills/<dir>/SKILL.md` (name, description, hint, instructions); `browser.ts`, `demo.ts`, `labels.ts`,
  `settings.ts`, `titles.ts` hold the instances an agent imports, and `registry.ts` lists them all. An agent
  declares its skills once (`getSkills()` → `AgentSpec.skills`) and each harness attaches them its own way
  (`attachedSkills.ts`): Claude loads the plugin, Codex and agy are told the files in the system prompt.
  Not yet moved out into agents: the label and title suggestions, with their tests; the old guide readers there (`labelsGuide`, `titlesGuide`) are deprecated
  for `SeismicSkill.getInstructions()`.
- `src/server/llms/agents/` how Seismic defines its agents (see below).
- `src/server/llms/prompts/` the prompts those skills send, one prompt per file, each file
  exporting one value named like the file (`restartNotice.ts` exports `restartNotice`). A prompt
  that takes parameters (a language, a count) is a function of them, so the file needs nothing
  from the skill that uses it.
- `src/server/llms/harnesses/` the harnesses that run an agent session: `claude.ts` (Claude Agent
  SDK), `codex.ts` with `codexRpc.ts` and `codexExecTools.ts`, `agy.ts` with `agyMcp.ts`, and `index.ts`,
  which picks one for a role. The process bookkeeping they share sits beside them (`processes.ts`,
  `sessionRegistry.ts`, `identity.ts`). The contract they fulfil (`AgentRuntime`, `AgentSpec`) and the
  wrappers around it (limit wait, trust, setting) stay in `src/server/runtime.ts`.
- Files in these directories are named in camelCase.
- Moving existing code in is done a part at a time: `src/server/` still holds skills and prompts
  that have not moved yet.

### Agents (`src/server/llms/agents/`)

- `src/server/llms/agents/seismicAgent.ts` the base class `SeismicAgent`: an agent is a role, a model
  (chosen per run from the role's setting), skills, MCPs, tools and prompts. A subclass per agent
  (worker, review, ...) supplies the pieces; the base class assembles an `AgentSpec` and starts it on
  a runtime from `src/server/llms/harnesses/`.
- `src/server/llms/agents/agentJobs/` the agent jobs: short, single-purpose agent sessions of Seismic's own
  (the wish draft, tag proposals, the work retrospective): a class that extends `SeismicJob`
  (`src/server/llms/agents/seismicJob.ts`: a read-only session of the role `chores` that answers through its tools),
  built per run, with its test. A job's brief is read asynchronously (`getBrief(): Promise<string>`), so a job can read what it needs (git, the board) when it
  starts; the session starts once the brief is read, and a brief that cannot be read ends the job with the error. A job is generic over its result: `run` settles with a `JobResult` (the value its tools collected, or the error that
  ended the session), and what a failure means is the caller's. A job names the role whose model setting it runs under (`chores`, or
  `koordinator` for the Koordinator's own one-shots). An agent or job declares the `capabilities` it needs of its model
  (`{ images: 'optional' }` where it reads screenshots only as a help); the agent checks them against the `SeismicModel`
  the harness resolved (`llms/models/`), before the first turn: a required capability the model's catalog says it lacks ends
  the session, an optional one is left out with a note, and a catalog that does not say is never taken as a no. What is still in
  `src/server/llms/skills/` (label helpers) moves here a part at a time. The code review service
  (`CodeReviews`) is in `src/server/workerSupervisor/`, beside the supervisor that runs it.
- `src/server/llms/agents/types.ts` placeholder types for MCPs until they get a class of their own.

## File header comments

A file's description at the top is a JSDoc block (`/** ... */`), not a run of `//` lines, so editors
show it. This applies to files that move into the new structure (such as `src/server/llms/`);
other files keep theirs until they move.

