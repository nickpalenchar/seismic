import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { type Db, SHORT } from './schemas/common';
import * as schema from './schemas/schema';




export { SHORT };
export type { Db };


const SCHEMA = `
  CREATE TABLE canvases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE groups (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    name TEXT NOT NULL,
    hue INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    kind TEXT NOT NULL,
    state TEXT,
    need TEXT,
    title TEXT,
    body TEXT,
    x REAL NOT NULL,
    y REAL NOT NULL,
    parent_id TEXT REFERENCES cards(id),
    plan_ref TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    session_id TEXT,
    workspace TEXT,
    branch TEXT,
    status_line TEXT,
    detail TEXT,
    from_id TEXT REFERENCES cards(id),
    scope TEXT,
    queue TEXT,
    pr TEXT,
    repo TEXT,
    demo TEXT,
    archived_at TEXT,
    idea TEXT,
    prototype_of TEXT REFERENCES cards(id),
    approved_at TEXT,
    landed TEXT,
    images TEXT,
    plan TEXT,
    plan_docs TEXT,
    prototype TEXT,
    built_on TEXT REFERENCES cards(id),
    share TEXT,
    retro TEXT,
    proposal TEXT,
    group_id TEXT REFERENCES groups(id),
    shipped TEXT,
    parked TEXT,
    held TEXT,
    becomes_project INTEGER NOT NULL DEFAULT 0,
    thread TEXT,
    paused TEXT,
    unheard TEXT,
    UNIQUE (canvas_id, plan_ref)
  );
  CREATE TABLE workspaces (
    path TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    card_id TEXT REFERENCES cards(id),
    repo TEXT
  );
  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id),
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    code TEXT,
    images TEXT,
    mocks TEXT,
    reply_to INTEGER,
    spot TEXT,
    answer TEXT,
    picks TEXT,
    unread INTEGER,
    read_after INTEGER
  );
  CREATE INDEX events_card ON events (card_id, id);
  CREATE TABLE decisions (
    id INTEGER PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    project_id TEXT REFERENCES cards(id),
    card_id TEXT NOT NULL REFERENCES cards(id),
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    by TEXT NOT NULL,
    at TEXT NOT NULL
  );
  CREATE TABLE settings (
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (canvas_id, key)
  );
  CREATE TABLE preferences (
    id INTEGER PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    text TEXT NOT NULL,
    card_id TEXT REFERENCES cards(id),
    created_at TEXT NOT NULL,
    deleted_at TEXT,
    state TEXT NOT NULL DEFAULT 'active',
    quote TEXT,
    review INTEGER NOT NULL DEFAULT 0,
    replaces INTEGER REFERENCES preferences(id),
    decided_at TEXT,
    target TEXT
  );
  -- what the owner said to the Koordinator and what it answered: its memory across sessions
  CREATE TABLE talk (
    id INTEGER PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    at TEXT NOT NULL,
    said TEXT NOT NULL,
    reply TEXT NOT NULL,
    card_id TEXT REFERENCES cards(id),
    undone INTEGER NOT NULL DEFAULT 0,
    question TEXT,
    about TEXT,
    answer TEXT,
    answer_by TEXT,
    images TEXT,
    unread INTEGER NOT NULL DEFAULT 0,
    session_id TEXT,
    thread INTEGER,
    follows INTEGER,
    files TEXT,
    card TEXT
  );
  -- the work retrospective: friction noted on a card's run, per repository
  CREATE TABLE friction (
    id INTEGER PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    repo TEXT NOT NULL,
    card_id TEXT NOT NULL REFERENCES cards(id),
    at TEXT NOT NULL,
    what TEXT NOT NULL,
    cost TEXT NOT NULL,
    fix TEXT NOT NULL
  );
  CREATE INDEX friction_repo ON friction (canvas_id, repo, at);
  -- a command the owner has the confirmation of, while it waits for "Undo": it outlives a restart
  CREATE TABLE commands (
    token TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    due TEXT NOT NULL,
    body TEXT NOT NULL
  );
  -- a value for a repository's setting the work retrospective proposes, and where the owner took it
  CREATE TABLE setting_proposals (
    id INTEGER PRIMARY KEY,
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    repo TEXT NOT NULL,
    field TEXT NOT NULL,
    value TEXT NOT NULL,
    basis TEXT NOT NULL,
    cards TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'proposed',
    created_at TEXT NOT NULL,
    decided_at TEXT
  );`;





export const RELEASED = 40;


export const MIGRATIONS = [
  
  
  
  
  
  `UPDATE cards SET demo = json_set(demo, '$.kind', 'video') WHERE demo IS NOT NULL AND json_extract(demo, '$.kind') IS NULL;
   UPDATE cards SET share = json_set(share, '$.shown.kind', 'video') WHERE json_extract(share, '$.shown') IS NOT NULL AND json_extract(share, '$.shown.kind') IS NULL;
   UPDATE cards SET share = json_set(share, '$.state', 'publishing') WHERE json_extract(share, '$.state') = 'pending';
   UPDATE cards SET detail = json_set(coalesce(detail, '{}'), '$.answering', json('true')), demo = json_remove(demo, '$.answering')
    WHERE json_extract(demo, '$.answering');
   UPDATE cards SET demo = json_set(demo, '$.handover', (
       SELECT max(e.id) FROM events e WHERE e.card_id = cards.id AND e.kind = 'review'
          AND e.id < coalesce((SELECT max(a.id) FROM events a WHERE a.card_id = cards.id AND a.kind = 'answer' AND a.text = json_extract(cards.demo, '$.answer')), 9e18)))
    WHERE json_extract(demo, '$.question') IS NOT NULL AND json_extract(demo, '$.handover') IS NULL
      AND EXISTS (SELECT 1 FROM events e WHERE e.card_id = cards.id AND e.kind = 'review');
   UPDATE cards SET plan = json_object('file', plan_ref, 'title', coalesce(title, plan_ref), 'goal', '', 'workstreams', json('[]'), 'markdown', '')
    WHERE kind = 'project' AND plan_ref IS NOT NULL AND plan IS NULL;
   UPDATE events SET text = 'Paused.' WHERE kind = 'state' AND author = 'owner' AND text LIKE 'Paused. %';
   UPDATE events SET text = 'Pausiert.' WHERE kind = 'state' AND author = 'owner' AND text LIKE 'Pausiert. %';
   INSERT INTO settings (canvas_id, key, value)
     SELECT canvas_id, 'work_retro_runs:' || substr(key, 18), '3' FROM settings s WHERE key LIKE 'work_retro_since:%'
        AND NOT EXISTS (SELECT 1 FROM settings r WHERE r.canvas_id = s.canvas_id AND r.key = 'work_retro_runs:' || substr(s.key, 18));`,
  
  'ALTER TABLE talk ADD COLUMN reply_to TEXT;',
  
  'ALTER TABLE cards ADD COLUMN app TEXT;',
  
  `CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    paired_at TEXT NOT NULL,
    last_seen TEXT NOT NULL
  );`,
  
  'ALTER TABLE talk ADD COLUMN wish TEXT; ALTER TABLE events ADD COLUMN wish TEXT;',
  
  'ALTER TABLE cards ADD COLUMN demos TEXT;',
  
  'ALTER TABLE cards ADD COLUMN waiting_since TEXT;',
  
  `CREATE TABLE trusted_commands (
    repo TEXT PRIMARY KEY,
    commands TEXT NOT NULL,
    at TEXT NOT NULL
  );`,
  
  'ALTER TABLE devices ADD COLUMN push TEXT;',
  
  'ALTER TABLE talk ADD COLUMN held TEXT;',
  
  'ALTER TABLE cards ADD COLUMN snoozed TEXT;',
  
  'ALTER TABLE talk ADD COLUMN waits TEXT; ALTER TABLE talk ADD COLUMN after_wait TEXT;',
  
  `CREATE TABLE folder_cards (
    card_id TEXT PRIMARY KEY,
    folder TEXT NOT NULL,
    state TEXT NOT NULL
  );`,
  
  'ALTER TABLE cards ADD COLUMN files TEXT;',
  
  'ALTER TABLE cards ADD COLUMN deps TEXT;',
  
  'ALTER TABLE cards ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0;',
  
  'ALTER TABLE talk ADD COLUMN asked_in TEXT;',
  
  'ALTER TABLE events ADD COLUMN reply INTEGER;',
  
  'ALTER TABLE cards ADD COLUMN kept_in TEXT;',
  
  'ALTER TABLE cards ADD COLUMN contribution TEXT;',
  
  
  'ALTER TABLE cards ADD COLUMN new_repo TEXT; ALTER TABLE talk ADD COLUMN moved TEXT;',
  
  'ALTER TABLE cards ADD COLUMN page_heard TEXT;',
  
  'ALTER TABLE events ADD COLUMN forwarded INTEGER;',
  
  'ALTER TABLE cards ADD COLUMN pausing TEXT;',
  
  
  'ALTER TABLE talk ADD COLUMN then_step TEXT; ALTER TABLE talk ADD COLUMN after_answer INTEGER;',
  
  'ALTER TABLE cards ADD COLUMN agent_setting TEXT;',
  
  'ALTER TABLE events ADD COLUMN agent TEXT; ALTER TABLE talk ADD COLUMN reply_agent TEXT; ALTER TABLE talk ADD COLUMN answer_agent TEXT;',
  
  `ALTER TABLE cards ADD COLUMN short TEXT;
   UPDATE cards SET short = substr(replace(id, '-', ''), 1, ${SHORT});
   ${Array.from({ length: 32 - SHORT }, (_, k) => `UPDATE cards SET short = substr(replace(id, '-', ''), 1, ${SHORT + 1 + k}) WHERE short IN (SELECT short FROM cards GROUP BY short HAVING count(*) > 1);`).join('\n   ')}
   CREATE UNIQUE INDEX cards_short ON cards (short);`,
  
  'ALTER TABLE events ADD COLUMN token INTEGER;',
  
  `CREATE INDEX cards_open ON cards (canvas_id) WHERE deleted_at IS NULL AND archived_at IS NULL;
   CREATE INDEX cards_plan_docs ON cards (canvas_id) WHERE deleted_at IS NULL AND plan_docs IS NOT NULL;
   CREATE INDEX cards_prototypes ON cards (canvas_id, created_at) WHERE deleted_at IS NULL AND prototype_of IS NOT NULL;
   CREATE INDEX cards_waiting ON cards (canvas_id) WHERE waiting_since IS NOT NULL;
   CREATE INDEX cards_shared ON cards (canvas_id) WHERE deleted_at IS NULL AND share IS NOT NULL;`,
  
  'ALTER TABLE talk ADD COLUMN then_place TEXT;',
  
  'ALTER TABLE events ADD COLUMN made TEXT;',
  
  
  
  
  
  `CREATE TABLE agent_runs (
    card_id TEXT NOT NULL REFERENCES cards(id),
    session_id TEXT NOT NULL,
    harness TEXT,
    model TEXT,
    effort TEXT,
    requested TEXT,
    started_at TEXT NOT NULL,
    PRIMARY KEY (card_id, session_id)
  );
   CREATE TABLE feedback (
    id INTEGER PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id),
    canvas_id TEXT NOT NULL REFERENCES canvases(id),
    handover INTEGER NOT NULL,
    context TEXT NOT NULL,
    attribution TEXT NOT NULL,
    configs TEXT NOT NULL,
    harness TEXT,
    model TEXT,
    effort TEXT,
    answer TEXT NOT NULL,
    facets TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    UNIQUE (card_id, handover)
  );
   WITH c AS (
     SELECT id, session_id, agent_setting AS s,
       coalesce((SELECT max(at) FROM events WHERE card_id = cards.id AND kind = 'state' AND author = 'obeya' AND (text LIKE 'Agent started%' OR text LIKE 'Agent gestartet%')), created_at) AS started,
       CASE WHEN json_extract(agent_setting, '$.harness') = 'codex' OR (agent_setting IS NULL AND session_id LIKE 'codex:%') THEN 'codex' ELSE 'claude' END AS h
     FROM cards),
   i AS (
     SELECT card_id, json_extract(agent, '$.harness') AS h, json_extract(agent, '$.model') AS m, min(at) AS at
     FROM events WHERE agent IS NOT NULL AND author IN ('worker', 'explorer') GROUP BY 1, 2, 3),
   n AS (SELECT card_id, count(*) AS k FROM i GROUP BY card_id)
   INSERT OR IGNORE INTO agent_runs (card_id, session_id, harness, model, effort, requested, started_at)
     SELECT id, session_id, h, CASE WHEN h = 'codex' AND json_extract(s, '$.codex.model') <> 'default' THEN json_extract(s, '$.codex.model') END,
       json_extract(s, CASE h WHEN 'codex' THEN '$.codex.effort' ELSE '$.effort' END),
       json_extract(s, CASE h WHEN 'codex' THEN '$.codex.model' ELSE '$.model' END), started
       FROM c WHERE session_id IS NOT NULL AND id NOT IN (SELECT card_id FROM i)
     UNION ALL
     SELECT x.card_id, CASE WHEN x.own THEN c.session_id ELSE 'earlier:' || x.h || ':' || coalesce(x.m, '') END, x.h, x.m,
       CASE WHEN x.own THEN json_extract(c.s, CASE c.h WHEN 'codex' THEN '$.codex.effort' ELSE '$.effort' END) END,
       CASE WHEN x.own THEN json_extract(c.s, CASE c.h WHEN 'codex' THEN '$.codex.model' ELSE '$.model' END) END, x.at
       FROM (SELECT i.*, n.k = 1 AND i.h = c.h AND c.session_id IS NOT NULL AS own FROM i JOIN n USING (card_id) JOIN c ON c.id = i.card_id) x
       JOIN c ON c.id = x.card_id;`,
  
  'ALTER TABLE cards ADD COLUMN priority TEXT;',
  
  `ALTER TABLE cards ADD COLUMN category TEXT;
   ALTER TABLE cards ADD COLUMN subcategory TEXT;
   ALTER TABLE cards ADD COLUMN complexity INTEGER;
   ALTER TABLE cards ADD COLUMN suggested_labels TEXT;
   ALTER TABLE cards ADD COLUMN owner_labels TEXT;`,
  
  'ALTER TABLE cards ADD COLUMN code_review TEXT;',
  
  
  `CREATE TABLE chats (id INTEGER PRIMARY KEY, canvas_id TEXT NOT NULL REFERENCES canvases(id), at TEXT NOT NULL, opened TEXT NOT NULL);
   CREATE INDEX chats_canvas ON chats (canvas_id, opened);
   ALTER TABLE talk ADD COLUMN chat INTEGER REFERENCES chats(id);
   INSERT INTO chats (canvas_id, at, opened) SELECT canvas_id, MIN(at), MAX(at) FROM talk GROUP BY canvas_id;
   UPDATE talk SET chat = (SELECT id FROM chats WHERE chats.canvas_id = talk.canvas_id);
   CREATE INDEX talk_chat ON talk (chat, id);`,
  'ALTER TABLE chats ADD COLUMN model TEXT;',
  
  
  `UPDATE cards SET kind = 'plan' WHERE kind = 'project';
   UPDATE events SET author = 'plan' WHERE author = 'project';
   UPDATE talk SET answer_by = 'plan' WHERE answer_by = 'project';
   UPDATE decisions SET by = 'plan' WHERE by = 'project';
   UPDATE feedback SET context = json_set(json_remove(context, '$.project'), '$.plan', json_extract(context, '$.project')) WHERE json_extract(context, '$.project') IS NOT NULL;
   ALTER TABLE cards RENAME COLUMN becomes_project TO becomes_plan;
   ALTER TABLE decisions RENAME COLUMN project_id TO plan_id;`,
  
  
  `ALTER TABLE workspaces RENAME TO workstations;
   ALTER TABLE cards RENAME COLUMN workspace TO workstation;
   UPDATE cards SET queue = json_set(json_remove(queue, '$.workspace'), '$.workstation', json_extract(queue, '$.workspace'))
    WHERE json_extract(queue, '$.workspace') IS NOT NULL;`,
  
  
  
  
  `ALTER TABLE canvases RENAME TO projects;
   ALTER TABLE groups RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE cards RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE workstations RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE decisions RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE settings RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE preferences RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE talk RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE friction RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE commands RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE setting_proposals RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE feedback RENAME COLUMN canvas_id TO project_id;
   ALTER TABLE chats RENAME COLUMN canvas_id TO project_id;
   DROP INDEX chats_canvas;
   CREATE INDEX chats_project ON chats (project_id, opened);
   UPDATE talk SET moved = json_set(json_remove(moved, '$.canvas', '$.canvasName'), '$.project', json_extract(moved, '$.canvas'), '$.projectName', json_extract(moved, '$.canvasName'))
    WHERE json_extract(moved, '$.canvas') IS NOT NULL;
   UPDATE cards SET new_repo = json_set(json_remove(new_repo, '$.canvas'), '$.project', json(new_repo -> '$.canvas'))
    WHERE json_extract(new_repo, '$.canvas') IS NOT NULL;
   UPDATE events SET made = json_set(json_remove(made, '$.canvas'), '$.project', json_extract(made, '$.canvas'))
    WHERE json_extract(made, '$.canvas') IS NOT NULL;`,
  
  
  `CREATE TABLE canvases (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES projects(id),
     name TEXT NOT NULL,
     icon TEXT,
     position INTEGER NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE UNIQUE INDEX canvases_name ON canvases (project_id, name COLLATE NOCASE);
   INSERT INTO canvases (id, project_id, name, position, created_at) SELECT lower(hex(randomblob(16))), id, 'main', 0, created_at FROM projects;
   ALTER TABLE cards ADD COLUMN canvas_id TEXT;
   ALTER TABLE groups ADD COLUMN canvas_id TEXT;
   UPDATE cards SET canvas_id = (SELECT c.id FROM canvases c WHERE c.project_id = cards.project_id);
   UPDATE groups SET canvas_id = (SELECT c.id FROM canvases c WHERE c.project_id = groups.project_id);
   CREATE INDEX cards_canvas ON cards (canvas_id);`,
  
  'ALTER TABLE cards ADD COLUMN parking_lot TEXT;',
  
  `CREATE TABLE activity (
     id INTEGER PRIMARY KEY,
     at TEXT NOT NULL,
     card_id TEXT NOT NULL REFERENCES cards(id),
     who TEXT NOT NULL,
     code TEXT NOT NULL,
     other_id TEXT REFERENCES cards(id),
     harness TEXT,
     title TEXT
   );
   CREATE INDEX activity_card ON activity (card_id, id);`,
  
  
  
  
  `ALTER TABLE \`cards\` ADD \`hold\` text;
   UPDATE cards SET hold = CASE
     WHEN snoozed IS NOT NULL THEN json_patch(
       json_patch(snoozed, json_object('reason', 'snoozed', 'since', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))),
       CASE WHEN paused IS NOT NULL THEN json_object('held', json(coalesce(json_extract(paused, '$.held'), '[]'))) ELSE '{}' END)
     WHEN json_extract(paused, '$.limit') IS NOT NULL THEN json_patch(
       json_object('reason', 'limit', 'since', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'attempts', json_extract(paused, '$.limit.attempts')),
       json_object('until', json_extract(paused, '$.limit.until'), 'statusBefore', json_extract(paused, '$.limit.statusBefore'), 'held', json_extract(paused, '$.held')))
     WHEN paused IS NOT NULL THEN json_patch(
       json_object('reason', 'paused', 'since', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
       json_object('held', json_extract(paused, '$.held')))
     WHEN pausing IS NOT NULL THEN json_object('reason', 'pausing', 'since', pausing)
     WHEN parking_lot IS NOT NULL THEN json_object('reason', 'parkingLot', 'since', parking_lot)
   END
   WHERE snoozed IS NOT NULL OR paused IS NOT NULL OR pausing IS NOT NULL OR parking_lot IS NOT NULL;`,
  
  
  `CREATE TABLE \`card_ideas\` (
     \`card_id\` text PRIMARY KEY NOT NULL,
     \`discussion\` text,
     \`prototype_of\` text,
     \`prototype\` text,
     \`proposal\` text,
     \`built_on\` text,
     \`becomes_plan\` integer DEFAULT false NOT NULL,
     \`new_repo\` text,
     FOREIGN KEY (\`card_id\`) REFERENCES \`cards\`(\`id\`) ON UPDATE no action ON DELETE no action,
     FOREIGN KEY (\`prototype_of\`) REFERENCES \`cards\`(\`id\`) ON UPDATE no action ON DELETE no action,
     FOREIGN KEY (\`built_on\`) REFERENCES \`cards\`(\`id\`) ON UPDATE no action ON DELETE no action
   );
   CREATE INDEX \`card_ideas_prototype_of\` ON \`card_ideas\` (\`prototype_of\`) WHERE prototype_of IS NOT NULL;
   INSERT INTO card_ideas (card_id, discussion, prototype_of, prototype, proposal, built_on, becomes_plan, new_repo)
     SELECT id, idea, prototype_of, prototype, proposal, built_on, becomes_plan, new_repo FROM cards
     WHERE idea IS NOT NULL OR prototype_of IS NOT NULL OR prototype IS NOT NULL OR proposal IS NOT NULL
       OR built_on IS NOT NULL OR becomes_plan != 0 OR new_repo IS NOT NULL;`,
  
  
  
  
  `DROP INDEX \`cards_plan_docs\`;
   DROP INDEX \`cards_shared\`;
   CREATE TABLE \`card_reviews\` (
     \`card_id\` text PRIMARY KEY NOT NULL,
     \`pr\` text,
     \`contribution\` text,
     \`code_review\` text,
     FOREIGN KEY (\`card_id\`) REFERENCES \`cards\`(\`id\`) ON UPDATE no action ON DELETE no action
   );
   CREATE TABLE \`card_demos\` (
     \`card_id\` text PRIMARY KEY NOT NULL,
     \`latest\` text,
     \`share\` text,
     \`page_heard\` text,
     \`files\` text,
     \`held\` text,
     FOREIGN KEY (\`card_id\`) REFERENCES \`cards\`(\`id\`) ON UPDATE no action ON DELETE no action
   );
   CREATE INDEX \`card_demos_shared\` ON \`card_demos\` (\`card_id\`) WHERE share IS NOT NULL;
   CREATE TABLE \`card_earlier_demos\` (
     \`card_id\` text NOT NULL,
     \`position\` integer NOT NULL,
     \`demo\` text NOT NULL,
     PRIMARY KEY(\`card_id\`, \`position\`),
     FOREIGN KEY (\`card_id\`) REFERENCES \`cards\`(\`id\`) ON UPDATE no action ON DELETE no action
   );
   CREATE TABLE \`card_plans\` (
     \`card_id\` text PRIMARY KEY NOT NULL,
     \`doc\` text,
     \`deps\` text,
     \`collapsed\` integer DEFAULT false NOT NULL,
     \`plan_docs\` text,
     FOREIGN KEY (\`card_id\`) REFERENCES \`cards\`(\`id\`) ON UPDATE no action ON DELETE no action
   );
   CREATE INDEX \`card_plans_plan_docs\` ON \`card_plans\` (\`card_id\`) WHERE plan_docs IS NOT NULL;
   CREATE TABLE \`card_labels\` (
     \`card_id\` text NOT NULL,
     \`label\` text NOT NULL,
     \`value\` text,
     \`by\` text,
     PRIMARY KEY(\`card_id\`, \`label\`),
     FOREIGN KEY (\`card_id\`) REFERENCES \`cards\`(\`id\`) ON UPDATE no action ON DELETE no action
   );
   CREATE TABLE \`card_holds\` (
     \`card_id\` text PRIMARY KEY NOT NULL,
     \`reason\` text NOT NULL,
     \`since\` text NOT NULL,
     \`detail\` text,
     FOREIGN KEY (\`card_id\`) REFERENCES \`cards\`(\`id\`) ON UPDATE no action ON DELETE no action
   );
   INSERT INTO card_reviews (card_id, pr, contribution, code_review)
     SELECT id, pr, contribution, code_review FROM cards WHERE pr IS NOT NULL OR contribution IS NOT NULL OR code_review IS NOT NULL;
   INSERT INTO card_demos (card_id, latest, share, page_heard, files, held)
     SELECT id, demo, share, page_heard, files, held FROM cards
     WHERE demo IS NOT NULL OR share IS NOT NULL OR page_heard IS NOT NULL OR files IS NOT NULL OR held IS NOT NULL OR json_array_length(demos) > 0;
   INSERT INTO card_earlier_demos (card_id, position, demo)
     SELECT c.id, CAST(d.key AS INTEGER), d.value FROM cards c, json_each(c.demos) d WHERE c.demos IS NOT NULL;
   INSERT INTO card_plans (card_id, doc, deps, collapsed, plan_docs)
     SELECT id, plan, deps, collapsed, plan_docs FROM cards WHERE plan IS NOT NULL OR deps IS NOT NULL OR collapsed != 0 OR plan_docs IS NOT NULL;
   INSERT INTO card_labels (card_id, label, value, by)
     SELECT id, 'category', category, CASE WHEN EXISTS (SELECT 1 FROM json_each(owner_labels) WHERE value = 'category') THEN 'owner'
       WHEN category IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(suggested_labels) WHERE value = 'category') THEN 'suggestion' END
     FROM cards WHERE category IS NOT NULL OR EXISTS (SELECT 1 FROM json_each(owner_labels) WHERE value = 'category');
   INSERT INTO card_labels (card_id, label, value, by)
     SELECT id, 'subcategory', subcategory, CASE WHEN EXISTS (SELECT 1 FROM json_each(owner_labels) WHERE value = 'subcategory') THEN 'owner'
       WHEN subcategory IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(suggested_labels) WHERE value = 'subcategory') THEN 'suggestion' END
     FROM cards WHERE subcategory IS NOT NULL OR EXISTS (SELECT 1 FROM json_each(owner_labels) WHERE value = 'subcategory');
   INSERT INTO card_labels (card_id, label, value, by)
     SELECT id, 'complexity', CAST(complexity AS TEXT), CASE WHEN EXISTS (SELECT 1 FROM json_each(owner_labels) WHERE value = 'complexity') THEN 'owner'
       WHEN complexity IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(suggested_labels) WHERE value = 'complexity') THEN 'suggestion' END
     FROM cards WHERE complexity IS NOT NULL OR EXISTS (SELECT 1 FROM json_each(owner_labels) WHERE value = 'complexity');
   INSERT INTO card_labels (card_id, label, value, by)
     SELECT id, 'priority', priority, CASE WHEN EXISTS (SELECT 1 FROM json_each(owner_labels) WHERE value = 'priority') THEN 'owner'
       WHEN priority IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(suggested_labels) WHERE value = 'priority') THEN 'suggestion' END
     FROM cards WHERE priority IS NOT NULL OR EXISTS (SELECT 1 FROM json_each(owner_labels) WHERE value = 'priority');
   INSERT INTO card_holds (card_id, reason, since, detail)
     SELECT id, json_extract(hold, '$.reason'), coalesce(json_extract(hold, '$.since'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
       nullif(json_remove(hold, '$.reason', '$.since'), '{}') FROM cards WHERE hold IS NOT NULL;`,
  
  
  
  
  
  `PRAGMA foreign_keys=OFF;
   CREATE TABLE \`__new_cards\` (
     \`id\` text PRIMARY KEY NOT NULL,
     \`project_id\` text NOT NULL,
     \`kind\` text NOT NULL,
     \`state\` text,
     \`need\` text,
     \`title\` text,
     \`body\` text,
     \`x\` real NOT NULL,
     \`y\` real NOT NULL,
     \`parent_id\` text,
     \`plan_ref\` text,
     \`created_at\` text NOT NULL,
     \`updated_at\` text NOT NULL,
     \`deleted_at\` text,
     \`session_id\` text,
     \`workstation\` text,
     \`branch\` text,
     \`status_line\` text,
     \`detail\` text,
     \`from_id\` text,
     \`scope\` text,
     \`queue\` text,
     \`repo\` text,
     \`archived_at\` text,
     \`approved_at\` text,
     \`landed\` text,
     \`images\` text,
     \`retro\` text,
     \`group_id\` text,
     \`shipped\` text,
     \`parked\` text,
     \`thread\` text,
     \`unheard\` text,
     \`app\` text,
     \`waiting_since\` text,
     \`kept_in\` text,
     \`agent_setting\` text,
     \`short\` text,
     \`canvas_id\` text,
     FOREIGN KEY (\`project_id\`) REFERENCES \`projects\`(\`id\`) ON UPDATE no action ON DELETE no action,
     FOREIGN KEY (\`parent_id\`) REFERENCES \`cards\`(\`id\`) ON UPDATE no action ON DELETE no action,
     FOREIGN KEY (\`from_id\`) REFERENCES \`cards\`(\`id\`) ON UPDATE no action ON DELETE no action,
     FOREIGN KEY (\`group_id\`) REFERENCES \`groups\`(\`id\`) ON UPDATE no action ON DELETE no action
   );
   INSERT INTO \`__new_cards\` (rowid, id, project_id, kind, state, need, title, body, x, y, parent_id, plan_ref, created_at, updated_at, deleted_at, session_id,
       workstation, branch, status_line, detail, from_id, scope, queue, repo, archived_at, approved_at, landed, images, retro, group_id, shipped, parked,
       thread, unheard, app, waiting_since, kept_in, agent_setting, short, canvas_id)
     SELECT rowid, id, project_id, kind, state, need, title, body, x, y, parent_id, plan_ref, created_at, updated_at, deleted_at, session_id,
       workstation, branch, status_line, detail, from_id, scope, queue, repo, archived_at, approved_at, landed, images, retro, group_id, shipped, parked,
       thread, unheard, app, waiting_since, kept_in, agent_setting, short, canvas_id FROM \`cards\`;
   DROP TABLE \`cards\`;
   ALTER TABLE \`__new_cards\` RENAME TO \`cards\`;
   CREATE UNIQUE INDEX \`cards_project_id_plan_ref_unique\` ON \`cards\` (\`project_id\`,\`plan_ref\`);
   CREATE UNIQUE INDEX \`cards_short\` ON \`cards\` (\`short\`);
   CREATE INDEX \`cards_open\` ON \`cards\` (\`project_id\`) WHERE deleted_at IS NULL AND archived_at IS NULL;
   CREATE INDEX \`cards_waiting\` ON \`cards\` (\`project_id\`) WHERE waiting_since IS NOT NULL;
   CREATE INDEX \`cards_canvas\` ON \`cards\` (\`canvas_id\`);
   PRAGMA foreign_keys=ON;`,
  
  
  
  
  
  `CREATE TABLE \`card_review_items\` (
     \`card_id\` text NOT NULL,
     \`number\` integer NOT NULL,
     \`title\` text NOT NULL,
     \`text\` text NOT NULL,
     \`severity\` text NOT NULL,
     \`file\` text,
     \`line\` integer,
     \`security\` integer DEFAULT false NOT NULL,
     \`bundle\` text,
     \`status\` text NOT NULL,
     \`follow_up\` text,
     \`context\` text,
     PRIMARY KEY(\`card_id\`, \`number\`),
     FOREIGN KEY (\`card_id\`) REFERENCES \`cards\`(\`id\`) ON UPDATE no action ON DELETE no action
   );
   CREATE TABLE \`card_review_item_events\` (
     \`card_id\` text NOT NULL,
     \`number\` integer NOT NULL,
     \`position\` integer NOT NULL,
     \`at\` text NOT NULL,
     \`who\` text NOT NULL,
     \`from\` text,
     \`to\` text NOT NULL,
     \`note\` text,
     \`handover\` integer,
     \`run\` text,
     PRIMARY KEY(\`card_id\`, \`number\`, \`position\`)
   );
   CREATE INDEX \`card_review_item_events_card\` ON \`card_review_item_events\` (\`card_id\`);
   CREATE TEMP TABLE review_source AS
     SELECT card_id, code_review AS cr,
       CASE WHEN json_extract(code_review, '$.review.state') = 'done' THEN '$.review.findings'
         ELSE (SELECT '$.previous[' || p.key || '].findings' FROM json_each(code_review, '$.previous') p WHERE json_extract(p.value, '$.state') = 'done' ORDER BY p.key DESC LIMIT 1) END AS path,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS now
     FROM card_reviews WHERE code_review IS NOT NULL;
   INSERT INTO card_review_items (card_id, number, title, text, severity, file, line, security, bundle, status, follow_up)
     SELECT s.card_id, json_extract(f.value, '$.id'), json_extract(f.value, '$.title'), json_extract(f.value, '$.text'), coalesce(json_extract(f.value, '$.severity'), 'minor'),
       json_extract(f.value, '$.file'), json_extract(f.value, '$.line'), coalesce(json_extract(f.value, '$.security'), 0), json_extract(f.value, '$.with'),
       CASE json_extract(f.value, '$.status')
         WHEN 'fixed' THEN 'underReview' WHEN 'dropped' THEN 'closed' WHEN 'later' THEN 'followUp'
         ELSE CASE json_extract(f.value, '$.decided') WHEN 'self' THEN 'fixing' WHEN 'later' THEN 'followUp' ELSE 'raised' END END,
       json_extract(f.value, '$.card')
     FROM review_source s, json_each(s.cr, s.path) f WHERE s.path IS NOT NULL;
   INSERT INTO card_review_items (card_id, number, title, text, severity, file, line, security, status)
     SELECT s.card_id,
       coalesce((SELECT max(json_extract(v.value, '$.id')) FROM json_each(s.cr, s.path) v), 0) + ROW_NUMBER() OVER (PARTITION BY s.card_id ORDER BY ig.key),
       json_extract(ig.value, '$.title'), json_extract(ig.value, '$.text'), 'minor', json_extract(ig.value, '$.file'), json_extract(ig.value, '$.line'), 0, 'closed'
     FROM review_source s, json_each(s.cr, '$.ignored') ig;
   INSERT INTO card_review_item_events (card_id, number, position, at, who, \`from\`, \`to\`)
     SELECT i.card_id, i.number, 0, s.now, 'reviewer', NULL, 'raised' FROM card_review_items i JOIN review_source s ON s.card_id = i.card_id;
   INSERT INTO card_review_item_events (card_id, number, position, at, who, \`from\`, \`to\`)
     SELECT i.card_id, i.number, 1, s.now, CASE i.status WHEN 'underReview' THEN 'worker' ELSE 'owner' END, 'raised', i.status
     FROM card_review_items i JOIN review_source s ON s.card_id = i.card_id WHERE i.status != 'raised';
   DROP TABLE review_source;
   UPDATE card_reviews SET code_review = json_remove(code_review, '$.previous', '$.ignored', '$.review.findings') WHERE code_review IS NOT NULL;`,
  
  'ALTER TABLE cards ADD COLUMN stopped_at TEXT;',
  
  
  
  
  
  `CREATE TABLE \`needs_you\` (
     \`id\` integer PRIMARY KEY NOT NULL,
     \`project_id\` text NOT NULL,
     \`kind\` text NOT NULL,
     \`card_id\` text,
     \`preference_id\` integer,
     \`setting_proposal_id\` integer,
     \`talk_id\` integer,
     \`digest\` text,
     \`created_at\` integer NOT NULL,
     \`last_updated\` integer NOT NULL,
     \`resolved_at\` integer,
     FOREIGN KEY (\`project_id\`) REFERENCES \`projects\`(\`id\`) ON UPDATE no action ON DELETE no action,
     FOREIGN KEY (\`card_id\`) REFERENCES \`cards\`(\`id\`) ON UPDATE no action ON DELETE no action,
     FOREIGN KEY (\`preference_id\`) REFERENCES \`preferences\`(\`id\`) ON UPDATE no action ON DELETE no action,
     FOREIGN KEY (\`setting_proposal_id\`) REFERENCES \`setting_proposals\`(\`id\`) ON UPDATE no action ON DELETE no action,
     FOREIGN KEY (\`talk_id\`) REFERENCES \`talk\`(\`id\`) ON UPDATE no action ON DELETE no action,
     CONSTRAINT "needs_you_one_target" CHECK((card_id IS NOT NULL) + (preference_id IS NOT NULL) + (setting_proposal_id IS NOT NULL) + (talk_id IS NOT NULL) = 1)
   );
   CREATE UNIQUE INDEX \`needs_you_open_card\` ON \`needs_you\` (\`card_id\`) WHERE resolved_at IS NULL;
   CREATE UNIQUE INDEX \`needs_you_open_preference\` ON \`needs_you\` (\`preference_id\`) WHERE resolved_at IS NULL;
   CREATE UNIQUE INDEX \`needs_you_open_setting\` ON \`needs_you\` (\`setting_proposal_id\`) WHERE resolved_at IS NULL;
   CREATE UNIQUE INDEX \`needs_you_open_talk\` ON \`needs_you\` (\`talk_id\`) WHERE resolved_at IS NULL;
   CREATE INDEX \`needs_you_open\` ON \`needs_you\` (\`project_id\`) WHERE resolved_at IS NULL;
   INSERT INTO needs_you (project_id, kind, card_id, created_at, last_updated)
     SELECT project_id, CASE need WHEN 'question' THEN 'question' WHEN 'demo' THEN 'demo' ELSE 'review' END, id,
       CAST(round((julianday(waiting_since) - 2440587.5) * 86400000) AS INTEGER), CAST(round((julianday(waiting_since) - 2440587.5) * 86400000) AS INTEGER)
     FROM cards WHERE waiting_since IS NOT NULL AND julianday(waiting_since) IS NOT NULL ORDER BY waiting_since;
   DROP INDEX \`cards_waiting\`;
   ALTER TABLE cards DROP COLUMN waiting_since;`,
  
  'ALTER TABLE talk ADD COLUMN arrived INTEGER;',
  
  'ALTER TABLE talk ADD COLUMN made TEXT;',
  'ALTER TABLE talk ADD COLUMN request_id TEXT;',
  
  `UPDATE cards SET canvas_id = (SELECT p.canvas_id FROM cards p WHERE p.id = cards.parent_id)
    WHERE parent_id IS NOT NULL AND canvas_id IS NOT (SELECT p.canvas_id FROM cards p WHERE p.id = cards.parent_id)
      AND (SELECT p.canvas_id FROM cards p WHERE p.id = cards.parent_id) IS NOT NULL;`,
  
  `UPDATE events SET author = 'seismic' WHERE author = 'obeya';
   UPDATE activity SET who = 'seismic' WHERE who = 'obeya';`,
  'ALTER TABLE talk ADD COLUMN agent_setting TEXT;',
  
  `CREATE TABLE IF NOT EXISTS device_renewals (
    device_id TEXT PRIMARY KEY NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    nonce TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE
  );`,
  
  `CREATE TABLE IF NOT EXISTS device_tokens (
    token_hash TEXT PRIMARY KEY NOT NULL,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    retired INTEGER DEFAULT false NOT NULL,
    source_hash TEXT,
    nonce TEXT
  );`,
  `CREATE INDEX IF NOT EXISTS device_tokens_by_device ON device_tokens (device_id, seq);
   CREATE INDEX IF NOT EXISTS device_tokens_active ON device_tokens (device_id, seq) WHERE retired = 0;`,
  `ALTER TABLE device_tokens ADD COLUMN presented INTEGER;
   ALTER TABLE devices ADD COLUMN enrollment_order INTEGER NOT NULL DEFAULT 0;
   UPDATE devices SET enrollment_order = rowid;`,
];






const FOREIGN_KEYS_OFF = 'PRAGMA foreign_keys=OFF;';

/** A database this Seismic cannot open as it is: it leaves it alone. */
export class UnusableDatabase extends Error {}

/** The database was written by a newer Seismic (the checkout and the app share one home). */
export class NewerDatabase extends UnusableDatabase {
  constructor(path: string, version: number, known: number) {
    super(`${path} is from a newer Seismic (schema ${version}; this one knows ${known}): update Seismic or start the newer one`);
  }
}

/** The database was written by an Seismic before the release and not brought up to it. */
export class OlderDatabase extends UnusableDatabase {
  constructor(path: string, version: number) {
    super(
      `${path} is from an Seismic before its release (schema ${version}): start the Seismic of commit 1cfa1dd once to bring it up to date, or move it away to start afresh`,
    );
  }
}


export const BACKUPS_KEPT = 3;

/** A consistent copy of the database as it is before migrating to `target`, with only the newest backups kept. */
function backUpBefore(db: Database, path: string, target: number) {
  const copy = `${path}.before-${target}`;
  
  if (!existsSync(copy)) db.run('VACUUM INTO ?', [copy]);
  const prefix = `${basename(path)}.before-`;
  const old = readdirSync(dirname(path))
    .filter((f) => f.startsWith(prefix) && /^\d+$/.test(f.slice(prefix.length)))
    .sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)))
    .slice(BACKUPS_KEPT);
  for (const f of old) rmSync(join(dirname(path), f), { force: true });
}

/** Opens the database at `path` (`:memory:` for one of its own), brought up to the latest schema, with the Drizzle connection over it. */
export function openDatabase(path: string): { client: Database; orm: Db } {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const client = new Database(path, { strict: true });
  client.run('PRAGMA journal_mode = WAL');
  client.run('PRAGMA foreign_keys = ON');
  const { user_version } = client.query('PRAGMA user_version').get() as { user_version: number };
  const latest = RELEASED + MIGRATIONS.length;
  if (user_version > latest || (user_version > 0 && user_version < RELEASED)) {
    client.close();
    throw user_version > latest ? new NewerDatabase(path, user_version, latest) : new OlderDatabase(path, user_version);
  }
  if (user_version === 0)
    client.transaction(() => {
      client.run(SCHEMA);
      client.run(`PRAGMA user_version = ${RELEASED}`);
    })();
  if (user_version >= RELEASED && user_version < latest && path !== ':memory:') backUpBefore(client, path, latest);
  for (let v = Math.max(user_version, RELEASED); v < latest; v++) {
    const step = MIGRATIONS[v - RELEASED]!;
    
    const unchecked = step.startsWith(FOREIGN_KEYS_OFF);
    if (unchecked) client.run('PRAGMA foreign_keys = OFF');
    
    const dangling = () =>
      unchecked
        ? (client.query('PRAGMA foreign_key_check').all() as { table: string; rowid: number | null; parent: string; fkid: number }[]).map((r) => {
            const from = (client.query(`PRAGMA foreign_key_list("${r.table}")`).all() as { id: number; from: string }[]).filter((k) => k.id === r.fkid).map((k) => `"${k.from}"`);
            const value = r.rowid === null ? null : client.query(`SELECT ${from.join(', ')} FROM "${r.table}" WHERE rowid = ?`).get(r.rowid);
            return JSON.stringify([r.table, r.rowid, r.parent, value]);
          })
        : [];
    try {
      client.transaction(() => {
        const before = new Set(dangling());
        client.run(step);
        if (dangling().some((r) => !before.has(r))) throw new Error(`migration ${v + 1} leaves references to rows that are gone`);
        client.run(`PRAGMA user_version = ${v + 1}`);
      })();
    } finally {
      if (unchecked) client.run('PRAGMA foreign_keys = ON');
    }
  }
  return { client, orm: drizzle({ client, schema }) };
}

