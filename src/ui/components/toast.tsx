// The toasts in the stack above the microphone (bottom right on the project, above the microphone
// on the phone), all in one list: confirmations, what the server is still at, warnings, and a line
// for each spoken or typed command. Which of them replace and which stack, how long each stays and
// how long it offers "Undo" is said per toast; one component draws them all.

import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast as sonner } from 'sonner';
import { cn } from 'cn';
import { CardLink } from '../cardLink';
import { Cards } from '../message';
import { t } from '../strings';
import { Button } from './button';
import { Callout, CalloutDescription } from './callout';
import { Toaster } from './sonner';

/**
 * The column the toasts stand in (`#acks`), with what else stands above the microphone (the rating's
 * stars, the notification prompt): the bottom right corner of the project, left of a docked panel
 * (`--side`) and above the canvases' tab strip where there is one.
 */
export const acksClass =
  'fixed right-[calc(var(--side,0px)+var(--spacing)*3.5)] [transition:right_.45s_cubic-bezier(.3,.9,.3,1)] resizing:transition-none bottom-11.5 [:root:has(#canvas-tabs)_&]:bottom-21.5 z-90 flex flex-col items-end gap-1.5 pointer-events-none';

/**
 * On the phone the column is centred above the microphone, as wide as the screen; with the phone
 * turned it takes the width the microphone's strip leaves, and with a conversation's panel open
 * (`--ph-field`: how far its field's top stands above the screen's bottom) it stands above the field.
 */
export const phoneAcksClass =
  'fixed left-1/2 right-auto [transform:translateX(-50%)] transition-none bottom-[calc(91px+env(safe-area-inset-bottom))] w-[calc(100vw-24px)] z-90 flex flex-col items-center gap-1.5 pointer-events-none [.ph-panel~&]:bottom-[calc(var(--ph-field,0px)+10px)] ph-landscape:bottom-[calc(14px+env(safe-area-inset-bottom))] ph-landscape:w-[calc(100vw-112px-env(safe-area-inset-right)-24px)] ph-landscape:[.ph-panel~&]:bottom-[calc(var(--ph-field,0px)+10px)]';

/**
 * What a toast is: a confirmation (dark), what the server is still at (dark, turning), a warning
 * (light with a ring, stays until dismissed), or a command's line (muted while read, then dark).
 */
export type ToastKind = 'confirm' | 'wait' | 'warning' | 'command';

/** A "Go to card" on a toast: hidden while that card is open, and the toast goes once it is clicked. */
export interface ToastGo {
  id: string;
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  /** The card it is about, named in bold in front of the text while another card is open. */
  card?: { id: string; title: string };
  /** A command's line while it is still read: muted, turning. */
  reading?: boolean;
  /** "Undo", offered while set; the action decides what becomes of the toast. */
  undo?: () => unknown;
  /** "Go to card", one button per card, once "Undo" is no longer offered. */
  go?: ToastGo[];
  /** "Dismiss". */
  dismiss?: boolean;
  /** At most one toast per slot: a new one takes the place of the one there. */
  slot?: string;
}

export interface ToastInit extends Omit<Toast, 'id'> {
  /** Gone this long from now; without it the toast stays until replaced or dismissed. */
  stayMs?: number;
  /** "Undo" goes this long from now, the toast staying. */
  undoMs?: number;
  /** Called once the toast is gone, whatever took it. */
  onGone?: () => void;
}

/** The timers a store runs on: the browser's, or a test's. */
export interface Clock {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const browserClock: Clock = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export type ToastStore = ReturnType<typeof toastStore>;

/** The toasts, oldest first, without React: `onChange` hears each new list. */
export function toastStore(onChange: (list: Toast[]) => void = () => {}, clock: Clock = browserClock) {
  let list: Toast[] = [];
  let next = 0;
  const timers = new Map<number, { gone?: unknown; undo?: unknown; onGone?: () => void }>();
  const changed = () => onChange(list);

  function timersOf(id: number) {
    let x = timers.get(id);
    if (!x) timers.set(id, (x = {}));
    return x;
  }
  /** Starts the timers `init` asks for, in place of those running. */
  function time(id: number, init: Partial<ToastInit>) {
    const x = timersOf(id);
    if (init.onGone) x.onGone = init.onGone;
    if (init.stayMs !== undefined) {
      clock.clear(x.gone);
      x.gone = clock.set(() => remove(id), init.stayMs);
    }
    if (init.undoMs !== undefined) {
      clock.clear(x.undo);
      x.undo = clock.set(() => update(id, { undo: undefined }), init.undoMs);
    }
  }
  const toast = ({ stayMs: _s, undoMs: _u, onGone: _g, ...rest }: Partial<ToastInit>) => rest;

  /** Adds a toast, newest last (nearest the microphone), taking away the one in its slot; gives its id. */
  function show(init: ToastInit): number {
    const id = ++next;
    const old = init.slot ? list.find((x) => x.slot === init.slot) : undefined;
    list = [...list.filter((x) => x !== old), { id, ...toast(init) } as Toast];
    time(id, init);
    // whoever made the old one hears it is gone once the new one stands, whatever they do then
    if (old) gone(old.id);
    changed();
    return id;
  }

  /** Changes a toast still there; `stayMs` and `undoMs` start their timers afresh. */
  function update(id: number, patch: Partial<ToastInit> | ((x: Toast) => Partial<ToastInit>)) {
    const x = list.find((y) => y.id === id);
    if (!x) return;
    const p = typeof patch === 'function' ? patch(x) : patch;
    list = list.map((y) => (y === x ? { ...y, ...toast(p) } : y));
    time(id, p);
    changed();
  }

  /** Its timers stop and whoever made it hears it is gone. */
  function gone(id: number) {
    const x = timers.get(id);
    timers.delete(id);
    if (!x) return;
    clock.clear(x.gone);
    clock.clear(x.undo);
    x.onGone?.();
  }

  /** Takes a toast away: it went by itself, was dismissed, swiped aside, or replaced. */
  function remove(id: number) {
    if (!list.some((x) => x.id === id)) return;
    list = list.filter((x) => x.id !== id);
    gone(id);
    changed();
  }

  const has = (id: number) => list.some((x) => x.id === id);
  return { show, update, remove, has, list: () => list };
}

/** The page's toast store, and its list as it is now. */
export function useToasts() {
  const [list, setList] = useState<Toast[]>([]);
  const store = useMemo(() => toastStore(setList), []);
  return { store, list };
}

/** In this browser the owner has swiped a toast aside: they no longer nudge. */
const SWIPED = 'seismic.swipedAside';
let nextToastBridge = 0;

function swipedOnce(): boolean {
  try {
    return localStorage.getItem(SWIPED) === '1';
  } catch {
    return false;
  }
}

/**
 * The stack of toasts, oldest first, drawn by Sonner; `open`: the card open now, which a toast neither
 * names nor offers to go to. With `aside` (the phone) the owner swipes a toast away, which drops it
 * from the store and takes nothing back.
 */
export function Toasts({ toasts, open, aside = false }: { toasts: ReturnType<typeof useToasts>; open?: string; aside?: boolean }) {
  const { store, list } = toasts;
  // Each project has its own numeric store ids, while Sonner keeps one module-wide store.
  const bridge = useMemo(() => ++nextToastBridge, []);
  const shown = useRef(new Set<number>());
  useEffect(() => () => {
    for (const id of shown.current) sonner.dismiss(`${bridge}:${id}`);
    shown.current.clear();
  }, [bridge]);
  useEffect(() => {
    for (const x of list) {
      shown.current.add(x.id);
      sonner.custom(() => <ToastLine toast={x} open={open} aside={aside} onGone={() => store.remove(x.id)} />, {
        id: `${bridge}:${x.id}`,
        duration: Infinity,
        // Sonner also reports a toast it took away for the store; only one still in the store was swiped
        onDismiss: () => {
          if (!store.has(x.id)) return;
          if (aside) {
            try {
              localStorage.setItem(SWIPED, '1');
            } catch {}
          }
          store.remove(x.id);
        },
      });
    }
    for (const id of shown.current) {
      if (list.some((x) => x.id === id)) continue;
      shown.current.delete(id);
      sonner.dismiss(`${bridge}:${id}`);
    }
  }, [list, open, aside, bridge, store]);
  return <Toaster phone={aside} swipeDirections={aside ? ['left', 'right'] : []} />;
}

/** The card a toast is about, as an inline card where it is on the project, else its title in bold. */
function ToastCard({ card }: { card: { id: string; title: string } }) {
  const cards = useContext(Cards);
  const item = cards.items.find((i) => i.id === card.id);
  if (!item || item.archivedAt) return <b className="font-semibold">{t.voice.about(card.title)}</b>;
  return (
    <>
      <CardLink card={item} title={card.title} />
      {': '}
    </>
  );
}

/**
 * A turning ring before the words, in the colours of `ring` (its track, then its turning part). A
 * color-mix reaches the ring through a custom property (`--track`): Tailwind's fallback for one on a
 * pseudo-element nests it where it never applies.
 */
const spinner = (ring: string) =>
  cn("before:content-[''] before:flex-none before:rounded-full before:border-2 before:border-solid before:animate-[spin_.8s_linear_infinite]", ring);

/**
 * A toast's look: dark (a confirmation, a command's line), yellow like a warning callout (a warning),
 * muted while a command is read; at most as wide as half the room the docked panels leave, on the
 * phone as wide as the screen. Its words wrap above its buttons where there are several, and always
 * on a warning: its words take the toast's full width, its buttons stand below them on the right.
 */
function toastClass(x: Toast, { wrap, phone, nudge }: { wrap: boolean; phone: boolean; nudge: boolean }) {
  const warning = x.kind === 'warning';
  return cn(
    'toast flex items-center rounded-sm pointer-events-auto',
    x.kind,
    phone
      ? 'max-w-full'
      : 'max-w-[min(560px,max(300px,calc((100vw-var(--left,0px)-var(--side,0px))/2-110px)),calc(100vw-var(--left,0px)-var(--side,0px)-32px))]',
    x.reading
      ? ['reading bg-surface text-muted-foreground shadow-glass py-2 px-3.5 text-sm', spinner('before:size-2.5 before:border-transparent before:border-t-working')]
      : warning
        ? 'shadow-glass'
        : 'bg-foreground text-background py-3 px-4 text-base',
    x.kind === 'wait' && ['[--track:--alpha(var(--background)/25%)]', spinner('before:size-3 before:[border-color:var(--background)_var(--track)_var(--track)_var(--track)]')],
    wrap && !warning ? 'flex-wrap gap-x-2 gap-y-2.5 [&>span]:basis-full' : 'gap-3.5',
    // the phone's toasts are swiped aside: a finger dragging one selects nothing
    phone && 'swipeable select-none',
    nudge && !x.reading && 'nudge animate-[toast-nudge_.9s_.7s_ease-in-out]',
  );
}

/** A toast's button: outlined in the toast's ink; cut short where several share a line. */
const toastButtonClass = (several: boolean) =>
  cn('bg-transparent border border-solid rounded-sm py-1 px-2.5 cursor-pointer flex-none border-background/40 text-background', several && 'max-w-full overflow-hidden text-ellipsis whitespace-nowrap');

/**
 * A toast's actions: "Undo", a "Go to card" per card, "Dismiss". On a warning they are the UI's own
 * outlined buttons; on the dark toasts, outlines in the toast's ink.
 */
function ToastActions({ toast: x, go, warning, several, onGone }: { toast: Toast; go: ToastGo[]; warning: boolean; several: boolean; onGone: () => void }) {
  const actions = [
    ...(x.undo ? [{ key: 'undo', label: t.undo, run: () => x.undo?.() }] : []),
    ...go.map((c) => ({ key: c.id, label: c.label, run: () => (onGone(), c.run()) })),
    ...(x.dismiss ? [{ key: 'dismiss', label: t.voice.dismissWarning, run: onGone }] : []),
  ];
  return actions.map((a) =>
    warning ? (
      <Button key={a.key} variant="outline" size="small" className={cn(several && 'max-w-full overflow-hidden text-ellipsis')} onClick={a.run}>
        {a.label}
      </Button>
    ) : (
      <button key={a.key} className={toastButtonClass(several)} onClick={a.run}>
        {a.label}
      </button>
    ),
  );
}

export function ToastLine({ toast: x, open, aside, onGone }: { toast: Toast; open?: string; aside: boolean; onGone: () => void }) {
  const go = x.undo ? [] : (x.go ?? []).filter((c) => c.id !== open);
  const several = go.length > 1;
  const warning = x.kind === 'warning';
  // until the owner has swiped one aside, each nudges aside and back once as a hint
  const nudge = aside && !swipedOnce();
  const words = (
    <>
      {x.card && x.card.id !== open && !x.reading && <ToastCard card={x.card} />}
      {x.text}
    </>
  );
  // a warning is the warning callout, its words across its full width and its buttons below them on the right
  if (warning)
    return (
      <Callout kind="warn" className={cn(toastClass(x, { wrap: true, phone: aside, nudge }), 'block rounded-lg text-base', several && 'several')}>
        <CalloutDescription className="block text-base">{words}</CalloutDescription>
        <div className="mt-2.5 flex flex-wrap justify-end gap-2">
          <ToastActions toast={x} go={go} warning several={several} onGone={onGone} />
        </div>
      </Callout>
    );
  return (
    <div className={cn(toastClass(x, { wrap: several, phone: aside, nudge }), several && 'several')}>
      <span>{words}</span>
      <ToastActions toast={x} go={go} warning={false} several={several} onGone={onGone} />
    </div>
  );
}
