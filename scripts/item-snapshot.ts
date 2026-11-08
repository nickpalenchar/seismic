// The equality check of a change to the data layer (docs/design/data.md, the decision on the data
// layer): reads every project of a database as the code of two commits sees it, each on a copy of
// its own, and says where they differ.
//   bun scripts/item-snapshot.ts [db] [--before <commit>] [--after <commit>] [--out <dir>]
// `db` defaults to ~/.obeya/obeya.db, which is only read (through SQLite's own snapshot, as a
// running Seismic writes to it); `--before` to `main`, `--after` to this checkout as it is. Each
// side runs in a checkout of its own (a detached worktree for a commit) on its own copy of one snapshot of the database,
// and writes what it read to `<out>/<side>.json`: each project's snapshot (the cards as the UI gets
// them, its groups, canvases, chat and preferences), its archive, every card's history and agent
// runs, and the Koordinator's reads (its talk, the timeline, what the owner said, decisions, the
// Activity log, feedback), plus the project export. No agent runs and no repository is touched:
// the plan docs are the ones the database kept on its plan cards.
// Exits 1 when the two differ, naming the first differences.

import { Database } from 'bun:sqlite';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

if (process.argv[2] === '--inner') {
  await inner(process.argv[3]!, process.argv[4]!, process.argv[5]!);
  process.exit(0);
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const before = flag('--before') ?? 'main';
const after = flag('--after');
const out = resolve(flag('--out') ?? mkdtempSync(join(tmpdir(), 'obeya-item-snapshot-')));
const db = resolve(args[0] ?? join(homedir(), '.obeya', 'obeya.db'));
mkdirSync(out, { recursive: true });

const worktrees: string[] = [];
/** A checkout of `commit` with this checkout's dependencies; this checkout itself without one. */
function checkout(commit: string | undefined): string {
  if (!commit) return root;
  const dir = mkdtempSync(join(tmpdir(), 'obeya-item-snapshot-code-'));
  const add = spawnSync('git', ['-C', root, 'worktree', 'add', '--detach', dir, commit], { encoding: 'utf8' });
  if (add.status) throw new Error(add.stderr);
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
  worktrees.push(dir);
  return dir;
}

// one snapshot of the database for both sides: a running Seismic writing between two would show as a difference of the code
const snapshot = join(out, 'source.db');
rmSync(snapshot, { force: true });
const source = new Database(db, { readonly: true });
source.run('VACUUM INTO ?', [snapshot]);
source.close();

/** What the code in `code` reads from a copy of its own of the snapshot (reading writes to it). */
function side(name: string, code: string): unknown {
  const copy = join(out, `${name}.db`);
  copyFileSync(snapshot, copy);
  const file = join(out, `${name}.json`);
  const run = spawnSync('bun', [join(root, 'scripts', 'item-snapshot.ts'), '--inner', code, copy, file], { stdio: 'inherit' });
  if (run.status) throw new Error(`the ${name} side failed`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

try {
  const a = regrouped(side('before', checkout(before)));
  const b = side('after', checkout(after));
  const diffs: string[] = [];
  diff(a, b, '', diffs);
  if (diffs.length) {
    console.log(`${diffs.length} difference${diffs.length === 1 ? '' : 's'} (${out}/before.json, after.json):`);
    for (const d of diffs.slice(0, 40)) console.log(`  ${d}`);
    process.exitCode = 1;
  } else console.log(`The same, project by project (${out}).`);
} finally {
  for (const dir of worktrees) spawnSync('git', ['-C', root, 'worktree', 'remove', '--force', dir]);
}

/**
 * The before side as the planned regroupings of the card model have it (docs/design/data.md),
 * for a before side from a commit that had not made them yet; one that had is left as it is.
 * W4, one hold: a stored card gets the `hold` its migration writes, a card as the UI gets it the
 * `hold` in place of `paused`, `pausing`, `limitPaused`, `restartPaused`, `snoozed` and `parkingLot`.
 * A pause or snooze counts from the migration, which reads as "now". W5: then grouped (`grouped`).
 * W8: a stored card has none of the columns whose values moved into its parts' tables.
 */
function regrouped(value: unknown): unknown {
  const rows = new Map<string, Record<string, unknown>>();
  const walk = (v: unknown, visit: (o: Record<string, unknown>) => unknown): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, visit));
    if (!v || typeof v !== 'object') return v;
    const o = visit(v as Record<string, unknown>) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, walk(x, visit)]));
  };
  const isRow = (o: Record<string, unknown>) => typeof o.id === 'string' && 'project_id' in o && 'paused' in o && !('hold' in o);
  // the stored cards first, whose pause at a safe point keeps its time
  walk(value, (o) => (isRow(o) && rows.set(o.id as string, o), o));
  const json = (x: unknown) => (typeof x === 'string' ? JSON.parse(x) : (x ?? null));
  const storedHold = (r: Record<string, unknown>) => {
    const paused = json(r.paused);
    const snoozed = json(r.snoozed);
    const held = paused?.held ? { held: paused.held } : {};
    if (snoozed) return { ...snoozed, reason: 'snoozed', since: 'now', ...(paused ? { held: paused.held ?? [] } : {}) };
    if (paused?.limit) {
      const { attempts, until, statusBefore } = paused.limit;
      return { reason: 'limit', since: 'now', attempts, ...(until ? { until } : {}), ...(statusBefore != null ? { statusBefore } : {}), ...held };
    }
    if (paused) return { reason: 'paused', since: 'now', ...held };
    if (r.pausing) return { reason: 'pausing', since: r.pausing };
    if (r.parking_lot) return { reason: 'parkingLot', since: r.parking_lot };
    return null;
  };
  const OLD = ['paused', 'pausing', 'limitPaused', 'restartPaused', 'snoozed', 'parkingLot'];
  const isItem = (o: Record<string, unknown>) => typeof o.id === 'string' && typeof o.kind === 'string' && !('project_id' in o) && OLD.some((k) => k in o);
  const held = walk(value, (o) => {
    if (isRow(o)) {
      const hold = storedHold(o);
      return { ...o, hold };
    }
    if (!isItem(o)) return o;
    const { paused, pausing, limitPaused, restartPaused, snoozed, parkingLot, ...rest } = o;
    const row = rows.get(o.id as string);
    const hold = snoozed
      ? { ...(snoozed as object), reason: 'snoozed', since: 'now' }
      : limitPaused
        ? { reason: 'limit', ...(row ? { since: 'now' } : {}), ...(row && o.limitedUntil ? { until: o.limitedUntil } : {}) }
        : paused
          ? { reason: 'paused', since: 'now' }
          : pausing
            ? { reason: 'pausing', since: row?.pausing }
            : parkingLot
              ? { reason: 'parkingLot', since: parkingLot }
              : restartPaused
                ? { reason: 'restart' }
                : undefined;
    return hold ? { ...rest, hold } : rest;
  });
  const MOVED = ['pr', 'demo', 'idea', 'prototype_of', 'plan', 'plan_docs', 'prototype', 'built_on', 'share', 'proposal', 'held', 'becomes_plan', 'paused', 'demos', 'snoozed', 'files', 'deps', 'collapsed', 'contribution', 'new_repo', 'page_heard', 'pausing', 'priority', 'category', 'subcategory', 'complexity', 'suggested_labels', 'owner_labels', 'code_review', 'parking_lot', 'hold'];
  const isCard = (o: Record<string, unknown>) => typeof o.id === 'string' && 'project_id' in o && 'short' in o && 'kind' in o;
  return grouped(walk(held, (o) => (isCard(o) ? Object.fromEntries(Object.entries(o).filter(([k]) => !MOVED.includes(k))) : o)));
}

/**
 * W5, the grouped item: a card as the UI gets it from a commit before carries its feature fields
 * flat; regrouped into the parts `Item` has now, each only when it holds anything. A card from a
 * commit that grouped them already is left as it is.
 */
function grouped(value: unknown): unknown {
  const PARTS: Record<string, Record<string, string>> = {
    agent: { statusLine: 'statusLine', inTurn: 'inTurn', doing: 'doing', agentAtWork: 'identity', workerSetting: 'workerSetting', background: 'background', limitedUntil: 'limitedUntil', finishing: 'finishing', followUp: 'followUp', waitsForClone: 'waitsForClone', branch: 'branch', workstation: 'workstation', keptIn: 'keptIn', app: 'app' },
    review: { summary: 'summary', answering: 'answering', answered: 'answered', landing: 'landing', landingPosition: 'landingPosition', noChange: 'noChange', modelsUnchanged: 'modelsUnchanged', rate: 'rate', lands: 'lands', blocked: 'blocked', resolvingConflicts: 'resolvingConflicts', pr: 'pr', morePrs: 'morePrs', contribution: 'contribution', codeReview: 'codeReview', landedPart: 'landedPart' },
    demo: { demo: 'latest', demos: 'earlier', files: 'files', share: 'share', notOnApproval: 'notOnApproval', tags: 'tags', held: 'held' },
    idea: { idea: 'discussion', brief: 'brief', mocks: 'mocks', prototypeOf: 'prototypeOf', variant: 'variant', prototypeEnd: 'prototypeEnd', builtInto: 'builtInto', ideaTitle: 'ideaTitle', buildProposal: 'buildProposal', prototypes: 'prototypes', builtOn: 'builtOn', becomesPlan: 'becomesPlan', newRepo: 'newRepo', proposal: 'proposal', proposed: 'proposed', superseded: 'superseded', mergingInto: 'mergingInto', retro: 'retro' },
    plan: { label: 'label', origin: 'origin', arranging: 'arranging', collapsed: 'collapsed', buildsOn: 'buildsOn', manualDependsOn: 'manualDependsOn', manualArchived: 'manualArchived', manualAnchors: 'manualAnchors' },
    labels: { priority: 'priority', category: 'category', subcategory: 'subcategory', complexity: 'complexity', suggested: 'suggested' },
  };
  const flat = new Set(Object.values(PARTS).flatMap((p) => Object.keys(p)));
  // what every card as the UI gets it has, and a stored row has not
  const isItem = (o: Record<string, unknown>) => typeof o.id === 'string' && typeof o.kind === 'string' && 'source' in o && 'x' in o && !('project_id' in o);
  const regroup = (o: Record<string, unknown>): Record<string, unknown> => {
    // `idea` and `demo` name parts now too: flat, they were an idea under discussion and a demo;
    // a plan with nothing else of a part has the same shape either way, its doc's path and goal
    const was = (k: string, has: string) => !!o[k] && typeof o[k] === 'object' && has in (o[k] as object);
    if (![...flat].some((k) => k !== 'idea' && k !== 'demo' && k in o) && !was('idea', 'status') && !was('demo', 'kind')) return o;
    const plan = o.plan as { file: string; goal: string } | undefined;
    const rest = Object.fromEntries(Object.entries(o).filter(([k]) => !flat.has(k) && k !== 'plan'));
    for (const [part, keys] of Object.entries(PARTS)) {
      const got = Object.fromEntries(Object.entries(keys).flatMap(([from, to]) => (o[from] !== undefined ? [[to, o[from]]] : [])));
      if (part === 'plan' && plan) Object.assign(got, { file: plan.file, goal: plan.goal });
      if (Object.keys(got).length) rest[part] = got;
    }
    return rest;
  };
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    const o = isItem(v as Record<string, unknown>) ? regroup(v as Record<string, unknown>) : (v as Record<string, unknown>);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, walk(x)]));
  };
  return walk(value);
}

/** Where `a` and `b` differ, by path; objects compare by their keys, whatever their order. */
function diff(a: unknown, b: unknown, path: string, into: string[]) {
  if (into.length > 1000) return;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}/${k}`, into);
    return;
  }
  if (a !== b) into.push(`${path}: ${JSON.stringify(a)?.slice(0, 120)} → ${JSON.stringify(b)?.slice(0, 120)}`);
}

/**
 * Times written while reading (a card's `updated_at` as the board sweeps or notes a wait, say, or
 * the time a migration gave a stored value) differ by run; they read as "now". A stored JSON object
 * is read as the object it holds, so that times within it settle too.
 */
function settled(value: unknown, start: number): unknown {
  const settle = (_: string, v: unknown): unknown => {
    if (typeof v !== 'string') return v;
    if (/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v) && Date.parse(v) >= start) return 'now';
    if (!v.startsWith('{')) return v;
    try {
      return JSON.parse(v, settle);
    } catch {
      return v;
    }
  };
  return JSON.parse(JSON.stringify(value), settle);
}

/** Runs in the checkout `code`: reads every project of the database at `path` and writes it to `file`. */
async function inner(code: string, path: string, file: string) {
  const start = Date.now();
  // The store moved out of db.ts into store.ts with its models (W3); the board stayed.
  const { Store } = existsSync(join(code, 'src/server/store.ts')) ? await import(join(code, 'src/server/store.ts')) : await import(join(code, 'src/server/db.ts'));
  const { Board } = await import(join(code, 'src/server/board.ts'));
  const { projectData } = await import(join(code, 'src/server/data-export.ts'));
  const store = new Store(path);
  const models = typeof store.cards === 'object';
  // each read under its name before the models, and its model's
  const read = (old: string, model: string, ...a: unknown[]) => {
    if (!models) return store[old](...a);
    const [m, f] = model.split('.') as [string, string | undefined];
    return f ? store[m][f](...a) : store[m](...a);
  };
  const projects = store.db.query('SELECT id, name FROM projects ORDER BY id').all() as { id: string; name: string }[];
  // a plan card's doc, in its plan part where the code has that table (W7)
  const DOCS = store.db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'card_plans'").get()
    ? "SELECT p.doc AS plan FROM cards c JOIN card_plans p ON p.card_id = c.id WHERE c.project_id = $p AND c.kind = 'plan' AND c.deleted_at IS NULL AND c.archived_at IS NULL AND p.doc IS NOT NULL ORDER BY c.rowid"
    : "SELECT plan FROM cards WHERE project_id = $p AND kind = 'plan' AND deleted_at IS NULL AND archived_at IS NULL AND plan IS NOT NULL ORDER BY rowid";
  // the projects under a key of their own, so none can share its id with what spans them
  const result: { projects: Record<string, unknown>; [k: string]: unknown } = { projects: {} };
  for (const p of projects) {
    const home = read('setting', 'settings.get', p.id, 'home_repo') ?? 'home';
    const others = (store.db.query('SELECT DISTINCT repo FROM cards WHERE project_id = $p AND repo IS NOT NULL AND repo != $home').all({ p: p.id, home }) as { repo: string }[]).map((r) => r.repo);
    const repos = [home, ...others].map((id) => ({ id, name: id, path: join(tmpdir(), 'obeya-item-snapshot-none', id), branch: 'main' }));
    const docs = (store.db.query(DOCS).all({ p: p.id }) as { plan: string }[]).map((r) => JSON.parse(r.plan));
    const board = new Board(store, { id: p.id, name: p.name, repos }, () => ({ docs, dirs: [] }), undefined, () => true);
    const snapshot = board.snapshot();
    const archived = board.archived();
    const cards = (store.db.query('SELECT id FROM cards WHERE project_id = $p ORDER BY rowid').all({ p: p.id }) as { id: string }[]).map((r) => r.id);
    const chat = read('chat', 'chats.current', p.id);
    result.projects[p.id] = {
      snapshot,
      archived,
      history: Object.fromEntries(cards.map((id) => [id, { events: read('events', 'events.of', id, 1e9), runs: read('runs', 'agentRuns.of', id) }])),
      talk: read('talk', 'talk.latest', p.id, 1e6),
      sheet: read('sheet', 'talk.sheet', p.id, chat, 1e6),
      chats: read('chats', 'chats.list', p.id, 1e6),
      lookingUp: read('lookingUp', 'talk.lookingUp', p.id),
      held: read('heldTalk', 'talk.held', p.id),
      waiting: read('waitingTalk', 'talk.waiting', p.id),
      steps: read('answeredSteps', 'talk.answeredSteps', p.id),
      timeline: read('timeline', 'timeline', p.id, '', 1e6),
      timelineSinceMark: read('timeline', 'timeline', p.id, { at: '', event: 0, card: 0 }, 1e6),
      utterances: read('utterances', 'utterances', p.id, '', 1e6),
      decided: read('decidedProposals', 'preferences.decided', p.id, ''),
      removed: read('removed', 'cards.removed', p.id, ''),
      preferences: read('preferences', 'preferences.of', p.id),
      decisions: read('decisions', 'decisions.of', p.id, null, 1e6).map((d: Record<string, unknown>) => [d.id, d.card_id ?? d.cardId, d.plan_id ?? d.planId, d.question, d.answer, d.by, d.at]),
      activity: read('activity', 'activity.page', [p.id], undefined, 1e6),
      commands: read('heldCommands', 'commands.held', p.id),
      settingProposals: read('settingProposals', 'settingProposals.of', p.id),
      workstations: read('workstations', 'workstations.of', p.id, null),
      export: { ...projectData(store, [p.id]), exportedAt: undefined },
    };
  }
  result.feedback = read('feedback', 'feedback.of');
  result.activity = read('activity', 'activity.page', null, undefined, 1e6);
  const { event, card } = store.mark();
  result.mark = { event, card };
  writeFileSync(file, JSON.stringify(settled(result, start), null, 1));
  store.db.close();
}
