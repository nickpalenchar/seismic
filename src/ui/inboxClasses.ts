// The shared looks of the lists of cards that wait or work (Tailwind on frost's tokens): the inbox, "Needs
// you", Agent work, the Parked view and the phone's lists build their entries alike. The class names before
// the utilities (`inbox-list`, `inbox-entry`, `replies` …) stay as hooks for code and demos that find them.

/** A list of entries, one under the other. */
export const entryListClass = 'inbox-list list-none m-0 p-0 flex flex-col gap-2.5';

/**
 * An entry: a pane of glass of its own. A unread or read entry's title is bold or plain through
 * the `[.inbox-entry.unread_&]` variants of the face's title (card/faceClasses.ts), which sets its weight.
 */
export const entryClass =
  'inbox-entry pt-3 px-3.5 pb-3.5 rounded-xl bg-card border border-[color:var(--glass-edge,var(--border))] [box-shadow:inset_0_1px_0_var(--glass-hi,transparent),var(--shadow)]';

/** The entry of the card open now (or flying open): a ring and a tint. */
export const entryOnClass = 'on bg-working/10 [box-shadow:0_0_0_2px_--alpha(var(--working)/55%),var(--shadow)]';

/** A proposed rule's or setting's entry, tinted as a proposal. */
export const proposalEntryClass = 'proposal-entry bg-proposal/9 border-transparent';

/** The title of an entry's card as a button that opens it, in the face's own type. */
export const ttlLinkClass =
  'ttl-link [all:unset] box-content! cursor-pointer! min-w-0! hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-working focus-visible:outline-offset-2 focus-visible:rounded-xs';

/** An entry's one-click replies and "Go to card"; under any phone page (`.ph-view`) sized for a finger. */
export const repliesClass =
  'replies flex flex-wrap gap-1.5 mt-2.5 [.ph-view_&]:gap-2 [.ph-view_&>[data-slot=button]]:min-h-10 [.ph-view_&>[data-slot=button]]:text-base';

/** The row of switches above a list. */
export const inboxBarClass = 'inbox-bar flex items-center justify-between gap-3 mt-0 mx-2 mb-3 [.ph-view_&]:mx-0';

/** What a list says while it is empty. */
export const emptyInboxClass = 'empty-inbox m-0 p-2 text-muted-foreground text-sm';

/** What a list of the Agent work sheet says while it is empty. */
export const agentsEmptyClass = 'agents-empty text-muted-foreground text-xs [#agents_&]:my-3.5 [#agents_&]:mx-2 [#agents_&]:text-sm [#agents_&]:leading-[1.45]';

/** An unread entry's dot: orange, centred on the title's first line; inside the subtle face's top-right corner. */
export const unreadDotClass =
  'unread-dot flex-none size-2 rounded-full bg-waiting mt-1.5 [.face.subtle>&]:absolute [.face.subtle>&]:top-2 [.face.subtle>&]:right-2 [.face.subtle>&]:m-0';
