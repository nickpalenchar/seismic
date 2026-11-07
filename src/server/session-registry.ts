// What an Seismic that crashed leaves behind: the processes its agent sessions started. A running
// Seismic records, per session, the identities (pid and creation time) of the processes it observed
// and holds an exclusive lease on that record; the next Seismic on the same home finds records whose
// lease nobody holds any more, ends the processes that still are the recorded ones, and removes
// the record. Best-effort cleanup, not containment: see "Lifetimes" in docs/design/agents-and-workspaces.md.
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { messageOf } from '../core/text';
import { processes, terminate, type ProcessInfo } from './agent-processes';

const generationId = z.string().uuid();
const observed = z.object({ pid: z.number().int().positive().safe(), born: z.string().min(1) }).strict();
const recordSchema = z.object({
  version: z.literal(1),
  generation: generationId,
  /** Where the identities mean something: the same machine, boot and PID namespace as the sweep. */
  host: z.string().min(1),
  boot: z.string().min(1),
  namespace: z.string().min(1),
  /** The Seismic server that held the lease; for the report only. */
  owner: z.number().int().positive().safe(),
  /** What the session was, for the report; never a command line or a credential. */
  label: z.string().max(300),
  /** The working directory of the session: a new session there waits for the old one to be accounted for. */
  cwd: z.string().max(1000),
  processes: z.array(observed),
}).strict();
export type SessionRecord = z.infer<typeof recordSchema>;
export type Observed = z.infer<typeof observed>;

export interface Environment { host: string; boot: string; namespace: string }

/**
 * Where a recorded identity can be compared: this machine, this boot, this PID namespace. Only
 * where Seismic knows all three (Linux, macOS); elsewhere (Windows) sessions are not recorded.
 */
export function environment(): Environment | undefined {
  try {
    if (process.platform === 'linux') {
      const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
      return boot ? { host: hostname(), boot, namespace: readlinkSync('/proc/self/ns/pid') } : undefined;
    }
    if (process.platform === 'darwin') {
      const r = spawnSync('sysctl', ['-n', 'kern.boottime'], { encoding: 'utf8', timeout: 3000 });
      const boot = r.status === 0 ? r.stdout.trim() : '';
      return boot ? { host: hostname(), boot, namespace: 'host' } : undefined;
    }
  } catch { /* unknown is not permission */ }
  return undefined;
}

function files(root: string, id: string) {
  generationId.parse(id); // never accept a path as a generation
  return { lease: join(root, `${id}.lease.sqlite`), record: join(root, `${id}.json`) };
}

/** SQLite's BEGIN IMMEDIATE holds an OS file lock until released or the process dies. */
function acquire(file: string): Database | undefined {
  let db: Database | undefined;
  try {
    // Never create a lease here: that would make a second ownership domain.
    if (!lstatSync(file).isFile()) return;
    db = new Database(file, { create: false, readwrite: true });
    db.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE');
    return db;
  } catch {
    try { db?.close(); } catch { /* unknown, never assume the lease is held */ }
    return;
  }
}
function release(db: Database) {
  try { db.exec('ROLLBACK'); } finally { db.close(); }
}
function atomicRecord(file: string, record: SessionRecord) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify(record) + '\n');
      fsyncSync(fd);
    } finally { closeSync(fd); }
    renameSync(temporary, file);
    // Persist the directory entry as well: a failure is not a successful publication.
    const directory = openSync(dirname(file), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { try { unlinkSync(temporary); } catch { /* renamed or not created */ } }
}

/** A running session's side: the lease, and the record kept current while it owns processes. */
export interface Generation {
  readonly id: string;
  /** Records the identities observed so far. Throws if the record cannot be written. */
  publish(processes: Observed[]): void;
  /** Everything the session started has ended: the record goes. */
  finish(): void;
  /** Cleanup could not be completed: keep the record, free the lease, so a later sweep tries again. */
  abandon(): void;
}

/** The leases held, by session: a lease dropped by the garbage collector would be a lease released. */
const live = new Map<string, Database>();

export class SessionRegistry {
  /** `env` is for tests: null is a platform that cannot compare process identities. */
  constructor(readonly root: string, private env: Environment | null = environment() ?? null) {}

  /** Whether this platform records sessions at all. */
  get supported() { return this.env !== null; }

  /**
   * Takes the lease and writes the first record before the session runs any agent code. Undefined
   * where sessions cannot be recorded or the registry cannot be written: the session then runs
   * without recovery, and says so through `warn`.
   */
  begin(label: string, cwd: string, warn: (message: string) => void = console.warn): Generation | undefined {
    const env = this.env;
    if (!env) return;
    let lease: Database | undefined;
    const id = randomUUID();
    const paths = files(this.root, id);
    try {
      mkdirSync(this.root, { recursive: true, mode: 0o700 });
      // Created exactly once: lease files are never replaced while a contender may hold one.
      writeFileSync(paths.lease, '', { mode: 0o600, flag: 'wx' });
      lease = new Database(paths.lease, { create: false, readwrite: true });
      chmodSync(paths.lease, 0o600);
      lease.exec('PRAGMA journal_mode = DELETE; BEGIN IMMEDIATE');
      let current: SessionRecord = recordSchema.parse({ version: 1, generation: id, ...env, owner: process.pid, label, cwd, processes: [] });
      atomicRecord(paths.record, current);
      const held = lease;
      let open = true;
      live.set(id, held);
      return {
        id,
        publish(processes) {
          if (!open) throw new Error('Session record is closed');
          const next = recordSchema.parse({ ...current, processes });
          atomicRecord(paths.record, next);
          current = next;
        },
        finish() {
          if (!open) return;
          open = false;
          live.delete(id);
          // Both go while the lease is held, so no sweep can see one without the other; one that
          // opens the lease file before it goes finds no record and judges a lease without one.
          for (const file of [paths.record, paths.lease]) try { unlinkSync(file); } catch { /* already gone */ }
          release(held);
        },
        abandon() { if (open) { open = false; live.delete(id); release(held); } },
      };
    } catch (error) {
      try { lease && release(lease); } catch { /* closed below */ }
      for (const file of [paths.record, paths.lease]) try { unlinkSync(file); } catch { /* not created */ }
      warn(`Session not recorded, so a crash of Seismic could not be cleaned up after: ${messageOf(error)}`);
      return;
    }
  }


  /**
   * Records left by sessions in `cwd` that were not accounted for (a sweep could not end their
   * processes, or could not judge them): a new session there could have a second writer beside
   * an old one. Records of this Seismic's live sessions are not among them.
   */
  unaccounted(cwd: string): { generation: string; label: string }[] {
    let names: string[];
    try { names = readdirSync(this.root); } catch { return []; }
    return names.flatMap((name) => {
      const m = /^([0-9a-f-]{36})\.json$/.exec(name);
      if (!m || live.has(m[1]!)) return [];
      try {
        const record = recordSchema.parse(JSON.parse(readFileSync(join(this.root, name), 'utf8')));
        return record.cwd === cwd ? [{ generation: record.generation, label: record.label }] : [];
      } catch { return []; }
    });
  }

  /**
   * The sweep, for the start of an Seismic: ends what crashed sessions left, only what the records
   * name and only while it is still the process recorded. A record is touched only under its own
   * lease, so a live Seismic's sessions (this one's or another's on the same directory) are never
   * candidates; anything unclear is left alone and reported.
   */
  recover(options: { table?: () => Map<number, ProcessInfo>; kill?: (owned: ProcessInfo[], table: Map<number, ProcessInfo>) => ReturnType<typeof terminate>; settleMs?: number; orphanAgeMs?: number } = {}): Recovery[] {
    const env = this.env;
    let names: string[];
    try { names = readdirSync(this.root); } catch { return []; }
    const out: Recovery[] = [];
    for (const name of names.sort()) {
      const m = /^([0-9a-f-]{36})\.lease\.sqlite$/.exec(name);
      if (!m || !generationId.safeParse(m[1]).success) continue;
      const id = m[1]!;
      const paths = files(this.root, id);
      const lease = acquire(paths.lease);
      if (!lease) { out.push({ generation: id, outcome: 'busy', detail: 'its owner is alive, or the lease cannot be taken' }); continue; }
      try { out.push(this.sweep(id, paths, env, options)); }
      catch (error) { out.push({ generation: id, outcome: 'unknown', detail: messageOf(error) }); }
      finally { release(lease); }
    }
    return out;
  }

  private sweep(id: string, paths: ReturnType<typeof files>, env: Environment | null, options: Parameters<SessionRegistry['recover']>[0] & object): Recovery {
    // A file that cannot be removed is an error (the sweep reports it and the record stays), not a success.
    const remove = () => { for (const file of [paths.record, paths.lease]) try { unlinkSync(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } };
    let record: SessionRecord;
    try { record = recordSchema.parse(JSON.parse(readFileSync(paths.record, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // No record: finished (its owner removes the record before the lease), or just created.
        const young = Date.now() - statSync(paths.lease).mtimeMs < (options.orphanAgeMs ?? 60_000);
        if (young) return { generation: id, outcome: 'unknown', detail: 'lease without a record, too young to judge' };
        remove();
        return { generation: id, outcome: 'cleared', detail: 'lease without a record' };
      }
      // Only a record that is there and wrong is quarantined; one that cannot be read right now is retried.
      if (!(error instanceof SyntaxError || error instanceof z.ZodError)) return { generation: id, outcome: 'unknown', detail: `record unreadable for now: ${messageOf(error)}` };
      const quarantine = join(this.root, 'quarantine');
      mkdirSync(quarantine, { recursive: true, mode: 0o700 });
      for (const file of [paths.record, paths.lease]) try { renameSync(file, join(quarantine, file.slice(this.root.length + 1))); } catch { /* absent */ }
      return { generation: id, outcome: 'quarantined', detail: `record unreadable or of another version: ${messageOf(error)}` };
    }
    if (!env) return { generation: id, outcome: 'unknown', detail: 'process identities cannot be compared on this platform', label: record.label };
    if (record.host !== env.host || record.namespace !== env.namespace) return { generation: id, outcome: 'unknown', detail: 'recorded on another host or PID namespace', label: record.label };
    if (record.boot !== env.boot) {
      // Nothing of an earlier boot is running.
      remove();
      return { generation: id, outcome: 'cleared', detail: 'recorded before the last boot', label: record.label };
    }
    const table = options.table ?? (() => new Map(processes().map((p) => [p.pid, p])));
    const owned = record.processes.map(({ pid, born }): ProcessInfo => ({ pid, born, parent: 0, group: 0 }));
    const before = table();
    const alive = owned.filter((o) => before.get(o.pid)?.born === o.born);
    if (!alive.length) { remove(); return { generation: id, outcome: 'cleared', detail: 'nothing of it is running', label: record.label }; }
    // The group of a recorded leader is read from the table, not the record: a group number is
    // only trusted for a process verified at this moment.
    const { failure } = (options.kill ?? ((o, t) => terminate(o, t, false)))(owned, before);
    const deadline = Date.now() + (options.settleMs ?? 2000);
    let remaining = alive;
    for (;;) {
      const now = table();
      remaining = alive.filter((o) => now.get(o.pid)?.born === o.born);
      if (!remaining.length || Date.now() > deadline) break;
      Bun.sleepSync(25);
    }
    if (remaining.length) {
      return { generation: id, outcome: 'unrecovered', detail: `still running: ${remaining.map((r) => r.pid).join(', ')}${failure === undefined ? '' : ` (${messageOf(failure)})`}`, label: record.label, killed: alive.filter((a) => !remaining.includes(a)).map((a) => a.pid) };
    }
    remove();
    return { generation: id, outcome: 'recovered', detail: `ended ${alive.map((a) => a.pid).join(', ')}`, label: record.label, killed: alive.map((a) => a.pid) };
  }
}

export interface Recovery {
  generation: string;
  /**
   * recovered: its processes were ended and the record removed. cleared: nothing to end.
   * busy: a live owner holds it. unrecovered: still running, kept for a later sweep.
   * quarantined / unknown: left alone.
   */
  outcome: 'recovered' | 'cleared' | 'busy' | 'unrecovered' | 'quarantined' | 'unknown';
  detail: string;
  label?: string;
  killed?: number[];
}

/** The registry this Seismic's sessions record into; set by the server at start. */
let active: SessionRegistry | undefined;
export function useSessionRegistry(registry: SessionRegistry | undefined) { active = registry; }
export function sessionRegistry() { return active; }
