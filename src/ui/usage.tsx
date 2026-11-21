// The status bar shows one pill per connected harness that reports usage. Desktop pills have
// a bar under each percentage. The popover and Configuration → Harnesses share the limit
// details, including progress, reset times and the source.

import { cn } from 'cn';
import { ClaudeCode, CodexIcon, GoogleAntigravityIcon } from '@dev.icons/react';
import { useState } from 'react';
import type { Usage, UsageLimit } from '../core/types';
import { saveSetting } from './clients/seismic';
import { clock, failText, snoozeWhen, t } from './strings';
import { Button } from './components/button';
import { Popover, PopoverContent, PopoverTrigger } from './components/popover';
import { Pill } from './components/pill';
import { Progress } from './components/progress';
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

function Percent({ limit, className }: { limit: UsageLimit; className?: string }) {
  return <b className={cn('font-semibold tabular-nums', className)}>{percent(limit.percent)}</b>;
}

function UsageProgress({ limit, className }: { limit: UsageLimit; className?: string }) {
  return (
    <Progress
      aria-hidden="true"
      value={limit.percent}
      className={cn('bg-muted-foreground/25', className)}
      indicatorClassName={limit.percent >= 95 ? 'bg-destructive' : undefined}
    />
  );
}

// the harnesses' own logos, from devicons.io
const MARKS = { claude: ClaudeCode, codex: CodexIcon, agy: GoogleAntigravityIcon };

export function HarnessMark({ harness, size = 14 }: { harness: Usage['harness']; size?: number }) {
  const Mark = MARKS[harness];
  return <Mark size={size} className="block" aria-hidden />;
}

export function UsageDetails({ usage }: { usage: Usage }) {
  return (
    <>
      <ul className="m-0 mb-2 list-none p-0">
        {usage.limits.map((l, i) => (
          <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(2rem,5rem)_42px] items-center gap-x-2 py-1">
            <span className="wrap-anywhere">{limitName(l)}</span>
            <UsageProgress limit={l} className="h-[7px]" />
            <Percent limit={l} className="text-right" />
            {l.resetsAt && <span className="hint col-span-full">{t.usage.resets(snoozeWhen(l.resetsAt))}</span>}
          </li>
        ))}
      </ul>
      <p className="hint m-0 mb-1.5">{t.usage.source(usage.harness, clock(usage.at))}</p>
    </>
  );
}

/**
 * In the status bar; `phone`: at the right end of the phone's bar, a pill of glass; `compact`: every limit with a
 * one-letter name, so a weekly limit stays visible beside a higher session one (the phone, with another
 * harness's pill beside it).
 */
export function UsagePill({ usage, phone, compact }: { usage: Usage; phone?: boolean; compact?: boolean }) {
  // open by a click (a tap) until one elsewhere or Escape
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  if (!usage.limits.length) return null;
  const hide = () => {
    setStatus('');
    saveSetting('usageMeter', { on: false }).catch((e) => setStatus(failText(e)));
  };
  const groups = headline(usage.limits);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Pill variant={phone ? 'glass' : 'flat'} className="relative p-0" id={usage.harness === 'claude' ? 'usage' : `usage-${usage.harness}`}>
        <PopoverTrigger
          className={cn(statusFace, 'gap-4 rounded-full', phone ? 'gap-2.5 px-2.5 py-1.5 text-sm' : 'hover:bg-muted data-[state=open]:bg-muted')}
          aria-label={t.usage.title[usage.harness]}
        >
          <span className="-mr-1.5 flex items-center" title={t.usage.harness[usage.harness]}>
            <HarnessMark harness={usage.harness} />
          </span>
          {groups.map((l) => (
            <span key={l.group} className="relative flex items-center gap-1.5" title={compact ? limitName(l) : undefined}>
              <span className={cn(compact && 'text-muted-foreground')}>{(compact ? t.usage.groupsShort[l.group] : t.usage.groups[l.group]) ?? limitName(l)}</span>
              <Percent limit={l} />
              {!phone && <UsageProgress limit={l} className="absolute inset-x-0 top-full h-[3px]" />}
            </span>
          ))}
        </PopoverTrigger>
      </Pill>
      <PopoverContent side="top" align="end" aria-label={t.usage.title[usage.harness]} className="w-[min(380px,calc(100vw-16px))]">
        <p className="m-0 mb-1.5">
          <b>{t.usage.title[usage.harness]}</b>
        </p>
        <UsageDetails usage={usage} />
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
