// A card's face, the one every surface that shows a card draws, in four sizes (design: Card sizes):
// M, the card on the project; S, a compact row of up to four lines (the inbox); XS, two lines with
// the least (search and the other lists); inline, a pill within a line of text. A surface adds what is its own around the face (buttons,
// a grip, an ×) and in its slots, never a title, state or labels of its own.

import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { Item } from '../../core/types';
import { OtherCanvas, useOtherCanvas } from '../canvases';
import { stateLabel, t } from '../strings';
import { hasLabels, LabelMarks, PriorityMark } from './labels';
import { Pin, PinDot, shownTitle, StateMarks, StateText, StoppedWords, Title, UnreadDot } from './pieces';
import { cardKind, cardSummary, cardTone } from './summary';
import { Badge } from '../components/badge';

export type CardSize = 'm' | 's' | 'xs' | 'inline';

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
  /** Less visual noise (the inbox): the pin is a small dot in the top-right corner, the state line is muted and plain, no moving line. What the size does not show anyway stays as it is. */
  subtle?: boolean;
  /** Inline: the pill is a link to this address, opening the card through `onOpen`. */
  href?: string;
  onOpen?: () => void;
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
  return p.size === 'inline' ? <FaceInline {...p} /> : p.size === 'xs' ? <FaceXS {...p} /> : p.size === 's' ? <FaceS {...p} /> : <FaceM {...p} />;
}

/**
 * Inline, a card named within a line of text: a pill with a dot in the colour of its state, its title
 * as it is now (blue and underlined, as links are) and its priority where it has one; its state line
 * is the tooltip. With `href` it is a link that `onOpen` follows on a plain click.
 */
function FaceInline({ item, title, href, onOpen }: CardFaceProps) {
  const body = (
    <>
      <span className="sl-dot" />
      <span className="sl-title">{title ?? shownTitle(item)}</span>
      {item.labels?.priority && <PriorityMark priority={item.labels.priority} />}
    </>
  );
  const cls = `smart-link s-${item.state}`;
  if (!href) return <span className={cls}>{body}</span>;
  return (
    <a
      className={cls}
      href={href}
      title={stateLabel(item)}
      onClick={(e) => {
        if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        // a row around the pill opens its own card on a click
        e.stopPropagation();
        onOpen?.();
      }}
    >
      {body}
    </a>
  );
}

/**
 * M, the card on the project (also merged pairs, the phone's lists, a made follow-up in a
 * conversation): its labels and kind (after `where` it is), its title, a line of its text, its state
 * line in its state's colour (`since` after it) and the pin while it needs the owner. A `chip`, a
 * delivered workstream, shows only its title, after its label, so it still reads as its workstream.
 */
function FaceM({ item, where, underway, since, chip, subtle }: CardFaceProps) {
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
        {chip && item.plan?.label ? (
          <>
            <span className="ws-no">{item.plan.label}</span>
            {shownTitle(item)}
          </>
        ) : undefined}
      </Title>
      {s.meta && <div className="meta">{s.meta}</div>}
      <div className={['state', s.state.live && 'doing-now', subtle && 'subtle'].filter(Boolean).join(' ')}>
        <StateMarks marks={s.state.marks} />
        {/* one line on the card, cut short rather than running into the text above it */}
        <span className="state-text">
          <StateText state={s.state} since={since} />
        </span>
      </div>
      {s.pin && (subtle ? <PinDot pin={s.pin} /> : <Badge variant="pin" pulse className={s.pin.failed ? '[--pin:var(--error)]' : undefined}>{s.pin.mark}</Badge>)}
    </>
  );
}

/**
 * S, a compact row (the inbox, the Agents sheet's "All"): its labels, then where, kind and since;
 * its title with the pin, or the dot of an unread entry; its state line; then the line under its
 * title or what it waits for (`text`), in at most two lines.
 */
function FaceS({ item, where, underway, since, unread, subtle, title, text, children }: CardFaceProps) {
  const s = cardSummary(item, underway);
  const top = [where, item.state === 'proposal' && t.proposalMark, s.kind, since];
  const under = text ?? s.meta;
  return (
    <div className={subtle ? 'face face-s subtle' : 'face face-s'} style={tone(item, underway)}>
      {(hasLabels(item) || top.some(Boolean)) && (
        <div className="f-top">
          <LabelMarks item={item} />
          <span className="f-where">{dotted(top)}</span>
        </div>
      )}
      <Title item={item} className="f-ttl">
        {unread && !subtle && <UnreadDot />}
        <span className="f-ttl-text">{title ?? shownTitle(item)}</span>
        {!unread && s.pin && !subtle && <Pin pin={s.pin} />}
      </Title>
      <div className="f-state">
        <StateMarks marks={s.state.marks} />
        <span className="state-text">
          <StateText state={s.state} />
        </span>
      </div>
      {under && <div className="f-text">{under}</div>}
      {subtle && (unread ? <UnreadDot /> : s.pin && <PinDot pin={s.pin} />)}
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
function FaceXS({ item, underway, subtle, title, text, tail }: CardFaceProps) {
  const s = cardSummary(item, underway);
  const other = useOtherCanvas(item);
  // a workstream's label before its title says what it is; an idea's state says it already
  const kind = item.parent ? '' : cardKind(item);
  const under = text ?? s.meta;
  return (
    <span className={subtle ? 'face face-xs subtle' : 'face face-xs'} style={tone(item, underway)}>
      <Title item={item} className="f-ttl" inline>
        {item.labels?.priority && <PriorityMark priority={item.labels.priority} suggested={!!item.labels.suggested?.includes('priority')} bare />}
        {item.parent && item.plan?.label && <span className="ws-no">{item.plan.label}</span>}
        <span className="f-ttl-text">{title ?? shownTitle(item)}</span>
        {s.pin && !subtle && <Pin pin={s.pin} />}
      </Title>
      {subtle && s.pin && <PinDot pin={s.pin} />}
      <span className="f-line">
        <span className={item.state === 'proposal' ? 'f-dot proposal' : 'f-dot'} />
        <span className="f-words">
          {dotted([
            <span className="f-state">{s.state.stopped ? <StoppedWords stopped={s.state.stopped} /> : s.state.short}</span>,
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
