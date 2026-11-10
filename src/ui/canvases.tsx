// The project's canvases in the page: the tab strip at the bottom right and the drawer it slides
// out (switching, waiting counts, rename, icon, order, delete, "+ New canvas"), the dialog that names
// a canvas and picks its icon, a card's "Move to canvas" menu, and the stubs of waits whose other
// card lies on another canvas.

import { createContext, type PointerEvent as ReactPointerEvent, type ReactNode, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from 'cn';
import { Car, GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { CANVAS_LUCIDE_ICONS } from '../core/canvas-icons';
import type { Bounds } from '../core/layout';
import { type Canvas, CANVAS_NAME_MAX, canvasNameProblem, type Item, MAIN_CANVAS, parkable, parkableStopping, inParkingLot } from '../core/types';
import { api } from './api';
import { CANVAS_EMOJIS, CanvasIcon, canvasText, lucideOf } from './canvasIcon';
import { know, known } from './known';
import { plain } from './markdown';
import { useSortable } from './sortable';
import { useStoredState } from './stored';
import { failText, t } from './strings';
import { Button, CloseButton } from './components/button';
import { leaveMenu, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from './components/menu';
import { Popover, PopoverAnchor, PopoverContent } from './components/popover';
import { Radio, RadioGroup } from './components/radio';

/** The radio value of "no icon": a radio has no null. */
const NO_ICON = '\0none';
import { Tabs, TabsList, TabsTrigger } from './components/tabs';
import { Tooltip } from './components/tooltip';

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
const KNOWN = 'obeya-canvases-known';

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
  // the keyboard is on the strip: the drawer says how to reach it
  const [keyed, setKeyed] = useState(false);
  const open = (on: boolean, key = false) => {
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
    open(false);
    onShow(c);
  };
  const editing = dialog?.edit ? canvases.find((c) => c.id === dialog.edit) : undefined;
  const hover = {
    onPointerEnter: (e: ReactPointerEvent) => e.pointerType === 'mouse' && open(true),
    onPointerLeave: (e: ReactPointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(leave.current);
      leave.current = setTimeout(() => setDrawer(false), LEAVE_MS);
    },
  };
  return (
    <Popover open={drawer} onOpenChange={(on) => open(on)}>
      <PopoverAnchor asChild>
        <div
          id="canvas-tabs"
          ref={box}
          className={drawer ? 'out' : undefined}
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
            <TabsList className="canvas-strip" aria-label={t.canvases.strip}>
              {several &&
                canvases.map((c) => (
                  <TabsTrigger
                    key={c.id}
                    value={c.id}
                    aria-controls="world"
                    className={c.id === shown ? 'ctab on' : 'ctab'}
                    title={c.name}
                    onClick={(e) => {
                      // a finger has no hover: its first tap brings the drawer, where the canvas is picked by name
                      if ((e.nativeEvent as PointerEvent).pointerType === 'touch' && !drawer) return open(true);
                      pick(c);
                    }}
                  >
                    <CanvasIcon canvas={c} />
                    {c.id === shown && <span className="ctab-name">{c.name}</span>}
                    {c.id !== shown && !!waiting[c.id] && <span className="ctab-n" title={t.canvases.waiting(waiting[c.id]!)}>{waiting[c.id]}</span>}
                  </TabsTrigger>
                ))}
              <Tooltip content={t.canvases.newCanvas}>
                <button className={isKnown || several ? 'ctab new' : 'ctab new named'} aria-label={t.canvases.newCanvas} onClick={startNew}>
                  <Plus size={14} strokeWidth={2.4} aria-hidden />
                  {!isKnown && !several && <span className="ctab-name">{t.canvases.newCanvas}</span>}
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
          if (!byKey.current) return;
          back.current = true;
          box.current?.querySelector<HTMLElement>('.ctab.on')?.focus();
        }}
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
            <li key={c.id} {...sort.row(c.id)} className="group flex items-center gap-0.5 rounded-[6px] bg-panel hover:bg-chip data-[sorting=dragged]:bg-chip">
              <span className="grid h-[30px] w-4 flex-none cursor-grab touch-none place-items-center text-muted-foreground opacity-0 group-hover:opacity-80" title={t.canvases.grip} {...sort.grip(c.id)}>
                <GripVertical size={14} aria-hidden />
              </span>
              <button
                className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent pr-1.5 pl-0.5 text-left text-sm text-ink outline-none focus-visible:underline"
                aria-current={c.id === shown || undefined}
                onClick={() => onPick(c)}
              >
                <CanvasIcon canvas={c} size={16} />
                <span className={cn('min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap', c.id === shown && 'font-bold')}>{c.name}</span>
                {n > 0 && (
                  <span className="box-border h-[18px] min-w-[18px] flex-none rounded-full bg-waiting px-[5px] text-center text-[11px] leading-[18px] font-bold text-on-ink" title={t.canvases.waiting(n)}>
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
      {failed && <p className="mx-2 my-1 text-xs text-error">{failed}</p>}
      <button
        className="mt-1 flex h-[34px] w-full cursor-pointer items-center gap-2 rounded-b-[6px] border-0 border-t border-solid border-line bg-transparent pr-2 pl-[18px] text-sm font-semibold text-ink outline-none hover:bg-chip focus-visible:bg-chip"
        onClick={onNew}
      >
        <Plus size={14} strokeWidth={2.4} aria-hidden /> {t.canvases.newCanvas}
      </button>
    </>
  );
}

/** A canvas's rename and delete in the drawer. */
const tool = 'grid size-[26px] cursor-pointer place-items-center rounded-[4px] border-0 bg-transparent text-muted-foreground hover:bg-panel hover:text-ink focus-visible:bg-panel focus-visible:text-ink outline-none';

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

/**
 * The dialog that makes a canvas (no `canvas`) or changes one: its name, held to the name rule as it
 * is typed, and its icon, an emoji or one of the curated Lucide icons, or none. What is typed and
 * picked stays until it is saved or cancelled, also when the dialog is closed some other way.
 */
export function CanvasDialog({ project, canvases, canvas, onClose, onDone }: { project: string; canvases: Canvas[]; canvas?: Canvas; onClose: () => void; onDone: (c: Canvas) => void }) {
  const [draft, setDraft] = useStoredState<{ name: string; icon: string | null } | null>(`obeya-canvas-draft-${project}-${canvas?.id ?? 'new'}`, null);
  const name = draft?.name ?? canvas?.name ?? '';
  const icon = draft ? draft.icon : (canvas?.icon ?? null);
  const set = (p: Partial<{ name: string; icon: string | null }>) => setDraft({ name, icon, ...p });
  const [touched, setTouched] = useState(!!draft?.name);
  const [failed, setFailed] = useState<string>();
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const isMain = canvas?.name === MAIN_CANVAS;
  useLayoutEffect(() => {
    if (!isMain) field.current?.focus();
  }, []);
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
  const choice = (value: string | null, label: string, mark: ReactNode) => (
    <Tooltip key={value ?? NO_ICON} content={label}>
      <Radio value={value ?? NO_ICON} className="cicon" aria-label={label}>
        {mark}
      </Radio>
    </Tooltip>
  );
  return (
    <div id="canvas-dialog" onClick={onClose}>
      <form
        className="box"
        role="dialog"
        aria-modal="true"
        aria-label={canvas ? t.canvases.dialogEdit : t.canvases.dialogNew}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.stopPropagation();
          onClose();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <CloseButton label={t.canvases.cancel} className="close" onClick={onClose} />
        <h2>
          <span className="cd-preview">
            <CanvasIcon canvas={{ name: name.trim() || '?', ...(icon ? { icon } : {}) }} size={22} />
          </span>
          {canvas ? t.canvases.dialogEdit : t.canvases.dialogNew}
        </h2>
        <label className="cd-label" htmlFor="canvas-name">
          {t.canvases.name}
        </label>
        <input
          id="canvas-name"
          ref={field}
          className="cd-field"
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
        <p className={touched && problem ? 'cd-problem on' : 'cd-problem'}>{isMain ? t.canvases.mainKeeps : touched && problem ? problem : ' '}</p>
        <div className="cd-label">{t.canvases.icon}</div>
        <RadioGroup className="cd-icons" label={t.canvases.icon} value={icon ?? NO_ICON} onValueChange={(v) => set({ icon: v === NO_ICON ? null : v })}>
          {choice(null, t.canvases.noIcon, <span className="cd-none">{t.canvases.noIcon}</span>)}
          <h3>{t.canvases.emojis}</h3>
          <div className="cd-grid">{CANVAS_EMOJIS.map((e) => choice(e, e, <span className="emoji">{e}</span>))}</div>
          <h3>{t.canvases.icons}</h3>
          <div className="cd-grid">
            {CANVAS_LUCIDE_ICONS.map((n) => {
              const L = lucideOf(`lucide:${n}`)!;
              return choice(`lucide:${n}`, n.replace(/-/g, ' '), <L size={18} strokeWidth={2} aria-hidden />);
            })}
          </div>
        </RadioGroup>
        {failed && <p className="cd-problem on">{failed}</p>}
        <div className="cd-actions">
          <Button type="submit" variant="primary" disabled={busy || !!problem}>
            {canvas ? t.canvases.save : t.canvases.create}
          </Button>
          <Button type="button" onClick={cancel}>
            {t.canvases.cancel}
          </Button>
        </div>
      </form>
    </div>
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
    <span className="prio-pick card-more">
      <Menu open={open} onOpenChange={setOpen}>
        <Tooltip content={canPark || parked ? t.parking.menu : t.canvases.more}>
          <MenuTrigger asChild>
            <button ref={button} className="prio-btn" aria-label={canPark || parked ? t.parking.menu : t.canvases.more}>
              <MoreHorizontal size={14} aria-hidden />
            </button>
          </MenuTrigger>
        </Tooltip>
        <MenuContent className="prio-menu card-more-menu">
          {(canPark || parked) && (
            <MenuItem title={canPark ? t.parking.parkHint : undefined} onSelect={() => (stopsToPark ? (leaveMenu(), setConfirm(true)) : parking(canPark ? 'park' : 'unpark'))}>
              <span className="lopt">
                <Car size={14} aria-hidden />
                {canPark ? t.parking.park : t.parking.unpark}
              </span>
            </MenuItem>
          )}
          {others.length > 0 && !parked && <MenuLabel>{t.canvases.moveTo}</MenuLabel>}
          {!parked && others.map((c) => (
            <MenuItem key={c.id} onSelect={() => (leaveMenu(), move(item, c))}>
              <span className="lopt">
                <CanvasIcon canvas={c} />
                {c.name}
              </span>
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      {confirm && createPortal(
        <div className="review-approval-cover" onClick={() => setConfirm(false)}>
          <div className="review-approval-box" role="dialog" aria-modal="true" aria-labelledby="stop-park-title" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setConfirm(false); } }}>
            <h2 id="stop-park-title">{t.parking.stopTitle}</h2>
            <p>{t.parking.stopText}</p>
            <div className="review-approval-actions">
              <Button variant="review-warning" onClick={() => { setConfirm(false); parking('park'); }}>{t.parking.stopConfirm}</Button>
              <Button autoFocus onClick={() => setConfirm(false)}>{t.parking.back}</Button>
            </div>
          </div>
        </div>, document.body,
      )}
    </span>
  );
}

/** A wait one of whose cards lies on another canvas: the card here, the other one, and which way it waits. */
export interface Stub {
  here: string;
  other: Item;
  canvas: Canvas;
  /** The card here waits for the other (`before`), or the other waits for it (`after`). */
  dir: 'before' | 'after';
}

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
    if (!end || !other || other.archivedAt) return [];
    const canvas = canvasOf(canvases, other);
    if (!canvas || canvas.id === shown) return [];
    const key = `${end.here} ${other.id} ${end.dir}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ here: end.here, other, canvas, dir: end.dir }];
  });
}

/**
 * The stubs of the waits that leave the canvas, inside the waits' layer (`DepLinks`): a short faint
 * arrow out of the card's side, into it on the left from what it waits for and out of it on the right
 * to what waits for it, ending at the other canvas's icon; a click opens the other card there.
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
          const title = (x.dir === 'before' ? t.canvases.stubBefore : t.canvases.stubAfter)(plain(x.other.title), canvasText(x.canvas));
          return (
            <g key={`${x.here} ${x.other.id} ${x.dir}`} className="canvas-stub">
              <path className="faint" d={`M${x0},${y} L${x1},${y}`} strokeWidth={Math.max(2, 1.6 / s)} strokeDasharray={`${4 / s} ${4 / s}`} markerEnd="url(#faint-arrow)" />
              <foreignObject x={chip - r} y={y - r} width={2 * r} height={2 * r}>
                <Tooltip content={title}>
                  <button aria-label={title} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), onOpen(x.other))}>
                    <CanvasIcon canvas={x.canvas} size={14 / s} />
                  </button>
                </Tooltip>
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
    <span className="other-canvas" title={t.canvases.onCanvas(c.name)}>
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
    <div id="ringback" onPointerMove={(e) => setHot(aimed(e))} onPointerDown={(e) => (e.preventDefault(), pick(aimed(e)))} onContextMenu={(e) => e.preventDefault()}>
      <div className={`radial${open ? ' open' : ''}`} style={{ left: at.x, top: at.y }}>
        <div className="rhalo" />
        {canvases.map((c, k) => (
          <div
            key={c.id}
            className={`ball canvas${k === hot ? ' hot' : ''}${c.id === shown ? ' here' : ''}`}
            aria-label={c.name}
            style={{ '--h': 215, '--bx': `${Math.cos(angle(k)) * RING_RADIUS}px`, '--by': `${Math.sin(angle(k)) * RING_RADIUS}px`, transitionDelay: `${k * 28}ms` } as React.CSSProperties}
          >
            <CanvasIcon canvas={c} size={18} />
          </div>
        ))}
        {canvases.map((c, k) => (
          <div
            key={`n-${c.id}`}
            className={`gtag${k === hot ? ' hot' : ''}${c.id === shown ? ' vacant' : ''}`}
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
        <div className="rcap">{caption}</div>
      </div>
    </div>
  );
}
