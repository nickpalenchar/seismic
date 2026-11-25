



import { cn } from 'cn';
import type { ReviewItem, Severity } from '../core/types';

/** The section that holds them; `code` for a code review's, whose buttons stand a little apart. */
export const findingsClass = (code?: boolean) =>
  cn('findings mt-2.5 mb-3 text-sm', code && 'code-review [&>[data-slot=button]]:mt-1.5');


export const findingsHead = 'mt-2 mb-1.5';

/** The checks on the PR's head and the merge probe, on one line: green when all pass, red when not. */
export const checksClass = (ok: boolean) => cn('rr-checks text-sm mb-1.5', ok ? 'ok text-approved' : 'bad text-destructive');


export const badClass = 'bad text-destructive';

/** One finding, framed; a security finding's frame in the error colour, a settled one faded, a folded one lower. */
export const findingClass = ({ security, settled, folded, extra }: { security?: boolean; settled?: boolean; folded?: boolean; extra?: (string | false | undefined)[] }) =>
  cn(
    'finding border border-border rounded-md py-2 px-2.5 mb-1.5 bg-card [.f-bundle>&:last-child]:mb-0',
    security && 'security border-destructive/50',
    settled && 'settled opacity-70',
    folded && 'folded py-1.5',
    extra,
  );


export const findingHead = 'f-head flex items-baseline gap-1.5';


export const findingFold = cn(findingHead, 'f-fold group/fold w-full');


export const findingRow = 'f-row flex items-baseline gap-2 [&>.f-fold]:flex-1 [&>.f-fold]:min-w-0';


export const findingChevron = 'f-chevron ml-auto self-center flex text-muted-foreground group-hover/fold:text-foreground';

export const findingNo = 'f-no text-muted-foreground tabular-nums';


export const findingTag = 'f-tag text-2xs text-destructive border border-current rounded-md px-1.5';

export const findingText = 'f-text mt-1 text-foreground leading-[1.4]';


export const findingWhere = 'f-where mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]';

/** What came of it; `pending` what is going to, in the working colour. */
export const findingStatus = (pending?: boolean) => cn('f-status mt-1 text-xs text-muted-foreground', pending && 'pending text-working');


export const findingChoices = 'f-choices mt-1.5';


export const findingContext = 'f-context mt-1.5 flex flex-col items-end gap-1 [&_textarea]:w-full [&_textarea]:box-border [&>.f-note]:self-stretch [&>.f-note]:m-0';
export const findingNote = 'f-note mt-1 mb-0 text-sm whitespace-pre-wrap bg-muted rounded-sm py-1 px-2';
export const findingContextButton = 'f-context-btn bg-transparent py-0.5 px-0 text-xs text-working underline cursor-pointer';


export const findingLog = 'f-log mt-1.5 mb-0 pt-1 pb-0 px-0 border-t border-border list-none text-2xs leading-normal text-muted-foreground';


export const findingReopen = 'f-reopen text-xs leading-[1.25] whitespace-nowrap self-center';


export const bundleClass = 'f-bundle mb-2';
export const bundleHead = 'f-bundle-head text-xs text-warning mb-1';


const severity: Record<Severity, string> = {
  blocker: '[--sev:var(--color-purple-700)] text-purple-50! bg-purple-950!',
  critical: '[--sev:var(--color-red-600)] text-white! bg-red-600!',
  major: '[--sev:var(--color-rose-700)] [--badge-ink:var(--color-rose-800)] dark:[--badge-ink:var(--color-rose-300)]',
  minor: '[--sev:var(--waiting)] [--badge-ink:var(--color-orange-800)] dark:[--badge-ink:var(--color-orange-300)]',
  low: '[--sev:var(--asking)] [--badge-ink:var(--color-yellow-800)] dark:[--badge-ink:var(--color-yellow-400)]',
  info: '[--sev:var(--muted-foreground)] [--badge-ink:var(--foreground)]',
};

/** The severity badge in a finding's head. */
export const severityBadge = (s: Severity) =>
  cn('f-sev self-center text-2xs leading-4 rounded-sm px-1 text-[var(--badge-ink,var(--sev))] bg-[color:--alpha(var(--sev)/16%)]', s, severity[s]);


const fixingRoom = 'relative mr-8';


export const fixingBadge = cn('f-fixing self-center text-2xs leading-4 text-teal-50 bg-teal-800 rounded-sm px-1', fixingRoom);


export const fixingLine = 'absolute left-[calc(100%+5px)] top-[calc(50%-1px)] w-6';


const pills: Record<string, string> = {
  raised: 'text-rose-800 bg-rose-600/14 dark:text-rose-300',
  reopened: 'text-amber-800 bg-amber-100 dark:text-amber-300 dark:bg-amber-950',
  fixing: cn('text-teal-50 bg-teal-800', fixingRoom),
  underReview: 'text-sky-800 bg-sky-100 dark:text-sky-300 dark:bg-sky-950',
  'done-fix': 'text-green-800 bg-green-100 dark:text-green-300 dark:bg-green-950',
  closed: 'text-muted-foreground bg-muted',
  followUp: 'text-violet-800 bg-violet-100 dark:text-violet-300 dark:bg-violet-950',
};

/** An item's status; in its text it follows the words. */
export const statusPill = (status: ReviewItem['status']) => {
  const key = status === 'fixed' ? 'done-fix' : status;
  return cn(
    'f-pill self-center inline-flex items-center gap-1 text-2xs leading-4 rounded-md px-2 whitespace-nowrap text-foreground bg-muted [.f-text_&]:ml-1 [.f-text_&]:align-[1px]',
    key,
    pills[key],
  );
};


const counts: Record<Severity, string> = {
  blocker: '[--sev:var(--color-purple-700)] dark:[--sev:var(--color-purple-300)]',
  critical: '[--sev:var(--color-red-600)] dark:[--sev:var(--color-red-300)]',
  major: '[--sev:var(--color-rose-700)] dark:[--sev:var(--color-rose-300)]',
  minor: '[--sev:var(--waiting)]',
  low: '[--sev:var(--asking)]',
  info: '[--sev:var(--muted-foreground)]',
};
export const reviewCount = (s: Severity) => cn('rv-count ml-1.5 inline-flex items-center gap-0.5 text-[var(--sev)] font-semibold tabular-nums', s, counts[s]);


export const reviewRunningDot = 'rv-running inline-block size-[7px] ml-2 align-middle rounded-full bg-reviewing animate-[arranging_1.2s_ease-in-out_infinite]';
export const reviewBusy = 'rv-busy my-1 font-semibold text-reviewing-strong animate-[arranging_1.6s_ease-in-out_infinite]';


export const reviewClean = 'rv-clean size-4 ml-1.5 align-middle text-approved stroke-3';


export const reviewOutdated = 'rv-outdated ml-1.5 text-2xs font-normal text-muted-foreground border border-border rounded-md px-1.5';


export const reviewSubmit = 'review-submit mt-0.5 flex flex-wrap items-stretch gap-1.5 [&>.start-agent>.start-agent-buttons]:h-full [&>.p-error]:basis-full [&>.p-error]:m-0!';


export const clashClass = 'rr-clash border border-warning/50 rounded-md py-2 px-2.5 mb-2 bg-card leading-[1.4] [&_b]:text-warning';
export const clashPush = 'rr-clash-push mt-2 flex items-center gap-2.5 [&>span]:text-foreground [&>span]:text-sm';
export const clashWhat = 'rr-clash-what mt-1.5 text-muted-foreground text-sm';
export const blockedFiles = 'blocked-files mt-1.5 mb-0 pl-4';


export const decidedLines = 'decided-lines flex-1 min-w-0 flex flex-col gap-px pt-1 px-2 pb-1.5';
export const decidedTasks = 'decided-tasks text-xs text-muted-foreground';
