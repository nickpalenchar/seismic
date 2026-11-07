// A schema-change page: the persisted data models a change touches, before and after, as one
// self-contained HTML page with an ER-style diagram (added green, changed amber, removed red) and a
// list of the changes and the source files they were read from. The worker reads the models out of
// whatever the project uses (SQL migrations, an ORM's models, …) into the JSON below; this script
// knows no dialect or ORM. Large schemas are cut to the affected entities and their direct
// neighbours.
//
//   node schema.ts <models.json> <page.html>
//
// models.json:
//   {
//     "title": "Feedback on approval",               (optional)
//     "sources": ["src/server/db.ts"],               the migrations or model files it was read from
//     "before": { "entities": [ … ] },
//     "after":  { "entities": [ … ] }
//   }
// an entity: { "name": "cards", "was": "old_name"?, "fields": [ … ], "indexes": [ … ]? }
// a field:   { "name": "card_id", "type": "TEXT", "was": "old_name"?, "pk": true?, "unique": true?,
//              "nullable": true?, "default": "0"?, "ref": "cards" | "cards.id"? }
// an index:  { "name": "cards_state", "columns": ["state"], "unique": true? }
//
// Plain Node with type stripping, like the director: no imports without extensions, no Bun APIs.

import fs from 'node:fs';
import { isMain } from './here.ts';
import { LOOK } from './look.ts';

export interface Field {
  name: string;
  type?: string;
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

export interface Entity {
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

/** Every entity of before and after with what happened to it, its fields and its indexes. */
export function diffModels(before: Models, after: Models): EntityDiff[] {
  return pair(before.entities, after.entities).map(({ a, b }) => {
    const fields: FieldDiff[] = pair(a?.fields ?? [], b?.fields ?? []).map(({ a: fa, b: fb }) => {
      if (!fa) return { name: fb!.name, status: 'added', field: fb!, changes: [] };
      if (!fb) return { name: fa.name, status: 'removed', field: fa, changes: [] };
      const changes = fieldChanges(fa, fb);
      return { name: fb.name, ...(fa.name !== fb.name ? { was: fa.name } : {}), status: changes.length ? 'changed' : 'same', field: fb, before: fa, changes };
    });
    const ia = new Map((a?.indexes ?? []).map((i) => [i.name, i]));
    const indexes: IndexDiff[] = [];
    for (const i of b?.indexes ?? []) {
      const was = ia.get(i.name);
      ia.delete(i.name);
      indexes.push(!was ? { name: i.name, status: 'added', index: i } : { name: i.name, status: describeIndex(was) === describeIndex(i) ? 'same' : 'changed', index: i, before: was });
    }
    for (const i of ia.values()) indexes.push({ name: i.name, status: 'removed', index: i });
    const e = (b ?? a)!;
    const status: Status = !a ? 'added' : !b ? 'removed' : a.name !== b.name || fields.some((f) => f.status !== 'same') || indexes.some((i) => i.status !== 'same') ? 'changed' : 'same';
    // a new or dropped entity's fields and indexes come and go with it
    const all = (s: Status) => (x: { status: Status }) => ({ ...x, status: s });
    return {
      name: e.name,
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
    const near = [
      ...targets(whole ? d.fields : d.fields.filter((f) => f.status !== 'same')),
      ...(gone ? diffs.filter((x) => targets(x.fields).some((t) => t === d.name || t === d.was)).map((x) => x.name) : []),
    ];
    for (const n of near) {
      const e = byName.get(n);
      if (e && e.status === 'same' && !placed.has(n)) (placed.add(n), out.push({ entity: e, neighbour: true }));
    }
  }
  return out;
}

/** The changes in words, one line each, for the list under the diagram. */
export function changeList(diffs: EntityDiff[]): { status: Status; html: string }[] {
  const out: { status: Status; html: string }[] = [];
  const code = (s: string) => `<code>${esc(s)}</code>`;
  for (const d of diffs) {
    if (d.status === 'same') continue;
    if (d.status === 'added') out.push({ status: 'added', html: `New ${code(d.name)} with ${d.fields.length} field${d.fields.length === 1 ? '' : 's'}` });
    else if (d.status === 'removed') out.push({ status: 'removed', html: `${code(d.name)} dropped` });
    else {
      if (d.was) out.push({ status: 'changed', html: `${code(d.was)} renamed to ${code(d.name)}` });
      for (const f of d.fields) {
        const name = code(`${d.name}.${f.name}`);
        if (f.status === 'added') out.push({ status: 'added', html: `${name} added${f.field.type ? ` as ${code(f.field.type)}` : ''}${f.field.ref ? `, refers to ${code(f.field.ref)}` : ''}` });
        else if (f.status === 'removed') out.push({ status: 'removed', html: `${name} removed` });
        else if (f.status === 'changed') out.push({ status: 'changed', html: `${name}: ${f.changes.map((c) => esc(c)).join('; ')}` });
      }
    }
    for (const i of d.indexes) {
      if (i.status === 'same' || d.status !== 'changed') continue;
      const what = `index ${code(i.name)} on ${code(d.name)} ${esc(describeIndex(i.index))}`;
      out.push({ status: i.status, html: i.status === 'added' ? `New ${what}` : i.status === 'removed' ? `${what[0]!.toUpperCase()}${what.slice(1)} dropped` : `Index ${code(i.name)} on ${code(d.name)} now ${esc(describeIndex(i.index))}, was ${esc(describeIndex(i.before!))}` });
    }
  }
  return out;
}

export function esc(s: unknown): string {
  return text(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Unchanged fields an affected entity shows all of; past this, only its keys and references, the rest counted. */
const SHOWN_UNCHANGED = 8;
const SIGN: Record<Status, string> = { added: '+', removed: '−', changed: '~', same: '' };

function fieldRow(entity: string, f: FieldDiff): string {
  const ty = f.status === 'changed' && text(f.before?.type) !== text(f.field.type) ? `<s>${esc(f.before?.type)}</s> → ${esc(f.field.type)}` : esc(f.field.type);
  const badges = [f.field.pk ? '<span class="badge">PK</span>' : '', f.field.unique ? '<span class="badge">UQ</span>' : '', f.field.nullable ? '<span class="badge">null</span>' : ''].join('');
  const ref = f.field.ref ? `<span class="ref">→ <span class="mono">${esc(f.field.ref)}</span></span>` : '';
  const title = f.changes.length ? ` title="${esc(f.changes.join('; '))}"` : '';
  return `<li class="field ${f.status}" data-entity="${esc(entity)}" data-field="${esc(f.name)}"${title}><span class="sign">${SIGN[f.status]}</span><span class="fname mono">${f.was ? `<s>${esc(f.was)}</s> ` : ''}${esc(f.name)}</span><span class="ftype mono">${ty}</span>${badges}${ref}</li>`;
}

function entityBox(e: EntityDiff, neighbour: boolean, focus: Set<string>, drawn: Set<string>): string {
  let fields = e.fields;
  let hidden = 0;
  // of a wide entity: its keys, what changed, and references to another entity drawn
  const kept = (f: FieldDiff) => f.status !== 'same' || f.field.pk || (f.field.ref && refEntity(f.field.ref) !== e.name && drawn.has(refEntity(f.field.ref)));
  if (neighbour) {
    fields = e.fields.filter((f) => f.field.pk || (f.field.ref && focus.has(refEntity(f.field.ref))));
    hidden = e.fields.length - fields.length;
  } else if (e.fields.filter((f) => f.status === 'same').length > SHOWN_UNCHANGED) {
    fields = e.fields.filter(kept);
    hidden = e.fields.length - fields.length;
  }
  const indexes = neighbour ? [] : e.indexes.filter((i) => i.status !== 'same' || e.status !== 'changed');
  const sameIndexes = neighbour ? 0 : e.indexes.length - indexes.length;
  const label = e.status === 'same' ? (neighbour ? 'related' : '') : e.status;
  return `<section class="entity ${e.status}${neighbour ? ' neighbour' : ''}" data-entity="${esc(e.name)}">
<header><span class="sign">${SIGN[e.status]}</span><span class="ename mono">${e.was ? `<s>${esc(e.was)}</s> → ` : ''}${esc(e.name)}</span>${label ? `<span class="tag">${label}</span>` : ''}</header>
<ul>${fields.map((f) => fieldRow(e.name, f)).join('')}${hidden ? `<li class="more">${hidden} more field${hidden === 1 ? '' : 's'}${neighbour ? '' : ' unchanged'}</li>` : ''}</ul>${
    indexes.length || sameIndexes
      ? `<ul class="indexes">${indexes.map((i) => `<li class="field ${i.status}"><span class="sign">${SIGN[i.status]}</span><span class="fname mono">${esc(i.name)}</span><span class="ftype mono">${esc(describeIndex(i.index))}</span></li>`).join('')}${sameIndexes ? `<li class="more">${sameIndexes} more index${sameIndexes === 1 ? '' : 'es'} unchanged</li>` : ''}</ul>`
      : ''
  }
</section>`;
}

/**
 * The boxes in columns, so that references mostly run from left to right: an entity that refers to
 * none of the others shown stands rightmost, one that refers to it left of it, and so on. A cycle
 * of references is broken where it closes.
 */
export function columns<T extends { entity: EntityDiff; neighbour: boolean }>(shown: T[]): T[][] {
  const names = new Set(shown.map((s) => s.entity.name));
  // a neighbour draws only its references to the entities the change touches
  const focus = new Set(shown.filter((s) => !s.neighbour).map((s) => s.entity.name));
  const refs = new Map(
    shown.map((s) => [
      s.entity.name,
      [...new Set(s.entity.fields.map((f) => f.field.ref && refEntity(f.field.ref)).filter((r): r is string => !!r && r !== s.entity.name && names.has(r) && (!s.neighbour || focus.has(r))))],
    ]),
  );
  const level = new Map<string, number>();
  const of = (name: string, path: Set<string>): number => {
    if (level.has(name)) return level.get(name)!;
    if (path.has(name)) return 0;
    path.add(name);
    const l = Math.max(-1, ...refs.get(name)!.map((r) => of(r, path))) + 1;
    path.delete(name);
    level.set(name, l);
    return l;
  };
  for (const n of names) of(n, new Set());
  const top = Math.max(0, ...level.values());
  const out: T[][] = Array.from({ length: top + 1 }, () => []);
  for (const s of shown) out[top - level.get(s.entity.name)!]!.push(s);
  return out.filter((c) => c.length);
}

/** The relations to draw between the boxes shown: from a field to the entity (and field) it refers to. */
function relations(shown: EntityDiff[]): { from: [string, string]; to: [string, string | null]; status: Status }[] {
  const names = new Set(shown.map((e) => e.name));
  const out: { from: [string, string]; to: [string, string | null]; status: Status }[] = [];
  for (const e of shown)
    for (const f of e.fields) {
      const ref = f.field.ref;
      if (!ref) continue;
      const [target, field] = [refEntity(ref), ref.includes('.') ? ref.slice(ref.indexOf('.') + 1) : null];
      if (!names.has(target)) continue;
      // a reference of the entity to itself that the change leaves alone says nothing about it
      if (target === e.name && f.status === 'same' && f.before?.ref === ref) continue;
      const status: Status = f.status === 'added' || f.status === 'removed' ? f.status : f.before?.ref !== ref ? 'added' : e.status === 'removed' ? 'removed' : 'same';
      out.push({ from: [e.name, f.name], to: [target, field], status });
    }
  return out;
}

/** Draws the relations over the boxes once laid out, again whenever the layout changes. */
const DRAW = `(() => {
  const data = JSON.parse(document.getElementById('relations').textContent);
  const diagram = document.querySelector('.diagram');
  const svg = diagram.querySelector('svg');
  const find = (sel, entity, field) => [...diagram.querySelectorAll(sel)].find((el) => el.dataset.entity === entity && (field == null || el.dataset.field === field));
  const draw = () => {
    const box = diagram.getBoundingClientRect();
    svg.setAttribute('width', box.width); svg.setAttribute('height', box.height);
    svg.querySelectorAll('path.rel').forEach((p) => p.remove());
    for (const r of data) {
      const from = find('li.field', r.from[0], r.from[1]);
      const target = find('section.entity', r.to[0]);
      if (!from || !target) continue;
      const to = (r.to[1] != null && find('li.field', r.to[0], r.to[1])) || target.querySelector('header');
      const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
      const ea = from.closest('section').getBoundingClientRect(), eb = target.getBoundingClientRect();
      const ya = a.top + a.height / 2 - box.top, yb = b.top + b.height / 2 - box.top;
      let xa, xb, da, db;
      const ca = (ea.left + ea.right) / 2, cb = (eb.left + eb.right) / 2;
      // beside each other: from the facing sides; one above the other: out on the right and back
      if (Math.abs(cb - ca) < 40) { xa = ea.right; xb = eb.right; da = 1; db = 1; }
      else if (cb > ca) { xa = ea.right; xb = eb.left; da = 1; db = -1; }
      else { xa = ea.left; xb = eb.right; da = -1; db = 1; }
      xa -= box.left; xb -= box.left;
      const bend = Math.max(28, Math.abs(xb - xa) / 2.5);
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', 'M' + xa + ' ' + ya + ' C' + (xa + da * bend) + ' ' + ya + ' ' + (xb + db * bend) + ' ' + yb + ' ' + xb + ' ' + yb);
      p.setAttribute('class', 'rel ' + r.status);
      p.setAttribute('marker-end', 'url(#arrow-' + r.status + ')');
      svg.appendChild(p);
    }
  };
  addEventListener('load', draw);
  addEventListener('resize', draw);
  new ResizeObserver(draw).observe(diagram);
  draw();
})();`;

const STYLE = `
${LOOK}
:root { --add-bg:color-mix(in srgb, var(--add) 13%, var(--card)); --chg-bg:color-mix(in srgb, var(--chg) 13%, var(--card));
  --del-bg:color-mix(in srgb, var(--del) 13%, var(--card)); }
main { padding:20px 20px 28px; }
.mono, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size:.92em; }
h1 { font-size:22px; line-height:1.25; margin:0 0 4px; }
h2 { font-size:16px; margin:24px 0 8px; }
.sub { color:var(--muted); margin:0 0 14px; }
.legend { display:flex; flex-wrap:wrap; gap:14px; color:var(--muted); font-size:13px; margin-bottom:14px; }
.legend span::before { content:""; display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px; vertical-align:-1px; border:2px solid var(--c); }
.legend .added { --c:var(--add); } .legend .changed { --c:var(--chg); } .legend .removed { --c:var(--del); } .legend .same { --c:var(--line); }
.diagram { position:relative; display:flex; gap:72px; align-items:flex-start; padding:4px; width:max-content; min-width:100%; }
.column { display:flex; flex-direction:column; gap:28px; }
.diagram svg { position:absolute; inset:0; pointer-events:none; overflow:visible; }
.entity { position:relative; z-index:1; background:var(--card); border:2px solid var(--line); border-radius:12px; box-shadow:var(--shadow); min-width:220px; max-width:420px; overflow:hidden; }
.entity.added { border-color:var(--add); } .entity.changed { border-color:var(--chg); } .entity.removed { border-color:var(--del); }
.entity.neighbour { border-style:dashed; opacity:.85; }
.entity header { display:flex; align-items:center; gap:6px; padding:7px 10px; font-weight:600; border-bottom:1px solid var(--line); background:var(--chip); }
.entity.added header { background:var(--add-bg); } .entity.changed header { background:var(--chg-bg); } .entity.removed header { background:var(--del-bg); }
.entity header .tag { margin-left:auto; font-weight:500; font-size:12px; color:var(--muted); }
.entity.added .tag { color:var(--add); } .entity.changed .tag { color:var(--chg); } .entity.removed .tag { color:var(--del); }
.entity ul { list-style:none; margin:0; padding:4px 0; }
.entity ul.indexes { border-top:1px solid var(--line); }
.entity ul.indexes .field { white-space:normal; flex-wrap:wrap; }
.field { display:flex; align-items:baseline; gap:6px; padding:2px 10px; white-space:nowrap; }
.field .fname { flex:none; }
.field .ftype { color:var(--muted); margin-left:auto; padding-left:12px; }
.field.added { background:var(--add-bg); } .field.added .fname, .field.added .sign { color:var(--add); }
.field.changed { background:var(--chg-bg); } .field.changed .fname, .field.changed .sign { color:var(--chg); }
.field.removed { background:var(--del-bg); } .field.removed .fname, .field.removed .sign { color:var(--del); }
.field.removed .fname, .field.removed .ftype, .entity.removed .ename { text-decoration:line-through; }
.sign { width:10px; flex:none; font-weight:700; text-align:center; }
.entity.added .ename { color:var(--add); } .entity.removed .ename { color:var(--del); }
.badge { font-size:10px; font-weight:600; letter-spacing:.03em; color:var(--muted); border:1px solid var(--line); border-radius:4px; padding:0 4px; }
.ref { color:var(--muted); font-size:12px; }
.more { color:var(--muted); font-size:12px; padding:2px 10px 2px 26px; font-style:italic; }
s { opacity:.7; }
path.rel { fill:none; stroke:var(--muted); stroke-width:1.5; }
path.rel.added { stroke:var(--add); stroke-width:2; } path.rel.removed { stroke:var(--del); stroke-dasharray:5 4; }
marker path { stroke:none; }
ul.changes { margin:0; padding:0; list-style:none; }
ul.changes li { padding:3px 0 3px 22px; position:relative; }
ul.changes li::before { position:absolute; left:4px; font-weight:700; }
ul.changes li.added::before { content:"+"; color:var(--add); } ul.changes li.changed::before { content:"~"; color:var(--chg); } ul.changes li.removed::before { content:"−"; color:var(--del); }
.sources { color:var(--muted); font-size:13px; }
.none { color:var(--muted); }
`;

/** Checks the input's shape, so a mistake in the worker's JSON says where it is. */
export function checkInput(x: unknown): SchemaChange {
  const fail = (what: string) => {
    throw new Error(`models.json: ${what}`);
  };
  const o = x as Partial<SchemaChange>;
  if (!o || typeof o !== 'object') fail('not an object');
  if (!Array.isArray(o.sources)) fail('"sources" must list the migrations or model files the models were read from');
  for (const side of ['before', 'after'] as const) {
    const m = o[side];
    if (!m || !Array.isArray(m.entities)) fail(`"${side}.entities" must be an array`);
    for (const e of m!.entities) {
      if (!e || typeof e.name !== 'string' || !e.name) fail(`an entity of "${side}" has no name`);
      if (!Array.isArray(e.fields)) fail(`"${side}" entity ${e.name} has no "fields" array`);
      for (const f of e.fields) if (!f || typeof f.name !== 'string' || !f.name) fail(`a field of ${side} entity ${e.name} has no name`);
      if (e.indexes !== undefined && (!Array.isArray(e.indexes) || e.indexes.some((i) => !i || typeof i.name !== 'string' || !Array.isArray(i.columns))))
        fail(`the indexes of ${side} entity ${e.name} need a name and "columns"`);
    }
  }
  return o as SchemaChange;
}

/** The whole page, self-contained: nothing loaded from elsewhere. */
export function renderSchemaPage(input: SchemaChange): string {
  const diffs = diffModels(input.before, input.after);
  const shown = cut(diffs);
  const focus = new Set(shown.filter((s) => !s.neighbour).map((s) => s.entity.name));
  const touched = shown.filter((s) => !s.neighbour).length;
  const neighbours = shown.length - touched;
  const changes = changeList(diffs);
  const title = input.title?.trim() || 'Schema change';
  const rels = relations(shown.map((s) => s.entity));
  // inside a script element, `</script>` in a name would end it
  const json = JSON.stringify(rels).replace(/</g, '\\u003c');
  const marker = (s: Status, color: string) =>
    `<marker id="arrow-${s}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" style="fill:${color}"/></marker>`;
  const body = shown.length
    ? `<p class="sub">${touched} ${touched === 1 ? 'entity' : 'entities'} changed${neighbours ? ` · ${neighbours} related ${neighbours === 1 ? 'entity' : 'entities'} shown for context` : ''}</p>
<div class="legend"><span class="added">added</span><span class="changed">changed</span><span class="removed">removed</span>${neighbours ? '<span class="same">related, unchanged</span>' : ''}</div>
<div class="diagram"><svg aria-hidden="true"><defs>${marker('added', 'var(--add)')}${marker('removed', 'var(--del)')}${marker('same', 'var(--muted)')}${marker('changed', 'var(--chg)')}</defs></svg>
${columns(shown).map((col) => `<div class="column">${col.map((s) => entityBox(s.entity, s.neighbour, focus, new Set(shown.map((x) => x.entity.name)))).join('\n')}</div>`).join('\n')}
</div>
<h2>Changes</h2>
<ul class="changes">${changes.map((c) => `<li class="${c.status}">${c.html}</li>`).join('')}</ul>`
    : `<p class="none">The data models are the same before and after.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
${body}
<h2>Drawn from</h2>
<p class="sources">${input.sources.length ? input.sources.map((s) => `<code>${esc(s)}</code>`).join(', ') : 'No source files named.'}</p>
</main>
<script type="application/json" id="relations">${json}</script>
${shown.length ? `<script>${DRAW}</script>` : ''}
</body>
</html>
`;
}

if (isMain(import.meta.filename)) {
  const [from, to] = process.argv.slice(2);
  if (!from || !to) {
    console.error('usage: node schema.ts <models.json> <page.html>');
    process.exit(2);
  }
  try {
    const input = checkInput(JSON.parse(fs.readFileSync(from, 'utf8')));
    fs.writeFileSync(to, renderSchemaPage(input));
    const diffs = diffModels(input.before, input.after).filter((d) => d.status !== 'same');
    console.log(diffs.length ? `${to}: ${diffs.map((d) => `${d.name} ${d.status}`).join(', ')}` : `${to}: no change to the models`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
