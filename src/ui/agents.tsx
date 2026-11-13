// Agent work: slides out from the floating row's robot button, which counts the queued cards in grey.
// Its first tab holds "Working" (the cards at work, src/core/agents.ts) and "Todo": the cards waiting
// to start in turn, dragged to their place as on a waiting card (src/ui/queue.tsx), then the planned
// ones; each card a pane like an inbox entry (its face at size S), whose title or "Go to card" opens
// it. Cards that need the owner are in "Needs you" instead (src/ui/needsYou.tsx), the parked ones in
// the Parked view (src/ui/views.tsx). "Activity" is the log of what happened on the cards (src/ui/activity.tsx).
// The phone keeps its own lists with the tabs and stage chips below.

import { cn } from 'cn';
import { type ReactNode, useEffect, useRef } from 'react';
import { agentStage, agentWork } from '../core/agents';
import { waitsFor } from '../core/inbox';
import type { Item } from '../core/types';
import { ActivityTab } from './activity';
import { CardFace, shownTitle } from './card';
import { Docked, sheetTitleClass } from './docked';
import { Inline, plain } from './markdown';
import { QueueList, useQueueSort } from './queue';
import { useStoredState } from './stored';
import { t } from './strings';
import { Button } from './components/button';
import { ToggleGroup, ToggleGroupItem } from './components/segmented';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/tabs';
import { Badge } from './components/badge';
import { agentsEmptyClass, entryClass, entryListClass, entryOnClass, repliesClass, ttlLinkClass } from './inboxClasses';

/** The phone's tabs across the screen, sized for a finger (`#ph-home`: only the phone shows these tabs). */
const phoneTabClass = '[#ph-home_&]:flex-1 [#ph-home_&]:inline-flex [#ph-home_&]:items-center [#ph-home_&]:justify-center [#ph-home_&]:min-h-10 [#ph-home_&]:py-0 [#ph-home_&]:px-1 [#ph-home_&]:text-[15px]';

/** A stage's heading in Agent work, and the smaller one of a part of it. */
const stageHeadClass = 'mt-[18px] mx-2 mb-2 text-[12px] font-semibold uppercase tracking-[.04em] text-muted-foreground';
const stageSubheadClass = 'mt-2.5 mx-2 mb-1.5 text-[12px] font-semibold text-muted-foreground';

export type AgentsTab = 'queue' | 'all' | 'parked' | 'activity';
type Tab = AgentsTab;

/** The tab chosen last in this browser, the desktop's sheet and the phone's list alike; `first` until one was chosen. */
export function useAgentsTab(first: Tab): [Tab, (t: Tab) => void] {
  const [kept, setTab] = useStoredState<Tab | null>('obeya-agents-tab', null);
  const tab: Tab = kept === 'queue' || kept === 'parked' || kept === 'activity' || kept === 'all' ? kept : first;
  return [tab, setTab];
}

/** The switch between the four tabs, the queue's count on "Queue" and the parked cards' on "Parked"; `children` is the panel of the tab shown. */
export function AgentsTabs({ tab, onTab, queued, parked, children }: { tab: Tab; onTab: (t: Tab) => void; queued: number; parked: number; children?: ReactNode }) {
  return (
    <Tabs value={tab} onValueChange={(k) => onTab(k as Tab)}>
      <TabsList variant="segmented" className="agents-tabs [#ph-home_&]:flex [#ph-home_&]:w-full [#ph-home_&]:mt-3.5" aria-label={t.agents.title}>
        {(['queue', 'all', 'parked', 'activity'] as const).map((k) => (
          <TabsTrigger key={k} value={k} className={phoneTabClass}>
            {t.agents.tabs[k]}
            {k === 'queue' && queued > 0 && <Badge variant="count" className="ml-1.5">{queued}</Badge>}
            {k === 'parked' && parked > 0 && <span className="count ml-1.5 font-semibold text-[12px] text-muted-foreground">{parked}</span>}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={tab}>
        {children}
      </TabsContent>
    </Tabs>
  );
}

/**
 * The chips above "All": one per stage with its count, tinted while its group shows; a tap shows or
 * hides the group. With `onlyFull` (the phone, where the row has room for few) a stage without cards has none.
 */
/** The colour a stage chip tints with while its group shows. */
const STAGE_TINT: Record<string, string> = {
  needsYou: 'c-waiting',
  reviewing: 'c-reviewing',
  landing: 'c-approved',
  planned: 'c-planned',
  done: 'c-approved',
};

export function StageChips<S extends string>({ stages, count, hidden, onHidden, onlyFull }: { stages: readonly S[]; count: (s: S) => number; hidden: S[]; onHidden: (h: S[]) => void; onlyFull?: boolean }) {
  return (
    // on the phone in one row that scrolls sideways, sized for a finger
    <ToggleGroup
      type="multiple"
      variant="chips"
      className="agents-filter mt-3 mx-2 mb-0 [#ph-home_&]:flex-nowrap [#ph-home_&]:overflow-x-auto [#ph-home_&]:-mx-3.5 [#ph-home_&]:pt-0 [#ph-home_&]:px-3.5 [#ph-home_&]:pb-0.5 [#ph-home_&]:[scrollbar-width:none] [#ph-home_&]:[&::-webkit-scrollbar]:hidden"
      aria-label={t.agents.filter} value={stages.filter((s) => !hidden.includes(s))} onValueChange={(shown) => onHidden(stages.filter((s) => !shown.includes(s)))}>
      {stages.filter((s) => !onlyFull || count(s) > 0).map((s) => (
        <ToggleGroupItem key={s} value={s} className={cn(STAGE_TINT[s], !count(s) && 'opacity-55', '[#ph-home_&]:flex-none [#ph-home_&]:min-h-9 [#ph-home_&]:py-0 [#ph-home_&]:px-3.5 [#ph-home_&]:text-[14px]')}>
          {(t.agents.stages as Record<string, string>)[s]} <span className="text-[11.5px] font-bold [#ph-home_&]:text-[13px]">{count(s)}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** The desktop's Agent work tabs: the cards at work and to do, and the log. */
type WorkTab = 'work' | 'activity';

/** The desktop's Agent work, docked on the right: "Working" and "Todo" (the queue, then the planned cards), and "Activity". */
export function AgentsSheet({ on, items, open, underway, onOpen, project, changed, onGo }: { on: boolean; items: Item[]; open?: string; underway: (id: string) => boolean; onOpen: (i: Item) => void; project: string; changed: unknown; onGo: (project: string, i: Item) => void }) {
  const [kept, setTab] = useStoredState<WorkTab | null>('obeya-agent-work-tab', null);
  const tab: WorkTab = kept === 'activity' ? kept : 'work';
  const box = useRef<HTMLElement>(null);
  const q = useQueueSort(items, box);
  // the sheet closed or the tab changed under a drag: the row is not dropped anywhere
  useEffect(() => {
    if (!on || tab !== 'work') q.sort.cancel();
  }, [on, tab]);
  const { working, planned } = agentWork(items, underway);
  const todo = q.queued.length + planned.length;
  const entry = (i: Item) => <AgentEntry key={i.id} item={i} here={i.id === open} underway={underway(i.id)} onOpen={onOpen} />;
  return (
    <Docked id="agents" ref={box} className="pt-5 px-3.5 pb-[30px]" on={on} label={t.agents.work.title}>
      <h2 className={`${sheetTitleClass} px-2`}>{t.agents.work.title}</h2>
      <Tabs value={tab} onValueChange={(k) => setTab(k as WorkTab)}>
        <TabsList variant="segmented" className="agents-tabs mt-0 mx-2 mb-1" aria-label={t.agents.work.title}>
          {(['work', 'activity'] as const).map((k) => (
            <TabsTrigger key={k} value={k}>
              {t.agents.work.tabs[k]}
            </TabsTrigger>
          ))}
        </TabsList>
      <TabsContent value={tab}>
      {tab === 'activity' ? (
        <ActivityTab project={project} changed={changed} open={open} onGo={onGo} />
      ) : (
        <>
          <section className="agents-stage">
            <h3 className={stageHeadClass}>
              {t.agents.work.working} <span className="count font-normal">{working.length}</span>
            </h3>
            {working.length ? <ul className={entryListClass}>{working.map(entry)}</ul> : <p className={agentsEmptyClass}>{t.agents.work.noneWorking}</p>}
          </section>
          <section className="agents-stage">
            <h3 className={stageHeadClass}>
              {t.agents.work.todo} <span className="count font-normal">{todo}</span>
            </h3>
            {!todo && <p className={agentsEmptyClass}>{t.agents.work.noneTodo}</p>}
            {q.queued.length > 0 && (
              <>
                <h4 className={stageSubheadClass}>
                  {t.agents.work.queued} <Badge variant="count" className="ml-1">{q.queued.length}</Badge>
                </h4>
                <QueueList items={items} q={q} onOpen={onOpen} />
              </>
            )}
            {planned.length > 0 && (
              <>
                {q.queued.length > 0 && <h4 className={stageSubheadClass}>{t.agents.stages.planned}</h4>}
                <ul className={entryListClass}>{planned.map(entry)}</ul>
              </>
            )}
          </section>
        </>
      )}
      </TabsContent>
      </Tabs>
    </Docked>
  );
}

/** A card, as the inbox shows an entry: its face at size S, with what it waits for where it needs the owner, and "Go to card". With `els`, a card opened from it unfolds from it. */
export function AgentEntry({ item: i, els, here, underway, onOpen }: { item: Item; els?: Map<string, HTMLElement>; here: boolean; underway: boolean; onOpen: (i: Item) => void }) {
  const stage = agentStage(i, underway);
  // what it waits for where it needs the owner, as its inbox entry says; else the line its card shows under its title
  const waits = stage === 'needsYou' ? waitsFor(i) : undefined;
  return (
    <li ref={els ? (el) => void (el ? els.set(i.id, el) : els.delete(i.id)) : undefined} className={cn(entryClass, 'agent-entry', `stage-${stage ?? 'parked'}`, here && entryOnClass)} aria-current={here || undefined}>
      <CardFace
        item={i}
        size="s"
        title={
          <button type="button" className={ttlLinkClass} onClick={() => onOpen(i)}>
            {i.title ? plain(i.title) : shownTitle(i)}
          </button>
        }
        text={waits && <Inline md={waits} />}
      >
        <div className={repliesClass}>
          <Button type="button" onClick={() => onOpen(i)}>
            {t.inbox.goToCard}
          </Button>
        </div>
      </CardFace>
    </li>
  );
}
