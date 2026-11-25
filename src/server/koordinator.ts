import { normalize, overlaps } from '../core/path-overlap';




import { judgeCardLabels } from './llms/agents/agentJobs/judgeCardLabels';
import { nameCard } from './llms/agents/agentJobs/nameCard';
import { learnRuleFromInput, type InputContext, type OwnerInput } from './llms/agents/agentJobs/learnRuleFromInput';
import { readPlanDependencies } from './llms/agents/agentJobs/readPlanDependencies';
import { proposeRulesFromHistory } from './llms/agents/agentJobs/proposeRulesFromHistory';
import { CardTags } from './llms/agents/agentJobs/cardTags';
import { type Scope, estimateCardScope } from './llms/agents/agentJobs/estimateCardScope';
import { type Planned, scheduleCardBatch } from './llms/agents/agentJobs/scheduleCardBatch';
import { randomUUID } from 'node:crypto';
import type { RepoAdapter } from '../adapters/types';
import { drawnWaits, inQueue, movable, notStarted, queueOrder, reach, waitsOn } from '../core/queue';
import { type CardEvent, EVICT_HOLD_MS, finished, inParkingLot, mergeRank, type Item, nameless, START_ALL_HOLD_MS, type Wait, snoozeOf } from '../core/types';
import { ACTIVE, BadRequest, type Board, contributionOf } from './board';
import type { Utterance } from './store';
import { type AgentRuntime, waitQuietly } from './runtime';
import type { WorkerSupervisor } from './workerSupervisor/workerSupervisor';
import { type CardWorkstations, type Change, RECHECK_MS, shortageOf } from './workstations';
import { LANGUAGE_NAMES } from '../core/locale';
import { clip, messageOf } from '../core/text';
import { type Label, type Labels, suggestable, type SuggestToggles } from '../core/labels';


export type { InputContext, OwnerInput } from './llms/agents/agentJobs/learnRuleFromInput';
export type { Scope } from './llms/agents/agentJobs/estimateCardScope';


export interface RepoHands {
  workers: WorkerSupervisor;
  workstations: CardWorkstations;
  adapter: RepoAdapter;
  
  path: string;
  
  folder?: boolean;
}

export interface KoordinatorOptions {
  board: Board;
  runtime: AgentRuntime;
  
  repoFor: (card: Item) => RepoHands;
  
  home: () => string;
  
  paused?: () => boolean;
  
  restarting?: () => boolean;
  
  holdMs?: number;
  
  reviewEvery?: number;
  
  imageFiles?: (ids?: string[]) => string[];
  
  suggests?: () => Partial<SuggestToggles>;
  
  suggestsMerges?: () => boolean;
}

export class Koordinator {
  /** The language its agents write the owner in: the owner's conversation language, since no words of the owner's go to them. */
  private get language() {
    return LANGUAGE_NAMES[this.o.board.conversation()];
  }

  /** A saved language rule also governs the Koordinator's short, owner-facing jobs. */
  private get spokenLanguage(): string {
    return `${this.language} unless an explicit standing preference names another language`;
  }

  
  private chain: Promise<unknown> = Promise.resolve();
  
  private deciding = 0;
  private learning: Promise<unknown> = Promise.resolve();
  private draining = false;
  
  private recheck?: ReturnType<typeof setTimeout>;
  
  private naming = new Map<string, Promise<void>>();
  
  private labelled = new Set<string>();

  
  private readingDeps = new Map<string, Promise<void>>();

  
  private evictions = new Map<string, ReturnType<typeof setTimeout>>();
  
  private giving = new Set<string>();

  constructor(private o: KoordinatorOptions) {
    o.board.onChange(() => {
      this.scheduleDrain();
      this.readPendingDeps();
    });
  }

  /** After a restart: decide again on cards the Koordinator was checking, and start what is free. */
  resume() {
    const together = new Set<string>();
    for (const i of this.o.board.items()) {
      if (i.state !== 'planned' || !i.queue) continue;
      if ('checking' in i.queue && i.queue.together) together.add(i.queue.together);
      else if ('checking' in i.queue) this.serial(() => this.decide(i.id));
    }
    for (const p of together) this.serial(() => this.decideAll(p));
    this.scheduleDrain();
    this.readPendingDeps();
  }

  /** A restart began, went on or ended: the cards waiting for it are looked at again. */
  restartChanged() {
    this.scheduleDrain();
  }

  shutdown() {
    clearTimeout(this.recheck);
    for (const t of this.evictions.values()) clearTimeout(t);
  }

  /**
   * The owner takes the card's clone from it for the cards waiting for one (the Workstations list):
   * after a few seconds in which `keep` takes that back, its worker stops and the clone is free
   * (`WorkerSupervisor.evict`), for the card that waits longest. A card whose worker was on it waits in the
   * queue behind those waiting already, and goes on on its branch once a workstation is free again; a
   * card stopped before stays planned.
   */
  evict(cardId: string) {
    const card = this.card(cardId);
    if (this.evictions.has(cardId) || !this.o.repoFor(card).workers.evictable(cardId)) throw new BadRequest('notEvictable', 'the card holds no clone that can be taken from it');
    const go = () => {
      this.evictions.delete(cardId);
      const now = this.o.board.item(cardId);
      if (!now) return this.o.board.changed();
      let workers: WorkerSupervisor;
      try {
        workers = this.o.repoFor(now).workers;
        if (!workers.evictable(cardId)) return this.o.board.changed();
      } catch {
        return this.o.board.changed();
      }
      
      
      const active = now.state !== 'planned';
      if (active && !now.queue) {
        this.setQueue(cardId, { workstation: 'none', begun: true });
        this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.koordinator.requeued);
      }
      this.giving.add(cardId);
      workers
        .evict(cardId)
        .catch((e: unknown) => void (this.o.board.item(cardId) && this.o.board.log(cardId, 'error', 'seismic', messageOf(e))))
        .finally(() => {
          this.giving.delete(cardId);
          this.scheduleDrain();
        });
    };
    this.evictions.set(cardId, setTimeout(go, this.o.holdMs ?? EVICT_HOLD_MS));
    this.o.board.changed();
  }

  /** The owner takes back taking the card's workstation while the undo window runs: it keeps it, nothing happened. */
  keep(cardId: string) {
    const t = this.evictions.get(cardId);
    if (!t) throw new BadRequest('notEvictable', 'the card is not giving up its workstation');
    clearTimeout(t);
    this.evictions.delete(cardId);
    this.o.board.changed();
  }

  /** Whether the card's workstation goes to another card once the undo window is through (`evict`). */
  evicting(cardId: string): boolean {
    return this.evictions.has(cardId);
  }

  /** The owner wants the card worked on; a plan, all its planned workstreams. */
  request(cardId: string, setting?: import('../core/types').AgentSetting): void {
    const card = this.card(cardId);
    if (card.repoDown) throw new BadRequest('repoDown', `the repository ${card.repo} of the card does not run on this project`);
    if (card.kind === 'plan') {
      if (setting) throw new BadRequest('invalid', 'choose an agent for an individual task');
      return this.requestAll(card);
    }
    if (card.state !== 'planned') throw new BadRequest('notPlanned', 'only a planned card can be started');
    if (card.queue) throw new BadRequest('queued', 'the card is already with Seismic');
    this.o.board.work(cardId, { agent_setting: setting ? JSON.stringify(setting) : null });
    if (this.o.restarting?.()) {
      this.setQueue(cardId, { restart: true });
      this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.koordinator.restartPending);
      return;
    }
    this.setQueue(cardId, { checking: true });
    this.suggestAtStart(cardId);
    this.serial(() => this.decide(cardId));
  }

  /**
   * A follow-up task a worker made of findings, of a review card's review or of the code review of
   * its own work: it builds on the pull request or the work, so it queues behind that card at once,
   * and once the PR is merged or the work landed starts (or is judged again against the work in
   * progress, as any card whose wait ended). A card already finished leaves nothing to wait for:
   * the task is judged as any card.
   */
  followUp(taskId: string, reviewId: string): void {
    const review = this.o.board.item(reviewId);
    if (!review || !unlanded(review)) return this.request(taskId);
    const t = this.o.board.t.koordinator;
    
    const pr = contributionOf(this.o.board.row(reviewId));
    const reason = pr ? t.followsReview(pr.number) : t.buildsOn;
    this.setQueue(taskId, { behind: [reviewId], reason, buildsOn: [reviewId] });
    this.o.board.log(taskId, 'state', 'seismic', t.waitsFor(this.o.board.t.quote(review.title), reason));
  }

  /**
   * All planned workstreams of the plan go to the Koordinator together (those snoozed to start later too: the owner starts them now): one turn sees them all
   * with the plan doc and decides which start now and which wait, for a dependency or a likely
   * conflict, and in which order. They queue in the plan's order until it has, and the turn waits a
   * few seconds, so the owner can take the start back (`dequeue` on the plan).
   */
  private requestAll(plan: Item): void {
    const open = this.o.board.items().filter((i) => i.parent === plan.id && i.state === 'planned' && !i.queue);
    if (!open.length) throw new BadRequest('nothingToStart', 'the plan has no planned workstream left to start');
    
    for (const w of open) if (snoozeOf(w)?.start) this.o.board.unsnooze(w.id, 'owner');
    if (this.o.restarting?.()) {
      for (const w of open) {
        this.o.board.work(w.id, { agent_setting: null });
        this.setQueue(w.id, { restart: true });
        this.o.board.log(w.id, 'state', 'seismic', this.o.board.t.koordinator.restartPending);
      }
      return;
    }
    const now = Date.now();
    open.forEach((w, n) => this.o.board.work(w.id, { agent_setting: null, queue: JSON.stringify({ checking: true, together: plan.id, since: new Date(now + n).toISOString() }) }));
    this.o.board.log(plan.id, 'state', 'owner', this.o.board.t.koordinator.allStarted(open.map((w) => w.plan?.label ?? w.title).join(', ')));
    setTimeout(() => this.serial(() => this.decideAll(plan.id)), this.o.holdMs ?? START_ALL_HOLD_MS);
  }

  /**
   * The owner wants the plan's workstreams arranged by what builds on what: at once when it has
   * read that for the doc as it stands, else once it has.
   */
  async arrange(planId: string): Promise<void> {
    if (this.o.board.deps(planId).current) return this.o.board.arrange(planId);
    this.o.board.setDeps(planId, { reading: 'owner' });
    
    await this.readDeps(planId).catch((e) => {
      throw new BadRequest('arrangeFailed', messageOf(e));
    });
  }

  /** Plans waiting for their reading (one just come, or one asked for before a restart): it starts. */
  private readPendingDeps() {
    for (const id of this.o.board.arranging()) if (!this.readingDeps.has(id) && this.o.board.item(id)?.plan?.arranging) void this.readDeps(id).catch(() => {});
  }

  /**
   * Reads from the plan doc which workstream builds on which, and arranges the plan by it when
   * the owner asked for that, or when it just came and the owner has moved none of its cards since.
   */
  private readDeps(planId: string): Promise<void> {
    const running = this.readingDeps.get(planId);
    if (running) return running;
    const run = (async () => {
      const plan = this.o.board.item(planId);
      if (!plan) return;
      const kids = this.o.board.items().filter((i) => i.parent === planId);
      let on: Record<string, string[]>;
      try {
        on = await this.dependencies(plan, kids);
      } catch (e) {
        this.o.board.log(planId, 'error', 'seismic', this.o.board.t.koordinator.arrangeFailed(messageOf(e)));
        this.o.board.setDeps(planId, { failed: true });
        throw e;
      }
      if (!this.o.board.item(planId)) return;
      const by = this.o.board.deps(planId).reading;
      this.o.board.setDeps(planId, { on });
      if (by === 'owner' || (by === 'auto' && this.o.board.untouched(planId))) this.o.board.arrange(planId);
    })().finally(() => this.readingDeps.delete(planId));
    this.readingDeps.set(planId, run);
    return run;
  }

  /** One turn reads from the plan doc which workstream builds on which: the keys of those each builds on, by key. */
  private dependencies(plan: Item, kids: Item[]): Promise<Record<string, string[]>> {
    return readPlanDependencies({ runtime: this.o.runtime, cwd: this.o.repoFor(plan).path, plan, kids, keys: this.o.board.workstreamKeys(plan.id) });
  }

  /** The cards to be judged together under `key` (a plan's start, or cards freed at once) that the Koordinator has not planned yet. */
  private unplanned(key: string): Item[] {
    return this.o.board
      .snapshot()
      .items.filter((i) => i.state === 'planned' && i.queue && 'checking' in i.queue && i.queue.together === key)
      .sort((a, b) => a.queue!.since.localeCompare(b.queue!.since));
  }

  /** Start a queued card anyway: should it wait for a workstation then, the owner's arrows no longer hold it. */
  force(cardId: string, setting?: import('../core/types').AgentSetting) {
    const card = this.card(cardId);
    if (!card.queue || !('behind' in card.queue)) throw new BadRequest('notQueued', 'the card is not waiting');
    const since = card.queue.since;
    if (setting) this.o.board.work(cardId, { agent_setting: JSON.stringify(setting) });
    this.setQueue(cardId, null);
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.koordinator.startedDespite);
    this.launch(cardId, since, true);
  }

  /**
   * The owner moves a waiting card `places` places earlier or later in the queue, past cards it has
   * no wait with: it takes the place (`since`) of the farthest card it passes, and each card passed
   * moves up by one.
   */
  reorder(cardId: string, earlier: boolean, places = 1) {
    const card = this.card(cardId);
    if (!movable(card)) throw new BadRequest('notQueued', 'the card is not waiting');
    if (!Number.isInteger(places) || places < 1) throw new BadRequest('invalid', 'places must be a positive whole number');
    const items = this.o.board.items();
    const can = reach(cardId, earlier, items);
    if (can.places < places) throw new BadRequest('notMovable', can.why ? `${can.why}: ${can.stop!.id}` : 'not that far to go');
    const order = queueOrder(items);
    const times = order.map((i) => i.queue!.since);
    const n = order.findIndex((i) => i.id === cardId);
    const to = earlier ? n - places : n + places;
    const past = order[to]!;
    order.splice(n, 1);
    order.splice(to, 0, card);
    
    
    order.forEach((i, k) => {
      if (k && Date.parse(times[k]!) <= Date.parse(times[k - 1]!)) times[k] = new Date(Date.parse(times[k - 1]!) + 1).toISOString();
      if (times[k] !== i.queue!.since) this.setQueue(i.id, i.queue!, times[k]);
    });
    const t = this.o.board.t;
    this.o.board.log(cardId, 'state', 'owner', (earlier ? t.koordinator.movedBefore : t.koordinator.movedAfter)(past.title));
  }

  dequeue(cardId: string) {
    const card = this.card(cardId);
    if (card.kind === 'plan') {
      
      const back = this.unplanned(cardId);
      if (!back.length) throw new BadRequest('notQueued', 'no workstream of the plan waits to be planned');
      for (const w of back) this.setQueue(w.id, null);
      this.o.board.log(cardId, 'state', 'owner', this.o.board.t.koordinator.startTakenBack(back.map((w) => w.plan?.label ?? w.title).join(', ')));
      return;
    }
    if (!card.queue) throw new BadRequest('notQueued', 'the card is not waiting');
    this.setQueue(cardId, null);
    
    this.o.board.work(cardId, { agent_setting: null });
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.koordinator.dequeued);
  }

  /**
   * The owner said something (to a worker, in an idea, to the Koordinator, in a card's text): if it
   * states a lasting preference, propose it as a rule for every agent; the owner accepts it in the
   * sheet. `card` is the card it concerns, or the one open; none in a conversation without one.
   * Runs in the background, one at a time.
   */
  learn(card: Item | null, kind: OwnerInput, text: string, context: InputContext = {}) {
    
    const around = this.around(card, kind, text, context);
    this.learning = this.learning.then(() => this.distill(card, kind, text, context, around)).catch((e) => console.error('Koordinator (learning):', e));
    this.noticed();
  }

  /**
   * The owner said something, or clicked without words (a start, an approval, a dismissed
   * proposal): every `reviewEvery` of these, the retrospective reads the history since the last one,
   * after the learner has read the input that completed the count. The count is a setting of the
   * project, so it survives a restart.
   */
  noticed() {
    const b = this.o.board;
    
    if (!b.setting(REVIEW_SINCE)) b.setSetting(REVIEW_SINCE, new Date(Date.now() - 60_000).toISOString());
    const count = Number(b.setting(REVIEW_COUNT) ?? 0) + 1;
    if (count < (this.o.reviewEvery ?? REVIEW_EVERY)) return b.setSetting(REVIEW_COUNT, String(count));
    const since = b.setting(REVIEW_SINCE)!;
    b.setSetting(REVIEW_COUNT, '0');
    b.setSetting(REVIEW_SINCE, new Date().toISOString());
    this.learning = this.learning.then(() => this.review(since)).catch((e) => console.error('Koordinator (retrospective):', e));
  }

  /** The retrospective: one session reads what happened since `since` and proposes rules for patterns across cards. */
  private async review(since: string): Promise<void> {
    const history = this.history(since);
    if (!history.length) return;
    await proposeRulesFromHistory({ runtime: this.o.runtime, board: this.o.board, cwd: this.o.home(), language: this.spokenLanguage, history, onLimit: waitQuietly });
  }

  /**
   * What the retrospective reads, oldest first, at most the latest REVIEW_HISTORY lines: the cards'
   * milestones (the owner's notes, answers and clicks, the agents' questions and hand-overs, answers
   * given in the owner's name), the owner's words in ideas and to the Koordinator (taken back or
   * not), the cards they deleted or dismissed, and the rule proposals they decided on.
   */
  private history(since: string): string[] {
    const b = this.o.board;
    const title = (id?: string) => (id ? b.item(id)?.title : undefined);
    const lines: { at: string; text: string }[] = [
      ...b.timeline(since, REVIEW_HISTORY).flatMap((m) => {
        const t = title(m.cardId);
        if (!t) return [];
        const who = m.kind === 'answer' && m.author !== 'owner' ? `${WHO[m.author]}, in the owner's name,` : WHO[m.author];
        const what = m.kind === 'created' ? (m.author === 'owner' ? 'the owner created the card' : 'an agent proposed the card') : `${who}${STEPS[m.kind] ?? ' '}${clip(m.text, 300)}`;
        return [{ at: m.at, text: `"${t}": ${what}` }];
      }),
      ...b
        .utterances(since, REVIEW_HISTORY)
        .filter((u) => u.kind === 'talk')
        .map((u) => ({ at: u.at, text: `"${u.title ?? ''}": the owner in the idea's discussion: ${clip(u.text, 300)}` })),
      ...b
        .talk(REVIEW_HISTORY)
        .filter((t) => t.at > since && t.reply !== undefined)
        .map((t) => {
          const open = title(t.cardId);
          return {
            at: t.at,
            text: `the owner to you${open ? ` (with "${open}" open)` : ''}: ${clip(t.said, 300)} → ${clip(t.reply!, 200)}${t.undone ? ' (the owner took it back)' : ''}`,
          };
        }),
      ...b.removed(since).map((r) => ({
        at: r.at,
        text: r.state === 'proposal' ? `the owner dismissed the card an agent proposed: "${r.title}"` : `the owner deleted the card "${r.title}" (${r.state})`,
      })),
      ...b.decidedProposals(since).map((p) => ({
        at: p.at,
        text: `the owner ${p.state === 'rejected' ? 'rejected' : 'accepted'} the proposed rule "${p.text}"${p.state === 'filed' ? ` for the CLAUDE.md of ${p.target}` : ''}${p.quote ? ` (its occasion: ${clip(p.quote, 200)})` : ''}`,
      })),
    ];
    return lines
      .sort((x, y) => x.at.localeCompare(y.at))
      .slice(-REVIEW_HISTORY)
      .map((l) => `- ${l.at.slice(0, 16).replace('T', ' ')} ${l.text}`);
  }

  /** What the learner reads an input in: the card's text, the agent's last message before it, what the owner said in the last days. */
  private around(card: Item | null, kind: OwnerInput, text: string, { question }: InputContext): string[] {
    
    const events = card && this.o.board.item(card.id) ? this.o.board.events(card.id) : [];
    
    const said = question ? undefined : events.find((e) => AGENTS.includes(e.author) && SAYS.includes(e.kind));
    const recent = this.o.board.utterances(new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString(), RECENT_UTTERANCES + 1);
    
    const self = recent.findLastIndex((u) => u.text === text);
    if (self >= 0) recent.splice(self, 1);
    return [
      card?.body && kind !== 'card' ? `The card's text:\n${clip(card.body, 1500)}` : '',
      recent.length
        ? `What the owner said in the last ${RECENT_DAYS} days, oldest first:\n${recent
            .slice(-RECENT_UTTERANCES)
            .map((u) => `- ${u.at.slice(0, 10)}, ${UTTERED[u.kind]}${u.title ? ` on "${u.title}"` : ''}: ${clip(u.text, 300)}`)
            .join('\n')}`
        : '',
      said ? `The ${said.author === 'explorer' ? 'idea agent' : 'agent'}'s last message on the card before it:\n${clip(said.text, 1500)}` : '',
    ];
  }

  private async distill(card: Item | null, kind: OwnerInput, text: string, context: InputContext, around: string[]): Promise<void> {
    await learnRuleFromInput({
      runtime: this.o.runtime,
      board: this.o.board,
      cwd: card && !card.repoDown ? this.o.repoFor(card).path : this.o.home(),
      language: this.spokenLanguage,
      card,
      kind,
      text,
      context,
      around,
      onLimit: waitQuietly,
    });
  }

  /** Cards in progress; with a repository, only those a card of it can collide with. A parked card holds nothing while parked. */
  inProgress(repo?: string): Item[] {
    return this.o.board
      .snapshot()
      .items.filter((i) => running(i) && !inParkingLot(i) && (!repo || i.repo === repo));
  }

  /**
   * Cards of the card's repository queued before it and still waiting: they go first, so a card
   * likely to conflict with one of them queues behind it instead of overtaking it. One that waits
   * for the card itself (it builds on it) does not go first, so the two never wait for each other.
   */
  ahead(card: Item): Item[] {
    const since = card.queue?.since;
    if (!since) return [];
    const items = this.o.board.items();
    return items
      .filter((i) => i.id !== card.id && i.repo === card.repo && inQueue(i) && (i.queue!.since ?? '') < since && !waitsOn(i, card.id, items, true))
      .sort((a, b) => a.queue!.since.localeCompare(b.queue!.since));
  }

  /**
   * The other workstreams of a workstream's plan that have not landed and are neither in progress
   * nor queued ahead: not started (stopped ones too), or queued after it. It may build on one of
   * them; one waiting for it is left out, so the two never wait for each other.
   */
  private pending(card: Item, active: Item[], ahead: Item[]): Item[] {
    if (!card.parent) return [];
    const items = this.o.board.items();
    const seen = new Set([card.id, ...active.map((i) => i.id), ...ahead.map((i) => i.id)]);
    return items.filter(
      (i) => i.parent === card.parent && i.kind !== 'plan' && !seen.has(i.id) && !finished(i.state) && !i.archivedAt && !inParkingLot(i) && !waitsOn(i, card.id, items, true),
    );
  }

  /** How the log names a card waited for: a workstream by its label, and one not started as such. */
  private nameOf(i: Item): string {
    const t = this.o.board.t;
    const name = i.parent && i.plan?.label ? `${i.plan.label} ${t.quote(i.title)}` : t.quote(i.title);
    return notStarted(i) ? t.koordinator.notStarted(name) : name;
  }

  private async decide(cardId: string) {
    
    await this.name(cardId);
    this.suggestAtStart(cardId);
    const card = this.o.board.item(cardId);
    
    if (!card || card.state !== 'planned' || !card.queue || !('checking' in card.queue)) return;
    if (card.repoDown) return this.repoGone(card);
    const active = this.inProgress(card.repo);
    const ahead = this.ahead(card);
    const pending = this.pending(card, active, ahead);
    const candidates = this.duplicateCandidates(card);
    if (!active.length && !ahead.length && !pending.length && !candidates.length) {
      
      if (drawnWaits(card, this.o.board.items()).length) return void this.queueOrStart(cardId, [], [], '', '');
      
      this.startNow(cardId, this.o.board.t.koordinator.nothingRuns);
      if (this.o.board.item(cardId)?.state !== 'working') return;
      try {
        const scope = await this.estimate(card, [], [], [], [], waitQuietly);
        this.o.board.work(cardId, { scope: JSON.stringify({ files: scope.files, reason: scope.reason }) });
      } catch {}
      return;
    }
    let scope: Scope;
    try {
      scope = await this.estimate(card, active, ahead, pending, candidates, (until, retry) => this.o.board.waitsForLimit({ card: cardId }, until, retry));
    } catch (e) {
      this.o.board.log(cardId, 'error', 'seismic', this.o.board.t.koordinator.estimateFailed(messageOf(e)));
      scope = { files: [], duplicates: [], conflictsWith: [], buildsOn: [], reason: '' };
    }
    const now = this.o.board.item(cardId);
    if (!now?.queue) return;
    
    if (now.repoDown) return this.repoGone(now);
    this.o.board.work(cardId, { scope: JSON.stringify({ files: scope.files, reason: scope.reason, ...(scope.duplicates.length ? { duplicateCheck: { title: card.title, body: card.body, ids: scope.duplicates } } : {}) }) });
    if (scope.duplicates.length) {
      this.setQueue(cardId, null);
      this.o.board.log(cardId, 'state', 'koordinator', this.o.board.t.koordinator.possibleDuplicate(scope.duplicates.map((id) => this.o.board.item(id)?.title ?? id).join(', ')));
      return;
    }
    
    
    const behind = [...active, ...ahead, ...pending].filter((a) => scope.buildsOn.includes(a.id) || scope.conflictsWith.includes(a.id)).map((a) => a.id);
    const t = this.o.board.t.koordinator;
    const buildsOn = behind.filter((id) => scope.buildsOn.includes(id));
    const reason = scope.reason || (buildsOn.length ? t.buildsOn : t.likelyConflict);
    void this.queueOrStart(cardId, behind, buildsOn, reason, `${t.noConflict}${scope.reason ? ` ${scope.reason}` : ''}`, (id) => {
      const a = ahead.find((x) => x.id === id);
      return a && t.waitsAhead(a.title);
    });
  }

  /**
   * Queues the card behind the cards the Koordinator found it waits for (`inferred`, `buildsOn`
   * among them, for `reason`) and those the owner's arrows hold it for, or starts it (`why`) when
   * there are none, which it says. `name` names a card in the log where it knows better than `nameOf`.
   */
  private queueOrStart(cardId: string, inferred: string[], buildsOn: string[], reason: string, why: string, name?: (id: string) => string | undefined): boolean {
    const items = this.o.board.items();
    
    inferred = inferred.filter((id) => {
      const i = items.find((x) => x.id === id);
      return !(i && waitsOn(i, cardId, items, true));
    });
    buildsOn = buildsOn.filter((id) => inferred.includes(id));
    const drawn = drawnWaits(this.card(cardId), items).filter((id) => !inferred.includes(id));
    if (!inferred.length && !drawn.length) {
      this.startNow(cardId, why);
      return true;
    }
    this.setQueue(cardId, { behind: [...inferred, ...drawn], reason: inferred.length ? reason : this.o.board.t.koordinator.drawn, ...(buildsOn.length && { buildsOn }), ...(drawn.length && { manualWait: drawn }) });
    const nameFor = (id: string) => name?.(id) ?? this.nameOf(items.find((i) => i.id === id) ?? this.o.board.card(id)!);
    this.logWait(cardId, inferred, reason, drawn, nameFor);
    const t = this.o.board.t;
    this.o.board.notify({ cardId, level: 'warning', text: t.koordinator.queuedWarning(t.quote(this.card(cardId).title), [...inferred, ...drawn].map(nameFor).join(', ')) });
    return false;
  }

  /** The card's line on what it waits for: the waits inferred with their `reason`, and those the owner's arrows hold it for (`drawn`). */
  private logWait(cardId: string, inferred: string[], reason: string, drawn: string[], name: (id: string) => string) {
    const t = this.o.board.t.koordinator;
    const names = (ids: string[]) => ids.map(name).join(', ');
    const line = inferred.length ? `${t.waitsFor(names(inferred), reason)}${drawn.length ? ` ${t.drawnToo(names(drawn))}` : ''}` : t.waitsFor(names(drawn), t.drawn);
    this.o.board.log(cardId, 'state', 'seismic', line);
  }

  /**
   * Decides on the cards that came to the Koordinator together under `key`: the workstreams of a
   * plan started at once (`key` its id), or cards whose waits ended at once (`freed:…`).
   */
  private async decideAll(key: string) {
    const items = this.o.board.items();
    const batch = this.unplanned(key);
    const planCard = this.o.board.item(key);
    const t = this.o.board.t.koordinator;
    if (!batch.length) return;
    if (batch[0]!.repoDown) return batch.forEach((w) => this.repoGone(w));
    for (const w of batch) this.suggestAtStart(w.id);
    if (batch.length === 1) {
      
      this.setQueue(batch[0]!.id, { checking: true });
      return this.decide(batch[0]!.id);
    }
    const ids = new Set(batch.map((w) => w.id));
    const repo = batch[0]!.repo;
    const active = this.inProgress(repo);
    
    
    const last = batch.map((w) => w.queue!.since).sort().at(-1)!;
    const ahead = items
      .filter((i) => i.repo === repo && !ids.has(i.id) && inQueue(i) && (planCard || i.queue!.since < last) && !batch.some((w) => waitsOn(i, w.id, items, true)))
      .sort((a, b) => a.queue!.since.localeCompare(b.queue!.since));
    let plan: Planned[];
    try {
      plan = await this.schedule(planCard, batch, active, ahead);
    } catch (e) {
      
      
      
      const left = batch.filter((w) => {
        const q = this.o.board.item(w.id)?.queue;
        return !!q && 'checking' in q && q.together === key && q.since === w.queue!.since;
      });
      if (planCard) this.o.board.log(key, 'error', 'seismic', t.togetherFailed(messageOf(e)));
      else for (const w of left) this.o.board.log(w.id, 'error', 'seismic', t.freedFailed(messageOf(e)));
      for (const w of left) {
        this.setQueue(w.id, { checking: true });
        this.serial(() => this.decide(w.id));
      }
      return;
    }
    if (this.o.board.item(batch[0]!.id)?.repoDown) return this.unplanned(key).forEach((w) => this.repoGone(w));
    
    const still = (id: string) => {
      const q = this.o.board.item(id)?.queue;
      return !!q && 'checking' in q && q.together === key;
    };
    
    
    const times = batch.map((w) => w.queue!.since!);
    const before = new Set([...active, ...ahead].map((i) => i.id));
    const names = new Map([...active, ...ahead, ...batch].map((i) => [i.id, i.parent && i.plan?.label && (!planCard || i.parent === key) ? `${i.plan.label} ${this.o.board.t.quote(i.title)}` : this.o.board.t.quote(i.title)]));
    let started = 0;
    plan.forEach((p, n) => {
      const id = p.card;
      if (!still(id)) return before.add(id);
      if (p.duplicates.length) {
        const current = this.card(id);
        this.o.board.work(id, { scope: JSON.stringify({ files: p.files, reason: p.reason, duplicateCheck: { title: current.title, body: current.body, ids: p.duplicates } }) });
        this.setQueue(id, null);
        this.o.board.log(id, 'state', 'koordinator', t.possibleDuplicate(p.duplicates.map((other) => this.o.board.item(other)?.title ?? other).join(', ')));
        return;
      }
      const behind = p.waitsFor.filter((b) => before.has(b) && this.blocks(b));
      before.add(id);
      this.o.board.work(id, { scope: JSON.stringify({ files: p.files, reason: p.reason }), queue: JSON.stringify({ checking: true, together: key, since: times[n] }) });
      const buildsOn = behind.filter((b) => p.buildsOn.includes(b));
      const reason = p.reason || (buildsOn.length ? t.buildsOn : t.likelyConflict);
      if (this.queueOrStart(id, behind, buildsOn, reason, `${planCard ? t.togetherStarts : t.freedStarts}${p.reason ? ` ${p.reason}` : ''}`, (b) => names.get(b))) started++;
    });
    if (planCard) this.o.board.log(key, 'state', 'koordinator', t.planned(started, plan.length));
  }

  /** Whether a card still holds others back: in progress, or waiting itself. */
  private blocks(id: string): boolean {
    const i = this.o.board.item(id);
    return !!i && (this.inProgress(i.repo).some((a) => a.id === id) || inQueue(i));
  }

  /** `begun`: it waited, started anyway or at work before, for a workstation or the project's agents (see `Wait`). */
  private startNow(cardId: string, why: string, begun?: boolean) {
    const since = this.o.board.item(cardId)?.queue?.since;
    this.setQueue(cardId, null);
    this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.koordinator.says(why));
    this.launch(cardId, since, begun);
  }

  /**
   * Starts the card's worker. Without a free workstation the card waits for one, in its place in the
   * queue (`since`), and starts once one is free; any other failure is logged and leaves it planned.
   */
  private launch(cardId: string, since?: string, begun?: boolean) {
    const card = this.o.board.item(cardId);
    if (!card) return;
    const unheld = begun ? { begun: true as const } : {};
    if (this.o.paused?.()) {
      this.setQueue(cardId, { paused: true, ...unheld }, since);
      this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.koordinator.projectPaused);
      return;
    }
    const refused = (e: unknown) => {
      const shortage = e instanceof BadRequest ? shortageOf(e.code) : undefined;
      if (!shortage) return this.o.board.log(cardId, 'error', 'seismic', messageOf(e), { code: e instanceof BadRequest ? e.code : undefined });
      this.setQueue(cardId, { workstation: shortage, ...unheld }, since);
      this.o.board.log(cardId, 'state', 'seismic', { none: this.o.board.t.koordinator.noWorkstation, dirty: this.o.board.t.koordinator.dirtyWorkstations, slots: this.o.board.t.koordinator.noSlot }[shortage]);
    };
    try {
      
      
      const saved = this.o.board.row(cardId).agent_setting;
      this.o.repoFor(card).workers.start(cardId, saved ? JSON.parse(saved) : undefined).catch(refused);
    } catch (e) {
      refused(e);
    }
  }

  /** Queued cards start once nothing they wait for is in progress or queued any more. */
  private scheduleDrain() {
    if (this.draining) return;
    this.draining = true;
    setTimeout(() => {
      this.draining = false;
      this.serial(() => this.drain());
    }, 0);
  }

  private drain() {
    const items = this.o.board.items();
    
    
    
    const active = new Set(items.filter((i) => running(i) || inQueue(i)).map((i) => i.id));
    const parked = new Set(items.filter(inParkingLot).map((i) => i.id));
    
    const waiting = queueOrder(items).filter(movable);
    
    const full = new Set<string | undefined>();
    
    let again = false;
    const paused = !!this.o.paused?.();
    
    const freed: Item[] = [];
    
    for (const f of items.filter((i) => i.agent?.waitsForClone && !i.repoDown)) {
      const hands = this.o.repoFor(f);
      if (full.has(f.repo) || !hands.workstations.leasable(true) || !hands.workers.takeClone(f.id)) full.add(f.repo);
    }
    for (const w of waiting) {
      
      
      if (w.repoDown || this.giving.has(w.id) || w.idea?.proposal?.merge || (w.idea?.mergingInto && mergeRank(w) <= 1)) continue;
      const begun = 'begun' in w.queue! && !!w.queue.begun;
      if (!('behind' in w.queue!) && !('restart' in w.queue!)) {
        
        
        const drawn = drawnWaits(w, items);
        if (drawn.length) {
          this.setQueue(w.id, { behind: drawn, reason: this.o.board.t.koordinator.drawn, manualWait: drawn });
          this.logWait(w.id, [], '', drawn, (id) => this.nameOf(items.find((i) => i.id === id) ?? this.o.board.card(id)!));
          continue;
        }
      }
      if ('restart' in w.queue!) {
        
        if (!this.o.restarting?.()) {
          this.setQueue(w.id, { checking: true }, w.queue!.since);
          this.serial(() => this.decide(w.id));
        } else again = true;
        continue;
      }
      if ('paused' in w.queue!) {
        if (!paused) this.startNow(w.id, this.o.board.t.koordinator.projectPlays, begun);
        continue;
      }
      if ('workstation' in w.queue!) {
        
        if (paused) {
          this.setQueue(w.id, { paused: true, ...(begun && { begun }) }, w.queue!.since);
          this.o.board.log(w.id, 'state', 'seismic', this.o.board.t.koordinator.projectPaused);
          continue;
        }
        
        const near = this.o.board.row(w.id).kept_in;
        if (full.has(w.repo) || !this.o.repoFor(w).workstations.leasable(false, near)) {
          if (near) again = true;
          else full.add(w.repo);
          continue;
        }
        this.startNow(w.id, w.queue!.workstation === 'slots' ? this.o.board.t.koordinator.slotFree : this.o.board.t.koordinator.workstationFree, begun);
        if (this.o.board.item(w.id)?.queue) full.add(w.repo);
        continue;
      }
      const q = w.queue as { behind: string[]; reason: string; buildsOn?: string[]; manualWait?: string[] };
      
      
      const unmerged = items.find((i) => q.buildsOn?.includes(i.id) && i.state === 'done' && contributionOf(this.o.board.row(i.id))?.closed);
      if (unmerged) {
        this.setQueue(w.id, null);
        this.o.board.log(w.id, 'state', 'seismic', this.o.board.t.koordinator.reviewClosed(this.o.board.t.quote(unmerged.title)));
        continue;
      }
      
      
      
      
      
      const inferred = q.behind.filter((id) => {
        const i = items.find((x) => x.id === id);
        return !q.manualWait?.includes(id) && (active.has(id) || (q.buildsOn?.includes(id) && unlanded(i))) && !(i && waitsOn(i, w.id, items, true));
      });
      const manualWait = drawnWaits(w, items).filter((id) => !inferred.includes(id));
      const buildsOn = (q.buildsOn ?? []).filter((id) => inferred.includes(id));
      const still = [...inferred, ...manualWait];
      const holding = still.filter((id) => !parked.has(id));
      if (holding.length && same(still, q.behind) && same(manualWait, q.manualWait ?? []) && same(buildsOn, q.buildsOn ?? [])) continue;
      if (holding.length) {
        this.setQueue(w.id, { behind: still, reason: inferred.some((id) => !parked.has(id)) ? q.reason : this.o.board.t.koordinator.drawn, ...(buildsOn.length && { buildsOn }), ...(manualWait.length && { manualWait }) });
        
        const drawnNow = manualWait.filter((id) => !q.behind.includes(id));
        if (drawnNow.length) this.logWait(w.id, [], '', drawnNow, (id) => this.nameOf(items.find((i) => i.id === id) ?? this.o.board.card(id)!));
        continue;
      }
      freed.push(w);
    }
    
    
    
    
    for (const repo of new Set(freed.map((w) => w.repo))) {
      const group = freed.filter((w) => w.repo === repo);
      if (group.length > 1) {
        const key = `freed:${randomUUID()}`;
        for (const w of group) {
          this.setQueue(w.id, { checking: true, together: key });
          this.o.board.log(w.id, 'state', 'seismic', this.o.board.t.koordinator.waitedDoneTogether);
        }
        this.serial(() => this.decideAll(key));
        continue;
      }
      const w = group[0]!;
      if (!this.inProgress(w.repo).length) {
        this.startNow(w.id, this.o.board.t.koordinator.waitedDone);
      } else {
        this.setQueue(w.id, { checking: true });
        this.o.board.log(w.id, 'state', 'seismic', this.o.board.t.koordinator.waitedDoneRecheck);
        this.serial(() => this.decide(w.id));
      }
    }
    if ((full.size || again) && !this.recheck) {
      this.recheck = setTimeout(() => {
        this.recheck = undefined;
        this.scheduleDrain();
      }, RECHECK_MS);
      this.recheck.unref?.();
    }
  }

  

  /**
   * A card the owner left without a title (`nameless`) gets one from its text and screenshots, by a
   * short session; a title the owner types meanwhile stands. Without an answer the text's start
   * stands in.
   */
  name(cardId: string): Promise<void> {
    const card = this.o.board.item(cardId);
    if (!card || !nameless(card)) return Promise.resolve();
    let naming = this.naming.get(cardId);
    if (!naming) {
      
      const asked = this.labelsToAsk(cardId);
      naming = this.writeTitle(card, asked)
        .then(({ title, labels }) => {
          const now = this.o.board.item(cardId);
          if (now && !now.title.trim() && title) this.o.board.patch(cardId, { title });
          if (now) this.o.board.suggestLabels(cardId, labels);
        })
        .finally(() => this.naming.delete(cardId));
      this.naming.set(cardId, naming);
    }
    return naming;
  }

  private writeTitle(card: Item, asked: Label[]): Promise<{ title: string; labels: Labels }> {
    return nameCard({
      runtime: this.o.runtime,
      
      cwd: card.repoDown ? this.o.home() : this.o.repoFor(card).path,
      language: this.language,
      asked,
      task: card.body,
      preferences: this.o.board.preferencesText(),
      images: this.o.imageFiles?.(card.images) ?? [],
      onLimit: (until, retry) => this.o.board.waitsForLimit({ card: card.id }, until, retry),
    });
  }

  

  /** The project's toggles as they are now; all on where it has none. */
  suggests(): Partial<SuggestToggles> {
    return this.o.suggests?.() ?? {};
  }

  /**
   * The labels to ask a session for on a card: empty, never set by the owner, and on the project's
   * toggles; none once a session was asked for the card. Asking marks the card as asked.
   */
  private labelsToAsk(cardId: string): Label[] {
    if (this.labelled.has(cardId)) return [];
    const on = suggestable(this.suggests());
    const asked = this.o.board.openLabels(cardId).filter((l) => on.includes(l));
    if (asked.length) this.labelled.add(cardId);
    return asked;
  }

  /**
   * A card that starts with a title of its own gets the labels left to suggest from one short session
   * beside its start, which never waits for it; one without a title gets them with its title (`name`).
   * A failed session leaves them empty; what the owner picks meanwhile stands.
   */
  private suggestAtStart(cardId: string) {
    const card = this.o.board.item(cardId);
    if (!card || nameless(card) || card.kind === 'plan' || card.repoDown) return;
    const asked = this.labelsToAsk(cardId);
    if (!asked.length) return;
    void judgeCardLabels({ runtime: this.o.runtime, cwd: this.o.repoFor(card).path, asked, title: card.title, body: card.body, images: this.o.imageFiles?.(card.images) ?? [] })
      .then((labels) => {
        if (this.o.board.item(cardId)) this.o.board.suggestLabels(cardId, labels);
      })
      .catch(() => {});
  }

  

  /** Whether a starting card is checked for duplicates; on unless the project switched "Suggest card merges" off. */
  private suggestsMerges(): boolean {
    return this.o.suggestsMerges?.() !== false;
  }

  /** Unfinished tasks in this repository, including ones still planned or awaiting approval. */
  private duplicateCandidates(card: Item): Item[] {
    
    if (!this.suggestsMerges()) return [];
    
    const row = this.o.board.row(card.id);
    if (row.branch) return [];
    const previous = row.scope;
    if (previous) {
      try {
        const checked = (JSON.parse(previous) as { duplicateCheck?: { title: string; body: string } }).duplicateCheck;
        if (checked?.title === card.title && checked.body === card.body) return [];
      } catch {}
    }
    const words = (item: Item) => new Set(`${item.title} ${item.body}`.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.filter((word) => !['the', 'and', 'for', 'with', 'from', 'add', 'eine', 'einen', 'und', 'für', 'mit', 'der', 'die', 'das'].includes(word)) ?? []);
    const mine = words(card);
    return this.o.board.items().filter((i) => {
      if (i.id === card.id || i.repo !== card.repo || i.kind !== 'task' || i.idea?.prototypeOf || i.archivedAt || inParkingLot(i) || (i.state !== 'planned' && !ACTIVE.includes(i.state))) return false;
      if (ACTIVE.includes(i.state)) return true;
      const theirs = words(i);
      return [...mine].filter((word) => theirs.has(word)).length >= 2;
    });
  }

  /** `onLimit`: where the estimate shows that it waits for the usage limit. */
  private async estimate(card: Item, active: Item[], ahead: Item[], pending: Item[], candidates: Item[], onLimit: (until: number | null | undefined, retry?: () => void) => void): Promise<Scope> {
    const tags = new CardTags(active, ahead, pending, candidates);
    const hands = this.o.repoFor(card);
    return estimateCardScope({
      runtime: this.o.runtime,
      cwd: hands.path,
      card,
      active,
      ahead,
      pending,
      candidates,
      tags,
      
      merges: this.suggestsMerges(),
      folder: !!hands.folder,
      language: this.spokenLanguage,
      preferences: this.o.board.preferencesText(),
      brief: () => this.brief(card, active, ahead, pending, tags),
      onLimit,
    });
  }

  /**
   * One turn over all the cards of a batch, a plan's workstreams (`plan`) or cards freed at
   * once: in which order they go, and which wait for what.
   */
  private async schedule(planCard: Item | undefined, batch: Item[], active: Item[], ahead: Item[]): Promise<Planned[]> {
    const candidates = [...new Map(batch.flatMap((w) => this.duplicateCandidates(w)).map((a) => [a.id, a])).values()];
    const tags = new CardTags(active, ahead, batch, candidates);
    const hands = this.o.repoFor(batch[0]!);
    return scheduleCardBatch({
      runtime: this.o.runtime,
      board: this.o.board,
      cwd: hands.path,
      planCard,
      batch,
      active,
      ahead,
      candidates,
      tags,
      merges: this.suggestsMerges(),
      folder: !!hands.folder,
      language: this.spokenLanguage,
      preferences: this.o.board.preferencesText(),
      others: () => this.others(batch[0]!, active, ahead, tags),
      
      onLimit: (until, retry) => {
        for (const w of batch) this.o.board.waitsForLimit({ card: w.id }, until, retry);
      },
    });
  }

  private async brief(card: Item, active: Item[], ahead: Item[], pending: Item[], tags: CardTags): Promise<string> {
    const plan = card.parent ? this.o.board.item(card.parent) : undefined;
    const siblings = [...active, ...ahead].filter((a) => a.parent === card.parent).map((a) => tags.tagOf(a.id));
    const lines = [
      `The card to start: ${card.kind} "${card.title}".`,
      card.body.trim(),
      plan?.plan?.file ? `It is workstream ${card.plan?.label ?? ''} of the plan "${plan.title}"; plan doc ${plan.plan.file}.` : '',
      ...(await this.others(card, active, ahead, tags)),
      siblings.length ? `Of these, workstreams of the same plan: ${siblings.join(', ')}.` : '',
      pending.length
        ? `The plan's other workstreams that have not landed, neither in progress nor queued ahead:\n${pending
            .map((w) => {
              const state = notStarted(w) ? (w.agent?.branch ? 'stopped by the owner, not running' : 'not started') : 'queued after this card';
              return `- ${tags.tagOf(w.id)}: ${w.plan?.label ? `${w.plan.label} ` : ''}"${w.title}" (${state})${w.body ? ` — ${w.body.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`;
            })
            .join('\n')}`
        : '',
    ];
    return lines.filter(Boolean).join('\n\n');
  }

  /** The cards in progress and queued ahead, as a turn of the Koordinator reads them. */
  private async others(card: Item, active: Item[], ahead: Item[], tags: CardTags): Promise<string[]> {
    const folder = !!this.o.repoFor(card).folder;
    
    const soft = folder ? [] : this.o.repoFor(card).adapter.softPaths;
    const described = folder ? (c: Change) => `${c.file} (${c.regions[0] ?? 'changed'})` : describe;
    const hard = (f: string) => !soft.some((s) => overlaps(normalize(f), s));
    
    const changes = await Promise.all(active.map((a) => this.o.repoFor(a).workstations.changes(a.id)));
    return [
      active.length
        ? `Cards in progress:\n${active
            .map((a, n) => {
              const tag = tags.tagOf(a.id);
              const changed = changes[n]!.filter((c) => hard(c.file));
              return [
                `- ${tag}: "${a.title}"${a.body ? ` — ${a.body.split('\n')[0]!.slice(0, 200)}` : ''}`,
                `  expected to change: ${(a.scope ?? []).filter(hard).join(', ') || '(no estimate)'}`,
                `  changed so far: ${changed.length ? changed.slice(0, 60).map(described).join(', ') : '(nothing yet)'}`,
              ].join('\n');
            })
            .join('\n')}`
        : 'No cards are in progress.',
      ahead.length
        ? `Cards queued ahead of this one (they wait for others and start before this card):\n${ahead
            .map((a) => {
              const q = a.queue!;
              const waitsFor =
                'behind' in q ? q.behind.map((id) => `"${this.o.board.item(id)?.title ?? id}"`).join(', ') : 'workstation' in q ? 'a free workstation (its start is decided)' : 'paused' in q ? "the owner to resume the project's paused agents (its start is decided)" : 'restart' in q ? "Seismic's restart (it is not yet checked)" : '';
              return [
                `- ${tags.tagOf(a.id)}: "${a.title}"${a.body ? ` — ${a.body.split('\n')[0]!.slice(0, 200)}` : ''}`,
                `  expected to change: ${(a.scope ?? []).filter(hard).join(', ') || '(no estimate)'}`,
                `  waits for: ${waitsFor || 'your decision'}`,
              ].join('\n');
            })
            .join('\n')}`
        : '',
      soft.length ? `Changes under ${soft.join(', ')} never count: they are resolved when a branch lands.` : '',
    ];
  }

  

  private serial(fn: () => unknown) {
    this.deciding++;
    this.chain = this.chain.then(fn).catch((e) => console.error('Koordinator:', e)).finally(() => this.deciding--);
  }

  /** Whether a change of the board is still to be looked at or a decision is under way (one may wait for an agent's estimate). */
  get busy(): boolean {
    return this.draining || this.deciding > 0;
  }

  /** The repository of a card it was deciding on stopped running on the project: the card is planned again, for the owner to start once it is back. */
  private repoGone(card: Item) {
    this.setQueue(card.id, null);
    this.o.board.log(card.id, 'state', 'seismic', this.o.board.t.koordinator.repoDown(card.repo));
  }

  /** A card keeps the time it came to the Koordinator for as long as it stays queued. */
  private setQueue(cardId: string, q: Wait | null, keep?: string) {
    const since = keep ?? this.o.board.item(cardId)?.queue?.since ?? new Date().toISOString();
    this.o.board.work(cardId, { queue: q ? JSON.stringify({ ...q, since }) : null });
    if (q && 'behind' in q && q.behind.length) this.o.board.record(cardId, 'waitsForCard', 'seismic', { other: q.behind[0]!, again: (l) => l.code === 'waitsForCard' && q.behind.includes(l.otherId ?? '') });
    else if (q && 'workstation' in q) this.o.board.record(cardId, 'waitsForWorkstation', 'seismic', { again: (l) => l.code === 'waitsForWorkstation' });
  }

  private card(id: string): Item {
    const i = this.o.board.item(id);
    if (!i) throw new BadRequest('unknownCard', 'unknown card');
    return i;
  }
}





export const REVIEW_EVERY = 20;
const REVIEW_HISTORY = 300;

const REVIEW_COUNT = 'review_inputs';
const REVIEW_SINCE = 'review_since';



const WHO: Record<CardEvent['author'], string> = {
  owner: 'the owner',
  worker: 'the agent',
  explorer: 'the idea agent',
  plan: 'the plan agent',
  koordinator: 'you',
  seismic: 'Seismic',
};
const STEPS: Partial<Record<CardEvent['kind'], string>> = {
  state: ': ',
  question: ' asked: ',
  answer: ' answered: ',
  review: ' handed over: ',
  hint: ' wrote to the agent: ',
  error: ', an error: ',
};


const RECENT_DAYS = 3;
const RECENT_UTTERANCES = 30;


const AGENTS: CardEvent['author'][] = ['worker', 'explorer'];
const SAYS: CardEvent['kind'][] = ['say', 'question', 'review', 'report', 'talk'];


const UTTERED: Record<Utterance['kind'], string> = {
  hint: 'to the agent',
  answer: "answering the agent's question",
  talk: "in an idea's discussion",
  say: 'to you',
};

/** A changed file with the places changed in it: "src/a.ts (lines 12-20 in function f; 40)", or "(new)". */
const describe = (c: Change) =>
  `${c.file} (${c.regions.length ? (c.regions[0] === 'deleted' ? 'deleted' : `lines ${c.regions.slice(0, 8).join('; ')}${c.regions.length > 8 ? '; …' : ''}`) : 'new'})`;



/** In progress, parked or not: approved work counts until it has landed (a PR not yet merged still holds its files); a prototype never lands, so it collides with nothing. */
const running = (i: Item) => ACTIVE.includes(i.state) && i.kind !== 'plan' && !i.idea?.prototypeOf;

const unlanded = (i?: Item) => !!i && !finished(i.state) && !i.archivedAt;
/** Whether two lists hold the same cards. */
const same = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));


export { overlaps } from '../core/path-overlap';
