// The shared looks of the rules list and the Koordinator's proposals (Tailwind on frost's tokens): the
// owner's rules in Preferences, the proposed rules and settings in the inbox, and the shared demos to share
// again in the Koordinator's sheet are rows of the same list. The class names before the utilities
// (`prefs`, `pref-text`, `occasion` …) stay as hooks. An error under a row takes the row's width without
// the primitive's margin (in Configuration's dialogs, theirs).

import { cn } from 'cn';

/** The list of the owner's rules. */
export const prefsClass = 'prefs list-none p-0 mt-2.5 mx-0 mb-0 [&_.p-error]:basis-full [&_.p-error]:m-0';

/** A list of proposals (rules, settings, demos to share again). */
export const proposalsClass = cn(prefsClass, 'proposals');

/** A row: the rule's text, what it came from and its buttons, wrapping onto lines of their own. */
export const prefRowClass = 'flex flex-wrap gap-2 items-start pt-[7px] pr-2 pb-[7px] pl-2.5 my-1.5 mx-0 rounded-[3px] bg-chip text-[13px] cursor-default';

/** A proposal's row, tinted as a proposal. */
export const proposalRowClass = cn(prefRowClass, 'bg-[color-mix(in_srgb,var(--proposal)_9%,var(--chip))]');

/** A rule's text, clicked to edit it. */
export const prefTextClass = 'pref-text flex-1 cursor-text min-w-0 [overflow-wrap:anywhere]';

/** What a proposal says, which is not edited by a click. */
export const proposalTextClass = cn(prefTextClass, 'cursor-default font-semibold');

/** A line under the text: where the rule came from, what a run does now. */
export const occasionClass = 'occasion basis-full text-muted-foreground text-[12px] [overflow-wrap:anywhere] [&_q]:italic';

/** A row's buttons, on a line of their own. */
export const prefActionsClass = 'pref-actions basis-full flex flex-wrap gap-1.5 mt-0.5';

/** Where a rule goes, its picker on a line of its own. */
export const targetClass = 'target basis-full flex items-center gap-1.5 text-muted-foreground text-[12px]';

/** A link in a proposal's lines (to the configuration, back to the proposed value). */
export const fromLinkClass = 'from text-ink cursor-pointer underline decoration-line underline-offset-2';

/** What a setting's value is (now, proposed), beside it. */
export const settingLabelClass = 'setting-label text-muted-foreground text-[12px] pt-1.5';

/** A setting's value as it is now and as proposed, in the code font; `!` keeps the field at its size over the phone's 16px for every field. */
export const settingValueClass =
  'setting-value basis-full m-0 [font-family:var(--mono)] text-[12px]! leading-[1.45] whitespace-pre-wrap [overflow-wrap:anywhere] bg-card rounded-[2px] py-1.5 px-2';
