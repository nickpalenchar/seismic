// Shared schema input, comparison and diagram layout. No browser or runtime dependencies.
export interface Field {
  name: string;
  type?: string;
  /** Embedded document properties (also used for array item properties). */
  fields?: Field[];
  optional?: boolean;
  /** Its name before the change, for a renamed field. */
  was?: string;
  pk?: boolean;
  unique?: boolean;
  nullable?: boolean;
  default?: string | number | boolean | null;
  /** The entity it refers to, `entity` or `entity.field`. */
  ref?: string;
}

export interface Index {
  name: string;
  columns: string[];
  unique?: boolean;
}

export type EntityKind = 'table' | 'columnar' | 'document';

export interface Entity {
  /** Omitted for existing SQL/table inputs. */
  kind?: EntityKind;
  name: string;
  /** Its name before the change, for a renamed entity. */
  was?: string;
  fields: Field[];
  indexes?: Index[];
}

export interface Models {
  entities: Entity[];
}

export interface SchemaChange {
  title?: string;
  sources: string[];
  before: Models;
  after: Models;
}

export type Status = 'added' | 'changed' | 'removed' | 'same';

export interface FieldDiff {
  /** Full property path before the change, including renamed parents. */
  beforeName?: string;
  name: string;
  was?: string;
  status: Status;
  field: Field;
  before?: Field;
  /** What changed, one phrase each ("type TEXT → INTEGER"). */
  changes: string[];
}

export interface IndexDiff {
  name: string;
  status: Status;
  index: Index;
  before?: Index;
}

export interface EntityDiff {
  kind: EntityKind;
  beforeKind?: EntityKind;
  name: string;
  was?: string;
  status: Status;
  fields: FieldDiff[];
  indexes: IndexDiff[];
}

const text = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const refEntity = (ref: string) => ref.split('.')[0]!;
const describeIndex = (i: Index) => `${i.unique ? 'unique ' : ''}(${i.columns.join(', ')})`;

/** What differs between two versions of a field, one phrase each. */
function fieldChanges(a: Field, b: Field): string[] {
  const out: string[] = [];
  if (a.name !== b.name) out.push(`renamed from ${a.name}`);
  if (text(a.type) !== text(b.type)) out.push(`type ${text(a.type) || '–'} → ${text(b.type) || '–'}`);
  if (!!a.pk !== !!b.pk) out.push(b.pk ? 'now primary key' : 'no longer primary key');
  if (!!a.unique !== !!b.unique) out.push(b.unique ? 'now unique' : 'no longer unique');
  if (!!a.optional !== !!b.optional) out.push(b.optional ? 'now optional' : 'now required');
  if (!!a.nullable !== !!b.nullable) out.push(b.nullable ? 'now nullable' : 'now not null');
  if (text(a.default) !== text(b.default)) out.push(`default ${text(a.default) || '–'} → ${text(b.default) || '–'}`);
  if (text(a.ref) !== text(b.ref)) out.push(b.ref ? (a.ref ? `refers to ${b.ref} instead of ${a.ref}` : `now refers to ${b.ref}`) : `no longer refers to ${a.ref}`);
  return out;
}

/** Pairs the items of before and after by name, or by `was` for a renamed one, in the order of after, removed ones last. */
function pair<T extends { name: string; was?: string }>(before: T[], after: T[]): { a?: T; b?: T }[] {
  const left = new Map(before.map((x) => [x.name, x]));
  const out: { a?: T; b?: T }[] = [];
  for (const b of after) {
    const key = b.was && left.has(b.was) ? b.was : b.name;
    const a = left.get(key);
    left.delete(key);
    out.push({ a, b });
  }
  for (const a of left.values()) out.push({ a });
  return out;
}

/** Pair nested properties within their parent, preserving renames and full paths for references. */
function diffFields(before: Field[], after: Field[], oldPath = '', newPath = ''): FieldDiff[] {
  return pair(before, after).flatMap(({ a, b }): FieldDiff[] => {
    const name = newPath + (b ?? a)!.name;
    const previous = oldPath + (a ?? b)!.name;
    const changes = a && b ? fieldChanges(a, b) : [];
    const field: FieldDiff = {
      name, field: (b ?? a)!, ...(a ? { before: a, beforeName: previous } : {}),
      ...(a && b && a.name !== b.name ? { was: previous } : {}),
      status: !a ? 'added' : !b ? 'removed' : changes.length ? 'changed' : 'same', changes,
    };
    return [field, ...diffFields(a?.fields ?? [], b?.fields ?? [], previous + '.', name + '.')];
  });
}

/** Every entity of before and after with what happened to it, its fields and its indexes. */
export function diffModels(before: Models, after: Models): EntityDiff[] {
  return pair(before.entities, after.entities).map(({ a, b }) => {
    const fields = diffFields(a?.fields ?? [], b?.fields ?? []);
    const ia = new Map((a?.indexes ?? []).map((i) => [i.name, i]));
    const indexes: IndexDiff[] = [];
    for (const i of b?.indexes ?? []) {
      const was = ia.get(i.name);
      ia.delete(i.name);
      indexes.push(!was ? { name: i.name, status: 'added', index: i } : { name: i.name, status: describeIndex(was) === describeIndex(i) ? 'same' : 'changed', index: i, before: was });
    }
    for (const i of ia.values()) indexes.push({ name: i.name, status: 'removed', index: i });
    const e = (b ?? a)!;
    const status: Status = !a ? 'added' : !b ? 'removed' : a.name !== b.name || (a.kind ?? 'table') !== (b.kind ?? 'table') || fields.some((f) => f.status !== 'same') || indexes.some((i) => i.status !== 'same') ? 'changed' : 'same';
    // a new or dropped entity's fields and indexes come and go with it
    const all = (s: Status) => (x: { status: Status }) => ({ ...x, status: s });
    return {
      name: e.name,
      kind: e.kind ?? 'table',
      ...(a && b && (a.kind ?? 'table') !== (b.kind ?? 'table') ? { beforeKind: a.kind ?? 'table' } : {}),
      ...(a && b && a.name !== b.name ? { was: a.name } : {}),
      status,
      fields: status === 'added' || status === 'removed' ? fields.map(all(status)) : fields,
      indexes: status === 'added' || status === 'removed' ? indexes.map(all(status)) : indexes,
    } as EntityDiff;
  });
}

/**
 * The entities to draw: those the change touches, each followed by its direct neighbours along the
 * relations the change makes, drops or breaks: those a new or dropped entity, or a changed field,
 * refers to, and those referring to an entity that is dropped or renamed. A column added to a
 * central table does not bring every table around it.
 */
export function cut(diffs: EntityDiff[]): { entity: EntityDiff; neighbour: boolean }[] {
  const byName = new Map(diffs.map((d) => [d.name, d]));
  const targets = (fields: FieldDiff[]) => fields.flatMap((f) => [f.field.ref, f.before?.ref].filter((r): r is string => !!r).map(refEntity));
  const out: { entity: EntityDiff; neighbour: boolean }[] = [];
  const placed = new Set<string>();
  for (const d of diffs.filter((x) => x.status !== 'same')) {
    if (!placed.has(d.name)) (placed.add(d.name), out.push({ entity: d, neighbour: false }));
    const whole = d.status === 'added' || d.status === 'removed';
    const gone = d.status === 'removed' || !!d.was;
    const changedTargets = new Set(d.fields.filter(f => f.status === 'removed' || f.beforeName && f.beforeName !== f.name)
      .map(f => `${d.was ?? d.name}.${f.beforeName ?? f.name}`));
    const near = [
      ...targets(whole ? d.fields : d.fields.filter((f) => f.status !== 'same')),
      ...(gone || changedTargets.size ? diffs.filter(x => x.fields.some(f => [f.field.ref, f.before?.ref].some(ref => ref &&
        (gone && (refEntity(ref) === d.name || refEntity(ref) === d.was) || changedTargets.has(ref)))))
        .map(x => x.name) : []),
    ];
    for (const n of near) {
      const e = byName.get(n);
      if (e && e.status === 'same' && !placed.has(n)) (placed.add(n), out.push({ entity: e, neighbour: true }));
    }
  }
  return out;
}

export type ChangePart = string | { code: string };
export interface ChangeDescription { status: Status; parts: ChangePart[] }

/** Structured descriptions shared by the components and the legacy HTML list API. */
export function describeChanges(diffs: EntityDiff[]): ChangeDescription[] {
  const out: ChangeDescription[] = [];
  const code = (value: string): ChangePart => ({ code: value });
  const add = (status: Status, ...parts: ChangePart[]) => out.push({ status, parts });
  for (const d of diffs) {
    if (d.status === 'same') continue;
    if (d.status === 'added') add('added', 'New ', code(d.name), ` with ${d.fields.length} field${d.fields.length === 1 ? '' : 's'}`);
    else if (d.status === 'removed') add('removed', code(d.name), ' dropped');
    else {
      if (d.beforeKind) add('changed', code(d.name), `: ${d.beforeKind} → ${d.kind}`);
      if (d.was) add('changed', code(d.was), ' renamed to ', code(d.name));
      for (const f of d.fields) {
        const name = code(`${d.name}.${f.name}`);
        if (f.status === 'added') add('added', name, ' added',
          ...(f.field.type ? [' as ', code(f.field.type)] : []),
          ...(f.field.ref ? [', refers to ', code(f.field.ref)] : []));
        else if (f.status === 'removed') add('removed', name, ' removed');
        else if (f.status === 'changed') add('changed', name, ': ', f.changes.join('; '));
      }
    }
    for (const i of d.indexes) {
      if (i.status === 'same' || d.status !== 'changed') continue;
      if (i.status === 'changed') add('changed', 'Index ', code(i.name), ' on ', code(d.name), ` now ${describeIndex(i.index)}, was ${describeIndex(i.before!)}`);
      else add(i.status, i.status === 'added' ? 'New index ' : 'Index ', code(i.name), ' on ', code(d.name), ` ${describeIndex(i.index)}${i.status === 'removed' ? ' dropped' : ''}`);
    }
  }
  return out;
}

/** Compatibility for callers that already consume the escaped HTML descriptions. */
export function changeList(diffs: EntityDiff[]): { status: Status; html: string }[] {
  return describeChanges(diffs).map(c => ({ status: c.status,
    html: c.parts.map(p => typeof p === 'string' ? esc(p) : `<code>${esc(p.code)}</code>`).join(''),
  }));
}

export function esc(s: unknown): string {
  return text(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * The boxes in columns, so that references mostly run from left to right: an entity that refers to
 * none of the others shown stands rightmost, one that refers to it left of it, and so on. A cycle
 * of references is broken where it closes.
 */
export function columns<T extends { entity: EntityDiff; neighbour: boolean }>(shown: T[], edges = relations(shown.map(s => s.entity))): T[][] {
  const focus = new Set(shown.filter(s => !s.neighbour).map(s => s.entity.name));
  const refs = new Map(shown.map(s => [s.entity.name, new Set<string>()]));
  const neighbours = new Set(shown.filter(s => s.neighbour).map(s => s.entity.name));
  for (const r of edges) if (r.from[0] !== r.to[0] && (!neighbours.has(r.from[0]) || focus.has(r.to[0])))
    refs.get(r.from[0])!.add(r.to[0]);
  const level = new Map<string, number>();
  const of = (name: string, path: Set<string>): number => {
    if (level.has(name)) return level.get(name)!;
    if (path.has(name)) return 0;
    path.add(name);
    const l = Math.max(-1, ...[...refs.get(name)!].map((r) => of(r, path))) + 1;
    path.delete(name);
    level.set(name, l);
    return l;
  };
  for (const n of refs.keys()) of(n, new Set());
  const top = Math.max(0, ...level.values());
  const out: T[][] = Array.from({ length: top + 1 }, () => []);
  for (const s of shown) out[top - level.get(s.entity.name)!]!.push(s);
  return out.filter((c) => c.length);
}

export interface Relation {
  from: [string, string];
  to: [string, string | null];
  status: Status;
}

/** Resolve each version separately, then map both onto the displayed entity and property names. */
export function relations(shown: EntityDiff[]): Relation[] {
  type Endpoint = [string, string | null];
  const versions = (side: 'before' | 'after') => {
    const entities = new Map<string, EntityDiff>();
    const fields = new Map<string, string>();
    for (const e of shown) {
      if (e.status === (side === 'before' ? 'added' : 'removed')) continue;
      const name = side === 'before' ? e.was ?? e.name : e.name;
      entities.set(name, e);
      for (const f of e.fields) {
        if (side === 'before' ? !f.before : f.status === 'removed') continue;
        fields.set(JSON.stringify([name, side === 'before' ? f.beforeName ?? f.was ?? f.name : f.name]), f.name);
      }
    }
    return (ref?: string): Endpoint | undefined => {
      if (!ref) return;
      const name = refEntity(ref), entity = entities.get(name);
      if (!entity) return;
      if (!ref.includes('.')) return [entity.name, null];
      const field = fields.get(JSON.stringify([name, ref.slice(ref.indexOf('.') + 1)]));
      if (field !== undefined) return [entity.name, field];
    };
  };
  const before = versions('before'), after = versions('after');
  const out: Relation[] = [];
  for (const e of shown) for (const f of e.fields) {
    const oldTarget = before(f.before?.ref);
    const newTarget = f.status === 'removed' ? undefined : after(f.field.ref);
    const emit = (to: Endpoint | undefined, status: Status) => {
      if (to) out.push({ from: [e.name, f.name], to, status });
    };
    if (oldTarget && newTarget && oldTarget[0] === newTarget[0] && oldTarget[1] === newTarget[1]) {
      // Unchanged self references add no context to the change.
      if (newTarget[0] !== e.name || f.status !== 'same') emit(newTarget, 'same');
    } else {
      emit(oldTarget, 'removed');
      emit(newTarget, 'added');
    }
  }
  return out;
}
