import { Search } from 'lucide-react';
import { type Ref, useEffect, useRef, useState } from 'react';
import type { Item } from '../core/types';
import { CardFace } from './card';
import { matchingCards } from './cardRefs';
import { Listbox, useListbox } from './components/listbox';
import { closeBarMenus } from './components/menu';
import { t } from './strings';

/** What the finder lists for the query: every match, not only the link menu's few; a card absorbed by a merge has no project element to unfold from. */
export const finderResults = (items: Item[], query: string) => matchingCards(items.filter((item) => !item.idea?.mergingInto), query, undefined, Infinity);

/**
 * The project's quick card finder, a field in the middle of the bar. It shares the task field's title
 * and short-code matching; while the field has focus the results list under it, each a card's face at
 * size XS. `/` focuses it (App.tsx, through `field`).
 */
export function CardSearch({ items, onOpen, field, hidden }: { items: Item[]; onOpen: (item: Item) => void; field: Ref<HTMLInputElement>; hidden: boolean }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const results = open ? finderResults(items, query) : [];
  const close = () => {
    setOpen(false);
    setQuery('');
    box.current?.querySelector('input')?.blur();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !box.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  // an unfolded card covers what the finder would open
  useEffect(() => void (hidden && open && close()), [hidden]);
  const pick = (item: Item) => {
    close();
    onOpen(item);
  };
  const list = useListbox({
    count: results.length,
    open,
    wrap: true,
    resetOn: query,
    onPick: (i) => pick(results[i]!),
    onEscape: (e) => (e.stopPropagation(), close()),
  });
  return (
    <div className={hidden ? 'bar-search hidden' : 'bar-search'} ref={box}>
      <Search className="bar-search-icon" size={15} strokeWidth={2} aria-hidden />
      <input
        ref={field}
        type="search"
        {...list.field}
        value={query}
        placeholder={t.cardSearch.placeholder}
        aria-label={t.cardSearch.shortcut}
        title={t.cardSearch.shortcut}
        spellCheck={false}
        onFocus={() => {
          if (!open) closeBarMenus();
          setOpen(true);
        }}
        onChange={(e) => (setQuery(e.target.value), setOpen(true))}
        onKeyDown={list.onKeyDown}
      />
      {!query && !open && <kbd className="bar-search-key" aria-hidden>/</kbd>}
      {results.length > 0 && (
        <Listbox box={list} items={results} label={t.cardSearch.results} className="project-card-search" itemKey={(item) => item.id}>
          {(item) => <CardFace item={item} size="xs" />}
        </Listbox>
      )}
    </div>
  );
}
