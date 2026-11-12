// The project's full-page views besides the canvas (src/ui/fullPage.tsx), and the switcher at the
// bottom centre that moves between them. Parked lists the cards in the parking lot; Queue the tasks
// waiting for an agent in turn, dragged to their place as in Agent work; a card opened from either
// unfolds over the view and folds back into its entry. The switcher holds Canvas, Parked and the
// Table view still to come; switching keeps the canvas's camera, and an open card stays open.

import { Table2, Car, Map as MapIcon } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { inParkingLot, type Item } from '../core/types';
import { AgentEntry } from './agents';
import { CloseButton } from './components/button';
import { FullPage } from './fullPage';
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

/** The view's head: its title, its count and ✕. */
function Head({ title, n, onClose }: { title: string; n: number; onClose: () => void }) {
  return (
    <div className="a-full-head">
      <h2>
        {title} {n > 0 && <span className="count">{n}</span>}
      </h2>
      <span className="expand" />
      <CloseButton label={t.close} className="a-full" onClick={onClose} />
    </div>
  );
}

/** The parked cards as a full-page view, from the switcher or the menu's Parked. */
export function ParkedView({ on, items, open, underway, onOpen, onClose, els }: ListProps) {
  if (!on) return null;
  const parked = items.filter((i) => inParkingLot(i) && !i.archivedAt);
  return (
    <FullPage id="parked-full" title={t.views.parked}>
      <Head title={t.views.parked} n={parked.length} onClose={onClose} />
      <div className="a-full-body">
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
      <div className="a-full-body" ref={body}>
        <p className="hint">{q.queued.length ? t.views.queueHint : t.views.noneQueued}</p>
        {q.queued.length > 0 && <QueueList items={items} q={q} onOpen={onOpen} />}
      </div>
    </FullPage>
  );
}

/** Canvas | Parked | Table at the bottom centre; Table is still to come. */
export function ViewSwitcher({ shown, onShow }: { shown: SwitchedView | null; onShow: (v: SwitchedView) => void }) {
  const button = (v: SwitchedView, label: string, icon: ReactNode) => (
    <button type="button" className={shown === v ? 'on' : undefined} aria-pressed={shown === v} aria-label={label} onClick={() => onShow(v)}>
      {icon}
      <span className="view-label">{label}</span>
    </button>
  );
  return (
    // a click leaves the focus where it was: in a field, typing goes on there
    <div className="view-switch" role="group" aria-label={t.views.switcher} onPointerDown={(e) => e.preventDefault()}>
      {button('canvas', t.views.canvas, <MapIcon size={15} strokeWidth={2} aria-hidden />)}
      {button('parked', t.views.parked, <Car size={15} strokeWidth={2} aria-hidden />)}
      {/* not `disabled`: a disabled button shows no tooltip in every browser */}
      <Tooltip content={t.views.comingSoon}>
        <button type="button" className="soon" aria-disabled="true" aria-label={`${t.views.table} (${t.views.comingSoon})`}>
          <Table2 size={15} strokeWidth={2} aria-hidden />
          <span className="view-label">{t.views.table}</span>
        </button>
      </Tooltip>
    </div>
  );
}
