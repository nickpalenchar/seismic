// The pieces a card's face is made of, which each size composes (src/ui/card/face.tsx): the title,
// the line under it, the state line with its marks, the pin and the unread dot. The label chips are
// in labels.tsx.

import { Car, CircleHelp, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { type Item, titleFrom } from '../../core/types';
import { Inline } from '../markdown';
import { ClockMark } from '../snooze';
import { t } from '../strings';
import type { CardSummary, StateMark } from './summary';

/** A card's title as it shows: its own, else the start of its text. */
export const shownTitle = (i: Item) => (i.title ? <Inline md={i.title} /> : titleFrom(i.body) || t.titlePlaceholder);

/** The mark before a state that is a question for the owner. */
export const QuestionMark = () => (
  <CircleHelp className="question-mark" size={11} strokeWidth={1.75} aria-hidden />
);

export const HourglassMark = () => (
  <svg className="hourglass-mark" viewBox="0 0 16 20" width="14" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M2 1h12M2 19h12M3 1v4c0 2 3 3 5 5-2 2-5 3-5 5v4M13 1v4c0 2-3 3-5 5 2 2 5 3 5 5v4" />
    <path d="m5 5 3 3 3-3M5 16l3-3 3 3" fill="currentColor" stroke="none" />
  </svg>
);

/** A circular arrow: the mark of a card whose agent paused for a restart that is due. */
export const RestartMark = () => <RotateCw className="restart-mark" size={11} strokeWidth={2} aria-hidden />;

/** A car: the mark of a card parked off the canvas. */
const ParkedMark = () => <Car className="parked-mark" size={13} aria-hidden />;

const MARKS: Record<StateMark, () => ReactNode> = { parked: ParkedMark, limit: HourglassMark, snooze: ClockMark, restart: RestartMark, restartQueue: HourglassMark, question: QuestionMark };

/** The marks before a state, in their order. */
export const StateMarks = ({ marks }: { marks: StateMark[] }) => (
  <>
    {marks.map((m) => {
      const Mark = MARKS[m];
      return <Mark key={m} />;
    })}
  </>
);

/** The words of a state line: the state, what has landed of it, its notes, what its agent does, and `since`. */
export function StateText({ state, since }: { state: CardSummary['state']; since?: ReactNode }) {
  return (
    <>
      {state.label}
      {state.landed !== undefined && <span className="landed-part">{t.landedPart.short} · {state.landed}</span>}
      {state.notes.map((n) => ` · ${n}`).join('')}
      {state.doing && <span className={state.doing.conflict ? 'doing conflict' : state.doing.demo ? 'doing demo' : 'doing'}> · {state.doing.text}</span>}
      {since && <span className="since"> · {since}</span>}
    </>
  );
}

/** A card's title line (`inline`: in a line of its own within a button); `children` in place of the title it shows. */
export function Title({ item, className, inline, children }: { item: Item; className: string; inline?: boolean; children?: ReactNode }) {
  const cls = item.title ? className : `${className} untitled`;
  return inline ? <span className={cls}>{children ?? shownTitle(item)}</span> : <div className={cls}>{children ?? shownTitle(item)}</div>;
}

/** The pin while a card needs the owner, inline after a list's title: "!", "?" for a question, "!!" for a failed agent, "✦" for a proposal. */
export const Pin = ({ pin }: { pin: NonNullable<CardSummary['pin']> }) => (
  <span className={['f-pin', pin.failed && 'failed', pin.asking && 'asking'].filter(Boolean).join(' ')} title={t.phone.forYou}>
    {pin.mark}
  </span>
);

/** The orange dot of an inbox entry the owner has not read yet. */
export const UnreadDot = () => <span className="unread-dot" role="img" aria-label={t.inbox.unread} />;
