






import { cn } from 'cn';
import { memo, useEffect, useRef } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/tabs';
import { Badge } from './components/badge';
import { agentsEmptyClass, entryClass, entryListClass, entryOnClass, repliesClass, ttlLinkClass } from './inboxClasses';


const stageHeadClass = 'mt-4 mx-2 mb-2 text-xs font-semibold uppercase tracking-[.04em] text-muted-foreground';
const stageSubheadClass = 'mt-2.5 mx-2 mb-1.5 text-xs font-semibold text-muted-foreground';


type WorkTab = 'work' | 'activity';

/** The desktop's Agent work, docked on the right: "Working" and "Todo" (the queue, then the planned cards), and "Activity". */
export function AgentsSheet({ on, items, open, underway, onOpen, project, changed, onGo }: { on: boolean; items: Item[]; open?: string; underway: (id: string) => boolean; onOpen: (i: Item) => void; project: string; changed: unknown; onGo: (project: string, i: Item) => void }) {
  const [kept, setTab] = useStoredState<WorkTab | null>('seismic-agent-work-tab', null);
  const tab: WorkTab = kept === 'activity' ? kept : 'work';
  const box = useRef<HTMLElement>(null);
  const q = useQueueSort(items, box);
  
  useEffect(() => {
    if (!on || tab !== 'work') q.sort.cancel();
  }, [on, tab]);
  const { working, planned } = agentWork(items, underway);
  const todo = q.queued.length + planned.length;
  const entry = (i: Item) => <AgentEntry key={i.id} item={i} here={i.id === open} underway={underway(i.id)} onOpen={onOpen} />;
  return (
    <Docked id="agents" ref={box} className="pt-5 px-3.5 pb-8" on={on} label={t.agents.work.title}>
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





export const AgentEntry = memo(function AgentEntry({ item: i, els, here, underway, onOpen }: { item: Item; els?: Map<string, HTMLElement>; here: boolean; underway: boolean; onOpen: (i: Item) => void }) {
  const stage = agentStage(i, underway);
  
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
});
