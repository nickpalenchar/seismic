




import { ChevronDown, ChevronRight, ChevronUp, Database } from 'lucide-react';
import { cn } from 'cn';
import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type CardDiff, type DiffPart, diffSize, splitDiff } from '../core/diff';
import { type ChangeRow, changeRows, diffRows, imageAt, type ShownFile } from '../core/files';
import type { Item } from '../core/types';
import { barTrigger, DiffTreeLayout, StatusBadge } from './diff-tree';
import { treeOrder } from './diff-tree-entries';
import { api, cardFile } from './api';
import { addedClass, ChangeNote, DiffStyleSwitch, DiffView, diffSizeClass, FileDiff, Lines, MARK, removedClass } from './diff';
import { Doc, DocImages, SettlingImage } from './markdown';
import { useReportedHeight } from './message';
import { scrollBehavior } from './motion';
import { PdfPages } from './pdf';
import { phoneView } from './phoneEnvironment';
import { t } from './strings';
import { Button, LinkButton } from './components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/collapsible';
import { SegmentedControl } from './components/segmented';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/tabs';
import { Tooltip } from './components/tooltip';


const FOLD = 8;

const TEXT_CAP = 400_000;

const PAGE_CAP = 30000;


const FILE_PANEL = 'result-file-panel';
const DEMO = '';
const DIFF = '\0diff';

export const REVIEW = '\0review';

/** The card's change, read as the work moves on; `given` where the card has read it already (a folder's change list). */
function useChange(item: Item, given: CardDiff | null | undefined): CardDiff | null {
  const [diff, setDiff] = useState<CardDiff | null>(null);
  const own = given === undefined;
  useEffect(() => {
    if (!own) return;
    let gone = false;
    api.diff(item.id).then((d) => !gone && setDiff(d), () => {});
    return () => {
      gone = true;
    };
  }, [own, item.id, item.state, item.need, item.review?.summary, item.agent?.workstation, JSON.stringify(item.demo?.files)]);
  return own ? diff : given;
}

/** Deliverables in tabs, then the code review of the work where it has one (`review`, its tab's label and panel), with the underlying change list in a separate Diff tab. */
export function ResultFiles({ item, diff, demo, review, tab, onTab }: { item: Item; diff?: CardDiff | null; demo: ReactNode; review?: { label: ReactNode; title?: string; panel: ReactNode }; tab: string | null; onTab: (path: string) => void }) {
  const change = useChange(item, diff);
  const rows = changeRows(change, item.demo?.files);
  const changedRows = diffRows(change);
  const ordered = treeOrder(changedRows);
  const files = rows.flatMap((r) => (r.file ? [r.file] : []));
  const named = files.filter((f) => f.caption !== undefined);
  const schema = (f: ShownFile) => f.kind === 'page' && /(^|\/)[^/]*schema[^/]*\.html?$/i.test(f.path);
  const label = (f: ShownFile): ReactNode => schema(f) ? <span className="inline-flex items-center gap-1.5"><Database className="size-3.5" aria-hidden />{t.files.tabs.schema}</span> : f.kind === 'page' ? t.files.tabs.document : base(f.path);
  const tabs = [
    ...(demo ? [{ path: DEMO, label: item.demo?.latest?.kind === 'html' ? t.files.tabs.document : t.files.tabs.video }] : []),
    ...named.filter((f) => !schema(f)).map((f) => ({ path: f.path, label: label(f), title: f.caption })),
    ...named.filter(schema).map((f) => ({ path: f.path, label: label(f), title: f.caption })),
    ...(review ? [{ path: REVIEW, label: review.label, ...(review.title ? { title: review.title } : {}) }] : []),
    ...(changedRows.length ? [{ path: DIFF, label: t.files.tabs.diff }] : []),
  ];
  const current = tabs.some((t) => t.path === tab) ? tab : tabs[0]?.path;
  const [wholeDiff, setWholeDiff] = useState(false);
  const [pickedFile, setPickedFile] = useState<string | null>(null);
  const [asChanges, setAsChanges] = useState<Record<string, boolean>>({});
  const demoBox = useRef<HTMLDivElement>(null);
  const rev = revision(`${item.state}:${item.need ?? ''}:${item.review?.summary ?? ''}:${change?.version ?? ''}:${JSON.stringify(change?.files ?? [])}:${JSON.stringify(change?.folder?.changes ?? [])}`);
  
  const readChange = useMemo(() => {
    let read: Promise<DiffPart[] | 'failed'> | undefined;
    return (card: string) => {
      
      read ??= readWholeChange(card).then(
        (parts) => {
          if (parts === 'failed') read = undefined;
          return parts;
        },
        (error) => {
          read = undefined;
          throw error;
        },
      );
      return read;
    };
  }, [item.id, rev]);
  const box = useRef<HTMLDivElement>(null);
  
  
  
  const left = useRef({ tab: current, floor: 0 });
  const [floor, setFloor] = useState(0);
  const busy = () => !!box.current?.querySelector('[data-slot=tabs-content]:not([hidden]) [aria-busy="true"]');
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let scroller = el.parentElement;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const measure = () => {
      const bottom = scroller ? scroller.getBoundingClientRect().top + scroller.clientTop + scroller.clientHeight : innerHeight;
      left.current.floor = Math.min(el.offsetHeight, Math.max(0, bottom - el.getBoundingClientRect().top));
    };
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(el);
    if (scroller) resized.observe(scroller);
    const target = scroller ?? window;
    target.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const loaded = new MutationObserver(() => {
      if (!busy()) setFloor(0);
    });
    loaded.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy'] });
    return () => {
      resized.disconnect();
      loaded.disconnect();
      target.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [!!tabs.length]);
  useLayoutEffect(() => {
    if (left.current.tab === current) return;
    left.current.tab = current;
    setFloor(busy() ? left.current.floor : 0);
  }, [current]);
  
  useEffect(() => {
    if (current !== DEMO) demoBox.current?.querySelectorAll('video').forEach((v) => v.pause());
  }, [current]);
  const [picked, setPicked] = useState(0);
  useEffect(() => {
    if (!picked) return;
    const view = box.current?.querySelector(`#${FILE_PANEL}`);
    if (view && !seen(view)) view.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
  }, [picked]);
  
  
  const [openBars, setOpenBars] = useState<{ rev: string; open: Set<string> } | null>(null);
  const shownBars = openBars?.rev === rev ? openBars.open : new Set(ordered[0] ? [ordered[0].path] : []);
  const openBar = (path: string, open: boolean) => {
    const next = new Set(shownBars);
    if (open) next.add(path);
    else next.delete(path);
    setOpenBars({ rev, open: next });
  };
  const bars = useRef<HTMLDivElement>(null);
  const [barPicked, setBarPicked] = useState<{ path: string }>();
  useEffect(() => {
    if (!barPicked) return;
    const bar = [...(bars.current?.children ?? [])].find((b) => (b as HTMLElement).dataset.path === barPicked.path);
    bar?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
  }, [barPicked]);
  /** A changed file's changes picked, wherever from (the tree, a result's "Changes"): its bar opens, and it comes into view in either layout. */
  const showChanges = (path: string) => {
    setPickedFile(path);
    setAsChanges({ ...asChanges, [path]: true });
    openBar(path, true);
    setBarPicked({ path });
    setPicked(picked + 1);
  };
  /** A changed file's note, and its changes or the file as it is. */
  const changedFile = (path: string) => {
    const shown = files.find((f) => f.path === path);
    return (
      <>
        {change?.folder && <ChangeNote c={changedRows.find(r => r.path === path)!} />}
        {!shown && <Changes key={`${path}:${rev}`} item={item} path={path} />}
        {shown && (
          <FileView
            key={`${shown.path}:${rev}`}
            item={item}
            file={{ ...shown, diff: true }}
            rev={rev}
            changes={asChanges[shown.path] ?? true}
            onChanges={(c) => setAsChanges({ ...asChanges, [shown.path]: c })}
          />
        )}
      </>
    );
  };
  if (!tabs.length) return item.demo?.files && change ? <p className="hint">{t.files.none}</p> : null;
  const inDiff = current === DIFF;
  const selected = changedRows.some(r => r.path === pickedFile) ? pickedFile : ordered[0]?.path;
  const path = inDiff ? selected : current === REVIEW ? null : current;
  const file = files.find((f) => f.path === path);
  const count = changedRows.length;
  return (
    <WholeChange.Provider value={readChange}>
    <Tabs value={current ?? ''} onValueChange={onTab} className="results" ref={box} style={floor ? { minHeight: floor } : undefined}>
      { }
      <TabsList variant="underline" className="result-tabs mb-3.5 phone:[&_[data-slot=tabs-trigger]]:min-h-11">
        {tabs.map((entry) => (
          <TabsTrigger key={entry.path} value={entry.path} title={'title' in entry ? entry.title : undefined}>
            {entry.label}
          </TabsTrigger>
        ))}
      </TabsList>
      { }
      {demo && (
        <TabsContent value={DEMO} forceMount hidden={current !== DEMO} ref={demoBox}>
          {demo}
        </TabsContent>
      )}
      {review && current === REVIEW && <TabsContent value={REVIEW}>{review.panel}</TabsContent>}
      {inDiff && (
        <TabsContent value={DIFF}>
          <DiffTreeLayout rows={changedRows} current={selected ?? undefined} onPick={showChanges}>
          {(stacked) => (
            <>
              <p className="hint"><LinkButton title={t.diff.show} onClick={() => setWholeDiff(true)}><Lines n={diffSize(change?.files ?? [])} /> · {t.diff.size(count)}</LinkButton></p>
              {wholeDiff && <DiffView item={item} onClose={() => setWholeDiff(false)} onRead={() => {}} />}
              {stacked ? (
                <div className="diff-bars flex flex-col gap-2" ref={bars}>
                  {ordered.map((row) => (
                    <FileBar key={row.path} row={row} open={shownBars.has(row.path)} onOpenChange={(o) => openBar(row.path, o)}>
                      {changedFile(row.path)}
                    </FileBar>
                  ))}
                </div>
              ) : (
                selected && <div id={FILE_PANEL}>{changedFile(selected)}</div>
              )}
            </>
          )}
          </DiffTreeLayout>
        </TabsContent>
      )}
      {!inDiff && file && (
        <TabsContent value={file.path}>
          <p className="hint result-caption mt-0">{file.caption}</p>
          <FileView
            key={`${file.path}:${rev}`}
            item={item}
            file={file}
            rev={rev}
            changes={false}
            onChanges={(c) => {
              if (!c) return;
              showChanges(file.path);
              onTab(DIFF);
            }}
          />
        </TabsContent>
      )}
    </Tabs>
    </WholeChange.Provider>
  );
}

/** A card whose agent is still at work on it: what it changed is not its result yet. */
export const atWork = (item: Item) => item.state === 'working' || item.state === 'planned' || (item.state === 'waiting' && item.need === 'question');

/**
 * The card's change list, a line per file: its sign, its path (cut at the front, so its name stays),
 * its lines added and removed, and in a folder what discarding would leave. With `onPick` it picks
 * what the left column shows: the line `current` marked, a click on a line showing its file (on its
 * lines, its changes), lines without a view greyed. A
 * line's lines open its diff over the page where it has no view, and without `onPick` its path does
 * too. With `fold`, only the files its worker named show, the rest a click away; without it,
 * the lines past `FOLD`. `total`, the size of the whole change, stands below the list and opens its whole diff.
 */
export function ChangeList({
  item,
  rows,
  fold,
  total,
  current,
  panel,
  onPick,
}: {
  item: Item;
  rows: ChangeRow[];
  fold?: boolean;
  total?: { added: number; removed: number; files: number };
  current?: string;
  
  panel?: string;
  onPick?: (path: string, changes?: boolean) => void;
}) {
  const [more, setMore] = useState(false);
  
  const [open, setOpen] = useState<string | null>(null);
  const [whole, setWhole] = useState(false);
  const pick = onPick && ((path: string, changes?: boolean) => {
    setMore(false);
    onPick(path, changes);
  });
  const lines = rows;
  const at = (l: ChangeRow) => l.path;
  
  const kept = fold ? lines.filter((l) => l.caption !== undefined) : lines.slice(0, FOLD);
  const folds = fold ? kept.length < lines.length : lines.length > FOLD + 2;
  const visible = folds && !more ? lines.filter((l) => kept.includes(l) || at(l) === current) : lines;
  const hidden = lines.length - visible.length;
  const toggle = folds && (more || hidden > 0);
  
  const counted = toggle && !more && !visible.length;
  return (
    <div className="cl-list mb-3 text-sm [&_table]:w-full [&_table]:border-collapse [&_table]:table-fixed [.results_&_table]:border-b [.results_&_table]:border-border [&_td]:py-0.5 [&_td]:px-0 [&_td]:align-top [&_col.cl-mark]:w-[2em] [&_col.cl-n]:w-[4.5em] [&_.f-mark]:pt-0.5 [&_.f-mark]:pr-1 [&_.f-mark]:pb-0.5 [&_.f-mark]:pl-1.5 [&_.f-mark]:text-center [&_.f-mark]:text-muted-foreground [&_td.d-add]:pl-2.5 [&_td.d-del]:pl-2.5 [&_td.d-add]:whitespace-nowrap [&_td.d-del]:whitespace-nowrap [&_td.d-add]:text-right [&_td.d-del]:text-right [&_td.d-del]:pr-1.5 [&_button.cl-lines]:text-inherit [&_button.cl-lines]:[font:inherit] [&_tr:has(.cl-lines:hover)_.cl-lines]:underline [&_[role=tablist]_.cl-row:not(.off)]:cursor-pointer [@media(hover:hover)]:[&_[role=tablist]_.cl-row:not(.off,.on):hover]:bg-muted phone:text-base phone:[&_td]:py-2.5 phone:[&_.f-mark]:py-2.5">
      <TableFrame pick={!!pick} current={current}>
      <table>
        <colgroup>
          <col className="cl-mark" />
          <col />
          <col className="cl-n" />
          <col className="cl-n" />
        </colgroup>
        <tbody>
          {visible.map((l) => (
            <Line
              key={`${l.kind ?? ''}:${l.from ?? ''}:${l.path}`}
              row={l}
              on={current === l.path}
              onPick={pick && l.file ? (changes) => pick(l.path, changes) : undefined}
              onDiff={l.added || l.removed ? () => setOpen(l.path) : undefined}
              tabs={!!pick}
              panel={panel}
            />
          ))}
        </tbody>
      </table>
      </TableFrame>
      {(toggle || total) && (
        <div className="cl-foot mt-1 ml-1.5 text-sm phone:text-base phone:[&_[data-slot=button]]:py-2 phone:[&_[data-slot=button]]:px-0">
          {toggle && (
            <LinkButton className="cl-more" aria-expanded={more} onClick={() => setMore(!more)}>
              {more ? t.files.less : counted ? t.files.changed(hidden) : t.files.more(hidden)}
              {more ? <ChevronUp className="ml-0.5 inline size-3 align-[-1px]" aria-hidden /> : <ChevronDown className="ml-0.5 inline size-3 align-[-1px]" aria-hidden />}
            </LinkButton>
          )}
          {toggle && total && ' · '}
          {total && (
            <LinkButton className={diffSizeClass} title={t.diff.show} onClick={() => setWhole(true)}>
              <Lines n={total} />
              {!counted && ` ${t.diff.size(total.files)}`}
            </LinkButton>
          )}
        </div>
      )}
      {open !== null && <DiffView item={item} file={open} onClose={() => setOpen(null)} onRead={() => {}} />}
      {whole && <DiffView item={item} onClose={() => setWhole(false)} onRead={() => {}} />}
    </div>
  );
}

/**
 * The change list's lines: where a line picks the file the column shows they are a tab list, with
 * the list's own buttons (more, the whole diff) outside it. The lines pick by their own click (a row
 * anywhere, its name, its counts), so a tab's activation changes nothing and the keys only move
 * focus; Enter and Space click.
 */
function TableFrame({ pick, current, children }: { pick: boolean; current?: string; children: ReactNode }) {
  if (!pick) return <>{children}</>;
  return (
    <Tabs value={current ?? ''} onValueChange={() => {}} activationMode="manual" className="contents" orientation="vertical">
      <TabsList>{children}</TabsList>
    </Tabs>
  );
}

/** A line of the change list: a file to pick (`onPick`, `tabs`), or one whose diff a click shows (`onDiff`), or neither. */
function Line({ row, on, onPick, onDiff, tabs, panel }: { row: ChangeRow; on: boolean; onPick?: (changes?: boolean) => void; onDiff?: () => void; tabs: boolean; panel?: string }) {
  const name = (p: string) => (row.dir ? `${p}/` : p);
  const path = row.from ? `${name(row.from)} → ${name(row.path)}` : name(row.path);
  
  const byName = tabs ? onPick : onDiff;
  const lines = row.added !== undefined && (row.added > 0 || row.removed! > 0);
  const onLines = onPick ? () => onPick(row.file?.diff ? true : undefined) : onDiff;
  const count = (text: string) =>
    onLines ? (
      <LinkButton className="cl-lines" title={onPick ? t.files.showChanges : t.diff.showFile} onClick={(e) => (e.stopPropagation(), onLines())}>
        {text}
      </LinkButton>
    ) : (
      text
    );
  const note = row.caption || row.changed || (row.undo && row.undo !== 'yes');
  return (
    <tr className={cn('cl-row', on && 'on bg-waiting/12', tabs && !onPick && 'off text-muted-foreground')} onClick={onPick && (() => onPick())}>
      <td className="f-mark" aria-label={row.kind}>
        {row.kind && MARK[row.kind]}
      </td>
      <td className="cl-path">
        {byName ? (
          <NameButton tab={tabs ? row.path : undefined} panel={panel} title={tabs ? path : `${path}\n${t.diff.showFile}`} onClick={byName}>
            <bdi>{path}</bdi>
          </NameButton>
        ) : (
          <span className="cl-name block max-w-full bg-transparent p-0 [font:inherit]! text-working text-left overflow-hidden whitespace-nowrap text-ellipsis [direction:rtl] cursor-pointer [.cl-row.on_&]:text-foreground [.cl-row.on_&]:font-semibold! text-inherit cursor-default" title={path}>
            <bdi>{path}</bdi>
          </span>
        )}
        {note && (
          <div className="cl-note text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {row.caption}
            <ChangeNote c={row} />
          </div>
        )}
      </td>
      <td className={addedClass}>{lines && count(`+${row.added}`)}</td>
      <td className={removedClass}>{lines && count(`−${row.removed}`)}</td>
    </tr>
  );
}


const nameClass = 'cl-name block max-w-full border-0 bg-transparent p-0 [font:inherit]! text-working text-left overflow-hidden whitespace-nowrap text-ellipsis [direction:rtl] cursor-pointer [.cl-row.on_&]:text-foreground [.cl-row.on_&]:font-semibold!';

/** A line's name: a tab (of the change list's tabs, valued by `tab`) or a plain button. */
function NameButton({ tab, panel, title, onClick, children }: { tab?: string; panel?: string; title: string; onClick: () => void; children: ReactNode }) {
  const click = (e: { stopPropagation: () => void }) => (e.stopPropagation(), onClick());
  return tab === undefined ? (
    <button className={nameClass} title={title} onClick={click}>
      {children}
    </button>
  ) : (
    <TabsTrigger className={nameClass} value={tab} aria-controls={panel} title={title} onClick={click}>
      {children}
    </TabsTrigger>
  );
}

/** Whether enough of `el` is in sight to be seen, not only a strip of its top: in the window, scrolled into view and not under the card's buttons. */
function seen(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const at = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(200, r.height / 2));
  return !!at && el.contains(at);
}

const base = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** A short mark of `s` for an address and a key, which changes when `s` does. */
function revision(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** A changed file as a bar of its own, its path and size, that folds its changes open below it. */
function FileBar({ row, open, onOpenChange, children }: { row: ChangeRow; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="diff-bar border border-border rounded-md scroll-mt-2" data-path={row.path}>
      <CollapsibleTrigger className={barTrigger} title={row.from ? `${row.from} → ${row.path}` : row.path}>
        <ChevronRight aria-hidden className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        {row.kind && <StatusBadge kind={row.kind} />}
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap [direction:rtl] text-left font-mono text-sm"><bdi>{row.path}</bdi></span>
        {row.from && <span className="hint min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{t.diff.renamedFrom(row.from)}</span>}
        {(row.added !== undefined && (row.added > 0 || row.removed! > 0)) && <span className="flex-none text-sm"><Lines n={{ added: row.added, removed: row.removed! }} /></span>}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2.5 pb-2.5 pt-1 border-t border-border">{open && children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * One file of the card's work (its path and caption stand in its line of the change list): how it is shown (a changed one its changes
 * first, the file as it is a click away), and the ways to the file itself.
 */
function FileView({ item, file, rev, changes, onChanges }: { item: Item; file: ShownFile; rev: string; changes: boolean; onChanges: (changes: boolean) => void }) {
  const [note, setNote] = useState('');
  const url = `${cardFile(item.id, file.path)}?v=${rev}`;
  const open = (show: boolean) => {
    setNote('');
    api.openCardFile(item.id, file.path, show).catch(() => {
      
      if (show) setNote(t.files.notHere);
      else location.assign(cardFile(item.id, file.path, true));
    });
  };
  return (
    <div className="r-file">
      <div className="r-bar flex flex-wrap items-center gap-x-3.5 gap-y-1.5 mb-3 text-sm">
        {file.diff && (
          <SegmentedControl
            size="small"
            label={t.files.mode}
            value={changes ? 'changes' : 'whole'}
            onValueChange={(x) => onChanges(x === 'changes')}
            options={[
              { value: 'whole', label: file.kind === 'markdown' || file.kind === 'page' ? t.files.formatted : t.files.whole },
              { value: 'changes', label: t.files.changes },
            ]}
          />
        )}
        {changes && <DiffStyleSwitch />}
        <span className="r-ways [&_a.link]:text-working [&_a.link]:no-underline">
          <LinkButton title={t.files.openHint} onClick={() => open(false)}>
            {t.files.open}
          </LinkButton>
          {' · '}
          <LinkButton title={t.files.showHint} onClick={() => open(true)}>
            {t.files.show}
          </LinkButton>
          {' · '}
          <Tooltip content={t.files.download}>
            <a className="link" href={cardFile(item.id, file.path, true)} aria-label={t.files.download}>
              ↓
            </a>
          </Tooltip>
        </span>
      </div>
      {note && <p className="hint">{note}</p>}
      {changes ? <Changes item={item} path={file.path} /> : <Shown item={item} file={file} url={url} rev={rev} onOpen={() => open(false)} />}
    </div>
  );
}

/** The file as it is, shown by its kind. */
function Shown({ item, file, url, rev, onOpen }: { item: Item; file: ShownFile; url: string; rev: string; onOpen: () => void }) {
  switch (file.kind) {
    case 'markdown':
      return (
        <Text url={url}>
          {(md) => (
            
            <DocImages.Provider value={(src) => (imageAt(file.path, src) ? `${cardFile(item.id, imageAt(file.path, src)!)}?v=${rev}` : null)}>
              <div className="r-doc max-w-[760px]">
                <Doc md={md} />
              </div>
            </DocImages.Provider>
          )}
        </Text>
      );
    case 'text':
      return <Text url={url}>{(text) => <pre className="r-text m-0 py-2.5 px-3 bg-muted rounded-xs font-mono text-sm/[1.5] whitespace-pre-wrap break-words">{text}</pre>}</Text>;
    case 'image':
      return (
        <a href={url} target="_blank" rel="noreferrer">
          <SettlingImage className="r-image block max-w-full border border-border rounded-xs bg-white" src={url} alt={file.caption || file.path} />
        </a>
      );
    case 'page':
      return <Page url={url} title={file.caption || file.path} />;
    case 'pdf':
      return <Pdf url={url} title={file.caption || file.path} />;
    case 'other':
      return (
        <div className="r-tile flex flex-col items-start gap-2 py-4 px-5 border border-border rounded-md max-w-[420px]">
          <span className="r-tile-name font-sans text-base font-semibold [overflow-wrap:anywhere]">{base(file.path)}</span>
          <span className="hint">{t.files.other}</span>
          <Button title={t.files.openHint} onClick={onOpen}>
            {t.files.open}
          </Button>
        </div>
      );
  }
}

/** A text file's content, to show as `children` makes it; past `TEXT_CAP`, its start. */
function Text({ url, children }: { url: string; children: (text: string) => ReactNode }) {
  const [text, setText] = useState<string | null | 'failed'>(null);
  useEffect(() => {
    let gone = false;
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(
        (s) => !gone && setText(s),
        () => !gone && setText('failed'),
      );
    return () => {
      gone = true;
    };
  }, [url]);
  if (text === null) return <p className="hint" aria-busy="true">{t.files.loading}</p>;
  if (text === 'failed') return <p className="hint">{t.files.failed}</p>;
  const cut = text.length > TEXT_CAP;
  return (
    <>
      {children(cut ? text.slice(0, TEXT_CAP) : text)}
      {cut && <p className="hint">{t.files.cut(Math.round(TEXT_CAP / 1000))}</p>}
    </>
  );
}

/** A page in the sandboxed frame of an HTML artifact, its scripts away from Seismic's API, as high as it reports. */
function Page({ url, title }: { url: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const height = useReportedHeight(frame, PAGE_CAP);
  
  const [loaded, setLoaded] = useState(false);
  return <iframe ref={frame} aria-busy={height === undefined && !loaded} onLoad={() => setTimeout(() => setLoaded(true), 500)} className="r-page w-full min-h-[120px] h-[min(560px,62vh)] border border-border rounded-xs bg-white block" sandbox="allow-scripts" src={url} title={title} style={height ? { height } : undefined} />;
}

/**
 * A PDF in the browser's viewer, which shows nothing in a sandboxed frame: the file comes as a PDF
 * and nothing else. As high as the column shows, so that scrolled to it, the viewer's own scrollbar
 * is the only one. On a phone, and where the browser has no viewer, pdf.js draws its pages instead.
 */
function Pdf({ url, title }: { url: string; title: string }) {
  if (phoneView() || navigator.pdfViewerEnabled === false)
    return <PdfPages url={url} title={title} />;
  return <PdfFrame url={url} title={title} />;
}

function PdfFrame({ url, title }: { url: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const column = frame.current?.closest('.split-main');
    if (!column) return;
    const fit = () => setHeight(Math.max(360, column.clientHeight - 8));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(column);
    return () => watch.disconnect();
  }, []);
  return <iframe ref={frame} className="r-pdf w-full h-[max(480px,calc(100vh-320px))] border border-border rounded-xs bg-white block" src={url} title={title} style={height ? { height } : undefined} />;
}

/** The card's whole change, file by file: read from the server and split once. */
async function readWholeChange(card: string): Promise<DiffPart[] | 'failed'> {
  const d = await api.diff(card, true);
  return d ? splitDiff(d.patch ?? '') : 'failed';
}





const WholeChange = createContext<((card: string) => Promise<DiffPart[] | 'failed'>) | null>(null);

/** What the card changed in the file, line by line. */
function Changes({ item, path }: { item: Item; path: string }) {
  const read = useContext(WholeChange);
  const [parts, setParts] = useState<DiffPart[] | null | 'failed'>(null);
  useEffect(() => {
    let gone = false;
    (read ?? readWholeChange)(item.id).then(
      (p) => !gone && setParts(p),
      () => !gone && setParts('failed'),
    );
    return () => {
      gone = true;
    };
  }, [item.id, read]);
  const part = parts === null || parts === 'failed' ? undefined : parts.find((p) => p.file === path);
  if (parts === null) return <p className="hint" aria-busy="true">{t.files.loading}</p>;
  return part ? (
    <div className="r-diff">
      <FileDiff part={part} card={item.id} />
    </div>
  ) : (
    <p className="hint">{t.files.noDiff}</p>
  );
}
