// The toasts in the stack above the microphone (bottom right on the project, above the microphone
// on the phone), all in one list: confirmations, what the server is still at, warnings, and a line
// for each spoken or typed command. Which of them replace and which stack, how long each stays and
// how long it offers "Undo" is said per toast; one component draws them all.

import { useMemo, useState } from 'react';
import { Aside } from '../aside';
import { t } from '../strings';

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

/**
 * The stack of toasts, oldest first; `open`: the card open now, which a toast neither names nor
 * offers to go to. With `aside` (the phone) the owner swipes a toast away.
 */
export function Toasts({ toasts, open, aside = false }: { toasts: ReturnType<typeof useToasts>; open?: string; aside?: boolean }) {
  return (
    <>
      {toasts.list.map((x) => (
        <ToastLine key={x.id} toast={x} open={open} aside={aside} onGone={() => toasts.store.remove(x.id)} />
      ))}
    </>
  );
}

export function ToastLine({ toast: x, open, aside, onGone }: { toast: Toast; open?: string; aside: boolean; onGone: () => void }) {
  const go = x.undo ? [] : (x.go ?? []).filter((c) => c.id !== open);
  return (
    <Aside on={aside} onGone={onGone} className={`toast ${x.kind}${x.reading ? ' reading' : ''}${go.length > 1 ? ' several' : ''}`} role={x.kind === 'warning' ? 'alert' : undefined}>
      <span>
        {x.card && x.card.id !== open && !x.reading && <b>{t.voice.about(x.card.title)}</b>}
        {x.text}
      </span>
      {x.undo && <button onClick={() => x.undo?.()}>{t.undo}</button>}
      {go.map((c) => (
        <button
          key={c.id}
          onClick={() => {
            onGone();
            c.run();
          }}
        >
          {c.label}
        </button>
      ))}
      {x.dismiss && <button onClick={onGone}>{t.voice.dismissWarning}</button>}
    </Aside>
  );
}
