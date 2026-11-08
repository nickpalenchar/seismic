import { Database } from 'bun:sqlite';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import { currentAgent } from './agent-identity';
import type { ActivityCode, ActivityWho, AgentIdentity, AgentModel, Attribution, Feedback, FeedbackAnswer, WorkConfig } from '../core/types';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { AnswerFile, AnswerRef, CardEvent, Chat, CardKind, CardState, Mock, Need, Preference, PreferenceState, ProposedSetting, RepoCommands, SettingProposal, SettingProposalState, Spot, Talk, TalkAfter, TalkMoved, TalkQuote, TalkRef, TalkWait } from '../core/types';
import type { Place } from '../core/layout';
import { MAIN_CANVAS } from '../core/types';
import type { Wish } from '../core/wish';
import { Devices } from './models/devices';
import * as schema from './models/schema';

/** The Drizzle connection the models query through: the store's own SQLite connection, so they share its transactions. */
export type Db = BunSQLiteDatabase<typeof schema>;

export interface CardRow {
  id: string;
  project_id: string;
  /** The canvas of the project it is on; a workstream's is its plan's. */
  canvas_id: string;
  kind: CardKind;
  /** Null on plan cards: the state comes from the plan doc. */
  state: CardState | null;
  need: Need | null;
  title: string | null;
  body: string | null;
  x: number;
  y: number;
  parent_id: string | null;
  /** `docs/plan/x.md` for a plan, `docs/plan/x.md#W3` for a workstream; null for manual cards. */
  plan_ref: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Agent session of the card's worker, or of a plan's plan agent. */
  session_id: string | null;
  /** JSON AgentSetting pinned before a worker starts; null on legacy Claude sessions. */
  agent_setting: string | null;
  /** Leased clone and branch while a worker has the card. */
  workstation: string | null;
  branch: string | null;
  /** The worker's latest `report`. */
  status_line: string | null;
  /** JSON: the open question (`{ text, options }`) or the review summary (`{ summary }`). */
  detail: string | null;
  /** A proposal's source card. */
  from_id: string | null;
  /** JSON: the Koordinator's estimate of the files the card changes (`{ files, reason }`). */
  scope: string | null;
  /** JSON: set while the Koordinator decides (`{ checking: true }`) or the card waits (`{ behind, reason }`), with `since`. */
  queue: string | null;
  /** JSON: the card's pull request once approval opened the PR phase (`PrState`); on a review card, the one it reviews from the start. */
  pr: string | null;
  /** JSON, review cards only: the contributor's pull request the card reviews (`StoredContribution` in board.ts). */
  contribution: string | null;
  /** JSON: the code review of the card's work where its project reviews work that lands on main (`StoredCodeReview` in board.ts). */
  code_review: string | null;
  /** The owner's card's repository on a project with several; null is the home repository. */
  repo: string | null;
  /** JSON: the card's latest demo (`{ kind, dir, chapters, question? }`; no `kind` is a video). */
  demo: string | null;
  /** JSON: the demos of earlier handovers a later one replaced, the oldest first, each as `demo` was; append only. */
  demos: string | null;
  /** When the owner took the finished card off the project into the archive. */
  archived_at: string | null;
  /** JSON: an idea's status and brief (`{ status, brief }`). */
  idea: string | null;
  /** A prototype's idea. */
  prototype_of: string | null;
  /** When the owner approved work that could not land yet; its next handover lands without asking again. */
  approved_at: string | null;
  /**
   * JSON, while the card's work is on main and its worker finishes what remains (its workstation and
   * session are kept until then): `{ commit?, restart? }`, `restart` when it waits for Seismic to run the change.
   */
  landed: string | null;
  /** JSON: ids of the screenshots the owner attached to the card's task. */
  images: string | null;
  /** JSON, plans only: the plan doc as last read (`PlanDoc`), kept for the archive once the doc is gone. */
  plan: string | null;
  /** A card the work retrospective proposed: what it rests on. */
  retro: string | null;
  /** JSON, while a worker's proposal waits: `Proposal` (an idea or a task, why, the questions to decide). */
  proposal: string | null;
  /** JSON: the plan docs (plan references) the landed work of a card that was an idea added. */
  plan_docs: string | null;
  /** JSON, prototypes only: how it ended (`end`, once archived) and its worker's proposal to build the idea on it (`proposal`). */
  prototype: string | null;
  /** A card that was an idea and is built on the branch of one of its prototypes: that prototype. */
  built_on: string | null;
  /** JSON: the demo's page for colleagues (`StoredShare` in share.ts); its slug stays once it was shared. */
  share: string | null;
  /** The group the card belongs to; a plan's covers its workstreams, whose own stays null. */
  group_id: string | null;
  /**
   * JSON, once the card's work landed (`Shipped` in board.ts): the commit it landed with and its
   * pull request. Kept after its worker is done: a workstream whose plan doc keeps it open is
   * planned again once the read checkout holds that commit.
   */
  shipped: string | null;
  /** When Seismic stopped the app in the card's workstation while the card waited (Parking); gone once its worker heard so. */
  parked: string | null;
  /** JSON: the owner's comments on places in the demo video Seismic holds back while they watch (event ids, `Item.held`). */
  held: string | null;
  /** 1 once the owner decided the card (an idea or a task of theirs) becomes a plan: its worker writes the plan doc, and the plan takes its place. */
  becomes_plan: number;
  /** JSON, a Question card (and an idea that was one): the thread of looked-up answers it holds (`StoredThread` in board.ts). */
  thread: string | null;
  /** JSON, while the owner or usage limit has paused the card's agent: for a worker what came for it meanwhile (`PausedState` in workers.ts), `{}` for an idea's or a Question card's agent, which keep what waits for them with the idea or the thread. */
  paused: string | null;
  /** Since when (ISO) the owner has asked the card's agent to pause once it has brought its work to a safe point; null once it paused, went on or stopped. */
  pausing: string | null;
  /** JSON: the owner's words Seismic holds for the card's worker until it takes them in, at its next tool step or turn (`Unheard` in workers.ts). */
  unheard: string | null;
  /** The address its worker opens the app in the card's workstation at, while it runs (`app_running`); gone once Seismic stops the app or the workstation goes. */
  app: string | null;
  /** Since when the card waits for the owner (`needsYou`), kept while it does; null while it does not. */
  waiting_since: string | null;
  /** JSON, while the card is snoozed until a point in time (`Snooze`): Seismic wakes it then. */
  snoozed: string | null;
  /** When the owner moved the card into the parking lot (ISO): off the canvas, listed in the Agents sheet's Parked tab; null while it is on the canvas. */
  parking_lot: string | null;
  /** JSON: the files its worker named as the result at its latest handover that named any (`CardFile[]`). */
  files: string | null;
  /** JSON, plans only: which workstream builds on which, as the Koordinator read it from the plan doc (`StoredDeps` in board.ts). */
  deps: string | null;
  /** 1 while the owner has a plan folded to its head: its workstreams are not shown on the project. */
  collapsed: number;
  /**
   * The clone (`ssh://<host>/…` on a host) that holds the newest state of the card's branch since
   * the owner took its workstation from it, its uncommitted work in a commit of Seismic's on top; gone
   * once the card works in a clone again, which takes the branch from there.
   */
  kept_in: string | null;
  /**
   * JSON: a repository to create for the card before work begins (`NewRepo`); once Seismic made it,
   * `{ path, project, made: true }`, so its worker hears that the repository is new.
   */
  new_repo: string | null;
  /** What the card's worker last heard of its demo's page (`PageHeard` in workers.ts), so it hears of a change with its next step. */
  page_heard: string | null;
  /** The priority the owner gave the card (`Priority`), null while none. */
  priority: string | null;
  /** The card's category (`Category`), null while none. */
  category: string | null;
  /** The card's sub-category (`Subcategory`), null while none. */
  subcategory: string | null;
  /** The card's complexity (`Complexity`), null while none. */
  complexity: number | null;
  /** JSON: the labels Seismic set as its suggestion and the owner has not touched since (`Label[]`); null while none. */
  suggested_labels: string | null;
  /** JSON: the labels the owner has set, to a value or to none (`Label[]`): Seismic suggests none of them again. Null while none. */
  owner_labels: string | null;
  /** The card's code in addresses (`/p/<project>/c/<code>`): the start of its id's hex digits, unique among all cards (`SHORT`). */
  short: string;
}

/** Words the usage limit keeps the Koordinator from reading (`talk.held`): until when, and how it reads them then (`Commander`'s). */
export interface HeldTalk {
  until: string;
  reading: unknown;
}

/** A card the Koordinator waits on (`talk.waits`), and the step it said it takes once the card gets there. */
export interface TalkWaitRow extends TalkWait {
  then: string;
}

export interface GroupRow {
  id: string;
  project_id: string;
  /** The canvas its cards are on. */
  canvas_id: string;
  name: string;
  hue: number;
  created_at: string;
}

export interface CanvasRow {
  id: string;
  project_id: string;
  name: string;
  icon: string | null;
  /** Its place in the project's order, from 0; the first opens when the project does. */
  position: number;
  created_at: string;
}


/**
 * Where the cards' history stood when it was read: the time, and the latest event and card then.
 * What is written later has a larger id, even within the same millisecond or once the clock went back.
 */
export interface Mark {
  at: string;
  event: number;
  card: number;
}

/** A line of the Activity log as stored, with the project of its card and the title of the card it waits for. */
export interface ActivityRow {
  id: number;
  at: string;
  who: ActivityWho;
  code: ActivityCode;
  cardId: string;
  otherId: string | null;
  otherTitle: string | null;
  harness: string | null;
  /** The card's title when it was deleted, on a `deleted` line. */
  title: string | null;
  projectId: string;
}

/** A step in a card's history, as the Koordinator reads it; `created` marks a card of the owner's or a proposal. */
export interface Moment {
  at: string;
  cardId: string;
  kind: CardEvent['kind'] | 'created';
  author: CardEvent['author'];
  text: string;
}

/** Something the owner said: to an agent (`hint` a note or feedback, `answer`), in an idea (`talk`), to the Koordinator (`say`). */
export interface Utterance {
  at: string;
  kind: 'hint' | 'answer' | 'talk' | 'say';
  text: string;
  cardId?: string;
  title?: string;
}

export interface DecisionRow {
  id: number;
  project_id: string;
  plan_id: string | null;
  card_id: string;
  question: string;
  answer: string;
  by: 'owner' | 'plan' | 'koordinator';
  at: string;
}

/** The schema Seismic was released with. */
const SCHEMA = `
  CREATE TABLE canvases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE groups (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    name TEXT NOT NULL,
    hue INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    kind TEXT NOT NULL,
    state TEXT,
    need TEXT,
    title TEXT,
    body TEXT,
    x REAL NOT NULL,
    y REAL NOT NULL,
    parent_id TEXT REFERENCES cards(id),
    plan_ref TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    session_id TEXT,
    workspace TEXT,
    branch TEXT,
    status_line TEXT,
    detail TEXT,
    from_id TEXT REFERENCES cards(id),
    scope TEXT,
    queue TEXT,
    pr TEXT,
    repo TEXT,
    demo TEXT,
    archived_at TEXT,
    idea TEXT,
    prototype_of TEXT REFERENCES cards(id),
    approved_at TEXT,
    landed TEXT,
    images TEXT,
    plan TEXT,
    plan_docs TEXT,
    prototype TEXT,
    built_on TEXT REFERENCES cards(id),
    share TEXT,
    retro TEXT,
    proposal TEXT,
    group_id TEXT REFERENCES groups(id),
    shipped TEXT,
    parked TEXT,
    held TEXT,
    becomes_project INTEGER NOT NULL DEFAULT 0,
    thread TEXT,
    paused TEXT,
    unheard TEXT,
    UNIQUE (canvas_id, plan_ref)
  );
  CREATE TABLE workspaces (
    path TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    card_id TEXT REFERENCES cards(id),
    repo TEXT
  );
  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id),
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    code TEXT,
    images TEXT,
    mocks TEXT,
    reply_to INTEGER,
    spot TEXT,
    answer TEXT,
    picks TEXT,
    unread INTEGER,
    read_after INTEGER
  );
  CREATE INDEX events_card ON events (card_id, id);
  CREATE TABLE decisions (
    id INTEGER PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    project_id TEXT REFERENCES cards(id),
    card_id TEXT NOT NULL REFERENCES cards(id),
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    by TEXT NOT NULL,
    at TEXT NOT NULL
  );
  CREATE TABLE settings (
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (canvas_id, key)
  );
  CREATE TABLE preferences (
    id INTEGER PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    text TEXT NOT NULL,
    card_id TEXT REFERENCES cards(id),
    created_at TEXT NOT NULL,
    deleted_at TEXT,
    state TEXT NOT NULL DEFAULT 'active',
    quote TEXT,
    review INTEGER NOT NULL DEFAULT 0,
    replaces INTEGER REFERENCES preferences(id),
    decided_at TEXT,
    target TEXT
  );
  -- what the owner said to the Koordinator and what it answered: its memory across sessions
  CREATE TABLE talk (
    id INTEGER PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    at TEXT NOT NULL,
    said TEXT NOT NULL,
    reply TEXT NOT NULL,
    card_id TEXT REFERENCES cards(id),
    undone INTEGER NOT NULL DEFAULT 0,
    question TEXT,
    about TEXT,
    answer TEXT,
    answer_by TEXT,
    images TEXT,
    unread INTEGER NOT NULL DEFAULT 0,
    session_id TEXT,
    thread INTEGER,
    follows INTEGER,
    files TEXT,
    card TEXT
  );
  -- the work retrospective: friction noted on a card's run, per repository
  CREATE TABLE friction (
    id INTEGER PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    repo TEXT NOT NULL,
    card_id TEXT NOT NULL REFERENCES cards(id),
    at TEXT NOT NULL,
    what TEXT NOT NULL,
    cost TEXT NOT NULL,
    fix TEXT NOT NULL
  );
  CREATE INDEX friction_repo ON friction (canvas_id, repo, at);
  -- a command the owner has the confirmation of, while it waits for "Undo": it outlives a restart
  CREATE TABLE commands (
    token TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    due TEXT NOT NULL,
    body TEXT NOT NULL
  );
  -- a value for a repository's setting the work retrospective proposes, and where the owner took it
  CREATE TABLE setting_proposals (
    id INTEGER PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    repo TEXT NOT NULL,
    field TEXT NOT NULL,
    value TEXT NOT NULL,
    basis TEXT NOT NULL,
    cards TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'proposed',
    created_at TEXT NOT NULL,
    decided_at TEXT
  );`;

/** How many hex digits of its id a card's code has at least. */
export const SHORT = 6;

/**
 * The `user_version` of a database at `SCHEMA`: the steps its schema took before the release. One
 * that took fewer is from an Seismic before it (`OlderDatabase`).
 */
export const RELEASED = 40;

// Append only; each entry runs once on a database at `SCHEMA`, tracked in `PRAGMA user_version` after `RELEASED`.
export const MIGRATIONS = [
  // what an Seismic before the release kept in shapes that changed since, in today's: demos and
  // shared pages without a kind are videos; a share held for undo publishes; `answering` moves out
  // of the demo; a demo's question goes with the last handover before the owner answered it (else
  // the last one); a project whose doc went before Seismic kept it gets an empty one; the pause line
  // loses its second sentence; a repository with retrospectives before they were counted is past the ramp
  `UPDATE cards SET demo = json_set(demo, '$.kind', 'video') WHERE demo IS NOT NULL AND json_extract(demo, '$.kind') IS NULL;
   UPDATE cards SET share = json_set(share, '$.shown.kind', 'video') WHERE json_extract(share, '$.shown') IS NOT NULL AND json_extract(share, '$.shown.kind') IS NULL;
   UPDATE cards SET share = json_set(share, '$.state', 'publishing') WHERE json_extract(share, '$.state') = 'pending';
   UPDATE cards SET detail = json_set(coalesce(detail, '{}'), '$.answering', json('true')), demo = json_remove(demo, '$.answering')
    WHERE json_extract(demo, '$.answering');
   UPDATE cards SET demo = json_set(demo, '$.handover', (
       SELECT max(e.id) FROM events e WHERE e.card_id = cards.id AND e.kind = 'review'
          AND e.id < coalesce((SELECT max(a.id) FROM events a WHERE a.card_id = cards.id AND a.kind = 'answer' AND a.text = json_extract(cards.demo, '$.answer')), 9e18)))
    WHERE json_extract(demo, '$.question') IS NOT NULL AND json_extract(demo, '$.handover') IS NULL
      AND EXISTS (SELECT 1 FROM events e WHERE e.card_id = cards.id AND e.kind = 'review');
   UPDATE cards SET plan = json_object('file', plan_ref, 'title', coalesce(title, plan_ref), 'goal', '', 'workstreams', json('[]'), 'markdown', '')
    WHERE kind = 'project' AND plan_ref IS NOT NULL AND plan IS NULL;
   UPDATE events SET text = 'Paused.' WHERE kind = 'state' AND author = 'owner' AND text LIKE 'Paused. %';
   UPDATE events SET text = 'Pausiert.' WHERE kind = 'state' AND author = 'owner' AND text LIKE 'Pausiert. %';
   INSERT INTO settings (canvas_id, key, value)
     SELECT canvas_id, 'work_retro_runs:' || substr(key, 18), '3' FROM settings s WHERE key LIKE 'work_retro_since:%'
        AND NOT EXISTS (SELECT 1 FROM settings r WHERE r.canvas_id = s.canvas_id AND r.key = 'work_retro_runs:' || substr(s.key, 18));`,
  // the message of the sheet the owner's words reply to (JSON `TalkRef`)
  'ALTER TABLE talk ADD COLUMN reply_to TEXT;',
  // where the app in a card's workstation runs, for the owner to try it by hand
  'ALTER TABLE cards ADD COLUMN app TEXT;',
  // devices paired to reach Seismic from another machine: the hash of each one's cookie
  `CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    paired_at TEXT NOT NULL,
    last_seen TEXT NOT NULL
  );`,
  // Seismic's reply says it cannot do what the owner asked, or the owner asked to tell its makers: what a draft for them starts from (JSON `Wish`)
  'ALTER TABLE talk ADD COLUMN wish TEXT; ALTER TABLE events ADD COLUMN wish TEXT;',
  // the demos of earlier handovers a later one replaced
  'ALTER TABLE cards ADD COLUMN demos TEXT;',
  // since when a card waits for the owner, for the phone view's "Needs you"
  'ALTER TABLE cards ADD COLUMN waiting_since TEXT;',
  // a repository's commands as the owner last confirmed them, by its path (JSON `RepoCommands`)
  `CREATE TABLE trusted_commands (
    repo TEXT PRIMARY KEY,
    commands TEXT NOT NULL,
    at TEXT NOT NULL
  );`,
  // a paired device's push subscription (JSON `Subscription`), where it turned notifications on
  'ALTER TABLE devices ADD COLUMN push TEXT;',
  // words the usage limit kept the Koordinator from reading, until it lifts (JSON `HeldTalk`)
  'ALTER TABLE talk ADD COLUMN held TEXT;',
  // a card set aside until a point in time, by its worker or the owner (JSON `Snooze`)
  'ALTER TABLE cards ADD COLUMN snoozed TEXT;',
  // cards the Koordinator waits on to take a step then (JSON `TalkWaitRow[]`), and the exchange it took that step up in (JSON `TalkAfter`)
  'ALTER TABLE talk ADD COLUMN waits TEXT; ALTER TABLE talk ADD COLUMN after_wait TEXT;',
  // what a card changed in a folder without git, and the undo it has there (JSON `FolderCard`, folder.ts)
  `CREATE TABLE folder_cards (
    card_id TEXT PRIMARY KEY,
    folder TEXT NOT NULL,
    state TEXT NOT NULL
  );`,
  // the files a card's worker named as its result at its handover (JSON `CardFile[]`)
  'ALTER TABLE cards ADD COLUMN files TEXT;',
  // which workstream of a plan builds on which, read from its plan doc to arrange them (JSON `StoredDeps`)
  'ALTER TABLE cards ADD COLUMN deps TEXT;',
  // a plan the owner folded to its head
  'ALTER TABLE cards ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0;',
  // words the owner wrote in a plan's sheet, which went straight to its plan agent: that plan
  'ALTER TABLE talk ADD COLUMN asked_in TEXT;',
  // Seismic's reply on a card that answers the owner's words without acting on them: it stands in the conversation
  'ALTER TABLE events ADD COLUMN reply INTEGER;',
  // the clone holding a card's branch since the owner took its workstation from it
  'ALTER TABLE cards ADD COLUMN kept_in TEXT;',
  // a review card: the pull request of someone outside it reviews (JSON `StoredContribution`)
  'ALTER TABLE cards ADD COLUMN contribution TEXT;',
  // a repository to create for a card before work begins, and that Seismic made it (JSON `StoredNewRepo` in board.ts);
  // an exchange of no one's in the sheet that says a card moved to another canvas (JSON `TalkMoved`)
  'ALTER TABLE cards ADD COLUMN new_repo TEXT; ALTER TABLE talk ADD COLUMN moved TEXT;',
  // what a card's worker last heard of its demo's page (JSON `PageHeard` in workers.ts)
  'ALTER TABLE cards ADD COLUMN page_heard TEXT;',
  // Seismic's reply on a card to what its agent passed on from the owner's words (`to_seismic`)
  'ALTER TABLE events ADD COLUMN forwarded INTEGER;',
  // since when the owner asked the card's agent to pause at a safe point, until it has (ISO)
  'ALTER TABLE cards ADD COLUMN pausing TEXT;',
  // a question looked up for an action that needs its answer: the step the Koordinator takes then, and
  // the exchange of no one's it took that step up in (the id of the exchange whose answer came in)
  'ALTER TABLE talk ADD COLUMN then_step TEXT; ALTER TABLE talk ADD COLUMN after_answer INTEGER;',
  // harness, model and effort of a worker run; old unqualified session ids belong to Claude
  'ALTER TABLE cards ADD COLUMN agent_setting TEXT;',
  // Attribution belongs to each utterance, not mutable role defaults or a card's later runs.
  'ALTER TABLE events ADD COLUMN agent TEXT; ALTER TABLE talk ADD COLUMN reply_agent TEXT; ALTER TABLE talk ADD COLUMN answer_agent TEXT;',
  // a card's code in addresses: the first `SHORT` hex digits of its id, one more for each card that shares them
  `ALTER TABLE cards ADD COLUMN short TEXT;
   UPDATE cards SET short = substr(replace(id, '-', ''), 1, ${SHORT});
   ${Array.from({ length: 32 - SHORT }, (_, k) => `UPDATE cards SET short = substr(replace(id, '-', ''), 1, ${SHORT + 1 + k}) WHERE short IN (SELECT short FROM cards GROUP BY short HAVING count(*) > 1);`).join('\n   ')}
   CREATE UNIQUE INDEX cards_short ON cards (short);`,
  // an error of a session that signed in with a token rather than this machine's account
  'ALTER TABLE events ADD COLUMN token INTEGER;',
  // the cards each change of a canvas reads, without going through its archive
  `CREATE INDEX cards_open ON cards (canvas_id) WHERE deleted_at IS NULL AND archived_at IS NULL;
   CREATE INDEX cards_plan_docs ON cards (canvas_id) WHERE deleted_at IS NULL AND plan_docs IS NOT NULL;
   CREATE INDEX cards_prototypes ON cards (canvas_id, created_at) WHERE deleted_at IS NULL AND prototype_of IS NOT NULL;
   CREATE INDEX cards_waiting ON cards (canvas_id) WHERE waiting_since IS NOT NULL;
   CREATE INDEX cards_shared ON cards (canvas_id) WHERE deleted_at IS NULL AND share IS NOT NULL;`,
  // where the owner was on the canvas when they asked for a step that needed looking up first (JSON `Place`): its new cards go there
  'ALTER TABLE talk ADD COLUMN then_place TEXT;',
  // a line that Seismic made a follow-up card of the card: that card (JSON `CardEvent['made']`)
  'ALTER TABLE events ADD COLUMN made TEXT;',
  // each session that worked on a card, with the configuration it ran on (`WorkConfig`, null where
  // unknown), and the owner's responses on approved work with whom they credit as at their handover.
  // Cards from before take their last session as its pinned setting has it, from their last start, and one run for each
  // other identity their agents' messages carry; the model only where those messages name it, or a
  // Codex setting names it (a Codex model chosen by name is the one it runs).
  `CREATE TABLE agent_runs (
    card_id TEXT NOT NULL REFERENCES cards(id),
    session_id TEXT NOT NULL,
    harness TEXT,
    model TEXT,
    effort TEXT,
    requested TEXT,
    started_at TEXT NOT NULL,
    PRIMARY KEY (card_id, session_id)
  );
   CREATE TABLE feedback (
    id INTEGER PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id),
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    handover INTEGER NOT NULL,
    context TEXT NOT NULL,
    attribution TEXT NOT NULL,
    configs TEXT NOT NULL,
    harness TEXT,
    model TEXT,
    effort TEXT,
    answer TEXT NOT NULL,
    facets TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    UNIQUE (card_id, handover)
  );
   WITH c AS (
     SELECT id, session_id, agent_setting AS s,
       coalesce((SELECT max(at) FROM events WHERE card_id = cards.id AND kind = 'state' AND author = 'obeya' AND (text LIKE 'Agent started%' OR text LIKE 'Agent gestartet%')), created_at) AS started,
       CASE WHEN json_extract(agent_setting, '$.harness') = 'codex' OR (agent_setting IS NULL AND session_id LIKE 'codex:%') THEN 'codex' ELSE 'claude' END AS h
     FROM cards),
   i AS (
     SELECT card_id, json_extract(agent, '$.harness') AS h, json_extract(agent, '$.model') AS m, min(at) AS at
     FROM events WHERE agent IS NOT NULL AND author IN ('worker', 'explorer') GROUP BY 1, 2, 3),
   n AS (SELECT card_id, count(*) AS k FROM i GROUP BY card_id)
   INSERT OR IGNORE INTO agent_runs (card_id, session_id, harness, model, effort, requested, started_at)
     SELECT id, session_id, h, CASE WHEN h = 'codex' AND json_extract(s, '$.codex.model') <> 'default' THEN json_extract(s, '$.codex.model') END,
       json_extract(s, CASE h WHEN 'codex' THEN '$.codex.effort' ELSE '$.effort' END),
       json_extract(s, CASE h WHEN 'codex' THEN '$.codex.model' ELSE '$.model' END), started
       FROM c WHERE session_id IS NOT NULL AND id NOT IN (SELECT card_id FROM i)
     UNION ALL
     SELECT x.card_id, CASE WHEN x.own THEN c.session_id ELSE 'earlier:' || x.h || ':' || coalesce(x.m, '') END, x.h, x.m,
       CASE WHEN x.own THEN json_extract(c.s, CASE c.h WHEN 'codex' THEN '$.codex.effort' ELSE '$.effort' END) END,
       CASE WHEN x.own THEN json_extract(c.s, CASE c.h WHEN 'codex' THEN '$.codex.model' ELSE '$.model' END) END, x.at
       FROM (SELECT i.*, n.k = 1 AND i.h = c.h AND c.session_id IS NOT NULL AS own FROM i JOIN n USING (card_id) JOIN c ON c.id = i.card_id) x
       JOIN c ON c.id = x.card_id;`,
  // the priority the owner gave a card (`Priority`), a label only
  'ALTER TABLE cards ADD COLUMN priority TEXT;',
  // the card's other labels beside its priority, which of them are Seismic's suggestion, and which the owner has set
  `ALTER TABLE cards ADD COLUMN category TEXT;
   ALTER TABLE cards ADD COLUMN subcategory TEXT;
   ALTER TABLE cards ADD COLUMN complexity INTEGER;
   ALTER TABLE cards ADD COLUMN suggested_labels TEXT;
   ALTER TABLE cards ADD COLUMN owner_labels TEXT;`,
  // the code review of a card's work that lands on main: its mode, the handover it is for, its findings
  'ALTER TABLE cards ADD COLUMN code_review TEXT;',
  // the owner's chats with Seismic on a canvas, each exchange in one; new words go into the one opened
  // last. What was said before is one chat per canvas.
  `CREATE TABLE chats (id INTEGER PRIMARY KEY, canvas_id TEXT NOT NULL REFERENCES canvases(id), at TEXT NOT NULL, opened TEXT NOT NULL);
   CREATE INDEX chats_canvas ON chats (canvas_id, opened);
   ALTER TABLE talk ADD COLUMN chat INTEGER REFERENCES chats(id);
   INSERT INTO chats (canvas_id, at, opened) SELECT canvas_id, MIN(at), MAX(at) FROM talk GROUP BY canvas_id;
   UPDATE talk SET chat = (SELECT id FROM chats WHERE chats.canvas_id = talk.canvas_id);
   CREATE INDEX talk_chat ON talk (chat, id);`,
  'ALTER TABLE chats ADD COLUMN model TEXT;',
  // a plan was a "project" before the word went to the app level: the card kind, the plan agent's answers and its
  // messages, the columns that name it, and the plan on a response's context (JSON `Feedback`)
  `UPDATE cards SET kind = 'plan' WHERE kind = 'project';
   UPDATE events SET author = 'plan' WHERE author = 'project';
   UPDATE talk SET answer_by = 'plan' WHERE answer_by = 'project';
   UPDATE decisions SET by = 'plan' WHERE by = 'project';
   UPDATE feedback SET context = json_set(json_remove(context, '$.project'), '$.plan', json_extract(context, '$.project')) WHERE json_extract(context, '$.project') IS NOT NULL;
   ALTER TABLE cards RENAME COLUMN becomes_project TO becomes_plan;
   ALTER TABLE decisions RENAME COLUMN project_id TO plan_id;`,
  // a workstation was a "workspace" before the word went to the instance level: the table, the
  // card's column, and a card's wait for a free one (JSON `Queue`)
  `ALTER TABLE workspaces RENAME TO workstations;
   ALTER TABLE cards RENAME COLUMN workspace TO workstation;
   UPDATE cards SET queue = json_set(json_remove(queue, '$.workspace'), '$.workstation', json_extract(queue, '$.workspace'))
    WHERE json_extract(queue, '$.workspace') IS NOT NULL;`,
  // a project was a "canvas" before the word went to the container of cards inside a project: the
  // table, every table's column pointing to it, the one index named after it, and the stored JSON
  // that names it (a card moved to another project, a repository made with its own project, a card
  // made on another project)
  `ALTER TABLE canvases RENAME TO projects;
   ALTER TABLE groups RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE cards RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE workstations RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE decisions RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE settings RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE preferences RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE talk RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE friction RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE commands RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE setting_proposals RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE feedback RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE chats RENAME COLUMN canvas_id TO project_id;
   DROP INDEX chats_canvas;
   CREATE INDEX chats_project ON chats (project_id, opened);
   UPDATE talk SET moved = json_set(json_remove(moved, '$.canvas', '$.canvasName'), '$.project', json_extract(moved, '$.canvas'), '$.projectName', json_extract(moved, '$.canvasName'))
    WHERE json_extract(moved, '$.canvas') IS NOT NULL;
   UPDATE cards SET new_repo = json_set(json_remove(new_repo, '$.canvas'), '$.project', json(new_repo -> '$.canvas'))
    WHERE json_extract(new_repo, '$.canvas') IS NOT NULL;
   UPDATE events SET made = json_set(json_remove(made, '$.canvas'), '$.project', json_extract(made, '$.canvas'))
    WHERE json_extract(made, '$.canvas') IS NOT NULL;`,
  // a project holds its cards on canvases: each gets "main", which holds every card and group it had
  // (`canvas_id` carries no foreign key, which would keep it from ever being dropped; the store keeps it valid)
  `CREATE TABLE canvases (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES projects(id),
     name TEXT NOT NULL,
     icon TEXT,
     position INTEGER NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE UNIQUE INDEX canvases_name ON canvases (project_id, name COLLATE NOCASE);
   INSERT INTO canvases (id, project_id, name, position, created_at) SELECT lower(hex(randomblob(16))), id, 'main', 0, created_at FROM projects;
   ALTER TABLE cards ADD COLUMN canvas_id TEXT;
   ALTER TABLE groups ADD COLUMN canvas_id TEXT;
   UPDATE cards SET canvas_id = (SELECT c.id FROM canvases c WHERE c.project_id = cards.project_id);
   UPDATE groups SET canvas_id = (SELECT c.id FROM canvases c WHERE c.project_id = groups.project_id);
   CREATE INDEX cards_canvas ON cards (canvas_id);`,
  // a card parked off the canvas, since when (ISO)
  'ALTER TABLE cards ADD COLUMN parking_lot TEXT;',
  // the Activity log: what happened on a card, typed (`ActivityCode`), by whom, with the card it waits for, the harness whose limit stopped it, or the title of a card it deleted
  `CREATE TABLE activity (
     id INTEGER PRIMARY KEY,
     at TEXT NOT NULL,
     card_id TEXT NOT NULL REFERENCES cards(id),
     who TEXT NOT NULL,
     code TEXT NOT NULL,
     other_id TEXT REFERENCES cards(id),
     harness TEXT,
     title TEXT
   );
   CREATE INDEX activity_card ON activity (card_id, id);`,
];

const EVENT_COLUMNS = 'id, card_id AS cardId, at, kind, author, text, code, images, mocks, reply_to AS replyTo, spot, answer, picks, unread, read_after AS readAfter, wish, reply, forwarded, agent, token, made';
type EventRow = Omit<CardEvent, 'images' | 'mocks' | 'replyTo' | 'spot' | 'answer' | 'picks' | 'unread' | 'readAfter' | 'wish' | 'reply' | 'forwarded' | 'agent' | 'token' | 'made'> & {
  agent: string | null;
  code: CardEvent['code'] | null;
  images: string | null;
  mocks: string | null;
  replyTo: number | null;
  spot: string | null;
  answer: string | null;
  picks: string | null;
  unread: number | null;
  readAfter: number | null;
  wish: string | null;
  reply: number | null;
  forwarded: number | null;
  token: number | null;
  made: string | null;
};
const eventOf = ({ code, images, mocks, replyTo, spot, answer, picks, unread, readAfter, wish, reply, forwarded, agent, token, made, ...e }: EventRow): CardEvent => ({
  ...e,
  ...(agent ? { agent: JSON.parse(agent) as AgentIdentity } : {}),
  ...(code ? { code } : {}),
  ...(images ? { images: JSON.parse(images) as string[] } : {}),
  ...(mocks ? { mocks: JSON.parse(mocks) as Mock[] } : {}),
  ...(replyTo ? { replyTo } : {}),
  ...(spot ? { spot: JSON.parse(spot) as Spot } : {}),
  ...(answer ? { answer: JSON.parse(answer) as AnswerRef } : {}),
  ...(picks ? { picks: JSON.parse(picks) as string[] } : {}),
  ...(unread ? { unread: true as const } : {}),
  ...(readAfter ? { readAfter } : {}),
  ...(wish ? { wish: JSON.parse(wish) as Wish } : {}),
  ...(reply ? { reply: true as const } : {}),
  ...(forwarded ? { forwarded: true as const } : {}),
  ...(token ? { token: true as const } : {}),
  ...(made ? { made: JSON.parse(made) as NonNullable<CardEvent['made']> } : {}),
});

/** A card to store; without `canvas_id` it goes on its plan's canvas (a workstream), else on the project's `main`. */
export type NewRow = Pick<CardRow, 'project_id' | 'kind' | 'x' | 'y'> &
  Partial<Pick<CardRow, 'canvas_id' | 'state' | 'title' | 'body' | 'parent_id' | 'plan_ref' | 'from_id' | 'repo' | 'idea' | 'prototype_of' | 'prototype' | 'images' | 'retro' | 'proposal' | 'group_id'>>;

/** What `Store.update` may change on a card: all but what is set once at its creation, and its times. */
export type RowUpdate = Partial<Omit<CardRow, 'id' | 'project_id' | 'canvas_id' | 'parent_id' | 'plan_ref' | 'prototype_of' | 'retro' | 'created_at' | 'updated_at'>>;

/** A database this Seismic cannot open as it is: it leaves it alone. */
export class UnusableDatabase extends Error {}

/** The database was written by a newer Seismic (the checkout and the app share one home). */
export class NewerDatabase extends UnusableDatabase {
  constructor(path: string, version: number, known: number) {
    super(`${path} is from a newer Seismic (schema ${version}; this one knows ${known}): update Seismic or start the newer one`);
  }
}

/** The database was written by an Seismic before the release and not brought up to it. */
export class OlderDatabase extends UnusableDatabase {
  constructor(path: string, version: number) {
    super(
      `${path} is from an Seismic before its release (schema ${version}): start the Seismic of commit 1cfa1dd once to bring it up to date, or move it away to start afresh`,
    );
  }
}

/** How many `<db>.before-<version>` backups stay beside the database. */
export const BACKUPS_KEPT = 3;

/** A consistent copy of the database as it is before migrating to `target`, with only the newest backups kept. */
function backUpBefore(db: Database, path: string, target: number) {
  const copy = `${path}.before-${target}`;
  rmSync(copy, { force: true });
  db.run('VACUUM INTO ?', [copy]);
  const prefix = `${basename(path)}.before-`;
  const old = readdirSync(dirname(path))
    .filter((f) => f.startsWith(prefix) && /^\d+$/.test(f.slice(prefix.length)))
    .sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)))
    .slice(BACKUPS_KEPT);
  for (const f of old) rmSync(join(dirname(path), f), { force: true });
}

export class Store {
  readonly db: Database;
  readonly orm: Db;
  readonly devices: Devices;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { strict: true });
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA foreign_keys = ON');
    const { user_version } = this.db.query('PRAGMA user_version').get() as { user_version: number };
    const latest = RELEASED + MIGRATIONS.length;
    if (user_version > latest || (user_version > 0 && user_version < RELEASED)) {
      this.db.close();
      throw user_version > latest ? new NewerDatabase(path, user_version, latest) : new OlderDatabase(path, user_version);
    }
    if (user_version === 0)
      this.db.transaction(() => {
        this.db.run(SCHEMA);
        this.db.run(`PRAGMA user_version = ${RELEASED}`);
      })();
    if (user_version >= RELEASED && user_version < latest && path !== ':memory:') backUpBefore(this.db, path, latest);
    for (let v = Math.max(user_version, RELEASED); v < latest; v++) {
      this.db.transaction(() => {
        this.db.run(MIGRATIONS[v - RELEASED]!);
        this.db.run(`PRAGMA user_version = ${v + 1}`);
      })();
    }
    this.orm = drizzle({ client: this.db, schema });
    this.devices = new Devices(this.orm);
  }

  /** A project's name as last stored; none for a project this database has never seen. */
  projectName(id: string): string | null {
    return (this.db.query('SELECT name FROM projects WHERE id = $id').get({ id }) as { name: string } | null)?.name ?? null;
  }

  /**
   * The card goes to another project, at `at` on its canvas `canvasId` (else its `main`), with its history and decisions: into that project's
   * home repository (`repo` null) and out of its group, which belongs to the project it leaves.
   */
  moveCard(id: string, projectId: string, at: { x: number; y: number }, fields: RowUpdate = {}, canvasId?: string) {
    this.db.transaction(() => {
      this.update(id, { ...fields, x: at.x, y: at.y, repo: null, group_id: null });
      this.db.query('UPDATE cards SET project_id = $c, canvas_id = $v WHERE id = $id').run({ id, c: projectId, v: canvasId ?? this.mainCanvas(projectId) });
      this.db.query('UPDATE decisions SET project_id = $c WHERE card_id = $id').run({ id, c: projectId });
      this.db.query('UPDATE feedback SET project_id = $c WHERE card_id = $id').run({ id, c: projectId });
    })();
  }

  /** The project is known by this name, with its canvas `main` once it has none. */
  ensureProject(id: string, name: string) {
    this.db.transaction(() => {
      this.db
        .query('INSERT INTO projects (id, name, created_at) VALUES ($id, $name, $now) ON CONFLICT(id) DO UPDATE SET name = $name')
        .run({ id, name, now: now() });
      if (!this.db.query('SELECT 1 FROM canvases WHERE project_id = $id').get({ id })) this.insertCanvas(id, MAIN_CANVAS, null);
    })();
  }

  // ---------------------------------------------------------------- canvases

  /** The project's canvases in the owner's order. */
  canvases(projectId: string): CanvasRow[] {
    return this.db.query('SELECT * FROM canvases WHERE project_id = $c ORDER BY position, rowid').all({ c: projectId }) as CanvasRow[];
  }

  canvas(id: string): CanvasRow | null {
    return (this.db.query('SELECT * FROM canvases WHERE id = $id').get({ id }) as CanvasRow | null) ?? null;
  }

  /** The id of the project's canvas `main`, which every project has from `ensureProject` on (or from here, for a project stored without it). */
  mainCanvas(projectId: string): string {
    const row = this.db.query('SELECT id FROM canvases WHERE project_id = $c AND name = $main').get({ c: projectId, main: MAIN_CANVAS }) as { id: string } | null;
    return row?.id ?? this.insertCanvas(projectId, MAIN_CANVAS, null);
  }

  /** A new canvas, last in the project's order. */
  addCanvas(projectId: string, name: string, icon: string | null): CanvasRow {
    return this.canvas(this.insertCanvas(projectId, name, icon))!;
  }

  private insertCanvas(projectId: string, name: string, icon: string | null): string {
    const id = crypto.randomUUID();
    this.db
      .query(
        'INSERT INTO canvases (id, project_id, name, icon, position, created_at) VALUES ($id, $c, $name, $icon, (SELECT COALESCE(MAX(position) + 1, 0) FROM canvases WHERE project_id = $c), $now)',
      )
      .run({ id, c: projectId, name, icon, now: now() });
    return id;
  }

  updateCanvas(id: string, fields: Partial<Pick<CanvasRow, 'name' | 'icon'>>) {
    const keys = Object.keys(fields) as (keyof typeof fields)[];
    if (!keys.length) return;
    this.db.query(`UPDATE canvases SET ${keys.map((k) => `${k} = $${k}`).join(', ')} WHERE id = $id`).run({ ...fields, id });
  }

  /** The project's canvases take this order (their ids, all of them). */
  orderCanvases(ids: string[]) {
    const stmt = this.db.query('UPDATE canvases SET position = $p WHERE id = $id');
    this.db.transaction(() => ids.forEach((id, p) => stmt.run({ id, p })))();
  }

  /** How many cards are on the canvas: on the project, not archived or deleted. */
  cardsOnCanvas(id: string): number {
    return (this.db.query('SELECT count(*) AS n FROM cards WHERE canvas_id = $id AND deleted_at IS NULL AND archived_at IS NULL').get({ id }) as { n: number }).n;
  }

  /** The canvas goes; what is left of it (archived and deleted cards, their groups) goes to canvas `into`, where it comes back; a group whose name `into` has already (in any case) is merged into that one. */
  deleteCanvas(id: string, into: string) {
    this.db.transaction(() => {
      this.db.query('UPDATE cards SET canvas_id = $into WHERE canvas_id = $id').run({ id, into });
      const twins = this.db
        .query('SELECT g.id AS gone, (SELECT k.id FROM groups k WHERE k.canvas_id = $into AND lower(k.name) = lower(g.name) ORDER BY k.created_at, k.rowid LIMIT 1) AS kept FROM groups g WHERE g.canvas_id = $id')
        .all({ id, into }) as { gone: string; kept: string | null }[];
      for (const { gone, kept } of twins) {
        if (!kept) continue;
        this.db.query('UPDATE cards SET group_id = $kept WHERE group_id = $gone').run({ gone, kept });
        this.db.query('DELETE FROM groups WHERE id = $gone').run({ gone });
      }
      this.db.query('UPDATE groups SET canvas_id = $into WHERE canvas_id = $id').run({ id, into });
      this.db.query('DELETE FROM canvases WHERE id = $id').run({ id });
      const left = this.db.query('SELECT id FROM canvases WHERE project_id = (SELECT project_id FROM canvases WHERE id = $into) ORDER BY position, rowid').all({ into }) as { id: string }[];
      this.orderCanvases(left.map((r) => r.id));
    })();
  }

  /** The cards (plans with their workstreams) go onto the canvas, out of their groups, which stay on the canvas they leave. */
  setCanvas(cardIds: string[], canvasId: string) {
    const stmt = this.db.query('UPDATE cards SET canvas_id = $v, group_id = NULL, updated_at = $now WHERE id = $id OR parent_id = $id');
    this.db.transaction(() => cardIds.forEach((id) => stmt.run({ id, v: canvasId, now: now() })))();
  }

  /** Every card on the project: not deleted, not archived. */
  cards(projectId: string): CardRow[] {
    return this.db.query('SELECT * FROM cards WHERE project_id = $c AND deleted_at IS NULL AND archived_at IS NULL').all({ c: projectId }) as CardRow[];
  }

  /** The project's cards, archived ones too, that were ever shared or are about to be. */
  shared(projectId: string): CardRow[] {
    return this.db.query('SELECT * FROM cards WHERE project_id = $c AND deleted_at IS NULL AND share IS NOT NULL').all({ c: projectId }) as CardRow[];
  }

  /** The project's archive, the most recently archived first. */
  archived(projectId: string): CardRow[] {
    return this.db
      .query('SELECT * FROM cards WHERE project_id = $c AND deleted_at IS NULL AND archived_at IS NOT NULL ORDER BY archived_at DESC, created_at DESC')
      .all({ c: projectId }) as CardRow[];
  }

  /** The project's plans, on the project or archived. */
  plans(projectId: string): CardRow[] {
    return this.db.query("SELECT * FROM cards WHERE project_id = $c AND deleted_at IS NULL AND kind = 'plan' AND plan_ref IS NOT NULL").all({ c: projectId }) as CardRow[];
  }

  /** The cards whose landed work added plan docs, on the project or archived. */
  withPlanDocs(projectId: string): CardRow[] {
    return this.db.query('SELECT * FROM cards WHERE project_id = $c AND deleted_at IS NULL AND plan_docs IS NOT NULL').all({ c: projectId }) as CardRow[];
  }

  /** The project's prototypes, on the project or archived, the oldest first: which they are, without the rest of their rows. */
  prototypes(projectId: string): Pick<CardRow, 'id' | 'prototype_of' | 'archived_at'>[] {
    return this.db
      .query('SELECT id, prototype_of, archived_at FROM cards WHERE project_id = $c AND deleted_at IS NULL AND prototype_of IS NOT NULL ORDER BY created_at, rowid')
      .all({ c: projectId }) as Pick<CardRow, 'id' | 'prototype_of' | 'archived_at'>[];
  }

  /** The workstreams of the given plans. */
  children(parentIds: string[]): CardRow[] {
    if (!parentIds.length) return [];
    return this.db
      .query(`SELECT * FROM cards WHERE deleted_at IS NULL AND parent_id IN (${parentIds.map((_, i) => `$p${i}`).join(', ')})`)
      .all(Object.fromEntries(parentIds.map((id, i) => [`p${i}`, id]))) as CardRow[];
  }

  /** Deletes the owner's cards left empty (no title, text or screenshots), created before `before`; returns how many. */
  sweepUntitled(projectId: string, before: string): number {
    return this.db
      .query(
        `UPDATE cards SET deleted_at = $now
         WHERE project_id = $c AND plan_ref IS NULL AND deleted_at IS NULL AND state = 'planned'
           AND TRIM(COALESCE(title, '')) = '' AND TRIM(COALESCE(body, '')) = '' AND images IS NULL
           AND created_at < $before`,
      )
      .run({ c: projectId, before, now: now() }).changes;
  }

  /** The proposals an agent made from a card, deleted and archived ones too, oldest first. */
  proposalsFrom(projectId: string, fromId: string): CardRow[] {
    return this.db.query('SELECT * FROM cards WHERE project_id = $c AND from_id = $f AND proposal IS NOT NULL ORDER BY created_at, rowid').all({ c: projectId, f: fromId }) as CardRow[];
  }

  /** Of the given cards, those on another project than `projectId` and not deleted: with their project, its name and their title. */
  elsewhere(ids: string[], projectId: string): { id: string; project: string; projectName: string | null; title: string | null }[] {
    if (!ids.length) return [];
    return this.db
      .query(
        `SELECT c.id, c.project_id AS project, v.name AS projectName, c.title FROM cards c LEFT JOIN projects v ON v.id = c.project_id
         WHERE c.id IN (SELECT value FROM json_each($ids)) AND c.project_id != $c AND c.deleted_at IS NULL`,
      )
      .all({ ids: JSON.stringify(ids), c: projectId }) as { id: string; project: string; projectName: string | null; title: string | null }[];
  }

  card(id: string): CardRow | null {
    return (this.db.query('SELECT * FROM cards WHERE id = $id').get({ id }) as CardRow | null) ?? null;
  }

  /** The rows of these cards, deleted or archived ones too. */
  cardsById(ids: string[]): CardRow[] {
    if (!ids.length) return [];
    return this.db.query('SELECT * FROM cards WHERE id IN (SELECT value FROM json_each($ids))').all({ ids: JSON.stringify(ids) }) as CardRow[];
  }

  insert(rows: NewRow[]): CardRow[] {
    const stmt = this.db.query(
      `INSERT INTO cards (id, short, project_id, canvas_id, kind, state, title, body, x, y, parent_id, plan_ref, from_id, repo, idea, prototype_of, prototype, images, retro, proposal, group_id, created_at, updated_at)
       VALUES ($id, $short, $project_id, $canvas_id, $kind, $state, $title, $body, $x, $y, $parent_id, $plan_ref, $from_id, $repo, $idea, $prototype_of, $prototype, $images, $retro, $proposal, $group_id, $now, $now)`,
    );
    const taken = this.db.query('SELECT 1 FROM cards WHERE short = $s');
    const mains = new Map<string, string>();
    const canvasOf = (r: NewRow) =>
      r.canvas_id ?? (r.parent_id ? this.card(r.parent_id)?.canvas_id : undefined) ?? mains.get(r.project_id) ?? mains.set(r.project_id, this.mainCanvas(r.project_id)).get(r.project_id)!;
    const ids = this.db.transaction(() =>
      rows.map((r) => {
        const id = crypto.randomUUID();
        // the shortest start of its hex digits no other card has as its code; the whole of them is its own
        const hex = id.replaceAll('-', '');
        let n = SHORT;
        while (n < hex.length && taken.get({ s: hex.slice(0, n) })) n++;
        stmt.run({
          id,
          short: hex.slice(0, n),
          project_id: r.project_id,
          canvas_id: canvasOf(r),
          kind: r.kind,
          state: r.state ?? null,
          title: r.title ?? null,
          body: r.body ?? null,
          x: r.x,
          y: r.y,
          parent_id: r.parent_id ?? null,
          plan_ref: r.plan_ref ?? null,
          from_id: r.from_id ?? null,
          repo: r.repo ?? null,
          idea: r.idea ?? null,
          prototype_of: r.prototype_of ?? null,
          prototype: r.prototype ?? null,
          images: r.images ?? null,
          retro: r.retro ?? null,
          proposal: r.proposal ?? null,
          group_id: r.group_id ?? null,
          now: now(),
        });
        return id;
      }),
    )();
    return ids.map((id) => this.card(id)!);
  }

  /** Since when each of the project's cards waits for the owner, for those that do. */
  waitingSince(projectId: string): Map<string, string> {
    const rows = this.db.query('SELECT id, waiting_since AS since FROM cards WHERE project_id = $c AND waiting_since IS NOT NULL').all({ c: projectId }) as { id: string; since: string }[];
    return new Map(rows.map((r) => [r.id, r.since]));
  }

  /** Notes since when a card waits for the owner, or that it no longer does (`null`); the card counts as unchanged. */
  setWaitingSince(id: string, since: string | null) {
    this.db.query('UPDATE cards SET waiting_since = $since WHERE id = $id').run({ id, since });
  }

  update(id: string, fields: RowUpdate) {
    const keys = Object.keys(fields) as (keyof typeof fields)[];
    if (!keys.length) return;
    const set = keys.map((k) => `${k} = $${k}`).join(', ');
    this.db.query(`UPDATE cards SET ${set}, updated_at = $now WHERE id = $id`).run({ ...fields, id, now: now() });
  }

  /** Puts the card on another workstream (`planRef`, in plan `parentId`), or takes it out of its plan (both null). */
  replan(id: string, planRef: string | null, parentId: string | null) {
    this.db.query('UPDATE cards SET plan_ref = $ref, parent_id = $parent, updated_at = $now WHERE id = $id').run({ id, ref: planRef, parent: parentId, now: now() });
  }

  /** The last line of the card's log that names a branch of its own (`obeya/<slug>-<id>…`). */
  branchMention(cardId: string): string | null {
    const row = this.db
      .query("SELECT text FROM events WHERE card_id = $id AND text LIKE '%obeya/%' || $short || '%' ORDER BY id DESC LIMIT 1")
      .get({ id: cardId, short: cardId.slice(0, 6) }) as { text: string } | null;
    return row?.text ?? null;
  }

  // ---------------------------------------------------------------- groups

  /** The project's groups, the oldest first. */
  groups(projectId: string): GroupRow[] {
    return this.db.query('SELECT * FROM groups WHERE project_id = $c ORDER BY created_at, rowid').all({ c: projectId }) as GroupRow[];
  }

  group(id: string): GroupRow | null {
    return (this.db.query('SELECT * FROM groups WHERE id = $id').get({ id }) as GroupRow | null) ?? null;
  }

  /** A new group on canvas `canvasId` (else the project's `main`). */
  addGroup(projectId: string, name: string, hue: number, canvasId?: string): GroupRow {
    const id = crypto.randomUUID();
    this.db
      .query('INSERT INTO groups (id, project_id, canvas_id, name, hue, created_at) VALUES ($id, $c, $v, $name, $hue, $now)')
      .run({ id, c: projectId, v: canvasId ?? this.mainCanvas(projectId), name, hue, now: now() });
    return this.group(id)!;
  }

  /** The cards in the group, on the project or in the archive. */
  groupCards(id: string): string[] {
    return (this.db.query('SELECT id FROM cards WHERE group_id = $id AND deleted_at IS NULL ORDER BY rowid').all({ id }) as { id: string }[]).map((r) => r.id);
  }

  renameGroup(id: string, name: string) {
    this.db.query('UPDATE groups SET name = $name WHERE id = $id').run({ id, name });
  }

  /** Puts the cards into the group, or with `null` into none. */
  setGroup(cardIds: string[], groupId: string | null) {
    const stmt = this.db.query('UPDATE cards SET group_id = $g, updated_at = $now WHERE id = $id');
    this.db.transaction(() => cardIds.forEach((id) => stmt.run({ id, g: groupId, now: now() })))();
  }

  /** Removes the groups no card belongs to, on the project or in the archive; returns how many. */
  dropEmptyGroups(projectId: string): number {
    return this.db.transaction(() => {
      // a deleted card that comes back has no group any more
      this.db
        .query('UPDATE cards SET group_id = NULL WHERE project_id = $c AND deleted_at IS NOT NULL AND group_id IS NOT NULL')
        .run({ c: projectId });
      return this.db
        .query('DELETE FROM groups WHERE project_id = $c AND id NOT IN (SELECT group_id FROM cards WHERE project_id = $c AND group_id IS NOT NULL)')
        .run({ c: projectId }).changes;
    })();
  }

  // ---------------------------------------------------------------- activity

  /**
   * Writes a line of the Activity log. A card waiting or limited repeats itself as its waits are read
   * again: `again` says which latest line of the card is the same one, and then nothing is written.
   */
  addActivity(a: { cardId: string; code: ActivityCode; who: ActivityWho; otherId?: string; harness?: string; title?: string }, again?: (last: { code: ActivityCode; otherId: string | null; harness: string | null }) => boolean): boolean {
    if (again) {
      const last = this.db.query('SELECT code, other_id AS otherId, harness FROM activity WHERE card_id = $c ORDER BY id DESC LIMIT 1').get({ c: a.cardId }) as { code: ActivityCode; otherId: string | null; harness: string | null } | null;
      if (last && again(last)) return false;
    }
    this.db
      .query('INSERT INTO activity (at, card_id, who, code, other_id, harness, title) VALUES ($at, $cardId, $who, $code, $otherId, $harness, $title)')
      .run({ at: now(), cardId: a.cardId, who: a.who, code: a.code, otherId: a.otherId ?? null, harness: a.harness ?? null, title: a.title ?? null });
    return true;
  }

  /** The newest `limit` lines of the log of these projects (all when none are named) older than line `before`, newest first; one more than asked comes back when older lines remain. */
  activity(projectIds: string[] | null, before: number | undefined, limit: number): ActivityRow[] {
    return this.db
      .query(
        `SELECT a.id, a.at, a.who, a.code, a.card_id AS cardId, a.other_id AS otherId, a.harness, a.title, c.project_id AS projectId, o.title AS otherTitle
         FROM activity a JOIN cards c ON c.id = a.card_id LEFT JOIN cards o ON o.id = a.other_id
         WHERE ($before IS NULL OR a.id < $before) AND ($projects IS NULL OR c.project_id IN (SELECT value FROM json_each($projects)))
         ORDER BY a.id DESC LIMIT $limit`,
      )
      .all({ before: before ?? null, projects: projectIds ? JSON.stringify(projectIds) : null, limit: limit + 1 }) as ActivityRow[];
  }

  // ---------------------------------------------------------------- events

  /** A line in a card's log, said now or (`at`) earlier: a thread copied onto its Question card keeps its times. */
  addEvent(e: Omit<CardEvent, 'id' | 'at'> & { at?: string }): CardEvent {
    const at = e.at ?? now();
    // An explicitly absent identity keeps copied historical messages unknown, even inside another agent's context.
    const agent = 'agent' in e ? e.agent : (e.author !== 'owner' && e.author !== 'obeya' ? currentAgent() : undefined);
    const { id } = this.db
      .query(
        'INSERT INTO events (card_id, at, kind, author, text, code, images, mocks, reply_to, spot, answer, picks, unread, wish, reply, forwarded, agent, token, made) VALUES ($cardId, $at, $kind, $author, $text, $code, $images, $mocks, $replyTo, $spot, $answer, $picks, $unread, $wish, $reply, $forwarded, $agent, $token, $made) RETURNING id',
      )
      .get({
        ...e,
        agent: agent ? JSON.stringify(agent) : null,
        answer: e.answer ? JSON.stringify(e.answer) : null,
        code: e.code ?? null,
        images: e.images?.length ? JSON.stringify(e.images) : null,
        mocks: e.mocks?.length ? JSON.stringify(e.mocks) : null,
        replyTo: e.replyTo ?? null,
        spot: e.spot ? JSON.stringify(e.spot) : null,
        picks: e.picks?.length ? JSON.stringify(e.picks) : null,
        unread: e.unread ? 1 : null,
        wish: e.wish ? JSON.stringify(e.wish) : null,
        reply: e.reply ? 1 : null,
        forwarded: e.forwarded ? 1 : null,
        token: e.token ? 1 : null,
        made: e.made ? JSON.stringify(e.made) : null,
        at,
      }) as { id: number };
    return { ...e, ...(agent ? { agent } : {}), id, at };
  }

  /** The latest messages of the card's conversation (`talk`, `question`), however many other lines came between them, oldest first. */
  talkOf(cardId: string, limit: number): CardEvent[] {
    const rows = this.db
      .query(`SELECT ${EVENT_COLUMNS} FROM events WHERE card_id = $c AND kind IN ('talk', 'question') ORDER BY id DESC LIMIT $limit`)
      .all({ c: cardId, limit }) as EventRow[];
    return rows.reverse().map(eventOf);
  }

  events(cardId: string, limit = 500): CardEvent[] {
    const rows = this.db
      .query(`SELECT ${EVENT_COLUMNS} FROM events WHERE card_id = $c ORDER BY id DESC LIMIT $limit`)
      .all({ c: cardId, limit }) as EventRow[];
    return rows.reverse().map(eventOf);
  }

  /**
   * The agent read the owner's words of these events now: they are read, and those logged before
   * the card's latest line that was read stand after it (`readAfter`). Returns those that were unread, as they are now.
   */
  readEvents(cardId: string, ids: number[]): CardEvent[] {
    return this.db.transaction(() => {
      ids = ids.filter((id) => this.event(cardId, id)?.unread);
      if (!ids.length) return [];
      const { last } = this.db.query('SELECT MAX(id) AS last FROM events WHERE card_id = $c AND unread IS NULL').get({ c: cardId }) as { last: number | null };
      const read = this.db.query('UPDATE events SET unread = NULL, read_after = CASE WHEN $last > id THEN $last END WHERE card_id = $c AND id = $id AND unread = 1');
      for (const id of ids) read.run({ c: cardId, id, last });
      return ids.map((id) => this.event(cardId, id)).filter((e) => !!e);
    })();
  }

  /** Takes an event out of the card's log. */
  deleteEvent(cardId: string, id: number) {
    this.db.query('DELETE FROM events WHERE card_id = $c AND id = $id').run({ c: cardId, id });
  }

  /** One event of the card's log. */
  event(cardId: string, id: number): CardEvent | undefined {
    const row = this.db.query(`SELECT ${EVENT_COLUMNS} FROM events WHERE card_id = $c AND id = $id`).get({ c: cardId, id }) as EventRow | null;
    return row ? eventOf(row) : undefined;
  }

  // ---------------------------------------------------------------- workstations

  addWorkstation(projectId: string, path: string, repo: string | null = null) {
    this.db.query('INSERT INTO workstations (path, project_id, repo) VALUES ($path, $c, $repo) ON CONFLICT(path) DO NOTHING').run({ path, c: projectId, repo });
  }

  /** The workstations of one repository on the project (`null`: its home repository). */
  workstations(projectId: string, repo: string | null = null): { path: string; card_id: string | null }[] {
    return this.db
      .query('SELECT path, card_id FROM workstations WHERE project_id = $c AND repo IS $repo ORDER BY path')
      .all({ c: projectId, repo }) as { path: string; card_id: string | null }[];
  }

  /** Whether a workstation is registered, on any project. */
  hasWorkstation(path: string): boolean {
    return !!this.db.query('SELECT 1 FROM workstations WHERE path = $path').get({ path });
  }

  removeWorkstation(path: string) {
    this.db.query('DELETE FROM workstations WHERE path = $path').run({ path });
  }

  setLease(path: string, cardId: string | null) {
    this.db.query('UPDATE workstations SET card_id = $cardId WHERE path = $path').run({ path, cardId });
  }

  // ---------------------------------------------------------------- decisions

  addDecision(d: Omit<DecisionRow, 'id' | 'at'>) {
    this.db
      .query('INSERT INTO decisions (project_id, plan_id, card_id, question, answer, by, at) VALUES ($project_id, $plan_id, $card_id, $question, $answer, $by, $at)')
      .run({ ...d, at: now() });
  }

  /** The decisions taken on one card outside any plan (an idea's, say). */
  cardDecisions(projectId: string, cardId: string): DecisionRow[] {
    return this.db
      .query('SELECT * FROM decisions WHERE project_id = $c AND card_id = $card AND plan_id IS NULL ORDER BY id')
      .all({ c: projectId, card: cardId }) as DecisionRow[];
  }

  /** A plan's decisions, or with `null` those of the project's standalone cards. */
  decisions(projectId: string, planId: string | null, limit = 40): DecisionRow[] {
    return (
      this.db
        .query('SELECT * FROM decisions WHERE project_id = $c AND plan_id IS $p ORDER BY id DESC LIMIT $limit')
        .all({ c: projectId, p: planId, limit }) as DecisionRow[]
    ).reverse();
  }

  // ---------------------------------------------------------------- preferences

  /** The project's preferences, oldest first: those in the given states, or all. */
  preferences(projectId: string, states?: PreferenceState[]): Preference[] {
    return (
      this.db.query('SELECT * FROM preferences WHERE project_id = $c AND deleted_at IS NULL ORDER BY id').all({ c: projectId }) as {
        id: number;
        text: string;
        card_id: string | null;
        state: PreferenceState;
        quote: string | null;
        review: number;
        replaces: number | null;
        target: string | null;
      }[]
    )
      .filter((r) => !states || states.includes(r.state))
      .map((r) => ({
        id: r.id,
        text: r.text,
        state: r.state,
        ...(r.card_id ? { cardId: r.card_id } : {}),
        ...(r.quote ? { quote: r.quote } : {}),
        ...(r.review ? { review: true } : {}),
        ...(r.replaces !== null ? { replaces: r.replaces } : {}),
        ...(r.target ? { target: r.target } : {}),
      }));
  }

  addPreference(
    projectId: string,
    text: string,
    cardId: string | null,
    proposal?: { quote?: string; review?: boolean; replaces?: number; target?: string },
  ): number {
    return (
      this.db
        .query(
          `INSERT INTO preferences (project_id, text, card_id, created_at, state, quote, review, replaces, target)
           VALUES ($c, $text, $cardId, $now, $state, $quote, $review, $replaces, $target) RETURNING id`,
        )
        .get({
          c: projectId,
          text,
          cardId,
          now: now(),
          state: proposal ? 'proposed' : 'active',
          quote: proposal?.quote ?? null,
          review: proposal?.review ? 1 : 0,
          replaces: proposal?.replaces ?? null,
          target: proposal?.target ?? null,
        }) as { id: number }
    ).id;
  }

  /** A rule the owner gives outright for the CLAUDE.md of the repository `target`: filed at once, without a proposal. */
  fileRule(projectId: string, text: string, cardId: string | null, target: string): number {
    return (
      this.db
        .query(
          `INSERT INTO preferences (project_id, text, card_id, created_at, state, target)
           VALUES ($c, $text, $cardId, $now, 'filed', $target) RETURNING id`,
        )
        .get({ c: projectId, text, cardId, now: now(), target }) as { id: number }
    ).id;
  }

  /** Changes or (with `null`) deletes a preference of the project; returns whether it existed. */
  setPreference(projectId: string, id: number, text: string | null): boolean {
    const r =
      text === null
        ? this.db.query('UPDATE preferences SET deleted_at = $now WHERE id = $id AND project_id = $c AND deleted_at IS NULL').run({ id, c: projectId, now: now() })
        : this.db.query('UPDATE preferences SET text = $text WHERE id = $id AND project_id = $c AND deleted_at IS NULL').run({ id, c: projectId, text });
    return r.changes > 0;
  }

  /**
   * Accepts or rejects an open proposal; returns whether there was one. Accepted, it becomes an
   * active rule, or one filed for the repository `target`, whose CLAUDE.md it goes into.
   */
  decideProposal(projectId: string, id: number, state: 'active' | 'rejected', target?: string | null): boolean {
    return (
      this.db
        .query(
          `UPDATE preferences SET state = $state, decided_at = $now, target = CASE WHEN $keep THEN target ELSE $target END
           WHERE id = $id AND project_id = $c AND state = 'proposed' AND deleted_at IS NULL`,
        )
        .run({ id, c: projectId, state: state === 'active' && target ? 'filed' : state, now: now(), keep: target === undefined, target: target ?? null }).changes > 0
    );
  }

  // ---------------------------------------------------------------- the Koordinator's memory

  /** The chat new words on the project go into: the one the owner opened last; a first one where there is none. */
  chat(projectId: string): number {
    const r = this.db.query('SELECT id FROM chats WHERE project_id = $c ORDER BY opened DESC, id DESC LIMIT 1').get({ c: projectId }) as { id: number } | null;
    if (r) return r.id;
    const at = now();
    return (this.db.query('INSERT INTO chats (project_id, at, opened) VALUES ($c, $at, $at) RETURNING id').get({ c: projectId, at }) as { id: number }).id;
  }

  chatModel(projectId: string): AgentModel | undefined {
    return (this.db.query('SELECT model FROM chats WHERE id = $id').get({ id: this.chat(projectId) }) as { model: AgentModel | null }).model ?? undefined;
  }

  private nextChatOpening(projectId: string): string {
    const latest = this.db.query('SELECT MAX(opened) AS opened FROM chats WHERE project_id = $c').get({ c: projectId }) as { opened: string | null };
    return new Date(Math.max(Date.now(), latest.opened ? Date.parse(latest.opened) + 1 : 0)).toISOString();
  }

  setChatModel(projectId: string, model?: AgentModel): void {
    this.db.query('UPDATE chats SET model = $model WHERE id = $id AND project_id = $c').run({ id: this.chat(projectId), c: projectId, model: model ?? null });
  }

  /** A new chat to go on in; the current one while nothing was said in it yet. */
  newChat(projectId: string): number {
    const current = this.chat(projectId);
    if (!this.db.query('SELECT 1 FROM talk WHERE chat = $id').get({ id: current })) return current;
    const at = this.nextChatOpening(projectId);
    return (this.db.query('INSERT INTO chats (project_id, at, opened) VALUES ($c, $at, $at) RETURNING id').get({ c: projectId, at }) as { id: number }).id;
  }

  /** The owner goes back to chat `id`: new words go into it. A chat left without a word in it goes. Whether `id` is the project's. */
  openChat(projectId: string, id: number): boolean {
    if (!this.db.query('SELECT 1 FROM chats WHERE id = $id AND project_id = $c').get({ id, c: projectId })) return false;
    this.db.transaction(() => {
      this.db.query('UPDATE chats SET opened = $at WHERE id = $id').run({ id, at: this.nextChatOpening(projectId) });
      this.db.query('DELETE FROM chats WHERE project_id = $c AND id != $id AND NOT EXISTS (SELECT 1 FROM talk WHERE talk.chat = chats.id)').run({ c: projectId, id });
    })();
    return true;
  }

  /**
   * The chats with something said in them, the latest first, of one project or (none named) of all:
   * each with the owner's first words and when it was last talked in.
   */
  chats(projectId?: string, limit = 200): Chat[] {
    return (
      this.db
        .query(
          `SELECT h.id, h.project_id AS project, h.model, MAX(t.at) AS at,
             (SELECT said FROM talk f WHERE f.chat = h.id AND f.said != '' ORDER BY f.id LIMIT 1) AS title,
             SUM(t.unread) AS unread
           FROM chats h JOIN talk t ON t.chat = h.id
           WHERE ${projectId ? 'h.project_id = $c' : '1'}
           GROUP BY h.id ORDER BY at DESC LIMIT $limit`,
        )
        .all({ ...(projectId ? { c: projectId } : {}), limit }) as { id: number; project: string; model: AgentModel | null; at: string; title: string | null; unread: number }[]
    ).map((r) => ({ id: r.id, project: r.project, at: r.at, ...(r.model ? { model: r.model } : {}), ...(r.title ? { title: r.title } : {}), ...(r.unread ? { unread: r.unread } : {}) }));
  }

  /** An exchange of no one's in the project's sheet, `reply` saying the card moved to another project. */
  addMoved(projectId: string, moved: TalkMoved, reply: string): number {
    return (
      this.db.query("INSERT INTO talk (project_id, at, said, reply, moved, chat) VALUES ($c, $at, '', $reply, $moved, $chat) RETURNING id").get({ c: projectId, at: now(), reply, moved: JSON.stringify(moved), chat: this.chat(projectId) }) as {
        id: number;
      }
    ).id;
  }

  /** An exchange in the current chat; one the Koordinator takes up by itself (`after`, `answered`) goes into the chat of the exchange it takes up. */
  addTalk(projectId: string, said: string, reply: string, cardId: string | null, lookUp?: { question: string; about: string | null }, images: string[] = [], replyTo?: TalkRef, after?: TalkAfter, askedIn?: string, answered?: number): number {
    const from = after?.from ?? answered;
    const earlier = from === undefined ? undefined : ((this.db.query('SELECT chat FROM talk WHERE id = $id').get({ id: from }) as { chat: number | null } | null)?.chat ?? undefined);
    return (
      this.db
        .query(
          'INSERT INTO talk (project_id, at, said, reply, card_id, question, about, images, reply_to, after_wait, asked_in, after_answer, chat) VALUES ($c, $at, $said, $reply, $cardId, $question, $about, $images, $replyTo, $after, $askedIn, $answered, $chat) RETURNING id',
        )
        .get({
          c: projectId,
          chat: earlier ?? this.chat(projectId),
          at: now(),
          said,
          reply,
          cardId,
          question: lookUp?.question ?? null,
          about: lookUp?.about ?? null,
          images: images.length ? JSON.stringify(images) : null,
          replyTo: replyTo ? JSON.stringify({ talk: replyTo.talk, part: replyTo.part }) : null,
          after: after ? JSON.stringify(after) : null,
          askedIn: askedIn ?? null,
          answered: answered ?? null,
        }) as { id: number }
    ).id;
  }

  /**
   * The Koordinator's reply to words it has read, the question it looks up for them, and what a draft
   * for Seismic's makers would start from; with `waits`, one for the sheet waits there unread, as an
   * answer that was looked up does.
   */
  replyTalk(id: number, reply: string, lookUp?: { question: string; about: string | null }, wish?: Wish, waits = false, agent?: AgentIdentity) {
    if (arguments.length < 6) agent = currentAgent();
    this.db
      .query('UPDATE talk SET reply = $reply, reply_agent = $agent, question = $question, about = $about, wish = $wish, unread = $waits AND card_id IS NULL AND card IS NULL WHERE id = $id')
      .run({ id, reply, agent: agent ? JSON.stringify(agent) : null, question: lookUp?.question ?? null, about: lookUp?.about ?? null, wish: wish ? JSON.stringify(wish) : null, waits: waits ? 1 : 0 });
  }

  /**
   * Words the Koordinator was reading when Seismic stopped: they get `reply`; returns them. Words the
   * usage limit holds wait on; words asked in a plan's sheet the Koordinator never reads.
   */
  interruptTalk(projectId: string, reply: string): Talk[] {
    const rows = this.db.query("SELECT * FROM talk WHERE project_id = $c AND reply = '' AND held IS NULL AND asked_in IS NULL ORDER BY id").all({ c: projectId }) as TalkRow[];
    this.db.query("UPDATE talk SET reply = $reply WHERE project_id = $c AND reply = '' AND held IS NULL AND asked_in IS NULL").run({ c: projectId, reply });
    return rows.map(toTalk);
  }

  /** Words the usage limit keeps the Koordinator from reading until `held.until`; `null` once it reads them. */
  holdTalk(id: number, held: HeldTalk | null) {
    this.db.query('UPDATE talk SET held = $held WHERE id = $id').run({ id, held: held ? JSON.stringify(held) : null });
  }

  /** The words the usage limit holds, oldest first. */
  heldTalk(projectId: string): (Talk & { held: HeldTalk })[] {
    return (this.db.query('SELECT * FROM talk WHERE project_id = $c AND held IS NOT NULL ORDER BY id').all({ c: projectId }) as TalkRow[]).map((r) => ({ ...toTalk(r), held: JSON.parse(r.held!) as HeldTalk }));
  }

  /** The cards the Koordinator waits on after the exchange's reply; none once it no longer waits on any. */
  waitTalk(id: number, waits: TalkWaitRow[]) {
    this.db.query('UPDATE talk SET waits = $waits WHERE id = $id').run({ id, waits: waits.length ? JSON.stringify(waits) : null });
  }

  /** The exchanges whose reply said the Koordinator waits on a card, oldest first. */
  waitingTalk(projectId: string): (Talk & { waiting: TalkWaitRow[] })[] {
    return (this.db.query('SELECT * FROM talk WHERE project_id = $c AND waits IS NOT NULL ORDER BY id').all({ c: projectId }) as TalkRow[]).map((r) => ({ ...toTalk(r), waiting: JSON.parse(r.waits!) as TalkWaitRow[] }));
  }

  /**
   * The step the Koordinator takes once the exchange's looked-up answer is in, and where the owner
   * was on the project when they asked for it; `null` once it has decided it.
   */
  thenTalk(id: number, then: string | null, place?: Place) {
    this.db.query('UPDATE talk SET then_step = $then, then_place = $place WHERE id = $id').run({ id, then, place: then !== null && place ? JSON.stringify(place) : null });
  }

  /** Looked-up answers that are in, oldest first, whose step the Koordinator has not decided yet. */
  answeredSteps(projectId: string): Talk[] {
    return (this.db.query('SELECT * FROM talk WHERE project_id = $c AND then_step IS NOT NULL AND answer IS NOT NULL ORDER BY id').all({ c: projectId }) as TalkRow[]).map(toTalk);
  }

  undoTalk(id: number) {
    this.db.query('UPDATE talk SET undone = 1 WHERE id = $id').run({ id });
  }

  /** A command that waits for "Undo" until `due`; `body` is what runs then, as JSON. */
  holdCommand(projectId: string, token: string, due: string, body: string) {
    this.db.query('INSERT OR REPLACE INTO commands (token, project_id, due, body) VALUES ($token, $c, $due, $body)').run({ token, c: projectId, due, body });
  }

  dropCommand(token: string) {
    this.db.query('DELETE FROM commands WHERE token = $token').run({ token });
  }

  /** The commands still waiting, oldest first: after a restart, those the stopped server held. */
  heldCommands(projectId: string): { token: string; due: string; body: string }[] {
    return this.db.query('SELECT token, due, body FROM commands WHERE project_id = $c ORDER BY due').all({ c: projectId }) as { token: string; due: string; body: string }[];
  }

  /**
   * The answer to a looked-up question, with its files; one for the sheet (no card was open, and its
   * thread is on no Question card) waits there unread.
   */
  answerTalk(id: number, answer: string, by: 'koordinator' | 'plan', files: AnswerFile[] = [], agent?: AgentIdentity) {
    if (arguments.length < 5) agent = currentAgent();
    this.db
      .query('UPDATE talk SET answer = $answer, answer_agent = $agent, answer_by = $by, files = $files, unread = card_id IS NULL AND card IS NULL WHERE id = $id')
      .run({ id, answer, agent: agent ? JSON.stringify(agent) : null, by, files: files.length ? JSON.stringify(files) : null });
  }

  /** A follow-up continues the answer `follows`, in the thread `thread`. */
  followTalk(id: number, thread: number, follows: number) {
    this.db.query('UPDATE talk SET thread = $thread, follows = $follows WHERE id = $id').run({ id, thread, follows });
  }

  /** The session of the agent that looks the exchange's question up. */
  talkSession(id: number, session: string) {
    this.db.query('UPDATE talk SET session_id = $session WHERE id = $id').run({ id, session });
  }

  /** The exchanges of a thread, oldest first, with the session each was looked up in. */
  thread(projectId: string, thread: number): (Talk & { about?: string; session?: string })[] {
    return (this.db.query('SELECT * FROM talk WHERE project_id = $c AND (id = $t OR thread = $t) ORDER BY id').all({ c: projectId, t: thread }) as TalkRow[]).map((r) => ({
      ...withContinues(this.db, r),
      ...(r.about ? { about: r.about } : {}),
      ...(r.session_id ? { session: r.session_id } : {}),
    }));
  }

  /** The thread moved onto a Question card: its exchanges, and every follow-up asked later, are answered there. */
  moveThread(projectId: string, thread: number, card: string) {
    this.db.query('UPDATE talk SET card = $card, unread = 0 WHERE project_id = $c AND (id = $t OR thread = $t)').run({ c: projectId, t: thread, card });
  }

  /** The owner saw the sheet's answers, or (`ids`) those of a plan's sheet; whether any was unread. */
  readTalk(projectId: string, ids?: number[]): boolean {
    if (ids)
      return this.db.query('UPDATE talk SET unread = 0 WHERE project_id = $c AND unread = 1 AND id IN (SELECT value FROM json_each($ids))').run({ c: projectId, ids: JSON.stringify(ids) }).changes > 0;
    return this.db.query('UPDATE talk SET unread = 0 WHERE project_id = $c AND unread = 1 AND chat = $chat').run({ c: projectId, chat: this.chat(projectId) }).changes > 0;
  }

  /**
   * The latest exchanges of the threads about any of `about` (a plan and its workstreams), oldest
   * first: those its plan agent answers.
   */
  talkAbout(projectId: string, about: string[], limit = 100): Talk[] {
    return (
      this.db
        .query(
          `SELECT t.* FROM talk t JOIN talk r ON r.id = COALESCE(t.thread, t.id)
           WHERE t.project_id = $c AND r.about IN (SELECT value FROM json_each($about)) ORDER BY t.id DESC LIMIT $limit`,
        )
        .all({ c: projectId, about: JSON.stringify(about), limit }) as TalkRow[]
    )
      .reverse()
      .map((r) => withContinues(this.db, r));
  }

  /** The latest exchanges, oldest first; with `withoutCard`, only those without an open card; with `chat`, only that chat's. */
  talk(projectId: string, limit = 20, withoutCard = false, chat?: number): Talk[] {
    return (
      this.db
        .query(`SELECT * FROM talk WHERE project_id = $c${withoutCard ? ' AND card_id IS NULL' : ''}${chat !== undefined ? ' AND chat = $chat' : ''} ORDER BY id DESC LIMIT $limit`)
        .all({ c: projectId, limit, ...(chat !== undefined ? { chat } : {}) }) as TalkRow[]
    )
      .reverse()
      .map((r) => withContinues(this.db, r));
  }

  /** What Seismic's sheet shows: the latest exchanges of chat `chat` without an open card, and the answers that wait unread in the project's other chats; oldest first. */
  sheet(projectId: string, chat: number, limit: number): Talk[] {
    const elsewhere = this.db.query('SELECT * FROM talk WHERE project_id = $c AND unread = 1 AND chat != $chat ORDER BY id').all({ c: projectId, chat }) as TalkRow[];
    const here = this.talk(projectId, limit, true, chat);
    return elsewhere.length ? [...elsewhere.map((r) => withContinues(this.db, r)), ...here].sort((a, b) => a.id - b.id) : here;
  }

  /** A message of the project's sheet (an exchange with no card open), as a reply quotes it. */
  sheetQuote(projectId: string, ref: TalkRef): TalkQuote | undefined {
    const sheet = this.db.query('SELECT 1 FROM talk WHERE id = $id AND project_id = $c AND card_id IS NULL').get({ id: ref.talk, c: projectId });
    return sheet ? quotedTalk(this.db, ref) : undefined;
  }

  /** One exchange, with the card its question is about. */
  exchange(id: number): (Talk & { about?: string; thenPlace?: Place }) | null {
    const r = this.db.query('SELECT * FROM talk WHERE id = $id').get({ id }) as TalkRow | null;
    return r ? { ...withContinues(this.db, r), ...(r.about ? { about: r.about } : {}), ...(r.then_place ? { thenPlace: JSON.parse(r.then_place) as Place } : {}) } : null;
  }

  /** Questions being looked up, oldest first. */
  lookingUp(projectId: string): number[] {
    return (this.db.query('SELECT id FROM talk WHERE project_id = $c AND question IS NOT NULL AND answer IS NULL ORDER BY id').all({ c: projectId }) as { id: number }[]).map((r) => r.id);
  }

  /**
   * How the cards got where they are, after `since` (ISO time), oldest first: their milestones
   * (state changes, questions, answers, hand-overs, the owner's notes, errors) and the creation of
   * cards that come from no plan doc. Deleted cards are left out. After a mark, also what was written
   * since it, whatever its time; its time still counts, for an event that takes up the id of one the
   * owner deleted.
   */
  timeline(projectId: string, since: string | Mark, limit: number): Moment[] {
    const m = typeof since === 'string' ? { at: since, event: Number.MAX_SAFE_INTEGER, card: Number.MAX_SAFE_INTEGER } : since;
    return (
      this.db
        .query(
          // within one millisecond, cards are created before anything happens to them, each in the order it was written
          `SELECT at, cardId, kind, author, text FROM (
             SELECT e.at, e.card_id AS cardId, e.kind, e.author, e.text, 1 AS phase, e.id AS seq FROM events e JOIN cards c ON c.id = e.card_id
             WHERE c.project_id = $c AND c.deleted_at IS NULL AND (e.at > $since OR e.id > $event) AND e.kind IN ('state', 'question', 'answer', 'review', 'hint', 'error')
             UNION ALL
             SELECT created_at, id, 'created', CASE WHEN from_id IS NULL THEN 'owner' ELSE 'worker' END, '', 0, rowid FROM cards
             WHERE project_id = $c AND deleted_at IS NULL AND plan_ref IS NULL AND (created_at > $since OR rowid > $card)
           ) ORDER BY at DESC, phase DESC, seq DESC LIMIT $limit`,
        )
        .all({ c: projectId, since: m.at, event: m.event, card: m.card, limit }) as Moment[]
    ).reverse();
  }

  /** Where the cards' history stands now, for `timeline` to go on from. */
  mark(): Mark {
    const { event, card } = this.db
      .query('SELECT (SELECT COALESCE(MAX(id), 0) FROM events) AS event, (SELECT COALESCE(MAX(rowid), 0) FROM cards) AS card')
      .get() as { event: number; card: number };
    return { at: now(), event, card };
  }

  /**
   * What the owner said after `since` (ISO time), oldest first, at most the latest `limit`: notes,
   * feedback and answers to agents, an idea's discussion, and what they said to the Koordinator
   * (unless taken back).
   */
  utterances(projectId: string, since: string, limit: number): Utterance[] {
    return (
      this.db
        .query(
          `SELECT at, cardId, title, kind, text FROM (
             SELECT e.at, e.card_id AS cardId, c.title, e.kind, e.text, e.id AS seq FROM events e JOIN cards c ON c.id = e.card_id
             WHERE c.project_id = $c AND e.author = 'owner' AND e.kind IN ('hint', 'answer', 'talk') AND e.at > $since
             UNION ALL
             SELECT t.at, t.card_id, c.title, 'say', t.said, t.id FROM talk t LEFT JOIN cards c ON c.id = t.card_id
             WHERE t.project_id = $c AND t.undone = 0 AND t.after_wait IS NULL AND t.after_answer IS NULL AND t.moved IS NULL AND t.at > $since
           ) ORDER BY at DESC, seq DESC LIMIT $limit`,
        )
        .all({ c: projectId, since, limit }) as { at: string; cardId: string | null; title: string | null; kind: Utterance['kind']; text: string }[]
    )
      .reverse()
      .map((r) => ({ at: r.at, kind: r.kind, text: r.text, ...(r.cardId ? { cardId: r.cardId } : {}), ...(r.title ? { title: r.title } : {}) }));
  }

  /** Proposals the owner accepted or rejected after `since` (ISO time), oldest first. */
  decidedProposals(projectId: string, since: string): { at: string; text: string; state: 'active' | 'rejected' | 'filed'; quote?: string; target?: string }[] {
    return (
      this.db
        .query(`SELECT decided_at AS at, text, state, quote, target FROM preferences WHERE project_id = $c AND decided_at > $since ORDER BY decided_at`)
        .all({ c: projectId, since }) as { at: string; text: string; state: 'active' | 'rejected' | 'filed'; quote: string | null; target: string | null }[]
    ).map(({ quote, target, ...r }) => ({ ...r, ...(quote ? { quote } : {}), ...(target ? { target } : {}) }));
  }

  /**
   * Cards of the owner's deleted after `since` (ISO time), oldest first, with the state they had: a
   * worker's proposal the owner dismissed, say. Plan cards go with their plan doc, not by a click.
   */
  removed(projectId: string, since: string): { at: string; title: string; state: CardState }[] {
    // a proposal its agent withdrew went without the owner
    return this.db
      .query(
        `SELECT deleted_at AS at, title, COALESCE(state, 'planned') AS state FROM cards WHERE project_id = $c AND plan_ref IS NULL AND deleted_at > $since
         AND NOT (state = 'proposal' AND json_extract(proposal, '$.superseded') IS NOT NULL) ORDER BY deleted_at`,
      )
      .all({ c: projectId, since }) as { at: string; title: string; state: CardState }[];
  }

  // ---------------------------------------------------------------- the work retrospective

  addFriction(projectId: string, repo: string, cardId: string, notes: FrictionNote[]) {
    const stmt = this.db.query('INSERT INTO friction (project_id, repo, card_id, at, what, cost, fix) VALUES ($c, $repo, $card, $at, $what, $cost, $fix)');
    const at = now();
    this.db.transaction(() => notes.forEach((n) => stmt.run({ c: projectId, repo, card: cardId, at, ...n })))();
  }

  /** The friction noted on a repository's cards after `since` (ISO time; all without), oldest first, with each card's title. */
  friction(projectId: string, repo: string, since: string | null): Friction[] {
    return this.db
      .query(
        `SELECT f.card_id AS cardId, COALESCE(c.title, '') AS title, f.at, f.what, f.cost, f.fix FROM friction f JOIN cards c ON c.id = f.card_id
         WHERE f.project_id = $c AND f.repo = $repo AND f.at > $since ORDER BY f.at, f.id`,
      )
      .all({ c: projectId, repo, since: since ?? '' }) as Friction[];
  }

  /** The cards the work retrospective proposed for a repository (`null`: the home repository), oldest first, with what became of them. */
  retroProposals(projectId: string, repo: string | null): { title: string; retro: string; state: CardState; dismissed: boolean }[] {
    return (
      this.db
        .query(`SELECT COALESCE(title, '') AS title, retro, COALESCE(state, 'planned') AS state, deleted_at FROM cards WHERE project_id = $c AND retro IS NOT NULL AND repo IS $repo ORDER BY created_at, rowid`)
        .all({ c: projectId, repo }) as { title: string; retro: string; state: CardState; deleted_at: string | null }[]
    ).map(({ deleted_at, ...r }) => ({ ...r, dismissed: !!deleted_at && r.state === 'proposal' }));
  }

  addSettingProposal(projectId: string, p: Omit<SettingProposal, 'id' | 'cards'> & { cards: string[] }): number {
    return (
      this.db
        .query(
          `INSERT INTO setting_proposals (project_id, repo, field, value, basis, cards, created_at)
           VALUES ($c, $repo, $field, $value, $basis, $cards, $now) RETURNING id`,
        )
        .get({ c: projectId, repo: p.repo, field: p.field, value: JSON.stringify(p.value), basis: p.basis, cards: JSON.stringify(p.cards), now: now() }) as { id: number }
    ).id;
  }

  /** The settings the work retrospective proposed, oldest first, with what became of them: those of a repository, or all; the cards they rest on with their titles. */
  settingProposals(projectId: string, repo?: string): (SettingProposal & { state: SettingProposalState })[] {
    const rows = this.db
      .query(`SELECT * FROM setting_proposals WHERE project_id = $c AND ($repo IS NULL OR repo = $repo) ORDER BY id`)
      .all({ c: projectId, repo: repo ?? null }) as { id: number; repo: string; field: ProposedSetting; value: string; basis: string; cards: string; state: SettingProposalState }[];
    const title = this.db.query(`SELECT COALESCE(title, '') AS title FROM cards WHERE id = $id`);
    return rows.map((r) => ({
      id: r.id,
      repo: r.repo,
      field: r.field,
      value: JSON.parse(r.value) as string | string[],
      basis: r.basis,
      cards: (JSON.parse(r.cards) as string[]).map((id) => ({ id, title: (title.get({ id }) as { title: string } | null)?.title ?? '' })),
      state: r.state,
    }));
  }

  /** Decides a waiting setting proposal, with the value the owner took; whether one waited. */
  decideSettingProposal(projectId: string, id: number, state: Exclude<SettingProposalState, 'proposed'>, value?: string | string[]): boolean {
    return (
      this.db
        .query(`UPDATE setting_proposals SET state = $state, decided_at = $now, value = COALESCE($value, value) WHERE project_id = $c AND id = $id AND state = 'proposed'`)
        .run({ c: projectId, id, state, now: now(), value: value === undefined ? null : JSON.stringify(value) }).changes > 0
    );
  }

  // ---------------------------------------------------------------- settings

  setting(projectId: string, key: string): string | null {
    return (this.db.query('SELECT value FROM settings WHERE project_id = $c AND key = $key').get({ c: projectId, key }) as { value: string } | null)?.value ?? null;
  }

  setSetting(projectId: string, key: string, value: string) {
    this.db
      .query('INSERT INTO settings (project_id, key, value) VALUES ($c, $key, $value) ON CONFLICT(project_id, key) DO UPDATE SET value = $value')
      .run({ c: projectId, key, value });
  }

  // ---------------------------------------------------------------- trusted commands

  /** The commands of the repository at `path` as the owner last confirmed them; null where they confirmed none. */
  trustedCommands(path: string): RepoCommands | null {
    const row = this.db.query('SELECT commands FROM trusted_commands WHERE repo = $repo').get({ repo: path }) as { commands: string } | null;
    return row ? (JSON.parse(row.commands) as RepoCommands) : null;
  }

  trustCommands(path: string, commands: RepoCommands) {
    this.db
      .query('INSERT INTO trusted_commands (repo, commands, at) VALUES ($repo, $commands, $at) ON CONFLICT(repo) DO UPDATE SET commands = $commands, at = $at')
      .run({ repo: path, commands: JSON.stringify(commands), at: now() });
  }

  // ---------------------------------------------------------------- folders without git

  /** What the card changed in the folder without git it works in, as `folder.ts` keeps it (JSON); null where it has no record. */
  folderCard(cardId: string): string | null {
    const row = this.db.query('SELECT state FROM folder_cards WHERE card_id = $c').get({ c: cardId }) as { state: string } | null;
    return row?.state ?? null;
  }

  /** The cards with a record in the folder at `folder`. */
  folderCards(folder: string): { card_id: string; state: string }[] {
    return this.db.query('SELECT card_id, state FROM folder_cards WHERE folder = $f').all({ f: folder }) as { card_id: string; state: string }[];
  }

  /** Keeps the card's record in the folder; null removes it. */
  setFolderCard(cardId: string, folder: string, state: string | null) {
    if (state === null) this.db.query('DELETE FROM folder_cards WHERE card_id = $c').run({ c: cardId });
    else
      this.db
        .query('INSERT INTO folder_cards (card_id, folder, state) VALUES ($c, $f, $s) ON CONFLICT(card_id) DO UPDATE SET folder = $f, state = $s')
        .run({ c: cardId, f: folder, s: state });
  }

  /**
   * A session worked on the card with `config`: the first time it is heard, from `at`. Heard again
   * (a resume), it keeps what it ran on and only learns the model it resolved to, if that was unknown:
   * what it was started with is not known better later (a legacy session resumes on today's defaults).
   */
  recordRun(cardId: string, session: string, config: WorkConfig, at: string = now()) {
    this.db
      .query(
        `INSERT INTO agent_runs (card_id, session_id, harness, model, effort, requested, started_at) VALUES ($card, $session, $harness, $model, $effort, $requested, $at)
         ON CONFLICT (card_id, session_id) DO UPDATE SET model = coalesce(model, excluded.model)`,
      )
      .run({ card: cardId, session, harness: config.harness, model: config.model, effort: config.effort, requested: config.requested ?? null, at });
  }

  /** The card's handover (its `review` event) with the id `id`, or its latest. */
  handover(cardId: string, id?: number): { id: number; at: string } | undefined {
    return (this.db
      .query("SELECT id, at FROM events WHERE card_id = $c AND kind = 'review' AND ($id IS NULL OR id = $id) ORDER BY id DESC LIMIT 1")
      .get({ c: cardId, id: id ?? null }) as { id: number; at: string } | null) ?? undefined;
  }

  /** The sessions that worked on the card, the earliest first. */
  runs(cardId: string): (WorkConfig & { session: string; at: string })[] {
    const rows = this.db
      .query('SELECT session_id AS session, harness, model, effort, requested, started_at AS at FROM agent_runs WHERE card_id = $c ORDER BY started_at, rowid')
      .all({ c: cardId }) as (Omit<WorkConfig, 'requested'> & { requested: string | null; session: string; at: string })[];
    return rows.map(({ requested, ...r }) => ({ ...r, ...(requested ? { requested } : {}) }));
  }

  /**
   * The owner's response on the card's `handover`: a new one, or the one given before for the same
   * handover with its answer and facets replaced. Whom it credits stays as it was first recorded.
   */
  putFeedback(f: Omit<Feedback, 'id' | 'at' | 'updatedAt' | 'cardId' | 'projectId' | 'short'> & { cardId: string; projectId: string }): Feedback {
    const credited = f.attribution === 'single' ? f.configs[0] : undefined;
    const context = { title: f.title, ...(f.repo ? { repo: f.repo } : {}), ...(f.plan ? { plan: f.plan } : {}) };
    const row = this.db
      .query(
        `INSERT INTO feedback (card_id, project_id, handover, context, attribution, configs, harness, model, effort, answer, facets, created_at)
         VALUES ($card, $project, $handover, $context, $attribution, $configs, $harness, $model, $effort, $answer, $facets, $at)
         ON CONFLICT (card_id, handover) DO UPDATE SET answer = excluded.answer, facets = excluded.facets,
           updated_at = CASE WHEN answer IS excluded.answer AND facets IS excluded.facets THEN updated_at ELSE excluded.created_at END
         RETURNING id`,
      )
      .get({
        card: f.cardId,
        project: f.projectId,
        handover: f.handover,
        context: JSON.stringify(context),
        attribution: f.attribution,
        configs: JSON.stringify(f.configs),
        harness: credited?.harness ?? null,
        model: credited?.model ?? null,
        effort: credited?.effort ?? null,
        answer: JSON.stringify(f.answer),
        facets: f.facets ? JSON.stringify(f.facets) : null,
        at: now(),
      }) as { id: number };
    return this.feedback({ id: row.id })[0]!;
  }

  /** For each of these cards that handed over work, its latest handover and the owner's answer on it, if one was given. */
  rated(cardIds: string[]): Map<string, { handover: number; answer?: FeedbackAnswer }> {
    if (!cardIds.length) return new Map();
    const rows = this.db
      .query(
        `SELECT h.card_id, h.handover, f.answer FROM
           (SELECT card_id, MAX(id) AS handover FROM events WHERE kind = 'review' AND card_id IN (SELECT value FROM json_each($ids)) GROUP BY card_id) h
         LEFT JOIN feedback f ON f.card_id = h.card_id AND f.handover = h.handover`,
      )
      .all({ ids: JSON.stringify(cardIds) }) as { card_id: string; handover: number; answer: string | null }[];
    return new Map(rows.map((r) => [r.card_id, { handover: r.handover, ...(r.answer ? { answer: JSON.parse(r.answer) as FeedbackAnswer } : {}) }]));
  }

  /** The owner's responses, the earliest first: all of them, a card's, or one. */
  feedback(of: { cardId?: string; id?: number } = {}): Feedback[] {
    const rows = this.db
      .query(
        `SELECT f.*, c.short, c.deleted_at FROM feedback f JOIN cards c ON c.id = f.card_id
         WHERE ($card IS NULL OR f.card_id = $card) AND ($id IS NULL OR f.id = $id) ORDER BY f.id`,
      )
      .all({ card: of.cardId ?? null, id: of.id ?? null }) as FeedbackRow[];
    return rows.map(feedbackOf);
  }
}

interface FeedbackRow {
  id: number;
  card_id: string;
  project_id: string;
  handover: number;
  context: string;
  attribution: Attribution;
  configs: string;
  answer: string;
  facets: string | null;
  created_at: string;
  updated_at: string | null;
  short: string | null;
  deleted_at: string | null;
}

function feedbackOf(r: FeedbackRow): Feedback {
  const context = JSON.parse(r.context) as Pick<Feedback, 'title' | 'repo' | 'plan'>;
  const configs = JSON.parse(r.configs) as WorkConfig[];
  return {
    id: r.id,
    cardId: r.card_id,
    ...(r.short ? { short: r.short } : {}),
    projectId: r.project_id,
    handover: r.handover,
    ...context,
    attribution: r.attribution,
    configs,
    ...(r.attribution === 'single' && configs[0] ? { credited: configs[0] } : {}),
    answer: JSON.parse(r.answer) as FeedbackAnswer,
    ...(r.facets ? { facets: JSON.parse(r.facets) as Record<string, string> } : {}),
    at: r.created_at,
    ...(r.updated_at ? { updatedAt: r.updated_at } : {}),
    ...(r.deleted_at ? { deleted: true as const } : {}),
  };
}

const now = () => new Date().toISOString();

/** One piece of friction in a worker's run: what went wrong, what it cost, what would have prevented it. */
export interface FrictionNote {
  what: string;
  cost: string;
  fix: string;
}
export interface Friction extends FrictionNote {
  cardId: string;
  /** The card's title. */
  title: string;
  at: string;
}

interface TalkRow {
  reply_agent: string | null;
  answer_agent: string | null;
  id: number;
  at: string;
  said: string;
  reply: string;
  card_id: string | null;
  undone: number;
  question: string | null;
  about: string | null;
  answer: string | null;
  answer_by: 'koordinator' | 'plan' | null;
  images: string | null;
  unread: number;
  session_id: string | null;
  thread: number | null;
  follows: number | null;
  files: string | null;
  card: string | null;
  reply_to: string | null;
  wish: string | null;
  held: string | null;
  waits: string | null;
  after_wait: string | null;
  asked_in: string | null;
  moved: string | null;
  then_step: string | null;
  after_answer: number | null;
  then_place: string | null;
  chat: number | null;
}

const toTalk = (r: TalkRow): Talk => ({
  id: r.id,
  at: r.at,
  said: r.said,
  ...(r.reply_agent ? { replyAgent: JSON.parse(r.reply_agent) as AgentIdentity } : {}),
  ...(r.answer_agent ? { answerAgent: JSON.parse(r.answer_agent) as AgentIdentity } : {}),
  // empty while the Koordinator reads the words
  ...(r.reply ? { reply: r.reply } : {}),
  ...(r.card_id ? { cardId: r.card_id } : {}),
  ...(r.undone ? { undone: true } : {}),
  ...(r.question ? { question: r.question } : {}),
  ...(r.answer !== null ? { answer: r.answer } : {}),
  ...(r.answer_by ? { answerBy: r.answer_by } : {}),
  ...(r.unread ? { unread: true } : {}),
  ...(r.images ? { images: JSON.parse(r.images) as string[] } : {}),
  // a looked-up question is a thread of its own until it follows up on one
  ...(r.question ? { thread: r.thread ?? r.id } : {}),
  ...(r.follows ? { follows: r.follows } : {}),
  ...(r.files ? { files: JSON.parse(r.files) as AnswerFile[] } : {}),
  ...(r.card ? { movedTo: r.card } : {}),
  ...(r.wish ? { wish: JSON.parse(r.wish) as Wish } : {}),
  ...(r.held ? { heldUntil: (JSON.parse(r.held) as HeldTalk).until } : {}),
  ...(r.waits ? { waits: (JSON.parse(r.waits) as TalkWaitRow[]).map(({ card, title, state }) => ({ card, title, state })) } : {}),
  ...(r.after_wait ? { after: JSON.parse(r.after_wait) as TalkAfter } : {}),
  ...(r.asked_in ? { askedIn: r.asked_in } : {}),
  ...(r.moved ? { moved: JSON.parse(r.moved) as TalkMoved } : {}),
  ...(r.then_step ? { then: r.then_step } : {}),
  ...(r.after_answer ? { answered: r.after_answer } : {}),
  ...(r.chat ? { chat: r.chat } : {}),
});

/**
 * An exchange with the question of the answer it continues, when it follows up on one, and the
 * message of the sheet it replies to, when it does.
 */
function withContinues(db: Database, r: TalkRow): Talk {
  const followed = r.follows ? (db.query('SELECT question FROM talk WHERE id = $id').get({ id: r.follows }) as { question: string | null } | null) : null;
  const replyTo = r.reply_to ? quotedTalk(db, JSON.parse(r.reply_to) as TalkRef) : undefined;
  return { ...toTalk(r), ...(followed?.question ? { continues: followed.question } : {}), ...(replyTo ? { replyTo } : {}) };
}

/** A message of the sheet as a reply quotes it; none where the exchange or its part is gone. */
function quotedTalk(db: Database, ref: TalkRef): TalkQuote | undefined {
  const r = db.query('SELECT said, reply, answer, answer_by FROM talk WHERE id = $id').get({ id: ref.talk }) as Pick<TalkRow, 'said' | 'reply' | 'answer' | 'answer_by'> | null;
  const text = r?.[ref.part];
  if (!r || !text) return;
  return { talk: ref.talk, part: ref.part, by: ref.part === 'said' ? 'owner' : ref.part === 'answer' ? (r.answer_by ?? 'koordinator') : 'koordinator', text };
}
