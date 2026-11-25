



import { version as pdfjsVersion } from 'pdfjs-dist/package.json';
import { type CardDiff, type FolderChange, shownChanges } from './diff';


export const PDFJS_BASE = `/pdfjs/${pdfjsVersion}/`;







export interface CardFile {
  path: string;
  caption: string;
  dir?: string;
}





export const DOCUMENT = /\.(pdf|png|jpe?g|gif|webp|svg|html?|md|txt|csv|tsv|json|ya?ml|xml|log|xlsx?|docx?|pptx?|od[tsp]|rtf|mp4|mov|webm|mp3|wav|m4a|ogg)$/i;


const TEXT = /\.(md|markdown|txt|csv|tsv|json|ya?ml|xml|log|toml|ini|cfg|conf|html?|css|scss|svg|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|ps1|bat|sql|r|lua|pl|tex|bib|ipynb|env|gitignore)$/i;


export type FileKind = 'markdown' | 'pdf' | 'image' | 'page' | 'text' | 'other';

export const isImage = (path: string) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(path);

/** How the file at `path` is shown; `text`: the change list read it as text, which a spreadsheet or a Word file by its name never is. */
export function fileKind(path: string, text = TEXT.test(path)): FileKind {
  if (/\.(md|markdown)$/i.test(path)) return 'markdown';
  if (/\.pdf$/i.test(path)) return 'pdf';
  if (isImage(path)) return 'image';
  if (/\.html?$/i.test(path)) return 'page';
  return text && (TEXT.test(path) || !DOCUMENT.test(path)) ? 'text' : 'other';
}


export interface ShownFile {
  path: string;
  
  caption?: string;
  kind: FileKind;
  
  added: boolean;
  
  diff: boolean;
}

/**
 * The files of a card's change the left column can show, in order: those its worker named as the
 * result, then the others it made or changed that can be shown, documents before text and code. A
 * deleted file or a directory has no view, nor has one that is no document and no text (a
 * `__pycache__/*.pyc`), or one gone from the folder since: it stays in the change list, greyed.
 */
export function shownFiles(diff: CardDiff | null, named: CardFile[] = []): ShownFile[] {
  const changed: ShownFile[] = [];
  if (diff?.folder) {
    for (const c of diff.folder.changes) {
      if (c.kind === 'deleted' || c.dir || c.gone) continue;
      const lines = c.added !== undefined && c.added + c.removed! > 0;
      const added = c.kind === 'added' || (c.kind === 'moved' && !c.changed);
      changed.push({ path: c.path, kind: fileKind(c.path, c.added !== undefined || TEXT.test(c.path)), added, diff: lines && !added });
    }
  } else if (diff) {
    for (const f of diff.files) {
      if (f.status === 'deleted') continue;
      const added = f.status === 'added' || (f.status === 'renamed' && !f.added && !f.removed);
      changed.push({ path: f.file, kind: fileKind(f.file, !f.binary), added, diff: !f.binary && !added && f.added + f.removed > 0 });
    }
  }
  const shown = (f: ShownFile) => f.kind !== 'other' || DOCUMENT.test(f.path);
  
  const gone = new Set(diff?.folder?.changes.filter((c) => c.gone).map((c) => c.path));
  
  const own = (n: CardFile) => !n.dir && changed.find((c) => c.path === n.path);
  const first = named.filter((n) => n.dir || !gone.has(n.path)).map((n) => ({ ...(own(n) || { path: n.path, kind: fileKind(n.path), added: true, diff: false }), caption: n.caption }));
  
  const rest = changed.filter((c) => shown(c) && !named.some((n) => !n.dir && n.path === c.path));
  return [...first, ...rest.filter((c) => c.kind !== 'text'), ...rest.filter((c) => c.kind === 'text')];
}


export interface ChangeRow {
  
  path: string;
  
  from?: string;
  
  kind?: FolderChange['kind'];
  dir?: true;
  
  added?: number;
  removed?: number;
  
  caption?: string;
  
  file?: ShownFile;
  
  changed?: true;
  gone?: true;
  undo?: FolderChange['undo'];
}

/**
 * The card's change list, a line per file: first the files the left column can show, in their order
 * (`shownFiles`), then the rest of the change as it comes, which has no view. On a branch, git's
 * list of files; in a folder, its changes as the owner reads them.
 */
export function changeRows(diff: CardDiff | null, named: CardFile[] = []): ChangeRow[] {
  const all: ChangeRow[] = diff?.folder
    ? shownChanges(diff.folder.changes).map(({ kind, path, from, dir, added, removed, changed, gone, undo }) => ({ kind, path, from, dir, added, removed, changed, gone, undo }))
    : (diff?.files ?? []).map((f) => ({
        kind: f.status === 'renamed' ? 'moved' : f.status,
        path: f.file,
        from: f.from,
        ...(f.binary ? {} : { added: f.added, removed: f.removed }),
      }));
  const strip = (r: ChangeRow) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as ChangeRow;
  const shown = shownFiles(diff, named).map((file) => strip({ ...(all.find((r) => r.path === file.path) ?? { path: file.path }), caption: file.caption, file }));
  return [...shown, ...all.filter((r) => !shown.some((s) => s.path === r.path)).map(strip)];
}

/** File-only diff navigation, including files beneath a deleted directory summary. */
export function diffRows(diff: CardDiff | null): ChangeRow[] {
  return diff?.folder
    ? diff.folder.changes.filter((row) => !row.dir)
    : changeRows(diff).filter((row) => row.kind && !row.dir);
}

/** A path as the change list writes it: relative, with `/`, without `.` and `..` steps; null for one that leaves the root. */
export function normalPath(path: string): string | null {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.length ? out.join('/') : null;
}

/**
 * Where an image a Markdown file at `doc` shows lies, relative to the root as `doc` is; null for one
 * on the web, at an absolute path, or outside the root. `src` is as the file writes it.
 */
export function imageAt(doc: string, src: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(src)) return null;
  let name = src.replace(/[?#].*$/, '');
  try {
    name = decodeURIComponent(name);
  } catch {}
  const dir = doc.includes('/') ? doc.slice(0, doc.lastIndexOf('/') + 1) : '';
  return normalPath(dir + name);
}

/** The images a Markdown file at `doc` shows from beside it (`![…](bild.png)`), relative to the root. */
export function docImages(doc: string, md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const at = imageAt(doc, m[1]!);
    if (at && isImage(at)) out.add(at);
  }
  return [...out];
}
