import { Search } from 'lucide-react';
import { type Ref, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Item } from '../core/types';
import { CardFace } from './card';
import { matchingCards } from './cardRefs';
import { closeBarMenus } from './queue';
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
  const [selected, setSelected] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const results = open ? finderResults(items, query) : [];
  const active = results[Math.min(selected, results.length - 1)];
  useEffect(() => setSelected(0), [query]);
  useLayoutEffect(() => {
    list.current?.children[Math.min(selected, results.length - 1)]?.scrollIntoView({ block: 'nearest' });
  }, [selected, query, results.length]);
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
  return (
    <div className={hidden ? 'bar-search hidden' : 'bar-search'} ref={box}>
      <Search className="bar-search-icon" size={15} strokeWidth={2} aria-hidden />
      <input
        ref={field}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        data-esc
        value={query}
        placeholder={t.cardSearch.placeholder}
        aria-label={t.cardSearch.shortcut}
        title={t.cardSearch.shortcut}
        spellCheck={false}
        aria-controls={results.length ? 'project-card-search-results' : undefined}
        aria-expanded={results.length > 0}
        aria-activedescendant={active ? `project-card-search-option-${active.id}` : undefined}
        onFocus={() => {
          if (!open) closeBarMenus();
          setOpen(true);
        }}
        onChange={(e) => (setQuery(e.target.value), setOpen(true))}
        onKeyDown={(e) => {
          // Enter and arrows belong to the IME's candidate list while composing (Safari reports the confirming Enter as keyCode 229).
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (results.length) setSelected((n) => (n + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (results.length) pick(results[Math.min(selected, results.length - 1)]!);
          }
        }}
      />
      {!query && !open && <kbd className="bar-search-key" aria-hidden>/</kbd>}
      {results.length > 0 && (
        <ul ref={list} className="project-card-search" id="project-card-search-results" role="listbox" aria-label={t.cardSearch.results}>
          {results.map((item, index) => (
            <li key={item.id} id={`project-card-search-option-${item.id}`} role="option" aria-selected={index === selected} className={index === selected ? 'on' : undefined} onMouseEnter={() => setSelected(index)} onClick={() => pick(item)}>
              <CardFace item={item} size="xs" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
