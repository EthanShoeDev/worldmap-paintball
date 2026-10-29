import {
  ClientOnly,
  type ErrorComponentProps,
  type SearchSchemaInput,
  createFileRoute,
} from '@tanstack/react-router';
import { isCovered } from '@worldmap-paintball/api-contract/coverage';
import { Result, Schema } from 'effect';
import { lazy, Suspense } from 'react';

import {
  OutsideCoverageNotice,
  PlayError,
} from '../components/play-notice.tsx';
import { maxPracticeBots } from '../game/tuning.ts';
import { Coordinates } from '../location/coordinates.ts';

const PlayAt = lazy(() =>
  // dynamic-import -- keeps the browser-only game out of the server bundle.
  import('../game/play-page.tsx').then((module) => ({
    default: module.PlayAt,
  })),
);

const PlaySearch = Schema.Struct({
  ...Coordinates.fields,
  // Optional, not optionalKey: rawSearch passes a missing value as undefined.
  bots: Schema.optional(
    Schema.Int.check(
      Schema.isBetween({ minimum: 0, maximum: maxPracticeBots }),
    ),
  ),
});
type PlaySearch = typeof PlaySearch.Type;

const decodeSearch = Schema.decodeUnknownResult(PlaySearch);

// Failing here would make SSR answer 500 instead of rendering the error UI,
// and the router merges whatever this returns back into the URL, so it passes
// the raw values through and <Play> validates them.
const rawSearch = ({
  lat,
  lon,
  bots,
}: PlaySearch & SearchSchemaInput): Readonly<
  Record<keyof PlaySearch, unknown>
> => ({ lat, lon, bots });

const RouteError = ({ error }: ErrorComponentProps) => (
  <PlayError error={error} />
);

const Play = () => {
  const search = decodeSearch(Route.useSearch());
  if (Result.isFailure(search)) {
    return <PlayError error={new Error(search.failure.message)} />;
  }
  const { lat, lon, bots = 0 } = search.success;
  if (!isCovered(lat, lon)) return <OutsideCoverageNotice />;
  return (
    <ClientOnly>
      <Suspense>
        <PlayAt
          key={`${lat},${lon},${bots}`}
          coordinates={{ lat, lon }}
          bots={bots}
        />
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
