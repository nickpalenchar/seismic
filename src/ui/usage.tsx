// The plans' usage limits in the status bar, a pill per harness signed in here (Claude Code's, and
// Codex's and Antigravity's beside it): behind the harness's logo, the session's and the week's, each
// with how much of it is used, coloured by the grade the usage endpoint gives it. A click (a tap on
// the phone) lists every limit with when it starts anew, where the numbers come from, and the button
// that hides them again (the setting in Konfiguration → Benachrichtigungen und Limits shows them again).

import { cn } from 'cn';
import { ClaudeCode, CodexIcon, GoogleAntigravityIcon } from '@dev.icons/react';
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

/** A limit's share used, in the colour of its grade. */
function Percent({ limit, className }: { limit: UsageLimit; className?: string }) {
  const grade = { critical: 'text-destructive', warning: 'text-waiting-strong' }[limit.severity as string];
  return <b className={cn('font-semibold tabular-nums', grade, className)}>{percent(limit.percent)}</b>;
}

// the harnesses' own logos, from devicons.io
const MARKS = { claude: ClaudeCode, codex: CodexIcon, agy: GoogleAntigravityIcon };

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
  const Mark = MARKS[usage.harness];
  const shown = compact ? groups.filter((l) => l === groups.reduce((a, b) => (b.percent > a.percent ? b : a))) : groups;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Pill variant={phone ? 'glass' : 'flat'} className="relative p-0" id={usage.harness === 'claude' ? 'usage' : `usage-${usage.harness}`}>
        <PopoverTrigger
          className={cn(statusFace, 'gap-4 rounded-full', phone ? 'gap-2.5 px-2.5 py-1.5 text-sm' : 'hover:bg-muted data-[state=open]:bg-muted')}
          aria-label={t.usage.title[usage.harness]}
        >
          <span className="-mr-1.5 flex items-center" title={t.usage.harness[usage.harness]}>
            <Mark size={14} className="block" aria-hidden />
          </span>
          {shown.map((l) => (
            <span key={l.group} className="flex items-center gap-1.5" title={compact ? limitName(l) : undefined}>
              {!compact && <span>{t.usage.groups[l.group] ?? limitName(l)}</span>}
              <Percent limit={l} />
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
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_42px] items-center gap-x-2 py-1">
              <span>{limitName(l)}</span>
              <Percent limit={l} className="text-right" />
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
