// A card's branch, with the size of its change beside it: a click shows the whole diff over the
// page. Where the branch is checked out is copied with another click, and the app running there
// opens with a third. All stay quiet: the owner rarely reads the code or tries the app by hand.

import { cn } from 'cn';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { type CardDiff, type DiffPart, diffSize, type FolderChange, shownChanges, splitDiff } from '../core/diff';
import { diffRows } from '../core/files';
import { DiffTreeLayout } from './diff-tree';
import type { Item } from '../core/types';
import { api } from './api';
import { useCopy } from './copy';
import { useDiffStyle } from './diffStyle';
import { plain } from './markdown';
import { t } from './strings';
import { CloseButton, LinkButton } from './components/button';
import { Dialog, DialogContent, DialogTitle } from './components/dialog';
import { SegmentedControl } from './components/segmented';

/** Lines added and removed, in green and red, their digits in columns. */
export const addedClass = 'd-add text-approved tabular-nums';
export const removedClass = 'd-del text-error tabular-nums';

/** A count of lines as a link in a line of text: in the text's size. */
export const diffSizeClass = 'diff-size text-[length:inherit]';

/** A file's note on what discarding would leave of it, quieter. */
const leftClass = 'f-left text-muted-foreground italic';

/** A file with more lines than this starts folded, so a generated file does not bury the rest. */
const FOLD_LINES = 1500;

/**
 * The branch line of a card: its name, the size of its change, its directory to copy, and its
 * running app to open. `sizeBelow`: the card's change list shows the size instead.
 */
export function Branch({ item, sizeBelow }: { item: Item; sizeBelow?: boolean }) {
  const [diff, setDiff] = useState<CardDiff | null>(null);
  const [open, setOpen] = useState(false);
  // read again when the work moves on; the line keeps the last size meanwhile
  useEffect(() => {
    let gone = false;
    api.diff(item.id).then((d) => !gone && setDiff(d), () => {});
    return () => {
      gone = true;
    };
  }, [item.id, item.state, item.need, item.agent?.statusLine, item.agent?.workstation, item.review?.summary]);
  const size = diff && diffSize(diff.files);
  return (
    <>
      {t.branch} <code>{item.agent?.branch}</code>
      {diff && size && !(sizeBelow && diff.files.length) && (
        <>
          {' · '}
          {diff.files.length ? (
            <LinkButton className={diffSizeClass} title={t.diff.show} onClick={() => setOpen(true)}>
              <Lines n={size} /> {t.diff.size(diff.files.length)}
            </LinkButton>
          ) : (
            t.diff.none
          )}
        </>
      )}
      {item.agent?.workstation && (
        <>
          {' · '}
          <CopyPath path={item.agent.workstation} />
        </>
      )}
      <AppLink item={item} />
      {open && <DiffView item={item} onClose={() => setOpen(false)} onRead={setDiff} />}
    </>
  );
}

/** How often an open card looks whether its app answers, while its worker says it runs. */
const APP_LOOK_MS = 10_000;

/**
 * The app running in the card's workstation, while it answers: a link beside the workstation's path for
 * the owner to try it by hand, opened through Seismic, which keeps it running a while after.
 */
function AppLink({ item }: { item: Item }) {
  const app = item.agent?.app;
  const [up, setUp] = useState(false);
  useEffect(() => {
    setUp(false);
    if (!app) return;
    let alive = true;
    const look = () => api.appUp(item.id).then((u) => alive && setUp(u), () => {});
    void look();
    const timer = setInterval(look, APP_LOOK_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [item.id, app]);
  if (!app || !up) return null;
  let where = app;
  try {
    where = new URL(app).host;
  } catch {}
  // on another machine, reached here through a forward of that port
  const host = /^([^/:\\]{2,}):\//.exec(item.agent?.workstation ?? '')?.[1];
  if (host) where = `${host}, ${where}`;
  return (
    <>
      {' · '}
      <a className="app-link text-working no-underline hover:underline" href={api.appOpen(item.id)} target="_blank" rel="noreferrer" title={t.app.hint(where)}>
        {t.app.open} ↗
      </a>
    </>
  );
}

function CopyPath({ path }: { path: string }) {
  const [copied, copy] = useCopy(3000);
  return (
    <LinkButton className={copied ? 'font-semibold text-approved' : undefined} title={path} onClick={() => copy(path)}>
      {copied ? t.diff.copied : t.diff.copyPath}
    </LinkButton>
  );
}

/**
 * The whole diff over the page, file by file; Esc, the × or a click beside it closes it. In a folder
 * without git, the card's change list and its text files' diffs. Opened on one `file`, it shows only
 * that file's diff, with a link to the whole.
 */
export function DiffView({ item, file, onClose, onRead }: { item: Item; file?: string; onClose: () => void; onRead: (d: CardDiff) => void }) {
  const [diff, setDiff] = useState<CardDiff | null | 'failed'>(null);
  const [only, setOnly] = useState(file);
  useEffect(() => {
    let gone = false;
    api.diff(item.id, true).then(
      (d) => {
        if (gone) return;
        setDiff(d ?? 'failed');
        if (d) onRead(d);
      },
      () => !gone && setDiff('failed'),
    );
    return () => {
      gone = true;
    };
  }, [item.id]);
  const got = diff === 'failed' ? null : diff;
  const folder = got?.folder;
  // split once per patch text, so a file's diff keeps what the owner expanded across re-renders
  const patch = got?.patch;
  const split = useMemo(() => (patch === undefined ? [] : splitDiff(patch)), [patch]);
  const all = got ? split : [];
  // A selected file never falls back to unrelated changes when its patch was cut off.
  const one = only ? all.find((p) => p.file === only) : undefined;
  const parts = only ? (one ? [one] : []) : all;
  // one file's size stands in its own header
  const size = !one && got && diffSize(got.files);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent glass className="d-sheet flex flex-col w-[min(100%,1500px)] min-h-0" layerClassName="diff-view z-1000 items-stretch justify-center px-[3vw] py-[3vh]">
        <div className="d-head flex items-baseline gap-3.5 pt-4 px-[22px] pb-3 border-b border-line [&_h2]:m-0 [&_h2]:text-[21px] [&>.hint]:flex-1">
          <DialogTitle asChild>
            <h2>{t.diff.title(plain(item.title))}</h2>
          </DialogTitle>
          <span className="hint">
            {got?.source === 'folder' ? t.folder.changed : <code>{item.agent?.branch}</code>}
            {folder?.undo && ` · ${t.folder.undo[folder.undo]}`}
            {got?.source === 'landed' && ` · ${t.diff.landed}`}
            {size && (
              <>
                {' · '}
                <Lines n={size} />
              </>
            )}
            {only && (
              <>
                {' · '}
                <LinkButton onClick={() => setOnly(undefined)}>
                  {t.diff.show}
                </LinkButton>
              </>
            )}
          </span>
          <DiffStyleSwitch />
          <CloseButton label={t.diff.close} variant="ghost" className="d-close" onClick={onClose} />
        </div>
        <div className="d-body overflow-auto pt-2 px-[22px] pb-7 min-h-0">
          {diff === null && <p className="hint">{t.diff.loading}</p>}
          {diff === 'failed' && <p className="hint">{t.diff.failed}</p>}
          {folder && !only && folder.undo && <p className="hint">{t.folder.undoHint[folder.undo]}</p>}
          {folder && !only && <ChangeTable changes={shownChanges(folder.changes)} diffed={(c) => all.some((p) => p.file === c.path)} onFile={setOnly} />}
          {got && (
            <>
              <DiffTreeLayout rows={diffRows(got)} current={only} onPick={(file) => setOnly(file)}>
              {only && !one && <p className="hint">{t.files.noDiff}</p>}
              {parts.map((p) => (
                <FileDiff key={p.file} part={p} card={item.id} />
              ))}
              </DiffTreeLayout>
              {got.truncated && <p className="hint d-cut mt-[18px]">{t.diff.truncated}</p>}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const anchor = (file: string) => `diff-${file}`;

/** Lines added and removed, green and red. */
export function Lines({ n }: { n: { added: number; removed: number } }) {
  return (
    <>
      <span className={addedClass}>+{n.added}</span> <span className={removedClass}>−{n.removed}</span>
    </>
  );
}

/** The diff's code, loaded when the first diff opens: it brings the highlighter and its languages. */
const CodeDiff = lazy(() => import('./diff-code'));

/** The switch between a diff's two layouts, on the desktop only. */
export function DiffStyleSwitch() {
  const { style, set, choosable } = useDiffStyle();
  if (!choosable) return null;
  return (
    <SegmentedControl size="small" label={t.diff.layout} value={style} onValueChange={set} options={(['unified', 'split'] as const).map((s) => ({ value: s, label: t.diff[s] }))} />
  );
}

/** One file of a card's diff: its name and size, and its lines (`card`: whose change it is, where the unchanged lines around them come from). */
export function FileDiff({ part, card }: { part: DiffPart; card: string }) {
  const { style } = useDiffStyle();
  const lines = part.lines.length;
  const key = `${card}\n${part.file}\n${part.lines.join('\n')}`;
  const [opened, setOpened] = useState<string>();
  const folded = lines > FOLD_LINES && opened !== key;
  const empty = !part.lines.some((l) => l.startsWith('@@'));
  return (
    <section className="d-file mt-[18px] [.r-diff_&]:mt-0 [&>.hint]:my-1.5 [&>.hint]:mx-2.5" id={anchor(part.file)}>
      <h3 className="sticky top-[-8px] [.r-diff_&]:top-0 z-1 flex gap-3 items-baseline m-0 py-[7px] px-2.5 [background:linear-gradient(var(--chip),var(--chip)),var(--panel)] border border-line rounded-t-[2px] [font:500_13px_var(--font)]">
        <span className="d-name [font:12.5px_var(--mono)]">{part.file}</span>
        {part.from && <span className="hint">{t.diff.renamedFrom(part.from)}</span>}
        <span className="hint">{t.diff.status[part.status]}</span>
        {!part.binary && (
          <span>
            <Lines n={part} />
          </span>
        )}
      </h3>
      {part.binary ? (
        <p className="hint">{t.diff.binary}</p>
      ) : folded ? (
        <p className="hint">
          {t.diff.big(lines)}{' '}
          <LinkButton onClick={() => setOpened(key)}>
            {t.diff.unfold}
          </LinkButton>
        </p>
      ) : empty ? null : (
        <Suspense fallback={<p className="hint">{t.diff.loading}</p>}>
          <CodeDiff part={part} card={card} style={style} />
        </Suspense>
      )}
    </section>
  );
}

/** The sign of what happened to a file: moved, added, changed, deleted. */
export const MARK: Record<FolderChange['kind'], string> = { moved: '↪', added: '＋', modified: '✎', deleted: '✕' };

/** What else the folder's change list says of a file: that the card also changed one it moved, and what discarding would leave. */
export function ChangeNote({ c }: { c: Pick<FolderChange, 'changed' | 'undo'> }) {
  return (
    <>
      {c.changed && <span className="hint"> {t.folder.alsoChanged}</span>}
      {c.undo && c.undo !== 'yes' && (
        <span className={leftClass} title={c.undo === 'lost' ? t.folder.lostHint : c.undo === 'shared' ? t.folder.sharedHint : t.folder.changedSinceHint}>
          {' '}
          · {t.folder.state[c.undo]}
        </span>
      )}
    </>
  );
}

/** A column of the change table's line counts, apart from the path. */
const changeCount = 'pl-2.5! whitespace-nowrap text-right';

/** The folder's changes over its whole diff: what happened to which path, the lines in columns of their own; a path `diffed` names goes to its diff. */
function ChangeTable({ changes, diffed, onFile }: { changes: FolderChange[]; diffed: (c: FolderChange) => boolean; onFile: (path: string) => void }) {
  return (
    <table className="f-list border-collapse mt-1.5 mb-2.5 text-[13px] [&_td]:py-px [&_td]:px-0 [&_td]:align-top">
      <tbody>
        {changes.map((c) => {
          const name = (p: string) => (c.dir ? `${p}/` : p);
          const path = c.kind === 'moved' ? `${name(c.from!)} → ${name(c.path)}` : name(c.path);
          const lines = c.added !== undefined && (c.added > 0 || c.removed! > 0);
          return (
            <tr key={`${c.kind}:${c.from ?? ''}:${c.path}`}>
              <td className="f-mark w-[1.2em] pr-1! text-center text-muted-foreground" aria-label={c.kind}>
                {MARK[c.kind]}
              </td>
              <td className="f-path [overflow-wrap:anywhere]">
                {diffed(c) ? (
                  <LinkButton title={t.diff.showFile} onClick={() => onFile(c.path)}>
                    {path}
                  </LinkButton>
                ) : (
                  path
                )}
                <ChangeNote c={c} />
              </td>
              <td className={cn(addedClass, changeCount)}>{lines && `+${c.added}`}</td>
              <td className={cn(removedClass, changeCount)}>{lines && `−${c.removed}`}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
