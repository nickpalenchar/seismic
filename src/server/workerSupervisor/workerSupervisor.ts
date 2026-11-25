import { normalize, overlaps } from '../../core/path-overlap';
import { workerConfig } from '../worker-config';
import type { LandingNotice } from '../workstations';
import { LimitAttempts, limitWatch } from '../limit-watch';



import { extensionSettings, type PermissionContext, type PermissionOption, serverExtensions as extensions } from '../../extensions/server';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { RepoAdapter } from '../../adapters/types';
import type { CardDiff } from '../../core/diff';
import { type Language, LANGUAGES } from '../../core/locale';
import { MESSAGES, type Messages } from '../../core/messages';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute } from 'node:path';
import { type CardFile, docImages, fileKind, isImage, normalPath, shownFiles } from '../../core/files';
import { DEFAULT_DEMO_DIRECTORY, expandHome } from '../../../plugin/skills/demo/lib/settings.ts';
import { HANDOVER_ARTIFACTS, type HandoverArtifact } from '../../../plugin/skills/demo/lib/artifacts.ts';
import { mmss } from '../../../plugin/skills/demo/lib/timeline.ts';
import { AGENT_DEFAULTS, harnessChoice, type AgentSetting, answering, askable, type Awaited, type BackgroundTask, AGENT_HOLDS, halted, type Hold, isPaused, isPausing, pausable, pausableNow, snoozeOf, type WorkerTurn, type CardLanding, finished, formatQuestion, handedOver, type Item, ownWords, pickedAnswer, type Question, type RepoRef, type RepoSettings, type Share, type Snooze, type Spot, type Superseded, type SpotInput, started, stoppedAtOf } from '../../core/types';
import { ACTIVE, BadRequest, type Board, holdNow, replyNote, type Retracted, type StoredDemo, titleKey } from '../board';
import { DEMO_SKILL, DEMO_SKILL_FILE, demoSkillName, SEISMIC_PLUGIN, placeIn } from '../demo';
import { imageNote } from '../images';
import { outsidePlanDir } from '../repo';
import type { InputContext } from '../koordinator';
import { type AgentEvent, type AgentRuntime, type AgentSession, type AgentTool, LIMIT_LIFTED, type PermissionAnswer, type PermissionRequest } from '../runtime';
import { BACKGROUND_GRACE, BACKGROUND_LIMIT, failureReason } from '../llms/harnesses/claude';
import { execTools } from '../llms/harnesses/codexExecTools';
import { type Forward, HOST_DIR, hostName, remote } from '../hosts';
import { runAppCommand } from '../app-command';
import { readingShared } from '../../adapters';
import { branchName, type CardWorkstations, type FileAt, type FileVersions, gitSteps, ownFile, type Landed, type Lease, type PullStopped, shortageOf, together, WorkstationError, type Workstations } from '../workstations';
import type { FolderWorkstations, UndoReport } from '../folder';
import { contributionOf, type PrState, type Shipped, type StoredContribution } from '../board';
import { type Doing, onTool, onToolDone, shownDoing, THINKING_AFTER } from '../doing';
import { type ChangeRoute, type Clash, needsOwner, type FindingPick, type CodeReviewSetting, type Finding, type FindingStatus, type HeldChanges, type PageTags, PUSH_HOLD_MS, SEVERITIES, type Severity } from '../../core/types';
import { CAPTURED_CHANGES, gitAsync, gitOrNull, writeToGitDir } from '../workstations';
import { defaultBranchCommit } from '../read-tree';
import type { CardRow } from '../schemas/cards/cards';
import { workConfig } from '../feedback';
import { type DataSignal, isSchemaPage, SIGNALS_NAMED } from '../data-models';
import { type Forge, parsePrUrl, sameRepo } from '../forge';
import { clip, messageOf } from '../../core/text';
import { holdsNotes } from '../../core/queue';
import { CodeReviews } from './codeReview';
import { workerAgent } from '../llms/agents/worker/workerAgent';
import { restartStillDue, workerContextUpdate } from '../llms/agents/worker/contextUpdate';
import { type DueRestart, pauseOf, restartNotice, restartWaits } from '../llms/agents/worker/restartNotices';
import { workerBriefing } from '../llms/agents/worker/briefing';
import { workerTools } from '../llms/agents/worker/tools';

export interface WorkerOptions {
  board: Board;
  runtime: AgentRuntime;
  agentSetting?: () => AgentSetting;
  
  codexAutoReview?: () => boolean;
  workstations: CardWorkstations;
  adapter: RepoAdapter;
  



  machineSettings?: () => RepoSettings | undefined;
  
  shares?: () => boolean;
  
  vocabulary?: () => PageTags | undefined;
  
  preferences?: () => string;
  
  takeAsked?: (cardId: string) => string | undefined;
  
  onOwnerInput?: (card: Item, kind: 'answer' | 'note' | 'feedback', text: string, context?: InputContext) => void;
  
  repo?: string;
  
  otherBoards?: () => Board[];
  
  onPrOpened?: (cardId: string) => void;
  




  onApproval?: (cardId: string) => string | null;
  
  onMerged?: (cardId: string) => void;
  
  onFollowUpTask?: (taskId: string, reviewId: string) => void;
  
  onLanded?: (cardId: string) => void;
  
  onPrototype?: (prototype: Item, summary: string, demo: string | undefined) => void;
  
  onPrototypeAnswer?: (prototype: Item, question: string, answer: string) => void;
  
  backgroundGrace?: number;
  
  backgroundLimit?: number;
  
  pauseLimit?: number;
  
  parkGrace?: number;
  
  tryGrace?: number;
  
  holdGrace?: number;
  
  releaseDelay?: number;
  
  reconnectMs?: number;
  
  limitMargin?: number;
  
  thinkingAfter?: number;
  
  imageFiles?: (ids?: string[]) => string[];
  





  restartsFor?: (landed: Landed, pushedFrom?: string) => Promise<'seismic' | 'repo' | false> | 'seismic' | 'repo' | false;
  
  env?: Record<string, string>;
  
  demoLanguage?: () => Language;
  
  demoArtifacts?: () => HandoverArtifact[] | undefined;
  
  allowRules?: (cwd: string) => string[];
  




  asOwner?: <T>(cwd: string, change: (repo: { path: string; folder: boolean }) => Promise<T>) => Promise<T>;
  
  codeReviews?: () => CodeReviewSetting;
  
  reviewRuntime?: AgentRuntime;
  reviewAgentSetting?: () => AgentSetting;
  
  harnesses?: () => string[];
  
  demoDirectory?: () => string;
  
  onWorkEnded?: (cardId: string, workstation: string | null) => void;
  
  toSeismic?: (cardId: string, request: string) => Promise<string>;
  
  forge?: Forge;
  
  repoPath?: string;
  
  remote?: string | null;
  




  pulls?: Pick<Workstations, 'pullMain' | 'pushMain' | 'clashBeforeMerge' | 'landResolution' | 'landingOf'>;
  
  pushHold?: number;
  
  pushSettle?: number;
}


type Comments = { text: string; images: string[] };


export interface OwnCommits {
  head: string;
  base: string;
  commits: number;
}


interface HeldComment {
  id: number;
  spoken?: true;
}

/** Where in the demo video the owner's words are, as the worker reads it above them. */
export const spotNote = (spot: Spot) => {
  return `[${spot.earlier ? 'Earlier demo video, one a later handover of yours replaced,' : 'Demo video'} at ${mmss(spot.at)}${spot.chapter ? `, chapter “${spot.chapter}”` : ''}${spot.narration ? `, narration: “${spot.narration}”` : ''}]`;
};


export interface LandedState {
  commit?: string;
  
  unchanged?: boolean;
  
  restarts?: boolean;
  
  waits?: boolean;
  
  page?: boolean;
  
  followUp?: boolean;
  
  worktree?: boolean;
  
  needsClone?: boolean;
  



  resolve?: Resolving;
}


interface Resolving {
  card: string;
  pr: number;
  url: string;
  stopped: PullStopped;
  
  reminded?: true;
}

/** Landed work's state once what it waited for (the restart) has happened. */
const settled = ({ restarts: _, waits: __, ...l }: LandedState): LandedState => l;



/** A path with its links resolved, or as it is where it cannot be (gone). */
const realpathOr = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

function asBadRequest<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof WorkstationError) throw new BadRequest(e.code, e.message);
    throw e;
  }
}

/** `asBadRequest` for what settles later. */
async function asBadRequestAsync<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof WorkstationError) throw new BadRequest(e.code, e.message);
    throw e;
  }
}




/** What became of a proposal the worker took back (`replaced`: by a new one), as it reads it. */
const retractedText = (r: Retracted, replaced: boolean): string => {
  if (r.kind === 'unknown')
    return `No proposal of yours is called so${replaced ? ', so nothing was replaced' : '; nothing was withdrawn'}. Yours: ${r.mine.length ? r.mine.map((m) => `“${m.title}” (${m.gone ? 'removed' : m.state})`).join(', ') : 'none'}.`;
  const it = `“${r.title}”`;
  switch (r.kind) {
    case 'gone':
      return `${it} was still open and is gone from the project.`;
    case 'marked':
      return `The owner had taken ${it} on already (${r.state}): Seismic marks it as ${replaced ? 'replaced' : 'withdrawn'} and offers the owner to remove it.`;
    case 'finished':
      return `${it} is done already (${r.state}); it stays as it is.`;
    case 'dismissed':
      return `The owner had dismissed ${it} already.`;
    case 'removed':
      return `The owner had removed ${it} already.`;
    case 'already':
      return `${it} was withdrawn already.`;
  }
};



const HELD_EDITED = 'While your handover waits, the owner edited the text that goes onto the pull request with the approval.';
const heldEdited = (body: string) => `${HELD_EDITED} It reads now:\n\n${body}\n\nThat is the text that goes out with your commits. Should you hand over again with pr_draft, start from it and keep the owner's wording where nothing calls for a change.`;


const NOT_LANDED = 'Since you handed over, the owner approved your work, but Seismic could not land it on main:';






export interface Unheard {
  
  nextTurn?: true;
  said: number[];
  text: string;
  images: string[];
}





export type PageHeard = { page: 'none' } | { page: 'going' } | { page: 'online'; url: string; stale?: true };

function pageHeardOf(share: Share | undefined): PageHeard {
  if (share?.state === 'publishing') return { page: 'going' };
  if (share?.state === 'shared' && share.url) return { page: 'online', url: share.url, ...(share.stale ? { stale: true as const } : {}) };
  return { page: 'none' };
}


type Holding = Extract<Hold, { reason: 'paused' | 'limit' | 'snoozed' }>;





interface RunningTask extends BackgroundTask {
  earlier?: true;
  app?: true;
}

/**
 * The worker said its app runs (or no longer does). The work it started in this turn and runs now
 * serves it (the dev server it started, then checked); work from an earlier turn (a test run it
 * waits for) does not. The SDK links no task to the app, so this is what tells the two apart.
 */
function appRunning(live: Live, url: string) {
  
  if (url && !workerConfig.appUrl.test(url)) return;
  for (const t of live.tasks.values()) {
    if (!url) delete t.app;
    else if (!t.earlier) t.app = true;
  }
}


/** Whether all the worker's background work that runs serves its app. */
function onlyApp(live: Live): boolean {
  return live.tasks.size > 0 && [...live.tasks.values()].every((t) => t.app);
}


export type StandInStep = { type: 'tool'; name: string; input?: Record<string, unknown> } | { type: 'toolDone'; name: string; ok?: boolean } | { type: 'text'; text: string };

export interface Live {
  session: AgentSession;
  
  autoReview?: boolean;
  
  host: string | null;
  
  handedOver: boolean;
  
  answered?: boolean;
  
  spoke?: boolean;
  
  snoozed?: boolean;
  
  held?: string;
  



  acted: boolean;
  nudged: boolean;
  lastText: string;
  
  ended?: true;
  
  failed?: string;
  
  busy: boolean;
  
  doing?: Doing;
  
  running?: number;
  
  quiet?: ReturnType<typeof setTimeout>;
  
  waiting?: ReturnType<typeof setTimeout>;
  
  limitHit?: boolean;
  limitReset?: number;
  
  model?: string;
  
  background: number;
  
  tasks: Map<string, RunningTask>;
  
  limited?: number;
  
  statusBefore?: string | null;
  
  stalled: boolean;
  
  toldRestart?: boolean;
  
  statusBeforeRestart?: string | null;
  
  restartPaused?: boolean;
  
  pauseHeld?: boolean;
  
  preferences: string;
  
  plan?: { id: string; decision: number };
  
  guessed?: true;
  
  standIn?: true;
  
  permission?: (answer: PermissionAnswer) => void;
  
  asking?: Promise<unknown>;
  
  pending?: { text: string; images: string[] };
}


interface AskedPermission {
  name: string;
  input: Record<string, unknown>;
  
  extra?: { extension: number; label: Record<Language, string>; data?: unknown }[];
}




const HOLD_GRACE = 10 * 60_000;

const RELEASE_DELAY = 1500;

const PARK_GRACE = 5 * 60_000;

const TRY_GRACE = 30 * 60_000;

const PROBE_MS = 1500;
/** Whether the card's status line is the one it shows while its worker waits for a usage limit, in either language. */
const limitLine = (line: string | null | undefined) => !!line && LANGUAGES.some((l) => line.startsWith(MESSAGES[l].worker.limitStatus));

export const SPOKEN = 'spoken, so speech recognition may have misheard words';

/**
 * An answer as the worker reads it: the options the owner picked and the answer they wrote in
 * place of one (`own`, the picks that are no option), apart from the words they added.
 */
export function answerNote(picks: string[], text: string, options: string[] = picks): string {
  if (!picks.length) return text;
  const words = ownWords({ text, picks });
  const picked = picks.filter((o) => options.includes(o));
  const own = picks.find((o) => !options.includes(o));
  const lead = [picked.length ? `They picked ${picked.map((o) => `“${o}”`).join(', ')}.` : '', own ? `They answered in their own words: “${own}”.` : ''].filter(Boolean).join(' ');
  return `${lead}${words ? `\n\nThey added in their own words:\n\n${words}` : ''}`;
}

/** The answers the owner gave to a question with `options`: the options they picked, then the one they wrote in place of an option, on one line. */
export function givenAnswers(options: string[], picks: string[]): string[] {
  const own = picks.map((p) => p.replace(/\s+/g, ' ').trim()).find((p) => p && !options.includes(p));
  return [...options.filter((o) => picks.includes(o)), ...(own ? [own.slice(0, 2000)] : [])];
}





const RECONNECT_MS = 30_000;

const hostResumed = (host: string) =>
  `The connection to ${host}, the machine your workstation is on, dropped, and your session ended with it. Whatever you had running there may have been stopped with it: background commands, servers you started, and a command still running in your turn. Run again what you still need, and go on from there.`;

const RESTARTED =
  'Seismic was restarted. Whatever you had running then was stopped with it: background commands, servers you started, and a command still running in your turn (its result shows exit code 137). Run again what you still need. If you had paused for the restart, go on from there.';

const REPO_RESTARTED =
  "Seismic restarted this repository's agents to apply a change to its configuration. Whatever you had running then was stopped with it: background commands, servers you started, and a command still running in your turn (its result shows exit code 137). Run again what you still need. If you had paused for the restart, go on from there.";










const PAUSE_LIMIT = 15 * 60_000;

/** Tells a worker that the owner pauses it, so that it brings its work to a safe point first instead of being cut off. */
const pauseNotice = (limit: number) => {
  const minutes = Math.max(1, Math.round(limit / 60_000));
  return `The owner pauses you now: they want you to stop for the time being, at a safe point rather than in the middle of a step. Finish the step you are in, start nothing long (a test run, a demo render, a measurement), and end your turn, without handing over if you are not done. Stop the background commands still running (a scratch server you can start again): one you let finish keeps the owner waiting. Seismic pauses you wherever you are after at most ${minutes} minute${minutes === 1 ? '' : 's'}. Pausing ends your session; once the owner lets you go on, you go on from there.`;
};


/** The agent configuration as the card's conversation names it. */
const describeSetting = (s: AgentSetting) =>
  s.harness === 'codex' && s.codex ? `Codex · ${s.codex.model} · ${s.codex.effort}` : s.harness === 'agy' && s.agy ? `Antigravity · ${s.agy.model}${s.agy.effort ? ` · ${s.agy.effort}` : ''}` : `Claude Code · ${s.model} · ${s.effort}`;


const HANDED_OFF_SAME =
  'The usage limit of the model you ran on stopped your last turn, and the owner handed the card to another model: you run on it now, in the same session. Go on where you stopped.';


const HANDED_OFF_NEW =
  "You take this card over from another agent: the usage limit of its model stopped it, and the owner handed the card to you. Its work so far is in this workstation, on the card's branch (commits, and changes not committed yet); look at it before you go on, and finish the task.";


const PAUSE_TAKEN_BACK = 'The owner no longer wants you to pause: go on with your work.';

const RESUMED =
  'The owner paused you and has now let you go on. Pausing ended your session at once: whatever you had running was stopped with it, background commands, servers you started, and a command still running in your turn (its result shows exit code 137). Run again what you still need, and go on where you stopped.';


/** What became of the card a snoozed worker waits on, that wakes it. */
function metNote(on: NonNullable<Snooze['on']>, met: Awaited): string {
  const card = `the card “${on.title}”`;
  switch (met) {
    case 'reached':
      return on.state === 'done' ? `${cap(card)} is done: its work is on main, or it closed without a change.` : `${cap(card)} waits for the owner now (a question or a handover), or is done.`;
    case 'gone':
      return `${cap(card)} is gone from the project.`;
    case 'archived':
      return `${cap(card)} was archived.`;
    case 'stopped':
      return `The owner stopped ${card}: it is planned again, and nobody works on it.`;
    case 'dropped':
      return `${cap(card)} was an idea, and the owner dropped it.`;
  }
}
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/**
 * What a snoozed worker hears when it wakes: why now (`timeUp`: its time has come; `met`: the card it
 * waits on got there, or no longer can; `owner`: the owner woke it, `words` with words of theirs
 * that follow; else Seismic has something for it).
 */
function wokeNote(s: Snooze, timeUp: boolean, owner: boolean, words: boolean, met?: Awaited): string {
  const now = MESSAGES.en.at(Date.now());
  const until = workerConfig.snoozedUntil(s);
  const why = s.why ? `, to: ${s.why}` : '';
  const ended =
    s.by === 'agent'
      ? 'Your session ended when you snoozed, and whatever still ran in the background then was stopped with it. Run again what you still need.'
      : 'Snoozing ended your session at once: whatever you had running was stopped with it, background commands, servers you started, and a command still running in your turn (its result shows exit code 137). Run again what you still need, and go on where you stopped.';
  if (met && s.on) return `${metNote(s.on, met)} You snoozed until ${until}${why}. ${ended}`;
  if (timeUp) {
    const yet = s.on ? ` The card “${s.on.title}” has not got there yet.` : '';
    return `${s.by === 'owner' ? `The owner snoozed you until ${until}, and it is that time now.` : s.moved ? `It is now ${now}: you snoozed${why}, and the owner moved the time to now.` : s.on ? `It is now ${now}: you snoozed until ${until}${why}.` : `It is now ${now}, the time you snoozed until${why}.`}${yet} ${ended}`;
  }
  const who = s.by === 'owner' ? `The owner snoozed you until ${until}` : s.moved ? `You snoozed${why}, and the owner moved the time to ${MESSAGES.en.at(Date.parse(s.until!))}` : `You snoozed until ${until}${why}`;
  const early = owner ? (words ? 'the owner wakes you early' : 'the owner wakes you early, without words, so tell them with reply where things stand') : 'what follows wakes you early';
  return `${who}; it is now ${now}, and ${early}. ${ended}${s.by === 'agent' ? ' Once you have dealt with it, snooze again if there is still nothing to do until then.' : ''}`;
}

const AFTER_RESTART = 'If something that remains needs Seismic to run your change, call after_restart and end your turn: Seismic tells you once it runs it.';


const AFTER_DONE = 'This session stays until you end a turn with nothing left to wait for (a question, say); then it ends.';

const FOLLOW_UP_FOLDER =
  "Answer with reply (ask, for a decision that is the owner's). What you change in the folder now counts as this card's, as before, but can no longer be undone from the card: a change the owner's words call for that is more than a small correction becomes a card of its own (propose_card). The session ends once you end a turn with nothing left to wait for.";

const FOLLOW_UP =
  "Answer with reply (ask, for a decision that is the owner's). Commits you make here do not land: a change to the code the owner's words call for becomes a card of its own (propose_card). Workstation and session end once you end a turn with nothing left to wait for.";

const IN_WORKTREE =
  "No clone of the repository was free, so this is a temporary worktree, where the repository's app and tooling may not run. If answering needs a full clone, call need_clone and end your turn: Seismic resumes you in the next free clone.";


const EVICT_SESSION_WAIT = 30_000;

export class WorkerSupervisor {
  live = new Map<string, Live>();
  private limitAttempts = new Map<string, LimitAttempts>();
  
  private standIns = new Map<string, Live>();
  
  private landing = new Set<string>();
  private landingTurns = new Map<string, AbortController>();
  private landingActive = new Set<string>();
  private unwatchLandings?: () => void;
  
  private approving = new Set<string>();
  
  private pushingMain = new Map<string, ReturnType<typeof setTimeout> | true>();
  
  private reading = new Map<string, Promise<void>>();
  
  private dataBounced = new Map<string, Set<string>>();
  



  private preparing = new Map<string, { host: string | null; done: Promise<void> }>();
  
  private shut = false;
  
  private generation = new Map<string, number>();
  
  restart: DueRestart | null = null;
  
  private parking = new Map<string, ReturnType<typeof setTimeout>>();
  
  private tried = new Map<string, number>();
  
  private forwards = new Map<string, { app: string; workstation: string; forward: Forward; port?: number }>();
  
  private stopping = new Map<string, Promise<void>>();
  
  private reconnecting = new Map<string, ReturnType<typeof setTimeout>>();
  
  private pausing = new Map<string, ReturnType<typeof setTimeout>>();
  
  private granted = new Map<string, Set<string>>();
  
  private settling = false;
  
  private kept = new Set<string>();
  



  private freeing = new Map<string, { card: string; done: Promise<void> }>();
  
  private evicting = new Set<string>();
  
  private holding = new Map<string, ReturnType<typeof setTimeout>>();

  
  private unwatch: () => void;

  
  readonly reviews: CodeReviews;

  constructor(readonly o: WorkerOptions) {
    this.reviews = new CodeReviews({ board: o.board, runtime: o.reviewRuntime ?? o.runtime, workstations: o.workstations, ...(o.reviewAgentSetting ? { agentSetting: o.reviewAgentSetting } : {}), ...(o.repo ? { repo: o.repo } : {}) });
    
    o.board.showTurns(() => this.turnsShown());
    this.unwatchLandings = o.workstations.watchLandings?.((notice) => this.landingNotice(notice));
    
    this.unwatch = o.board.onChange(() => {
      for (const [id, f] of this.forwards) {
        const card = this.o.board.item(id);
        if (card?.agent?.app !== f.app || this.o.board.row(id).workstation !== f.workstation) this.unforward(id);
      }
      this.settleLater();
    });
  }

  /** The folder without git the cards work in, where the repository is one. */
  get folder(): FolderWorkstations | null {
    return this.o.workstations.mode === 'folder' ? (this.o.workstations as FolderWorkstations) : null;
  }

  /** Whether a video demo here may go to a page for colleagues, which the worker then writes. */
  get shares(): boolean {
    return this.o.shares ? this.o.shares() : false;
  }

  

  /**
   * Starts the card's worker. The card is at work at once, its workstation taken; the worker starts
   * once git has made that ready, which the promise waits for. Refusals (`notPlanned`, no workstation
   * free) throw at once; where the clone it took turns out not to be clean and no other is, the card
   * is planned again and the promise rejects with that shortage.
   */
  start(cardId: string, selected?: AgentSetting): Promise<void> {
    const card = this.card(cardId);
    this.limitAttempts.delete(cardId);
    if (card.kind === 'plan') throw new BadRequest('plan', 'a plan is worked on through its workstreams');
    if (card.state !== 'planned') throw new BadRequest('notPlanned', 'only a planned card can be started');
    if (this.evicting.has(card.id)) throw new BadRequest('evicting', 'its workstation is being given to another card');
    
    const row = this.o.board.row(card.id);
    const branch = row.branch ?? branchName(card.title, card.id);
    const { path, ready } = asBadRequest(() => this.o.workstations.lease(card.id, branch, { from: row.kept_in }));
    this.bump(card.id);
    
    if (row.session_id) this.o.board.log(card.id, 'state', 'seismic', this.o.board.t.worker.restarted(this.o.board.t.worker.earlierRun(row.session_id)));
    
    const contribution = contributionOf(row);
    const pr: PrState | null = contribution ? { url: contribution.url, number: contribution.number, seen: [], reported: [] } : null;
    
    this.o.board.work(card.id, { state: 'working', need: null, ...this.keepingConflict(card.id), status_line: null, workstation: path, branch, session_id: null, agent_setting: selected ? JSON.stringify(selected) : null, review: { pr }, parked: null, ...this.o.board.unheld(card.id, AGENT_HOLDS), app: null });
    this.o.board.record(card.id, 'started', 'agent');
    const t = this.o.board.t.worker;
    this.o.board.log(card.id, 'state', 'seismic', this.folder ? t.startedInFolder : contribution ? t.reviewStarted(contribution.number, contribution.author) : t.started(branch));
    if (selected) this.o.board.log(card.id, 'state', 'seismic', t.startedWith(describeSetting(selected)));
    const asked = this.o.takeAsked?.(card.id);
    const launch = (headProblem?: string | null) => this.launch(card.id, [workerBriefing(this, card, branch, !!row.branch, headProblem), asked].filter(Boolean).join('\n\n'), undefined, this.taskImages(card));
    
    const captured = this.captured(card.id);
    const placed = captured === undefined ? ready : (ready ?? Promise.resolve(path)).then(async (at) => (await writeToGitDir(at, CAPTURED_CHANGES, captured), at));
    return this.whenReady(
      card.id,
      placed,
      () => {
        
        if (row.kept_in) this.o.board.work(card.id, { kept_in: null });
        
        if (contribution) this.onPrHead(card.id, branch, contribution, launch);
        else launch();
      },
      
      () => this.o.board.work(card.id, { state: 'planned', workstation: null, branch: row.branch, ...this.o.board.unheld(card.id, AGENT_HOLDS) }),
      true,
    );
  }

  /**
   * Runs `go` (the worker starts, or goes on) once git has made the card's workstation ready
   * (`Lease.ready`; at once when it is), unless the card was stopped, snoozed or started anew
   * meanwhile; until then its status line says that its workstation is being prepared. Where git
   * fails, `undo` puts the card back as it was, whatever came meanwhile, as long as the card still
   * names the workstation, and its conversation says why. `queues`: where no clean clone was left, the
   * promise rejects with the shortage instead, for the Koordinator to queue the card as when there is
   * none at once.
   */
  private whenReady(cardId: string, ready: Promise<string> | null, go: () => void, undo: () => void, queues = false): Promise<void> {
    if (!ready) {
      go();
      return Promise.resolve();
    }
    const generation = this.generation.get(cardId);
    const line = this.o.board.t.worker.preparingWorkstation;
    const path = this.o.board.row(cardId).workstation;
    const settle = (then: () => void, always = false) => {
      if (this.preparing.get(cardId)?.done === waited) this.preparing.delete(cardId);
      
      if (this.shut) return;
      
      if (this.o.board.row(cardId).status_line === line) this.o.board.work(cardId, { status_line: null });
      else this.o.board.changed();
      
      this.settleLater();
      if (!this.o.board.item(cardId) || !(always || this.generation.get(cardId) === generation)) return;
      try {
        then();
      } catch (e) {
        console.error(`starting the worker of ${cardId}:`, e);
        this.o.board.log(cardId, 'error', 'seismic', messageOf(e));
      }
    };
    const done: Promise<void> = ready.then(
      (at) => {
        
        
        if (at !== path && !this.shut && this.o.board.row(cardId).workstation === path) this.o.board.work(cardId, { workstation: at });
        settle(go);
      },
      (e: unknown) => {
        const short = queues && e instanceof WorkstationError && !!shortageOf(e.code);
        let undone = false;
        settle(() => {
          if (this.o.board.row(cardId).workstation !== path) return;
          undo();
          undone = true;
          if (!short) this.o.board.log(cardId, 'error', 'seismic', this.o.board.t.worker.workstationFailed(messageOf(e)));
        }, true);
        if (short && undone) throw new BadRequest((e as WorkstationError).code, messageOf(e));
      },
    );
    const waited = done.catch(() => {});
    this.preparing.set(cardId, { host: hostName(path), done: waited });
    this.o.board.work(cardId, { status_line: line });
    return done;
  }

  /**
   * Puts the review card's workstation on the head of its pull request (`refs/pull/<n>/head`, which
   * GitHub and Forgejo both have), fetched from the repository's `origin` where that is the PR's
   * repository, else from the PR's repository on its forge; then `then` runs, with what went wrong
   * where git could not, unless the card was stopped or started anew meanwhile.
   */
  private onPrHead(cardId: string, branch: string, c: StoredContribution, then: (problem: string | null) => void) {
    const generation = this.generation.get(cardId);
    const ws = this.o.board.row(cardId).workstation;
    const source = this.prSource(c);
    
    const still = () => !this.shut && this.generation.get(cardId) === generation && this.o.board.row(cardId).workstation === ws;
    const fetched = ws
      ? gitAsync(ws, 'fetch', '--quiet', source, `refs/pull/${c.number}/head`).then(() => (still() ? gitAsync(ws, 'checkout', '--quiet', '-B', branch, 'FETCH_HEAD') : ''))
      : Promise.reject(new Error('the card has no workstation'));
    void fetched.then(
      () => null,
      (e: unknown) => messageOf(e),
    ).then((problem) => {
      if (this.shut || !this.o.board.item(cardId) || this.generation.get(cardId) !== generation) return;
      if (problem) this.o.board.log(cardId, 'error', 'seismic', problem);
      then(problem);
    });
  }

  /** Where a review card's PR head is fetched from: `origin` where it is the PR's repository, else that repository on its forge; without `origin`, the checkout. */
  prSource(c: StoredContribution): string {
    const ref = parsePrUrl(c.url);
    if (!ref) return c.url;
    const remote = this.o.remote?.trim();
    if (remote && sameRepo(remote, ref.owner, ref.repo)) return remote;
    
    if (!remote && this.o.repoPath) return this.o.repoPath;
    return `${ref.base}/${ref.owner}/${ref.repo}.git`;
  }

  /** The CLAUDE.md of the repository's default branch, as the checkout has it; empty where it has none. */
  private mainNotes(): string {
    if (!this.o.repoPath) return '';
    const { commit } = defaultBranchCommit(this.o.repoPath);
    return (commit && gitOrNull(this.o.repoPath, 'show', `${commit}:CLAUDE.md`)?.trim()) || '';
  }

  /** Where a review card's forge calls run: its workstation on this machine, else the repository's checkout. */
  private forgeCwd(cardId: string): string {
    const ws = this.o.board.row(cardId).workstation;
    return ws && !hostName(ws) ? ws : (this.o.repoPath ?? process.cwd());
  }

  /**
   * What the owner decided for findings of a review card (by number: to the contributor, the
   * worker's own change, or a follow-up task), as the worker reads it above their words. Each is
   * marked as decided until the worker records what came of it; a follow-up task the worker makes
   * itself (`followUpTask`), bundling the findings as the owner's words say, else as it bundled them.
   * Refuses a finding that is not open, and the worker's own change where the contributor allows no
   * maintainers' edits.
   */
  private decide(cardId: string, decisions: Record<number, ChangeRoute>, notes?: Record<number, string>): { note: string; log: string } {
    const c = contributionOf(this.o.board.row(cardId));
    
    if (!c) return this.reviews.decide(cardId, decisions, notes);
    const t = this.o.board.t.worker;
    const picked = Object.entries(decisions).map(([id, route]) => {
      const f = c.findings?.find((x) => x.id === Number(id) && x.status === 'open' && !x.decided);
      if (!f) throw new BadRequest('noFinding', `finding ${id} is not open`);
      if (route === 'self' && !c.canModify) throw new BadRequest('noEdits', 'the contributor does not allow maintainers to push to the pull request');
      return { f, route };
    });
    const of = (route: ChangeRoute) => picked.filter((p) => p.route === route);
    
    const changing = of('self').length > 0;
    const withChanges = changing || !!c.changing || !!c.held;
    const findings = c.findings!.map((f): Finding => {
      const p = picked.find((x) => x.f.id === f.id);
      return p ? { ...f, decided: p.route, ...(p.route === 'contributor' && withChanges ? { withChanges: true as const } : {}) } : f;
    });
    this.o.board.work(cardId, { review: { contribution: { ...c, findings, ...(changing ? { changing: true as const } : {}) } satisfies StoredContribution } });
    const name = (f: Finding) => `#${f.id} “${f.title}”`;
    const what = (p: (typeof picked)[number]) => (p.route === 'self' ? t.findingSelf : p.route === 'later' ? t.findingLater : t.findingTo(c.author));
    const later = of('later');
    const ids = new Set(later.map((p) => p.f.id));
    
    const bundles = [
      ...new Set(
        later
          .map((p) => [p.f.id, ...(p.f.with ?? []).filter((x) => ids.has(x))].sort((a, b) => a - b))
          .filter((b) => b.length > 1)
          .map((b) => b.join(' + ')),
      ),
    ];
    return {
      note: [
        'The owner decided on findings of your review, on the card; do it now:',
        of('contributor').length
          ? withChanges
            ? `- To ${c.author}: ${of('contributor').map((p) => name(p.f)).join(', ')}. ${changing ? 'They go with your own changes below' : 'Your own changes wait for the owner’s approval, and these go with them'}, as one message: write the request into the same pr_draft as what you changed, and do not send it now. Seismic posts it as one review asking for changes once the owner approves.${changing ? '' : ' Hand over again with that pr_draft; the demo on the card stands.'}`
            : `- To ${c.author}: ${of('contributor').map((p) => name(p.f)).join(', ')}. Write them as one review asking for changes (request_changes, with their numbers).`
          : '',
        changing
          ? `- Yourself: ${of('self').map((p) => name(p.f)).join(', ')}. Make the change and commit it on your branch, mark them fixed (findings), and hand over again with a new demo and pr_draft. Seismic pushes your commits onto the PR's branch and posts pr_draft once the owner approves.`
          : '',
        later.length
          ? `- As follow-up tasks: ${later.map((p) => name(p.f)).join(', ')}. Make them tasks of their own with follow_up_task, outside this PR, before anything else ends your turn. Findings that belong together become one task: as the owner's words below say first (“2 and 3 together”, “combine them as you see fit”, “all separate”); without a word on it, ${bundles.length ? `as you bundled them (${bundles.map((b) => `findings ${b}`).join('; ')}), the others one each` : 'one task each'}. Write each task from what your review knows (the files concerned, the cause, the PR's link). They go neither to ${c.author} nor into your changes.`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      log: picked.map((p) => t.findingDecided(p.f.id, p.f.title, what(p))).join('\n'),
    };
  }

  /**
   * Findings the owner ignores, a review card's or its code review's: dropped at once, in the card's
   * log, without a word to the worker. Refuses a finding that is not open.
   */
  private ignore(cardId: string, ids: number[]): void {
    const c = contributionOf(this.o.board.row(cardId));
    const t = this.o.board.t.worker;
    if (!c) {
      const closed = this.reviews.ignore(cardId, ids);
      this.o.board.log(cardId, 'state', 'owner', closed.map((f) => t.findingDecided(f.number, f.title, t.findingIgnored)).join('\n'));
      return;
    }
    const all = c.findings;
    const named = ids.map((id) => all?.find((f) => f.id === id && f.status === 'open' && !f.decided));
    const missing = ids.filter((_, i) => !named[i]);
    if (missing.length) throw new BadRequest('noFinding', `finding ${missing.join(', ')} is not open`);
    const findings = all!.map((f): Finding => (ids.includes(f.id) ? { ...f, status: 'dropped' } : f));
    this.o.board.work(cardId, { review: { contribution: { ...c, findings } satisfies StoredContribution } });
    this.o.board.log(cardId, 'state', 'owner', named.map((f) => t.findingDecided(f!.id, f!.title, t.findingIgnored)).join('\n'));
  }

  /**
   * A follow-up task the worker of a review card makes of findings, on the owner's word: beside the
   * card, following up on it, with the worker's text and the PR's link, and started at once, waiting
   * in the queue for the PR's merge. The findings are settled for the PR and link it; several may
   * link one task.
   */
  followUpTask(cardId: string, title: string, task: string, ids: number[]): string {
    const c = contributionOf(this.o.board.row(cardId));
    
    const code = c ? undefined : this.reviews.items(cardId);
    const known = c ? c.findings?.map((f) => ({ id: f.id, state: f.status, settled: f.status !== 'open', card: f.card })) : code?.map((i) => ({ id: i.number, state: i.status, settled: !(i.status === 'followUp' && !i.card), card: i.card }));
    if (!known?.length) return `Not made: your work has no code review with ${c ? 'findings' : 'items'}.`;
    if (!title) return 'Not made: the title is missing.';
    if (!task) return 'Not made: the task is missing.';
    const named = [...new Set(ids)];
    const noun = c ? 'finding' : 'item';
    if (!named.length) return `Not made: name the ${noun}s it is made of (findings, their numbers).`;
    const missing = named.filter((id) => !known.some((f) => f.id === id));
    if (missing.length) return `Not made: there is no ${noun} ${missing.join(', ')}.`;
    const settled = named.map((id) => known.find((f) => f.id === id)!).filter((f) => f.settled);
    if (settled.length) return `Not made: ${settled.map((f) => `${noun} ${f.id} is ${f.state}${f.card ? ' (a follow-up task already)' : ''}`).join('; ')}.`;
    const t = this.o.board.t.worker;
    const body = clip(task, 19000);
    const of = this.o.board.item(cardId)?.title ?? '';
    const card = this.o.board.create({ title: clip(title, 200), body: c ? (body.includes(c.url) ? body : `${body}\n\n${t.findingTask(c.number, c.url)}`) : `${body}\n\n${t.findingTaskOf(of)}`, from: cardId }, undefined, 'owner');
    this.o.board.log(card.id, 'state', 'seismic', c ? t.findingTaskMade(c.number) : t.findingTaskMadeOf(of));
    this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.voice.madeFollowUp(card.title), { made: { card: card.id, title: card.title } });
    if (c) {
      const findings = c.findings!.map((f): Finding => {
        if (!named.includes(f.id)) return f;
        const { decided: _, ...rest } = f;
        return { ...rest, status: 'later', card: card.id };
      });
      this.o.board.work(cardId, { review: { contribution: { ...c, findings } satisfies StoredContribution } });
    } else this.reviews.linkTask(cardId, named, card.id, card.title);
    this.o.onFollowUpTask?.(card.id, cardId);
    const owed = this.owedTasks(cardId);
    return `Made: “${card.title}”, beside your card and queued behind it until ${c ? 'the PR is merged' : 'your work has landed'}, linked from ${named.length === 1 ? `${noun} ${named[0]}` : `${noun}s ${named.join(', ')}`}.${owed ? ` Still to make: ${owed}.` : ''}`;
  }

  /** The findings the owner chose as follow-up tasks that have none yet (a review card's, or its code review's), as the worker reads them; none: undefined. */
  owedTasks(cardId: string): string | undefined {
    const row = this.o.board.row(cardId);
    const c = contributionOf(row);
    const owed = c ? (c.findings ?? []).filter((f) => f.status === 'open' && f.decided === 'later').map((f) => ({ id: f.id, title: f.title })) : this.reviews.owed(cardId).map((i) => ({ id: i.number, title: i.title }));
    return owed.length ? `${owed.length === 1 ? (c ? 'finding' : 'item') : c ? 'findings' : 'items'} ${owed.map((f) => `#${f.id} “${f.title}”`).join(', ')} (follow_up_task)` : undefined;
  }

  /** The worker resubmits items of the code review of its work, with notes: they go under review. */
  resubmitItems(cardId: string, entries: { number: number; note?: string }[]): string {
    if (!this.reviews.items(cardId).length) return 'Not resubmitted: your work has no code review items.';
    if (!entries.length) return 'Not resubmitted: name the items (items, their numbers).';
    const note = (e: { note?: string }) => (e.note?.trim() ? clip(e.note.trim(), 1000) : undefined);
    const { done, noted, refused } = this.reviews.resubmit(cardId, entries.map((e) => ({ number: Number(e.number), ...(note(e) ? { note: note(e)! } : {}) })));
    return `${done.length ? `Resubmitted: ${done.map((i) => `#${i.number}`).join(', ')}, under review now.` : noted.length ? '' : 'Nothing resubmitted.'}${noted.length ? ` Note added to ${noted.map((i) => `#${i.number}`).join(', ')}, under review already.` : ''}${refused.length ? ` Not resubmitted: ${refused.join('; ')}.` : ''}`.trim();
  }

  /** The worker disputes items it is fixing: back to the owner, reopened. */
  disputeItems(cardId: string, entries: { number: number; note: string }[]): string {
    if (!this.reviews.items(cardId).length) return 'Not disputed: your work has no code review items.';
    if (entries.some((e) => !e.note?.trim())) return 'Not disputed: every item needs your reasons (note).';
    const { done, refused } = this.reviews.dispute(cardId, entries.map((e) => ({ number: Number(e.number), note: clip(e.note.trim(), 1000) })));
    return `${done.length ? `Disputed: ${done.map((i) => `#${i.number}`).join(', ')}, back with the owner as reopened.` : 'Nothing disputed.'}${refused.length ? ` Not disputed: ${refused.join('; ')}.` : ''}`;
  }

  /**
   * A review card's findings as its worker writes them: the whole list as it stands, each kept by its
   * number (a new one gets the next), with what the owner decided while it stays open. `with` names
   * the findings it would make one follow-up task with, kept in both directions and across a chain.
   */
  setFindings(cardId: string, given: { id?: number; title: string; text: string; security?: boolean; severity?: Severity; file?: string; line?: number; status?: FindingStatus; url?: string; with?: number[] }[]): string {
    const c = contributionOf(this.o.board.row(cardId));
    if (!c) return 'Not recorded: this card reviews no pull request.';
    const had = c.findings ?? [];
    let next = Math.max(0, ...had.map((f) => f.id)) + 1;
    const seen = new Set<number>();
    const findings: Finding[] = [];
    const named: [number, number[]][] = [];
    for (const g of given.slice(0, 30)) {
      const id = g.id !== undefined && !seen.has(g.id) ? g.id : next++;
      if (id >= next) next = id + 1;
      seen.add(id);
      const before = had.find((f) => f.id === id);
      
      const status = before?.status === 'later' || before?.status === 'dropped' ? before.status : g.status === 'later' ? (before?.status ?? 'open') : (g.status ?? before?.status ?? 'open');
      const url = g.url ?? (status === before?.status ? before?.url : undefined);
      if (g.with?.length) named.push([id, g.with]);
      findings.push({
        id,
        title: clip(String(g.title).trim(), 120),
        text: clip(String(g.text).trim(), 2000),
        ...(g.security ? { security: true } : {}),
        ...(g.severity && SEVERITIES.includes(g.severity) ? { severity: g.severity } : {}),
        ...(g.file?.trim() ? { file: clip(g.file.trim(), 300), ...(g.line ? { line: g.line } : {}) } : {}),
        status,
        ...(url ? { url } : {}),
        ...(status === 'later' && before?.card ? { card: before.card } : {}),
        ...(status === 'open' && before?.decided ? { decided: before.decided, ...(before.withChanges ? { withChanges: true as const } : {}) } : {}),
      });
    }
    
    const root = new Map(findings.map((f) => [f.id, f.id]));
    const find = (id: number): number => (root.get(id) === id ? id : find(root.get(id)!));
    for (const [id, others] of named) for (const o of others) if (root.has(o)) root.set(find(o), find(id));
    for (const f of findings) {
      const w = findings.filter((o) => o.id !== f.id && find(o.id) === find(f.id)).map((o) => o.id);
      if (w.length) f.with = w;
    }
    this.o.board.work(cardId, { review: { contribution: { ...c, findings } satisfies StoredContribution } });
    
    const ignored = findings.filter((f) => f.status === 'dropped' && had.some((h) => h.id === f.id && h.status === 'dropped'));
    const fresh = findings.filter((f) => !had.some((h) => h.id === f.id));
    const recorded = `Recorded: ${findings.length === 1 ? '1 finding' : `${findings.length} findings`}.`;
    return ignored.length && fresh.length
      ? `${recorded} The owner ignored ${ignored.map((f) => `#${f.id} “${f.title}”`).join(', ')}: they stay as they are. If a new finding of yours raises one of them again, leave it out and record the list again.`
      : recorded;
  }

  





  /** Route review decisions to a fresh session in the same workstation. */
  reviewWithNewAgent(cardId: string, picks: Record<number, FindingPick> | undefined, setting: AgentSetting, notes?: Record<number, string>) {
    const card = this.card(cardId);
    const live = this.live.get(cardId);
    if (!handedOver(card) || !card.review?.codeReview || !this.o.board.row(cardId).workstation)
      throw new BadRequest('notReady', 'a code review and its workstation are required');
    if (live?.busy || live?.background) throw new BadRequest('notReady', 'the current agent is still working');
    const entries = Object.entries(picks ?? {});
    if (!entries.length) throw new BadRequest('noFinding', 'choose findings first');
    const ignored = entries.filter(([, p]) => p === 'ignore').map(([id]) => Number(id));
    const routed = Object.fromEntries(entries.filter(([, p]) => p !== 'ignore')) as Record<number, ChangeRoute>;
    
    for (const [id, route] of entries) {
      if (!card.review.codeReview.items.some((i) => i.number === Number(id) && needsOwner(i)) || route === 'contributor')
        throw new BadRequest('noFinding', `item ${id} does not wait for you`);
    }
    
    if (ignored.length) this.ignore(cardId, ignored);
    const decided = Object.keys(routed).length ? withNotes(this.reviews.decide(cardId, routed, notes), routed, notes) : undefined;
    if (!decided) return;
    this.o.board.record(cardId, 'reviewSent', 'owner');
    this.end(cardId);
    this.takingIn(cardId);
    this.o.board.log(cardId, 'hint', 'owner', decided.log);
    this.o.board.work(cardId, { session_id: null, agent_setting: JSON.stringify(setting) });
    this.launch(cardId, decided.note, undefined, [], true);
  }

  message(cardId: string, text: string, images: string[] = [], spoken = false, replyTo?: number, spot?: SpotInput, picks?: Record<number, FindingPick>, notes?: Record<number, string>) {
    const card = this.card(cardId);
    
    const ignored = Object.entries(picks ?? {}).filter(([, p]) => p === 'ignore').map(([id]) => Number(id));
    const routed = Object.entries(picks ?? {}).filter((e): e is [string, ChangeRoute] => e[1] !== 'ignore');
    const findings = routed.length ? (Object.fromEntries(routed) as Record<number, ChangeRoute>) : undefined;
    if (ignored.length) this.ignore(cardId, ignored);
    if (ignored.length && !findings && !text && !images.length) return;
    const place = spot ? this.place(cardId, spot) : undefined;
    const handover = handedOver(card);
    if (place && handover && !findings) return this.hold(card, text, images, spoken, replyTo, place);
    
    const decided = findings ? withNotes(this.decide(cardId, findings, notes), findings, notes) : undefined;
    if (decided) this.o.board.record(cardId, 'reviewSent', 'owner');
    const words = `${decided ? `${decided.note}\n\n` : ''}${this.words(cardId, text, images, replyTo, place)}`;
    
    const shots = images;
    const said = [decided?.log, text].filter(Boolean).join('\n\n');
    
    const log = (later = false) => [this.o.board.log(cardId, 'hint', 'owner', said, { images: shots, replyTo, spot: place, unread: later && this.takesLater(cardId) }).id];
    
    images = [...this.stills(place), ...images];
    if (handover) {
      
      if (card.question) return this.answerDemo(card, decided ? `${decided.note}\n\n${text}` : text, images, spoken, replyTo, []);
      
      this.takingIn(cardId);
      
      const held = this.takeHeld(cardId);
      const said = log(!held);
      if (text) this.o.onOwnerInput?.(card, 'feedback', text);
      this.deliver(
        cardId,
        `The owner wrote on your handover${spoken ? ` (${SPOKEN})` : ''}. The card still waits for their approval of what you handed over; a change their words call for goes into a new handover:\n\n${held ? `${held.text}\n\nThen they wrote:\n\n` : ''}${words}`,
        [...(held?.images ?? []), ...images],
        true,
        held ? [] : said,
      );
    } else if (card.state === 'waiting' && card.need === 'question') {
      
      const waiting = this.live.get(cardId)?.permission;
      this.backToWork(cardId);
      if (waiting) {
        
        log();
        if (text) this.o.onOwnerInput?.(card, 'note', text);
        waiting({ allow: false, message: `Not run: the owner wrote a note instead of allowing it${spoken ? ` (${SPOKEN})` : ''}. If the note settles it, go on; if not, ask again.\n\n${words}` });
        if (images.length) this.live.get(cardId)!.session.send('The screenshots of the owner’s note.', images);
        return;
      }
      const said = log(true);
      if (text) this.o.onOwnerInput?.(card, 'note', text);
      this.deliver(
        cardId,
        `A note from the owner instead of an answer${spoken ? ` (${SPOKEN})` : ''}. It withdraws your question (“${card.question?.text ?? ''}”): if the note settles it, go on; if not, ask again.\n\n${words}`,
        images,
        true,
        said,
      );
    } else if (holdsNotes(card)) {
      
      const said = [this.o.board.log(cardId, 'hint', 'owner', text, { images: shots, replyTo, spot: place, unread: true }).id];
      if (text) this.o.onOwnerInput?.(card, 'note', text);
      this.o.board.work(cardId, { unheard: JSON.stringify([...this.unheard(cardId), { said, text: `A note the owner left on the card while no agent worked on it${spoken ? ` (${SPOKEN})` : ''}:\n\n${words}`, images }] satisfies Unheard[]) });
    } else if (this.waitsForClone(cardId)) {
      
      const said = [this.o.board.log(cardId, 'hint', 'owner', text, { images: shots, replyTo, spot: place, unread: true }).id];
      if (text) this.o.onOwnerInput?.(card, 'note', text);
      this.o.board.work(cardId, { unheard: JSON.stringify([...this.unheard(cardId), { said, text: `A note from the owner while you waited for the clone${spoken ? ` (${SPOKEN})` : ''}:\n\n${words}`, images }] satisfies Unheard[]) });
    } else if (card.state === 'working' || card.state === 'inPr' || card.agent?.finishing) {
      const said = log(true);
      if (text) this.o.onOwnerInput?.(card, 'note', text);
      
      const how = this.heldFor(cardId) ? 'with which they let you go on' : 'it does not stop you; adjust your plan if it changes anything';
      this.deliver(cardId, `A note from the owner${spoken ? ` (${SPOKEN})` : ''} (${how}):\n\n${words}`, images, true, said);
    } else if (askable(card)) this.followUp(card, text, images, spoken, replyTo, place);
    else throw new BadRequest('noAgent', 'no agent works on this card');
  }

  /**
   * The owner asks about a card whose work is over: its worker's session is resumed in a fresh
   * workstation on the card's branch, as after a landing, and ends again once the worker has answered.
   */
  private followUp(card: Item, text: string, images: string[], spoken: boolean, replyTo?: number, place?: Spot) {
    const row = this.o.board.row(card.id);
    const commit = row.shipped ? (JSON.parse(row.shipped) as Shipped).commit : undefined;
    const stills = this.stills(place);
    this.resumeFinished(
      card,
      {},
      (path, worktree) =>
        [
          this.folder
            ? `The owner asks about this card${spoken ? ` (${SPOKEN})` : ''}. It is done, and your session had ended; it goes on in the folder ${path}, which other cards and the owner may have changed since.`
            : `The owner asks about this card${spoken ? ` (${SPOKEN})` : ''}. ${card.state === 'done' ? 'It was closed without a change to the repository' : `Its work is on main${commit ? ` (${commit.slice(0, 7)})` : ''}`}, and your session had ended; it goes on in a fresh workstation ${worktree ? 'at the head of' : 'on'} the branch ${row.branch}, where main may have moved on since.`,
          this.words(card.id, text, images.slice(stills.length), replyTo, place),
          this.folder ? FOLLOW_UP_FOLDER : FOLLOW_UP,
          ...(worktree ? [IN_WORKTREE] : []),
        ].join('\n\n'),
      images,
      () => {
        this.o.board.log(card.id, 'hint', 'owner', text, { images: images.slice(stills.length), replyTo, spot: place });
        if (text) this.o.onOwnerInput?.(card, 'note', text);
      },
    );
  }

  /**
   * Resumes the session of a card whose work is over in a fresh workstation on its branch, a temporary
   * worktree where no clone is free (the worker hears `message` for it), `extra` in its landed state
   * (`followUp`). `before` runs once the workstation is taken, before the worker hears anything.
   * Throws where the card can have no workstation.
   */
  private resumeFinished(card: Item, extra: LandedState, message: (path: string, worktree: boolean) => string, images: string[] = [], before?: () => void, failed?: () => void) {
    const row = this.o.board.row(card.id);
    let lease: Lease;
    let worktree = false;
    try {
      
      lease = this.o.workstations.lease(card.id, row.branch!, { overSlots: true });
    } catch (e) {
      if (!(e instanceof WorkstationError)) throw e;
      if (!shortageOf(e.code)) throw new BadRequest(e.code, e.message);
      
      lease = asBadRequest(() => this.o.workstations.followUpTree(card.id, row.branch!));
      worktree = true;
    }
    const { path, ready } = lease;
    this.bump(card.id);
    const commit = row.shipped ? (JSON.parse(row.shipped) as Shipped).commit : undefined;
    const landed: LandedState = { ...(card.state === 'done' ? { unchanged: true } : commit ? { commit } : {}), followUp: true, ...(worktree ? { worktree } : {}), ...extra };
    this.o.board.work(card.id, { workstation: path, landed: JSON.stringify(landed), status_line: null, app: null });
    before?.();
    const text = message(path, worktree);
    void this.whenReady(
      card.id,
      ready,
      () => {
        
        if (row.session_id) this.launch(card.id, text, row.session_id, images);
        else this.launch(card.id, `You worked on the card “${card.title}”:\n\n${card.body}\n\n${text}`, undefined, [...this.taskImages(card), ...images]);
      },
      
      () => {
        this.o.workstations.release(card.id);
        this.o.board.work(card.id, { workstation: null, landed: row.landed });
        failed?.();
      },
    );
  }

  /** Whether the card's follow-up waits for a full clone, its worker without a workstation. */
  private waitsForClone(cardId: string): boolean {
    const row = this.o.board.row(cardId);
    return !row.workstation && !!workerConfig.landedOf(row)?.needsClone;
  }

  /**
   * The follow-up's worker asked for a full clone (`need_clone`) and ended its turn: its session and
   * temporary worktree end, and the card waits for the next free clone, which resumes the session.
   */
  private awaitClone(cardId: string) {
    this.end(cardId);
    this.bump(cardId);
    const row = this.o.board.row(cardId);
    const { worktree: _, ...landed } = workerConfig.landedOf(row)!;
    this.removeTree(row.workstation);
    this.o.board.work(cardId, { workstation: null, landed: JSON.stringify(landed), status_line: this.o.board.t.worker.waitsForWorkstation });
    this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.worker.waitsForClone);
    this.takeClone(cardId);
  }

  /**
   * A follow-up waiting for a full clone takes the next clean free one, on any machine whatever its
   * slots, and its worker goes on there. Returns whether it did; the Koordinator asks again as the board changes.
   */
  takeClone(cardId: string): boolean {
    if (!this.waitsForClone(cardId)) return false;
    const row = this.o.board.row(cardId);
    let lease: Lease;
    try {
      lease = this.o.workstations.lease(cardId, row.branch!, { overSlots: true });
    } catch (e) {
      if (!(e instanceof WorkstationError && shortageOf(e.code))) console.error(`a clone for the follow-up on ${cardId}:`, e);
      return false;
    }
    const { needsClone: _, ...landed } = workerConfig.landedOf(row)!;
    this.bump(cardId);
    this.o.board.work(cardId, { workstation: lease.path, landed: JSON.stringify(landed), status_line: null, app: null });
    this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.worker.cloneFree);
    void this.whenReady(
      cardId,
      lease.ready,
      () => this.deliver(cardId, `A clone is free now: you go on in it, a full clone on the branch ${row.branch}. Answer the owner's question there.\n\n${FOLLOW_UP}`),
      
      () => this.o.board.work(cardId, { workstation: null, landed: row.landed, status_line: this.o.board.t.worker.waitsForWorkstation }),
    );
    return true;
  }

  /** Whether the card's follow-up runs in a temporary worktree. */
  inWorktree(cardId: string): boolean {
    return !!workerConfig.landedOf(this.o.board.row(cardId))?.worktree;
  }

  /** Removes a follow-up's temporary worktree; one left behind does no harm. */
  private removeTree(path: string | null) {
    if (!path) return;
    this.o.workstations.removeFollowUpTree(path).catch((e: unknown) => console.error(`removing the follow-up worktree ${path}:`, e));
  }

  /**
   * The owner answered the card's question: `words` are their own, `picks` the options they picked
   * and the answer they wrote in place of one (`givenAnswers`). The log holds both as one text,
   * picks first (`pickedAnswer`); the worker reads which is which.
   */
  answer(cardId: string, words: string, images: string[] = [], spoken = false, replyTo?: number, picks: string[] = [], spot?: SpotInput) {
    const card = this.card(cardId);
    const options = card.question?.options ?? [];
    const picked = givenAnswers(options, picks);
    const text = pickedAnswer(picked, words);
    if (card.state === 'waiting' && card.need === 'demo' && card.question) return this.answerDemo(card, text, images, spoken, replyTo, picked);
    if (!(card.state === 'waiting' && card.need === 'question')) throw new BadRequest('noQuestion', 'the card has no open question');
    const row = this.o.board.row(cardId);
    const detail = row.detail ? (JSON.parse(row.detail) as { question?: Question; permission?: AskedPermission }) : {};
    if (detail.permission) return this.answerPermission(card, detail.permission, text, images, spoken, replyTo);
    const question = detail.question;
    const q = question?.text ?? this.pendingQuestion(cardId) ?? '';
    
    const place = spot ? this.place(cardId, spot) : undefined;
    this.backToWork(cardId);
    this.recordAnswer(card, q, text, images, replyTo, picked, place);
    this.deliver(cardId, `Answer to your question (from the owner${spoken ? `; ${SPOKEN}` : ''}):\n\n${this.words(cardId, answerNote(picked, text, options), images, replyTo, place)}`, [...this.stills(place), ...images], true);
  }

  /**
   * The owner answered whether a tool call may run: the call waiting for it runs or is refused, with
   * their words. Allowed after the session that asked was gone (a restart), it runs once the worker
   * makes it again. No decision for the log: it is about one call, not the work.
   */
  private answerPermission(card: Item, asked: AskedPermission, text: string, images: string[], spoken: boolean, replyTo?: number) {
    const [first = '', ...rest] = text.split('\n\n');
    const is = (option: (t: Messages) => string) => LANGUAGES.some((l) => option(MESSAGES[l]).toLowerCase() === first.trim().toLowerCase());
    const extra = asked.extra?.find((o) => LANGUAGES.some((l) => o.label[l]?.toLowerCase() === first.trim().toLowerCase()));
    const allowed = !!extra || is((t) => t.worker.allow);
    const words = (allowed || is((t) => t.worker.deny) ? rest.join('\n\n') : text).trim();
    this.backToWork(card.id);
    this.o.board.log(card.id, 'answer', 'owner', text, { images, replyTo });
    const permissions = extra ? this.permissionPicked(card.id, extra) : undefined;
    if (words) this.o.onOwnerInput?.(card, 'answer', words, { question: card.question?.text ?? '' });
    const said = words ? `${spoken ? ` (${SPOKEN})` : ''}:\n\n${this.words(card.id, words, images, replyTo)}` : images.length ? `, with screenshots:${imageNote(images)}` : '.';
    const live = this.live.get(card.id);
    if (live?.permission) {
      live.permission(allowed ? { allow: true, ...(permissions?.length ? { permissions } : {}) } : { allow: false, message: `Not run: the owner did not allow it${said}` });
      
      if (allowed && (words || images.length)) live.session.send(`The owner allowed it${said}`, images);
      else if (images.length) live.session.send('The screenshots of the owner’s answer.', images);
      return;
    }
    
    if (allowed) this.granted.set(card.id, (this.granted.get(card.id) ?? new Set()).add(permissionKey(asked)));
    const call = describeTool(asked.name, asked.input, this.o.board.t);
    this.deliver(
      card.id,
      allowed
        ? `Before Seismic restarted, a tool call of yours (${call}) waited for the owner's permission. The owner allowed it${said}\n\nMake the call again if you still need it; it runs without asking again.`
        : `Before Seismic restarted, a tool call of yours (${call}) waited for the owner's permission. The owner did not allow it${said}`,
      images,
      true,
    );
  }

  /**
   * The question in a demo report, answered: the worker hears it, and the demo still waits for
   * approval. While the worker takes in the answer (it may rework the demo), the card is not the
   * owner's; once its turn ends without a new handover, the demo is theirs again.
   */
  private answerDemo(card: Item, text: string, images: string[], spoken: boolean, replyTo: number | undefined, picks: string[]) {
    const q = card.question!.text;
    const held = this.takeHeld(card.id);
    const demo = this.o.board.row(card.id).demo!.latest!;
    this.o.board.work(card.id, { demo: { latest: { ...demo, answer: text || '(Screenshot)', ...(picks.length ? { picks } : {}) } } });
    this.takingIn(card.id);
    this.recordAnswer(card, q, text, images, replyTo, picks);
    this.deliver(
      card.id,
      `The owner answered the question in your demo report (“${q}”)${spoken ? ` (${SPOKEN})` : ''}. The card still waits for their approval of what you handed over; a change their words call for goes into a new handover:\n\n${held ? `${held.text}\n\nThen they answered:\n\n` : ''}${this.words(card.id, answerNote(picks, text, card.question!.options ?? []), images, replyTo)}`,
      [...(held?.images ?? []), ...images],
      true,
    );
  }

  /**
   * The owner's words as the worker reads them: the place in the demo video and the message they
   * reply to above them, the frame's and the screenshots' files below.
   */
  private words(cardId: string, text: string, images: string[], replyTo?: number, place?: Spot) {
    const still = this.stills(place);
    return `${place ? `${spotNote(place)}\n` : ''}${replyNote(replyTo ? this.o.board.quoted(cardId, replyTo) : undefined, 'worker')}${text}${still.length ? `\n\nThe frame at that place in the video is shown below (file: ${still[0]}).` : ''}${imageNote(images)}`;
  }

  /**
   * A place in the card's demo video, with the chapter there and what the narration says: in the
   * card's demo, or in an earlier one the owner went back to (`spot.demo`).
   */
  private place(cardId: string, spot: SpotInput): Spot {
    const at = Math.max(0, Math.round(spot.at * 10) / 10);
    const row = this.o.board.row(cardId);
    const current = row.demo?.latest;
    const earlier = spot.demo !== undefined && spot.demo !== current?.handover ? (row.demo?.earlier ?? []).findLast((d) => d.handover === spot.demo) : undefined;
    const d = earlier ?? current;
    return {
      at,
      ...(d && d.kind !== 'html' ? placeIn(d.dir, d.chapters, at) : {}),
      ...(spot.still ? { still: spot.still } : {}),
      ...(d?.handover !== undefined ? { demo: d.handover } : {}),
      ...(earlier ? { earlier: true as const } : {}),
    };
  }

  /**
   * The card's earlier demos with the one a new handover replaces added, as `CardRow.demo` keeps
   * them. A demo from before handovers named theirs gets the last one before now: its time, and the
   * places in it the owner's comments are about.
   */
  earlier(cardId: string, row: CardRow): StoredDemo[] {
    const replaced = row.demo!.latest!;
    const e = replaced.handover === undefined ? this.o.board.events(cardId).findLast((e) => e.kind === 'review') : undefined;
    return [...row.demo!.earlier, { ...replaced, ...(e ? { handover: e.id, at: e.at } : {}) }];
  }

  /** The file of the frame at a place in the video, if it has one. */
  private stills(place: Spot | undefined): string[] {
    return place?.still ? (this.o.imageFiles?.([place.still]) ?? []) : [];
  }

  /**
   * Words on a place in the demo video, while the card waits for the owner's approval: they stand in
   * the conversation at once, but reach the worker together once the owner has finished watching
   * (`release`, words without a place, an approval), so that it reworks the demo once rather than
   * for each comment. Ten minutes after the last one without a sign, they go anyway.
   */
  private hold(card: Item, text: string, images: string[], spoken: boolean, replyTo: number | undefined, place: Spot) {
    
    const e = this.o.board.log(card.id, 'hint', 'owner', text, { images, replyTo, spot: place, unread: true });
    if (text) this.o.onOwnerInput?.(card, 'feedback', text);
    this.o.board.work(card.id, { demo: { held: [...this.held(card.id), { id: e.id, ...(spoken ? { spoken: true } : {}) }] } });
    this.releaseLater(card.id, this.o.holdGrace ?? HOLD_GRACE);
  }

  private held(cardId: string): HeldComment[] {
    return this.o.board.row(cardId).demo?.held ?? [];
  }

  private releaseLater(cardId: string, ms: number) {
    clearTimeout(this.holding.get(cardId));
    this.holding.set(
      cardId,
      setTimeout(() => {
        this.holding.delete(cardId);
        
        try {
          this.release(cardId);
        } catch (e) {
          if (this.o.board.item(cardId)) this.o.board.log(cardId, 'error', 'seismic', messageOf(e));
        }
      }, ms),
    );
  }

  /**
   * The owner has finished watching the demo video (it ended, the card closed, it stood still for a
   * while): the comments held back go to the worker, after a moment in which an approval clicked
   * with the closing takes them instead.
   */
  released(cardId: string, now = false) {
    this.card(cardId);
    if (!this.held(cardId).length) return;
    
    if (now) this.release(cardId);
    else this.releaseLater(cardId, this.o.releaseDelay ?? RELEASE_DELAY);
  }

  /**
   * The owner takes back words the worker has not taken in: a comment on a place in the demo video
   * that is still held back, or words Seismic holds until its next step. They leave the conversation,
   * and the worker never hears them.
   */
  unsay(cardId: string, id: number) {
    this.card(cardId);
    const unheard = this.unheard(cardId);
    const words = unheard.find((u) => u.said.includes(id));
    if (words && this.o.board.unread(cardId, id)) {
      const rest = unheard.filter((u) => u !== words);
      this.o.board.work(cardId, { unheard: rest.length ? JSON.stringify(rest) : null });
      for (const said of words.said) this.o.board.withdraw(cardId, said);
      return;
    }
    const held = this.held(cardId);
    if (!held.some((h) => h.id === id)) throw new BadRequest('notHeld', 'the comment is not held back: the worker has it already');
    const rest = held.filter((h) => h.id !== id);
    this.o.board.work(cardId, { demo: { held: rest.length ? rest : null } });
    if (!rest.length) {
      clearTimeout(this.holding.get(cardId));
      this.holding.delete(cardId);
    }
    this.o.board.unlog(cardId, id);
  }

  /** The comments held back go to the worker as one message, the card still waiting for approval. */
  private release(cardId: string) {
    const card = this.o.board.item(cardId);
    if (!card || !handedOver(card)) return void this.takeHeld(cardId);
    const held = this.takeHeld(cardId);
    if (!held) return;
    this.o.board.record(cardId, 'reviewSent', 'owner');
    this.takingIn(cardId);
    this.deliver(
      cardId,
      `The owner watched your demo video and commented on places in it. The card still waits for their approval of what you handed over; a change their words call for goes into a new handover:\n\n${held.text}`,
      held.images,
      true,
    );
  }

  /** The comments held back as the worker reads them, each with its place, and their frames and screenshots; none are held afterwards. */
  private takeHeld(cardId: string): { text: string; images: string[] } | null {
    clearTimeout(this.holding.get(cardId));
    this.holding.delete(cardId);
    const held = this.held(cardId);
    if (!held.length) return null;
    
    this.o.board.readNow(cardId, held.map((h) => h.id));
    this.o.board.work(cardId, { demo: { held: null } });
    const events = new Map(this.o.board.events(cardId).map((e) => [e.id, e]));
    const images: string[] = [];
    const comments = held.flatMap(({ id, spoken }) => {
      const e = events.get(id);
      if (!e) return [];
      const still = this.stills(e.spot);
      const shots = this.o.imageFiles?.(e.images) ?? [];
      images.push(...still, ...shots);
      const files = [...still.map((f) => `frame: ${f}`), ...shots.map((f) => `screenshot: ${f}`)];
      return [
        `${e.spot ? spotNote(e.spot) : ''}${spoken ? ` (${SPOKEN})` : ''}\n${replyNote(e.replyTo ? this.o.board.quoted(cardId, e.replyTo) : undefined, 'worker')}${e.text}${files.length ? `\n(${files.join('; ')})` : ''}`,
      ];
    });
    if (!comments.length) return null;
    const many = comments.length > 1;
    return {
      text: `${many ? `${comments.length} comments` : 'A comment'} on places in your demo video${images.length ? ` (${many ? 'their frames and screenshots are' : 'its frame is'} shown below, in this order)` : ''}:\n\n${comments.join('\n\n')}`,
      images,
    };
  }

  /** Comments on places in the demo video the owner made before approving: they go with the approval. */
  private approvalComments(cardId: string): Comments | undefined {
    const held = this.takeHeld(cardId);
    return held
      ? { text: `Before approving, the owner watched your demo video. ${held.text}\n\nThey approved the work as it is all the same: what still matters of these comments, propose as a card of its own (propose_card).`, images: held.images }
      : undefined;
  }

  /**
   * What a stop or a start leaves of the card's detail and approval: where its approval could not land
   * because rebasing onto main conflicted (`landNow`), both stay, so that the worker started next is told
   * to resolve the conflicts and the work lands without another approval; otherwise both clear.
   */
  private keepingConflict(cardId: string): { detail: string | null; approved_at: string | null } {
    const row = this.o.board.row(cardId);
    return this.detailOf(cardId).conflict === true && row.approved_at ? { detail: row.detail, approved_at: row.approved_at } : { detail: null, approved_at: null };
  }

  detailOf(cardId: string): Record<string, unknown> {
    const detail = this.o.board.row(cardId).detail;
    return detail ? (JSON.parse(detail) as Record<string, unknown>) : {};
  }

  /**
   * The owner's answer to uncommitted changes in the Seismic checkout that kept the card's approved
   * work from landing (`blocked`): Seismic moves those changes into the card's branch and its worker
   * works them in. `land`: the approval holds, and the worker's next handover lands without a new
   * demo; otherwise the worker makes a new demo, and the owner approves again.
   */
  async fold(cardId: string, land: boolean) {
    const card = this.card(cardId);
    if (!handedOver(card) || this.landing.has(cardId) || this.approving.has(cardId) || card.state !== 'waiting') throw new BadRequest('notReady', 'the card is not ready for review');
    const row = this.o.board.row(cardId);
    const { blocked, ...detail } = this.detailOf(cardId) as { blocked?: { files: string[] } };
    this.landing.add(cardId);
    let folded;
    try {
      folded = await this.o.workstations.foldMain(cardId, row.branch!, blocked?.files);
    } finally {
      this.landing.delete(cardId);
    }
    if ('code' in folded) throw new BadRequest(folded.code, folded.detail);
    this.o.board.work(cardId, { detail: JSON.stringify(detail) });
    
    if (!folded.files.length) return land ? this.approve(cardId) : undefined;
    const files = folded.files.map((f) => `- ${f}`).join('\n');
    
    this.o.board.work(cardId, { state: 'working', need: null, detail: null, status_line: null, approved_at: land ? new Date().toISOString() : null, unheard: JSON.stringify(this.unheardBut(cardId, NOT_LANDED)) });
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.folded(folded.files, land));
    this.deliver(
      cardId,
      [
        `The owner approved your work, but the Seismic checkout had uncommitted changes of theirs to files your branch changes too, so it could not land. At the owner's word, Seismic moved those changes into your branch, as the commit ${folded.commit!.slice(0, 7)} on top of your work (also under refs/seismic/folded/${cardId})${folded.kept ? '' : ', and set those files back in the checkout'}:\n${files}`,
        ...(folded.kept ? ['The owner edited those files once more while Seismic folded them, so the checkout keeps its copies: if they still stand in the way once you hand over, the owner is offered to fold them in again.'] : []),
        folded.conflict
          ? 'The commit conflicts with your work: the cherry-pick is still under way in your workstation. Resolve it (git cherry-pick --continue), so that the owner\'s changes and yours both hold.'
          : 'Look at what the commit changes and work it in, so that the owner\'s changes and yours both hold: keep the commit, or fold it into yours.',
        land
          ? 'Then run the checks and hand over again: the approval holds, and Seismic lands the work without asking the owner again, with the demo already on the card.'
          : 'Then run the checks, make a new demo of the work with those changes in it, and hand over again: the owner approves anew.',
      ].join('\n\n'),
      [],
      true,
    );
  }

  /**
   * The project's "Code reviews" setting changed (or Seismic started): work waiting for the owner's
   * approval gets the "Start code review" button where the project reviews manually, and loses its
   * review where the project reviews no more. Automatic reviews start at handovers only, never here;
   * cards still at work or planned follow the setting when they hand over.
   */
  codeReviewsChanged(): Promise<void> {
    
    return (this.catchingUp = this.catchingUp.then(() => this.catchUpCodeReviews()));
  }

  private catchingUp: Promise<void> = Promise.resolve();

  /** The setting changed while Seismic ran: the cards at work now do not get an automatic review at their next handover. */
  holdAutoReviews(): void {
    for (const i of this.o.board.items()) {
      if (i.kind !== 'task' || i.state !== 'working' || (this.o.repo && i.repo !== this.o.repo)) continue;
      const row = this.o.board.row(i.id);
      const detail = row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : {};
      this.o.board.work(i.id, { detail: JSON.stringify({ ...detail, noAutoReview: true }) });
    }
  }


  private async catchUpCodeReviews(): Promise<void> {
    for (const i of this.o.board.items()) {
      if (i.kind !== 'task' || (this.o.repo && i.repo !== this.o.repo)) continue;
      try {
        if (!this.catchable(i.id)) continue;
        const work = await this.o.workstations.hasWork(i.id);
        
        if (!this.catchable(i.id)) continue;
        const e = this.o.board.events(i.id).findLast((x) => x.kind === 'review' && x.author === 'worker');
        if (!e) continue;
        const mode = this.reviewModeOf(this.o.board.row(i.id), work);
        
        if (!mode && this.o.codeReviews?.().on) continue;
        this.reviews.applyMode(i.id, e.id, mode);
      } catch (err) {
        console.error(`Seismic: the code review setting did not reach card ${i.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  /** Whether the card waits for the owner's approval of a handover, and its worker is not taking in the owner's words (it hands over again). */
  private catchable(cardId: string): boolean {
    const i = this.o.board.item(cardId);
    if (!i) return false;
    return i.kind === 'task' && handedOver(i) && !answering(i) && i.state === 'waiting' && !this.o.board.row(cardId).approved_at && !i.review?.landing && !this.landing.has(cardId) && !this.approving.has(cardId);
  }

  /** The mode in which the project reviews this card's work at a handover, or null where it does not: the one rule for handovers and for a changed setting. */
  reviewModeOf(row: CardRow, work: boolean, ): CodeReviewSetting['mode'] | null {
    if (this.folder || row.idea?.prototypeOf || contributionOf(row)) return null;
    const reviews = this.o.codeReviews?.();
    if (!reviews?.on || !work) return null;
    
    if (reviews.mode === 'auto' && row.detail && (JSON.parse(row.detail) as { noAutoReview?: boolean }).noAutoReview) return null;
    return reviews.mode;
  }

  
  /** "Start code review" on work waiting for the owner's approval: a review of its latest handover starts, with `setting` where the owner chose another agent for it. */
  startCodeReview(cardId: string, setting?: AgentSetting) {
    const card = this.card(cardId);
    if (!handedOver(card) || card.review?.landing || this.landing.has(cardId) || this.approving.has(cardId)) throw new BadRequest('notReady', 'the card is not ready for review');
    
    const latest = this.o.board.events(cardId).findLast((x) => x.kind === 'review' && x.author === 'worker');
    if (card.review?.contribution || this.folder || card.idea?.prototypeOf) throw new BadRequest('notReview', 'this work is not reviewed by a code review');
    this.reviews.start(cardId, latest?.id, setting);
    if (setting) this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.codeReviewWith(describeSetting(setting)));
  }

  /**
   * "Select new agent" on a worker its model's usage limit stopped (paused after its attempts, or
   * waiting for the reset): a worker on `setting` takes the card over. In the same harness it
   * resumes the session, so it keeps what was said and done; in another one it starts afresh from
   * the card's briefing and its branch, as no session moves across harnesses.
   */
  handOff(cardId: string, setting: AgentSetting) {
    this.card(cardId);
    const live = this.live.get(cardId);
    const hold = this.o.board.holdOf(cardId);
    if (hold?.reason !== 'limit' && !live?.limited) throw new BadRequest('notLimited', 'only an agent stopped by the usage limit is handed off');
    const row = this.o.board.row(cardId);
    if (!row.workstation) throw new BadRequest('notReady', 'the card has no workstation');
    const before = row.agent_setting ? (JSON.parse(row.agent_setting) as AgentSetting) : null;
    const statusBefore = hold?.reason === 'limit' ? hold.statusBefore : live?.statusBefore;
    const held = hold?.reason === 'limit' ? hold.held ?? [] : [];
    if (live) {
      limitWatch.cancel(live);
      this.unlimited(cardId, live);
      this.end(cardId);
    }
    this.limitAttempts.delete(cardId);
    this.o.board.waitsForLimit({ card: cardId }, undefined);
    const same = (before?.harness ?? 'claude') === (setting.harness ?? 'claude');
    this.o.board.work(cardId, { hold: null, status_line: statusBefore ?? null, agent_setting: JSON.stringify(setting), ...(same ? {} : { session_id: null }) });
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.handedOff(describeSetting(setting)));
    
    const news = held.length ? `\n\nWhile it was paused, Seismic had this for it:\n\n${held.map((h) => h.text).join('\n\n---\n\n')}` : '';
    const images = held.flatMap((h) => h.images);
    const note = same && row.session_id ? `${HANDED_OFF_SAME}${news}` : `${HANDED_OFF_NEW}${news}`;
    this.deliver(cardId, note, images, true);
  }

  async approve(cardId: string, { direct = false }: { direct?: boolean } = {}) {
    const card = this.card(cardId);
    if (!handedOver(card) || this.landing.has(cardId) || this.approving.has(cardId)) throw new BadRequest('notReady', 'the card is not ready for review');
    
    const approved = () => this.o.board.record(cardId, 'approved', 'owner');
    if (card.review?.contribution) {
      if (direct) throw new BadRequest('noDirect', 'a review card merges its pull request');
      return this.mergeContribution(cardId);
    }
    if (direct && card.idea?.prototypeOf) throw new BadRequest('noDirect', 'a prototype never lands');
    
    if (card.idea?.prototypeOf) {
      this.takeHeld(cardId);
      approved();
      return this.endPrototype(cardId, 'discarded');
    }
    
    const unsnooze = () => snoozeOf(card) && this.o.board.work(cardId, { hold: null });
    
    if (this.folder) {
      unsnooze();
      approved();
      return void this.close(cardId, 'owner', this.approvalComments(cardId));
    }
    
    
    clearTimeout(this.holding.get(cardId));
    this.holding.delete(cardId);
    const before = this.o.board.row(cardId).approved_at;
    
    const { blocked, ...detail } = this.detailOf(cardId);
    this.o.board.work(cardId, { approved_at: new Date().toISOString(), ...(blocked ? { detail: JSON.stringify(detail) } : {}) });
    
    this.reviews.cancel(cardId);
    this.approving.add(cardId);
    const generation = this.generation.get(cardId);
    let lands: { land: 'main' | 'pr'; direct: boolean };
    let work: boolean;
    try {
      [lands, work] = await Promise.all([this.landingOf(cardId), this.o.workstations.hasWork(cardId)]);
    } finally {
      this.approving.delete(cardId);
    }
    
    if (!handedOver(this.card(cardId)) || this.generation.get(cardId) !== generation) throw new BadRequest('notReady', 'the card is not ready for review');
    
    if (direct && lands.land === 'pr' && !lands.direct) {
      this.o.board.work(cardId, { approved_at: before });
      if (this.held(cardId).length) this.releaseLater(cardId, this.o.releaseDelay ?? RELEASE_DELAY);
      throw new BadRequest('noDirect', 'this repository lands approved work only through a pull request; its settings do not allow pushing it directly');
    }
    unsnooze();
    const comments = this.approvalComments(cardId);
    
    if (!work) {
      approved();
      return void this.close(cardId, 'owner', comments);
    }
    
    if (lands.land === 'main' || direct) return this.land(cardId, 'owner', comments);
    approved();
    
    const pr: PrState = { url: null, seen: [], reported: [] };
    
    this.o.board.work(cardId, { state: 'inPr', need: null, detail: null, status_line: null, approved_at: null, review: { pr } });
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.approvedPr);
    
    this.o.onApproval?.(cardId);
    
    const shared = card.demo?.share?.url;
    if (shared) this.pageHeard(cardId);
    this.deliver(
      cardId,
      [
        `The owner approved your work. In this repository it goes out as a pull request, opened the way the repository does it (its own skills and conventions): from now on you may push this branch. Whoever reads the pull request has not seen Seismic, the card or the plan doc. Do not merge it: ${this.o.adapter.autoMerge === false ? 'the people on the forge merge it' : 'Seismic merges it'} once its checks have passed and its review is through.`,
        shared ? `Your demo video is shared with the team on a page of its own: ${shared}. Link it in the pull request's description.` : '',
        'Once you report its URL with pr_opened, Seismic watches it and passes you review comments, failed checks and conflicts; you handle them the way the repository does (its skill for review comments, if it has one). A comment that questions a decision, or a conflict that needs a product call, is the owner’s (ask). Where the work also needs a pull request in another repository, report that one with pr_opened too: Seismic watches each, and the card is live once all are merged.',
        comments?.text ?? '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      comments?.images,
      true,
    );
  }

  /**
   * "Merge (PR #5)": the owner approved a review card's demo. Seismic merges the pull request on the
   * forge (the repository's allowed method, squash first), pinned to the head the worker reviewed:
   * a PR that moved since the handover is not merged, and its worker reviews it anew. Where the
   * worker's own commits are held (`HeldChanges`), Seismic first pushes them onto the PR's branch,
   * fast-forward only, and posts their text: as a comment, or with requests to the contributor as
   * one review asking for changes, after which the card waits for them and nothing is merged;
   * `merge: false` ("Push and comment only") stops after the post too. Before the merge the demo goes on its
   * page where the site publishes on approval, and the page's link goes into a comment on the PR
   * once it is online (`onApproval`; the description stays the contributor's). A refused merge
   * leaves the card waiting for the owner, with the reason. Merged, the card is live and, where work
   * lands on the local main, the checkout pulls the merge.
   */
  private async mergeContribution(cardId: string, { merge = true }: { merge?: boolean } = {}) {
    const forge = this.o.forge;
    const c = contributionOf(this.o.board.row(cardId));
    if (!forge || !c) throw new BadRequest('notReview', 'the card reviews no pull request');
    if (!merge && !c.held) throw new BadRequest('notReady', 'nothing of the agent’s waits to be pushed');
    const t = this.o.board.t.worker;
    const generation = this.generation.get(cardId);
    const held = this.held(cardId).length > 0;
    clearTimeout(this.holding.get(cardId));
    this.holding.delete(cardId);
    this.approving.add(cardId);
    const cwd = this.forgeCwd(cardId);
    let merged: string | void;
    try {
      const now = await forge.status(cwd, c.url).catch((e: unknown) => {
        throw new BadRequest('mergeRefused', messageOf(e));
      });
      if (!handedOver(this.card(cardId)) || this.generation.get(cardId) !== generation) throw new BadRequest('notReady', 'the card is not ready for review');
      if (now.state === 'MERGED') {
        if (merge) this.o.board.record(cardId, 'approved', 'owner');
        return this.merged(cardId, now.mergeCommit, t.mergedContribution(c.number));
      }
      if (now.state === 'CLOSED') throw new BadRequest('prClosed', 'the pull request was closed');
      
      if (!c.reviewed || (now.head !== c.reviewed && now.head !== c.held?.base)) throw this.moved(cardId, c, now.head);
      
      const merging = merge && !c.held?.asks.length;
      if (merging) {
        const shown = c.clash;
        const clash = await this.probeClash(cardId);
        if (this.generation.get(cardId) !== generation || !this.o.board.item(cardId)) return;
        if (clash && !sameClash(shown, clash)) {
          this.o.board.log(cardId, 'state', 'seismic', t.clashFound(c.number, clash.subject, clash.card?.title));
          throw new BadRequest('pullClash', `the pull request collides with unpushed commits on the local main (${clash.commit.slice(0, 7)} ${clash.subject})`);
        }
      }
      if (c.held) {
        if (now.head !== c.reviewed) await this.pushHeld(cardId, c);
        if (this.generation.get(cardId) !== generation || !this.o.board.item(cardId)) return;
        await this.postHeld(cardId, c);
        if (c.held.asks.length || !merge) return;
      }
      
      const comments = this.approvalComments(cardId);
      this.o.board.work(cardId, { review: { contribution: { ...(contributionOf(this.o.board.row(cardId)) ?? c), approved: true } satisfies StoredContribution } });
      this.o.board.log(cardId, 'state', 'owner', t.approvedMerge(c.number));
      this.o.onApproval?.(cardId);
      try {
        merged = await forge.merge(cwd, c.url, c.reviewed);
      } catch (e) {
        const reason = messageOf(e).replace(/^gh pr merge \S+: /, '');
        this.o.board.log(cardId, 'error', 'seismic', t.mergeRefused(reason));
        if (comments) this.deliver(cardId, comments.text, comments.images, true);
        throw new BadRequest('mergeRefused', reason);
      }
      this.o.board.record(cardId, 'approved', 'owner');
      if (this.generation.get(cardId) !== generation || !this.o.board.item(cardId)) return;
      this.merged(cardId, merged || undefined, t.mergedContribution(c.number), comments);
    } catch (e) {
      if (held && this.held(cardId).length) this.releaseLater(cardId, this.o.releaseDelay ?? RELEASE_DELAY);
      throw e;
    } finally {
      this.approving.delete(cardId);
    }
  }

  /** "Push and comment only": the worker's own commits held on a review card go onto the PR with their text, and the card waits for the owner's "Merge" again. */
  pushContribution(cardId: string) {
    const card = this.card(cardId);
    if (!card.review?.contribution || !handedOver(card) || this.approving.has(cardId)) throw new BadRequest('notReady', 'the card is not ready for review');
    return this.mergeContribution(cardId, { merge: false });
  }

  /**
   * The owner's own wording of the text that goes onto the PR with the worker's held changes: it is
   * the held text from now on, posted with the approval and kept by a handover without pr_draft. The
   * worker hears it with its next message or step, an earlier edit's news replaced, so that a
   * pr_draft it gives later starts from the owner's words.
   */
  editHeld(cardId: string, body: unknown) {
    const card = this.card(cardId);
    const c = contributionOf(this.o.board.row(cardId));
    if (!c?.held || !handedOver(card) || this.approving.has(cardId)) throw new BadRequest('notReady', 'no text waits for the approval on this card');
    const text = typeof body === 'string' ? clip(body.trim(), 20000) : '';
    if (!text) throw new BadRequest('emptyText', 'the text for the pull request is empty');
    if (text === c.held.body) return;
    this.o.board.work(cardId, {
      review: { contribution: { ...c, held: { ...c.held, body: text } } satisfies StoredContribution },
      unheard: JSON.stringify([...this.unheardBut(cardId, HELD_EDITED), { said: [], text: heldEdited(text), images: [] }] satisfies Unheard[]),
    });
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.heldEdited(c.number));
  }

  /**
   * The approval of a review card met a pull request at another head than the one handed over (the
   * contributor pushed since): Seismic pushes, posts and merges nothing, and the worker reviews the PR
   * as it is now, its own commits not pushed yet put on top. Returns the refusal to throw.
   */
  private moved(cardId: string, c: StoredContribution, head: string): BadRequest {
    const t = this.o.board.t.worker;
    const comments = this.approvalComments(cardId);
    this.o.board.log(cardId, 'state', 'seismic', c.held ? t.heldMoved(head.slice(0, 7)) : t.unreviewedHead(head.slice(0, 7)));
    this.o.board.work(cardId, { state: 'working', need: null, detail: null, status_line: null });
    this.deliver(
      cardId,
      [
        c.held
          ? `The owner approved your handover, but the pull request's head is ${head.slice(0, 7)} now, not the ${c.held.base.slice(0, 7)} your commits build on: ${c.author} pushed meanwhile. So Seismic pushed, posted and merged nothing.`
          : `The owner approved your handover, but the pull request's head is ${head.slice(0, 7)} now, not the ${c.reviewed?.slice(0, 7) ?? 'commit'} you handed over, so Seismic did not merge it.`,
        `Review it as it is now: fetch its head, look at what changed before you run any of it, then the code review, a new demo where the change shows, the checks and the merge probe.${c.held ? ' Put your own commits on top of the new head first (rebase; the PR\'s commits stay as they are), and check that pr_draft still says what goes with them.' : ''} Hand over again.`,
        comments?.text ?? '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      comments?.images,
      true,
    );
    return new BadRequest('prMoved', `the pull request is at ${head.slice(0, 7)} now, not at the commit handed over`);
  }

  /**
   * The worker's own commits held on a review card go onto the PR's branch in the contributor's
   * repository, fast-forward only, from its workstation and without its hooks (the PR's code ran there).
   * A push the forge rejects as not a fast-forward is a push of the contributor's meanwhile, which
   * goes back to the worker as a moved head would; any other refusal stays with the owner.
   */
  private async pushHeld(cardId: string, c: StoredContribution & { held?: object }): Promise<void> {
    const t = this.o.board.t.worker;
    const ws = this.o.board.row(cardId).workstation;
    const to = pushTarget(c);
    const refuse = (reason: string) => {
      this.o.board.log(cardId, 'error', 'seismic', t.pushRefused(reason));
      return new BadRequest('pushRefused', reason);
    };
    if (!ws) throw refuse('the card has no workstation');
    if (!to) throw refuse('the forge names no branch of the pull request to push to');
    try {
      await gitAsync(ws, '-c', 'core.hooksPath=/dev/null', 'push', '--quiet', to.repo, `${c.reviewed}:refs/heads/${to.branch}`);
    } catch (e) {
      const why = messageOf(e);
      if (/non-fast-forward|fetch first|\[rejected\]|stale info/.test(why)) {
        const head = await this.o.forge!.status(this.forgeCwd(cardId), c.url).then(
          (s) => s.head,
          () => '',
        );
        throw this.moved(cardId, c, head || 'another commit');
      }
      throw refuse(why);
    }
    
    for (let i = 0; i < 10; i++) {
      const head = await this.o.forge!.status(this.forgeCwd(cardId), c.url).then(
        (s) => s.head,
        () => '',
      );
      if (head === c.reviewed) break;
      await new Promise((r) => setTimeout(r, this.o.pushSettle ?? 1000));
    }
  }

  /**
   * Once the worker's own commits are on the PR's branch, their text goes onto the PR in the owner's
   * name: a comment, or with requests to the contributor one review asking for changes, after which
   * the card waits for them. The findings it fixed and those it asks for link it. A text the forge
   * refuses leaves the card with the owner, its commits pushed and nothing merged, and the findings
   * it asked for open, to be decided anew.
   */
  private async postHeld(cardId: string, c: StoredContribution): Promise<void> {
    const t = this.o.board.t.worker;
    const held = c.held!;
    const asks = held.asks.length > 0;
    let url: string | undefined;
    let failed: string | undefined;
    try {
      url = (await (asks ? this.o.forge!.requestChanges(this.forgeCwd(cardId), c.url, held.body) : this.o.forge!.comment(this.forgeCwd(cardId), c.url, held.body))) || undefined;
    } catch (e) {
      failed = messageOf(e);
    }
    const now = contributionOf(this.o.board.row(cardId)) ?? c;
    const { held: _, changing: __, ...rest } = now;
    const findings = now.findings?.map((f): Finding => {
      const { decided: ___, withChanges: ____, ...plain } = f;
      if (held.asks.includes(f.id) && f.status === 'open') return failed ? plain : { ...plain, status: 'sent', ...(url ? { url } : {}) };
      if (f.status === 'fixed' && !f.url && url) return { ...f, url };
      return f;
    });
    const sent = asks && !failed;
    this.o.board.work(cardId, {
      
      ...(failed ? {} : { unheard: JSON.stringify(this.unheardBut(cardId, HELD_EDITED)) }),
      review: { contribution: {
        ...rest,
        ...(findings ? { findings } : {}),
        ...(sent ? { requested: { ...(url ? { url } : {}), at: new Date().toISOString() } } : {}),
      } satisfies StoredContribution },
      
      ...(sent ? { state: 'inPr', need: null, detail: null, status_line: null } : {}),
    });
    if (failed) {
      this.o.board.log(cardId, 'error', 'seismic', t.postFailed(failed));
      throw new BadRequest('mergeRefused', `pushed, but the forge refused the text that goes with it (${failed})`);
    }
    this.o.board.log(cardId, 'state', 'owner', `${t.pushedHeld(c.number, held.commits, asks ? c.author : undefined)}${url ? ` ${url}` : ''}`);
  }

  /**
   * A review card's pull request was closed without a merge: the owner says whether the card can go
   * (its worker closes it then) or stays. Asked once.
   */
  contributionClosed(cardId: string) {
    const row = this.o.board.row(cardId);
    const c = contributionOf(row);
    if (!c) return;
    const t = this.o.board.t.worker;
    this.refuseAsked(cardId, 'meanwhile the pull request was closed without a merge.');
    this.o.board.work(cardId, { review: { contribution: { ...c, closed: true } satisfies StoredContribution } });
    this.o.board.log(cardId, 'state', 'seismic', t.prClosed);
    this.toOwner(cardId, { text: t.contributionClosedQuestion, options: [t.closeCard, t.keepCard] });
    this.deliver(
      cardId,
      `The pull request was closed without a merge. Seismic asked the owner whether the card can go. If they say so, close it with close_unchanged; nothing of it lands.`,
    );
  }

  /**
   * The contributor answered while the review card waited for them, or pushed: the worker hears
   * what came and reviews again; the owner's log gets `note`.
   */
  contributorAnswered(cardId: string, note: string, message: string) {
    this.o.board.log(cardId, 'state', 'seismic', note);
    const c = contributionOf(this.o.board.row(cardId));
    if (c?.requested) this.o.board.work(cardId, { review: { contribution: { ...c, requested: undefined } satisfies StoredContribution } });
    if (this.o.board.row(cardId).state === 'inPr') this.o.board.work(cardId, { state: 'working', need: null, detail: null, status_line: null });
    this.deliver(cardId, message);
  }

  /**
   * The owner's change request, as the worker wrote it, goes to the contributor as a review asking
   * for changes; the card waits for them (`inPr`, "Waiting for the contributor") with the review linked
   * in its log. Returns why it was not sent, or nothing.
   */
  async requestChanges(cardId: string, body: string, ids: number[] = []): Promise<string | undefined> {
    const c = contributionOf(this.o.board.row(cardId));
    if (!this.o.forge || !c) return 'Not sent: this card reviews no pull request.';
    if (!body.trim()) return 'Not sent: the review has no text.';
    const generation = this.generation.get(cardId);
    
    const ws = this.o.board.row(cardId).workstation;
    const head = c.reviewed ?? (ws ? await gitAsync(ws, 'rev-parse', 'HEAD').catch(() => undefined) : undefined);
    let url: string | void;
    try {
      url = await this.o.forge.requestChanges(this.forgeCwd(cardId), c.url, body.trim());
    } catch (e) {
      return `Not sent: the forge refused it (${messageOf(e)}). Tell the owner with reply if it keeps failing.`;
    }
    const t = this.o.board.t.worker;
    
    const row = this.o.board.row(cardId);
    if (this.generation.get(cardId) !== generation || !(row.state === 'working' || row.state === 'waiting')) {
      this.o.board.log(cardId, 'state', 'worker', `${t.changesRequested(c.number, c.author)}${url ? ` ${url}` : ''}`);
      return 'Sent, but the card was stopped meanwhile. End your turn.';
    }
    const now = contributionOf(row) ?? c;
    this.o.board.work(cardId, {
      state: 'inPr',
      need: null,
      detail: null,
      
      status_line: null,
      review: { contribution: {
        ...now,
        ...(head && !now.reviewed ? { reviewed: head } : {}),
        
        ...(now.findings ? { findings: now.findings.map((f) => (ids.includes(f.id) && f.status !== 'later' ? { id: f.id, title: f.title, text: f.text, ...(f.security ? { security: true } : {}), status: 'sent' as const, ...(url ? { url } : {}) } : f)) } : {}),
        requested: { ...(url ? { url } : {}), at: new Date().toISOString() },
      } satisfies StoredContribution },
    });
    this.o.board.log(cardId, 'state', 'worker', `${t.changesRequested(c.number, c.author)}${url ? ` ${url}` : ''}`);
    return undefined;
  }

  /**
   * Where a review card's branch stands against its pull request at a handover: its head, the PR's
   * head on the forge (`base`) and how many commits of the worker's own go on top of it. Why it
   * cannot be handed over, where the branch does not build on the PR's head: the contributor pushed
   * since the worker fetched, or the branch was rewritten.
   */
  async ownCommits(cardId: string, c: StoredContribution): Promise<OwnCommits | string> {
    const ws = this.o.board.row(cardId).workstation ?? '';
    let head: string;
    try {
      head = await gitAsync(ws, 'rev-parse', 'HEAD');
    } catch (e) {
      return `Not handed over: Seismic could not read your branch's head (${messageOf(e)}). Check the workstation, then call ready_for_review again.`;
    }
    if (!this.o.forge) return { head, base: head, commits: 0 };
    let base: string;
    try {
      base = (await this.o.forge.status(this.forgeCwd(cardId), c.url)).head;
    } catch (e) {
      return `Not handed over: Seismic could not read the pull request's head from the forge (${messageOf(e)}). Call ready_for_review again in a moment.`;
    }
    if (!base || base === head) return { head, base: head, commits: 0 };
    const on = await gitAsync(ws, 'merge-base', '--is-ancestor', base, head).then(
      () => true,
      () => false,
    );
    if (!on)
      return `Not handed over: the pull request's head is ${base.slice(0, 7)}, and your branch does not build on it (${c.author} pushed since you fetched it, or your branch was rewritten). Fetch refs/pull/${c.number}/head from ${this.prSource(c)} and look at what changed before you run any of it; put the commits of your own that are not on the PR yet on top of it (rebase; the PR's commits stay as they are), review what is new, then hand over again.`;
    
    const commits = Number(await gitAsync(ws, 'rev-list', '--count', '--first-parent', `${base}..${head}`).catch(() => '0')) || 0;
    return { head, base, commits };
  }

  /**
   * What a review card's handover holds back for the owner's approval: the worker's own commits on
   * top of the PR's head, the text that goes onto the PR with them (`draft`, else the one handed over
   * before) and the findings decided for the contributor meanwhile, which go in the same text. None
   * where the branch holds no commits of its own; why it cannot be handed over, as the worker reads it.
   */
  heldAt(cardId: string, mine: OwnCommits, draft: string | undefined): (HeldChanges & { base: string }) | string | undefined {
    const c = contributionOf(this.o.board.row(cardId))!;
    const asks = (c.findings ?? []).filter((f) => f.status === 'open' && f.decided === 'contributor');
    if (!mine.commits) {
      const waiting = asks.filter((f) => f.withChanges);
      if (!c.changing && !c.held && !waiting.length) return undefined;
      
      const { changing: _, held: __, ...rest } = c;
      const findings = c.findings?.map((f) => (f.withChanges ? (({ withChanges: ___, ...x }) => x)(f) : f));
      this.o.board.work(cardId, { review: { contribution: { ...rest, ...(findings ? { findings } : {}) } satisfies StoredContribution } });
      return waiting.length
        ? `Not handed over: your branch holds no commits beyond the pull request's head, so nothing of yours waits to be pushed, and ${waiting.map((f) => `#${f.id}`).join(', ')} for ${c.author} would wait for nothing. Send ${waiting.length === 1 ? 'it' : 'them'} now with request_changes.`
        : undefined;
    }
    if (!c.canModify)
      return `Not handed over: your branch holds ${mine.commits === 1 ? 'a commit' : `${mine.commits} commits`} beyond the pull request's head ${mine.base.slice(0, 7)}, and ${c.author} does not allow maintainers' edits, so nothing can go onto the PR's branch. Put your branch back on the PR's head (git reset --hard ${mine.base.slice(0, 7)}), then hand over again.`;
    
    const edited = draft?.trim() && this.unheard(cardId).find((u) => u.text.startsWith(HELD_EDITED));
    if (edited) {
      this.o.board.work(cardId, { unheard: JSON.stringify(this.unheardBut(cardId, HELD_EDITED)) });
      return `Not handed over: ${edited.text.replace(HELD_EDITED, 'the owner edited the text that goes onto the pull request with the approval.')}\n\nThen call ready_for_review again.`;
    }
    const body = clip((draft ?? '').trim() || c.held?.body || '', 20000);
    if (!body)
      return `Not handed over: your branch holds ${mine.commits === 1 ? 'a commit' : `${mine.commits} commits`} of your own that ${mine.commits === 1 ? 'is' : 'are'} not on the pull request yet. Give pr_draft: the text Seismic posts on the PR once the owner approves, after pushing them (what you changed and why${asks.length ? `, and the request for ${asks.map((f) => `#${f.id}`).join(', ')} to ${c.author}` : ''}). Then call ready_for_review again.`;
    return { body, commits: mine.commits, asks: asks.map((f) => f.id), base: mine.base };
  }

  /**
   * "Discard changes" in a folder without git, on a card waiting for approval: what its worker
   * changed there is put back as it was (`FolderWorkstations.undo`), but what someone changed since
   * and what no copy was kept of. The card goes on waiting for the owner, its log says what was put
   * back and what not, and its worker hears it with its next message.
   */
  async undo(cardId: string): Promise<UndoReport> {
    const card = this.card(cardId);
    if (!this.folder) throw new BadRequest('notFolder', 'only the changes of a card in a folder without git are undone');
    if (!handedOver(card) || this.landing.has(cardId)) throw new BadRequest('notReady', 'only a card waiting for approval has its changes discarded');
    const report = await this.folder.undo(cardId);
    const t = this.o.board.t.worker;
    const files = (list: string[]) => list.join(', ');
    this.o.board.log(
      cardId,
      'state',
      'owner',
      [t.undone(report.undone.filter((p) => !p.endsWith('/')).length), report.changedSince.length ? t.undoChangedSince(files(report.changedSince)) : '', report.lost.length ? t.undoLost(files(report.lost)) : '', report.shared.length ? t.undoShared(files(report.shared)) : ''].filter(Boolean).join(' '),
    );
    const row = this.o.board.row(cardId);
    const detail = row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : {};
    const told = [
      `The owner discarded your changes in the folder: Seismic put back what your card changed (${report.undone.join(', ') || 'nothing'}) as it was before.`,
      report.changedSince.length ? `Left as they are, since someone changed them after you: ${files(report.changedSince)}.` : '',
      report.lost.length ? `Left as they are, since no copy from before your change was kept: ${files(report.lost)}.` : '',
      report.shared.length ? `Left as they are, since another card's agent was at work when they changed: ${files(report.shared)}.` : '',
      'The card still waits for the owner.',
    ];
    this.o.board.work(cardId, {
      detail: JSON.stringify({ ...detail, noChange: !this.folder.changed(cardId).length || undefined }),
      unheard: JSON.stringify([...this.unheard(cardId), { said: [], text: told.filter(Boolean).join(' '), images: [] }] satisfies Unheard[]),
    });
    return report;
  }

  /**
   * How the card's work lands: as the repository's settings say, except where its own branch
   * changes that in `.seismic/settings.json` (the card that sets up the settings, say) and the
   * settings of this machine do not say otherwise. Then as the branch says: the owner approves the
   * change with the work, and has answered how work lands in the card that makes it. `own` holds
   * what the branch decides.
   */
  async landingOf(cardId: string): Promise<{ land: 'main' | 'pr'; direct: boolean; own?: CardLanding }> {
    const repo = { land: this.o.adapter.land, direct: !!this.o.adapter.direct };
    const fork = await this.o.workstations.forkPoint(cardId);
    if (!fork) return repo;
    const [now, before] = await gitSteps(fork.ws, together(readingShared('HEAD'), readingShared(fork.base)));
    const machine = this.o.machineSettings?.();
    const own: CardLanding = {};
    for (const field of ['land', 'direct'] as const) {
      const v = now.settings?.[field];
      if (v !== undefined && v !== before.settings?.[field] && machine?.[field] === undefined) Object.assign(own, { [field]: v });
    }
    if (own.land === undefined && own.direct === undefined) return repo;
    return { land: own.land ?? repo.land, direct: own.direct ?? repo.direct, own };
  }

  /**
   * Lands approved work on main: on the Seismic checkout, or, where work otherwise goes out as a pull
   * request, pushed directly onto `origin`'s default branch. What the worker can fix (main moved on
   * and the change conflicts, uncommitted work) goes back to it with the approval kept: its next
   * handover lands without the owner approving again, the same way. What blocks the Seismic checkout,
   * or a push turned away, stays with the owner and needs a new approval.
   */
  private async land(cardId: string, by: 'owner' | 'seismic', comments?: Comments) {
    if (this.landing.has(cardId)) return;
    this.landing.add(cardId);
    const turn = new AbortController();
    this.landingTurns.set(cardId, turn);
    try {
      await this.landNow(cardId, by, comments, turn.signal);
    } catch (e) {
      if (turn.signal.aborted) return;
      
      if (this.o.board.row(cardId).state === 'waiting') this.o.board.work(cardId, { approved_at: null });
      throw e;
    } finally {
      this.landing.delete(cardId);
      this.landingTurns.delete(cardId);
      this.landingActive.delete(cardId);
      this.o.board.showLandingPosition(cardId, undefined);
    }
  }

  private async landNow(cardId: string, by: 'owner' | 'seismic', comments?: Comments, signal?: AbortSignal) {
    const row = this.o.board.row(cardId);
    
    const direct = (await this.landingOf(cardId)).land === 'pr';
    
    const added = await this.planDocsAdded(cardId);
    
    signal?.throwIfAborted();
    const trailer = this.o.onApproval?.(cardId) ?? undefined;
    const turn = { signal, position: (n: number | undefined) => {
      if (n === 0) this.landingActive.add(cardId);
      this.o.board.showLandingPosition(cardId, n);
    } };
    const result = await (direct ? this.o.workstations.pushToMain(cardId, trailer, turn) : this.o.workstations.landOnMain(cardId, row.branch!, trailer, turn));
    if (signal?.aborted) return;
    if ('code' in result && !result.worker) {
      
      const text = `${NOT_LANDED} ${result.detail}\n\nThat is not in your work: the owner sees on the card what to do, and the card waits for their approval again.`;
      
      const blocked = result.code === 'landMerge' && result.files?.length ? { files: result.files } : undefined;
      this.o.board.work(cardId, {
        approved_at: null,
        unheard: JSON.stringify([...this.unheardBut(cardId, NOT_LANDED), { said: [], text, images: [] }] satisfies Unheard[]),
        ...(blocked ? { detail: JSON.stringify({ ...this.detailOf(cardId), blocked }) } : {}),
      });
      
      throw new BadRequest(result.code === 'landMerge' && !blocked ? 'landLocal' : result.code, result.detail);
    }
    if (by === 'owner') this.o.board.record(cardId, 'approved', 'owner');
    if ('code' in result) {
      
      const conflict = result.code === 'landConflict' || this.detailOf(cardId).conflict === true;
      this.o.board.work(cardId, { state: 'working', need: null, detail: conflict ? JSON.stringify({ conflict: true }) : null, approved_at: row.approved_at ?? new Date().toISOString() });
      this.o.board.log(cardId, 'error', 'seismic', result.detail, { code: result.code });
      this.deliver(
        cardId,
        [
          `The owner approved your work, but it could not land on main: ${result.detail}`,
          'The approval holds for what it takes to land the work: once you hand over again, Seismic lands it without asking the owner again, with the demo already on the card. A change to what the owner approved is theirs to decide.',
          ...(comments ? [comments.text] : []),
        ].join('\n\n'),
        comments?.images,
        by === 'owner',
      );
      return;
    }
    
    if (this.unheard(cardId).some((u) => u.text.startsWith(NOT_LANDED))) this.o.board.work(cardId, { unheard: JSON.stringify(this.unheardBut(cardId, NOT_LANDED)) });
    this.o.board.planDocsLanded(cardId, added);
    this.bump(cardId);
    const restartFor = (await this.o.restartsFor?.(result, direct ? (row.workstation ?? undefined) : undefined)) ?? false;
    const restarts = !!restartFor;
    const page = this.pageNote(cardId);
    this.o.board.work(cardId, {
      state: 'live',
      need: null,
      detail: null,
      status_line: null,
      approved_at: null,
      landed: JSON.stringify({ commit: result.to, ...(restarts ? { restarts } : {}), ...(page.waits ? { page: true } : {}) } satisfies LandedState),
      shipped: JSON.stringify({ commit: result.to, base: result.from } satisfies Shipped),
    });
    this.o.board.record(cardId, 'landed', 'seismic');
    const t = this.o.board.t.worker;
    if (direct) this.o.board.log(cardId, 'state', by, by === 'owner' ? t.approvedDirect : t.landedDirect);
    else this.o.board.log(cardId, 'state', by, by === 'owner' ? t.approvedMain : t.landedMain);
    const sw = result.switched;
    if (sw) this.o.board.log(cardId, 'state', 'seismic', t.switchedToMain(sw.branch, sw.commit));
    if (direct) this.o.onMerged?.(cardId);
    else this.reprobeClashes();
    this.o.onLanded?.(cardId);
    this.extensionEvent('landed', cardId);
    this.afterLanding(
      cardId,
      [
        direct
          ? `${by === 'owner' ? 'The owner approved your work to go directly onto main, and Seismic' : 'Seismic'} pushed it there without a pull request (${result.to.slice(0, 7)}); the card is live.`
          : `${by === 'owner' ? 'The owner approved your work, and it' : 'Your work'} is on main now (${result.to.slice(0, 7)}); the card is live.`,
        sw
          ? `The Seismic checkout was on ${sw.branch ? `the branch ${sw.branch}` : `a detached HEAD at ${sw.commit}`}, not on main: Seismic switched it to main to land your work.` +
            (sw.commits
              ? ` ${sw.branch ?? sw.commit} has ${sw.commits === 1 ? 'a commit' : `${sw.commits} commits`} main does not: if ${sw.commits === 1 ? 'it is' : 'they are'} work of yours, made there instead of in your workstation, ${sw.commits === 1 ? 'it' : 'they'} did not land with it; tell the owner.`
              : '')
          : '',
        restartFor === 'seismic'
          ? `Seismic runs from that checkout and starts again with your change as soon as no worker is in the middle of a turn, which stops whatever you run then. ${AFTER_RESTART}`
          : restartFor === 'repo'
            ? `Your change moves where this repository's agents work: Seismic restarts them with it as soon as none of them is in the middle of a turn, you among them, which stops whatever you run then. ${AFTER_RESTART}`
            : '',
        page.text,
        comments?.text ?? '',
        workerConfig.afterLanding,
      ]
        .filter(Boolean)
        .join('\n\n'),
      comments?.images,
      by === 'owner',
    );
  }

  /** Main moved over files this card has changed: news for its next turn, without waking it. */
  private async landingNotice(notice: LandingNotice) {
    const repo = this.o.repo ?? this.o.board.home;
    const hard = new Set(notice.files.filter((f) => !this.o.adapter.softPaths.some((p) => overlaps(normalize(f), normalize(p)))));
    if (!hard.size) return;
    const candidates = this.o.board.items().filter((c) => c.id !== notice.cardId && c.repo === repo && ACTIVE.includes(c.state) && c.kind !== 'plan' && !c.idea?.prototypeOf);
    await Promise.all(candidates.map(async (c) => {
      const changed = await this.o.workstations.changedFiles(c.id, undefined, true);
      const files = [...new Set(changed.filter((f) => hard.has(f)))].sort();
      const now = this.o.board.item(c.id);
      if (!files.length || !now || !ACTIVE.includes(now.state)) return;
      const text = `Seismic landed commits on main (${notice.commit.slice(0, 7)}) that touch files you have changed.\n\nLanded commits:\n${notice.subjects.map((s) => `- ${s}`).join('\n')}\n\nOverlapping files:\n${files.map((f) => `- ${f}`).join('\n')}\n\nYou may want to rebase now rather than wait until handover. Decide from your work whether and when to do so.`;
      this.o.board.work(c.id, { unheard: JSON.stringify([...this.unheard(c.id), { nextTurn: true, said: [], text, images: [] }] satisfies Unheard[]) });
      this.o.board.log(c.id, 'state', 'seismic', this.o.board.t.worker.landingOverlap(notice.subjects, files));
    }));
  }

  /**
   * Approved work that changed nothing in the repository: nothing lands, and the card is `done`.
   * Its worker hears so and may finish what remains, as after a landing. Returns what it hears of
   * its demo's page.
   */
  close(cardId: string, by: 'owner' | 'worker', comments?: Comments): string {
    
    if (by === 'owner') this.o.onApproval?.(cardId);
    this.bump(cardId);
    const page = this.pageNote(cardId);
    this.o.board.work(cardId, { state: 'done', need: null, detail: null, status_line: null, approved_at: null, review: { pr: null }, landed: JSON.stringify({ unchanged: true, ...(page.waits ? { page: true } : {}) } satisfies LandedState) });
    const t = this.o.board.t.worker;
    const folder = !!this.folder?.changed(cardId).length;
    
    this.folder?.done(cardId);
    this.o.board.log(cardId, 'state', by, by === 'owner' ? (folder ? t.approvedFolder : t.approvedUnchanged) : t.doneUnchanged);
    
    if (by === 'owner')
      this.afterLanding(
        cardId,
        [
          folder ? 'The owner approved your work. Your changes stay in the folder as they are, and the card is done: they can no longer be undone from the card.' : 'The owner approved your work. It changed nothing in the repository, so nothing lands and there is no pull request: the card is done.',
          page.text,
          comments?.text ?? '',
          this.folder ? AFTER_DONE : workerConfig.afterLanding,
        ]
          .filter(Boolean)
          .join('\n\n'),
        comments?.images,
        true,
      );
    return page.text;
  }

  /**
   * What the worker of work that landed (or closed) hears about its demo's page, which it links
   * wherever it points people at the work (an issue it closes, say), and whether it waits for that
   * page to go out: Seismic tells it the address once the page is online (`pageSettled`). Without a
   * page, it hears so, and asks the owner rather than leave the link out.
   */
  private pageNote(cardId: string): { text: string; waits?: boolean } {
    const card = this.card(cardId);
    if (!card.demo?.latest || card.idea?.prototypeOf) return { text: '' };
    this.pageHeard(cardId);
    const ask = 'Before you point anyone to your demo (an issue you close, say), ask the owner for a link.';
    if (!this.shares) return { text: `This repository has no demo site, so your demo is on no page the team can open. ${ask}` };
    const s = card.demo?.share;
    if (s?.state === 'publishing')
      return { text: 'Your demo is going out on a page of its own for the team right now. Seismic tells you its address once it is online: wait for that before you link the demo anywhere (an issue you close, say).', waits: true };
    if (s?.state === 'shared' && s.url)
      return {
        text: s.stale
          ? `Your demo's page for the team shows an earlier demo of yours, not the latest: ${s.url}. Link it wherever you point people at this work (an issue you close, say), or ask the owner to share the latest first.`
          : `Your demo is shared with the team on a page of its own: ${s.url}. Link it wherever you point people at this work (an issue you close, say).`,
      };
    return { text: `Your demo is not shared on a page the team can open. ${ask}` };
  }

  /**
   * The card's demo page went out (`url`), or did not (`why`): landed work's worker that waits for
   * it hears so, and its session ends once it has done what that leads to.
   */
  pageSettled(cardId: string, r?: { url: string } | { why: string }) {
    if (!this.o.board.card(cardId)) return;
    const l = workerConfig.landedOf(this.o.board.row(cardId));
    if (!l?.page) return;
    const { page: _, ...rest } = l;
    this.o.board.work(cardId, { landed: JSON.stringify(rest satisfies LandedState) });
    if (r) this.pageHeard(cardId);
    this.deliver(
      cardId,
      !r
        ? this.pageNote(cardId).text
        : 'url' in r
          ? `Your demo is online on a page of its own for the team: ${r.url}. Link it wherever you point people at this work (an issue you close, say).`
          : `Your demo's page did not go out (${r.why}); the owner sees why on the card. Before you point anyone to your demo (an issue you close, say), ask the owner for a link.`,
    );
  }

  /**
   * What became of the card's demo page since its worker last heard of it: the owner shared it or
   * stopped sharing it, a share went online or failed. The worker hears it with its next message or
   * tool step (no turn of its own: nothing waits on it), so it knows where its demo is when the
   * owner asks, and where Seismic links it once the work lands.
   */
  pageNews(cardId: string): string | undefined {
    const card = this.o.board.item(cardId);
    if (!card || card.idea?.prototypeOf || !card.demo?.latest) return;
    const now = pageHeardOf(card.demo.share);
    const row = this.o.board.row(cardId);
    const before: PageHeard = row.demo?.pageHeard ?? { page: 'none' };
    if (JSON.stringify(now) === JSON.stringify(before)) return;
    this.o.board.work(cardId, { demo: { pageHeard: now } });
    if (now.page === 'going') return 'The owner is sharing your demo with the team on a page of its own; it is going online right now. You hear its address once it is there.';
    if (now.page === 'online') {
      const trailer = card.demo.latest.kind === 'html' ? 'Demo-Page' : 'Demo-Video';
      return [
        `The owner shared your demo with the team on a page of its own: ${now.url}.`,
        now.stale ? 'It shows an earlier demo of yours, not the latest.' : '',
        contributionOf(row)
          ? 'Once the owner approves, Seismic comments its link on the pull request.'
          : `Seismic links it in what your work lands with: a \`${trailer}: <url>\` trailer on the commit that lands on main, or a line in the pull request's description.`,
        'Link it wherever you point people at this work (an issue you close, say).',
      ]
        .filter(Boolean)
        .join(' ');
    }
    if (before.page === 'going' && !card.demo?.share?.url) return 'Sharing your demo did not work (the owner sees why on the card): it is on no page the team can open.';
    return 'The owner stopped sharing your demo: it is on no page the team can open any more.';
  }

  /** The worker has just heard where its demo's page stands (the landing's message, say): no news of it follows. */
  private pageHeard(cardId: string) {
    const card = this.o.board.item(cardId);
    if (card) this.o.board.work(cardId, { demo: { pageHeard: pageHeardOf(card.demo?.share) } });
  }

  /** A message that starts a turn, with what became of the demo's page before it. */
  private withPageNews(cardId: string, text: string): string {
    const news = this.pageNews(cardId);
    return news ? [news, text].filter(Boolean).join('\n\n') : text;
  }

  /**
   * Landed work's worker hears about it and may finish what remains (a migration, say) in its
   * workstation, which stays until then. Without a session to tell, the workstation goes at once.
   */
  private afterLanding(cardId: string, message: string, images: string[] = [], owner = false) {
    const row = this.o.board.row(cardId);
    if (!row.workstation || (!this.live.has(cardId) && !row.session_id)) return this.finish(cardId);
    this.deliver(cardId, message, images, owner);
  }

  /** Landed work's worker is done: its session ends and its workstation is freed. */
  private finish(cardId: string) {
    this.end(cardId);
    this.bump(cardId);
    const row = this.o.board.row(cardId);
    const worktree = this.inWorktree(cardId);
    
    const reading = this.reading.get(cardId);
    if (worktree) {
      if (reading) void reading.finally(() => this.removeTree(row.workstation));
      else this.removeTree(row.workstation);
    } else if (row.workstation) {
      const removeLanded = () => this.o.workstations.removeLanded(cardId, row.branch ?? '');
      
      this.whileFreeing(cardId, row.workstation, reading ? reading.catch(() => {}).then(removeLanded) : removeLanded(), 'freeing a landed workstation');
    }
    const landed = workerConfig.landedOf(row);
    this.o.board.work(cardId, { landed: null, workstation: null, status_line: null, parked: null, ...this.o.board.unheld(cardId, AGENT_HOLDS), app: null, ...(row.state === 'waiting' ? { state: landed?.unchanged ? 'done' : 'live', need: null, detail: null } : {}) });
    this.o.board.workDone(cardId);
    
    if (!landed?.followUp) this.o.onWorkEnded?.(cardId, row.workstation);
  }

  /** The plan docs the card's branch adds, as plan references of the project. */
  private async planDocsAdded(cardId: string): Promise<string[]> {
    
    if (!this.o.board.row(cardId).idea?.discussion || outsidePlanDir(this.o.adapter.planDocs.dir)) return [];
    const home = !this.o.repo || this.o.repo === this.o.board.home;
    return (await this.o.workstations.addedFiles(cardId, this.o.adapter.planDocs.dir))
      .filter((f) => f.endsWith('.md') && !this.o.adapter.planDocs.exclude.some((x) => f.endsWith(`/${x}`)))
      .map((f) => (home ? f : `${this.o.repo}:${f}`));
  }

  /**
   * A prototype has served its purpose, whatever its state: its worker stops and the card goes into
   * the archive with its log, demo and summary. Discarded, its workstation and branch are thrown away;
   * built, they went to its idea, or the workstream `into`, before (`buildOn`). Git cleans the
   * workstation in the background; it is free once git is done.
   */
  endPrototype(cardId: string, end: 'discarded' | 'built', by: 'owner' | 'seismic' = 'owner', into?: string) {
    const card = this.card(cardId);
    if (!card.idea?.prototypeOf) throw new BadRequest('notPrototype', 'not a prototype');
    this.o.onWorkEnded?.(cardId, this.o.board.row(cardId).workstation);
    this.end(cardId);
    this.bump(cardId);
    this.o.board.work(cardId, this.o.board.unheld(cardId, AGENT_HOLDS));
    const workstation = this.o.workstations.leasedBy(cardId);
    const { branch } = this.o.board.row(cardId);
    
    if (workstation) this.whileFreeing(cardId, workstation, this.o.workstations.discard(cardId, branch ?? ''), 'discarding a prototype');
    const idea = this.o.board.card(card.idea.prototypeOf);
    const t = this.o.board.t.worker;
    this.o.board.log(cardId, 'state', by, end === 'discarded' ? t.prototypeDiscarded : into ? t.prototypeBuiltInto(into) : t.prototypeBuilt(idea?.title ?? ''));
    this.o.board.endPrototype(cardId, end, into);
    if (end === 'discarded' && this.o.board.item(card.idea.prototypeOf)) this.o.board.log(card.idea.prototypeOf, 'state', by, t.prototypeDiscardedOnIdea(card.title));
  }

  /**
   * The idea, or the workstream `into` names of the plan it became, is built on this prototype:
   * its workstation and branch (renamed for that card) go to the card, which names them before the
   * prototype ends as built (a lease its card does not name is freed). Settles with the workstation
   * and branch the card has now, once git has renamed the branch.
   */
  buildOn(prototypeId: string, idea: Item, into?: string): Promise<{ path: string; branch: string }> {
    const { workstation, branch } = this.o.board.row(prototypeId);
    if (!workstation || !branch) throw new BadRequest('noWorkstation', 'the prototype has no workstation to build on');
    const built = asBadRequestAsync(this.o.workstations.transfer(prototypeId, idea.id, branch, branchName(idea.title, idea.id))).then((moved) => {
      this.o.board.work(idea.id, { workstation: moved.path, branch: moved.branch, idea: { builtOn: prototypeId } });
      this.endPrototype(prototypeId, 'built', 'owner', into);
      return moved;
    });
    
    this.whileFreeing(prototypeId, workstation, built, 'building on a prototype');
    return built;
  }

  /**
   * What the card's work changes: once it landed, what the landing put on the default branch;
   * before, its branch in its workstation so far. Null when neither is there to read.
   */
  diff(cardId: string, full: boolean): Promise<CardDiff | null> {
    const row = this.o.board.row(cardId);
    const shipped = row.shipped ? (JSON.parse(row.shipped) as Shipped) : null;
    
    if (row.state === 'live' && shipped?.commit && shipped.base) return this.o.workstations.landedDiff(shipped.base, shipped.commit, full);
    return this.o.workstations.diff(cardId, full);
  }

  /**
   * One file of the card's change before and after (`CardWorkstations.versionsOf`), for the diff to
   * expand the lines around its hunks; only a file `changedFiles` names, never any other file of the
   * workstation. Null where there is none to show.
   */
  async fileVersions(cardId: string, asked: string): Promise<FileVersions | null> {
    const path = normalPath(asked);
    if (!path) return null;
    const row = this.o.board.row(cardId);
    const shipped = row.shipped ? (JSON.parse(row.shipped) as Shipped) : null;
    const landed = row.state === 'live' && shipped?.commit && shipped.base ? { base: shipped.base, commit: shipped.commit } : undefined;
    const changed = await this.o.workstations.changedFiles(cardId, landed);
    return changed.includes(path) ? this.o.workstations.versionsOf(cardId, path, landed) : null;
  }

  /** The files of the card's change as they are now, as `diff` reads it, by a list no file name can pass for another in (`CardWorkstations.changedFiles`). */
  changedFiles(cardId: string): Promise<string[]> {
    const row = this.o.board.row(cardId);
    const shipped = row.shipped ? (JSON.parse(row.shipped) as Shipped) : null;
    if (row.state === 'live' && shipped?.commit && shipped.base) return this.o.workstations.changedFiles(cardId, { base: shipped.base, commit: shipped.commit });
    return this.o.workstations.changedFiles(cardId);
  }

  /**
   * A file of the card's work, as its left column shows it: only one its change made or changed
   * (`changedFiles`), or an image a Markdown file of it shows from beside it, never any other file
   * of the workstation or the folder, nor a link standing for one. From its workstation (or the folder)
   * while it has one here, else from the commit it landed with or its branch. `local`: a file on
   * disk to open, for a landed card the checkout's copy. Null where it is none of those, or nothing
   * holds it.
   */
  async file(cardId: string, asked: string, local = false): Promise<FileAt | null> {
    const path = normalPath(asked);
    if (!path) return null;
    const row = this.o.board.row(cardId);
    const shipped = row.shipped ? (JSON.parse(row.shipped) as Shipped) : null;
    const landed = row.state === 'live' && shipped?.commit ? shipped.commit : undefined;
    
    const ref = landed ?? (local ? undefined : (row.branch ?? undefined));
    
    const beside = (row.demo?.files ?? []).find((f) => f.dir && f.path === path);
    if (beside) return ownFile(beside.dir!, path);
    const changed = await this.changedFiles(cardId);
    const at = (p: string, onDisk = local) => this.o.workstations.fileOf(cardId, p, ref, onDisk);
    if (changed.includes(path)) return at(path);
    if (!isImage(path)) return null;
    for (const doc of changed.filter((p) => fileKind(p) === 'markdown')) {
      const md = await at(doc, false);
      const text = md && ('path' in md ? await Bun.file(md.path).text() : new TextDecoder().decode(md.data));
      if (text && docImages(doc, text).includes(path)) return at(path);
    }
    return null;
  }

  




  /**
   * What a handover says of the data its change persists, against what its branch shows: 'changed'
   * needs the schema-change page among the files (named now, else those named before); 'unchanged'
   * where the branch shows signs of a model change is refused once for those files, and taken the
   * next time, with its reason for the owner (`unchanged`). Without a declaration (a session from
   * before the field), only the signs count.
   */
  dataModels(cardId: string, declared: unknown, why: unknown, named: CardFile[] | undefined, signals: DataSignal[]): { refused: string } | { unchanged?: string } {
    const reason = clip(String(why ?? '').replace(/\s+/g, ' ').trim(), 300);
    const section = `${this.demoSkill(cardId)}, its section "A change to persisted data models"`;
    if (declared === 'unchanged' && !reason) return { refused: "Not handed over: data_models 'unchanged' takes its reason, in one line (data_models_reason). Call ready_for_review again with it." };
    if (declared === 'changed') {
      const files = named ?? this.o.board.row(cardId).demo?.files ?? [];
      if (files.some((f) => isSchemaPage(f.path))) return {};
      return {
        refused: `Not handed over: your change alters persisted data models, and no schema-change page is among the files. Render it as ${section} says, name it first in files by its absolute path in your demo's directory, then call ready_for_review again.`,
      };
    }
    if (!signals.length) return {};
    const tripped = signals.map((s) => s.file);
    const bounced = this.dataBounced.get(cardId);
    if (declared === 'unchanged' && bounced && tripped.every((f) => bounced.has(f))) return { unchanged: reason };
    this.dataBounced.set(cardId, new Set([...(bounced ?? []), ...tripped]));
    const listed = signals.slice(0, SIGNALS_NAMED).map((s) => `${s.file} (${s.why})`);
    return {
      refused: `Not handed over: your branch looks like it alters persisted data models: ${listed.join(', ')}${signals.length > SIGNALS_NAMED ? `, and ${signals.length - SIGNALS_NAMED} more` : ''}. If it does, render the schema-change page as ${section} says, name it first in files, and call ready_for_review again with data_models 'changed'. If it does not, call ready_for_review again with data_models 'unchanged' and the reason in data_models_reason: the card shows it to the owner.`,
    };
  }

  async namedFiles(cardId: string, files: { path: string; caption: string }[], demoDir?: string): Promise<CardFile[] | string> {
    const row = this.o.board.row(cardId);
    const ws = (row.workstation ?? '').replace(/^ssh:\/\/[^/]+/, '');
    const roots = [ws, ...(ws && !hostName(row.workstation) ? [realpathOr(ws)] : [])].filter(Boolean);
    const shown = demoDir ?? row.demo?.latest?.dir;
    
    const onHost = !!demoDir && !!hostName(row.workstation);
    const demoRoots = shown ? [...new Set([shown, ...(onHost ? [] : [realpathOr(shown)])])] : [];
    const changed = await this.changedFiles(cardId);
    const out: CardFile[] = [];
    for (const f of files) {
      let given = String(f.path).trim().replace(/\\/g, '/');
      const caption = clip(String(f.caption ?? '').replace(/\s+/g, ' ').trim(), 200);
      const dir = demoRoots.find((r) => given.startsWith(`${r.replace(/\\/g, '/')}/`));
      if (dir) {
        const path = normalPath(given.slice(dir.length + 1));
        if (!path || (!onHost && !ownFile(dir, path))) return `${f.path} is no file in your demo's directory`;
        if (changed.includes(path)) return `${f.path} has the path of a file of your change (${path}); give it another name`;
        if (!out.some((o) => o.path === path)) out.push({ path, caption, dir: shown! });
        continue;
      }
      const root = roots.find((r) => given.startsWith(`${r}/`));
      if (root) given = given.slice(root.length + 1);
      const path = isAbsolute(given) ? null : normalPath(given);
      if (!path || !changed.includes(path))
        return `${f.path} is not among the files your card made or changed${changed.length ? ` (${changed.slice(0, 30).join(', ')}${changed.length > 30 ? ', …' : ''})` : ' (none so far)'}${shown ? `, nor in your demo's directory (${shown})` : ''}`;
      if (!out.some((o) => o.path === path)) out.push({ path, caption });
    }
    return out;
  }

  /**
   * The card's pull request was merged, with `commit` the merge put on the base branch where GitHub
   * said: the work is live, the workstation free.
   */
  merged(cardId: string, commit?: string, note = this.o.board.t.worker.merged, comments?: Comments) {
    this.bump(cardId);
    this.refuseAsked(cardId, 'meanwhile your pull request was merged, and the card is live.');
    
    if (contributionOf(this.o.board.row(cardId)) && this.pulls()) void this.pullAfterMerge(cardId);
    
    const added = Promise.all([
      this.planDocsAdded(cardId).then((a) => this.o.board.planDocsLanded(cardId, a)),
      commit ? this.o.workstations.noticeMerged?.(cardId, commit) : undefined,
    ]).then(() => {});
    this.reading.set(cardId, added);
    void added.finally(() => this.reading.get(cardId) === added && this.reading.delete(cardId));
    const pr = this.o.board.row(cardId).review?.pr;
    const { url, number } = pr ?? { url: null, number: undefined };
    const shipped: Shipped = { ...(commit ? { commit, base: `${commit}^` } : { fetch: true }), ...(url && number ? { pr: { url, number } } : {}) };
    const page = this.pageNote(cardId);
    this.o.board.work(cardId, {
      state: 'live',
      need: null,
      detail: null,
      status_line: null,
      landed: JSON.stringify({ ...(commit ? { commit } : {}), ...(page.waits ? { page: true } : {}) } satisfies LandedState),
      shipped: JSON.stringify(shipped),
    });
    this.o.board.record(cardId, 'landed', 'seismic');
    this.o.board.log(cardId, 'state', 'seismic', note);
    this.extensionEvent('landed', cardId);
    this.o.onMerged?.(cardId);
    const review = !!contributionOf(this.o.board.row(cardId));
    this.afterLanding(
      cardId,
      [review ? 'The owner approved your handover, and Seismic merged the pull request; the card is live. Leave the PR as it is: Seismic comments the demo’s link on it.' : 'Your pull request was merged; the card is live.', page.text, comments?.text ?? '', workerConfig.afterLanding].filter(Boolean).join('\n\n'),
      comments?.images,
      !!comments,
    );
  }

  /**
   * The checkout's main around a review card's merge (`WorkerOptions.pulls`), where work lands on
   * the local main of a repository with a remote; none elsewhere.
   */
  private pulls() {
    return this.o.adapter.land === 'main' && this.o.remote ? this.o.pulls : undefined;
  }

  /**
   * The local main gets a review card's merge from the remote; the card's log says how it went.
   * Where its unpushed commits stop the pull on a conflict, a worker resolves it (`resolvePull`).
   */
  private async pullAfterMerge(cardId: string) {
    const t = this.o.board.t.worker;
    const r = await this.pulls()!.pullMain().catch((e: unknown) => ({ problem: messageOf(e) }));
    if (!this.o.board.card(cardId)) return;
    if ('stopped' in r) return this.resolvePull(cardId, r.stopped);
    if ('problem' in r) this.o.board.log(cardId, 'error', 'seismic', t.pullFailed(r.problem));
    else this.pulled(cardId, r.to);
  }

  /** The local main has a review card's merge now: its log says so, the read checkout reads it, and the other review cards look again at what the move means for them. */
  private pulled(cardId: string, commit: string) {
    this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.worker.pulledMain(commit.slice(0, 7)));
    this.o.onMerged?.(cardId);
    this.reprobeClashes();
  }

  /**
   * Whether pulling a review card's PR, once merged, into the local main would stop on a conflict
   * with its unpushed commits (`Workstations.clashBeforeMerge`), named with the card that landed the
   * commit it stops at. Kept on the card for the owner to see before the merge; undefined where it
   * cannot tell (no head reviewed yet, git failed), which leaves what the card shows.
   */
  async probeClash(cardId: string): Promise<Clash | null | undefined> {
    const pulls = this.pulls();
    const c = contributionOf(this.o.board.row(cardId));
    if (!pulls || !c?.reviewed) return undefined;
    let clash: Clash | null;
    try {
      const found = await pulls.clashBeforeMerge(cardId, c.reviewed);
      clash = found && { ...found, ...(await this.landedBy(found.commit)) };
    } catch (e) {
      console.error(`probing ${cardId}'s pull request against the local main:`, messageOf(e));
      return undefined;
    }
    const now = this.o.board.card(cardId) && contributionOf(this.o.board.row(cardId));
    if (!now || now.reviewed !== c.reviewed) return clash;
    if (!sameClash(now.clash, clash)) {
      const { clash: _, ...rest } = now;
      this.o.board.work(cardId, { review: { contribution: { ...rest, ...(clash ? { clash } : {}) } satisfies StoredContribution } });
    }
    return clash;
  }

  /**
   * "Push main, adapt the PR" on a review card whose PR collides with unpushed commits on the
   * local main: once the undo window is through (`keepMainFor` takes it back), the local main goes
   * to `origin` (`Workstations.pushMain`), so the PR now conflicts there, and the card's worker brings
   * the PR up to date with it, itself where the contributor allows maintainers' edits, else by a
   * change request to them. A push that fails says why on the card, which stays with the owner.
   */
  pushMainFor(cardId: string) {
    const i = this.o.board.item(cardId);
    const c = contributionOf(this.o.board.row(cardId));
    if (!i || !c?.clash || !handedOver(i) || !this.pulls()) throw new BadRequest('noClash', 'the card’s pull request collides with nothing unpushed on main');
    if (this.pushingMain.has(cardId) || this.approving.has(cardId)) throw new BadRequest('notReady', 'the card is busy with main already');
    this.pushingMain.set(
      cardId,
      setTimeout(() => {
        this.pushingMain.set(cardId, true);
        void this.pushMainNow(cardId).finally(() => this.pushingMain.delete(cardId));
      }, this.o.pushHold ?? PUSH_HOLD_MS),
    );
  }

  /** The owner takes back "Push main, adapt the PR" within its undo window: nothing happened. */
  keepMainFor(cardId: string) {
    const held = this.pushingMain.get(cardId);
    if (!held || held === true) throw new BadRequest('noClash', 'main is not waiting to be pushed for this card');
    clearTimeout(held);
    this.pushingMain.delete(cardId);
  }

  private async pushMainNow(cardId: string) {
    const t = this.o.board.t.worker;
    const r = await this.pulls()!.pushMain().catch((e: unknown) => ({ problem: messageOf(e) }));
    if (!this.o.board.item(cardId)) return;
    if ('problem' in r) {
      this.o.board.log(cardId, 'error', 'seismic', t.pushFailed(r.problem));
      return;
    }
    this.o.onMerged?.(cardId);
    this.reprobeClashes();
    const c = contributionOf(this.o.board.row(cardId));
    if (!c) return;
    const files = c.clash?.files ?? [];
    const { clash: _, ...rest } = c;
    this.o.board.work(cardId, { review: { contribution: { ...rest, ...(c.canModify ? { changing: true as const } : {}) } satisfies StoredContribution }, state: 'working', need: null, detail: null, status_line: null });
    this.o.board.log(cardId, 'state', 'owner', t.pushedMain(r.to.slice(0, 7), c.number));
    this.deliver(
      cardId,
      [
        `The owner had Seismic push the local main to origin (${r.to.slice(0, 7)} there now): its commits nobody had pushed yet collide with this pull request${files.length ? ` in ${files.join(', ')}` : ''}, so the pull request now conflicts with origin's main. Bring it up to date with origin's main, so that both changes keep working.`,
        c.canModify
          ? `${c.author} allows maintainers' edits: merge origin's main into your branch, which is the PR's head (a merge, not a rebase: Seismic pushes onto the PR's branch only what builds on its head), resolve the conflict, run the checks and commit. Then review the new head as before (the checks, the merge probe; a new demo only where what the pull request does looks different now) and hand over again with pr_draft saying what you changed and why: Seismic pushes it onto the PR's branch and posts the text once the owner approves.`
          : `${c.author} does not allow maintainers' edits: ask them with request_changes, in the PR's language, to bring the PR up to date with main${files.length ? ` (the conflict is in ${files.join(', ')})` : ''}. The card then waits for them, and you review their push as any other.`,
      ].join('\n\n'),
      [],
      true,
    );
  }

  /** A review card waiting for the owner looks again at whether its PR collides with what is unpushed on the local main (`probeClash`), as each round of the PR watcher has it do. */
  recheckClash(cardId: string) {
    const i = this.o.board.item(cardId);
    if (i && handedOver(i) && !answering(i) && !this.approving.has(cardId)) void this.probeClash(cardId);
  }

  /**
   * The local main moved, or may have while Seismic was not running: each review card waiting for the
   * owner looks again at whether its PR collides with what is unpushed on it.
   */
  private reprobeClashes() {
    if (!this.pulls()) return;
    for (const i of this.o.board.items()) if (i.review?.contribution && (!this.o.repo || i.repo === this.o.repo) && handedOver(i) && !answering(i)) void this.probeClash(i.id);
  }

  /** The card whose landing put `commit` on the default branch, where one did. */
  private async landedBy(commit: string): Promise<{ card?: { id: string; title: string } }> {
    const landed = this.o.board
      .items()
      .filter((i) => finished(i.state) && !i.review?.contribution && (!this.o.repo || i.repo === this.o.repo))
      .flatMap((i) => {
        const row = this.o.board.row(i.id);
        const s = row.shipped ? (JSON.parse(row.shipped) as Shipped) : null;
        return s?.commit && s.base && !s.pr ? [{ card: i, base: s.base, commit: s.commit, at: row.updated_at }] : [];
      })
      
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 100);
    const at = await this.pulls()!.landingOf(commit, landed);
    const card = landed[at]?.card;
    return card ? { card: { id: card.id, title: card.title } } : {};
  }

  /**
   * Pulling review card `reviewId`'s merged PR into the local main stopped on a conflict with its
   * unpushed commits (`stopped`), and was taken back. Those commits were never pushed, so a worker
   * may rebase them onto the remote's main: the worker of the card whose commit conflicts, else the
   * review card's own, each while its session can go on (finishing after its landing, or resumed in
   * a fresh workstation as for a question). It hands over the resolution, which lands without the
   * owner (`landResolved`). Where no worker can take it, the review card says what is left to do.
   */
  private async resolvePull(reviewId: string, stopped: PullStopped) {
    const t = this.o.board.t.worker;
    const c = contributionOf(this.o.board.row(reviewId));
    if (!c) return;
    const { card } = await this.landedBy(stopped.commit);
    const resolving: Resolving = { card: reviewId, pr: c.number, url: c.url, stopped };
    
    const takes = (id: string) => {
      const i = this.o.board.item(id);
      const l = i && workerConfig.landedOf(this.o.board.row(id));
      return !!i && i.kind === 'task' && !i.idea?.prototypeOf && !i.archivedAt && !l?.resolve && ((!!l && !!i.agent?.finishing) || askable(i));
    };
    const resolver = [card?.id, reviewId].find((id) => !!id && takes(id));
    if (!resolver) {
      this.o.board.log(reviewId, 'error', 'seismic', t.pullUnresolved(stopped.subject, stopped.files.join(', '), t.noResolver));
      return;
    }
    const own = resolver !== reviewId;
    this.o.board.log(reviewId, 'state', 'seismic', t.pullStopped(stopped.subject, own ? this.card(resolver).title : null));
    if (own) this.o.board.log(resolver, 'state', 'seismic', t.resolvingPull(c.number, stopped.subject));
    const message = (path: string) => this.resolveMessage(resolving, own, path);
    const item = this.card(resolver);
    const landed = workerConfig.landedOf(this.o.board.row(resolver));
    if (landed && item.agent?.finishing) {
      this.o.board.work(resolver, { landed: JSON.stringify({ ...landed, resolve: resolving } satisfies LandedState), status_line: t.resolvingStatus(c.number) });
      this.deliver(resolver, message(this.o.board.row(resolver).workstation ?? ''));
      return;
    }
    
    const failed = () => {
      if (this.o.board.card(resolver)) this.o.board.work(resolver, { status_line: null });
      if (this.o.board.card(reviewId)) this.o.board.log(reviewId, 'error', 'seismic', t.pullUnresolved(stopped.subject, stopped.files.join(', '), t.noResolver));
    };
    try {
      this.resumeFinished(item, { resolve: resolving }, (path, worktree) => [message(path), ...(worktree ? [IN_WORKTREE] : [])].join('\n\n'), [], undefined, failed);
      this.o.board.work(resolver, { status_line: t.resolvingStatus(c.number) });
    } catch (e) {
      console.error(`resuming ${resolver} to resolve the pull:`, messageOf(e));
      failed();
    }
  }

  /** What the worker that resolves a stopped pull hears: what stopped, and how to rebase and hand it over. */
  private resolveMessage(r: Resolving, own: boolean, path: string): string {
    const s = r.stopped;
    const repo = this.o.repoPath ?? 'the Seismic checkout';
    const checks = this.o.adapter.checks ?? [];
    const commits = s.unpushed === 1 ? 'one commit' : `${s.unpushed} commits`;
    return [
      `Seismic merged pull request #${r.pr} (${r.url}) on the forge, but pulling the merge into the local main of the Seismic checkout (${repo}) stopped on a conflict: the local main has ${commits} nobody pushed yet, and ${own ? 'the commit of your card' : 'its commit'} ${s.commit.slice(0, 7)} (“${s.subject}”) conflicts with the pull request in ${s.files.join(', ')}. Seismic took the pull back: the local main is as it was, at ${s.main.slice(0, 7)}.`,
      `Those commits were never pushed, so you may rebase them: that rewrites no published history. Resolve it in your workstation (${path}):`,
      [
        `1. Put a branch of your own at the local main as it stood: git checkout -B <branch> ${s.main}. Commit what you still have in the workstation first. Where the workstation lacks those commits, fetch them from the checkout first: git fetch ${repo} ${s.main} ${s.upstream}.`,
        `2. Rebase it onto ${s.upstream}, origin's main with the merge: git rebase ${s.upstream}. Resolve each conflict so that both the pull request's change and the local commits keep doing what they did.`,
        `3. Run ${checks.length ? `the checks (${checks.map((x) => `\`${x}\``).join(', ')})` : 'the repository’s checks'}.`,
        '4. Call ready_for_review with a summary of how you resolved it, without a demo. Seismic then puts the local main at your HEAD, with whatever landed on it meanwhile on top. Do not push.',
      ].join('\n'),
      'Where the two changes contradict each other so that resolving it is a product decision, ask the owner.',
    ].join('\n\n');
  }

  /** The unpushed commits on the local main were rebased (`rewritten`, each old commit by its new one): the cards that landed them name the new ones. */
  private reshipped(rewritten: Record<string, string>) {
    for (const i of this.o.board.items()) {
      if (this.o.repo && i.repo !== this.o.repo) continue;
      const row = this.o.board.row(i.id);
      const s = row.shipped ? (JSON.parse(row.shipped) as Shipped) : null;
      const commit = s?.commit && rewritten[s.commit];
      if (!s || !commit) continue;
      this.o.board.work(i.id, { shipped: JSON.stringify({ ...s, commit, ...(s.base && rewritten[s.base] ? { base: rewritten[s.base] } : {}) } satisfies Shipped) });
    }
  }

  /**
   * The worker handed over the stopped pull it resolved (`resolvePull`): the checkout's main goes to
   * its workstation's `HEAD`, and the review card's log says main has its merge. Returns what the
   * worker hears; what is in its workstation's way it fixes, what is in the checkout's goes to the owner.
   */
  async landResolved(cardId: string, r: Resolving): Promise<string> {
    const t = this.o.board.t.worker;
    const row = this.o.board.row(cardId);
    const res = await this.pulls()!.landResolution(row.workstation ?? '', { main: r.stopped.main, upstream: r.stopped.upstream });
    const landed = workerConfig.landedOf(this.o.board.row(cardId));
    const { resolve: _, ...rest } = landed ?? {};
    const done = () => this.o.board.work(cardId, { landed: JSON.stringify(rest satisfies LandedState), status_line: null });
    if ('code' in res) {
      if (res.worker) {
        if (res.main && landed?.resolve) this.o.board.work(cardId, { landed: JSON.stringify({ ...landed, resolve: { ...landed.resolve, stopped: { ...landed.resolve.stopped, main: res.main } } } satisfies LandedState) });
        return `Not landed: ${res.detail}. Fix that, then call ready_for_review again.`;
      }
      done();
      if (this.o.board.card(r.card)) this.o.board.log(r.card, 'error', 'seismic', t.pullFailed(res.detail));
      this.o.board.log(cardId, 'error', 'seismic', t.pullFailed(res.detail));
      return `Not landed: ${res.detail}. That is in the Seismic checkout, not in your work: the owner sees it on the card. End your turn.`;
    }
    done();
    if ('rewritten' in res) this.reshipped(res.rewritten);
    const to = 'already' in res ? res.already : res.to;
    if (!('already' in res)) this.o.board.log(cardId, 'state', 'worker', t.resolvedPull(r.pr, to.slice(0, 7)));
    if (this.o.board.card(r.card)) this.pulled(r.card, to);
    return 'already' in res
      ? `The local main has the merge already (${to.slice(0, 7)}): someone pulled it meanwhile, so nothing of yours is needed. End your turn.`
      : `Landed: the local main is at ${to.slice(0, 7)} now, the pull request's merge under its unpushed commits. End your turn.`;
  }

  /** Passes what happened on the pull request to the worker; the owner's log gets `note`. */
  prEvent(cardId: string, note: string, message: string) {
    this.o.board.log(cardId, 'state', 'seismic', note);
    this.deliver(cardId, message);
  }

  /** The pull request was closed without a merge: the owner decides what happens. */
  prClosed(cardId: string) {
    const t = this.o.board.t.worker;
    this.o.board.log(cardId, 'state', 'seismic', t.prClosed);
    this.toOwner(cardId, {
      text: t.prClosedQuestion,
      options: [t.reopen, t.discardWork],
    });
  }

  /**
   * The owner stops the card's worker: the card is planned again at once. Its workstation stays with
   * it where it holds work, so that starting again goes on from there, and is given back otherwise
   * once git has told (`hasWork`, without blocking the server), unless the card started again meanwhile.
   */
  stop(cardId: string): Promise<void> {
    const card = this.card(cardId);
    if (this.landingActive.has(cardId)) throw new BadRequest('notReady', 'the work is already landing');
    if (card.agent?.finishing) {
      this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.stopped);
      this.finish(cardId);
      return Promise.resolve();
    }
    if (card.state !== 'working' && card.state !== 'waiting') throw new BadRequest('noAgent', 'no agent works on this card');
    
    this.takeHeld(cardId);
    
    this.reviews.cancel(cardId);
    this.end(cardId);
    this.bump(cardId);
    const generation = this.generation.get(cardId);
    const path = this.o.board.row(cardId).workstation;
    const stoppedAt = stoppedAtOf(card);
    this.o.board.work(cardId, { state: 'planned', need: null, ...this.keepingConflict(cardId), review: { pr: null }, ...this.o.board.unheld(cardId, AGENT_HOLDS), app: null, stopped_at: JSON.stringify(stoppedAt) });
    this.o.board.log(cardId, 'state', 'owner', card.review?.pr ? this.o.board.t.worker.stoppedPrOpen(card.review.pr.number) : this.o.board.t.worker.stopped);
    return this.o.workstations.hasWork(cardId).then((keep) => {
      if (keep || this.generation.get(cardId) !== generation || this.o.board.row(cardId).workstation !== path) return;
      this.o.workstations.release(cardId);
      this.o.board.work(cardId, { workstation: null });
    });
  }

  /**
   * Whether the owner may take the card's workstation from it for another card (`evict`): a clone it
   * holds while at work, waiting for the owner, or stopped with work in it; not once its work has
   * landed, nor a prototype's.
   */
  evictable(cardId: string): boolean {
    if (this.o.workstations.mode !== 'clones' || this.evicting.has(cardId)) return false;
    
    let row: CardRow;
    try {
      row = this.o.board.row(cardId);
    } catch {
      return false;
    }
    const state = row.state ?? 'planned';
    return !!row.workstation && !row.landed && !row.idea?.prototypeOf && (state === 'working' || state === 'waiting' || state === 'planned');
  }

  /**
   * The owner takes the card's clone from it for a card waiting for one: its worker stops as with
   * `stop` (the card planned), the app there stops (`app.stop`, whatever `app.keep` says: another
   * card works there next), and its uncommitted work goes into a commit on its branch, which stays in
   * that clone (`kept_in`) until the card's next start takes it to the clone it gets then, the work
   * uncommitted again (`Workstations.evict`). Settles once the clone is free, with whether the card's
   * worker was on it (the Koordinator queues it again then); where git fails, the card keeps the
   * clone, as a stopped card with work does.
   */
  async evict(cardId: string): Promise<boolean> {
    if (!this.evictable(cardId)) throw new BadRequest('notEvictable', 'the card holds no clone that can be taken from it');
    const card = this.card(cardId);
    const active = card.state !== 'planned';
    const path = this.o.board.row(cardId).workstation!;
    this.evicting.add(cardId);
    try {
      
      const session = this.live.get(cardId)?.session;
      if (active) {
        
        this.takeHeld(cardId);
        this.end(cardId);
        this.o.board.work(cardId, { state: 'planned', need: null, ...this.keepingConflict(cardId), review: { pr: null }, ...this.o.board.unheld(cardId, AGENT_HOLDS), app: null, stopped_at: JSON.stringify(stoppedAtOf(card)) });
        this.o.board.record(cardId, 'stopped', 'owner');
      }
      this.bump(cardId);
      this.o.board.work(cardId, { status_line: this.o.board.t.worker.evicting });
      await Promise.race([session?.done.catch(() => {}), Bun.sleep(EVICT_SESSION_WAIT)]);
      
      await this.stopping.get(cardId)?.catch(() => {});
      const stop = this.o.adapter.app?.stop;
      if (stop) {
        const result = await runAppCommand(path, stop);
        if (!result.ok) this.o.board.log(cardId, 'error', 'seismic', this.o.board.t.worker.parkFailed(clip(result.output, 600)));
      }
      let kept: string | null;
      try {
        kept = await this.o.workstations.evict(cardId);
      } catch (e) {
        this.o.board.log(cardId, 'error', 'seismic', this.o.board.t.worker.evictFailed(messageOf(e)));
        return false;
      }
      
      this.o.board.work(cardId, { workstation: null, parked: null, app: null, ...(kept ? { kept_in: kept } : {}) });
      this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.evicted(path));
      return active;
    } finally {
      this.evicting.delete(cardId);
      if (this.o.board.row(cardId).status_line === this.o.board.t.worker.evicting) this.o.board.work(cardId, { status_line: null });
    }
  }

  /**
   * The owner pauses the card's worker while it is in a turn: its session ends at once, in the
   * middle of a step if need be, and whatever it ran with it (background work included). Card,
   * state, workstation, branch and session stay; the slot it held is free. It goes on where it stopped
   * once the owner resumes it or writes to it (`deliver`); what Seismic has for it meanwhile waits
   * until then, and its app is parked like a waiting card's. A worker taking in the owner's
   * words on its handover is paused the same way: the card still waits for approval, and the
   * worker finishes taking them in once it goes on.
   */
  pause(cardId: string) {
    const card = this.card(cardId);
    if (!pausableNow(card)) throw new BadRequest('noAgent', isPaused(card) ? 'the agent is paused already' : 'the agent is not working on anything');
    this.halt(cardId);
  }

  /**
   * The owner pauses the card's worker at a safe point (the card's pause, the project's): it hears so
   * and ends its turn once the step it is in is done, as for a restart, and is paused then as on
   * `pause`. Should it not have ended its turn after a while, it is paused at once. One with nothing
   * running that could be cut off midway (its workstation is being made ready, it waits for the usage
   * limit) is paused at once.
   */
  pauseAtSafePoint(cardId: string) {
    const card = this.card(cardId);
    if (!pausable(card)) throw new BadRequest('noAgent', halted(card) ? 'the agent is paused already' : 'the agent is not working on anything');
    const live = this.live.get(cardId);
    if (!live?.busy || live.limited) return this.halt(cardId);
    const limit = this.o.pauseLimit ?? PAUSE_LIMIT;
    this.o.board.work(cardId, { hold: holdNow('pausing') });
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.pausing);
    live.session.send(pauseNotice(limit));
    clearTimeout(this.pausing.get(cardId));
    this.pausing.set(
      cardId,
      setTimeout(() => {
        this.pausing.delete(cardId);
        if (this.o.board.holdOf(cardId)?.reason === 'pausing') this.halt(cardId);
      }, limit),
    );
  }

  /**
   * Pauses the card's worker: its session ends at once with whatever it ran, and the message it had
   * not taken in yet goes to it with the rest once it goes on.
   */
  private halt(cardId: string) {
    const pending = this.live.get(cardId)?.pending;
    this.end(cardId);
    this.bump(cardId);
    clearTimeout(this.reconnecting.get(cardId));
    this.reconnecting.delete(cardId);
    clearTimeout(this.pausing.get(cardId));
    this.pausing.delete(cardId);
    this.o.board.work(cardId, { hold: { reason: 'paused', since: new Date().toISOString(), ...(pending ? { held: [pending] } : {}) } satisfies Hold });
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.pausedByOwner);
    this.parkLater(cardId);
  }

  /**
   * The worker ended its turn while the owner waited for it to pause at a safe point: it is paused
   * now. What its turn did stands: words for the owner on its handover answer theirs, and work the
   * owner approved already lands once handed over.
   */
  private pausedAtSafePoint(cardId: string, card: Item, approved: boolean, handedOver: boolean, spoke: boolean) {
    if (answering(card) && (handedOver || spoke)) this.answerTaken(cardId, spoke);
    this.halt(cardId);
    if (handedOver && card.state === 'working' && approved) void this.landApproved(cardId);
  }

  /**
   * The owner lets the paused worker go on, whatever the card's state; it hears what came for it
   * meanwhile. One about to pause at a safe point hears that it works on instead.
   */
  resume(cardId: string) {
    const card = this.card(cardId);
    if (isPausing(card)) {
      this.pauseTakenBack(cardId);
      this.live.get(cardId)?.session.send(PAUSE_TAKEN_BACK);
      return;
    }
    const live = this.live.get(cardId);
    if (live?.limited) {
      this.deliver(cardId, LIMIT_LIFTED, [], true);
      return;
    }
    if (!isPaused(card)) throw new BadRequest('notPaused', 'the agent is not paused');
    this.deliver(cardId, '', [], true);
  }

  /** The coordinator's clock wakes a limit pause only at its recorded reset. */
  wakeLimit(cardId: string, now = Date.now()) {
    const hold = this.o.board.holdOf(cardId);
    if (hold?.reason !== 'limit' || !hold.until || Date.parse(hold.until) > now) return;
    this.deliver(cardId, LIMIT_LIFTED, [], true);
  }

  /** The owner lets the worker about to pause at a safe point go on after all (`resume`, or their words to it). */
  private pauseTakenBack(cardId: string) {
    clearTimeout(this.pausing.get(cardId));
    this.pausing.delete(cardId);
    this.o.board.work(cardId, this.o.board.unheld(cardId, ['pausing']));
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.resumedByOwner);
    const live = this.live.get(cardId);
    if (live) live.pauseHeld = false;
  }

  /**
   * A scratch Seismic's idle workers (`--idle-workers`): a script acts as the card's agent
   * (`scripts/scratch-seismic.ts --say`), for a check of what the owner sees while one works. Its
   * words go into the conversation as an agent's text does, and its tools (report, reply, ask,
   * ready_for_review, …) run as the agent's do, through the same code; no turn starts or ends by
   * itself, `end` ends the one under way as the agent would. A card without a session (one staged at
   * work) gets a stand-in for it. Returns what the agent would have read as the tool's result.
   */
  async standIn(cardId: string, act: { say: string } | { tool: string; args?: Record<string, unknown> } | { end: true } | { step: StandInStep }): Promise<string> {
    const card = this.card(cardId);
    const live = this.live.get(cardId);
    
    if ('end' in act) {
      if (live) this.onEvent(cardId, live, { type: 'idle' });
      if (this.standIns.delete(cardId)) this.o.board.changed();
      return 'Turn ended.';
    }
    
    if ('step' in act) {
      const s = act.step;
      const e: AgentEvent = s.type === 'tool' ? { type: 'tool', name: String(s.name), input: s.input ?? {} } : s.type === 'toolDone' ? { type: 'toolDone', name: String(s.name), ok: s.ok !== false } : s.type === 'text' ? { type: 'text', text: String(s.text ?? '') } : (undefined as never);
      if (!e) throw new BadRequest('invalid', 'a step is a tool call (tool), its end (toolDone) or words (text)');
      if (live) this.onEvent(cardId, live, e);
      else {
        let stand = this.standIns.get(cardId);
        if (!stand) {
          stand = { session: undefined!, host: null, handedOver: false, acted: true, nudged: false, lastText: '', busy: true, background: 0, tasks: new Map(), stalled: false, preferences: '', standIn: true };
          this.standIns.set(cardId, stand);
          this.o.board.changed();
        }
        this.follow(stand, e);
      }
      return 'Done.';
    }
    if ('say' in act) {
      const text = String(act.say).trim();
      if (!text) throw new BadRequest('emptyText', 'say must be a non-empty string');
      if (live) this.onEvent(cardId, live, { type: 'text', text });
      else this.o.board.log(cardId, 'say', 'worker', clip(text, 12000));
      return 'Shown on the card.';
    }
    const stand: Live = live ?? {
      session: undefined!,
      host: null,
      handedOver: false,
      acted: true,
      nudged: false,
      lastText: '',
      busy: false,
      background: 0,
      tasks: new Map(),
      stalled: false,
      preferences: '',
      standIn: true,
    };
    const tool = workerTools(this, cardId, stand, !!card.idea?.prototypeOf).find((t) => t.name === act.tool);
    if (!tool) throw new BadRequest('invalid', `the card's agent has no tool ${act.tool}`);
    
    const args = z.object(tool.schema).safeParse(act.args ?? {});
    if (!args.success) throw new BadRequest('invalid', `${act.tool}: ${args.error.message}`);
    
    if (live) live.acted = true;
    return await tool.run(args.data);
  }

  /**
   * The card of the project a worker means by `title`, to wait on: the one by that title (the open
   * one, of several), else the one whose title holds it, if only one does; else why there is none.
   */
  cardTitled(cardId: string, title: string): Item | string {
    const items = this.o.board.items().filter((i) => i.id !== cardId && i.kind !== 'plan');
    const key = titleKey(title);
    const exact = items.filter((i) => titleKey(i.title) === key);
    const pick = (of: Item[]) => of.findLast((i) => !i.archivedAt && !finished(i.state)) ?? of.at(-1)!;
    if (exact.length) return pick(exact);
    const near = items.filter((i) => !i.archivedAt && !finished(i.state) && titleKey(i.title).includes(key));
    if (near.length === 1) return near[0]!;
    if (near.length > 1) return `several cards have “${title}” in their title (${near.map((i) => `“${i.title}”`).join(', ')}); give one's full title.`;
    return `no card on the project is called “${title}”.`;
  }

  /**
   * The owner snoozes the card's worker until `until` (ISO), whether it is in a turn or between
   * turns: as on a pause, its session ends at once and what Seismic has for it meanwhile waits; at the
   * time it goes on where it stopped. A worker snoozed already only gets the new time.
   */
  snooze(cardId: string, until: string) {
    this.card(cardId);
    const snoozed = this.o.board.snoozedOf(cardId);
    if (snoozed) return this.o.board.snooze(cardId, { ...snoozed, until, ...(snoozed.by === 'agent' ? { moved: true as const } : {}) }, 'owner');
    
    const pending = this.live.get(cardId)?.pending;
    const held = this.heldFor(cardId)?.held ?? [];
    this.end(cardId);
    this.bump(cardId);
    clearTimeout(this.reconnecting.get(cardId));
    this.reconnecting.delete(cardId);
    clearTimeout(this.pausing.get(cardId));
    this.pausing.delete(cardId);
    this.o.board.snooze(cardId, { until, by: 'owner', held: [...held, ...(pending ? [pending] : [])] });
    this.parkLater(cardId);
  }

  /** The snoozed worker wakes and goes on: at its time (`timeUp`), as the card it waits on got there or no longer can (`met`), or because the owner wakes it now. */
  wake(cardId: string, timeUp = false, met?: Awaited) {
    this.card(cardId);
    const s = this.o.board.snoozedOf(cardId);
    if (!s || s.waiting) throw new BadRequest('notSnoozed', 'the agent is not snoozed');
    this.deliver(cardId, '', [], true, [], timeUp, met);
  }

  /**
   * A planned card snoozed to start later starts now: at its time (`timeUp`), or because the owner
   * starts it earlier. Its worker hears with its task when the card was to start, so a task that
   * says "in two weeks" is read as due now.
   */
  startsNow(cardId: string, timeUp: boolean) {
    const s = this.o.board.unsnooze(cardId, timeUp ? 'time' : 'owner');
    if (s?.until) this.startsAt(cardId, s.until, s.by, timeUp);
  }

  /**
   * What the card's worker hears with its task: when the card was set to start (`by` its proposing
   * agent or the owner), and that the time has come (`due`) or the owner started it earlier.
   */
  startsAt(cardId: string, until: string, by: Snooze['by'], due: boolean) {
    const at = MESSAGES.en.at(Date.parse(until));
    const who = by === 'agent' ? 'The agent that proposed this card set it to start' : 'The owner set this card aside to start';
    const text = due ? `${who} at ${at}, and that time has come: what the task leaves for later is due now.` : `${who} at ${at}; the owner started it earlier, now.`;
    this.o.board.work(cardId, { unheard: JSON.stringify([...this.unheard(cardId), { said: [], text, images: [] }] satisfies Unheard[]) });
  }

  /** The hold that keeps what Seismic has for the worker until it goes on, or null when none does. */
  private heldFor(cardId: string): Holding | null {
    const h = this.o.board.holdOf(cardId);
    return h && (h.reason === 'paused' || h.reason === 'limit' || (h.reason === 'snoozed' && h.held)) ? h : null;
  }

  /** After a restart (`repo`: of this repository's agents alone): resume every card whose worker was in the middle of a turn. */
  resumeAll(repo = false) {
    const restarted = repo ? REPO_RESTARTED : RESTARTED;
    this.reprobeClashes();
    this.reviews.interrupted();
    
    void this.codeReviewsChanged();
    for (const i of this.o.board.items()) {
      if (this.o.repo && i.repo !== this.o.repo) continue;
      
      if (i.demo?.held?.length) this.releaseLater(i.id, this.o.holdGrace ?? HOLD_GRACE);
      const row = this.o.board.row(i.id);
      const landed = workerConfig.landedOf(row);
      
      const hold = this.o.board.holdOf(i.id);
      if (hold?.reason === 'snoozed' && !hold.waiting) {
        
        if (hold.held) this.pausedOverRestart(i.id, landed);
        else {
          this.parkLater(i.id);
          
          if (landed?.restarts) {
            this.o.board.work(i.id, { landed: JSON.stringify(settled(landed)) });
            this.deliver(i.id, 'Seismic has started again and runs main with your change now.');
          }
        }
        continue;
      }
      
      
      const pausing = hold?.reason === 'pausing' && i.kind !== 'question' && i.state !== 'idea';
      if (pausing) {
        this.o.board.work(i.id, { hold: holdNow('paused') });
        this.o.board.log(i.id, 'state', 'owner', this.o.board.t.worker.pausedByOwner);
      }
      
      if (pausing || hold?.reason === 'paused' || hold?.reason === 'limit') {
        this.pausedOverRestart(i.id, landed);
        continue;
      }
      if (landed && row.workstation) {
        this.resumeLanded(i, landed, row.session_id, repo);
        continue;
      }
      
      if (answering(i)) {
        if (row.workstation && row.session_id) this.launch(i.id, restarted, row.session_id);
        else this.answerTaken(i.id);
        continue;
      }
      
      if (i.review?.landing) this.o.board.work(i.id, { approved_at: null });
      if (this.waitsForOwner(i.id)) {
        this.parkLater(i.id);
        continue;
      }
      if (i.state !== 'working' && i.state !== 'inPr') continue;
      if (!row.workstation) continue;
      if (row.session_id) this.launch(i.id, restarted, row.session_id);
      
      else if (i.state === 'working') this.launchAnew(i.id, row.workstation, workerBriefing(this, i, row.branch ?? '', true), this.taskImages(i));
    }
    
    this.settleLeases();
    void this.listFiles();
  }

  /**
   * A folder's cards handed over without a demo before Seismic kept which of them have files to show
   * (`files` empty), on the project or archived: those whose change still has some get the list.
   */
  private async listFiles() {
    if (!this.folder) return;
    const cards = [...this.o.board.items(), ...this.o.board.archived()].filter(
      (i) => i.kind === 'task' && (!this.o.repo || i.repo === this.o.repo) && !i.demo?.files && !i.demo?.latest && i.state !== 'working',
    );
    for (const i of cards) {
      if (!this.o.board.events(i.id).some((e) => e.kind === 'review')) continue;
      if (!(await this.showsFiles(i.id))) continue;
      const row = this.o.board.row(i.id);
      if (!row.demo?.files && !row.demo?.latest) this.o.board.work(i.id, { demo: { files: [] } });
    }
  }

  /** Whether the card's change has files its left column shows (`shownFiles`), beside the ones its worker named. */
  async showsFiles(cardId: string): Promise<boolean> {
    return shownFiles(await this.diff(cardId, false).catch(() => null)).length > 0;
  }

  /** Settles the leases once the change that called is through, not in the middle of it. */
  private settleLater() {
    if (this.settling) return;
    this.settling = true;
    queueMicrotask(() => {
      this.settling = false;
      
      if (!this.shut) this.settleLeases();
    });
  }

  /**
   * Frees the workstations of cards that will not work in them again, which would otherwise stay
   * taken for good, a restart notwithstanding (`leaseEnded`): one its card no longer names or is done
   * with, a deleted card's, and a workstream's that no worker is on (stopped, say, and its work
   * merged by hand) once the plan doc on the default branch ticks it off or no longer has it. A
   * workstream still in its pull request then counts as merged, which its worker hears as from the
   * pull request's watcher: the doc says so, though the watcher may not see it.
   */
  private settleLeases() {
    if (this.folder) return;
    for (const { path, card_id: id } of this.o.workstations.list()) {
      
      if (!id || this.kept.has(path) || this.preparing.has(id) || this.freeing.has(path)) continue;
      const ended = this.o.board.leaseEnded(id, path);
      if (!ended) continue;
      if (ended === 'merged') {
        this.merged(id, undefined, this.o.board.t.worker.mergedTicked);
        continue;
      }
      const abandoned = this.o.workstations.abandon(path).then(
        (freed) => {
          
          if (!freed) return void this.kept.add(path);
          
          if (!this.o.board.leaseEnded(id, path)) return;
          this.o.board.freed(id, path);
          if (ended === 'ticked') this.o.board.log(id, 'state', 'seismic', this.o.board.t.worker.tickedFreed);
          if (ended === 'gone') this.o.board.log(id, 'state', 'seismic', this.o.board.t.worker.goneFreed);
        },
        (e: unknown) => {
          console.error('freeing the workstation of a card done with it:', e);
          this.kept.add(path);
        },
      );
      this.whileFreeing(id, path, abandoned, 'freeing the workstation of a card done with it');
    }
  }

  /**
   * Git frees the card's workstation at `path` in the background (`freeing`): the board changes once
   * it is done, the pool having a workstation more. What goes wrong is logged under `what`.
   */
  private whileFreeing(cardId: string, path: string, done: Promise<unknown>, what: string) {
    const freeing: { card: string; done: Promise<void> } = { card: cardId, done: Promise.resolve() };
    freeing.done = done
      .then(() => {})
      .catch((e: unknown) => console.error(`${what}:`, e))
      .finally(() => {
        if (this.freeing.get(path) === freeing) this.freeing.delete(path);
        this.o.board.changed();
      });
    this.freeing.set(path, freeing);
  }

  /** Settles once the workstations git is freeing now are free: for tests, as `prepared`. */
  async freed(): Promise<void> {
    while (this.freeing.size) await Promise.all([...this.freeing.values()].map((f) => f.done));
  }

  /** A deleted card is restored: it takes back the workstation it had, where it can; else its next start takes another. */
  restored(cardId: string) {
    const row = this.o.board.row(cardId);
    if (!row.workstation) return;
    this.kept.delete(row.workstation);
    if (this.o.workstations.retake(cardId, row.workstation)) this.o.board.changed();
    else this.o.board.work(cardId, { workstation: null, app: null, parked: null });
  }

  /** After a restart, a paused worker stays paused: a restart it waited for has happened, which it hears once it goes on. */
  private pausedOverRestart(cardId: string, l: LandedState | null) {
    this.parkLater(cardId);
    if (!l?.restarts) return;
    this.o.board.work(cardId, { landed: JSON.stringify(settled(l)) });
    this.deliver(cardId, 'Seismic has started again and runs main with your change now.');
  }

  /** After a restart (`repo`: of this repository's agents alone): landed work's worker goes on with what remains; the restart it waited for has happened. */
  private resumeLanded(card: Item, l: LandedState, session: string | null, repo: boolean) {
    if (!session) return this.finish(card.id);
    this.o.board.work(card.id, { landed: JSON.stringify(settled(l)) });
    
    if (card.state === 'waiting') return this.parkLater(card.id);
    const restarted = repo ? REPO_RESTARTED : RESTARTED;
    this.launch(card.id, l.restarts ? `${repo ? 'Seismic runs' : 'Seismic has started again and runs'} main with your change now. ${restarted}` : restarted, session);
  }

  /** Settles once the workstations git is making ready now are ready (or failed), their workers started: for a start begun elsewhere (the Koordinator, the owner's question). */
  async prepared(): Promise<void> {
    while (this.preparing.size) await Promise.all([...this.preparing.values()].map((p) => p.done));
  }

  /** The cards whose worker is in a turn, and those whose workstation is made ready for it, each holding a slot on its machine. */
  inTurn(): string[] {
    return [...new Set([...[...this.live].filter(([, l]) => l.busy).map(([id]) => id), ...this.preparing.keys()])];
  }

  /** The cards whose worker is in a turn, each with its background work that runs and whether the turn waits only for that work; and those that paused for a restart that is due. */
  private turnsShown(): Map<string, WorkerTurn> {
    const turns = new Map<string, WorkerTurn>([...this.live, ...this.standIns].filter(([, l]) => l.busy).map(([id, l]) => [id, { tasks: [...l.tasks.values()].map(({ description, since }) => ({ description, since })), over: !!l.waiting, doing: shownDoing(l.doing ?? {}) }]));
    if (this.restart) for (const [id, l] of this.live) if (!l.busy && l.restartPaused) turns.set(id, { tasks: [], over: true, restartPaused: true });
    return turns;
  }

  /** The machine a card's worker in a turn holds a slot on (null: the one Seismic runs on); undefined for one not in a turn. */
  turnHost(id: string): string | null | undefined {
    const live = this.live.get(id);
    const preparing = this.preparing.get(id);
    if (!live?.busy && !preparing) return undefined;
    if (live) return live.host;
    
    const at = this.o.workstations.leasedBy(id);
    return at ? hostName(at) : preparing!.host;
  }

  /** Where a card's worker in a turn works: the machine it holds a slot on, and its workstation (null while git makes one ready elsewhere); undefined for one not in a turn. */
  turnAt(id: string): { host: string | null; path: string | null } | undefined {
    const host = this.turnHost(id);
    if (host === undefined) return undefined;
    let path: string | null = null;
    try {
      path = this.o.board.row(id).workstation;
    } catch {
      
    }
    return { host, path };
  }

  /** How many of these workers are in a turn on a machine (null: the one Seismic runs on). */
  busyOn(host: string | null): number {
    return this.inTurn().filter((id) => this.turnHost(id) === host).length;
  }

  /**
   * The cards whose worker is in the middle of a turn (or whose ended turn waits for its background
   * work), and those whose workstation is being made ready, freed or taken from them (`evict`), whose work is landing, or whose landed changes are still
   * being read for plan docs and overlap notices: a restart would cut off git midway. And those whose code review's agent is at work.
   */
  busyCards(): string[] {
    return [...new Set([...this.inTurn(), ...this.landing, ...this.reading.keys(), ...[...this.freeing.values()].map((f) => f.card), ...this.evicting, ...this.reviews.busy()])];
  }

  /**
   * Seismic is about to restart (or no longer is): workers in the middle of a turn hear so and pause
   * at a safe point, and those that start a turn before the restart hear it with their message.
   */
  restartDue(due: DueRestart | null) {
    this.restart = due;
    this.reviews.restartDue(due);
    
    this.o.board.changed();
    if (!due) {
      
      for (const cardId of this.live.keys()) if (!this.takesLater(cardId) && this.unheard(cardId).some((u) => !u.nextTurn)) this.deliver(cardId, '');
      return;
    }
    for (const [cardId, live] of this.live) {
      if (!live.busy || live.toldRestart) continue;
      this.tellRestart(cardId, live);
      live.session.send(restartNotice(due));
      this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.worker.restartDue(pauseOf(due)));
    }
  }

  shutdown() {
    
    this.unwatch();
    this.unwatchLandings?.();
    for (const turn of this.landingTurns.values()) turn.abort();
    this.shut = true;
    this.reviews.shutdown();
    for (const id of [...this.live.keys()]) this.end(id);
    for (const timer of this.reconnecting.values()) clearTimeout(timer);
    this.reconnecting.clear();
    for (const timer of this.parking.values()) clearTimeout(timer);
    this.parking.clear();
    for (const timer of this.pausing.values()) clearTimeout(timer);
    this.pausing.clear();
    for (const id of [...this.forwards.keys()]) this.unforward(id);
  }

  

  /** What a worker's environment gets: where Seismic is, and the language the repository names for its demos (`DEMO_LANGUAGE`, read by the demo skill). */
  private env(): Record<string, string> | undefined {
    const language = this.o.adapter.demo?.language;
    return language ? { ...this.o.env, DEMO_LANGUAGE: language } : this.o.env;
  }

  /** Where a permission question of the card's worker comes from, for the extensions' options on it. */
  private permissionContext(cardId: string): PermissionContext | null {
    const row = this.o.board.row(cardId);
    if (!row.workstation) return null;
    let harness: PermissionContext['harness'] = 'claude';
    try {
      if ((row.agent_setting ? (JSON.parse(row.agent_setting) as AgentSetting) : null)?.harness === 'codex') harness = 'codex';
    } catch {}
    return { harness, cwd: row.workstation, landsOnMain: !!this.folder || this.o.adapter.land === 'main', language: this.o.board.language(), settings: extensionSettings(this.o.adapter) };
  }

  /** The options extensions add to a permission question, each with the extension's place in the registry. */
  private permissionOptions(cardId: string, request: PermissionRequest): (PermissionOption & { extension: number })[] {
    const context = this.permissionContext(cardId);
    if (!context) return [];
    return extensions.flatMap((extension, i) => {
      try {
        return (extension.permission?.options(request, context) ?? []).map((o) => ({ ...o, extension: i }));
      } catch (error) {
        console.error('Extension permission options failed:', error);
        return [];
      }
    });
  }

  /** The owner picked an extension's option of a permission question: the extension acts on it; the permission updates for the asking session, if any. */
  private permissionPicked(cardId: string, picked: NonNullable<AskedPermission['extra']>[number]): PermissionUpdate[] | undefined {
    const extension = extensions[picked.extension]?.permission;
    const context = this.permissionContext(cardId);
    if (!extension || !context) return undefined;
    const asOwner = this.o.asOwner;
    try {
      return extension.picked(picked.data, {
        ...context,
        log: (text) => this.o.board.log(cardId, 'activity', 'seismic', text),
        asOwner: (change) => (asOwner ? asOwner(context.cwd, change) : Promise.reject(new Error('Seismic changes no repository here'))),
      })?.permissions;
    } catch (error) {
      console.error('Extension permission choice failed:', error);
      return undefined;
    }
  }

  private extensionEvent(type: 'landed' | 'workerStarted', card: string) {
    for (const extension of extensions) {
      try {
        const result = extension.event?.({ type, project: this.o.board.project.id, card, settings: extensionSettings(this.o.adapter) });
        if (result) void result.catch((error) => console.error('Extension event failed:', error));
      } catch (error) { console.error('Extension event failed:', error); }
    }
  }

  private launch(cardId: string, message: string, resume?: string, images: string[] = [], reviewOnly = false) {
    const row = this.o.board.row(cardId);
    if (!row.workstation) throw new Error(`card ${cardId} has no workstation to work in`);
    
    const chosen = this.o.agentSetting?.() ?? AGENT_DEFAULTS.worker;
    const setting: AgentSetting = row.agent_setting ? JSON.parse(row.agent_setting) : resume ? { model: chosen.model, effort: chosen.effort } : chosen;
    
    if (!row.agent_setting && resume) this.o.board.recordRun(cardId, resume, { harness: 'claude', model: null, effort: null });
    this.o.board.work(cardId, { agent_setting: JSON.stringify(setting) });
    const preferences = this.o.preferences?.() ?? '';
    const live: Live = { session: undefined!, ...(setting.harness === 'codex' && this.o.codexAutoReview?.() ? { autoReview: true } : {}), host: hostName(row.workstation), handedOver: false, acted: false, nudged: false, lastText: '', busy: true, background: 0, tasks: new Map(), stalled: false, preferences, ...(!row.agent_setting && resume ? { guessed: true as const } : {}) };
    const plan = this.o.board.item(cardId)?.parent;
    if (plan && !reviewOnly) live.plan = { id: plan, decision: this.o.board.decisions(plan).at(-1)?.id ?? 0 };
    this.live.set(cardId, live);
    this.o.board.changed();
    if (!reviewOnly) {
      ({ text: message, images } = this.withUnheard(cardId, message, images));
      message = this.withRestart(cardId, live, this.withPageNews(cardId, message));
    }
    live.pending = { text: message, images };
    const env = this.env();
    
    const plans = live.host ? null : outsidePlanDir(this.o.adapter.planDocs.dir);
    
    const demos = live.host || !setting.harness || setting.harness === 'claude' ? null : expandHome(this.demosDir(cardId));
    const dirs = [plans, demos && isAbsolute(demos) && existsSync(demos) ? demos : null].filter((d): d is string => !!d);
    
    
    const review = !!contributionOf(row);
    const notes = review ? this.mainNotes() : '';
    try {
      live.session = workerAgent.start(
        this.o.runtime,
        {
          host: this,
          cardId,
          card: this.o.board.item(cardId),
          live,
          setting,
          preferences,
          prototype: !!row.idea?.prototypeOf,
          review,
          notes,
          message,
          options: {
            at: { card: cardId },
            ...(dirs.length ? { dirs } : {}),
            ...(review ? { untrusted: true } : {}),
            ...(env ? { env } : {}),
            contextUpdate: () => workerContextUpdate(this, cardId, live, reviewOnly),
            askOwner: (request, signal) => this.askOwner(cardId, live, request, signal),
            ...(this.folder ? { watch: this.folder.watch(cardId) } : {}),
          },
        },
        { cwd: row.workstation, onEvent: (e) => this.onEvent(cardId, live, e), ...(resume ? { resume } : {}), images },
      );
    } catch (e) {
      
      this.live.delete(cardId);
      this.o.board.log(cardId, 'error', 'seismic', messageOf(e));
      const card = this.o.board.item(cardId);
      if (card && (card.state === 'working' || card.state === 'inPr') && !workerConfig.landedOf(row)) this.toOwner(cardId, { text: failureReason(clip(messageOf(e), 1200), this.o.board.t), options: [], stuck: true });
      else this.o.board.changed();
      return;
    }
    this.extensionEvent('workerStarted', cardId);
    live.session.done.then(() => {
      if (this.live.get(cardId) !== live) return;
      this.live.delete(cardId);
      
      this.o.board.changed();
      
      this.answerTaken(cardId);
    });
  }

  /**
   * Passes a message to the worker, resuming its session if it has none. While the owner has paused
   * it, Seismic's messages wait (`owner` false); the owner's let it go on, after what waited. The
   * owner's words of the log's lines `said` wait for the worker's next step while it is in a turn
   * (`takesLater`), unread until then; other words go into the session's input at once.
   */
  private deliver(cardId: string, text: string, images: string[] = [], owner = false, said: number[] = [], timeUp = false, met?: Awaited) {
    const holding = this.heldFor(cardId);
    if (holding && !owner) {
      this.o.board.work(cardId, { hold: { ...holding, held: [...(holding.held ?? []), { text, images }] } satisfies Hold });
      return;
    }
    
    const snoozed = this.o.board.snoozedOf(cardId);
    const woke = snoozed && !snoozed.waiting ? snoozed : null;
    if (woke) {
      this.o.board.unsnooze(cardId, met ? { met } : timeUp ? 'time' : owner ? 'owner' : 'news');
      const live = this.live.get(cardId);
      if (live) live.snoozed = false;
      
      const card = this.o.board.item(cardId);
      if (card && handedOver(card)) this.takingIn(cardId, true);
    }
    const wokeText = woke ? wokeNote(woke, timeUp, owner, !!text, met) : '';
    
    if (owner && this.o.board.holdOf(cardId)?.reason === 'pausing') {
      this.pauseTakenBack(cardId);
      text = [PAUSE_TAKEN_BACK, text].filter(Boolean).join('\n\n');
    }
    if (holding) {
      if (holding.reason === 'limit') {
        const attempts = new LimitAttempts();
        attempts.count = holding.attempts;
        this.limitAttempts.set(cardId, attempts);
        this.o.board.work(cardId, { status_line: holding.statusBefore ?? null });
      }
      
      if (!woke) {
        this.o.board.work(cardId, { hold: null });
        this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.resumedByOwner);
      }
      const held = holding.held ?? [];
      text = [woke ? wokeText : RESUMED, ...(held.length ? [`While you were ${woke ? 'snoozed' : 'paused'}, Seismic had this for you:\n\n${held.map((h) => h.text).join('\n\n---\n\n')}`] : []), ...(text ? [`Then:\n\n${text}`] : [])].join('\n\n');
      images = [...held.flatMap((h) => h.images), ...images];
    } else if (woke) text = [wokeText, text].filter(Boolean).join('\n\n');
    this.unpark(cardId);
    const stopping = this.stopping.get(cardId);
    if (stopping) {
      
      const generation = this.generation.get(cardId);
      void stopping.then(() => {
        if (this.generation.get(cardId) === generation) this.deliver(cardId, text, images, false, said);
      });
      return;
    }
    
    if ((said.length && this.takesLater(cardId)) || this.preparingFor(cardId)) {
      this.o.board.work(cardId, { unheard: JSON.stringify([...this.unheard(cardId), { said, text, images }] satisfies Unheard[]) });
      return;
    }
    this.o.board.readNow(cardId, said);
    const parked = this.o.board.row(cardId).parked;
    if (parked) {
      this.o.board.work(cardId, { parked: null });
      text = `${text}\n\n${this.parkedNote()}`;
    }
    const live = this.live.get(cardId);
    if (live) {
      
      this.stopWaiting(live);
      limitWatch.cancel(live);
      live.limitHit = false;
      this.setBusy(live, true);
      ({ text, images } = this.withUnheard(cardId, text, images));
      const message = this.withRestart(cardId, live, this.withPageNews(cardId, text));
      live.pending = { text: message, images };
      live.session.send(message, images);
      return;
    }
    const row = this.o.board.row(cardId);
    if (row.session_id) return this.launch(cardId, text, row.session_id, images);
    
    const card = this.card(cardId);
    this.launchAnew(cardId, row.workstation, `${workerBriefing(this, card, row.branch ?? '', true)}\n\n${text}`, [...this.taskImages(card), ...images]);
  }

  /**
   * A new session for a card that had none, in its workstation `at`: its captured working changes
   * (where it has them) are put there again first, as `start` puts them, since the briefing names their file.
   */
  private launchAnew(cardId: string, at: string | null, text: string, images: string[]) {
    const captured = this.captured(cardId);
    if (captured === undefined || !at) return this.launch(cardId, text, undefined, images);
    
    void this.whenReady(
      cardId,
      writeToGitDir(at, CAPTURED_CHANGES, captured).then(() => at),
      () => this.launch(cardId, text, undefined, images),
      () => {},
    );
  }

  /** Whether the worker is in the middle of a turn, so that the owner's words wait for its next step. */
  private takesLater(cardId: string): boolean {
    if (this.preparingFor(cardId)) return true;
    const live = this.live.get(cardId);
    return !!live && live.busy && !live.waiting && !this.stopping.has(cardId) && !this.heldFor(cardId);
  }

  /** Whether the card's worker waits for git to make its workstation ready, without a session yet. */
  private preparingFor(cardId: string): boolean {
    return this.preparing.has(cardId) && !this.live.has(cardId);
  }

  /** What waits for the worker, without what starts with `prefix` (news an event since has made stale). */
  private unheardBut(cardId: string, prefix: string): Unheard[] {
    return this.unheard(cardId).filter((u) => !u.text.startsWith(prefix));
  }

  private unheard(cardId: string): Unheard[] {
    const stored = this.o.board.row(cardId).unheard;
    return stored ? (JSON.parse(stored) as Unheard[]) : [];
  }

  /** The owner's words Seismic held for the worker, taken out: they are read from now on. */
  takeUnheard(cardId: string, nextTurn = true): Unheard[] {
    const all = this.unheard(cardId);
    const unheard = all.filter((u) => nextTurn || !u.nextTurn);
    if (!unheard.length) return [];
    const kept = all.filter((u) => !unheard.includes(u));
    this.o.board.work(cardId, { unheard: kept.length ? JSON.stringify(kept) : null });
    this.o.board.readNow(cardId, unheard.flatMap((u) => u.said));
    return unheard;
  }

  /** The planned card became an idea: the notes the owner left on it for a worker go to its exploration agent instead. */
  takeNotes(cardId: string): { text: string; images: string[] } {
    return this.withUnheard(cardId, '', []);
  }

  /** A message that starts a turn, with the owner's words that waited for the worker's next step after it. */
  private withUnheard(cardId: string, text: string, images: string[]): { text: string; images: string[] } {
    const unheard = this.takeUnheard(cardId);
    if (!unheard.length) return { text, images };
    return { text: [text, ...unheard.map((u) => u.text)].filter(Boolean).join('\n\n---\n\n'), images: [...images, ...unheard.flatMap((u) => u.images)] };
  }


  /**
   * The worker's turn ended before a step took in the owner's words that waited for it: they start
   * its next turn. Not while it stops for a restart or a usage limit, which it goes on from with them.
   */
  private unheardStarts(cardId: string, live: Live): boolean {
    if (this.restart || live.limited || !this.unheard(cardId).some((u) => !u.nextTurn)) return false;
    const { text: words, images } = this.withUnheard(cardId, '', []);
    const text = this.withPageNews(cardId, words);
    this.setBusy(live, true);
    live.pending = { text, images };
    live.session.send(text, images);
    return true;
  }




  /**
   * A message that starts a turn while a restart is due tells the worker of it, once: that the
   * work the message asks for waits until Seismic resumes it (workers in a turn heard of it already).
   */
  private withRestart(cardId: string, live: Live, text: string): string {
    const still = restartStillDue(this, cardId, live);
    if (still) return `${text}\n\n${still}`;
    if (!this.restart || live.toldRestart) return text;
    this.tellRestart(cardId, live);
    this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.worker.restartWaits(pauseOf(this.restart)));
    return `${text}\n\n${restartWaits(this.restart)}`;
  }



  private tellRestart(cardId: string, live: Live) {
    live.toldRestart = true;
    live.statusBeforeRestart = this.o.board.row(cardId).status_line;
  }

  /** The worker ended its turn for the restart: the card says so, and its status line is again the one from before it heard of it. */
  private pausedForRestart(cardId: string, live: Live) {
    if (live.statusBeforeRestart !== undefined) this.o.board.work(cardId, { status_line: live.statusBeforeRestart });
    this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.worker.paused(pauseOf(this.restart!)));
  }

  private bump(cardId: string) {
    if (!this.landingActive.has(cardId)) this.landingTurns.get(cardId)?.abort();
    this.generation.set(cardId, (this.generation.get(cardId) ?? 0) + 1);
    this.unpark(cardId);
  }

  private end(cardId: string) {
    const live = this.live.get(cardId);
    this.live.delete(cardId);
    clearTimeout(live?.waiting);
    if (live) limitWatch.cancel(live);
    this.o.board.waitsForLimit({ card: cardId }, undefined);
    clearTimeout(live?.quiet);
    live?.session.close();
    
    if (live?.busy) this.o.board.changed();
  }

  /**
   * Whether the worker is in a turn. It holds a slot on its machine meanwhile: the board hears of
   * each change, so the Workstations pill shows it and a card waiting for a slot starts once one frees.
   */
  private setBusy(live: Live, busy: boolean) {
    if (live.busy === busy) return;
    live.busy = busy;
    if ([...this.live.values()].includes(live)) this.o.board.changed();
  }

  /**
   * Follows what the worker does from its steps, for its card (`doing.ts`): the board hears of a
   * change of what the card shows; one that comes with the turn's start or end it hears of with that.
   */
  private follow(live: Live, e: AgentEvent) {
    const was = shownDoing(live.doing ?? {});
    let d = live.doing ?? {};
    if (e.type === 'tool') (d = onTool(d, e.name, e.input)), (live.running = (live.running ?? 0) + 1);
    else if (e.type === 'toolDone') (d = onToolDone(d, e.name, e.ok)), (live.running = Math.max(0, (live.running ?? 0) - 1));
    else if (e.type === 'text') d = { ...d, thinking: false };
    clearTimeout(live.quiet);
    live.quiet = undefined;
    if (e.type === 'idle' || e.type === 'error' || e.type === 'lost') {
      live.running = 0;
      
      if (e.type !== 'idle' || !e.background) d = {};
      else d = { ...d, thinking: false };
    } else if (!live.running) {
      live.quiet = setTimeout(() => {
        live.quiet = undefined;
        if (!live.busy || live.running || ![...this.live.values(), ...this.standIns.values()].includes(live)) return;
        live.doing = { ...live.doing, thinking: true };
        this.o.board.changed();
      }, this.o.thinkingAfter ?? THINKING_AFTER);
    }
    live.doing = d;
    if (live.busy && shownDoing(d) !== was) this.o.board.changed();
  }

  private onEvent(cardId: string, live: Live, e: AgentEvent) {
    if (this.live.get(cardId) !== live) return;
    if (e.type === 'background') return this.backgroundChanged(cardId, live, e.tasks);
    this.follow(live, e);
    
    this.setBusy(live, e.type !== 'idle');
    this.stopWaiting(live);
    limitWatch.cancel(live);
    if (e.type === 'text' || e.type === 'tool') {
      
      
      if (!live.acted && this.o.board.item(cardId)?.review?.answered) this.takingIn(cardId, true);
      this.resumed(cardId, live);
      this.unlimited(cardId, live);
      live.failed = undefined;
    }
    if (e.type === 'text' || e.type === 'tool' || e.type === 'error') live.acted = true;
    if (e.type === 'text' || e.type === 'tool' || (e.type === 'idle' && !e.more)) live.pending = undefined;
    switch (e.type) {
      case 'session': {
        
        const before = this.o.board.row(cardId).session_id;
        if (before && before !== e.id) this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.worker.newSession(this.o.board.t.worker.earlierRun(before)));
        
        const pinned = this.o.board.row(cardId).agent_setting;
        const model = e.model ?? (e.setting ? harnessChoice(e.setting).model : undefined);
        if (model && model !== 'default') live.model = model;
        else if (before !== e.id) live.model = undefined;
        if (pinned) this.o.board.recordRun(cardId, e.id, workConfig(JSON.parse(pinned) as AgentSetting, model, live.guessed));
        this.o.board.work(cardId, { session_id: e.id, ...(e.setting ? { agent_setting: JSON.stringify(e.setting) } : {}) });
        break;
      }
      case 'text':
        live.lastText = e.text;
        
        
        
        if (live.handedOver || live.snoozed) break;
        live.spoke = true;
        if (live.answered) live.held = clip(e.text, 12000);
        else this.o.board.log(cardId, 'say', 'worker', clip(e.text, 12000));
        break;
      case 'tool':
        if (live.held !== undefined) this.o.board.log(cardId, 'say', 'worker', live.held);
        live.held = undefined;
        if (!e.name.startsWith('mcp__seismic__')) this.o.board.log(cardId, 'activity', 'worker', describeTool(e.name, e.input, this.o.board.t));
        else if (e.name === 'mcp__seismic__app_running') appRunning(live, String(e.input.url ?? '').trim());
        break;
      case 'denied': {
        const t = this.o.board.t;
        this.o.board.log(cardId, 'denied', 'worker', t.worker.denied(describeTool(e.name, e.input, t), t.worker.deniedBy[e.by], e.reason && clip(e.reason, 600)));
        break;
      }
      case 'error':
        if (e.ended) {
          live.ended = true;
          this.unpark(cardId);
          
          if (this.o.board.item(cardId)?.agent?.app) this.o.board.work(cardId, { app: null });
        }
        if (e.limit) {
          if (live.limitHit) break;
          live.limitHit = true;
          const attempts = this.limitAttempts.get(cardId) ?? new LimitAttempts();
          this.limitAttempts.set(cardId, attempts);
          const at = attempts.hit(e.limit, this.o.limitMargin ?? 10_000);
          live.limitReset = e.limit.resetsAt && e.limit.resetsAt > Date.now() ? at ?? undefined : undefined;
          const t = this.o.board.t;
          if (attempts.count >= 3) {
            const before = live.statusBefore !== undefined ? live.statusBefore : this.o.board.row(cardId).status_line;
            const pending = live.pending;
            this.end(cardId);
            this.o.board.work(cardId, {
              hold: {
                reason: 'limit',
                since: new Date().toISOString(),
                attempts: attempts.count,
                ...(live.limitReset ? { until: new Date(live.limitReset).toISOString() } : {}),
                ...(live.model ? { model: live.model } : {}),
                statusBefore: before,
                ...(pending ? { held: [pending] } : {}),
              },
              status_line: t.worker.limitPaused,
            });
            this.o.board.log(cardId, 'state', 'seismic', `${e.message.replace(/\.?\s*$/, '.')} ${t.worker.limitPaused}`);
            this.parkLater(cardId);
            break;
          }
          live.limited = at!;
          this.o.board.waitsForLimit({ card: cardId }, live.limited);
          this.o.board.log(cardId, 'state', 'seismic', `${e.message.replace(/\.?\s*$/, '.')} ${e.limit.resetsAt ? t.worker.limitResumes(t.when(live.limited)) : t.worker.limitRetries(t.when(live.limited))}`);
          break;
        }
        live.failed = e.message;
        this.o.board.log(cardId, 'error', 'seismic', e.message, { token: e.token });
        break;
      case 'lost':
        this.lost(cardId, live);
        break;
      case 'idle':
        live.background = e.background ?? 0;
        if (!live.background) live.tasks.clear();
        this.turnEnded(cardId, live, live.background, false, this.unheardStarts(cardId, live) || e.more);
        this.parkLater(cardId);
        break;
    }
  }

  private async landApproved(cardId: string) {
    try {
      await this.land(cardId, 'seismic');
    } catch (e) {
      
      if (!(e instanceof BadRequest)) return this.o.board.log(cardId, 'error', 'seismic', messageOf(e));
      this.o.board.work(cardId, { state: 'waiting', need: this.o.board.row(cardId).demo?.latest ? 'demo' : 'review', status_line: null });
      this.o.board.log(cardId, 'error', 'seismic', e.message, { code: e.code });
    }
  }

  /**
   * A turn that ends without handing over gets one nudge; after that the owner is asked. A turn
   * that ends while the worker's background work runs (a demo render, say) waits for that work
   * to wake the worker instead, unless nothing happens for a long while; so does a turn in which
   * the worker did nothing, as it never ended a turn of its own there. A turn that ends with a
   * message from Seismic still to come (`more`) is not the worker's last: the turn that message starts
   * is, so the landing of its work, told while the worker ended its reply, is not lost with the session.
   */
  private turnEnded(cardId: string, live: Live, background: number, waited = false, more = false) {
    
    void this.folder?.settle(cardId);
    const handedOver = live.handedOver;
    const acted = live.acted || waited;
    
    for (const t of live.tasks.values()) t.earlier = true;
    const closing = live.held;
    const snoozed = live.snoozed;
    const spoke = !!live.spoke;
    live.handedOver = false;
    live.answered = false;
    live.spoke = false;
    
    if (!more) live.snoozed = false;
    live.held = undefined;
    live.acted = false;
    
    if (this.restart && live.toldRestart && !more) live.restartPaused = true;
    const card = this.o.board.item(cardId);
    if (!card) return;
    if (closing !== undefined) this.o.board.log(cardId, 'closing', 'worker', closing);
    const row = this.o.board.row(cardId);
    
    
    if (snoozed && !handedOver && !more && this.o.board.snoozedOf(cardId)) {
      if (answering(card)) this.answerTaken(cardId, true);
      return this.end(cardId);
    }
    if (this.o.board.holdOf(cardId)?.reason === 'pausing' && !more) {
      
      if (!background) return this.pausedAtSafePoint(cardId, card, !!row.approved_at, handedOver, spoke);
      
      live.pauseHeld = true;
    }
    if (background > 0) {
      
      
      if (live.limited && !handedOver && this.goesOnAfterLimit(cardId)) return this.waitForLimit(cardId, live, live.limited, background);
      
      
      this.waitForWorker(cardId, live);
      if (!handedOver) {
        
        
        
        if (spoke && answering(card) && onlyApp(live)) this.answerTaken(cardId, true);
        return;
      }
    }
    if (more && !handedOver) return this.waitForWorker(cardId, live);
    if (answering(card)) {
      
      if (!acted && !handedOver) return this.waitForWorker(cardId, live);
      
      if (this.restart && live.toldRestart && !handedOver) return this.pausedForRestart(cardId, live);
      
      if (live.limited && !handedOver) return this.waitForLimit(cardId, live, live.limited);
      this.answerTaken(cardId, spoke);
    }
    if (handedOver) {
      
      if (card.state === 'working' && row.approved_at) void this.landApproved(cardId);
      return;
    }
    const landed = workerConfig.landedOf(row);
    
    if (card.state === 'inPr' && card.review?.pr) return;
    
    const fixing = this.reviews.items(cardId).some((i) => i.status === 'fixing');
    if (card.state !== 'working' && card.state !== 'inPr' && !landed && !fixing) return;
    if (landed) {
      
      if (card.state === 'waiting' || landed.waits) return;
      if (landed.page) {
        
        if (card.demo?.share?.state !== 'publishing') this.pageSettled(cardId);
        return;
      }
      if (landed.needsClone) return this.awaitClone(cardId);
      if (landed.resolve && !live.failed && !live.limited && !(this.restart && live.toldRestart)) return this.unresolved(cardId, live, landed.resolve);
      
      if (this.restart && live.toldRestart && !live.failed) return this.pausedForRestart(cardId, live);
      if (live.limited) return this.waitForLimit(cardId, live, live.limited);
      if (live.failed) return this.failedAfterLanding(cardId, live);
      this.finish(cardId);
      return;
    }
    
    if (this.restart && live.toldRestart) return this.pausedForRestart(cardId, live);
    if (live.limited) return this.waitForLimit(cardId, live, live.limited);
    
    if (live.ended && live.failed) live.nudged = true;
    if (!acted && !live.nudged) {
      
      
      this.waitForWorker(cardId, live);
      return;
    }
    if (!live.nudged) {
      live.nudged = true;
      this.setBusy(live, true);
      live.session.send(
        card.state === 'inPr'
          ? 'Your turn ended, and Seismic has no pull request for this card yet (pr_opened), nor did you close it as needing none (close_unchanged).'
          : card.state === 'waiting'
            ? 'Your turn ended while items of the code review are still marked as being fixed by you. Hand over (ready_for_review), resubmit them (resubmit_review_item), or dispute them (dispute_review_item). Should you end your turn again like this, Seismic passes your last words to the owner as a question.'
            : 'Your turn ended without a handover (ready_for_review) or a question (ask), so the card still shows you at work. Should you end your turn again like this, Seismic passes your last words to the owner as a question.',
      );
      return;
    }
    live.nudged = false;
    live.stalled = true;
    
    const text = live.failed ? failureReason(clip(live.failed, 1200), this.o.board.t) : live.lastText ? clip(live.lastText, 1200) : this.o.board.t.worker.stalled;
    this.toOwner(cardId, { text, options: [], stuck: true });
  }

  /**
   * The worker resolving a stopped pull (`resolvePull`) ended its turn without handing the
   * resolution over: it is reminded once; ending again, it gives the pull up, and the review card
   * says what is left to do.
   */
  private unresolved(cardId: string, live: Live, r: Resolving) {
    const landed = workerConfig.landedOf(this.o.board.row(cardId))!;
    if (!r.reminded) {
      this.o.board.work(cardId, { landed: JSON.stringify({ ...landed, resolve: { ...r, reminded: true } } satisfies LandedState) });
      this.setBusy(live, true);
      live.session.send(
        `Your turn ended, and the pull of pull request #${r.pr} into the local main is still stopped: resolve it and hand it over with ready_for_review, or ask the owner where it needs their decision. Should you end your turn again like this, Seismic leaves the pull to the owner.`,
      );
      return;
    }
    const { resolve: _, ...rest } = landed;
    this.o.board.work(cardId, { landed: JSON.stringify(rest satisfies LandedState), status_line: null });
    const t = this.o.board.t.worker;
    if (this.o.board.card(r.card)) this.o.board.log(r.card, 'error', 'seismic', t.pullUnresolved(r.stopped.subject, r.stopped.files.join(', '), t.resolverGaveUp));
    this.finish(cardId);
  }

  /**
   * A turn after the landing that an error cut off (the API overloaded, say) has not done what
   * remained: it is tried once more, then the owner hears why. A restart that is due tries it
   * again by resuming the worker, and need not wait for a turn that may fail the same way.
   */
  private failedAfterLanding(cardId: string, live: Live) {
    if (this.restart) {
      this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.worker.paused(pauseOf(this.restart)));
      return;
    }
    if (!live.nudged) {
      live.nudged = true;
      this.setBusy(live, true);
      live.session.send(`Your last turn broke off with an error (${clip(live.failed!, 300)}). Your work is on main; go on with what remained after the landing.`);
      return;
    }
    live.nudged = false;
    live.stalled = true;
    const t = this.o.board.t;
    const reason = failureReason(clip(live.failed!, 1200), t);
    this.toOwner(cardId, { text: t.worker.remainsUndone(`${reason}${/[.!?]$/.test(reason) ? '' : '.'}`), options: [t.worker.tryAgain], stuck: true });
  }

  /**
   * The worker takes in the owner's words on its handover: the card is at work meanwhile, and still
   * waits for approval. New words are not answered yet; a worker that its background work woke
   * after it answered (`woke`) works on towards that answer, which stands.
   */
  private takingIn(cardId: string, woke = false) {
    const detail = this.o.board.row(cardId).detail;
    const { answered, ...rest } = detail ? (JSON.parse(detail) as Record<string, unknown>) : {};
    this.o.board.work(cardId, { detail: JSON.stringify({ ...rest, ...(woke && answered ? { answered } : {}), answering: true }) });
  }

  /**
   * The worker has taken in the owner's words on its handover: work still waiting is the owner's
   * again, `answered` when its turn ended with words for them rather than a new demo (or a turn
   * before did, `takingIn`). Without any (its session ended, its turn broke off) the owner hears
   * that their words went unanswered.
   */
  private answerTaken(cardId: string, spoke = false) {
    const { detail } = this.o.board.row(cardId);
    if (!detail) return;
    const { answering, answered: before, ...rest } = JSON.parse(detail) as Record<string, unknown>;
    if (!answering) return;
    
    void this.codeReviewsChanged();
    const answered = spoke || !!before;
    this.o.board.work(cardId, { detail: JSON.stringify({ ...rest, ...(answered ? { answered: true } : {}) }) });
    this.reviews.workerFinished(cardId);
    if (!answered) this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.worker.unanswered);
  }

  /**
   * Waits for a sign of life from the worker; without one for a long while, its turn counts as ended.
   * While its background work runs (a watcher waiting for a deploy, say) that may take long: the
   * wait is the work's own, which wakes the worker when it ends.
   */
  private waitForWorker(cardId: string, live: Live) {
    this.setBusy(live, true);
    const began = !live.waiting;
    clearTimeout(live.waiting);
    live.waiting = setTimeout(() => {
      live.waiting = undefined;
      this.setBusy(live, false);
      if (this.live.get(cardId) !== live) return;
      this.turnEnded(cardId, live, 0, true);
      this.parkLater(cardId);
    }, live.background > 0 ? (this.o.backgroundLimit ?? BACKGROUND_LIMIT) : (this.o.backgroundGrace ?? BACKGROUND_GRACE));
    
    if (began && [...this.live.values()].includes(live)) this.o.board.changed();
  }

  /** The worker gave a sign of life: an ended turn that waited for it is a turn again, which the card shows. */
  private stopWaiting(live: Live) {
    if (!live.waiting) return;
    clearTimeout(live.waiting);
    live.waiting = undefined;
    if (live.busy && [...this.live.values()].includes(live)) this.o.board.changed();
  }

  /** The worker's background work started or ended: an ended turn waiting for it waits as long as it runs. */
  private backgroundChanged(cardId: string, live: Live, running: { id: string; description: string }[]) {
    live.background = running.length;
    
    this.folder?.background(cardId, running.length > 0);
    const now = Date.now();
    live.tasks = new Map(running.map((t) => [t.id, { ...live.tasks.get(t.id), description: t.description, since: live.tasks.get(t.id)?.since ?? now }]));
    
    if (live.busy) this.o.board.changed();
    if (live.waiting) this.waitForWorker(cardId, live);
  }

  

  /**
   * Whether the card waits for the owner with its workstation and nothing of its worker's running:
   * handed over, asked, or its pull request open, and the worker's turn over, background work included.
   */
  private waitsForOwner(cardId: string): boolean {
    const card = this.o.board.item(cardId);
    if (!card || !(card.state === 'waiting' || (card.state === 'inPr' && card.review?.pr) || isPaused(card) || snoozeOf(card))) return false;
    
    if ((answering(card) && !isPaused(card) && !snoozeOf(card)) || this.live.get(cardId)?.busy) return false;
    const row = this.o.board.row(cardId);
    return !!row.workstation && !row.parked;
  }

  /** A card that waits for the owner has its app stopped once a quick reply has not come (`app.stop`). */
  private parkLater(cardId: string) {
    if (!this.o.adapter.app?.stop || !this.waitsForOwner(cardId) || this.live.get(cardId)?.ended) return;
    clearTimeout(this.parking.get(cardId));
    this.parking.set(
      cardId,
      setTimeout(() => {
        this.parking.delete(cardId);
        if (!this.waitsForOwner(cardId) || this.stopping.has(cardId)) return;
        const stopping = this.park(cardId).finally(() => this.stopping.delete(cardId));
        this.stopping.set(cardId, stopping);
      }, Math.max(this.o.parkGrace ?? PARK_GRACE, (this.tried.get(cardId) ?? 0) + (this.o.tryGrace ?? TRY_GRACE) - Date.now())),
    );
  }

  /**
   * Where the owner's browser reaches the app the card's worker said runs: its address, or for a
   * workstation on another machine that address's port forwarded here (only that port: a page that
   * talks to another port there finds nothing here). The forward is made when first asked for and
   * made again when its connection dropped, on the port it had if that is still free.
   */
  private async appAt(cardId: string): Promise<string | null> {
    const app = this.o.board.item(cardId)?.agent?.app;
    const workstation = this.o.board.row(cardId).workstation;
    if (!app || !workstation) return null;
    const there = remote(workstation);
    if (!there) return app;
    let url: URL;
    try {
      url = new URL(app);
    } catch {
      return null;
    }
    let f = this.forwards.get(cardId);
    let prefer: number | undefined;
    if (f && !f.forward.alive) {
      prefer = f.port;
      this.unforward(cardId);
      f = undefined;
    }
    if (!f) {
      const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
      const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
      f = { app, workstation, forward: there.host.forward(host === '0.0.0.0' || host === '::' ? 'localhost' : host, port, prefer), port: prefer };
      this.forwards.set(cardId, f);
    }
    const local = await f.forward.ready;
    if (!local || this.forwards.get(cardId) !== f) return null;
    f.port = local;
    
    url.hostname = url.hostname === '127.0.0.1' ? '127.0.0.1' : 'localhost';
    url.port = String(local);
    return url.href;
  }

  /** Ends the forward to the card's app, if it has one. */
  private unforward(cardId: string) {
    this.forwards.get(cardId)?.forward.close();
    this.forwards.delete(cardId);
  }

  /** Whether the app the card's worker said runs answers at its address now: any HTTP answer counts, an error page too. */
  async appUp(cardId: string): Promise<boolean> {
    const url = await this.appAt(cardId);
    if (!url) return false;
    try {
      await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(PROBE_MS), tls: { rejectUnauthorized: false } });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The owner opens the card's app to try it by hand: its address. Seismic leaves it running for a
   * while after (`TRY_GRACE`), so it does not stop under them once the card waits. None once it no longer runs.
   */
  async openApp(cardId: string): Promise<string | null> {
    const url = await this.appAt(cardId);
    if (!url) return null;
    this.tried.set(cardId, Date.now());
    if (this.parking.has(cardId)) this.parkLater(cardId);
    return url;
  }

  /** A card that is no longer left waiting keeps its app. */
  private unpark(cardId: string) {
    clearTimeout(this.parking.get(cardId));
    this.parking.delete(cardId);
  }

  /**
   * The connection to the machine the card's workstation is on is gone, and the session with it (as
   * at a restart of Seismic): once that machine answers again, the session resumes by its id, with
   * the message it had not yet taken, else told what happened if it was at work (or waited for its
   * background work). A session that never started there (the host could not be reached to get
   * it ready) has no id: a new one starts with the message it was to begin with. A card that waits
   * for the owner meanwhile needs no session until their next message.
   */
  private lost(cardId: string, live: Live) {
    const there = remote(this.o.board.row(cardId).workstation);
    if (!there) return;
    this.live.delete(cardId);
    clearTimeout(live.waiting);
    limitWatch.cancel(live);
    const pending = live.pending;
    
    const busy = live.busy;
    const generation = this.generation.get(cardId);
    this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.worker.hostLost(there.host.name));
    const again = async () => {
      this.reconnecting.delete(cardId);
      const current = () => this.generation.get(cardId) === generation && !this.live.has(cardId);
      if (!current()) return;
      if (!(await there.host.reachable())) {
        if (current()) this.reconnecting.set(cardId, setTimeout(again, this.o.reconnectMs ?? RECONNECT_MS));
        return;
      }
      const row = this.o.board.row(cardId);
      const card = this.o.board.item(cardId);
      if (!current() || !card || !row.workstation || (!row.session_id && !pending) || snoozeOf(card)) return;
      const working = busy || card.state === 'working' || card.state === 'inPr' || answering(card) || !!row.landed;
      if (!pending && !working) return;
      this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.worker.hostBack(there.host.name));
      if (pending) this.launch(cardId, pending.text, row.session_id ?? undefined, pending.images);
      else this.launch(cardId, hostResumed(there.host.name), row.session_id!);
    };
    this.reconnecting.set(cardId, setTimeout(again, this.o.reconnectMs ?? RECONNECT_MS));
  }

  /**
   * A demo directory as the server reads it: the worker's own on this machine; from a worker on
   * another machine, its copy here, taken afresh at each handover.
   */
  async demoHere(cardId: string, dir: string): Promise<{ dir: string } | { wrong: string }> {
    try {
      const there = remote(this.o.board.row(cardId).workstation);
      if (!there) return { dir };
      const copy = there.host.localCopy(dir);
      await there.host.copyFrom(dir, copy);
      return { dir: copy };
    } catch (e) {
      return { wrong: messageOf(e) };
    }
  }

  /** Stops the app in the card's workstation, unless it holds what must stay (`app.keep`). */
  private async park(cardId: string) {
    const { stop, keep } = this.o.adapter.app ?? {};
    
    if (!stop) return;
    const workstation = this.o.board.row(cardId).workstation!;
    const generation = this.generation.get(cardId);
    if (keep && (await runAppCommand(workstation, keep)).ok) {
      
      if (this.generation.get(cardId) === generation && !this.live.get(cardId)?.ended) this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.worker.parkKept);
      return;
    }
    const result = await runAppCommand(workstation, stop);
    
    if (this.generation.get(cardId) !== generation) return;
    if (!result.ok) {
      this.o.board.log(cardId, 'error', 'seismic', this.o.board.t.worker.parkFailed(clip(result.output, 600)));
      return;
    }
    this.o.board.work(cardId, { parked: new Date().toISOString(), app: null });
    this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.worker.parked);
  }

  private parkedNote(): string {
    const { stop, run } = this.o.adapter.app ?? {};
    return `While the card waited, Seismic stopped the app in your workstation${stop ? ` (\`${stop}\`)` : ''} to free the machine. When you need it again, start it again${run?.trim() ? ' as the recipe in your brief says' : ''}.`;
  }

  /**
   * The usage limit stopped the worker, at work, taking in the owner's words on its handover or after
   * the landing: it goes on by itself once the limit lifts. Meanwhile it is not busy (a restart need
   * not wait for it, and resumes it into the same limit), unless its `background` work runs on,
   * which a restart would cut off; a message from the owner reaches it at once and finds out whether
   * the limit still holds.
   */
  private waitForLimit(cardId: string, live: Live, at: number, background = 0) {
    if (background > 0) this.waitForWorker(cardId, live);
    else this.setBusy(live, false);
    if (live.statusBefore === undefined) {
      
      const line = this.o.board.row(cardId).status_line;
      live.statusBefore = line && limitLine(line) ? null : line;
    }
    this.o.board.work(cardId, { status_line: this.o.board.t.worker.limitStatusUntil(this.o.board.t.when(at)) });
    limitWatch.cancel(live);
    limitWatch.wait(live, at, () => {
      if (this.live.get(cardId) !== live || !this.goesOnAfterLimit(cardId)) return;
      this.deliver(cardId, LIMIT_LIFTED);
    });
  }

  /** Whether the card's worker goes on by itself once the usage limit lifts: it is at work on the card, not waiting for the owner. */
  private goesOnAfterLimit(cardId: string): boolean {
    const card = this.o.board.item(cardId);
    if (!card) return false;
    const landed = !!this.o.board.row(cardId).landed;
    return card.state === 'working' || card.state === 'inPr' || answering(card) || (landed && card.state !== 'waiting');
  }

  /** A worker that waited for the usage limit works again: its status line is back. */
  private unlimited(cardId: string, live: Live) {
    live.limited = undefined;
    live.limitHit = false;
    this.limitAttempts.delete(cardId);
    this.o.board.waitsForLimit({ card: cardId }, undefined);
    const before = live.statusBefore;
    live.statusBefore = undefined;
    if (before !== undefined) this.o.board.work(cardId, { status_line: before });
    
    else if (limitLine(this.o.board.row(cardId).status_line)) this.o.board.work(cardId, { status_line: null });
  }

  /** A worker that went to the owner for having stopped and then works on by itself takes the question back. */
  private resumed(cardId: string, live: Live) {
    if (!live.stalled) return;
    live.stalled = false;
    const card = this.o.board.item(cardId);
    if (card?.state !== 'waiting' || card.need !== 'question') return;
    this.backToWork(cardId);
  }

  


  /**
   * A Codex worker on this machine gets `seismic_run` and `seismic_git`: Seismic runs what its sandbox
   * keeps from it (`codexExecTools.ts`). Not a review card's worker: its workstation holds a stranger's code.
   */
  execLane(cardId: string, live: Live): AgentTool[] {
    const row = this.o.board.row(cardId);
    if (!this.usesExecLane(row, live) || !row.workstation) return [];
    const workstation = row.workstation;
    return execTools({
      workstation,
      places: () => ['/tmp', '/private/tmp', tmpdir(), expandHome(this.demosDir(cardId))],
      rules: () => this.o.allowRules?.(workstation) ?? [],
      ask: (request) => this.askOwner(cardId, live, request, new AbortController().signal),
      ...(this.env() ? { env: this.env()! } : {}),
      ...(live.autoReview ? { auto: true } : {}),
    });
  }

  private usesExecLane(row: CardRow, live: Live): boolean {
    if (live.host || contributionOf(row)) return false;
    try {
      const harness = (row.agent_setting ? (JSON.parse(row.agent_setting) as AgentSetting) : null)?.harness;
      return harness === 'codex' || harness === 'agy';
    } catch {
      return false;
    }
  }

  /**
   * The card's report for whoever reads it beyond its conversation (a follow-up's worker, the
   * Koordinator, a shared page): a later handover holds only what changed, so the first one since
   * the worker started comes with what it said in the conversation after it, its replies and later
   * handovers, `latest` last.
   */
  report(cardId: string, latest: string): string {
    const events = this.o.board.events(cardId);
    const since = events.slice(events.findLastIndex(started) + 1).filter((e) => e.author === 'worker' && (e.kind === 'review' || e.kind === 'talk'));
    const first = since.findIndex((e) => e.kind === 'review');
    if (first < 0) return latest;
    return [since[first]!.text, this.o.board.t.worker.laterInConversation, ...since.slice(first + 1).map((e) => e.text), latest].join('\n\n');
  }

  /**
   * A tool call that needs a person's permission becomes the question the card waits on; the call
   * runs or is refused with the owner's answer. Meanwhile the worker waits for the owner as after
   * `ask`: a restart need not wait for it.
   */
  private askOwner(cardId: string, live: Live, request: PermissionRequest, signal: AbortSignal): Promise<PermissionAnswer> {
    const asked = (live.asking ?? Promise.resolve()).then(() => this.askNow(cardId, live, request, signal));
    live.asking = asked.catch(() => {});
    return asked;
  }

  private askNow(cardId: string, live: Live, request: PermissionRequest, signal: AbortSignal): Promise<PermissionAnswer> {
    const asked: AskedPermission = { name: request.name, input: request.input };
    if (this.granted.get(cardId)?.delete(permissionKey(asked))) return Promise.resolve({ allow: true });
    if (this.live.get(cardId) !== live || signal.aborted) return Promise.resolve({ allow: false, message: 'This session has ended. Stop working and end your turn.' });
    const t = this.o.board.t;
    const language = this.o.board.language();
    const extra = this.permissionOptions(cardId, request);
    if (extra.length) asked.extra = extra.map(({ extension, label, data }) => ({ extension, label, ...(data !== undefined ? { data } : {}) }));
    const notes = extra.flatMap((o) => (o.note?.[language] ? [o.note[language]] : []));
    const q: Question = {
      text: [t.worker.permission(permissionWhat(request.name, request.input, t), request.reason && clip(request.reason, 600)), ...notes].join('\n\n'),
      options: [t.worker.allow, ...extra.map((o) => o.label[language]), t.worker.deny],
    };
    this.o.board.log(cardId, 'question', 'worker', formatQuestion(q, this.o.board.language()));
    this.wokenForOwner(cardId);
    this.o.board.work(cardId, { state: 'waiting', need: 'question', detail: JSON.stringify({ question: q, permission: asked }) });
    this.setBusy(live, false);
    return new Promise((resolve) => {
      const answer = (value: PermissionAnswer) => {
        signal.removeEventListener('abort', abort);
        if (live.permission === answer) live.permission = undefined;
        if (this.live.get(cardId) === live) this.setBusy(live, true);
        resolve(value);
      };
      const abort = () => {
        
        
        if (signal.reason === 'permission-obsolete' && this.live.get(cardId) === live && live.permission === answer) this.backToWork(cardId);
        answer({ allow: false, message: 'This permission request has ended.' });
      };
      live.permission = answer;
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }

  /**
   * The card moves on without the owner's answer (its PR merged, a review card's closed) while a tool call of its
   * worker waits for their permission: the call is refused with `why`, so that the worker's turn goes
   * on and it hears what happened, instead of waiting for an answer to a question no longer on the card.
   */
  private refuseAsked(cardId: string, why: string) {
    this.live.get(cardId)?.permission?.({ allow: false, message: `Not run: ${why} If you still need the call, make it again; the owner is asked anew.` });
  }

  
  /** The boards a card's proposals may be on: this project's, then those of the other projects. */
  proposalBoards(): Board[] {
    return [this.o.board, ...this.otherBoards()];
  }

  otherBoards(): Board[] {
    return (this.o.otherBoards?.() ?? []).filter((b) => b !== this.o.board);
  }

  /**
   * The repository a worker names for its proposal (by id, name or path) and the board of its
   * project: this project's first, then another project's; or why there is none.
   */
  proposalRepo(wanted: string): { board: Board; repo: string } | string {
    const w = wanted.toLowerCase();
    const dir = (path: string) => path.replace(/[/\\]+$/, '');
    const named = (r: RepoRef) => r.id.toLowerCase() === w || r.name.toLowerCase() === w || dir(r.path) === dir(wanted);
    const here = this.o.board.project.repos.find(named);
    if (here) return { board: this.o.board, repo: here.id };
    const found = this.otherBoards().flatMap((board) => board.project.repos.filter(named).map((r) => ({ board, repo: r.id, path: r.path })));
    if (found.length === 1) return found[0]!;
    if (found.length > 1) return `Not proposed: several projects have a repository ${wanted}; give its path instead: ${found.map((f) => f.path).join(', ')}.`;
    const all = this.proposalBoards().flatMap((b) => b.project.repos.map((r) => r.id));
    return `Not proposed: Seismic has no repository ${wanted}; give one of ${all.join(', ')}.`;
  }

  retract(cardId: string, title: string, s: Superseded): string {
    
    const mine: Extract<Retracted, { kind: 'unknown' }>['mine'] = [];
    let r: Retracted = { kind: 'unknown', mine };
    for (const b of this.proposalBoards()) {
      const there = b.retract(cardId, title, s);
      if (there.kind !== 'unknown') {
        r = there;
        break;
      }
      mine.push(...there.mine);
    }
    if (r.kind === 'gone' || r.kind === 'marked') this.o.board.log(cardId, 'activity', 'worker', this.o.board.t.worker.withdrewProposal(r.title, s.why, s.title));
    return retractedText(r, !!s.by);
  }

  toOwner(cardId: string, q: Question) {
    this.wokenForOwner(cardId);
    this.o.board.work(cardId, { state: 'waiting', need: 'question', detail: JSON.stringify({ question: q }) });
  }

  /**
   * The card needs the owner now (its pull request closed, a tool call to allow): a snooze of its
   * worker's is over, so the card reaches them. One the owner snoozed stays paused, holding what
   * came for it meanwhile, until their answer lets it go on.
   */
  private wokenForOwner(cardId: string) {
    const s = this.o.board.snoozedOf(cardId);
    if (s && !s.waiting) this.o.board.unsnooze(cardId, 'needsYou');
  }

  private pendingQuestion(cardId: string): string | undefined {
    return this.o.board
      .events(cardId)
      .filter((e) => e.kind === 'question')
      .at(-1)?.text;
  }

  /** The owner's answer to the question `q`: in the card's log, as a decision, and for whoever learns from it. */
  private recordAnswer(card: Item, q: string, text: string, images: string[], replyTo: number | undefined, picks: string[], place?: Spot) {
    this.o.board.log(card.id, 'answer', 'owner', text, { images, replyTo, picks, ...(place ? { spot: place } : {}) });
    this.o.board.decide({ plan_id: card.parent ?? null, card_id: card.id, question: q, answer: text || '(Screenshot)', by: 'owner' });
    if (text) this.o.onOwnerInput?.(card, 'answer', text, { question: q });
    if (card.idea?.prototypeOf) this.o.onPrototypeAnswer?.(card, q, text || '(Screenshot)');
  }

  /** The card's question is settled: it goes back to its work, in its pull request, or finished (`done` when nothing landed, else `live`). */
  private backToWork(cardId: string) {
    const row = this.o.board.row(cardId);
    const landed = workerConfig.landedOf(row);
    this.o.board.work(cardId, { state: landed ? (landed.unchanged ? 'done' : 'live') : row.review?.pr ? 'inPr' : 'working', need: null, detail: null });
  }

  

  /** What a handover on this repository may bring: its settings', else the demo settings', else everything. */
  artifacts(): readonly HandoverArtifact[] {
    return this.o.adapter.demo?.artifacts ?? this.o.demoArtifacts?.() ?? HANDOVER_ARTIFACTS;
  }

  /** The language of the card's demos: the repository's, else the demo settings' narration language. */
  demoLanguage(): Language {
    return this.o.adapter.demo?.language ?? this.o.demoLanguage?.() ?? this.o.board.conversation();
  }


  /** The task the card's worker gets at its start, as Seismic would send it now (one that already ran goes on from its branch). */
  startBrief(card: Item): string {
    const row = this.o.board.row(card.id);
    return workerBriefing(this, card, row.branch ?? branchName(card.title, card.id), !!row.branch);
  }

  /** The files of the screenshots the owner attached to the card's task. */
  taskImages(card: Item): string[] {
    return this.o.imageFiles?.(card.images) ?? [];
  }

  /** Where the card's worker puts its demos: the demo settings' directory, on another machine that machine's default (the settings stay here). */
  demosDir(cardId: string): string {
    return remote(this.o.board.row(cardId).workstation) ? DEFAULT_DEMO_DIRECTORY : (this.o.demoDirectory?.() ?? DEFAULT_DEMO_DIRECTORY);
  }

  /**
   * The demo skill as a worker hears of it: by its name in the session and, for a session that
   * does not know it, by its file, on the machine the card's workstation is on.
   */
  demoSkill(cardId: string): string {
    const there = remote(this.o.board.row(cardId).workstation);
    const [name, file] = there ? [DEMO_SKILL, `~/${HOST_DIR}/${basename(SEISMIC_PLUGIN)}/skills/demo/SKILL.md`] : [demoSkillName(), DEMO_SKILL_FILE];
    return `the demo skill (\`${name}\`; if your session does not know it, read its file ${file} and follow that)`;
  }

  /** The working changes captured for the card (`Board.proposeFinishChanges`), as one patch; none for other cards. */
  captured(cardId: string): string | undefined {
    const patches = this.o.board.events(cardId).filter((e) => e.kind === 'changes').map((e) => e.text);
    return patches.length ? patches.join('\n') : undefined;
  }


  private card(id: string): Item {
    const i = this.o.board.item(id);
    if (!i) throw new BadRequest('unknownCard', 'unknown card');
    return i;
  }
}

/** Whether two clashes a review card's PR has with the local main are the same, to the owner: none, or the same commit with the same files. */
function sameClash(a: Clash | null | undefined, b: Clash | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.commit === b.commit && a.files.join('\n') === b.files.join('\n');
}

/**
 * Where Seismic pushes a review card's held commits: the PR's branch in its repository, both as the
 * forge names them and from the contributor, so taken only in a plain form (an https address, or a
 * repository on this machine, as a scratch Seismic's played forge has it; a branch name git takes).
 */
function pushTarget(c: StoredContribution): { repo: string; branch: string } | null {
  const repo = c.headRepo && (/^https:\/\/[\w.-]+(:\d+)?(\/[\w.-]+)+$/.test(c.headRepo) || isAbsolute(c.headRepo)) ? c.headRepo : null;
  const branch = c.headRef && /^[\w][\w./-]*$/.test(c.headRef) && !c.headRef.includes('..') && !c.headRef.endsWith('.lock') ? c.headRef : null;
  return repo && branch ? { repo, branch } : null;
}

/** One log line for a built-in tool call. */
export function describeTool(name: string, input: Record<string, unknown>, t: Messages): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  const file = (k: string) => s(k).split('/').slice(-2).join('/');
  switch (name) {
    case 'Read':
      return t.tool.read(file('file_path'));
    case 'Edit':
    case 'MultiEdit':
      return t.tool.edit(file('file_path'));
    case 'Write':
      return t.tool.write(file('file_path'));
    case 'Bash':
      return `$ ${clip(s('command').split('\n')[0]!, 120)}`;
    case 'Grep':
      return t.tool.grep(clip(s('pattern'), 60));
    case 'Glob':
      return t.tool.glob(clip(s('pattern'), 60));
    case 'TodoWrite':
      return t.tool.todo;
    case 'Task':
    case 'Agent':
      return `Subagent: ${clip(s('description'), 80)}`;
    default:
      return name;
  }
}

/** What a tool call that needs the owner's permission does, as the question shows it: a command whole, line by line as code, else its log line or its input. */
export function permissionWhat(name: string, input: Record<string, unknown>, t: Messages): string {
  if (name === 'Bash' && typeof input.command === 'string') return code(clip(input.command, 4000));
  const line = describeTool(name, input, t);
  return line === name ? `${name}: ${code(clip(JSON.stringify(input), 2000))}` : line;
}

/** Each line as inline code (a line that holds a backtick as it is): the card renders no code blocks. */
const code = (text: string) =>
  text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => (l.includes('`') ? l : `\`${l}\``))
    .join('\n');

const permissionKey = (p: AskedPermission) => JSON.stringify([p.name, p.input]);


/** The owner's own words on the findings they decided on go to the agent as written, after the decisions. */
function withNotes(decided: { note: string; log: string }, routed: Record<number, ChangeRoute>, notes?: Record<number, string>): { note: string; log: string } {
  const own = Object.entries(notes ?? {}).filter(([id, text]) => Number(id) in routed && text.trim());
  if (!own.length) return decided;
  return {
    note: `${decided.note}\n\nThe owner added context to these findings, in their own words:\n${own.map(([id, text]) => `Finding #${id}:\n${text}`).join('\n\n')}`,
    log: `${decided.log}\n\n${own.map(([id, text]) => `Context on finding ${id}:\n${text}`).join('\n\n')}`,
  };
}
