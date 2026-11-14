// The project's canvases in the page: the tab strip at the bottom right and the drawer it slides
// out (switching, waiting counts, rename, icon, order, delete, "+ New canvas"), the dialog that names
// a canvas and picks its icon, a card's "Move to canvas" menu, and the stubs of waits whose other
// card lies on another canvas.

import { createContext, type PointerEvent as ReactPointerEvent, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { cn } from 'cn';
import { Car, Clock, GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { CANVAS_ICON_COLORS, CANVAS_LUCIDE_ICONS, type CanvasIconColor, lucideIcon, lucideIconValue } from '../core/canvas-icons';
import type { Bounds } from '../core/layout';
import { type Canvas, CANVAS_NAME_MAX, canvasNameProblem, type Item, MAIN_CANVAS, parkable, parkableStopping, inParkingLot, offCanvas } from '../core/types';
import { api } from './api';
import { CanvasIcon, canvasText, lucideOf } from './canvasIcon';
import { depLineClass } from './depsClasses';
import { ballClass, captionClass, haloClass, radialClass, ringBackClass, tagClass } from './ringClasses';
import { know, known } from './known';
import { loptClass, prioBtnClass, prioMenuClass, prioPickClass } from './labelClasses';
import { plain } from './markdown';
import { useSortable } from './sortable';
import { useStoredState } from './stored';
import { failText, t } from './strings';
import { Button, CloseButton } from './components/button';
import { ConfirmDialog, Dialog, DialogContent, DialogTitle } from './components/dialog';
import { leaveMenu, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from './components/menu';
import { Popover, PopoverAnchor, PopoverContent } from './components/popover';
import { Radio, RadioGroup } from './components/radio';
import { EmojiPicker } from './components/emoji-picker';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/tabs';
import { Tooltip } from './components/tooltip';
import { Input } from './components/input';

/** What the page knows of the project's canvases, for what shows a card (its menu, search). */
export interface CanvasesView {
  canvases: Canvas[];
  /** The canvas shown. */
  shown?: string;
  /** Puts the card on another canvas. */
  move: (card: Item, to: Canvas) => void;
}

export const Canvases = createContext<CanvasesView>({ canvases: [], move: () => {} });

/** The canvas a card is on (one the server has not placed yet counts as on the first). */
export const canvasOf = (canvases: Canvas[], i: Pick<Item, 'canvas'>) => canvases.find((c) => c.id === i.canvas) ?? canvases[0];

/** Set once the owner has made a canvas or opened the drawer: the "+" stops naming what it does. */
const KNOWN = 'seismic-canvases-known';

/** How long the drawer stays out after the pointer left it, so a path across its edge does not close it. */
const LEAVE_MS = 260;

/**
 * The tab strip at the bottom right: each canvas's icon, the one shown as a wider tab with its name,
 * and a "+"; with one canvas only the "+", which names itself until it has been used. The pointer on
 * the strip (a tap on touch, ↑ from the keyboard) slides out the drawer above it, which lists the
 * canvases by name with the cards waiting on each, and ends with "+ New canvas".
 */
export function CanvasTabs({ project, canvases, shown, waiting, empty, onShow }: {
  project: string;
  canvases: Canvas[];
  shown?: string;
  /** Per canvas, how many of its cards wait for the owner. */
  waiting: Record<string, number>;
  /** The canvases without cards, which can be deleted (but `main`). */
  empty: Set<string>;
  onShow: (c: Canvas) => void;
}) {
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState<{ edit?: string } | null>(null);
  const [isKnown, setKnown] = useState(() => known(KNOWN));
  const leave = useRef<ReturnType<typeof setTimeout>>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const several = canvases.length > 1;
  const learn = () => {
    if (isKnown) return;
    know(KNOWN);
    setKnown(true);
  };
  // ↑ from the strip moves the focus into the drawer; opened by the pointer or by keyboard focus on the strip, it leaves the focus where it was
  const byKey = useRef(false);
  // Restore only for an explicit dismissal/selection, never after focus leaves or a dialog opens.
  const restoreFocus = useRef(false);
  // the keyboard is on the strip: the drawer says how to reach it
  const [keyed, setKeyed] = useState(false);
  const open = (on: boolean, key = false, restore = false) => {
    restoreFocus.current = !on && restore;
    clearTimeout(leave.current);
    if (on && several) learn();
    if (on) byKey.current = key;
    else setKeyed(false);
    setDrawer(on && several);
  };
  const inDrawer = (n: unknown) => n instanceof Element && !!n.closest('#canvas-drawer');
  // the focus coming back from the drawer to its tab does not open the drawer again
  const back = useRef(false);
  useEffect(() => () => clearTimeout(leave.current), []);
  const startNew = () => {
    learn();
    open(false);
    setDialog({});
  };
  const pick = (c: Canvas) => {
    open(false, false, byKey.current);
    onShow(c);
  };
  const editing = dialog?.edit ? canvases.find((c) => c.id === dialog.edit) : undefined;
  const hover = {
    onPointerEnter: (e: ReactPointerEvent) => e.pointerType === 'mouse' && open(true),
    onPointerLeave: (e: ReactPointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(leave.current);
      leave.current = setTimeout(() => open(false), LEAVE_MS);
    },
  };
  return (
    <Popover open={drawer} onOpenChange={(on) => open(on, false, restoreFocus.current)}>
      <PopoverAnchor asChild>
        <div
          id="canvas-tabs"
          ref={box}
          className={cn('fixed right-[calc(var(--side,0px)+14px)] bottom-11 z-22 flex flex-col items-end gap-1.5 [transition:right_.45s_cubic-bezier(.3,.9,.3,1)]', drawer && 'out')}
          {...hover}
          // keyboard focus on the strip shows the drawer as the pointer does; ↑ moves into it
          onFocus={(e) => {
            if (back.current) return void (back.current = false);
            if (!several || !e.target.matches(':focus-visible')) return;
            setKeyed(true);
            open(true);
          }}
          onBlur={(e) => {
            if (!box.current?.contains(e.relatedTarget as Node) && !inDrawer(e.relatedTarget)) open(false);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowUp' || !several) return;
            e.preventDefault();
            if (!drawer) return open(true, true);
            byKey.current = true;
            document.querySelector<HTMLElement>('#canvas-drawer button')?.focus();
          }}
        >
          {/* a tab picks its canvas by its own click, which tells a finger's first tap from the rest; Enter and Space click, the arrow keys move focus */}
          <Tabs value={shown ?? ''} onValueChange={() => {}} activationMode="manual" className="contents">
            <TabsList className="flex items-center gap-0.5 rounded-[999px] border border-glass-edge bg-card px-[3px] py-[2px] shadow-[inset_0_1px_0_var(--glass-hi),var(--shadow)] backdrop-blur-[12px] backdrop-saturate-[1.4]" aria-label={t.canvases.strip}>
              {several &&
                canvases.map((c) => (
                  <TabsTrigger
                    key={c.id}
                    value={c.id}
                    aria-controls="world"
                    className={ctabClass(c.id === shown ? 'on' : 'off')}
                    title={c.name}
                    onClick={(e) => {
                      // a finger has no hover: its first tap brings the drawer, where the canvas is picked by name
                      if ((e.nativeEvent as PointerEvent).pointerType === 'touch' && !drawer) return open(true);
                      pick(c);
                    }}
                  >
                    <CanvasIcon canvas={c} />
                    {c.id === shown && <span className={ctabName}>{c.name}</span>}
                    {c.id !== shown && !!waiting[c.id] && <span className="absolute -top-[5px] -right-[5px] box-border h-4 min-w-4 rounded-[999px] bg-waiting px-1 text-center text-[10px] leading-4 font-bold text-waiting-foreground" title={t.canvases.waiting(waiting[c.id]!)}>{waiting[c.id]}</span>}
                  </TabsTrigger>
                ))}
              <Tooltip content={t.canvases.newCanvas}>
                <button className={ctabClass(isKnown || several ? 'off' : 'named')} aria-label={t.canvases.newCanvas} onClick={startNew}>
                  <Plus size={14} strokeWidth={2.4} aria-hidden />
                  {!isKnown && !several && <span className={ctabName}>{t.canvases.newCanvas}</span>}
                </button>
              </Tooltip>
            </TabsList>
          </Tabs>
        </div>
      </PopoverAnchor>
      <PopoverContent
        id="canvas-drawer"
        side="top"
        align="end"
        sideOffset={6}
        aria-label={t.canvases.strip}
        className="w-[260px] max-h-[min(60vh,520px)] origin-bottom-right animate-[drawer-out_.18s_cubic-bezier(.3,.9,.3,1)] p-1.5 text-sm"
        {...hover}
        // a press on the strip is no press beside the drawer: a tab picks its canvas, "+" makes one
        onInteractOutside={(e) => box.current?.contains(e.target as Node) && e.preventDefault()}
        onOpenAutoFocus={(e) => byKey.current || e.preventDefault()}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (!restoreFocus.current) return;
          restoreFocus.current = false;
          back.current = true;
          box.current?.querySelector<HTMLElement>('.ctab.on')?.focus();
        }}
        // This non-modal drawer follows the page's Tab order, rather than Radix's focus loop.
        onKeyDownCapture={(e) => { if (e.key === 'Tab') e.stopPropagation(); }}
        onEscapeKeyDown={() => { restoreFocus.current = byKey.current; }}
        onFocus={(e) => {
          if (e.target.matches(':focus-visible')) byKey.current = true;
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node) && !box.current?.contains(e.relatedTarget as Node)) open(false);
        }}
      >
        {keyed && <p className="hint m-0 px-2 pt-1 pb-1.5">{t.canvases.drawerKey}</p>}
        <Drawer canvases={canvases} shown={shown} waiting={waiting} empty={empty} onPick={pick} onEdit={(c) => (open(false), setDialog({ edit: c.id }))} onNew={startNew} />
      </PopoverContent>
      {dialog && (
        <CanvasDialog
          project={project}
          canvases={canvases}
          canvas={editing}
          onClose={() => setDialog(null)}
          onDone={(c) => {
            setDialog(null);
            // a new canvas is shown at once, as is the one shown under its new name
            if (!editing || editing.id === shown) onShow(c);
          }}
        />
      )}
    </Popover>
  );
}

/** A tab of the strip: the canvas shown (`on`, with its name), another one, or "+" (`named` while it still says "New canvas"). */
const ctabClass = (kind: 'on' | 'off' | 'named') =>
  cn(
    'ctab relative box-border inline-flex h-7 min-w-7 cursor-pointer items-center justify-center gap-1.5 rounded-[999px] border-0 bg-transparent px-[7px] py-0 text-[13px] text-muted-foreground hover:bg-muted',
    kind === 'on'
      ? 'on bg-foreground pr-[11px] pl-[9px] font-semibold text-background hover:bg-foreground [&_.letter]:bg-background/22 [&_.letter]:text-background'
      : kind === 'named'
        ? 'pr-[11px] pl-2 text-foreground'
        : 'hover:text-foreground',
  );
const ctabName = 'max-w-[180px] overflow-hidden leading-7 text-ellipsis whitespace-nowrap';

/** The drawer: the canvases in order, each with its waiting count, rename and icon, a grip to reorder, delete where it is empty; then "+ New canvas". */
function Drawer({ canvases, shown, waiting, empty, onPick, onEdit, onNew }: { canvases: Canvas[]; shown?: string; waiting: Record<string, number>; empty: Set<string>; onPick: (c: Canvas) => void; onEdit: (c: Canvas) => void; onNew: () => void }) {
  const [failed, setFailed] = useState<string>();
  const sort = useSortable(
    canvases.map((c) => c.id),
    {
      reach: (id) => {
        const n = canvases.findIndex((c) => c.id === id);
        return { earlier: n, later: canvases.length - 1 - n };
      },
      drop: (id, places) => {
        setFailed(undefined);
        const n = canvases.findIndex((c) => c.id === id);
        return api.updateCanvas(id, { position: n + places + 1 }).catch((err) => {
          setFailed(failText(err));
          throw err;
        });
      },
    },
  );
  const remove = (c: Canvas) => {
    setFailed(undefined);
    api.deleteCanvas(c.id).catch((err) => setFailed(failText(err)));
  };
  return (
    <>
      <ul className="m-0 list-none p-0">
        {sort.order.map((id) => {
          const c = canvases.find((x) => x.id === id)!;
          const n = waiting[c.id] ?? 0;
          return (
            <li key={c.id} {...sort.row(c.id)} className="group flex items-center gap-0.5 rounded-[6px] bg-surface hover:bg-muted data-[sorting=dragged]:bg-muted">
              <span className="grid h-[30px] w-4 flex-none cursor-grab touch-none place-items-center text-muted-foreground opacity-0 group-hover:opacity-80" title={t.canvases.grip} {...sort.grip(c.id)}>
                <GripVertical size={14} aria-hidden />
              </span>
              <button
                className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent pr-1.5 pl-0.5 text-left text-sm text-foreground outline-none focus-visible:underline"
                aria-current={c.id === shown || undefined}
                onClick={() => onPick(c)}
              >
                <CanvasIcon canvas={c} size={16} />
                <span className={cn('min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap', c.id === shown && 'font-bold')}>{c.name}</span>
                {n > 0 && (
                  <span className="box-border h-[18px] min-w-[18px] flex-none rounded-full bg-waiting px-[5px] text-center text-[11px] leading-[18px] font-bold text-waiting-foreground" title={t.canvases.waiting(n)}>
                    {n}
                  </span>
                )}
              </button>
              <span className="hidden flex-none gap-0.5 pr-1 group-focus-within:flex group-hover:flex">
                <Tooltip content={t.canvases.edit}>
                  <button className={tool} aria-label={t.canvases.edit} onClick={() => onEdit(c)}>
                    <Pencil size={13} aria-hidden />
                  </button>
                </Tooltip>
                {c.name !== MAIN_CANVAS && empty.has(c.id) && (
                  <Tooltip content={t.canvases.remove}>
                    <button className={tool} aria-label={t.canvases.remove} onClick={() => remove(c)}>
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </Tooltip>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {failed && <p className="mx-2 my-1 text-xs text-destructive">{failed}</p>}
      <button
        className="mt-1 flex h-[34px] w-full cursor-pointer items-center gap-2 rounded-b-[6px] border-0 border-t border-solid border-border bg-transparent pr-2 pl-[18px] text-sm font-semibold text-foreground outline-none hover:bg-muted focus-visible:bg-muted"
        onClick={onNew}
      >
        <Plus size={14} strokeWidth={2.4} aria-hidden /> {t.canvases.newCanvas}
      </button>
    </>
  );
}

/** A canvas's rename and delete in the drawer. */
const tool = 'grid size-[26px] cursor-pointer place-items-center rounded-[4px] border-0 bg-transparent text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:bg-surface focus-visible:text-foreground outline-none';

/** The canvas dialog's parts. */
const cdLabel = 'text-[12px] font-semibold text-muted-foreground';
const cdProblem = (on: boolean) => cn('mx-0 mt-1 mb-3 min-h-[18px] text-[12px]', on ? 'text-destructive' : 'text-muted-foreground');
const cdPanel = 'flex h-[clamp(240px,calc(100dvh-400px),520px)] min-h-0 flex-col short:h-auto [&[hidden]]:hidden';
const colorChoice = 'grid size-7 cursor-pointer place-items-center rounded-[50%] border border-transparent bg-transparent p-0 hover:bg-muted data-[state=checked]:border-foreground';
const swatch = 'block size-[18px] rounded-[50%]';
const iconChoice = 'grid h-10 cursor-pointer place-items-center rounded-[8px] border border-transparent bg-transparent p-0 text-foreground hover:bg-muted data-[state=checked]:border-foreground data-[state=checked]:bg-muted short:scroll-mt-2 short:scroll-mb-20';

/** Why the name can't be taken; none when it can. */
export function nameProblem(name: string, canvases: Canvas[], self?: string): string | undefined {
  const p = canvasNameProblem(name.replace(/\s+/g, ' '));
  if (p === 'empty') return t.canvases.problem.empty;
  if (p === 'tooLong') return t.canvases.problem.tooLong(CANVAS_NAME_MAX);
  if (p === 'number') return t.canvases.problem.number;
  const n = name.replace(/\s+/g, ' ').trim().toLowerCase();
  if (canvases.some((c) => c.id !== self && c.name.toLowerCase() === n)) return t.canvases.problem.taken;
  return undefined;
}

/** What the canvas dialog holds until it is saved or cancelled: the name and icon, and how far the owner got picking one. */
interface CanvasDraft {
  name: string;
  icon: string | null;
  /** The colour the Lucide icons are drawn in (null: the text's). */
  color?: CanvasIconColor | null;
  tab?: 'emoji' | 'icons';
  emojiSearch?: string;
  iconSearch?: string;
}

/** The radio value of the text's colour: a radio has no null. */
const TEXT_COLOR = '\0text';

/** The curated Lucide icons whose name holds every word of `search`. */
export const iconsMatching = (search: string) => {
  const words = search.toLowerCase().split(/[\s-]+/).filter(Boolean);
  return CANVAS_LUCIDE_ICONS.filter((n) => words.every((w) => n.includes(w)));
};

/**
 * The dialog that makes a canvas (no `canvas`) or changes one: its name, held to the name rule as it
 * is typed, and its icon, or none: any emoji, from a picker with search, categories and skin tones, or
 * one of the curated Lucide icons, searched by name and drawn in a colour of the palette or the text's.
 * What is typed and picked stays until it is saved or cancelled, also when the dialog is closed some
 * other way.
 */
export function CanvasDialog({ project, canvases, canvas, onClose, onDone }: { project: string; canvases: Canvas[]; canvas?: Canvas; onClose: () => void; onDone: (c: Canvas) => void }) {
  const [draft, setDraft] = useStoredState<CanvasDraft | null>(`seismic-canvas-draft-${project}-${canvas?.id ?? 'new'}`, null);
  const name = draft?.name ?? canvas?.name ?? '';
  const icon = draft ? draft.icon : (canvas?.icon ?? null);
  const lucide = lucideIcon(icon ?? undefined);
  const color = draft?.color !== undefined ? draft.color : (lucide?.color ?? null);
  const tab = draft?.tab ?? (icon && !lucide ? 'emoji' : 'icons');
  const set = (p: Partial<CanvasDraft>) => setDraft({ ...draft, name, icon, ...p });
  const pickColor = (c: CanvasIconColor | null) => set({ color: c, ...(lucide ? { icon: lucideIconValue(lucide.name, c) } : {}) });
  const matching = iconsMatching(draft?.iconSearch ?? '');
  const [touched, setTouched] = useState(!!draft?.name);
  const [failed, setFailed] = useState<string>();
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const isMain = canvas?.name === MAIN_CANVAS;
  const problem = isMain ? undefined : nameProblem(name, canvases, canvas?.id);
  const save = async () => {
    setTouched(true);
    if (problem || busy) return;
    setBusy(true);
    setFailed(undefined);
    try {
      const n = name.replace(/\s+/g, ' ').trim();
      const done = canvas
        ? await api.updateCanvas(canvas.id, { ...(isMain || n === canvas.name ? {} : { name: n }), ...(icon !== (canvas.icon ?? null) ? { icon } : {}) })
        : await api.createCanvas(n, icon ?? undefined);
      setDraft(null);
      onDone(done);
    } catch (err) {
      setFailed(failText(err));
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    setDraft(null);
    onClose();
  };
  const choice = (value: string, label: string, mark: ReactNode, className = iconChoice) => (
    <Tooltip key={value} content={label}>
      <Radio value={value} className={className} aria-label={label}>
        {mark}
      </Radio>
    </Tooltip>
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        asChild
        id="canvas-dialog"
        glass
        className={cn(
          'box-border flex w-[600px] flex-col overflow-hidden px-[26px] pt-[22px] pb-5 short:overflow-y-auto [&>:not(.cd-icons)]:shrink-0',
          // a short window: the emoji picker's list grows to its full height, so the dialog is the one thing that scrolls (also when searching or switching tabs with the keyboard up)
          'short:[&_[data-slot=emoji-picker-viewport]]:flex-none short:[&_[data-slot=emoji-picker-viewport]]:!overflow-visible short:[&_[data-slot=emoji-picker-viewport]]:![contain:none] short:[&_[data-slot=emoji-picker-emoji]]:scroll-mt-2 short:[&_[data-slot=emoji-picker-emoji]]:scroll-mb-20',
        )}
        layerClassName="items-start pt-[8vh]"
        onOpenAutoFocus={(e) => {
          if (isMain) return;
          e.preventDefault();
          field.current?.focus();
        }}
      >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <CloseButton label={t.canvases.cancel} className="close absolute top-3.5 right-3.5" onClick={onClose} />
        <DialogTitle asChild>
        <h2 className="m-0 mr-11 mb-4 flex items-center gap-3 text-[21px]">
          <span className="inline-grid size-10 place-items-center rounded-[10px] bg-muted">
            <CanvasIcon canvas={{ name: name.trim() || '?', ...(icon ? { icon } : {}) }} size={22} />
          </span>
          {canvas ? t.canvases.dialogEdit : t.canvases.dialogNew}
        </h2>
        </DialogTitle>
        <label className={cn(cdLabel, 'mb-1.5')} htmlFor="canvas-name">
          {t.canvases.name}
        </label>
        <Input
          id="canvas-name"
          ref={field}
          className="box-border w-full px-3 py-[9px] text-[15px]"
          value={name}
          maxLength={CANVAS_NAME_MAX + 10}
          placeholder={t.canvases.namePlaceholder}
          disabled={isMain}
          aria-invalid={touched && !!problem}
          onChange={(e) => {
            set({ name: e.target.value });
            if (e.target.value.trim()) setTouched(true);
          }}
        />
        <p className={cdProblem(!!(touched && problem))}>{isMain ? t.canvases.mainKeeps : touched && problem ? problem : ' '}</p>
        <Tabs className="cd-icons flex min-h-0 flex-col short:shrink-0" value={tab} onValueChange={(v) => set({ tab: v as CanvasDraft['tab'] })}>
          <div className="mb-2 flex shrink-0 items-center gap-2.5">
            <span className={cn(cdLabel, 'mr-1')}>{t.canvases.icon}</span>
            <TabsList variant="segmented" aria-label={t.canvases.icon}>
              <TabsTrigger value="icons">{t.canvases.icons}</TabsTrigger>
              <TabsTrigger value="emoji">{t.canvases.emojis}</TabsTrigger>
            </TabsList>
            <Button type="button" size="small" variant="ghost" className="ml-auto text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground aria-pressed:opacity-100" aria-pressed={!icon} disabled={!icon} onClick={() => set({ icon: null })}>
              {t.canvases.noIcon}
            </Button>
          </div>
          <TabsContent value="icons" className={cdPanel}>
            <div className="mb-2 shrink-0">
              <Input
                className="w-full"
                value={draft?.iconSearch ?? ''}
                placeholder={t.canvases.searchIcons}
                aria-label={t.canvases.searchIcons}
                onChange={(e) => set({ iconSearch: e.target.value })}
              />
            </div>
            <RadioGroup className="mb-2 flex shrink-0 flex-wrap gap-1" label={t.canvases.color} value={color ?? TEXT_COLOR} onValueChange={(v) => pickColor(v === TEXT_COLOR ? null : (v as CanvasIconColor))}>
              {choice(TEXT_COLOR, t.canvases.defaultColor, <span className={cn(swatch, 'bg-foreground')} />, colorChoice)}
              {(Object.keys(CANVAS_ICON_COLORS) as CanvasIconColor[]).map((c) =>
                choice(c, t.canvases.colors[c], <span className={swatch} style={{ background: CANVAS_ICON_COLORS[c] }} />, colorChoice),
              )}
            </RadioGroup>
            <RadioGroup className="-mx-1 grid min-h-0 flex-1 auto-rows-[40px] grid-cols-[repeat(auto-fill,minmax(40px,1fr))] content-start gap-1 overflow-auto px-1 short:flex-none short:overflow-visible" label={t.canvases.icons} value={lucide?.name ?? ''} onValueChange={(n) => set({ icon: lucideIconValue(n, color) })}>
              {matching.map((n) => {
                const L = lucideOf(`lucide:${n}`)!.Icon;
                return choice(n, n.replace(/-/g, ' '), <L size={20} strokeWidth={2} style={color ? { color: CANVAS_ICON_COLORS[color] } : undefined} aria-hidden />);
              })}
            </RadioGroup>
            {!matching.length && <p className="mx-0 my-6 text-center text-[13px] text-muted-foreground">{t.canvases.noIconFound}</p>}
          </TabsContent>
          <TabsContent value="emoji" className={cdPanel}>
            <EmojiPicker
              className="h-full"
              value={icon && !lucide ? icon : undefined}
              search={draft?.emojiSearch ?? ''}
              onSearch={(emojiSearch) => set({ emojiSearch })}
              onEmojiSelect={({ emoji }) => set({ icon: emoji })}
            />
          </TabsContent>
        </Tabs>
        {failed && <p className={cdProblem(true)}>{failed}</p>}
        <div className="mt-[18px] flex gap-2 short:sticky short:-bottom-5 short:z-1 short:-mb-5 short:bg-surface short:px-0 short:pt-3 short:pb-5">
          <Button type="submit" variant="primary" disabled={busy || !!problem}>
            {canvas ? t.canvases.save : t.canvases.create}
          </Button>
          <Button type="button" onClick={cancel}>
            {t.canvases.cancel}
          </Button>
        </div>
      </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A card's "⋯" (the open card's, a plan's on its container): "Move to canvas" and the project's other
 * canvases; only where there are other canvases. On the canvas (`floating`) its menu is drawn over
 * the page at the button, unscaled by the zoom and above the plan's workstreams, and goes when the
 * canvas moves under it.
 */
export function CardMore({ item, floating }: { item: Item; floating?: boolean }) {
  const { canvases, move } = useContext(Canvases);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open || !floating) return;
    // the camera moving (a pan, a zoom, a flight) moves the button away from the menu
    const from = button.current?.getBoundingClientRect();
    let frame = requestAnimationFrame(function watch() {
      const b = button.current?.getBoundingClientRect();
      if (!b || !from || Math.abs(b.left - from.left) > 1 || Math.abs(b.top - from.top) > 1 || Math.abs(b.width - from.width) > 1) return setOpen(false);
      frame = requestAnimationFrame(watch);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, floating]);
  const on = canvasOf(canvases, item);
  const others = canvases.filter((c) => c.id !== on?.id);
  const stopsToPark = parkableStopping(item);
  const canPark = parkable(item) || stopsToPark;
  const parked = !!inParkingLot(item) && !item.archivedAt;
  if ((!others.length && !canPark && !parked) || item.archivedAt) return null;
  const parking = (action: 'park' | 'unpark') => {
    void api.act(item.id, { action }).catch(console.error);
  };
  return (
    <span className={`${prioPickClass} card-more`}>
      <Menu open={open} onOpenChange={setOpen}>
        <Tooltip content={canPark || parked ? t.parking.menu : t.canvases.more}>
          <MenuTrigger asChild>
            <button ref={button} className={cn(prioBtnClass(), 'inline-grid h-5 place-items-center px-[5px] py-0 text-muted-foreground')} aria-label={canPark || parked ? t.parking.menu : t.canvases.more}>
              <MoreHorizontal size={14} aria-hidden />
            </button>
          </MenuTrigger>
        </Tooltip>
        <MenuContent className={prioMenuClass}>
          {(canPark || parked) && (
            <MenuItem title={canPark ? t.parking.parkHint : undefined} onSelect={() => (stopsToPark ? (leaveMenu(), setConfirm(true)) : parking(canPark ? 'park' : 'unpark'))}>
              <span className={loptClass}>
                <Car size={14} aria-hidden />
                {canPark ? t.parking.park : t.parking.unpark}
              </span>
            </MenuItem>
          )}
          {others.length > 0 && !parked && <MenuLabel>{t.canvases.moveTo}</MenuLabel>}
          {!parked && others.map((c) => (
            <MenuItem key={c.id} onSelect={() => (leaveMenu(), move(item, c))}>
              <span className={loptClass}>
                <CanvasIcon canvas={c} />
                {c.name}
              </span>
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t.parking.stopTitle}
        confirm={{ label: t.parking.stopConfirm, variant: 'review-warning', onClick: () => parking('park') }}
        cancel={t.parking.back}
      >
        <p>{t.parking.stopText}</p>
      </ConfirmDialog>
    </span>
  );
}

/** A wait one of whose cards lies on another canvas: the card here, the other one, and which way it waits. */
export interface Stub {
  here: string;
  other: Item;
  /** The canvas the other card lies on; none for a card off the canvas (snoozed or parked), which a marker for "Parked" stands for. */
  canvas?: Canvas;
  /** The card here waits for the other (`before`), or the other waits for it (`after`). */
  dir: 'before' | 'after';
}

/** Whether the card or its plan is off the canvas (snoozed, in the parking lot, or a workstream of a plan there): it is listed under "Parked", on no canvas, whatever card stands for it. */
export const hiddenCard = (id: string, byId: (id: string) => Item | undefined) => {
  const i = byId(id);
  return !!i && (offCanvas(i) || (!!i.parent && !!byId(i.parent) && offCanvas(byId(i.parent)!)));
};
const hiddenOf = (id: string, byId: (id: string) => Item | undefined, standsFor: (id: string) => string) => hiddenCard(id, byId) || hiddenCard(standsFor(id), byId);

/**
 * The waits that leave the canvas shown: each `[from, to]` (from the card waited for to the one
 * waiting) one of whose cards is placed here while the other, on the project, lies on another canvas.
 */
export function stubsOf(waits: [string, string][], placed: Set<string>, byId: (id: string) => Item | undefined, standsFor: (id: string) => string, canvases: Canvas[], shown?: string): Stub[] {
  const seen = new Set<string>();
  return waits.flatMap(([from, to]): Stub[] => {
    const [a, b] = [standsFor(from), standsFor(to)];
    const end = placed.has(b) && !placed.has(a) ? { here: b, away: from, dir: 'before' as const } : placed.has(a) && !placed.has(b) ? { here: a, away: to, dir: 'after' as const } : undefined;
    const other = end && byId(end.away);
    if (!end || !other || other.archivedAt || hiddenOf(from, byId, standsFor) || hiddenOf(to, byId, standsFor)) return [];
    const canvas = canvasOf(canvases, other);
    if (!canvas || canvas.id === shown) return [];
    const key = `${end.here} ${other.id} ${end.dir}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ here: end.here, other, canvas, dir: end.dir }];
  });
}

/**
 * The stubs of the waits (`[from, to]`, those lit while the pointer is on a card) that lead to a card
 * off the canvas, snoozed or parked: one for each card placed here that the other end of a wait is
 * not placed beside it. The stub ends in the marker for "Parked"; a click opens the card there.
 */
export function parkedStubsOf(waits: [string, string][], placed: Set<string>, byId: (id: string) => Item | undefined, standsFor: (id: string) => string): Stub[] {
  const seen = new Set<string>();
  return waits.flatMap(([from, to]): Stub[] => {
    // the end that is off the canvas itself (not through the plan standing for it) and the card of the other end shown here
    const end = hiddenCard(from, byId) && placed.has(standsFor(to)) && !hiddenCard(to, byId) ? { here: standsFor(to), away: from, dir: 'before' as const } : hiddenCard(to, byId) && placed.has(standsFor(from)) && !hiddenCard(from, byId) ? { here: standsFor(from), away: to, dir: 'after' as const } : undefined;
    const other = end && byId(end.away);
    if (!end || !other || other.archivedAt) return [];
    const key = `${end.here} ${other.id} ${end.dir}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ here: end.here, other, dir: end.dir }];
  });
}

/**
 * The stubs of the waits that leave the canvas, inside the waits' layer (`DepLinks`): a short faint
 * arrow out of the card's side, into it on the left from what it waits for and out of it on the right
 * to what waits for it, ending at the other canvas's icon; a click opens the other card there. A card off the canvas shows a clock instead, only while the pointer is on a card it waits with.
 */
export function CanvasStubs({ stubs, boundsOf, s, onOpen }: { stubs: Stub[]; boundsOf: (id: string) => Bounds | undefined; s: number; onOpen: (i: Item) => void }) {
  const r = 13 / s;
  const len = Math.max(44, 30 / s);
  const head = 6 * Math.max(2, 1.6 / s);
  const sides = new Map<string, Stub[]>();
  for (const x of stubs) sides.set(`${x.here} ${x.dir}`, [...(sides.get(`${x.here} ${x.dir}`) ?? []), x]);
  return (
    <>
      {[...sides.values()].flatMap((row) =>
        row.map((x, k) => {
          const b = boundsOf(x.here);
          if (!b) return null;
          const y = b.y + b.h / 2 + (k - (row.length - 1) / 2) * (2 * r + 6 / s);
          const edge = x.dir === 'before' ? b.x : b.x + b.w;
          const chip = x.dir === 'before' ? edge - len : edge + len;
          // into the card from the chip, or out of the card to the chip; the line stops at its head's base
          const [x0, x1] = x.dir === 'before' ? [chip + r, edge - head] : [edge, chip - r - head];
          const title = x.canvas
            ? (x.dir === 'before' ? t.canvases.stubBefore : t.canvases.stubAfter)(plain(x.other.title), canvasText(x.canvas))
            : (x.dir === 'before' ? t.canvases.stubBeforeParked : t.canvases.stubAfterParked)(plain(x.other.title));
          return (
            <g key={`${x.here} ${x.other.id} ${x.dir}`} className="canvas-stub">
              <path className={depLineClass.faint} d={`M${x0},${y} L${x1},${y}`} strokeWidth={Math.max(2, 1.6 / s)} strokeDasharray={`${4 / s} ${4 / s}`} markerEnd="url(#faint-arrow)" />
              <foreignObject className="overflow-visible" x={chip - r} y={y - r} width={2 * r} height={2 * r}>
                {x.canvas ? (
                  <Tooltip content={title}>
                    <button className="pointer-events-auto box-border grid size-full cursor-pointer place-items-center rounded-[50%] border border-[var(--dep-line)] bg-card p-0 text-foreground hover:border-proposal" aria-label={title} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), onOpen(x.other))}>
                      <CanvasIcon canvas={x.canvas} size={14 / s} />
                    </button>
                  </Tooltip>
                ) : (
                  // shown only while the pointer is on the card, so it is a mark, not a button: the card opens from "Parked"
                  <div className="box-border grid size-full place-items-center rounded-[50%] border border-[var(--dep-line)] bg-card text-foreground" role="img" aria-label={title}>
                    <Clock size={14 / s} strokeWidth={2} />
                  </div>
                )}
              </foreignObject>
            </g>
          );
        }),
      )}
    </>
  );
}

/** The canvas a card is on when that is another one of the project than the one shown. */
export function useOtherCanvas(item: Item): Canvas | undefined {
  const { canvases, shown } = useContext(Canvases);
  const c = canvases.length > 1 ? canvases.find((x) => x.id === item.canvas) : undefined;
  return c && c.id !== shown ? c : undefined;
}

/** A card on another canvas of the project than the one shown, as search and the inbox list it: that canvas's icon (`named`: and name). */
export function OtherCanvas({ item, named = false }: { item: Item; named?: boolean }) {
  const c = useOtherCanvas(item);
  if (!c) return null;
  return (
    <span className="other-canvas inline-flex flex-none items-center gap-1 text-muted-foreground" title={t.canvases.onCanvas(c.name)}>
      <CanvasIcon canvas={c} size={12} />
      {named && <span className="oc-name">{c.name}</span>}
    </span>
  );
}

// ------------------------------------------------------------------ canvas ring

const RING_RADIUS = 84;
const RING_LABEL_RADIUS = 124;

/**
 * The ring of a right click where the project's setting "Right click on a card" says canvases: a ball
 * with the icon of each canvas around `at` (screen), its name beside it. Moving towards a ball or
 * its name picks it, a click takes it and the cards move there; the canvas the cards are on, or a
 * click in the middle, closes the ring. Built like the colour ring of groups (groups.tsx).
 */
export function CanvasRing({ at: pointer, count, canvases, shown, onPick, onClose }: { at: { x: number; y: number }; count: number; canvases: Canvas[]; shown?: string | undefined; onPick: (c: Canvas) => void; onClose: () => void }) {
  const mx = RING_LABEL_RADIUS + 150;
  const my = RING_LABEL_RADIUS + 24;
  const at = { x: Math.min(Math.max(pointer.x, mx), innerWidth - mx), y: Math.min(Math.max(pointer.y, my + 50), innerHeight - my) };
  const [hot, setHot] = useState(-1);
  const [open, setOpen] = useState(false);
  const angle = (k: number) => -Math.PI / 2 + (k * 2 * Math.PI) / canvases.length;
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    // Escape closes the ring before anything else hears it
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    addEventListener('keydown', key, true);
    return () => (cancelAnimationFrame(frame), removeEventListener('keydown', key, true));
  }, []);
  /** The ball in the direction of the pointer; none near the middle. */
  function aimed(e: React.PointerEvent): number {
    const dx = e.clientX - at.x;
    const dy = e.clientY - at.y;
    if (Math.hypot(dx, dy) < 30) return -1;
    const a = Math.atan2(dy, dx);
    let best = 0;
    let bd = Infinity;
    canvases.forEach((_, k) => {
      const d = Math.abs(Math.atan2(Math.sin(a - angle(k)), Math.cos(a - angle(k))));
      if (d < bd) [bd, best] = [d, k];
    });
    return best;
  }
  function pick(k: number) {
    const c = canvases[k];
    if (!c || c.id === shown) return onClose();
    onPick(c);
  }
  const hc = canvases[hot];
  const caption = hc ? (hc.id === shown ? t.canvases.ringHere : hc.name) : t.canvases.ringCaption(count);
  return (
    <div id="ringback" className={ringBackClass} onPointerMove={(e) => setHot(aimed(e))} onPointerDown={(e) => (e.preventDefault(), pick(aimed(e)))} onContextMenu={(e) => e.preventDefault()}>
      <div className={radialClass} style={{ left: at.x, top: at.y }}>
        <div className={haloClass(open)} />
        {canvases.map((c, k) => (
          <div
            key={c.id}
            className={ballClass('canvas', { open, hot: k === hot, here: c.id === shown })}
            aria-label={c.name}
            style={{ '--h': 215, '--bx': `${Math.cos(angle(k)) * RING_RADIUS}px`, '--by': `${Math.sin(angle(k)) * RING_RADIUS}px`, transitionDelay: `${k * 28}ms` } as React.CSSProperties}
          >
            <CanvasIcon canvas={c} size={18} />
          </div>
        ))}
        {canvases.map((c, k) => (
          <div
            key={`n-${c.id}`}
            className={tagClass({ open, hot: k === hot, vacant: c.id === shown })}
            title={c.name}
            style={{
              '--h': 215,
              maxWidth: 140,
              left: Math.cos(angle(k)) * RING_LABEL_RADIUS,
              top: Math.sin(angle(k)) * RING_LABEL_RADIUS,
              transform: `translate(${((Math.cos(angle(k)) - 1) / 2) * 100}%, ${((Math.sin(angle(k)) - 1) / 2) * 100}%)`,
              transitionDelay: `${k * 28 + 80}ms`,
            } as React.CSSProperties}
            onPointerMove={(e) => (e.stopPropagation(), setHot(k))}
            onPointerDown={(e) => (e.preventDefault(), e.stopPropagation(), pick(k))}
          >
            <span>{c.name}</span>
          </div>
        ))}
        <div className={captionClass}>{caption}</div>
      </div>
    </div>
  );
}
