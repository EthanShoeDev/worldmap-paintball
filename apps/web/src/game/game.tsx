import '@tanstack/react-start/client-only';
import { useAtomSet, useAtomSuspense, useAtomValue } from '@effect/atom-react';
import { Bvh, Sky } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import type { Arena } from '@worldmap-paintball/api-contract';
import { Array as Arr } from 'effect';
import { type ReactNode, Suspense, useMemo, useRef } from 'react';
import type { Group } from 'three';

import { arenaAtom } from '../api-client.ts';
import { ArenaAttribution } from '../components/osm-attribution.tsx';
import type { Coordinates } from '../location/coordinates.ts';
import { spawnPoint } from './arena-meshes.ts';
import { ArenaScene, ArenaTrees } from './arena-scene.tsx';
import { roadGraph } from './bot-nav.ts';
import { BotPlayer } from './bot-player.tsx';
import { gamepadNamesAtom, pointerLockedAtom } from './hud-atoms.ts';
import { imageryAtom, photoOf } from './imagery.ts';
import { MatchHud } from './match-hud.tsx';
import { colorOf, type NetGame, netGameAtom } from './net/net-game.ts';
import { practiceGameAtom } from './net/practice.ts';
import type { Vec3 } from './net/protocol.ts';
import { Player } from './player.tsx';
import { RemotePlayers, RemoteShots } from './remote-players.tsx';
import { traceShot } from './shots.ts';
import { SplatDecals } from './splat-decals.tsx';
import { appendSplat, splatsAtom } from './splats.ts';
import { heightAt } from './terrain.ts';
import { spawnHeight } from './tuning.ts';

const fogColor = '#c9dcec';

const World = ({
  arena,
  net,
}: {
  readonly arena: Arena;
  readonly net: NetGame['Service'] | undefined;
}) => {
  const setSplats = useAtomSet(splatsAtom);
  const targets = useRef<Group>(null);
  const sun = [arena.halfSize * 0.5, 200, arena.halfSize * 0.3] as const;
  const [x, z] = spawnPoint(arena.roads);
  const graph = useMemo(
    () => roadGraph(arena.roads, arena.halfSize),
    [arena.roads, arena.halfSize],
  );
  const fire = (origin: Vec3, dir: Vec3) => {
    const { surface, player } = traceShot(
      targets.current,
      origin,
      dir,
      net?.targets(net.you) ?? [],
    );
    if (surface) {
      const color = net && colorOf(net, net.you);
      setSplats((splats) => appendSplat(splats, surface, color));
    }
    net?.fire(net.you, origin, dir, player);
  };
  return (
    <>
      <Sky sunPosition={sun} />
      <fog attach='fog' args={[fogColor, 60, arena.halfSize * 2.5]} />
      <hemisphereLight args={['#dfefff', '#8a7f6a', 0.9]} />
      <directionalLight
        position={sun}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-arena.halfSize}
        shadow-camera-right={arena.halfSize}
        shadow-camera-top={arena.halfSize}
        shadow-camera-bottom={-arena.halfSize}
        shadow-camera-far={600}
        shadow-bias={-0.0005}
      />
      <Physics timeStep='vary'>
        <Bvh ref={targets}>
          <ArenaScene arena={arena} />
        </Bvh>
        <ArenaTrees arena={arena} />
        <Player
          spawn={
            net?.spawnOf(net.you) ?? [x, heightAt(arena, x, z) + spawnHeight, z]
          }
          local={net}
          onFire={fire}
        />
        {net?.isHost === true &&
          Arr.map(net.bots, (id, index) => (
            <BotPlayer
              key={id}
              id={id}
              net={net}
              graph={graph}
              arena={targets}
              seed={index + 1}
            />
          ))}
      </Physics>
      {net && (
        <>
          <RemotePlayers net={net} />
          <RemoteShots net={net} arena={targets} />
        </>
      )}
      <SplatDecals />
    </>
  );
};

const Hud = ({
  arena,
  children,
}: {
  readonly arena: Arena;
  readonly children?: ReactNode;
}) => {
  const locked = useAtomValue(pointerLockedAtom);
  const photo = useAtomValue(imageryAtom(arena), photoOf);
  const gamepads = useAtomValue(gamepadNamesAtom);
  return (
    <div className='pointer-events-none absolute inset-0 text-white'>
      <div className='absolute top-1/2 left-1/2 size-1.5 -translate-1/2 rounded-full bg-white/90 shadow' />
      {!locked && (
        <div className='absolute inset-x-0 top-6 mx-auto w-fit rounded bg-black/60 px-4 py-2 text-sm'>
          Click to capture the mouse · WASD move · Shift sprint · Space jump ·
          Click fire · Esc release · or use a gamepad
        </div>
      )}
      {gamepads.length > 0 && (
        <p className='absolute top-2 right-3 text-xs'>
          Gamepad: {Arr.join(gamepads, ', ')}
        </p>
      )}
      {children}
      <ArenaAttribution
        imagery={photo !== undefined}
        terrain={arena.terrain !== undefined}
        className='pointer-events-auto absolute right-2 bottom-1 rounded bg-black/50 px-2 py-0.5'
      />
    </div>
  );
};

const Scene = ({
  arena,
  net,
  practice = false,
}: {
  readonly arena: Arena;
  readonly net: NetGame['Service'] | undefined;
  readonly practice?: boolean;
}) => (
  <>
    <Canvas shadows camera={{ fov: 75, near: 0.1, far: 2000 }}>
      <color attach='background' args={[fogColor]} />
      <Suspense fallback={null}>
        <World arena={arena} net={net} />
      </Suspense>
    </Canvas>
    <Hud arena={arena}>{net && <MatchHud net={net} practice={practice} />}</Hud>
  </>
);

const SoloGame = ({ coordinates }: { readonly coordinates: Coordinates }) => {
  const arena = useAtomSuspense(arenaAtom(coordinates)).value;
  return <Scene arena={arena} net={undefined} />;
};

const NetworkedGame = ({
  coordinates,
}: {
  readonly coordinates: Coordinates;
}) => {
  const arena = useAtomSuspense(arenaAtom(coordinates)).value;
  const net = useAtomSuspense(netGameAtom(coordinates)).value;
  return <Scene arena={arena} net={net} />;
};

const PracticeGame = ({
  coordinates,
  bots,
}: {
  readonly coordinates: Coordinates;
  readonly bots: number;
}) => {
  const arena = useAtomSuspense(arenaAtom(coordinates)).value;
  const net = useAtomSuspense(practiceGameAtom({ ...coordinates, bots })).value;
  return <Scene arena={arena} net={net} practice />;
};

const LocalGame = ({
  coordinates,
  bots,
}: {
  readonly coordinates: Coordinates;
  readonly bots: number;
}) =>
  bots > 0 ? (
    <PracticeGame coordinates={coordinates} bots={bots} />
  ) : (
    <SoloGame coordinates={coordinates} />
  );

export const Game = ({
  coordinates,
  networked,
  bots = 0,
}: {
  readonly coordinates: Coordinates;
  readonly networked: boolean;
  // Practice bots when not networked; 0 is solo practice.
  readonly bots?: number;
}) => (
  <div className='fixed inset-0 bg-sky-100'>
    <Suspense
      fallback={
        <p className='flex h-full items-center justify-center text-lg'>
          {networked
            ? 'Building arena and connecting to the other players…'
            : 'Building arena from OpenStreetMap…'}
        </p>
      }
    >
      {networked ? (
        <NetworkedGame coordinates={coordinates} />
      ) : (
        <LocalGame coordinates={coordinates} bots={bots} />
      )}
    </Suspense>
  </div>
);
