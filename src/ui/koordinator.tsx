// The Koordinator's sheet: the conversation, with the height the sheet has, and below it sections
// that open and close: the rules it learned and proposes, with the values for repositories'
// settings the work retrospective proposes, and the owner's preferences; shared demos to bring
// up to date at once.

import { cn } from 'cn';
import { conversationBox, conversationList, headClass } from './cardClasses';
import { noteClass } from './components/ai/message';
import { Settings } from 'lucide-react';
import { Docked } from './docked';
import { ChatsHead } from './chats';
import { Fragment, useEffect, useRef, useState } from 'react';
import { AGENT_MODELS, type AgentModel, type Chat, type Item, type Preference, type RepoRef, type Reshare, type SettingProposal, type Talk, type TalkQuote, type TalkRef, type TalkWait } from '../core/types';
import { api } from './api';
import { Inline, plain } from './markdown';
import { AnswerFiles, Body, Continues, Msg, Quote, Reading, ThreadCard } from './message';
import { type Reply, setReply, talkEv, talkQuote } from './reply';
import { clock, failText, t } from './strings';
import { CiteButton } from './cite';
import { Composer } from './composer';
import { cardDraft, OBEYA_DRAFT } from './draft';
import { Shots } from './shots';
import { usePageVisible } from './seen';
import { Conversation as Scroll } from './components/ai/conversation';
import { useFitHeight } from './fitHeight';
import { PageChangeList } from './page-changes';
import { fromLinkClass, occasionClass, prefActionsClass, prefRowClass, prefTextClass, proposalRowClass, proposalsClass, proposalTextClass, settingLabelClass, settingValueClass, targetClass } from './prefsClasses';
import { WishReplyLink } from './wish';
import { ClockMark } from './snooze';
import { know, known } from './known';
import { cardPath, switchTo } from './address';
import { CardLink, Naming } from './cardLink';
import { scrollBehavior } from './motion';
import { Button, CloseButton } from './components/button';
import { Textarea } from './components/input';
import { Progress } from './components/progress';
import { Select, SelectItem } from './components/select';

interface Props {
  on: boolean;
  /** The project, whose sections stay open or closed as the owner left them. */
  project: string;
  projectName: string;
  /** A command typed in the sheet, maybe in reply to a message of it: read like a spoken one; the conversation shows it at once. */
  onTell: (text: string, images?: string[], replyTo?: Reply['to']) => void;
  items: Item[];
  preferences: Preference[];
  /** Values for repositories' settings the work retrospective proposes. */
  settings: SettingProposal[];
  /** The project's repositories, whose CLAUDE.md a proposal may go into. */
  repos: RepoRef[];
  talk: Talk[];
  /** The chat the owner talks in now, and the project's chats. */
  chat: number;
  chatModel?: AgentModel;
  chats: Chat[];
  reshare?: Reshare;
  onOpen: (i: Item) => void;
  /** Opens the configuration dialog at a repository's setting. */
  onConfig: (repo: string, setting: string) => void;
  /** A chat of another project was opened: that project's sheet. */
  onProject: (project: string) => void;
  /** Closes the sheet. */
  onClose: () => void;
}

export function KoordinatorSheet({ on, project, projectName, items, repos, talk, chat, chatModel, chats, reshare, onOpen, onTell, onProject, onClose }: Props) {
  return (
    <Docked id="ksheet" on={on}>
      <ChatsHead title={<h2>{t.koordinator.title}</h2>} project={project} projectName={projectName} chat={chat} chats={chats} talk={talk} onProject={onProject} onClose={onClose} />
      <KoordinatorTalk on={on} project={project} talk={talk} chat={chat} chatModel={chatModel} chats={chats} items={items} repos={repos} onOpen={onOpen} onTell={onTell} />

      <div className="k-rest">
        {reshare && <ReshareBox r={reshare} items={items} onOpen={onOpen} />}


      </div>
    </Docked>
  );
}

/**
 * Seismic's conversation with the field under it, in the sheet and in the phone view; `draft` is the
 * field's (the sidebar's, or the phone view's for this project). `on`: the conversation is in view,
 * so the answers waiting in it are read.
 */
export function KoordinatorTalk({ on, project, talk: all, chat, chatModel, chats, items, repos, onOpen, onTell, draft = OBEYA_DRAFT }: Pick<Props, 'on' | 'project' | 'talk' | 'chat' | 'chatModel' | 'chats' | 'items' | 'repos' | 'onOpen' | 'onTell'> & { draft?: string }) {
  const talk = all.filter((x) => x.chat === undefined || x.chat === chat);
  const fresh = useRead(on, talk, (ids) => api.readTalk(ids));
  useEffect(() => {
    // opened for an answer that waits in another chat, with none in this one: that chat opens
    const waits = all.findLast((x) => x.unread && x.chat !== undefined && x.chat !== chat);
    if (on && waits && !talk.some((x) => x.unread)) api.openChat(waits.chat!).catch(console.error);
  }, [on]);
  return (
    <>
      {talk.length ? <Conversation talk={talk} fresh={fresh} items={items} onOpen={onOpen} draft={draft} /> : (
        <div className={cn(conversationList, conversationBox, 'fresh-chat')}>
          {chats.length > 0 && <p className="hint">{t.koordinator.chatFresh}</p>}
        </div>
      )}
      {/* a command in writing, for when speaking is not possible; its screenshots go to the cards it creates or concerns */}
      <Composer className="tell" draft={draft} placeholder={t.voice.typePlaceholder} obeya onSend={onTell} />
      <label className="chat-model">{t.koordinator.chatModel}
        <Select value={chatModel ?? ''} onValueChange={(picked) => void api.setChatModel(project, picked || undefined).catch(console.error)}>
          <SelectItem value="">{t.koordinator.projectModel}</SelectItem>
          {AGENT_MODELS.map((model) => <SelectItem key={model} value={model}>{model === 'default' ? t.koordinator.defaultModel : model[0]!.toUpperCase() + model.slice(1)}</SelectItem>)}
        </Select>
      </label>
      <ReviewHint items={items} repos={repos} />
    </>
  );
}

/** Where the project has seen a review card: the hint on "Review PR #5" is no longer shown. */
const REVIEW_KNOWN = 'obeya-review-pr-known';

/**
 * Under Seismic's field, where a repository of the project is on a forge and until the owner has had a
 * review card once or closed it: one quiet line on how to have someone else's pull request reviewed.
 */
function ReviewHint({ items, repos }: { items: Item[]; repos: RepoRef[] }) {
  const used = items.some((i) => i.review?.contribution);
  const [closed, setClosed] = useState(() => known(REVIEW_KNOWN));
  useEffect(() => {
    if (used) know(REVIEW_KNOWN);
  }, [used]);
  if (used || closed || !repos.some((r) => r.forge)) return null;
  return (
    <p className="tell-hint">
      <span>{t.review.hint}</span>
      <CloseButton label={t.review.hideHint} size="small" onClick={() => {
          know(REVIEW_KNOWN);
          setClosed(true);
        }} />
    </p>
  );
}

/**
 * A plan's conversation with its plan agent, in its sheet: what the owner asked it there or
 * asked Seismic about the plan, and the answers, with the field to ask more (not once the plan
 * is archived). `on`: the conversation is in view.
 */
export function PlanTalk({ on, plan, talk, items, onOpen }: { on: boolean; plan: Item; talk: Talk[]; items: Item[]; onOpen: (i: Item) => void }) {
  const fresh = useRead(on, talk, (ids) => api.readTalk(ids));
  const draft = cardDraft(plan.id);
  const [error, setError] = useState('');
  const end = useFollowInSheet(talk);
  // answers that waited unread (the plan's card said so) are where the sheet opens, below the workstreams
  const waited = fresh[0];
  useEffect(() => {
    if (waited !== undefined) end.current?.querySelector('.msg.fresh')?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
  }, [waited]);
  return (
    <section className="p-talk" ref={end}>
      <h4 className={headClass}>{t.plan.askHead}</h4>
      {!talk.length && <p className="hint">{t.plan.askHint}</p>}
      <Conversation talk={talk} fresh={fresh} items={items} onOpen={onOpen} draft={draft} sheetOf={plan.id} />
      {!plan.archivedAt && (
        <Composer
          className="tell"
          draft={draft}
          placeholder={t.plan.askPlaceholder}
          label={t.plan.askSend}
          onSend={(text, images, replyTo) => {
            setError('');
            return api.act(plan.id, { action: 'consult', text, ...(images ? { images } : {}), ...(replyTo && typeof replyTo !== 'number' ? { replyTo } : {}) }).catch((e) => setError(failText(e)));
          }}
        />
      )}
      {error && <p className="p-error">{error}</p>}
    </section>
  );
}

/**
 * The plan's conversation has no scrollbar of its own: it grows in the sheet, which scrolls. What
 * the owner just asked, and an answer that comes while the field under the conversation is in view,
 * is brought into view there: the field stays in view, unless the answer is taller than the sheet,
 * whose start then stands at the sheet's top. Returns the ref of the conversation's section.
 */
function useFollowInSheet(talk: Talk[]) {
  const box = useRef<HTMLElement>(null);
  // whether the end of the conversation is in view, as the owner last scrolled the sheet
  const inView = useRef(true);
  useEffect(() => {
    const el = box.current;
    const sheet = el?.closest('.sheet');
    if (!el || !sheet) return;
    const see = new IntersectionObserver(([e]) => void (inView.current = !!e?.isIntersecting), { root: sheet });
    const field = el.querySelector('.composer') ?? el;
    see.observe(field);
    return () => see.disconnect();
  }, []);
  const last = talk.at(-1);
  // what changes once the owner asks and once an answer comes
  const key = `${last?.id}:${last?.answer !== undefined}`;
  const seen = useRef(key);
  useEffect(() => {
    if (key === seen.current) return;
    seen.current = key;
    const el = box.current;
    const sheet = el?.closest('.sheet');
    if (!el || !sheet || !inView.current) return;
    const msgs = el.querySelectorAll('.talk > .msg');
    const newest = msgs[msgs.length - 1];
    const tall = !!newest && newest.getBoundingClientRect().height > sheet.clientHeight * 0.8;
    (tall ? newest : (el.querySelector('.composer') ?? el)).scrollIntoView({ block: tall ? 'start' : 'nearest', behavior: scrollBehavior() });
  }, [key]);
  return box;
}

/**
 * Answers that came while the owner was elsewhere are read once the conversation is in view (its
 * sheet open, and the page not hidden); those that were waiting stay marked until it closes, so the
 * owner sees which. Those that come while it is in view are read as they come, unmarked. `read`
 * tells the server, with the ids of those read.
 */
function useRead(on: boolean, talk: Talk[], read: (ids: number[]) => Promise<unknown>): number[] {
  const [fresh, setFresh] = useState<number[]>([]);
  const visible = usePageVisible();
  const unread = talk.filter((x) => x.unread).map((x) => x.id);
  const inView = useRef(false);
  useEffect(() => {
    const was = inView.current;
    inView.current = on && visible;
    if (!on) return setFresh([]);
    if (!visible || !unread.length) return;
    if (!was) setFresh((f) => [...f, ...unread.filter((id) => !f.includes(id))]);
    read(unread).catch(() => {});
  }, [on, visible, unread.join()]);
  return fresh;
}

/**
 * What the owner said to the Koordinator with no card open, and its replies; newest last. The owner
 * can reply to each message, as on a card: it stands quoted above the field, and above the words
 * that reply to it. Words written in a plan's sheet went straight to its plan agent, with no
 * reply of Seismic's; outside that sheet (`sheetOf`) a line names the plan.
 */
function Conversation({ talk, fresh, items, onOpen, draft, sheetOf }: { talk: Talk[]; fresh: number[]; items: Item[]; onOpen: (i: Item) => void; draft: string; sheetOf?: string }) {
  const box = useRef<HTMLDivElement>(null);
  if (!talk.length) return null;
  // every change on the project brings a new snapshot: only what the owner just said takes the
  // conversation back to its end, so they can read further up in the meantime
  return (
    <Scroll className={conversationBox} contentClassName={conversationList} boxRef={box} said={talk.at(-1)?.id} entries={talk} scrolling={!sheetOf}>
      {talk.map((x) => {
        // the owner replies to one of the exchange's messages
        const reply = (part: TalkRef['part'], by: TalkQuote['by'], text: string) => () => {
          const q = { talk: x.id, part, by, text };
          setReply(draft, { to: { talk: x.id, part }, quote: talkQuote(q) });
        };
        // a thread moved onto a Question card goes on there, while the card is on the project; once it
        // is done (archived) or deleted, its answers stand here again
        const card = x.movedTo ? items.find((i) => i.id === x.movedTo) : undefined;
        const asked = x.askedIn && x.askedIn !== sheetOf ? items.find((i) => i.id === x.askedIn) : undefined;
        // a card left for another project, built there in a new repository: a line with a link to it there
        if (x.moved)
          return (
            <div key={x.id} className={`${noteClass} ev-state`}>
              {clock(x.at)} · {t.koordinator.moved(plain(x.moved.title), x.moved.projectName)}{' '}
              <a className="link" href={cardPath(x.moved.project, x.moved.card)} onClick={(e) => switchTo(e, cardPath(x.moved!.project, x.moved!.card))}>
                {t.openThere}
              </a>
            </div>
          );
        return (
          <Fragment key={x.id}>
            {/* Seismic took a step up by itself, once a card it waited on got there or the answer it looked up for it came in: no words of the owner's */}
            {x.after ? (
              <div className={`${noteClass} ev-state`}>
                {clock(x.at)} · {t.koordinator.after(x.after.title, x.after.met, x.after.state)}
              </div>
            ) : x.answered ? null : (
              <Msg by="owner" who={t.author.owner} at={x.at} ev={talkEv({ talk: x.id, part: 'said' })} onReply={reply('said', 'owner', x.said)}>
                {x.replyTo && <Quote q={talkQuote(x.replyTo)} />}
                <Body md={x.said} />
                <Shots ids={x.images} />
                {x.continues && <Continues question={x.continues} reading={x.answer === undefined && !card} />}
                {asked && <div className="hint">{t.koordinator.askedIn(plain(asked.title))}</div>}
              </Msg>
            )}
            {x.askedIn ? null : x.heldUntil ? (
              <Msg by="koordinator" className="thinking" who={t.author.koordinator}>
                <div className="hint">{t.koordinator.held(clock(x.heldUntil))}</div>
              </Msg>
            ) : x.reply === undefined ? (
              <Reading />
            ) : (
              <Msg
                by="koordinator"
                // what waited unread: the reply, unless an answer to look up follows it
                className={x.undone ? 'undone' : fresh.includes(x.id) && !x.question ? 'fresh' : undefined}
                who={t.author.koordinator}
                agent={x.replyAgent}
                at={x.at}
                ev={talkEv({ talk: x.id, part: 'reply' })}
                onReply={reply('reply', 'koordinator', x.reply)}
              >
                <Body md={x.reply} />
                {x.wish && !x.undone && <WishReplyLink wish={x.wish} />}
                {x.undone && <div className="hint">{t.koordinator.undone}</div>}
                {x.waits?.map((w) => <WaitLine key={w.card} talk={x.id} wait={w} card={items.find((i) => i.id === w.card)} onOpen={onOpen} />)}
              </Msg>
            )}
            {/* a line leads to the Question card the thread goes on at */}
            {card ? (
              <div className="moved mt-0.5 mb-2">
                <ThreadCard thread={x.thread!} card={card} onOpen={onOpen} />
              </div>
            ) : (
              <>
                {/* a question it looked up: the answer follows the acknowledgement */}
                {x.question && x.answer === undefined && (
                  <Msg by={x.askedIn ? 'plan' : 'koordinator'} className="thinking" who={t.author[x.askedIn ? 'plan' : 'koordinator']} agent={x.lookUpAgent}>
                    <div className="hint">{x.limitedUntil ? t.koordinator.lookUpLimited(clock(x.limitedUntil)) : t.koordinator.lookingUp}</div>
                  </Msg>
                )}
                {x.answer !== undefined && (
                  <Msg
                    by={x.answerBy ?? 'koordinator'}
                    className={fresh.includes(x.id) ? 'fresh' : undefined}
                    who={t.author[x.answerBy ?? 'koordinator']}
                    agent={x.answerAgent}
                    ev={talkEv({ talk: x.id, part: 'answer' })}
                    onReply={reply('answer', x.answerBy ?? 'koordinator', x.answer)}
                    head={x.thread !== undefined && <ThreadCard thread={x.thread} onOpen={onOpen} />}
                  >
                    <Body md={x.answer} />
                    {x.thread !== undefined && <AnswerFiles thread={x.thread} files={x.files} />}
                  </Msg>
                )}
              </>
            )}
          </Fragment>
        );
      })}
      <CiteButton box={box} draft={draft} />
    </Scroll>
  );
}

/** Under Seismic's reply: a card it waits on, to take the step it said it would take then; "Stop waiting" drops that step. */
function WaitLine({ talk, wait, card, onOpen }: { talk: number; wait: TalkWait; card: Item | undefined; onOpen: (i: Item) => void }) {
  return (
    <div className="hint wait-line flex flex-wrap items-center gap-y-1 gap-x-2 mt-1.5 [&_.clock-mark]:align-[-1px]">
      <span>
        <ClockMark /> <Naming text={(title) => t.koordinator.waits(title, wait.state)} cards={[{ card, title: wait.title }]} onOpen={onOpen} />
      </span>
      <Button size="small" title={t.koordinator.unwaitHint} onClick={() => void api.unwait(talk, wait.card).catch(() => {})}>
        {t.koordinator.unwait}
      </Button>
    </div>
  );
}

/** An error to show under a row, and `act`, which runs a request and then shows its error or clears it. */
function useAct(fail?: Parameters<typeof failText>[1]): [string, (fn: () => Promise<unknown>) => Promise<void>] {
  const [error, setError] = useState('');
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError('');
    } catch (e) {
      setError(failText(e, fail));
    }
  };
  return [error, act];
}

/** Where a rule goes: the owner's preferences or a repository's CLAUDE.md. */
function TargetPick({ value, repos, onChange }: { value: string; repos: RepoRef[]; onChange: (target: string) => void }) {
  return (
    <label className={targetClass}>
      {t.koordinator.target}
      <Select value={value} onValueChange={(picked) => onChange(picked)}>
        <SelectItem value="">{t.koordinator.targetPreferences}</SelectItem>
        {repos.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {t.koordinator.targetClaudeMd(r.name)}
          </SelectItem>
        ))}
      </Select>
    </label>
  );
}

/** A rule's text being edited in place: Enter takes it, Escape leaves it as it was. */
function RuleEdit({ draft, setDraft, onEnter, onBlur }: { draft: string; setDraft: (d: string | null) => void; onEnter: () => void; onBlur?: () => void }) {
  return (
    <Textarea
      data-esc
      className="flex-1"
      autoFocus
      value={draft}
      rows={2}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onEnter();
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
}

/**
 * A rule the Koordinator learned, with where it came from and where it goes (the preferences, or a
 * repository's CLAUDE.md): the owner accepts it, in their own words and for another place if they
 * like, or rejects it.
 */
export function ProposalRow({ p, items, rules, repos, onOpen, project }: { p: Preference; items: Item[]; rules: Preference[]; repos: RepoRef[]; onOpen: (i: Item) => void; project?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [target, setTarget] = useState(p.target ?? '');
  const [error, decide] = useAct();
  const card = p.cardId ? items.find((i) => i.id === p.cardId) : undefined;
  const replaced = p.replaces !== undefined ? rules.find((r) => r.id === p.replaces) : undefined;
  const accept = () =>
    decide(() => api.acceptProposal(p.id, draft === null || draft.trim() === p.text ? undefined : draft.trim(), target === (p.target ?? '') ? undefined : target || null, project));
  const quote = p.quote && (p.quote.length > 200 ? `${p.quote.slice(0, 200).trimEnd()} …` : p.quote);
  return (
    <li className={cn(proposalRowClass, 'proposal')}>
      {draft === null ? (
        <span className={proposalTextClass}>{p.text}</span>
      ) : (
        <RuleEdit draft={draft} setDraft={setDraft} onEnter={() => draft.trim() && accept()} />
      )}
      {replaced && <span className={occasionClass}>{t.koordinator.changes(replaced.text)}</span>}
      <span className={occasionClass}>
        {p.review ? (
          <>
            {t.koordinator.fromReview}
            {quote && `: ${quote}`}
          </>
        ) : (
          <>
            {card && <CardLink card={card} title={card.title} onOpen={onOpen} />}
            {card && quote && ': '}
            {quote && <q>{quote}</q>}
          </>
        )}
      </span>
      <TargetPick value={target} repos={repos} onChange={setTarget} />
      <span className={prefActionsClass}>
        <Button size="small" variant="primary" disabled={draft !== null && !draft.trim()} onClick={accept}>
          {t.koordinator.accept}
        </Button>
        {draft === null ? (
          <Button size="small" onClick={() => setDraft(p.text)}>
            {t.koordinator.change}
          </Button>
        ) : (
          <Button size="small" onClick={() => setDraft(null)}>
            {t.koordinator.cancel}
          </Button>
        )}
        <Button size="small" variant="danger" onClick={() => decide(() => api.rejectProposal(p.id, project))}>
          {t.koordinator.reject}
        </Button>
      </span>
      {error && <span className="p-error">{error}</span>}
    </li>
  );
}

/** A cog: what a setting proposal changes is the configuration. */
function GearIcon() {
  return (
    <Settings size={13} strokeWidth={2} aria-hidden="true" />
  );
}

/**
 * The value of a setting proposal as the owner edits it, kept per tab while it waits, so an edit
 * outlives closing the sheet and a page load.
 */
function useSettingDraft(id: number, proposed: string): [string, (v: string) => void] {
  const key = `obeya-setting-draft-${id}`;
  const [draft, setDraft] = useState(() => sessionStorage.getItem(key) ?? proposed);
  return [
    draft,
    (v) => {
      setDraft(v);
      try {
        if (v === proposed) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, v);
      } catch {}
    },
  ];
}

/** A value as the owner reads and edits it: a list one entry a line. */
const asText = (v: string | string[]) => (Array.isArray(v) ? v.join('\n') : v);

/**
 * A value for a repository's setting the work retrospective proposes, with the cards it rests on and
 * the value it would replace: the owner takes it, as it is or changed, on this machine or into the
 * repository for everyone (neither is the default: they choose each time), or rejects it.
 */
export function SettingRow({ p, items, repo, onOpen, onConfig, project }: { p: SettingProposal; items: Item[]; repo: RepoRef | undefined; onOpen: (i: Item) => void; onConfig?: () => void; project?: string }) {
  const [draft, setDraft] = useSettingDraft(p.id, asText(p.value));
  const field = useRef<HTMLTextAreaElement>(null);
  useFitHeight(field, draft);
  const [busy, setBusy] = useState(false);
  const [error, act] = useAct({ detail: ['settingsShare'] });
  const k = t.koordinator;
  const list = Array.isArray(p.value);
  const decide = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await act(fn);
    setBusy(false);
  };
  const changed = draft.trim() !== asText(p.value);
  const edited = !changed ? undefined : list ? draft.split('\n').map((x) => x.trim()).filter(Boolean) : draft.trim();
  const take = (where: 'machine' | 'repository') => decide(() => api.takeSetting(p.id, where, edited, project));
  const now = p.now === undefined ? null : asText(p.now).trim();
  const branch = repo?.branch ?? 'main';
  const everyone = repo?.pullRequests ? k.forEveryonePr(branch) : k.forEveryoneMain(branch);
  return (
    <li className={cn(proposalRowClass, 'proposal setting')}>
      <span className="setting-kind basis-full flex flex-wrap items-center gap-[5px] text-proposal text-[11.5px] font-semibold tracking-[.02em]">
        <GearIcon />
        {k.settingKind(repo?.name ?? p.repo)}
      </span>
      <span className="setting-name basis-full flex items-baseline gap-2">
        <span className={proposalTextClass}>{t.config.settings[p.field]}</span>
        {onConfig && <a className={cn(fromLinkClass, 'ml-auto whitespace-nowrap text-[12px]')} title={k.openConfigHint} onClick={onConfig}>
          {k.openConfig}
        </a>}
      </span>
      <span className="setting-diff basis-full grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 [align-items:start]">
        {now !== null && (
          <>
            <span className={settingLabelClass}>{k.settingWas}</span>
            <pre className={cn(settingValueClass, 'was text-muted-foreground bg-transparent border border-dashed border-line', !now && 'setting-none [font-family:inherit] italic')}>{now || k.settingEmpty}</pre>
          </>
        )}
        <span className={settingLabelClass}>{k.settingNew}</span>
        <span className="setting-new flex flex-col gap-[3px] min-w-0">
          <Textarea ref={field} className={cn(settingValueClass, 'flex-none resize-none overflow-hidden min-w-0 focus:bg-card')} aria-label={k.settingNew} spellCheck={false} rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <span className="setting-edit text-muted-foreground text-[11.5px]">
            {changed ? (
              <>
                {k.settingEdited}{' '}
                <a className={fromLinkClass} onClick={() => setDraft(asText(p.value))}>
                  {k.settingRestore}
                </a>
              </>
            ) : (
              k.settingEditable
            )}
          </span>
        </span>
      </span>
      <span className={occasionClass}>
        {k.fromRetro}: <Inline md={p.basis} />{' '}
        {p.cards.map((c, i) => {
          const card = items.find((x) => x.id === c.id);
          return (
            <Fragment key={c.id}>
              {i > 0 && ', '}
              <CardLink card={card} title={c.title} onOpen={onOpen} />
            </Fragment>
          );
        })}
      </span>
      <span className={prefActionsClass}>
        <span className="take-on basis-full text-muted-foreground text-[12px]">{k.takeOn}</span>
        <Button variant="primary" disabled={busy || !draft.trim()} title={k.onMachineHint} onClick={() => take('machine')}>
          {k.onMachine}
        </Button>
        <Button variant="primary" disabled={busy || !draft.trim()} title={everyone} onClick={() => take('repository')}>
          {k.forEveryone}
        </Button>
      </span>
      <span className={occasionClass}>
        {k.onMachine}: {k.onMachineHint} {k.forEveryone}: {everyone}
      </span>
      <span className={prefActionsClass}>
        <Button size="small" variant="danger" disabled={busy} onClick={() => decide(() => api.rejectSetting(p.id, project))}>
          {k.reject}
        </Button>
      </span>
      {error && <span className="p-error">{error}</span>}
    </li>
  );
}

/** How many of the outdated shared demos to share again at once: the newest few, or all. */
const RESHARE_COUNTS = [10, 20, 50, 100];

/**
 * Shared demos whose pages are made differently now: shared again many at once, the newest first,
 * one after the other, with how far it got and which failed.
 */
function ReshareBox({ r, items, onOpen }: { r: Reshare; items: Item[]; onOpen: (i: Item) => void }) {
  const counts = RESHARE_COUNTS.filter((n) => n < r.outdated);
  const [pick, setPick] = useState<number | 'all'>();
  const [error, act] = useAct();
  // the newest 20 unless the owner picks otherwise; null is all of them
  const chosen = pick === 'all' ? null : pick !== undefined && counts.includes(pick) ? pick : (counts.find((n) => n >= 20) ?? null);
  const run = r.run;
  const going = !!run && run.left > 0;
  const s = t.koordinator.reshare;
  const out = run ? run.done + run.failed.length : 0;
  return (
    <div className="reshare mt-4 [.k-rest_&]:my-2">
      <ul className={proposalsClass}>
        {run && (
          <li className={proposalRowClass}>
            <span className={proposalTextClass}>
              {run.tags
                ? going
                  ? s.tagProgress(out, run.total)
                  : run.stopped
                    ? s.tagStopped(run.done, run.total)
                    : s.tagFinished(run.done, run.total)
                : going
                  ? s.progress(out, run.total)
                  : run.stopped
                    ? s.stopped(run.done, run.total)
                    : s.finished(run.done, run.total)}
            </span>
            <Progress
              value={run.total ? (100 * out) / run.total : 100}
              aria-label={s.barLabel}
              className="basis-full bg-proposal/18"
              indicatorClassName="bg-proposal"
            />
            {going && run.current && <span className={occasionClass}>{s.now(plain(run.current))}</span>}
            {run.failed.length > 0 && (
              <span className={occasionClass}>
                {s.failed(run.failed.length)}
                {run.failed.map((f) => {
                  const card = items.find((i) => i.id === f.id);
                  return (
                    <span key={f.id} className="failed block mt-0.5">
                      <CardLink card={card} title={f.title} onOpen={onOpen} />
                    </span>
                  );
                })}
              </span>
            )}
            {/* beside the notice of outdated pages, its "Ausblenden" puts both away; a run tagging pages goes alone */}
            {(going || run.tags || !r.outdated) && (
              <span className={prefActionsClass}>
                {going ? (
                  <Button size="small" title={s.stopHint} disabled={!!run.stopped} onClick={() => act(api.stopReshare)}>
                    {s.stop}
                  </Button>
                ) : (
                  <Button size="small" onClick={() => act(api.dismissReshare)}>
                    {s.dismiss}
                  </Button>
                )}
              </span>
            )}
          </li>
        )}
        {r.outdated > 0 && !going && (
          <li className={proposalRowClass}>
            <span className={proposalTextClass}>{s.outdated(r.outdated)}</span>
            <span className={occasionClass}>{s.outdatedHint}</span>
            {/* the list's rows in the type of the row it stands in */}
            {r.changes && <PageChangeList changes={r.changes} className="basis-full m-0 [&>li]:items-start [&>li]:text-[13px] [&>li]:cursor-default" />}
            <span className={prefActionsClass}>
              {counts.length > 0 && (
                <Select value={chosen == null ? '' : String(chosen)} onValueChange={(picked) => setPick(picked ? Number(picked) : 'all')}>
                  {counts.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {s.newest(n)}
                    </SelectItem>
                  ))}
                  <SelectItem value="">{s.all(r.outdated)}</SelectItem>
                </Select>
              )}
              <Button size="small" variant="primary" onClick={() => act(() => api.reshare(chosen))}>
                {s.go}
              </Button>
              <Button size="small" title={s.dismissOutdatedHint} onClick={() => act(api.dismissReshare)}>
                {s.dismiss}
              </Button>
            </span>
          </li>
        )}
        {!!r.untagged && !going && (
          <li className={proposalRowClass}>
            <span className={proposalTextClass}>{s.untagged(r.untagged)}</span>
            <span className={occasionClass}>{s.untaggedHint}</span>
            <span className={prefActionsClass}>
              <Button size="small" variant="primary" onClick={() => act(() => api.reshare(null, true))}>
                {s.tag(r.untagged)}
              </Button>
            </span>
          </li>
        )}
      </ul>
      {error && <p className="p-error">{error}</p>}
    </div>
  );
}

export function PreferenceRow({ p }: { p: Preference }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, act] = useAct();
  const save = () => {
    if (draft === null || draft.trim() === p.text) return setDraft(null);
    act(async () => {
      await api.setPreference(p.id, draft);
      setDraft(null);
    });
  };
  return (
    <li className={prefRowClass}>
      {draft === null ? (
        <span className={prefTextClass} title={t.koordinator.edit} onClick={() => setDraft(p.text)}>
          {p.text}
        </span>
      ) : (
        <RuleEdit draft={draft} setDraft={setDraft} onEnter={save} onBlur={save} />
      )}
      <CloseButton label={t.koordinator.remove} size="small" variant="danger" onClick={() => api.setPreference(p.id, null).catch(() => {})} />
      {error && <span className="p-error">{error}</span>}
    </li>
  );
}

/** A rule the owner writes: one of theirs, active at once, or for a repository's CLAUDE.md, which goes into its card "Add to CLAUDE.md". */
export function NewPreference({ repos }: { repos: RepoRef[] }) {
  const [text, setText] = useState('');
  const [target, setTarget] = useState('');
  const [filed, setFiled] = useState('');
  const [error, act] = useAct();
  const add = () =>
    text.trim() &&
    act(async () => {
      await api.addPreference(text.trim(), target || undefined);
      setText('');
      setFiled(target ? t.koordinator.filed(repos.find((r) => r.id === target)?.name ?? target) : '');
    });
  return (
    <div className="composer pref-new mt-2 gap-x-2.5 gap-y-1.5">
      <Textarea
        className="min-h-[38px]"
        value={text}
        rows={1}
        placeholder={t.koordinator.addPlaceholder}
        onChange={(e) => {
          setText(e.target.value);
          setFiled('');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            add();
          }
        }}
      />
      <Button disabled={!text.trim()} onClick={add}>
        {t.koordinator.add}
      </Button>
      <TargetPick value={target} repos={repos} onChange={setTarget} />
      {filed && <span className="hint filed basis-full">{filed}</span>}
      {error && <span className="p-error basis-full">{error}</span>}
    </div>
  );
}
