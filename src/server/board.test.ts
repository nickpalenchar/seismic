import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boundsOf, onCanvas, PLAN_COLLAPSED, sizeOf } from '../core/layout';
import type { PlanDoc } from '../core/plan-doc';
import { BadRequest, Board, pathOfRef, type PlanRead, repoOfRef } from './board';
import { Store } from './db';
import { heard } from './testing';

const ws = (key: string, done = false) => ({ key, label: key, title: `Title ${key}`, body: `Body ${key}`, done, inReview: false });
const docA: PlanDoc = { file: 'docs/plan/a.md', title: 'A', goal: 'Goal A', workstreams: [ws('W1', true), ws('W2'), ws('W3')], markdown: '# A\n\n## Goal\n\nGoal A\n' };
const docB: PlanDoc = { file: 'docs/plan/b.md', title: 'B', goal: 'Goal B', workstreams: [ws('W1')], markdown: '' };

let store: Store;
let docs: PlanDoc[];
let dirs: PlanRead['dirs'];
let board: Board;

beforeEach(() => {
  store = new Store(':memory:');
  docs = [docA];
  dirs = [];
  board = new Board(store, { id: 'shop', name: 'Shop', repos: [{ id: 'home', name: 'Home', path: '/r', branch: 'main' }] }, () => ({ docs, dirs }));
});

describe('plan docs', () => {
  test('a plan and its workstreams appear with state and text from the doc', () => {
    const { items } = board.snapshot();
    const [p, w1, w2, w3] = items;
    expect(p).toMatchObject({ kind: 'plan', title: 'A', source: 'plan', plan: { file: 'docs/plan/a.md', goal: 'Goal A' } });
    expect([w1, w2, w3].map((w) => [w!.label, w!.state, w!.parent])).toEqual([
      ['W1', 'live', p!.id],
      ['W2', 'planned', p!.id],
      ['W3', 'planned', p!.id],
    ]);
  });

  test('a plan gives its plan doc as written; a workstream or manual card has none', () => {
    const [p, w1] = board.snapshot().items;
    expect(board.planDoc(p!.id)).toEqual({ file: 'docs/plan/a.md', markdown: docA.markdown });
    docs = [{ ...docA, markdown: '# A\n\nEdited\n' }];
    board.docsChanged();
    expect(board.planDoc(p!.id).markdown).toBe('# A\n\nEdited\n');
    expect(() => board.planDoc(w1!.id)).toThrow(BadRequest);
    const c = board.create({ title: 'Own', x: 0, y: 0 });
    expect(() => board.planDoc(c.id)).toThrow(BadRequest);
  });

  test('placement is kept across reads and survives an edit of the doc', () => {
    const w2 = board.snapshot().items.find((i) => i.label === 'W2')!;
    board.patch(w2.id, { x: 700, y: 400 });
    docs = [{ ...docA, workstreams: [ws('W1', true), { ...ws('W2', true), title: 'Renamed' }, ws('W3')] }];
    board.docsChanged();
    expect(board.snapshot().items.find((i) => i.id === w2.id)).toMatchObject({ x: 700, y: 400, title: 'Renamed', state: 'live' });
  });

  test('older packed completed cards get room, and the repaired layout survives another read', () => {
    docs = [{ ...docA, workstreams: [ws('W1', true), ws('W2', true), ws('W3', true), ws('W4', true), ws('W5')] }];
    const initial = board.snapshot().items;
    const kids = initial.filter((i) => i.parent);
    // The old four-chip row, with the open card immediately below it.
    kids.forEach((k, n) => store.update(k.id, n < 4 ? { x: 30 + n * 216, y: 78 } : { x: 30, y: 162 }));
    board.docsChanged();
    const repaired = board.snapshot().items;
    const boxes = repaired.filter((i) => i.parent).map((i) => boundsOf(i, repaired));
    for (const [n, a] of boxes.entries()) for (const b of boxes.slice(n + 1)) {
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
    expect(repaired.filter((i) => i.parent).every((i) => i.x >= 30 && i.y >= 78)).toBe(true);
    board.docsChanged();
    expect(board.snapshot().items.map((i) => [i.id, i.x, i.y])).toEqual(repaired.map((i) => [i.id, i.x, i.y]));
  });

  test('refitting hidden completed cards keeps a collapsed plan beside its neighbours', () => {
    docs = [{ ...docA, workstreams: [ws('W1', true), ws('W2', true), ws('W3')] }];
    const [plan, w1, w2, w3] = board.snapshot().items;
    store.update(w1!.id, { x: 30, y: 78 });
    store.update(w2!.id, { x: 246, y: 78 });
    store.update(w3!.id, { x: 30, y: 162 });
    board.patch(plan!.id, { collapsed: true });
    board.create({ title: 'Neighbour', x: plan!.x + 500, y: plan!.y });
    board.docsChanged();
    expect(board.snapshot().items.find((i) => i.id === plan!.id)).toMatchObject({ x: plan!.x, y: plan!.y, collapsed: true });
  });

  test('a new workstream is placed below the existing ones', () => {
    const before = board.snapshot().items;
    const lowest = Math.max(...before.filter((i) => i.parent).map((i) => i.y));
    docs = [{ ...docA, workstreams: [...docA.workstreams, ws('W4')] }];
    board.docsChanged();
    const w4 = board.snapshot().items.find((i) => i.label === 'W4')!;
    expect(w4.y).toBeGreaterThan(lowest);
  });

  test('a new plan is placed clear of everything on the canvas', () => {
    const first = board.snapshot().items;
    docs = [docA, docB];
    board.docsChanged();
    const items = board.snapshot().items;
    const a = boundsOf(items.find((i) => i.title === 'A')!, items);
    const b = boundsOf(items.find((i) => i.title === 'B')!, items);
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.h);
    expect(first.length + 2).toBe(items.length);
  });

  test('a collapsed plan stays collapsed, takes the room of its head, and expands again', () => {
    const p = board.snapshot().items[0]!;
    board.patch(p.id, { collapsed: true });
    let items = board.snapshot().items;
    expect(items[0]).toMatchObject({ id: p.id, collapsed: true });
    expect(boundsOf(items[0]!, items)).toMatchObject({ w: PLAN_COLLAPSED[0], h: PLAN_COLLAPSED[1] });
    // its workstreams are still there, for its sheet and its marks
    expect(onCanvas(items).map((i) => i.id)).toEqual([p.id]);
    expect(items.filter((i) => i.parent === p.id)).toHaveLength(3);
    expect(() => board.patch(p.id, { collapsed: 'yes' as never })).toThrow(BadRequest);
    expect(() => board.patch(items[1]!.id, { collapsed: true })).toThrow(BadRequest);
    board.patch(p.id, { collapsed: false });
    items = board.snapshot().items;
    expect(items[0]!.collapsed).toBeUndefined();
    expect(onCanvas(items)).toHaveLength(4);
  });

  test('a card made without a place (from the phone) goes where there is room', () => {
    const c = board.create({ title: '' });
    const items = board.snapshot().items;
    const mine = boundsOf(items.find((i) => i.id === c.id)!, items);
    const clear = (b: ReturnType<typeof boundsOf>) => mine.x + mine.w <= b.x || b.x + b.w <= mine.x || mine.y + mine.h <= b.y || b.y + b.h <= mine.y;
    expect(onCanvas(items).filter((i) => i.id !== c.id && !i.parent).every((i) => clear(boundsOf(i, items)))).toBe(true);
    expect(() => board.create({ title: '', x: 1 })).toThrow(BadRequest);
  });

  test('the owner gives any card a priority, changes it and takes it off again', () => {
    const [p, , w2] = board.snapshot().items;
    const c = board.create({ title: 'Own', x: 0, y: 0 });
    board.patch(c.id, { priority: 'critical' });
    board.patch(p!.id, { priority: 'trivial' });
    board.patch(w2!.id, { priority: 'veryHigh' });
    const at = (id: string) => board.snapshot().items.find((i) => i.id === id)!;
    expect([at(c.id).priority, at(p!.id).priority, at(w2!.id).priority]).toEqual(['critical', 'trivial', 'veryHigh']);
    expect(() => board.patch(c.id, { priority: 'urgent' as never })).toThrow(BadRequest);
    board.patch(c.id, { priority: null });
    expect(at(c.id).priority).toBeUndefined();
  });

  test('the owner sets category, sub-category and complexity on any card, each on its own, and takes them off again', () => {
    const [p, , w2] = board.snapshot().items;
    const c = board.create({ title: 'Own', x: 0, y: 0 });
    const at = (id: string) => board.snapshot().items.find((i) => i.id === id)!;
    // a card from before the labels has none
    expect(at(c.id)).not.toHaveProperty('category');
    expect(at(c.id)).not.toHaveProperty('suggested');
    board.patch(c.id, { category: 'backend', complexity: 3 });
    board.patch(p!.id, { subcategory: 'bugFix' });
    board.patch(w2!.id, { category: 'dataMigration', subcategory: 'refactor', complexity: 8 });
    expect(at(c.id)).toMatchObject({ category: 'backend', complexity: 3 });
    expect(at(c.id).subcategory).toBeUndefined();
    expect(at(p!.id)).toMatchObject({ subcategory: 'bugFix' });
    expect(at(p!.id).category).toBeUndefined();
    expect(at(w2!.id)).toMatchObject({ category: 'dataMigration', subcategory: 'refactor', complexity: 8 });
    expect(() => board.patch(c.id, { category: 'design' as never })).toThrow(BadRequest);
    expect(() => board.patch(c.id, { subcategory: 'chore' as never })).toThrow(BadRequest);
    expect(() => board.patch(c.id, { complexity: 4 as never })).toThrow(BadRequest);
    expect(() => board.patch(c.id, { complexity: '3' as never })).toThrow(BadRequest);
    for (const complexity of [13, 21] as const) {
      board.patch(c.id, { complexity });
      expect(at(c.id).complexity).toBe(complexity);
    }
    board.patch(c.id, { category: null, complexity: null });
    expect(at(c.id).category).toBeUndefined();
    expect(at(c.id).complexity).toBeUndefined();
  });

  test("Seismic's suggestion fills only empty labels the owner never set, marked until the owner touches them", () => {
    const c = board.create({ title: 'Own', x: 0, y: 0 });
    const at = (id: string) => board.snapshot().items.find((i) => i.id === id)!;
    board.patch(c.id, { priority: 'high' });
    expect(board.suggestLabels(c.id, { category: 'frontend', subcategory: 'newFeature', complexity: 5, priority: 'low' })).toEqual(['category', 'subcategory', 'complexity']);
    // the owner's priority stands
    expect(at(c.id)).toMatchObject({ category: 'frontend', subcategory: 'newFeature', complexity: 5, priority: 'high', suggested: ['category', 'subcategory', 'complexity'] });
    // a second suggestion overwrites none of the first
    expect(board.suggestLabels(c.id, { category: 'backend', complexity: 2 })).toEqual([]);
    expect(at(c.id)).toMatchObject({ category: 'frontend', complexity: 5 });
    // the owner picks the same value: the mark goes, the value stays
    board.patch(c.id, { category: 'frontend' });
    expect(at(c.id)).toMatchObject({ category: 'frontend', suggested: ['subcategory', 'complexity'] });
    // another value
    board.patch(c.id, { complexity: 1 });
    expect(at(c.id)).toMatchObject({ complexity: 1, suggested: ['subcategory'] });
    // none: the label is empty, and Seismic does not suggest it again
    board.patch(c.id, { subcategory: null });
    expect(at(c.id).subcategory).toBeUndefined();
    expect(at(c.id)).not.toHaveProperty('suggested');
    expect(board.suggestLabels(c.id, { subcategory: 'bugFix' })).toEqual([]);
    expect(at(c.id).subcategory).toBeUndefined();
    // the owner's priority taken off is not suggested again either
    board.patch(c.id, { priority: null });
    expect(board.suggestLabels(c.id, { priority: 'medium' })).toEqual([]);
    expect(at(c.id).priority).toBeUndefined();
  });

  test("a suggestion fills a plan doc's cards too, skips values that are not on the lists, and leaves the plan doc alone", () => {
    const [p, , w2] = board.snapshot().items;
    const at = (id: string) => board.snapshot().items.find((i) => i.id === id)!;
    expect(board.suggestLabels(w2!.id, { category: 'docs', complexity: 7 as never, priority: 'medium' })).toEqual(['category', 'priority']);
    expect(at(w2!.id)).toMatchObject({ category: 'docs', priority: 'medium', suggested: ['category', 'priority'] });
    expect(at(w2!.id).complexity).toBeUndefined();
    expect(board.suggestLabels(p!.id, { subcategory: 'configuration' })).toEqual(['subcategory']);
    expect(at(p!.id)).toMatchObject({ subcategory: 'configuration', suggested: ['subcategory'] });
    expect(docs[0]!.markdown).toBe('# A\n\n## Goal\n\nGoal A\n');
  });

  test('a removed doc takes its plan into the archive; its return brings it back to its place', () => {
    const p = board.snapshot().items[0]!;
    board.patch(p.id, { x: -500, y: 42 });
    docs = [];
    board.docsChanged();
    expect(board.snapshot().items).toEqual([]);
    expect(board.archived().map((i) => [i.title, i.parent ?? null])).toEqual([
      ['A', null],
      ['Title W1', p.id],
      ['Title W2', p.id],
      ['Title W3', p.id],
    ]);
    docs = [docA];
    board.docsChanged();
    expect(board.snapshot().items[0]).toMatchObject({ id: p.id, x: -500, y: 42 });
    expect(board.archived()).toEqual([]);
  });

  test('one card of the archive is as the archive shows it, also asked for first after its doc went', () => {
    const [p, w1] = board.snapshot().items;
    docs = [];
    board.docsChanged();
    // nothing looked at the canvas since the doc went
    expect(board.card(p!.id)).toMatchObject({ kind: 'plan', title: 'A', archivedAt: expect.any(String) });
    board.changed();
    expect(board.card(w1!.id)).toEqual(board.archived()[1]!);
  });

  test('every workstream ticked off ends the plan; an open one added later brings it back to its place', () => {
    const p = board.snapshot().items[0]!;
    board.patch(p.id, { x: -500, y: 42 });
    const ticked = { ...docA, workstreams: docA.workstreams.map((w) => ({ ...w, done: true })) };
    docs = [ticked];
    board.docsChanged();
    expect(board.snapshot().items).toEqual([]);
    expect(board.archived().map((i) => [i.title, i.state])).toEqual([
      ['A', 'planned'],
      ['Title W1', 'live'],
      ['Title W2', 'live'],
      ['Title W3', 'live'],
    ]);
    docs = [{ ...ticked, workstreams: [...ticked.workstreams, ws('W4')] }];
    board.docsChanged();
    expect(board.snapshot().items.map((i) => i.label ?? i.title)).toEqual(['A', 'W1', 'W2', 'W3', 'W4']);
    expect(board.snapshot().items[0]).toMatchObject({ id: p.id, x: -500, y: 42 });
    expect(board.archived()).toEqual([]);
  });

  test('a workstream still at work keeps its plan on the canvas once every box is ticked', () => {
    const w2 = board.snapshot().items.find((i) => i.label === 'W2')!;
    board.work(w2.id, { state: 'working' });
    docs = [{ ...docA, workstreams: docA.workstreams.map((w) => ({ ...w, done: true })) }];
    board.docsChanged();
    expect(board.item(w2.id)!.state).toBe('working');
    // its worker done, the plan ends without reading the doc again
    board.work(w2.id, { state: 'live' });
    expect(board.snapshot().items).toEqual([]);
    expect(board.archived()[0]!.title).toBe('A');
  });

  test('a workstream whose worker finishes after the landing keeps its plan, as its doc last stood, once the doc is gone', () => {
    const w2 = board.snapshot().items.find((i) => i.label === 'W2')!;
    board.work(w2.id, { state: 'live', landed: JSON.stringify({ commit: 'abc' }), workstation: '/ws/1' });
    docs = [];
    board.docsChanged();
    expect(board.snapshot().items.map((i) => i.label ?? i.title)).toEqual(['A', 'W1', 'W2', 'W3']);
    expect(board.archived()).toEqual([]);
    // its worker done, the docs read again
    board.work(w2.id, { landed: null, workstation: null });
    board.docsChanged();
    expect(board.snapshot().items).toEqual([]);
    expect(board.archived()[0]!.title).toBe('A');
  });

  test('a doc whose work was done before Seismic first read it goes straight into the archive', () => {
    docs = [docA, { ...docB, workstreams: [ws('W1', true)] }];
    board.docsChanged();
    expect(board.snapshot().items.filter((i) => i.kind === 'plan').map((i) => i.title)).toEqual(['A']);
    expect(board.archived().map((i) => i.title)).toEqual(['B', 'Title W1']);
    // and stays there, read again
    board.docsChanged();
    expect(board.archived().map((i) => i.title)).toEqual(['B', 'Title W1']);
    expect(store.plans('shop')).toHaveLength(2);
  });

  test('work in progress wins over a ticked-off workstream until it has landed', () => {
    const w2 = board.snapshot().items.find((i) => i.label === 'W2')!;
    board.work(w2.id, { state: 'inPr' });
    docs = [{ ...docA, workstreams: [ws('W1', true), { ...ws('W2'), done: true }, ws('W3')] }];
    board.docsChanged();
    expect(board.item(w2.id)!.state).toBe('inPr');
    board.work(w2.id, { state: 'live' });
    expect(board.item(w2.id)!.state).toBe('live');
  });

  test('a stored live gives way to an empty box once the Lesestand holds what landed; a stored done stays', () => {
    const items = board.snapshot().items;
    const w2 = items.find((i) => i.label === 'W2')!;
    const w3 = items.find((i) => i.label === 'W3')!;
    // landed before the commit was kept, as a pull request; with its handover
    board.work(w2.id, { state: 'live', pr: JSON.stringify({ url: 'https://github.com/acme/app/pull/821', number: 821, seen: [], reported: [] }) });
    board.work(w3.id, { state: 'done' });
    board.docsChanged();
    expect(board.item(w2.id)).toMatchObject({ state: 'planned', landedPart: { pr: { url: 'https://github.com/acme/app/pull/821', number: 821 } } });
    expect(board.item(w2.id)!.pr).toBeUndefined();
    expect(board.events(w2.id).map((e) => e.text)).toEqual(['Teil gelandet, im Plan-Doc weiter offen.']);
    expect(board.item(w3.id)!.state).toBe('done');
    // reading again changes nothing more
    board.docsChanged();
    expect(board.events(w2.id)).toHaveLength(1);
    // what landed stays on the card while a new run does the rest
    board.work(w2.id, { state: 'working', branch: 'obeya/w2-rest' });
    expect(board.item(w2.id)).toMatchObject({ state: 'working', landedPart: { pr: { number: 821 } } });
  });

  test('plan cards are read-only apart from placement and state', () => {
    const [p, w1] = board.snapshot().items;
    expect(() => board.patch(w1!.id, { title: 'x' })).toThrow(BadRequest);
    expect(() => board.patch(p!.id, { state: 'working' })).toThrow(BadRequest);
    expect(() => board.remove(w1!.id)).toThrow(BadRequest);
  });
});

describe('the note on the plan directory', () => {
  test('lists the docs that are not plans, with the reason and the card preparing one', () => {
    dirs = [{ repo: 'home', dir: 'docs/plan', others: [{ file: 'docs/plan/rollout.md', reason: 'noWorkstreams' }, { file: 'docs/plan/rfc.md', reason: 'noChecklist' }] }];
    board.docsChanged();
    expect(board.snapshot().planDirs).toEqual([{ repo: 'home', dir: 'docs/plan', empty: false, others: dirs[0]!.others }]);
    const card = board.create({ title: 'rollout.md als Plan aufbereiten', x: 0, y: 0 });
    expect(board.snapshot().planDirs![0]!.others[0]).toEqual({ file: 'docs/plan/rollout.md', reason: 'noWorkstreams', preparing: card.id });
    // finished, it prepares nothing any more: the doc is a plan once its change has landed
    board.work(card.id, { state: 'done' });
    expect(board.snapshot().planDirs![0]!.others[0]!.preparing).toBeUndefined();
  });

  test('stays where the owner put it, wherever the plans go, and new plans go below it', () => {
    dirs = [{ repo: 'home', dir: 'docs/plan', others: [{ file: 'docs/plan/rollout.md', reason: 'noWorkstreams' }] }];
    board.docsChanged();
    expect(board.snapshot().planDirs![0]!.at).toBeUndefined();
    expect(() => board.movePlanDirNote('home', { x: 1 })).toThrow(BadRequest);
    expect(() => board.movePlanDirNote('elsewhere', { x: 1, y: 2 })).toThrow(BadRequest);
    board.movePlanDirNote('home', { x: 40.4, y: 3000 });
    expect(board.snapshot().planDirs![0]!.at).toEqual({ x: 40, y: 3000 });
    // a plan moved away leaves it there
    const a = board.snapshot().items.find((i) => i.kind === 'plan')!;
    board.patch(a.id, { x: a.x + 900, y: a.y - 400 });
    expect(board.snapshot().planDirs![0]!.at).toEqual({ x: 40, y: 3000 });
    docs = [docA, docB];
    board.docsChanged();
    const b = board.snapshot().items.find((i) => i.kind === 'plan' && i.plan?.file === docB.file)!;
    expect(b.y).toBeGreaterThan(3000);
  });

  test('says where plan docs go until the repository has its first plan, and not when every doc is one', () => {
    docs = [];
    dirs = [{ repo: 'home', dir: 'docs/plan', others: [] }];
    board.docsChanged();
    expect(board.snapshot().planDirs).toEqual([{ repo: 'home', dir: 'docs/plan', empty: true, others: [] }]);
    docs = [docA];
    board.docsChanged();
    expect(board.snapshot().planDirs).toBeUndefined();
    // its doc gone, the plan is in the archive: the repository has had one
    docs = [];
    board.docsChanged();
    expect(board.snapshot().planDirs).toBeUndefined();
  });
});

describe('the archive of plans', () => {
  test('an archived plan shows its doc as last read: goal, workstreams with text and state', () => {
    const w2 = board.snapshot().items.find((i) => i.label === 'W2')!;
    board.work(w2.id, { state: 'live', branch: 'obeya/w2' });
    docs = [{ ...docA, goal: 'Neues Ziel', workstreams: [ws('W1', true), { ...ws('W2', true), body: 'Zuletzt so' }, ws('W3')] }];
    board.docsChanged();
    board.snapshot();
    docs = [];
    board.docsChanged();
    board.snapshot();
    const [p, ...kids] = board.archived();
    expect(p).toMatchObject({ kind: 'plan', title: 'A', plan: { file: 'docs/plan/a.md', goal: 'Neues Ziel' }, archivedAt: expect.any(String) });
    expect(kids.map((k) => [k.label, k.state, k.body, k.archivedAt])).toEqual([
      ['W1', 'live', 'Body W1', p!.archivedAt],
      ['W2', 'live', 'Zuletzt so', p!.archivedAt],
      ['W3', 'planned', 'Body W3', p!.archivedAt],
    ]);
    // a workstream of an archived plan still opens, with its log
    expect(board.card(w2.id)).toMatchObject({ id: w2.id, branch: 'obeya/w2', parent: p!.id });
    expect(board.events(w2.id)).toEqual([]);
    expect(() => board.unarchive(p!.id)).toThrow(expect.objectContaining({ code: 'planCard' }));
  });

  test('a plan lists its decisions and those of the idea its doc was written from', () => {
    const idea = board.create({ idea: true, title: 'Idee B', x: 0, y: 0 });
    board.decide({ plan_id: null, card_id: idea.id, question: 'Idee „Idee B“: wie weiter?', answer: 'Als Plan.', by: 'owner' });
    board.work(idea.id, { state: 'live' });
    board.planDocsLanded(idea.id, ['docs/plan/b.md']);
    docs = [docA, docB];
    board.docsChanged();
    const b = board.snapshot().items.find((i) => i.title === 'B')!;
    expect(b.origin).toBe(idea.id);
    const w1 = board.snapshot().items.find((i) => i.parent === b.id)!;
    // one answered in the owner's name, as a plan agent did before workers asked the owner directly
    store.addDecision({ canvas_id: 'shop', plan_id: b.id, card_id: w1.id, question: 'Welche Spalten?', answer: 'Alle.', by: 'plan' });
    // the idea's card leaves the canvas; the plan still finds it
    board.archive([idea.id]);
    const h = board.planHistory(b.id);
    expect(h.decisions.map((d) => [d.cardId, d.answer, d.by])).toEqual([
      [idea.id, 'Als Plan.', 'owner'],
      [w1.id, 'Alle.', 'plan'],
    ]);
    expect(h.origin).toMatchObject({ id: idea.id, title: 'Idee B', archivedAt: expect.any(String), brief: '' });
    // and so does the archived plan
    docs = [docA];
    board.docsChanged();
    expect(board.archived().find((i) => i.id === b.id)!.origin).toBe(idea.id);
    expect(board.planHistory(b.id).decisions).toHaveLength(2);
    expect(board.planHistory(board.snapshot().items[0]!.id)).toEqual({ decisions: [], origin: null, talk: [] });
  });

  test('a follow-up in a crowded area stays near its origin instead of drifting far away', () => {
    const origin = board.create({ title: 'Origin', x: 5000, y: 5000 });
    // a dense wall of cards around and below the origin, with no gaps wide enough for a card
    for (let c = -8; c <= 8; c++) for (let r = -4; r <= 8; r++) if (c || r) board.create({ title: `W${c}-${r}`, x: 5000 + c * 310, y: 5000 + r * 140 });
    const next = board.create({ title: 'Next', from: origin.id });
    expect(Math.hypot(next.x - origin.x, next.y - origin.y)).toBeLessThan(400);
  });

  test('a plan takes the place of the idea it was written from; the idea goes once its worker is done', () => {
    const idea = board.create({ idea: true, title: 'Idee B', x: 900, y: 40 });
    const below = board.create({ title: 'Darunter', x: 900, y: 240 });
    const beside = board.create({ title: 'Daneben', x: 1240, y: 40 });
    const away = board.create({ title: 'Weit weg', x: 3000, y: 900 });
    board.work(idea.id, { state: 'live', landed: '{}', workstation: '/ws/1' });
    board.planDocsLanded(idea.id, ['docs/plan/b.md']);
    docs = [docA, docB];
    board.docsChanged();
    const items = board.snapshot().items;
    const b = items.find((i) => i.title === 'B')!;
    expect(b).toMatchObject({ origin: idea.id, x: 900, y: 40 });
    // what the larger plan would cover moves aside by as much as it outgrows the idea
    const [iw, ih] = sizeOf(board.item(idea.id)!, items);
    const [pw, ph] = sizeOf(b, items);
    expect(board.item(below.id)).toMatchObject({ x: 900, y: 240 + ph - ih });
    expect(board.item(beside.id)).toMatchObject({ x: 1240 + pw - iw, y: 40 });
    expect(board.item(away.id)).toMatchObject({ x: 3000, y: 900 });
    for (const i of [below, beside]) {
      const [p, c] = [boundsOf(b, items), boundsOf(board.item(i.id)!, items)];
      expect(c.x >= p.x + p.w || c.y >= p.y + p.h).toBe(true);
    }
    // its worker still finishes after the landing
    expect(board.item(idea.id)).toBeDefined();
    board.work(idea.id, { landed: null, workstation: null });
    board.workDone(idea.id);
    expect(board.item(idea.id)).toBeUndefined();
    expect(board.archived().find((i) => i.id === idea.id)).toMatchObject({ title: 'Idee B' });
    expect(board.events(idea.id).at(-1)!.text).toContain('an der Stelle der Idee');
    // put back on the canvas, it stays
    board.unarchive(idea.id);
    board.docsChanged();
    expect(board.item(idea.id)).toBeDefined();
  });

  test('only a card that was an idea, or a task planned as a plan, becomes the origin of a plan', () => {
    const plain = board.create({ title: 'Kein Idee', x: 0, y: 0 });
    board.planDocsLanded(plain.id, ['docs/plan/b.md']);
    docs = [docA, docB];
    board.docsChanged();
    expect(board.snapshot().items.find((i) => i.title === 'B')!.origin).toBeUndefined();
  });

  test('a task planned as a plan gives way to it as an idea does', () => {
    const task = board.create({ title: 'Aufgabe B', x: 900, y: 40 });
    board.work(task.id, { becomes_plan: 1 });
    expect(board.item(task.id)).toMatchObject({ becomesPlan: true });
    expect(board.item(task.id)!.brief).toBeUndefined();
    board.work(task.id, { state: 'live' });
    board.planDocsLanded(task.id, ['docs/plan/b.md']);
    docs = [docA, docB];
    board.docsChanged();
    expect(board.snapshot().items.find((i) => i.title === 'B')).toMatchObject({ origin: task.id, x: 900, y: 40 });
    expect(board.item(task.id)).toBeUndefined();
    expect(board.events(task.id).at(-1)!.text).toBe('Der Plan steht jetzt an der Stelle der Aufgabe; die Aufgabe liegt im Archiv.');
  });
});

describe('manual cards', () => {
  test('create, edit, delete and restore', async () => {
    let changes = 0;
    board.onChange(() => changes++);
    const c = board.create({ title: 'Fix it', x: 10, y: 20 });
    expect(c).toMatchObject({ kind: 'task', state: 'planned', title: 'Fix it', body: '', source: 'manual' });
    await heard();
    expect(changes).toBe(1);
    board.patch(c.id, { title: 'Fix it now', body: 'Details' });
    expect(board.snapshot().items.find((i) => i.id === c.id)).toMatchObject({ title: 'Fix it now', body: 'Details' });
    board.remove(c.id);
    expect(board.snapshot().items.some((i) => i.id === c.id)).toBe(false);
    board.restore(c.id);
    expect(board.snapshot().items.some((i) => i.id === c.id)).toBe(true);
    // what changed in a row, the listeners hear of once
    await heard();
    expect(changes).toBe(2);
  });

  test('a follow-up goes below the card it comes from, in its repository, and names it', () => {
    // clear of the plan plan (placed with the first snapshot), which a follow-up would step around
    board.snapshot();
    const src = board.create({ title: 'Export', x: 3000, y: 100 });
    const a = board.create({ title: 'Ton bleibt an', body: 'Der ambient-Ton läuft nach dem Stopp weiter.', from: src.id });
    expect(a).toMatchObject({ state: 'planned', from: src.id, repo: src.repo, body: 'Der ambient-Ton läuft nach dem Stopp weiter.' });
    expect(a.x).toBe(3035);
    expect(a.y).toBeGreaterThan(100);
    // the next one goes beside it
    const b = board.create({ title: 'Noch eine', from: src.id });
    expect(b.y).toBe(a.y);
    expect(b.x - a.x).toBeGreaterThan(boundsOf(a, board.snapshot().items).w);
    expect(() => board.create({ title: 'x', from: 'nope' })).toThrow(BadRequest);
    expect(() => board.create({ title: 'x', from: src.id, idea: true })).toThrow(BadRequest);
  });

  test('rejects invalid input', () => {
    expect(() => board.create({ title: 'x', x: Number.NaN, y: 0 })).toThrow(BadRequest);
    const c = board.create({ title: 'x', x: 0, y: 0 });
    expect(() => board.patch(c.id, { kind: 'plan' } as never)).toThrow(BadRequest);
    expect(() => board.patch(c.id, { state: 'gone' as never })).toThrow(BadRequest);
    expect(() => board.patch('nope', { x: 1 })).toThrow(BadRequest);
  });

  test('empty cards left over from a closed page are dropped on start; one with a text waits to be named', () => {
    const fresh = board.create({ title: '', x: 0, y: 0 });
    const old = board.create({ title: ' ', x: 0, y: 0 });
    const kept = board.create({ title: 'Echt', x: 0, y: 0 });
    const written = board.create({ title: '', body: 'Eine Aufgabe', x: 0, y: 0 });
    store.db.query("UPDATE cards SET created_at = '2020-01-01T00:00:00.000Z' WHERE id IN ($a, $b, $c)").run({ a: old.id, b: kept.id, c: written.id });
    const again = new Board(store, { id: 'shop', name: 'Shop', repos: [{ id: 'home', name: 'Home', path: '/r', branch: 'main' }] }, () => ({ docs, dirs: [] }));
    const ids = again.snapshot().items.map((i) => i.id);
    expect(ids).toContain(fresh.id);
    expect(ids).toContain(kept.id);
    expect(ids).toContain(written.id);
    expect(ids).not.toContain(old.id);
  });

  test('cards are persisted per canvas', () => {
    board.create({ title: 'mine', x: 0, y: 0 });
    const other = new Board(store, { id: 'other', name: 'Other', repos: [{ id: 'home', name: 'Home', path: '/o', branch: 'main' }] }, () => ({ docs: [], dirs: [] }));
    expect(other.snapshot().items).toEqual([]);
  });
});

describe('archive', () => {
  const done = (title: string) => {
    const c = board.create({ title, x: 10, y: 20 });
    board.patch(c.id, { state: 'live' });
    return c;
  };

  test('an archived card leaves the canvas and heads the archive until it goes back', async () => {
    const a = done('A');
    const b = done('B');
    board.archive([a.id]);
    await Bun.sleep(2);
    board.archive([b.id]);
    expect(board.snapshot().items.some((i) => i.id === a.id || i.id === b.id)).toBe(false);
    expect(board.archived().map((i) => [i.title, i.state, typeof i.archivedAt])).toEqual([
      ['B', 'live', 'string'],
      ['A', 'live', 'string'],
    ]);
    board.unarchive(b.id);
    expect(board.snapshot().items.find((i) => i.id === b.id)).toMatchObject({ x: 10, y: 20, state: 'live' });
    expect(board.archived().map((i) => i.title)).toEqual(['A']);
  });

  test('only finished cards of the owner go into the archive', () => {
    const open = board.create({ title: 'Open', x: 0, y: 0 });
    const w1 = board.snapshot().items.find((i) => i.label === 'W1')!;
    expect(() => board.archive([open.id])).toThrow(expect.objectContaining({ code: 'notDone' }));
    expect(() => board.archive([w1.id])).toThrow(expect.objectContaining({ code: 'planCard' }));
    expect(() => board.unarchive(open.id)).toThrow(expect.objectContaining({ code: 'notArchived' }));
    expect(board.archived()).toEqual([]);
  });

  test('a stopped task goes into the archive with its conversation, unless its workstation holds work or it waits to start', () => {
    const c = board.create({ title: 'Frage', body: 'Stimmt die Rechnung?', x: 50, y: 60 });
    board.work(c.id, { branch: 'obeya/frage-1', workstation: '/tmp/clone-1' });
    board.log(c.id, 'talk', 'worker', 'Sie stimmt.');
    board.log(c.id, 'state', 'owner', 'Gestoppt.');
    expect(() => board.archive([c.id])).toThrow(expect.objectContaining({ code: 'holdsWork' }));
    board.work(c.id, { workstation: null, queue: JSON.stringify({ checking: true, since: new Date().toISOString() }) });
    expect(() => board.archive([c.id])).toThrow(expect.objectContaining({ code: 'notDone' }));
    board.work(c.id, { queue: null });
    // archiving everything finished leaves it alone: it was stopped, not done
    expect(board.archiveDone()).toEqual([]);
    board.archive([c.id]);
    expect(board.snapshot().items.some((i) => i.id === c.id)).toBe(false);
    expect(board.archived()).toMatchObject([{ id: c.id, state: 'planned', branch: 'obeya/frage-1' }]);
    expect(board.events(c.id).map((e) => e.text)).toEqual(['Sie stimmt.', 'Gestoppt.']);
    board.unarchive(c.id);
    expect(board.snapshot().items.find((i) => i.id === c.id)).toMatchObject({ x: 50, y: 60, state: 'planned' });
  });

  test('a dropped idea goes into the archive with its brief, an open one does not', () => {
    const idea = board.create({ idea: true, title: 'Idee', x: 30, y: 40 });
    expect(() => board.archive([idea.id])).toThrow(expect.objectContaining({ code: 'notDone' }));
    board.setIdea(idea.id, { status: 'dropped', brief: '**Ziel:** nichts' });
    board.addPrototype(idea.id, 'Prototyp: Idee', 'zeigen');
    expect(() => board.archive([idea.id])).toThrow(expect.objectContaining({ code: 'prototypeRunning' }));
    board.remove(board.snapshot().items.find((i) => i.prototypeOf === idea.id)!.id);
    board.archive([idea.id]);
    expect(board.snapshot().items.some((i) => i.id === idea.id)).toBe(false);
    expect(board.archived()).toMatchObject([{ id: idea.id, state: 'idea', idea: { status: 'dropped', brief: '**Ziel:** nichts' } }]);
    // archiving everything finished leaves ideas alone
    expect(board.archiveDone()).toEqual([]);
    board.unarchive(idea.id);
    expect(board.snapshot().items.find((i) => i.id === idea.id)).toMatchObject({ x: 30, y: 40, idea: { status: 'dropped' } });
  });

  test('a parked idea goes into the archive and comes back parked', () => {
    const idea = board.create({ idea: true, title: 'Idee', x: 30, y: 40 });
    board.setIdea(idea.id, { status: 'parked', brief: '**Ziel:** ein Post' });
    board.addPrototype(idea.id, 'Prototyp: Idee', 'zeigen');
    expect(() => board.archive([idea.id])).toThrow(expect.objectContaining({ code: 'prototypeRunning' }));
    board.remove(board.snapshot().items.find((i) => i.prototypeOf === idea.id)!.id);
    board.archive([idea.id]);
    expect(board.archived()).toMatchObject([{ id: idea.id, state: 'idea', idea: { status: 'parked', brief: '**Ziel:** ein Post' } }]);
    expect(board.archiveDone()).toEqual([]);
    board.unarchive(idea.id);
    expect(board.snapshot().items.find((i) => i.id === idea.id)).toMatchObject({ x: 30, y: 40, idea: { status: 'parked' } });
  });

  test('archiving everything finished leaves the rest on the canvas', () => {
    const a = done('A');
    const b = done('B');
    const open = board.create({ title: 'Open', x: 0, y: 0 });
    expect(board.archiveDone().sort()).toEqual([a.id, b.id].sort());
    expect(board.snapshot().items.some((i) => i.id === open.id)).toBe(true);
    expect(board.archived()).toHaveLength(2);
    expect(board.archiveDone()).toEqual([]);
  });
});

describe('groups', () => {
  const groupOf = (id: string) => board.item(id)!.group;

  test('a new group takes its first cards and a colour no other group has', () => {
    const a = board.create({ title: 'A', x: 0, y: 0 });
    const b = board.create({ title: 'B', x: 400, y: 0 });
    const g1 = board.createGroup('  Abrechnung ', [a.id]);
    const g2 = board.createGroup('Infra', [b.id]);
    expect(g1.name).toBe('Abrechnung');
    expect(g1.hue).not.toBe(g2.hue);
    expect(board.snapshot().groups).toEqual([g1, g2]);
    expect([groupOf(a.id), groupOf(b.id)]).toEqual([g1.id, g2.id]);
  });

  test('a name a group has already puts the cards into that group', () => {
    const a = board.create({ title: 'A', x: 0, y: 0 });
    const b = board.create({ title: 'B', x: 400, y: 0 });
    const g = board.createGroup('Abrechnung', [a.id]);
    expect(board.createGroup('abrechnung', [b.id])).toEqual(g);
    expect(board.snapshot().groups).toHaveLength(1);
    expect(groupOf(b.id)).toBe(g.id);
  });

  test('cards move between groups and out of them; a group no card belongs to goes', () => {
    const a = board.create({ title: 'A', x: 0, y: 0 });
    const b = board.create({ title: 'B', x: 400, y: 0 });
    const g1 = board.createGroup('Eins', [a.id, b.id]);
    const g2 = board.createGroup('Zwei', [a.id]);
    board.group([b.id], g2.id);
    expect(board.snapshot().groups.map((g) => g.id)).toEqual([g2.id]);
    expect(() => board.group([a.id], g1.id)).toThrow(BadRequest);
    board.group([a.id], null);
    expect(groupOf(a.id)).toBeUndefined();
    expect(groupOf(b.id)).toBe(g2.id);
  });

  test('a group with only archived cards stays, and they come back in it', () => {
    const a = board.create({ title: 'A', x: 0, y: 0 });
    const b = board.create({ title: 'B', x: 400, y: 0 });
    const g = board.createGroup('Alt', [a.id]);
    board.work(a.id, { state: 'live' });
    board.archive([a.id]);
    board.group([b.id], null);
    expect(board.snapshot().groups.map((x) => x.id)).toEqual([g.id]);
    board.unarchive(a.id);
    expect(groupOf(a.id)).toBe(g.id);
  });

  test('a plan is grouped as a whole: a workstream stands for it and colours with it', () => {
    const [p, w1, w2] = board.snapshot().items;
    const g = board.createGroup('Plan', [w1!.id]);
    expect([groupOf(p!.id), groupOf(w1!.id), groupOf(w2!.id)]).toEqual([g.id, g.id, g.id]);
    board.group([w2!.id], null);
    expect(groupOf(p!.id)).toBeUndefined();
  });

  test('proposals, follow-ups and prototypes come into the group of the card they come from', () => {
    const a = board.create({ title: 'A', x: 0, y: 0 });
    const idea = board.create({ idea: true, title: 'Idee', x: 800, y: 0 });
    const g = board.createGroup('Familie', [a.id, idea.id]);
    const proposal = board.propose(a.id, { title: 'Vorschlag', task: 't', reason: 'r' });
    const followUp = board.create({ title: 'Folge', from: a.id });
    const prototype = board.addPrototype(idea.id, 'Prototyp', 'b');
    expect([proposal, followUp, prototype].map((i) => groupOf(i.id))).toEqual([g.id, g.id, g.id]);
    // from a workstream: its plan's group
    const w = board.snapshot().items.find((i) => i.label === 'W2')!;
    const h = board.createGroup('Projekt', [w.id]);
    expect(groupOf(board.create({ title: 'Folge W2', from: w.id }).id)).toBe(h.id);
    // once there, a card's group is its own
    board.group([a.id], null);
    expect(groupOf(proposal.id)).toBe(g.id);
  });

  test('a plan written from an idea takes its group', () => {
    const idea = board.create({ idea: true, title: 'Idee B', x: 900, y: 40 });
    const g = board.createGroup('Ideen', [idea.id]);
    board.work(idea.id, { state: 'live', landed: '{}', workstation: '/ws/1' });
    board.planDocsLanded(idea.id, ['docs/plan/b.md']);
    docs = [docA, docB];
    board.docsChanged();
    expect(board.snapshot().items.find((i) => i.title === 'B')!.group).toBe(g.id);
  });

  test('renaming keeps the cards; a name another group has is refused', () => {
    const a = board.create({ title: 'A', x: 0, y: 0 });
    const b = board.create({ title: 'B', x: 400, y: 0 });
    const g = board.createGroup('Alt', [a.id]);
    board.createGroup('Anders', [b.id]);
    board.renameGroup(g.id, 'Neu');
    expect(board.snapshot().groups[0]).toMatchObject({ id: g.id, name: 'Neu' });
    expect(groupOf(a.id)).toBe(g.id);
    expect(() => board.renameGroup(g.id, 'anders')).toThrow(BadRequest);
    board.renameGroup(g.id, 'NEU');
    expect(board.snapshot().groups[0]!.name).toBe('NEU');
  });

  test('deleting a group takes all its cards out, archived ones too, and it comes back in its colour', () => {
    const a = board.create({ title: 'A', x: 0, y: 0 });
    const b = board.create({ title: 'B', x: 400, y: 0 });
    const c = board.create({ title: 'C', x: 800, y: 0 });
    const g = board.createGroup('Alt', [a.id, b.id]);
    const other = board.createGroup('Anders', [c.id]);
    board.work(b.id, { state: 'live' });
    board.archive([b.id]);
    const gone = board.deleteGroup(g.id);
    expect(gone).toEqual({ group: g, cards: [a.id, b.id] });
    expect(board.snapshot().groups).toEqual([other]);
    const archived = (id: string) => board.archived().find((i) => i.id === id)!.group;
    expect([groupOf(a.id), archived(b.id), groupOf(c.id)]).toEqual([undefined, undefined, other.id]);
    expect(() => board.deleteGroup(g.id)).toThrow(BadRequest);
    // back, as the undo brings it
    const back = board.createGroup(gone.group.name, gone.cards, gone.group.hue);
    expect(back).toMatchObject({ name: 'Alt', hue: g.hue });
    expect([groupOf(a.id), archived(b.id)]).toEqual([back.id, back.id]);
    expect(() => board.createGroup('Neu', [a.id], 400)).toThrow(BadRequest);
  });

  test('rejects invalid input', () => {
    const a = board.create({ title: 'A', x: 0, y: 0 });
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as BadRequest).code;
      }
    };
    expect(code(() => board.createGroup('  ', [a.id]))).toBe('emptyText');
    expect(code(() => board.createGroup('x'.repeat(61), [a.id]))).toBe('invalid');
    expect(code(() => board.createGroup('Leer', []))).toBe('invalid');
    expect(code(() => board.createGroup('X', ['nope']))).toBe('unknownCard');
    expect(code(() => board.createGroup('X', 'a' as unknown as string[]))).toBe('invalid');
    expect(code(() => board.group([a.id], 'nope'))).toBe('unknownGroup');
    expect(code(() => board.renameGroup('nope', 'X'))).toBe('unknownGroup');
    expect(board.snapshot().groups).toEqual([]);
  });

  test('groups are kept per canvas', () => {
    const a = board.create({ title: 'A', x: 0, y: 0 });
    const g = board.createGroup('Hier', [a.id]);
    const other = new Board(store, { id: 'other', name: 'Other', repos: [{ id: 'home', name: 'Home', path: '/r', branch: 'main' }] }, () => ({ docs: [], dirs: [] }));
    const b = other.create({ title: 'B', x: 0, y: 0 });
    expect(other.snapshot().groups).toEqual([]);
    expect(() => other.group([b.id], g.id)).toThrow(BadRequest);
    expect(() => other.group([a.id], null)).toThrow(BadRequest);
  });
});

describe('waiting since', () => {
  test('card updates expose the stored update time without resetting the wait', () => {
    const c = board.create({ title: 'Updated demo', x: 0, y: 0 });
    board.work(c.id, { state: 'waiting', need: 'demo' });
    const since = board.item(c.id)!.waitingSince;
    store.db.query("UPDATE cards SET updated_at = '2020-01-01T00:00:00Z' WHERE id = ?").run(c.id);
    board.work(c.id, { detail: JSON.stringify({ summary: 'Revised demo ready' }) });
    expect(board.item(c.id)!.updatedAt).toBe(store.card(c.id)!.updated_at);
    expect(Date.parse(board.item(c.id)!.updatedAt!)).toBeGreaterThan(Date.parse('2020-01-01T00:00:00Z'));
    expect(board.item(c.id)!.waitingSince).toBe(since);
  });

  test('a card notes when it starts to wait for the owner, keeps it while it waits and forgets it after', () => {
    const c = board.create({ title: 'Own', x: 0, y: 0 });
    expect(board.item(c.id)!.waitingSince).toBeUndefined();
    board.work(c.id, { state: 'waiting', need: 'demo' });
    const since = board.item(c.id)!.waitingSince!;
    expect(Date.now() - Date.parse(since)).toBeLessThan(5000);
    // a change while it waits keeps the time, and so does a new board on the same database (a restart)
    board.work(c.id, { status_line: 'Demo fertig' });
    expect(board.item(c.id)!.waitingSince).toBe(since);
    const again = new Board(store, { id: 'shop', name: 'Shop', repos: [{ id: 'home', name: 'Home', path: '/r', branch: 'main' }] }, () => ({ docs, dirs }));
    expect(again.item(c.id)!.waitingSince).toBe(since);
    board.work(c.id, { state: 'working', need: null });
    expect(board.item(c.id)!.waitingSince).toBeUndefined();
    expect(store.waitingSince('shop').size).toBe(0);
  });
});

describe('a demo on the card', () => {
  test('a video without a poster says so, for the player to show its first frame; one with a poster does not', () => {
    const dir = (files: string[]) => {
      const d = mkdtempSync(join(tmpdir(), 'obeya-demo-'));
      for (const f of files) writeFileSync(join(d, f), f);
      return d;
    };
    const [bare, framed] = [dir(['demo.mp4', 'captions.vtt']), dir(['demo.mp4', 'captions.vtt', 'poster.jpg'])];
    const c = board.create({ title: 'Video', x: 0, y: 0 });
    board.work(c.id, {
      state: 'working',
      branch: 'obeya/video',
      demo: JSON.stringify({ kind: 'video', dir: framed, chapters: [[0, 'Danach']], handover: 2 }),
      demos: JSON.stringify([{ kind: 'video', dir: bare, chapters: [[0, 'Vorher']], handover: 1 }]),
    });
    const item = board.item(c.id)!;
    expect(item.demo).toEqual({ kind: 'video', chapters: [[0, 'Danach']], handover: 2 });
    expect(item.demos).toEqual([{ kind: 'video', chapters: [[0, 'Vorher']], handover: 1, noPoster: true, n: 0 }]);
    for (const d of [bare, framed]) rmSync(d, { recursive: true, force: true });
  });
});

describe('a plan reference', () => {
  test('names its repository before the path, unless it is the home one; an absolute path or a Windows drive is no repository', () => {
    const refs = ['docs/plan/a.md', 'api:docs/plan/a.md', '/home/jo/plans/a.md', 'api:/home/jo/plans/a.md', 'C:/plans/a.md', 'api:C:/plans/a.md'];
    expect(refs.map((r) => [repoOfRef(r, 'home'), pathOfRef(r)])).toEqual([
      ['home', 'docs/plan/a.md'],
      ['api', 'docs/plan/a.md'],
      ['home', '/home/jo/plans/a.md'],
      ['api', '/home/jo/plans/a.md'],
      ['home', 'C:/plans/a.md'],
      ['api', 'C:/plans/a.md'],
    ]);
  });
});


/** The code of the refusal `act` meets. */
function refusal(act: () => void): string | undefined {
  try {
    act();
  } catch (e) {
    if (e instanceof BadRequest) return e.code;
    throw e;
  }
}

describe('owner-drawn dependencies', () => {
  test('connections survive a new board, reject cycles, and can be removed independently', () => {
    const a = board.create({ title: 'A', x: 0, y: 0 });
    const b = board.create({ title: 'B', x: 0, y: 0 });
    const c = board.create({ title: 'C', x: 0, y: 0 });
    board.connect(a.id, b.id);
    board.connect(b.id, c.id);
    expect(board.item(b.id)?.manualDependsOn).toEqual([a.id]);
    expect(refusal(() => board.connect(c.id, a.id))).toBe('dependencyCycle');
    const reopened = new Board(store, board.canvas, () => ({ docs, dirs }));
    expect(reopened.item(c.id)?.manualDependsOn).toEqual([b.id]);
    reopened.connect(a.id, b.id, true);
    expect(reopened.item(b.id)?.manualDependsOn).toBeUndefined();
    expect(reopened.item(c.id)?.manualDependsOn).toEqual([b.id]);
  });
});

test("a deleted card's arrows count for nothing until it is restored, and come back without closing a cycle", () => {
  const a = board.create({ title: 'A', x: 0, y: 0 });
  const x = board.create({ title: 'X', x: 0, y: 0 });
  const c = board.create({ title: 'C', x: 0, y: 0 });
  board.connect(a.id, x.id);
  board.connect(x.id, c.id);
  board.remove(x.id);
  expect(board.item(c.id)?.manualDependsOn).toBeUndefined();
  board.connect(c.id, a.id);
  expect(board.item(a.id)?.manualDependsOn).toEqual([c.id]);
  board.restore(x.id);
  expect(board.item(x.id)?.manualDependsOn).toEqual([a.id]);
  expect(board.item(c.id)?.manualDependsOn).toBeUndefined();
  expect(board.manualDependencies()).toEqual([[c.id, a.id], [a.id, x.id]]);
});

test("an archived card's arrows come back with it, without closing a cycle", () => {
  const a = board.create({ title: 'A', x: 0, y: 0 });
  const x = board.create({ title: 'X', x: 0, y: 0 });
  const c = board.create({ title: 'C', x: 0, y: 0 });
  board.connect(a.id, x.id);
  board.connect(x.id, c.id);
  board.patch(x.id, { state: 'live' });
  board.archive([x.id]);
  board.connect(c.id, a.id);
  board.unarchive(x.id);
  expect(board.manualDependencies()).toEqual([[c.id, a.id], [a.id, x.id]]);
});

test('owner-drawn dependencies cannot connect plans or their workstreams', () => {
  const own = board.create({ title: 'Own task', x: 0, y: 0 });
  const plan = board.snapshot().items.find((i) => i.kind === 'plan')!;
  const workstream = board.snapshot().items.find((i) => i.parent === plan.id)!;
  for (const card of [plan, workstream]) {
    expect(refusal(() => board.connect(own.id, card.id))).toBe('planDependency');
    expect(refusal(() => board.connect(card.id, own.id))).toBe('planDependency');
  }
});

test('manual attachment points survive reopening and legacy arrows remain readable', () => {
  const a = board.create({ title: 'A', x: 0, y: 0 });
  const b = board.create({ title: 'B', x: 0, y: 0 });
  const c = board.create({ title: 'C', x: 0, y: 0 });
  const anchor = { fromSide: 'right', toSide: 'top', offset: 0.25 } as const;
  board.connect(a.id, b.id, false, anchor);
  board.connect(b.id, c.id);
  const reopened = new Board(store, board.canvas, () => ({ docs, dirs }));
  expect(reopened.item(b.id)?.manualAnchors?.[a.id]).toEqual(anchor);
  expect(reopened.item(c.id)?.manualDependsOn).toEqual([b.id]);
  expect(reopened.item(c.id)?.manualAnchors).toBeUndefined();
  expect(() => board.connect(a.id, c.id, false, { ...anchor, offset: 2 })).toThrow(BadRequest);
});
