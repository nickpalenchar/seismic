// The code review of a card's work where its project reviews work that lands on main (design: Code
// reviews in Card lifecycle): a separate, read-only agent of the "Code reviews" group reads the
// branch's diff against main the repository's way and records graded findings,
// which the card shows in its Review tab. It starts with each handover (`auto`) or on the
// owner's "Start code review" (`manual`); a handover that changes the branch makes the review
// before it stale. On its open findings the owner decides "Fix it" (the card's worker fixes them)
// or "As a follow-up task", with the card's one Send, as on a review card.

import { z } from 'zod';
import { BadRequest, type Board, codeReviewOf, type StoredCodeReview } from './board';
import { type AgentRuntime, type AgentSession, type AgentTool, waitQuietly } from './runtime';
import { gitAsync } from './workstations';
import type { CardWorkstations } from './workstations';
import { harnessChoice, type AgentSetting, type AgentIdentity, type ChangeRoute, type CodeReviewMode, type Finding, type Severity, SEVERITIES } from '../core/types';
import { LANGUAGE_NAMES } from '../core/locale';
import { clip, messageOf } from '../core/text';
import type { DueRestart } from './workers';

/** How much of the diff the review agent gets in its brief; it reads the files themselves beyond that. */
const DIFF_LIMIT = 150_000;
const MAX_FINDINGS = 30;
/** How many ignored findings of earlier reviews the next review is told of, the latest kept. */
const MAX_IGNORED = 60;

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
          void this.handedOver(i.id, c.handover, c.mode);
          continue;
        }
        const { pending: _, ...rest } = c;
        if (rest.review?.state === 'running') this.save(i.id, rest);
        else {
          const previous = [...(rest.previous ?? []), ...(rest.review ? [rest.review] : [])];
          this.save(i.id, { ...rest, ...(previous.length ? { previous } : {}), review: { handover: rest.handover, state: 'failed', findings: [], error: this.o.board.t.worker.codeReviewInterrupted, at: new Date().toISOString() } });
        }
      }
      if (this.running.has(i.id)) continue;
      const now = codeReviewOf(this.o.board.row(i.id));
      if (now?.review?.state !== 'running') continue;
      if (this.waits(i.id)) {
        this.o.board.log(i.id, 'state', 'obeya', this.o.board.t.worker.codeReviewResumed);
        this.resume(i.id);
      } else this.finish(i.id, null, undefined, this.o.board.t.worker.codeReviewInterrupted);
    }
  }

  /**
   * The worker handed over (`handover`, its event): `mode` where the work is to be reviewed (the
   * project reviews work, and this work lands on main), else null, which drops a review the card had.
   * What the owner had the worker fix counts as fixed now. A review of the same commit stands for
   * this handover too; otherwise it is stale, and in `auto` a new one starts.
   */
  async handedOver(cardId: string, handover: number, mode: CodeReviewMode | null): Promise<void> {
    const had = codeReviewOf(this.o.board.row(cardId));
    if (!mode) {
      this.stopSession(cardId);
      if (had) this.save(cardId, null);
      return;
    }
    // the review starts once git has told the commit; until then the card already counts as under review
    if (mode === 'auto' && had) this.save(cardId, { ...had, mode, handover, pending: true });
    else if (mode === 'auto') this.save(cardId, { mode, handover, pending: true });
    this.paused.delete(cardId);
    const ws = this.o.board.row(cardId).workstation;
    // awaited also without a workstation: the handover is recorded before anything starts
    const head = await (ws ? gitAsync(ws, 'rev-parse', 'HEAD').catch(() => undefined) : Promise.resolve(undefined));
    if (!this.o.board.item(cardId)) return;
    // a newer handover came while git answered: its own continuation decides, and keeps the card pending until then
    if (mode === 'auto' && codeReviewOf(this.o.board.row(cardId))?.handover !== handover) return;
    const now = codeReviewOf(this.o.board.row(cardId)) ?? had;
    let review = now?.review;
    // a review still running for an earlier commit is stale before it ends: it stops, and leaves nothing
    if (review?.state === 'running' && (!head || review.head !== head)) {
      this.stopSession(cardId);
      review = undefined;
    }
    if (review) review = { ...review, findings: review.findings.map((f) => (f.status === 'open' && f.decided === 'self' ? settled(f, 'fixed') : f)) };
    // the same commit reviewed, or under review: the review stands for this handover
    const same = !!review && !!head && review.head === head;
    if (review && same) review = { ...review, handover };
    this.save(cardId, { mode, handover, ...(now?.ignored ? { ignored: now.ignored } : {}), ...(now?.previous ? { previous: now.previous } : {}), ...(review ? { review } : {}) });
    if (mode === 'auto' && !same) this.begin(cardId, head);
  }

  /**
   * The project's setting changed under work waiting for approval: `mode` where the work is reviewed
   * (null: not). Only the mode changes, a review the card had is dropped where there is none now, and
   * a card without one gets the manual start; findings stay as they are and nothing starts.
   */
  applyMode(cardId: string, handover: number, mode: CodeReviewMode | null): void {
    const had = codeReviewOf(this.o.board.row(cardId));
    if (!mode) {
      if (!had) return;
      this.stopSession(cardId);
      this.save(cardId, null);
    } else if (mode === 'manual' && !had) this.save(cardId, { mode, handover });
    else if (had && mode === 'manual' && had.mode !== mode) this.save(cardId, { ...had, mode });
  }

  /** Whether the card's work still waits for the owner's approval: a review that would start after the approval, or after the card stopped, does not. */
  private waits(cardId: string): boolean {
    if (!this.o.board.item(cardId)) return false;
    const row = this.o.board.row(cardId);
    return row.state === 'waiting' && !row.approved_at;
  }

  /** "Start code review": a review of the card's latest handover starts, where it has none that stands (or one that failed). */
  start(cardId: string): void {
    const c = codeReviewOf(this.o.board.row(cardId));
    if (!c) throw new BadRequest('notReview', 'the card has no code review: its project reviews no work, or its work does not land on main');
    if (c.review?.handover === c.handover && c.review.state !== 'failed') throw new BadRequest('notReview', 'the latest handover is reviewed already');
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.codeReviewStarted);
    const ws = this.o.board.row(cardId).workstation;
    void (ws ? gitAsync(ws, 'rev-parse', 'HEAD').catch(() => undefined) : Promise.resolve(undefined)).then((head) => this.begin(cardId, head));
  }

  /** The owner approved, or the card goes: a review still running stops, and leaves nothing. */
  cancel(cardId: string): void {
    const running = this.running.has(cardId);
    this.stopSession(cardId);
    const c = this.o.board.item(cardId) ? codeReviewOf(this.o.board.row(cardId)) : null;
    if (c?.review?.state === 'running' || (running && c?.review)) {
      const { review: _, ...rest } = c;
      this.save(cardId, rest);
    }
  }

  /** The findings of the card's latest review, and saving them changed: what the worker's follow-up tasks settle. */
  findings(cardId: string): Finding[] | undefined {
    return codeReviewOf(this.o.board.row(cardId))?.review?.findings;
  }

  setFindings(cardId: string, findings: Finding[]): void {
    const c = codeReviewOf(this.o.board.row(cardId));
    if (c?.review) this.save(cardId, { ...c, review: { ...c.review, findings } });
  }

  /**
   * What the owner decided for findings of the card's code review (by number: fix it, or a
   * follow-up task), as the worker reads it above their words. Each is marked as decided until the
   * worker's next handover (fixed) or its follow-up task (`later`). Refuses a finding that is not
   * open, and "To contributor", which only a review card has.
   */
  decide(cardId: string, decisions: Record<number, ChangeRoute>): { note: string; log: string } {
    const c = codeReviewOf(this.o.board.row(cardId));
    if (!c?.review) throw new BadRequest('notReview', 'the card has no code review to decide on');
    const t = this.o.board.t.worker;
    const picked = Object.entries(decisions).map(([id, route]) => {
      const f = c.review!.findings.find((x) => x.id === Number(id) && x.status === 'open' && !x.decided);
      if (!f) throw new BadRequest('noFinding', `finding ${id} is not open`);
      if (route === 'contributor') throw new BadRequest('noFinding', 'a finding of a code review is fixed or made a follow-up task');
      return { f, route };
    });
    const findings = c.review.findings.map((f): Finding => {
      const p = picked.find((x) => x.f.id === f.id);
      return p ? { ...f, decided: p.route } : f;
    });
    this.save(cardId, { ...c, review: { ...c.review, findings } });
    const fix = picked.filter((p) => p.route === 'self').map((p) => p.f);
    const later = picked.filter((p) => p.route === 'later').map((p) => p.f);
    const ids = new Set(later.map((f) => f.id));
    // the review's own bundles, as far as they hold among the findings the owner chose for later
    const bundles = [...new Set(later.map((f) => [f.id, ...(f.with ?? []).filter((x) => ids.has(x))].sort((a, b) => a - b)).filter((b) => b.length > 1).map((b) => b.join(' + ')))];
    return {
      note: [
        "The owner decided on findings of the code review of your work (a separate agent reviewed your branch's diff against main), on the card; do it now:",
        fix.length
          ? `- Fix them:\n${fix.map(described).join('\n')}\n  Fix them on your branch, run the checks, and hand over again (ready_for_review), with a new demo where the change shows; where nothing of it shows, the demo on the card stands. A finding that turns out wrong: say why in your handover instead of changing the code.`
          : '',
        later.length
          ? `- As follow-up tasks:\n${later.map(described).join('\n')}\n  Make them tasks of their own with follow_up_task, before anything else ends your turn. Findings that belong together become one task: as the owner's words below say first (“2 and 3 together”, “combine them as you see fit”, “all separate”); without a word on it, ${bundles.length ? `as the review bundled them (${bundles.map((b) => `findings ${b}`).join('; ')}), the others one each` : 'one task each'}. Write each task for the agent who will take it on and has seen neither your card nor the review: what is wrong and why, the files concerned, what done looks like.`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      log: picked.map((p) => t.findingDecided(p.f.id, p.f.title, p.route === 'self' ? t.findingFix : t.findingLater)).join('\n'),
    };
  }

  /** A review of the card's latest handover, at `head`: its agent starts, any before it stops. */
  private begin(cardId: string, head: string | undefined): void {
    // approved or stopped while git told the commit: nothing starts
    if (!this.waits(cardId)) return;
    const stored = codeReviewOf(this.o.board.row(cardId));
    if (!stored) return;
    const { pending: _, ...c } = stored;
    this.stopSession(cardId);
    // what the owner ignored in the review this one replaces stays known to every review after it
    const dropped = (c.review?.findings ?? []).filter((f) => f.status === 'dropped').map(({ title, text, file, line }) => ({ title, text, ...(file ? { file } : {}), ...(line ? { line } : {}) }));
    const ignored = [...(c.ignored ?? []), ...dropped].slice(-MAX_IGNORED);
    const setting = this.o.agentSetting?.();
    const choice = setting && harnessChoice(setting);
    const agent: AgentIdentity | undefined = setting && { harness: setting.harness ?? 'claude', ...(choice?.model && choice.model !== 'default' ? { model: choice.model } : {}) };
    const previous = [...(c.previous ?? []), ...(c.review && c.review.state !== 'running' ? [c.review] : [])];
    this.save(cardId, { ...c, ...(ignored.length ? { ignored } : {}), ...(previous.length ? { previous } : {}), review: { handover: c.handover, ...(head ? { head } : {}), state: 'running', findings: [], at: new Date().toISOString(), ...(agent ? { agent } : {}) } });
    // a restart that is due would cut it off: it starts once Seismic runs again
    if (this.restart) return void this.paused.add(cardId);
    this.launch(cardId, setting);
  }

  /** The card's running review goes on: its agent's session where it has one, else a review from the start. */
  private resume(cardId: string): void {
    this.paused.delete(cardId);
    if (this.shut || !this.waits(cardId) || this.running.has(cardId)) return;
    const c = codeReviewOf(this.o.board.row(cardId));
    if (c?.review?.state !== 'running') return;
    if (this.restart) return void this.paused.add(cardId);
    this.launch(cardId, this.o.agentSetting?.(), c.review.session);
  }

  private launch(cardId: string, setting: AgentSetting | undefined, resume?: string): void {
    const run = {};
    this.running.set(cardId, { run });
    void this.run(cardId, run, setting, resume).catch((e) => this.finish(cardId, run, undefined, messageOf(e)));
  }

  /** The review agent at work hears that a restart is due, and pauses for it. */
  private tell(cardId: string, r: { session?: AgentSession; told?: boolean }): void {
    r.told = true;
    r.session?.send(RESTART_NOTICE);
    this.o.board.log(cardId, 'state', 'obeya', this.o.board.t.worker.codeReviewPaused);
  }

  /** The review agent `run` ended its turn for the restart without findings: its session waits to go on after it. */
  private pause(cardId: string, run: object): void {
    if (this.running.get(cardId)?.run !== run) return;
    this.running.delete(cardId);
    this.paused.add(cardId);
    // the restart was called off meanwhile: it goes on at once
    if (!this.restart) this.resume(cardId);
  }

  private async run(cardId: string, run: object, setting?: AgentSetting, resume?: string): Promise<void> {
    const b = this.o.board;
    const row = b.row(cardId);
    const ws = row.workstation;
    const diff = ws && !resume ? await this.o.workstations.diff(cardId, true).catch(() => null) : null;
    if (this.running.get(cardId)?.run !== run) return;
    if (!ws || (!resume && !diff?.patch)) return this.finish(cardId, run, undefined, b.t.worker.codeReviewNoDiff);
    const card = b.item(cardId);
    const history = codeReviewOf(row);
    const ignored = history?.ignored ?? [];
    const followups = (history?.previous ?? []).flatMap((r) => r.findings).filter((f) => f.status === 'later' || (f.status === 'open' && f.decided === 'later'));
    const language = `${LANGUAGE_NAMES[b.conversation()]} unless an explicit standing preference names another language`;
    let recorded: Finding[] | undefined;
    let ended = false;
    const patch = diff?.patch && diff.patch.length > DIFF_LIMIT ? `${diff.patch.slice(0, DIFF_LIMIT)}\n… (cut off here: read the rest of the changed files yourself)` : diff?.patch;
    const tools: AgentTool[] = [
      {
        name: 'findings',
        description: `Record your review's findings for the owner, the whole list, most severe first; call it once, at the end of your review (an empty list where you found nothing worth their time). Each: title (short) and text (a sentence or two) in ${language}, saying what is wrong and why it matters; severity (blocker: crashes the app or exposes a very important secret or unprotected database; critical: a clear exploit, severe degradation or other major consequence; major: a real defect or clear departure from the repository's rules and design docs; minor: worth fixing but not a reason to hold the work; low: a small issue with limited impact; info: a nitpick or something to flag that may or may not be a problem), file and line where it is, security where it is about security, and with: the numbers (1-based, in the order of the list) of the other findings one agent would sensibly fix in one go with it (the same cause, the same files), else none.`,
        schema: {
          findings: z.array(
            z.object({
              title: z.string(),
              text: z.string(),
              severity: z.enum(SEVERITIES),
              file: z.string().optional(),
              line: z.number().int().positive().optional(),
              security: z.boolean().optional(),
              with: z.array(z.number().int()).optional(),
            }),
          ),
        },
        run: ({ findings }) => {
          recorded = reviewFindings(findings as Given[]);
          return 'Recorded. End your turn now.';
        },
      },
    ];
    let session: AgentSession | undefined;
    const end = (error?: string) => {
      if (ended) return;
      ended = true;
      session?.close();
      const r = this.running.get(cardId);
      // a session that does not resume (gone, or another harness now): the review starts over
      if (resume && error && !recorded && r?.run === run) {
        this.running.delete(cardId);
        const c = codeReviewOf(b.row(cardId));
        if (c?.review?.state === 'running') {
          const { session: _, ...review } = c.review;
          this.save(cardId, { ...c, review });
        }
        return this.resume(cardId);
      }
      if (!recorded && !error && r?.run === run && r.told) return this.pause(cardId, run);
      this.finish(cardId, run, recorded, error);
    };
    session = this.o.runtime.start(
      {
        cwd: ws,
        ...(resume ? { resume } : {}),
        readOnly: true,
        role: 'review',
        ...(setting ? { setting } : {}),
        system: [SYSTEM(language), b.preferencesText()].filter(Boolean).join('\n\n'),
        tools,
        onLimit: waitQuietly,
        onEvent: (e) => {
          if (e.type === 'session' && this.running.get(cardId)?.run === run) {
            const c = codeReviewOf(b.row(cardId));
            const model = e.model ?? (e.setting ? harnessChoice(e.setting).model : undefined);
            const named = model && model !== 'default' && c?.review?.agent?.model !== model;
            if (c?.review?.state === 'running' && (named || c.review.session !== e.id))
              this.save(cardId, { ...c, review: { ...c.review, session: e.id, ...(named ? { agent: { harness: c.review.agent?.harness ?? setting?.harness ?? 'claude', model } } : {}) } });
          }
          if (e.type === 'idle') end();
          else if (e.type === 'error') end(e.message);
        },
      },
      resume ? RESUMED : [
        `The card: “${card?.title ?? ''}”.`,
        card?.body ? `Its task, as the owner gave it:\n\n${clip(card.body, 8000)}` : '',
        `The files its branch changes against main:\n${diff!.files.map((f) => `- ${f.file} (${f.status}, +${f.added} −${f.removed})`).join('\n')}`,
        `The branch's diff against main${diff!.truncated ? ' (cut off)' : ''}:\n\n\`\`\`diff\n${patch}\n\`\`\``,
        followups.length
          ? `The owner chose these findings of earlier reviews of this work as follow-up tasks; they are handled separately, so leave out anything that raises one of them again:\n${followups.map((f) => `- ${f.title}${f.file ? ` (${f.line ? `${f.file}:${f.line}` : f.file})` : ''}: ${f.text}${f.card ? ` (follow-up task: ${f.card})` : ''}`).join('\n')}`
          : '',
        ignored.length
          ? `The owner ignored these findings of earlier reviews of this work; they stay as they are, so leave out anything that raises one of them again:\n${ignored.map((f) => `- ${f.title}${f.file ? ` (${f.line ? `${f.file}:${f.line}` : f.file})` : ''}: ${f.text}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
    if (ended) return session.close();
    if (this.running.get(cardId)?.run !== run) return session.close();
    const r = { session, run };
    this.running.set(cardId, r);
    if (this.restart) this.tell(cardId, r);
  }

  /**
   * The review agent `run` ended (null: one a restart cut off): done with the findings it recorded,
   * else failed, with why. A run stopped since, and a later review in its place, are left alone.
   */
  private finish(cardId: string, run: object | null, findings: Finding[] | undefined, error?: string): void {
    if (run) {
      if (this.running.get(cardId)?.run !== run) return;
      this.running.delete(cardId);
    }
    if (!this.o.board.item(cardId)) return;
    const stored = codeReviewOf(this.o.board.row(cardId));
    if (!stored?.review || stored.review.state !== 'running') return;
    // a newer handover still waiting for its review decision keeps its pending mark
    const c = { ...stored, review: stored.review };
    const t = this.o.board.t.worker;
    const failed = findings ? undefined : clip(oneLine(error ?? t.codeReviewNoFindings), 300);
    this.paused.delete(cardId);
    const { session: _, ...review } = c.review;
    this.save(cardId, { ...c, review: { ...review, state: failed ? 'failed' : 'done', findings: findings ?? [], ...(failed ? { error: failed } : {}) } });
    const count = (s: Severity) => (findings ?? []).filter((f) => f.severity === s).length;
    this.o.board.log(cardId, 'state', 'obeya', failed ? t.codeReviewFailed(failed) : t.codeReviewDone(findings!.length, Object.fromEntries(SEVERITIES.map((s) => [s, count(s)])) as Record<Severity, number>));
  }

  private stopSession(cardId: string): void {
    this.paused.delete(cardId);
    const r = this.running.get(cardId);
    this.running.delete(cardId);
    r?.session?.close();
  }

  private save(cardId: string, c: StoredCodeReview | null): void {
    this.o.board.work(cardId, { review: { codeReview: c } });
  }
}

type Given = { title: string; text: string; severity: Severity; file?: string; line?: number; security?: boolean; with?: number[] };

/** The findings as the review agent gave them: numbered in its order, its bundles kept in both directions. */
function reviewFindings(given: Given[]): Finding[] {
  const findings: Finding[] = given.slice(0, MAX_FINDINGS).map((g, i) => ({
    id: i + 1,
    title: clip(String(g.title).trim(), 120),
    text: clip(String(g.text).trim(), 2000),
    severity: SEVERITIES.includes(g.severity) ? g.severity : 'minor',
    ...(g.file?.trim() ? { file: clip(g.file.trim(), 300) } : {}),
    ...(g.file?.trim() && g.line ? { line: g.line } : {}),
    ...(g.security ? { security: true } : {}),
    status: 'open',
  }));
  return bundled(findings, given.slice(0, MAX_FINDINGS).map((g, i) => [i + 1, g.with ?? []] as [number, number[]]));
}

/**
 * Each finding's bundle: the findings named together with it (`named`, by id), in both directions
 * and across a chain, kept as `with` on each of them.
 */
export function bundled(findings: Finding[], named: [number, number[]][]): Finding[] {
  const root = new Map(findings.map((f) => [f.id, f.id]));
  const find = (id: number): number => (root.get(id) === id ? id : find(root.get(id)!));
  for (const [id, others] of named) for (const o of others) if (root.has(o) && root.has(id)) root.set(find(o), find(id));
  return findings.map((f) => {
    const { with: _, ...rest } = f;
    const w = findings.filter((o) => o.id !== f.id && find(o.id) === find(f.id)).map((o) => o.id);
    return w.length ? { ...rest, with: w } : rest;
  });
}

/** A finding settled: nothing is decided on it any more. */
function settled(f: Finding, status: Finding['status']): Finding {
  const { decided: _, ...rest } = f;
  return { ...rest, status };
}

/** A finding as the worker reads it in the owner's decision. */
const described = (f: Finding) =>
  `  #${f.id} “${f.title}”${f.severity ? ` (${f.severity}${f.file ? `, ${f.file}${f.line ? `:${f.line}` : ''}` : ''})` : f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}: ${f.text}`;

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Tells a review agent at work that Seismic is about to restart, so that it pauses instead of being cut off. */
const RESTART_NOTICE =
  'Seismic is about to restart, which stops this review. Pause it now: end your turn without recording findings. Seismic resumes you once it runs again, and you go on with your review from where you are.';

const RESUMED = 'Seismic has restarted. Go on with your review from where you paused, and record your findings with the findings tool at the end.';

const SYSTEM = (language: string) => `You review the work of a card on Seismic before it lands on main: the diff of its branch against main, which the brief holds. Another agent did the work; the owner decides on what you find.

You only read: you change no file and run nothing. Read the changed files and their surroundings where the diff alone does not tell enough.

Review it the repository's way: its CLAUDE.md and its docs (design docs, contribution rules) say what matters here. Look for correctness (bugs, edge cases, races, error handling), security, code quality (what the repository's rules ask, needless complexity, duplication of what exists), and whether the change fits the design docs and keeps them current where the repository asks for that.

Report findings worth the owner's time, including small issues or uncertain points worth flagging. Each finding's title and explanation say what is wrong and why it matters, in ${language}, with the file and line. Grade each from blocker through critical, major, minor, low and info as the findings tool describes.

Record them with the findings tool, once, at the end (an empty list where you found nothing), then end your turn.`;
