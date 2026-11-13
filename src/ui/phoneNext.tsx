// The phone view for one project at a time (`?view=phone`; the earlier one with four tabs
// is `?view=phone-old`): a slim top bar with Seismic's sign, the project in view and its switcher, and the usage
// pills scrolling under it; a box "N working" with the workstation dots, which unfolds to the cards
// agents are on; the project's other cards in sections (Queued, Planned, then Parked and Done
// folded), twenty at a time; and a floating bar along the foot with Menu, Chat, New card, Search and
// Needs you. Chat opens Seismic's conversation as a full page and Search a page over the project's
// cards (`phoneSearch.tsx`), each without the bar. A card opens full screen with an X at the top and
// no floating bar; its conversation is the panel both phone views share (`phoneShell.tsx`).

import { Bell, ChevronDown, Menu, Plus, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { finishedArchivable, halted, inParkingLot, type Item, needsYou, type ProjectInfo, snoozeOf, type Usage, unreadAnswers } from '../core/types';
import { agentStage, agentWork } from '../core/agents';
import { queueOrder } from '../core/queue';
import { useStoredState } from './stored';
import { Sign } from './logo';
import { Notify } from './notify';
import { failText, t } from './strings';
import { UsagePill } from './usage';
import { obeyaWorks, runs } from './talk';
import { Badge } from './components/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/collapsible';
import { TalkIcon } from './parts';
import { WorkingRows, WorkstationDots } from './workstations';
import { api, ApiError } from './api';
import { needsYouCount } from '../core/inbox';
import { plain } from './markdown';
import { cn } from 'cn';
import { pageBarClass, pageClass, viewClass } from './phoneEnvironment';
import { CardList, sectionClass, usePhoneShell } from './phoneShell';
import { HoldToTalk } from './voice';
import { ChatsHead } from './chats';
import { KoordinatorTalk } from './koordinator';
import { KoordinatorAgent } from './message';
import { obeyaDraft } from './draft';
import { PhoneSearch } from './phoneSearch';
import { gripWordClass, TalkPanel, talkClass } from './phoneTalkPanel';
import { InboxList } from './inbox';
import { sendReply } from './quickReply';
import { PhoneMenu } from './phoneMenu';
import { plannedOrder } from './phoneOrder';

/** The sections of the list, in their order; those folded until the owner unfolds them. */
const SECTIONS = ['queued', 'planned', 'parked', 'done'] as const;
type Section = (typeof SECTIONS)[number];
const FOLDED: Section[] = ['parked', 'done'];
/** How many cards a section shows before "Load more", and how many more each tap brings. */
const PAGE = 20;

export function PhoneNext({ projects: loaded }: { projects: ProjectInfo[] }) {
  const s = usePhoneShell(loaded, { follow: true });
  const { projects, snaps, usage, feeds, banner, open, openCard, obeyaId, setObeyaProject, entries, isUnderway, homeRef, newCard, making, made, press, acks, back, showAck } = s;
  const [menuOpen, setMenuOpen] = useState(false);
  const [needsOn, openNeeds, closeNeeds] = useNeedsPage();
  const [workingOpen, setWorkingOpen] = useStoredState('obeya-phone-working-open', true);
  const [folded, setFolded] = useStoredState<Section[]>('obeya-phone-folded', FOLDED);
  // how many cards each section shows; back to the first twenty with another project
  const [shown, setShown] = useState<{ project: string; n: Partial<Record<Section, number>> }>({ project: obeyaId, n: {} });
  const shownOf = (x: Section) => (shown.project === obeyaId ? shown.n[x] : undefined) ?? PAGE;
  // the search page is a step in the browser's history too, so Back from a card found there returns to it
  const [searching, setSearching] = useState(() => !!(history.state as { search?: boolean } | null)?.search);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const pop = () => setSearching(!!(history.state as { search?: boolean } | null)?.search);
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);
  const openSearch = () => {
    history.pushState({ ...history.state, search: true }, '', location.href);
    setSearching(true);
  };
  const closeSearch = () => {
    if ((history.state as { search?: boolean } | null)?.search) history.back();
    else setSearching(false);
  };

  // an open card goes right up to the bottom of the top bar, which stays, with the X in place of the usage pills
  if (open)
    return s.cardScreen(
      null,
      <div className={cn(viewClass, 'inset-x-0 top-0 z-30')} ref={measureTop}>
        <TopBar projects={projects} project={obeyaId} usage={usage} onClose={() => leaveCard(back, needsOn, closeNeeds)} />
      </div>,
    );


  const snap = snaps[obeyaId];
  const project = projects.find((c) => c.id === obeyaId)!;
  const items = snap?.items ?? [];
  const entriesOf = (i: Item) => ({ item: i, project });
  // what needs the owner waits under the bell, not in the list
  const inInbox = new Set(entries.flatMap((e) => (e.card ? [e.card.id] : [])));
  const listed = (i: Item) => !inInbox.has(i.id) && !i.archivedAt;
  // the cards agents are on; one whose agent is paused or snoozed stands in the box after them, but no agent works on it
  const onIt = [...agentWork(items, isUnderway).working, ...items.filter((i) => i.kind !== 'task' && !i.queue && !needsYou(i) && !i.archivedAt && runs(i))].filter(listed);
  const idle = (i: Item) => halted(i) || !!snoozeOf(i);
  const working = [...onIt.filter((i) => !idle(i)), ...onIt.filter(idle)];
  const atWork = onIt.filter((i) => !idle(i)).length;
  /** Gives a card its workstation back during the undo window after it was taken, with what came of it, as the status bar does. */
  const keepWorkstation = async (i: Item) => {
    try {
      await api.act(i.id, { action: 'keepWorkstation' });
      showAck(t.workstations.keptBack(plain(i.title)));
    } catch (e) {
      showAck(e instanceof ApiError && e.code === 'notEvictable' ? t.voice.tooLate : failText(e));
    }
  };
  const sections: Record<Section, Item[]> = {
    queued: queueOrder(items).filter(listed),
    planned: items.filter((i) => listed(i) && agentStage(i, isUnderway(i.id)) === 'planned').sort(plannedOrder),
    parked: items.filter((i) => listed(i) && inParkingLot(i)),
    done: items.filter((i) => listed(i) && !inParkingLot(i) && !agentStage(i, isUnderway(i.id)) && finishedArchivable(i) && !needsYou(i) && !snoozeOf(i)?.waiting && !runs(i) && !isUnderway(i.id)),
  };
  const full = SECTIONS.filter((x) => sections[x].length);
  const fold = (x: Section, open: boolean) => setFolded(open ? folded.filter((f) => f !== x) : [...folded, x]);

  return (
    <HoldToTalk.Provider value={press}>
      {feeds}
      <div id="ph-home" className={pageClass} ref={homeRef} inert={needsOn}>
        <TopBar projects={projects} project={obeyaId} onProject={setObeyaProject} usage={usage} onMenu={() => setMenuOpen(true)} />
        {banner}
        <Notify />
        {snap && (
          <>
            <WorkingBox
              open={workingOpen}
              onOpen={setWorkingOpen}
              cards={working}
              atWork={atWork}
              onKeep={(i) => void keepWorkstation(i)}
              snap={snap}
              projects={projects}
              onCard={openCard}
              onElsewhere={(c, card) => {
                setObeyaProject(c);
                s.openId(card);
              }}
            />
            {!full.length && <p className="hint mt-6 text-center">{t.phone.next.none}</p>}
            {full.map((x) => {
              const cards = sections[x];
              const n = shownOf(x);
              return (
                <Collapsible key={x} open={!folded.includes(x)} onOpenChange={(o) => fold(x, o)} className={cn(sectionClass, `ph-next-${x}`)}>
                  <CollapsibleTrigger className="group mb-2 flex w-full items-center gap-2.5 py-1">
                    <span className="text-[21px] leading-[1.15] font-semibold">{t.phone.next.sections[x]}</span>
                    <Badge variant="count" className="rounded-lg bg-muted px-2 py-1.5 text-[13px] font-semibold text-muted-foreground [text-box:trim-both_cap_alphabetic]">
                      {cards.length}
                    </Badge>
                    <ChevronDown size={18} strokeWidth={2} className="ml-auto text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" aria-hidden="true" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardList entries={cards.slice(0, n).map(entriesOf)} several={false} onOpen={openCard} />
                    {cards.length > n && (
                      <button
                        className="mt-3 w-full rounded-[10px] border border-border bg-transparent py-2.5 text-[15px] text-foreground cursor-pointer"
                        onClick={() => setShown({ project: obeyaId, n: { ...(shown.project === obeyaId ? shown.n : {}), [x]: n + PAGE } })}
                      >
                        {t.phone.next.loadMore(cards.length - n)}
                      </button>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </>
        )}
      </div>
      {needsOn && !searching && (
        <div id="ph-needs" className={cn(pageClass, 'z-20 bg-background')}>
          <header className={cn(pageBarClass, 'gap-2')}>
            <button className="-ml-1 inline-grid size-10 shrink-0 place-items-center rounded-full border-0 bg-transparent p-0" aria-label={t.phone.next.menu} onClick={() => setMenuOpen(true)}>
              <Sign size={26} />
            </button>
            <h1 className="m-0 min-w-0 flex-1 overflow-hidden text-[19px] font-semibold text-ellipsis whitespace-nowrap">{t.phone.next.needsYou}</h1>
            <button className="ph-close inline-grid size-10 shrink-0 place-items-center rounded-full border-0 bg-muted text-foreground cursor-pointer ph-landscape:size-9" aria-label={t.phone.next.closeNeedsYou} onClick={closeNeeds}>
              <X size={20} strokeWidth={2.25} aria-hidden="true" />
            </button>
          </header>
          {banner}
          {/* every project's entries, each naming its project; Seismic's own entries bring its project into view */}
          <div className="mt-3">
            <InboxList
              entries={entries}
              isRead={s.inboxRead.isRead}
              onRead={s.inboxRead.markRead}
              onGo={(e) => {
                if (e.card) return openCard(e.card);
                // Seismic's own entry: its chat page opens over this one, in its project; Back returns here
                setObeyaProject(e.project);
                s.openTalk();
              }}
              onProposalCard={(_project, i) => openCard(i)}
              onReply={(c, i, r) =>
                sendReply(c, i, r, {
                  mark: (id, what) => s.setUnderway((u) => (what === null ? u.filter((x) => x !== id) : [...u.filter((x) => x !== id), id])),
                  showAck,
                })
              }
            />
          </div>
        </div>
      )}
      {acks}
      <PhoneMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        projects={projects}
        project={obeyaId}
        needsYou={needsYouCount(entries)}
        onProject={(id) => {
          setObeyaProject(id);
          closeNeeds();
          setMenuOpen(false);
        }}
        onNeedsYou={() => {
          setMenuOpen(false);
          openNeeds();
        }}
      />
      {searching && <PhoneSearch items={items.filter((i) => !i.archivedAt)} query={query} onQuery={setQuery} onOpen={openCard} onClose={closeSearch} />}
      {s.talk && (
        <TalkPanel
          page
          title={t.koordinator.title}
          head={snap && <ChatsHead title={<span className={gripWordClass}>{t.koordinator.title}</span>} project={obeyaId} projectName={snap.project.name} chat={snap.chat} chats={snap.chats} talk={snap.talk} onProject={setObeyaProject} onClose={s.closeTalk} />}
          label={t.phone.talkTitle}
          banner={banner}
          onClose={s.closeTalk}
          leave={s.leaveTalk}
          onLeave={() => s.setClosing(true)}
        >
          {snap && (
            <div className={talkClass} key={obeyaId}>
              <KoordinatorAgent.Provider value={snap.koordinatorAgent}>
                <KoordinatorTalk
                  on
                  project={obeyaId}
                  talk={snap.talk}
                  chat={snap.chat}
                  chatModel={snap.chatModel}
                  chats={snap.chats}
                  items={snap.items}
                  repos={snap.project.repos}
                  onOpen={openCard}
                  onTell={s.tellChat}
                  draft={obeyaDraft(obeyaId)}
                />
              </KoordinatorAgent.Provider>
            </div>
          )}
        </TalkPanel>
      )}
      {s.talk && s.mic}
      {!s.talk && !searching && !needsOn && (
        <FloatingBar
          needsYou={needsYouCount(entries)}
          making={making || !!made}
          chat={snap ? unreadAnswers(snap.talk) : 0}
          chatWorking={!!snap && obeyaWorks(snap.talk)}
          onNew={() => void newCard()}
          onChat={s.openTalk}
          onSearch={openSearch}
          onMenu={() => setMenuOpen(true)}
          onNeedsYou={openNeeds}
        />
      )}
    </HoldToTalk.Provider>
  );
}

/**
 * The top bar: Seismic's sign (the menu), the project in view with the phone's own picker
 * to switch it (`onProject`), and at the right the usage pills, or over an open card its X (`onClose`).
 */
function TopBar({ projects, project, onProject, usage, onClose, onMenu }: { projects: ProjectInfo[]; project: string; onProject?: (id: string) => void; usage: Usage[]; onClose?: () => void; onMenu?: () => void }) {
  const name = projects.find((c) => c.id === project)?.name;
  return (
    <header className={cn(pageBarClass, 'gap-2', onClose ? 'ph-card-top' : 'ph-home ph-landscape:static')}>
      {/* the sign opens the menu */}
      <button className="-ml-1 inline-grid size-10 shrink-0 place-items-center rounded-full border-0 bg-transparent p-0 disabled:cursor-default" aria-label={t.phone.next.menu} disabled={!onMenu} onClick={onMenu}>
        <Sign size={26} />
      </button>
      {/* the project in view; the phone's own picker switches it, remembered in this browser */}
      <label className="relative z-1 flex min-w-0 shrink items-center gap-1 rounded-[6px] py-1 pr-1 cursor-pointer bg-background">
        <span className="overflow-hidden text-[19px] font-semibold text-ellipsis whitespace-nowrap">{name}</span>
        {onProject && projects.length > 1 && <ChevronDown size={16} strokeWidth={2} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
        {onProject && projects.length > 1 && (
          <select className="absolute inset-0 h-full w-full cursor-pointer text-base opacity-0" value={project} aria-label={t.phone.next.switchProject} onChange={(e) => onProject(e.target.value)}>
            {projects.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </label>
      {/* the usage pills at the right, scrolling sideways and fading out under the project's name
          (right to left, so they start at the right end; the pills inside read left to right) */}
      {onClose ? (
        <button className="ph-close ml-auto inline-grid size-10 shrink-0 place-items-center rounded-full border-0 bg-muted text-foreground cursor-pointer ph-landscape:size-9" aria-label={t.phone.next.close} onClick={onClose}>
          <X size={20} strokeWidth={2.25} aria-hidden="true" />
        </button>
      ) : usage.length > 0 && (
        <div className="min-w-0 flex-1 overflow-x-auto [direction:rtl] [scrollbar-width:none] [mask-image:linear-gradient(to_right,transparent,black_18px)] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max items-center gap-1.5 pl-[18px] [direction:ltr]">
            {usage.map((u) => (
              <UsagePill key={u.harness} usage={u} phone compact={usage.length > 1} />
            ))}
          </div>
        </div>
      )}
    </header>
  );
}

/**
 * The X of an open card: back to its project's list. A card opened from the Needs you page has that
 * page's step before it, which browser Back returns to; the X goes on past it (`closeNeeds`) once the
 * card's own steps are undone, so the list shows and not Needs you again.
 */
function leaveCard(back: () => void, needsOn: boolean, closeNeeds: () => void) {
  if (!needsOn) return back();
  // the steps the page pushed (the card, its conversation) are traversed, which ends in a popstate; a card
  // the address named on loading is left without one
  const steps = (history.state as { steps?: string[] } | null)?.steps ?? [];
  if (steps.at(-1) === 'card' || steps.at(-1) === 'talk') addEventListener('popstate', () => closeNeeds(), { once: true });
  back();
  if (!(steps.at(-1) === 'card' || steps.at(-1) === 'talk')) closeNeeds();
}

/** The fixed top bar's height for the open card below it (`--ph-top`), while it stands. */
function measureTop(el: HTMLElement | null) {
  if (!el) return;
  const root = document.documentElement.style;
  const size = new ResizeObserver(() => root.setProperty('--ph-top', `${el.getBoundingClientRect().height}px`));
  size.observe(el);
  return () => {
    size.disconnect();
    root.removeProperty('--ph-top');
  };
}

/**
 * "● ● ○ ○ 4 working": the workstation dots of the desktop's status bar and how many cards agents
 * are on; unfolded, a line per card as the status bar's workstation list has it, a tap opening it.
 */
function WorkingBox({ open, onOpen, cards, atWork, snap, projects, onCard, onElsewhere, onKeep }: {
  open: boolean;
  onOpen: (open: boolean) => void;
  /** The cards agents are on, those whose agent is paused or snoozed last; `atWork` of them have an agent at work. */
  cards: Item[];
  atWork: number;
  onKeep: (i: Item) => void;
  snap: NonNullable<ReturnType<typeof usePhoneShell>['snaps'][string]>;
  projects: ProjectInfo[];
  onCard: (i: Item) => void;
  onElsewhere: (project: string, card: string) => void;
}) {
  const pools = snap.workstations ?? [];
  const head = (
    <>
      <WorkstationDots pools={pools} items={snap.items} underway={{}} />
      <span className="shrink-0 font-semibold whitespace-nowrap">{t.phone.next.working(atWork)}</span>
    </>
  );
  if (!cards.length) return <div className="ph-working mt-3 flex min-h-12 items-center gap-2.5 rounded-[12px] bg-muted px-3.5 py-2 text-[15px]">{head}</div>;
  return (
    <Collapsible open={open} onOpenChange={onOpen} className="ph-working mt-3 rounded-[12px] bg-muted">
      <CollapsibleTrigger className="group flex min-h-12 w-full items-center gap-2.5 px-3.5 py-2 text-[15px]" aria-label={`${t.phone.next.working(atWork)}: ${open ? t.phone.next.hideWorking : t.phone.next.showWorking}`}>
        {head}
        <ChevronDown size={18} strokeWidth={2} className="ml-auto shrink-0 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3.5 pb-2.5 text-[14px]">
        <WorkingRows
          cards={cards}
          pools={pools}
          items={snap.items}
          underway={{}}
          projects={projects}
          onOpen={onCard}
          onElsewhere={onElsewhere}
          onKeep={onKeep}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A button of the floating bar, a finger's size. */
const barButton = 'relative inline-grid size-11 place-items-center rounded-full border-0 bg-transparent p-0 text-foreground cursor-pointer disabled:cursor-default disabled:text-muted-foreground [&_svg]:size-[22px]';

/**
 * The floating bar along the foot: a glass pill with Menu, Chat, New card (larger, standing out of
 * the bar above and below without making it taller), Search
 * and Needs you, whose bell counts what waits across every project. Hidden while the keyboard is up;
 * with the phone turned it stands upright in the microphone's strip at the right.
 */
function FloatingBar({ needsYou, making, chat, chatWorking, onNew, onChat, onSearch, onMenu, onNeedsYou }: { needsYou: number; making: boolean; chat: number; chatWorking: boolean; onNew: () => void; onChat: () => void; onSearch: () => void; onMenu: () => void; onNeedsYou: () => void }) {
  return (
    <nav
      className="ph-float fixed z-50 left-1/2 bottom-[calc(14px+env(safe-area-inset-bottom))] -translate-x-1/2 flex items-center gap-1 rounded-full bg-glass px-2 py-1 shadow-lift backdrop-blur-xl [.ph-kb_.ph-view~&]:hidden ph-landscape:left-auto ph-landscape:right-[calc(10px+env(safe-area-inset-right))] ph-landscape:top-1/2 ph-landscape:bottom-auto ph-landscape:-translate-y-1/2 ph-landscape:translate-x-0 ph-landscape:flex-col ph-landscape:px-1 ph-landscape:py-2"
      aria-label={t.phone.next.menu}
    >
      <button className={barButton} aria-label={t.phone.next.menu} onClick={onMenu}>
        <Menu aria-hidden="true" />
      </button>
      <button className={cn(barButton, chatWorking && "after:absolute after:inset-x-2.5 after:bottom-1 after:h-0.5 after:animate-[draw_1.6s_cubic-bezier(.5,0,.3,1)_infinite] after:content-[''] after:[background:linear-gradient(90deg,var(--working)_0_50%,transparent_50%)_0_0/200%_100%_no-repeat,--alpha(var(--working)/22%)]")} aria-label={t.phone.next.chat} title={chat ? t.koordinator.unreadCount(chat) : undefined} onClick={onChat}>
        <TalkIcon />
        {chat > 0 && (
          <Badge variant="count" tone="waiting" className="absolute top-0.5 right-0.5">
            {chat}
          </Badge>
        )}
      </button>
      <button
        className="ph-new mx-1.5 -my-4 ph-landscape:-mx-4 ph-landscape:my-1.5 inline-grid size-[60px] place-items-center rounded-full border-0 bg-foreground p-0 text-background shadow-lift cursor-pointer [-webkit-touch-callout:none] select-none active:translate-y-px disabled:opacity-60 disabled:cursor-default"
        aria-label={t.newCard}
        disabled={making}
        onClick={onNew}
      >
        <Plus size={28} strokeWidth={2.25} aria-hidden="true" />
      </button>
      <button className={barButton} aria-label={t.phone.next.search} onClick={onSearch}>
        <Search aria-hidden="true" />
      </button>
      <button className={barButton} aria-label={needsYou ? `${t.phone.next.needsYou}: ${t.phone.next.needsYouCount(needsYou)}` : t.phone.next.needsYou} onClick={onNeedsYou}>
        <Bell aria-hidden="true" />
        {needsYou > 0 && (
          <Badge variant="count" tone="waiting" className="absolute top-0.5 right-0.5">
            {needsYou}
          </Badge>
        )}
      </button>
    </nav>
  );
}

/**
 * Whether the Needs you page is open, kept in the address (`?needs`) so Back and a reload hold it;
 * opening is a step in the browser's history, closing takes it back (or drops it from the address
 * where the page was loaded on it).
 */
function useNeedsPage(): [boolean, () => void, () => void] {
  const [on, setOn] = useState(() => new URLSearchParams(location.search).has('needs'));
  useEffect(() => {
    const pop = () => setOn(new URLSearchParams(location.search).has('needs'));
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);
  const address = (needs: boolean) => {
    const q = new URLSearchParams(location.search);
    if (needs) q.set('needs', '');
    else q.delete('needs');
    const text = q.toString().replace(/=(&|$)/g, '$1');
    return `${location.pathname}${text ? `?${text}` : ''}`;
  };
  return [
    on,
    () => {
      if (on) return;
      history.pushState({ ...history.state, needs: true }, '', address(true));
      setOn(true);
    },
    () => {
      if (!on) return;
      if ((history.state as { needs?: boolean } | null)?.needs) history.back();
      else history.replaceState(history.state, '', address(false));
      setOn(false);
    },
  ];
}
