// The findings of a review on the unfolded card (Tailwind on frost's tokens): a review card's findings
// with its checks and merge probe, the items of a card's code review in its Review tab, and the counts
// beside that tab. The class names before the utilities (`finding`, `f-sev` …) stay as hooks.

import { cn } from 'cn';
import type { ReviewItem, Severity } from '../core/types';

/** The section that holds them; `code` for a code review's, whose buttons stand a little apart. */
export const findingsClass = (code?: boolean) =>
  cn('findings mt-2.5 mb-3 text-[13px]', code && 'code-review [&>[data-slot=button]]:mt-1.5');

/** The heading over the findings: closer to them than the card's other headings. */
export const findingsHead = 'mt-2 mb-1.5';

/** The checks on the PR's head and the merge probe, on one line: green when all pass, red when not. */
export const checksClass = (ok: boolean) => cn('rr-checks text-[12.5px] mb-1.5', ok ? 'ok text-approved' : 'bad text-error');

/** A failure in the list (the code review that failed), in the error colour. */
export const badClass = 'bad text-error';

/** One finding, framed; a security finding's frame in the error colour, a settled one faded, a folded one lower. */
export const findingClass = ({ security, settled, folded, extra }: { security?: boolean; settled?: boolean; folded?: boolean; extra?: (string | false | undefined)[] }) =>
  cn(
    'finding border border-line rounded-[8px] py-2 px-2.5 mb-1.5 bg-card [.f-bundle>&:last-child]:mb-0',
    security && 'security border-[color-mix(in_srgb,var(--error)_50%,var(--line))]',
    settled && 'settled opacity-70',
    folded && 'folded py-1.5',
    extra,
  );

/** Its head line: number, badges, title. */
export const findingHead = 'f-head flex items-baseline gap-1.5';

/** The head as the fold's trigger, a click unfolding the finding. */
export const findingFold = cn(findingHead, 'f-fold group/fold w-full');

/** The trigger beside the reopen link: it takes what the link leaves. */
export const findingRow = 'f-row flex items-baseline gap-2 [&>.f-fold]:flex-1 [&>.f-fold]:min-w-0';

/** The chevron at the head's end, darker while the head is hovered. */
export const findingChevron = 'f-chevron ml-auto self-center flex text-muted-foreground group-hover/fold:text-ink';

export const findingNo = 'f-no text-muted-foreground tabular-nums';

/** "Security", framed in the error colour. */
export const findingTag = 'f-tag text-[11px] text-error border border-current rounded-[8px] px-1.5';

export const findingText = 'f-text mt-[3px] text-ink leading-[1.4]';

/** Where it is (file and line), or which items it goes with. */
export const findingWhere = 'f-where mt-[3px] text-[12px] text-muted-foreground [overflow-wrap:anywhere]';

/** What came of it; `pending` what is going to, in the working colour. */
export const findingStatus = (pending?: boolean) => cn('f-status mt-[5px] text-[12px] text-muted-foreground', pending && 'pending text-working');

/** The decision's options on a finding. */
export const findingChoices = 'f-choices mt-1.5';

/** The owner's own words on a finding: the field, the saved words, the link that opens or saves them. */
export const findingContext = 'f-context mt-1.5 flex flex-col items-end gap-1 [&_textarea]:w-full [&_textarea]:box-border [&>.f-note]:self-stretch [&>.f-note]:m-0';
export const findingNote = 'f-note mt-[5px] mb-0 text-[13px] whitespace-pre-wrap bg-chip rounded-[6px] py-[5px] px-2';
export const findingContextButton = 'f-context-btn border-0 bg-transparent py-0.5 px-0 text-[12px] text-working underline cursor-pointer';

/** An item's history, under a line. */
export const findingLog = 'f-log mt-1.5 mb-0 pt-1 pb-0 px-0 border-t border-line list-none text-[11px] leading-normal text-muted-foreground';

/** "Reopen" beside a closed or fixed item's head. */
export const findingReopen = 'f-reopen text-[12px] leading-[1.25] whitespace-nowrap self-center';

/** Findings that would make one follow-up task, under a line that says so. */
export const bundleClass = 'f-bundle mb-2';
export const bundleHead = 'f-bundle-head text-[12px] text-warn mb-1';

/** A severity's colour (`--sev`) and, where its own colour is too light for text, the text's (`--badge-ink`). */
const severity: Record<Severity, string> = {
  blocker: '[--sev:#93409b] text-[#fff1ff]! bg-[#461447]!',
  critical: '[--sev:#d00018] text-white! bg-[#d00018]!',
  major: '[--sev:#b93643] [--badge-ink:#8e2834] dark:[--badge-ink:#f4a0aa]',
  minor: '[--sev:var(--waiting)] [--badge-ink:#78400a] dark:[--badge-ink:#ffad60]',
  low: '[--sev:var(--asking)] [--badge-ink:#65510a] dark:[--badge-ink:#e0b62e]',
  info: '[--sev:var(--muted-foreground)] [--badge-ink:var(--ink)]',
};

/** The severity badge in a finding's head. */
export const severityBadge = (s: Severity) =>
  cn('f-sev self-center text-[11px] leading-4 rounded-[4px] px-[5px] text-[var(--badge-ink,var(--sev))] bg-[color-mix(in_srgb,var(--sev)_16%,transparent)]', s, severity[s]);

/** A line drawing itself after the badge of what the agent is fixing (the `draw` keyframes). */
const fixingLine =
  "relative mr-[30px] after:content-[''] after:absolute after:left-[calc(100%+5px)] after:top-[calc(50%-1px)] after:w-6 after:h-0.5 after:[background:linear-gradient(90deg,#11645f_0_50%,transparent_50%)_0_0/200%_100%_no-repeat,#11645f38] after:animate-[draw_1.6s_cubic-bezier(.5,0,.3,1)_infinite]";

/** "Fixing" on a review card's finding the owner gave the card's agent. */
export const fixingBadge = cn('f-fixing self-center text-[11px] leading-4 text-[#e6fbf8] bg-[#11645f] rounded-[4px] px-[5px]', fixingLine);

/** Each status of a code review's item, in its colours. */
const pills: Record<string, string> = {
  raised: 'text-[#8e2834] bg-[color-mix(in_srgb,#b93643_14%,transparent)] dark:text-[#f4a0aa]',
  reopened: 'text-[#8a5200] bg-[#fde7c4] dark:text-[#ffcd85] dark:bg-[#5a3c0a]',
  fixing: cn('text-[#e6fbf8] bg-[#11645f]', fixingLine),
  underReview: 'text-[#145a8c] bg-[#dceefc] dark:text-[#9fd0f5] dark:bg-[#173a56]',
  'done-fix': 'text-[#1b7a2e] bg-[#dcf5e0] dark:text-[#8fdca0] dark:bg-[#17391f]',
  closed: 'text-muted-foreground bg-chip',
  followUp: 'text-[#5b3f9a] bg-[#ebe3fb] dark:text-[#c9b4f5] dark:bg-[#33265a]',
};

/** An item's status; in its text it follows the words. */
export const statusPill = (status: ReviewItem['status']) => {
  const key = status === 'fixed' ? 'done-fix' : status;
  return cn(
    'f-pill self-center inline-flex items-center gap-[3px] text-[11px] leading-4 rounded-[9px] px-[7px] whitespace-nowrap text-ink bg-chip [.f-text_&]:ml-1 [.f-text_&]:align-[1px]',
    key,
    pills[key],
  );
};

/** The counts beside the Review tab: one per severity of what waits for the owner. */
const counts: Record<Severity, string> = {
  blocker: '[--sev:#93409b] dark:[--sev:#d58bdb]',
  critical: '[--sev:#d00018] dark:[--sev:#ff818c]',
  major: '[--sev:#b93643] dark:[--sev:#f4a0aa]',
  minor: '[--sev:var(--waiting)]',
  low: '[--sev:var(--asking)]',
  info: '[--sev:var(--muted-foreground)]',
};
export const reviewCount = (s: Severity) => cn('rv-count ml-1.5 inline-flex items-center gap-0.5 text-[var(--sev)] font-semibold tabular-nums', s, counts[s]);

/** The review running, a dot that breathes beside the tab's label; in the panel, the line that says so. */
export const reviewRunningDot = 'rv-running inline-block size-[7px] ml-[7px] align-middle rounded-[50%] bg-reviewing animate-[arranging_1.2s_ease-in-out_infinite]';
export const reviewBusy = 'rv-busy my-1 font-semibold text-reviewing animate-[arranging_1.6s_ease-in-out_infinite]';

/** Nothing open: a check beside the tab's label. */
export const reviewClean = 'rv-clean size-4 ml-1.5 align-middle text-approved stroke-3';

/** "outdated" beside the tab's label, where the review looked at an earlier handover. */
export const reviewOutdated = 'rv-outdated ml-1.5 text-[11px] font-normal text-muted-foreground border border-line rounded-[8px] px-1.5';

/** Send the choices, beside "with a new agent"; an error takes its own line. */
export const reviewSubmit = 'review-submit mt-3.5 flex flex-wrap items-stretch gap-1.5 [&>.start-agent>.start-agent-buttons]:h-full [&>.p-error]:basis-full [&>.p-error]:m-0!';

/** What stands in the way of landing (main's unpushed commits a PR collides with, or uncommitted files), in the warning colour. */
export const clashClass = 'rr-clash border border-[color-mix(in_srgb,var(--warn)_50%,var(--line))] rounded-[8px] py-2 px-2.5 mb-2 bg-card leading-[1.4] [&_b]:text-warn';
export const clashPush = 'rr-clash-push mt-2 flex items-center gap-2.5 [&>span]:text-ink [&>span]:text-[12.5px]';
export const clashWhat = 'rr-clash-what mt-1.5 text-muted-foreground text-[12.5px]';
export const blockedFiles = 'blocked-files mt-1.5 mb-0 pl-[18px]';

/** Above the field: what the owner decided for the findings, one line each, and how many tasks they make. */
export const decidedLines = 'decided-lines flex-1 min-w-0 flex flex-col gap-px pt-[5px] px-[9px] pb-1.5';
export const decidedTasks = 'decided-tasks text-[12px] text-muted-foreground';
