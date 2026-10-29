import '@tanstack/react-start/client-only';
import { useAtomSet, useAtomSuspense, useAtomValue } from '@effect/atom-react';
import { Bvh, PerformanceMonitor, Stats } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import type { Arena } from '@worldmap-paintball/api-contract';
import {
  defaultMapSettings,
  defaultMatchRules,
  type MapSettings,
  type MatchRules,
} from '@worldmap-paintball/api-contract/lobby';
import { Array as Arr } from 'effect';
import {
  type ReactNode,
  type RefObject,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Group } from 'three';

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
import { type ArenaKey, customArenaAtom } from './map-settings.ts';
import { MatchHud } from './match-hud.tsx';
import { placeArrow, placeDots } from './minimap-arrow.ts';
import { Minimap, MinimapTracker } from './minimap.tsx';
import { colorOf, type NetGame, netGameAtom } from './net/net-game.ts';
import { practiceGameAtom } from './net/practice.ts';
import type { Vec3 } from './net/protocol.ts';
import { PaintballFlights } from './paintball-flights.tsx';
import { launch, type Paintballs, type Volley } from './paintballs.ts';
import { PauseMenu } from './pause-menu.tsx';
import { Player } from './player.tsx';
import { PowerPads } from './power-pads.tsx';
import { padsOf, type PowerUpLink, soloPowerUps } from './powerups.ts';
import { RemotePlayers } from './remote-players.tsx';
import { renderDpr } from './render-scale.ts';
import { renderScaleAtom, soundVolumeAtom } from './render-settings.ts';
import { aimShot } from './shots.ts';
import { SkyDome } from './sky-dome.tsx';
import { playHitMarker, playShot, setVolume, unlockAudio } from './sounds.ts';
import { SplatDecals } from './splat-decals.tsx';
import { soloPaint } from './splats.ts';
import { escapeOf, heightAt } from './terrain.ts';
import {
  hazeColor,
  playerColor,
  renderTuning,
  spawnHeight,
  viewFov,
  type WeaponId,
  weaponsAt,
} from './tuning.ts';

const World = ({
  arena,
  net,
  rules,
}: {
  readonly arena: Arena;
  readonly net: NetGame['Service'] | undefined;
  readonly rules: MatchRules;
}) => {
  const targets = useRef<Group>(null);
  const balls = useRef<Paintballs>([]);
  const shots = useRef(0);
  const setHits = useAtomSet(hitMarkerAtom);
  const sun = [arena.halfSize * 0.5, 200, arena.halfSize * 0.3] as const;
  const [x, z] = spawnPoint(arena);
  const graph = useMemo(
    () => roadGraph(arena.roads, arena.halfSize),
    [arena.roads, arena.halfSize],
  );
  const escape = useMemo(() => escapeOf(arena), [arena]);
  const xray = useRef(false);
  const clock = useThree((state) => state.clock);
  const powerUps = useMemo<PowerUpLink>(
    () =>
      net
        ? {
            pads: net.pads,
            ready: net.padsReady,
            grab: net.grab,
            take: net.takePowerUp,
          }
        : soloPowerUps(padsOf(arena), () => clock.elapsedTime * 1000),
    [net, arena, clock],
  );
  const table = useMemo(
    () => weaponsAt(rules.paintballSpeed),
    [rules.paintballSpeed],
  );
  const launchVolley = (volley: Volley) => {
    launch(balls.current, volley, table);
    // Your own marker plays in your head; bots' from where they stand.
    const yours = volley.shooter === undefined || volley.shooter === net?.you;
    playShot(volley.weapon, yours ? undefined : volley.origin);
  };
  const fire = (eye: Vec3, dir: Vec3, muzzle: Vec3, weapon: WeaponId) => {
    shots.current += 1;
    const shot = aimShot(
      targets.current,
      table[weapon],
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
        playHitMarker();
        net.hit({ shooter, target: hit.target, point: hit.point, weapon });
      },
    });
  };
  return (
    <>
      <SkyDome sun={sun} />
      <fog attach='fog' args={[hazeColor, 60, arena.halfSize * 2.5]} />
      <hemisphereLight args={['#dfefff', '#8a7f6a', 0.9]} />
      <directionalLight
        position={sun}
        intensity={2.2}
        color='#fff1dc'
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
          <ArenaTrees arena={arena} />
        </Bvh>
        <Player
          spawn={
            net?.spawnOf(net.you) ?? [x, heightAt(arena, x, z) + spawnHeight, z]
          }
          escape={escape}
          rules={rules}
          local={net}
          powerUps={powerUps}
          onPowerUp={(kind) => {
            xray.current = kind === 'xray';
          }}
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
              escape={escape}
              rules={rules}
              weapons={table}
            />
          ))}
      </Physics>
      <PowerPads arena={arena} link={powerUps} />
      {net && <RemotePlayers net={net} xray={() => xray.current} />}
      <PaintballFlights
        balls={balls}
        arena={targets}
        net={net}
        weapons={table}
      />
      <SplatDecals />
    </>
  );
};

const Hud = ({
  arena,
  dpr,
  marker,
  dots,
  onResume,
  children,
}: {
  readonly arena: Arena;
  readonly dpr: number;
  readonly marker: RefObject<HTMLDivElement | null>;
  readonly dots: RefObject<HTMLDivElement | null>;
  readonly onResume: () => void;
  readonly children?: ReactNode;
}) => {
  const photo = useAtomValue(imageryAtom(arena), photoOf);
  const gamepads = useAtomValue(gamepadNamesAtom);
  return (
    <div className='pointer-events-none absolute inset-0 text-white'>
      <CombatHud />
      <Minimap arena={arena} marker={marker} dots={dots} />
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
  rules,
  practice = false,
}: {
  readonly arena: Arena;
  readonly net: NetGame['Service'] | undefined;
  readonly rules: MatchRules;
  readonly practice?: boolean;
}) => {
  const scale = useAtomValue(renderScaleAtom);
  const [factor, setFactor] = useState(1);
  const dpr = renderDpr(scale, window.devicePixelRatio, factor);
  const canvas = useRef<HTMLCanvasElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const dots = useRef<HTMLDivElement>(null);
  const volume = useAtomValue(soundVolumeAtom);
  useEffect(() => setVolume(volume), [volume]);
  // Gamepad players may never click, so any key or click starts audio.
  useEffect(() => {
    for (const event of ['pointerdown', 'keydown']) {
      window.addEventListener(event, unlockAudio);
    }
    return () => {
      for (const event of ['pointerdown', 'keydown']) {
        window.removeEventListener(event, unlockAudio);
      }
    };
  }, []);
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
        <color attach='background' args={[hazeColor]} />
        <MinimapTracker
          onMove={(x, z, yaw) => {
            if (marker.current) {
              placeArrow(marker.current, arena.halfSize, x, z, yaw);
            }
            if (rules.revealPlayers && net && dots.current) {
              placeDots(
                dots.current,
                arena.halfSize,
                net.targets(net.you),
                (id) => colorOf(net, id),
              );
            }
          }}
        />
        <Suspense fallback={null}>
          <World arena={arena} net={net} rules={rules} />
        </Suspense>
      </Canvas>
      <Hud
        arena={arena}
        dpr={dpr}
        marker={marker}
        dots={dots}
        onResume={() => {
          if (canvas.current) lockPointer(canvas.current);
        }}
      >
        {net && <MatchHud net={net} practice={practice} />}
      </Hud>
    </>
  );
};

interface GameProps {
  readonly arenaKey: ArenaKey;
  readonly rules: MatchRules;
}

const SoloGame = ({ arenaKey, rules }: GameProps) => {
  const arena = useAtomSuspense(customArenaAtom(arenaKey)).value;
  return <Scene arena={arena} net={undefined} rules={rules} />;
};

const NetworkedGame = ({ arenaKey, rules }: GameProps) => {
  const arena = useAtomSuspense(customArenaAtom(arenaKey)).value;
  const net = useAtomSuspense(netGameAtom({ ...arenaKey, rules })).value;
  return <Scene arena={arena} net={net} rules={rules} />;
};

const PracticeGame = ({
  arenaKey,
  rules,
  bots,
}: GameProps & { readonly bots: number }) => {
  const arena = useAtomSuspense(customArenaAtom(arenaKey)).value;
  const net = useAtomSuspense(
    practiceGameAtom({ ...arenaKey, rules, bots }),
  ).value;
  return <Scene arena={arena} net={net} rules={rules} practice />;
};

export const Game = ({
  coordinates,
  map = defaultMapSettings,
  rules = defaultMatchRules,
  bake,
  networked,
  bots = 0,
}: {
  readonly coordinates: Coordinates;
  // The lobby's map settings and rules; practice away from a lobby plays
  // the arena as baked, by the default rules.
  readonly map?: MapSettings;
  readonly rules?: MatchRules;
  // The lobby's pinned bake, so every member plays the same one.
  readonly bake?: string | undefined;
  readonly networked: boolean;
  // Practice bots when not networked; 0 is solo practice.
  readonly bots?: number;
}) => {
  const arenaKey = { ...coordinates, map, ...(bake !== undefined && { bake }) };
  return (
    <div className='fixed inset-0 bg-night'>
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
          <NetworkedGame arenaKey={arenaKey} rules={rules} />
        ) : bots > 0 ? (
          <PracticeGame arenaKey={arenaKey} rules={rules} bots={bots} />
        ) : (
          <SoloGame arenaKey={arenaKey} rules={rules} />
        )}
      </Suspense>
    </div>
  );
};
