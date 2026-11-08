// Code reviews of a card's work where its project reviews work that lands on main: a separate,
// read-only agent of the "Code reviews" group, started with the demo or on the owner's word, whose
// findings the owner sends to the worker to fix or makes follow-up tasks.

import { describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generic } from '../adapters/generic';
import type { RepoAdapter } from '../adapters/types';
import { type AgentSetting, type CodeReviewSetting, needsYou, type Severity } from '../core/types';
import { artifact, type FakeSession, until } from './testing';
import { Workers } from './workers';
import { git } from './workstations';
import { board, eachTest, manual, runtime, setWorkers, spaces, state, workers } from './workers-fixture';

eachTest();

let setting: CodeReviewSetting;
let followed: [string, string][];

/** Workers on a project that reviews work as `on` and `mode` say, in a repository where work lands as `land` says. */
function reviewing(mode: CodeReviewSetting['mode'] = 'auto', on = true, land: RepoAdapter['land'] = 'main', reviewAgentSetting?: () => AgentSetting) {
  setting = { on, mode };
  followed = [];
  setWorkers(
    new Workers({
      board,
      runtime,
      workstations: spaces,
      adapter: { ...generic, land, workstations: 'clones' },
      codeReviews: () => setting,
      ...(reviewAgentSetting ? { reviewAgentSetting } : {}),
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
  await until(() => runtime.sessions.length > 0);
  return c.id;
}

const FINDINGS = [
  { title: 'SQL built from input', text: 'The export query concatenates the file name.', severity: 'critical', file: 'export.ts', line: 12, security: true },
  { title: 'Race on a second handover', text: 'Two exports at once overwrite each other.', severity: 'major', file: 'export.ts', line: 40 },
  { title: 'Name the constant', text: 'A magic number.', severity: 'minor', with: [2] },
];

/** The running review of card `id` records `findings` and its turn ends. */
async function review(id: string, s: FakeSession, findings: unknown[] = FINDINGS) {
  expect(s.call('findings', { findings })).toContain('Recorded');
  s.emit({ type: 'idle' });
  await until(() => board.item(id)!.review?.codeReview?.state === 'done');
}

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
    expect(board.item(id)!.review?.codeReview).toEqual({ mode: 'manual' });
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

  test('work that goes through a pull request gets none: the forge reviews it', async () => {
    reviewing('auto', true, 'pr');
    const id = await started();
    await handOver(id, 'export.ts');
    await new Promise((r) => setTimeout(r, 30));
    expect(board.item(id)!.review?.codeReview).toBeUndefined();
    expect(reviewers()).toHaveLength(0);
  });

  test('automatic: the review starts with the demo, read-only, and the card goes to the owner at once', async () => {
    reviewing('auto');
    board.addPreference('Agents speak and write to me in English only.');
    const id = await started();
    await handOver(id, 'export.ts');
    expect(state(id)).toBe('waiting:demo');
    await until(() => reviewers().length === 1);
    expect(board.item(id)!.review?.codeReview).toEqual({ mode: 'auto', state: 'running', findings: [] });
    const r = reviewers()[0]!;
    expect(r.spec.system).toContain('- Agents speak and write to me in English only.');
    expect(r.spec.tools.find((t) => t.name === 'findings')!.description).toContain('unless an explicit standing preference names another language');
    expect(r.spec.readOnly).toBe(true);
    expect(r.spec.cwd).toBe(board.row(id).workstation!);
    expect(r.inbox[0]).toContain('Zählerstände exportieren');
    expect(r.inbox[0]).toContain('+export.ts');
    expect(r.spec.system).toContain('CLAUDE.md');
    await review(id, r);
    const done = board.item(id)!.review?.codeReview!;
    expect(done.state).toBe('done');
    expect(done.findings!.map((f) => [f.id, f.severity, f.file, f.line])).toEqual([
      [1, 'critical', 'export.ts', 12],
      [2, 'major', 'export.ts', 40],
      [3, 'minor', undefined, undefined],
    ]);
    // bundles hold in both directions
    expect(done.findings![1]!.with).toEqual([3]);
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
    const stored = () => JSON.parse(board.row(id).code_review!) as { pending?: true; review?: { state: string } };
    // a second handover is pending while the first review ends
    board.work(id, { code_review: JSON.stringify({ ...stored(), pending: true }) });
    reviews.finish(id, null, undefined, 'x');
    expect(stored().pending).toBe(true);
    expect(stored().review!.state).toBe('failed');
    expect(needsYou(board.item(id)!)).toBe(false);
    // a restart starts the review the handover (of a newer commit) was about to start
    board.work(id, { code_review: JSON.stringify({ ...stored(), review: { ...stored().review, head: 'older' } }) });
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
    workers.restartDue({ reason: 'code', deadline: Date.now() + 15 * 60_000 });
    expect(first.inbox.at(-1)).toContain('Pause it now');
    // it ends its turn without findings: paused, not failed, and the restart no longer waits for it
    first.emit({ type: 'idle' });
    expect(workers.busyCards()).not.toContain(id);
    expect(board.item(id)!.review?.codeReview!.state).toBe('running');
    // Seismic restarts: the review goes on in its session
    workers.shutdown();
    reviewing('auto');
    workers.resumeAll();
    await until(() => reviewers().length === 2);
    const again = reviewers()[1]!;
    expect(again.spec.resume).toBe('review-1');
    expect(again.inbox[0]).toContain('Seismic has restarted');
    await review(id, again);
    expect(board.item(id)!.review?.codeReview!.findings).toHaveLength(3);
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
    expect(fresh.inbox[0]).toContain('The branch');
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
    expect(board.item(id)!.review?.codeReview!.findings!.map((f) => f.severity)).toEqual(severities);
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

  test('review answers can start a fresh worker with only the selected findings', async () => {
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
    expect(fresh.inbox[0]).not.toContain('Name the constant');
    expect(board.item(id)!.review?.codeReview!.findings!.map((f) => f.status)).toEqual(['open', 'open', 'dropped']);
  });

  test('"Fix it" and "As a follow-up task" go to the worker with the Send; the next handover is fixed and reviewed anew', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    // only a review card's findings go to a contributor
    expect(() => workers.message(id, '', [], false, undefined, undefined, { 1: 'contributor' })).toThrow();
    workers.message(id, 'The race matters most.', [], false, undefined, undefined, { 1: 'self', 2: 'later', 3: 'later' });
    const note = worker().inbox.at(-1)!;
    expect(note).toContain('code review of your work');
    expect(note).toContain('#1 “SQL built from input” (critical, export.ts:12)');
    expect(note).toContain('as the review bundled them (findings 2 + 3)');
    expect(note).toContain('The race matters most.');
    expect(board.item(id)!.review?.codeReview!.findings!.map((f) => f.decided)).toEqual(['self', 'later', 'later']);
    // a decided finding is not decided again
    expect(() => workers.message(id, '', [], false, undefined, undefined, { 1: 'later' })).toThrow();
    // the follow-up tasks come first
    expect(await handOver(id, 'fix.ts')).toContain('follow-up tasks');
    expect(await worker().call('follow_up_task', { findings: [2, 3], title: 'Serialize exports', task: 'Two exports at once overwrite each other.' })).toContain('until your work has landed');
    const task = board.items().find((i) => i.title === 'Serialize exports')!;
    expect(task.from).toBe(id);
    expect(task.body).toContain('Zählerstände exportieren');
    expect(followed).toEqual([[task.id, id]]);
    expect(board.item(id)!.review?.codeReview!.findings!.map((f) => f.status)).toEqual(['open', 'later', 'later']);
    await worker().call('ready_for_review', { summary: 'Fixed.', demo: artifact() });
    // the fix is in: the finding reads fixed until the new review of the new commit replaces it
    await until(() => reviewers().length === 2);
    expect(board.item(id)!.review?.codeReview!.state).toBe('running');
    expect(board.item(id)!.review?.codeReview!.previous![0]!.findings.map((f) => f.status)).toEqual(['fixed', 'later', 'later']);
    const brief = reviewers()[1]!.inbox[0]!;
    expect(brief).toContain('handled separately, so leave out anything that raises one of them again');
    expect(brief).toContain('- Race on a second handover (export.ts:40): Two exports at once overwrite each other.');
    expect(brief).toContain('- Name the constant: A magic number.');
    expect(brief).toContain(`(follow-up task: ${task.id})`);
    expect(brief).not.toContain('- SQL built from input');
    // Later reviews still know, even when the immediately preceding review has no findings.
    await review(id, reviewers()[1]!, []);
    workers.message(id, 'Add another column.');
    await handOver(id, 'column.ts');
    await until(() => reviewers().length === 3);
    expect(reviewers()[2]!.inbox[0]).toContain('- Race on a second handover (export.ts:40): Two exports at once overwrite each other.');
    expect(reviewers()[2]!.inbox[0]).toContain(`(follow-up task: ${task.id})`);

  });

  test('"Ignore" settles a finding without a word to the worker; with other choices only those go', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    await review(id, reviewers()[0]!);
    const before = worker().inbox.length;
    workers.message(id, '', [], false, undefined, undefined, { 3: 'ignore' });
    expect(worker().inbox.length).toBe(before);
    expect(board.item(id)!.review?.codeReview!.findings!.map((f) => f.status)).toEqual(['open', 'open', 'dropped']);
    expect(board.events(id).at(-1)!.text).toBe(board.t.worker.findingDecided(3, board.item(id)!.review!.codeReview!.findings![2]!.title, board.t.worker.findingIgnored));
    // an ignored finding is not decided again
    expect(() => workers.message(id, '', [], false, undefined, undefined, { 3: 'self' })).toThrow();
    workers.message(id, '', [], false, undefined, undefined, { 1: 'self', 2: 'ignore' });
    const note = worker().inbox.at(-1)!;
    expect(note).toContain('#1 “SQL built from input”');
    expect(note).not.toContain('#2');
    expect(board.item(id)!.review?.codeReview!.findings!.map((f) => [f.status, f.decided])).toEqual([['open', 'self'], ['dropped', undefined], ['dropped', undefined]]);
    // the next review is told what the owner ignored, and so is the one after it
    await handOver(id, 'fix.ts');
    await until(() => reviewers().length === 2);
    expect(reviewers()[1]!.inbox[0]).toContain('The owner ignored these findings');
    expect(reviewers()[1]!.inbox[0]).toContain('- Race on a second handover (export.ts:40): Two exports at once overwrite each other.');
    expect(reviewers()[1]!.inbox[0]).toContain('- Name the constant: A magic number.');
    expect(reviewers()[1]!.inbox[0]).not.toContain('- SQL built from input');
    await review(id, reviewers()[1]!);
    await handOver(id, 'again.ts');
    await until(() => reviewers().length === 3);
    expect(reviewers()[2]!.inbox[0]).toContain('- Name the constant: A magic number.');
  });

  test('manual: nothing runs until the owner starts it; a new handover makes it outdated', async () => {
    reviewing('manual');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => !!board.item(id)!.review?.codeReview);
    expect(board.item(id)!.review?.codeReview).toEqual({ mode: 'manual' });
    expect(reviewers()).toHaveLength(0);
    workers.startCodeReview(id);
    await until(() => reviewers().length === 1);
    // once running, not twice
    expect(() => workers.startCodeReview(id)).toThrow();
    await review(id, reviewers()[0]!);
    expect(() => workers.startCodeReview(id)).toThrow();
    // the worker hands over again with a new commit: the review is of an earlier handover
    workers.message(id, 'One more column.');
    await handOver(id, 'column.ts');
    await until(() => board.item(id)!.review?.codeReview?.stale === true);
    expect(board.item(id)!.review?.codeReview!.findings).toHaveLength(3);
    expect(reviewers()).toHaveLength(1);
    workers.startCodeReview(id);
    await until(() => reviewers().length === 2);
    expect(board.item(id)!.review?.codeReview!.stale).toBeUndefined();
    expect(board.item(id)!.review?.codeReview!.previous).toEqual([
      expect.objectContaining({ state: 'done', findings: expect.arrayContaining([expect.objectContaining({ title: 'Name the constant' })]) }),
    ]);
    await review(id, reviewers()[1]!);
    expect(board.item(id)!.review?.codeReview!.previous![0]!.findings).toHaveLength(3);
  });

  test('a handover of the same commit keeps the review running, and it stands for that handover', async () => {
    reviewing('auto');
    const id = await started();
    await handOver(id, 'export.ts');
    await until(() => reviewers().length === 1);
    // an answer to the owner's words, handed over without a new commit
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
});
