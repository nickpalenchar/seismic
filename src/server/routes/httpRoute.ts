import { BadRequest } from '../board';
import { NotFound } from '../notFound';

export type RouteRequest = Request & { params: Record<string, string> };

type Handler = (request: RouteRequest) => unknown | Promise<unknown>;
type BunHandler = (request: RouteRequest) => Promise<Response>;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = (typeof METHODS)[number];

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

/**
 * One URL and the methods that answer it. A route is given what it needs in its own constructor
 * (the services, as whole objects); this class holds none of them.
 */
export abstract class HttpRoute {
  abstract readonly path: string;
  GET?: Handler;
  POST?: Handler;
  PUT?: Handler;
  PATCH?: Handler;
  DELETE?: Handler;

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
