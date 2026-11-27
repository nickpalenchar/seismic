






export const projectClass = 'c-project mt-4 mb-1.5 mx-0 pt-3 px-3 pb-2.5 border border-border rounded-xs';


export const pathClass = 'c-path flex-1 min-w-0 [font-family:var(--mono)]! text-xs!';


export const rowClass = 'c-row flex gap-2 items-center my-1 mx-0 [&>[data-slot=button]]:flex-none';


export const setupListClass = 'list-none p-0 my-1.5 mx-0';


export const setupItemClass =
  'grid grid-cols-[16px_auto_1fr] [.setup_&]:grid-cols-[16px_210px_1fr] gap-x-2 items-baseline py-1 px-0 text-sm [:is(#config,#rules,#project-settings)_&]:py-1 [:is(#config,#rules,#project-settings)_&]:text-sm [:is(#config,#rules,#project-settings)_&]:border-b [:is(#config,#rules,#project-settings)_&]:border-b-border [:is(#config,#rules,#project-settings)_&:last-child]:border-b-0 [&_.hint]:m-0 [&_.hint]:[overflow-wrap:anywhere]';


export const installClass =
  'c-install flex gap-2.5 items-center my-1 mx-0 text-sm [&_.hint]:m-0 [&_.c-step]:flex-none [&_code]:overflow-hidden [&_code]:text-ellipsis [&_code]:whitespace-nowrap [&_code]:min-w-0';


export const installHintClass = `hint ${installClass} text-sm!`;


export const statusClass = 'c-status mt-2';


export const jsonClass = 'c-json font-mono text-xs/[1.4] bg-muted rounded-xs p-2.5 overflow-auto';


export const problemClass =
  'c-problem text-destructive mt-1.5 mb-0 mx-0 text-sm [&_code]:block [&_code]:mt-1 [&_code]:whitespace-pre-wrap [&_code]:[overflow-wrap:break-word] [&>[data-slot=button]:not([data-variant=link])]:flex [&>[data-slot=button]:not([data-variant=link])]:w-fit [&>[data-slot=button]:not([data-variant=link])]:mt-1.5!';

/** A project's id, beside its title. */
export const idClass = (fresh: boolean) => `c-id font-mono text-xs ${fresh ? 'fresh text-warning' : 'text-muted-foreground'}`;





export const removeClass =
  'c-del c-remove ml-auto [&_svg]:block [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:transition-opacity [@media(hover:hover)]:duration-[120ms] [@media(hover:hover)]:[:is(.cfg-project-head,.cfg-repo-path,.cfg-host,.cfg-old-names_li):is(:hover,:focus-within)>&]:opacity-100';


export const trustClass = 'c-trust flex flex-col items-start gap-2.5 mt-2';
export const trustGroupClass = 'c-trust-group self-stretch [&>.hint]:mt-0 [&>.hint]:mb-1 [&>.hint]:mx-0';

