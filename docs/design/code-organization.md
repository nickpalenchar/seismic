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

- a file name should map directly to a table.
- the file should contain the table schema and any indexes. Query operations still in a file move to
  that table's repository (see the Repository Layer).

### Repository Layer

- relevant paths: `src/server/repositories/`

Repositories are the only way to reach a table: a service asks a repository, never the database, and
gets records back (immutable classes, not rows). Decided 2026-11-27, replacing `Store` (deprecated),
which holds every table's query class and the multi-table writes.

#### Repository Layer Rules

- A repository extends `Repository` (`repositories/repository.ts`) and implements `idOf` and the
  `…Uncached` methods (`findUncached`, `createManyUncached`, …); the base class provides `find`,
  `findMany`, `create`, `createMany`, `update`, `updateMany`, `delete`, `deleteMany`, `findOrCreate`
  (a repository whose table can do it atomically overrides it), `uncacheById` and `uncacheAll`.
- The methods are async, though the SQLite driver is not. Repositories share a `DatabaseProvider`
  (`repositories/databaseProvider.ts`: the connection, `orm`, and `transaction`).
  `transaction(async () => …)` runs between BEGIN and COMMIT and settles after the commit (rolled
  back when it rejects); repository calls the function makes, however deep, are inside it (tracked
  with `AsyncLocalStorage`), and a transaction inside one is a savepoint. One is open at a time:
  another waits its turn, and so does any repository call from outside it. A read inside a
  transaction is not cached, and a rollback drops every repository's cache. What a transaction
  awaits should be repository calls and nothing slow: code that still uses `Store`'s connection
  directly is not held back while one is open.
- Reads are cached in memory: 1000 keys for the single records and 1000 for the query results, a
  minute each, the entry used least recently going first. A query's `ids` is a set, so
  `{ ids: [4, 1, 3] }` and `{ ids: [1, 3, 4] }` share an entry, and `findMany` does not promise the order
  of the ids asked for.
- A write evicts the record it touches and every cached query result before it answers. A read
  that began before a write does not refill the cache with what it read, and a failed write drops
  the whole cache. Eviction is synchronous: in-memory eviction costs nothing, and deferring it would
  leave a window where a read sees the old record (rejected: a fire-and-forget eviction).
- Records are shared between callers once cached, so a record is frozen, and `findMany` hands out a
  copy of its list.
- Anything that writes a table without going through its repository leaves a stale cache for up to a
  minute. A table's repository therefore owns all of that table's writes before it caches.
- Where code still writes a table through its old query class (the cards: `Store.cards`, used by the
  board), the query class tells the repository what each write touched, so the cache stays right
  without every call site moving at once (decided 2026-11-27). Reads there go to the database.
- There is one repository of each class per database, because each holds a cache that a second would
  leave stale. `DatabaseProvider.claim` refuses a second; `Store` builds the card and hint repositories,
  and the server hands those to whatever needs them. Nothing calls `new CardRepository` but its owner.
- A route is given what it needs in its own constructor, as the whole object: the card routes take
  `private readonly cardService: CardService` and call `this.cardService.getProjectRuntimeForCard(…)`,
  not a helper on `HttpRoute` and not a field spread onto `this`. `HttpRoute` has no constructor and
  holds no service: the card routes take `CardService`, the routes on a project, group, canvas or chat
  `ProjectService`, the hint routes `HintsService`, the settings, configuration and agent routes
  `ConfigurationService`. A service refuses an unknown thing with `NotFound` itself. `v1Routes` builds
  every route with the one service it names. This is the shape a dependency-injection container
  fills in later (`@inject(CardService)`). Decided 2026-11-27.
- A repository wraps no query class: it is the query class, moved here as its table is converted.
  `schemas/` keeps the table definitions.

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

#### Router Layer Rules

- The API is RESTful and lives under `/api/v1/`, in `src/server/routes/v1/` (decided 2026-11-21).
  A route moved out of `server.ts` gets a RESTful URL there, and its callers in the UI move with it.
- A route's file mirrors its URL: a `:x` segment is a folder `_x`, the last segment is the file,
  and one file holds all the methods of its URL.
  - `PATCH /api/v1/cards/:cardId/share` is `src/server/routes/v1/cards/_cardId/share.ts`.
  - `PATCH /api/v1/cards/:cardId` is `src/server/routes/v1/cards/_cardId.ts`, beside the folder
    `_cardId/` that holds the URLs under it.
  - What is not a change of the resource's own fields is a `POST` to a named action under its URL
    (decided by the owner 2026-11-21): `POST /api/v1/cards/:cardId/restore` undoes a deletion, and
    archive and unarchive go the same way. Rejected: `PATCH { deleted: false }`, which would make the
    card's URL find deleted cards and describe a deletion two ways, and a `deletion` resource to
    `DELETE`, which reads poorly.
  - The owner's system-level settings (decided by the owner 2026-11-21): each saves on its own at
    `PUT /api/v1/settings/:settingName`, named as in `settings.json` (`notifications`, `usageMeter`),
    and `PATCH /api/v1/settings` saves several at once, each as its own URL takes it. A name that is
    no setting refuses the whole patch before anything is saved. The demo settings are one of them
    (`demo`, saved whole), as they live beside `settings.json` (`demo.json`). Rejected: one PATCH for
    the Save sections (Demo settings, the configuration) instead.
  - The configuration (the projects and their repositories, `projects.json`) is its own resource,
    `/api/v1/configuration`, saved whole with `PUT`; the answer has what came of the save and the
    configuration as it then reads. It is no setting: saving it applies to running projects.
  - Chats with Seismic are the resource `/api/v1/chats` (decided 2026-11-25): `POST` makes one on a
    project (`{ project }`), `GET` lists every project's, `PATCH /chats/:chatId` sets its model,
    `POST /chats/:chatId/open` goes back to it and `POST /chats/:chatId/read` marks its answers read,
    `POST /chats/:chatId/exchanges/:exchangeId/unwait` drops a step Seismic waits on a card for, and
    `GET /chats/recent?project=` is the one the panel resumes. A chat's id is global, so its URL
    names the chat alone, like a card's. Sending words stays on `/command`, which voice and the cards'
    fields share.
  - The owner's words to a card are `POST /api/v1/cards/:cardId/message` (its agent, a Question card's
    thread, a review card's decisions) and `POST /api/v1/cards/:cardId/answer` (the question it waits
    on); both answer with `{ card }`. So do the run controls, each a `POST` of its own: `pause`
    (`{ safePoint }`), `resume`, `snooze` (`{ until }`), `wake` and `start-at` (`{ at }`, `null` to clear).
    So do landing and review: `push-main`, `keep-main`, `push-changes`, `fold` (`{ land }`), `edit-held`
    (`{ body }`), `hand-off` (`{ agent }`) and the code review under `code-review` (`POST` starts it, then
    `stop`, `skip` and `items/:itemNumber/reopen`).
    Proposals and ideas follow: `accept`, `unaccept`, `merge`, `dismiss`, `keep`, `revise`, `discuss`,
    `build`, `unbuild`, `park`, `unpark`, `drop`, `prototype`, `discard` and the rest, each a `POST` named
    for the action in kebab-case. So do the rest, so `POST /api/c/:project/cards/:id/act` is gone: `undo`,
    `unsay`, `release`, `name`, `reorder`, `arrange`, the workstation choices (`take-workstation`,
    `keep-workstation`), `ask`, `consult`, `as-idea` and `page-tags`; the demo page's share is `POST` and
    `DELETE` on `/share`, beside the `PATCH` of "Share on approval". The UI sends any of them through
    `actCard` (`src/ui/clients/seismic.ts`).
  - Groups and canvases have global ids, so their URLs name them alone: `POST /api/v1/groups`
    (`{ name, cards }`, on the cards' project), `PATCH` and `DELETE /groups/:groupId`, `POST
    /groups/:groupId/cards` to fill one and `POST /cards/ungroup` to empty cards out of theirs;
    `POST /api/v1/canvases` (`{ project, name }`), `PATCH` and `DELETE /canvases/:canvasId` and `POST
    /canvases/:canvasId/cards`. The owner's arrows are `POST /cards/:cardId/dependencies` (`{ to }`) and
    `DELETE /cards/:cardId/dependencies/:toCardId`. The UI calls them through `seismic.ts`.
  - Params name what they stand for (`:cardId`), never a bare `:id`.
  - A card's URL names the card alone, not its project: the server finds the project from the card
    (`CardService.getProjectRuntimeForCard`), so a call can't go to the wrong project when the page shows another.
  - `src/server/test/routes/v1.test.ts` checks that every file's route is at the URL its path names.
- Routes extend the base class `HttpRoute` (`src/server/routes/httpRoute.ts`), are listed in
  `routes/v1/index.ts`, and get what they need through the constructor.
- A write answers with JSON of the resource the UI keeps (`{ card }` for a card, as the project's
  snapshot shows it), so the page shows the change without waiting for the next snapshot.
- The UI calls them through `src/ui/clients/seismic.ts`, which hands a card it got back to the
  shown project (`cardSaved` in `src/ui/api.ts`). The old calls (`api` in `src/ui/api.ts`) are
  deprecated: new calls go into the client, and a call that moves there leaves `api`.

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
  built per run, with its test. A job is named for what it does, as a verb phrase (`estimateCardScope`, `createCardMergePlan`): its file, its class (`EstimateCardScopeJob`), its function and its `name`; its doc comments say what the whole job does, in the active voice, not what it is.
  The tags a session calls cards by (`K1`…) come from `CardTags` (`agentJobs/cardTags.ts`), which maps them to ids and back. A job's brief is read asynchronously (`getBrief(): Promise<string>`), so a job can read what it needs (git, the board) when it
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

