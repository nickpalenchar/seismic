








import { cn } from 'cn';
import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';

export interface ListboxOptions {
  
  count: number;
  
  open: boolean;
  onPick: (index: number) => void;
  
  onEscape?: (e: KeyboardEvent) => void;
  
  wrap?: boolean;
  
  pickKeys?: string[];
  
  resetOn?: unknown;
  
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
  
  const held = items.map(itemKey).join('\n');
  useEffect(() => {
    list.current?.children[box.active]?.scrollIntoView({ block: 'nearest' });
  }, [box.active, held]);
  return (
    <ul ref={list} id={box.id} className={cn('m-0 list-none p-0 [&>li]:cursor-pointer [&>li[aria-selected=true]]:bg-muted', className)} role="listbox" aria-label={label}>
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


export const listboxMenuClassName =
  'z-5 box-border max-h-[min(320px,45vh)] overflow-x-hidden overflow-y-auto rounded-md border border-glass-edge bg-surface p-1 text-sm text-foreground shadow-lift';

/** A `Listbox` on a menu's surface, its options a row each; `children` of the surface stand in for the list while `items` is undefined (still asked). */
export function ListboxMenu<T>({ className, style, items, fallback, ...props }: Omit<Parameters<typeof Listbox<T>>[0], 'items' | 'className'> & { items: T[] | undefined; fallback?: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div data-slot="listbox-menu" className={cn(listboxMenuClassName, className)} style={style}>
      {items ? <Listbox {...props} items={items} className="[&>li]:flex [&>li]:gap-3 [&>li]:items-baseline [&>li]:rounded-sm [&>li]:px-2 [&>li]:py-1.5" /> : fallback}
    </div>
  );
}
