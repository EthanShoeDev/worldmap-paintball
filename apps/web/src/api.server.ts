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

// Outside a page request (tests, prerendering) there is no cookie to forward.
const pageCookie = () => {
  try {
    return getRequestHeaders().get('cookie');
  } catch {
    return null;
  }
};

// Server rendering calls the API in this process: no network hop, and no need
// to know the page's own origin. The page request's cookie goes along, so the
// API sees the same session as the browser's own requests.
export const inProcessFetch = (
  ...args: ConstructorParameters<typeof Request>
) => {
  const request = new Request(...args);
  const cookie = pageCookie();
  if (cookie !== null) request.headers.set('cookie', cookie);
  return apiHandler(request);
};
