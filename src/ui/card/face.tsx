




import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { Item } from '../../core/types';
import { OtherCanvas, useOtherCanvas } from '../canvases';
import { stateLabel, t } from '../strings';
import { hasChips, hasLabels, LabelMarks, PriorityMark } from './labels';
import { LIST_DOING, cardFlags, type CardPlace, chipLabelClass, dotClass, faceClass, kindClass, lineClass, listStateClass, listStateTextClass, listTextClass, listTitleClass, listTitleTextClass, metaClass, pinClass, shortStateClass, stateClass, stateLineClass, stateTextClass, topClass, ttlClass, whereClass, wordsClass, wsLabelClass } from './faceClasses';
import { MergeProposedMark, Pin, PinDot, shownTitle, StateMarks, StateText, StoppedWords, Title, UnreadDot } from './pieces';
import { cardKind, cardSummary, cardTone, stateVars } from './summary';
import { Badge } from '../components/badge';
import { DrawLine } from '../components/drawLine';

export type CardSize = 'm' | 's' | 'xs' | 'inline';

export interface CardFaceProps {
  item: Item;
  
  size?: CardSize;
  
  where?: ReactNode;
  
  underway?: string;
  
  since?: ReactNode;
  
  chip?: boolean;
  
  place?: CardPlace;
  
  half?: 'first' | 'partner';
  pairOf?: Item;
  
  mergePartner?: string;
  
  unread?: boolean;
  
  title?: ReactNode;
  
  text?: ReactNode;
  
  tail?: ReactNode;
  
  subtle?: boolean;
  
  workstation?: boolean;
  
  href?: string;
  onOpen?: () => void;
  
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
  
  const f = cardFlags(pairOf ?? item, pairOf ? undefined : underway);
  const at = { place: half ? ('canvas' as const) : place, chip, half, subtle };
  
  const label = [item.state === 'proposal' && t.proposalMark, where, s.kind].filter(Boolean);
  const labelled = hasLabels(item);
  
  const moving = stateLineClass(f, { ...at, doingNow: s.state.live });
  return (
    <>
      {(label.length > 0 || labelled) && (
        <div className={kindClass(f, at, { any: labelled, chips: hasChips(item) })}>
          <LabelMarks item={item} />
          { }
          {label.length > 0 && <span className="far:hidden">{dotted(label)}</span>}
        </div>
      )}
      <Title item={item} className={ttlClass(f, { ...at, untitled: !item.title, labels: labelled })}>
        {chip && item.plan?.label ? (
          <>
            <span className={chipLabelClass}>{item.plan.label}</span>
            {shownTitle(item)}
          </>
        ) : undefined}
      </Title>
      {s.meta && <div className={metaClass(at)}>{s.meta}</div>}
      <div className={[stateClass(f, { ...at, doingNow: s.state.live }), s.state.live && 'doing-now', subtle && 'subtle'].filter(Boolean).join(' ')}>
        <StateMarks marks={s.state.marks} />
        { }
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
  
  const kind = item.parent ? '' : cardKind(item);
  const under = text ?? s.meta;
  return (
    <span className={faceClass('xs', subtle)} style={tone(item, underway)}>
      <Title item={item} className={listTitleClass('xs', subtle)} inline>
        {item.labels?.priority && <PriorityMark priority={item.labels.priority} suggested={!!item.labels.suggested?.includes('priority')} bare />}
        {item.parent && item.plan?.label && <span className={wsLabelClass}>{item.plan.label}</span>}
        <span className={listTitleTextClass('xs', !item.title)}>{title ?? shownTitle(item)}</span>
        {s.pin && !subtle && <Pin pin={s.pin} />}
      </Title>
      {subtle && s.pin && <PinDot pin={s.pin} />}
      <span className={lineClass}>
        {s.state.marks.includes('mergeProposed') ? <span className={`inline-flex flex-none ${subtle ? '' : 'text-c-strong'}`}><MergeProposedMark /></span> : <span className={dotClass(item.state === 'proposal', subtle)} />}
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
