// Shapes shared by the server and the UI.

import type { DemoSettings, NarrationLanguage, VoiceKind } from '../../plugin/skills/demo/lib/settings.ts';
import type { HandoverArtifact } from '../../plugin/skills/demo/lib/artifacts.ts';
import type { SetupId, SetupItem } from '../../plugin/skills/demo/lib/setup.ts';
import type { CardFile } from './files';
import type { Category, Complexity, Label, Priority, Subcategory, SuggestSettings } from './labels';
import type { Language } from './locale';
import { MESSAGES } from './messages';
import type { OutdatedBy } from './page-changes';
import type { NotAPlan } from './plan-doc';
import type { Wish } from './wish';

export type { DemoSettings, NarrationLanguage, VoiceKind } from '../../plugin/skills/demo/lib/settings.ts';
export type { HandoverArtifact } from '../../plugin/skills/demo/lib/artifacts.ts';
export type { Language } from './locale';
export { PRIORITIES, type Priority } from './labels';
export type { SetupCheck, SetupId, SetupItem } from '../../plugin/skills/demo/lib/setup.ts';

/**
 * How Seismic hears speech: Parakeet (NVIDIA's Parakeet TDT 0.6B v3, int8, through onnx-asr and ONNX
 * Runtime on the CPU), on every platform; or Whisper (mlx-whisper on Apple Silicon, faster-whisper
 * elsewhere).
 */
export type ListenBackend = 'parakeet' | 'mlx' | 'faster';

/**
 * `question`: a thread of looked-up answers the owner moved onto a card of its own, with the agent
 * that looked them up; it holds answers, no work, so its state is `done` until the owner archives it.
 */
export type CardKind = 'task' | 'plan' | 'question';

export const STATES = ['idea', 'proposal', 'planned', 'working', 'waiting', 'approved', 'inPr', 'live', 'done'] as const;
export type CardState = (typeof STATES)[number];

/** A card whose work is over: `live` once it landed, `done` when it needed no change to the code (a demo, an analysis). */
export const finished = (s: CardState) => s === 'live' || s === 'done';
/** A card an agent worked on until the owner stopped it: planned again, its branch stays the card's. */
export const stopped = (i: Pick<Item, 'state' | 'branch'>) => i.state === 'planned' && !!i.branch;
/**
 * A stopped card of the owner's the archive may take: nothing waits to start it, and its workspace
 * holds no work (a branch with commits or changes keeps it, and archiving would leave that work
 * unseen in a clone).
 */
export const stoppedArchivable = (i: Pick<Item, 'state' | 'branch' | 'source' | 'queue' | 'workspace' | 'keptIn' | 'prototypeOf' | 'kind'>) =>
  stopped(i) && i.source === 'manual' && i.kind === 'task' && !i.prototypeOf && !i.queue && !i.workspace && !i.keptIn;
/** A finished card of the owner's whose agent is done: the archive may take it. */
export const finishedArchivable = (i: Pick<Item, 'state' | 'source' | 'finishing'>) => finished(i.state) && i.source === 'manual' && !i.finishing;
/** A finished card whose agent still works: after the landing, or answering a follow-up question. */
export const finishingUp = (i: Pick<Item, 'state' | 'finishing'>) => !!i.finishing && finished(i.state);
/**
 * Whether the card's agent is working on something right now, so that the owner can pause it: a
 * Question card's agent reading, an idea's agent working on its reply, a worker in a turn (whatever
 * the card's state: at work, taking in the owner's words on its handover, on its pull request, after
 * the landing). An idle agent is no such agent: there is nothing running to pause.
 */
/** A piece of an agent's background work as the agent described it (`Run the test suite`), and since when it runs (milliseconds). */
export interface BackgroundTask {
  description: string;
  since: number;
}

/** A card's worker in a turn: its background work that runs, and whether the turn itself ended and only waits for that work to wake it (`over`). */
export interface WorkerTurn {
  tasks: BackgroundTask[];
  over: boolean;
  /** What the worker does, for a card's own worker. */
  doing?: AgentDoing;
  /** No turn at all: the worker ended its turn for a restart that is due, and goes on once it happened. */
  restartPaused?: true;
}

/**
 * What a card's worker is doing in its turn, read from its steps: at work, thinking (a long while
 * without a step), debugging (a step of its failed), or at a stage of its demo.
 */
export type AgentDoing = 'working' | 'building' | 'thinking' | 'debugging' | 'preparingDemo' | 'recordingDemo' | 'finalizingDemo';

/** Whether the worker is at a stage of its demo, which its card shows in green. */
export const demoStage = (d: AgentDoing) => d.endsWith('Demo');

/** The card's agent is snoozed (by itself or the owner, "Later"): it stops until its time, and neither pauses nor resumes meanwhile. */
const snoozedAway = (i: Pick<Item, 'snoozed'>) => !!i.snoozed && !i.snoozed.waiting;

/** The card's agent runs a turn the owner can pause at once (the pause on the bubble of its turn), also while it is about to pause at a safe point. */
export const pausableNow = (i: Pick<Item, 'kind' | 'state' | 'idea' | 'thread' | 'inTurn' | 'paused' | 'snoozed'>) =>
  !i.paused && !snoozedAway(i) && (i.kind === 'question' ? !!i.thread?.thinking : i.state === 'idea' && i.idea ? i.idea.thinking : !!i.inTurn);

/** The card's agent is at work and can be paused, at a safe point (the card's pause, the canvas's) or at once; not one about to pause already. */
export const pausable = (i: Pick<Item, 'kind' | 'state' | 'idea' | 'thread' | 'inTurn' | 'paused' | 'pausing' | 'snoozed'>) => !i.pausing && pausableNow(i);

/** The owner paused the card's agent, and it waits for them to resume it; a snoozed one, which holds what comes for it as a paused one does, waits for its time instead. */
export const resumable = (i: Pick<Item, 'paused' | 'snoozed'>) => !!i.paused && !snoozedAway(i);

/** The card's agent is paused, or about to pause at a safe point: what the card's ▶ and the canvas's resume let go on. */
export const halted = (i: Pick<Item, 'paused' | 'pausing' | 'snoozed'>) => (!!i.paused || !!i.pausing) && !snoozedAway(i);

/**
 * A finished card an agent worked on, on the canvas, with no agent on it now: what the owner asks
 * about it resumes the agent that did the work, which answers and ends again.
 */
export const askable = (i: Pick<Item, 'state' | 'branch' | 'prototypeOf' | 'archivedAt' | 'finishing'>) =>
  finished(i.state) && !!i.branch && !i.prototypeOf && !i.archivedAt && !i.finishing;

/**
 * How many cards of each group are still to be done: not finished, not archived, not a dropped
 * idea. A plan counts by its workstreams, not as a card of its own.
 */
export function openPerGroup(items: Item[]): Map<string, number> {
  const open = new Map<string, number>();
  for (const i of items)
    if (i.group && i.kind === 'task' && !finished(i.state) && !i.archivedAt && i.idea?.status !== 'dropped') open.set(i.group, (open.get(i.group) ?? 0) + 1);
  return open;
}

/** A workstream a prototype can be built for: nobody has worked on it yet, and the Koordinator does not hold it. */
export const buildableOn = (i: Item) => i.state === 'planned' && !i.branch && !i.queue;

/**
 * A planned task nobody has worked on yet, which the Koordinator may merge with others or delete:
 * no branch, no workspace, not with the Koordinator unless it waits there behind other cards (a
 * review's follow-up task waiting for the PR's merge, say), and no prototype nor becoming a plan.
 */
export const untouched = (i: Item) =>
  i.kind === 'task' && i.source === 'manual' && i.state === 'planned' && !i.branch && !i.workspace && (!i.queue || 'behind' in i.queue) && !i.prototypeOf && !i.becomesPlan;

/** Progress decides which card dissolves. Unstarted pairs still combine their text. */
export const mergeRank = (i: Item): number => i.archivedAt ? 4 : finished(i.state) ? 3 : i.state === 'proposal' ? 0 : untouched(i) ? 1 : 2;

/** Only an unworked task or proposal can start a merge and dissolve. */
export const canMergeFrom = (i: Item) =>
  i.kind === 'task' && !i.parent && !i.archivedAt && !i.mergingInto && !i.snoozed && !i.repoDown && !i.prototypeOf && !i.becomesPlan &&
  !i.proposal?.merge && !i.proposal?.idea && !i.proposal?.revising && !i.proposal?.acceptAfterRevision &&
  (untouched(i) || (i.state === 'proposal' && !i.branch && !i.workspace));

/** The read-only agent is still comparing the cards. */
export const merging = (i: Pick<Item, 'state' | 'proposal'>) => !!i.proposal?.merge && i.proposal.merge.task === undefined && i.proposal.merge.failed === undefined;

/** A merge starts at an unworked card; its partner may have reached any stage. */
export const mergeableWith = (p: Item, i: Item) =>
  canMergeFrom(p) && i.id !== p.id && i.kind === 'task' && i.state !== 'idea' && !i.parent &&
  !i.mergingInto && !i.snoozed && !i.repoDown && !i.prototypeOf && !i.becomesPlan &&
  !i.proposal?.idea && !i.proposal?.merge && !i.proposal?.revising && !i.proposal?.acceptAfterRevision;

/**
 * A task of the owner's that can still be planned as a plan, as an idea can: planned, nobody has
 * worked on it, the Koordinator does not hold it, and it is no prototype nor decided as a plan already.
 */
export const plannableAsPlan = (i: Item) =>
  i.source === 'manual' && i.kind === 'task' && buildableOn(i) && !i.prototypeOf && !i.becomesPlan;

/**
 * The workstream of a plan, among `items`, that its idea's prototypes are built for: the one
 * nobody has started that mentions prototypes, as the plan doc's worker writes it. None when no
 * such workstream, or several, leave it to the owner.
 */
export function prototypeWorkstream(items: Item[], planId: string): Item | undefined {
  const named = items.filter((i) => i.parent === planId && buildableOn(i) && /prototyp/i.test(`${i.title}\n${i.body}`));
  return named.length === 1 ? named[0] : undefined;
}

/** What a `waiting` card waits for: `demo` a handover with a demo, `review` one without. */
export type Need = 'demo' | 'question' | 'review';

/** A question an agent asks the owner, with answer options to choose from when it has them. */
export interface Question {
  text: string;
  options: string[];
  /** Several options may be chosen together. */
  multiple?: boolean;
  /** What the asking agent would pick if it had to decide: some of the options, and why. */
  pick?: { options: string[]; why: string };
  /** Seismic asks for a worker that is stuck (its turn failed, or ended twice without a handover), not the worker. */
  stuck?: true;
}

/** A question as its card's log holds it: the text, then one line per option. */
export const formatQuestion = (q: Question, language: Language): string =>
  q.options.length ? `${q.text}${q.multiple ? ` (${MESSAGES[language].multiple})` : ''}\n${q.options.map((o) => `– ${o}`).join('\n')}` : q.text;

/** Its worker handed the work over: the card waits for the owner's approval or feedback. */
export const handedOver = (i: Pick<Item, 'state' | 'need'>) => i.state === 'waiting' && (i.need === 'demo' || i.need === 'review');

/** Its worker takes in the owner's words on its handover: meanwhile the card is at work, and still waits for approval. */
export const answering = (i: Pick<Item, 'state' | 'need' | 'answering'>) => handedOver(i) && !!i.answering;

/**
 * Whether an agent hears what the owner says or types on the card when it is open: its worker (at
 * work, waiting, in a pull request, finishing after the landing, or one a question resumes on a
 * finished card), an idea's exploration agent, or the agent that reworks a proposal (while it
 * does, the words wait for the rework after it). The words then go straight to it; on any other
 * card they go to the Koordinator.
 */
export const agentListens = (i: Pick<Item, 'kind' | 'state' | 'branch' | 'prototypeOf' | 'archivedAt' | 'finishing'>) =>
  !i.archivedAt && (i.kind === 'question' || i.state === 'idea' || i.state === 'proposal' || i.state === 'working' || i.state === 'waiting' || i.state === 'inPr' || !!i.finishing || askable(i));

/**
 * A card the owner left without a title but with a task (text or screenshots): Seismic names it from
 * that (`Koordinator.name`). Without either it is an empty card, dropped when closed.
 */
export const nameless = (i: Pick<Item, 'kind' | 'title' | 'body' | 'images'>) => i.kind !== 'plan' && !i.title.trim() && (!!i.body.trim() || !!i.images?.length);

/** A title from a task's first words, on a card not named yet, and when Seismic's naming fails. */
export function titleFrom(body: string): string {
  const line = body.trim().split('\n')[0]!.trim();
  if (line.length <= 70) return line;
  const cut = line.slice(0, 70);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 70)}…`;
}

/**
 * The questions on a card that wait for the owner's answer: its idea agent's while the idea is open
 * and the agent is not at work on a reply (which may settle them), its proposal's while it is not
 * reworked, its worker's, its demo report's. The one place where each kind of card says which of its
 * questions are open: its conversation shows them at its end with the field under it set to answer
 * them, the canvas card and the phone's count show them, the Koordinator hears of them.
 */
export function openQuestions(i: Pick<Item, 'archivedAt' | 'state' | 'need' | 'question' | 'idea' | 'proposal'>): Question[] {
  if (i.archivedAt) return [];
  if (i.state === 'idea') return i.idea?.status === 'open' && !i.idea.thinking ? i.idea.questions : [];
  if (i.state === 'proposal') return i.proposal && !i.proposal.revising && !i.proposal.merge ? i.proposal.questions : [];
  return i.state === 'waiting' && (i.need === 'question' || i.need === 'demo') && i.question ? [i.question] : [];
}

/** A card whose worker failed (its session died with an error, or it could not start at all): it waits for the owner, shown in red. */
export const agentFailed = (i: Pick<Item, 'state' | 'need' | 'question' | 'answering'>) => i.state === 'waiting' && i.need === 'question' && !!i.question?.stuck && !answering(i);

/**
 * A card needs the owner: it waits (but not while its worker takes in what the owner wrote on its
 * handover, nor once they approved it and its work lands), is a proposal or an accepted one its agent withdrew or
 * replaced since, has a pull request that only waits for the owner's merge, or is an open idea whose agent has replied
 * and is done. A merge needs them once its comparison is ready. A progressed survivor keeps its own
 * handover and questions while an unworked partner waits for the comparison.
 */
export const needsYou = (i: Item) =>
  !i.snoozed &&
  (!i.mergingInto || mergeRank(i) > 1) &&
  ((!!i.proposal?.merge && !merging(i)) || (i.state === 'waiting' && !answering(i) && !i.landing && !(i.need !== 'question' && i.codeReview?.state === 'running')) || (i.state === 'proposal' && !i.proposal?.revising && !merging(i)) || !!i.superseded || (i.state === 'inPr' && [i.pr, ...(i.morePrs ?? [])].some((p) => p?.ready && !p.merged && !p.closed)) || (!!i.idea && i.idea.status === 'open' && i.idea.yourTurn && !i.idea.thinking));

/**
 * What a worker can wait for another card to reach: `done`, its work on main (or the card closed
 * without a change); `waitsForOwner`, it needs the owner (asks, hands its work over, a proposal or an
 * idea's questions; snoozed by them or not), or got done already.
 */
export const AWAITED_STATES = ['done', 'waitsForOwner'] as const;
export type AwaitedState = (typeof AWAITED_STATES)[number];

export type Awaited = 'reached' | 'gone' | 'archived' | 'stopped' | 'dropped';

/** Why a snoozed card woke: its time came, the owner woke it, Seismic had something for its agent, it needs the owner, or what became of the card it waited on. */
export type Woke = 'time' | 'owner' | 'news' | 'needsYou' | { met: Awaited };

/**
 * Whether the card a snoozed worker waits on gets it to wake: `reached` the state it waits for;
 * `gone`, `archived`, `stopped` (planned again by the owner), `dropped` (an idea let go) when it no
 * longer gets there by itself; null while it may still.
 */
export function awaited(card: Item | undefined, state: AwaitedState): Awaited | null {
  if (!card) return 'gone';
  if (finished(card.state) || (state === 'waitsForOwner' && needsYou({ ...card, snoozed: undefined }))) return 'reached';
  if (card.archivedAt) return 'archived';
  if (stopped(card)) return 'stopped';
  if (card.idea?.status === 'dropped') return 'dropped';
  return null;
}

/** A worker on the card is at work (whether or not in a turn right now): it has started on the card, opens or follows its pull request, finishes after the landing, or takes in the owner's words on its handover. */
const workerAtWork = (i: Item) => i.kind === 'task' && (i.state === 'working' || i.state === 'inPr' || !!i.finishing || answering(i));

/** A task planned and not with the Koordinator: snoozed, it starts at the time instead of now. */
export const plannedToStart = (i: Pick<Item, 'kind' | 'state' | 'queue' | 'archivedAt'>) => i.kind === 'task' && i.state === 'planned' && !i.queue && !i.archivedAt;

/**
 * A card the owner can snooze until a point in time ("Later"): one at work (its worker stops
 * until then, as on a pause), one that waits for them (it leaves them until then), or one planned
 * (it starts then); a snoozed card's time can be changed.
 */
export const snoozable = (i: Item) => !i.archivedAt && (!!i.snoozed || needsYou(i) || workerAtWork(i) || plannedToStart(i));

/** Answers in the Koordinator's sheet the owner has not seen yet. */
export const unreadAnswers = (talk: Talk[]) => talk.filter((x) => x.unread).length;

/** Per plan, its agent's answers to what the owner asked in its sheet that wait unread: its card shows them. */
export function unreadPerPlan(talk: Talk[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of talk) if (x.unread && x.askedIn) m.set(x.askedIn, (m.get(x.askedIn) ?? 0) + 1);
  return m;
}

/** What on a canvas waits for the owner: the cards that need them, and the Koordinator while an answer waits unread. */
export const waitingOn = (s: Pick<CanvasSnapshot, 'items' | 'talk'>) => s.items.filter(needsYou).length + (unreadAnswers(s.talk) ? 1 : 0);

/**
 * What of a canvas "Needs you" lists (the phone's, and the navigation on every other canvas's page):
 * the cards that need the owner and those snoozed while they did, and the Koordinator's answers that
 * wait unread.
 */
export type Waiting = Pick<CanvasSnapshot, 'items' | 'talk'> & Partial<Pick<CanvasSnapshot, 'preferences' | 'settingProposals' | 'canvas'>> & { proposalItems?: Item[] };
export const waitingIn = (s: Pick<CanvasSnapshot, 'items' | 'talk'> & Partial<Pick<CanvasSnapshot, 'preferences' | 'settingProposals' | 'canvas'>>): Waiting => ({
  items: s.items.filter((i) => needsYou(i) || !!i.snoozed?.waiting),
  talk: s.talk.filter((x) => x.unread),
  preferences: s.preferences, settingProposals: s.settingProposals, canvas: s.canvas, proposalItems: s.items.filter((i) => s.preferences?.some((p) => p.state === 'proposed' && p.cardId === i.id) || s.settingProposals?.some((p) => p.cards.some((c) => c.id === i.id))),
});

/** One item on the canvas as the UI sees it: a stored card merged with what its plan doc says. */
/**
 * Who wrote a card's task: the owner (also through the Koordinator, from their words), the plan doc
 * of its workstream, Seismic (the work retrospective), the idea a prototype is for, or a worker whose
 * proposal the owner accepted. A decided idea's task is its brief, the idea's agent's.
 */
export type TaskAuthor = 'owner' | 'plan' | 'koordinator' | 'idea' | 'proposal';

export const taskAuthor = (item: Pick<Item, 'source' | 'prototypeOf' | 'retro' | 'proposed' | 'brief'>): TaskAuthor =>
  item.source === 'plan' ? 'plan' : item.prototypeOf || item.brief !== undefined ? 'idea' : item.retro ? 'koordinator' : item.proposed ? 'proposal' : 'owner';

export type EdgeSide = 'top' | 'right' | 'bottom' | 'left';
export interface ManualAnchor { fromSide: EdgeSide; toSide: EdgeSide; offset: number }

export interface Item {
  id: string;
  /** The card's code in addresses (`/p/<project>/c/<code>`): a few hex digits, unique among all cards; the id works there too. */
  short?: string;
  kind: CardKind;
  state: CardState;
  need?: Need;
  title: string;
  /** Free text: the owner's description, or a workstream's text from the plan doc (inline markdown). */
  body: string;
  /** Position; relative to the parent plan for its workstreams. */
  x: number;
  y: number;
  parent?: string;
  /** `manual` cards are the owner's; `plan` cards mirror a plan doc and are read-only here. */
  source: 'manual' | 'plan';
  /** Workstream label from the plan doc (`W3`). */
  label?: string;
  /** Plans only. */
  plan?: { file: string; goal: string };
  /** Plans only: the idea their plan doc was written from. */
  origin?: string;
  /** Plans only: the Koordinator reads from the plan doc which workstream builds on which, to arrange them. */
  arranging?: true;
  /** Workstreams only: the workstreams of its plan it builds on, as the Koordinator read them from the plan doc. */
  buildsOn?: string[];
  /** Cards connected by the owner that must finish before this card starts. */
  manualDependsOn?: string[];
  /** Unfinished archived prerequisites, so their wait remains visible and enforceable off canvas. */
  manualArchived?: Item[];
  /** Saved attachment points of the owner-drawn arrows, keyed by prerequisite. */
  manualAnchors?: Record<string, ManualAnchor>;
  /** The worker's latest `report`. */
  statusLine?: string;
  /**
   * Open question: the worker's, when `need` is `question`; or the one in its demo report, while
   * the demo waits for approval and the owner has not answered it.
   */
  question?: Question;
  /** The worker's summary, when `need` is `review` or `demo`. */
  summary?: string;
  /**
   * Its worker takes in what the owner wrote or said on its handover (`need` is `review` or `demo`):
   * until its turn ends, the card is at work and not the owner's, and still waits for approval.
   */
  answering?: true;
  /**
   * Its worker answered what the owner wrote or said on its handover without a new demo: the card
   * waits for the owner because of that answer, not a demo to watch.
   */
  answered?: true;
  /**
   * The owner's comments on places in the demo video (their event ids) that Seismic holds back while
   * they watch, to give them to the worker in one message once they are done (`Spot`).
   */
  held?: number[];
  /** The owner approved the work and Seismic lands it on main (seconds of git): still `waiting`, but no longer the owner's. */
  landing?: true;
  /** Zero while landing, otherwise the place among waiting approvals. */
  landingPosition?: number;
  /** The demo, when `need` is `demo`; its files are served under `/api/cards/:id/demo/`. */
  demo?: Demo;
  /**
   * The demos of earlier handovers a later one replaced, the oldest first, as long as their files
   * are still on disk; each one's files are served under `/api/cards/:id/demos/:n/`.
   */
  demos?: EarlierDemo[];
  /**
   * The files its worker named as the result at its latest handover that named any, the left column's
   * first tabs after the demo; served with the others it changed under `/api/cards/:id/files/`.
   * An empty list: none named, but there are files of its change to show (a folder's card handed over without a demo).
   */
  files?: CardFile[];
  /** The demo's page for colleagues, once the owner shared it (or is about to). */
  share?: Share;
  /** Where the repository's site publishes on approval: the owner unticked "Share on approval", so approving shares nothing. */
  notOnApproval?: true;
  /**
   * The tags of the card's page (`pageTags` in src/core/page-tags.ts), by dimension, as they stand
   * without the site's vocabulary: set by hand, else by the newest worker that gave them, else by
   * Seismic's reading session. A dimension without a key has none chosen yet.
   */
  tags?: PageTags;
  /** The card it comes from: a proposal's source, a prototype's idea, or the card a follow-up follows up on. */
  from?: string;
  /** With `from` on another canvas (a card moved there, or one made there by Seismic): that card's title and canvas. */
  fromElsewhere?: Elsewhere;
  /** A card the work retrospective proposed: the cards and the friction on them it rests on. */
  retro?: string;
  /** A worker's proposal, while it waits: an idea or a task, why, and what the owner has to decide. */
  proposal?: Proposal;
  /** An agent's proposal the owner accepted: its text is that agent's. */
  proposed?: true;
  /** The unworked card this card is merged with right now (`Proposal.merge`): it shows glued to it, and is not on its own until the owner decides. */
  mergingInto?: string;
  /** When the card was created (ISO). */
  createdAt?: string;
  /** Last stored change to the card (ISO), for newest-first mobile ordering. */
  updatedAt?: string;
  /** An accepted proposal its agent withdrew or replaced since, while the card is not finished: the owner removes it or keeps it. */
  superseded?: Superseded;
  /** The repository the card belongs to (an id from the canvas's `repos`). */
  repo: string;
  /**
   * Before work begins on a task or an idea of the owner's: it is to be built in a repository that
   * does not exist yet (`NewRepo`), as the owner or the idea's agent chose. Building or starting it
   * creates that repository first.
   */
  newRepo?: NewRepo;
  /**
   * Its repository does not run on the canvas (it left the configuration, or did not start): its
   * agents take nothing until it is back, and no other repository's agents take it meanwhile.
   * Never on a Question card, whose agent reads only.
   */
  repoDown?: true;
  branch?: string;
  /** Where the branch is checked out, while the card has a workspace: a directory, `host:/dir` on another machine. */
  workspace?: string;
  /** The clone that keeps its branch since its workspace was taken from it, until it works again (the same form as `workspace`). */
  keptIn?: string;
  /** Files the Koordinator expects the card to change. */
  scope?: string[];
  /** Possible duplicate card ids found at the last start check, until dismissed or work starts. */
  possibleDuplicates?: string[];
  /** A planned card the Koordinator is deciding on, or that waits for cards in progress. */
  queue?: Queue;
  /** The pull request, once the worker opened it after approval; on a review card, the one it reviews. */
  pr?: PullRequest;
  /**
   * Further pull requests the worker opened for the card's work, in other repositories (or a second
   * one in its own): the card is live once all of them and `pr` are merged.
   */
  morePrs?: PullRequest[];
  /** A review card: the pull request of someone outside that the card reviews and, once approved, merges. */
  contribution?: Contribution;
  /**
   * The code review of the card's work, where its canvas reviews work that lands on `main` and the
   * card's does: present from its handover on (design: Code reviews in Card lifecycle).
   */
  codeReview?: CodeReview;
  /**
   * A workstream planned again: a part of it landed (this commit, this pull request), but its plan
   * doc keeps it open. A new run does the rest.
   */
  landedPart?: { commit?: string; pr?: { url: string; number: number } };
  /** When the owner archived the card; archived cards are not on the canvas but in its archive. */
  archivedAt?: string;
  /** Ideas only: what the discussion has settled so far. */
  idea?: Idea;
  /** Question cards, and an idea that was one: the thread of looked-up answers it holds. */
  thread?: Thread;
  /** A prototype's idea: the throwaway prototype is built for it and never lands itself. */
  prototypeOf?: string;
  /** A prototype of one of the variants its idea's agent planned: that variant's approach. */
  variant?: string;
  /** A prototype in the archive: discarded (its code thrown away), or built (its idea was built on its branch). */
  prototypeEnd?: 'discarded' | 'built';
  /** A prototype built for a workstream of the plan its idea became: that workstream ("W6 \"Build the site\""). */
  builtInto?: string;
  /** A prototype: its idea's title, wherever the idea is (on the canvas, or in the archive once it became a plan). */
  ideaTitle?: string;
  /** A prototype whose worker proposes to build the idea on it: why, in its words. */
  buildProposal?: string;
  /** Ideas: their prototypes, on the canvas or in the archive, the oldest first; each shows its demo on the idea. A workstream built on a prototype: that one. */
  prototypes?: Item[];
  /** A card that was an idea, or a workstream of the plan an idea became, built on the branch of one of the idea's prototypes: that prototype. */
  builtOn?: string;
  /** The work has landed and its worker finishes what remains (a migration, say) before its session ends. */
  finishing?: boolean;
  /** While `finishing`: nothing just landed, the owner asked about the finished card and its agent answers. */
  followUp?: boolean;
  /** While `followUp`: its agent needs a full clone to answer and waits, without a workspace, for the next free one. */
  waitsForClone?: true;
  /**
   * Its worker is in a turn right now, its background work included (a render, a watcher): what it
   * does shows, and the owner can pause it. Not on a card that waits for the owner once the turn
   * itself has ended and only its background work runs (the app served after the handover).
   */
  inTurn?: true;
  /** While `inTurn`: what its worker is doing, shown under the card. */
  doing?: AgentDoing;
  /** The harness and model of the card's agent whose session runs now (`AgentAt`), as far as known: its bubble at work names them. */
  agentAtWork?: AgentIdentity;
  /** The selection pinned to the current worker session. */
  workerSetting?: AgentSetting;
  /** The worker's background work that runs (a test run, a render, a watcher), the oldest first: while `inTurn`, or after the turn on a card that waits for the owner. */
  background?: BackgroundTask[];
  /**
   * The card's agent other than its worker (an idea's, a Question card's, the reviser of a proposal,
   * the Koordinator naming or checking it) waits for the account's usage limit: it goes on by itself then (ISO time).
   */
  limitedUntil?: string;
  /** Three consecutive usage-limit refusals: paused until a known reset or a manual attempt. */
  limitPaused?: true;
  /** Since when it waits for the owner (`needsYou`), for the phone view's "Needs you". */
  waitingSince?: string;
  /**
   * The owner paused the card's agent (its worker, the idea's agent, the Question card's agent):
   * nothing of it runs, its session stays, and it goes on where it stopped with "Resume" or
   * the owner's next words to it.
   */
  paused?: true;
  /**
   * The owner asked the card's agent to pause once it has brought its work to a safe point (the
   * card's pause, the canvas's): it works on until its turn ends, and is `paused` then.
   */
  pausing?: true;
  /** Its worker paused for a restart that is due (Seismic's, or its repository's agents'): it goes on by itself once that happened. */
  restartPaused?: true;
  /** Set aside until a point in time: nothing of its agent runs, and it does not wait for the owner meanwhile. */
  snoozed?: Snooze;
  /**
   * Where the app in the card's workspace runs, as its worker opens it (`http://localhost:5173`):
   * while the worker says it runs and Seismic has not stopped it. The card offers it to the owner to
   * try by hand, once it answers.
   */
  app?: string;
  /** Waiting for approval, its branch holds no change (checked at the handover): approving makes the card `done`. */
  noChange?: boolean;
  /**
   * Waiting for approval, its branch showed signs of a change to persisted data models, which its
   * worker says is none: the worker's reason, in a line, for the owner to judge.
   */
  modelsUnchanged?: string;
  /**
   * Approved work its agent did, while Seismic asks for feedback: the handover the owner's response
   * would be about, and the answer given on it so far (none: not answered yet).
   */
  rate?: { handover: number; answer?: FeedbackAnswer };
  /**
   * Waiting for approval, its branch changes how work lands (`.obeya/settings.json`, checked at the
   * handover): approving lands it as the branch says, not as the repository does until then.
   */
  lands?: CardLanding;
  /**
   * Its approval could not land: the Seismic checkout has uncommitted changes to `files`, which the
   * card's branch changes too. The card offers to fold them into it (`fold`).
   */
  blocked?: { files: string[] };
  /** Its approval could not land because rebasing onto main conflicted: the worker resolves the conflicts, then the work lands without another approval. */
  resolvingConflicts?: true;
  /**
   * Screenshots the owner attached to the card's task; its worker gets them at the start. On a
   * proposal, those that go with its task once it is accepted (the owner's or its reviser's pick).
   */
  images?: string[];
  /** A card that was an idea and has been decided: the brief it was decided on. */
  brief?: string;
  /** A card that was an idea and has been decided: the mocks of its brief. */
  mocks?: Mock[];
  /** An idea or a task of the owner's, decided as a plan: its worker writes the plan doc, and the plan takes its place. */
  becomesPlan?: boolean;
  /** A plan the owner folded to its head: its workstreams are not shown on the canvas, only counted in it. */
  collapsed?: true;
  /** The group the card belongs to (a `Group` id); a workstream's is its plan's. */
  group?: string;
  /** The card's priority, a label only: it changes no order. None until set. */
  priority?: Priority;
  /** The card's category (`labels.ts`), none until set. */
  category?: Category;
  /** The card's sub-category, with or without a category; none until set. */
  subcategory?: Subcategory;
  /** The card's complexity, none until set. */
  complexity?: Complexity;
  /** The labels Seismic set as its suggestion, which the owner has not touched since. */
  suggested?: Label[];
}

/** A year: no card is snoozed longer, nor set to start later than that. */
export const SNOOZE_LIMIT = 366 * 24 * 60 * 60_000;

/**
 * A card set aside until a point in time (`CardRow.snoozed`): by its worker, which has nothing to do
 * until then (a test that runs for days, a check at midnight), or by the owner; or by its worker
 * until another card reaches a state (`on`). Seismic holds the time and the card and wakes it then;
 * the owner's words, "Wake now", or what Seismic has for an agent that snoozed itself wake it
 * earlier.
 */
export interface Snooze {
  /** When it wakes (ISO); without one, it wakes when the card it waits on gets there. */
  until?: string;
  /** The card of the canvas it waits on (as its title read then), and what for: it wakes once that card got there, or no longer can. */
  on?: { card: string; title: string; state: AwaitedState };
  by: 'agent' | 'owner';
  /** What the agent does once it wakes, in its words. */
  why?: string;
  /** It waited for the owner when they snoozed it: it comes back to them at the time, and nothing goes to its agent. */
  waiting?: true;
  /** The owner changed the time its agent snoozed until: the agent hears so when it wakes. */
  moved?: true;
  /** It is planned: it starts at the time, through the Koordinator, as if started then. */
  start?: true;
}

/**
 * A group of cards on the canvas, shown as a coloured territory behind them. It exists while a card
 * belongs to it (on the canvas or in the archive).
 */
export interface Group {
  id: string;
  name: string;
  /** Its colour's hue, 0–359. */
  hue: number;
}

/**
 * What a worker proposes beyond the card's text, which it writes for the agent that will take the
 * card on. Accepting it writes the questions into the text: those the owner answered on the
 * proposal as decided, the others as open.
 */
export interface Proposal {
  /** Something to think through with the owner first: accepted, it becomes an idea. */
  idea?: boolean;
  /** Why the worker proposes it, for the owner only; the card's text does not say it. */
  reason?: string;
  questions: Question[];
  /**
   * What the owner said it should become (`spoken`: through speech recognition; `said`: the lines of
   * the log with these words), while an agent reworks the text, the reason and the questions by it;
   * `next`: what they said meanwhile, which the rework after it takes in.
   */
  revising?: Revising & { next?: Revising[] };
  /**
   * "Accept and start" was clicked while it was reworked (`idea`: "Ideate"): it
   * is accepted once the new text is there, unless that asks questions.
   */
  acceptAfterRevision?: true | 'idea';
  /** Its agent withdrew it or replaced it by another proposal of its own (`withdraw_proposal`, `propose_card` with `replaces`). */
  superseded?: Superseded;
  /**
   * When it is to start (ISO), for a check that can only be done later (`propose_card` with
   * `start_at`): accepted, it is planned and snoozed until then, and starts at the time.
   */
  startAt?: string;
  /** The owner merges it with another card: the two show as one until they approve the merged text or separate them. */
  merge?: Merge;
  /**
   * Seismic's own proposal of the card that fills in a repository's settings, while it knows them not
   * yet (design: Repositories and configuration): accepted, it is the owner's card like the one the
   * Konfiguration dialog makes.
   */
  setup?: true;
}

/**
 * An agent's proposal its agent withdrew or replaced: still open, it went at once; already accepted,
 * the card carries this until the owner removes it or keeps it.
 */
export interface Superseded {
  /** The proposal that takes its place, and its title then; none when it was withdrawn without one. */
  by?: string;
  title?: string;
  /** Why, in the agent's words. */
  why?: string;
}

/**
 * An unworked card being merged into a survivor: an agent combines two unworked cards, or marks
 * coverage and extra work while preserving a progressed survivor. Approval dissolves the left
 * card; separation restores it. Stored inside proposal JSON for both proposals and planned tasks.
 */
export interface Merge {
  with: string;
  /** Identifies this comparison, so a late result cannot replace a later attempt. */
  attempt?: string;
  /** Originals are restored exactly when the owner separates the pair. */
  origin?: { x: number; y: number };
  temporaryProposal?: true;
  /** The merged card as the agent wrote it. */
  title?: string;
  task?: string;
  /** A progressed survivor is preserved; otherwise both unworked texts are combined. */
  outcome?: 'covered' | 'followUp';
  titleCovered?: boolean;
  /** Exact consecutive pieces of the dissolving task, for checking coverage without rewriting it. */
  parts?: { text: string; covered: boolean }[];
  followUp?: { title: string; task: string; images: string[]; questions: number[] };
  /** Texts compared by the agent, for rejecting a stale approval. */
  compared?: { left: string; right: string; summary: string };
  /** The agent ended without a merged text: why. */
  failed?: string;
}

/** The owner's words a proposal is reworked by, with the screenshots that came with them (image ids). */
export interface Revising {
  words: string;
  spoken?: boolean;
  said?: number[];
  images?: string[];
}

/** A decision taken on a card: an answer to a worker's question, or the owner's call on an idea. */
export interface Decision {
  id: number;
  cardId: string;
  question: string;
  answer: string;
  by: 'owner' | 'plan' | 'koordinator';
  at: string;
}

/** What a plan's sheet shows beyond the plan: its decisions and the idea it came from. */
export interface PlanHistory {
  /** The plan's decisions and those of its idea, oldest first. */
  decisions: Decision[];
  /** The idea the plan doc was written from, wherever it is now (on the canvas or archived). */
  origin: Item | null;
  /** The questions its plan agent answered (asked in its sheet or of Seismic) and their follow-ups, oldest first. */
  talk: Talk[];
}

/**
 * An idea under discussion with its exploration agent. `open` while it is discussed; parked or
 * dropped ideas stay on the canvas with their state, and talking to them opens them again.
 */
export interface Idea {
  status: 'open' | 'parked' | 'dropped';
  /** The state of the idea as the agent keeps it (markdown): goal, variants, decisions, open questions. */
  brief: string;
  /** The exploration agent is working on a reply. */
  thinking: boolean;
  /** "So bauen" was clicked while the agent worked on a reply: the idea is built once the reply is there, unless it asks questions. */
  buildAfterReply?: true;
  /** The agent replied and the owner has not answered yet: an open idea then needs the owner. */
  yourTurn: boolean;
  /** The questions of the agent's latest reply, until the owner says something. */
  questions: Question[];
  /** What the agent would do next in the owner's place, from its latest reply, until the owner says something. */
  next?: NextStep;
  /** The prototypes the brief plans, one per variant: "Prototyp bauen lassen" offers them, to start at once. */
  variants: PlannedPrototype[];
  /** How the brief's variants look, one mock each, shown beside it. */
  mocks: Mock[];
  /** The part that is settled while the rest is open: "Teilaufgabe abtrennen" builds it as a task of its own. */
  split?: SettledPart;
}

/** The thread of looked-up answers a Question card holds, as its card shows it. */
export interface Thread {
  /** The exchange with Seismic the thread started with: its id names the thread and its output directory. */
  talk: number;
  /** Its agent is reading, for what the owner asked on the card. */
  thinking?: boolean;
  answers: number;
  files: number;
}

/** A file a looked-up answer comes with, in its thread's output directory: its path there and a one-line caption. */
export interface AnswerFile {
  name: string;
  caption: string;
}

/**
 * What makes a message a looked-up answer: the thread it belongs to (whose output directory holds
 * its files), its files, and the question of the answer it continues.
 */
export interface AnswerRef {
  thread: number;
  files?: AnswerFile[];
  continues?: string;
}

/** A few lines of HTML the idea's agent writes to show how something would look; the card shows it in a sandboxed frame. */
export interface Mock {
  title: string;
  html: string;
}

/** A prototype the idea's agent plans: its approach in a few words (its title) and what it builds and shows (its task). */
export interface PlannedPrototype {
  approach: string;
  show: string;
}

/**
 * The part of an idea that is settled while the rest is still open, as its agent marks it: what
 * "Teilaufgabe abtrennen" makes a task of its own, the idea staying with what is open.
 */
export interface SettledPart {
  title: string;
  brief: string;
}

/** The owner's next click on an idea: answer its questions, or one of the decisions on the card. */
export const NEXT_STEPS = ['answer', 'build', 'splitOff', 'planDoc', 'prototype', 'park', 'drop'] as const;
export interface NextStep {
  step: (typeof NEXT_STEPS)[number];
  why: string;
}

export interface PullRequest {
  url: string;
  number: number;
  /** `owner/name` of its repository, where that is another than the card's. */
  repo?: string;
  /** Merged already, while the card waits for its other pull requests. */
  merged?: boolean;
  /** Closed without a merge. */
  closed?: boolean;
  /** What it waits for before it is merged, as last polled (`PrWait`); none once it is ready. */
  waits?: PrWait[];
  /** Checks on the PR's latest commit, as last seen. */
  checks: { name: string; state: 'pending' | 'success' | 'failure'; url?: string }[];
  conflict: boolean;
  /**
   * Nothing is left for the worker (checks green, threads resolved, reviewers answered), and GitHub
   * refused Seismic's merge for `mergeError`, or the reviewer's confidence is too low for Seismic to
   * merge (`held`, Greptile's 3/5 say), or the repository's settings leave the merge to the people
   * on the forge (`manual`, `autoMerge` off): the owner merges, or tells the worker what is missing.
   */
  ready?: boolean;
  mergeError?: string;
  held?: { score: string; by: string };
  manual?: boolean;
  /** The review as last seen, oldest first (`reviewOf` in the server's forge). */
  review?: PrReviewEntry[];
}

/**
 * What a pull request waits for before it can be merged, in the order it is in the way: a conflict,
 * a branch behind its base that the repository wants up to date, a draft, branch protection (an
 * approval, a required check), the forge not having worked out mergeability yet, checks failed or
 * running, review threads open, a reviewer's standing request for changes, a review of an older
 * commit than its newest, an answer to the
 * author's request for another look, and the worker at work on something passed to it.
 */
export type PrWait = 'conflict' | 'behind' | 'draft' | 'protection' | 'forge' | 'checksFailed' | 'checks' | 'threads' | 'changes' | 'review' | 'answer' | 'agent';

/**
 * The pull request a review card reviews: opened by someone outside (the contributor), reviewed by
 * the card's worker and merged by Seismic once the owner approves its demo.
 */
export interface Contribution {
  url: string;
  number: number;
  /** The contributor's account on the forge. */
  author: string;
  title: string;
  /** The contributor allows maintainers to push to the PR's branch (GitHub's "Allow edits by maintainers"). */
  canModify: boolean;
  /** What the worker found at its latest handover: the checks on the PR's head, whether it merges into the current main without conflicts. */
  results?: ReviewResults;
  /** The review's findings as the worker keeps them, for the owner to decide on one by one; none until it recorded them. */
  findings?: Finding[];
  /** The worker's change request on the PR, while the card waits for the contributor. */
  requested?: { url?: string; at: string };
  /** The worker's own commits for the PR, held on the card until the owner approves (`HeldChanges`). */
  held?: HeldChanges;
  /** Where work lands on the local main: its unpushed commits collide with the PR, as Seismic found before the merge. */
  clash?: Clash;
}

/**
 * What a review card's worker changed itself on the PR, held on the card: on the owner's approval
 * Seismic pushes its `commits` onto the PR's branch and posts `body` there, as a comment, or with
 * requests to the contributor (the findings `asks`) as one review asking for changes.
 */
export interface HeldChanges {
  body: string;
  commits: number;
  asks: number[];
}

/**
 * Commits on the local main nobody pushed yet that a pull request collides with: once it is merged,
 * pulling it into the local main stops at `commit` (`subject`, and the card that landed it, where
 * one did), in `files`; `unpushed` is how many such commits the local main has.
 */
export interface Clash {
  commit: string;
  subject: string;
  files: string[];
  unpushed: number;
  card?: { id: string; title: string };
}

/**
 * What the owner decides for a finding of a review card: it goes to the contributor as a change
 * request, (`self`) the worker makes the change, which Seismic pushes onto the PR's branch on the
 * owner's approval, or (`later`)
 * it becomes a follow-up task of its own, outside the PR.
 */
export type ChangeRoute = 'contributor' | 'self' | 'later';

/** What the owner picks on an open finding: a route the worker carries out, or `ignore`, which settles it as dropped without telling the worker. */
export type FindingPick = ChangeRoute | 'ignore';

/** Review findings, ordered from most to least severe. */
export const SEVERITIES = ['blocker', 'critical', 'major', 'minor', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** One finding of a review: a review card's, as its worker keeps it, or a code review's of a card's work. */
export interface Finding {
  /** Its number on the card, kept while the worker rewrites the list. */
  id: number;
  title: string;
  text: string;
  security?: boolean;
  severity?: Severity;
  /** Where in the repository it is: a file, and the line in it. */
  file?: string;
  line?: number;
  /**
   * `open` until something came of it: `sent` to the contributor (`url`, the review it went in),
   * `fixed` by the worker (`url`, the post its push went out with, once Seismic pushed it), `resolved` (the contributor's push fixed it, or it no
   * longer applies), `dropped` (the owner does not pursue it), `later` (a follow-up task, `card`,
   * which the worker makes once the owner chose it).
   */
  status: FindingStatus;
  url?: string;
  /** The follow-up task the worker made of it, on the owner's word; several findings may share one. */
  card?: string;
  /** What the owner decided for it, while the worker carries it out. */
  decided?: ChangeRoute;
  /** Decided for the contributor while the worker's own changes are under way or held: the request goes with them, as one message. */
  withChanges?: true;
  /** The other findings its worker would make one follow-up task with it (their ids), in both directions. */
  with?: number[];
}

export type FindingStatus = 'open' | 'sent' | 'fixed' | 'resolved' | 'dropped' | 'later';

/**
 * The code review of a card's work as the card shows it: whether reviews start by themselves with a
 * handover or by the owner's "Start code review", and the review of the latest handover or of an
 * earlier one (`stale`). On a finding of it the owner decides `self` ("Fix it", the card's worker
 * fixes it) or `later` (a follow-up task).
 */
export interface CodeReview {
  mode: CodeReviewMode;
  /** The agent running this review, as selected at start or resolved by its session. */
  agent?: AgentIdentity;
  /** None while no review ran for the card's work. */
  state?: 'running' | 'done' | 'failed';
  /** It reviewed an earlier handover than the latest. */
  stale?: true;
  findings?: Finding[];
  /** Why it failed. */
  error?: string;
  /** Earlier review runs, oldest first; their findings and decisions are snapshots. */
  previous?: { state: 'done' | 'failed'; findings: Finding[]; error?: string; at: string; agent?: AgentIdentity }[];
}

/** How a canvas's finished cards go into the archive (canvas setting "Cards archive"). */
export const CARD_ARCHIVING = ['manual', 'landed'] as const;
export type CardArchiving = (typeof CARD_ARCHIVING)[number];

export const CODE_REVIEW_MODES = ['auto', 'manual'] as const;
export type CodeReviewMode = (typeof CODE_REVIEW_MODES)[number];

/** Whether a canvas reviews the work that lands on `main`, and when. */
export interface CodeReviewSetting {
  on: boolean;
  mode: CodeReviewMode;
}

/** What the worker of a review card reports with its handover. */
export interface ReviewResults {
  checks: { name: string; passed: boolean }[];
  /** It merges into the current main without conflicts. */
  mergeable: boolean;
}

/** A comment on a pull request; `mine` when the PR's author wrote it (the worker, in the owner's name). */
export interface PrComment {
  author: string;
  mine?: boolean;
  body: string;
  /** When it was written, or last changed when `edited`. */
  at: string;
  edited?: boolean;
  url?: string;
}

/** A reviewer's comment on the code and the replies in its thread. */
export interface PrThread extends PrComment {
  path?: string;
  line?: number;
  resolved: boolean;
  replies: PrComment[];
}

/** A round of a reviewer's comments on the code, or a comment in the conversation. */
export type PrReviewEntry = { author: string; mine?: boolean; at: string; threads: PrThread[] } | PrComment;

/**
 * How long a plan's workstreams, started together, wait before the Koordinator plans them: the
 * owner can take the start back until then (a button on the plan card is easily hit).
 */
export const START_ALL_HOLD_MS = 8000;

/** How long taking a card's workspace from it (the Workspaces list) waits for the owner's "Undo". */
export const EVICT_HOLD_MS = 8000;

/** How long pushing main for a review card whose PR collides with unpushed commits waits for the owner's "Undo". */
export const PUSH_HOLD_MS = 8000;

/**
 * `since`: when the card came to the Koordinator; of the cards whose turn comes, the one waiting
 * longest goes first. `together`: the plan whose workstreams the Koordinator judges all at once.
 * `workspace`: the Koordinator let the card start, but no workspace was free for it (`none`: all
 * leased or none set up; `dirty`: every free one has uncommitted changes); it starts once one is.
 * `behind`: the cards it waits for; `buildsOn`: those of them it builds on (workstreams of its
 * plan), which hold it until they have landed, also while not started or stopped.
 * `manualWait`: those of `behind` that only an arrow the owner drew holds it for, not a wait the
 * Koordinator inferred; `buildsOn` names inferred waits alone.
 * `paused`: the Koordinator let it start, but the owner paused its canvas's agents; it starts once they resume them.
 * `begun`, on a card waiting for a workspace or a paused canvas: the owner started it anyway, or it
 * was at work before (its workspace taken from it); the owner's arrows no longer hold it.
 */
export type Queue = Wait & { since: string };

/**
 * What a card in the queue waits for (`Queue`). `together`: judged in one turn with the cards of the
 * same key, a plan's workstreams started at once (the plan's id) or cards freed at once (`freed:…`).
 */
export type Wait = { checking: true; together?: string } | { behind: string[]; reason: string; buildsOn?: string[]; manualWait?: string[] } | { workspace: WorkspaceShortage; begun?: true } | { paused: true; begun?: true };

/** Why a card waits to start: no clone free (`none`), the free ones dirty, or every machine with a clean free one busy to its slots (`slots`). */
export type WorkspaceShortage = 'none' | 'dirty' | 'slots';

/**
 * How a demo shows the work: a narrated `video` of something that happens, or an `html` artifact
 * to look at (design drafts side by side, a layout, an analysis).
 */
export type DemoKind = 'video' | 'html';

export interface Demo {
  kind: DemoKind;
  /** Seconds and title of each scene; none for an HTML artifact. */
  chapters: [number, string][];
  /** A question only the owner can answer, beyond "approve or give feedback". */
  question?: string;
  /** Its answer options, several of them together when `multiple`, and the worker's own pick, as on a worker's question. */
  options?: string[];
  multiple?: true;
  pick?: Question['pick'];
  /** The owner's answer to it; the demo keeps waiting for approval. */
  answer?: string;
  /** The handover event it came with: a later handover may keep the demo, and its question stays with the first. */
  handover?: number;
  /**
   * It came with the worker's question (`handover` is then that question's event): drafts or variants
   * to choose between, not the result of the work, so a handover does not keep it as its demo.
   */
  asked?: true;
  /** When that handover was. */
  at?: string;
  /** The page it is shared on, for colleagues who have never seen Seismic: written by the worker at handover, or later from its summary. */
  page?: DemoPage;
  /** An HTML artifact that is its `index.html` alone: it also goes out as one HTML file. */
  single?: true;
  /**
   * What its worker said of it beside the demo before: recorded afresh (`replaces`), or only showing
   * a detail corrected or explained since (`supplements`), to share beside that one.
   */
  follows?: 'replaces' | 'supplements';
  /** A video without `poster.jpg` (one the demo skill did not render): the player shows its first frame instead. */
  noPoster?: true;
}

/** A demo a later handover replaced: `n` is its place among the card's earlier demos, for its files. */
export type EarlierDemo = Demo & { n: number };

/**
 * What goes on a shared page with the card's demo `i` (of its demos, the oldest first): that demo
 * and, while one supplements the demo before it (`follows`), that one too, the oldest first. A page
 * never shows a supplement without what it supplements.
 */
export function withSupplemented<T extends Pick<Demo, 'follows'>>(demos: T[], i: number): T[] {
  let first = i;
  while (first > 0 && demos[first]!.follows === 'supplements') first--;
  return demos.slice(first, i + 1);
}

/** Which of the demo's chapters plays at `at` seconds (the first before any starts); a seek lands a little before a chapter's start. */
export const chapterAt = (chapters: Demo['chapters'], at: number) => chapters.reduce((cur, [start], i) => (start <= at + 0.05 ? i : cur), 0);

export interface DemoPage {
  title: string;
  /** Two to five sentences on what changes and why. */
  text: string;
  /** The values of the site's vocabulary (the canvas's) the worker chose for each dimension; an empty list where none fits. */
  tags?: PageTags;
}

/** Tags by dimension: a site's vocabulary (each dimension with its values), or what a page carries of it. */
export type PageTags = Record<string, string[]>;

/**
 * The largest video exported as one HTML file (which holds it in base64, a third larger): such a
 * file still goes by mail. A larger one is exported as a ZIP only.
 */
export const EXPORT_HTML_MAX = 15 * 1024 * 1024;

/**
 * A card's shared demo page. `publishing` while it goes out, `shared` once the page is
 * up, `withdrawing` while it is taken down.
 */
export interface Share {
  state: 'publishing' | 'shared' | 'withdrawing';
  /** The page; set once it was published, kept while it is published again. */
  url?: string;
  /** The card's demos on the page, by their handovers (`Demo.handover`), the oldest first. */
  on?: number[];
  /** The card's latest demo is not on the page. */
  stale?: boolean;
  /** The page shows the card's demo, but pages changed since it was published ("Erneut teilen"): those changes, oldest first. */
  outdated?: OutdatedBy[];  /** The page is on an unlisted demo site (behind a random part of its address). */
  unlisted?: true;
}

/** One line in a card's log. */
/** The kinds of screenshot the owner can attach, with the extension each is stored under. */
export const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
/** What the model takes per image (5 MB base64); the browser scales screenshots down to fit. */
export const MAX_IMAGE_BYTES = 3_750_000;
/** The largest other file the owner may drop into what they write; its path goes to the agent. */
export const MAX_FILE_BYTES = 100_000_000;

/** The harness and model of the session that actually spoke; absent on older messages. */
export interface AgentIdentity {
  harness: Harness;
  model?: string;
}

/**
 * One configuration that worked on a card, as its session actually ran: never filled from the
 * defaults of today. `null` is unknown (an old session, a model the session never named).
 */
export interface WorkConfig {
  harness: Harness | null;
  /** The model the session resolved to (`claude-opus-5-5`), not the alias it was asked for. */
  model: string | null;
  effort: AgentEffort | null;
  /** The alias or choice the session was started with (`opus`, `default`), for context only. */
  requested?: string;
}

/**
 * Whom a response credits: `single` one configuration did all the work up to the handover (its
 * fields may still be unknown), `mixed` more than one did and none alone is credited, `missing`
 * nothing is known of who did it.
 */
export type Attribution = 'single' | 'mixed' | 'missing';

/** What the owner said of the work; at least one of them. */
export interface FeedbackAnswer {
  rating?: number;
  comment?: string;
}

/** The owner's response on a card's approved work, with whom it credits as at the handover it is about. */
export interface Feedback {
  id: number;
  /** The card's id, the stable link to it (its address uses `short`), whatever canvas it is on now. */
  cardId: string;
  short?: string;
  canvasId: string;
  /** The handover (its `review` event) the response is about: one response per handover. */
  handover: number;
  /** The card as it was when the response was given. */
  title: string;
  repo?: string;
  plan?: { id: string; title: string; file?: string };
  attribution: Attribution;
  /** Every configuration that worked on the card up to the handover, the earliest first. */
  configs: WorkConfig[];
  /** The one configuration credited, only where `attribution` is `single`. */
  credited?: WorkConfig;
  answer: FeedbackAnswer;
  /** Further dimensions of the task (its complexity, its type), none required. */
  facets?: Record<string, string>;
  at: string;
  /** When the response was last changed, where it was given again for the same handover. */
  updatedAt?: string;
  /** The card was deleted since: the response still counts, with no card to go back to. */
  deleted?: true;
}

/**
 * Where an agent shows at work: a card's (its worker, an idea's agent, a Question card's agent, the
 * reviser of a proposal), the one looking up the question of an exchange in the sheet, or the
 * Koordinator reading the owner's words.
 */
export type AgentAt = { card: string } | { talk: number } | { koordinator: true };

export interface CardEvent {
  agent?: AgentIdentity;
  id: number;
  cardId: string;
  at: string;
  /**
   * `talk` is the discussion of an idea: the owner's messages and the exploration agent's replies.
   * `closing`: a worker's closing words after its reply or handover, which mostly repeat it: they
   * fold under that message. `denied`: a tool call of the worker's refused without asking anyone,
   * with who refused it and why.
   */
  kind: 'report' | 'activity' | 'say' | 'closing' | 'question' | 'answer' | 'hint' | 'review' | 'state' | 'error' | 'talk' | 'denied';
  author: 'worker' | 'owner' | 'plan' | 'koordinator' | 'obeya' | 'explorer';
  text: string;
  /** Set on an error the UI words itself; `text` then holds the server's technical detail. */
  code?: ErrorCode;
  /** Screenshots the owner attached (ids under `/api/c/<project>/images/`). */
  images?: string[];
  /** The mocks of an exploration agent's reply. */
  mocks?: Mock[];
  /** The owner's words: the message of the conversation they reply to (its id), shown above them as a quote. */
  replyTo?: number;
  /** The owner's words: the place in the card's demo video they are about. */
  spot?: Spot;
  /** A looked-up answer: its exchange and thread, and its files. */
  answer?: AnswerRef;
  /** The owner's answer to a worker's question: the options they picked, which lead its text (`pickedAnswer`). */
  picks?: string[];
  /** The owner's words the card's agent has not read yet: Seismic holds them for it, and the owner can still take them back. */
  unread?: true;
  /** The owner's words the agent read later than they were written: they stand after this line of the log, where it read them. */
  readAfter?: number;
  /** Seismic's reply on the card says it cannot do what the owner asked (or the owner asked to tell its makers): what a draft for them starts from. */
  wish?: Wish;
  /**
   * Seismic's reply on the card answers the owner's words without acting on them (no actions to take
   * back): it stands in the conversation, where the confirmation of actions folds away.
   */
  reply?: true;
  /**
   * Seismic's reply to what the card's agent passed on from the owner's words (`to_seismic`): it answers
   * a step of the agent's, so it stands under the agent's message that step leads to.
   */
  forwarded?: true;
  /**
   * A card made from this one: a worker's proposal or Seismic's follow-up, with its title then
   * (`canvas`, when it went onto another canvas). The conversation shows it as an action, with
   * the card's cover. The event's author distinguishes a proposal from a follow-up.
   */
  made?: { card: string; title: string; canvas?: string };
  /**
   * An error of a session that signed in to Claude with a token (Seismic's `claude-token` or
   * `CLAUDE_CODE_OAUTH_TOKEN`; on another machine, without one, that machine's own login), not with
   * this machine's account: signing in again here does not renew it, a new token does.
   */
  token?: true;
}

/** Seismic's line that a worker started on the card afresh: what it handed over before belongs to an earlier run. */
export const started = (e: Pick<CardEvent, 'kind' | 'author' | 'text'>) => e.kind === 'state' && e.author === 'obeya' && /^(Agent gestartet|Agent started)/.test(e.text);

/** The owner's answer as the log holds it: the options picked, then their own words. */
export const pickedAnswer = (picks: string[], words: string) => [picks.join(', '), words.trim()].filter(Boolean).join('\n\n');

/** The owner's own words in an answer, without the options picked that lead it. */
export function ownWords(e: Pick<CardEvent, 'text' | 'picks'>): string {
  const lead = e.picks?.join(', ');
  return lead && e.text.startsWith(lead) ? e.text.slice(lead.length).trim() : e.text;
}

/** A place in a card's demo video the owner's words are about, as the worker reads it with them. */
export interface Spot {
  /** Seconds into the video. */
  at: number;
  /** The chapter playing there. */
  chapter?: string;
  /** What the narration says around there. */
  narration?: string;
  /** The frame there, taken in the browser (an image id like a screenshot's). */
  still?: string;
  /** The demo it is in, by the handover it came with (`Demo.handover`): the card's demo then, or an earlier one the owner went back to. */
  demo?: number;
  /** It is in a demo a later handover replaced. */
  earlier?: true;
}

/** A place in the demo video as the browser sends it with the owner's words: Seismic adds chapter and narration. */
export type SpotInput = Pick<Spot, 'at' | 'still' | 'demo'>;

export interface CanvasInfo {
  id: string;
  name: string;
  /** The repositories on the canvas; the first is its home. */
  repos: RepoRef[];
  /** How many times which of its repositories do not run as the configuration has them changed: the page reads the configuration's problems again when it changes. */
  configRev?: number;
  /** The owner paused the canvas's agents: cards the Koordinator lets start wait in the queue until they resume them. */
  paused?: true;
  /** Its agents at work now (`pausable`) and those the owner paused or that are about to pause (`halted`), for the canvas switcher; absent while none is either. */
  agents?: { running: number; paused: number };
  /** The demo site its demos are shared on; absent without one. */
  demoSite?: CanvasDemoSiteState;
}

export interface RepoRef {
  id: string;
  name: string;
  path: string;
  branch: string;
  /** A folder without git: cards work in it directly, with no branches, landing, pull requests, prototypes or hosts. */
  folder?: true;
  /** It has a share target: its canvas's demo site, initialized and deployable from this machine; without one demos are exported as a file. */
  share?: boolean;
  /** Its canvas's demo site needs an env file this machine lacks (relative to Seismic's home): demos are exported meanwhile. */
  shareNeeds?: { site: string; file: string };
  /** With `share`: each approved card's latest demo goes on the page by itself, unless the card opts out (the canvas's site publishes on approval). */
  shareOnApproval?: true;
  /** With `share`: the vocabulary of tags the canvas names for its site, which a card's page takes its tags from. */
  shareTags?: PageTags;
  /** With `share`: the site is unlisted. */
  shareUnlisted?: true;
  /** Without `share`: why not: the canvas has no demo site (`none`), or its path is not initialized yet (`init`). */
  shareSite?: 'none' | 'init';
  /** Its approved work goes out as a pull request (else it lands on the default branch of the Seismic checkout). */
  pullRequests?: boolean;
  /** Its `origin` is on a server, where others may open pull requests ("Review PR #5"). */
  forge?: true;
  /** With `pullRequests`: the owner may have approved work pushed directly onto the default branch instead (`direct` of its settings). */
  direct?: boolean;
  /**
   * How many times what the configuration's problems of the repository are read from changed on
   * its default branch while the canvas runs (its `.obeya/settings.json`, a leftover
   * `.obeya/adapter/`): the page reads the problems again when it changes.
   */
  configRev?: number;
}

/** A repository's pool of clones, by the machine they are on, in the order new cards go there; or its slots for workers in worktrees. */
export interface ClonePool {
  repo: string;
  hosts: PoolHost[];
}

/** A machine's part of a pool: its clones and the cards that hold them, and how many of their workers may be busy at once. */
export interface PoolHost {
  /** The host's name in the configuration; for the machine Seismic runs on, its own name. */
  name: string;
  /** The machine Seismic runs on. */
  here?: boolean;
  /** Its workers work in worktrees: `total` is its slots, and `cards` those of the workers at work. */
  worktrees?: boolean;
  /** How many of its workers may be in a turn at once; a new card goes elsewhere or waits once they are. */
  slots: number;
  /** Its clones: how many, and the cards that hold one now. */
  total: number;
  cards: string[];
  /** The cards whose worker is in a turn there now. */
  busy: string[];
  /** The folders (paths there) of clones Seismic made that left the pool and stay, since something in them would be lost. */
  kept?: string[];
  /** Its free clones no new card gets now, by their last look; none when every free clone can be taken. */
  blocked?: BlockedClone[];
  /** Each of its clones (free ones too), or worktrees, by path there and with the card that holds it. */
  workspaces: PoolWorkspace[];
}

/** A clone or worktree in the pool: its path on its machine, the card holding it (`card`, `title`). */
export interface PoolWorkspace {
  path: string;
  card?: string;
  /** The holding card's title, also for a card not on the canvas (in the archive, say). */
  title?: string;
  /** The canvas of a holding card that lies on another canvas than the pool's. */
  canvas?: string;
  /** Its card may give it up for a card waiting for one ("Give to the waiting card": its worker stops, its work is kept on its branch). */
  takeable?: true;
  /** Its card gives it up once the undo window of "Give to the waiting card" is through. */
  leaving?: true;
}

/**
 * A free clone no new card gets now, and why, for the owner to put right: `dirty`, uncommitted
 * changes (the first `files`, `more` beyond them); `broken`, git fails in it (`error`); `missing`,
 * its folder is not there; `unreachable`, its machine does not answer over SSH; `failed`, git
 * failed making it ready for a card a moment ago (`error`), so it is passed over for a minute.
 * `made`: a clone Seismic made, which its next start makes again where the folder is missing.
 */
export interface BlockedClone {
  /** Its path on its machine. */
  path: string;
  why: 'dirty' | 'broken' | 'missing' | 'unreachable' | 'failed';
  files?: string[];
  more?: number;
  error?: string;
  made?: true;
}

export interface CanvasSnapshot {
  canvas: CanvasInfo;
  items: Item[];
  /** The canvas's groups, the oldest first. */
  groups: Group[];
  preferences: Preference[];
  /** The settings the work retrospective proposes for the canvas's repositories, waiting for the owner; none when none waits. */
  settingProposals?: SettingProposal[];
  /**
   * The owner's latest exchanges with the Koordinator in the current chat without an open card (those
   * with one are in its log), and the answers that wait unread in the canvas's other chats.
   */
  talk: Talk[];
  /** The chat the owner talks in now (`Talk.chat`); its exchanges are those the sheet shows. */
  chat: number;
  /** Model chosen for this chat; absent means the canvas's Seismic setting. */
  chatModel?: AgentModel;
  /** The canvas's chats with something said in them, the latest first. */
  chats: Chat[];
  /** The clone pools of the repositories that use clones; none when no repository does. */
  workspaces?: ClonePool[];
  /** Shared pages their sites now write differently, and sharing many of them again; none when there is neither. */
  reshare?: Reshare;
  /** The plan directories the canvas has a note about (`PlanDir`); none when it has none. */
  planDirs?: PlanDir[];
  /** The harness and model of the Koordinator's session that reads the owner's words, while one runs. */
  koordinatorAgent?: AgentIdentity;
}

/**
 * A repository's plan directory, shown as a note beside the plans (or where the owner put it): the docs in it that are not
 * plans, with the reason and the card preparing each as one (`preparing`), or, while the
 * repository has no plan doc and never had a plan (`empty`), where the first one goes.
 */
export interface PlanDir {
  repo: string;
  /** As the repository's settings name it, `docs/plan`. */
  dir: string;
  empty: boolean;
  others: { file: string; reason: NotAPlan; preparing?: string }[];
  /** Where the owner put the note, its top left on the canvas; without it, it stands above the plans. */
  at?: { x: number; y: number };
}

/**
 * Shared demo pages to bring up to date at once, from the Koordinator's sheet: how many are
 * outdated, and the run that shares them again one after the other.
 */
export interface Reshare {
  /** Pages that could be shared again and are not queued (after "Ausblenden", those a newer change left outdated). */
  outdated: number;
  /** Shared pages on a site with a vocabulary that lack tags in a dimension (none chosen, or a value the vocabulary no longer has), not queued. */
  untagged?: number;
  /** What sharing them again brings: each change they lack, oldest first, with how many of them lack it. */
  changes?: { id: OutdatedBy; pages: number }[];
  run?: {
    total: number;
    /** Shared again. */
    done: number;
    /** Failed, with the reason in their card's log. */
    failed: { id: string; title: string }[];
    /** Still to go, the one going out now included. */
    left: number;
    /** The card whose page goes out now. */
    current?: string;
    /** The owner stopped it: the pages not yet out stay as they were. */
    stopped?: boolean;
    /** It tags the pages without tags and shares them again ("N pages without tags"), rather than sharing outdated ones again. */
    tags?: boolean;
  };
}

/** One of the owner's chats with Seismic: its exchanges, the Koordinator's memory while the owner talks in it. */
export interface Chat {
  id: number;
  /** Model chosen for this chat; absent means the canvas's Seismic setting. */
  model?: AgentModel;
  canvas: string;
  /** The owner's first words in it; none where it only holds what Seismic said by itself. */
  title?: string;
  /** When something was last said in it. */
  at: string;
  /** Answers in it the owner has not seen yet. */
  unread?: number;
}

/** A chat as the list of every canvas's chats shows it, with its canvas's name. */
export interface ChatElsewhere extends Chat {
  canvasName: string;
}

/** One exchange between the owner and the Koordinator. */
export interface Talk {
  /** The chat it was said in. */
  chat?: number;
  replyAgent?: AgentIdentity;
  answerAgent?: AgentIdentity;
  id: number;
  at: string;
  /** What the owner said or typed. */
  said: string;
  /** Absent while the Koordinator reads the words. */
  reply?: string;
  /** The card that was open. */
  cardId?: string;
  /** The owner took the actions back. */
  undone?: boolean;
  /** Screenshots that came with the command; they went to the cards it created or concerned. */
  images?: string[];
  /** A question the Koordinator looks up; its answer comes later. */
  question?: string;
  answer?: string;
  /** Who answered: the Koordinator, or the plan agent of the workstream asked about. */
  answerBy?: 'koordinator' | 'plan';
  /** The answer came for the sheet, and the owner has not had the sheet in view since. */
  unread?: true;
  /** A looked-up question: the thread it belongs to (the id of the exchange that started it). */
  thread?: number;
  /** A follow-up: the exchange whose answer it continues, and that one's question. */
  follows?: number;
  continues?: string;
  /** The files the answer came with, in the thread's output directory. */
  files?: AnswerFile[];
  /** The thread moved onto a Question card: that card; its answers stand there from then on. */
  movedTo?: string;
  /** The message of the sheet the owner's words reply to, shown above them as a quote. */
  replyTo?: TalkQuote;
  /**
   * The reply says Seismic cannot do what the owner asked, or the owner asked to tell Seismic's makers
   * something: what a draft for them starts from, under a link on the reply.
   */
  wish?: Wish;
  /** The usage limit keeps the Koordinator from reading the words: it reads them by itself then (ISO time), the reply follows. */
  heldUntil?: string;
  /** The usage limit stopped the agent that looks the question up: it goes on by itself then (ISO time), the answer follows. */
  limitedUntil?: string;
  /** Three consecutive usage-limit refusals: paused until a known reset or a manual attempt. */
  limitPaused?: true;
  /** The harness and model of the agent looking the question up now, as far as known. */
  lookUpAgent?: AgentIdentity;
  /** Cards the Koordinator waits on, as its reply said, to take a step once each gets there (`wait_for`). */
  waits?: TalkWait[];
  /** Words of no one: the Koordinator took them up by itself, since a card it waited on got there (or no longer can). */
  after?: TalkAfter;
  /** A question looked up for an action that needs its answer: the step the Koordinator takes once the answer is in, until it has decided it. */
  then?: string;
  /** Words of no one: the Koordinator took up the step it said it would take once the answer of that exchange was in. */
  answered?: number;
  /** Words of no one: a card left this canvas for another, built there in a new repository. */
  moved?: TalkMoved;
  /**
   * Written in this plan's sheet: the words went straight to its plan agent as a question
   * (`question` is the words), so Seismic has no reply of its own to them.
   */
  askedIn?: string;
}

/** A card that moved to another canvas: its id and title, and that canvas. */
export interface TalkMoved {
  card: string;
  title: string;
  canvas: string;
  canvasName: string;
}

/** A card the Koordinator waits on: until it is done or waits for the owner. */
export interface TalkWait {
  card: string;
  title: string;
  state: AwaitedState;
}

/** What became of the card the Koordinator waited on, which it took up again with: the exchange it said so in. */
export interface TalkAfter {
  title: string;
  state: AwaitedState;
  met: Awaited;
  from: number;
}

/** A message of Seismic's sheet: one part of an exchange, what the owner said, the Koordinator's reply or the looked-up answer. */
export interface TalkRef {
  talk: number;
  part: 'said' | 'reply' | 'answer';
}

/** A message of the sheet as a reply quotes it: who said it and what. */
export interface TalkQuote extends TalkRef {
  by: 'owner' | 'koordinator' | 'plan';
  text: string;
}

export const isTalkRef = (r: unknown): r is TalkRef =>
  !!r && typeof r === 'object' && Number.isInteger((r as TalkRef).talk) && ['said', 'reply', 'answer'].includes((r as TalkRef).part);

/**
 * A lasting preference of the owner, learned by the Koordinator or written by the owner. A learned
 * one is a proposal until the owner accepts it; agents follow active ones only.
 */
export interface Preference {
  id: number;
  text: string;
  state: PreferenceState;
  /** The card whose exchange it was learned from. */
  cardId?: string;
  /** What the owner said there that it was learned from. */
  quote?: string;
  /** Proposed by the retrospective over many exchanges, not from one. */
  review?: boolean;
  /** The active rule a proposal would change. */
  replaces?: number;
  /**
   * A repository: the rule is about it and belongs in its CLAUDE.md, not in the preference memory.
   * Accepted, it is `filed` there through a card "Add to CLAUDE.md" and applies to no agent until it is.
   */
  target?: string;
}

export type PreferenceState = 'proposed' | 'active' | 'rejected' | 'filed';

/** The settings of a repository the work retrospective may propose a value for, in the dialog's order: what friction on workers' runs shows missing. */
export const PROPOSED_SETTINGS = ['checks', 'setup', 'softPaths', 'run'] as const;
export type ProposedSetting = (typeof PROPOSED_SETTINGS)[number];

/** A value for a setting of a repository (`RepoSettings`) that the work retrospective proposes, with the cards it rests on. */
export interface SettingProposal {
  id: number;
  /** The repository's id. */
  repo: string;
  field: ProposedSetting;
  /** A command for `setup`, the recipe for `run` (`app.run`), a list for `checks` and `softPaths`. */
  value: string | string[];
  /** One sentence for the owner: what went wrong on the cards it rests on. */
  basis: string;
  cards: { id: string; title: string }[];
  /** The setting's value as it applies now, in the snapshot. */
  now?: string | string[];
}

/**
 * What became of a setting proposal: waiting, set on this machine, put into the repository's
 * `.obeya/settings.json` for everyone, or rejected.
 */
export type SettingProposalState = 'proposed' | 'machine' | 'repository' | 'rejected';

/** `value` as this machine's settings for the repository hold it (`RepoSettings`). */
export function settingPatch(field: ProposedSetting, value: string | string[] | undefined): RepoSettings {
  if (field === 'run') return { app: { ...(value !== undefined ? { run: value as string } : {}) } };
  return { [field]: value } as RepoSettings;
}

export interface NewCard {
  title: string;
  body?: string;
  /** Where it goes; left out for a follow-up, which goes below the card it comes from, and otherwise where there is room. */
  x?: number;
  y?: number;
  /** A repository of the canvas; its home repository when left out (a follow-up's: that of its card). */
  repo?: string;
  /** An idea to discuss before anything is planned. */
  idea?: boolean;
  /** The card this one follows up on, e.g. for a finding of its demo. */
  from?: string;
  /** Screenshots for the task (ids from `POST /api/c/<project>/images`). */
  images?: string[];
}

/**
 * A repository to be created for a card: its folder (absolute or from `~`; empty while the owner has
 * not named one yet) and whether it gets a canvas of its own, which the card moves to, or joins the
 * card's canvas. `by`: who chose it; what the owner chose, the idea's agent does not change.
 * `due`: building or starting the card was clicked, and Seismic creates the repository then (ISO),
 * unless the owner takes it back meanwhile (`NEW_REPO_HOLD_MS`).
 */
export interface NewRepo {
  path: string;
  canvas: boolean;
  by: 'owner' | 'agent';
  due?: string;
}

/** How long building a card in a new repository waits for the owner to take it back. */
export const NEW_REPO_HOLD_MS = 8000;

/** The name a new repository's folder gives it (and its canvas): the last part of its path. */
export const newRepoName = (path: string) => path.trim().replace(/[/\\]+$/, '').split(/[/\\]/).at(-1) ?? '';

/** A card on another canvas, as a card that refers to it shows it. */
export interface Elsewhere {
  canvas: string;
  canvasName: string;
  title: string;
}

export interface CardPatch {
  x?: number;
  y?: number;
  title?: string;
  body?: string;
  state?: CardState;
  need?: Need | null;
  /** Another repository of the canvas, before work on the card has begun. */
  repo?: string;
  /** A plan: folded to its head, its workstreams not shown on the canvas, or unfolded again. */
  collapsed?: boolean;
  /** The task's screenshots, all of them (ids from `POST /api/c/<project>/images`). */
  images?: string[];
  /** Before work begins: a repository to create for the card (`by` is the owner's), or none (null). */
  newRepo?: Pick<NewRepo, 'path' | 'canvas'> | null;
  /** The card's priority, or none (null); the owner's, as is each label set here: its suggested mark goes. */
  priority?: Priority | null;
  /** The card's category, or none (null). */
  category?: Category | null;
  /** The card's sub-category, or none (null). */
  subcategory?: Subcategory | null;
  /** The card's complexity, or none (null). */
  complexity?: Complexity | null;
}

/** Owner actions on a card's work, posted to `/api/c/:canvas/cards/:id/act`. */
export type CardAction =
  /** On a plan: all its planned workstreams go to the Koordinator, which orders them. */
  | { action: 'start'; agent?: AgentSetting }
  /** A card the owner closed without a title (`nameless`): Seismic names it from its text. */
  | { action: 'name' }
  | { action: 'stop' }
  /**
   * The agent stops at once and goes on later where it stopped (`resume`, or the owner's next words
   * to it); `safePoint`: it first brings its work to a safe point and ends its turn, then stops.
   */
  | { action: 'pause'; safePoint?: true }
  | { action: 'resume' }
  /**
   * Set aside until `until` (ISO): a card at work stops until then as on a pause, one waiting for the
   * owner leaves them until then. On a snoozed card, it changes the time.
   */
  | { action: 'snooze'; until: string }
  /** A snoozed card wakes now; a snoozed planned card starts now. */
  | { action: 'wake' }
  /** When a proposal starts once accepted (ISO), or `null`: at once. */
  | { action: 'startAt'; at: string | null }
  /** `images`: ids of screenshots uploaded before (`POST /api/c/<project>/images`); with them the text may be empty. */
  /** `spoken`: the words came through speech recognition, which the agent is told. */
  /** `replyTo`: the message of the card's conversation the words reply to (`CardEvent.replyTo`). */
  /** `spot`: the place in the card's demo video the words are about. */
  /** `findings`: on a review card or a card with a code review, what the owner decided for its findings, by their numbers; with them the text may be empty. */
  | { action: 'message'; text: string; spoken?: boolean; images?: string[]; replyTo?: number; spot?: SpotInput; findings?: Record<string, FindingPick>; findingNotes?: Record<string, string>; newAgent?: AgentSetting }
  /** `picks`: the options of the question the owner picked; with them the text, their own words, may be empty. */
  | { action: 'answer'; text: string; spoken?: boolean; images?: string[]; replyTo?: number; picks?: string[]; spot?: SpotInput }
  /**
   * The owner has finished watching the demo video: the comments on places in it that Seismic held back
   * go to the worker. `now`: they sent them themselves ("Jetzt senden"), so they go without a moment's wait.
   */
  | { action: 'release'; now?: boolean }
  /** Deletes a comment on a place in the demo video that Seismic still holds back (`Item.held`). */
  | { action: 'unsay'; id: number }
  /**
   * A review card whose PR collides with unpushed commits on the local main: main is pushed, once
   * the undo window (PUSH_HOLD_MS) is through, and the card's agent brings the PR up to date with it;
   * `keepMain` takes it back within the window.
   */
  | { action: 'pushMain' }
  /**
   * The Seismic checkout's uncommitted changes that keep the card from landing (`Item.blocked`) go
   * into its branch, and its worker works them in; `land`: its next handover lands without a new
   * demo, else it brings a new one for approval.
   */
  | { action: 'fold'; land: boolean }
  | { action: 'keepMain' }
  /** A review card whose worker's own changes are held (`HeldChanges`): Seismic pushes them and posts their text, without merging ("Push only"). */
  | { action: 'pushChanges' }
  /** The same card: the owner's own wording of the text that goes onto the PR with the approval, in place of the held one. */
  | { action: 'editHeld'; body: string }
  /** `direct`: onto the default branch at once, without a pull request, where the repository allows it (`RepoRef.direct`). */
  | { action: 'approve'; direct?: boolean }
  /** A card waiting for approval whose canvas reviews work on the owner's word ("Start code review"): a review of its latest handover starts. */
  | { action: 'codeReview' }
  /** In a folder without git, on a card waiting for approval: what it changed there is put back as it was before ("Discard changes"). */
  | { action: 'undo' }
  /** Start a queued card although it may collide. */
  | { action: 'force' }
  /**
   * The Workspaces list: the card's clone goes to the cards waiting for one, after the undo window
   * (EVICT_HOLD_MS); its worker stops, its uncommitted work is kept on its branch, and it goes on
   * there once it has a workspace again. `keepWorkspace` takes it back within the window.
   */
  | { action: 'takeWorkspace' }
  | { action: 'keepWorkspace' }
  /** On a plan: takes back a start of all its workstreams while the Koordinator has not planned them yet. */
  | { action: 'dequeue' }
  /**
   * On a plan: its workstreams in columns by what builds on what, which the Koordinator reads
   * from the plan doc unless it has for the doc as it stands. Answers once they stand there.
   */
  | { action: 'arrange' }
  /** A waiting card `places` places (1 if left out) earlier or later in the queue, past cards it has no wait with. */
  | { action: 'reorder'; earlier: boolean; places?: number }
  /**
   * A proposal becomes the owner's card and starts (a proposed idea: its discussion opens); with
   * `start: false` it is only planned. `idea`: a proposed task becomes an idea to discuss first.
   * `picks`: the options the owner chose for each of its questions. While the proposal is reworked,
   * it is accepted and started once the new text is there, unless that asks questions.
   */
  | { action: 'accept'; start?: boolean; idea?: boolean; picks?: string[][]; agent?: AgentSetting }
  /** A proposal: accepting it after its revision is taken back. */
  | { action: 'unaccept' }
  /** Merge an unworked card with a partner in any state, for the owner to approve. */
  | { action: 'merge'; with: string }
  /** Dismiss Seismic's possible-duplicate suggestion for this version of the task. */
  | { action: 'dismissDuplicate' }
  /** Approve a comparison: dissolve the left card, combine unworked tasks or preserve the survivor. */
  | { action: 'approveMerge' }
  /** Separate a merge: restore both original cards. */
  | { action: 'separate' }
  /** A proposal, or a card whose agent withdrew or replaced it since (`Item.superseded`): it goes, its worker stopped. */
  | { action: 'dismiss' }
  /** A card whose agent withdrew or replaced it since: the owner keeps it, and the mark goes. */
  | { action: 'keep' }
  /** A proposal: an agent reworks its text, reason and questions by what the owner said (`text`) and showed (`images`). */
  | { action: 'revise'; text: string; spoken?: boolean; images?: string[]; replyTo?: number }
  /** Ideas: talk to the exploration agent; `spoken` gets a short spoken summary back. */
  | { action: 'discuss'; text: string; spoken?: boolean; images?: string[]; replyTo?: number }
  /**
   * Ideas: the brief becomes the card's task and the card is planned. While the agent works on a
   * reply, the idea is built once the reply is there, unless it asks questions.
   */
  | { action: 'build'; agent?: AgentSetting }
  /** Ideas: building after the reply is taken back. */
  | { action: 'unbuild' }
  /**
   * A task or an idea whose start or building waits to create its new repository (`NewRepo.due`):
   * that is taken back, and the card stays as it was.
   */
  | { action: 'stayHere' }
  /**
   * Ideas: the part its agent marked as settled becomes a task of its own beside the idea, started at
   * once; the idea stays open with its conversation, its agent and its prototypes.
   */
  | { action: 'splitOff' }
  /** Ideas, and planned tasks of the owner's nobody has worked on: a planned card whose worker writes a plan doc from the brief or the task. */
  | { action: 'planDoc' }
  | { action: 'park' }
  | { action: 'drop' }
  /**
   * Ideas: a worker builds a throwaway prototype and shows it as a demo on the idea; several may run
   * side by side. One per planned variant named in `variants` (by approach), and one for `text`.
   * Neither: one per planned variant without a prototype on the canvas, or, without any planned,
   * the idea as it stands.
   */
  | { action: 'prototype'; text?: string; variants?: string[] }
  /**
   * Prototypes: the idea is built on this prototype's branch; the idea's other prototypes are
   * discarded. Once the idea has become a plan, one of its workstreams is built on it instead:
   * `workstream`, or else the one the plan doc builds on the prototypes with.
   */
  | { action: 'buildPrototype'; workstream?: string }
  /** Prototypes: thrown away, into the archive with log, demo and summary. */
  | { action: 'discard' }
  /**
   * A demo is published for colleagues right away: the one with handover `demo` (the latest
   * without), on the card's page in place of the versions there, or beside them (`add`).
   */
  | { action: 'share'; demo?: number; add?: boolean }
  /** Takes the demo with handover `demo` off the page, the page down with its last one; without `demo`, the whole page. */
  | { action: 'unshare'; demo?: number }
  /** "Share on approval", where the repository's site publishes on approval: whether approving the card shares its latest demo. */
  | { action: 'shareOnApproval'; on: boolean }
  /** The owner sets the values of one dimension of the page's tags by hand; a shared page goes out again at once. */
  | { action: 'pageTags'; dimension: string; values: string[] }
  /** Question cards: the owner's words to the agent that looked the answers up. */
  | { action: 'ask'; text: string; spoken?: boolean; images?: string[]; replyTo?: number }
  /** Question cards: the thread becomes an idea, whose exploration agent starts from it. */
  | { action: 'asIdea' }
  /** Plans: the owner's words in the plan's sheet, straight to its plan agent, maybe replying to a message there. */
  | { action: 'consult'; text: string; spoken?: boolean; images?: string[]; replyTo?: TalkRef };

/**
 * Why the server refused a request. The server sends the code and an English detail
 * (`{ code, error }`, status 400); the UI shows its own text for the code.
 */
export type ErrorCode =
  | 'unknownCard'
  /** Pairing a device while other devices do not reach Seismic. */
  | 'notReachable'
  /** From another device that is not paired (status 401). */
  | 'notPaired'
  | 'notOwner'
  /** Managing who reaches Seismic, from another device (status 403). */
  | 'onlyHere'
  /** Turning push on at the machine Seismic runs on, which gets none (status 403). */
  | 'onlyDevices'
  /** A group that no card belongs to any more, so it is gone. */
  | 'unknownGroup'
  | 'plan'
  /** An arrow between cards that would make them wait for each other, directly or through other cards. */
  | 'dependencyCycle'
  /** An arrow to or from a plan or one of its workstreams, whose order comes from the plan doc. */
  | 'planDependency'
  /** An action that needs the card's agents while its repository does not run on the canvas (`Item.repoDown`). */
  | 'repoDown'
  | 'notPlanned'
  | 'queued'
  | 'notQueued'
  /** Moving a card in the queue: it is first or last already, or the card it would pass has a wait with it or is being judged. */
  | 'notMovable'
  | 'notPlannable'
  | 'noAgent'
  /** Resuming an agent the owner has not paused. */
  | 'notPaused'
  /** Snoozing a card that is neither at work nor waiting for the owner. */
  | 'notSnoozable'
  /** Waking a card that is not snoozed. */
  | 'notSnoozed'
  /** A time to snooze until that has passed, or lies more than a year ahead. */
  | 'snoozeTime'
  | 'noQuestion'
  | 'notReady'
  /** A review card's action on a card that reviews no pull request. */
  | 'notReview'
  /** "Change it myself" on a review card whose contributor does not allow maintainers' edits, or a decision on a finding it does not have open. */
  | 'noEdits'
  | 'noFinding'
  /** Approving a review card: its PR moved since the handover, was closed, or the forge refused the merge (the detail says why). */
  | 'prMoved'
  /** "Push main" on a review card whose PR collides with nothing unpushed (any more), or taking back a push that is not waiting. */
  | 'noClash'
  /** "Merge" on a review card whose PR collides with unpushed commits on the local main, which the card had not shown yet: it shows them now. */
  | 'pullClash'
  | 'prClosed'
  | 'mergeRefused'
  /** Approving a review card: the worker's own commits could not go onto the PR's branch (the detail says why). */
  | 'pushRefused'
  /** "Review PR #5": no such pull request, or none Seismic can read. */
  | 'noPr'
  /** Deleting a comment on the demo video: it is no longer held back, the worker has it. */
  | 'notHeld'
  /** Approving directly onto main: the card's repository lands approved work only through a pull request. */
  | 'noDirect'
  /** What only a folder without git has (discarding a card's changes), or what it has not (prototypes, pull requests). */
  | 'notFolder'
  | 'inFolder'
  | 'notProposal'
  | 'notSuperseded'
  | 'revising'
  /** Changing a proposal or the card it is merged with while they are merged, or approving a merge whose text is not there yet. */
  | 'merging'
  /** Either card is unavailable for this merge, or its dissolving side has already been worked on. */
  | 'notMergeable'
  /** The comparison no longer matches the cards the owner would approve. */
  | 'mergeChanged'
  | 'planCard'
  | 'noWorkspace'
  | 'dirtyWorkspaces'
  /** Taking a card's workspace from it: it holds no clone that may be taken (worktrees, its work landed, a prototype's), or one is being taken already. */
  | 'notEvictable'
  /** Starting a card while its workspace is being given to another. */
  | 'evicting'
  /** Changing a card's new repository, or starting it, while Seismic is about to make it (`NewRepo.due`). */
  | 'newRepoDue'
  /** Building or starting a card in a new repository that has no folder named. */
  | 'newRepoPath'
  /** The undo window of a new repository is over: it is being made. */
  | 'newRepoGone'
  /** Every machine with a clean free clone has as many workers busy as it has slots. */
  | 'noSlot'
  | 'workspace'
  | 'emptyText'
  /** The cloud service for voice in failed or refused the check's sentence (the detail says what it said). */
  | 'voiceCloud'
  | 'unknownPreference'
  | 'unknownSetting'
  /** An uploaded screenshot is no image the agents read, or too large. */
  | 'imageType'
  | 'imageTooLarge'
  /** A dropped file is larger than Seismic keeps. */
  | 'fileTooLarge'
  /** Only a finished card of the owner's (or a stopped task, a parked or dropped idea) goes into the archive. */
  | 'notDone'
  /** A stopped card whose workspace holds work stays on the canvas. */
  | 'holdsWork'
  | 'notArchived'
  | 'notIdea'
  /** Merging or deleting by the Koordinator: the card is no planned task nobody has worked on (any more). */
  | 'notUntouched'
  /** Merging tasks of different repositories. */
  | 'otherRepos'
  /** The card holds no thread of looked-up answers (it is no Question card). */
  | 'notQuestion'
  /** A looked-up answer's file that is not in its thread's output directory. */
  | 'noFile'
  /** The idea's agent is still working on its reply: building or planning waits for it. */
  | 'ideaThinking'
  | 'noSplit'
  /** A prototype for the idea is still running. */
  | 'prototypeRunning'
  /** The prototype's idea is becoming a plan: its plan doc is not there yet. */
  | 'planPending'
  /** The prototype's idea is gone from the canvas, and no plan of it is there. */
  | 'ideaGone'
  /** The prototype's idea became a plan whose plan doc does not say which workstream builds on it, and none was chosen. */
  | 'workstreamMissing'
  /** The workstream to build on a prototype was started already. */
  | 'workstreamStarted'
  /** Every variant the idea's agent planned has its prototype on the canvas already. */
  | 'variantsRunning'
  /** A plan has no planned workstream left that is not already with the Koordinator. */
  | 'nothingToStart'
  /** The Koordinator could not read from a plan's plan doc which workstream builds on which, so it arranged nothing. */
  | 'arrangeFailed'
  /** The action is for a prototype on the canvas, and the card is none. */
  | 'notPrototype'
  /** A discarded or built prototype stays in the archive; a new attempt is a new prototype. */
  | 'prototypeEnded'
  /** Sharing: the card has no demo, or its repository shares none. */
  | 'noShare'
  /** Sharing: the page is being published or withdrawn right now. */
  | 'shareBusy'
  /** Sharing: the demo is not shared. */
  | 'notShared'
  /** Sharing many pages again: a run is under way already. */
  | 'reshareBusy'
  /** Setup: the folder for the first canvas is no git repository. */
  | 'notRepo'
  /** Setup: the folder a clone would go to exists already. */
  | 'cloneTarget'
  /** Setting up git in a folder: git has no name and e-mail for the first commit. */
  | 'noIdentity'
  /** Setting up git in a folder failed; it is as it was. */
  | 'gitSetup'
  /** Setup: an installation or a clone is running already. */
  | 'setupBusy'
  /** Sharing many pages again: no page is outdated. */
  | 'nothingOutdated'
  /** "Take over into the repository for everyone": this machine sets nothing to take over. */
  | 'noSettings'
  /** "Take over into the repository for everyone": the checkout on the main branch has changes of its own in `.obeya/settings.json`. */
  | 'settingsDirty'
  /** The commands to confirm changed on the default branch since the dialog showed them. */
  | 'trustChanged'
  /** "Take over into the repository for everyone": the commit, the push or the pull request failed; why comes with it. */
  | 'settingsShare'
  /** Export: the video is too large for one HTML file. */
  | 'exportTooLarge'
  /** Export: the HTML artifact loads files beside its page, so it does not fit one HTML file. */
  | 'exportNotAlone'
  /** Approval could not land the work on main. */
  | 'landDirty'
  | 'landConflict'
  | 'landEmpty'
  | 'landCheckout'
  | 'landMerge'
  /** Pushing approved work directly onto `origin`'s default branch was turned away (a protected branch, say). */
  | 'landPush'
  | 'land'
  /** A configuration with problems; they come with it. */
  | 'config'
  /** A voice's sample could not be made; why comes with it. */
  | 'voiceSample'
  /** A voice is being installed already. */
  | 'voiceInstalling'
  /** Malformed input: a bug in the UI rather than something the owner can fix. */
  | 'invalid';

/** A repository on a canvas, as Seismic's configuration lists it (`canvases.json`). */
export interface RepoConfig {
  path: string;
  /**
   * `false`: a folder without git that is to stay one (a document archive, say): every card works in
   * the folder itself, nothing lands, and each card lists what it changed (design: Folders without git).
   */
  git?: false;
  /** Clones to register as workspaces (adapters that use clones). */
  workspaces?: string[];
  /** Clones to create under Seismic's home (adapters that use clones). */
  clones?: number;
  /** How many of its workers may be busy at once on this machine; left out, as many as it has clones, or any number in worktrees. */
  slots?: number;
  /**
   * Other machines its workers run on, reached over SSH (design: Hosts), in the order a new card
   * looks for a free slot after this one. Only for a repository whose workers use clones and whose work goes out through its
   * remote.
   */
  hosts?: HostConfig[];
  /** The settings the owner set for this machine in the configuration dialog; each goes before the repository's `.obeya/settings.json`. */
  settings?: RepoSettings;
}

/** How the repository's app runs (`app` of its settings): the recipe the workers read, and the two commands Seismic runs itself. */
export interface AppSettings {
  /**
   * How to run the app, in prose for a new colleague: how to start it, what to do after which kind
   * of change, where it gives its address, the login and test data for a demo. Every worker's brief
   * has it; empty, each worker finds it out from the repository.
   */
  run?: string;
  /**
   * Stops the app in a workspace, and does nothing where none runs. Seismic runs it there when the
   * card waits for the owner and its worker has nothing running (Parking), and tells the worker with
   * its next message.
   */
  stop?: string;
  /** Exits 0 when the workspace's app holds what must not be lost (a restored database, say): Seismic then leaves it running. */
  keep?: string;
}

/** A demo site being set up at a host, as the configuration follows it: its last lines, and how it ended. */
export interface SiteSetupJob {
  /** The host Seismic sets it up at; none for a site entered by hand. */
  host?: 'cloudflare' | 'github';
  running: boolean;
  lines: string[];
  error?: string;
  /** The host the dialog offers where this one refused (GitHub Pages from a private repository without Pro). */
  offer?: 'cloudflare';
  /** The site once it is added (its URL). */
  site?: string;
}

/** A proposal for the tags of a canvas's demo site, as the configuration follows it: running, then the tags and why, or the error. */
export interface TagProposalJob {
  running: boolean;
  tags?: PageTags;
  why?: string;
  error?: string;
}

/**
 * A demo site this machine publishes to (`demo-sites.json` in Seismic's home): where it is served and
 * how it is deployed. A canvas chooses one and a path on it (`CanvasDemoSite`).
 */
export interface DemoSiteEntry {
  /** Where the site is served, without a trailing slash: a canvas's pages lie at `url/<path>/<slug>/`. */
  url: string;
  /** The command line that deploys the site's directory; `{dir}` stands for it. */
  deploy: string;
  /** A file of `KEY=value` lines, relative to Seismic's home, added to the deploy's environment (credentials). */
  env?: string;
  /** Headers for reading the live site's manifest and pages (behind a login), values `${KEY}` from `env`. */
  headers?: Record<string, string>;
  /** The largest file the host takes, in bytes; 25 MiB without it. */
  maxFile?: number;
  /** The host Seismic set it up at, and its project there; none for a site entered by hand. */
  host?: 'cloudflare' | 'github';
  project?: string;
  /** An unlisted site's directory the manifest is in: only the owner's machines know it. Without it the site is listed. */
  secret?: string;
}

/** The demo sites of this machine, as Configuration → Demos lists them. */
export interface DemoSitesView {
  sites: {
    url: string;
    host?: 'cloudflare' | 'github';
    project?: string;
    deploy: string;
    /** Listed: an overview and a feed per canvas; unlisted: a random part in each page's address and nothing else. */
    listed: boolean;
    /** The env file with its credentials this machine lacks, relative to Seismic's home. */
    needs?: string;
    /** The paths canvases have initialized on it ('' for its root), as this machine last saw it. */
    paths: string[];
  }[];
  /** The site being added, as far as it got. */
  job?: SiteSetupJob;
  /** The sites this machine deploys to on Cloudflare, each of another account: a new site may go into one of them. */
  cloudflareAccounts: string[];
}

/** The demo site a canvas shares its demos on: one of this machine's (`url`), and where on it. */
export interface CanvasDemoSite {
  /** The site, as this machine's list has it. */
  url: string;
  /** Where the canvas's overview and pages lie on the site (`billing`, `team/billing`); its root where left out. */
  path?: string;
  /**
   * When a demo goes on the site: `approved`, the card's latest demo as the owner approves its work
   * (before it lands); without it, only when the owner clicks "Share".
   */
  publish?: 'approved';
  /** The vocabulary the canvas's pages are tagged from: each dimension with its values, in the order the overview shows them. */
  tags?: PageTags;
}

/** A canvas's demo site as the page shows it: chosen, initialized, and the initialization under way or failed. */
export interface CanvasDemoSiteState {
  url: string;
  path: string;
  /** The canvas's path is initialized on the site: its demos share there. */
  ready: boolean;
  /** "Initialize": running ("Creating demo site"), or why it failed. */
  init?: { running: boolean; error?: string };
}

/**
 * A static site the demos are shared on, as a canvas uses it: a site of this machine's list
 * (`DemoSiteEntry`) with what the canvas adds. Seismic keeps its directory (one subdirectory per page,
 * and the overviews), writes the pages with its own templates and runs the deploy command after each
 * change.
 */
export interface DemoSite {
  /** The overview's heading, and the pages' tab titles. */
  title: string;
  /** Where the site is served; a page's URL is `url/<slug>/`. */
  url: string;
  /** The command line that deploys the site, run in the repository; `{dir}` stands for the site's directory. */
  deploy: string;
  /**
   * A file of `KEY=value` lines, relative to Seismic's home, added to the deploy's environment
   * (credentials, never in git). A machine without it exports demos instead of sharing them.
   */
  env?: string;
  /** Headers for reading the live site's manifest and pages (behind a login), values `${KEY}` from `env`. */
  headers?: Record<string, string>;
  /** The largest file the host takes, in bytes; 25 MiB without it. */
  maxFile?: number;
  /**
   * When a demo goes on the site: `approved`, the card's latest demo as the owner approves its work
   * (before it lands); without it, only when the owner clicks "Teilen".
   */
  publish?: 'approved';
  /**
   * The vocabulary pages are tagged from: each dimension with its values, in the order the overview
   * shows them. Workers and Seismic's reading session choose from it and add nothing to it.
   */
  tags?: PageTags;
}

/**
 * What Seismic needs to know about how a repository works, and its main branch, as the owner sets
 * them in the configuration dialog for this machine (design: Repository settings). Read where they
 * are used: saving them restarts nothing, but for `workspaces`, which restarts the repository's agents.
 */
export interface RepoSettings {
  /** Its main branch, where cards start from and work lands; detected where left out (`defaultBranch`). */
  branch?: string;
  /**
   * How approved work lands: `main` fast-forwards the checkout Seismic runs on to the worker's
   * branch (created clones then come from that checkout); `pr` leaves the branch for a pull
   * request (M5) and clones come from `origin`.
   */
  land?: 'main' | 'pr';
  /**
   * With `land: 'pr'`: the owner may approve a card's work directly onto the default branch
   * instead, without a pull request. Seismic rebases it onto `origin`'s default branch and pushes it
   * there (never forced); review and the CI of a pull request are skipped.
   */
  direct?: boolean;
  /**
   * With `land: 'pr'`: Seismic merges a pull request itself once nothing is left for the worker
   * (checks green, threads resolved, reviewers answered). `false` leaves the merge to the people
   * on the forge: the card then waits for the owner, ready to merge. Default: `true`.
   */
  autoMerge?: boolean;
  /** Checks a worker runs before it reports the card ready for review. */
  checks?: string[];
  /** Command a worker runs first in a fresh clone (dependencies). */
  setup?: string;
  /** Where plan docs live, relative to the repository root. */
  planDocs?: { dir: string; exclude: string[] };
  /**
   * Paths (a trailing `/` covers a directory) whose edits never count as a merge conflict between
   * two cards: they are resolved when a branch is rebased (docs, plan docs).
   */
  softPaths?: string[];
  /** Workers get full clones from a pool, or a worktree of the Seismic checkout per card. */
  workspaces?: 'clones' | 'worktrees';
  /** Accounts whose pull request comments are not review feedback (deploy bots and the like). */
  prNoise?: string[];
  /**
   * The language of what lands in the repository and lasts (code, comments, commit messages, docs,
   * plan docs, CLAUDE.md), whatever language the owner talks to its agents in; English where left out.
   */
  language?: Language;
  /** How the app runs: the recipe in every worker's brief, and how Seismic stops it while a card waits (Parking). */
  app?: AppSettings;
  /**
   * `site`: the static site Seismic keeps and deploys itself to share demos on (`src/server/site.ts`);
   * without one, "Teilen" exports a demo as a file. `language`: the language of the repository's
   * demos (narration, captions, report, shared pages) and of its site's overview, over the one of
   * the demo settings (`demo.json`), which applies without it. `artifacts`: what a handover on this
   * repository may bring (`HANDOVER_ARTIFACTS`), over the demo settings' list, which applies without it.
   */
  demo?: { language?: NarrationLanguage; artifacts?: HandoverArtifact[] };
}

/**
 * A repository's settings for everyone who runs Seismic on it, in `.obeya/settings.json` as its
 * default branch has it (design: Repository settings): those for this machine but the main branch,
 * which says where the file is read from.
 */
export type SharedSettings = Omit<RepoSettings, 'branch'>;

/** How a card's own branch says its work lands, where it changes the repository's settings for that. */
export type CardLanding = Partial<Pick<RepoSettings, 'land' | 'direct'>>;

/** The fields of `SharedSettings`, in the dialog's order. */
export const SHARED_FIELDS = ['land', 'direct', 'autoMerge', 'checks', 'setup', 'planDocs', 'softPaths', 'workspaces', 'prNoise', 'language', 'app', 'demo'] as const satisfies readonly (keyof SharedSettings)[];

/** The settings made of fields that are each set, layered and taken over on their own, and their fields. */
export const NESTED_SETTINGS = { app: ['run', 'stop', 'keep'], demo: ['language', 'artifacts'] } as const satisfies { [K in keyof RepoSettings]?: readonly (keyof NonNullable<RepoSettings[K]>)[] };
export type NestedSetting = keyof typeof NESTED_SETTINGS;
export const isNested = (field: string): field is NestedSetting => field in NESTED_SETTINGS;

/** `over` in front of `under`, field by field; the fields of `app` and `demo` each on its own. */
export function layerSettings<T extends RepoSettings>(under: T | undefined, over: T | undefined): T | undefined {
  if (!under) return over;
  if (!over) return under;
  const out: RepoSettings = { ...under, ...over };
  for (const k of Object.keys(NESTED_SETTINGS) as NestedSetting[]) if (under[k] || over[k]) out[k] = { ...under[k], ...over[k] };
  return out as T;
}

/**
 * Where a repository's setting comes from where this machine sets none, highest first: the
 * repository's `.obeya/settings.json`, the clones the configuration names (`workspaces` only),
 * detection (main branch, landing), Seismic's default.
 */
export type SettingSource = 'repository' | 'clones' | 'detected' | 'default';

/** A setting's value without this machine's, and where it comes from. */
export interface SettingValue<T> {
  value: T;
  source: SettingSource;
  /** A command of the repository's that does not count until the owner confirms it (`RepoCommands`). */
  held?: true;
}

/**
 * What of a repository's own files Seismic runs or contacts on this machine without a click, or its
 * agents' sessions run outside Claude Code's permission checks, by group: one confirmed by the
 * owner counts as long as the default branch has it so (design: Trusting a repository's commands).
 */
export interface RepoCommands {
  /** `app.stop` and `app.keep` of `.obeya/settings.json`, which park a waiting card: one without the other could stop what `keep` keeps. */
  app?: { stop?: string; keep?: string };
  /** The repository's own Claude Code configuration by file (everything under `.claude/`, `.mcp.json`): hooks, MCP servers, helpers. */
  claude?: Record<string, ClaudeFile>;
  /** The repository's own Codex configuration by file (everything under `.codex/`): settings, hooks, MCP servers, rules. */
  codex?: Record<string, ClaudeFile>;
}

/**
 * A file of a repository's Claude Code or Codex configuration: its git object, which tells one content from
 * another to the byte (a blob; a submodule's commit), and its text to read (a submodule's commit).
 */
export interface ClaudeFile {
  id: string;
  text: string;
}

export type TrustGroup = keyof RepoCommands;

/** The commands of a repository that do not count yet (`held`), as its default branch has them and as the owner last confirmed them. */
export interface RepoTrust {
  held: TrustGroup[];
  now: RepoCommands;
  before?: RepoCommands;
}

/** The lines of a group of commands, for the owner to read and compare: each field with its value, each file under its name. */
export function commandLines(c: RepoCommands | undefined, g: TrustGroup): string[] {
  const v = c?.[g];
  if (!v) return [];
  if (g === 'claude' || g === 'codex') return Object.entries(v as Record<string, ClaudeFile>).flatMap(([file, f]) => [`${file}:`, ...f.text.split('\n').map((l) => `  ${l}`)]);
  return Object.entries(v).map(([k, x]) => `${g}.${k}: ${typeof x === 'string' ? x : JSON.stringify(x)}`);
}

/** A repository's settings as they stand without this machine's: what the dialog shows where the owner set nothing. */
export interface RepoValues {
  branch: SettingValue<string>;
  land: SettingValue<'main' | 'pr'>;
  direct: SettingValue<boolean>;
  autoMerge: SettingValue<boolean>;
  checks: SettingValue<string[]>;
  setup: SettingValue<string>;
  planDocs: SettingValue<{ dir: string; exclude: string[] }>;
  softPaths: SettingValue<string[]>;
  workspaces: SettingValue<'clones' | 'worktrees'>;
  prNoise: SettingValue<string[]>;
  language: SettingValue<Language>;
  app: { run: SettingValue<string>; stop: SettingValue<string>; keep: SettingValue<string> };
  demo: { language: SettingValue<NarrationLanguage | null>; artifacts: SettingValue<HandoverArtifact[]> };
}

/**
 * A repository's entry in the configuration without what applies as it is read (its settings but
 * where its workers work): where it differs, the repository's agents restart with it.
 */
export function repoShape({ settings, ...r }: RepoConfig): string {
  return JSON.stringify({ ...r, workIn: settings?.workspaces });
}

/** Whether saving `after` over `before` restarts or stops some repository's agents: one that left, or whose shape changed (`repoShape`). */
export function restartsAgents(before: CanvasConfig[], after: CanvasConfig[]): boolean {
  const shapes = (canvases: CanvasConfig[]) => new Map(canvases.flatMap((c) => c.repos.map((r) => [r.path, repoShape(r)] as const)));
  const now = shapes(after);
  return [...shapes(before)].some(([path, shape]) => now.get(path) !== shape);
}

/** The clones a repository gets whose settings say clones, the first canvas's or one added later: two cards run at once. */
export const CLONES = 2;

/**
 * Where the count of a repository added in the dialog stands (`withClones`): `filled`, the dialog's
 * `CLONES` is in; `withdrawn`, the dialog took it out again for the existing clones listed; `owner`,
 * the count is the owner's (typed, changed, emptied, or there before the dialog had a say). A path
 * not in it has had nothing filled in yet.
 */
export type FilledClones = Map<string, 'filled' | 'withdrawn' | 'owner'>;

/**
 * The draft with `CLONES` filled in for each repository the saved configuration does not have whose
 * settings say clones (`resolved`, by index) and that names none, once per path, or null when it
 * changes nothing. The dialog's number goes again once existing clones are listed beside it (they
 * add up, so 2 beside 2 existing would make 4) and comes back when the list is emptied, as long as
 * the owner has not touched it; `filled` keeps where each path stands, so a count of the owner's,
 * emptied included, stays as it is.
 */
export function withClones(draft: CanvasConfig[], saved: CanvasConfig[], resolved: (ResolvedCanvas | null)[], filled: FilledClones): CanvasConfig[] | null {
  const known = new Set(saved.flatMap((c) => c.repos.map((r) => r.path.trim())));
  let changed = false;
  const next = draft.map((c, i) => ({
    ...c,
    repos: c.repos.map((r, j) => {
      const path = r.path.trim();
      if (!path || known.has(path) || resolved[i]?.repos[j]?.workspaces !== 'clones') return r;
      const existing = !!r.workspaces?.some((w) => w.trim());
      const state = filled.get(path);
      if (state === 'owner') return r;
      // the count is no longer the one the dialog left: the owner's from now on
      if (r.clones !== (state === 'filled' ? CLONES : undefined)) {
        filled.set(path, 'owner');
        return r;
      }
      if ((state === 'filled') === !existing) return r;
      changed = true;
      filled.set(path, existing ? 'withdrawn' : 'filled');
      if (!existing) return { ...r, clones: CLONES };
      const { clones: _, ...rest } = r;
      return rest;
    }),
  }));
  return changed ? next : null;
}

/** A machine reached over SSH that a repository's workers run on, in clones of their own there. */
export interface HostConfig {
  /** What the owner calls it; workspaces there are named by it. */
  name: string;
  /** What `ssh` connects to: `user@machine`, or a name from `~/.ssh/config`. */
  ssh: string;
  /** The directory there that holds the clones (`~/…` in that machine's home). */
  root: string;
  /** How many clones Seismic keeps there (`<root>/1`, `<root>/2`, …). */
  clones: number;
  /** How many of the repository's workers may be busy there at once; as many as it has clones when left out. */
  slots?: number;
}

/**
 * A canvas's own settings, beside its name, id and repositories. Each has a value in Canvas
 * defaults, copied into a canvas when it is created (design: Canvas defaults).
 */
export interface CanvasSettings {
  /** Tag each plan’s starting commit and configure its workstream branches with it; on by default. */
  planBaselines?: boolean;
  /**
   * How finished cards go into the archive: by the owner's hand (`manual`, the default; the owner is
   * asked how the agent did when archiving it), or by themselves once their work landed and their
   * worker is done (`landed`; asked right after the approval).
   */
  archive?: CardArchiving;
  /** Which labels Seismic suggests on the canvas's cards ("Seismic suggests"); all where left out. */
  suggest?: SuggestSettings;
  /** The canvas's own harness, model and effort for groups of its agents, over Configuration's; none where left out. */
  agents?: CanvasAgents;
  /** Whether a separate agent reviews work that lands on `main`, with the demo or on the owner's word; off where left out. */
  codeReviews?: Partial<CodeReviewSetting>;
  /** The demo site its demos are shared on, and where on it; none where left out (demos are exported). */
  demoSite?: CanvasDemoSite | null;
}

/** A canvas's own harness, model or effort per group; a field left out follows Configuration's "Agents and models". */
export type CanvasAgents = Partial<Record<AgentRole, Partial<AgentSetting>>>;

/** The canvas settings sheet: the canvas's settings as they apply, and Configuration's models it falls back on. */
export interface CanvasSettingsView {
  settings: CanvasDefaults;
  agents: Record<AgentRole, AgentSetting>;
}

/** A canvas in Seismic's configuration. */
export interface CanvasConfig extends CanvasSettings {
  /** Names the canvas; its id follows. Without it, both are the first repository's name. */
  name?: string;
  /** Keeps the canvas's id, and with it its cards, whatever its name says: set when a canvas is renamed. */
  id?: string;
  repos: RepoConfig[];
}

/** Canvas defaults as they apply: every canvas setting with its value. */
export type CanvasDefaults = Required<Omit<CanvasSettings, 'codeReviews'>> & { codeReviews: CodeReviewSetting };

/** Canvas defaults in Seismic's home, and the file they are saved in. */
export interface CanvasDefaultsView {
  file: string;
  defaults: CanvasDefaults;
}

/** What a configuration amounts to: each canvas's id and name, and its repositories with their settings. */
export interface ResolvedCanvas {
  id: string;
  name: string;
  repos: {
    id: string;
    workspaces: 'clones' | 'worktrees';
    /** A folder without git (`RepoConfig.git` false): no branch, landing, clones or hosts. */
    folder?: true;
    /**
     * It still has a `.obeya/adapter/` on its main branch, which Seismic no longer reads: its values
     * belong in `.obeya/settings.json` (problem `adapterGone`).
     */
    adapterGone?: boolean;
    /** Its settings without this machine's, with where each comes from. */
    values: RepoValues;
    /** Its commands that wait for the owner to confirm them (problem `untrusted`). */
    trust?: RepoTrust;
    /**
     * Where "Take over into the repository for everyone" puts `.obeya/settings.json`: a commit on the main
     * branch where work lands there, else a pull request.
     */
    shareTo: 'main' | 'pr';
    /** Where it goes out as a pull request, it may also be pushed straight onto `origin`'s main branch (`direct`). */
    shareDirect?: boolean;
    /**
     * On a canvas that runs: the clones its pool loses with this configuration (path on its machine,
     * the host where not here, the number where Seismic made it, the title of the card that holds it).
     */
    leaving?: LeavingClone[];
  }[];
}

/** A clone a repository's pool loses with a configuration (`ResolvedCanvas`). */
export interface LeavingClone {
  path: string;
  host?: string;
  /** Its number where Seismic made it; its folder goes once nothing in it would be lost. One the owner listed has none, and stays on disk. */
  made?: number;
  /** The title of the card that holds it: it leaves once that card gives it back. */
  card?: string;
}

/** Something in a configuration that keeps Seismic from starting with it; `canvas` and `repo` count from 0. */
export interface ConfigProblem {
  code: ConfigProblemCode;
  canvas?: number;
  repo?: number;
  /** In English, for developers and the Koordinator. */
  detail: string;
}

/** Whether a problem keeps the configuration from being saved: not one in the repository, which is fixed there. */
/** Problems of the running canvases, not of the configuration: a canvas or repository that did not start as it has them (`StartFailure`). Saving the configuration, or "Try again", has them try again. */
export const START_FAILED: ConfigProblemCode[] = ['canvasDown', 'repoDown', 'repoBefore'];

export const blocksSaving = (p: ConfigProblem) => !['adapterGone', 'repoSettings', 'untrusted', ...START_FAILED].includes(p.code);

export type ConfigProblemCode =
  /** No canvas at all. */
  | 'noCanvas'
  | 'noRepo'
  /** A repository whose path is empty. */
  | 'noPath'
  /** A path that is no git repository. */
  | 'notRepo'
  /** A folder without git (`RepoConfig.git` false) whose path is no folder. */
  | 'noFolder'
  /** A repository the canvas has already, under this path or another. */
  | 'sameRepo'
  /** The repository still has a `.obeya/adapter/`, which Seismic no longer reads: its values belong in `.obeya/settings.json`. */
  | 'adapterGone'
  /** Two canvases with the same id. */
  | 'sameId'
  /** The repository the canvas was first served with is missing. */
  | 'homeMissing'
  /** A clone listed as a workspace that is no git repository. */
  | 'notClone'
  /** A clone listed as a workspace whose origin is another repository's. */
  | 'otherClone'
  /** A host that cannot work for the repository: its workers use worktrees, or its work does not go out through a remote. */
  | 'hostRepo'
  /** Two hosts of one name that connect to different machines. */
  | 'hostName'
  /** A main branch set for this machine that the repository does not have. */
  | 'noBranch'
  /** Something in the repository's `.obeya/settings.json` that does not count (fixed there, so it keeps nothing from being saved). */
  | 'repoSettings'
  /** Commands of the repository, new or changed on its default branch, that wait for the owner to confirm them (`RepoTrust`). */
  | 'untrusted'
  /** The canvas does not run: its home repository did not start (a git error, say). */
  | 'canvasDown'
  /** The repository did not start: it is left out of its canvas, its cards kept. */
  | 'repoDown'
  /** The repository's agents did not start as the configuration has them now: they work on as they were set up before. */
  | 'repoBefore'
  /** Malformed: a bug in whoever wrote it. */
  | 'invalid';

/**
 * Seismic's configuration as the owner sees and edits it, at once: what it amounts to and what is
 * wrong with it come after, from its check (`ConfigChecked`), which reads every repository.
 */
export interface ConfigView {
  /** The file it is saved in. */
  file: string;
  /** Where the running canvases come from: that file, or repositories named on the command line. */
  source: 'file' | 'args';
  /** As saved (or as given on the command line, before anything is saved). */
  canvases: CanvasConfig[];
  /** The ids of the canvases this server runs. */
  running: string[];
  /**
   * Settings of the running server, from its command line; its version (`package.json`), and the
   * commit of the checkout it runs from (null for the compiled binary).
   */
  server: { port: number; home: string; permissionMode: string; restarts: boolean; version: string; commit: string | null };
  /** Saved, and Seismic starts again with it once no agent is in the middle of a turn. */
  restarting: boolean;
}

/** A configuration checked: what it amounts to and what keeps it from working. */
export interface ConfigChecked {
  /** As saved, tidied. */
  canvases: CanvasConfig[];
  /** What they amount to, by index; null for a canvas with a problem. */
  resolved: (ResolvedCanvas | null)[];
  problems: ConfigProblem[];
}

/** What "Take over into the repository for everyone" did with a repository's settings for this machine. */
export type SettingsShared =
  /** Committed `.obeya/settings.json` on the main branch (pushed onto `origin`'s, where it went there directly): the settings now come from the repository. */
  | { committed: string; branch: string }
  /** Opened a pull request with it: once it is merged, the settings come from the repository. */
  | { pr: string };

/** What saving the configuration did: Seismic starts again with it, or (repositories' settings alone) it applies at once. */
export interface ConfigSaved {
  restarting: boolean;
  /** Seismic runs with it now: canvases and repositories new in it started, settings apply as they are read, and agents whose repository's set-up changed restart once they paused. */
  applied?: boolean;
}

/** What keeps the demo settings from working (a voice to install is not one: `DemoVoiceCheck.install`). */
export type DemoSettingsProblem =
  /** `command` without one. */
  | 'noCommand'
  /** The own endpoint, or Azure's region, is missing. */
  | 'noUrl'
  /** A service without its environment variable or a key file. */
  | 'noKey'
  | 'keyFileMissing'
  /** `say` is macOS only. */
  | 'notHere'
  /** A Qwen3 speaker the model does not have. */
  | 'unknownSpeaker';

/** What keeps one of Qwen3's clips to clone from working: it is not there, or its transcript beside it. */
export type ClipProblem = 'referenceMissing' | 'noTranscript';

/** What the settings sheet shows about a voice, saved or not yet. */
export interface DemoVoiceCheck {
  /** The person the narration speaks in, which follows from whether the voice is the owner's own. */
  person: 'first' | 'third';
  problems: DemoSettingsProblem[];
  /** The clips to clone that do not work, by their language. */
  clips: Partial<Record<NarrationLanguage, ClipProblem>>;
  /** What the voice needs installed by Seismic and is missing (Piper, Qwen3-TTS), and about how much that is. */
  install: { installed: boolean; missing: string[]; mb: number };
  /** The directory demos go into, as these settings name it (`~` expanded), else the default. */
  directory: string;
  /** The settings name a relative directory, which counts as none: it would land wherever the agent works. */
  directoryRelative?: true;
}

/** An installation Seismic runs for a voice, one at a time. */
export interface VoiceInstallJob {
  voice: VoiceKind;
  running: boolean;
  /** The last line of its output. */
  line: string;
  error?: string;
}

/** The demo settings (`plugin/skills/demo/lib/settings.ts`) as the settings sheet shows them. */
export interface DemoSettingsView {
  /** The file they are saved in, under Seismic's home. */
  file: string;
  settings: DemoSettings;
  /** The saved voice checked. */
  check: DemoVoiceCheck;
  /** The installation running or last run, while Seismic runs. */
  job?: VoiceInstallJob;
  /** `process.platform` of the server: `say` is offered on a Mac only. */
  platform: string;
  /** What demos take on disk, and how long their frames are kept; none where Seismic does not look after the demo directory (tests). */
  space?: DemoSpaceView;
}

/** The demo directory's disk space (`src/server/demo-space.ts`). */
export interface DemoSpaceView {
  /** Days after a demo's last render that its frames are kept, as applies now; null: always. */
  keepDays: number | null;
  /** What applies while the demo settings name nothing; null: always. */
  defaultDays: number | null;
  /** Counting or deleting right now. */
  busy: boolean;
  /** What the demo directory took at the last count, and its renders' work directories (`.work`) of that. */
  used?: { bytes: number; work: number; at: string };
  /** The last deletion that found frames to delete, since Seismic started. */
  freed?: { at: string; demos: number; bytes: number };
}

/** The owner's languages (`src/server/settings.ts`): the interface's, chosen else the system's, and the conversation's, chosen else English. */
export interface LanguageView {
  /** The file it is saved in, under Seismic's home. */
  file: string;
  /** The interface language the owner chose; `null` follows the system. */
  chosen: Language | null;
  /** The system's language, or the fallback when Seismic does not speak it. */
  system: Language;
  /** The one that applies. */
  language: Language;
  /** The conversation language the owner chose; `null` uses English. */
  conversationChosen: Language | null;
  /** The conversation language that applies: agents write the owner in it unless a standing language preference overrides it. */
  conversation: Language;
}

/** The look Seismic's pages take (`src/server/settings.ts`): light or dark as chosen in the settings, else as the system's. */
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export interface ThemeView {
  /** The file it is saved in, under Seismic's home. */
  file: string;
  /** What the owner chose; `null` follows the system. */
  chosen: Theme | null;
}

/** How much Seismic's pages move (`src/server/settings.ts`): `reduced` drops animations, camera flights and blurs; unset, as the system's reduce-motion setting. */
export const MOTIONS = ['full', 'reduced'] as const;
export type Motion = (typeof MOTIONS)[number];
export interface MotionView {
  /** The file it is saved in, under Seismic's home. */
  file: string;
  /** What the owner chose; `null` follows the system. */
  chosen: Motion | null;
}

/**
 * One of the usage limits of the Claude plan Claude Code is logged in with on this machine, as the
 * plan's usage endpoint reports it (src/server/usage.ts): how much of its window is used, and when
 * the window starts anew.
 */
export interface UsageLimit {
  /** The endpoint's kind of meter: `session` (five hours), `weekly_all`, `weekly_scoped` (one model's), or one Seismic does not know yet. */
  kind: string;
  /** The endpoint's group of the meter: `session` or `weekly`. */
  group: string;
  /** What a scoped meter is for, as the endpoint names it: a model (`Fable`) or a surface. */
  scope?: string;
  /** Share of the window used, 0–100. */
  percent: number;
  /** When the window starts anew (ISO time), when the endpoint says. */
  resetsAt?: string;
  /** The endpoint's grade of the meter: `normal`, `warning` or `critical`. */
  severity: string;
}

/** The plan's usage limits as last fetched, for the bar while the owner has it show them. */
export interface Usage {
  limits: UsageLimit[];
  /** When they were fetched (ISO time). */
  at: string;
}

/** Whether the bar shows the plan's usage limits (`src/server/settings.ts`); on until the owner turns it off. */
export interface UsageMeterView {
  /** The file it is saved in, under Seismic's home. */
  file: string;
  on: boolean;
}

/** Whether the desktop notifies the owner when a card needs them (`src/server/settings.ts`); `null` until they were asked. */
export interface NotificationsView {
  /** The file it is saved in, under Seismic's home. */
  file: string;
  on: boolean | null;
}

/** Whether approving a card's work asks the owner for feedback on it (`src/server/settings.ts`); on until the owner turns it off. */
export interface FeedbackPromptView {
  /** The file it is saved in, under Seismic's home. */
  file: string;
  on: boolean;
}

/**
 * How other devices reach Seismic, when the owner lets them (`src/server/remote.ts`): through
 * `tailscale serve`, which gives an HTTPS address in the tailnet, or on an address of this machine
 * the owner picks (another VPN's interface), in plain HTTP.
 */
export type RemoteSetting = ({ via: 'tailscale' } | { via: 'address'; address: string }) & {
  /** `always`: the machine does not idle-sleep while Seismic runs; otherwise only while a worker works. */
  awake?: 'always';
};

/** What Tailscale allows on this machine, as `tailscale status` says. */
export type TailscaleState =
  | { state: 'missing' }
  /** Installed, but its service does not run (or the CLI cannot reach it). */
  | { state: 'stopped' }
  | { state: 'loggedOut' }
  /** Logged in, but HTTPS certificates are off in the tailnet: `tailscale serve` cannot give an HTTPS address. */
  | { state: 'noHttps'; name: string; enable?: string }
  /**
   * `account`: the login it runs as, which the phone logs in with too; `others`: how many other
   * devices the tailnet has, none while the phone is not in it yet.
   */
  | { state: 'ready'; name: string; account?: string; others: number };

/** Why the address does not answer for other devices, though the setting is on. */
export type RemoteProblem =
  /** On Linux `tailscale serve` needs the operator right, given once (`sudo tailscale set --operator=$USER`). */
  | { code: 'operator' }
  /** Ports 443, 8443 and 10000 of the tailnet name already serve something else. */
  | { code: 'portsTaken' }
  /** The address picked is not one of this machine's, or listening on it failed. */
  | { code: 'listen'; detail: string }
  | { code: 'failed'; detail: string };

/** A device paired with Seismic: its cookie lets it in from another machine. */
export interface DeviceView {
  id: string;
  /** From its browser's user agent: "iPhone · Safari". */
  name: string;
  pairedAt: string;
  lastSeen: string;
  /** It turned notifications on: Seismic pushes to it. */
  push?: true;
}

/** A one-time code that pairs a device: in the QR code with the address, and to type in. */
export interface Pairing {
  code: string;
  /** The address with the code, which the QR code holds. */
  url: string;
  expires: string;
  /** The device it paired, once one did. */
  paired?: DeviceView;
}

/** The section "Other devices" and "Connect a phone" (`/api/access`), for a page on this machine. */
export interface AccessView {
  local: true;
  /** The file the setting is saved in. */
  file: string;
  /** `null`: other devices do not reach Seismic. */
  remote: RemoteSetting | null;
  tailscale: TailscaleState;
  /** Where other devices reach Seismic now; `null` while they do not. */
  address: string | null;
  problem?: RemoteProblem;
  /** This machine's addresses beyond loopback, to pick one for another VPN. */
  addresses: string[];
  devices: DeviceView[];
  pairing: Pairing | null;
  /** The server's platform: what to install or run differs by it. */
  platform: string;
}

/** The agents Seismic runs, grouped as the owner sets their model and effort (`src/server/settings.ts`). */
export const AGENT_ROLES = ['koordinator', 'worker', 'explorer', 'chores', 'review'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];
/** The groups whose agents may run in another harness than Claude Code: workers, and the code reviews of their work. */
export const HARNESS_ROLES = ['worker', 'review'] as const satisfies readonly AgentRole[];
export const choosesHarness = (role: AgentRole): boolean => (HARNESS_ROLES as readonly AgentRole[]).includes(role);
/** The models offered: Claude Code's default, or one of its aliases, each the newest of its family. */
export const AGENT_MODELS = ['default', 'fable', 'opus', 'sonnet', 'haiku'] as const;
export type AgentModel = (typeof AGENT_MODELS)[number];
export const AGENT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AgentEffort = (typeof AGENT_EFFORTS)[number];
/** The model and effort a group of agents runs with. */
export interface AgentSetting {
  model: AgentModel;
  effort: AgentEffort;
  /** Absent means Claude. Only local Git workers and code reviews (`HARNESS_ROLES`) offer another harness. */
  harness?: Harness;
  /** Codex choices are separate from Claude aliases, which survive switching back. */
  codex?: { model: string; effort: AgentEffort };
  /** Antigravity (`agy`) choices, kept apart from the others in the same way. */
  agy?: { model: string; effort: AgentEffort };
}

/** The coding agents a worker or code review can run in: Claude Code (the default), Codex and Antigravity (`agy`), the latter two in preview. */
export const HARNESSES = ['claude', 'codex', 'agy'] as const;
export type Harness = (typeof HARNESSES)[number];

/** The model and effort of `setting` in the harness it names (Claude's aliases for Claude Code). */
export function harnessChoice(setting: AgentSetting): { model: string; effort: AgentEffort } {
  const own = setting.harness === 'codex' ? setting.codex : setting.harness === 'agy' ? setting.agy : undefined;
  return setting.harness && setting.harness !== 'claude' ? (own ?? { model: 'default', effort: setting.effort }) : setting;
}

/** Discovered from the installed Codex account, never a hardcoded model alias. */
export interface CodexModel {
  model: string;
  isDefault: boolean;
  supportedReasoningEfforts: { reasoningEffort: string }[];
  inputModalities: string[];
}
/** What applies until the owner chooses otherwise: Opus throughout, high effort for workers, exploration agents and code reviews. */
export const AGENT_DEFAULTS: Record<AgentRole, AgentSetting> = {
  koordinator: { model: 'opus', effort: 'medium' },
  worker: { model: 'opus', effort: 'high' },
  explorer: { model: 'opus', effort: 'high' },
  chores: { model: 'opus', effort: 'medium' },
  review: { model: 'opus', effort: 'high' },
};

/** The model and effort of each group of agents, as they apply (`settings.json` over `AGENT_DEFAULTS`). */
export interface AgentsView {
  file: string;
  agents: Record<AgentRole, AgentSetting>;
  /** Codex workers' approvals go to Codex's own automatic review, not the owner. */
  codexAutoReview: boolean;
}

/**
 * The cloud services Seismic's voice in can send recordings to instead, all with the OpenAI-style
 * `/audio/transcriptions` endpoint (`src/server/voice-cloud.ts`). `prompt`: it takes the card
 * titles as vocabulary. `openai` stands for any compatible endpoint: base URL and model can be changed.
 */
export const CLOUD_VOICES = {
  groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo', keys: 'https://console.groq.com/keys', prompt: true },
  mistral: { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'voxtral-mini-latest', keys: 'https://console.mistral.ai/api-keys', prompt: false },
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-transcribe', keys: 'https://platform.openai.com/api-keys', prompt: true },
} as const;
export type CloudPreset = keyof typeof CLOUD_VOICES;
export const CLOUD_PRESETS = Object.keys(CLOUD_VOICES) as CloudPreset[];

/** A cloud service as the owner set it up (its key stays on the server; the page only learns there is one). */
export interface CloudVoiceView {
  preset: CloudPreset;
  baseUrl: string;
  model: string;
  key: boolean;
  /** Recordings go to it rather than to the recognition on this machine. */
  used: boolean;
  /** How long it took for the check's sentence when it was last tested. */
  tested?: { seconds: number };
}

/**
 * How long the recognition on this machine took for the short sentence Seismic ships with
 * (`voice/check-de.ogg`), loaded and warm. `slow`: longer than the sentence itself.
 */
export interface VoiceSpeed {
  backend: ListenBackend;
  seconds: number;
  slow: boolean;
}

/** What Seismic's own voice in needs on this machine (`src/server/voice-setup.ts`). */
export type VoiceSetupId = 'recognition' | 'ffmpeg' | 'uv';
export type VoiceSetupItem = Omit<SetupItem, 'id'> & {
  id: VoiceSetupId;
  /** The recognition, which uv fetches: "Installieren" waits until uv is there. */
  waits?: 'uv';
} & VoiceRecognitionParts;

/** What the recognition's line carries besides its state: how fast it is here, and the cloud service. */
export interface VoiceRecognitionParts {
  /** Measured on this machine; `measuring` while it is. */
  speed?: VoiceSpeed | 'measuring';
  cloud?: CloudVoiceView;
}

export interface VoiceSetupView {
  platform: string;
  arch: string;
  listen: ListenBackend;
  items: VoiceSetupItem[];
  /** About how much "Installieren" fetches (the recognition and its model); 0: nothing to fetch. */
  fetch: { mb: number };
  /** The installation or measurement running or last run. */
  job?: { running: boolean; step: 'fetch' | 'measure'; error?: string };
}

/** The setup assistant's list (`src/server/machine.ts`): what Seismic needs on this machine, by what it is for. */
export type MachineSectionId = 'needed' | 'pr' | 'agents' | 'voice' | 'demos' | 'mobile';
/** The sections of the recommended page; the others are the required one's. */
export const RECOMMENDED_SECTIONS: readonly MachineSectionId[] = ['agents', 'mobile'];
/** Claude Code, its login, git and git's name and e-mail for commits. */
export type NeededId = 'claude' | 'claudeLogin' | 'git' | 'gitUser';
/** Antigravity (`agy`) and its Google login: another agent for tasks and code reviews. */
export type AgentsId = 'agy' | 'agyLogin';
/** gh and its login. */
export type PrId = 'gh' | 'ghLogin';
/** Mobile development on a Mac: Xcode, an iPhone simulator, `safaridriver --enable`, and AXe. */
export type MobileId = 'xcode' | 'simulator' | 'safaridriver' | 'axe';

/** A piece of the list, as a setup check gives it, and what Seismic does about it at a click. */
export type MachineItem = Omit<SetupItem, 'id'> & {
  id: NeededId | PrId | AgentsId | MobileId | VoiceSetupId | SetupId;
  /**
   * `install`: Seismic installs it (no admin rights, or Homebrew or winget). `login`: Seismic opens a
   * terminal that logs in. `terminal`: Seismic opens a terminal that runs the command and closes
   * once it is through (`safaridriver --enable`, which asks for a password). `identity`: the owner
   * gives git's name and e-mail, which Seismic sets.
   */
  act?: 'install' | 'login' | 'terminal' | 'identity';
  /** What has to be installed first (uv, which brings the speech recognition). */
  waits?: 'uv';
} & VoiceRecognitionParts;

export interface MachineSection {
  id: MachineSectionId;
  items: MachineItem[];
  /** About this many megabytes still to download for what the section is for (voice, demos). */
  mb: number;
}

/** An installation, a login or a clone Seismic runs for the assistant, one at a time. */
export interface MachineJob {
  kind: 'install' | 'clone';
  section?: MachineSectionId;
  id?: MachineItem['id'];
  running: boolean;
  /** The last line of its output. */
  line: string;
  error?: string;
  /** A clone that became the first canvas: its id, opened once Seismic runs it. */
  canvas?: string;
  /** Its main branch. */
  branch?: string;
  /** Seismic runs it now, or starts again with it by itself; else the owner starts Seismic again. */
  opens?: boolean;
}

export interface MachineView {
  platform: string;
  arch: string;
  sections: MachineSection[];
  /** The Claude Code Seismic was checked with (the Agent SDK's); the machine's may be newer or older. */
  checkedClaude: string;
  job?: MachineJob;
  /** Seismic can open the system's folder dialog here. */
  picker: boolean;
  /** Where a clone goes by default: the owner's home directory. */
  cloneInto: string;
}

/** What choosing the first canvas did: it is saved, and Seismic runs it (`opens`), or the owner starts Seismic again. */
export interface FirstCanvas {
  canvas: string;
  /** The repository's main branch, as Seismic found it. */
  branch: string;
  opens: boolean;
}

/** A folder for the first canvas, looked at before it is saved: whether it holds a repository, and on which main branch. */
export interface SetupFolder {
  repo: boolean;
  branch?: string;
  /** A folder without a repository, in which git can be set up. */
  folder?: boolean;
}

/** From this size on a file is marked as large in the preview of a first commit. */
export const LARGE_FILE = 1_000_000;

/** What the first commit of a folder without git would hold, shown before the owner confirms it. */
export interface GitSetupPreview {
  path: string;
  /** The branch the repository starts on. */
  branch: string;
  /** The `.gitignore` Seismic writes, where the folder has none. */
  gitignore?: string;
  files: number;
  bytes: number;
  /** What goes in, by the folder's own entries: a directory with its files counted. */
  entries: { path: string; dir: boolean; files: number; bytes: number }[];
  /** Files of a size worth a second look, largest first. */
  large: { path: string; bytes: number }[];
  /** What stays out, as git lists it (an ignored directory once). */
  ignored: string[];
}

/**
 * Why Seismic starts again: new code on the checkout it runs from, a configuration the owner saved,
 * a repository's `.obeya/settings.json` changed on its default branch where its agents work, a
 * new version of the app the owner installs, or the Mac app taking over an Seismic that runs without
 * the app that started it (app/src/main.rs, `orphaned`); or why it stops for good (Ctrl-C, SIGTERM).
 */
export type RestartReason = 'code' | 'config' | 'repository' | 'owner' | 'rebuild' | 'update' | 'takeover' | 'stop';

/** What the Developer section of the Konfiguration dialog may do: each is false where Seismic cannot (no supervisor, no checkout). */
export interface DeveloperView {
  /** Restarting the server: only under the supervisor that starts it again (not with --dev). */
  restart: boolean;
  /** Installing the dependencies again and restarting: only from a checkout. */
  rebuild: boolean;
  /** Why restarting is off, when it is: `dev` (--dev runs without the supervisor). */
  why?: 'dev';
  /** Why rebuilding is off, when restarting is not: `compiled` (the app or the binary has no checkout). */
  rebuildWhy?: 'compiled';
}

/** A newer version of the app that its shell has downloaded (app/src/update.rs), shown in the bar. */
export interface AppUpdate {
  version: string;
  /** What changed, from the release. */
  notes?: string;
  /** When it was released (ms since the epoch). */
  date?: number;
  /** Where to get it, when the app cannot install it itself (a .deb). */
  download?: string;
}

/**
 * New commits on the upstream of the checkout Seismic runs from (`origin/main`, say) that change code,
 * shown in the bar for the owner to pull (src/server/source-update.ts).
 */
export interface SourceUpdate {
  /** The upstream, as git names it: `origin/main`. */
  upstream: string;
  /** The checkout's directory. */
  checkout: string;
  /** How many commits the upstream has that the checkout does not. */
  count: number;
  /** The newest of them (at most ten), newest first: subject and when it was committed (ms since the epoch). */
  commits: { subject: string; date: number }[];
  /**
   * Why Seismic cannot pull them itself, if it cannot: the checkout has commits of its own (`diverged`,
   * a fast-forward is not possible), or uncommitted changes to files the new commits change (`local`).
   */
  blocked?: { why: 'diverged' } | { why: 'local'; files: string[] };
  /** What git said when the owner's last pull failed. */
  error?: string;
}

/** What the owner does in an open page that a restart would cut off: watching a demo video, dictating. */
export type OwnerHold = 'video' | 'voice';

/** A restart that waits for workers to finish their turns, or for the owner, as one canvas sees it. */
export interface PendingRestart {
  reason: RestartReason;
  /** When it goes ahead however busy the workers are (ms since the epoch). */
  deadline: number;
  /** The cards on this canvas whose worker it waits for. */
  cards: string[];
  /** The workers on other canvases it waits for: each canvas (by name) with its cards' titles. */
  elsewhere: { canvas: string; cards: string[] }[];
  /** What the owner does in some open page that it waits for, past the deadline too. */
  owner: OwnerHold[];
  /** Only the agents of these repositories (by name) restart, for a change to their configuration; Seismic and the others work on. */
  repos?: string[];
  /** The canvas left the configuration: it stops once its agents paused. */
  leaving?: boolean;
}

/** UI → server over the WebSocket. */
export type ClientMessage =
  /** What the owner does in this page that a restart waits for (sent on every change). */
  | { type: 'hold'; hold: OwnerHold[] }
  /** The owner came back to this page (from GitHub, say): what Seismic polls is looked at now. */
  | { type: 'back' }
  /** The owner uses this page: it is in view and they moved, typed or scrolled in it (or a video plays) within the last half minute. */
  | { type: 'here' }
  /** This page went out of view (on a phone: locked, or another app in front). */
  | { type: 'away' }
  /** Is the server there? It answers `pong` as soon as its event loop gets to it; no answer means it is frozen. */
  | { type: 'ping' }
  /**
   * What the owner has in view (sent on every change and when the page gets the focus back):
   * `place`, the middle of the canvas in view and its bounds (`placeParam`), where a new card goes
   * that a command without a place of its own makes.
   */
  | { type: 'focus'; place?: string }
  /** This page froze: the server logs it beside its own stalls. */
  | ({ type: 'stall' } & PageStall);

/**
 * A page that froze for `ms`: where the time went as far as the browser tells (the scripts of its
 * long frames, longest first, e.g. "WebSocket.onmessage (index.js:1204)"), and what the page did
 * shortly before (the server's messages it took in).
 */
export interface PageStall {
  ms: number;
  scripts: { what: string; ms: number }[];
  before: string[];
}

/** Server → UI over the WebSocket. */
export type ServerMessage =
  | { type: 'snapshot'; snapshot: CanvasSnapshot }
  | { type: 'event'; event: CardEvent }
  /** A line taken out of the card's log: a comment the owner deleted before it went to the worker. */
  | { type: 'eventGone'; cardId: string; id: number }
  /**
   * First on every connection: which server process this is, so a page from an earlier one
   * reloads; and the version of Bun it runs on when that is too old (`oldLinuxBun`), for the bar.
   */
  | { type: 'hello'; server: string; oldBun?: string }
  /** The answer to a `ping`. */
  | { type: 'pong' }
  /** On connect and whenever it changes: the restart Seismic waits with, if any. */
  | { type: 'restart'; restart: PendingRestart | null }
  /** On connect and whenever it changes: the newer version of the app there is to install, if any. */
  | { type: 'update'; update: AppUpdate | null }
  /** On connect and whenever it changes: new commits on the upstream of the checkout Seismic runs from, if any. */
  | { type: 'source'; source: SourceUpdate | null }
  /** On connect and whenever it changes: how much of its usage limits the account Claude Code runs with here has used, while the bar shows it. */
  | { type: 'usage'; usage: Usage | null }
  /** On connect and whenever it changes: what waits for the owner on each canvas, by canvas id. */
  | { type: 'waiting'; waiting: Record<string, Waiting> }
  /** Whenever a canvas starts, stops, or changes its name or repositories while Seismic runs. */
  | { type: 'canvases'; canvases: CanvasInfo[] }
  /** A line for the owner above the microphone, wherever they are. */
  | ({ type: 'notice' } & Notice);

/**
 * What Seismic tells the owner above the microphone without a command of theirs to answer: an answer
 * the Koordinator looked up, or what it did with a request a card's agent passed on from the
 * owner's words (`to_seismic`), with `token` while those actions wait for "Undo".
 */
export interface Notice {
  /** The card it is about, named when another one is open. */
  cardId?: string;
  text: string;
  token?: string;
  undoMs?: number;
  /** The owner asked to tell Seismic's makers something: the page opens the draft for them with it. */
  wish?: Wish;
  /** The exchange of Seismic's sheet it answers, there in full: a page that shows the sheet needs no line above the microphone. */
  talk?: number;
  /** The plan whose sheet shows that exchange in full too: a page with that sheet open needs no line either. */
  plan?: string;
  /** The conversation of the card (`cardId`) shows it in full, as it came: a page with that conversation open needs no line. */
  inTalk?: true;
  /** The page opens the card (`cardId`), unless the owner has another one open: the one a review of its PR asked for. */
  open?: true;
  /** The card (`cardId`) moved to this canvas: a page that has it open follows it there. */
  movedTo?: string;
  /**
   * The cards the commands confirmed with `token` made, once they ran (after the undo window): the
   * line that shows that confirmation offers to go to them; `canvas` where one went to another canvas.
   */
  made?: { id: string; title: string; canvas?: string }[];
}

/** A skill (or command) of Claude Code the owner can ask a card's agent for by `/name` in their words. */
export interface Skill {
  name: string;
  /** What it does, as its file says. */
  description: string;
  /** What to write after the name (`<file>`), when it says. */
  hint?: string;
}

/**
 * The model and effort a group of a canvas's agents runs with: Configuration's, with the canvas's own
 * over it. A canvas's own model for its workers is one of Claude Code's, so it runs them in Claude Code; an effort alone keeps them where they are.
 */
export function canvasAgentSetting(role: AgentRole, base: AgentSetting, own: CanvasAgents | undefined): AgentSetting {
  const mine = own?.[role];
  if (!mine || !Object.keys(mine).length) return base;
  if (mine.harness) {
    const selected = mine.harness;
    return { ...base, ...mine, harness: selected,
      ...(selected === 'codex' || selected === 'agy' ? { [selected]: { ...(base.harness === selected ? harnessChoice(base) : { model: 'default', effort: base.effort }), ...mine[selected] } } : {}) };
  }
  // an effort alone keeps Codex and agy workers where they are, with their model and that effort
  if (base.harness && base.harness !== 'claude' && !mine.model) return { ...base, [base.harness]: { ...harnessChoice(base), effort: mine.effort! } };
  return { ...base, ...mine, ...(base.harness && base.harness !== 'claude' ? { harness: 'claude' as const } : {}) };
}

