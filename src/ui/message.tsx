// One message of a conversation, as cards and the Koordinator's sheet show it alike: who said it
// and when above, the text below as paragraphs and lists; a reply quotes the message it answers
// above its words, as chat apps do.

import { Copy } from 'lucide-react';
import { X_ICON_SVG } from '../core/icons';
import { createContext, type ReactNode, type RefObject, useContext, useEffect, useRef, useState } from 'react';
import type { AgentIdentity, AnswerFile, CardEvent, Item } from '../core/types';
import { answerFile, api } from './api';
import { type Block, blocks, Inline, ListTree, plain, Table } from './markdown';
import { clock as time, t } from './strings';
import type { Quoted } from './reply';
import { clip } from '../core/text';
import { copyOrSelect } from './copy';
import { scrollBehavior } from './motion';
import { Message, MessageActions, MessageHead, MessageMeta, ReplyAction, DeleteAction } from './components/ai/message';
import { CloseButton, LinkButton } from './components/button';
import { Tooltip } from './components/tooltip';
import { WorkingBar } from './components/working-bar';

/** The colour of the bar beside an agent at work (`thinking`), by who it is; an idea's agent otherwise. */
const workingColor: Record<string, string> = { worker: 'var(--working)', koordinator: 'var(--proposal)' };

/**
 * A message's frame: `by` places and colours it (the owner's on the right), `who` heads it with its
 * time; `className` adds what kind it is (a question, the agent at work, the starting point); at work
 * (`thinking`), a working bar runs beside its head.
 * `ev`: the message's place in the conversation (a card's event id), which a quote of it leads to; `onReply`: the owner can reply to it;
 * `onDelete`: the owner can delete it, with `deleteLabel` as the button's title; `head`: a button at
 * the right of its head, always in view ("Make it a card").
 */
export function Msg({
  by,
  who,
  agent,
  at,
  className,
  ev,
  onReply,
  onDelete,
  deleteLabel,
  head,
  children,
}: {
  by: string;
  who?: ReactNode;
  agent?: AgentIdentity;
  at?: string;
  className?: string;
  ev?: number | string;
  onReply?: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
  head?: ReactNode;
  children?: ReactNode;
}) {
  const actions = (onReply ? 1 : 0) + (onDelete ? 1 : 0);
  const working = className?.split(' ').includes('thinking');
  return (
    <Message from={by === 'owner' ? 'user' : 'assistant'} className={['msg', `by-${by}`, onReply && 'replies', className].filter(Boolean).join(' ')} data-ev={ev}>
      {(who || agent || at || head) && (
        <MessageHead by={by} actions={actions}>
          {who}
          {agent && <MessageMeta className="agent-model ml-2 [overflow-wrap:anywhere] group-[:is(.thinking,.paused)]/message:ml-0 group-[:is(.thinking,.paused)]/message:[overflow-wrap:normal]">{t.config.agents.harnesses[agent.harness]}{agent.model ? ` · ${agent.model}` : ''}</MessageMeta>}
          {at && <MessageMeta className="t ml-1">{time(at)}</MessageMeta>}
          {working && <WorkingBar color={workingColor[by] ?? 'var(--idea)'} />}
          {head}
        </MessageHead>
      )}
      {actions > 0 && (
        <MessageActions>
          {onReply && <ReplyAction onClick={onReply} />}
          {onDelete && <DeleteAction onClick={onDelete} label={deleteLabel} />}
        </MessageActions>
      )}
      {children}
    </Message>
  );
}

/** The harness and model of the Koordinator's session that reads the owner's words, while one runs (the project's `koordinatorAgent`). */
export const KoordinatorAgent = createContext<AgentIdentity | undefined>(undefined);

/** Under the owner's words while the Koordinator reads them, in the sheet and on a card alike. */
export const Reading = () => <Msg by="koordinator" className="thinking" who={`${t.author.koordinator} ${t.talk.reading}`} agent={useContext(KoordinatorAgent)} />;

/**
 * Scrolls the conversation to a message (`ev` in `Msg`), which lights up once, so the eye finds it;
 * one that does not stand there as a message goes to `orElse` instead (a question asked again that
 * waits at the end, among the questions for the owner).
 */
export function goToMessage(ev: number | string, orElse?: string) {
  const el = document.querySelector<HTMLElement>(`.talk [data-ev="${ev}"]`) ?? (orElse ? document.querySelector<HTMLElement>(`.talk ${orElse}`) : null);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

/**
 * The message a reply answers, quoted above it or above the field the reply is written in: who said
 * it and its start, a few lines at most. A click on it goes to the message in the conversation
 * (`ev` in `Msg`); `onClear` takes it out of the field.
 */
export const quoteClass = "quote [--q:var(--muted-foreground)] flex items-start min-w-0 border border-[color:--alpha(var(--q)/30%)] rounded-xs bg-[color:--alpha(var(--q)/8%)] [&.q-by-owner]:[--q:var(--working)] [&.q-by-worker]:[--q:var(--inPr)] [&.q-by-explorer]:[--q:var(--idea)] [&:is(.q-by-koordinator,.q-by-seismic,.q-by-plan)]:[--q:var(--proposal)] [.msg>&]:mt-1 [.msg>&]:mb-1 [[data-slot=prompt-input-body]_&]:flex-[1_1_100%] [[data-slot=prompt-input-body]_&]:mb-0.5 [&.decided]:[--q:var(--waiting)] [&.place]:[--q:var(--working)] [&.place]:items-center [&.place]:gap-2 [&.place]:py-1 [&.place]:pr-0 [&.place]:pl-1.5";

export function Quote({ q, onClear }: { q: Quoted; onClear?: () => void }) {
  return (
    <div className={`${quoteClass} q-by-${q.by}`}>
      <button className="quote-go flex flex-1 min-w-0 flex-col gap-px pt-1 px-2 pb-1.5 bg-transparent text-left [font:inherit] text-inherit cursor-pointer" title={t.talk.toQuoted} onMouseDown={(m) => m.preventDefault()} onClick={() => goToMessage(q.ev)}>
        <span className="quote-who text-xs font-semibold text-[var(--q)]">
          {t.author[q.by]}
          {q.what === 'question' ? ` · ${t.talk.question}` : q.what === 'handover' ? ` · ${t.talk.handover}` : ''}
        </span>
        <span className="quote-text text-sm leading-[1.4] text-muted-foreground [overflow-wrap:anywhere] line-clamp-3 [[data-slot=prompt-input-body]_&]:line-clamp-2">{q.text || '📷'}</span>
      </button>
      {onClear && (
        <CloseButton label={t.talk.replyCancel} size="small" className="quote-clear mt-1 mr-1" onMouseDown={(m) => m.preventDefault()} onClick={onClear} />
      )}
    </div>
  );
}

/**
 * Text from a plan doc or an agent, as markdown: each line a paragraph, a blank line one empty line,
 * lists (list items as a checklist), tables, code, quotes, and headings as bold lines.
 */
export function Body({ md }: { md: string }) {
  const nodes = (bs: Block[]): ReactNode[] =>
    bs.map((b, i) => {
      switch (b.t) {
        case 'p':
          return (
            <p key={i} className="p-lead text-base max-w-[76ch] mt-3.5 mb-0 whitespace-pre-wrap break-words [.msg_&]:[overflow-wrap:anywhere] [.msg_&]:mt-0.5 [.msg_&]:text-sm [.msg.q.ended_&]:text-muted-foreground">
              <Inline md={b.text} />
            </p>
          );
        case 'h':
          return (
            <p key={i} className="p-lead text-base max-w-[76ch] mt-3.5 mb-0 whitespace-pre-wrap break-words [.msg_&]:[overflow-wrap:anywhere] [.msg_&]:mt-0.5 [.msg_&]:text-sm [.msg.q.ended_&]:text-muted-foreground">
              <b>
                <Inline md={b.text} />
              </b>
            </p>
          );
        case 'list':
          return <ListTree key={i} list={b.list} className="p-list max-w-[76ch] mt-3 mb-0 pl-0 list-none text-sm [&_li]:my-1 [&_li]:pl-6 [&_li]:relative [&_li]:before:content-['•'] [&_li]:before:absolute [&_li]:before:left-[7px] [&_li]:before:text-muted-foreground [&_li.done]:before:content-['✓'] [&_li.done]:before:left-1 [&_li.done]:before:text-approved [&_li.done]:before:font-bold [&_li.open]:before:content-['○'] [&_li.open]:before:left-[3px] [&_.p-list]:mt-0.5 [&_.p-list]:text-inherit [&:is(ol)]:list-decimal [&:is(ol)]:pl-6 [&:is(ol)>li]:pl-0.5 [&:is(ol)>li]:before:content-none [.msg_&]:mt-1 [.msg_&]:text-sm" />;
        case 'table':
          return (
            <div key={i} className="p-table max-w-full overflow-auto mt-2.5 [&_table]:border-collapse [&_table]:text-sm [&_table]:tabular-nums [&_th]:font-semibold [&_:is(th,td)]:text-left [&_:is(th,td)]:align-top [&_:is(th,td)]:py-1 [&_:is(th,td)]:pr-3 [&_:is(th,td)]:pl-0 [&_:is(th,td)]:border-b [&_:is(th,td)]:border-border [.msg_&]:mt-1.5 [.msg_&_table]:text-sm">
              <Table head={b.head} rows={b.rows} />
            </div>
          );
        case 'code':
          return <Code key={i} text={b.text} />;
        case 'quote':
          return (
            <blockquote key={i} className="p-quote mt-2.5 mx-0 mb-0 py-px px-3 border border-border rounded-xs text-muted-foreground [&>:first-child]:mt-0 [.msg_&]:mt-1.5">
              {nodes(b.blocks)}
            </blockquote>
          );
        case 'hr':
          return <hr key={i} className="p-hr border-t border-border my-3" />;
        case 'blank':
          return (
            <p key={i} className="p-lead p-blank text-base max-w-[76ch] mt-3.5 mb-0 whitespace-pre-wrap break-words [.msg_&]:[overflow-wrap:anywhere] [.msg_&]:mt-0.5 [.msg_&]:text-sm [.msg.q.ended_&]:text-muted-foreground mt-0!" aria-hidden="true">
              {'\u00a0'}
            </p>
          );
      }
    });
  return <>{nodes(blocks(md, { breaks: true }))}</>;
}

/**
 * A code block, with a button in its corner that puts its text on the clipboard as it is (a command,
 * a message the owner is to send on) and says so for a moment; where the page may not write the
 * clipboard, it selects the text instead. At the desk the button shows while the pointer is on the
 * block, on a touch screen always.
 */
export function Code({ text }: { text: string }) {
  const pre = useRef<HTMLPreElement>(null);
  const [done, setDone] = useState<'copied' | 'selected' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    const how = await copyOrSelect(text, pre.current!);
    setDone(how);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(null), how === 'copied' ? 2000 : 4000);
  };
  const label = done === 'copied' ? t.talk.copied : done === 'selected' ? t.talk.selected : t.talk.copy;
  return (
    <div className="p-code-box group/code relative mt-2.5 [.msg_&]:mt-1.5">
      <pre ref={pre} className="p-code m-0 py-2 pl-2.5 pr-9 bg-muted rounded-xs overflow-auto font-mono text-sm/[1.5] whitespace-pre-wrap break-words [@media(pointer:coarse)]:pr-11">
        {text}
      </pre>
      <Tooltip content={t.talk.copy}>
        <button
            className={['p-copy absolute top-[3px] right-[3px] min-w-[26px] h-[26px] grid place-items-center px-1.5 py-0 rounded-xs bg-muted text-muted-foreground [font:inherit] text-xs cursor-pointer hover:text-foreground hover:bg-border [&.copied]:text-foreground [@media(pointer:coarse)]:min-w-[34px] [@media(pointer:coarse)]:h-[34px]', !done && '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100', done].filter(Boolean).join(' ')} aria-label={label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void copy()}
        >
          {done ? (
            <span>{label}</span>
          ) : (
            <Copy size={15} strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * The frame's height for the page in it to fit: what the page reports (`withHeightReport` in
 * `src/core/frame.ts`) and the frame's border, up to `cap`; undefined until it has reported. A
 * page as high as its frame would grow with each step: it stops after a few.
 */
export function useReportedHeight(frame: RefObject<HTMLIFrameElement | null>, cap: number) {
  const [height, setHeight] = useState<number>();
  useEffect(() => {
    let steps = 0;
    let closeButton: HTMLButtonElement | undefined;
    let placeholder: HTMLElement | undefined;
    const closeImage = () => {
      const f = frame.current;
      if (f?.dataset.seismicPreviousStyle !== undefined) { f.setAttribute('style', f.dataset.seismicPreviousStyle); delete f.dataset.seismicPreviousStyle; f.contentWindow?.postMessage({ seismicCloseImage: true }, '*'); }
      placeholder?.remove(); placeholder = undefined;
      closeButton?.remove(); closeButton = undefined;
    };
    const on = (e: MessageEvent) => {
      const h = e.source === frame.current?.contentWindow && (e.data as { seismicHeight?: unknown } | null)?.seismicHeight;
      const f = frame.current;
      if (f && e.source === f.contentWindow && typeof e.data?.seismicImage === 'boolean') {
        if (e.data.seismicImage && !closeButton) {
          placeholder = document.createElement('div'); placeholder.style.cssText = `height:${f.offsetHeight}px;width:${f.offsetWidth}px;`; f.before(placeholder);
          f.dataset.seismicPreviousStyle = f.getAttribute('style') || ''; f.style.cssText += ';position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483646;border:0';
          closeButton = document.createElement('button'); closeButton.innerHTML = X_ICON_SVG; closeButton.setAttribute('aria-label', t.close);
          closeButton.style.cssText = 'position:fixed;right:16px;top:12px;z-index:2147483647;color:white;background:black;border:0;display:flex;padding:6px;cursor:pointer';
          closeButton.className = 'artifact-image-close'; closeButton.onclick = closeImage; document.body.append(closeButton); closeButton.focus();
        } else if (!e.data.seismicImage) closeImage();
        return;
      }
      if (f && e.source === f.contentWindow && e.data?.seismicImageFocus && closeButton) { closeButton.focus(); return; }
      // the border is inside the frame's height (border-box): without it the page is a few pixels too high and scrolls
      if (typeof h === 'number' && h > 0 && f && f.dataset.seismicPreviousStyle === undefined && steps++ < 30) setHeight(Math.min(Math.ceil(h) + f.offsetHeight - f.clientHeight, cap));
    };
    const keys = (e: KeyboardEvent) => { if (!closeButton) return; if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeImage(); } else if (e.key === 'Tab') { e.preventDefault(); closeButton.focus(); } };
    addEventListener('message', on);
    addEventListener('keydown', keys, true);
    return () => { removeEventListener('message', on); removeEventListener('keydown', keys, true); closeImage(); };
  }, []);
  return height;
}

// ------------------------------------------------------------------ looked-up answers

/** The highest a page an answer comes with grows in its frame; a higher one scrolls inside it. */
const PAGE_CAP = 900;

const isPage = (name: string) => /\.html?$/i.test(name);
const isImage = (name: string) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(name);

/** The mark of a file chip, by what the file is: a table, code, a document, anything else. */
function fileMark(name: string) {
  if (/\.(xlsx?|csv|tsv|ods|numbers)$/i.test(name)) return '▤';
  if (/\.(sql|py|js|ts|sh|r|ipynb|json|ya?ml)$/i.test(name)) return '⌘';
  if (/\.(docx?|odt|rtf|pdf|md|txt|eml)$/i.test(name)) return '✉';
  return '◇';
}

/**
 * The files a looked-up answer comes with, under its text, in the sheet, a card's log and a
 * Question card alike: a page in the sandboxed frame of an HTML artifact, an image inline, any other
 * file as a chip that opens it with the system's app (or downloads it, where that cannot be), and
 * "Show in folder" for the thread's directory.
 */
export function AnswerFiles({ thread, files }: { thread: number; files?: AnswerFile[] }) {
  if (!files?.length) return null;
  const others = files.filter((f) => !isPage(f.name) && !isImage(f.name));
  const open = (file?: string) =>
    api.openAnswer(thread, file).catch(() => {
      // the system has no app for it here (or Seismic runs elsewhere): the browser saves it instead
      if (file !== undefined) location.assign(answerFile(thread, file, true));
    });
  return (
    <div className="answer-files mt-2 flex flex-col gap-2 [&_figure]:m-0 [&_figure]:min-w-0 [&_figcaption]:text-xs [&_figcaption]:text-muted-foreground [&_figcaption]:mt-1 [&_figcaption]:[overflow-wrap:anywhere] [&_figcaption_a]:text-inherit">
      {files.filter((f) => isPage(f.name)).map((f) => (
        <AnswerPage key={f.name} thread={thread} file={f} />
      ))}
      {files.filter((f) => isImage(f.name)).map((f) => (
        <figure key={f.name} className="answer-image [&_img]:block [&_img]:max-w-full [&_img]:max-h-[480px] [&_img]:border [&_img]:border-border [&_img]:rounded-xs [&_img]:bg-white">
          <a href={answerFile(thread, f.name)} target="_blank" rel="noreferrer">
            <img src={answerFile(thread, f.name)} alt={f.caption || f.name} />
          </a>
          <figcaption>
            {f.name}
            {f.caption && ` · ${f.caption}`}
          </figcaption>
        </figure>
      ))}
      <div className="file-chips flex flex-wrap gap-1 items-center">
        {others.map((f) => (
          <span key={f.name} className="file-chip inline-flex items-stretch border border-border rounded-lg overflow-hidden font-sans text-xs">
            <button className="file-open bg-transparent py-0.5 pr-1.5 pl-2 text-foreground cursor-pointer [font:inherit] hover:bg-border" title={t.answer.open(f.caption)} onMouseDown={(e) => e.preventDefault()} onClick={() => void open(f.name)}>
              <span className="file-mark text-question">{fileMark(f.name)}</span> {f.name}
            </button>
            <Tooltip content={t.answer.download}>
              <a className="file-down py-0.5 px-2 border-l border-border text-muted-foreground no-underline hover:bg-border" href={answerFile(thread, f.name, true)} aria-label={t.answer.download}>
                ↓
              </a>
            </Tooltip>
          </span>
        ))}
        <LinkButton className="file-folder font-sans text-xs ml-1" title={t.answer.showFolderHint} onMouseDown={(e) => e.preventDefault()} onClick={() => void open()}>
          {t.answer.showFolder}
        </LinkButton>
      </div>
    </div>
  );
}

/** A page an answer comes with: in the frame of an HTML artifact, its scripts away from Seismic's API, as high as it reports. */
function AnswerPage({ thread, file }: { thread: number; file: AnswerFile }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const height = useReportedHeight(frame, PAGE_CAP);
  return (
    <figure className="answer-page [&_iframe]:w-full [&_iframe]:min-h-20 [&_iframe]:border [&_iframe]:border-border [&_iframe]:rounded-xs [&_iframe]:bg-white [&_iframe]:block">
      <iframe ref={frame} sandbox="allow-scripts" src={answerFile(thread, file.name)} title={file.caption || file.name} style={height ? { height } : undefined} />
      <figcaption>
        <a href={answerFile(thread, file.name)} target="_blank" rel="noreferrer">
          {file.name}
        </a>
        {file.caption && ` · ${file.caption}`}
      </figcaption>
    </figure>
  );
}

/**
 * The head of a looked-up answer's message, right of who said it: "Make it a card", which moves the
 * thread onto a Question card and opens it; or, once it is on one, the way there.
 */
export function ThreadCard({ thread, card, onOpen }: { thread: number; card?: Item; onOpen: (i: Item) => void }) {
  const [busy, setBusy] = useState(false);
  if (card)
    return (
      <button className="msg-card on float-right -mt-0.5 ml-2 py-px px-1.5 border border-border rounded-xs bg-transparent text-muted-foreground font-sans text-2xs font-medium cursor-pointer hover:text-foreground hover:border-question [&.on]:text-question [&.on]:border-question/50 [.moved_&]:float-none [.moved_&]:m-0" title={t.answer.onCardHint} onMouseDown={(e) => e.preventDefault()} onClick={() => onOpen(card)}>
        ↗ {t.answer.onCard(plain(card.title))}
      </button>
    );
  return (
    <button
      className="msg-card float-right -mt-0.5 ml-2 py-px px-1.5 border border-border rounded-xs bg-transparent text-muted-foreground font-sans text-2xs font-medium cursor-pointer hover:text-foreground hover:border-question [&.on]:text-question [&.on]:border-question/50 [.moved_&]:float-none [.moved_&]:m-0"
      title={t.answer.makeCardHint}
      disabled={busy}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        setBusy(true);
        api
          .threadCard(thread)
          .then(onOpen)
          .catch(() => {})
          .finally(() => setBusy(false));
      }}
    >
      ↗ {t.answer.makeCard}
    </button>
  );
}

/** The cards on the project, and how to open one (closing the card open), for a looked-up answer in a card's log. */
export const Cards = createContext<{ items: Item[]; open: (i: Item) => void }>({ items: [], open: () => {} });

/**
 * What a looked-up answer in a card's conversation adds to it: "Make it a card" in its head (on a
 * card that is not the thread's own), and its files under the text.
 */
export function useAnswer(e: CardEvent): { head?: ReactNode; files?: ReactNode; continues?: ReactNode } {
  const { items, open } = useContext(Cards);
  if (!e.answer) return {};
  const { thread, files, continues } = e.answer;
  const host = items.find((i) => i.id === e.cardId);
  const own = host?.thread?.talk === thread;
  return {
    ...(own ? {} : { head: <ThreadCard thread={thread} card={items.find((i) => i.kind === 'question' && i.thread?.talk === thread)} onOpen={open} /> }),
    files: <AnswerFiles thread={thread} files={files} />,
    ...(continues ? { continues: <Continues question={continues} /> } : {}),
  };
}

/** Under a follow-up: which answer it continues, and while it is looked up, that its agent reads. */
export const Continues = ({ question, reading }: { question: string; reading?: boolean }) => (
  <div className="continues mt-1 text-xs text-muted-foreground">
    {t.answer.continues(clip(plain(question), 90))}
    {reading && ` · ${t.answer.reading}`}
  </div>
);

