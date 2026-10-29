import '@tanstack/react-start/client-only';
import { useAtomSet, useAtomSuspense, useAtomValue } from '@effect/atom-react';
import { Bvh, PerformanceMonitor, Sky, Stats } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import type { Arena } from '@worldmap-paintball/api-contract';
import { Array as Arr } from 'effect';
import { type ReactNode, Suspense, useMemo, useRef, useState } from 'react';
import type { Group } from 'three';

import { arenaAtom } from '../api-client.ts';
import { ArenaAttribution } from '../components/osm-attribution.tsx';
import type { Coordinates } from '../location/coordinates.ts';
import { spawnPoint } from './arena-meshes.ts';
import { ArenaScene, ArenaTrees } from './arena-scene.tsx';
import { roadGraph } from './bot-nav.ts';
import { BotPlayer } from './bot-player.tsx';
import { CombatHud } from './combat-hud.tsx';
import { lockPointer } from './devices.ts';
import { gamepadNamesAtom, hitMarkerAtom } from './hud-atoms.ts';
import { imageryAtom, photoOf } from './imagery.ts';
import { MatchHud } from './match-hud.tsx';
import { colorOf, type NetGame, netGameAtom } from './net/net-game.ts';
import { practiceGameAtom } from './net/practice.ts';
import type { Vec3 } from './net/protocol.ts';
import { PaintballFlights } from './paintball-flights.tsx';
import { launch, type Paintballs, type Volley } from './paintballs.ts';
import { PauseMenu } from './pause-menu.tsx';
import { Player } from './player.tsx';
import { RemotePlayers } from './remote-players.tsx';
import { renderDpr } from './render-scale.ts';
import { renderScaleAtom } from './render-settings.ts';
import { aimShot } from './shots.ts';
import { SplatDecals } from './splat-decals.tsx';
import { soloPaint } from './splats.ts';
import { heightAt } from './terrain.ts';
import {
  playerColor,
  renderTuning,
  spawnHeight,
  viewFov,
  type WeaponId,
  weapons,
} from './tuning.ts';

const fogColor = '#c9dcec';

const World = ({
  arena,
  net,
}: {
  readonly arena: Arena;
  readonly net: NetGame['Service'] | undefined;
}) => {
  const targets = useRef<Group>(null);
  const balls = useRef<Paintballs>([]);
  const shots = useRef(0);
  const setHits = useAtomSet(hitMarkerAtom);
  const sun = [arena.halfSize * 0.5, 200, arena.halfSize * 0.3] as const;
  const [x, z] = spawnPoint(arena.roads);
  const graph = useMemo(
    () => roadGraph(arena.roads, arena.halfSize),
    [arena.roads, arena.halfSize],
  );
  const launchVolley = (volley: Volley) => {
    launch(balls.current, volley);
  };
  const fire = (eye: Vec3, dir: Vec3, muzzle: Vec3, weapon: WeaponId) => {
    shots.current += 1;
    const shot = aimShot(
      targets.current,
      weapons[weapon],
      eye,
      dir,
      muzzle,
      net?.targets(net.you) ?? [],
    );
    const volley = { ...shot, weapon, seed: shots.current };
    if (!net) {
      launchVolley({
        ...volley,
        shooter: undefined,
        color: soloPaint(shots.current),
        onHit: undefined,
      });
      return;
    }
    const shooter = net.you;
    net.fire({ ...volley, shooter });
    launchVolley({
      ...volley,
      shooter,
      color: colorOf(net, shooter),
      onHit: (hit) => {
        setHits((count) => count + 1);
        net.hit({ shooter, target: hit.target, point: hit.point, weapon });
      },
    });
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
          color={net ? colorOf(net, net.you) : playerColor(0)}
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
              launch={launchVolley}
            />
          ))}
      </Physics>
      {net && <RemotePlayers net={net} />}
      <PaintballFlights balls={balls} arena={targets} net={net} />
      <SplatDecals />
    </>
  );
};

const Hud = ({
  arena,
  dpr,
  onResume,
  children,
}: {
  readonly arena: Arena;
  readonly dpr: number;
  readonly onResume: () => void;
  readonly children?: ReactNode;
}) => {
  const photo = useAtomValue(imageryAtom(arena), photoOf);
  const gamepads = useAtomValue(gamepadNamesAtom);
  return (
    <div className='pointer-events-none absolute inset-0 text-white'>
      <CombatHud />
      <PauseMenu dpr={dpr} onResume={onResume} />
      {gamepads.length > 0 && (
        <p className='absolute top-2 right-3 text-xs'>
          Gamepad: {Arr.join(gamepads, ', ')}
        </p>
      )}
      {children}
      {/* stats.js pins itself top-left inline, where the scoreboard is. */}
      <Stats className='top-auto! bottom-2! left-2!' />
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
}) => {
  const scale = useAtomValue(renderScaleAtom);
  const [factor, setFactor] = useState(1);
  const dpr = renderDpr(scale, window.devicePixelRatio, factor);
  const canvas = useRef<HTMLCanvasElement>(null);
  return (
    <>
      <Canvas
        ref={canvas}
        shadows
        dpr={dpr}
        // Laptops otherwise often hand WebGL the integrated GPU.
        gl={{ powerPreference: 'high-performance' }}
        camera={{ fov: viewFov, near: 0.1, far: 2000 }}
      >
        {scale === 'auto' && (
          <PerformanceMonitor
            factor={1}
            flipflops={renderTuning.flipflops}
            onChange={(monitor) => setFactor(monitor.factor)}
          />
        )}
        <color attach='background' args={[fogColor]} />
        <Suspense fallback={null}>
          <World arena={arena} net={net} />
        </Suspense>
      </Canvas>
      <Hud
        arena={arena}
        dpr={dpr}
        onResume={() => {
          if (canvas.current) lockPointer(canvas.current);
        }}
      >
        {net && <MatchHud net={net} practice={practice} />}
      </Hud>
    </>
  );
};

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
