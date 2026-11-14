import { ReviewSeverityIcon } from './components/review-severity-icon';
import { noteClass } from './components/ai/message';
import { Car, Check, GitMerge, Lightbulb, ChevronDown, ChevronLeft, ChevronRight, Pencil, Maximize, MessageSquare, Minimize, PanelRightClose, PanelRightOpen, Play, Plus, Share, ZoomIn, ZoomOut } from 'lucide-react';
import { clientExtensions as extensions } from '../extensions/client';
// The unfolded card: what it is, what its worker does, and what the owner decides.

import { Rate } from './feedback';
import { CardMore } from './canvases';
import { createContext, type CSSProperties, Fragment, type ReactNode, type RefObject, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { agentListens, answering, askable, type BackgroundTask, buildableOn, type CardAction, type Contribution, type HeldChanges, chapterAt, prototypeWorkstream, type CardEvent, type CardPatch, type Demo, type EarlierDemo, EXPORT_HTML_MAX, finished, finishedArchivable, finishingUp, handedOver, type Item, mergeableWith, type Mock, type NextStep, type PageTags, openQuestions, pausableNow, plannableAsPlan, type PrComment, type PrReviewEntry, type PullRequest, type Question, type Finding, type FindingPick, type ReviewItem, needsOwner, type Severity, SEVERITIES, type Clash as ClashFound, type RepoRef, snoozable, type Spot, started, stopped, stoppedArchivable, taskAuthor, withSupplemented, snoozeOf, isPaused, isPausing, inParkingLot } from '../core/types';
import { mockPage } from '../core/frame';
import { mmss } from '../../plugin/skills/demo/lib/timeline.ts';
import { answers, answerText, OTHER, toggleOther } from './answer';
import { ApiError, api, projectOf, cardAt, type Field, holdRestart, onCardEvent, onCardEventGone, onReconnect } from './api';
import { cardPath } from './address';
import { Naming, smartLink } from './cardLink';
import { DuplicateMergePreview, MergeButton, MergeView } from './merge';
import { LinkField, type LinkFieldHandle } from './cardMenu';
import { useCopy } from './copy';
import { manualPrerequisites } from './deps';
import { firstOpening } from './demoSeen';
import { know, known } from './known';
import { Branch } from './diff';
import { ResultFiles, REVIEW } from './files';
import { DiscardChanges, FolderBox, FolderLine, useFolderDiff } from './folder';
import { asksYou, CardFace, cardKind, cardLook, depTagClass, faceClass, listTitleClass, listTitleTextClass, HourglassMark, LabelMarks, LabelPicks, QuestionMark, RestartMark, shownTitle, StoppedWords, Title } from './card';
import { DepArrow, LimitNotice, PauseMark, PlayMark } from './parts';
import { asksAhead, holdsNotes, queueOrder } from '../core/queue';
import { forcedText, QueueList, scrollerOf, useQueueMove, useQueueSort, waitText, type Behind } from './queue';
import { dimensions, shownTags } from '../core/page-tags';
import { CardRefs, Inline, plain } from './markdown';
import { quoteClass, Body, Cards, goToMessage, Msg, Quote, Reading, useAnswer, useReportedHeight } from './message';
import { appended, cardDraft, draftOf, dropDraft, findingDraft, giveBack, questionsKey, reviewReset, updateDraft, useDraft, useDraftField, useDrafting } from './draft';
import { eventQuote, type Reply, setReply } from './reply';
import { CiteButton } from './cite';
import { Composer } from './composer';
import { useFitHeight } from './fitHeight';
import { useFullscreen } from './fullscreen';
import { motionMs, scrollBehavior } from './motion';
import { type Box, onto, ZOOM_EASE, ZOOM_MS, zoomBox } from './zoomBox';
import { AttachButton, imageUrl, ShotStrip, Shots, useShotInput } from './shots';
import { Conversation as Scroll } from './components/ai/conversation';
import { newRepoWords, type RepoChoice, RepoPick, useRepoChoice } from './repoPick';
import { dismissPlace, type Place, seekTo, showsVersions, usePlace, videoOf, watch } from './spot';
import { cameInView, useSeen } from './seen';
import { ClockMark, SnoozeLine, SnoozeMenu, snoozeWho } from './snooze';
import { clock as time, errorText, failText, mergeProposed, shortDay, snoozeWhen, stateLabel, stoppedAtOf, t } from './strings';
import { agentWorks, cardTalk, demoHandover, talkState, koordinatorReads, ownerField, parseQuestion, snoozeLine, talkAlone, type Turn, unseenTurns, waitsFirstStart, worked as isWorked } from './talk';
import { PageChangeList } from './page-changes';
import { MadeCover } from './made';
import { WishReplyLink } from './wish';
import { claudeLoginFailed } from '../core/login';
import { Reauthenticate } from './reauthenticate';
import { describeAgent, StartAgent, startAgentMain, startAgentModel } from './start-agent';
import type { AgentSetting } from '../core/types';
import { ButtonGroup } from './components/button-group';
import { Button, type ButtonVariant, CloseButton, LinkButton } from './components/button';
import { ConfirmDialog } from './components/dialog';
import { Select, SelectItem } from './components/select';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from './components/menu';
import { CheckLabel } from './components/check-label';
import { Switch } from './components/switch';
import { Tooltip } from './components/tooltip';
import { Textarea } from './components/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/collapsible';
import { Badge, badgeVariants } from './components/badge';
import { cn } from 'cn';
import { coverClass } from './coverClasses';
import { actionsClass, bodyClass, conversationBox, conversationList, headClass, questionClass, choiceClass, choicesClass, pickTag, stateClass, statusClass, titleClass, titleFieldClass } from './cardClasses';
import { badClass, blockedFiles, bundleClass, bundleHead, checksClass, clashClass, clashPush, clashWhat, decidedLines, decidedTasks, findingChevron, findingChoices, findingClass, findingContext, findingContextButton, findingFold, findingHead, findingLog, findingNo, findingNote, findingReopen, findingRow, findingsClass, findingsHead, findingStatus, findingTag, findingText, findingWhere, fixingBadge, reviewBusy, reviewClean, reviewCount, reviewOutdated, reviewRunningDot, reviewSubmit, severityBadge, statusPill } from './reviewClasses';

/** A prototype whose idea became a plan: the workstream to build on it, on a line of its own above the buttons. */
const buildOnClass = 'build-on basis-full flex flex-col gap-1 text-xs text-muted-foreground';
/** The hint that a decision waits for the agent's reply, which the owner has already given. */
const goWaits = 'go-waits text-xs text-foreground font-semibold';
/** The prototypes the idea's agent planned, one row each, its task in two lines. */
const prototypeVariants = 'prototype-variants mt-4 max-w-[80ch]';

/**
 * What the panel does after an action: fold the card and confirm (with undo, when it has one), or stay open.
 * With `pending`, the card folds at once, before the server has answered, and says so until it has.
 */
/** `rate`: the card whose approved work the owner is asked for feedback on, once the action went through. */
export type ActDone = { close: true; ack?: string; undo?: () => unknown; pending?: string; rate?: string } | { close: false };

/** An action the server is still at, after its card has folded: the answer confirms it or tells why not. */
export type Pending = { card: string; title: string; answered: Promise<void> };

/** Words typed into a field of the card: straight to its agent where one listens, else the Koordinator reads them like spoken ones; the panel does not wait. */
type Tell = (text: string, images: string[] | undefined, field: Field, replyTo?: number) => void;

interface Props {
  item: Item;
  /** Every item on the project, to name the cards a queued card waits for. */
  all: Item[];
  /** The project's repositories; with several, the card names its own and a planned one can move. */
  repos: RepoRef[];
  parent?: Item;
  /** The card it came from: a proposal's source, a prototype's idea, a follow-up's card. */
  from?: Item;
  /** A change to the open card, or to the card `id` (an upload ending after the card closed). */
  onEdit: (p: CardPatch, id?: string) => void;
  /** Saves pending edits; actions wait for it, so the worker sees the card as typed. */
  flush: () => Promise<void>;
  onDelete: () => void;
  onDone: (d: ActDone, pending?: Pending) => void;
  /** Reads the plan doc of a workstream's plan, at the workstream; the phone view reads no plan docs. */
  onReadPlan?: (plan: Item, mark?: string) => void;
  /** Opens the configuration at the clone count (or the slots) of a repository: the card waits for a free clone or slot. Not in the phone view. */
  onClones?: (repo: string, field: 'clones' | 'slots') => void;
  /** Opens the project's settings, where it chooses its demo site. */
  onDemoSites?: () => void;
  onTell: Tell;
}

/** What a queued card waits for, each card a link that opens it in this one's place. */
function WaitsFor({ queue, all }: { queue: Behind; all: Item[] }) {
  const cards = queue.behind.map((id) => ({ card: all.find((x) => x.id === id), title: all.find((x) => x.id === id)?.title ?? id }));
  return <Naming text={(...names) => waitText(queue, all, (id) => names[queue.behind.indexOf(id)]!)} cards={cards} />;
}

/** The arrow between two covers of the chain, under the middle of the card above it. */
const chainArrowClass = 'block m-[2.5px_0_2.5px_134px]';

/**
 * The chain a queued card waits in, top to bottom as its waits run on the project: the card it waits
 * for (the first where it waits for several), the card itself (its title only), and a card that waits
 * for it (the first in the queue where several do), tagged and ringed as on the project while the
 * pointer is on the card. The cards above and below open in its place.
 */
function QueueChain({ item, all }: { item: Item; all: Item[] }) {
  const cards = useContext(Cards);
  const behind = item.queue && 'behind' in item.queue ? item.queue.behind : [];
  const first = behind.map((id) => all.find((x) => x.id === id)).find((x) => x && !x.archivedAt);
  const after = queueOrder(all).find((x) => x.queue && 'behind' in x.queue && x.queue.behind.includes(item.id));
  if (!first && !after) return null;
  const cover = (card: Item, dep: 'before' | 'after') => (
    <a
      className={coverClass(`${cardLook(card, { dep }).className} dep-${dep}`)}
      style={cardLook(card, { dep }).style}
      href={cardPath(projectOf(card.id), card)}
      onClick={(m) => {
        if (m.button || m.metaKey || m.ctrlKey || m.shiftKey || m.altKey) return;
        m.preventDefault();
        cards.open(card);
      }}
    >
      <div className={depTagClass}>{t.deps[dep]}</div>
      <CardFace item={card} size="xs" />
    </a>
  );
  return (
    <div className="q-chain flex flex-col items-start mt-5" role="group" aria-label={t.queue.chain}>
      {first && (
        <>
          {cover(first, 'before')}
          <DepArrow cls="lit-first" length={36} className={chainArrowClass} />
        </>
      )}
      <div className={coverClass(cardLook(item).className, { own: true })} style={cardLook(item).style}>
        <div className={depTagClass}>{t.queue.thisCard}</div>
        <span className={faceClass('xs')}>
          <Title item={item} className={listTitleClass('xs')} inline>
            <span className={listTitleTextClass('xs', !item.title)}>{shownTitle(item)}</span>
          </Title>
        </span>
      </div>
      {after && (
        <>
          <DepArrow cls="lit" length={36} className={chainArrowClass} />
          {cover(after, 'after')}
        </>
      )}
    </div>
  );
}

/** Where a waiting card stands in the queue, with the buttons that move it; unfolded, the queue around it, where it is dragged instead. */
function QueuePlace({ item, items }: { item: Item; items: Item[] }) {
  const m = useQueueMove(item, items);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const q = useQueueSort(items, scrollerOf(box), item.id);
  // folded under a drag: the card is not dropped anywhere
  useEffect(() => {
    if (!open) q.sort.cancel();
  }, [open]);
  if (!m) return null;
  return (
    <div className="q-place flex flex-wrap items-center gap-x-2.5 gap-y-1.5 mt-2.5 [&_.why]:basis-full" ref={box}>
      <span className="hint m-0">{m.place}</span>
      {!open && m.buttons}
      <LinkButton aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? t.queue.hide : t.queue.show}
      </LinkButton>
      {!open && m.why && <div className="hint why">{m.why}</div>}
      {open && (
        <div className="q-around basis-full">
          <QueueList items={items} q={q} />
          <p className="hint mt-1.5 mx-0 mb-0">{t.queue.dragOwn}</p>
        </div>
      )}
    </div>
  );
}

export function Detail(p: Props) {
  const { item, parent } = p;
  useReviewReset(item);
  // Bind a refusal to the merge revision submitted, including late HTTP responses after an update.
  const mergeRevision = JSON.stringify([item.id, item.idea?.proposal?.merge]);
  const [actionError, setActionError] = useState<{ text: string; mergeRevision?: string }>();
  const error = actionError && (!actionError.mergeRevision || actionError.mergeRevision === mergeRevision) ? actionError.text : '';
  // a prototype whose idea has become a plan: the workstream to build on it
  const [workstream, setWorkstream] = useState('');
  const [picking, setPicking] = useState(false);
  const [confirmReviewApproval, setConfirmReviewApproval] = useState(false);
  const [confirmUnsent, setConfirmUnsent] = useState(false);
  // whether the approval the owner is asked to confirm is "Straight to main"
  const [confirmDirect, setConfirmDirect] = useState(false);
  const unsentPicks = useFindingDraft(item).findings;
  const all = p.all;
  const duplicateMatches = (item.possibleDuplicates ?? []).map((id) => all.find((other) => other.id === id)).filter((other): other is Item => !!other);
  const duplicatePartner = duplicateMatches.find((other) => mergeableWith(item, other)) ?? duplicateMatches[0];
  const run = async (fn: () => Promise<void>, done: ActDone) => {
    setActionError(undefined);
    const answered = p.flush().then(fn);
    // what takes the server a while (a push onto main) does not hold the card open: the project shows it under way
    if (done.close && done.pending) return p.onDone(done, { card: item.id, title: plain(item.title), answered });
    try {
      await answered;
      p.onDone(done);
    } catch (e) {
      if (!(e instanceof ApiError)) console.error(e);
      setActionError({ text: failText(e), mergeRevision: item.idea?.proposal?.merge ? mergeRevision : undefined });
    }
  };
  // an approval that posts the text for the PR takes the owner's edit of it as it stands, saved or not
  const [parkedStart, setParkedStart] = useState<{ a: CardAction; done: ActDone } | null>(null);
  const [manualStart, setManualStart] = useState<{ agent?: AgentSetting; names: string } | null>(null);
  const act = (a: CardAction, done: ActDone): Promise<void> => {
    // starting a parked card takes it out of the parking lot: the owner confirms first
    if (a.action === 'start' && inParkingLot(item)) {
      setParkedStart({ a, done });
      return Promise.resolve();
    }
    return actNow(a, done);
  };
  const actNow = (a: CardAction, done: ActDone) =>
    run(async () => {
      if (a.action === 'approve' || a.action === 'pushChanges') await saveHeld(item.id);
      await api.act(item.id, a);
      // the agent picked in the Start menu is spent once the start is accepted, not before
      if (a.action === 'start' || a.action === 'force' || (a.action === 'accept' && a.start !== false)) updateDraft(cardDraft(item.id), { agent: undefined });
    }, done);
  // the repository the card is to be built in, before work on it begins: one of the project's or a new one
  const choice = useRepoChoice(item, p.onEdit);
  // in a folder without git the card's change list takes the place of its branch
  const inFolder = !!p.repos.find((r) => r.id === item.repo)?.folder;
  const changes = useFolderDiff(item, inFolder && item.kind === 'task' && !!item.agent?.branch);
  // the tab the left column shows: a file picked there or in the change list beside the handover
  const [tab, setTab] = useState<string | null>(null);
  // Seismic reads what is typed here when no agent listens on the card: the field says so, as the microphone does
  const listener = agentListens(item) ? undefined : t.voice.card(plain(item.title));
  const tell = (field: Field) => async (text: string, images?: string[], replyTo?: number) => p.onTell(text, images, field, replyTo);
  const repo = p.repos.length > 1 ? (p.repos.find((r) => r.id === item.repo)?.name ?? item.repo) : '';
  // a plain task says nothing of its kind; a contributor's pull request is named as a link below
  const kind = [repo, parent ? `${plain(parent.title)} · ${item.plan?.label ?? ''} · ${cardKind(item)}` : item.review?.contribution ? '' : cardKind(item)].filter(Boolean).join(' · ');
  // a proposal being reworked takes the agent's title and text: the fields come back with them, rather than keeping a draft
  // a stopped task keeps what it was started with: the task is its conversation's first message
  const editable = item.source === 'manual' && (item.state === 'planned' || item.state === 'idea' || item.state === 'proposal') && !item.queue && !item.idea?.proposal?.revising && !item.idea?.proposal?.merge && !item.idea?.mergingInto && !stopped(item);
  if (item.kind === 'question' && item.thread)
    return (
      <>
        <div className="p-kind">
          {[repo, cardKind(item)].filter(Boolean).join(' · ')}
          {item.archivedAt ? <LabelMarks item={item} /> : <LabelPicks item={item} />}
        </div>
        <div className={titleClass}>
          <Inline md={item.title} />
        </div>
        <QuestionView item={item} act={act} run={run} onTell={p.onTell} />
        {error && <p className="p-error">{error}</p>}
      </>
    );
  if (item.state === 'idea' && item.idea?.discussion)
    return (
      <>
        <KindLine kind={kind} item={item} />
        {item.archivedAt ? <div className={titleClass}>{shownTitle(item)}</div> : <ManualTitle item={item} onEdit={p.onEdit} />}
        <SupersededBox item={item} all={all} act={act} onDelete={p.onDelete} />
        <RepoDownBox item={item} />
        <IdeaView item={item} act={act} run={run} listener={listener} onDelete={p.onDelete} onTell={p.onTell} prototypes={!inFolder} choice={choice} repos={p.repos} />
        {error && <p className="p-error">{error}</p>}
      </>
    );
  if (item.idea?.prototypeEnd)
    return (
      <>
        {kind && <div className="p-kind">{kind}</div>}
        <div className={titleClass}>
          <Inline md={item.title} />
        </div>
        <div className={stateClass}>
          ● {stateLabel(item)}
          {archivedOn(item)}
        </div>
        <p className="hint ended">
          {item.idea?.builtInto ? t.idea.builtInto(plain(item.idea.ideaTitle ?? ''), plain(item.idea.builtInto)) : t.idea.endedLong[item.idea.prototypeEnd](plain(item.idea.ideaTitle ?? p.from?.title ?? ''))}
        </p>
        <Split
          main={
            // the summary is the handover in the conversation, the task its first message
            item.demo?.latest && <DemoView item={item} demo={item.demo.latest} autoplay={false} />
          }
          talk={<Talk item={item} past />}
        />
      </>
    );
  const worked = isWorked(item);
  // a new repository the start creates first: the button names it, a line under it says what it does
  const fresh = newRepoWords(choice, false);
  // a task waiting for its first start, planned or in the queue, keeps its text in full beside its conversation, where notes wait for its agent
  const waits = waitsFirstStart(item);
  // a demo, video or HTML artifact, goes to a page where the repository has a share target, else it is exported as a file; prototypes stay here
  const shares = p.repos.find((r) => r.id === item.repo);
  // about the demo shown, the latest or an earlier one
  const sharing = !!item.demo?.latest && !item.idea?.prototypeOf;
  const shareBox = (demo: Demo) =>
    shares?.share || item.demo?.share ? (
      <ShareBox
        item={item}
        demo={demo}
        act={act}
        onApproval={!!shares?.shareOnApproval}
        vocabulary={shares?.shareTags}
        unlisted={item.demo?.share ? !!item.demo.share.unlisted : !!shares?.shareUnlisted}
      />
    ) : (
      <ExportBox item={item} demo={demo} run={run} needs={shares?.shareNeeds} site={shares?.shareSite} onDemoSites={p.onDemoSites} />
    );
  // a prototype is discarded or its idea built on it, never approved or deleted; built once the idea's agent has taken in what changed
  const ideaTitle = plain(item.idea?.ideaTitle ?? p.from?.title ?? '');
  // once the idea has become a plan, one of its workstreams is built on the prototype instead
  const plan = item.idea?.prototypeOf ? all.find((i) => i.kind === 'plan' && i.plan?.origin === item.idea?.prototypeOf) : undefined;
  const ideaCard = item.idea?.prototypeOf ? all.find((i) => i.id === item.idea?.prototypeOf) : undefined;
  const builtOn = item.idea?.builtOn ? item.idea?.prototypes?.find((x) => x.id === item.idea?.builtOn) : undefined;
  const workstreams = plan ? all.filter((i) => i.parent === plan.id && buildableOn(i)) : [];
  // the plan doc says which workstream builds on the prototypes; the owner picks only where it does not, or another
  const named = plan && !picking ? prototypeWorkstream(all, plan.id) : undefined;
  const chosen = named ?? workstreams.find((w) => w.id === workstream);
  const ideaThinking = !plan && !!p.from?.idea?.discussion?.thinking;
  const planning = !plan && !!p.from?.idea?.becomesPlan;
  const buildOn = (label: string) => (
    <Button
      variant="primary"
      disabled={ideaThinking || planning || (!!plan && !chosen)}
      title={ideaThinking ? t.idea.prototypeWaits : planning ? t.idea.waitForPlan : plan && !chosen ? t.idea.chooseWorkstream : undefined}
      onClick={() =>
        act(
          { action: 'buildPrototype', ...(chosen ? { workstream: chosen.id } : {}) },
          { close: true, ack: chosen ? t.idea.builtWorkstream(workstreamName(chosen)) : t.idea.builtPrototype(ideaTitle) },
        )
      }
    >
      {label}
    </Button>
  );
  const workstreamPick = plan && named ? (
    <div className={buildOnClass}>
      <span>
        {t.idea.buildsWorkstream(workstreamName(named))}{' '}
        <LinkButton onClick={() => setPicking(true)}>
          {t.idea.otherWorkstream}
        </LinkButton>
      </span>
    </div>
  ) : plan && (
    <label className={buildOnClass}>
      {t.idea.workstreamOf(plain(plan.title))}
      <Select value={workstream} onValueChange={(picked) => setWorkstream(picked)}>
        <SelectItem value="">{workstreams.length ? t.idea.chooseWorkstream : t.idea.noWorkstream}</SelectItem>
        {workstreams.map((w) => (
          <SelectItem key={w.id} value={w.id}>
            {workstreamName(w)}
          </SelectItem>
        ))}
      </Select>
    </label>
  );
  const prototypeActions = item.idea?.prototypeOf && (
    <>
      {item.agent?.branch && workstreamPick}
      {item.agent?.branch && buildOn(t.idea.buildPrototype)}
      <Button onClick={() => act({ action: 'discard' }, { close: true, ack: t.idea.discarded })}>
        {t.idea.discard}
      </Button>
    </>
  );

  // work that changes nothing in the repository ends with the approval: no pull request, nothing lands
  // where work goes out as a pull request, the button says so, and where the settings allow it the
  // owner may have it pushed onto main directly instead; a card's own branch may change both
  const repoRef = p.repos.find((r) => r.id === item.repo);
  const pr = !inFolder && !item.review?.noChange && (item.review?.lands?.land ?? (repoRef?.pullRequests ? 'pr' : 'main')) === 'pr';
  const direct = pr && (item.review?.lands?.direct ?? !!repoRef?.direct);
  // a project that reviews work on the owner's word: the latest handover not reviewed yet (or its review failed)
  const cr = item.review?.codeReview;
  // the agent fixing items the owner sent it, and items waiting for the next review, count as part of the review: Approve warns the same way
  const fixing = !!cr?.items.some((r) => r.status === 'fixing');
  const verifying = !!cr?.items.some((r) => r.status === 'underReview');
  // work that changed nothing has nothing to land, so a review still at work does not change what approving does
  const reviewRunning = !item.review?.noChange && (cr?.state === 'running' || fixing || verifying);
  const approvalWarningClass = startAgentMain;
  const approvalWarning = reviewRunning && <span className={startAgentModel}>{cr?.state === 'running' || (verifying && !fixing) ? t.approveDuringReview.reviewing : t.approveDuringReview.fixing}</span>;
  // choices on items picked but not sent yet: approving would drop them
  const unsent = Object.keys(unsentPicks ?? {}).filter((id) => cr?.items.some((r) => r.number === Number(id) && needsOwner(r))).length;
  const reviewed = cr?.state === 'done' && !cr.stale;
  const asksReview = !!cr && cr.mode === 'manual' && (!cr.state || !!cr.stale || cr.state === 'failed' || (cr.state === 'done' && verifying));
  // approval asks first where choices are unsent or a review is still at work, the same for "Straight to main"
  const approveNow = (direct: boolean) =>
    void act(
      direct ? { action: 'approve', direct: true } : { action: 'approve' },
      direct ? { close: true, ack: t.approvedDirect, pending: t.approvingDirect, rate: item.id } : item.review?.noChange ? { close: true, ack: t.approvedNoChange, rate: item.id } : { close: true, ack: t.approved, pending: t.approving, rate: item.id },
    );
  const approve = (direct: boolean) => {
    if (unsent || reviewRunning) (setConfirmDirect(direct), unsent ? setConfirmUnsent(true) : setConfirmReviewApproval(true));
    else approveNow(direct);
  };
  const approveButton = item.review?.landing ? null : item.review?.contribution ? (
    <ApproveReview c={item.review?.contribution} act={act} />
  ) : inFolder ? (
    <>
      <Button variant={item.review?.noChange ? 'success' : 'primary'} title={item.review?.noChange ? undefined : t.folder.approveHint} onClick={() => act({ action: 'approve' }, item.review?.noChange ? { close: true, ack: t.approvedNoChange, rate: item.id } : { close: true, ack: t.folder.approved, rate: item.id })}>
        {item.review?.noChange ? t.approveNoChange : t.approve}
      </Button>
      <DiscardChanges diff={changes.diff} act={act} onDone={changes.reload} />
    </>
  ) : (
    <>
      {/* while yellow, a second line inside it says why, as on the start buttons */}
      <Button variant={reviewRunning ? 'review-warning' : item.review?.noChange ? 'success' : 'primary'} className={reviewRunning ? approvalWarningClass : undefined} onClick={() => approve(false)}>
        <span>{item.review?.noChange ? t.approveNoChange : pr ? t.approvePr : t.approve}</span>
        {approvalWarning}
      </Button>
      {unsent > 0 && (
        <ConfirmDialog
          open={confirmUnsent}
          onOpenChange={setConfirmUnsent}
          title={t.unsentChoices.title}
          confirm={{ label: t.unsentChoices.approve, onClick: () => { setConfirmUnsent(false); approveNow(confirmDirect); } }}
          cancel={t.unsentChoices.back}
        >
          <p>{t.unsentChoices.body(unsent)}</p>
        </ConfirmDialog>
      )}
      {reviewRunning && (
        <ConfirmDialog
          open={confirmReviewApproval}
          onOpenChange={setConfirmReviewApproval}
          title={t.approveDuringReview.title}
          confirm={{ label: t.approveDuringReview.land, onClick: () => { setConfirmReviewApproval(false); approveNow(confirmDirect); } }}
          cancel={t.approveDuringReview.continue}
        >
          <p>{t.approveDuringReview.body}</p>
        </ConfirmDialog>
      )}
      {/* where the owner starts code reviews themselves: beside Approve, in its own colour, until the latest handover is reviewed */}
      {asksReview && (
        <Button variant="code-review" title={t.codeReview.startHint} onClick={() => (setTab(REVIEW), act({ action: 'codeReview' }, { close: false }))}>
          {t.codeReview.start}
        </Button>
      )}
      {direct && (
        <Button variant={reviewRunning ? 'review-warning' : 'default'} className={reviewRunning ? approvalWarningClass : undefined} title={t.directHint(reviewed)} onClick={() => approve(true)}>
          <span>{t.approveDirect}</span>
          {approvalWarning}
        </Button>
      )}
    </>
  );

  // work waiting for the owner's verdict, with a demo or a summary
  const review = handedOver(item);
  const demoWaits = item.state === 'waiting' && item.need === 'demo';
  // an agent is on the card and can be stopped
  const running = item.state === 'working' || item.state === 'waiting' || !!item.agent?.finishing;
  const archivable = finishedArchivable(item);
  // a stopped task starts again, or goes into the archive with its conversation, from the row below it
  const halted = stopped(item) && !item.queue;
  // on a planned card, queued or not: a suggested card it cannot merge with can still be dismissed
  const duplicateActions = duplicatePartner && mergeProposed(item) && <ButtonGroup className="duplicate-merge-actions inline-flex align-middle">
    <Button className="duplicate-attempt bg-proposal text-proposal-foreground" disabled={!mergeableWith(item, duplicatePartner)} onClick={() => act({ action: 'merge', with: duplicatePartner.id }, { close: false })}>{t.duplicate.attempt}</Button>
    <Button className="duplicate-dismiss bg-proposal/12 text-foreground" onClick={() => act({ action: 'dismissDuplicate' }, { close: false })}>{t.duplicate.dismiss}</Button>
  </ButtonGroup>;
  const duplicateNotice = duplicatePartner && mergeProposed(item) && <div className={questionClass('duplicate-notice')}>
    <h4>{t.duplicate.title}</h4>
    <p>{t.duplicate.detail}</p>
    <DuplicateMergePreview item={item} partner={duplicatePartner} />
    {duplicateMatches.length > 1 && <p className="hint">{t.duplicate.more(duplicateMatches.length - 1)}: {duplicateMatches.filter((other) => other.id !== duplicatePartner.id).map((other) => plain(other.title)).join(', ')}</p>}
  </div>;
  // an archived plan's doc is gone
  const readPlan = parent && !parent.archivedAt && p.onReadPlan;
  // a workstream names its plan doc at the top in every state, an agent's work its branch beside it
  const where = (worked || parent?.plan?.file || item.review?.contribution) && (
    <p className="p-src mt-[22px] text-muted-foreground text-[12.5px] [&_code]:text-[12px]">
      {item.review?.contribution && (
        <>
          <a href={item.review?.contribution.url} target="_blank" rel="noreferrer">
            {t.review.kind(item.review?.contribution.number, item.review.contribution.author)} ↗
          </a>
          {worked && ' · '}
        </>
      )}
      {worked && (inFolder ? <FolderLine item={item} diff={changes.diff} sizeBelow={!talkAlone(item)} /> : item.agent?.branch && <Branch item={item} sizeBelow={!talkAlone(item)} />)}
      {parent?.plan?.file && (
        <>
          {worked && item.agent?.branch && ' · '}
          <code>{parent.plan.file}</code>{' '}
          {readPlan && (
            <LinkButton onClick={() => readPlan(parent, item.plan?.label)}>
              {t.plan.readAt}
            </LinkButton>
          )}
        </>
      )}
    </p>
  );
  // what a card in the queue waits for, with the buttons that start it anyway or take it out of the queue
  const queueBox = item.state === 'planned' && item.queue && (
    <div className={questionClass('queue')}>
      {'checking' in item.queue ? (
        <>
          <div className="q-text">{t.queue.checkingLong}</div>
          <div className={actionsClass}>
            <Button title={t.queue.checkingStopHint} onClick={() => act({ action: 'dequeue' }, { close: true, ack: t.queue.checkingStopped })}>
              {t.stop}
            </Button>
          </div>
        </>
      ) : 'restart' in item.queue ? (
        <>
          <div className="q-text">{t.queue.restartLong}</div>
          <QueuePlace item={item} items={all} />
          <div className={actionsClass}>
            <Button onClick={() => act({ action: 'dequeue' }, { close: false })}>
              {t.queue.dequeue}
            </Button>
          </div>
        </>
      ) : 'paused' in item.queue ? (
        <>
          <div className="q-text">{t.queue.pausedLong}</div>
          <QueuePlace item={item} items={all} />
          <div className={actionsClass}>
            <Button onClick={() => act({ action: 'dequeue' }, { close: false })}>
              {t.queue.dequeue}
            </Button>
          </div>
        </>
      ) : 'workstation' in item.queue ? (
        <>
          <div className="q-text">
            {t.queue.workstationLong[item.queue.workstation]}{' '}
            {p.onClones && (
              <LinkButton onClick={() => p.onClones?.(item.repo, item.queue && 'workstation' in item.queue && item.queue.workstation === 'slots' ? 'slots' : 'clones')}>
                {t.queue.workstationConfig[item.queue.workstation]}
              </LinkButton>
            )}
          </div>
          <QueuePlace item={item} items={all} />
          <div className={actionsClass}>
            <Button onClick={() => act({ action: 'dequeue' }, { close: false })}>
              {t.queue.dequeue}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="q-text">
            <WaitsFor queue={item.queue} all={all} />
          </div>
          <QueueChain item={item} all={all} />
          <QueuePlace item={item} items={all} />
          <div className={actionsClass}>
            <StartAgent
              draft={cardDraft(item.id)}
              variant="default"
              saved={item.agent?.workerSetting}
              label={t.queue.force}
              codexAllowed={!inFolder && !item.review?.contribution}
              onStart={(agent) => {
                const waiting = manualPrerequisites(item, all);
                if (waiting.length) {
                  setManualStart({ agent, names: waiting.map((card) => plain(card.title)).join(', ') });
                  return;
                }
                return act({ action: 'force', ...(agent ? { agent } : {}) }, { close: true, ack: forcedText(item.queue), pending: t.queue.checking });
              }}
            />
            <Button onClick={() => act({ action: 'dequeue' }, { close: false })}>
              {t.queue.dequeue}
            </Button>
          </div>
        </>
      )}
    </div>
  );
  // a decided idea keeps what it was decided on, and how
  const brief = item.idea?.brief !== undefined && (
    <>
      {item.idea?.brief.trim() && (
        <div className={questionClass('brief')}>
          <h4>{t.idea.brief}</h4>
          <Body md={item.idea?.brief} />
          <Mocks mocks={item.idea?.mocks} />
        </div>
      )}
      <PrototypeDemos item={item} />
    </>
  );

  return (
    <CardRefs.Provider value={smartLink}><DescriptionEdit.Provider value={p.onEdit}>
      <ConfirmDialog
        open={!!manualStart}
        onOpenChange={(open) => !open && setManualStart(null)}
        title={t.queue.confirmManualStartTitle}
        confirm={{ label: t.queue.force, onClick: () => { const choice = manualStart; if (choice) void act({ action: 'force', ...(choice.agent ? { agent: choice.agent } : {}) }, { close: true, ack: forcedText(item.queue!), pending: t.queue.checking }); } }}
        cancel={t.queue.confirmManualStartBack}
      >
        <p>{manualStart && t.queue.confirmManualStart(manualStart.names)}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={!!parkedStart}
        onOpenChange={(o) => !o && setParkedStart(null)}
        title={t.parking.confirmTitle}
        confirm={{ label: t.parking.confirm, onClick: () => { const s = parkedStart; if (s) void actNow(s.a, s.done); } }}
        cancel={t.parking.back}
      >
        <p>{t.parking.confirmText}</p>
      </ConfirmDialog>
      <KindLine kind={kind} item={item} />
      {editable ? <ManualTitle item={item} onEdit={p.onEdit} /> : <div className={titleClass}>{shownTitle(item)}</div>}
      <div className={cn(stateClass, finishingUp(item) && 'finishing', (isPaused(item) || snoozeOf(item) || inParkingLot(item)) && 'paused', (item.hold?.reason === 'restart') && 'restart-paused', item.queue && 'restart' in item.queue && 'restart-paused', item.review?.resolvingConflicts && 'resolving-conflicts', item.review?.codeReview?.state === 'running' && 'reviewing', mergeProposed(item) && 'merge-proposed', item.idea?.proposal?.merge && 'merging')}>
        {mergeProposed(item) ? <Lightbulb className="merge-mark" size={13} aria-hidden /> : item.idea?.proposal?.merge ? <GitMerge className="merge-mark" size={13} strokeWidth={1.75} aria-hidden /> : asksYou(item) ? <QuestionMark /> : (item.hold?.reason === 'restart') ? <RestartMark /> : item.queue && 'restart' in item.queue ? <HourglassMark /> : inParkingLot(item) ? <Car size={13} aria-hidden /> : item.state === 'proposal' ? '✦' : '●'} {stoppedAtOf(item) ? <StoppedWords stopped={stoppedAtOf(item)!} /> : stateLabel(item)}
        {snoozeOf(item) ? (
          <span className={statusClass}> · {snoozeWho(snoozeOf(item)!)}</span>
        ) : item.review?.resolvingConflicts ? (
          <span className={cn(statusClass, 'conflict')}> · {t.resolvingConflicts}</span>
        ) : (
          item.agent?.statusLine && (item.state === 'working' || item.state === 'inPr' || item.agent.finishing || answering(item)) && <span className={statusClass}> · {item.agent.statusLine}</span>
        )}
        <Limited item={item} />
        {archivedOn(item)}
      </div>
      {where}
      {extensions.map((e, i) => { const Slot = e.slots?.detail; return Slot ? <Slot key={i} item={item} /> : null; })}
      {extensions.some((e) => e.slots?.cardActions) && <Collapsible className="extension-actions"><CollapsibleTrigger asChild><Button>{t.extensionActions}</Button></CollapsibleTrigger><CollapsibleContent className={actionsClass}>{extensions.map((e, i) => { const Slot = e.slots?.cardActions; return Slot ? <Slot key={i} item={item} /> : null; })}</CollapsibleContent></Collapsible>}

      <SupersededBox item={item} all={all} act={act} onDelete={p.onDelete} />
      <RepoDownBox item={item} />

      {item.idea?.mergingInto && (
        <p className="hint merge-into">
          <Naming text={t.merge.into} cards={[{ card: all.find((i) => i.id === item.idea?.mergingInto) }]} />
        </p>
      )}
      {item.idea?.proposal?.merge && <MergeView item={item} partner={all.find((i) => i.id === item.idea!.proposal!.merge!.with)} act={act} error={error} />}
      {item.state === 'proposal' && !item.idea?.proposal?.merge && (
        <ProposalView item={item} all={all} from={p.from} act={act} listener={listener} onRevise={tell('revise')} codexAllowed={!inFolder && !item.review?.contribution}>
          {editable ? (
            <ManualFields item={item} repos={p.repos} choice={choice} onEdit={p.onEdit} grow />
          ) : (
            <>
              <Description item={item} />
              <Shots ids={item.images} />
            </>
          )}
        </ProposalView>
      )}

      {error && !item.idea?.proposal?.merge && <p className="p-error" role="alert">{error}</p>}
      {!item.idea?.proposal?.merge && <>
      {!waits && queueBox}

      {item.idea?.prototypeOf && (
        <p className="hint">
          {plan ? (
            <Naming text={t.idea.prototypeOfPlan} cards={[{ card: ideaCard, title: ideaTitle }, { card: plan }]} />
          ) : (
            <Naming text={planning ? t.idea.prototypeOfPlanning : t.idea.prototypeOf} cards={[{ card: ideaCard, title: ideaTitle }]} />
          )}
        </p>
      )}
      {item.idea?.buildProposal && (
        <div className={questionClass('proposal')}>
          <h4>{t.idea.buildProposal}</h4>
          <div className="q-text">{item.idea?.buildProposal}</div>
          <div className={actionsClass}>
            {workstreamPick}
            {buildOn(t.idea.acceptBuild)}
          </div>
        </div>
      )}
      {item.idea?.builtOn && (
        <p className="hint">
          <Naming text={t.idea.builtOn} cards={[{ card: builtOn, title: builtOn?.title ?? '' }]} />
        </p>
      )}
      {p.from && !item.idea?.prototypeOf && item.state !== 'proposal' && <p className="hint"><Naming text={t.followUpOf} cards={[{ card: p.from }]} /></p>}
      {!p.from && item.fromElsewhere && item.state !== 'proposal' && <FromElsewhere item={item} />}

      <LastFailure item={item} />

      {item.state === 'planned' && !item.idea?.proposal?.merge && !worked && !waits && (
        <>
          {editable ? (
            <ManualFields item={item} repos={p.repos} choice={choice} fresh onEdit={p.onEdit} />
          ) : (
            <>
              <Description item={item} />
              <Shots ids={item.images} />
            </>
          )}
        </>
      )}
      {!waits && duplicateNotice}

      {/* what the card changed in a folder without git stays in view: in its left column, or above its conversation where it has none */}
      {worked && inFolder && talkAlone(item) && <FolderBox item={item} diff={changes.diff} />}
      {worked && talkAlone(item) && item.review?.blocked && item.state === 'waiting' && !!ownerField(item) && <Blocked item={item} act={act} />}
      {waits ? (
        <Split
          main={
            <>
              {queueBox}
              {editable ? (
                <ManualFields item={item} repos={p.repos} choice={choice} fresh onEdit={p.onEdit} grow />
              ) : (
                <>
                  <Description item={item} />
                  <Shots ids={item.images} />
                </>
              )}
              {duplicateNotice}
            </>
          }
          talk={<TaskTalk item={item} act={act} tell={tell} />}
          cite={!!ownerField(item) && cardDraft(item.id)}
        />
      ) : worked ? (
        // what came of the work on the left, once there is something, the conversation with the owner's one field on the right;
        // the task is the conversation's first message, and the summary its handover
        <Split
          main={
            !talkAlone(item) && (
              <>
                {/* a workstream's text in its plan doc stays in view in every state: the task it is, ahead of what came of it */}
                {item.source === 'plan' && (
                  <div className="p-plan mb-[18px] [&_.p-h+*]:mt-0 [&_.fold>:first-child]:mt-0">
                    <h4 className={headClass}>{t.talk.opening.plan}</h4>
                    {/* in full, the column scrolls; above a demo or the files it made a few lines, so what came of the work stays in view below */}
                    {item.demo?.latest || item.demo?.files ? (
                      <Fold lines={3}>
                        <Body md={item.body} />
                      </Fold>
                    ) : (
                      <Body md={item.body} />
                    )}
                  </div>
                )}
                {/* what a review card's agent found comes first, at a glance above its demo */}
                {item.review?.contribution && (item.review.contribution.results || item.review.contribution.findings || item.review.contribution.clash) && <Findings
                    item={item}
                    decides={!!ownerField(item) && !finished(item.state)}
                    onPush={() => act({ action: 'pushMain' }, { close: true, ack: t.review.pushing(item.review!.contribution!.number), undo: () => api.act(item.id, { action: 'keepMain' }) })}
                  />}
                {/* an approval the checkout's own changes kept from landing: what is in the way, and the offer to fold it into the card */}
                {item.review?.blocked && item.state === 'waiting' && !!ownerField(item) && <Blocked item={item} act={act} />}
                {/* the last handover's demo stays while the agent works on the card again; a new handover replaces it. Beside it, the files the work made or changed */}
                <ResultFiles
                  item={item}
                  tab={tab}
                  onTab={setTab}
                  {...(item.review?.codeReview?.state || item.review?.codeReview?.items.length ? { review: reviewTab(item, act) } : {})}
                  {...(inFolder ? { diff: changes.diff } : {})}
                  demo={
                    item.demo?.latest && (
                      <DemoView
                        item={item}
                        demo={item.demo?.latest}
                        autoplay={demoWaits}
                        comments={agentListens(item)}
                        top={
                          (!demoWaits || sharing) &&
                          ((shown, latest) => (
                            <>
                              {!demoWaits && latest && (
                                <p className="hint">
                                  {shown.asked && item.state === 'waiting' && item.need === 'question'
                                    ? t.demo.asked
                                    : item.state === 'working' || item.state === 'waiting'
                                      ? shown.asked
                                        ? t.demo.askedAgain
                                        : t.demo.again
                                      : t.demo.kept}
                                </p>
                              )}
                              {/* drafts shown with a question are not the work's demo: the handover brings the one to share */}
                              {sharing && !shown.asked && shareBox(shown)}
                            </>
                          ))
                        }
                      />
                    )
                  }
                />
                {item.review?.pr && (item.state === 'inPr' || item.state === 'waiting') && (
                  <PrBox pr={item.review?.pr} {...(item.review.contribution?.held && item.state === 'waiting' ? { held: item.review.contribution.held, author: item.review.contribution.author, card: item.id, save: (body: string) => api.act(item.id, { action: 'editHeld', body }) } : {})} />
                )}
                {(item.state === 'inPr' || item.state === 'waiting') && item.review?.morePrs?.map((pr) => <PrBox key={pr.url} pr={pr} />)}
                {item.state === 'inPr' && !item.review?.pr && <p className="hint">{t.pr.opening}</p>}
                {item.agent?.finishing && finished(item.state) && <p className="hint">{item.agent.followUp ? t.followingUpLong : item.state === 'done' ? t.finishingDoneLong : t.finishingLong}</p>}
                {brief}
              </>
            )
          }
          // what is typed into a card waiting to start waits for its agent, not for Seismic
          talk={<TaskTalk item={item} listener={holdsNotes(item) ? undefined : listener} act={act} tell={tell} />}
          cite={!!ownerField(item) && cardDraft(item.id)}
        />
      ) : (
        <>
          {brief}
          {item.state !== 'planned' && item.state !== 'proposal' && (
            <>
              <Description item={item} />
              <Shots ids={item.images} />
            </>
          )}
          {/* a card nobody worked on shows its conversation once there is something, such as a talk with the Koordinator */}
          {item.state !== 'proposal' && (
            <TalkColumn bare>
              <Conversation item={item} past hideEmpty />
            </TalkColumn>
          )}
        </>
      )}


      {/* approved work asks how the agent did until answered, and keeps the answer to change */}
      {item.review?.rate && <Rate item={item} />}

      {item.state === 'planned' && item.queue && <div className={actionsClass}>{duplicateActions || <MergeButton item={item} all={all} act={act} />}</div>}

      {/* the decisions of a card nobody worked on yet, below what it shows, as on every card */}
      {item.state === 'planned' && !item.idea?.proposal?.merge && !worked && !item.queue && (
        <div className={actionsClass}>
          {/* one snoozed to start later starts now with "Wake now" on its line in the conversation */}
          {item.idea?.newRepo?.due ? (
            <Armed label={t.repoPick.making(choice.name)} undo={t.undo} onUndo={() => act({ action: 'stayHere' }, { close: false })} />
          ) : (
            !snoozeOf(item) && (
              item.idea?.newRepo ? <Button variant="primary" disabled={!!fresh && !fresh.ready} title={fresh?.hint} onClick={() => act({ action: 'start' }, { close: true, pending: t.queue.checking })}>{fresh?.button ?? t.start}</Button> : <StartAgent
                draft={cardDraft(item.id)}
                label={fresh?.button ?? t.start}
                disabled={!!fresh && !fresh.ready}
                title={fresh?.hint ?? (inFolder ? t.folder.startHint : t.startHint)}
                codexAllowed={!inFolder && !item.review?.contribution}
                onStart={(agent) => act({ action: 'start', ...(agent ? { agent } : {}) }, { close: true, pending: t.queue.checking })}
              />
            )
          )}
          {duplicateActions}
          <Later item={item} act={act} />
          {prototypeActions}
          {item.source === 'manual' && !item.idea?.prototypeOf && (
            <>
              {!duplicatePartner && <MergeButton item={item} all={all} act={act} />}
              {/* a task with a branch has work already, one decided as a plan goes its way: neither is discussed or planned anew */}
              {plannableAsPlan(item) && (
                <>
                  <Button
                    title={t.idea.makeIdeaHint}
                    onClick={async () => {
                      await p.flush();
                      p.onEdit({ state: 'idea' });
                      await p.flush();
                    }}
                  >
                    {t.idea.makeIdea}
                  </Button>
                  <Button title={t.idea.planDocHint} onClick={() => act({ action: 'planDoc' }, { close: true, ack: t.idea.planned })}>
                    {t.idea.planDoc}
                  </Button>
                </>
              )}
              <Button variant="danger" onClick={p.onDelete}>
                {t.delete}
              </Button>
            </>
          )}
        </div>
      )}

      {/* the decisions go below both columns, as on an idea or a proposal */}
      {worked && (running || archivable || halted || snoozable(item)) && (
        <div className={actionsClass}>
          {/* the explanation sticks with the decision it belongs to */}
          {review && item.review?.noChange && !item.idea?.prototypeOf && (
            <p className="wontfix-callout m-0 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm" role="note">{inFolder ? t.folder.noChangeHint : t.noChangeHint}</p>
          )}
          {halted && !item.archivedAt && (
            <StartAgent draft={cardDraft(item.id)} label={t.startAgain} title={t.startAgainHint} codexAllowed={!inFolder && !item.review?.contribution} onStart={(agent) => act({ action: 'start', ...(agent ? { agent } : {}) }, { close: true, pending: t.queue.checking })} />
          )}
          {review ? prototypeActions || approveButton : (running || (halted && !item.archivedAt)) && prototypeActions}
          <Later item={item} act={act} />
          {running && (
            <Button disabled={item.review?.landingPosition === 0} title={item.review?.landingPosition === 0 ? stateLabel(item) : t.stopHint} onClick={() => act({ action: 'stop' }, { close: true, ack: t.stopped })}>
              {t.stop}
            </Button>
          )}
          {(archivable || (halted && !item.idea?.prototypeOf && item.source === 'manual')) && <ArchiveButton item={item} run={run} />}
          {halted && !item.archivedAt && item.source === 'manual' && !item.idea?.prototypeOf && (
            <Button variant="danger" onClick={p.onDelete}>
              {t.delete}
            </Button>
          )}
        </div>
      )}
      {item.state === 'planned' && !item.idea?.proposal?.merge && !worked && !item.queue && fresh && <p className="hint">{fresh.hint}</p>}
      {review && item.demo?.latest && sharing && !item.demo.latest.asked && (shares?.share || item.demo.share) && sharesLater(item, item.demo.latest, !!shares?.shareOnApproval) && <ShareOnApproval item={item} act={act} />}
      {review && item.review?.modelsUnchanged && <p className="hint">{t.modelsUnchanged(item.review.modelsUnchanged)}</p>}
      {review && direct && !item.idea?.prototypeOf && <p className="hint">{t.directHint(reviewed)}</p>}
      </>}
    </DescriptionEdit.Provider></CardRefs.Provider>
  );
}

/** Beside the card's state: its agent (not its worker, which says so in its status line) waits for the usage limit, until when. */
const Limited = ({ item }: { item: Item }) => (item.agent?.limitedUntil ? <span className={statusClass}> · {t.limitedUntil(time(item.agent.limitedUntil))}</span> : null);

/** When the card went into the archive, after its state. */
const archivedOn = (i: Item) => i.archivedAt && <span className={statusClass}> · {t.archive.when(new Date(i.archivedAt))}</span>;

/**
 * "Later" in a card's action row, on any card the owner can snooze that is not snoozed yet (a
 * snoozed one changes its time on its line in the conversation).
 */
function Later({ item, act }: { item: Item; act: (a: CardAction, done: ActDone) => Promise<void> }) {
  if (!snoozable(item) || snoozeOf(item)) return null;
  return <SnoozeMenu label={t.snooze.button} onSnooze={(until) => void act({ action: 'snooze', until }, { close: false })} />;
}

/**
 * Approving a review card: "Merge (PR #5)", or where its agent's own changes wait for the approval,
 * "Push and merge" with "Push and comment only" beside it (the merge later), and with
 * requests to the contributor beside them "Push and send to …", which merges nothing and
 * leaves the card waiting for them.
 */
function ApproveReview({ c, act }: { c: Contribution; act: (a: CardAction, done: ActDone) => Promise<void> }) {
  const go = (ack: string, pending: string) => act({ action: 'approve' }, { close: true, ack, pending });
  if (c.held?.asks.length)
    return (
      <Button variant="primary" title={t.review.pushSendHint(c.author)} onClick={() => go(t.review.pushedSent(c.author), t.review.pushingHeld)}>
        {t.review.pushSend(c.author)}
      </Button>
    );
  const label = c.held ? (c.clash ? t.review.pushMergeAnyway(c.number) : t.review.pushMerge(c.number)) : c.clash ? t.review.mergeAnyway(c.number) : t.review.merge(c.number);
  return (
    <>
      <Button variant="primary" title={c.clash ? t.review.mergeClashHint : c.held ? t.review.pushMergeHint : t.review.mergeHint} onClick={() => go(t.review.merged(c.number), c.held ? t.review.pushingHeld : t.review.merging)}>
        {label}
      </Button>
      {c.held && (
        <Button title={t.review.pushOnlyHint} onClick={() => act({ action: 'pushChanges' }, { close: true, ack: t.review.pushed(c.number), pending: t.review.pushingHeld })}>
          {t.review.pushOnly}
        </Button>
      )}
    </>
  );
}

// ------------------------------------------------------------------ ideas

/**
 * An idea under discussion: the brief its agent keeps on top, a prototype's demo when there is one,
 * then the conversation, and the owner's decisions.
 */
/**
 * On an accepted proposal its agent withdrew or replaced since: who did, why, and the choice to
 * remove the card (as "Delete" does, its worker stopped, with an undo) or keep it.
 */
function SupersededBox({ item, all, act, onDelete }: { item: Item; all: Item[]; act: (a: CardAction, done: ActDone) => Promise<void>; onDelete: () => void }) {
  const s = item.idea?.superseded;
  if (!s) return null;
  // the replacement under its title now, if it is still on the project
  const replacement = s.by ? all.find((x) => x.id === s.by) : undefined;
  return (
    <div className={questionClass('superseded')}>
      <h4>{s.by ? <Naming text={t.superseded.by} cards={[{ card: replacement, title: replacement?.title ?? s.title ?? '' }]} /> : t.superseded.withdrawn}</h4>
      {s.why && <div className="q-text">{s.why}</div>}
      <div className={actionsClass}>
        <Button variant="danger" title={t.superseded.removeHint} onClick={onDelete}>
          {t.superseded.remove}
        </Button>
        <Button title={t.superseded.keepHint} onClick={() => act({ action: 'keep' }, { close: false })}>
          {t.superseded.keep}
        </Button>
      </div>
    </div>
  );
}

/** Where the card a card comes from opens on its other project. */
const elsewhereHref = (item: Item) => cardPath(item.fromElsewhere!.project, item.from!);

/** A card that comes from a card on another project: which, and a link that opens it there. */
function FromElsewhere({ item }: { item: Item }) {
  const e = item.fromElsewhere!;
  return (
    <p className="hint">
      {t.fromElsewhere(plain(e.title), e.projectName)}{' '}
      <a className="link" href={elsewhereHref(item)}>
        {t.openThere}
      </a>
    </p>
  );
}

/** On a card whose repository does not run on the project: no agent works on it until that is back. */
function RepoDownBox({ item }: { item: Item }) {
  if (!item.repoDown) return null;
  return (
    <div className={questionClass('repo-down')}>
      <div className="q-text">{t.repoDown.long(item.repo)}</div>
    </div>
  );
}

/** `prototypes`: the idea's repository can have them (a folder without git has no branch to build one on). */
/**
 * Starting a card whose agent still has questions: a dialog warns first, and "Start anyway" goes ahead
 * (the agent then decides what is open itself). Shared by every card that starts with open questions.
 */
function useOpenQuestionsGuard(open: number) {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const guard = (go: () => void) => (open > 0 ? setPending(() => go) : go());
  const dialog = (
    <ConfirmDialog
      open={!!pending}
      onOpenChange={(o) => !o && setPending(null)}
      title={t.startWithQuestions.title}
      confirm={{ label: t.startWithQuestions.anyway, variant: 'review-warning', onClick: () => pending?.() }}
      cancel={t.startWithQuestions.back}
    >
      <p>{t.startWithQuestions.body(open)}</p>
    </ConfirmDialog>
  );
  return { guard, dialog };
}

function IdeaView({
  item,
  act,
  run,
  listener,
  onDelete,
  onTell,
  prototypes,
  choice,
  repos,
}: {
  item: Item;
  act: (a: CardAction, done: ActDone) => Promise<void>;
  run: Run;
  listener?: string;
  onDelete: () => void;
  onTell: Tell;
  prototypes: boolean;
  choice: RepoChoice;
  repos: RepoRef[];
}) {
  const idea = item.idea!.discussion!;
  const settledFold = useRef<HTMLDivElement>(null);
  // a new repository building creates first: the button names it, a line under it says what it does
  const fresh = newRepoWords(choice, true);
  const [prototyping, setPrototyping] = useState(false);
  const { guard, dialog: questionsDialog } = useOpenQuestionsGuard(idea.status === 'open' && !idea.thinking ? idea.questions.length : 0);
  // what the agent would do in the owner's place is the marked click; without a suggestion, building is
  const next = idea.status === 'open' && !idea.thinking ? idea.next : undefined;
  const btn = (step: NextStep['step']) => ({ variant: (next ? next.step === step : step === 'build') ? ('primary' as const) : ('default' as const), suggested: next?.step === step });
  return (
    <>
      <div className={cn(stateClass, finishingUp(item) && 'finishing', snoozeOf(item) && 'paused')}>
        ● {stateLabel(item)}
        {snoozeOf(item) && <span className={statusClass}> · {snoozeWho(snoozeOf(item)!)}</span>}
        {idea.thinking && <span className={statusClass}> · {t.author.explorer} {t.idea.thinking}</span>}
        <Limited item={item} />
        {archivedOn(item)}
      </div>
      {/* the brief is what stays; the conversation beside it is how it came about */}
      <Split
        cite={!item.archivedAt && cardDraft(item.id)}
        main={
          <>
            <div className={questionClass('brief')}>
              <h4>{t.idea.brief}</h4>
              {idea.brief.trim() ? <Body md={idea.brief} /> : <div className="hint">{t.idea.briefEmpty}</div>}
              <Mocks mocks={idea.mocks} />
            </div>
            {/* what "Teilaufgabe abtrennen" would build, as its worker's task */}
            {idea.split && !item.archivedAt && (
              // opened at the bottom of the column, it scrolls into view rather than opening out of sight
              <Collapsible className={questionClass('settled')} onOpenChange={(open) => open && requestAnimationFrame(() => settledFold.current?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() }))} ref={settledFold}>
                <CollapsibleTrigger>{t.idea.settled(idea.split.title)}</CollapsibleTrigger>
                <CollapsibleContent>
                  <Body md={idea.split.brief} />
                </CollapsibleContent>
              </Collapsible>
            )}
            <PrototypeDemos item={item} />
          </>
        }
        talk={
          // an archived idea is read only: it comes back onto the project before anyone talks to it again
          item.archivedAt ? (
            <Talk item={item} past />
          ) : (
            <Talk
              item={item}
              field={{
                placeholder: t.idea.compose,
                listener,
                quote: true,
                onWords: async (words, images, replyTo) => onTell(words, images, 'discuss', replyTo),
                onPicked: (text, _, images, replyTo) => act({ action: 'discuss', text, images, ...(replyTo ? { replyTo } : {}) }, { close: false }),
              }}
            />
          )
        }
      />
      {idea.status !== 'open' && !item.archivedAt && <p className="hint">{t.idea.reopen}</p>}
      {item.archivedAt ? (
        <div className={actionsClass}>
          <ArchiveButton item={item} run={run} />
        </div>
      ) : prototyping ? (
        <PrototypeStart item={item} act={act} />
      ) : (
        <>
          {next && (
            <div className={`next-step flex flex-col gap-[3px] mt-4 py-0.5 max-w-[80ch] text-[14px] ${next.step}`}>
              <span className="next-h text-[11px] uppercase tracking-[.08em] font-bold text-idea-strong">{t.idea.next}</span>
              <span>
                <b>{t.idea.nextStep[next.step](idea.questions.length)}</b>
                {next.why && <> – {next.why}</>}
              </span>
            </div>
          )}
          {/* planning waits for the reply, which will change the brief the owner decides on; building goes ahead after it unless it asks questions */}
          {idea.thinking && <p className={idea.buildAfterReply ? goWaits : 'hint'}>{idea.buildAfterReply ? t.idea.buildWaitsHint : idea.split ? t.idea.waitForReplySplit : t.idea.waitForReply}</p>}
          {idea.status === 'open' && !item.idea?.newRepo?.due && <RepoPick choice={choice} repos={repos} />}
          <div className={actionsClass}>
            {/* the settled part as a task of its own; the reply may change the split, so it waits for it */}
            {idea.split && (
              <Button {...btn('splitOff')}
                disabled={idea.thinking}
                title={t.idea.splitOffHint(idea.split.title)}
                onClick={() => act({ action: 'splitOff' }, { close: false })}
              >
                {t.idea.splitOff}
              </Button>
            )}
            {item.idea?.newRepo?.due ? (
              <Armed label={t.repoPick.making(choice.name)} undo={t.undo} onUndo={() => act({ action: 'stayHere' }, { close: false })} />
            ) : idea.buildAfterReply ? (
              <Armed label={t.idea.buildWaits} undo={t.idea.unbuild} onUndo={() => act({ action: 'unbuild' }, { close: false })} />
            ) : (
              // while the agent works, the click waits for its reply in view; else the panel closes on the built card;
              // built in a new repository, it stays open for "Undo" and then follows the card to its project
              fresh ? (
                <Button {...btn('build')} disabled={!fresh.ready} title={fresh.hint} onClick={() => guard(() => void act({ action: 'build' }, { close: false }))}>
                  {fresh.button}
                </Button>
              ) : (
                <StartAgent
                  draft={cardDraft(item.id)}
                  label={t.idea.build}
                  {...btn('build')}
                  codexAllowed={prototypes && !item.review?.contribution}
                  onStart={(agent) => guard(() => void act({ action: 'build', ...(agent ? { agent } : {}) }, idea.thinking ? { close: false } : { close: true, pending: t.queue.checking }))}
                />
              )
            )}
            <Button {...btn('planDoc')} disabled={idea.thinking} onClick={() => act({ action: 'planDoc' }, { close: true, ack: t.idea.planned })}>
              {t.idea.planDoc}
            </Button>
            {prototypes && (
              <Button {...btn('prototype')} onClick={() => setPrototyping(true)}>
                {t.idea.prototype}
              </Button>
            )}
            {idea.status !== 'parked' && (
              <Button {...btn('park')} onClick={() => act({ action: 'park' }, { close: true, ack: t.idea.parked })}>
                {t.idea.park}
              </Button>
            )}
            {idea.status !== 'dropped' && (
              <Button {...btn('drop')} onClick={() => act({ action: 'drop' }, { close: true, ack: t.idea.dropped })}>
                {t.idea.drop}
              </Button>
            )}
            <Later item={item} act={act} />
            {/* not while a prototype of it is on the project */}
            {idea.status !== 'open' && !item.idea?.prototypes?.some((p) => !p.archivedAt) && <ArchiveButton item={item} run={run} />}
            <Button variant="danger" onClick={onDelete}>
              {t.delete}
            </Button>
          </div>
          {fresh && <p className="hint">{fresh.hint}</p>}
          {questionsDialog}
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Question cards

/**
 * A thread of looked-up answers on a card of its own: its conversation with the agent that looked
 * them up, whom the owner's words reach directly, and the two ways on: discuss it as an idea, or done.
 */
function QuestionView({ item, act, run, onTell }: { item: Item; act: (a: CardAction, done: ActDone) => Promise<void>; run: Run; onTell: Tell }) {
  const thread = item.thread!;
  return (
    <>
      <div className={stateClass}>
        ● {t.question.count(thread.answers, thread.files)} · {thread.thinking ? t.question.reading : t.question.ready}
        <Limited item={item} />
        {archivedOn(item)}
      </div>
      {/* the conversation alone, as tall as the room down to the microphone allows */}
      <Split
        main={null}
        talk={
          item.archivedAt ? (
            <Talk item={item} past />
          ) : (
            <Talk
              item={item}
              field={{
                placeholder: t.question.compose,
                quote: true,
                onWords: async (words, images, replyTo) => onTell(words, images, 'note', replyTo),
                onPicked: (text, _, images, replyTo) => act({ action: 'ask', text, images, ...(replyTo ? { replyTo } : {}) }, { close: false }),
              }}
            />
          )
        }
      />
      <div className={actionsClass}>
        {item.archivedAt ? (
          <ArchiveButton item={item} run={run} />
        ) : (
          <>
            <Button
              disabled={thread.thinking}
              title={thread.thinking ? t.question.asIdeaWaits : t.question.asIdeaHint}
              onClick={() => act({ action: 'asIdea' }, { close: false })}
            >
              {t.question.asIdea}
            </Button>
            <ArchiveButton item={item} run={run} variant="primary" label={t.question.done} hint={t.question.doneHint} />
          </>
        )}
      </div>
    </>
  );
}

/**
 * A proposal: its text as the agent taking it on will read it (`children`, editable), why it was
 * proposed, and the questions to decide, which the owner may answer before taking it.
 */
function ProposalView({
  item,
  all,
  from,
  act,
  listener,
  onRevise,
  codexAllowed,
  children,
}: {
  item: Item;
  all: Item[];
  from?: Item;
  act: (a: CardAction, done: ActDone) => Promise<void>;
  listener?: string;
  /** What should change in it, typed (maybe in reply to a message of its conversation): an agent reworks the proposal by it. */
  onRevise: (text: string, images?: string[], replyTo?: number) => Promise<void>;
  codexAllowed: boolean;
  children: ReactNode;
}) {
  const revising = item.idea?.proposal?.revising;
  const answer = useOpenQuestions(item);
  // an own answer picked but not written answers nothing
  const unanswered = answer.questions.filter((_, i) => !answer.answers[i]?.length).length;
  const { guard, dialog: questionsDialog } = useOpenQuestionsGuard(unanswered);
  const idea = !!item.idea?.proposal?.idea;
  const armed = item.idea?.proposal?.acceptAfterRevision;
  const later = !idea && !!item.idea?.proposal?.startAt;
  // while it is reworked, the click waits for the new text in view; else the panel closes on the accepted card
  const accept = (start: boolean, asIdea = false, agent?: AgentSetting) =>
    act(
      { action: 'accept', ...(start ? {} : { start: false }), ...(asIdea ? { idea: true } : {}), ...(agent ? { agent } : {}), ...(answer.picked ? { picks: answer.answers } : {}) },
      (start || asIdea) && !revising
        ? { close: true, ...(start && !asIdea && !idea && !later ? { pending: t.queue.checking } : {}), ack: idea || asIdea ? t.acceptedIdea : later && Date.parse(item.idea!.proposal!.startAt!) > Date.now() ? t.acceptedLater(snoozeWhen(item.idea!.proposal!.startAt!)) : t.accepted }
        : { close: false },
    );
  return (
    <>
      {/* the proposal as it stands, and beside it the talk about what should change, as with an idea */}
      <Split
        className="proposal-grid"
        cite={cardDraft(item.id)}
        main={
          <>
            {children}
            {/* which of the owner's screenshots go with the task, by their hand or the reviser's pick */}
            {!!item.images?.length && <p className="hint">{t.proposalShots}</p>}
            {!idea && <StartAt item={item} act={act} />}
            {from && <p className="hint"><Naming text={t.proposedBy} cards={[{ card: from }]} />{item.idea?.proposal?.reason && <> {item.idea.proposal.reason}</>}</p>}
            {/* proposed by the agent of a card on another project, whose repository this is */}
            {!from && item.fromElsewhere && (
              <p className="hint">
                {t.proposedByElsewhere(plain(item.fromElsewhere.title), item.fromElsewhere.projectName)}
                {item.idea?.proposal?.reason && <> {item.idea.proposal.reason}</>}{' '}
                <a className="link" href={elsewhereHref(item)}>
                  {t.openThere}
                </a>
              </p>
            )}
            {item.idea?.retro && <p className="hint">{t.proposedByRetro(item.idea.retro)}</p>}
            {item.idea?.proposal?.setup && item.idea.proposal.reason && <p className="hint">{item.idea.proposal.reason}</p>}
          </>
        }
        talk={
          <Talk
            item={item}
            // while it is reworked, the owner's words wait for the rework after it, unread until then
            field={{
              placeholder: t.compose.revise,
              listener,
              quote: true,
              onWords: (words, images, replyTo) => onRevise(words, images, replyTo),
              onPicked: (text, _, images, replyTo) => act({ action: 'revise', text, images, ...(replyTo ? { replyTo } : {}) }, { close: false }),
            }}
          />
        }
      />
      {revising && <p className={armed ? goWaits : 'hint'}>{armed ? t.acceptWaitsHint : t.acceptWaitsFor(idea ? t.acceptIdea : t.accept)}</p>}
      <div className={actionsClass}>
        {armed ? (
          <Armed label={t.acceptWaits(idea || armed === 'idea')} undo={t.unaccept} onUndo={() => act({ action: 'unaccept' }, { close: false })} />
        ) : (
          // one to start later is planned and waits until then: taking it on is all there is to it
          !idea && !later && !revising ? <StartAgent draft={cardDraft(item.id)} label={t.accept} codexAllowed={codexAllowed} onStart={(agent) => guard(() => void accept(true, false, agent))} /> :
          <Button variant="primary" title={later ? t.startAt.accept : undefined} onClick={() => (idea || later ? accept(true) : guard(() => void accept(true)))}>{idea ? t.acceptIdea : later ? t.acceptOnly : t.accept}</Button>
        )}
        {!later && (
          <Button disabled={!!revising} onClick={() => accept(false)}>
            {idea ? t.acceptAsTask : t.acceptOnly}
          </Button>
        )}
        {/* a task the owner would rather think through first */}
        {!idea && (
          <Button disabled={!!armed} title={t.acceptAsIdeaHint} onClick={() => accept(false, true)}>
            {t.acceptAsIdea}
          </Button>
        )}
        {!revising && !armed && <MergeButton item={item} all={all} act={act} />}
        <Button onClick={() => act({ action: 'dismiss' }, { close: true, ack: t.dismissed })}>
          {t.dismiss}
        </Button>
        <Later item={item} act={act} />
      </div>
      {answer.questions.length > 0 && <p className="hint">{t.proposalQuestionsHint}</p>}
      {questionsDialog}
    </>
  );
}

/** When a proposed task starts once accepted, with "Change": another time, or none, so it starts at once. */
function StartAt({ item, act }: { item: Item; act: (a: CardAction, done: ActDone) => Promise<void> }) {
  const at = item.idea?.proposal?.startAt;
  if (!at) return null;
  const set = (to: string | null) => void act({ action: 'startAt', at: to }, { close: false });
  return (
    <div className="start-at flex items-baseline gap-1 flex-wrap mt-2.5 mb-0.5 text-[13px] text-foreground [&_.clock-mark]:align-[-1px] [&_.clock-mark]:text-muted-foreground">
      <ClockMark /> {t.startAt.line(snoozeWhen(at))} ·{' '}
      <SnoozeMenu
        label={t.snooze.change}
        variant="link"
        mark={false}
        heading={t.startAt.heading}
        hint={t.startAt.accept}
        set={t.startAt.set}
        at={new Date(at)}
        clear={{ label: t.startAt.none, hint: t.startAt.noneHint, onClear: () => set(null) }}
        onSnooze={set}
      />
    </div>
  );
}

/** A go clicked while an agent works on the card ("Build it like this", "Accept and start"): it waits armed until the agent is done, its take-back beside it. */
function Armed({ label, undo, onUndo }: { label: string; undo: string; onUndo: () => void }) {
  return (
    <>
      <Button variant="primary" armed disabled aria-pressed>
        {label}
      </Button>
      <Button onClick={onUndo}>
        {undo}
      </Button>
    </>
  );
}

/**
 * "Prototyp bauen lassen": the variants the idea's agent planned, each chosen unless its prototype
 * runs already, and an approach of the owner's own; one prototype each starts at once.
 */
function PrototypeStart({ item, act }: { item: Item; act: (a: CardAction, done: ActDone) => Promise<void> }) {
  const variants = item.idea!.discussion!.variants;
  const running = new Set((item.idea?.prototypes ?? []).flatMap((p) => (!p.archivedAt && p.idea?.variant ? [p.idea.variant] : [])));
  const [chosen, setChosen] = useState(() => variants.filter((v) => !running.has(v.approach)).map((v) => v.approach));
  const [own, setOwn] = useState(false);
  const n = chosen.length + (own ? 1 : 0);
  // the choice opens below the conversation, often out of sight
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
  }, []);
  return (
    <>
      {variants.length > 0 && (
        <div className={questionClass('ask', prototypeVariants)}>
          <h4>{t.idea.variants}</h4>
          <div className={choicesClass('multiple')} role="group">
            {variants.map((v) => {
              const on = chosen.includes(v.approach);
              return (
                <button
                  key={v.approach}
                  role="checkbox"
                  aria-checked={on}
                  className={choiceClass({ on })}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setChosen(variants.map((x) => x.approach).filter((a) => (a === v.approach ? !on : chosen.includes(a))))}
                >
                  <span>
                    <b>{v.approach}</b>
                    {running.has(v.approach) && <span className={pickTag}>{t.idea.variantRuns}</span>}
                    <span className="v-show line-clamp-2 mt-0.5 text-[12.5px] text-muted-foreground" title={v.show}>
                      {v.show}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <Composer
        placeholder={variants.length ? t.idea.prototypeOwn : t.idea.prototypePlaceholder}
        action={t.idea.prototypeGo(Math.max(n, 1))}
        allowEmpty={!variants.length || chosen.length > 0}
        noImages
        onText={(text) => setOwn(!!text.trim())}
        onSend={(text) =>
          act(
            { action: 'prototype', ...(text ? { text } : {}), ...(variants.length ? { variants: chosen } : {}) },
            { close: true, ack: t.idea.prototyped(Math.max(n, 1)) },
          )
        }
      />
      {/* scrolled into view, the start button stays clear of the push-to-talk button below the panel */}
      <div ref={end} className="prototype-end h-16" />
    </>
  );
}

/** A workstream as the owner picks it: its label and title. */
/** The unfolded card's kind line, with its labels to set beside it; an archived card only shows them. */
function KindLine({ kind, item }: { kind: string; item: Item }) {
  return (
    <div className="p-kind">
      {kind}
      {item.archivedAt ? <LabelMarks item={item} /> : <LabelPicks item={item} />}
      <CardMore item={item} />
    </div>
  );
}

const workstreamName = (w: Item) => `${w.plan?.label ? `${w.plan.label} ` : ''}${plain(w.title)}`;

/** The demos of an idea's prototypes, each under its title and how it stands; the latest one open. */
function PrototypeDemos({ item }: { item: Item }) {
  const all = item.idea?.prototypes ?? [];
  if (!all.length) return null;
  const latest = all.filter((p) => p.demo?.latest).at(-1);
  return (
    <>
      <h4 className={headClass}>{t.idea.prototypes}</h4>
      {all.map((p) => (
        <Collapsible key={p.id} className="prototype-demo mt-2.5 [&>[data-slot=collapsible-trigger]]:font-semibold [&>[data-slot=collapsible-trigger]]:text-[14px] [&>[data-slot=collapsible-trigger]_.hint]:font-normal data-[state=open]:[&>[data-slot=collapsible-trigger]]:mb-2" defaultOpen={p === latest}>
          <CollapsibleTrigger>
            <Inline md={p.title} /> <span className="hint">· {stateLabel(p)}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
          {p.demo?.latest ? (
            <DemoView item={p} summary={p.review?.summary ?? ''} demo={p.demo.latest} autoplay={false}>
              <p className="hint">{t.idea.prototypeKept}</p>
            </DemoView>
          ) : (
            <p className="hint">{t.idea.prototypeNoDemo}</p>
          )}
          </CollapsibleContent>
        </Collapsible>
      ))}
    </>
  );
}

/** The owner's first words in the discussion are the card's text (an idea said aloud): it is not shown again as the starting point. */
const opened = (events: CardEvent[], body: string) => {
  const first = events.find((e) => e.kind === 'talk');
  return first?.author === 'owner' && first.text.trim() === body.trim();
};

/**
 * A card's conversation, live: what the owner says, the agents' replies, questions and handovers,
 * and the state changes between them. How an agent got to a message (what it read and thought, its
 * status lines) folds away under that message; while it works, its latest step shows. The questions
 * it waits on stand at the end (`questions`). `past`: nobody works on the card any more.
 * `hideEmpty`: nothing shows until something was said. `onReply`: the owner can reply to a message.
 */
function Conversation({
  item,
  questions,
  past = false,
  hideEmpty = false,
  onReply,
  draft,
}: {
  item: Item;
  questions?: ReactNode;
  past?: boolean;
  hideEmpty?: boolean;
  onReply?: (e: CardEvent) => void;
  /** The field under the conversation, which text marked in it can be quoted into. */
  draft?: string;
}) {
  const events = useEvents(item.id);
  const box = useRef<HTMLDivElement>(null);
  const idea = item.state === 'idea' && !!item.idea?.discussion;
  const question = item.kind === 'question';
  const proposal = item.state === 'proposal';
  // a paused agent's steps stay where they were, in its bubble standing still; the questions open
  // stand at the end, also while a worker's background work keeps its turn open
  const { working, paused, key } = talkState(item, past);
  // what the owner had not seen when the conversation came into view stays marked until it goes, what comes in view is seen
  const { seen, came } = useSeen(item.id, events?.at(-1)?.id, useContext(TalkFolded).folded);
  // on the phone the conversation opens at the first message the owner has not seen
  const away = useContext(TalkElsewhere);
  const unseenFrom = (el: HTMLElement) => {
    if (!away || !events) return null;
    const from = Math.max(seen, events.findLast((e) => e.author === 'owner')?.id ?? -1);
    return [...el.querySelectorAll<HTMLElement>('[data-ev]')].find((m) => Number(m.dataset.ev) > from) ?? null;
  };
  const turns = useMemo(() => (events ? cardTalk(item, events, past) : null), [events, key]);
  const byId = useMemo(() => new Map(events?.map((e) => [e.id, e])), [events]);
  const fresh = useMemo(
    () => new Set(turns && events ? unseenTurns(turns, events, seen).filter((x) => !cameInView(came, x.e.id)).map((x) => x.e.id) : []),
    [turns, seen, came],
  );
  if (!events || !turns) return null;
  if (hideEmpty && !turns.shown.length && !turns.pending.length) return null;
  const by = idea ? 'explorer' : question || asksAhead(item) ? 'koordinator' : 'worker';
  const agent = t.author[by];
  // no agent's message ever closes a proposal's rounds: its rework shows only what came after the owner's latest words
  const since = proposal && turns.shown.length ? events.indexOf(turns.shown.at(-1)!.e) : -1;
  const pending = proposal ? turns.pending.filter((s) => events.indexOf(s) > since) : turns.pending;
  // the demo report's question goes with the handover it came with
  // an open one stands at the end instead, where it is answered
  const handover = item.demo?.latest?.question && !(item.state === 'waiting' && item.need === 'demo' && item.question) ? demoHandover(item.demo.latest, turns.shown) : undefined;
  // where the conversation starts: what was said to an idea, or the task an agent started on, above
  // the line that it started; a decided idea's task is its brief, and its conversation goes on
  // a workstream's task is its text in the plan doc, which stands beside the conversation
  const task = (isWorked(item) || !!item.idea?.prototypeEnd) && item.idea?.brief === undefined && item.source !== 'plan' && (!!item.body.trim() || !!item.images?.length);
  const seed = task ? (
    <Seed item={item} by={taskAuthor(item)} who={`${t.talk.opening[taskAuthor(item)]} · ${t.task}`} />
  ) : (
    idea && !past && item.body.trim() && !opened(events, item.body) && <Seed item={item} by="owner" who={t.idea.seed} />
  );
  const seedAt = task ? Math.max(0, turns.shown.findIndex((x) => started(x.e))) : 0;
  // the comments on places in the demo video Seismic holds back while the owner watches: each can be
  // deleted, and under the last the owner can send them without watching to the end
  const held = item.demo?.held ?? [];
  // the line where the card was snoozed, while it still is, offers to wake it or change the time
  // (a planned card's conversation is a past one until it starts)
  const snoozedAt = snoozeOf(item) && (!past || snoozeOf(item)!.start) ? turns.shown.findLast((x) => snoozeLine(x.e))?.e.id : undefined;
  const explained = explainedFailure(item, events)?.id;
  const line = (turn: Turn) => (
    <Fragment key={turn.e.id}>
      <Line
        turn={turn}
        snoozed={turn.e.id === snoozedAt ? item : undefined}
        explained={turn.e.id === explained}
        demoQuestion={turn === handover ? item.demo?.latest : undefined}
        quoted={turn.e.replyTo ? byId.get(turn.e.replyTo) : undefined}
        fresh={fresh.has(turn.e.id) || (!!turn.then && fresh.has(turn.then.e.id))}
        onReply={onReply}
        onDelete={held.includes(turn.e.id) ? () => takeBack(item.id, turn.e) : undefined}
      />
      {turn.e.id === held.at(-1) && (
        <div className="held-note self-end flex items-center justify-end flex-wrap gap-x-2.5 gap-y-1 -mt-0.5 mx-0.5 mb-1 text-xs text-muted-foreground text-right">
          {t.demo.held(held.length)}
          <button className="held-send py-[3px] px-2.5 border border-working/45 rounded-[3px] bg-card text-working [font:inherit] font-semibold cursor-pointer hover:bg-working/12" title={t.demo.sendNowHint} onClick={() => void api.act(item.id, { action: 'release', now: true }).catch(() => {})}>
            {t.demo.sendNow}
          </button>
        </div>
      )}
    </Fragment>
  );
  // the agent at work, with a pause beside its name; paused, it stands still with Resume
  const bubble = (
    <Msg
      by={by}
      className={paused ? 'paused' : 'thinking'}
      agent={item.agent?.identity}
      who={proposal ? t.revising : `${agent} ${paused ? t.pause.paused : isPausing(item) ? t.pause.pausingTalk : idea ? t.idea.thinking : question ? t.answer.reading : t.talk.working}`}
      head={
        paused ? (
          <button className="turn-resume order-1 ml-auto flex-none inline-flex items-center gap-1 py-0.5 px-[9px] border-0 rounded-[3px] bg-foreground text-background [font:600_11.5px_var(--font)] cursor-pointer [&_.btn-mark]:m-0 hover:opacity-85" title={t.pause.resumeHint} onClick={() => turn(item.id, 'resume')}>
            <PlayMark /> {t.pause.resume}
          </button>
        ) : (
          pausableNow(item) && (
            <Tooltip content={t.pause.hint}>
              <button className="turn-pause order-1 ml-auto flex-none inline-flex items-center justify-center w-6 h-5 p-0 border border-border rounded-[3px] bg-transparent text-muted-foreground opacity-55 cursor-pointer transition-opacity duration-[120ms] [&_.btn-mark]:m-0 hover:opacity-100 focus-visible:opacity-100 hover:text-foreground focus-visible:text-foreground hover:border-muted-foreground focus-visible:border-muted-foreground [@media(hover:hover)]:group-[.thinking:not(:hover)]/message:[&:not(:focus-visible)]:opacity-0" aria-label={t.pause.button} onClick={() => turn(item.id, 'pause')}>
                <PauseMark />
              </button>
            </Tooltip>
          )
        )
      }
    >
      {pending.at(-1) && <Gist text={pending.at(-1)!.text} />}

      {!paused && <Background tasks={item.agent?.background} />}
      <Steps steps={pending} />
    </Msg>
  );
  // paused, it stands where the agent stopped, above what came after (the line that it paused, the
  // owner's words); going on again, it is at work at the end, as after a message
  const stopped = pending.at(-1)?.id;
  const after = !paused
    ? -1
    : stopped !== undefined
      ? turns.shown.findIndex((x, i) => i >= seedAt && x.e.id > stopped)
      : turns.shown.findLastIndex((x) => x.e.kind === 'state' && x.e.author === 'owner');
  const stillAt = after >= seedAt ? after : turns.shown.length;
  // how the agent came to the questions it waits on, or the steps no message came after
  const askedAt = turns.asked.at(-1)?.e.at;
  const askedSteps = (steps: CardEvent[]) =>
    (steps.length > 0 || askedAt) && (
      <Msg by={by} who={askedAt ? `${agent} · ${t.talk.question}` : undefined} agent={turns.asked.at(-1)?.e.agent} at={askedAt}>
        <Steps steps={steps} />
      </Msg>
    );
  return (
    <>
      <h4 className={headClass}>{t.talk.heading}</h4>
      {/* what the agents say and do follows at the end only while the owner stands there, so they can read further up meanwhile */}
      <Scroll className={conversationBox} contentClassName={conversationList} boxRef={box} said={events.findLast((e) => e.author === 'owner')?.id} entries={events} start={unseenFrom}>
        {turns.shown.length === 0 && !turns.unread.length && !working && !turns.asked.length && !seed && <div className="hint">{idea ? t.idea.talkEmpty : question ? t.question.empty : proposal ? t.reviseHint : t.talk.empty}</div>}
        <LimitNotice item={item} />
        {turns.shown.slice(0, seedAt).map(line)}
        {seed}
        {turns.shown.slice(seedAt, stillAt).map(line)}
        {paused && bubble}
        {turns.shown.slice(stillAt).map(line)}
        {working ? (
          <>
            {/* the questions it waits on, the owner's words it read after asking, and below them the background work the worker still runs */}
            {askedSteps(turns.asked.flatMap((x) => x.steps))}
            {questions}
            {turns.below.map(line)}
            {bubble}
            {/* Seismic's reply to what the agent passed on, until the agent's message it leads to */}
            {turns.passedOn.map(line)}
          </>
        ) : (
          !paused && askedSteps([...turns.asked.flatMap((x) => x.steps), ...turns.pending])
        )}
        {/* a card that waits for the owner, its worker's turn over: what still runs of it, without the agent at work */}
        {!working && !paused && !past && !!item.agent?.background?.length && (
          <Msg by={by} className="background-only">
            <Background tasks={item.agent?.background} />
          </Msg>
        )}
        {/* what the agent has not read yet stands below its work, until it reads it; comments on the
            demo video held back, until they are sent */}
        {turns.unread.map((e) =>
          held.includes(e.id) ? (
            line({ e, steps: [] })
          ) : (
            <Message key={e.id} turn={{ e, steps: [] }} unread={t.talk.unread(idea || question || proposal || asksAhead(item) ? 'reply' : holdsNotes(item) ? 'start' : 'step')} onDelete={() => takeBack(item.id, e)} />
          ),
        )}
        {!working && !past && koordinatorReads(events) && <Reading />}
        {!working && questions}
        {!working && turns.below.map(line)}
      </Scroll>
      {draft && <CiteButton box={box} draft={draft} />}
    </>
  );
}

/** Pauses the agent's turn on the card, or lets the paused agent go on; the card shows it once the server has. */
const turn = (cardId: string, action: 'pause' | 'resume') => void api.act(cardId, { action }).catch(() => {});

/**
 * Takes back words of the owner's the agent has not read (a note waiting for its next step, a
 * comment held back while the owner watches the demo): they leave the conversation, and go back
 * into the card's field when it is empty.
 */
const takeBack = (cardId: string, e: CardEvent) =>
  void api
    .act(cardId, { action: 'unsay', id: e.id })
    .then(() => giveBack(cardDraft(cardId), e.text, e.images))
    .catch(() => {});

/** Who wrote the task an agent started on: the owner, a plan doc, the work retrospective, an agent's proposal, or a prototype's idea. */

/** Where a conversation starts, as its first message: what was said to an idea, the task an agent started on; long ones folded. */
function Seed({ item, by, who }: { item: Item; by: string; who: string }) {
  return (
    <Msg by={by} className="seed" who={who}>
      <Fold><Body md={item.body} /></Fold>
      <Shots ids={item.images} />
    </Msg>
  );
}

const DescriptionEdit = createContext<(patch: CardPatch) => void>(() => {});

function Description({ item }: { item: Item }) {
  const onEdit = useContext(DescriptionEdit);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(item.body);
  useEffect(() => { if (!editing) setBody(item.body); }, [item.body]);
  if (item.source !== 'manual' || item.archivedAt) return <Body md={item.body} />;
  return <div className="description-edit group/desc relative [&_.card-refs-hint]:my-1.5">
    {editing ? <>
      <LinkField self={item} className={bodyClass} value={body} placeholder={t.bodyPlaceholder} onChange={(value) => { setBody(value); onEdit({ body: value }); }} />
      <Button onClick={() => setEditing(false)}>{t.descriptionDone}</Button>
    </> : <>
      <Body md={body} />
      <Tooltip content={t.descriptionEdit}><button className="description-edit-button border-0 bg-transparent text-muted-foreground cursor-pointer p-1.5 opacity-0 group-hover/desc:opacity-100 focus-visible:opacity-100 no-hover:opacity-100" aria-label={t.descriptionEdit} onClick={() => setEditing(true)}><Pencil size={16} /></button></Tooltip>
    </>}
  </div>;
}

/** A text shown to its first eight lines or so (or `lines`), with "more" for the rest. */
function Fold({ children, lines }: { children: ReactNode; lines?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || open) return;
    const measure = () => setLong(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);
  return (
    <>
      <div ref={box} className={`fold${open ? '' : ' folded'}${long && !open ? ' cut' : ''}`} style={lines ? ({ '--fold-lines': lines } as CSSProperties) : undefined}>
        {children}
      </div>
      {(long || open) && (
        <LinkButton className="fold-more text-[12.5px] leading-[1.25] mt-0.5" onClick={() => setOpen(!open)}>
          {open ? t.talk.less : t.talk.more}
        </LinkButton>
      )}
    </>
  );
}

/** A state change or an error between the messages, or a message. */
function Line({ turn, snoozed, explained, ...rest }: { turn: Turn; snoozed?: Item; explained?: boolean; demoQuestion?: Demo; quoted?: CardEvent; fresh?: boolean; onReply?: (e: CardEvent) => void; onDelete?: () => void }) {
  return snoozed ? (
    <SnoozeLine item={snoozed} e={turn.e} at={time(turn.e.at)} />
  ) : turn.e.made ? (
    <Made e={turn.e} fresh={rest.fresh} />
  ) : turn.line ? (
    <div className={`${noteClass} ev-${turn.e.kind}`} title={turn.e.code ? turn.e.text : undefined}>
      {time(turn.e.at)} · <Linked text={eventText(turn.e)} />
      {turn.e.kind === 'error' && !explained && claudeLoginFailed(turn.e.text) && <Reauthenticate token={turn.e.token} />}
    </div>
  ) : (
    <Message turn={turn} {...rest} />
  );
}

/** A card made from this conversation: a proposal of its agent's, or a follow-up Seismic made. */
function Made({ e, fresh }: { e: CardEvent; fresh?: boolean }) {
  const cards = useContext(Cards);
  const proposed = e.author === 'worker';
  return (
    <MadeCover
      made={e.made!}
      who={t.author[e.author]}
      what={() => (proposed ? t.talk.proposedNewCard : t.talk.madeFollowUp)}
      at={e.at}
      ev={e.id}
      fresh={fresh}
      items={cards.items}
      open={cards.open}
      watch={e.cardId}
    />
  );
}

/** A line's text with its addresses as links (the comment Seismic or the agent wrote on a pull request, say). */
function Linked({ text }: { text: string }) {
  return text.split(/(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)])/).map((part, i) =>
    i % 2 ? (
      <a key={i} className="link" href={part} target="_blank" rel="noreferrer">
        {part.replace(/^https?:\/\/(www\.)?/, '')}
      </a>
    ) : (
      part
    ),
  );
}

/** Who stands on the owner's side of the conversation: the owner, and whoever answers a question in their name. */
const ownerSide = (e: CardEvent) => e.author === 'owner' || e.kind === 'answer';

/** Historical agent and demo questions share their option pills and end label. */
const questionOptionsClass = "q-opts list-none mt-1.5 mb-0.5 p-0 flex flex-wrap gap-1.5 [&_li]:text-[12.5px] [&_li]:py-0.5 [&_li]:px-[9px] [&_li]:border [&_li]:border-border [&_li]:rounded-[3px] [&_li]:text-muted-foreground [&_li.on]:text-foreground [&_li.on]:border-working [&_li.on]:bg-working/10 [&_li.on]:font-semibold [&_li.on]:before:content-['✓_'] [&_li.on]:before:text-working [.ended_&_li]:opacity-60";
const questionEndClass = "hint q-end block mt-1 italic [&:is(button)]:p-0 [&:is(button)]:border-0 [&:is(button)]:bg-transparent [&:is(button)]:cursor-pointer [&:is(button)]:text-left [&:is(button)]:[font-family:inherit] [&:is(button):hover]:text-foreground [&:is(button):hover]:underline";

/**
 * One message of the conversation; a question with its options and what came of it, a handover with
 * its demo report's question, a reply with the handover that came next and says what changed; the owner's reply with the message it replies to (`quoted`) above it.
 * `onReply`: the owner can reply to it; `onDelete`: the owner can take it back (a comment not yet
 * sent, words not yet read); `unread`: the agent has not read it yet, and when it will; `fresh`: the
 * owner had not seen it when the conversation came into view.
 */
function Message({
  turn,
  demoQuestion,
  quoted,
  fresh,
  onReply,
  onDelete,
  unread,
}: {
  turn: Turn;
  demoQuestion?: Demo;
  quoted?: CardEvent;
  fresh?: boolean;
  onReply?: (e: CardEvent) => void;
  onDelete?: () => void;
  unread?: string;
}) {
  const { e, steps } = turn;
  const q = e.kind === 'question' ? parseQuestion(e.text) : undefined;
  const answer = useAnswer(e);
  return (
    <Msg
      by={ownerSide(e) ? 'owner' : e.author}
      className={[q && 'q', turn.end && `ended ${turn.end}`, fresh && 'fresh', unread ? 'unread' : onDelete && 'held'].filter(Boolean).join(' ')}
      who={`${t.author[e.author]}${e.kind === 'question' ? ` · ${t.talk.question}` : e.kind === 'review' ? ` · ${t.talk.handover}` : ''}`}
      agent={e.agent}
      at={e.at}
      ev={e.id}
      onReply={onReply && !turn.quiet ? () => onReply(e) : undefined}
      onDelete={onDelete}
      deleteLabel={unread ? t.talk.withdraw : t.demo.unsay}
      head={answer.head}
    >
      {quoted && <Quote q={eventQuote(quoted)} />}
      {answer.continues}
      {e.spot && <SpotLink cardId={e.cardId} spot={e.spot} />}
      {!turn.quiet && <Body md={q ? q.text : (turn.words ?? e.text)} />}
      {e.wish && <WishReplyLink wish={e.wish} />}
      {q && turn.end !== 'settled' && (q.options.length > 0 || turn.picks?.length) && (
        <ul className={questionOptionsClass}>
          {q.options.map((o) => (
            <li key={o} className={(turn.picks ? turn.picks.includes(o) : turn.answer?.includes(o)) ? 'on' : ''}>
              <Inline md={o} />
            </li>
          ))}
          {/* the owner's own answer, written in place of an option */}
          {turn.picks?.filter((o) => !q.options.includes(o)).map((o) => (
            <li key={`own:${o}`} className="on own">
              {o}
            </li>
          ))}
        </ul>
      )}
      {turn.end === 'again' ? (
        <button className={questionEndClass} title={t.talk.toQuoted} onMouseDown={(m) => m.preventDefault()} onClick={() => goToMessage(turn.next!, '.question.ask')}>
          {t.talk.again} ↓
        </button>
      ) : (
        turn.end && <div className={questionEndClass}>{t.talk[turn.end]}</div>
      )}
      {turn.then && (
        <div className="then mt-1.5 pt-1.5 border-t border-dashed border-border text-[13.5px]" data-ev={turn.then.e.id}>
          <span className="then-who float-left mr-1.5 text-[11px] leading-5 font-semibold text-foreground [&_.t]:text-muted-foreground [&_.t]:font-normal [&_.t]:ml-1">
            {t.talk.handover}
            <span className="t">{time(turn.then.e.at)}</span>
          </span>
          <Body md={turn.then.e.text} />
        </div>
      )}
      {demoQuestion?.question && (
        <div className={`demo-q mt-1.5 pt-1.5 border-t border-dashed border-border text-[13.5px] [&_b]:text-waiting-strong [&_b]:font-semibold [&.answered_b]:text-muted-foreground${demoQuestion.answer === undefined ? '' : ' answered'}`}>
          <b>{t.talk.demoQuestion}</b> {demoQuestion.question}
          {!!(demoQuestion.options?.length || demoQuestion.picks?.length) && (
            <ul className={questionOptionsClass}>
              {(demoQuestion.options ?? []).map((o) => (
                <li key={o} className={(demoQuestion.picks ? demoQuestion.picks.includes(o) : demoQuestion.answer?.includes(o)) ? 'on' : ''}>
                  <Inline md={o} />
                </li>
              ))}
              {/* the owner's own answer, written in place of an option */}
              {demoQuestion.picks
                ?.filter((o) => !demoQuestion.options?.includes(o))
                .map((o) => (
                  <li key={`own:${o}`} className="on own">
                    {o}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
      <Mocks mocks={e.mocks} />
      {answer.files}
      <Shots ids={e.images} />
      <Steps steps={turn.then ? [...steps, ...turn.then.steps] : steps} />
      {unread && <div className="hint unread-mark mt-1 text-xs text-working">{unread}</div>}
    </Msg>
  );
}

/** The mocks of an idea's agent, side by side where there is room. */
function Mocks({ mocks }: { mocks?: Mock[] }) {
  if (!mocks?.length) return null;
  return (
    <div className="mocks grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5 mt-2 mb-1 [&_.mock]:m-0 [&_.mock]:min-w-0 [&_figcaption]:text-xs [&_figcaption]:font-semibold [&_figcaption]:text-muted-foreground [&_figcaption]:mb-1 [&_iframe]:w-full [&_iframe]:border [&_iframe]:border-border [&_iframe]:rounded-[2px] [&_iframe]:bg-white [&_iframe]:block">
      {mocks.map((m, i) => (
        <MockFrame key={i} mock={m} />
      ))}
    </div>
  );
}

/**
 * One mock in the frame a worker's HTML artifact gets: its scripts run, but in an origin of its own,
 * away from Seismic's API, and connect to nothing (the empty frame Seismic serves for it, which writes
 * the page it is sent into itself). It grows to the height the mock reports, up to a limit, then scrolls.
 */
function MockFrame({ mock }: { mock: Mock }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const height = useReportedHeight(frame, 480) ?? 48;
  const page = useMemo(() => mockPage(mock.html), [mock.html]);
  return (
    <figure className="mock">
      {mock.title && <figcaption>{mock.title}</figcaption>}
      <iframe
        key={page}
        ref={frame}
        sandbox="allow-scripts"
        src="/api/mock-frame"
        onLoad={(e) => e.currentTarget.contentWindow?.postMessage({ obeyaPage: page }, '*')}
        title={mock.title || t.idea.mock}
        style={{ height }}
      />
    </figure>
  );
}

/** The highest an HTML demo's frame grows; a page higher still scrolls inside it. */
const ARTIFACT_CAP = 30000;

/** What the agent did on its way to a message, folded: its history. */
function Steps({ steps }: { steps: CardEvent[] }) {
  if (!steps.length) return null;
  return (
    <Collapsible className="steps mt-1.5 text-xs text-muted-foreground [&_ol]:mt-1.5 [&_ol]:mb-0.5 [&_ol]:py-2 [&_ol]:px-2.5 [&_ol]:list-none [&_ol]:bg-muted [&_ol]:rounded-[2px] [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-[3px] [&_li]:[overflow-wrap:anywhere] [&_.step-activity]:[font:11.5px/1.5_var(--mono)] [&_:is(.step-say,.step-closing)]:text-foreground [&_:is(.step-say,.step-closing)_:is(.p-lead,.p-list,.p-table_table)]:m-0 [&_:is(.step-say,.step-closing)_:is(.p-lead,.p-list,.p-table_table)]:text-[12.5px] [&_.step-state]:text-idea-strong">
      <CollapsibleTrigger>{t.talk.steps(steps.length)}</CollapsibleTrigger>
      <CollapsibleContent>
      <ol>
        {steps.map((s) => (
          <li key={s.id} className={`step-${s.kind}`}>
            {s.author !== 'worker' && s.author !== 'explorer' && <b>{t.author[s.author]}: </b>}
            {s.kind === 'say' || s.kind === 'closing' ? <Body md={s.text} /> : s.text}
          </li>
        ))}
      </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The agent's background work that runs (a test run, a render, a watcher), each with how long it has run, the time going on. */
function Background({ tasks }: { tasks?: BackgroundTask[] }) {
  const [now, setNow] = useState(Date.now);
  const runs = !!tasks?.length;
  useEffect(() => {
    if (!runs) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runs]);
  if (!tasks?.length) return null;
  return (
    <div className="background-work mt-1.5 text-xs text-muted-foreground [.background-only_&]:mt-0 [&_ul]:mt-[3px] [&_ul]:mb-0 [&_ul]:p-0 [&_ul]:list-none [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-0.5 [&_li]:text-foreground [&_li]:[overflow-wrap:anywhere] [&_li]:before:content-['↻'] [&_li]:before:text-working [&_li]:before:mr-1.5 [&_.t]:text-muted-foreground [&_.t]:ml-1 [&_.t]:tabular-nums">
      <span className="background-head">{t.talk.background}</span>
      <ul>
        {tasks.map((task, i) => (
          <li key={`${i}|${task.since}|${task.description}`}>
            {task.description} <span className="t">{t.talk.backgroundFor(Math.max(0, Math.floor((now - task.since) / 1000)))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const clipLine = (s: string) => {
  const line = s.split('\n').find((l) => l.trim())?.trim() ?? '';
  return line.length > 140 ? line.slice(0, 139) + '…' : line;
};

/** The agent's latest words, cut to their first line; under the mouse, all of them. */
function Gist({ text }: { text: string }) {
  const line = clipLine(text);
  const full = text.trim();
  if (line === full) return <div className="hint">{line}</div>;
  return (
    <div className="hint gist group/gist">
      <span className="gist-line group-hover/gist:hidden">{line}</span>
      <span className="gist-full hidden whitespace-pre-line [overflow-wrap:anywhere] group-hover/gist:block">{full}</span>
    </div>
  );
}

type Run = (fn: () => Promise<void>, done: ActDone) => Promise<void>;

/**
 * The narrated demo with its chapters and the report beside it. `comments`: the card's agent hears the
 * owner, whose words may be about a place in the video. Once a later handover replaced a demo, the
 * owner may step back to it and forth again; a comment on a place in it takes them there too.
 */
/** ‹ and › between the card's demos. */
const versionStep = 'step inline-flex items-center justify-center p-0 size-6 border-0 bg-transparent text-foreground rounded-[2px] text-lg leading-none cursor-pointer enabled:hover:bg-muted disabled:opacity-30 disabled:cursor-default';

function DemoView({
  item,
  summary = '',
  demo: latest,
  children,
  top,
  autoplay = true,
  comments = false,
}: {
  item: Item;
  summary?: string;
  demo: Demo;
  children?: ReactNode;
  /** above the video or artifact, where it is seen on opening however long the chapters or the artifact: sharing, about the demo shown */
  top?: false | ((shown: Demo, latest: boolean) => ReactNode);
  autoplay?: boolean;
  comments?: boolean;
}) {
  const cardId = item.id;
  const video = useRef<HTMLVideoElement>(null);
  // on the phone the field is in a panel of its own, which a comment brings up
  const elsewhere = useContext(TalkElsewhere);
  const talkFold = useContext(TalkFolded);
  const artifact = useRef<HTMLIFrameElement>(null);
  const artifactHeight = useReportedHeight(artifact, ARTIFACT_CAP);
  const [now, setNow] = useState(0);
  // the video's shape once its metadata is in: until it first plays, Chrome sizes the element by its poster, and
  // by its default 300 × 150 when the poster does not load, a flat strip at full width
  const [shape, setShape] = useState<string>();
  // the earlier demo shown (its `n`), or the latest; a new handover leaves the owner where they are
  const [shownN, setShownN] = useState<number | null>(null);
  const earlier = item.demo?.earlier ?? [];
  const demo = earlier.find((d) => d.n === shownN) ?? latest;
  const all = [...earlier, latest];
  const shownAt = all.indexOf(demo);
  // a new handover often renders into the same directory: its handover in the address makes a card left open load it afresh
  const src = (f: string) => cardAt(cardId, `${demo === latest ? `/demo/${f}` : `/demos/${(demo as EarlierDemo).n}/${f}`}${demo.handover === undefined ? '' : `?v=${demo.handover}`}`);
  // where the demo shown next plays from, when a comment on a place in it took the owner there
  const playFrom = useRef<number | null>(null);
  const show = (d: Demo) => setShownN(d === latest ? null : (d as EarlierDemo).n);
  // start once the card has unfolded, like the mock, the first time only; a demo kept on a finished card waits to be played.
  // A page out of sight (a tab in the background, an agent's browser) does not start it: nobody would see it, only hear it
  const [autostart] = useState(() => autoplay && demo.kind !== 'html' && !document.hidden && firstOpening(localStorage, cardId, demo));
  // a video that does not start on its own shows a big play button over it until it first plays
  const [started, setStarted] = useState(autostart);
  useEffect(() => {
    if (!autostart) return;
    const h = setTimeout(() => (document.hidden ? setStarted(false) : video.current?.play().catch(() => setStarted(false))), 300);
    return () => clearTimeout(h);
  }, []);
  useEffect(() => () => holdRestart('video', null), []);
  const zoom = useZoom(video);
  // the phone view, which puts the conversation elsewhere, puts the video into full screen itself (fullscreen.ts)
  const fullscreen = useFullscreen(zoom.screen, video, !!elsewhere);
  const seek = useSeekKeys(video);
  const watching = useWatching(cardId, video, comments && demo.kind !== 'html' ? demo.chapters : null, demo.handover);
  const current = chapterAt(demo.chapters, now);
  useEffect(() => {
    if (!earlier.length) return;
    return showsVersions({
      cardId,
      shown: demo.handover,
      show: (handover, from) => {
        const d = all.find((d) => d.handover === handover);
        if (!d) return false;
        playFrom.current = from;
        show(d);
        return true;
      },
    });
  }, [demo, latest, item.demo?.earlier]);
  // another demo shown: it starts from the beginning, or from the place a comment took the owner to
  const firstShown = useRef(true);
  useEffect(() => {
    if (firstShown.current) return void (firstShown.current = false);
    setNow(0);
    const v = video.current;
    const from = playFrom.current;
    playFrom.current = null;
    if (!v) return;
    if (from === null) return setStarted(false);
    const go = () => {
      v.currentTime = from;
      v.play().catch(() => setStarted(false));
    };
    if (v.readyState >= 1) go();
    else v.addEventListener('loadedmetadata', go, { once: true });
    // into view with the line above it, unless its top is in view already
    const column = v.closest('.split-main')?.getBoundingClientRect();
    const top = v.getBoundingClientRect().top;
    if (column && (top < column.top || top > column.bottom - 80)) v.closest('.demo-view')?.querySelector('.demo-versions')?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
    return () => v.removeEventListener('loadedmetadata', go);
  }, [shownN]);
  return (
    <>
      <div className="demo-view group/demo">
        {/* which of the card's demos is shown, in the line with sharing */}
        {(earlier.length > 0 || top) && (
          <div className="demo-top flex flex-wrap items-center justify-end gap-x-4 gap-y-2 mb-2.5 [&>.hint]:flex-[1_1_260px] [&>.hint]:m-0">
            {earlier.length > 0 && (
              <div className={cn('demo-versions flex items-center gap-1 mr-auto min-h-[34px] text-[13px] [&>span]:tabular-nums [&>span]:px-0.5 [&_[data-slot=button]]:ml-2.5', demo !== latest && 'earlier [&>span]:text-waiting-strong [&>span]:font-semibold')} title={demo === latest ? undefined : t.demo.earlierHint}>
                <Tooltip content={t.demo.older}>
                  <button className={versionStep} disabled={shownAt === 0} aria-label={t.demo.older} onClick={() => show(all[shownAt - 1]!)}>
                    <ChevronLeft size={16} aria-hidden />
                  </button>
                </Tooltip>
                <span>
                  {t.demo.version(shownAt + 1, all.length, demo === latest)}
                  {demo.at && ` · ${handedAt(demo.at)}`}
                  {demo.handover !== undefined && item.demo?.share?.on?.includes(demo.handover) && (
                    <Tooltip content={t.share.onPageMark}>
                      <span className="on-page inline-flex align-[-2px] ml-1.5 text-approved [&_svg]:size-[13px] [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:[stroke-width:2.2] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]" aria-label={t.share.onPageMark}>
                        <ShareIcon />
                      </span>
                    </Tooltip>
                  )}
                </span>
                <Tooltip content={t.demo.newer}>
                  <button className={versionStep} disabled={demo === latest} aria-label={t.demo.newer} onClick={() => show(all[shownAt + 1]!)}>
                    <ChevronRight size={16} aria-hidden />
                  </button>
                </Tooltip>
                {shownAt < all.length - 2 && (
                  <LinkButton onClick={() => show(latest)}>
                    {t.demo.toLatest}
                  </LinkButton>
                )}
              </div>
            )}
            {top && top(demo, demo === latest)}
          </div>
        )}
        {demo.kind === 'html' ? (
          // the worker's page: scripts run, but in an origin of its own, away from Seismic's API. Once
          // the frame has the page's height, the page stops scrolling up and down by itself
          // (`withHeightReport`); sideways it still scrolls, where it is wider than the frame. Low until
          // then: the column keeps the height of its tallest view, and a frame higher than a short page
          // kept it scrolling over nothing
          <iframe ref={artifact} className="artifact w-full h-[150px] border border-border rounded-[3px] bg-white block" sandbox="allow-scripts" src={src('index.html')} title={t.demo.artifact} style={{ height: artifactHeight }} />
        ) : (
          <div className="player relative" ref={zoom.player} style={zoom.box ? { height: zoom.box.from.height } : undefined}>
            {zoom.box && <div className={cn('demo-zoom fixed inset-0 z-3 bg-slate-950/80 cursor-zoom-out animate-[fade_.38s_ease-out] transition-opacity duration-[380ms]', zoom.box.closing && 'closing opacity-0')} ref={zoom.backdrop} title={t.demo.unzoom} onClick={zoom.toggle} />}
            {/* zoomed (useZoom): fixed over the greyed window, above the panel's ✕, the player keeping its height in
                the card. On a phone full screen comes from Seismic's button (fullscreen.ts) and the video fills the
                black player as far as its shape allows; `nofullscreen` only greys out the controls' own button in
                Chrome's newer controls, so it goes */}
            <div
              className={cn(
                'screen group/screen relative [&_video]:w-full [&_video]:rounded-[3px] [&_video]:bg-black [&_video]:block phone:[&_video::-webkit-media-controls-fullscreen-button]:hidden',
                zoom.box && 'zoomed fixed z-4 origin-top-left [&_video]:h-full [&_video]:shadow-lift',
                !zoom.box && fullscreen.full && 'full phone:bg-black phone:flex phone:items-center phone:[&_video]:h-full phone:[&_video]:object-contain phone:[&_video]:rounded-none',
              )}
              ref={zoom.screen}
              style={zoom.box ? { left: zoom.box.to.left, top: zoom.box.to.top, width: zoom.box.to.width, height: zoom.box.to.height } : undefined}
            >
              <video
                ref={video}
                controls
                controlsList={fullscreen.can ? 'nofullscreen' : undefined}
                preload="metadata"
                poster={demo.noPoster ? undefined : src('poster.jpg')}
                src={src('demo.mp4')}
                style={shape ? { aspectRatio: shape } : undefined}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (v.videoWidth && v.videoHeight) setShape(`${v.videoWidth} / ${v.videoHeight}`);
                }}
                onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
                onFocus={(e) => seek.focused(e.currentTarget)}
                // a restart waits while the owner watches
                onPlay={() => {
                  setStarted(true);
                  holdRestart('video', 'video');
                }}
                onPause={() => holdRestart('video', null)}
                onEnded={() => {
                  holdRestart('video', null);
                  watching.ended();
                }}
              >
                <track kind="captions" src={src('captions.vtt')} srcLang="en" label="English" />
              </video>
              {seek.hint && (
                <span className="seek-hint absolute left-1/2 bottom-16 -translate-x-1/2 z-1 whitespace-nowrap pointer-events-none py-[5px] px-[9px] rounded-[3px] bg-black/75 text-white text-[13px] animate-[fade_.2s_ease-out] [&_kbd]:[font-family:inherit] [&_kbd]:[font-size:inherit] [&_kbd]:font-semibold [&_kbd]:px-1.5 [&_kbd]:rounded-[2px] [&_kbd]:bg-white/20 [&_kbd]:border [&_kbd]:border-white/35 phone:hidden">
                  {t.demo.seekHint} <kbd>←</kbd> <kbd>→</kbd>
                </span>
              )}
              {!started && (
                // a click anywhere on the video but its controls starts it, like on a shared page
                <button className="start absolute inset-[0_0_56px_0] p-0 border-0 bg-transparent cursor-pointer grid place-items-center group/start [&>span]:mt-14 [&>span]:size-20 [&>span]:rounded-full [&>span]:bg-black/60 [&>span]:grid [&>span]:place-items-center [&>span]:transition-[transform,background] [&>span]:duration-150 hover:[&>span]:bg-black/80 hover:[&>span]:scale-[1.06] [&_svg]:size-8 [&_svg]:ml-[5px] [&_svg]:fill-white [&_svg]:text-white [&_svg]:stroke-white" aria-label={t.demo.play} onClick={() => video.current?.play().catch(() => {})}>
                  <span>
                    <Play fill="currentColor" strokeWidth={2} />
                  </span>
                </button>
              )}
              {comments && started && (
                <button
                  className="comment-here absolute top-2.5 right-14 z-1 h-[38px] px-3.5 border-0 rounded-[19px] bg-black/55 text-white text-[13.5px] cursor-pointer opacity-0 transition-[opacity,background] duration-150 flex items-center gap-2 [&_svg]:size-[18px] [&_svg]:fill-none [&_svg]:stroke-white [&_svg]:[stroke-width:2] [&_svg]:[stroke-linejoin:round] group-hover/screen:opacity-100 focus-visible:opacity-100 hover:bg-black/80 no-hover:opacity-100 phone:right-[60px] phone:h-[42px] phone:rounded-[21px] phone:group-[.full]/screen:top-[max(10px,env(safe-area-inset-top))] phone:group-[.full]/screen:right-[calc(50px+max(10px,env(safe-area-inset-right)))]"
                  title={t.demo.commentHint}
                  onClick={() => {
                    video.current?.pause();
                    if (zoom.box) zoom.toggle();
                    fullscreen.leave();
                    if (elsewhere) elsewhere.open(true);
                    else if (talkFold.folded) talkFold.show(true);
                    else document.querySelector<HTMLTextAreaElement>('.card-sheet .split-talk .composer textarea')?.focus();
                  }}
                >
                  <MessageSquare strokeWidth={2} />
                  {t.demo.comment}
                </button>
              )}
              {fullscreen.can && (
                <Tooltip content={fullscreen.full ? t.demo.fullscreenOff : t.demo.fullscreen}>
                  <button className="fullscreen grid absolute top-2.5 right-2.5 z-1 size-[42px] border-0 rounded-full bg-black/55 place-items-center [&_svg]:size-[22px] [&_svg]:fill-none [&_svg]:stroke-white [&_svg]:[stroke-width:2.2] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] phone:group-[.full]/screen:top-[max(10px,env(safe-area-inset-top))] phone:group-[.full]/screen:right-[max(10px,env(safe-area-inset-right))]" aria-label={fullscreen.full ? t.demo.fullscreenOff : t.demo.fullscreen} onClick={fullscreen.toggle}>
                    {fullscreen.full ? <Minimize strokeWidth={2} /> : <Maximize strokeWidth={2} />}
                  </button>
                </Tooltip>
              )}
              <Tooltip content={zoom.keyKnown ? (zoom.box ? t.demo.unzoom : t.demo.zoom) : undefined}>
                <button
                  className="zoom group/zoom absolute top-2.5 right-2.5 z-1 size-[38px] border-0 rounded-full bg-black/55 cursor-pointer grid place-items-center opacity-0 transition-[opacity,background] duration-150 group-hover/screen:opacity-100 focus-visible:opacity-100 hover:bg-black/80 [&>svg]:size-5 [&>svg]:fill-none [&>svg]:stroke-white [&>svg]:[stroke-width:2.2] [&>svg]:[stroke-linecap:round] phone:hidden"
                  aria-label={zoom.box ? t.demo.unzoom : t.demo.zoom}
                  onClick={zoom.toggle}
                >
                  {/* the key beside the magnifier until the owner first zoomed with it */}
                  {!zoom.keyKnown && (
                    <span className="zoom-hint absolute right-0 top-[calc(100%+6px)] whitespace-nowrap py-[5px] px-[9px] rounded-[3px] bg-black/75 text-white text-[13px] opacity-0 pointer-events-none transition-opacity duration-150 group-hover/zoom:opacity-100 group-focus-visible/zoom:opacity-100 [&_kbd]:[font-family:inherit] [&_kbd]:[font-size:inherit] [&_kbd]:font-semibold [&_kbd]:px-1.5 [&_kbd]:rounded-[2px] [&_kbd]:bg-white/20 [&_kbd]:border [&_kbd]:border-white/35 [&_kbd]:ml-[3px]">
                      {zoom.box ? t.demo.unzoomHint : t.demo.zoomHint} <kbd>Z</kbd>
                    </span>
                  )}
                  {zoom.box ? <ZoomOut strokeWidth={2} /> : <ZoomIn strokeWidth={2} />}
                </button>
              </Tooltip>
            </div>
          </div>
        )}
        {demo.chapters.length > 0 && (
          <ol className="chapters list-none mt-2 mb-0 p-1.5 bg-muted rounded-[3px] [&_button]:cursor-pointer [&_button]:flex [&_button]:gap-2.5 [&_button]:w-full [&_button]:py-1.5 [&_button]:px-2 [&_button]:rounded-[2px] [&_button]:text-[13px] [&_button]:box-border [&_button]:border-0 [&_button]:bg-transparent [&_button]:text-left [&_button]:text-[13px] [&_button]:text-foreground [&_button]:tracking-[inherit] [&_button:hover]:bg-card [&_button.on]:bg-card [&_.t]:text-muted-foreground [&_.t]:tabular-nums [&_.t]:min-w-8">
            {demo.chapters.map(([at, title], i) => (
              <li key={i}>
                <button
                  className={i === current ? 'on' : ''}
                  onClick={() => {
                    const v = video.current;
                    if (!v) return;
                    v.currentTime = at;
                    v.play().catch(() => {});
                  }}
                >
                  <span className="t">{mmss(at)}</span>
                  {title}
                </button>
              </li>
            ))}
          </ol>
        )}
        {/* its report's question stands in the conversation, where it is answered */}
        {children}
      </div>
      <Body md={summary} />
    </>
  );
}

/** When a demo was handed over: the time of day, with the day when it was not today. */
const handedAt = (at: string) => (new Date(at).toDateString() === new Date().toDateString() ? time(at) : `${shortDay(at)}, ${time(at)}`);

/** A video standing this long has been watched to its end, as far as the comments on it are concerned. */
const STOOD_MS = 3 * 60_000;

/**
 * The card's demo video as the one its words may be about (`chapters` null: they are not): typing in
 * the card's field pauses it, and the owner's comments on places in it, which Seismic holds back while
 * they watch, go to the agent once they have finished: the video ended, stood for a few minutes, or
 * the card closed. Words without a place, and an approval, take them too (on the server).
 */
function useWatching(cardId: string, video: RefObject<HTMLVideoElement | null>, chapters: [number, string][] | null, demo?: number) {
  const on = !!chapters;
  const release = () => void api.act(cardId, { action: 'release' }).catch(() => {});
  // going to another of the card's demos is no sign the owner has finished watching
  useEffect(() => {
    const v = video.current;
    if (!on || !v) return;
    return watch(cardId, v, chapters, demo);
  }, [on, demo]);
  useEffect(() => {
    const v = video.current;
    if (!on || !v) return;
    const typed = (e: Event) => {
      if (!v.paused && e.target instanceof HTMLTextAreaElement && e.target.closest('.card-sheet .split-talk .composer, #ph-card-talk .composer')) v.pause();
    };
    let stood: ReturnType<typeof setTimeout> | undefined;
    const paused = () => {
      clearTimeout(stood);
      stood = setTimeout(release, STOOD_MS);
    };
    const played = () => clearTimeout(stood);
    v.addEventListener('pause', paused);
    v.addEventListener('play', played);
    addEventListener('input', typed, true);
    return () => {
      clearTimeout(stood);
      v.removeEventListener('pause', paused);
      v.removeEventListener('play', played);
      removeEventListener('input', typed, true);
      release();
    };
  }, [on]);
  return { ended: () => on && release() };
}

/** A key with no modifier, pressed outside a text field and with nothing over the card: one for the demo video. */
function forTheVideo(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable], [role=menu]')) return false;
  return !document.querySelector('#help, #config, .lightbox, .diff-view');
}

/** The demo video the keys are for, with several on a card: the zoomed one, else the one playing, else the first. */
function keyedVideo() {
  const videos = [...document.querySelectorAll<HTMLVideoElement>('.card-sheet .demo-view video')];
  return document.querySelector<HTMLVideoElement>('.screen.zoomed video') ?? videos.find((v) => !v.paused) ?? videos[0];
}

/** How far ← and → jump in the demo video, in seconds. */
const SEEK_S = 5;
/** How soon after the video handed the focus back its controls take it again for their overflow menu: a press on its button, ms. */
const MENU_FOCUS_MS = 1000;
/** Set once the owner jumped with the arrow keys: a click on the video's controls stops showing them. */
const SEEK_KEYS_KNOWN = 'obeya-seek-keys-known';

/**
 * ← and → jump back and forward in the demo video, without a click on its progress bar first. The
 * browser's controls keep every key to themselves once clicked (Space too, which then neither paused
 * the video nor started a recording), so the video hands the focus back to the page at once; then
 * the keys reach Seismic's own handlers. Their overflow menu (⋮) takes the focus as it opens, right
 * after the press on its button gave it to them, and closes when it loses it: the focus coming back
 * that soon stays. Without a mouse (a phone, a tablet) there are no keys, and the focus stays too. A
 * click on the controls shows the keys over the video for a moment, until the owner first jumped
 * with them.
 */
function useSeekKeys(video: RefObject<HTMLVideoElement | null>) {
  const [hint, setHint] = useState(false);
  const hide = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const v = video.current;
      if (!v || !forTheVideo(e) || keyedVideo() !== v) return;
      e.preventDefault();
      const to = v.currentTime + (e.key === 'ArrowLeft' ? -SEEK_S : SEEK_S);
      v.currentTime = Math.max(0, Number.isFinite(v.duration) ? Math.min(v.duration, to) : to);
      setHint(false);
      know(SEEK_KEYS_KNOWN);
    };
    addEventListener('keydown', key);
    return () => {
      removeEventListener('keydown', key);
      clearTimeout(hide.current);
    };
  }, []);
  /** when the video last handed the focus back */
  const gaveBack = useRef(-Infinity);
  const focused = (v: HTMLVideoElement) => {
    if (!matchMedia('(pointer: fine)').matches || performance.now() - gaveBack.current < MENU_FOCUS_MS) return;
    v.blur();
    gaveBack.current = performance.now();
    if (known(SEEK_KEYS_KNOWN)) return;
    setHint(true);
    clearTimeout(hide.current);
    hide.current = setTimeout(() => setHint(false), 4000);
  };
  return { hint, focused };
}

/** Set once the owner zoomed with Z: the magnifier stops showing the key beside it. */
const ZOOM_KEY_KNOWN = 'obeya-zoom-key-known';

/**
 * The demo video shown large over the greyed page, short of full screen: the same video element
 * (it keeps playing) grows out of its place in the card and goes back into it. Z or the button on
 * the video toggles it, Esc or a click beside it ends it. With several demos on a card, Z takes the
 * zoomed one, else the one playing, else the first. Hovering the magnifier shows the key until
 * the owner first used it.
 */
function useZoom(video: RefObject<HTMLVideoElement | null>) {
  const player = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ from: Box; to: Box; closing?: boolean } | null>(null);
  const [keyKnown, setKeyKnown] = useState(() => known(ZOOM_KEY_KNOWN));
  const boxRef = useRef(box);
  boxRef.current = box;
  const toggle = () => {
    const cur = boxRef.current;
    const el = screen.current;
    if (!el || cur?.closing) return;
    if (!cur) {
      const from = el.getBoundingClientRect();
      const v = video.current;
      const aspect = v?.videoWidth ? v.videoWidth / v.videoHeight : from.width / from.height;
      setBox({ from: { left: from.left, top: from.top, width: from.width, height: from.height }, to: zoomBox(aspect, innerWidth, innerHeight) });
      return;
    }
    // back into its place in the card, wherever that is by now
    const r = player.current!.getBoundingClientRect();
    const back = { left: r.left, top: r.top, width: r.width, height: cur.from.height * (r.width / cur.from.width) };
    setBox({ ...cur, closing: true });
    el.animate([{ transform: 'none' }, { transform: onto(back, cur.to) }], { duration: motionMs(ZOOM_MS), easing: ZOOM_EASE, fill: 'forwards' }).onfinish = () => setBox(null);
  };
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  // grows out of where it stood; back in its place, it lets go of the shrinking's last frame only
  // once it no longer stands zoomed, so the large video does not show for a frame in between
  const zoomed = !!box;
  useLayoutEffect(() => {
    const cur = boxRef.current;
    if (!screen.current) return;
    if (!cur) return screen.current.getAnimations().forEach((a) => a.cancel());
    screen.current.animate([{ transform: onto(cur.from, cur.to) }, { transform: 'none' }], { duration: motionMs(ZOOM_MS), easing: ZOOM_EASE });
  }, [zoomed]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (boxRef.current) toggleRef.current();
        return;
      }
      if (e.key !== 'z' && e.key !== 'Z') return;
      if (e.repeat || !forTheVideo(e) || keyedVideo() !== video.current) return;
      e.preventDefault();
      toggleRef.current();
      setKeyKnown(true);
      know(ZOOM_KEY_KNOWN);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  // a resized window resizes the zoomed video; a wheel over it does not scroll the card behind
  useEffect(() => {
    if (!zoomed) return;
    const resize = () => {
      const v = video.current;
      const cur = boxRef.current;
      if (cur && !cur.closing && v?.videoWidth) setBox({ ...cur, to: zoomBox(v.videoWidth / v.videoHeight, innerWidth, innerHeight) });
    };
    const still = (e: WheelEvent) => e.preventDefault();
    const els = [screen.current, backdrop.current];
    addEventListener('resize', resize);
    els.forEach((el) => el?.addEventListener('wheel', still, { passive: false }));
    return () => {
      removeEventListener('resize', resize);
      els.forEach((el) => el?.removeEventListener('wheel', still));
    };
  }, [zoomed]);
  return { player, screen, backdrop, box, toggle, keyKnown };
}

/**
 * What a review card's agent found, beside its demo: the checks on the PR's head and the merge probe
 * on one line, then each finding of the review (`FindingList`), which its agent keeps as the
 * conversation goes on.
 */
function Findings({ item, decides, onPush }: { item: Item; decides: boolean; onPush?: () => void }) {
  const c = item.review!.contribution!;
  const findings = (c.findings ?? []).filter(shownFinding);
  const open = findings.filter((f) => f.status === 'open');
  const ok = !!c.results && c.results.mergeable && c.results.checks.every((x) => x.passed);
  return (
    <section className={findingsClass()}>
      {c.results && <div className={checksClass(ok)}>{t.review.checks(c.results)}</div>}
      {c.clash && !finished(item.state) && <Clash clash={c.clash} {...(decides && onPush ? { onPush } : {})} />}
      {c.findings && (
        <h4 className={cn(headClass, findingsHead)}>{!findings.length && c.findings.length ? t.review.allIgnored : t.review.findings(findings.length, open.length, open.filter((f) => f.security).length)}</h4>
      )}
      <FindingList item={item} findings={findings} decides={decides} />
    </section>
  );
}

/**
 * The findings of a review, a review card's or the code review of a card's work, one element for
 * both: each with its number, title, severity where it has one, a sentence or two and where it is.
 * Findings that would make one follow-up task stand together in a bracket that says so, while they
 * are open or made one. On an open finding the owner decides while their words reach the card's
 * agent (`decides`), a second click taking it back, a bracket picking nothing for its others: on a
 * review card "To contributor", "Change it myself" (greyed with its reason where the contributor
 * allows no edits by maintainers) or "As a follow-up task", on a code review "Fix it" or "As a
 * follow-up task". The decisions stand in the card's draft and go out with the field's one Send. A
 * finding something came of says what; one made a follow-up task links that task.
 */
/** Which numbering the card's finding choices belong to: a code review's items keep their numbers across reviews (a draft from the time reviews numbered findings anew is dropped once). */
const reviewKeyOf = (item: Item) => (item.review?.codeReview ? 'items' : undefined);

/** The draft's finding choices and context for the card's current review, read at render time. */
const useFindingDraft = (item: Item) => findingDraft(useDraft(cardDraft(item.id)), reviewKeyOf(item));

/** The same, read at the moment of sending, so a send never takes choices of a review that has since been replaced. */
const findingDraftNow = (item: Item) => findingDraft(draftOf(cardDraft(item.id)), reviewKeyOf(item));

/** Clears the draft's finding choices and context once the card's code review is another one; Detail runs it, so it holds whichever tab or panel is open. */
function useReviewReset(item: Item) {
  const draft = cardDraft(item.id);
  const review = reviewKeyOf(item);
  const d = useDraft(draft);
  useEffect(() => {
    const change = reviewReset(d, review);
    if (change) updateDraft(draft, change);
  }, [review, d.reviewKey, d.findings, d.findingNotes, d.findingNoteEdits, draft]);
}

function FindingList({ item, findings, decides }: { item: Item; findings: Finding[]; decides: boolean }) {
  const c = item.review?.contribution;
  const cards = useContext(Cards);
  const draft = cardDraft(item.id);
  const picks = useFindingDraft(item).findings ?? {};
  const pick = (f: Finding, route: FindingPick) =>
    updateDraft(draft, (d) => {
      const { [f.id]: was, ...rest } = d.findings ?? {};
      return { findings: was === route ? rest : { ...rest, [f.id]: route } };
    });
  // findings the agent is fixing fold to their heads; a click on one unfolds it
  const [unfolded, setUnfolded] = useState<Set<number>>(new Set());
  const unfold = (id: number) =>
    setUnfolded((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const choice = (f: Finding, route: FindingPick, label: string, more: { title?: string; disabled?: boolean } = {}) => (
    <button
      className={choiceClass({ on: picks[f.id] === route })}
      aria-pressed={picks[f.id] === route}
      disabled={more.disabled}
      title={more.title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => pick(f, route)}
    >
      {label}
    </button>
  );
  const one = (f: Finding) => {
    const task = f.status === 'later' && f.card ? cards.items.find((x) => x.id === f.card) : undefined;
    const fixing = f.status === 'open' && f.decided === 'self';
    const folded = fixing && !unfolded.has(f.id);
    const head = (
      <>
        <span className={findingNo}>{f.id}</span>
        {fixing && <span className={fixingBadge}>{t.codeReview.fixing}</span>}
        {f.severity && <span className={severityBadge(f.severity)}>{t.codeReview.severity[f.severity]}</span>}
        <b>{f.title}</b>
        {f.security && <span className={findingTag}>{t.review.security}</span>}
      </>
    );
    const cls = findingClass({ security: f.security, settled: f.status !== 'open', folded, extra: [f.severity] });
    if (fixing)
      return (
        <Collapsible key={f.id} className={cls} open={!folded} onOpenChange={() => unfold(f.id)}>
          <CollapsibleTrigger className={findingFold} title={folded ? t.codeReview.unfold : t.codeReview.fold}>
            {head}
            <span className={findingChevron}>{folded ? <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" /> : <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>{body(f, task)}</CollapsibleContent>
        </Collapsible>
      );
    return (
      <div key={f.id} className={cls}>
        <div className={findingHead}>{head}</div>
        {body(f, task)}
      </div>
    );
  };
  const body = (f: Finding, task: Item | undefined) => {
    return (
      <>
        <div className={findingText}>
          <Inline md={f.text} />
        </div>
        {f.file && (
          <div className={findingWhere}>
            <code>{f.line ? `${f.file}:${f.line}` : f.file}</code>
          </div>
        )}
        {f.status !== 'open' ? (
          <div className={findingStatus()}>
            {task ? (
              <a href="#" onClick={(e) => (e.preventDefault(), cards.open(task))}>
                {t.review.laterCard(plain(task.title))} →
              </a>
            ) : !c ? (
              f.status === 'fixed' ? t.codeReview.fixed : t.review.status[f.status as 'later']('')
            ) : f.url ? (
              <a href={f.url} target="_blank" rel="noreferrer">
                {t.review.status[f.status](c.author)} ↗
              </a>
            ) : f.status === 'fixed' && c.held ? (
              t.review.fixedHeld
            ) : (
              t.review.status[f.status](c.author)
            )}
          </div>
        ) : f.decided ? (
          <div className={findingStatus(true)}>
            {f.decided === 'self' ? (c ? t.review.goingSelf : t.codeReview.goingFix) : f.decided === 'later' ? t.review.goingLater : f.withChanges ? t.review.goingWithChanges(c!.author) : t.review.goingTo(c!.author)}
          </div>
        ) : (
          decides && (
            <>
            <div className={choicesClass('single', findingChoices)} role="group">
              {c ? (
                <>
                  {choice(f, 'contributor', t.review.toContributor)}
                  {choice(f, 'self', t.review.self, { disabled: !c.canModify, title: c.canModify ? t.review.selfHint : t.review.selfOff(c.author) })}
                  {choice(f, 'later', t.review.later, { title: t.review.laterHint })}
                  {choice(f, 'ignore', t.review.ignore, { title: t.review.ignoreHint })}
                </>
              ) : (
                <>
                  {choice(f, 'self', t.codeReview.fix, { title: t.codeReview.fixHint })}
                  {choice(f, 'later', t.review.later, { title: t.codeReview.laterHint })}
                  {choice(f, 'ignore', t.review.ignore, { title: t.review.ignoreHint })}
                </>
              )}
            </div>
            <FindingContext item={item} id={f.id} />
            </>
          )
        )}
      </>
    );
  };
  // each finding once: alone, or where the first of its bundle stands, with the others of it
  const shown = new Set<number>();
  const blocks = findings.flatMap((f) => {
    if (shown.has(f.id)) return [];
    const bundle = findings.filter((o) => (o.id === f.id || f.with?.includes(o.id)) && bundled(o));
    if (!bundled(f) || bundle.length < 2) return [one(f)];
    for (const o of bundle) shown.add(o.id);
    return [
      <div key={`b${f.id}`} className={bundleClass}>
        <div className={bundleHead}>{t.review.bundle(bundle.map((o) => o.id))}</div>
        {bundle.map(one)}
      </div>,
    ];
  });
  return (
    <>
      {blocks}
      {decides && findings.some((f) => f.status === 'open' && !f.decided) && <p className="hint">{c ? t.review.decideHint : t.codeReview.decideHint}</p>}
    </>
  );
}

/**
 * The Review tab of a card whose work its project reviews (design: Code reviews in Card lifecycle):
 * its label counts the items that need the owner by severity in their colours, or shows the review
 * running, and "outdated" where it reviewed an earlier handover; a check says nothing is open. Its
 * panel is the one list of items.
 */
function reviewTab(item: Item, act: (a: CardAction, done: ActDone) => void): { label: ReactNode; title?: string; panel: ReactNode } {
  const r = item.review!.codeReview!;
  const reviewer = r.agent && `${t.config.agents.harnesses[r.agent.harness]}${r.agent.model ? ` · ${r.agent.model}` : ''}`;
  const waiting = r.items.filter(needsOwner);
  const count = (s: Severity) => waiting.filter((i) => i.severity === s).length;
  const counts = SEVERITIES.map((s) => [s, count(s)] as const).filter(([, n]) => n > 0);
  const label = (
    <>
      {t.codeReview.tab}
      {r.state === 'running' && <span className={reviewRunningDot} aria-label={t.codeReview.running(reviewer)} />}
      {r.state === 'done' && !r.stale && !r.items.some((i) => needsOwner(i) || i.status === 'fixing' || i.status === 'underReview') && <Check className={reviewClean} aria-label={t.codeReview.items(r.items.length, 0)} />}
      {counts.map(([s, n]) => <span key={s} className={reviewCount(s)}><ReviewSeverityIcon severity={s} />{n}</span>)}
      {r.stale && r.state !== 'running' && <span className={reviewOutdated}>{t.codeReview.outdated}</span>}
    </>
  );
  const decides = !!ownerField(item) && !finished(item.state);
  const again = r.mode === 'auto' && (r.state === 'failed' || !!r.stale) && handedOver(item) && !item.review?.landing;
  const panel = <ReviewList item={item} act={act} decides={decides} again={again} reviewer={reviewer} />;
  return { label, ...(waiting.length ? { title: t.codeReview.counts(counts.map(([s, n]) => ({ severity: t.codeReview.severity[s], count: n }))) } : {}), panel };
}

/** A line of an item's log: when, who, what happened (and why). */
function logLine(e: ReviewItem['log'][number]): string {
  const l = t.codeReview.log;
  const what =
    e.who === 'worker' && e.to === 'underReview'
      ? l.resubmitted
      : e.who === 'worker' && e.to === 'reopened'
        ? `${l.disputed} → ${t.codeReview.status.reopened}`
        : e.from === e.to
          ? l.taskMade
          : e.to === 'fixed'
            ? `✓ ${t.codeReview.status.fixed}`
            : t.codeReview.status[e.to];
  return `${handedAt(e.at)} · ${l[e.who]} · ${what}${e.note ? `: ${e.note}` : ''}`;
}

/**
 * The one list of a card's code review: the items that need the owner first (raised, reopened), then
 * those the agent is on or the reviewer is to verify, then the fixed, closed and follow-ups, folded to
 * their head line. A click on an item unfolds its text and its log. On an item that needs them the
 * owner decides "Fix it", "As a follow-up task" or "Ignore", with context; a closed or fixed one
 * can be reopened. The decisions stand in the card's draft and go out with the field's one Send.
 */
function ReviewList({ item, act, decides, again, reviewer }: { item: Item; act: (a: CardAction, done: ActDone) => void; decides: boolean; again: boolean; reviewer?: string }) {
  const r = item.review!.codeReview!;
  const cards = useContext(Cards);
  const draft = cardDraft(item.id);
  const picks = useFindingDraft(item).findings ?? {};
  const pick = (n: number, route: FindingPick) =>
    updateDraft(draft, (d) => {
      const { [n]: was, ...rest } = d.findings ?? {};
      return { findings: was === route ? rest : { ...rest, [n]: route } };
    });
  // items fold to their heads unless they need the owner; a click flips that
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const flip = (n: number) =>
    setFlipped((was) => {
      const next = new Set(was);
      if (!next.delete(n)) next.add(n);
      return next;
    });
  const bySeverity = (a: ReviewItem, b: ReviewItem) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.number - b.number;
  const order: ReviewItem['status'][] = ['fixed', 'closed', 'followUp'];
  const sorted = [
    ...r.items.filter(needsOwner).sort(bySeverity),
    ...r.items.filter((i) => i.status === 'fixing' || i.status === 'underReview').sort((a, b) => a.number - b.number),
    ...order.flatMap((s) => r.items.filter((i) => i.status === s).sort((a, b) => a.number - b.number)),
  ];
  const waiting = r.items.filter(needsOwner);
  const choice = (i: ReviewItem, route: FindingPick, label: string, title: string) => (
    <button className={choiceClass({ on: picks[i.number] === route })} aria-pressed={picks[i.number] === route} title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i.number, route)}>
      {label}
    </button>
  );
  const one = (i: ReviewItem) => {
    const waits = needsOwner(i);
    const open = waits !== flipped.has(i.number);
    const task = i.status === 'followUp' && i.card ? cards.items.find((x) => x.id === i.card) : undefined;
    const pill = (
      <span className={statusPill(i.status)} title={t.codeReview.statusHint[i.status]}>
        {i.status === 'fixed' && <Check size={11} strokeWidth={2.5} aria-hidden="true" />}
        {t.codeReview.status[i.status]}
      </span>
    );
    const cls = findingClass({ security: i.security, settled: !waits, folded: !open, extra: ['ritem', i.severity] });
    return (
      <Collapsible key={i.number} className={cls} open={open} onOpenChange={() => flip(i.number)}>
        <div className={findingRow}>
          <CollapsibleTrigger className={findingFold} title={open ? t.codeReview.fold : t.codeReview.unfold}>
            <span className={findingNo}>#{i.number}</span>
            <span className={severityBadge(i.severity)}>{t.codeReview.severity[i.severity]}</span>
            <b>{i.title}</b>
            {i.security && <span className={findingTag}>{t.review.security}</span>}
            {!open && pill}
            <span className={findingChevron}>{open ? <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" /> : <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />}</span>
          </CollapsibleTrigger>
          {(i.status === 'closed' || i.status === 'fixed') && !finished(item.state) && !!ownerField(item) && (
            <LinkButton className={findingReopen} title={t.codeReview.reopenHint} onClick={() => act({ action: 'reopenReviewItem', number: i.number }, { close: false })}>
              {t.codeReview.reopen}
            </LinkButton>
          )}
        </div>
        <CollapsibleContent>
          <>
            <div className={findingText}>
              <Inline md={i.text} /> {pill}
            </div>
            {i.file && (
              <div className={findingWhere}>
                <code>{i.line ? `${i.file}:${i.line}` : i.file}</code>
              </div>
            )}
            {!!i.with?.length && <div className={findingWhere}>{t.codeReview.with(i.with)}</div>}
            {i.status === 'followUp' && (
              <div className={findingStatus()}>
                {task ? (
                  <a href="#" onClick={(e) => (e.preventDefault(), cards.open(task))}>
                    {t.review.laterCard(plain(task.title))} →
                  </a>
                ) : (
                  t.review.goingLater
                )}
              </div>
            )}
            {i.status === 'fixing' && <div className={findingStatus(true)}>{t.codeReview.goingFix}</div>}
            {waits && decides && (
              <>
                <div className={choicesClass('single', findingChoices)} role="group">
                  {choice(i, 'self', t.codeReview.fix, t.codeReview.fixHint)}
                  {choice(i, 'later', t.review.later, t.codeReview.laterHint)}
                  {choice(i, 'ignore', t.review.ignore, t.review.ignoreHint)}
                </div>
                <FindingContext item={item} id={i.number} {...(i.context ? { kept: i.context } : {})} />
              </>
            )}
            {!!i.context && !waits && <p className={findingNote}>{i.context}</p>}
            <ol className={findingLog}>
              {i.log.map((e, k) => (
                <li key={k}>{logLine(e)}</li>
              ))}
            </ol>
          </>
        </CollapsibleContent>
      </Collapsible>
    );
  };
  return (
    <section className={findingsClass(true)}>
      {r.stale && r.state !== 'running' && <p className="hint">{t.codeReview.staleHint}</p>}
      {r.state === 'running' && (
        <>
          <p className={reviewBusy}>{t.codeReview.running(reviewer)}</p>
          <p className="hint">{t.codeReview.runningHint}</p>
          <Button onClick={() => act({ action: 'stopCodeReview' }, { close: false })}>{t.codeReview.stop}</Button>
        </>
      )}
      {r.state === 'failed' && <p className={badClass}>{t.codeReview.failed(r.error ?? '')}</p>}
      {(r.state === 'done' || r.items.length > 0) && <h4 className={cn(headClass, findingsHead)}>{t.codeReview.items(r.items.length, waiting.length)}</h4>}
      {sorted.map(one)}
      {decides && waiting.length > 0 && <p className="hint">{t.codeReview.decideHint}</p>}
      {decides && <ReviewSubmit item={item} />}
      {again && (
        <Button onClick={() => act({ action: 'codeReview' }, { close: false })}>
          {t.codeReview.again}
        </Button>
      )}
    </section>
  );
}

/** Send the selected code review routes from the Review tab, including on phones without chat. */
function ReviewSubmit({ item }: { item: Item }) {
  const draft = cardDraft(item.id);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const openOf = (choices: Record<string, FindingPick> | undefined) => Object.fromEntries(Object.entries(choices ?? {}).filter(([id]) =>
    item.review?.codeReview?.items.some((i) => i.number === Number(id) && needsOwner(i)),
  ));
  if (!Object.keys(openOf(useFindingDraft(item).findings)).length) return null;
  const submit = async (agent?: import('../core/types').AgentSetting) => {
    if (sending) return;
    const now = findingDraftNow(item);
    const findings = openOf(now.findings);
    if (!Object.keys(findings).length) return;
    const findingNotes = notesOf(now.findingNotes, findings);
    setSending(true);
    setError('');
    try {
      await api.act(item.id, { action: 'message', text: '', findings, ...(Object.keys(findingNotes).length ? { findingNotes } : {}), ...(agent ? { newAgent: agent } : {}) });
      sentChoices(draft, findings);
    } catch (e) {
      setError(failText(e));
    } finally {
      setSending(false);
    }
  };
  return (
    <div className={reviewSubmit}>
      <Button type="button" variant="primary" className={startAgentMain} disabled={sending} onClick={() => submit()}><span>{t.codeReview.submitAnswers}</span>{item.agent?.workerSetting && <span className={startAgentModel}>{describeAgent(item.agent.workerSetting, true)}</span>}</Button>
      <StartAgent label={t.codeReview.submitNewAgent} selectionOnly hint={t.codeReview.newAgentHint} disabled={sending} onStart={(agent) => { if (agent) void submit(agent); }} />
      {error && <p className="p-error">{error}</p>}
    </div>
  );
}

/** The findings the owner decides on (their numbers, and those they would make one task with): a review card's open ones, or the items of a card's code review that wait for them (`code`). */
export function findingsOf(item: Item): { open: { id: number; with?: number[] }[]; code: boolean } | null {
  if (item.review?.contribution) return { open: (item.review.contribution.findings ?? []).filter((f) => f.status === 'open' && !f.decided).map((f) => ({ id: f.id, ...(f.with ? { with: f.with } : {}) })), code: false };
  if (item.review?.codeReview) return { open: item.review.codeReview.items.filter(needsOwner).map((i) => ({ id: i.number, ...(i.with ? { with: i.with } : {}) })), code: true };
  return null;
}

/**
 * Unpushed commits on the local main that a review card's PR collides with, as Seismic found before
 * the merge: which commit the pull after it would stop at, the card that landed it (to open), and
 * what the owner can do about it.
 */
function Clash({ clash, onPush }: { clash: ClashFound; onPush?: () => void }) {
  const cards = useContext(Cards);
  const card = clash.card && cards.items.find((x) => x.id === clash.card!.id);
  // a commit named as its card is named once, as the card
  const same = !!clash.card && plain(clash.card.title).trim().toLowerCase() === clash.subject.trim().toLowerCase();
  const named = clash.card && (same ? t.review.clashCommit(clash.subject) : t.review.clashCard(plain(clash.card.title)));
  return (
    <div className={clashClass}>
      <b>{t.review.clashHead(clash.unpushed)}</b>
      <div>
        {!same && <>{t.review.clashCommit(clash.subject)} </>}
        {named &&
          (card ? (
            <a href="#" onClick={(e) => (e.preventDefault(), cards.open(card))}>
              {named}
            </a>
          ) : (
            named
          ))}{' '}
        {t.review.clashFiles(clash.files)}
      </div>
      {onPush && (
        <div className={clashPush}>
          <Button onClick={onPush}>
            {t.review.pushMain}
          </Button>
          <span>{t.review.pushHint}</span>
        </div>
      )}
      <div className={clashWhat}>{t.review.mergeInstead(clash.card ? plain(clash.card.title) : null)}</div>
    </div>
  );
}

/**
 * Approved work that could not land, since main's checkout has uncommitted changes to files the card
 * changes too: they are named, and either button moves them into the card for its agent to work in.
 */
function Blocked({ item, act }: { item: Item; act: (a: CardAction, done: ActDone) => void }) {
  const files = item.review!.blocked!.files;
  return (
    <section className={findingsClass()}>
      <div className={clashClass}>
        <b>{t.blocked.head(files.length)}</b>
        <ul className={blockedFiles}>
          {files.slice(0, 8).map((f) => (
            <li key={f}>
              <code>{f}</code>
            </li>
          ))}
          {files.length > 8 && <li>+ {files.length - 8}</li>}
        </ul>
        <div className={clashWhat}>{t.blocked.what}</div>
        <div className={clashPush}>
          <Button variant="primary" title={t.blocked.landHint} onClick={() => act({ action: 'fold', land: true }, { close: true, ack: t.blocked.landed, pending: t.blocked.folding })}>
            {t.blocked.land}
          </Button>
          <Button title={t.blocked.demoHint} onClick={() => act({ action: 'fold', land: false }, { close: true, ack: t.blocked.demoed, pending: t.blocked.folding })}>
            {t.blocked.demo}
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * The owner's own words on one open finding, at the bottom right of it: "Write more context" opens
 * a text box and turns into "Save"; the saved words show on the finding and go verbatim to the
 * agent with the finding's decision.
 */
/** `kept`: the context an earlier choice on the item sent, which stands until the owner saves new context. */
function FindingContext({ item, id, kept }: { item: Item; id: number; kept?: string }) {
  const draft = cardDraft(item.id);
  const { findingNotes, findingNoteEdits } = useFindingDraft(item);
  const saved = findingNotes?.[id] ?? kept ?? '';
  const edit = findingNoteEdits?.[id];
  const editing = edit !== undefined;
  // what is typed lives in the draft too, so it survives closing the card and reloads, but only Save makes it context to send
  const type = (words: string | undefined) =>
    updateDraft(draft, (d) => {
      const { [id]: _, ...rest } = d.findingNoteEdits ?? {};
      return { findingNoteEdits: words === undefined ? rest : { ...rest, [id]: words } };
    });
  const save = () => {
    updateDraft(draft, (d) => {
      const { [id]: _, ...rest } = d.findingNotes ?? {};
      // clearing the context the item kept is a choice of its own, sent with the decision
      return { findingNotes: edit?.trim() ? { ...rest, [id]: edit } : kept ? { ...rest, [id]: '' } : rest };
    });
    type(undefined);
  };
  return (
    <div className={findingContext}>
      {editing ? (
        <Textarea autoFocus rows={3} value={edit} placeholder={t.review.contextPlaceholder} onChange={(e) => type(e.target.value)} />
      ) : (
        saved && <p className={findingNote}>{saved}</p>
      )}
      <button type="button" className={findingContextButton} onMouseDown={(e) => e.preventDefault()} onClick={() => (editing ? save() : type(saved))}>
        {editing ? t.review.saveContext : saved ? t.review.editContext : t.review.addContext}
      </button>
    </div>
  );
}

/** What went out with the owner's choices leaves the draft: those choices and the saved context of their findings; context of other findings and words still being typed stay. */
function sentChoices(draft: string, sent: Record<string, FindingPick>) {
  const without = (from: Record<string, string> | undefined) => Object.fromEntries(Object.entries(from ?? {}).filter(([id]) => !(id in sent)));
  updateDraft(draft, (d) => ({ findings: undefined, findingNotes: without(d.findingNotes) }));
}

/** The owner's notes on the findings they decided on, trimmed; a finding without words has none. */
const notesOf = (notes: Record<string, string> | undefined, decided: Record<string, FindingPick>) =>
  Object.fromEntries(Object.entries(notes ?? {}).filter(([id, text]) => id in decided && decided[id] !== 'ignore' && (text.trim() || text === '')));

/** A finding the card lists: one the owner ignored goes from the list once the choices are sent. */
export const shownFinding = (f: Finding) => f.status !== 'dropped';

/** A finding whose bundle still means something: open, or made a follow-up task. */
const bundled = (f: Finding) => f.status === 'open' || f.status === 'later';

/**
 * Above the field of a review card, or of a card with a code review: what the owner decided for its
 * findings, which goes out with the words; with several made follow-up tasks, how many tasks they
 * become as they are bundled.
 */
function DecidedChip({ item, decided }: { item: Item; decided: Record<string, FindingPick> }) {
  const { open: findings, code } = findingsOf(item) ?? { open: [], code: false };
  const named = Object.entries(decided).filter(([id]) => findings.some((f) => f.id === Number(id)));
  if (!named.length) return null;
  const later = named.filter(([, route]) => route === 'later').map(([id]) => findings.find((f) => f.id === Number(id))!);
  const tasks = new Set(later.map((f) => [f.id, ...(f.with ?? []).filter((w) => later.some((l) => l.id === w))].sort((a, b) => a - b).join())).size;
  return (
    <div className={`${quoteClass} decided`}>
      <div className={decidedLines}>
        {named.map(([id, route]) => (
          <span key={id} className="quote-text text-[12.5px] leading-[1.4] text-foreground [overflow-wrap:anywhere] line-clamp-3 [[data-slot=prompt-input-body]_&]:line-clamp-2">
            {t.review.decidedLine(Number(id), route === 'self' ? (code ? t.codeReview.fix : t.review.self) : route === 'later' ? t.review.later : route === 'ignore' ? t.review.ignore : t.review.toContributor)}
          </span>
        ))}
        {later.length > 1 && <span className={decidedTasks}>{t.review.tasks(tasks)}</span>}
      </div>
      <CloseButton label={t.review.undecide} size="small" className="quote-clear mt-[3px] mr-[3px]" onMouseDown={(m) => m.preventDefault()} onClick={() => updateDraft(cardDraft(item.id), { findings: undefined })} />
    </div>
  );
}

/**
 * A card's pull request: its checks, whether it is ready, and its review. On a review card whose
 * agent's own changes wait for the approval (`held`), first what goes onto the PR with it: how many
 * commits, the text posted with them, and the findings it asks the contributor for.
 */
function PrBox({ pr, held, author, card, save }: { pr: PullRequest; held?: HeldChanges; author?: string; card?: string; save?: (body: string) => Promise<void> }) {
  // a conflict says so on its own line
  const waits = pr.ready ? [] : (pr.waits ?? []).filter((w) => w !== 'conflict' || !pr.conflict);
  return (
    <div className={questionClass('pr')}>
      <h4>
        <a href={pr.url} target="_blank" rel="noreferrer">
          {t.pr.title(pr.number, pr.repo)} ↗
        </a>
      </h4>
      {held && (
        <div className="pr-held mt-2.5 mb-2 [&_h5]:mt-0 [&_h5]:mb-1 [&_h5]:text-[11px] [&_h5]:tracking-[.08em] [&_h5]:uppercase [&_h5]:text-muted-foreground">
          <h5>
            {t.review.heldHead(pr.number)} · {t.review.heldCommits(held.commits)}
          </h5>
          {card && save ? (
            <HeldText card={card} body={held.body} save={save} />
          ) : (
            <div className="pr-held-text py-1.5 px-2.5 rounded-md bg-card border border-in-pr/25 text-[13px] [&_.p-lead]:my-1">
              <Body md={held.body} />
            </div>
          )}
          {held.asks.length > 0 && author && <div className="pr-held-asks mt-1.5 text-[13px] text-waiting-strong">{t.review.heldAsks(held.asks, author)}</div>}
        </div>
      )}
      {pr.merged && <div className="q-text">{t.pr.merged}</div>}
      {pr.closed && <div className="q-text">{t.pr.closed}</div>}
      {pr.conflict && <div className="q-text">{t.pr.conflict}</div>}
      {waits.length > 0 && <div className="q-text">{t.pr.waits(waits)}</div>}
      {pr.ready && <div className="q-text">{pr.held ? t.pr.held(pr.held.score, pr.held.by) : pr.manual ? t.pr.manual : t.pr.ready(pr.mergeError ?? '')}</div>}
      {pr.checks.length > 0 ? (
        <ul className="checks list-none p-0 mt-1.5 mb-0 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[13px] [&_li]:before:mr-[5px] [&_li]:before:font-bold [&_li.success]:before:content-['✓'] [&_li.success]:before:text-approved [&_li.failure]:before:content-['✗'] [&_li.failure]:before:text-destructive [&_li.pending]:before:content-['○'] [&_li.pending]:before:text-muted-foreground [&_a]:text-inherit">
          {pr.checks.map((c) => (
            <li key={c.name} className={c.state}>
              {c.url ? (
                <a href={c.url} target="_blank" rel="noreferrer">
                  {c.name}
                </a>
              ) : (
                c.name
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="hint">{t.pr.noChecks}</div>
      )}
      {pr.review && <PrReview entries={pr.review} />}
    </div>
  );
}

/** The draft of the text for the PR the owner is rewriting on card `id`, kept like the card's field. */
const heldDraft = (id: string) => `${cardDraft(id)}:pr-text`;

/** Saves what the owner wrote into the text for the PR on card `id` and has not saved yet. */
async function saveHeld(id: string) {
  const { text } = draftOf(heldDraft(id));
  if (!text.trim()) return;
  await api.act(id, { action: 'editHeld', body: text });
  dropDraft(heldDraft(id));
}

/**
 * The text that goes onto the PR with the approval, and "Edit" on it: the text as a field in
 * its place, which "Save" makes the text that goes out, as does the approval. What is typed
 * waits in a draft of its own until then, through closing the card and a reload; words dictated
 * with the cursor in it go in.
 */
function HeldText({ card, body, save }: { card: string; body: string; save: (body: string) => Promise<void> }) {
  const key = heldDraft(card);
  const editing = useDrafting(key);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { text } = useDraft(key);
  const ref = useRef<HTMLTextAreaElement>(null);
  useFitHeight(ref, text, editing);
  useDraftField(key, () => ref.current, false);
  // the field opens with the cursor after the text, where words are mostly added
  useEffect(() => {
    const f = ref.current;
    if (!editing || !f || document.activeElement === f) return;
    f.focus({ preventScroll: true });
    f.setSelectionRange(f.value.length, f.value.length);
  }, [editing]);
  const close = () => {
    dropDraft(key);
    setError('');
  };
  const submit = async () => {
    if (text.trim() === body) return close();
    setSaving(true);
    setError('');
    try {
      await save(text);
      close();
    } catch (e) {
      setError(failText(e));
    } finally {
      setSaving(false);
    }
  };
  if (!editing)
    return (
      <div className="pr-held-text py-1.5 px-2.5 rounded-md bg-card border border-in-pr/25 text-[13px] [&_.p-lead]:my-1">
        <button
          className="pr-held-edit float-right -mr-1 mb-1 ml-2.5 mt-0 py-0.5 px-2 border border-border rounded-lg bg-surface text-muted-foreground text-xs cursor-pointer hover:text-foreground hover:border-in-pr/50"
          title={t.review.heldEditHint}
          onClick={() => updateDraft(key, { text: body })}
        >
          ✎ {t.review.heldEdit}
        </button>
        <Body md={body} />
      </div>
    );
  return (
    <div className="pr-held-editing">
      <Textarea ref={ref} className="pr-held-field block w-full box-border min-h-[6em] border-in-pr/50 text-[14.5px] leading-[1.45] resize-none" value={text} maxLength={20000} onChange={(e) => updateDraft(key, { text: e.target.value })} />
      <div className="pr-held-acts flex flex-wrap items-center gap-2 mt-1.5">
        <Button variant="primary" size="small" disabled={saving || !text.trim()} onClick={() => void submit()}>
          {t.review.heldSave}
        </Button>
        <Button size="small" disabled={saving} onClick={close}>
          {t.review.heldCancel}
        </Button>
        {error && <span className="text-destructive text-[13.5px]">{error}</span>}
      </div>
    </div>
  );
}

/** Approving would put this demo, the latest and not on the page yet, on the page: the owner may opt out, or share it now. */
function sharesLater(item: Item, demo: Demo, onApproval: boolean): boolean {
  const s = item.demo?.share;
  const busy = s?.state === 'publishing' || s?.state === 'withdrawing';
  const here = !!s?.url && (demo.handover !== undefined ? !!s.on?.includes(demo.handover) : !s.stale);
  return onApproval && demo === item.demo?.latest && !here && !busy && !item.review?.landing && (item.state === 'working' || item.state === 'waiting');
}

/** Sharing's box beside the demo: the button and what is under way on the right, the link taking the line once there is one. */
const shareClass = (wide: boolean) =>
  cn('share flex flex-col items-end gap-2 text-[13px] [&_.hint]:m-0', wide ? 'wide flex-[1_1_100%] items-stretch' : '[&>.hint]:text-right');
/** A line in it: buttons on the right, a hint taking what they leave. */
const shareRow = 'share-row flex gap-2 items-center justify-end flex-wrap [&>.hint]:flex-[1_1_240px] [&>.page-changes]:basis-full';
const shareLabel = 'share-label text-[11px] uppercase tracking-[.08em] text-approved font-semibold';
const shareGo = 'share-go inline-flex items-center gap-[7px] [&_svg]:size-4 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:[stroke-width:2] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]';

/** "Share on approval", under the row of buttons that approves. */
function ShareOnApproval({ item, act }: { item: Item; act: (a: CardAction, done: ActDone) => Promise<void> }) {
  return (
    <CheckLabel className="share-check inline-flex mt-2" title={t.share.onApprovalHint}>
      <Switch checked={!item.demo?.notOnApproval} onCheckedChange={(on) => void act({ action: 'shareOnApproval', on }, { close: false })} />
      {item.review?.contribution ? t.review.onApproval : t.share.onApproval}
    </CheckLabel>
  );
}

/**
 * Sharing the demo shown with colleagues: "Teilen" publishes it right away, then the page's link with
 * "Nicht mehr teilen" for this demo. A demo not on the page yet goes onto it beside the versions
 * there ("Add to the page"; an earlier demo in its place by handover) or, the latest, in their place
 * ("Replace on the page"), the worker's word on it first; "Erneut teilen" once the site writes pages
 * differently than when it published this one. Where the site publishes on approval (`onApproval`),
 * the latest demo not on the page has "Share on approval" until the card is approved, and
 * "Teilen" reads "Share now": the owner may share it before approving, or not on approving.
 */
function ShareBox({ item, demo, act, onApproval, vocabulary, unlisted }: { item: Item; demo: Demo; act: (a: CardAction, done: ActDone) => Promise<void>; onApproval: boolean; vocabulary?: PageTags | undefined; unlisted: boolean }) {
  const [copied, copy] = useCopy(2000);
  const s = item.demo?.share;
  const all = [...(item.demo?.earlier ?? []), ...(item.demo?.latest ? [item.demo?.latest] : [])];
  const latest = demo === item.demo?.latest;
  const which = demo.handover !== undefined ? { demo: demo.handover } : {};
  const go = (a: CardAction) => act(a, { close: false });
  const busy = s?.state === 'publishing' || s?.state === 'withdrawing';
  // the versions on the page, by their numbers in the line above
  const numbers = all.flatMap((d, i) => (d.handover !== undefined && s?.on?.includes(d.handover) ? [i + 1] : []));
  const onPage = numbers.length ? t.share.demos(numbers) : null;
  // the earlier demos this one supplements go on a new page with it
  const mine = all.indexOf(demo);
  const along = mine < 0 ? [] : withSupplemented(all, mine).slice(0, -1).map((d) => all.indexOf(d) + 1);
  // a latest demo from before handovers were kept is on the page unless the page shows an earlier one
  const here = !!s?.url && (demo.handover !== undefined ? !!s.on?.includes(demo.handover) : latest && !s.stale);
  const later = sharesLater(item, demo, onApproval);
  const replace = (first: boolean) => (
    <Button key="replace" variant={first ? 'primary' : 'default'} title={t.share.replaceHint} onClick={() => go({ action: 'share', ...which })}>
      {t.share.replace}
    </Button>
  );
  const add = (first: boolean) => (
    <Button key="add" variant={first ? 'primary' : 'default'} title={latest ? t.share.addHint : t.share.addEarlierHint} onClick={() => go({ action: 'share', ...which, add: true })}>
      {latest ? t.share.add : t.share.share}
    </Button>
  );
  const link = (
    <>
      <span className={shareLabel}>{t.share.shared}</span>
      <a className="share-link flex-[1_1_200px] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-foreground" href={s?.url} target="_blank" rel="noreferrer" title={t.share.open}>
        {s?.url?.replace(/^https?:\/\//, '')}
      </a>
      <Button onClick={() => copy(s!.url!)}>
        {copied ? t.share.copied : t.share.copy}
      </Button>
    </>
  );
  return (
    // the button and what is under way stay on the right, where the button was; the link takes the line
    <div className={shareClass(!!s?.url && !busy)}>
      {busy ? (
        <span className="share-busy text-muted-foreground">{s.state === 'publishing' ? t.share.publishing : t.share.withdrawing}</span>
      ) : !s?.url ? (
        <div className={shareRow}>
          {along.length > 0 && <p className="hint">{t.share.along(t.share.demos(along))}</p>}
          <Button className={shareGo} title={later ? t.share.shareNowHint : unlisted ? t.share.shareHintUnlisted : demo.kind === 'html' ? t.share.shareHintHtml : t.share.shareHint} onClick={() => go({ action: 'share', ...which })}>
            <ShareIcon />
            {later ? t.share.shareNow : t.share.share}
          </Button>
        </div>
      ) : here ? (
        <>
          <div className={shareRow}>
            {link}
            <Button title={numbers.length > 1 ? t.share.stopOneHint : t.share.stopHint} onClick={() => go({ action: 'unshare', ...which })}>
              {t.share.stop}
            </Button>
          </div>
          {all.length > 1 && onPage && <p className="hint">{t.share.onPage(onPage)}</p>}
          {s.unlisted && <p className="hint">{t.share.unlisted}</p>}
          {s.outdated && (
            <div className={shareRow}>
              <p className="hint">{t.share.outdated}</p>
              <PageChangeList changes={s.outdated.map((id) => ({ id }))} />
              <Button title={t.share.reshareHint} onClick={() => go({ action: 'share', ...which })}>
                {t.share.reshare}
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className={shareRow}>{link}</div>
          <div className={shareRow}>
            <p className="hint">
              {t.share.pageShows(onPage)}
              {latest && demo.follows && all.length > 1 && (
                <>
                  <br />
                  <span className="agent-says text-muted-foreground text-xs">{t.share.agentSays(demo.follows, all.length - 1)}</span>
                </>
              )}
            </p>
            {/* the worker's word comes first; without it "Replace on the page", as the latest demo always went out before */}
            {!latest ? add(false) : demo.follows === 'supplements' ? [add(true), replace(false)] : [replace(true), add(false)]}
          </div>
        </>
      )}
      {vocabulary && <ShareTags tags={item.demo?.tags} vocabulary={vocabulary} set={(dimension, values) => go({ action: 'pageTags', dimension, values })} />}
    </div>
  );
}

/**
 * The page's tags as chips, before sharing and after: × takes one off, "+" offers the values of the
 * site's vocabulary the page lacks. A change takes effect at once (a shared page goes out again), and
 * stays: neither a later worker nor Seismic's reading session changes what the owner set.
 */
function ShareTags({ tags, vocabulary, set }: { tags: PageTags | undefined; vocabulary: PageTags; set: (dimension: string, values: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const shown = shownTags(tags, vocabulary);
  const on = new Map(shown);
  const rest = dimensions(vocabulary).flatMap(([d, values]) => {
    const left = values.filter((v) => !on.get(d)?.includes(v));
    return left.length ? [[d, left] as const] : [];
  });
  return (
    <div className={cn(shareRow, 'share-tags gap-1.5 [&_.t]:[text-box:trim-both_cap_alphabetic]')} title={t.share.tagsHint}>
      <span className={cn(shareLabel, 'text-muted-foreground [text-box:trim-both_cap_alphabetic]')}>{t.share.tags}</span>
      {!shown.length && <span className="hint t">{t.share.noTags}</span>}
      {shown.flatMap(([d, values]) =>
        values.map((v) => (
          <Badge key={`${d}\n${v}`} variant="chip">
            <span className="t">
              <span className="text-muted-foreground">{d}:</span> {v}
            </span>
            <CloseButton label={t.share.removeTag(d, v)} size="small" className="rounded-full" onClick={() => set(d, values.filter((x) => x !== v))} />
          </Badge>
        )),
      )}
      {rest.length > 0 && (
        <Menu open={open} onOpenChange={setOpen}>
          <Tooltip content={t.share.addTag}>
            <MenuTrigger asChild>
              <button className="tag-add cursor-pointer grid place-items-center size-6 p-0 rounded-full border border-dashed border-muted-foreground bg-transparent text-muted-foreground box-border hover:border-solid hover:text-foreground data-[state=open]:border-solid data-[state=open]:text-foreground [&_svg]:size-2.5" aria-label={t.share.addTag}>
                <Plus size={10} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </MenuTrigger>
          </Tooltip>
          <MenuContent className="tag-menu w-[min(340px,calc(100vw-28px))] py-2.5 px-3 grid gap-2.5 whitespace-normal border border-glass-edge rounded-xl" align="end">
            {rest.map(([d, values]) => (
              <div key={d} className="tag-dim flex flex-wrap items-center gap-1.5">
                <MenuLabel className="basis-full p-0 text-xs">{d}</MenuLabel>
                {values.map((v) => (
                  <MenuItem key={v} className={cn(badgeVariants({ variant: 'chip' }), 'cursor-pointer px-2.5 outline-none data-[highlighted]:bg-border')} onSelect={() => set(d, [...(on.get(d) ?? []), v])}>
                    {v}
                  </MenuItem>
                ))}
              </div>
            ))}
          </MenuContent>
        </Menu>
      )}
    </div>
  );
}

/** Sharing's mark on its button: a box with an arrow going out of it. */
function ShareIcon() {
  return (
    <Share strokeWidth={2} aria-hidden="true" />
  );
}

/**
 * "Teilen" where the repository has no share target: the demo as a file to pass on, a ZIP of its
 * page with the video or the HTML artifact beside it, or one HTML file that holds everything
 * (short videos, artifacts that are their index.html alone). Where its site lacks its credentials
 * on this machine, a line under the buttons names the file.
 */
function ExportBox({
  item,
  demo,
  run,
  needs,
  site,
  onDemoSites,
}: {
  item: Item;
  demo: Demo;
  run: Run;
  needs?: { site: string; file: string } | undefined;
  /** Why the project shares on no site: it has none, or its path there is not initialized yet. */
  site?: 'none' | 'init' | undefined;
  /** Opens the project's settings, where it chooses its demo site. */
  onDemoSites?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'zip' | 'html' | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const artifact = demo.kind === 'html';
  // the demo shown: the latest, or an earlier one by its place among the card's earlier demos
  const n = demo === item.demo?.latest ? undefined : (demo as EarlierDemo).n;
  useEffect(() => {
    setSize(null);
    if (open && !artifact) api.demoSize(item.id, n).then(setSize, () => {});
  }, [open, item.id, artifact, n]);
  const tooLarge = size !== null && size > EXPORT_HTML_MAX;
  const notAlone = artifact && !demo.single;
  const go = (as: 'zip' | 'html') => {
    setBusy(as);
    void run(() => api.exportDemo(item.id, as, demo === item.demo?.latest ? undefined : demo.handover), { close: false }).finally(() => setBusy(null));
  };
  return (
    <div className={shareClass(open)}>
      {!open ? (
        <Button className={shareGo} title={t.share.exportHint} onClick={() => setOpen(true)}>
          <ShareIcon />
          {t.share.share}
        </Button>
      ) : (
        <>
          {!needs && <p className="hint">{t.share.exportIntro}</p>}
          <div className={shareRow}>
            <Button title={artifact ? t.share.zipHintHtml : t.share.zipHint} disabled={!!busy} onClick={() => go('zip')}>
              {busy === 'zip' ? t.share.preparing : t.share.zip}
            </Button>
            <Button
              title={tooLarge ? t.share.tooLarge(size!) : notAlone ? t.share.notAlone : artifact ? t.share.htmlHintHtml : t.share.htmlHint}
              disabled={!!busy || tooLarge || notAlone}
              onClick={() => go('html')}
            >
              {busy === 'html' ? t.share.preparing : t.share.html}
            </Button>
          </div>
          {tooLarge && <p className="hint">{t.share.tooLarge(size!)}</p>}
          {notAlone && <p className="hint">{t.share.notAlone}</p>}
          {busy && !demo.page && <p className="hint">{t.share.writingPage}</p>}
        </>
      )}
      {needs && <p className="hint">{t.share.needsEnv(needs.site, needs.file)}</p>}
      {open && site && onDemoSites && (
        <p className="hint">
          {site === 'init' ? t.share.siteNotReady : t.share.noSite}{' '}
          <LinkButton onClick={onDemoSites}>
            {site === 'init' ? t.share.initSite : t.share.chooseSite}
          </LinkButton>
        </p>
      )}
    </div>
  );
}

/**
 * Takes a finished card or a parked or dropped idea into the archive, or an archived one back onto
 * the project; `className`, `label` and `hint` dress the button that archives.
 */
function ArchiveButton({ item, run, variant, label = t.archive.archive, hint }: { item: Item; run: Run; variant?: ButtonVariant; label?: string; hint?: string }) {
  const title = plain(item.title);
  // a stopped task whose workstation holds work stays on the project; the button says why
  const held = stopped(item) && !stoppedArchivable(item);
  return item.archivedAt ? (
    <Button onClick={() => run(() => api.unarchive(item.id), { close: true, ack: t.archive.unarchived(title) })}>
      {t.archive.unarchive}
    </Button>
  ) : (
    <Button variant={variant} disabled={held} title={held ? t.archive.holdsWork : hint} onClick={() => run(() => api.archive(item.id), { close: true, ack: t.archive.archived(title), undo: () => api.unarchive(item.id), rate: item.id })}>
      {label}
    </Button>
  );
}

// ------------------------------------------------------------------ manual cards

function ManualTitle({ item, onEdit }: { item: Item; onEdit: (p: CardPatch) => void }) {
  // a local draft: the server echo must not overwrite what is being typed
  const [title, setTitle] = useState(item.title);
  // one line of text that wraps: a long title shows in full instead of running out of the box
  const ref = useRef<HTMLTextAreaElement>(null);
  useFitHeight(ref, title);
  // the title Seismic gave the card while it is open shows, unless the owner has typed in the field
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current && !title && item.title) setTitle(item.title);
  }, [item.title]);
  return (
    <Textarea
      bare
      ref={ref}
      className={titleFieldClass}
      rows={1}
      value={title}
      placeholder={t.titleOptional}
      maxLength={200}
      onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
      onChange={(e) => {
        const v = e.target.value.replace(/\s*\n\s*/g, ' ');
        typed.current = true;
        setTitle(v);
        onEdit({ title: v });
      }}
    />
  );
}

/** `fresh`: the repository picker offers a new repository (not on a proposal, which starts where it is). */
function ManualFields({ item, repos, choice, fresh, onEdit, grow }: { item: Item; repos: RepoRef[]; choice: RepoChoice; fresh?: boolean; onEdit: (p: CardPatch, id?: string) => void; grow?: boolean }) {
  const [body, setBody] = useState(item.body);
  const ref = useRef<LinkFieldHandle>(null);
  // a dropped file's path goes in as typed while the field has the cursor, else after the text
  // (the latest, which a path put in just before is part of before React has drawn it)
  const latest = useRef(body);
  latest.current = body;
  const put = (path: string) => {
    const field = ref.current;
    if (field?.el && field.el === document.activeElement) return field.type(` ${path} `);
    const next = (latest.current = appended(latest.current, path));
    setBody(next);
    onEdit({ body: next }, item.id);
  };
  // named by the card: an upload may end once the card has closed, or the page shows another project
  const shots = useShotInput({ name: `card-${item.id}`, initial: item.images, onChange: (images) => onEdit({ images }, item.id), put });
  return (
    <>
      {!item.idea?.newRepo?.due && <RepoPick choice={choice} repos={repos} fresh={!!fresh} />}
      {/* the task's screenshots: the worker gets them with the task when it starts */}
      <div className={cn('p-body-field max-w-[76ch] [.split-main_&]:max-w-none [&_.c-shots]:mt-4 [&_.card-refs-hint]:absolute [&_.card-refs-hint]:top-full [&_.card-refs-hint]:left-0 [&_.card-refs-hint]:mt-1.5 [&_.card-refs-hint]:mx-0 [&_.card-refs-hint]:mb-0 max-[760px]:has-[.card-refs-hint]:pb-[30px]', shots.dropping && 'dropping')} {...shots.drop}>
        <ShotStrip shots={shots} />
        {/* a proposal's text shows in full as far as the screen allows, the panel growing with it */}
        <div className={cn('c-field relative', grow && 'expand')}>
          <LinkField
            ref={ref}
            self={item}
            className={bodyClass}
            value={body}
            placeholder={t.bodyPlaceholder}
            onPaste={shots.onPaste}
            onChange={(md) => {
              setBody(md);
              onEdit({ body: md });
            }}
          />
          <AttachButton shots={shots} />
        </div>
        {shots.error && <p className="c-error text-destructive mt-1.5 mb-0 text-[13.5px]">{shots.error}</p>}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ talking to the worker

/**
 * A task's conversation, from its idea's discussion on: the question its worker waits on (its own,
 * or the one in its demo report) stands at the end, and under it the card's one field (`ownerField`).
 */
function TaskTalk({
  item,
  listener,
  act,
  tell,
}: {
  item: Item;
  listener?: string;
  act: (a: CardAction, done: ActDone) => Promise<void>;
  tell: (field: Field) => (text: string, images?: string[], replyTo?: number) => Promise<void>;
}) {
  const field = ownerField(item);
  const key = JSON.stringify(item.question ?? null);
  return (
    <Talk
      item={item}
      field={
        field
          ? {
              key: `${item.state}:${item.need ?? ''}:${field}:${key}`,
              placeholder: { note: snoozeOf(item) && !snoozeOf(item)!.waiting && !snoozeOf(item)!.start ? t.snooze.compose : isPaused(item) || isPausing(item) ? t.pause.compose : askable(item) || item.agent?.followUp ? t.compose.followUp : asksAhead(item) ? t.compose.ahead : agentWorks(item) ? t.compose.working : holdsNotes(item) ? t.compose.queued : t.compose.idle, answer: t.compose.question, feedback: t.compose.review, demo: t.compose.demo, discuss: '', revise: t.compose.revise }[field],
              listener,
              onWords: tell(field),
              onPicked: (text, [picks = []], images, replyTo) => act({ action: 'answer', text, picks, images, ...(replyTo ? { replyTo } : {}) }, { close: false }),
              onDecided: (text, findings, images, replyTo, findingNotes) => act({ action: 'message', text, findings, ...(findingNotes ? { findingNotes } : {}), ...(images ? { images } : {}), ...(replyTo ? { replyTo } : {}) }, { close: false }),
            }
          : undefined
      }
    />
  );
}

/**
 * The layout every card with a conversation shares, idea, proposal, task or question: what the card
 * is about on the left (brief, text, demo), the conversation on the right; the decisions go below
 * both. Without anything on the left (a task with no result yet, a question), the conversation
 * stands alone. `cite`:
 * the draft of the card's field, which text marked on the left can be quoted into.
 */
function Split({ main, talk, className, cite }: { main: ReactNode; talk: ReactNode; className?: string; cite?: string | false }) {
  const box = useRef<HTMLDivElement>(null);
  // on the phone the field is in a panel of its own, which a quote brings up
  const away = useContext(TalkElsewhere);
  const [folded, fold] = useFoldedTalk();
  const show = (focus?: boolean) => {
    fold(false);
    if (focus) setTimeout(() => document.querySelector<HTMLTextAreaElement>('.card-sheet .split-talk .composer textarea')?.focus(), 0);
  };
  const foldable = !!main && !away;
  const closed = foldable && folded;
  const toggle = (
    <Tooltip content={closed ? t.talk.show : t.talk.hide}>
      <button type="button" className="split-fold self-end inline-flex items-center justify-center size-[26px] p-0 mb-1.5 border-0 bg-transparent text-muted-foreground rounded-[4px] cursor-pointer hover:bg-[color:--alpha(currentColor/12%)] [.folded>&]:absolute [.folded>&]:top-0 [.folded>&]:right-0 [.folded>&]:m-0 [.folded>&]:z-1 max-[760px]:hidden" aria-label={closed ? t.talk.show : t.talk.hide} aria-expanded={!closed} onClick={() => fold(!closed)}>
        {closed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
      </button>
    </Tooltip>
  );
  return (
    <TalkFolded.Provider value={{ folded: closed, show }}>
    {/* as tall as its taller column, up to the room down to the microphone (fitPanel in App.tsx sets that as its
        max-height); beyond it, the columns scroll. Without anything on the left, or with the conversation folded
        away (its column stays mounted, as drafts live in it), one column. On the phone the conversation is in the
        panel (`TalkElsewhere`): what the card is about is the page, which alone scrolls */}
    <div
      className={cn(
        'split relative grid grid-cols-[minmax(0,1fr)_clamp(400px,36%,560px)] grid-rows-[minmax(0,1fr)] gap-6 mt-4 max-h-[min(600px,calc(100vh-370px))] max-[760px]:grid-cols-1 max-[760px]:grid-rows-none max-[760px]:max-h-none phone:grid-cols-[minmax(0,1fr)] phone:grid-rows-none phone:max-h-none phone:gap-[18px] phone:empty:hidden',
        className,
        (!main || closed) && 'grid-cols-[minmax(0,1fr)]',
        !main && 'alone',
        closed && 'folded [&>.split-talk]:hidden max-[760px]:[&>.split-talk]:flex',
      )}
    >
      {/* its scrollbar's place stays: a bar coming as an artifact's frame grew narrowed the page in it, which grew anew */}
      {main && (
        <div className="split-main overflow-auto min-h-0 pr-1 [scrollbar-gutter:stable] [&>:first-child]:mt-0 phone:overflow-visible phone:pr-0" ref={box}>
          {main}
        </div>
      )}
      {main && cite && <CiteButton box={box} draft={cite} anywhere onCite={away ? () => away.open(true) : closed ? () => show(true) : undefined} />}
      {closed && toggle}
      <TalkColumn foldButton={foldable && !closed ? toggle : undefined}>{talk}</TalkColumn>
    </div>
    </TalkFolded.Provider>
  );
}

/** Whether the card's conversation column is folded away, and how to bring it back (`focus`: the cursor in its field). */
const TalkFolded = createContext<{ folded: boolean; show: (focus?: boolean) => void }>({ folded: false, show: () => {} });

const TALK_FOLDED = 'obeya.talkFolded';

/** Whether the owner folded the conversation column away on the full-size card, kept in this browser. */
function useFoldedTalk(): [boolean, (v: boolean) => void] {
  const [folded, set] = useState(() => {
    try {
      return localStorage.getItem(TALK_FOLDED) === '1';
    } catch {
      return false;
    }
  });
  return [
    folded,
    (v) => {
      try {
        localStorage.setItem(TALK_FOLDED, v ? '1' : '0');
      } catch {}
      set(v);
    },
  ];
}

/**
 * Where a card's conversation goes instead of its column: the phone view's panel from below (`el`,
 * null while the panel is closed), which `open` brings up, with the cursor in the field when `focus`;
 * None on the project.
 */
export const TalkElsewhere = createContext<{ el: HTMLElement | null; open: (focus?: boolean) => void } | null>(null);

/** A card's conversation: in its column, or where `TalkElsewhere` puts it. `bare`: no column of its own on the project. */
function TalkColumn({ children, bare, foldButton }: { children: ReactNode; bare?: boolean; foldButton?: ReactNode }) {
  const away = useContext(TalkElsewhere);
  if (away) return away.el && createPortal(children, away.el);
  return bare ? children : <div className="split-talk flex flex-col min-h-0 [&_[data-slot=prompt-input]]:mt-2.5 [&_[data-slot=prompt-input]]:max-w-none">{foldButton}{children}</div>;
}

/** The owner's one field under a conversation: words, and the options picked, go out with one Send. */
interface TalkField {
  placeholder: string;
  /** Seismic, when it reads the words rather than the card's agent. */
  listener?: string;
  /** Starts the field afresh when it changes (another question, another state). */
  key?: string;
  noImages?: boolean;
  /**
   * The picks stand in the text, each with its question: the conversation is read later without
   * the questions beside. Without it the text is the owner's words, and the picks go apart from
   * them; the conversation marks them on the question.
   */
  quote?: boolean;
  /** Words alone go to the card's agent, or to the Koordinator that `listener` names; `replyTo`: the message they reply to. */
  onWords: (text: string, images?: string[], replyTo?: number) => Promise<void>;
  /** Picked options go to the agent with the words: `picks` holds them for each question, and with `quote` the text names them too. */
  onPicked: (text: string, picks: string[][], images?: string[], replyTo?: number) => Promise<void>;
  /** On a review card or a card with a code review: the owner's decisions on the findings go to the agent with the words. */
  onDecided?: (text: string, findings: Record<string, FindingPick>, images?: string[], replyTo?: number, findingNotes?: Record<string, string>) => Promise<void>;
}

/**
 * The right column of every card with a conversation: the conversation with the questions it waits
 * on at its end, and under it the owner's one field (none where nobody hears it). `past`: nobody
 * works on the card any more. Where the field is, the owner can reply to a message of the
 * conversation: it stands quoted above the field, and the words go out with it.
 */
function Talk({ item, past, field }: { item: Item; past?: boolean; field?: TalkField }) {
  const picks = useOpenQuestions(item, past);
  const { questions, picked } = picks;
  const options = questions.some((q) => q.options.length > 0);
  const draft = cardDraft(item.id);
  // the demo video stands at a place: the words are about it, where the card's agent hears them
  const place = usePlace(item.id);
  const at = field && !field.listener && !options ? place : null;
  // the field of a review card or a card with a code review, where its agent hears the words: the owner's decisions on the findings go with them
  const decidable = !!field && !field.listener && !finished(item.state) ? findingsOf(item) : null;
  const openOf = (all: Record<string, FindingPick> | undefined) => (decidable && all ? Object.fromEntries(Object.entries(all).filter(([id]) => decidable.open.some((f) => f.id === Number(id)))) : {});
  const decided = openOf(useFindingDraft(item).findings);
  const deciding = Object.keys(decided).length > 0;
  const send = async (words: string, images?: string[], to?: Reply['to']) => {
    const replyTo = typeof to === 'number' ? to : undefined;
    const now = findingDraftNow(item);
    const decided = openOf(now.findings);
    if (Object.keys(decided).length && field!.onDecided) {
      const findingNotes = notesOf(now.findingNotes, decided);
      await field!.onDecided(words.trim(), decided, images, replyTo, Object.keys(findingNotes).length ? findingNotes : undefined);
      sentChoices(draft, decided);
      return;
    }
    // the owner's own answer goes with the options picked, as a pick that is no option
    await (picked ? field!.onPicked(field!.quote ? answerText(questions, picks.answers, words) : words.trim(), picks.answers, images, replyTo) : field!.onWords(words, images, replyTo));
    picks.clear();
  };
  return (
    <>
      <Conversation
        item={item}
        past={past}
        onReply={field ? (e) => setReply(draft, { to: e.id, quote: eventQuote(e) }) : undefined}
        draft={field ? draft : undefined}
        questions={<Questions {...picks} />}
      />
      {field && (
        <Composer
          key={field.key}
          draft={draft}
          placeholder={questions.length ? t.ask.words : at ? t.demo.commentAt(mmss(at.at)) : field.placeholder}
          label={questions.length ? t.ask.send : t.send}
          allowEmpty={picked || deciding}
          obeya={field.listener}
          noImages={field.noImages}
          skills={field.listener ? undefined : item.id}
          chip={
            (at || deciding) && (
              <>
                {at && <PlaceChip cardId={item.id} place={at} />}
                {deciding && <DecidedChip item={item} decided={decided} />}
              </>
            )
          }
          onSend={send}
        />
      )}
    </>
  );
}

/** The place in the demo video the words in the field are about: its frame, time and chapter, with × to take it out. */
function PlaceChip({ cardId, place }: { cardId: string; place: Place }) {
  const frame = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const v = videoOf(cardId);
    const c = frame.current;
    if (!v?.videoWidth || !c) return;
    c.width = 64;
    c.height = Math.round((64 * v.videoHeight) / v.videoWidth);
    try {
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    } catch {}
  }, [place.at]);
  return (
    <div className={`${quoteClass} place`} title={t.demo.place}>
      <canvas ref={frame} className="place-frame flex-none w-12 rounded-[2px] bg-slate-800 block" />
      <span className="place-text flex-1 min-w-0 text-[13px] text-muted-foreground [&_b]:text-foreground">
        <b>{mmss(place.at)}</b>
        {place.chapter && ` · ${place.chapter}`}
      </span>
      <CloseButton label={t.demo.unplace} size="small" className="quote-clear mt-[3px] mr-[3px]" onMouseDown={(m) => m.preventDefault()} onClick={dismissPlace} />
    </div>
  );
}

/** Above the owner's words in the conversation: the place in the demo video they are about; a click plays the video from there. */
function SpotLink({ cardId, spot }: { cardId: string; spot: Spot }) {
  return (
    <button className="spot flex items-center gap-2 mt-[5px] mb-1 p-0 border-0 bg-transparent text-[13px] text-working cursor-pointer text-left [&_img]:w-16 [&_img]:rounded-[2px] [&_img]:block hover:[&_span]:underline" title={t.demo.toPlace} onClick={() => seekTo(cardId, spot.at, spot.demo)}>
      {spot.still && <img src={imageUrl(spot.still)} alt="" loading="lazy" />}
      <span className="inline-flex items-center gap-1">
        <Play size={11} aria-hidden className="fill-current" />
        {mmss(spot.at)}
        {spot.chapter && ` · ${spot.chapter}`}
      </span>
    </button>
  );
}

/**
 * The questions the card waits on (`openQuestions`, none once nobody works on it: `past`), and the
 * options the owner picked for each; they start over when the questions change. They stand in the
 * card's draft beside its words, so they outlive closing the card and a page load. While the questions
 * are not open (the agent works on a reply), the picks wait in the draft until they are again.
 */
function useOpenQuestions(item: Item, past = false) {
  const json = JSON.stringify(past ? [] : openQuestions(item));
  const questions = useMemo(() => JSON.parse(json) as Question[], [json]);
  const draft = cardDraft(item.id);
  const key = questionsKey(questions);
  const saved = useDraft(draft).picks;
  const picks = saved?.of === key ? saved.picks : [];
  const others = (saved?.of === key && saved.others) || [];
  // `write`: the owner's own answer to the question, which picks its choice as they write
  const choose = (i: number, o: string, write?: string) =>
    updateDraft(draft, (d) => {
      const was = d.picks?.of === key ? d.picks : { picks: [], others: [] };
      const on = (j: number) => was.picks[j] ?? [];
      const toggled = (j: number) => (write !== undefined && on(j).includes(OTHER) ? on(j) : toggleOther(questions[j]!, on(j), o));
      const wrote = was.others ?? [];
      return {
        picks: {
          of: key,
          picks: questions.map((_, j) => (j === i ? toggled(j) : on(j))),
          ...(write !== undefined || wrote.length ? { others: questions.map((_, j) => (j === i && write !== undefined ? write : (wrote[j] ?? ''))) } : {}),
        },
      };
    });
  const clear = () => updateDraft(draft, { picks: undefined });
  const given = answers(picks, others);
  return { questions, picks, others, answers: given, choose, clear, picked: given.some((x) => x.length > 0) };
}

/** An agent's questions, each with its options as radio buttons, or checkboxes when several may be chosen. */
function Questions(p: { questions: Question[]; picks: string[][]; others: string[]; choose: (i: number, option: string, write?: string) => void }) {
  if (!p.questions.length) return null;
  return (
    <div className={questionClass('ask')}>
      <h4>{p.questions.length > 1 ? t.ask.questions : t.ask.question}</h4>
      {p.questions.map((q, i) => (
        <div key={i} className="ask-q">
          <div className="q-text">
            <Body md={q.text} />
          </div>
          {/* a question without options has the owner's own answer alone */}
          {q.options.length > 0 ? (
            <div className={choicesClass(q.multiple ? 'multiple' : 'single')} role={q.multiple ? 'group' : 'radiogroup'}>
              {q.multiple && <div className="hint">{t.ask.several}</div>}
              {q.options.map((o) => {
                const on = (p.picks[i] ?? []).includes(o);
                return (
                  <button
                    key={o}
                    role={q.multiple ? 'checkbox' : 'radio'}
                    aria-checked={on}
                    className={choiceClass({ on, picked: q.pick?.options.includes(o) })}
                    // a click must not take the focus: Space would then not reach push-to-talk
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => p.choose(i, o)}
                  >
                    <span>
                      <Inline md={o} />
                      {q.pick?.options.includes(o) && <span className={pickTag}>{t.ask.pick}</span>}
                    </span>
                  </button>
                );
              })}
              <OtherChoice multiple={!!q.multiple} on={(p.picks[i] ?? []).includes(OTHER)} text={p.others[i] ?? ''} onToggle={() => p.choose(i, OTHER)} onWrite={(text) => p.choose(i, OTHER, text)} />
            </div>
          ) : (
            <div className={choicesClass()}>
              <OtherChoice alone on text={p.others[i] ?? ''} onToggle={() => {}} onWrite={(text) => p.choose(i, OTHER, text)} />
            </div>
          )}
          {q.pick?.why && <div className="pick-why mt-1.5 text-[12.5px] text-muted-foreground">{t.ask.pickWhy(q.pick.why)}</div>}
        </div>
      ))}
    </div>
  );
}

/**
 * The last choice of a question with options: the owner's own answer, in a field of its own.
 * Writing in it picks it; a click beside the field picks it or takes it back. `alone`: the
 * question has no options, and the field is all there is to answer it with.
 */
function OtherChoice({ multiple, alone, on, text, onToggle, onWrite }: { multiple?: boolean; alone?: boolean; on: boolean; text: string; onToggle: () => void; onWrite: (text: string) => void }) {
  const field = useRef<HTMLTextAreaElement>(null);
  return (
    <div
      role={alone ? undefined : multiple ? 'checkbox' : 'radio'}
      aria-checked={alone ? undefined : on}
      className={choiceClass({ other: true, alone, on: on && !alone, picked: false })}
      // a tab stop of its own, picked or taken back with Enter as the options are (Space is push-to-talk)
      tabIndex={alone ? undefined : 0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        onToggle();
      }}
      onMouseDown={(e) => e.target !== field.current && e.preventDefault()}
      onClick={(e) => {
        if (e.target === field.current) return;
        if (alone) return field.current?.focus();
        onToggle();
        if (!on) field.current?.focus();
      }}
    >
      <Textarea
        bare
        ref={field}
        rows={1}
        value={text}
        placeholder={t.ask.other}
        aria-label={t.ask.other}
        // a click into a written answer picks it; focus alone does not, as the click beside the field already has
        onMouseDown={() => !alone && !on && text.trim() && onToggle()}
        onChange={(e) => onWrite(e.target.value)}
      />
    </div>
  );
}

/** A card's log, live; null while the history loads. It loads anew once the connection is back: what was pushed meanwhile never came. */
export function useEvents(cardId: string): CardEvent[] | null {
  const [events, setEvents] = useState<CardEvent[] | null>(null);
  useEffect(() => {
    let alive = true;
    // lines pushed while the history loads are merged in afterwards, without those taken out meanwhile
    let loading: { early: CardEvent[]; gone: Set<number> } | null = null;
    const load = () => {
      const now = { early: [] as CardEvent[], gone: new Set<number>() };
      loading = now;
      api.events(cardId).then(
        (list) => {
          if (!alive || loading !== now) return;
          loading = null;
          // what came meanwhile is newer than what the history says of the same line
          const fresh = new Map(now.early.map((e) => [e.id, e]));
          const seen = new Set(list.map((e) => e.id));
          setEvents([...list.map((e) => fresh.get(e.id) ?? e), ...now.early.filter((e) => !seen.has(e.id))].filter((e) => !now.gone.has(e.id)));
        },
        () => {
          // the connection went again: the next one loads it
          if (loading === now) loading = null;
        },
      );
    };
    const off = onCardEvent((e) => {
      if (e.cardId !== cardId) return;
      // a line comes again once it changed (the agent read the owner's words)
      const known = (list: CardEvent[]) => [...list.filter((x) => x.id !== e.id), e].sort((a, b) => a.id - b.id);
      loading?.early.push(e);
      setEvents((cur) => cur && (cur.some((x) => x.id === e.id) ? known(cur) : [...cur, e]));
    });
    const offGone = onCardEventGone((c, id) => {
      if (c !== cardId) return;
      loading?.gone.add(id);
      setEvents((cur) => cur && cur.filter((x) => x.id !== id));
    });
    const offBack = onReconnect(load);
    load();
    return () => {
      alive = false;
      off();
      offGone();
      offBack();
    };
  }, [cardId]);
  return events;
}

/** The owner's words for a logged error: the text for its code, else the server's text. */
const eventText = (e: CardEvent) => (e.code ? errorText(e.code) : e.text);

/** The error the box above the conversation explains a failed start with, which offers the login there and not again in the conversation. */
const explainedFailure = (item: Item, events: CardEvent[] | null | undefined) => {
  const last = item.state === 'planned' && !item.queue ? events?.at(-1) : undefined;
  return last?.kind === 'error' ? last : undefined;
};

/**
 * Why a planned card is not running: a start through the Koordinator that failed afterwards drops
 * the card back to planned, and the reason is the last entry of its log.
 */
function LastFailure({ item }: { item: Item }) {
  const last = explainedFailure(item, useEvents(item.id));
  if (!last) return null;
  return (
    <div className={questionClass('failed')}>
      <h4>{t.lastFailure(time(last.at))}</h4>
      <div className="q-text" title={last.code ? last.text : undefined}>
        {eventText(last)}
        {claudeLoginFailed(last.text) && <Reauthenticate start token={last.token} />}
      </div>
    </div>
  );
}

/** The first line of a comment, for its folded view. */
const firstLine = (md: string) => (md.split('\n').find((l) => l.trim()) ?? '').replace(/^\s*[-*+]\s+/, '').trim();

/** Who wrote a PR comment: the PR's author is the worker, writing in the owner's name. */
const who = (c: { author: string; mine?: boolean }) => (c.mine ? t.pr.agent : c.author);

/**
 * A pull request's review: each round a reviewer left comments on the code in, every comment
 * folded to its first line with whether its thread is done; unfolded, the comment and the replies.
 * Between the rounds the conversation (the requests for another round, the reviewer's summary).
 */
const prFirst = 'pr-first flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap';
const prMeta = 'pr-meta flex-none text-muted-foreground text-xs';
const prBody = 'pr-body mt-0.5 mb-2 ml-[18px] py-1.5 px-2.5 bg-card rounded-[2px] border border-border [&_:is(.p-lead,.p-list)]:text-[13px] [&_:is(.p-lead,.p-list)]:my-1 [&_a]:text-inherit [&_a]:text-xs';

function PrReview({ entries }: { entries: PrReviewEntry[] }) {
  let round = 0;
  return (
    <div className="pr-review mt-3 border-t border-in-pr/30 pt-2 text-[13px] [&_h5]:mt-0 [&_h5]:mb-1.5 [&_h5]:text-[11px] [&_h5]:tracking-[.08em] [&_h5]:uppercase [&_h5]:text-muted-foreground">
      <h5>{t.pr.review}</h5>
      {entries.map((e, i) =>
        'threads' in e ? (
          <div key={i} className="pr-round my-2">
            <div className="pr-head text-muted-foreground mb-[3px] [&_b]:text-foreground [&_b]:font-semibold">
              <b>{t.pr.round(++round, who(e))}</b> · {time(e.at)} · {t.pr.threads(e.threads.length, e.threads.filter((th) => !th.resolved).length)}
            </div>
            {e.threads.map((th, j) => (
              <Collapsible key={j} className={cn('pr-thread ml-0.5 [&>[data-slot=collapsible-trigger]]:after:flex-none [&>[data-slot=collapsible-trigger]]:after:-order-1 [&>[data-slot=collapsible-trigger]]:after:font-bold [&>[data-slot=collapsible-trigger]]:before:-order-2', th.resolved ? "resolved [&>[data-slot=collapsible-trigger]]:after:content-['✓'] [&>[data-slot=collapsible-trigger]]:after:text-approved" : "open [&>[data-slot=collapsible-trigger]]:after:content-['○'] [&>[data-slot=collapsible-trigger]]:after:text-muted-foreground")}>
                <CollapsibleTrigger marker title={th.resolved ? t.pr.resolved : t.pr.open}>
                  <span className={prFirst}>
                    <Inline md={firstLine(th.body)} />
                  </span>
                  {th.replies.length > 0 && <span className={prMeta}>{t.pr.replies(th.replies.length)}</span>}
                </CollapsibleTrigger>
                <CollapsibleContent className={prBody}>
                  {th.path && (
                    <div className="pr-where [font:11.5px/1.5_var(--mono)] text-muted-foreground">
                      {th.url ? (
                        <a href={th.url} target="_blank" rel="noreferrer">
                          {th.path}
                          {th.line ? `:${th.line}` : ''} ↗
                        </a>
                      ) : (
                        th.path
                      )}
                    </div>
                  )}
                  <Body md={th.body} />
                  {th.replies.map((r, k) => (
                    <PrReply key={k} c={r} />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        ) : (
          <Collapsible key={i} className="pr-comment [&>[data-slot=collapsible-trigger]]:text-muted-foreground [&>[data-slot=collapsible-trigger]_b]:text-foreground [&>[data-slot=collapsible-trigger]_b]:font-semibold">
            <CollapsibleTrigger marker>
              <b>{who(e)}</b> · {e.edited ? t.pr.edited(time(e.at)) : time(e.at)} · <span className={prFirst}>
                <Inline md={firstLine(e.body)} />
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className={prBody}>
              <Body md={e.body} />
              {e.url && (
                <a href={e.url} target="_blank" rel="noreferrer">
                  {t.pr.onForge} ↗
                </a>
              )}
            </CollapsibleContent>
          </Collapsible>
        ),
      )}
    </div>
  );
}

function PrReply({ c }: { c: PrComment }) {
  return (
    <div className={cn('pr-reply mt-2 pl-2.5 border-l-[3px] border-border', c.mine && 'mine')}>
      <div className={prMeta}>
        <b>{who(c)}</b> · {time(c.at)}
      </div>
      <Body md={c.body} />
    </div>
  );
}
