








import { constants, mkdirSync, realpathSync, statSync, type Stats, writeFileSync } from 'node:fs';
import { copyFile, lstat, mkdir, open, readdir, rename, rm, rmdir, stat, unlink, utimes } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { CardDiff, DiffFile, FolderChange, FolderChanges } from '../core/diff';
import { cardDiff } from '../core/diff';
import type { PoolHost } from '../core/types';
import { messageOf } from '../core/text';
import type { Store } from './store';
import { spawnOutput } from './spawn';
import { type CardWorkstations, type Change, type FileAt, type FileVersions, GIT, boundedFileText, ownFile, type LandProblem, type Landed, type Lease, WorkstationError } from './workstations';


export interface Entry {
  size: number;
  mtime: number;
  
  ctime: number;
  ino: number;
  dir?: true;
  
  cloud?: true;
  
  hash?: string;
}


export type Manifest = Map<string, Entry>;


const SKIPPED = new Set(['.DS_Store', '.git', '.Trash', '.Trashes', '.localized', '.tmp.drivedownload', '.tmp.driveupload', 'Thumbs.db', 'desktop.ini', 'Icon\r', '.seismic-restore']);
const skipped = (name: string) => SKIPPED.has(name) || name.startsWith('~$') || name.startsWith('.~lock.') || name.startsWith('.seismic-restore-');

/**
 * A file the provider keeps only in the cloud (macOS: no blocks on disk for a file with a size).
 * Elsewhere the blocks say nothing of that, and Windows reports none for every file.
 */
const dataless = (s: Stats) => process.platform === 'darwin' && s.isFile() && s.size > 0 && s.blocks === 0;

async function entryAt(path: string): Promise<Entry | null> {
  try {
    const s = await lstat(path);
    if (s.isDirectory()) return { size: 0, mtime: s.mtimeMs, ctime: s.ctimeMs, ino: s.ino, dir: true };
    if (!s.isFile() && !s.isSymbolicLink()) return null;
    return { size: s.size, mtime: s.mtimeMs, ctime: s.ctimeMs, ino: s.ino, ...(dataless(s) ? { cloud: true as const } : {}) };
  } catch {
    return null;
  }
}

/** The manifest of the folder at `root`: every file and directory under it, but what `SKIPPED` names. Reads no file. */
export async function walk(root: string): Promise<Manifest> {
  const out: Manifest = new Map();
  const top = await entryAt(root);
  if (!top) return out;
  out.set('', top);
  const dirs = [''];
  while (dirs.length) {
    const batch = dirs.splice(0, 32);
    await Promise.all(
      batch.map(async (rel) => {
        let names: string[];
        try {
          names = await readdir(rel ? join(root, rel) : root);
        } catch {
          return;
        }
        await Promise.all(
          names
            .filter((n) => !skipped(n))
            .map(async (name) => {
              const path = rel ? `${rel}/${name}` : name;
              const e = await entryAt(join(root, path));
              if (!e) return;
              out.set(path, e);
              if (e.dir) dirs.push(path);
            }),
        );
      }),
    );
  }
  return out;
}


export interface RawChange {
  kind: 'added' | 'modified' | 'deleted' | 'moved';
  path: string;
  from?: string;
  
  was?: string;
  dir?: true;
  before?: Entry;
  after?: Entry;
  at: number;
}

const under = (path: string, dir: string) => path.startsWith(`${dir}/`);
const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** `path`'s directories, nearest first, the folder (`''`) last. */
function ancestors(path: string): string[] {
  const out: string[] = [];
  for (let p = parentOf(path); ; p = parentOf(p)) {
    out.push(p);
    if (!p) return out;
  }
}

/**
 * What changed from `last` to `next` (only at `only`, where given): added, deleted, modified (size
 * or mtime), and moved (a deleted and an added one with the same inode, or for a file the same size
 * and mtime). What moved with a directory is the directory's move. A deleted one happened when its
 * nearest directory still there last changed.
 */
export function compare(last: Manifest, next: Manifest, only?: Iterable<string>): RawChange[] {
  const keys = only ? new Set(only) : new Set([...last.keys(), ...next.keys()]);
  keys.delete('');
  const added: RawChange[] = [];
  const deleted: RawChange[] = [];
  const out: RawChange[] = [];
  const when = (path: string) => {
    for (const a of ancestors(path)) {
      const e = next.get(a);
      if (e) return e.ctime;
    }
    return Date.now();
  };
  
  for (const path of [...keys].sort()) {
    const a = last.get(path);
    const b = next.get(path);
    if (a && b && !!a.dir === !!b.dir) {
      if (!b.dir && (a.size !== b.size || a.mtime !== b.mtime)) out.push({ kind: 'modified', path, before: a, after: b, at: b.ctime });
      continue;
    }
    if (a) deleted.push({ kind: 'deleted', path, ...(a.dir ? { dir: true as const } : {}), before: a, at: when(path) });
    if (b) added.push({ kind: 'added', path, ...(b.dir ? { dir: true as const } : {}), after: b, at: b.ctime });
  }
  const moves: RawChange[] = [];
  const take = (add: RawChange, del: RawChange) => {
    deleted.splice(deleted.indexOf(del), 1);
    added.splice(added.indexOf(add), 1);
    moves.push({ kind: 'moved', path: add.path, from: del.path, ...(add.dir ? { dir: true as const } : {}), before: del.before!, after: add.after!, at: add.at });
  };
  const byIno = new Map<number, RawChange[]>();
  for (const d of deleted) if (d.before!.ino) byIno.set(d.before!.ino, [...(byIno.get(d.before!.ino) ?? []), d]);
  for (const add of [...added]) {
    const del = byIno.get(add.after!.ino)?.find((d) => !!d.dir === !!add.dir && deleted.includes(d));
    if (del) take(add, del);
  }
  
  for (const add of [...added]) {
    if (add.dir || !add.after!.size) continue;
    const same = (d: RawChange) => !d.dir && d.before!.size === add.after!.size && d.before!.mtime === add.after!.mtime;
    const dels = deleted.filter(same);
    if (dels.length === 1 && added.filter((x) => !x.dir && x.after!.size === add.after!.size && x.after!.mtime === add.after!.mtime).length === 1) take(add, dels[0]!);
  }
  const dirMoves = moves.filter((m) => m.dir);
  const along = (m: RawChange) => dirMoves.some((d) => d !== m && under(m.from!, d.from!) && m.path === d.path + m.from!.slice(d.from!.length));
  
  const carried = moves.filter(along);
  for (const m of carried)
    if (!m.dir && (m.before!.size !== m.after!.size || m.before!.mtime !== m.after!.mtime)) out.push({ kind: 'modified', path: m.path, was: m.from!, before: m.before!, after: m.after!, at: m.at });
  return [...moves.filter((m) => !carried.includes(m)), ...out, ...added, ...deleted];
}


const SNIFF = 8000;

const TEXT_MAX = 1024 * 1024;

const HASH_MAX = 256 * 1024 * 1024;

/** Whether the file is text: not larger than `TEXT_MAX`, and no NUL byte in its first bytes. */
export async function isText(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    if (!s.isFile() || s.size > TEXT_MAX || dataless(s)) return false;
    const f = await open(path, 'r');
    try {
      const buf = new Uint8Array(Math.min(SNIFF, s.size));
      const { bytesRead } = await f.read(buf, 0, buf.length, 0);
      return !buf.subarray(0, bytesRead).includes(0);
    } finally {
      await f.close();
    }
  } catch {
    return false;
  }
}

async function hashFile(path: string, size: number): Promise<string | undefined> {
  if (size > HASH_MAX) return undefined;
  try {
    const h = new Bun.CryptoHasher('sha1');
    for await (const chunk of Bun.file(path).stream()) h.update(chunk);
    return h.digest('hex');
  } catch {
    return undefined;
  }
}

/** Copies `src` to `dst` (its directories made), a clone where the file system can, keeping its mtime. */
async function copyKeeping(src: string, dst: string, force = false) {
  await mkdir(join(dst, '..'), { recursive: true });
  await copyFile(src, dst, force ? constants.COPYFILE_FICLONE_FORCE : constants.COPYFILE_FICLONE);
  const s = await stat(src);
  await utimes(dst, s.atime, s.mtime);
}

/** Whether the file system clones `src` into `dir`: same volume, and a file system that clones. */
async function clones(src: string | undefined, dir: string): Promise<boolean> {
  if (!src) return true;
  const probe = join(dir, '.probe');
  try {
    await copyFile(src, probe, constants.COPYFILE_FICLONE_FORCE);
    await unlink(probe);
    return true;
  } catch {
    await unlink(probe).catch(() => {});
    return false;
  }
}

/** Runs `f` over `items`, `n` at a time. */
async function inBatches<T>(items: T[], n: number, f: (x: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += n) await Promise.all(items.slice(i, i + n).map(f));
}


interface Tracked {
  kind: 'added' | 'modified' | 'deleted' | 'moved';
  path: string;
  from?: string;
  dir?: true;
  
  changed?: true;
  
  was?: string;
  
  shared?: true;
  before?: Entry;
  after?: Entry;
}


export interface FolderCard {
  
  held?: true;
  
  done?: true;
  
  undo: 'full' | 'partial' | null;
  changes: Tracked[];
}

/** Folds a change into a card's list: one entry per thing it changed, from before its first change to after its last. */
export function merge(list: Tracked[], c: RawChange, shared = false) {
  const before = list.length;
  mergeOne(list, c);
  
  if (shared) {
    const t = list.find((x) => x.path === c.path && !!x.dir === !!c.dir) ?? (list.length > before ? list.at(-1) : undefined);
    if (t) t.shared = true;
  }
}

function mergeOne(list: Tracked[], c: RawChange) {
  const at = (path: string) => list.findIndex((t) => t.path === path && !!t.dir === !!c.dir);
  const dir = c.dir ? { dir: true as const } : {};
  if (c.kind === 'added') {
    const i = at(c.path);
    const t = list[i];
    if (!t) list.push({ kind: 'added', path: c.path, ...dir, after: c.after! });
    else if (t.kind === 'deleted') {
      if (c.dir) list.splice(i, 1);
      else list[i] = { kind: 'modified', path: c.path, before: t.before!, after: c.after! };
    } else t.after = c.after!;
  } else if (c.kind === 'modified') {
    const i = at(c.path);
    const t = list[i];
    if (!t) list.push({ kind: 'modified', path: c.path, ...(c.was ? { was: c.was } : {}), before: c.before!, after: c.after! });
    else {
      t.after = c.after!;
      if (t.kind === 'moved') t.changed = true;
    }
  } else if (c.kind === 'deleted') {
    const i = at(c.path);
    const t = list[i];
    if (!t) list.push({ kind: 'deleted', path: c.path, ...dir, before: c.before! });
    else if (t.kind === 'added') list.splice(i, 1);
    else if (t.kind === 'moved') list[i] = { kind: 'deleted', path: t.from!, ...dir, before: t.before! };
    else list[i] = { kind: 'deleted', path: t.path, ...dir, before: t.before! };
  } else {
    const from = c.from!;
    
    if (c.dir)
      for (const t of list)
        if (under(t.path, from)) {
          if (t.kind !== 'moved' && t.was === undefined) t.was = t.path;
          t.path = c.path + t.path.slice(from.length);
        }
    const i = at(from);
    const t = list[i];
    const changed = !c.dir && (c.before!.size !== c.after!.size || c.before!.mtime !== c.after!.mtime);
    if (!t) list.push({ kind: 'moved', path: c.path, from, ...dir, ...(changed ? { changed: true as const } : {}), before: c.before!, after: c.after! });
    else if (t.kind === 'added') Object.assign(t, { path: c.path, after: c.after! });
    else if (t.kind === 'moved') {
      if (t.from !== c.path) Object.assign(t, { path: c.path, after: c.after! });
      
      else if (t.changed) list[i] = { kind: 'modified', path: c.path, before: t.before!, after: c.after! };
      else list.splice(i, 1);
    } else if (t.kind === 'modified') list[i] = { kind: 'moved', path: c.path, from, changed: true, before: t.before!, after: c.after! };
  }
}

/** Whether the entry `e` is still as the card left it: size and mtime, else its contents. */
async function unchanged(path: string, e: Entry | undefined, now: Entry | null): Promise<boolean> {
  if (!e || !now || !!e.dir !== !!now.dir) return false;
  if (e.dir) return true;
  
  if (now.ctime === e.ctime && now.ino === e.ino) return true;
  
  if (e.hash && !now.cloud) return e.size === now.size && (await hashFile(path, now.size)) === e.hash;
  return e.size === now.size && Math.abs(e.mtime - now.mtime) < 1;
}


export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}


export interface ToolWatch {
  
  before(call: ToolCall): Promise<void>;
  
  after(call: ToolCall): Promise<void>;
}


const READS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'TodoWrite', 'TodoRead', 'ToolSearch', 'TaskOutput', 'BashOutput', 'TaskList', 'TaskGet', 'TaskCreate', 'TaskUpdate', 'AskUserQuestion', 'ListMcpResourcesTool', 'ReadMcpResourceTool']);

const EDITS: Record<string, string> = { Edit: 'file_path', MultiEdit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' };

const writes = (name: string) => !READS.has(name) && !name.startsWith('mcp__seismic__');


interface Window {
  card: string;
  id: string;
  start: number;
  end?: number;
  only?: Set<string>;
}






const SLACK_MS = 1;


export interface UndoReport {
  undone: string[];
  
  changedSince: string[];
  
  lost: string[];
  
  shared: string[];
}

export interface FolderOptions {
  
  path: string;
  
  dir: string;
  
  onChange?: (cardId: string) => void;
  
  clone?: false;
}

/**
 * The folder as every card's workstation: no branches, nothing lands. Keeps the folder's manifest as
 * last read, the windows of the tool calls running in it, and each card's changes and undo.
 */
export class FolderWorkstations implements CardWorkstations {
  readonly mode = 'folder' as const;
  readonly pooled = false;
  
  private root: string;
  private last: Manifest = new Map();
  private baseline: Promise<void>;
  private windows: Window[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  
  private pending: { started: boolean; done: Promise<void> } | null = null;
  private ready = new Map<string, Promise<void>>();
  private records = new Map<string, FolderCard | null>();
  
  private undoing = new Map<string, Promise<UndoReport>>();
  
  private quiet = new Set<string>();

  constructor(
    private store: Store,
    private o: FolderOptions,
  ) {
    try {
      this.root = realpathSync(o.path);
    } catch {
      this.root = resolve(o.path);
    }
    this.baseline = walk(this.root).then((m) => void (this.last = m));
  }

  get dir() {
    return this.o.dir;
  }

  /** Settles once the folder's first manifest is read. */
  get read(): Promise<void> {
    return this.baseline;
  }

  

  private rec(cardId: string): FolderCard | null {
    if (!this.records.has(cardId)) {
      const json = this.store.folderCards.get(cardId);
      this.records.set(cardId, json ? (JSON.parse(json) as FolderCard) : null);
    }
    return this.records.get(cardId)!;
  }

  private save(cardId: string, rec: FolderCard | null) {
    this.records.set(cardId, rec);
    this.store.folderCards.set(cardId, this.root, rec ? JSON.stringify(rec) : null);
  }

  private undoDir(cardId: string) {
    return join(this.o.dir, cardId.slice(0, 8));
  }

  /** Removes the card's undo (its clone of the folder, or its copies); it is made afresh before its next change. */
  private dropUndo(cardId: string) {
    this.ready.delete(cardId);
    void rm(this.undoDir(cardId), { recursive: true, force: true }).catch((e) => console.error(`removing the undo of ${cardId}:`, messageOf(e)));
  }

  

  list() {
    return [];
  }

  leasedBy(cardId: string): string | null {
    return this.rec(cardId)?.held ? this.o.path : null;
  }

  /** The folder itself, for any number of cards at once; the card's undo is made ready meanwhile. */
  lease(cardId: string): Lease {
    const rec = this.rec(cardId) ?? { undo: null, changes: [] };
    this.save(cardId, { ...rec, held: true });
    if (!rec.done) void this.prepare(cardId);
    return { path: this.o.path, ready: null };
  }

  leasable(): boolean {
    return true;
  }

  pool(): PoolHost[] {
    return [];
  }

  async hasWork(cardId: string): Promise<boolean> {
    return this.changed(cardId).length > 0;
  }

  /** A card stopped with nothing changed: its record and undo go. */
  release(cardId: string) {
    const rec = this.rec(cardId);
    if (!rec) return;
    if (rec.changes.length) return this.save(cardId, { ...rec, held: undefined });
    this.save(cardId, null);
    this.dropUndo(cardId);
  }

  /** The folder is no pool: no card's workstation goes to another. */
  async evict(): Promise<string | null> {
    return null;
  }

  /** The folder is no pool: nothing to give back. */
  async abandon(): Promise<boolean> {
    return false;
  }

  retake(cardId: string): boolean {
    return !!this.leasedBy(cardId);
  }

  async forkPoint(): Promise<null> {
    return null;
  }

  async addedFiles(): Promise<string[]> {
    return [];
  }

  async landOnMain(): Promise<LandProblem | Landed> {
    return { code: 'land', worker: false, detail: 'a folder without git lands nothing' };
  }

  pushToMain(): Promise<LandProblem | Landed> {
    return this.landOnMain();
  }

  foldMain(): Promise<LandProblem> {
    return this.landOnMain() as Promise<LandProblem>;
  }

  /** The owner approved the card: its undo goes at once, though its worker may still finish in the folder. */
  done(cardId: string) {
    const rec = this.rec(cardId);
    if (!rec || rec.done) return;
    this.save(cardId, { ...rec, done: true, undo: null });
    this.dropUndo(cardId);
  }

  /** The card's work is over: its undo goes; what it changed stays its record. */
  async removeLanded(cardId: string) {
    const rec = this.rec(cardId);
    if (!rec) return;
    this.save(cardId, { ...rec, held: undefined, done: true, undo: null });
    this.dropUndo(cardId);
  }

  /** The card goes: its record and undo with it. */
  async discard(cardId: string) {
    if (!this.rec(cardId)) return;
    this.save(cardId, null);
    this.dropUndo(cardId);
  }

  async transfer(): Promise<{ path: string; branch: string }> {
    throw new WorkstationError('a folder without git has no branch to build on');
  }

  followUpTree(cardId: string): Lease {
    return this.lease(cardId);
  }

  async removeFollowUpTree() {}

  async landedDiff(): Promise<CardDiff | null> {
    return null;
  }

  /** The files the card changed in the folder as they are now: neither deleted nor a directory. */
  async changedFiles(cardId: string): Promise<string[]> {
    return (this.rec(cardId)?.changes ?? []).filter((t) => t.kind !== 'deleted' && !t.dir).map((t) => t.path);
  }

  /** A text file the card changed, as Seismic kept it before (none for a new file or one it kept no copy of) and as it is now. */
  async versionsOf(cardId: string, path: string): Promise<FileVersions | null> {
    const t = this.rec(cardId)?.changes.find((c) => c.path === path && !c.dir);
    if (!t) return null;
    const read = (p: string | null) => (p ? boundedFileText(p) : Promise.resolve(null));
    const was = t.kind === 'added' ? null : await this.copyOf(cardId, [t.from ?? path, path], t.before);
    const now = t.kind === 'deleted' ? null : ownFile(this.root, path);
    return { old: await read(was), new: await read(now && 'path' in now ? now.path : null) };
  }

  /** A file in the folder, for a card that changed something there; a link is none. */
  async fileOf(cardId: string, path: string): Promise<FileAt | null> {
    return this.rec(cardId) ? ownFile(this.root, path) : null;
  }

  /** What the card changed, for the Koordinator: each path with what happened to it. */
  async changes(cardId: string): Promise<Change[]> {
    return this.changed(cardId);
  }

  /** What the card changed, as `changes` has it, read at once from what Seismic recorded. */
  changed(cardId: string): Change[] {
    return (this.rec(cardId)?.changes ?? []).map((t) => ({
      file: t.dir ? `${t.path}/` : t.path,
      regions: t.kind === 'moved' ? [`moved from ${t.from}${t.changed ? ', and changed' : ''}`] : t.kind === 'modified' ? [] : [t.kind],
    }));
  }

  

  /** The hooks around the card's tool calls (`AgentSpec.watch`). */
  watch(cardId: string): ToolWatch {
    return {
      before: async (call) => {
        if (!writes(call.name)) return;
        await this.baseline;
        const rec = this.rec(cardId);
        if (!rec) return;
        if (!rec.done) await this.prepare(cardId);
        const field = EDITS[call.name];
        let only: Set<string> | undefined;
        if (field) {
          const file = this.inside(call.input[field]);
          only = new Set(file ? [file, ...ancestors(file)] : []);
          
          if (file) await this.scan([...only]);
          if (file && !rec.done) await this.keepBefore(cardId, file);
        }
        
        else await this.scanAll();
        this.windows.push({ card: cardId, id: call.id, start: this.clock(), ...(only ? { only } : {}) });
      },
      after: async (call) => {
        const w = this.windows.find((x) => x.card === cardId && x.id === call.id && x.end === undefined);
        if (!w) return;
        await this.close(w);
      },
    };
  }

  /**
   * The card's background work runs (`true`) or has ended: what it changes meanwhile is the card's,
   * as during a call.
   */
  background(cardId: string, running: boolean) {
    const open = this.windows.find((x) => x.card === cardId && x.id === 'background' && x.end === undefined);
    if (running && !open && this.rec(cardId)) this.windows.push({ card: cardId, id: 'background', start: this.clock() });
    else if (!running && open) void this.close(open);
  }

  /**
   * The time as the file system stamps a change's ctime, read off a file of Seismic's own written
   * now. Linux stamps it from a coarse clock, up to a tick (1 to 10 ms) behind Date.now(), and
   * Windows may too: by Date.now(), a change right after a window opened would come before it.
   * Read at once, so nothing happens between the reading and the window's opening.
   */
  private clock(): number {
    const now = Date.now();
    const file = join(this.o.dir, 'clock');
    try {
      try {
        writeFileSync(file, 'x');
      } catch {
        mkdirSync(this.o.dir, { recursive: true });
        writeFileSync(file, 'x');
      }
      return Math.min(now, statSync(file).ctimeMs);
    } catch {
      return now;
    }
  }

  /** The card's turn is over: calls whose end the hooks never told (refused, cut off) end now. */
  settle(cardId: string): Promise<void> {
    return Promise.all(this.windows.filter((x) => x.card === cardId && x.end === undefined && x.id !== 'background').map((w) => this.close(w))).then(() => {});
  }

  /** Ends a window: once the folder is read after it, its changes are the card's, and it goes. */
  private async close(w: Window) {
    w.end = Date.now();
    try {
      await (w.only ? this.scan([...w.only]) : this.scanAll());
    } finally {
      this.windows = this.windows.filter((x) => x !== w);
    }
  }

  /** A path of a tool's input inside the folder, relative to it; null for one outside. */
  private inside(given: unknown): string | null {
    if (typeof given !== 'string' || !given) return null;
    const named = isAbsolute(given) ? resolve(given) : resolve(this.o.path, given);
    
    let abs = named;
    try {
      abs = realpathSync(named);
    } catch {
      try {
        abs = join(realpathSync(join(named, '..')), basename(named));
      } catch {}
    }
    for (const base of [this.root, resolve(this.o.path)]) {
      const rel = relative(base, abs);
      if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/');
    }
    return null;
  }

  private serial<T>(f: () => Promise<T>): Promise<T> {
    const r = this.chain.then(f);
    this.chain = r.catch(() => {});
    return r;
  }

  /** Reads the whole folder once more; calls that end before that reading starts share it. */
  private scanAll(): Promise<void> {
    if (this.pending && !this.pending.started) return this.pending.done;
    const p: { started: boolean; done: Promise<void> } = { started: false, done: Promise.resolve() };
    p.done = this.serial(async () => {
      p.started = true;
      await this.scanNow();
    });
    this.pending = p;
    return p.done;
  }

  private scan(paths: string[]): Promise<void> {
    return this.serial(() => this.scanNow(paths));
  }

  /** Reads the folder (or `paths` in it) and gives each change to the cards whose calls ran when it happened. */
  private async scanNow(paths?: string[]) {
    await this.baseline;
    const last = this.last;
    let next: Manifest;
    if (paths) {
      next = new Map(last);
      for (const p of paths) {
        const e = p ? await entryAt(join(this.root, p)) : await entryAt(this.root);
        if (e) next.set(p, e);
        else next.delete(p);
      }
    } else next = await walk(this.root);
    const raw = compare(last, next, paths);
    this.last = next;
    const touched = new Set<string>();
    for (const c of raw) {
      const cards = this.cardsFor(c);
      if (!cards.length) continue;
      
      if (c.after && !c.after.dir && !c.after.cloud && c.kind !== 'deleted') c.after.hash = await hashFile(join(this.root, c.path), c.after.size);
      for (const card of cards) {
        const rec = this.rec(card);
        if (!rec) continue;
        merge(rec.changes, c, cards.length > 1);
        this.save(card, rec);
        touched.add(card);
      }
    }
    for (const card of touched) this.o.onChange?.(card);
  }

  /** The cards a change belongs to: those whose call ran when it happened; a call that writes one file only takes that one. */
  private cardsFor(c: RawChange): string[] {
    const coarse = c.at % 1000 === 0 ? 1000 : 0;
    const inside = (w: { start: number; end?: number }) => w.start - coarse <= c.at && (w.end === undefined || c.at <= w.end + SLACK_MS + coarse);
    if (this.quiet.has(c.path) || (c.from !== undefined && this.quiet.has(c.from))) return [];
    const during = this.windows.filter(inside);
    const claims = during.filter((w) => w.only && (w.only.has(c.path) || (c.from !== undefined && w.only.has(c.from))));
    const by = claims.length ? claims : during.filter((w) => !w.only);
    return [...new Set(by.map((w) => w.card))];
  }

  

  /** Makes the card's undo ready, once: a clone of the folder where the file system clones, else copies of its text files. */
  private prepare(cardId: string): Promise<void> {
    let p = this.ready.get(cardId);
    if (!p) {
      p = this.makeUndo(cardId).catch((e) => console.error(`the undo of ${cardId} in ${this.o.path}:`, messageOf(e)));
      this.ready.set(cardId, p);
    }
    return p;
  }

  private async makeUndo(cardId: string) {
    await this.baseline;
    const rec = this.rec(cardId);
    if (!rec || rec.done || rec.undo) return;
    const base = this.undoDir(cardId);
    await rm(base, { recursive: true, force: true });
    await mkdir(base, { recursive: true });
    const entries = [...this.last].filter(([p]) => p);
    const files = entries.filter(([, e]) => !e.dir && !e.cloud);
    const full = this.o.clone !== false && (await clones(files[0] && join(this.root, files[0][0]), base));
    const to = join(base, full ? 'snapshot' : 'text');
    for (const [p, e] of entries) if (e.dir) await mkdir(join(to, p), { recursive: true });
    await inBatches(files, 64, async ([p, e]) => {
      const src = join(this.root, p);
      try {
        if (full) await copyKeeping(src, join(to, p), true);
        else if (e.size <= TEXT_MAX && (await isText(src))) await copyKeeping(src, join(to, p));
      } catch {
        
      }
    });
    const now = this.rec(cardId);
    if (now && !now.done) this.save(cardId, { ...now, undo: full ? 'full' : 'partial' });
  }

  /** Keeps a copy of the file a card's editing tool is about to write, unless the card changed it already (its copy from before is kept). */
  private async keepBefore(cardId: string, file: string) {
    const rec = this.rec(cardId);
    if (!rec || rec.changes.some((t) => t.path === file)) return;
    const src = join(this.root, file);
    const e = await entryAt(src);
    if (!e || e.dir || e.cloud || e.size > HASH_MAX) return;
    try {
      await copyKeeping(src, join(this.undoDir(cardId), 'before', file));
    } catch (err) {
      console.error(`copying ${file} before it is written:`, messageOf(err));
    }
  }

  /** A copy of the file as it was before the card changed it (`before`), at one of its places; null where none is kept. */
  private async copyOf(cardId: string, paths: (string | undefined)[], before: Entry | undefined): Promise<string | null> {
    if (!before || before.dir) return null;
    const base = this.undoDir(cardId);
    for (const kind of ['before', 'snapshot', 'text'])
      for (const p of paths) {
        if (!p) continue;
        const copy = join(base, kind, p);
        const e = await entryAt(copy);
        if (e && !e.dir && e.size === before.size && Math.abs(e.mtime - before.mtime) < 1) return copy;
      }
    return null;
  }

  /** What undoing the change would do now. */
  private async undoable(cardId: string, t: Tracked): Promise<FolderChange['undo']> {
    if (t.shared) return 'shared';
    const here = join(this.root, t.path);
    const now = await entryAt(here);
    switch (t.kind) {
      case 'added':
        return t.dir || (await unchanged(here, t.after, now)) ? 'yes' : 'changedSince';
      case 'modified':
        if (!(await unchanged(here, t.after, now))) return 'changedSince';
        return (await this.copyOf(cardId, [t.was, t.path], t.before)) ? 'yes' : 'lost';
      case 'deleted':
        if (now) return t.dir ? 'yes' : 'changedSince';
        return t.dir || (await this.copyOf(cardId, [t.was, t.path], t.before)) ? 'yes' : 'lost';
      case 'moved':
        if (!(await unchanged(here, t.after, now)) || (await entryAt(join(this.root, t.from!)))) return 'changedSince';
        return !t.changed || (await this.copyOf(cardId, [t.from, t.path], t.before)) ? 'yes' : 'lost';
    }
  }

  /**
   * Puts back what the card changed, as it was before: what someone changed after the card is left
   * alone, and so is what no copy was kept of; the report names both. The card's list keeps what was
   * left; its undo goes and is made afresh before its next change.
   */
  undo(cardId: string): Promise<UndoReport> {
    let p = this.undoing.get(cardId);
    if (!p) {
      p = this.serial(() => this.undoNow(cardId)).finally(() => this.undoing.delete(cardId));
      this.undoing.set(cardId, p);
    }
    return p;
  }

  private async undoNow(cardId: string): Promise<UndoReport> {
    await this.baseline;
    const rec = this.rec(cardId);
    const report: UndoReport = { undone: [], changedSince: [], lost: [], shared: [] };
    if (!rec) return report;
    if (rec.done) throw new WorkstationError('the card is done: nothing of it is undone any more');
    await this.ready.get(cardId);
    try {
      return await this.putBack(cardId, rec, report);
    } finally {
      this.quiet.clear();
    }
  }

  private async putBack(cardId: string, rec: FolderCard, report: UndoReport): Promise<UndoReport> {
    const left: Tracked[] = [];
    const keep = (t: Tracked, why: 'changedSince' | 'lost' | 'shared') => {
      left.push(t);
      report[why].push(t.kind === 'moved' ? `${t.from} → ${t.path}` : t.path);
    };
    
    const touch = (...paths: string[]) => {
      for (const p of paths) for (const x of [p, ...ancestors(p)]) if (x) this.quiet.add(x);
    };
    const put = async (copy: string, path: string) => {
      touch(path);
      const dst = join(this.root, path);
      const tmp = join(dst, '..', `.seismic-restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      await copyKeeping(copy, tmp);
      await rename(tmp, dst);
    };
    
    
    const depth = (t: Tracked) => t.path.split('/').length;
    const rest = rec.changes.filter((t) => t.kind !== 'moved');
    for (const t of rest.filter((x) => x.kind === 'added' && !x.dir)) {
      const why = await this.undoable(cardId, t);
      if (why !== 'yes') {
        keep(t, why!);
        continue;
      }
      touch(t.path);
      await unlink(join(this.root, t.path)).catch(() => {});
      report.undone.push(t.path);
    }
    for (const t of rest.filter((x) => (x.kind === 'deleted' && x.dir) || (x.kind !== 'added' && !x.dir)).sort((a, b) => depth(a) - depth(b))) {
      const why = await this.undoable(cardId, t);
      if (why !== 'yes') {
        keep(t, why!);
        continue;
      }
      try {
        touch(t.path);
        if (t.dir) await mkdir(join(this.root, t.path), { recursive: true });
        else {
          await mkdir(join(this.root, parentOf(t.path)), { recursive: true });
          await put((await this.copyOf(cardId, [t.was, t.path], t.before))!, t.path);
        }
        report.undone.push(t.path);
      } catch (e) {
        console.error(`putting back ${t.path}:`, messageOf(e));
        keep(t, 'lost');
      }
    }
    
    
    const moves = rec.changes.filter((t) => t.kind === 'moved').reverse();
    const along = (from: string, to: string) => {
      for (const x of [...moves, ...left]) if (under(x.path, from)) x.path = to + x.path.slice(from.length);
    };
    for (const t of moves) {
      const why = await this.undoable(cardId, t);
      if (why === 'changedSince' || why === 'shared') {
        keep(t, why);
        continue;
      }
      try {
        touch(t.path, t.from!);
        await mkdir(join(this.root, parentOf(t.from!)), { recursive: true });
        await rename(join(this.root, t.path), join(this.root, t.from!));
        if (t.dir) along(t.path, t.from!);
        if (t.changed) {
          const copy = await this.copyOf(cardId, [t.from, t.path], t.before);
          if (copy) await put(copy, t.from!);
          else {
            
            keep({ kind: 'modified', path: t.from!, before: t.before!, after: t.after! }, 'lost');
            continue;
          }
        }
        report.undone.push(`${t.path} → ${t.from}`);
      } catch (e) {
        console.error(`undoing the move of ${t.from} to ${t.path}:`, messageOf(e));
        keep(t, 'changedSince');
      }
    }
    for (const t of rest.filter((x) => x.kind === 'added' && x.dir).sort((a, b) => depth(b) - depth(a))) {
      if (t.shared) {
        keep(t, 'shared');
        continue;
      }
      try {
        touch(t.path);
        await rmdir(join(this.root, t.path));
        report.undone.push(`${t.path}/`);
      } catch {
        
        keep(t, 'changedSince');
      }
    }
    this.save(cardId, { ...rec, changes: left, undo: null });
    this.dropUndo(cardId);
    
    await this.scanNow();
    this.o.onChange?.(cardId);
    return report;
  }

  

  /** What the card changed in the folder, as its change list and the diffs of its text files. */
  async diff(cardId: string, full: boolean): Promise<CardDiff | null> {
    const rec = this.rec(cardId);
    if (!rec) return null;
    const undo = rec.done ? null : (rec.undo ?? (rec.held ? (await this.ready.get(cardId), this.rec(cardId)?.undo ?? null) : null));
    const changes: FolderChange[] = [];
    const patches: string[] = [];
    for (const t of rec.changes) {
      const c: FolderChange = { kind: t.kind, path: t.path, ...(t.from ? { from: t.from } : {}), ...(t.dir ? { dir: true as const } : {}), ...(t.changed ? { changed: true as const } : {}) };
      if (undo) c.undo = await this.undoable(cardId, t);
      if (!t.dir) {
        if (t.kind !== 'deleted' && !(await lstat(join(this.root, t.path)).then(() => true, () => false))) c.gone = true;
        const patch = await this.filePatch(cardId, t);
        patches.push(patch.text);
        if (patch.lines) Object.assign(c, patch.lines);
      }
      changes.push(c);
    }
    const folder: FolderChanges = { undo, changes };
    return { ...cardDiff('folder', patches.join('\n'), full), folder };
  }

  /** One file's part of the card's diff, as `git diff` would have it: its text's lines where its earlier version is kept. */
  private async filePatch(cardId: string, t: Tracked): Promise<{ text: string; lines?: Pick<DiffFile, 'added' | 'removed'> }> {
    const name = t.path;
    const head = [`diff --git a/${t.from ?? name} b/${name}`];
    if (t.kind === 'added') head.push('new file mode 100644');
    if (t.kind === 'deleted') head.push('deleted file mode 100644');
    
    if (t.kind === 'moved') head.push(`similarity index ${t.changed ? 99 : 100}%`, `rename from ${t.from}`, `rename to ${name}`);
    const here = join(this.root, name);
    const was = t.kind === 'added' ? '/dev/null' : await this.copyOf(cardId, [t.from ?? name, name], t.before);
    const now = t.kind === 'deleted' ? '/dev/null' : here;
    const text = (p: string | null) => (p === '/dev/null' ? Promise.resolve(true) : p ? isText(p) : Promise.resolve(false));
    const moveOnly = t.kind === 'moved' && !t.changed;
    if (moveOnly) return { text: head.join('\n') };
    if (!was || !(await text(was)) || !(await text(now)) || (t.after?.cloud ?? false)) return { text: [...head, `Binary files a/${t.from ?? name} and b/${name} differ`].join('\n') };
    const r = await spawnOutput([GIT, 'diff', '--no-index', '--no-color', '--no-ext-diff', '-U3', '--', was, now]).catch(() => null);
    const out = r?.stdout ?? '';
    const at = out.indexOf('\n@@');
    const hunks = at >= 0 ? out.slice(at + 1).replace(/\n$/, '') : '';
    let added = 0;
    let removed = 0;
    for (const line of hunks.split('\n')) {
      if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
    }
    head.push(`--- ${t.kind === 'added' ? '/dev/null' : `a/${t.from ?? name}`}`, `+++ ${t.kind === 'deleted' ? '/dev/null' : `b/${name}`}`);
    return { text: [...head, ...(hunks ? [hunks] : [])].join('\n'), lines: { added, removed } };
  }
}
