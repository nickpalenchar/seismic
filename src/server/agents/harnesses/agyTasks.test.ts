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

  const resumed = new TranscriptTail(file, true);
  appendFileSync(file, `${started('c/task-4', 'old')}\n`);
  expect(resumed.tasks()).toEqual([]);
  appendFileSync(file, `${started('c/task-5', 'new')}\n`);
  expect(resumed.tasks()).toEqual([{ id: 'c/task-5', description: 'new' }]);
});
