






import { describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generic } from '../../../adapters/generic';
import type { RepoAdapter } from '../../../adapters/types';
import { type AgentSetting, type CodeReviewSetting, needsYou, type ReviewItem, type ReviewItemEvent, type ReviewItemStatus, type Severity } from '../../../core/types';
import { described, listed, reopenings } from '../../workerSupervisor/codeReview';
import { artifact, type FakeSession, until } from '../helpers/testing';
import { WorkerSupervisor } from '../../workerSupervisor/workerSupervisor';
import { withAgentSetting, withLimitWait } from '../../runtime';
import { git } from '../../workstations';
import { board, dir, eachTest, main, manual, runtime, setWorkers, spaces, state, workers } from '../helpers/workerSupervisor';

eachTest();

let setting: CodeReviewSetting;
let followed: [string, string][];

/** Workers on a project that reviews work as `on` and `mode` say, in a repository where work lands as `land` says. */
function reviewing(mode: CodeReviewSetting['mode'] = 'auto', on = true, land: RepoAdapter['land'] = 'main', reviewAgentSetting?: () => AgentSetting) {
  setting = { on, mode };
  followed = [];
  setWorkers(
    new WorkerSupervisor({
      board,
      runtime,
      workstations: spaces,
      adapter: { ...generic, land, direct: land === 'pr', workstations: 'clones' },
      codeReviews: () => setting,
      ...(reviewAgentSetting ? { reviewAgentSetting, reviewRuntime: withLimitWait(withAgentSetting(runtime, reviewAgentSetting)) } : {}),
      onFollowUpTask: (task, of) => followed.push([task, of]),
    }),
  );
}

const reviewers = () => runtime.sessions.filter((s) => s.spec.role === 'review');
const worker = () => runtime.sessions.filter((s) => s.spec.role !== 'review').at(-1)!;

/** The worker commits `file` on its branch and hands over with a demo; its turn ends. */
async function handOver(id: string, file: string) {
  const ws = board.row(id).workstation!;
  writeFileSync(join(ws, file), `${file}\n`);
  git(ws, 'add', '.');
  git(ws, 'commit', '--quiet', '-m', file);
  const r = await worker().call('ready_for_review', { summary: 'Done.', demo: artifact() });
  worker().emit({ type: 'idle' });
  return r;
}

async function started() {
  const c = manual();
  await workers.start(c.id);
  await until(() => runtime.sessions.length > 0, 15000);
  return c.id;
}

const FINDINGS = [
  { title: 'SQL built from input', text: 'The export query concatenates the file name.', severity: 'critical', file: 'export.ts', line: 12, security: true },
  { title: 'Race on a second handover', text: 'Two exports at once overwrite each other.', severity: 'major', file: 'export.ts', line: 40 },
  { title: 'Name the constant', text: 'A magic number.', severity: 'minor', with: [2] },
];

type Verdict = { number: number; fixed: boolean; why?: string };

/** The running review of card `id` records new `items` (and verdicts on those under review, regressions) and its turn ends. */
async function review(id: string, s: FakeSession, items: unknown[] = FINDINGS, verdicts: Verdict[] = [], regressions: { number: number; why: string }[] = []) {
  expect(s.call('review', { verdicts, regressions, items })).toContain('Recorded');
  s.emit({ type: 'idle' });
  
  await until(() => board.row(id).review?.codeReview?.review?.state === 'done');
}

const itemsOf = (id: string) => board.item(id)!.review!.codeReview!.items;
const statuses = (id: string) => itemsOf(id).map((i) => i.status);

describe('code reviews', () => {
  test('shows the model selected for the running review and updates it when the session resolves it', async () => {
    reviewing('auto', true, 'main', () => ({ model: 'opus', effort: 'high' }));
    const id = await started();
    await handOver(id, 'review-model.ts');
    await until(() => reviewers().length === 1);
    expect(board.item(id)!.review?.codeReview?.agent).toEqual({ harness: 'claude', model: 'opus' });
    reviewers()[0]!.emit({ type: 'session', id: 'review-session', model: 'claude-opus-5-5' });
    expect(board.item(id)!.review?.codeReview?.agent).toEqual({ harness: 'claude', model: 'claude-opus-5-5' });
  });

  test('are off unless the project turns them on: a handover gets no review', async () => {
    reviewing('auto', false);
    const id = await started();
    await handOver(id, 'export.ts');
    expect(state(id)).toBe('waiting:demo');
    await new Promise((r) => setTimeout(r, 30));
    expect(board.item(id)!.review?.codeReview).toBeUndefined();
    expect(reviewers()).toHaveLength(0);
  });

  test('a setting changed while a card waits for approval: manual offers the start, auto starts nothing, off drops', async () => {
    reviewing('auto', false);
    const id = await started();
    await handOver(id, 'export.ts');
    expect(board.item(id)!.review?.codeReview).toBeUndefined();
    setting = { on: true, mode: 'auto' };
    await workers.codeReviewsChanged();
    expect(board.item(id)!.review?.codeReview).toBeUndefined();
    expect(reviewers()).toHaveLength(0);
    setting = { on: true, mode: 'manual' };
    await workers.codeReviewsChanged();
    expect(board.item(id)!.review?.codeReview).toEqual({ mode: 'manual', items: [] });
    expect(reviewers()).toHaveLength(0);
    setting = { on: false, mode: 'auto' };
    await workers.codeReviewsChanged();
    expect(board.item(id)!.review?.codeReview).toBeUndefined();
  });

  test('a card at work when the setting turns automatic hands over unreviewed', async () => {
    reviewing('auto', false);
    const id = await started();
    setting = { on: true, mode: 'auto' };
    workers.holdAutoReviews();
    await handOver(id, 'export.ts');
    await new Promise((r) => setTimeout(r, 30));
    expect(board.item(id)!.review?.codeReview).toBeUndefined();
    expect(reviewers()).toHaveLength(0);
  });

  test('a card whose worker still takes in the owner\'s words is not caught up by a changed setting', async () => {
    reviewing('auto', false);
    const id = await started();
    await handOver(id, 'export.ts');
    board.work(id, { detail: JSON.stringify({ answering: true }) });
    setting = { on: true, mode: 'manual' };
    await workers.codeReviewsChanged();
    expect(board.item(id)!.review?.codeReview).toBeUndefined();
  });

  test('work that goes through a pull request is reviewed before the PR opens', async () => {
    reviewing('auto', true, 'pr');
    const id = await started();
    await handOver(id, 'export.ts');
    expect(state(id)).toBe('waiting:demo');
    await until(() => reviewers().length === 1);
    expect(board.item(id)!.review?.codeReview).toEqual({ mode: 'auto', state: 'running', runs: 1, items: [], agent: { harness: 'claude', model: 'opus' } });
  });

  test('work that goes through a pull request gets "Start code review" in manual mode', async () => {
    reviewing('manual', true, 'pr');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => !!board.item(id)!.review?.codeReview);
    expect(board.item(id)!.review?.codeReview).toEqual({ mode: 'manual', items: [] });
    expect(reviewers()).toHaveLength(0);
  });

  for (const completed of [false, true]) test(`Straight to main on a PR card with a ${completed ? 'completed' : 'running'} review pushes the reviewed work without opening a PR`, async () => {
    reviewing('auto', true, 'pr');
    const origin = join(dir, 'direct-origin.git');
    git(dir, 'clone', '--quiet', '--bare', main, origin);
    const id = await started();
    const ws = board.row(id).workstation!;
    git(ws, 'remote', 'set-url', 'origin', origin);
    await handOver(id, 'direct.ts');
    await until(() => reviewers().length === 1);
    const reviewer = reviewers()[0]!;
    if (completed) await review(id, reviewer);
    const findings = itemsOf(id);
    expect(board.item(id)!.review?.codeReview?.state).toBe(completed ? 'done' : 'running');
    expect(state(id)).toBe('waiting:demo');
    
    expect(git(origin, 'log', '--format=%s', '-1', 'main')).not.toBe('direct.ts');
    const head = git(ws, 'rev-parse', 'HEAD');
    await workers.approve(id, { direct: true });
    expect(state(id)).toBe('live');
    expect(git(origin, 'rev-parse', 'main')).toBe(head);
    expect(board.item(id)!.review?.pr).toBeUndefined();
    expect(board.item(id)!.review?.codeReview?.state).toBe(completed ? 'done' : undefined);
    expect(itemsOf(id)).toEqual(findings);
    if (!completed) expect(reviewer.closed).toBe(true);
    expect(board.events(id).some((e) => e.author === 'owner' && e.text === 'Approved and pushed straight to main.')).toBe(true);
  });

  test('automatic: the review starts with the demo, read-only, and the card goes to the owner at once', async () => {
    reviewing('auto');
    board.addPreference('Agents speak and write to me in English only.');
    const id = await started();
    await handOver(id, 'export.ts');
    expect(state(id)).toBe('waiting:demo');
    await until(() => reviewers().length === 1);
    expect(board.item(id)!.review?.codeReview).toEqual({ mode: 'auto', state: 'running', runs: 1, items: [], agent: { harness: 'claude', model: 'opus' } });
    const r = reviewers()[0]!;
    expect(r.spec.system).toContain('- Agents speak and write to me in English only.');
    expect(r.spec.tools.find((t) => t.name === 'review')!.description).toContain('unless an explicit standing preference names another language');
    expect(r.spec.permission).toBe('readOnly');
    expect(r.spec.cwd).toBe(board.row(id).workstation!);
    expect(r.inbox[0]).toContain('Zählerstände exportieren');
    expect(r.inbox[0]).toContain('+export.ts');
    expect(r.spec.system).toContain('CLAUDE.md');
    await review(id, r);
    const done = board.item(id)!.review?.codeReview!;
    expect(done.state).toBe('done');
    expect(done.items.map((f) => [f.number, f.severity, f.file, f.line])).toEqual([
      [1, 'critical', 'export.ts', 12],
      [2, 'major', 'export.ts', 40],
      [3, 'minor', undefined, undefined],
    ]);
    
    expect(done.items[1]!.with).toEqual([3]);
    expect(done.items.map((i) => [i.status, i.log.map((e) => [e.who, e.from, e.to])])).toEqual(done.items.map(() => ['raised', [['reviewer', undefined, 'raised']]]));
    expect(board.events(id).at(-1)!.text).toBe(board.t.worker.codeReviewDone(3, { blocker: 0, critical: 1, major: 1, minor: 1, low: 0, info: 0 }));
    expect(r.closed).toBe(true);
  });

  test('automatic: the card never needs the owner between the handover and the end of the review', async () => {
    reviewing('auto');
    const id = await started();
    const needing: boolean[] = [];
    const off = board.onChange(() => needing.push(needsYou(board.item(id)!)));
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    expect(board.item(id)!.state).toBe('waiting');
    expect(needing).not.toContain(true);
    await review(id, reviewers()[0]!);
    expect(needsYou(board.item(id)!)).toBe(true);
    off();
  });

  test('an old review ending keeps a newer handover pending; a restart starts the pending review', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    const reviews = (workers as unknown as { reviews: { finish(id: string, run: null, f: undefined, e: string): void; interrupted(): void } }).reviews;
    const stored = () => board.row(id).review!.codeReview!;
    
    board.work(id, { review: { codeReview: { ...stored(), pending: true } } });
    reviews.finish(id, null, undefined, 'x');
    expect(stored().pending).toBe(true);
    expect(stored().review!.state).toBe('failed');
    expect(needsYou(board.item(id)!)).toBe(false);
    
    board.work(id, { review: { codeReview: { ...stored(), review: { ...stored().review!, head: 'older' } } } });
    reviews.interrupted();
    await until(() => reviewers().length === 2);
    expect(stored().pending).toBeUndefined();
    expect(board.item(id)!.review?.codeReview!.state).toBe('running');
    await review(id, reviewers()[1]!);
    expect(needsYou(board.item(id)!)).toBe(true);
  });

  test('a restart waits for a review at work, which pauses for it and goes on in its session after it', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    const first = reviewers()[0]!;
    first.emit({ type: 'session', id: 'review-1' });
    expect(workers.busyCards()).toContain(id);
    expect(workers.reviews.busy()).toEqual([id]);
    workers.restartDue({ reason: 'code', deadline: Date.now() + 15 * 60_000 });
    expect(first.inbox.at(-1)).toContain('Pause it now');
    
    
    first.emit({ type: 'idle' });
    expect(workers.busyCards()).not.toContain(id);
    expect(workers.reviews.busy()).toEqual([]);
    expect(board.item(id)!.review?.codeReview!.state).toBe('running');
    
    workers.shutdown();
    reviewing('auto');
    workers.resumeAll();
    await until(() => reviewers().length === 2);
    const again = reviewers()[1]!;
    expect(again.spec.resume).toBe('review-1');
    expect(again.inbox[0]).toContain('Seismic has restarted');
    await review(id, again);
    expect(itemsOf(id)).toHaveLength(3);
  });

  test('a stop while the results are saved leaves no applied results behind a running review', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    const reviews = (workers as unknown as { reviews: { finish(id: string, run: null, f: unknown): void } }).reviews;
    const recorded = { verdicts: [], regressions: [], items: FINDINGS };
    
    const work = board.work.bind(board);
    board.work = (...a: Parameters<typeof work>) => {
      work(...a);
      board.work = work;
      throw new Error('stopped');
    };
    expect(() => reviews.finish(id, null, recorded)).toThrow('stopped');
    
    const stored = board.item(id)!.review?.codeReview?.state;
    expect(itemsOf(id).length > 0).toBe(stored === 'done');
    
    reviews.finish(id, null, recorded);
    expect(itemsOf(id).map((i) => i.number)).toEqual([1, 2, 3]);
    expect(board.item(id)!.review?.codeReview?.state).toBe('done');
  });

  test('a review cut off by a restart goes on after it; one whose session is gone starts over', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    reviewers()[0]!.emit({ type: 'session', id: 'review-1' });
    workers.shutdown();
    reviewing('auto');
    workers.resumeAll();
    await until(() => reviewers().length === 2);
    expect(reviewers()[1]!.spec.resume).toBe('review-1');
    reviewers()[1]!.emit({ type: 'error', message: 'no conversation found' });
    await until(() => reviewers().length === 3);
    const fresh = reviewers()[2]!;
    expect(fresh.spec.resume).toBeUndefined();
    expect(fresh.inbox[0]).toContain('<diff against="main"');
    await review(id, fresh);
  });

  test('a review due while a restart waits starts after it, or at once when the restart is off', async () => {
    reviewing('auto');
    const id = await started();
    workers.restartDue({ reason: 'code', deadline: Date.now() + 15 * 60_000 });
    await handOver(id, 'export.ts');
    await until(() => board.item(id)!.review?.codeReview?.state === 'running');
    await new Promise((r) => setTimeout(r, 30));
    expect(reviewers()).toHaveLength(0);
    expect(workers.busyCards()).not.toContain(id);
    workers.restartDue(null);
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
  });

  test('records all six severities and counts them in the review notice', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'severity.ts');
    await until(() => reviewers().length === 1);
    const severities: Severity[] = ['blocker', 'critical', 'major', 'minor', 'low', 'info'];
    await review(id, reviewers()[0]!, severities.map((severity) => ({ title: severity, text: `${severity} finding`, severity })));
    expect(itemsOf(id).map((f) => f.severity)).toEqual(severities);
    expect(board.events(id).at(-1)!.text).toBe(board.t.worker.codeReviewDone(6, { blocker: 1, critical: 1, major: 1, minor: 1, low: 1, info: 1 }));
  });

  test('a review that records nothing failed, and the owner can start it again', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    reviewers()[0]!.emit({ type: 'idle' });
    await until(() => board.item(id)!.review?.codeReview?.state === 'failed');
    expect(board.item(id)!.review?.codeReview!.error).toBe(board.t.worker.codeReviewNoFindings);
    workers.startCodeReview(id);
    await until(() => reviewers().length === 2);
    expect(board.item(id)!.review?.codeReview!.state).toBe('running');
  });

  test('a review stopped by the usage limit names its model; it is retried, handed to another agent or skipped', async () => {
    reviewing('auto', true, 'main', () => ({ model: 'opus', effort: 'high' }));
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    reviewers()[0]!.emit({ type: 'error', message: "You've hit your usage limit", limit: {} });
    await until(() => board.item(id)!.review?.codeReview?.state === 'failed');
    expect(board.item(id)!.review?.codeReview).toMatchObject({ limited: true, agent: { harness: 'claude', model: 'opus' } });
    expect(board.item(id)!.state).toBe('waiting');
    
    const other: AgentSetting = { harness: 'claude', model: 'sonnet', effort: 'medium' };
    workers.startCodeReview(id, other);
    await until(() => reviewers().length === 2);
    expect(reviewers()[1]!.spec.setting).toEqual(other);
    expect(board.item(id)!.review?.codeReview).toMatchObject({ state: 'running', agent: { model: 'sonnet' } });
    expect(board.item(id)!.review?.codeReview?.limited).toBeUndefined();
    reviewers()[1]!.emit({ type: 'error', message: "You've hit your usage limit", limit: {} });
    await until(() => board.item(id)!.review?.codeReview?.state === 'failed');
    expect(board.item(id)!.review?.codeReview?.limited).toBe(true);
    
    workers.startCodeReview(id);
    await until(() => reviewers().length === 3);
    expect(reviewers()[2]!.spec.setting).toEqual(other);
    expect(reviewers()[2]!.spec.model).toBe('sonnet');
    reviewers()[2]!.emit({ type: 'error', message: "You've hit your usage limit", limit: {} });
    await until(() => board.item(id)!.review?.codeReview?.state === 'failed');
    
    workers.reviews.skip(id);
    expect(board.item(id)!.review?.codeReview).toMatchObject({ mode: 'auto', items: [] });
    expect(board.item(id)!.review?.codeReview?.state).toBeUndefined();
    expect(board.item(id)!.state).toBe('waiting');
    expect(() => workers.reviews.skip(id)).toThrow();
    workers.startCodeReview(id);
    await until(() => reviewers().length === 4);
    expect(reviewers()[3]!.spec.model).toBe('opus');
  });

  test('a limit before a session names the configured default and retries it after a settings change and restart', async () => {
    const initial: AgentSetting = { model: 'default', effort: 'medium', harness: 'claude' };
    let selected = initial;
    reviewing('auto', true, 'main', () => selected);
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    const hit = { type: 'error', message: 'API Error: 429', limit: {} } as const;
    reviewers()[0]!.emit(hit);
    expect(board.item(id)!.review?.codeReview).toMatchObject({ limited: true, agent: { harness: 'claude', model: 'default' } });

    selected = { model: 'opus', effort: 'high', harness: 'codex', codex: { model: 'gpt-test', effort: 'high' } };
    workers.startCodeReview(id);
    workers.shutdown();
    reviewing('auto', true, 'main', () => selected);
    workers.reviews.interrupted();
    await until(() => reviewers().length === 2);
    expect(reviewers()[1]!.spec.setting).toEqual(initial);
    expect(reviewers()[1]!.spec.model).toBeUndefined();
    reviewers()[1]!.emit({ type: 'session', id: 'review-1', model: 'claude-test' });

    
    workers.shutdown();
    reviewing('auto', true, 'main', () => selected);
    workers.reviews.interrupted();
    await until(() => reviewers().length === 3);
    expect(reviewers()[2]!.spec.resume).toBe('review-1');
    reviewers()[2]!.emit(hit);
    expect(board.item(id)!.review?.codeReview).toMatchObject({ limited: true, agent: { harness: 'claude', model: 'claude-test' } });
    workers.startCodeReview(id);
    await until(() => reviewers().length === 4);
    expect(reviewers()[3]!.spec).toMatchObject({ setting: initial, model: 'claude-test', effort: 'medium' });
  });

  test('a review that failed otherwise cannot be skipped', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    reviewers()[0]!.emit({ type: 'error', message: 'API Error: 500' });
    await until(() => board.item(id)!.review?.codeReview?.state === 'failed');
    expect(board.item(id)!.review?.codeReview?.limited).toBeUndefined();
    expect(() => workers.reviews.skip(id)).toThrow();
  });

  test('review answers can start a fresh worker with only the selected items', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    const old = worker();
    const setting = { harness: 'claude' as const, model: 'opus' as const, effort: 'high' as const };
    board.work(id, { session_id: 'previous', agent_setting: JSON.stringify(setting) });
    expect(board.item(id)!.agent?.workerSetting).toEqual(setting);
    workers.reviewWithNewAgent(id, { 1: 'self', 2: 'later', 3: 'ignore' }, setting);
    const fresh = worker();
    expect(fresh).not.toBe(old);
    expect(fresh.spec.resume).toBeUndefined();
    expect(fresh.spec.setting).toEqual(setting);
    expect(fresh.inbox[0]).toContain('SQL built from input');
    expect(fresh.inbox[0]).toContain('Race on a second handover');
    
    expect(fresh.inbox[0]).toContain('Closed (the owner ignored them; the review does not raise them again):\n  #3 “Name the constant”');
    expect(statuses(id)).toEqual(['fixing', 'followUp', 'closed']);
  });

  test('"Fix it" and "As a follow-up task" go to the worker with the Send; the handover resubmits what it fixed, and the next review verifies it', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    
    expect(() => workers.message(id, '', [], false, undefined, undefined, { 1: 'contributor' })).toThrow();
    workers.message(id, 'The race matters most.', [], false, undefined, undefined, { 1: 'self', 2: 'later', 3: 'later' }, { 1: 'Use a parameter.' });
    const note = worker().inbox.at(-1)!;
    expect(note).toContain('code review of your work');
    expect(note).toContain('#1 “SQL built from input” (critical, export.ts:12)');
    expect(note).toContain('as the review bundled them (items 2 + 3)');
    expect(note).toContain('The race matters most.');
    expect(note).toContain('Use a parameter.');
    expect(statuses(id)).toEqual(['fixing', 'followUp', 'followUp']);
    expect(itemsOf(id)[0]!.context).toBe('Use a parameter.');
    expect(itemsOf(id)[0]!.log.map((e) => [e.who, e.from, e.to])).toEqual([['reviewer', undefined, 'raised'], ['owner', 'raised', 'fixing']]);
    
    expect(() => workers.message(id, '', [], false, undefined, undefined, { 1: 'later' })).toThrow();
    
    expect(await handOver(id, 'fix.ts')).toContain('follow-up tasks');
    expect(await worker().call('follow_up_task', { findings: [2, 3], title: 'Serialize exports', task: 'Two exports at once overwrite each other.' })).toContain('until your work has landed');
    const task = board.items().find((i) => i.title === 'Serialize exports')!;
    expect(task.from).toBe(id);
    expect(task.body).toContain('Zählerstände exportieren');
    expect(followed).toEqual([[task.id, id]]);
    expect(itemsOf(id).map((i) => [i.status, i.card])).toEqual([['fixing', undefined], ['followUp', task.id], ['followUp', task.id]]);
    await worker().call('ready_for_review', { summary: 'Fixed.', demo: artifact() });
    
    await until(() => reviewers().length === 2);
    expect(board.item(id)!.review?.codeReview!.state).toBe('running');
    expect(statuses(id)).toEqual(['underReview', 'followUp', 'followUp']);
    expect(itemsOf(id)[0]!.log.at(-1)).toMatchObject({ who: 'worker', from: 'fixing', to: 'underReview' });
    const brief = reviewers()[1]!.inbox[0]!;
    expect(brief).toContain('Under review');
    expect(brief).toContain('- #1 “SQL built from input” (critical, export.ts:12): The export query concatenates the file name.');
    expect(brief).toContain('The owner wrote: Use a parameter.');
    expect(brief).toContain('- #2 “Race on a second handover” (major, export.ts:40): Two exports at once overwrite each other.');
    expect(brief).toContain('Follow-ups');
    
    const second = reviewers()[1]!;
    expect(second.call('review', { verdicts: [], regressions: [], items: [] })).toContain('no verdict on #1');
    expect(second.call('review', { verdicts: [{ number: 1, fixed: true }, { number: 2, fixed: true }], regressions: [], items: [] })).toContain('#2 is not under review');
    
    const many = Array.from({ length: 31 }, (_, k) => ({ title: `Item ${k}`, text: 'x', severity: 'low' as const }));
    expect(second.call('review', { verdicts: [{ number: 1, fixed: true }], regressions: [], items: many })).toContain('31 new items are more than the 30');
    expect(statuses(id)).toEqual(['underReview', 'followUp', 'followUp']);
    
    await review(id, second, [{ title: 'Missing test', text: 'Nothing covers the fix.', severity: 'minor' }], [{ number: 1, fixed: true }]);
    expect(statuses(id)).toEqual(['fixed', 'followUp', 'followUp', 'raised']);
    expect(itemsOf(id).map((i) => i.number)).toEqual([1, 2, 3, 4]);
    expect(itemsOf(id)[0]!.log.at(-1)).toMatchObject({ who: 'reviewer', from: 'underReview', to: 'fixed' });
    expect(board.events(id).at(-1)!.text).toBe(board.t.worker.codeReviewDone(1, { blocker: 0, critical: 0, major: 0, minor: 1, low: 0, info: 0 }, 1, 0));
  });

  test('a review that finds the fix did not hold reopens the item; a fixed item that regressed is reopened too', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    workers.message(id, '', [], false, undefined, undefined, { 1: 'self', 2: 'self' });
    await handOver(id, 'fix.ts');
    await until(() => reviewers().length === 2);
    
    expect(reviewers()[1]!.call('review', { verdicts: [{ number: 1, fixed: true }, { number: 2, fixed: false }], regressions: [], items: [] })).toContain('#2 needs why');
    await review(id, reviewers()[1]!, [], [{ number: 1, fixed: true }, { number: 2, fixed: false, why: 'The lock is taken after the write.' }]);
    expect(statuses(id)).toEqual(['fixed', 'reopened', 'raised']);
    expect(itemsOf(id)[1]!.log.at(-1)).toMatchObject({ who: 'reviewer', from: 'underReview', to: 'reopened', note: 'The lock is taken after the write.' });
    expect(needsYou(board.item(id)!)).toBe(true);
    
    workers.message(id, '', [], false, undefined, undefined, { 2: 'self' });
    expect(statuses(id)).toEqual(['fixed', 'fixing', 'raised']);
    expect(worker().inbox.at(-1)).toContain('Fixed (the reviewer verified them):\n  #1 “SQL built from input”');
    expect(worker().inbox.at(-1)).toContain('The reviewer wrote: ');
    await handOver(id, 'fix2.ts');
    await until(() => reviewers().length === 3);
    
    expect(reviewers()[2]!.call('review', { verdicts: [{ number: 2, fixed: true }], regressions: [{ number: 1, why: ' ' }], items: [] })).toContain('#1 needs why');
    await review(id, reviewers()[2]!, [], [{ number: 2, fixed: true }], [{ number: 1, why: 'The retry builds the query by hand again.' }]);
    expect(statuses(id)).toEqual(['reopened', 'fixed', 'raised']);
    expect(itemsOf(id)[0]!.log.map((e) => e.to)).toEqual(['raised', 'fixing', 'underReview', 'fixed', 'reopened']);
    
    workers.message(id, '', [], false, undefined, undefined, { 1: 'self' });
    await handOver(id, 'fix3.ts');
    await until(() => reviewers().length === 4);
    expect(reviewers()[3]!.call('review', { verdicts: [{ number: 1, fixed: true }], regressions: [{ number: 3, why: 'x' }], items: [] })).toContain('#3 is not marked fixed');
    
    expect(reviewers()[3]!.call('review', { verdicts: [{ number: 1, fixed: true }, { number: 1, fixed: false, why: 'Still open.' }], regressions: [], items: [] })).toContain('#1 has more than one verdict');
    expect(reviewers()[3]!.call('review', { verdicts: [{ number: 1, fixed: true }], regressions: [{ number: 2, why: 'a' }, { number: 2, why: 'b' }], items: [] })).toContain('#2 is named more than once');
    const both = reviewers()[3]!.call('review', { verdicts: [{ number: 1, fixed: true }, { number: 1, fixed: true }], regressions: [{ number: 2, why: 'a' }, { number: 2, why: 'b' }], items: [] });
    expect(both).toContain('#1 has more than one verdict');
    expect(both).toContain('#2 is named more than once');
  });

  test('the worker resubmits any item with a note, and disputes one it holds wrong', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    workers.message(id, '', [], false, undefined, undefined, { 1: 'self', 2: 'self', 3: 'ignore' });
    expect(statuses(id)).toEqual(['fixing', 'fixing', 'closed']);
    
    expect(await worker().call('resubmit_review_item', { items: [{ number: 3, note: 'The constant is named now.' }, { number: 3 }] })).toContain('#3');
    expect(itemsOf(id)[2]).toMatchObject({ status: 'underReview' });
    expect(itemsOf(id)[2]!.log.at(-1)).toMatchObject({ who: 'worker', from: 'closed', to: 'underReview', note: 'The constant is named now.' });
    expect(await worker().call('resubmit_review_item', { items: [{ number: 9 }] })).toContain('there is no item #9');
    
    expect(await worker().call('resubmit_review_item', { items: [{ number: 3, note: 'Also covered by a test.' }] })).toContain('Note added to #3');
    expect(await worker().call('resubmit_review_item', { items: [{ number: 3 }] })).toContain('#3 is under review already');
    expect(itemsOf(id)[2]!.log.at(-1)).toMatchObject({ who: 'worker', from: 'underReview', to: 'underReview', note: 'Also covered by a test.' });
    
    expect(await worker().call('dispute_review_item', { items: [{ number: 2, note: '' }] })).toContain('needs your reasons');
    expect(await worker().call('dispute_review_item', { items: [{ number: 2, note: 'Exports are serialized by the queue already.' }] })).toContain('Disputed: #2');
    expect(await worker().call('dispute_review_item', { items: [{ number: 3, note: 'x' }] })).toContain('not one you are fixing');
    expect(statuses(id)).toEqual(['fixing', 'disputed', 'underReview']);
    expect(needsYou(board.item(id)!)).toBe(false);
    
    await handOver(id, 'fix.ts');
    expect(statuses(id)).toEqual(['underReview', 'disputed', 'underReview']);
    await until(() => reviewers().length === 2);
    expect(reviewers()[1]!.inbox[0]).toContain('The worker wrote: Also covered by a test.');
    
    expect(reviewers()[1]!.inbox[0]).toContain('Disputed (the worker holds them wrong and the owner decides on them; leave them out and do not raise them again):\n- #2');
  });

  test('the owner rejects a dispute with why, and the worker fixes the item; confirming one closes it', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    workers.message(id, '', [], false, undefined, undefined, { 1: 'self', 2: 'self' });
    await worker().call('dispute_review_item', { items: [{ number: 1, note: 'The input is validated upstream.' }, { number: 2, note: 'Exports are serialized by the queue already.' }] });
    expect(statuses(id)).toEqual(['disputed', 'disputed', 'raised']);
    worker().emit({ type: 'idle' });
    
    workers.message(id, '', [], false, undefined, undefined, { 1: 'self' }, { 1: 'The admin import skips that validation.' });
    expect(itemsOf(id)[0]).toMatchObject({ status: 'fixing', context: 'The admin import skips that validation.' });
    const note = worker().inbox.at(-1)!;
    expect(note).toContain('You wrote: The input is validated upstream.');
    expect(note).toContain('You wrote: The input is validated upstream.\n    The owner rejected your dispute of it.');
    expect(note).toContain('Finding #1:\nThe admin import skips that validation.');
    
    workers.message(id, '', [], false, undefined, undefined, { 2: 'ignore' });
    expect(statuses(id)).toEqual(['fixing', 'closed', 'raised']);
  });

  test('a resubmission followed by a reply starts the next automatic review', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    workers.message(id, 'Please check this too.', [], false, undefined, undefined, { 3: 'ignore' });
    await worker().call('resubmit_review_item', { items: [{ number: 3, note: 'Fixed.' }] });
    await worker().call('reply', { text: 'Fixed.' });
    worker().emit({ type: 'text', text: 'Fixed.' });
    worker().emit({ type: 'idle' });
    
    expect(board.row(id).review?.codeReview?.pending).toBe(true);
    expect(board.item(id)!.review?.codeReview).toMatchObject({ state: 'running', runs: 2 });
    expect(needsYou(board.item(id)!)).toBe(false);
    
    workers.reviews.interrupted();
    await until(() => reviewers().length === 2);
    expect(board.item(id)!.review?.codeReview).toMatchObject({ state: 'running', runs: 2 });
    expect(reviewers()).toHaveLength(2);
  });

  test('cancelling a pending verification prevents its Git callback from starting a review', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    board.work(id, { review: { items: itemsOf(id).map((i) => i.number === 1 ? { ...i, status: 'underReview' as const } : i) } });
    workers.reviews.workerFinished(id);
    expect(board.row(id).review?.codeReview?.pending).toBe(true);
    workers.reviews.cancel(id);
    expect(board.row(id).review?.codeReview?.pending).toBeUndefined();
    await Bun.sleep(30);
    expect(reviewers()).toHaveLength(1);
  });

  test('a pending automatic verification continues if the project switches to manual', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    board.work(id, { review: { items: itemsOf(id).map((i) => i.number === 1 ? { ...i, status: 'underReview' as const } : i.number === 2 ? { ...i, status: 'fixing' as const } : i) } });
    workers.reviews.workerFinished(id);
    const c = board.row(id).review!.codeReview!;
    expect(c.pending).toBe(true);
    workers.reviews.applyMode(id, c.handover, 'manual');
    
    workers.reviews.interrupted();
    await until(() => reviewers().length === 2, 15000);
    expect(board.item(id)!.review?.codeReview).toMatchObject({ mode: 'manual', state: 'running', runs: 2 });
    expect(itemsOf(id)[1]!.status).toBe('fixing');
  });

  test('a mode change while a handover checks Git is retained', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    const c = board.row(id).review!.codeReview!;
    const pending = workers.reviews.handedOver(id, c.handover, 'auto');
    workers.reviews.applyMode(id, c.handover, 'manual');
    workers.reviews.interrupted();
    await pending;
    await until(() => !board.row(id).review?.codeReview?.pending, 15000);
    expect(board.row(id).review?.codeReview?.mode).toBe('manual');
  });

  test('a resubmission after a failed review is checked on reply', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    workers.message(id, 'Please revise it.');
    await handOver(id, 'revision.ts');
    await until(() => reviewers().length === 2);
    reviewers()[1]!.emit({ type: 'idle' });
    await until(() => board.item(id)!.review?.codeReview?.state === 'failed');
    workers.message(id, 'Please check this too.', [], false, undefined, undefined, { 3: 'ignore' });
    await worker().call('resubmit_review_item', { items: [{ number: 3, note: 'Fixed.' }] });
    await worker().call('reply', { text: 'Fixed.' });
    worker().emit({ type: 'text', text: 'Fixed.' });
    worker().emit({ type: 'idle' });
    await until(() => reviewers().length === 3);
  });

  test('a review gives verdicts on the items under review when it started; one resubmitted meanwhile waits for the next review', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    workers.message(id, '', [], false, undefined, undefined, { 1: 'self', 3: 'ignore' });
    await handOver(id, 'fix.ts');
    await until(() => reviewers().length === 2);
    await until(() => !!board.row(id).review?.codeReview?.review?.scope);
    expect(board.row(id).review?.codeReview?.review?.scope).toEqual([1]);
    
    expect(await worker().call('resubmit_review_item', { items: [{ number: 3, note: 'Named it.' }] })).toContain('Resubmitted: #3');
    const second = reviewers()[1]!;
    expect(second.inbox[0]).not.toContain('#3 “Name the constant”: A magic number.\n    The worker wrote');
    expect(second.call('review', { verdicts: [{ number: 1, fixed: true }, { number: 3, fixed: true }], regressions: [], items: [] })).toContain('#3 is not under review in your brief');
    await review(id, second, [], [{ number: 1, fixed: true }]);
    expect(statuses(id)).toEqual(['fixed', 'raised', 'underReview']);
    
    await until(() => reviewers().length === 3);
    const third = reviewers()[2]!;
    expect(third.inbox[0]).toContain('The worker wrote: Named it.');
    await until(() => board.row(id).review?.codeReview?.review?.scope?.length === 1);
    expect(board.row(id).review?.codeReview?.review?.scope).toEqual([3]);
    await review(id, third, [], [{ number: 3, fixed: true }]);
    expect(statuses(id)).toEqual(['fixed', 'raised', 'fixed']);
    expect(board.row(id).review?.codeReview?.review?.scope).toBeUndefined();
  });

  test('a handover of the same commit leaves a running review that verifies its items alone', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    workers.message(id, '', [], false, undefined, undefined, { 1: 'self' });
    await handOver(id, 'fix.ts');
    await until(() => reviewers().length === 2);
    await until(() => !!board.row(id).review?.codeReview?.review?.scope);
    
    await worker().call('ready_for_review', { summary: 'Nothing changed.', demo: artifact() });
    await until(() => !board.row(id).review?.codeReview?.pending);
    expect(reviewers()).toHaveLength(2);
    expect(reviewers()[1]!.closed).toBeFalsy();
    await review(id, reviewers()[1]!, [], [{ number: 1, fixed: true }]);
  });

  test('a follow-up owed its task cannot be resubmitted; merging that task into another keeps the link', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    workers.message(id, '', [], false, undefined, undefined, { 2: 'later' });
    expect(await worker().call('resubmit_review_item', { items: [{ number: 2, note: 'Fixed it too.' }] })).toContain('#2 is to be a follow-up task first');
    await worker().call('follow_up_task', { findings: [2], title: 'Serialize exports', task: 'Two exports at once overwrite each other.' });
    const task = board.items().find((i) => i.title === 'Serialize exports')!;
    const other = board.create({ title: 'Export queue' });
    board.merge(other.id, [task.id], 'Export queue');
    expect(itemsOf(id)[1]!.card).toBe(other.id);
  });

  test('items left under review after a done review get one after a restart', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    
    board.work(id, { review: { items: itemsOf(id).map((i) => (i.number === 1 ? { ...i, status: 'underReview' as const } : i)) } });
    workers.shutdown();
    reviewing('auto');
    workers.resumeAll();
    await until(() => reviewers().length === 2);
    expect(reviewers()[1]!.inbox[0]).toContain('Under review');
    await review(id, reviewers()[1]!, [], [{ number: 1, fixed: true }]);
    expect(statuses(id)).toEqual(['fixed', 'raised', 'raised']);
  });

  test('context the owner wrote on an item goes with it when they decide on it again', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    workers.message(id, '', [], false, undefined, undefined, { 1: 'self' }, { 1: 'Use a parameter.' });
    await handOver(id, 'fix.ts');
    await until(() => reviewers().length === 2);
    await review(id, reviewers()[1]!, [], [{ number: 1, fixed: true }]);
    workers.reviews.reopen(id, 1);
    workers.message(id, '', [], false, undefined, undefined, { 1: 'self' });
    expect(worker().inbox.at(-1)).toContain('- Fix these now:\n  #1 “SQL built from input”');
    expect(worker().inbox.at(-1)).toMatch(/Fix these now:\n  #1[^\n]*\n(    .*\n)*    The owner wrote: Use a parameter\./);
    
    await handOver(id, 'fix2.ts');
    await until(() => reviewers().length === 3);
    await review(id, reviewers()[2]!, [], [{ number: 1, fixed: false, why: 'Still concatenated.' }]);
    workers.message(id, '', [], false, undefined, undefined, { 1: 'self' }, { 1: '' });
    expect(itemsOf(id)[0]!.context).toBeUndefined();
    expect(worker().inbox.at(-1)).not.toContain('Use a parameter.');
  });

  test('a review resumed after a restart keeps the verdicts of its brief; an item resubmitted while it paused waits for the next review', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    workers.message(id, '', [], false, undefined, undefined, { 1: 'self', 3: 'ignore' });
    await handOver(id, 'fix.ts');
    await until(() => reviewers().length === 2);
    reviewers()[1]!.emit({ type: 'session', id: 'review-2' });
    await until(() => !!board.row(id).review?.codeReview?.review?.scope);
    workers.restartDue({ reason: 'code', deadline: Date.now() + 15 * 60_000 });
    reviewers()[1]!.emit({ type: 'idle' });
    expect(await worker().call('resubmit_review_item', { items: [{ number: 3, note: 'Named it.' }] })).toContain('Resubmitted: #3');
    workers.shutdown();
    reviewing('auto');
    workers.resumeAll();
    await until(() => reviewers().length === 3);
    const again = reviewers()[2]!;
    expect(again.spec.resume).toBe('review-2');
    await review(id, again, [], [{ number: 1, fixed: true }]);
    expect(statuses(id)).toEqual(['fixed', 'raised', 'underReview']);
    await until(() => reviewers().length === 4);
  });

  test('"Ignore" closes an item without a word to the worker; Reopen brings a closed or fixed one back', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    const before = worker().inbox.length;
    workers.message(id, '', [], false, undefined, undefined, { 3: 'ignore' });
    expect(worker().inbox.length).toBe(before);
    expect(statuses(id)).toEqual(['raised', 'raised', 'closed']);
    expect(board.events(id).at(-1)!.text).toBe(board.t.worker.findingDecided(3, itemsOf(id)[2]!.title, board.t.worker.findingIgnored));
    
    expect(() => workers.message(id, '', [], false, undefined, undefined, { 3: 'self' })).toThrow();
    expect(() => workers.reviews.reopen(id, 1)).toThrow();
    workers.reviews.reopen(id, 3);
    expect(statuses(id)).toEqual(['raised', 'raised', 'reopened']);
    expect(itemsOf(id)[2]!.log.map((e) => [e.who, e.to])).toEqual([['reviewer', 'raised'], ['owner', 'closed'], ['owner', 'reopened']]);
    workers.message(id, '', [], false, undefined, undefined, { 1: 'self', 2: 'ignore', 3: 'ignore' });
    const note = worker().inbox.at(-1)!;
    expect(note).toContain('#1 “SQL built from input”');
    
    expect(note).toContain('Closed (the owner ignored them; the review does not raise them again):\n  #2 “Race on a second handover”');
    expect(statuses(id)).toEqual(['fixing', 'closed', 'closed']);
    
    await handOver(id, 'fix.ts');
    await until(() => reviewers().length === 2);
    const brief = reviewers()[1]!.inbox[0]!;
    expect(brief).toContain('Closed (the owner ignored them');
    expect(brief).toContain('- #2 “Race on a second handover” (major, export.ts:40): Two exports at once overwrite each other.');
    expect(brief).toContain('- #3 “Name the constant” (minor): A magic number.');
    await review(id, reviewers()[1]!, [], [{ number: 1, fixed: true }]);
    
    workers.reviews.reopen(id, 1);
    expect(statuses(id)).toEqual(['reopened', 'closed', 'closed']);
    
    await handOver(id, 'again.ts');
    await until(() => reviewers().length === 3);
    await review(id, reviewers()[2]!, [{ title: 'New', text: 'One more.', severity: 'low', with: [1] }]);
    expect(itemsOf(id).map((i) => i.number)).toEqual([1, 2, 3, 4]);
    expect(itemsOf(id)[0]!.with).toEqual([4]);
  });

  test('manual: nothing runs until the owner starts it; a new handover makes it outdated', async () => {
    reviewing('manual');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => !!board.item(id)!.review?.codeReview);
    expect(board.item(id)!.review?.codeReview).toEqual({ mode: 'manual', items: [] });
    expect(reviewers()).toHaveLength(0);
    workers.startCodeReview(id);
    await until(() => reviewers().length === 1);
    
    expect(() => workers.startCodeReview(id)).toThrow();
    await review(id, reviewers()[0]!);
    expect(() => workers.startCodeReview(id)).toThrow();
    
    workers.message(id, 'One more column.');
    await handOver(id, 'column.ts');
    await until(() => board.item(id)!.review?.codeReview?.stale === true);
    expect(itemsOf(id)).toHaveLength(3);
    expect(reviewers()).toHaveLength(1);
    workers.startCodeReview(id);
    await until(() => reviewers().length === 2);
    expect(board.item(id)!.review?.codeReview!.stale).toBeUndefined();
    
    expect(itemsOf(id)).toHaveLength(3);
    await review(id, reviewers()[1]!, []);
    expect(itemsOf(id)).toHaveLength(3);
  });

  test('a finished review of a card waiting for approval survives a restart', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    workers.shutdown();
    reviewing('auto');
    workers.resumeAll();
    await workers.codeReviewsChanged();
    expect(itemsOf(id)).toHaveLength(3);
    expect(board.item(id)!.review?.codeReview?.state).toBe('done');
  });

  test('a git look that finds no work after a restart does not drop a finished review', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    const hasWork = spaces.hasWork;
    spaces.hasWork = async () => false;
    try {
      await workers.codeReviewsChanged();
    } finally {
      spaces.hasWork = hasWork;
    }
    expect(itemsOf(id)).toHaveLength(3);
    expect(board.item(id)!.review?.codeReview?.state).toBe('done');
  });

  test('a handed-over card without a review gets one on "Start code review", whatever the project setting', async () => {
    reviewing('auto', false);
    const id = await started();
    await handOver(id, 'export.ts');
    expect(board.item(id)!.review?.codeReview).toBeUndefined();
    workers.startCodeReview(id);
    await until(() => reviewers().length === 1);
    expect(board.item(id)!.review?.codeReview?.mode).toBe('manual');
    await review(id, reviewers()[0]!);
    expect(itemsOf(id)).toHaveLength(FINDINGS.length);
  });

  test('a review the owner started where the project reviews no work keeps its items across handovers, and verifies the fixes by itself', async () => {
    reviewing('auto', false);
    const id = await started();
    await handOver(id, 'export.ts');
    workers.startCodeReview(id);
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    workers.message(id, '', [], false, undefined, undefined, { 1: 'self', 2: 'self' });
    worker().call('dispute_review_item', { items: [{ number: 2, note: 'The exports are serialized upstream.' }] });
    await handOver(id, 'fix.ts');
    
    expect(statuses(id)).toEqual(['underReview', 'disputed', 'raised']);
    expect(itemsOf(id)[1]!.log.at(-1)).toMatchObject({ who: 'worker', from: 'fixing', to: 'disputed', note: 'The exports are serialized upstream.' });
    expect(board.item(id)!.review?.codeReview).toMatchObject({ mode: 'manual', state: 'running', runs: 2 });
    await until(() => reviewers().length === 2);
    expect(board.item(id)!.review?.codeReview?.mode).toBe('manual');
    expect(reviewers()[1]!.inbox[0]!).toContain('- #1 “SQL built from input”');
    await review(id, reviewers()[1]!, [{ title: 'Missing test', text: 'Nothing covers the fix.', severity: 'minor' }], [{ number: 1, fixed: true }]);
    expect(statuses(id)).toEqual(['fixed', 'disputed', 'raised', 'raised']);
    expect(itemsOf(id).map((i) => i.number)).toEqual([1, 2, 3, 4]);
    expect(board.item(id)!.review?.codeReview?.runs).toBe(2);
    
    const hasWork = spaces.hasWork;
    spaces.hasWork = async () => false;
    try {
      workers.message(id, 'Once more.');
      await worker().call('ready_for_review', { summary: 'Nothing new.', demo: artifact() });
      worker().emit({ type: 'idle' });
      const last = board.events(id).findLast((e) => e.kind === 'review' && e.author === 'worker')!.id;
      await until(() => board.row(id).review?.codeReview?.handover === last);
    } finally {
      spaces.hasWork = hasWork;
    }
    expect(itemsOf(id)).toHaveLength(4);
    expect(board.item(id)!.review?.codeReview).toMatchObject({ mode: 'manual', state: 'done' });
  });

  test('a fix that takes out the branch\'s last change is still verified, against the code as it is', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!, [FINDINGS[1]]);
    workers.message(id, '', [], false, undefined, undefined, { 1: 'self' });
    
    const ws = board.row(id).workstation!;
    git(ws, 'rm', '--quiet', 'export.ts');
    git(ws, 'commit', '--quiet', '-m', 'Take the export out again');
    await worker().call('ready_for_review', { summary: 'Took the export out again.', demo: artifact() });
    worker().emit({ type: 'idle' });
    await until(() => reviewers().length === 2);
    expect(statuses(id)).toEqual(['underReview']);
    expect(reviewers()[1]!.inbox[0]!).toContain('The branch no longer changes anything against main');
    await review(id, reviewers()[1]!, [], [{ number: 1, fixed: true }]);
    expect(statuses(id)).toEqual(['fixed']);
    expect(board.item(id)!.review?.codeReview?.state).toBe('done');
  });

  test('turning code reviews off keeps a review that ran, with its items, in manual mode', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    setting = { on: false, mode: 'auto' };
    await workers.codeReviewsChanged();
    expect(board.item(id)!.review?.codeReview).toMatchObject({ mode: 'manual', state: 'done' });
    expect(itemsOf(id)).toHaveLength(3);
  });

  test('a manually started review is pending immediately and resumes after restart', async () => {
    reviewing('manual');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => !!board.item(id)!.review?.codeReview);
    workers.startCodeReview(id);
    expect(board.row(id).review?.codeReview).toMatchObject({ pending: true, pendingStart: true });
    expect(board.item(id)!.review?.codeReview?.state).toBe('running');
    workers.reviews.interrupted();
    await until(() => reviewers().length === 1, 15000);
    expect(board.row(id).review?.codeReview?.pending).toBeUndefined();
    expect(reviewers()).toHaveLength(1);
  });

  test('a pending manual start does not launch from the old instance after shutdown', async () => {
    reviewing('manual');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => !!board.item(id)!.review?.codeReview);
    workers.startCodeReview(id);
    workers.reviews.shutdown();
    expect(() => workers.startCodeReview(id)).toThrow();
    workers.reviews.workerFinished(id);
    await Bun.sleep(50);
    expect(reviewers()).toHaveLength(0);
    expect(board.row(id).review?.codeReview?.pending).toBe(true);
  });

  test('a legacy running review without a count is counted before a newer handover', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    const c = board.row(id).review!.codeReview!;
    const { runs: _, ...legacy } = c;
    board.work(id, { review: { codeReview: { ...legacy, review: { ...legacy.review!, head: 'older' } } } });
    await workers.reviews.handedOver(id, c.handover, 'auto');
    await until(() => reviewers().length === 2, 15000);
    expect(board.item(id)!.review?.codeReview).toMatchObject({ state: 'running', runs: 2 });
  });

  test('a requested review starts even if the mode changes while Git answers', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    
    const c = board.row(id).review!.codeReview!;
    board.work(id, { review: { codeReview: { ...c, review: { ...c.review!, state: 'failed' } } } });
    workers.startCodeReview(id);
    workers.reviews.applyMode(id, c.handover, 'manual');
    await until(() => reviewers().length === 2, 15000);
    expect(board.item(id)!.review?.codeReview).toMatchObject({ mode: 'manual', state: 'running', runs: 2 });
  });

  test('a new review after cancellation shows its next number before Git answers', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    const { runs: _, ...legacy } = board.row(id).review!.codeReview!;
    board.work(id, { review: { codeReview: legacy } });
    workers.reviews.cancel(id);
    const c = board.row(id).review!.codeReview!;
    expect(c.runs).toBe(1);
    expect(c.review).toBeUndefined();
    workers.startCodeReview(id);
    expect(board.item(id)!.review?.codeReview).toMatchObject({ state: 'running', runs: 2 });
    await until(() => reviewers().length === 2, 15000);
  });

  test('a handover of the same commit keeps the review running, and it stands for that handover', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    
    workers.message(id, 'Does it handle empty meters?');
    await worker().call('ready_for_review', { summary: 'Yes: an empty file.' });
    worker().emit({ type: 'idle' });
    await new Promise((r) => setTimeout(r, 50));
    expect(reviewers()).toHaveLength(1);
    await review(id, reviewers()[0]!);
    expect(board.item(id)!.review?.codeReview!.stale).toBeUndefined();
  });

  test('a review the owner starts and then approves before it runs never starts', async () => {
    reviewing('manual');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => !!board.item(id)!.review?.codeReview);
    workers.startCodeReview(id);
    await workers.approve(id);
    await new Promise((r) => setTimeout(r, 100));
    expect(reviewers()).toHaveLength(0);
    expect(board.item(id)?.review?.codeReview?.state).toBeUndefined();
  });

  test('approving while the review runs stops it, and nothing of it stays', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await workers.approve(id);
    expect(reviewers()[0]!.closed).toBe(true);
    expect(board.item(id)?.review?.codeReview?.state).toBeUndefined();
  });

  test('items the worker resubmitted while the commit is unchanged still get a review; the follow-up tool leaves the owner\'s other choices alone', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    workers.message(id, '', [], false, undefined, undefined, { 1: 'self', 3: 'ignore' });
    
    expect(await worker().call('follow_up_task', { findings: [1], title: 'T', task: 'x' })).toContain('item 1 is fixing');
    expect(await worker().call('follow_up_task', { findings: [3], title: 'T', task: 'x' })).toContain('item 3 is closed');
    
    expect(await worker().call('follow_up_task', { findings: [2], title: 'T', task: 'x' })).toContain('item 2 is raised');
    expect(statuses(id)).toEqual(['fixing', 'raised', 'closed']);
    
    await worker().call('resubmit_review_item', { items: [{ number: 1 }] });
    await worker().call('ready_for_review', { summary: 'Done.', demo: artifact() });
    await until(() => reviewers().length === 2);
    expect(reviewers()[1]!.inbox[0]).toContain('Under review');
  });
});

describe('history of a reopened item', () => {
  test('the worker reads every earlier round, the reviewer how often it was reopened', () => {
    const at = '2026-11-08T00:00:00Z';
    const ev = (who: 'worker' | 'reviewer', to: ReviewItemStatus, note: string): ReviewItemEvent => ({ at, who, to, note });
    const item: ReviewItem = {
      number: 1, title: 'Race', text: 'x', severity: 'major', status: 'reopened',
      log: [ev('worker', 'underReview', 'checked A'), ev('reviewer', 'reopened', 'race A'), ev('worker', 'underReview', 'checked B'), ev('reviewer', 'reopened', 'race B')],
    };
    expect(reopenings(item)).toBe(2);
    expect(reopenings({ ...item, log: [] })).toBe(0);
    const worker = described(item);
    for (const n of ['checked A', 'race A', 'checked B', 'race B']) expect(worker).toContain(n);
    expect(worker.indexOf('race A')).toBeLessThan(worker.indexOf('race B'));
    
    for (const status of ['underReview', 'fixed'] as const) {
      const brief = listed([{ ...item, status }]);
      expect(brief).toContain('Reopened 2 times before');
      expect(brief).toContain('race A');
    }
  });
});
