// The emoji picker (shadcn's emoji-picker from frimousse's registry, ours from then on): a search
// field, a tab per category that jumps to it in the list and follows the scroll, every emoji of the
// browser's Emoji version by category in a virtualized list, the skin tone, and a footer naming the emoji under the pointer or the arrow keys. Arrow keys move from the search
// field through the list, Enter picks. The data is Emojibase's, served by Seismic itself at
// `/emojibase/<locale>/` (so the picker needs no network), and cached by frimousse in localStorage.
// `value` marks the emoji chosen already.

import { cn } from 'cn';
import { type EmojiPickerListCategoryHeaderProps, type EmojiPickerListEmojiProps, type EmojiPickerListRowProps, EmojiPicker as EmojiPickerPrimitive } from 'frimousse';
import { BikeIcon, FlagIcon, HashIcon, LeafIcon, LightbulbIcon, LoaderIcon, type LucideIcon, PizzaIcon, PlaneIcon, SearchIcon, SmileIcon, UserIcon } from 'lucide-react';
import { type ComponentProps, createContext, type RefObject, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../strings';
import { inputFieldClassName } from './input';
import { Tabs, TabsList, TabsTrigger } from './tabs';
import { Tooltip } from './tooltip';

/** Emojibase's groups the picker lists (all but the skin-tone components), each with the label its data gives it and the icon of its tab. */
const CATEGORIES: { key: keyof typeof t.canvases.emojiCategories; label: string; Icon: LucideIcon }[] = [
  { key: 'smileys', label: 'Smileys & emotion', Icon: SmileIcon },
  { key: 'people', label: 'People & body', Icon: UserIcon },
  { key: 'nature', label: 'Animals & nature', Icon: LeafIcon },
  { key: 'food', label: 'Food & drink', Icon: PizzaIcon },
  { key: 'travel', label: 'Travel & places', Icon: PlaneIcon },
  { key: 'activities', label: 'Activities', Icon: BikeIcon },
  { key: 'objects', label: 'Objects', Icon: LightbulbIcon },
  { key: 'symbols', label: 'Symbols', Icon: HashIcon },
  { key: 'flags', label: 'Flags', Icon: FlagIcon },
];

/** An emoji button's width (`size-9`), and the padding of a row (`px-1`). */
const CELL = 36;
const ROW_PADDING = 8;

/** How many emoji a row holds in a picker `width` wide: as many as fit, from 5 to 14. */
export const columnsFor = (width: number) => Math.max(5, Math.min(14, Math.floor((width - ROW_PADDING) / CELL)));

/** Where the picker loads Emojibase's data from: `${EMOJIBASE_URL}/en/data.json`. */
export const EMOJIBASE_URL = '/emojibase';

const Chosen = createContext<string | undefined>(undefined);

function EmojiPickerRow({ children, ...props }: EmojiPickerListRowProps) {
  return (
    <div {...props} className="scroll-my-1 px-1" data-slot="emoji-picker-row">
      {children}
    </div>
  );
}

function EmojiPickerEmoji({ emoji, className, ...props }: EmojiPickerListEmojiProps) {
  const chosen = useContext(Chosen) === emoji.emoji;
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const el = button.current;
    const viewport = el?.closest('[data-slot=emoji-picker-viewport]');
    // In the short dialog the form scrolls instead of Frimousse's viewport. Keep arrow-key
    // navigation visible there too; Frimousse normally scrolls only its own viewport.
    if (emoji.isActive && el && viewport && getComputedStyle(viewport).overflowY === 'visible') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [emoji.isActive]);
  return (
    <button
      ref={button}
      type="button"
      {...props}
      aria-pressed={chosen}
      className={cn(
        'flex size-9 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-transparent p-0 text-xl leading-none data-[active]:bg-muted',
        chosen && 'border-foreground bg-muted',
        className,
      )}
      data-slot="emoji-picker-emoji"
    >
      {emoji.emoji}
    </button>
  );
}

function EmojiPickerCategoryHeader({ category, ...props }: EmojiPickerListCategoryHeaderProps) {
  return (
    <div {...props} className="bg-surface px-1 pb-1.5 pt-3 text-xs font-semibold leading-none text-muted-foreground" data-slot="emoji-picker-category-header" data-category={category.label}>
      {category.label}
    </div>
  );
}

/** Where category `label`'s block starts in the list: its header's box, absolutely placed by frimousse. */
const blockOf = (root: HTMLElement, label: string) => root.querySelector(`[data-category="${CSS.escape(label)}"]`)?.closest<HTMLElement>('[frimousse-category]') ?? null;

/** The category whose block the list shows at its top, of those it lists now. */
function categoryAtTop(root: HTMLElement, viewport: HTMLElement): string | undefined {
  const top = viewport.getBoundingClientRect().top;
  let at: string | undefined;
  for (const c of CATEGORIES) {
    const block = blockOf(root, c.label);
    if (block && block.getBoundingClientRect().top - top <= 4) at = c.label;
  }
  return at;
}

/**
 * The tabs over the list, one per category: a click shows the category from its start (out of a
 * search, which it ends, when the category has nothing found); the one the list shows at its top is
 * the tab selected.
 */
function EmojiCategoryTabs({ root, viewport, at, search, onSearch }: { root: RefObject<HTMLDivElement | null>; viewport: RefObject<HTMLDivElement | null>; at: string | undefined; search: string; onSearch: (search: string) => void }) {
  const jump = (label: string) => {
    const go = () => {
      const r = root.current;
      const v = viewport.current;
      const block = r && blockOf(r, label);
      if (!v || !block) return;
      // a short window grows the list to its full height: what scrolls then is the dialog around it
      if (getComputedStyle(v).overflowY === 'visible') block.scrollIntoView({ block: 'start' });
      else v.scrollTo({ top: block.getBoundingClientRect().top - v.getBoundingClientRect().top + v.scrollTop });
    };
    if (!search || (root.current && blockOf(root.current, label))) return go();
    onSearch('');
    // frimousse lists everything again once it is idle (within 100 ms)
    setTimeout(go, 150);
  };
  return (
    <Tabs value={at ?? ''} onValueChange={jump} activationMode="manual" className="mt-1.5 shrink-0">
      <TabsList variant="underline" className="flex-nowrap justify-between gap-x-0" aria-label={t.canvases.emojiCategory}>
        {/* the tooltip's trigger takes over `data-state`: the tab selected shows by `aria-selected` */}
        {CATEGORIES.map((c) => (
          <Tooltip key={c.key} content={t.canvases.emojiCategories[c.key]}>
            <TabsTrigger value={c.label} className="grid flex-1 place-items-center py-1.5 aria-selected:border-waiting aria-selected:text-foreground" aria-label={t.canvases.emojiCategories[c.key]}>
              <c.Icon size={16} strokeWidth={2} aria-hidden />
            </TabsTrigger>
          </Tooltip>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** The picker: `onEmojiSelect` gets the emoji picked, `value` is the one chosen already, `search` and `onSearch` hold what is typed into its field. */
export function EmojiPicker({
  className,
  value,
  search,
  onSearch,
  ...props
}: Omit<ComponentProps<typeof EmojiPickerPrimitive.Root>, 'emojibaseUrl' | 'columns'> & { value?: string; search: string; onSearch: (search: string) => void }) {
  // the rows hold as many emoji as the picker's width does, so none lie beyond its edge on a narrow screen
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(14);
  const [at, setAt] = useState<string>();
  const follow = () => {
    if (root.current && viewport.current) setAt(categoryAtTop(root.current, viewport.current));
  };
  // what is found starts at another category; frimousse lists it once it is idle (within 100 ms)
  useEffect(() => {
    const later = setTimeout(follow, 150);
    return () => clearTimeout(later);
  }, [search]);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const fit = () => setColumns(columnsFor(el.clientWidth));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return (
    <Chosen.Provider value={value}>
      <EmojiPickerPrimitive.Root ref={root} className={cn('isolate flex min-h-0 flex-col', className)} data-slot="emoji-picker" emojibaseUrl={EMOJIBASE_URL} columns={columns} {...props}>
        <div className={cn(inputFieldClassName, 'flex items-center gap-2 focus-within:border-muted-foreground focus-within:bg-surface')} data-slot="emoji-picker-search-wrapper">
          <SearchIcon className="size-4 shrink-0 opacity-50" aria-hidden />
          <EmojiPickerPrimitive.Search
            className="m-0 w-full bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground/80"
            data-slot="emoji-picker-search"
            placeholder={t.canvases.searchEmojis}
            aria-label={t.canvases.searchEmojis}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        <EmojiCategoryTabs root={root} viewport={viewport} at={at ?? (search ? undefined : CATEGORIES[0]!.label)} search={search} onSearch={onSearch} />
        <EmojiPickerPrimitive.Viewport ref={viewport} className="relative mt-1.5 min-h-0 flex-1 outline-none" data-slot="emoji-picker-viewport" onScroll={follow}>
          <EmojiPickerPrimitive.Loading className="absolute inset-0 flex items-center justify-center text-muted-foreground" data-slot="emoji-picker-loading">
            <LoaderIcon className="size-4 animate-spin" />
          </EmojiPickerPrimitive.Loading>
          <EmojiPickerPrimitive.Empty className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground" data-slot="emoji-picker-empty">
            {t.canvases.noEmoji}
          </EmojiPickerPrimitive.Empty>
          <EmojiPickerPrimitive.List
            className="select-none pb-1"
            components={{ Row: EmojiPickerRow, Emoji: EmojiPickerEmoji, CategoryHeader: EmojiPickerCategoryHeader }}
            data-slot="emoji-picker-list"
          />
        </EmojiPickerPrimitive.Viewport>
        <div className="flex min-w-0 items-center gap-2 border-t border-border pt-2" data-slot="emoji-picker-footer">
          <EmojiPickerPrimitive.ActiveEmoji>
            {({ emoji }) =>
              emoji ? (
                <>
                  <span className="flex size-7 flex-none items-center justify-center text-lg">{emoji.emoji}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{emoji.label}</span>
                </>
              ) : (
                <span className="flex h-7 min-w-0 flex-1 items-center truncate text-xs text-muted-foreground">{t.canvases.pickEmoji}</span>
              )
            }
          </EmojiPickerPrimitive.ActiveEmoji>
          <EmojiPickerPrimitive.SkinToneSelector
            type="button"
            className="flex size-7 flex-none cursor-pointer items-center justify-center rounded-lg bg-transparent p-0 text-lg hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none"
            aria-label={t.canvases.skinTone}
            title={t.canvases.skinTone}
          />
        </div>
      </EmojiPickerPrimitive.Root>
    </Chosen.Provider>
  );
}
