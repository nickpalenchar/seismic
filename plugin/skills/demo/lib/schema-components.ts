// Reusable, dependency-free server components for schema artifacts. They render once from data;
// the output needs neither a client framework nor a network request to display its schema.
import { describeChanges, columns, cut, diffModels, esc, relations, type EntityDiff, type FieldDiff, type SchemaChange, type Status } from './schema-model.ts';
import { SCHEMA_STYLE } from './schema-look.ts';
import { DRAW } from './schema-draw.ts';

// Only component output is markup; all ordinary strings and attributes are escaped here.
class Markup {
  readonly html: string;
  constructor(html: string) { this.html = html; }
}
type Child = Markup | string | number | false | null | undefined | Child[];
const content = (c: Child): string => c instanceof Markup ? c.html : Array.isArray(c) ? c.map(content).join('') : c === false || c == null ? '' : esc(c);
function el(tag: string, attrs: Record<string, string | number | undefined> | null, ...children: Child[]): Markup {
  const a = Object.entries(attrs ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  return new Markup(`<${tag}${a}>${children.map(content).join('')}</${tag}>`);
}
const span = (cls: string, ...children: Child[]) => el('span', { class: cls }, children);
const SIGN: Record<Status, string> = { added: '+', removed: '−', changed: '~', same: '' };
const shownUnchanged = 8;
const target = (ref: string) => ref.split('.')[0]!;
const indexDescription = (i: { columns: string[]; unique?: boolean }) => `${i.unique ? 'unique ' : ''}(${i.columns.join(', ')})`;

export function SchemaField({ entity, field: f }: { entity: string; field: FieldDiff }): Markup {
  const type = f.status === 'changed' && f.before?.type !== f.field.type
    ? [el('s', null, f.before?.type), ' → ', f.field.type] : f.field.type;
  return el('li', { class: `field ${f.status}`, 'data-entity': entity, 'data-field': f.name,
    title: f.changes.length ? f.changes.join('; ') : undefined },
    span('sign', SIGN[f.status]),
    span('fname mono', f.was && [el('s', null, f.was), ' '], f.name),
    span('ftype mono', type),
    f.field.pk && span('badge', 'PK'), f.field.unique && span('badge', 'UQ'),
    f.field.nullable && span('badge', 'null'), f.field.optional && span('badge', 'optional'),
    f.field.ref && span('ref', '→ ', span('mono', f.field.ref)));
}

export function SchemaEntity({ entity: e, neighbour = false, focus, drawn }: {
  entity: EntityDiff; neighbour?: boolean; focus: Set<string>; drawn: Set<string>;
}): Markup {
  let fields = e.fields;
  if (neighbour) fields = fields.filter(f => f.field.pk || (f.field.ref && focus.has(target(f.field.ref))));
  else if (fields.filter(f => f.status === 'same').length > shownUnchanged)
    fields = fields.filter(f => f.status !== 'same' || f.field.pk || (f.field.ref && target(f.field.ref) !== e.name && drawn.has(target(f.field.ref))));
  const hidden = e.fields.length - fields.length;
  const indexes = neighbour ? [] : e.indexes.filter(i => i.status !== 'same' || e.status !== 'changed');
  const sameIndexes = neighbour ? 0 : e.indexes.length - indexes.length;
  const label = e.status === 'same' ? (neighbour ? 'related' : '') : e.status;
  return el('section', { class: `entity ${e.status}${neighbour ? ' neighbour' : ''}`, 'data-entity': e.name },
    el('header', null, span('sign', SIGN[e.status]), span('ename mono', e.was && [el('s', null, e.was), ' → '], e.name),
      e.kind !== 'table' && span('badge', e.kind === 'document' ? 'document' : 'columnar'), label && span('tag', label)),
    el('ul', null, fields.map(field => SchemaField({ entity: e.name, field })),
      hidden > 0 && el('li', { class: 'more' }, `${hidden} more field${hidden === 1 ? '' : 's'}${neighbour ? '' : ' unchanged'}`)),
    (indexes.length > 0 || sameIndexes > 0) && el('ul', { class: 'indexes' },
      indexes.map(i => el('li', { class: `field ${i.status}` }, span('sign', SIGN[i.status]), span('fname mono', i.name), span('ftype mono', indexDescription(i.index)))),
      sameIndexes > 0 && el('li', { class: 'more' }, `${sameIndexes} more index${sameIndexes === 1 ? '' : 'es'} unchanged`)));
}

export function SchemaDiagram({ diffs }: { diffs: EntityDiff[] }): Markup {
  const shown = cut(diffs);
  const focus = new Set(shown.filter(s => !s.neighbour).map(s => s.entity.name));
  const drawn = new Set(shown.map(s => s.entity.name));
  const colors: Record<Status, string> = { added: 'var(--add)', removed: 'var(--del)', same: 'var(--muted)', changed: 'var(--chg)' };
  return el('div', { class: 'diagram' }, el('svg', { 'aria-hidden': 'true' }, el('defs', null,
    (Object.keys(colors) as Status[]).map(s => el('marker', { id: `arrow-${s}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
      el('path', { d: 'M0 0 L10 5 L0 10 z', style: `fill:${colors[s]}` }))))),
    columns(shown).map(col => el('div', { class: 'column' }, col.map(s => SchemaEntity({ ...s, focus, drawn })))));
}

export function SchemaChanges({ diffs }: { diffs: EntityDiff[] }): Markup {
  return el('ul', { class: 'changes' }, describeChanges(diffs).map(c => el('li', { class: c.status },
    c.parts.map(p => typeof p === 'string' ? p : el('code', null, p.code)))));
}

export function SchemaPage(input: SchemaChange): string {
  const diffs = diffModels(input.before, input.after);
  const shown = cut(diffs);
  const touched = shown.filter(s => !s.neighbour).length;
  const neighbours = shown.length - touched;
  const title = input.title?.trim() || 'Schema change';
  const json = JSON.stringify(relations(shown.map(s => s.entity))).replace(/</g, '\\u003c');
  return '<!doctype html>\n' + content(el('html', { lang: 'en' },
    el('head', null, new Markup('<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">'),
      el('title', null, title), el('style', null, new Markup(SCHEMA_STYLE))),
    el('body', null, el('main', null, el('h1', null, title), shown.length ? [
      el('p', { class: 'sub' }, `${touched} ${touched === 1 ? 'entity' : 'entities'} changed${neighbours ? ` · ${neighbours} related ${neighbours === 1 ? 'entity' : 'entities'} shown for context` : ''}`),
      el('div', { class: 'legend' }, span('added', 'added'), span('changed', 'changed'), span('removed', 'removed'), neighbours > 0 && span('same', 'related, unchanged')),
      SchemaDiagram({ diffs }), el('h2', null, 'Changes'), SchemaChanges({ diffs }),
    ] : el('p', { class: 'none' }, 'The data models are the same before and after.'),
    el('h2', null, 'Drawn from'), el('p', { class: 'sources' }, input.sources.length ? input.sources.flatMap((s, i) => [i ? ', ' : '', el('code', null, s)]) : 'No source files named.')),
    el('script', { type: 'application/json', id: 'relations' }, new Markup(json)),
    shown.length > 0 && el('script', null, new Markup(DRAW))))) + '\n';
}
