// A listbox with an active option, for the composer's two menus that list what fits what is typed: the
// skill menu and the card-link menu, whose field is a textarea or a contentEditable. Focus stays in the
// field; the arrow keys move the active option, Enter (and Tab where it is given) picks it, Escape
// closes the list and `data-esc` keeps App from also closing the card. No library behind it: a plain
// search field with a list is `Command` (components/command.tsx), but cmdk owns its input and cannot
// sit in a textarea or a contentEditable. `useListbox` is the behaviour, `Listbox` the markup with the
// ARIA wiring.

import { cn } from 'cn';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';

export interface ListboxOptions {
  /** How many options the list holds. */
  count: number;
  /** Whether the list is showing: only then do Escape and the arrow keys belong to it. */
  open: boolean;
  onPick: (index: number) => void;
  /** Escape in the field while the list is open; without it, Escape is not the list's. */
  onEscape?: (e: KeyboardEvent) => void;
  /** Arrow keys wrap around the ends instead of stopping at them. */
  wrap?: boolean;
  /** Keys that pick besides Enter. */
  pickKeys?: string[];
  /** The active option goes back to the first when this changes (the query). */
  resetOn?: unknown;
  /** The owner moved the active option with a key. */
  onNavigate?: () => void;
}

export function useListbox({ count, open, onPick, onEscape, wrap = false, pickKeys = [], resetOn, onNavigate }: ListboxOptions) {
  const id = useId();
  const [index, setActive] = useState(0);
  useEffect(() => setActive(0), [resetOn]);
  const active = Math.max(0, Math.min(index, count - 1));
  const showing = open && count > 0;
  /** Handles a key pressed in the field; true when the list took it. */
  const onKeyDown = (e: KeyboardEvent): boolean => {
    // Enter and arrows belong to the IME's candidate list while composing (Safari reports the confirming Enter as keyCode 229).
    if (!open || e.nativeEvent.isComposing || e.keyCode === 229) return false;
    if (e.key === 'Escape' && onEscape) {
      e.preventDefault();
      onEscape(e);
      return true;
    }
    if (!count) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(wrap ? (active + step + count) % count : Math.max(0, Math.min(count - 1, active + step)));
      onNavigate?.();
      return true;
    }
    if ((e.key === 'Enter' && !e.shiftKey) || (pickKeys.includes(e.key) && !e.shiftKey)) {
      e.preventDefault();
      onPick(active);
      return true;
    }
    return false;
  };
  return {
    id,
    active,
    setActive,
    onPick,
    onKeyDown,
    /** What the field carries: the combobox role and wiring, and `data-esc` while an Escape would close the list. */
    field: {
      role: 'combobox' as const,
      'aria-autocomplete': 'list' as const,
      'aria-expanded': showing,
      'aria-controls': showing ? id : undefined,
      'aria-activedescendant': showing ? `${id}-${active}` : undefined,
      'data-esc': (open && !!onEscape) || undefined,
    },
  };
}

export type ListboxState = ReturnType<typeof useListbox>;

/** The options of `items`, each drawn by `children`; the active one is `[data-active]`. A pointer over an option makes it active, a click picks it, and neither moves the focus out of the field. */
export function Listbox<T>({ box, items, label, className, itemKey, children }: { box: ListboxState; items: T[]; label: string; className?: string; itemKey: (item: T) => string; children: (item: T, index: number) => ReactNode }) {
  const list = useRef<HTMLUListElement>(null);
  // keyed by what the list holds, not by the array: a parent that rebuilds it on every render must not scroll the list back to the active option
  const held = items.map(itemKey).join('\n');
  useEffect(() => {
    list.current?.children[box.active]?.scrollIntoView({ block: 'nearest' });
  }, [box.active, held]);
  return (
    <ul ref={list} id={box.id} className={cn('m-0 list-none p-0 [&>li]:cursor-pointer [&>li[aria-selected=true]]:bg-chip', className)} role="listbox" aria-label={label}>
      {items.map((item, i) => (
        <li
          key={itemKey(item)}
          id={`${box.id}-${i}`}
          role="option"
          aria-selected={i === box.active}
          data-active={i === box.active || undefined}
          onMouseEnter={() => box.setActive(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => box.onPick(i)}
        >
          {children(item, i)}
        </li>
      ))}
    </ul>
  );
}
