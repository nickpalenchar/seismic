



import { cn } from 'cn';
import type { ReactNode } from 'react';
import { CANVAS_ICON_COLORS, CANVAS_LUCIDE_ICONS, type CanvasIconColor, lucideIcon, lucideIconValue } from '../core/canvas-icons';
import { lucideOf } from './canvasIcon';
import { t } from './strings';
import { Button } from './components/button';
import { EmojiPicker } from './components/emoji-picker';
import { Input } from './components/input';
import { Radio, RadioGroup } from './components/radio';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/tabs';
import { Tooltip } from './components/tooltip';


export interface IconPickerView {
  tab?: 'emoji' | 'icons';
  color?: CanvasIconColor | null;
  emojiSearch?: string;
  iconSearch?: string;
}


export type IconPickerChange = Partial<IconPickerView> & { icon?: string | null };

export const pickerLabel = 'text-xs font-semibold text-muted-foreground';
const colorChoice = 'grid size-7 cursor-pointer place-items-center rounded-full border border-transparent bg-transparent p-0 hover:bg-muted data-[state=checked]:border-foreground';
const swatch = 'block size-[18px] rounded-full';
const iconChoice = 'grid h-10 cursor-pointer place-items-center rounded-md border border-transparent bg-transparent p-0 text-foreground hover:bg-muted data-[state=checked]:border-foreground data-[state=checked]:bg-muted';


const TEXT_COLOR = '\0text';

/** The curated Lucide icons whose name holds every word of `search`. */
export const iconsMatching = (search: string) => {
  const words = search.toLowerCase().split(/[\s-]+/).filter(Boolean);
  return CANVAS_LUCIDE_ICONS.filter((n) => words.every((w) => n.includes(w)));
};

/**
 * The picker: `icon` is the one chosen (null: none), `view` what it shows; `onChange` gets each change.
 * `panelClassName` sizes the tabs' panels: their lists scroll inside them, the one scrollbar there
 * is. A container that scrolls as a whole instead (the canvas dialog in a short window) lets the
 * lists grow to their full height itself (`data-slot` `icon-grid`, `emoji-picker-viewport`).
 */
export function IconPicker({ icon, view, onChange, className, panelClassName }: { icon: string | null; view: IconPickerView; onChange: (c: IconPickerChange) => void; className?: string; panelClassName: string }) {
  const lucide = lucideIcon(icon ?? undefined);
  const color = view.color !== undefined ? view.color : (lucide?.color ?? null);
  const tab = view.tab ?? (icon && !lucide ? 'emoji' : 'icons');
  const pickColor = (c: CanvasIconColor | null) => onChange({ color: c, ...(lucide ? { icon: lucideIconValue(lucide.name, c) } : {}) });
  const matching = iconsMatching(view.iconSearch ?? '');
  const panel = cn('flex min-h-0 flex-col [&[hidden]]:hidden', panelClassName);
  const choice = (value: string, label: string, mark: ReactNode, className = iconChoice) => (
    <Tooltip key={value} content={label}>
      <Radio value={value} className={className} aria-label={label}>
        {mark}
      </Radio>
    </Tooltip>
  );
  return (
    <Tabs className={cn('flex min-h-0 flex-col', className)} value={tab} onValueChange={(v) => onChange({ tab: v as IconPickerView['tab'] })}>
      <div className="mb-2 flex shrink-0 items-center gap-2.5">
        <span className={cn(pickerLabel, 'mr-1')}>{t.canvases.icon}</span>
        <TabsList variant="segmented" aria-label={t.canvases.icon}>
          <TabsTrigger value="icons">{t.canvases.icons}</TabsTrigger>
          <TabsTrigger value="emoji">{t.canvases.emojis}</TabsTrigger>
        </TabsList>
        <Button type="button" size="small" variant="ghost" className="ml-auto text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground aria-pressed:opacity-100" aria-pressed={!icon} disabled={!icon} onClick={() => onChange({ icon: null })}>
          {t.canvases.noIcon}
        </Button>
      </div>
      <TabsContent value="icons" className={panel}>
        <div className="mb-2 shrink-0">
          <Input
            className="w-full"
            value={view.iconSearch ?? ''}
            placeholder={t.canvases.searchIcons}
            aria-label={t.canvases.searchIcons}
            onChange={(e) => onChange({ iconSearch: e.target.value })}
          />
        </div>
        <RadioGroup className="mb-2 flex shrink-0 flex-wrap gap-1" label={t.canvases.color} value={color ?? TEXT_COLOR} onValueChange={(v) => pickColor(v === TEXT_COLOR ? null : (v as CanvasIconColor))}>
          {choice(TEXT_COLOR, t.canvases.defaultColor, <span className={cn(swatch, 'bg-foreground')} />, colorChoice)}
          {(Object.keys(CANVAS_ICON_COLORS) as CanvasIconColor[]).map((c) =>
            choice(c, t.canvases.colors[c], <span className={swatch} style={{ background: CANVAS_ICON_COLORS[c] }} />, colorChoice),
          )}
        </RadioGroup>
        <RadioGroup data-slot="icon-grid" className="-mx-1 grid min-h-0 flex-1 auto-rows-[40px] grid-cols-[repeat(auto-fill,minmax(40px,1fr))] content-start gap-1 overflow-auto px-1" label={t.canvases.icons} value={lucide?.name ?? ''} onValueChange={(n) => onChange({ icon: lucideIconValue(n, color) })}>
          {matching.map((n) => {
            const L = lucideOf(`lucide:${n}`)!.Icon;
            return choice(n, n.replace(/-/g, ' '), <L size={20} strokeWidth={2} style={color ? { color: CANVAS_ICON_COLORS[color] } : undefined} aria-hidden />);
          })}
        </RadioGroup>
        {!matching.length && <p className="mx-0 my-6 text-center text-sm text-muted-foreground">{t.canvases.noIconFound}</p>}
      </TabsContent>
      <TabsContent value="emoji" className={panel}>
        <EmojiPicker
          className="h-full"
          value={icon && !lucide ? icon : undefined}
          search={view.emojiSearch ?? ''}
          onSearch={(emojiSearch) => onChange({ emojiSearch })}
          onEmojiSelect={({ emoji }) => onChange({ icon: emoji })}
        />
      </TabsContent>
    </Tabs>
  );
}
