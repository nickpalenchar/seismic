/**
 * The base of a route of Seismic's HTTP API: one URL with the methods it answers. A route's file
 * mirrors its URL under `routes/` (`:x` → `_x`, the last segment is the file); `toBun` turns it
 * into the entry `Bun.serve` takes. What a handler returns goes out as JSON, `undefined` as a 204,
 * and a `BadRequest` or `NotFound` it throws as `{ code, error }`.
 */
import { BadRequest } from '../board';
import type { ProjectRuntime } from '../project';
import { NotFound } from './notFound';

/** A request with the params of its route's URL. */
export type RouteRequest = Request & { params: Record<string, string> };

type Handler = (request: RouteRequest) => unknown | Promise<unknown>;
type BunHandler = (request: RouteRequest) => Promise<Response>;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = (typeof METHODS)[number];

/** What the routes need of the server: the project runtime a card is on. */
export interface RouteDependencies {
  projectOfCard: (cardId: string) => ProjectRuntime | undefined;
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

  /** The project of the card the URL names (`:cardId`); an unknown card is a 404. */
  protected projectOfCard(request: RouteRequest): ProjectRuntime {
    const project = this.dependencies.projectOfCard(request.params.cardId ?? '');
    if (!project) throw new NotFound('unknownCard', 'unknown card');
    return project;
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
