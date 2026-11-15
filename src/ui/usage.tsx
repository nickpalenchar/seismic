// The plans' usage limits in the status bar, a pill per harness signed in here (Claude Code's, and
// Codex's beside it): behind the harness's mark, the session's and the week's, each as a short meter with how much of it is used, in
// the grade the usage endpoint gives it. A click (a tap on the phone) lists
// every limit with when it starts anew, where the numbers come from, and the button
// that hides them again (the setting in Konfiguration → Benachrichtigungen und Limits shows them again).

import { cn } from 'cn';
import { Progress } from './components/progress';
import { useState } from 'react';
import type { Usage, UsageLimit } from '../core/types';
import { api } from './api';
import { clock, failText, snoozeWhen, t } from './strings';
import { Button } from './components/button';
import { Popover, PopoverContent, PopoverTrigger } from './components/popover';
import { Pill } from './components/pill';
import { statusFace } from './parts';

/** The limit of a group the bar shows: the one most used, the first of those on a tie. */
export function headline(limits: UsageLimit[]): UsageLimit[] {
  const groups = new Map<string, UsageLimit>();
  for (const l of limits) {
    const shown = groups.get(l.group);
    if (!shown || l.percent > shown.percent) groups.set(l.group, l);
  }
  return [...groups.values()];
}

/** A limit as the list names it. */
export function limitName(l: UsageLimit): string {
  if (l.scope) return t.usage.scoped(l.scope, l.group);
  return t.usage.kinds[l.kind] ?? t.usage.groups[l.group] ?? l.kind;
}

const percent = (n: number) => `${Math.round(n)} %`;

/** A limit's meter: short in the bar, `wide` in the list. */
function Meter({ limit, wide }: { limit: UsageLimit; wide?: boolean }) {
  return (
    <Progress
      value={limit.percent}
      aria-label={limitName(limit)}
      className={cn('h-[9px] flex-none rounded-xs shadow-[inset_0_0_0_1px_var(--border)]', wide ? 'w-[60px]' : 'w-[26px]')}
      indicatorClassName={cn('rounded-[inherit] duration-0', { critical: 'bg-destructive', warning: 'bg-waiting' }[limit.severity as string] ?? 'bg-muted-foreground')}
    />
  );
}

/** Claude's mark, small: which harness the limits beside it belong to. */
function ClaudeMark() {
  // a starburst of rounded rays of uneven length, in Claude's terracotta
  const rays = [10, 7.5, 9, 6.5, 10, 8, 9.5, 7, 10, 7.5, 9, 6.5];
  return (
    <svg className="block stroke-orange-400 stroke-[2.6] [stroke-linecap:round]" viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      {rays.map((r, i) => {
        const a = (i / rays.length) * 2 * Math.PI - Math.PI / 2;
        return <line key={i} x1={12} y1={12} x2={12 + r * Math.cos(a)} y2={12 + r * Math.sin(a)} />;
      })}
    </svg>
  );
}

/** Codex's mark, small: a terminal prompt in a rounded square. */
function CodexMark() {
  return (
    <svg className="block fill-none stroke-current stroke-[2.2] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <rect x="2.5" y="3.5" width="19" height="17" rx="4.5" />
      <path d="M7.5 9.5l3 2.5-3 2.5M12.5 15h4" />
    </svg>
  );
}

/**
 * In the status bar; `phone`: at the right end of the phone's bar, a pill of glass; `compact`: only
 * the most used limit, without its name (the phone, with another harness's pill beside it).
 */
export function UsagePill({ usage, phone, compact }: { usage: Usage; phone?: boolean; compact?: boolean }) {
  // open by a click (a tap) until one elsewhere or Escape
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  if (!usage.limits.length) return null;
  const hide = () => {
    setStatus('');
    api.saveUsageMeter(false).catch((e) => setStatus(failText(e)));
  };
  const groups = headline(usage.limits);
  const shown = compact ? groups.filter((l) => l === groups.reduce((a, b) => (b.percent > a.percent ? b : a))) : groups;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Pill variant={phone ? 'glass' : 'flat'} className="relative p-0" id={usage.harness === 'claude' ? 'usage' : `usage-${usage.harness}`}>
        <PopoverTrigger
          className={cn(statusFace, 'gap-4 rounded-full', phone ? 'gap-2.5 px-2.5 py-1.5 text-sm' : 'hover:bg-muted data-[state=open]:bg-muted')}
          aria-label={t.usage.title[usage.harness]}
        >
          <span className="-mr-1.5 flex items-center" title={t.usage.harness[usage.harness]}>
            {usage.harness === 'codex' ? <CodexMark /> : <ClaudeMark />}
          </span>
          {shown.map((l) => (
            <span key={l.group} className="flex items-center gap-1.5" title={compact ? limitName(l) : undefined}>
              {!compact && <span>{t.usage.groups[l.group] ?? limitName(l)}</span>}
              <Meter limit={l} />
              <b className={cn('font-semibold tabular-nums', l.severity === 'critical' && 'text-destructive')}>{percent(l.percent)}</b>
            </span>
          ))}
        </PopoverTrigger>
      </Pill>
      <PopoverContent side="top" align="end" aria-label={t.usage.title[usage.harness]} className="w-[min(380px,calc(100vw-16px))]">
        <p className="m-0 mb-1.5">
          <b>{t.usage.title[usage.harness]}</b>
        </p>
        <ul className="m-0 mb-2 list-none p-0">
          {usage.limits.map((l, i) => (
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_60px_42px] items-center gap-x-2 py-1">
              <span>{limitName(l)}</span>
              <Meter limit={l} wide />
              <b className={cn('text-right font-semibold tabular-nums', l.severity === 'critical' && 'text-destructive')}>{percent(l.percent)}</b>
              {l.resetsAt && <span className="hint col-span-full">{t.usage.resets(snoozeWhen(l.resetsAt))}</span>}
            </li>
          ))}
        </ul>
        <p className="hint m-0 mb-1.5">{t.usage.source(usage.harness, clock(usage.at))}</p>
        <p className="hint m-0">
          <Button size="small" onClick={hide}>
            {t.usage.hide}
          </Button>{' '}
          {t.usage.hideHint}
        </p>
        {status && <p className="m-0 mt-1.5 text-warning">{status}</p>}
      </PopoverContent>
    </Popover>
  );
}
