import type { Database } from 'bun:sqlite';
import { sql } from 'drizzle-orm';
import type { CardEvent, TalkAfter, TalkMoved, TalkRef } from '../core/types';
import { MAIN_CANVAS } from '../core/types';
import { openDatabase } from './db';
import { Activity } from './models/activity';
import { AgentRuns } from './models/agent-runs';
import { Canvases } from './models/canvases';
import { type CardRow, Cards, type NewRow, type RowUpdate } from './models/cards/cards';
import { type IdeaUpdate, Ideas } from './models/cards/ideas';
import { Chats } from './models/chats';
import { Commands } from './models/commands';
import { atomic, type Db, now } from './models/common';
import { Decisions } from './models/decisions';
import { Devices } from './models/devices';
import { Events } from './models/events';
import { Feedbacks } from './models/feedback';
import { FolderCards } from './models/folder-cards';
import { Frictions } from './models/friction';
import { Groups } from './models/groups';
import { Preferences } from './models/preferences';
import { Projects } from './models/projects';
import { SettingProposals } from './models/setting-proposals';
import { Settings } from './models/settings';
import { Talk } from './models/talk';
import { TrustedCommands } from './models/trusted-commands';
import { Workstations } from './models/workstations';

// What Seismic stores: each table's queries in its model (`models/`), and here what spans several
// of them, each in one transaction.

/**
 * Where the cards' history stood when it was read: the time, and the latest event and card then.
 * What is written later has a larger id, even within the same millisecond or once the clock went back.
 */
export interface Mark {
  at: string;
  event: number;
  card: number;
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

export class Store {
  /** The SQLite connection under `orm`. */
  readonly db: Database;
  readonly orm: Db;
  readonly projects: Projects;
  readonly canvases: Canvases;
  readonly cards: Cards;
  readonly ideas: Ideas;
  readonly groups: Groups;
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
    this.projects = new Projects(orm);
    this.canvases = new Canvases(orm);
    this.cards = new Cards(orm);
    this.ideas = new Ideas(orm);
    this.groups = new Groups(orm);
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
   * Stores new cards, with their idea parts: each on the canvas it names, else a workstream on its
   * plan's, else on its project's `main`.
   */
  addCards(rows: NewRow[]): CardRow[] {
    const mains = new Map<string, string>();
    const main = (projectId: string) => mains.get(projectId) ?? mains.set(projectId, this.canvases.main(projectId)).get(projectId)!;
    const ids = this.transaction(() => {
      const ids = this.cards.insert(rows.map(({ idea: _, ...r }) => ({ ...r, canvas_id: r.canvas_id ?? (r.parent_id ? this.cards.get(r.parent_id)?.canvas_id : undefined) ?? main(r.project_id) })));
      rows.forEach((r, i) => r.idea && this.ideas.set(ids[i]!, r.idea));
      return ids;
    });
    return ids.map((id) => this.cards.get(id)!);
  }

  /** Changes the card's own fields and those of its idea part, in one transaction. */
  updateCard(id: string, fields: RowUpdate, idea: IdeaUpdate = {}) {
    this.transaction(() => {
      this.ideas.set(id, idea);
      if (Object.keys(fields).length) this.cards.update(id, fields);
      else if (Object.keys(idea).length) this.cards.touch(id);
    });
  }

  /**
   * The card goes to another project, at `at` on its canvas `canvasId` (else its `main`), with its history and decisions: into that project's
   * home repository (`repo` null) and out of its group, which belongs to the project it leaves; `idea` changes its idea part on the way.
   */
  moveCard(id: string, projectId: string, at: { x: number; y: number }, idea: IdeaUpdate = {}, canvasId?: string) {
    this.transaction(() => {
      this.updateCard(id, { x: at.x, y: at.y, repo: null, group_id: null }, idea);
      this.cards.setProject(id, projectId, canvasId ?? this.canvases.main(projectId));
      this.decisions.setProject(id, projectId);
      this.feedback.setProject(id, projectId);
    });
  }

  /** The canvas goes; what is left of it (archived and deleted cards, their groups) goes to canvas `into`, where it comes back; a group whose name `into` has already (in any case) is merged into that one. */
  deleteCanvas(id: string, into: string) {
    this.transaction(() => {
      this.cards.moveCanvas(id, into);
      for (const g of this.groups.onCanvas(id)) {
        const kept = this.groups.named(into, g.name);
        if (!kept) continue;
        this.cards.moveGroup(g.id, kept);
        this.groups.delete(g.id);
      }
      this.groups.moveCanvas(id, into);
      this.canvases.delete(id);
      const projectId = this.canvases.get(into)?.projectId;
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

  /** An exchange in the current chat; one the Koordinator takes up by itself (`after`, `answered`) goes into the chat of the exchange it takes up. */
  addTalk(projectId: string, said: string, reply: string, cardId: string | null, lookUp?: { question: string; about: string | null }, images: string[] = [], replyTo?: TalkRef, after?: TalkAfter, askedIn?: string, answered?: number): number {
    const from = after?.from ?? answered;
    const earlier = from === undefined ? undefined : this.talk.chatOf(from);
    return this.talk.add(projectId, earlier ?? this.chats.current(projectId), said, reply, cardId, lookUp, images, replyTo, after, askedIn, answered);
  }

  /** An exchange of no one's in the project's sheet, `reply` saying the card moved to another project. */
  addMoved(projectId: string, moved: TalkMoved, reply: string): number {
    return this.talk.addMoved(projectId, this.chats.current(projectId), moved, reply);
  }

  /** The owner saw the sheet's answers, or (`ids`) those of a plan's sheet; whether any was unread. */
  readTalk(projectId: string, ids?: number[]): boolean {
    return this.talk.read(projectId, ids ? { ids } : { chat: this.chats.current(projectId) });
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
        // within one millisecond, cards are created before anything happens to them, each in the order it was written
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
    // `all`: Drizzle's `get` reads a raw query's row as an array
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
