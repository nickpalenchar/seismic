


import { diffArrays } from 'diff';


export interface CardDiff {
  




  source: 'branch' | 'landed' | 'folder';
  
  version?: string;
  files: DiffFile[];
  folder?: FolderChanges;
  
  patch?: string;
  truncated?: true;
}

export interface DiffFile {
  
  file: string;
  
  from?: string;
  status: 'added' | 'deleted' | 'renamed' | 'modified';
  added: number;
  removed: number;
  binary?: true;
}


export interface FolderChanges {
  




  undo: 'full' | 'partial' | null;
  changes: FolderChange[];
}

export interface FolderChange {
  kind: 'added' | 'modified' | 'deleted' | 'moved';
  
  path: string;
  
  from?: string;
  dir?: true;
  
  changed?: true;
  
  gone?: true;
  
  added?: number;
  removed?: number;
  





  undo?: 'yes' | 'lost' | 'changedSince' | 'shared';
}

/** The changes as the owner reads them: a directory the card added shows through what it put in it, a deleted one stands for what it held. */
export function shownChanges(changes: FolderChange[]): FolderChange[] {
  const gone = changes.filter((c) => c.dir && c.kind === 'deleted').map((c) => c.path);
  return changes.filter((c) => {
    if (gone.some((d) => c.path.startsWith(`${d}/`))) return false;
    if (c.dir && c.kind === 'added') return !changes.some((x) => x !== c && x.path.startsWith(`${c.path}/`));
    return true;
  });
}


export const PATCH_LIMIT = 2_000_000;


export interface DiffPart extends DiffFile {
  lines: string[];
}

/** A `git diff` split into its files, each with what it adds and removes. */
export function splitDiff(patch: string): DiffPart[] {
  const out: DiffPart[] = [];
  let header = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      
      const names = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      out.push({ file: names?.[2] ?? line.slice(11), status: 'modified', added: 0, removed: 0, lines: [line] });
      header = true;
      continue;
    }
    const cur = out.at(-1);
    if (!cur) continue;
    cur.lines.push(line);
    if (header) {
      if (line.startsWith('@@')) header = false;
      else if (line.startsWith('new file mode')) cur.status = 'added';
      else if (line.startsWith('deleted file mode')) cur.status = 'deleted';
      else if (line.startsWith('rename from ')) [cur.status, cur.from] = ['renamed', line.slice(12)];
      else if (line.startsWith('rename to ')) cur.file = line.slice(10);
      
      else if (line.startsWith('+++ b/')) cur.file = line.slice(6).replace(/\t$/, '');
      else if (line.startsWith('--- a/') && cur.status === 'deleted') cur.file = line.slice(6).replace(/\t$/, '');
      else if (line.startsWith('Binary files ') || line === 'GIT binary patch') cur.binary = true;
      continue;
    }
    if (line.startsWith('+')) cur.added++;
    else if (line.startsWith('-')) cur.removed++;
  }
  return out;
}

/** The files of a diff without their lines. */
export const diffFiles = (patch: string): DiffFile[] => splitDiff(patch).map(({ lines: _, ...f }) => f);

/** Lines added and removed over all files. */
export function diffSize(files: DiffFile[]): { added: number; removed: number } {
  return files.reduce((s, f) => ({ added: s.added + f.added, removed: s.removed + f.removed }), { added: 0, removed: 0 });
}

/** A card's change from its whole diff: the files, and the diff itself when asked for (cut off at a file's end past `PATCH_LIMIT`). */
export function cardDiff(source: CardDiff['source'], patch: string, full: boolean): CardDiff {
  const files = diffFiles(patch);
  const version = fingerprint(patch);
  if (!full) return { source, version, files };
  if (patch.length <= PATCH_LIMIT) return { source, version, files, patch };
  const cut = patch.lastIndexOf('\ndiff --git ', PATCH_LIMIT);
  return { source, version, files, patch: patch.slice(0, cut > 0 ? cut : PATCH_LIMIT), truncated: true };
}

/** A short fingerprint of a text (FNV-1a over its UTF-16 units). */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `${(h >>> 0).toString(36)}.${text.length.toString(36)}`;
}

type LineOp = { kind: ' ' | '-' | '+'; line: string };


const DIFF_BUDGET = 20_000_000;

/**
 * The lines of `before` and `after` as a diff: each kept (` `), gone (`-`) or new (`+`), in order.
 * Myers' diff (jsdiff), whose cost grows with the lines that differ, not with the square of the
 * lines; where that would take too long, the lines found once in each list anchor the diff
 * (patience) and only what lies between two anchors is diffed again, or else shown gone and new.
 */
export function lineDiff(before: string[], after: string[]): LineOp[] {
  return myers(before, after) ?? patience(before, after);
}

function myers(before: string[], after: string[]): LineOp[] | null {
  const changes = diffArrays(before, after, { maxEditLength: Math.max(64, Math.floor(DIFF_BUDGET / (before.length + after.length + 1))) });
  if (!changes) return null;
  const out: LineOp[] = [];
  for (const c of changes) for (const line of c.value) out.push({ kind: c.added ? '+' : c.removed ? '-' : ' ', line });
  return out;
}

function patience(before: string[], after: string[]): LineOp[] {
  const count = new Map<string, [number, number, number]>();
  before.forEach((l, i) => {
    const c = count.get(l) ?? [0, 0, -1];
    c[0]++;
    c[2] = i;
    count.set(l, c);
  });
  after.forEach((l) => {
    const c = count.get(l);
    if (c) c[1]++;
  });
  
  const pairs: [number, number][] = [];
  after.forEach((l, j) => {
    const c = count.get(l);
    if (c && c[0] === 1 && c[1] === 1) pairs.push([c[2], j]);
  });
  const anchors = increasing(pairs);
  const out: LineOp[] = [];
  const between = (b: string[], a: string[]) => {
    const d = myers(b, a);
    if (d) for (const x of d) out.push(x);
    else {
      for (const line of b) out.push({ kind: '-', line });
      for (const line of a) out.push({ kind: '+', line });
    }
  };
  let i = 0;
  let j = 0;
  for (const [ai, aj] of anchors) {
    between(before.slice(i, ai), after.slice(j, aj));
    out.push({ kind: ' ', line: before[ai]! });
    [i, j] = [ai + 1, aj + 1];
  }
  between(before.slice(i), after.slice(j));
  return out;
}

/** The longest run of `pairs` (in the order of their second index) whose first index rises too. */
function increasing(pairs: [number, number][]): [number, number][] {
  const tails: number[] = [];
  const back = new Array<number>(pairs.length).fill(-1);
  for (let k = 0; k < pairs.length; k++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]!]![0] < pairs[k]![0]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) back[k] = tails[lo - 1]!;
    tails[lo] = k;
  }
  const out: [number, number][] = [];
  for (let k = tails.at(-1) ?? -1; k >= 0; k = back[k]!) out.push(pairs[k]!);
  return out.reverse();
}

/**
 * `lineDiff` of two line lists as a unified patch for `file`: its hunks hold the changed lines with
 * `context` unchanged lines around them, as git shows a change; hunks whose context meets are one.
 * `file` goes into the patch's head as it is, so it holds no line break; nor do the lines, nor a NUL.
 * `ends`: whether each side's last line ends with a line feed; a side whose last line does not gets
 * git's "No newline at end of file" after it, and a line that gains or loses its line feed changes.
 */
export function patchOf(file: string, before: string[], after: string[], { context = 3, ends = { old: true, new: true } }: { context?: number; ends?: { old: boolean; new: boolean } } = {}): DiffPart {
  
  const open = (lines: string[], ended: boolean) => (ended || !lines.length ? lines : [...lines.slice(0, -1), `${lines.at(-1)}\0`]);
  const d = lineDiff(open(before, ends.old), open(after, ends.new));
  const changed = d.flatMap((x, i) => (x.kind === ' ' ? [] : [i]));
  
  const runs: [number, number][] = [];
  for (const i of changed) {
    const from = Math.max(0, i - context);
    const to = Math.min(d.length, i + 1 + context);
    const last = runs.at(-1);
    if (last && from <= last[1]) last[1] = to;
    else runs.push([from, to]);
  }
  const lines = [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`];
  let old = 0;
  let neu = 0;
  let at = 0;
  for (const [from, to] of runs) {
    for (; at < from; at++) [old, neu] = [old + 1, neu + 1];
    const run = d.slice(from, to);
    const oldCount = run.filter((x) => x.kind !== '+').length;
    const newCount = run.filter((x) => x.kind !== '-').length;
    
    lines.push(`@@ -${oldCount ? old + 1 : old},${oldCount} +${newCount ? neu + 1 : neu},${newCount} @@`);
    
    for (const x of run) {
      if (!x.line.endsWith('\0')) lines.push(x.kind + x.line);
      else lines.push(x.kind + x.line.slice(0, -1), '\\ No newline at end of file');
    }
    old += oldCount;
    neu += newCount;
    at = to;
  }
  return { file, status: 'modified', added: d.filter((x) => x.kind === '+').length, removed: d.filter((x) => x.kind === '-').length, lines };
}
