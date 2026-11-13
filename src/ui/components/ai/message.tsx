// AI Elements' Message, ours from here on: one turn of a conversation, on a card, in a chat
// and in the Koordinator's sheet alike. `from` places it (the owner's, `user`, on the right) and
// `MessageHead` heads it with who said it; `MessageActions` hold the buttons in its corner (reply,
// take back), which show while the pointer is on the message and always on a touch screen. What a kind
// of message adds (a question, the agent at work, an unread note) is the class `className` gives it,
// styled here on frost tokens.

import { cn } from 'cn';
import { Reply, Trash2 } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { t } from '../../strings';
import { IconButton } from '../button';

/** Who a message is from: `user` the owner, `assistant` anyone else (an agent, Seismic, the plan). */
export type MessageFrom = 'user' | 'assistant';

export function Message({ className, from, ...props }: ComponentProps<'div'> & { from: MessageFrom }) {
  return (
    <div
      data-slot="message"
      className={cn(
        'group/message group relative flex-none min-w-0 rounded-xl',
        from === 'user' ? 'is-user self-end max-w-[92%] bg-secondary px-3 py-2' : 'is-assistant w-full self-stretch py-1',
        '[&.q]:bg-waiting/9 [&.q]:px-3 [&.q]:py-2',
        // State hooks are shared by the card, chats and Koordinator adapters.
        '[&:is(.held,.unread)]:px-3 [&:is(.held,.unread)]:py-2 [&:is(.held,.unread)]:outline [&:is(.held,.unread)]:outline-dashed [&:is(.held,.unread)]:outline-working/40 [&:is(.held,.unread)]:-outline-offset-1',
        '[&.unread>:not(.msg-actions):not(.unread-mark)]:opacity-60 [&.paused>:not(.who)]:opacity-70',
        '[&.fresh]:px-3 [&.fresh]:py-2 [&.fresh]:shadow-[0_0_0_1.5px_--alpha(var(--waiting)/70%)] [&.flash]:animate-[msg-flash_2.4s_ease-out]',
        '[&.undone_:is(.p-lead,.p-list,.p-table)]:line-through [&.undone_:is(.p-lead,.p-list,.p-table)]:decoration-muted-foreground [&.by-owner_.shots]:justify-end',
        '[&.action]:bg-muted [&.action]:shadow-none [&.action]:border [&.action]:border-dashed [&.action]:border-muted-foreground/55 [&.action]:[font-family:var(--font)] [&.action]:px-2.5 [&.action]:pt-2 [&.action]:pb-2.5 [&.action]:self-start',
        className,
      )}
      {...props}
    />
  );
}

/** The colour of who said it, by the author's kind. */
const author: Record<string, string> = {
  owner: 'text-working',
  worker: 'text-foreground',
  koordinator: 'text-muted-foreground',
  plan: 'text-muted-foreground',
  proposal: 'text-muted-foreground',
};

/**
 * A message's head: who said it, the agent's harness and model, and when; `children` (a button at the
 * right, "Make it a card") stays in view. `actions`: how many buttons `MessageActions` puts in the corner, whose room it leaves.
 */
export function MessageHead({ by, actions = 0, children }: { by: string; actions?: number; children?: ReactNode }) {
  return (
    <div className={cn('who text-2xs font-semibold has-[>.msg-card]:flow-root',
      'group-[.q]/message:text-waiting-strong group-[.q.ended]/message:text-muted-foreground group-[.paused]/message:text-muted-foreground',
      'group-[:is(.thinking,.paused)]/message:flex group-[:is(.thinking,.paused)]/message:items-center group-[:is(.thinking,.paused)]/message:gap-x-2 group-[:is(.thinking,.paused)]/message:min-h-5 group-[:is(.thinking,.paused)]/message:whitespace-nowrap',
      "group-[.thinking]/message:after:content-[''] group-[.thinking]/message:after:inline-block group-[.thinking]/message:after:align-middle group-[.thinking]/message:after:w-8.5 group-[.thinking]/message:after:h-1 group-[.thinking]/message:after:rounded-sm group-[.thinking]/message:after:bg-[linear-gradient(90deg,transparent,var(--idea),transparent)] group-[.thinking]/message:after:bg-[length:200%_100%] group-[.thinking]/message:after:animate-[flow_1.4s_linear_infinite]",
      'group-[.by-koordinator.thinking]/message:after:[background-image:linear-gradient(90deg,transparent,var(--proposal),transparent)] group-[.by-worker.thinking]/message:after:[background-image:linear-gradient(90deg,transparent,var(--working),transparent)]',
      'group-[.action]/message:flex group-[.action]/message:items-center group-[.action]/message:gap-1.5 group-[.action]/message:text-muted-foreground group-[.action]/message:uppercase group-[.action]/message:tracking-[.06em] group-[.action]/message:text-2xs group-[.action]/message:[&_.t]:normal-case group-[.action]/message:[&_.t]:tracking-normal group-[.action]/message:[&_.action-mark]:flex-none', author[by] ?? 'text-idea-strong', actions === 1 && 'pr-6', actions > 1 && 'pr-13')}>
      {children}
    </div>
  );
}

/** Who said it in `MessageHead`: the agent's model beside it, then the time. */
export const MessageMeta = ({ className, ...props }: ComponentProps<'span'>) => (
  <span className={cn('inline-block font-normal text-muted-foreground', className)} {...props} />
);

/** The buttons in a message's corner. */
export function MessageActions({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('msg-actions absolute top-1 right-1 flex items-center gap-1', className)} {...props} />;
}

/** One of them: it keeps the cursor where it was in the field (a mouse down does not take the focus). */
export function MessageAction({ className, ...props }: ComponentProps<typeof IconButton>) {
  return (
    <IconButton
      size="small"
      className={cn(
        'size-6.5 rounded-sm [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-75',
        className,
      )}
      onMouseDown={(e) => e.preventDefault()}
      {...props}
    />
  );
}

export const ReplyAction = ({ onClick }: { onClick: () => void }) => (
  <MessageAction icon={<Reply size={15} strokeWidth={2} aria-hidden="true" />} label={t.talk.reply} className="bg-muted" onClick={onClick} />
);

export const DeleteAction = ({ onClick, label }: { onClick: () => void; label?: string }) => (
  <MessageAction icon={<Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />} label={label ?? t.delete} variant="danger" onClick={onClick} />
);

/** A state change between turns, shared by card conversations and chats. */
export const noteClass = 'note text-xs text-muted-foreground italic self-center text-center [&.ev-error]:text-destructive [&.ev-error]:not-italic [&.ev-denied]:text-warning [&.ev-denied]:not-italic [&_.reauthenticate]:justify-center [&.snooze-line]:flex [&.snooze-line]:flex-col [&.snooze-line]:items-center [&.snooze-line]:gap-0.5 [&.snooze-line]:border-t [&.snooze-line]:border-dashed [&.snooze-line]:border-border [&.snooze-line]:pt-2 [&.snooze-line]:not-italic [&.snooze-line_.clock-mark]:align-[-1px]';
