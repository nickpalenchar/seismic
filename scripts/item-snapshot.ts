// The equality check of a change to the data layer (docs/plan/card-data-model.md, "Migrating
// safely"): reads every project of a database as the code of two commits sees it, each on a copy of
// its own, and says where they differ.
//   bun scripts/item-snapshot.ts [db] [--before <commit>] [--after <commit>] [--out <dir>]
// `db` defaults to ~/.obeya/obeya.db, which is only read (through SQLite's own snapshot, as a
// running Seismic writes to it); `--before` to `main`, `--after` to this checkout as it is. Each
// side runs in a checkout of its own (a detached worktree for a commit) on a copy of the database,
// and writes what it read to `<out>/<side>.json`: each project's snapshot (the cards as the UI gets
// them, its groups, canvases, chat and preferences), its archive, every card's history and agent
// runs, and the Koordinator's reads (its talk, the timeline, what the owner said, decisions, the
// Activity log, feedback), plus the project export. No agent runs and no repository is touched:
// the plan docs are the ones the database kept on its plan cards.
// Exits 1 when the two differ, naming the first differences.

import { Database } from 'bun:sqlite';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

/** What the code in `code` reads from a fresh copy of the database. */
function side(name: string, code: string): unknown {
  const copy = join(out, `${name}.db`);
  rmSync(copy, { force: true });
  const source = new Database(db, { readonly: true });
  source.run('VACUUM INTO ?', [copy]);
  source.close();
  const file = join(out, `${name}.json`);
  const run = spawnSync('bun', [join(root, 'scripts', 'item-snapshot.ts'), '--inner', code, copy, file], { stdio: 'inherit' });
  if (run.status) throw new Error(`the ${name} side failed`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

try {
  const a = side('before', checkout(before));
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

/** Times written while reading (a card's `updated_at` as the board sweeps or notes a wait, say) differ by run; they read as "now". */
function settled(value: unknown, start: number): unknown {
  return JSON.parse(JSON.stringify(value), (_, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v) && Date.parse(v) >= start ? 'now' : v));
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
  const result: Record<string, unknown> = {};
  for (const p of projects) {
    const home = read('setting', 'settings.get', p.id, 'home_repo') ?? 'home';
    const others = (store.db.query('SELECT DISTINCT repo FROM cards WHERE project_id = $p AND repo IS NOT NULL AND repo != $home').all({ p: p.id, home }) as { repo: string }[]).map((r) => r.repo);
    const repos = [home, ...others].map((id) => ({ id, name: id, path: join(tmpdir(), 'obeya-item-snapshot-none', id), branch: 'main' }));
    const docs = (store.db.query("SELECT plan FROM cards WHERE project_id = $p AND kind = 'plan' AND deleted_at IS NULL AND archived_at IS NULL AND plan IS NOT NULL").all({ p: p.id }) as { plan: string }[]).map((r) => JSON.parse(r.plan));
    const board = new Board(store, { id: p.id, name: p.name, repos }, () => ({ docs, dirs: [] }), undefined, () => true);
    const snapshot = board.snapshot();
    const archived = board.archived();
    const cards = (store.db.query('SELECT id FROM cards WHERE project_id = $p ORDER BY rowid').all({ p: p.id }) as { id: string }[]).map((r) => r.id);
    const chat = read('chat', 'chats.current', p.id);
    result[p.id] = {
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
