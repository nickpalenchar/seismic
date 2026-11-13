// The phone's search over the cards of the project in view: a full-screen page with its field at
// the top, the matching cards as faces below it, and an X that closes it. The same matching as the
// desktop's finder (`finderResults`: titles and short codes), without its popover.

import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Item } from '../core/types';
import { cn } from 'cn';
import { CardFace } from './card';
import { finderResults } from './cardSearch';
import { Command, CommandInput, CommandItem, CommandList } from './components/command';
import { barClass, viewClass } from './phoneEnvironment';
import { t } from './strings';

/** How many matches the page lists before "Load more", and how many more each tap brings. */
const PAGE = 20;

export function PhoneSearch({ items, query, onQuery, onOpen, onClose }: { items: Item[]; query: string; onQuery: (q: string) => void; onOpen: (i: Item) => void; onClose: () => void }) {
  const [shown, setShown] = useState(PAGE);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  useEffect(() => setShown(PAGE), [query]);
  const found = query.trim() ? finderResults(items, query) : [];
  return (
    <Command shouldFilter={false} loop label={t.cardSearch.results} className={cn(viewClass, 'ph-search inset-0 z-40 overflow-hidden bg-background')}>
      <header className={cn(barClass, 'ph-search-bar py-1.5 ph-landscape:py-[3px]')}>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" size={17} strokeWidth={2} aria-hidden />
          <CommandInput
            ref={field}
            icon={false}
            wrapperClassName="block"
            className="h-10 rounded-[20px] border-line bg-card py-0 pr-3 pl-[38px] shadow-none focus:bg-card"
            value={query}
            onValueChange={onQuery}
            placeholder={t.cardSearch.placeholder}
            aria-label={t.phone.next.search}
            spellCheck={false}
            enterKeyHint="search"
          />
        </div>
        <button className="ph-close inline-grid size-10 shrink-0 place-items-center rounded-full border-0 bg-chip text-ink cursor-pointer ph-landscape:size-9" aria-label={t.phone.next.closeSearch} onClick={onClose}>
          <X size={20} strokeWidth={2.25} aria-hidden="true" />
        </button>
      </header>
      <CommandList className="min-h-0 max-h-none flex-1 pt-3 pb-[calc(24px+env(safe-area-inset-bottom))]">
        {!query.trim() ? (
          <p className="hint mt-6 text-center">{t.phone.next.searchEmpty}</p>
        ) : !found.length ? (
          <p className="hint mt-6 text-center">{t.phone.next.noMatch}</p>
        ) : (
          <>
            {found.slice(0, shown).map((item) => (
              <CommandItem key={item.id} value={item.id} className="mb-2.5 block p-0" onSelect={() => onOpen(item)}>
                <CardFace item={item} size="xs" />
              </CommandItem>
            ))}
            {found.length > shown && (
              <button className="mt-1 w-full rounded-[10px] border border-line bg-transparent py-2.5 text-[15px] text-ink cursor-pointer" onClick={() => setShown(shown + PAGE)}>
                {t.phone.next.loadMore(found.length - shown)}
              </button>
            )}
          </>
        )}
      </CommandList>
    </Command>
  );
}
