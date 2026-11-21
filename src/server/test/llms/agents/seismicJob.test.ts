import { SeismicModel } from '../../../llms/models/seismicModel';
import { expect, test } from 'bun:test';
import { z } from 'zod';
import { FakeRuntime, heard } from '../../helpers/testing';
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
  async getBrief() {
    return 'The question.';
  }
  getJobTools() {
    return [{ name: 'answer', description: 'The answer.', schema: { text: z.string() }, run: (a: { text?: unknown }) => { this.text = String(a.text); return this.finish('Recorded.'); } }];
  }
}

test('a job is a read-only session of the chores role that reads its brief', async () => {
  const runtime = new FakeRuntime();
  void new Probe().run(runtime, { cwd: '/w' });
  await heard();
  expect(runtime.last.spec).toMatchObject({ cwd: '/w', role: 'chores', permission: 'readOnly', system: 'Answer.' });
  expect(runtime.last.spec.setting).toBeUndefined();
  expect(runtime.last.inbox).toEqual(['The question.']);
});

class Looks extends Probe {
  override readonly role = 'koordinator' as const;
  override readonly capabilities = { images: 'optional' } as const;
}

const model = (inputModalities: string[]) => new SeismicModel('codex', 'm', { model: 'm', isDefault: true, supportedReasoningEfforts: [], inputModalities });

test('a job runs under the role it names, and its capabilities are checked against the model it gets', async () => {
  const runtime = new FakeRuntime();
  void new Looks().run(runtime, { cwd: '/w', images: ['/w/shot.png'] });
  await heard();
  expect(runtime.last.spec).toMatchObject({ role: 'koordinator', permission: 'readOnly' });
  const check = runtime.last.spec.checkModel!(model(['text']));
  expect([check.ok, check.degraded]).toEqual([true, ['images']]);
  const plain = new FakeRuntime();
  void new Probe().run(plain, { cwd: '/w' });
  await heard();
  expect(plain.last.spec.checkModel).toBeUndefined();
});

test('it settles with the value its tools collected when one finishes it', async () => {
  const runtime = new FakeRuntime();
  const done = new Probe().run(runtime, { cwd: '/w' });
  await heard();
  expect(runtime.last.call('answer', { text: 'x' })).toBe('Recorded.');
  expect(await done).toEqual({ ok: true, value: 'x' });
});

test('it settles with an error where its turn ends without an answer, and with the message of one that ended it', async () => {
  const runtime = new FakeRuntime();
  const idle = new Probe().run(runtime, { cwd: '/w' });
  await heard();
  runtime.last.emit({ type: 'idle' });
  expect(await idle).toEqual({ ok: false, error: 'probe ended without an answer' });
  expect(runtime.last.closed).toBe(true);
  const failed = new Probe().run(runtime, { cwd: '/w' });
  await heard();
  runtime.last.emit({ type: 'error', message: 'no login' });
  expect(await failed).toEqual({ ok: false, error: 'no login' });
});

test('an answer the tools gave stands where the session errors afterwards', async () => {
  const runtime = new FakeRuntime();
  const done = new Probe().run(runtime, { cwd: '/w' });
  await heard();
  runtime.last.call('answer', { text: 'y' });
  runtime.last.emit({ type: 'error', message: 'late' });
  expect(await done).toEqual({ ok: true, value: 'y' });
});

test('the usage limit hook and where it shows reach the session', async () => {
  const runtime = new FakeRuntime();
  const onLimit = () => {};
  void new Probe().run(runtime, { cwd: '/w', onLimit, at: { card: 'c1' }, images: ['a.png'] });
  await heard();
  expect(runtime.last.spec).toMatchObject({ onLimit, at: { card: 'c1' } });
  expect(runtime.last.images).toEqual([['a.png']]);
});

class Reads extends Probe {
  constructor(private reading: Promise<string>) {
    super();
  }
  override getBrief() {
    return this.reading;
  }
}

test('a brief that has to be read first starts the session once it is read', async () => {
  const runtime = new FakeRuntime();
  let ready!: (brief: string) => void;
  const done = new Reads(new Promise<string>((resolve) => (ready = resolve))).run(runtime, { cwd: '/w' });
  expect(runtime.sessions).toHaveLength(0);
  ready('Read from git.');
  await Bun.sleep(0);
  expect(runtime.last.inbox).toEqual(['Read from git.']);
  runtime.last.call('answer', { text: 'x' });
  expect(await done).toEqual({ ok: true, value: 'x' });
});

test('a brief that cannot be read ends the job with why, and starts no session', async () => {
  const runtime = new FakeRuntime();
  const result = await new Reads(Promise.reject(new Error('git failed'))).run(runtime, { cwd: '/w' });
  expect(result).toEqual({ ok: false, error: 'git failed' });
  expect(runtime.sessions).toHaveLength(0);
});
