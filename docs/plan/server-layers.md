# Server in layers

## Goal

Reorganize `src/server` along layers, so every file has an obvious place and the code follows common
backend practice: `routes/` take requests, `services/` hold the business logic and the integrations,
`schemas/` hold the data, with `auth/`, `lib/` and `jobs/` beside them. Dependencies are wired by a DI
container instead of by hand. The frontend comes later, in a plan of its own. Behaviour stays the same:
this is a refactor, not a feature, and the URLs do not change, so the UI needs no edits.

The target is described by the two WIP docs `docs/design/code-organization.md` and
`docs/design/dependency-injection.md` (if they are not on `main` yet, W1 brings them in). When the plan is
done they become a proper design chapter: principles, decisions and constraints, not a description of the
code, and `docs/design.md` gets the decision. The plan doc goes.

## Today

Checked in the code on 2026-11-13; counts may be off by a few. Each workstream recounts what it touches.

- **Flat folder.** `src/server` holds 99 source files (about 50k lines) with about 100 test files beside
  them. Six god files hold most of the logic: `workerSupervisor/workerSupervisor.ts` (5.9k lines), `board.ts` (4.2k), `project.ts`
  (3.3k), `workstations.ts` (2.5k), `commands.ts` and `koordinator.ts` (1.7k each).
- **Data layer mostly as wished.** `schemas/` uses Drizzle, one file per table with its schema and a query
  class (`Projects`, `Cards`, …); the card tables sit in `models/cards/`, `schema.ts` collects every table.
  Two things don't fit: `store.ts`, whose transactions span several tables, and `db.ts` (820 lines), which
  holds the migrations.
- **No routes layer.** About 134 endpoints are written inline in one `Bun.serve({ routes })` object in
  `server.ts` (1.25k lines), together with the WebSocket handling. Most project URLs live under
  `/api/c/:project/…`.
- **No services layer.** Business logic sits in the god files. Integrations are spread across the flat
  folder: git, GitHub/Forgejo (`forge.ts`, `forgejo.ts`, `github-folder.ts`), the agent harnesses
  (now `llms/harnesses/`: `claude.ts`, `codex.ts`, `agy.ts`), Tailscale, web push, voice.
- **Manual dependency injection.** `ProjectRuntime` (`project.ts`) builds `Board`, `WorkerSupervisor` and
  `Koordinator` by hand and passes them dependency objects; one runtime per project.
- **Many importers.** About 44 files outside `src/server` import from it (`src/extensions`, `scripts`,
  `plugin`, some UI code); every file move touches them.
- **Heavy traffic.** 182 commits changed `src/server` between 2026-11-06 and 2026-11-13, so big moves
  conflict with other cards' branches.

## Shape

- **Layers at the top, feature folders inside** (owner's decision, 2026-11-13).
- `schemas/`: as today, one file per table, plus `store.ts` (multi-table transactions) and `db.ts`
  (migrations).
- `services/<area>/`: business logic by area (`cards/`, `agents/`, `projects/`, `demos/`, `voice/` …), the
  god files split into them. Services are named after a noun (`CardService.moveToProject()`: id first,
  active verbs); integrations end in `Client` (`GitHubClient`, `ForgejoClient`, `CodexClient`,
  `TailscaleClient`).
- `routes/v1/`: one `HttpRoute` class per resource, at a RESTful URL under `/api/v1/`; the file path
  mirrors it, `:x` as `_x` (`routes/v1/cards/_cardId/share.ts` → `/api/v1/cards/:cardId/share`;
  see the Router Layer in `code-organization.md`).
  `server.ts` only collects the registered routes and the WebSocket.
- `auth/`: `access.ts`, `remote.ts`, `owner.ts`, `trust.ts`.
- `lib/`: helpers (`path.ts`, `zip.ts`, `images.ts` …).
- `jobs/` (not in the WIP docs): background loops that are neither a request nor a service call
  (`pr-watcher`, `limit-watch`, `stalls`, `awake`, `self-update`, the landing queue).
- **Layer rule:** routes → services → models, never upward and never skipping a layer. A test that reads
  the imports enforces it, like `schema.test.ts` does for the schema; no new lint tool.
- **Tests** stay beside their source file and move with it.
- **DI: LoopBack** (owner's decision): `@loopback/context` with `@model`/`@service`/`@route` decorators; an
  app context plus one child context per project replaces the hand-wiring in `ProjectRuntime`. Variant A
  (layers only, no DI) is dropped. If the spike in W7 fails, the fallback is DI without decorators (a plain
  composition root or awilix), for the owner to decide then.
- **URLs become RESTful as their routes move** (owner's decision, 2026-11-21, over the earlier "URLs
  stay unchanged"): each route moves to `/api/v1/` with its UI callers, which go through
  `src/ui/clients/seismic.ts` and use the JSON a write answers with. The first is "Share on approval".
- **Routes the owner has shaped ahead of their move** (2026-11-21):
  - "Give to the waiting card" and its undo (`takeWorkstation`, `keepWorkstation`, once on `/act`, the
    Koordinator's `evict` and `keep`) do not move as two actions. They split into three endpoints:
    the card requeued, its workstation freed, and the workstation assigned to the card waiting
    longest. They moved as `POST /api/v1/cards/:cardId/take-workstation` and `.../keep-workstation`;
    the three-endpoint split is still open.
  - The system-level settings went under one `settings/` resource (`/api/v1/settings/:settingName`,
    see the Router Layer in `code-organization.md`), the demo settings among them (`demo`). The
    configuration is `/api/v1/configuration`; its check (`/api/config/check`) and the demo voice's
    routes (`/api/demo-settings/check`, `/sample`, `/install`) have not moved.
- **Decided without the owner** (they can overrule): each move is kept small and lands quickly, to
  limit conflicts.

## Workstreams

Each lands on its own and keeps behaviour the same, with `bun test --parallel` and `bun run typecheck`
green. W3–W5 carry the real risk; the rest is mostly mechanical. A worker moves files with `git mv` so
history follows, updates the imports in `src/extensions`, `scripts`, `plugin` and the UI in the same change,
and leaves no re-export shims behind.

- [ ] **W1:** Boundary test and pure moves. Bring the two WIP docs onto `main` if they are not there. Add
  the test that reads the imports under `src/server` and enforces routes → services → models (starting
  with the rules the code already obeys, the rest listed as known exceptions that later workstreams remove).
  Move `access.ts`, `remote.ts`, `owner.ts` and `trust.ts` into `auth/`; `path.ts`, `images.ts` and the like
  into `lib/`; `pr-watcher`, `limit-watch`, stalls, `awake`, `self-update` and the landing queue into
  `jobs/`. Move `store.ts` and `db.ts` into `schemas/` if they are not already there.
- [ ] **W2:** Routes out of `server.ts`. Introduce the `HttpRoute` class and a registry that `server.ts`
  collects, then move the ~134 endpoints into `routes/<area>/` one area at a time (several small cards
  are fine, each landing alone), file paths mirroring the URLs. Routes call into the existing god files for
  now. `server.ts` keeps only the route registry, authentication hooks and the WebSocket.
- [ ] **W3:** Split `board.ts` into `services/cards/` and related areas (`CardService` and the services for
  what else it holds), one area per change. Routes and callers switch to the new services.
- [ ] **W4:** Split `workerSupervisor/workerSupervisor.ts` into `services/agents/`: sessions, spawning, limits, review and the rest, one
  piece per change, against the fake runtime in `src/server/test/helpers/testing.ts`.
- [ ] **W5:** Split `project.ts`, `workstations.ts`, `commands.ts` and `koordinator.ts` into their services
  (`services/projects/`, `services/workstations/`, `services/commands/`, `services/koordinator/`). The
  `ProjectRuntime` stays as the hand-wired root until W7.
- [ ] **W6:** Clients for the integrations: `GitHubClient`, `ForgejoClient` (with `forge.ts` and
  `github-folder.ts`), `CodexClient`, `AgyClient`, `TailscaleClient`, web push and the voice cloud. Services
  depend on a client, never on a CLI or HTTP call of their own; tests fake the client.
- [ ] **W7:** LoopBack. Spike on Bun first: `experimentalDecorators`, `emitDecoratorMetadata` and
  `reflect-metadata` in the tsconfig; Bun 1.4 and the compiled binary (`bun build --compile`);
  `verbatimModuleSyntax` (inject by binding key, not by type metadata); moving the hand-wired test fixtures
  (`test/helpers/workerSupervisor.ts`) to a test context. If it fails, hand the owner the fallback to decide. Otherwise
  introduce `@model`/`@service`/`@route`, an app context and one child context per project in place of the
  wiring in `ProjectRuntime`. Last step: turn the WIP docs into the design chapter, add the decision to
  `docs/design.md` and remove this plan doc.
