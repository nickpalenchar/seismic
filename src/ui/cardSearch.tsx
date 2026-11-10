import { Search } from 'lucide-react';
import { type Ref, useEffect, useRef, useState } from 'react';
import type { Item } from '../core/types';
import { CardFace } from './card';
import { matchingCards } from './cardRefs';
import { cn } from 'cn';
import { Command, CommandInput, CommandItem, CommandList } from './components/command';
import { Popover, PopoverAnchor, PopoverContent } from './components/popover';
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
  // an unfolded card covers what the finder would open
  useEffect(() => void (hidden && open && close()), [hidden]);
  const pick = (item: Item) => {
    close();
    onOpen(item);
  };
  return (
    <Command ref={box} shouldFilter={false} loop label={t.cardSearch.results} className={cn('relative min-w-0', hidden && 'invisible')} onKeyDown={(e) => open && e.key === 'Escape' && (e.stopPropagation(), close())}>
      <Popover open={open && results.length > 0} onOpenChange={(on) => on || close()}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" size={15} strokeWidth={2} aria-hidden />
            <CommandInput
              ref={field}
              icon={false}
              wrapperClassName="block"
              className="h-[34px] rounded-[17px] border-line bg-card py-0 pr-8 pl-[34px] text-sm shadow-none focus:bg-card in-data-[fit~='3']:pr-2"
              value={query}
              onValueChange={(v) => (setQuery(v), setOpen(true))}
              placeholder={t.cardSearch.placeholder}
              aria-label={t.cardSearch.shortcut}
              title={t.cardSearch.shortcut}
              spellCheck={false}
              onFocus={() => {
                if (!open) closeBarMenus();
                setOpen(true);
              }}
            />
            {!query && !open && <kbd className="pointer-events-none absolute top-1/2 right-2.5 grid h-5 min-w-[18px] -translate-y-1/2 place-items-center rounded-[3px] border border-line px-[5px] font-mono text-xs text-muted-foreground in-data-[fit~='3']:hidden" aria-hidden>/</kbd>}
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="center"
          sideOffset={8}
          className="max-h-[min(420px,55vh)] w-[max(var(--radix-popover-trigger-width),min(520px,calc(100vw-28px)))] rounded p-2"
          // the field keeps the focus; a press in it is no click outside
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => box.current?.contains(e.target as Node) && e.preventDefault()}
        >
          <CommandList className="max-h-none">
            {results.map((item) => (
              <CommandItem key={item.id} value={item.id} className="px-2.5 py-[7px]" onSelect={() => pick(item)}>
                <CardFace item={item} size="xs" />
              </CommandItem>
            ))}
          </CommandList>
        </PopoverContent>
      </Popover>
    </Command>
  );
}
