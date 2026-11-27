

import type { DemoSettings, NarrationLanguage, VoiceKind } from '../../plugin/skills/demo/lib/settings.ts';
import type { HandoverArtifact } from '../../plugin/skills/demo/lib/artifacts.ts';
import type { SetupId, SetupItem } from '../../plugin/skills/demo/lib/setup.ts';
import type { CardFile } from './files';
import type { Category, Complexity, Label, Priority, Subcategory, SuggestSettings } from './labels';
import type { Language } from './locale';
import { MESSAGES } from './messages';
import type { OutdatedBy } from './page-changes';
import type { NotAPlan } from './plan-doc';
import type { NeedsYou } from './waits';
import type { Wish } from './wish';

export type { DemoSettings, NarrationLanguage, VoiceKind } from '../../plugin/skills/demo/lib/settings.ts';
export type { HandoverArtifact } from '../../plugin/skills/demo/lib/artifacts.ts';
export type { Language } from './locale';
export { PRIORITIES, type Priority } from './labels';
export type { SetupCheck, SetupId, SetupItem } from '../../plugin/skills/demo/lib/setup.ts';






export type ListenBackend = 'parakeet' | 'mlx' | 'faster';





export type CardKind = 'task' | 'plan' | 'question';

export const STATES = ['idea', 'proposal', 'planned', 'working', 'waiting', 'approved', 'inPr', 'live', 'done'] as const;
export type CardState = (typeof STATES)[number];

/** A card whose work is over: `live` once it landed, `done` when it needed no change to the code (a demo, an analysis). */
export const finished = (s: CardState) => s === 'live' || s === 'done';
/** A card an agent worked on until the owner stopped it: planned again, its branch stays the card's. */
export const stopped = (i: Pick<Item, 'state' | 'agent'>) => i.state === 'planned' && !!i.agent?.branch;
/**
 * A stopped card of the owner's the archive may take: nothing waits to start it, and its workstation
 * holds no work (a branch with commits or changes keeps it, and archiving would leave that work
 * unseen in a clone).
 */
export const stoppedArchivable = (i: Pick<Item, 'state' | 'agent' | 'source' | 'queue' | 'idea' | 'kind'>) =>
  stopped(i) && i.source === 'manual' && i.kind === 'task' && !i.idea?.prototypeOf && !i.queue && !i.agent?.workstation && !i.agent?.keptIn;
/** A finished card of the owner's whose agent is done: the archive may take it. */
export const finishedArchivable = (i: Pick<Item, 'state' | 'source' | 'agent'>) => finished(i.state) && i.source === 'manual' && !i.agent?.finishing;
/** A finished card whose agent still works: after the landing, or answering a follow-up question. */
export const finishingUp = (i: Pick<Item, 'state' | 'agent'>) => !!i.agent?.finishing && finished(i.state);







export interface BackgroundTask {
  description: string;
  since: number;
}


export interface WorkerTurn {
  tasks: BackgroundTask[];
  over: boolean;
  
  doing?: AgentDoing;
  
  restartPaused?: true;
}





export type AgentDoing = 'working' | 'building' | 'thinking' | 'debugging' | 'preparingDemo' | 'recordingDemo' | 'finalizingDemo';

/** Whether the worker is at a stage of its demo, which its card shows in green. */
export const demoStage = (d: AgentDoing) => d.endsWith('Demo');

/** The owner or the usage limit paused the card's agent: it waits to be resumed (the limit's at its reset, too). */
export const isPaused = (i: Pick<Item, 'hold'>) => i.hold?.reason === 'paused' || i.hold?.reason === 'limit';

/** The card's code review stopped on its model's usage limit: the card waits for the owner to retry it, hand it to another agent or skip it. */
export const reviewLimited = (i: { review?: { codeReview?: { limited?: true } } }) => !!i.review?.codeReview?.limited;

/** The owner asked the card's agent to pause once it has brought its work to a safe point. */
export const isPausing = (i: Pick<Item, 'hold'>) => i.hold?.reason === 'pausing';

/** The card's snooze, while it is snoozed. */
export const snoozeOf = (i: Pick<Item, 'hold'>): (Snooze & { since: string }) | undefined => (i.hold?.reason === 'snoozed' ? i.hold : undefined);

/** The owner moved the card into the parking lot: off the canvas, in the Agents sheet's Parked tab. */
export const inParkingLot = (i: Pick<Item, 'hold'>) => i.hold?.reason === 'parkingLot';

/** The card's agent is snoozed (by itself or the owner, "Later"): it stops until its time, and neither pauses nor resumes meanwhile. */
const snoozedAway = (i: Pick<Item, 'hold'>) => !!snoozeOf(i) && !snoozeOf(i)!.waiting;

/** The card's agent runs a turn the owner can pause at once (the pause on the bubble of its turn), also while it is about to pause at a safe point. */
export const pausableNow = (i: Pick<Item, 'kind' | 'state' | 'idea' | 'thread' | 'agent' | 'hold'>) =>
  !isPaused(i) && !snoozedAway(i) && (i.kind === 'question' ? !!i.thread?.thinking : i.state === 'idea' && i.idea?.discussion ? i.idea.discussion.thinking : !!i.agent?.inTurn);

/** The card's agent is at work and can be paused, at a safe point (the card's pause, the project's) or at once; not one about to pause already. */
export const pausable = (i: Pick<Item, 'kind' | 'state' | 'idea' | 'thread' | 'agent' | 'hold'>) => !isPausing(i) && pausableNow(i);

/** The owner paused the card's agent, and it waits for them to resume it; a snoozed one waits for its time instead. */
export const resumable = (i: Pick<Item, 'hold'>) => isPaused(i);

/** The card's agent is paused, or about to pause at a safe point: what the card's ▶ and the project's resume let go on. */
export const halted = (i: Pick<Item, 'hold'>) => isPaused(i) || isPausing(i);

/**
 * A finished card an agent worked on, on the project, with no agent on it now: what the owner asks
 * about it resumes the agent that did the work, which answers and ends again.
 */
export const askable = (i: Pick<Item, 'state' | 'agent' | 'idea' | 'archivedAt'>) =>
  finished(i.state) && !!i.agent?.branch && !i.idea?.prototypeOf && !i.archivedAt && !i.agent?.finishing;

/**
 * How many cards of each group are still to be done: not finished, not archived, not a dropped
 * idea. A plan counts by its workstreams, not as a card of its own.
 */
export function openPerGroup(items: Item[]): Map<string, number> {
  const open = new Map<string, number>();
  for (const i of items)
    if (i.group && i.kind === 'task' && !finished(i.state) && !i.archivedAt && i.idea?.discussion?.status !== 'dropped') open.set(i.group, (open.get(i.group) ?? 0) + 1);
  return open;
}

/** A workstream a prototype can be built for: nobody has worked on it yet, and the Koordinator does not hold it. */
export const buildableOn = (i: Item) => i.state === 'planned' && !i.agent?.branch && !i.queue;

/**
 * A planned task nobody has worked on yet, which the Koordinator may merge with others or delete:
 * no branch, no workstation, not with the Koordinator unless it waits there behind other cards (a
 * review's follow-up task waiting for the PR's merge, say), and no prototype nor becoming a plan.
 */
export const untouched = (i: Item) =>
  i.kind === 'task' && i.source === 'manual' && i.state === 'planned' && !i.agent?.branch && !i.agent?.workstation && (!i.queue || 'behind' in i.queue) && !i.idea?.prototypeOf && !i.idea?.becomesPlan;

/**
 * A card decided as a plan whose worker has not started on the plan doc yet: it merges only with
 * another such card, so the one card both become still writes a plan doc and the plan takes its place.
 */
export const unworkedPlanDoc = (i: Item) =>
  i.kind === 'task' && !!i.idea?.becomesPlan && i.state === 'planned' && !i.agent?.branch && !i.agent?.workstation && (!i.queue || 'behind' in i.queue);

/** Progress decides which card dissolves. Unstarted pairs still combine their text. */
export const mergeRank = (i: Item): number => i.archivedAt ? 4 : finished(i.state) ? 3 : i.state === 'proposal' ? 0 : untouched(i) || unworkedPlanDoc(i) ? 1 : 2;

/** Only an unworked task or proposal can start a merge and dissolve; an idea's plan doc card with prototypes keeps them. */
export const canMergeFrom = (i: Item) =>
  i.kind === 'task' && !i.parent && !i.archivedAt && !i.idea?.mergingInto && !snoozeOf(i) && !i.repoDown && !i.idea?.prototypeOf && !i.idea?.prototypes?.length &&
  !i.idea?.proposal?.merge && !i.idea?.proposal?.idea && !i.idea?.proposal?.revising && !i.idea?.proposal?.acceptAfterRevision &&
  (untouched(i) || unworkedPlanDoc(i) || (i.state === 'proposal' && !i.agent?.branch && !i.agent?.workstation));

/** The read-only agent is still comparing the cards. */
export const merging = (i: Pick<Item, 'state' | 'idea'>) => {
  const merge = i.idea?.proposal?.merge;
  return !!merge && merge.task === undefined && merge.failed === undefined;
};

/** A merge starts at an unworked card; its partner may have reached any stage, and may be a plan's workstream. */
export const mergeableWith = (p: Item, i: Item) =>
  canMergeFrom(p) && i.id !== p.id && i.kind === 'task' && i.state !== 'idea' &&
  !i.idea?.mergingInto && !snoozeOf(i) && !i.repoDown && !i.idea?.prototypeOf && (p.idea?.becomesPlan ? unworkedPlanDoc(i) && !i.idea?.prototypes?.length : !i.idea?.becomesPlan) &&
  !i.idea?.proposal?.idea && !i.idea?.proposal?.merge && !i.idea?.proposal?.revising && !i.idea?.proposal?.acceptAfterRevision;

/**
 * A task of the owner's that can still be planned as a plan, as an idea can: planned, nobody has
 * worked on it, the Koordinator does not hold it, and it is no prototype nor decided as a plan already.
 */
export const plannableAsPlan = (i: Item) =>
  i.source === 'manual' && i.kind === 'task' && buildableOn(i) && !i.idea?.prototypeOf && !i.idea?.becomesPlan;

/**
 * The workstream of a plan, among `items`, that its idea's prototypes are built for: the one
 * nobody has started that mentions prototypes, as the plan doc's worker writes it. None when no
 * such workstream, or several, leave it to the owner.
 */
export function prototypeWorkstream(items: Item[], planId: string): Item | undefined {
  const named = items.filter((i) => i.parent === planId && buildableOn(i) && /prototyp/i.test(`${i.title}\n${i.body}`));
  return named.length === 1 ? named[0] : undefined;
}


export type Need = 'demo' | 'question' | 'review';


export interface Question {
  text: string;
  options: string[];
  
  multiple?: boolean;
  
  pick?: { options: string[]; why: string };
  
  stuck?: true;
}

/** A question as its card's log holds it: the text, then one line per option. */
export const formatQuestion = (q: Question, language: Language): string =>
  q.options.length ? `${q.text}${q.multiple ? ` (${MESSAGES[language].multiple})` : ''}\n${q.options.map((o) => `– ${o}`).join('\n')}` : q.text;

/** Its worker handed the work over: the card waits for the owner's approval or feedback. */
export const handedOver = (i: Pick<Item, 'state' | 'need'>) => i.state === 'waiting' && (i.need === 'demo' || i.need === 'review');

/** Its worker takes in the owner's words on its handover: meanwhile the card is at work, and still waits for approval. */
export const answering = (i: Pick<Item, 'state' | 'need' | 'review'>) => handedOver(i) && !!i.review?.answering;

/**
 * Whether an agent hears what the owner says or types on the card when it is open: its worker (at
 * work, waiting, in a pull request, finishing after the landing, or one a question resumes on a
 * finished card), an idea's exploration agent, or the agent that reworks a proposal (while it
 * does, the words wait for the rework after it). The words then go straight to it; on any other
 * card they go to the Koordinator.
 */
export const agentListens = (i: Pick<Item, 'kind' | 'state' | 'agent' | 'idea' | 'archivedAt'>) =>
  !i.archivedAt && (i.kind === 'question' || i.state === 'idea' || i.state === 'proposal' || i.state === 'working' || i.state === 'waiting' || i.state === 'inPr' || !!i.agent?.finishing || askable(i));

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
 * them, the project card and the phone's count show them, the Koordinator hears of them.
 */
export function openQuestions(i: Pick<Item, 'archivedAt' | 'state' | 'need' | 'question' | 'idea'>): Question[] {
  if (i.archivedAt) return [];
  const discussion = i.idea?.discussion;
  const proposal = i.idea?.proposal;
  if (i.state === 'idea') return discussion?.status === 'open' && !discussion.thinking ? discussion.questions : [];
  if (i.state === 'proposal') return proposal && !proposal.revising && !proposal.merge ? proposal.questions : [];
  return i.state === 'waiting' && (i.need === 'question' || i.need === 'demo') && i.question ? [i.question] : [];
}

/** A card whose worker failed (its session died with an error, or it could not start at all): it waits for the owner, shown in red. */
export const agentFailed = (i: Pick<Item, 'state' | 'need' | 'question' | 'review'>) => i.state === 'waiting' && i.need === 'question' && !!i.question?.stuck && !answering(i);

/**
 * A card needs the owner: it waits (but not while its worker takes in what the owner wrote on its
 * handover, nor once they approved it and its work lands), is a proposal or an accepted one its agent withdrew or
 * replaced since, has a pull request that only waits for the owner's merge, or is an open idea whose agent has replied
 * and is done. A merge needs them once its comparison is ready. A progressed survivor keeps its own
 * handover and questions while an unworked partner waits for the comparison.
 */
export const needsYou = (i: Item) =>
  !snoozeOf(i) &&
  (!i.idea?.mergingInto || mergeRank(i) > 1) &&
  ((!!i.idea?.proposal?.merge && !merging(i)) || (i.state === 'waiting' && !answering(i) && !i.review?.landing && !(i.need !== 'question' && i.review?.codeReview?.state === 'running')) || (i.state === 'proposal' && !i.idea?.proposal?.revising && !merging(i)) || !!i.idea?.superseded || (i.state === 'inPr' && [i.review?.pr, ...(i.review?.morePrs ?? [])].some((p) => p?.ready && !p.merged && !p.closed)) || (!!i.idea?.discussion && i.idea.discussion.status === 'open' && i.idea.discussion.yourTurn && !i.idea.discussion.thinking));






export const AWAITED_STATES = ['done', 'waitsForOwner'] as const;
export type AwaitedState = (typeof AWAITED_STATES)[number];

export type Awaited = 'reached' | 'gone' | 'archived' | 'stopped' | 'dropped';


export type Woke = 'time' | 'owner' | 'news' | 'needsYou' | { met: Awaited };

/**
 * Whether the card a snoozed worker waits on gets it to wake: `reached` the state it waits for;
 * `gone`, `archived`, `stopped` (planned again by the owner), `dropped` (an idea let go) when it no
 * longer gets there by itself; null while it may still.
 */
export function awaited(card: Item | undefined, state: AwaitedState): Awaited | null {
  if (!card) return 'gone';
  if (finished(card.state) || (state === 'waitsForOwner' && needsYou({ ...card, hold: undefined }))) return 'reached';
  if (card.archivedAt) return 'archived';
  if (stopped(card)) return 'stopped';
  if (card.idea?.discussion?.status === 'dropped') return 'dropped';
  return null;
}

/** A worker on the card is at work (whether or not in a turn right now): it has started on the card, opens or follows its pull request, finishes after the landing, or takes in the owner's words on its handover. */
const workerAtWork = (i: Item) => i.kind === 'task' && (i.state === 'working' || i.state === 'inPr' || !!i.agent?.finishing || answering(i));

/** A task planned and not with the Koordinator: snoozed, it starts at the time instead of now. */
export const plannedToStart = (i: Pick<Item, 'kind' | 'state' | 'queue' | 'archivedAt' | 'hold'>) => i.kind === 'task' && i.state === 'planned' && !i.queue && !i.archivedAt && !inParkingLot(i);

/** A card off the canvas and listed under "Parked": in the parking lot, or snoozed. */
export const offCanvas = (i: Pick<Item, 'hold'>) => inParkingLot(i) || !!snoozeOf(i);

/** A task of the owner's that nothing runs for (planned or stopped, not queued) can go into the parking lot. */
export const parkable = (i: Pick<Item, 'kind' | 'state' | 'queue' | 'archivedAt' | 'hold' | 'parent' | 'idea'>) =>
  i.kind === 'task' && i.state === 'planned' && !i.queue && !i.archivedAt && !inParkingLot(i) && !i.parent && !i.idea?.prototypeOf;

/** A task of the owner's that waits for them (a handover, a question) goes into the parking lot too, stopped on the way. */
export const parkableStopping = (i: Pick<Item, 'kind' | 'state' | 'queue' | 'archivedAt' | 'hold' | 'parent' | 'idea' | 'review' | 'agent'>) =>
  i.kind === 'task' && i.state === 'waiting' && !i.review?.landing && !i.agent?.finishing && !i.queue && !i.archivedAt && !inParkingLot(i) && !i.parent && !i.idea?.prototypeOf;

/**
 * A card the owner can snooze until a point in time ("Later"): one at work (its worker stops
 * until then, as on a pause), one that waits for them (it leaves them until then), or one planned
 * (it starts then); a snoozed card's time can be changed.
 */
export const snoozable = (i: Item) => !i.archivedAt && (!!snoozeOf(i) || needsYou(i) || workerAtWork(i) || plannedToStart(i));

/** Answers in the Koordinator's sheet the owner has not seen yet. */
export const unreadAnswers = (talk: Talk[]) => talk.filter((x) => x.unread).length;

/** Per plan, its agent's answers to what the owner asked in its sheet that wait unread: its card shows them. */
export function unreadPerPlan(talk: Talk[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of talk) if (x.unread && x.askedIn) m.set(x.askedIn, (m.get(x.askedIn) ?? 0) + 1);
  return m;
}

/** What on a project waits for the owner: the cards that need them, and the Koordinator while an answer waits unread. */
export const waitingOn = (s: Pick<ProjectSnapshot, 'items' | 'talk'>) => s.items.filter(needsYou).length + (unreadAnswers(s.talk) ? 1 : 0);






export type Waiting = Pick<ProjectSnapshot, 'items' | 'talk' | 'needsYou'> & Partial<Pick<ProjectSnapshot, 'preferences' | 'settingProposals' | 'project'>> & { proposalItems?: Item[] };
export const waitingIn = (s: Pick<ProjectSnapshot, 'items' | 'talk' | 'needsYou'> & Partial<Pick<ProjectSnapshot, 'preferences' | 'settingProposals' | 'project'>>): Waiting => ({
  items: s.items.filter((i) => needsYou(i) || !!snoozeOf(i)?.waiting),
  talk: s.talk.filter((x) => x.unread),
  needsYou: s.needsYou,
  preferences: s.preferences, settingProposals: s.settingProposals, project: s.project, proposalItems: s.items.filter((i) => s.preferences?.some((p) => p.state === 'proposed' && p.cardId === i.id) || s.settingProposals?.some((p) => p.cards.some((c) => c.id === i.id))),
});







export type TaskAuthor = 'owner' | 'plan' | 'koordinator' | 'idea' | 'proposal';

export const taskAuthor = (item: Pick<Item, 'source' | 'idea'>): TaskAuthor =>
  item.source === 'plan' ? 'plan' : item.idea?.prototypeOf || item.idea?.brief !== undefined ? 'idea' : item.idea?.retro ? 'koordinator' : item.idea?.proposed ? 'proposal' : 'owner';

export type EdgeSide = 'top' | 'right' | 'bottom' | 'left';
export interface ManualAnchor { fromSide: EdgeSide; toSide: EdgeSide; offset: number }

export interface Item {
  id: string;
  
  short?: string;
  kind: CardKind;
  state: CardState;
  need?: Need;
  title: string;
  
  body: string;
  
  x: number;
  y: number;
  parent?: string;
  
  source: 'manual' | 'plan';
  



  question?: Question;
  
  from?: string;
  
  fromElsewhere?: Elsewhere;
  
  createdAt?: string;
  
  updatedAt?: string;
  
  repo: string;
  




  repoDown?: true;
  
  scope?: string[];
  
  possibleDuplicates?: string[];
  
  queue?: Queue;
  
  archivedAt?: string;
  
  thread?: Thread;
  
  hold?: ItemHold;
  



  images?: string[];
  
  group?: string;
  
  canvas?: string;
  





  canvasVisible: boolean;
  
  agent?: ItemAgent;
  
  review?: ItemReview;
  
  demo?: ItemDemo;
  
  idea?: ItemIdea;
  
  plan?: ItemPlan;
  
  labels?: ItemLabels;
}


export const ITEM_PARTS = ['agent', 'review', 'demo', 'idea', 'plan', 'labels'] as const;
export type ItemPart = (typeof ITEM_PARTS)[number];

/** A part of an item as built: none when nothing in it is set. */
export const part = <T extends object>(p: T): T | undefined => (Object.values(p).some((v) => v !== undefined) ? p : undefined);

/**
 * The item with `fields` set in its part `k` (an `undefined` value clears one), the part dropped
 * once nothing is left in it.
 */
export function withPart<I extends Pick<Item, ItemPart>, K extends ItemPart>(i: I, k: K, fields: Partial<NonNullable<Item[K]>>): I {
  const merged = Object.fromEntries(Object.entries({ ...i[k], ...fields }).filter(([, v]) => v !== undefined));
  const { [k]: _, ...rest } = i;
  return (Object.keys(merged).length ? { ...rest, [k]: merged } : rest) as I;
}






export interface StoppedAt {
  state: CardState;
  need?: Need;
  
  earlier?: number;
  
  question?: { stuck?: true };
  answering?: true;
  answered?: true;
  reviewing?: true;
  
  hold?: Exclude<Item['hold'], undefined | { reason: 'parkingLot' }>;
}

/** What the card shows now, to say later where it was stopped. */
export const stoppedAtOf = (i: Pick<Item, 'state' | 'need' | 'question' | 'demo' | 'review' | 'hold'>): StoppedAt => {
  const earlier = i.demo?.earlier?.filter((d) => !d.asked).length ?? 0;
  return {
    state: i.state,
    ...(i.need ? { need: i.need } : {}),
    ...(earlier ? { earlier } : {}),
    ...(i.question ? { question: i.question.stuck ? { stuck: true as const } : {} } : {}),
    ...(i.review?.answering ? { answering: true as const } : {}),
    ...(i.review?.answered ? { answered: true as const } : {}),
    ...(i.review?.codeReview?.state === 'running' ? { reviewing: true as const } : {}),
    ...(i.hold && i.hold.reason !== 'parkingLot' ? { hold: i.hold } : {}),
  };
};


export interface ItemAgent {
  
  statusLine?: string;
  




  inTurn?: true;
  
  doing?: AgentDoing;
  
  identity?: AgentIdentity;
  
  workerSetting?: AgentSetting;
  
  background?: BackgroundTask[];
  



  limitedUntil?: string;
  
  finishing?: boolean;
  
  followUp?: boolean;
  
  waitsForClone?: true;
  branch?: string;
  
  stoppedAt?: StoppedAt;
  
  workstation?: string;
  
  keptIn?: string;
  




  app?: string;
}


export interface ItemReview {
  
  summary?: string;
  



  answering?: true;
  



  answered?: true;
  
  landing?: true;
  
  landingPosition?: number;
  
  noChange?: boolean;
  



  modelsUnchanged?: string;
  



  rate?: { handover: number; answer?: FeedbackAnswer };
  



  lands?: CardLanding;
  



  blocked?: { files: string[] };
  
  resolvingConflicts?: true;
  
  pr?: PullRequest;
  



  morePrs?: PullRequest[];
  
  contribution?: Contribution;
  



  codeReview?: CodeReview;
}


export interface ItemDemo {
  
  latest?: Demo;
  



  earlier?: EarlierDemo[];
  




  files?: CardFile[];
  
  share?: Share;
  
  notOnApproval?: true;
  




  tags?: PageTags;
  



  held?: number[];
}


export interface ItemIdea {
  
  discussion?: Idea;
  
  brief?: string;
  
  mocks?: Mock[];
  
  prototypeOf?: string;
  
  variant?: string;
  
  prototypeEnd?: 'discarded' | 'built';
  
  builtInto?: string;
  
  ideaTitle?: string;
  
  buildProposal?: string;
  
  prototypes?: Item[];
  
  builtOn?: string;
  
  becomesPlan?: boolean;
  




  newRepo?: NewRepo;
  
  proposal?: Proposal;
  
  proposed?: true;
  
  superseded?: Superseded;
  
  mergingInto?: string;
  
  retro?: string;
}


export interface ItemPlan {
  
  file?: string;
  goal?: string;
  
  label?: string;
  
  origin?: string;
  
  arranging?: true;
  
  collapsed?: true;
  
  buildsOn?: string[];
  
  manualDependsOn?: string[];
  
  manualArchived?: Item[];
  
  manualAnchors?: Record<string, ManualAnchor>;
}


export interface ItemLabels {
  
  priority?: Priority;
  
  category?: Category;
  
  subcategory?: Subcategory;
  
  complexity?: Complexity;
  
  suggested?: Label[];
}


export interface HeldMessage {
  text: string;
  images: string[];
}



















export type Hold =
  | { reason: 'pausing'; since: string }
  | { reason: 'paused'; since: string; held?: HeldMessage[] }
  | { reason: 'limit'; since: string; until?: string; model?: string; attempts: number; statusBefore?: string | null; held?: HeldMessage[] }
  | (Snooze & { reason: 'snoozed'; since: string; held?: HeldMessage[] })
  | { reason: 'parkingLot'; since: string };

export type HoldReason = Hold['reason'];


export const AGENT_HOLDS: readonly HoldReason[] = ['pausing', 'paused', 'limit', 'snoozed'];







export type ItemHold =
  | { reason: 'pausing' | 'paused' | 'parkingLot'; since: string }
  | { reason: 'limit'; since?: string; until?: string; model?: string }
  | (Snooze & { reason: 'snoozed'; since: string })
  | { reason: 'restart' };


export const SNOOZE_LIMIT = 366 * 24 * 60 * 60_000;








export interface Snooze {
  
  until?: string;
  
  on?: { card: string; title: string; state: AwaitedState };
  by: 'agent' | 'owner';
  
  why?: string;
  
  waiting?: true;
  
  moved?: true;
  
  start?: true;
}





export interface Group {
  id: string;
  name: string;
  
  hue: number;
  
  canvas?: string;
}





export interface Canvas {
  id: string;
  
  name: string;
  
  icon?: string;
  
  inUse?: true;
  
  parked?: number;
  snoozed?: number;
}

/**
 * Whether the canvas holds anything: a card on it that its canvas holds (`canvasVisible`), or a group
 * on it with such a card in it. Only a canvas that holds nothing can be deleted.
 */
export function canvasHolds(canvas: string, items: Pick<Item, 'canvas' | 'canvasVisible' | 'group'>[], groups: Pick<Group, 'id' | 'canvas'>[]): boolean {
  const on = new Set(groups.filter((g) => g.canvas === canvas).map((g) => g.id));
  return items.some((i) => i.canvasVisible && (i.canvas === canvas || (!!i.group && on.has(i.group))));
}


export const MAIN_CANVAS = 'main';

export const CANVAS_NAME_MAX = 40;

/**
 * The canvas an address's hash names: `#<name>` (in any case), `#<n>` its place in the order (`#1`
 * is the first), and without a hash, or with one that names none, the first.
 */
export function canvasOfHash<C extends Pick<Canvas, 'name'>>(canvases: C[], hash: string): C | undefined {
  return canvasNamedBy(canvases, hash) ?? canvases[0];
}

/** The canvas the hash names, by its name or its place; none for an empty hash or one that names no canvas. */
export function canvasNamedBy<C extends Pick<Canvas, 'name'>>(canvases: C[], hash: string): C | undefined {
  let h = hash.replace(/^#/, '');
  try {
    h = decodeURIComponent(h);
  } catch {}
  const key = h.trim().toLowerCase();
  if (!key) return undefined;
  const n = /^\d+$/.test(key) ? Number(key) : 0;
  return (n >= 1 ? canvases[n - 1] : undefined) ?? canvases.find((c) => c.name.toLowerCase() === key);
}

/** Why a canvas cannot be named so; none when it can. A number from 1 to 999 names a canvas by its place (`#2`). */
export function canvasNameProblem(name: string): 'empty' | 'tooLong' | 'number' | undefined {
  const n = name.trim();
  if (!n) return 'empty';
  if (n.length > CANVAS_NAME_MAX) return 'tooLong';
  if (/^\d+$/.test(n) && Number(n) >= 1 && Number(n) <= 999) return 'number';
  return undefined;
}






export interface Proposal {
  
  idea?: boolean;
  
  reason?: string;
  questions: Question[];
  




  revising?: Revising & { next?: Revising[] };
  



  acceptAfterRevision?: true | 'idea';
  
  superseded?: Superseded;
  



  startAt?: string;
  
  merge?: Merge;
  




  setup?: true;
  
  finish?: true;
}





export interface Superseded {
  
  by?: string;
  title?: string;
  
  why?: string;
}






export interface Merge {
  with: string;
  
  attempt?: string;
  
  origin?: { x: number; y: number };
  temporaryProposal?: true;
  
  title?: string;
  task?: string;
  
  outcome?: 'covered' | 'followUp';
  titleCovered?: boolean;
  
  parts?: { text: string; covered: boolean }[];
  followUp?: {
    title: string; task: string; images: string[]; questions: number[];
    
    questionTexts?: string[];
  };
  
  compared?: { left: string; right: string; summary: string };
  
  previous?: Pick<Merge, 'title' | 'task' | 'outcome' | 'titleCovered' | 'parts' | 'followUp'>;
  
  failed?: string;
}


export interface Revising {
  words: string;
  spoken?: boolean;
  said?: number[];
  images?: string[];
}


export interface Decision {
  id: number;
  cardId: string;
  question: string;
  answer: string;
  by: 'owner' | 'plan' | 'koordinator';
  at: string;
}


export interface PlanHistory {
  
  decisions: Decision[];
  
  origin: Item | null;
  
  talk: Talk[];
}





export interface Idea {
  status: 'open' | 'parked' | 'dropped';
  
  brief: string;
  
  thinking: boolean;
  
  buildAfterReply?: true;
  
  yourTurn: boolean;
  
  questions: Question[];
  
  next?: NextStep;
  
  variants: PlannedPrototype[];
  
  mocks: Mock[];
  
  split?: SettledPart;
}


export interface Thread {
  
  talk: number;
  
  thinking?: boolean;
  answers: number;
  files: number;
}


export interface AnswerFile {
  name: string;
  caption: string;
}





export interface AnswerRef {
  thread: number;
  files?: AnswerFile[];
  continues?: string;
}


export interface Mock {
  title: string;
  html: string;
}


export interface PlannedPrototype {
  approach: string;
  show: string;
}





export interface SettledPart {
  title: string;
  brief: string;
}


export const NEXT_STEPS = ['answer', 'build', 'splitOff', 'planDoc', 'prototype', 'park', 'drop'] as const;
export interface NextStep {
  step: (typeof NEXT_STEPS)[number];
  why: string;
}

export interface PullRequest {
  url: string;
  number: number;
  
  repo?: string;
  
  merged?: boolean;
  
  closed?: boolean;
  
  waits?: PrWait[];
  
  checks: { name: string; state: 'pending' | 'success' | 'failure'; url?: string }[];
  conflict: boolean;
  





  ready?: boolean;
  mergeError?: string;
  held?: { score: string; by: string };
  manual?: boolean;
  
  review?: PrReviewEntry[];
}









export type PrWait = 'conflict' | 'behind' | 'draft' | 'protection' | 'forge' | 'checksFailed' | 'checks' | 'threads' | 'changes' | 'review' | 'answer' | 'agent';





export interface Contribution {
  url: string;
  number: number;
  
  author: string;
  title: string;
  
  canModify: boolean;
  
  results?: ReviewResults;
  
  findings?: Finding[];
  
  requested?: { url?: string; at: string };
  
  held?: HeldChanges;
  
  clash?: Clash;
}






export interface HeldChanges {
  body: string;
  commits: number;
  asks: number[];
}






export interface Clash {
  commit: string;
  subject: string;
  files: string[];
  unpushed: number;
  card?: { id: string; title: string };
}







export type ChangeRoute = 'contributor' | 'self' | 'later';


export type FindingPick = ChangeRoute | 'ignore';


export const SEVERITIES = ['blocker', 'critical', 'major', 'minor', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];


export interface Finding {
  
  id: number;
  title: string;
  text: string;
  security?: boolean;
  severity?: Severity;
  
  file?: string;
  line?: number;
  





  status: FindingStatus;
  url?: string;
  
  card?: string;
  
  decided?: ChangeRoute;
  
  withChanges?: true;
  
  with?: number[];
}

export type FindingStatus = 'open' | 'sent' | 'fixed' | 'resolved' | 'dropped' | 'later';










export const REVIEW_ITEM_STATUSES = ['raised', 'fixing', 'underReview', 'fixed', 'reopened', 'disputed', 'closed', 'followUp'] as const;
export type ReviewItemStatus = (typeof REVIEW_ITEM_STATUSES)[number];


export type ReviewItemWho = 'reviewer' | 'worker' | 'owner';


export interface ReviewItemEvent {
  at: string;
  who: ReviewItemWho;
  
  from?: ReviewItemStatus;
  to: ReviewItemStatus;
  note?: string;
  
  handover?: number;
  run?: string;
}






export interface ReviewItem {
  number: number;
  title: string;
  text: string;
  severity: Severity;
  security?: boolean;
  file?: string;
  line?: number;
  
  with?: number[];
  status: ReviewItemStatus;
  
  card?: string;
  
  context?: string;
  log: ReviewItemEvent[];
}

/** Whether the item waits for the owner. */
export const needsOwner = (i: Pick<ReviewItem, 'status'>) => i.status === 'raised' || i.status === 'reopened' || i.status === 'disputed';








export interface CodeReview {
  mode: CodeReviewMode;
  
  runs?: number;
  
  agent?: AgentIdentity;
  
  state?: 'running' | 'done' | 'failed';
  
  stale?: true;
  items: ReviewItem[];
  
  error?: string;
  
  limited?: true;
}


export const CARD_ARCHIVING = ['manual', 'landed'] as const;
export type CardArchiving = (typeof CARD_ARCHIVING)[number];


export const RIGHT_CLICK = ['groups', 'canvases'] as const;
export type RightClick = (typeof RIGHT_CLICK)[number];

export const CODE_REVIEW_MODES = ['auto', 'manual'] as const;
export type CodeReviewMode = (typeof CODE_REVIEW_MODES)[number];


export interface CodeReviewSetting {
  on: boolean;
  mode: CodeReviewMode;
}


export interface ReviewResults {
  checks: { name: string; passed: boolean }[];
  
  mergeable: boolean;
}


export interface PrComment {
  author: string;
  mine?: boolean;
  body: string;
  
  at: string;
  edited?: boolean;
  url?: string;
}


export interface PrThread extends PrComment {
  path?: string;
  line?: number;
  resolved: boolean;
  replies: PrComment[];
}


export type PrReviewEntry = { author: string; mine?: boolean; at: string; threads: PrThread[] } | PrComment;





export const START_ALL_HOLD_MS = 8000;


export const EVICT_HOLD_MS = 8000;


export const PUSH_HOLD_MS = 8000;














export type Queue = Wait & { since: string };





export type Wait = { checking: true; together?: string } | { behind: string[]; reason: string; buildsOn?: string[]; manualWait?: string[] } | { workstation: WorkstationShortage; begun?: true } | { paused: true; begun?: true } | { restart: true };


export type WorkstationShortage = 'none' | 'dirty' | 'slots';





export type DemoKind = 'video' | 'html';

export interface Demo {
  kind: DemoKind;
  
  chapters: [number, string][];
  
  question?: string;
  
  options?: string[];
  multiple?: true;
  pick?: Question['pick'];
  
  answer?: string;
  
  picks?: string[];
  
  handover?: number;
  



  asked?: true;
  
  at?: string;
  
  page?: DemoPage;
  
  single?: true;
  



  follows?: 'replaces' | 'supplements';
  
  noPoster?: true;
}


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
  
  text: string;
  
  tags?: PageTags;
}


export type PageTags = Record<string, string[]>;





export const EXPORT_HTML_MAX = 15 * 1024 * 1024;





export interface Share {
  state: 'publishing' | 'shared' | 'withdrawing';
  
  url?: string;
  
  on?: number[];
  
  stale?: boolean;
  
  outdated?: OutdatedBy[];  
  unlisted?: true;
  
  merge?: string;
}



export const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

export const MAX_IMAGE_BYTES = 3_750_000;

export const MAX_FILE_BYTES = 100_000_000;


export interface AgentIdentity {
  harness: Harness;
  model?: string;
}





export interface WorkConfig {
  harness: Harness | null;
  
  model: string | null;
  effort: AgentEffort | null;
  
  requested?: string;
}






export type Attribution = 'single' | 'mixed' | 'missing';


export interface FeedbackAnswer {
  rating?: number;
  comment?: string;
}


export interface Feedback {
  id: number;
  
  cardId: string;
  short?: string;
  projectId: string;
  
  handover: number;
  
  title: string;
  repo?: string;
  plan?: { id: string; title: string; file?: string };
  attribution: Attribution;
  
  configs: WorkConfig[];
  
  credited?: WorkConfig;
  answer: FeedbackAnswer;
  
  facets?: Record<string, string>;
  at: string;
  
  updatedAt?: string;
  
  deleted?: true;
}






export type AgentAt = { card: string } | { talk: number } | { koordinator: true };

export interface CardEvent {
  agent?: AgentIdentity;
  id: number;
  cardId: string;
  at: string;
  





  kind: 'changes' | 'report' | 'activity' | 'say' | 'closing' | 'question' | 'answer' | 'hint' | 'review' | 'state' | 'error' | 'talk' | 'denied';
  author: 'worker' | 'owner' | 'plan' | 'koordinator' | 'seismic' | 'explorer';
  text: string;
  
  code?: ErrorCode;
  
  images?: string[];
  
  mocks?: Mock[];
  
  replyTo?: number;
  
  spot?: Spot;
  
  answer?: AnswerRef;
  
  picks?: string[];
  
  unread?: true;
  
  readAfter?: number;
  
  wish?: Wish;
  



  reply?: true;
  



  forwarded?: true;
  




  made?: { card: string; title: string; project?: string };
  




  token?: true;
}

/** Seismic's line that a worker started on the card afresh: what it handed over before belongs to an earlier run. */
export const started = (e: Pick<CardEvent, 'kind' | 'author' | 'text'>) => e.kind === 'state' && e.author === 'seismic' && /^(Agent gestartet|Agent started)/.test(e.text);

/** The owner's answer as the log holds it: the options picked, then their own words. */
export const pickedAnswer = (picks: string[], words: string) => [picks.join(', '), words.trim()].filter(Boolean).join('\n\n');

/** The owner's own words in an answer, without the options picked that lead it. */
export function ownWords(e: Pick<CardEvent, 'text' | 'picks'>): string {
  const lead = e.picks?.join(', ');
  return lead && e.text.startsWith(lead) ? e.text.slice(lead.length).trim() : e.text;
}


export interface Spot {
  
  at: number;
  
  chapter?: string;
  
  narration?: string;
  
  still?: string;
  
  demo?: number;
  
  earlier?: true;
}


export type SpotInput = Pick<Spot, 'at' | 'still' | 'demo'>;

export interface ProjectInfo {
  id: string;
  name: string;
  
  oldNames?: string[];
  
  icon?: string;
  
  repos: RepoRef[];
  
  configRev?: number;
  
  paused?: true;
  
  agents?: { running: number; paused: number };
  
  demoSite?: ProjectDemoSiteState;
}

export interface RepoRef {
  id: string;
  name: string;
  path: string;
  branch: string;
  
  folder?: true;
  
  share?: boolean;
  
  shareNeeds?: { site: string; file: string };
  
  shareOnApproval?: true;
  
  shareTags?: PageTags;
  
  shareUnlisted?: true;
  
  shareSite?: 'none' | 'init';
  
  pullRequests?: boolean;
  
  forge?: true;
  
  direct?: boolean;
  




  configRev?: number;
}


export interface ClonePool {
  repo: string;
  hosts: PoolHost[];
}


export interface PoolHost {
  
  name: string;
  
  here?: boolean;
  
  checkout?: true;
  
  worktrees?: boolean;
  
  slots: number;
  
  uncapped?: true;
  
  total: number;
  cards: string[];
  
  busy: string[];
  
  reviewing?: string[];
  
  exploring?: string[];
  
  kept?: string[];
  
  blocked?: BlockedClone[];
  
  workstations: PoolWorkstation[];
}


export interface PoolWorkstation {
  path: string;
  card?: string;
  
  title?: string;
  
  project?: string;
  
  takeable?: true;
  
  leaving?: true;
}








export interface BlockedClone {
  
  path: string;
  why: 'dirty' | 'broken' | 'missing' | 'unreachable' | 'failed';
  files?: string[];
  more?: number;
  error?: string;
  made?: true;
}

export interface ProjectSnapshot {
  project: ProjectInfo;
  



  canvases: Canvas[];
  items: Item[];
  
  groups: Group[];
  preferences: Preference[];
  
  settingProposals?: SettingProposal[];
  



  talk: Talk[];
  
  chat: number;
  
  chatModel?: ChatModel;
  
  chats: Chat[];
  
  workstations?: ClonePool[];
  
  reshare?: Reshare;
  
  planDirs?: PlanDir[];
  
  needsYou: NeedsYou[];
  
  koordinatorAgent?: AgentIdentity;
}






export interface PlanDir {
  repo: string;
  
  dir: string;
  empty: boolean;
  others: { file: string; reason: NotAPlan; preparing?: string }[];
  
  at?: { x: number; y: number };
}





export interface Reshare {
  
  outdated: number;
  
  untagged?: number;
  
  changes?: { id: OutdatedBy; pages: number }[];
  run?: {
    total: number;
    
    done: number;
    
    failed: { id: string; title: string }[];
    
    left: number;
    
    current?: string;
    
    stopped?: boolean;
    
    tags?: boolean;
  };
}


export interface Chat {
  id: number;
  
  model?: ChatModel;
  project: string;
  
  title?: string;
  
  at: string;
  
  unread?: number;
}


export interface ChatElsewhere extends Chat {
  projectName: string;
}


export interface Talk {
  
  requestId?: string;
  
  chat?: number;
  replyAgent?: AgentIdentity;
  answerAgent?: AgentIdentity;
  id: number;
  at: string;
  
  said: string;
  
  reply?: string;
  
  cardId?: string;
  
  undone?: boolean;
  
  images?: string[];
  
  question?: string;
  answer?: string;
  
  answerBy?: 'koordinator' | 'plan';
  
  unread?: true;
  
  thread?: number;
  
  follows?: number;
  continues?: string;
  
  files?: AnswerFile[];
  
  movedTo?: string;
  
  arrived?: number;
  
  replyTo?: TalkQuote;
  



  wish?: Wish;
  
  heldUntil?: string;
  
  limitedUntil?: string;
  
  limitPaused?: true;
  
  lookUpAgent?: AgentIdentity;
  
  waits?: TalkWait[];
  
  after?: TalkAfter;
  
  then?: string;
  
  answered?: number;
  
  moved?: TalkMoved;
  



  askedIn?: string;
  
  made?: TalkMade[];
}


export interface TalkMade {
  card: string;
  title: string;
  project?: string;
}


export interface TalkMoved {
  card: string;
  title: string;
  project: string;
  projectName: string;
}


export interface TalkWait {
  card: string;
  title: string;
  state: AwaitedState;
}


export interface TalkAfter {
  title: string;
  state: AwaitedState;
  met: Awaited;
  from: number;
}


export interface TalkRef {
  talk: number;
  part: 'said' | 'reply' | 'answer';
}


export interface TalkQuote extends TalkRef {
  by: 'owner' | 'koordinator' | 'plan';
  text: string;
}

export const isTalkRef = (r: unknown): r is TalkRef =>
  !!r && typeof r === 'object' && Number.isInteger((r as TalkRef).talk) && ['said', 'reply', 'answer'].includes((r as TalkRef).part);





export interface Preference {
  id: number;
  text: string;
  state: PreferenceState;
  
  cardId?: string;
  
  quote?: string;
  
  review?: boolean;
  
  replaces?: number;
  



  target?: string;
}

export type PreferenceState = 'proposed' | 'active' | 'rejected' | 'filed';


export const PROPOSED_SETTINGS = ['checks', 'setup', 'softPaths', 'run'] as const;
export type ProposedSetting = (typeof PROPOSED_SETTINGS)[number];


export interface SettingProposal {
  id: number;
  
  repo: string;
  field: ProposedSetting;
  
  value: string | string[];
  
  basis: string;
  cards: { id: string; title: string }[];
  
  now?: string | string[];
}





export type SettingProposalState = 'proposed' | 'machine' | 'repository' | 'rejected';

/** `value` as this machine's settings for the repository hold it (`RepoSettings`). */
export function settingPatch(field: ProposedSetting, value: string | string[] | undefined): RepoSettings {
  if (field === 'run') return { app: { ...(value !== undefined ? { run: value as string } : {}) } };
  return { [field]: value } as RepoSettings;
}

export interface NewCard {
  title: string;
  body?: string;
  
  x?: number;
  y?: number;
  
  repo?: string;
  
  idea?: boolean;
  
  from?: string;
  
  images?: string[];
  
  canvas?: string;
  
  group?: string;
}








export interface NewRepo {
  path: string;
  project: boolean;
  by: 'owner' | 'agent';
  due?: string;
}


export const NEW_REPO_HOLD_MS = 8000;

/** The name a new repository's folder gives it (and its project): the last part of its path. */
export const newRepoName = (path: string) => path.trim().replace(/[/\\]+$/, '').split(/[/\\]/).at(-1) ?? '';


export interface Elsewhere {
  project: string;
  projectName: string;
  title: string;
}

export interface CardPatch {
  x?: number;
  y?: number;
  title?: string;
  body?: string;
  state?: CardState;
  need?: Need | null;
  
  repo?: string;
  
  collapsed?: boolean;
  
  images?: string[];
  
  newRepo?: Pick<NewRepo, 'path' | 'project'> | null;
  
  priority?: Priority | null;
  
  category?: Category | null;
  
  subcategory?: Subcategory | null;
  
  complexity?: Complexity | null;
}


export type CardAction =
  
  | { action: 'start'; agent?: AgentSetting }
  
  | { action: 'name' }
  | { action: 'stop' }
  



  | { action: 'pause'; safePoint?: true }
  | { action: 'resume' }
  



  | { action: 'snooze'; until: string }
  
  | { action: 'wake' }
  
  | { action: 'startAt'; at: string | null }
  
  
  
  
  
  | { action: 'message'; text: string; spoken?: boolean; images?: string[]; replyTo?: number; spot?: SpotInput; findings?: Record<string, FindingPick>; findingNotes?: Record<string, string>; newAgent?: AgentSetting }
  
  | { action: 'answer'; text: string; spoken?: boolean; images?: string[]; replyTo?: number; picks?: string[]; spot?: SpotInput }
  



  | { action: 'release'; now?: boolean }
  
  | { action: 'unsay'; id: number }
  




  | { action: 'pushMain' }
  




  | { action: 'fold'; land: boolean }
  | { action: 'keepMain' }
  
  | { action: 'pushChanges' }
  
  | { action: 'editHeld'; body: string }
  
  | { action: 'approve'; direct?: boolean }
  
  | { action: 'codeReview'; agent?: AgentSetting }
  | { action: 'stopCodeReview' }
  
  | { action: 'skipCodeReview' }
  
  | { action: 'handOff'; agent: AgentSetting }
  
  | { action: 'reopenReviewItem'; number: number }
  
  | { action: 'undo' }
  
  | { action: 'force'; agent?: AgentSetting }
  




  | { action: 'takeWorkstation' }
  | { action: 'keepWorkstation' }
  
  | { action: 'dequeue' }
  



  | { action: 'arrange' }
  
  | { action: 'reorder'; earlier: boolean; places?: number }
  





  | { action: 'accept'; start?: boolean; idea?: boolean; picks?: string[][]; agent?: AgentSetting }
  
  | { action: 'unaccept' }
  
  | { action: 'merge'; with: string }
  
  | { action: 'dismissDuplicate' }
  
  | { action: 'approveMerge' }
  
  | { action: 'separate' }
  
  | { action: 'dismiss' }
  
  | { action: 'keep' }
  
  | { action: 'revise'; text: string; spoken?: boolean; images?: string[]; replyTo?: number }
  
  | { action: 'discuss'; text: string; spoken?: boolean; images?: string[]; replyTo?: number }
  



  | { action: 'build'; agent?: AgentSetting }
  
  | { action: 'unbuild' }
  



  | { action: 'stayHere' }
  



  | { action: 'splitOff' }
  
  | { action: 'planDoc' }
  
  | { action: 'park' }
  
  | { action: 'unpark' }
  | { action: 'drop' }
  





  | { action: 'prototype'; text?: string; variants?: string[] }
  




  | { action: 'buildPrototype'; workstream?: string }
  
  | { action: 'discard' }
  



  | { action: 'share'; demo?: number; add?: boolean }
  
  | { action: 'unshare'; demo?: number }
  
  
  | { action: 'pageTags'; dimension: string; values: string[] }
  
  | { action: 'ask'; text: string; spoken?: boolean; images?: string[]; replyTo?: number }
  
  | { action: 'asIdea' }
  
  | { action: 'consult'; text: string; spoken?: boolean; images?: string[]; replyTo?: TalkRef };





export type ErrorCode =
  | 'unknownCard'
  | 'unknownProject'
  | 'unknownChat'
  
  | 'notReachable'
  
  | 'notPaired'
  | 'notOwner'
  
  | 'onlyHere'
  
  | 'onlyDevices'
  
  | 'unknownGroup'
  | 'unknownCanvas'
  
  | 'canvasInUse'
  | 'canvasCardCountsChanged'
  | 'plan'
  
  | 'dependencyCycle'
  
  | 'planDependency'
  
  | 'repoDown'
  | 'notPlanned'
  | 'queued'
  | 'notQueued'
  
  | 'notMovable'
  | 'notPlannable'
  | 'noAgent'
  
  | 'notPaused'
  
  | 'notLimited'
  
  | 'notSnoozable'
  
  | 'notSnoozed'
  
  | 'snoozeTime'
  | 'noQuestion'
  | 'notReady'
  
  | 'notReview'
  
  | 'noEdits'
  | 'noFinding'
  
  | 'prMoved'
  
  | 'noClash'
  
  | 'pullClash'
  | 'prClosed'
  | 'mergeRefused'
  
  | 'pushRefused'
  
  | 'noPr'
  
  | 'notHeld'
  
  | 'noDirect'
  
  | 'notFolder'
  | 'inFolder'
  | 'notProposal'
  | 'notSuperseded'
  | 'revising'
  
  | 'merging'
  
  | 'notMergeable'
  
  | 'mergeChanged'
  | 'planCard'
  | 'noWorkstation'
  | 'dirtyWorkstations'
  
  | 'notEvictable'
  
  | 'evicting'
  
  | 'newRepoDue'
  
  | 'newRepoPath'
  
  | 'newRepoGone'
  
  | 'noSlot'
  | 'workstation'
  | 'emptyText'
  
  | 'voiceCloud'
  | 'unknownPreference'
  | 'unknownSetting'
  
  | 'imageType'
  | 'imageTooLarge'
  
  | 'fileTooLarge'
  
  | 'notDone'
  
  | 'holdsWork'
  | 'notArchived'
  | 'notParkable'
  | 'notIdea'
  
  | 'notUntouched'
  
  | 'otherRepos'
  
  | 'notQuestion'
  
  | 'noFile'
  
  | 'ideaThinking'
  | 'noSplit'
  
  | 'prototypeRunning'
  
  | 'planPending'
  
  | 'ideaGone'
  
  | 'workstreamMissing'
  
  | 'workstreamStarted'
  
  | 'variantsRunning'
  
  | 'nothingToStart'
  
  | 'arrangeFailed'
  
  | 'notPrototype'
  
  | 'prototypeEnded'
  
  | 'noShare'
  
  | 'shareBusy'
  
  | 'notShared'
  
  | 'reshareBusy'
  
  | 'notRepo'
  
  | 'cloneTarget'
  
  | 'noIdentity'
  
  | 'gitSetup'
  
  | 'setupBusy'
  
  | 'nothingOutdated'
  
  | 'noSettings'
  
  | 'noConfiguration'
  
  | 'settingNotFound'
  
  | 'settingsDirty'
  
  | 'trustChanged'
  
  | 'settingsShare'
  
  | 'exportTooLarge'
  
  | 'exportNotAlone'
  
  | 'landDirty'
  | 'landConflict'
  | 'landEmpty'
  | 'landCheckout'
  | 'landMerge'
  
  | 'landLocal'
  
  | 'landPush'
  | 'land'
  
  | 'config'
  
  | 'voiceSample'
  
  | 'voiceInstalling'
  
  | 'invalid';


export interface RepoConfig {
  path: string;
  



  git?: false;
  
  workstations?: string[];
  
  clones?: number;
  
  slots?: number;
  




  hosts?: HostConfig[];
  
  settings?: RepoSettings;
}


export interface AppSettings {
  




  run?: string;
  




  stop?: string;
  
  keep?: string;
}


export interface SiteSetupJob {
  
  id: string;
  
  host?: 'cloudflare' | 'github';
  running: boolean;
  lines: string[];
  error?: string;
  
  offer?: 'cloudflare';
  
  site?: string;
}


export interface TagProposalJob {
  running: boolean;
  tags?: PageTags;
  why?: string;
  error?: string;
}





export interface DemoSiteEntry {
  
  url: string;
  
  deploy: string;
  
  env?: string;
  
  headers?: Record<string, string>;
  
  maxFile?: number;
  
  host?: 'cloudflare' | 'github';
  project?: string;
  
  secret?: string;
  
  git?: GitFolder;
}






export interface GitFolder {
  branch: string;
  folder: string;
  mode: 'direct' | 'pr';
}


export interface GithubRepo {
  
  repo: string;
  owner: string;
  private: boolean;
}


export interface GithubRepoList {
  login: string;
  repos: GithubRepo[];
}


export interface PushCheck {
  
  allowed: boolean;
  
  admin: boolean;
  
  settings?: string;
}


export interface GithubRepoView {
  repo: string;
  private: boolean;
  branch: string;
  
  size: number;
  
  pages: { url: string; branch?: string; path?: string; workflow: boolean } | null;
  
  address: string | null;
  
  outside?: string;
  push: PushCheck;
}


export interface DemoSitesView {
  sites: {
    url: string;
    host?: 'cloudflare' | 'github';
    project?: string;
    deploy: string;
    
    listed: boolean;
    
    needs?: string;
    
    paths: string[];
    
    git?: GitFolder;
  }[];
  
  job?: SiteSetupJob;
  
  cloudflareAccounts: string[];
}


export interface ProjectDemoSite {
  
  url: string;
  
  path?: string;
  



  publish?: 'approved';
  
  tags?: PageTags;
}


export interface ProjectDemoSiteState {
  url: string;
  path: string;
  
  ready: boolean;
  
  init?: { running: boolean; error?: string };
}







export interface DemoSite {
  
  title: string;
  
  url: string;
  
  deploy: string;
  



  env?: string;
  
  headers?: Record<string, string>;
  
  maxFile?: number;
  



  publish?: 'approved';
  



  tags?: PageTags;
  
  git?: GitFolder;
}






export interface RepoSettings {
  
  branch?: string;
  




  land?: 'main' | 'pr';
  




  direct?: boolean;
  




  autoMerge?: boolean;
  
  checks?: string[];
  
  setup?: string;
  
  planDocs?: { dir: string; exclude: string[] };
  



  softPaths?: string[];
  
  workstations?: 'clones' | 'worktrees';
  
  prNoise?: string[];
  



  language?: Language;
  
  app?: AppSettings;
  






  demo?: { language?: NarrationLanguage; artifacts?: HandoverArtifact[] };
}






export type SharedSettings = Omit<RepoSettings, 'branch'>;


export type CardLanding = Partial<Pick<RepoSettings, 'land' | 'direct'>>;


export const SHARED_FIELDS = ['land', 'direct', 'autoMerge', 'checks', 'setup', 'planDocs', 'softPaths', 'workstations', 'prNoise', 'language', 'app', 'demo'] as const satisfies readonly (keyof SharedSettings)[];


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






export type SettingSource = 'repository' | 'clones' | 'detected' | 'default';


export interface SettingValue<T> {
  value: T;
  source: SettingSource;
  
  held?: true;
}






export interface RepoCommands {
  
  app?: { stop?: string; keep?: string };
  
  claude?: Record<string, ClaudeFile>;
  
  codex?: Record<string, ClaudeFile>;
}





export interface ClaudeFile {
  id: string;
  text: string;
}

export type TrustGroup = keyof RepoCommands;


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


export interface RepoValues {
  branch: SettingValue<string>;
  land: SettingValue<'main' | 'pr'>;
  direct: SettingValue<boolean>;
  autoMerge: SettingValue<boolean>;
  checks: SettingValue<string[]>;
  setup: SettingValue<string>;
  planDocs: SettingValue<{ dir: string; exclude: string[] }>;
  softPaths: SettingValue<string[]>;
  workstations: SettingValue<'clones' | 'worktrees'>;
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
  return JSON.stringify({ ...r, workIn: settings?.workstations });
}

/** Whether saving `after` over `before` restarts or stops some repository's agents: one that left, or whose shape changed (`repoShape`). */
export function restartsAgents(before: ProjectConfig[], after: ProjectConfig[]): boolean {
  const shapes = (projects: ProjectConfig[]) => new Map(projects.flatMap((c) => c.repos.map((r) => [r.path, repoShape(r)] as const)));
  const now = shapes(after);
  return [...shapes(before)].some(([path, shape]) => now.get(path) !== shape);
}


export const CLONES = 2;







export type FilledClones = Map<string, 'filled' | 'withdrawn' | 'owner'>;

/**
 * The draft with `CLONES` filled in for each repository the saved configuration does not have whose
 * settings say clones (`resolved`, by index) and that names none, once per path, or null when it
 * changes nothing. The dialog's number goes again once existing clones are listed beside it (they
 * add up, so 2 beside 2 existing would make 4) and comes back when the list is emptied, as long as
 * the owner has not touched it; `filled` keeps where each path stands, so a count of the owner's,
 * emptied included, stays as it is.
 */
export function withClones(draft: ProjectConfig[], saved: ProjectConfig[], resolved: (ResolvedProject | null)[], filled: FilledClones): ProjectConfig[] | null {
  const known = new Set(saved.flatMap((c) => c.repos.map((r) => r.path.trim())));
  let changed = false;
  const next = draft.map((c, i) => ({
    ...c,
    repos: c.repos.map((r, j) => {
      const path = r.path.trim();
      if (!path || known.has(path) || resolved[i]?.repos[j]?.workstations !== 'clones') return r;
      const existing = !!r.workstations?.some((w) => w.trim());
      const state = filled.get(path);
      if (state === 'owner') return r;
      
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


export interface HostConfig {
  
  name: string;
  
  ssh: string;
  
  root: string;
  
  clones: number;
  
  slots?: number;
}





export interface ProjectSettings {
  
  planBaselines?: boolean;
  




  archive?: CardArchiving;
  
  rightClick?: RightClick;
  
  suggest?: SuggestSettings;
  
  suggestLabels?: boolean;
  
  suggestCards?: boolean;
  
  suggestMerges?: boolean;
  
  agents?: ProjectAgents;
  
  codeReviews?: Partial<CodeReviewSetting>;
  modelFeedback?: boolean;
  
  demoSite?: ProjectDemoSite | null;
}


type ProjectAgent = Partial<Omit<AgentSetting, 'harness' | 'codex' | 'agy'>> & {
  
  harness?: Harness | null;
  codex?: Partial<NonNullable<AgentSetting['codex']>>;
  agy?: Partial<NonNullable<AgentSetting['agy']>>;
};
export type ProjectAgents = Partial<Record<AgentRole, ProjectAgent>>;


export interface ProjectSettingsView {
  settings: ProjectDefaults;
  agents: Record<AgentRole, AgentSetting>;
  harnesses?: Harness[];
}


export interface ProjectConfig extends ProjectSettings {
  
  name?: string;
  
  id?: string;
  
  oldNames?: string[];
  
  icon?: string;
  repos: RepoConfig[];
}


export type ProjectDefaults = Required<Omit<ProjectSettings, 'codeReviews'>> & { codeReviews: CodeReviewSetting };


export interface ProjectDefaultsView {
  file: string;
  defaults: ProjectDefaults;
}


export interface ResolvedProject {
  id: string;
  name: string;
  repos: {
    id: string;
    workstations: 'clones' | 'worktrees';
    
    folder?: true;
    



    adapterGone?: boolean;
    
    values: RepoValues;
    
    trust?: RepoTrust;
    
    settingsFile: string;
    



    shareTo: 'main' | 'pr';
    
    shareDirect?: boolean;
    



    leaving?: LeavingClone[];
  }[];
}


export interface LeavingClone {
  path: string;
  host?: string;
  
  made?: number;
  
  card?: string;
}


export interface ConfigProblem {
  code: ConfigProblemCode;
  project?: number;
  repo?: number;
  
  detail: string;
  
  of?: string;
  
  ofProject?: number;
}



export const START_FAILED: ConfigProblemCode[] = ['projectDown', 'repoDown', 'repoBefore'];

export const blocksSaving = (p: ConfigProblem) => !['adapterGone', 'repoSettings', 'untrusted', ...START_FAILED].includes(p.code);

/**
 * The problems that keep a save from going through: a project's own problems count only while the project is
 * changed (or added), so one project's old problem does not stop another from being saved or set up.
 */
export const blockingProblems = (problems: ConfigProblem[], changed: (project: number) => boolean) =>
  problems.filter((p) => blocksSaving(p) && (p.project === undefined || changed(p.project) || (p.ofProject !== undefined && changed(p.ofProject))));

export type ConfigProblemCode =
  
  | 'noProject'
  | 'noRepo'
  
  | 'noPath'
  
  | 'notRepo'
  
  | 'folderHarness'
  
  | 'noFolder'
  
  | 'sameRepo'
  
  | 'adapterGone'
  
  | 'sameId'
  
  | 'nameTaken'
  
  | 'oldNameTaken'
  
  | 'homeMissing'
  
  | 'notClone'
  
  | 'otherClone'
  
  | 'hostRepo'
  
  | 'hostName'
  
  | 'noBranch'
  
  | 'repoSettings'
  
  | 'untrusted'
  
  | 'projectDown'
  
  | 'repoDown'
  
  | 'repoBefore'
  
  | 'invalid';





export interface ConfigView {
  
  file: string;
  
  source: 'file' | 'args';
  
  projects: ProjectConfig[];
  
  running: string[];
  



  server: { port: number; home: string; permissionMode: string; restarts: boolean; version: string; commit: string | null };
  
  restarting: boolean;
}


export interface ConfigChecked {
  
  projects: ProjectConfig[];
  
  resolved: (ResolvedProject | null)[];
  problems: ConfigProblem[];
}





export interface ProjectReposView {
  project: ProjectConfig;
  resolved: ResolvedProject | null;
  problems: ConfigProblem[];
  
  source: 'file' | 'args';
  restarting: boolean;
  
  projects: number;
}


export type SettingsShared =
  
  | { committed: string; branch: string; file?: string }
  
  | { pr: string };


export interface ConfigSaved {
  restarting: boolean;
  
  applied?: boolean;
}


export type DemoSettingsProblem =
  
  | 'noCommand'
  
  | 'noUrl'
  
  | 'noKey'
  | 'keyFileMissing'
  
  | 'notHere'
  
  | 'unknownSpeaker';


export type ClipProblem = 'referenceMissing' | 'noTranscript';


export interface DemoVoiceCheck {
  
  person: 'first' | 'third';
  problems: DemoSettingsProblem[];
  
  clips: Partial<Record<NarrationLanguage, ClipProblem>>;
  
  install: { installed: boolean; missing: string[]; mb: number };
  
  directory: string;
  
  directoryRelative?: true;
}


export interface VoiceInstallJob {
  voice: VoiceKind;
  running: boolean;
  
  line: string;
  error?: string;
}


export interface DemoSettingsView {
  
  file: string;
  settings: DemoSettings;
  
  check: DemoVoiceCheck;
  
  job?: VoiceInstallJob;
  
  platform: string;
  
  space?: DemoSpaceView;
}


export interface DemoSpaceView {
  
  keepDays: number | null;
  
  defaultDays: number | null;
  
  busy: boolean;
  
  used?: { bytes: number; work: number; at: string };
  
  freed?: { at: string; demos: number; bytes: number };
}


export interface LanguageView {
  
  file: string;
  
  chosen: Language | null;
  
  system: Language;
  
  language: Language;
  
  conversationChosen: Language | null;
  
  conversation: Language;
}


export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export interface ThemeView {
  
  file: string;
  
  chosen: Theme | null;
}


export const MOTIONS = ['full', 'reduced'] as const;
export type Motion = (typeof MOTIONS)[number];
export interface MotionView {
  
  file: string;
  
  chosen: Motion | null;
}






export interface UsageLimit {
  
  kind: string;
  
  group: string;
  
  scope?: string;
  
  percent: number;
  
  resetsAt?: string;
  
  severity: string;
}


export interface Usage {
  
  harness: 'claude' | 'codex' | 'agy';
  limits: UsageLimit[];
  
  at: string;
}


export interface UsageMeterView {
  
  file: string;
  on: boolean;
}


export interface NotificationsView {
  
  file: string;
  on: boolean | null;
}







export const OWNER_SETTINGS = ['language', 'theme', 'motion', 'notifications', 'usageMeter', 'projectDefaults', 'agents', 'codexAutoReview', 'demo'] as const;
export type OwnerSetting = (typeof OWNER_SETTINGS)[number];


export interface OwnerSettingViews {
  language: LanguageView;
  theme: ThemeView;
  motion: MotionView;
  notifications: NotificationsView;
  usageMeter: UsageMeterView;
  projectDefaults: ProjectDefaultsView;
  agents: AgentsView;
  codexAutoReview: AgentsView;
  demo: DemoSettingsView;
}


export interface OwnerSettingChanges {
  
  language: { language?: Language | null; conversation?: Language | null };
  theme: { theme: Theme | null };
  motion: { motion: Motion | null };
  notifications: { on: boolean };
  usageMeter: { on: boolean };
  projectDefaults: ProjectSettings;
  
  agents: Partial<Record<AgentRole, Partial<AgentSetting>>>;
  codexAutoReview: { on: boolean };
  
  demo: DemoSettings;
}






export type RemoteSetting = ({ via: 'tailscale' } | { via: 'address'; address: string } | { via: 'hosts'; hosts: string[] }) & {
  
  awake?: 'always';
};


export type TailscaleState =
  | { state: 'missing' }
  
  | { state: 'stopped' }
  | { state: 'loggedOut' }
  
  | { state: 'noHttps'; name: string; enable?: string }
  



  | { state: 'ready'; name: string; account?: string; others: number };


export type RemoteProblem =
  
  | { code: 'operator' }
  
  | { code: 'portsTaken' }
  
  | { code: 'listen'; detail: string }
  | { code: 'failed'; detail: string };


export interface DeviceView {
  id: string;
  
  name: string;
  pairedAt: string;
  lastSeen: string;
  
  push?: true;
}


export interface Pairing {
  code: string;
  
  url: string;
  expires: string;
  
  linked?: true;
  
  paired?: DeviceView;
}


export interface AccessView {
  local: true;
  
  file: string;
  
  remote: RemoteSetting | null;
  tailscale: TailscaleState;
  
  address: string | null;
  problem?: RemoteProblem;
  
  addresses: string[];
  devices: DeviceView[];
  pairing: Pairing | null;
  
  platform: string;
}

export interface AwayView {
  local: false;
  host: string;
}


export const AGENT_ROLES = ['koordinator', 'worker', 'explorer', 'chores', 'review'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_MODELS = ['default', 'fable', 'opus', 'sonnet', 'haiku'] as const;
export type AgentModel = (typeof AGENT_MODELS)[number];

export type ChatModel = AgentModel | `codex:${string}` | `agy:${string}`;

export function chatModelFor(harness: Harness, choice?: ChatModel): string | undefined {
  if (!choice || choice === 'default') return undefined;
  const separator = choice.indexOf(':');
  if (separator < 0) return harness === 'claude' ? choice : undefined;
  return choice.slice(0, separator) === harness ? choice.slice(separator + 1) : undefined;
}
export const AGENT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AgentEffort = (typeof AGENT_EFFORTS)[number];

export interface AgentSetting {
  model: AgentModel;
  effort: AgentEffort;
  
  harness?: Harness;
  
  codex?: { model: string; effort: AgentEffort };
  
  agy?: AgyChoice;
}


export const HARNESSES = ['claude', 'codex', 'agy'] as const;
export type Harness = (typeof HARNESSES)[number];

export const HARNESS_NAMES: Record<Harness, string> = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity' };


export const HARNESS_SECTION = { claude: 'needed', codex: 'codex', agy: 'agents' } as const satisfies Record<Harness, MachineSectionId>;

export interface HarnessAvailability {
  configured: Harness[];
  ready: Harness[];
}

/** Whether a harness's workers need a local Git workstation, so a folder without git cannot be theirs (Codex and Antigravity, as `portable` has it). */
export const needsGit = (harness: Harness | undefined): harness is 'codex' | 'agy' => harness === 'codex' || harness === 'agy';

/**
 * Keep a role's harness if selected. Otherwise prefer Claude Code (represented by undefined), then the first selected harness.
 */
export const firstProjectHarness = (configured: readonly string[], current?: Harness): Harness | undefined =>
  configured.includes(current ?? 'claude') ? current : configured.includes('claude') ? undefined : HARNESSES.find((h) => configured.includes(h));

/** The model and effort of `setting` in the harness it names (Claude's aliases for Claude Code). */
export function harnessChoice(setting: AgentSetting): { model: string; effort: AgentEffort } {
  const own = setting.harness === 'codex' ? setting.codex : setting.harness === 'agy' ? setting.agy : undefined;
  return setting.harness && setting.harness !== 'claude' ? { model: own?.model ?? 'default', effort: own?.effort ?? setting.effort } : setting;
}


export interface ModelInfo {
  model: string;
  isDefault: boolean;
  
  supportedReasoningEfforts: { reasoningEffort: string }[];
  
  defaultReasoningEffort?: AgentEffort;
  
  inputModalities?: string[];
}

/** Whether the model reads images; undefined where its catalog does not say. */
export const modelReadsImages = (model: ModelInfo | undefined): boolean | undefined => (model?.inputModalities ? model.inputModalities.includes('image') : undefined);

export type AgyChoice = { model: string; effort?: AgentEffort };

/** Resolve only variant IDs the catalog confirmed with a matching display-name tag. */
export function agyBaseChoice(choice: AgyChoice, models?: readonly ModelInfo[] | null): AgyChoice {
  if (!models || models.some((m) => m.model === choice.model)) return choice;
  for (const model of models) {
    const effort = AGENT_EFFORTS.find((e) => choice.model === `${model.model}-${e}` && model.supportedReasoningEfforts.some((x) => x.reasoningEffort === e));
    if (effort) return { model: model.model, effort };
  }
  return choice;
}

export function catalogModel(models: readonly ModelInfo[] | null | undefined, id: string): ModelInfo | undefined {
  return models?.find((m) => id === 'default' ? m.isDefault : m.model === id);
}

export function modelEfforts(model: ModelInfo | undefined): AgentEffort[] {
  return AGENT_EFFORTS.filter((e) => model?.supportedReasoningEfforts.some((x) => x.reasoningEffort === e));
}

/** Keep the chosen effort if supported, otherwise prefer the catalog's default. */
export function modelEffort(model: ModelInfo | undefined, chosen?: AgentEffort): AgentEffort | undefined {
  const efforts = modelEfforts(model);
  if (chosen && efforts.includes(chosen)) return chosen;
  const preferred = model?.defaultReasoningEffort;
  return preferred && efforts.includes(preferred) ? preferred : efforts[0];
}

/** A saved setting keeps its original ID until a catalog can identify a legacy variant. */
export function withAgyBase<T extends { agy?: AgyChoice }>(setting: T, models?: readonly ModelInfo[] | null): T {
  const base = setting.agy && agyBaseChoice(setting.agy, models);
  return base && base !== setting.agy ? { ...setting, agy: base } : setting;
}


export const AGENT_DEFAULTS: Record<AgentRole, AgentSetting> = {
  koordinator: { model: 'opus', effort: 'medium' },
  worker: { model: 'opus', effort: 'high' },
  explorer: { model: 'opus', effort: 'high' },
  chores: { model: 'opus', effort: 'medium' },
  review: { model: 'opus', effort: 'high' },
};


export interface AgentsView {
  file: string;
  agents: Record<AgentRole, AgentSetting>;
  
  harnesses?: Harness[];
  
  codexAutoReview: boolean;
}






export const CLOUD_VOICES = {
  groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo', keys: 'https://console.groq.com/keys', prompt: true },
  mistral: { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'voxtral-mini-latest', keys: 'https://console.mistral.ai/api-keys', prompt: false },
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-transcribe', keys: 'https://platform.openai.com/api-keys', prompt: true },
} as const;
export type CloudPreset = keyof typeof CLOUD_VOICES;
export const CLOUD_PRESETS = Object.keys(CLOUD_VOICES) as CloudPreset[];


export interface CloudVoiceView {
  preset: CloudPreset;
  baseUrl: string;
  model: string;
  key: boolean;
  
  used: boolean;
  
  tested?: { seconds: number };
}





export interface VoiceSpeed {
  backend: ListenBackend;
  seconds: number;
  slow: boolean;
}


export type VoiceSetupId = 'recognition' | 'ffmpeg' | 'uv';
export type VoiceSetupItem = Omit<SetupItem, 'id'> & {
  id: VoiceSetupId;
  
  waits?: 'uv';
} & VoiceRecognitionParts;


export interface VoiceRecognitionParts {
  
  speed?: VoiceSpeed | 'measuring';
  cloud?: CloudVoiceView;
}

export interface VoiceSetupView {
  platform: string;
  arch: string;
  listen: ListenBackend;
  items: VoiceSetupItem[];
  
  fetch: { mb: number };
  
  job?: { running: boolean; step: 'fetch' | 'measure'; error?: string };
}


export type MachineSectionId = 'needed' | 'git' | 'codex' | 'agents' | 'pr' | 'voice' | 'demos' | 'mobile';

export const RECOMMENDED_SECTIONS: readonly MachineSectionId[] = ['pr', 'voice', 'demos', 'mobile'];

export type NeededId = 'claude' | 'claudeLogin';

export type GitId = 'git' | 'gitUser';

export type AgentsId = 'agy' | 'agyLogin';

export type CodexId = 'codex' | 'codexLogin';

export type PrId = 'gh' | 'ghLogin';

export type MobileId = 'xcode' | 'simulator' | 'safaridriver' | 'axe';


export type MachineItem = Omit<SetupItem, 'id'> & {
  id: NeededId | GitId | CodexId | PrId | AgentsId | MobileId | VoiceSetupId | SetupId;
  





  act?: 'install' | 'login' | 'terminal' | 'identity';
  
  waits?: 'uv';
} & VoiceRecognitionParts;

export interface MachineSection {
  id: MachineSectionId;
  items: MachineItem[];
  
  mb: number;
}


export interface MachineJob {
  kind: 'install' | 'clone';
  section?: MachineSectionId;
  id?: MachineItem['id'];
  running: boolean;
  
  line: string;
  error?: string;
  
  project?: string;
  
  branch?: string;
  
  opens?: boolean;
}

export interface MachineView {
  platform: string;
  arch: string;
  sections: MachineSection[];
  
  checkedClaude: string;
  job?: MachineJob;
  
  picker: boolean;
  
  cloneInto: string;
}


export interface FirstProject {
  project: string;
  
  branch: string;
  opens: boolean;
}


export interface SetupFolder {
  repo: boolean;
  branch?: string;
  
  folder?: boolean;
}






export type SetupRepoCheck = { readable: true } | { readable: false; error: string; github: boolean; ghLogin: boolean; needsPassword?: true };


export const LARGE_FILE = 1_000_000;


export interface GitSetupPreview {
  path: string;
  
  branch: string;
  
  gitignore?: string;
  files: number;
  bytes: number;
  
  entries: { path: string; dir: boolean; files: number; bytes: number }[];
  
  large: { path: string; bytes: number }[];
  
  ignored: string[];
}







export type RestartReason = 'code' | 'config' | 'repository' | 'owner' | 'rebuild' | 'update' | 'takeover' | 'stop';


export interface DeveloperView {
  
  restart: boolean;
  
  rebuild: boolean;
  
  why?: 'dev';
  
  rebuildWhy?: 'compiled';
}


export interface AppUpdate {
  version: string;
  
  notes?: string;
  
  date?: number;
  
  download?: string;
}





export interface SourceUpdate {
  
  upstream: string;
  
  checkout: string;
  
  count: number;
  
  commits: { subject: string; date: number }[];
  



  blocked?: { why: 'diverged' } | { why: 'local'; files: string[] };
  
  error?: string;
}


export type OwnerHold = 'video' | 'voice';


export interface PendingRestart {
  reason: RestartReason;
  
  deadline: number;
  
  cards: string[];
  
  elsewhere: { id: string; project: string; cards: { id: string; short?: string; title: string }[] }[];
  
  owner: OwnerHold[];
  
  repos?: string[];
  
  leaving?: boolean;
}


export type ClientMessage =
  
  | { type: 'hold'; hold: OwnerHold[] }
  
  | { type: 'back' }
  
  | { type: 'here' }
  
  | { type: 'away' }
  
  | { type: 'ping' }
  




  | { type: 'focus'; place?: string }
  
  | ({ type: 'stall' } & PageStall);






export interface PageStall {
  ms: number;
  scripts: { what: string; ms: number }[];
  before: string[];
}


export type ServerMessage =
  | { type: 'snapshot'; snapshot: ProjectSnapshot }
  | { type: 'event'; event: CardEvent }
  
  | { type: 'eventGone'; cardId: string; id: number }
  



  | { type: 'hello'; server: string; oldBun?: string }
  
  | { type: 'pong' }
  
  | { type: 'restart'; restart: PendingRestart | null }
  
  | { type: 'update'; update: AppUpdate | null }
  
  | { type: 'source'; source: SourceUpdate | null }
  
  | { type: 'usage'; usage: Usage[] }
  
  | { type: 'waiting'; waiting: Record<string, Waiting> }
  
  | { type: 'projects'; projects: ProjectInfo[] }
  
  | ({ type: 'notice' } & Notice);






export interface Notice {
  
  cardId?: string;
  text: string;
  
  level?: 'warning';
  token?: string;
  undoMs?: number;
  
  wish?: Wish;
  
  talk?: number;
  
  plan?: string;
  
  inTalk?: true;
  
  open?: true;
  
  movedTo?: string;
  



  made?: { id: string; title: string; project?: string }[];
}


export interface Skill {
  name: string;
  
  description: string;
  
  hint?: string;
}

/**
 * The model and effort a group of a project's agents runs with: Configuration's, with the project's own
 * over it. A project's own model for its workers is one of Claude Code's, so it runs them in Claude Code; an effort alone keeps them where they are.
 */
export function projectAgentSetting(role: AgentRole, base: AgentSetting, own: ProjectAgents | undefined, harnesses?: readonly Harness[]): AgentSetting {
  if (base.model === 'default') base = { ...base, model: AGENT_DEFAULTS[role].model };
  const configured = own?.[role];
  if (!configured || !Object.keys(configured).length) return base;
  const { codex, agy, harness: requestedHarness, ...fields } = configured;
  const mine = fields.model === 'default' ? { ...fields, model: base.model } : fields;
  const harness = requestedHarness === undefined && mine.model && base.harness ? 'claude' : requestedHarness ?? base.harness;
  if (harnesses && !harnesses.includes(harness ?? 'claude')) return base;
  const inheritedCodex = base.harness === 'codex' ? harnessChoice(base) : { model: 'default', effort: base.effort };
  const inheritedAgy = base.harness === 'agy' ? base.agy : undefined;
  const portable = {
    ...(codex || harness === 'codex' ? { codex: {
      model: codex?.model ?? inheritedCodex.model,
      effort: codex?.effort ?? (harness === 'codex' ? mine.effort : undefined) ?? inheritedCodex.effort,
    } } : {}),
    ...(agy || harness === 'agy' ? { agy: {
      model: agy?.model ?? inheritedAgy?.model ?? 'default',
      effort: agy?.effort ?? (harness === 'agy' ? mine.effort : undefined) ?? inheritedAgy?.effort,
    } } : {}),
  };
  if (!requestedHarness && (harness === 'codex' || harness === 'agy')) return { ...base, ...(mine.model ? { model: mine.model } : {}), ...portable };
  return { ...base, ...mine, ...portable, ...(harness ? { harness } : {}) };
}



export const ACTIVITY_CODES = ['created', 'proposed', 'archived', 'deleted', 'stopped', 'reviewSent', 'approved', 'started', 'landed', 'waitsForCard', 'waitsForWorkstation', 'usageLimit'] as const;
export type ActivityCode = (typeof ACTIVITY_CODES)[number];


export type ActivityWho = 'owner' | 'agent' | 'seismic';


export interface ActivityEntry {
  id: number;
  at: string;
  who: ActivityWho;
  code: ActivityCode;
  project: string;
  projectName: string;
  card: Item;
  
  deleted?: true;
  
  other?: { id: string; title: string };
  
  harness?: Harness;
}


export interface ActivityPage {
  entries: ActivityEntry[];
  more: boolean;
}
