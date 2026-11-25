




export const entryListClass = 'inbox-list list-none m-0 p-0 flex flex-col gap-2.5';





export const entryClass =
  'inbox-entry pt-3 px-3.5 pb-3.5 rounded-xl bg-card border border-[color:var(--glass-edge,var(--border))] [box-shadow:inset_0_1px_0_var(--glass-hi,transparent),var(--shadow)]';


export const entryOnClass = 'on bg-working/10 [box-shadow:0_0_0_2px_--alpha(var(--working)/55%),var(--shadow)]';


export const proposalEntryClass = 'proposal-entry bg-proposal/9 border-transparent';


export const ttlLinkClass =
  'ttl-link [all:unset] box-content! cursor-pointer! min-w-0! hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-working focus-visible:outline-offset-2 focus-visible:rounded-xs';


export const repliesClass =
  'replies flex flex-wrap gap-1.5 mt-2.5 [.ph-view_&]:gap-2 [.ph-view_&>[data-slot=button]]:min-h-10 [.ph-view_&>[data-slot=button]]:text-base';


export const inboxBarClass = 'inbox-bar flex items-center justify-between gap-3 mt-0 mx-2 mb-3 [.ph-view_&]:mx-0';


export const emptyInboxClass = 'empty-inbox m-0 p-2 text-muted-foreground text-sm';


export const agentsEmptyClass = 'agents-empty text-muted-foreground text-xs [#agents_&]:my-3.5 [#agents_&]:mx-2 [#agents_&]:text-sm [#agents_&]:leading-[1.45]';


export const unreadDotClass =
  'unread-dot flex-none size-2 rounded-full bg-waiting mt-1.5 [.face.subtle>&]:absolute [.face.subtle>&]:top-2 [.face.subtle>&]:right-2 [.face.subtle>&]:m-0';
