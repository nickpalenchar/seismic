















































































































































































import { Database } from 'bun:sqlite';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { demoSettingsHere } from '../plugin/skills/demo/lib/settings.ts';
import { type Language, LANGUAGES } from '../src/core/locale';
import type { ProjectSnapshot, ConfigChecked, Item } from '../src/core/types';
import { loginLink, ownerHeaders } from '../src/server/owner';
import { findTailscale, type ServeEntry, Tailscale } from '../src/server/tailscale';
import { mayRecordInto } from '../src/server/replay';
import { branchName } from '../src/server/workstations';
import { opt } from './common';
import { waitUp } from './wait-up';

interface StageReviewItem {
  number: number;
  title: string;
  text: string;
  severity?: string;
  file?: string;
  line?: number;
  security?: boolean;
  with?: number[];
  status: string;
  card?: string;
  context?: string;
  log?: { who: string; from?: string; to: string; note?: string; ago?: string }[];
}
type StageEvent = NonNullable<StageCard['events']>[number];

interface StageCard {
  key?: string;
  title?: string;
  body?: string;
  x?: number;
  y?: number;
  idea?: boolean;
  repo?: string;
  from?: string;
  plan?: string;
  workstream?: string;
  
  project?: string;
  state?: string;
  need?: string | null;
  statusLine?: string;
  summary?: string;
  
  blocked?: string[];
  question?: { text: string; options?: string[]; multiple?: boolean };
  
  permission?: { name: string; input: Record<string, unknown>; extra?: { extension: number; label: Record<Language, string>; data?: unknown }[] };
  demo?: Record<string, unknown>;
  queue?: { behind?: string[]; reason?: string; since?: string; checking?: true };
  
  snoozed?: { on: string; state?: string; why?: string };
  
  limitPaused?: { until?: string };
  
  hold?: { reason: string; since?: string } & Record<string, unknown>;
  scope?: string[];
  
  duplicates?: string[];
  changes?: { kind: 'added' | 'modified' | 'deleted' | 'moved'; path: string; from?: string }[];
  branch?: string;
  
  branchFiles?: Record<string, string | { from: string }>;
  workstation?: boolean;
  
  workspace?: boolean;
  
  prototypeOf?: string;
  reviewItems?: StageReviewItem[];
  createdAgo?: string;
  archivedAgo?: string;
  events?: { kind: string; author: string; text: string; ago?: string; mocks?: { title: string; html: string }[]; spot?: { at: number; chapter?: string; demo?: number }; token?: boolean }[];
  row?: Record<string, unknown>;
}

interface Stage {
  
  setup?: boolean;
  
  setupProposals?: boolean;
  
  name?: string;
  
  language?: Language;
  
  conversation?: Language;
  
  repoName?: string;
  
  repos?: { name: string; files?: Record<string, string> }[];
  
  projects?: string[];
  
  port?: number;
  dir?: string;
  
  mainBranch?: string;
  
  clones?: number;
  
  poolCheckout?: boolean;
  
  settings?: Record<string, unknown>;
  
  slots?: number;
  
  hosts?: { name: string; ssh: string; root?: string; clones: number; slots?: number; gone?: boolean }[];
  files?: Record<string, string>;
  
  trusted?: boolean;
  plans?: Record<string, string>;
  
  git?: false;
  
  copy?: string;
  








  pulls?: { number: number; title: string; author: string; files: Record<string, string>; canModify?: boolean; checks?: { name: string; state: 'pending' | 'success' | 'failure' }[]; body?: string }[];
  forgeRepo?: string;
  



  forgeClone?: boolean;
  forgeViewer?: string;
  prPoll?: number;
  cards: StageCard[];
  preferences?: { key?: string; text: string; state?: string; card?: string; quote?: string; review?: boolean; replaces?: string; target?: string }[];
  groups?: { name: string; cards: string[] }[];
  
  canvases?: { name: string; icon?: string; cards?: string[] }[];
  friction?: { card: string; what: string; cost: string; fix: string; ago?: string; repo?: string }[];
  feedback?: { card: string; rating?: number; comment?: string; configs?: { harness: string | null; model: string | null; effort: string | null }[]; ago?: string; title?: string; plan?: string }[];
  settingProposals?: { field: string; value: string | string[]; basis: string; cards: string[]; repo?: string }[];
  talk?: {
    said: string;
    reply: string;
    ago?: string;
    card?: string;
    question?: string;
    answer?: string;
    answerBy?: string;
    chat?: number;
    project?: string;
    follows?: number;
    files?: { name: string; caption: string; content?: string; from?: string }[];
    unread?: boolean;
    wish?: { said: string; answer?: string };
    askedIn?: string;
  }[];
}

const ROOT = resolve(import.meta.dir, '..');
const args = process.argv.slice(2);
const fail = (msg: string): never => {
  console.error(`scratch-seismic: ${msg}`);
  process.exit(1);
};
const scratchDir = (port: number) => `/tmp/seismic-scratch-${port}`;

const SAYS = {
  say: (text: string) => ({ say: text }),
  report: (status: string) => ({ tool: 'report', args: { status } }),
  talk: (text: string) => ({ tool: 'reply', args: { text } }),
  question: (question: string) => ({ tool: 'ask', args: { question } }),
  review: (summary: string) => ({ tool: 'ready_for_review', args: { summary, data_models: 'unchanged', data_models_reason: 'A staged handover.' } }),
  to_seismic: (request: string) => ({ tool: 'to_seismic', args: { request } }),
  tool: (json: string) => ({ args: {}, ...(JSON.parse(json) as { tool: string; args?: Record<string, unknown> }) }) as { tool: string; args: Record<string, unknown> },
  step: (json: string) => ({ step: JSON.parse(json) as { type: 'tool'; name: string } }),
  end: () => ({ end: true as const }),
};

if (args.includes('--list')) {
  for (const d of runningDirs()) console.log(JSON.stringify(pathsOf(d)));
  process.exit(0);
}
const stopPort = opt('stop');
if (stopPort) {
  const d = dirOf(Number(stopPort));
  if (!stop(d)) fail(`the server of ${d} (process ${pidIn(d)}) still runs after the stop`);
  rmSync(pointerOf(Number(stopPort)), { force: true });
  process.exit(0);
}
const loginPort = opt('login');
if (loginPort) {
  const d = dirOf(Number(loginPort));
  const project = existsSync(join(d, 'staged.json')) ? (JSON.parse(readFileSync(join(d, 'staged.json'), 'utf8')) as { project?: string }).project : undefined;
  const link = await loginLink(`http://127.0.0.1:${loginPort}`, join(d, 'home'), project ? `/p/${project}` : '/');
  if (!link) fail(`no scratch Seismic of ${d} answers on port ${loginPort}`);
  console.log(link);
  process.exit(0);
}

const sayPort = opt('say');
if (sayPort) {
  const [key, kind, ...words] = args.slice(args.indexOf('--say') + 2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--dir');
  const text = words.join(' ');
  const act = SAYS[kind as keyof typeof SAYS];
  if (!key || !act || (!text.trim() && kind !== 'end')) fail(`usage: bun scripts/scratch-seismic.ts --say <port> <card key> <${Object.keys(SAYS).join('|')}> <text>`);
  console.log(await standIn(Number(sayPort), key!, act!(text)));
  process.exit(0);
}
const artifactPort = opt('artifact');
if (artifactPort) {
  const [key, from, ...words] = args.slice(args.indexOf('--artifact') + 2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--dir');
  if (!key || !from || !existsSync(from)) fail('usage: bun scripts/scratch-seismic.ts --artifact <port> <card key> <file> [<summary>]');
  const d = dirOf(Number(artifactPort));
  const to = artifactDir(d, key!);
  mkdirSync(to, { recursive: true });
  copyFileSync(from!, join(to, basename(from!)));
  
  const { page } = (await stagedCard(Number(artifactPort), key!)).demo?.latest ?? {};
  const summary = words.join(' ').trim() || 'Updated the artifact.';
  console.log(await standIn(Number(artifactPort), key!, { tool: 'ready_for_review', args: { summary, data_models: 'unchanged', data_models_reason: 'A staged handover.', demo: { kind: 'html', dir: to, ...(page ? { page } : {}) } } }));
  process.exit(0);
}

const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.match(/^--(port|code|dir|binary|record|replay)$/));
if (!file) fail('usage: bun scripts/scratch-seismic.ts <stage.json> [--port <n>] [--code <commit> | --binary <seismic>] [--real-workers | --record <dir> | --replay <dir>] [--restarts] | --stop <port> | --login <port> | --say <port> … | --artifact <port> …');
const stage = JSON.parse(readFileSync(file!, 'utf8')) as Stage;

const from = { stage: realpathSync(file!), ...(opt('code') || opt('binary') ? { code: opt('code') ?? opt('binary') } : {}) };
const given = opt('port') ?? stage.port;
const port = given !== undefined ? Number(given) : await pickPort(opt('dir') ?? stage.dir);
const dir = resolve(opt('dir') ?? stage.dir ?? scratchDir(port));
const base = `http://127.0.0.1:${port}`;

stop(dir);

if (dir !== scratchDir(port)) writeFileSync(pointerOf(port), dir);
else rmSync(pointerOf(port), { force: true });

if (await fetch(base, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false)) fail(`port ${port} is taken by another process (lsof -i :${port})`);
rmSync(dir, { recursive: true, force: true });
const home = join(dir, 'home');
/** Where a host keeps the repository's clones. */
const rootOn = (h: { root?: string }) => h.root ?? `${dir}/far`;
const repo = join(dir, stage.repoName ?? 'repo');
const mainBranch = stage.mainBranch ?? 'main';
mkdirSync(home, { recursive: true });
for (const k of ['language', 'conversation'] as const) if (stage[k] && !LANGUAGES.includes(stage[k])) fail(`"${k}" is ${LANGUAGES.join(' or ')}, not ${stage[k]}`);

writeFileSync(join(home, 'settings.json'), `${JSON.stringify({ language: stage.language ?? demoSettingsHere().language, ...(stage.conversation ? { conversationLanguage: stage.conversation } : {}) })}\n`);

const owner = ownerHeaders(home);


const files = { ...(stage.files ?? {}), ...(stage.plans ?? {}) };
mkdirSync(repo, { recursive: true });
if (stage.copy) cpSync(resolve(stage.copy), repo, { recursive: true, preserveTimestamps: true });
if (!Object.keys(files).length && !stage.copy) files['README.md'] = '# Scratch\n';
for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}
const folder = stage.git === false;
if (!folder) initRepo(repo);

if (stage.poolCheckout || stage.hosts?.length) {
  run('git', ['clone', '-q', '--bare', repo, join(dir, 'scratch.git')], dir);
  run('git', ['remote', 'add', 'origin', join(dir, 'scratch.git')], repo);
  run('git', ['fetch', '-q', 'origin'], repo);
  run('git', ['branch', '-q', '-u', `origin/${mainBranch}`], repo);
}

const forgeRepo = join(dir, 'forge');
const prHeads = new Map<number, string>();
if (stage.pulls?.length) {
  const slug = stage.forgeRepo ?? `acme/${basename(repo)}`;
  const prs = stage.pulls.map((p) => {
    run('git', ['checkout', '-q', '-b', `pr-${p.number}`], repo);
    for (const [path, text] of Object.entries(p.files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), text);
    }
    run('git', ['add', '-A'], repo);
    run('git', ['-c', `user.name=${p.author}`, '-c', `user.email=${p.author}@users.noreply`, 'commit', '-qm', p.title], repo);
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    run('git', ['update-ref', `refs/pull/${p.number}/head`, head], repo);
    run('git', ['checkout', '-q', mainBranch], repo);
    run('git', ['branch', '-q', '-D', `pr-${p.number}`], repo);
    prHeads.set(p.number, head);
    return { url: `https://github.com/${slug}/pull/${p.number}`, number: p.number, title: p.title, author: p.author, head, canModify: p.canModify ?? true, headRepo: `https://github.com/${p.author}/${basename(slug)}.git`, headRef: `pr-${p.number}`, checks: p.checks ?? [], comments: [], ...(p.body ? { body: p.body } : {}) };
  });
  
  if (stage.forgeClone) {
    run('git', ['clone', '-q', repo, forgeRepo], dir);
    
    run('git', ['config', 'receive.denyCurrentBranch', 'updateInstead'], forgeRepo);
    
    writeFileSync(join(forgeRepo, '.git', 'hooks', 'post-receive'), '#!/bin/sh\nwhile read old new ref; do case "$ref" in refs/heads/pr-*) git update-ref "refs/pull/${ref#refs/heads/pr-}/head" "$new";; esac; done\n', { mode: 0o755 });
    run('git', ['fetch', '-q', repo, '+refs/pull/*:refs/pull/*'], forgeRepo);
  }
  writeFileSync(join(dir, 'forge.json'), `${JSON.stringify({ repo: stage.forgeClone ? forgeRepo : repo, viewer: stage.forgeViewer ?? 'owner', prs }, null, 2)}\n`);
  
  if (!stage.poolCheckout && !stage.hosts?.length) run('git', ['remote', 'add', 'origin', `git@github.com:${slug}.git`], repo);
}

const others = (stage.repos ?? []).map((r) => {
  const path = join(dir, r.name);
  mkdirSync(path, { recursive: true });
  const files = r.files && Object.keys(r.files).length ? r.files : { 'README.md': `# ${r.name}\n` };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(path, file)), { recursive: true });
    writeFileSync(join(path, file), text);
  }
  initRepo(path);
  return { path, ...(stage.clones ? { clones: stage.clones } : {}) };
});

const further = (stage.projects ?? []).map((name, i) => {
  const path = join(dir, `repo-${i + 2}`);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'README.md'), `# ${name}\n`);
  initRepo(path);
  return { name, repos: [{ path }] };
});

for (const h of stage.hosts ?? []) {
  if (h.gone) continue;
  const ssh = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', h.ssh];
  
  const tar = spawnSync('tar', ['-C', dir, '-cf', '-', 'scratch.git'], { maxBuffer: 1 << 30 });
  const r = spawnSync('ssh', [...ssh, `rm -rf '${dir}' && mkdir -p '${dir}' && tar --no-same-owner -xf - -C '${dir}'`], { input: tar.stdout, encoding: 'utf8' });
  if (tar.status !== 0 || r.status !== 0) fail(`copying the origin to ${h.name}: ${r.stderr || tar.stderr}`);
}


let code = ROOT;
const commit = opt('code');
if (commit) {
  code = join(dir, 'code');
  mkdirSync(code);
  const archive = spawnSync('git', ['-C', ROOT, 'archive', commit], { maxBuffer: 1 << 30 });
  if (archive.status !== 0) fail(`git archive ${commit}: ${archive.stderr}`);
  const tar = spawnSync('tar', ['-x', '-C', code], { input: archive.stdout });
  if (tar.status !== 0) fail(`tar: ${tar.stderr}`);
  symlinkSync(join(ROOT, 'node_modules'), join(code, 'node_modules'));
}
const binary = opt('binary') && resolve(opt('binary')!);
if (binary && !existsSync(binary)) fail(`${binary} does not exist`);
const record = opt('record') && resolve(opt('record')!);
const replay = opt('replay') && resolve(opt('replay')!);
if (record && replay) fail('--record or --replay, not both');
if (record && !mayRecordInto(record)) fail(`${record} holds something other than a recording; record into an empty or new directory`);
if (replay && !existsSync(join(replay, 'meta.json'))) fail(`${replay} holds no recording (record one with --record)`);
if ((record || replay) && (binary || !readFileSync(join(code, 'src/server/main.ts'), 'utf8').includes('replayRuntime'))) fail(`${binary ?? commit} cannot record or play back its agents`);

if (record) rmSync(record, { recursive: true, force: true });

const takeCuts = replay && join(dirname(replay), '.work', 'cuts.json');
if (replay && takeCuts && !existsSync(join(replay, 'cuts.json')) && existsSync(takeCuts) && statSync(takeCuts).mtimeMs >= statSync(join(replay, 'meta.json')).mtimeMs)
  copyFileSync(takeCuts, join(replay, 'cuts.json'));
const idle = !args.includes('--real-workers') && !record && !replay;
const canIdle = !!binary || readFileSync(join(code, 'src/server/main.ts'), 'utf8').includes("'idle-workers'");
if (idle && !canIdle) console.error(`scratch-seismic: ${commit} has no --idle-workers; a started card gets a real agent`);



const log = join(dir, 'server.log');
const out = openSync(log, 'a');

const supervised = args.includes('--restarts');
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'OBEYA_SUPERVISED' && k !== 'SEISMIC_SUPERVISED')),
  SEISMIC_HOME: home,
  OBEYA_HOME: home,
  ...(stage.pulls?.length
    ? {
        SEISMIC_FORGE_FILE: join(dir, 'forge.json'),
        OBEYA_FORGE_FILE: join(dir, 'forge.json'),
        SEISMIC_PR_POLL: String(stage.prPoll ?? 10),
        OBEYA_PR_POLL: String(stage.prPoll ?? 10),
        ...gitConfig(
          
          [`git@github.com:${stage.forgeRepo ?? `acme/${basename(repo)}`}.git`, ...(stage.forgeClone ? stage.pulls.map((p) => `https://github.com/${p.author}/${basename(stage.forgeRepo ?? `acme/${basename(repo)}`)}.git`) : [])].map(
            (url) => [`url.${stage.forgeClone ? forgeRepo : repo}.insteadOf`, url] as const,
          ),
        ),
      }
    : {}),
};

const configFile = join(dir, 'projects.json');
const configured = folder || !!stage.poolCheckout || !!stage.settings || stage.slots !== undefined || !!stage.hosts?.length || !!stage.name || further.length > 0 || others.length > 0;
if (configured)
  writeFileSync(
    configFile,
    JSON.stringify(
      [
        {
          ...(stage.name ? { name: stage.name } : {}),
          repos: [
            {
              path: repo,
              ...(folder ? { git: false } : {}),
              ...(stage.clones ? { clones: stage.clones } : {}),
              ...(stage.poolCheckout ? { workstations: [repo] } : {}),
              ...(stage.settings ? { settings: stage.settings } : {}),
              ...(stage.slots !== undefined ? { slots: stage.slots } : {}),
              ...(stage.hosts?.length ? { hosts: stage.hosts.map(({ gone: _, ...h }) => ({ ...h, root: rootOn(h) })) } : {}),
            },
            ...others,
          ],
        },
        ...further,
      ],
      null,
      2,
    ),
  );
const projectArgs = stage.setup ? [] : configured ? ['--config', configFile] : [repo, ...(stage.clones ? ['--clones', String(stage.clones)] : [])];
const serverArgs = [
  ...projectArgs,
  '--port',
  String(port),
  ...(supervised ? [] : ['--dev']),
  ...(idle && canIdle ? ['--idle-workers'] : []),
  ...(record ? ['--record', record] : []),
  ...(replay ? ['--replay', replay] : []),
];
const server = spawn(binary ?? process.execPath, binary ? serverArgs : ['src/server/main.ts', ...serverArgs], {
  cwd: binary ? dir : code,
  env,
  detached: true,
  stdio: ['ignore', out, out],
});
server.unref();
writeFileSync(join(dir, 'server.pid'), String(server.pid));
let exited: number | null = null;
server.on('exit', (c) => (exited = c ?? -1));
const started = await waitUp(`${base}/api/projects`, {
  headers: owner,
  exited: () => exited,
  limit: 5 * 60_000,
  slowAfter: 15_000,
  onSlow: () => console.error(`scratch-seismic: the server takes long to start${commit ? ' (code from git archive starts cold)' : ''}; waiting up to 5 min`),
});
if (!started.up) {
  if (started.exit === null) stop(dir);
  const after = `after ${Math.round(started.waited / 1000)} s`;
  fail(`the server did not come up ${started.exit !== null ? `(exit ${started.exit}) ${after}` : `${after}, so it was stopped`}; ${log}:\n${readFileSync(log, 'utf8').slice(-2000)}`);
}
if (stage.setup) {
  const staged = { url: (await loginLink(base, home)) ?? `${base}/`, port, ...pathsAt(dir, repo, log), pid: server.pid, from, cards: {} };
  writeFileSync(join(dir, 'staged.json'), JSON.stringify(staged, null, 2));
  console.log(JSON.stringify(staged));
  process.exit(0);
}
const allProjects = (await (await fetch(`${base}/api/projects`, { headers: owner })).json()) as { id: string; name: string }[];
const project = allProjects[0]!.id;
const api = async (method: string, path: string, body?: unknown, on = project) => {
  const r = await fetch(`${base}/api/c/${on}${path}`, {
    method,
    headers: { ...owner, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  if (!r.ok) fail(`${method} ${path} ${JSON.stringify(body)}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
};
/** A card's changes, through the RESTful API: the server finds the card's project itself. */
const patchCard = async (id: string, patch: Record<string, unknown>) => {
  const r = await fetch(`${base}/api/v1/cards/${id}`, { method: 'PATCH', headers: { ...owner, 'content-type': 'application/json' }, body: JSON.stringify(patch) });
  if (!r.ok) fail(`PATCH /api/v1/cards/${id} ${JSON.stringify(patch)}: ${r.status} ${await r.text()}`);
};


if (stage.trusted) {
  const checked = (await (await fetch(`${base}/api/config/check`, { headers: owner })).json()) as ConfigChecked;
  for (const [i, c] of checked.projects.entries())
    for (const [j, r] of c.repos.entries()) {
      const trust = checked.resolved[i]?.repos[j]?.trust;
      if (!trust) continue;
      const t = await fetch(`${base}/api/config/trust`, { method: 'POST', headers: { ...owner, 'content-type': 'application/json' }, body: JSON.stringify({ path: r.path, seen: trust.now, held: trust.held }) });
      if (!t.ok) fail(`trusting ${r.path}: ${t.status} ${await t.text()}`);
    }
}


if (!stage.setupProposals)
  for (const c of allProjects)
    for (const i of ((await api('GET', '/project', undefined, c.id)) as ProjectSnapshot).items)
      if (i.state === 'proposal' && i.idea?.proposal?.setup) await api('POST', `/cards/${i.id}/act`, { action: 'dismiss' }, c.id);


const snapshot = (await api('GET', '/project')) as ProjectSnapshot;
const ids: Record<string, string> = {};
const below = Math.max(0, ...snapshot.items.map((x) => x.y)) + 400;
let placed = 0;
const idOf = (c: StageCard, i: number) => ids[c.key ?? String(i)]!;
for (const [i, c] of stage.cards.entries()) {
  let id: string | undefined;
  if (c.plan) id = snapshot.items.find((x) => x.kind === 'plan' && x.plan?.file === c.plan)?.id;
  else if (c.workstream) {
    const [doc, label] = c.workstream.includes('#') ? c.workstream.split('#') : [undefined, c.workstream];
    const plans = new Set(snapshot.items.filter((x) => x.kind === 'plan' && (!doc || x.plan?.file === doc)).map((x) => x.id));
    
    id = snapshot.items.find((x) => (x.plan?.label ?? x.title.split(' ')[0]) === label && x.parent && plans.has(x.parent))?.id;
  } else {
    if (c.from && !ids[c.from]) fail(`card ${c.key ?? i}: "from" names ${c.from}, which comes later or does not exist`);
    
    const at = c.from || (c.x !== undefined && c.y !== undefined) ? {} : { x: 40 + 360 * (placed % 4), y: below + 220 * Math.floor(placed++ / 4) };
    const on = c.project ? (allProjects.find((x) => x.name === c.project)?.id ?? fail(`card ${c.key ?? i}: no project named ${c.project}`)) : project;
    const created = await api('POST', '/cards', {
      
      kind: 'feature',
      title: c.title ?? '',
      ...(c.body !== undefined ? { body: c.body } : {}),
      ...at,
      ...(c.x !== undefined ? { x: c.x } : {}),
      ...(c.y !== undefined ? { y: c.y } : {}),
      ...(c.idea ? { idea: true } : {}),
      ...(c.repo ? { repo: c.repo } : {}),
      ...(c.from ? { from: ids[c.from] } : {}),
    }, on);
    id = created.id;
  }
  if (!id) fail(`card ${c.key ?? i}: no ${c.plan ? `plan for ${c.plan}` : `workstream ${c.workstream}`} on the project`);
  ids[c.key ?? String(i)] = id!;
}

const db = new Database(join(home, 'seismic.db'), { strict: true });
db.run('PRAGMA busy_timeout = 10000');

const WS = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'workstations'").get() ? 'workstations' : 'workspaces';
for (const h of stage.hosts ?? [])
  for (let n = 1; h.gone && n <= h.clones; n++)
    db.query(`INSERT INTO ${WS} (path, project_id, repo) VALUES ($path, $c, NULL) ON CONFLICT(path) DO NOTHING`).run({ path: `ssh://${h.name}${rootOn(h)}/${n}`, c: project });
const columns = new Set((db.query('PRAGMA table_info(cards)').all() as { name: string }[]).map((c) => c.name));

const IDEA_COLUMNS: Record<string, string> = { idea: 'discussion', prototype_of: 'prototype_of', prototype: 'prototype', proposal: 'proposal', built_on: 'built_on', becomes_plan: 'becomes_plan', new_repo: 'new_repo' };
const ideaColumns = !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'card_ideas'").get();





const partTables = !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'card_holds'").get();

const PART_COLUMNS: Record<string, Record<string, string>> = {
  card_reviews: { pr: 'pr', contribution: 'contribution', code_review: 'code_review' },
  card_demos: { demo: 'latest', share: 'share', page_heard: 'page_heard', files: 'files', held: 'held' },
  card_plans: { plan: 'doc', deps: 'deps', collapsed: 'collapsed', plan_docs: 'plan_docs' },
};
const LABELS = ['category', 'subcategory', 'complexity', 'priority'];
/** Whether this code keeps a card's field, by its column in `cards` before the parts had tables, in a part's table. */
const inPart = (k: string) =>
  (ideaColumns && k in IDEA_COLUMNS) ||
  (partTables && (k === 'demos' || k === 'hold' || [...LABELS, 'suggested_labels', 'owner_labels'].includes(k) || Object.values(PART_COLUMNS).some((m) => k in m)));
/** Writes a card's fields, by their columns in `cards` before the parts had tables: into `cards`, or where this code keeps them, into its parts' tables. */
function write(id: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  const value = (k: string) => (typeof fields[k] === 'object' && fields[k] !== null ? JSON.stringify(fields[k]) : (fields[k] as string | number | null));
  const own = keys.filter((k) => !inPart(k));
  if (own.length)
    db.query(`UPDATE cards SET ${own.map((k) => `${k} = $${k}`).join(', ')} WHERE id = $id`).run({ id, ...Object.fromEntries(own.map((k) => [k, value(k)])) } as Record<string, string | number | null>);
  
  const idea = ideaColumns ? keys.filter((k) => k in IDEA_COLUMNS) : [];
  if (idea.length) {
    const cols = idea.map((k) => IDEA_COLUMNS[k]!);
    db.query(`INSERT INTO card_ideas (card_id, ${cols.join(', ')}) VALUES ($id, ${idea.map((k) => `$${k}`).join(', ')}) ON CONFLICT (card_id) DO UPDATE SET ${cols.map((c, n) => `${c} = $${idea[n]}`).join(', ')}`).run({
      id,
      ...Object.fromEntries(idea.map((k) => [k, k === 'becomes_plan' ? Number(!!fields[k]) : value(k)])),
    } as Record<string, string | number | null>);
  }
  if (!partTables) return;
  for (const [table, moved] of Object.entries(PART_COLUMNS)) {
    const from = keys.filter((k) => k in moved);
    if (!from.length) continue;
    const to = from.map((k) => moved[k]!);
    db.query(`INSERT INTO ${table} (card_id, ${to.join(', ')}) VALUES ($id, ${from.map((k) => `$${k}`).join(', ')}) ON CONFLICT (card_id) DO UPDATE SET ${to.map((c) => `${c} = excluded.${c}`).join(', ')}`).run({
      id,
      ...Object.fromEntries(from.map((k) => [k, k === 'collapsed' ? Number(!!fields[k]) : value(k)])),
    } as Record<string, string | number | null>);
  }
  if (keys.includes('demos')) {
    const earlier = (fields.demos ?? []) as unknown[];
    db.query('DELETE FROM card_earlier_demos WHERE card_id = $id').run({ id });
    for (const [n, d] of earlier.entries()) db.query('INSERT INTO card_earlier_demos (card_id, position, demo) VALUES ($id, $n, $d)').run({ id, n, d: JSON.stringify(d) });
    
    if (earlier.length) db.query('INSERT INTO card_demos (card_id) VALUES ($id) ON CONFLICT (card_id) DO NOTHING').run({ id });
  }
  if (keys.some((k) => [...LABELS, 'suggested_labels', 'owner_labels'].includes(k))) {
    
    const had = db.query('SELECT label, value, by FROM card_labels WHERE card_id = $id').all({ id }) as { label: string; value: string | null; by: string | null }[];
    const now = (l: string) => (l in fields ? fields[l] : had.find((r) => r.label === l)?.value) ?? null;
    const by = (who: string) => had.filter((r) => r.by === who).map((r) => r.label);
    
    const owner = ('owner_labels' in fields ? (fields.owner_labels ?? []) : by('owner')) as string[];
    const suggested = ('suggested_labels' in fields ? (fields.suggested_labels ?? []) : by('suggestion')) as string[];
    db.query('DELETE FROM card_labels WHERE card_id = $id').run({ id });
    for (const l of LABELS) {
      const v = now(l) as string | number | null;
      if (v === null && !owner.includes(l)) continue;
      const who = owner.includes(l) ? 'owner' : v !== null && suggested.includes(l) ? 'suggestion' : null;
      db.query('INSERT INTO card_labels (card_id, label, value, by) VALUES ($id, $l, $v, $by)').run({ id, l, v: v === null ? null : String(v), by: who });
    }
  }
  if (keys.includes('hold')) {
    db.query('DELETE FROM card_holds WHERE card_id = $id').run({ id });
    const hold = fields.hold as { reason: string; since?: string } | null;
    if (hold) {
      const { reason, since, ...detail } = hold;
      db.query('INSERT INTO card_holds (card_id, reason, since, detail) VALUES ($id, $reason, $since, $detail)').run({
        id,
        reason,
        since: since ?? new Date().toISOString(),
        detail: Object.keys(detail).length ? JSON.stringify(detail) : null,
      });
    }
  }
}
for (const [i, c] of stage.cards.entries()) {
  const id = idOf(c, i);
  const row: Record<string, unknown> = {};
  if ((c.plan || c.workstream) && (c.x !== undefined || c.y !== undefined)) Object.assign(row, { x: c.x, y: c.y });
  if (c.state !== undefined) row.state = c.state;
  if (c.need !== undefined) row.need = c.need;
  if (c.statusLine !== undefined) row.status_line = c.statusLine;
  if (c.summary !== undefined) row.detail = { summary: c.summary, ...(c.blocked ? { blocked: { files: c.blocked } } : {}) };
  if (c.question !== undefined) row.detail = { question: { options: [], ...c.question }, ...(c.permission ? { permission: c.permission } : {}) };
  
  const demo = c.demo && (c.demo.kind === 'html' ? { ...c.demo, dir: copyArtifact(String(c.demo.dir), artifactDir(dir, c.key ?? String(i))) } : c.demo);
  if (demo !== undefined) row.demo = { kind: 'video', ...demo };
  if (c.queue !== undefined)
    row.queue = {
      ...c.queue,
      ...(c.queue.behind ? { behind: c.queue.behind.map((k) => ids[k] ?? fail(`card ${c.key ?? i}: queue names ${k}, which does not exist`)) } : {}),
      since: c.queue.since ?? new Date().toISOString(),
    };
  if (c.snoozed !== undefined) {
    const on = ids[c.snoozed.on] ?? fail(`card ${c.key ?? i}: snoozed names ${c.snoozed.on}, which does not exist`);
    const title = stage.cards.find((x) => x.key === c.snoozed!.on)?.title ?? '';
    row.hold = { reason: 'snoozed', since: new Date().toISOString(), on: { card: on, title, state: c.snoozed.state ?? 'done' }, by: 'agent', ...(c.snoozed.why ? { why: c.snoozed.why } : {}) };
  }
  if (c.limitPaused !== undefined) row.hold = { reason: 'limit', since: new Date().toISOString(), attempts: 3, ...c.limitPaused };
  if (c.hold !== undefined) row.hold = { since: new Date().toISOString(), ...c.hold };
  if (c.scope !== undefined) row.scope = { files: c.scope, reason: '' };
  if (c.duplicates !== undefined) {
    const own = snapshot.items.find((x) => x.id === id);
    const found = c.duplicates.map((k) => ids[k] ?? fail(`card ${c.key ?? i}: duplicates names ${k}, which does not exist`));
    
    row.scope = { files: c.scope ?? [], reason: '', duplicateCheck: { title: c.title ?? own?.title ?? '', body: c.body ?? own?.body ?? '', ids: found } };
  }
  
  
  const branch = c.branch ?? (c.state === 'working' || c.state === 'waiting' ? branchName(c.title ?? snapshot.items.find((x) => x.id === id)?.title ?? '', id) : undefined);
  if (branch !== undefined) row.branch = branch;
  const workstation = c.workstation ?? c.workspace;
  if (workstation && folder) {
    
    row.workstation = repo;
    row.branch = branch ?? `seismic/${id.slice(0, 6)}`;
    db.query('INSERT INTO folder_cards (card_id, folder, state) VALUES ($id, $f, $s) ON CONFLICT(card_id) DO NOTHING').run({
      id,
      f: realpathSync(repo),
      s: JSON.stringify({ held: true, undo: null, changes: c.changes ?? [] }),
    });
  } else if (workstation) {
    
    const other = c.repo && c.repo !== (stage.repoName ?? 'repo') ? c.repo : null;
    const checkout = other ? join(dir, other) : repo;
    const free = db.query(`SELECT path FROM ${WS} WHERE card_id IS NULL AND repo IS $r ORDER BY path`).get({ r: other }) as { path: string } | null;
    
    const tree = !free && !!branch && !stage.clones;
    if (!free && !tree) fail(`card ${c.key ?? i}: no free clone for it ("clones" in the stage, settings that say clones), nor a branch for a worktree`);
    const path = tree ? join(home, 'workspaces', project, id.slice(0, 8)) : free!.path;
    if (tree) {
      mkdirSync(dirname(path), { recursive: true });
      run('git', ['worktree', 'add', '-q', '-b', branch!, path, mainBranch], checkout);
      if (other) db.query(`INSERT INTO ${WS} (path, project_id, card_id, repo) VALUES ($path, $c, $id, $r)`).run({ path, c: project, id, r: other });
      else db.query(`INSERT INTO ${WS} (path, project_id, card_id) VALUES ($path, $c, $id)`).run({ path, c: project, id });
    } else {
      db.query(`UPDATE ${WS} SET card_id = $id WHERE path = $path`).run({ id, path });
      if (branch) run('git', ['checkout', '-q', '-b', branch], path);
    }
    row.workstation = path;
    if (c.branch) {
      
      if (!c.branchFiles || !Object.keys(c.branchFiles).length) writeFileSync(join(path, 'scratch.txt'), `${c.title ?? c.branch}\n`);
      for (const [file, what] of Object.entries(c.branchFiles ?? {})) {
        mkdirSync(dirname(join(path, file)), { recursive: true });
        if (typeof what === 'string') writeFileSync(join(path, file), what);
        else copyFileSync(what.from, join(path, file));
      }
      run('git', ['add', '-A'], path);
      run('git', ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.com', 'commit', '-qm', c.title ?? c.branch], path);
    }
  }
  if (c.prototypeOf !== undefined) row.prototype_of = ids[c.prototypeOf] ?? fail(`card ${c.key ?? i}: prototypeOf names ${c.prototypeOf}, which does not exist`);
  if (c.createdAgo !== undefined) row.created_at = ago(c.createdAgo);
  if (c.archivedAgo !== undefined) row.archived_at = ago(c.archivedAgo);
  Object.assign(row, c.row ?? {});
  
  const contribution = row.contribution as { number?: number; reviewed?: string } | undefined;
  const pull = contribution && !contribution.reviewed && prHeads.get(contribution.number ?? -1);
  if (pull) row.contribution = { ...contribution, reviewed: pull };
  if (WS === 'workspaces' && 'workstation' in row) {
    row.workspace = row.workstation;
    delete row.workstation;
  }
  const keys = Object.keys(row).filter((k) => row[k] !== undefined);
  const missing = keys.filter((k) => !columns.has(k) && !inPart(k));
  if (missing.length) fail(`card ${c.key ?? i}: this code's database has no column ${missing.join(', ')}`);
  write(id, row);
  if (c.reviewItems?.length) {
    if (!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'card_review_items'").get()) fail(`card ${c.key ?? i}: this code's database has no review items`);
    for (const it of c.reviewItems) {
      db.query('INSERT INTO card_review_items (card_id, number, title, text, severity, file, line, security, bundle, status, follow_up, context) VALUES ($c, $n, $title, $text, $sev, $file, $line, $sec, $bundle, $status, $card, $context)').run({
        c: id, n: it.number, title: it.title, text: it.text, sev: it.severity ?? 'minor', file: it.file ?? null, line: it.line ?? null, sec: it.security ? 1 : 0,
        bundle: it.with ? JSON.stringify(it.with) : null, status: it.status, card: it.card ? (ids[it.card] ?? it.card) : null, context: it.context ?? null,
      });
      (it.log ?? []).forEach((e, position) =>
        db.query('INSERT INTO card_review_item_events (card_id, number, position, at, who, "from", "to", note) VALUES ($c, $n, $p, $at, $who, $from, $to, $note)').run({
          c: id, n: it.number, p: position, at: ago(e.ago ?? '0s'), who: e.who, from: e.from ?? null, to: e.to, note: e.note ?? null,
        }),
      );
    }
  }
  const reviews: { id: number; at: string }[] = [];
  const spots: [number, NonNullable<StageEvent['spot']>][] = [];
  for (const e of c.events ?? []) {
    
    const at = ago(e.ago ?? '0s');
    const { lastInsertRowid } = db.query(`INSERT INTO events (card_id, at, kind, author, text${e.mocks ? ', mocks' : ''}${e.token ? ', token' : ''}) VALUES ($c, $at, $kind, $author, $text${e.mocks ? ', $mocks' : ''}${e.token ? ', 1' : ''})`).run({
      c: id,
      at,
      kind: e.kind,
      author: e.author,
      text: e.text,
      ...(e.mocks ? { mocks: JSON.stringify(e.mocks) } : {}),
    });
    if (e.kind === 'review') reviews.push({ id: Number(lastInsertRowid), at });
    if (e.spot) spots.push([Number(lastInsertRowid), e.spot]);
  }
  
  if (reviews.length && (demo || c.row?.demos)) {
    const earlier = (c.row?.demos ?? []) as Record<string, unknown>[];
    const handed = (d: Record<string, unknown>, i: number) => (reviews[i] ? { ...d, kind: d.kind ?? 'video', handover: reviews[i].id, at: reviews[i].at } : d);
    write(id, {
      demos: earlier.length ? earlier.map(handed) : null,
      demo: demo ? handed({ kind: 'video', ...demo }, earlier.length) : null,
    });
  }
  for (const [event, { demo, ...spot }] of spots)
    db.query('UPDATE events SET spot = $spot WHERE id = $id').run({ id: event, spot: JSON.stringify({ ...spot, ...(demo !== undefined && reviews[demo] ? { demo: reviews[demo].id } : {}) }) });
}
const prefIds: Record<string, number> = {};
for (const [i, p] of (stage.preferences ?? []).entries()) {
  const row: Record<string, string | number | null> = {
    project_id: project,
    text: p.text,
    created_at: new Date().toISOString(),
    card_id: p.card ? (ids[p.card] ?? fail(`preference ${p.key ?? i}: card ${p.card} does not exist`)) : null,
  };
  if (p.state !== undefined) row.state = p.state;
  if (p.quote !== undefined) row.quote = p.quote;
  if (p.review) row.review = 1;
  if (p.target !== undefined) row.target = p.target;
  if (p.replaces !== undefined) row.replaces = prefIds[p.replaces] ?? fail(`preference ${p.key ?? i}: replaces ${p.replaces}, which comes later or does not exist`);
  const keys = Object.keys(row);
  const r = db.query(`INSERT INTO preferences (${keys.join(', ')}) VALUES (${keys.map((k) => `$${k}`).join(', ')}) RETURNING id`).get(row) as { id: number };
  if (p.key) prefIds[p.key] = r.id;
}
const talkIds: number[] = [];
const threadOf = new Map<number, number>();

const chats = !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chats'").get();
const chatIds = new Map<string, number>();
for (const [i, x] of (stage.talk ?? []).entries()) {
  const row: Record<string, string | number | null> = {
    project_id: x.project ? (allProjects.find((c) => c.name === x.project)?.id ?? fail(`talk ${i}: no project named ${x.project}`)) : project,
    at: ago(x.ago ?? '0s'),
    said: x.said,
    reply: x.reply,
    card_id: x.card ? (ids[x.card] ?? fail(`talk ${i}: card ${x.card} does not exist`)) : null,
    question: x.question ?? null,
    answer: x.answer ?? null,
    answer_by: x.answerBy ?? null,
  };
  if (x.unread) row.unread = 1;
  if (x.wish) row.wish = JSON.stringify(x.wish);
  if (x.askedIn) row.asked_in = row.about = ids[x.askedIn] ?? fail(`talk ${i}: plan ${x.askedIn} does not exist`);
  if (x.follows !== undefined) {
    const followed = talkIds[x.follows] ?? fail(`talk ${i}: follows ${x.follows}, which comes later or does not exist`);
    row.follows = followed;
    row.thread = threadOf.get(followed) ?? followed;
  }
  if (x.files?.length) row.files = JSON.stringify(x.files.map((f) => ({ name: f.name, caption: f.caption })));
  if (chats) {
    const key = `${row.project_id}/${x.chat ?? 0}`;
    let chat = chatIds.get(key);
    if (chat === undefined) chatIds.set(key, (chat = (db.query('INSERT INTO chats (project_id, at, opened) VALUES ($c, $at, $at) RETURNING id').get({ c: row.project_id as string, at: row.at as string }) as { id: number }).id));
    
    db.query('UPDATE chats SET opened = $at WHERE id = $id AND opened < $at').run({ id: chat, at: row.at as string });
    row.chat = chat;
  }
  const keys = Object.keys(row);
  const { id } = db.query(`INSERT INTO talk (${keys.join(', ')}) VALUES (${keys.map((k) => `$${k}`).join(', ')}) RETURNING id`).get(row) as { id: number };
  talkIds.push(id);
  const thread = typeof row.thread === 'number' ? row.thread : id;
  threadOf.set(id, thread);
  for (const f of x.files ?? []) {
    const to = join(home, 'answers', project, String(thread), f.name);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, f.from ? readFileSync(f.from) : (f.content ?? ''));
  }
}

if (chats && chatIds.size) db.run('DELETE FROM chats WHERE id NOT IN (SELECT chat FROM talk WHERE chat IS NOT NULL)');
const homeRepo = () => (db.query(`SELECT value FROM settings WHERE project_id = $c AND key = 'home_repo'`).get({ c: project }) as { value: string } | null)?.value ?? project;
for (const [i, f] of (stage.friction ?? []).entries())
  db.query('INSERT INTO friction (project_id, repo, card_id, at, what, cost, fix) VALUES ($c, $repo, $card, $at, $what, $cost, $fix)').run({
    c: project,
    repo: f.repo ?? homeRepo(),
    card: ids[f.card] ?? fail(`friction ${i}: card ${f.card} does not exist`),
    at: ago(f.ago ?? '0s'),
    what: f.what,
    cost: f.cost,
    fix: f.fix,
  });
for (const [i, f] of (stage.feedback ?? []).entries()) {
  const id = ids[f.card] ?? fail(`feedback ${i}: card ${f.card} does not exist`);
  const row = db.query('SELECT project_id, title, repo, parent_id FROM cards WHERE id = $id').get({ id }) as { project_id: string; title: string | null; repo: string | null; parent_id: string | null };
  const handover = (db.query(`SELECT max(id) AS h FROM events WHERE card_id = $id AND kind = 'review'`).get({ id }) as { h: number | null }).h ?? i;
  const configs = f.configs ?? [];
  const attribution = !configs.length ? 'missing' : configs.length > 1 ? 'mixed' : 'single';
  const credited = attribution === 'single' ? configs[0] : undefined;
  const plan = f.plan ? { id: row.parent_id ?? `plan-${f.plan}`, title: f.plan } : undefined;
  const answer = { ...(f.rating !== undefined ? { rating: f.rating } : {}), ...(f.comment ? { comment: f.comment } : {}) };
  db.query(
    `INSERT INTO feedback (card_id, project_id, handover, context, attribution, configs, harness, model, effort, answer, created_at)
     VALUES ($card, $c, $handover, $context, $attribution, $configs, $harness, $model, $effort, $answer, $at)`,
  ).run({
    card: id,
    c: row.project_id,
    handover,
    context: JSON.stringify({ title: f.title ?? row.title ?? '', repo: row.repo ?? (db.query(`SELECT value FROM settings WHERE project_id = $c AND key = 'home_repo'`).get({ c: row.project_id }) as { value: string } | null)?.value ?? row.project_id, ...(plan ? { plan } : {}) }),
    attribution,
    configs: JSON.stringify(configs),
    harness: credited?.harness ?? null,
    model: credited?.model ?? null,
    effort: credited?.effort ?? null,
    answer: JSON.stringify(answer),
    at: ago(f.ago ?? '0s'),
  });
}
for (const [i, p] of (stage.settingProposals ?? []).entries())
  db.query('INSERT INTO setting_proposals (project_id, repo, field, value, basis, cards, created_at) VALUES ($c, $repo, $field, $value, $basis, $cards, $at)').run({
    c: project,
    repo: p.repo ?? homeRepo(),
    field: p.field,
    value: JSON.stringify(p.value),
    basis: p.basis,
    cards: JSON.stringify(p.cards.map((k) => ids[k] ?? fail(`setting proposal ${i}: card ${k} does not exist`))),
    at: new Date().toISOString(),
  });
db.close();

for (const on of allProjects) {
  
  const first = stage.cards.find((c) => (c.plan || c.workstream ? on.id === project : c.project ? c.project === on.name : on.id === project));
  if (!first) continue;
  const c = ((await api('GET', '/project', undefined, on.id)) as ProjectSnapshot).items.find((x: Item) => x.id === idOf(first, stage.cards.indexOf(first)))!;
  await patchCard(c.id, { x: c.x, y: c.y });
}

for (const v of stage.canvases ?? []) {
  const canvas = (await api('POST', '/canvases', { name: v.name, ...(v.icon ? { icon: v.icon } : {}) })) as { id: string };
  const on = (v.cards ?? []).map((k) => ids[k] ?? fail(`canvas ${v.name}: card ${k} does not exist`));
  if (!on.length) continue;
  const before = ((await api('GET', '/project')) as ProjectSnapshot).items;
  await api('POST', `/canvases/${canvas.id}/cards`, { cards: on });
  
  for (const id of on) {
    const c = before.find((x: Item) => x.id === id);
    if (c && !c.parent) await patchCard(id, { x: c.x, y: c.y });
  }
}

for (const g of stage.groups ?? [])
  await api('POST', '/groups', { name: g.name, cards: g.cards.map((k) => ids[k] ?? fail(`group ${g.name}: card ${k} does not exist`)) });

const staged = { url: (await loginLink(base, home, `/p/${project}`)) ?? `${base}/p/${project}`, port, ...pathsAt(dir, repo, log), project, pid: server.pid, from, cards: ids, ...(record ? { record } : {}), ...(replay ? { replay } : {}) };
writeFileSync(join(dir, 'staged.json'), JSON.stringify(staged, null, 2));
console.log(JSON.stringify(staged));
process.exit(0);


/** Git configuration for the server's git calls, as environment variables. */
function gitConfig(pairs: (readonly [string, string])[]): Record<string, string> {
  return Object.fromEntries([['GIT_CONFIG_COUNT', String(pairs.length)], ...pairs.flatMap(([k, v], i) => [[`GIT_CONFIG_KEY_${i}`, k], [`GIT_CONFIG_VALUE_${i}`, v]])]);
}

function initRepo(path: string) {
  run('git', ['init', '-q', '-b', mainBranch], path);
  run('git', ['add', '-A'], path);
  run('git', ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.com', 'commit', '-qm', 'init'], path);
}

function run(cmd: string, a: string[], cwd: string) {
  const r = spawnSync(cmd, a, { cwd, encoding: 'utf8' });
  if (r.status !== 0) fail(`${cmd} ${a.join(' ')}: ${r.stderr}`);
}

/**
 * A port for a scratch Seismic staged without one. Staging afresh from the same stage file and code
 * stops the scratch Seismic staged from them before (the one in `givenDir`, if given) and takes its
 * port again; else the first from 4480 up that nothing listens on, whose scratch dir no running
 * server holds and that no other staging has claimed meanwhile (its server does not listen yet).
 */
async function pickPort(givenDir: string | undefined): Promise<number> {
  const earlier = givenDir ? resolve(givenDir) : scratchDirs().find((d) => JSON.stringify(stagedIn(d)?.from) === JSON.stringify(from));
  const was = earlier ? stagedIn(earlier)?.port : undefined;
  if (earlier && !stop(earlier)) console.error(`scratch-seismic: the server of ${earlier} (process ${pidIn(earlier)}) still runs after the stop`);
  for (const p of [...(was ? [was] : []), ...Array.from({ length: 500 }, (_, i) => 4480 + i)]) {
    if (p === 4417 || serverIn(scratchDir(p)) || !claim(p)) continue;
    if (await free(p)) {
      
      if (earlier && !givenDir && earlier !== scratchDir(p)) rmSync(earlier, { recursive: true, force: true });
      return p;
    }
    rmSync(claimOf(p), { force: true });
  }
  return fail('no free port from 4480 to 4979: run `bun scripts/scratch-seismic.ts --list` to see the running scratch instances, then `bun scripts/scratch-seismic.ts --stop <port>` for each stale one');
}

function scratchDirs() {
  return readdirSync('/tmp')
    .filter((n) => /^seismic-scratch-\d+$/.test(n))
    .map((n) => `/tmp/${n}`);
}

/** Where a scratch Seismic in `d` keeps what workers look for, as staging prints it. */
function pathsAt(d: string, repo: string, log: string) {
  return { dir: d, home: join(d, 'home'), repo, database: join(d, 'home', 'seismic.db'), log };
}

function pointerOf(p: number) {
  return `${scratchDir(p)}.at`;
}

/** The scratch dir of the Seismic on port `p`: --dir, else the one staging named for it outside /tmp/seismic-scratch-<p> while it runs there. */
function dirOf(p: number) {
  const given = opt('dir');
  if (given) return given;
  try {
    const d = readFileSync(pointerOf(p), 'utf8');
    if (stagedIn(d)?.port === p && serverIn(d)) return d;
  } catch {}
  return scratchDir(p);
}

/** The scratch dirs whose server still runs: /tmp/seismic-scratch-<port> and those staging pointed to from there. */
function runningDirs() {
  const pointed = readdirSync('/tmp')
    .filter((n) => /^seismic-scratch-\d+\.at$/.test(n))
    .map((n) => {
      try {
        return readFileSync(`/tmp/${n}`, 'utf8');
      } catch {
        return '';
      }
    });
  return [...new Set([...scratchDirs(), ...pointed])].filter((d) => d && stagedIn(d)?.port && serverIn(d)).sort((a, b) => stagedIn(a)!.port! - stagedIn(b)!.port!);
}

/** What --list prints of the scratch Seismic in `d`. */
function pathsOf(d: string) {
  const s = JSON.parse(readFileSync(join(d, 'staged.json'), 'utf8')) as { url: string; port: number; repo?: string; log?: string; from?: { stage?: string; code?: string } };
  return {
    port: s.port,
    url: s.url,
    ...pathsAt(d, s.repo ?? join(d, 'repo'), s.log ?? join(d, 'server.log')),
    stage: s.from?.stage,
    ...(s.from?.code ? { code: s.from.code } : {}),
  };
}

function stagedIn(d: string): { port?: number; from?: unknown } | undefined {
  try {
    return JSON.parse(readFileSync(join(d, 'staged.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

function pidIn(d: string) {
  return pidOf(join(d, 'server.pid'));
}

function pidOf(file: string) {
  try {
    return Number(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * The process number of the scratch server of `d`, while it runs. server.pid alone does not tell:
 * a scratch dir outlives a reboot and process numbers come again (on Windows soon), so by now it
 * may name another program. The server started right before server.pid was written; a process
 * with its number that started later is another one.
 */
function serverIn(d: string) {
  const file = join(d, 'server.pid');
  const pid = pidOf(file);
  if (!alive(pid)) return undefined;
  const started = startOf(pid!);
  
  return started !== undefined && started <= statSync(file).mtimeMs + 2000 ? pid : undefined;
}

/** When process `pid` started (ms since the epoch, to the second), unless it is gone or not ours to look at. */
function startOf(pid: number): number | undefined {
  if (process.platform === 'win32') {
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `([DateTimeOffset](Get-Process -Id ${pid} -ErrorAction Stop).StartTime).ToUnixTimeMilliseconds()`], {
      encoding: 'utf8',
    });
    const ms = Number(r.stdout?.trim());
    return r.status === 0 && ms > 0 ? ms : undefined;
  }
  
  const r = spawnSync('ps', ['-o', 'etime=', '-p', String(pid)], { encoding: 'utf8' });
  const m = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s*$/.exec(r.stdout ?? '');
  if (r.status !== 0 || !m) return undefined;
  const [days, hours, minutes, seconds] = m.slice(1).map((n) => Number(n ?? 0));
  return Date.now() - (((days! * 24 + hours!) * 60 + minutes!) * 60 + seconds!) * 1000;
}

function alive(pid: number | undefined) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function claimOf(p: number) {
  return `${scratchDir(p)}.claim`;
}

/** Claims port `p` for this staging until it ends, unless another staging that still runs has. */
function claim(p: number): boolean {
  
  const mine = `${claimOf(p)}.${process.pid}`;
  writeFileSync(mine, String(process.pid));
  try {
    for (let i = 0; i < 3; i++)
      try {
        linkSync(mine, claimOf(p));
        process.on('exit', () => rmSync(claimOf(p), { force: true }));
        return true;
      } catch {
        const holder = pidOf(claimOf(p));
        if (alive(holder)) return false;
        
        if (holder) rmSync(claimOf(p), { force: true });
      }
    return false;
  } finally {
    rmSync(mine, { force: true });
  }
}

/** Whether a server could listen on port `p` of the loopback and nothing answers there (one listening on every address, say). */
async function free(p: number) {
  try {
    Bun.serve({ port: p, hostname: '127.0.0.1', fetch: () => new Response() }).stop(true);
  } catch {
    return false;
  }
  const answers = await Bun.connect({ hostname: '127.0.0.1', port: p, socket: { data() {} } }).then(
    (s) => (s.end(), true),
    () => false,
  );
  return !answers;
}

/** Ends the scratch Seismic that `dir` belongs to, and what it started, if it still runs; false if its server outlives the stop. */
function stop(d: string) {
  const gone = stopServer(d);
  
  const served = join(d, 'home', 'tailscale-serve.json');
  if (existsSync(served)) {
    const tailscale = findTailscale();
    const entry = JSON.parse(readFileSync(served, 'utf8')) as ServeEntry & { name: string };
    if (tailscale) new Tailscale(tailscale).unserveSync(entry.name, entry);
    rmSync(served, { force: true });
  }
  return gone;
}

/** Ends the scratch server of `d` with its process group (its tree on Windows); whether it is gone then. */
function stopServer(d: string) {
  const pid = serverIn(d);
  if (!pid) return true;
  if (process.platform === 'win32') stopTree(pid);
  else signalGroup(pid);
  return serverIn(d) !== pid;
}

function signalGroup(pid: number) {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return;
  }
  for (let i = 0; i < 40; i++) {
    if (!alive(pid)) return;
    
    if (i === 15)
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {}
    Bun.sleepSync(100);
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {}
  for (let i = 0; i < 20 && alive(pid); i++) Bun.sleepSync(100);
}

/**
 * Windows has no process groups to signal: ends the server's process tree, which a console process
 * without a window lets end only forcefully, and waits until it is gone and lets go of its files.
 */
function stopTree(pid: number) {
  spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
  for (let i = 0; i < 50 && alive(pid); i++) Bun.sleepSync(100);
}

function ago(s: string): string {
  const m = /^(\d+(?:\.\d+)?)([smhd])$/.exec(s) ?? fail(`"${s}" is no time ago (like "15m", "2h", "3d")`);
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return new Date(Date.now() - Number(m[1]) * unit * 1000).toISOString();
}

/** Where the card of `key` keeps its HTML artifact in the scratch Seismic of `d`. */
function artifactDir(d: string, key: string) {
  return join(d, 'artifacts', key);
}

function copyArtifact(from: string, to: string) {
  if (!existsSync(join(from, 'index.html'))) fail(`${from} holds no index.html for an HTML artifact`);
  cpSync(from, to, { recursive: true });
  return to;
}

/** The scratch Seismic on `port` as its staged.json has it, and the owner's key of its home. */
function scratchAt(port: number) {
  const d = dirOf(port);
  if (!existsSync(join(d, 'staged.json'))) fail(`no scratch Seismic staged in ${d}`);
  const staged = JSON.parse(readFileSync(join(d, 'staged.json'), 'utf8')) as { project: string; cards: Record<string, string> };
  return { base: `http://127.0.0.1:${port}/api/c/${staged.project}`, cards: staged.cards, headers: ownerHeaders(join(d, 'home')) };
}

function cardOf(port: number, key: string) {
  const s = scratchAt(port);
  return { ...s, id: s.cards[key] ?? fail(`no card ${key} staged (${Object.keys(s.cards).join(', ')})`) };
}

async function stagedCard(port: number, key: string): Promise<Item> {
  const { base, headers, id } = cardOf(port, key);
  const r = await fetch(`${base}/project`, { headers }).catch(() => fail(`no scratch Seismic answers on port ${port}`));
  return ((await r.json()) as ProjectSnapshot).items.find((i) => i.id === id) ?? fail(`card ${key} is not on the project`);
}

/** The card's agent says or does `act`, through the server (`WorkerSupervisor.standIn`); returns what the agent would have read back. */
async function standIn(port: number, key: string, act: { say: string } | { tool: string; args: Record<string, unknown> } | { end: true } | { step: unknown }): Promise<string> {
  const { base, headers, id } = cardOf(port, key);
  const r = await fetch(`${base}/cards/${id}/stand-in`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(act) }).catch(() =>
    fail(`no scratch Seismic answers on port ${port}`),
  );
  const body = (await r.json()) as { result?: string; error?: string };
  if (!r.ok) fail(`card ${key}: ${body.error ?? r.status}`);
  
  if (/^Not [a-z ]+:/.test(body.result!)) fail(`card ${key}: ${body.result}`);
  return body.result!;
}
