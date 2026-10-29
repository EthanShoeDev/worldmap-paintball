import '@tanstack/react-start/client-only';
import {
  useAtom,
  useAtomRefresh,
  useAtomSet,
  useAtomValue,
} from '@effect/atom-react';
import { MapControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import {
  type Arena,
  type ArenaLayer,
  arenaHalfSizes,
  ArenaSize,
} from '@worldmap-paintball/api-contract';
import {
  ArenaShape,
  defaultMapSettings,
  type DrawnBuilding,
  type Lobby,
  MAX_DRAWN_BUILDINGS,
  type MapSettings,
} from '@worldmap-paintball/api-contract/lobby';
import { Array as Arr, Effect, Equal, Fiber, Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import {
  type MouseEvent,
  type ReactNode,
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { type ArenaQuery, arenaAtom } from '../api-client.ts';
import { lobbyMessages, sendLobbyAtom } from '../lobby/lobby-atoms.ts';
import type { Coordinates } from '../location/coordinates.ts';
import { warmArenaAtom } from '../location/location-atoms.ts';
import {
  rememberMap,
  savedMapAt,
  savedMapsAtom,
} from '../location/saved-atoms.ts';
import { insideRing } from './arena-meshes.ts';
import { ArenaScene, ArenaTrees } from './arena-scene.tsx';
import { paintGround, paintPlan } from './ground-texture.ts';
import { imageryAtom, photoOf } from './imagery.ts';
import { customArenaAtom, customizeArena } from './map-settings.ts';
import { SkyDome } from './sky-dome.tsx';
import { hazeColor } from './tuning.ts';

type Point = readonly [number, number];

const planSize = 1024;
const maxCorners = 24;
// How close, in screen pixels, a click must land to the first corner to
// close the outline.
const closeRadius = 12;
const maxElevationScale = 4;
const storyHeight = (stories: number) => 1 + stories * 3;

const ArenaView = ({ arena }: { readonly arena: Arena }) => {
  const sun = [arena.halfSize * 0.5, 200, arena.halfSize * 0.3] as const;
  return (
    <Canvas
      shadows
      camera={{
        fov: 50,
        near: 1,
        far: 3000,
        position: [0, arena.halfSize * 1.1, arena.halfSize * 1.3],
      }}
    >
      <color attach='background' args={[hazeColor]} />
      <SkyDome sun={sun} />
      <hemisphereLight args={['#dfefff', '#8a7f6a', 0.9]} />
      <directionalLight position={sun} intensity={2.2} />
      <Suspense fallback={null}>
        {/* The arena's colliders need a physics world; it never steps. */}
        <Physics paused>
          <ArenaScene arena={arena} />
          <ArenaTrees arena={arena} />
        </Physics>
      </Suspense>
      <MapControls
        makeDefault
        maxPolarAngle={Math.PI / 2.2}
        maxDistance={arena.halfSize * 4}
      />
    </Canvas>
  );
};

const trace = (
  context: CanvasRenderingContext2D,
  ring: ReadonlyArray<Point>,
) => {
  context.beginPath();
  for (const [index, [x, z]] of ring.entries()) {
    if (index === 0) context.moveTo(x, z);
    else context.lineTo(x, z);
  }
};

const roundTenth = (value: number) => Math.round(value * 10) / 10;

const HouseDrawing = ({
  base,
  buildings,
  height,
  onChange,
}: {
  readonly base: Arena;
  readonly buildings: ReadonlyArray<DrawnBuilding>;
  readonly height: number;
  readonly onChange: (buildings: ReadonlyArray<DrawnBuilding>) => void;
}) => {
  const photo = useAtomValue(imageryAtom(base), photoOf);
  const plan = useMemo(
    () => paintPlan(base, paintGround(base, photo), planSize),
    [base, photo],
  );
  const canvas = useRef<HTMLCanvasElement>(null);
  const [corners, setCorners] = useState<ReadonlyArray<Point>>([]);
  const [hover, setHover] = useState<Point>();
  const { halfSize } = base;
  const scale = planSize / (2 * halfSize);

  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    context.resetTransform();
    context.drawImage(plan, 0, 0);
    context.setTransform(
      scale,
      0,
      0,
      scale,
      halfSize * scale,
      halfSize * scale,
    );
    context.lineWidth = 2 / scale;
    context.fillStyle = 'rgba(225, 29, 72, 0.45)';
    context.strokeStyle = '#e11d48';
    for (const { footprint } of buildings) {
      trace(context, footprint);
      context.closePath();
      context.fill();
      context.stroke();
    }
    if (corners.length === 0) return;
    context.strokeStyle = '#facc15';
    trace(context, hover ? [...corners, hover] : corners);
    context.stroke();
    context.fillStyle = '#facc15';
    for (const [index, [x, z]] of corners.entries()) {
      context.beginPath();
      context.arc(x, z, (index === 0 ? 5 : 3) / scale, 0, 2 * Math.PI);
      context.fill();
    }
  }, [plan, buildings, corners, hover, halfSize, scale]);

  const toArena = (event: MouseEvent): Point | undefined => {
    const rect = canvas.current?.getBoundingClientRect();
    if (!rect) return undefined;
    const at = (offset: number, length: number) =>
      roundTenth(
        Math.max(
          -halfSize,
          Math.min(halfSize, (offset / length) * 2 * halfSize - halfSize),
        ),
      );
    return [
      at(event.clientX - rect.left, rect.width),
      at(event.clientY - rect.top, rect.height),
    ];
  };

  const closes = (point: Point) => {
    const [first] = corners;
    const width = canvas.current?.getBoundingClientRect().width ?? planSize;
    return (
      first !== undefined &&
      corners.length >= 3 &&
      (Math.hypot(point[0] - first[0], point[1] - first[1]) * width) /
        (2 * halfSize) <
        closeRadius
    );
  };

  const full = buildings.length >= MAX_DRAWN_BUILDINGS;

  return (
    <div className='flex h-full w-full items-center justify-center p-2'>
      <canvas
        ref={canvas}
        width={planSize}
        height={planSize}
        className={`aspect-square max-h-full max-w-full ${full ? 'cursor-not-allowed' : 'cursor-crosshair'}`}
        onMouseMove={(event) => setHover(toArena(event))}
        onMouseLeave={() => setHover(undefined)}
        onClick={(event) => {
          const point = toArena(event);
          if (!point || full) return;
          if (closes(point)) {
            onChange([...buildings, { footprint: corners, height }]);
            setCorners([]);
          } else if (corners.length < maxCorners) {
            setCorners([...corners, point]);
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          if (corners.length > 0) {
            setCorners(corners.slice(0, -1));
            return;
          }
          const point = toArena(event);
          if (!point) return;
          const hit = Arr.findLastIndex(buildings, ({ footprint }) =>
            insideRing(point, footprint),
          );
          if (Option.isSome(hit)) onChange(Arr.remove(buildings, hit.value));
        }}
      />
    </div>
  );
};

const Field = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) => (
  <label className='flex flex-col gap-1 text-sm'>
    <span className='text-slate-300'>{label}</span>
    {children}
  </label>
);

const useApplyMap = (place: Coordinates) => {
  const send = useAtomSet(sendLobbyAtom);
  const [saved, setSaved] = useAtom(savedMapsAtom);
  return (map: MapSettings) => {
    send(lobbyMessages.setMapSettings(map));
    setSaved(rememberMap(saved, { lat: place.lat, lon: place.lon, map }));
  };
};

const Editor = ({
  base,
  initial,
  onDone,
}: {
  readonly base: Arena;
  readonly initial: MapSettings;
  readonly onDone: () => void;
}) => {
  const [draft, setDraft] = useState(initial);
  const [view, setView] = useState<'draw' | '3d'>('draw');
  const [stories, setStories] = useState(1);
  const apply = useApplyMap(base);
  const arena = useDeferredValue(
    useMemo(() => customizeArena(base, draft), [base, draft]),
  );
  const tab = (target: typeof view, label: string) => (
    <button
      className={`flex-1 rounded px-3 py-1 ${view === target ? 'bg-white text-slate-900' : 'bg-slate-700'}`}
      type='button'
      aria-pressed={view === target}
      onClick={() => setView(target)}
    >
      {label}
    </button>
  );
  return (
    <div className='fixed inset-0 z-50 flex flex-col bg-slate-900 text-white md:flex-row'>
      <div className='relative min-h-0 flex-1'>
        {view === '3d' ? (
          <ArenaView arena={arena} />
        ) : (
          <HouseDrawing
            base={base}
            buildings={draft.buildings}
            height={storyHeight(stories)}
            onChange={(buildings) => setDraft({ ...draft, buildings })}
          />
        )}
      </div>
      <aside className='flex flex-col gap-4 overflow-y-auto p-4 md:w-72'>
        <h2 className='text-lg font-semibold'>Customize map</h2>
        <div className='flex gap-1 text-sm'>
          {tab('draw', 'Draw houses')}
          {tab('3d', '3D preview')}
        </div>
        <Field label={`Elevation ×${draft.elevationScale}`}>
          <input
            type='range'
            min={0}
            max={maxElevationScale}
            step={0.25}
            value={draft.elevationScale}
            onChange={(event) =>
              setDraft({ ...draft, elevationScale: Number(event.target.value) })
            }
          />
        </Field>
        {base.terrain === undefined && (
          <p className='text-xs text-amber-300'>
            This arena has no elevation data, so the ground stays flat.
          </p>
        )}
        <Field label='New houses'>
          <select
            className='rounded bg-slate-700 px-2 py-1'
            value={stories}
            onChange={(event) => setStories(Number(event.target.value))}
          >
            {Arr.map([1, 2, 3], (count) => (
              <option key={count} value={count}>
                {count} {count === 1 ? 'story' : 'stories'} (
                {storyHeight(count)} m)
              </option>
            ))}
          </select>
        </Field>
        <p className='text-xs text-slate-400'>
          Click a house&apos;s corners on the aerial view, then click the first
          corner to finish it. Right-click undoes a corner, or deletes the house
          under the cursor.
        </p>
        <div className='flex items-center justify-between text-sm'>
          <span>
            {draft.buildings.length}/{MAX_DRAWN_BUILDINGS} drawn houses
          </span>
          <button
            className='text-rose-300 underline disabled:opacity-50'
            type='button'
            disabled={draft.buildings.length === 0}
            onClick={() => setDraft({ ...draft, buildings: [] })}
          >
            Clear
          </button>
        </div>
        <div className='mt-auto flex gap-2'>
          <button
            className='flex-1 button-paint px-4 py-2'
            type='button'
            onClick={() => {
              apply(draft);
              onDone();
            }}
          >
            Apply
          </button>
          <button
            className='rounded border border-slate-500 px-4 py-2'
            type='button'
            onClick={onDone}
          >
            Cancel
          </button>
        </div>
      </aside>
    </div>
  );
};

const arenaStatus = (result: AsyncResult.AsyncResult<unknown, unknown>) =>
  AsyncResult.isFailure(result)
    ? 'Could not build this arena.'
    : 'Building arena…';

const MapEditor = ({
  lobby,
  onDone,
}: {
  readonly lobby: Lobby;
  readonly onDone: () => void;
}) => {
  const { lat, lon } = lobby.location;
  const result = useAtomValue(arenaAtom({ lat, lon, size: lobby.map.size }));
  return AsyncResult.isSuccess(result) ? (
    <Editor base={result.value} initial={lobby.map} onDone={onDone} />
  ) : (
    <div className='fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-slate-900 text-white'>
      <p>{arenaStatus(result)}</p>
      <button className='underline' type='button' onClick={onDone}>
        Close
      </button>
    </div>
  );
};

const missingMessages: Record<ArenaLayer, string> = {
  terrain: "Elevation data didn't load in time, so the ground is flat.",
  footprints:
    "Building footprints didn't load, so only OpenStreetMap's buildings are standing.",
};

// The server keeps a bake missing a layer for a minute, so every member of a
// lobby gets the same one; asking again after that bakes afresh.
const retryMissingMs = 65_000;

// The host asks for a fresh bake until one comes back whole, which unmounts
// this, and pins whichever it sees; everyone else follows the pin, so the
// whole lobby switches together.
const RetryMissing = ({ query }: { readonly query: ArenaQuery }) => {
  const refresh = useAtomRefresh(arenaAtom(query));
  useEffect(() => {
    const fiber = Effect.runFork(
      Effect.forever(
        Effect.sleep(retryMissingMs).pipe(Effect.andThen(Effect.sync(refresh))),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [refresh]);
  return null;
};

const PinBake = ({
  lobby,
  bake,
}: {
  readonly lobby: Lobby;
  readonly bake: string | undefined;
}) => {
  const send = useAtomSet(sendLobbyAtom);
  const stale =
    lobby.phase === 'waiting' && bake !== undefined && bake !== lobby.bake;
  useEffect(() => {
    if (stale) send(lobbyMessages.pinBake(bake));
  }, [stale, bake, send]);
  return null;
};

const MissingLayers = ({
  missing,
  isHost,
}: {
  readonly missing: ReadonlyArray<ArenaLayer>;
  readonly isHost: boolean;
}) => (
  <div className='absolute inset-x-2 top-2 rounded-lg border border-amber-400/40 bg-night/90 px-3 py-2 text-xs text-amber-200'>
    {Arr.map(missing, (layer) => (
      <p key={layer}>{missingMessages[layer]}</p>
    ))}
    <p className='text-amber-200/70'>
      {isHost
        ? 'Trying again in about a minute; everyone switches together.'
        : "The host's game is trying again; everyone switches together."}
    </p>
  </div>
);

// The host sees the latest bake and pins it; everyone else sees the pin.
const LobbyArenaView = ({
  lobby,
  isHost,
}: {
  readonly lobby: Lobby;
  readonly isHost: boolean;
}) => {
  const { lat, lon } = lobby.location;
  const pin = isHost || lobby.bake === undefined ? {} : { bake: lobby.bake };
  const result = useAtomValue(
    customArenaAtom({ lat, lon, map: lobby.map, ...pin }),
  );
  if (!AsyncResult.isSuccess(result)) {
    return (
      <p className='flex h-full items-center justify-center text-sm text-muted'>
        {arenaStatus(result)}
      </p>
    );
  }
  const missing = result.value.missing ?? [];
  return (
    <div className='relative h-full'>
      <ArenaView arena={result.value} />
      {isHost && <PinBake lobby={lobby} bake={result.value.bake} />}
      {isHost && missing.length > 0 && (
        <RetryMissing query={{ lat, lon, size: lobby.map.size }} />
      )}
      {missing.length > 0 && (
        <MissingLayers missing={missing} isHost={isHost} />
      )}
    </div>
  );
};

// The host's browser brings back the settings it last applied at this place,
// once per place, when the lobby still has the defaults.
const RestoreSavedMap = ({ lobby }: { readonly lobby: Lobby }) => {
  const saved = useAtomValue(savedMapsAtom);
  const send = useAtomSet(sendLobbyAtom);
  const restored = useRef<string>(undefined);
  const { lat, lon } = lobby.location;
  const place = `${lat},${lon}`;
  const savedMap = Option.getOrUndefined(
    Option.map(savedMapAt(saved, { lat, lon }), (entry) => entry.map),
  );
  const hasDefaults =
    lobby.phase === 'waiting' && Equal.equals(lobby.map, defaultMapSettings);
  useEffect(() => {
    if (!hasDefaults || restored.current === place) return;
    restored.current = place;
    if (savedMap && !Equal.equals(savedMap, defaultMapSettings)) {
      send(lobbyMessages.setMapSettings(savedMap));
    }
  }, [hasDefaults, place, savedMap, send]);
  return null;
};

const sizeLabels: Record<ArenaSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
};

// A new size is a new bake, so the host's pick also starts it baking.
const SizePicker = ({ lobby }: { readonly lobby: Lobby }) => {
  const apply = useApplyMap(lobby.location);
  const warmArena = useAtomSet(warmArenaAtom);
  return (
    <fieldset className='flex gap-1'>
      <legend className='sr-only'>Arena size</legend>
      {Arr.map(ArenaSize.literals, (size) => (
        <button
          key={size}
          className={`rounded-lg px-3 py-1 text-sm ${size === lobby.map.size ? 'bg-lime-300 text-night' : 'button-ghost'}`}
          type='button'
          aria-pressed={size === lobby.map.size}
          title={`${arenaHalfSizes[size] * 2} m across`}
          onClick={() => {
            warmArena({ ...lobby.location, size });
            apply({ ...lobby.map, size });
          }}
        >
          {sizeLabels[size]}
        </button>
      ))}
    </fieldset>
  );
};

const shapeLabels: Record<ArenaShape, string> = {
  square: 'Square',
  circle: 'Circle',
};

// Changing the shape needs no new bake: clients wall off the circle.
const ShapePicker = ({ lobby }: { readonly lobby: Lobby }) => {
  const apply = useApplyMap(lobby.location);
  return (
    <fieldset className='flex gap-1'>
      <legend className='sr-only'>Arena shape</legend>
      {Arr.map(ArenaShape.literals, (shape) => (
        <button
          key={shape}
          className={`rounded-lg px-3 py-1 text-sm ${shape === lobby.map.shape ? 'bg-lime-300 text-night' : 'button-ghost'}`}
          type='button'
          aria-pressed={shape === lobby.map.shape}
          onClick={() => apply({ ...lobby.map, shape })}
        >
          {shapeLabels[shape]}
        </button>
      ))}
    </fieldset>
  );
};

const describeMap = ({ elevationScale, buildings }: MapSettings) =>
  `Elevation ×${elevationScale}, ${buildings.length} drawn ${buildings.length === 1 ? 'house' : 'houses'}`;

// Everyone sees the arena they will play; the host can customize it while
// the lobby waits.
export const LobbyMap = ({
  lobby,
  isHost,
}: {
  readonly lobby: Lobby;
  readonly isHost: boolean;
}) => {
  const [editing, setEditing] = useState(false);
  return (
    <div className='flex flex-col gap-3'>
      {isHost && <RestoreSavedMap lobby={lobby} />}
      <div className='h-80 overflow-hidden rounded-xl border border-line bg-field md:h-[28rem]'>
        {/* One WebGL view at a time: the editor has its own. */}
        {!editing && <LobbyArenaView lobby={lobby} isHost={isHost} />}
      </div>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        {isHost && lobby.phase === 'waiting' ? (
          <div className='flex flex-wrap gap-2'>
            <SizePicker lobby={lobby} />
            <ShapePicker lobby={lobby} />
          </div>
        ) : (
          <p className='text-sm'>
            {sizeLabels[lobby.map.size]}{' '}
            {lobby.map.shape === 'circle' ? 'round arena' : 'arena'},{' '}
            {arenaHalfSizes[lobby.map.size] * 2} m across
          </p>
        )}
        <p className='text-sm text-muted'>{describeMap(lobby.map)}</p>
        {isHost && lobby.phase === 'waiting' && (
          <button
            className='button-ghost px-3 py-1 text-sm'
            type='button'
            onClick={() => setEditing(true)}
          >
            Customize map
          </button>
        )}
      </div>
      {editing && <MapEditor lobby={lobby} onDone={() => setEditing(false)} />}
    </div>
  );
};
