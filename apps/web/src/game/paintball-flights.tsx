import '@tanstack/react-start/client-only';
import { useAtomSet } from '@effect/atom-react';
import { useFrame } from '@react-three/fiber';
import type { PlayerId } from '@worldmap-paintball/api-contract/lobby';
import { Array as Arr } from 'effect';
import type { RefObject } from 'react';
import { useRef } from 'react';
import {
  type InstancedMesh,
  Matrix4,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three';

import { colorOf, type NetGame } from './net/net-game.ts';
import type { Vec3 } from './net/protocol.ts';
import { advance, launch, type Paintballs } from './paintballs.ts';
import { ballAt, ballVelocity } from './projectile.ts';
import { segmentImpact } from './shots.ts';
import { appendSplat, splatsAtom } from './splats.ts';
import { paintballTuning } from './tuning.ts';

const { maxBalls, radius, trail } = paintballTuning;

const replayShots = (balls: Paintballs, net: NetGame['Service']) => {
  for (const shot of net.takeShots()) {
    launch(balls, {
      ...shot,
      color: colorOf(net, shot.shooter),
      onHit: undefined,
    });
  }
};

const matrix = new Matrix4();
const position = new Vector3();
const heading = new Quaternion();
const stretch = new Vector3();
const trailAxis = new Vector3(0, 1, 0);
const behind = new Vector3();

// Every ball in flight, simulated and drawn as two instanced meshes. Balls
// from other browsers come in through `net.takeShots` and replay here.
export const PaintballFlights = ({
  balls,
  arena,
  net,
}: {
  readonly balls: RefObject<Paintballs>;
  readonly arena: RefObject<Object3D | null>;
  readonly net: NetGame['Service'] | undefined;
}) => {
  const setSplats = useAtomSet(splatsAtom);
  const spheres = useRef<InstancedMesh>(null);
  const trails = useRef<InstancedMesh>(null);

  useFrame((_, dt) => {
    const flying = balls.current;
    if (net) replayShots(flying, net);
    // Everyone but the shooter, so a ball never hits the one who fired it.
    const targets = new Map<
      PlayerId,
      ReadonlyArray<readonly [PlayerId, Vec3]>
    >();
    const targetsOf = (shooter: PlayerId | undefined) => {
      if (!net || shooter === undefined) return [];
      const known = targets.get(shooter) ?? net.targets(shooter);
      targets.set(shooter, known);
      return known;
    };
    const landed = advance(flying, dt, (ball, start, end) =>
      segmentImpact(arena.current, targetsOf(ball.shooter), start, end),
    );
    if (landed.length > 0) {
      setSplats((splats) =>
        Arr.reduce(landed, splats, (next, [hit, color]) =>
          appendSplat(next, hit, color),
        ),
      );
    }

    const sphereMesh = spheres.current;
    const trailMesh = trails.current;
    if (!sphereMesh || !trailMesh) return;
    for (const [index, ball] of flying.entries()) {
      position.set(...ballAt(ball.weapon, ball.origin, ball.dir, ball.age));
      sphereMesh.setMatrixAt(index, matrix.makeTranslation(position));
      sphereMesh.setColorAt(index, ball.tint);
      // Tapers back along the path, never further than the ball has come.
      const length = Math.min(trail.length, ball.weapon.muzzleSpeed * ball.age);
      behind
        .set(...ballVelocity(ball.weapon, ball.dir, ball.age))
        .normalize()
        .negate();
      heading.setFromUnitVectors(trailAxis, behind);
      position.addScaledVector(behind, length / 2);
      stretch.set(1, length, 1);
      trailMesh.setMatrixAt(index, matrix.compose(position, heading, stretch));
      trailMesh.setColorAt(index, ball.tint);
    }
    for (const mesh of [sphereMesh, trailMesh]) {
      mesh.count = flying.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh
        ref={spheres}
        args={[undefined, undefined, maxBalls]}
        count={0}
        frustumCulled={false}
      >
        <sphereGeometry args={[radius, 10, 8]} />
        <meshStandardMaterial roughness={0.15} metalness={0.1} />
      </instancedMesh>
      <instancedMesh
        ref={trails}
        args={[undefined, undefined, maxBalls]}
        count={0}
        frustumCulled={false}
      >
        {/* Unit height along +y, the ball at -y: wide there, a point behind. */}
        <cylinderGeometry args={[0, trail.radius, 1, 6, 1, true]} />
        <meshBasicMaterial
          transparent
          opacity={trail.opacity}
          depthWrite={false}
        />
      </instancedMesh>
    </>
  );
};
