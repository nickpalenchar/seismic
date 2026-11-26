

import type { ServerWebSocket } from 'bun';
import { extensionSettings, serverExtensions as extensions } from '../extensions/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { type ActivityPage, agentListens, type ProjectInfo, type ChatElsewhere, type ProjectSettingsView, type CardAction, type ClientMessage, type DeveloperView, type Harness, type Item, type MachineSectionId, type NewCard, type PageTags, type PendingRestart, type ServerMessage, type SpotInput, type TalkRef, isTalkRef, MAX_FILE_BYTES, needsYou, type Waiting, waitingIn } from '../core/types';
import { uiRoutes } from './ui';
import { guarded, LOCAL_HOSTS, refusal } from './access';
import { BadRequest } from './board';
import { bunRoutes, respond } from './routes/httpRoute';
import { v1Routes } from './routes/v1';
import { OwnerSettings } from './ownerSettings';
import { type Dropped, findDropped, localImage } from './files';
import type { ProjectRuntime } from './project';
import { SiteSetup } from './site-setup';
import { parsePlace } from '../core/layout';
import { type Focus, type Heard, type Input, isField } from './commands';
import { holdsNotes } from '../core/queue';
import type { Config } from './config';
import { serveAnswerFile, serveCardFile, serveDemoFile, serveMockFrame } from './demo';
import { type NarrationHost, parseClipRequest } from './narration';
import type { Restarter } from './self-update';
import { looping, silence, type Transcriber } from './voice';
import { CloudError } from './voice-cloud';
import type { MachineSetup } from './machine';
import type { VoiceSetup } from './voice-setup';
import { AppUpdates, HandOver } from './app-update';
import type { SourceUpdates } from './source-update';
import { oldLinuxBun } from './repo';
import { Store } from './store';
import { projectData, projectCsv } from './data-export';
import { Access } from './remote';
import { Push, startedWaiting } from './push';
import { worker } from '../ui/sw';
import icon180 from '../ui/logo/apple-touch-icon.png' with { type: 'file' };
import icon512 from '../ui/logo/icon-512.png' with { type: 'file' };
import emojiDataFile from 'emojibase-data/en/data.json' with { type: 'file' };
import emojiMessagesFile from 'emojibase-data/en/messages.json' with { type: 'file' };
import { servePdfjs } from './pdfjs';
import { Tailscale } from './tailscale';
import { codexModels } from './llms/harnesses/codex';
import { agyModels } from './llms/harnesses/agy';
import { savedHarnesses, agentsView, ownerLanguage } from './settings';
import { proposeTags, TagProposals } from './llms/agents/agentJobs/tagProposal';
import { parseTagLines, tagLines } from '../core/page-tags';
import { expandHome, readDemoSettings } from '../../plugin/skills/demo/lib/settings.ts';
import type { UsageMeter } from './usage';
import { VERSION } from './resources';
import { footerOf } from './llms/agents/agentJobs/writeWish';
import { serving } from './owner';
import { pageStall, type Stalls } from './stalls';


const emojiData = emojiDataFile as unknown as string;
const emojiMessages = emojiMessagesFile as unknown as string;

type Req = Request & { params: Record<string, string> };

const notFound = () => new Response('Not found', { status: 404 });


const V1_ACTIONS = new Set<string>(['start', 'force', 'stop', 'approve', 'dequeue']);


/**
 * Whether a harness's model catalog is read. One that is not connected has none, except before any
 * harnesses were saved and any project exists: onboarding picks agents there that are saved only with the first project.
 */
function offersCatalog(config: Config, harness: Harness, machine?: MachineSetup): boolean {
  const saved = savedHarnesses(config.home);
  if (saved) return saved.includes(harness);
  return !config.current().length || !!machine?.harnesses().includes(harness);
}

function replyParam(p: string | null): number | TalkRef | undefined {
  const m = p?.match(/^(\d+)(?:\.(said|reply|answer))?$/);
  if (!m) return;
  return m[2] ? { talk: Number(m[1]), part: m[2] as TalkRef['part'] } : Number(m[1]) || undefined;
}


interface Socket {
  project: string;
  page: string;
  device?: string;
}

export interface Voice {
  transcriber: Transcriber;
  
  setup?: VoiceSetup;
}


export interface Served {
  all(): ProjectRuntime[];
  onChange?(fn: () => void): () => void;
}

/**
 * A demo's narration clip, in the voice Seismic holds loaded across renders (narration.ts). It writes a
 * file, so only as JSON, which a page elsewhere cannot send without asking first. `remote`: for a
 * render on another machine, whose clip comes back in the reply and is written nowhere here.
 */
function clipRoute(narration: NarrationHost, remote = false) {
  return async (req: Request, srv: Bun.Server<unknown>) => {
    if (!req.headers.get('content-type')?.startsWith('application/json')) return Response.json({ code: 'invalid', error: 'JSON only' }, { status: 415 });
    const request = parseClipRequest(await req.json().catch(() => null));
    if (typeof request === 'string') return Response.json({ code: 'invalid', error: request }, { status: 400 });
    if (remote && !request.inline) return Response.json({ code: 'invalid', error: 'inline must be true from another machine' }, { status: 400 });
    
    srv.timeout(req, 0);
    const reply = await narration.clip(request);
    if (!request.inline || !('ok' in reply)) return Response.json(reply);
    const file = Bun.file(request.out);
    const wav = Buffer.from(await file.arrayBuffer()).toString('base64');
    await file.delete();
    return Response.json({ ...reply, wav });
  };
}

/**
 * What a worker on another machine reaches through the port forwarded to it: the
 * narration clips and nothing else of Seismic's, as whoever is on that machine reaches the port too.
 */
export function serveNarration(narration: NarrationHost) {
  const clip = clipRoute(narration, true);
  return Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    idleTimeout: 120,
    fetch: (req, srv) =>
      refusal(req, LOCAL_HOSTS) ?? (req.method === 'POST' && new URL(req.url).pathname === '/api/narration/clip' ? clip(req, srv) : notFound()),
  });
}

export function serve(
  served: Served | ProjectRuntime[],
  { transcriber, setup }: Voice,
  port: number,
  development = false,
  config?: Config,
  restarter?: Restarter,
  narration?: NarrationHost,
  machine?: MachineSetup,
  
  stop?: () => void,
  
  updates = new AppUpdates(),
  
  access = new Access({ store: new Store(':memory:'), tailscale: new Tailscale(null) }),
  
  push = new Push({ store: access.store }),
  
  sources?: SourceUpdates,
  
  usage: UsageMeter[] = [],
  
  stalls?: Stalls,
  
  developer: DeveloperView = { restart: false, rebuild: false, why: 'dev' },
) {
  const projects = Array.isArray(served) ? { all: () => served } : served;
  const sites = config
    ? new SiteSetup({
        home: config.home,
        changed: () => projects.all().forEach((c) => c.demoSitesChanged()),
        user: (() => {
          try {
            return userInfo().username;
          } catch {
            return '';
          }
        })(),
      })
    : undefined;
  const tagProposals = new TagProposals();
  /**
   * Proposes the tags of a repository's site: read where it runs (its first project), from the cards
   * of every project it is on, in the language of its demos (`language`: the dialog's, unsaved).
   */
  const proposeTagsFor = (home: string, input: unknown) => {
    const { path, current, language } = (input ?? {}) as { path?: unknown; current?: unknown; language?: unknown };
    if (typeof path !== 'string' || !path.trim()) throw new BadRequest('invalid', 'expected { path }');
    const sources = projects.all().flatMap((c) => c.tagSource(expandHome(path)) ?? []);
    if (!sources.length) throw new BadRequest('invalid', 'the repository runs on no project');
    const vocabulary = typeof current === 'object' && current ? parseTagLines(tagLines(current as PageTags)) : undefined;
    return tagProposals.start(path, () =>
      proposeTags({
        runtime: sources[0]!.runtime,
        cwd: sources[0]!.cwd,
        language: language === 'en' ? language : (sources[0]!.language ?? readDemoSettings(home).language),
        owner: ownerLanguage(home),
        ...(vocabulary ? { current: vocabulary } : {}),
        cards: sources.flatMap((s) => s.cards),
      }),
    );
  };
  const byId = new Map<string, ProjectRuntime>();
  const handOver = new HandOver();
  
  
  const handOverScope = (req: Request) => JSON.stringify([
    access.deviceOf(req) ?? null,
    req.headers.get('x-forwarded-host') ?? req.headers.get('host'),
    req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol,
  ]);
  const started = crypto.randomUUID();
  const sockets = new Map<string, Set<ServerWebSocket<Socket>>>();
  
  access.onRemoved((device) => {
    for (const set of sockets.values()) for (const ws of set) if (ws.data.device === device) ws.close(4401, 'device removed');
  });
  /** The restart that waits, as project `id` sees it: Seismic's, else that of some of its repositories' agents. */
  const pending = (id: string): PendingRestart | null => {
    const due = restarter?.due();
    if (!due) return byId.get(id)?.pendingRestart() ?? null;
    const here = due.waiting.filter((w) => w.project === id);
    
    const elsewhere = new Map<string, { id: string; short?: string; title: string }[]>();
    const items = new Map<string, Item[]>();
    for (const w of due.waiting) {
      if (w.project === id) continue;
      if (!items.has(w.project)) items.set(w.project, byId.get(w.project)?.board.items() ?? []);
      const item = items.get(w.project)!.find((i) => i.id === w.card);
      elsewhere.set(w.project, [...(elsewhere.get(w.project) ?? []), { id: w.card, short: item?.short, title: item?.title ?? w.card }]);
    }
    return {
      reason: due.reason,
      deadline: due.deadline,
      cards: here.map((w) => w.card),
      elsewhere: [...elsewhere].map(([c, cards]) => ({ id: c, project: byId.get(c)?.board.project.name ?? c, cards })),
      owner: due.owner,
    };
  };
  
  const waiting: Record<string, Waiting> = {};
  
  const waitingSent: Record<string, string> = {};
  const waitingMessage = () => JSON.stringify({ type: 'waiting', waiting } satisfies ServerMessage);
  /** Takes in what waits on `c` now; whether that changed. */
  const counted = (c: ProjectRuntime, snapshot = c.board.snapshot()) => {
    const w = waitingIn(snapshot);
    const text = JSON.stringify(w);
    if (text === waitingSent[c.id]) return false;
    waiting[c.id] = w;
    waitingSent[c.id] = text;
    return true;
  };
  const everyone = (text: string) => {
    for (const set of sockets.values()) for (const ws of set) ws.send(text);
  };
  const sendTo = (id: string, msg: ServerMessage) => {
    const text = JSON.stringify(msg);
    for (const ws of sockets.get(id) ?? []) ws.send(text);
  };
  restarter?.onChange(() => {
    for (const id of byId.keys()) sendTo(id, { type: 'restart', restart: pending(id) });
  });
  updates.onChange(() => everyone(JSON.stringify({ type: 'update', update: updates.current() } satisfies ServerMessage)));
  sources?.onChange(() => everyone(JSON.stringify({ type: 'source', source: sources.current() } satisfies ServerMessage)));
  const usageMessage = () => JSON.stringify({ type: 'usage', usage: usage.flatMap((m) => m.current() ?? []) } satisfies ServerMessage);
  for (const m of usage) m.onChange(() => everyone(usageMessage()));
  
  const unwatch = new Map<string, () => void>();
  
  const detach = new Map<string, () => void>();
  const attach = (c: ProjectRuntime) => {
    byId.set(c.id, c);
    if (!sockets.has(c.id)) sockets.set(c.id, new Set());
    counted(c);
    const send = (msg: ServerMessage) => sendTo(c.id, msg);
    
    let seen = new Map(c.board.items().map((i) => [i.id, i]));
    const offs = [
      c.board.onChange(() => {
        const items = c.board.items();
        const started = startedWaiting(seen, items);
        seen = new Map(items.map((i) => [i.id, i]));
        const several = projects.all().length > 1;
        push.waits(
          started.map(({ item, kind }) => ({
            card: item.id,
            title: item.title,
            kind,
            ...(several ? { project: c.board.project.name } : {}),
            still: () => {
              const now = c.board.item(item.id);
              return !!now && needsYou(now);
            },
          })),
        );
        const snapshot = c.board.snapshot();
        send({ type: 'snapshot', snapshot });
        
        relist();
        if (counted(c, snapshot)) everyone(waitingMessage());
      }),
      c.board.onEvent((event) => send({ type: 'event', event })),
      c.board.onEventGone((cardId, id) => send({ type: 'eventGone', cardId, id })),
      c.board.onNotice((n) => send({ type: 'notice', ...n })),
      
      c.onPending(() => {
        send({ type: 'restart', restart: pending(c.id) });
        relist();
      }),
    ];
    detach.set(c.id, () => offs.forEach((off) => off()));
  };
  const projectList = () => projects.all().map((c) => c.board.project);
  const projectsMessage = (list: ProjectInfo[]) => JSON.stringify({ type: 'projects', projects: list } satisfies ServerMessage);
  
  let listed = '';
  /** Sends the projects to every page where they changed (one started, stopped, renamed, or with other repositories). */
  const relist = () => {
    const now = projectList();
    const list = JSON.stringify(now);
    if (list === listed) return;
    const first = !listed;
    listed = list;
    if (first) return;
    everyone(projectsMessage(now));
    everyone(waitingMessage());
  };
  for (const c of projects.all()) attach(c);
  relist();
  
  projects.onChange?.(() => {
    const now = projects.all();
    for (const [id, c] of [...byId])
      if (!now.includes(c)) {
        detach.get(id)?.();
        detach.delete(id);
        byId.delete(id);
        delete waiting[id];
        delete waitingSent[id];
        
        for (const ws of sockets.get(id) ?? []) ws.close();
        sockets.delete(id);
      }
    for (const c of now) if (byId.get(c.id) !== c) attach(c);
    relist();
  });

  /** A click the retrospective counts (a card deleted, a command taken back, a rule proposal decided on), once it went through. */
  const click = <T>(c: ProjectRuntime, out: T): T => {
    c.koordinator.noticed();
    return out;
  };

  const handle = respond;
  
  
  const ownerSettings = config
    ? new OwnerSettings({
        home: config.home,
        demo: { view: () => config.demo(), save: (input) => config.saveDemo(input) },
        onUsageMeter: (view) => {
          const configured = machine?.harnesses();
          for (const m of usage) m.setOn(view.on && (!m.harness || (configured?.includes(m.harness) ?? true)));
        },
        onFeedbackPrompt: () => projects.all().forEach((x) => x.board.changed()),
      })
    : undefined;
  const projectOfCard = (cardId: string, options?: { deleted?: boolean }) =>
    [...byId.values()].find((c) => {
      const row = c.dataStore.cards.get(cardId);
      return row?.project_id === c.id && (!row.deleted_at || !!options?.deleted);
    });
  /** A route on one project; an unknown project is a 404. */
  const on =
    (fn: (c: ProjectRuntime, req: Req) => unknown | Promise<unknown>) =>
    (req: Req): Response | Promise<Response> => {
      const c = byId.get(req.params.project!);
      return c ? handle(() => fn(c, req)) : Response.json({ code: 'invalid', error: 'unknown project' }, { status: 404 });
    };
  /** A route that needs what this server may run without (its configuration, voice setup, the setup assistant); a 404 without it. */
  const needs =
    <T,>(x: T | undefined, fn: (x: T, req: Request) => unknown | Promise<unknown>) =>
    (req: Request): Response | Promise<Response> =>
      x ? handle(() => fn(x, req)) : notFound();
  /** Nothing the owner said came through: Whisper understood nothing (`null`), or heard nothing. */
  const unheard = (c: ProjectRuntime, text: string | null) => ({ confirm: text === null ? c.board.t.voice.notUnderstood : c.board.t.voice.nothingHeard, unheard: true });

  




  let answering = 0;
  const holdingRestart =
    <T,>(fn: (c: ProjectRuntime, req: Req) => Promise<T>) =>
    async (c: ProjectRuntime, req: Req): Promise<T> => {
      const holder = `request ${++answering}`;
      restarter?.hold(holder, ['voice']);
      try {
        return await fn(c, req);
      } finally {
        restarter?.hold(holder);
      }
    };

  




  const arrived = new Set<string>();
  const ARRIVED_KEPT = 500;
  const arrive = (id: string | null) => {
    if (!id) return;
    arrived.add(id);
    for (const old of arrived) if (arrived.size > ARRIVED_KEPT) arrived.delete(old);
  };

  /** The card or plan in view, and where on the project the owner was: as the page says, else what it last had in view. */
  const focusOf = (req: Request, c?: ProjectRuntime): Focus => {
    const q = new URL(req.url).searchParams;
    const place = parsePlace(q.get('place')) ?? c?.inView;
    return { ...(q.get('card') ? { card: q.get('card')! } : {}), ...(q.get('plan') ? { plan: q.get('plan')! } : {}), ...(place ? { place } : {}) };
  };
  const transcribe = async (c: ProjectRuntime, audio: Blob) => {
    const dir = mkdtempSync(join(tmpdir(), 'seismic-voice-'));
    
    const file = join(dir, `speech.${/mp4|m4a|aac/.test(audio.type) ? 'mp4' : /wav/.test(audio.type) ? 'wav' : /ogg/.test(audio.type) ? 'ogg' : 'webm'}`);
    try {
      await Bun.write(file, audio);
      const first = await transcriber.transcribe(file, c.commander.vocabulary());
      const text = first.text.trim();
      if (silence(text)) return console.log(`voice on ${c.id}: ${text}`), '';
      if (!looping(text) && !first.doubtful) return text;
      if (first.unprompted) return console.log(`voice ${looping(text) ? 'looped' : 'was unsure'} on ${c.id}: ${text.slice(0, 80)}`), null;
      
      console.log(`whisper ${looping(text) ? 'looped' : 'was unsure'} on ${c.id}: ${text.slice(0, 80)}; once more without the card titles`);
      const again = await transcriber.transcribe(file, '');
      const second = again.text.trim();
      if (!looping(second) && !again.doubtful && !silence(second)) return second;
      console.log(`whisper on ${c.id} without the card titles${again.doubtful ? ', unsure' : ''}: ${second.slice(0, 80)}`);
      return silence(second) ? '' : null;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  
  
  const listens = (card: Item, input: Input) => agentListens(card) || (input.field === 'note' && holdsNotes(card));
  /**
   * What the owner said or typed: with an agent on the open card, straight to that agent (which
   * passes on what asks Seismic for something); else the Koordinator reads it. `null`: Whisper heard
   * nothing it could write down, which nobody should guess from.
   */
  const heard = async (c: ProjectRuntime, text: string | null, focus: Focus, images: string[] = [], input: Input = {}) => {
    
    console.log(`heard on ${c.id}: ${text === null ? '(not understood)' : text || '(nothing)'}`);
    
    if (text === null || (!text && !(input.typed && images.length))) return unheard(c, text);
    const card = focus.card ? c.board.item(focus.card) : undefined;
    if (card && listens(card, input)) {
      c.tell(card.id, text, images, !input.typed, typeof input.replyTo === 'number' ? input.replyTo : undefined, input.spot);
      
      return { confirm: '', quiet: true } satisfies Heard;
    }
    const h = await c.commander.hear(text, focus, images, input);
    
    if (h.token) c.commander.arm(h.token);
    return { ...h, ...(h.token ? { undoMs: c.commander.delayMs } : {}) };
  };

  const extensionRoutes: Record<string, Record<string, (req: Request) => Response | Promise<Response>>> = {};
  const extensionContext = {
    settings: (project: string, repo: string) => {
      const found = projects.all().find((c) => c.id === project)?.repos.find((r) => r.ref.id === repo);
      return found ? extensionSettings(found.adapter) : undefined;
    },
  };
  for (const extension of extensions) for (const [path, methods] of Object.entries(extension.routes ?? {})) {
    if (extensionRoutes[path]) throw new Error(`duplicate extension route: ${path}`);
    extensionRoutes[path] = Object.fromEntries(Object.entries(methods).map(([method, handler]) => [method, (req: Request) => handler(req, extensionContext)]));
  }
  const options = {
    port,
    hostname: '127.0.0.1',
    
    idleTimeout: 120,
    development: development && { hmr: true, console: true },
    routes: guarded({
      ...extensionRoutes,
      ...uiRoutes(development),
      
      ...bunRoutes(v1Routes({ projectOfCard, projectById: (id) => byId.get(id), ownerSettings, configuration: config })),
      
      '/login': { GET: (req, srv) => access.loginRoute(req, srv) },
      
      '/api/login-link': {
        POST: async (req, srv) => {
          if (!access.isLocal(req, srv)) return onlyHere();
          const { next, once } = ((await req.json().catch(() => null)) ?? {}) as { next?: unknown; once?: unknown };
          return Response.json({ url: access.owner.link(new URL(req.url).origin, typeof next === 'string' ? next : '/', once === true) });
        },
      },
      
      '/pair': { GET: (req, srv) => access.pairRoute(req, srv), POST: (req, srv) => access.pairRoute(req, srv) },
      
      '/api/pair': { POST: (req, srv) => access.pairApi(req, srv) },
      
      '/api/access': {
        GET: (req, srv) => (access.isLocal(req, srv) ? handle(() => access.view()) : Response.json({ local: false })),
        PUT: async (req, srv) => (access.isLocal(req, srv) ? handle(async () => access.save(await req.json())) : onlyHere()),
      },
      '/api/access/pair': { POST: (req, srv) => (access.isLocal(req, srv) ? handle(() => access.pair()) : onlyHere()) },
      '/api/access/devices/:id': { DELETE: (req, srv) => (access.isLocal(req, srv) ? handle(() => ({ removed: access.remove(req.params.id) })) : onlyHere()) },
      
      
      
      '/icons/180.png': { GET: () => new Response(Bun.file(icon180), { headers: { 'cache-control': 'max-age=86400' } }) },
      '/icons/512.png': { GET: () => new Response(Bun.file(icon512), { headers: { 'cache-control': 'max-age=86400' } }) },
      
      '/emojibase/en/data.json': { GET: () => new Response(Bun.file(emojiData), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=86400' } }) },
      '/emojibase/en/messages.json': { GET: () => new Response(Bun.file(emojiMessages), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=86400' } }) },
      
      '/pdfjs/*': { GET: (req) => servePdfjs(req) },
      '/sw.js': { GET: () => new Response(`(${worker.toString()})();\n`, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' } }) },
      '/api/push': {
        GET: (req) => handle(async () => {
          const device = access.deviceOf(req);
          return { key: await push.key(), on: !!device && push.subscribed(device) };
        }),
        PUT: async (req) => {
          const device = access.deviceOf(req);
          if (!device) return onlyDevices();
          return handle(async () => push.subscribe(device, await req.json()));
        },
        DELETE: (req) => {
          const device = access.deviceOf(req);
          return device ? handle(() => push.unsubscribe(device)) : onlyDevices();
        },
      },
      
      '/api/projects': { GET: () => Response.json(projectList(), { headers: { 'x-seismic': 'projects' } }) },
      
      '/api/waiting': { GET: () => Response.json(waiting satisfies Record<string, Waiting>) },
      
      '/api/activity': {
        GET: (req) =>
          handle(() => {
            const q = new URL(req.url).searchParams;
            const all = projects.all();
            const here = all.find((c) => c.board.project.id === q.get('project'));
            const scope = q.get('all') ? all : here ? [here] : [];
            const limit = Math.min(Math.max(Number(q.get('limit')) || 30, 1), 100);
            const before = q.get('before') ? Number(q.get('before')) : undefined;
            const rows = scope[0]?.board.activityRows(scope.map((c) => c.board.project.id), before, limit) ?? [];
            const more = rows.length > limit;
            const page = rows.slice(0, limit);
            const entries = scope.flatMap((c) => c.board.activityEntries(page, c.board.project.name));
            return { entries: entries.sort((x, y) => y.id - x.id), more } satisfies ActivityPage;
          }),
      },
      
      '/api/chats': {
        GET: () => {
          const names = new Map(projects.all().map((c) => [c.board.project.id, c.board.project.name]));
          return Response.json((projects.all()[0]?.board.everyChat() ?? []).flatMap((x) => (names.has(x.project) ? [{ ...x, projectName: names.get(x.project)! }] : [])) satisfies ChatElsewhere[]);
        },
      },
      '/api/projects/export': { GET: (req) => {
        const url = new URL(req.url);
        const as = url.searchParams.get('as');
        const ids = url.searchParams.getAll('project');
        if (as !== 'json' && as !== 'csv') return Response.json({ code: 'invalid', error: 'Choose CSV or JSON' }, { status: 400 });
        const available = projects.all();
        const chosen = ids.length ? [...new Set(ids)] : available.map((c) => c.board.project.id);
        if (!chosen.length || chosen.some((id) => !available.some((c) => c.board.project.id === id)))
          return Response.json({ code: 'invalid', error: 'Unknown project' }, { status: 400 });
        const data = projectData(available[0]!.dataStore, chosen);
        const body = as === 'csv' ? projectCsv(data) : JSON.stringify(data, null, 2);
        return new Response(body, { headers: {
          'content-type': `${as === 'csv' ? 'text/csv' : 'application/json'}; charset=utf-8`,
          'content-disposition': `attachment; filename="seismic-projects.${as}"`,
          'cache-control': 'no-store',
        } });
      } },
      
      
      '/api/c/:project/restart': { POST: on(async (c) => ({ restarting: await c.restartNow() })) },
      
      '/api/c/:project/settings': {
        GET: on((c) => (config ? { settings: c.settings(), agents: agentsView(config.home).agents, harnesses: machine?.harnesses() } satisfies ProjectSettingsView : notFound())),
        PUT: on(async (c, req) => {
          if (!config) return notFound();
          await config.saveProject(c.id, await req.json());
          return { settings: c.settings(), agents: agentsView(config.home).agents, harnesses: machine?.harnesses() } satisfies ProjectSettingsView;
        }),
      },
      
      '/api/c/:project/repos': {
        GET: on((c) => (config ? config.projectView(c.id) : notFound())),
        PUT: on(async (c, req) => (config ? config.saveRepo(c.id, await req.json()) : notFound())),
      },
      
      '/api/c/:project/archive-project': { POST: on(async (c) => (config ? config.archiveProject(c.id) : notFound())) },
      
      '/api/c/:project/demo-site': { GET: on((c) => c.siteState() ?? null) },
      '/api/c/:project/demo-site/init': { POST: on(async (c, req) => c.initSite(await req.json()) ?? null) },
      
      '/api/c/:project/pause': { POST: on((c) => c.pauseAgents()) },
      '/api/c/:project/resume': { POST: on((c) => c.resumeAgents()) },
      
      '/api/restart': {
        POST: () =>
          handle(() => {
            const due = !!restarter?.due();
            
            if (due) setTimeout(() => restarter!.now(), 100);
            return { restarting: due };
          }),
      },
      
      '/api/developer': { GET: () => handle(() => developer) },
      '/api/developer/:what': {
        POST: (req) =>
          handle(() => {
            const what = req.params.what;
            if ((what !== 'restart' && what !== 'rebuild') || !restarter || !developer[what])
              return Response.json({ code: 'invalid', error: `Seismic cannot ${what} itself here` }, { status: 409 });
            
            setTimeout(() => restarter.request(what === 'rebuild' ? 'rebuild' : 'owner'), 100);
            return { requested: what };
          }),
      },
      
      '/api/stop': {
        POST: () =>
          handle(() => {
            if (!stop) return { stopping: false };
            
            setTimeout(stop, 100);
            return { stopping: true };
          }),
      },
      
      '/api/feedback': { GET: () => handle(() => projects.all()[0]?.board.allFeedback() ?? []) },
      '/api/agents/harnesses': { GET: needs(machine, (m) => m.harnessAvailability()) },
      '/api/harnesses': {
        GET: needs(machine, (m) => m.harnesses()),
        PUT: needs(machine, async (m, req) => m.setHarness(await req.json())),
      },
      '/api/agents/codex-models': { GET: needs(config, (c) => offersCatalog(c, 'codex', machine) ? codexModels() : []) },
      '/api/agents/agy-models': { GET: needs(config, (c) => offersCatalog(c, 'agy', machine) ? agyModels() : []) },
      
      
      '/api/demo-sites': {
        GET: needs(sites, (x) => x.view()),
        POST: needs(sites, async (x, req) => x.add(await req.json())),
        DELETE: needs(sites, (x, req) => x.remove({ url: new URL(req.url).searchParams.get('url') ?? '' })),
      },
      '/api/demo-sites/seen': { POST: needs(sites, (x) => (x.seen(), x.view())) },
      '/api/demo-sites/connect': { POST: needs(sites, async (x, req) => x.connect(await req.json())) },
      '/api/demo-sites/code': { GET: needs(sites, (x, req) => x.code(new URL(req.url).searchParams.get('url') ?? '')) },
      
      
      '/api/demo-sites/github/repos': { GET: needs(sites, (x) => x.repos()) },
      '/api/demo-sites/github/repo': {
        GET: needs(sites, (x, req) => {
          const q = new URL(req.url).searchParams;
          return x.repo(q.get('repo') ?? '', q.get('folder') ?? '');
        }),
      },
      '/api/demo-sites/mode': { POST: needs(sites, async (x, req) => x.mode(await req.json())) },
      
      '/api/tag-proposal': {
        GET: needs(config, (_, req) => {
          const path = new URL(req.url).searchParams.get('path') ?? '';
          return { job: tagProposals.job(path), available: !!path && projects.all().some((c) => c.repos.some((r) => resolve(r.info.path) === resolve(expandHome(path)))) };
        }),
        POST: needs(config, async (c, req) => ({ job: proposeTagsFor(c.home, await req.json()) })),
        DELETE: needs(config, (_, req) => (tagProposals.doneWith(new URL(req.url).searchParams.get('path') ?? ''), {})),
      },
      
      '/api/voice-setup': { GET: needs(setup, (s) => s.view()) },
      '/api/voice-setup/install': { POST: needs(setup, (s) => s.install()) },
      '/api/voice-setup/measure': { POST: needs(setup, (s) => s.measure()) },
      
      '/api/voice-setup/cloud': {
        PUT: needs(setup, async (s, req) => s.useCloud(await req.json())),
        DELETE: needs(setup, (s) => s.useLocal()),
      },
      
      
      '/api/setup': { GET: needs(machine, (m, req) => m.view(new URL(req.url).searchParams.get('sections')?.split(',').filter(Boolean) as MachineSectionId[] | undefined)) },
      '/api/setup/install': { POST: needs(machine, async (m, req) => m.install(await req.json())) },
      '/api/setup/login': { POST: needs(machine, async (m, req) => m.login(await req.json())) },
      '/api/setup/token': { POST: needs(machine, async (m, req) => m.saveToken(await req.json())) },
      '/api/setup/identity': { POST: needs(machine, async (m, req) => m.identity(await req.json())) },
      '/api/setup/folder': { POST: needs(machine, async (m, req) => m.folder(await req.json())) },
      '/api/setup/repo': { POST: needs(machine, async (m, req) => m.repo(await req.json())) },
      
      '/api/setup/git-preview': { POST: needs(machine, async (m, req) => m.gitPreview(await req.json())) },
      '/api/setup/git': { POST: needs(machine, async (m, req) => m.gitSetup(await req.json())) },
      '/api/setup/project': { POST: needs(machine, async (m, req) => m.project(await req.json())) },
      
      '/api/setup/pick': {
        POST: async (req, srv) => {
          if (!machine) return notFound();
          srv.timeout(req, 0);
          const { prompt } = ((await req.json().catch(() => ({}))) ?? {}) as { prompt?: unknown };
          return handle(() => machine.pick(typeof prompt === 'string' ? prompt : ''));
        },
      },
      
      
      
      '/api/demo-settings/check': { POST: needs(config, async (c, req) => c.checkDemo(await req.json())) },
      '/api/demo-settings/setup': { POST: needs(config, async (c, req) => c.demoSetup(await req.json())) },
      '/api/demo-settings/install': { POST: needs(config, async (c, req) => c.installDemoVoice(await req.json())) },
      '/api/demo-settings/sample': {
        POST: async (req) => {
          if (!config) return notFound();
          const input = await req.json().catch(() => null);
          return config.sampleDemoVoice(input).then(
            (wav) => new Response(wav, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' } }),
            (e) => handle(() => Promise.reject(e)),
          );
        },
      },
      
      '/api/narration/clip': { POST: narration ? clipRoute(narration) : notFound },
      
      '/api/config/share-settings': { POST: needs(config, async (c, req) => c.shareSettings(await req.json())) },
      
      '/api/config/trust': { POST: needs(config, async (c, req) => (c.trust(await req.json()), {})) },
      
      
      '/api/config/retry': { POST: needs(config, (c) => c.retry()) },
      '/api/config/check': {
        GET: needs(config, (c) => c.checkSaved()),
        POST: needs(config, async (c, req) => c.check(await req.json())),
      },
      '/api/c/:project/project': { GET: on((c) => c.board.snapshot()) },
      '/api/c/:project/cards': { POST: on(async (c, req) => c.board.create((await req.json()) as NewCard, undefined, 'owner')) },
      
      '/api/c/:project/adapter-setup': { POST: on(async (c, req) => c.adapterSetupCard(String(((await req.json()) as { repo?: unknown }).repo))) },
      
      '/api/c/:project/prepare-plan-doc': {
        POST: on(async (c, req) => {
          const { repo, file } = ((await req.json()) ?? {}) as { repo?: unknown; file?: unknown };
          return c.preparePlanDoc(String(repo), String(file));
        }),
      },
      
      '/api/c/:project/plan-dirs/:repo': {
        PATCH: on(async (c, req) => c.board.movePlanDirNote(req.params.repo!, await req.json())),
      },
      
      
      
      '/api/c/:project/groups': {
        POST: on(async (c, req) => {
          const { name, cards, hue } = ((await req.json()) ?? {}) as { name?: string; cards?: string[]; hue?: number };
          return c.board.createGroup(name, cards, hue);
        }),
      },
      '/api/c/:project/groups/:id': {
        PATCH: on(async (c, req) => c.board.renameGroup(req.params.id!, (((await req.json()) ?? {}) as { name?: string }).name)),
        DELETE: on((c, req) => c.board.deleteGroup(req.params.id!)),
      },
      
      
      '/api/c/:project/canvases': {
        GET: on((c) => c.board.canvases()),
        POST: on(async (c, req) => {
          const { name, icon } = ((await req.json()) ?? {}) as { name?: unknown; icon?: unknown };
          return c.board.createCanvas(name, icon);
        }),
      },
      '/api/c/:project/canvases/:id': {
        PATCH: on(async (c, req) => c.board.updateCanvas(req.params.id!, ((await req.json()) ?? {}) as { name?: unknown; icon?: unknown; position?: unknown })),
        DELETE: on(async (c, req) => {
          const { moveTo, expected } = ((await req.json().catch(() => null)) ?? {}) as { moveTo?: unknown; expected?: { parked?: unknown; snoozed?: unknown } };
          return c.board.deleteCanvas(req.params.id!, moveTo, expected);
        }),
      },
      '/api/c/:project/canvases/:id/cards': {
        POST: on(async (c, req) => c.board.moveToCanvas((((await req.json()) ?? {}) as { cards?: unknown }).cards, req.params.id!)),
      },
      '/api/c/:project/assign': {
        POST: on(async (c, req) => {
          const { cards, group } = ((await req.json()) ?? {}) as { cards?: string[]; group?: string | null };
          return c.board.group(cards, group ?? null);
        }),
      },
      '/api/c/:project/dependencies': {
        POST: on(async (c, req) => { const { from, to, anchor } = await req.json() as { from: string; to: string; anchor?: import('../core/types').ManualAnchor }; c.board.connect(from, to, false, anchor); }),
        DELETE: on(async (c, req) => { const { from, to } = await req.json() as { from: string; to: string }; c.board.connect(from, to, true); }),
      },
      
      '/api/c/:project/archive': { GET: on((c) => c.board.archived()), POST: on((c) => ({ ids: c.board.archiveDone() })) },
      '/api/c/:project/cards/:id/act': {
        POST: on(async (c, req) => {
          const a = (await req.json()) as CardAction;
          
          if (a && V1_ACTIONS.has(a.action)) throw new BadRequest('invalid', `${a.action} goes through POST /api/v1/cards/:cardId/${a.action === 'force' ? 'start' : a.action}`);
          return c.press(req.params.id!, a);
        }),
      },
      
      '/api/c/:project/cards/:id/stand-in': { POST: on(async (c, req) => ({ result: await c.standIn(req.params.id!, (await req.json()) as Parameters<typeof c.standIn>[1]) })) },
      '/api/c/:project/cards/:id/events': { GET: on((c, req) => c.board.events(req.params.id!)) },
      
      '/api/c/:project/cards/:id/feedback': {
        GET: on((c, req) => c.board.feedback(req.params.id!)),
        POST: on(async (c, req) => c.board.giveFeedback(req.params.id!, await req.json().catch(() => null))),
      },
      
      '/api/c/:project/cards/:id/skills': { GET: on((c, req) => c.skillsOf(req.params.id!)) },
      
      '/api/c/:project/images': {
        POST: on(async (c, req) => ({ id: c.images.save(new Uint8Array(await req.arrayBuffer()), req.headers.get('content-type') ?? '') })),
      },
      
      '/api/c/:project/files': {
        POST: on(async (c, req) => {
          if (Number(req.headers.get('content-length')) > MAX_FILE_BYTES) throw new BadRequest('fileTooLarge', `a file may have at most ${MAX_FILE_BYTES} bytes`);
          return { path: c.files.save(new Uint8Array(await req.arrayBuffer()), new URL(req.url).searchParams.get('name') ?? '') };
        }),
      },
      
      '/api/c/:project/files/find': {
        POST: on(async (_c, req) => ({ path: await findDropped((await req.json()) as Dropped) })),
      },
      
      '/api/c/:project/files/local': {
        GET: on((_c, req) => {
          const image = localImage(new URL(req.url).searchParams.get('path') ?? '');
          if (!image) throw new BadRequest('imageType', 'no image on this machine');
          return new Response(Bun.file(image.file), { headers: { 'content-type': image.type, 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox' } });
        }),
      },
      '/api/c/:project/images/:file': {
        GET: (req) => {
          const file = byId.get(req.params.project)?.images.path(req.params.file);
          return file ? new Response(Bun.file(file), { headers: { 'cache-control': 'private, max-age=31536000, immutable' } }) : notFound();
        },
      },
      
      '/api/c/:project/cards/:id/diff': { GET: on((c, req) => c.diff(req.params.id!, new URL(req.url).searchParams.has('full'))) },
      
      '/api/c/:project/cards/:id/versions': {
        GET: on(async (c, req) => {
          const q = new URL(req.url).searchParams;
          const v = await c.cardFileVersions(req.params.id!, q.get('path') ?? '');
          
          return v && q.has('probe') ? { old: v.old !== null, new: v.new !== null } : v;
        }),
      },
      
      '/api/c/:project/cards/:id/app': { GET: on((c, req) => c.appUp(req.params.id!)) },
      '/api/c/:project/cards/:id/app/open': {
        GET: async (req) => {
          const c = byId.get(req.params.project);
          if (!c) return notFound();
          let url: string | null = null;
          try {
            url = await c.openApp(req.params.id);
          } catch (e) {
            if (!(e instanceof BadRequest)) throw e;
          }
          return url ? Response.redirect(url, 302) : new Response(c.board.t.worker.appGone, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
        },
      },
      '/api/c/:project/cards/:id/plan': { GET: on((c, req) => c.board.planDoc(req.params.id!)) },
      
      '/api/c/:project/cards/:id/history': { GET: on((c, req) => c.board.planHistory(req.params.id!)) },
      
      '/api/mock-frame': { GET: () => serveMockFrame() },
      
      '/api/c/:project/cards/:id/demo/*': {
        GET: (req) => {
          try {
            const demo = byId.get(req.params.project)?.board.demoFiles(req.params.id);
            const file = decodeURIComponent(new URL(req.url).pathname.split('/demo/').slice(1).join('/demo/'));
            return demo ? serveDemoFile(demo, file, req) : notFound();
          } catch {
            return notFound();
          }
        },
      },
      
      '/api/c/:project/cards/:id/demos/:n/*': {
        GET: (req) => {
          try {
            const n = Number(req.params.n);
            const demo = Number.isInteger(n) && n >= 0 ? byId.get(req.params.project)?.board.demoFiles(req.params.id, n) : null;
            const route = `/demos/${n}/`;
            const file = decodeURIComponent(new URL(req.url).pathname.split(route).slice(1).join(route));
            return demo ? serveDemoFile(demo, file, req, route) : notFound();
          } catch {
            return notFound();
          }
        },
      },
      
      '/api/c/:project/cards/:id/files/*': {
        GET: (req) => {
          try {
            const c = byId.get(req.params.project);
            const url = new URL(req.url);
            const file = decodeURIComponent(url.pathname.split('/files/').slice(1).join('/files/'));
            return c ? serveCardFile(file, url.searchParams.has('download'), req, (path) => c.cardFile(req.params.id, path)).catch(() => notFound()) : notFound();
          } catch {
            return notFound();
          }
        },
      },
      
      '/api/c/:project/cards/:id/open': {
        POST: (req, srv) =>
          access.isLocal(req, srv)
            ? on(async (c, req) => {
                const { file, show } = (await req.json().catch(() => ({}))) as { file?: string; show?: boolean };
                if (typeof file !== 'string') throw new BadRequest('invalid', 'file must be a path');
                await c.openCardFile(req.params.id!, file, show === true);
              })(req)
            : onlyHere(),
      },
      
      '/api/c/:project/threads/:thread/card': { POST: on((c, req) => c.answers.toCard(Number(req.params.thread))) },
      
      '/api/c/:project/threads/:thread/files/*': {
        GET: (req) => {
          try {
            const c = byId.get(req.params.project);
            const url = new URL(req.url);
            const file = decodeURIComponent(url.pathname.split('/files/').slice(1).join('/files/'));
            return c ? serveAnswerFile(c.answerDir(Number(req.params.thread)), file, url.searchParams.has('download'), req) : notFound();
          } catch {
            return notFound();
          }
        },
      },
      
      '/api/c/:project/threads/:thread/open': {
        POST: (req, srv) =>
          access.isLocal(req, srv)
            ? on(async (c, req) => {
                const { file } = (await req.json().catch(() => ({}))) as { file?: string };
                await c.openAnswerFile(Number(req.params.thread), file);
              })(req)
            : onlyHere(),
      },
      
      '/api/app-update': {
        GET: () => Response.json(updates.current()),
        POST: async (req) =>
          handle(async () => {
            const body = await req.json();
            
            if (body?.rebuilt === true) return (restarter?.request('update'), { updating: !!restarter });
            return updates.report(body);
          }),
      },
      
      
      
      '/api/app-takeover': {
        POST: () =>
          handle(() => {
            
            restarter?.request('takeover');
            return { taking: !!restarter };
          }),
      },
      
      
      
      '/api/app-rebuilt': {
        POST: (req) =>
          handle(async () => {
            const { kept } = ((await req.json().catch(() => null)) ?? {}) as { kept?: unknown };
            return { now: !restarter?.owner().length, kept: handOver.has(handOverScope(req), kept) };
          }),
      },
      
      '/api/app-rebuilt/handover': {
        GET: (req) => Response.json(handOver.read(handOverScope(req))),
        POST: (req) => handle(async () => (handOver.give(handOverScope(req), await req.json()), { ok: true })),
        DELETE: (req) => (handOver.taken(handOverScope(req), new URL(req.url).searchParams.get('token')), new Response(null, { status: 204 })),
      },
      
      '/api/app-update/install': {
        POST: () =>
          handle(() => {
            const update = updates.current();
            if (!restarter || !update || update.download) throw new BadRequest('invalid', 'no update the app can install');
            
            setTimeout(() => restarter.request('update'), 100);
            return { updating: true };
          }),
      },
      
      '/api/source-update': { GET: () => Response.json(sources?.current() ?? null) },
      
      '/api/source-update/pull': { POST: needs(sources, async (s) => (await s.pull(), { source: s.current() })) },
      
      '/api/c/:project/cards/:id/export': {
        GET: on(async (c, req) => {
          const as = new URL(req.url).searchParams.get('as');
          if (as !== 'zip' && as !== 'html') throw new BadRequest('invalid', 'as must be zip or html');
          
          const demo = Number(new URL(req.url).searchParams.get('demo') ?? NaN);
          const f = await c.sharing.export(req.params.id!, as, Number.isInteger(demo) ? demo : undefined);
          return new Response(f.data, { headers: { 'content-type': f.type, 'content-disposition': `attachment; filename="${f.name}"`, 'cache-control': 'no-store' } });
        }),
      },
      
      
      '/api/c/:project/voice': {
        POST: on(holdingRestart(async (c, req) => {
          
          const params = new URL(req.url).searchParams;
          const images = params.getAll('image');
          c.images.resolve(images);
          
          
          const replyTo = replyParam(params.get('replyTo'));
          const form = req.headers.get('content-type')?.startsWith('multipart/form-data') ? await req.formData() : null;
          const audio = form ? form.get('audio') : await req.blob();
          if (!(audio instanceof Blob)) throw new BadRequest('invalid', 'audio expected');
          arrive(params.get('sent'));
          
          const field = form?.get('text');
          const typed = typeof field === 'string' ? field.replace(/\r\n/g, '\n') : undefined;
          let text: string | null;
          try {
            text = await transcribe(c, audio);
          } catch (e) {
            
            if (!(e instanceof CloudError)) throw e;
            console.error(`voice on ${c.id}: ${e.service} failed: ${e.message}`);
            return { confirm: c.board.t.voice.cloudFailed(e.service, e.message), unheard: true };
          }
          
          if (params.has('listen')) {
            console.log(`dictated on ${c.id}: ${text === null ? '(not understood)' : text || '(nothing)'}`);
            return text ? { confirm: '', quiet: true, text } : unheard(c, text);
          }
          
          const words = text && typed?.trim() ? `${typed.trim()}${/\n/.test(typed.trim()) ? '\n\n' : ' '}${text}` : text;
          
          const at = params.get('at');
          const demo = Number(params.get('demo') || NaN);
          const spot = at !== null && at !== '' ? { at: Number(at), ...(params.get('still') ? { still: params.get('still')! } : {}), ...(Number.isInteger(demo) ? { demo } : {}) } : undefined;
          return heard(c, words, focusOf(req, c), images, { ...(replyTo ? { replyTo } : {}), ...(spot ? { spot } : {}) });
        })),
      },
      
      
      '/api/c/:project/voice/arrived/:id': { GET: on((_c, req) => ({ arrived: arrived.has(req.params.id!) })) },
      '/api/c/:project/voice/warm': {
        POST: on((c) => {
          transcriber.warm?.();
          c.commander.warm();
        }),
      },
      '/api/c/:project/command': {
        POST: on(async (c, req) => {
          
          
          
          const { text, images, field, replyTo, spot, chat, requestId } = (await req.json()) as { text: string; images?: string[]; field?: unknown; replyTo?: unknown; spot?: SpotInput; chat?: number; requestId?: unknown };
          if (chat !== undefined && (!Number.isSafeInteger(chat) || !c.board.hasChat(chat))) throw new BadRequest('invalid', 'chat must belong to this project');
          if (requestId !== undefined && (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))) throw new BadRequest('invalid', 'invalid request id');
          
          const card = focusOf(req).card;
          const open = card ? c.board.item(card) : undefined;
          const toAgent = !!open && listens(open, isField(field) ? { field } : {});
          if (typeof text !== 'string' || (!text.trim() && !(toAgent && images?.length))) throw new BadRequest('emptyText', 'text must be a non-empty string');
          
          c.images.resolve(images);
          return heard(c, text.trim(), focusOf(req, c), images ?? [], { typed: true, ...(typeof requestId === 'string' ? { requestId } : {}), ...(chat !== undefined ? { chat } : {}), ...(isField(field) ? { field } : {}), ...(typeof replyTo === 'number' || isTalkRef(replyTo) ? { replyTo } : {}), ...(spot ? { spot } : {}) });
        }),
      },
      
      '/api/c/:project/wish': {
        POST: on(async (c, req) => {
          const { said, answer, title, body, images, app } = ((await req.json()) ?? {}) as Record<string, unknown>;
          if (typeof said !== 'string' || !said.trim()) throw new BadRequest('emptyText', 'said must be a non-empty string');
          const ids = Array.isArray(images) ? images.filter((i): i is string => typeof i === 'string') : [];
          const server = config?.view().server;
          return c.writeWish(
            { said, ...(typeof answer === 'string' ? { answer } : {}), ...(typeof title === 'string' ? { title } : {}), ...(typeof body === 'string' ? { body } : {}) },
            footerOf(server?.version ?? VERSION, server?.commit ?? null, app === true),
            ids,
          );
        }),
      },
      '/api/c/:project/command/undo': {
        POST: on(async (c, req) => click(c, { undone: c.commander.undo(((await req.json()) as { token: string }).token) })),
      },
      '/api/c/:project/preferences': {
        POST: on(async (c, req) => {
          const { text, target } = (await req.json()) as { text: string; target?: string };
          c.remember(text, target ? { repos: [target] } : {});
        }),
      },
      '/api/c/:project/preferences/:id': {
        PATCH: on(async (c, req) => c.board.setPreference(Number(req.params.id), ((await req.json()) as { text: string }).text)),
        DELETE: on((c, req) => c.board.setPreference(Number(req.params.id), null)),
      },
      '/api/c/:project/preferences/:id/accept': {
        POST: on(async (c, req) => {
          const { text, target } = (await req.json().catch(() => ({}))) as { text?: string; target?: string | null };
          return click(c, c.acceptRule(Number(req.params.id), text, target));
        }),
      },
      '/api/c/:project/preferences/:id/reject': { POST: on((c, req) => click(c, c.rejectRule(Number(req.params.id)))) },
      
      '/api/c/:project/setting-proposals/:id/take': {
        POST: on(async (c, req) => {
          const { where, value } = (await req.json().catch(() => ({}))) as { where?: unknown; value?: unknown };
          return click(c, (await c.takeSetting(Number(req.params.id), where, value)) ?? {});
        }),
      },
      '/api/c/:project/setting-proposals/:id/reject': { POST: on((c, req) => click(c, c.rejectSetting(Number(req.params.id)))) },
      
      '/api/c/:project/reshare': {
        POST: on(async (c, req) => {
          const { count, tags } = (await req.json().catch(() => ({}))) as { count?: number | null; tags?: unknown };
          if (count != null && !(Number.isInteger(count) && count > 0)) throw new BadRequest('invalid', 'count must be a positive integer or null');
          
          c.sharing.reshareMany(count ?? null, tags === true);
        }),
        
        DELETE: on((c) => c.sharing.dismissResharing()),
      },
      '/api/c/:project/reshare/stop': { POST: on((c) => c.sharing.stopResharing()) },
      
      '/api/c/:project/cards/:id/demo-rebuilt': { POST: on((c, req) => c.sharing.rebuilt(req.params.id!)) },
      
      '/api/c/:project/talk/read': {
        POST: on(async (c, req) => {
          const { ids } = (await req.json().catch(() => ({}))) as { ids?: unknown };
          if (ids !== undefined && !(Array.isArray(ids) && ids.every((i) => Number.isInteger(i)))) throw new BadRequest('invalid', 'ids must be a list of exchange ids');
          c.board.readTalk(ids as number[] | undefined);
        }),
      },
      
      '/api/c/:project/chat': {
        POST: on(async (c, req) => {
          const { id } = (await req.json().catch(() => ({}))) as { id?: unknown };
          if (id === undefined) return { chat: c.board.newChat() };
          if (!Number.isInteger(id)) throw new BadRequest('invalid', 'id must be a chat id');
          c.board.openChat(id as number);
          return { chat: id };
        }),
      },
      '/api/c/:project/chat/model': {
        POST: on(async (c, req) => {
          const { model, chat } = (await req.json().catch(() => ({}))) as { model?: unknown; chat?: number };
          if (typeof chat !== 'number' || !Number.isSafeInteger(chat) || !c.board.hasChat(chat)) throw new BadRequest('invalid', 'chat must belong to this project');
          if (model !== null && model !== undefined && (typeof model !== 'string' || !['default', 'fable', 'opus', 'sonnet', 'haiku'].includes(model) && !/^(?:codex|agy):[A-Za-z0-9_.:/-]{1,200}$/.test(model))) throw new BadRequest('invalid', 'unknown model');
          c.board.setChatModel(model == null ? undefined : model as import('../core/types').ChatModel, chat);
        }),
      },
      '/api/c/:project/talk/:id/unwait': {
        POST: on(async (c, req) => ({ stopped: c.commander.unwait(Number(req.params.id), String(((await req.json().catch(() => ({}))) as { card?: unknown }).card ?? '')) })),
      },
      '/api/c/:project/ws': (req, server) =>
        byId.has(req.params.project) && server.upgrade(req, { data: { project: req.params.project, page: crypto.randomUUID(), device: access.deviceOf(req) } })
          ? undefined
          : new Response('WebSocket expected', { status: 400 }),
    }, access),
    fetch: (req: Request, srv: Bun.Server<Socket>) => refusal(req, access.hosts()) ?? access.admit(req, srv, '') ?? notFound(),
    websocket: {
      data: {} as Socket,
      open: (ws: ServerWebSocket<Socket>) => {
        const c = byId.get(ws.data.project);
        if (!c) return ws.close();
        sockets.get(c.id)!.add(ws);
        ws.send(JSON.stringify({ type: 'hello', server: started, ...(oldLinuxBun() ? { oldBun: Bun.version } : {}) } satisfies ServerMessage));
        
        ws.send(JSON.stringify({ type: 'restart', restart: pending(c.id) } satisfies ServerMessage));
        ws.send(JSON.stringify({ type: 'update', update: updates.current() } satisfies ServerMessage));
        ws.send(JSON.stringify({ type: 'source', source: sources?.current() ?? null } satisfies ServerMessage));
        ws.send(usageMessage());
        if (usage.length) {
          const closed = usage.map((m) => m.watch());
          unwatch.set(ws.data.page, () => closed.forEach((f) => f()));
        }
        
        
        ws.send(projectsMessage(projectList()));
        ws.send(JSON.stringify({ type: 'snapshot', snapshot: c.board.snapshot() } satisfies ServerMessage));
        ws.send(waitingMessage());
        
        for (const n of c.commander.undoable()) ws.send(JSON.stringify({ type: 'notice', ...n } satisfies ServerMessage));
      },
      close: (ws: ServerWebSocket<Socket>) => {
        sockets.get(ws.data.project)?.delete(ws);
        unwatch.get(ws.data.page)?.();
        unwatch.delete(ws.data.page);
        restarter?.hold(ws.data.page);
        
        const { device } = ws.data;
        if (device && ![...sockets.values()].some((set) => [...set].some((w) => w.data.device === device))) push.away(device);
      },
      
      message: (ws: ServerWebSocket<Socket>, text: string | Buffer) => {
        try {
          const msg = JSON.parse(String(text)) as ClientMessage;
          if (msg.type === 'ping') return void ws.send(JSON.stringify({ type: 'pong' } satisfies ServerMessage));
          if (msg.type === 'hold' && Array.isArray(msg.hold)) restarter?.hold(ws.data.page, msg.hold.filter((h) => h === 'video' || h === 'voice'));
          if (msg.type === 'back') byId.get(ws.data.project)?.ownerBack();
          
          if (msg.type === 'back') void sources?.check(false);
          
          const { device } = ws.data;
          if (device && (msg.type === 'back' || msg.type === 'here')) push.onDevice(device);
          if (msg.type === 'away' && device) push.away(device);
          if (msg.type === 'stall') {
            const stall = pageStall(msg);
            const { device } = ws.data;
            const where = `${device ? (access.devices().find((d) => d.id === device)?.name ?? 'another device') : 'this machine'}, project ${ws.data.project}`;
            if (stall) stalls?.page(stall, where, ws.data.page);
          }
          if (msg.type === 'focus') {
            const seen = parsePlace(typeof msg.place === 'string' ? msg.place : undefined);
            const c = byId.get(ws.data.project);
            if (seen && c) c.inView = seen;
          }
        } catch {}
      },
    },
  };
  const server = Bun.serve(options);
  serving(server, access.owner);
  
  let other: Bun.Server<Socket> | null = null;
  void access
    .start(server.port!, (address) => {
      other?.stop(true);
      other = address ? Bun.serve({ ...options, hostname: address, port: server.port! }) : null;
    })
    .then(() => {
      const address = access.address();
      if (address) console.log(`Seismic: other devices reach it at ${address}`);
    });
  return server;
}

/** Pushes go to a paired device: the machine Seismic runs on gets none. */
const onlyDevices = () => Response.json({ code: 'onlyDevices', error: 'only a paired device gets pushes' }, { status: 403 });

const onlyHere = () => Response.json({ code: 'onlyHere', error: 'only on the machine Seismic runs on' }, { status: 403 });
