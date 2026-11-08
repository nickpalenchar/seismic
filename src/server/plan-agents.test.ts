import { beforeEach, describe, expect, test } from 'bun:test';
import type { PlanDoc } from '../core/plan-doc';
import { Board } from './board';
import { Store } from './store';
import { PlanAgents } from './plan-agents';
import { FakeRuntime } from './testing';

const doc: PlanDoc = {
  file: 'docs/plan/a.md',
  title: 'Export',
  goal: 'G',
  workstreams: [{ key: 'W1', label: 'W1', title: 'CSV', body: '', done: false, inReview: false }],
  markdown: '',
};

let board: Board;
let runtime: FakeRuntime;
let agents: PlanAgents;
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  board = new Board(new Store(':memory:'), { id: 'c', name: 'C', repos: [{ id: 'home', name: 'Home', path: '/repo', branch: 'main' }] }, () => ({ docs: [doc], dirs: [] }));
  runtime = new FakeRuntime();
  agents = new PlanAgents(board, runtime, () => '/repo');
});

const plan = () => board.snapshot().items.find((i) => i.kind === 'plan')!;
const card = () => board.snapshot().items.find((i) => i.plan?.label === 'W1')!;

describe('plan agents', () => {
  test("answer the owner's question in a session with a worker's tools on the repository, with the decision log", async () => {
    board.decide({ plan_id: plan().id, card_id: card().id, question: 'Trennzeichen?', answer: 'Semikolon', by: 'owner' });
    const answer = agents.inform(plan(), 'Was macht W1 als Nächstes?', () => {});
    await tick();
    const s = runtime.last;
    expect(s.spec).toMatchObject({ cwd: '/repo' });
    expect(s.spec.readOnly).toBeUndefined();
    expect(s.inbox[0]).toContain('Was macht W1 als Nächstes?');
    expect(s.inbox[0]).toContain('Trennzeichen? → Semikolon (owner)');
    s.call('answer_owner', { text: 'Es baut den CSV-Export.' });
    expect(await answer).toEqual({ text: 'Es baut den CSV-Export.' });
    s.emit({ type: 'idle' });
    expect(s.closed).toBe(true);
  });

  test('one session per plan, resumed; questions wait for each other', async () => {
    const r1 = agents.inform(plan(), 'Q1', () => {});
    const r2 = agents.inform(plan(), 'Q2', () => {});
    await tick();
    expect(runtime.sessions).toHaveLength(1);
    runtime.last.emit({ type: 'session', id: 'p-1' });
    runtime.last.call('answer_owner', { text: 'A1' });
    runtime.last.emit({ type: 'idle' });
    await r1;
    await tick();
    expect(runtime.sessions).toHaveLength(2);
    expect(runtime.last.spec.resume).toBe('p-1');
    runtime.last.call('answer_owner', { text: 'A2' });
    expect(await r2).toEqual({ text: 'A2' });
  });
});
