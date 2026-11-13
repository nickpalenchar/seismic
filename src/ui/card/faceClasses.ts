// A card's look in Tailwind on frost's tokens (design: Cards on the canvas, Card sizes): the card on the
// project (its glass, the state's tab at its top edge, the frame of the owner's turn, its stock) and the
// parts of its face at every size. The classes come from the card's state, worked out here once; the
// class names before the utilities (`card`, `ttl`, `state` …) stay as hooks for code that finds them.
//
// The card's states combine (a snoozed card waiting for the owner, a failed one zoomed out, a dragged
// one under the pointer), and which look wins where they meet is the order the stylesheet had: each look
// a rule with its weight, the heavier winning, the later at equal weight (`pick`). Where a look depends
// on the pointer or the zoom, as the card's shadow does, its values for each go to custom properties
// the card's static utilities read (`cardLook`'s `style`).

import type { CSSProperties } from 'react';
import { agentFailed, answering, finishingUp, isPaused, type Item, merging, needsYou, snoozeOf } from '../../core/types';
import { mergeProposed } from '../strings';
import { asksYou } from './summary';

/** What of a card's state its look depends on. */
export interface CardFlags {
  state: Item['state'] | '';
  waiting: boolean;
  doneLive: boolean;
  idea: boolean;
  proposal: boolean;
  q: boolean;
  reviewing: boolean;
  parkedOrDropped: boolean;
  dropped: boolean;
  thinking: boolean;
  yourTurn: boolean;
  failed: boolean;
  underway: boolean;
  answering: boolean;
  asking: boolean;
  finishing: boolean;
  paused: boolean;
  restartPaused: boolean;
  resolving: boolean;
  limitPaused: boolean;
  snoozed: boolean;
  mergeProposed: boolean;
  queued: boolean;
  restartQueued: boolean;
  mergedPair: boolean;
}

/** A card of no state: the cover of one that is gone. */
export const NO_FLAGS: CardFlags = {
  state: '', waiting: false, doneLive: false, idea: false, proposal: false, q: false, reviewing: false, parkedOrDropped: false, dropped: false, thinking: false,
  yourTurn: false, failed: false, underway: false, answering: false, asking: false, finishing: false, paused: false, restartPaused: false, resolving: false,
  limitPaused: false, snoozed: false, mergeProposed: false, queued: false, restartQueued: false, mergedPair: false,
};

export function cardFlags(item: Item, underway?: string): CardFlags {
  const d = item.idea?.discussion;
  return {
    state: item.state,
    waiting: item.state === 'waiting',
    doneLive: item.state === 'done' || item.state === 'live',
    idea: item.state === 'idea',
    proposal: item.state === 'proposal',
    q: item.kind === 'question',
    reviewing: item.review?.codeReview?.state === 'running',
    parkedOrDropped: d?.status === 'parked' || d?.status === 'dropped',
    dropped: d?.status === 'dropped',
    thinking: !!(d?.thinking || item.idea?.proposal?.revising || item.thread?.thinking || merging(item)),
    yourTurn: !!d && needsYou(item),
    failed: agentFailed(item),
    underway: !!underway,
    answering: answering(item),
    asking: asksYou(item),
    finishing: finishingUp(item),
    paused: isPaused(item),
    restartPaused: item.hold?.reason === 'restart',
    resolving: !!item.review?.resolvingConflicts,
    limitPaused: item.hold?.reason === 'limit' || !!item.agent?.limitedUntil,
    snoozed: !!snoozeOf(item),
    mergeProposed: mergeProposed(item),
    queued: !!item.queue,
    restartQueued: !!item.queue && 'restart' in item.queue,
    mergedPair: !!item.idea?.proposal?.merge,
  };
}

/** The classes that name a card's state, for code and the rules of other parts that read them (the connection handles). */
export const cardHooks = (item: Item, underway?: string) => {
  const f = cardFlags(item, underway);
  return ['card', `s-${item.state}`, ...stateHooks(f, item)].join(' ');
};

const stateHooks = (f: CardFlags, item: Item) =>
  [
    f.reviewing && 'reviewing',
    item.idea?.discussion && `idea-${item.idea.discussion.status}`,
    f.q && 'q-card',
    f.thinking && 'thinking',
    f.yourTurn && 'your-turn',
    f.failed && 'failed',
    f.underway && 'underway',
    f.answering && 'answering',
    f.asking && 'asking',
    f.finishing && 'finishing',
    f.paused && 'paused',
    f.restartPaused && 'restart-paused',
    f.resolving && 'resolving-conflicts',
    f.limitPaused && 'limit-paused',
    f.snoozed && 'snoozed',
    f.mergeProposed && 'merge-proposed',
    f.queued && 'queued',
    f.restartQueued && 'restart-queued',
  ].filter((c): c is string => !!c);

/** Where the pointer and the zoom stand, for the looks that depend on them. */
interface At {
  hover: boolean;
  far: boolean;
}
const REST: At = { hover: false, far: false };

/** A look of the stylesheet's cascade: its weight (the classes its selector counts), whether it applies, its value. */
type Rule<T> = readonly [weight: number, applies: boolean | ((at: At) => boolean), value: T];

/** The look that wins among `rules` (in the stylesheet's order): the heaviest that applies, the later at equal weight. */
function pick<T>(rules: readonly Rule<T>[], at: At = REST): T | undefined {
  let won: Rule<T> | undefined;
  for (const r of rules) if ((typeof r[1] === 'function' ? r[1](at) : r[1]) && (!won || r[0] >= won[0])) won = r;
  return won?.[2];
}

const hovered = (at: At) => at.hover;

/** Where a card shows: on the project, a row of the phone's lists, a line of the Activity tab, else a cover (in a conversation, the queue). */
export type CardPlace = 'canvas' | 'phone' | 'activity' | 'cover';

export interface CardLookOptions {
  underway?: string;
  place?: CardPlace;
  /** On the project: a task, or a chip (a delivered workstream). */
  shape?: string;
  /** While the pointer is on a card with waits: this card (`self`), one it waits for (`before`), one waiting for it (`after`). */
  dep?: 'self' | 'before' | 'after';
  /** Picked up: the card left on the project while it is dragged, and the one in the hand. */
  lifted?: boolean;
  dragging?: boolean;
  /** Just put on the project. */
  pop?: boolean;
  /** Activity: the card open beside the list. */
  on?: boolean;
  /** Activity: a card since deleted. */
  gone?: boolean;
}

// the card's shadows: the glass's rim and the shadow, lifted under the pointer, the frames of the owner's turn
const GLASS = 'inset 0 1px 0 var(--glass-hi), var(--shadow)';
const GLASS_LIFT = 'inset 0 1px 0 var(--glass-hi), var(--lift)';
const frame = (ink: string, width: string, shadow: string) => `0 0 0 ${width} var(--${ink}), var(--${shadow})`;
const TURN = '0 0 0 2px var(--waiting), 0 0 22px -4px var(--waiting-glow), var(--shadow)';
const TURN_LIFT = '0 0 0 2px var(--waiting), 0 0 26px -4px var(--waiting-glow), var(--lift)';

function shadows(f: CardFlags, o: CardLookOptions): Rule<string>[] {
  const turn = f.idea && f.yourTurn;
  return [
    [1, true, GLASS],
    [2, hovered, GLASS_LIFT],
    [2, f.proposal, 'none'],
    [2, f.waiting, TURN],
    [3, turn, TURN],
    [3, (at) => at.hover && f.waiting, TURN_LIFT],
    [4, (at) => at.hover && turn, TURN_LIFT],
    // approved and landing, or its worker taking in the owner's answer: no longer the owner's turn
    [3, f.waiting && f.underway, GLASS],
    [3, f.waiting && f.answering, GLASS],
    [3, f.waiting && f.failed, frame('destructive', '2px', 'shadow')],
    [4, (at) => at.hover && f.waiting && f.failed, frame('destructive', '2px', 'lift')],
    // snoozed: pushed back, no frame of the owner's turn
    [2, f.snoozed, GLASS],
    [3, f.snoozed && f.waiting, 'var(--shadow)'],
    [4, f.snoozed && turn, 'var(--shadow)'],
    [3, (at) => at.hover && f.snoozed, 'var(--lift)'],
    [4, (at) => at.hover && f.snoozed && f.waiting, 'var(--lift)'],
    [5, (at) => at.hover && f.snoozed && turn, 'var(--lift)'],
    [3, f.waiting && f.asking, frame('asking', '2px', 'shadow')],
    [4, (at) => at.hover && f.waiting && f.asking, frame('asking', '2px', 'lift')],
    [4, (at) => at.far && f.waiting && f.asking, frame('asking', '5px', 'shadow')],
    [3, f.waiting && f.reviewing, frame('reviewing', '2px', 'shadow')],
    [4, (at) => at.hover && f.waiting && f.reviewing, frame('reviewing', '2px', 'lift')],
    [2, !!o.dragging, GLASS_LIFT],
    // zoomed out, the owner's turn framed wider
    [5, (at) => at.far && f.waiting && !f.underway && !f.answering, frame('waiting', '5px', 'shadow')],
    [4, (at) => at.far && turn, frame('waiting', '5px', 'shadow')],
    [4, (at) => at.far && f.waiting && f.failed, frame('destructive', '5px', 'shadow')],
    // the cards around the one under the pointer, over every state but the frames of the owner's turn
    [2, !!o.dep, '0 0 0 2.5px var(--proposal), var(--lift)'],
    [5, f.snoozed && !!o.dep, '0 0 0 2.5px var(--proposal), var(--lift)'],
    [2, o.dep === 'before', '0 0 0 2.5px var(--waiting), var(--lift)'],
    [5, f.snoozed && o.dep === 'before', '0 0 0 2.5px var(--waiting), var(--lift)'],
    [3, o.place === 'activity' && !!o.on, '0 0 0 2px var(--working-ring), var(--shadow)'],
  ];
}

/** The state's colour (`--c`): its tab, its state line, the frame of its turn. */
const tints = (f: CardFlags): Rule<string>[] => [
  [1, f.state === 'planned', 'c-planned'],
  [1, f.state === 'working', 'c-working'],
  [1, f.state === 'waiting', 'c-waiting'],
  [1, f.state === 'approved', 'c-approved'],
  [1, f.state === 'inPr', 'c-inPr'],
  [1, f.doneLive, 'c-live'],
  [1, f.proposal, 'c-proposal'],
  [1, f.idea, 'c-idea'],
  [2, f.q, 'c-question'],
  [3, f.q && f.doneLive, 'c-question'],
  // done: muted green
  [2, f.doneLive, 'c-approved'],
  [3, f.waiting && f.underway, 'c-approved'],
  [3, f.waiting && f.answering, 'c-working'],
  [3, f.waiting && f.failed, 'c-destructive'],
  [2, f.snoozed, 'c-muted'],
  [2, f.restartPaused, 'c-restart'],
  [2, f.restartQueued, 'c-restart'],
  [2, f.mergeProposed, 'c-proposal'],
  [2, f.asking, 'c-asking'],
  [2, f.reviewing, 'c-reviewing'],
  [3, f.waiting && f.reviewing, 'c-reviewing'],
];

/** The card's stock: ideas on coloured card, a Question tinted blue-grey, finished work green, a proposal none. */
const stocks = (f: CardFlags): Rule<string>[] => [
  [1, true, 'bg-card'],
  [2, f.idea, 'bg-idea/9'],
  [2, f.q, 'bg-question/8'],
  [3, f.q && f.doneLive, 'bg-question/8'],
  [2, f.doneLive, 'bg-approved/13'],
  [2, f.proposal, 'bg-transparent'],
  [2, f.mergedPair, 'bg-transparent'],
  [2, f.snoozed, 'bg-muted-foreground/9'],
  [2, f.restartPaused, 'bg-restart/16'],
  [2, f.restartQueued, 'bg-restart/16'],
];

const opacities = (f: CardFlags, o: CardLookOptions): Rule<string>[] => [
  [2, f.parkedOrDropped, 'opacity-[.62]'],
  [2, f.q, ''],
  [3, f.q && f.doneLive, ''],
  [2, f.doneLive, ''],
  [2, f.finishing, ''],
  [2, f.snoozed, 'opacity-[.72]'],
  [2, !!o.lifted, 'opacity-0'],
  [3, o.place === 'activity' && !!o.gone, 'opacity-[.65]'],
];

const borders = (f: CardFlags, o: CardLookOptions): Rule<string>[] => [
  [1, true, '[border:1px_solid_var(--glass-edge)]'],
  [1, o.place === 'phone', '[border:0]'],
  // a proposal is only pencilled in: a dashed outline
  [2, f.proposal, '[border:1.5px_dashed_var(--proposal)]'],
  [2, f.mergedPair, '[border:0]'],
  [2, o.place === 'activity', '[border:0]'],
];

const paddings = (f: CardFlags, o: CardLookOptions): Rule<string>[] => [
  [1, true, 'pt-[13px] px-[14px] pb-[12px]'],
  [1, o.place === 'phone', 'pt-[14px] px-[14px] pb-[12px]'],
  [2, f.mergedPair, 'p-0'],
  [2, o.place === 'activity', 'py-2 px-2.5'],
];

const blurs = (f: CardFlags, o: CardLookOptions): Rule<string>[] => [
  [1, true, 'backdrop-blur-glass backdrop-saturate-150'],
  [2, f.proposal, 'backdrop-filter-none'],
  [2, !!o.lifted, 'backdrop-filter-none'],
];

/** The tab at the card's top edge, glowing in its state's colour: dashed while queued, ice blue while a usage limit is waited out. */
const tabs = (f: CardFlags): Rule<string>[] => [
  [1, true, 'before:[background:var(--c)]'],
  [2, f.queued, 'before:[background:repeating-linear-gradient(90deg,var(--c)_0_8px,transparent_8px_13px)]'],
  [2, f.limitPaused, 'before:bg-info/30'],
];

// what every card is: a pane of glass with soft corners, the state a glowing tab at its top edge (`--c`)
const CARD =
  "group/card rounded-[14px] overflow-visible cursor-pointer select-none [font-family:var(--font)] [box-shadow:var(--sh)] hover:[box-shadow:var(--sh-hover)] far:[box-shadow:var(--sh-far)] far:hover:[box-shadow:var(--sh-far-hover)] reduced:hover:[transform:none] before:content-[''] before:absolute before:left-[14px] before:top-[-1px] before:h-[3px] before:pointer-events-none before:rounded-b-[3px] before:[box-shadow:0_0_10px_var(--c)] far:before:h-2 has-[>.state.subtle]:before:hidden";

/** A card's own classes and style: its hooks, its look in its state, where it shows, under the pointer and zoomed out. */
export function cardLook(item: Item | null, o: CardLookOptions = {}): { className: string; style: CSSProperties } {
  const known = item ? cardFlags(item, o.underway) : NO_FLAGS;
  // a merged pair is one on the project; elsewhere the card shows as itself
  const f = { ...known, mergedPair: known.mergedPair && o.place === 'canvas' };
  const at = (hover: boolean, far: boolean) => pick(shadows(f, o), { hover, far });
  const hoverLift = o.place !== 'phone' && o.place !== 'activity' && !f.proposal && !o.dragging;
  const className = [
    'card',
    ...(item ? stateHooks(f, item) : []),
    CARD,
    pick(tints(f)),
    pick(stocks(f)),
    f.proposal && !f.mergedPair && 'hover:bg-proposal/5',
    // zoomed far out or moving (frost.ts), and under reduced motion, no blur behind the card: each blurred card is a
    // layer the GPU re-samples on every frame of a move, and with ~100 on screen that drops frames (a fifth with a
    // GPU, more than half without one); many small ones shimmer zoomed out. --unblurred stands in for the blur's
    // saturate, a tint that keeps the card the colour it has at rest (dark: bluer; light: none needed)
    !f.proposal && 'moving:bg-[linear-gradient(var(--unblurred),var(--unblurred))] reduced:bg-[linear-gradient(var(--unblurred),var(--unblurred))]',
    pick(opacities(f, o)),
    pick(borders(f, o)),
    pick(paddings(f, o)),
    o.place !== 'activity' && 'far:pt-[18px]',
    pick(blurs(f, o)),
    'moving:backdrop-filter-none',
    pick(tabs(f)),
    o.shape === 'chip' ? 'before:w-[30px]' : 'before:w-[46px]',
    f.proposal && 'before:hidden',
    o.dragging ? '[transition:none] [transform:translateY(-4px)_scale(1.02)] z-5! [#viewport.touch_&]:[transform:rotate(-1.5deg)_translate(-1px,-3px)_scale(1.04)]' : '[transition:box-shadow_.18s,transform_.18s,opacity_.25s]',
    hoverLift ? 'hover:[transform:translateY(-2px)]' : (o.dragging && (f.proposal || o.place === 'phone' || o.place === 'activity')) && 'hover:[transform:none]',
    o.pop && 'animate-[pop_.55s_cubic-bezier(.2,1.4,.4,1)]',
    o.dep === 'before' && '[--dep:var(--waiting)] [--dep-fg:var(--waiting-foreground)]',
    o.place === 'phone' && 'relative flex flex-col w-full text-left text-foreground active:[transform:translateY(1px)]',
    o.place === 'activity' && 'relative block w-full h-auto min-h-0 text-left text-foreground',
    o.place === 'activity' && o.gone && 'cursor-default',
  ]
    .filter(Boolean)
    .join(' ');
  return { className, style: { '--sh': at(false, false), '--sh-hover': at(true, false), '--sh-far': at(false, true), '--sh-far-hover': at(true, true) } as CSSProperties };
}

/** The tag over a card that names how it stands to the card under the pointer ("Waits for", "Comes first"), in the colour of its wait. */
export const depTagClass =
  'dep-tag absolute left-[14px] top-[-10px] py-px px-2 rounded-[2px] text-[11px] font-semibold bg-[var(--dep,var(--proposal))] text-[var(--dep-fg,var(--proposal-foreground))] whitespace-nowrap pointer-events-none';

/** Where the card's face is drawn (M): which card's look it wears, where, and as which half of a merge. */
export interface FaceMPlace {
  place?: CardPlace;
  /** On the project, a delivered workstream: only its title. */
  chip?: boolean;
  /** One of the two cards of a merge: the first (the card itself) or its partner, which wears the pair's look. */
  half?: 'first' | 'partner';
  subtle?: boolean;
}

/** M: the kind line, with what labels it carries (`chips`: a label chip or a suggested priority). */
export function kindClass(f: CardFlags, p: FaceMPlace, labels: { any: boolean; chips: boolean }) {
  return [
    'kind flex items-center gap-1.5 overflow-hidden whitespace-nowrap font-medium [&_span]:overflow-hidden [&_span]:text-ellipsis',
    f.q ? 'uppercase tracking-[.07em] text-question' : 'tracking-[.01em] text-muted-foreground',
    p.place === 'activity' ? 'text-[11px]' : f.q ? 'text-[10.5px]' : p.place === 'phone' ? 'text-[12.5px]' : 'text-[11.5px]',
    labels.chips && 'mb-[3px]',
    p.chip && 'hidden',
    // zoomed out, only the labels stay, drawn 1.7 times as large so they still read
    'far:w-[calc(100%/1.7)] far:mb-2.5 far:h-[17px] far:flex-wrap far:content-start far:[transform:scale(1.7)] far:origin-[0_0]',
    !labels.any && 'far:hidden',
  ]
    .filter(Boolean)
    .join(' ');
}

/** M: the title, at most two lines (a chip's three). */
export function ttlClass(f: CardFlags, p: FaceMPlace & { untitled?: boolean; labels?: boolean }) {
  const weight = pick<string>([
    [2, true, 'font-[620]'],
    [3, !!p.untitled, 'font-normal'],
    [3, !!p.chip, 'font-[560]'],
    [3, f.q, 'font-semibold'],
    [3, f.doneLive, 'font-medium'],
    [4, f.q && f.state === 'done', 'font-semibold'],
  ]);
  const onCanvas = p.place === 'canvas';
  return [
    'ttl [font-family:var(--font)] tracking-[-.012em] [font-optical-sizing:auto] [display:-webkit-box] [-webkit-box-orient:vertical] overflow-hidden [overflow-wrap:anywhere]',
    weight,
    p.place === 'phone' ? 'mt-0.5 leading-[1.2]' : p.place === 'activity' ? 'mt-px leading-[1.2]' : 'mt-px leading-[1.25]',
    p.place === 'activity' ? 'text-[14.5px]' : p.chip ? 'text-[13.5px]' : p.place === 'phone' ? 'text-[18.5px]' : 'text-[15.5px]',
    p.place === 'activity' ? '[-webkit-line-clamp:2]' : p.chip || p.place === 'phone' ? '[-webkit-line-clamp:3]' : '[-webkit-line-clamp:2]',
    p.untitled && 'text-muted-foreground italic',
    f.dropped && 'line-through decoration-idea decoration-[1.5px]',
    // zoomed out, the title fills the card
    onCanvas && (p.chip ? 'far:text-[21px] far:leading-[1.1] far:[-webkit-line-clamp:2]' : p.labels ? 'far:text-[23px] far:leading-[1.1] far:[-webkit-line-clamp:2]' : 'far:text-[26px] far:leading-[1.1] far:[-webkit-line-clamp:2]'),
  ]
    .filter(Boolean)
    .join(' ');
}

/** M, a delivered workstream: its label before its title. */
export const chipLabelClass = 'ws-no [font-family:var(--font)] text-[12.5px] font-semibold tracking-[.01em] text-muted-foreground mr-1.5';

/** M: the line under the title. */
export const metaClass = (p: FaceMPlace) =>
  [
    'meta mt-1 text-muted-foreground leading-[1.38] [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden [overflow-wrap:anywhere] far:hidden',
    p.place === 'phone' ? 'text-[14px]' : 'text-[13px]',
    (p.chip || p.place === 'activity') && 'hidden',
  ]
    .filter(Boolean)
    .join(' ');


/** M: the state line at the card's foot, in its state's colour; the moving line after it while an agent is at it (`doingNow`: under it). */
export function stateClass(f: CardFlags, p: FaceMPlace & { doingNow?: boolean }) {
  const phone = p.place === 'phone';
  const activity = p.place === 'activity';
  const line =
    (f.q && f.thinking) || (f.idea && f.thinking) || (f.proposal && f.thinking) || f.underway || f.state === 'working' || (f.waiting && f.answering) || f.finishing || f.reviewing;
  const still = f.paused || f.snoozed || f.restartPaused || f.restartQueued || f.limitPaused || p.subtle || p.half === 'partner';
  // the thinking ones weigh more than the line run thin under a state line
  const thick = (f.q && f.thinking) || (f.idea && f.thinking) || (f.proposal && f.thinking) || (f.waiting && f.answering);
  const where = phone
    ? p.doingNow
      ? 'relative left-0 right-[14px] bottom-[10px] mt-auto pt-2 pb-1.5 gap-0'
      : `static ${f.q ? 'left-4' : 'left-[14px]'} right-[14px] bottom-[10px] mt-auto pt-2 gap-0`
    : activity
      ? `relative left-auto right-auto bottom-auto mt-1 gap-x-[7px] gap-y-1 ${p.doingNow ? 'pb-1.5' : ''}`
      : `absolute ${f.q ? 'left-4' : 'left-[14px]'} right-[14px] bottom-[10px] gap-x-[7px] gap-y-1`;
  return [
    'state flex flex-wrap items-center leading-[1.2]',
    where,
    phone ? 'text-[13px]' : activity ? 'text-[11.5px]' : 'text-[12px]',
    p.subtle ? 'text-muted-foreground font-normal' : 'font-semibold text-c-strong',
    pick<string>([
      [2, p.half !== undefined, 'c-proposal'],
      [3, f.finishing, 'c-working'],
      [3, f.paused, 'c-muted'],
      [3, f.snoozed, 'c-muted'],
      [3, f.mergeProposed, 'c-proposal'],
      [3, f.resolving, 'c-waiting'],
      [3, f.limitPaused, 'c-info'],
    ]),
    f.queued && 'italic',
    p.chip && 'hidden',
    // zoomed out, drawn 1.7 times as large from its foot
    'far:right-auto far:w-[calc((100%-28px)/1.7)] far:[transform:scale(1.7)] far:origin-[0_100%]',
    // where nothing hovers, the pause stands at the card's foot beside it
    'no-hover:[.card:has(>.play.turn)_&]:right-11',
    // what its worker is doing, in italics (a stage of its demo in green)
    p.subtle
      ? '[&_.doing]:text-muted-foreground [&_.doing]:not-italic [&_.doing]:font-normal'
      : '[&_.doing]:italic [&_.doing]:font-medium [&_.doing]:text-muted-foreground [&_.doing.demo]:text-approved [&_.doing.demo]:font-semibold [&_.doing.conflict]:text-waiting-strong',
    '[&_:is(.clock-mark,.question-mark,.restart-mark,.hourglass-mark,.merge-mark)]:flex-none [&_.hourglass-mark]:w-[9px] [&_.hourglass-mark]:h-3',
    phone
      ? '[&_:is(.hourglass-mark,.merge-mark)]:-mr-0.5 [&_:is(.clock-mark,.question-mark,.restart-mark)]:mr-[5px] [&_:is(.clock-mark,.question-mark,.restart-mark)]:align-[-1px] [&_.doing]:whitespace-pre [&_.since]:text-muted-foreground [&_.since]:font-medium [&_.since]:whitespace-pre'
      : '[&_:is(.clock-mark,.question-mark,.restart-mark,.hourglass-mark,.merge-mark)]:-mr-0.5',
    // the moving line: a pencil stroke being drawn, again and again
    // (its faint track comes through a custom property: a colour mix in the pseudo-element's own background did not apply)
    line && !still && "[--track:--alpha(var(--c)/22%)] after:content-[''] after:flex-none after:w-9 after:mr-[100%] after:[background:linear-gradient(90deg,var(--c)_0_50%,transparent_50%)_0_0/200%_100%_no-repeat,var(--track)] after:animate-[draw_1.6s_cubic-bezier(.5,0,.3,1)_infinite]",
    line && !still && (p.doingNow && !thick ? 'after:h-px' : 'after:h-0.5'),
    line && !still && p.doingNow && (phone || activity ? 'after:absolute after:left-0 after:bottom-0' : 'after:absolute after:left-0 after:bottom-[-5px]'),
    line && !still && phone && !p.doingNow && 'after:ml-[7px]',
  ]
    .filter(Boolean)
    .join(' ');
}

/** M: the words of the state line, one line cut short (on the phone they wrap). */
export const stateTextClass = (p: FaceMPlace) => (p.place === 'phone' ? 'state-text contents min-w-0 overflow-hidden text-ellipsis whitespace-nowrap' : 'state-text min-w-0 overflow-hidden text-ellipsis whitespace-nowrap');

/** M: the pin at the card's corner, in the colour of what the owner is asked (left out where the list says so already, and on a merge's halves). */
export const pinClass = (f: CardFlags, p: FaceMPlace) =>
  [f.failed ? '[--pin:var(--destructive)] [--pin-fg:var(--destructive-foreground)]' : f.asking && '[--pin:var(--asking)] [--pin-fg:var(--asking-foreground)]', (p.half || p.place === 'phone') && 'hidden'].filter(Boolean).join(' ') || undefined;

// ---------- the faces in lists, S and XS (their state's colour comes as --c on the face)

const LIST_TITLE = 'f-ttl flex min-w-0 [font-family:var(--font)] font-semibold text-foreground [overflow-wrap:anywhere] [.inbox-entry.unread_&]:font-bold [.inbox-entry.read_&]:font-normal';

export const faceClass = (size: 's' | 'xs', subtle?: boolean) =>
  ['face flex flex-col min-w-0 text-left', size === 's' ? 'face-s' : 'face-xs gap-0.5', subtle && 'subtle relative'].filter(Boolean).join(' ');

/** S: the line above the title (labels, where, kind, since). */
export const topClass = (subtle?: boolean) =>
  `f-top flex flex-nowrap items-center gap-1.5 min-w-0 overflow-hidden text-[11.5px] leading-[17px] text-muted-foreground [&>*:not(.f-where)]:flex-none [&_:is(.lchip,.prio)]:text-[11px] ${subtle ? 'pr-[14px]' : ''}`;
export const whereClass =
  'f-where flex-[0_1_auto] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap [&>svg]:align-[-2px] [&>svg]:mr-1 [&_.project]:font-semibold [&_.other-canvas]:inline-flex [&_.other-canvas]:align-[-2px] [&_.other-canvas]:ml-[5px]';
export const listTitleClass = (size: 's' | 'xs', subtle?: boolean) =>
  [LIST_TITLE, size === 's' ? 'items-start gap-[7px] mt-1 text-[16px] leading-[1.25] [&_.f-pin]:mt-px' : 'items-center gap-1.5 text-[14px] leading-[1.3]', subtle && 'pr-[14px]'].filter(Boolean).join(' ');
export const listTitleTextClass = (size: 's' | 'xs', untitled: boolean) =>
  ['f-ttl-text min-w-0', size === 'xs' && 'overflow-hidden text-ellipsis whitespace-nowrap', untitled && 'text-muted-foreground font-normal italic'].filter(Boolean).join(' ');

export const LIST_DOING = '[&_.doing]:italic [&_.doing]:font-medium [&_.doing]:text-muted-foreground [&_.doing.demo]:text-approved [&_.doing.demo]:font-semibold [&_.doing.conflict]:text-waiting-strong';
const LIST_DOING_SUBTLE = '[&_.doing]:text-muted-foreground [&_.doing]:not-italic [&_.doing]:font-normal';

/** S: the state line, in the state's colour (subtle: plain and muted). */
export const listStateClass = (subtle?: boolean) =>
  [
    `f-state flex flex-nowrap items-center gap-1 min-w-0 mt-[3px] text-[12px] leading-[1.3] [&>*:not(.state-text)]:flex-none [&_:is(.clock-mark,.question-mark,.restart-mark,.hourglass-mark,.merge-mark,.parked-mark)]:flex-none`,
    subtle ? `text-muted-foreground font-normal ${LIST_DOING_SUBTLE}` : `text-c-strong font-semibold ${LIST_DOING}`,
  ].join(' ');
export const listStateTextClass = 'state-text flex-[0_1_auto] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap';
/** S: the line under the title, in at most two lines. */
export const listTextClass =
  'f-text mt-1 text-[13px] leading-[1.4] text-muted-foreground [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden [overflow-wrap:anywhere]';

/** XS: a workstream's label before its title. */
export const wsLabelClass = 'ws-no flex-none [font-family:var(--font)] text-[12px] font-semibold text-muted-foreground tabular-nums';
/** XS: the second line, after the dot of its state. */
export const lineClass = 'f-line flex items-center gap-1.5 min-w-0 text-[12px] leading-[1.35] text-muted-foreground';
export const dotClass = (proposal: boolean, subtle?: boolean) =>
  proposal
    ? `f-dot proposal flex-none box-border size-[9px] rounded-[50%] bg-transparent ${subtle ? '[border:1.5px_dashed_var(--muted-foreground)]' : '[border:1.5px_dashed_var(--c)]'}`
    : `f-dot flex-none size-2 rounded-[50%] ${subtle ? 'bg-muted-foreground' : 'bg-(--c)'}`;
export const wordsClass = 'f-words min-w-0 overflow-hidden text-ellipsis whitespace-nowrap [&_.other-canvas]:inline-flex [&_.other-canvas]:align-[-2px]';
/** XS: the state's short word, in its colour (subtle: as the line). */
export const shortStateClass = (subtle?: boolean) => (subtle ? 'f-state text-inherit font-normal' : 'f-state text-c-strong font-semibold');
