



import { cn } from 'cn';






export const actionsClass =
  'actions flex flex-wrap gap-2 mt-4 items-center [&>[data-slot=button][data-variant=danger]]:ml-auto has-[>.start-agent]:items-stretch [&:has(>.start-agent)>.snooze-box>[data-slot=button]]:flex-1 [.next-step+&]:mt-3 [.question.queue_&]:mt-2.5 [#panel_.content>&:last-child]:panel-foot phone:[&_[data-slot=button]]:min-h-[42px]';


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
  
  ask: '[&_.ask-q+.ask-q]:mt-3 [&_.ask-q+.ask-q]:pt-2.5 [&_.ask-q+.ask-q]:border-t [&_.ask-q+.ask-q]:border-waiting/30 [&.flash]:animate-[msg-flash_2.4s_ease-out] [.talk_&]:m-0 [.talk_&]:max-w-[92%] [.talk_&]:py-2.5 [.talk_&]:px-3 [.talk_&]:text-base [.talk_&]:flex-none [.talk_&]:bg-waiting/9',
  brief: 'border-idea bg-idea/6 [&_.p-lead]:text-base [&_.p-list]:mt-1',
  'duplicate-notice': 'max-w-none border-proposal bg-proposal/7 [&_h4]:mb-1 [&_h4]:text-proposal [&>p]:m-0 [&_.duplicate-preview]:mt-3.5',
  failed: 'border-destructive bg-destructive/6',
  pr: 'border-in-pr bg-in-pr/7 [&_h4_a]:text-foreground [&_h4_a]:normal-case [&_h4_a]:tracking-normal [&_h4_a]:text-base',
  proposal: 'border-dashed border-proposal',
  queue: 'border-planned bg-muted [--button-bg:var(--card)]',
  'repo-down': 'border-warning bg-warning/6',
  
  settled: 'border-idea bg-idea/6 mt-2.5 [&>[data-slot=collapsible-trigger]]:font-semibold [&>[data-slot=collapsible-trigger]]:text-base',
  superseded: 'border-proposal bg-proposal/6',
};

/** A framed box on the card (a question, the brief, the queue …), in the waiting colour unless its kind says otherwise. */
export const questionClass = (kind?: QuestionKind, className?: string) =>
  cn(
    'question mt-4 py-3.5 px-4 rounded-xs border-[1.5px] border-waiting max-w-[80ch] bg-waiting/9 text-base [&_h4]:mt-0 [&_h4]:mb-1.5 [&_h4]:text-2xs [&_h4]:uppercase [&_h4]:tracking-[.08em] [&_h4]:text-muted-foreground [&_.q-text]:whitespace-pre-wrap [&_.p-lead]:mt-1.5 [&_.p-lead]:text-base [.split-main_&]:max-w-none',
    kind && [kind === 'settled' ? 'brief settled' : kind, kinds[kind]],
    className,
  );


export const titleClass =
  'p-title text-display mt-0.5 mb-1.5 leading-[1.12] [font-family:var(--font)] font-[650] tracking-[-.018em] phone:text-2xl!';


export const titleFieldClass = cn(titleClass, 'text-display! block w-[calc(100%-40px)] resize-none overflow-hidden placeholder:font-normal placeholder:italic');


export const stateClass =
  'p-state text-sm font-semibold text-c-strong [&_:is(.merge-mark,.restart-mark,.question-mark)]:align-[-1px] [&+.p-src]:mt-1';


export const statusClass = 'p-status text-muted-foreground font-medium [&.conflict]:text-waiting-strong [&.conflict]:italic';





export const bodyClass =
  'p-body block box-border w-full max-w-[76ch] min-h-[180px] mt-4 py-3 px-3.5 border border-border rounded-xs bg-card text-base leading-normal outline-none focus:border-muted-foreground resize-none whitespace-pre-wrap break-words max-h-[70vh] overflow-y-auto cursor-text [&.blank]:before:content-[attr(data-placeholder)] [&.blank]:before:text-muted-foreground [&.blank]:before:pointer-events-none [&.blank]:before:absolute [&_.smart-link]:cursor-default [&_.smart-link]:select-all [&_.smart-link]:align-[1px] [.split-main_&]:max-w-none [.c-field_&]:pr-10 [.dropping_&]:border-working [.dropping_&]:border-dashed [.dropping_&]:bg-working/6 [.proposal-grid_&]:min-h-[min(360px,calc(100vh-440px))] [.proposal-grid_&]:max-h-[calc(100vh-440px)] phone:[.proposal-grid_&]:min-h-[160px] phone:[.proposal-grid_&]:max-h-[50vh]';


export const headClass =
  'p-h mt-6 mb-1.5 text-2xs uppercase tracking-[.08em] text-muted-foreground [.split-talk_&]:mt-0 [.split-main_.p-plan_&]:mt-0';







export const conversationBox =
  'conv flex flex-col max-h-[min(520px,60vh)] max-w-[100ch] [.split-talk_&]:flex-1 [.split-talk_&]:min-h-0 [.split-talk_&]:max-h-none [.split-talk_&]:max-w-none max-[760px]:[.split-talk_&]:min-h-[240px] max-[760px]:[.split-talk_&]:max-h-[min(520px,60vh)]';


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
    "choice flex items-start gap-2 text-left bg-card border border-border rounded-xs py-1 pr-3 pl-2 text-sm text-foreground cursor-pointer max-w-full hover:border-muted-foreground before:content-[''] before:flex-none before:size-[14px] before:mt-0.5 before:box-border before:border-[1.5px] before:border-solid before:border-muted-foreground before:bg-card group-[.single]/choices:before:rounded-full group-[.multiple]/choices:before:rounded-xs [.prototype-variants_&]:basis-full",
    on && 'on border-waiting hover:border-waiting bg-waiting/8 before:border-waiting group-[.single]/choices:before:bg-[radial-gradient(var(--waiting)_0_3.5px,var(--card)_4px)] group-[.multiple]/choices:before:choice-checked',
    picked && 'picked border-idea/55',
    other && 'other basis-full box-border cursor-text [&_textarea]:flex-1 [&_textarea]:min-w-0 [&_textarea]:m-0 [&_textarea]:resize-none [&_textarea]:[font:inherit] [&_textarea]:text-inherit [&_textarea]:leading-[inherit] [&_textarea]:[field-sizing:content] [&_textarea]:min-h-lh',
    alone && 'alone before:content-none',
  );


export const pickTag = 'pick-tag inline-block ml-1.5 px-2 rounded-xs text-2xs font-bold leading-[18px] whitespace-nowrap text-idea-strong bg-idea/10';

