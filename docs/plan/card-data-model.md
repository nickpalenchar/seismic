# Normalize the card data model into separate tables

## Goal

Make the card data model readable again, in code that is easier to find your way around:

- The groups of fields that belong to one feature or kind of card (ideas, reviews, demos, plans,
  labels, holds) live in their own tables, apart from the fields every card has.
- The overlapping pause/wait flags become one "why is this not running" value.
- The data layer moves to Drizzle ORM. Each table is a model file holding its definition and its
  queries, under `src/server/models/`.
- The existing database moves over without loss.

This lays the ground for a later services layer, which will own the business logic and string the
models' queries together. That layer is not part of this plan.

## Today

Two layers; the "about 100 fields" is the outer one.

- **`cards` table:** 69 columns. Most feature groups are already one JSON column each.
- **`Item`** (`src/core/types.ts`): what the UI and the agents get. 102 flat fields, many computed
  (`inTurn`, `doing`, `blocked`, `limitPaused`, `restartPaused`…).
- **Live database** (read-only look, 2026-11-08): 496 cards, 190 on a canvas. 10 columns are empty on
  every card (rare or new features, not dead code); about 20 are set on fewer than 20 cards; labels,
  `demo`, `share`, `shipped` and the agent fields are set on 250–330 cards.
- **Data layer:** hand-written SQL. `src/server/db.ts` is 2,000 lines: one `Store` class over about
  20 tables, 103 raw `query`/`run` calls, hand-written row interfaces, `JSON.parse` wherever a JSON
  column is read. Some `Store` methods already combine tables in one transaction (`moveCard` changes
  cards, decisions and feedback). `board.ts` and `data-export.ts` also run SQL directly. No ORM
  dependency today; the server compiles into one binary (`bun build --compile`) for macOS, Linux
  and Windows.
- **Migrations:** an append-only list in `db.ts`, each in its own transaction, tracked in
  `PRAGMA user_version`. An older Seismic refuses a newer database. Nothing backs the database up
  before migrating.
- **"Why is this not running"** is spread over `paused` (owner or usage limit) and `pausing`, the
  computed `limitPaused` and `restartPaused`, `snoozed` and `parking_lot`, `queue` (the
  Koordinator's wait), `parked` (app stopped while the card waits) and `waiting_since`.

## Decisions

- **Both layers get smaller**: first the hold flags are collapsed and `Item` is grouped, then feature
  tables come one group at a time. Each grouped `Item` part maps to one table.
- **Tables only for the feature groups**: ideas, reviews, demos, plans, labels, holds. The agent/run
  fields stay on the card (on most cards, woven through `workers.ts`).
- **JSON blobs stay JSON** inside their table. Only real lists (earlier demos, labels) become rows.
- **Drizzle ORM** (`drizzle-orm` with its `bun-sqlite` driver; `drizzle-kit` as a dev dependency).
  JSON columns are typed (`text({ mode: 'json' }).$type<T>()`). It comes before the new tables, so
  those are written once.
- **Models**: one file per table under `src/server/models/`, holding the table definition and that
  table's queries; the card and its feature tables sit together in `models/cards/`. A model knows
  only its own table (and, for reads, the tables it joins to) and holds no business logic. What
  spans several models (`moveCard`, say) stays in a thin composition module, `src/server/store.ts`,
  until the services come; its transactions use the shared Drizzle connection. `db.ts` keeps the
  connection and the migration runner.
- **Migrations**: the existing runner stays (`user_version`, one transaction per step). New steps
  are SQL that `drizzle-kit generate` writes, embedded in the code. Drizzle's own `migrate()` is not
  used: it would need a baseline for every existing database, and it reads a migrations folder from
  disk that the compiled binary would have to carry. A test checks that the Drizzle schema matches
  a database migrated from scratch.

Dropped (2026-11-08):

- Exploding the JSON blobs into columns or child rows: much more work, nothing queries them.
- Moving the agent fields out of `cards`.
- Drizzle's own migration runner (see above).
- Building the services layer now: it comes later, on its own.

## Migrating safely

For every workstream that migrates or moves queries:

- One migration per group (`CREATE TABLE`, `INSERT … SELECT`), in the existing per-step transaction.
  A failure leaves the database at the previous version.
- **Equality check**: (1) copy the real `obeya.db` into a scratch `SEISMIC_HOME`; (2) snapshot every
  project's `Item`s on the old code; (3) apply the step and snapshot again; (4) the two must match,
  apart from the planned regrouping. For W2 and W3 that means an exact match.
- Run each step on the `-dev` checkout (`~/.obeya-dev`) before landing. The stable Seismic migrates
  on its restart, with the backup (W1).

## Workstreams

One after another; all of them touch `db.ts`, `board.ts` and `workers.ts`, so cards working there at
the same time will conflict (W3 most).

- [ ] **W1:** Backup before migrating. Whenever a migration is pending, the store first writes
  `VACUUM INTO obeya.db.before-<version>` and keeps the last few. Test with a pending migration;
  document it in `docs/design/data.md`.
- [x] **W2:** Drizzle and `models/`, schema and infrastructure. Add the dependencies and describe
  every current table in `src/server/models/` (checked against `drizzle-kit pull` on a migrated
  database). Add the test that the schema matches a database migrated from scratch. Prove the
  compiled binary still starts on all targets (`bun scripts/check-binary.ts`). Move one small
  table's queries over as the pattern.
  Done: `models/schema.ts` lists every table; `devices` is the pattern, a class over the shared
  connection (`store.devices.all()`), its JSON column typed and parsed by Drizzle. Found on the
  way: drizzle-kit writes a primary key `NOT NULL` and a boolean default as `false`, where the old
  migrations wrote neither, so `drizzle-kit push` (and `pull` → `generate` against a live
  database) would rebuild every table. A new step's SQL is the diff of the Drizzle schema before
  and after the change (`generateSQLiteMigration` of `drizzle-kit/api`), not against a database.
  `drizzle-kit pull` needs `better-sqlite3` or `@libsql/client`, which are not dependencies.
- [ ] **W3:** Drizzle, the queries. Split the rest of `Store` table by table into its model files;
  move the methods that span several tables into `store.ts`; move the direct SQL in `board.ts` and
  `data-export.ts` into the models. No schema change: pure refactoring, the equality check must
  match exactly. The riskiest package: it touches every query.
- [ ] **W4:** One hold value. First check which of the pause, limit, restart, snooze and
  parking-lot states can hold at the same time. Collapse the exclusive ones into one `hold`
  (`{ reason, since, until?, by?, … }`, plus the payload `paused` carries today) and migrate the
  existing values. `queue` and `parked` stay separate unless the check shows otherwise.
- [ ] **W5:** Grouped `Item`. Nested parts present only when a card has them: `agent`, `hold`,
  `idea`, `review`, `demo`, `plan`, `labels`; the ~10 core fields stay flat. Update the UI and the
  agents' readers.
- [ ] **W6:** Ideas → `models/cards/ideas.ts` (pilot). Moves `idea`, `prototype`, `prototype_of`,
  `proposal`, `built_on`, `becomes_plan` and `new_repo`, read through Drizzle's relational queries
  (`with: { idea: true }`). Settles the pattern for the rest.
- [ ] **W7:** One table each, one card per table: reviews (`pr`, `contribution`, `code_review`);
  demos (`demo`, `share`, `page_heard`, `files`, `held`, with earlier `demos` as rows); plans
  (`plan`, `deps`, `collapsed`, `plan_docs`); labels; holds.
- [ ] **W8:** Drop the moved columns from `cards`, one release after the last move.
