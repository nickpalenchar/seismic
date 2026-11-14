// The project's full-page views besides the canvas (src/ui/fullPage.tsx), and the switcher at the
// bottom centre that moves between them. Parked lists the cards in the parking lot; Queue the tasks
// waiting for an agent in turn, dragged to their place as in Agent work; a card opened from either
// unfolds over the view and folds back into its entry. The switcher holds Canvas, Parked and the
// Table view still to come; switching keeps the canvas's camera, and an open card stays open.

import { cn } from 'cn';
import { Table2, Car, Map as MapIcon } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { type Item, offCanvas } from '../core/types';
import { AgentEntry } from './agents';
import { CloseButton } from './components/button';
import { FullPage, fullBodyClass, fullCloseClass, fullHeadClass, fullTitleClass } from './fullPage';
import { entryListClass } from './inboxClasses';
import { QueueList, useQueueSort } from './queue';
import { t } from './strings';
import { Tooltip } from './components/tooltip';

/** The views the switcher moves between, the canvas being none of the full-page ones. */
export type SwitchedView = 'canvas' | 'parked';

interface ListProps {
  on: boolean;
  items: Item[];
  open?: string;
  underway: (id: string) => boolean;
  onOpen: (i: Item) => void;
  onClose: () => void;
  /** Where a card opened from the view unfolds from and folds back to. */
  els: Map<string, HTMLElement>;
}

/** A list view's body: the list and the hint above it to a readable width, the hint set apart from the list (over `.hint`'s own size). */
const listBodyClass = `${fullBodyClass} [&>:is(ul,ol,.hint)]:max-w-[760px] [&>.hint]:m-[4px_0_14px] [&>.hint]:text-[13px]!`;

/** The view's head: its title, its count and ✕. */
function Head({ title, n, onClose }: { title: string; n: number; onClose: () => void }) {
  return (
    <div className={fullHeadClass}>
      <h2 className={fullTitleClass}>
        {title} {n > 0 && <span className="count ml-1 font-normal text-muted-foreground">{n}</span>}
      </h2>
      <span className="expand flex-1" />
      <CloseButton label={t.close} className={fullCloseClass} onClick={onClose} />
    </div>
  );
}

/** The parked cards as a full-page view, from the switcher or the menu's Parked. */
export function ParkedView({ on, items, open, underway, onOpen, onClose, els }: ListProps) {
  if (!on) return null;
  const parked = items.filter((i) => offCanvas(i) && !i.archivedAt);
  return (
    <FullPage id="parked-full" title={t.views.parked}>
      <Head title={t.views.parked} n={parked.length} onClose={onClose} />
      <div className={listBodyClass}>
        <p className="hint">{parked.length ? t.views.parkedHint : t.agents.noneParked}</p>
        <ul className={entryListClass}>
          {parked.map((i) => (
            <AgentEntry key={i.id} item={i} els={els} here={i.id === open} underway={underway(i.id)} onOpen={onOpen} />
          ))}
        </ul>
      </div>
    </FullPage>
  );
}

/** The queue as a full-page view, from the menu's Queue: the waiting tasks in turn, each dragged to its place. */
export function QueueView({ on, items, onOpen, onClose }: Omit<ListProps, 'els' | 'open' | 'underway'>) {
  if (!on) return null;
  return <QueuePage items={items} onOpen={onOpen} onClose={onClose} />;
}

function QueuePage({ items, onOpen, onClose }: { items: Item[]; onOpen: (i: Item) => void; onClose: () => void }) {
  const body = useRef<HTMLDivElement>(null);
  const q = useQueueSort(items, body);
  // the view closing under a drag: the row is not dropped anywhere
  useEffect(() => () => q.sort.cancel(), []);
  return (
    <FullPage id="queue-full" title={t.views.queue}>
      <Head title={t.views.queue} n={q.queued.length} onClose={onClose} />
      <div className={listBodyClass} ref={body}>
        <p className="hint">{q.queued.length ? t.views.queueHint : t.views.noneQueued}</p>
        {q.queued.length > 0 && <QueueList items={items} q={q} onOpen={onOpen} />}
      </div>
    </FullPage>
  );
}

/**
 * A view of the switcher: its icon and name; on medium screens (where the switcher shrinks to fit the main
 * area left of a dock) the views that are not showing keep only their icon.
 */
const switchButtonClass = 'inline-flex items-center gap-1.5 h-[30px] py-0 px-3.5 [border:0] rounded-[999px] bg-transparent text-muted-foreground text-[13px] leading-none cursor-pointer';

/** Canvas | Parked | Table at the bottom centre, where the microphone was; Table is still to come. */
export function ViewSwitcher({ shown, onShow }: { shown: SwitchedView | null; onShow: (v: SwitchedView) => void }) {
  const button = (v: SwitchedView, label: string, icon: ReactNode) => (
    <button type="button" className={cn(switchButtonClass, shown === v ? 'bg-muted text-foreground font-semibold' : 'hover:text-foreground [@media(max-width:1100px)]:px-2.5')} aria-pressed={shown === v} aria-label={label} onClick={() => onShow(v)}>
      {icon}
      <span className={cn(shown !== v && '[@media(max-width:1100px)]:hidden')}>{label}</span>
    </button>
  );
  return (
    // a click leaves the focus where it was: in a field, typing goes on there; outlined while files are dragged over the row
    <div
      className="flex gap-0.5 p-[2px] rounded-[999px] bg-glass border border-solid border-glass-edge [box-shadow:var(--lift)] backdrop-blur-glass group-[.dropping]/ptt:outline-2 group-[.dropping]/ptt:outline-dashed group-[.dropping]/ptt:outline-working group-[.dropping]/ptt:outline-offset-[5px]"
      role="group"
      aria-label={t.views.switcher}
      onPointerDown={(e) => e.preventDefault()}
    >
      {button('canvas', t.views.canvas, <MapIcon size={15} strokeWidth={2} aria-hidden />)}
      {button('parked', t.views.parked, <Car size={15} strokeWidth={2} aria-hidden />)}
      {/* not `disabled`: a disabled button shows no tooltip in every browser */}
      <Tooltip content={t.views.comingSoon}>
        <button type="button" className={cn(switchButtonClass, 'opacity-45 cursor-default [@media(max-width:1100px)]:px-2.5')} aria-disabled="true" aria-label={`${t.views.table} (${t.views.comingSoon})`}>
          <Table2 size={15} strokeWidth={2} aria-hidden />
          <span className="[@media(max-width:1100px)]:hidden">{t.views.table}</span>
        </button>
      </Tooltip>
    </div>
  );
}
