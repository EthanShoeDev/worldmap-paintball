import {
  ClientOnly,
  type ErrorComponentProps,
  type SearchSchemaInput,
  createFileRoute,
} from '@tanstack/react-router';
import { Result, Schema } from 'effect';
import { lazy, Suspense } from 'react';

import { PlayError } from '../components/play-notice.tsx';
import { Coordinates } from '../location/coordinates.ts';

const PlayAt = lazy(() =>
  // dynamic-import -- keeps the browser-only game out of the server bundle.
  import('../game/play-page.tsx').then((module) => ({
    default: module.PlayAt,
  })),
);

const decodeCoordinates = Schema.decodeUnknownResult(Coordinates);

// Failing here would make SSR answer 500 instead of rendering the error UI,
// and the router merges whatever this returns back into the URL, so it passes
// the raw values through and <Play> validates them.
const rawSearch = ({
  lat,
  lon,
}: Coordinates & SearchSchemaInput): Readonly<
  Record<keyof Coordinates, unknown>
> => ({ lat, lon });

const RouteError = ({ error }: ErrorComponentProps) => (
  <PlayError error={error} />
);

const Play = () => {
  const coordinates = decodeCoordinates(Route.useSearch());
  if (Result.isFailure(coordinates)) {
    return <PlayError error={new Error(coordinates.failure.message)} />;
  }
  const { lat, lon } = coordinates.success;
  return (
    <ClientOnly>
      <Suspense>
        <PlayAt key={`${lat},${lon}`} coordinates={coordinates.success} />
      </Suspense>
    </ClientOnly>
  );
};

export const Route = createFileRoute('/play')({
  ssr: false,
  validateSearch: rawSearch,
  component: Play,
  errorComponent: RouteError,
});
