import { afterEach, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { finished, started } from './agyTasksFixture';
import { agyTranscriptLog, applyLines, TranscriptTail, type AgyTask } from './agyTasks';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const status = (id: string) => JSON.stringify({ step_index: 4, type: 'GENERIC', status: 'DONE', content: `Task: ${id}\nStatus: RUNNING\n` });

test('a task runs from its start step to its finish message; status checks and noise change nothing', () => {
  const running = new Map<string, AgyTask>();
  applyLines(running, [started('c/task-2', 'sleep 40'), status('c/task-2'), 'not json', '42', 'null', started('c/task-3', 'bun test')]);
  expect([...running.values()]).toEqual([{ id: 'c/task-2', description: 'sleep 40' }, { id: 'c/task-3', description: 'bun test' }]);
  applyLines(running, [finished('c/task-2')]);
  expect([...running.values()]).toEqual([{ id: 'c/task-3', description: 'bun test' }]);
});

test('the tail reads whole lines as the file grows and can leave a resumed conversation\'s history out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-tail-'));
  dirs.push(dir);
  const file = agyTranscriptLog(dir, 'c');
  const tail = new TranscriptTail(file);
  expect(tail.tasks()).toEqual([]);
  mkdirSync(dirname(file), { recursive: true });
  const line = started('c/task-2', 'sleep 40');
  writeFileSync(file, `${line.slice(0, 30)}`);
  expect(tail.tasks()).toEqual([]);
  appendFileSync(file, `${line.slice(30)}\n`);
  expect(tail.tasks()).toEqual([{ id: 'c/task-2', description: 'sleep 40' }]);
  appendFileSync(file, `${finished('c/task-2')}\n`);
  expect(tail.tasks()).toEqual([]);

  appendFileSync(file, `${started('c/task-4', 'old')}\n`);
  const resumed = new TranscriptTail(file, true);
  expect(resumed.tasks()).toEqual([]);
  appendFileSync(file, `${started('c/task-5', 'new')}\n`);
  expect(resumed.tasks()).toEqual([{ id: 'c/task-5', description: 'new' }]);
});


test('quoted task messages and steps with the wrong metadata cannot start or finish tasks', () => {
  const running = new Map<string, AgyTask>();
  const start = JSON.parse(started('c/task-2', 'sleep 40'));
  const finish = JSON.parse(finished('c/task-2'));
  for (const change of [{ source: 'USER' }, { source: 'TOOL' }, { type: 'AGENT_RESPONSE' }, { status: 'DONE' }, { status: 'ERROR' }, { source: undefined }, { content: `Example: ${start.content}` }, { content: start.content.replace('Tool is', 'Quoted tool is') }]) {
    applyLines(running, [JSON.stringify({ ...start, ...change })]);
    expect([...running.values()]).toEqual([]);
  }
  applyLines(running, [JSON.stringify(start)]);
  for (const change of [{ source: 'MODEL' }, { status: 'RUNNING' }, { content: `Example: ${finish.content}` }, { content: finish.content.replace('sender=c/task-2', 'sender=other') }]) {
    applyLines(running, [JSON.stringify({ ...finish, ...change })]);
    expect(running.size).toBe(1);
  }
  applyLines(running, [JSON.stringify(finish)]);
  expect(running.size).toBe(0);
});

test('resume captures missing files and incomplete historical lines at construction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-tail-'));
  dirs.push(dir);
  const file = join(dir, 'transcript.jsonl');
  const absent = new TranscriptTail(file, true);
  const line = started('c/task-2', 'new');
  writeFileSync(file, `${line}\n`);
  expect(absent.tasks()).toEqual([{ id: 'c/task-2', description: 'new' }]);
  writeFileSync(file, line.slice(0, 30));
  const partial = new TranscriptTail(file, true);
  appendFileSync(file, line.slice(30, 60));
  expect(partial.tasks()).toEqual([]);
  appendFileSync(file, `${line.slice(60)}\n${started('c/task-3', 'after resume')}\n`);
  expect(partial.tasks()).toEqual([{ id: 'c/task-3', description: 'after resume' }]);
});

test('UTF-8 task descriptions survive every byte boundary, including one-byte appends', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-tail-'));
  dirs.push(dir);
  const file = join(dir, 'transcript.jsonl');
  const description = 'echo café 日本語 🚀';
  const bytes = Buffer.from(`${started('c/task-2', description)}\n`);
  for (let split = 1; split < bytes.length; split++) {
    writeFileSync(file, bytes.subarray(0, split));
    const tail = new TranscriptTail(file);
    expect(tail.tasks()).toEqual([]);
    appendFileSync(file, bytes.subarray(split));
    expect(tail.tasks()).toEqual([{ id: 'c/task-2', description }]);
  }
  writeFileSync(file, '');
  const tail = new TranscriptTail(file);
  for (const byte of bytes) {
    appendFileSync(file, Buffer.from([byte]));
    tail.tasks();
  }
  expect(tail.tasks()).toEqual([{ id: 'c/task-2', description }]);
  appendFileSync(file, `${finished('c/task-2')}\n`);
  expect(tail.tasks()).toEqual([]);
});

test('resuming in a UTF-8 character skips only the historical line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-tail-'));
  dirs.push(dir);
  const file = join(dir, 'transcript.jsonl');
  const old = Buffer.from(`${started('c/task-1', 'echo 🚀')}\n`);
  const split = old.indexOf(Buffer.from('🚀')) + 1;
  writeFileSync(file, old.subarray(0, split));
  const tail = new TranscriptTail(file, true);
  appendFileSync(file, old.subarray(split));
  expect(tail.tasks()).toEqual([]);
  appendFileSync(file, `${started('c/task-2', 'echo café 日本語 🚀')}\n`);
  expect(tail.tasks()).toEqual([{ id: 'c/task-2', description: 'echo café 日本語 🚀' }]);
});

test('truncation resets pending UTF-8 bytes along with the partial line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-tail-'));
  dirs.push(dir);
  const file = join(dir, 'transcript.jsonl');
  writeFileSync(file, Buffer.concat([Buffer.from('an old partial line '), Buffer.from('🚀').subarray(0, 2)]));
  const tail = new TranscriptTail(file);
  expect(tail.read()).toEqual([]);
  writeFileSync(file, 'fresh\n');
  expect(tail.read()).toEqual(['fresh']);
  appendFileSync(file, `${started('c/task-2', 'echo 日本語 🚀')}\n`);
  expect(tail.tasks()).toEqual([{ id: 'c/task-2', description: 'echo 日本語 🚀' }]);
});
