// Snoozing a card until a point in time: the owner's "Later" with its presets and a date and time
// of their own, on a card's action row and as "Change" on the snooze line of its conversation, and
// that line with "Wake now". One component for every kind of card.

import { noteClass } from './components/ai/message';
import { Clock } from 'lucide-react';
import { cn } from 'cn';
import { useState } from 'react';
import type { CardEvent, Item, Snooze } from '../core/types';
import { api } from './api';
import { clock, t } from './strings';
import { Button, type ButtonVariant } from './components/button';
import { Popover, PopoverContent, PopoverTrigger } from './components/popover';
import { Input } from './components/input';

/** The clock mark of a snoozed card and of the button that snoozes one. */
export const ClockMark = () => (
  <Clock className="clock-mark" size={11} strokeWidth={1.75} aria-hidden />
);

/** Who snoozed the card and what its agent does then, as the card says it below its state. */
export const snoozeWho = (s: Snooze) => [t.snooze.by[s.by], s.why].filter(Boolean).join(' · ');

/** The times the menu offers from `now`: this evening (while it is still a while off), tomorrow morning, next Monday morning. */
export function snoozePresets(now: Date): { label: string; at: Date }[] {
  const at = (days: number, hour: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, 0);
  const evening = at(0, 18);
  const tomorrow = at(1, 8);
  const monday = at((8 - now.getDay()) % 7 || 7, 8);
  return [
    ...(evening.getTime() - now.getTime() > 30 * 60_000 ? [{ label: t.snooze.evening(clock(evening)), at: evening }] : []),
    { label: t.snooze.tomorrow(clock(tomorrow)), at: tomorrow },
    ...(monday.getTime() !== tomorrow.getTime() ? [{ label: t.snooze.monday(clock(monday)), at: monday }] : []),
  ];
}

/** A time as a `datetime-local` field holds it, in the browser's own time zone. */
const fieldValue = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * The button that snoozes the card ("Later", "Change") and its menu: the presets, and a date and
 * time to pick. `inline`: the menu opens below the button where the screen has room, else above it,
 * over the conversation rather than in it; else above the button where there is room. A proposal's start time is set with the same
 * menu (`heading`, `hint`), which can also take the time away (`clear`).
 */
export function SnoozeMenu({
  label,
  onSnooze,
  variant,
  size,
  inline = false,
  heading = t.snooze.heading,
  hint = t.snooze.hint,
  set = t.snooze.set,
  at,
  clear,
  mark = true,
}: {
  label: string;
  onSnooze: (until: string) => void;
  variant?: ButtonVariant;
  size?: 'default' | 'small';
  inline?: boolean;
  heading?: string;
  hint?: string;
  /** The button that takes the date and time picked. */
  set?: string;
  /** The time set now, which the field to pick one starts from. */
  at?: Date;
  clear?: { label: string; hint: string; onClear: () => void };
  /** The clock mark on the button; none where the line beside it has one. */
  mark?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [value, setValue] = useState('');
  const show = (on: boolean) => {
    setOpen(on);
    if (!on) setPicking(false);
  };
  const now = new Date();
  const go = (at: Date) => {
    show(false);
    onSnooze(at.toISOString());
  };
  const picked = value ? new Date(value) : null;
  const valid = !!picked && !Number.isNaN(picked.getTime()) && picked.getTime() > Date.now();
  const option = 'cursor-pointer border-0 bg-transparent px-3 py-[7px] text-left text-[13.5px] text-ink outline-none hover:bg-chip focus-visible:bg-chip';
  const more = 'mt-0.5 border-0 border-t border-solid border-line';
  return (
    <Popover open={open} onOpenChange={show}>
      {/* above the button in a card's action row; on the snooze line over the conversation, placed by script */}
      <div className="snooze-box inline-flex flex-col items-center">
        <PopoverTrigger asChild>
          <Button variant={variant} size={size} title={hint}>
            {mark && <ClockMark />} {label}
          </Button>
        </PopoverTrigger>
      </div>
      <PopoverContent side={inline ? 'bottom' : 'top'} align={inline ? 'center' : 'start'} sideOffset={6} aria-label={heading} className="flex w-auto min-w-[220px] flex-col px-0 py-1">
        <div className="px-3 pt-1.5 pb-1 text-[11.5px] text-muted-foreground">{heading}</div>
        {snoozePresets(now).map((p) => (
          <button key={p.label} className={option} onClick={() => go(p.at)}>
            {p.label}
          </button>
        ))}
        {picking ? (
          <form
            className={cn('flex items-center gap-2 px-3 py-2', more)}
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) go(picked);
            }}
          >
            <Input
              type="datetime-local"
              className="min-w-0"
              value={value}
              min={fieldValue(now)}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
            <Button variant="primary" disabled={!valid}>
              {set}
            </Button>
          </form>
        ) : (
          <button
            className={cn(option, more)}
            onClick={() => {
              setValue(fieldValue(at && at.getTime() > now.getTime() ? at : snoozePresets(now).at(-1)!.at));
              setPicking(true);
            }}
          >
            {t.snooze.pick}
          </button>
        )}
        {clear && (
          <button
            className={cn(option, more)}
            title={clear.hint}
            onClick={() => {
              show(false);
              clear.onClear();
            }}
          >
            {clear.label}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Snoozes the card until `until`, or wakes it; the card shows it once the server has. */
const snooze = (cardId: string, until: string) => void api.act(cardId, { action: 'snooze', until }).catch(() => {});
const wake = (cardId: string) => void api.act(cardId, { action: 'wake' }).catch(() => {});

/** The line in the conversation where the card was snoozed, while it still is: with "Wake now" and "Change". */
export function SnoozeLine({ item, e, at }: { item: Item; e: CardEvent; at: string }) {
  return (
    <div className={`${noteClass} ev-state snooze-line`}>
      <div>
        <ClockMark /> {at} · {e.text}
      </div>
      <div className="snooze-acts flex gap-2 items-start justify-center flex-wrap [--button-bg:var(--card)] mt-1">
        <Button size="small" title={t.snooze.wakeHint} onClick={() => wake(item.id)}>
          {t.snooze.wake}
        </Button>
        <SnoozeMenu label={t.snooze.change} size="small" inline onSnooze={(until) => snooze(item.id, until)} />
      </div>
    </div>
  );
}
