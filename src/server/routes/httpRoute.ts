/**
 * The base of a route of Seismic's HTTP API: one URL with the methods it answers. A route's file
 * mirrors its URL under `routes/` (`:x` → `_x`, the last segment is the file); `toBun` turns it
 * into the entry `Bun.serve` takes. What a handler returns goes out as JSON, `undefined` as a 204,
 * and a `BadRequest` or `NotFound` it throws as `{ code, error }`.
 */
import { BadRequest } from '../board';
import type { OwnerSettings } from '../ownerSettings';
import type { ProjectRuntime } from '../project';
import { NotFound } from './notFound';

/** A request with the params of its route's URL. */
export type RouteRequest = Request & { params: Record<string, string> };

type Handler = (request: RouteRequest) => unknown | Promise<unknown>;
type BunHandler = (request: RouteRequest) => Promise<Response>;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = (typeof METHODS)[number];

/** What the routes need of the server: the project runtime a card is on (`deleted`: also one deleted, to be restored). */
export interface RouteDependencies {
  projectOfCard: (cardId: string, options?: { deleted?: boolean }) => ProjectRuntime | undefined;
  /** The owner's system-level settings; none where Seismic runs without a configuration of its own. */
  ownerSettings?: OwnerSettings;
}

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
  /** The URL as `Bun.serve` matches it (`/api/v1/cards/:cardId/share`). */
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

  /** The owner's settings; a Seismic without a configuration of its own has none to show. */
  protected get settings(): OwnerSettings {
    const settings = this.dependencies.ownerSettings;
    if (!settings) throw new NotFound('noSettings', 'this Seismic keeps no settings of its own');
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
