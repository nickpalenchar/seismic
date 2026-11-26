



import { Menu, SquarePen, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from 'cn';
import type { Chat, ChatElsewhere, Talk } from '../core/types';
import { createChat, getEveryChat, openChat } from './clients/seismic';
import { useDraft } from './draft';
import { plain } from './markdown';
import { useStoredState } from './stored';
import { clock, failText, shortDay, t } from './strings';
import { SegmentedControl } from './components/segmented';
import { Tooltip } from './components/tooltip';
import { Button } from './components/button';

interface Props {
  
  title: ReactNode;
  project: string;
  
  projectName: string;
  
  chat: number;
  chats: Chat[];
  talk: Talk[];
  disabled?: boolean;
  onShow?: (chat: number | null) => void;
  
  onProject: (project: string) => void;
  
  onClose?: () => void;
}

export function ChatsHead({ title, project, projectName, chat, chats, talk, disabled, onShow, onProject, onClose }: Props) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useStoredState('seismic-chats-all', false);
  const [every, setEvery] = useState<ChatElsewhere[] | null>(null);
  const [error, setError] = useState('');
  const drawer = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  
  const fresh = !talk.some((x) => x.chat === chat) && !chats.some((c) => c.id === chat);
  const waiting = talk.filter((x) => x.unread && x.chat !== chat).length;

  useEffect(() => {
    if (!open || !all) return;
    let gone = false;
    getEveryChat().then(
      (x) => !gone && setEvery(x),
      (e) => !gone && setError(failText(e)),
    );
    return () => void (gone = true);
  }, [open, all, chats]);
  useEffect(() => {
    if (!open) return;
    setError('');
    
    drawer.current?.closest('.sheet')?.scrollTo({ top: 0 });
    drawer.current?.querySelector<HTMLElement>('.chat-row.on, .chat-row')?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [open]);

  const go = (c: Chat) => {
    if (c.id === chat && c.project === project) return setOpen(false);
    setError('');
    openChat(c.id).then(
      () => {
        setOpen(false);
        if (c.project !== project) onProject(c.project);
        else onShow?.(c.id);
      },
      (e) => setError(failText(e)),
    );
  };
  const start = () => {
    setOpen(false);
    if (onShow) onShow(null);
    else createChat(project).catch(console.error);
  };
  const shown: (Chat & { projectName?: string })[] = all ? (every ?? []) : chats;

  return (
    
    <div className={headClass} ref={head}>
      <Tooltip content={waiting ? `${t.koordinator.chatsOpen} · ${t.koordinator.unreadCount(waiting)}` : t.koordinator.chatsOpen}>
        <button
            className={cn(btnClass, waiting > 0 && "waits after:content-[''] after:absolute after:top-[5px] after:right-[5px] after:size-2 after:rounded-full after:bg-waiting")} aria-label={t.koordinator.chatsOpen}
            aria-expanded={open}
            disabled={disabled}
            onClick={() => setOpen(!open)}
        >
          <Menu size={18} />
        </button>
      </Tooltip>
      {title}
      <Tooltip content={t.koordinator.newChatHint}>
        <button className={cn(btnClass, 'chats-new')} aria-label={t.koordinator.newChat} disabled={disabled || fresh} onClick={start}>
          <SquarePen size={17} />
        </button>
      </Tooltip>
      {onClose && (
        <Tooltip content={t.koordinator.chatsClose}>
          <button className={btnClass} aria-label={t.koordinator.chatsClose} onClick={onClose}>
            <X size={17} />
          </button>
        </Tooltip>
      )}
      {open &&
        head.current?.closest('.sheet, .ph-panel') &&
        createPortal(
          
          <div className="chats-layer contents" onPointerDown={(e) => e.stopPropagation()}>
            <div className="chats-scrim absolute inset-0 z-30 bg-scrim animate-[fade_.2s_ease-out]" onClick={() => setOpen(false)} />
            <div className={drawerClass} ref={drawer} role="dialog" aria-label={t.koordinator.chats}>
              <div className="chats-top flex items-center justify-between pl-1.5 text-base">
                <b>{t.koordinator.chats}</b>
                <Tooltip content={t.koordinator.chatsClose}>
                  <button className={btnClass} aria-label={t.koordinator.chatsClose} onClick={() => setOpen(false)}>
                    <X size={17} />
                  </button>
                </Tooltip>
              </div>
              <SegmentedControl
                className="chats-scope flex p-0.5 rounded-sm [&_small]:text-2xs [&_small]:font-normal [&_small]:text-muted-foreground"
                itemClassName="chats-scope-item flex-1 py-1.5 px-2 rounded-xs flex flex-col items-center justify-center min-w-0 data-[state=on]:font-semibold"
                label={t.koordinator.chats}
                value={all ? 'all' : 'here'}
                onValueChange={(x) => setAll(x === 'all')}
                options={[
                  {
                    value: 'here',
                    label: (
                      <>
                        <span className="chats-scope-name max-w-full overflow-hidden text-ellipsis whitespace-nowrap">{projectName}</span>
                        <small>{t.koordinator.chatsHere}</small>
                      </>
                    ),
                  },
                  { value: 'all', label: t.koordinator.chatsAll },
                ]}
              />
              <ul className="chats-list list-none m-0 p-0 flex flex-col gap-0.5">
                {fresh && !all && (
                  <li>
                    <button className={cn(rowClass, onClass)} onClick={() => setOpen(false)}>
                      <span className={titleClass}>{t.koordinator.newChat}</span>
                      <span className={metaClass}>{t.koordinator.chatNow}</span>
                    </button>
                  </li>
                )}
                {shown.map((c) => (
                  <li key={c.id}>
                    <button className={cn(rowClass, c.id === chat && c.project === project && onClass)} onClick={() => go(c)}>
                      <span className={cn(titleClass, !c.title && 'by-seismic text-muted-foreground italic')}>{c.title ? plain(c.title) : t.koordinator.chatBySeismic}</span>
                      <span className={metaClass}>
                        {when(c.at)}
                        {c.projectName && ` · ${c.projectName}`}
                        {c.unread ? (
                          <span className="chat-unread ml-auto min-w-[18px] py-px px-1.5 rounded-md bg-waiting text-waiting-foreground text-2xs font-semibold text-center" title={t.koordinator.unreadCount(c.unread)}>
                            {c.unread}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {!shown.length && !(fresh && !all) && (all ? every !== null : true) && <p className="hint">{t.koordinator.chatsEmpty}</p>}
              {error && <p className="p-error">{error}</p>}
            </div>
          </div>,
          head.current.closest('.sheet, .ph-panel')!,
        )}
    </div>
  );
}

/** The project's latest sessions, until the owner starts writing in the empty chat. */
export function RecentChats({ draft, chats, onShow }: { draft: string; chats: Chat[]; onShow?: (chat: number) => void }) {
  const [error, setError] = useState('');
  const { text } = useDraft(draft);
  const [started, setStarted] = useState(!!text);
  useEffect(() => {
    if (text) setStarted(true);
  }, [text]);
  if (!chats.length || text || started) return null;
  const resume = (c: Chat) => {
    setError('');
    openChat(c.id).then(() => onShow?.(c.id), (e) => setError(failText(e)));
  };
  return (
    <div className="mb-2 text-center" role="group" aria-label={t.koordinator.recentChats}>
      <p className="mt-0 mb-1.5 text-xs font-medium text-muted-foreground">{t.koordinator.recentChats}</p>
      <ul className="m-0 flex list-none flex-col items-center gap-1 p-0">
        {chats.slice(0, 5).map((c) => {
          const name = c.title ? plain(c.title) : t.koordinator.chatBySeismic;
          const date = shortDay(c.at);
          return (
            <li key={c.id} className="min-w-0 max-w-full">
              <Button
                type="button"
                variant="outline"
                size="small"
                className="max-w-full rounded-full border-border px-3 text-xs"
                title={`${name} · ${date}`}
                onClick={() => resume(c)}
              >
                <span className="min-w-0 truncate">{name}</span>
                {c.unread ? <span className="size-2 shrink-0 rounded-full bg-waiting" title={t.koordinator.unreadCount(c.unread)} /> : null}
                <time className="shrink-0 font-normal text-muted-foreground" dateTime={c.at}>{date}</time>
              </Button>
            </li>
          );
        })}
      </ul>
      {error && <p className="p-error" role="alert">{error}</p>}
    </div>
  );
}





const headClass =
  'chats-head flex items-center gap-1.5 [.sheet>&]:mt-0 [.sheet>&]:mx-0 [.sheet>&]:mb-2 [.sheet>&_h2]:m-0 [.sheet>&_h2]:flex-1 [.sheet>&_h2]:min-w-0 [.ph-bar_&]:flex-1 [.ph-bar_&]:min-w-0 [.ph-bar_&]:gap-2 [.ph-bar_&_.ph-word]:flex-1 [.ph-bar_&_.ph-word]:min-w-0';

const btnClass =
  'chats-btn inline-flex items-center justify-center relative size-8 flex-none p-0 [border:0] rounded-xs bg-transparent text-muted-foreground cursor-pointer hover:not-disabled:bg-muted hover:not-disabled:text-foreground disabled:opacity-40 disabled:cursor-default [.ph-bar_&]:size-10';

const drawerClass =
  'chats-drawer absolute top-0 bottom-0 left-0 z-31 w-[min(320px,86%)] flex flex-col gap-2.5 pt-4 px-3 pb-[calc(16px+env(safe-area-inset-bottom))] bg-surface border-r border-r-border [box-shadow:var(--lift)] overflow-y-auto overscroll-contain animate-[chats-in_.25s_cubic-bezier(.3,.9,.3,1)] text-base [&_.hint]:my-1 [&_.hint]:mx-1.5';

const rowClass = 'chat-row flex flex-col items-stretch gap-1 w-full py-2 px-2.5 [border:0] rounded-sm bg-transparent text-foreground text-left cursor-pointer hover:bg-muted';
const onClass = 'on bg-working/14!';
const titleClass = 'chat-title overflow-hidden text-ellipsis whitespace-nowrap';
const metaClass = 'chat-meta flex items-center gap-1.5 text-xs text-muted-foreground';

/** When a chat was last talked in: the time today, else the day. */
const when = (at: string) => (new Date(at).toDateString() === new Date().toDateString() ? clock(at) : shortDay(at));
