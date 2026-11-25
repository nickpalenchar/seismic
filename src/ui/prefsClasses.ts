





import { cn } from 'cn';


export const prefsClass = 'prefs list-none p-0 mt-2.5 mx-0 mb-0 [&_.p-error]:basis-full [&_.p-error]:m-0';


export const proposalsClass = cn(prefsClass, 'proposals');


export const prefRowClass = 'flex flex-wrap gap-2 items-start pt-2 pr-2 pb-2 pl-2.5 my-1.5 mx-0 rounded-xs bg-muted text-sm cursor-default';


export const proposalRowClass = cn(prefRowClass, 'bg-proposal/9');


export const prefTextClass = 'pref-text flex-1 cursor-text min-w-0 [overflow-wrap:anywhere]';


export const proposalTextClass = cn(prefTextClass, 'cursor-default font-semibold');


export const occasionClass = 'occasion basis-full min-w-0 text-muted-foreground text-xs [overflow-wrap:anywhere] [&_q]:italic';


export const prefActionsClass = 'pref-actions basis-full flex flex-wrap gap-1.5 mt-0.5';


export const targetClass = 'target basis-full flex items-center gap-1.5 text-muted-foreground text-xs';


export const fromLinkClass = 'from text-foreground cursor-pointer underline decoration-border underline-offset-2';


export const settingLabelClass = 'setting-label text-muted-foreground text-xs pt-1.5';


export const settingValueClass =
  'setting-value basis-full m-0 [font-family:var(--mono)] text-xs! leading-[1.45] whitespace-pre-wrap [overflow-wrap:anywhere] bg-card rounded-xs py-1.5 px-2';
