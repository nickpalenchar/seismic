






import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { chmod, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { messageOf } from '../../../core/text';
import { processes, sameBirth, terminate, type ProcessInfo } from './processes';

const generationId = z.string().uuid();
const observed = z.object({ pid: z.number().int().positive().safe(), born: z.string().min(1) }).strict();
const recordSchema = z.object({
  version: z.literal(1),
  generation: generationId,
  
  host: z.string().min(1),
  boot: z.string().min(1),
  namespace: z.string().min(1),
  
  owner: z.number().int().positive().safe(),
  
  label: z.string().max(300),
  
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
  } catch {  }
  return undefined;
}

function files(root: string, id: string) {
  generationId.parse(id); 
  return { lease: join(root, `${id}.lease.sqlite`), record: join(root, `${id}.json`) };
}

/** SQLite's BEGIN IMMEDIATE holds an OS file lock until released or the process dies. */
function acquire(file: string): Database | undefined {
  let db: Database | undefined;
  try {
    
    if (!lstatSync(file).isFile()) return;
    db = new Database(file, { create: false, readwrite: true });
    db.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE');
    return db;
  } catch {
    try { db?.close(); } catch {  }
    return;
  }
}
function release(db: Database) {
  try { db.exec('ROLLBACK'); } finally { db.close(); }
}
async function atomicRecord(file: string, record: SessionRecord) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = await open(temporary, 'wx', 0o600);
    try {
      await fd.writeFile(JSON.stringify(record) + '\n');
      await fd.sync();
    } finally { await fd.close(); }
    await rename(temporary, file);
    
    const directory = await open(dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { try { await unlink(temporary); } catch {  } }
}


export interface Generation {
  readonly id: string;
  
  publish(processes: Observed[]): Promise<void>;
  
  finish(): Promise<void>;
  
  abandon(): Promise<void>;
}


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
  async begin(label: string, cwd: string, warn: (message: string) => void = console.warn): Promise<Generation | undefined> {
    const env = this.env;
    if (!env) return;
    let lease: Database | undefined;
    const id = randomUUID();
    const paths = files(this.root, id);
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      
      await writeFile(paths.lease, '', { mode: 0o600, flag: 'wx' });
      lease = new Database(paths.lease, { create: false, readwrite: true });
      await chmod(paths.lease, 0o600);
      lease.exec('PRAGMA journal_mode = DELETE; BEGIN IMMEDIATE');
      let current: SessionRecord = recordSchema.parse({ version: 1, generation: id, ...env, owner: process.pid, label, cwd, processes: [] });
      await atomicRecord(paths.record, current);
      const held = lease;
      let open = true;
      live.set(id, held);
      
      
      let pending = Promise.resolve();
      const serial = (fn: () => Promise<void>) => {
        const next = pending.then(fn);
        pending = next.catch(() => {});
        return next;
      };
      let closing: Promise<void> | undefined;
      return {
        id,
        publish(processes) {
          if (!open) throw new Error('Session record is closed');
          const next = recordSchema.parse({ ...current, processes });
          return serial(async () => {
            await atomicRecord(paths.record, next);
            current = next;
          });
        },
        finish() {
          if (closing) return closing;
          open = false;
          return closing = serial(async () => {
            try {
              
              for (const file of [paths.record, paths.lease]) {
                try { await unlink(file); } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                }
              }
            } finally { live.delete(id); release(held); }
          });
        },
        abandon() {
          if (closing) return closing;
          open = false;
          return closing = serial(async () => { live.delete(id); release(held); });
        },
      };
    } catch (error) {
      try { lease && release(lease); } catch {  }
      for (const file of [paths.record, paths.lease]) try { await unlink(file); } catch {  }
      warn(`Session not recorded, so a crash of Seismic could not be cleaned up after: ${messageOf(error)}`);
      return;
    }
  }


  /**
   * Records left by sessions in `cwd` that are not accounted for: a new session there could have a
   * second writer beside an old one. Records of this Seismic's live sessions are not among them. A
   * record whose lease is free and of which nothing runs any more (a session that gave up on it while
   * Seismic kept running) is cleared here rather than at the next start, so it blocks nothing; one
   * whose processes still run stays, and is ended only by the sweep at a start.
   */
  unaccounted(cwd: string, options: { table?: () => Map<number, ProcessInfo> } = {}): { generation: string; label: string }[] {
    let names: string[];
    try { names = readdirSync(this.root); } catch { return []; }
    return names.flatMap((name) => {
      const m = /^([0-9a-f-]{36})\.json$/.exec(name);
      if (!m || live.has(m[1]!)) return [];
      try {
        const record = recordSchema.parse(JSON.parse(readFileSync(join(this.root, name), 'utf8')));
        if (record.cwd !== cwd || this.cleared(m[1]!, options)) return [];
        return [{ generation: record.generation, label: record.label }];
      } catch { return []; }
    });
  }

  /** Whether the record of `id` could be judged under its lease and went, nothing of it running; ends nothing. */
  private cleared(id: string, options: { table?: () => Map<number, ProcessInfo> }): boolean {
    const paths = files(this.root, id);
    const lease = acquire(paths.lease);
    if (!lease) return false;
    try { return this.sweep(id, paths, this.env, { ...options, end: false }).outcome === 'cleared'; }
    catch { return false; }
    finally { release(lease); }
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

  /** With `end: false` a record whose processes still run is left as it is, unrecovered, rather than ended. */
  private sweep(id: string, paths: ReturnType<typeof files>, env: Environment | null, options: Parameters<SessionRegistry['recover']>[0] & { end?: boolean }): Recovery {
    
    const remove = () => { for (const file of [paths.record, paths.lease]) try { unlinkSync(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } };
    let record: SessionRecord;
    try { record = recordSchema.parse(JSON.parse(readFileSync(paths.record, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        
        const young = Date.now() - statSync(paths.lease).mtimeMs < (options.orphanAgeMs ?? 60_000);
        if (young) return { generation: id, outcome: 'unknown', detail: 'lease without a record, too young to judge' };
        remove();
        return { generation: id, outcome: 'cleared', detail: 'lease without a record' };
      }
      
      if (!(error instanceof SyntaxError || error instanceof z.ZodError)) return { generation: id, outcome: 'unknown', detail: `record unreadable for now: ${messageOf(error)}` };
      const quarantine = join(this.root, 'quarantine');
      mkdirSync(quarantine, { recursive: true, mode: 0o700 });
      for (const file of [paths.record, paths.lease]) try { renameSync(file, join(quarantine, file.slice(this.root.length + 1))); } catch {  }
      return { generation: id, outcome: 'quarantined', detail: `record unreadable or of another version: ${messageOf(error)}` };
    }
    if (!env) return { generation: id, outcome: 'unknown', detail: 'process identities cannot be compared on this platform', label: record.label };
    if (record.host !== env.host || record.namespace !== env.namespace) return { generation: id, outcome: 'unknown', detail: 'recorded on another host or PID namespace', label: record.label };
    if (record.boot !== env.boot) {
      
      remove();
      return { generation: id, outcome: 'cleared', detail: 'recorded before the last boot', label: record.label };
    }
    const table = options.table ?? (() => new Map(processes().map((p) => [p.pid, p])));
    const owned = record.processes.map(({ pid, born }): ProcessInfo => ({ pid, born, parent: 0, group: 0 }));
    const before = table();
    const alive = owned.filter((o) => sameRecorded(before.get(o.pid), o));
    if (!alive.length) { remove(); return { generation: id, outcome: 'cleared', detail: 'nothing of it is running', label: record.label }; }
    if (options.end === false) return { generation: id, outcome: 'unrecovered', detail: `still running: ${alive.map((a) => a.pid).join(', ')}`, label: record.label };
    
    
    const { failure } = (options.kill ?? ((o, t) => terminate(o, t, false)))(owned, before);
    const deadline = Date.now() + (options.settleMs ?? 2000);
    let remaining = alive;
    for (;;) {
      const now = table();
      remaining = alive.filter((o) => sameRecorded(now.get(o.pid), o));
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

const sameRecorded = (current: ProcessInfo | undefined, o: ProcessInfo) => !!current && sameBirth(o.born, current.born);

export interface Recovery {
  generation: string;
  




  outcome: 'recovered' | 'cleared' | 'busy' | 'unrecovered' | 'quarantined' | 'unknown';
  detail: string;
  label?: string;
  killed?: number[];
}


let active: SessionRegistry | undefined;
export function useSessionRegistry(registry: SessionRegistry | undefined) { active = registry; }
export function sessionRegistry() { return active; }
