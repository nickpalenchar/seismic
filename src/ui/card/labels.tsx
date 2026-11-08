// A card's labels (`core/labels.ts`): on its face, the priority's flag and compact chips after it;
// on the unfolded card, a picker for each. A label Seismic suggested and the owner has not touched is
// drawn with the same dashed border as a proposal; any pick makes it theirs.

import { Flag as FlagIcon } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { COMPLEXITIES, type Complexity, type Label, type Labels, LABEL_VALUES, PRIORITIES, type Priority } from '../../core/labels';
import type { Item } from '../../core/types';
import { api } from '../api';
import { useMenuClose } from '../queue';
import { t } from '../strings';

/** A flag, in the colour of the priority it marks. */
const Flag = () => (
  <FlagIcon size={11} strokeWidth={2} fill="currentColor" aria-hidden />
);

/** Rising bars, as many filled as the complexity's step in the scale. */
const Bars = ({ complexity }: { complexity: Complexity }) => {
  const filled = COMPLEXITIES.indexOf(complexity) + 1;
  return (
    <svg width="15" height="10" viewBox="0 0 15 10" aria-hidden>
      {COMPLEXITIES.map((_, i) => (
        <rect key={i} x={i * 2.25} y={10 - (i + 1) * 10 / COMPLEXITIES.length} width="1.5" height={(i + 1) * 10 / COMPLEXITIES.length} rx=".4" fill="currentColor" opacity={i < filled ? 1 : 0.28} />
      ))}
    </svg>
  );
};

const suggestedOf = (item: Item, label: Label) => !!item.labels?.suggested?.includes(label);

/**
 * A card's priority on its face: a flag and its name, in its colour; framed in purple while Seismic
 * suggested it. `bare`, the flag alone, its name on hover, as the smallest card face shows it.
 */
export const PriorityMark = ({ priority, suggested, bare }: { priority: Priority; suggested?: boolean; bare?: boolean }) => (
  <span
    className={`prio prio-${priority}${suggested ? ' sugg' : ''}${bare ? ' bare' : ''}`}
    title={bare ? [t.priority.names[priority], suggested && t.labels.suggested].filter(Boolean).join('\n') : suggested ? t.labels.suggested : undefined}
  >
    <Flag />
    {!bare && t.priority.names[priority]}
  </span>
);

/** The text of a category, sub-category or complexity, as its chip and its picker show it. */
function chipText(label: Exclude<Label, 'priority'>, v: NonNullable<Labels[typeof label]>) {
  if (label === 'complexity') return String(v);
  return label === 'category' ? t.labels.category.names[v as keyof typeof t.labels.category.names] : t.labels.subcategory.names[v as keyof typeof t.labels.subcategory.names];
}

/** What a chip says on hover: the label's name and value. */
function chipTitle(label: Exclude<Label, 'priority'>, v: NonNullable<Labels[typeof label]>) {
  return label === 'complexity' ? t.labels.complexity.step(v as Complexity) : `${t.labels[label].label}: ${chipText(label, v)}`;
}

/** One label as a compact chip; purple-bordered while Seismic suggested it. */
function Chip({ label, value, suggested }: { label: Exclude<Label, 'priority'>; value: NonNullable<Labels[typeof label]>; suggested?: boolean }) {
  return (
    <span className={`lchip lchip-${label}${suggested ? ' sugg' : ''}`} title={suggested ? `${chipTitle(label, value)}\n${t.labels.suggested}` : chipTitle(label, value)}>
      {label === 'complexity' && <Bars complexity={value as Complexity} />}
      {chipText(label, value)}
    </span>
  );
}

const CHIPPED = ['category', 'subcategory', 'complexity'] as const;

/** Whether a card has any label to show. */
export const hasLabels = (item: Item) => !!item.labels?.priority || CHIPPED.some((l) => item.labels?.[l] !== undefined);

/** A card's labels on its face: its priority's flag, then a chip for each label it has. */
export function LabelMarks({ item }: { item: Item }) {
  const shown = CHIPPED.filter((l) => item.labels?.[l] !== undefined).map((l) => <Chip key={l} label={l} value={item.labels![l]!} suggested={suggestedOf(item, l)} />);
  return (
    <>
      {item.labels?.priority && <PriorityMark priority={item.labels.priority} suggested={suggestedOf(item, 'priority')} />}
      {shown}
    </>
  );
}

/**
 * A label on the unfolded card: its mark, or its name in a frame while it has none; a click lists
 * its values and "None", which takes it off. A pick takes effect at once and makes the label the
 * owner's, the same value as Seismic's suggestion included.
 */
function LabelPick<L extends Label>({ item, label, values, shown, empty, option, optionTitle, open, setOpen }: {
  item: Item;
  label: L;
  values: readonly NonNullable<Labels[L]>[];
  shown: (v: NonNullable<Labels[L]>) => ReactNode;
  empty: ReactNode;
  option: (v: NonNullable<Labels[L]>) => ReactNode;
  optionTitle?: (v: NonNullable<Labels[L]>) => string;
  open: boolean;
  setOpen: (on: boolean) => void;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useMenuClose(open, box, () => setOpen(false), true);
  // a list that would run past the window's right edge (a picker far right, a phone) moves left until it fits
  useLayoutEffect(() => {
    const m = menu.current;
    if (!open || !m) return;
    const over = m.getBoundingClientRect().right - (document.documentElement.clientWidth - 8);
    if (over > 0) m.style.left = `${-over}px`;
  }, [open]);
  const now = item.labels?.[label] as Labels[L] | undefined;
  const pick = (v: NonNullable<Labels[L]> | null) => {
    setOpen(false);
    api.patch(item.id, { [label]: v }).catch(console.error);
  };
  return (
    <span className="prio-pick" ref={box}>
      <button className={now !== undefined ? 'prio-btn set' : 'prio-btn'} title={label === 'priority' ? t.priority.label : t.labels[label as Exclude<Label, 'priority'>].label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {now !== undefined ? shown(now as NonNullable<Labels[L]>) : empty}
      </button>
      {open && (
        <div ref={menu} className={`prio-menu lmenu-${label}`} role="menu">
          {values.map((v) => (
            <button key={String(v)} role="menuitemradio" aria-checked={now === v} className={now === v ? 'on' : ''} title={optionTitle?.(v)} onClick={() => pick(v)}>
              {option(v)}
            </button>
          ))}
          <button role="menuitemradio" aria-checked={now === undefined} className={now !== undefined ? 'none' : 'none on'} onClick={() => pick(null)}>
            {t.priority.none}
          </button>
        </div>
      )}
    </span>
  );
}

/** The unfolded card's pickers: priority, category, sub-category and complexity, one list open at a time. */
export function LabelPicks({ item }: { item: Item }) {
  const [open, setOpen] = useState<Label>();
  const at = (l: Label) => ({ open: open === l, setOpen: (on: boolean) => setOpen(on ? l : undefined) });
  const empty = (text: string, icon?: ReactNode) => (
    <span className="lchip-none">
      {icon}
      {text}
    </span>
  );
  return (
    <span className="label-picks">
      <LabelPick
        item={item}
        label="priority"
        values={PRIORITIES}
        shown={(p) => <PriorityMark priority={p} suggested={suggestedOf(item, 'priority')} />}
        empty={empty(t.priority.set, <Flag />)}
        option={(p) => <PriorityMark priority={p} />}
        {...at('priority')}
      />
      {CHIPPED.map((l) => (
        <LabelPick
          key={l}
          item={item}
          label={l}
          values={LABEL_VALUES[l]}
          shown={(v) => <Chip label={l} value={v} suggested={suggestedOf(item, l)} />}
          empty={empty(t.labels[l].label, l === 'complexity' ? <Bars complexity={1} /> : undefined)}
          option={(v) =>
            l === 'complexity' ? (
              <span className="lopt">
                <Bars complexity={v as Complexity} />
                <b>{v}</b>
              </span>
            ) : (
              chipText(l, v)
            )
          }
          optionTitle={l === 'complexity' ? (v) => t.labels.complexity.step(v as Complexity) : undefined}
          {...at(l)}
        />
      ))}
    </span>
  );
}
