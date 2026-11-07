// Report-only experiment. Not integrated with Seismic and not a process-killing authority.
// Use only a private, local scratch directory: path hardening and filesystem guarantees are not established.
// A per-generation SQLite write lock is a kernel-backed lease on supported local filesystems.
// Separate files keep record commits independent of the long-lived lease transaction.
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { linuxProcessStat } from '../src/server/agent-processes';

const generation = z.string().uuid();
const identity = z.object({ pid: z.number().int().positive().safe(), boot: z.string().min(1), namespace: z.string().min(1), start: z.string().regex(/^\d+$/) }).strict();
const recordSchema = z.object({ version: z.literal(1), generation, supervisor: identity, processes: z.array(identity) }).strict();
export type ProcessIdentity = z.infer<typeof identity>;
export type RegistryRecord = z.infer<typeof recordSchema>;
export type Inspection = { pid: number; state: 'match' | 'different' | 'missing-or-hidden' | 'unknown' };
export type Report = { state: 'unknown'; reason: string } | { state: 'inspectable'; record: RegistryRecord; processes: Inspection[] };

function paths(root: string, id: string) {
  generation.parse(id); // never accept a path as a generation
  return { lease: join(root, `${id}.lease.sqlite`), record: join(root, `${id}.json`) };
}

/** Identity is scoped to this Linux boot and PID namespace; unsupported or inaccessible is unknown. */
export function processIdentity(pid: number): ProcessIdentity | undefined {
  if (process.platform !== 'linux' || !Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    const own = statSync('/proc/self/ns/pid', { bigint: true });
    const ns = statSync(`/proc/${pid}/ns/pid`, { bigint: true });
    if (own.dev !== ns.dev || own.ino !== ns.ino) return;
    const info = linuxProcessStat(readFileSync(`/proc/${pid}/stat`, 'utf8'));
    if (!boot || !info || info.pid !== pid) return;
    return { pid, boot, namespace: `${ns.dev}:${ns.ino}`, start: info.born };
  } catch { return; }
}

/** SQLite's BEGIN IMMEDIATE keeps an OS file lock until release or process death. */
function acquire(file: string): Database | undefined {
  let db: Database | undefined;
  try {
    // Never create a missing lease while inspecting: that could create a second ownership domain.
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
function atomicRecord(file: string, record: RegistryRecord) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify(record) + '\n');
      fsyncSync(fd);
    } finally { closeSync(fd); }
    renameSync(temporary, file);
    // Persist the directory entry as well as the file. Failure is not a successful publication.
    const directory = openSync(dirname(file), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { try { unlinkSync(temporary); } catch { /* renamed or not created */ } }
}

/** The caller must keep this handle alive while it owns the generation. */
export function createGeneration(root: string, supervisor: ProcessIdentity) {
  identity.parse(supervisor);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const files = paths(root, id);
  // Create exactly once; lease files are never deleted or replaced while a contender may hold one.
  writeFileSync(files.lease, '', { mode: 0o600, flag: 'wx' });
  const lease = new Database(files.lease, { create: false, readwrite: true });
  chmodSync(files.lease, 0o600);
  try { lease.exec('PRAGMA journal_mode = DELETE; BEGIN IMMEDIATE'); }
  catch (error) { lease.close(); throw error; }
  let open = true;
  let current = recordSchema.parse({ version: 1, generation: id, supervisor, processes: [] });
  try { atomicRecord(files.record, current); }
  catch (error) { release(lease); throw error; }
  return {
    id,
    /** Publish only identities obtained by the supervisor, not agent-provided PIDs. */
    publish(processes: ProcessIdentity[]) {
      if (!open) throw new Error('Registry lease is closed');
      const next = recordSchema.parse({ ...current, processes });
      atomicRecord(files.record, next);
      current = next;
    },
    close() { if (open) { open = false; release(lease); } },
  };
}

/** Inspect under the lease. No code here signals processes or removes records. */
export function inspectGeneration(root: string, id: string, lookup = processIdentity): Report {
  let files: ReturnType<typeof paths>;
  try { files = paths(root, id); } catch { return { state: 'unknown', reason: 'invalid generation' }; }
  const lease = acquire(files.lease);
  if (!lease) return { state: 'unknown', reason: 'lease busy or unavailable' };
  try {
    const record = recordSchema.parse(JSON.parse(readFileSync(files.record, 'utf8')));
    if (record.generation !== id) return { state: 'unknown', reason: 'generation mismatch' };
    const local = lookup(process.pid);
    if (!local) return { state: 'unknown', reason: 'identity unavailable on this platform' };
    if (record.supervisor.boot !== local.boot || record.supervisor.namespace !== local.namespace || record.processes.some((p) => p.boot !== local.boot || p.namespace !== local.namespace)) return { state: 'unknown', reason: 'boot or namespace mismatch' };
    const processes: Inspection[] = record.processes.map((p) => {
      const current = lookup(p.pid);
      if (!current) return { pid: p.pid, state: 'missing-or-hidden' };
      return { pid: p.pid, state: current.start === p.start && current.boot === p.boot && current.namespace === p.namespace ? 'match' : 'different' };
    });
    return { state: 'inspectable', record, processes };
  } catch { return { state: 'unknown', reason: 'record inaccessible or invalid' }; }
  finally { release(lease); }
}
