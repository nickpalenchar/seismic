import { expect, test } from 'bun:test';
import { WindowsProcessSnapshot, processes } from '../../../llms/harnesses/processes';

test('cold Windows snapshots get more time and a later timeout is retried', () => {
  const timeouts: number[] = [];
  const output = JSON.stringify({ ProcessId: 42, ParentProcessId: process.pid, CreationDate: 'born' });
  const snapshot = new WindowsProcessSnapshot((timeout) => {
    timeouts.push(timeout);
    if (timeouts.length === 2) return { status: null, stdout: '', error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) };
    return { status: 0, stdout: output };
  });
  expect(snapshot.read()).toEqual([{ pid: 42, parent: process.pid, group: 42, born: 'born' }]);
  expect(snapshot.read()).toEqual([{ pid: 42, parent: process.pid, group: 42, born: 'born' }]);
  expect(timeouts).toEqual([15_000, 3_000, 15_000]);
});

test('failed cold snapshots retain the longer budget', () => {
  const timeouts: number[] = [];
  const snapshot = new WindowsProcessSnapshot((timeout) => {
    timeouts.push(timeout);
    return timeouts.length === 1 ? { status: null, stdout: '' } : { status: 0, stdout: '[]' };
  });
  expect(() => snapshot.read()).toThrow('Cannot inspect agent process ownership');
  expect(snapshot.read()).toEqual([]);
  expect(timeouts).toEqual([15_000, 15_000]);
});

test.skipIf(process.platform !== 'win32')('native Windows snapshot sees this process', () => {
  expect(processes(new Set([process.pid])).find((p) => p.pid === process.pid)).toMatchObject({ pid: process.pid });
}, 30_000);

test('the snapshot that leaves the event loop free keeps the same budgets', async () => {
  const timeouts: number[] = [];
  const output = JSON.stringify({ ProcessId: 42, ParentProcessId: process.pid, CreationDate: 'born' });
  const answer = (timeout: number) => {
    timeouts.push(timeout);
    if (timeouts.length === 2) return { status: null, stdout: '', error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) };
    return { status: 0, stdout: output };
  };
  const snapshot = new WindowsProcessSnapshot(answer, async (timeout) => answer(timeout));
  expect(await snapshot.readAsync()).toEqual([{ pid: 42, parent: process.pid, group: 42, born: 'born' }]);
  expect(await snapshot.readAsync()).toEqual([{ pid: 42, parent: process.pid, group: 42, born: 'born' }]);
  expect(timeouts).toEqual([15_000, 3_000, 15_000]);
});
