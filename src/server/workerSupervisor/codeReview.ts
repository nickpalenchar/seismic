/**
 * The code review of a card's work where its project reviews work:
 * a separate, read-only agent of the "Code reviews" group reads the
 * branch's diff against main the repository's way and adds graded items to the card's one running
 * list, which its Review tab shows; it also verifies what the worker resubmitted as fixed and
 * reopens what regressed or is not fixed. It starts with each handover (`auto`) or on the owner's
 * "Start code review" (`manual`), where a handover that resubmits fixes starts the review verifying
 * them by itself; a handover that changes the branch makes the review before it
 * stale. On an item that needs them the owner decides "Fix it" (the card's worker fixes it) or "As a
 * follow-up task", or ignores it, with the card's one Send, as on a review card.
 */

import { BadRequest, type Board, codeReviewOf, type StoredCodeReview } from '../board';
import { type AgentRuntime, type AgentSession } from '../runtime';
import { gitAsync } from '../workstations';
import type { CardWorkstations } from '../workstations';
import { AGENT_DEFAULTS, harnessChoice, type AgentSetting, type AgentIdentity, type ChangeRoute, type CodeReviewMode, needsOwner, type ReviewItem, type ReviewItemStatus, type ReviewItemWho, type Severity, SEVERITIES } from '../../core/types';
import { LANGUAGE_NAMES } from '../../core/locale';
import { clip, messageOf } from '../../core/text';
import type { DueRestart } from '../llms/agents/worker/restartNotices';
import { restartNotice } from '../llms/prompts/restartNotice';
import { reviewerAgent } from '../llms/agents/review/reviewerAgent';

/** How much of the diff the review agent gets in its brief; it reads the files themselves beyond that. */
const DIFF_LIMIT = 150_000;
const MAX_NEW_ITEMS = 30;

export interface CodeReviewOptions {
  board: Board;
  /** Runs the review agent, in the harness, model and effort of the "Code reviews" group. */
  runtime: AgentRuntime;
  agentSetting?: () => AgentSetting;
  workstations: Pick<CardWorkstations, 'diff'>;
  /** On a project with several repositories: the one whose cards these are. */
  repo?: string;
}

/** The code reviews of the cards of one repository: their agents while they run, and what the owner decides on their findings. */
export class CodeReviews {
  /** The review agent of each card while it runs, told apart from one before it by `run`; `told`: it heard of a restart that is due. */
  private running = new Map<string, { session?: AgentSession; run: object; told?: boolean }>();
  /** The cards whose review paused for a restart that is due, or waits for it to start: they go on once it happened, or is off. */
  private paused = new Set<string>();
  private restart: DueRestart | null = null;
  private shut = false;

  constructor(private o: CodeReviewOptions) {}

  /** The cards whose review agent is at work: a restart waits for them, as for workers in the middle of a turn. */
  busy(): string[] {
    return [...this.running.keys()];
  }

  /**
   * Seismic is about to restart (or no longer is): review agents at work hear so and pause, to go on
   * after it; a review that would start meanwhile waits for it. When it is off, the paused ones go on.
   */
  restartDue(due: DueRestart | null): void {
    this.restart = due;
    if (!due) {
      for (const cardId of [...this.paused]) this.resume(cardId);
      return;
    }
    for (const [cardId, r] of this.running) if (r.session && !r.told) this.tell(cardId, r);
  }

  /** The review agents stop with this repository's agents; a restart picks their reviews up. */
  shutdown(): void {
    this.shut = true;
    const sessions = [...this.running.values()].map((r) => r.session);
    this.running.clear();
    for (const s of sessions) s?.close();
  }

  /** After a restart: a review cut off by it, or paused for it, goes on; one about to start starts. One for work no longer waiting for approval failed. */
  interrupted(): void {
    for (const i of this.o.board.items()) {
      if (!i.review?.codeReview || (this.o.repo && i.repo !== this.o.repo)) continue;
      const c = codeReviewOf(this.o.board.row(i.id));
      if (c?.pending) {
        // git had not told the commit yet: the review starts now, as the handover would have started it
        if (this.waits(i.id)) {
          if (c.pendingStart) this.startPending(i.id, c);
          else void this.handedOver(i.id, c.handover, 'auto', true);
          continue;
        }
        const { pending: _, pendingStart: __, pendingId: ___, ...rest } = c;
        if (rest.review?.state === 'running') this.save(i.id, rest);
        else this.save(i.id, { ...rest, review: { handover: rest.handover, state: 'failed', error: this.o.board.t.worker.codeReviewInterrupted, at: new Date().toISOString() } });
      }
      if (this.running.has(i.id)) continue;
      const now = codeReviewOf(this.o.board.row(i.id));
      if (now?.review?.state !== 'running') continue;
      if (this.waits(i.id)) {
        this.o.board.log(i.id, 'state', 'seismic', this.o.board.t.worker.codeReviewResumed);
        this.resume(i.id);
      } else this.finish(i.id, null, undefined, this.o.board.t.worker.codeReviewInterrupted);
    }
    // items waiting under review after a review that is done (resubmitted as it ended, or carried over from an older list): the next review verifies them, in either mode
    for (const i of this.o.board.items()) {
      if (!i.review?.codeReview || (this.o.repo && i.repo !== this.o.repo) || this.running.has(i.id)) continue;
      const c = codeReviewOf(this.o.board.row(i.id));
      if (c?.review?.state === 'done' && !c.pending) this.verifyLeft(i.id, c.review.at);
    }
  }

  /**
   * The worker handed over (`handover`, its event): `mode` where the work is to be reviewed (the
   * project reviews work, and this work is in a git repository), else null. A review that has run on
   * the card (one the owner started where the project reviews no work, say) stays with its items for
   * the rest of the card's life, and goes on in manual mode; null drops only one that never ran.
   * What the owner had the worker fix goes under review now, and a review verifying it starts by
   * itself, in manual mode too. A review of the same commit stands for this handover too, unless it
   * resubmitted items; otherwise it is stale, and in `auto` a new one starts.
   */
  async handedOver(cardId: string, handover: number, given: CodeReviewMode | null, resumePending = false): Promise<void> {
    if (this.shut) return;
    const had = codeReviewOf(this.o.board.row(cardId));
    const mode = given ?? (had && this.ran(cardId, had) ? 'manual' : null);
    if (!mode) {
      this.stopSession(cardId);
      if (had) this.o.board.work(cardId, { review: { codeReview: null, items: [] } });
      return;
    }
    // A pending lookup has already resubmitted its handover's fixes; a verification lookup has no handover to resubmit.
    const resubmitted = resumePending ? [] : this.resubmit(cardId, this.items(cardId).filter((i) => i.status === 'fixing').map((i) => ({ number: i.number })), 'worker', handover).done;
    // verifying the fixes is the end of a review the card has: it starts by itself in manual mode too
    const starts = mode === 'auto' || this.items(cardId).some((i) => i.status === 'underReview');
    // the review starts once git has told the commit; until then the card already counts as under review
    const pendingId = crypto.randomUUID();
    if (starts && had) {
      const { pendingStart: _, ...rest } = had;
      this.save(cardId, { ...rest, mode: resumePending ? had.mode : mode, handover, pending: true, pendingId });
    }
    else if (starts) this.save(cardId, { mode, handover, pending: true, pendingId });
    this.paused.delete(cardId);
    const ws = this.o.board.row(cardId).workstation;
    // awaited also without a workstation: the handover is recorded before anything starts
    const head = await (ws ? gitAsync(ws, 'rev-parse', 'HEAD').catch(() => undefined) : Promise.resolve(undefined));
    if (this.shut || !this.o.board.item(cardId)) return;
    // a newer handover came while git answered: its own continuation decides, and keeps the card pending until then
    if (starts && codeReviewOf(this.o.board.row(cardId))?.pendingId !== pendingId) return;
    const now = codeReviewOf(this.o.board.row(cardId)) ?? had;
    let review = now?.review;
    // a review still running for an earlier commit is stale before it ends: it stops, and leaves nothing
    if (review?.state === 'running' && (!head || review.head !== head)) {
      this.stopSession(cardId);
      review = undefined;
    }
    // the same commit reviewed, or under review: the review stands for this handover, unless items wait under review that it does not verify
    const unverified = this.items(cardId).some((i) => i.status === 'underReview' && !(review?.state === 'running' && review.scope?.includes(i.number)));
    const same = !!review && !!head && review.head === head && !resubmitted.length && !unverified;
    if (review && same) review = { ...review, handover };
    const runs = now?.runs ?? (now?.review ? 1 : undefined);
    this.save(cardId, { mode: mode === 'auto' ? now?.mode ?? mode : mode, handover, ...(runs ? { runs } : {}), ...(review ? { review } : {}) });
    if (starts && !same) this.begin(cardId, head);
  }

  /**
   * The project's setting changed under work waiting for approval: `mode` where the work is reviewed
   * (null: not). Only the mode changes, and a card without a review gets the manual start; findings
   * stay as they are and nothing starts. Where there is no review now, one that has run stays in
   * manual mode, with its items (one at work stops); one that never ran is dropped.
   */
  applyMode(cardId: string, handover: number, mode: CodeReviewMode | null): void {
    const had = codeReviewOf(this.o.board.row(cardId));
    if (!mode) {
      if (!had) return;
      if (this.ran(cardId, had)) {
        this.cancel(cardId);
        const now = codeReviewOf(this.o.board.row(cardId));
        if (now && now.mode !== 'manual') this.save(cardId, { ...now, mode: 'manual' });
        return;
      }
      this.stopSession(cardId);
      this.o.board.work(cardId, { review: { codeReview: null, items: [] } });
    } else if (mode === 'manual' && !had) this.save(cardId, { mode, handover });
    else if (had && mode === 'manual' && had.mode !== mode) this.save(cardId, { ...had, mode });
  }

  /** Whether a review has run on the card, or is at work: its record and items are the card's for good. */
  private ran(cardId: string, c: StoredCodeReview): boolean {
    return !!c.review || !!c.runs || !!c.pending || this.items(cardId).length > 0;
  }

  /** Whether the card's work still waits for the owner's approval: a review that would start after the approval, or after the card stopped, does not. */
  private waits(cardId: string): boolean {
    if (!this.o.board.item(cardId)) return false;
    const row = this.o.board.row(cardId);
    return row.state === 'waiting' && !row.approved_at;
  }

  /**
   * "Start code review": a review of the card's latest handover starts, where it has none that stands
   * (or one that failed). `setting`: the agent the owner chose for it in place of the "Code reviews"
   * group's ("Select new agent" on a review stopped by its model's usage limit). Without a new
   * choice, "Try again" on that limit keeps the stopped run's agent.
   */
  start(cardId: string, handover?: number, setting?: AgentSetting): void {
    if (this.shut) throw new BadRequest('notReview', 'the reviewer is shutting down');
    // a card without a review (lost, or the project reviews no work) gets one on the owner's word, in manual mode
    const c = codeReviewOf(this.o.board.row(cardId)) ?? (handover === undefined ? null : ({ mode: 'manual', handover } satisfies StoredCodeReview));
    if (!c) throw new BadRequest('notReview', 'the card has no handover to review');
    if (c.pending) throw new BadRequest('notReview', 'the review is starting already');
    if (c.review?.handover === c.handover && c.review.state !== 'failed' && !this.items(cardId).some((i) => i.status === 'underReview')) throw new BadRequest('notReview', 'the latest handover is reviewed already');
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.codeReviewStarted);
    const { setting: _, ...was } = c;
    const pending = { ...was, ...(setting ? { setting } : {}), pending: true as const, pendingStart: true as const, pendingId: crypto.randomUUID() };
    this.save(cardId, pending);
    this.startPending(cardId, pending);
  }

  /** Start an explicitly requested review once Git answers, including after a restart. */
  private startPending(cardId: string, c: StoredCodeReview): void {
    const ws = this.o.board.row(cardId).workstation;
    void (ws ? gitAsync(ws, 'rev-parse', 'HEAD').catch(() => undefined) : Promise.resolve(undefined)).then((head) => {
      if (this.shut || !this.o.board.item(cardId)) return;
      const now = codeReviewOf(this.o.board.row(cardId));
      if (now?.pending && now.pendingStart && now.pendingId === c.pendingId && now.handover === c.handover && this.waits(cardId)) this.begin(cardId, head);
    });
  }

  /**
   * "Skip review" on a review its model's usage limit stopped: the run goes, the work waits for the
   * owner's approval without it, and "Start code review" offers one later. Its items stay.
   */
  skip(cardId: string): void {
    const c = codeReviewOf(this.o.board.row(cardId));
    if (!c?.review?.limited || c.review.state !== 'failed' || c.pending) throw new BadRequest('notReview', 'only a review stopped by the usage limit can be skipped');
    this.stopSession(cardId);
    const { review: _, setting: __, ...rest } = c;
    this.save(cardId, rest);
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.codeReviewSkipped);
  }

  /** The owner approved, or the card goes: a review still running stops, and leaves nothing. */
  cancel(cardId: string): void {
    const running = this.running.has(cardId);
    this.stopSession(cardId);
    const c = this.o.board.item(cardId) ? codeReviewOf(this.o.board.row(cardId)) : null;
    if (c?.pending || c?.review?.state === 'running' || (running && c?.review)) {
      const { pending: _, pendingStart: __, pendingId: ___, setting: ____, review, ...rest } = c;
      if (review?.state !== 'running' && !running) Object.assign(rest, { review });
      else if (review && !rest.runs) rest.runs = 1;
      this.save(cardId, rest);
    }
  }

  /** The items of the card's code review: its one running list across all review runs. */
  items(cardId: string): ReviewItem[] {
    return this.o.board.row(cardId).review?.items ?? [];
  }

  setItems(cardId: string, items: ReviewItem[]): void {
    this.o.board.work(cardId, { review: { items } });
  }

  /** The items the owner chose as follow-up tasks that have none yet. */
  owed(cardId: string): ReviewItem[] {
    return this.items(cardId).filter((i) => i.status === 'followUp' && !i.card);
  }

  /**
   * The worker resubmits items (by number, with a note) for the reviewer to verify: they go under
   * review. A note on one under review already joins its log; refuses one fixed, one under review
   * without a note, and a follow-up still owed its task. `done` are the items moved, `noted` those under review that got a note.
   */
  resubmit(cardId: string, entries: { number: number; note?: string }[], who: ReviewItemWho = 'worker', handover?: number): { done: ReviewItem[]; noted: ReviewItem[]; refused: string[] } {
    const items = this.items(cardId);
    const refused: string[] = [];
    const noted: number[] = [];
    let next = items;
    for (const e of entries) {
      const i = next.find((x) => x.number === e.number);
      if (!i) refused.push(`there is no item #${e.number}`);
      else if (i.status === 'underReview' && e.note) {
        next = moved(next, e.number, 'underReview', who, e.note, handover !== undefined ? { handover } : {});
        noted.push(i.number);
      } else if (i.status === 'underReview' || i.status === 'fixed') refused.push(`#${i.number} is ${i.status === 'fixed' ? 'fixed' : 'under review'} already`);
      // the task the owner chose for it is owed first: once made, the item can go to the reviewer
      else if (i.status === 'followUp' && !i.card) refused.push(`#${i.number} is to be a follow-up task first (follow_up_task)`);
      else next = moved(next, e.number, 'underReview', who, e.note, handover !== undefined ? { handover } : {});
    }
    if (next !== items) this.setItems(cardId, next);
    return { done: next.filter((i) => items.find((x) => x.number === i.number)?.status !== i.status), noted: next.filter((i) => noted.includes(i.number)), refused };
  }

  /** The worker holds an item wrong: it goes back to the owner as reopened, with why. Refuses an item the worker is not fixing. */
  dispute(cardId: string, entries: { number: number; note: string }[]): { done: ReviewItem[]; refused: string[] } {
    const items = this.items(cardId);
    const refused: string[] = [];
    let next = items;
    for (const e of entries) {
      const i = next.find((x) => x.number === e.number);
      if (!i) refused.push(`there is no item #${e.number}`);
      else if (i.status !== 'fixing') refused.push(`#${i.number} is not one you are fixing`);
      else next = moved(next, e.number, 'reopened', 'worker', e.note);
    }
    if (next !== items) this.setItems(cardId, next);
    return { done: next.filter((i) => items.find((x) => x.number === i.number)?.status !== i.status), refused };
  }

  /** The owner reopens an item that is closed or fixed: it needs them again. */
  reopen(cardId: string, number: number): void {
    const i = this.items(cardId).find((x) => x.number === number);
    if (!i) throw new BadRequest('noFinding', `there is no item ${number}`);
    if (i.status !== 'closed' && i.status !== 'fixed') throw new BadRequest('noFinding', `item ${number} is neither closed nor fixed`);
    this.setItems(cardId, moved(this.items(cardId), number, 'reopened', 'owner'));
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.findingDecided(i.number, i.title, this.o.board.t.worker.findingReopened));
  }

  /** The owner ignores items that need them: closed at once. Refuses an item that does not need them. */
  ignore(cardId: string, numbers: number[]): ReviewItem[] {
    const items = this.items(cardId);
    const named = numbers.map((n) => items.find((i) => i.number === n && needsOwner(i)));
    const missing = numbers.filter((_, k) => !named[k]);
    if (missing.length) throw new BadRequest('noFinding', `item ${missing.join(', ')} does not wait for you`);
    this.setItems(cardId, numbers.reduce((all, n) => moved(all, n, 'closed', 'owner'), items));
    return named as ReviewItem[];
  }

  /** A follow-up task the worker made of items: they are follow-ups linking it. */
  linkTask(cardId: string, numbers: number[], task: string, title: string): void {
    const items = this.items(cardId).map((i): ReviewItem => {
      if (!numbers.includes(i.number)) return i;
      return { ...i, status: 'followUp', card: task, log: [...i.log, { at: now(), who: 'worker', from: i.status, to: 'followUp', note: title }] };
    });
    this.setItems(cardId, items);
  }

  /**
   * What the owner decided for items of the card's code review (by number: fix it, or a follow-up
   * task), as the worker reads it above their words, with `notes`, the owner's context per item.
   * The items to fix are fixing now, until the worker's next handover resubmits them; those chosen
   * for later are follow-ups owed a task, which the worker makes (`follow_up_task`). The whole list
   * goes with it: to fix now, fixed, closed, follow-ups. Refuses an item that does not need the
   * owner, and "To contributor", which only a review card has.
   */
  decide(cardId: string, decisions: Record<number, ChangeRoute>, notes: Record<number, string> = {}): { note: string; log: string } {
    const c = codeReviewOf(this.o.board.row(cardId));
    if (!c) throw new BadRequest('notReview', 'the card has no code review to decide on');
    const t = this.o.board.t.worker;
    const items = this.items(cardId);
    const picked = Object.entries(decisions).map(([n, route]) => {
      const i = items.find((x) => x.number === Number(n) && needsOwner(x));
      if (!i) throw new BadRequest('noFinding', `item ${n} does not wait for you`);
      if (route === 'contributor') throw new BadRequest('noFinding', 'an item of a code review is fixed or made a follow-up task');
      return { i, route };
    });
    const next = picked.reduce((all, p) => {
      const context = notes[p.i.number]?.trim();
      const next = moved(all, p.i.number, p.route === 'self' ? 'fixing' : 'followUp', 'owner', undefined, {}, context);
      // context the owner cleared goes from the item
      return context === '' ? next.map((i) => (i.number === p.i.number ? (({ context: _, ...rest }) => rest)(i) : i)) : next;
    }, items);
    this.setItems(cardId, next);
    const after = (n: number) => next.find((x) => x.number === n)!;
    // the owner's context kept from an earlier choice goes with the item, unless this Send brings new context (which follows the note)
    const kept = (f: ReviewItem) => `${described(f)}${f.context && notes[f.number] === undefined ? `\n    The owner wrote: ${f.context}` : ''}`;
    const fix = picked.filter((p) => p.route === 'self').map((p) => after(p.i.number));
    const later = picked.filter((p) => p.route === 'later').map((p) => after(p.i.number));
    const ids = new Set(later.map((f) => f.number));
    // the review's own bundles, as far as they hold among the items the owner chose for later
    const bundles = [...new Set(later.map((f) => [f.number, ...(f.with ?? []).filter((x) => ids.has(x))].sort((a, b) => a - b)).filter((b) => b.length > 1).map((b) => b.join(' + ')))];
    const others = next.filter((i) => !fix.some((f) => f.number === i.number));
    const group = (title: string, of: ReviewItem[]) => (of.length ? `${title}\n${of.map((i) => `${described(i)}${i.context ? `\n    The owner wrote: ${i.context}` : ''}${i.card ? `\n    Follow-up task: ${i.card}` : ''}`).join('\n')}` : '');
    return {
      note: [
        "The owner decided on items of the code review of your work (a separate agent reviewed your branch's diff against main, and its one list of items runs across all reviews), on the card; do it now:",
        fix.length
          ? `- Fix these now:\n${fix.map(kept).join('\n')}\n  Find the cause of each and fix every place in its code path where the same kind of problem can happen, not only the spot named; the notes of an item that came back say what earlier rounds tried and why it did not hold. Run the checks, and hand over again (ready_for_review), with a new demo where the change shows; where nothing of it shows, the demo on the card stands. Your handover resubmits all of them to the reviewer, who verifies each against the item's own problem; resubmit with a note that says what you checked besides the named spot. An item you hold wrong: dispute_review_item with your reasons instead of changing the code, which takes it back to the owner.`
          : '',
        later.length
          ? `- As follow-up tasks:\n${later.map(kept).join('\n')}\n  Make them tasks of their own with follow_up_task, before anything else ends your turn. Items that belong together become one task: as the owner's words below say first (“2 and 3 together”, “combine them as you see fit”, “all separate”); without a word on it, ${bundles.length ? `as the review bundled them (${bundles.map((b) => `items ${b}`).join('; ')}), the others one each` : 'one task each'}. Write each task for the agent who will take it on and has seen neither your card nor the review: what is wrong and why, the files concerned, what done looks like.`
          : '',
        'The whole list of the review, for your context:',
        group('Fixed (the reviewer verified them):', others.filter((i) => i.status === 'fixed')),
        group('Closed (the owner ignored them; the review does not raise them again):', others.filter((i) => i.status === 'closed')),
        group('Follow-ups (handled as tasks of their own):', others.filter((i) => i.status === 'followUp' && !later.some((l) => l.number === i.number))),
        group('Others (waiting for the owner, or for the reviewer):', others.filter((i) => ['raised', 'reopened', 'underReview', 'fixing'].includes(i.status))),
        'If your work happens to fix an item that is closed or a follow-up, resubmit it with resubmit_review_item and a note: it goes to the reviewer too.',
      ]
        .filter(Boolean)
        .join('\n'),
      log: picked.map((p) => t.findingDecided(p.i.number, p.i.title, p.route === 'self' ? t.findingFix : t.findingLater)).join('\n'),
    };
  }

  /** A review of the card's latest handover, at `head`: its agent starts, any before it stops. */
  private begin(cardId: string, head: string | undefined): void {
    // approved or stopped while git told the commit: nothing starts
    if (this.shut || !this.waits(cardId)) return;
    const stored = codeReviewOf(this.o.board.row(cardId));
    if (!stored) return;
    const { pending: _, pendingStart, pendingId: __, setting: chosen, ...c } = stored;
    this.stopSession(cardId);
    const retry = pendingStart && !chosen && c.review?.limited ? c.review : undefined;
    const setting = chosen ?? this.settingFor(retry);
    const agent: AgentIdentity = { harness: setting.harness ?? 'claude', model: retry?.agent?.model ?? harnessChoice(setting).model };
    const next: NonNullable<StoredCodeReview['review']> = { handover: c.handover, ...(head ? { head } : {}), state: 'running', at: new Date().toISOString(), agent, setting };
    this.save(cardId, { ...c, runs: (c.runs ?? (c.review ? 1 : 0)) + 1, review: next });
    // a restart that is due would cut it off: it starts once Seismic runs again
    if (this.restart) return void this.paused.add(cardId);
    this.launch(cardId, next);
  }

  private settingFor(review?: StoredCodeReview['review']): AgentSetting {
    if (review?.setting) return review.setting;
    const fallback = this.o.agentSetting?.() ?? AGENT_DEFAULTS.review;
    // Older reviews stored the setting only for overrides and omitted the model for account defaults.
    if (!review?.agent) return fallback;
    const { harness, model } = review.agent;
    const setting = harness === (fallback.harness ?? 'claude') ? fallback : { ...AGENT_DEFAULTS.review, harness };
    if (model && model !== 'default') return setting;
    return harness === 'claude' ? { ...setting, model: 'default' } : { ...setting, [harness]: { ...harnessChoice(setting), model: 'default' } };
  }

  /** The card's running review goes on: its agent's session where it has one, else a review from the start. */
  private resume(cardId: string): void {
    this.paused.delete(cardId);
    if (this.shut || !this.waits(cardId) || this.running.has(cardId)) return;
    const c = codeReviewOf(this.o.board.row(cardId));
    let review = c?.review;
    if (!c || review?.state !== 'running') return;
    if (this.restart) return void this.paused.add(cardId);
    if (!review.setting || !review.agent?.model) {
      const setting = this.settingFor(review);
      const agent = { harness: setting.harness ?? 'claude', model: review.agent?.model ?? harnessChoice(setting).model } satisfies AgentIdentity;
      review = { ...review, setting, agent };
      this.save(cardId, { ...c, review });
    }
    // a session without the scope of its brief cannot have its verdicts checked against it: the review starts over
    this.launch(cardId, review, review.scope ? review.session : undefined);
  }

  private launch(cardId: string, review: NonNullable<StoredCodeReview['review']>, resume?: string): void {
    const run = {};
    this.running.set(cardId, { run });
    // the Workstations pill counts its agent at work
    this.o.board.changed();
    const setting = this.settingFor(review);
    const model = review.agent?.model;
    const resolvedModel = model && model !== 'default' && model !== harnessChoice(setting).model ? model : undefined;
    void this.run(cardId, run, setting, resolvedModel, resume).catch((e) => this.finish(cardId, run, undefined, messageOf(e)));
  }

  /** The review agent at work hears that a restart is due, and pauses for it. */
  private tell(cardId: string, r: { session?: AgentSession; told?: boolean }): void {
    r.told = true;
    r.session?.send(restartNotice);
    this.o.board.log(cardId, 'state', 'seismic', this.o.board.t.worker.codeReviewPaused);
  }

  /** The review agent `run` ended its turn for the restart without findings: its session waits to go on after it. */
  private pause(cardId: string, run: object): void {
    if (this.running.get(cardId)?.run !== run) return;
    this.running.delete(cardId);
    this.paused.add(cardId);
    // the Workstations pill no longer counts its agent at work
    this.o.board.changed();
    // the restart was called off meanwhile: it goes on at once
    if (!this.restart) this.resume(cardId);
  }

  private async run(cardId: string, run: object, setting: AgentSetting, resolvedModel: string | undefined, resume?: string): Promise<void> {
    const b = this.o.board;
    const row = b.row(cardId);
    const ws = row.workstation;
    const diff = ws && !resume ? await this.o.workstations.diff(cardId, true).catch(() => null) : null;
    if (this.running.get(cardId)?.run !== run) return;
    if (!ws || (!resume && !diff?.patch)) return this.finish(cardId, run, undefined, b.t.worker.codeReviewNoDiff);
    const card = b.item(cardId);
    const handoverSummary = b.summary(cardId);
    const items = this.items(cardId);
    // the items this run verifies: those under review when its brief was written, kept for a resumed session; one resubmitted meanwhile waits for the next review
    const stored = codeReviewOf(b.row(cardId))?.review;
    const scope = resume && stored?.scope ? stored.scope : items.filter((i) => i.status === 'underReview').map((i) => i.number);
    if (!resume && stored?.state === 'running') this.save(cardId, { ...codeReviewOf(b.row(cardId))!, review: { ...stored, scope } });
    const language = `${LANGUAGE_NAMES[b.conversation()]} unless an explicit standing preference names another language`;
    let recorded: Recorded | undefined;
    let ended = false;
    const patch = diff?.patch && diff.patch.length > DIFF_LIMIT ? `${diff.patch.slice(0, DIFF_LIMIT)}\n… (cut off here: read the rest of the changed files yourself)` : diff?.patch;
    let session: AgentSession | undefined;
    const end = (error?: string, limited = false) => {
      if (ended) return;
      ended = true;
      session?.close();
      const r = this.running.get(cardId);
      // a session that does not resume (gone, or another harness now): the review starts over
      if (resume && error && !limited && !recorded && r?.run === run) {
        this.running.delete(cardId);
        const c = codeReviewOf(b.row(cardId));
        if (c?.review?.state === 'running') {
          const { session: _, ...review } = c.review;
          this.save(cardId, { ...c, review });
        }
        return this.resume(cardId);
      }
      if (!recorded && !error && r?.run === run && r.told) return this.pause(cardId, run);
      this.finish(cardId, run, recorded, error, limited);
    };
    session = reviewerAgent.start(
      this.o.runtime,
      {
        setting,
        resolvedModel,
        language,
        preferences: b.preferencesText(),
        resumed: !!resume,
        ...(card ? { card: { title: card.title, body: card.body } } : {}),
        summary: handoverSummary,
        files: diff?.files ?? [],
        truncated: !!diff?.truncated,
        patch,
        itemsText: listed(items),
        maxNewItems: MAX_NEW_ITEMS,
        nextNumber: nextNumber(items),
        record: (given) => {
          const wrong = checkRecorded(this.items(cardId), scope, given);
          if (wrong) return wrong;
          recorded = given;
        },
      },
      {
        cwd: ws,
        ...(resume ? { resume } : {}),
        onEvent: (e) => {
          if (e.type === 'session' && this.running.get(cardId)?.run === run) {
            const c = codeReviewOf(b.row(cardId));
            const model = e.model ?? (e.setting ? harnessChoice(e.setting).model : undefined);
            const named = model && model !== 'default' && c?.review?.agent?.model !== model;
            if (c?.review?.state === 'running' && (named || c.review.session !== e.id))
              this.save(cardId, { ...c, review: { ...c.review, session: e.id, ...(named ? { agent: { harness: setting.harness ?? 'claude', model } } : {}) } });
          }
          if (e.type === 'idle') end();
          else if (e.type === 'error') end(e.message, !!e.limit);
        },
      },
    );
    if (ended) return session.close();
    if (this.running.get(cardId)?.run !== run) return session.close();
    const r = { session, run };
    this.running.set(cardId, r);
    if (this.restart) this.tell(cardId, r);
  }

  /**
   * The review agent `run` ended (null: one a restart cut off): done with the review it recorded
   * (verdicts on the items under review, regressions, new items), else failed, with why. A run
   * stopped since, and a later review in its place, are left alone.
   */
  private finish(cardId: string, run: object | null, recorded: Recorded | undefined, error?: string, limited = false): void {
    if (run) {
      if (this.running.get(cardId)?.run !== run) return;
      this.running.delete(cardId);
      this.o.board.changed();
    }
    if (!this.o.board.item(cardId)) return;
    const stored = codeReviewOf(this.o.board.row(cardId));
    if (!stored?.review || stored.review.state !== 'running') return;
    // a newer handover still waiting for its review decision keeps its pending mark
    const c = { ...stored, review: stored.review };
    const t = this.o.board.t.worker;
    const failed = recorded ? undefined : clip(oneLine(error ?? t.codeReviewNoFindings), 300);
    this.paused.delete(cardId);
    const { session: _, scope: __, ...review } = c.review;
    let result = { items: undefined as ReviewItem[] | undefined, raised: [] as ReviewItem[], fixed: 0, reopened: 0 };
    if (recorded) result = this.apply(cardId, recorded, { handover: review.handover, run: review.at });
    // the list and the run's end are one write: a stop between them would resume a run whose results are already applied
    const done: StoredCodeReview = { ...c, review: { ...review, state: failed ? 'failed' : 'done', ...(failed ? { error: failed } : {}), ...(failed && limited ? { limited: true as const } : {}) } };
    this.o.board.work(cardId, { review: { codeReview: done, ...(result.items ? { items: result.items } : {}) } });
    const count = (s: Severity) => result.raised.filter((f) => f.severity === s).length;
    this.o.board.log(cardId, 'state', 'seismic', failed ? t.codeReviewFailed(failed) : t.codeReviewDone(result.raised.length, Object.fromEntries(SEVERITIES.map((s) => [s, count(s)])) as Record<Severity, number>, result.fixed, result.reopened));
    // items the worker resubmitted while it ran were not in its brief: the next review verifies them now
    if (!failed) this.verifyLeft(cardId, review.at);
  }

  /** Items still under review after the review run `at` is done get the next review, in either mode: verifying them is part of the review. */
  private verifyLeft(cardId: string, at: string): void {
    if (this.shut) return;
    const c = codeReviewOf(this.o.board.row(cardId));
    if (!c || c.pending || c.review?.at !== at || !this.waits(cardId) || !this.items(cardId).some((i) => i.status === 'underReview')) return;
    const pendingId = crypto.randomUUID();
    this.save(cardId, { ...c, pending: true, pendingId });
    const ws = this.o.board.row(cardId).workstation;
    void (ws ? gitAsync(ws, 'rev-parse', 'HEAD').catch(() => undefined) : Promise.resolve(undefined)).then((head) => {
      if (this.shut || !this.o.board.item(cardId)) return;
      const now = codeReviewOf(this.o.board.row(cardId));
      if (!now?.pending || now.pendingId !== pendingId || now.handover !== c.handover || now.review?.at !== at) return;
      if (!this.waits(cardId) || !this.items(cardId).some((i) => i.status === 'underReview')) {
        const { pending: _, pendingId: __, ...rest } = now;
        this.save(cardId, rest);
        return;
      }
      this.begin(cardId, head);
    });
  }

  /** A worker may resubmit an item and finish with a reply instead of a handover. */
  workerFinished(cardId: string): void {
    const c = codeReviewOf(this.o.board.row(cardId));
    if ((c?.review?.state === 'done' || c?.review?.state === 'failed') && !c.pending) this.verifyLeft(cardId, c.review.at);
  }

  /**
   * The recorded review applied to the list as it stands now: a verdict moves an item that is still
   * under review to fixed or reopened, a regression a fixed one to reopened, and the new items take
   * the next free numbers. Returns the new list; the caller saves it. What changed under the review (the owner closed an item meanwhile) is left as it is.
   */
  private apply(cardId: string, r: Recorded, at: { handover: number; run: string }): { items: ReviewItem[]; raised: ReviewItem[]; fixed: number; reopened: number } {
    let items = this.items(cardId);
    let fixed = 0;
    let reopened = 0;
    for (const v of r.verdicts) {
      if (items.find((i) => i.number === v.number)?.status !== 'underReview') continue;
      items = moved(items, v.number, v.fixed ? 'fixed' : 'reopened', 'reviewer', v.why?.trim() ? clip(v.why.trim(), 1000) : undefined, at);
      if (v.fixed) fixed++;
      else reopened++;
    }
    for (const g of r.regressions) {
      if (items.find((i) => i.number === g.number)?.status !== 'fixed') continue;
      items = moved(items, g.number, 'reopened', 'reviewer', clip(g.why.trim(), 1000), at);
      reopened++;
    }
    const first = nextNumber(items);
    const given = r.items;
    const fresh = given.map(
      (g, k): ReviewItem => ({
        number: first + k,
        title: clip(String(g.title).trim(), 120),
        text: clip(String(g.text).trim(), 2000),
        severity: SEVERITIES.includes(g.severity) ? g.severity : 'minor',
        ...(g.file?.trim() ? { file: clip(g.file.trim(), 300) } : {}),
        ...(g.file?.trim() && g.line ? { line: g.line } : {}),
        ...(g.security ? { security: true } : {}),
        status: 'raised',
        log: [{ at: now(), who: 'reviewer', to: 'raised', ...at }],
      }),
    );
    // bundles hold across the whole list, in both directions: the new items may name old ones
    const all = bundled(
      [...items, ...fresh],
      [...items.map((i) => [i.number, i.with ?? []] as [number, number[]]), ...given.map((g, k) => [first + k, g.with ?? []] as [number, number[]])],
    );
    const raised = all.slice(items.length);
    return { items: all, raised, fixed, reopened };
  }

  private stopSession(cardId: string): void {
    this.paused.delete(cardId);
    const r = this.running.get(cardId);
    this.running.delete(cardId);
    if (r) this.o.board.changed();
    r?.session?.close();
  }

  private save(cardId: string, c: StoredCodeReview | null): void {
    this.o.board.work(cardId, { review: { codeReview: c } });
  }
}

export type Given = { title: string; text: string; severity: Severity; file?: string; line?: number; security?: boolean; with?: number[] };
export type Recorded = { verdicts: { number: number; fixed: boolean; why?: string }[]; regressions: { number: number; why: string }[]; items: Given[] };

const now = () => new Date().toISOString();

/** The next free number of the list: across all items, closed ones too. */
const nextNumber = (items: ReviewItem[]) => items.reduce((n, i) => Math.max(n, i.number), 0) + 1;

/**
 * Why a recorded review cannot be taken, or nothing: a verdict for an item outside the run's
 * `scope` (those under review when its brief was written), none for one inside it, two verdicts
 * or two regressions on the same item, a regression of one that is not fixed, a verdict of not fixed
 * or a regression without why, more new items than `MAX_NEW_ITEMS`.
 */
function checkRecorded(items: ReviewItem[], scope: number[], r: Recorded): string | undefined {
  const status = (n: number) => items.find((i) => i.number === n)?.status;
  const named = new Set(r.verdicts.map((v) => v.number));
  const twice = (ns: number[]) => [...new Set(ns.filter((n, i) => ns.indexOf(n) !== i))];
  const doubled = twice(r.verdicts.map((v) => v.number));
  const regressedTwice = twice(r.regressions.map((g) => g.number));
  if (doubled.length || regressedTwice.length)
    return [
      doubled.length && `${doubled.map((n) => `#${n}`).join(', ')} ${doubled.length === 1 ? 'has' : 'have'} more than one verdict; give one verdict for each item.`,
      regressedTwice.length && `${regressedTwice.map((n) => `#${n}`).join(', ')} ${regressedTwice.length === 1 ? 'is' : 'are'} named more than once among the regressions; name each item once.`,
    ]
      .filter(Boolean)
      .join(' ');
  const stray = r.verdicts.filter((v) => !scope.includes(v.number)).map((v) => v.number);
  if (stray.length) return `${stray.map((n) => `#${n}`).join(', ')} ${stray.length === 1 ? 'is' : 'are'} not under review in your brief, so a verdict on ${stray.length === 1 ? 'it' : 'them'} is not taken.`;
  const missing = scope.filter((n) => !named.has(n));
  if (missing.length) return `there is no verdict on ${missing.map((n) => `#${n}`).join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} under review.`;
  const odd = r.regressions.filter((g) => status(g.number) !== 'fixed').map((g) => g.number);
  if (odd.length) return `${odd.map((n) => `#${n}`).join(', ')} ${odd.length === 1 ? 'is' : 'are'} not marked fixed, so a regression of ${odd.length === 1 ? 'it' : 'them'} is not taken.`;
  const bare = [...r.verdicts.filter((v) => !v.fixed && !v.why?.trim()), ...r.regressions.filter((g) => !g.why?.trim())].map((x) => x.number);
  if (bare.length) return `${bare.map((n) => `#${n}`).join(', ')} ${bare.length === 1 ? 'needs' : 'need'} why: say what is still wrong.`;
  if (r.items.length > MAX_NEW_ITEMS) return `${r.items.length} new items are more than the ${MAX_NEW_ITEMS} a review takes: keep the most important ones, merging or leaving out the least important.`;
  return undefined;
}

/**
 * The item moved to `to`, with its log entry (`who`, `note`, the handover or run it came at);
 * `context` is what the owner wrote on it. The list as it was where the item is not there.
 */
export function moved(items: ReviewItem[], number: number, to: ReviewItemStatus, who: ReviewItemWho, note?: string, at: { handover?: number; run?: string } = {}, context?: string): ReviewItem[] {
  return items.map((i) =>
    i.number !== number
      ? i
      : { ...i, status: to, ...(context ? { context } : {}), log: [...i.log, { at: now(), who, from: i.status, to, ...(note ? { note } : {}), ...(at.handover !== undefined ? { handover: at.handover } : {}), ...(at.run ? { run: at.run } : {}) }] },
  );
}

/**
 * Each item's bundle: the items named together with it (`named`, by number), in both directions
 * and across a chain, kept as `with` on each of them.
 */
export function bundled(items: ReviewItem[], named: [number, number[]][]): ReviewItem[] {
  const root = new Map(items.map((f) => [f.number, f.number]));
  const find = (n: number): number => (root.get(n) === n ? n : find(root.get(n)!));
  for (const [n, others] of named) for (const o of others) if (root.has(o) && root.has(n)) root.set(find(o), find(n));
  return items.map((f) => {
    const { with: _, ...rest } = f;
    const w = items.filter((o) => o.number !== f.number && find(o.number) === find(f.number)).map((o) => o.number);
    return w.length ? { ...rest, with: w } : rest;
  });
}

const where = (f: ReviewItem) => (f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '');

/** An item as the worker reads it in the owner's decision. */
export const described = (f: ReviewItem, viewer: ReviewItemWho = 'worker') => `  #${f.number} “${f.title}” (${[f.severity, where(f)].filter(Boolean).join(', ')}): ${f.text}${lastNote(f, viewer)}`;

/** How often the item came back to the owner: reopened by the reviewer, the worker or the owner. */
export const reopenings = (f: ReviewItem) => f.log.filter((x) => x.to === 'reopened').length;

/**
 * Why an item came back and what the worker said of its fixes, where its log says, as `viewer`
 * reads it: every note of a reopening or resubmission, oldest first, so a reopened item shows what
 * each earlier round tried and why it did not hold.
 */
const lastNote = (f: ReviewItem, viewer: ReviewItemWho = 'worker') => {
  const notes = f.log.filter((x) => x.note && (x.to === 'reopened' || x.to === 'underReview'));
  const said = (e: (typeof notes)[number]) => `${e.who === viewer ? 'You' : `The ${e.who}`} wrote: ${e.note}`;
  if (notes.length <= 1) return notes.length ? `\n    ${said(notes[0]!)}` : '';
  return `\n    Earlier rounds on this item (oldest first):${notes.map((e) => `\n      - ${said(e)}`).join('')}`;
};

/** The review's list as the review agent reads it in its brief: every item with its status, by what the review has to do with it. */
export function listed(items: ReviewItem[]): string {
  if (!items.length) return 'The running list of this work\'s review items is empty: nothing was raised before.';
  const of = (...s: ReviewItemStatus[]) => items.filter((i) => s.includes(i.status));
  const full = (i: ReviewItem) => `${described(i, 'reviewer')}${reopenings(i) ? `\n    Reopened ${reopenings(i)} time${reopenings(i) === 1 ? '' : 's'} before.` : ''}${i.context ? `\n    The owner wrote: ${i.context}` : ''}`.replace(/^ {2}/, '- ');
  const short = (i: ReviewItem) => `- #${i.number} “${i.title}” (${[i.severity, where(i)].filter(Boolean).join(', ')}): ${i.text}`;
  const part = (title: string, rows: ReviewItem[], one: (i: ReviewItem) => string) => (rows.length ? `${title}\n${rows.map(one).join('\n')}` : '');
  return [
    'The running list of review items of this work, numbered across all earlier reviews, with their statuses:',
    part('Under review (the worker resubmitted them as fixed; give each a verdict, from the code as it is now):', of('underReview'), full),
    part('Fixed (an earlier review verified them; report one as a regression only where the diff shows its problem again):', of('fixed'), full),
    part('Raised or reopened (waiting for the owner; do not raise them again):', of('raised', 'reopened'), short),
    part('Fixing (the worker is on them; leave them out):', of('fixing'), short),
    part('Closed (the owner ignored them; do not raise them or anything like them again):', of('closed'), short),
    part('Follow-ups (handled as tasks of their own; do not raise them again):', of('followUp'), short),
  ]
    .filter(Boolean)
    .join('\n\n');
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
