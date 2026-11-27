import type { Database } from 'bun:sqlite';
import { sql } from 'drizzle-orm';
import type { CardEvent, TalkAfter, TalkMoved, TalkRef } from '../core/types';
import { MAIN_CANVAS } from '../core/types';
import { openDatabase } from './db';
import { CardRepository } from './repositories/cardRepository';
import { DatabaseProvider } from './repositories/databaseProvider';
import { Activity } from './schemas/activity';
import { AgentRuns } from './schemas/agentRuns';
import { Canvases } from './schemas/canvases';
import { type CardRow, Cards, type CardUpdate, type NewRow, type PartsUpdate } from './schemas/cards/cards';
import { Demos } from './schemas/cards/demos';
import { Holds } from './schemas/cards/holds';
import { Ideas } from './schemas/cards/ideas';
import { Labels } from './schemas/cards/labels';
import { Plans } from './schemas/cards/plans';
import { Reviews } from './schemas/cards/reviews';
import { Chats } from './schemas/chats';
import { Commands } from './schemas/commands';
import { atomic, type Db, now } from './schemas/common';
import { Decisions } from './schemas/decisions';
import { Devices } from './schemas/devices';
import { Events } from './schemas/events';
import { Feedbacks } from './schemas/feedback';
import { FolderCards } from './schemas/folderCards';
import { Frictions } from './schemas/friction';
import { Groups } from './schemas/groups';
import { NeedsYou } from './schemas/needsYou';
import { Preferences } from './schemas/preferences';
import { Projects } from './schemas/projects';
import { SettingProposals } from './schemas/settingProposals';
import { Settings } from './schemas/settings';
import { Talk } from './schemas/talk';
import { TrustedCommands } from './schemas/trustedCommands';
import { Workstations } from './schemas/workstations';








export interface Mark {
  at: string;
  event: number;
  card: number;
}


export interface Moment {
  at: string;
  cardId: string;
  kind: CardEvent['kind'] | 'created';
  author: CardEvent['author'];
  text: string;
}


export interface Utterance {
  at: string;
  kind: 'hint' | 'answer' | 'talk' | 'say';
  text: string;
  cardId?: string;
  title?: string;
}

/**
 * Every table's queries and the transactions across them.
 *
 * @deprecated Repositories (`src/server/repositories/`) are becoming the only way to reach a table;
 * new code asks a repository. The tables here move to repositories one at a time, and the
 * multi-table writes to the repository of their record or to a service; then `Store` goes.
 */
export class Store {

  readonly db: Database;
  readonly orm: Db;
  readonly database: DatabaseProvider;
  readonly cardRepository: CardRepository;
  readonly projects: Projects;
  readonly canvases: Canvases;
  readonly cards: Cards;
  readonly ideas: Ideas;
  readonly reviews: Reviews;
  readonly demos: Demos;
  readonly plans: Plans;
  readonly labels: Labels;
  readonly holds: Holds;
  readonly groups: Groups;
  readonly needsYou: NeedsYou;
  readonly activity: Activity;
  readonly events: Events;
  readonly workstations: Workstations;
  readonly decisions: Decisions;
  readonly preferences: Preferences;
  readonly chats: Chats;
  readonly talk: Talk;
  readonly commands: Commands;
  readonly friction: Frictions;
  readonly settingProposals: SettingProposals;
  readonly settings: Settings;
  readonly trustedCommands: TrustedCommands;
  readonly folderCards: FolderCards;
  readonly agentRuns: AgentRuns;
  readonly feedback: Feedbacks;
  readonly devices: Devices;

  constructor(path: string) {
    const { client, orm } = openDatabase(path);
    this.db = client;
    this.orm = orm;
    this.database = new DatabaseProvider(orm);
    this.cardRepository = new CardRepository(this.database, { cacheTimeToLiveMilliseconds: 0 });
    this.projects = new Projects(orm);
    this.canvases = new Canvases(orm);
    this.cards = new Cards(orm);
    this.ideas = new Ideas(orm);
    this.reviews = new Reviews(orm);
    this.demos = new Demos(orm);
    this.plans = new Plans(orm);
    this.labels = new Labels(orm);
    this.holds = new Holds(orm);
    this.groups = new Groups(orm);
    this.needsYou = new NeedsYou(orm);
    this.activity = new Activity(orm);
    this.events = new Events(orm);
    this.workstations = new Workstations(orm);
    this.decisions = new Decisions(orm);
    this.preferences = new Preferences(orm);
    this.chats = new Chats(orm);
    this.talk = new Talk(orm);
    this.commands = new Commands(orm);
    this.friction = new Frictions(orm);
    this.settingProposals = new SettingProposals(orm);
    this.settings = new Settings(orm);
    this.trustedCommands = new TrustedCommands(orm);
    this.folderCards = new FolderCards(orm);
    this.agentRuns = new AgentRuns(orm);
    this.feedback = new Feedbacks(orm);
    this.devices = new Devices(orm);
    this.changesMade = client.query('SELECT total_changes() AS n');
  }

  private readonly changesMade;

  /** How many rows this connection has written so far, every table and project alike: a reader that counts them knows whether anything wrote since it last read. */
  totalChanges(): number {
    return (this.changesMade.get() as { n: number }).n;
  }

  /** Runs `fn` in one transaction, or in a savepoint of the one it runs in. */
  transaction<T>(fn: () => T): T {
    return atomic(this.orm, fn);
  }

  /** The project is known by this name, with its canvas `main` once it has none. */
  ensureProject(id: string, name: string) {
    this.transaction(() => {
      this.projects.setName(id, name);
      if (!this.canvases.any(id)) this.canvases.add(id, MAIN_CANVAS, null);
    });
  }

  /**
   * Stores new cards, with their parts: each on the canvas it names, else a workstream on its
   * plan's, else on its project's `main`.
   */
  addCards(rows: NewRow[]): CardRow[] {
    return this.cardRepository.insertCards(rows);
  }

  /** Changes the card's own fields and those of its parts, in one transaction; it counts as changed when only a part did. */
  updateCard(id: string, update: CardUpdate) {
    this.cardRepository.applyUpdate(id, update);
  }

  /**
   * The card goes to another project, at `at` on its canvas `canvasId` (else its `main`), with its history and decisions: into that project's
   * home repository (`repo` null) and out of its group, which belongs to the project it leaves; `parts` changes its parts on the way.
   */
  moveCard(id: string, projectId: string, at: { x: number; y: number }, parts: PartsUpdate = {}, canvasId?: string) {
    this.transaction(() => {
      this.updateCard(id, { x: at.x, y: at.y, repo: null, group_id: null, ...parts });
      this.cards.setProject(id, projectId, canvasId ?? this.canvases.main(projectId));
      this.decisions.setProject(id, projectId);
      this.feedback.setProject(id, projectId);
    });
  }

  /**
   * The canvas goes, with its groups, which hold no card it holds any more: their cards leave them.
   * This leaves card locations alone. The board moves parked and snoozed cards before calling this.
   */
  deleteCanvas(id: string) {
    this.transaction(() => {
      for (const g of this.groups.onCanvas(id)) {
        this.cards.ungroup(g.id);
        this.groups.delete(g.id);
      }
      const projectId = this.canvases.get(id)?.projectId;
      this.canvases.delete(id);
      this.canvases.order(projectId ? this.canvases.of(projectId).map((c) => c.id) : []);
    });
  }

  /** Removes the groups no card belongs to, on the project or in the archive; returns how many. */
  dropEmptyGroups(projectId: string): number {
    return this.transaction(() => {
      this.cards.ungroupDeleted(projectId);
      return this.groups.dropEmpty(projectId);
    });
  }

  /** An exchange in the specified or current chat; one the Koordinator takes up by itself (`after`, `answered`) goes into the chat of the exchange it takes up. */
  addTalk(projectId: string, said: string, reply: string, cardId: string | null, lookUp?: { question: string; about: string | null }, images: string[] = [], replyTo?: TalkRef, after?: TalkAfter, askedIn?: string, answered?: number, chat?: number, requestId?: string): number {
    const from = after?.from ?? answered;
    const earlier = from === undefined ? undefined : this.talk.chatOf(from);
    return this.talk.add(projectId, earlier ?? chat ?? this.chats.getCurrentOrCreateNew(projectId), said, reply, cardId, lookUp, images, replyTo, after, askedIn, answered, requestId);
  }

  /** An exchange of no one's in the project's sheet, `reply` saying the card moved to another project. */
  addMoved(projectId: string, moved: TalkMoved, reply: string): number {
    return this.talk.addMoved(projectId, this.chats.getCurrentOrCreateNew(projectId), moved, reply);
  }

  /** The owner saw the sheet's answers, or (`ids`) those of a plan's sheet; whether any was unread. */
  readTalk(projectId: string, ids?: number[]): boolean {
    return this.talk.read(projectId, ids ? { ids } : { chat: this.chats.getCurrentOrCreateNew(projectId) });
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
    return this.orm
      .all<Moment>(
        
        sql`SELECT at, cardId, kind, author, text FROM (
              SELECT e.at, e.card_id AS cardId, e.kind, e.author, e.text, 1 AS phase, e.id AS seq FROM events e JOIN cards c ON c.id = e.card_id
              WHERE c.project_id = ${projectId} AND c.deleted_at IS NULL AND (e.at > ${m.at} OR e.id > ${m.event}) AND e.kind IN ('state', 'question', 'answer', 'review', 'hint', 'error')
              UNION ALL
              SELECT created_at, id, 'created', CASE WHEN from_id IS NULL THEN 'owner' ELSE 'worker' END, '', 0, rowid FROM cards
              WHERE project_id = ${projectId} AND deleted_at IS NULL AND plan_ref IS NULL AND (created_at > ${m.at} OR rowid > ${m.card})
            ) ORDER BY at DESC, phase DESC, seq DESC LIMIT ${limit}`,
      )
      .reverse();
  }

  /** Where the cards' history stands now, for `timeline` to go on from. */
  mark(): Mark {
    
    const [{ event, card }] = this.orm.all<{ event: number; card: number }>(
      sql`SELECT (SELECT COALESCE(MAX(id), 0) FROM events) AS event, (SELECT COALESCE(MAX(rowid), 0) FROM cards) AS card`,
    ) as [{ event: number; card: number }];
    return { at: now(), event, card };
  }

  /**
   * What the owner said after `since` (ISO time), oldest first, at most the latest `limit`: notes,
   * feedback and answers to agents, an idea's discussion, and what they said to the Koordinator
   * (unless taken back).
   */
  utterances(projectId: string, since: string, limit: number): Utterance[] {
    return this.orm
      .all<{ at: string; cardId: string | null; title: string | null; kind: Utterance['kind']; text: string }>(
        sql`SELECT at, cardId, title, kind, text FROM (
              SELECT e.at, e.card_id AS cardId, c.title, e.kind, e.text, e.id AS seq FROM events e JOIN cards c ON c.id = e.card_id
              WHERE c.project_id = ${projectId} AND e.author = 'owner' AND e.kind IN ('hint', 'answer', 'talk') AND e.at > ${since}
              UNION ALL
              SELECT t.at, t.card_id, c.title, 'say', t.said, t.id FROM talk t LEFT JOIN cards c ON c.id = t.card_id
              WHERE t.project_id = ${projectId} AND t.undone = 0 AND t.after_wait IS NULL AND t.after_answer IS NULL AND t.moved IS NULL AND t.at > ${since}
            ) ORDER BY at DESC, seq DESC LIMIT ${limit}`,
      )
      .reverse()
      .map((r) => ({ at: r.at, kind: r.kind, text: r.text, ...(r.cardId ? { cardId: r.cardId } : {}), ...(r.title ? { title: r.title } : {}) }));
  }
}
