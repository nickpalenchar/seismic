import { SeismicModel } from '../../../llms/models/seismicModel';
import { expect, test } from 'bun:test';
import { z } from 'zod';
import { FakeRuntime } from '../../helpers/testing';
import { SeismicJob } from '../../../llms/agents/seismicJob';

class Probe extends SeismicJob<string> {
  readonly name = 'probe';
  readonly description = 'A test job.';
  text: string | undefined;
  protected answer() {
    return this.text === undefined ? undefined : { value: this.text };
  }
  getPrompt() {
    return 'Answer.';
  }
  getBrief() {
    return 'The question.';
  }
  getJobTools() {
    return [{ name: 'answer', description: 'The answer.', schema: { text: z.string() }, run: (a: { text?: unknown }) => { this.text = String(a.text); return this.finish('Recorded.'); } }];
  }
}

test('a job is a read-only session of the chores role that reads its brief', () => {
  const runtime = new FakeRuntime();
  void new Probe().run(runtime, { cwd: '/w' });
  expect(runtime.last.spec).toMatchObject({ cwd: '/w', role: 'chores', permission: 'readOnly', system: 'Answer.' });
  expect(runtime.last.spec.setting).toBeUndefined();
  expect(runtime.last.inbox).toEqual(['The question.']);
});

class Looks extends Probe {
  override readonly role = 'koordinator' as const;
  override readonly capabilities = { images: 'optional' } as const;
}

const model = (inputModalities: string[]) => new SeismicModel('codex', 'm', { model: 'm', isDefault: true, supportedReasoningEfforts: [], inputModalities });

test('a job runs under the role it names, and its capabilities are checked against the model it gets', () => {
  const runtime = new FakeRuntime();
  void new Looks().run(runtime, { cwd: '/w', images: ['/w/shot.png'] });
  expect(runtime.last.spec).toMatchObject({ role: 'koordinator', permission: 'readOnly' });
  const check = runtime.last.spec.checkModel!(model(['text']));
  expect([check.ok, check.degraded]).toEqual([true, ['images']]);
  const plain = new FakeRuntime();
  void new Probe().run(plain, { cwd: '/w' });
  expect(plain.last.spec.checkModel).toBeUndefined();
});

test('it settles with the value its tools collected when one finishes it', async () => {
  const runtime = new FakeRuntime();
  const done = new Probe().run(runtime, { cwd: '/w' });
  expect(runtime.last.call('answer', { text: 'x' })).toBe('Recorded.');
  expect(await done).toEqual({ ok: true, value: 'x' });
});

test('it settles with an error where its turn ends without an answer, and with the message of one that ended it', async () => {
  const runtime = new FakeRuntime();
  const idle = new Probe().run(runtime, { cwd: '/w' });
  runtime.last.emit({ type: 'idle' });
  expect(await idle).toEqual({ ok: false, error: 'probe ended without an answer' });
  expect(runtime.last.closed).toBe(true);
  const failed = new Probe().run(runtime, { cwd: '/w' });
  runtime.last.emit({ type: 'error', message: 'no login' });
  expect(await failed).toEqual({ ok: false, error: 'no login' });
});

test('an answer the tools gave stands where the session errors afterwards', async () => {
  const runtime = new FakeRuntime();
  const done = new Probe().run(runtime, { cwd: '/w' });
  runtime.last.call('answer', { text: 'y' });
  runtime.last.emit({ type: 'error', message: 'late' });
  expect(await done).toEqual({ ok: true, value: 'y' });
});

test('the usage limit hook and where it shows reach the session', () => {
  const runtime = new FakeRuntime();
  const onLimit = () => {};
  void new Probe().run(runtime, { cwd: '/w', onLimit, at: { card: 'c1' }, images: ['a.png'] });
  expect(runtime.last.spec).toMatchObject({ onLimit, at: { card: 'c1' } });
  expect(runtime.last.images).toEqual([['a.png']]);
});
