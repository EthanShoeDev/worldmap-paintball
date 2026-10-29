import start from '@tanstack/react-start/server-entry';
import type { ApiBackends } from '@worldmap-paintball/api/handlers';
import type { Layer } from 'effect';

import { serveApiOn } from './api.server.ts';

// Start's request handler on Cloudflare, with the API (its /api/$ route and
// server rendering's in-process calls) on the Worker's Durable Objects.
export const serve = (request: Request, backends: Layer.Layer<ApiBackends>) => {
  serveApiOn(backends);
  return Promise.resolve(start.fetch(request));
};
