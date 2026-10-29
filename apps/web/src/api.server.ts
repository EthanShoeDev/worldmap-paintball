import { getRequestHeaders } from '@tanstack/react-start/server';
import { ApiLive } from '@worldmap-paintball/api/handlers';
import { Layer } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';

export const { handler: apiHandler } = HttpRouter.toWebHandler(
  ApiLive.pipe(Layer.provide(HttpServer.layerServices)),
);

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
export const inProcessFetch: typeof fetch = (input, init) => {
  const request = new Request(input, init);
  const cookie = pageCookie();
  if (cookie !== null) request.headers.set('cookie', cookie);
  return apiHandler(request);
};
