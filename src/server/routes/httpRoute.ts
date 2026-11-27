





import { BadRequest } from '../board';
import type { CardAction, Item, ModelInfo } from '../../core/types';
import type { Config } from '../config';
import type { OwnerSettings } from '../ownerSettings';
import type { ProjectRuntime } from '../project';
import type { HintsService } from '../services/hintsService';
import { NotFound } from './notFound';


export type RouteRequest = Request & { params: Record<string, string> };

type Handler = (request: RouteRequest) => unknown | Promise<unknown>;
type BunHandler = (request: RouteRequest) => Promise<Response>;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = (typeof METHODS)[number];


export interface RouteDependencies {
  projectOfCard: (cardId: string, options?: { deleted?: boolean }) => ProjectRuntime | undefined;
  
  projectById: (projectId: string) => ProjectRuntime | undefined;

  projectOfChat: (chatId: number) => ProjectRuntime | undefined;

  allProjects: () => ProjectRuntime[];

  ownerSettings?: OwnerSettings;

  hints: HintsService;
  
  configuration?: Config;

  agentModels?: (harness: AgentHarness) => Promise<ModelInfo[]>;
}

export type AgentHarness = 'codex' | 'agy';

/** The answer to a request: `fn`'s result as JSON, or its refusal. */
export async function respond(fn: () => unknown | Promise<unknown>): Promise<Response> {
  try {
    const out = await fn();
    if (out instanceof Response) return out;
    return out === undefined || out === null ? new Response(null, { status: 204 }) : Response.json(out);
  } catch (e) {
    if (e instanceof BadRequest) return Response.json({ code: e.code, error: e.message }, { status: 400 });
    if (e instanceof NotFound) return Response.json({ code: e.code, error: e.message }, { status: 404 });
    if (e instanceof SyntaxError) return Response.json({ code: 'invalid', error: 'invalid JSON' }, { status: 400 });
    throw e;
  }
}

export abstract class HttpRoute {
  
  abstract readonly path: string;
  GET?: Handler;
  POST?: Handler;
  PUT?: Handler;
  PATCH?: Handler;
  DELETE?: Handler;

  constructor(protected readonly dependencies: RouteDependencies) {}

  /** The project of the card the URL names (`:cardId`); an unknown card is a 404, a deleted one too unless `deleted`. */
  protected projectOfCard(request: RouteRequest, options?: { deleted?: boolean }): ProjectRuntime {
    const project = this.dependencies.projectOfCard(request.params.cardId ?? '', options);
    if (!project) throw new NotFound('unknownCard', 'unknown card');
    return project;
  }

  /** The owner's action on the card the URL names, run as a click; answered with the card as it then stands. */
  protected async pressCard(request: RouteRequest, action: CardAction): Promise<{ card: Item }> {
    const project = this.projectOfCard(request);
    const cardId = request.params.cardId!;
    await project.press(cardId, action);
    return { card: project.board.card(cardId)! };
  }

  /** The project the id names (`?project=`); none or an unknown one is a 404. */
  protected projectOfId(projectId: string | null): ProjectRuntime {
    const project = projectId ? this.dependencies.projectById(projectId) : undefined;
    if (!project) throw new NotFound('unknownProject', 'unknown project');
    return project;
  }

  /** The project of the chat the URL names (`:chatId`) and the chat's id; an unknown chat is a 404. */
  protected projectOfChat(request: RouteRequest): { project: ProjectRuntime; chat: number } {
    const chat = Number(request.params.chatId);
    const project = Number.isSafeInteger(chat) ? this.dependencies.projectOfChat(chat) : undefined;
    if (!project) throw new NotFound('unknownChat', 'unknown chat');
    return { project, chat };
  }

  /** The model catalogs of the harnesses; a Seismic without a configuration of its own has none. */
  protected get agentModels(): NonNullable<RouteDependencies['agentModels']> {
    const models = this.dependencies.agentModels;
    if (!models) throw new NotFound('noConfiguration', 'this Seismic keeps no settings of its own');
    return models;
  }

  /** The owner's settings; a Seismic without a configuration of its own has none to show. */
  protected get settings(): OwnerSettings {
    const settings = this.dependencies.ownerSettings;
    if (!settings) throw new NotFound('noConfiguration', 'this Seismic keeps no settings of its own');
    return settings;
  }

  /** The request's JSON object; none sent is `{}`. Anything but an object is refused. */
  protected async bodyOf(request: RouteRequest): Promise<Record<string, unknown>> {
    const text = await request.text();
    if (!text.trim()) return {};
    const body = JSON.parse(text) as unknown;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new BadRequest('invalid', 'the body must be an object');
    return body as Record<string, unknown>;
  }

  /** The methods this route answers, as `Bun.serve` takes them. */
  toBun(): Partial<Record<Method, BunHandler>> {
    const out: Partial<Record<Method, BunHandler>> = {};
    for (const method of METHODS) {
      const handler = this[method];
      if (handler) out[method] = (request) => respond(() => handler.call(this, request));
    }
    return out;
  }
}

/** The routes as one object of `Bun.serve`'s `routes`; two routes with one URL are a mistake. */
export function bunRoutes(routes: HttpRoute[]): Record<string, ReturnType<HttpRoute['toBun']>> {
  const out: Record<string, ReturnType<HttpRoute['toBun']>> = {};
  for (const route of routes) {
    if (out[route.path]) throw new Error(`duplicate route: ${route.path}`);
    out[route.path] = route.toBun();
  }
  return out;
}
