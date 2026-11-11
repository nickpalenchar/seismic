// The emoji picker (shadcn's emoji-picker from frimousse's registry, ours from then on): a search
// field, every emoji of the browser's Emoji version by category in a virtualized list, the skin tone,
// and a footer naming the emoji under the pointer or the arrow keys. Arrow keys move from the search
// field through the list, Enter picks. The data is Emojibase's, served by Seismic itself at
// `/emojibase/<locale>/` (so the picker needs no network), and cached by frimousse in localStorage.
// `value` marks the emoji chosen already.

import { cn } from 'cn';
import { type EmojiPickerListCategoryHeaderProps, type EmojiPickerListEmojiProps, type EmojiPickerListRowProps, EmojiPicker as EmojiPickerPrimitive } from 'frimousse';
import { LoaderIcon, SearchIcon } from 'lucide-react';
import { type ComponentProps, createContext, useContext } from 'react';
import { t } from '../strings';
import { inputFieldClassName } from './input';

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
  return (
    <button
      type="button"
      {...props}
      aria-pressed={chosen}
      className={cn(
        'flex size-9 cursor-pointer items-center justify-center rounded-lg border border-solid border-transparent bg-transparent p-0 text-[21px] leading-none data-[active]:bg-chip',
        chosen && 'border-ink bg-chip',
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
    <div {...props} className="bg-panel px-1 pb-1.5 pt-3 text-xs font-semibold leading-none text-muted-foreground" data-slot="emoji-picker-category-header">
      {category.label}
    </div>
  );
}

/** The picker: `onEmojiSelect` gets the emoji picked, `value` is the one chosen already, `search` and `onSearch` hold what is typed into its field. */
export function EmojiPicker({
  className,
  value,
  search,
  onSearch,
  ...props
}: Omit<ComponentProps<typeof EmojiPickerPrimitive.Root>, 'emojibaseUrl'> & { value?: string; search: string; onSearch: (search: string) => void }) {
  return (
    <Chosen.Provider value={value}>
      <EmojiPickerPrimitive.Root className={cn('isolate flex min-h-0 flex-col', className)} data-slot="emoji-picker" emojibaseUrl={EMOJIBASE_URL} columns={14} {...props}>
        <div className={cn(inputFieldClassName, 'flex items-center gap-2 focus-within:border-muted-foreground focus-within:bg-panel')} data-slot="emoji-picker-search-wrapper">
          <SearchIcon className="size-4 shrink-0 opacity-50" aria-hidden />
          <EmojiPickerPrimitive.Search
            className="m-0 w-full border-0 bg-transparent p-0 text-[13px] text-ink outline-none placeholder:text-muted-foreground/80"
            data-slot="emoji-picker-search"
            placeholder={t.canvases.searchEmojis}
            aria-label={t.canvases.searchEmojis}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        <EmojiPickerPrimitive.Viewport className="relative mt-1.5 min-h-0 flex-1 outline-none" data-slot="emoji-picker-viewport">
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
        <div className="flex min-w-0 items-center gap-2 border-0 border-t border-solid border-line pt-2" data-slot="emoji-picker-footer">
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
            className="flex size-7 flex-none cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 text-lg hover:bg-chip focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none"
            aria-label={t.canvases.skinTone}
            title={t.canvases.skinTone}
          />
        </div>
      </EmojiPickerPrimitive.Root>
    </Chosen.Provider>
  );
}
