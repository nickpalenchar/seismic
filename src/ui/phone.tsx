// The phone view: on a phone the page shows, instead of the project, the Agents view across every
// project, with the desktop sheet's tabs: "All" (the cards by stage, what needs the owner first as the
// inbox lists it, and "Done" for what is finished but not archived, hidden until its chip is tapped),
// "Queue", "Parked" and "Activity"; Seismic's conversation is a panel of its own that
// comes up from below. A card opens full screen with the project's own detail view (answer options,
// demo, approve buttons), its conversation in the same panel, and Back returns to the list. The microphone is held by touch; Enter breaks the line, only Send sends;
// the list itself has a plus button in the microphone's place, which makes a card and opens it (the microphone is back with a panel open);
// what was typed but not sent survives a reload. It holds one WebSocket per project.


import { ChevronDown, ChevronLeft, Plus } from 'lucide-react';
import { finishedArchivable, inParkingLot, type Item, needsYou, type ProjectInfo, snoozeOf, unreadAnswers } from '../core/types';
import { AGENT_STAGES, agentStage } from '../core/agents';
import { AgentsTabs, StageChips, useAgentsTab } from './agents';
import { ActivityTab } from './activity';
import { QueueList, useQueueSort } from './queue';
import { useStoredState } from './stored';
import { ChatsHead } from './chats';
import { InboxList } from './inbox';
import { phoneNoneClass } from './inboxClasses';
import { sendReply } from './quickReply';
import { obeyaDraft } from './draft';
import { KoordinatorTalk } from './koordinator';
import { Sign } from './logo';
import { Notify } from './notify';
import { KoordinatorAgent } from './message';
import { t } from './strings';
import { UsagePill } from './usage';
import { obeyaWorks, runs } from './talk';
import { Tooltip } from './components/tooltip';
import { Badge } from './components/badge';
import { pillVariants } from './components/pill';
import { cn } from 'cn';
import { HoldToTalk } from './voice';
import { pageClass, pageBarClass } from './phoneEnvironment';
import { TalkPanel, talkClass, wordClass, gripWordClass } from './phoneTalkPanel';
import { CardList, phoneControl, sectionClass, sectionHeadClass, TalkButton, usePhoneShell } from './phoneShell';

/** The stages "All" groups the cards by on the phone: the desktop's, then the finished cards not archived yet. */
const PHONE_STAGES = [...AGENT_STAGES, 'done'] as const;
type PhoneStage = (typeof PHONE_STAGES)[number];

/**
 * The list's plus button, in the microphone's place and of its size: a new card. Held by a finger, it
 * opens no long-press menu and selects nothing; hidden while the keyboard is up, and with the phone
 * turned in the microphone's strip, centred in it.
 */
const newClass =
  'ph-new fixed z-50 left-1/2 bottom-[calc(18px+env(safe-area-inset-bottom))] [transform:translateX(-50%)] w-[68px] h-[68px] rounded-full border-0 p-0 grid place-items-center cursor-pointer bg-card text-ink shadow-lift [-webkit-touch-callout:none] select-none active:shadow-glass active:[transform:translateX(-50%)_translateY(1px)] disabled:text-muted-foreground disabled:cursor-default [.ph-kb_.ph-view~&]:hidden ph-landscape:left-auto ph-landscape:right-[calc(56px+env(safe-area-inset-right))] ph-landscape:[translate:50%_0] ph-landscape:top-[calc(50%-34px)] ph-landscape:bottom-auto ph-landscape:[transform:none] ph-landscape:active:[transform:none]';


export function Phone({ projects: loaded }: { projects: ProjectInfo[] }) {
  const s = usePhoneShell(loaded);
  const { projects, snaps, usage, feeds, banner, all, ordered, several, open, openCard, talk, openTalk, closeTalk, closing, setClosing, leaveTalk, obeyaId, setObeyaProject, entries, inboxRead, isUnderway, setUnderway, homeRef, newCard, making, made, showAck, tellTyped, press, acks, mic, back } = s;
  // the tab and the groups shown, as the owner left them; "Done" hidden until its chip is tapped
  const [tab, setTab] = useAgentsTab('all');
  const [hidden, setHidden] = useStoredState<PhoneStage[]>('obeya-phone-hidden', ['done']);

  if (open)
    return s.cardScreen(
      <header className={pageBarClass}>
        <button className="ph-back inline-flex items-center gap-0.5 min-h-10 py-0 pr-3 pl-1.5 border-0 rounded-[3px] bg-chip text-[16px] cursor-pointer ph-landscape:min-h-9" onClick={back}>
          <ChevronLeft size={18} strokeWidth={2.25} aria-hidden="true" />
          {t.phone.back}
        </button>
        {s.opened && several && <span className="ph-project ml-auto text-muted-foreground text-[13px]">{s.opened.project.name}</span>}
      </header>,
    );


  const obeyaSnap = snaps[obeyaId];
  const unreadOf = (id: string) => (snaps[id] ? unreadAnswers(snaps[id].talk) : 0);
  const unread = ordered.reduce((n, c) => n + unreadOf(c.id), 0);
  /** The panel, with the conversation an answer waits unread in when the one last picked has none. */
  const openTalkNewest = () => {
    const waiting = ordered.find((c) => unreadOf(c.id));
    if (!unreadOf(obeyaId) && waiting) setObeyaProject(waiting.id);
    openTalk();
  };
  const shown = talk && !closing;
  // "All": what needs the owner as the inbox lists it (Seismic's answers and snoozed cards among them),
  // every other card by the stage it is at, and what is finished but not archived yet
  const inInbox = new Set(entries.flatMap((e) => (e.card ? [e.card.id] : [])));
  const stageOf = (i: Item): PhoneStage | undefined => {
    if (inInbox.has(i.id) || i.archivedAt || inParkingLot(i)) return undefined;
    const s = agentStage(i, isUnderway(i.id));
    if (s && s !== 'needsYou') return s;
    // an idea's or a question's agent at work: the phone has no canvas to find it on, so it stands under "Working"
    if (!s && !i.queue && runs(i)) return 'working';
    if (!s && finishedArchivable(i) && !needsYou(i) && !snoozeOf(i)?.waiting && !runs(i) && !isUnderway(i.id)) return 'done';
    return undefined;
  };
  const staged = PHONE_STAGES.map((stage) => ({ stage, entries: stage === 'needsYou' ? [] : all.filter(({ item }) => stageOf(item) === stage) }));
  const count = (s: PhoneStage) => (s === 'needsYou' ? entries.length : staged.find((g) => g.stage === s)!.entries.length);
  const groups = PHONE_STAGES.filter((s) => count(s) > 0);
  const shownGroups = groups.filter((s) => !hidden.includes(s));
  const parked = all.filter(({ item }) => inParkingLot(item) && !item.archivedAt);
  const queuedOn = ordered.filter((c) => snaps[c.id]!.items.some((i) => i.queue && !i.archivedAt));
  const queued = ordered.reduce((n, c) => n + snaps[c.id]!.items.filter((i) => i.queue && !i.archivedAt).length, 0);
  // nothing known yet (the server has not answered since the page loaded): no claim that there is nothing
  const known = ordered.length > 0;
  return (
    <HoldToTalk.Provider value={press}>
      {feeds}
      <div id="ph-home" className={pageClass} ref={homeRef}>
        <header className={`${pageBarClass} ph-home ph-landscape:static`}>
          <Sign size={26} />
          <span className={`${wordClass} text-[22px] ph-landscape:text-[19px]`}>Seismic</span>
          {usage.length > 0 && (
            <span className="ml-auto flex min-w-0 items-center gap-1.5">
              {usage.map((u) => (
                <UsagePill key={u.harness} usage={u} phone compact={usage.length > 1} />
              ))}
            </span>
          )}
        </header>
        {banner}
        <Notify />
        <AgentsTabs tab={tab} onTab={setTab} queued={queued} parked={parked.length}>
        {!known ? null : tab === 'all' ? (
          <>
            <StageChips stages={PHONE_STAGES} count={count} hidden={hidden} onHidden={setHidden} onlyFull />
            {!groups.length ? (
              <p className={phoneNoneClass}>{t.agents.none}</p>
            ) : !shownGroups.length ? (
              <p className={phoneNoneClass}>{t.agents.allHidden}</p>
            ) : (
              shownGroups.map((s) => (
                <section key={s} className={`${sectionClass} ph-stage stage-${s}`}>
                  {/* the stage's count beside its heading, trimmed to its capitals so it centres on what the eye sees */}
                  <h2 className={sectionHeadClass}>
                    {t.agents.stages[s]} <Badge variant="count" className="rounded-lg bg-chip px-2 py-1.5 text-[13px] font-semibold text-muted-foreground [text-box:trim-both_cap_alphabetic]">{count(s)}</Badge>
                  </h2>
                  {s === 'needsYou' ? (
                    <InboxList
                      entries={entries}
                      isRead={inboxRead.isRead}
                      onRead={inboxRead.markRead}
                      onGo={(e) => {
                        if (e.card) return openCard(e.card);
                        setObeyaProject(e.project);
                        openTalk();
                      }}
                      onProposalCard={(_project, i) => openCard(i)}
                      onReply={(c, i, r) =>
                        sendReply(c, i, r, {
                          mark: (id, what) => setUnderway((u) => (what === null ? u.filter((x) => x !== id) : [...u.filter((x) => x !== id), id])),
                          showAck,
                        })
                      }
                    />
                  ) : (
                    // a snoozed card at the end, after those at work now
                    <CardList entries={staged.find((g) => g.stage === s)!.entries.sort((a, b) => Number(!!snoozeOf(a.item)) - Number(!!snoozeOf(b.item)))} several={several} onOpen={openCard} />
                  )}
                </section>
              ))
            )}
          </>
        ) : tab === 'queue' ? (
          queuedOn.length ? (
            queuedOn.map((c) => (
              <section key={c.id} className={`${sectionClass} ph-queue`}>
                {several && <h2 className={sectionHeadClass}>{c.name}</h2>}
                <ProjectQueue items={snaps[c.id]!.items} scroller={homeRef} onOpen={openCard} />
              </section>
            ))
          ) : (
            <p className={phoneNoneClass}>{t.queue.empty}</p>
          )
        ) : tab === 'parked' ? (
          parked.length ? (
            <section className={sectionClass}>
              <CardList entries={parked} several={several} onOpen={openCard} />
            </section>
          ) : (
            <p className={phoneNoneClass}>{t.agents.noneParked}</p>
          )
        ) : (
          <section className={`${sectionClass} ph-activity`}>
            <ActivityTab project={obeyaId} changed={snaps} onGo={(_project, i) => openCard(i)} allProjects />
          </section>
        )}
        </AgentsTabs>
      </div>
      {talk && (
        <TalkPanel
          title={t.koordinator.title}
          head={obeyaSnap && <ChatsHead title={<span className={gripWordClass}>{t.koordinator.title}</span>} project={obeyaId} projectName={obeyaSnap.project.name} chat={obeyaSnap.chat} chats={obeyaSnap.chats} talk={obeyaSnap.talk} onProject={setObeyaProject} />}
          label={t.phone.talkTitle}
          banner={banner}
          onClose={closeTalk}
          leave={leaveTalk}
          onLeave={() => setClosing(true)}
        >
          {obeyaSnap && (
            <div className={talkClass} key={obeyaId}>
              <KoordinatorAgent.Provider value={obeyaSnap.koordinatorAgent}>
              <KoordinatorTalk
                on
                project={obeyaId}
                talk={obeyaSnap.talk}
                chat={obeyaSnap.chat}
                chatModel={obeyaSnap.chatModel}
                chats={obeyaSnap.chats}
                items={obeyaSnap.items}
                repos={obeyaSnap.project.repos}
                onOpen={openCard}
                onTell={(text, images, replyTo, destination) => void tellTyped(text, images, null, undefined, replyTo, destination)}
                draft={obeyaDraft(obeyaId)}
              />
              </KoordinatorAgent.Provider>
            </div>
          )}
        </TalkPanel>
      )}
      <TalkButton label={t.phone.talkTitle} shown={shown} n={unread} count={t.koordinator.unreadCount(unread)} working={ordered.some((c) => obeyaWorks(snaps[c.id]!.talk))} onClick={() => (talk ? leaveTalk.current?.() : openTalkNewest())} />
      {/* right of the microphone, with several projects: whose Seismic the microphone and the panel speak to */}
      {several && (
        <label className={cn(pillVariants(), phoneControl, 'right-[max(14px,env(safe-area-inset-right))] box-border max-w-[calc(50vw-106px)] cursor-pointer gap-1.5 px-3 text-[15px] ph-landscape:top-[52px] ph-landscape:bottom-auto ph-landscape:max-w-[104px]')}>
          <span className="overflow-hidden font-semibold text-ellipsis">{projects.find((c) => c.id === obeyaId)?.name}</span>
          <ChevronDown size={12} strokeWidth={1.75} className="hint" aria-hidden="true" />
          <select className="absolute inset-0 h-full w-full cursor-pointer text-base opacity-0" value={obeyaId} aria-label={t.phone.project} onChange={(e) => setObeyaProject(e.target.value)}>
            {projects.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {acks}
      {/* the list's own: a new card; with Seismic's conversation open, the microphone that speaks to it */}
      {talk ? (
        mic
      ) : (
        <Tooltip content={t.newCard}>
          <button className={newClass} aria-label={t.newCard} disabled={making || !!made} onClick={() => void newCard()}>
            <Plus size={30} strokeWidth={2.25} aria-hidden="true" />
          </button>
        </Tooltip>
      )}
    </HoldToTalk.Provider>
  );
}

/** One project's queue, its rows dragged to their place by their grip, a tap opening the card. */
function ProjectQueue({ items, scroller, onOpen }: { items: Item[]; scroller: React.RefObject<HTMLElement | null>; onOpen: (i: Item) => void }) {
  const q = useQueueSort(items, scroller);
  return <QueueList items={items} q={q} onOpen={onOpen} />;
}

