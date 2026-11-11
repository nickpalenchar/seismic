// The unfolded card's shared looks (Tailwind on frost's tokens), for parts that several components
// build: the row of decisions and the framed boxes the card's states put above it. The class names
// before the utilities (`actions`, `question brief`) stay as hooks for code that finds the element.

import { cn } from 'cn';

/**
 * The card's row of decisions. Deleting stands apart from what moves the card on; beside the two-line
 * Start agent button the other buttons take its height. As the last part of the unfolded card it is
 * its foot (`panel-foot` in tailwind.css): in view while a long text scrolls under it.
 */
export const actionsClass =
  'actions flex flex-wrap gap-2 mt-[18px] items-center [&>[data-slot=button][data-variant=danger]]:ml-auto has-[>.start-agent]:items-stretch [&:has(>.start-agent)>.snooze-box>[data-slot=button]]:flex-1 [.next-step+&]:mt-3 [.question.queue_&]:mt-2.5 [#panel_.content>&:last-child]:panel-foot phone:[&_[data-slot=button]]:min-h-[42px]';

/** What a framed box on the card is about: each in the colour of what it is. */
export type QuestionKind =
  | 'ask'
  | 'brief'
  | 'duplicate-notice'
  | 'failed'
  | 'pr'
  | 'proposal'
  | 'queue'
  | 'repo-down'
  | 'settled'
  | 'superseded';

const kinds: Record<QuestionKind, string> = {
  // an agent's questions, one after the other; in the conversation a turn of its own
  ask: '[&_.ask-q+.ask-q]:mt-3 [&_.ask-q+.ask-q]:pt-2.5 [&_.ask-q+.ask-q]:border-t [&_.ask-q+.ask-q]:border-[color-mix(in_srgb,var(--waiting)_30%,transparent)] [&.flash]:animate-[msg-flash_2.4s_ease-out] [.talk_&]:m-0 [.talk_&]:max-w-[92%] [.talk_&]:py-2.5 [.talk_&]:px-3 [.talk_&]:text-[14px] [.talk_&]:flex-none [.talk_&]:bg-[color-mix(in_srgb,var(--waiting)_9%,var(--card))]',
  brief: 'border-idea bg-[color-mix(in_srgb,var(--idea)_6%,transparent)] [&_.p-lead]:text-[14px] [&_.p-list]:mt-1',
  'duplicate-notice': 'max-w-none border-proposal bg-[color-mix(in_srgb,var(--proposal)_7%,var(--card))] [&_h4]:mb-[5px] [&_h4]:text-proposal [&>p]:m-0 [&_.duplicate-preview]:mt-3.5',
  failed: 'border-error bg-[color-mix(in_srgb,var(--error)_6%,transparent)]',
  pr: 'border-in-pr bg-[color-mix(in_srgb,var(--inPr)_7%,transparent)] [&_h4_a]:text-ink [&_h4_a]:normal-case [&_h4_a]:tracking-normal [&_h4_a]:text-[14px]',
  proposal: 'border-dashed border-proposal',
  queue: 'border-planned bg-chip [--button-bg:var(--card)]',
  'repo-down': 'border-warn bg-[color-mix(in_srgb,var(--warn)_6%,transparent)]',
  // the settled part "Split off a task" builds, folded under the brief
  settled: 'border-idea bg-[color-mix(in_srgb,var(--idea)_6%,transparent)] mt-2.5 [&>[data-slot=collapsible-trigger]]:font-semibold [&>[data-slot=collapsible-trigger]]:text-[14px]',
  superseded: 'border-proposal bg-[color-mix(in_srgb,var(--proposal)_6%,transparent)]',
};

/** A framed box on the card (a question, the brief, the queue …), in the waiting colour unless its kind says otherwise. */
export const questionClass = (kind?: QuestionKind, className?: string) =>
  cn(
    'question mt-[18px] py-3.5 px-[18px] rounded-[3px] border-[1.5px] border-solid border-waiting max-w-[80ch] bg-[color-mix(in_srgb,var(--waiting)_9%,transparent)] text-[15px] [&_h4]:mt-0 [&_h4]:mb-1.5 [&_h4]:text-[11px] [&_h4]:uppercase [&_h4]:tracking-[.08em] [&_h4]:text-muted-foreground [&_.q-text]:whitespace-pre-wrap [&_.p-lead]:mt-1.5 [&_.p-lead]:text-[14.5px] [.split-main_&]:max-w-none',
    kind && [kind === 'settled' ? 'brief settled' : kind, kinds[kind]],
    className,
  );

/** The card's title, as text or as the field that edits it; smaller on the phone, over the phone's 16px for every field there. */
export const titleClass =
  'p-title text-[31px] mt-0.5 mb-1.5 leading-[1.12] [font-family:var(--font)] font-[650] tracking-[-.018em] phone:text-[26px]!';

/** The title's field: one line that wraps, clear of the panel's ✕. */
export const titleFieldClass = cn(titleClass, 'block w-[calc(100%-40px)] resize-none overflow-hidden placeholder:font-normal placeholder:italic');

/** The card's state line under its title, in the state's colour (`--c`, set per state with the card faces' rules). */
export const stateClass =
  'p-state text-[13px] font-semibold text-[color-mix(in_srgb,var(--c),var(--ink)_var(--state-text-ink))] [&_:is(.merge-mark,.restart-mark,.question-mark)]:align-[-1px] [&+.p-src]:mt-1';

/** What the state line adds after it (who snoozed it, the agent's status line), quieter. */
export const statusClass = 'p-status text-muted-foreground font-medium [&.conflict]:text-waiting [&.conflict]:italic';

/**
 * The task's text with its linked cards as pills in the line: it wraps as a text box does, grows with its
 * text and then scrolls; a proposal's grows with the text (detail.tsx) and leaves the reason below it in view.
 */
export const bodyClass =
  'p-body block box-border w-full max-w-[76ch] min-h-[180px] mt-4 py-3 px-3.5 border border-line rounded-[3px] bg-card text-[15px] leading-normal outline-none focus:border-muted-foreground resize-none whitespace-pre-wrap break-words max-h-[70vh] overflow-y-auto cursor-text [&.blank]:before:content-[attr(data-placeholder)] [&.blank]:before:text-muted-foreground [&.blank]:before:pointer-events-none [&.blank]:before:absolute [&_.smart-link]:cursor-default [&_.smart-link]:select-all [&_.smart-link]:align-[1px] [.split-main_&]:max-w-none [.c-field_&]:pr-10 [.dropping_&]:border-working [.dropping_&]:border-dashed [.dropping_&]:bg-[color-mix(in_srgb,var(--working)_6%,var(--card))] [.proposal-grid_&]:min-h-[min(360px,calc(100vh-440px))] [.proposal-grid_&]:max-h-[calc(100vh-440px)] phone:[.proposal-grid_&]:min-h-[160px] phone:[.proposal-grid_&]:max-h-[50vh]';

/** A small heading over a part of the card (the conversation, the plan's text, the findings). */
export const headClass =
  'p-h mt-[22px] mb-1.5 text-[11px] uppercase tracking-[.08em] text-muted-foreground [.split-talk_&]:mt-0 [.split-main_.p-plan_&]:mt-0';

/**
 * The box around a conversation's messages (`Scroll`'s frame, `conversationList` inside it): under a
 * card's demo and pull request, scrolled to its end. In the card's column it takes the column's height;
 * the lane of a scrollbar that takes room stays whether it scrolls or not, else WebKit laid the text out
 * anew with each key typed, and the field jumped.
 */
export const conversationBox =
  'conv flex flex-col max-h-[min(520px,60vh)] max-w-[100ch] [.split-talk_&]:flex-1 [.split-talk_&]:min-h-0 [.split-talk_&]:max-h-none [.split-talk_&]:max-w-none max-[760px]:[.split-talk_&]:min-h-[240px] max-[760px]:[.split-talk_&]:max-h-[min(520px,60vh)]';

/** The messages in it, one under the other. */
export const conversationList = 'talk py-1 px-1 flex flex-col gap-2';

/** The options an agent's question offers (`single` as radio buttons, `multiple` as checkboxes), the owner's own answer last. */
export const choicesClass = (mode?: 'single' | 'multiple', className?: string) =>
  cn('choices group/choices flex flex-wrap items-start gap-1.5 mt-2 [&_.hint]:basis-full', mode, className);

/**
 * One option, its mark drawn before it. `picked`: what the asking agent would pick itself, in the colour
 * of ideas, its opinion to follow or overrule. `other`: the owner's own answer, written in the option itself, its field in the option's font (on the
 * phone the 16px of every field there wins, so focusing it does not zoom the page).
 */
export const choiceClass = ({ on, picked, other, alone }: { on?: boolean; picked?: boolean; other?: boolean; alone?: boolean }) =>
  cn(
    "choice flex items-start gap-[9px] text-left bg-card border border-line rounded-[3px] py-[5px] pr-[11px] pl-[9px] text-[13.5px] text-ink cursor-pointer max-w-full hover:border-muted-foreground before:content-[''] before:flex-none before:size-[14px] before:mt-0.5 before:box-border before:border-[1.5px] before:border-solid before:border-muted-foreground before:bg-card group-[.single]/choices:before:rounded-full group-[.multiple]/choices:before:rounded-[2px] [.prototype-variants_&]:basis-full",
    on && 'on border-waiting hover:border-waiting bg-[color-mix(in_srgb,var(--waiting)_8%,var(--card))] before:border-waiting group-[.single]/choices:before:bg-[radial-gradient(var(--waiting)_0_3.5px,var(--card)_4px)] group-[.multiple]/choices:before:choice-checked',
    picked && 'picked border-[color-mix(in_srgb,var(--idea)_55%,var(--line))]',
    other && 'other basis-full box-border cursor-text [&_textarea]:flex-1 [&_textarea]:min-w-0 [&_textarea]:m-0 [&_textarea]:resize-none [&_textarea]:[font:inherit] [&_textarea]:text-inherit [&_textarea]:leading-[inherit] [&_textarea]:[field-sizing:content] [&_textarea]:min-h-lh',
    alone && 'alone before:content-none',
  );

/** The tag on the option the asking agent would pick. */
export const pickTag = 'pick-tag inline-block ml-1.5 px-[7px] rounded-[2px] text-[11px] font-bold leading-[18px] whitespace-nowrap text-idea bg-[color-mix(in_srgb,var(--idea)_10%,var(--card))]';
