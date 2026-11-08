// A card's face, the one every surface that shows a card draws, in three sizes (design: Card sizes):
// M, the card on the project; S, a compact row of up to four lines (the inbox); XS, two lines with
// the least (search and the other lists). A surface adds what is its own around the face (buttons,
// a grip, an ×) and in its slots, never a title, state or labels of its own.

import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { Item } from '../../core/types';
import { OtherCanvas, useOtherCanvas } from '../canvases';
import { t } from '../strings';
import { hasLabels, LabelMarks, PriorityMark } from './labels';
import { Pin, shownTitle, StateMarks, StateText, Title, UnreadDot } from './pieces';
import { cardKind, cardSummary, cardTone } from './summary';

export type CardSize = 'm' | 's' | 'xs';

export interface CardFaceProps {
  item: Item;
  /** M (the default), S or XS. */
  size?: CardSize;
  /** Where the card is, before its kind: its repository on a project with several, an entry's project. */
  where?: ReactNode;
  /** What the server is still doing with the card after the owner's click (pushing it onto main, say), in place of its state. */
  underway?: string;
  /** Since when it stands as it does: after the state (M), after the kind (S). */
  since?: ReactNode;
  /** M: a delivered workstream, shown by its label and title only. */
  chip?: boolean;
  /** S: whether the owner has read the entry; an unread one shows the dot in the pin's place. */
  unread?: boolean;
  /** S and XS: in place of the title (a button that opens the card, the search words marked in it). */
  title?: ReactNode;
  /** S and XS: in place of the line under the title (what the card waits for); `false` leaves it out. */
  text?: ReactNode;
  /** XS: the end of the second line (what it waits for, what it builds on). */
  tail?: ReactNode;
  /** S: under the face (the entry's buttons). */
  children?: ReactNode;
}

/** The parts of a line, each after a " · ". */
const dotted = (parts: ReactNode[]) =>
  parts.filter(Boolean).map((p, n) => (
    <Fragment key={n}>
      {n > 0 && ' · '}
      {p}
    </Fragment>
  ));

/** The state's colour for the sizes in lists, which do not wear the card's classes. */
const tone = (item: Item, underway?: string) => ({ '--c': `var(--${cardTone(item, underway)})` }) as CSSProperties;

export function CardFace(p: CardFaceProps) {
  return p.size === 'xs' ? <FaceXS {...p} /> : p.size === 's' ? <FaceS {...p} /> : <FaceM {...p} />;
}

/**
 * M, the card on the project (also merged pairs, the phone's lists, a made follow-up in a
 * conversation): its labels and kind (after `where` it is), its title, a line of its text, its state
 * line in its state's colour (`since` after it) and the pin while it needs the owner. A `chip`, a
 * delivered workstream, shows only its title, after its label, so it still reads as its workstream.
 */
function FaceM({ item, where, underway, since, chip }: CardFaceProps) {
  const s = cardSummary(item, underway);
  // a plain task says nothing of its kind: that it is one shows
  const label = [item.state === 'proposal' && t.proposalMark, where, s.kind].filter(Boolean);
  return (
    <>
      {(label.length > 0 || hasLabels(item)) && (
        <div className="kind">
          <LabelMarks item={item} />
          {label.length > 0 && <span>{dotted(label)}</span>}
        </div>
      )}
      <Title item={item} className="ttl">
        {chip && item.label ? (
          <>
            <span className="ws-no">{item.label}</span>
            {shownTitle(item)}
          </>
        ) : undefined}
      </Title>
      {s.meta && <div className="meta">{s.meta}</div>}
      <div className={s.state.live ? 'state doing-now' : 'state'}>
        <StateMarks marks={s.state.marks} />
        {/* one line on the card, cut short rather than running into the text above it */}
        <span className="state-text">
          <StateText state={s.state} since={since} />
        </span>
      </div>
      {s.pin && <div className={s.pin.failed ? 'badge pulse failed' : 'badge pulse'}>{s.pin.mark}</div>}
    </>
  );
}

/**
 * S, a compact row (the inbox, the Agents sheet's "All"): its labels, then where, kind and since;
 * its title with the pin, or the dot of an unread entry; its state line; then the line under its
 * title or what it waits for (`text`), in at most two lines.
 */
function FaceS({ item, where, underway, since, unread, title, text, children }: CardFaceProps) {
  const s = cardSummary(item, underway);
  const top = [where, item.state === 'proposal' && t.proposalMark, s.kind, since];
  const under = text ?? s.meta;
  return (
    <div className="face face-s" style={tone(item, underway)}>
      {(hasLabels(item) || top.some(Boolean)) && (
        <div className="f-top">
          <LabelMarks item={item} />
          <span className="f-where">{dotted(top)}</span>
        </div>
      )}
      <Title item={item} className="f-ttl">
        {unread && <UnreadDot />}
        <span className="f-ttl-text">{title ?? shownTitle(item)}</span>
        {unread === undefined && s.pin && <Pin pin={s.pin} />}
      </Title>
      <div className="f-state">
        <StateMarks marks={s.state.marks} />
        <span className="state-text">
          <StateText state={s.state} />
        </span>
      </div>
      {under && <div className="f-text">{under}</div>}
      {children}
    </div>
  );
}

/**
 * XS, two lines with the least (search, the queue, the archive, a plan's sheet, the merge picker):
 * its priority's flag and its title (a workstream's after its label) with the pin; then the dot and
 * short word of its state, its kind, the other canvas it is on, the list's `tail`, and as much of the
 * line under its title as fits.
 */
function FaceXS({ item, underway, title, text, tail }: CardFaceProps) {
  const s = cardSummary(item, underway);
  const other = useOtherCanvas(item);
  // a workstream's label before its title says what it is; an idea's state says it already
  const kind = item.parent ? '' : cardKind(item);
  const under = text ?? s.meta;
  return (
    <span className="face face-xs" style={tone(item, underway)}>
      <Title item={item} className="f-ttl" inline>
        {item.priority && <PriorityMark priority={item.priority} suggested={!!item.suggested?.includes('priority')} bare />}
        {item.parent && item.label && <span className="ws-no">{item.label}</span>}
        <span className="f-ttl-text">{title ?? shownTitle(item)}</span>
        {s.pin && <Pin pin={s.pin} />}
      </Title>
      <span className="f-line">
        <span className={item.state === 'proposal' ? 'f-dot proposal' : 'f-dot'} />
        <span className="f-words">
          {dotted([
            <span className="f-state">{s.state.short}</span>,
            kind !== s.state.short && kind,
            other && <OtherCanvas item={item} named />,
            tail,
            under,
          ])}
        </span>
      </span>
    </span>
  );
}
