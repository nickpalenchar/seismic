// The Table view: the project's cards as rows of shadcn's data table (on @tanstack/react-table),
// a full-page view beside Parked. A toolbar above it searches titles and filters by state,
// priority and canvas; a click on a column's head sorts by it, a second reverses; "Columns" hides
// and shows columns. Sort, filters and hidden columns are kept per project in this browser. A click
// on a row (or Enter on it) opens the card as anywhere else, unfolding from its row (`els`).

import { type ColumnDef, flexRender, getCoreRowModel, type SortingState, type Updater, useReactTable } from '@tanstack/react-table';
import { cn } from 'cn';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, PlusCircle, Settings2, X } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { PRIORITIES } from '../../core/labels';
import { type Canvas, type CardState, type Group, type Item, type RepoRef, STATES } from '../../core/types';
import { CanvasIcon } from '../canvasIcon';
import { shownTitle } from '../card';
import { PriorityMark } from '../card/labels';
import { Badge } from '../components/badge';
import { Button, CloseButton } from '../components/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '../components/command';
import { Input } from '../components/input';
import { Menu, MenuCheckboxItem, MenuContent, MenuTrigger } from '../components/menu';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover';
import { Separator } from '../components/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/table';
import { FullPage, fullBodyClass, fullCloseClass, fullHeadClass, fullTitleClass } from '../fullPage';
import { plain } from '../markdown';
import { useStoredState } from '../stored';
import { clock, shortDay, t } from '../strings';
import { type ColumnId, type Facet, type Filters, facetCounts, filtering, filterRows, keptOf, NO_FILTERS, NO_PRIORITY, type Row, sortRows, tableRows } from './rows';

interface Props {
  on: boolean;
  project: string;
  items: Item[];
  canvases: Canvas[];
  groups: Group[];
  repos: RepoRef[];
  /** The card open now, whose row is marked. */
  open?: string;
  onOpen: (i: Item) => void;
  onClose: () => void;
  /** Where a card opened from the view unfolds from and folds back to. */
  els: Map<string, HTMLElement>;
}

export function TableView(props: Props) {
  if (!props.on) return null;
  return <TablePage {...props} />;
}

/** A state's name in a word or two, in its colour. */
const stateName = (s: CardState) => {
  const short = (t.stateShort as Record<string, unknown>)[s];
  return typeof short === 'string' ? short : t.state[s];
};
const StateBadge = ({ state }: { state: CardState }) => <Badge variant="secondary" className={cn(`s-${state}`, 'rounded-sm bg-(--c-subtle) text-(--c-strong)')}>{stateName(state)}</Badge>;

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const when = (iso: string) => (sameDay(new Date(iso), new Date()) ? clock(iso) : shortDay(iso));

const empty = <span className="text-muted-foreground">—</span>;

function TablePage({ project, items, canvases, groups, repos, open, onOpen, onClose, els }: Props) {
  const [stored, store] = useStoredState<unknown>(`seismic-table-${project}`, null);
  const kept = useMemo(() => keptOf(stored), [stored]);
  const keep = (k: Partial<typeof kept>) => store({ ...kept, ...k });
  const setFilters = (f: Partial<Filters>) => keep({ filters: { ...kept.filters, ...f } });

  const all = useMemo(() => tableRows(items, { canvases, groups, repos }), [items, canvases, groups, repos]);
  const shown = useMemo(() => sortRows(filterRows(all, kept.filters), kept.sort, canvases), [all, kept, canvases]);
  const canvasById = new Map(canvases.map((c) => [c.id, c]));
  const severalRepos = repos.length > 1;

  const columns = useMemo((): ColumnDef<Row>[] => {
    const col = (id: ColumnId, cell: (r: Row) => ReactNode, o: Partial<ColumnDef<Row>> = {}): ColumnDef<Row> => ({ id, accessorFn: (r) => r[id as keyof Row], header: t.table.column[id], cell: ({ row }) => cell(row.original), ...o });
    return [
      col('title', (r) => <span className="block max-w-[420px] truncate font-medium">{r.title ? plain(r.title) : shownTitle(r.item)}</span>, { enableHiding: false }),
      col('state', (r) => <StateBadge state={r.state} />),
      col('priority', (r) => (r.priority ? <PriorityMark priority={r.priority} /> : empty)),
      col('canvas', (r) => {
        const c = r.canvas ? canvasById.get(r.canvas) : undefined;
        return c ? <span className="inline-flex items-center gap-1.5"><CanvasIcon canvas={c} />{c.name}</span> : empty;
      }),
      col('plan', (r) => (r.plan ? <span className="block max-w-[240px] truncate">{plain(r.plan)}</span> : empty)),
      col('group', (r) => r.group ?? empty),
      col('category', (r) => (r.category ? t.labels.category.names[r.category] : empty)),
      col('complexity', (r) => r.complexity ?? empty),
      col('updated', (r) => (r.updated ? <time dateTime={r.updated} title={new Date(r.updated).toLocaleString()}>{when(r.updated)}</time> : empty), { sortDescFirst: true }),
      col('repo', (r) => r.repo ?? empty, { enableHiding: severalRepos }),
    ];
  }, [canvases, severalRepos]);

  const sorting: SortingState = [kept.sort];
  const table = useReactTable({
    data: shown,
    columns,
    getRowId: (r) => r.item.id,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualFiltering: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    sortDescFirst: false,
    state: { sorting, columnVisibility: { ...Object.fromEntries(kept.hidden.map((c) => [c, false])), ...(severalRepos ? {} : { repo: false }) } },
    onSortingChange: (u: Updater<SortingState>) => {
      const next = (typeof u === 'function' ? u(sorting) : u)[0];
      if (next) keep({ sort: { id: next.id as ColumnId, desc: next.desc } });
    },
    onColumnVisibilityChange: (u) => {
      const now = table.getState().columnVisibility;
      const next = typeof u === 'function' ? u(now) : u;
      keep({ hidden: Object.entries(next).filter(([c, v]) => !v && (c !== 'repo' || severalRepos)).map(([c]) => c as ColumnId) });
    },
  });

  const facet = (key: Facet, title: string, options: Option[]) => (
    <FacetFilter title={title} options={options} counts={facetCounts(all, kept.filters, key)} picked={kept.filters[key] as string[]} onPick={(v) => setFilters({ [key]: v })} />
  );

  return (
    <FullPage id="table-full" title={t.views.table}>
      <div className={fullHeadClass}>
        <h2 className={fullTitleClass}>
          {t.views.table} {all.length > 0 && <span className="count ml-1 font-normal text-muted-foreground">{shown.length === all.length ? all.length : `${shown.length} / ${all.length}`}</span>}
        </h2>
        <span className="expand flex-1" />
        <CloseButton label={t.close} className={fullCloseClass} onClick={onClose} />
      </div>
      <div className={cn(fullBodyClass, 'flex flex-col gap-3 pb-16')}>
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t.views.table}>
          <Input className="h-8 w-[240px]" placeholder={t.table.search} aria-label={t.table.search} value={kept.filters.title} onChange={(e) => setFilters({ title: e.target.value })} />
          {facet('state', t.table.column.state, STATES.map((s) => ({ value: s, text: stateName(s), label: <StateBadge state={s} /> })))}
          {facet('priority', t.table.column.priority, [...[...PRIORITIES].reverse().map((p) => ({ value: p, text: t.priority.names[p], label: <PriorityMark priority={p} /> })), { value: NO_PRIORITY, text: t.priority.none, label: t.priority.none }])}
          {facet('canvas', t.table.column.canvas, canvases.map((c) => ({ value: c.id, text: c.name, label: <span className="inline-flex items-center gap-1.5"><CanvasIcon canvas={c} />{c.name}</span> })))}
          {filtering(kept.filters) && (
            <Button variant="ghost" size="small" onClick={() => setFilters(NO_FILTERS)}>
              {t.table.reset}
              <X aria-hidden />
            </Button>
          )}
          <span className="flex-1" />
          <Menu>
            <MenuTrigger asChild>
              <Button variant="outline" size="small">
                <Settings2 aria-hidden />
                {t.table.columns}
              </Button>
            </MenuTrigger>
            <MenuContent align="end" className="min-w-[160px] p-1">
              {table.getAllColumns().filter((c) => c.getCanHide()).map((c) => (
                <MenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)} onSelect={(e) => e.preventDefault()}>
                  {t.table.column[c.id as ColumnId]}
                </MenuCheckboxItem>
              ))}
            </MenuContent>
          </Menu>
        </div>
        <div className="rounded-md border border-border bg-card">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((g) => (
                <TableRow key={g.id} className="hover:bg-transparent">
                  {g.headers.map((h) => {
                    const sorted = h.column.getIsSorted();
                    const label = t.table.column[h.column.id as ColumnId];
                    return (
                      <TableHead key={h.id} aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}>
                        <Button variant="ghost" size="small" className={cn('-ml-2 px-2 has-[>svg]:px-2', sorted && 'text-foreground')} aria-label={t.table.sortBy(label)} onClick={h.column.getToggleSortingHandler()}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sorted === 'asc' ? <ArrowUp aria-hidden /> : sorted === 'desc' ? <ArrowDown aria-hidden /> : <ArrowUpDown className="opacity-40" aria-hidden />}
                        </Button>
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => {
                const i = row.original.item;
                return (
                  <TableRow
                    key={row.id}
                    ref={(el) => void (el ? els.set(i.id, el) : els.delete(i.id))}
                    tabIndex={0}
                    data-space-activates
                    className="cursor-pointer outline-none focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
                    data-state={i.id === open ? 'selected' : undefined}
                    aria-current={i.id === open || undefined}
                    onClick={() => onOpen(i)}
                    onKeyDown={(e) => {
                      if ((e.key !== 'Enter' && e.code !== 'Space') || e.target !== e.currentTarget) return;
                      e.preventDefault();
                      if (!e.repeat) onOpen(i);
                    }}
                  >
                    {row.getVisibleCells().map((c) => (
                      <TableCell key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</TableCell>
                    ))}
                  </TableRow>
                );
              })}
              {shown.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-20 text-center text-muted-foreground">
                    {all.length ? t.table.noMatch : t.table.none}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </FullPage>
  );
}

/** A faceted filter of the toolbar (shadcn's data-table pattern): a dashed button that opens the options to pick, each with how many rows it would show. */
interface Option {
  value: string;
  /** What the option's search matches. */
  text: string;
  label: ReactNode;
}

function FacetFilter({ title, options, counts, picked, onPick }: { title: string; options: Option[]; counts: Map<string, number>; picked: string[]; onPick: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const on = new Set(picked);
  const toggle = (v: string) => onPick(on.has(v) ? picked.filter((x) => x !== v) : [...picked, v]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="small" className="border-dashed">
          <PlusCircle aria-hidden />
          {title}
          {picked.length > 0 && (
            <>
              <Separator orientation="vertical" className="mx-0.5 h-4" />
              {picked.length > 2 ? (
                <Badge variant="secondary" className="rounded-sm px-1 font-normal">{t.table.selected(picked.length)}</Badge>
              ) : (
                options.filter((o) => on.has(o.value)).map((o) => <Badge key={o.value} variant="secondary" className="rounded-sm px-1 font-normal">{o.label}</Badge>)
              )}
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[230px] p-0">
        <Command>
          <CommandInput placeholder={title} wrapperClassName="p-1.5" />
          <CommandList className="max-h-[300px] p-1">
            <CommandEmpty>{t.table.noOption}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o.value} value={o.text} onSelect={() => toggle(o.value)} className="px-2 py-1.5 text-sm" aria-checked={on.has(o.value)}>
                  <span className={cn('grid size-4 place-items-center rounded-sm border', on.has(o.value) ? 'border-primary bg-primary text-primary-foreground' : 'border-foreground/40 [&_svg]:invisible')}>
                    <Check size={12} strokeWidth={3} aria-hidden />
                  </span>
                  {o.label}
                  <span className="ml-auto font-mono text-xs text-muted-foreground">{counts.get(o.value) ?? 0}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {picked.length > 0 && (
              <>
                <CommandSeparator className="my-1" />
                <CommandGroup>
                  <CommandItem value="__reset" onSelect={() => onPick([])} className="justify-center px-2 py-1.5 text-sm">
                    {t.table.reset}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
