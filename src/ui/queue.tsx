// The queue: the list in the Agents sheet's "Queue" tab (src/ui/agents.tsx), where a row is dragged to its
// place by its grip (or, with a mouse, by itself), as far as its waits let it; pulled farther, it says
// why it stops. A row's × takes its card out. On the card, two buttons move it one place earlier or
// later; one whose way is blocked by a wait says why when clicked (and on hover), and at the head or
// the end of the queue it is greyed out. The card also unfolds the queue, where it alone is dragged.

import { GripVertical } from 'lucide-react';
import { type ReactNode, type RefObject, useState } from 'react';
import { move, movable, notStarted, queueOrder, reach } from '../core/queue';
import type { Item } from '../core/types';
import { api } from './api';
import { CardFace } from './card';
import { Naming } from './cardLink';
import { plain } from './markdown';
import { type Drag, useSortable } from './sortable';
import { failText, t } from './strings';
import { Tooltip } from './components/tooltip';
import { Button } from './components/button';
import { cn } from 'cn';

/**
 * The queue's order to drag in: in the Agents sheet every card that may move, on a waiting card
 * (`own`) only that card. Held by what stays mounted while the list shows and hides, so that a
 * drop shown ahead of the server keeps the next drag from starting from the old order.
 */
export function useQueueSort(items: Item[], scroller: RefObject<HTMLElement | null>, own?: string) {
  // why a row's last move or × did not go
  const [failed, setFailed] = useState<{ id: string; text: string }>();
  const queued = queueOrder(items);
  const fixed = (id: string) => (own ? id !== own : !movable(queued.find((i) => i.id === id)!));
  const sort = useSortable(
    queued.map((i) => i.id),
    {
      reach: (id) => ({ earlier: reach(id, true, items).places, later: reach(id, false, items).places }),
      drop: (id, places) => {
        setFailed(undefined);
        return api.act(id, { action: 'reorder', earlier: places < 0, places: Math.abs(places) }).catch((err) => {
          setFailed({ id, text: failText(err) });
          throw err;
        });
      },
      scroller,
      fixed,
    },
  );
  return { queued, sort, fixed, own, failed, setFailed };
}

/**
 * The waiting cards in turn, a row dragged to its place as far as its waits let it. In the Agents
 * sheet (`onOpen`) a row opens its card; on a waiting card the
 * other rows stand there to show where it is.
 */
export function QueueList({ items, q, onOpen }: { items: Item[]; q: ReturnType<typeof useQueueSort>; onOpen?: (i: Item) => void }) {
  const { queued, sort, fixed, own, failed, setFailed } = q;
  return (
    <ol className={cn('qlist list-none p-0 m-0', own && 'on-card')}>
      {sort.order.map((id) => {
        const i = queued.find((q) => q.id === id)!;
        return (
          <QueueRow
            key={id}
            item={i}
            items={items}
            own={id === own}
            onCard={!!own}
            row={sort.row(id)}
            grip={fixed(id) ? undefined : sort.grip(id)}
            drag={sort.drag?.key === id ? sort.drag : undefined}
            failed={failed?.id === id ? failed.text : ''}
            onFail={(text) => setFailed(text ? { id, text } : undefined)}
            onOpen={onOpen}
          />
        );
      })}
    </ol>
  );
}

/** What a waiting card's line says it waits for: each card by `name`, and whether it has not been started. */
export function waitedOn(ids: string[], items: Item[], name: (id: string) => string = (id) => plain(items.find((i) => i.id === id)?.title ?? id)) {
  return ids.map((id) => {
    const i = items.find((x) => x.id === id);
    return { title: name(id), notStarted: !!i && notStarted(i) };
  });
}

/** "Waits for" and the cards it waits for, each as an inline card. */
export function Waiting({ ids, items, name, onOpen }: { ids: string[]; items: Item[]; name?: (id: string) => string; onOpen?: (i: Item) => void }) {
  const waited = waitedOn(ids, items, name);
  const cards = ids.map((id) => ({ card: items.find((x) => x.id === id), title: name?.(id) }));
  return <Naming text={(...names) => t.queue.behind(waited.map((w, k) => ({ ...w, title: names[k]! })))} cards={cards} onOpen={onOpen} />;
}

export type Behind = { behind: string[]; reason: string; manualWait?: string[] };

/** Why a card waits behind others: the reason Seismic gave, or the owner's arrows where only they hold it. */
export const waitReason = (q: Behind) => (q.behind.some((id) => !q.manualWait?.includes(id)) ? q.reason : t.queue.drawn);

/** The confirmation that a waiting card was started anyway. */
export const forcedText = (q: Item['queue']) => (q && 'behind' in q && q.behind.every((id) => q.manualWait?.includes(id)) ? t.queue.forcedDrawn : t.queue.forced);

/** What a card waits for and why: the waits Seismic inferred with their reason, then those the owner's arrows hold it for. */
export function waitText(q: Behind, items: Item[], name?: (id: string) => string): string {
  const drawn = q.behind.filter((id) => q.manualWait?.includes(id));
  const inferred = q.behind.filter((id) => !drawn.includes(id));
  if (!inferred.length) return `${t.queue.behind(waitedOn(drawn, items, name))} ${t.queue.drawn}`;
  return `${t.queue.behind(waitedOn(inferred, items, name))} ${q.reason}${drawn.length ? ` ${t.queue.drawnToo(waitedOn(drawn, items, name))}` : ''}`;
}

type Sort = ReturnType<typeof useSortable>;

/**
 * A row of the queue: in the Agents sheet and the Queue view it opens its card on a click; on a waiting
 * card the others only show where it stands, the card's own framed and dragged (`own`). The dragged row
 * lifts, the others make way; on the phone each row is a card of its own, sized for a finger.
 */
const rowClass = (onCard: boolean, own: boolean) =>
  cn(
    'group/qrow relative flex gap-2.5 items-start py-[7px] px-2 rounded-[2px] text-[13px]',
    'data-[sorting=other]:[transition:transform_.15s_ease] data-[sorting=dragged]:bg-card data-[sorting=dragged]:[box-shadow:var(--lift)] data-[sorting=dragged]:cursor-grabbing',
    onCard ? 'cursor-default' : 'cursor-pointer hover:bg-chip',
    own && 'own bg-card! [box-shadow:inset_0_0_0_1px_var(--line)] cursor-grab! data-[sorting=dragged]:[box-shadow:var(--lift)]!',
    '[#ph-home_&]:gap-3 [#ph-home_&]:py-3 [#ph-home_&]:px-2.5 [#ph-home_&]:mb-2 [#ph-home_&]:rounded-[3px] [#ph-home_&]:bg-card [#ph-home_&]:[box-shadow:inset_0_0_0_1px_var(--line)] [#ph-home_&]:text-[14.5px]',
    // the XS face's own sizes (its utilities in card/faceClasses.ts) give way to the finger's
    '[#ph-home_&_.face-xs_.f-ttl]:text-[16.5px]! [#ph-home_&_.face-xs_.f-line]:text-[13.5px]! [#ph-home_&_.face-xs_.f-words]:whitespace-normal!',
  );

/** A row's grip: dragged to put the row elsewhere; a finger on it does not scroll the list, and is given more room. */
const gripClass =
  'grip flex-none flex justify-center w-3 m-[2px_-4px_0_-2px] text-muted-foreground touch-none opacity-70 group-hover/qrow:opacity-100 pointer-coarse:w-7 pointer-coarse:m-[-4px_-8px_-4px_-8px] pointer-coarse:pt-1.5';

/** The buttons that move a card one place earlier or later (Configuration's project order has them too). */
export const qmovesClass = 'qmoves inline-flex gap-1 flex-none';

/** A card in the queue, with its grip and what it waits for. */
function QueueRow(p: {
  item: Item;
  items: Item[];
  own: boolean;
  /** On a waiting card: the other rows only show where it stands. */
  onCard: boolean;
  row: ReturnType<Sort['row']>;
  grip?: ReturnType<Sort['grip']>;
  drag?: Drag;
  failed: string;
  onFail: (text: string) => void;
  onOpen?: (i: Item) => void;
}) {
  const { item, items, onOpen } = p;
  // pulled beyond where its waits let it go: the card that stops it, and why
  const stop = p.drag?.held && reach(item.id, p.drag.held === 'earlier', items);
  const held = stop && stop.stop && stop.why ? t.queue.stuck[stop.why](plain(stop.stop.title)) : '';
  return (
    <li className={rowClass(p.onCard, p.own)} {...p.row} onClick={onOpen && (() => onOpen(item))}>
      {p.grip ? (
        <span className={cn(gripClass, 'cursor-grab')} title={t.queue.drag} aria-hidden {...p.grip}>
          <GripVertical size={16} strokeWidth={2} />
        </span>
      ) : (
        <span className={cn(gripClass, 'none cursor-[inherit]')} />
      )}
      <span className="q-what flex-1 min-w-0">
        <CardFace item={item} size="xs" tail={item.queue && 'behind' in item.queue && <Waiting ids={item.queue.behind} items={items} onOpen={onOpen} />} />
        {p.failed && <span className="hint why block mt-0.5">{p.failed}</span>}
      </span>
      {held && (
        <span className="q-held absolute left-[30px] right-2 top-[calc(100%+4px)] py-1.5 px-[9px] bg-panel border border-glass-edge rounded-[12px] [box-shadow:var(--shadow)] text-[12.5px] text-ink">
          {held}
        </span>
      )}
    </li>
  );
}

/** The nearest element around `el` that scrolls now (one that may scroll but holds all it has does not), as a ref the drag reads when it starts. */
export function scrollerOf(el: RefObject<HTMLElement | null>): RefObject<HTMLElement | null> {
  return {
    get current() {
      for (let e = el.current?.parentElement; e; e = e.parentElement) if (/auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight) return e;
      return null;
    },
  };
}

/** The buttons, the card's place, and why the last move did not go; none for a card that cannot move. */
export function useQueueMove(item: Item, items: Item[]): { buttons: ReactNode; place: string; why: string } | undefined {
  // a refusal shows until the next click; a blocked way while it is still blocked
  const [why, setWhy] = useState<{ id: string; text: string; error?: true }>();
  if (!movable(item)) return undefined;
  const order = queueOrder(items);
  const ways = [true, false].map((earlier) => {
    const { past, why: stuck } = move(item.id, earlier, items);
    return { earlier, past, blocked: past && stuck ? t.queue.stuck[stuck](plain(past.title)) : '' };
  });
  const button = ({ earlier, past, blocked }: (typeof ways)[number]) => {
    const label = earlier ? t.queue.earlier : t.queue.later;
    return (
      <Tooltip key={label} content={blocked || label}>
        <Button
          size="small"
          className={blocked ? 'qmove stuck text-muted-foreground cursor-help' : 'qmove'}
          disabled={!past}
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            if (blocked) return setWhy({ id: item.id, text: blocked });
            setWhy(undefined);
            api.act(item.id, { action: 'reorder', earlier }).catch((err) => setWhy({ id: item.id, text: failText(err), error: true }));
          }}
        >
          {earlier ? '↑' : '↓'}
          {` ${label}`}
        </Button>
      </Tooltip>
    );
  };
  const shown = why?.id === item.id && (why.error || ways.some((w) => w.blocked === why.text)) ? why.text : '';
  return {
    buttons: <span className={qmovesClass}>{ways.map(button)}</span>,
    place: t.queue.place(order.findIndex((i) => i.id === item.id) + 1, order.length),
    why: shown,
  };
}
