import { getRequestHeaders } from '@tanstack/react-start/server';
import {
  type ApiBackends,
  ApiRoutes,
  LocalBackends,
} from '@worldmap-paintball/api/handlers';
import { Layer } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';

const makeApiHandler = (backends: Layer.Layer<ApiBackends>) =>
  HttpRouter.toWebHandler(
    ApiRoutes.pipe(Layer.provide([backends, HttpServer.layerServices])),
  ).handler;

let handler: ((request: Request) => Promise<Response>) | undefined;

// The Cloudflare Worker (src/worker.server.ts) calls this with its Durable
// Object backends before Start sees a request. Everywhere else (`vite dev`,
// tests) the first request builds the API on the in-memory backends.
export const serveApiOn = (backends: Layer.Layer<ApiBackends>) => {
  handler ??= makeApiHandler(backends);
};

export const apiHandler = (request: Request) => {
  handler ??= makeApiHandler(LocalBackends);
  return handler(request);
};

// The handler routes by path, so the origin is a placeholder.
export const inProcessOrigin = 'http://in-process';

// Outside a page request (tests, prerendering) there are no headers to
// forward.
const pageHeader = (name: string) => {
  try {
    return getRequestHeaders().get(name);
  } catch {
    return null;
  }
};

// Server rendering calls the API in this process: no network hop, and no need
// to know the page's own origin. The page request's cookie and client IP go
// along, so the API sees the same session and rate limit key as the
// browser's own requests.
export const inProcessFetch = (
  ...args: ConstructorParameters<typeof Request>
) => {
  const request = new Request(...args);
  for (const name of ['cookie', 'cf-connecting-ip']) {
    const value = pageHeader(name);
    if (value !== null) request.headers.set(name, value);
  }
  return apiHandler(request);
};
