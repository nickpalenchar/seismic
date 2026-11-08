// The project's canvases in the page: the tab strip at the bottom right and the drawer it slides
// out (switching, waiting counts, rename, icon, order, delete, "+ New canvas"), the dialog that names
// a canvas and picks its icon, a card's "Move to canvas" menu, and the stubs of waits whose other
// card lies on another canvas.

import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { CANVAS_LUCIDE_ICONS } from '../core/canvas-icons';
import type { Bounds } from '../core/layout';
import { type Canvas, CANVAS_NAME_MAX, canvasNameProblem, type Item, MAIN_CANVAS } from '../core/types';
import { api } from './api';
import { CANVAS_EMOJIS, CanvasIcon, canvasText, lucideOf } from './canvasIcon';
import { know, known } from './known';
import { plain } from './markdown';
import { useMenuClose } from './queue';
import { useSortable } from './sortable';
import { useStoredState } from './stored';
import { failText, t } from './strings';

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
 * the strip (a tap on touch) slides out the drawer above it, which lists the canvases by name with
 * the cards waiting on each, and ends with "+ New canvas".
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
  const open = (on: boolean) => {
    clearTimeout(leave.current);
    if (on && several) learn();
    setDrawer(on && several);
  };
  useMenuClose(drawer, box, () => open(false), true);
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
  return (
    <>
      <div
        id="canvas-tabs"
        ref={box}
        className={drawer ? 'out' : undefined}
        onPointerEnter={(e) => e.pointerType === 'mouse' && open(true)}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'mouse') return;
          clearTimeout(leave.current);
          leave.current = setTimeout(() => setDrawer(false), LEAVE_MS);
        }}
      >
        {drawer && <Drawer canvases={canvases} shown={shown} waiting={waiting} empty={empty} onPick={pick} onEdit={(c) => (open(false), setDialog({ edit: c.id }))} onNew={startNew} />}
        <div className="canvas-strip" role="tablist" aria-label={t.canvases.strip}>
          {several &&
            canvases.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={c.id === shown}
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
              </button>
            ))}
          <button className={isKnown || several ? 'ctab new' : 'ctab new named'} title={t.canvases.newCanvas} aria-label={t.canvases.newCanvas} onClick={startNew}>
            <Plus size={14} strokeWidth={2.4} aria-hidden />
            {!isKnown && !several && <span className="ctab-name">{t.canvases.newCanvas}</span>}
          </button>
        </div>
      </div>
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
    </>
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
    <div className="canvas-drawer" role="menu">
      <ul>
        {sort.order.map((id) => {
          const c = canvases.find((x) => x.id === id)!;
          const n = waiting[c.id] ?? 0;
          return (
            <li key={c.id} {...sort.row(c.id)} className={c.id === shown ? 'on' : undefined}>
              <span className="grip" title={t.canvases.grip} {...sort.grip(c.id)}>
                <GripVertical size={14} aria-hidden />
              </span>
              <button className="cd-pick" role="menuitemradio" aria-checked={c.id === shown} onClick={() => onPick(c)}>
                <CanvasIcon canvas={c} size={16} />
                <span className="cd-name">{c.name}</span>
                {n > 0 && <span className="cd-n" title={t.canvases.waiting(n)}>{n}</span>}
              </button>
              <span className="cd-tools">
                <button title={t.canvases.edit} aria-label={t.canvases.edit} onClick={() => onEdit(c)}>
                  <Pencil size={13} aria-hidden />
                </button>
                {c.name !== MAIN_CANVAS && empty.has(c.id) && (
                  <button title={t.canvases.remove} aria-label={t.canvases.remove} onClick={() => remove(c)}>
                    <Trash2 size={13} aria-hidden />
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {failed && <p className="cd-failed">{failed}</p>}
      <button className="cd-new" role="menuitem" onClick={onNew}>
        <Plus size={14} strokeWidth={2.4} aria-hidden /> {t.canvases.newCanvas}
      </button>
    </div>
  );
}

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
    <button key={value ?? 'none'} type="button" role="radio" aria-checked={icon === value} className={icon === value ? 'cicon on' : 'cicon'} title={label} aria-label={label} onClick={() => set({ icon: value })}>
      {mark}
    </button>
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
        <button type="button" className="close" title={t.canvases.cancel} onClick={onClose}>
          ✕
        </button>
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
        <div className="cd-icons" role="radiogroup" aria-label={t.canvases.icon}>
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
        </div>
        {failed && <p className="cd-problem on">{failed}</p>}
        <div className="cd-actions">
          <button type="submit" className="btn primary" disabled={busy || !!problem}>
            {canvas ? t.canvases.save : t.canvases.create}
          </button>
          <button type="button" className="btn" onClick={cancel}>
            {t.canvases.cancel}
          </button>
        </div>
      </form>
    </div>
  );
}

/** The open card's "⋯": "Move to canvas" and the project's other canvases; only where there are other canvases. */
export function CardMore({ item }: { item: Item }) {
  const { canvases, move } = useContext(Canvases);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useMenuClose(open, box, () => setOpen(false), true);
  useLayoutEffect(() => {
    const m = menu.current;
    if (!open || !m) return;
    const over = m.getBoundingClientRect().right - (document.documentElement.clientWidth - 8);
    if (over > 0) m.style.left = `${-over}px`;
  }, [open]);
  const on = canvasOf(canvases, item);
  const others = canvases.filter((c) => c.id !== on?.id);
  if (!others.length || item.archivedAt || item.kind === 'plan') return null;
  return (
    <span className="prio-pick card-more" ref={box}>
      <button className="prio-btn" title={t.canvases.more} aria-label={t.canvases.more} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <MoreHorizontal size={14} aria-hidden />
      </button>
      {open && (
        <div ref={menu} className="prio-menu card-more-menu" role="menu">
          <div className="cm-head">{t.canvases.moveTo}</div>
          {others.map((c) => (
            <button
              key={c.id}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                move(item, c);
              }}
            >
              <span className="lopt">
                <CanvasIcon canvas={c} />
                {c.name}
              </span>
            </button>
          ))}
        </div>
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
                <button title={title} aria-label={title} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), onOpen(x.other))}>
                  <CanvasIcon canvas={x.canvas} size={14 / s} />
                </button>
              </foreignObject>
            </g>
          );
        }),
      )}
    </>
  );
}

/** A card on another canvas of the project than the one shown, as search and the inbox list it: that canvas's icon (`named`: and name). */
export function OtherCanvas({ item, named = false }: { item: Item; named?: boolean }) {
  const { canvases, shown } = useContext(Canvases);
  const c = canvases.length > 1 ? canvases.find((x) => x.id === item.canvas) : undefined;
  if (!c || c.id === shown) return null;
  return (
    <span className="other-canvas" title={t.canvases.onCanvas(c.name)}>
      <CanvasIcon canvas={c} size={12} />
      {named && <span className="oc-name">{c.name}</span>}
    </span>
  );
}
