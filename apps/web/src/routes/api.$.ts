import { createFileRoute } from '@tanstack/react-router';

import { apiHandler } from '../api.server.ts';

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: { ANY: ({ request }) => apiHandler(request) },
  },
});
