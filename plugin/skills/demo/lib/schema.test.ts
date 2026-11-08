import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changeList, checkInput, columns, cut, diffModels, type Entity, renderSchemaPage, type SchemaChange } from './schema.ts';

const cards: Entity = {
  name: 'cards',
  fields: [
    { name: 'id', type: 'TEXT', pk: true },
    { name: 'project_id', type: 'TEXT', ref: 'projects.id' },
    { name: 'legacy_flag', type: 'INTEGER' },
    { name: 'title', type: 'TEXT' },
  ],
  indexes: [{ name: 'cards_open', columns: ['project_id'] }],
};
const projects: Entity = { name: 'projects', fields: [{ name: 'id', type: 'TEXT', pk: true }, { name: 'name', type: 'TEXT' }] };
const devices: Entity = { name: 'devices', fields: [{ name: 'id', type: 'TEXT', pk: true }] };
const users: Entity = { name: 'users', fields: [{ name: 'id', type: 'TEXT', pk: true }, { name: 'email', type: 'TEXT' }] };

/** cards loses `legacy_flag`, gains `feedback_note` and an index, `title` becomes nullable; sessions, new, refers to cards and users; devices, unrelated, stays. */
const change: SchemaChange = {
  sources: ['migrations/0042.sql'],
  before: { entities: [projects, cards, devices, users] },
  after: {
    entities: [
      projects,
      {
        ...cards,
        fields: [cards.fields[0]!, cards.fields[1]!, { name: 'title', type: 'TEXT', nullable: true }, { name: 'feedback_note', type: 'TEXT' }],
        indexes: [...cards.indexes!, { name: 'cards_note', columns: ['feedback_note'], unique: true }],
      },
      devices,
      users,
      { name: 'sessions', fields: [{ name: 'id', type: 'INTEGER', pk: true }, { name: 'card_id', type: 'TEXT', ref: 'cards.id' }, { name: 'user_id', type: 'TEXT', ref: 'users.id' }] },
    ],
  },
};

describe('the schema-change page', () => {
  test('marks what was added, changed and removed, down to fields and indexes', () => {
    const d = Object.fromEntries(diffModels(change.before, change.after).map((e) => [e.name, e]));
    expect(d.sessions!.status).toBe('added');
    expect(d.devices!.status).toBe('same');
    expect(d.cards!.status).toBe('changed');
    const f = Object.fromEntries(d.cards!.fields.map((x) => [x.name, x]));
    expect([f.id!.status, f.feedback_note!.status, f.legacy_flag!.status, f.title!.status]).toEqual(['same', 'added', 'removed', 'changed']);
    expect(f.title!.changes).toEqual(['now nullable']);
    expect(d.cards!.indexes.map((i) => [i.name, i.status])).toEqual([
      ['cards_open', 'same'],
      ['cards_note', 'added'],
    ]);
    const dropped = diffModels({ entities: [devices] }, { entities: [] });
    expect(dropped[0]!.status).toBe('removed');
    expect(dropped[0]!.fields[0]!.status).toBe('removed');
    const list = changeList(diffModels(change.before, change.after)).map((c) => `${c.status} ${c.html.replace(/<[^>]+>/g, '')}`);
    expect(list).toContain('added cards.feedback_note added as TEXT');
    expect(list).toContain('removed cards.legacy_flag removed');
    expect(list).toContain('changed cards.title: now nullable');
    expect(list).toContain('added New sessions with 3 fields');
    expect(list).toContain('added New index cards_note on cards unique (feedback_note)');

    const html = renderSchemaPage(change);
    expect(html).toContain('class="entity added" data-entity="sessions"');
    expect(html).toContain('class="entity changed" data-entity="cards"');
    expect(html).toContain('class="field added" data-entity="cards" data-field="feedback_note"');
    expect(html).toContain('class="field removed" data-entity="cards" data-field="legacy_flag"');
    expect(html).toContain('<code>migrations/0042.sql</code>');
  });

  test('a renamed entity or field counts as changed, not as one removed and one added', () => {
    const d = diffModels(
      { entities: [{ name: 'notes', fields: [{ name: 'body', type: 'TEXT' }] }] },
      { entities: [{ name: 'comments', was: 'notes', fields: [{ name: 'text', was: 'body', type: 'TEXT' }] }] },
    );
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ name: 'comments', was: 'notes', status: 'changed' });
    expect(d[0]!.fields[0]).toMatchObject({ name: 'text', was: 'body', status: 'changed', changes: ['renamed from body'] });
  });

  test('is cut to the affected entities and their direct neighbours along the relations the change touches', () => {
    const shown = cut(diffModels(change.before, change.after)).map((s) => [s.entity.name, s.neighbour]);
    // users: the new sessions refers to it; projects only by a field of cards the change leaves alone; devices relates to nothing changed
    expect(shown).toEqual([
      ['cards', false],
      ['sessions', false],
      ['users', true],
    ]);
    const html = renderSchemaPage(change);
    expect(html).not.toContain('data-entity="devices"');
    expect(html).not.toContain('data-entity="projects"');
    // a neighbour shows its keys, the rest counted
    expect(html).toMatch(/data-entity="users"[\s\S]*?1 more field</);
    // a dropped or renamed entity brings those that refer to it
    const dropped = cut(diffModels({ entities: [projects, cards] }, { entities: [{ ...cards, fields: cards.fields.filter((f) => f.name !== 'project_id') }] }));
    expect(dropped.map((s) => [s.entity.name, s.neighbour])).toEqual([
      ['cards', false],
      ['projects', false],
    ]);
    const renamed = cut(diffModels({ entities: [projects, cards] }, { entities: [{ ...projects, name: 'boards', was: 'projects' }, cards] }));
    expect(renamed.map((s) => [s.entity.name, s.neighbour])).toEqual([
      ['boards', false],
      ['cards', true],
    ]);
    // references run from left to right: the referring entities in the first column
    expect(columns(cut(diffModels(change.before, change.after))).map((c) => c.map((s) => s.entity.name))).toEqual([['sessions'], ['cards', 'users']]);
    // an affected entity with many unchanged fields shows its keys, references and changes, the rest counted
    const wide: Entity = { name: 'wide', fields: [{ name: 'id', type: 'TEXT', pk: true }, { name: 'parent_id', type: 'TEXT', ref: 'wide.id' }, ...Array.from({ length: 19 }, (_, i) => ({ name: `c${i}`, type: 'TEXT' }))] };
    const page = renderSchemaPage({ sources: [], before: { entities: [wide] }, after: { entities: [{ ...wide, fields: [...wide.fields, { name: 'extra', type: 'TEXT' }] }] } });
    expect(page).toContain('data-field="extra"');
    expect(page).not.toContain('data-field="c5"');
    expect(page).toContain('20 more fields unchanged');
    // nor does a reference to itself the change leaves alone get a line
    expect(page).not.toContain('data-field="parent_id"');
    expect(page).toContain('<script type="application/json" id="relations">[]</script>');
  });

  test('without a change to the models, the page says so', () => {
    const html = renderSchemaPage({ sources: ['db.ts'], before: { entities: [cards] }, after: { entities: [cards] } });
    expect(html).toContain('The data models are the same before and after.');
    expect(html).not.toContain('class="diagram"');
  });

  test('escapes names, types and sources, also inside its script data', () => {
    const evil = '</script><img src=x onerror=alert(1)>';
    const html = renderSchemaPage({
      title: '<b>T</b>',
      sources: ['<i>m.sql</i>'],
      before: { entities: [] },
      after: { entities: [{ name: evil, fields: [{ name: '"f"', type: '<T>', ref: evil }] }] },
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>T</b>');
    expect(html).not.toContain('<i>m.sql');
    expect(html).toContain('&lt;T&gt;');
    expect(html).toContain('data-field="&quot;f&quot;"');
    // one closing tag per script element: the data's `</script>` is escaped
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    const data = /<script type="application\/json" id="relations">([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(JSON.parse(data)[0].from[0]).toBe(evil);
  });

  test('sets entity names, field names and types in monospace, headings and prose in the normal font', () => {
    const html = renderSchemaPage(change);
    expect(html).toMatch(/\.mono, code \{ font-family: ui-monospace/);
    expect(html).toContain('<span class="ename mono">cards</span>');
    expect(html).toContain('<span class="fname mono">feedback_note</span><span class="ftype mono">TEXT</span>');
    expect(html).toContain('<code>cards.feedback_note</code>');
    expect(html).toMatch(/<h1>Schema change<\/h1>/);
    expect(html).toMatch(/body \{[^}]*font:15px\/1.55 Inter, system-ui/);
  });

  test('loads nothing from elsewhere and follows light and dark', () => {
    const html = renderSchemaPage(change);
    expect(html).not.toMatch(/(src|href)=["']?https?:/);
    expect(html).not.toMatch(/@import|url\((?!#)/);
    expect(html).toContain('prefers-color-scheme: dark');
  });

  test('runs under plain Node, and a mistake in the JSON says where it is', () => {
    const dir = mkdtempSync(join(tmpdir(), 'obeya-schema-'));
    try {
      writeFileSync(join(dir, 'm.json'), JSON.stringify(change));
      const out = execFileSync('node', [join(import.meta.dirname, 'schema.ts'), join(dir, 'm.json'), join(dir, 'p.html')], { encoding: 'utf8' });
      expect(out).toContain('cards changed, sessions added');
      expect(readFileSync(join(dir, 'p.html'), 'utf8')).toContain('<!doctype html>');
      expect(() => checkInput({ sources: [], before: { entities: [] }, after: { entities: [{ name: 'x' }] } })).toThrow('"after" entity x has no "fields" array');
      expect(() => checkInput({ before: { entities: [] }, after: { entities: [] } })).toThrow('"sources"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
