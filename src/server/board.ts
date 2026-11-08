// The project of one repository: stored cards merged with what the plan docs say.
//
// Plan docs are read, never written. Their plans and workstreams get a stored row the first
// time they appear, so the owner's placement survives; title, text and state always come from the
// doc. Each read keeps the doc's last state on its plan: when the doc goes, the plan goes
// into the archive with it, and comes back to its place when the doc returns. A workstream that
// leaves its doc stays stored but is not shown.

import { CANVAS_LUCIDE_ICONS, isCanvasIcon } from '../core/canvas-icons';
import { isLabelValue, type Label, LABELS, LABEL_VALUES, type Labels } from '../core/labels';
import { createHash } from 'node:crypto';
import { type ActivityCode, type ActivityEntry, type ActivityWho, type AgentAt, type AgentIdentity, type Harness, type Canvas, CANVAS_NAME_MAX, canvasNameProblem, type CodeReview, type CodeReviewMode, type CardArchiving, type Feedback, MAIN_CANVAS, type ReviewItem, type WorkConfig, type StoppedAt } from '../core/types';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { arrangeWorkstreams, type Bounds, boundsOf, CARD_SIZE, freeSpotNear, GAP, MERGED_SIZE, type Place, PLAN_HEAD, placePlans, planDirNoteBox, placeWorkstreams, planSize, shapeOf, sizeOf, unionBounds } from '../core/layout';
import type { Language } from '../core/locale';
import { MESSAGES, type Messages, snoozeTerm } from '../core/messages';
import { type KnownChange, missedChanges, type OutdatedBy, PAGE_CHANGES, pagesVersion, THEME_CHANGED } from '../core/page-changes';
import { pageTags, untagged } from '../core/page-tags';
import { allTicked, type OtherDoc, type PlanDoc, parsePlanDoc, withoutReference, type Workstream, workstreamAliases } from '../core/plan-doc';
import {
  type AnswerFile,
  type ProjectInfo,
  type ProjectSnapshot,
  type CardEvent,
  type CardPatch,
  type ClonePool,
  type Contribution,
  type HeldChanges,
  type Decision,
  type Demo,
  type DemoKind,
  type PageTags,
  type EarlierDemo,
  type ErrorCode,
  type Group,
  AGENT_HOLDS,
  type Hold,
  type HeldMessage,
  type HoldReason,
  type ItemHold,
  type ItemAgent,
  type ItemDemo,
  type ItemIdea,
  type ItemLabels,
  type ItemPart,
  type ItemReview,
  ITEM_PARTS,
  withPart,
  part,
  type Snooze,
  type Woke,
  type Idea,
  type Item,
  type ManualAnchor,
  type Mock,
  type NewCard,
  type NewRepo,
  type TalkMoved,
  type PreferenceState,
  type ProposedSetting,
  type SettingProposal,
  type SettingProposalState,
  type PrReviewEntry,
  type PrWait,
  type PullRequest,
  type PlanHistory,
  type Proposal,
  type Superseded,
  type CardState,
  type Revising,
  type NextStep,
  type PlannedPrototype,
  type SettledPart,
  type Question,
  type Queue,
  type PlanDir,
  type Reshare,
  type TalkQuote,
  type TalkAfter,
  type TalkRef,
  type Thread,
  isTalkRef,
  STATES,
  finished,
  formatQuestion,
  mergeableWith,
  mergeRank,
  type Merge,
  needsYou,
  plannedToStart,
  snoozeOf,
  type Notice,
  type WorkerTurn,
} from '../core/types';
import type { ActivityRow } from './models/activity';
import type { CanvasRow } from './models/canvases';
import type { CardRow, CardUpdate, NewRow } from './models/cards/cards';
import type { Ideas } from './models/cards/ideas';
import type { LabelsUpdate } from './models/cards/labels';
import type { DecisionRow } from './models/decisions';
import type { Friction, FrictionNote } from './models/friction';
import type { GroupRow } from './models/groups';
import type { HeldTalk, TalkWaitRow } from './models/talk';
import type { Mark, Store } from './store';
import { attribute, checkedFeedback } from './feedback';
import type { Images } from './images';
import { branchName, CARD_BRANCH } from './workstations';
import { clip, messageOf, oneLine } from '../core/text';
import type { Wish } from '../core/wish';

/** What Seismic keeps about a card's pull request; `url` is null until the worker opened it. */
export interface PrState {
  url: string | null;
  number?: number;
  /** Comments already passed to the worker. */
  seen: string[];
  /** `check@commit` of failures already passed to the worker. */
  reported: string[];
  /** The commit a conflict was last reported for. */
  conflictHead?: string;
  /** The commit the worker was last told its reviewers have not seen. */
  staleHead?: string;
  /** A review card waiting for the contributor: the PR's head when it began to wait, and the one the worker was last told was pushed. */
  headSeen?: string;
  pushedHead?: string;
  /** The commit the PR was found ready to merge at; gone once something is left to do again. */
  readyHead?: string;
  /** Why the forge refused Seismic's merge of the ready PR: then the owner merges. */
  mergeError?: string;
  /** Since when reading the PR fails, and whether the card said why; gone once it reads again. */
  readError?: { since: number; shown?: boolean };
  /** A ready PR's reviewer confidence too low for Seismic to merge it: the owner decides. */
  held?: { score: string; by: string };
  /** A ready PR the repository's settings leave to the people on the forge to merge (`autoMerge` off). */
  manual?: true;
  /** The commit a branch behind its base, which the repository wants up to date, was last reported for. */
  behindHead?: string;
  checks?: { name: string; state: 'pending' | 'success' | 'failure'; url?: string }[];
  /** The review as last seen, for the card. */
  review?: PrReviewEntry[];
  /** What the PR waits for before it is merged, as last polled; gone once it is ready. */
  waits?: PrWait[];
  /** `owner/name` of the PR's repository, where that is another than the card's. */
  repo?: string;
  /** Merged while the card's other pull requests were not yet: the commit the merge put on the base, where the forge said. */
  merged?: string | true;
  /** Closed without a merge: the owner was asked, and it holds up nothing. */
  closed?: true;
  /**
   * On the card's first pull request: the further ones the worker opened for the same work (in
   * other repositories, or a second in its own), each watched as the first; the card is live once
   * all are merged. The first is the one in the card's repository, which the landing is about.
   */
  more?: PrState[];
}

/** A card's place in the queue where it waits behind other cards; none otherwise. */
const waitOf = (r: Pick<CardRow, 'queue'>) => {
  const q = r.queue ? (JSON.parse(r.queue) as Queue) : null;
  return q && 'behind' in q ? q : null;
};

/** What is stored of a review card's pull request (`CardRow.contribution`): what the card shows, and what only the server needs. */
export interface StoredContribution extends Contribution {
  /** `base`: the PR's head the held commits go on top of, as it stood at the handover. */
  held?: HeldChanges & { base: string };
  /** The owner chose "Change it myself", and the worker's changes have not gone out yet: requests to the contributor wait for them. */
  changing?: true;
  /** The PR's head commit the worker reviewed at its latest handover: only that one is merged. */
  reviewed?: string;
  /** Where the PR's branch is, for a worker that pushes onto it: its repository's URL and branch. */
  headRepo?: string;
  headRef?: string;
  /** The owner approved: the demo's page is linked in a comment on the PR once it is online. */
  approved?: true;
  /** The page's address Seismic linked in a comment on the PR. */
  linked?: string;
  /** The PR was closed without a merge, and the owner was asked whether the card can go. */
  closed?: true;
}

/**
 * The code review of a card's work (`CardRow.review.codeReview`): the mode its project had at the
 * card's latest handover that is to be reviewed (`handover`, its event), and the latest review run,
 * of that handover or an earlier one (then it is stale). The items the runs raise are the card's
 * `review.items`, one list across all runs.
 */
export interface StoredCodeReview {
  mode: CodeReviewMode;
  handover: number;
  /**
   * `head`: the branch's commit it reviewed, where git told it; `session`: its agent's session while
   * it runs, which goes on after a restart; `scope`: the items under review when its brief was
   * written, the ones it gives verdicts on.
   */
  review?: { handover: number; head?: string; state: 'running' | 'done' | 'failed'; error?: string; at: string; agent?: AgentIdentity; session?: string; scope?: number[] };
  /** An automatic review is about to start (git has not told the commit yet): the card shows it as running, so the handover is not announced before the review. */
  pending?: true;
}

export const codeReviewOf = (r: Pick<CardRow, 'review'>): StoredCodeReview | null => r.review?.codeReview ?? null;

/** A card's code review as the card shows it. */
function shownCodeReview(c: StoredCodeReview, items: ReviewItem[]): CodeReview {
  const r = c.review;
  return {
    mode: c.mode,
    items,
    ...(c.pending && r?.state !== 'running' ? { state: 'running' as const } : r ? { state: r.state, ...(r.agent ? { agent: r.agent } : {}), ...(r.error ? { error: r.error } : {}), ...(r.handover !== c.handover ? { stale: true as const } : {}) } : {}),
  };
}

/** A review card's pull request as the card shows it. */
export const contributionOf = (r: Pick<CardRow, 'review'>): StoredContribution | null => r.review?.contribution ?? null;

/** What a card's work landed with (`CardRow.shipped`); it stays after the worker is done. */
export interface Shipped {
  /** The commit on the default branch that holds the work; none while it is not known (`fetch`). */
  commit?: string;
  /**
   * Where the work's diff starts, so `base..commit` is what it changed: the default branch before it
   * landed, or a merge commit's first parent (`<commit>^`). None where that is not known (a merge
   * GitHub did not name).
   */
  base?: string;
  /** Merged as a pull request: that one. */
  pr?: { url: string; number: number };
  /** The merge commit is not known: the read checkout's commit after the next fetch stands in for it. */
  fetch?: true;
}

/**
 * Which workstream of a plan builds on which (`CardRow.deps`), as the Koordinator read it from
 * the plan doc: `on` by workstream key, for the doc's workstreams as they stood then (`sig`,
 * `depsSig`). `reading` while it reads them: `auto` for a plan just come, which it arranges by
 * them unless the owner moved one of its cards first; `owner` when they asked to arrange it.
 */
export interface StoredDeps {
  sig?: string;
  on?: Record<string, string[]>;
  reading?: 'auto' | 'owner';
}

/** The workstreams of a plan doc as what builds on what is read from them: a reading holds while this is the same. */
export const depsSig = (doc: PlanDoc) =>
  createHash('sha256')
    .update(JSON.stringify(doc.workstreams.map((w) => [w.key, w.title, w.body])))
    .digest('hex')
    .slice(0, 16);

/** A demo version on a card's shared page, with what the page says of it, so it can be published again as it is. */
export interface SharedDemo {
  /** The handover it came with (`Demo.handover`): which of the card's demos it is. */
  handover?: number;
  /** When that handover was: a later version's section on the page is headed with it. */
  at?: string;
  /** The demo's directory. */
  dir: string;
  shown: { title: string; text: string; chapters: [number, string][]; kind: DemoKind };
}

/** Which of a card's demos a share means: by its handover, or by its directory where one of the two has no handover. */
export type DemoRef = { handover?: number; dir: string };

/** Whether two references name the same demo of a card. */
export const sameDemo = (a: DemoRef, b: DemoRef) => (a.handover !== undefined && b.handover !== undefined ? a.handover === b.handover : a.dir === b.dir);

/** What Seismic keeps about a card's shared demo page (share.ts): one page per card, holding one or more of its demo versions. */
export interface StoredShare {
  /** The page's name on the site; it stays with the card, so its link keeps working. */
  slug: string;
  /** While published or withdrawn; none when at rest. */
  state?: 'publishing' | 'withdrawing';
  /** The published page. */
  url?: string;
  /** The demo versions on the published page, in order of handover: the first on top, each later one below as an addendum. */
  demos?: SharedDemo[];
  /** Before a page held several versions (until 2026-10-16): the one demo it showed, read as a list of one (`sharedDemos`). */
  dir?: string;
  shown?: SharedDemo['shown'];
  /** While `publishing` without `refresh`: the versions the page is to show, as the owner chose them. */
  next?: DemoRef[];
  /** The pull request the published page links. */
  pr?: string;
  /** Without a pull request: the address of the commit (or the comparison over the commits) the published page links. */
  commit?: string;
  /** While `publishing`: the page goes out again as it is, now with the PR's link; the card shows it as shared meanwhile. */
  refresh?: true;
  /** The newest page change (page-changes.ts) when it was published, '' before any: the changes after it are what sharing again brings. */
  version?: string;
  /** While `publishing` (with `refresh`): the page goes out again as it is, one of many the owner shares again at once. */
  again?: true;
  /** While `publishing` (with `refresh`): the page goes out again as it is, with the tags the owner set. */
  retag?: true;
  /** The owner unticked "Share on approval": where the site publishes on approval, approving the card shares nothing. */
  notOnApproval?: true;
  /** The page's tags the owner set by hand, by dimension: neither a worker nor the reading session changes them. */
  tags?: PageTags;
  /** The page's tags the reading session chose, by dimension, where neither the owner nor a worker had (`pageTagsOf`). */
  auto?: PageTags;
  /** The demo site the page is on, or goes to (its address in this machine's list); absent on pages from before (until 2026-11-06), found by their URL. */
  site?: string;
  /** The project's path on that site the page lies under; its root where absent. */
  path?: string;
  /** The site is unlisted: the page lies behind the random part of its address (`token`). */
  unlisted?: true;
  /** Before the list of demo sites: the page is on the owner's personal site (unlisted where it has a `token`). */
  personal?: true;
  /** The random part of the page's address on an unlisted site (`<path>/<token>/<slug>`): drawn once for the card, so its link stays. */
  token?: string;
  /** The hash of its repository's theme (theme.ts) the published page carries; none where it carries none. */
  theme?: string;
}

/**
 * The tags of a card's page, each dimension from the first that has it: the owner's by hand, the
 * newest demo whose worker gave it, the reading session's. They belong to the page, not to a version.
 */
export function pageTagsOf(r: CardRow): PageTags {
  const s = r.demo?.share ?? null;
  const demos = [...storedDemos(r), ...(r.demo?.latest ? [r.demo.latest] : [])].reverse();
  return pageTags([s?.tags, ...demos.map((d) => d.page?.tags), s?.auto]);
}

/** The demo versions on a stored page, in order of handover. */
export const sharedDemos = (s: StoredShare): SharedDemo[] => s.demos ?? (s.dir && s.shown ? [{ dir: s.dir, shown: s.shown }] : []);

/** The file that shows a demo is there: its video, or its artifact's page. */
export const demoThere = (d: { dir: string; kind: DemoKind }) => existsSync(join(d.dir, d.kind === 'html' ? 'index.html' : 'demo.mp4'));

/** Sharing many outdated pages again at once (share.ts), kept so a restart goes on with it. */
export interface StoredReshare {
  /** The cards still to go, in order; the first is the one going out. */
  queue: string[];
  total: number;
  done: number;
  failed: string[];
  stopped?: true;
  /** It tags pages without tags and shares them again, rather than sharing outdated ones again. */
  tags?: true;
}

const RESHARE_SETTING = 'reshare';
/** The newest page change when the owner put the notice of outdated pages away: it shows again for pages a newer one leaves outdated. */
const RESHARE_DISMISSED = 'reshare_dismissed';
/**
 * The pages a theme left outdated when the owner put the notice away, by card: the theme each was
 * published with and the one its repository had then (hashes, null for none). Such a page shows
 * again once either differs: its repository's theme changed anew, or it was shared again since.
 */
const RESHARE_DISMISSED_THEMES = 'reshare_dismissed_themes';

/** A page's theme and its repository's, as `RESHARE_DISMISSED_THEMES` keeps them. */
type ThemePair = [published: string | null, now: string | null];

/** The current theme's hash of a card's repository (theme.ts): null where it has none, undefined while that is not known (the repository does not run). */
export type ThemeNow = (r: CardRow) => string | null | undefined;

/** Whether the theme of a stored page's repository (`now`, see `ThemeNow`) differs from the one it was published with; not while it is not at rest. */
const themeChanged = (s: StoredShare, now: string | null | undefined) => !!s.url && !s.state && now !== undefined && (s.theme ?? null) !== now;

/** The changes since a stored page was published that show on its kinds of page (a video, an artifact, or both on one page); none while it is not at rest. */
export function missedBy(s: StoredShare): KnownChange[] {
  if (!s.url || s.state) return [];
  const kinds = new Set(sharedDemos(s).map((d) => d.shown.kind));
  if (!kinds.size) kinds.add('video');
  const missed = new Set([...kinds].flatMap((k) => missedChanges(s.version, k, PAGE_CHANGES)));
  return PAGE_CHANGES.filter((c) => missed.has(c));
}

/** A demo as a card keeps it (`CardRow.demo`, and each of `CardRow.demos`). */
export type StoredDemo = Demo & { dir: string };

/** A demo as the UI gets it: without its directory, and saying whether a video has a poster. */
const shownDemo = ({ dir, ...d }: StoredDemo): Demo => (d.kind !== 'html' && !existsSync(join(dir, 'poster.jpg')) ? { ...d, noPoster: true } : d);

const storedDemos = (r: CardRow): StoredDemo[] => r.demo?.earlier ?? [];

/**
 * The card's earlier demos the owner can still go back to: their files are on disk (demos are
 * deleted to free space) and no later demo was rendered into the same directory over them.
 */
function earlierDemos(r: CardRow): EarlierDemo[] {
  const all = storedDemos(r);
  const later = (i: number) => [...all.slice(i + 1).map((d) => d.dir), ...(r.demo?.latest ? [r.demo.latest.dir] : [])];
  return all.flatMap((d, n) => (!later(n).includes(d.dir) && existsSync(join(d.dir, d.kind === 'html' ? 'index.html' : 'demo.mp4')) ? [{ ...shownDemo(d), n }] : []));
}

/**
 * The changes a page at rest lacks, where its demo is still at hand to share it again: the one on
 * the card, or the one it showed, kept with the share, and its files still on disk (demos are
 * deleted to free space; a page whose files are gone stays as it is, with nothing to offer).
 */
export function reshareable(r: CardRow, theme?: string | null): OutdatedBy[] {
  const s = r.demo?.share ?? null;
  const missed: OutdatedBy[] = s ? [...missedBy(s).map((c) => c.id), ...(themeChanged(s, theme) ? [THEME_CHANGED as OutdatedBy] : [])] : [];
  const demos = s ? sharedDemos(s) : [];
  if (!missed.length || !demos.length || !demos.every((d) => demoThere({ dir: d.dir, kind: d.shown.kind }))) return [];
  return missed;
}

/**
 * The card's demos a page may show, the oldest first: its earlier ones that are still at hand (as
 * `earlierDemos` says), then the one on the card.
 */
export function cardDemos(r: CardRow): StoredDemo[] {
  const all = storedDemos(r);
  const latest = r.demo?.latest ?? null;
  const later = (i: number) => [...all.slice(i + 1).map((d) => d.dir), ...(latest ? [latest.dir] : [])];
  // drafts a question brought are not the work's result: no page shows them
  return [...all.filter((d, i) => !later(i).includes(d.dir) && demoThere(d)), ...(latest ? [latest] : [])].filter((d) => !d.asked);
}

/** States a worker or the owner's decision is still part of. */
export const ACTIVE: string[] = ['working', 'waiting', 'inPr', 'approved'];

/** Exchanges with the Koordinator its sheet shows. */
const SHEET_TALK = 30;

/** The setting that names the card collecting accepted rules for a repository's CLAUDE.md, per repository. */
const CLAUDE_MD_SETTING = 'claude_md_card:';

/** The setting that names the card filling in a repository's settings, proposed by Seismic or made in the Configuration dialog, per repository: Seismic proposes it once. */
const SETUP_CARD_SETTING = 'setup_card:';

/** How long an empty card of the owner's (no title, text or screenshots) may exist before Seismic drops it on start. */
const UNTITLED_GRACE_MS = 10 * 60_000;

/** A request the server refuses: a stable code for the UI's text, and an English detail. */
export class BadRequest extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** The states of a card whose handed-over work the owner approved. */
const APPROVED: CardState[] = ['approved', 'inPr', 'live', 'done'];

/** What the owner can reply to: the messages of a conversation. */
const QUOTABLE: CardEvent['kind'][] = ['say', 'closing', 'question', 'answer', 'hint', 'review', 'talk'];

/**
 * What an agent reads above the owner's words that reply to a message: which one, by its start
 * where the agent has the whole in its session (its own words, the owner's words to it), else whole
 * (Seismic's words in the card's conversation, an idea's agent's to a card's worker; the Koordinator,
 * which reads each command afresh, gets them all whole).
 */
export function replyNote(quoted: CardEvent | undefined, to: 'worker' | 'explorer' | 'koordinator'): string {
  if (!quoted) return '';
  const own = quoted.author === to;
  const what = quoted.kind === 'question' ? 'question' : quoted.kind === 'review' ? 'handover' : 'message';
  const whose = own
    ? `your ${what}`
    : quoted.author === 'owner'
      ? `their own earlier ${what}`
      : quoted.author === 'explorer' || quoted.author === 'worker'
        ? `the ${quoted.author === 'explorer' ? "idea's agent's" : "card's worker's"} ${what}`
        : `Seismic's ${what} in the card's conversation`;
  const heard = own || (quoted.author === 'owner' && quoted.kind !== 'say');
  const text = quoted.text.replace(/\s+/g, ' ').trim();
  return `[In reply to ${whose}: “${excerpt(text, heard && to !== 'koordinator' ? 160 : 2000)}”]\n\n`;
}

/** The start of a text, cut at a word, to point at it. */
export function excerpt(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max / 2 ? cut.slice(0, at) : cut).trimEnd()} …`;
}

/**
 * What the project's plan directories hold: the docs that are plans (a bare path for the home
 * repository, `<repo>:<path>` for another) and, per repository, the others with their reason.
 */
export interface PlanRead {
  docs: PlanDoc[];
  dirs: { repo: string; dir: string; others: OtherDoc[] }[];
}

/** The edges of a card an owner-drawn arrow may leave or reach. */
const SIDES: readonly string[] = ['top', 'right', 'bottom', 'left'];

export class Board {
  private listeners = new Set<() => void>();
  /** Whether the listeners are to hear of the changes made since they last did (`changed`). */
  private telling = false;
  private docs: PlanDoc[] | null = null;
  /** The repositories on the project when `docs` were read. */
  private docsOf = '';
  private dirs: PlanRead['dirs'] = [];
  /** The docs whose plans were on the project at the last snapshot, to see one end or come back. */
  private open: string | null = null;
  private cache: ProjectSnapshot | null = null;
  /** The snapshot's `items`, also while the rest of it is not built (`items`); gone with `cache`. */
  private itemsCache: Item[] | null = null;
  /** What `toItems` made of each card's row, for as long as the row stays the same; gone with any change but a write to one card (`work`). */
  private worked: Worked = new Map();
  /** The archive as `archived` built it; gone with `cache`, since it changes with the same writes. */
  private archiveItems: Item[] | null = null;
  /** The project's prototypes, and those `withPrototypes` handed out so far; gone with `cache`. */
  private prototypeItems: Prototypes | null = null;
  private eventListeners = new Set<(e: CardEvent) => void>();
  private goneListeners = new Set<(cardId: string, id: number) => void>();
  private noticeListeners = new Set<(n: Notice) => void>();

  constructor(
    private store: Store,
    readonly project: ProjectInfo,
    private readDocs: () => PlanRead,
    /** The owner's screenshots, which a card's images must be among. */
    private images?: Pick<Images, 'resolve'>,
    /** Whether the read checkout of the repository holds the commit; without it, every commit counts as held. */
    private holds?: (repo: string, commit: string) => boolean,
    /** The language of Seismic's interface now (`ownerLanguage`): what the server writes itself; the tests speak English. */
    readonly language: () => Language = () => 'en',
    /**
     * The owner's conversation language now (`conversationLanguage`): what agents write the owner
     * in until the owner's words say otherwise; the interface's when left out.
     */
    conversation?: () => Language,
    /** Whether approving work asks the owner for feedback on it now (`feedbackPromptView`); the tests leave it on. */
    readonly asksFeedback: () => boolean = () => true,
  ) {
    this.conversation = conversation ?? language;
    store.ensureProject(project.id, project.name);
    // a new card whose page closed before anything was written in it was never wanted
    store.cards.sweepUntitled(project.id, new Date(Date.now() - UNTITLED_GRACE_MS).toISOString());
  }

  readonly conversation: () => Language;

  /** Where the owner last looked on the project in a page (`ProjectRuntime.inView`): Seismic's new cards go on its canvas. */
  looking: () => Place | undefined = () => undefined;

  /** How the project's finished cards go into the archive now (project setting `archive`); the tests archive by hand. */
  archiving: () => CardArchiving = () => 'manual';

  /** What Seismic says to the owner, in the interface language. */
  get t(): Messages {
    return MESSAGES[this.language()];
  }

  /** The project's home repository: bare plan references and cards without a repository are its. */
  get home(): string {
    return this.project.repos[0]!.id;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onEvent(fn: (e: CardEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  /** A line taken out of a card's log (`unlog`). */
  onEventGone(fn: (cardId: string, id: number) => void): () => void {
    this.goneListeners.add(fn);
    return () => this.goneListeners.delete(fn);
  }

  /** Whoever shows the project (the server, to its pages) shows what Seismic tells the owner above the microphone. */
  onNotice(fn: (n: Notice) => void): () => void {
    this.noticeListeners.add(fn);
    return () => this.noticeListeners.delete(fn);
  }

  /** A line for the owner above the microphone, wherever they are: an answer looked up, a confirmation that came without a command. */
  notify(n: Notice) {
    for (const fn of this.noticeListeners) fn(n);
  }

  /** Owner-drawn dependencies, directed from the prerequisite to the waiting card. */
  /** The owner's arrows, `[from, to]`, each with the edges and place it was drawn at where the owner chose them. */
  manualDependencies(): [string, string, ManualAnchor?][] {
    try { return JSON.parse(this.setting('manual_dependencies') || '[]'); } catch { return []; }
  }

  connect(from: string, to: string, remove = false, anchor?: ManualAnchor) {
    const items = this.snapshot().items;
    if (!items.some((i) => i.id === from) || !items.some((i) => i.id === to) || from === to)
      throw new BadRequest('unknownCard', 'invalid dependency');
    if (!remove && items.some((i) => (i.id === from || i.id === to) && !connectable(i)))
      throw new BadRequest('planDependency', 'plan dependencies are decided from the plan');
    if (anchor && (!SIDES.includes(anchor.fromSide) || !SIDES.includes(anchor.toSide) || !Number.isFinite(anchor.offset) || anchor.offset < 0 || anchor.offset > 1))
      throw new BadRequest('invalid', 'invalid dependency attachment');
    const edges = this.manualDependencies().filter(([a, b]) => a !== from || b !== to);
    if (!remove) {
      // A cycle would leave the cards waiting for each other forever.
      if (closesCycle(from, to, edges.map(([a, b]): [string, string] => [a, b]), items)) throw new BadRequest('dependencyCycle', 'dependency cycle');
      edges.push(anchor ? [from, to, anchor] : [from, to]);
    }
    this.setManualDependencies(edges);
  }

  /** Arrows of cards that no longer exist go; those of a deleted or archived card stay, for its return. */
  private setManualDependencies(edges: [string, string, ManualAnchor?][]) {
    this.setSetting('manual_dependencies', JSON.stringify(edges.filter(([a, b]) => this.store.cards.get(a) && this.store.cards.get(b))));
    this.changed();
  }

  /**
   * A card changed. The listeners hear of it once the code that made the change is through, once
   * for all it changed: each of them may ask for the snapshot, which a change builds anew, and a
   * landing or a card moving on makes dozens of changes in a row.
   */
  changed() {
    // the demos' files may have come or gone with it
    this.worked.clear();
    this.changedRows();
  }

  /**
   * Cards' rows changed, and nothing else: what the other cards' rows make stays (their demos' files
   * are looked at again with the next change of anything else). A landing writes to its card dozens
   * of times, each read back at once, on a project of hundreds of cards with demos.
   */
  private changedRows() {
    this.cache = null;
    this.itemsCache = null;
    this.archiveItems = null;
    this.prototypeItems = null;
    this.tell();
  }

  /** The listeners hear of the changes once the code that made them is through. */
  private tell() {
    if (this.telling) return;
    this.telling = true;
    queueMicrotask(() => {
      this.telling = false;
      for (const fn of this.listeners) {
        try {
          fn();
        } catch (e) {
          console.error(`Seismic: reacting to a change on the project ${this.project.id} failed: ${messageOf(e)}`);
        }
      }
    });
  }

  /** Plan docs changed on disk: read them again. */
  docsChanged() {
    this.docs = null;
    this.changed();
  }

  /**
   * The repository's read checkout moved to `commit` after a fetch: pull requests merged before it,
   * whose merge commit GitHub did not say, count as landed with it. Then the plan docs are read again.
   */
  lesestandMoved(repo: string, commit: string) {
    for (const r of this.store.cards.onProject(this.project.id)) {
      const s = r.shipped ? (JSON.parse(r.shipped) as Shipped) : null;
      if (!commit || !s?.fetch || (r.repo ?? (r.plan_ref ? repoOfRef(r.plan_ref, this.home) : this.home)) !== repo) continue;
      const { fetch: _, ...rest } = s;
      this.store.cards.update(r.id, { shipped: JSON.stringify({ ...rest, commit } satisfies Shipped) });
    }
    this.docsChanged();
  }

  /**
   * The plan doc decides a workstream's state. Stored `live` means its work landed; once the
   * read checkout holds what landed and the doc still leaves the workstream open, only a part of it is
   * done: the card is planned again, to be started for the rest. Its log, PR and handover stay.
   */
  private reopen(docs: PlanDoc[]) {
    const byFile = new Map(docs.map((d) => [d.file, d]));
    for (const r of this.store.cards.onProject(this.project.id)) {
      // a worker still finishing after the landing keeps its card until it is done (workDone)
      if (r.state !== 'live' || !r.plan_ref?.includes('#') || r.landed) continue;
      const hash = r.plan_ref.indexOf('#');
      const w = byFile.get(r.plan_ref.slice(0, hash))?.workstreams.find((x) => x.key === r.plan_ref!.slice(hash + 1));
      if (!w || w.done) continue;
      const s = r.shipped ? (JSON.parse(r.shipped) as Shipped) : {};
      if (s.fetch || (s.commit && this.holds && !this.holds(repoOfRef(r.plan_ref, this.home), s.commit))) continue;
      const pr = r.review?.pr ?? null;
      const shipped: Shipped = { ...s, ...(!s.pr && pr?.url && pr.number ? { pr: { url: pr.url, number: pr.number } } : {}) };
      // a new run starts on a fresh branch: the old one is merged, perhaps squashed
      this.store.updateCard(r.id, { state: 'planned', need: null, review: { pr: null }, branch: null, shipped: JSON.stringify(shipped) });
      this.log(r.id, 'state', 'obeya', this.t.idea.partLanded);
    }
  }

  /**
   * Appends a line to the card's log. `images`: the owner's screenshots, by file or id (the log keeps
   * the id); `replyTo`: the message the owner's words reply to (`quoted`); `spot`: the place in the
   * demo video they are about; `picks`: the options an answer picked; `answer`: a looked-up answer's
   * exchange and files; `at` keeps a message's time when a thread is copied onto its Question card;
   * `wish`: on a reply of Seismic's, what a draft for its makers starts from; `forwarded`: Seismic's
   * reply to what the card's agent passed on; `token`: an error of a session signed in with a token;
   * `made`: the proposal or follow-up made from this card.
   */
  log(
    cardId: string,
    kind: CardEvent['kind'],
    author: CardEvent['author'],
    text: string,
    extra: Partial<Pick<CardEvent, 'code' | 'images' | 'mocks' | 'replyTo' | 'spot' | 'answer' | 'picks' | 'at' | 'wish' | 'reply' | 'forwarded' | 'agent' | 'token' | 'made'>> & { unread?: boolean } = {},
  ): CardEvent {
    const { code, images, mocks, replyTo, spot, answer, picks, at, unread, wish, reply, forwarded, agent, token, made } = extra;
    const e = this.store.events.add({
      cardId,
      kind,
      author,
      text,
      ...(code ? { code } : {}),
      ...(images?.length ? { images: images.map((f) => basename(f)) } : {}),
      ...(mocks?.length ? { mocks } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...(spot ? { spot } : {}),
      ...(answer ? { answer } : {}),
      ...(at ? { at } : {}),
      ...(unread ? { unread: true as const } : {}),
      ...(picks?.length ? { picks } : {}),
      ...(wish ? { wish } : {}),
      ...(reply ? { reply } : {}),
      ...(forwarded ? { forwarded } : {}),
      ...('agent' in extra ? { agent } : {}),
      ...(token ? { token } : {}),
      ...(made ? { made } : {}),
    });
    for (const fn of this.eventListeners) fn(e);
    return e;
  }

  /** Takes a line out of the card's log: a comment the owner deleted before anyone read it. */
  unlog(cardId: string, id: number) {
    this.store.events.delete(cardId, id);
    for (const fn of this.goneListeners) fn(cardId, id);
  }

  /**
   * The card's agent read the owner's words of these lines now: in the conversation they move to
   * where it read them (`CardEvent.readAfter`), and can no longer be taken back.
   */
  readNow(cardId: string, ids: number[]) {
    if (!ids.length) return;
    for (const e of this.store.events.read(cardId, ids)) for (const fn of this.eventListeners) fn(e);
  }

  /**
   * The owner takes back words the agent has not read: they leave the conversation, and so does
   * what they said aloud for them, which stood as the same words just before.
   */
  withdraw(cardId: string, id: number) {
    const events = this.store.events.of(cardId);
    const at = events.findIndex((e) => e.id === id);
    const said = events[at];
    if (!said) return;
    const spoken = events.slice(0, at).findLast((e) => e.author === 'owner');
    if (spoken?.kind === 'say' && spoken.text.trim() === said.text.trim()) this.unlog(cardId, spoken.id);
    this.unlog(cardId, id);
  }

  /** Whether the line is the owner's words the card's agent has not read yet. */
  unread(cardId: string, id: number): boolean {
    return !!this.store.events.get(cardId, id)?.unread;
  }

  /** The message of the sheet `ref` names, if it is one the owner can reply to there. */
  quotedTalk(ref: unknown): TalkQuote | undefined {
    return isTalkRef(ref) ? this.store.talk.sheetQuote(this.project.id, ref) : undefined;
  }

  /** The message of the card's conversation the owner's words reply to, if `id` is one: what someone said, not a step or a state change. */
  quoted(cardId: string, id: unknown): CardEvent | undefined {
    if (typeof id !== 'number' || !Number.isInteger(id)) return;
    const e = this.store.events.get(cardId, id);
    return e && QUOTABLE.includes(e.kind) ? e : undefined;
  }

  /** The latest `limit` messages of the card's conversation, oldest first. */
  talkOf(cardId: string, limit: number): CardEvent[] {
    this.own(cardId);
    return this.store.events.talkOf(cardId, limit);
  }

  events(cardId: string): CardEvent[] {
    this.own(cardId);
    return this.store.events.of(cardId);
  }

  row(id: string): CardRow {
    return this.own(id);
  }

  /** A session of the card's agent started or named what it runs on (`Store.recordRun`). */
  recordRun(cardId: string, session: string, config: WorkConfig) {
    this.own(cardId);
    this.store.agentRuns.record(cardId, session, config);
  }

  /** The owner's responses on the card's work, the earliest first. */
  feedback(cardId: string): Feedback[] {
    this.own(cardId);
    return this.store.feedback.of({ cardId });
  }

  /** Every response the owner gave, on every project (they share the store), the earliest first: what the performance dashboard reads. */
  allFeedback(): Feedback[] {
    return this.store.feedback.of();
  }

  /**
   * The owner's response on the card's work at a handover (its latest, unless `handover` names an
   * earlier one), crediting the sessions that ran on the card up to that handover, as they ran. Given
   * again for the same handover (a second click, a retry), it replaces the answer of the one before.
   */
  giveFeedback(cardId: string, input: unknown): Feedback {
    const row = this.own(cardId);
    const given = checkedFeedback(input);
    if (typeof given === 'string') throw new BadRequest('invalid', given);
    const handover = this.store.events.handover(cardId, given.handover);
    if (!handover) throw new BadRequest('invalid', given.handover === undefined ? 'the card has not handed over any work' : 'no such handover on the card');
    // an archived card's work takes feedback as well: archiving by hand, that is when it is asked for
    const card = this.card(cardId);
    const state = card?.state;
    if (!row.approved_at && !(state && APPROVED.includes(state))) throw new BadRequest('invalid', 'only approved work takes feedback');
    const before = this.store.feedback.of({ cardId }).find((f) => f.handover === handover.id);
    const { attribution, configs } = before ?? attribute(this.store.agentRuns.of(cardId), handover.at);
    // a workstream's title and its plan's come from the plan doc
    const parent = row.parent_id ? this.store.cards.get(row.parent_id) : null;
    const plan = parent?.kind === 'plan' ? { id: parent.id, title: this.item(parent.id)?.title ?? parent.title ?? parent.plan_ref ?? '', ...(parent.plan_ref ? { file: parent.plan_ref } : {}) } : undefined;
    const saved = this.store.feedback.put({
      cardId,
      projectId: row.project_id,
      handover: handover.id,
      title: before?.title ?? card?.title ?? row.title ?? '',
      repo: before ? before.repo : (row.repo ?? this.home),
      plan: before ? before.plan : plan,
      attribution,
      configs,
      answer: given.answer,
      ...(given.facets ? { facets: given.facets } : {}),
    });
    // the card shows the answer on every open page
    this.changedRows();
    return saved;
  }

  /** The directory and kind of the card's latest demo, or of the `n`th of its earlier ones; it stays with the card after approval. */
  demoFiles(id: string, n?: number): { dir: string; kind: DemoKind } | null {
    const r = this.own(id);
    const stored = n === undefined ? r.demo?.latest : storedDemos(r)[n];
    if (!stored) return null;
    return { dir: stored.dir, kind: stored.kind };
  }

  /** The plan doc of a plan, as written, for the owner to read. */
  planDoc(id: string): { file: string; markdown: string } {
    const ref = this.own(id).plan_ref;
    const doc = ref && !ref.includes('#') ? (this.docs ??= this.read()).find((d) => d.file === ref) : undefined;
    if (!doc) throw new BadRequest('invalid', 'not a plan with a plan doc');
    return { file: doc.file, markdown: doc.markdown };
  }

  /** The card as the UI sees it. */
  item(id: string): Item | undefined {
    return this.items().find((i) => i.id === id);
  }

  /** Changes a card's work fields (state, session, workstation …); for the agents, not the owner. */
  work(id: string, update: CardUpdate) {
    this.own(id);
    // a card that leaves the planned state no longer stands where it was stopped
    if (update.state && update.state !== 'planned' && !('stopped_at' in update)) update = { ...update, stopped_at: null };
    this.store.updateCard(id, update);
    this.changedRows();
  }

  /** The cards of the project, archived ones too, that were ever shared or are about to be. */
  sharedRows(): CardRow[] {
    return this.store.cards.shared(this.project.id);
  }

  /**
   * Where a card nobody placed goes: with `place` (where the owner pointed, or the middle of what
   * they have in view), the free spot nearest the card centred on it, in view if there is room there; else a column
   * right of everything, below what is already there.
   */
  freeSpot(place?: Place): { x: number; y: number; canvas: string } {
    const canvas = this.canvasFor(place);
    return { ...this.spotOn(canvas, place?.canvas === canvas || !place?.canvas ? place : undefined), canvas };
  }

  /**
   * The canvas a card nobody placed goes on: the one `place` names, else the one the owner last
   * looked at, else `main`; one that is gone counts as none.
   */
  canvasFor(place?: Place): string {
    const ids = new Set(this.store.canvases.of(this.project.id).map((c) => c.id));
    const named = [place?.canvas, this.looking()?.canvas].find((c) => c && ids.has(c));
    return named ?? this.store.canvases.main(this.project.id);
  }

  /** The cards on one canvas of the project. */
  private on(canvas: string, items = this.items()): Item[] {
    return items.filter((i) => i.canvas === canvas);
  }

  private spotOn(canvas: string, place?: Place): { x: number; y: number } {
    const items = this.on(canvas);
    if (place) {
      const [w, h] = CARD_SIZE.task;
      const at = this.nearFree(items, { x: place.x - w / 2, y: place.y - h / 2 }, place.view);
      return { x: Math.round(at.x), y: Math.round(at.y) };
    }
    const top = items.filter((i) => !i.parent);
    const all = unionBounds(top.map((i) => boundsOf(i, items)));
    if (!all) return { x: 0, y: 0 };
    const column = top.filter((i) => i.kind !== 'plan' && i.x >= all.x + all.w - 400);
    const x = column.length ? Math.min(...column.map((i) => i.x)) : all.x + all.w + 80;
    const y = column.length ? Math.max(...column.map((i) => boundsOf(i, items).y + boundsOf(i, items).h)) + 30 : all.y;
    return { x, y };
  }

  /**
   * Where a follow-up of a card goes: below it, each further one beside the one before; or, when
   * something is in the way there (the card's own plan, for a workstream), the nearest free spot.
   */
  private followUpSpot(fromId: string): { x: number; y: number } {
    const from = this.items().find((i) => i.id === fromId);
    // an archived card is not on the project: its follow-ups go where there is room on its canvas
    if (!from) return this.spotOn(this.store.cards.get(fromId)?.canvas_id ?? this.canvasFor());
    const items = this.on(from.canvas!);
    const earlier = items.filter((i) => i.from === fromId && i.state !== 'proposal' && !i.idea?.prototypeOf).length;
    return this.nearFree(items, below(boundsOf(from, items), earlier), undefined, true);
  }

  /**
   * The free spot nearest `want` for a new card, clear of every plan and card on the project; in `view` if there is room there.
   * With `close` (a card that belongs beside another), a spot more than about two cards away is no use: in a crowded area the card
   * stays at `want`, overlapping, so it remains in view of the card it follows.
   */
  private nearFree(items: Item[], want: { x: number; y: number }, view?: Bounds, close = false): { x: number; y: number } {
    const at = freeSpotNear(
      want,
      CARD_SIZE.task,
      items.filter((i) => !i.parent).map((i) => boundsOf(i, items)),
      view,
    );
    return close && Math.hypot(at.x - want.x, at.y - want.y) > 2 * CARD_SIZE.task[0] ? want : at;
  }

  /** The worker's last summary of a card; it stays with the card until work on it starts again. */
  summary(id: string): string | undefined {
    const r = this.own(id);
    return r.detail ? (JSON.parse(r.detail) as { summary?: string }).summary : undefined;
  }

  /**
   * A card an agent proposes, placed below the card it came from, or at the nearest free spot: its
   * text for the agent that takes it on, and apart from it why and what the owner has to decide.
   */
  /** An agent's proposal from card `fromId`: in the repository it names (`p.repo`), else in that card's. */
  propose(fromId: string, p: { title: string; task: string; reason?: string; idea?: boolean; questions?: Question[]; startAt?: string; repo?: string }): Item {
    if (p.repo !== undefined) this.checkRepo(p.repo);
    const from = this.items().find((i) => i.id === fromId);
    const canvas = from?.canvas ?? this.store.cards.get(fromId)?.canvas_id ?? this.canvasFor();
    const items = this.on(canvas);
    const at = from ? this.nearFree(items, below(boundsOf(from, items)), undefined, true) : this.spotOn(canvas);
    const proposal = proposalOf(p);
    const [row] = this.store.addCards([
      {
        project_id: this.project.id,
        canvas_id: canvas,
        kind: 'task',
        state: 'proposal',
        title: p.title.slice(0, 200),
        body: p.task.slice(0, 20000),
        ...at,
        from_id: fromId,
        repo: this.repoColumn(p.repo ?? from?.repo),
        idea: { proposal },
        group_id: from?.group ?? null,
      },
    ]);
    // its questions stand in its conversation as the proposing agent asked them, and stay there once settled
    for (const q of proposal.questions) this.log(row!.id, 'question', 'worker', formatQuestion(q, this.language()));
    this.record(row!.id, 'proposed', 'agent');
    this.changed();
    return this.itemOf(row!);
  }

  /**
   * An agent withdraws one of its own proposals from card `fromId` (the latest by that title), or
   * marks it replaced (`s.by`): still open, it goes at once; already accepted and not finished, it
   * carries the mark until the owner removes the card or keeps it. Says what became of it.
   */
  retract(fromId: string, title: string, s: Superseded): Retracted {
    // the proposal that replaces it is not among those it may replace
    const mine = this.store.cards.proposalsFrom(this.project.id, fromId).filter((r) => r.id !== s.by);
    const row = mine.findLast((r) => titleKey(r.title ?? '') === titleKey(title));
    if (!row) return { kind: 'unknown', mine: mine.map((r) => ({ title: r.title ?? '', state: r.state ?? 'planned', gone: !!r.deleted_at })) };
    const proposal = storedProposal(row)!;
    const was = { title: row.title ?? '', state: row.state ?? 'planned' };
    if (row.deleted_at) return { kind: proposal.superseded ? 'already' : was.state === 'proposal' ? 'dismissed' : 'removed', ...was };
    if (row.archived_at || finished(was.state)) return { kind: 'finished', ...was };
    const superseded = { proposal: { ...proposal, superseded: s } satisfies Proposal };
    // a proposal still open goes without the owner, as if never made
    if (was.state === 'proposal') this.store.updateCard(row.id, { deleted_at: new Date().toISOString(), idea: superseded });
    else {
      this.store.updateCard(row.id, { idea: superseded });
      this.log(row.id, 'state', 'koordinator', this.t.worker.superseded(s.title, s.why));
    }
    this.changed();
    return { kind: was.state === 'proposal' ? 'gone' : 'marked', ...was };
  }

  /** The owner keeps a card whose agent withdrew or replaced it: the mark goes. */
  keep(id: string) {
    const row = this.own(id);
    const { superseded, ...proposal } = storedProposal(row) ?? { questions: [] };
    if (!superseded) throw new BadRequest('notSuperseded', 'its agent has not withdrawn or replaced this card');
    this.store.updateCard(id, { idea: { proposal: proposal satisfies Proposal } });
    this.changed();
  }

  /**
   * A card the work retrospective proposes for a repository: it waits as a proposal like an agent's,
   * in a free spot, with what it rests on (`basis`).
   */
  proposeRetro(repo: string, p: { title: string; body: string; basis: string }): Item {
    const { canvas, ...at } = this.freeSpot();
    const [row] = this.store.addCards([
      {
        project_id: this.project.id,
        canvas_id: canvas,
        kind: 'task',
        state: 'proposal',
        title: p.title.slice(0, 200),
        body: p.body.slice(0, 20000),
        ...at,
        repo: this.repoColumn(repo),
        retro: p.basis.slice(0, 2000),
        idea: { proposal: proposalOf({}) },
      },
    ]);
    this.record(row!.id, 'proposed', 'obeya');
    this.changed();
    return this.itemOf(row!);
  }

  /**
   * The card that fills in a repository's settings for everyone while it is open: the one made for
   * it (`setupCard`), else one of its title made before Seismic noted which it was.
   */
  openSetupCard(repo: string, name: string): Item | undefined {
    const id = this.setting(`${SETUP_CARD_SETTING}${repo}`);
    const title = this.t.adapterSetup.title(name);
    return this.items().find((i) => i.kind === 'task' && i.repo === repo && (i.id === id || i.title === title) && !finished(i.state) && !i.archivedAt);
  }

  /** Whether the card is the one made to fill in its repository's settings (`setupCard`). */
  isSetupCard(card: Item): boolean {
    return this.setting(`${SETUP_CARD_SETTING}${card.repo ?? this.home}`) === card.id;
  }

  /**
   * Makes the card that fills in a repository's settings for everyone, right of everything on the
   * project, at the top: the owner's, or Seismic's proposal (`propose`) with why. Either way Seismic
   * proposes it no more.
   */
  setupCard(repo: string, name: string, propose = false): Item {
    this.checkRepo(repo);
    const { title, body, reason } = this.t.adapterSetup;
    // on `main`, clear of the note on the plan directory, as on a project that has nothing else yet
    const { planDirs = [] } = this.snapshot();
    const items = this.on(this.store.canvases.main(this.project.id));
    const box = unionBounds([...items.filter((i) => !i.parent).map((i) => boundsOf(i, items)), ...planDirs.flatMap((d) => planDirNoteBox(d) ?? [])]);
    const at = box ? { x: box.x + box.w + 2 * GAP, y: box.y } : { x: 0, y: 0 };
    const [row] = this.store.addCards([
      {
        project_id: this.project.id,
        kind: 'task',
        state: propose ? 'proposal' : 'planned',
        title: title(name),
        body,
        ...at,
        repo: this.repoColumn(repo),
        ...(propose ? { idea: { proposal: { ...proposalOf({ reason: reason(name) }), setup: true } satisfies Proposal } } : {}),
      },
    ]);
    this.setSetting(`${SETUP_CARD_SETTING}${repo}`, row!.id);
    this.changed();
    return this.itemOf(row!);
  }

  /**
   * Seismic proposes the setup card (`setupCard`) for a repository whose settings it does not know
   * (`unknown`), once: dismissed, accepted or made in the dialog, it does not come back. Its
   * proposal still open goes once the settings are there, withdrawn rather than dismissed.
   */
  proposeSetup(repo: string, name: string, unknown: boolean) {
    const id = this.setting(`${SETUP_CARD_SETTING}${repo}`);
    if (!id) {
      if (unknown && !this.openSetupCard(repo, name)) this.setupCard(repo, name, true);
      return;
    }
    const row = this.store.cards.get(id);
    if (unknown || !row || row.deleted_at || row.state !== 'proposal') return;
    this.store.updateCard(id, { deleted_at: new Date().toISOString(), idea: { proposal: { ...storedProposal(row)!, superseded: {} } satisfies Proposal } });
    this.changed();
  }

  /** The cards the work retrospective proposed for a repository, with what became of them. */
  retroProposals(repo: string) {
    return this.store.cards.retroProposals(this.project.id, this.repoColumn(repo));
  }

  /** A value for a repository's setting the work retrospective proposes: it waits in Seismic's sheet beside the rules. */
  proposeSetting(p: { repo: string; field: ProposedSetting; value: string | string[]; basis: string; cards: string[] }): number {
    this.checkRepo(p.repo);
    const id = this.store.settingProposals.add(this.project.id, { ...p, basis: p.basis.slice(0, 2000) });
    this.changed();
    return id;
  }

  /** The settings the work retrospective proposed, with what became of them: those of a repository, or all. */
  settingProposals(repo?: string) {
    return this.store.settingProposals.of(this.project.id, repo);
  }

  /** The waiting setting proposal; a BadRequest where it was decided meanwhile or never was. */
  settingProposal(id: number): SettingProposal {
    const p = this.settingProposals().find((x) => x.id === id && x.state === 'proposed');
    if (!p) throw new BadRequest('unknownSetting', 'no such setting proposal');
    const { state: _, ...rest } = p;
    return rest;
  }

  /** The owner took a setting proposal (on this machine, or into the repository for everyone, with `value`) or rejected it; a rejected one is kept, so it does not come back. */
  decideSetting(id: number, state: Exclude<SettingProposalState, 'proposed'>, value?: string | string[]) {
    if (!this.store.settingProposals.decide(this.project.id, id, state, value)) throw new BadRequest('unknownSetting', 'no such setting proposal');
    this.changed();
  }

  addFriction(repo: string, cardId: string, notes: FrictionNote[]) {
    if (notes.length) this.store.friction.add(this.project.id, repo, cardId, notes);
  }

  /** The friction noted on a repository's cards after `since` (all without), oldest first. */
  friction(repo: string, since: string | null): Friction[] {
    return this.store.friction.of(this.project.id, repo, since);
  }

  decide(d: { plan_id: string | null; card_id: string; question: string; answer: string; by: 'owner' }) {
    this.store.decisions.add({ projectId: this.project.id, planId: d.plan_id, cardId: d.card_id, question: d.question, answer: d.answer, by: d.by });
  }

  /** The decisions taken on one card, oldest first. */
  decisionsOn(cardId: string): Decision[] {
    return this.store.decisions.ofCard(this.project.id, cardId).map(toDecision);
  }

  /** A plan's decisions, or with `null` those of standalone cards. */
  decisions(planId: string | null) {
    return this.store.decisions.of(this.project.id, planId);
  }

  setting(key: string): string | null {
    return this.store.settings.get(this.project.id, key);
  }

  setSetting(key: string, value: string) {
    this.store.settings.set(this.project.id, key, value);
  }

  /** Sharing many outdated pages again, while it runs and until the owner puts its result away. */
  reshareRun(): StoredReshare | null {
    const v = this.setting(RESHARE_SETTING);
    return v ? (JSON.parse(v) as StoredReshare) : null;
  }

  setReshareRun(run: StoredReshare | null) {
    this.setSetting(RESHARE_SETTING, run ? JSON.stringify(run) : '');
    this.changed();
  }

  /**
   * The outdated pages the Koordinator's sheet offers to share again, archived cards' included,
   * with the changes each lacks: after the owner put the notice away, only those a newer change
   * left outdated.
   */
  outdatedRows(shared = this.sharedRows()): { r: CardRow; missed: OutdatedBy[] }[] {
    const at = (id: string | null) => PAGE_CHANGES.findIndex((c) => c.id === id);
    const dismissed = at(this.setting(RESHARE_DISMISSED));
    const themes = this.dismissedThemes();
    const hidden = (r: CardRow) => {
      const was = themes[r.id];
      return !!was && JSON.stringify(was) === JSON.stringify(this.themePair(r));
    };
    return shared
      .map((r) => ({ r, missed: this.outdatedBy(r) }))
      .filter(({ r, missed }) => missed.some((id) => (id === THEME_CHANGED ? !hidden(r) : at(id) > dismissed)));
  }

  /** What leaves the card's page outdated (`reshareable`), its repository's theme included. */
  outdatedBy(r: CardRow): OutdatedBy[] {
    return reshareable(r, this.themeNow(r));
  }

  /** The current theme of each repository (its hash, null for none), by its id; for the pages it leaves outdated. */
  private themeOf?: (repo: string) => string | null | undefined;

  showThemes(of: (repo: string) => string | null | undefined) {
    this.themeOf = of;
    this.changed();
  }

  /** The current theme's hash of the card's repository (`ThemeNow`). */
  private themeNow: ThemeNow = (r) => this.themeOf?.(repoOfRow(r, this.home));

  /** The pages a theme left outdated when the owner put the notice away (`RESHARE_DISMISSED_THEMES`). */
  private dismissedThemes(): Record<string, ThemePair> {
    const v = this.setting(RESHARE_DISMISSED_THEMES);
    return v ? (JSON.parse(v) as Record<string, ThemePair>) : {};
  }

  /** The theme the card's page was published with, and its repository's now. */
  private themePair(r: CardRow): ThemePair {
    return [r.demo!.share!.theme ?? null, this.themeNow(r) ?? null];
  }

  /**
   * The shared pages the Koordinator's sheet offers to tag ("N pages without tags"), archived cards'
   * included: at rest, their demos at hand, on a site with a vocabulary, and lacking tags in one of
   * its dimensions.
   */
  untaggedRows(shared = this.sharedRows()): CardRow[] {
    return shared.filter((r) => {
      const s = r.demo!.share!;
      const vocabulary = this.vocabularyOf?.(repoOfRow(r, this.home));
      if (!s.url || s.state || !vocabulary || !untagged(pageTagsOf(r), vocabulary).length) return false;
      const demos = sharedDemos(s);
      return demos.length > 0 && demos.every((d) => demoThere({ dir: d.dir, kind: d.shown.kind }));
    });
  }

  /** The vocabulary of tags the project names for its demo site, for the pages without tags; none where it names none. */
  private vocabularyOf?: (repo: string) => PageTags | undefined;

  showVocabulary(of: (repo: string) => PageTags | undefined) {
    this.vocabularyOf = of;
    this.changed();
  }

  /** "Ausblenden": the notice of outdated pages goes until a newer change, and the result of a run that finished with it. */
  dismissOutdated() {
    this.setSetting(RESHARE_DISMISSED, pagesVersion());
    // the pages outdated by a theme now; one no longer is needs no entry
    const themes: Record<string, ThemePair> = {};
    for (const r of this.sharedRows()) if (this.outdatedBy(r).includes(THEME_CHANGED)) themes[r.id] = this.themePair(r);
    this.setSetting(RESHARE_DISMISSED_THEMES, JSON.stringify(themes));
    this.setReshareRun(null);
  }

  /** An idea's stored status and brief. */
  idea(id: string): StoredIdea {
    const r = this.own(id);
    if (r.state !== 'idea') throw new BadRequest('notIdea', 'the card is not an idea');
    return r.idea?.discussion ?? { status: 'open', brief: '' };
  }

  setIdea(id: string, fields: Partial<StoredIdea>) {
    this.work(id, { idea: { discussion: { ...this.idea(id), ...fields } } });
  }

  /** The thread of looked-up answers a Question card (or an idea that was one) holds. */
  thread(id: string): StoredThread {
    const r = this.own(id);
    if (!r.thread) throw new BadRequest('notQuestion', 'the card holds no thread of answers');
    return JSON.parse(r.thread) as StoredThread;
  }

  setThread(id: string, fields: Partial<StoredThread>) {
    this.work(id, { thread: JSON.stringify({ ...this.thread(id), ...fields }) });
  }

  /**
   * A Question card for a thread of looked-up answers, near the card whose log holds them (`near`)
   * or where there is room: its question as its title, the agent's session going on.
   */
  addQuestion(title: string, thread: StoredThread, session: string | undefined, repo: string | undefined, near?: string): Item {
    const nearRow = near && this.item(near) ? this.own(near) : undefined;
    const { canvas, ...at } = nearRow ? { ...this.followUpSpot(nearRow.id), canvas: nearRow.canvas_id } : this.freeSpot();
    const [row] = this.store.addCards([
      { project_id: this.project.id, canvas_id: canvas, kind: 'question', state: 'done', title: clip(oneLine(title), 160), body: '', ...at, repo: this.repoColumn(repo), ...(near && this.item(near) ? { group_id: this.groupOf(this.own(near)) } : {}) },
    ]);
    this.store.cards.update(row!.id, { thread: JSON.stringify(thread), ...(session ? { session_id: session } : {}) });
    this.changed();
    return this.item(row!.id)!;
  }

  /** A card whose worker builds a throwaway prototype for the idea; placed below it, beside the prototypes already there. */
  addPrototype(ideaId: string, title: string, body: string, variant?: string): Item {
    const canvas = this.store.cards.get(ideaId)?.canvas_id ?? this.canvasFor();
    const items = this.on(canvas);
    const idea = items.find((i) => i.id === ideaId);
    const at = below(idea ? boundsOf(idea, items) : { x: 0, y: 0, w: 0, h: 0 }, items.filter((i) => i.idea?.prototypeOf === ideaId).length);
    const [row] = this.store.addCards([
      {
        project_id: this.project.id,
        canvas_id: canvas,
        kind: 'task',
        state: 'planned',
        title: title.slice(0, 200),
        body: body.slice(0, 20000),
        ...at,
        from_id: ideaId,
        idea: { prototypeOf: ideaId, ...(variant ? { prototype: { variant } satisfies StoredPrototype } : {}) },
        group_id: idea?.group ?? null,
        repo: this.repoColumn(idea?.repo),
      },
    ]);
    this.changed();
    return this.itemOf(row!);
  }

  /** The prototype's worker proposes to build the idea on it; the owner accepts on the prototype's card. */
  proposeBuild(id: string, reason: string) {
    const row = this.own(id);
    if (!row.idea?.prototypeOf) throw new BadRequest('notPrototype', 'not a prototype');
    this.work(id, { idea: { prototype: { ...storedPrototype(row), proposal: reason } satisfies StoredPrototype } });
  }

  /**
   * A prototype has served its purpose: discarded or built, it goes into the archive with its log,
   * demo and summary, and never comes back. Its workstation is no longer its own.
   */
  endPrototype(id: string, end: 'discarded' | 'built', into?: string) {
    const row = this.own(id);
    if (!row.idea?.prototypeOf) throw new BadRequest('notPrototype', 'not a prototype');
    const { proposal: _, ...kept } = storedPrototype(row);
    this.work(id, { archived_at: new Date().toISOString(), need: null, status_line: null, workstation: null, queue: null, idea: { prototype: { ...kept, end, ...(into ? { into } : {}) } satisfies StoredPrototype } });
  }

  // ---------------------------------------------------------------- the Koordinator's memory

  /**
   * Records an exchange with the Koordinator, without its reply (`''`) while it reads the words;
   * returns its id. `replyTo`: the message of the sheet the words reply to.
   */
  addTalk(said: string, reply: string, cardId: string | null = null, lookUp?: { question: string; about: string | null }, images: string[] = [], replyTo?: TalkRef, after?: TalkAfter, askedIn?: string, answered?: number): number {
    const id = this.store.addTalk(this.project.id, said, reply, cardId, lookUp, images, replyTo, after, askedIn, answered);
    this.changed();
    return id;
  }

  /** The Koordinator's reply to words it has read, the question it looks up for them, and what a draft for Seismic's makers would start from; `waits`: unread in the sheet until the owner sees it. */
  replyTalk(id: number, reply: string, lookUp?: { question: string; about: string | null }, wish?: Wish, waits = false, agent?: AgentIdentity) {
    if (arguments.length < 6) this.store.talk.reply(id, reply, lookUp, wish, waits);
    else this.store.talk.reply(id, reply, lookUp, wish, waits, agent);
    this.changed();
  }

  /**
   * After a restart: words the Koordinator was reading when Seismic stopped are not read any more;
   * they get a reply that says so, in the sheet or on the card that was open.
   */
  interruptTalk() {
    const lost = this.store.talk.interrupt(this.project.id, this.t.voice.interrupted);
    for (const x of lost) if (x.cardId && this.item(x.cardId)) this.log(x.cardId, 'say', 'koordinator', this.t.voice.interrupted, { reply: true });
    if (lost.length) this.changed();
  }

  /** Words the usage limit keeps the Koordinator from reading, until it lifts; `null` once it reads them. */
  holdTalk(id: number, held: HeldTalk | null) {
    this.store.talk.hold(id, held);
    this.changed();
  }

  /** The words the usage limit holds, oldest first: after a restart, the Koordinator reads them once it lifts. */
  heldTalk() {
    return this.store.talk.held(this.project.id);
  }

  /** The cards the Koordinator waits on after the exchange's reply, to take a step once each gets there. */
  waitTalk(id: number, waits: TalkWaitRow[]) {
    this.store.talk.wait(id, waits);
    this.changed();
  }

  /** The exchanges whose reply said the Koordinator waits on a card. */
  waitingTalk() {
    return this.store.talk.waiting(this.project.id);
  }

  /** The step the Koordinator takes once the exchange's looked-up answer is in, and where the owner was then; `null` once it has decided it. */
  thenTalk(id: number, then: string | null, place?: Place) {
    this.store.talk.thenStep(id, then, place);
  }

  /** Looked-up answers that are in whose step the Koordinator has not decided yet: after a restart, it takes them up. */
  answeredSteps() {
    return this.store.talk.answeredSteps(this.project.id);
  }

  undoTalk(id: number) {
    this.store.talk.undo(id);
    this.changed();
  }

  /** A command waiting for "Undo" until `due`, kept across a restart (`Commander`). */
  holdCommand(token: string, due: number, body: unknown) {
    this.store.commands.hold(this.project.id, token, new Date(due).toISOString(), JSON.stringify(body));
  }

  dropCommand(token: string) {
    this.store.commands.drop(token);
  }

  heldCommands(): { token: string; due: number; body: unknown }[] {
    return this.store.commands.held(this.project.id).map((r) => ({ token: r.token, due: Date.parse(r.due), body: JSON.parse(r.body) as unknown }));
  }

  talk(limit?: number) {
    return this.store.talk.latest(this.project.id, limit);
  }

  /** The latest exchanges of the chat the owner talks in now, oldest first: the Koordinator's memory. */
  chatTalk(limit: number) {
    return this.store.talk.latest(this.project.id, limit, false, this.store.chats.current(this.project.id));
  }

  /** The chat the owner talks in now. */
  chat(): number {
    return this.store.chats.current(this.project.id);
  }

  chatModel() { return this.store.chats.model(this.project.id); }

  setChatModel(model?: import('../core/types').AgentModel) {
    this.store.chats.setModel(this.project.id, model);
    this.changed();
  }

  /** The owner starts a new chat with Seismic (the current one while nothing was said in it); returns it. */
  newChat(): number {
    const id = this.store.chats.start(this.project.id);
    this.changed();
    return id;
  }

  /** The chats with Seismic on every project of the database, the latest first. */
  everyChat() {
    return this.store.chats.list();
  }

  /** The owner goes back to an earlier chat. */
  openChat(id: number) {
    if (!this.store.chats.open(this.project.id, id)) throw new BadRequest('invalid', 'unknown chat');
    this.changed();
  }

  /** The answer to a question the Koordinator looked up, with the files it comes with. */
  answerTalk(id: number, answer: string, by: 'koordinator' | 'plan', files: AnswerFile[] = [], agent?: AgentIdentity) {
    if (arguments.length < 5) this.store.talk.answer(id, answer, by, files);
    else this.store.talk.answer(id, answer, by, files, agent);
    this.changed();
  }

  /** The exchange follows up on the answer of `follows`: it goes on in that one's thread. */
  followTalk(id: number, follows: number) {
    const f = this.store.talk.exchange(follows);
    if (!f?.thread) throw new BadRequest('invalid', 'the exchange followed up on was not looked up');
    this.store.talk.follow(id, f.thread, follows);
    this.changed();
  }

  /** The session of the agent that looks the exchange's question up. */
  talkSession(id: number, session: string) {
    this.store.talk.session(id, session);
  }

  /** The exchanges of a looked-up thread, oldest first. */
  threadTalk(thread: number) {
    return this.store.talk.thread(this.project.id, thread);
  }

  /** The thread is on a Question card from now on. */
  moveThread(thread: number, card: string) {
    this.store.talk.moveThread(this.project.id, thread, card);
    this.changed();
  }

  /** The owner has the Koordinator's sheet in view: its answers are read. */
  /** The owner has Seismic's sheet in view, or (`ids`) those exchanges in a plan's sheet. */
  readTalk(ids?: number[]) {
    if (this.store.readTalk(this.project.id, ids)) this.changed();
  }

  exchange(id: number) {
    return this.store.talk.exchange(id);
  }

  /** Questions the Koordinator is still looking up. */
  lookingUp(): number[] {
    return this.store.talk.lookingUp(this.project.id);
  }

  /** The cards' history after `since` (ISO time, or a `mark`), oldest first, at most the latest `limit` steps. */
  timeline(since: string | Mark, limit: number) {
    return this.store.timeline(this.project.id, since, limit);
  }

  /** Where the cards' history stands now. */
  mark() {
    return this.store.mark();
  }

  /** What the owner said after `since` (ISO time), oldest first, at most the latest `limit`. */
  utterances(since: string, limit: number) {
    return this.store.utterances(this.project.id, since, limit);
  }

  /** Rule proposals the owner accepted or rejected after `since` (ISO time), oldest first. */
  decidedProposals(since: string) {
    return this.store.preferences.decided(this.project.id, since);
  }

  /** The owner's cards deleted after `since` (ISO time), oldest first. */
  removed(since: string) {
    return this.store.cards.removed(this.project.id, since);
  }

  /**
   * The owner takes a proposal: as an idea (`asIdea`, whatever it was proposed as), else as a
   * planned task. Its questions join the text, with the options picked (`picks`) as decided.
   */
  accept(id: string, picks: string[][] = [], asIdea = false) {
    const row = this.own(id);
    if (row.state !== 'proposal') throw new BadRequest('notProposal', 'not a proposal');
    const proposal = storedProposal(row);
    if (proposal?.revising) throw new BadRequest('revising', 'the proposal is being reworked');
    if (proposal?.merge) throw new BadRequest('merging', 'the proposal is merged with another card; approve or separate that first');
    // an agent's proposal keeps that it was one: its task is not the owner's words; Seismic's setup card is as if the owner made it
    const kept = proposal && !proposal.setup ? ({ ...(proposal.idea ? { idea: true } : {}), questions: [] } satisfies Proposal) : null;
    this.store.updateCard(id, { state: asIdea ? 'idea' : 'planned', body: withQuestions(row.body ?? '', proposal?.questions ?? [], picks, this.t), idea: { proposal: kept } });
    this.changed();
  }

  /**
   * The owner wants a proposal changed: an agent reworks it by their words, and it waits for that.
   * Words said while it is reworked wait for the rework after it. Returns whether they wait.
   */
  revising(id: string, words: string, spoken: boolean, said?: number, images: string[] = []): boolean {
    const row = this.own(id);
    if (row.state !== 'proposal') throw new BadRequest('notProposal', 'not a proposal');
    const proposal = storedProposal(row) ?? { questions: [] };
    if (proposal.merge) throw new BadRequest('merging', 'the proposal is merged with another card; approve or separate that first');
    const these: Revising = {
      words: words.slice(0, 20000),
      ...(spoken ? { spoken } : {}),
      ...(said ? { said: [said] } : {}),
      ...(images.length ? { images: images.map((f) => basename(f)) } : {}),
    };
    const revising = proposal.revising ? { ...proposal.revising, next: [...(proposal.revising.next ?? []), these] } : these;
    this.store.updateCard(id, { idea: { proposal: { ...proposal, revising } satisfies Proposal } });
    this.changed();
    return revising !== these;
  }

  /** The owner takes back words that wait for the proposal's next rework; false when none of them are these. */
  unrevise(id: string, said: number): boolean {
    const row = this.own(id);
    const proposal = storedProposal(row);
    const next = proposal?.revising?.next;
    if (!proposal?.revising || !next?.some((r) => r.said?.includes(said))) return false;
    const rest = next.filter((r) => !r.said?.includes(said));
    const { next: _, ...revising } = proposal.revising;
    this.store.updateCard(id, { idea: { proposal: { ...proposal, revising: { ...revising, ...(rest.length ? { next: rest } : {}) } } satisfies Proposal } });
    this.changed();
    return true;
  }

  /** When the proposal starts once accepted (ISO), or at once (`null`). */
  startAt(id: string, at: string | null) {
    const row = this.own(id);
    if (row.state !== 'proposal') throw new BadRequest('notProposal', 'not a proposal');
    const { startAt: _, ...proposal } = storedProposal(row) ?? { questions: [] };
    this.store.updateCard(id, { idea: { proposal: { ...proposal, ...(at ? { startAt: at } : {}) } satisfies Proposal } });
    this.changed();
  }

  /** "Accept and start" during a revision (`on`; `idea`: "Ideate"), or taken back; false when that was so already. */
  acceptAfterRevision(id: string, on: boolean | 'idea'): boolean {
    const row = this.own(id);
    if (row.state !== 'proposal') throw new BadRequest('notProposal', 'not a proposal');
    const { acceptAfterRevision: was, ...proposal } = storedProposal(row) ?? { questions: [] };
    if ((was ?? false) === on) return false;
    this.store.updateCard(id, { idea: { proposal: { ...proposal, ...(on ? { acceptAfterRevision: on } : {}) } satisfies Proposal } });
    this.changed();
    return true;
  }

  /**
   * The reworked proposal takes the place of the old one, or, without one (the agent failed), the
   * old one stands as it was; `images`, when given, are the screenshots that go with its task now.
   * Accepting it after the revision stays for the caller to settle. False when the card is no
   * proposal any more (dismissed meanwhile).
   */
  revised(id: string, p?: { title: string; task: string; reason?: string; idea?: boolean; questions: Question[]; images?: string[] }): boolean {
    const row = this.store.cards.get(id);
    if (!row || row.project_id !== this.project.id || row.deleted_at || row.state !== 'proposal') return false;
    const { revising: done, ...was } = storedProposal(row) ?? { questions: [] };
    // what the owner said meanwhile is the next rework's
    const next = done?.next?.length ? { revising: merged(done.next) } : {};
    // when it starts is the owner's to change, not the reviser's
    const proposal: Proposal = p ? { ...proposalOf({ ...p, startAt: was.startAt }), ...(was.acceptAfterRevision ? { acceptAfterRevision: was.acceptAfterRevision } : {}), ...(was.setup ? { setup: was.setup } : {}) } : was;
    this.store.updateCard(id, {
      ...(p ? { title: p.title.slice(0, 200), body: p.task.slice(0, 20000) } : {}),
      ...(p?.images ? { images: p.images.length ? JSON.stringify(p.images) : null } : {}),
      idea: { proposal: { ...proposal, ...next } satisfies Proposal },
    });
    this.changed();
    return true;
  }

  // ---------------------------------------------------------------- merging cards

  /**
   * The owner merges unworked task `id` with card `withId` (`mergeableWith` it): the two show as one, at
   * the free spot nearest the other card, while an agent writes the merged card. A merge that
   * failed may be tried again.
   */
  mergeStart(id: string, withId: string) {
    let p = this.card(id);
    let other = this.card(withId);
    if (!p || !other) throw new BadRequest('unknownCard', 'unknown card');
    const was = p.idea?.proposal?.merge;
    if (this.items().some((i) => i.id !== id && i.idea?.proposal?.merge?.with === withId)) throw new BadRequest('notMergeable', 'the partner is being merged already');
    if (was && (was.failed === undefined || was.with !== withId)) throw new BadRequest('merging', 'the card is being merged already');
    const clean = withPart(p, 'idea', { proposal: p.idea?.proposal ? { ...p.idea.proposal, merge: undefined } : undefined });
    if (!mergeableWith(clean, other.idea?.mergingInto === id ? withPart(other, 'idea', { mergingInto: undefined }) : other)) throw new BadRequest('notMergeable', `“${other.title}” can no longer be merged with`);
    // A planned card picked a proposal: the proposal is the dissolving left side.
    if (!was && mergeRank(p) > mergeRank(other)) [p, other] = [other, p];
    id = p.id;
    withId = other.id;
    const row = this.own(id);
    const items = this.items();
    const taken = items.filter((i) => !i.parent && i.id !== id && i.id !== withId && !i.idea?.mergingInto).map((i) => boundsOf(i, items));
    const at = was ? {} : freeSpotNear({ x: other.x, y: other.y }, MERGED_SIZE, taken);
    const proposal = storedProposal(row) ?? { questions: [] };
    this.store.updateCard(id, { ...at, idea: { proposal: { ...proposal, merge: { with: withId, attempt: crypto.randomUUID(), origin: was?.origin ?? { x: row.x, y: row.y }, ...((was?.temporaryProposal || !row.idea?.proposal) ? { temporaryProposal: true as const } : {}) } } satisfies Proposal } });
    this.log(id, 'state', 'koordinator', this.t.koordinator.mergeStarted(other.title));
    this.changed();
    return id;
  }

  /** The merged card as the agent wrote it, or why there is none; false when the proposal is not being merged (any more). */
  merged(id: string, r: Omit<Merge, 'with' | 'failed'> & { title: string; task: string } | { failed: string }, attempt?: string): boolean {
    const row = this.store.cards.get(id);
    if (!row || row.project_id !== this.project.id || row.deleted_at) return false;
    const proposal = storedProposal(row);
    const was = proposal?.merge;
    if (!was || (attempt !== undefined && was.attempt !== attempt) || was.task !== undefined || was.failed !== undefined) return false;
    const merge = 'failed' in r ? { ...was, failed: r.failed.slice(0, 2000) } : { ...was, ...r, title: r.outcome ? r.title : r.title.trim().slice(0, 200), task: r.outcome ? r.task : r.task.trim().slice(0, 20000) };
    this.store.updateCard(id, { idea: { proposal: { ...proposal, merge } satisfies Proposal } });
    if ('failed' in r) this.log(id, 'error', 'koordinator', this.t.koordinator.mergeFailed(r.failed));
    this.changed();
    return true;
  }

  /** Separate restores both original cards, including their places. */
  separate(id: string) {
    const row = this.own(id);
    const { merge, ...proposal } = storedProposal(row) ?? { questions: [] };
    if (!merge) throw new BadRequest('notProposal', 'the proposal is not merged with another card');
    const other = this.store.cards.get(merge.with);
    const there = other && other.project_id === this.project.id && !other.deleted_at && !other.archived_at;
    this.store.updateCard(id, { ...merge.origin ?? {}, idea: { proposal: merge.temporaryProposal ? null : (proposal satisfies Proposal) } });
    // Both originals keep their exact place when separated.
    this.log(id, 'state', 'koordinator', this.t.koordinator.mergeSeparated(there ? (other.title ?? '') : ''));
    this.changed();
  }

  /** Hide a duplicate suggestion while retaining the checked task text for a deliberate start. */
  dismissDuplicate(id: string) {
    const row = this.own(id);
    if (row.state !== 'planned' || !row.scope) throw new BadRequest('notPlanned', 'no duplicate suggestion on this card');
    const scope = JSON.parse(row.scope) as { duplicateCheck?: { title: string; body: string; ids?: string[]; dismissed?: boolean } };
    if (!scope.duplicateCheck?.ids?.length || scope.duplicateCheck.dismissed) throw new BadRequest('notPlanned', 'no duplicate suggestion on this card');
    scope.duplicateCheck.dismissed = true;
    this.store.cards.update(id, { scope: JSON.stringify(scope) });
    this.changed();
  }

  /** Approval dissolves the back card, preserving a progressed survivor and creating only the extra work. */
  approveMerge(id: string): string {
    const row = this.own(id);
    const proposal = storedProposal(row);
    const merge = proposal?.merge;
    if (!proposal || !merge || merge.task === undefined) throw new BadRequest('merging', 'the merged card is not there yet');
    const p = this.item(id);
    const mergedTask = merge.task;
    const other = this.card(merge.with);
    if (!p || !other) throw new BadRequest('unknownCard', 'the card it was merged with is gone');
    if (!mergeableWith(withPart(p, 'idea', { proposal: { ...proposal, merge: undefined } }), withPart(other, 'idea', { mergingInto: undefined }))) throw new BadRequest('notMergeable', `“${other.title}” can no longer be merged with`);
    const keep = this.own(other.id);
    if (merge.compared && (merge.compared.left !== JSON.stringify([p.title, p.body, p.images, proposal.questions]) || merge.compared.right !== JSON.stringify([other.title, other.body]) || merge.compared.summary !== (this.summary(other.id) ?? '')))
      throw new BadRequest('mergeChanged', 'The cards changed since the comparison. Separate and compare them again.');
    if (mergeRank(other) > 1 && !merge.outcome) throw new BadRequest('mergeChanged', 'The survivor has progressed. Separate and compare them again.');
    this.store.transaction(() => {
      if (merge.outcome) {
        if (merge.followUp) {
          const f = merge.followUp;
          const next = this.create({ title: f.title, body: withQuestions(f.task, f.questions.map((n) => proposal.questions[n]!).filter(Boolean), [], this.t), from: other.id, repo: other.repo, images: f.images }, undefined, 'owner');
          // Even an archived survivor keeps its place; the new task is placed beside it.
          const at = this.nearFree(this.on(keep.canvas_id), { x: other.x + CARD_SIZE.task[0] + 40, y: other.y }, undefined, true);
          this.store.cards.update(next.id, at);
          this.setManualDependencies([...this.manualDependencies(), [other.id, next.id]]);
        }
      } else {
        const images = [...new Set([...(other.images ?? []), ...(p.images ?? [])])];
        const title = merge.title?.trim() || other.title;
        const kept = storedProposal(keep);
        const asked = new Set((kept?.questions ?? []).map((q) => q.text));
        const added = proposal.questions.filter((q) => !asked.has(q.text));
        const task = keep.state === 'proposal' ? mergedTask : withQuestions(mergedTask, proposal.questions, [], this.t);
        this.store.updateCard(other.id, {
          title,
          body: task.slice(0, 20000),
          images: images.length ? JSON.stringify(images) : null,
          // it takes the proposal's place, where that is on its canvas
          ...(row.canvas_id === keep.canvas_id ? { x: row.x, y: row.y } : {}),
          idea: keep.state === 'proposal' && kept ? { proposal: { ...kept, questions: [...kept.questions, ...added] } satisfies Proposal } : {},
        });
      }
      this.retargetMerge(id, other.id);
      const title = other.title;
      const { merge: _, ...rest } = proposal;
      this.store.updateCard(id, { deleted_at: new Date().toISOString(), idea: { proposal: { ...rest, superseded: { by: other.id, title, why: 'merged' } } satisfies Proposal } });
      this.log(other.id, 'state', 'koordinator', this.t.koordinator.mergedFrom(row.title ?? ''));
      if (!merge.outcome && keep.state === 'proposal') for (const q of proposal.questions) this.log(other.id, 'question', 'worker', formatQuestion(q, this.language()));
      this.changed();
    });
    return other.id;
  }

  /** Move the dissolving card's relationships, removing self arrows and duplicates. */
  private retargetMerge(id: string, survivor: string) {
    const to = (ids: string[], own: string) => [...new Set(ids.map((x) => x === id ? survivor : x))].filter((x) => x !== own);
    for (const r of this.store.cards.onProject(this.project.id)) {
      if (r.from_id === id && r.id !== survivor) this.store.cards.update(r.id, { from_id: survivor });
      const q = waitOf(r);
      if (r.id !== survivor && q?.behind.includes(id)) this.store.cards.update(r.id, { queue: JSON.stringify({ ...q, behind: to(q.behind, r.id), ...(q.buildsOn && { buildsOn: to(q.buildsOn, r.id) }), ...(q.manualWait && { manualWait: to(q.manualWait, r.id) }) }) });
    }
    const seen = new Set<string>();
    this.setManualDependencies(this.manualDependencies().flatMap(([a, b, anchor]) => {
      const from = a === id ? survivor : a, dest = b === id ? survivor : b;
      const key = `${from}:${dest}`;
      if (from === dest || seen.has(key)) return [];
      seen.add(key);
      return [anchor ? [from, dest, anchor] as [string, string, ManualAnchor?] : [from, dest] as [string, string]];
    }));
  }

  // ---------------------------------------------------------------- activity

  /**
   * Writes what happened on a card to the Activity log. `again` tells the latest line of the card
   * that is the same one (a wait read again), which is not written twice.
   */
  record(cardId: string, code: ActivityCode, who: ActivityWho, extra: { other?: string; harness?: string; title?: string; again?: Parameters<Store['activity']['add']>[1] } = {}) {
    this.store.activity.add({ cardId, code, who, ...(extra.other ? { otherId: extra.other } : {}), ...(extra.harness ? { harness: extra.harness } : {}), ...(extra.title !== undefined ? { title: extra.title } : {}) }, extra.again);
  }

  /** The newest `limit` + 1 lines of these projects' logs older than line `before`. */
  activityRows(projectIds: string[], before: number | undefined, limit: number): ActivityRow[] {
    return this.store.activity.page(projectIds, before, limit);
  }

  /** The Activity log's lines of these rows, as entries: each card as it is now, a deletion with the title the card had then. */
  activityEntries(rows: ActivityRow[], projectName: string): ActivityEntry[] {
    const cards = new Map(this.store.cards.byIds(rows.filter((r) => r.projectId === this.project.id).map((r) => r.cardId)).map((c) => [c.id, c]));
    // a workstream is only an item with its plan doc read, which the board's items have and a single row's lacks
    const live = new Map(this.items().map((i) => [i.id, i]));
    return rows.flatMap((r): ActivityEntry[] => {
      const row = cards.get(r.cardId);
      if (!row) return [];
      // a workstream whose plan went is shown as the archive has it; a deleted one is no item, and its lines are left out like those of a card that no longer exists
      const now: Item | undefined = live.get(row.id) ?? (!row.plan_ref ? this.itemOf(row) : row.deleted_at ? undefined : this.card(row.id));
      if (!now) return [];
      // deleted, restored, renamed and deleted again: each deletion names the card as it was then
      const card = r.title !== null ? { ...now, title: r.title } : now;
      return [
        {
          id: r.id,
          at: r.at,
          who: r.who,
          code: r.code,
          project: r.projectId,
          projectName,
          card,
          ...(row.deleted_at ? { deleted: true as const } : {}),
          ...(r.otherId ? { other: { id: r.otherId, title: r.otherTitle ?? '' } } : {}),
          ...(r.harness ? { harness: r.harness as Harness } : {}),
        },
      ];
    });
  }

  // ---------------------------------------------------------------- archive

  /** Takes finished cards, stopped tasks and parked or dropped ideas of the owner's off the project into its archive. */
  archive(ids: string[]) {
    for (const id of ids) {
      const row = this.own(id);
      if (row.plan_ref) throw new BadRequest('planCard', 'a workstream stays with its plan');
      if (row.state === 'idea') {
        if (this.idea(id).status === 'open') throw new BadRequest('notDone', 'an idea under discussion cannot be archived');
        if (this.items().some((i) => i.idea?.prototypeOf === id)) throw new BadRequest('prototypeRunning', 'a prototype for this idea is still running');
        continue;
      }
      // a stopped task goes with its conversation, for the owner to come back to; work its workstation holds would be left unseen
      if (row.state === 'planned' && row.branch && row.kind === 'task' && !row.idea?.prototypeOf) {
        if (row.queue) throw new BadRequest('notDone', 'the card waits to be started');
        if (row.workstation || row.kept_in) throw new BadRequest('holdsWork', 'its workstation holds work that has not landed');
        continue;
      }
      if (!row.state || !finished(row.state)) throw new BadRequest('notDone', 'only a finished or stopped card can be archived');
      if (row.landed && row.workstation) throw new BadRequest('notDone', 'its agent still finishes what remains after the landing');
    }
    const at = new Date().toISOString();
    // a stopped card snoozed to start later starts no more: brought back, it is the owner's to start
    this.store.transaction(() => ids.forEach((id) => this.store.updateCard(id, { archived_at: at, ...(this.snoozedOf(id)?.start ? { hold: null } : {}) })));
    for (const id of ids) this.record(id, 'archived', 'owner');
    this.changed();
  }

  /** Archives every finished card of the owner's on the project; returns their ids. */
  archiveDone(): string[] {
    const ids = this.snapshot()
      // a Question card is done when the owner says so, not with the finished work
      .items.filter((i) => i.source === 'manual' && i.kind !== 'question' && finished(i.state) && !i.agent?.finishing)
      .map((i) => i.id);
    if (ids.length) this.archive(ids);
    return ids;
  }

  /** Puts an archived card back where it was on the project; a plan comes back with its doc. */
  unarchive(id: string) {
    const row = this.own(id);
    if (row.plan_ref) throw new BadRequest('planCard', 'a plan comes back when its plan doc does');
    if (!row.archived_at) throw new BadRequest('notArchived', 'the card is not archived');
    // a new attempt is a new prototype
    if (row.idea?.prototypeOf) throw new BadRequest('prototypeEnded', 'a discarded or built prototype stays in the archive');
    this.store.cards.update(id, { archived_at: null });
    this.changed();
    this.backOnProject(id);
  }

  /**
   * The archive, the most recently archived first. A plan comes as its plan doc last stood,
   * followed by its workstreams (with `parent`), which the archive lists under it, not on their own.
   */
  archived(): Item[] {
    // the docs as they are now decide what is archived
    this.items();
    if (this.archiveItems) return this.archiveItems;
    this.archiveItems = this.archiveOf(this.store.cards.archived(this.project.id));
    return this.archiveItems;
  }

  /** The archive's items for these of its cards, each plan followed by its workstreams. */
  private archiveOf(rows: CardRow[]): Item[] {
    const plans = rows.filter((r) => r.plan_ref);
    const docs = plans.map((r) => r.plan!.doc!);
    const kids = this.store.cards.children(plans.map((r) => r.id));
    const items = this.withRate(this.withPrototypes(toItems([...rows, ...kids], docs, this.home, this.worked, this.themeNow)), true);
    const byId = new Map(items.map((i) => [i.id, i]));
    const kidsOf = Map.groupBy(items.filter((i) => i.parent), (i) => i.parent!);
    return rows.flatMap((r) => {
      const at = { archivedAt: r.archived_at! };
      const own = byId.get(r.id);
      const repoDown = own && !this.project.repos.some((r) => r.id === own.repo);
      return own ? [{ ...own, ...at, ...(repoDown ? { repoDown: true } : {}) }, ...(kidsOf.get(r.id) ?? []).map((i) => ({ ...i, ...at }))] : [];
    });
  }

  /** Any card of the project as the UI sees it: on the project, or in the archive. */
  card(id: string): Item | undefined {
    this.own(id);
    const item = this.item(id);
    if (item || this.archiveItems) return item ?? this.archiveItems!.find((i) => i.id === id);
    // as the project has just read the docs: a plan whose doc went is archived by that
    const row = this.own(id);
    // one card of the archive (a workstream with its plan), without building all of it: sharing pages again asks for one after another
    const parent = row.parent_id ? this.store.cards.get(row.parent_id) : null;
    const archived = row.archived_at ? row : parent?.archived_at && !parent.deleted_at && parent.project_id === this.project.id ? parent : null;
    return archived ? this.archiveOf([archived]).find((i) => i.id === id) : undefined;
  }

  /** What a plan's sheet shows besides the doc: its decisions and those of the idea or task it came from. */
  planHistory(id: string): PlanHistory {
    const row = this.own(id);
    if (row.kind !== 'plan') throw new BadRequest('invalid', 'not a plan');
    const own = this.store.decisions.of(this.project.id, id, 500);
    const origin = row.from_id ? this.store.cards.get(row.from_id) : null;
    const fromOrigin = origin && !origin.deleted_at ? this.store.decisions.ofCard(this.project.id, origin.id) : [];
    const decisions = [...fromOrigin, ...own].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id).map(toDecision);
    // what its plan agent answered: about the plan or one of its workstreams
    const talk = this.store.talk.about(this.project.id, [id, ...this.store.cards.children([id]).map((c) => c.id)]);
    return { decisions, origin: origin && !origin.deleted_at ? (this.card(origin.id) ?? null) : null, talk };
  }

  /** The plan docs (plan references) that a card's landed work added; the card becomes their origin. */
  planDocsLanded(cardId: string, refs: string[]) {
    const row = this.own(cardId);
    // only a card that was an idea, or a task the owner planned as a plan, is a plan's origin
    if ((!row.idea?.discussion && !row.idea?.becomesPlan) || !refs.length) return;
    this.store.updateCard(cardId, { plan: { planDocs: refs } });
    this.changed();
  }

  /**
   * Why the card holding the workstation at `path` will not work in it again, where it will not: the
   * card does not name it as its workstation, or its work is over and its worker done (`stale`: the
   * lease outlived what it was for); it was deleted; or it is a workstream no worker is on whose box
   * the plan doc on the default branch ticks off (`ticked`; `merged` while it is in its pull request,
   * which the doc says has been merged), or that the doc there no longer has (`gone`). A box ticked
   * in a plan folder outside the repository says nothing of a landing (`tickedAhead`).
   */
  leaseEnded(cardId: string, path: string): 'stale' | 'deleted' | 'ticked' | 'merged' | 'gone' | null {
    const row = this.store.cards.get(cardId);
    if (!row) return 'stale';
    if (row.project_id !== this.project.id) return null;
    // a deleted card keeps its workstation named, to take it back when it is restored
    if (row.workstation !== path) return 'stale';
    if (row.landed) return null;
    if (row.deleted_at) return 'deleted';
    // what remained after the landing is done: the worker that did it gave the workstation up
    if (row.state && finished(row.state)) return 'stale';
    const hash = row.plan_ref?.indexOf('#') ?? -1;
    if (hash < 0 || row.state === 'working' || row.state === 'waiting' || row.state === 'approved') return null;
    if (row.state === 'inPr' && !row.review?.pr) return null;
    if (row.state === 'inPr' && tickedAhead(row)) return null;
    // the docs are read the way the project reads them, which plans again a workstream only a part of which landed
    this.items();
    const doc = this.docs?.find((d) => d.file === row.plan_ref!.slice(0, hash));
    const w = doc?.workstreams.find((x) => x.key === row.plan_ref!.slice(hash + 1));
    // an open pull request goes on without the doc: its watcher sees it merged or closed; a repository
    // not (yet) on the project has no docs read
    if (!w) return row.state === 'inPr' || !this.project.repos.some((r) => r.id === repoOfRef(row.plan_ref!, this.home)) ? null : 'gone';
    if (!w.done || tickedAhead(row)) return null;
    return row.state === 'inPr' ? 'merged' : 'ticked';
  }

  /** The workstation at `path` was freed (`leaseEnded`); a deleted card keeps it named, to take it back when it is restored. */
  freed(cardId: string, path: string) {
    const row = this.store.cards.get(cardId);
    // the pool the project shows has a clone more
    if (!row || row.deleted_at || row.workstation !== path) return this.changed();
    this.work(cardId, { workstation: null, app: null, parked: null });
  }

  /**
   * The card's workstation at `path` left the pool, its folder gone: the card names none any more, one
   * at work is planned again, and its next start takes another workstation.
   */
  workstationGone(cardId: string, path: string) {
    const row = this.store.cards.get(cardId);
    if (!row || row.workstation !== path) return this.changed();
    const working = row.state === 'working';
    this.work(cardId, { workstation: null, app: null, parked: null, ...(working ? { state: 'planned', ...this.unheld(cardId, AGENT_HOLDS) } : {}) });
    if (!row.deleted_at) this.log(cardId, 'state', 'obeya', this.t.worker.workstationGone(path, working));
  }

  /** A card's landed work is done, its worker gone: a card whose plan doc is a plan now gives way to it. */
  workDone(cardId: string) {
    // a workstream its doc keeps open is planned again (reopen) once its worker is done
    if (this.own(cardId).plan_ref) this.docs = null;
    if (this.retire(cardId) || this.archiveLanded(cardId) || !this.docs) this.changed();
  }

  /**
   * Where the project archives cards once their work landed, the owner's finished card goes into the
   * archive as soon as its worker is done after the landing, as "Archive all finished" would take it.
   */
  private archiveLanded(cardId: string): boolean {
    if (this.archiving() !== 'landed') return false;
    const r = this.store.cards.get(cardId);
    if (!r || r.deleted_at || r.archived_at || r.plan_ref || r.kind !== 'task' || r.idea?.prototypeOf || !r.state || !finished(r.state) || r.workstation) return false;
    this.store.cards.update(cardId, { archived_at: new Date().toISOString() });
    this.log(cardId, 'state', 'obeya', this.t.archivedLanded);
    return true;
  }

  /** The project as the UI sees it; built once per change (every write here ends in `changed`). */
  snapshot(): ProjectSnapshot {
    const items = this.items();
    if (this.cache) return this.cache;
    const chat = this.store.chats.current(this.project.id);
    const talk = this.store.talk.sheet(this.project.id, chat, SHEET_TALK);
    const reshare = this.reshare();
    const pools = this.clonePools();
    const planDirs = this.planDirs(this.docs!);
    const settingProposals = this.settingProposals()
      .filter((p) => p.state === 'proposed')
      .map(({ state: _, ...p }) => {
        const now = this.settingsNow?.(p.repo)?.[p.field];
        return now === undefined ? p : { ...p, now };
      });
    this.cache = {
      project: this.project,
      canvases: this.canvases(),
      items,
      groups: this.store.groups.of(this.project.id).map(toGroup),
      preferences: this.store.preferences.of(this.project.id, ['proposed', 'active']),
      ...(settingProposals.length ? { settingProposals } : {}),
      talk: this.limits.size || this.atWork.size ? talk.map((x) => ({ ...x, ...this.limited(`talk:${x.id}`), ...this.agentAt('lookUpAgent', `talk:${x.id}`) })) : talk,
      chat,
      ...(this.store.chats.model(this.project.id) ? { chatModel: this.store.chats.model(this.project.id) } : {}),
      chats: this.store.chats.list(this.project.id),
      ...(pools.length ? { workstations: pools } : {}),
      ...(reshare ? { reshare } : {}),
      ...(planDirs.length ? { planDirs } : {}),
      ...this.agentAt('koordinatorAgent', 'koordinator'),
    };
    return this.cache;
  }

  /**
   * The project's cards as the UI sees them (the snapshot's `items`), built once per change without
   * the rest of the snapshot: code that changes cards reads them back between its writes.
   */
  items(): Item[] {
    // docs read before a repository joined the project lack its docs, which would count its workstreams gone
    const repos = this.project.repos.map((r) => r.id).join('\n');
    if (this.docs && this.docsOf !== repos) {
      this.docs = null;
      this.cache = null;
      this.itemsCache = null;
      this.archiveItems = null;
      this.prototypeItems = null;
    }
    if (this.itemsCache) return this.itemsCache;
    const read = !this.docs;
    if (!this.docs) {
      this.docs = this.read();
      this.docsOf = repos;
    }
    const all = this.docs;
    this.follow(all, read);
    let rows = this.store.cards.onProject(this.project.id);
    const docs = this.openDocs(all, rows);
    const open = docs.map((d) => d.file).join('\n');
    if (read || open !== this.open) {
      this.open = open;
      this.keepDocs(all, docs);
      if (read) this.reopen(all);
      // keeping and reopening docs archives and brings back their cards
      rows = this.store.cards.onProject(this.project.id);
    }
    let items = toItems(rows, docs, this.home, this.worked, this.themeNow);
    if (this.placeNew(docs, items, all, rows)) {
      // plans seen for the first time keep their doc too
      this.keepDocs(all, docs);
      // what reacts to changes hears of them too (the Koordinator reads what builds on what in a plan just come)
      this.tell();
      rows = this.store.cards.onProject(this.project.id);
      items = toItems(rows, docs, this.home, this.worked, this.themeNow);
    }
    if (read) {
      // Older plans packed finished cards more tightly. Refit only plans whose finished
      // cards no longer fit, preserving the owner's layout wherever there is still room.
      for (const plan of items.filter((i) => i.kind === 'plan')) {
        const kids = items.filter((i) => i.parent === plan.id);
        const overlaps = kids.some((chip) => {
          if (shapeOf(chip) !== 'chip') return false;
          const a = boundsOf(chip, kids);
          return kids.some((other) => {
            if (other.id === chip.id) return false;
            const b = boundsOf(other, kids);
            return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          });
        });
        if (!overlaps) continue;
        const at = arrangeWorkstreams(kids);
        for (const kid of kids) {
          Object.assign(kid, at.get(kid.id)!);
          this.store.cards.update(kid.id, { x: kid.x, y: kid.y });
        }
        const others = items.filter((i) => !i.parent && i.id !== plan.id).map((i) => boundsOf(i, items));
        const place = freeSpotNear(plan, sizeOf(plan, items), others);
        this.store.cards.update(plan.id, place);
        Object.assign(plan, place);
      }
    }
    const manual = this.manualDependencies();
    if (manual.length) {
      const sources = new Set(manual.map(([from]) => from));
      const archivedRows = this.store.cards.archived(this.project.id).filter((r) => sources.has(r.id) && r.state && !finished(r.state));
      const archivedAt = new Map(archivedRows.map((r) => [r.id, r.archived_at!]));
      const archived = toItems(archivedRows, [], this.home, this.worked, this.themeNow).filter(connectable).map((i) => ({ ...i, archivedAt: archivedAt.get(i.id)! }));
      const eligible = new Set([...items.filter(connectable), ...archived].map((i) => i.id));
      items = items.map((i) => {
        const edges = eligible.has(i.id) ? manual.filter(([from, to]) => to === i.id && eligible.has(from)) : [];
        const anchors = Object.fromEntries(edges.flatMap(([from, , anchor]) => (anchor ? [[from, anchor]] : [])));
        const manualArchived = archived.filter((a) => edges.some(([from]) => from === a.id));
        return edges.length ? withPart(i, 'plan', { manualDependsOn: edges.map(([from]) => from), ...(manualArchived.length ? { manualArchived } : {}), ...(Object.keys(anchors).length ? { manualAnchors: anchors } : {}) }) : i;
      });
    }
    items = this.withPrototypes(items);
    items = this.withElsewhere(items, rows);
    const inTurn = new Map([...this.turns].flatMap((f) => [...f()]));
    if (inTurn.size) items = items.map((i) => {
      const turn = inTurn.get(i.id);
      if (!turn) return i;
      // a card that waits for the owner is not at work anyway: the restart holds nobody up there
      if (turn.restartPaused) return needsYou(i) || i.hold ? i : { ...i, hold: { reason: 'restart' } };
      const background = turn.tasks.length ? { background: turn.tasks } : {};
      // a turn that ended while its background work runs (the app served, say) holds the worker's slot,
      // but a card that waits for the owner then has nobody at work on it: only that work runs
      return withPart(i, 'agent', turn.over && needsYou(i) ? background : { inTurn: true, ...(turn.doing ? { doing: turn.doing } : {}), ...background });
    });
    // a worker the usage limit paused resumes at the known reset
    items = items.map((i) => (i.hold?.reason === 'limit' && i.hold.until ? withPart(i, 'agent', { limitedUntil: i.hold.until }) : i));
    items = this.withoutStaleSnoozes(items, rows);
    items = this.withWaitingSince(items);
    items = this.withRate(items);
    // a card whose repository does not run on the project waits for it
    const running = new Set(this.project.repos.map((r) => r.id));
    if (items.some((i) => !running.has(i.repo))) items = items.map((i) => (running.has(i.repo) || i.kind === 'question' ? i : { ...i, repoDown: true }));
    if (this.limits.size) items = items.map((i) => this.limitedCard(i));
    if (this.atWork.size) items = items.map((i) => withPart(i, 'agent', this.agentAt('identity', `card:${i.id}`)));
    if (this.landingPositions.size) items = items.map((i) => this.landingPositions.has(i.id) && i.review?.landing ? withPart(i, 'review', { landingPosition: this.landingPositions.get(i.id)! }) : i);
    this.itemsCache = items;
    return items;
  }

  /**
   * Approved work an agent did takes the owner's feedback while Seismic asks for it: each such card
   * names its latest handover and the answer on it so far. A contributor's pull request and a
   * prototype are not an agent's work to judge here.
   */
  private withRate(items: Item[], archived = false): Item[] {
    if (!this.asksFeedback()) return items;
    // archived by hand, a card asks when it goes into the archive; a workstream, which goes with its plan, after its approval
    const asks = (i: Item) => archived || this.archiving() === 'landed' || i.source === 'plan';
    const rateable = (i: Item) => i.kind === 'task' && APPROVED.includes(i.state) && !i.review?.contribution && !i.idea?.prototypeOf && asks(i);
    const rated = this.store.feedback.rated(items.filter(rateable).map((i) => i.id));
    if (!rated.size) return items;
    return items.map((i) => {
      const rate = rateable(i) && rated.get(i.id);
      return rate ? withPart(i, 'review', { rate }) : i;
    });
  }

  /** Until when the usage limit holds back what goes by this key (`card:<id>`, `talk:<id>`). */
  private limited(key: string): { limitedUntil?: string; limitPaused?: true } {
    const until = this.limits.get(key);
    return until === null ? { limitPaused: true } : until ? { limitedUntil: until } : {};
  }

  /** The card with until when the usage limit holds back its agent, or held by it. */
  private limitedCard(i: Item): Item {
    const { limitedUntil, limitPaused } = this.limited(`card:${i.id}`);
    return limitPaused ? (i.hold ? i : { ...i, hold: { reason: 'limit' } }) : limitedUntil ? withPart(i, 'agent', { limitedUntil }) : i;
  }

  /** Cards that come from a card on another project name it, with that project. */
  private withElsewhere(items: Item[], rows: CardRow[]): Item[] {
    // a card on this project is not looked up: the others are, all at once
    const here = new Set(rows.map((r) => r.id));
    const ids = [...new Set(items.flatMap((i) => (i.from && !here.has(i.from) ? [i.from] : [])))];
    const elsewhere = new Map(this.store.cards.elsewhere(ids, this.project.id).map((o) => [o.id, o]));
    if (!elsewhere.size) return items;
    return items.map((i) => {
      const from = i.from ? elsewhere.get(i.from) : undefined;
      return from ? { ...i, fromElsewhere: { project: from.project, projectName: from.projectName ?? from.project, title: from.title ?? '' } } : i;
    });
  }

  /**
   * A card the owner snoozed while it waited for them that no longer waits for them (they answered
   * it after all, its proposal is reworked, its idea parked) is snoozed no longer; nor is a planned
   * card snoozed to start later that is no longer planned to start (started, made an idea, archived),
   * or no longer on the project (a workstream whose plan doc went or was ticked off): coming back after
   * its time, it would start unasked.
   */
  private withoutStaleSnoozes(items: Item[], rows: CardRow[]): Item[] {
    const shown = new Set(items.map((i) => i.id));
    for (const r of rows) if (r.hold && !shown.has(r.id) && snoozeOf({ hold: r.hold })?.start) this.store.updateCard(r.id, { hold: null });
    return items.map((i) => {
      const s = snoozeOf(i);
      if (!s?.waiting && !s?.start) return i;
      const { hold: _, ...awake } = i;
      if (s.waiting ? needsYou(awake) : plannedToStart(awake)) return i;
      const row = rows.find((r) => r.id === i.id);
      const left = row?.hold ? awakeHold(row.hold) : null;
      this.store.updateCard(i.id, { hold: left });
      return left ? { ...awake, hold: itemHold(left) } : awake;
    });
  }

  /** Why the card's agent does not run or the card is off the canvas, as stored; null when nothing holds it. */
  holdOf(cardId: string): Hold | null {
    return this.own(cardId).hold;
  }

  /** The field that lets go of the card's hold if it is one of `reasons`; nothing when it is not. */
  unheld(cardId: string, reasons: readonly HoldReason[]): { hold?: null } {
    const h = this.holdOf(cardId);
    return h && reasons.includes(h.reason) ? { hold: null } : {};
  }

  /** The card's snooze, or null when it is not snoozed. */
  snoozedOf(cardId: string): Extract<Hold, { reason: 'snoozed' }> | null {
    const h = this.holdOf(cardId);
    return h?.reason === 'snoozed' ? h : null;
  }

  /**
   * Snoozes the card until `until` (ISO) or the card it waits on, as `s` says, with the line in its
   * conversation by whoever snoozed it (or changed the time). The snooze takes the place of what held
   * the card before, and keeps what that held for the worker (`held`): a new time for a snooze, or a
   * paused worker's card the owner snoozes while it waits for them, which is paused again once it wakes.
   */
  snooze(cardId: string, s: Snooze & { held?: HeldMessage[] }, by: 'agent' | 'owner' = s.by) {
    const before = this.holdOf(cardId);
    const held = s.held ?? (before?.reason === 'snoozed' ? before.held : before?.reason === 'paused' || before?.reason === 'limit' ? (before.held ?? []) : undefined);
    const hold: Hold = { ...s, reason: 'snoozed', since: before?.reason === 'snoozed' ? before.since : new Date().toISOString(), ...(held ? { held } : {}) };
    this.work(cardId, { hold });
    this.log(cardId, 'state', by === 'agent' ? 'worker' : 'owner', this.t.worker.snoozed(snoozeTerm(this.t, s), s.why));
  }

  /**
   * The card is snoozed no longer, with the line that it woke and why (`woke`): its time came, the
   * owner woke it, Seismic had something for its agent, the card needs the owner, or what became of the
   * card it waited on. Returns the snooze it had.
   */
  unsnooze(cardId: string, woke: Woke): Snooze | null {
    const s = this.snoozedOf(cardId);
    if (!s) return null;
    this.work(cardId, { hold: awakeHold(s) });
    const why = this.t.worker.wokeWhy;
    this.log(cardId, 'state', woke === 'owner' ? 'owner' : 'obeya', this.t.worker.woke(typeof woke === 'object' ? (s.on ? why.card(s.on.title, woke.met, s.on.state) : why.time) : why[woke]));
    return s;
  }

  /**
   * Each card that waits for the owner with since when: noted when it starts to wait, kept in the
   * database across restarts while it waits, and forgotten once it no longer does.
   */
  private withWaitingSince(items: Item[]): Item[] {
    const known = this.store.cards.waitingSince(this.project.id);
    const at = new Date().toISOString();
    const out = items.map((i) => {
      if (!needsYou(i)) return i;
      let since = known.get(i.id);
      if (!since) this.store.cards.setWaitingSince(i.id, (since = at));
      return { ...i, waitingSince: since };
    });
    const waiting = new Set(out.flatMap((i) => (i.waitingSince ? [i.id] : [])));
    for (const id of known.keys()) if (!waiting.has(id)) this.store.cards.setWaitingSince(id, null);
    return out;
  }

  private read(): PlanDoc[] {
    const { docs, dirs } = this.readDocs();
    this.dirs = dirs;
    return docs;
  }

  /**
   * The docs whose plans stand on the project: those with a workstream still open, and those
   * whose every workstream is ticked, or whose doc is gone (as it last stood), while one of their
   * cards is still at work (in progress, or its worker finishing after the landing). The others'
   * plans have ended.
   */
  private openDocs(all: PlanDoc[], rows: CardRow[]): PlanDoc[] {
    const busy = new Set(
      rows
        .filter((r) => r.plan_ref?.includes('#') && ((r.state && ACTIVE.includes(r.state)) || (r.landed && r.workstation) || tickedAhead(r)))
        .map((r) => r.plan_ref!.slice(0, r.plan_ref!.indexOf('#'))),
    );
    const files = new Set(all.map((d) => d.file));
    const gone = this.store.cards
      .plans(this.project.id)
      .filter((r) => r.plan?.doc && busy.has(r.plan_ref!) && !files.has(r.plan_ref!))
      .map((r) => r.plan!.doc!);
    return [...all.filter((d) => !allTicked(d) || busy.has(d.file)), ...gone];
  }

  /**
   * The notes on the plan directories: one for each that holds docs which are not plans, and
   * one for a repository with no plan doc that never had a plan, saying where the first goes.
   */
  private planDirs(docs: PlanDoc[], rows = this.store.cards.onProject(this.project.id)): PlanDir[] {
    const plans = this.store.cards.plans(this.project.id);
    const preparing = rows.filter((r) => !r.plan_ref && r.title && !finished(r.state ?? 'planned'));
    return this.dirs.flatMap(({ repo, dir, others }) => {
      const empty = !others.length && !docs.some((d) => repoOfRef(d.file, this.home) === repo) && !plans.some((p) => repoOfRef(p.plan_ref!, this.home) === repo);
      if (!empty && !others.length) return [];
      return [
        {
          repo,
          dir,
          empty,
          others: others.map((o) => {
            const titles = Object.values(MESSAGES).map((m) => m.preparePlanDoc.title(o.file));
            const card = preparing.find((r) => (r.repo ?? this.home) === repo && titles.includes(r.title!));
            return { ...o, ...(card ? { preparing: card.id } : {}) };
          }),
          ...this.planDirNoteAt(repo),
        },
      ];
    });
  }

  private planDirNoteAt(repo: string): { at?: { x: number; y: number } } {
    const at = this.store.settings.get(this.project.id, `plan_dir_note:${repo}`);
    return at ? { at: JSON.parse(at) as { x: number; y: number } } : {};
  }

  /** The owner moved the note on a repository's plan directory: it stays there, wherever the plans go. */
  movePlanDirNote(repo: string, at: unknown) {
    const { x, y } = (at ?? {}) as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) throw new BadRequest('invalid', 'a place needs x and y');
    if (!this.dirs.some((d) => d.repo === repo)) throw new BadRequest('invalid', 'no plan directory of that repository on the project');
    this.store.settings.set(this.project.id, `plan_dir_note:${repo}`, JSON.stringify({ x: Math.round(x), y: Math.round(y) }));
    this.changed();
  }

  /**
   * When the agents that wait for the account's usage limit go on by themselves (ISO time), by
   * `card:<id>` and `talk:<id>`. Held in memory: after a restart they run into the limit again.
   */
  private limits = new Map<string, string | null>();

  /** The places whose usage limit cleared since Seismic started: a limit there again is a stop of its own, logged even right after the last one. */
  private limitsCleared = new Set<string>();

  /** The harness a card's agent setting names, when it names one. */
  private agentSettingHarness(cardId: string): Harness | undefined {
    const s = this.store.cards.get(cardId)?.agent_setting;
    return s ? ((JSON.parse(s) as { harness?: Harness }).harness ?? 'claude') : undefined;
  }
  private limitRetries = new Map<string, () => void>();

  retryLimit(card: string): boolean {
    const retry = this.limitRetries.get(`card:${card}`);
    if (!retry) return false;
    retry();
    return true;
  }

  /**
   * The agent of a card (other than its worker), or the one looking up the question of an exchange
   * in the sheet, waits for the usage limit until `until`; nothing once it goes on.
   */
  waitsForLimit(at: { card: string } | { talk: number }, until: number | null | undefined, retry?: () => void) {
    const key = 'card' in at ? `card:${at.card}` : `talk:${at.talk}`;
    if (retry) this.limitRetries.set(key, retry);
    else this.limitRetries.delete(key);
    const iso = until === undefined ? undefined : until === null ? null : new Date(until).toISOString();
    if (this.limits.get(key) === iso) return;
    // a limit read again while it holds is the same stop; one read again after a restart is told by the log's latest line
    if (iso !== undefined && 'card' in at && !this.limits.has(key)) {
      const harness = this.atWork.get(key)?.agent.harness ?? this.agentSettingHarness(at.card);
      const again = this.limitsCleared.has(key) ? undefined : (l: { code: ActivityCode; harness: string | null }) => l.code === 'usageLimit' && l.harness === (harness ?? null);
      this.record(at.card, 'usageLimit', 'obeya', { ...(harness ? { harness } : {}), ...(again ? { again } : {}) });
    }
    if (iso !== undefined) {
      this.limits.set(key, iso);
      this.limitsCleared.delete(key);
    } else if (this.limits.delete(key)) this.limitsCleared.add(key);
    this.changed();
  }

  /**
   * The harness and model of the session that runs at each place an agent shows at work (`AgentAt`),
   * by `card:<id>`, `talk:<id>` and `koordinator`, with the session they belong to. Held in memory:
   * a session lives no longer than Seismic.
   */
  private atWork = new Map<string, { agent: AgentIdentity; session: object }>();

  /** The session's identity where it shows at work (`withAgentSetting`); none once it ended, unless another session took that place since. */
  showAtWork(at: AgentAt, agent: AgentIdentity | undefined, session: object) {
    const key = 'card' in at ? `card:${at.card}` : 'talk' in at ? `talk:${at.talk}` : 'koordinator';
    const was = this.atWork.get(key);
    if (agent) {
      if (was?.session === session && was.agent.harness === agent.harness && was.agent.model === agent.model) return;
      this.atWork.set(key, { agent, session });
    } else {
      if (was?.session !== session) return;
      this.atWork.delete(key);
    }
    this.changed();
  }

  private agentAt<K extends string>(field: K, key: string): { [k in K]?: AgentIdentity } {
    const at = this.atWork.get(key);
    return (at ? { [field]: { ...at.agent } } : {}) as { [k in K]?: AgentIdentity };
  }

  private landingPositions = new Map<string, number>();

  /** The repository's landing queue is transient: a restart cancels outstanding approvals. */
  showLandingPosition(cardId: string, position: number | undefined) {
    if (position === this.landingPositions.get(cardId)) return;
    if (position === undefined) this.landingPositions.delete(cardId);
    else this.landingPositions.set(cardId, position);
    this.changed();
  }

  /** Who says which cards' workers are in a turn, each with its background work: one per repository's workers (`showTurns`). */
  private turns = new Set<() => Map<string, WorkerTurn>>();

  /** Who says which cards' workers are in a turn; a worker's turn starts and ends with `changed`, and so does its background work, so the cache holds. */
  showTurns(turns: () => Map<string, WorkerTurn>) {
    this.turns.add(turns);
  }

  /** The repositories' clone pools by machine, as those who run them say (`showPools`). */
  private pools?: () => ClonePool[];

  /**
   * Who says what the clone pools are. Leases change only along with a card (start, stop,
   * landing, a discarded prototype) and a worker's turn starts and ends with `changed`, so the cache holds.
   */
  showPools(pools: () => ClonePool[]) {
    this.pools = pools;
    this.changed();
  }

  /** The repositories' settings a setting proposal shows beside its value, as they apply now (`showSettings`). */
  private settingsNow?: (repo: string) => Record<ProposedSetting, string | string[]> | undefined;

  /** Who says how the repositories' settings stand; saving them reads the plan docs again (`docsChanged`), so the cache holds. */
  showSettings(now: (repo: string) => Record<ProposedSetting, string | string[]> | undefined) {
    this.settingsNow = now;
    this.changed();
  }

  /** The pools, each workstation a card holds with the card's title, also of a card not on the project, and the project of one on another. */
  private clonePools(): ClonePool[] {
    return (this.pools?.() ?? []).map((p) => ({
      ...p,
      hosts: p.hosts.map((h) => ({
        ...h,
        workstations: h.workstations.map((w) => {
          const row = w.card ? this.store.cards.get(w.card) : null;
          if (!row) return w;
          return { ...w, ...(row.title ? { title: row.title } : {}), ...(row.project_id !== this.project.id ? { project: row.project_id } : {}) };
        }),
      })),
    }));
  }

  /** The outdated pages, archived cards' included, and the run sharing them again. */
  private reshare(): Reshare | null {
    const rows = this.sharedRows();
    const run = this.reshareRun();
    const queued = new Set(run?.queue);
    const left = this.outdatedRows(rows).filter(({ r }) => !queued.has(r.id));
    const untagged = this.untaggedRows(rows).filter((r) => !queued.has(r.id)).length;
    if (!left.length && !untagged && !run) return null;
    // what sharing them again brings, and to how many of them
    const changes = ([...PAGE_CHANGES.map((c) => c.id), THEME_CHANGED] as OutdatedBy[]).flatMap((id) => {
      const pages = left.filter(({ missed }) => missed.includes(id)).length;
      return pages ? [{ id, pages }] : [];
    });
    const title = (id: string) => rows.find((r) => r.id === id)?.title ?? '';
    const first = run?.queue[0] ? rows.find((r) => r.id === run.queue[0]) : undefined;
    const current = first?.demo?.share?.state === 'publishing' ? first.title : undefined;
    return {
      outdated: left.length,
      ...(untagged ? { untagged } : {}),
      ...(changes.length ? { changes } : {}),
      ...(run
        ? {
            run: {
              total: run.total,
              done: run.done,
              failed: run.failed.map((id) => ({ id, title: title(id) })),
              left: run.queue.length,
              ...(current ? { current } : {}),
              ...(run.stopped ? { stopped: true } : {}),
              ...(run.tags ? { tags: true } : {}),
            },
          }
        : {}),
    };
  }

  /**
   * Ideas, and cards that were ideas, with their prototypes, wherever these are: on the project or in
   * the archive; a workstream built on a prototype with that one. A prototype knows its idea's
   * title, also once the idea is in the archive.
   */
  private withPrototypes(items: Item[]): Item[] {
    const p = this.prototypes();
    if (!p.rows.length) return items;
    // a prototype among these items is not read again
    const given = new Map(items.flatMap((i) => (i.idea?.prototypeOf ? [[i.id, i]] : [])));
    return items.map((i) => {
      const ofIdea = p.ofIdea.get(i.id) ?? [];
      const built = i.parent && i.idea?.builtOn ? p.byId.get(i.idea.builtOn) : undefined;
      const rows = built && !ofIdea.includes(built) ? p.rows.filter((r) => r.prototype_of === i.id || r === built) : ofIdea;
      const me = i.idea?.prototypeOf ? withPart(i, 'idea', { ideaTitle: this.ideaTitle(p, i.idea.prototypeOf) }) : i;
      return rows.length ? withPart(me, 'idea', { prototypes: rows.flatMap((r) => this.prototypeItem(p, r, given.get(r.id)) ?? []) }) : me;
    });
  }

  /**
   * Which cards of the project are prototypes, read once per change; each is made into an item when a
   * card first needs it, once per change too: the project, the archive and every archived card looked
   * up on its own (sharing looks up hundreds in a row) need them.
   */
  private prototypes(): Prototypes {
    if (this.prototypeItems) return this.prototypeItems;
    const rows = this.store.ideas.prototypes(this.project.id);
    this.prototypeItems = { rows, ofIdea: Map.groupBy(rows, (r) => r.prototype_of), byId: new Map(rows.map((r) => [r.id, r])), items: new Map(), titles: new Map() };
    return this.prototypeItems;
  }

  private prototypeItem(p: Prototypes, ref: PrototypeRef, given?: Item): Item | undefined {
    const made = p.items.get(ref.id);
    if (made) return made;
    const row = given ? null : this.store.cards.get(ref.id);
    const item = given ?? (row && toItems([row], [], this.home, undefined, this.themeNow)[0]);
    if (!item) return undefined;
    const prototype = withPart({ ...item, ...(ref.archived_at ? { archivedAt: ref.archived_at } : {}) }, 'idea', { ideaTitle: this.ideaTitle(p, ref.prototype_of) });
    p.items.set(ref.id, prototype);
    return prototype;
  }

  private ideaTitle(p: Prototypes, ideaId: string): string {
    const title = p.titles.get(ideaId) ?? this.store.cards.get(ideaId)?.title ?? '';
    p.titles.set(ideaId, title);
    return title;
  }

  /** The plan an idea became, while it is on the project. */
  planOf(ideaId: string): Item | undefined {
    return this.items().find((i) => i.kind === 'plan' && i.plan?.origin === ideaId);
  }

  // ---------------------------------------------------------------- preferences

  /** The project's preferences in the given states, or all of them (rejected proposals too). */
  preferences(...states: PreferenceState[]) {
    return this.store.preferences.of(this.project.id, states.length ? states : undefined);
  }

  /** The owner's active preferences as agents read them; empty when there are none. */
  preferencesText(): string {
    const p = this.preferences('active');
    return p.length ? `The owner's standing preferences (follow them unless the card says otherwise). A preference about the language you speak to the owner takes precedence over the task's language and their latest words. If it says "only" or "always", a card's language cannot override it:\n${p.map((x) => `- ${x.text}`).join('\n')}` : '';
  }

  /** A rule the owner writes: active at once. */
  addPreference(text: string, cardId: string | null = null): number {
    const clean = checkPreference(text);
    const id = this.store.preferences.add(this.project.id, clean, cardId);
    this.changed();
    return id;
  }

  /**
   * A learned rule, or a learned change to the active rule `replaces`: it waits for the owner. With a
   * `target` it is about that repository and belongs in its CLAUDE.md.
   */
  proposePreference(text: string, occasion: { cardId?: string; quote?: string; review?: boolean }, replaces?: number, target?: string): number {
    const clean = checkPreference(text);
    if (target !== undefined) this.checkRepo(target);
    const id = this.store.preferences.add(this.project.id, clean, occasion.cardId ?? null, {
      quote: occasion.quote?.trim().slice(0, 2000) || undefined,
      review: occasion.review,
      replaces,
      target,
    });
    this.changed();
    return id;
  }

  setPreference(id: number, text: string | null) {
    if (!this.store.preferences.set(this.project.id, id, text === null ? null : checkPreference(text)))
      throw new BadRequest('unknownPreference', 'unknown preference');
    this.changed();
  }

  /**
   * The owner accepts a proposal, as it is or in their own words; a change takes the place of the
   * rule it changes. `target` sets where it goes when the owner changed that: a repository, or
   * `null` for the preference memory. A rule for a repository goes into its card "Add to CLAUDE.md",
   * which a worker writes it from into the CLAUDE.md; until then it applies to no agent.
   */
  acceptProposal(id: number, text?: string, target?: string | null) {
    const p = this.preferences('proposed').find((x) => x.id === id);
    if (!p) throw new BadRequest('unknownPreference', 'no such proposal');
    const clean = text === undefined ? p.text : checkPreference(text);
    if (target) this.checkRepo(target);
    const repo = target === undefined ? p.target : (target ?? undefined);
    this.store.transaction(() => {
      if (clean !== p.text) this.store.preferences.set(this.project.id, id, clean);
      if (p.replaces !== undefined && this.preferences('active').some((x) => x.id === p.replaces)) this.store.preferences.set(this.project.id, p.replaces, null);
      this.store.preferences.decide(this.project.id, id, 'active', repo ?? null);
      if (repo) this.collect(repo, clean);
    });
    this.changed();
  }

  /**
   * A rule the owner gives outright for the CLAUDE.md of each of `repos`, said ("Remember: …") or
   * written in the sheet: it goes into the repository's card "Add to CLAUDE.md" at once, without
   * a proposal. `replaces`: an active rule of the owner's it takes the place of.
   */
  fileRule(text: string, repos: string[], cardId: string | null = null, replaces?: number) {
    const clean = checkPreference(text);
    if (!repos.length) throw new BadRequest('invalid', 'no repository');
    for (const r of repos) this.checkRepo(r);
    this.store.transaction(() => {
      if (replaces !== undefined) this.store.preferences.set(this.project.id, replaces, null);
      for (const repo of new Set(repos)) {
        this.store.preferences.fileRule(this.project.id, clean, cardId, repo);
        this.collect(repo, clean);
      }
    });
    this.changed();
  }

  /**
   * Adds an accepted rule to the repository's open card "Add to CLAUDE.md": planned and not yet
   * with the Koordinator. Without one, a new card collects it.
   */
  private collect(repo: string, rule: string) {
    const open = this.collecting(repo);
    if (open) {
      this.store.cards.update(open.id, { body: `${open.body.trimEnd()}\n- ${rule}` });
      this.log(open.id, 'state', 'koordinator', this.t.koordinator.ruleTaken(rule));
      return;
    }
    const card = this.create({ title: this.t.claudeMd.title, body: `${this.t.claudeMd.task}\n\n- ${rule}`, repo, ...this.freeSpot() });
    // Seismic makes this card itself, so its labels are set, not suggested
    this.store.updateCard(card.id, { labels: { category: { value: 'docs', by: null }, subcategory: { value: 'configuration', by: null } } });
    this.setSetting(`${CLAUDE_MD_SETTING}${repo}`, card.id);
    this.log(card.id, 'state', 'koordinator', this.t.koordinator.ruleTaken(rule));
  }

  /** The repository's card "Add to CLAUDE.md" while it still collects rules, if there is one. */
  collecting(repo: string): Item | undefined {
    const id = this.setting(`${CLAUDE_MD_SETTING}${repo}`);
    const card = id ? this.item(id) : undefined;
    return card && card.state === 'planned' && !card.queue && !card.archivedAt ? card : undefined;
  }

  private checkRepo(repo: string) {
    if (!this.project.repos.some((r) => r.id === repo)) throw new BadRequest('invalid', 'unknown repository');
  }

  /** What a card's `repo` column holds for `repo`: nothing for the home repository. */
  private repoColumn(repo: string | undefined): string | null {
    return repo && repo !== this.home ? repo : null;
  }

  /** A card just stored, as the UI sees it. */
  private itemOf(row: CardRow): Item {
    return toItems([row], [], this.home, undefined, this.themeNow)[0]!;
  }

  /** The owner rejects a proposal; it is kept, so the same one does not come back. */
  rejectProposal(id: number) {
    if (!this.store.preferences.decide(this.project.id, id, 'rejected')) throw new BadRequest('unknownPreference', 'no such proposal');
    this.changed();
  }

  // ---------------------------------------------------------------- groups

  /** Puts the cards into the group, or with `null` into none; a workstream stands for its plan. */
  group(cardIds: unknown, groupId: string | null) {
    const ids = this.groupable(cardIds);
    const g = groupId === null ? null : this.ownGroup(groupId);
    if (g && ids.some((id) => this.own(id).canvas_id !== g.canvasId)) throw new BadRequest('invalid', 'a group holds cards of its own canvas only');
    this.store.cards.setGroup(ids, groupId);
    this.store.dropEmptyGroups(this.project.id);
    this.changed();
  }

  /**
   * A new group with the cards in it, in the colour `hue` or else the first colour no group has. A
   * name a group has already (in any case) puts the cards into that group.
   */
  createGroup(name: unknown, cardIds: unknown, hue?: unknown): Group {
    const n = this.groupName(name);
    const ids = this.groupable(cardIds);
    if (!ids.length) throw new BadRequest('invalid', 'a group needs a card');
    if (hue !== undefined && !(Number.isInteger(hue) && (hue as number) >= 0 && (hue as number) < 360)) throw new BadRequest('invalid', 'hue must be a whole number from 0 to 359');
    const canvases = new Set(ids.map((id) => this.own(id).canvas_id));
    if (canvases.size > 1) throw new BadRequest('invalid', 'a group holds cards of one canvas');
    const [canvas] = canvases as Set<string>;
    // a group's name is its canvas's; its colour differs from those of the groups beside it there
    const groups = this.store.groups.of(this.project.id).filter((x) => x.canvasId === canvas);
    const g =
      groups.find((x) => x.name.toLowerCase() === n.toLowerCase()) ??
      this.store.groups.add(this.project.id, n, (hue as number | undefined) ?? nextHue(groups.map((x) => x.hue)), canvas!);
    this.store.cards.setGroup(ids, g.id);
    this.store.dropEmptyGroups(this.project.id);
    this.changed();
    return toGroup(g);
  }

  renameGroup(id: string, name: unknown) {
    const own = this.ownGroup(id);
    const n = this.groupName(name);
    if (this.store.groups.of(this.project.id).some((g) => g.id !== id && g.canvasId === own.canvasId && g.name.toLowerCase() === n.toLowerCase()))
      throw new BadRequest('invalid', `there is a group named ${n} already`);
    this.store.groups.rename(id, n);
    this.changed();
  }

  /**
   * Ends the group: its cards, on the project and in the archive, belong to none. Returns what
   * `createGroup` needs to bring it back.
   */
  deleteGroup(id: string): { group: Group; cards: string[] } {
    const g = this.ownGroup(id);
    const cards = this.store.cards.inGroup(g.id);
    this.store.cards.setGroup(cards, null);
    this.store.dropEmptyGroups(this.project.id);
    this.changed();
    return { group: toGroup(g), cards };
  }

  // ---------------------------------------------------------------- canvases

  /** The project's canvases in the owner's order. */
  canvases(): Canvas[] {
    return this.store.canvases.of(this.project.id).map(toCanvas);
  }

  /** A new canvas, last in the order, with nothing on it. */
  createCanvas(name: unknown, icon?: unknown): Canvas {
    const n = this.canvasName(name);
    const c = this.store.canvases.add(this.project.id, n, icon === undefined ? null : this.canvasIcon(icon));
    this.changed();
    return toCanvas(c);
  }

  /**
   * Renames the canvas, changes its icon (`null` takes it away) or moves it to another place in the
   * order (`position`, from 1). `main` keeps its name.
   */
  updateCanvas(id: string, p: { name?: unknown; icon?: unknown; position?: unknown }): Canvas {
    const c = this.ownCanvas(id);
    const fields: { name?: string; icon?: string | null } = {};
    if (p.name !== undefined) {
      const n = this.canvasName(p.name, id);
      if (c.name === MAIN_CANVAS && n !== MAIN_CANVAS) throw new BadRequest('invalid', `the canvas ${MAIN_CANVAS} keeps its name`);
      fields.name = n;
    }
    if (p.icon !== undefined) fields.icon = p.icon === null ? null : this.canvasIcon(p.icon);
    const all = this.store.canvases.of(this.project.id);
    if (p.position !== undefined && !(Number.isInteger(p.position) && (p.position as number) >= 1 && (p.position as number) <= all.length))
      throw new BadRequest('invalid', `position must be a whole number from 1 to ${all.length}`);
    this.store.transaction(() => {
      this.store.canvases.update(id, fields);
      if (p.position !== undefined) {
        const rest = all.filter((x) => x.id !== id).map((x) => x.id);
        rest.splice((p.position as number) - 1, 0, id);
        this.store.canvases.order(rest);
      }
    });
    this.changed();
    return toCanvas(this.store.canvases.get(id)!);
  }

  /**
   * Deletes a canvas without cards on it; never `main`. Its archived cards go to `main`, where they
   * come back from the archive.
   */
  deleteCanvas(id: string) {
    const c = this.ownCanvas(id);
    if (c.name === MAIN_CANVAS) throw new BadRequest('canvasInUse', `the canvas ${MAIN_CANVAS} cannot be deleted`);
    const n = this.store.cards.onCanvas(id);
    if (n) throw new BadRequest('canvasInUse', `only an empty canvas can be deleted; ${c.name} has ${n} card${n === 1 ? '' : 's'}`);
    this.store.deleteCanvas(id, this.store.canvases.main(this.project.id));
    this.changed();
  }

  /**
   * The cards go onto another canvas of the project, each at a free spot there (a workstream with
   * its plan, a plan with its workstreams), out of their groups, which stay where they were.
   */
  moveToCanvas(cardIds: unknown, canvasId: string) {
    const to = this.ownCanvas(canvasId).id;
    const ids = this.groupable(cardIds).filter((id) => this.own(id).canvas_id !== to);
    for (const id of ids) {
      const at = this.spotOn(to);
      this.store.transaction(() => {
        this.store.cards.setCanvas([id], to);
        this.store.cards.update(id, at);
      });
      this.changedRows();
    }
    this.store.dropEmptyGroups(this.project.id);
    this.changed();
  }

  private ownCanvas(id: unknown): CanvasRow {
    const c = typeof id === 'string' ? this.store.canvases.get(id) : null;
    if (!c || c.projectId !== this.project.id) throw new BadRequest('unknownCanvas', 'unknown canvas');
    return c;
  }

  /** A canvas's name as given, checked: unique in the project in any case (but for canvas `self`), never a number from 1 to 999. */
  private canvasName(name: unknown, self?: string): string {
    checkText(name, 'name', CANVAS_NAME_MAX);
    const n = (name as string).replace(/\s+/g, ' ').trim();
    const problem = canvasNameProblem(n);
    if (problem === 'empty') throw new BadRequest('emptyText', 'a canvas needs a name');
    if (problem === 'number') throw new BadRequest('invalid', 'a canvas cannot be named by a number from 1 to 999, which names canvases by their place');
    if (this.store.canvases.of(this.project.id).some((c) => c.id !== self && c.name.toLowerCase() === n.toLowerCase())) throw new BadRequest('invalid', `there is a canvas named ${n} already`);
    return n;
  }

  /** An icon as given, checked: one emoji, or `lucide:<name>` of the curated set (`CANVAS_LUCIDE_ICONS`). */
  private canvasIcon(icon: unknown): string {
    const i = typeof icon === 'string' ? icon.trim() : '';
    if (!isCanvasIcon(i)) throw new BadRequest('invalid', `icon must be one emoji or lucide:<name>, one of ${CANVAS_LUCIDE_ICONS.join(', ')}`);
    return i;
  }

  /** The group a card's new offspring (a proposal, a follow-up, a package, a prototype) goes into. */
  private groupOf(r: CardRow): string | null {
    if (r.group_id) return r.group_id;
    return r.parent_id ? (this.store.cards.get(r.parent_id)?.group_id ?? null) : null;
  }

  /** The cards, each own: workstreams give their plan, every card once. */
  private groupable(cardIds: unknown): string[] {
    if (!Array.isArray(cardIds) || !cardIds.every((id) => typeof id === 'string')) throw new BadRequest('invalid', 'cards must be a list of card ids');
    return [...new Set(cardIds.map((id) => this.own(id)).map((r) => r.parent_id ?? r.id))];
  }

  private ownGroup(id: unknown): GroupRow {
    const g = typeof id === 'string' ? this.store.groups.get(id) : null;
    if (!g || g.projectId !== this.project.id) throw new BadRequest('unknownGroup', 'unknown group');
    return g;
  }

  private groupName(name: unknown): string {
    checkText(name, 'name', 60);
    const n = (name as string).replace(/\s+/g, ' ').trim();
    if (!n) throw new BadRequest('emptyText', 'a group needs a name');
    return n;
  }

  /**
   * `elsewhere`: the card on another project it follows up on (a card Seismic makes here from there); it
   * goes where `x` and `y` say, in no group.
   */
  create(n: NewCard, elsewhere?: string, by?: ActivityWho): Item {
    checkText(n.title, 'title', 200);
    if (n.body !== undefined) checkText(n.body, 'body', 20000);
    if (n.repo !== undefined) this.checkRepo(n.repo);
    const from = n.from !== undefined ? this.own(n.from) : undefined;
    if (from && n.idea) throw new BadRequest('invalid', 'an idea follows up on no card');
    // without a place (the phone, which shows no project) it goes where there is room
    const placed = n.x !== undefined || n.y !== undefined;
    if (!from && placed) {
      checkNumber(n.x, 'x');
      checkNumber(n.y, 'y');
    }
    if (n.canvas !== undefined) this.ownCanvas(n.canvas);
    // a follow-up goes on its card's canvas, any other where it says, else where the owner looks
    const canvas = from ? from.canvas_id : (n.canvas ?? this.canvasFor());
    const at = from ? this.followUpSpot(from.id) : placed ? { x: n.x!, y: n.y! } : this.spotOn(canvas);
    // a follow-up stays in the repository of the card it comes from unless told otherwise
    const repo = n.repo ?? (from ? (from.repo ?? this.home) : undefined);
    if (n.images !== undefined) this.checkImages(n.images);
    const [row] = this.store.addCards([
      {
        project_id: this.project.id,
        canvas_id: canvas,
        kind: 'task',
        state: n.idea ? 'idea' : 'planned',
        title: n.title,
        body: n.body ?? '',
        ...at,
        repo: this.repoColumn(repo),
        ...(from ? { from_id: from.id, group_id: this.groupOf(from) } : elsewhere ? { from_id: elsewhere } : {}),
        images: n.images?.length ? JSON.stringify(n.images) : null,
        ...(n.idea ? { idea: { discussion: { status: 'open', brief: '' } satisfies StoredIdea } } : {}),
      },
    ]);
    if (by) this.record(row!.id, 'created', by);
    this.changed();
    return this.itemOf(row!);
  }

  patch(id: string, p: CardPatch) {
    const row = this.own(id);
    const allowed = [...(row.plan_ref ? (row.kind === 'plan' ? ['x', 'y', 'collapsed'] : ['x', 'y', 'state', 'need']) : ['x', 'y', 'title', 'body', 'state', 'need', 'repo', 'images', 'newRepo']), ...LABELS];
    const bad = Object.keys(p).filter((k) => !allowed.includes(k));
    if (bad.length) throw new BadRequest('invalid', `cannot change ${bad.join(', ')} on this card`);
    if (p.x !== undefined) checkNumber(p.x, 'x');
    if (p.y !== undefined) checkNumber(p.y, 'y');
    if (p.collapsed !== undefined && typeof p.collapsed !== 'boolean') throw new BadRequest('invalid', 'collapsed must be true or false');
    if (p.title !== undefined) checkText(p.title, 'title', 200);
    if (p.body !== undefined) checkText(p.body, 'body', 20000);
    if (p.images !== undefined) this.checkImages(p.images);
    if (p.state !== undefined && !STATES.includes(p.state)) throw new BadRequest('invalid', `state must be one of ${STATES.join(', ')}`);
    if (p.need !== undefined && p.need !== null && p.need !== 'demo' && p.need !== 'question') throw new BadRequest('invalid', 'need must be demo, question or null');
    for (const l of LABELS) if (p[l] !== undefined && p[l] !== null && !isLabelValue(l, p[l])) throw new BadRequest('invalid', `${l} must be one of ${LABEL_VALUES[l].join(', ')} or null`);
    const { repo, images, collapsed, newRepo, category: _c, subcategory: _s, complexity: _x, priority: _p, ...fields } = p;
    if (newRepo !== undefined) this.checkNewRepo(row, newRepo);
    // a planned card of the owner's may become an idea again, to be discussed first
    if (p.state === 'idea' && row.state !== 'idea' && (row.plan_ref || (row.state ?? 'planned') !== 'planned' || row.workstation))
      throw new BadRequest('invalid', 'only a planned card of your own that has not been worked on can become an idea');
    if (repo !== undefined) {
      this.checkRepo(repo);
      // its workstation and branch belong to the repository it started in
      if ((row.state !== 'idea' && (row.state ?? 'planned') !== 'planned') || row.workstation) throw new BadRequest('invalid', 'a card changes repository only before work begins');
    }
    this.store.updateCard(id, {
      ...fields,
      ...(repo !== undefined ? { repo: this.repoColumn(repo) } : {}),
      ...(images !== undefined ? { images: images.length ? JSON.stringify(images) : null } : {}),
      ...(collapsed !== undefined ? { plan: { collapsed } } : {}),
      ...this.ownerLabels(p),
      // a repository of the project picked instead of a new one: the owner's pick, which the idea's agent leaves
      idea:
        newRepo !== undefined || repo !== undefined
          ? { newRepo: newRepo ? ({ path: newRepo.path.trim(), project: newRepo.project, by: 'owner' } satisfies NewRepo) : ({ path: '', project: true, by: 'owner', none: true } satisfies StoredNewRepo) }
          : {},
    });
    this.changed();
  }

  /** The labels the owner set in `p`, to a value or to none: theirs from now on, and Seismic suggests none of them again. */
  private ownerLabels(p: { [L in Label]?: Labels[L] | null }): { labels?: LabelsUpdate } {
    const set = LABELS.filter((l) => p[l] !== undefined);
    if (!set.length) return {};
    return { labels: Object.fromEntries(set.map((l) => [l, { value: p[l] ?? null, by: 'owner' }])) };
  }

  /**
   * Seismic's suggestion of a card's labels: it fills only those that are empty and the owner has
   * never set (not even to none), and marks them as suggested. The labels it filled.
   */
  suggestLabels(id: string, labels: Labels): Label[] {
    const open = this.openLabels(id);
    const filled = LABELS.filter((l) => labels[l] !== undefined && isLabelValue(l, labels[l]) && open.includes(l));
    if (!filled.length) return [];
    this.store.updateCard(id, { labels: Object.fromEntries(filled.map((l) => [l, { value: labels[l]!, by: 'suggestion' }])) });
    this.changed();
    return filled;
  }

  /** The labels a suggestion may fill on a card: empty, and never set by the owner (not even to none). */
  openLabels(id: string): Label[] {
    const { labels } = this.own(id);
    return LABELS.filter((l) => (labels[l]?.value ?? null) === null && labels[l]?.by !== 'owner');
  }

  private checkNewRepo(row: CardRow, n: unknown) {
    if (n !== null && (typeof n !== 'object' || typeof (n as NewRepo).path !== 'string' || typeof (n as NewRepo).project !== 'boolean'))
      throw new BadRequest('invalid', 'newRepo must be { path, project } or null');
    if (n && (n as NewRepo).path.length > 1000) throw new BadRequest('invalid', 'the path is too long');
    if (row.idea?.prototypeOf || (row.state !== 'idea' && (row.state ?? 'planned') !== 'planned') || row.workstation)
      throw new BadRequest('invalid', 'a card gets a new repository only before work on it begins');
    if (this.newRepo(row.id)?.due) throw new BadRequest('newRepoDue', 'the new repository is being made');
  }

  /** The repository to create for a card, as stored (`StoredNewRepo`); none where there is none. */
  newRepo(id: string): StoredNewRepo | null {
    return this.store.cards.get(id)?.idea?.newRepo ?? null;
  }

  /**
   * The repository to create for a card, as its idea's agent or Seismic sets it; null takes it off.
   * What the owner chose, the agent does not change: false then.
   */
  setNewRepo(id: string, n: StoredNewRepo | null, by: NewRepo['by'] = 'owner'): boolean {
    const was = this.newRepo(id);
    // what the owner picked stands, and a repository about to be made stays as it was clicked
    if (by === 'agent' && ((was?.by === 'owner' && !was.made) || was?.due)) return false;
    this.store.updateCard(id, { idea: { newRepo: n } });
    this.changed();
    return true;
  }

  /** The owner's history of the project, in Seismic's sheet: the card left for another project. */
  moved(m: TalkMoved) {
    this.store.addMoved(this.project.id, m, this.t.newRepo.movedAway(m.title, m.projectName));
    this.changed();
  }

  /**
   * Merges tasks into the first (`keep`), titled `title`; the caller checks they may be merged and
   * removes the others. Their texts go in unchanged, each a section under its old title, with their
   * screenshots and the owner's notes they held. What followed up on them, and review findings that
   * linked them, now point at the first.
   */
  merge(keep: string, others: string[], title: string) {
    const first = this.own(keep);
    const rest = others.map((id) => this.own(id));
    const section = (r: CardRow) => `## ${r.title ?? ""}\n\n${r.body ?? ''}`.trim();
    const body = [first, ...rest].map(section).filter(Boolean).join('\n\n');
    checkText(body, 'the merged text', 20000);
    const list = (r: CardRow) => (r.images ? (JSON.parse(r.images) as string[]) : []);
    const images = [...new Set([first, ...rest].flatMap(list))];
    const notes = [first, ...rest].flatMap((r) => (r.unheard ? (JSON.parse(r.unheard) as unknown[]) : []));
    const gone = new Set(others);
    // started ones waiting in the queue: the merged task waits for what any of them waited for, in the place of the one queued first
    const queued = [first, ...rest].map(waitOf).filter((q) => !!q);
    const merged = (ids: string[]) => [...new Set(ids)].filter((id) => id !== keep && !gone.has(id));
    const behind = merged(queued.flatMap((q) => q.behind));
    const buildsOn = merged(queued.flatMap((q) => q.buildsOn ?? []));
    const manualWait = merged(queued.flatMap((q) => q.manualWait ?? []));
    const queue = behind.length
      ? { queue: JSON.stringify({ behind, reason: queued[0]!.reason, ...(buildsOn.length && { buildsOn }), ...(manualWait.length && { manualWait }), since: queued.map((q) => q.since).sort()[0]! }) }
      : {};
    this.store.cards.update(keep, { title, body, images: images.length ? JSON.stringify(images) : null, ...(notes.length ? { unheard: JSON.stringify(notes) } : {}), ...queue });
    for (const r of this.store.cards.onProject(this.project.id)) {
      if (r.from_id && gone.has(r.from_id) && r.id !== keep) this.store.cards.update(r.id, { from_id: keep });
      // a card that waited for one that goes waits for the merged task instead
      const w = r.id === keep ? undefined : waitOf(r);
      if (w?.behind.some((id) => gone.has(id))) {
        const to = (ids: string[]) => [...new Set(ids.map((id) => (gone.has(id) ? keep : id)))];
        // a card it waited for by an inferred wait stays waited for so, also where an arrow named another merged into it
        const inferred = to(w.behind.filter((id) => !w.manualWait?.includes(id)));
        const manualWait = to(w.manualWait ?? []).filter((id) => !inferred.includes(id));
        this.store.cards.update(r.id, { queue: JSON.stringify({ ...w, behind: to(w.behind), ...(w.buildsOn && { buildsOn: to(w.buildsOn) }), manualWait: manualWait.length ? manualWait : undefined }) });
      }
      const c = contributionOf(r);
      if (c?.findings?.some((f) => f.card && gone.has(f.card))) this.store.updateCard(r.id, { review: { contribution: { ...c, findings: c.findings.map((f) => (f.card && gone.has(f.card) ? { ...f, card: keep } : f)) } } });
      const items = r.review?.items;
      if (items?.some((i) => i.card && gone.has(i.card))) this.store.updateCard(r.id, { review: { items: items.map((i) => (i.card && gone.has(i.card) ? { ...i, card: keep } : i)) } });
    }
    this.log(keep, 'state', 'obeya', this.t.voice.merged(rest.map((r) => r.title ?? '')));
    this.changed();
  }

  /** Manual cards only; a plan card goes away with its workstream. */
  remove(id: string) {
    const row = this.own(id);
    if (row.plan_ref) throw new BadRequest('planCard', 'plan cards are removed in the plan doc');
    this.store.cards.update(id, { deleted_at: new Date().toISOString() });
    this.record(id, 'deleted', 'owner', { title: row.title ?? '' });
    this.changed();
  }

  restore(id: string) {
    const row = this.store.cards.get(id);
    if (!row || row.project_id !== this.project.id) throw new BadRequest('unknownCard', 'unknown card');
    this.store.cards.update(id, { deleted_at: null });
    this.changed();
    this.backOnProject(id);
  }

  /** A card deleted or archived is back: its arrows too, but none that the arrows drawn meanwhile would make a cycle. */
  private backOnProject(id: string) {
    const items = this.items();
    const edges = this.manualDependencies();
    const kept = edges.filter(([a, b]) => a !== id && b !== id);
    for (const e of edges) if ((e[0] === id || e[1] === id) && !closesCycle(e[0], e[1], kept.map(([a, b]): [string, string] => [a, b]), items)) kept.push(e);
    if (kept.length !== edges.length) this.setManualDependencies(kept);
  }

  private checkImages(ids: unknown) {
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) throw new BadRequest('invalid', 'images must be a list of image ids');
    this.images?.resolve(ids);
  }

  private own(id: string): CardRow {
    const row = this.store.cards.get(id);
    if (!row || row.project_id !== this.project.id || row.deleted_at) throw new BadRequest('unknownCard', 'unknown card');
    return row;
  }

  /**
   * Keeps each doc's last state on its plan. A plan whose doc is gone, or whose work is done
   * (not among the `open` docs, which keep it while a workstream's worker finishes after its landing),
   * goes into the archive; one whose doc is back, or open again, returns to the project.
   */
  private keepDocs(all: PlanDoc[], open: PlanDoc[]) {
    const byFile = new Map(all.map((d) => [d.file, d]));
    const shown = new Set(open.map((d) => d.file));
    const at = new Date().toISOString();
    this.store.transaction(() => {
      for (const r of this.store.cards.plans(this.project.id)) {
        const doc = byFile.get(r.plan_ref!);
        const was = r.plan?.doc ?? null;
        const plan = doc ?? was;
        const archived_at = shown.has(r.plan_ref!) ? null : (r.archived_at ?? at);
        if (JSON.stringify(was) !== JSON.stringify(plan) || r.archived_at !== archived_at) this.store.updateCard(r.id, { plan: { doc: plan }, archived_at });
      }
    });
  }

  /** What the Koordinator read of a plan's plan doc about which workstream builds on which, and whether it is reading it now. */
  deps(planId: string): StoredDeps & { current: boolean } {
    // the plan keeps its doc as the project last read it
    this.items();
    const row = this.own(planId);
    const doc = row.plan?.doc;
    if (row.kind !== 'plan' || !doc) throw new BadRequest('invalid', 'not a plan');
    const d = row.plan?.deps ?? {};
    return { ...d, current: !!d.on && d.sig === depsSig(doc) };
  }

  /**
   * The plans whose plan doc the Koordinator is to read for which workstream builds on which
   * (`arranging` on the project), from their rows: asked on every change, this builds no snapshot.
   */
  arranging(): string[] {
    return this.store.cards.plans(this.project.id).flatMap((r) => (!r.archived_at && r.plan?.deps?.reading ? [r.id] : []));
  }

  /** The Koordinator starts reading which workstream builds on which (`reading`), or has read it (`on`, for the doc as it stands now). */
  setDeps(planId: string, d: { reading: NonNullable<StoredDeps['reading']> } | { on: Record<string, string[]> } | { failed: true }) {
    const row = this.own(planId);
    const was = row.plan?.deps ?? {};
    const next: StoredDeps =
      'reading' in d ? { ...was, reading: d.reading } : 'on' in d ? { sig: depsSig(row.plan!.doc!), on: d.on } : { ...was, reading: undefined };
    this.store.updateCard(planId, { plan: { deps: next } });
    this.changed();
  }

  /** The workstream key of each of the plan's workstreams, by card. */
  workstreamKeys(planId: string): Map<string, string> {
    return new Map(this.store.cards.children([planId]).flatMap((k) => (k.plan_ref?.includes('#') ? [[k.id, k.plan_ref.slice(k.plan_ref.indexOf('#') + 1)]] : [])));
  }

  /** Whether none of the plan's workstreams stands anywhere but where it was placed when the plan came (`placeNew`). */
  untouched(planId: string): boolean {
    const row = this.own(planId);
    const doc = row.plan!.doc!;
    const first = placeWorkstreams(doc.workstreams);
    const kids = this.store.cards.children([planId]);
    return kids.every((k) => {
      const n = doc.workstreams.findIndex((w) => `${doc.file}#${w.key}` === k.plan_ref);
      return n >= 0 && first[n]!.x === k.x && first[n]!.y === k.y;
    });
  }

  /**
   * Puts the plan's workstreams in columns by what builds on what (`arrangeWorkstreams`). A
   * plan that grows into another card or plan moves to the nearest spot clear of everything.
   */
  arrange(planId: string) {
    const items = this.items();
    const plan = items.find((i) => i.id === planId);
    if (plan?.kind !== 'plan') throw new BadRequest('invalid', 'not a plan on the project');
    const kids = items.filter((i) => i.parent === planId);
    const at = arrangeWorkstreams(kids);
    const moved = kids.map((k) => ({ ...k, ...at.get(k.id)! }));
    const [w, h] = planSize(moved);
    const others = items.filter((i) => !i.parent && i.id !== planId).map((i) => boundsOf(i, items));
    const overlaps = others.some((b) => plan.x < b.x + b.w && b.x < plan.x + w && plan.y < b.y + b.h && b.y < plan.y + h);
    this.store.transaction(() => {
      for (const k of moved) this.store.cards.update(k.id, { x: k.x, y: k.y });
      if (overlaps) this.store.cards.update(planId, freeSpotNear(plan, [w, h], others));
    });
    this.changed();
  }

  /** Every workstream a plan doc has had, from its history in git, the newest first (`readPlanHistory`); none for a doc outside git. */
  private docHistory?: (ref: string) => Workstream[];
  /** What `docHistory` said of each doc during one `follow`, which may ask for several cards. */
  private pastOf = new Map<string, Workstream[]>();

  /** Who reads a plan doc's history: a card whose workstream left the doc gets its title from there. */
  readPlanHistory(fn: (ref: string) => Workstream[]) {
    this.docHistory = fn;
  }

  /** What the doc's history says, read once per `follow`. */
  private past(file: string): Workstream[] {
    return this.pastOf.get(file) ?? this.pastOf.set(file, this.docHistory?.(file) ?? []).get(file)!;
  }

  /** Cards whose workstream left its doc, by when that was seen, that wait to leave their plan (`follow`). */
  private missing = new Map<string, number>();
  /** Looks at the waiting cards again once the first of them may leave. */
  private waking?: ReturnType<typeof setTimeout>;

  /**
   * Keeps each workstream card with its own workstream. A card whose workstream the doc gives
   * another key now (a sibling dropped or added, `workstreamAliases`) moves onto it. A card whose
   * workstream the doc no longer lists, while the doc is there, leaves the plan once an agent
   * worked on it, with its log, as a card of its own (`leave`); one nobody worked on just goes from
   * view. It remembers what the workstream was right away, and leaves only once it holds no
   * workstation it is not at work in, and, for a doc in a plan folder outside the repository, which
   * is written in place, once the workstream stayed away for `LEAVE_AFTER_MS`. With `read` (the docs
   * were read again), a plan read before workstreams had keys of their own (`#n`, their place in
   * the doc) moves its cards onto those keys first (`rekey`). Between reads, only waiting cards
   * bring it here.
   */
  private follow(all: PlanDoc[], read: boolean) {
    if (!read && !this.missing.size) return;
    this.pastOf.clear();
    const byFile = new Map(all.map((d) => [d.file, d]));
    const plans = this.store.cards.plans(this.project.id).filter((p) => byFile.has(p.plan_ref!));
    // the doc as last read, with its whole text: only parsed where a card needs it
    const lastOf = new Map<string, PlanDoc | null>();
    const last = (p: CardRow) => (lastOf.has(p.id) ? lastOf.get(p.id)! : lastOf.set(p.id, (p.plan?.doc ?? null)).get(p.id)!);
    if (read) for (const p of plans) if (last(p)) this.rekey(p, last(p)!, byFile.get(p.plan_ref!)!);
    const kidsOf = Map.groupBy(this.store.cards.children(plans.map((p) => p.id)), (k) => k.parent_id!);
    const waiting = new Set<string>();
    const now = Date.now();
    for (const p of plans) {
      const doc = byFile.get(p.plan_ref!)!;
      const kids = kidsOf.get(p.id) ?? [];
      const keys = new Set(doc.workstreams.map((w) => w.key));
      const holderOf = new Map(kids.flatMap((k) => (keys.has(keyOfRef(k.plan_ref) ?? '') ? [[keyOfRef(k.plan_ref)!, k] as const] : [])));
      for (const k of kids) {
        const key = keyOfRef(k.plan_ref);
        if (key === null || keys.has(key)) continue;
        // what the workstream was: in the doc as last read, else as the card remembered it
        const known = last(p)?.workstreams.find((x) => x.key === key);
        const w = sameWorkstream(key, doc, known ?? (k.title ? { title: k.title } : undefined));
        const holder = w && holderOf.get(w.key);
        // a card nobody worked on gives way to the one with the workstream's log
        if (w && (!holder || (!worked(holder) && worked(k)))) {
          if (holder) {
            this.store.cards.replan(holder.id, `${p.plan_ref}#\u0000${holder.id}`, p.id);
            this.store.cards.update(holder.id, { deleted_at: new Date().toISOString() });
          }
          this.store.cards.replan(k.id, `${doc.file}#${w.key}`, p.id);
          holderOf.set(w.key, k);
          this.missing.delete(k.id);
          continue;
        }
        if (!worked(k)) continue;
        if (known) this.remember(k, known);
        const since = this.missing.get(k.id) ?? now;
        // a stopped card gives its workstation back first, as a workstream no longer in the doc does (`leaseEnded`);
        // a doc written in place may lack an item only while it is being edited
        if ((k.workstation && !atWork(k)) || (outsideRef(doc.file) && now - since < LEAVE_AFTER_MS)) {
          waiting.add(k.id);
          this.missing.set(k.id, since);
          continue;
        }
        this.leave(k, p, this.identity(k, doc.file, last(p), false), this.t.idea.leftGone(doc.title));
      }
    }
    for (const id of this.missing.keys()) if (!waiting.has(id)) this.missing.delete(id);
    clearTimeout(this.waking);
    const next = Math.min(...[...this.missing.values()].map((t) => t + LEAVE_AFTER_MS - now).filter((ms) => ms > 0));
    if (Number.isFinite(next)) {
      this.waking = setTimeout(() => this.changed(), next + 50);
      this.waking.unref?.();
    }
  }

  /** The card keeps what its workstream was (`w`), for when it leaves the plan after the doc is read again. */
  private remember(row: CardRow, w: Pick<Workstream, 'label' | 'title' | 'body'>) {
    const title = w.label ? `${w.label} ${w.title}` : w.title;
    if (row.title !== title || row.body !== w.body) this.store.cards.update(row.id, { title, body: w.body });
  }

  /**
   * Moves the plan's cards from the keys an older Seismic gave its workstreams (their place in
   * the doc, `#n`) onto the keys they have now. A card an agent worked on goes by the title its
   * branch was named after, since the doc may have changed under its old key, so that its log stays
   * with its own workstream; one whose workstream the doc no longer has leaves the plan, and the
   * plan lays out afresh in the doc's order, with fresh cards for the workstreams without one.
   * Otherwise the cards keep their places.
   */
  private rekey(plan: CardRow, before: PlanDoc, doc: PlanDoc) {
    const again = parsePlanDoc(before.file, before.markdown);
    if ('reason' in again || again.workstreams.length !== before.workstreams.length) return;
    const renamed = new Map(before.workstreams.flatMap((w, i) => (w.key !== again.workstreams[i]!.key ? [[w.key, again.workstreams[i]!.key] as const] : [])));
    if (!renamed.size) return;
    const kids = this.store.cards.children([plan.id]);
    const keys = new Set(doc.workstreams.map((w) => w.key));
    // positional keys of a doc read before this one, whose cards are out of view now
    const positional = (k: string) => renamed.has(k) || (/^#\d+$/.test(k) && !before.workstreams.some((w) => w.key === k));
    const moving = kids.filter((k) => positional(keyOfRef(k.plan_ref) ?? ''));
    if (!moving.length) return;
    const claimed = new Set(kids.filter((k) => !moving.includes(k)).flatMap((k) => keyOfRef(k.plan_ref) ?? []));
    const to = new Map<string, string>();
    const leaving: CardRow[] = [];
    const started = new Map(moving.map((k) => [k.id, this.startedAs(k)]));
    // first the cards an agent worked on, the most recent first, by the workstream they were started on
    const order = [...moving].sort((a, b) => Number(!started.get(a.id)) - Number(!started.get(b.id)) || b.updated_at.localeCompare(a.updated_at));
    for (const k of order) {
      const slug = started.get(k.id);
      const key = slug ? this.startedOn(slug, doc, claimed, again) : renamed.get(keyOfRef(k.plan_ref)!);
      if (key && keys.has(key) && !claimed.has(key)) {
        to.set(k.id, key);
        claimed.add(key);
      } else if (worked(k)) leaving.push(k);
    }
    const ref = (key: string) => `${doc.file}#${key}`;
    this.store.transaction(() => {
      // out of each other's way first: two cards may swap keys
      for (const k of moving) this.store.cards.replan(k.id, `${plan.plan_ref}#\u0000${k.id}`, plan.id);
      for (const k of moving) {
        const key = to.get(k.id);
        if (key) this.store.cards.replan(k.id, ref(key), plan.id);
        // nobody worked on it: it goes, and the workstream gets a card of its own; its reference stays
        // one of no card, so that nothing reads it as a card of the owner's they deleted
        else if (!leaving.includes(k)) this.store.cards.update(k.id, { deleted_at: new Date().toISOString() });
      }
      for (const k of leaving) {
        const w = this.identity(k, doc.file, before, true);
        if ((atWork(k) || !k.workstation) && !outsideRef(doc.file)) this.leave(k, plan, w, this.t.idea.leftOther(doc.title));
        // a stopped card gives its workstation back first, and a doc outside the repository may lack an item
        // only for a moment: it leaves later (`follow`), with what it remembers
        else {
          this.store.cards.replan(k.id, `${plan.plan_ref}#~${k.id.slice(0, 6)}`, plan.id);
          this.remember(k, w);
        }
      }
      // cards left, others get fresh ones: the plan lays out afresh in the doc's order, which the mix-up had broken anyway
      if (leaving.length) {
        const rows = new Map(this.store.cards.children([plan.id]).flatMap((k) => (keyOfRef(k.plan_ref) ? [[keyOfRef(k.plan_ref)!, k] as const] : [])));
        const at = placeWorkstreams(doc.workstreams.map((w) => ({ done: w.done || finished(rows.get(w.key)?.state ?? 'planned') })));
        doc.workstreams.forEach((w, i) => {
          const row = rows.get(w.key);
          if (row) this.store.cards.update(row.id, at[i]!);
          else this.store.addCards([{ project_id: this.project.id, kind: 'task', parent_id: plan.id, plan_ref: ref(w.key), ...at[i]! }]);
        });
      }
      // what the Koordinator read of which workstream builds on which goes with the cards
      const deps = plan.plan?.deps ?? null;
      if (deps?.on) {
        const keyOf = new Map(moving.flatMap((k) => (to.has(k.id) ? [[keyOfRef(k.plan_ref)!, to.get(k.id)!] as const] : [])));
        const on = Object.fromEntries(
          Object.entries(deps.on).flatMap(([k, by]) => {
            const key = keyOf.get(k) ?? (positional(k) ? undefined : k);
            return key ? [[key, by.flatMap((b) => keyOf.get(b) ?? (positional(b) ? [] : [b]))]] : [];
          }),
        );
        this.store.updateCard(plan.id, { plan: { deps: { ...deps, on } } });
      }
    });
  }

  /**
   * The key of the doc's workstream an agent started on under the title its branch was named after
   * (`slug`), among those no card has yet (`claimed`): by that title, or, where the doc reworded it
   * since, by the label the doc as Seismic last kept it (`stored`, read anew) or the doc's history gave
   * that title.
   */
  private startedOn(slug: string, doc: PlanDoc, claimed: Set<string>, stored: PlanDoc): string | undefined {
    const free = doc.workstreams.filter((w) => !claimed.has(w.key));
    const byTitle = free.find((w) => named(w, slug));
    if (byTitle) return byTitle.key;
    const label =
      stored.workstreams.find((w) => w.label && named(w, slug))?.label ??
      this.past(doc.file).find((w) => w.label && named(w, slug))?.label;
    const same = label ? free.filter((w) => w.label === label) : [];
    return same.length === 1 && doc.workstreams.filter((w) => w.label === label).length === 1 ? same[0]!.key : undefined;
  }

  /** The title of the card the agent last started on, as its branch has it (`branchName`); none for a card never started. */
  private startedAs(row: CardRow): string | null {
    const short = row.id.slice(0, 6);
    const at = new RegExp(`${CARD_BRANCH}([a-z0-9-]+)-${short}`);
    const slug = at.exec(row.branch ?? '')?.[1] ?? at.exec(this.store.events.branchMention(row.id) ?? '')?.[1] ?? null;
    // a title without a Latin letter or digit names its branch `card`, which tells no workstream apart
    return slug === 'card' ? null : slug;
  }

  /**
   * The workstream a card worked on, from the doc as last read (`before`), what the card remembered
   * of it (`remember`) or the doc's history: by its key, or, for a card whose key was its place in
   * the doc (`positional`), by the title its branch was named after.
   */
  private identity(row: CardRow, file: string, before: PlanDoc | null, positional: boolean): Pick<Workstream, 'label' | 'title' | 'body'> {
    const key = keyOfRef(row.plan_ref) ?? '';
    const slug = this.startedAs(row);
    const past = () => this.past(file);
    // what the card remembered when its workstream left the doc (`remember`)
    const kept = () => (!positional && row.title ? { title: row.title, body: row.body ?? '' } : undefined);
    const byKey = () => (positional ? undefined : (before?.workstreams.find((w) => w.key === key) ?? kept() ?? past().find((w) => w.key === key)));
    const bySlug = () => (slug ? (before?.workstreams.find((w) => named(w, slug)) ?? past().find((w) => named(w, slug))) : undefined);
    const byPlace = () => (positional && !slug ? before?.workstreams.find((w) => w.key === key) : undefined);
    return byKey() ?? bySlug() ?? byPlace() ?? { title: slug ? slug.replace(/-/g, ' ') : key, body: '' };
  }

  /**
   * The card leaves its plan as a card of its own, its log saying so (`why`), with the title and
   * text of the workstream it worked on (`w`). Finished, it goes into the archive; otherwise it
   * stands beside the plan.
   */
  private leave(row: CardRow, plan: CardRow, w: Pick<Workstream, 'label' | 'title' | 'body'>, why: string) {
    // a workstream planned again after part of it landed is done now that the doc asks no more of it
    const state = row.state === 'planned' && row.shipped ? 'live' : (row.state ?? 'planned');
    const done = finished(state) && !atWork(row);
    const at = done ? { x: row.x, y: row.y } : this.besidePlan(plan);
    this.store.cards.replan(row.id, null, null);
    this.store.cards.update(row.id, {
      title: w.label ? `${w.label} ${w.title}` : w.title,
      body: w.body,
      state,
      repo: repoOfRef(plan.plan_ref!, this.home),
      group_id: plan.group_id,
      ...at,
      ...(done ? { archived_at: new Date().toISOString() } : {}),
    });
    this.log(row.id, 'state', 'obeya', why);
  }

  /** A free spot for a card at the right of the plan, near its top. */
  private besidePlan(plan: CardRow): { x: number; y: number } {
    const items = this.on(plan.canvas_id, toItems(this.store.cards.onProject(this.project.id), this.docs ?? [], this.home));
    const p = items.find((i) => i.id === plan.id);
    if (!p) return { x: plan.x, y: plan.y };
    const box = boundsOf(p, items);
    return freeSpotNear({ x: box.x + box.w + GAP, y: box.y }, CARD_SIZE.task, items.filter((i) => !i.parent).map((i) => boundsOf(i, items)));
  }

  /**
   * Stores a row for every plan and workstream seen for the first time. A doc whose work was
   * done before Seismic first saw it (among `all`, not `docs`) gets its rows too, placed after the
   * others, and goes straight to the archive (`keepDocs`). Returns whether any were added.
   */
  private placeNew(docs: PlanDoc[], items: Item[], all: PlanDoc[], rows: CardRow[]): boolean {
    const byRef = new Map(rows.filter((r) => r.plan_ref).map((r) => [r.plan_ref!, r]));
    const add: NewRow[] = [];
    const c = this.project.id;

    for (const doc of docs) {
      const plan = byRef.get(doc.file);
      if (!plan) continue;
      const missing = doc.workstreams.filter((w) => !byRef.has(`${doc.file}#${w.key}`));
      if (!missing.length) continue;
      const kids = items.filter((i) => i.parent === plan.id);
      const startY = kids.length ? Math.max(...kids.map((k) => k.y + sizeOf(k, items)[1])) + GAP : PLAN_HEAD;
      placeWorkstreams(missing, startY).forEach((pos, n) =>
        add.push({ project_id: c, kind: 'task', parent_id: plan.id, plan_ref: `${doc.file}#${missing[n]!.key}`, ...pos }),
      );
    }
    if (add.length) this.store.addCards(add);
    const linked = this.linkOrigins(docs);

    const known = new Set(this.store.cards.plans(this.project.id).map((r) => r.plan_ref!));
    const done = all.filter((d) => !docs.includes(d) && !known.has(d.file));
    const fresh = [...docs.filter((d) => !byRef.has(d.file)), ...done];
    if (!fresh.length) return add.length > 0 || linked;
    const layouts = fresh.map((d) => {
      const pos = placeWorkstreams(d.workstreams);
      const kids = pos.map((p, n) => ({ kind: 'task' as const, state: d.workstreams[n]!.done ? ('live' as const) : ('planned' as const), parent: 'p', ...p }));
      return { doc: d, pos, size: planSize(kids) };
    });
    // plans found in a repository go on `main`
    const main = this.store.canvases.main(this.project.id);
    const onMain = this.on(main, items);
    const top = onMain.filter((i) => !i.parent);
    // below a note the owner put there too
    const notes = this.planDirs(all).flatMap((d) => planDirNoteBox(d) ?? []);
    const at = placePlans(unionBounds([...top.map((i) => boundsOf(i, onMain)), ...notes]), layouts.map((l) => l.size));
    layouts.forEach(({ doc, pos }, n) => {
      const [plan] = this.store.addCards([{ project_id: c, canvas_id: main, kind: 'plan', plan_ref: doc.file, ...at[n]! }]);
      // a plan just come stands arranged by what builds on what, once the Koordinator has read that
      if (docs.includes(doc) && doc.workstreams.filter((w) => !w.done).length > 1) this.store.updateCard(plan!.id, { plan: { deps: { reading: 'auto' } } });
      this.store.addCards(
        doc.workstreams.map((w, k) => ({ project_id: c, kind: 'task' as const, parent_id: plan!.id, plan_ref: `${doc.file}#${w.key}`, ...pos[k]! })),
      );
    });
    this.linkOrigins(docs);
    return true;
  }

  /**
   * A plan whose doc the landed work of an idea (or a task planned as a plan) added remembers
   * that card and takes its place, while the card is on the project. Returns whether any did.
   */
  private linkOrigins(docs: PlanDoc[]): boolean {
    const origin = new Map<string, string>();
    // a card writing its doc in a plan folder outside the repository names it from the start: it is its origin once approved
    for (const r of this.store.cards.withPlanDocs(this.project.id)) if (r.landed || r.state === 'live' || r.state === 'done') for (const ref of r.plan!.planDocs!) origin.set(ref, r.id);
    if (!origin.size) return false;
    let linked = false;
    for (const r of this.store.cards.plans(this.project.id)) {
      const from = !r.from_id ? origin.get(r.plan_ref!) : undefined;
      if (!from) continue;
      this.store.cards.update(r.id, { from_id: from });
      this.takePlace(r.id, from, docs);
      this.retire(from);
      linked = true;
    }
    return linked;
  }

  /**
   * The plan goes where its idea is on the project. What the larger plan would cover moves
   * aside by as much as it outgrows the idea: the cards below it down, those beside it to the right.
   */
  private takePlace(planId: string, ideaId: string, docs: PlanDoc[]) {
    // on the idea's canvas, with its workstreams
    const ideaCanvas = this.store.cards.get(ideaId)?.canvas_id;
    if (ideaCanvas && this.store.cards.get(planId)?.canvas_id !== ideaCanvas) this.store.cards.setCanvas([planId], ideaCanvas);
    const all = toItems(this.store.cards.onProject(this.project.id), docs, this.home, undefined, this.themeNow);
    const plan = all.find((i) => i.id === planId);
    const idea = all.find((i) => i.id === ideaId);
    if (!plan || !idea) return;
    const items = this.on(idea.canvas!, all);
    const [iw, ih] = sizeOf(idea, items);
    const [pw, ph] = sizeOf(plan, items);
    const moves: [string, { x: number; y: number }][] = [[plan.id, { x: idea.x, y: idea.y }]];
    for (const i of items) {
      if (i.parent || i.id === plan.id || i.id === idea.id) continue;
      const b = boundsOf(i, items);
      if (ph > ih && b.y >= idea.y + ih && b.x < idea.x + pw && b.x + b.w > idea.x) moves.push([i.id, { x: i.x, y: i.y + ph - ih }]);
      else if (pw > iw && b.x >= idea.x + iw && b.y < idea.y + ph && b.y + b.h > idea.y) moves.push([i.id, { x: i.x + pw - iw, y: i.y }]);
    }
    this.store.transaction(() => moves.forEach(([id, at]) => this.store.cards.update(id, at)));
    // the plan stands for the idea in its group too
    if (idea.group && !plan.group) this.store.cards.setGroup([plan.id], idea.group);
  }

  /**
   * An idea or task whose plan doc is a plan goes to the archive once its worker is done: the plan
   * stands where it was and links it. Asked when the plan is linked and when the worker is done,
   * once each; put back on the project, the idea stays. Returns whether it went.
   */
  private retire(ideaId: string): boolean {
    const r = this.store.cards.get(ideaId);
    // `done`: approved without a change, its doc written in a plan folder outside the repository
    if (!r || r.deleted_at || r.archived_at || (r.state !== 'live' && r.state !== 'done') || (r.landed && r.workstation)) return false;
    if (!this.store.cards.plans(this.project.id).some((p) => p.from_id === ideaId && !p.archived_at)) return false;
    this.store.cards.update(ideaId, { archived_at: new Date().toISOString() });
    this.log(ideaId, 'state', 'obeya', r.idea?.discussion ? this.t.idea.becamePlan : this.t.idea.taskBecamePlan);
    return true;
  }
}

/**
 * The repository a plan reference belongs to: `<repo>:<path>` for the project's other repositories,
 * a bare path for its home repository. The path is in the repository, or an absolute one of a plan
 * folder outside it (`/…`, or `C:/…` on Windows, which is no repository `C`).
 */
export function repoOfRef(ref: string, home: string): string {
  const m = REPO_PREFIX.exec(ref);
  return m ? m[1]! : home;
}

/** The repository a card belongs to, by its id: the one it names, else its plan doc's, else the home repository. */
export const repoOfRow = (r: CardRow, home: string): string => r.repo ?? (r.plan_ref ? repoOfRef(r.plan_ref, home) : home);

/** A plan reference's path, without the repository before it. */
export function pathOfRef(ref: string): string {
  return ref.replace(REPO_PREFIX, '');
}

const REPO_PREFIX = /^(?![A-Za-z]:\/)([\w.-]+):/;
/** A plan reference's path in a plan folder outside the repository: absolute, `/…` or `C:/…`. */
const OUTSIDE_PATH = /^(\/|[A-Za-z]:\/)/;

/**
 * A workstream card with work not landed yet that a box in a plan folder outside the repository says
 * nothing of: the worker ticks it there at once, in no commit, so it may be ticked while the card is
 * in its pull request (before it is even open) or stopped with its branch.
 */
function tickedAhead(r: Pick<CardRow, 'plan_ref' | 'state' | 'branch'>): boolean {
  if (!r.plan_ref || !OUTSIDE_PATH.test(pathOfRef(r.plan_ref))) return false;
  return r.state === 'inPr' || (r.state === 'planned' && !!r.branch);
}

/** The project's prototypes for one change of the board: which cards they are, the items made of them so far, their ideas' titles. */
type Prototypes = {
  rows: PrototypeRef[];
  ofIdea: Map<string, PrototypeRef[]>;
  byId: Map<string, PrototypeRef>;
  items: Map<string, Item>;
  titles: Map<string, string>;
};
type PrototypeRef = ReturnType<Ideas['prototypes']>[number];

/** Visible items: plans first, their workstreams in doc order, then manual cards. */
/** A hold from now on, as stored. */
export const holdNow = (reason: 'pausing' | 'paused'): Hold => ({ reason, since: new Date().toISOString() });

/** What holds a card once its snooze ends: nothing, or the pause of a paused worker's card the owner snoozed while it waited for them. */
function awakeHold(h: Hold): Hold | null {
  return h.reason === 'snoozed' && h.waiting && h.held ? { reason: 'paused', since: h.since, held: h.held } : null;
}

/** What a card's hold shows to the UI and the agents: not what it holds for the agent, nor a limit pause's count. */
function itemHold(h: Hold): ItemHold {
  if (h.reason === 'limit') return { reason: 'limit', since: h.since, ...(h.until ? { until: h.until } : {}) };
  if (h.reason !== 'snoozed') return { reason: h.reason, since: h.since };
  const { held: _, ...shown } = h;
  return shown;
}

export function toItems(rows: CardRow[], docs: PlanDoc[], home: string, worked?: Worked, themeNow?: ThemeNow): Item[] {
  const work = (r: CardRow) => workOf(r, worked, themeNow);
  const docByFile = new Map(docs.map((d) => [d.file, d]));
  // a plan's group covers its workstreams
  const groupOf = new Map(rows.flatMap((r) => (r.kind === 'plan' && r.group_id ? [[r.id, r.group_id]] : [])));
  // what each workstream builds on, by its plan's reading of the doc
  const depsOf = new Map(rows.flatMap((r) => (r.kind === 'plan' && r.plan?.deps ? [[r.id, r.plan.deps]] : [])));
  const idOfRef = new Map(rows.flatMap((r) => (r.plan_ref ? [[r.plan_ref, r.id]] : [])));
  // a workstream is on its plan's canvas
  const canvasOf = new Map(rows.flatMap((r) => (r.kind === 'plan' ? [[r.id, r.canvas_id]] : [])));
  const plans: Item[] = [];
  const workstreams: { item: Item; order: number }[] = [];
  const manual: Item[] = [];
  for (const r of rows) {
    if (!r.plan_ref) {
      const worker = work(r);
      manual.push({
        id: r.id,
        short: r.short,
        kind: r.kind,
        state: r.state ?? 'planned',
        ...(r.need ? { need: r.need } : {}),
        title: r.title ?? '',
        body: r.body ?? '',
        x: r.x,
        y: r.y,
        source: 'manual',
        repo: r.repo ?? home,
        ...(r.canvas_id ? { canvas: r.canvas_id } : {}),
        createdAt: r.created_at,
        ...worker,
        ...(r.thread ? { thread: threadOf(r) } : {}),
        ...(r.images ? { images: JSON.parse(r.images) as string[] } : {}),
        ...(r.group_id ? { group: r.group_id } : {}),
        ...parts({
          idea: {
            ...(r.state === 'idea' ? { discussion: ideaOf(r) } : r.idea?.discussion ? decided(r) : {}),
            ...(r.idea?.becomesPlan ? { becomesPlan: true } : {}),
            ...(r.idea?.prototypeOf ? { prototypeOf: r.idea.prototypeOf, ...prototypeOf(r) } : {}),
            ...(r.idea?.builtOn ? { builtOn: r.idea.builtOn } : {}),
            ...(r.retro ? { retro: r.retro } : {}),
            ...(r.idea?.proposal ? (r.state === 'proposal' || storedProposal(r)?.merge ? { proposal: storedProposal(r)! } : { proposed: true as const, ...supersededOf(r) }) : {}),
            ...newRepoOf(r),
          },
          labels: labelsOf(r),
        }, worker),
      });
      continue;
    }
    const hash = r.plan_ref.indexOf('#');
    const doc = docByFile.get(hash < 0 ? r.plan_ref : r.plan_ref.slice(0, hash));
    if (!doc) continue;
    if (hash < 0) {
      plans.push({
        id: r.id,
        short: r.short,
        kind: 'plan',
        state: 'planned',
        title: doc.title,
        body: '',
        x: r.x,
        y: r.y,
        source: 'plan',
        repo: repoOfRef(doc.file, home),
        ...(r.canvas_id ? { canvas: r.canvas_id } : {}),
        plan: {
          file: doc.file,
          goal: doc.goal,
          ...(depsOf.get(r.id)?.reading ? { arranging: true as const } : {}),
          ...(r.plan?.collapsed ? { collapsed: true as const } : {}),
          ...(r.from_id ? { origin: r.from_id } : {}),
        },
        ...(r.group_id ? { group: r.group_id } : {}),
        ...parts({ labels: labelsOf(r) }),
      });
      continue;
    }
    const key = r.plan_ref.slice(hash + 1);
    const order = doc.workstreams.findIndex((w) => w.key === key);
    const w = doc.workstreams[order];
    if (!w || !r.parent_id) continue;
    const derived = w.done ? 'live' : w.inReview ? 'inPr' : 'planned';
    // work in progress wins over the doc: a ticked-off workstream may still wait for its merge, and so
    // does a stopped one whose box a plan folder outside the repository ticked
    const state = r.state && (ACTIVE.includes(r.state) || tickedAhead(r)) ? r.state : derived === 'live' ? 'live' : (r.state ?? derived);
    // what landed of a workstream planned again, also while a new run does the rest; once that lands, the card is live
    const shipped = (state === 'planned' || ACTIVE.includes(state)) && r.shipped ? (JSON.parse(r.shipped) as Shipped) : null;
    const buildsOn = (depsOf.get(r.parent_id)?.on?.[key] ?? []).flatMap((k) => idOfRef.get(`${doc.file}#${k}`) ?? []);
    const worker = work(r);
    workstreams.push({
      order,
      item: {
        id: r.id,
        short: r.short,
        kind: r.kind,
        state,
        ...(r.need ? { need: r.need } : {}),
        title: w.title,
        body: w.body,
        x: r.x,
        y: r.y,
        parent: r.parent_id,
        source: 'plan',
        repo: repoOfRef(r.plan_ref, home),
        ...((canvasOf.get(r.parent_id) ?? r.canvas_id) ? { canvas: canvasOf.get(r.parent_id) ?? r.canvas_id } : {}),
        ...worker,
        ...(groupOf.get(r.parent_id) ? { group: groupOf.get(r.parent_id)! } : {}),
        ...parts({
          review: shipped ? { landedPart: { ...(shipped.commit ? { commit: shipped.commit } : {}), ...(shipped.pr ? { pr: shipped.pr } : {}) } } : {},
          idea: r.idea?.builtOn ? { builtOn: r.idea.builtOn } : {},
          plan: { ...(w.label ? { label: w.label } : {}), ...(buildsOn.length ? { buildsOn } : {}) },
          labels: labelsOf(r),
        }, worker),
      },
    });
  }
  const shown = new Set(plans.map((p) => p.id));
  const kids = workstreams.filter((w) => shown.has(w.item.parent!));
  const ordered = plans.flatMap((p) =>
    kids
      .filter((k) => k.item.parent === p.id)
      .sort((a, b) => a.order - b.order)
      .map((k) => k.item),
  );
  // a card merged with a proposal shows within it, until the owner decides
  const into = new Map(manual.flatMap((i) => (i.idea?.proposal?.merge ? [[i.idea.proposal.merge.with, i.id] as const] : [])));
  return [...plans, ...ordered, ...(into.size ? manual.map((i) => (into.has(i.id) ? withPart(i, 'idea', { mergingInto: into.get(i.id)! }) : i)) : manual)];
}

/**
 * An item's parts as built from their fields, each only when the card has any of it; what `also`
 * (a card's `work`) has of the same part goes into it too.
 */
function parts(p: Partial<{ [K in ItemPart]: NonNullable<Item[K]> }>, also: Partial<Item> = {}): Partial<Pick<Item, ItemPart>> {
  const keys = new Set([...Object.keys(p), ...Object.keys(also).filter((k) => ITEM_PARTS.includes(k as ItemPart))] as ItemPart[]);
  return Object.fromEntries([...keys].flatMap((k) => {
    const made = part({ ...also[k], ...p[k] });
    return made ? [[k, made]] : [];
  }));
}

/** The card's labels that are set, and which of them are Seismic's suggestion. */
const labelsOf = (r: CardRow): ItemLabels => {
  const valid = LABELS.filter((l) => isLabelValue(l, r.labels[l]?.value));
  const set = Object.fromEntries(valid.map((l) => [l, r.labels[l]!.value])) as Labels;
  const suggested = valid.filter((l) => r.labels[l]!.by === 'suggestion');
  return { ...set, ...(suggested.length ? { suggested } : {}) };
};

/** How long a workstream stays away from a doc in a plan folder outside the repository before its card leaves the plan: such a doc is written in place, an item moved in two edits. */
export const LEAVE_AFTER_MS = 5 * 60_000;

/** Whether a plan reference is to a doc in a plan folder outside the repository. */
const outsideRef = (ref: string) => OUTSIDE_PATH.test(pathOfRef(ref));

/**
 * The doc's workstream that a card keyed `key` had under another key: the doc dropped or added a
 * sibling, which changes whether a code is read as a label or a label needs its title. Where it is
 * known what the workstream was (`was`), the one with its label and title (a label alone may be
 * another's now); else the only one that would have had `key`.
 */
function sameWorkstream(key: string, doc: PlanDoc, was?: Pick<Workstream, 'label' | 'title'>): Workstream | undefined {
  const its = was ? workstreamAliases(was, true) : [];
  const same = doc.workstreams.filter((w) => (was ? workstreamAliases(w).some((k) => its.includes(k)) : workstreamAliases(w).includes(key)));
  return same.length === 1 ? same[0] : undefined;
}

/** The workstream key of a plan reference (`<doc>#<key>`); null for a plan's or a card's without one. */
const keyOfRef = (ref: string | null): string | null => (ref?.includes('#') ? ref.slice(ref.indexOf('#') + 1) : null);

/** Whether an agent worked on the card: it was started, or its work landed or ended. */
const worked = (r: CardRow) => !!(r.session_id || r.branch || r.shipped || r.landed || (r.state && r.state !== 'planned'));

/** Whether an agent is at work on the card: in progress, or finishing after the landing. */
const atWork = (r: CardRow) => !!((r.state && ACTIVE.includes(r.state)) || (r.landed && r.workstation));

/** Whether a branch named after a title (`branchName`, its `slug`) was named after the workstream's, with or without its label before it. */
const named = (w: Pick<Workstream, 'label' | 'title'>, slug: string) =>
  [w.title, withoutReference(w.title), ...(w.label ? [`${w.label} ${w.title}`] : [])].some((t) => branchName(t, '000000').slice(CARD_BRANCH.length, -7) === slug);

/** Where a card goes below the card with bounds `b`: the `n`th of those there, each beside the one before. */
const below = (b: Bounds, n = 0) => ({ x: b.x + 35 + n * (CARD_SIZE.task[0] + GAP), y: b.y + b.h + 60 });

/** What is stored of a repository to create for a card: the target, and once Seismic made it, `made`. */
export type StoredNewRepo = NewRepo & { made?: true; none?: true };

/** A card's new repository while it is still to be made, before work on the card begins. */
function newRepoOf(r: CardRow): Pick<ItemIdea, 'newRepo'> {
  const n = r.idea?.newRepo;
  if (!n || n.made || n.none || (r.state !== 'idea' && (r.state ?? 'planned') !== 'planned') || r.workstation) return {};
  const { made: _, ...newRepo } = n;
  return { newRepo };
}

/** What `toItems` made of cards' rows: the fields a worker adds, by card, with the row they came from. */
type Worked = Map<string, { row: CardRow; work: Partial<Item> }>;

/** The fields a worker adds to the card, as `worked` holds them while its row is the same. */
function workOf(r: CardRow, worked?: Worked, themeNow?: ThemeNow): Partial<Item> {
  const had = worked?.get(r.id);
  if (had && sameRow(had.row, r)) return had.work;
  const made = work(r, themeNow);
  worked?.set(r.id, { row: r, work: made });
  return made;
}

const sameRow = (a: CardRow, b: CardRow) => {
  for (const k in b) if (a[k as keyof CardRow] !== b[k as keyof CardRow]) return false;
  return true;
};

/** A pull request of the card as the card shows it. */
const pullRequest = (pr: PrState): PullRequest => ({
  url: pr.url!,
  number: pr.number!,
  ...(pr.repo ? { repo: pr.repo } : {}),
  ...(pr.merged ? { merged: true } : {}),
  ...(pr.closed ? { closed: true } : {}),
  checks: pr.checks ?? [],
  conflict: !!pr.conflictHead,
  ...(pr.readyHead && (pr.mergeError || pr.held || pr.manual) ? { ready: true, ...(pr.mergeError ? { mergeError: pr.mergeError } : {}), ...(pr.held ? { held: pr.held } : {}), ...(pr.manual ? { manual: true } : {}) } : {}),
  ...(pr.waits?.length && !pr.merged && !pr.closed ? { waits: pr.waits } : {}),
  ...(pr.review?.length ? { review: pr.review } : {}),
});

/** The fields a worker adds to a card. */
function work(r: CardRow, themeNow?: ThemeNow): Partial<Item> {
  const detail = r.detail ? (JSON.parse(r.detail) as { question?: Item['question']; summary?: string; noChange?: boolean; lands?: ItemReview['lands']; modelsUnchanged?: string; answering?: boolean; answered?: boolean; blocked?: ItemReview['blocked']; conflict?: boolean }) : {};
  const ended = !!r.idea?.prototypeOf && !!storedPrototype(r).end && !!detail.summary;
  const demo = r.demo?.latest ? shownDemo(r.demo.latest) : undefined;
  const earlier = demo ? earlierDemos(r) : [];
  const handed = r.need === 'review' || r.need === 'demo';
  const answering = detail.answering && handed;
  const storedScope = r.scope ? JSON.parse(r.scope) as { files: string[]; duplicateCheck?: { title: string; body: string; ids?: string[]; dismissed?: boolean } } : undefined;
  const scope = storedScope?.files;
  const pr = r.review?.pr;
  const contribution = contributionOf(r);
  const codeReview = codeReviewOf(r);
  const share = shareOf(r, themeNow);
  const notOnApproval = r.demo?.share?.notOnApproval;
  const tags = demo && !r.idea?.prototypeOf ? pageTagsOf(r) : {};
  const landed = r.landed ? (JSON.parse(r.landed) as { followUp?: boolean; needsClone?: boolean; resolve?: object }) : null;
  return {
    updatedAt: r.updated_at,
    ...(scope?.length ? { scope } : {}),
    ...(r.state === 'planned' && storedScope?.duplicateCheck && !storedScope.duplicateCheck.dismissed && storedScope.duplicateCheck.title === r.title && storedScope.duplicateCheck.body === r.body && storedScope.duplicateCheck.ids?.length ? { possibleDuplicates: storedScope.duplicateCheck.ids } : {}),
    ...(r.queue && (r.state ?? 'planned') === 'planned' ? { queue: JSON.parse(r.queue) as Item['queue'] } : {}),
    ...(detail.question && r.need === 'question' ? { question: detail.question } : {}),
    // a demo's question is as open as a worker's: the owner answers it on the card or by voice
    ...(demo?.question && !demo.answer && r.need === 'demo' ? { question: { text: demo.question, options: demo.options ?? [], ...(demo.multiple ? { multiple: true } : {}), ...(demo.pick ? { pick: demo.pick } : {}) } } : {}),
    ...(r.from_id ? { from: r.from_id } : {}),
    ...(r.hold ? { hold: itemHold(r.hold) } : {}),
    ...parts({
      agent: {
        ...((r.session_id || r.queue) && r.agent_setting ? { workerSetting: JSON.parse(r.agent_setting) as ItemAgent['workerSetting'] } : {}),
        ...(r.status_line ? { statusLine: r.status_line } : {}),
        ...(r.branch ? { branch: r.branch } : {}),
        ...(r.stopped_at && r.state === 'planned' && r.branch ? { stoppedAt: JSON.parse(r.stopped_at) as StoppedAt } : {}),
        // a workstation on another machine as ssh and scp write it
        ...(r.workstation ? { workstation: r.workstation.replace(/^ssh:\/\/([^/]+)/, '$1:') } : {}),
        ...(r.kept_in ? { keptIn: r.kept_in.replace(/^ssh:\/\/([^/]+)/, '$1:') } : {}),
        ...(landed && (r.workstation || landed.needsClone) ? { finishing: true, ...(landed.followUp && !landed.resolve ? { followUp: true } : {}), ...(landed.needsClone && !r.workstation ? { waitsForClone: true as const } : {}) } : {}),
        ...(r.app && r.workstation && !r.parked ? { app: r.app } : {}),
      },
      review: {
        ...(pr?.url ? { pr: pullRequest(pr) } : {}),
        ...(pr?.more?.some((m) => m.url) ? { morePrs: pr.more.filter((m) => m.url).map(pullRequest) } : {}),
        ...(contribution ? { contribution: { url: contribution.url, number: contribution.number, author: contribution.author, title: contribution.title, canModify: contribution.canModify, ...(contribution.results ? { results: contribution.results } : {}), ...(contribution.findings ? { findings: contribution.findings } : {}), ...(contribution.requested ? { requested: contribution.requested } : {}), ...(contribution.held ? { held: { body: contribution.held.body, commits: contribution.held.commits, asks: contribution.held.asks } } : {}), ...(contribution.clash ? { clash: contribution.clash } : {}) } } : {}),
        ...(codeReview ? { codeReview: shownCodeReview(codeReview, r.review?.items ?? []) } : {}),
        // a prototype that ended keeps the summary it was handed over with
        ...((detail.summary && handed) || ended ? { summary: detail.summary } : {}),
        ...(answering ? { answering: true as const } : {}),
        ...(detail.answered && !answering && handed ? { answered: true as const } : {}),
        // approved work is held for its next handover while the card is at work; on a waiting card it is landing
        ...(r.approved_at && r.state === 'waiting' ? { landing: true as const } : {}),
        ...(detail.noChange && handed ? { noChange: true } : {}),
        ...(detail.lands && handed ? { lands: detail.lands } : {}),
        ...(detail.conflict && r.approved_at && r.state === 'working' ? { resolvingConflicts: true as const } : {}),
        ...(detail.blocked && handed && !r.approved_at ? { blocked: detail.blocked } : {}),
        ...(detail.modelsUnchanged && handed ? { modelsUnchanged: detail.modelsUnchanged } : {}),
      },
      demo: {
        ...(r.demo?.held ? { held: r.demo.held.map((h) => h.id) } : {}),
        ...(demo ? { latest: demo } : {}),
        ...(earlier.length ? { earlier } : {}),
        ...(r.demo?.files ? { files: r.demo.files } : {}),
        ...(share ? { share } : {}),
        ...(notOnApproval ? { notOnApproval } : {}),
        ...(Object.keys(tags).length ? { tags } : {}),
      },
    }),
  };
}

/** The card's shared page as the UI sees it: none when it is not shared and not about to be. */
function shareOf(r: CardRow, themeNow?: ThemeNow): ItemDemo['share'] {
  const s = r.demo?.share ?? null;
  if (!s || (!s.state && !s.url)) return undefined;
  // asked of a page at rest alone, so the cards never shared ask nothing
  const theme = s.url && !s.state ? themeNow?.(r) : undefined;
  // the newest demo of a handover: drafts shown with a question since are not what the page lacks
  const latest = r.demo?.latest ? [...storedDemos(r), r.demo.latest].findLast((d) => !d.asked) : undefined;
  const shared = s.url ? sharedDemos(s) : [];
  // the card's demos on the page, by their handovers
  const on = cardDemos(r).flatMap((d) => (d.handover !== undefined && shared.some((x) => sameDemo(x, d)) ? [d.handover] : []));
  const stale = !!s.url && !!latest && !shared.some((x) => sameDemo(x, latest));
  const outdated = reshareable(r, theme);
  return {
    state: s.refresh ? 'shared' : (s.state ?? 'shared'),
    ...(s.url ? { url: s.url } : {}),
    ...(on.length ? { on } : {}),
    ...(stale ? { stale: true } : {}),
    // shown with each version on the page; the latest, not on it, brings the changes with "Replace on the page" or "Add to the page"
    ...(outdated.length ? { outdated } : {}),
    ...((s.unlisted || s.personal) && s.token ? { unlisted: true as const } : {}),
  };
}

/**
 * A proposal's text with its questions, once the owner took it: those they answered (by its options
 * or in their own words) as decided, the others as still open, for the agent
 * that takes the card on.
 */
export function withQuestions(text: string, questions: Question[], picks: string[][], t: Messages): string {
  // each on one line: an own answer must not add lines of its own to the text
  const chosen = (i: number) => (Array.isArray(picks[i]) ? picks[i] : []).filter((o) => typeof o === 'string' && o.trim()).map((o) => o.replace(/\s+/g, ' ').trim());
  const decided = questions.flatMap((q, i) => (chosen(i).length ? [`- ${q.text} → ${chosen(i).join(', ')}`] : []));
  const open = questions.flatMap((q, i) => (chosen(i).length ? [] : [`- ${q.text}${q.options.length ? ` (${q.options.join(' / ')})` : ''}`]));
  return [text.trim(), decided.length ? `${t.decided}:\n${decided.join('\n')}` : '', open.length ? `${t.openQuestions}:\n${open.join('\n')}` : '']
    .filter(Boolean)
    .join('\n\n');
}

/** What is stored of a prototype: how it ended, once it did, and its worker's proposal to build the idea on it. */
export interface StoredPrototype {
  /** The planned variant it shows. */
  variant?: string;
  end?: 'discarded' | 'built';
  /** Built for a workstream of the plan its idea became: that workstream, as the owner reads it. */
  into?: string;
  proposal?: string;
}

const storedPrototype = (r: CardRow): StoredPrototype => r.idea?.prototype ?? {};

/** A prototype's variant, end and proposal. */
function prototypeOf(r: CardRow): Partial<ItemIdea> {
  const p = storedPrototype(r);
  return { ...(p.variant ? { variant: p.variant } : {}), ...(p.end ? { prototypeEnd: p.end } : {}), ...(p.into ? { builtInto: p.into } : {}), ...(p.proposal && !p.end ? { buildProposal: p.proposal } : {}) };
}

/** What is stored of an idea; `thinking` while its agent works on a reply, `yourTurn` once it replied. */
export interface StoredIdea {
  status: Idea['status'];
  brief: string;
  thinking?: boolean;
  /** "Build it like this" waits for the reply its agent works on; questions in it call the building off. */
  buildAfterReply?: boolean;
  yourTurn?: boolean;
  questions?: Question[];
  next?: NextStep;
  /** The prototypes the brief plans, as the agent last set them. */
  variants?: PlannedPrototype[];
  /** The brief's mocks, as the agent last set them. */
  mocks?: Mock[];
  /** The settled part "Teilaufgabe abtrennen" builds, as the agent last marked it. */
  split?: SettledPart;
  /** Messages a turn ended before answering (the idea parked or dropped, an error, a restart); they go to the agent first next time. */
  unread?: Unread;
}

/** A message to an idea's agent: its text and the files of its screenshots. */
export interface Message {
  text: string;
  images: string[];
  /** The lines of the card's log with the owner's words it carries: unread until the agent takes it in. */
  said: number[];
}

/** A Question card's thread as stored: the exchange it started with, and its agent's turn. */
export interface StoredThread {
  talk: number;
  /** Its agent is reading, for what the owner asked on the card. */
  thinking?: boolean;
  /**
   * What the owner asked that the agent has not answered yet: behind a running turn, or left by a
   * restart; `talk`: asked in Seismic's sheet, whose exchange gets the answer too.
   */
  pending?: (Message & { talk?: number })[];
  answers: number;
  files: number;
}

export interface Unread {
  why: 'parked' | 'dropped' | 'error' | 'restart' | 'paused';
  messages: Message[];
}

/** The owner's words said one after the other while a proposal was reworked, as one rework's. */
const merged = (said: Revising[]): Revising => ({
  words: said.map((r) => r.words).join('\n\n'),
  ...(said.some((r) => r.spoken) ? { spoken: true } : {}),
  said: said.flatMap((r) => r.said ?? []),
  ...(said.some((r) => r.images?.length) ? { images: said.flatMap((r) => r.images ?? []) } : {}),
});

const storedProposal = (r: CardRow): Proposal | undefined => r.idea?.proposal ?? undefined;

/** The mark of an accepted proposal its agent withdrew or replaced, while the card is not finished. */
const supersededOf = (r: CardRow): { superseded?: Superseded } => {
  const superseded = storedProposal(r)?.superseded;
  return superseded && !r.archived_at && !finished(r.state ?? 'planned') ? { superseded } : {};
};

/** A title as an agent may name it: without case, quotes, markdown marks or extra spaces. */
export const titleKey = (title: string) =>
  title
    .toLowerCase()
    .replace(/[„“”"'‚‘’«»*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** What became of an agent's own proposal it withdrew or replaced (`Board.retract`). */
export type Retracted =
  /** gone: it was still open and went; marked: accepted, it carries the mark now; finished: done or archived, it stays; dismissed: the owner had dismissed it; removed: the owner had deleted it; already: withdrawn before. */
  | { kind: 'gone' | 'marked' | 'finished' | 'dismissed' | 'removed' | 'already'; title: string; state: CardState }
  /** No proposal of the agent's has that title: those it has. */
  | { kind: 'unknown'; mine: { title: string; state: CardState; gone: boolean }[] };

/** A proposal as an agent made it: whether it is an idea, why, and at most five questions. */
const proposalOf = (p: { reason?: string; idea?: boolean; questions?: Question[]; startAt?: string }): Proposal => ({
  ...(p.idea ? { idea: true } : {}),
  ...(p.reason?.trim() ? { reason: p.reason.trim().slice(0, 2000) } : {}),
  questions: (p.questions ?? []).slice(0, 5),
  ...(p.startAt ? { startAt: p.startAt } : {}),
});

const toDecision = (d: DecisionRow): Decision => ({ id: d.id, cardId: d.cardId, question: d.question, answer: d.answer, by: d.by, at: d.at });

/** A card that was an idea, as decided: the brief with its mocks. */
function decided(r: CardRow): Pick<ItemIdea, 'brief' | 'mocks'> {
  const i = r.idea!.discussion!;
  return { brief: i.brief, ...(i.mocks?.length ? { mocks: i.mocks } : {}) };
}

function threadOf(r: CardRow): Thread {
  const t = JSON.parse(r.thread!) as StoredThread;
  return { talk: t.talk, ...(t.thinking ? { thinking: true } : {}), answers: t.answers, files: t.files };
}

function ideaOf(r: CardRow): Idea {
  const i: StoredIdea = r.idea?.discussion ?? { status: 'open', brief: '' };
  return { status: i.status, brief: i.brief, thinking: !!i.thinking, ...(i.buildAfterReply ? { buildAfterReply: true as const } : {}), yourTurn: !!i.yourTurn, questions: i.questions ?? [], ...(i.next ? { next: i.next } : {}), variants: i.variants ?? [], mocks: i.mocks ?? [], ...(i.split ? { split: i.split } : {}) };
}

function checkPreference(v: unknown): string {
  if (typeof v !== 'string' || !v.trim() || v.length > 500) throw new BadRequest('emptyText', 'a preference is a non-empty string of at most 500 characters');
  return v.trim();
}

const toCanvas = (c: CanvasRow): Canvas => ({ id: c.id, name: c.name, ...(c.icon ? { icon: c.icon } : {}) });

const toGroup = (g: GroupRow): Group => ({ id: g.id, name: g.name, hue: g.hue, canvas: g.canvasId });

/** Group colours, apart from each other and from the states' colours on the cards; then the golden angle. */
const HUES = [200, 28, 150, 280, 345, 55, 175, 100];
export function nextHue(used: number[]): number {
  const free = HUES.find((h) => !used.includes(h));
  return free ?? Math.round((used.length * 137.508) % 360);
}

function checkText(v: unknown, name: string, max: number) {
  if (typeof v !== 'string' || v.length > max) throw new BadRequest('invalid', `${name} must be a string of at most ${max} characters`);
}

function checkNumber(v: unknown, name: string) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new BadRequest('invalid', `${name} must be a finite number`);
}

/** A card the owner may draw dependencies to and from: not a plan nor one of its workstreams. */
const connectable = (i: Item) => i.source !== 'plan' && i.kind !== 'plan';

/**
 * Whether an arrow from `from` to `to` would close a cycle with the arrows between the cards shown
 * (`edges`; a deleted or archived card's count for nothing) and the waits Seismic inferred.
 */
function closesCycle(from: string, to: string, edges: [string, string][], items: Item[]): boolean {
  const shown = new Set(items.map((i) => i.id));
  const all = [
    ...edges.filter(([a, b]) => shown.has(a) && shown.has(b)),
    ...items.flatMap((i): [string, string][] => [...(i.plan?.buildsOn ?? []), ...(i.queue && 'behind' in i.queue ? i.queue.behind : []), ...(snoozeOf(i)?.on ? [snoozeOf(i)!.on!.card] : [])].map((before) => [before, i.id])),
  ];
  const seen = new Set<string>();
  const visit = (id: string): boolean => {
    if (id === from) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return all.some(([a, b]) => a === id && visit(b));
  };
  return visit(to);
}
