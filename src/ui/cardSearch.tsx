import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Item } from '../core/types';
import { CardFace } from './card';
import { matchingCards } from './cardRefs';
import { t } from './strings';

/** The project's quick card finder. It shares the task field's title and short-code matching; a result is a card's face at size XS. */
export function CardSearch({ items, onOpen, onClose }: { items: Item[]; onOpen: (item: Item) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // A card absorbed by a merge has no project element to unfold from.
  const results = matchingCards(items.filter((item) => !item.mergingInto), query, undefined, Infinity);
  const active = results[Math.min(selected, results.length - 1)];
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setSelected(0), [query]);
  useLayoutEffect(() => {
    list.current?.children[Math.min(selected, results.length - 1)]?.scrollIntoView({ block: 'nearest' });
  }, [selected, query, results.length]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.project-card-search, .card-search-button')) onClose();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [onClose]);
  const pick = (item: Item) => { onClose(); onOpen(item); };
  return <div className="project-card-search">
    <input ref={input} type="search" role="combobox" aria-autocomplete="list" data-esc value={query} placeholder={t.cardSearch.placeholder} aria-label={t.cardSearch.placeholder}
      aria-controls={results.length ? 'project-card-search-results' : undefined} aria-expanded={results.length > 0}
      aria-activedescendant={active ? `project-card-search-option-${active.id}` : undefined}
      onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => {
        // Enter and arrows belong to the IME's candidate list while composing (Safari reports the confirming Enter as keyCode 229).
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (results.length) setSelected((n) => (n + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (results.length) pick(results[Math.min(selected, results.length - 1)]!);
        }
      }} />
    {results.length > 0 && <ul ref={list} id="project-card-search-results" role="listbox" aria-label={t.cardSearch.results}>
      {results.map((item, index) => <li key={item.id} id={`project-card-search-option-${item.id}`} role="option" aria-selected={index === selected} className={index === selected ? 'on' : undefined}
        onMouseEnter={() => setSelected(index)} onClick={() => pick(item)}>
        <CardFace item={item} size="xs" />
      </li>)}
    </ul>}
  </div>;
}
