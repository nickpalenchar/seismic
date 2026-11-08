// What a card says on its face, worked out once for every size of it (design: Cards on the canvas,
// Card sizes): its kind, the line under its title, its state line with its marks, the pin while it
// needs the owner, and the classes and colour of its state.

import { agentFailed, answering, demoStage, finishingUp, handedOver, type Item, merging, needsYou, openQuestions, type PullRequest, snoozeOf, isPaused, isPausing, inParkingLot } from '../../core/types';
import { excerpt, plain } from '../markdown';
import { waitReason } from '../queue';
import { snoozeWho } from '../snooze';
import { becomesLabel, clock, mergeProposed, snoozeWhen, stateLabel, t } from '../strings';

/** Whether the card's state reads "Question for you": its agent asks and waits for the answer. */
export const asksYou = (i: Item) => i.state === 'waiting' && i.need === 'question' && !agentFailed(i) && !i.review?.answering && !i.review?.answered && !isPaused(i) && !isPausing(i) && !snoozeOf(i);

/**
 * The colour a card's state gives its unfolded sheet: a snoozed card's is pencil grey, as on the
 * project; a demo whose worker takes in the owner's answer is at work.
 */
export const shownState = (i: Item) => (snoozeOf(i) ? 'muted' : i.kind === 'question' ? 'question' : answering(i) ? 'working' : agentFailed(i) ? 'error' : asksYou(i) ? 'asking' : mergeProposed(i) ? 'proposal' : i.state);

/**
 * The colour of a card's state in a list (S and XS), as its card on the project shows it: paused grey,
 * at work while it finishes, a review running, a finished card green.
 */
export const cardTone = (i: Item, underway?: string): string =>
  underway || i.review?.landing
    ? 'approved'
    : snoozeOf(i) || isPaused(i) || inParkingLot(i)
      ? 'muted'
      : i.kind === 'question'
        ? 'question'
        : (i.hold?.reason === 'restart') || (i.queue && 'restart' in i.queue)
          ? 'restart'
          : answering(i) || finishingUp(i)
            ? 'working'
            : agentFailed(i)
              ? 'error'
              : asksYou(i)
                ? 'asking'
                : mergeProposed(i)
                  ? 'proposal'
                  : i.review?.codeReview?.state === 'running'
                  ? 'reviewing'
                  : i.state === 'live' || i.state === 'done'
                    ? 'approved'
                    : i.state;

/** The classes that give a card its look: its state's colour, an idea's stock, the owner's turn, an agent at it. */
export const cardClass = (item: Item, underway?: string) =>
  [
    'card',
    `s-${item.state}`,
    item.review?.codeReview?.state === 'running' && 'reviewing',
    item.idea?.discussion && `idea-${item.idea.discussion.status}`,
    item.kind === 'question' && 'q-card',
    (item.idea?.discussion?.thinking || item.idea?.proposal?.revising || item.thread?.thinking || merging(item)) && 'thinking',
    item.idea?.discussion && needsYou(item) && 'your-turn',
    agentFailed(item) && 'failed',
    underway && 'underway',
    answering(item) && 'answering',
    asksYou(item) && 'asking',
    finishingUp(item) && 'finishing',
    isPaused(item) && 'paused',
    (item.hold?.reason === 'restart') && 'restart-paused',
    item.review?.resolvingConflicts && 'resolving-conflicts',
    ((item.hold?.reason === 'limit') || item.agent?.limitedUntil) && 'limit-paused',
    snoozeOf(item) && 'snoozed',
    mergeProposed(item) && 'merge-proposed',
    item.queue && 'queued',
    item.queue && 'restart' in item.queue && 'restart-queued',
  ]
    .filter(Boolean)
    .join(' ');

/**
 * The word for what kind of card it is: a contributor's pull request, a workstream, a Question, an
 * idea, one that becomes a plan, a prototype, a plan. A plain task has none: that it is one shows.
 */
export const cardKind = (item: Item) =>
  item.review?.contribution
    ? t.review.kind(item.review.contribution.number, item.review.contribution.author)
    : item.parent
      ? t.kind.workstream
      : item.kind === 'question'
        ? t.kind.question
        : item.idea?.discussion || item.idea?.proposal?.idea
          ? t.kind.idea
          : item.idea?.becomesPlan
            ? becomesLabel(item.idea)
            : item.idea?.prototypeOf
              ? t.kind.prototype
              : item.kind === 'plan'
                ? t.kind.plan
                : '';

/** A card's pull requests still open as far as Seismic knows: its own and those in other repositories. */
const openPrs = (item: Item): PullRequest[] => [...(item.review?.pr ? [item.review.pr] : []), ...(item.review?.morePrs ?? [])].filter((p) => !p.merged && !p.closed);

/** A pull request's line on the project: its checks, a conflict, whether it is ready, and else what it waits for first. */
const prShort = (p: PullRequest) => {
  // a red check and a conflict the line names already
  const wait = p.ready ? undefined : p.waits?.find((w) => w !== 'conflict' && w !== 'checksFailed');
  return t.pr.short(`${p.repo ? `${p.repo.split('/').pop()} ` : ''}#${p.number}`, p.checks.filter((c) => c.state === 'failure').length, p.conflict, p.ready, p.held?.score, wait && t.pr.waitShort[wait]);
};

export const landedRef = (l: NonNullable<NonNullable<Item['review']>['landedPart']>) => (l.pr ? `PR #${l.pr.number}` : (l.commit?.slice(0, 7) ?? ''));

/** The first line of a card's text that says something (not a bare "Goal" label, as briefs start). */
const firstLine = (md: string) =>
  plain(md)
    .split('\n')
    .map((l) => l.replace(/^Goal\s*:?\s*/i, '').trim())
    .find(Boolean) ?? '';

/** What the card's worker is doing in its turn, after its state line: a stage of its demo in green. */
const doingNow = (item: Item) => (item.agent?.inTurn && !isPaused(item) ? item.agent.doing : undefined);

/** A mark before the state: parked off the canvas, a usage limit waited out, a snooze, a restart due, a start waiting for a restart, a question for the owner. */
export type StateMark = 'parked' | 'limit' | 'snooze' | 'restart' | 'restartQueue' | 'question';

export interface CardSummary {
  /** The kind line's word: a workstream's label, else the card's kind (`cardKind`). */
  kind: string;
  /** The line under the title: what holds the card, what it asks, its status, else the start of its text. */
  meta?: string;
  /** The state line. */
  state: {
    /** What the server does with the card after the owner's click, else its state. */
    label: string;
    /** The same in a word or two, as the smallest face says it. */
    short: string;
    marks: StateMark[];
    /** The part of it that has landed already: its pull request or commit. */
    landed?: string;
    /** What follows the state, each after a " · ". */
    notes: string[];
    /** What its agent does in its turn: `demo` a stage of its demo, `conflict` resolving conflicts. */
    doing?: { text: string; demo?: boolean; conflict?: boolean };
    /** Its agent is in a turn: the thin moving line runs under the state. */
    live: boolean;
  };
  /** The pin while the card needs the owner, and whether its agent failed. */
  pin?: { mark: string; failed: boolean; asking: boolean };
}

/** What the card's face says, the same at every size; `underway` takes the state's place. */
export function cardSummary(item: Item, underway?: string): CardSummary {
  if (item.review?.landing) underway = stateLabel(item);
  // a card whose agent finishes after the landing, opens its PR or takes in the owner's words on its handover shows its line like one at work: the usage limit it waits on, its reports
  // a review card waiting for the contributor says so in its state; what its review found shows while it waits for the owner
  const contribution = item.review?.contribution;
  const results = contribution?.results && handedOver(item) && !answering(item) ? contribution.results : undefined;
  const findings = (contribution?.findings ?? []).filter((f) => f.status !== 'dropped');
  const open = findings.filter((f) => f.status === 'open');
  const status = results
    ? [t.review.checks(results), ...(contribution?.clash ? [t.review.clashShort] : []), t.review.findings(findings.length, open.length, open.filter((f) => f.security).length)].join(' · ')
    : item.state === 'working' || item.agent?.finishing || answering(item) || (item.state === 'inPr' && (!openPrs(item).length || contribution))
      ? item.agent?.statusLine && excerpt(item.agent.statusLine)
      : item.state === 'inPr'
        ? openPrs(item).map(prShort).join(' | ')
        : undefined;
  const proposal = item.idea?.proposal;
  const superseded = item.idea?.superseded;
  const idea = item.idea?.discussion;
  // a proposal being reworked says that in place of its state: the kind line above already calls it a proposal
  const revising = item.state === 'proposal' && proposal?.revising;
  const asked = openQuestions(item)[0]?.text;
  const meta =
    (item.repoDown ? t.repoDown.short : undefined) ??
    (snoozeOf(item) ? snoozeWho(snoozeOf(item)!) : undefined) ??
    (superseded ? (superseded.by ? t.superseded.byShort(plain(superseded.title ?? '')) : t.superseded.withdrawnShort) : undefined) ??
    ((item.hold?.reason === 'limit') ? t.limitPaused : undefined) ??
    (item.agent?.limitedUntil ? t.limitedUntil(clock(item.agent.limitedUntil)) : undefined) ??
    (item.kind === 'question' && item.thread ? t.question.count(item.thread.answers, item.thread.files) : undefined) ??
    (asked === undefined ? undefined : excerpt(asked)) ??
    (item.queue && 'behind' in item.queue ? excerpt(waitReason(item.queue)) : undefined) ??
    (item.queue && 'workstation' in item.queue ? t.queue.workstationWhy[item.queue.workstation] : undefined) ??
    (item.queue && 'paused' in item.queue ? t.queue.pausedWhy : undefined) ??
    (item.queue && 'restart' in item.queue ? t.queue.restartWhy : undefined) ??
    status ??
    (idea ? firstLine(idea.brief) || firstLine(item.body) : firstLine(item.body));
  const marks: StateMark[] = underway
    ? []
    : [
        ...((inParkingLot(item) ? ['parked'] : []) as StateMark[]),
        ...(((item.hold?.reason === 'limit') || item.agent?.limitedUntil ? ['limit'] : []) as StateMark[]),
        ...((snoozeOf(item) ? ['snooze'] : []) as StateMark[]),
        ...(((item.hold?.reason === 'restart') ? ['restart'] : []) as StateMark[]),
        ...((item.queue && 'restart' in item.queue ? ['restartQueue'] : []) as StateMark[]),
        ...((asksYou(item) && !revising && !proposal?.merge ? ['question'] : []) as StateMark[]),
      ];
  const notes = [
    item.idea?.buildProposal && t.idea.proposesBuild,
    proposal?.acceptAfterRevision && t.acceptsAfterRevision,
    item.state === 'proposal' && proposal?.startAt && !proposal.idea && t.startAt.short(snoozeWhen(proposal.startAt)),
    idea?.buildAfterReply && t.idea.buildsAfterReply,
    idea?.next && needsYou(item) && t.idea.suggests[idea.next.step],
  ].filter((n): n is string => !!n);
  const now = doingNow(item);
  const doing = underway
    ? undefined
    : item.review?.resolvingConflicts
      ? { text: t.resolvingConflicts, conflict: true }
      : now && { text: item.review?.answering && !demoStage(now) ? t.feedbackDoing[now as keyof typeof t.feedbackDoing] : t.doing[now], demo: demoStage(now) };
  return {
    kind: item.plan?.label ?? cardKind(item),
    meta,
    state: {
      label: underway ?? (revising ? t.revisingShort : stateLabel(item)),
      short: underway ?? (revising ? t.revisingShort : stateLabel(item, true)),
      marks,
      landed: item.review?.landedPart && landedRef(item.review.landedPart),
      notes,
      doing: doing || undefined,
      live: !!now && !underway,
    },
    pin: needsYou(item) && !underway ? { mark: item.state === 'proposal' ? '✦' : agentFailed(item) ? '!!' : asksYou(item) ? '?' : '!', failed: agentFailed(item), asking: asksYou(item) } : undefined,
  };
}
