import { ClientOnly, createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';

import { cleanLobbyCode } from '../components/lobby-helpers.ts';

// Browser-only, so the server bundle never imports it.
const LobbyPage = lazy(() =>
  // dynamic-import -- keeps browser-only modules out of the server bundle.
  import('../components/lobby-page.tsx').then((module) => ({
    default: module.LobbyPage,
  })),
);

const LobbyRoute = () => {
  const { code } = Route.useParams();
  return (
    <ClientOnly>
      <Suspense>
        <LobbyPage code={code} />
      </Suspense>
    </ClientOnly>
  );
};

export const Route = createFileRoute('/lobby/$code')({
  ssr: false,
  params: {
    parse: ({ code }) => ({ code: cleanLobbyCode(code) }),
    stringify: ({ code }) => ({ code }),
  },
  component: LobbyRoute,
});
