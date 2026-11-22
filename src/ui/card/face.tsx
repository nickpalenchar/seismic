// A card's face, the one every surface that shows a card draws, in four sizes:
// M, the card on the project; S, a compact row of up to four lines (the inbox); XS, two lines with
// the least (search and the other lists); inline, a pill within a line of text. A surface adds what is its own around the face (buttons,
// a grip, an ×) and in its slots, never a title, state or labels of its own.

import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { Item } from '../../core/types';
import { OtherCanvas, useOtherCanvas } from '../canvases';
import { mergeProposed, stateLabel, t } from '../strings';
import { hasChips, hasLabels, LabelMarks, PriorityMark } from './labels';
import { LIST_DOING, cardFlags, type CardPlace, chipLabelClass, dotClass, faceClass, kindClass, lineClass, listStateClass, listStateTextClass, listTextClass, listTitleClass, listTitleTextClass, metaClass, pinClass, shortStateClass, stateClass, stateLineClass, stateTextClass, topClass, ttlClass, whereClass, wordsClass, wsLabelClass } from './faceClasses';
import { MergeProposedMark, Pin, PinDot, shownTitle, StateMarks, StateText, StoppedWords, Title, UnreadDot } from './pieces';
import { cardKind, cardSummary, cardTone, stateVars } from './summary';
import { Badge } from '../components/badge';
import { DrawLine } from '../components/draw-line';

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
  /** M: where the card shows (on the project, a row of the phone's lists, a line of the Activity tab), which sizes its parts. */
  place?: CardPlace;
  /** M: one of the two cards of a merge on the project; the partner's parts wear the look of the pair (`pairOf`). */
  half?: 'first' | 'partner';
  pairOf?: Item;
  /** M: the card another card is being merged with: the merge mark before its state, and after it how the merge stands (`mergeStatus`). */
  mergePartner?: string;
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
  /** XS: show the full state and its description on separate lines. */
  workstation?: boolean;
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
const tone = (item: Item, underway?: string) => stateVars(cardTone(item, underway)) as CSSProperties;

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
  if (!href) return <Badge variant="pill" className={cls}>{body}</Badge>;
  return (
    <Badge
      asChild
      variant="pill"
      className={cls}
    ><a
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
    </a></Badge>
  );
}

/**
 * M, the card on the project (also merged pairs, the phone's lists, a made follow-up in a
 * conversation): its labels and kind (after `where` it is), its title, a line of its text, its state
 * line in its state's colour (`since` after it) and the pin while it needs the owner. A `chip`, a
 * delivered workstream, shows only its title, after its label, so it still reads as its workstream.
 */
function FaceM({ item, where, underway, since, chip, subtle, mergePartner, place, half, pairOf }: CardFaceProps) {
  const summary = cardSummary(item, underway);
  const s = mergePartner
    ? { ...summary, state: { ...summary.state, notes: [mergePartner, ...summary.state.notes], marks: ['merge' as const] } }
    : summary;
  // the parts wear the look of the card they are on: a merge's partner that of the pair
  const f = cardFlags(pairOf ?? item, pairOf ? undefined : underway);
  const at = { place: half ? ('canvas' as const) : place, chip, half, subtle };
  // a plain task says nothing of its kind: that it is one shows
  const label = [item.state === 'proposal' && t.proposalMark, where, s.kind].filter(Boolean);
  const labelled = hasLabels(item);
  // the moving line at the end of the state line while an agent is at it
  const moving = stateLineClass(f, { ...at, doingNow: s.state.live });
  return (
    <>
      {(label.length > 0 || labelled) && (
        <div className={kindClass(f, at, { any: labelled, chips: hasChips(item) })}>
          <LabelMarks item={item} />
          {/* zoomed out, the labels stay without the words */}
          {label.length > 0 && <span className="far:hidden">{dotted(label)}</span>}
        </div>
      )}
      <Title item={item} className={ttlClass(f, { ...at, untitled: !item.title, labels: labelled })}>
        {chip && item.plan?.label ? (
          <>
            <span className={chipLabelClass}>{item.plan.label}</span>
            {shownTitle(item)}
          </>
        ) : mergeProposed(item) ? (
          <>
            <MergeProposedMark item={item} inline />
            {shownTitle(item)}
          </>
        ) : undefined}
      </Title>
      {s.meta && <div className={metaClass(at)}>{s.meta}</div>}
      <div className={[stateClass(f, { ...at, doingNow: s.state.live }), s.state.live && 'doing-now', subtle && 'subtle'].filter(Boolean).join(' ')}>
        <StateMarks marks={s.state.marks} />
        {/* one line on the card, cut short rather than running into the text above it */}
        <span className={stateTextClass(at)}>
          <StateText state={s.state} since={since} />
        </span>
        {moving && <DrawLine color="var(--c)" className={moving} />}
      </div>
      {s.pin && (subtle ? <PinDot pin={s.pin} /> : <Badge variant="pin" pulse className={pinClass(f, at)}>{s.pin.mark}</Badge>)}
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
    <div className={faceClass('s', subtle)} style={tone(item, underway)}>
      {(hasLabels(item) || top.some(Boolean)) && (
        <div className={topClass(subtle)}>
          <LabelMarks item={item} />
          <span className={whereClass}>{dotted(top)}</span>
        </div>
      )}
      <Title item={item} className={listTitleClass('s', subtle)}>
        {unread && !subtle && <UnreadDot />}
        <MergeProposedMark item={item} />
        <span className={listTitleTextClass('s', !item.title)}>{title ?? shownTitle(item)}</span>
        {!unread && s.pin && !subtle && <Pin pin={s.pin} />}
      </Title>
      <div className={listStateClass(subtle)}>
        <StateMarks marks={s.state.marks} />
        <span className={listStateTextClass}>
          <StateText state={s.state} />
        </span>
      </div>
      {under && <div className={listTextClass}>{under}</div>}
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
function FaceXS({ item, underway, subtle, title, text, tail, workstation }: CardFaceProps) {
  const s = cardSummary(item, underway);
  const other = useOtherCanvas(item);
  // a workstream's label before its title says what it is; an idea's state says it already
  const kind = item.parent ? '' : cardKind(item);
  const under = text ?? s.meta;
  return (
    <span className={faceClass('xs', subtle)} style={tone(item, underway)}>
      <Title item={item} className={listTitleClass('xs', subtle)} inline>
        {item.labels?.priority && <PriorityMark priority={item.labels.priority} suggested={!!item.labels.suggested?.includes('priority')} bare />}
        {item.parent && item.plan?.label && <span className={wsLabelClass}>{item.plan.label}</span>}
        <MergeProposedMark item={item} />
        <span className={listTitleTextClass('xs', !item.title)}>{title ?? shownTitle(item)}</span>
        {s.pin && !subtle && <Pin pin={s.pin} />}
      </Title>
      {subtle && s.pin && <PinDot pin={s.pin} />}
      <span className={lineClass}>
        <span className={dotClass(item.state === 'proposal', subtle)} />
        <span className={`${wordsClass} ${workstation ? LIST_DOING : ""}`}>
          {dotted([
            <span className={shortStateClass(subtle)}>{s.state.stopped ? <StoppedWords stopped={s.state.stopped} /> : workstation ? s.state.label : s.state.short}</span>,
            workstation && s.state.doing && <span className={s.state.doing.conflict ? "doing conflict" : s.state.doing.demo ? "doing demo" : "doing"}>{s.state.doing.text}</span>,
            !workstation && kind !== s.state.short && kind,
            other && <OtherCanvas item={item} named />,
            tail,
            !workstation && under,
          ])}
        </span>
      </span>
      {workstation && under && <span className="block truncate text-muted-foreground">{under}</span>}
    </span>
  );
}
